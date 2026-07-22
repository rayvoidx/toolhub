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
  /* Macro Calculator — daily calories (typed directly, or estimated from sex/age/height/weight/
     activity/goal via Mifflin-St Jeor) -> grams of protein/carbs/fat per day and per meal, for a
     chosen diet split (balanced/low-carb/high-protein/keto, or a custom ratio via linked sliders
     that always sum to 100%). State: localStorage "<slug>:state" only. No external API — all
     math runs locally in the browser. */

  var LB_PER_KG = 2.20462;
  var CAL_MIN = 800, CAL_MAX = 10000;
  var LOW_CAL_WARN = 1200;
  var AGE_MIN = 15, AGE_MAX = 100;
  var HCM_MIN = 100, HCM_MAX = 250;
  var WKG_MIN = 20, WKG_MAX = 300;

  var PRESETS = {
    balanced: { protein: 30, carbs: 40, fat: 30 },
    lowcarb: { protein: 40, carbs: 20, fat: 40 },
    highprotein: { protein: 40, carbs: 40, fat: 20 },
    keto: { protein: 25, carbs: 5, fat: 70 }
  };

  /* ---- calc-core:start — pure functions (node unit-test target) ---- */
  // Mifflin-St Jeor basal metabolic rate
  function computeBMR(sex, weightKg, heightCm, age) {
    var base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    return sex === "female" ? base - 161 : base + 5;
  }
  // BMR x activity multiplier x goal multiplier (0.8 lose / 1.0 maintain / 1.1 gain)
  function computeCalorieTarget(bmr, activity, goalMult) {
    return bmr * activity * goalMult;
  }
  // calories split by a {protein,carbs,fat} percent ratio (must sum ~100) -> grams
  // protein/carbs = 4 kcal/g, fat = 9 kcal/g (Atwater factors)
  function macroGrams(calories, ratio) {
    return {
      protein: calories * (ratio.protein / 100) / 4,
      carbs: calories * (ratio.carbs / 100) / 4,
      fat: calories * (ratio.fat / 100) / 9
    };
  }
  // linked three-way slider: move `changedKey` to `newVal`, rebalance the other two
  // proportionally to their current ratio so the trio always sums to exactly 100.
  function normalizeRatios(changedKey, newVal, ratios) {
    var keys = ["protein", "carbs", "fat"];
    var others = keys.filter(function (k) { return k !== changedKey; });
    newVal = Math.round(newVal);
    if (newVal < 0) newVal = 0;
    if (newVal > 100) newVal = 100;
    var remaining = 100 - newVal;
    var sumOthers = ratios[others[0]] + ratios[others[1]];
    var out = {};
    out[changedKey] = newVal;
    if (sumOthers <= 0) {
      out[others[0]] = Math.floor(remaining / 2);
      out[others[1]] = remaining - out[others[0]];
    } else {
      out[others[0]] = Math.round(remaining * (ratios[others[0]] / sumOthers));
      out[others[1]] = remaining - out[others[0]];
    }
    return out;
  }
  // meals/day textbox -> integer clamp [1,8], default 3 for blank/invalid (non-critical field)
  function clampMeals(raw) {
    var n = Number(raw);
    if (!isFinite(n) || n < 1) return 3;
    return Math.min(8, Math.floor(n));
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      computeBMR: computeBMR, computeCalorieTarget: computeCalorieTarget,
      macroGrams: macroGrams, normalizeRatios: normalizeRatios, clampMeals: clampMeals,
      PRESETS: PRESETS
    };
    return;
  }
  /* ---- calc-core:end ---- */

  var cfg = window.APP_CONFIG || {};
  var LS_KEY = (cfg.slug || "macro-calc") + ":state";

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
  function fmtKcal(n) {
    var r = Math.round(n);
    try { return r.toLocaleString(uiLang()) + " " + tr("tool.unit.kcal", "kcal"); }
    catch (e) { return r + " kcal"; }
  }
  function fmtG(n) {
    var r = Math.round(n);
    try { return r.toLocaleString(uiLang()) + " " + tr("tool.unit.g", "g"); }
    catch (e) { return r + " g"; }
  }

  /* ---- DOM ---- */
  var caloriesInput = $("calories-input");
  var panelDirect = $("panel-direct"), panelTdee = $("panel-tdee");
  var ageInput = $("age-input");
  var heightCmWrap = $("height-cm-wrap"), heightFtWrap = $("height-ft-wrap");
  var heightCmInput = $("height-cm"), heightFtInput = $("height-ft"), heightInInput = $("height-in");
  var weightInput = $("weight-input");
  var activitySelect = $("activity-select"), goalSelect = $("goal-select");
  var tdeeNoteEl = $("tdee-note");
  var presetSelect = $("preset-select");
  var customRatiosWrap = $("custom-ratios");
  var ratioEls = {
    protein: { range: $("ratio-protein"), val: $("ratio-protein-val") },
    carbs: { range: $("ratio-carbs"), val: $("ratio-carbs-val") },
    fat: { range: $("ratio-fat"), val: $("ratio-fat-val") }
  };
  var mealsInput = $("meals-input");
  var resultEmptyEl = $("result-empty"), resultErrorEl = $("result-error"), resultBodyEl = $("result-body");
  var warningEl = $("result-warning");
  var rCaloriesEl = $("r-calories");
  var perMealHeadingEl = $("per-meal-heading");
  if (!caloriesInput || !panelTdee || !presetSelect || !mealsInput || !resultBodyEl) return;

  var customRatio = { protein: 30, carbs: 40, fat: 30 };

  /* ---- unit toggles ---- */
  function hUnit() { return radioVal("hunit") === "ft" ? "ft" : "cm"; }
  function wUnit() { return radioVal("wunit") === "lb" ? "lb" : "kg"; }

  function readHeightCm() {
    if (hUnit() === "cm") {
      var raw = heightCmInput.value.trim();
      return raw === "" ? NaN : Number(raw);
    }
    var ftRaw = heightFtInput.value.trim();
    if (ftRaw === "") return NaN;
    var inRaw = heightInInput.value.trim();
    var ft = Number(ftRaw), inch = inRaw === "" ? 0 : Number(inRaw);
    if (isNaN(ft) || isNaN(inch)) return NaN;
    return (ft * 12 + inch) * 2.54;
  }
  function readWeightKg() {
    var raw = weightInput.value.trim();
    if (raw === "") return NaN;
    var w = Number(raw);
    if (isNaN(w)) return NaN;
    return wUnit() === "lb" ? w / LB_PER_KG : w;
  }

  /* ---- calorie source (direct entry vs. computed from stats) ---- */
  function readDirectCalories() {
    var raw = caloriesInput.value.trim();
    if (raw === "") return { state: "empty" };
    var n = Number(raw.replace(/,/g, ""));
    if (!isFinite(n) || n < CAL_MIN || n > CAL_MAX) return { state: "error", key: "tool.err.calories" };
    return { state: "ok", calories: n };
  }
  function readTdeeCalories() {
    var sex = radioVal("sex") || "male";
    var ageRaw = ageInput.value.trim();
    var heightCm = readHeightCm();
    var weightKg = readWeightKg();
    if (ageRaw === "" || isNaN(heightCm) || isNaN(weightKg)) return { state: "empty" };
    var age = Number(ageRaw);
    if (!isFinite(age) || age < AGE_MIN || age > AGE_MAX) return { state: "error", key: "tool.err.tdee.age" };
    if (heightCm < HCM_MIN || heightCm > HCM_MAX) return { state: "error", key: "tool.err.tdee.height" };
    if (weightKg < WKG_MIN || weightKg > WKG_MAX) return { state: "error", key: "tool.err.tdee.weight" };
    var activity = Number(activitySelect.value) || 1.55;
    var goal = Number(goalSelect.value);
    if (!isFinite(goal)) goal = 1;
    var bmr = computeBMR(sex, weightKg, heightCm, age);
    return { state: "ok", calories: computeCalorieTarget(bmr, activity, goal), bmr: bmr, activity: activity };
  }

  function currentRatio() {
    var p = presetSelect.value;
    return Object.prototype.hasOwnProperty.call(PRESETS, p) ? PRESETS[p] : customRatio;
  }

  /* ---- UI sync ---- */
  function syncModePanels() {
    var mode = radioVal("calmode") || "direct";
    panelDirect.hidden = mode !== "direct";
    panelTdee.hidden = mode !== "tdee";
  }
  function syncHeightWrap() {
    var u = hUnit();
    heightCmWrap.hidden = u !== "cm";
    heightFtWrap.hidden = u !== "ft";
  }
  function syncRatioSliders() {
    var k;
    for (k in ratioEls) {
      if (!Object.prototype.hasOwnProperty.call(ratioEls, k)) continue;
      ratioEls[k].range.value = String(customRatio[k]);
      ratioEls[k].val.textContent = customRatio[k] + "%";
    }
  }
  function syncPresetUI() {
    var isCustom = presetSelect.value === "custom";
    customRatiosWrap.hidden = !isCustom;
    if (isCustom) syncRatioSliders();
  }

  /* ---- render ---- */
  function setMacroCard(key, grams, meals) {
    var kcalPerG = key === "fat" ? 9 : 4;
    var gEl = $("mc-" + key + "-g"), subEl = $("mc-" + key + "-sub"), mealEl = $("mc-" + key + "-meal");
    if (gEl) gEl.textContent = fmtG(grams);
    if (subEl) {
      var ratio = currentRatio();
      subEl.textContent = tr("tool.result.sub", "{kcal} kcal · {pct}%")
        .replace("{kcal}", fmtKcal(grams * kcalPerG))
        .replace("{pct}", String(Math.round(ratio[key])));
    }
    if (mealEl) mealEl.textContent = fmtG(grams / meals);
  }

  function render() {
    var mode = radioVal("calmode") || "direct";
    var res = mode === "direct" ? readDirectCalories() : readTdeeCalories();

    if (mode === "tdee" && res.state === "ok" && tdeeNoteEl) {
      tdeeNoteEl.hidden = false;
      tdeeNoteEl.textContent = tr("tool.tdee.note", "Estimated calories for this goal: {kcal} (BMR {bmr} × activity ×{activity})")
        .replace("{kcal}", fmtKcal(res.calories))
        .replace("{bmr}", fmtKcal(res.bmr))
        .replace("{activity}", String(res.activity));
    } else if (tdeeNoteEl) {
      tdeeNoteEl.hidden = true;
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
      resultErrorEl.textContent = tr(res.key, "Invalid input.");
      return;
    }

    resultEmptyEl.hidden = true;
    resultErrorEl.hidden = true;
    resultBodyEl.hidden = false;

    var calories = res.calories;
    var ratio = currentRatio();
    var grams = macroGrams(calories, ratio);
    var meals = clampMeals(mealsInput.value);

    rCaloriesEl.textContent = fmtKcal(calories);
    if (warningEl) warningEl.hidden = !(calories < LOW_CAL_WARN);

    setMacroCard("protein", grams.protein, meals);
    setMacroCard("carbs", grams.carbs, meals);
    setMacroCard("fat", grams.fat, meals);

    if (perMealHeadingEl) {
      perMealHeadingEl.textContent = tr("tool.result.perMeal", "Per meal ({n}/day)").replace("{n}", String(meals));
    }
  }

  /* ---- persistence ---- */
  function persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        mode: radioVal("calmode"),
        calories: caloriesInput.value,
        sex: radioVal("sex"),
        age: ageInput.value,
        hunit: radioVal("hunit"), heightCm: heightCmInput.value, heightFt: heightFtInput.value, heightIn: heightInInput.value,
        wunit: radioVal("wunit"), weight: weightInput.value,
        activity: activitySelect.value, goal: goalSelect.value,
        preset: presetSelect.value, customRatio: customRatio,
        meals: mealsInput.value
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
    if (st.mode) setRadio("calmode", st.mode);
    if (st.calories != null) caloriesInput.value = st.calories;
    if (st.sex) setRadio("sex", st.sex);
    if (st.age != null) ageInput.value = st.age;
    if (st.hunit) setRadio("hunit", st.hunit);
    if (st.heightCm != null) heightCmInput.value = st.heightCm;
    if (st.heightFt != null) heightFtInput.value = st.heightFt;
    if (st.heightIn != null) heightInInput.value = st.heightIn;
    if (st.wunit) setRadio("wunit", st.wunit);
    if (st.weight != null) weightInput.value = st.weight;
    if (st.activity) activitySelect.value = st.activity;
    if (st.goal) goalSelect.value = st.goal;
    if (st.preset) presetSelect.value = st.preset;
    if (st.customRatio && isFinite(st.customRatio.protein) && isFinite(st.customRatio.carbs) && isFinite(st.customRatio.fat)) {
      customRatio = { protein: st.customRatio.protein, carbs: st.customRatio.carbs, fat: st.customRatio.fat };
    }
    if (st.meals != null) mealsInput.value = st.meals;
  }

  /* ---- events ---- */
  var calModeRadios = document.querySelectorAll('input[name="calmode"]');
  for (var i = 0; i < calModeRadios.length; i++) {
    calModeRadios[i].addEventListener("change", function () { syncModePanels(); render(); persist(); });
  }
  var sexRadios = document.querySelectorAll('input[name="sex"]');
  for (i = 0; i < sexRadios.length; i++) {
    sexRadios[i].addEventListener("change", function () { render(); persist(); });
  }
  var hunitRadios = document.querySelectorAll('input[name="hunit"]');
  for (i = 0; i < hunitRadios.length; i++) {
    hunitRadios[i].addEventListener("change", function () { syncHeightWrap(); render(); persist(); });
  }
  var wunitRadios = document.querySelectorAll('input[name="wunit"]');
  for (i = 0; i < wunitRadios.length; i++) {
    wunitRadios[i].addEventListener("change", function () { render(); persist(); });
  }
  [caloriesInput, ageInput, heightCmInput, heightFtInput, heightInInput, weightInput, mealsInput].forEach(function (el) {
    if (!el) return;
    el.addEventListener("input", function () { render(); persist(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") { render(); el.blur(); } });
  });
  [activitySelect, goalSelect].forEach(function (el) {
    if (!el) return;
    el.addEventListener("change", function () { render(); persist(); });
  });
  presetSelect.addEventListener("change", function () { syncPresetUI(); render(); persist(); });
  var ratioKey;
  for (ratioKey in ratioEls) {
    if (!Object.prototype.hasOwnProperty.call(ratioEls, ratioKey)) continue;
    (function (key) {
      ratioEls[key].range.addEventListener("input", function () {
        customRatio = normalizeRatios(key, Number(this.value), customRatio);
        syncRatioSliders();
        render();
        persist();
      });
    })(ratioKey);
  }
  document.addEventListener("i18n:change", render);

  /* ---- init ---- */
  restoreState();
  syncModePanels();
  syncHeightWrap();
  syncPresetUI();
  render();
  // TOOLJS:END
})();
