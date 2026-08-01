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

  // Cloudflare Web Analytics — 쿠키리스·페이지뷰만. 토큰 설정 시에만 로드.
  // 실패해도 본 기능에 영향 없게 격리 (safeTrack 원칙 — 부가 기능은 본 기능과 격리, 철칙 5)
  // 수집 범위는 privacy.html §3 과 일치해야 한다. 도구 입력값은 절대 실리지 않는다(§1 약속).
  if (cfg.analytics && cfg.analytics.cfBeaconToken) {
    try {
      var s = document.createElement("script");
      s.defer = true;
      s.src = "https://static.cloudflareinsights.com/beacon.min.js";
      s.setAttribute("data-cf-beacon", JSON.stringify({ token: cfg.analytics.cfBeaconToken }));
      document.head.appendChild(s);
    } catch (e) { /* 분석 실패는 조용히 무시 — 본 기능에 영향 없음 */ }
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
  var $ = function (id) { return document.getElementById(id); };
  var inp = $("code"), result = $("result"), errEl = $("err"), noteEl = $("r-note");
  var wrapCtrl = $("tbl-ctrl"), wrapPrint = $("tbl-print");
  if (!inp || !wrapCtrl || !wrapPrint) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 제어 문자 약어·설명은 표준 기술 명칭이라 번역하지 않는다 (NUL/LF/CR 은 어느 언어 문서에서나 그대로 쓴다).
  var CTRL = ["NUL null", "SOH start of heading", "STX start of text", "ETX end of text",
    "EOT end of transmission", "ENQ enquiry", "ACK acknowledge", "BEL bell",
    "BS backspace", "TAB horizontal tab", "LF line feed", "VT vertical tab",
    "FF form feed", "CR carriage return", "SO shift out", "SI shift in",
    "DLE data link escape", "DC1 device control 1 (XON)", "DC2 device control 2",
    "DC3 device control 3 (XOFF)", "DC4 device control 4", "NAK negative acknowledge",
    "SYN synchronous idle", "ETB end of transmission block", "CAN cancel", "EM end of medium",
    "SUB substitute", "ESC escape", "FS file separator", "GS group separator",
    "RS record separator", "US unit separator"];
  var PUNCT = { 32: "Space", 33: "Exclamation mark", 34: "Double quote", 35: "Number sign (hash)",
    36: "Dollar sign", 37: "Percent sign", 38: "Ampersand", 39: "Apostrophe",
    40: "Left parenthesis", 41: "Right parenthesis", 42: "Asterisk", 43: "Plus sign",
    44: "Comma", 45: "Hyphen-minus", 46: "Full stop (period)", 47: "Slash",
    58: "Colon", 59: "Semicolon", 60: "Less-than sign", 61: "Equals sign",
    62: "Greater-than sign", 63: "Question mark", 64: "At sign", 91: "Left square bracket",
    92: "Backslash", 93: "Right square bracket", 94: "Caret", 95: "Underscore",
    96: "Backtick", 123: "Left curly brace", 124: "Vertical bar", 125: "Right curly brace",
    126: "Tilde", 127: "DEL delete" };
  var ENT = { 34: "&quot;", 38: "&amp;", 39: "&#39;", 60: "&lt;", 62: "&gt;" };

  function pad(s, n) { s = String(s); while (s.length < n) { s = "0" + s; } return s; }
  function hexOf(c) { return pad(c.toString(16).toUpperCase(), c > 0xFFFF ? 6 : (c > 255 ? 4 : 2)); }
  function octOf(c) { return pad(c.toString(8), 3); }
  function binOf(c) { return pad(c.toString(2), 8); }
  function entOf(c) { return ENT[c] || "&#" + c + ";"; }
  // 코드 포인트 표기는 최소 4자리다 — U+A0 이 아니라 U+00A0.
  function cpOf(c) { return "U+" + pad(c.toString(16).toUpperCase(), c > 0xFFFF ? 6 : 4); }

  function charName(c) {
    if (c < 32) return CTRL[c];
    if (PUNCT[c]) return PUNCT[c];
    if (c >= 48 && c <= 57) return "Digit " + (c - 48);
    if (c >= 65 && c <= 90) return "Uppercase " + String.fromCharCode(c);
    if (c >= 97 && c <= 122) return "Lowercase " + String.fromCharCode(c);
    return cpOf(c);
  }
  function fromCode(c) {
    if (c <= 0xFFFF) return String.fromCharCode(c);
    c -= 0x10000;
    return String.fromCharCode(0xD800 + (c >> 10), 0xDC00 + (c & 1023));
  }
  function glyph(c) {
    if (c === 32) return "SP";
    if (c < 32) return CTRL[c].split(" ")[0];
    if (c === 127) return "DEL";
    return fromCode(c);
  }
  // 서로게이트 쌍을 한 글자로 세어야 이모지 입력이 "여러 글자"로 오해되지 않는다.
  function firstCode(s) {
    var hi = s.charCodeAt(0);
    if (hi >= 0xD800 && hi <= 0xDBFF && s.length > 1) {
      var lo = s.charCodeAt(1);
      if (lo >= 0xDC00 && lo <= 0xDFFF) return { code: (hi - 0xD800) * 1024 + (lo - 0xDC00) + 0x10000, len: 2 };
    }
    return { code: hi, len: 1 };
  }

  // 단일 문자가 최우선이다 — "6" 은 문자 6(코드 54). 코드 6 을 원하면 06 이나 0x06.
  function parse(s) {
    var first = firstCode(s);
    if (first.len === s.length) return { code: first.code, multi: false };
    var low = s.toLowerCase();
    if (low.indexOf("0x") === 0 || low.indexOf("u+") === 0) {
      var body = s.slice(2);
      if (/^[0-9a-f]+$/i.test(body)) return { code: parseInt(body, 16), multi: false };
    }
    if (/^[0-9]+$/.test(s)) return { code: parseInt(s, 10), multi: false };
    if (s.charAt(0) === "-" && /^[0-9]+$/.test(s.slice(1))) return { code: -1, multi: false };
    return { code: first.code, multi: true };
  }

  function mark(c) {
    var prev = document.querySelector("#tool tbody tr.hit");
    if (prev) prev.className = "";
    if (c < 0 || c > 127) return;
    var row = $("row-" + c);
    if (!row) return;
    row.className = "hit";
    var wrap = (c < 32 || c === 127) ? wrapCtrl : wrapPrint;
    wrap.scrollTop = Math.max(0, row.offsetTop - wrap.clientHeight / 2);
  }

  function fail(k) {
    result.hidden = true; noteEl.hidden = true;
    errEl.hidden = false; errEl.textContent = t(k);
    mark(-1);
  }

  function calc() {
    var s = String(inp.value).trim();
    if (!s) return fail("tool.err.empty");
    var p = parse(s), c = p.code;
    if (!isFinite(c) || c < 0 || c > 1114111) return fail("tool.err.range");

    $("r-char").textContent = glyph(c);
    $("r-dec").textContent = String(c);
    $("r-hex").textContent = "0x" + hexOf(c);
    $("r-oct").textContent = octOf(c);
    $("r-bin").textContent = binOf(c);
    $("r-ent").textContent = entOf(c);
    $("r-name").textContent = charName(c);

    var notes = [];
    if (p.multi) notes.push(t("tool.note.multi"));
    if (c > 127) notes.push(t("tool.note.ext") + " " + cpOf(c));
    noteEl.textContent = notes.join(" ");
    noteEl.hidden = notes.length === 0;

    errEl.hidden = true;
    result.hidden = false;
    mark(c);
  }

  function cell(tag, txt) { var e = document.createElement(tag); e.textContent = txt; return e; }

  function buildTable(host, from, to, extra) {
    var cols = ["tool.r.dec", "tool.r.hex", "tool.r.char", "tool.r.bin", "tool.r.ent", "tool.r.name"];
    var tbl = document.createElement("table");
    var thead = document.createElement("thead"), hr = document.createElement("tr");
    for (var i = 0; i < cols.length; i++) hr.appendChild(cell("th", t(cols[i])));
    thead.appendChild(hr);
    tbl.appendChild(thead);
    var tb = document.createElement("tbody"), codes = [];
    for (var c = from; c <= to; c++) codes.push(c);
    if (extra >= 0) codes.push(extra);
    for (var j = 0; j < codes.length; j++) {
      var k = codes[j], tr = document.createElement("tr");
      tr.id = "row-" + k;
      tr.appendChild(cell("td", String(k)));
      tr.appendChild(cell("td", "0x" + hexOf(k)));
      tr.appendChild(cell("td", glyph(k)));
      tr.appendChild(cell("td", binOf(k)));
      tr.appendChild(cell("td", entOf(k)));
      tr.appendChild(cell("td", charName(k)));
      tb.appendChild(tr);
    }
    tbl.appendChild(tb);
    host.textContent = "";
    host.appendChild(tbl);
  }

  function buildAll() {
    buildTable(wrapCtrl, 0, 31, 127);
    buildTable(wrapPrint, 32, 126, -1);
  }
  buildAll();

  $("calc-btn").addEventListener("click", calc);
  inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); calc(); } });
  inp.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () {
    buildAll();
    if (!result.hidden || !errEl.hidden) calc();
  });
  // TOOLJS:END
})();
