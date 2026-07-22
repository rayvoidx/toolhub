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
  /* Running Pace Calculator — any two of distance, time, pace -> compute the third.
     Always shows pace in min/km + min/mi and speed in km/h + mph, plus a split
     table for the resolved distance. State: localStorage "<slug>:state" only. */

  var MI_M = 1609.344;         // meters per mile
  var MAX_SPLIT_ROWS = 100;    // sanity cap on split table rows

  var LIM = {
    distMin: 1, distMax: 500000,   // meters (500 km)
    timeMin: 1, timeMax: 360000,   // seconds (100 h)
    paceMin: 10, paceMax: 3600     // seconds per unit (10s .. 60min per km/mi)
  };

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // "1:32:15" / "45:00" / "45" -> seconds. Bare number (no colon) = minutes.
  // Tolerant of missing leading zeros and decimal seconds. Returns null if unparseable.
  function parseHMS(raw) {
    if (raw == null) return null;
    var s = String(raw).trim().replace(",", ".");
    if (s === "") return null;
    var parts = s.split(":");
    if (parts.length > 3) return null;
    var vals = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p === "" || !/^\d+(\.\d+)?$/.test(p)) return null;
      var n = parseFloat(p);
      if (!isFinite(n) || n < 0) return null;
      vals.push(n);
    }
    if (vals.length === 1) return vals[0] * 60;
    if (vals.length === 2) return vals[0] * 60 + vals[1];
    return vals[0] * 3600 + vals[1] * 60 + vals[2];
  }

  // seconds -> "H:MM:SS" (hours present) or "M:SS"
  function formatClock(totalSeconds) {
    var t = Math.round(Math.max(0, isFinite(totalSeconds) ? totalSeconds : 0));
    var h = Math.floor(t / 3600);
    var m = Math.floor((t % 3600) / 60);
    var sec = t % 60;
    var pad2 = function (n) { return n < 10 ? "0" + n : String(n); };
    if (h > 0) return h + ":" + pad2(m) + ":" + pad2(sec);
    return m + ":" + pad2(sec);
  }

  function parseNum(raw) {
    if (raw == null) return null;
    var n = parseFloat(String(raw).replace(/,/g, "").trim());
    return isFinite(n) ? n : null;
  }

  function unitMeters(unit) { return unit === "mi" ? MI_M : 1000; }

  // Core derived stats once distance (m) and time (s) are both known.
  function deriveStats(distM, timeS) {
    var km = distM / 1000, mi = distM / MI_M, hrs = timeS / 3600;
    return {
      paceKmSec: timeS / km,
      paceMiSec: timeS / mi,
      speedKmh: km / hrs,
      speedMph: mi / hrs
    };
  }

  // Constant-pace split table. unit meters per split, capped at MAX_SPLIT_ROWS.
  function buildSplits(distM, timeS, unit, maxRows) {
    var uM = unitMeters(unit);
    var totalUnits = distM / uM;
    var paceSecPerUnit = timeS / totalUnits;
    var fullUnits = Math.floor(totalUnits + 1e-9);
    var capped = false;
    var n = fullUnits;
    if (n > maxRows) { n = maxRows; capped = true; }
    var rows = [];
    for (var i = 1; i <= n; i++) {
      rows.push({ n: i, cumDistM: uM * i, splitSec: paceSecPerUnit, cumSec: paceSecPerUnit * i, partial: false });
    }
    var remainder = totalUnits - fullUnits;
    if (!capped && remainder > 1e-6) {
      rows.push({
        n: fullUnits + 1, cumDistM: distM,
        splitSec: paceSecPerUnit * remainder, cumSec: timeS, partial: true
      });
    }
    return { rows: rows, capped: capped, shown: n };
  }

  // node 검증용 노출
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      MI_M: MI_M, LIM: LIM, clamp: clamp, parseHMS: parseHMS, formatClock: formatClock,
      parseNum: parseNum, unitMeters: unitMeters, deriveStats: deriveStats, buildSplits: buildSplits
    };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var LS_KEY = (CFG.slug || "pace-calc") + ":state";
  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmtNum(n, digits) {
    try {
      return new Intl.NumberFormat(uiLang(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
    } catch (e) { return n.toFixed(digits); }
  }
  function fmtDist(meters, unit) {
    return fmtNum(meters / unitMeters(unit), 2) + " " + unit;
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var modeSeg = $("mode-seg");
  var unitSelect = $("unit-select");
  var distanceBlock = $("distance-block"), timeBlock = $("time-block"), paceBlock = $("pace-block");
  var distanceInput = $("distance-input"), timeInput = $("time-input"), paceInput = $("pace-input");
  var paceLabelEl = $("pace-label");
  var presetsWrap = $("distance-presets");
  var calcBtn = $("calc-btn");
  var box = $("result-box"), emptyEl = $("result-empty");
  var errEl = $("result-error"), bodyEl = $("result-body");
  var labelEl = $("r-label"), bigEl = $("r-big"), summaryEl = $("r-summary");
  var paceKmEl = $("r-pace-km"), paceMiEl = $("r-pace-mi"), speedKmhEl = $("r-speed-kmh"), speedMphEl = $("r-speed-mph");
  var clippedEl = $("r-clipped");
  var splitsHeadingEl = $("splits-heading"), splitsBody = $("splits-body"), splitsTruncEl = $("splits-truncated");
  var splitsSection = $("splits-section");

  if (!modeSeg || !unitSelect || !distanceInput || !timeInput || !paceInput || !calcBtn || !box) return;

  var last = null; // 마지막 렌더 상태 (언어 전환 재렌더용)

  function currentMode() {
    var el = document.querySelector('input[name="solvemode"]:checked');
    return el ? el.value : "time";
  }
  function currentUnit() { return unitSelect.value === "mi" ? "mi" : "km"; }

  function syncModeUI() {
    var mode = currentMode();
    distanceBlock.hidden = (mode === "distance");
    timeBlock.hidden = (mode === "time");
    paceBlock.hidden = (mode === "pace");
    var segBtns = modeSeg.querySelectorAll(".seg-btn");
    for (var i = 0; i < segBtns.length; i++) {
      var input = segBtns[i].querySelector("input");
      segBtns[i].classList.toggle("is-active", input && input.value === mode);
    }
  }

  function syncPaceLabel() {
    var unit = currentUnit();
    var key = unit === "mi" ? "tool.pace.label.mi" : "tool.pace.label.km";
    if (paceLabelEl) paceLabelEl.textContent = t(key, unit === "mi" ? "Pace (min/mi)" : "Pace (min/km)");
  }

  function renderPresets() {
    if (!presetsWrap) return;
    var btns = presetsWrap.querySelectorAll(".chip");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", onPresetClick);
    }
  }
  function onPresetClick() {
    var meters = parseFloat(this.getAttribute("data-preset"));
    if (!isFinite(meters)) return;
    var unit = currentUnit();
    distanceInput.value = fmtNum(meters / unitMeters(unit), unit === "mi" ? 4 : 4).replace(/,/g, "");
    calculate();
  }

  // 단위 전환 시 이미 입력된 거리/페이스 값을 물리적으로 동등하게 변환
  var prevUnit = currentUnit();
  function onUnitChange() {
    var newUnit = currentUnit();
    if (newUnit === prevUnit) return;
    var oldM = unitMeters(prevUnit), newM = unitMeters(newUnit);

    var dv = parseNum(distanceInput.value);
    if (dv != null && dv > 0) {
      distanceInput.value = fmtNum(dv * oldM / newM, 4).replace(/,/g, "");
    }
    var ps = parseHMS(paceInput.value);
    if (ps != null && ps > 0) {
      // pace is seconds-per-oldUnit -> seconds-per-newUnit
      var newPaceSec = ps * (newM / oldM);
      paceInput.value = formatClock(newPaceSec);
    }
    prevUnit = newUnit;
    syncPaceLabel();
    calculate();
  }

  function showError(key, fallback) {
    last = { kind: "error", key: key, fallback: fallback };
    box.hidden = false;
    emptyEl.hidden = true;
    bodyEl.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key, fallback);
  }
  function showEmpty() {
    last = null;
    box.hidden = true;
    emptyEl.hidden = false;
  }

  function render(state) {
    last = { kind: "result", state: state };
    box.hidden = false;
    emptyEl.hidden = true;
    errEl.hidden = true;
    bodyEl.hidden = false;

    var unit = state.unit, distM = state.distM, timeS = state.timeS;
    var stats = deriveStats(distM, timeS);

    if (state.mode === "time") {
      labelEl.textContent = t("tool.result.time", "Finish time");
      bigEl.textContent = formatClock(timeS);
    } else if (state.mode === "pace") {
      labelEl.textContent = t("tool.result.pace", "Pace");
      var paceSec = unit === "mi" ? stats.paceMiSec : stats.paceKmSec;
      bigEl.textContent = formatClock(paceSec) + "/" + unit;
    } else {
      labelEl.textContent = t("tool.result.distance", "Distance");
      bigEl.textContent = fmtDist(distM, unit);
    }

    var summaryPace = unit === "mi" ? stats.paceMiSec : stats.paceKmSec;
    summaryEl.textContent = t("tool.result.summary", "{distance} in {time} ({pace}/{unit})")
      .replace("{distance}", fmtDist(distM, unit))
      .replace("{time}", formatClock(timeS))
      .replace("{pace}", formatClock(summaryPace))
      .replace("{unit}", unit);

    paceKmEl.textContent = formatClock(stats.paceKmSec) + "/km";
    paceMiEl.textContent = formatClock(stats.paceMiSec) + "/mi";
    speedKmhEl.textContent = fmtNum(stats.speedKmh, 2) + " km/h";
    speedMphEl.textContent = fmtNum(stats.speedMph, 2) + " mph";

    clippedEl.hidden = !state.clipped;

    // 스플릿 테이블
    var sp = buildSplits(distM, timeS, unit, MAX_SPLIT_ROWS);
    splitsHeadingEl.textContent = t("tool.splits.heading", "Splits") + " — " +
      t("tool.splits.unit." + unit, unit === "mi" ? "per mi" : "per km");
    splitsBody.textContent = "";
    for (var i = 0; i < sp.rows.length; i++) {
      var r = sp.rows[i];
      var tr = document.createElement("tr");
      var tds = [
        String(r.n),
        fmtDist(r.cumDistM, unit),
        formatClock(r.splitSec),
        formatClock(r.cumSec)
      ];
      for (var c = 0; c < tds.length; c++) {
        var td = document.createElement("td");
        td.textContent = tds[c];
        tr.appendChild(td);
      }
      splitsBody.appendChild(tr);
    }
    if (sp.capped) {
      splitsTruncEl.hidden = false;
      splitsTruncEl.textContent = t("tool.splits.truncated", "Showing the first {n} splits.").replace("{n}", String(sp.shown));
    } else {
      splitsTruncEl.hidden = true;
    }
    if (splitsSection) splitsSection.hidden = false;
  }

  function calculate() {
    var mode = currentMode();
    var unit = currentUnit();
    var uM = unitMeters(unit);
    var clipped = false;

    var distRaw = distanceInput.value.trim();
    var timeRaw = timeInput.value.trim();
    var paceRaw = paceInput.value.trim();

    var distM, timeS;

    if (mode === "time") {
      if (distRaw === "" || paceRaw === "") { showError("tool.err.missing", "Enter values for the two fields shown, then calculate."); return; }
      var dv = parseNum(distRaw);
      if (dv == null || !(dv > 0)) { showError("tool.err.invalidDistance", "Enter a distance greater than 0."); return; }
      var paceSec = parseHMS(paceRaw);
      if (paceSec == null) { showError("tool.err.invalidPace", "Enter a valid pace, like 5:30."); return; }
      if (!(paceSec > 0)) { showError("tool.err.zeroPace", "Pace must be greater than 0."); return; }
      distM = dv * uM;
      var distM0 = distM, paceSec0 = paceSec;
      distM = clamp(distM, LIM.distMin, LIM.distMax);
      paceSec = clamp(paceSec, LIM.paceMin, LIM.paceMax);
      if (distM !== distM0 || paceSec !== paceSec0) clipped = true;
      timeS = paceSec * (distM / uM);
      var timeS0 = timeS;
      timeS = clamp(timeS, LIM.timeMin, LIM.timeMax);
      if (timeS !== timeS0) clipped = true;
    } else if (mode === "pace") {
      if (distRaw === "" || timeRaw === "") { showError("tool.err.missing", "Enter values for the two fields shown, then calculate."); return; }
      var dv2 = parseNum(distRaw);
      if (dv2 == null || !(dv2 > 0)) { showError("tool.err.invalidDistance", "Enter a distance greater than 0."); return; }
      var timeS2 = parseHMS(timeRaw);
      if (timeS2 == null) { showError("tool.err.invalidTime", "Enter a valid time, like 45:00 or 1:32:15."); return; }
      if (!(timeS2 > 0)) { showError("tool.err.zeroTime", "Time must be greater than 0."); return; }
      distM = dv2 * uM;
      var distM1 = distM, timeS1 = timeS2;
      distM = clamp(distM, LIM.distMin, LIM.distMax);
      timeS = clamp(timeS2, LIM.timeMin, LIM.timeMax);
      if (distM !== distM1 || timeS !== timeS1) clipped = true;
    } else {
      if (timeRaw === "" || paceRaw === "") { showError("tool.err.missing", "Enter values for the two fields shown, then calculate."); return; }
      var timeS3 = parseHMS(timeRaw);
      if (timeS3 == null) { showError("tool.err.invalidTime", "Enter a valid time, like 45:00 or 1:32:15."); return; }
      if (!(timeS3 > 0)) { showError("tool.err.zeroTime", "Time must be greater than 0."); return; }
      var paceSec3 = parseHMS(paceRaw);
      if (paceSec3 == null) { showError("tool.err.invalidPace", "Enter a valid pace, like 5:30."); return; }
      if (!(paceSec3 > 0)) { showError("tool.err.zeroPace", "Pace must be greater than 0."); return; }
      var timeS3b = timeS3, paceSec3b = paceSec3;
      timeS = clamp(timeS3, LIM.timeMin, LIM.timeMax);
      paceSec3 = clamp(paceSec3, LIM.paceMin, LIM.paceMax);
      if (timeS !== timeS3b || paceSec3 !== paceSec3b) clipped = true;
      distM = (timeS / paceSec3) * uM;
      var distM2 = distM;
      distM = clamp(distM, LIM.distMin, LIM.distMax);
      if (distM !== distM2) clipped = true;
    }

    render({ mode: mode, unit: unit, distM: distM, timeS: timeS, clipped: clipped });

    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        mode: mode, unit: unit, distance: distRaw, time: timeRaw, pace: paceRaw
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }
  }

  /* ---- 이벤트 배선 ---- */
  distanceInput.addEventListener("input", calculate);
  timeInput.addEventListener("input", calculate);
  paceInput.addEventListener("input", calculate);
  calcBtn.addEventListener("click", calculate);
  unitSelect.addEventListener("change", onUnitChange);

  var modeRadios = document.querySelectorAll('input[name="solvemode"]');
  for (var mi = 0; mi < modeRadios.length; mi++) {
    modeRadios[mi].addEventListener("change", function () { syncModeUI(); calculate(); });
  }

  function onEnter(e) { if (e.key === "Enter") calculate(); }
  [distanceInput, timeInput, paceInput].forEach(function (el) { el.addEventListener("keydown", onEnter); });

  renderPresets();
  syncModeUI();
  syncPaceLabel();

  // 마지막 입력값 복원
  (function restore() {
    try {
      var saved = localStorage.getItem(LS_KEY);
      if (!saved) { showEmpty(); return; }
      var p = JSON.parse(saved);
      if (p.unit === "km" || p.unit === "mi") { unitSelect.value = p.unit; prevUnit = p.unit; }
      if (p.mode === "time" || p.mode === "pace" || p.mode === "distance") {
        var r = document.querySelector('input[name="solvemode"][value="' + p.mode + '"]');
        if (r) r.checked = true;
      }
      if (p.distance) distanceInput.value = p.distance;
      if (p.time) timeInput.value = p.time;
      if (p.pace) paceInput.value = p.pace;
      syncModeUI();
      syncPaceLabel();
      if (p.distance || p.time || p.pace) calculate(); else showEmpty();
    } catch (e) { showEmpty(); }
  })();

  // 언어 전환 시 동적 문구(라벨·결과·오류·스플릿) 재렌더
  document.addEventListener("i18n:change", function () {
    syncPaceLabel();
    if (!last) return;
    if (last.kind === "error") showError(last.key, last.fallback);
    else render(last.state);
  });
  // TOOLJS:END
})();
