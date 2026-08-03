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
  /* CSS Minifier / Beautifier — 100% 로컬. 문자열/주석/url() 을 보존하는 토크나이저를 통해
     안전한 범위에서만 압축한다. calc()/min()/max()/clamp() 내부는 0-단위 제거를 건너뛰어
     타입 불일치(예: calc(100% - 0) 는 사양상 유효하지 않을 수 있음)를 피한다. */

  /* ---- [tokenize] 문자열/주석/미인용 url() 을 분리해 안전 영역과 위험 영역을 나눈다.
     type: "code"(변형 가능) | "comment" | "string"(따옴표 포함) | "url"(미인용 url(...) 원문) */
  function tokenize(css) {
    var tokens = [];
    var i = 0, n = css.length, buf = "";
    function flush() { if (buf !== "") { tokens.push({ type: "code", text: buf }); buf = ""; } }
    while (i < n) {
      var c = css.charAt(i);

      // 주석 /* ... */ (문자열 밖)
      if (c === "/" && css.charAt(i + 1) === "*") {
        flush();
        var end = css.indexOf("*/", i + 2);
        var raw = end === -1 ? css.slice(i) : css.slice(i, end + 2);
        tokens.push({ type: "comment", text: raw });
        i = end === -1 ? n : end + 2;
        continue;
      }

      // 문자열 '...' 또는 "..." (이스케이프 인식)
      if (c === '"' || c === "'") {
        flush();
        var q = c, j = i + 1, esc = false;
        while (j < n) {
          var cj = css.charAt(j);
          if (esc) { esc = false; j++; continue; }
          if (cj === "\\") { esc = true; j++; continue; }
          if (cj === q) { j++; break; }
          j++;
        }
        tokens.push({ type: "string", text: css.slice(i, j) });
        i = j;
        continue;
      }

      // url( — 미인용 값만 원문 보존(따옴표가 오면 문자열 토큰이 알아서 처리하게 둔다)
      if ((c === "u" || c === "U") && /^url\(/i.test(css.substr(i, 4))) {
        var prevCh = i > 0 ? css.charAt(i - 1) : "";
        if (!/[A-Za-z0-9_-]/.test(prevCh)) {
          var k = i + 4;
          while (k < n && /\s/.test(css.charAt(k))) k++;
          var qc = css.charAt(k);
          if (qc !== '"' && qc !== "'") {
            flush();
            var m = k;
            while (m < n && css.charAt(m) !== ")") m++;
            if (m < n) m++; // ')' 포함
            tokens.push({ type: "url", text: css.slice(i, m) });
            i = m;
            continue;
          }
        }
      }

      buf += c;
      i++;
    }
    flush();
    return tokens;
  }

  /* ---- [protect] calc()/min()/max()/clamp() 구간 — 0-단위 제거만 이 구간을 건너뛴다.
     공백 정리·콜론/콤마/중괄호 트림·hex 축약은 +,- 연산자를 건드리지 않으므로 이 구간에도 안전하다. */
  function findProtectedRanges(text) {
    var ranges = [];
    var re = /\b(calc|min|max|clamp)\(/gi;
    var m;
    while ((m = re.exec(text))) {
      var openAt = m.index + m[0].length - 1;
      var depth = 1, i = openAt + 1;
      while (i < text.length && depth > 0) {
        var c = text.charAt(i);
        if (c === "(") depth++;
        else if (c === ")") depth--;
        i++;
      }
      ranges.push([m.index, i]);
      re.lastIndex = i;
    }
    return ranges;
  }
  function isProtected(ranges, idx) {
    for (var i = 0; i < ranges.length; i++) {
      if (idx >= ranges[i][0] && idx < ranges[i][1]) return true;
    }
    return false;
  }

  /* ---- [compact] 공백/구두점 정리. ')' 뒤 공백은 절대 지우지 않는다 —
     ":not(.a) .b" 에서 지우면 하위선택자 결합이 사라져 ":not(.a).b" 로 뜻이 바뀐다.
     +,-,>,~ 는 건드리지 않는다 (calc 산술·조합자 공백은 의미가 있을 수 있음). */
  function compactCode(text) {
    text = text.replace(/\s+/g, " ");
    text = text.replace(/\s*\{\s*/g, "{");
    text = text.replace(/\s*\}\s*/g, "}");
    text = text.replace(/\s*;\s*/g, ";");
    text = text.replace(/\s*:\s*/g, ":");
    text = text.replace(/\s*,\s*/g, ",");
    text = text.replace(/\(\s+/g, "(");
    text = text.replace(/\s+\)/g, ")");
    return text;
  }

  /* ---- [hex] #aabbcc → #abc / #aabbccdd → #abcd. 각 쌍이 완전히 같을 때만(안전한 경우만).
     "#......" 는 ID 선택자이기도 하다 — "#fff123 { ... }" 를 색상으로 오인해 줄이면 선택자가
     깨진다. 그래서 바로 앞(공백 제외)이 ':' 또는 '(' 일 때만("value 위치"가 분명할 때만) 줄인다.
     '{' '}' ';' ',' 앞이거나 세그먼트 시작이면 선택자일 수 있으므로 건드리지 않는다(보수적 기본값 — 압축 기회를 조금 놓치더라도 절대 깨뜨리지 않는다). */
  function shortenHexColors(text) {
    return text.replace(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g, function (m, hex, offset) {
      var j = offset - 1, ctx = null;
      while (j >= 0) {
        var cj = text.charAt(j);
        if (cj === ":" || cj === "(" || cj === "{" || cj === "}" || cj === ";" || cj === ",") { ctx = cj; break; }
        j--;
      }
      if (ctx !== ":" && ctx !== "(") return m;
      for (var i = 0; i < hex.length; i += 2) {
        if (hex.charAt(i).toLowerCase() !== hex.charAt(i + 1).toLowerCase()) return m;
      }
      var out = "#";
      for (i = 0; i < hex.length; i += 2) out += hex.charAt(i);
      return out;
    });
  }

  /* ---- [zero] 0 값 단위 제거. 길이/퍼센트 단위만 대상 — CSS Values 사양상
     <angle>/<time>/<frequency>/<resolution>/<flex(fr)> 값은 단위 없는 0 이 허용되지 않는다
     (예: "transition-duration: 0" 은 무효, "0s" 여야 함). calc() 등 내부는 건너뛴다
     (예: calc(100% - 0) 은 타입 불일치로 무효가 될 수 있다). */
  var ZERO_UNIT_RE = /([\s:(,]|^)([+-]?)0(?:\.0+)?(px|em|rem|ex|ch|vw|vh|vmin|vmax|cm|mm|in|pt|pc|q|%)(?=$|[\s;,)}!])/gi;
  function stripZeroUnits(text) {
    var ranges = findProtectedRanges(text);
    return text.replace(ZERO_UNIT_RE, function (whole, pre, sign, unit, offset) {
      if (isProtected(ranges, offset)) return whole;
      return pre + "0";
    });
  }

  /* ---- [minify] 옵션에 따라 code 세그먼트만 변형, string/url/(보존 대상) comment 는 원문 유지. ---- */
  function minifyCSS(css, opts) {
    opts = opts || {};
    var tokens = tokenize(css);
    var out = "";
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      if (tok.type === "comment") {
        // /*! ... */ 배너(라이선스 등) 주석은 주석 제거 옵션과 무관하게 항상 보존한다.
        var isBanner = tok.text.length >= 3 && tok.text.charAt(2) === "!";
        if (!opts.stripComments || isBanner) out += tok.text;
        continue;
      }
      if (tok.type === "string" || tok.type === "url") {
        out += tok.text;
        continue;
      }
      var text = compactCode(tok.text);
      if (opts.shortenHex) text = shortenHexColors(text);
      if (opts.stripZero) text = stripZeroUnits(text);
      out += text;
    }
    out = out.replace(/;\}/g, "}"); // 안전: '}' 는 code 세그먼트에만 등장(문자열/주석/url 안이 아님)
    return out.trim();
  }

  /* ---- [beautify] 재-들여쓰기. { 뒤 줄바꿈+들여쓰기, ; 뒤 줄바꿈, } 는 들여쓰기 감소 후 단독 줄.
     문자열/url 은 원문 그대로 현재 줄에 이어붙이고, 주석은 독립된 줄로 보존한다. ---- */
  function beautifyCSS(css, indentUnit) {
    var unit = typeof indentUnit === "string" && indentUnit !== "" ? indentUnit : "  ";
    var tokens = tokenize(css);
    var out = [], indent = 0, line = "";
    function ind() { var s = ""; for (var i = 0; i < indent; i++) s += unit; return s; }
    function pushLine() {
      var t = line.replace(/\s+$/, "");
      if (t !== "") out.push(ind() + t);
      line = "";
    }
    for (var ti = 0; ti < tokens.length; ti++) {
      var tok = tokens[ti];
      if (tok.type === "comment") {
        if (line.trim() !== "") pushLine();
        out.push(ind() + tok.text);
        continue;
      }
      if (tok.type === "string" || tok.type === "url") {
        line += tok.text;
        continue;
      }
      var text = tok.text, i = 0, n = text.length;
      while (i < n) {
        var c = text.charAt(i);
        if (/\s/.test(c)) {
          while (i < n && /\s/.test(text.charAt(i))) i++;
          if (line.length && !/\s$/.test(line)) line += " ";
          continue;
        }
        if (c === "{") {
          line = line.replace(/\s+$/, "") + " {";
          pushLine();
          indent++;
          i++;
          continue;
        }
        if (c === "}") {
          if (line.trim() !== "") pushLine();
          indent = indent > 0 ? indent - 1 : 0;
          out.push(ind() + "}");
          if (indent === 0) out.push("");
          i++;
          continue;
        }
        if (c === ";") {
          line += ";";
          pushLine();
          i++;
          continue;
        }
        line += c;
        i++;
      }
    }
    if (line.trim() !== "") pushLine();
    var result = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return result === "" ? "" : result + "\n";
  }

  /* ---- 바이트 크기 (UTF-8 기준 — 실제 파일 저장 크기와 일치) ---- */
  function byteSize(str) {
    if (typeof TextEncoder !== "undefined") {
      try { return new TextEncoder().encode(str).length; } catch (e) { /* 폴백 */ }
    }
    try { return unescape(encodeURIComponent(str)).length; } catch (e) { return str.length; }
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      tokenize: tokenize, compactCode: compactCode, shortenHexColors: shortenHexColors,
      stripZeroUnits: stripZeroUnits, minifyCSS: minifyCSS, beautifyCSS: beautifyCSS,
      byteSize: byteSize, findProtectedRanges: findProtectedRanges
    };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "css-minifier") + ":state";
  var MAX_CHARS = 3000000; // ~3MB — 이 이상은 붙여넣기 사고(전체 라이브러리 등)로 간주해 명시적으로 거부
  function tr(key, vars) {
    var s = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    if (s == null) s = key;
    if (vars) {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) s = s.split("{" + k + "}").join(String(vars[k]));
      }
    }
    return s;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmtNum(n) {
    try { return Number(n).toLocaleString(uiLang()); } catch (e) { return String(n); }
  }
  function fmtBytes(n) {
    var abs = Math.abs(n);
    if (abs < 1024) return fmtNum(n) + " B";
    var kb = n / 1024;
    try { return new Intl.NumberFormat(uiLang(), { maximumFractionDigits: 1 }).format(kb) + " KB"; }
    catch (e) { return kb.toFixed(1) + " KB"; }
  }
  function fmtPct(p) {
    try { return new Intl.NumberFormat(uiLang(), { style: "percent", maximumFractionDigits: 1 }).format(p / 100); }
    catch (e) { return (Math.round(p * 10) / 10) + "%"; }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var tabMin = $("mode-minify"), tabBeau = $("mode-beautify");
  var optsWrap = $("minify-opts");
  var optComments = $("opt-comments"), optHex = $("opt-hex"), optZero = $("opt-zero");
  var beautyWrap = $("beautify-opts"), optIndent = $("opt-indent");
  // 들여쓰기 선택값 → 실제 문자열. 알 수 없는 값은 기본 2칸.
  function indentUnit() {
    var v = optIndent ? optIndent.value : "2";
    if (v === "tab") return "\t";
    var n = parseInt(v, 10);
    if (!isFinite(n) || n < 1 || n > 8) return "  ";
    return new Array(n + 1).join(" ");
  }
  var inputEl = $("css-input"), runBtn = $("css-run"), sampleBtn = $("css-sample"), clearBtn = $("css-clear");
  var errEl = $("css-err");
  var resultEl = $("result"), emptyEl = $("result-empty"), bodyEl = $("result-body");
  var outputEl = $("css-output"), copyBtn = $("css-copy"), downloadBtn = $("css-download");
  var statOrigEl = $("stat-original"), statResEl = $("stat-result"), statDiffEl = $("stat-diff");
  var licenseNoteEl = $("license-note");
  if (!inputEl || !outputEl || !resultEl) return;

  var SAMPLE = "/* Site header */\n" +
    ".header {\n" +
    "  background-color: #ffffff;\n" +
    "  border: 1px solid #a1b2c3;\n" +
    "  margin: 0px 10px;\n" +
    "  padding: 0.0em;\n" +
    "  transition: opacity 0.2s ease, transform 0s;\n" +
    "  width: calc(100% - 0px);\n" +
    "  background-image: url(images/logo.png);\n" +
    "}\n\n" +
    ".header::after {\n" +
    "  content: '';\n" +
    "  color: #ff0000;\n" +
    "}\n";

  /* ---- 상태 (모드 + 옵션 + 마지막 입력) ---- */
  function loadState() {
    try {
      var raw = localStorage.getItem(SKEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveState() {
    try {
      localStorage.setItem(SKEY, JSON.stringify({
        mode: mode,
        comments: optComments.checked,
        hex: optHex.checked,
        zero: optZero.checked,
        indent: optIndent ? optIndent.value : "2",
        input: inputEl.value
      }));
    } catch (e) { /* private mode — 저장만 실패, 동작은 정상 */ }
  }

  var mode = "minify";
  function setMode(next) {
    mode = next;
    var isMin = mode === "minify";
    tabMin.classList.toggle("is-on", isMin);
    tabBeau.classList.toggle("is-on", !isMin);
    tabMin.setAttribute("aria-selected", isMin ? "true" : "false");
    tabBeau.setAttribute("aria-selected", !isMin ? "true" : "false");
    optsWrap.hidden = !isMin;
    if (beautyWrap) beautyWrap.hidden = isMin;
    runBtn.textContent = tr(isMin ? "tool.run.minify" : "tool.run.beautify");
    render();
    saveState();
  }

  /* ---- 렌더 ---- */
  function render() {
    var src = inputEl.value;
    errEl.hidden = true;
    errEl.textContent = "";

    if (src.length > MAX_CHARS) {
      errEl.textContent = tr("tool.err.tooLarge");
      errEl.hidden = false;
      resultEl.hidden = true;
      emptyEl.hidden = true;
      return;
    }
    if (src.trim() === "") {
      resultEl.hidden = false;
      emptyEl.hidden = false;
      bodyEl.hidden = true;
      return;
    }

    var out;
    try {
      out = mode === "minify"
        ? minifyCSS(src, { stripComments: optComments.checked, shortenHex: optHex.checked, stripZero: optZero.checked })
        : beautifyCSS(src, indentUnit());
    } catch (e) {
      errEl.textContent = tr("tool.err.parse");
      errEl.hidden = false;
      resultEl.hidden = true;
      emptyEl.hidden = true;
      return;
    }

    outputEl.value = out;
    var origBytes = byteSize(src), outBytes = byteSize(out);
    var diff = outBytes - origBytes;
    var pct = origBytes > 0 ? (diff / origBytes) * 100 : 0;

    statOrigEl.textContent = fmtBytes(origBytes);
    statResEl.textContent = fmtBytes(outBytes);
    var sign = diff > 0 ? "+" : (diff < 0 ? "−" : "");
    statDiffEl.textContent = sign + fmtBytes(Math.abs(diff)) + " (" + sign + fmtPct(Math.abs(pct)) + ")";
    statDiffEl.className = diff < 0 ? "csm-diff is-down" : (diff > 0 ? "csm-diff is-up" : "csm-diff");

    var hadBanner = mode === "minify" && optComments.checked && /\/\*!/.test(src);
    licenseNoteEl.hidden = !hadBanner;

    resultEl.hidden = false;
    emptyEl.hidden = true;
    bodyEl.hidden = false;
    saveState();
  }

  /* ---- 클립보드 복사 ---- */
  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch (e) { return false; }
  }
  function flashCopied(btn, key) {
    var orig = tr(key);
    btn.textContent = tr("tool.copied");
    setTimeout(function () { btn.textContent = orig; }, 1200);
  }
  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      var text = outputEl.value;
      if (!text) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { flashCopied(copyBtn, "tool.copy"); },
          function () { if (legacyCopy(text)) flashCopied(copyBtn, "tool.copy"); }
        );
      } else if (legacyCopy(text)) {
        flashCopied(copyBtn, "tool.copy");
      }
    });
  }

  /* ---- 다운로드 (.css 파일, 순수 클라이언트 Blob — 업로드 없음) ---- */
  if (downloadBtn) {
    downloadBtn.addEventListener("click", function () {
      var text = outputEl.value;
      if (!text) return;
      try {
        var blob = new Blob([text], { type: "text/css;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = (mode === "minify" ? "minified" : "beautified") + ".css";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      } catch (e) { /* 구형 브라우저 — 다운로드만 실패, 복사는 여전히 가능 */ }
    });
  }

  /* ---- 이벤트 ---- */
  var renderTimer = null;
  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 150);
  }
  inputEl.addEventListener("input", scheduleRender);
  [optComments, optHex, optZero, optIndent].forEach(function (el) {
    if (el) el.addEventListener("change", render);
  });
  if (runBtn) runBtn.addEventListener("click", render);
  if (tabMin) tabMin.addEventListener("click", function () { setMode("minify"); });
  if (tabBeau) tabBeau.addEventListener("click", function () { setMode("beautify"); });
  if (sampleBtn) {
    sampleBtn.addEventListener("click", function () {
      inputEl.value = SAMPLE;
      render();
      try { inputEl.focus(); } catch (e) { /* noop */ }
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      inputEl.value = "";
      outputEl.value = "";
      render();
      try { inputEl.focus(); } catch (e) { /* noop */ }
    });
  }
  document.addEventListener("i18n:change", function () {
    runBtn.textContent = tr(mode === "minify" ? "tool.run.minify" : "tool.run.beautify");
    if (inputEl.value.trim() !== "") render();
  });

  /* ---- 초기화 (마지막 상태 복원) ---- */
  (function init() {
    var st = loadState();
    if (st) {
      if (st.mode === "beautify") mode = "beautify";
      if (typeof st.comments === "boolean") optComments.checked = st.comments;
      if (typeof st.hex === "boolean") optHex.checked = st.hex;
      if (typeof st.zero === "boolean") optZero.checked = st.zero;
      if (optIndent && typeof st.indent === "string" && /^(2|3|4|8|tab)$/.test(st.indent)) optIndent.value = st.indent;
      if (typeof st.input === "string") inputEl.value = st.input;
    }
    setMode(mode);
  })();
  // TOOLJS:END
})();
