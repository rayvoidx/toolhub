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
  var MODE_KEY     = "json-formatter:mode";
  var AUTO_MAX     = 500000;   // 즉시 포맷 상한(문자). 초과 시 타이핑 지연 방지 위해 버튼 실행으로 안내
  var SCAN_MAX     = 2000000;  // 자체 오류 위치 스캐너 상한(문자)
  var DEBOUNCE_MS  = 300;

  var inputEl    = document.getElementById("jf-input");
  var outputEl   = document.getElementById("jf-output");
  var indentBox  = document.getElementById("jf-indent");
  var indentRow  = document.getElementById("jf-indent-row");
  var sortEl     = document.getElementById("jf-sort");
  var rememberEl = document.getElementById("jf-remember");
  var badgeEl    = document.getElementById("jf-badge");
  var statsEl    = document.getElementById("jf-stats");
  var messageEl  = document.getElementById("jf-message");
  var errorBox   = document.getElementById("jf-error");
  var excerptEl  = document.getElementById("jf-excerpt");
  var hintEl     = document.getElementById("jf-hint");
  var rawEl      = document.getElementById("jf-raw");
  var jumpBtn    = document.getElementById("jf-jump");
  var feedbackEl = document.getElementById("jf-feedback");
  var formatBtn  = document.getElementById("jf-format");
  var minifyBtn  = document.getElementById("jf-minify");
  var clearBtn   = document.getElementById("jf-clear");
  var copyBtn    = document.getElementById("jf-copy");
  var downloadBtn= document.getElementById("jf-download");

  var mode   = "format"; // "format" | "minify" — 즉시 출력의 형태
  var indent = "2";      // "2" | "4" | "tab"
  var lastDiag = null;   // 마지막 오류 진단 (Jump 버튼용)

  // ----- i18n 헬퍼 (없거나 키 미존재 시 키 문자열로 폴백) -----
  function t(key) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v == null ? key : v;
  }

  function fill(key, params) {
    var s = t(key);
    if (!params) return s;
    for (var k in params) {
      if (params.hasOwnProperty(k)) s = s.split("{" + k + "}").join(String(params[k]));
    }
    return s;
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
    if (indent === "tab") return "\t";
    var n = parseInt(indent, 10);
    return isNaN(n) ? 2 : n;
  }

  /** 오프셋 → 줄·열 (1-based) */
  function offsetToLineCol(text, pos) {
    if (pos > text.length) pos = text.length;
    if (pos < 0) pos = 0;
    var line = 1, lastNl = -1;
    for (var i = 0; i < pos; i++) {
      if (text.charCodeAt(i) === 10) { line++; lastNl = i; } // '\n'
    }
    return { line: line, col: pos - lastNl }; // 마지막 개행 이후 문자수(1-based)
  }

  /** 줄·열(1-based) → 오프셋 (파이어폭스 메시지 역변환용) */
  function lineColToOffset(text, line, col) {
    var pos = 0, cur = 1;
    while (cur < line && pos < text.length) {
      var nl = text.indexOf("\n", pos);
      if (nl === -1) return text.length;
      pos = nl + 1; cur++;
    }
    return Math.min(text.length, pos + Math.max(0, col - 1));
  }

  function isWsCode(c) { return c === 32 || c === 9 || c === 10 || c === 13; }

  /** pos 이후가 공백뿐인가 = 문서가 거기서 끝났는가 */
  function onlyWsAfter(text, pos) {
    for (var i = pos; i < text.length; i++) {
      if (!isWsCode(text.charCodeAt(i))) return false;
    }
    return true;
  }

  /** pos 직전의 의미 있는 문자 */
  function prevNonWs(text, pos) {
    for (var i = pos - 1; i >= 0; i--) {
      if (!isWsCode(text.charCodeAt(i))) return text.charAt(i);
    }
    return "";
  }

  /**
   * 닫히지 않은 문자열/괄호 찾기 — 문서가 도중에 끝났을 때 "진짜 원인"의 위치.
   * 파서는 문서 끝을 가리키지만, 사용자가 고쳐야 할 곳은 열어놓고 안 닫은 지점이다.
   */
  function scanUnclosed(text) {
    var stack = [], inStr = false, esc = false, strStart = -1;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; strStart = i; }
      else if (c === "{" || c === "[") stack.push({ ch: c, idx: i });
      else if (c === "}" || c === "]") stack.pop();
    }
    if (inStr) return { kind: "string", ch: '"', idx: strStart };
    if (stack.length) return { kind: "bracket", ch: stack[stack.length - 1].ch, idx: stack[stack.length - 1].idx };
    return null;
  }

  /**
   * 자체 오류 위치 스캐너 (RFC 8259 엄격) — { pos, extra } 또는 못 찾으면 null.
   * extra=true 는 "값은 끝났는데 뒤에 다른 텍스트가 더 있다" 는 뜻.
   * 브라우저가 위치를 알려주지 않을 때만 쓰는 폴백:
   *  - V8 은 짧은 입력의 "Unexpected token" 오류에 position 을 빼고 스니펫만 준다 ([1,2,] 등)
   *  - 사파리는 위치 정보를 아예 주지 않는다
   * 파서가 이미 invalid 라고 판정한 텍스트에만 호출한다 (여기서 valid 를 판정하지 않는다).
   */
  function scanFirstError(text) {
    var i = 0, n = text.length;

    function fail(pos, extra) { throw { pos: pos == null ? i : pos, extra: !!extra }; }
    function ws() { while (i < n && isWsCode(text.charCodeAt(i))) i++; }
    function isDigit(ch) { return ch >= "0" && ch <= "9"; }
    function isHex(ch) {
      return (ch >= "0" && ch <= "9") || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
    }

    function str() {
      var start = i;
      i++; // 여는 따옴표
      while (i < n) {
        var c = text.charCodeAt(i);
        if (c === 34) { i++; return; }          // "
        if (c === 92) {                          // \
          i++;
          var e = text.charAt(i);
          if (e === "u") {
            i++;
            for (var k = 0; k < 4; k++) { if (!isHex(text.charAt(i))) fail(); i++; }
          } else if (e !== "" && '"\\/bfnrt'.indexOf(e) >= 0) { i++; }
          else fail();
          continue;
        }
        if (c < 32) fail();                      // 제어문자는 이스케이프 필요
        i++;
      }
      fail(start);                               // 끝까지 안 닫힘 → 시작 위치가 원인
    }

    function num() {
      if (text.charAt(i) === "-") i++;
      if (text.charAt(i) === "0") i++;
      else if (isDigit(text.charAt(i))) { while (isDigit(text.charAt(i))) i++; }
      else fail();                               // 어긋난 문자를 가리킨다 (파서 관례와 동일)
      if (text.charAt(i) === ".") {
        i++;
        if (!isDigit(text.charAt(i))) fail();
        while (isDigit(text.charAt(i))) i++;
      }
      var e = text.charAt(i);
      if (e === "e" || e === "E") {
        i++;
        var s = text.charAt(i);
        if (s === "+" || s === "-") i++;
        if (!isDigit(text.charAt(i))) fail();
        while (isDigit(text.charAt(i))) i++;
      }
    }

    /** true/false/null 은 어긋나기 시작한 문자를 가리킨다 (tru1 → '1') */
    function lit(word) {
      for (var k = 0; k < word.length; k++) {
        if (text.charAt(i + k) !== word.charAt(k)) { i += k; fail(); }
      }
      i += word.length;
    }

    function value(depth) {
      if (depth > 500) throw { deep: true };     // 과도한 중첩은 스캐너가 판단하지 않는다
      ws();
      if (i >= n) fail(n);
      var c = text.charAt(i);
      if (c === "{") return obj(depth);
      if (c === "[") return arr(depth);
      if (c === '"') return str();
      if (c === "-" || isDigit(c)) return num();
      if (c === "t") return lit("true");
      if (c === "f") return lit("false");
      if (c === "n") return lit("null");
      fail();
    }

    function obj(depth) {
      i++; // {
      ws();
      if (text.charAt(i) === "}") { i++; return; }
      for (;;) {
        ws();
        if (text.charAt(i) !== '"') fail();      // 키는 반드시 큰따옴표
        str();
        ws();
        if (text.charAt(i) !== ":") fail();
        i++;
        value(depth + 1);
        ws();
        var c = text.charAt(i);
        if (c === ",") { i++; continue; }
        if (c === "}") { i++; return; }
        fail();
      }
    }

    function arr(depth) {
      i++; // [
      ws();
      if (text.charAt(i) === "]") { i++; return; }
      for (;;) {
        value(depth + 1);
        ws();
        var c = text.charAt(i);
        if (c === ",") { i++; continue; }
        if (c === "]") { i++; return; }
        fail();
      }
    }

    try {
      value(0);
      ws();
      if (i < n) fail(i, true);                   // 값 뒤에 잉여 텍스트
      return null;                                // 스캐너는 위반을 못 찾음 → 위치 미상으로 폴백
    } catch (e) {
      if (e && typeof e.pos === "number") {
        return { pos: Math.max(0, Math.min(e.pos, n)), extra: !!e.extra };
      }
      return null;
    }
  }

  /** 오류 지점의 문자 모양으로 "무엇이 문제인지" 사람 말로 고른다 */
  function hintAt(text, pos, msg, isExtra) {
    var at   = text.charAt(pos);
    var pch  = prevNonWs(text, pos);
    var head = text.substr(pos, 12);

    if (isExtra || /non-whitespace character after|after JSON data/i.test(msg)) {
      return { key: "tool.hintExtra" };
    }
    if (/control character/i.test(msg) || (at !== "" && at.charCodeAt(0) < 32)) {
      return { key: "tool.hintControlChar" };
    }
    if (at === "'" || pch === "'") return { key: "tool.hintSingleQuote" };
    if (at === "/" || head.indexOf("//") === 0 || head.indexOf("/*") === 0) return { key: "tool.hintComment" };
    if ((at === "}" || at === "]") && pch === ",") return { key: "tool.hintTrailingComma" };
    if (/^(True|False|None|NaN|Infinity|undefined|nil)/.test(head)) return { key: "tool.hintLiteral" };
    if (/^[A-Za-z_$]/.test(at) && (pch === "{" || pch === "," || pch === "")) return { key: "tool.hintUnquotedKey" };
    if (at !== "" && /["\-0-9tfn[{]/.test(at) && /["\d\]}eul]/.test(pch)) return { key: "tool.hintMissingComma" };
    return { key: "tool.hintGeneric" };
  }

  /**
   * 파서 오류 → { line, col, pos, message, hintKey, hintParams }
   * 위치 획득 순서: 크롬/노드 position → 파이어폭스 line·column → 자체 스캐너 → 미상.
   */
  function diagnose(err, text) {
    var msg = (err && err.message) ? String(err.message) : t("tool.unknownError");
    var pos = null, scan = null;

    var m = /position (\d+)/i.exec(msg);
    if (m) pos = parseInt(m[1], 10);
    if (pos == null) {
      var m2 = /line (\d+)[ ,]+column (\d+)/i.exec(msg);
      if (m2) pos = lineColToOffset(text, parseInt(m2[1], 10), parseInt(m2[2], 10));
    }
    if (pos == null && text.length <= SCAN_MAX) {
      scan = scanFirstError(text);
      if (scan) pos = scan.pos;
    }
    if (pos == null) return { message: msg, line: null, col: null, pos: null, hintKey: "tool.hintGeneric", hintParams: null };
    if (pos > text.length) pos = text.length;

    // 문서가 도중에 끝난 경우: 파서는 끝을 가리키지만 고칠 곳은 "안 닫은 지점"이다
    if (onlyWsAfter(text, pos)) {
      var u = (text.length <= SCAN_MAX) ? scanUnclosed(text) : null;
      if (u) {
        var ulc = offsetToLineCol(text, u.idx);
        if (u.kind === "string") {
          return { message: msg, line: ulc.line, col: ulc.col, pos: u.idx,
                   hintKey: "tool.hintUnterminatedString", hintParams: { line: ulc.line } };
        }
        return { message: msg, line: ulc.line, col: ulc.col, pos: u.idx, hintKey: "tool.hintUnclosed",
                 hintParams: { open: u.ch, close: u.ch === "{" ? "}" : "]", line: ulc.line } };
      }
      if (pos >= text.length) {
        var elc = offsetToLineCol(text, pos);
        return { message: msg, line: elc.line, col: elc.col, pos: pos, hintKey: "tool.hintEndOfInput", hintParams: null };
      }
    }

    var lc = offsetToLineCol(text, pos);
    var h = hintAt(text, pos, msg, scan && scan.extra);
    return { message: msg, line: lc.line, col: lc.col, pos: pos, hintKey: h.key, hintParams: h.params || null };
  }

  /** 오류 줄 발췌 + 캐럿(^) — 코드 문맥이라 항상 LTR·라틴 숫자 */
  function buildExcerpt(text, line, col) {
    var lines = text.split("\n");
    var src = (lines[line - 1] || "").replace(/\t/g, " ").replace(/\r$/, "");
    var from = 0, lead = "";
    if (src.length > 88 && col > 44) { from = col - 44; lead = "…"; }
    var seg = src.substr(from, 88);
    var tail = (from + 88 < src.length) ? "…" : "";
    var gutter = String(line) + " | ";
    var caretCol = lead.length + (col - 1 - from);
    if (caretCol < 0) caretCol = 0;
    var pad = new Array(gutter.length + caretCol + 1).join(" ");
    return gutter + lead + seg + tail + "\n" + pad + "^";
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

  /**
   * 숫자 표기는 화면 언어를 따른다 (Intl, 하드코딩 금지).
   * ar·ur 은 라틴 숫자로 고정 — 줄·열·바이트는 사용자가 에디터와 대조하는 "코드 좌표"라서
   * 아랍-인도 숫자로 바꾸면 오히려 대조가 어려워진다.
   */
  function numLocale() {
    var lg = (window.I18N && typeof window.I18N.lang === "function") ? window.I18N.lang() : null;
    if (!lg) return "en";
    if (lg === "ar" || lg === "ur") return lg + "-u-nu-latn";
    return lg;
  }

  function fmtNum(n) {
    try { return n.toLocaleString(numLocale()); }
    catch (e) {
      try { return n.toLocaleString(); } catch (e2) { return String(n); }
    }
  }

  /** 현재 입력을 파싱 — { state: 'empty'|'valid'|'invalid', ... } */
  function parseCurrent() {
    var raw = inputEl ? inputEl.value : "";
    if (!raw || !raw.trim()) return { state: "empty", raw: raw };
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return { state: "invalid", raw: raw, diag: diagnose(err, raw) };
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

  function invalidLabel(d) {
    if (d && d.line != null && d.col != null) {
      return t("tool.invalidAt")
        .replace("{line}", fmtNum(d.line))
        .replace("{column}", fmtNum(d.col));
    }
    return t("tool.invalid");
  }

  function hideError() {
    lastDiag = null;
    if (errorBox) errorBox.hidden = true;
  }

  /** 오류를 "빨간 실패" 가 아니라 어디를·무엇을 고치면 되는지의 안내로 보여준다 */
  function showError(raw, d) {
    lastDiag = d;
    if (!errorBox) return;
    errorBox.hidden = false;
    if (excerptEl) {
      var ex = (d.line != null && raw.length <= SCAN_MAX) ? buildExcerpt(raw, d.line, d.col) : "";
      excerptEl.textContent = ex;
      excerptEl.hidden = !ex;
    }
    if (hintEl) hintEl.textContent = fill(d.hintKey, d.hintParams);
    if (rawEl) rawEl.textContent = t("tool.parserSays") + " " + d.message;
    if (jumpBtn) jumpBtn.hidden = (d.line == null);
  }

  /**
   * 입력 → 상태·안내·출력을 한 번에 갱신 (즉시 포맷).
   * explicit=true 는 사용자가 버튼을 누른 경우 — 토스트·오류 줄 선택까지 한다.
   */
  function run(explicit) {
    var r = parseCurrent();

    if (r.state === "empty") {
      setBadge("neutral", t("tool.badgeNeutral"));
      if (statsEl) statsEl.textContent = "";
      if (messageEl) messageEl.textContent = t("tool.emptyHint");
      hideError();
      if (outputEl) outputEl.value = "";
      if (explicit) showFeedback(t("tool.emptyFormat"), true);
      return r;
    }

    if (r.state === "invalid") {
      setBadge("invalid", t("tool.badgeInvalid"));
      if (statsEl) statsEl.textContent = "";
      if (messageEl) messageEl.textContent = invalidLabel(r.diag);
      showError(r.raw, r.diag);
      // 출력은 마지막 유효 결과를 남겨둔다 — 한 글자 지웠다고 결과가 사라지지 않게
      if (explicit) {
        highlightErrorLine(r.diag, r.raw);
        showFeedback(invalidLabel(r.diag), true);
      }
      return r;
    }

    // valid
    setBadge("valid", t("tool.badgeValid"));
    hideError();
    var a = analyze(r.parsed);
    var bytes = byteLen(r.raw);
    if (statsEl) {
      statsEl.textContent =
        fmtNum(a.keys) + " " + t("tool.statKeys") + "  ·  " +
        fmtNum(a.depth) + " " + t("tool.statDepth") + "  ·  " +
        fmtNum(bytes) + " " + t("tool.statBytes");
    }

    // 대용량: 타이핑마다 직렬화하면 느려진다 → 버튼으로 실행하도록 명시 안내 (조용히 넘기지 않는다)
    if (!explicit && r.raw.length > AUTO_MAX) {
      if (messageEl) messageEl.textContent = t("tool.large");
      return r;
    }

    var out = serialize(r.parsed);
    if (out == null) {
      if (messageEl) messageEl.textContent = t("tool.stringifyError");
      if (explicit) showFeedback(t("tool.stringifyError"), true);
      return r;
    }
    if (outputEl) outputEl.value = out;
    if (messageEl) {
      if (mode === "minify") {
        var outBytes = byteLen(out);
        var pct = (bytes > 0) ? Math.max(0, Math.round((1 - outBytes / bytes) * 100)) : 0;
        messageEl.textContent = fill("tool.minifiedInfo", {
          from: fmtNum(bytes), to: fmtNum(outBytes), percent: fmtNum(pct)
        });
      } else {
        messageEl.textContent = t("tool.validHint");
      }
    }
    if (explicit) showFeedback(mode === "minify" ? t("tool.minified") : t("tool.formatted"), false);
    return r;
  }

  /** 현재 모드·옵션으로 직렬화. 실패 시 null */
  function serialize(parsed) {
    var value = (sortEl && sortEl.checked) ? sortValue(parsed) : parsed;
    try {
      return (mode === "minify") ? JSON.stringify(value) : JSON.stringify(value, null, currentIndent());
    } catch (e) {
      return null;
    }
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

  // ----- 모드·들여쓰기 토글 (선택형 — 자유 입력 없음) -----

  function paint(btn, on) {
    if (!btn) return;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.style.background = on ? "var(--accent)" : "transparent";
    btn.style.color = on ? "#fff" : "var(--muted)";
    btn.style.fontWeight = on ? "700" : "500";
  }

  function indentButtons() {
    return indentBox ? indentBox.querySelectorAll("[data-indent]") : [];
  }

  function paintToggles() {
    paint(formatBtn, mode === "format");
    paint(minifyBtn, mode === "minify");
    var btns = indentButtons();
    for (var i = 0; i < btns.length; i++) paint(btns[i], btns[i].getAttribute("data-indent") === indent);
    // 압축 모드에서 들여쓰기는 의미가 없다 → 감춘다 (인지부하 최소화)
    if (indentRow) indentRow.style.display = (mode === "minify") ? "none" : "flex";
  }

  function setMode(next, explicit) {
    mode = (next === "minify") ? "minify" : "format";
    paintToggles();
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* private mode */ }
    run(explicit);
  }

  function setIndent(next) {
    indent = (next === "4" || next === "tab") ? next : "2";
    paintToggles();
    savePrefs();
    run(false);
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

  /** 복사 버튼 자체를 "복사됨" 으로 잠깐 바꿔 준다 (1탭 + 눈에 보이는 피드백) */
  var copyTimer = null;
  function markCopied() {
    showFeedback(t("tool.copied"), false);
    if (!copyBtn) return;
    copyBtn.textContent = t("tool.copiedShort");
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(function () { copyBtn.textContent = t("tool.copy"); }, 1600);
  }

  function copyOutput() {
    var value = outputEl ? outputEl.value : "";
    if (!value) { showFeedback(t("tool.emptyCopy"), true); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(
        function () { markCopied(); },
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
      if (ok) markCopied();
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
      localStorage.setItem(INDENT_KEY, indent);
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
      if (ind === "2" || ind === "4" || ind === "tab") indent = ind;
      var md = localStorage.getItem(MODE_KEY);
      if (md === "format" || md === "minify") mode = md;
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

  // ----- 즉시 실행 (디바운스) -----

  var debTimer = null;
  function schedule() {
    if (debTimer) clearTimeout(debTimer);
    debTimer = setTimeout(function () { run(false); saveInput(); }, DEBOUNCE_MS);
  }

  // ----- 이벤트 배선 -----

  if (inputEl) inputEl.addEventListener("input", schedule);
  if (formatBtn) formatBtn.addEventListener("click", function () { setMode("format", true); });
  if (minifyBtn) minifyBtn.addEventListener("click", function () { setMode("minify", true); });
  if (copyBtn) copyBtn.addEventListener("click", copyOutput);
  if (downloadBtn) downloadBtn.addEventListener("click", downloadOutput);
  if (jumpBtn) jumpBtn.addEventListener("click", function () {
    if (lastDiag && inputEl) highlightErrorLine(lastDiag, inputEl.value);
  });

  var indentBtns = indentButtons();
  for (var b = 0; b < indentBtns.length; b++) {
    (function (btn) {
      btn.addEventListener("click", function () { setIndent(btn.getAttribute("data-indent")); });
    })(indentBtns[b]);
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      if (inputEl) { inputEl.value = ""; inputEl.focus(); }
      if (outputEl) outputEl.value = "";
      run(false);
      try { if (shouldRemember()) localStorage.removeItem(LAST_KEY); } catch (e) { /* noop */ }
    });
  }

  if (sortEl) sortEl.addEventListener("change", function () {
    savePrefs();
    run(false);
  });

  if (rememberEl) {
    rememberEl.addEventListener("change", function () {
      try { localStorage.setItem(REMEMBER_KEY, rememberEl.checked ? "1" : "0"); } catch (e) { /* noop */ }
      if (rememberEl.checked) saveInput();
      else { try { localStorage.removeItem(LAST_KEY); } catch (e) { /* noop */ } }
    });
  }

  // 언어 전환 시 배지·안내·통계 재렌더 (출력 JSON 은 언어 무관 — 값은 그대로다)
  document.addEventListener("i18n:change", function () {
    if (copyBtn && copyTimer) { clearTimeout(copyTimer); copyTimer = null; }
    run(false);
  });

  // 초기화 — 복원된 입력이 있으면 즉시 결과까지
  loadPrefs();
  paintToggles();
  run(false);
  // 빈 화면에서는 붙여넣기가 바로 되도록 포커스 (모바일 키패드가 튀지 않게 넓은 화면에서만)
  try {
    if (inputEl && !inputEl.value && window.matchMedia && window.matchMedia("(min-width: 720px)").matches) {
      inputEl.focus({ preventScroll: true });
    }
  } catch (e) { /* 포커스 실패는 무시 */ }
  // TOOLJS:END
})();
