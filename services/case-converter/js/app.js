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
  var TEXT_KEY     = "case-converter:last";
  var REMEMBER_KEY = "case-converter:remember";
  var PLACEHOLDER  = "—"; // — : 빈 결과(빈 입력 / 개발자 케이스 토큰 없음)

  var inputEl    = document.getElementById("cc-text");
  var clearEl    = document.getElementById("cc-clear");
  var rememberEl = document.getElementById("cc-remember");
  var hintEl     = document.getElementById("cc-hint");
  var feedbackEl = document.getElementById("cc-feedback");

  // ----- 순수 변환 함수 (모두 브라우저 로컬, 외부 API 0) -----

  function cap(w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }
  function low(w) { return w.toLowerCase(); }
  function up(w)  { return w.toUpperCase(); }

  /** Title Case — 각 단어 첫 글자만 대문자, 원문 구조·공백 보존 */
  function titleCase(text) {
    return text.replace(/\S+/g, function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    });
  }

  /** Sentence case — 소문자화 후 문두 및 [.!?] 뒤 첫 글자만 대문자 */
  function sentenceCase(text) {
    return text.toLowerCase().replace(/(^\s*|[.!?]+[\s"')\]]*)(\p{L})/gu, function (m, pre, ch) {
      return pre + ch.toUpperCase();
    });
  }

  /** aLtErNaTiNg cAsE — 글자만 인덱스로 소/대 교대(비글자는 그대로), index 0 = 소문자 */
  function alternatingCase(text) {
    var idx = 0, out = "";
    var chars = Array.from(text);
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      if (/\p{L}/u.test(ch)) {
        out += (idx % 2 === 0) ? ch.toLowerCase() : ch.toUpperCase();
        idx++;
      } else {
        out += ch;
      }
    }
    return out;
  }

  /** tOGGLE cASE — 글자별 현재 케이스 반전 */
  function toggleCase(text) {
    var chars = Array.from(text), out = "";
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i], lo = ch.toLowerCase(), hi = ch.toUpperCase();
      if (ch === lo && ch !== hi) out += hi;        // 소문자 → 대문자
      else if (ch === hi && ch !== lo) out += lo;   // 대문자 → 소문자
      else out += ch;                               // 케이스 없음(숫자·기호·CJK)
    }
    return out;
  }

  /** 개발자 케이스용 토큰화 — 라틴 식별자만 (A-Za-z0-9) */
  function tokenize(text) {
    return text
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")       // camel 경계: myXml → my Xml
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")    // 약어 경계: HTTPServer → HTTP Server
      .split(/[^A-Za-z0-9]+/)                        // 구분자(_, -, ., 공백 등) 분리
      .filter(Boolean);
  }

  // 일반 케이스(원문 대상) / 개발자 케이스(토큰 배열 대상)
  var GENERAL = [
    { id: "upper",       fn: function (t) { return t.toUpperCase(); } },
    { id: "lower",       fn: function (t) { return t.toLowerCase(); } },
    { id: "title",       fn: titleCase },
    { id: "sentence",    fn: sentenceCase },
    { id: "alternating", fn: alternatingCase },
    { id: "toggle",      fn: toggleCase }
  ];
  var DEVELOPER = [
    { id: "camel",    fn: function (w) { return w.map(function (x, i) { return i ? cap(x) : x.toLowerCase(); }).join(""); } },
    { id: "pascal",   fn: function (w) { return w.map(cap).join(""); } },
    { id: "snake",    fn: function (w) { return w.map(low).join("_"); } },
    { id: "constant", fn: function (w) { return w.map(up).join("_"); } },
    { id: "kebab",    fn: function (w) { return w.map(low).join("-"); } },
    { id: "dot",      fn: function (w) { return w.map(low).join("."); } }
  ];

  // 결과 값 캐시(복사용) + DOM 참조 캐시 (10만자+ 에서도 dataset 왕복 없이 O(n))
  var values = {};
  var valEls = {};
  GENERAL.concat(DEVELOPER).forEach(function (c) {
    valEls[c.id] = document.querySelector("#cc-" + c.id + " .case-val");
  });

  function setVal(id, value) {
    values[id] = value;
    var el = valEls[id];
    if (el) el.textContent = value.length ? value : PLACEHOLDER; // 빈 결과 → '—' (조용한 실패 금지)
  }

  function render() {
    var text = inputEl ? inputEl.value : "";
    for (var i = 0; i < GENERAL.length; i++) setVal(GENERAL[i].id, GENERAL[i].fn(text));
    var words = tokenize(text);
    for (var j = 0; j < DEVELOPER.length; j++) setVal(DEVELOPER[j].id, DEVELOPER[j].fn(words));
  }

  // ----- i18n 헬퍼 -----

  function t(key) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v == null ? key : v;
  }

  // ----- 복사 (navigator.clipboard 우선, execCommand 폴백) -----

  var feedbackTimer = null;
  function showFeedback(msg, isError) {
    if (!feedbackEl) return;
    feedbackEl.hidden = false;
    feedbackEl.textContent = msg;
    feedbackEl.style.color = isError ? "#b91c1c" : "var(--accent)";
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(function () { feedbackEl.hidden = true; }, 2000);
  }

  function copyValue(value) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(
        function () { showFeedback(t("tool.copied"), false); },
        function () { fallbackCopy(value); }
      );
    } else {
      fallbackCopy(value);
    }
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
      if (ok) showFeedback(t("tool.copied"), false);
      else showFeedback(t("tool.copyError"), true);
    } catch (e) {
      showFeedback(t("tool.copyError"), true);
    }
  }

  function onCardClick(e) {
    var card = e.target && e.target.closest ? e.target.closest(".case-card") : null;
    if (!card || !card.id) return;
    var id = card.id.replace(/^cc-/, "");
    var value = values[id];
    if (!value || value.length === 0) {         // 빈 입력·토큰 없음 → 조용한 실패 대신 안내
      showFeedback(t("tool.emptyCopy"), true);
      return;
    }
    copyValue(value);
  }

  var genGrid = document.getElementById("cc-grid-general");
  var devGrid = document.getElementById("cc-grid-developer");
  if (genGrid) genGrid.addEventListener("click", onCardClick);
  if (devGrid) devGrid.addEventListener("click", onCardClick);

  // ----- localStorage 저장/복원 (저장 거부 시 세션 메모리만 유지) -----

  function shouldRemember() { return !rememberEl || rememberEl.checked; }

  function saveText(text) {
    if (!shouldRemember()) return;
    try { localStorage.setItem(TEXT_KEY, text); } catch (e) { /* private mode */ }
  }

  function loadPrefs() {
    try {
      var r = localStorage.getItem(REMEMBER_KEY);
      if (rememberEl) rememberEl.checked = (r !== "0");
    } catch (e) { /* noop */ }
    if (shouldRemember()) {
      try {
        var saved = localStorage.getItem(TEXT_KEY);
        if (typeof saved === "string" && saved.length > 0 && inputEl) inputEl.value = saved;
      } catch (e) { /* 손상된 값 무시 */ }
    }
  }

  // ----- 이벤트 -----

  if (inputEl) {
    inputEl.addEventListener("input", function () {
      render();
      saveText(inputEl.value);
    });
  }

  if (clearEl) {
    clearEl.addEventListener("click", function () {
      if (inputEl) { inputEl.value = ""; inputEl.focus(); }
      render();
      try { if (shouldRemember()) localStorage.removeItem(TEXT_KEY); } catch (e) { /* noop */ }
    });
  }

  if (rememberEl) {
    rememberEl.addEventListener("change", function () {
      try { localStorage.setItem(REMEMBER_KEY, rememberEl.checked ? "1" : "0"); } catch (e) { /* noop */ }
      if (rememberEl.checked) {
        saveText(inputEl ? inputEl.value : "");
      } else {
        try { localStorage.removeItem(TEXT_KEY); } catch (e) { /* noop */ } // 저장본 즉시 삭제, 화면 텍스트는 유지
      }
    });
  }

  // 초기화 (라벨은 i18n 엔진이 자동 갱신 — 결과는 언어 무관이라 재렌더 불필요)
  loadPrefs();
  render();
  // TOOLJS:END
})();
