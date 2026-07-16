/* ============================================================
   앱 셸 공통 로직 — 원칙적으로 수정하지 않는다.
   서비스 고유 로직은 아래 "TOOL MODULE" 영역에만 작성한다.
   ============================================================ */
(function shell() {
  "use strict";
  var cfg = window.APP_CONFIG || {};

  // 연도
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // 테마 토글: auto → light → dark → auto
  var themeBtn = document.getElementById("theme-toggle");
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem(cfg.slug + ":theme"); } catch (e) { /* private mode */ }
  if (saved) root.setAttribute("data-theme", saved);
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var order = ["auto", "light", "dark"];
      var cur = root.getAttribute("data-theme") || "auto";
      var next = order[(order.indexOf(cur) + 1) % order.length];
      root.setAttribute("data-theme", next);
      try { localStorage.setItem(cfg.slug + ":theme", next); } catch (e) { /* noop */ }
    });
  }

  // 공유
  var shareBtn = document.getElementById("share-btn");
  if (shareBtn) {
    shareBtn.addEventListener("click", function () {
      var data = { title: document.title, url: location.href };
      if (navigator.share) {
        navigator.share(data).catch(function () { /* 사용자가 취소 */ });
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(location.href).then(function () {
          shareBtn.textContent = "✓";
          setTimeout(function () { shareBtn.textContent = "↗"; }, 1200);
        });
      }
    });
  }

  // PWA 서비스워커
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(function () { /* 오프라인 미지원 환경 */ });
  }

  // AdSense — 게이트 통과 전에는 enabled=false 라 아무것도 하지 않는다
  if (cfg.adsense && cfg.adsense.enabled && cfg.adsense.client && cfg.adsense.slot) {
    var slotEl = document.getElementById("ad-slot");
    if (slotEl) {
      slotEl.hidden = false;
      var ins = document.createElement("ins");
      ins.className = "adsbygoogle";
      ins.style.display = "block";
      ins.setAttribute("data-ad-client", cfg.adsense.client);
      ins.setAttribute("data-ad-slot", cfg.adsense.slot);
      ins.setAttribute("data-ad-format", "auto");
      ins.setAttribute("data-full-width-responsive", "true");
      slotEl.appendChild(ins);
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    }
  }

  // GA4 — 설정 시에만 로드, 실패해도 본 기능에 영향 없게 격리 (safeTrack 원칙)
  if (cfg.analytics && cfg.analytics.ga4) {
    try {
      var s = document.createElement("script");
      s.async = true;
      s.src = "https://www.googletagmanager.com/gtag/js?id=" + cfg.analytics.ga4;
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", cfg.analytics.ga4);
    } catch (e) { /* 분석 실패는 조용히 무시 */ }
  }
})();

/* ============================================================
   TOOL MODULE — 빌더 에이전트가 이 영역을 서비스 로직으로 교체한다.
   규칙:
   - 상태는 localStorage(키 prefix: cfg.slug + ":") 또는 URL 파라미터에만 저장
   - 외부 API 호출 시 실패 UI(.result에 오류 문구) 필수
   - 빈 입력/공집합도 명시적으로 처리 (조용한 실패 금지)
   ============================================================ */
