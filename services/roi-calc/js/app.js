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
  // ROI Calculator — cagr-calc 엔진 재사용 파생(variant). 코어(computeCagr·periodFromDates·
  // buildSchedule·parseAmount·Intl 포매터·통화감지·엣지가드)는 부모와 동일. delta:
  //  ① 주 지표 = ROI 총수익률(ratio−1) ② 보유기간 선택(optional) ③ cost/return 라벨
  //  ④ 연환산 ROI = computeCagr(cost,ret,n).cagr (CAGR 과 수학적으로 동일). 외부 API 0.
  var cfg = window.APP_CONFIG || {};
  var LS_KEY = (cfg.slug || "roi-calc") + ":last";
  var SAFE = Number.MAX_SAFE_INTEGER;
  var LIM = { value: 1e15, years: 10000, schedRows: 50 };

  var CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CNY", "KRW", "INR", "BRL", "RUB",
    "IDR", "CAD", "AUD", "CHF", "HKD", "SGD", "TWD", "MXN", "ZAR", "TRY", "SEK"];
  var REGION_CCY = { US: "USD", GB: "GBP", JP: "JPY", CN: "CNY", HK: "HKD", TW: "TWD",
    KR: "KRW", IN: "INR", BR: "BRL", RU: "RUB", ID: "IDR", CA: "CAD", AU: "AUD",
    CH: "CHF", SG: "SGD", MX: "MXN", ZA: "ZAR", TR: "TRY", SE: "SEK",
    DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", PT: "EUR", IE: "EUR", AT: "EUR", FI: "EUR" };
  var LANG_CCY = { ko: "KRW", ja: "JPY", zh: "CNY", de: "EUR", fr: "EUR", es: "EUR",
    pt: "BRL", ru: "RUB", id: "IDR", hi: "INR", bn: "BDT", ar: "USD", ur: "PKR", en: "USD" };

  function $(id) { return document.getElementById(id); }
  var costEl = $("cost-input"), retEl = $("ret-input"), yearsEl = $("years-input");
  var startEl = $("start-date"), endEl = $("end-date"), curSel = $("currency-select");
  var calcBtn = $("calc-btn");
  var yearsField = $("years-field"), datesField = $("dates-field");
  var box = $("result-box"), errEl = $("result-error"), bodyEl = $("result-body");
  if (!costEl || !retEl || !curSel || !calcBtn || !box) return;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function fmtLocale() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) || navigator.language || "en";
  }
  function radioVal(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }
  function setRadio(name, value) {
    var el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (el) el.checked = true;
  }
  // 유한화 가드 — Infinity/NaN 을 안전한 유한값으로 (지수표기 방지·조용한 실패 방지)
  function safe(v) {
    if (typeof v !== "number") return 0;
    if (isNaN(v)) return 0;
    if (v === Infinity) return SAFE;
    if (v === -Infinity) return -SAFE;
    if (v > SAFE) return SAFE;
    if (v < -SAFE) return -SAFE;
    return v;
  }

  // ── 금액 입력: 콤마 그룹핑 자동 포맷 · 파싱(소수점=".") ──
  function parseAmount(el) {
    if (!el) return null;
    var raw = String(el.value);
    var neg = raw.trim().charAt(0) === "-";
    var s = raw.replace(/[^0-9.]/g, "");
    var fd = s.indexOf(".");
    if (fd !== -1) s = s.slice(0, fd + 1) + s.slice(fd + 1).replace(/\./g, "");
    if (s === "" || s === ".") return null;
    var v = Number((neg ? "-" : "") + s);
    return isFinite(v) ? v : null;
  }
  function reformatAmount(el) {
    var raw = el.value;
    var caret = el.selectionStart == null ? raw.length : el.selectionStart;
    var digitsBefore = (raw.slice(0, caret).match(/[0-9]/g) || []).length;
    var neg = raw.trim().charAt(0) === "-";
    var cleaned = raw.replace(/[^0-9.]/g, "");
    var fd = cleaned.indexOf(".");
    if (fd !== -1) cleaned = cleaned.slice(0, fd + 1) + cleaned.slice(fd + 1).replace(/\./g, "");
    var segs = cleaned.split(".");
    var intPart = segs[0].replace(/^0+(?=\d)/, "");
    var grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var out = (neg ? "-" : "") + grouped + (segs.length > 1 ? "." + segs[1] : "");
    if (out !== raw) {
      el.value = out;
      var pos = neg ? 1 : 0, seen = 0;
      while (pos < out.length && seen < digitsBefore) {
        if (/[0-9]/.test(out.charAt(pos))) seen++;
        pos++;
      }
      try { el.setSelectionRange(pos, pos); } catch (e) { /* noop */ }
    }
  }
  function num(el) {
    if (!el) return null;
    var v = el.valueAsNumber;
    if (isNaN(v)) { var s = String(el.value).trim().replace(",", "."); v = (s === "") ? NaN : Number(s); }
    return isNaN(v) ? null : v;
  }

  // ── Intl 포매팅 (하드코딩 없음 — 통화·천단위·소수 전부 Intl 위임, 지수표기 금지) ──
  function nf(opts) { try { return new Intl.NumberFormat(fmtLocale(), opts); } catch (e) { return new Intl.NumberFormat("en", opts); } }
  function cyDec(cur) { try { return nf({ style: "currency", currency: cur }).resolvedOptions().maximumFractionDigits; } catch (e) { return 2; } }
  function money(v, cur) {
    var d = cyDec(cur);
    try { return nf({ style: "currency", currency: cur, minimumFractionDigits: d, maximumFractionDigits: d }).format(safe(v)); }
    catch (e) { return String(safe(v)); }
  }
  function moneySigned(v, cur) { var base = money(v, cur); return v > 0 ? "+" + base : base; }
  function numFmt(v, maxdec) { return nf({ maximumFractionDigits: maxdec == null ? 4 : maxdec }).format(safe(v)); }
  function pctFmt(frac, withSign) {
    var x = safe(frac * 100);
    var s = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x) + "%";
    return (withSign && x > 0) ? "+" + s : s;
  }
  function multFmt(v) { return nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safe(v)) + "×"; }

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상, Math·Intl 외 DOM 의존 없음)
  // ratio = ret/cost · ROI(총수익률) = ratio−1 · 순이익 = ret−cost · 회수배수 = ratio
  // 연환산 ROI = ratio^(1/n)−1 (= CAGR). 부모 cagr-calc computeCagr 와 동일한 코어.
  function computeCagr(cost, ret, n) {
    var clipped = false;
    if (cost > LIM.value) { cost = LIM.value; clipped = true; }
    if (ret > LIM.value) { ret = LIM.value; clipped = true; }
    if (n > LIM.years) { n = LIM.years; clipped = true; }
    var ratio = ret / cost;
    var cagr = Math.pow(ratio, 1 / n) - 1;   // ret=0 → 0^(1/n)−1 = −1 (−100%, 전액 손실)
    return {
      ok: true, clipped: clipped, cost: cost, ret: ret, n: n,
      ratio: ratio, cagr: cagr, roi: ratio - 1,
      netProfit: ret - cost, multiple: ratio
    };
  }
  // 날짜 → 연수: (일수)/365.25 (윤년 평균 보정). 통화·로케일 무관 순수함수.
  function periodFromDates(d0, d1) {
    if (!d0 || !d1) return { ok: false, reason: "empty" };
    var t0 = Date.parse(d0 + "T00:00:00Z"), t1 = Date.parse(d1 + "T00:00:00Z");
    if (isNaN(t0) || isNaN(t1)) return { ok: false, reason: "empty" };
    if (t1 <= t0) return { ok: false, reason: "order" };
    var days = (t1 - t0) / 86400000;
    return { ok: true, n: days / 365.25, days: days };
  }
  // 연도별 스케줄: k=1..floor(n) → cost·(1+연환산ROI)^k, 마지막 행은 정확한 n → ret 로 마감
  function buildSchedule(cost, cagr, n, ret, maxRows) {
    var rows = [], full = Math.floor(n), truncated = false, lim = full, i;
    if (full > maxRows) { lim = maxRows; truncated = true; }
    for (i = 1; i <= lim; i++) rows.push({ year: i, value: cost * Math.pow(1 + cagr, i) });
    if (n > full) {
      rows.push({ year: n, value: ret, fractional: true });       // 소수 기간: 정확한 n 으로 마감
    } else if (truncated) {
      rows.push({ year: full, value: ret, fractional: false });   // 정수 n·절삭: 마지막 정확행 보존
    } else if (rows.length) {
      rows[rows.length - 1].value = ret;                           // 정수 n: 부동소수 드리프트 제거
    }
    return { rows: rows, truncated: truncated };
  }
  // 보유기간 판정: optional — 빈 입력(empty)/무효(invalid)/유효(ok) 3-상태.
  function resolvePeriod(mode) {
    if (mode === "years") {
      var yv = num(yearsEl);
      if (yv == null) return { status: "empty", msgKey: "tool.result.noPeriod", msgFallback: "Add a holding period to see annualized ROI." };
      if (yv <= 0) return { status: "invalid", msgKey: "tool.err.period", msgFallback: "Enter a holding period greater than 0 for annualized ROI." };
      return { status: "ok", n: yv, days: null };
    }
    if (!startEl.value || !endEl.value) return { status: "empty", msgKey: "tool.result.noPeriod", msgFallback: "Add a holding period to see annualized ROI." };
    var pr = periodFromDates(startEl.value, endEl.value);
    if (!pr.ok) {
      if (pr.reason === "order") return { status: "invalid", msgKey: "tool.err.dateOrder", msgFallback: "End date must be after the start date." };
      return { status: "empty", msgKey: "tool.result.noPeriod", msgFallback: "Add a holding period to see annualized ROI." };
    }
    return { status: "ok", n: pr.n, days: pr.days };
  }
  // calc-core:end

  // ── 통화 셀렉터 ──
  function detectCurrency() {
    var langs = navigator.languages || [navigator.language || ""];
    for (var i = 0; i < langs.length; i++) {
      var parts = String(langs[i]).split("-");
      if (parts.length > 1) {
        var region = parts[parts.length - 1].toUpperCase();
        if (REGION_CCY[region]) return REGION_CCY[region];
      }
    }
    var primary = String(langs[0] || "en").split("-")[0].toLowerCase();
    return LANG_CCY[primary] || "USD";
  }
  function curSymbol(cur) {
    try {
      var parts = nf({ style: "currency", currency: cur }).formatToParts(0);
      for (var i = 0; i < parts.length; i++) if (parts[i].type === "currency") return parts[i].value;
    } catch (e) { /* noop */ }
    return cur;
  }
  function fillCurrencies(selected) {
    var list = CURRENCIES.slice();
    if (list.indexOf(selected) === -1) list.unshift(selected);
    curSel.innerHTML = "";
    for (var i = 0; i < list.length; i++) {
      var opt = document.createElement("option");
      opt.value = list[i];
      opt.textContent = list[i] + " (" + curSymbol(list[i]) + ")";
      curSel.appendChild(opt);
    }
    curSel.value = selected;
  }

  var lastRun = false;
  function showNotice(key, fallback) {
    box.hidden = false; bodyEl.hidden = true; errEl.hidden = false;
    errEl.textContent = t(key, fallback);
  }

  function calculate() {
    lastRun = true;
    var cur = curSel.value || "USD";
    var mode = radioVal("periodmode") || "years";
    var cost = parseAmount(costEl), ret = parseAmount(retEl);
    persist(cur);
    updateChips(num(yearsEl));

    // 엣지케이스(철칙 5 — 전부 명시 처리). cost/ret 은 필수, 기간은 선택.
    if (cost == null || ret == null) return showNotice("tool.err.empty", "Enter the amount invested and the amount returned.");
    if (cost <= 0) return showNotice("tool.err.cost", "Amount invested must be greater than 0.");
    if (ret < 0) return showNotice("tool.err.retNeg", "Amount returned can't be negative.");

    var period = resolvePeriod(mode);
    var nBase = period.status === "ok" ? period.n : 1;   // 기간 무효/빈값이면 n 은 ROI/순이익/배수에 영향 없음
    var r = computeCagr(cost, ret, nBase);

    errEl.hidden = true; bodyEl.hidden = false; box.hidden = false;

    // 주 지표: ROI(총수익률) · 순이익 · 회수배수 — 기간과 무관하게 항상 산출
    var roiEl = $("r-roi");
    roiEl.textContent = pctFmt(r.roi, true);
    roiEl.className = "rc-val " + (r.roi >= 0 ? "pl-pos" : "pl-neg");
    var profEl = $("r-profit");
    profEl.textContent = moneySigned(r.netProfit, cur);
    profEl.className = "rc-val " + (r.netProfit >= 0 ? "pl-pos" : "pl-neg");
    $("r-mult").textContent = multFmt(r.multiple);

    $("r-sub").textContent = t("tool.result.sub", "Invested {cost}, got back {ret}.")
      .replace("{cost}", money(r.cost, cur)).replace("{ret}", money(r.ret, cur));

    var lossEl = $("r-loss");
    if (r.ret === 0) {
      lossEl.hidden = false;
      lossEl.textContent = t("tool.result.totalLoss", "The amount returned is 0 — a total loss, shown as −100%.");
    } else { lossEl.hidden = true; }

    var annualCard = $("annual-card"), annualEl = $("r-annual");
    var daysEl = $("r-days"), noteEl = $("period-note"), schedWrap = $("sched-wrap");

    if (period.status === "ok") {
      // 연환산 ROI 카드 + 접이식 성장표 (기간 유효 시에만)
      annualCard.hidden = false;
      annualEl.textContent = pctFmt(r.cagr, true);
      annualEl.className = "rc-val " + (r.cagr >= 0 ? "pl-pos" : "pl-neg");
      noteEl.hidden = true;

      if (mode === "dates" && period.days != null) {
        daysEl.hidden = false;
        daysEl.textContent = t("tool.result.daysNote", "{days} days between your dates ÷ 365.25 = {n} years.")
          .replace("{days}", numFmt(period.days, 0)).replace("{n}", numFmt(r.n, 4));
      } else { daysEl.hidden = true; }

      schedWrap.hidden = false;
      var sc = buildSchedule(r.cost, r.cagr, r.n, r.ret, LIM.schedRows);
      var tbody = $("sched-body"); tbody.innerHTML = "";
      for (var i = 0; i < sc.rows.length; i++) {
        var tr = document.createElement("tr");
        var td1 = document.createElement("td");
        td1.textContent = sc.rows[i].fractional ? numFmt(sc.rows[i].year, 2) : numFmt(sc.rows[i].year, 0);
        var td2 = document.createElement("td");
        td2.textContent = money(sc.rows[i].value, cur);
        tr.appendChild(td1); tr.appendChild(td2); tbody.appendChild(tr);
      }
      var trunc = $("sched-trunc");
      if (sc.truncated) {
        trunc.hidden = false;
        trunc.textContent = t("tool.sched.truncated", "Showing the first {n} years.").replace("{n}", numFmt(LIM.schedRows, 0));
      } else { trunc.hidden = true; }
    } else {
      // 기간 빈값/무효 — ROI 등은 유지, 연환산·성장표만 숨기고 안내
      annualCard.hidden = true;
      schedWrap.hidden = true;
      daysEl.hidden = true;
      noteEl.hidden = false;
      noteEl.textContent = t(period.msgKey, period.msgFallback);
    }

    $("r-clipped").hidden = !r.clipped;
  }

  function updateChips(yv) {
    var chips = document.querySelectorAll("#year-chips .chip");
    for (var i = 0; i < chips.length; i++) {
      var dv = Number(chips[i].getAttribute("data-years"));
      chips[i].classList.toggle("is-active", yv != null && dv === yv);
    }
  }

  function persist(cur) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        cost: costEl.value, ret: retEl.value, mode: radioVal("periodmode"),
        years: yearsEl.value, d0: startEl.value, d1: endEl.value, currency: cur
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }
  }

  function syncPeriodFields() {
    var mode = radioVal("periodmode") || "years";
    yearsField.hidden = mode !== "years";
    datesField.hidden = mode !== "dates";
  }

  // ── 초기화 · 복원 (상태는 프로세스 밖 — 철칙 1) ──
  (function init() {
    var saved = null;
    try { var s = localStorage.getItem(LS_KEY); if (s) saved = JSON.parse(s); } catch (e) { saved = null; }
    var startCur = (saved && saved.currency) || detectCurrency();
    fillCurrencies(startCur);
    if (saved) {
      if (saved.cost) costEl.value = saved.cost;
      if (saved.ret) retEl.value = saved.ret;
      if (saved.years) yearsEl.value = saved.years;
      if (saved.d0) startEl.value = saved.d0;
      if (saved.d1) endEl.value = saved.d1;
      if (saved.mode === "dates" || saved.mode === "years") setRadio("periodmode", saved.mode);
    }
    syncPeriodFields();
    var ready = parseAmount(costEl) != null && parseAmount(retEl) != null;
    if (ready) calculate(); else updateChips(num(yearsEl));
  })();

  // ── 이벤트 배선: 실시간 재계산(oninput) + Enter ──
  function onAmountInput(e) { reformatAmount(e.target); calculate(); }
  costEl.addEventListener("input", onAmountInput);
  retEl.addEventListener("input", onAmountInput);
  yearsEl.addEventListener("input", calculate);
  startEl.addEventListener("input", calculate);
  endEl.addEventListener("input", calculate);
  curSel.addEventListener("change", calculate);
  var modeRadios = document.querySelectorAll('input[name="periodmode"]');
  for (var mr = 0; mr < modeRadios.length; mr++) modeRadios[mr].addEventListener("change", function () { syncPeriodFields(); calculate(); });
  var yearChips = document.querySelectorAll("#year-chips .chip");
  for (var yc = 0; yc < yearChips.length; yc++) {
    yearChips[yc].addEventListener("click", function () { yearsEl.value = this.getAttribute("data-years"); calculate(); });
  }
  calcBtn.addEventListener("click", calculate);
  function onEnter(e) { if (e.key === "Enter") calculate(); }
  [costEl, retEl, yearsEl, startEl, endEl].forEach(function (el) { el.addEventListener("keydown", onEnter); });

  // ── 언어 전환: 통화기호·동적 문구·Intl 포맷을 새 로케일로 재렌더 ──
  document.addEventListener("i18n:change", function () {
    fillCurrencies(curSel.value);
    if (lastRun && !box.hidden) calculate();
  });
  // TOOLJS:END
})();
