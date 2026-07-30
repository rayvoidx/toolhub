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
  /* SQL Formatter — 키워드 기반 줄바꿈/들여쓰기로 SQL 을 정렬하거나 압축(minify)한다.
     문자열('...')·따옴표 식별자("..."/`...`/[...]) ·주석(--, /* *\/)을 인식하는 토크나이저를
     직접 구현해 그 안의 내용은 절대 건드리지 않는다. 모든 계산은 브라우저 로컬, 외부 API 없음.
     Honest scope: 포매터일 뿐 모든 방언(dialect)의 문법을 검증하는 파서가 아니다. */

  /* ---- 토크나이저 ---- */
  function tokenize(sql) {
    var tokens = [];
    var i = 0, n = sql.length;
    var unterminated = false;
    function isWordStart(c) { return /[A-Za-z_]/.test(c); }
    function isWordChar(c) { return /[A-Za-z0-9_$]/.test(c); }
    while (i < n) {
      var c = sql.charAt(i);
      if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
      if (c === "-" && sql.charAt(i + 1) === "-") {
        var j = sql.indexOf("\n", i);
        var text = j === -1 ? sql.slice(i) : sql.slice(i, j);
        tokens.push({ type: "linecomment", text: text });
        i = j === -1 ? n : j;
        continue;
      }
      if (c === "/" && sql.charAt(i + 1) === "*") {
        var end = sql.indexOf("*/", i + 2);
        var text2 = end === -1 ? sql.slice(i) : sql.slice(i, end + 2);
        if (end === -1) unterminated = true;
        tokens.push({ type: "blockcomment", text: text2 });
        i = end === -1 ? n : end + 2;
        continue;
      }
      if (c === "'") {
        var start = i; i++; var closed = false;
        while (i < n) {
          if (sql.charAt(i) === "'") {
            if (sql.charAt(i + 1) === "'") { i += 2; continue; }
            i++; closed = true; break;
          }
          i++;
        }
        if (!closed) unterminated = true;
        tokens.push({ type: "string", text: sql.slice(start, i) });
        continue;
      }
      if (c === '"' || c === "`") {
        var q = c, start2 = i; i++; var closed2 = false;
        while (i < n) {
          if (sql.charAt(i) === q) {
            if (sql.charAt(i + 1) === q) { i += 2; continue; }
            i++; closed2 = true; break;
          }
          i++;
        }
        if (!closed2) unterminated = true;
        tokens.push({ type: "ident", text: sql.slice(start2, i) });
        continue;
      }
      if (c === "[") {
        var start3 = i; i++;
        while (i < n && sql.charAt(i) !== "]") i++;
        var closed3 = sql.charAt(i) === "]";
        if (closed3) i++; else unterminated = true;
        tokens.push({ type: "ident", text: sql.slice(start3, i) });
        continue;
      }
      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(sql.charAt(i + 1) || ""))) {
        var start4 = i;
        while (i < n && /[0-9]/.test(sql.charAt(i))) i++;
        if (sql.charAt(i) === ".") { i++; while (i < n && /[0-9]/.test(sql.charAt(i))) i++; }
        if (sql.charAt(i) === "e" || sql.charAt(i) === "E") {
          var save = i; i++;
          if (sql.charAt(i) === "+" || sql.charAt(i) === "-") i++;
          if (/[0-9]/.test(sql.charAt(i))) { while (i < n && /[0-9]/.test(sql.charAt(i))) i++; }
          else i = save;
        }
        tokens.push({ type: "number", text: sql.slice(start4, i) });
        continue;
      }
      if (isWordStart(c)) {
        var start5 = i;
        while (i < n && isWordChar(sql.charAt(i))) i++;
        tokens.push({ type: "word", text: sql.slice(start5, i) });
        continue;
      }
      var two = sql.substr(i, 2);
      if (two === "<=" || two === ">=" || two === "<>" || two === "!=" || two === "||" || two === "::") {
        tokens.push({ type: "op", text: two }); i += 2; continue;
      }
      tokens.push({ type: "punct", text: c }); i++;
    }
    return { tokens: tokens, unterminated: unterminated };
  }

  /* ---- 복수 단어 키워드 병합 (예: GROUP BY, LEFT OUTER JOIN) — 긴 것부터 매칭 ---- */
  var MULTI_WORD = [
    ["LEFT", "OUTER", "JOIN"], ["RIGHT", "OUTER", "JOIN"], ["FULL", "OUTER", "JOIN"],
    ["GROUP", "BY"], ["ORDER", "BY"], ["UNION", "ALL"], ["INSERT", "INTO"], ["DELETE", "FROM"],
    ["LEFT", "JOIN"], ["RIGHT", "JOIN"], ["FULL", "JOIN"], ["INNER", "JOIN"], ["CROSS", "JOIN"],
    ["IS", "NOT"], ["NOT", "IN"], ["NOT", "LIKE"], ["NOT", "BETWEEN"], ["NOT", "EXISTS"],
    ["PRIMARY", "KEY"], ["FOREIGN", "KEY"], ["CREATE", "TABLE"], ["CREATE", "INDEX"],
    ["CREATE", "VIEW"], ["DROP", "TABLE"], ["ALTER", "TABLE"], ["REPLACE", "INTO"]
  ];
  MULTI_WORD.sort(function (a, b) { return b.length - a.length; });

  var KEYWORD_LIST = [
    "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "IS", "NULL", "LIKE", "ILIKE",
    "BETWEEN", "EXISTS", "AS", "ON", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "OUTER",
    "CROSS", "GROUP", "BY", "ORDER", "HAVING", "LIMIT", "OFFSET", "UNION", "ALL",
    "INTERSECT", "EXCEPT", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE",
    "CREATE", "TABLE", "DROP", "ALTER", "ADD", "COLUMN", "PRIMARY", "KEY", "FOREIGN",
    "REFERENCES", "DEFAULT", "DISTINCT", "CASE", "WHEN", "THEN", "ELSE", "END", "ASC",
    "DESC", "WITH", "RETURNING", "CAST", "TRUE", "FALSE", "INDEX", "VIEW", "REPLACE",
    "USING", "OVER", "PARTITION", "WINDOW", "ROWS", "RANGE", "UNBOUNDED", "PRECEDING",
    "FOLLOWING", "CURRENT", "ROW", "FETCH", "NEXT", "ONLY", "TOP", "INTERVAL", "FOR",
    "LATERAL", "UNIQUE", "CHECK", "CONSTRAINT", "IF", "BEGIN", "COMMIT", "ROLLBACK",
    "TRANSACTION", "GRANT", "REVOKE"
  ];
  var KEYWORDS = {};
  for (var kwi = 0; kwi < KEYWORD_LIST.length; kwi++) KEYWORDS[KEYWORD_LIST[kwi]] = true;

  function mergeKeywords(tokens) {
    var out = [];
    var i = 0;
    while (i < tokens.length) {
      var tok = tokens[i];
      if (tok.type === "word") {
        var matched = null;
        for (var m = 0; m < MULTI_WORD.length; m++) {
          var phrase = MULTI_WORD[m];
          if (i + phrase.length > tokens.length) continue;
          var ok = true;
          for (var k = 0; k < phrase.length; k++) {
            var t2 = tokens[i + k];
            if (!t2 || t2.type !== "word" || t2.text.toUpperCase() !== phrase[k]) { ok = false; break; }
          }
          if (ok) { matched = phrase; break; }
        }
        if (matched) {
          var parts = [];
          for (var p = 0; p < matched.length; p++) parts.push(tokens[i + p].text);
          out.push({ type: "keyword", text: parts.join(" ") });
          i += matched.length;
          continue;
        }
        if (KEYWORDS[tok.text.toUpperCase()]) {
          out.push({ type: "keyword", text: tok.text });
          i++;
          continue;
        }
      }
      out.push(tok);
      i++;
    }
    return out;
  }

  var BREAK_KEYWORDS = {};
  [
    "SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET",
    "VALUES", "SET", "RETURNING", "WITH", "INSERT INTO", "UPDATE", "DELETE FROM",
    "CREATE TABLE", "DROP TABLE", "ALTER TABLE", "CREATE INDEX", "CREATE VIEW",
    "REPLACE INTO", "UNION", "UNION ALL", "INTERSECT", "EXCEPT", "JOIN", "INNER JOIN",
    "LEFT JOIN", "LEFT OUTER JOIN", "RIGHT JOIN", "RIGHT OUTER JOIN", "FULL JOIN",
    "FULL OUTER JOIN", "CROSS JOIN"
  ].forEach(function (k) { BREAK_KEYWORDS[k] = true; });

  var COMMA_BREAK_CONTEXTS = { "SELECT": 1, "GROUP BY": 1, "ORDER BY": 1, "VALUES": 1, "SET": 1 };

  var FUNCTION_NAMES = {};
  [
    "COUNT", "SUM", "AVG", "MIN", "MAX", "NOW", "COALESCE", "CAST", "CONCAT", "CONCAT_WS",
    "UPPER", "LOWER", "LENGTH", "LEN", "ROUND", "FLOOR", "CEIL", "CEILING", "ABS",
    "SUBSTRING", "SUBSTR", "REPLACE", "TRIM", "LTRIM", "RTRIM", "NULLIF", "IFNULL",
    "ISNULL", "EXTRACT", "DATEDIFF", "DATEADD", "DATE_ADD", "DATE_SUB", "DATE_FORMAT",
    "STR_TO_DATE", "GREATEST", "LEAST", "ROW_NUMBER", "RANK", "DENSE_RANK", "NTILE",
    "LAG", "LEAD", "FIRST_VALUE", "LAST_VALUE", "ARRAY_AGG", "STRING_AGG", "GROUP_CONCAT",
    "JSON_EXTRACT", "TO_CHAR", "TO_DATE", "TO_NUMBER", "CURDATE", "CURTIME", "GETDATE",
    "SYSDATE", "RAND", "RANDOM", "POWER", "SQRT", "MOD", "EXP", "LOG", "LOG10", "SIGN",
    "TRUNC", "TRUNCATE", "REGEXP_REPLACE", "SPLIT_PART", "IF", "IIF",
    // 괄호를 취하는 데이터 타입(CREATE TABLE 열 정의) — 함수처럼 공백 없이 붙인다
    "VARCHAR", "NVARCHAR", "CHAR", "NCHAR", "CHARACTER", "DECIMAL", "NUMERIC", "FLOAT",
    "VARBINARY", "BINARY", "ENUM", "BIT"
  ].forEach(function (f) { FUNCTION_NAMES[f] = true; });

  function repeatStr(s, cnt) { var r = ""; for (var i = 0; i < cnt; i++) r += s; return r; }
  function indentUnitFor(indent) {
    if (indent === "4") return "    ";
    if (indent === "tab") return "\t";
    return "  ";
  }
  function applyCase(word, mode) {
    if (mode === "upper") return word.toUpperCase();
    if (mode === "lower") return word.toLowerCase();
    return word;
  }
  function spaceBefore(tok, prev) {
    if (!prev) return false;
    var t = tok.text, p = prev.text;
    if (t === "," || t === ";" || t === ")") return false;
    if (t === ".") return false;
    if (p === "(" || p === ".") return false;
    if (t === "(" && prev.type === "word" && FUNCTION_NAMES[p.toUpperCase()]) return false;
    return true;
  }

  /* ---- 포매터 본체: 키워드 기준 줄바꿈 + 들여쓰기 ---- */
  function formatTokens(tokens, opts) {
    var indentUnit = indentUnitFor(opts.indent);
    var caseMode = opts.caseMode || "upper";
    var lines = [];
    var cur = "";
    var indentLevel = 0;
    var context = null;
    var clauseParenDepth = 0;
    var parenDepth = 0;
    var scopeParenDepth = 0; // 서브쿼리 진입 시에만 바뀐다 — 함수 호출·괄호식 안에서는 그대로
    var parenStack = [];
    var prevTok = null;
    var pendingBetween = false;
    var caseStack = [];
    var curLineIndent = 0;
    var afterSemicolon = false;
    var warnUnbalanced = false;

    function flushLine() { lines.push(cur.replace(/[ \t]+$/, "")); cur = ""; }
    function startNewLine(level) {
      level = Math.max(0, level);
      if (cur.length || lines.length === 0) flushLine();
      cur = repeatStr(indentUnit, level);
      prevTok = null;
      curLineIndent = level;
    }
    function blankLine() { if (cur.length) flushLine(); lines.push(""); }
    function append(tok) {
      var text = tok.text;
      if (cur === "") cur += text;
      else cur += (spaceBefore(tok, prevTok) ? " " : "") + text;
      prevTok = tok;
    }

    for (var idx = 0; idx < tokens.length; idx++) {
      var tok = tokens[idx];

      if (tok.type === "linecomment") {
        startNewLine(indentLevel);
        cur += tok.text;
        prevTok = null;
        continue;
      }
      if (tok.type === "blockcomment") {
        startNewLine(indentLevel);
        cur += tok.text;
        flushLine();
        cur = repeatStr(indentUnit, indentLevel);
        prevTok = null;
        continue;
      }

      if (tok.type === "keyword") {
        var kw = tok.text.toUpperCase();
        var displayTok = { type: "keyword", text: applyCase(tok.text, caseMode) };

        if (BREAK_KEYWORDS[kw]) {
          // 서브쿼리가 아닌 괄호 안(예: OVER (PARTITION BY ... ORDER BY ...))이면 절 키워드로
          // 보지 않고 인라인으로 붙인다 — 윈도우 함수가 한 줄에 자연스럽게 남는다.
          if (parenDepth !== scopeParenDepth) { append(displayTok); continue; }
          if (afterSemicolon) { blankLine(); afterSemicolon = false; }
          startNewLine(indentLevel);
          append(displayTok);
          context = COMMA_BREAK_CONTEXTS[kw] ? kw : null;
          clauseParenDepth = parenDepth;
          pendingBetween = false;
          continue;
        }
        if (kw === "ON") {
          if (parenDepth !== scopeParenDepth) { append(displayTok); continue; }
          startNewLine(indentLevel + 1);
          append(displayTok);
          context = null;
          clauseParenDepth = parenDepth;
          pendingBetween = false;
          continue;
        }
        if (kw === "AND" || kw === "OR") {
          if (kw === "AND" && pendingBetween) { pendingBetween = false; append(displayTok); continue; }
          if (parenDepth === clauseParenDepth) startNewLine(indentLevel + 1);
          append(displayTok);
          continue;
        }
        if (kw === "BETWEEN") { pendingBetween = true; append(displayTok); continue; }
        if (kw === "CASE") { append(displayTok); caseStack.push(curLineIndent); continue; }
        if (kw === "WHEN" || kw === "ELSE") {
          var caseBase1 = caseStack.length ? caseStack[caseStack.length - 1] : indentLevel;
          startNewLine(caseBase1 + 1);
          append(displayTok);
          continue;
        }
        if (kw === "END") {
          var caseBase2 = caseStack.length ? caseStack.pop() : indentLevel;
          startNewLine(caseBase2);
          append(displayTok);
          continue;
        }
        // 일반 키워드 (DISTINCT·AS·ASC·DESC·IN·IS·NULL 등) — 줄은 안 바꾸고 자리에 붙인다
        append(displayTok);
        continue;
      }

      if (tok.type === "punct" && tok.text === "(") {
        var next = null;
        for (var la = idx + 1; la < tokens.length; la++) {
          if (tokens[la].type === "linecomment" || tokens[la].type === "blockcomment") continue;
          next = tokens[la]; break;
        }
        var isSub = next && next.type === "keyword" &&
          (next.text.toUpperCase() === "SELECT" || next.text.toUpperCase() === "WITH");
        append(tok);
        parenDepth++;
        if (isSub) {
          parenStack.push({
            subquery: true, context: context, clauseParenDepth: clauseParenDepth,
            indentLevel: indentLevel, scopeParenDepth: scopeParenDepth
          });
          indentLevel++;
          context = null;
          clauseParenDepth = parenDepth;
          scopeParenDepth = parenDepth;
          // 다음 토큰(SELECT/WITH)이 스스로 줄바꿈하므로 여기서 미리 넣지 않는다
          // (미리 넣으면 들여쓰기 공백만 있는 빈 줄이 하나 더 생긴다)
        } else {
          parenStack.push({ subquery: false });
        }
        continue;
      }
      if (tok.type === "punct" && tok.text === ")") {
        var entry = parenStack.length ? parenStack.pop() : null;
        parenDepth = Math.max(0, parenDepth - 1);
        if (entry && entry.subquery) {
          indentLevel = entry.indentLevel;
          startNewLine(indentLevel);
          append(tok);
          context = entry.context;
          clauseParenDepth = entry.clauseParenDepth;
          scopeParenDepth = entry.scopeParenDepth;
        } else if (entry) {
          append(tok);
        } else {
          warnUnbalanced = true;
          append(tok);
        }
        continue;
      }
      if (tok.type === "punct" && tok.text === ",") {
        append(tok);
        if (context && COMMA_BREAK_CONTEXTS[context] && parenDepth === clauseParenDepth) {
          startNewLine(indentLevel + 1);
        }
        continue;
      }
      if (tok.type === "punct" && tok.text === ";") {
        append(tok);
        afterSemicolon = true;
        context = null;
        continue;
      }

      append(tok);
    }
    if (parenStack.length) warnUnbalanced = true;
    flushLine();
    while (lines.length && lines[0] === "") lines.shift();
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    return { text: lines.join("\n"), warnUnbalanced: warnUnbalanced, lineCount: lines.length };
  }

  /* ---- 압축(minify): 주석 제거 + 한 줄, 필요한 공백만 남긴다 ---- */
  function minifyTokens(tokens, opts) {
    var caseMode = opts.caseMode || "upper";
    var out = "";
    var prevTok = null;
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      if (tok.type === "linecomment" || tok.type === "blockcomment") continue;
      var displayTok = tok;
      if (tok.type === "keyword") displayTok = { type: "keyword", text: applyCase(tok.text, caseMode) };
      if (out === "") out += displayTok.text;
      else out += (spaceBefore(displayTok, prevTok) ? " " : "") + displayTok.text;
      prevTok = displayTok;
    }
    return out;
  }

  function countStatements(tokens) {
    var n = 0, any = false;
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "linecomment" && tokens[i].type !== "blockcomment") any = true;
      if (tokens[i].type === "punct" && tokens[i].text === ";") n++;
    }
    if (any) {
      var lastIsSemi = false;
      for (var j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].type === "linecomment" || tokens[j].type === "blockcomment") continue;
        lastIsSemi = tokens[j].type === "punct" && tokens[j].text === ";";
        break;
      }
      if (!lastIsSemi) n++;
    }
    return n;
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      tokenize: tokenize, mergeKeywords: mergeKeywords, formatTokens: formatTokens,
      minifyTokens: minifyTokens, countStatements: countStatements
    };
    return;
  }

  /* ---- DOM 배선 ---- */
  var LAST_KEY     = "sql-formatter:last";
  var INDENT_KEY   = "sql-formatter:indent";
  var CASE_KEY     = "sql-formatter:case";
  var REMEMBER_KEY = "sql-formatter:remember";
  var MODE_KEY     = "sql-formatter:mode";
  var SCAN_MAX     = 2000000; // 이 길이를 넘으면 성능을 위해 즉시 실행 대신 버튼 실행으로 안내
  var DEBOUNCE_MS  = 300;

  var inputEl    = document.getElementById("sf-input");
  var outputEl   = document.getElementById("sf-output");
  var indentBox  = document.getElementById("sf-indent");
  var indentRow  = document.getElementById("sf-indent-row");
  var caseBox    = document.getElementById("sf-case");
  var rememberEl = document.getElementById("sf-remember");
  var badgeEl    = document.getElementById("sf-badge");
  var statsEl    = document.getElementById("sf-stats");
  var messageEl  = document.getElementById("sf-message");
  var warningEl  = document.getElementById("sf-warning");
  var feedbackEl = document.getElementById("sf-feedback");
  var formatBtn  = document.getElementById("sf-format");
  var minifyBtn  = document.getElementById("sf-minify");
  var clearBtn   = document.getElementById("sf-clear");
  var copyBtn    = document.getElementById("sf-copy");
  var downloadBtn= document.getElementById("sf-download");

  if (!inputEl || !outputEl) return;

  var mode = "format";   // "format" | "minify"
  var indent = "2";      // "2" | "4" | "tab"
  var caseMode = "upper";// "upper" | "lower" | "unchanged"

  function t(key) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v == null ? key : v;
  }
  function fill(key, params) {
    var s = t(key);
    if (!params) return s;
    for (var k in params) { if (params.hasOwnProperty(k)) s = s.split("{" + k + "}").join(String(params[k])); }
    return s;
  }
  function numLocale() {
    var lg = (window.I18N && typeof window.I18N.lang === "function") ? window.I18N.lang() : null;
    if (!lg) return "en";
    if (lg === "ar" || lg === "ur") return lg + "-u-nu-latn";
    return lg;
  }
  function fmtNum(n) {
    try { return n.toLocaleString(numLocale()); } catch (e) { try { return n.toLocaleString(); } catch (e2) { return String(n); } }
  }

  function setBadge(kind, text) {
    if (!badgeEl) return;
    badgeEl.textContent = text;
    if (kind === "ok") {
      badgeEl.style.color = "#fff"; badgeEl.style.background = "var(--accent)"; badgeEl.style.borderColor = "var(--accent)";
    } else if (kind === "warn") {
      badgeEl.style.color = "#fff"; badgeEl.style.background = "#b45309"; badgeEl.style.borderColor = "#b45309";
    } else {
      badgeEl.style.color = "var(--muted)"; badgeEl.style.background = "var(--bg)"; badgeEl.style.borderColor = "var(--line)";
    }
  }

  function paint(btn, on) {
    if (!btn) return;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.style.background = on ? "var(--accent)" : "transparent";
    btn.style.color = on ? "#fff" : "var(--muted)";
    btn.style.fontWeight = on ? "700" : "500";
  }
  function indentButtons() { return indentBox ? indentBox.querySelectorAll("[data-indent]") : []; }
  function caseButtons() { return caseBox ? caseBox.querySelectorAll("[data-case]") : []; }
  function paintToggles() {
    paint(formatBtn, mode === "format");
    paint(minifyBtn, mode === "minify");
    var ib = indentButtons();
    for (var i = 0; i < ib.length; i++) paint(ib[i], ib[i].getAttribute("data-indent") === indent);
    var cb = caseButtons();
    for (var j = 0; j < cb.length; j++) paint(cb[j], cb[j].getAttribute("data-case") === caseMode);
    // 압축 모드에서 들여쓰기는 의미가 없다 → 감춘다
    if (indentRow) indentRow.style.display = (mode === "minify") ? "none" : "flex";
  }

  var feedbackTimer = null;
  function showFeedback(msg, isError) {
    if (!feedbackEl) return;
    feedbackEl.hidden = false;
    feedbackEl.textContent = msg;
    feedbackEl.style.color = isError ? "#dc2626" : "var(--accent)";
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(function () { feedbackEl.hidden = true; }, 2400);
  }

  function byteLen(str) {
    try { if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str).length; }
    catch (e) { /* fallthrough */ }
    return unescape(encodeURIComponent(str)).length;
  }

  /** 현재 입력을 토큰화하고 모드에 맞게 실행. explicit=true 는 버튼 클릭(대용량 안내 우회) */
  function run(explicit) {
    var raw = inputEl.value;
    if (!raw || !raw.trim()) {
      setBadge("neutral", t("tool.badgeEmpty"));
      if (statsEl) statsEl.textContent = "";
      if (messageEl) messageEl.textContent = t("tool.emptyHint");
      if (warningEl) warningEl.hidden = true;
      outputEl.value = "";
      if (explicit) showFeedback(t("tool.emptyFormat"), true);
      return;
    }
    if (!explicit && raw.length > SCAN_MAX) {
      if (messageEl) messageEl.textContent = t("tool.large");
      return;
    }

    var tk = tokenize(raw);
    var merged = mergeKeywords(tk.tokens);
    var opts = { indent: indent, caseMode: caseMode };
    var warn = tk.unterminated;
    var out, statsText;

    if (mode === "minify") {
      var minified = minifyTokens(merged, opts);
      outputEl.value = minified;
      var fromLen = byteLen(raw), toLen = byteLen(minified);
      var pct = fromLen > 0 ? Math.max(0, Math.round((1 - toLen / fromLen) * 100)) : 0;
      statsText = fill("tool.minifiedInfo", { from: fmtNum(fromLen), to: fmtNum(toLen), percent: fmtNum(pct) });
    } else {
      var res = formatTokens(merged, opts);
      out = res.text;
      outputEl.value = out;
      warn = warn || res.warnUnbalanced;
      var stCount = countStatements(merged);
      statsText = fmtNum(stCount) + " " + t("tool.statStatements") + "  ·  " +
        fmtNum(res.lineCount) + " " + t("tool.statLines");
    }

    setBadge(warn ? "warn" : "ok", warn ? t("tool.badgeWarn") : t("tool.badgeOk"));
    if (statsEl) statsEl.textContent = statsText;
    if (messageEl) messageEl.textContent = mode === "minify" ? t("tool.minifiedHint") : t("tool.formattedHint");
    if (warningEl) {
      if (warn) {
        var msgs = [];
        if (tk.unterminated) msgs.push(t("tool.warnUnterminated"));
        if (mode === "format" && (warn && !tk.unterminated)) msgs.push(t("tool.warnUnbalanced"));
        warningEl.textContent = msgs.join(" ");
        warningEl.hidden = false;
      } else {
        warningEl.hidden = true;
      }
    }
    if (explicit) showFeedback(mode === "minify" ? t("tool.minified") : t("tool.formatted"), false);
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
  function setCaseMode(next) {
    caseMode = (next === "lower" || next === "unchanged") ? next : "upper";
    paintToggles();
    savePrefs();
    run(false);
  }

  function shouldRemember() { return !rememberEl || rememberEl.checked; }
  function saveInput() {
    if (!shouldRemember()) return;
    try { localStorage.setItem(LAST_KEY, inputEl.value); } catch (e) { /* private mode */ }
  }
  function savePrefs() {
    try {
      localStorage.setItem(INDENT_KEY, indent);
      localStorage.setItem(CASE_KEY, caseMode);
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
      var cs = localStorage.getItem(CASE_KEY);
      if (cs === "upper" || cs === "lower" || cs === "unchanged") caseMode = cs;
    } catch (e) { /* noop */ }
    if (shouldRemember()) {
      try {
        var last = localStorage.getItem(LAST_KEY);
        if (typeof last === "string" && last.length > 0) inputEl.value = last;
      } catch (e) { /* 손상 값 무시 */ }
    }
  }

  /* ---- 피드백 / 복사 / 다운로드 ---- */
  var copyTimer = null;
  function markCopied() {
    showFeedback(t("tool.copied"), false);
    if (!copyBtn) return;
    copyBtn.textContent = t("tool.copiedShort");
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(function () { copyBtn.textContent = t("tool.copy"); }, 1600);
  }
  function fallbackCopy(value) {
    try {
      outputEl.focus(); outputEl.select();
      var ok = document.execCommand && document.execCommand("copy");
      if (ok) markCopied(); else showFeedback(t("tool.copyError"), true);
    } catch (e) { showFeedback(t("tool.copyError"), true); }
  }
  function copyOutput() {
    var value = outputEl.value;
    if (!value) { showFeedback(t("tool.emptyCopy"), true); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(function () { markCopied(); }, function () { fallbackCopy(value); });
    } else {
      fallbackCopy(value);
    }
  }
  function downloadOutput() {
    var value = outputEl.value;
    if (!value) { showFeedback(t("tool.emptyCopy"), true); return; }
    try {
      var blob = new Blob([value], { type: "text/plain" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = "formatted.sql";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      showFeedback(t("tool.downloaded"), false);
    } catch (e) { showFeedback(t("tool.copyError"), true); }
  }

  /* ---- 즉시 실행 (디바운스) ---- */
  var debTimer = null;
  function schedule() {
    if (debTimer) clearTimeout(debTimer);
    debTimer = setTimeout(function () { run(false); saveInput(); }, DEBOUNCE_MS);
  }

  /* ---- 이벤트 배선 ---- */
  inputEl.addEventListener("input", schedule);
  if (formatBtn) formatBtn.addEventListener("click", function () { setMode("format", true); });
  if (minifyBtn) minifyBtn.addEventListener("click", function () { setMode("minify", true); });
  if (copyBtn) copyBtn.addEventListener("click", copyOutput);
  if (downloadBtn) downloadBtn.addEventListener("click", downloadOutput);

  var indentBtns = indentButtons();
  for (var bi = 0; bi < indentBtns.length; bi++) {
    (function (btn) { btn.addEventListener("click", function () { setIndent(btn.getAttribute("data-indent")); }); })(indentBtns[bi]);
  }
  var caseBtns = caseButtons();
  for (var bc = 0; bc < caseBtns.length; bc++) {
    (function (btn) { btn.addEventListener("click", function () { setCaseMode(btn.getAttribute("data-case")); }); })(caseBtns[bc]);
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      inputEl.value = ""; inputEl.focus();
      outputEl.value = "";
      run(false);
      try { if (shouldRemember()) localStorage.removeItem(LAST_KEY); } catch (e) { /* noop */ }
    });
  }
  if (rememberEl) {
    rememberEl.addEventListener("change", function () {
      try { localStorage.setItem(REMEMBER_KEY, rememberEl.checked ? "1" : "0"); } catch (e) { /* noop */ }
      if (rememberEl.checked) saveInput();
      else { try { localStorage.removeItem(LAST_KEY); } catch (e) { /* noop */ } }
    });
  }

  // 언어 전환 시 배지·안내·통계 재렌더 (출력 SQL 자체는 언어 무관)
  document.addEventListener("i18n:change", function () {
    if (copyBtn && copyTimer) { clearTimeout(copyTimer); copyTimer = null; }
    run(false);
  });

  // 초기화
  loadPrefs();
  paintToggles();
  run(false);
  // 빈 화면에서는 붙여넣기가 바로 되도록 포커스 (모바일 키패드가 튀지 않게 넓은 화면에서만)
  try {
    if (!inputEl.value && window.matchMedia && window.matchMedia("(min-width: 720px)").matches) {
      inputEl.focus({ preventScroll: true });
    }
  } catch (e) { /* 포커스 실패는 무시 */ }
  // TOOLJS:END
})();
