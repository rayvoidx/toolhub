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

  // Cloudflare Web Analytics — 쿠키리스·페이지뷰만. 토큰 설정 시에만 로드.
  // 실패해도 본 기능에 영향 없게 격리 (safeTrack 원칙 — 부가 기능은 본 기능과 격리, 철칙 5)
  // 수집 범위는 privacy.html §3 과 일치해야 한다. 도구 입력값은 절대 실리지 않는다(§1 약속).
  if (cfg.analytics && cfg.analytics.cfBeaconToken) {
    try {
      var s = document.createElement("script");
      s.defer = true;
      s.src = "https://static.cloudflareinsights.com/beacon.min.js";
      s.setAttribute("data-cf-beacon", JSON.stringify({ token: cfg.analytics.cfBeaconToken }));
      document.head.appendChild(s);
    } catch (e) { /* 분석 실패는 조용히 무시 — 본 기능에 영향 없음 */ }
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
  var LS_KEY = (cfg.slug || "retirement-calc") + ":last";
  var MAX = Number.MAX_SAFE_INTEGER; // 지수표기 방지 — 이 값 초과/비유한 시 클램프
  var LIM = {
    ageMin: 15, ageMax: 90, retireMax: 100,
    savingsMax: 1e12, monthlyMax: 1e9,
    returnMax: 15, inflMax: 20,
    wrateMin: 2, wrateMax: 10, schedRows: 60
  };
  var WRATE_DEFAULT = 4;

  function $(id) { return document.getElementById(id); }
  var ageEl = $("age-input"), retireEl = $("retire-input"), savingsEl = $("savings-input");
  var monthlyEl = $("monthly-input"), returnEl = $("return-input"), inflEl = $("infl-input");
  var wrateEl = $("wrate-input"), calcBtn = $("calc-btn");
  var box = $("result-box"), errEl = $("result-error"), bodyEl = $("result-body");
  var badgeEl = $("r-badge"), nestEl = $("r-nestegg"), subEl = $("r-sub");
  var safeAnnualEl = $("r-safeannual"), safeMonthlyEl = $("r-safemonthly");
  var contribEl = $("r-contrib"), growthEl = $("r-growth");
  var barContribEl = $("r-bar-contrib"), barGrowthEl = $("r-bar-growth");
  var barContribPctEl = $("r-bar-contrib-pct"), barGrowthPctEl = $("r-bar-growth-pct");
  var schedBody = $("sched-body"), schedTrunc = $("sched-trunc");
  var returnClampEl = $("r-returnclamp"), inflClampEl = $("r-inflclamp"), wrateClampEl = $("r-wrateclamp");
  var clippedEl = $("r-clipped"), ageOrderNote = null;
  if (!ageEl || !retireEl || !savingsEl || !returnEl || !calcBtn || !box) return;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function digitsOnly(s) { return String(s).replace(/[^\d]/g, ""); }
  function groupInput(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  // 결과 표시용 — 천단위는 Intl 에 위임(현재 언어), 지수표기 없음, 비유한/초과 클램프
  function fmt(n) {
    if (!isFinite(n)) n = MAX;
    if (n > MAX) n = MAX;
    if (n < -MAX) n = -MAX;
    var v = Math.round(n);
    try { return new Intl.NumberFormat(uiLang(), { maximumFractionDigits: 0, useGrouping: true }).format(v); }
    catch (e) { return new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(v); }
  }
  function fmtPct1(p) {
    try { return new Intl.NumberFormat(uiLang(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(p) + "%"; }
    catch (e) { return p.toFixed(1) + "%"; }
  }
  function radioVal(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }
  function setRadio(name, value) {
    var el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (el) el.checked = true;
  }

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상, Math 외 의존 없음)
  // 월초 납입 annuity-due FV — dca-calc/investment-goal-calc 성장엔진 재사용.
  // m=0(무성장) 은 0-division 을 피해 단순 합산으로 분기.
  function futureValue(initial, monthly, m, n) {
    if (m === 0) return initial + monthly * n;
    var growth = Math.pow(1 + m, n);
    return initial * growth + monthly * (1 + m) * (growth - 1) / m;
  }
  // 명목수익률·물가상승률로 실질수익률 산출: (1+명목/100)/(1+물가/100) − 1, 퍼센트로 환산.
  // 물가=0 이면 실질=명목(조정 없음).
  function realReturnPct(nominalPct, inflPct) {
    return ((1 + nominalPct / 100) / (1 + inflPct / 100) - 1) * 100;
  }
  // 나이→년수 은퇴 투영 코어. mode="real" 이면 실질수익률로 전액을 오늘 구매력 기준으로 계산
  // (매월 납입액도 물가만큼 매년 오른다고 가정 — coast-fire-calc 류 실질수익률 모델과 동일 전제).
  function computeRetirement(o) {
    var years = o.retireAge - o.age;                 // 호출부에서 years>0 보장
    var rate = o.mode === "real" ? realReturnPct(o.nominalReturn, o.inflation) : o.nominalReturn;
    var m = rate / 1200;
    var n = years * 12;
    var nestEggRaw = futureValue(o.savings, o.monthly, m, n);
    var clamped = false;
    var nestEgg = Math.floor(nestEggRaw);
    if (!isFinite(nestEgg) || nestEgg > MAX) { nestEgg = MAX; clamped = true; }
    if (nestEgg < 0) nestEgg = 0;

    var totalContrib = Math.floor(o.savings + o.monthly * n);
    if (!isFinite(totalContrib) || totalContrib > MAX) { totalContrib = MAX; clamped = true; }
    if (totalContrib > nestEgg) totalContrib = nestEgg; // 방어 (수익률>=0 이므로 정상 경로에선 미발생)

    var growth = nestEgg - totalContrib;              // 시장 성장분 (contrib+growth=nestEgg 카드 합 일치)
    var growthShare = nestEgg > 0 ? (growth / nestEgg * 100) : 0;
    var contribShare = 100 - growthShare;

    var safeAnnual = nestEgg * (o.wrate / 100);        // 4% 룰(사용자 조정 가능) 안전 인출액
    var safeMonthly = safeAnnual / 12;

    return {
      years: years, rate: rate, nestEgg: nestEgg, totalContrib: totalContrib, growth: growth,
      growthShare: growthShare, contribShare: contribShare,
      safeAnnual: safeAnnual, safeMonthly: safeMonthly, clamped: clamped
    };
  }
  // 연도별 스케줄: k=1..years(캡 초과 시 절삭) → 그 시점까지의 누적 납입·잔액.
  function buildSchedule(initial, monthly, rate, years, capRows) {
    var m = rate / 1200, rows = [], truncated = false, lim = years, k;
    if (years > capRows) { lim = capRows; truncated = true; }
    for (k = 1; k <= lim; k++) {
      var n = k * 12;
      rows.push({
        year: k,
        contrib: Math.floor(initial + monthly * n),
        balance: Math.floor(futureValue(initial, monthly, m, n))
      });
    }
    return { rows: rows, truncated: truncated };
  }
  // calc-core:end

  var last = null; // 마지막 렌더 상태 (언어 전환 재렌더용 — 영속 상태는 localStorage 에만)

  function showError(key, fallback) {
    last = { kind: "error", key: key, fallback: fallback };
    box.hidden = false;
    bodyEl.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key, fallback);
  }

  function render(state) {
    last = { kind: "result", state: state };
    var res = state.res;
    errEl.hidden = true;
    bodyEl.hidden = false;
    box.hidden = false;

    if (state.mode === "real") {
      badgeEl.className = "badge real";
      badgeEl.textContent = t("tool.badge.real", "Today's dollars (real)");
    } else {
      badgeEl.className = "badge nominal";
      badgeEl.textContent = t("tool.badge.nominal", "Future dollars (nominal)");
    }

    nestEl.textContent = fmt(res.nestEgg);
    subEl.textContent = t("tool.result.sub", "{years} years to retirement · {rate}% annual return used")
      .replace("{years}", res.years)
      .replace("{rate}", fmtPct1(res.rate));

    safeAnnualEl.textContent = fmt(res.safeAnnual);
    safeMonthlyEl.textContent = fmt(res.safeMonthly);
    contribEl.textContent = fmt(res.totalContrib);
    growthEl.textContent = fmt(res.growth);

    var cPct = Math.max(0, Math.min(100, res.contribShare));
    var gPct = 100 - cPct;
    barContribEl.style.width = cPct + "%";
    barGrowthEl.style.width = gPct + "%";
    barContribPctEl.textContent = Math.round(cPct) + "%";
    barGrowthPctEl.textContent = Math.round(gPct) + "%";

    var tbody = schedBody; tbody.innerHTML = "";
    var age0 = state.age;
    for (var i = 0; i < state.sched.rows.length; i++) {
      var row = state.sched.rows[i];
      var tr = document.createElement("tr");
      var td1 = document.createElement("td"); td1.textContent = fmt(age0 + row.year);
      var td2 = document.createElement("td"); td2.textContent = fmt(row.contrib);
      var td3 = document.createElement("td"); td3.textContent = fmt(row.balance);
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
      tbody.appendChild(tr);
    }
    if (state.sched.truncated) {
      schedTrunc.hidden = false;
      schedTrunc.textContent = t("tool.sched.truncated", "Showing the first {n} years.").replace("{n}", fmt(LIM.schedRows));
    } else {
      schedTrunc.hidden = true;
    }

    returnClampEl.hidden = !state.returnClamped;
    inflClampEl.hidden = !state.inflClamped;
    wrateClampEl.hidden = !state.wrateClamped;
    clippedEl.hidden = !(res.clamped || state.clipped);
  }

  function calculate() {
    var clipped = false, returnClamped = false, inflClamped = false, wrateClamped = false;
    var mode = radioVal("dispmode") || "nominal";

    var ageDigits = digitsOnly(ageEl.value);
    var retireDigits = digitsOnly(retireEl.value);
    var savingsDigits = digitsOnly(savingsEl.value);
    var monthlyDigits = digitsOnly(monthlyEl.value);
    var returnRaw = returnEl.value.trim().replace(",", ".");
    var inflRaw = inflEl.value.trim().replace(",", ".");
    var wrateRaw = wrateEl.value.trim().replace(",", ".");

    // 1) 필수 누락 (조용한 실패 금지)
    if (ageDigits === "" || retireDigits === "" || savingsDigits === "") {
      showError("tool.err.missing", "Enter your current age, retirement age, and current savings.");
      return;
    }
    if (returnRaw === "" || isNaN(Number(returnRaw))) {
      showError("tool.err.return", "Enter an expected annual return, e.g. 7%.");
      return;
    }

    // 2) 나이 파싱·클램프 + 순서 검증
    var ageNum = Math.floor(Number(ageDigits));
    var retireNum = Math.floor(Number(retireDigits));
    if (ageNum < LIM.ageMin) { ageNum = LIM.ageMin; clipped = true; }
    if (ageNum > LIM.ageMax) { ageNum = LIM.ageMax; clipped = true; }
    if (retireNum > LIM.retireMax) { retireNum = LIM.retireMax; clipped = true; }
    if (retireNum <= ageNum) {
      showError("tool.err.ageOrder", "Retirement age must be greater than your current age.");
      return;
    }

    // 3) 저축·납입 (0 유효)
    var savingsNum = Number(savingsDigits);
    if (savingsNum > LIM.savingsMax) { savingsNum = LIM.savingsMax; clipped = true; }
    var monthlyNum = monthlyDigits === "" ? 0 : Number(monthlyDigits);
    if (monthlyNum > LIM.monthlyMax) { monthlyNum = LIM.monthlyMax; clipped = true; }

    // 4) 예상 명목수익률 — 음수는 미지원(0 클램프+안내), 상한 클램프, 0 은 유효(무성장)
    var returnNum = Number(returnRaw);
    if (returnNum < 0) { returnNum = 0; returnClamped = true; }
    if (returnNum > LIM.returnMax) { returnNum = LIM.returnMax; clipped = true; }

    // 5) 물가상승률 (실질 모드에서만 의미, 빈값=0)
    var inflNum = inflRaw === "" ? 0 : Number(inflRaw);
    if (isNaN(inflNum) || inflNum < 0) { inflNum = 0; inflClamped = true; }
    if (inflNum > LIM.inflMax) { inflNum = LIM.inflMax; clipped = true; }

    // 6) 안전 인출률 (빈값=기본 4%)
    var wrateNum;
    if (wrateRaw === "") {
      wrateNum = WRATE_DEFAULT;
    } else {
      wrateNum = Number(wrateRaw);
      if (isNaN(wrateNum) || wrateNum <= 0) { showError("tool.err.wrate", "Withdrawal rate must be greater than 0."); return; }
      if (wrateNum < LIM.wrateMin) { wrateNum = LIM.wrateMin; wrateClamped = true; }
      if (wrateNum > LIM.wrateMax) { wrateNum = LIM.wrateMax; wrateClamped = true; }
    }

    var res = computeRetirement({
      age: ageNum, retireAge: retireNum, savings: savingsNum, monthly: monthlyNum,
      nominalReturn: returnNum, inflation: inflNum, wrate: wrateNum, mode: mode
    });
    var sched = buildSchedule(savingsNum, monthlyNum, res.rate, res.years, LIM.schedRows);

    render({
      res: res, sched: sched, age: ageNum, mode: mode,
      returnClamped: returnClamped, inflClamped: inflClamped, wrateClamped: wrateClamped, clipped: clipped
    });

    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        age: ageNum, retire: retireNum, savings: savingsNum, monthly: monthlyNum,
        ret: returnNum, infl: inflNum, wrate: wrateNum, mode: mode
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }

    updateChips();
  }

  function formatAmount(el) {
    var d = digitsOnly(el.value);
    el.value = d === "" ? "" : groupInput(Number(d));
  }
  function markChips(sel, attr, raw) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) {
      var dv = els[i].getAttribute(attr);
      els[i].classList.toggle("is-active", raw !== "" && Number(dv) === Number(raw));
    }
  }
  function updateChips() {
    markChips("#return-chips .chip", "data-return", returnEl.value.trim().replace(",", "."));
    markChips("#infl-chips .chip", "data-infl", inflEl.value.trim().replace(",", "."));
    markChips("#wrate-chips .chip", "data-wrate", wrateEl.value.trim().replace(",", "."));
  }
  function wireChips(sel, attr, targetInput) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) {
      els[i].addEventListener("click", function () {
        targetInput.value = this.getAttribute(attr);
        calculate();
      });
    }
  }

  function syncModeUI() {
    var mode = radioVal("dispmode") || "nominal";
    var segBtns = document.querySelectorAll("#mode-seg .seg-btn");
    for (var i = 0; i < segBtns.length; i++) {
      var input = segBtns[i].querySelector("input");
      segBtns[i].classList.toggle("is-active", input && input.value === mode);
    }
    var inflField = $("infl-field");
    if (inflField) inflField.style.opacity = (mode === "real") ? "1" : ".55";
  }

  // 이벤트 배선 — 실시간 재계산 + Enter
  ageEl.addEventListener("input", calculate);
  retireEl.addEventListener("input", calculate);
  savingsEl.addEventListener("input", function () { formatAmount(savingsEl); calculate(); });
  monthlyEl.addEventListener("input", function () { formatAmount(monthlyEl); calculate(); });
  returnEl.addEventListener("input", calculate);
  inflEl.addEventListener("input", calculate);
  wrateEl.addEventListener("input", calculate);
  calcBtn.addEventListener("click", calculate);

  var modeRadios = document.querySelectorAll('input[name="dispmode"]');
  for (var mi = 0; mi < modeRadios.length; mi++) {
    modeRadios[mi].addEventListener("change", function () { syncModeUI(); calculate(); });
  }

  wireChips("#return-chips .chip", "data-return", returnEl);
  wireChips("#infl-chips .chip", "data-infl", inflEl);
  wireChips("#wrate-chips .chip", "data-wrate", wrateEl);

  function onEnter(e) { if (e.key === "Enter") calculate(); }
  var enterEls = [ageEl, retireEl, savingsEl, monthlyEl, returnEl, inflEl, wrateEl];
  for (var ei = 0; ei < enterEls.length; ei++) enterEls[ei].addEventListener("keydown", onEnter);

  // 마지막 입력값 복원 (localStorage — 서버 미전송)
  (function restore() {
    try {
      var s = localStorage.getItem(LS_KEY);
      if (!s) { syncModeUI(); return; }
      var p = JSON.parse(s);
      if (p.age != null) ageEl.value = p.age;
      if (p.retire != null) retireEl.value = p.retire;
      if (p.savings != null) savingsEl.value = groupInput(p.savings);
      if (p.monthly != null && p.monthly > 0) monthlyEl.value = groupInput(p.monthly);
      if (p.ret != null) returnEl.value = p.ret;
      if (p.infl != null && p.infl > 0) inflEl.value = p.infl;
      if (p.wrate != null) wrateEl.value = p.wrate;
      if (p.mode === "real" || p.mode === "nominal") setRadio("dispmode", p.mode);
      syncModeUI();
      if (p.age != null && p.retire != null && p.savings != null) calculate();
    } catch (e) { syncModeUI(); /* 접근 불가·파싱 실패 — 빈 폼으로 시작 */ }
  })();
  updateChips();

  // 언어 전환 시 동적 문구(금액·배지·서브라인·오류) 재렌더
  document.addEventListener("i18n:change", function () {
    if (!last) return;
    if (last.kind === "error") showError(last.key, last.fallback);
    else render(last.state);
  });
  // TOOLJS:END
})();
