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
  /* Steps to Miles Calculator — steps <-> distance (mi/km), using step length estimated
     from height (or a directly entered step length), plus walking time and a rough
     MET-based calorie estimate. State: localStorage "<slug>:state" only. No external APIs. */

  var CM_PER_IN = 2.54;
  var MI_M = 1609.344;          // meters per mile
  var LB_PER_KG = 2.2046226218;

  // 성별 평균 보폭(1보) 비율 — 신장 대비 41.3~41.5% (보행 생체역학 통설, 대략치)
  var STEP_MULT = { male: 0.415, female: 0.413, average: 0.414 };

  // Compendium of Physical Activities 보행 MET 표 (mph, MET) — 구간 선형보간용 앵커
  var MET_TABLE = [
    [1.0, 2.0], [2.0, 2.8], [2.5, 3.0], [3.0, 3.5],
    [3.5, 4.3], [4.0, 5.0], [4.5, 6.3], [5.0, 8.3]
  ];

  var PACE_PRESET_MPH = { slow: 2.0, average: 3.0, brisk: 4.0 };

  var LIM = {
    heightCm: [50, 250], heightIn: [20, 98],
    strideCm: [20, 200], strideIn: [8, 79],
    weightKg: [10, 300], weightLb: [22, 661],
    steps: [1, 500000],
    distM: [1, 800000],          // ~500 miles cap
    speedMph: [0.5, 8], speedKmh: [0.8, 12.9]
  };

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function parseNum(raw) {
    if (raw == null) return null;
    var n = parseFloat(String(raw).replace(/,/g, "").trim());
    return isFinite(n) ? n : null;
  }

  function cmFromInput(value, unit) { return unit === "in" ? value * CM_PER_IN : value; }
  function inFromCm(cm) { return cm / CM_PER_IN; }
  function kgFromInput(value, unit) { return unit === "lb" ? value / LB_PER_KG : value; }
  function lbFromKg(kg) { return kg * LB_PER_KG; }
  function mphFromKmh(kmh) { return kmh / 1.609344; }
  function kmhFromMph(mph) { return mph * 1.609344; }

  // 신장(cm) -> 1보 보폭(cm). 통설 배율(성별) 적용 — 개인차가 커 참고치임을 UI에 명시.
  function stepLengthCm(heightCm, sex) {
    var m = STEP_MULT[sex] || STEP_MULT.average;
    return heightCm * m;
  }

  function distanceMFromSteps(steps, stepLenCm) { return steps * (stepLenCm / 100); }
  function stepsFromDistanceM(distM, stepLenCm) { return distM / (stepLenCm / 100); }

  // 보행 속도(mph) -> MET, 구간 선형보간(표 범위 밖은 양끝 값으로 고정) — "대략치" 계산
  function metFromMph(mph) {
    var t = MET_TABLE, i;
    if (mph <= t[0][0]) return t[0][1];
    if (mph >= t[t.length - 1][0]) return t[t.length - 1][1];
    for (i = 1; i < t.length; i++) {
      if (mph <= t[i][0]) {
        var a = t[i - 1], b = t[i];
        var frac = (mph - a[0]) / (b[0] - a[0]);
        return a[1] + (b[1] - a[1]) * frac;
      }
    }
    return t[t.length - 1][1];
  }

  function timeSecFromDistanceSpeed(distM, speedKmh) { return (distM / 1000) / speedKmh * 3600; }
  function caloriesFromMetWeightTime(met, weightKg, timeHours) { return met * weightKg * timeHours; }

  // seconds -> "H:MM:SS" (시간 있으면) 또는 "M:SS"
  function formatClock(totalSeconds) {
    var t = Math.round(Math.max(0, isFinite(totalSeconds) ? totalSeconds : 0));
    var h = Math.floor(t / 3600);
    var m = Math.floor((t % 3600) / 60);
    var sec = t % 60;
    var pad2 = function (n) { return n < 10 ? "0" + n : String(n); };
    if (h > 0) return h + ":" + pad2(m) + ":" + pad2(sec);
    return m + ":" + pad2(sec);
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      clamp: clamp, parseNum: parseNum, cmFromInput: cmFromInput, inFromCm: inFromCm,
      kgFromInput: kgFromInput, lbFromKg: lbFromKg, mphFromKmh: mphFromKmh, kmhFromMph: kmhFromMph,
      stepLengthCm: stepLengthCm, distanceMFromSteps: distanceMFromSteps,
      stepsFromDistanceM: stepsFromDistanceM, metFromMph: metFromMph,
      timeSecFromDistanceSpeed: timeSecFromDistanceSpeed, caloriesFromMetWeightTime: caloriesFromMetWeightTime,
      formatClock: formatClock, LIM: LIM, MET_TABLE: MET_TABLE, STEP_MULT: STEP_MULT,
      PACE_PRESET_MPH: PACE_PRESET_MPH, MI_M: MI_M, CM_PER_IN: CM_PER_IN, LB_PER_KG: LB_PER_KG
    };
    return;
  }

  /* ---- i18n · 지역(단위계) 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var LS_KEY = (CFG.slug || "steps-to-miles-calc") + ":state";

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function T(key, params, fallback) {
    var s = t(key, fallback);
    if (params) {
      for (var p in params) {
        if (Object.prototype.hasOwnProperty.call(params, p)) s = s.split("{" + p + "}").join(params[p]);
      }
    }
    return s;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmtNum(n, digits) {
    try { return new Intl.NumberFormat(uiLang(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n); }
    catch (e) { return n.toFixed(digits); }
  }
  function fmtInt(n) {
    try { return new Intl.NumberFormat(uiLang(), { maximumFractionDigits: 0 }).format(Math.round(n)); }
    catch (e) { return String(Math.round(n)); }
  }
  // plain(비지역화) 숫자 문자열 — 입력칸에 되써넣을 때 사용 (로케일 콤마가 섞이면 안 됨)
  function plain(n, d) {
    var s = n.toFixed(d);
    if (d > 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s;
  }

  // 야드파운드법 지역 감지 (bmi-calc 등과 동일 규칙 — 언어 태그 지역 > 타임존 > 언어 폴백)
  var IMPERIAL_REGIONS = ["US", "GB", "LR", "MM"];
  function regionFromLangTag(tag) {
    var m = String(tag || "").match(/[-_]([A-Za-z]{2})(?:$|[-_])/);
    return m ? m[1].toUpperCase() : "";
  }
  function regionFromTZ(tz) {
    if (!tz) return "";
    if (/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Boise|Juneau|Sitka|Nome|Adak|Menominee|Indiana|Kentucky|North_Dakota)/.test(tz)) return "US";
    if (tz === "Pacific/Honolulu") return "US";
    if (tz === "Europe/London") return "GB";
    if (tz === "Africa/Monrovia") return "LR";
    if (tz === "Asia/Yangon" || tz === "Asia/Rangoon") return "MM";
    return "";
  }
  function detectRegion() {
    var langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ""];
    var i, r;
    for (i = 0; i < langs.length; i++) { r = regionFromLangTag(langs[i]); if (r) return r; }
    var tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { /* 구형 브라우저 */ }
    return regionFromTZ(tz);
  }
  var AUTO_UNITS = IMPERIAL_REGIONS.indexOf(detectRegion()) >= 0 ? "imperial" : "metric";

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var modeRadios = document.querySelectorAll('input[name="mode"]');
  var unitBtns = document.querySelectorAll(".unit-btn");
  var stepsBlock = $("steps-block"), stepsInput = $("steps-input");
  var stepsPresetsWrap = $("steps-presets");
  var distanceBlock = $("distance-block"), distanceInput = $("distance-input"), distanceLabel = $("distance-label");
  var strideSourceSel = $("stride-source");
  var heightBlock = $("height-block"), heightInput = $("height-input"), heightLabel = $("height-label");
  var sexSelect = $("sex-select");
  var strideBlock = $("stride-block"), strideInput = $("stride-input"), strideLabel = $("stride-label");
  var paceSelect = $("pace-select");
  var customPaceBlock = $("custom-pace-block"), customPaceInput = $("custom-pace-input"), customPaceLabel = $("custom-pace-label");
  var weightInput = $("weight-input"), weightLabel = $("weight-label");
  var calcBtn = $("calc-btn");
  var box = $("result-box"), emptyEl = $("result-empty"), errEl = $("result-error"), bodyEl = $("result-body");
  var labelEl = $("r-label"), bigEl = $("r-big"), summaryEl = $("r-summary"), strideUsedEl = $("r-stride-used");
  var milesEl = $("r-miles"), kmEl = $("r-km"), timeEl = $("r-time"), caloriesEl = $("r-calories");
  var clippedEl = $("r-clipped"), calorieHintEl = $("calorie-hint");

  if (!stepsInput || !distanceInput || !calcBtn || !box) return;

  var units = AUTO_UNITS;   // "imperial" | "metric"
  var last = null;          // 마지막 렌더 상태 (언어 전환 재렌더용)

  function currentMode() {
    var el = document.querySelector('input[name="mode"]:checked');
    return el ? el.value : "steps";
  }

  /* ---- 단위계 전환: 이미 입력된 값을 물리적으로 동등하게 변환 ---- */
  function setUnitButtons() {
    for (var i = 0; i < unitBtns.length; i++) {
      var on = unitBtns[i].getAttribute("data-units") === units;
      unitBtns[i].setAttribute("aria-pressed", on ? "true" : "false");
      unitBtns[i].classList.toggle("is-active", on);
    }
  }
  function relabelForUnits() {
    var imp = units === "imperial";
    if (heightLabel) heightLabel.textContent = t(imp ? "tool.height.label.in" : "tool.height.label.cm", imp ? "Height (in)" : "Height (cm)");
    if (heightInput) {
      heightInput.placeholder = t(imp ? "tool.height.ph.in" : "tool.height.ph.cm", imp ? "e.g. 67" : "e.g. 170");
      heightInput.setAttribute("aria-label", heightLabel ? heightLabel.textContent : "");
    }
    if (strideLabel) strideLabel.textContent = t(imp ? "tool.stride.label.in" : "tool.stride.label.cm", imp ? "Step length (in)" : "Step length (cm)");
    if (strideInput) strideInput.placeholder = t(imp ? "tool.stride.ph.in" : "tool.stride.ph.cm", imp ? "e.g. 30" : "e.g. 76");
    if (distanceLabel) distanceLabel.textContent = t(imp ? "tool.distance.label.mi" : "tool.distance.label.km", imp ? "Distance (miles)" : "Distance (km)");
    if (weightLabel) weightLabel.textContent = t(imp ? "tool.weight.label.lb" : "tool.weight.label.kg", imp ? "Weight (lb) — optional, for calories" : "Weight (kg) — optional, for calories");
    if (weightInput) weightInput.placeholder = t(imp ? "tool.weight.ph.lb" : "tool.weight.ph.kg", imp ? "e.g. 150" : "e.g. 68");
    if (customPaceLabel) customPaceLabel.textContent = t(imp ? "tool.pace.custom.label.mph" : "tool.pace.custom.label.kmh", imp ? "Custom pace (mph)" : "Custom pace (km/h)");
  }
  function convertFieldsOnUnitSwitch(fromUnits, toUnits) {
    if (fromUnits === toUnits) return;
    var toImp = toUnits === "imperial";
    // 신장
    var hv = parseNum(heightInput.value);
    if (hv != null && hv > 0) heightInput.value = toImp ? plain(inFromCm(fromUnits === "imperial" ? hv * CM_PER_IN : hv), 1) : plain(fromUnits === "imperial" ? hv * CM_PER_IN : hv, 1);
    // 보폭(직접 입력)
    var sv = parseNum(strideInput.value);
    if (sv != null && sv > 0) strideInput.value = toImp ? plain(inFromCm(fromUnits === "imperial" ? sv * CM_PER_IN : sv), 1) : plain(fromUnits === "imperial" ? sv * CM_PER_IN : sv, 1);
    // 거리
    var dv = parseNum(distanceInput.value);
    if (dv != null && dv > 0) {
      var distM = dv * (fromUnits === "imperial" ? MI_M : 1000);
      distanceInput.value = plain(toImp ? distM / MI_M : distM / 1000, 3);
    }
    // 몸무게
    var wv = parseNum(weightInput.value);
    if (wv != null && wv > 0) {
      var wKg = fromUnits === "imperial" ? wv / LB_PER_KG : wv;
      weightInput.value = plain(toImp ? lbFromKg(wKg) : wKg, 1);
    }
    // 커스텀 페이스
    var pv = parseNum(customPaceInput.value);
    if (pv != null && pv > 0) {
      var pMph = fromUnits === "imperial" ? pv : mphFromKmh(pv);
      customPaceInput.value = plain(toImp ? pMph : kmhFromMph(pMph), 2);
    }
  }

  /* ---- 표시/숨김 동기화 ---- */
  function syncModeUI() {
    var mode = currentMode();
    stepsBlock.hidden = mode !== "steps";
    distanceBlock.hidden = mode !== "distance";
  }
  function syncStrideUI() {
    var src = strideSourceSel.value;
    heightBlock.hidden = src !== "height";
    strideBlock.hidden = src !== "custom";
  }
  function syncPaceUI() {
    customPaceBlock.hidden = paceSelect.value !== "custom";
  }

  /* ---- 상태 표시 ---- */
  function showError(key, fallback) {
    last = { kind: "error", key: key, fallback: fallback };
    box.hidden = false; emptyEl.hidden = true; bodyEl.hidden = true;
    errEl.hidden = false; errEl.textContent = t(key, fallback);
  }
  function showEmpty() {
    last = null;
    box.hidden = true; emptyEl.hidden = false;
  }

  /* ---- 보폭 읽기 (신장 추정 또는 직접 입력) ---- */
  function readStepLenCm() {
    var clipped = false, strideCm;
    if (strideSourceSel.value === "custom") {
      var raw = strideInput.value.trim();
      if (raw === "") return { error: "tool.err.strideRequired" };
      var v = parseNum(raw);
      if (v == null || !(v > 0)) return { error: "tool.err.strideRequired" };
      var cm = cmFromInput(v, units === "imperial" ? "in" : "cm");
      var lim = units === "imperial" ? LIM.strideIn : LIM.strideCm;
      var cm0 = cm;
      cm = clamp(units === "imperial" ? inFromCm(cm) : cm, lim[0], lim[1]);
      cm = units === "imperial" ? cmFromInput(cm, "in") : cm;
      if (Math.abs(cm - cm0) > 1e-6) clipped = true;
      strideCm = cm;
    } else {
      var hraw = heightInput.value.trim();
      if (hraw === "") return { error: "tool.err.heightRequired" };
      var hv = parseNum(hraw);
      if (hv == null || !(hv > 0)) return { error: "tool.err.heightRequired" };
      var hcm = cmFromInput(hv, units === "imperial" ? "in" : "cm");
      var hlim = units === "imperial" ? LIM.heightIn : LIM.heightCm;
      var hcm0 = hcm;
      hcm = clamp(units === "imperial" ? inFromCm(hcm) : hcm, hlim[0], hlim[1]);
      hcm = units === "imperial" ? cmFromInput(hcm, "in") : hcm;
      if (Math.abs(hcm - hcm0) > 1e-6) clipped = true;
      strideCm = stepLengthCm(hcm, sexSelect.value);
    }
    return { strideCm: strideCm, clipped: clipped };
  }

  /* ---- 페이스 읽기 ---- */
  function readPace() {
    var preset = paceSelect.value, clipped = false, mph;
    if (preset === "custom") {
      var raw = customPaceInput.value.trim();
      if (raw === "") return { error: "tool.err.customPaceRequired" };
      var v = parseNum(raw);
      if (v == null || !(v > 0)) return { error: "tool.err.customPaceRequired" };
      mph = units === "imperial" ? v : mphFromKmh(v);
      var mph0 = mph;
      mph = clamp(mph, LIM.speedMph[0], LIM.speedMph[1]);
      if (Math.abs(mph - mph0) > 1e-6) clipped = true;
    } else {
      mph = PACE_PRESET_MPH[preset] || PACE_PRESET_MPH.average;
    }
    return { mph: mph, kmh: kmhFromMph(mph), clipped: clipped };
  }

  /* ---- 렌더 ---- */
  function strideDisplayString(strideCm) {
    return fmtNum(inFromCm(strideCm), 1) + " in (" + fmtNum(strideCm, 1) + " cm)";
  }
  function distanceDisplayString(distM) {
    return fmtNum(distM / MI_M, 2) + " mi (" + fmtNum(distM / 1000, 2) + " km)";
  }

  function render(state) {
    last = { kind: "result", state: state };
    box.hidden = false; emptyEl.hidden = true; errEl.hidden = true; bodyEl.hidden = false;

    var distM = state.distM, steps = state.steps;

    milesEl.textContent = fmtNum(distM / MI_M, 2) + " mi";
    kmEl.textContent = fmtNum(distM / 1000, 2) + " km";
    timeEl.textContent = formatClock(state.timeSec);
    if (state.calories != null) {
      caloriesEl.textContent = fmtInt(state.calories) + " kcal";
      calorieHintEl.hidden = true;
    } else {
      caloriesEl.textContent = "—";
      calorieHintEl.hidden = false;
    }

    if (state.mode === "steps") {
      labelEl.textContent = t("tool.result.distance", "Distance");
      bigEl.textContent = units === "imperial" ? fmtNum(distM / MI_M, 2) + " mi" : fmtNum(distM / 1000, 2) + " km";
      summaryEl.textContent = T("tool.summary.steps", { steps: fmtInt(steps), distance: distanceDisplayString(distM) },
        "{steps} steps ≈ {distance} at your step length.");
    } else {
      labelEl.textContent = t("tool.result.steps", "Steps");
      bigEl.textContent = fmtInt(steps) + " " + t("tool.wordSteps", "steps");
      summaryEl.textContent = T("tool.summary.distance", { distance: distanceDisplayString(distM), steps: fmtInt(steps) },
        "{distance} ≈ {steps} steps at your step length.");
    }

    strideUsedEl.textContent = T("tool.strideUsed", { value: strideDisplayString(state.strideCm) }, "Step length used: {value}");
    clippedEl.hidden = !state.clipped;
  }

  function calculate() {
    var mode = currentMode();
    var pace = readPace();
    var stride = readStepLenCm();

    // 주 입력(걸음수/거리)부터 검증 — 사용자가 가장 먼저 채우는 값이라 우선 안내
    var distM, steps, primaryClipped = false;
    if (mode === "steps") {
      var sraw = stepsInput.value.trim();
      if (sraw === "") { showError("tool.err.stepsRequired", "Enter a number of steps greater than 0."); return; }
      var sv = parseNum(sraw);
      if (sv == null || !(sv > 0)) { showError("tool.err.stepsRequired", "Enter a number of steps greater than 0."); return; }
      var sv0 = Math.floor(sv);
      steps = clamp(sv0, LIM.steps[0], LIM.steps[1]);
      if (steps !== sv0) primaryClipped = true;
    } else {
      var draw = distanceInput.value.trim();
      if (draw === "") { showError("tool.err.distanceRequired", "Enter a distance greater than 0."); return; }
      var dv = parseNum(draw);
      if (dv == null || !(dv > 0)) { showError("tool.err.distanceRequired", "Enter a distance greater than 0."); return; }
      var dM0 = dv * (units === "imperial" ? MI_M : 1000);
      distM = clamp(dM0, LIM.distM[0], LIM.distM[1]);
      if (Math.abs(distM - dM0) > 1e-6) primaryClipped = true;
    }

    if (stride.error) { showError(stride.error, "Enter a valid, positive value."); return; }
    if (pace.error) { showError(pace.error, "Enter a valid custom pace greater than 0."); return; }

    if (mode === "steps") {
      distM = distanceMFromSteps(steps, stride.strideCm);
    } else {
      steps = Math.round(stepsFromDistanceM(distM, stride.strideCm));
    }

    var timeSec = timeSecFromDistanceSpeed(distM, pace.kmh);
    var met = metFromMph(pace.mph);

    var calories = null;
    var wraw = weightInput.value.trim();
    if (wraw !== "") {
      var wv = parseNum(wraw);
      if (wv != null && wv > 0) {
        var wKg = kgFromInput(wv, units === "imperial" ? "lb" : "kg");
        var wLim = units === "imperial" ? LIM.weightLb : LIM.weightKg;
        wKg = clamp(units === "imperial" ? lbFromKg(wKg) : wKg, wLim[0], wLim[1]);
        wKg = units === "imperial" ? kgFromInput(wKg, "lb") : wKg;
        calories = caloriesFromMetWeightTime(met, wKg, timeSec / 3600);
      }
    }

    var clipped = primaryClipped || stride.clipped || pace.clipped;
    render({ mode: mode, distM: distM, steps: steps, timeSec: timeSec, calories: calories, strideCm: stride.strideCm, clipped: clipped });

    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        mode: mode, units: units, strideSource: strideSourceSel.value,
        height: heightInput.value, sex: sexSelect.value, stride: strideInput.value,
        steps: stepsInput.value, distance: distanceInput.value,
        pace: paceSelect.value, customPace: customPaceInput.value, weight: weightInput.value
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }
  }

  /* ---- 이벤트 배선 ---- */
  for (var mi = 0; mi < modeRadios.length; mi++) {
    modeRadios[mi].addEventListener("change", function () { syncModeUI(); calculate(); });
  }
  for (var ui = 0; ui < unitBtns.length; ui++) {
    unitBtns[ui].addEventListener("click", function () {
      var next = this.getAttribute("data-units");
      if (next === units) return;
      convertFieldsOnUnitSwitch(units, next);
      units = next;
      try { localStorage.setItem(CFG.slug + ":units", units); } catch (e) { /* noop */ }
      setUnitButtons();
      relabelForUnits();
      calculate();
    });
  }
  strideSourceSel.addEventListener("change", function () { syncStrideUI(); calculate(); });
  sexSelect.addEventListener("change", calculate);
  paceSelect.addEventListener("change", function () { syncPaceUI(); calculate(); });
  [stepsInput, distanceInput, heightInput, strideInput, customPaceInput, weightInput].forEach(function (el) {
    el.addEventListener("input", calculate);
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calculate(); });
  });
  calcBtn.addEventListener("click", calculate);
  if (stepsPresetsWrap) {
    var presetBtns = stepsPresetsWrap.querySelectorAll(".chip");
    for (var pi = 0; pi < presetBtns.length; pi++) {
      presetBtns[pi].addEventListener("click", function () {
        stepsInput.value = this.getAttribute("data-steps");
        calculate();
      });
    }
  }

  /* ---- 초기화: 저장된 값 복원 ---- */
  (function restore() {
    var savedUnits = null;
    try { savedUnits = localStorage.getItem(CFG.slug + ":units"); } catch (e) { /* private mode */ }
    if (savedUnits === "metric" || savedUnits === "imperial") units = savedUnits;
    setUnitButtons();
    relabelForUnits();

    try {
      var saved = localStorage.getItem(LS_KEY);
      if (!saved) { syncModeUI(); syncStrideUI(); syncPaceUI(); showEmpty(); return; }
      var p = JSON.parse(saved);
      if (p.mode === "steps" || p.mode === "distance") {
        var r = document.querySelector('input[name="mode"][value="' + p.mode + '"]');
        if (r) r.checked = true;
      }
      if (p.strideSource === "height" || p.strideSource === "custom") strideSourceSel.value = p.strideSource;
      if (p.sex === "male" || p.sex === "female" || p.sex === "average") sexSelect.value = p.sex;
      if (p.pace === "slow" || p.pace === "average" || p.pace === "brisk" || p.pace === "custom") paceSelect.value = p.pace;
      if (p.height) heightInput.value = p.height;
      if (p.stride) strideInput.value = p.stride;
      if (p.steps) stepsInput.value = p.steps;
      if (p.distance) distanceInput.value = p.distance;
      if (p.customPace) customPaceInput.value = p.customPace;
      if (p.weight) weightInput.value = p.weight;

      syncModeUI(); syncStrideUI(); syncPaceUI();
      if (p.steps || p.distance) calculate(); else showEmpty();
    } catch (e) { syncModeUI(); syncStrideUI(); syncPaceUI(); showEmpty(); }
  })();

  // 언어 전환 시 라벨·결과 문구 재렌더
  document.addEventListener("i18n:change", function () {
    relabelForUnits();
    if (!last) return;
    if (last.kind === "error") showError(last.key, last.fallback);
    else render(last.state);
  });
  // TOOLJS:END
})();
