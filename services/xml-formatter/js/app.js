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
  /* XML Formatter — DOMParser 로 파싱해 문서 트리로 만들고, 손으로 쓴 직렬화기로
     들여쓰기·압축을 재구성한다. 정규식으로 원문을 뜯어고치지 않으므로 CDATA·주석·
     XML 선언이 그대로 보존된다. 외부 API 없음, 전부 브라우저 로컬 처리. */
  var LAST_KEY     = "xml-formatter:last";
  var INDENT_KEY   = "xml-formatter:indent";
  var MODE_KEY     = "xml-formatter:mode";
  var REMEMBER_KEY = "xml-formatter:remember";
  var AUTO_MAX     = 500000;   // 즉시 포맷 상한(문자). 초과 시 타이핑 지연 방지 위해 버튼 실행으로 안내
  var EXCERPT_MAX  = 2000000;  // 오류 발췌 생성 상한(문자) — 초과 시 발췌 생략(성능 보호)
  var DEBOUNCE_MS  = 300;

  var inputEl    = document.getElementById("xf-input");
  var outputEl   = document.getElementById("xf-output");
  var indentBox  = document.getElementById("xf-indent");
  var indentRow  = document.getElementById("xf-indent-row");
  var rememberEl = document.getElementById("xf-remember");
  var badgeEl    = document.getElementById("xf-badge");
  var statsEl    = document.getElementById("xf-stats");
  var messageEl  = document.getElementById("xf-message");
  var errorBox   = document.getElementById("xf-error");
  var excerptEl  = document.getElementById("xf-excerpt");
  var hintEl     = document.getElementById("xf-hint");
  var rawEl      = document.getElementById("xf-raw");
  var jumpBtn    = document.getElementById("xf-jump");
  var feedbackEl = document.getElementById("xf-feedback");
  var formatBtn  = document.getElementById("xf-format");
  var minifyBtn  = document.getElementById("xf-minify");
  var clearBtn   = document.getElementById("xf-clear");
  var copyBtn    = document.getElementById("xf-copy");
  var downloadBtn= document.getElementById("xf-download");
  if (!inputEl || !outputEl) return;

  var mode   = "format"; // "format" | "minify"
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

  function repeatStr(s, n) {
    var out = "";
    for (var i = 0; i < n; i++) out += s;
    return out;
  }

  function currentIndentUnit() {
    if (indent === "tab") return "\t";
    var n = parseInt(indent, 10);
    return repeatStr(" ", isNaN(n) ? 2 : n);
  }

  function escapeText(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  // 속성값: & < > " 이스케이프 + 개행/탭도 문자참조로 (라운드트립 시 정규화 유실 방지)
  function escapeAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/\t/g, "&#9;").replace(/\n/g, "&#10;").replace(/\r/g, "&#13;");
  }
  function serializeAttrs(el) {
    var out = "", attrs = el.attributes;
    for (var i = 0; i < attrs.length; i++) {
      out += " " + attrs[i].name + '="' + escapeAttr(attrs[i].value) + '"';
    }
    return out;
  }

  /** 압축(minify) — 추가 공백 없이, 그러나 노드 종류별로 정확히 재구성 (정규식 아님) */
  function serializeCompact(node) {
    switch (node.nodeType) {
      case 1: { // ELEMENT_NODE
        var open = "<" + node.nodeName + serializeAttrs(node);
        if (!node.childNodes.length) return open + "/>";
        var inner = "";
        for (var i = 0; i < node.childNodes.length; i++) inner += serializeCompact(node.childNodes[i]);
        return open + ">" + inner + "</" + node.nodeName + ">";
      }
      case 3: return escapeText(node.nodeValue);                          // TEXT_NODE
      case 4: return "<![CDATA[" + node.nodeValue + "]]>";                 // CDATA_SECTION_NODE
      case 8: return "<!--" + node.nodeValue + "-->";                      // COMMENT_NODE
      case 7: return "<?" + node.target + (node.data ? " " + node.data : "") + "?>"; // PROCESSING_INSTRUCTION_NODE
      default: return "";
    }
  }
  var serializeInline = serializeCompact; // 혼합 콘텐츠를 한 줄에 그대로 보존할 때도 동일 로직 재사용

  // 서식용 공백(whitespace-only) 텍스트 노드만 걸러낸 자식 목록 — 의미 있는 텍스트는 남긴다
  function meaningfulChildren(node) {
    var out = [], kids = node.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.nodeType === 3 && k.nodeValue.trim() === "") continue;
      out.push(k);
    }
    return out;
  }

  /**
   * 들여쓰기(pretty) 직렬화 — 재귀. 규칙:
   *  - 자식이 없으면 자기닫힘 태그 (<a/>)
   *  - 자식이 텍스트 하나뿐이면 한 줄로 인라인 (<a>text</a>)
   *  - 텍스트와 요소가 섞인 "혼합 콘텐츠"는 공백을 건드리면 의미가 바뀔 수 있어
   *    원형 그대로 한 줄에 보존 (serializeInline)
   *  - 그 외(요소/주석/CDATA/PI 만 있는 구조적 콘텐츠)는 한 단계씩 들여써 재귀
   */
  function serializePretty(node, depth, indentUnit, out) {
    var pad = repeatStr(indentUnit, depth);
    var open = "<" + node.nodeName + serializeAttrs(node);
    var kids = meaningfulChildren(node);

    if (!kids.length) { out.push(pad + open + "/>"); return; }

    if (kids.length === 1 && kids[0].nodeType === 3) {
      out.push(pad + open + ">" + escapeText(kids[0].nodeValue.trim()) + "</" + node.nodeName + ">");
      return;
    }

    var hasElement = false, hasText = false;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].nodeType === 1) hasElement = true;
      else if (kids[i].nodeType === 3) hasText = true;
    }

    if (hasElement && hasText) {
      out.push(pad + serializeInline(node));
      return;
    }

    out.push(pad + open + ">");
    var childPad = repeatStr(indentUnit, depth + 1);
    for (var j = 0; j < kids.length; j++) {
      var kid = kids[j];
      if (kid.nodeType === 1) serializePretty(kid, depth + 1, indentUnit, out);
      else if (kid.nodeType === 4) out.push(childPad + "<![CDATA[" + kid.nodeValue + "]]>");
      else if (kid.nodeType === 8) out.push(childPad + "<!--" + kid.nodeValue + "-->");
      else if (kid.nodeType === 7) out.push(childPad + "<?" + kid.target + (kid.data ? " " + kid.data : "") + "?>");
    }
    out.push(pad + "</" + node.nodeName + ">");
  }

  // 원문 맨 앞의 XML 선언(<?xml ...?>)을 있는 그대로 추출 — 재구성하지 않고 원문 보존
  function extractDeclaration(raw) {
    var m = /^[\s﻿]*(<\?xml[^?]*\?>)/i.exec(raw);
    return m ? m[1] : null;
  }
  function serializeDoctype(dt) {
    if (!dt) return "";
    var s = "<!DOCTYPE " + dt.name;
    if (dt.publicId) s += ' PUBLIC "' + dt.publicId + '"' + (dt.systemId ? ' "' + dt.systemId + '"' : "");
    else if (dt.systemId) s += ' SYSTEM "' + dt.systemId + '"';
    return s + ">";
  }

  function buildOutput(doc, raw) {
    var decl = extractDeclaration(raw);
    var dtStr = serializeDoctype(doc.doctype);
    var rootEl = doc.documentElement;
    if (mode === "minify") {
      return (decl || "") + dtStr + serializeCompact(rootEl);
    }
    var lines = [];
    if (decl) lines.push(decl);
    if (dtStr) lines.push(dtStr);
    serializePretty(rootEl, 0, currentIndentUnit(), lines);
    return lines.join("\n");
  }

  /** DOMParser 로 파싱 — 실패 시 parsererror 텍스트를 진단 대상 메시지로 반환 */
  function parseXmlDoc(raw) {
    var doc;
    try {
      doc = new DOMParser().parseFromString(raw, "application/xml");
    } catch (e) {
      return { ok: false, message: (e && e.message) || t("tool.unknownError") };
    }
    var perr = doc.getElementsByTagName("parsererror");
    if (perr && perr.length) {
      var msg = (perr[0].textContent || "").trim();
      return { ok: false, message: msg || t("tool.unknownError") };
    }
    if (!doc.documentElement) return { ok: false, message: t("tool.err.noRoot") };
    return { ok: true, doc: doc };
  }

  /** 오프셋 → 줄·열 (1-based) */
  function offsetToLineCol(text, pos) {
    if (pos > text.length) pos = text.length;
    if (pos < 0) pos = 0;
    var line = 1, lastNl = -1;
    for (var i = 0; i < pos; i++) {
      if (text.charCodeAt(i) === 10) { line++; lastNl = i; }
    }
    return { line: line, col: pos - lastNl };
  }

  /** 파서 메시지에서 사람 말로 무엇이 문제인지 고른다 (브라우저 메시지 문구 기반 휴리스틱) */
  function hintFor(msg) {
    var s = String(msg || "").toLowerCase();
    if (/junk after document element|extra content at the end|exactly one root/i.test(s)) return "tool.hint.multiRoot";
    if (/mismatch|opening and ending tag|expected.*to close|end tag/i.test(s)) return "tool.hint.mismatch";
    if (/entityref|reference is not well.?formed|undefined entity|expecting ';'|not a valid entity/i.test(s)) return "tool.hint.entity";
    if (/attribute|equal sign|quote|not well-formed|invalid character/i.test(s)) return "tool.hint.malformed";
    return "tool.hint.generic";
  }

  /**
   * 파서 오류 메시지 → { line, col, message, hintKey }.
   * 크롬/파이어폭스/사파리 모두 "line ... column ..." 류 문구를 어순만 다르게 포함하므로
   * "line" 뒤 숫자 아닌 문자들, 그 뒤 "column" 뒤 숫자 아닌 문자들을 건너뛰는 한 정규식으로 통일.
   * 위치 정보를 못 찾으면 line/col 없이 메시지만 보여준다 (거짓 정밀도 지양).
   */
  function diagnose(message, raw) {
    var m = /line[^\d]*(\d+)[^\d]*column[^\d]*(\d+)/i.exec(message);
    if (!m) return { message: message, line: null, col: null, hintKey: hintFor(message) };
    var line = parseInt(m[1], 10), col = parseInt(m[2], 10);
    var maxLine = raw.split("\n").length;
    if (line > maxLine) line = maxLine; // 방어적 클램프
    return { message: message, line: line, col: col, hintKey: hintFor(message) };
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

  /** 요소 개수(재귀)·최대 중첩 깊이 통계 */
  function analyzeDoc(rootEl) {
    var elements = 0, maxDepth = 0;
    (function walk(node, depth) {
      elements++;
      if (depth > maxDepth) maxDepth = depth;
      var kids = node.childNodes;
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].nodeType === 1) walk(kids[i], depth + 1);
      }
    })(rootEl, 1);
    return { elements: elements, depth: maxDepth };
  }

  function byteLen(str) {
    try {
      if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str).length;
    } catch (e) { /* fallthrough */ }
    return unescape(encodeURIComponent(str)).length;
  }

  /** 줄·열·바이트는 사용자가 에디터와 대조하는 "코드 좌표" — ar·ur 도 라틴 숫자로 고정 */
  function numLocale() {
    var lg = (window.I18N && typeof window.I18N.lang === "function") ? window.I18N.lang() : null;
    if (!lg) return "en";
    if (lg === "ar" || lg === "ur") return lg + "-u-nu-latn";
    return lg;
  }
  function fmtNum(n) {
    try { return n.toLocaleString(numLocale()); }
    catch (e) { try { return n.toLocaleString(); } catch (e2) { return String(n); } }
  }

  // ----- 상태 배지·메시지·통계 렌더 -----

  function setBadge(kind, text) {
    if (!badgeEl) return;
    badgeEl.textContent = text;
    if (kind === "valid") {
      badgeEl.style.color = "#fff"; badgeEl.style.background = "var(--accent)"; badgeEl.style.borderColor = "var(--accent)";
    } else if (kind === "invalid") {
      badgeEl.style.color = "#fff"; badgeEl.style.background = "#dc2626"; badgeEl.style.borderColor = "#dc2626";
    } else {
      badgeEl.style.color = "var(--muted)"; badgeEl.style.background = "var(--bg)"; badgeEl.style.borderColor = "var(--line)";
    }
  }

  function invalidLabel(d) {
    if (d && d.line != null && d.col != null) {
      return t("tool.invalidAt").replace("{line}", fmtNum(d.line)).replace("{column}", fmtNum(d.col));
    }
    return t("tool.invalid");
  }

  function hideError() {
    lastDiag = null;
    if (errorBox) errorBox.hidden = true;
  }

  function showError(raw, d) {
    lastDiag = d;
    if (!errorBox) return;
    errorBox.hidden = false;
    if (excerptEl) {
      var ex = (d.line != null && raw.length <= EXCERPT_MAX) ? buildExcerpt(raw, d.line, d.col) : "";
      excerptEl.textContent = ex;
      excerptEl.hidden = !ex;
    }
    if (hintEl) hintEl.textContent = t(d.hintKey);
    if (rawEl) rawEl.textContent = t("tool.parserSays") + " " + d.message;
    if (jumpBtn) jumpBtn.hidden = (d.line == null);
  }

  /** 오류 줄을 입력창에서 선택 + 스크롤 (명시적 액션에서만 — 타이핑 중 아님) */
  function highlightErrorLine(d, raw) {
    if (!inputEl || !d || d.line == null) return;
    var lines = raw.split("\n");
    var start = 0;
    for (var i = 0; i < d.line - 1 && i < lines.length; i++) start += lines[i].length + 1;
    var lineText = lines[d.line - 1] || "";
    var end = start + lineText.length;
    try {
      inputEl.focus();
      inputEl.setSelectionRange(start, end);
      var lh = parseFloat(getComputedStyle(inputEl).lineHeight) || 20;
      inputEl.scrollTop = Math.max(0, (d.line - 3) * lh);
    } catch (e) { /* 선택 불가 환경 무시 */ }
  }

  /**
   * 입력 → 상태·안내·출력을 한 번에 갱신.
   * explicit=true 는 사용자가 버튼을 누른 경우 — 토스트·오류 줄 선택까지 한다.
   */
  function run(explicit) {
    var raw = inputEl.value;

    if (!raw || !raw.trim()) {
      setBadge("neutral", t("tool.badgeNeutral"));
      if (statsEl) statsEl.textContent = "";
      if (messageEl) messageEl.textContent = t("tool.emptyHint");
      hideError();
      outputEl.value = "";
      if (explicit) showFeedback(t("tool.emptyFormat"), true);
      return;
    }

    var r = parseXmlDoc(raw);
    if (!r.ok) {
      var d = diagnose(r.message, raw);
      setBadge("invalid", t("tool.badgeInvalid"));
      if (statsEl) statsEl.textContent = "";
      if (messageEl) messageEl.textContent = invalidLabel(d);
      showError(raw, d);
      // 출력은 마지막 유효 결과를 남겨둔다 — 한 글자 지웠다고 결과가 사라지지 않게
      if (explicit) {
        highlightErrorLine(d, raw);
        showFeedback(invalidLabel(d), true);
      }
      return;
    }

    setBadge("valid", t("tool.badgeValid"));
    hideError();
    var a = analyzeDoc(r.doc.documentElement);
    var bytes = byteLen(raw);
    if (statsEl) {
      statsEl.textContent =
        fmtNum(a.elements) + " " + t("tool.statElements") + "  ·  " +
        fmtNum(a.depth) + " " + t("tool.statDepth") + "  ·  " +
        fmtNum(bytes) + " " + t("tool.statBytes");
    }

    // 대용량 문서는 타이핑마다 직렬화하면 느려진다 → 버튼 실행으로 안내 (조용히 넘기지 않는다)
    if (!explicit && raw.length > AUTO_MAX) {
      if (messageEl) messageEl.textContent = t("tool.large");
      return;
    }

    var out;
    try { out = buildOutput(r.doc, raw); } catch (e) { out = null; }
    if (out == null) {
      if (messageEl) messageEl.textContent = t("tool.stringifyError");
      if (explicit) showFeedback(t("tool.stringifyError"), true);
      return;
    }
    outputEl.value = out;
    if (messageEl) {
      if (mode === "minify") {
        var outBytes = byteLen(out);
        var pct = (bytes > 0) ? Math.max(0, Math.round((1 - outBytes / bytes) * 100)) : 0;
        messageEl.textContent = fill("tool.minifiedInfo", { from: fmtNum(bytes), to: fmtNum(outBytes), percent: fmtNum(pct) });
      } else {
        messageEl.textContent = t("tool.validHint");
      }
    }
    if (explicit) showFeedback(mode === "minify" ? t("tool.minified") : t("tool.formatted"), false);
  }

  // ----- 모드·들여쓰기 토글 (선택형 — 자유 입력 없음) -----

  function paint(btn, on) {
    if (!btn) return;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.style.background = on ? "var(--accent)" : "transparent";
    btn.style.color = on ? "#fff" : "var(--muted)";
    btn.style.fontWeight = on ? "700" : "500";
  }
  function indentButtons() { return indentBox ? indentBox.querySelectorAll("[data-indent]") : []; }
  function paintToggles() {
    paint(formatBtn, mode === "format");
    paint(minifyBtn, mode === "minify");
    var btns = indentButtons();
    for (var i = 0; i < btns.length; i++) paint(btns[i], btns[i].getAttribute("data-indent") === indent);
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
      var blob = new Blob([value], { type: "application/xml" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = (mode === "minify" ? "minified.xml" : "formatted.xml");
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      showFeedback(t("tool.downloaded"), false);
    } catch (e) { showFeedback(t("tool.copyError"), true); }
  }

  // ----- localStorage 저장/복원 -----

  function shouldRemember() { return !rememberEl || rememberEl.checked; }
  function saveInput() {
    if (!shouldRemember()) return;
    try { localStorage.setItem(LAST_KEY, inputEl.value); } catch (e) { /* private mode */ }
  }
  function savePrefs() {
    try { localStorage.setItem(INDENT_KEY, indent); } catch (e) { /* noop */ }
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
    } catch (e) { /* noop */ }
    if (shouldRemember()) {
      try {
        var last = localStorage.getItem(LAST_KEY);
        if (typeof last === "string" && last.length > 0) inputEl.value = last;
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

  inputEl.addEventListener("input", schedule);
  if (formatBtn) formatBtn.addEventListener("click", function () { setMode("format", true); });
  if (minifyBtn) minifyBtn.addEventListener("click", function () { setMode("minify", true); });
  if (copyBtn) copyBtn.addEventListener("click", copyOutput);
  if (downloadBtn) downloadBtn.addEventListener("click", downloadOutput);
  if (jumpBtn) jumpBtn.addEventListener("click", function () {
    if (lastDiag) highlightErrorLine(lastDiag, inputEl.value);
  });

  var indentBtns = indentButtons();
  for (var b = 0; b < indentBtns.length; b++) {
    (function (btn) { btn.addEventListener("click", function () { setIndent(btn.getAttribute("data-indent")); }); })(indentBtns[b]);
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      inputEl.value = "";
      inputEl.focus();
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

  // 언어 전환 시 배지·안내·통계 재렌더 (출력 XML 자체는 언어 무관 — 값은 그대로다)
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
    if (!inputEl.value && window.matchMedia && window.matchMedia("(min-width: 720px)").matches) {
      inputEl.focus({ preventScroll: true });
    }
  } catch (e) { /* 포커스 실패는 무시 */ }
  // TOOLJS:END
})();
