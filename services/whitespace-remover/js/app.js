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
  /* Extra Space Remover — paste text, apply a checkbox matrix of cleanup operations
     (collapse multiple spaces / trim line edges / remove tabs / remove blank lines /
     remove ALL whitespace) IN THE FIXED ORDER LISTED ABOVE, and show before/after
     character counts. Non-breaking spaces (U+00A0) and invisible zero-width characters
     (U+200B/U+200C/U+200D/U+FEFF) are ALWAYS normalized first, regardless of which
     checkboxes are on — this is a core selling point of the tool, not an option.
     상태: localStorage "<slug>:state" 만 (입력 텍스트 + 옵션). 외부 API 없음, 모든 처리는 로컬. */

  // ----- 순수 함수 (문자열 변환 — 브라우저 로컬, node 단위 검증 대상) -----

  // 항상 먼저 실행: NBSP(U+00A0) → 일반 공백, 제로폭 문자(U+200B~200D, U+FEFF) → 완전 제거.
  // 워드프로세서/웹페이지에서 복사한 텍스트에 흔히 섞여 들어가는 "보이지 않는" 문자들이라
  // 체크박스와 무관하게 항상 정리한다(툴의 핵심 셀링 포인트 — UI 문구로도 안내한다).
  function normalizeInvisible(text) {
    if (!text) return "";
    var s = String(text).replace(/\u00A0/g, " ");
    s = s.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");
    return s;
  }

  // 탭 → 공백 1칸으로 치환(완전 삭제하면 "word1\tword2" 가 "word1word2" 로 붙어버리는 사고 방지).
  function removeTabs(text) { return text.replace(/\t/g, " "); }

  // 일반 공백(스페이스) 2개 이상 연속 → 1개. 줄바꿈은 건드리지 않는다.
  function collapseSpaces(text) { return text.replace(/ {2,}/g, " "); }

  // 각 줄의 앞뒤 공백/탭만 제거 — 줄 내부 내용과 줄바꿈 자체는 그대로 둔다.
  function trimLineEdges(text) {
    return text.split("\n").map(function (line) {
      return line.replace(/^[ \t]+|[ \t]+$/g, "");
    }).join("\n");
  }

  // 공백만 있는(또는 완전히 빈) 줄을 제거 — trimLineEdges 체크 여부와 무관하게 자체 판정.
  function removeBlankLines(text) {
    return text.split("\n").filter(function (line) {
      return line.replace(/^\s+|\s+$/g, "") !== "";
    }).join("\n");
  }

  // 공백류 문자(스페이스/탭/줄바꿈/유니코드 공백)를 전부 제거 — 가장 파괴적인 옵션.
  function removeAllWhitespace(text) { return text.replace(/\s+/g, ""); }

  // 체크박스 매트릭스를 "고정된 순서"로 적용한다: 이 순서가 결과에 실제로 영향을 준다
  // (예: 탭이 공백 1칸으로 바뀌는 시점이 공백 축약 이후라 그 공백은 재축약되지 않는다 — FAQ 참고).
  function cleanText(raw, opts) {
    var s = normalizeInvisible(raw);
    if (opts.collapse) s = collapseSpaces(s);
    if (opts.trimLines) s = trimLineEdges(s);
    if (opts.noTabs) s = removeTabs(s);
    if (opts.noBlank) s = removeBlankLines(s);
    if (opts.allWs) s = removeAllWhitespace(s);
    return s;
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      normalizeInvisible: normalizeInvisible, removeTabs: removeTabs,
      collapseSpaces: collapseSpaces, trimLineEdges: trimLineEdges,
      removeBlankLines: removeBlankLines, removeAllWhitespace: removeAllWhitespace,
      cleanText: cleanText
    };
    return;
  }

  /* ---- DOM ---- */
  var $ = function (id) { return document.getElementById(id); };
  var cfg = window.APP_CONFIG || {};
  var STATE_KEY = (cfg.slug || "whitespace-remover") + ":state";

  var inputEl = $("wsr-input");
  var collapseEl = $("wsr-collapse");
  var trimLinesEl = $("wsr-trimlines");
  var noTabsEl = $("wsr-notabs");
  var noBlankEl = $("wsr-noblank");
  var allWsEl = $("wsr-allws");
  var runBtn = $("wsr-run");
  var sampleBtn = $("wsr-sample");
  var clearBtn = $("wsr-clear");
  var inCountEl = $("wsr-input-count");
  var msgEmptyEl = $("wsr-msg-empty");
  var overrideNoteEl = $("wsr-override-note");
  var outWrap = $("wsr-out-wrap");
  var outputEl = $("wsr-output");
  var statsGridEl = $("wsr-stats-grid");
  var statBeforeEl = $("wsr-stat-before");
  var statAfterEl = $("wsr-stat-after");
  var statRemovedEl = $("wsr-stat-removed");
  var copyBtn = $("wsr-copy");
  var useBtn = $("wsr-use");
  var copyHintEl = $("wsr-copy-hint");

  if (!inputEl || !outputEl) return; // 마크업 없으면 조용히 종료 (다른 페이지 방지)

  var hasRun = false; // true면 이후 체크박스 변경 시 자동 재계산
  var lastBefore = 0, lastAfter = 0;
  var copyHintTimer = null;

  function t(key) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v == null ? key : v;
  }
  function fmtNum(n) {
    try {
      var lang = (window.I18N && window.I18N.lang && window.I18N.lang()) || undefined;
      return n.toLocaleString(lang);
    } catch (e) { return String(n); }
  }
  function fmtChars(n) { return t("tool.charCount").replace("{n}", fmtNum(n)); }

  function readOpts() {
    return {
      collapse: !!(collapseEl && collapseEl.checked),
      trimLines: !!(trimLinesEl && trimLinesEl.checked),
      noTabs: !!(noTabsEl && noTabsEl.checked),
      noBlank: !!(noBlankEl && noBlankEl.checked),
      allWs: !!(allWsEl && allWsEl.checked)
    };
  }

  // ----- 렌더 -----

  // 입력창 글자수는 항상 즉시 표시(=계속 보이는 "before" 카운트). 공백만 있는 입력도
  // 이 도구에서는 유효한 테스트 케이스이므로 trim() 이 아니라 length 로만 판정한다.
  function updateInputCount(raw) {
    if (inCountEl) inCountEl.textContent = raw.length > 0 ? fmtChars(raw.length) : "";
  }

  function updateOverrideNote(opts) {
    if (overrideNoteEl) overrideNoteEl.hidden = !opts.allWs;
  }

  function showEmptyState() {
    if (outWrap) outWrap.hidden = true;
    if (statsGridEl) statsGridEl.hidden = true;
    if (msgEmptyEl) msgEmptyEl.hidden = false;
    hasRun = false;
    lastBefore = 0; lastAfter = 0;
  }

  function process() {
    var raw = inputEl.value;
    updateInputCount(raw);

    if (raw.length === 0) {
      showEmptyState();
      saveState();
      return;
    }

    var opts = readOpts();
    updateOverrideNote(opts);
    var cleaned = cleanText(raw, opts);
    lastBefore = raw.length;
    lastAfter = cleaned.length;

    if (msgEmptyEl) msgEmptyEl.hidden = true;
    if (outWrap) outWrap.hidden = false;
    outputEl.value = cleaned;

    if (statsGridEl) {
      statsGridEl.hidden = false;
      if (statBeforeEl) statBeforeEl.textContent = fmtChars(lastBefore);
      if (statAfterEl) statAfterEl.textContent = fmtChars(lastAfter);
      if (statRemovedEl) statRemovedEl.textContent = fmtChars(lastBefore - lastAfter);
    }

    hasRun = true;
    saveState();
  }

  // ----- 복사 -----

  function flashCopyHint(key) {
    if (!copyHintEl) return;
    copyHintEl.hidden = false;
    copyHintEl.textContent = t(key);
    if (copyHintTimer) clearTimeout(copyHintTimer);
    copyHintTimer = setTimeout(function () { copyHintEl.hidden = true; }, 1800);
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      flashCopyHint(ok ? "tool.copied" : "tool.copyError");
    } catch (e) {
      flashCopyHint("tool.copyError");
    }
  }

  function copyOutput() {
    var text = outputEl ? outputEl.value : "";
    if (!text && text !== "") return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { flashCopyHint("tool.copied"); },
        function () { fallbackCopy(text); }
      );
    } else {
      fallbackCopy(text);
    }
  }

  // ----- localStorage 저장/복원 -----

  function saveState() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        input: inputEl.value,
        collapse: !!(collapseEl && collapseEl.checked),
        trimLines: !!(trimLinesEl && trimLinesEl.checked),
        noTabs: !!(noTabsEl && noTabsEl.checked),
        noBlank: !!(noBlankEl && noBlankEl.checked),
        allWs: !!(allWsEl && allWsEl.checked)
      }));
    } catch (e) { /* private mode — 세션 메모리만 유지 */ }
  }

  function loadState() {
    var s = null;
    try {
      var raw = localStorage.getItem(STATE_KEY);
      if (raw) s = JSON.parse(raw);
    } catch (e) { s = null; /* 손상된 값 무시 */ }
    if (!s || typeof s !== "object") return;
    if (typeof s.input === "string") inputEl.value = s.input;
    if (collapseEl) collapseEl.checked = !!s.collapse;
    if (trimLinesEl) trimLinesEl.checked = !!s.trimLines;
    if (noTabsEl) noTabsEl.checked = !!s.noTabs;
    if (noBlankEl) noBlankEl.checked = !!s.noBlank;
    if (allWsEl) allWsEl.checked = !!s.allWs;
  }

  // ----- 샘플 데이터 (이중 공백·탭·연속 빈 줄·줄 앞뒤 공백·NBSP·제로폭 문자를 모두 포함) -----
  var SAMPLE_TEXT =
    "  Hello   world!  \n" +
    "\tThis line\thas a tab\tand   double   spaces.\n" +
    "\n\n" +
    "   Leading and trailing spaces on this line.   \n" +
    "\n" +
    "Non\u00A0breaking\u00A0space\u00A0example.\n" +
    "Zero\u200Bwidth\u200Bspace\u200Cand\u200Djoiners hidden in here.\n" +
    "\n   \n";

  // ----- 이벤트 -----

  if (runBtn) runBtn.addEventListener("click", process);

  if (sampleBtn) {
    sampleBtn.addEventListener("click", function () {
      inputEl.value = SAMPLE_TEXT;
      process();
      inputEl.focus();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      inputEl.value = "";
      showEmptyState();
      updateInputCount("");
      saveState();
      inputEl.focus();
    });
  }

  if (inputEl) {
    inputEl.addEventListener("input", function () {
      updateInputCount(inputEl.value);
      saveState();
    });
  }

  [collapseEl, trimLinesEl, noTabsEl, noBlankEl, allWsEl].forEach(function (el) {
    if (!el) return;
    el.addEventListener("change", function () {
      updateOverrideNote(readOpts());
      if (hasRun || inputEl.value.length > 0) process();
      else saveState();
    });
  });

  if (copyBtn) copyBtn.addEventListener("click", copyOutput);

  if (useBtn) {
    useBtn.addEventListener("click", function () {
      inputEl.value = outputEl.value;
      updateInputCount(inputEl.value);
      process();
      inputEl.focus();
    });
  }

  // 언어 전환 시 카운트·통계 문구를 현재 숫자 그대로 새 언어 포맷으로 다시 그린다(재계산은 안 함)
  document.addEventListener("i18n:change", function () {
    if (inputEl.value.length > 0) updateInputCount(inputEl.value);
    if (hasRun) {
      if (statBeforeEl) statBeforeEl.textContent = fmtChars(lastBefore);
      if (statAfterEl) statAfterEl.textContent = fmtChars(lastAfter);
      if (statRemovedEl) statRemovedEl.textContent = fmtChars(lastBefore - lastAfter);
    }
  });

  // ----- 초기화 -----
  loadState();
  updateInputCount(inputEl.value);
  updateOverrideNote(readOpts());
  if (inputEl.value.length > 0) {
    process();
  } else {
    showEmptyState();
  }
  // TOOLJS:END
})();
