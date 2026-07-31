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
  /* Electricity Cost Calculator — appliance watts (or kW) × hours/day × price/kWh → cost/day/month/year.
     Multi-appliance table: add rows freely, or one-tap a preset (fridge, AC, heater, TV, PC, LED bulb)
     that fills a typical wattage + hours/day you can then fine-tune. Pure-static: all math runs locally,
     nothing is ever sent anywhere. State (price, currency, rows) persists in localStorage only. */

  /* ============================================================
     PURE — DOM-agnostic core math (node 단위검증 대상).
     ============================================================ */

  var DAYS_PER_MONTH = 365 / 12; // 30.4166… — chosen so monthly × 12 = yearly exactly
  var DAYS_PER_YEAR = 365;

  /** String → finite number, or NaN if blank/invalid. Never collapses "empty" into 0 —
      callers decide how to treat "not entered yet" vs. "entered as zero". */
  function pnum(raw) {
    if (raw == null) return NaN;
    var s = String(raw).trim();
    if (s === "") return NaN;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  /** One appliance row → { valid, kwhPerDay, hoursCapped, qty, hoursEff }.
      row = { watts, unit ("W"|"kW"), qty, hours } — all raw strings from the input fields.
      - No watts (blank/0/negative/NaN) → valid:false, kwhPerDay:0 (row excluded from totals,
        but still rendered — the row itself shows nothing rather than a false "0" reading).
      - Qty: blank/invalid/<1 → normalized to 1 (a single appliance is the sane default).
      - Hours: blank/NaN → 0 (no usage entered yet = no energy yet, not an error).
        Negative → 0. Above 24 → capped at 24 and flagged (a day only has 24 hours). */
  function computeRow(row) {
    var wattsRaw = pnum(row.watts);
    var valid = isFinite(wattsRaw) && wattsRaw > 0;
    var wattsAbs = valid ? Math.abs(wattsRaw) : 0;
    var powerW = (row.unit === "kW") ? wattsAbs * 1000 : wattsAbs;

    var qtyRaw = pnum(row.qty);
    var qty = (isFinite(qtyRaw) && qtyRaw >= 1) ? Math.floor(qtyRaw) : 1;

    var hoursRaw = pnum(row.hours);
    var hasHours = isFinite(hoursRaw);
    var hoursCapped = hasHours && hoursRaw > 24;
    var hoursEff = hasHours ? Math.min(Math.max(hoursRaw, 0), 24) : 0;

    var kwhPerDay = valid ? (powerW * hoursEff * qty) / 1000 : 0;
    return { valid: valid, kwhPerDay: kwhPerDay, hoursCapped: hoursCapped, qty: qty, hoursEff: hoursEff };
  }

  /** All rows + a price/kWh (raw string) → totals. Blank/0 price still returns full kWh figures
      (hasPrice:false) — usage is meaningful even before a rate is entered (steel-man of the
      "silent failure" rule: showing kWh without cost is a real, useful partial result). */
  function computeTotals(rows, priceRaw) {
    var kwhDay = 0, any = false, i, r;
    rows = rows || [];
    for (i = 0; i < rows.length; i++) {
      r = computeRow(rows[i]);
      if (r.valid) { kwhDay += r.kwhPerDay; any = true; }
    }
    var priceNum = pnum(priceRaw);
    var hasPrice = isFinite(priceNum) && priceNum > 0;
    var costDay = hasPrice ? kwhDay * priceNum : 0;
    return {
      any: any, hasPrice: hasPrice,
      kwhDay: kwhDay, kwhMonth: kwhDay * DAYS_PER_MONTH, kwhYear: kwhDay * DAYS_PER_YEAR,
      costDay: costDay, costMonth: costDay * DAYS_PER_MONTH, costYear: costDay * DAYS_PER_YEAR
    };
  }

  // node 단위 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      pnum: pnum, computeRow: computeRow, computeTotals: computeTotals,
      DAYS_PER_MONTH: DAYS_PER_MONTH, DAYS_PER_YEAR: DAYS_PER_YEAR
    };
  }

  /* ============================================================
     UI — 여기서부터 DOM. 도구 마크업이 없으면(테스트 등) 아무것도 하지 않는다.
     ============================================================ */
  var $ = function (id) { return document.getElementById(id); };
  if (typeof document === "undefined" || !$("ecc-price")) return;

  var cfg = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "electricity-cost-calc";
  var SKEY = SLUG + ":state";

  // 공통 프리셋 — 참고용 평균치(제품 라벨과 다를 수 있음). key 는 tool.preset.<key> 로 번역.
  var PRESETS = [
    { key: "fridge", emoji: "🧊", watts: 150, hours: 24 },
    { key: "ac", emoji: "❄️", watts: 1500, hours: 8 },
    { key: "heater", emoji: "🔥", watts: 1500, hours: 5 },
    { key: "tv", emoji: "📺", watts: 100, hours: 5 },
    { key: "pc", emoji: "💻", watts: 200, hours: 6 },
    { key: "bulb", emoji: "💡", watts: 9, hours: 5 }
  ];

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

  /* ---- i18n / Intl helpers ---- */
  function t(key, vars) {
    var s = null;
    try { if (window.I18N) s = window.I18N.t(key); } catch (e) { /* noop */ }
    if (s == null) s = "";
    if (vars) { for (var k in vars) { if (vars.hasOwnProperty(k)) s = s.split("{" + k + "}").join(vars[k]); } }
    return s;
  }
  function lang() {
    try { return (window.I18N && window.I18N.lang && window.I18N.lang()) || "en"; }
    catch (e) { return "en"; }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function nf(opts) { try { return new Intl.NumberFormat(lang(), opts); } catch (e) { return new Intl.NumberFormat("en", opts); } }
  function fmtKwh(v) { return nf({ minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v); }
  function curDecimals(cur) {
    try { return nf({ style: "currency", currency: cur }).resolvedOptions().maximumFractionDigits; }
    catch (e) { return 2; }
  }
  function fmtMoney(v, cur) {
    var d = curDecimals(cur);
    try { return nf({ style: "currency", currency: cur, minimumFractionDigits: d, maximumFractionDigits: d }).format(v); }
    catch (e) { return cur + " " + Number(v).toFixed(2); }
  }
  function curSymbol(cur) {
    try {
      var parts = nf({ style: "currency", currency: cur }).formatToParts(0);
      for (var i = 0; i < parts.length; i++) if (parts[i].type === "currency") return parts[i].value;
    } catch (e) { /* noop */ }
    return cur;
  }

  /* ---- state (localStorage, prefix cfg.slug + ":") ---- */
  function loadState() {
    try {
      var raw = localStorage.getItem(SKEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      return (obj && typeof obj === "object") ? obj : null;
    } catch (e) { return null; } // private mode / corrupt JSON — start fresh, don't throw
  }
  function saveState() {
    try { localStorage.setItem(SKEY, JSON.stringify(state)); } catch (e) { /* noop */ }
  }

  var state = { price: "", currency: detectCurrency(), rows: [] };
  var savedState = loadState();
  if (savedState) {
    if (typeof savedState.price === "string") state.price = savedState.price;
    if (typeof savedState.currency === "string" && savedState.currency) state.currency = savedState.currency;
    if (Array.isArray(savedState.rows)) {
      state.rows = savedState.rows
        .filter(function (r) { return r && typeof r === "object"; })
        .map(function (r) {
          return {
            name: String(r.name == null ? "" : r.name),
            watts: String(r.watts == null ? "" : r.watts),
            unit: r.unit === "kW" ? "kW" : "W",
            qty: String(r.qty == null ? "1" : r.qty),
            hours: String(r.hours == null ? "" : r.hours)
          };
        });
    }
  }

  /* ---- DOM refs ---- */
  var priceEl = $("ecc-price"), curSel = $("ecc-currency"), presetsWrap = $("ecc-presets");
  var rowsHost = $("ecc-rows"), addBtn = $("ecc-add");
  var resultEmpty = $("result-empty"), resultBody = $("result-body"), rateHintEl = $("rate-hint");
  var rKwhDay = $("r-kwh-day"), rKwhMonth = $("r-kwh-month"), rKwhYear = $("r-kwh-year");
  var rCostDay = $("r-cost-day"), rCostMonth = $("r-cost-month"), rCostYear = $("r-cost-year");
  if (!rowsHost || !addBtn || !resultEmpty || !resultBody) return;

  /* ---- currency select ---- */
  function fillCurrencies() {
    if (!curSel) return;
    var list = CURRENCIES.slice();
    if (list.indexOf(state.currency) === -1) list.unshift(state.currency);
    curSel.innerHTML = "";
    for (var i = 0; i < list.length; i++) {
      var opt = document.createElement("option");
      opt.value = list[i];
      opt.textContent = list[i] + " (" + curSymbol(list[i]) + ")";
      curSel.appendChild(opt);
    }
    curSel.value = state.currency;
  }

  /* ---- quick-add preset chips ---- */
  function renderPresetChips() {
    if (!presetsWrap) return;
    presetsWrap.textContent = "";
    for (var i = 0; i < PRESETS.length; i++) {
      var p = PRESETS[i];
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.setAttribute("data-preset", p.key);
      var emojiSpan = document.createElement("span");
      emojiSpan.setAttribute("aria-hidden", "true");
      emojiSpan.textContent = p.emoji;
      b.appendChild(emojiSpan);
      b.appendChild(document.createTextNode(" " + t("tool.preset." + p.key)));
      (function (preset) { b.addEventListener("click", function () { addRow(preset); }); })(p);
      presetsWrap.appendChild(b);
    }
  }

  /* ---- rows: add / remove / render ---- */
  function addRow(preset) {
    var row = preset
      ? { name: t("tool.preset." + preset.key), watts: String(preset.watts), unit: "W", qty: "1", hours: String(preset.hours) }
      : { name: "", watts: "", unit: "W", qty: "1", hours: "" };
    state.rows.push(row);
    saveState();
    renderRows();
    recalc();
    if (!preset) {
      var nameEl = rowsHost.querySelector('.ecc-row[data-i="' + (state.rows.length - 1) + '"] .ecc-r-name');
      if (nameEl) { try { nameEl.focus(); } catch (e) { /* noop */ } }
    }
  }

  function rowHTML(row, i) {
    return "" +
      '<div class="ecc-row" data-i="' + i + '">' +
        '<div class="ecc-row-head">' +
          '<input type="text" class="ecc-r-name" data-i="' + i + '" value="' + esc(row.name) +
            '" placeholder="' + esc(t("tool.row.name.ph")) + '" aria-label="' + esc(t("tool.row.name.label")) + '" autocomplete="off">' +
          '<button type="button" class="ecc-r-remove" data-i="' + i + '" aria-label="' + esc(t("tool.row.remove")) +
            '" title="' + esc(t("tool.row.remove")) + '">&times;</button>' +
        "</div>" +
        '<div class="ecc-row-grid">' +
          "<label>" + esc(t("tool.row.power.label")) +
            '<span class="ecc-pwr"><input type="number" class="ecc-r-watts" data-i="' + i +
              '" inputmode="decimal" min="0" step="any" value="' + esc(row.watts) + '" placeholder="' + esc(t("tool.row.power.ph")) + '">' +
            '<select class="ecc-r-unit" data-i="' + i + '" aria-label="' + esc(t("tool.row.power.label")) + '">' +
              '<option value="W"' + (row.unit === "W" ? " selected" : "") + ">" + esc(t("tool.row.unit.w")) + "</option>" +
              '<option value="kW"' + (row.unit === "kW" ? " selected" : "") + ">" + esc(t("tool.row.unit.kw")) + "</option>" +
            "</select></span>" +
          "</label>" +
          "<label>" + esc(t("tool.row.qty.label")) +
            '<input type="number" class="ecc-r-qty" data-i="' + i + '" min="1" step="1" value="' + esc(row.qty) + '"></label>' +
          "<label>" + esc(t("tool.row.hours.label")) +
            '<input type="number" class="ecc-r-hours" data-i="' + i + '" min="0" max="24" step="any" value="' + esc(row.hours) +
              '" placeholder="' + esc(t("tool.row.hours.ph")) + '"></label>' +
        "</div>" +
        '<p class="ecc-row-out" id="ecc-out-' + i + '"></p>' +
        '<p class="ecc-row-warn" id="ecc-warn-' + i + '" hidden>' + esc(t("tool.row.hoursCapped")) + "</p>" +
      "</div>";
  }

  function renderRows() {
    var html = "";
    for (var i = 0; i < state.rows.length; i++) html += rowHTML(state.rows[i], i);
    rowsHost.innerHTML = html;
    for (var j = 0; j < state.rows.length; j++) updateRowOutput(j);
  }

  /* ---- per-row live output (no full re-render → keeps focus/caret while typing) ---- */
  function updateRowOutput(i) {
    var row = state.rows[i];
    if (!row) return;
    var r = computeRow(row);
    var out = $("ecc-out-" + i), warn = $("ecc-warn-" + i);
    if (out) {
      if (!r.valid) {
        out.textContent = "";
      } else {
        var txt = t("tool.row.kwhOut", { kwh: fmtKwh(r.kwhPerDay) });
        var priceNum = pnum(state.price);
        if (isFinite(priceNum) && priceNum > 0) {
          txt += " · " + t("tool.row.costOut", { cost: fmtMoney(r.kwhPerDay * priceNum, state.currency) });
        }
        out.textContent = txt;
      }
    }
    if (warn) warn.hidden = !r.hoursCapped;
  }

  /* ---- totals ---- */
  function recalc() {
    var totals = computeTotals(state.rows, state.price);
    if (!totals.any) {
      resultEmpty.hidden = false;
      resultBody.hidden = true;
      return;
    }
    resultEmpty.hidden = true;
    resultBody.hidden = false;
    if (rKwhDay) rKwhDay.textContent = fmtKwh(totals.kwhDay);
    if (rKwhMonth) rKwhMonth.textContent = fmtKwh(totals.kwhMonth);
    if (rKwhYear) rKwhYear.textContent = fmtKwh(totals.kwhYear);
    if (totals.hasPrice) {
      if (rCostDay) rCostDay.textContent = fmtMoney(totals.costDay, state.currency);
      if (rCostMonth) rCostMonth.textContent = fmtMoney(totals.costMonth, state.currency);
      if (rCostYear) rCostYear.textContent = fmtMoney(totals.costYear, state.currency);
      if (rateHintEl) rateHintEl.hidden = true;
    } else {
      if (rCostDay) rCostDay.textContent = "—";
      if (rCostMonth) rCostMonth.textContent = "—";
      if (rCostYear) rCostYear.textContent = "—";
      if (rateHintEl) rateHintEl.hidden = false;
    }
  }

  /* ---- events ---- */
  priceEl.addEventListener("input", function () {
    state.price = priceEl.value;
    saveState();
    recalc();
    for (var i = 0; i < state.rows.length; i++) updateRowOutput(i);
  });

  if (curSel) {
    curSel.addEventListener("change", function () {
      state.currency = curSel.value;
      saveState();
      recalc();
      for (var i = 0; i < state.rows.length; i++) updateRowOutput(i);
    });
  }

  addBtn.addEventListener("click", function () { addRow(null); });

  rowsHost.addEventListener("input", function (e) {
    var el = e.target, i = parseInt(el.getAttribute("data-i"), 10);
    if (!(i >= 0) || !state.rows[i]) return;
    if (el.classList.contains("ecc-r-name")) state.rows[i].name = el.value;
    else if (el.classList.contains("ecc-r-watts")) state.rows[i].watts = el.value;
    else if (el.classList.contains("ecc-r-qty")) state.rows[i].qty = el.value;
    else if (el.classList.contains("ecc-r-hours")) state.rows[i].hours = el.value;
    else return;
    saveState();
    updateRowOutput(i);
    recalc();
  });

  rowsHost.addEventListener("change", function (e) {
    var el = e.target, i = parseInt(el.getAttribute("data-i"), 10);
    if (!(i >= 0) || !state.rows[i]) return;
    if (el.classList.contains("ecc-r-unit")) {
      state.rows[i].unit = (el.value === "kW") ? "kW" : "W";
      saveState();
      updateRowOutput(i);
      recalc();
    }
  });

  rowsHost.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest(".ecc-r-remove") : null;
    if (!btn) return;
    var i = parseInt(btn.getAttribute("data-i"), 10);
    if (!(i >= 0) || !state.rows[i]) return;
    state.rows.splice(i, 1);
    saveState();
    renderRows();
    recalc();
  });

  // 언어 전환: 프리셋 라벨·placeholder·aria 문구를 재적용
  document.addEventListener("i18n:change", function () {
    fillCurrencies();
    renderPresetChips();
    renderRows();
    recalc();
  });

  /* ---- init ---- */
  fillCurrencies();
  renderPresetChips();
  priceEl.value = state.price;
  renderRows();
  recalc();
  // TOOLJS:END
})();
