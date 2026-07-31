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
  /* Debt Payoff Calculator — 잔액·APR·(월 상환액 또는 목표 상환일)로 상환 개월수·총이자·
     상환 완료일·상환 스케줄을 계산. 가드: 상환액<=월이자 → "영원히 안 갚아짐" + 최소 유효
     상환액 안내. 추가상환 what-if(월 +X → 이자 Y 절약·Z개월 단축)도 지원.
     상태: localStorage "<slug>:state" 만. 외부 API 없음, 모든 계산은 로컬. */

  var LIM = { value: 1e12, rate: 100, months: 600 }; // months=600 → 최대 50년까지 시뮬레이션

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  // 고정 상환액으로 잔액이 0에 도달할 때까지 월별 시뮬레이션.
  // payment <= 그 달 이자 이면 잔액이 절대 줄지 않으므로 즉시 "영원히 안 갚아짐" 가드.
  function scheduleFromPayment(balance, aprPct, payment, capMonths) {
    var clipped = false;
    if (!(balance > 0)) balance = 0;
    if (balance > LIM.value) { balance = LIM.value; clipped = true; }
    if (!(aprPct >= 0)) aprPct = 0;
    if (aprPct > LIM.rate) { aprPct = LIM.rate; clipped = true; }
    if (!(payment > 0)) payment = 0;

    var r = aprPct / 100 / 12;
    var monthlyInterest = balance * r;

    if (payment <= monthlyInterest) {
      return { ok: false, reason: "neverPaysOff", monthlyInterest: monthlyInterest, balance: balance, rate: aprPct, payment: payment, clipped: clipped };
    }

    var schedule = [];
    var bal = balance;
    var totalInterest = 0;
    var totalPaid = 0;
    var month = 0;
    var cap = capMonths || LIM.months;
    while (bal > 0.005 && month < cap) {
      month++;
      var interestPortion = bal * r;
      var principalPortion = payment - interestPortion;
      if (principalPortion > bal) principalPortion = bal;
      if (principalPortion < 0) principalPortion = 0;
      var actualPayment = interestPortion + principalPortion;
      bal -= principalPortion;
      totalInterest += interestPortion;
      totalPaid += actualPayment;
      schedule.push({
        month: month, payment: actualPayment, interest: interestPortion,
        principal: principalPortion, balance: bal < 0 ? 0 : bal
      });
    }
    var truncated = bal > 0.005;

    return {
      ok: true, truncated: truncated, months: schedule.length,
      totalInterest: totalInterest, totalPaid: totalPaid,
      schedule: schedule, balance: balance, payment: payment, rate: aprPct,
      monthlyInterest: monthlyInterest, clipped: clipped
    };
  }
  // 목표 개월수로 필요한 월 상환액을 역산 (표준 원리금균등상환 공식). r=0 이면 단순 균등분할.
  function paymentFromTerm(balance, aprPct, months) {
    var clipped = false;
    if (!(balance > 0)) balance = 0;
    if (balance > LIM.value) { balance = LIM.value; clipped = true; }
    if (!(aprPct >= 0)) aprPct = 0;
    if (aprPct > LIM.rate) { aprPct = LIM.rate; clipped = true; }
    if (!(months >= 1)) months = 1;
    if (months > LIM.months) { months = LIM.months; clipped = true; }

    var r = aprPct / 100 / 12;
    var payment;
    if (r === 0) {
      payment = balance / months;
    } else {
      var pow = Math.pow(1 + r, months);
      payment = balance * r * pow / (pow - 1);
    }
    if (!isFinite(payment) || isNaN(payment)) payment = balance / months;
    return { payment: payment, months: months, rate: aprPct, balance: balance, clipped: clipped };
  }
  // 최소 유효 상환액: 그 달 이자보다 통화 최소단위 하나만큼 더 큰 값 (이 이하는 절대 못 갚음).
  function minViablePayment(monthlyInterest, decimals) {
    var unit = Math.pow(10, -(decimals == null ? 2 : decimals));
    return Math.ceil((monthlyInterest + 1e-9) / unit) * unit + unit;
  }
  // 월별 스케줄 → 연도별 합산(연 1행: 그 해 상환액/이자/원금 합, 연말 잔액)
  function buildAnnualSchedule(monthlySchedule) {
    var years = [];
    for (var i = 0; i < monthlySchedule.length; i++) {
      var yi = Math.floor(i / 12);
      if (!years[yi]) years[yi] = { period: yi + 1, payment: 0, interest: 0, principal: 0, balance: 0 };
      years[yi].payment += monthlySchedule[i].payment;
      years[yi].interest += monthlySchedule[i].interest;
      years[yi].principal += monthlySchedule[i].principal;
      years[yi].balance = monthlySchedule[i].balance;
    }
    return years;
  }
  // 개월 수 → {년, 개월} (표시용)
  function monthsToYM(months) {
    months = Math.max(0, Math.round(months));
    return { y: Math.floor(months / 12), m: months % 12 };
  }
  // 날짜에 개월 더하기 — 말일 오버플로 방지(1/31 + 1개월이 3월로 튀지 않게 day를 먼저 1로 내림)
  function addMonths(date, n) {
    var d = new Date(date.getTime());
    var day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    var daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, daysInMonth));
    return d;
  }
  // 오늘부터 목표일까지 개월 수(올림, 최소 1개월). 과거/오늘이면 reason:"past".
  function monthsUntilDate(dateStr, todayMs) {
    if (!dateStr) return { ok: false, reason: "empty" };
    var t1 = Date.parse(dateStr + "T00:00:00");
    if (isNaN(t1)) return { ok: false, reason: "empty" };
    var t0 = todayMs;
    var days = (t1 - t0) / 86400000;
    if (days <= 0) return { ok: false, reason: "past" };
    var months = Math.ceil(days / 30.44);
    if (months < 1) months = 1;
    return { ok: true, months: months, days: days };
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      scheduleFromPayment: scheduleFromPayment, paymentFromTerm: paymentFromTerm,
      minViablePayment: minViablePayment, buildAnnualSchedule: buildAnnualSchedule,
      monthsToYM: monthsToYM, addMonths: addMonths, monthsUntilDate: monthsUntilDate
    };
    return;
  }

  /* ---- 통화 (cagr-calc/mortgage-calc 패턴 재사용 — 사용자 선택, localStorage 저장) ---- */
  var CFG = window.APP_CONFIG || {};
  var LS_KEY = (CFG.slug || "debt-payoff-calc") + ":state";
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
  function fmtDuration(months) {
    var ym = monthsToYM(months);
    if (ym.y > 0 && ym.m > 0) return tr("tool.dur.both", "{y} years {m} months").replace("{y}", fmt(ym.y, 0)).replace("{m}", fmt(ym.m, 0));
    if (ym.y > 0) return tr("tool.dur.years", "{y} years").replace("{y}", fmt(ym.y, 0));
    return tr("tool.dur.months", "{m} months").replace("{m}", fmt(ym.m, 0));
  }
  function fmtDateLong(date) {
    try { return new Intl.DateTimeFormat(uiLang(), { year: "numeric", month: "long", day: "numeric" }).format(date); }
    catch (e) { return date.toDateString(); }
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
  var balanceInput = $("balance-input"), aprInput = $("apr-input");
  var paymentField = $("payment-field"), paymentInput = $("payment-input");
  var targetField = $("target-field"), targetInput = $("target-input");
  var curSel = $("currency-select");
  var extraInput = $("extra-input");
  var calcBtn = $("calc-btn");
  var box = $("result-box"), errEl = $("result-error"), bodyEl = $("result-body");
  var guardBox = $("guard-box"), guardBody = $("guard-body"), guardMinVal = $("guard-min-val");
  var cardMonths = $("card-months"), rMonths = $("r-months");
  var cardPayment = $("card-payment"), rPayment = $("r-payment");
  var rInterest = $("r-interest"), rTotal = $("r-total"), rDate = $("r-date"), rSub = $("r-sub");
  var rClipped = $("r-clipped"), rTruncated = $("r-truncated");
  var extraResultEl = $("extra-result"), rSaved = $("r-saved"), rTimeSaved = $("r-timesaved"), rNewPayoff = $("r-newpayoff");
  var schedDetails = $("sched-details"), schedToggle = $("sched-monthly-toggle"),
    schedColPeriod = $("sched-col-period"), schedBody = $("sched-body");
  if (!balanceInput || !aprInput || !paymentInput || !targetInput || !curSel || !calcBtn || !box) return;

  var lastRun = false;
  var lastResult = null;

  function showNotice(key, fallback) {
    box.hidden = false; bodyEl.hidden = true; guardBox.hidden = true; errEl.hidden = false;
    errEl.textContent = tr(key, fallback);
  }
  function showGuard(monthlyInterest, payment, ratePct, cur) {
    box.hidden = false; bodyEl.hidden = true; errEl.hidden = true; guardBox.hidden = false;
    guardBody.textContent = tr("tool.guard.body", "At {rate}% APR, your balance accrues {interest} in interest every month — a payment of {payment} or less will never reduce it.")
      .replace("{rate}", fmt(ratePct, 3)).replace("{interest}", money(monthlyInterest, cur)).replace("{payment}", money(payment, cur));
    var dec = cyDec(cur);
    guardMinVal.textContent = money(minViablePayment(monthlyInterest, dec), cur);
  }

  /* ---- 모드 전환 (월 상환액 ↔ 목표 상환일) ---- */
  function syncSegActive() {
    if (!modeSegWrap) return;
    var labels = modeSegWrap.querySelectorAll(".seg-btn");
    for (var i = 0; i < labels.length; i++) {
      var input = labels[i].querySelector("input");
      labels[i].classList.toggle("is-active", !!(input && input.checked));
    }
  }
  function syncModeFields() {
    var mode = radioVal("payoffmode") || "payment";
    if (paymentField) paymentField.hidden = mode !== "payment";
    if (targetField) targetField.hidden = mode !== "target";
    syncSegActive();
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
      var tds = [period, money(row.payment, cur), money(row.interest, cur), money(row.principal, cur), money(row.balance, cur)];
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
    var mode = radioVal("payoffmode") || "payment";
    var cur = curSel.value || "USD";
    var balance = parseAmount(balanceInput);
    var apr = numVal(aprInput);
    var payment = parseAmount(paymentInput);
    var extra = parseAmount(extraInput);
    if (extra == null) extra = 0;

    persist(mode, cur);
    syncSegActive();

    // 엣지케이스(철칙 5 — 전부 명시 처리): 빈 입력 먼저, 그다음 범위 검증
    if (mode === "payment") {
      if (balance == null || apr == null || payment == null) return showNotice("tool.err.empty", "Enter your balance, APR, and payment.");
    } else {
      if (balance == null || apr == null || !targetInput.value) return showNotice("tool.err.emptyTarget", "Enter your balance, APR, and target payoff date.");
    }
    if (!(balance > 0)) return showNotice("tool.err.balance", "Balance must be greater than 0.");
    if (apr < 0) return showNotice("tool.err.apr", "APR can't be negative.");
    if (extra < 0) return showNotice("tool.err.extra", "Extra payment can't be negative.");

    var r, months, todayMs;
    var todayDate = new Date(); todayDate.setHours(0, 0, 0, 0);
    todayMs = todayDate.getTime();

    if (mode === "payment") {
      if (!(payment > 0)) return showNotice("tool.err.payment", "Payment must be greater than 0.");
      r = scheduleFromPayment(balance, apr, payment, LIM.months);
      if (!r.ok) return showGuard(r.monthlyInterest, payment, apr, cur);
    } else {
      var mu = monthsUntilDate(targetInput.value, todayMs);
      if (!mu.ok) {
        if (mu.reason === "past") return showNotice("tool.err.targetPast", "Target date must be in the future.");
        return showNotice("tool.err.emptyTarget", "Enter your balance, APR, and target payoff date.");
      }
      if (mu.months > LIM.months) return showNotice("tool.err.targetTooFar", "Target date is too far away — try within 50 years.");
      var pf = paymentFromTerm(balance, apr, mu.months);
      r = scheduleFromPayment(balance, apr, pf.payment, LIM.months);
      if (!r.ok) r = { ok: true, truncated: false, months: mu.months, totalInterest: pf.payment * mu.months - balance, totalPaid: pf.payment * mu.months, schedule: [], balance: balance, payment: pf.payment, rate: apr, monthlyInterest: balance * (apr / 100 / 12), clipped: pf.clipped };
    }
    months = r.months;

    lastResult = r;
    errEl.hidden = true; guardBox.hidden = true; bodyEl.hidden = false; box.hidden = false;

    // payment 모드: 오늘부터 계산된 개월수로 완주일 산출. target 모드: 사용자가 고른 날짜를 그대로 에코
    // (개월수는 올림 처리라 today+months 로 재계산하면 사용자가 고른 날짜와 며칠 어긋날 수 있음).
    var payoffDate = mode === "payment" ? addMonths(todayDate, months) : new Date(targetInput.value + "T00:00:00");

    cardMonths.hidden = mode !== "payment";
    cardPayment.hidden = mode !== "target";
    if (mode === "payment") {
      rMonths.textContent = fmtDuration(months);
      rSub.textContent = tr("tool.result.sub", "Paying {payment} per month on a {balance} balance at {rate}% APR.")
        .replace("{payment}", money(payment, cur)).replace("{balance}", money(balance, cur)).replace("{rate}", fmt(apr, 3));
    } else {
      rPayment.textContent = money(r.payment, cur);
      rSub.textContent = tr("tool.result.subTarget", "To pay off a {balance} balance at {rate}% APR in {months} — required to hit {date}.")
        .replace("{balance}", money(balance, cur)).replace("{rate}", fmt(apr, 3))
        .replace("{months}", fmtDuration(months)).replace("{date}", fmtDateLong(payoffDate));
    }
    rInterest.textContent = money(r.totalInterest, cur);
    rTotal.textContent = money(r.totalPaid, cur);
    rDate.textContent = fmtDateLong(payoffDate);
    rClipped.hidden = !r.clipped;
    rTruncated.hidden = !r.truncated;

    // 추가상환 what-if — payment 모드에서만, extra > 0 일 때만
    var showExtra = mode === "payment" && extra > 0 && payment > 0;
    extraResultEl.hidden = !showExtra;
    if (showExtra) {
      var withExtra = scheduleFromPayment(balance, apr, payment + extra, LIM.months);
      if (withExtra.ok) {
        var interestSaved = r.totalInterest - withExtra.totalInterest;
        var monthsSaved = r.months - withExtra.months;
        rSaved.textContent = money(interestSaved > 0 ? interestSaved : 0, cur);
        rTimeSaved.textContent = fmtDuration(monthsSaved > 0 ? monthsSaved : 0);
        rNewPayoff.textContent = fmtDuration(withExtra.months);
      } else {
        extraResultEl.hidden = true; // extra 를 더해도 여전히 못 갚는 극단값 — 조용히 숨김(본 결과는 정상 표시됨)
      }
    }

    renderSchedule(r.schedule);
  }

  /* ---- 상태 저장/복원 (프로세스 밖 — 철칙 1) ---- */
  function persist(mode, cur) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        mode: mode, balance: balanceInput.value, apr: aprInput.value,
        payment: paymentInput.value, target: targetInput.value, extra: extraInput.value,
        currency: cur, schedMonthly: !!(schedToggle && schedToggle.checked)
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }
  }

  (function init() {
    // 목표일 입력 최소값 = 내일 (과거/오늘 선택 방지)
    try {
      var tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      targetInput.min = tomorrow.toISOString().slice(0, 10);
    } catch (e) { /* noop */ }

    var saved = null;
    try { var s = localStorage.getItem(LS_KEY); if (s) saved = JSON.parse(s); } catch (e) { saved = null; }
    var startCur = (saved && saved.currency) || detectCurrency();
    fillCurrencies(startCur);
    if (saved) {
      if (saved.mode === "target") setRadio("payoffmode", "target");
      if (saved.balance) balanceInput.value = saved.balance;
      if (saved.apr) aprInput.value = saved.apr;
      if (saved.payment) paymentInput.value = saved.payment;
      if (saved.target) targetInput.value = saved.target;
      if (saved.extra) extraInput.value = saved.extra;
      if (saved.schedMonthly && schedToggle) schedToggle.checked = true;
    }
    syncModeFields();
    var mode = radioVal("payoffmode") || "payment";
    var haveInputs = parseAmount(balanceInput) != null && numVal(aprInput) != null &&
      (mode === "payment" ? parseAmount(paymentInput) != null : !!targetInput.value);
    if (haveInputs) calculate();
  })();

  /* ---- 이벤트 배선 ---- */
  function onAmountInput(e) { reformatAmount(e.target); calculate(); }
  balanceInput.addEventListener("input", onAmountInput);
  paymentInput.addEventListener("input", onAmountInput);
  extraInput.addEventListener("input", onAmountInput);
  aprInput.addEventListener("input", calculate);
  targetInput.addEventListener("input", calculate);
  curSel.addEventListener("change", calculate);
  calcBtn.addEventListener("click", calculate);

  var modeRadios = document.querySelectorAll('input[name="payoffmode"]');
  for (var mr = 0; mr < modeRadios.length; mr++) {
    modeRadios[mr].addEventListener("change", function () { syncModeFields(); calculate(); });
  }
  if (schedToggle) {
    schedToggle.addEventListener("change", function () {
      if (lastResult) renderSchedule(lastResult.schedule);
    });
  }

  function onEnter(e) { if (e.key === "Enter") calculate(); }
  [balanceInput, aprInput, paymentInput, targetInput, extraInput].forEach(function (el) {
    el.addEventListener("keydown", onEnter);
  });

  // 언어 전환: 통화기호·동적 문구·Intl 포맷·스케줄 헤더를 새 로케일로 재렌더
  document.addEventListener("i18n:change", function () {
    fillCurrencies(curSel.value);
    if (lastRun && !box.hidden) calculate();
  });
  // TOOLJS:END
})();
