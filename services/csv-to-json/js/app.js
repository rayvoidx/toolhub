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
  /* CSV to JSON Converter — 붙여넣거나 드롭한 CSV를 헤더 행 기준 객체 배열(또는 배열의 배열)로
     변환. 구분자(콤마·세미콜론·탭) 자동 감지, 따옴표 필드(콤마·줄바꿈·이스케이프 " 포함) 파싱은
     RFC4180 상태 기계로 직접 구현(외부 라이브러리 0). 숫자·불리언 타입 추론은 토글로 켜고 끌 수
     있다. 상태는 옵션(헤더 유무·타입 추론·구분자·출력 스타일)만 저장하고, 원문 CSV는 사업자
     연락처 등 민감 정보를 담을 수 있어 브라우저에도 남기지 않는다(ad-copy-limit-check 와 같은
     원칙). 모든 변환은 로컬에서 실행, 외부 API 없음. */

  var cfg = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "csv-to-json";
  var OPTS_KEY = SLUG + ":opts";

  var MAX_BYTES = 20 * 1024 * 1024;  // 이 이상은 CSV 로 취급하지 않는다 — 명시적 거부
  var BIG_BYTES = 5 * 1024 * 1024;   // 이 이상은 경고 후 진행
  var OUTPUT_CAP = 2000000;          // 출력 textarea 상한(문자) — 그 이상은 다운로드로 안내
  var SAFE_INT = 9007199254740991;   // Number.MAX_SAFE_INTEGER — 이보다 큰 정수는 정밀도 경고 대상

  function t(key, vars) {
    var s = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    if (s == null) s = key;
    if (vars) {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) s = s.split("{" + k + "}").join(String(vars[k]));
      }
    }
    return s;
  }

  /* ============================================================
     [parse] CSV — RFC4180 상태 기계 직접 구현.
     따옴표 안의 구분자·줄바꿈·이스케이프(""→") 를 전부 처리한다.
     따옴표는 필드의 첫 글자일 때만 인용 시작으로 인정 — 12" 피자처럼
     필드 중간의 큰따옴표는 그대로 문자로 남는다.
     ============================================================ */
  function parseCSV(text, delim) {
    var rows = [], row = [], field = "", i = 0, inQ = false, n = text.length, c;
    while (i < n) {
      c = text.charAt(i);
      if (inQ) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"' && field === "") { inQ = true; i++; continue; }
      if (c === delim) { row.push(field); field = ""; i++; continue; }
      if (c === "\n" || c === "\r") {
        if (c === "\r" && text.charAt(i + 1) === "\n") i++;
        row.push(field); rows.push(row); row = []; field = ""; i++; continue;
      }
      field += c; i++;
    }
    row.push(field); rows.push(row);
    // 완전히 빈 줄(트레일링 개행이 만든 마지막 빈 행 등)은 데이터가 아니다
    var out = [];
    for (i = 0; i < rows.length; i++) {
      var allEmpty = true;
      for (var j = 0; j < rows[i].length; j++) if (rows[i][j] !== "") { allEmpty = false; break; }
      if (!allEmpty) out.push(rows[i]);
    }
    return out;
  }

  /* ---- 구분자 자동 감지: 콤마·세미콜론·탭 후보 중 표본 줄에서 가장 일관되게(모든 줄에서
     같은 개수로) 나타나는 것을 고른다. 한 줄도 나오지 않는 후보는 제외. 아무 후보도 없으면
     콤마(CSV 기본값)로 폴백 — parseCSV 는 구분자가 안 보여도 한 줄=한 필드로 안전하게 동작한다. */
  function detectDelimiter(text) {
    var candidates = [",", ";", "\t"];
    var lines = text.split(/\r\n|\r|\n/), sample = [], i;
    for (i = 0; i < lines.length && sample.length < 8; i++) {
      if (lines[i].trim() !== "") sample.push(lines[i]);
    }
    if (!sample.length) return ",";
    var bestDelim = ",", bestScore = -1;
    for (var ci = 0; ci < candidates.length; ci++) {
      var d = candidates[ci], total = 0, minCount = Infinity, consistent = true, first = null;
      for (i = 0; i < sample.length; i++) {
        var cnt = sample[i].split(d).length - 1;
        total += cnt;
        if (first === null) first = cnt; else if (cnt !== first) consistent = false;
        if (cnt < minCount) minCount = cnt;
      }
      if (minCount <= 0) continue; // 표본 중 한 줄에서라도 안 보이면 후보 제외
      var score = (consistent ? 2 : 1) * total;
      if (score > bestScore) { bestScore = score; bestDelim = d; }
    }
    return bestDelim;
  }

  /* ============================================================
     [infer] 타입 추론 — 순수 문자열 → JS 값.
     - 빈 셀은 결측치로 보고 null (타입 추론이 꺼져 있으면 그대로 "").
     - "true"/"false"(대소문자 무관, 앞뒤 공백 없이 정확히 일치) → boolean.
     - 선행 0 없는 정수/소수(지수 표기 포함) → number. "007"·"01" 같은
       선행 0 값은 우편번호·사번처럼 자릿수 보존이 중요해 문자열로 남긴다.
     - 나머지는 원문 문자열 그대로 (따옴표 안 콤마 등은 이미 parseCSV 가 보존).
     ============================================================ */
  var RE_BOOL_TRUE = /^true$/i, RE_BOOL_FALSE = /^false$/i;
  var RE_NUM = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

  function convertValue(raw, typeInfer) {
    if (!typeInfer) return raw;
    if (raw === "") return null;
    if (RE_BOOL_TRUE.test(raw)) return true;
    if (RE_BOOL_FALSE.test(raw)) return false;
    if (RE_NUM.test(raw)) {
      var num = Number(raw);
      if (isFinite(num)) return num;
    }
    return raw;
  }

  // 정수부가 안전 정수 범위를 넘는 값 — JSON 숫자로 바꾸면 정밀도가 깨질 수 있다는 경고용
  function loosesPrecision(raw) {
    if (!RE_NUM.test(raw)) return false;
    var intPart = raw.replace(/^-/, "").split(".")[0].split(/[eE]/)[0];
    return intPart.length > 15 || Math.abs(Number(raw)) > SAFE_INT;
  }

  /* ============================================================
     [build] 행 배열 → 객체 배열(헤더 있음) 또는 배열의 배열(헤더 없음).
     - 중복 헤더명은 뒤에 _2, _3 … 을 붙여 유일하게 만든다(조용히 덮어쓰지 않는다).
     - 헤더보다 열이 적은 행은 빈 값(null/"")으로 채운다.
     - 헤더보다 열이 많은 행은 데이터를 버리지 않고 extra_1, extra_2 … 키로 보존한다.
     ============================================================ */
  function buildResult(rows, hasHeader, typeInfer) {
    var warnings = { ragged: 0, extraCols: 0, precision: 0, duplicateHeaders: 0 };
    if (!rows.length) return { data: hasHeader ? [] : [], columns: 0, warnings: warnings };

    if (!hasHeader) {
      var mode = 0, counts = {};
      for (var r0 = 0; r0 < rows.length; r0++) {
        var L = rows[r0].length;
        counts[L] = (counts[L] || 0) + 1;
        if (counts[L] > (counts[mode] || 0)) mode = L;
      }
      var arrData = [];
      for (var r1 = 0; r1 < rows.length; r1++) {
        if (rows[r1].length !== mode) warnings.ragged++;
        var line = [];
        for (var c1 = 0; c1 < rows[r1].length; c1++) {
          var val = rows[r1][c1];
          if (loosesPrecision(val)) warnings.precision++;
          line.push(convertValue(val, typeInfer));
        }
        arrData.push(line);
      }
      return { data: arrData, columns: mode, warnings: warnings };
    }

    var headerRow = rows[0], body = rows.slice(1);
    var seen = {}, headers = [];
    for (var i = 0; i < headerRow.length; i++) {
      var h = headerRow[i] === "" ? t("tool.col", { n: i + 1 }) : headerRow[i];
      var key = h;
      if (Object.prototype.hasOwnProperty.call(seen, h)) {
        seen[h]++; key = h + "_" + seen[h]; warnings.duplicateHeaders++;
      } else seen[h] = 1;
      headers.push(key);
    }

    var data = [];
    for (var r = 0; r < body.length; r++) {
      var row = body[r], obj = {};
      if (row.length !== headers.length) warnings.ragged++;
      for (var c = 0; c < headers.length; c++) {
        var raw = c < row.length ? row[c] : "";
        if (loosesPrecision(raw)) warnings.precision++;
        obj[headers[c]] = convertValue(raw, typeInfer);
      }
      if (row.length > headers.length) {
        for (var e = headers.length; e < row.length; e++) {
          warnings.extraCols++;
          if (loosesPrecision(row[e])) warnings.precision++;
          obj["extra_" + (e - headers.length + 1)] = convertValue(row[e], typeInfer);
        }
      }
      data.push(obj);
    }
    return { data: data, columns: headers.length, warnings: warnings };
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseCSV: parseCSV, detectDelimiter: detectDelimiter, convertValue: convertValue,
      buildResult: buildResult, loosesPrecision: loosesPrecision
    };
    return;
  }

  /* ---- DOM ---- */
  var $ = function (id) { return document.getElementById(id); };
  var inputEl = $("cj-input"), dropEl = $("cj-drop"), browseBtn = $("cj-browse"), fileEl = $("cj-file");
  var headerEl = $("cj-header"), typesEl = $("cj-types"), delimEl = $("cj-delim");
  var prettyBtn = $("cj-style-pretty"), minBtn = $("cj-style-min");
  var emptyEl = $("cj-empty"), outWrap = $("cj-out-wrap"), statsEl = $("cj-stats");
  var outputEl = $("cj-output"), copyBtn = $("cj-copy"), downloadBtn = $("cj-download"), sampleBtn = $("cj-sample");
  var notesEl = $("cj-notes"), msgEl = $("cj-message");
  if (!inputEl || !outputEl) return;

  var style = "pretty"; // "pretty" | "minified"
  var lastResult = null; // { data, columns, warnings, delim }
  var lastSourceName = null;

  /* ---- 옵션 저장/복원 — 원문 CSV 는 저장하지 않는다(민감정보 배제, ad-copy-limit-check 와 동일 원칙) ---- */
  var opts = { header: true, types: true, delim: "auto", style: "pretty" };
  try {
    var rawOpts = localStorage.getItem(OPTS_KEY);
    if (rawOpts) {
      var p = JSON.parse(rawOpts);
      if (p && typeof p === "object") {
        if (typeof p.header === "boolean") opts.header = p.header;
        if (typeof p.types === "boolean") opts.types = p.types;
        if (p.delim === "auto" || p.delim === "," || p.delim === ";" || p.delim === "\t") opts.delim = p.delim;
        if (p.style === "pretty" || p.style === "minified") opts.style = p.style;
      }
    }
  } catch (e) { /* private mode / 손상된 값 → 기본값 */ }
  style = opts.style;
  headerEl.checked = opts.header;
  typesEl.checked = opts.types;
  delimEl.value = opts.delim;

  function saveOpts() {
    try {
      localStorage.setItem(OPTS_KEY, JSON.stringify({
        header: headerEl.checked, types: typesEl.checked, delim: delimEl.value, style: style
      }));
    } catch (e) { /* noop */ }
  }

  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) { return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"; });
  }

  function setStyle(next) {
    style = next;
    prettyBtn.classList.toggle("is-on", style === "pretty");
    minBtn.classList.toggle("is-on", style === "minified");
    prettyBtn.setAttribute("aria-pressed", String(style === "pretty"));
    minBtn.setAttribute("aria-pressed", String(style === "minified"));
    saveOpts();
    renderOutput();
  }

  function delimLabel(d) {
    if (d === ",") return t("tool.delim.comma");
    if (d === ";") return t("tool.delim.semicolon");
    if (d === "\t") return t("tool.delim.tab");
    return d;
  }

  /* ---- 빈 입력/오류 안내 영역: data-i18n="tool.placeholder" 가 걸려 있어 언어 전환 시
     i18n.js 가 textContent 를 되돌린다 — 오류 메시지를 보여줄 때만 innerHTML 로 잠시 덮고,
     정상적인 "입력 없음" 상태로 돌아올 때는 항상 이 함수로 원래 안내문을 복원한다. ---- */
  function showEmptyPlaceholder() {
    emptyEl.innerHTML = esc(t("tool.placeholder"));
    emptyEl.hidden = false;
    outWrap.hidden = true;
    lastResult = null;
  }

  /* ---- 변환 + 렌더 ---- */
  function convert() {
    var text = inputEl.value;
    if (text.replace(/^﻿/, "").trim() === "") {
      showEmptyPlaceholder();
      return;
    }
    var clean = text.replace(/^﻿/, "");
    var delim = delimEl.value === "auto" ? detectDelimiter(clean) : delimEl.value;
    var rows = parseCSV(clean, delim);
    var built = buildResult(rows, headerEl.checked, typesEl.checked);
    lastResult = {
      data: built.data, columns: built.columns, rows: rows.length - (headerEl.checked ? 1 : 0),
      warnings: built.warnings, delim: delim
    };
    if (lastResult.rows < 0) lastResult.rows = 0;
    emptyEl.hidden = true;
    outWrap.hidden = false;
    renderOutput();
  }

  function renderOutput() {
    if (!lastResult) return;
    var json;
    try {
      json = style === "pretty" ? JSON.stringify(lastResult.data, null, 2) : JSON.stringify(lastResult.data);
    } catch (e) {
      // 순환 참조 등은 발생할 수 없는 구조지만(순수 리터럴만 생성), 방어적으로만 처리
      json = "";
    }
    if (json.length > OUTPUT_CAP) {
      outputEl.value = json.slice(0, OUTPUT_CAP);
      msgEl.hidden = false;
      msgEl.textContent = t("tool.msg.tooLongForBox");
    } else {
      outputEl.value = json;
      msgEl.hidden = true;
    }
    renderStats();
  }

  function renderStats() {
    var w = lastResult.warnings;
    statsEl.innerHTML =
      '<span class="cj-stat"><b>' + lastResult.rows + '</b> ' + esc(t("tool.stat.rows")) + '</span>' +
      '<span class="cj-stat"><b>' + lastResult.columns + '</b> ' + esc(t("tool.stat.columns")) + '</span>' +
      '<span class="cj-stat">' + esc(t("tool.stat.delim", { d: delimLabel(lastResult.delim) })) + '</span>';

    var notes = [];
    if (w.ragged > 0) notes.push(t("tool.note.ragged", { n: w.ragged }));
    if (w.extraCols > 0) notes.push(t("tool.note.extraCols", { n: w.extraCols }));
    if (w.duplicateHeaders > 0) notes.push(t("tool.note.dupHeaders", { n: w.duplicateHeaders }));
    if (w.precision > 0) notes.push(t("tool.note.precision", { n: w.precision }));
    if (notes.length) {
      var h = "";
      for (var i = 0; i < notes.length; i++) h += "<li>" + esc(notes[i]) + "</li>";
      notesEl.innerHTML = h;
      notesEl.hidden = false;
    } else {
      notesEl.hidden = true;
      notesEl.innerHTML = "";
    }
  }

  /* ---- 다운로드 파일명: 업로드한 파일명이 있으면 확장자만 .json 으로 바꾸고, 없으면 slug 사용 ---- */
  function downloadName() {
    if (lastSourceName) {
      var base = lastSourceName.replace(/\.[^./\\]+$/, "");
      return (base || SLUG) + ".json";
    }
    return SLUG + ".json";
  }

  /* ---- 복사/다운로드 ---- */
  function flash(btn, key) {
    var old = btn.textContent;
    btn.textContent = t(key);
    setTimeout(function () { btn.textContent = old; }, 1400);
  }
  copyBtn.addEventListener("click", function () {
    if (!lastResult) return;
    var text = style === "pretty" ? JSON.stringify(lastResult.data, null, 2) : JSON.stringify(lastResult.data);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash(copyBtn, "tool.copied"); },
        function () { flash(copyBtn, "tool.copyFail"); });
    } else {
      try {
        var ta = document.createElement("textarea");
        ta.value = text; ta.setAttribute("readonly", "");
        ta.style.position = "absolute"; ta.style.left = "-9999px";
        document.body.appendChild(ta); ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        flash(copyBtn, "tool.copied");
      } catch (e) { flash(copyBtn, "tool.copyFail"); }
    }
  });
  downloadBtn.addEventListener("click", function () {
    if (!lastResult) return;
    try {
      var text = style === "pretty" ? JSON.stringify(lastResult.data, null, 2) : JSON.stringify(lastResult.data);
      var blob = new Blob([text], { type: "application/json;charset=utf-8;" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = downloadName();
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    } catch (e) { flash(downloadBtn, "tool.copyFail"); }
  });

  /* ---- 샘플 데이터 ---- */
  sampleBtn.addEventListener("click", function () {
    lastSourceName = null;
    inputEl.value = t("tool.sample.data");
    convert();
  });

  /* ---- 파일 읽기 (드래그 앤 드롭 / 찾아보기) ---- */
  var BIN_SIG = [[0x50, 0x4B, 0x03, 0x04], [0x50, 0x4B, 0x05, 0x06], [0x25, 0x50, 0x44, 0x46],
                 [0xD0, 0xCF, 0x11, 0xE0], [0x1F, 0x8B]];
  function looksBinary(bytes) {
    for (var i = 0; i < BIN_SIG.length; i++) {
      var sig = BIN_SIG[i], hit = true;
      for (var j = 0; j < sig.length; j++) if (bytes[j] !== sig[j]) { hit = false; break; }
      if (hit) return true;
    }
    var scan = Math.min(bytes.length, 2048);
    for (var k = 0; k < scan; k++) if (bytes[k] === 0) return true; // NUL = 텍스트가 아니다
    return false;
  }
  function showError(key, vars) {
    emptyEl.hidden = false;
    emptyEl.innerHTML = "<b>" + esc(t(key, vars)) + "</b>";
    outWrap.hidden = true;
    lastResult = null;
  }
  function readFile(file) {
    if (!file) return;
    lastSourceName = file.name || null;
    if (file.size > MAX_BYTES) {
      showError("tool.err.tooBig", { mb: Math.round(file.size / 1048576) });
      return;
    }
    if (/\.(xlsx?|numbers|ods|pdf|zip|gz)$/i.test(file.name)) {
      showError("tool.err.binary");
      return;
    }
    var bigNote = file.size > BIG_BYTES;
    var fr = new FileReader();
    fr.onerror = function () { showError("tool.err.read"); };
    fr.onload = function () {
      try {
        var bytes = new Uint8Array(fr.result);
        if (looksBinary(bytes)) { showError("tool.err.binary"); return; }
        var text = null, usedFallback = false;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch (e1) {
          try { text = new TextDecoder("euc-kr").decode(bytes); usedFallback = true; }
          catch (e2) { showError("tool.err.encoding"); return; }
        }
        var hasNul = false; for (var ci = 0; ci < text.length && ci < 4096; ci++) { if (text.charCodeAt(ci) === 0) { hasNul = true; break; } }
        if (hasNul) { showError("tool.err.binary"); return; }
        inputEl.value = text;
        convert();
        if (bigNote || usedFallback) {
          msgEl.hidden = false;
          msgEl.textContent = usedFallback ? t("tool.msg.euckr") : t("tool.msg.bigFile", { mb: Math.round(file.size / 1048576) });
        }
      } catch (e) { showError("tool.err.read"); }
    };
    fr.readAsArrayBuffer(file);
  }

  browseBtn.addEventListener("click", function () { fileEl.click(); });
  fileEl.addEventListener("change", function () { if (fileEl.files && fileEl.files[0]) readFile(fileEl.files[0]); });
  ["dragenter", "dragover"].forEach(function (ev) {
    dropEl.addEventListener(ev, function (e) { e.preventDefault(); dropEl.classList.add("is-over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    dropEl.addEventListener(ev, function (e) { e.preventDefault(); dropEl.classList.remove("is-over"); });
  });
  dropEl.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
  });

  /* ---- 입력/옵션 이벤트 ---- */
  var debounceTimer = null;
  inputEl.addEventListener("input", function () {
    lastSourceName = null;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(convert, 120);
  });
  headerEl.addEventListener("change", function () { saveOpts(); convert(); });
  typesEl.addEventListener("change", function () { saveOpts(); convert(); });
  delimEl.addEventListener("change", function () { saveOpts(); convert(); });
  prettyBtn.addEventListener("click", function () { setStyle("pretty"); });
  minBtn.addEventListener("click", function () { setStyle("minified"); });

  document.addEventListener("i18n:change", function () {
    if (lastResult) { renderOutput(); }
  });

  setStyle(style);
  if (inputEl.value.trim() !== "") convert(); else showEmptyPlaceholder();

  // 계산 로직 자체 검증용 노출 (브라우저 콘솔/수동 테스트에서 사용, 정상 동작에는 영향 없음)
  window.__CSV2JSON = {
    parseCSV: parseCSV, detectDelimiter: detectDelimiter, convertValue: convertValue, buildResult: buildResult
  };
  // TOOLJS:END
})();