(function tool() {
  "use strict";
  // TOOLJS:START
  var cfg = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "salary-calc";
  var LS_KEY = SLUG + ":last";

  // 2026년 요율 상수 — 축3: "아는 값은 우리가 채운다".
  // 사용자에게 절대 묻지 않는다. 화면에는 상세 조정 안에서 읽기 전용으로만 노출한다.
  // 연 1회 갱신으로 수렴하는 정적 데이터만 내장한다 (pure-static 원칙 — 실시간 API 없음).
  var RATES = {
    pension: 0.045,          // 국민연금 4.5%
    pension_cap: 5900000,    // 국민연금 기준월보수 상한 590만원
    health: 0.03545,         // 건강보험 3.545%
    ltc_ratio: 0.9182,       // 장기요양 = 건강보험료 × 9.182% (건보료 대비 비율)
    employment: 0.009        // 고용보험 0.9%
  };

  // UI 경계값
  var MAX_DEP = 7;                        // 간이세액표 근사표가 구분하는 최대 부양가족 수 (getIncomeTax 클램프와 동일)
  var MAX_WAN = 500000;                   // 지원 상한 = 연봉 50억원
  var NT_PRESETS = [0, 100000, 200000];   // 비과세액 선택지 (없음 / 일반 식대 / 식대 한도)

  // 간이세액표 근사: [과세월급여 상한(원), [부양가족1명 세액, 2명, 3명, ...최대7명]]
  // 부양가족 수에 따른 소득세 구간 (2026년 간이세액표 근사)
  // 과세 월급여 구간별로 부양가족 1~7명 세액(원)을 근사 하드코딩
  var TAX_TABLE = [
    // [과세월급여 이하, [1명, 2명, 3명, 4명, 5명, 6명, 7명]]
    [1060000,  [0,       0,      0,     0,     0,     0,     0]],
    [1500000,  [13520,   3390,   0,     0,     0,     0,     0]],
    [1800000,  [30800,   18540,  6280,  0,     0,     0,     0]],
    [2100000,  [51110,   38840,  26580, 14310, 2050,  0,     0]],
    [2400000,  [73690,   61420,  49160, 36890, 24630, 12360, 100]],
    [2700000,  [98760,   86490,  74230, 61960, 49700, 37430, 25170]],
    [3000000,  [126380,  114110, 101840,89570, 77310, 65040, 52780]],
    [3500000,  [167100,  154830, 142570,130300,118040,105770,93510]],
    [4000000,  [216090,  203820, 191560,179290,167030,154760,142500]],
    [4500000,  [277690,  263210, 250950,238680,226420,214150,201890]],
    [5000000,  [360500,  343120, 330860,318590,306330,294060,281800]],
    [5500000,  [463100,  445720, 433460,421190,408930,396660,384400]],
    [6000000,  [574950,  557570, 545310,533040,520780,508510,496250]],
    [7000000,  [740000,  722620, 710360,698090,685830,673560,661300]],
    [8000000,  [930000,  912620, 900360,888090,875830,863560,851300]],
    [10000000, [1240000, 1222620,1210360,1198090,1185830,1173560,1161300]],
    [Infinity, [1550000, 1532620,1520360,1508090,1495830,1483560,1471300]]
  ];

  function getIncomeTax(taxableMonthly, dependants) {
    var dep = Math.max(1, Math.min(dependants, 7));
    var idx = dep - 1;
    for (var i = 0; i < TAX_TABLE.length; i++) {
      if (taxableMonthly <= TAX_TABLE[i][0]) {
        return TAX_TABLE[i][1][idx] || 0;
      }
    }
    return TAX_TABLE[TAX_TABLE.length - 1][1][idx] || 0;
  }

  function calcSalary(annualWan, nonTaxableMonth, dependants) {
    // annualWan: 만원 단위 연봉, nonTaxableMonth: 비과세액(원/월), dependants: 부양가족수(본인포함)
    var annualWon = annualWan * 10000;
    var grossMonthly = annualWon / 12;

    // 비과세 클리핑
    var nonTax = Math.min(nonTaxableMonth, grossMonthly);
    var taxableMonthly = grossMonthly - nonTax;

    // 국민연금: 과세월급여 × 4.5%, 상한 590만원 적용
    var pensionBase = Math.min(taxableMonthly, RATES.pension_cap);
    var pension = Math.floor(pensionBase * RATES.pension);

    // 건강보험: 과세월급여 × 3.545%
    var health = Math.floor(taxableMonthly * RATES.health);

    // 장기요양: 건강보험료 × 9.182%
    var ltc = Math.floor(health * RATES.ltc_ratio);

    // 고용보험: 과세월급여 × 0.9%
    var employ = Math.floor(taxableMonthly * RATES.employment);

    // 소득세 (간이세액표 근사)
    var incomeTax = getIncomeTax(taxableMonthly, dependants);

    // 지방소득세 = 소득세 × 10%
    var localTax = Math.floor(incomeTax * 0.1);

    var totalDeduction = pension + health + ltc + employ + incomeTax + localTax;
    var netMonthly = Math.floor(grossMonthly - totalDeduction);
    var netAnnual = netMonthly * 12;

    return {
      grossMonthly: Math.floor(grossMonthly),
      taxableMonthly: Math.floor(taxableMonthly),
      nonTaxClipped: nonTax < nonTaxableMonth,
      pension: pension,
      health: health,
      ltc: ltc,
      employ: employ,
      incomeTax: incomeTax,
      localTax: localTax,
      totalDeduction: totalDeduction,
      netMonthly: netMonthly,
      netAnnual: netAnnual
    };
  }

  /* ---------- 표시 형식 (축4: 한국 로케일 — Intl 사용, 자릿수 하드코딩 금지) ---------- */
  // 한국 표기 관습상 "₩2,755,057" 이 아니라 "2,755,057원" 으로 쓴다.
  var NF = null;
  try { NF = new Intl.NumberFormat("ko-KR"); } catch (e) { NF = null; }
  function nf(n) { return NF ? NF.format(n) : n.toLocaleString("ko-KR"); }
  function fmt(n) { return nf(n) + "원"; }
  function pct(x) { return (Math.round(x * 1000) / 10).toFixed(1) + "%"; }

  // 한국식 금액 읽기 (축4): 12000만원 → "1억 2,000만원" — 자릿수 착오 방지
  function wanToKo(wan) {
    if (!isFinite(wan) || wan <= 0) return "";
    if (wan !== Math.floor(wan)) return nf(wan) + "만원";
    var eok = Math.floor(wan / 10000), man = wan % 10000, out = [];
    if (eok) out.push(nf(eok) + "억");
    if (man) out.push(nf(man) + "만");
    return out.join(" ") + "원";
  }

  function $(id) { return document.getElementById(id); }

  /* ---------- 안내 문구 (축1: 오류가 아니라 안내 / 철칙 5: 조용한 실패 금지) ---------- */
  function guide(msg, isWarn) {
    var el = $("result-error");
    if (!el) return;
    el.textContent = msg;
    el.style.fontSize = "14px";
    // 안내는 회색, 실제 경고만 강조색 박스(.result 기본 스타일)로 남긴다
    el.style.color = isWarn ? "" : "var(--muted)";
    el.style.background = isWarn ? "" : "var(--bg)";
    el.style.borderColor = isWarn ? "" : "var(--line)";
    el.hidden = false;
  }
  function hideGuide() { var el = $("result-error"); if (el) el.hidden = true; }

  /* ---------- 입력 수집 (축3: 사용자가 만지는 값은 연봉 + 부양가족뿐) ---------- */
  function readInputs() {
    var salaryEl = $("annual-salary"), ntEl = $("non-taxable"), depEl = $("dependants");
    var nt = ntEl ? parseFloat(ntEl.value) || 0 : 0;
    var dep = depEl ? parseInt(depEl.value, 10) || 1 : 1;
    if (nt < 0) nt = 0;                                  // 비과세 0 미만 방어
    dep = Math.max(1, Math.min(MAX_DEP, dep));           // 부양가족 최소 1 / 표 상한 클램프
    return { raw: salaryEl ? String(salaryEl.value).trim() : "", nt: nt, dep: dep };
  }

  // 사용자가 실제로 입력한 값 (빈 칸은 NaN — 기본값 1 과 구분한다)
  function depRaw() {
    var el = $("dependants");
    var s = el ? String(el.value).trim() : "";
    return s === "" ? NaN : parseInt(s, 10);
  }

  // 부양가족 입력의 클램프를 조용히 하지 않는다 — 왜 그 값으로 계산했는지 알린다.
  // 주의: 값을 클램프한 "뒤"에 읽으면 안내가 사라진다. 반드시 클램프 전의 raw 를 넘길 것.
  function updateDepNote(raw) {
    var note = $("dep-note");
    if (!note) return;
    if (isFinite(raw) && raw > MAX_DEP) {
      note.textContent = "간이세액표 근사치는 부양가족 " + MAX_DEP + "명까지 구분합니다. " + MAX_DEP + "명 기준으로 계산했습니다.";
      note.hidden = false;
    } else if (isFinite(raw) && raw < 1) {
      note.textContent = "부양가족은 본인 포함 최소 1명입니다. 1명 기준으로 계산했습니다.";
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }

  function updateDepButtons() {
    var el = $("dependants");
    if (!el) return;
    var cur = parseInt(el.value, 10);
    if (!isFinite(cur)) cur = 1;
    [["dep-minus", cur <= 1], ["dep-plus", cur >= MAX_DEP]].forEach(function (p) {
      var b = $(p[0]);
      if (!b) return;
      b.disabled = p[1];
      b.style.opacity = p[1] ? "0.4" : "1";
      b.style.cursor = p[1] ? "not-allowed" : "pointer";
    });
  }

  function stepDep(delta) {
    var el = $("dependants");
    if (!el) return;
    var cur = parseInt(el.value, 10);
    if (!isFinite(cur)) cur = 1;
    el.value = Math.max(1, Math.min(MAX_DEP, cur + delta));
    updateDepNote(NaN); // 스텝퍼는 항상 유효 범위 — 안내 불필요
    updateDepButtons();
    onCalc();
  }

  // 연봉 프리셋 활성 표시 (축2)
  function updatePresets(wan) {
    var btns = document.querySelectorAll(".salary-preset");
    for (var i = 0; i < btns.length; i++) {
      var on = parseFloat(btns[i].getAttribute("data-salary")) === wan;
      btns[i].setAttribute("aria-pressed", on ? "true" : "false");
      btns[i].style.background = on ? "var(--accent)" : "var(--bg)";
      btns[i].style.color = on ? "#fff" : "var(--ink)";
      btns[i].style.borderColor = on ? "var(--accent)" : "var(--line)";
    }
  }

  /* ---------- 렌더 ---------- */
  function render(wan, v, r) {
    var res = $("result");
    if (!res) return;

    var echo = $("salary-echo");
    if (echo) {
      var ko = wanToKo(wan);
      echo.textContent = (ko ? ko + " · " : "") + "세전 월 " + fmt(r.grossMonthly);
      echo.hidden = false;
    }

    $("res-monthly").textContent = fmt(r.netMonthly);
    $("res-annual").textContent = fmt(r.netAnnual);
    $("d-pension").textContent = fmt(r.pension);
    $("d-health").textContent = fmt(r.health + r.ltc);
    $("d-employ").textContent = fmt(r.employ);
    $("d-income").textContent = fmt(r.incomeTax);
    $("d-local").textContent = fmt(r.localTax);
    $("d-total").textContent = fmt(r.totalDeduction);

    // 실효 공제율 해설 + 막대 (축2: 결과 해설·시각화 — 막대는 aria-hidden, 문장이 대체 텍스트)
    var dedRatio = r.grossMonthly > 0 ? r.totalDeduction / r.grossMonthly : 0;
    var netRatio = 1 - dedRatio;
    if ($("bar-net")) $("bar-net").style.width = (netRatio * 100).toFixed(1) + "%";
    if ($("bar-ded")) $("bar-ded").style.width = (dedRatio * 100).toFixed(1) + "%";
    if ($("explain")) {
      $("explain").textContent = "세전 월급의 " + pct(netRatio) + "를 실수령하고, " +
        pct(dedRatio) + "(" + fmt(r.totalDeduction) + ")가 공제됩니다.";
    }

    // 맥락 인사이트 — 지금 이 결과에 해당할 때만 (장식 아님)
    var ins = $("insight");
    if (ins) {
      var msg = "";
      if (r.taxableMonthly > RATES.pension_cap) {
        msg = "국민연금은 기준소득 상한(월 590만원)이 있어, 연봉이 더 올라도 보험료는 월 " +
          fmt(Math.floor(RATES.pension_cap * RATES.pension)) + "에서 멈춥니다.";
      } else if (v.nt < 200000) {
        msg = "식대 비과세는 월 20만원까지 인정됩니다. 식대를 받고 있다면 '상세 조정'에서 비과세액을 올려보세요.";
      }
      ins.textContent = msg;
      ins.hidden = !msg;
    }

    updatePresets(wan);
    res.hidden = false;
  }

  function hideResult() {
    if ($("result")) $("result").hidden = true;
    if ($("salary-echo")) $("salary-echo").hidden = true;
    updatePresets(NaN);
  }

  /* ---------- 상태 저장: localStorage + URL 파라미터 (축1: 결과 링크 공유) ---------- */
  var urlTimer = null;
  function persist(wan, v) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        annualWan: wan,
        nonTaxable: v.nt,
        dependants: v.dep
      }));
    } catch (e) { /* private mode */ }

    if (urlTimer) clearTimeout(urlTimer);
    urlTimer = setTimeout(function () {
      try {
        var p = new URLSearchParams();
        p.set("salary", String(wan));
        p.set("dep", String(v.dep));
        p.set("nt", String(v.nt));
        history.replaceState(null, "", location.pathname + "?" + p.toString());
      } catch (e) { /* history 미지원 환경 — 계산에는 영향 없음 */ }
    }, 500);
  }

  /* ---------- 메인 ---------- */
  function onCalc() {
    var v = readInputs();
    var wan = parseFloat(v.raw);

    // 빈 입력 / 0 / 음수 / 비정상 값 → 안내 후 계산 미실행
    if (!v.raw || !isFinite(wan) || wan <= 0) {
      hideResult();
      guide("연봉을 입력하세요. (예: 4000 → 4,000만원)", false);
      return;
    }
    // 극단값: 50억 = 50만 만원
    if (wan > MAX_WAN) {
      hideResult();
      guide("지원 범위를 초과했습니다. 연봉은 50억원(50만 만원) 이하로 입력해 주세요.", true);
      return;
    }

    var result = calcSalary(wan, v.nt, v.dep);

    // 비과세 클리핑 경고 (결과와 함께 표시)
    if (result.nonTaxClipped) {
      guide("비과세액이 월급여를 초과해 월급여 한도로 자동 조정되었습니다.", true);
    } else {
      hideGuide();
    }

    render(wan, v, result);
    persist(wan, v);
  }

  /* ---------- 비과세액: 선택형 + 직접 입력 (축3: 변동값은 고르게) ---------- */
  function syncNonTaxable() {
    var sel = $("non-taxable-preset"), inp = $("non-taxable");
    if (!sel || !inp) return;
    if (sel.value === "custom") {
      inp.hidden = false;
      try { inp.focus(); } catch (e) { /* noop */ }
    } else {
      inp.hidden = true;
      inp.value = sel.value;
    }
    onCalc();
  }

  /* ---------- 저장된 상태 복원: URL > localStorage > 기본값 ---------- */
  (function restoreState() {
    var st = {};
    try {
      var sp = new URLSearchParams(location.search);
      if (sp.get("salary")) st.annualWan = parseFloat(sp.get("salary"));
      if (sp.get("dep")) st.dependants = parseInt(sp.get("dep"), 10);
      if (sp.get("nt")) st.nonTaxable = parseFloat(sp.get("nt"));
    } catch (e) { /* noop */ }

    if (st.annualWan == null) {
      try {
        var saved = localStorage.getItem(LS_KEY);
        if (saved) {
          var p = JSON.parse(saved);
          if (p.annualWan) st.annualWan = p.annualWan;
          if (st.dependants == null && p.dependants) st.dependants = p.dependants;
          if (st.nonTaxable == null && p.nonTaxable != null) st.nonTaxable = p.nonTaxable;
        }
      } catch (e) { /* noop */ }
    }

    var salaryEl = $("annual-salary"), depEl = $("dependants"),
        ntEl = $("non-taxable"), ntSel = $("non-taxable-preset");
    if (salaryEl && st.annualWan && isFinite(st.annualWan)) salaryEl.value = st.annualWan;
    if (depEl && st.dependants && isFinite(st.dependants)) {
      depEl.value = Math.max(1, Math.min(MAX_DEP, st.dependants));
    }
    if (ntEl && ntSel && st.nonTaxable != null && isFinite(st.nonTaxable) && st.nonTaxable >= 0) {
      ntEl.value = st.nonTaxable;
      if (NT_PRESETS.indexOf(st.nonTaxable) >= 0) {
        ntSel.value = String(st.nonTaxable);
        ntEl.hidden = true;
      } else {
        // 프리셋에 없는 값 → 직접 입력으로 두고, 사용자가 바로 알아보도록 상세 조정을 펼친다
        ntSel.value = "custom";
        ntEl.hidden = false;
        if ($("advanced")) $("advanced").open = true;
      }
    }
  })();

  /* ---------- 이벤트 바인딩 (축1: 버튼 없이 입력 즉시 계산) ---------- */
  ["annual-salary", "non-taxable", "dependants"].forEach(function (id) {
    var el = $(id);
    if (el) el.addEventListener("input", onCalc);
  });

  var depEl = $("dependants");
  if (depEl) {
    depEl.addEventListener("input", function () { updateDepNote(depRaw()); updateDepButtons(); });
    depEl.addEventListener("change", function () {
      var raw = depRaw();                                // 클램프 전에 원래 입력을 기억한다
      var cur = isFinite(raw) ? raw : 1;
      depEl.value = Math.max(1, Math.min(MAX_DEP, cur)); // 포커스를 벗어날 때 실제 값으로 정렬
      updateDepNote(raw);                                // 정렬했더라도 왜 바뀌었는지 계속 알린다
      updateDepButtons();
      onCalc();
    });
  }
  if ($("dep-minus")) $("dep-minus").addEventListener("click", function () { stepDep(-1); });
  if ($("dep-plus")) $("dep-plus").addEventListener("click", function () { stepDep(1); });
  if ($("non-taxable-preset")) $("non-taxable-preset").addEventListener("change", syncNonTaxable);

  var presetBtns = document.querySelectorAll(".salary-preset");
  for (var i = 0; i < presetBtns.length; i++) {
    presetBtns[i].addEventListener("click", function () {
      var el = $("annual-salary");
      if (!el) return;
      el.value = this.getAttribute("data-salary");
      onCalc();
    });
  }

  // 결과 1탭 복사 (축1) — 복사 실패도 조용히 넘기지 않는다
  var copyBtn = $("copy-monthly");
  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      var el = $("res-monthly"), hint = $("copy-hint");
      var val = el ? el.textContent : "";
      if (!val || val === "—") return;
      function say(msg) {
        if (!hint) return;
        hint.textContent = msg;
        setTimeout(function () { hint.textContent = "탭하면 복사"; }, 1500);
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(val).then(
            function () { say("복사됨 ✓"); },
            function () { say("복사할 수 없습니다 — 길게 눌러 선택하세요"); }
          );
        } else {
          say("복사할 수 없습니다 — 길게 눌러 선택하세요");
        }
      } catch (e) {
        say("복사할 수 없습니다 — 길게 눌러 선택하세요");
      }
    });
  }

  // 초기 렌더 — 복원된 값이 있으면 즉시 결과, 없으면 안내 문구
  updateDepNote(depRaw());
  updateDepButtons();
  onCalc();
  // TOOLJS:END
})();
