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
  /* JSON to CSV Converter — JSON 배열(객체) → CSV 순수 변환. 외부 API 없음, 모든 처리는 로컬.
     상태: localStorage "<slug>:state" (마지막 입력값 + 구분자 선택)만 저장. */

  /* ---- 순수 로직 (node 단위 검증 대상) ---- */

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  // 값 종류 판별용 (에러 메시지 등에서 사용)
  function isPrimitive(v) {
    return v === null || (typeof v !== "object");
  }

  /* 중첩 객체를 점(dot) 표기로 평탄화. 배열은 분해하지 않고 JSON 텍스트 그대로 한 칸에 담는다
     (열 폭발 방지 + 원 구조를 그 칸에서 그대로 복원 가능). 빈 객체({})는 사라지지 않도록 "{}" 로 남긴다. */
  function flattenObject(obj, prefix, out) {
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = obj[k];
      var fullKey = prefix ? prefix + "." + k : k;
      if (isPlainObject(v)) {
        var subKeys = Object.keys(v);
        if (subKeys.length === 0) out.push([fullKey, "{}"]);
        else flattenObject(v, fullKey, out);
      } else if (Array.isArray(v)) {
        out.push([fullKey, JSON.stringify(v)]);
      } else {
        out.push([fullKey, v]);
      }
    }
    return out;
  }

  // 배열의 원소 하나 → { obj: {평탄화된 key:value}, order: [최초 등장 순서의 key들] }
  function rowFromItem(item) {
    if (isPlainObject(item)) {
      var flat = flattenObject(item, "", []);
      var rowObj = {}, order = [];
      for (var i = 0; i < flat.length; i++) {
        var k = flat[i][0], v = flat[i][1];
        if (!Object.prototype.hasOwnProperty.call(rowObj, k)) order.push(k);
        rowObj[k] = v;
      }
      return { obj: rowObj, order: order };
    }
    if (Array.isArray(item)) return { obj: { value: JSON.stringify(item) }, order: ["value"] };
    return { obj: { value: item }, order: ["value"] }; // 문자열/숫자/불리언/null
  }

  function cellToString(v) {
    if (v === undefined || v === null) return "";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") return isFinite(v) ? String(v) : "";
    return String(v);
  }

  // RFC4180: 구분자·따옴표·개행이 있으면 따옴표로 감싸고 내부 따옴표는 두 배로.
  function quoteCell(s, delim) {
    if (s.indexOf(delim) !== -1 || s.indexOf('"') !== -1 || s.indexOf("\n") !== -1 || s.indexOf("\r") !== -1) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function buildCSV(items, delim) {
    var rows = items.map(rowFromItem);
    var headers = [], seen = {};
    for (var i = 0; i < rows.length; i++) {
      var order = rows[i].order;
      for (var j = 0; j < order.length; j++) {
        if (!Object.prototype.hasOwnProperty.call(seen, order[j])) {
          seen[order[j]] = true;
          headers.push(order[j]);
        }
      }
    }
    var lines = [headers.map(function (h) { return quoteCell(h, delim); }).join(delim)];
    for (i = 0; i < rows.length; i++) {
      var r = rows[i].obj;
      var line = headers.map(function (h) {
        var v = Object.prototype.hasOwnProperty.call(r, h) ? r[h] : undefined;
        return quoteCell(cellToString(v), delim);
      }).join(delim);
      lines.push(line);
    }
    return { csv: lines.join("\r\n"), rowCount: rows.length, colCount: headers.length };
  }

  // JSON.parse 에러 메시지에서 위치를 뽑아 line/col 로 환산 (V8: "position N", Firefox: "line N column N").
  function locateError(text, err) {
    var msg = err && err.message ? err.message : String(err);
    var pos = null;
    var m = /position (\d+)/i.exec(msg);
    if (m) pos = parseInt(m[1], 10);
    if (pos == null) {
      var m2 = /line (\d+)[^\d]+column (\d+)/i.exec(msg);
      if (m2) return { line: parseInt(m2[1], 10), col: parseInt(m2[2], 10), message: msg };
      return { line: null, col: null, message: msg };
    }
    var line = 1, lastNl = -1;
    for (var i = 0; i < pos && i < text.length; i++) {
      if (text.charCodeAt(i) === 10) { line++; lastNl = i; }
    }
    return { line: line, col: pos - lastNl, message: msg };
  }

  function lineText(text, line) {
    var lines = text.split(/\r\n|\r|\n/);
    var t = lines[line - 1];
    return t == null ? "" : t.replace(/\t/g, " ");
  }

  // 긴 줄은 컬럼 주변만 잘라 보여준다 (에디터의 잘라보기와 동일한 발상).
  function clipLine(text, col, max) {
    max = max || 160;
    if (text.length <= max) return { text: text, col: col };
    var start = Math.max(0, col - Math.floor(max / 2));
    if (start + max > text.length) start = Math.max(0, text.length - max);
    var clipped = text.slice(start, start + max);
    var prefix = start > 0 ? "… " : "";
    return { text: prefix + clipped + (start + max < text.length ? " …" : ""), col: col - start + prefix.length };
  }

  // 최종 판정: "empty" | "error" | "badShape" | "emptyArray" | "ok"
  function convert(text, delim) {
    if (text.replace(/^\s+|\s+$/g, "") === "") return { state: "empty" };
    var parsed;
    try { parsed = JSON.parse(text); }
    catch (err) { return { state: "error", error: locateError(text, err) }; }
    var items;
    if (Array.isArray(parsed)) items = parsed;
    else if (isPlainObject(parsed)) items = [parsed];
    else return { state: "badShape" };
    if (items.length === 0) return { state: "emptyArray" };
    var built = buildCSV(items, delim);
    return { state: "ok", csv: built.csv, rowCount: built.rowCount, colCount: built.colCount };
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      isPlainObject: isPlainObject, isPrimitive: isPrimitive, flattenObject: flattenObject,
      rowFromItem: rowFromItem, cellToString: cellToString, quoteCell: quoteCell,
      buildCSV: buildCSV, locateError: locateError, lineText: lineText, clipLine: clipLine,
      convert: convert
    };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "json-to-csv") + ":state";
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
  var inputEl = $("jtc-input"), delimEl = $("jtc-delim"), clearBtn = $("jtc-clear");
  var messageEl = $("jtc-message"), errorBox = $("jtc-error"), excerptEl = $("jtc-excerpt");
  var outputEl = $("jtc-output"), statsEl = $("jtc-stats");
  var actionsEl = $("jtc-actions"), copyBtn = $("jtc-copy"), downloadBtn = $("jtc-download"), feedbackEl = $("jtc-feedback");
  if (!inputEl || !outputEl || !delimEl) return;

  var customEl = $("jtc-custom"), customWrap = $("jtc-custom-wrap");
  var DELIM_MAP = { comma: ",", semicolon: ";", tab: "\t", pipe: "|" };
  var lastCSV = null;

  /* ---- 상태 저장/복원 ---- */
  function loadState() {
    try {
      var raw = localStorage.getItem(SKEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveState() {
    try {
      localStorage.setItem(SKEY, JSON.stringify({
        input: inputEl.value, delim: delimEl.value, custom: customEl ? customEl.value : ""
      }));
    }
    catch (e) { /* private mode */ }
  }

  /* ---- 렌더 상태 ---- */
  function setEmpty() {
    lastCSV = null;
    outputEl.value = "";
    statsEl.textContent = "";
    errorBox.hidden = true;
    actionsEl.hidden = true;
    messageEl.classList.remove("jtc-msg-error");
    messageEl.textContent = tr("tool.emptyHint", "Paste a JSON array of objects above to convert it to CSV.");
  }
  function setError(err) {
    lastCSV = null;
    outputEl.value = "";
    statsEl.textContent = "";
    actionsEl.hidden = true;
    messageEl.classList.add("jtc-msg-error");
    var msg;
    if (err.line != null && err.col != null) {
      msg = tr("tool.err.invalidJson", "Invalid JSON at line {line}, column {col}: {message}")
        .replace("{line}", fmt(err.line)).replace("{col}", fmt(err.col)).replace("{message}", err.message);
    } else {
      msg = tr("tool.err.invalidJsonPlain", "Invalid JSON: {message}").replace("{message}", err.message);
    }
    messageEl.textContent = msg;
    if (err.line != null) {
      var raw = lineText(inputEl.value, err.line);
      var clipped = clipLine(raw, err.col || 1, 160);
      var caret = "";
      for (var i = 1; i < clipped.col; i++) caret += " ";
      excerptEl.textContent = clipped.text + "\n" + caret + "^";
      errorBox.hidden = false;
    } else {
      errorBox.hidden = true;
    }
  }
  function setBadShape() {
    lastCSV = null;
    outputEl.value = "";
    statsEl.textContent = "";
    actionsEl.hidden = true;
    errorBox.hidden = true;
    messageEl.classList.add("jtc-msg-error");
    messageEl.textContent = tr("tool.err.badShape",
      "The top level of your JSON must be an array or an object so it can become table rows — a bare string, number, boolean or null can't be converted.");
  }
  function setEmptyArray() {
    lastCSV = null;
    outputEl.value = "";
    statsEl.textContent = "";
    actionsEl.hidden = true;
    errorBox.hidden = true;
    messageEl.classList.add("jtc-msg-error");
    messageEl.textContent = tr("tool.err.emptyArray", "The JSON array is empty — there is nothing to convert.");
  }
  function setOk(result) {
    lastCSV = result.csv;
    outputEl.value = result.csv;
    errorBox.hidden = true;
    actionsEl.hidden = false;
    messageEl.classList.remove("jtc-msg-error");
    messageEl.textContent = tr("tool.stats", "{rows} rows × {cols} columns")
      .replace("{rows}", fmt(result.rowCount)).replace("{cols}", fmt(result.colCount));
  }

  // 사용자 지정 구분자: 정확히 1글자, 따옴표·개행은 CSV 인용 규칙과 충돌하므로 금지
  function resolveDelim() {
    if (delimEl.value !== "custom") return DELIM_MAP[delimEl.value] || ",";
    var v = customEl ? customEl.value : "";
    if (v.length !== 1 || v === '"' || v === "\n" || v === "\r") return null;
    return v;
  }

  function setBadDelim() {
    lastCSV = null;
    outputEl.value = "";
    statsEl.textContent = "";
    actionsEl.hidden = true;
    errorBox.hidden = true;
    messageEl.classList.add("jtc-msg-error");
    messageEl.textContent = tr("tool.err.badDelim",
      "Enter a single custom delimiter character (it can't be a quote or a line break).");
  }

  function render() {
    if (customWrap) customWrap.hidden = (delimEl.value !== "custom");
    var delim = resolveDelim();
    if (delim === null) {
      if (inputEl.value.replace(/^\s+|\s+$/g, "") === "") setEmpty();
      else setBadDelim();
      saveState();
      return;
    }
    var result = convert(inputEl.value, delim);
    if (result.state === "empty") setEmpty();
    else if (result.state === "error") setError(result.error);
    else if (result.state === "badShape") setBadShape();
    else if (result.state === "emptyArray") setEmptyArray();
    else setOk(result);
    saveState();
  }

  /* ---- 복사 ---- */
  function legacyCopy(text, done) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch (e) { /* 복사 미지원 — 표시값은 그대로 남는다 (조용한 실패 아님) */ }
  }
  function copyText(text, done) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text, done); });
      } else {
        legacyCopy(text, done);
      }
    } catch (e) { legacyCopy(text, done); }
  }
  var feedbackTimer = null;
  function flashFeedback(text) {
    if (!feedbackEl) return;
    feedbackEl.textContent = text;
    feedbackEl.hidden = false;
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(function () { feedbackEl.hidden = true; }, 1600);
  }

  /* ---- 다운로드 (엑셀 한글/유니코드 깨짐 방지 UTF-8 BOM) ---- */
  function downloadCSV(csv) {
    var blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = (CFG.slug || "json-to-csv") + "-" + date + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---- 이벤트 ---- */
  inputEl.addEventListener("input", render);
  delimEl.addEventListener("change", function () {
    render();
    if (delimEl.value === "custom" && customEl) customEl.focus();
  });
  if (customEl) customEl.addEventListener("input", render);
  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      inputEl.value = "";
      render();
      inputEl.focus();
    });
  }
  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      if (!lastCSV) return;
      copyText(lastCSV, function () { flashFeedback(tr("tool.copied", "Copied")); });
    });
  }
  if (downloadBtn) {
    downloadBtn.addEventListener("click", function () {
      if (!lastCSV) return;
      downloadCSV(lastCSV);
      flashFeedback(tr("tool.downloaded", "Downloaded"));
    });
  }
  // 언어 전환 시 현재 상태를 새 언어 문구로 재렌더
  document.addEventListener("i18n:change", render);

  /* ---- 초기화: 저장된 입력 복원 ---- */
  var st = loadState();
  if (st) {
    if (typeof st.input === "string") inputEl.value = st.input;
    if (st.delim && (Object.prototype.hasOwnProperty.call(DELIM_MAP, st.delim) || st.delim === "custom")) delimEl.value = st.delim;
    if (customEl && typeof st.custom === "string") customEl.value = st.custom.slice(0, 1);
  }
  render();
  // TOOLJS:END
})();
