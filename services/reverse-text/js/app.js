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
  /* Reverse Text Generator — 세 가지 모드(문자 전체 반전 / 단어 순서 반전 /
     각 단어 내부 철자 반전)를 항상 동시에 계산해 카드 3개로 보여준다.
     상태: localStorage "reverse-text:last" / "reverse-text:remember" 만. 외부 API 없음. */
  var TEXT_KEY     = "reverse-text:last";
  var REMEMBER_KEY = "reverse-text:remember";
  var PLACEHOLDER  = "—"; // 빈 입력일 때 카드에 표시

  var inputEl    = document.getElementById("rt-text");
  var clearEl    = document.getElementById("rt-clear");
  var rememberEl = document.getElementById("rt-remember");
  var hintEl     = document.getElementById("rt-hint");
  var feedbackEl = document.getElementById("rt-feedback");

  // ----- 순수 변환 함수 (모두 브라우저 로컬, 외부 API 0) -----
  // Array.from 은 UTF-16 서로게이트 쌍을 하나의 코드포인트로 묶어서 순회하므로
  // 이모지·희귀 한자 등(BMP 밖 문자)이 charAt 루프처럼 반쪽으로 잘려 깨지는 것을 막는다.
  // 단, ZWJ 로 여러 코드포인트를 이어 붙인 복합 이모지(가족 이모지 등)는 여전히
  // 낱개 코드포인트로 분해되어 재배열되므로 완전한 글리프 보존은 보장하지 않는다(FAQ 참고).

  /** 문자 전체 반전 — 전체 문자열을 코드포인트 단위로 뒤집는다(공백 포함). */
  function reverseChars(text) {
    return Array.from(text).reverse().join("");
  }

  /** 단어 순서 반전 — 공백(개행 포함)으로 분리한 단어들의 "순서"만 뒤집는다.
      단어 자체 철자와 다중 공백/개행은 보존하지 않고 단일 스페이스로 이어붙인다. */
  function reverseWordOrder(text) {
    var words = text.split(/\s+/).filter(function (w) { return w.length > 0; });
    return words.reverse().join(" ");
  }

  /** 각 단어 내부 철자 반전 — 단어 순서와 원문 공백 구조는 그대로 두고
      단어(연속된 비공백 토큰) 내부만 코드포인트 단위로 뒤집는다. */
  function reverseLettersInWords(text) {
    return text.replace(/\S+/g, function (w) {
      return Array.from(w).reverse().join("");
    });
  }

  var MODES = [
    { id: "chars",   fn: reverseChars },
    { id: "words",   fn: reverseWordOrder },
    { id: "letters", fn: reverseLettersInWords }
  ];

  // 결과 값 캐시(복사용) + DOM 참조 캐시
  var values = {};
  var valEls = {};
  MODES.forEach(function (m) {
    valEls[m.id] = document.querySelector("#rt-" + m.id + " .rt-val");
  });

  function setVal(id, value) {
    values[id] = value;
    var el = valEls[id];
    if (el) el.textContent = value.length ? value : PLACEHOLDER; // 빈 결과 → '—' (조용한 실패 금지)
  }

  function render() {
    var text = inputEl ? inputEl.value : "";
    for (var i = 0; i < MODES.length; i++) setVal(MODES[i].id, MODES[i].fn(text));
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

  function onCardClick(e) {
    var card = e.target && e.target.closest ? e.target.closest(".rt-card") : null;
    if (!card || !card.id) return;
    var id = card.id.replace(/^rt-/, "");
    var value = values[id];
    if (!value || value.length === 0) { // 빈 입력 → 조용한 실패 대신 안내
      showFeedback(t("tool.emptyCopy"), true);
      return;
    }
    copyValue(value);
  }

  var grid = document.getElementById("rt-grid");
  if (grid) grid.addEventListener("click", onCardClick);

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
        var savedText = localStorage.getItem(TEXT_KEY);
        if (typeof savedText === "string" && savedText.length > 0 && inputEl) inputEl.value = savedText;
      } catch (e) { /* 손상된 값 무시 */ }
    }
  }

  // ----- 이벤트 -----
  if (inputEl) {
    inputEl.addEventListener("input", function () {
      render();
      saveText(inputEl.value);
    });
    // Enter 로 즉시 반영(입력은 실시간이라 이미 반영되지만, IME 확정 등 엣지케이스 대비)
    inputEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) render();
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
