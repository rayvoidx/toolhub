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
  /* Oven Temperature Converter — Fahrenheit <-> Celsius <-> Gas Mark, plus a
     fan/convection oven adjustment (-20C convention). All state is local:
     cfg.slug + ":state" (last value + oven type) in localStorage. No external API. */

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상)
  // Gas Mark is a stepped historical scale (UK gas ovens, 1950s on), not a
  // straight-line formula — these are the standard published reference points.
  var GAS_MARKS = [
    { gm: 0.25, c: 110, f: 225, band: "veryLow" },
    { gm: 0.5,  c: 120, f: 250, band: "veryLow" },
    { gm: 1,    c: 140, f: 275, band: "low" },
    { gm: 2,    c: 150, f: 300, band: "low" },
    { gm: 3,    c: 160, f: 325, band: "warm" },
    { gm: 4,    c: 180, f: 350, band: "moderate" },
    { gm: 5,    c: 190, f: 375, band: "moderatelyHot" },
    { gm: 6,    c: 200, f: 400, band: "fairlyHot" },
    { gm: 7,    c: 220, f: 425, band: "hot" },
    { gm: 8,    c: 230, f: 450, band: "hot" },
    { gm: 9,    c: 240, f: 475, band: "veryHot" },
    { gm: 10,   c: 260, f: 500, band: "veryHot" }
  ];
  var GAS_RANGE_MIN = 90;   // margin below Gas 1/4 (110C) — beyond this, no sensible Gas Mark match
  var GAS_RANGE_MAX = 280;  // margin above Gas 10 (260C)
  var ABS_ZERO_C = -273.15;
  var CAP_C = 5000;         // absurd input guard — ovens don't get this hot, just keep the math finite
  var FAN_OFFSET_C = 20;    // the "-20C convention" for fan/convection adjustment

  function cToF(c) { return c * 9 / 5 + 32; }
  function fToC(f) { return (f - 32) * 5 / 9; }
  function fanFromStatic(c) { return c - FAN_OFFSET_C; }
  function staticFromFan(c) { return c + FAN_OFFSET_C; }

  // 극단값 처리: 절대영도 미만은 계산상 절대영도로 접어 올리고 플래그, 과도한 상한은 캡
  function sanitizeC(c) {
    if (!isFinite(c)) return null;
    var belowAbsZero = c < ABS_ZERO_C;
    var capped = false;
    if (c > CAP_C) { c = CAP_C; capped = true; }
    if (c < -CAP_C) { c = -CAP_C; capped = true; }
    if (belowAbsZero) c = ABS_ZERO_C;
    return { c: c, belowAbsZero: belowAbsZero, capped: capped };
  }

  // cStatic(전통/정온 오븐 섭씨) 기준으로 가장 가까운 가스마크를 찾는다.
  function nearestGasMark(cStatic) {
    var best = null, bestDiff = Infinity;
    for (var i = 0; i < GAS_MARKS.length; i++) {
      var d = Math.abs(GAS_MARKS[i].c - cStatic);
      if (d < bestDiff) { bestDiff = d; best = GAS_MARKS[i]; }
    }
    var inRange = cStatic >= GAS_RANGE_MIN && cStatic <= GAS_RANGE_MAX;
    return { entry: best, diff: bestDiff, exact: bestDiff < 0.5, inRange: inRange };
  }
  function gasMarkEntry(gm) {
    for (var i = 0; i < GAS_MARKS.length; i++) {
      if (GAS_MARKS[i].gm === gm) return GAS_MARKS[i];
    }
    return null;
  }
  function gmLabel(gm) {
    if (gm === 0.25) return "¼"; // ¼
    if (gm === 0.5) return "½";  // ½
    return String(gm);
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      cToF: cToF, fToC: fToC, fanFromStatic: fanFromStatic, staticFromFan: staticFromFan,
      sanitizeC: sanitizeC, nearestGasMark: nearestGasMark, gasMarkEntry: gasMarkEntry,
      gmLabel: gmLabel, GAS_MARKS: GAS_MARKS, GAS_RANGE_MIN: GAS_RANGE_MIN, GAS_RANGE_MAX: GAS_RANGE_MAX
    };
    return;
  }
  // calc-core:end

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var cInput = $("c-input"), fInput = $("f-input"), gmSelect = $("gm-select");
  var fanToggle = $("fan-toggle");
  var placeholderEl = $("ot-placeholder"), summaryEl = $("ot-summary");
  var gmNoteEl = $("ot-gmnote"), equivEl = $("ot-equiv"), warnEl = $("ot-warn");
  var chartBody = $("ot-chart-body");
  var copyBtns = document.querySelectorAll(".ot-copy");
  var copyMsgEl = $("ot-copymsg");
  if (!cInput || !fInput || !gmSelect || !summaryEl || !warnEl) return;

  var CFG = window.APP_CONFIG || {};
  var STATE_KEY = (CFG.slug || "oven-temp-conv") + ":state";
  var MAXLEN = 12;
  var ovenType = "static"; // "static" | "fan" — which representation the c/f fields show
  var last = { kind: "empty" };
  var copyTimer = null;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  // ASCII 왕복용 (입력칸에 다시 써넣을 값)
  function fmt(n) {
    if (n == null || !isFinite(n)) return "";
    var s = (Math.round(n * 10) / 10).toFixed(1);
    s = s.replace(/\.0$/, "");
    if (s === "-0") s = "0";
    return s;
  }
  // 화면 표시용 — 숫자 체계는 latn 고정(입력칸과 대조 가능하게), 구분자/소수점만 로케일 존중
  function fmtLoc(n) {
    if (n == null || !isFinite(n)) return "";
    var v = Math.round(n * 10) / 10;
    if (v === 0) v = 0;
    try { return v.toLocaleString(uiLang() + "-u-nu-latn", { maximumFractionDigits: 1 }); }
    catch (e) { return fmt(n); }
  }

  /* ---- 오븐 타입 · 마지막 값 저장/복원 ---- */
  function saveState() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        cStatic: last.kind === "ok" ? last.cStatic : null,
        ovenType: ovenType
      }));
    } catch (e) { /* private mode — 저장만 실패, 계산은 정상 */ }
  }
  function loadState() {
    var raw = null;
    try { raw = localStorage.getItem(STATE_KEY); } catch (e) { /* noop */ }
    var out = { cStatic: null, ovenType: "static" };
    if (!raw) return out;
    try {
      var obj = JSON.parse(raw);
      if (obj && (obj.ovenType === "fan" || obj.ovenType === "static")) out.ovenType = obj.ovenType;
      if (obj && typeof obj.cStatic === "number" && isFinite(obj.cStatic)) out.cStatic = obj.cStatic;
    } catch (e) { /* 손상된 저장값 — 기본값으로 계속 */ }
    return out;
  }

  /* ---- 가스마크 셀렉트 옵션 (언어 전환 시 재구성) ---- */
  function renderGmOptions() {
    var keep = gmSelect.value;
    gmSelect.textContent = "";
    var ph = document.createElement("option");
    ph.value = "";
    ph.textContent = t("tool.gasmark.placeholder", "Choose a Gas Mark");
    gmSelect.appendChild(ph);
    for (var i = 0; i < GAS_MARKS.length; i++) {
      var e = GAS_MARKS[i];
      var opt = document.createElement("option");
      opt.value = String(e.gm);
      var bandTxt = t("tool.band." + e.band, e.band);
      opt.textContent = t("tool.gasmark.option", "Gas Mark {gm} — {c}°C / {f}°F ({band})")
        .replace("{gm}", gmLabel(e.gm)).replace("{c}", fmtLoc(e.c)).replace("{f}", fmtLoc(e.f)).replace("{band}", bandTxt);
      gmSelect.appendChild(opt);
    }
    gmSelect.value = keep;
  }

  /* ---- 전체 참조표 (i18n 라벨 반영, 언어 전환 시 재구성) ---- */
  function renderChart() {
    if (!chartBody) return;
    chartBody.textContent = "";
    for (var i = 0; i < GAS_MARKS.length; i++) {
      var e = GAS_MARKS[i];
      var tr = document.createElement("tr");
      tr.setAttribute("data-gm", String(e.gm));
      var tds = [
        gmLabel(e.gm),
        fmtLoc(e.c) + "°C",
        fmtLoc(e.f) + "°F",
        "≈ " + fmtLoc(fanFromStatic(e.c)) + "°C",
        t("tool.band." + e.band, e.band)
      ];
      for (var j = 0; j < tds.length; j++) {
        var td = document.createElement("td");
        td.textContent = tds[j];
        tr.appendChild(td);
      }
      chartBody.appendChild(tr);
    }
    highlightChart(last.kind === "ok" && last.nearest.inRange ? last.nearest.entry.gm : null);
  }
  function highlightChart(gm) {
    if (!chartBody) return;
    var rows = chartBody.querySelectorAll("tr");
    for (var i = 0; i < rows.length; i++) {
      var on = gm != null && parseFloat(rows[i].getAttribute("data-gm")) === gm;
      rows[i].className = on ? "ot-row-active" : "";
    }
  }

  /* ---- 결과 렌더 ---- */
  function renderResult() {
    if (last.kind === "empty") {
      placeholderEl.hidden = false;
      summaryEl.hidden = true; gmNoteEl.hidden = true; equivEl.hidden = true; warnEl.hidden = true;
      highlightChart(null);
      return;
    }
    placeholderEl.hidden = true;
    if (last.kind === "bad") {
      summaryEl.hidden = true; gmNoteEl.hidden = true; equivEl.hidden = true;
      warnEl.hidden = false;
      warnEl.textContent = t("tool.warn.badinput", "Please enter a valid number.");
      highlightChart(null);
      return;
    }
    // ok
    summaryEl.hidden = false;
    summaryEl.textContent = t("tool.result.summary", "{c}°C = {f}°F")
      .replace("{c}", fmtLoc(last.primaryC)).replace("{f}", fmtLoc(last.primaryF));

    gmNoteEl.hidden = false;
    if (last.nearest.inRange) {
      var bandTxt = t("tool.band." + last.nearest.entry.band, last.nearest.entry.band);
      var gmTxt = gmLabel(last.nearest.entry.gm);
      var key = last.nearest.exact ? "tool.result.gmExact" : "tool.result.gmApprox";
      gmNoteEl.textContent = t(key, "Gas Mark {gm} — {band}").replace("{gm}", gmTxt).replace("{band}", bandTxt);
    } else {
      gmNoteEl.textContent = t("tool.result.gmNone", "No matching Gas Mark — outside the typical home oven range.");
    }
    highlightChart(last.nearest.inRange ? last.nearest.entry.gm : null);

    equivEl.hidden = false;
    if (ovenType === "fan") {
      equivEl.textContent = t("tool.result.equivStatic", "Conventional / static oven: about {c}°C / {f}°F")
        .replace("{c}", fmtLoc(last.cStatic)).replace("{f}", fmtLoc(last.fStatic));
    } else {
      equivEl.textContent = t("tool.result.equivFan", "Fan / convection oven: about {c}°C / {f}°F")
        .replace("{c}", fmtLoc(last.fanC)).replace("{f}", fmtLoc(last.fanF));
    }

    var warnTxt = "";
    if (last.belowAbsZero) warnTxt = t("tool.warn.abszero", "That's below absolute zero (−273.15°C) — not physically possible.");
    else if (last.capped) warnTxt = t("tool.warn.capped", "That number was capped to a realistic maximum for this calculation.");
    else if (last.cStatic < 50 || last.cStatic > 300) warnTxt = t("tool.warn.range", "That's outside the typical home oven range (about 50–300°C / 120–570°F).");
    if (warnTxt) { warnEl.hidden = false; warnEl.textContent = warnTxt; } else { warnEl.hidden = true; }
  }

  /* ---- 상태 갱신 (cStatic = 정온/컨벤셔널 기준 캐노니컬 모델) ---- */
  function setFromCStatic(cStatic, sourceField) {
    var sane = sanitizeC(cStatic);
    if (sane == null) { last = { kind: "bad" }; renderResult(); saveState(); return; }
    cStatic = sane.c;
    var fStatic = cToF(cStatic);
    var fanC = fanFromStatic(cStatic), fanF = cToF(fanC);
    var primaryC = ovenType === "fan" ? fanC : cStatic;
    var primaryF = ovenType === "fan" ? fanF : fStatic;
    if (sourceField !== "c") cInput.value = fmt(primaryC);
    if (sourceField !== "f") fInput.value = fmt(primaryF);
    var nearest = nearestGasMark(cStatic);
    if (sourceField !== "gm") gmSelect.value = nearest.inRange ? String(nearest.entry.gm) : "";
    last = {
      kind: "ok", cStatic: cStatic, fStatic: fStatic, fanC: fanC, fanF: fanF,
      primaryC: primaryC, primaryF: primaryF, nearest: nearest,
      belowAbsZero: sane.belowAbsZero, capped: sane.capped
    };
    renderResult();
    saveState();
  }
  function clearAll() {
    cInput.value = ""; fInput.value = ""; gmSelect.value = "";
    last = { kind: "empty" };
    renderResult();
    saveState();
  }

  function onCInput() {
    var raw = cInput.value;
    if (raw.length > MAXLEN) { cInput.value = raw.slice(0, MAXLEN); raw = cInput.value; }
    if (cInput.validity && cInput.validity.badInput) { last = { kind: "bad" }; renderResult(); return; }
    var trimmed = raw.trim();
    if (trimmed === "") { clearAll(); return; }
    var v = Number(trimmed);
    if (!isFinite(v)) { last = { kind: "bad" }; renderResult(); return; }
    var cStatic = ovenType === "fan" ? staticFromFan(v) : v;
    setFromCStatic(cStatic, "c");
  }
  function onFInput() {
    var raw = fInput.value;
    if (raw.length > MAXLEN) { fInput.value = raw.slice(0, MAXLEN); raw = fInput.value; }
    if (fInput.validity && fInput.validity.badInput) { last = { kind: "bad" }; renderResult(); return; }
    var trimmed = raw.trim();
    if (trimmed === "") { clearAll(); return; }
    var v = Number(trimmed);
    if (!isFinite(v)) { last = { kind: "bad" }; renderResult(); return; }
    var primaryC = fToC(v);
    var cStatic = ovenType === "fan" ? staticFromFan(primaryC) : primaryC;
    setFromCStatic(cStatic, "f");
  }
  function onGmChange() {
    var v = gmSelect.value;
    if (v === "") { clearAll(); return; }
    var entry = gasMarkEntry(parseFloat(v));
    if (!entry) { last = { kind: "bad" }; renderResult(); return; }
    setFromCStatic(entry.c, "gm");
  }
  function onFanToggle() {
    ovenType = fanToggle.checked ? "fan" : "static";
    if (last.kind === "ok") setFromCStatic(last.cStatic, null);
    else renderResult();
    saveState();
  }

  /* ---- 클릭 복사 ---- */
  function showCopyMsg(key, fallback) {
    if (!copyMsgEl) return;
    copyMsgEl.textContent = t(key, fallback);
    copyMsgEl.hidden = false;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(function () { copyMsgEl.hidden = true; }, 1600);
  }
  function copyValue(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var v = el.value.trim();
    if (v === "") { showCopyMsg("tool.copy.empty", "Nothing to copy yet — type a temperature first."); return; }
    var done = function () { showCopyMsg("tool.copy.done", "Copied to clipboard"); };
    var fail = function () { showCopyMsg("tool.copy.fail", "Couldn't copy. Please select and copy manually."); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(v).then(done, fail);
      } else {
        var ta = document.createElement("textarea");
        ta.value = v; ta.setAttribute("readonly", "");
        ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) { done(); } else { fail(); }
      }
    } catch (e) { fail(); }
  }

  /* ---- 이벤트 ---- */
  cInput.addEventListener("input", onCInput);
  fInput.addEventListener("input", onFInput);
  gmSelect.addEventListener("change", onGmChange);
  if (fanToggle) fanToggle.addEventListener("change", onFanToggle);
  for (var ci = 0; ci < copyBtns.length; ci++) {
    copyBtns[ci].addEventListener("click", function () { copyValue(this.getAttribute("data-target")); });
  }
  document.addEventListener("i18n:change", function () {
    renderGmOptions();
    renderChart();
    renderResult();
  });

  /* ---- 초기화 ---- */
  var restored = loadState();
  ovenType = restored.ovenType;
  if (fanToggle) fanToggle.checked = ovenType === "fan";
  renderGmOptions();
  renderChart();
  if (restored.cStatic != null) setFromCStatic(restored.cStatic, null);
  else renderResult();
  // TOOLJS:END
})();
