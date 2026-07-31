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
  /* Credit Card Interest Calculator — 잔액+APR → 일일이자율·이번 결제주기 이자를 즉시 계산하고,
     최소상환금(잔액의 %, 최소 정액 중 큰 값)만 낼 때와 같은 금액을 고정 상환할 때를 나란히
     시뮬레이션한다("최소상환 함정"). 상태: localStorage "<slug>:state" 만. 외부 API 없음. */

  var LIM = { balance: 1e12, apr: 500, months: 600 }; // 50년 상한 — 무한루프·비현실 입력값 방어

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상, Math 외 DOM 의존 없음)
  // 유한화 가드 — Infinity/NaN 을 안전한 유한값으로 (지수표기 방지·조용한 실패 방지)
  function safe(v) {
    if (typeof v !== "number" || isNaN(v)) return 0;
    if (v === Infinity) return LIM.balance;
    if (v === -Infinity) return -LIM.balance;
    return v;
  }
  // 일일이자율 = APR/365, 이번 결제주기 이자 = 잔액 × 일일이자율 × 주기일수
  function quickInterest(balance, apr, days) {
    var dailyRate = (apr / 100) / 365;
    return { dailyRate: dailyRate, interest: balance * dailyRate * days };
  }
  // 최소상환금 = max(잔액 × 최소상환율, 최소 정액)
  function minPaymentAmount(balance, pct, floorAmt) {
    return Math.max(balance * (pct / 100), floorAmt);
  }
  // 월별 상환 시뮬레이션(감채표). paymentFn(balance) 가 매월 상환액을 정한다.
  // 상환액이 그 달 이자 이하이면 원금이 줄지 않는 "최소상환 함정"(음의 상각) → neverPayoff.
  // capMonths 도달 시(50년) 완납 못 해도 종료 — 무한루프 방지, paidOff=false 로 보고.
  function simulate(balance0, apr, paymentFn, capMonths) {
    var monthlyRate = (apr / 100) / 12;
    var balance = balance0;
    var months = 0, totalInterest = 0, totalPaid = 0, firstPayment = null, neverPayoff = false;
    var schedule = [];
    while (balance > 0.005 && months < capMonths) {
      var interest = balance * monthlyRate;
      var payment = paymentFn(balance, months);
      if (months === 0) firstPayment = payment;
      if (payment <= interest) { neverPayoff = true; break; }
      if (payment > balance + interest) payment = balance + interest; // 마지막 회차는 잔액만큼만
      balance -= (payment - interest);
      totalInterest += interest;
      totalPaid += payment;
      months++;
      if (months % 12 === 0) schedule.push({ year: months / 12, balance: Math.max(balance, 0) });
    }
    return {
      months: months, totalInterest: totalInterest, totalPaid: totalPaid,
      neverPayoff: neverPayoff, paidOff: balance <= 0.005, firstPayment: firstPayment,
      endingBalance: Math.max(balance, 0), schedule: schedule
    };
  }
  // calc-core:end

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다 (document 접근 전에 반드시 반환)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { quickInterest: quickInterest, minPaymentAmount: minPaymentAmount, simulate: simulate, safe: safe };
    return;
  }

  var cfg = window.APP_CONFIG || {};
  var LS_KEY = (cfg.slug || "credit-card-interest-calc") + ":state";

  var CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CNY", "KRW", "INR", "BRL", "RUB",
    "IDR", "CAD", "AUD", "CHF", "HKD", "SGD", "TWD", "MXN", "ZAR", "TRY", "SEK"];
  var REGION_CCY = { US: "USD", GB: "GBP", JP: "JPY", CN: "CNY", HK: "HKD", TW: "TWD",
    KR: "KRW", IN: "INR", BR: "BRL", RU: "RUB", ID: "IDR", CA: "CAD", AU: "AUD",
    CH: "CHF", SG: "SGD", MX: "MXN", ZA: "ZAR", TR: "TRY", SE: "SEK",
    DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", PT: "EUR", IE: "EUR", AT: "EUR", FI: "EUR" };
  var LANG_CCY = { ko: "KRW", ja: "JPY", zh: "CNY", de: "EUR", fr: "EUR", es: "EUR",
    pt: "BRL", ru: "RUB", id: "IDR", hi: "INR", bn: "BDT", ar: "USD", ur: "PKR", en: "USD" };

  function $(id) { return document.getElementById(id); }
  var curSel = $("currency-select");
  var balEl = $("balance-input"), aprEl = $("apr-input");
  var pctEl = $("minpct-input"), floorEl = $("minfloor-input");
  var daysEl = $("cycledays-input"), fixedEl = $("fixed-input");
  var calcBtn = $("calc-btn");
  var box = $("result-box"), errEl = $("result-error"), bodyEl = $("result-body");
  if (!balEl || !aprEl || !pctEl || !floorEl || !curSel || !calcBtn || !box) return;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function fmtLocale() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) || navigator.language || "en";
  }

  // ── 금액 입력: 콤마 그룹핑 자동 포맷 · 파싱(소수점=".") — cagr-calc 패턴 ──
  function parseAmount(el) {
    if (!el) return null;
    var raw = String(el.value);
    var s = raw.replace(/[^0-9.]/g, "");
    var fd = s.indexOf(".");
    if (fd !== -1) s = s.slice(0, fd + 1) + s.slice(fd + 1).replace(/\./g, "");
    if (s === "" || s === ".") return null;
    var v = Number(s);
    return isFinite(v) ? v : null;
  }
  function reformatAmount(el) {
    var raw = el.value;
    var caret = el.selectionStart == null ? raw.length : el.selectionStart;
    var digitsBefore = (raw.slice(0, caret).match(/[0-9]/g) || []).length;
    var cleaned = raw.replace(/[^0-9.]/g, "");
    var fd = cleaned.indexOf(".");
    if (fd !== -1) cleaned = cleaned.slice(0, fd + 1) + cleaned.slice(fd + 1).replace(/\./g, "");
    var segs = cleaned.split(".");
    var intPart = segs[0].replace(/^0+(?=\d)/, "");
    var grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var out = grouped + (segs.length > 1 ? "." + segs[1] : "");
    if (out !== raw) {
      el.value = out;
      var pos = 0, seen = 0;
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

  // ── Intl 포매팅 (하드코딩 없음) ──
  function nf(opts) { try { return new Intl.NumberFormat(fmtLocale(), opts); } catch (e) { return new Intl.NumberFormat("en", opts); } }
  function cyDec(cur) { try { return nf({ style: "currency", currency: cur }).resolvedOptions().maximumFractionDigits; } catch (e) { return 2; } }
  function money(v, cur) {
    var d = cyDec(cur);
    try { return nf({ style: "currency", currency: cur, minimumFractionDigits: d, maximumFractionDigits: d }).format(safe(v)); }
    catch (e) { return String(safe(v)); }
  }
  function pctFmt(p) {
    try { return new Intl.NumberFormat(fmtLocale(), { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(safe(p) / 100); }
    catch (e) { return String(p) + "%"; }
  }
  function numFmt(v, maxdec) { return nf({ maximumFractionDigits: maxdec == null ? 0 : maxdec }).format(safe(v)); }

  // ── 통화 셀렉터 (cagr-calc 패턴) ──
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

  // ── 기간 문구 (년/개월) ──
  function durationText(months) {
    if (months < 1) return t("tool.time.lt1mo", "Less than 1 month");
    var y = Math.floor(months / 12), m = Math.round(months % 12);
    if (m === 12) { y += 1; m = 0; }
    var yTxt = y > 0 ? t("tool.time.years", "{n} yr").replace("{n}", numFmt(y)) : "";
    var mTxt = m > 0 ? t("tool.time.months", "{n} mo").replace("{n}", numFmt(m)) : "";
    if (yTxt && mTxt) return yTxt + " " + mTxt;
    return yTxt || mTxt || t("tool.time.lt1mo", "Less than 1 month");
  }

  var lastRun = false;
  function showNotice(key, fallback) {
    box.hidden = false; bodyEl.hidden = true; errEl.hidden = false;
    errEl.textContent = t(key, fallback);
  }

  function fillRow(prefix, r, cur) {
    var timeEl = $("r-" + prefix + "-time");
    var warnEl = $("r-warn-" + prefix);
    if (r.neverPayoff) {
      timeEl.textContent = t("tool.result.neverPayoff", "Never (balance grows)");
      warnEl.hidden = false;
      warnEl.textContent = t("tool.result.neverPayoffNote", "This payment doesn't cover the interest — the balance grows instead of shrinking.");
    } else if (!r.paidOff) {
      timeEl.textContent = t("tool.result.capped", "50+ years");
      warnEl.hidden = false;
      warnEl.textContent = t("tool.result.cappedNote", "Still not paid off after 50 years — totals below are for that period.");
    } else {
      timeEl.textContent = durationText(r.months);
      warnEl.hidden = true;
    }
    $("r-" + prefix + "-interest").textContent = money(r.totalInterest, cur);
    $("r-" + prefix + "-paid").textContent = money(r.totalPaid, cur);
  }

  function calculate() {
    lastRun = true;
    var cur = curSel.value || "USD";
    var balance = parseAmount(balEl);
    var apr = num(aprEl);
    var pct = num(pctEl);
    var floorAmt = parseAmount(floorEl);
    var days = num(daysEl);
    var fixedOverride = parseAmount(fixedEl);
    persist(cur);

    // 엣지케이스(철칙 5 — 전부 명시 처리)
    if (balance == null || apr == null) return showNotice("tool.err.empty", "Enter your balance and APR.");
    if (balance <= 0) return showNotice("tool.err.balance", "Balance must be greater than 0.");
    if (apr < 0) return showNotice("tool.err.apr", "APR can't be negative.");
    if (pct == null) pct = 0;
    if (floorAmt == null) floorAmt = 0;
    if (pct < 0 || floorAmt < 0) return showNotice("tool.err.minNeg", "Minimum payment % and floor can't be negative.");
    if (pct === 0 && floorAmt === 0) return showNotice("tool.err.minZero", "Enter a minimum payment % or a floor amount greater than 0.");
    if (fixedOverride != null && fixedOverride < 0) return showNotice("tool.err.fixedNeg", "Fixed payment can't be negative.");
    if (days == null || days <= 0) days = 30;

    var clipped = false;
    if (balance > LIM.balance) { balance = LIM.balance; clipped = true; }
    if (apr > LIM.apr) { apr = LIM.apr; clipped = true; }

    errEl.hidden = true; bodyEl.hidden = false; box.hidden = false;

    // 1) 이번 결제주기 이자 (즉시 계산)
    var q = quickInterest(balance, apr, days);
    $("r-daily-rate").textContent = pctFmt(q.dailyRate * 100);
    $("r-cycle-interest").textContent = money(q.interest, cur);
    $("r-cycle-days-note").textContent = t("tool.result.cycleNote", "Based on a {days}-day billing cycle.").replace("{days}", numFmt(days));

    // 2) 최소상환금만 낼 때 시뮬레이션
    var rMin = simulate(balance, apr, function (bal) { return minPaymentAmount(bal, pct, floorAmt); }, LIM.months);

    // 3) 같은 첫 회차 금액을 고정 상환할 때 시뮬레이션 (사용자가 직접 지정하면 그 값 사용)
    var fixedAmt = (fixedOverride != null && fixedOverride > 0) ? fixedOverride : rMin.firstPayment;
    var rFixed = simulate(balance, apr, function () { return fixedAmt; }, LIM.months);

    fillRow("min", rMin, cur);
    fillRow("fixed", rFixed, cur);
    $("r-col-fixed-label").textContent = t("tool.result.colFixed", "Fixed payment ({amount}/mo)").replace("{amount}", money(fixedAmt, cur));

    // 저축 요약 — 두 시나리오 모두 완납했고 고정 상환이 더 빠를 때만 의미 있는 비교
    var savingsEl = $("r-savings");
    if (rMin.paidOff && rFixed.paidOff && rFixed.months < rMin.months) {
      var interestSaved = rMin.totalInterest - rFixed.totalInterest;
      savingsEl.hidden = false;
      savingsEl.textContent = t("tool.result.savings", "Keeping your payment at {amount} instead of letting it shrink pays this off {time} sooner and saves {interest} in interest.")
        .replace("{amount}", money(fixedAmt, cur)).replace("{time}", durationText(rMin.months - rFixed.months)).replace("{interest}", money(interestSaved, cur));
    } else {
      savingsEl.hidden = true;
    }

    // 감채표 (최소상환 경로만, 연 단위)
    var tbody = $("sched-body"); tbody.innerHTML = "";
    for (var i = 0; i < rMin.schedule.length; i++) {
      var tr = document.createElement("tr");
      var td1 = document.createElement("td"); td1.textContent = numFmt(rMin.schedule[i].year, 0);
      var td2 = document.createElement("td"); td2.textContent = money(rMin.schedule[i].balance, cur);
      tr.appendChild(td1); tr.appendChild(td2); tbody.appendChild(tr);
    }
    var schedWrap = $("sched-wrap");
    schedWrap.hidden = rMin.schedule.length === 0;
    var trunc = $("sched-trunc");
    if (!rMin.paidOff) {
      trunc.hidden = false;
      trunc.textContent = t("tool.sched.truncated", "Showing up to the {n}-year cap used for this calculation.").replace("{n}", numFmt(LIM.months / 12));
    } else { trunc.hidden = true; }

    $("r-clipped").hidden = !clipped;
  }

  function persist(cur) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        balance: balEl.value, apr: aprEl.value, pct: pctEl.value, floor: floorEl.value,
        days: daysEl.value, fixed: fixedEl.value, currency: cur
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }
  }

  // ── 초기화 · 복원 (상태는 프로세스 밖 — 철칙 1) ──
  (function init() {
    var saved = null;
    try { var s = localStorage.getItem(LS_KEY); if (s) saved = JSON.parse(s); } catch (e) { saved = null; }
    var startCur = (saved && saved.currency) || detectCurrency();
    fillCurrencies(startCur);
    if (saved) {
      if (saved.balance) balEl.value = saved.balance;
      if (saved.apr) aprEl.value = saved.apr;
      if (saved.pct) pctEl.value = saved.pct;
      if (saved.floor) floorEl.value = saved.floor;
      if (saved.days) daysEl.value = saved.days;
      if (saved.fixed) fixedEl.value = saved.fixed;
    }
    var ready = parseAmount(balEl) != null && num(aprEl) != null;
    if (ready) calculate();
  })();

  // ── 이벤트 배선: 실시간 재계산(oninput) + Enter(ux.js가 #calc-btn 을 감지) ──
  function onAmountInput(e) { reformatAmount(e.target); calculate(); }
  balEl.addEventListener("input", onAmountInput);
  floorEl.addEventListener("input", onAmountInput);
  fixedEl.addEventListener("input", onAmountInput);
  aprEl.addEventListener("input", calculate);
  pctEl.addEventListener("input", calculate);
  daysEl.addEventListener("input", calculate);
  curSel.addEventListener("change", calculate);
  calcBtn.addEventListener("click", calculate);
  function onEnter(e) { if (e.key === "Enter") calculate(); }
  [balEl, aprEl, pctEl, floorEl, daysEl, fixedEl].forEach(function (el) { el.addEventListener("keydown", onEnter); });

  // ── 언어 전환: 통화기호·동적 문구·Intl 포맷을 새 로케일로 재렌더 ──
  document.addEventListener("i18n:change", function () {
    fillCurrencies(curSel.value);
    if (lastRun && !box.hidden) calculate();
  });
  // TOOLJS:END
})();
