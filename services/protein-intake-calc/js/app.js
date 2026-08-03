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
  /* Protein Intake Calculator — body weight (kg/lb) + activity level or fitness goal ->
     a daily protein range in grams using general sports-nutrition g/kg-body-weight tiers
     (0.8-2.2 g/kg), split per meal, and rough food-equivalent servings (chicken breast,
     eggs, tofu). Educational estimate only — not medical/nutrition advice. All math runs
     locally; state persists to localStorage "<slug>:state" only. */

  var LB_PER_KG = 2.20462;
  var WKG_MIN = 20, WKG_MAX = 300;
  var LB_MIN = Math.round(WKG_MIN * LB_PER_KG), LB_MAX = Math.round(WKG_MAX * LB_PER_KG);
  var MEALS_MIN = 1, MEALS_MAX = 8, MEALS_DEFAULT = 3;

  // Protein need by activity/goal tier, in grams per kg of body weight per day.
  // General sports-nutrition guidance range: 0.8 (sedentary/RDA) to 2.2 g/kg (build/cut).
  var TIERS = {
    sedentary: { lo: 0.8, hi: 1.0 },
    active: { lo: 1.2, hi: 1.6 },
    muscle_gain: { lo: 1.6, hi: 2.2 },
    weight_loss: { lo: 1.8, hi: 2.2 },
    endurance: { lo: 1.2, hi: 1.7 }
  };
  // "custom" tier: user-supplied single g/kg value, bounded to a physiologically sane window
  var CUSTOM_MIN = 0.5, CUSTOM_MAX = 3.0;

  // Protein grams per food unit — rough, commonly-cited values for a quick equivalence.
  var FOOD = { chicken: 31, eggs: 6, tofu: 8 }; // per 100g cooked chicken / 1 large egg / 100g firm tofu

  /* ---- calc-core:start — pure functions (node unit-test target) ---- */
  function proteinRangeG(weightKg, tier) {
    return { lo: weightKg * tier.lo, hi: weightKg * tier.hi };
  }
  function perMealRange(range, meals) {
    return { lo: range.lo / meals, hi: range.hi / meals };
  }
  function foodEquivalents(grams) {
    return {
      chicken: grams / FOOD.chicken,
      eggs: grams / FOOD.eggs,
      tofu: grams / FOOD.tofu
    };
  }
  // meals/day textbox -> integer clamp [1,8], default 3 for blank/invalid (non-critical field)
  function clampMeals(raw) {
    var n = Number(raw);
    if (!isFinite(n) || n < MEALS_MIN) return MEALS_DEFAULT;
    return Math.min(MEALS_MAX, Math.floor(n));
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      proteinRangeG: proteinRangeG, perMealRange: perMealRange,
      foodEquivalents: foodEquivalents, clampMeals: clampMeals, TIERS: TIERS, FOOD: FOOD
    };
    return;
  }
  /* ---- calc-core:end ---- */

  var cfg = window.APP_CONFIG || {};
  var LS_KEY = (cfg.slug || "protein-intake-calc") + ":state";

  function $(id) { return document.getElementById(id); }
  function radioVal(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }
  function setRadio(name, value) {
    var el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (el) el.checked = true;
  }
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmtG(n) {
    var r = Math.round(n);
    try { return r.toLocaleString(uiLang()); } catch (e) { return String(r); }
  }
  // servings — round to nearest half unit, trim ".0"
  function fmtServing(n) {
    var r = Math.round(n * 2) / 2;
    if (r < 0) r = 0;
    var s = (r % 1 === 0) ? String(r) : r.toFixed(1);
    try { return Number(s).toLocaleString(uiLang(), { maximumFractionDigits: 1 }); } catch (e) { return s; }
  }
  // eggs — whole units only
  function fmtWhole(n) {
    var r = Math.max(0, Math.round(n));
    try { return r.toLocaleString(uiLang()); } catch (e) { return String(r); }
  }
  function fill(str, map) {
    var out = str;
    for (var k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      out = out.replace("{" + k + "}", map[k]);
    }
    return out;
  }

  /* ---- DOM ---- */
  var weightInput = $("weight-input");
  var goalSelect = $("goal-select");
  var mealsInput = $("meals-input");
  var customRow = $("custom-row"), customInput = $("custom-input");
  var resultEmptyEl = $("result-empty"), resultErrorEl = $("result-error"), resultBodyEl = $("result-body");
  var badgeEl = $("r-badge");
  var rangeValEl = $("r-range-val");
  var perkgValEl = $("r-perkg-val");
  var permealHeadingEl = $("r-permeal-heading");
  var permealValEl = $("r-permeal-val");
  var foodChickenEl = $("r-food-chicken"), foodEggsEl = $("r-food-eggs"), foodTofuEl = $("r-food-tofu");
  if (!weightInput || !goalSelect || !mealsInput || !resultBodyEl) return;

  function wUnit() { return radioVal("wunit") === "lb" ? "lb" : "kg"; }

  function readWeightKg() {
    var raw = weightInput.value.trim();
    if (raw === "") return { state: "empty" };
    var n = Number(raw);
    if (!isFinite(n) || isNaN(n) || n <= 0) return { state: "error", key: "tool.err.weight.invalid" };
    var kg = wUnit() === "lb" ? n / LB_PER_KG : n;
    if (kg < WKG_MIN || kg > WKG_MAX) {
      var unit = wUnit();
      var min = unit === "lb" ? LB_MIN : WKG_MIN;
      var max = unit === "lb" ? LB_MAX : WKG_MAX;
      return {
        state: "error", key: "tool.err.weight.range",
        vars: { min: min, max: max, unit: tr("tool.unit." + unit, unit) }
      };
    }
    return { state: "ok", kg: kg };
  }

  // returns {state:"ok",tier} or {state:"error",...} — custom needs a valid g/kg value
  function readTier() {
    if (goalSelect.value !== "custom") {
      var g = goalSelect.value;
      return { state: "ok", tier: Object.prototype.hasOwnProperty.call(TIERS, g) ? TIERS[g] : TIERS.active };
    }
    var n = customInput ? Number(customInput.value.trim()) : NaN;
    if (!customInput || customInput.value.trim() === "" || !isFinite(n) || n < CUSTOM_MIN || n > CUSTOM_MAX) {
      return {
        state: "error", key: "tool.err.custom.range",
        vars: { min: CUSTOM_MIN.toFixed(1), max: CUSTOM_MAX.toFixed(1) }
      };
    }
    return { state: "ok", tier: { lo: n, hi: n } };
  }
  function syncCustomRow() {
    if (customRow) customRow.hidden = goalSelect.value !== "custom";
  }

  /* ---- render ---- */
  function render() {
    syncCustomRow();
    var res = readWeightKg();
    if (res.state === "ok") {
      var t = readTier();
      if (t.state !== "ok") res = t; else res.tier = t.tier;
    }

    if (res.state === "empty") {
      resultEmptyEl.hidden = false;
      resultErrorEl.hidden = true;
      resultBodyEl.hidden = true;
      return;
    }
    if (res.state === "error") {
      resultEmptyEl.hidden = true;
      resultBodyEl.hidden = true;
      resultErrorEl.hidden = false;
      var msg = tr(res.key, "Enter a valid body weight.");
      if (res.vars) msg = fill(msg, res.vars);
      resultErrorEl.textContent = msg;
      return;
    }

    resultEmptyEl.hidden = true;
    resultErrorEl.hidden = true;
    resultBodyEl.hidden = false;

    var tier = res.tier;
    var single = tier.lo === tier.hi;
    var range = proteinRangeG(res.kg, tier);
    var meals = clampMeals(mealsInput.value);
    var perMeal = perMealRange(range, meals);
    var mid = (range.lo + range.hi) / 2;
    var food = foodEquivalents(mid);

    var goalKey = Object.prototype.hasOwnProperty.call(TIERS, goalSelect.value) ? goalSelect.value : "active";
    var badgeKeyMap = {
      sedentary: "tool.badge.sedentary", active: "tool.badge.active",
      muscle_gain: "tool.badge.muscle", weight_loss: "tool.badge.loss", endurance: "tool.badge.endurance"
    };
    if (badgeEl) {
      badgeEl.textContent = goalSelect.value === "custom"
        ? tr("tool.badge.custom", "Custom")
        : tr(badgeKeyMap[goalKey], goalKey);
    }

    if (rangeValEl) {
      rangeValEl.textContent = single
        ? fill(tr("tool.result.dayValueSingle", "{n} g / day"), { n: fmtG(range.lo) })
        : fill(tr("tool.result.dayValue", "{lo}–{hi} g / day"), { lo: fmtG(range.lo), hi: fmtG(range.hi) });
    }
    if (perkgValEl) {
      perkgValEl.textContent = single
        ? fill(tr("tool.result.perkgSingle", "{n} g per kg body weight"), { n: tier.lo.toFixed(1) })
        : fill(tr("tool.result.perkg", "{lo}–{hi} g per kg body weight"), { lo: tier.lo.toFixed(1), hi: tier.hi.toFixed(1) });
    }
    if (permealHeadingEl) {
      permealHeadingEl.textContent = fill(tr("tool.result.permealHeading", "Per meal ({n}/day)"), { n: String(meals) });
    }
    if (permealValEl) {
      permealValEl.textContent = single
        ? fill(tr("tool.result.permealValueSingle", "{n} g per meal"), { n: fmtG(perMeal.lo) })
        : fill(tr("tool.result.permealValue", "{lo}–{hi} g per meal"), { lo: fmtG(perMeal.lo), hi: fmtG(perMeal.hi) });
    }
    if (foodChickenEl) foodChickenEl.textContent = fill(tr("tool.food.chickenLine", "{n} × chicken breast (100 g cooked)"), { n: fmtServing(food.chicken) });
    if (foodEggsEl) foodEggsEl.textContent = fill(tr("tool.food.eggsLine", "{n} × large egg"), { n: fmtWhole(food.eggs) });
    if (foodTofuEl) foodTofuEl.textContent = fill(tr("tool.food.tofuLine", "{n} × firm tofu (100 g)"), { n: fmtServing(food.tofu) });
  }

  /* ---- persistence ---- */
  function persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        weight: weightInput.value, wunit: radioVal("wunit"),
        goal: goalSelect.value, meals: mealsInput.value,
        custom: customInput ? customInput.value : ""
      }));
    } catch (e) { /* private mode — 저장만 실패, 계산은 정상 */ }
  }
  function restoreState() {
    var raw = null;
    try { raw = localStorage.getItem(LS_KEY); } catch (e) { return; }
    if (!raw) return;
    var st;
    try { st = JSON.parse(raw); } catch (e) { return; }
    if (!st || typeof st !== "object") return;
    if (st.weight != null) weightInput.value = st.weight;
    if (st.wunit) setRadio("wunit", st.wunit);
    if (st.goal && (st.goal === "custom" || Object.prototype.hasOwnProperty.call(TIERS, st.goal))) goalSelect.value = st.goal;
    if (st.meals != null) mealsInput.value = st.meals;
    if (st.custom != null && customInput) customInput.value = st.custom;
  }

  /* ---- events ---- */
  var wunitRadios = document.querySelectorAll('input[name="wunit"]');
  for (var i = 0; i < wunitRadios.length; i++) {
    wunitRadios[i].addEventListener("change", function () { render(); persist(); });
  }
  [weightInput, mealsInput, customInput].forEach(function (el) {
    if (!el) return;
    el.addEventListener("input", function () { render(); persist(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") { render(); el.blur(); } });
  });
  goalSelect.addEventListener("change", function () { render(); persist(); });
  document.addEventListener("i18n:change", render);

  /* ---- init ---- */
  restoreState();
  render();
  // TOOLJS:END
})();
