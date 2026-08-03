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
  var LS_KEY = (cfg.slug || "dividend-calc") + ":last";
  var SAFE = Number.MAX_SAFE_INTEGER;
  var LIM = { amount: 1e12, years: 50, g: 20, a: 20, infl: 20, tax: 60 };

  var CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CNY", "KRW", "INR", "BRL", "RUB",
    "IDR", "CAD", "AUD", "CHF", "HKD", "SGD", "TWD", "MXN", "ZAR", "TRY", "SEK"];
  var REGION_CCY = { US: "USD", GB: "GBP", JP: "JPY", CN: "CNY", HK: "HKD", TW: "TWD",
    KR: "KRW", IN: "INR", BR: "BRL", RU: "RUB", ID: "IDR", CA: "CAD", AU: "AUD",
    CH: "CHF", SG: "SGD", MX: "MXN", ZA: "ZAR", TR: "TRY", SE: "SEK",
    DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", PT: "EUR", IE: "EUR", AT: "EUR", FI: "EUR" };
  var LANG_CCY = { ko: "KRW", ja: "JPY", zh: "CNY", de: "EUR", fr: "EUR", es: "EUR",
    pt: "BRL", ru: "RUB", id: "IDR", hi: "INR", bn: "BDT", ar: "USD", ur: "PKR", en: "USD" };

  function $(id) { return document.getElementById(id); }
  var sharesEl = $("shares-input"), priceEl = $("price-input"), divEl = $("dividend-input");
  var divLabel = $("dividend-label"), curSel = $("currency-select");
  var yearsEl = $("years-input"), divgrowthEl = $("divgrowth-input"), pricegrowthEl = $("pricegrowth-input");
  var taxEl = $("tax-input"), inflEl = $("inflation-input"), reinvestEl = $("reinvest-toggle");
  var advEl = $("adv"), calcBtn = $("calc-btn");
  var box = $("result-box"), errEl = $("result-error"), bodyEl = $("result-body");
  if (!sharesEl || !priceEl || !divEl || !curSel || !calcBtn || !box) return;

  var mode = "amount";  // 'amount' (per-share dividend) | 'yield' (dividend yield %)
  var freq = 4;         // 1 | 2 | 4 | 12
  var lastRun = false;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function fmtLocale() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) || navigator.language || "en";
  }
  function safe(v) { if (!isFinite(v)) return 0; if (v > SAFE) return SAFE; if (v < -SAFE) return -SAFE; return v; }

  // ── 입력 파싱 (콤마·소수 허용) ──
  function digitsDecimal(s) {
    s = String(s).replace(/[^\d.]/g, "");
    var i = s.indexOf(".");
    if (i !== -1) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "");
    return s;
  }
  function groupDecimalInput(s) {
    s = digitsDecimal(s);
    if (s === "" || s === ".") return s;
    var parts = s.split(".");
    var intp = parts[0].replace(/^0+(?=\d)/, "");
    if (intp === "") intp = "0";
    intp = intp.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.length > 1 ? intp + "." + parts[1] : intp;
  }
  function parseAmount(el) {
    var s = digitsDecimal(el.value);
    if (s === "" || s === ".") return null;
    var v = Number(s);
    return isNaN(v) ? null : v;
  }
  function num(el) {
    if (!el) return null;
    var v = el.valueAsNumber;
    if (isNaN(v)) { var s = String(el.value).trim().replace(",", "."); v = s === "" ? NaN : Number(s); }
    return isNaN(v) ? null : v;
  }

  // ── Intl 포매팅 (하드코딩 없음 — 통화·천단위·소수 전부 Intl 위임, 지수표기 금지) ──
  function nf(opts) { try { return new Intl.NumberFormat(fmtLocale(), opts); } catch (e) { return new Intl.NumberFormat("en", opts); } }
  function cyDec(cur) { try { return nf({ style: "currency", currency: cur }).resolvedOptions().maximumFractionDigits; } catch (e) { return 2; } }
  function floorTo(v, dec) { var f = Math.pow(10, dec); return Math.floor(safe(v) * f) / f; }
  function money(v, cur) {
    var d = cyDec(cur);
    try { return nf({ style: "currency", currency: cur, minimumFractionDigits: d, maximumFractionDigits: d }).format(floorTo(v, d)); }
    catch (e) { return String(floorTo(v, d)); }
  }
  function signedMoney(v, cur) {
    v = safe(v);
    var s = money(Math.abs(v), cur);
    if (v > 0) return "+" + s;
    if (v < 0) return "−" + s;
    return s;
  }
  function price(v, cur) {
    var d = cyDec(cur);
    try { return nf({ style: "currency", currency: cur, minimumFractionDigits: d, maximumFractionDigits: Math.max(d, 4) }).format(safe(v)); }
    catch (e) { return String(safe(v)); }
  }
  function sharesFmt(v) { return nf({ maximumFractionDigits: 4 }).format(safe(v)); }
  function pctFmt(v) {
    if (v == null || !isFinite(v)) return "—";
    return nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safe(v)) + "%";
  }

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상, Math 외 DOM 의존 없음)
  // 전 인자 raw number, 통화무관. tax/g/a/infl 는 퍼센트 값(15 = 15%). D 는 연 주당배당.
  // 즉시지표: annualIncome=N·D, yield=D/P·100(P>0), afterTaxIncome=annualIncome·(1−tax/100).
  // projection: periods=Y·freq, reinvest on/off 두 시나리오 동시 시뮬(price·dps 는 재투자와 무관하게 동일 진화).
  function computeDividend(o) {
    var annualIncome = o.N * o.D;
    var yieldPct = o.P > 0 ? (o.D / o.P) * 100 : null;
    var afterTaxIncome = annualIncome * (1 - o.tax / 100);

    var hasProjection = o.Y >= 1 && o.P > 0;
    var proj = null;
    if (hasProjection) {
      var periods = Math.round(o.Y * o.freq);
      var pgPer = Math.pow(1 + o.a / 100, 1 / o.freq) - 1;   // 기간별 주가상승
      var dgPer = Math.pow(1 + o.g / 100, 1 / o.freq) - 1;   // 기간별 배당성장
      var taxRate = o.tax / 100;
      var price = o.P;
      var dps = o.D / o.freq;
      var shares = o.N;   // reinvest ON 시나리오의 누적 보유주식
      var cash = 0;       // reinvest OFF 시나리오의 누적 현금
      var totalNetDrip = 0, totalNetCash = 0;
      for (var i = 0; i < periods; i++) {
        // 재투자 ON: 현 보유주식 기준 배당 → 세후 → 현재가로 매수
        var netOn = (shares * dps) * (1 - taxRate);
        totalNetDrip += netOn;
        if (price > 0) shares += netOn / price;
        // 재투자 OFF: 최초 주식수 고정, 세후 배당을 현금 적립
        var netOff = (o.N * dps) * (1 - taxRate);
        totalNetCash += netOff;
        cash += netOff;
        // 다음 기간으로 진화
        price *= (1 + pgPer);
        dps *= (1 + dgPer);
      }
      var priceFinal = price;
      var dripValue = shares * priceFinal;
      var noDripValue = o.N * priceFinal + cash;
      var dripAdvantage = dripValue - noDripValue;
      var sharesEnd = o.reinvest ? shares : o.N;
      var endPerShareAnnual = o.D * Math.pow(1 + o.g / 100, o.Y);   // Y년차 주당 연배당
      var endAnnualIncome = sharesEnd * endPerShareAnnual;
      var cost = o.N * o.P;
      var yieldOnCost = cost > 0 ? (endAnnualIncome / cost) * 100 : null;
      var headlineValue = o.reinvest ? dripValue : noDripValue;
      var realValue = Math.floor(safe(headlineValue) / Math.pow(1 + o.infl / 100, o.Y));
      var totalNet = o.reinvest ? totalNetDrip : totalNetCash;
      proj = {
        periods: periods, priceFinal: priceFinal, sharesEnd: sharesEnd,
        dripValue: dripValue, noDripValue: noDripValue, dripAdvantage: dripAdvantage,
        endAnnualIncome: endAnnualIncome, yieldOnCost: yieldOnCost,
        headlineValue: headlineValue, realValue: realValue, totalNet: totalNet
      };
    }
    return {
      annualIncome: annualIncome, yieldPct: yieldPct, afterTaxIncome: afterTaxIncome,
      hasProjection: hasProjection, proj: proj
    };
  }
  // calc-core:end

  // ── 통화 셀렉터 (형제 finance 엔진 재사용) ──
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

  function updateModeLabel() {
    if (mode === "yield") {
      divLabel.textContent = t("tool.div.labelYield", "Dividend yield (% per year)");
      divEl.setAttribute("placeholder", t("tool.div.phYield", "e.g. 4"));
    } else {
      divLabel.textContent = t("tool.div.labelAmount", "Annual dividend (per share)");
      divEl.setAttribute("placeholder", t("tool.div.phAmount", "e.g. 2"));
    }
  }

  function showNotice(key, fallback) {
    lastRun = true;
    box.hidden = false; bodyEl.hidden = true; errEl.hidden = false;
    errEl.textContent = t(key, fallback);
    persist(); updateChips();
  }

  function calculate() {
    lastRun = true;
    var cur = curSel.value || "USD";
    var clipped = false;

    var N = parseAmount(sharesEl);
    var P = parseAmount(priceEl);

    // 엣지: 보유주식 미입력 / N ≤ 0  (음수 주식 포함)
    if (N == null || N <= 0) { showNotice("tool.err.empty", "Enter shares owned and share price to see your dividend income."); return; }
    // 엣지: 주가 미입력 (빈값) — 0 은 아래에서 별도 처리(pZero)
    if (P == null) { showNotice("tool.err.empty", "Enter shares owned and share price to see your dividend income."); return; }

    // 음수·상한 클램프
    if (N > LIM.amount) { N = LIM.amount; clipped = true; }
    if (P < 0) { P = 0; clipped = true; }
    if (P > LIM.amount) { P = LIM.amount; clipped = true; }

    // 배당 입력 (모드별) — 빈값 0(무배당, 오류 아님), 음수 0 클램프
    var divVal = num(divEl);
    if (divVal == null) divVal = 0;
    if (divVal < 0) { divVal = 0; clipped = true; }
    if (divVal > LIM.amount) { divVal = LIM.amount; clipped = true; }
    var D;
    if (mode === "yield") { D = P > 0 ? P * divVal / 100 : 0; }
    else { D = divVal; }
    if (D > LIM.amount) { D = LIM.amount; clipped = true; }

    // 고급 파라미터 — 빈값 0, 음수 0 클램프, 상한 클램프
    var Y = num(yearsEl); Y = Y == null ? 0 : Math.floor(Y);
    if (Y < 0) { Y = 0; clipped = true; }
    if (Y > LIM.years) { Y = LIM.years; clipped = true; }

    var g = num(divgrowthEl); g = g == null ? 0 : g;
    if (g < 0) { g = 0; clipped = true; }
    if (g > LIM.g) { g = LIM.g; clipped = true; }

    var a = num(pricegrowthEl); a = a == null ? 0 : a;
    if (a < 0) { a = 0; clipped = true; }
    if (a > LIM.a) { a = LIM.a; clipped = true; }

    var tax = num(taxEl); tax = tax == null ? 0 : tax;
    if (tax < 0) { tax = 0; clipped = true; }
    if (tax > LIM.tax) { tax = LIM.tax; clipped = true; }

    var infl = num(inflEl); infl = infl == null ? 0 : infl;
    if (infl < 0) { infl = 0; clipped = true; }
    if (infl > LIM.infl) { infl = LIM.infl; clipped = true; }

    var reinvest = !!(reinvestEl && reinvestEl.checked);

    var r = computeDividend({ N: N, P: P, D: D, Y: Y, freq: freq, g: g, a: a, tax: tax, reinvest: reinvest, infl: infl });

    // 계산값 MAX_SAFE 초과 가드 → 클리핑 노트
    var probes = [r.annualIncome];
    if (r.proj) probes.push(r.proj.dripValue, r.proj.noDripValue, r.proj.headlineValue, r.proj.totalNet);
    if (probes.some(function (v) { return !isFinite(v) || Math.abs(v) > SAFE; })) clipped = true;

    render({ r: r, cur: cur, N: N, P: P, D: D, tax: tax, infl: infl, reinvest: reinvest, clipped: clipped });
    persist(); updateChips();
  }

  function render(s) {
    var r = s.r, cur = s.cur;
    errEl.hidden = true; bodyEl.hidden = false; box.hidden = false;

    // 헤드라인: projection ON → 미래 자산 강조 / OFF → 배당수익률 강조 (P=0 이면 연배당소득)
    var headEl = $("r-headline-val"), headLabel = $("r-headline-label");
    if (r.hasProjection) {
      headEl.textContent = money(r.proj.headlineValue, cur);
      headLabel.textContent = t("tool.result.futureHeadline", "Future portfolio value");
    } else if (s.P > 0) {
      headEl.textContent = pctFmt(r.yieldPct);
      headLabel.textContent = t("tool.result.yieldHeadline", "Dividend yield");
    } else {
      headEl.textContent = money(r.annualIncome, cur);
      headLabel.textContent = t("tool.result.income", "Annual dividend income");
    }

    $("r-sub").textContent = t("tool.result.sub", "{shares} shares · {price}/share · {dps}/yr dividend")
      .replace("{shares}", sharesFmt(s.N)).replace("{price}", price(s.P, cur)).replace("{dps}", price(s.D, cur));

    // 즉시 카드
    $("r-income").textContent = money(r.annualIncome, cur);
    $("r-yield").textContent = pctFmt(r.yieldPct);
    var atCard = $("aftertax-card");
    if (s.tax > 0) { atCard.hidden = false; $("r-aftertax").textContent = money(r.afterTaxIncome, cur); }
    else atCard.hidden = true;

    // projection 카드
    var projCards = $("projection-cards"), dripLine = $("r-drip-line");
    if (r.hasProjection) {
      projCards.hidden = false;
      $("r-totaldiv").textContent = money(r.proj.totalNet, cur);
      $("r-dripadv").textContent = signedMoney(r.proj.dripAdvantage, cur);
      $("r-yieldoncost").textContent = pctFmt(r.proj.yieldOnCost);
      $("r-real").textContent = money(r.proj.realValue, cur);
      $("r-real-badge").hidden = !(s.infl > 0);
      if (s.reinvest && r.proj.dripAdvantage > 0) {
        dripLine.hidden = false;
        dripLine.textContent = t("tool.result.dripLine", "Reinvesting adds {adv} over taking dividends as cash.")
          .replace("{adv}", money(r.proj.dripAdvantage, cur));
      } else dripLine.hidden = true;
    } else {
      projCards.hidden = true;
      dripLine.hidden = true;
    }

    // 안내 노트 (조용한 실패 금지)
    var pnote = $("r-pnote");
    if (s.P <= 0) { pnote.hidden = false; pnote.textContent = t("tool.note.pZero", "Enter a share price above 0 for yield and reinvestment (dividends can't reinvest at a 0 price)."); }
    else pnote.hidden = true;
    var dnote = $("r-dnote");
    if (s.D <= 0) { dnote.hidden = false; dnote.textContent = t("tool.note.dZero", "Enter an annual dividend or yield to see income."); }
    else dnote.hidden = true;
    $("r-clipped").hidden = !s.clipped;
  }

  function persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        shares: sharesEl.value, price: priceEl.value, dividend: divEl.value, mode: mode,
        currency: curSel.value, years: yearsEl.value, freq: freq,
        dg: divgrowthEl.value, pg: pricegrowthEl.value, tax: taxEl.value, infl: inflEl.value,
        reinvest: !!(reinvestEl && reinvestEl.checked)
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }
  }

  // ── 칩 상태 ──
  function markChips(sel, attr, raw) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) {
      els[i].classList.toggle("is-active", raw !== "" && Number(els[i].getAttribute(attr)) === Number(raw));
    }
  }
  function updateChips() {
    // 세그먼트 칩(모드·주기)은 상태값과 매칭
    var mc = document.querySelectorAll("#mode-chips .chip");
    for (var i = 0; i < mc.length; i++) mc[i].classList.toggle("is-active", mc[i].getAttribute("data-mode") === mode);
    var fc = document.querySelectorAll("#freq-chips .chip");
    for (var j = 0; j < fc.length; j++) fc[j].classList.toggle("is-active", Number(fc[j].getAttribute("data-freq")) === freq);
    markChips("#years-chips .chip", "data-years", yearsEl.value.trim());
    markChips("#divgrowth-chips .chip", "data-dg", divgrowthEl.value.trim().replace(",", "."));
    markChips("#pricegrowth-chips .chip", "data-pg", pricegrowthEl.value.trim().replace(",", "."));
    markChips("#inflation-chips .chip", "data-infl", inflEl.value.trim().replace(",", "."));
    markChips("#preset-chips .chip", "data-tax", taxEl.value.trim().replace(",", "."));
  }

  // ── 초기화 · 복원 ──
  (function init() {
    var saved = null;
    try { var s = localStorage.getItem(LS_KEY); if (s) saved = JSON.parse(s); } catch (e) { saved = null; }

    fillCurrencies((saved && saved.currency) || detectCurrency());
    if (saved) {
      if (saved.mode === "yield" || saved.mode === "amount") mode = saved.mode;
      if (saved.freq === 1 || saved.freq === 2 || saved.freq === 4 || saved.freq === 12) freq = saved.freq;
      if (saved.shares) sharesEl.value = groupDecimalInput(saved.shares);
      if (saved.price) priceEl.value = groupDecimalInput(saved.price);
      if (saved.dividend) divEl.value = saved.dividend;
      if (saved.years) yearsEl.value = saved.years;
      if (saved.dg) divgrowthEl.value = saved.dg;
      if (saved.pg) pricegrowthEl.value = saved.pg;
      if (saved.tax) taxEl.value = saved.tax;
      if (saved.infl) inflEl.value = saved.infl;
      if (reinvestEl && saved.reinvest === false) reinvestEl.checked = false;
      var advTouched = [yearsEl, divgrowthEl, pricegrowthEl, taxEl, inflEl].some(function (el) { return el.value && Number(el.value) > 0; })
        || freq !== 4 || (reinvestEl && !reinvestEl.checked);
      if (advTouched && advEl) advEl.open = true;
    }
    updateModeLabel();
    if (parseAmount(sharesEl) != null && parseAmount(priceEl) != null) calculate();
    else updateChips();
  })();

  // ── 이벤트 배선: 실시간 재계산(oninput) + Enter ──
  function formatAmount(el) { el.value = groupDecimalInput(el.value); }
  sharesEl.addEventListener("input", function () { formatAmount(sharesEl); calculate(); });
  priceEl.addEventListener("input", function () { formatAmount(priceEl); calculate(); });
  [divEl, yearsEl, divgrowthEl, pricegrowthEl, taxEl, inflEl].forEach(function (el) { el.addEventListener("input", calculate); });
  curSel.addEventListener("change", calculate);
  if (reinvestEl) reinvestEl.addEventListener("change", calculate);
  calcBtn.addEventListener("click", calculate);

  function wireValueChips(sel, attr, targetEl) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) {
      els[i].addEventListener("click", function () { targetEl.value = this.getAttribute(attr); calculate(); });
    }
  }
  wireValueChips("#years-chips .chip", "data-years", yearsEl);
  wireValueChips("#divgrowth-chips .chip", "data-dg", divgrowthEl);
  wireValueChips("#pricegrowth-chips .chip", "data-pg", pricegrowthEl);
  wireValueChips("#inflation-chips .chip", "data-infl", inflEl);
  wireValueChips("#preset-chips .chip", "data-tax", taxEl);

  var modeChips = document.querySelectorAll("#mode-chips .chip");
  for (var mi = 0; mi < modeChips.length; mi++) {
    modeChips[mi].addEventListener("click", function () { mode = this.getAttribute("data-mode"); updateModeLabel(); calculate(); });
  }
  var freqChips = document.querySelectorAll("#freq-chips .chip");
  for (var fi = 0; fi < freqChips.length; fi++) {
    freqChips[fi].addEventListener("click", function () { freq = Number(this.getAttribute("data-freq")); if (advEl) advEl.open = true; calculate(); });
  }

  function onEnter(e) { if (e.key === "Enter") calculate(); }
  [sharesEl, priceEl, divEl, yearsEl, divgrowthEl, pricegrowthEl, taxEl, inflEl].forEach(function (el) { el.addEventListener("keydown", onEnter); });

  // ── 언어 전환: 동적 문구·Intl 포맷을 새 로케일로 재렌더 ──
  document.addEventListener("i18n:change", function () {
    updateModeLabel();
    if (lastRun) calculate();
  });
  // TOOLJS:END
})();
