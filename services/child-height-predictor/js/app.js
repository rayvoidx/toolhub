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
  var LS_KEY = (cfg.slug || "child-height-predictor") + ":last";
  var CM_PER_IN = 2.54;
  var SEX_ADJ = 13;      // sex adjustment (cm) — Tanner mid-parental
  var HALF_RANGE = 8.5;  // ±cm likely band (~2 SD, ~80% of children)

  function $(id) { return document.getElementById(id); }
  var calcBtn = $("calc-btn");
  var msgEl = $("chp-msg");
  var bodyEl = $("chp-body");
  var warnEl = $("chp-warn");
  var cmEl = $("chp-cm");
  var ftinEl = $("chp-ftin");
  var rangeCmEl = $("chp-range-cm");
  var rangeFtinEl = $("chp-range-ftin");
  if (!calcBtn || !msgEl || !bodyEl) return;

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
  function parseNum(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (s === "") return null;
    var n = Number(s);
    return isNaN(n) ? null : n;
  }

  // ---- calc-core:start — pure functions (node unit-test target) ----
  function midParentalCm(fatherCm, motherCm, sex) {
    var adj = sex === "boy" ? SEX_ADJ : -SEX_ADJ;
    return (fatherCm + motherCm + adj) / 2;
  }
  function likelyRangeCm(mphCm) {
    return { low: mphCm - HALF_RANGE, high: mphCm + HALF_RANGE };
  }
  function cmToFtIn(cm) {                    // display: whole inches, with carry
    var totalIn = cm / CM_PER_IN;
    var ft = Math.floor(totalIn / 12);
    var inch = Math.round(totalIn - ft * 12);
    if (inch === 12) { ft += 1; inch = 0; }
    return { ft: ft, in: inch };
  }
  function cmToFtInPrecise(cm) {             // input conversion: keep 1 decimal inch
    var totalIn = cm / CM_PER_IN;
    var ft = Math.floor(totalIn / 12);
    var inch = Math.round((totalIn - ft * 12) * 10) / 10;
    if (inch >= 12) { ft += 1; inch = 0; }
    return { ft: ft, in: inch };
  }
  function ftInToCm(ft, inch) {
    return (ft * 12 + inch) * CM_PER_IN;
  }
  // ---- calc-core:end ----

  function fmtCm(cm) {
    var n = Math.round(cm * 10) / 10;
    return (n % 1 === 0 ? String(n) : n.toFixed(1)) + " cm";
  }
  function fmtFtIn(cm) {
    var r = cmToFtIn(cm);
    return r.ft + "'" + r.in + '"';
  }

  var last = null; // last render state (for i18n re-render; persistent state -> localStorage only)

  function showMsg(key, fallback, isError) {
    last = { kind: "msg", key: key, fallback: fallback, isError: !!isError };
    bodyEl.hidden = true;
    msgEl.hidden = false;
    msgEl.className = "chp-msg" + (isError ? " is-error" : "");
    msgEl.textContent = t(key, fallback);
  }

  function render(st) {
    last = { kind: "result", st: st };
    msgEl.hidden = true;
    bodyEl.hidden = false;

    var mph = midParentalCm(st.fatherCm, st.motherCm, st.sex);
    var range = likelyRangeCm(mph);

    cmEl.textContent = fmtCm(mph);
    ftinEl.textContent = fmtFtIn(mph);
    rangeCmEl.textContent = fmtCm(range.low) + " – " + fmtCm(range.high);
    rangeFtinEl.textContent = fmtFtIn(range.low) + " – " + fmtFtIn(range.high);

    var farFromAvg = st.fatherCm < 150 || st.fatherCm > 195 ||
                     st.motherCm < 150 || st.motherCm > 195;
    warnEl.hidden = !farFromAvg;
  }

  // read a parent's height (cm) from the currently-visible unit fields
  function readParentCm(prefix) {
    if (radioVal("hunit") === "ft") {
      var ft = parseNum($(prefix + "-ft").value);
      var inch = parseNum($(prefix + "-in").value);
      if (ft == null) return null;           // feet required in imperial mode
      return ftInToCm(ft, inch == null ? 0 : inch);
    }
    var cm = parseNum($(prefix + "-cm").value);
    return cm;
  }

  function calculate() {
    var sex = radioVal("sex");
    var fatherCm = readParentCm("father");
    var motherCm = readParentCm("mother");

    // empty input -> explicit notice (no silent failure)
    if (fatherCm == null || motherCm == null || !sex) {
      showMsg("tool.err.empty", "Enter both parents' heights and the child's sex.", false);
      return;
    }
    if (fatherCm < 120 || fatherCm > 230) {
      showMsg("tool.err.father", "Enter the father's height between 120 and 230 cm (about 3'11\"–7'7\").", true);
      return;
    }
    if (motherCm < 120 || motherCm > 220) {
      showMsg("tool.err.mother", "Enter the mother's height between 120 and 220 cm (about 3'11\"–7'3\").", true);
      return;
    }

    render({ fatherCm: fatherCm, motherCm: motherCm, sex: sex });
    persist();
  }

  function persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        hunit: radioVal("hunit"),
        sex: radioVal("sex"),
        fcm: $("father-cm").value, fft: $("father-ft").value, fin: $("father-in").value,
        mcm: $("mother-cm").value, mft: $("mother-ft").value, min: $("mother-in").value
      }));
    } catch (e) { /* private mode — ignore */ }
  }

  function applyUnitVisibility() {
    var ft = radioVal("hunit") === "ft";
    $("father-cm-wrap").hidden = ft;
    $("father-ftin-wrap").hidden = !ft;
    $("mother-cm-wrap").hidden = ft;
    $("mother-ftin-wrap").hidden = !ft;
  }

  // unit toggle -> convert current values so nothing is lost on switch
  function convertParent(prefix, toUnit) {
    if (toUnit === "ft") {
      var cm = parseNum($(prefix + "-cm").value);
      if (cm == null) return;
      var r = cmToFtInPrecise(cm);
      $(prefix + "-ft").value = r.ft;
      $(prefix + "-in").value = r.in;
    } else {
      var ft = parseNum($(prefix + "-ft").value);
      if (ft == null) return;
      var inch = parseNum($(prefix + "-in").value);
      var cm2 = ftInToCm(ft, inch == null ? 0 : inch);
      $(prefix + "-cm").value = Math.round(cm2 * 10) / 10;
    }
  }

  var hUnitRadios = document.getElementsByName("hunit");
  for (var i = 0; i < hUnitRadios.length; i++) {
    hUnitRadios[i].addEventListener("change", function () {
      var to = radioVal("hunit");
      convertParent("father", to);
      convertParent("mother", to);
      applyUnitVisibility();
      persist();
    });
  }

  // restore last inputs (localStorage only — never sent to a server)
  (function restore() {
    try {
      var saved = localStorage.getItem(LS_KEY);
      if (saved) {
        var p = JSON.parse(saved);
        if (p.hunit === "cm" || p.hunit === "ft") setRadio("hunit", p.hunit);
        if (p.sex === "boy" || p.sex === "girl") setRadio("sex", p.sex);
        if (p.fcm) $("father-cm").value = p.fcm;
        if (p.fft) $("father-ft").value = p.fft;
        if (p.fin) $("father-in").value = p.fin;
        if (p.mcm) $("mother-cm").value = p.mcm;
        if (p.mft) $("mother-ft").value = p.mft;
        if (p.min) $("mother-in").value = p.min;
      }
    } catch (e) { /* unreadable/parse fail — start with empty form */ }
    applyUnitVisibility();
  })();

  calcBtn.addEventListener("click", calculate);
  function onEnter(e) { if (e.key === "Enter") calculate(); }
  ["father-cm", "father-ft", "father-in", "mother-cm", "mother-ft", "mother-in"].forEach(function (id) {
    var el = $(id);
    if (el) el.addEventListener("keydown", onEnter);
  });

  // language switch -> re-render dynamic copy (messages)
  document.addEventListener("i18n:change", function () {
    if (!last) return;
    if (last.kind === "msg") showMsg(last.key, last.fallback, last.isError);
    else render(last.st);
  });

  // initial prompt (no silent empty state)
  showMsg("tool.err.empty", "Enter both parents' heights and the child's sex.", false);
  // TOOLJS:END
})();
