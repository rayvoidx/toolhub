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
  var TEXT_KEY     = "word-counter:last";
  var REMEMBER_KEY = "word-counter:remember";
  var WPM_KEY      = "word-counter:wpm";
  var SPEAK_WPM    = 130; // 말하기 속도(고정) — 발표·내레이션 기준

  // CJK(한자·가나·CJK호환): 공백 없이 이어 쓰므로 글자 단위로 셈
  // U+4E00–9FFF 한자 · U+3400–4DBF 확장A · U+3040–30FF 히라가나+가타카나 · U+F900–FAFF 호환한자
  var CJK_RE = /[一-鿿㐀-䶿぀-ヿ豈-﫿]/gu;

  var textEl     = document.getElementById("wc-text");
  var speedEl    = document.getElementById("wc-speed");
  var rememberEl = document.getElementById("wc-remember");
  var feedbackEl = document.getElementById("wc-feedback");

  var out = {
    words:      document.querySelector("#sc-words .stat-val"),
    chars:      document.querySelector("#sc-chars .stat-val"),
    charsNs:    document.querySelector("#sc-chars-ns .stat-val"),
    sentences:  document.querySelector("#sc-sentences .stat-val"),
    paragraphs: document.querySelector("#sc-paragraphs .stat-val"),
    read:       document.querySelector("#sc-read .stat-val"),
    speak:      document.querySelector("#sc-speak .stat-val")
  };

  // ----- 계산 함수 (모두 순수 함수 — 브라우저 로컬) -----

  /** 단어 수: CJK는 글자 단위, 공백 언어는 공백 분리.
   *  공백 토큰 중 글자·숫자를 하나도 포함하지 않는 것(이모지·순수 문장부호)은 단어에서 제외 */
  function countWords(text) {
    var han = (text.match(CJK_RE) || []).length;
    var rest = text.replace(CJK_RE, "").trim();
    var restWords = 0;
    if (rest !== "") {
      var tokens = rest.split(/\s+/);
      for (var i = 0; i < tokens.length; i++) {
        // 글자 또는 숫자를 하나라도 포함하면 단어 (이모지·순수 문장부호 제외)
        if (/[\p{L}\p{N}]/u.test(tokens[i])) restWords++;
      }
    }
    return han + restWords;
  }

  /** 글자 수(공백 포함) — 코드포인트 기준 */
  function countChars(text) {
    return Array.from(text).length;
  }

  /** 글자 수(공백 제외) — 코드포인트 기준 */
  function countCharsNoSpace(text) {
    return Array.from(text.replace(/\s/g, "")).length;
  }

  /** 문장 수 — 종결부호 없는 마지막 문장도 1로 셈 */
  function countSentences(text) {
    var m = text.match(/[^.!?。！？…\n]+[.!?。！？…]?/g) || [];
    return m.filter(function (s) { return s.trim() !== ""; }).length;
  }

  /** 문단 수 — 비어 있지 않은 각 줄 */
  function countParagraphs(text) {
    return text.split(/\n{2,}|\n/)
      .map(function (p) { return p.trim(); })
      .filter(Boolean).length;
  }

  /** 분(소수) → "m:ss" */
  function fmtTime(minutesFloat) {
    var totalSeconds = Math.round(minutesFloat * 60);
    var m = Math.floor(totalSeconds / 60);
    var s = totalSeconds % 60;
    return m + ":" + (s < 10 ? "0" + s : s);
  }

  /** 현재 언어 로케일로 숫자 포맷 */
  function fmt(n) {
    try {
      var lang = (window.I18N && window.I18N.lang && window.I18N.lang()) || undefined;
      return n.toLocaleString(lang);
    } catch (e) { return String(n); }
  }

  function t(key) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v == null ? key : v;
  }

  // ----- 렌더 -----

  function render() {
    var text = textEl ? textEl.value : "";
    var words = countWords(text);
    var wpm = getWpm();

    out.words.textContent      = fmt(words);
    out.chars.textContent      = fmt(countChars(text));
    out.charsNs.textContent    = fmt(countCharsNoSpace(text));
    out.sentences.textContent  = fmt(countSentences(text));
    out.paragraphs.textContent = fmt(countParagraphs(text));
    out.read.textContent       = fmtTime(words / wpm);
    out.speak.textContent      = fmtTime(words / SPEAK_WPM);
  }

  function getWpm() {
    var v = speedEl ? parseInt(speedEl.value, 10) : 200;
    return (!v || isNaN(v) || v <= 0) ? 200 : v; // 안전장치 — 0/음수/비정상 → 기본 200
  }

  // ----- 복사 -----

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
        function () { showFeedback(t("tool.copied").replace("{value}", value), false); },
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
      if (ok) { showFeedback(t("tool.copied").replace("{value}", value), false); }
      else { showFeedback(t("tool.copyError"), true); }
    } catch (e) {
      showFeedback(t("tool.copyError"), true);
    }
  }

  var grid = document.getElementById("wc-grid");
  if (grid) {
    grid.addEventListener("click", function (e) {
      var card = e.target.closest ? e.target.closest(".stat-card") : null;
      if (!card) return;
      var valEl = card.querySelector(".stat-val");
      if (valEl) copyValue(valEl.textContent);
    });
  }

  // ----- localStorage 저장/복원 (저장 거부 시 세션 메모리만 유지) -----

  function shouldRemember() { return !rememberEl || rememberEl.checked; }

  function saveText(text) {
    if (!shouldRemember()) return;
    try { localStorage.setItem(TEXT_KEY, text); } catch (e) { /* private mode */ }
  }

  function loadPrefs() {
    // 저장 동의 여부
    try {
      var r = localStorage.getItem(REMEMBER_KEY);
      if (rememberEl) rememberEl.checked = (r !== "0");
    } catch (e) { /* noop */ }
    // 읽기 속도
    try {
      var w = localStorage.getItem(WPM_KEY);
      if (w && speedEl) {
        for (var i = 0; i < speedEl.options.length; i++) {
          if (speedEl.options[i].value === w) { speedEl.value = w; break; }
        }
      }
    } catch (e) { /* noop */ }
    // 마지막 텍스트
    if (shouldRemember()) {
      try {
        var saved = localStorage.getItem(TEXT_KEY);
        if (typeof saved === "string" && saved.length > 0 && textEl) textEl.value = saved;
      } catch (e) { /* 손상된 값 무시 */ }
    }
  }

  // ----- 이벤트 -----

  if (textEl) {
    textEl.addEventListener("input", function () {
      render();
      saveText(textEl.value);
    });
  }

  if (speedEl) {
    speedEl.addEventListener("change", function () {
      render();
      try { localStorage.setItem(WPM_KEY, speedEl.value); } catch (e) { /* noop */ }
    });
  }

  if (rememberEl) {
    rememberEl.addEventListener("change", function () {
      try { localStorage.setItem(REMEMBER_KEY, rememberEl.checked ? "1" : "0"); } catch (e) { /* noop */ }
      if (rememberEl.checked) {
        saveText(textEl ? textEl.value : "");
      } else {
        try { localStorage.removeItem(TEXT_KEY); } catch (e) { /* noop */ } // 저장본 즉시 삭제, 화면 텍스트는 유지
      }
    });
  }

  // 언어 전환 시 숫자 포맷 재적용 (라벨은 i18n 엔진이 자동 갱신)
  document.addEventListener("i18n:change", render);

  // 초기화
  loadPrefs();
  render();
  // TOOLJS:END
})();
