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
  /* Calorie Deficit Calculator — sex/age/height/weight -> Mifflin-St Jeor BMR -> TDEE,
     then a user-chosen weekly weight-loss pace (0.25/0.5/0.75/1 kg per week) -> a daily
     calorie target, the daily deficit that implies, and an estimated timeline (weeks/months)
     to a stated goal weight. Uses the common 7,700 kcal per kg (~3,500 kcal per lb) rule of
     thumb, with a floor warning below 1,200 kcal (women) / 1,500 kcal (men) advising
     professional guidance. Not medical advice. State: localStorage "<slug>:state" only —
     no external API, all math runs locally in the browser. */

  var LB_PER_KG = 2.20462;
  var KCAL_PER_KG = 7700; // common rule-of-thumb energy density of body fat
  var WEEKS_PER_MONTH = 4.34524;
  var FLOOR_FEMALE = 1200, FLOOR_MALE = 1500;
  var LIM = { ageMin: 15, ageMax: 100, hCmMin: 100, hCmMax: 250, wKgMin: 20, wKgMax: 300 };
  var RATE_VALUES = [0.25, 0.5, 0.75, 1];

  /* ---- calc-core:start — pure functions (node unit-test target) ---- */
  function computeBMR(sex, weightKg, heightCm, age) {
    var base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    return sex === "male" ? base + 5 : base - 161;
  }
  function computeTDEE(bmr, activity) { return bmr * activity; }
  function dailyDeficitForRate(rateKg) { return rateKg * KCAL_PER_KG / 7; }
  function computeTarget(tdee, rateKg) { return tdee - dailyDeficitForRate(rateKg); }
  function weeksToGoal(currentKg, goalKg, rateKg) { return (currentKg - goalKg) / rateKg; }
  function floorFor(sex) { return sex === "female" ? FLOOR_FEMALE : FLOOR_MALE; }
  function isExtremeBody(weightKg, heightCm) {
    var m = heightCm / 100;
    var bmi = weightKg / (m * m);
    return bmi < 13 || bmi > 60;
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      computeBMR: computeBMR, computeTDEE: computeTDEE, dailyDeficitForRate: dailyDeficitForRate,
      computeTarget: computeTarget, weeksToGoal: weeksToGoal, floorFor: floorFor,
      isExtremeBody: isExtremeBody, RATE_VALUES: RATE_VALUES
    };
    return;
  }
  /* ---- calc-core:end ---- */

  var cfg = window.APP_CONFIG || {};
  var LS_KEY = (cfg.slug || "calorie-deficit-calc") + ":state";

  function $(id) { return document.getElementById(id); }
  function radioVal(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }
  function setRadio(name, value) {
    var el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (el) el.checked = true;
  }
  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmtKcal(n) {
    var r = Math.round(n);
    try { return r.toLocaleString(uiLang()) + " " + t("tool.unit.kcal", "kcal"); }
    catch (e) { return r + " kcal"; }
  }
  function fmtNum1(n) {
    try { return Number(n).toLocaleString(uiLang(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
    catch (e) { return n.toFixed(1); }
  }
  function fmtInt(n) {
    try { return Math.round(n).toLocaleString(uiLang()); }
    catch (e) { return String(Math.round(n)); }
  }

  var ageEl = $("age-input");
  var hCmEl = $("height-cm"), hFtEl = $("height-ft"), hInEl = $("height-in");
  var cmWrap = $("height-cm-wrap"), ftWrap = $("height-ft-wrap");
  var wEl = $("weight-input"), goalEl = $("goal-weight-input");
  var activityEl = $("activity-select");
  var rateEl = $("rate-select");
  var rateHelperEl = $("rate-helper");
  var rateCustomEl = $("rate-custom");
  var calcBtn = $("calc-btn");
  var box = $("result-box"), errEl = $("result-error"), bodyEl = $("result-body");
  var extremeEl = $("result-warning-extreme"), floorEl = $("result-warning-floor");
  var targetEl = $("r-target"), subEl = $("r-sub");
  var toLoseEl = $("r-tolose"), timelineEl = $("r-timeline");
  if (!ageEl || !hCmEl || !wEl || !goalEl || !activityEl || !rateEl || !calcBtn || !box) return;

  var last = null; // last render state (for i18n/unit re-render; persistent state -> localStorage only)

  function wUnit() { return radioVal("wunit") === "lb" ? "lb" : "kg"; }
  function hUnit() { return radioVal("hunit") === "ft" ? "ft" : "cm"; }

  function fmtWeight(kg) {
    var unit = wUnit();
    var n = unit === "lb" ? kg * LB_PER_KG : kg;
    var label = t(unit === "lb" ? "tool.unit.lb" : "tool.unit.kg", unit);
    return fmtNum1(n) + " " + label;
  }

  function showError(key, fallback) {
    last = { kind: "error", key: key, fallback: fallback };
    box.hidden = false;
    bodyEl.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key, fallback);
  }

  // 선택된 페이스를 kg/주 로 반환. custom 이면 현재 체중 단위로 입력받아 환산, 잘못되면 NaN.
  var RATE_KG_MIN = 0.05, RATE_KG_MAX = 1.5;
  function readRateKg() {
    if (rateEl.value !== "custom") {
      var preset = Number(rateEl.value);
      return RATE_VALUES.indexOf(preset) === -1 ? 0.5 : preset;
    }
    if (!rateCustomEl) return 0.5;
    var raw = rateCustomEl.value.trim();
    if (raw === "") return NaN;
    var v = Number(raw);
    if (isNaN(v) || !isFinite(v)) return NaN;
    var kg = wUnit() === "lb" ? v / LB_PER_KG : v;
    if (kg < RATE_KG_MIN || kg > RATE_KG_MAX) return NaN;
    return kg;
  }
  function applyRateMode() {
    if (!rateCustomEl) return;
    rateCustomEl.hidden = rateEl.value !== "custom";
  }

  function updateRateHelper() {
    if (!rateHelperEl) return;
    var rateKg = readRateKg();
    if (isNaN(rateKg)) { rateHelperEl.textContent = ""; return; }
    var deficit = dailyDeficitForRate(rateKg);
    var lb = rateKg * LB_PER_KG;
    var tmpl = t("tool.rate.helper", "≈ {lb} lb/week · about {kcal} kcal/day deficit");
    rateHelperEl.textContent = tmpl
      .replace("{lb}", fmtNum1(lb))
      .replace("{kcal}", fmtInt(deficit));
  }

  function render(st) {
    last = { kind: "result", st: st };
    errEl.hidden = true;
    bodyEl.hidden = false;
    box.hidden = false;
    if (extremeEl) extremeEl.hidden = !st.extreme;

    var bmr = computeBMR(st.sex, st.weightKg, st.heightCm, st.age);
    var tdee = computeTDEE(bmr, st.activity);
    var target = computeTarget(tdee, st.rateKg);
    var deficit = dailyDeficitForRate(st.rateKg);
    var floor = floorFor(st.sex);
    var displayTarget = Math.max(0, target);

    targetEl.textContent = fmtKcal(displayTarget);
    subEl.textContent = t("tool.result.sub", "Maintenance (TDEE): {tdee} · BMR: {bmr} · Daily deficit: {deficit}")
      .replace("{tdee}", fmtKcal(tdee))
      .replace("{bmr}", fmtKcal(bmr))
      .replace("{deficit}", fmtKcal(deficit));

    var toLoseKg = st.weightKg - st.goalWeightKg;
    toLoseEl.textContent = fmtWeight(toLoseKg);

    var weeksRaw = weeksToGoal(st.weightKg, st.goalWeightKg, st.rateKg);
    var weeks = Math.ceil(weeksRaw);
    var months = weeksRaw / WEEKS_PER_MONTH;
    timelineEl.textContent = t("tool.result.timeline.value", "{weeks} weeks (≈ {months} months)")
      .replace("{weeks}", fmtInt(weeks))
      .replace("{months}", fmtNum1(months));

    if (floorEl) {
      var showFloor = target < floor;
      floorEl.hidden = !showFloor;
      if (showFloor) {
        var sexLabel = t(st.sex === "female" ? "tool.sex.female" : "tool.sex.male", st.sex);
        floorEl.textContent = t("tool.warn.floor", "Your target of {target} would be below the commonly recommended floor of {floor} for {sex}. Diets this low increase the risk of nutrient shortfalls and muscle loss and should only be followed under medical supervision — consider a smaller weekly pace or talk to a doctor or registered dietitian.")
          .replace("{target}", fmtKcal(displayTarget))
          .replace("{floor}", fmtKcal(floor))
          .replace("{sex}", sexLabel.toLowerCase ? sexLabel.toLowerCase() : sexLabel);
      }
    }
  }

  function readHeightCm() {
    var unit = hUnit();
    if (unit === "cm") {
      var cmRaw = hCmEl.value.trim();
      return cmRaw === "" ? NaN : Number(cmRaw);
    }
    var ftRaw = hFtEl.value.trim();
    var inRaw = hInEl.value.trim();
    if (ftRaw === "") return NaN; // feet required in imperial mode
    var ft = Number(ftRaw);
    var inch = inRaw === "" ? 0 : Number(inRaw);
    if (isNaN(ft) || isNaN(inch)) return NaN;
    return (ft * 12 + inch) * 2.54;
  }
  function readWeightKg(el) {
    var raw = el.value.trim();
    if (raw === "") return NaN;
    var w = Number(raw);
    if (isNaN(w)) return NaN;
    return wUnit() === "lb" ? w / LB_PER_KG : w;
  }

  function calculate() {
    var sex = radioVal("sex");
    var ageRaw = ageEl.value.trim();
    var age = ageRaw === "" ? NaN : Number(ageRaw);
    var heightCm = readHeightCm();
    var weightKg = readWeightKg(wEl);
    var goalWeightKg = readWeightKg(goalEl);
    var activity = Number(activityEl.value);
    var rateKg = readRateKg();
    if (isNaN(rateKg)) {
      showError("tool.err.rate", "Enter a custom weekly pace between 0.05 and 1.5 kg (about 0.1 to 3.3 lb)."); return;
    }

    // 빈 입력 → 명시적 안내 (조용한 실패 금지)
    if (!sex || isNaN(age) || isNaN(heightCm) || isNaN(weightKg) || isNaN(goalWeightKg)) {
      showError("tool.err.empty", "Please enter your sex, age, height, current weight and goal weight.");
      return;
    }
    if (age < LIM.ageMin || age > LIM.ageMax) {
      showError("tool.err.age", "Enter an age between 15 and 100."); return;
    }
    if (heightCm < LIM.hCmMin || heightCm > LIM.hCmMax) {
      showError("tool.err.height", "Enter a height between 100 and 250 cm (about 3'3\" to 8'2\")."); return;
    }
    if (weightKg < LIM.wKgMin || weightKg > LIM.wKgMax) {
      showError("tool.err.weight", "Enter a current weight between 20 and 300 kg (about 44 to 660 lb)."); return;
    }
    if (goalWeightKg < LIM.wKgMin || goalWeightKg > LIM.wKgMax) {
      showError("tool.err.goalweight", "Enter a goal weight between 20 and 300 kg (about 44 to 660 lb)."); return;
    }
    if (goalWeightKg >= weightKg) {
      showError("tool.err.goalNotBelow", "Your goal weight must be lower than your current weight — this calculator is for a calorie deficit (weight loss)."); return;
    }
    if (!(activity >= 1.2 && activity <= 1.9)) activity = 1.55;

    render({
      sex: sex, age: age, heightCm: heightCm, weightKg: weightKg, goalWeightKg: goalWeightKg,
      activity: activity, rateKg: rateKg, extreme: isExtremeBody(weightKg, heightCm)
    });
    persist();
  }

  function persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        sex: radioVal("sex"), age: ageEl.value,
        hunit: radioVal("hunit"), cm: hCmEl.value, ft: hFtEl.value, inch: hInEl.value,
        wunit: radioVal("wunit"), weight: wEl.value, goal: goalEl.value,
        activity: activityEl.value, rate: rateEl.value,
        rateCustom: rateCustomEl ? rateCustomEl.value : ""
      }));
    } catch (e) { /* private mode — ignore */ }
  }

  function applyHeightUnit() {
    var ft = hUnit() === "ft";
    if (cmWrap) cmWrap.hidden = ft;
    if (ftWrap) ftWrap.hidden = !ft;
  }

  // 저장된 마지막 입력값 복원 (localStorage — 서버 미전송)
  (function restore() {
    try {
      var saved = localStorage.getItem(LS_KEY);
      if (!saved) return;
      var p = JSON.parse(saved);
      if (p.sex === "male" || p.sex === "female") setRadio("sex", p.sex);
      if (p.age) ageEl.value = p.age;
      if (p.hunit === "cm" || p.hunit === "ft") setRadio("hunit", p.hunit);
      if (p.cm) hCmEl.value = p.cm;
      if (p.ft) hFtEl.value = p.ft;
      if (p.inch) hInEl.value = p.inch;
      if (p.wunit === "kg" || p.wunit === "lb") setRadio("wunit", p.wunit);
      if (p.weight) wEl.value = p.weight;
      if (p.goal) goalEl.value = p.goal;
      if (p.activity) activityEl.value = p.activity;
      if (p.rate) rateEl.value = p.rate;
      if (p.rateCustom && rateCustomEl) rateCustomEl.value = p.rateCustom;
    } catch (e) { /* 접근 불가·파싱 실패 — 빈 폼으로 시작 */ }
    applyHeightUnit();
    applyRateMode();
  })();

  // 신장 단위 토글 → 표시 필드 전환
  var hUnitRadios = document.getElementsByName("hunit");
  for (var i = 0; i < hUnitRadios.length; i++) hUnitRadios[i].addEventListener("change", applyHeightUnit);

  // 체중 단위 토글 → 현재 결과를 새 단위로 재렌더 + 페이스 도우미 갱신
  var wUnitRadios = document.getElementsByName("wunit");
  for (var j = 0; j < wUnitRadios.length; j++) {
    wUnitRadios[j].addEventListener("change", function () {
      updateRateHelper();
      if (last && last.kind === "result") render(last.st);
    });
  }

  rateEl.addEventListener("change", function () { applyRateMode(); updateRateHelper(); });
  if (rateCustomEl) rateCustomEl.addEventListener("input", updateRateHelper);
  updateRateHelper();

  calcBtn.addEventListener("click", calculate);

  // 언어 전환 시 동적 문구(단위·오류·결과 라벨) 재렌더
  document.addEventListener("i18n:change", function () {
    updateRateHelper();
    if (!last) return;
    if (last.kind === "error") showError(last.key, last.fallback);
    else render(last.st);
  });
  // TOOLJS:END
})();
