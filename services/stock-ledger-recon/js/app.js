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
  var SLUG = "stock-ledger-recon";
  var K_MAP = SLUG + ":map", K_SIGNED = SLUG + ":signed", K_PERIOD = SLUG + ":period";
  var K_FY = SLUG + ":fy", K_ENC = SLUG + ":enc", K_DATEFMT = SLUG + ":datefmt", K_NUMFMT = SLUG + ":numfmt";
  var BIG_BYTES = 5 * 1024 * 1024;   // 초과 시 원본 문자열 통짜 보유 금지 → 워커 스트리밍
  var WORKER_ROWS = 30000;           // 초과 시 Web Worker 로 이관
  var HUGE_ROWS = 200000;            // 초과 시 사용자 확인
  var SCAN_BYTES = 2 * 1024 * 1024;  // 날짜·숫자 형식 추론용 스캔 상한
  var PREVIEW_BYTES = 65536;
  var ROW_H = 38;
  var FIELDS = ["date", "sku", "type", "qty", "price", "unit", "warehouse", "doc", "name"];
  var REQUIRED = { date: 1, sku: 1, qty: 1 };

  /* ============================================================================
     ENGINE:START — 순수 계산부.
     DOM·클로저·모듈 상수를 일절 참조하지 않는다: 이 함수들은 toString() 으로 직렬화돼
     Web Worker 안에서 그대로 재구성되고, node 단위 테스트도 이 블록만 추출해 실행한다.
     ============================================================================ */

  /* Howard Hinnant 의 civil_from_days / days_from_civil (1970-01-01 = 0).
     Date 생성자를 쓰지 않는 이유: new Date("01/05/2026") 은 브라우저·OS 로케일마다
     다른 날짜로 조용히 읽힌다 — 이 도구 최대 사고 요인이라 산술로 못박는다. */
  function slrDaysFromCivil(y, m, d) {
    y -= m <= 2 ? 1 : 0;
    var era = Math.floor(y / 400);
    var yoe = y - era * 400;
    var mp = (m + 9) % 12;
    var doy = Math.floor((153 * mp + 2) / 5) + d - 1;
    var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }

  function slrCivilFromDays(z) {
    z += 719468;
    var era = Math.floor(z / 146097);
    var doe = z - era * 146097;
    var yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    var y = yoe + era * 400;
    var doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    var mp = Math.floor((5 * doy + 2) / 153);
    var d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    var m = mp + (mp < 10 ? 3 : -9);
    return { y: y + (m <= 2 ? 1 : 0), m: m, d: d };
  }

  function slrIsValidYmd(y, m, d) {
    if (!(y >= 1000 && y <= 9999) || m < 1 || m > 12 || d < 1) return false;
    var leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    var dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return d <= dim[m - 1];
  }

  function slrMkDate(y, m, d) {
    if (!slrIsValidYmd(y, m, d)) return null;
    return { y: y, m: m, d: d, day: slrDaysFromCivil(y, m, d) };
  }

  function slrPad2(n) { return (n < 10 ? "0" : "") + n; }
  function slrIsoOf(dt) { return dt.y + "-" + slrPad2(dt.m) + "-" + slrPad2(dt.d); }
  function slrIsoFromDay(z) { return slrIsoOf(slrCivilFromDays(z)); }

  /* Excel 1900 체계. serial 1 = 1900-01-01 이고 serial 60 은 실재하지 않는 1900-02-29
     (로터스 호환 버그) 이므로 serial >= 61 구간은 1899-12-30 기준 = 유닉스일 + 25569.
     검증: 45292 → 2024-01-01. (기획서의 45296 은 4일 어긋난 값이라 채택하지 않는다.) */
  function slrSerialToDate(n) {
    var c = slrCivilFromDays(Math.round(n) - 25569);
    return slrMkDate(c.y, c.m, c.d);
  }

  /* 개별 행이 스스로 형식을 증명하면(첫 필드 >12 등) 컬럼 모드보다 그 증거를 우선한다.
     덕분에 스캔 범위 밖의 행도 명백한 것은 언제나 옳게 읽힌다. */
  function slrParseDate(raw, mode) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return null;
    var m;
    m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s);
    if (m) return slrMkDate(+m[1], +m[2], +m[3]);
    m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    if (m) return slrMkDate(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(s);
    if (m) {
      var a = +m[1], b = +m[2], y = +m[3];
      if (a > 12 && b <= 12) return slrMkDate(y, b, a);
      if (b > 12 && a <= 12) return slrMkDate(y, a, b);
      return mode === "mdy" ? slrMkDate(y, a, b) : slrMkDate(y, b, a);
    }
    if (mode === "serial") {
      m = /^(\d{4,5})(?:\.0+)?$/.exec(s);
      if (m) { var n = +m[1]; if (n >= 20000 && n <= 60000) return slrSerialToDate(n); }
    }
    return null;
  }

  function slrScanDateFormat(values, localeOrder) {
    var iso = 0, compact = 0, slash = 0, serialish = 0, numeric = 0, nonEmpty = 0;
    var dmy = 0, mdy = 0, i, s, m;
    for (i = 0; i < values.length; i++) {
      s = String(values[i] == null ? "" : values[i]).trim();
      if (!s) continue;
      nonEmpty++;
      if (/^\d+(\.\d+)?$/.test(s)) numeric++;
      if (/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.test(s)) { iso++; continue; }
      if (/^\d{8}$/.test(s)) { compact++; continue; }
      m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(s);
      if (m) {
        slash++;
        if (+m[1] > 12 && +m[2] <= 12) dmy++;
        else if (+m[2] > 12 && +m[1] <= 12) mdy++;
        continue;
      }
      if (/^\d{4,5}$/.test(s) && +s >= 20000 && +s <= 60000) serialish++;
    }
    if (!nonEmpty) return { mode: "iso", ambiguous: false, source: "none", n: 0 };
    // 엑셀 일련번호는 "열의 과반이 숫자" 일 때만 채택 — 아니면 그냥 숫자 같은 코드일 뿐이다
    if (serialish > 0 && numeric * 2 > nonEmpty && serialish >= iso && serialish >= slash && serialish >= compact)
      return { mode: "serial", ambiguous: false, source: "scan", n: nonEmpty };
    if (slash > iso && slash > compact) {
      if (dmy && !mdy) return { mode: "dmy", ambiguous: false, source: "evidence", n: nonEmpty };
      if (mdy && !dmy) return { mode: "mdy", ambiguous: false, source: "evidence", n: nonEmpty };
      if (dmy && mdy) return { mode: dmy >= mdy ? "dmy" : "mdy", ambiguous: true, source: "conflict", n: nonEmpty };
      return { mode: localeOrder === "mdy" ? "mdy" : "dmy", ambiguous: true, source: "locale", n: nonEmpty };
    }
    return { mode: "iso", ambiguous: false, source: "scan", n: nonEmpty };
  }

  /* 1.234,56(DE) vs 1,234.56(US) — 컬럼 전량 투표. 마지막 구분자가 소수점이다. */
  function slrInferNumberFormat(values) {
    var de = 0, us = 0, i, s, lc, ld, p;
    for (i = 0; i < values.length; i++) {
      s = String(values[i] == null ? "" : values[i]).trim();
      if (!s) continue;
      s = s.replace(/[^\d.,]/g, "");
      if (!s) continue;
      lc = s.lastIndexOf(","); ld = s.lastIndexOf(".");
      if (lc > -1 && ld > -1) { if (lc > ld) de++; else us++; continue; }
      if (lc > -1) {
        p = s.split(",");
        if (p.length === 2 && p[1].length !== 3) de++;
        else if (p.length > 2) us++;
        continue;
      }
      if (ld > -1) {
        p = s.split(".");
        if (p.length === 2 && p[1].length !== 3) us++;
        else if (p.length > 2) de++;
      }
    }
    return { fmt: de > us ? "de" : "us", de: de, us: us, ambiguous: de > 0 && us > 0 };
  }

  function slrParseNumber(raw, fmt) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return null;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }        // 회계식 괄호 = 음수
    s = s.replace(/[\s\u00a0\u2009']/g, "");
    if (/^[\u2212\u2013\u2014]/.test(s)) { neg = !neg; s = s.slice(1); } // 유니코드 마이너스류
    s = s.replace(/[^\d.,+-]/g, "");                                    // 통화기호·단위 제거
    if (!s) return null;
    if (fmt === "de") s = s.replace(/\./g, "").replace(/,/g, ".");
    else s = s.replace(/,/g, "");
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
    var v = parseFloat(s);
    if (!isFinite(v)) return null;
    return neg ? -v : v;
  }

  function slrNormKey(v) {
    return String(v == null ? "" : v).trim().toLowerCase().replace(/[\s_\-().\/·]/g, "");
  }

  function slrClassifyType(v, inSet, outSet) {
    var s = String(v == null ? "" : v).trim();
    if (!s) return null;
    if (s === "+") return "in";
    if (s === "-" || s === "\u2212") return "out";
    var k = slrNormKey(s);
    if (!k) return null;
    if (inSet && inSet[k] === 1) return "in";
    if (outSet && outSet[k] === 1) return "out";
    return null;   // 추측 금지 — 사용자가 매핑할 때까지 장부에 넣지 않는다
  }

  /* ---- CSV/TSV 파서 (RFC4180: 따옴표·삽입 쉼표·삽입 개행·"" 이스케이프).
     청크 경계를 넘어 상태를 이어갈 수 있어야 5MB 초과 파일을 통짜로 들지 않고 스트리밍한다. */
  function slrCreateParser(delim) {
    return { delim: delim, row: [], field: "", inQ: false, atStart: true, pendQuote: false, cr: false };
  }

  function slrFeedParser(st, chunk, emit) {
    var i = 0, n = chunk.length, c;
    while (i < n) {
      c = chunk.charAt(i);
      if (st.pendQuote) {              // 직전 문자가 닫는 따옴표였다
        st.pendQuote = false;
        if (c === '"') { st.field += '"'; i++; continue; }   // "" → 리터럴 따옴표
        st.inQ = false;                                       // 인용 종료 후 아래로 흘려보냄
      }
      if (st.inQ) {
        if (c === '"') { st.pendQuote = true; i++; continue; }
        st.field += c; i++; continue;
      }
      if (st.cr) { st.cr = false; if (c === "\n") { i++; continue; } }  // CRLF 의 LF 흡수
      if (c === '"' && st.atStart) { st.inQ = true; st.atStart = false; i++; continue; }
      if (c === st.delim) { st.row.push(st.field); st.field = ""; st.atStart = true; i++; continue; }
      if (c === "\r" || c === "\n") {
        st.row.push(st.field); st.field = ""; st.atStart = true;
        emit(st.row); st.row = [];
        if (c === "\r") st.cr = true;
        i++; continue;
      }
      st.field += c; st.atStart = false; i++;
    }
  }

  function slrFinishParser(st, emit) {
    if (st.pendQuote) { st.pendQuote = false; st.inQ = false; }
    if (st.field !== "" || st.row.length) { st.row.push(st.field); emit(st.row); st.row = []; st.field = ""; }
  }

  function slrParseDelimited(text, delim) {
    var out = [];
    var st = slrCreateParser(delim);
    slrFeedParser(st, text, function (r) { out.push(r.slice()); });
    slrFinishParser(st, function (r) { out.push(r.slice()); });
    return out;
  }

  /* 구분자 추정: 후보별로 실제 파싱해 열 개수의 일관성을 본다 (따옴표 안 구분자에 속지 않는다). */
  function slrDetectDelimiter(sample) {
    var cands = [",", "\t", ";", "|"];
    var best = ",", bestScore = -1, i, j;
    for (i = 0; i < cands.length; i++) {
      var rows = slrParseDelimited(sample, cands[i]);
      if (rows.length > 12) rows = rows.slice(0, 12);
      if (!rows.length) continue;
      var counts = {}, mode = 0, modeN = 0, tot = 0;
      for (j = 0; j < rows.length; j++) {
        var c = rows[j].length;
        counts[c] = (counts[c] || 0) + 1; tot++;
        if (counts[c] > modeN) { modeN = counts[c]; mode = c; }
      }
      if (mode < 2) continue;
      var score = mode * (modeN / tot);
      if (score > bestScore) { bestScore = score; best = cands[i]; }
    }
    return best;
  }

  /* ---- 정규화: 더러운 행은 조용히 버리지 않고 사유와 함께 excluded 로 보낸다 (철칙 5). */
  function slrNewAcc() { return { recs: [], excluded: [], zeroQty: 0, rowIndex: 0 }; }

  function slrCell(r, idx) {
    return idx >= 0 && idx < r.length ? String(r[idx] == null ? "" : r[idx]).trim() : "";
  }

  function slrNormalizeRow(r, opts, acc) {
    var idx = acc.rowIndex++;
    if (opts.hasHeader && idx === 0) return;
    if (!r) return;
    var map = opts.map, j, blank = true;
    for (j = 0; j < r.length; j++) {
      if (String(r[j] == null ? "" : r[j]).trim() !== "") { blank = false; break; }
    }
    if (blank) return;                       // 완전 빈 행 = CSV 아티팩트. 제외 카운트에 넣지 않는다
    var rowNo = idx + 1;
    var sku = slrCell(r, map.sku);
    if (!sku) { acc.excluded.push({ row: rowNo, reason: "noSku", detail: "" }); return; }
    var dt = slrParseDate(slrCell(r, map.date), opts.dateMode);
    if (!dt) { acc.excluded.push({ row: rowNo, reason: "badDate", detail: slrCell(r, map.date) }); return; }
    var qv = slrParseNumber(slrCell(r, map.qty), opts.numFmt);
    if (qv === null) { acc.excluded.push({ row: rowNo, reason: "badQty", detail: slrCell(r, map.qty) }); return; }
    var dir;
    if (opts.signed) dir = "in";
    else {
      dir = slrClassifyType(slrCell(r, map.type), opts.inSet, opts.outSet);
      if (!dir) { acc.excluded.push({ row: rowNo, reason: "unmappedType", detail: slrCell(r, map.type) }); return; }
    }
    /* 음수 수량은 취소·역분개다. Math.abs 로 뭉개면 잔고가 조용히 틀리므로 방향을 뒤집어 부호를 보존한다. */
    var qty = qv;
    if (qty < 0) { dir = dir === "in" ? "out" : "in"; qty = -qty; }
    if (qty === 0) acc.zeroQty++;
    acc.recs.push({
      row: rowNo, day: dt.day, date: slrIsoOf(dt), sku: sku,
      unit: slrCell(r, map.unit), wh: slrCell(r, map.warehouse),
      doc: slrCell(r, map.doc), name: slrCell(r, map.name),
      price: map.price >= 0 ? slrParseNumber(slrCell(r, map.price), opts.numFmt) : null,
      dir: dir, qty: qty, seq: acc.recs.length, bal: null, oop: null
    });
  }

  function slrNormalizeRows(rows, opts, acc, onProgress) {
    var tick = Math.max(2000, Math.floor(rows.length / 40));
    for (var i = 0; i < rows.length; i++) {
      slrNormalizeRow(rows[i], opts, acc);
      if (onProgress && i % tick === 0) onProgress(Math.round((i / (rows.length || 1)) * 65));
    }
  }

  function slrLookup(tbl, key, sku) {
    if (!tbl) return null;
    if (tbl.full && tbl.full[key] != null) return tbl.full[key];
    if (tbl.bySku && tbl.bySku[sku] != null) return tbl.bySku[sku];
    return null;
  }

  /* ---- 집계: 그룹 = SKU + 창고 + 단위 (단위 자동 환산 금지 — 환산율 추측은 잔고를 조용히 망친다) */
  function slrAggregate(acc, opts, onProgress) {
    var recs = acc.recs, i, j, g, key;
    var startDay = opts.startDay, endDay = opts.endDay, todayDay = opts.todayDay;
    var groups = {}, order = [];
    for (i = 0; i < recs.length; i++) {
      var rec = recs[i];
      key = rec.sku + "\u0001" + rec.wh + "\u0001" + rec.unit;
      g = groups[key];
      if (!g) { g = groups[key] = { key: key, sku: rec.sku, wh: rec.wh, unit: rec.unit, name: rec.name, recs: [] }; order.push(key); }
      if (!g.name && rec.name) g.name = rec.name;
      g.recs.push(rec);
    }
    if (onProgress) onProgress(72);

    var summary = [], alerts = [], anyZeroOpening = false, anyDerived = false, beforeCount = 0, negatives = 0;
    for (i = 0; i < order.length; i++) {
      g = groups[order[i]];
      // 일자 오름차순 + 동일 일자는 원본 행 순서 유지 (안정 정렬을 seq 로 못박는다)
      g.recs.sort(function (a, b) { return a.day - b.day || a.seq - b.seq; });

      var openVal = slrLookup(opts.opening, g.key, g.sku);
      var opening = 0, openSrc;
      if (openVal !== null) {
        opening = openVal; openSrc = "csv";       // 기초CSV 가 있으면 시작일 이전 거래는 이미 반영된 것 → 재생하지 않는다
      } else {
        var pre = 0, hasPre = false;
        for (j = 0; j < g.recs.length; j++) {
          if (g.recs[j].day < startDay) { pre += g.recs[j].dir === "in" ? g.recs[j].qty : -g.recs[j].qty; hasPre = true; }
        }
        if (hasPre) { opening = pre; openSrc = "derived"; anyDerived = true; }
        else { opening = 0; openSrc = "zero"; anyZeroOpening = true; }
      }

      var bal = opening, pIn = 0, pOut = 0, firstNeg = null, lastInPrice = null;
      for (j = 0; j < g.recs.length; j++) {
        var rc = g.recs[j];
        if (rc.day < startDay) { rc.oop = "before"; beforeCount++; continue; }
        if (rc.day > endDay) { rc.oop = "after"; continue; }
        if (rc.dir === "in") { bal += rc.qty; pIn += rc.qty; if (rc.price != null) lastInPrice = rc.price; }
        else { bal -= rc.qty; pOut += rc.qty; }
        rc.bal = bal;
        if (bal < 0 && !firstNeg) firstNeg = rc;
      }
      g.opening = opening; g.openSrc = openSrc; g.pIn = pIn; g.pOut = pOut;
      g.closing = bal; g.lastInPrice = lastInPrice;
      summary.push(g);

      if (firstNeg) {
        negatives++;
        alerts.push({ kind: "negative", rank: 0, sku: g.sku, wh: g.wh, unit: g.unit, row: String(firstNeg.row), date: firstNeg.date, num: firstNeg.bal });
      } else if (bal < 0) {
        negatives++;
        alerts.push({ kind: "closingNegative", rank: 0, sku: g.sku, wh: g.wh, unit: g.unit, row: "", date: "", num: bal });
      }
    }

    // 기간 밖·미래 일자. 시작일 이전 행은 이상이 아니라 기초 역산의 재료이므로 경고하지 않는다.
    for (i = 0; i < recs.length; i++) {
      var r2 = recs[i];
      if (r2.day > todayDay) alerts.push({ kind: "future", rank: 2, sku: r2.sku, row: String(r2.row), date: r2.date, num: null });
      else if (r2.oop === "after") alerts.push({ kind: "after", rank: 2, sku: r2.sku, row: String(r2.row), date: r2.date, num: null });
    }

    // 동일 전표번호 + SKU + 방향 + 수량 = 중복 계상 의심
    var dup = {}, dupOrder = [];
    for (i = 0; i < recs.length; i++) {
      var r3 = recs[i];
      if (!r3.doc) continue;
      var dk = r3.doc + "\u0001" + r3.sku + "\u0001" + r3.dir + "\u0001" + r3.qty;
      if (!dup[dk]) { dup[dk] = { doc: r3.doc, sku: r3.sku, qty: r3.qty, rows: [] }; dupOrder.push(dk); }
      dup[dk].rows.push(r3.row);
    }
    for (i = 0; i < dupOrder.length; i++) {
      var dp = dup[dupOrder[i]];
      if (dp.rows.length > 1) {
        alerts.push({ kind: "duplicate", rank: 1, sku: dp.sku, doc: dp.doc, num: dp.qty, count: dp.rows.length, row: dp.rows.join(", "), date: "" });
      }
    }

    // 단위 혼재 — 환산율을 추측하지 않고 알린다
    var uBySku = {}, skuOrder = [];
    for (i = 0; i < recs.length; i++) {
      var r4 = recs[i];
      if (!uBySku[r4.sku]) { uBySku[r4.sku] = {}; skuOrder.push(r4.sku); }
      uBySku[r4.sku][r4.unit] = 1;
    }
    for (i = 0; i < skuOrder.length; i++) {
      var us = [];
      for (var u in uBySku[skuOrder[i]]) { if (uBySku[skuOrder[i]].hasOwnProperty(u)) us.push(u); }
      if (us.length > 1) alerts.push({ kind: "mixedUnit", rank: 1, sku: skuOrder[i], units: us, row: "", date: "", num: null });
    }
    alerts.sort(function (a, b) { return a.rank - b.rank; });
    if (onProgress) onProgress(88);

    // 실사 대사
    var variance = [], nonZeroVar = 0;
    if (opts.count) {
      var seen = {};
      for (i = 0; i < summary.length; i++) {
        g = summary[i];
        var cv = slrLookup(opts.count, g.key, g.sku);
        if (cv === null) continue;
        seen[g.key] = 1; seen["s\u0001" + g.sku] = 1;
        var vq = cv - g.closing;
        if (vq !== 0) nonZeroVar++;
        variance.push({
          sku: g.sku, name: g.name, wh: g.wh, unit: g.unit, counted: cv, closing: g.closing, varQty: vq,
          price: g.lastInPrice, varAmt: g.lastInPrice != null ? vq * g.lastInPrice : null, extra: false
        });
      }
      // 실사에는 있는데 장부에 아예 없는 SKU — 빼먹으면 '재고 차이 원인' 을 통째로 놓친다
      var co = (opts.count.order || []);
      for (i = 0; i < co.length; i++) {
        var e = co[i];
        if (seen[e.key] || seen["s\u0001" + e.sku]) continue;
        if (e.qty !== 0) nonZeroVar++;
        variance.push({
          sku: e.sku, name: "", wh: e.wh, unit: e.unit, counted: e.qty, closing: 0, varQty: e.qty,
          price: null, varAmt: null, extra: true
        });
      }
      // |차이금액| 내림차순 → 금액을 못 매기면 |차이수량|. 차이 0 은 맨 뒤.
      variance.sort(function (a, b) {
        var az = a.varQty === 0 ? 1 : 0, bz = b.varQty === 0 ? 1 : 0;
        if (az !== bz) return az - bz;
        var aa = a.varAmt == null ? null : Math.abs(a.varAmt);
        var bb = b.varAmt == null ? null : Math.abs(b.varAmt);
        if (aa != null && bb != null && aa !== bb) return bb - aa;
        if (aa != null && bb == null) return -1;
        if (aa == null && bb != null) return 1;
        return Math.abs(b.varQty) - Math.abs(a.varQty);
      });
    }

    summary.sort(function (a, b) {
      if (a.sku !== b.sku) return a.sku < b.sku ? -1 : 1;
      if (a.wh !== b.wh) return a.wh < b.wh ? -1 : 1;
      if (a.unit !== b.unit) return a.unit < b.unit ? -1 : 1;
      return 0;
    });
    if (onProgress) onProgress(100);

    return {
      groups: summary, alerts: alerts, excluded: acc.excluded, variance: variance,
      stats: {
        txns: recs.length, excluded: acc.excluded.length, zeroQty: acc.zeroQty, before: beforeCount,
        groups: summary.length, skus: skuOrder.length, negatives: negatives,
        anyZeroOpening: anyZeroOpening, anyDerived: anyDerived,
        hasCount: !!opts.count, nonZeroVar: nonZeroVar
      }
    };
  }

  function slrBuildLedger(rows, opts, onProgress) {
    var acc = slrNewAcc();
    slrNormalizeRows(rows, opts, acc, onProgress);
    return slrAggregate(acc, opts, onProgress);
  }

  /* ENGINE:END */

  var SLR_ENGINE = [
    slrDaysFromCivil, slrCivilFromDays, slrIsValidYmd, slrMkDate, slrPad2, slrIsoOf, slrIsoFromDay,
    slrSerialToDate, slrParseDate, slrScanDateFormat, slrInferNumberFormat, slrParseNumber,
    slrNormKey, slrClassifyType, slrCreateParser, slrFeedParser, slrFinishParser, slrParseDelimited,
    slrDetectDelimiter, slrNewAcc, slrCell, slrNormalizeRow, slrNormalizeRows, slrLookup,
    slrAggregate, slrBuildLedger
  ];

  /* ---- 컬럼 헤더 자동 추정 (ko/ja/en 동의어). 메인 스레드 전용. */
  var SYNONYMS = {
    date: ["일자", "날짜", "거래일", "거래일자", "입출고일", "입출고일자", "전표일자", "日付", "取引日", "年月日", "date", "txndate", "transactiondate", "trandate", "movementdate", "postingdate"],
    sku: ["sku", "품목코드", "품번", "제품코드", "상품코드", "자재코드", "코드", "コード", "品番", "商品コード", "item", "itemcode", "itemno", "itemid", "partno", "partnumber", "productcode", "materialcode"],
    type: ["구분", "입출고", "입출고구분", "수불구분", "유형", "거래구분", "区分", "入出庫", "入出庫区分", "type", "inout", "direction", "movement", "movementtype", "transactiontype"],
    qty: ["수량", "입출고수량", "거래수량", "数量", "qty", "quantity", "count", "movementqty"],
    price: ["단가", "매입단가", "구매단가", "표준단가", "単価", "price", "unitprice", "unitcost", "cost"],
    unit: ["단위", "단위명", "재고단위", "単位", "unit", "uom", "unitofmeasure"],
    warehouse: ["창고", "창고명", "보관장소", "로케이션", "倉庫", "保管場所", "warehouse", "location", "site", "whs", "storage"],
    doc: ["전표번호", "전표no", "전표", "문서번호", "증빙번호", "伝票番号", "伝票no", "伝票", "doc", "docno", "document", "documentno", "voucher", "voucherno", "refno", "reference"],
    name: ["품명", "품목명", "제품명", "상품명", "자재명", "品名", "商品名", "name", "itemname", "description", "productname"]
  };

  var IN_WORDS = ["입고", "매입", "반입", "입", "수입", "입고량", "반품입고", "受入", "入庫", "仕入", "入", "in", "receipt", "received", "receive", "recv", "inbound", "purchase", "grn"];
  var OUT_WORDS = ["출고", "매출", "반출", "출", "불출", "출고량", "판매", "払出", "出庫", "売上", "出荷", "出", "out", "issue", "issued", "ship", "shipped", "shipment", "outbound", "sale", "sales", "delivery"];

  function toSet(list) { var s = {}, i; for (i = 0; i < list.length; i++) s[slrNormKey(list[i])] = 1; return s; }
  var IN_SET = toSet(IN_WORDS), OUT_SET = toSet(OUT_WORDS);

  function guessColumns(headers) {
    var map = {}, used = {}, f, i, h, syn, j;
    for (i = 0; i < FIELDS.length; i++) map[FIELDS[i]] = -1;
    var norm = [];
    for (i = 0; i < headers.length; i++) norm.push(slrNormKey(headers[i]));
    // 1차 완전일치 — "입출고수량" 이 type("입출고") 에 먼저 잡히는 사고를 막는다
    for (f = 0; f < FIELDS.length; f++) {
      syn = SYNONYMS[FIELDS[f]];
      for (i = 0; i < norm.length && map[FIELDS[f]] < 0; i++) {
        if (used[i] || !norm[i]) continue;
        for (j = 0; j < syn.length; j++) {
          if (norm[i] === slrNormKey(syn[j])) { map[FIELDS[f]] = i; used[i] = 1; break; }
        }
      }
    }
    // 2차 부분포함
    for (f = 0; f < FIELDS.length; f++) {
      if (map[FIELDS[f]] >= 0) continue;
      syn = SYNONYMS[FIELDS[f]];
      for (i = 0; i < norm.length && map[FIELDS[f]] < 0; i++) {
        if (used[i] || !norm[i]) continue;
        for (j = 0; j < syn.length; j++) {
          h = slrNormKey(syn[j]);
          if (h.length >= 2 && norm[i].indexOf(h) >= 0) { map[FIELDS[f]] = i; used[i] = 1; break; }
        }
      }
    }
    return map;
  }

  function looksLikeHeader(row, map) {
    if (!row || !row.length) return false;
    var known = 0, numeric = 0, i, c;
    for (i = 0; i < FIELDS.length; i++) if (map[FIELDS[i]] >= 0) known++;
    if (known >= 2) return true;
    for (i = 0; i < row.length; i++) {
      c = String(row[i] == null ? "" : row[i]).trim();
      if (c && /^[\d.,\-\/]+$/.test(c)) numeric++;
    }
    return numeric === 0;
  }

  function localeDateOrder() {
    try {
      var parts = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "numeric", day: "numeric" })
        .formatToParts(new Date(2000, 0, 2));
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === "month") return "mdy";
        if (parts[i].type === "day") return "dmy";
      }
    } catch (e) { /* Intl 미지원 구형 브라우저 */ }
    return "dmy";
  }

  function todayDay() {
    var d = new Date();
    return slrDaysFromCivil(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  /* ============================================================================
     UI
     ============================================================================ */
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    drop: $("slr-drop"), pick: $("slr-pick"), file: $("slr-file"), sample: $("slr-sample"),
    paste: $("slr-paste"), encBanner: $("slr-enc-banner"), encMsg: $("slr-enc-msg"), enc: $("slr-enc"),
    readBanner: $("slr-read-banner"), readMsg: $("slr-read-msg"), datefmt: $("slr-datefmt"), numfmt: $("slr-numfmt"),
    mapStep: $("slr-map-step"), map: $("slr-map"), signed: $("slr-signed"),
    prevHead: $("slr-prev-head"), prev: $("slr-prev"),
    typeStep: $("slr-type-step"), typemap: $("slr-typemap"),
    start: $("slr-start"), end: $("slr-end"), fy: $("slr-fy"),
    openPick: $("slr-open-pick"), openFile: $("slr-open-file"), openState: $("slr-open-state"),
    countPick: $("slr-count-pick"), countFile: $("slr-count-file"), countState: $("slr-count-state"),
    build: $("slr-build"), cancel: $("slr-cancel"), reset: $("slr-reset"),
    prog: $("slr-prog"), progBar: $("slr-prog-bar"),
    badges: $("slr-badges"), message: $("slr-message"), panel: $("slr-panel"), tabs: $("slr-tabs"),
    head: $("slr-head"), body: $("slr-body"), back: $("slr-back"), dl: $("slr-dl"), feedback: $("slr-feedback")
  };
  if (!els.drop || !els.build) return;   // TOOL 마크업이 없는 페이지

  var st = {
    text: "", file: null, delim: ",", encoding: "utf-8", garbled: false,
    headers: [], preview: [], hasHeader: true, map: null, signed: false,
    dateScan: null, numScan: null, typeValues: [], typeDecide: {},
    opening: null, count: null, openingName: "", countName: "",
    result: null, tab: "summary", drill: null, worker: null, busy: false
  };

  function t(key) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v == null ? key : v;
  }
  function tf(key, vars) {
    return String(t(key)).replace(/\{(\w+)\}/g, function (m, k) {
      return vars && vars[k] != null ? String(vars[k]) : m;
    });
  }
  var nf = null;
  function num(v) {
    if (v == null) return "";
    if (!nf) { try { nf = new Intl.NumberFormat(window.I18N && window.I18N.lang ? window.I18N.lang() : undefined, { maximumFractionDigits: 4 }); } catch (e) { nf = { format: String }; } }
    return nf.format(v);
  }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function dateMode() {
    var v = els.datefmt.value;
    if (v !== "auto") return v;
    return st.dateScan ? st.dateScan.mode : "iso";
  }
  function numFmt() {
    var v = els.numfmt.value;
    if (v !== "auto") return v;
    return st.numScan ? st.numScan.fmt : "us";
  }

  // ---- 인코딩: UTF-8 BOM → 대체문자(U+FFFD) 비율 >1% 면 euc-kr → shift_jis → windows-1252
  function decodeBuffer(buf, forced) {
    var bytes = new Uint8Array(buf);
    var hasBom = bytes.length > 2 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    var cands = forced && forced !== "auto" ? [forced] : (hasBom ? ["utf-8"] : ["utf-8", "euc-kr", "shift_jis", "windows-1252"]);
    var best = null, i;
    for (i = 0; i < cands.length; i++) {
      var text;
      try { text = new TextDecoder(cands[i], { fatal: false }).decode(buf); }
      catch (e) { continue; }                       // 브라우저가 그 인코딩을 모른다
      var bad = (text.match(/\ufffd/g) || []).length;
      var ratio = text.length ? bad / text.length : 0;
      if (!best || ratio < best.ratio) best = { enc: cands[i], text: text, ratio: ratio };
      if (ratio <= 0.01) break;
    }
    if (!best) return { enc: "utf-8", text: "", ratio: 1, garbled: true };
    best.text = best.text.replace(/^\ufeff/, "");
    best.garbled = best.ratio > 0.01;
    return best;
  }

  function readFileBuffer(file, bytes) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error || new Error("read")); };
      fr.readAsArrayBuffer(bytes ? file.slice(0, bytes) : file);
    });
  }

  function setStatus(msg, tone) {
    els.message.textContent = msg;
    els.message.removeAttribute("data-i18n");
    els.message.style.color = tone === "bad" ? "#b91c1c" : "";
  }

  // ---- 로그 텍스트 반영 (미리보기·매핑·형식 추론)
  function setText(text, encLabel, garbled) {
    st.text = text;
    st.file = null;
    st.encoding = encLabel || "utf-8";
    st.garbled = !!garbled;
    afterText();
  }

  function afterText() {
    var text = st.text;
    if (!text || !text.trim()) {
      st.headers = []; st.preview = []; st.dateScan = null; st.numScan = null;
      els.mapStep.hidden = true; els.typeStep.hidden = true; els.encBanner.hidden = true; els.readBanner.hidden = true;
      return;
    }
    var head = text.length > PREVIEW_BYTES ? text.slice(0, PREVIEW_BYTES) : text;
    st.delim = slrDetectDelimiter(head);
    var pv = slrParseDelimited(head, st.delim);
    if (text.length > PREVIEW_BYTES && pv.length > 1) pv.pop();   // 잘린 마지막 행은 버린다
    if (!pv.length) { setStatus(t("tool.noRows"), "bad"); return; }
    st.headers = pv[0].slice();
    st.map = guessColumns(st.headers);
    st.hasHeader = looksLikeHeader(st.headers, st.map);
    if (!st.hasHeader) {
      st.headers = [];
      for (var i = 0; i < pv[0].length; i++) st.headers.push(tf("tool.colN", { n: i + 1 }));
      st.map = guessColumns(pv[0]);   // 헤더가 없으면 추정도 무의미하지만 값 기반 추정을 남긴다
    }
    applySavedMapping();
    st.preview = pv.slice(st.hasHeader ? 1 : 0, (st.hasHeader ? 1 : 0) + 5);
    scanFormats();
    collectTypeValues();
    renderBanners();
    renderMapping();
    renderTypeMap();
    els.mapStep.hidden = false;
  }

  // 스캔 표본: 앞쪽 SCAN_BYTES 까지. 표본 밖이라도 자체 증명되는 행(첫 필드>12 등)은 항상 옳게 읽힌다.
  function scanRows() {
    var slice = st.text.length > SCAN_BYTES ? st.text.slice(0, SCAN_BYTES) : st.text;
    var rows = slrParseDelimited(slice, st.delim);
    if (st.text.length > SCAN_BYTES && rows.length > 1) rows.pop();
    return rows.slice(st.hasHeader ? 1 : 0);
  }

  function colValues(rows, idx) {
    var out = [], i;
    if (idx < 0) return out;
    for (i = 0; i < rows.length; i++) if (rows[i].length > idx) out.push(rows[i][idx]);
    return out;
  }

  function scanFormats() {
    var rows = scanRows();
    st.scanRows = rows;
    st.dateScan = slrScanDateFormat(colValues(rows, st.map.date), localeDateOrder());
    var nvals = colValues(rows, st.map.qty).concat(colValues(rows, st.map.price));
    st.numScan = slrInferNumberFormat(nvals);
  }

  function collectTypeValues() {
    st.typeValues = [];
    if (st.signed || st.map.type < 0 || !st.scanRows) return;
    var seen = {}, i, v, k;
    for (i = 0; i < st.scanRows.length; i++) {
      v = slrCell(st.scanRows[i], st.map.type);
      if (!v) continue;
      k = slrNormKey(v);
      if (!k || seen[k]) continue;
      seen[k] = 1;
      if (slrClassifyType(v, IN_SET, OUT_SET)) continue;   // 이미 아는 값
      st.typeValues.push(v);
      if (st.typeValues.length >= 40) break;
    }
  }

  function renderBanners() {
    if (st.garbled) {
      els.encBanner.hidden = false;
      els.encBanner.className = "slr-banner slr-warn";
      els.encMsg.textContent = t("tool.encGarbled");
    } else if (st.encoding && st.encoding !== "utf-8") {
      els.encBanner.hidden = false;
      els.encBanner.className = "slr-banner";
      els.encMsg.textContent = tf("tool.encDetected", { enc: st.encoding.toUpperCase() });
    } else {
      els.encBanner.hidden = false;
      els.encBanner.className = "slr-banner";
      els.encMsg.textContent = tf("tool.encDetected", { enc: "UTF-8" });
    }

    var dm = dateMode();
    var label = dm === "serial" ? t("tool.dateFmtSerial") : dm === "iso" ? "YYYY-MM-DD" : dm === "mdy" ? "MM/DD/YYYY" : "DD/MM/YYYY";
    var msg = tf("tool.readingDates", { fmt: label });
    if (st.dateScan && st.dateScan.ambiguous && els.datefmt.value === "auto") {
      msg += " — " + (st.dateScan.source === "locale" ? t("tool.dateFromLocale") : t("tool.dateConflict"));
    }
    msg += " · " + tf("tool.readingNumbers", { fmt: numFmt() === "de" ? "1.234,56" : "1,234.56" });
    els.readBanner.hidden = false;
    els.readBanner.className = "slr-banner" + (st.dateScan && st.dateScan.ambiguous && els.datefmt.value === "auto" ? " slr-warn" : "");
    els.readMsg.innerHTML = "";
    els.readMsg.appendChild(document.createTextNode(msg));
  }

  function renderMapping() {
    els.map.innerHTML = "";
    var i, f;
    for (i = 0; i < FIELDS.length; i++) {
      f = FIELDS[i];
      if (st.signed && f === "type") continue;
      var wrap = document.createElement("div");
      var lab = document.createElement("label");
      lab.setAttribute("for", "slr-m-" + f);
      lab.textContent = t("tool.col_" + f);
      if (REQUIRED[f] || (f === "type" && !st.signed)) {
        var star = document.createElement("span");
        star.className = "slr-req"; star.textContent = " *";
        lab.appendChild(star);
      }
      var sel = document.createElement("select");
      sel.id = "slr-m-" + f;
      sel.setAttribute("data-field", f);
      var none = document.createElement("option");
      none.value = "-1"; none.textContent = t("tool.colNone");
      sel.appendChild(none);
      for (var j = 0; j < st.headers.length; j++) {
        var o = document.createElement("option");
        o.value = String(j);
        o.textContent = st.headers[j] || tf("tool.colN", { n: j + 1 });
        sel.appendChild(o);
      }
      sel.value = String(st.map[f]);
      sel.addEventListener("change", onMapChange);
      wrap.appendChild(lab); wrap.appendChild(sel);
      els.map.appendChild(wrap);
    }
    renderPreview();
  }

  function onMapChange(e) {
    st.map[e.target.getAttribute("data-field")] = parseInt(e.target.value, 10);
    saveMapping();
    scanFormats();
    collectTypeValues();
    renderBanners();
    renderPreview();
    renderTypeMap();
  }

  function saveMapping() {
    var o = {}, i, f;
    for (i = 0; i < FIELDS.length; i++) {
      f = FIELDS[i];
      o[f] = st.map[f] >= 0 && st.headers[st.map[f]] ? st.headers[st.map[f]] : null;
    }
    store(K_MAP, JSON.stringify(o));   // 인덱스가 아니라 헤더 '이름' 을 저장해야 다음 파일에도 쓸모가 있다
  }

  function applySavedMapping() {
    var raw = load(K_MAP);
    if (!raw) return;
    var saved;
    try { saved = JSON.parse(raw); } catch (e) { return; }
    if (!saved || typeof saved !== "object") return;
    var i, f, j;
    for (i = 0; i < FIELDS.length; i++) {
      f = FIELDS[i];
      if (!saved[f]) continue;
      for (j = 0; j < st.headers.length; j++) {
        if (st.headers[j] === saved[f]) { st.map[f] = j; break; }
      }
    }
  }

  function renderPreview() {
    var cols = [], i;
    for (i = 0; i < st.headers.length; i++) cols.push({ label: st.headers[i] || "", w: "minmax(90px,1fr)" });
    if (!cols.length) { els.prevHead.innerHTML = ""; els.prev.innerHTML = ""; return; }
    var tpl = cols.map(function (c) { return c.w; }).join(" ");
    els.prevHead.style.gridTemplateColumns = tpl;
    els.prevHead.innerHTML = "";
    for (i = 0; i < cols.length; i++) {
      var s = document.createElement("span");
      s.textContent = cols[i].label;
      els.prevHead.appendChild(s);
    }
    els.prev.innerHTML = "";
    if (!st.preview.length) {
      var em = document.createElement("div");
      em.className = "slr-empty"; em.textContent = t("tool.noRows");
      els.prev.appendChild(em);
      return;
    }
    for (i = 0; i < st.preview.length; i++) {
      var row = document.createElement("div");
      row.className = "slr-vt-row";
      row.style.gridTemplateColumns = tpl;
      for (var j = 0; j < cols.length; j++) {
        var c = document.createElement("span");
        c.className = "slr-cell";
        c.textContent = st.preview[i][j] == null ? "" : st.preview[i][j];
        row.appendChild(c);
      }
      els.prev.appendChild(row);
    }
  }

  function renderTypeMap() {
    els.typemap.innerHTML = "";
    if (st.signed || !st.typeValues.length) { els.typeStep.hidden = true; return; }
    els.typeStep.hidden = false;
    for (var i = 0; i < st.typeValues.length; i++) {
      (function (v) {
        var k = slrNormKey(v);
        var wrap = document.createElement("div");
        var lab = document.createElement("label");
        lab.setAttribute("for", "slr-t-" + i);
        lab.textContent = v;
        var sel = document.createElement("select");
        sel.id = "slr-t-" + i;
        [["", t("tool.markSkip")], ["in", t("tool.markIn")], ["out", t("tool.markOut")]].forEach(function (p) {
          var o = document.createElement("option");
          o.value = p[0]; o.textContent = p[1];
          sel.appendChild(o);
        });
        sel.value = st.typeDecide[k] || "";
        sel.addEventListener("change", function () {
          if (sel.value) st.typeDecide[k] = sel.value; else delete st.typeDecide[k];
        });
        wrap.appendChild(lab); wrap.appendChild(sel);
        els.typemap.appendChild(wrap);
      })(st.typeValues[i]);
    }
  }

  // ---- 기간 프리셋
  function fyStart() { return parseInt(els.fy.value, 10) || 1; }

  function setPeriod(sd, ed) {
    els.start.value = slrIsoFromDay(sd);
    els.end.value = slrIsoFromDay(ed);
    store(K_PERIOD, els.start.value + "|" + els.end.value);
  }

  function applyPreset(kind) {
    var d = new Date(), y = d.getFullYear(), m = d.getMonth() + 1;
    var s, e;
    if (kind === "thisMonth") {
      s = slrDaysFromCivil(y, m, 1); e = slrDaysFromCivil(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - 1;
    } else if (kind === "lastMonth") {
      e = slrDaysFromCivil(y, m, 1) - 1;
      var lm = slrCivilFromDays(e); s = slrDaysFromCivil(lm.y, lm.m, 1);
    } else if (kind === "quarter") {
      var qs = Math.floor((m - 1) / 3) * 3 + 1;
      s = slrDaysFromCivil(y, qs, 1);
      e = slrDaysFromCivil(qs + 3 > 12 ? y + 1 : y, qs + 3 > 12 ? qs + 3 - 12 : qs + 3, 1) - 1;
    } else if (kind === "fy") {
      var f = fyStart();
      var sy = m >= f ? y : y - 1;
      s = slrDaysFromCivil(sy, f, 1);
      e = slrDaysFromCivil(sy + 1, f, 1) - 1;
    } else {   // all — 데이터에 있는 전 기간
      s = slrDaysFromCivil(1900, 1, 1); e = slrDaysFromCivil(2999, 12, 31);
    }
    setPeriod(s, e);
  }

  function periodDays() {
    var sd = slrParseDate(els.start.value, "iso");
    var ed = slrParseDate(els.end.value, "iso");
    return {
      startDay: sd ? sd.day : slrDaysFromCivil(1900, 1, 1),
      endDay: ed ? ed.day : slrDaysFromCivil(2999, 12, 31)
    };
  }

  // ---- 기초/실사 보조 CSV
  function parseAuxCsv(text) {
    var delim = slrDetectDelimiter(text.slice(0, PREVIEW_BYTES));
    var rows = slrParseDelimited(text, delim);
    if (!rows.length) return null;
    var hdr = rows[0], map = guessColumns(hdr);
    var hasHdr = looksLikeHeader(hdr, map);
    var iSku = map.sku, iQty = map.qty, iUnit = map.unit, iWh = map.warehouse;
    if (iSku < 0) iSku = 0;
    if (iQty < 0) iQty = hdr.length > 1 ? hdr.length - 1 : 1;   // 관례: 마지막 열이 수량
    var fmt = slrInferNumberFormat(colValues(rows.slice(hasHdr ? 1 : 0), iQty)).fmt;
    var tbl = { full: {}, bySku: {}, order: [], rows: 0, skipped: 0 };
    for (var i = hasHdr ? 1 : 0; i < rows.length; i++) {
      var sku = slrCell(rows[i], iSku);
      if (!sku) { continue; }
      var q = slrParseNumber(slrCell(rows[i], iQty), fmt);
      if (q === null) { tbl.skipped++; continue; }
      var unit = iUnit >= 0 ? slrCell(rows[i], iUnit) : "";
      var wh = iWh >= 0 ? slrCell(rows[i], iWh) : "";
      var key = sku + "\u0001" + wh + "\u0001" + unit;
      tbl.full[key] = (tbl.full[key] || 0) + q;
      tbl.bySku[sku] = (tbl.bySku[sku] || 0) + q;
      tbl.order.push({ key: key, sku: sku, wh: wh, unit: unit, qty: q });
      tbl.rows++;
    }
    return tbl.rows ? tbl : null;
  }

  function loadAux(file, which) {
    var stateEl = which === "opening" ? els.openState : els.countState;
    stateEl.textContent = t("tool.reading");
    readFileBuffer(file).then(function (buf) {
      var dec = decodeBuffer(buf, els.enc.value);
      var tbl = parseAuxCsv(dec.text);
      if (!tbl) {
        st[which] = null;
        stateEl.textContent = t("tool.auxEmpty");
        return;
      }
      st[which] = tbl;
      st[which + "Name"] = file.name;
      stateEl.textContent = tf(which === "opening" ? "tool.openingLoaded" : "tool.countLoaded", { n: num(tbl.rows) })
        + (tbl.skipped ? " · " + tf("tool.auxSkipped", { n: num(tbl.skipped) }) : "");
    }).catch(function () {
      st[which] = null;
      stateEl.textContent = t("tool.fileError");
    });
  }

  // ---- 빌드
  function buildOpts() {
    var inSet = {}, outSet = {}, k;
    for (k in IN_SET) if (IN_SET.hasOwnProperty(k)) inSet[k] = 1;
    for (k in OUT_SET) if (OUT_SET.hasOwnProperty(k)) outSet[k] = 1;
    for (k in st.typeDecide) {
      if (!st.typeDecide.hasOwnProperty(k)) continue;
      if (st.typeDecide[k] === "in") inSet[k] = 1;
      else if (st.typeDecide[k] === "out") outSet[k] = 1;
    }
    var p = periodDays();
    return {
      map: st.map, hasHeader: st.hasHeader, signed: st.signed,
      dateMode: dateMode(), numFmt: numFmt(), inSet: inSet, outSet: outSet,
      startDay: p.startDay, endDay: p.endDay, todayDay: todayDay(),
      opening: st.opening, count: st.count
    };
  }

  function workerSource() {
    var src = '"use strict";\n';
    for (var i = 0; i < SLR_ENGINE.length; i++) src += SLR_ENGINE[i].toString() + "\n";
    src += [
      "self.onmessage=function(e){var d=e.data;try{",
      "if(d.mode==='file'){",
      "  var p=slrCreateParser(d.delim),acc=slrNewAcc();",
      "  var dec=new TextDecoder(d.encoding,{fatal:false}),fr=new FileReaderSync();",
      "  var CH=1048576,pos=0,size=d.file.size,first=true;",
      "  var emit=function(r){slrNormalizeRow(r,d.opts,acc);};",
      "  while(pos<size){",
      "    var buf=fr.readAsArrayBuffer(d.file.slice(pos,Math.min(pos+CH,size)));",
      "    var chunk=dec.decode(buf,{stream:true});",
      "    if(first){chunk=chunk.replace(/^\\ufeff/,'');first=false;}",
      "    slrFeedParser(p,chunk,emit);pos+=CH;",
      "    self.postMessage({type:'progress',pct:Math.round(pos/size*65)});",
      "  }",
      "  slrFeedParser(p,dec.decode(),emit);slrFinishParser(p,emit);",
      "  self.postMessage({type:'done',result:slrAggregate(acc,d.opts,function(x){self.postMessage({type:'progress',pct:65+Math.round(x*0.35)});})});",
      "  return;",
      "}",
      "var rows=slrParseDelimited(d.text,d.delim);",
      "self.postMessage({type:'done',result:slrBuildLedger(rows,d.opts,function(x){self.postMessage({type:'progress',pct:x});})});",
      "}catch(err){self.postMessage({type:'error',message:String((err&&err.message)||err)});}};"
    ].join("\n");
    return src;
  }

  function startWorker(msg) {
    var url;
    try {
      url = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
      st.worker = new Worker(url);
    } catch (e) {
      if (url) try { URL.revokeObjectURL(url); } catch (e2) { /* noop */ }
      return false;   // CSP·구형 브라우저 — 호출부가 메인스레드로 폴백한다
    }
    st.worker.onmessage = function (ev) {
      var d = ev.data;
      if (d.type === "progress") { setProgress(d.pct); return; }
      if (d.type === "error") { stopBusy(); setStatus(tf("tool.buildError", { msg: d.message }), "bad"); cleanupWorker(url); return; }
      if (d.type === "done") { stopBusy(); cleanupWorker(url); showResult(d.result); }
    };
    st.worker.onerror = function () {
      stopBusy(); cleanupWorker(url);
      setStatus(tf("tool.buildError", { msg: "worker" }), "bad");
    };
    st.worker.postMessage(msg);
    return true;
  }

  function cleanupWorker(url) {
    if (st.worker) { try { st.worker.terminate(); } catch (e) { /* noop */ } st.worker = null; }
    if (url) try { URL.revokeObjectURL(url); } catch (e) { /* noop */ }
  }

  function setProgress(p) {
    els.prog.hidden = false;
    els.progBar.style.width = Math.max(0, Math.min(100, p)) + "%";
  }
  function startBusy() {
    st.busy = true; els.build.disabled = true; els.cancel.hidden = false;
    setProgress(1);
    setStatus(t("tool.working"));
  }
  function stopBusy() {
    st.busy = false; els.build.disabled = false; els.cancel.hidden = true; els.prog.hidden = true;
  }

  function estimateRows() {
    if (st.file) return Math.round(st.file.size / 90);   // 대략 한 행 90바이트
    if (!st.text) return 0;
    var n = 0, i = 0;
    for (i = 0; i < st.text.length; i++) if (st.text.charCodeAt(i) === 10) n++;
    return n + 1;
  }

  function build() {
    if (st.busy) return;
    if ((!st.text || !st.text.trim()) && !st.file) { setStatus(t("tool.emptyInput"), "bad"); return; }
    if (!st.map || st.map.date < 0) { setStatus(tf("tool.needCol", { col: t("tool.col_date") }), "bad"); return; }
    if (st.map.sku < 0) { setStatus(tf("tool.needCol", { col: t("tool.col_sku") }), "bad"); return; }
    if (st.map.qty < 0) { setStatus(tf("tool.needCol", { col: t("tool.col_qty") }), "bad"); return; }
    if (!st.signed && st.map.type < 0) { setStatus(t("tool.needType"), "bad"); return; }

    var rows = estimateRows();
    if (rows > HUGE_ROWS && !window.confirm(tf("tool.hugeConfirm", { n: num(rows) }))) return;

    var opts = buildOpts();
    startBusy();

    // 5MB 초과 파일: 원본 문자열을 통짜로 들지 않고 워커가 청크로 읽어 정규화 레코드만 남긴다
    if (st.file && st.file.size > BIG_BYTES) {
      if (startWorker({ mode: "file", file: st.file, encoding: st.encoding, delim: st.delim, opts: opts })) return;
      setStatus(t("tool.workerFallback"));
    }
    if (rows > WORKER_ROWS && st.text) {
      if (startWorker({ mode: "text", text: st.text, delim: st.delim, opts: opts })) return;
    }
    // 메인스레드 폴백
    setTimeout(function () {
      try {
        var parsed = slrParseDelimited(st.text, st.delim);
        var res = slrBuildLedger(parsed, opts, setProgress);
        stopBusy();
        showResult(res);
      } catch (err) {
        stopBusy();
        setStatus(tf("tool.buildError", { msg: String((err && err.message) || err) }), "bad");
      }
    }, 16);
  }

  // ---- 결과
  function showResult(res) {
    st.result = res;
    st.drill = null;
    var s = res.stats;
    if (!s.txns) {
      els.panel.hidden = true;
      els.badges.hidden = true;
      setStatus(s.excluded ? tf("tool.noValidExcluded", { n: num(s.excluded) }) : t("tool.noValid"), "bad");
      if (s.excluded) { els.badges.hidden = false; renderBadges(res); els.panel.hidden = false; st.tab = "excluded"; renderTabs(); renderTable(); }
      return;
    }
    els.message.textContent = tf("tool.built", { txns: num(s.txns), groups: num(s.groups) });
    els.message.removeAttribute("data-i18n");
    els.message.style.color = "";
    els.badges.hidden = false;
    renderBadges(res);
    els.panel.hidden = false;
    if (!st.tab || (st.tab === "variance" && !s.hasCount)) st.tab = "summary";
    renderTabs();
    renderTable();
  }

  function badge(text, tone) {
    var b = document.createElement("span");
    b.className = "slr-badge" + (tone ? " slr-b-" + tone : "");
    b.textContent = text;
    return b;
  }

  function renderBadges(res) {
    var s = res.stats;
    els.badges.innerHTML = "";
    els.badges.appendChild(badge(tf("tool.badgeTxns", { n: num(s.txns) })));
    // '기초 0 가정' 은 접히지 않는 상시 배지 — 기말이 실재고인지 아닌지가 여기서 갈린다
    if (s.anyZeroOpening) els.badges.appendChild(badge(t("tool.badgeOpeningZero"), "warn"));
    if (s.anyDerived) els.badges.appendChild(badge(t("tool.badgeOpeningDerived")));
    if (st.opening) els.badges.appendChild(badge(t("tool.badgeOpeningCsv")));
    if (s.negatives) els.badges.appendChild(badge(tf("tool.badgeNegative", { n: num(s.negatives) }), "bad"));
    if (s.excluded) els.badges.appendChild(badge(tf("tool.badgeExcluded", { n: num(s.excluded) }), "warn"));
    if (s.zeroQty) els.badges.appendChild(badge(tf("tool.badgeZeroQty", { n: num(s.zeroQty) })));
    if (s.hasCount) els.badges.appendChild(badge(tf("tool.badgeVariance", { n: num(s.nonZeroVar) }), s.nonZeroVar ? "warn" : null));
  }

  function renderTabs() {
    var defs = [
      ["summary", tf("tool.tabSummary", { n: num(st.result.stats.groups) })],
      ["alerts", tf("tool.tabAlerts", { n: num(st.result.alerts.length) })],
      ["variance", tf("tool.tabVariance", { n: num(st.result.variance.length) })],
      ["excluded", tf("tool.tabExcluded", { n: num(st.result.excluded.length) })]
    ];
    els.tabs.innerHTML = "";
    for (var i = 0; i < defs.length; i++) {
      (function (d) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "slr-tab"; b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", st.tab === d[0] ? "true" : "false");
        b.textContent = d[1];
        b.addEventListener("click", function () { st.tab = d[0]; st.drill = null; renderTabs(); renderTable(); });
        els.tabs.appendChild(b);
      })(defs[i]);
    }
  }

  function mountTable(cols, count, buildRow) {
    var tpl = cols.map(function (c) { return c.w; }).join(" ");
    els.head.style.gridTemplateColumns = tpl;
    els.head.innerHTML = "";
    for (var i = 0; i < cols.length; i++) {
      var s = document.createElement("span");
      s.textContent = cols[i].label;
      if (cols[i].align === "end") s.className = "slr-num";
      els.head.appendChild(s);
    }
    els.body.onscroll = null;
    els.body.innerHTML = "";
    els.body.scrollTop = 0;
    if (!count) return false;
    if (count <= 150) {   // 소량은 통째 렌더 (가상 스크롤 오버헤드가 손해)
      for (var j = 0; j < count; j++) els.body.appendChild(buildRow(j, tpl));
      return true;
    }
    var spacer = document.createElement("div");
    spacer.style.cssText = "position:relative;height:" + (count * ROW_H) + "px;";
    var win = document.createElement("div");
    win.style.cssText = "position:absolute;left:0;right:0;top:0;";
    spacer.appendChild(win);
    els.body.appendChild(spacer);
    function paint() {
      var top = els.body.scrollTop, h = els.body.clientHeight || 360;
      var a = Math.max(0, Math.floor(top / ROW_H) - 5);
      var b = Math.min(count, Math.ceil((top + h) / ROW_H) + 5);
      win.style.top = (a * ROW_H) + "px";
      win.innerHTML = "";
      for (var k = a; k < b; k++) {
        var el = buildRow(k, tpl);
        el.style.height = ROW_H + "px";
        win.appendChild(el);
      }
    }
    els.body.onscroll = paint;
    paint();
    return true;
  }

  function rowEl(tpl, cells, cls) {
    var r = document.createElement("div");
    r.className = "slr-vt-row" + (cls ? " " + cls : "");
    r.style.gridTemplateColumns = tpl;
    for (var i = 0; i < cells.length; i++) {
      var c = document.createElement("span");
      c.className = "slr-cell" + (cells[i].num ? " slr-num" : "") + (cells[i].neg ? " slr-neg" : "");
      c.textContent = cells[i].v == null ? "" : String(cells[i].v);
      if (cells[i].title) c.title = cells[i].title;
      r.appendChild(c);
    }
    return r;
  }

  function emptyMsg(key) {
    var d = document.createElement("div");
    d.className = "slr-empty";
    d.textContent = t(key);
    els.body.appendChild(d);
  }

  function renderTable() {
    els.back.hidden = !st.drill;
    if (st.drill) return renderDrill();
    if (st.tab === "summary") return renderSummary();
    if (st.tab === "alerts") return renderAlerts();
    if (st.tab === "variance") return renderVariance();
    return renderExcluded();
  }

  function renderSummary() {
    var g = st.result.groups;
    var cols = [
      { label: t("tool.col_sku"), w: "minmax(110px,1.4fr)" },
      { label: t("tool.col_warehouse"), w: "minmax(70px,.8fr)" },
      { label: t("tool.col_unit"), w: "minmax(52px,.5fr)" },
      { label: t("tool.thOpening"), w: "minmax(72px,.8fr)", align: "end" },
      { label: t("tool.thIn"), w: "minmax(66px,.7fr)", align: "end" },
      { label: t("tool.thOut"), w: "minmax(66px,.7fr)", align: "end" },
      { label: t("tool.thClosing"), w: "minmax(78px,.9fr)", align: "end" }
    ];
    var ok = mountTable(cols, g.length, function (i, tpl) {
      var x = g[i];
      var r = rowEl(tpl, [
        { v: x.sku, title: x.name || x.sku },
        { v: x.wh || "—" },
        { v: x.unit || "—" },
        { v: num(x.opening) + (x.openSrc === "zero" ? " *" : ""), num: true, title: t("tool.openSrc_" + x.openSrc) },
        { v: num(x.pIn), num: true },
        { v: num(x.pOut), num: true },
        { v: num(x.closing), num: true, neg: x.closing < 0 }
      ], "slr-click");
      r.addEventListener("click", function () { st.drill = x; renderTable(); });
      return r;
    });
    if (!ok) emptyMsg("tool.noValid");
  }

  function renderDrill() {
    var x = st.drill;
    var recs = [];
    for (var i = 0; i < x.recs.length; i++) if (x.recs[i].oop !== "before") recs.push(x.recs[i]);
    var cols = [
      { label: t("tool.thRow"), w: "minmax(52px,.4fr)", align: "end" },
      { label: t("tool.col_date"), w: "minmax(92px,.9fr)" },
      { label: t("tool.col_doc"), w: "minmax(88px,.9fr)" },
      { label: t("tool.col_type"), w: "minmax(52px,.5fr)" },
      { label: t("tool.col_qty"), w: "minmax(66px,.7fr)", align: "end" },
      { label: t("tool.thBalance"), w: "minmax(78px,.9fr)", align: "end" }
    ];
    els.head.style.gridTemplateColumns = "";
    var ok = mountTable(cols, recs.length, function (i, tpl) {
      var r = recs[i];
      return rowEl(tpl, [
        { v: r.row, num: true },
        { v: r.date },
        { v: r.doc || "—" },
        { v: r.dir === "in" ? t("tool.markIn") : t("tool.markOut") },
        { v: num(r.qty), num: true },
        { v: r.oop === "after" ? t("tool.oopAfter") : num(r.bal), num: true, neg: r.bal != null && r.bal < 0 }
      ]);
    });
    if (!ok) emptyMsg("tool.noValid");
    els.message.textContent = tf("tool.drillOf", { sku: x.sku, wh: x.wh || "—", unit: x.unit || "—" });
    els.message.removeAttribute("data-i18n");
  }

  function alertText(a) {
    if (a.kind === "negative") return tf("tool.alertNegativeD", { date: a.date, bal: num(a.num) });
    if (a.kind === "closingNegative") return tf("tool.alertClosingNegD", { bal: num(a.num) });
    if (a.kind === "duplicate") return tf("tool.alertDuplicateD", { doc: a.doc, qty: num(a.num), n: num(a.count) });
    if (a.kind === "future") return t("tool.alertFutureD");
    if (a.kind === "after") return t("tool.alertAfterD");
    if (a.kind === "mixedUnit") {
      var u = a.units.map(function (x) { return x || t("tool.blankUnit"); }).join(" / ");
      return tf("tool.alertMixedUnitD", { units: u });
    }
    return "";
  }

  function renderAlerts() {
    var a = st.result.alerts;
    var cols = [
      { label: t("tool.thIssue"), w: "minmax(104px,.9fr)" },
      { label: t("tool.col_sku"), w: "minmax(94px,.9fr)" },
      { label: t("tool.thRow"), w: "minmax(60px,.5fr)" },
      { label: t("tool.thDetail"), w: "minmax(180px,2fr)" }
    ];
    var ok = mountTable(cols, a.length, function (i, tpl) {
      var x = a[i], txt = alertText(x);
      return rowEl(tpl, [
        { v: t("tool.alert_" + x.kind), neg: x.kind === "negative" || x.kind === "closingNegative" },
        { v: x.sku },
        { v: x.row || "—", num: true },
        { v: txt, title: txt }
      ]);
    });
    if (!ok) emptyMsg("tool.noAlerts");
  }

  function renderVariance() {
    if (!st.result.stats.hasCount) { mountTable([{ label: "", w: "1fr" }], 0, function () { }); emptyMsg("tool.noCount"); return; }
    var v = st.result.variance;
    var cols = [
      { label: t("tool.col_sku"), w: "minmax(104px,1.2fr)" },
      { label: t("tool.col_unit"), w: "minmax(50px,.45fr)" },
      { label: t("tool.thClosing"), w: "minmax(74px,.8fr)", align: "end" },
      { label: t("tool.thCounted"), w: "minmax(74px,.8fr)", align: "end" },
      { label: t("tool.thVarQty"), w: "minmax(74px,.8fr)", align: "end" },
      { label: t("tool.thVarAmt"), w: "minmax(86px,.9fr)", align: "end" }
    ];
    var ok = mountTable(cols, v.length, function (i, tpl) {
      var x = v[i];
      return rowEl(tpl, [
        { v: x.sku + (x.extra ? " ⚠" : ""), title: x.extra ? t("tool.varExtra") : (x.name || x.sku) },
        { v: x.unit || "—" },
        { v: num(x.closing), num: true, neg: x.closing < 0 },
        { v: num(x.counted), num: true },
        { v: (x.varQty > 0 ? "+" : "") + num(x.varQty), num: true, neg: x.varQty < 0 },
        // 단가가 없으면 0 원으로 위장하지 않는다 — 그러면 최대 문제가 목록 맨 밑으로 가라앉는다
        { v: x.varAmt == null ? t("tool.noPrice") : (x.varAmt > 0 ? "+" : "") + num(Math.round(x.varAmt * 100) / 100), num: true, neg: x.varAmt != null && x.varAmt < 0 }
      ]);
    });
    if (!ok) emptyMsg("tool.varianceNone");
  }

  function renderExcluded() {
    var e = st.result.excluded;
    var cols = [
      { label: t("tool.thRow"), w: "minmax(60px,.5fr)", align: "end" },
      { label: t("tool.thReason"), w: "minmax(150px,1.2fr)" },
      { label: t("tool.thValue"), w: "minmax(120px,1.4fr)" }
    ];
    var ok = mountTable(cols, e.length, function (i, tpl) {
      var x = e[i];
      return rowEl(tpl, [
        { v: x.row, num: true },
        { v: t("tool.exc_" + x.reason) },
        { v: x.detail || "—", title: x.detail || "" }
      ]);
    });
    if (!ok) emptyMsg("tool.noExcluded");
  }

  // ---- CSV 출력 (엑셀 한글 깨짐 방지용 UTF-8 BOM)
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n");
  }
  function download(name, text) {
    try {
      var blob = new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8;" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      flash(t("tool.downloaded"));
    } catch (e) {
      flash(t("tool.downloadError"));
    }
  }
  function flash(msg) {
    els.feedback.hidden = false;
    els.feedback.textContent = msg;
    setTimeout(function () { els.feedback.hidden = true; }, 2000);
  }

  function currentCsv() {
    var rows = [], i, x;
    if (st.drill) {
      rows.push([t("tool.thRow"), t("tool.col_date"), t("tool.col_doc"), t("tool.col_type"), t("tool.col_qty"), t("tool.thBalance")]);
      for (i = 0; i < st.drill.recs.length; i++) {
        x = st.drill.recs[i];
        if (x.oop === "before") continue;
        rows.push([x.row, x.date, x.doc, x.dir === "in" ? t("tool.markIn") : t("tool.markOut"), x.qty, x.bal == null ? "" : x.bal]);
      }
      return { name: "stock-ledger-" + st.drill.sku + ".csv", rows: rows };
    }
    if (st.tab === "summary") {
      rows.push([t("tool.col_sku"), t("tool.col_name"), t("tool.col_warehouse"), t("tool.col_unit"), t("tool.thOpening"), t("tool.thIn"), t("tool.thOut"), t("tool.thClosing"), t("tool.thOpeningSrc")]);
      for (i = 0; i < st.result.groups.length; i++) {
        x = st.result.groups[i];
        rows.push([x.sku, x.name, x.wh, x.unit, x.opening, x.pIn, x.pOut, x.closing, t("tool.openSrc_" + x.openSrc)]);
      }
      return { name: "stock-ledger-summary.csv", rows: rows };
    }
    if (st.tab === "alerts") {
      rows.push([t("tool.thIssue"), t("tool.col_sku"), t("tool.thRow"), t("tool.col_date"), t("tool.thDetail")]);
      for (i = 0; i < st.result.alerts.length; i++) {
        x = st.result.alerts[i];
        rows.push([t("tool.alert_" + x.kind), x.sku, x.row, x.date, alertText(x)]);
      }
      return { name: "stock-ledger-alerts.csv", rows: rows };
    }
    if (st.tab === "variance") {
      rows.push([t("tool.col_sku"), t("tool.col_name"), t("tool.col_warehouse"), t("tool.col_unit"), t("tool.thClosing"), t("tool.thCounted"), t("tool.thVarQty"), t("tool.col_price"), t("tool.thVarAmt")]);
      for (i = 0; i < st.result.variance.length; i++) {
        x = st.result.variance[i];
        rows.push([x.sku, x.name, x.wh, x.unit, x.closing, x.counted, x.varQty, x.price == null ? t("tool.noPrice") : x.price, x.varAmt == null ? t("tool.noPrice") : x.varAmt]);
      }
      return { name: "stock-ledger-variance.csv", rows: rows };
    }
    rows.push([t("tool.thRow"), t("tool.thReason"), t("tool.thValue")]);
    for (i = 0; i < st.result.excluded.length; i++) {
      x = st.result.excluded[i];
      rows.push([x.row, t("tool.exc_" + x.reason), x.detail]);
    }
    return { name: "stock-ledger-excluded.csv", rows: rows };
  }

  // ---- 샘플 데이터: 전월 마감 시나리오. 음수 잔고·중복 전표·단위 혼재·더러운 행·기간 밖을 모두 담는다.
  function sampleCsv() {
    var d = new Date();
    var firstThis = slrDaysFromCivil(d.getFullYear(), d.getMonth() + 1, 1);
    var lastEnd = firstThis - 1;
    var lm = slrCivilFromDays(lastEnd);
    var firstLast = slrDaysFromCivil(lm.y, lm.m, 1);
    function D(off) { return slrIsoFromDay(firstLast + off); }
    var rows = [
      ["일자", "품목코드", "품명", "구분", "수량", "단위", "창고", "전표번호", "단가"],
      [D(-6), "SKU-1001", "스테인리스 볼트, M6", "입고", "500", "EA", "본사창고", "PO-2601", "120"],
      [D(1), "SKU-1001", "스테인리스 볼트, M6", "출고", "180", "EA", "본사창고", "SO-2611", ""],
      [D(4), "SKU-1001", "스테인리스 볼트, M6", "입고", "300", "EA", "본사창고", "PO-2612", "125"],
      [D(9), "SKU-1001", "스테인리스 볼트, M6", "출고", "260", "EA", "본사창고", "SO-2620", ""],
      [D(3), "SKU-2002", "포장 테이프 (48mm x 40m)", "출고", "40", "EA", "본사창고", "SO-2614", ""],
      [D(11), "SKU-2002", "포장 테이프 (48mm x 40m)", "입고", "10", "BOX", "본사창고", "PO-2622", "18000"],
      [D(14), "SKU-3003", "라벨지 A4", "입고", "120", "EA", "제2창고", "PO-2630", "800"],
      [D(15), "SKU-3003", "라벨지 A4", "출고", "35", "EA", "제2창고", "SO-2631", ""],
      [D(15), "SKU-3003", "라벨지 A4", "출고", "35", "EA", "제2창고", "SO-2631", ""],
      [D(18), "SKU-3003", "라벨지 A4", "출고", "0", "EA", "제2창고", "SO-2635", ""],
      [D(20), "SKU-4004", "완충재 롤", "출고", "12", "EA", "제2창고", "SO-2640", ""],
      ["2026-13-45", "SKU-4004", "완충재 롤", "입고", "50", "EA", "제2창고", "PO-2641", "3000"],
      [D(22), "SKU-4004", "완충재 롤", "입고", "", "EA", "제2창고", "PO-2642", "3000"],
      [D(24), "", "이름 없는 항목", "입고", "5", "EA", "제2창고", "PO-2643", "1000"],
      [slrIsoFromDay(firstThis + 2), "SKU-1001", "스테인리스 볼트, M6", "출고", "40", "EA", "본사창고", "SO-2701", ""]
    ];
    return { text: toCsv(rows), start: firstLast, end: lastEnd };
  }

  function loadSample() {
    var s = sampleCsv();
    els.paste.value = s.text;
    els.enc.value = "auto"; els.datefmt.value = "auto"; els.numfmt.value = "auto";
    st.opening = null; st.count = null;
    els.openState.textContent = ""; els.countState.textContent = "";
    st.typeDecide = {};
    setText(s.text, "utf-8", false);
    setPeriod(s.start, s.end);
    setStatus(t("tool.sampleLoaded"));
  }

  function resetAll() {
    cleanupWorker();
    st.text = ""; st.file = null; st.result = null; st.drill = null;
    st.opening = null; st.count = null; st.typeDecide = {}; st.tab = "summary";
    els.paste.value = "";
    els.file.value = ""; els.openFile.value = ""; els.countFile.value = "";
    els.openState.textContent = ""; els.countState.textContent = "";
    els.panel.hidden = true; els.badges.hidden = true;
    els.mapStep.hidden = true; els.typeStep.hidden = true;
    els.encBanner.hidden = true; els.readBanner.hidden = true;
    els.message.textContent = t("tool.emptyHint");
    els.message.setAttribute("data-i18n", "tool.emptyHint");
    els.message.style.color = "";
    stopBusy();
  }

  // ---- 파일 로드
  function loadMainFile(file) {
    st.file = file;
    setStatus(t("tool.reading"));
    var big = file.size > BIG_BYTES;
    readFileBuffer(file, big ? 262144 : 0).then(function (buf) {
      var dec = decodeBuffer(buf, els.enc.value);
      if (big) {
        // 5MB 초과: 미리보기만 앞 256KB 로 만들고 원본 문자열은 들지 않는다 (빌드는 워커가 스트리밍)
        var head = dec.text;
        var cut = head.lastIndexOf("\n");
        st.text = cut > 0 ? head.slice(0, cut) : head;
        st.encoding = dec.enc; st.garbled = dec.garbled;
        afterText();
        st.file = file;
        setStatus(tf("tool.bigFile", { name: file.name, mb: (file.size / 1048576).toFixed(1) }));
      } else {
        setText(dec.text, dec.enc, dec.garbled);
        st.file = null;
        els.paste.value = dec.text.length > 200000 ? "" : dec.text;
        setStatus(tf("tool.fileLoaded", { name: file.name }));
      }
      if (els.enc.value === "auto" && dec.enc !== "utf-8") { /* 배너가 자동 감지 결과를 알린다 */ }
    }).catch(function () {
      st.file = null;
      setStatus(t("tool.fileError"), "bad");
    });
  }

  // ---- 이벤트 배선
  els.pick.addEventListener("click", function () { els.file.click(); });
  els.file.addEventListener("change", function () { if (els.file.files && els.file.files[0]) loadMainFile(els.file.files[0]); });
  els.sample.addEventListener("click", loadSample);
  els.openPick.addEventListener("click", function () { els.openFile.click(); });
  els.openFile.addEventListener("change", function () { if (els.openFile.files && els.openFile.files[0]) loadAux(els.openFile.files[0], "opening"); });
  els.countPick.addEventListener("click", function () { els.countFile.click(); });
  els.countFile.addEventListener("change", function () { if (els.countFile.files && els.countFile.files[0]) loadAux(els.countFile.files[0], "count"); });

  ["dragenter", "dragover"].forEach(function (ev) {
    els.drop.addEventListener(ev, function (e) { e.preventDefault(); els.drop.classList.add("slr-over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    els.drop.addEventListener(ev, function (e) { e.preventDefault(); els.drop.classList.remove("slr-over"); });
  });
  els.drop.addEventListener("drop", function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadMainFile(f);
  });

  var pasteTimer = null;
  els.paste.addEventListener("input", function () {
    clearTimeout(pasteTimer);
    pasteTimer = setTimeout(function () {
      var v = els.paste.value;
      if (!v.trim()) { resetAll(); return; }
      setText(v, "utf-8", false);
    }, 300);
  });

  els.enc.addEventListener("change", function () {
    store(K_ENC, els.enc.value);
    if (st.file || els.file.files && els.file.files[0]) {
      var f = st.file || els.file.files[0];
      loadMainFile(f);
    } else { renderBanners(); }
  });
  els.datefmt.addEventListener("change", function () {
    store(K_DATEFMT, els.datefmt.value);
    renderBanners(); renderPreview();
  });
  els.numfmt.addEventListener("change", function () {
    store(K_NUMFMT, els.numfmt.value);
    renderBanners(); renderPreview();
  });
  els.signed.addEventListener("change", function () {
    st.signed = els.signed.checked;
    store(K_SIGNED, st.signed ? "1" : "0");
    collectTypeValues(); renderMapping(); renderTypeMap();
  });
  els.fy.addEventListener("change", function () { store(K_FY, els.fy.value); });
  els.start.addEventListener("change", function () { store(K_PERIOD, els.start.value + "|" + els.end.value); });
  els.end.addEventListener("change", function () { store(K_PERIOD, els.start.value + "|" + els.end.value); });

  var presets = document.querySelectorAll("[data-preset]");
  for (var pi = 0; pi < presets.length; pi++) {
    (function (b) {
      b.addEventListener("click", function () { applyPreset(b.getAttribute("data-preset")); });
    })(presets[pi]);
  }

  els.build.addEventListener("click", build);
  els.cancel.addEventListener("click", function () {
    cleanupWorker(); stopBusy(); setStatus(t("tool.cancelled"));
  });
  els.reset.addEventListener("click", resetAll);
  els.back.addEventListener("click", function () { st.drill = null; els.message.textContent = tf("tool.built", { txns: num(st.result.stats.txns), groups: num(st.result.stats.groups) }); renderTable(); });
  els.dl.addEventListener("click", function () {
    if (!st.result) { flash(t("tool.dlNothing")); return; }
    var c = currentCsv();
    if (c.rows.length <= 1) { flash(t("tool.dlNothing")); return; }
    download(c.name, toCsv(c.rows));
  });

  // ---- 초기화
  (function init() {
    var i, o;
    for (i = 1; i <= 12; i++) {
      o = document.createElement("option");
      o.value = String(i);
      try {
        o.textContent = new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(2000, i - 1, 1));
      } catch (e) { o.textContent = String(i); }
      els.fy.appendChild(o);
    }
    els.fy.value = load(K_FY) || "1";
    var enc = load(K_ENC); if (enc) els.enc.value = enc;
    var df = load(K_DATEFMT); if (df) els.datefmt.value = df;
    var nf2 = load(K_NUMFMT); if (nf2) els.numfmt.value = nf2;
    st.signed = load(K_SIGNED) === "1";
    els.signed.checked = st.signed;
    var per = load(K_PERIOD);
    if (per && per.indexOf("|") > 0) {
      var p = per.split("|");
      els.start.value = p[0]; els.end.value = p[1];
    } else {
      applyPreset("lastMonth");
    }
    document.addEventListener("i18n:change", function () {
      nf = null;
      if (st.headers.length) { renderBanners(); renderMapping(); renderTypeMap(); }
      if (st.result) { renderBadges(st.result); renderTabs(); renderTable(); }
    });
    // 헤더-본문 가로 스크롤 동기 (B-3: 헤더 grid 가 뷰포트를 밀지 않도록 헤더도 스크롤러)
    [[els.prev, els.prevHead], [els.body, els.head]].forEach(function (pair) {
      if (!pair[0] || !pair[1]) return;
      pair[0].addEventListener("scroll", function () { pair[1].scrollLeft = pair[0].scrollLeft; });
    });
  })();
  // TOOLJS:END
})();
