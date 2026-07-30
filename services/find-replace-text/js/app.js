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
  /* Find and Replace Text — 텍스트에서 찾을 문자열/정규식을 찾아 바꿀 문자열로 전체 치환.
     대소문자 구분·단어 단위·정규식 모드 옵션 + 적용 전 실시간 일치 개수·하이라이트 미리보기,
     적용 1회 되돌리기(1단계 undo), 결과 복사. 상태: localStorage "<slug>:state" 만. 외부 API 없음. */

  /* ---- 순수 로직 (node 단위 검증 가능한 형태로 분리) ---- */

  // 리터럴 검색용 정규식 특수문자 이스케이프 (MDN 표준 패턴)
  function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // 리터럴 모드 교체 문자열에서 $&, $1 같은 정규식 치환 패턴이 우연히 해석되지 않도록 $ 이스케이프
  function escapeReplacement(str) {
    return String(str).replace(/\$/g, "$$$$");
  }

  // find 문자열 + 옵션 → { regex, error }. 정규식 오류는 조용히 삼키지 않고 그대로 반환.
  function buildRegex(find, opts) {
    if (!find) return { regex: null, error: null };
    opts = opts || {};
    var flags = "g" + (opts.caseSensitive ? "" : "i");
    var source = opts.regexMode ? find : escapeRegExp(find);
    if (opts.wholeWord) source = "\\b(?:" + source + ")\\b";
    try {
      return { regex: new RegExp(source, flags), error: null };
    } catch (e) {
      return { regex: null, error: e.message };
    }
  }

  // 일치 개수. String#match(전역 정규식)은 빈 문자열 매치(예: /a*/)도 안전하게 처리한다(무한루프 없음).
  function countMatches(text, regex) {
    if (!regex) return 0;
    var m = text.match(regex);
    return m ? m.length : 0;
  }

  // 전체 치환. regexMode=false 면 교체문의 $ 를 이스케이프해 순수 리터럴로만 동작시킨다.
  function applyReplace(text, regex, replacement, regexMode) {
    if (!regex) return text;
    var rep = regexMode ? replacement : escapeReplacement(replacement);
    return text.replace(regex, rep);
  }

  // 미리보기용 세그먼트 분해: [{text, matched}] — 빈 문자열 매치는 무한루프 방지를 위해 수동으로 1칸 전진.
  // MAX 는 병적인(pathological) 패턴이 거대한 텍스트에 걸렸을 때 미리보기 렌더링을 보호하는 상한이며,
  // 실제 일치 개수(countMatches)에는 영향을 주지 않는다 — 표시되는 개수는 항상 정확하다.
  function buildSegments(text, regex) {
    var segments = [];
    if (!regex) {
      if (text) segments.push({ text: text, matched: false });
      return segments;
    }
    var MAX = 5000;
    regex.lastIndex = 0;
    var lastIndex = 0, match, count = 0;
    while (count < MAX && (match = regex.exec(text)) !== null) {
      var start = match.index, matched = match[0];
      if (start > lastIndex) segments.push({ text: text.slice(lastIndex, start), matched: false });
      if (matched.length > 0) {
        segments.push({ text: matched, matched: true });
        lastIndex = start + matched.length;
      } else {
        lastIndex = start;
        regex.lastIndex += 1; // 빈 매치는 진행이 없으므로 강제로 한 칸 전진
      }
      count++;
      if (regex.lastIndex > text.length) break;
    }
    if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), matched: false });
    return segments;
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      escapeRegExp: escapeRegExp, escapeReplacement: escapeReplacement,
      buildRegex: buildRegex, countMatches: countMatches,
      applyReplace: applyReplace, buildSegments: buildSegments
    };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmt(n) {
    try { return Number(n).toLocaleString(uiLang(), { maximumFractionDigits: 0 }); }
    catch (e) { return String(n); }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var textEl = $("frt-text"), findEl = $("frt-find"), replaceEl = $("frt-replace");
  var caseEl = $("frt-case"), wordEl = $("frt-word"), regexEl = $("frt-regex");
  var errorEl = $("frt-error");
  var applyBtn = $("frt-apply"), undoBtn = $("frt-undo"), copyBtn = $("frt-copy"), clearBtn = $("frt-clear");
  var feedbackEl = $("frt-feedback");
  var statusEl = $("frt-status"), previewEmptyEl = $("frt-preview-empty"), previewEl = $("frt-preview");
  if (!textEl || !findEl || !replaceEl || !previewEl) return;

  var SKEY = (window.APP_CONFIG && window.APP_CONFIG.slug || "find-replace-text") + ":state";
  var undoText = null; // 1단계 되돌리기 — "적용" 직전 텍스트 스냅샷 (null = 되돌릴 것 없음)
  var feedbackTimer = null;

  function currentOpts() {
    return {
      caseSensitive: !!(caseEl && caseEl.checked),
      wholeWord: !!(wordEl && wordEl.checked),
      regexMode: !!(regexEl && regexEl.checked)
    };
  }

  /* ---- 저장/복원 ---- */
  function save() {
    try {
      localStorage.setItem(SKEY, JSON.stringify({
        text: textEl.value, find: findEl.value, replace: replaceEl.value,
        caseSensitive: currentOpts().caseSensitive,
        wholeWord: currentOpts().wholeWord,
        regexMode: currentOpts().regexMode
      }));
    } catch (e) { /* private mode — 저장만 실패, 도구는 정상 동작 */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(SKEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (typeof s.text === "string") textEl.value = s.text;
      if (typeof s.find === "string") findEl.value = s.find;
      if (typeof s.replace === "string") replaceEl.value = s.replace;
      if (caseEl) caseEl.checked = !!s.caseSensitive;
      if (wordEl) wordEl.checked = !!s.wholeWord;
      if (regexEl) regexEl.checked = !!s.regexMode;
    } catch (e) { /* 손상된 값 무시 */ }
  }

  /* ---- 피드백 메시지 (적용/되돌리기/복사 결과 — 일치 개수 상태문과는 별도) ---- */
  function showFeedback(msg) {
    if (!feedbackEl) return;
    feedbackEl.textContent = msg;
    feedbackEl.hidden = false;
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(function () { feedbackEl.hidden = true; }, 2200);
  }

  /* ---- 미리보기 렌더 (텍스트 노드 + <mark> 만 사용 — innerHTML 조립 없이 XSS 원천 차단) ---- */
  function renderPreview(text, regex) {
    var MAXLEN = 20000;
    var src = text, truncated = false;
    if (src.length > MAXLEN) { src = src.slice(0, MAXLEN); truncated = true; }
    var segments = buildSegments(src, regex);
    previewEl.textContent = "";
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      if (!seg.text) continue;
      if (seg.matched) {
        var mark = document.createElement("mark");
        mark.className = "frt-mark";
        mark.textContent = seg.text;
        previewEl.appendChild(mark);
      } else {
        previewEl.appendChild(document.createTextNode(seg.text));
      }
    }
    if (truncated) {
      var note = document.createElement("span");
      note.className = "frt-trunc";
      note.textContent = " " + tr("tool.preview.truncated", "(preview truncated — showing the first 20,000 characters)");
      previewEl.appendChild(note);
    }
  }

  /* ---- 메인 렌더: 정규식 컴파일 → 오류/빈값/일치 없음/일치 있음 4가지 상태를 명시적으로 분기 ---- */
  function render() {
    var text = textEl.value;
    var find = findEl.value;
    var built = buildRegex(find, currentOpts());

    if (built.error) {
      errorEl.textContent = tr("tool.err.regex", "Invalid regular expression: {msg}").replace("{msg}", built.error);
      errorEl.hidden = false;
      statusEl.textContent = "";
      previewEl.hidden = true;
      previewEmptyEl.hidden = false;
      previewEmptyEl.textContent = tr("tool.preview.invalid", "Fix the regular expression above to see a preview.");
      if (applyBtn) applyBtn.disabled = true;
      return;
    }
    errorEl.hidden = true;

    if (!find) {
      statusEl.textContent = tr("tool.status.empty", "Enter text to find.");
      previewEl.hidden = true;
      previewEmptyEl.hidden = false;
      previewEmptyEl.textContent = tr("tool.preview.empty", "Type something in \"Find\" to see a live match preview here.");
      if (applyBtn) applyBtn.disabled = true;
      return;
    }

    if (applyBtn) applyBtn.disabled = false;
    var count = countMatches(text, built.regex);
    if (count === 0) {
      statusEl.textContent = tr("tool.status.none", "No matches found.");
    } else if (count === 1) {
      statusEl.textContent = tr("tool.status.one", "1 match found.");
    } else {
      statusEl.textContent = tr("tool.status.many", "{n} matches found.").replace("{n}", fmt(count));
    }
    previewEmptyEl.hidden = true;
    previewEl.hidden = false;
    renderPreview(text, built.regex);
  }

  /* ---- 클립보드 복사 (navigator.clipboard 우선, execCommand 폴백) ---- */
  function legacyCopy(value, done) {
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
      if (ok) done(); else showFeedback(tr("tool.err.copy", "Copy failed — select and copy manually."));
    } catch (e) {
      showFeedback(tr("tool.err.copy", "Copy failed — select and copy manually."));
    }
  }
  function doCopy() {
    var text = textEl.value;
    if (!text) { showFeedback(tr("tool.err.emptyCopy", "Nothing to copy yet.")); return; }
    var done = function () { showFeedback(tr("tool.copied", "Copied to clipboard.")); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text, done); });
    } else {
      legacyCopy(text, done);
    }
  }

  /* ---- 적용 / 되돌리기 ---- */
  function doApply() {
    var text = textEl.value;
    var find = findEl.value;
    if (!find) return;
    var built = buildRegex(find, currentOpts());
    if (built.error || !built.regex) return; // 오류 상태면 버튼이 이미 비활성
    var count = countMatches(text, built.regex);
    if (count === 0) {
      showFeedback(tr("tool.status.none", "No matches found."));
      return;
    }
    var replaced = applyReplace(text, built.regex, replaceEl.value, currentOpts().regexMode);
    undoText = text; // 되돌리기 1단계 — 직전 텍스트만 기억
    textEl.value = replaced;
    if (undoBtn) undoBtn.hidden = false;
    save();
    render();
    showFeedback(count === 1
      ? tr("tool.applied.one", "Replaced 1 occurrence.")
      : tr("tool.applied.many", "Replaced {n} occurrences.").replace("{n}", fmt(count)));
  }
  function doUndo() {
    if (undoText == null) return;
    textEl.value = undoText;
    undoText = null;
    if (undoBtn) undoBtn.hidden = true;
    save();
    render();
    showFeedback(tr("tool.undone", "Reverted to the previous text."));
  }
  function doClear() {
    textEl.value = "";
    findEl.value = "";
    replaceEl.value = "";
    undoText = null;
    if (undoBtn) undoBtn.hidden = true;
    save();
    render();
    textEl.focus();
  }

  /* ---- 이벤트 ---- */
  textEl.addEventListener("input", function () { render(); save(); });
  findEl.addEventListener("input", function () { render(); save(); });
  replaceEl.addEventListener("input", save);
  if (caseEl) caseEl.addEventListener("change", function () { render(); save(); });
  if (wordEl) wordEl.addEventListener("change", function () { render(); save(); });
  if (regexEl) regexEl.addEventListener("change", function () { render(); save(); });
  if (applyBtn) applyBtn.addEventListener("click", doApply);
  if (undoBtn) undoBtn.addEventListener("click", doUndo);
  if (copyBtn) copyBtn.addEventListener("click", doCopy);
  if (clearBtn) clearBtn.addEventListener("click", doClear);
  // find/replace 입력창에서 Enter → 즉시 적용 (ux.js 셸 보강과 별개로, 이 도구는 Enter 의미가 뚜렷해 직접 처리)
  findEl.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); doApply(); } });
  replaceEl.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); doApply(); } });
  // 언어 전환 시 상태/미리보기 문구 재적용 (일치 자체는 언어 무관이라 재계산은 저비용)
  document.addEventListener("i18n:change", render);

  load();
  render();
  // TOOLJS:END
})();
