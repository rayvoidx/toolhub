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
  /* Remove Line Breaks — 붙여넣은 텍스트에서 줄바꿈을 제거/결합한다. 3가지 모드:
     space(공백으로 결합) / none(그대로 삭제, 공백 추가 없음) /
     smart(빈 줄=문단 구분은 유지하되 문단 내부의 강제 줄바꿈만 한 줄로 펼침 — PDF 복붙 교정).
     상태: localStorage "<slug>:state"(텍스트+모드) / "<slug>:remember"(기억 여부) 만. 외부 API 없음. */

  var CFG = window.APP_CONFIG || {};
  var SLUG = CFG.slug || "remove-line-breaks";
  var STATE_KEY = SLUG + ":state";
  var REMEMBER_KEY = SLUG + ":remember";

  /* ---- 순수 변환 함수 (모두 브라우저 로컬, 외부 API 0) ---- */

  // 줄끝 정규화: \r\n, \r → \n
  function normalizeNewlines(s) {
    return String(s == null ? "" : s).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  // "공백으로 결합": 연속 줄바꿈(빈 줄 포함)을 구분자 하나로 보고, 각 조각을 trim 후 공백 하나로 이어붙인다.
  function joinWithSpace(norm) {
    var parts = norm.split(/\n+/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p.length) out.push(p);
    }
    return out.join(" ");
  }

  // "아무것도 없이 결합": 줄바꿈 문자만 제거 — 공백을 추가하지 않으므로 원문에 여백이 없으면 단어가 붙는다(의도된 동작).
  function joinWithNothing(norm) {
    return norm.replace(/\n+/g, "");
  }

  // "스마트": 빈 줄이 문단 경계 — 문단 사이는 빈 줄 하나(\n\n)로 정규화하고,
  // 문단 내부의 줄(하드 랩)은 trim 후 공백으로 이어붙여 한 줄로 펼친다.
  function smartUnwrap(norm) {
    var lines = norm.split("\n");
    var paragraphs = [];
    var current = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.trim() === "") {
        if (current.length) { paragraphs.push(current.join(" ")); current = []; }
      } else {
        current.push(line.trim());
      }
    }
    if (current.length) paragraphs.push(current.join(" "));
    return paragraphs.join("\n\n");
  }

  function transform(raw, mode) {
    var norm = normalizeNewlines(raw);
    if (mode === "none") return joinWithNothing(norm);
    if (mode === "smart") return smartUnwrap(norm);
    return joinWithSpace(norm); // 기본값 "space"
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      normalizeNewlines: normalizeNewlines, joinWithSpace: joinWithSpace,
      joinWithNothing: joinWithNothing, smartUnwrap: smartUnwrap, transform: transform
    };
    return;
  }

  /* ---- i18n · Intl 헬퍼 ---- */
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmt(n) {
    try { return Number(n).toLocaleString(uiLang()); }
    catch (e) { return String(n); }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var inputEl = $("rlb-input");
  var modeRadios = document.getElementsByName("rlb-mode");
  var modeHintEl = $("rlb-mode-hint");
  var clearEl = $("rlb-clear");
  var rememberEl = $("rlb-remember");
  var emptyEl = $("rlb-empty");
  var outWrap = $("rlb-output-wrap");
  var outputEl = $("rlb-output");
  var statsEl = $("rlb-stats");
  var copyEl = $("rlb-copy");
  var feedbackEl = $("rlb-feedback");
  if (!inputEl || !outputEl || !modeRadios.length) return;

  /* ---- 모드 상태 ---- */
  function getMode() {
    for (var i = 0; i < modeRadios.length; i++) {
      if (modeRadios[i].checked) return modeRadios[i].value;
    }
    return "space";
  }
  function setMode(mode) {
    for (var i = 0; i < modeRadios.length; i++) {
      modeRadios[i].checked = (modeRadios[i].value === mode);
    }
  }
  function updateModeHint() {
    if (modeHintEl) modeHintEl.textContent = tr("tool.mode.hint." + getMode(), "");
  }

  /* ---- localStorage 저장/복원 (저장 거부 시 세션 메모리만 유지) ---- */
  function shouldRemember() { return !rememberEl || rememberEl.checked; }

  function saveState() {
    if (!shouldRemember()) return;
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({ text: inputEl.value, mode: getMode() }));
    } catch (e) { /* private mode */ }
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(STATE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; } // 손상된 값 무시
  }
  function loadPrefs() {
    try {
      var r = localStorage.getItem(REMEMBER_KEY);
      if (rememberEl) rememberEl.checked = (r !== "0");
    } catch (e) { /* noop */ }
    if (shouldRemember()) {
      var st = loadState();
      if (st) {
        if (typeof st.text === "string") inputEl.value = st.text;
        if (typeof st.mode === "string") setMode(st.mode);
      }
    }
  }

  /* ---- 렌더 ---- */
  function render() {
    var raw = inputEl.value;
    if (raw.trim() === "") { // 빈 입력 → 결과 비활성(오류 아님, 안내 문구)
      if (emptyEl) emptyEl.hidden = false;
      if (outWrap) outWrap.hidden = true;
      return;
    }
    var mode = getMode();
    var norm = normalizeNewlines(raw);
    var out = transform(raw, mode);
    outputEl.value = out;

    var breaksBefore = (norm.match(/\n/g) || []).length;
    var breaksAfter = (out.match(/\n/g) || []).length;
    var removed = breaksBefore - breaksAfter;

    if (statsEl) {
      statsEl.textContent = tr("tool.stats", "Line breaks removed: {removed} · Characters: {before} → {after}")
        .replace("{removed}", fmt(removed))
        .replace("{before}", fmt(raw.length))
        .replace("{after}", fmt(out.length));
    }

    if (emptyEl) emptyEl.hidden = true;
    if (outWrap) outWrap.hidden = false;
  }

  /* ---- 복사 ---- */
  var feedbackTimer = null;
  function showFeedback(msg, isError) {
    if (!feedbackEl) return;
    feedbackEl.hidden = false;
    feedbackEl.textContent = msg;
    feedbackEl.style.color = isError ? "#b91c1c" : "var(--accent)";
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(function () { feedbackEl.hidden = true; }, 2000);
  }
  function fallbackCopy(value) {
    try {
      var ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) showFeedback(tr("tool.copied", "Copied"), false);
      else showFeedback(tr("tool.copyError", "Copy failed"), true);
    } catch (e) {
      showFeedback(tr("tool.copyError", "Copy failed"), true);
    }
  }
  function copyResult() {
    var value = outputEl.value;
    if (!value || !value.length) {
      showFeedback(tr("tool.emptyCopy", "Nothing to copy yet"), true);
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(
        function () { showFeedback(tr("tool.copied", "Copied"), false); },
        function () { fallbackCopy(value); }
      );
    } else {
      fallbackCopy(value);
    }
  }

  /* ---- 이벤트 ---- */
  inputEl.addEventListener("input", function () {
    render();
    saveState();
  });

  for (var i = 0; i < modeRadios.length; i++) {
    modeRadios[i].addEventListener("change", function () {
      updateModeHint();
      render();
      saveState();
    });
  }

  if (clearEl) {
    clearEl.addEventListener("click", function () {
      inputEl.value = "";
      inputEl.focus();
      render();
      try { if (shouldRemember()) localStorage.removeItem(STATE_KEY); } catch (e) { /* noop */ }
    });
  }

  if (rememberEl) {
    rememberEl.addEventListener("change", function () {
      try { localStorage.setItem(REMEMBER_KEY, rememberEl.checked ? "1" : "0"); } catch (e) { /* noop */ }
      if (rememberEl.checked) {
        saveState();
      } else {
        try { localStorage.removeItem(STATE_KEY); } catch (e) { /* noop */ } // 저장본 즉시 삭제, 화면 텍스트는 유지
      }
    });
  }

  if (copyEl) copyEl.addEventListener("click", copyResult);

  // 언어 전환 시 동적 문구(모드 안내·통계) 재적용
  document.addEventListener("i18n:change", function () {
    updateModeHint();
    render();
  });

  // 초기화
  loadPrefs();
  updateModeHint();
  render();
  // TOOLJS:END
})();
