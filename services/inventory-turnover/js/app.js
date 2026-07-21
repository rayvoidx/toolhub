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
  /* Inventory Turnover & Dead Stock Finder
     SKU 재고 CSV → SKU별 회전율·재고일수·묶인 금액·악성 판정. 외부 API·업로드 0 (pure-static).
     상태: localStorage "inventory-turnover:settings" (임계값·기준일수·모드·컬럼 매핑만 — 재고 원본은 저장 안 함).

     ── 아래 "순수 코어"는 DOM·전역을 일절 참조하지 않는다. 세 곳에서 같은 코드가 돈다:
        (1) 메인스레드 (2만 행 이하)  (2) Web Worker (2만 행 초과·10MB 초과 파일 — 함수를
        toString() 으로 직렬화해 Blob 워커를 만든다. 그래서 클로저 변수 금지)  (3) node 단위 테스트. */

  /* ---------- CSV/TSV 파서 (RFC4180 상태 기계, 외부 라이브러리 0) ----------
     청크 스트리밍 겸용: push() 를 여러 번 나눠 호출해도 따옴표 안의 콤마·개행이 보존된다. */
  function makeParser(delim) {
    var f = "";          // 현재 필드
    var row = [];        // 현재 행
    var state = 0;       // 0=비따옴표, 1=따옴표 안, 2=따옴표 안에서 " 를 본 직후
    var started = false; // 현재 행에 내용이 있었나 (빈 줄 판별)
    var lastCR = false;

    function endRow(onRow) {
      row.push(f); f = "";
      if (started || row.length > 1) onRow(row);   // 완전한 빈 줄은 행으로 세지 않는다
      row = []; started = false;
    }
    function push(chunk, onRow) {
      for (var i = 0; i < chunk.length; i++) {
        var c = chunk.charAt(i);
        if (state === 1) {                       // 따옴표 안 — 구분자·개행도 전부 문자
          if (c === '"') state = 2; else f += c;
          continue;
        }
        if (state === 2) {
          if (c === '"') { f += '"'; state = 1; continue; }   // "" → 리터럴 따옴표
          state = 0;                                          // 닫는 따옴표였다
        }
        if (lastCR) { lastCR = false; if (c === "\n") continue; }  // CRLF 는 한 번만
        if (c === '"' && f === "") { state = 1; started = true; continue; }
        if (c === delim) { row.push(f); f = ""; started = true; continue; }
        if (c === "\r") { lastCR = true; endRow(onRow); continue; }
        if (c === "\n") { endRow(onRow); continue; }
        f += c; started = true;
      }
    }
    function end(onRow) {
      if (started || f !== "" || row.length) endRow(onRow);
      state = 0;
    }
    return { push: push, end: end };
  }

  function parseDelimited(text, delim, limit) {
    var rows = [], stop = false;
    var p = makeParser(delim);
    var sink = function (r) { if (stop) return; rows.push(r); if (limit && rows.length >= limit) stop = true; };
    p.push(text, sink);
    p.end(sink);
    return rows;
  }

  /* ---------- 숫자 (자체 로케일 파서 — Intl 은 출력에만 쓴다) ----------
     "1,234.56"(dot) 과 "1.234,56"(comma) 를 오독하면 회전율이 1000배 틀어진다. */
  function parseNumber(raw, fmt) {
    if (raw == null) return NaN;
    var s = String(raw).trim();
    if (!s) return NaN;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }   // 회계식 괄호 음수
    s = s.replace(/[\s\u00a0\u202f']/g, "").replace(/[^\d.,+-]/g, "");  // 통화기호·단위·천단위 공백 제거
    if (s.charAt(0) === "+") s = s.slice(1);
    if (s.charAt(0) === "-") { neg = !neg; s = s.slice(1); }
    if (s.indexOf("-") !== -1) return NaN;      // 중간 하이픈 = 날짜·코드지 숫자가 아니다
    if (fmt === "comma") s = s.replace(/\./g, "").replace(/,/g, ".");
    else s = s.replace(/,/g, "");
    if (!/^\d+(\.\d+)?$|^\.\d+$|^\d+\.$/.test(s)) return NaN;
    var n = parseFloat(s);
    if (!isFinite(n)) return NaN;
    return neg ? -n : n;
  }

  function detectNumberFormat(samples) {
    var dot = 0, comma = 0;
    for (var i = 0; i < samples.length; i++) {
      var s = String(samples[i] == null ? "" : samples[i]).trim().replace(/[\s\u00a0']/g, "");
      if (!s || !/^[-+(]?\d[\d.,]*\)?$/.test(s)) continue;
      s = s.replace(/^[-+(]/, "").replace(/\)$/, "");
      var hasD = s.indexOf(".") !== -1, hasC = s.indexOf(",") !== -1;
      if (hasD && hasC) {                                   // 둘 다 있으면 뒤에 오는 쪽이 소수점 (확실)
        if (s.lastIndexOf(".") > s.lastIndexOf(",")) dot += 3; else comma += 3;
      } else if (hasC) {
        if (/^\d{1,3}(,\d{3})+$/.test(s)) dot += 1;         // 1,234,567 = 천단위 콤마
        else if (/^\d+,\d+$/.test(s)) comma += 1;           // 12,50 = 소수 콤마
      } else if (hasD) {
        if (/^\d{1,3}(\.\d{3})+$/.test(s)) comma += 1;      // 1.234.567 = 천단위 점
        else if (/^\d+\.\d+$/.test(s)) dot += 1;            // 12.50 = 소수 점
      }
    }
    return { fmt: comma > dot ? "comma" : "dot", dot: dot, comma: comma, sure: dot !== comma };
  }

  /* ---------- 날짜 ---------- 03/04 는 추측하지 않는다 (MM/DD vs DD/MM) */
  function parseDateToDays(raw, order) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return NaN;
    s = s.split(/[ T]/)[0];
    var y, m, d;
    if (/^\d{8}$/.test(s)) { y = +s.slice(0, 4); m = +s.slice(4, 6); d = +s.slice(6, 8); }
    else {
      var mm = /^(\d{1,4})[-./](\d{1,2})[-./](\d{1,4})$/.exec(s);
      if (!mm) return NaN;
      var a = +mm[1], b = +mm[2], c = +mm[3];
      if (mm[1].length === 4) { y = a; m = b; d = c; }
      else if (order === "dmy") { d = a; m = b; y = c; }
      else if (order === "mdy") { m = a; d = b; y = c; }
      else return NaN;                                       // 순서 미확정 = 계산하지 않는다
      if (String(y).length <= 2) y += (y < 70 ? 2000 : 1900);
    }
    if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return NaN;
    var ms = Date.UTC(y, m - 1, d);
    if (isNaN(ms)) return NaN;
    var back = new Date(ms);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return NaN;
    return Math.floor(ms / 86400000);
  }

  function detectDateOrder(samples) {
    var iso = 0, dmy = 0, mdy = 0, amb = 0, bad = 0;
    for (var i = 0; i < samples.length; i++) {
      var s = String(samples[i] == null ? "" : samples[i]).trim().split(/[ T]/)[0];
      if (!s) continue;
      if (/^\d{8}$/.test(s)) { iso++; continue; }
      var m = /^(\d{1,4})[-./](\d{1,2})[-./](\d{1,4})$/.exec(s);
      if (!m) { bad++; continue; }
      if (m[1].length === 4) { iso++; continue; }
      var a = +m[1], b = +m[2];
      if (a > 12 && b <= 12) dmy++;
      else if (b > 12 && a <= 12) mdy++;
      else amb++;
    }
    var order = "none";
    if (iso && !dmy && !mdy && !amb) order = "ymd";
    else if (dmy && !mdy) order = "dmy";
    else if (mdy && !dmy) order = "mdy";
    else if (amb || (dmy && mdy)) order = "ambiguous";
    return { order: order, iso: iso, dmy: dmy, mdy: mdy, amb: amb, bad: bad };
  }

  /* ---------- 집계기 (행별 단일 패스 O(n)) ----------
     map  : { sku, name, end, begin, out, cost, date } — 열 인덱스, 없으면 -1
     opts : { mode:"qty"|"cost"|"sales", outUnit:"qty"|"money", P, baseDays, dohThr, idleThr,
              numFmt, dateOrder, dateRule, today, maxExcluded } */
  function makeAggregator(map, opts) {
    var bySku = Object.create(null), order = [];
    var excl = [], exclCount = {}, conflicts = [];
    var stats = { total: 0, excluded: 0, merged: 0, beginMissing: 0, costMissing: 0, dateBad: 0 };
    var maxExcl = opts.maxExcluded || 2000;

    function reject(cells, rowNo, reason) {
      stats.excluded++;
      exclCount[reason] = (exclCount[reason] || 0) + 1;
      if (excl.length < maxExcl) excl.push({ row: rowNo, reason: reason, cells: cells });
    }
    function cell(cells, idx) {
      if (idx == null || idx < 0 || idx >= cells.length) return "";
      return cells[idx] == null ? "" : String(cells[idx]).trim();
    }

    function row(cells) {
      stats.total++;
      var rowNo = stats.total;

      var sku = cell(cells, map.sku);
      if (!sku) { reject(cells, rowNo, "noSku"); return; }

      var endRaw = cell(cells, map.end);
      if (!endRaw) { reject(cells, rowNo, "missing"); return; }
      var end = parseNumber(endRaw, opts.numFmt);
      if (isNaN(end)) { reject(cells, rowNo, "badNumber"); return; }
      if (end < 0) { reject(cells, rowNo, "negStock"); return; }      // 수불 오류 의심

      var outRaw = cell(cells, map.out);
      if (!outRaw) { reject(cells, rowNo, "missing"); return; }
      var out = parseNumber(outRaw, opts.numFmt);
      if (isNaN(out)) { reject(cells, rowNo, "badNumber"); return; }
      if (out < 0) { reject(cells, rowNo, "negOut"); return; }

      var begin = null;
      if (map.begin >= 0) {
        var bRaw = cell(cells, map.begin);
        if (!bRaw) stats.beginMissing++;
        else {
          var b = parseNumber(bRaw, opts.numFmt);
          if (isNaN(b)) { reject(cells, rowNo, "badNumber"); return; }
          if (b < 0) { reject(cells, rowNo, "negStock"); return; }
          begin = b;
        }
      }

      var cost = null;
      if (map.cost >= 0) {
        var cRaw = cell(cells, map.cost);
        var c = cRaw ? parseNumber(cRaw, opts.numFmt) : NaN;
        if (isNaN(c) || c <= 0) stats.costMissing++;   // 단가 0·결측은 행 제외가 아니라 '단가 없음'
        else cost = c;
      }

      var last = null;
      if (map.date >= 0) {
        var dRaw = cell(cells, map.date);
        if (dRaw) {
          var dd = parseDateToDays(dRaw, opts.dateOrder);
          if (isNaN(dd)) stats.dateBad++; else last = dd;
        }
      }

      var name = map.name >= 0 ? cell(cells, map.name) : "";
      var e = bySku[sku];
      if (!e) {
        bySku[sku] = { sku: sku, name: name, end: end, begin: begin, out: out, cost: cost, last: last, rows: 1, conflict: false };
        order.push(sku);
        return;
      }
      e.rows++;                                    // 동일 SKU 다중 행
      if (e.rows === 2) stats.merged++;
      e.out += out;                                // 출고·매출원가는 합산
      if (e.end !== end) e.conflict = true;        // 재고 값이 다르면 조용히 덮어쓰지 않고 경고
      e.end = end;                                 // 재고 열은 마지막 행 값 채택
      if (begin != null) {
        if (e.begin != null && e.begin !== begin) e.conflict = true;
        e.begin = begin;
      }
      if (cost != null) e.cost = cost;
      if (last != null && (e.last == null || last > e.last)) e.last = last;
      if (!e.name && name) e.name = name;
      if (e.conflict && conflicts.indexOf(sku) === -1 && conflicts.length < 30) conflicts.push(sku);
    }

    function dohKey(x) { return x.doh == null ? 1e12 : x.doh; }

    function result() {
      var useValue = (opts.mode === "cost" || opts.mode === "sales");
      var P = opts.P, base = opts.baseDays;
      var skus = [], noStock = [], noCost = [];
      var sumN = 0, sumD = 0, tiedTotal = 0, hasCost = false;
      var buckets = [{ count: 0, value: 0 }, { count: 0, value: 0 }, { count: 0, value: 0 },
                     { count: 0, value: 0 }, { count: 0, value: 0 }];

      for (var i = 0; i < order.length; i++) {
        var e = bySku[order[i]];
        var avg = (e.begin != null) ? (e.begin + e.end) / 2 : e.end;   // 기초 없으면 현재고로 대체
        var tied = (e.cost != null && e.cost > 0) ? e.end * e.cost : null;  // 단가 없으면 0원이 아니라 null
        if (tied != null) { hasCost = true; tiedTotal += tied; }
        var item = { sku: e.sku, name: e.name, avg: avg, end: e.end, out: e.out, cost: e.cost,
                     tied: tied, rows: e.rows, conflict: e.conflict, last: e.last, idle: null,
                     turn: null, doh: null, dead: false, noMove: false, group: "ranked" };
        if (opts.dateRule && e.last != null && opts.today != null) item.idle = opts.today - e.last;

        if (!(avg > 0)) { item.group = "noStock"; noStock.push(item); continue; }   // ∞ 출력 금지
        if (useValue && !(e.cost > 0)) { item.group = "noCost"; noCost.push(item); continue; }

        var denom = useValue ? avg * e.cost : avg;                     // 분모 단위 = 분자 단위
        var numer = (opts.mode === "qty") ? e.out
                  : (opts.outUnit === "money" ? e.out : e.out * e.cost);
        sumN += numer; sumD += denom;

        if (numer === 0) { item.turn = 0; item.doh = null; item.noMove = true; item.dead = true; }
        else {
          item.doh = P / (numer / denom);          // 재고일수 = 기간 ÷ 기간회전율
          item.turn = base / item.doh;             // 연환산 회전율
          item.dead = item.doh >= opts.dohThr;
        }
        if (item.idle != null && item.idle >= opts.idleThr) item.dead = true;

        var bi = item.doh == null ? 4 : (item.doh <= 30 ? 0 : item.doh <= 60 ? 1 : item.doh <= 90 ? 2 : item.doh <= 180 ? 3 : 4);
        buckets[bi].count++; buckets[bi].value += (tied || 0);
        skus.push(item);
      }

      var dead = [];
      for (i = 0; i < skus.length; i++) if (skus[i].dead) dead.push(skus[i]);
      dead.sort(function (a, b) {                          // 미출고 최상위 고정 → 묶인 금액 내림차순
        if (a.noMove !== b.noMove) return a.noMove ? -1 : 1;
        var av = hasCost ? (a.tied == null ? -1 : a.tied) : a.end;
        var bv = hasCost ? (b.tied == null ? -1 : b.tied) : b.end;
        if (bv !== av) return bv - av;
        return dohKey(b) - dohKey(a);
      });
      var all = skus.slice().sort(function (a, b) { return dohKey(b) - dohKey(a); });  // 회전율 오름차순

      return {
        mode: opts.mode, outUnit: opts.outUnit, P: P, baseDays: base,
        dohThr: opts.dohThr, idleThr: opts.idleThr, dateRule: !!opts.dateRule,
        dead: dead, all: all, noStock: noStock, noCost: noCost, buckets: buckets,
        excluded: excl, exclCount: exclCount, exclTruncated: stats.excluded > excl.length,
        conflicts: conflicts, stats: stats,
        totals: {
          skus: skus.length, dead: dead.length, tied: tiedTotal, hasCost: hasCost,
          turn: (sumD > 0) ? (sumN / sumD) * base / P : null
        }
      };
    }
    return { row: row, result: result };
  }

  function analyzeRows(rows, map, opts, onProg) {
    var agg = makeAggregator(map, opts);
    var start = opts.skipFirst ? 1 : 0;
    for (var i = start; i < rows.length; i++) {
      agg.row(rows[i]);
      if (onProg && i % 4000 === 0) onProg(Math.round(i / rows.length * 95));
    }
    return agg.result();
  }

  /* 워커 전용: 큰 파일을 Blob.slice 로 청크 읽어 스트리밍 집계. 원본 행은 밖으로 내보내지 않는다. */
  function streamAnalyzeBlob(file, delim, enc, skipFirst, map, opts, onProg, onDone, onErr) {
    try {
      var CH = 2 * 1024 * 1024;
      var fr = new FileReaderSync();
      var dec = new TextDecoder(enc || "utf-8");
      var agg = makeAggregator(map, opts);
      var parser = makeParser(delim);
      var first = !!skipFirst;
      var sink = function (r) { if (first) { first = false; return; } agg.row(r); };
      var pos = 0, size = file.size, lastPct = -1;
      while (pos < size) {
        var to = Math.min(pos + CH, size);
        var buf = fr.readAsArrayBuffer(file.slice(pos, to));
        parser.push(dec.decode(new Uint8Array(buf), { stream: true }), sink);
        pos = to;
        var pct = Math.round(pos / size * 95);
        if (pct !== lastPct) { lastPct = pct; onProg(pct); }   // 진행률 스로틀: 1% 단위
      }
      var tail = dec.decode(new Uint8Array(0));
      if (tail) parser.push(tail, sink);
      parser.end(sink);
      onDone(agg.result());
    } catch (err) { onErr(String((err && err.message) || err)); }
  }

  // node 단위 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      makeParser: makeParser, parseDelimited: parseDelimited, parseNumber: parseNumber,
      detectNumberFormat: detectNumberFormat, parseDateToDays: parseDateToDays,
      detectDateOrder: detectDateOrder, makeAggregator: makeAggregator, analyzeRows: analyzeRows
    };
    return;
  }

  /* ================= DOM 계층 ================= */
  var CFG = window.APP_CONFIG || {};
  var SLUG = CFG.slug || "inventory-turnover";
  var SKEY = SLUG + ":settings";
  var BIG_FILE = 10 * 1024 * 1024;   // 초과 시 Blob.slice 청크 읽기 (전체 문자열 적재 금지)
  var WORKER_ROWS = 20000;           // 초과 시 Web Worker (이하는 메인스레드가 더 단순·빠르다)
  var PREVIEW_ROWS = 100;
  var TABLE_ROWS = 200;
  var MAP_IDS = ["m-sku", "m-name", "m-end", "m-begin", "m-out", "m-cost", "m-date"];
  var OPTIONAL = { "m-name": 1, "m-begin": 1, "m-cost": 1, "m-date": 1 };

  function $(id) { return document.getElementById(id); }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function lang() { return (window.I18N && window.I18N.lang()) || "en"; }
  function T(key, vars) {
    var s = window.I18N ? window.I18N.t(key) : null;
    if (s == null) s = key;
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
    return s;
  }
  function nf(n, dec) {
    if (n == null || !isFinite(n)) return "—";
    try {
      return new Intl.NumberFormat(lang(), { maximumFractionDigits: dec == null ? 0 : dec }).format(n);
    } catch (e) { return String(Math.round(n * 1000) / 1000); }
  }
  function nfc(n) {                                  // 차트용 압축 표기 (12,345,678 → 12M)
    if (n == null || !isFinite(n)) return "—";
    try { return new Intl.NumberFormat(lang(), { notation: "compact", maximumFractionDigits: 1 }).format(n); }
    catch (e) { return nf(n, 0); }
  }
  function fmtSize(b) {
    return b < 1024 ? b + " B" : b < 1048576 ? nf(b / 1024, 1) + " KB" : nf(b / 1048576, 1) + " MB";
  }

  var GUESS = [
    ["m-sku", /sku|item\s*(code|no\b|number|id)|product\s*(code|no\b)|part\s*(no\b|number)|바코드|품번|품목\s*코드|상품\s*코드|자재\s*번호|코드/i],
    ["m-begin", /begin|opening|start(ing)?\s*(stock|qty|inv)|prior|기초|전기|월초/i],
    ["m-end", /end(ing)?|on.?hand|closing|current|stock|inventory|balance|재고|기말|현재고|보유|잔고/i],
    ["m-out", /shipp|issue|outbound|sold|sales|revenue|cogs|usage|consum|demand|출고|출하|판매|매출|사용량|불출/i],
    ["m-cost", /unit\s*(cost|price)|std\s*cost|standard\s*cost|단가|매입가|원가/i],
    ["m-date", /last.*(date|ship|issue|out|move|sale)|date|일자|일시|최종|최근/i],
    ["m-name", /name|desc|title|품명|상품명|품목명|자재명|규격/i]
  ];

  var src = null;        // { kind:"text"|"big", text, file, enc, encWhy }
  var parsed = null;     // { headers, rows, delim, numDetect, dateDetect, hasHeader }
  var lastResult = null;
  var activeTab = "dead";
  var busy = false;

  /* ---------- 설정 (localStorage: 임계값·기준일수·모드·컬럼 매핑만. 재고 원본은 저장하지 않는다) ---------- */
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch (e) { return {}; }
  }
  function saveSettings() {
    var m = {};
    for (var i = 0; i < MAP_IDS.length; i++) {
      var idx = parseInt($(MAP_IDS[i]).value, 10);
      m[MAP_IDS[i]] = (parsed && idx >= 0 && parsed.headers[idx] != null) ? parsed.headers[idx] : null;
    }
    var s = {
      mode: $("s-mode").value, P: $("s-period").value, base: $("s-base").value,
      doh: $("s-doh").value, idle: $("s-idle").value, fy: $("s-fy").value,
      outUnit: $("m-outunit").value, numFmt: $("numfmt-select").value,
      dateOrder: $("date-select").value, header: $("chk-header").checked, map: m
    };
    try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch (e) { /* private mode — 설정만 잃는다 */ }
  }

  /* ---------- 인코딩 (국내 ERP 다운로드는 CP949 가 흔하다) ---------- */
  function sniff(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return { enc: "utf-8", why: "bom" };
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return { enc: "utf-16le", why: "bom" };
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return { enc: "utf-16be", why: "bom" };
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });  // 잘린 끝 문자는 stream 이 흡수
      return { enc: "utf-8", why: "valid" };
    } catch (e) { return { enc: "euc-kr", why: "fallback" }; }
  }
  function decodeBytes(bytes, enc) {
    try { return new TextDecoder(enc).decode(bytes); }
    catch (e) {
      try { return new TextDecoder("utf-8").decode(bytes); } catch (e2) { return null; }
    }
  }
  function readBlob(blob, cb, errCb) {
    try {
      var fr = new FileReader();
      fr.onload = function () { cb(new Uint8Array(fr.result)); };
      fr.onerror = function () { errCb(); };
      fr.readAsArrayBuffer(blob);
    } catch (e) { errCb(); }
  }

  function detectDelim(text) {
    var cands = [",", ";", "\t"], best = ",", bestScore = -1;
    for (var i = 0; i < cands.length; i++) {
      var rows = parseDelimited(text.slice(0, 20000), cands[i], 6);
      if (!rows.length) continue;
      var n = rows[0].length;
      if (n < 2) continue;
      var same = 0;
      for (var r = 1; r < rows.length; r++) if (rows[r].length === n) same++;
      var score = n * 10 + same;
      if (score > bestScore) { bestScore = score; best = cands[i]; }
    }
    return best;
  }

  /* ---------- 입력 ---------- */
  function onFile(file) {
    if (!file) return;
    if (!file.size) { message(T("tool.err.emptyFile"), true); return; }
    $("enc-row").hidden = false;
    var note = $("file-note");
    note.hidden = false;
    note.textContent = file.name + " · " + fmtSize(file.size);
    $("paste").value = "";
    readBlob(file.slice(0, 262144), function (bytes) {
      var s = sniff(bytes);
      var forced = $("enc-select").value;
      var enc = forced === "auto" ? s.enc : forced;
      var headText = decodeBytes(bytes, enc);
      if (headText == null) { message(T("tool.err.encoding", { enc: enc }), true); return; }
      encNote(enc, s.why, headText);
      if (file.size > BIG_FILE) {
        src = { kind: "big", file: file, enc: enc, encWhy: s.why };
        var cut = headText.lastIndexOf("\n");            // 슬라이스 끝의 잘린 행은 미리보기에서 버린다
        preparePreview(cut > 0 ? headText.slice(0, cut) : headText);
        message(T("tool.file.streamed", { size: fmtSize(file.size) }));
      } else {
        readBlob(file, function (all) {
          var text = decodeBytes(all, enc);
          if (text == null) { message(T("tool.err.encoding", { enc: enc }), true); return; }
          src = { kind: "text", text: text, file: file, enc: enc, encWhy: s.why };
          preparePreview(text);
        }, function () { message(T("tool.err.read"), true); });
      }
    }, function () { message(T("tool.err.read"), true); });
  }

  function encNote(enc, why, text) {
    var n = $("enc-note");
    var label = enc === "euc-kr" ? T("tool.enc.euckr") : enc.toUpperCase();
    var msg = T("tool.enc.detected", { enc: label });
    if (why === "fallback") msg += " " + T("tool.enc.why.fallback");
    if (text && text.indexOf("\ufffd") !== -1) msg += " " + T("tool.enc.mojibake");
    n.textContent = msg;
  }

  function onPaste() {
    var text = $("paste").value;
    if (!text.trim()) { src = null; parsed = null; $("map-card").hidden = true; message(T("tool.res.empty")); return; }
    $("enc-row").hidden = true;
    $("file-note").hidden = true;
    src = { kind: "text", text: text };
    preparePreview(text);
  }

  function preparePreview(text) {
    var delim = detectDelim(text);
    var rows = parseDelimited(text.slice(0, 400000), delim, PREVIEW_ROWS + 1);
    if (!rows.length) { message(T("tool.err.noRows"), true); $("map-card").hidden = true; return; }
    var hasHeader = $("chk-header").checked;
    var headers = [];
    var width = 0;
    for (var i = 0; i < rows.length; i++) width = Math.max(width, rows[i].length);
    for (i = 0; i < width; i++) {
      headers.push(hasHeader && rows[0][i] != null && String(rows[0][i]).trim() !== ""
        ? String(rows[0][i]).trim() : T("tool.col.n", { n: i + 1 }));
    }
    var cells = [];
    for (i = hasHeader ? 1 : 0; i < rows.length; i++)
      for (var j = 0; j < rows[i].length; j++) cells.push(rows[i][j]);
    parsed = {
      headers: headers, rows: rows, delim: delim, hasHeader: hasHeader,
      numDetect: detectNumberFormat(cells), dateDetect: null
    };
    $("map-card").hidden = false;
    $("res-extra").hidden = true;
    lastResult = null;
    $("parse-note").textContent = T("tool.delim.detected", {
      d: delim === "," ? T("tool.delim.comma") : delim === ";" ? T("tool.delim.semicolon") : T("tool.delim.tab")
    }) + " · " + T("tool.parse.cols", { n: width });
    renderPreview(rows, hasHeader);
    fillMapSelects(headers);
    autoGuess(headers);
    refreshNumNote();
    refreshDateDetect();
    reconcileMode();
    message(T("tool.res.ready"));
  }

  function renderPreview(rows, hasHeader) {
    var tbl = $("preview");
    clear(tbl);
    var n = Math.min(rows.length, 6);
    for (var i = 0; i < n; i++) {
      var tr = document.createElement("tr");
      for (var j = 0; j < rows[i].length; j++) {
        var c = document.createElement(i === 0 && hasHeader ? "th" : "td");
        c.style.cssText = "padding:6px 9px;border-bottom:1px solid var(--line);text-align:start;max-width:170px;overflow:hidden;text-overflow:ellipsis;"
          + (i === 0 && hasHeader ? "background:var(--bg);font-weight:700;" : "color:var(--muted);");
        c.textContent = String(rows[i][j] == null ? "" : rows[i][j]).replace(/\s+/g, " ");
        tr.appendChild(c);
      }
      tbl.appendChild(tr);
    }
    $("preview-note").textContent = T("tool.preview.note", { n: Math.max(0, n - (hasHeader ? 1 : 0)) });
  }

  function fillMapSelects(headers) {
    for (var i = 0; i < MAP_IDS.length; i++) {
      var sel = $(MAP_IDS[i]);
      var prev = sel.value;
      clear(sel);
      var o = document.createElement("option");
      o.value = "-1";
      o.textContent = OPTIONAL[MAP_IDS[i]] ? T("tool.col.none") : T("tool.col.choose");
      sel.appendChild(o);
      for (var j = 0; j < headers.length; j++) {
        var opt = document.createElement("option");
        opt.value = String(j); opt.textContent = headers[j];
        sel.appendChild(opt);
      }
      if (prev && sel.querySelector('option[value="' + prev + '"]')) sel.value = prev;
    }
  }

  function autoGuess(headers) {
    var saved = loadSettings();
    var used = {};
    var i, j;
    for (i = 0; i < GUESS.length; i++) {                 // 1순위: 지난번에 쓴 헤더 이름 그대로
      var id = GUESS[i][0];
      var want = saved.map && saved.map[id];
      if (!want) continue;
      for (j = 0; j < headers.length; j++) {
        if (used[j]) continue;
        if (headers[j] === want) { $(id).value = String(j); used[j] = 1; break; }
      }
    }
    for (i = 0; i < GUESS.length; i++) {                 // 2순위: 헤더 이름 자동 추정
      var gid = GUESS[i][0], re = GUESS[i][1];
      if (saved.map && saved.map[gid] && $(gid).value !== "" && parseInt($(gid).value, 10) >= 0
          && used[parseInt($(gid).value, 10)]) continue;
      var hit = -1;
      for (j = 0; j < headers.length; j++) {
        if (used[j]) continue;
        if (re.test(headers[j])) { hit = j; break; }
      }
      if (hit >= 0) { $(gid).value = String(hit); used[hit] = 1; }
      else $(gid).value = "-1";        // 추정 실패 → 0번 열을 조용히 쓰지 않고 사용자에게 넘긴다
    }
    var outIdx = parseInt($("m-out").value, 10);
    $("m-outunit").value = guessOutUnit(outIdx >= 0 ? headers[outIdx] : "");
  }

  function guessOutUnit(h) {
    h = h || "";
    if (/qty|quantity|units|pcs|수량|개수/i.test(h)) return "qty";
    return /cogs|cost|amount|value|revenue|sales|매출|원가|금액/i.test(h) ? "money" : "qty";
  }

  function refreshNumNote() {
    if (!parsed) return;
    var d = parsed.numDetect;
    var shown = d.fmt === "comma" ? T("tool.numfmt.comma") : T("tool.numfmt.dot");
    $("numfmt-note").textContent = (d.sure && (d.dot || d.comma))
      ? T("tool.numfmt.found", { fmt: shown })
      : T("tool.numfmt.unsure", { fmt: shown });
  }

  function refreshDateDetect() {
    var note = $("date-note"), idx = parseInt($("m-date").value, 10);
    if (!parsed || idx < 0) { note.textContent = T("tool.date.noCol"); parsed && (parsed.dateDetect = null); return; }
    var samples = [];
    for (var i = parsed.hasHeader ? 1 : 0; i < parsed.rows.length; i++)
      if (parsed.rows[i][idx] != null) samples.push(parsed.rows[i][idx]);
    var d = detectDateOrder(samples);
    parsed.dateDetect = d;
    if (d.order === "ambiguous") note.textContent = T("tool.date.ambiguous");
    else if (d.order === "none") note.textContent = T("tool.date.unreadable");
    else note.textContent = T("tool.date.detected", { order: T("tool.date." + d.order) });
  }

  function effectiveDateOrder() {
    var pick = $("date-select").value;
    if (pick !== "auto") return pick;
    var d = parsed && parsed.dateDetect;
    if (!d) return null;
    return (d.order === "ymd" || d.order === "dmy" || d.order === "mdy") ? d.order : null;  // 애매하면 추측하지 않는다
  }

  /* 모드는 가용 열로 자동 선택하되, 불가능한 조합이면 조용히 두지 않고 바꾼 뒤 이유를 적는다. */
  function reconcileMode() {
    var hasCost = parseInt($("m-cost").value, 10) >= 0;
    var unit = $("m-outunit").value;
    var sel = $("s-mode"), note = $("mode-note");
    var mode = sel.value;
    var why = "";
    if (!hasCost && (mode === "cost" || mode === "sales")) { mode = "qty"; why = T("tool.mode.why.noCost"); }
    if (mode === "qty" && unit === "money") {
      if (hasCost) { mode = "cost"; why = T("tool.mode.why.money"); }
      else why = T("tool.err.unitQtyMoney");
    }
    sel.value = mode;
    if (!why) {
      why = mode === "cost" ? T("tool.mode.why.cost") : mode === "sales" ? T("tool.mode.why.sales") : T("tool.mode.why.qty");
    }
    note.textContent = why;
  }

  function collectMap() {
    return {
      sku: parseInt($("m-sku").value, 10), name: parseInt($("m-name").value, 10),
      end: parseInt($("m-end").value, 10), begin: parseInt($("m-begin").value, 10),
      out: parseInt($("m-out").value, 10), cost: parseInt($("m-cost").value, 10),
      date: parseInt($("m-date").value, 10)
    };
  }
  function collectOpts() {
    var order = effectiveDateOrder();
    var pick = $("numfmt-select").value;
    return {
      mode: $("s-mode").value, outUnit: $("m-outunit").value,
      P: parseInt($("s-period").value, 10), baseDays: parseInt($("s-base").value, 10),
      dohThr: parseInt($("s-doh").value, 10), idleThr: parseInt($("s-idle").value, 10),
      numFmt: pick === "auto" ? (parsed ? parsed.numDetect.fmt : "dot") : pick,
      dateOrder: order, dateRule: !!order && parseInt($("m-date").value, 10) >= 0,
      today: Math.floor(Date.now() / 86400000),
      skipFirst: $("chk-header").checked, maxExcluded: 2000
    };
  }

  function validate() {
    if (!src || !parsed) return "noData";
    if (parseInt($("m-sku").value, 10) < 0 || isNaN(parseInt($("m-sku").value, 10))) return "noMap";
    if (parseInt($("m-end").value, 10) < 0 || isNaN(parseInt($("m-end").value, 10))) return "noMap";
    if (parseInt($("m-out").value, 10) < 0 || isNaN(parseInt($("m-out").value, 10))) return "noMap";
    var mode = $("s-mode").value, unit = $("m-outunit").value, hasCost = parseInt($("m-cost").value, 10) >= 0;
    if (mode === "qty" && unit === "money") return "unitQtyMoney";      // 금액 ÷ 수량 차단
    if ((mode === "cost" || mode === "sales") && !hasCost) return "needCost";
    if (mode === "sales" && unit === "qty") return "salesNeedsMoney";
    var P = parseInt($("s-period").value, 10);
    if (!(P > 0)) return "badPeriod";
    if (P > 3650) return "badPeriod";
    return null;
  }

  /* ---------- 실행 ---------- */
  function setBusy(on, pct) {
    busy = on;
    $("btn-run").disabled = on;
    $("progress").hidden = !on;
    if (on) {
      $("progress-bar").style.width = (pct || 0) + "%";
      $("progress-note").textContent = T("tool.analyzing", { pct: String(pct || 0) });
    }
  }
  function progress(p) { if (busy) { $("progress-bar").style.width = p + "%"; $("progress-note").textContent = T("tool.analyzing", { pct: String(p) }); } }

  function run() {
    var err = validate();
    if (err) { message(T("tool.err." + err), true); return; }
    saveSettings();
    var map = collectMap(), opts = collectOpts();
    setBusy(true, 0);
    $("res-extra").hidden = true;
    if (src.kind === "big") {
      dispatch({ kind: "file", file: src.file, delim: parsed.delim, enc: src.enc, skipFirst: opts.skipFirst, map: map, opts: opts });
      return;
    }
    var rows;
    try { rows = parseDelimited(src.text, parsed.delim); }
    catch (e) { setBusy(false); message(T("tool.err.read"), true); return; }
    if (rows.length - (opts.skipFirst ? 1 : 0) <= 0) { setBusy(false); message(T("tool.err.noRows"), true); return; }
    dispatch({ kind: "rows", rows: rows, map: map, opts: opts });
  }

  function buildWorkerSrc() {
    var fns = [makeParser, parseNumber, parseDateToDays, makeAggregator, analyzeRows, streamAnalyzeBlob];
    var s = '"use strict";\n';
    for (var i = 0; i < fns.length; i++) s += fns[i].toString() + "\n";
    s += "self.onmessage=function(e){var d=e.data;try{" +
         "var prog=function(p){self.postMessage({t:'p',v:p});};" +
         "var fin=function(r){self.postMessage({t:'d',res:r});};" +
         "if(d.kind==='rows'){fin(analyzeRows(d.rows,d.map,d.opts,prog));}" +
         "else{streamAnalyzeBlob(d.file,d.delim,d.enc,d.skipFirst,d.map,d.opts,prog,fin," +
         "function(m){self.postMessage({t:'e',msg:m});});}" +
         "}catch(err){self.postMessage({t:'e',msg:String((err&&err.message)||err)});}};";
    return s;
  }

  // 2만 행 초과 또는 대용량 파일만 워커로. 실패하면 조용히 죽지 않고 메인스레드로 폴백한다.
  function dispatch(msg) {
    var heavy = (msg.kind === "file") || (msg.rows && msg.rows.length > WORKER_ROWS);
    if (!heavy || typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
      mainThread(msg);
      return;
    }
    var url = null, w = null, finished = false;
    function cleanup() { try { w && w.terminate(); } catch (e) {} if (url) URL.revokeObjectURL(url); }
    try {
      url = URL.createObjectURL(new Blob([buildWorkerSrc()], { type: "text/javascript" }));
      w = new Worker(url);
    } catch (e) { cleanup(); mainThread(msg); return; }
    var timer = setTimeout(function () {                 // 타임아웃 — 무한 대기 금지
      if (finished) return;
      finished = true; cleanup(); mainThread(msg);
    }, 180000);
    w.onmessage = function (e) {
      var d = e.data || {};
      if (d.t === "p") { progress(d.v); return; }
      if (finished) return;
      finished = true; clearTimeout(timer); cleanup();
      if (d.t === "d") done(d.res); else mainThread(msg);
    };
    w.onerror = function () {
      if (finished) return;
      finished = true; clearTimeout(timer); cleanup(); mainThread(msg);
    };
    try { w.postMessage(msg); }
    catch (e) { if (!finished) { finished = true; clearTimeout(timer); cleanup(); mainThread(msg); } }
  }

  function mainThread(msg) {
    if (msg.kind === "rows") {
      var res;
      try { res = analyzeRows(msg.rows, msg.map, msg.opts, progress); }
      catch (e) { setBusy(false); message(T("tool.err.read"), true); return; }
      done(res);
      return;
    }
    streamMain(msg);
  }

  // 워커를 못 쓰는 환경의 대용량 파일 경로 — 같은 코어를 청크로 돌린다 (UI 를 얼리지 않게 양보).
  function streamMain(msg) {
    var file = msg.file, CH = 2 * 1024 * 1024, pos = 0, dec;
    try { dec = new TextDecoder(msg.enc || "utf-8"); } catch (e) { dec = new TextDecoder("utf-8"); }
    var agg = makeAggregator(msg.map, msg.opts);
    var parser = makeParser(msg.delim);
    var first = !!msg.skipFirst;
    var sink = function (r) { if (first) { first = false; return; } agg.row(r); };
    function step() {
      if (pos >= file.size) {
        try {
          var tail = dec.decode(new Uint8Array(0));
          if (tail) parser.push(tail, sink);
          parser.end(sink);
          done(agg.result());
        } catch (e) { setBusy(false); message(T("tool.err.read"), true); }
        return;
      }
      var to = Math.min(pos + CH, file.size);
      readBlob(file.slice(pos, to), function (bytes) {
        try { parser.push(dec.decode(bytes, { stream: true }), sink); }
        catch (e) { setBusy(false); message(T("tool.err.read"), true); return; }
        pos = to;
        progress(Math.round(pos / file.size * 95));
        setTimeout(step, 0);
      }, function () { setBusy(false); message(T("tool.err.read"), true); });
    }
    step();
  }

  function done(res) {
    lastResult = res;
    setBusy(false);
    render(res);
  }

  /* ---------- 출력 ---------- */
  function message(text, warn) {
    var R = $("result");
    clear(R);
    var p = document.createElement("p");
    p.style.cssText = "margin:0;font-size:15px;line-height:1.6;" + (warn ? "font-weight:600;" : "color:var(--muted);");
    p.textContent = text;
    R.appendChild(p);
    if (warn) $("res-extra").hidden = true;
  }

  function banner(text) {
    var b = document.createElement("p");
    b.style.cssText = "margin:10px 0 0;padding:9px 12px;border-radius:8px;font-size:13px;line-height:1.6;"
      + "background:var(--surface);border:1px solid color-mix(in srgb, var(--accent) 35%, var(--line));";
    b.textContent = text;
    return b;
  }
  function card(label, value, sub) {
    var d = document.createElement("div");
    d.style.cssText = "flex:1;min-width:132px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 12px;";
    var l = document.createElement("div");
    l.style.cssText = "color:var(--muted);font-size:11.5px;font-weight:700;line-height:1.4;";
    l.textContent = label;
    var v = document.createElement("div");
    v.style.cssText = "font-size:19px;font-weight:800;letter-spacing:-0.02em;line-height:1.35;color:var(--accent-strong);font-variant-numeric:tabular-nums;";
    v.textContent = value;
    d.appendChild(l); d.appendChild(v);
    if (sub) {
      var s = document.createElement("div");
      s.style.cssText = "color:var(--muted);font-size:11px;line-height:1.4;";
      s.textContent = sub;
      d.appendChild(s);
    }
    return d;
  }

  function modeLabel(m) { return m === "cost" ? T("tool.mode.short.cost") : m === "sales" ? T("tool.mode.short.sales") : T("tool.mode.short.qty"); }

  function fyLabel(fyMonth) {
    var now = new Date();
    var y = now.getUTCFullYear();
    if (now.getUTCMonth() + 1 < fyMonth) y -= 1;
    var fmt;
    try { fmt = new Intl.DateTimeFormat(lang(), { month: "short", year: "numeric", timeZone: "UTC" }); }
    catch (e) { return String(y); }
    var a = fmt.format(new Date(Date.UTC(y, fyMonth - 1, 1)));
    var b = fmt.format(new Date(Date.UTC(y + 1, fyMonth - 2 < 0 ? 11 : fyMonth - 2, 1)));
    return a + " – " + b;
  }

  function render(res) {
    var R = $("result");
    clear(R);
    var t = res.totals;

    var basis = document.createElement("p");
    basis.style.cssText = "margin:0 0 12px;font-size:12.5px;color:var(--muted);line-height:1.6;";
    basis.textContent = T("tool.basis", { mode: modeLabel(res.mode), P: nf(res.P), base: nf(res.baseDays) })
      + (res.mode === "sales" ? " · " + T("tool.mode.salesBadge") : "")
      + " · " + T("tool.fy.period", { label: fyLabel(parseInt($("s-fy").value, 10) || 1) });
    R.appendChild(basis);

    if (t.skus === 0) {
      var none = document.createElement("p");
      none.style.cssText = "margin:0;font-size:15px;font-weight:600;line-height:1.6;";
      none.textContent = T("tool.err.nothingRanked", { n: nf(res.stats.total) });
      R.appendChild(none);
    } else {
      var grid = document.createElement("div");
      grid.style.cssText = "display:flex;gap:10px;flex-wrap:wrap;";
      grid.appendChild(card(T("tool.card.skus"), nf(t.skus)));
      grid.appendChild(card(T("tool.card.dead"), nf(t.dead), T("tool.card.deadSub", { doh: nf(res.dohThr), idle: nf(res.idleThr) })));
      grid.appendChild(card(T("tool.card.tied"), t.hasCost ? nf(t.tied, 0) : "—", t.hasCost ? T("tool.card.tiedSub") : T("tool.card.noCostSub")));
      grid.appendChild(card(T("tool.card.turn"), t.turn == null ? "—" : nf(t.turn, 2), T("tool.card.turnSub", { base: nf(res.baseDays) })));
      R.appendChild(grid);
    }

    // 배너 — 결과를 왜곡할 수 있는 사실은 전부 위에 고정한다 (조용한 실패 금지)
    if (collectMap().begin < 0) R.appendChild(banner(T("tool.banner.avgSub")));
    else if (res.stats.beginMissing > 0) R.appendChild(banner(T("tool.banner.beginPartial", { n: nf(res.stats.beginMissing) })));
    if (!t.hasCost) R.appendChild(banner(T("tool.banner.noCost")));
    if (res.noCost.length) R.appendChild(banner(T("tool.banner.noCostSkus", { n: nf(res.noCost.length) })));
    if (collectMap().date < 0) R.appendChild(banner(T("tool.banner.noDate")));
    else if (!res.dateRule) R.appendChild(banner(T("tool.banner.dateOff")));
    if (res.stats.dateBad > 0) R.appendChild(banner(T("tool.banner.dateBad", { n: nf(res.stats.dateBad) })));
    if (res.stats.merged > 0) R.appendChild(banner(T("tool.banner.merged", { n: nf(res.stats.merged) })));
    if (res.conflicts.length) R.appendChild(banner(T("tool.banner.mergeConflict", { list: res.conflicts.join(", ") })));
    if (res.noStock.length) R.appendChild(banner(T("tool.banner.noStock", { n: nf(res.noStock.length) })));
    if (res.stats.excluded > 0) R.appendChild(banner(T("tool.banner.excluded", { n: nf(res.stats.excluded), reasons: reasonText(res.exclCount) })));

    $("res-extra").hidden = t.skus === 0 && !res.noStock.length && !res.noCost.length;
    $("excl-wrap").hidden = res.stats.excluded === 0;
    $("lifo-note").hidden = lang() !== "en";     // LIFO 는 US GAAP 한정 — IFRS/K-IFRS 는 금지
    renderTable(res);
    renderChart(res);
  }

  function reasonText(counts) {
    var out = [];
    for (var k in counts) if (counts.hasOwnProperty(k)) out.push(nf(counts[k]) + " " + T("tool.excl.reason." + k));
    return out.join(", ");
  }

  function verdictOf(it) {
    if (it.group === "noStock") return T("tool.v.noStock");
    if (it.group === "noCost") return T("tool.v.noCost");
    if (it.noMove) return T("tool.v.noMove");
    return it.dead ? T("tool.v.dead") : T("tool.v.ok");
  }

  function renderTable(res) {
    var list = activeTab === "dead" ? res.dead : res.all.concat(res.noCost, res.noStock);
    var tbl = $("table");
    clear(tbl);
    var heads = ["tool.th.sku", "tool.th.name", "tool.th.avg", "tool.th.out", "tool.th.turn",
                 "tool.th.doh", "tool.th.idle", "tool.th.tied", "tool.th.verdict"];
    var thead = document.createElement("thead");
    var htr = document.createElement("tr");
    for (var i = 0; i < heads.length; i++) {
      var th = document.createElement("th");
      th.style.cssText = "padding:8px 10px;border-bottom:1px solid var(--line);background:var(--bg);font-size:11.5px;color:var(--muted);font-weight:700;"
        + (i >= 2 && i <= 7 ? "text-align:end;" : "text-align:start;");
      th.textContent = T(heads[i]);
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    tbl.appendChild(thead);

    var tbody = document.createElement("tbody");
    var n = Math.min(list.length, TABLE_ROWS);
    for (i = 0; i < n; i++) {
      var it = list[i];
      var tr = document.createElement("tr");
      var vals = [
        it.sku,
        it.name || "",
        nf(it.avg, 2),
        nf(it.out, 2),
        it.noMove ? "0" : (it.turn == null ? "—" : nf(it.turn, 2)),
        it.noMove ? "∞" : (it.doh == null ? "—" : nf(it.doh, 0)),
        it.idle == null ? "—" : nf(it.idle, 0),
        it.tied == null ? "—" : nf(it.tied, 0),
        verdictOf(it)
      ];
      for (var c = 0; c < vals.length; c++) {
        var td = document.createElement("td");
        td.style.cssText = "padding:7px 10px;border-bottom:1px solid var(--line);font-size:12.5px;"
          + (c >= 2 && c <= 7 ? "text-align:end;font-variant-numeric:tabular-nums;" : "text-align:start;")
          + (c === 1 ? "max-width:180px;overflow:hidden;text-overflow:ellipsis;color:var(--muted);" : "");
        td.textContent = String(vals[c]);
        if (c === 8) {
          var badge = document.createElement("span");
          badge.style.cssText = "display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;"
            + (it.dead ? "background:var(--accent);color:#fff;" : "background:var(--bg);color:var(--muted);border:1px solid var(--line);");
          badge.textContent = String(vals[c]);
          clear(td);
          td.appendChild(badge);
        }
        if (c === 0 && it.rows > 1) {
          var m = document.createElement("span");
          m.style.cssText = "margin-inline-start:6px;color:var(--muted);font-size:10.5px;";
          m.textContent = T("tool.mergedBadge", { n: nf(it.rows) });
          td.appendChild(m);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    $("table-note").textContent = list.length === 0
      ? (activeTab === "dead" ? T("tool.table.noDead") : T("tool.table.none"))
      : (list.length > n ? T("tool.table.trunc", { n: nf(n), total: nf(list.length) }) : T("tool.table.count", { n: nf(list.length) }));
  }

  // 재고일수 분포 — 업계 표준 aging 밴드. 차트 라이브러리 vendoring 0, 순수 SVG.
  function renderChart(res) {
    var wrap = $("chart");
    clear(wrap);
    var labels = ["0–30", "31–60", "61–90", "91–180", T("tool.chart.b180")];
    var b = res.buckets, max = 1, i;
    for (i = 0; i < b.length; i++) max = Math.max(max, b[i].count);
    var NS = "http://www.w3.org/2000/svg";
    var rowH = 30, W = 320, H = b.length * rowH + 6;
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", T("tool.chart.title"));
    svg.style.cssText = "width:100%;height:auto;max-width:560px;display:block;";
    var x0 = 48, barMax = 168;
    for (i = 0; i < b.length; i++) {
      var y = i * rowH + 4;
      var lab = document.createElementNS(NS, "text");
      lab.setAttribute("x", "0"); lab.setAttribute("y", String(y + 14));
      lab.setAttribute("font-size", "9.5"); lab.setAttribute("fill", "currentColor");
      lab.style.opacity = "0.7";
      lab.textContent = labels[i];
      svg.appendChild(lab);

      var track = document.createElementNS(NS, "rect");
      track.setAttribute("x", String(x0)); track.setAttribute("y", String(y + 3));
      track.setAttribute("width", String(barMax)); track.setAttribute("height", "13");
      track.setAttribute("rx", "3"); track.setAttribute("fill", "currentColor");
      track.style.opacity = "0.08";
      svg.appendChild(track);

      var w = Math.round(barMax * (b[i].count / max));
      if (b[i].count > 0) w = Math.max(w, 2);
      var bar = document.createElementNS(NS, "rect");
      bar.setAttribute("x", String(x0)); bar.setAttribute("y", String(y + 3));
      bar.setAttribute("width", String(w)); bar.setAttribute("height", "13");
      bar.setAttribute("rx", "3");
      bar.setAttribute("fill", "var(--accent)");
      bar.style.opacity = i >= 3 ? "1" : "0.55";     // 91일 이상은 진하게 — 눈이 먼저 가야 할 밴드
      svg.appendChild(bar);

      var val = document.createElementNS(NS, "text");
      val.setAttribute("x", String(x0 + barMax + 6)); val.setAttribute("y", String(y + 14));
      val.setAttribute("font-size", "9.5"); val.setAttribute("fill", "currentColor");
      val.style.opacity = "0.75";
      val.textContent = nf(b[i].count) + (res.totals.hasCost ? " · " + nfc(b[i].value) : "");
      svg.appendChild(val);
    }
    wrap.appendChild(svg);
    var cap = document.createElement("p");
    cap.style.cssText = "margin:6px 0 0;color:var(--muted);font-size:11.5px;";
    cap.textContent = res.totals.hasCost ? T("tool.chart.legend") : T("tool.chart.legendNoCost");
    wrap.appendChild(cap);
  }

  /* ---------- 내보내기 ---------- */
  function esc(v) {
    v = String(v == null ? "" : v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function num(v, dec) {
    if (v == null || !isFinite(v)) return "";
    var m = Math.pow(10, dec == null ? 4 : dec);
    return String(Math.round(v * m) / m);          // 기계가 읽을 CSV 는 점 소수 고정
  }
  function reportRows(res) {
    var head = [T("tool.th.sku"), T("tool.th.name"), T("tool.th.avg"), T("tool.th.out"),
                T("tool.th.turn"), T("tool.th.doh"), T("tool.th.idle"), T("tool.th.tied"), T("tool.th.verdict")];
    var out = [head];
    var list = res.all.concat(res.noCost, res.noStock);
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      out.push([it.sku, it.name || "", num(it.avg, 3), num(it.out, 3),
                it.noMove ? "0" : num(it.turn, 4), it.noMove ? "" : num(it.doh, 1),
                it.idle == null ? "" : num(it.idle, 0), it.tied == null ? "" : num(it.tied, 2),
                verdictOf(it)]);
    }
    return out;
  }
  function download(name, text, mime) {
    try {
      var blob = new Blob([text], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return true;
    } catch (e) { return false; }
  }
  function toCSV(rows) {
    var lines = [];
    for (var i = 0; i < rows.length; i++) {
      var r = [];
      for (var j = 0; j < rows[i].length; j++) r.push(esc(rows[i][j]));
      lines.push(r.join(","));
    }
    return "\ufeff" + lines.join("\r\n");         // BOM — 엑셀이 UTF-8 을 깨뜨리지 않게
  }
  function stamp() {
    var d = new Date();
    function p2(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate());
  }

  /* ---------- 샘플 (따옴표 안 콤마·개행·이스케이프 따옴표 + 엣지케이스 전부 포함) ---------- */
  var SAMPLE = [
    'SKU,Item name,Beginning stock,On hand,Shipped (365d),Unit cost,Last outflow',
    'A-1001,"Mug, blue (12 oz)",140,120,1300,4.50,2026-07-02',
    'A-1002,"Kettle ""Pro"" 1.7L",60,58,24,32.00,2026-05-30',
    'A-1003,"Shelf bracket',
    'heavy duty, 2-pack",300,280,90,1.20,2026-06-28',
    'B-2001,머그컵 화이트,80,96,410,3.80,2026-07-10',
    'B-2002,보온병 500ml,45,44,6,12.50,2026-01-08',
    'B-2003,티스푼 세트,500,500,0,0.90,',
    'C-3001,Gift box (large),0,0,60,2.10,2026-06-01',
    'C-3002,Seasonal ornament,120,118,3,5.60,2025-11-14',
    'C-3003,Damaged returns bin,10,-4,12,1.00,2026-03-02',
    'D-4001,Filter cartridge,200,180,940,,2026-07-05',
    'D-4002,Label roll,60,55,220,0.75,2026-07-11',
    'D-4002,Label roll,60,55,180,0.75,2026-07-14',
    'E-5001,Discontinued adapter,90,90,0,8.40,2025-08-20',
    'E-5002,Overstock cable,,1200,150,1.10,2026-04-02'
  ].join("\n");

  /* ---------- 배선 ---------- */
  function restore() {
    var s = loadSettings();
    if (s.mode) $("s-mode").value = s.mode;
    if (s.P) $("s-period").value = s.P;
    if (s.base) $("s-base").value = s.base;
    if (s.doh) $("s-doh").value = s.doh;
    if (s.idle) $("s-idle").value = s.idle;
    if (s.numFmt) $("numfmt-select").value = s.numFmt;
    if (s.dateOrder) $("date-select").value = s.dateOrder;
    if (s.outUnit) $("m-outunit").value = s.outUnit;
    if (typeof s.header === "boolean") $("chk-header").checked = s.header;
    $("s-doh-out").textContent = $("s-doh").value;
    $("s-idle-out").textContent = $("s-idle").value;
    fillMonths(s.fy ? parseInt(s.fy, 10) : guessFy());
  }
  function guessFy() {
    var tag = (navigator.languages && navigator.languages[0]) || navigator.language || "";
    return (/-(JP|GB|IN)\b/i.test(tag) || /^ja\b/i.test(tag)) ? 4 : 1;   // 4월 시작: JP·UK·IN
  }
  function fillMonths(sel) {
    var s = $("s-fy"), fmt = null, cur = sel || parseInt(s.value, 10) || 1;
    try { fmt = new Intl.DateTimeFormat(lang(), { month: "long", timeZone: "UTC" }); } catch (e) { fmt = null; }
    clear(s);
    for (var m = 0; m < 12; m++) {
      var o = document.createElement("option");
      o.value = String(m + 1);
      o.textContent = fmt ? fmt.format(new Date(Date.UTC(2026, m, 15))) : String(m + 1);
      s.appendChild(o);
    }
    s.value = String(cur);
  }

  var drop = $("drop");
  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.style.borderColor = "var(--accent)"; });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.style.borderColor = "var(--line)"; });
  });
  drop.addEventListener("drop", function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) { $("file-input").value = ""; onFile(f); }
  });
  $("btn-browse").addEventListener("click", function () { $("file-input").click(); });
  $("file-input").addEventListener("change", function (e) { onFile(e.target.files && e.target.files[0]); });
  $("btn-sample").addEventListener("click", function () {
    $("paste").value = SAMPLE;
    $("file-input").value = "";
    onPaste();
    if (!validate()) run();
  });
  $("btn-clear").addEventListener("click", function () {
    $("paste").value = ""; $("file-input").value = "";
    src = null; parsed = null; lastResult = null;
    $("map-card").hidden = true; $("enc-row").hidden = true; $("file-note").hidden = true;
    $("res-extra").hidden = true;
    message(T("tool.res.empty"));
  });
  var pasteTimer = null;
  $("paste").addEventListener("input", function () {
    clearTimeout(pasteTimer);
    pasteTimer = setTimeout(onPaste, 250);
  });
  $("enc-select").addEventListener("change", function () {
    if (src && src.file) onFile(src.file);
  });
  $("chk-header").addEventListener("change", function () {
    if (src) { if (src.kind === "text") preparePreview(src.text); else if (src.file) onFile(src.file); }
  });
  for (var mi = 0; mi < MAP_IDS.length; mi++) {
    $(MAP_IDS[mi]).addEventListener("change", function () {
      if (parsed) {
        var oi = parseInt($("m-out").value, 10);
        if (this.id === "m-out") $("m-outunit").value = guessOutUnit(oi >= 0 ? parsed.headers[oi] : "");
        if (this.id === "m-date") refreshDateDetect();
      }
      reconcileMode();
    });
  }
  $("m-outunit").addEventListener("change", reconcileMode);
  $("s-mode").addEventListener("change", reconcileMode);
  $("date-select").addEventListener("change", refreshDateDetect);
  $("numfmt-select").addEventListener("change", refreshNumNote);
  $("s-doh").addEventListener("input", function () { $("s-doh-out").textContent = this.value; });
  $("s-idle").addEventListener("input", function () { $("s-idle-out").textContent = this.value; });
  $("btn-run").addEventListener("click", run);

  function setTab(name) {
    activeTab = name;
    var d = $("tab-dead"), a = $("tab-all");
    d.setAttribute("aria-selected", String(name === "dead"));
    a.setAttribute("aria-selected", String(name === "all"));
    d.style.background = name === "dead" ? "var(--accent)" : "transparent";
    d.style.color = name === "dead" ? "#fff" : "var(--ink)";
    a.style.background = name === "all" ? "var(--accent)" : "transparent";
    a.style.color = name === "all" ? "#fff" : "var(--ink)";
    if (lastResult) renderTable(lastResult);
  }
  $("tab-dead").addEventListener("click", function () { setTab("dead"); });
  $("tab-all").addEventListener("click", function () { setTab("all"); });

  $("btn-csv").addEventListener("click", function () {
    if (!lastResult) return;
    if (!download(SLUG + "-" + stamp() + ".csv", toCSV(reportRows(lastResult)), "text/csv;charset=utf-8"))
      message(T("tool.err.download"), true);
  });
  $("btn-tsv").addEventListener("click", function () {
    if (!lastResult) return;
    var rows = reportRows(lastResult), lines = [];
    for (var i = 0; i < rows.length; i++) {
      var r = [];
      for (var j = 0; j < rows[i].length; j++) r.push(String(rows[i][j] == null ? "" : rows[i][j]).replace(/[\t\r\n]+/g, " "));
      lines.push(r.join("\t"));
    }
    var text = lines.join("\n"), btn = this;
    function ok() { var o = btn.textContent; btn.textContent = T("tool.dl.copied"); setTimeout(function () { btn.textContent = o; }, 1400); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () { message(T("tool.err.clipboard"), true); });
    } else { message(T("tool.err.clipboard"), true); }
  });
  $("btn-excl").addEventListener("click", function () {
    if (!lastResult || !lastResult.excluded.length) return;
    var rows = [[T("tool.excl.rowNo"), T("tool.excl.reasonCol")]];
    var maxw = 0, i, j;
    for (i = 0; i < lastResult.excluded.length; i++) maxw = Math.max(maxw, lastResult.excluded[i].cells.length);
    for (j = 0; j < maxw; j++) rows[0].push(parsed && parsed.headers[j] ? parsed.headers[j] : T("tool.col.n", { n: j + 1 }));
    for (i = 0; i < lastResult.excluded.length; i++) {
      var e = lastResult.excluded[i];
      rows.push([String(e.row), T("tool.excl.reason." + e.reason)].concat(e.cells));
    }
    if (!download(SLUG + "-excluded-" + stamp() + ".csv", toCSV(rows), "text/csv;charset=utf-8"))
      message(T("tool.err.download"), true);
  });

  document.addEventListener("i18n:change", function () {
    fillMonths(parseInt($("s-fy").value, 10) || 1);
    if (parsed) { fillMapSelects(parsed.headers); autoGuess(parsed.headers); refreshNumNote(); refreshDateDetect(); reconcileMode(); }
    if (lastResult) render(lastResult);
    else if (!busy) message(T(parsed ? "tool.res.ready" : "tool.res.empty"));
  });

  restore();
  setTab("dead");
  message(T("tool.res.empty"));
  // TOOLJS:END
})();
