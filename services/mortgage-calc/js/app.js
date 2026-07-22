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
  /* Mortgage Calculator — 표준 원리금균등상환(P&I) 공식 + 선택적 추가상환(extra) 반영 스케줄.
     상태: localStorage "<slug>:state" 만. 외부 API 없음, 모든 계산은 로컬. */

  var LIM = { value: 1e12, years: 50, rate: 30 };

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  // 월 상환액: M = P*r*(1+r)^n / ((1+r)^n - 1), r=0 이면 단순 균등분할.
  // extraMonthly > 0 이면 매월 원금에 추가 상환을 더해 잔액이 조기에 0에 도달하는 실제 스케줄을 만든다.
  function computeSchedule(principal, annualRatePct, termYears, extraMonthly) {
    var clipped = false;
    if (!(principal > 0)) principal = 0;
    if (principal > LIM.value) { principal = LIM.value; clipped = true; }
    if (!(annualRatePct >= 0)) annualRatePct = 0;
    if (annualRatePct > LIM.rate) { annualRatePct = LIM.rate; clipped = true; }
    if (!(termYears > 0)) termYears = 1 / 12;
    if (termYears > LIM.years) { termYears = LIM.years; clipped = true; }
    if (!(extraMonthly >= 0)) extraMonthly = 0;
    if (extraMonthly > LIM.value) { extraMonthly = LIM.value; clipped = true; }

    var n = Math.round(termYears * 12);
    if (n < 1) n = 1;
    var r = annualRatePct / 100 / 12;

    var payment;
    if (r === 0) {
      payment = principal / n;
    } else {
      var pow = Math.pow(1 + r, n);
      payment = principal * r * pow / (pow - 1);
    }
    if (!isFinite(payment) || isNaN(payment)) payment = principal / n;

    var totalInterestBase = payment * n - principal;
    if (!(totalInterestBase > 0)) totalInterestBase = 0;

    // 실제 스케줄(추가상환 반영) — 매달 원금분 = 정기상환액 - 이자분 + 추가상환액
    var schedule = [];
    var balance = principal;
    var totalInterestActual = 0;
    var month = 0;
    while (balance > 0.005 && month < n) {
      month++;
      var interestPortion = balance * r;
      var principalPortion = payment - interestPortion + extraMonthly;
      if (principalPortion > balance) principalPortion = balance;
      if (principalPortion < 0) principalPortion = 0;
      balance -= principalPortion;
      totalInterestActual += interestPortion;
      schedule.push({
        month: month,
        principal: principalPortion,
        interest: interestPortion,
        balance: balance < 0 ? 0 : balance
      });
    }
    if (balance > 0.005 && schedule.length) {
      var last = schedule[schedule.length - 1];
      last.principal += balance;
      last.balance = 0;
    }

    var payoffMonths = schedule.length;
    var interestSaved = totalInterestBase - totalInterestActual;
    if (!(interestSaved > 0)) interestSaved = 0;
    var monthsSaved = n - payoffMonths;
    if (!(monthsSaved > 0)) monthsSaved = 0;

    return {
      principal: principal, rate: annualRatePct, years: termYears,
      payment: payment, n: n,
      totalInterestBase: totalInterestBase, totalPaidBase: payment * n,
      schedule: schedule, payoffMonths: payoffMonths,
      totalInterestActual: totalInterestActual, totalPaidActual: principal + totalInterestActual,
      interestSaved: interestSaved, monthsSaved: monthsSaved,
      hasExtra: extraMonthly > 0, clipped: clipped
    };
  }
  // 월별 스케줄 → 연도별 합산(연 1행: 그 해 원금합/이자합, 연말 잔액)
  function buildAnnualSchedule(monthlySchedule) {
    var years = [];
    for (var i = 0; i < monthlySchedule.length; i++) {
      var yi = Math.floor(i / 12);
      if (!years[yi]) years[yi] = { period: yi + 1, principal: 0, interest: 0, balance: 0 };
      years[yi].principal += monthlySchedule[i].principal;
      years[yi].interest += monthlySchedule[i].interest;
      years[yi].balance = monthlySchedule[i].balance;
    }
    return years;
  }
  // 개월 수 → {년, 개월} (표시용)
  function monthsToYM(months) {
    months = Math.max(0, Math.round(months));
    return { y: Math.floor(months / 12), m: months % 12 };
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { computeSchedule: computeSchedule, buildAnnualSchedule: buildAnnualSchedule, monthsToYM: monthsToYM };
    return;
  }

  /* ---- 통화 (cagr-calc 패턴 재사용 — 사용자 선택, localStorage 저장) ---- */
  var CFG = window.APP_CONFIG || {};
  var LS_KEY = (CFG.slug || "mortgage-calc") + ":state";
  var CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CNY", "KRW", "INR", "BRL", "RUB",
    "IDR", "CAD", "AUD", "CHF", "HKD", "SGD", "TWD", "MXN", "ZAR", "TRY", "SEK"];
  var REGION_CCY = {
    US: "USD", GB: "GBP", JP: "JPY", CN: "CNY", HK: "HKD", TW: "TWD",
    KR: "KRW", IN: "INR", BR: "BRL", RU: "RUB", ID: "IDR", CA: "CAD", AU: "AUD",
    CH: "CHF", SG: "SGD", MX: "MXN", ZA: "ZAR", TR: "TRY", SE: "SEK",
    DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", PT: "EUR", IE: "EUR", AT: "EUR", FI: "EUR"
  };
  var LANG_CCY = {
    ko: "KRW", ja: "JPY", zh: "CNY", de: "EUR", fr: "EUR", es: "EUR",
    pt: "BRL", ru: "RUB", id: "IDR", hi: "INR", bn: "BDT", ar: "USD", ur: "PKR", en: "USD"
  };

  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) || navigator.language || "en";
  }
  function nf(opts) { try { return new Intl.NumberFormat(uiLang(), opts); } catch (e) { return new Intl.NumberFormat("en", opts); } }
  function fmt(n, maxdec) { return nf({ maximumFractionDigits: maxdec == null ? 2 : maxdec }).format(n); }
  function cyDec(cur) { try { return nf({ style: "currency", currency: cur }).resolvedOptions().maximumFractionDigits; } catch (e) { return 2; } }
  function money(v, cur) {
    var d = cyDec(cur);
    try { return nf({ style: "currency", currency: cur, minimumFractionDigits: d, maximumFractionDigits: d }).format(v); }
    catch (e) { return fmt(v) + " " + cur; }
  }
  function pct1(p) {
    try { return nf({ style: "percent", maximumFractionDigits: 1 }).format(p / 100); }
    catch (e) { return fmt(p, 1) + "%"; }
  }
  function fmtDuration(months) {
    var ym = monthsToYM(months);
    if (ym.y > 0 && ym.m > 0) return tr("tool.dur.both", "{y} years {m} months").replace("{y}", fmt(ym.y, 0)).replace("{m}", fmt(ym.m, 0));
    if (ym.y > 0) return tr("tool.dur.years", "{y} years").replace("{y}", fmt(ym.y, 0));
    return tr("tool.dur.months", "{m} months").replace("{m}", fmt(ym.m, 0));
  }
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

  /* ---- 금액 입력: 콤마 그룹핑 자동 포맷 · 파싱(소수점=".") ---- */
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
  function numVal(el) {
    if (!el) return null;
    var v = el.valueAsNumber;
    if (isNaN(v)) { var s = String(el.value).trim().replace(",", "."); v = (s === "") ? NaN : Number(s); }
    return isNaN(v) ? null : v;
  }
  function radioVal(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }
  function setRadio(name, value) {
    var el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (el) el.checked = true;
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var modeSegWrap = $("mode-seg");
  var loanField = $("loan-field"), loanInput = $("loan-input");
  var priceField = $("price-field"), priceInput = $("price-input"), downInput = $("down-input");
  var downChipsWrap = $("down-chips"), downHintEl = $("down-hint");
  var rateInput = $("rate-input"), termInput = $("term-input"), termChipsWrap = $("term-chips");
  var curSel = $("currency-select");
  var extraInput = $("extra-input");
  var calcBtn = $("calc-btn");
  var box = $("result-box"), errEl = $("result-error"), bodyEl = $("result-body");
  var rMonthly = $("r-monthly"), rLoan = $("r-loan"), rInterest = $("r-interest"),
    rTotal = $("r-total"), rPayoff = $("r-payoff"), rSub = $("r-sub"), rClipped = $("r-clipped");
  var extraResultEl = $("extra-result"), rSaved = $("r-saved"), rTimeSaved = $("r-timesaved"), rNewPayoff = $("r-newpayoff");
  var schedDetails = $("sched-details"), schedToggle = $("sched-monthly-toggle"),
    schedColPeriod = $("sched-col-period"), schedBody = $("sched-body");
  if (!loanInput || !rateInput || !termInput || !curSel || !calcBtn || !box) return;

  var lastRun = false;
  var lastResult = null;

  function showNotice(key, fallback) {
    box.hidden = false; bodyEl.hidden = true; errEl.hidden = false;
    errEl.textContent = tr(key, fallback);
  }

  /* ---- 모드 전환 (대출금 직접 입력 ↔ 집값+계약금) ---- */
  function syncSegActive() {
    if (!modeSegWrap) return;
    var labels = modeSegWrap.querySelectorAll(".seg-btn");
    for (var i = 0; i < labels.length; i++) {
      var input = labels[i].querySelector("input");
      labels[i].classList.toggle("is-active", !!(input && input.checked));
    }
  }
  function syncModeFields() {
    var mode = radioVal("loanmode") || "loan";
    if (loanField) loanField.hidden = mode !== "loan";
    if (priceField) priceField.hidden = mode !== "price";
    syncSegActive();
  }

  /* ---- 계약금 힌트(비율·대출금 표시) ---- */
  function updateDownHint() {
    if (!downHintEl) return;
    var mode = radioVal("loanmode") || "loan";
    if (mode !== "price") { downHintEl.hidden = true; return; }
    var price = parseAmount(priceInput);
    var down = parseAmount(downInput);
    if (down == null) down = 0;
    if (!(price > 0)) { downHintEl.hidden = true; return; }
    var pct = (down / price) * 100;
    var cur = curSel.value || "USD";
    downHintEl.textContent = tr("tool.down.hint", "{pct} of the home price — loan amount: {loan}")
      .replace("{pct}", pct1(pct))
      .replace("{loan}", money(Math.max(price - down, 0), cur));
    downHintEl.hidden = false;
    syncChipActive(downChipsWrap, "data-downpct", Math.round(pct));
  }

  /* ---- 칩(프리셋) 활성 표시 ---- */
  function syncChipActive(wrap, attr, value) {
    if (!wrap) return;
    var chips = wrap.querySelectorAll(".chip");
    for (var i = 0; i < chips.length; i++) {
      var dv = chips[i].getAttribute(attr);
      chips[i].classList.toggle("is-active", value != null && String(value) === String(dv));
    }
  }

  /* ---- 스케줄 렌더 (연도별 ↔ 월별 토글) ---- */
  function renderSchedule(schedule) {
    if (!schedBody) return;
    var cur = curSel.value || "USD";
    var monthly = !!(schedToggle && schedToggle.checked);
    if (schedColPeriod) schedColPeriod.textContent = tr(monthly ? "tool.sched.col.month" : "tool.sched.col.year", monthly ? "Month" : "Year");
    var rows = monthly ? schedule : buildAnnualSchedule(schedule);
    schedBody.textContent = "";
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var period = monthly ? row.month : row.period;
      var tr_ = document.createElement("tr");
      var tds = [period, money(row.principal, cur), money(row.interest, cur), money(row.balance, cur)];
      for (var c = 0; c < tds.length; c++) {
        var td = document.createElement("td");
        td.textContent = c === 0 ? fmt(tds[c], 0) : tds[c];
        tr_.appendChild(td);
      }
      schedBody.appendChild(tr_);
    }
  }

  /* ---- 메인 계산 ---- */
  function calculate() {
    lastRun = true;
    var mode = radioVal("loanmode") || "loan";
    var cur = curSel.value || "USD";
    var rate = numVal(rateInput);
    var term = numVal(termInput);
    var extra = parseAmount(extraInput);
    if (extra == null) extra = 0;

    var loan = null, price = null, down = null;
    if (mode === "price") {
      price = parseAmount(priceInput);
      down = parseAmount(downInput);
      if (down == null) down = 0;
    } else {
      loan = parseAmount(loanInput);
    }

    persist(mode, cur);
    updateDownHint();
    syncChipActive(termChipsWrap, "data-term", term);

    // 엣지케이스(철칙 5 — 전부 명시 처리): 빈 입력 먼저, 그다음 범위 검증
    var missing = (mode === "price" ? price == null : loan == null) || rate == null || term == null;
    if (missing) return showNotice("tool.err.empty", "Enter the loan amount, interest rate, and term.");

    if (mode === "price") {
      if (!(price > 0)) return showNotice("tool.err.price", "Home price must be greater than 0.");
      if (down < 0 || down >= price) return showNotice("tool.err.down", "Down payment can't be negative and must be less than the home price.");
      loan = price - down;
    } else {
      if (!(loan > 0)) return showNotice("tool.err.loan", "Loan amount must be greater than 0.");
    }
    if (rate < 0) return showNotice("tool.err.rate", "Interest rate can't be negative.");
    if (!(term > 0)) return showNotice("tool.err.term", "Loan term must be greater than 0 years.");
    if (extra < 0) return showNotice("tool.err.extra", "Extra payment can't be negative.");

    var r = computeSchedule(loan, rate, term, extra);
    lastResult = r;
    errEl.hidden = true; bodyEl.hidden = false; box.hidden = false;

    rMonthly.textContent = money(r.payment, cur);
    rLoan.textContent = money(r.principal, cur);
    rInterest.textContent = money(r.totalInterestBase, cur);
    rTotal.textContent = money(r.totalPaidBase, cur);
    rPayoff.textContent = fmtDuration(r.n);
    rSub.textContent = tr("tool.result.sub", "On a {loan} loan at {rate}% for {years} years.")
      .replace("{loan}", money(r.principal, cur))
      .replace("{rate}", fmt(r.rate, 3))
      .replace("{years}", fmt(r.years, 0));
    rClipped.hidden = !r.clipped;

    extraResultEl.hidden = !r.hasExtra;
    if (r.hasExtra) {
      rSaved.textContent = money(r.interestSaved, cur);
      rTimeSaved.textContent = fmtDuration(r.monthsSaved);
      rNewPayoff.textContent = fmtDuration(r.payoffMonths);
    }

    renderSchedule(r.schedule);
  }

  /* ---- 상태 저장/복원 (프로세스 밖 — 철칙 1) ---- */
  function persist(mode, cur) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        mode: mode, loan: loanInput.value, price: priceInput.value, down: downInput.value,
        rate: rateInput.value, term: termInput.value, extra: extraInput.value, currency: cur,
        schedMonthly: !!(schedToggle && schedToggle.checked)
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }
  }

  (function init() {
    var saved = null;
    try { var s = localStorage.getItem(LS_KEY); if (s) saved = JSON.parse(s); } catch (e) { saved = null; }
    var startCur = (saved && saved.currency) || detectCurrency();
    fillCurrencies(startCur);
    if (saved) {
      if (saved.mode === "price") setRadio("loanmode", "price");
      if (saved.loan) loanInput.value = saved.loan;
      if (saved.price) priceInput.value = saved.price;
      if (saved.down) downInput.value = saved.down;
      if (saved.rate) rateInput.value = saved.rate;
      if (saved.term) termInput.value = saved.term;
      if (saved.extra) extraInput.value = saved.extra;
      if (saved.schedMonthly && schedToggle) schedToggle.checked = true;
    }
    syncModeFields();
    updateDownHint();
    var mode = radioVal("loanmode") || "loan";
    var haveAmount = mode === "price" ? parseAmount(priceInput) != null : parseAmount(loanInput) != null;
    if (haveAmount && numVal(rateInput) != null && numVal(termInput) != null) calculate();
  })();

  /* ---- 이벤트 배선 ---- */
  function onAmountInput(e) { reformatAmount(e.target); calculate(); }
  loanInput.addEventListener("input", onAmountInput);
  priceInput.addEventListener("input", onAmountInput);
  downInput.addEventListener("input", onAmountInput);
  extraInput.addEventListener("input", onAmountInput);
  rateInput.addEventListener("input", calculate);
  termInput.addEventListener("input", calculate);
  curSel.addEventListener("change", calculate);
  calcBtn.addEventListener("click", calculate);

  var modeRadios = document.querySelectorAll('input[name="loanmode"]');
  for (var mr = 0; mr < modeRadios.length; mr++) {
    modeRadios[mr].addEventListener("change", function () { syncModeFields(); calculate(); });
  }

  if (downChipsWrap) {
    var downChips = downChipsWrap.querySelectorAll(".chip");
    for (var dc = 0; dc < downChips.length; dc++) {
      downChips[dc].addEventListener("click", function () {
        var pct = Number(this.getAttribute("data-downpct"));
        var price = parseAmount(priceInput);
        if (price > 0) {
          var down = Math.round(price * pct / 100);
          downInput.value = String(down).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        }
        calculate();
      });
    }
  }
  if (termChipsWrap) {
    var termChips = termChipsWrap.querySelectorAll(".chip");
    for (var tc = 0; tc < termChips.length; tc++) {
      termChips[tc].addEventListener("click", function () {
        termInput.value = this.getAttribute("data-term");
        calculate();
      });
    }
  }
  if (schedToggle) {
    schedToggle.addEventListener("change", function () {
      if (lastResult) renderSchedule(lastResult.schedule);
    });
  }

  function onEnter(e) { if (e.key === "Enter") calculate(); }
  [loanInput, priceInput, downInput, rateInput, termInput, extraInput].forEach(function (el) {
    el.addEventListener("keydown", onEnter);
  });

  // 언어 전환: 통화기호·동적 문구·Intl 포맷·스케줄 헤더를 새 로케일로 재렌더
  document.addEventListener("i18n:change", function () {
    fillCurrencies(curSel.value);
    if (lastRun && !box.hidden) calculate();
  });
  // TOOLJS:END
})();
