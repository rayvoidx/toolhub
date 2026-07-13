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
  var LS_KEY = (cfg.slug || "ideal-weight-calc") + ":last";
  var LB_PER_KG = 2.20462;

  function $(id) { return document.getElementById(id); }
  var sexRadios = document.getElementsByName("sex");
  var hCmEl = $("height-cm");
  var hFtEl = $("height-ft");
  var hInEl = $("height-in");
  var wEl = $("weight-input");
  var cmWrap = $("height-cm-wrap");
  var ftWrap = $("height-ft-wrap");
  var calcBtn = $("calc-btn");
  var box = $("result-box");
  var errEl = $("result-error");
  var bodyEl = $("result-body");
  var warnEl = $("result-warning");
  var rangeEl = $("r-range");
  var posEl = $("r-position");
  if (!hCmEl || !calcBtn || !box) return;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function radioVal(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }
  function setRadio(name, value) {
    var el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (el) el.checked = true;
  }

  // ---- calc-core:start — pure functions (node unit-test target) ----
  function computeIdeal(sex, heightCm) {
    var hIn = heightCm / 2.54;
    var over = hIn - 60;                 // inches over 5 ft
    var m = sex === "male";
    return {
      devine:   (m ? 50   : 45.5) + (m ? 2.3  : 2.3)  * over,
      robinson: (m ? 52   : 49)   + (m ? 1.9  : 1.7)  * over,
      miller:   (m ? 56.2 : 53.1) + (m ? 1.41 : 1.36) * over,
      hamwi:    (m ? 48   : 45.5) + (m ? 2.7  : 2.2)  * over
    };
  }
  function healthyRange(heightCm) {
    var m = heightCm / 100;
    return { min: 18.5 * m * m, max: 24.9 * m * m };
  }
  function position(currentKg, range) {
    if (currentKg < range.min) return { state: "below", gap: range.min - currentKg };
    if (currentKg > range.max) return { state: "above", gap: currentKg - range.max };
    return { state: "within", gap: 0 };
  }
  // ---- calc-core:end ----

  function wUnit() { return radioVal("wunit") === "lb" ? "lb" : "kg"; }
  function toDisplay(kg) { return wUnit() === "lb" ? kg * LB_PER_KG : kg; }
  function unitLabel() { return t(wUnit() === "lb" ? "tool.unit.lb" : "tool.unit.kg", wUnit()); }
  function num1(kg) { return (Math.round(toDisplay(kg) * 10) / 10).toFixed(1); }
  function withUnit(kg) { return num1(kg) + " " + unitLabel(); }

  var last = null; // last render state (for i18n/unit re-render; persistent state -> localStorage only)

  function showError(key, fallback) {
    last = { kind: "error", key: key, fallback: fallback };
    box.hidden = false;
    bodyEl.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key, fallback);
  }

  function setCard(name, kg, forceWarn) {
    var card = document.querySelector('[data-card="' + name + '"]');
    var out = $("r-" + name);
    if (!(kg > 0)) {                 // formula result <= 0 (extreme short height): hide card
      if (card) card.hidden = true;
      forceWarn.v = true;
      return;
    }
    if (card) card.hidden = false;
    if (out) out.textContent = withUnit(kg);
  }

  function render(st) {
    last = { kind: "result", st: st };
    errEl.hidden = true;
    bodyEl.hidden = false;
    box.hidden = false;

    var ideal = computeIdeal(st.sex, st.heightCm);
    var range = healthyRange(st.heightCm);
    var forceWarn = { v: false };

    setCard("devine", ideal.devine, forceWarn);
    setCard("robinson", ideal.robinson, forceWarn);
    setCard("miller", ideal.miller, forceWarn);
    setCard("hamwi", ideal.hamwi, forceWarn);

    rangeEl.textContent = num1(range.min) + " – " + num1(range.max) + " " + unitLabel();

    // calibration warning: outside typical adult band, or a hidden formula card
    var outOfBand = st.heightCm < 150 || st.heightCm > 210;
    warnEl.hidden = !(outOfBand || forceWarn.v);

    if (st.currentKg != null) {
      var pos = position(st.currentKg, range);
      posEl.hidden = false;
      if (pos.state === "within") {
        posEl.textContent = t("tool.pos.within", "Within a healthy weight range");
        posEl.style.color = "#15803d";
        posEl.style.background = "rgba(22,163,74,0.12)";
      } else if (pos.state === "below") {
        posEl.textContent = t("tool.pos.below", "{gap} below a healthy weight").replace("{gap}", withUnit(pos.gap));
        posEl.style.color = "#1d4ed8";
        posEl.style.background = "rgba(37,99,235,0.12)";
      } else {
        posEl.textContent = t("tool.pos.above", "{gap} above a healthy weight").replace("{gap}", withUnit(pos.gap));
        posEl.style.color = "#c2410c";
        posEl.style.background = "rgba(234,88,12,0.12)";
      }
    } else {
      posEl.hidden = true;
    }
  }

  function readHeightCm() {
    var unit = radioVal("hunit") === "ft" ? "ft" : "cm";
    if (unit === "cm") {
      var cmRaw = hCmEl.value.trim();
      return cmRaw === "" ? NaN : Number(cmRaw);
    }
    var ftRaw = hFtEl.value.trim();
    var inRaw = hInEl.value.trim();
    if (ftRaw === "") return NaN;          // feet required in imperial mode
    var ft = Number(ftRaw);
    var inch = inRaw === "" ? 0 : Number(inRaw);
    if (isNaN(ft) || isNaN(inch)) return NaN;
    return (ft * 12 + inch) * 2.54;
  }

  function calculate() {
    var sex = radioVal("sex");
    var heightCm = readHeightCm();

    // empty sex or height -> explicit notice (no silent failure)
    if (!sex || isNaN(heightCm)) {
      showError("tool.err.empty", "Enter your sex and height.");
      return;
    }
    if (heightCm < 100 || heightCm > 250) {
      showError("tool.err.height", "Enter a height between 100 and 250 cm (about 3'3\" to 8'2\").");
      return;
    }

    // current weight is optional
    var currentKg = null;
    var wRaw = wEl.value.trim();
    if (wRaw !== "") {
      var w = Number(wRaw);
      var unit = wUnit();
      var cap = unit === "lb" ? 880 : 400;
      if (isNaN(w) || w <= 0 || w > cap) {
        showError("tool.err.weight", "Enter a current weight above 0 (up to 400 kg / 880 lb), or leave it blank.");
        return;
      }
      currentKg = unit === "lb" ? w / LB_PER_KG : w;
    }

    render({ sex: sex, heightCm: heightCm, currentKg: currentKg });
    persist();
  }

  function persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        sex: radioVal("sex"),
        hunit: radioVal("hunit"),
        cm: hCmEl.value,
        ft: hFtEl.value,
        inch: hInEl.value,
        wunit: radioVal("wunit"),
        weight: wEl.value
      }));
    } catch (e) { /* private mode — ignore */ }
  }

  function applyHeightUnit() {
    var ft = radioVal("hunit") === "ft";
    if (cmWrap) cmWrap.hidden = ft;
    if (ftWrap) ftWrap.hidden = !ft;
  }

  // restore last inputs (localStorage only — never sent to a server)
  (function restore() {
    try {
      var saved = localStorage.getItem(LS_KEY);
      if (!saved) return;
      var p = JSON.parse(saved);
      if (p.sex === "male" || p.sex === "female") setRadio("sex", p.sex);
      if (p.hunit === "cm" || p.hunit === "ft") setRadio("hunit", p.hunit);
      if (p.cm) hCmEl.value = p.cm;
      if (p.ft) hFtEl.value = p.ft;
      if (p.inch) hInEl.value = p.inch;
      if (p.wunit === "kg" || p.wunit === "lb") setRadio("wunit", p.wunit);
      if (p.weight) wEl.value = p.weight;
    } catch (e) { /* unreadable/parse fail — start with empty form */ }
    applyHeightUnit();
  })();

  // height unit toggle -> switch visible fields
  var hUnitRadios = document.getElementsByName("hunit");
  for (var i = 0; i < hUnitRadios.length; i++) {
    hUnitRadios[i].addEventListener("change", applyHeightUnit);
  }
  // weight unit toggle -> re-render displayed figures in the new unit
  var wUnitRadios = document.getElementsByName("wunit");
  for (var j = 0; j < wUnitRadios.length; j++) {
    wUnitRadios[j].addEventListener("change", function () {
      if (last && last.kind === "result") render(last.st);
    });
  }

  calcBtn.addEventListener("click", calculate);
  function onEnter(e) { if (e.key === "Enter") calculate(); }
  hCmEl.addEventListener("keydown", onEnter);
  if (hFtEl) hFtEl.addEventListener("keydown", onEnter);
  if (hInEl) hInEl.addEventListener("keydown", onEnter);
  if (wEl) wEl.addEventListener("keydown", onEnter);

  // language switch -> re-render dynamic copy (units, position text, errors)
  document.addEventListener("i18n:change", function () {
    if (!last) return;
    if (last.kind === "error") showError(last.key, last.fallback);
    else render(last.st);
  });
  // TOOLJS:END
})();
