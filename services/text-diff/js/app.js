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
  /* Text Diff Checker — line-based diff via a hand-written LCS (longest common
     subsequence) algorithm, with word-level highlighting inside changed-line
     pairs. No external API, no server: everything runs on values already in
     the two textareas. State (both texts + the two options) is mirrored to
     localStorage under "<slug>:state" only. */

  // Caps protect the tab from freezing on pathological pastes — the DP table
  // below is O(lines_a * lines_b), so we bound both dimensions and the total
  // character count before ever building it.
  var MAX_LINES = 2000;
  var MAX_CHARS = 200000;
  // A single unbroken line longer than this skips word-level highlighting
  // (the token-level LCS is O(tokens_a * tokens_b) and a 200k-char line with
  // no whitespace would otherwise still tokenize to one huge "word").
  var WORD_DIFF_MAX_LINE_LEN = 2000;

  /* ---- pure helpers (node 검증 대상) ---- */
  // Splits on \n after normalizing \r\n/\r. "" -> 0 lines; "a\n" -> ["a",""].
  function toLines(text) {
    if (text === "") return [];
    return String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  }
  // Comparison key for a line — trailing-space/case options only affect matching,
  // never what is actually rendered (the raw line text is always displayed).
  function normLineKey(line, opts) {
    var s = line;
    if (opts.ignoreTrailingSpace) s = s.replace(/[ \t]+$/, "");
    if (opts.ignoreCase) s = s.toLowerCase();
    return s;
  }
  // Splits a line into whitespace-run and non-whitespace-run tokens (both kept,
  // so joining them reconstructs the line) — this is the "word" granularity.
  function toTokens(line) {
    var m = line.match(/[^\s]+|\s+/g);
    return m || (line === "" ? [] : [line]);
  }
  // Generic LCS diff over two arrays, comparing via keyFn(item). Returns an
  // ordered list of {type:"equal"|"delete"|"insert", a, b} (a/b are indexes
  // into the original arrays, -1 when not applicable). O(a.length*b.length).
  function lcsDiff(a, b, keyFn) {
    var n = a.length, m = b.length, i, j;
    var ka = new Array(n), kb = new Array(m);
    for (i = 0; i < n; i++) ka[i] = keyFn(a[i]);
    for (j = 0; j < m; j++) kb[j] = keyFn(b[j]);
    var W = m + 1;
    var dp = new Int32Array((n + 1) * W);
    for (i = 1; i <= n; i++) {
      for (j = 1; j <= m; j++) {
        if (ka[i - 1] === kb[j - 1]) {
          dp[i * W + j] = dp[(i - 1) * W + (j - 1)] + 1;
        } else {
          var up = dp[(i - 1) * W + j], left = dp[i * W + (j - 1)];
          dp[i * W + j] = up >= left ? up : left;
        }
      }
    }
    var ops = [];
    i = n; j = m;
    while (i > 0 && j > 0) {
      if (ka[i - 1] === kb[j - 1]) {
        ops.push({ type: "equal", a: i - 1, b: j - 1 });
        i--; j--;
      } else if (dp[(i - 1) * W + j] >= dp[i * W + (j - 1)]) {
        ops.push({ type: "delete", a: i - 1, b: -1 });
        i--;
      } else {
        ops.push({ type: "insert", a: -1, b: j - 1 });
        j--;
      }
    }
    while (i > 0) { ops.push({ type: "delete", a: i - 1, b: -1 }); i--; }
    while (j > 0) { ops.push({ type: "insert", a: -1, b: j - 1 }); j--; }
    ops.reverse();
    return ops;
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      toLines: toLines, normLineKey: normLineKey, toTokens: toTokens, lcsDiff: lcsDiff,
      MAX_LINES: MAX_LINES, MAX_CHARS: MAX_CHARS
    };
    return;
  }

  /* ---- i18n helpers ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "text-diff") + ":state";
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmtNum(n) {
    try { return new Intl.NumberFormat(uiLang()).format(n); }
    catch (e) { return String(n); }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var aEl = $("td-original"), bEl = $("td-changed");
  var ignoreCaseEl = $("td-ignore-case"), ignoreTrailingEl = $("td-ignore-trailing");
  var compareBtn = $("td-compare"), swapBtn = $("td-swap"), clearBtn = $("td-clear");
  var statsEl = $("td-stats");
  var statAddedEl = $("td-stat-added"), statRemovedEl = $("td-stat-removed"), statUnchangedEl = $("td-stat-unchanged");
  var outputEl = $("td-output"), emptyEl = $("td-empty"), noDiffEl = $("td-nodiff"), errEl = $("td-error");
  if (!aEl || !bEl || !outputEl) return;

  /* ---- state persistence (best-effort — private browsing may block it) ---- */
  function save() {
    try {
      localStorage.setItem(SKEY, JSON.stringify({
        a: aEl.value, b: bEl.value,
        ic: !!ignoreCaseEl.checked, it: !!ignoreTrailingEl.checked
      }));
    } catch (e) { /* noop */ }
  }
  function restore() {
    try {
      var raw = localStorage.getItem(SKEY);
      if (!raw) return;
      var st = JSON.parse(raw);
      if (typeof st.a === "string") aEl.value = st.a;
      if (typeof st.b === "string") bEl.value = st.b;
      if (typeof st.ic === "boolean") ignoreCaseEl.checked = st.ic;
      if (typeof st.it === "boolean") ignoreTrailingEl.checked = st.it;
    } catch (e) { /* corrupt/unavailable — start fresh, not a crash */ }
  }

  /* ---- rendering ---- */
  function clearChildren(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function appendPlainRow(type, text) {
    var row = document.createElement("div");
    row.className = "td-row td-" + type;
    var marker = document.createElement("span");
    marker.className = "td-marker";
    marker.textContent = type === "delete" ? "−" : type === "insert" ? "+" : " ";
    var content = document.createElement("span");
    content.className = "td-text";
    content.textContent = text === "" ? " " : text;
    row.appendChild(marker);
    row.appendChild(content);
    outputEl.appendChild(row);
  }

  // Word-level LCS for one changed-line pair. Returns null (fallback to plain
  // rows) when either line is too long to tokenize/diff cheaply.
  function computeWordDiff(aLine, bLine, opts) {
    if (aLine.length > WORD_DIFF_MAX_LINE_LEN || bLine.length > WORD_DIFF_MAX_LINE_LEN) return null;
    var ta = toTokens(aLine), tb = toTokens(bLine);
    var keyFn = opts.ignoreCase
      ? function (t) { return t.toLowerCase(); }
      : function (t) { return t; };
    return { ops: lcsDiff(ta, tb, keyFn), ta: ta, tb: tb };
  }

  // Renders one side ("old" or "new") of a word-diffed changed-line pair,
  // wrapping only the tokens that actually differ in <del>/<ins>.
  function appendWordRow(type, wordData, side) {
    var row = document.createElement("div");
    row.className = "td-row td-" + type;
    var marker = document.createElement("span");
    marker.className = "td-marker";
    marker.textContent = type === "delete" ? "−" : "+";
    var content = document.createElement("span");
    content.className = "td-text";
    var ops = wordData.ops, ta = wordData.ta, tb = wordData.tb, wrote = false;
    for (var k = 0; k < ops.length; k++) {
      var op = ops[k], tok, wrap;
      if (side === "old") {
        if (op.type === "insert") continue;
        tok = ta[op.a];
        wrap = op.type === "delete";
      } else {
        if (op.type === "delete") continue;
        tok = tb[op.b];
        wrap = op.type === "insert";
      }
      if (wrap) {
        var mark = document.createElement(side === "old" ? "del" : "ins");
        mark.className = "td-chg";
        mark.textContent = tok;
        content.appendChild(mark);
      } else {
        content.appendChild(document.createTextNode(tok));
      }
      wrote = true;
    }
    if (!wrote) content.appendChild(document.createTextNode(" "));
    row.appendChild(marker);
    row.appendChild(content);
    outputEl.appendChild(row);
  }

  function appendChangedPair(aLine, bLine, opts) {
    var wordData = computeWordDiff(aLine, bLine, opts);
    if (wordData) {
      appendWordRow("delete", wordData, "old");
      appendWordRow("insert", wordData, "new");
    } else {
      appendPlainRow("delete", aLine);
      appendPlainRow("insert", bLine);
    }
  }

  // Walks the line-level ops, grouping consecutive delete/insert runs so that
  // "replace" hunks (equal counts on both sides) get word-level highlighting,
  // while leftover pure deletes/inserts render as plain rows. Returns stats.
  function renderDiff(ops, aLines, bLines, opts) {
    clearChildren(outputEl);
    var i = 0, added = 0, removed = 0, unchanged = 0;
    while (i < ops.length) {
      if (ops[i].type === "equal") {
        appendPlainRow("equal", aLines[ops[i].a]);
        unchanged++;
        i++;
        continue;
      }
      var dels = [], inss = [];
      while (i < ops.length && ops[i].type !== "equal") {
        if (ops[i].type === "delete") dels.push(ops[i].a);
        else inss.push(ops[i].b);
        i++;
      }
      removed += dels.length;
      added += inss.length;
      var pairN = dels.length < inss.length ? dels.length : inss.length, k;
      for (k = 0; k < pairN; k++) appendChangedPair(aLines[dels[k]], bLines[inss[k]], opts);
      for (k = pairN; k < dels.length; k++) appendPlainRow("delete", aLines[dels[k]]);
      for (k = pairN; k < inss.length; k++) appendPlainRow("insert", bLines[inss[k]]);
    }
    return { added: added, removed: removed, unchanged: unchanged };
  }

  /* ---- panel state (empty / too-large / identical / diff) ---- */
  function showPanel(which) {
    emptyEl.hidden = which !== "empty";
    errEl.hidden = which !== "error";
    noDiffEl.hidden = which !== "nodiff";
    var showResult = which === "diff" || which === "nodiff";
    statsEl.hidden = !showResult;
    outputEl.hidden = which !== "diff";
  }

  /* ---- main compute ---- */
  function compute() {
    var aText = aEl.value, bText = bEl.value;
    if (aText === "" && bText === "") {
      showPanel("empty");
      save();
      return;
    }
    if (aText.length > MAX_CHARS || bText.length > MAX_CHARS) {
      showPanel("error");
      save();
      return;
    }
    var aLines = toLines(aText), bLines = toLines(bText);
    if (aLines.length > MAX_LINES || bLines.length > MAX_LINES) {
      showPanel("error");
      save();
      return;
    }
    var opts = { ignoreCase: !!ignoreCaseEl.checked, ignoreTrailingSpace: !!ignoreTrailingEl.checked };
    var keyFn = function (line) { return normLineKey(line, opts); };
    var ops = lcsDiff(aLines, bLines, keyFn);
    var stats = renderDiff(ops, aLines, bLines, opts);
    statAddedEl.textContent = fmtNum(stats.added);
    statRemovedEl.textContent = fmtNum(stats.removed);
    statUnchangedEl.textContent = fmtNum(stats.unchanged);
    showPanel(stats.added === 0 && stats.removed === 0 ? "nodiff" : "diff");
    save();
  }

  /* ---- events ---- */
  var debounceTimer = null;
  function scheduleCompute() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { debounceTimer = null; compute(); }, 250);
  }
  function computeNow() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    compute();
  }

  aEl.addEventListener("input", scheduleCompute);
  bEl.addEventListener("input", scheduleCompute);
  ignoreCaseEl.addEventListener("change", computeNow);
  ignoreTrailingEl.addEventListener("change", computeNow);
  if (compareBtn) compareBtn.addEventListener("click", computeNow);
  if (swapBtn) swapBtn.addEventListener("click", function () {
    var tmp = aEl.value; aEl.value = bEl.value; bEl.value = tmp;
    computeNow();
  });
  if (clearBtn) clearBtn.addEventListener("click", function () {
    aEl.value = ""; bEl.value = "";
    computeNow();
    aEl.focus();
  });
  // Language switch can change how numbers are formatted (Intl.NumberFormat
  // per locale) — cheap to just recompute given the size caps above.
  document.addEventListener("i18n:change", computeNow);

  restore();
  compute();
  // TOOLJS:END
})();
