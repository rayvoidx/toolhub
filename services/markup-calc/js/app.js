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
  var LS_KEY = (cfg.slug || "markup-calc") + ":last";
  var SAFE = Number.MAX_SAFE_INTEGER;
  var LIM = { amount: 1e15, markupMax: 100000, markupMin: -100 };

  var CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CNY", "KRW", "INR", "BRL", "RUB",
    "IDR", "CAD", "AUD", "CHF", "HKD", "SGD", "TWD", "MXN", "ZAR", "TRY", "SEK"];
  var REGION_CCY = { US: "USD", GB: "GBP", JP: "JPY", CN: "CNY", HK: "HKD", TW: "TWD",
    KR: "KRW", IN: "INR", BR: "BRL", RU: "RUB", ID: "IDR", CA: "CAD", AU: "AUD",
    CH: "CHF", SG: "SGD", MX: "MXN", ZA: "ZAR", TR: "TRY", SE: "SEK",
    DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", PT: "EUR", IE: "EUR", AT: "EUR", FI: "EUR" };
  var LANG_CCY = { ko: "KRW", ja: "JPY", zh: "CNY", de: "EUR", fr: "EUR", es: "EUR",
    pt: "BRL", ru: "RUB", id: "IDR", hi: "INR", bn: "BDT", ar: "USD", ur: "PKR", en: "USD" };

  // 마크업 ↔ 마진 조견표 프리셋 (%) — 브리프 명시 예시(25/50/100%)를 포함
  var TABLE_MARKUPS = [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 150, 200, 300];
  var CHIP_MARKUPS = [10, 20, 25, 30, 50, 75, 100, 150, 200];

  function $(id) { return document.getElementById(id); }
  var curSel = $("currency-select");
  var tabPrice = $("tab-price"), tabMarkup = $("tab-markup");
  var modePrice = $("mode-price"), modeMarkup = $("mode-markup");
  var pCost = $("p-cost"), pMarkup = $("p-markup"), pCalc = $("p-calc"), pChips = $("p-chips");
  var pEmpty = $("p-empty"), pErr = $("p-err"), pGrid = $("p-grid");
  var mCost = $("m-cost"), mPrice = $("m-price"), mCalc = $("m-calc");
  var mEmpty = $("m-empty"), mErr = $("m-err"), mGrid = $("m-grid");
  var tableBody = $("markup-table-body");
  if (!curSel || !tabPrice || !tabMarkup || !pCost || !mCost || !tableBody) return;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function fmtLocale() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) || navigator.language || "en";
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
  function pctFmt(frac, withSign) {
    var x = safe(frac * 100);
    var s = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x) + "%";
    return (withSign && x > 0) ? "+" + s : s;
  }
  function pctPlain(x) { return nf({ minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(safe(x)) + "%"; }

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

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상, Math·Intl 외 DOM 의존 없음)
  // markup% = 이익 ÷ 원가 × 100 (원가 기준) · margin% = 이익 ÷ 판매가 × 100 (판매가 기준)
  // 같은 이익이라도 분모가 달라 두 값은 항상 다르다 (markup > margin, cost>0 일 때).
  function markupFromCost(cost, markupPct) {
    var mk = markupPct / 100;
    if (mk < LIM.markupMin / 100) mk = LIM.markupMin / 100;
    if (mk > LIM.markupMax / 100) mk = LIM.markupMax / 100;
    var price = cost * (1 + mk);
    var profit = price - cost;
    var marginFrac = price !== 0 ? (profit / price) : null;
    return { ok: true, cost: cost, price: price, profit: profit, markupFrac: mk, marginFrac: marginFrac };
  }
  function markupFromPrice(cost, price) {
    var profit = price - cost;
    var markupFrac = cost !== 0 ? (profit / cost) : null;
    var marginFrac = price !== 0 ? (profit / price) : null;
    return { ok: true, cost: cost, price: price, profit: profit, markupFrac: markupFrac, marginFrac: marginFrac };
  }
  // calc-core:end

  var lastMode = "price";
  var lastRun = { price: false, markup: false };

  function showEmpty(emptyEl, errEl, gridEl) {
    emptyEl.hidden = false; errEl.hidden = true; gridEl.hidden = true;
  }
  function showError(emptyEl, errEl, gridEl, msg) {
    emptyEl.hidden = true; errEl.hidden = false; errEl.textContent = msg; gridEl.hidden = true;
  }
  function showGrid(emptyEl, errEl, gridEl) {
    emptyEl.hidden = true; errEl.hidden = true; gridEl.hidden = false;
  }

  function setPL(el, v) {
    el.className = "rc-val " + (v > 0 ? "pl-pos" : (v < 0 ? "pl-neg" : ""));
  }

  // ── 모드 A: 원가 + 마크업% → 판매가 ──
  function calcPrice() {
    lastRun.price = true;
    var cur = curSel.value || "USD";
    var cost = parseAmount(pCost);
    var mkInput = num(pMarkup);
    persist();

    if (cost == null || mkInput == null) return showEmpty(pEmpty, pErr, pGrid);
    if (cost <= 0) return showError(pEmpty, pErr, pGrid, t("tool.err.cost", "Cost must be greater than 0."));
    if (cost > LIM.amount) cost = LIM.amount;
    if (mkInput < LIM.markupMin) return showError(pEmpty, pErr, pGrid, t("tool.err.markupRange", "Markup % can't be less than -100% (that would mean a negative price)."));
    if (mkInput > LIM.markupMax) return showError(pEmpty, pErr, pGrid, t("tool.err.markupMax", "Markup % can't be higher than 100,000%. Enter a smaller value."));

    var r = markupFromCost(cost, mkInput);
    showGrid(pEmpty, pErr, pGrid);

    $("p-r-price").textContent = money(r.price, cur);
    var profitEl = $("p-r-profit");
    profitEl.textContent = moneySigned(r.profit, cur);
    setPL(profitEl, r.profit);
    var marginEl = $("p-r-margin");
    var zeroNote = $("p-r-zero");
    if (r.marginFrac == null) {
      marginEl.textContent = "—";
      zeroNote.hidden = false;
      zeroNote.textContent = t("tool.result.zeroPrice", "Selling price is 0 — margin % is undefined (division by zero). This is a full loss of the cost.");
    } else {
      marginEl.textContent = pctFmt(r.marginFrac, true);
      setPL(marginEl, r.marginFrac);
      zeroNote.hidden = true;
    }
    $("p-r-sub").textContent = t("tool.price.sub", "A {markup}% markup on {cost} gives a selling price of {price}.")
      .replace("{markup}", pctPlain(mkInput)).replace("{cost}", money(cost, cur)).replace("{price}", money(r.price, cur));

    updateChips(mkInput);
    highlightTable(mkInput);
  }

  // ── 모드 B: 원가 + 판매가 → 마크업%, 마진% ──
  function calcMarkup() {
    lastRun.markup = true;
    var cur = curSel.value || "USD";
    var cost = parseAmount(mCost);
    var price = parseAmount(mPrice);
    persist();

    if (cost == null || price == null) return showEmpty(mEmpty, mErr, mGrid);
    if (cost <= 0) return showError(mEmpty, mErr, mGrid, t("tool.err.cost", "Cost must be greater than 0."));
    if (price < 0) return showError(mEmpty, mErr, mGrid, t("tool.err.priceNeg", "Selling price can't be negative."));
    if (cost > LIM.amount) cost = LIM.amount;
    if (price > LIM.amount) price = LIM.amount;

    var r = markupFromPrice(cost, price);
    showGrid(mEmpty, mErr, mGrid);

    var profitEl = $("m-r-profit");
    profitEl.textContent = moneySigned(r.profit, cur);
    setPL(profitEl, r.profit);
    var markupEl = $("m-r-markup");
    markupEl.textContent = pctFmt(r.markupFrac, true);
    setPL(markupEl, r.markupFrac);
    var marginEl = $("m-r-margin");
    var zeroNote = $("m-r-zero");
    if (r.marginFrac == null) {
      marginEl.textContent = "—";
      zeroNote.hidden = false;
      zeroNote.textContent = t("tool.result.zeroPrice", "Selling price is 0 — margin % is undefined (division by zero). This is a full loss of the cost.");
    } else {
      marginEl.textContent = pctFmt(r.marginFrac, true);
      setPL(marginEl, r.marginFrac);
      zeroNote.hidden = true;
    }
    $("m-r-sub").textContent = t("tool.markup.sub", "Selling {cost} for {price} is a {markup}% markup ({margin}% margin).")
      .replace("{cost}", money(cost, cur)).replace("{price}", money(price, cur))
      .replace("{markup}", pctFmt(r.markupFrac)).replace("{margin}", r.marginFrac == null ? "—" : pctFmt(r.marginFrac));
  }

  function updateChips(mkInput) {
    var chips = pChips.querySelectorAll(".chip");
    for (var i = 0; i < chips.length; i++) {
      var dv = Number(chips[i].getAttribute("data-markup"));
      chips[i].classList.toggle("is-active", mkInput != null && dv === mkInput);
    }
  }

  // ── 조견표: 마크업% → 마진% (정적 프리셋, 로케일 재렌더) ──
  function renderTable() {
    tableBody.innerHTML = "";
    for (var i = 0; i < TABLE_MARKUPS.length; i++) {
      var m = TABLE_MARKUPS[i];
      var margin = m / (100 + m) * 100;
      var tr = document.createElement("tr");
      tr.setAttribute("data-markup", String(m));
      var td1 = document.createElement("td");
      td1.textContent = pctPlain(m);
      var td2 = document.createElement("td");
      td2.textContent = pctPlain(margin);
      var td3 = document.createElement("td");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "use-btn";
      btn.setAttribute("data-markup", String(m));
      btn.textContent = t("tool.table.use", "Use");
      td3.appendChild(btn);
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
      tableBody.appendChild(tr);
    }
  }
  function onTableClick(e) {
    var btn = e.target.closest ? e.target.closest(".use-btn") : null;
    if (!btn) return;
    var m = btn.getAttribute("data-markup");
    switchTab("price");
    pMarkup.value = m;
    calcPrice();
    pMarkup.focus();
  }
  function highlightTable(mkInput) {
    var rows = tableBody.querySelectorAll("tr");
    for (var i = 0; i < rows.length; i++) {
      var dv = Number(rows[i].getAttribute("data-markup"));
      rows[i].classList.toggle("is-active", mkInput != null && dv === mkInput);
    }
  }

  // ── 탭 전환 ──
  function switchTab(mode) {
    lastMode = mode;
    var isPrice = mode === "price";
    tabPrice.classList.toggle("active", isPrice);
    tabPrice.setAttribute("aria-selected", isPrice ? "true" : "false");
    tabMarkup.classList.toggle("active", !isPrice);
    tabMarkup.setAttribute("aria-selected", !isPrice ? "true" : "false");
    modePrice.hidden = !isPrice;
    modeMarkup.hidden = isPrice;
    persist();
  }

  function persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        mode: lastMode, currency: curSel.value,
        pCost: pCost.value, pMarkup: pMarkup.value,
        mCost: mCost.value, mPrice: mPrice.value
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }
  }

  // ── 초기화 · 복원 (상태는 프로세스 밖 — 철칙 1) ──
  (function init() {
    var saved = null;
    try { var s = localStorage.getItem(LS_KEY); if (s) saved = JSON.parse(s); } catch (e) { saved = null; }
    var startCur = (saved && saved.currency) || detectCurrency();
    fillCurrencies(startCur);
    renderTable();
    tableBody.addEventListener("click", onTableClick);
    if (saved) {
      if (saved.pCost) pCost.value = saved.pCost;
      if (saved.pMarkup) pMarkup.value = saved.pMarkup;
      if (saved.mCost) mCost.value = saved.mCost;
      if (saved.mPrice) mPrice.value = saved.mPrice;
      switchTab(saved.mode === "markup" ? "markup" : "price");
    } else {
      switchTab("price");
    }
    if (parseAmount(pCost) != null && num(pMarkup) != null) calcPrice();
    if (parseAmount(mCost) != null && parseAmount(mPrice) != null) calcMarkup();
  })();

  // ── 이벤트 배선: 실시간 재계산(oninput) + Enter ──
  function onAmountInput(el, fn) { return function () { reformatAmount(el); fn(); }; }
  pCost.addEventListener("input", onAmountInput(pCost, calcPrice));
  pMarkup.addEventListener("input", calcPrice);
  mCost.addEventListener("input", onAmountInput(mCost, calcMarkup));
  mPrice.addEventListener("input", onAmountInput(mPrice, calcMarkup));
  curSel.addEventListener("change", function () { calcPrice(); calcMarkup(); });
  pCalc.addEventListener("click", calcPrice);
  mCalc.addEventListener("click", calcMarkup);
  function onEnter(fn) { return function (e) { if (e.key === "Enter") fn(); }; }
  pCost.addEventListener("keydown", onEnter(calcPrice));
  pMarkup.addEventListener("keydown", onEnter(calcPrice));
  mCost.addEventListener("keydown", onEnter(calcMarkup));
  mPrice.addEventListener("keydown", onEnter(calcMarkup));

  tabPrice.addEventListener("click", function () { switchTab("price"); });
  tabMarkup.addEventListener("click", function () { switchTab("markup"); });

  var chipEls = pChips.querySelectorAll(".chip");
  for (var ci = 0; ci < chipEls.length; ci++) {
    chipEls[ci].addEventListener("click", function () {
      pMarkup.value = this.getAttribute("data-markup");
      calcPrice();
    });
  }

  // ── 언어 전환: 통화기호·조견표·동적 문구·Intl 포맷을 새 로케일로 재렌더 ──
  document.addEventListener("i18n:change", function () {
    fillCurrencies(curSel.value);
    renderTable();
    if (lastRun.price && !pGrid.hidden) calcPrice();
    if (lastRun.markup && !mGrid.hidden) calcMarkup();
  });
  // TOOLJS:END
})();
