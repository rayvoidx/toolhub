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
  /* Break-Even Calculator — fixed costs / (price − variable cost) → break-even units & revenue,
     contribution margin (per unit + ratio), optional profit-target volume, price ±10% sensitivity.
     상태: localStorage "<slug>:last" 만. 외부 API 없음, 모든 계산은 로컬. */
  var SAFE = Number.MAX_SAFE_INTEGER;
  var LIM = { value: 1e15 };
  var SENS_STEPS = [-0.10, -0.05, 0, 0.05, 0.10]; // 가격 민감도: 기준가 대비 -10%~+10%

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
  // 금액 문자열(콤마 포함) → 숫자. 빈 값/숫자 아님은 null.
  function parseAmountStr(raw) {
    raw = String(raw == null ? "" : raw);
    var neg = raw.trim().charAt(0) === "-";
    var s = raw.replace(/[^0-9.]/g, "");
    var fd = s.indexOf(".");
    if (fd !== -1) s = s.slice(0, fd + 1) + s.slice(fd + 1).replace(/\./g, "");
    if (s === "" || s === ".") return null;
    var v = Number((neg ? "-" : "") + s);
    return isFinite(v) ? v : null;
  }

  /* ---- 순수 계산 (node 단위 검증 대상) ----
     margin = price - variable · marginRatio = margin/price
     breakEvenUnitsExact = fixed/margin · breakEvenUnits(표시) = ceil(exact) — 부분 단위 판매 불가
     breakEvenRevenue = breakEvenUnitsExact * price (연속값이라 올림 전 정확값 사용) */
  function computeBreakEven(fixed, price, variable) {
    var clipped = false;
    if (fixed > LIM.value) { fixed = LIM.value; clipped = true; }
    if (price > LIM.value) { price = LIM.value; clipped = true; }
    if (variable > LIM.value) { variable = LIM.value; clipped = true; }
    var margin = price - variable;
    if (margin <= 0) {
      return { ok: false, reason: "neverBreakEven", margin: margin, price: price, variable: variable, clipped: clipped };
    }
    var marginRatio = margin / price;
    var unitsExact = fixed / margin;
    var unitsRounded = Math.ceil(unitsExact - 1e-9); // 부동소수 잡음 제거
    var revenueExact = unitsExact * price;
    return {
      ok: true, clipped: clipped, fixed: fixed, price: price, variable: variable,
      margin: margin, marginRatio: marginRatio,
      unitsExact: unitsExact, unitsRounded: unitsRounded, revenueExact: revenueExact
    };
  }
  // 이익 목표: (고정비 + 목표이익) / 마진 — 목표이익 0 인 손익분기점의 일반화
  function computeTarget(fixed, margin, price, targetProfit) {
    var unitsExact = (fixed + targetProfit) / margin;
    var unitsRounded = Math.ceil(unitsExact - 1e-9);
    return { unitsExact: unitsExact, unitsRounded: unitsRounded, revenueExact: unitsExact * price };
  }
  // 가격 민감도: 변동비·고정비 고정, 가격만 steps 비율로 흔들어 손익분기점 재계산
  function buildSensitivity(fixed, price, variable, steps) {
    var rows = [];
    for (var i = 0; i < steps.length; i++) {
      var p = price * (1 + steps[i]);
      var m = p - variable;
      if (m <= 0) {
        rows.push({ step: steps[i], price: p, margin: m, ok: false });
      } else {
        var uExact = fixed / m;
        rows.push({ step: steps[i], price: p, margin: m, ok: true, unitsRounded: Math.ceil(uExact - 1e-9), revenueExact: uExact * p });
      }
    }
    return rows;
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      safe: safe, parseAmountStr: parseAmountStr,
      computeBreakEven: computeBreakEven, computeTarget: computeTarget, buildSensitivity: buildSensitivity
    };
    return;
  }

  /* ---- i18n · Intl 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var LS_KEY = (CFG.slug || "break-even-calc") + ":last";
  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function fmtLocale() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) || navigator.language || "en";
  }
  function nf(opts) { try { return new Intl.NumberFormat(fmtLocale(), opts); } catch (e) { return new Intl.NumberFormat("en", opts); } }
  function cyDec(cur) { try { return nf({ style: "currency", currency: cur }).resolvedOptions().maximumFractionDigits; } catch (e) { return 2; } }
  function money(v, cur) {
    var d = cyDec(cur);
    try { return nf({ style: "currency", currency: cur, minimumFractionDigits: d, maximumFractionDigits: d }).format(safe(v)); }
    catch (e) { return String(safe(v)); }
  }
  function numFmt(v, maxdec) { return nf({ maximumFractionDigits: maxdec == null ? 2 : maxdec }).format(safe(v)); }
  function pctFmt(frac) {
    try { return nf({ style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(safe(frac)); }
    catch (e) { return (safe(frac) * 100).toFixed(1) + "%"; }
  }
  function signedPct(frac) {
    var s = pctFmt(Math.abs(frac));
    return frac > 0 ? "+" + s : (frac < 0 ? "−" + s : s);
  }

  // ── 통화 목록 (지역/언어 추정 — API 조회 없음) ──
  var CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CNY", "KRW", "INR", "BRL", "RUB",
    "IDR", "CAD", "AUD", "CHF", "HKD", "SGD", "TWD", "MXN", "ZAR", "TRY", "SEK"];
  var REGION_CCY = { US: "USD", GB: "GBP", JP: "JPY", CN: "CNY", HK: "HKD", TW: "TWD",
    KR: "KRW", IN: "INR", BR: "BRL", RU: "RUB", ID: "IDR", CA: "CAD", AU: "AUD",
    CH: "CHF", SG: "SGD", MX: "MXN", ZA: "ZAR", TR: "TRY", SE: "SEK",
    DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", PT: "EUR", IE: "EUR", AT: "EUR", FI: "EUR" };
  var LANG_CCY = { ko: "KRW", ja: "JPY", zh: "CNY", de: "EUR", fr: "EUR", es: "EUR",
    pt: "BRL", ru: "RUB", id: "IDR", hi: "INR", bn: "BDT", ar: "USD", ur: "PKR", en: "USD" };
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

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var fixedEl = $("fixed-input"), priceEl = $("price-input"), variableEl = $("variable-input");
  var targetEl = $("target-input"), curSel = $("currency-select"), calcBtn = $("calc-btn");
  var box = $("result-box"), errEl = $("result-error"), bodyEl = $("result-body");
  if (!fixedEl || !priceEl || !variableEl || !curSel || !calcBtn || !box) return;

  // ── 금액 입력: 콤마 그룹핑 자동 포맷 · 파싱 ──
  function parseAmount(el) { return el ? parseAmountStr(el.value) : null; }
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
    var fixed = parseAmount(fixedEl), price = parseAmount(priceEl), variable = parseAmount(variableEl);
    var targetRaw = targetEl.value.trim();
    var target = targetRaw === "" ? null : parseAmount(targetEl);
    persist(cur);

    // 엣지케이스(철칙 5 — 전부 명시 처리)
    if (fixed == null || price == null || variable == null) {
      return showNotice("tool.err.empty", "Enter fixed costs, price per unit, and variable cost per unit.");
    }
    if (fixed < 0) return showNotice("tool.err.fixedNeg", "Fixed costs can't be negative.");
    if (price <= 0) return showNotice("tool.err.priceZero", "Price per unit must be greater than 0.");
    if (variable < 0) return showNotice("tool.err.variableNeg", "Variable cost per unit can't be negative.");
    if (targetRaw !== "" && (target == null || target < 0)) {
      return showNotice("tool.err.targetNeg", "Target profit can't be negative.");
    }

    var r = computeBreakEven(fixed, price, variable);
    if (!r.ok) {
      box.hidden = false; bodyEl.hidden = true; errEl.hidden = false;
      errEl.textContent = t("tool.err.neverBreakEven",
        "At this price, you never break even: {price} per unit is at or below the {variable} variable cost per unit. Raise the price or cut variable cost.")
        .replace("{price}", money(price, cur)).replace("{variable}", money(variable, cur));
      return;
    }

    errEl.hidden = true; bodyEl.hidden = false; box.hidden = false;

    $("r-units").textContent = numFmt(r.unitsRounded, 0);
    $("r-revenue").textContent = money(r.revenueExact, cur);
    $("r-margin").textContent = money(r.margin, cur);
    $("r-margin-ratio").textContent = pctFmt(r.marginRatio);

    var unitsSubEl = $("r-units-sub");
    if (r.fixed === 0) {
      unitsSubEl.hidden = true;
      $("r-zero-fixed").hidden = false;
    } else {
      $("r-zero-fixed").hidden = true;
      unitsSubEl.hidden = false;
      unitsSubEl.textContent = t("tool.result.unitsSub", "Exactly {exact} units — rounded up to {rounded} because partial units can't be sold.")
        .replace("{exact}", numFmt(r.unitsExact, 2)).replace("{rounded}", numFmt(r.unitsRounded, 0));
    }

    // 목표 이익 (선택 입력)
    var targetBox = $("target-result");
    if (target != null && target >= 0) {
      var tr = computeTarget(r.fixed, r.margin, r.price, target);
      targetBox.hidden = false;
      $("r-target-heading").textContent = t("tool.target.heading", "To reach a profit of {profit}").replace("{profit}", money(target, cur));
      $("r-target-units").textContent = numFmt(tr.unitsRounded, 0);
      $("r-target-revenue").textContent = money(tr.revenueExact, cur);
    } else {
      targetBox.hidden = true;
    }

    // 가격 민감도 표 (기준가 대비 -10%~+10%)
    var sens = buildSensitivity(r.fixed, r.price, r.variable, SENS_STEPS);
    var tbody = $("sens-body"); tbody.innerHTML = "";
    for (var i = 0; i < sens.length; i++) {
      var row = sens[i];
      var tr2 = document.createElement("tr");
      if (row.step === 0) tr2.className = "is-base";
      var tdChange = document.createElement("td"); tdChange.textContent = signedPct(row.step);
      var tdPrice = document.createElement("td"); tdPrice.textContent = money(row.price, cur);
      var tdMargin = document.createElement("td"); tdMargin.textContent = money(row.margin, cur);
      var tdUnits = document.createElement("td");
      var tdRevenue = document.createElement("td");
      if (row.ok) {
        tdUnits.textContent = numFmt(row.unitsRounded, 0);
        tdRevenue.textContent = money(row.revenueExact, cur);
      } else {
        tr2.className = "is-never";
        tdUnits.textContent = t("tool.sens.never", "Never");
        tdRevenue.textContent = t("tool.sens.never", "Never");
      }
      tr2.appendChild(tdChange); tr2.appendChild(tdPrice); tr2.appendChild(tdMargin);
      tr2.appendChild(tdUnits); tr2.appendChild(tdRevenue);
      tbody.appendChild(tr2);
    }

    $("r-clipped").hidden = !r.clipped;
  }

  function persist(cur) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        fixed: fixedEl.value, price: priceEl.value, variable: variableEl.value,
        target: targetEl.value, currency: cur
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }
  }

  // ── 초기화 · 복원 (상태는 프로세스 밖 — 철칙 1) ──
  (function init() {
    var restored = null;
    try { var s = localStorage.getItem(LS_KEY); if (s) restored = JSON.parse(s); } catch (e) { restored = null; }
    var startCur = (restored && restored.currency) || detectCurrency();
    fillCurrencies(startCur);
    if (restored) {
      if (restored.fixed) fixedEl.value = restored.fixed;
      if (restored.price) priceEl.value = restored.price;
      if (restored.variable) variableEl.value = restored.variable;
      if (restored.target) { targetEl.value = restored.target; $("target-wrap").open = true; }
    }
    var ready = parseAmount(fixedEl) != null && parseAmount(priceEl) != null && parseAmount(variableEl) != null;
    if (ready) calculate();
  })();

  // ── 이벤트 배선: 실시간 재계산(oninput) + Enter ──
  function onAmountInput(e) { reformatAmount(e.target); calculate(); }
  fixedEl.addEventListener("input", onAmountInput);
  priceEl.addEventListener("input", onAmountInput);
  variableEl.addEventListener("input", onAmountInput);
  targetEl.addEventListener("input", onAmountInput);
  curSel.addEventListener("change", calculate);
  calcBtn.addEventListener("click", calculate);
  function onEnter(e) { if (e.key === "Enter") calculate(); }
  [fixedEl, priceEl, variableEl, targetEl].forEach(function (el) { el.addEventListener("keydown", onEnter); });

  // ── 언어 전환: 통화기호·동적 문구·Intl 포맷을 새 로케일로 재렌더 ──
  document.addEventListener("i18n:change", function () {
    fillCurrencies(curSel.value);
    if (lastRun && !box.hidden) calculate();
  });
  // TOOLJS:END
})();
