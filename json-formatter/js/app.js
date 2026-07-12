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
  var LAST_KEY     = "json-formatter:last";
  var INDENT_KEY   = "json-formatter:indent";
  var SORT_KEY     = "json-formatter:sort";
  var REMEMBER_KEY = "json-formatter:remember";
  var BIG_BYTES    = 5 * 1024 * 1024; // 5MB — 경고만, 그래도 시도
  var DEBOUNCE_MS  = 300;

  var inputEl    = document.getElementById("jf-input");
  var outputEl   = document.getElementById("jf-output");
  var indentEl   = document.getElementById("jf-indent");
  var sortEl     = document.getElementById("jf-sort");
  var rememberEl = document.getElementById("jf-remember");
  var badgeEl    = document.getElementById("jf-badge");
  var statsEl    = document.getElementById("jf-stats");
  var messageEl  = document.getElementById("jf-message");
  var feedbackEl = document.getElementById("jf-feedback");
  var formatBtn  = document.getElementById("jf-format");
  var minifyBtn  = document.getElementById("jf-minify");
  var clearBtn   = document.getElementById("jf-clear");
  var copyBtn    = document.getElementById("jf-copy");
  var downloadBtn= document.getElementById("jf-download");

  // ----- i18n 헬퍼 (없거나 키 미존재 시 키 문자열로 폴백) -----
  function t(key) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v == null ? key : v;
  }

  // ----- 순수 로직 (전부 브라우저 로컬, 외부 API 0) -----

  /** 재귀적으로 객체 키를 알파벳 정렬 (배열 순서는 보존) */
  function sortValue(v) {
    if (Array.isArray(v)) {
      var arr = [];
      for (var i = 0; i < v.length; i++) arr.push(sortValue(v[i]));
      return arr;
    }
    if (v && typeof v === "object") {
      var out = {};
      var keys = Object.keys(v).sort();
      for (var j = 0; j < keys.length; j++) out[keys[j]] = sortValue(v[keys[j]]);
      return out;
    }
    return v;
  }

  /** 들여쓰기 인자: '2'|'4' → 숫자, 'tab' → '\t' */
  function currentIndent() {
    var v = indentEl ? indentEl.value : "2";
    if (v === "tab") return "\t";
    var n = parseInt(v, 10);
    return isNaN(n) ? 2 : n;
  }

  /** SyntaxError 에서 줄·열 위치 추출 (핵심 차별점) */
  function offsetToLineCol(text, pos) {
    if (pos > text.length) pos = text.length;
    if (pos < 0) pos = 0;
    var line = 1, lastNl = -1;
    for (var i = 0; i < pos; i++) {
      if (text.charCodeAt(i) === 10) { line++; lastNl = i; } // '\n'
    }
    return { line: line, col: pos - lastNl }; // 마지막 개행 이후 문자수(1-based)
  }

  function locateError(err, text) {
    var msg = (err && err.message) ? String(err.message) : t("tool.unknownError");
    var line = null, col = null;
    var m = /position (\d+)/i.exec(msg);
    if (m) {
      var lc = offsetToLineCol(text, parseInt(m[1], 10));
      line = lc.line; col = lc.col;
    } else {
      var m2 = /line (\d+)[ ,]+column (\d+)/i.exec(msg);
      if (m2) { line = parseInt(m2[1], 10); col = parseInt(m2[2], 10); }
    }
    return { message: msg, line: line, col: col };
  }

  /** 키 개수(재귀)·최대 중첩 깊이 통계 */
  function analyze(v) {
    var keys = 0, maxDepth = 0;
    (function walk(node, depth) {
      if (depth > maxDepth) maxDepth = depth;
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) walk(node[i], depth + 1);
      } else if (node && typeof node === "object") {
        var ks = Object.keys(node);
        keys += ks.length;
        for (var j = 0; j < ks.length; j++) walk(node[ks[j]], depth + 1);
      }
    })(v, 0);
    return { keys: keys, depth: maxDepth };
  }

  function byteLen(str) {
    try {
      if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str).length;
    } catch (e) { /* fallthrough */ }
    return unescape(encodeURIComponent(str)).length;
  }

  function fmtNum(n) {
    try { return n.toLocaleString(); } catch (e) { return String(n); }
  }

  /** 현재 입력을 파싱 — { state: 'empty'|'valid'|'invalid', ... } */
  function parseCurrent() {
    var raw = inputEl ? inputEl.value : "";
    if (!raw || !raw.trim()) return { state: "empty", raw: raw };
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return { state: "invalid", raw: raw, error: locateError(err, raw) };
    }
    return { state: "valid", raw: raw, parsed: parsed };
  }

  // ----- 상태 배지·메시지·통계 렌더 (출력 영역은 건드리지 않음) -----

  function setBadge(kind, text) {
    if (!badgeEl) return;
    badgeEl.textContent = text;
    if (kind === "valid") {
      badgeEl.style.color = "#fff";
      badgeEl.style.background = "var(--accent)";
      badgeEl.style.borderColor = "var(--accent)";
    } else if (kind === "invalid") {
      badgeEl.style.color = "#fff";
      badgeEl.style.background = "#dc2626";
      badgeEl.style.borderColor = "#dc2626";
    } else {
      badgeEl.style.color = "var(--muted)";
      badgeEl.style.background = "var(--bg)";
      badgeEl.style.borderColor = "var(--line)";
    }
  }

  function invalidLabel(err) {
    if (err.line != null && err.col != null) {
      return t("tool.invalidAt")
        .replace("{line}", fmtNum(err.line))
        .replace("{column}", fmtNum(err.col));
    }
    return t("tool.invalid");
  }

  /** 현재 입력 기준으로 배지/메시지/통계 갱신. 반환값 = parseCurrent() 결과 */
  function renderStatus() {
    var r = parseCurrent();
    if (r.state === "empty") {
      setBadge("neutral", t("tool.badgeNeutral"));
      if (statsEl) statsEl.textContent = "";
      if (messageEl) messageEl.textContent = t("tool.emptyHint");
    } else if (r.state === "valid") {
      setBadge("valid", t("tool.badgeValid"));
      var a = analyze(r.parsed);
      var bytes = byteLen(r.raw);
      if (statsEl) {
        statsEl.textContent =
          fmtNum(a.keys) + " " + t("tool.statKeys") + "  ·  " +
          fmtNum(a.depth) + " " + t("tool.statDepth") + "  ·  " +
          fmtNum(bytes) + " " + t("tool.statBytes");
      }
      if (messageEl) {
        messageEl.textContent = (bytes > BIG_BYTES) ? t("tool.large") : t("tool.validHint");
      }
    } else { // invalid
      setBadge("invalid", t("tool.badgeInvalid"));
      if (statsEl) statsEl.textContent = "";
      if (messageEl) messageEl.textContent = invalidLabel(r.error) + " · " + r.error.message;
    }
    return r;
  }

  /** 오류 줄을 입력창에서 선택 + 스크롤 (명시적 액션에서만 호출 — 타이핑 중 아님) */
  function highlightErrorLine(err, raw) {
    if (!inputEl || !err || err.line == null) return;
    var lines = raw.split("\n");
    var start = 0;
    for (var i = 0; i < err.line - 1 && i < lines.length; i++) start += lines[i].length + 1;
    var lineText = lines[err.line - 1] || "";
    var end = start + lineText.length;
    try {
      inputEl.focus();
      inputEl.setSelectionRange(start, end);
      // 대략적 세로 스크롤 (textarea 라인 높이 기반)
      var lh = parseFloat(getComputedStyle(inputEl).lineHeight) || 20;
      inputEl.scrollTop = Math.max(0, (err.line - 3) * lh);
    } catch (e) { /* 선택 불가 환경 무시 */ }
  }

  // ----- 액션: Format / Minify -----

  function produce(minify) {
    var r = renderStatus();
    if (r.state === "empty") {
      if (outputEl) outputEl.value = "";
      showFeedback(t("tool.emptyFormat"), true);
      return;
    }
    if (r.state === "invalid") {
      // 출력은 유지하지 않고 비운다 + 오류 줄 강조
      highlightErrorLine(r.error, r.raw);
      showFeedback(invalidLabel(r.error), true);
      return;
    }
    var value = (sortEl && sortEl.checked) ? sortValue(r.parsed) : r.parsed;
    var out;
    try {
      out = minify ? JSON.stringify(value) : JSON.stringify(value, null, currentIndent());
    } catch (e) {
      showFeedback(t("tool.stringifyError"), true);
      return;
    }
    if (outputEl) { outputEl.value = out; }
    showFeedback(minify ? t("tool.minified") : t("tool.formatted"), false);
  }

  // ----- 피드백 토스트 -----

  var feedbackTimer = null;
  function showFeedback(msg, isError) {
    if (!feedbackEl) return;
    feedbackEl.hidden = false;
    feedbackEl.textContent = msg;
    feedbackEl.style.color = isError ? "#dc2626" : "var(--accent)";
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(function () { feedbackEl.hidden = true; }, 2400);
  }

  // ----- 복사 / 다운로드 -----

  function copyOutput() {
    var value = outputEl ? outputEl.value : "";
    if (!value) { showFeedback(t("tool.emptyCopy"), true); return; }
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
      if (outputEl) { outputEl.focus(); outputEl.select(); }
      var ok = document.execCommand && document.execCommand("copy");
      if (ok) showFeedback(t("tool.copied"), false);
      else showFeedback(t("tool.copyError"), true);
    } catch (e) {
      showFeedback(t("tool.copyError"), true);
    }
  }

  function downloadOutput() {
    var value = outputEl ? outputEl.value : "";
    if (!value) { showFeedback(t("tool.emptyCopy"), true); return; }
    try {
      var blob = new Blob([value], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "formatted.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      showFeedback(t("tool.downloaded"), false);
    } catch (e) {
      showFeedback(t("tool.copyError"), true);
    }
  }

  // ----- localStorage 저장/복원 -----

  function shouldRemember() { return !rememberEl || rememberEl.checked; }

  function saveInput() {
    if (!shouldRemember()) return;
    try { localStorage.setItem(LAST_KEY, inputEl ? inputEl.value : ""); } catch (e) { /* private mode */ }
  }

  function savePrefs() {
    try {
      if (indentEl) localStorage.setItem(INDENT_KEY, indentEl.value);
      if (sortEl) localStorage.setItem(SORT_KEY, sortEl.checked ? "1" : "0");
    } catch (e) { /* noop */ }
  }

  function loadPrefs() {
    try {
      var rem = localStorage.getItem(REMEMBER_KEY);
      if (rememberEl) rememberEl.checked = (rem !== "0");
    } catch (e) { /* noop */ }
    try {
      var ind = localStorage.getItem(INDENT_KEY);
      if (ind && indentEl) indentEl.value = ind;
      var srt = localStorage.getItem(SORT_KEY);
      if (srt != null && sortEl) sortEl.checked = (srt === "1");
    } catch (e) { /* noop */ }
    if (shouldRemember()) {
      try {
        var last = localStorage.getItem(LAST_KEY);
        if (typeof last === "string" && last.length > 0 && inputEl) inputEl.value = last;
      } catch (e) { /* 손상 값 무시 */ }
    }
  }

  // ----- 실시간 검증 (디바운스) -----

  var debTimer = null;
  function scheduleValidate() {
    if (debTimer) clearTimeout(debTimer);
    debTimer = setTimeout(function () { renderStatus(); saveInput(); }, DEBOUNCE_MS);
  }

  // ----- 이벤트 배선 -----

  if (inputEl) inputEl.addEventListener("input", scheduleValidate);
  if (formatBtn) formatBtn.addEventListener("click", function () { produce(false); });
  if (minifyBtn) minifyBtn.addEventListener("click", function () { produce(true); });
  if (copyBtn) copyBtn.addEventListener("click", copyOutput);
  if (downloadBtn) downloadBtn.addEventListener("click", downloadOutput);

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      if (inputEl) { inputEl.value = ""; inputEl.focus(); }
      if (outputEl) outputEl.value = "";
      renderStatus();
      try { if (shouldRemember()) localStorage.removeItem(LAST_KEY); } catch (e) { /* noop */ }
    });
  }

  if (indentEl) indentEl.addEventListener("change", function () {
    savePrefs();
    if (outputEl && outputEl.value) produce(false); // 이미 포맷된 출력은 새 들여쓰기로 갱신
  });
  if (sortEl) sortEl.addEventListener("change", function () {
    savePrefs();
    if (outputEl && outputEl.value) produce(false);
  });

  if (rememberEl) {
    rememberEl.addEventListener("change", function () {
      try { localStorage.setItem(REMEMBER_KEY, rememberEl.checked ? "1" : "0"); } catch (e) { /* noop */ }
      if (rememberEl.checked) saveInput();
      else { try { localStorage.removeItem(LAST_KEY); } catch (e) { /* noop */ } }
    });
  }

  // 언어 전환 시 배지·메시지·통계 재렌더 (출력 JSON 은 언어 무관 — 그대로 둔다)
  document.addEventListener("i18n:change", function () { renderStatus(); });

  // 초기화
  loadPrefs();
  var init = renderStatus();
  if (init.state === "valid" && outputEl && !outputEl.value) produce(false); // 복원된 입력을 즉시 포맷
  // TOOLJS:END
})();
