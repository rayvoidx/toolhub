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
  /* =========================================================================
     Safety Stock & Reorder Point Batch Calculator
     pure-static: no network calls, no dependencies, no upload. The sales
     history is parsed, aggregated and rendered entirely inside this tab —
     open DevTools → Network while using it and you will see zero requests.
     ========================================================================= */
  var cfg = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "safety-stock-batch";
  var PREF_KEY = SLUG + ":prefs";
  var WORKER_MIN_BYTES = 2 * 1024 * 1024;  // ≈50k rows — bigger inputs go to a Worker
  var CHUNK_BYTES = 512 * 1024;            // Blob.slice chunk — the whole file is never held as one string
  var SNIFF_BYTES = 256 * 1024;            // head slice used for encoding/delimiter/header/date sniffing
  var MAX_RENDER = 100;                    // DOM cap — the full set goes to the CSV/TSV export
  var Z_TABLE = { "90": 1.2816, "95": 1.6449, "97.5": 1.9600, "99": 2.3263 };

  /* =========================================================================
     CORE — serialised with Function.prototype.toString() so that the Worker and
     the main thread run byte-identical parsing/aggregation code. Keep it free of
     closure references to anything outside itself.
     ========================================================================= */
  function coreFactory() {
    "use strict";
    var MIN_YEAR = 1990, MAX_YEAR = 2100;
    var MAX_WINDOW = 40000;   // guard: a mis-mapped date column must not spin forever

    /* ---- RFC4180 parser, incremental (chunk-safe: quotes and CRLF may straddle chunks) ---- */
    function makeParser(delim) {
      var inQ = false, quotePend = false, lastCR = false;
      var field = "", row = [];
      function endField() { row.push(field); field = ""; }
      function endRow(emit) { endField(); emit(row); row = []; }
      return {
        push: function (chunk, emit) {
          for (var i = 0; i < chunk.length; i++) {
            var ch = chunk.charAt(i);
            if (quotePend) {                       // previous char was a quote inside a quoted field
              quotePend = false;
              if (ch === '"') { field += '"'; continue; }   // "" → literal quote
              inQ = false;                                   // closing quote → fall through
            }
            if (inQ) {
              if (ch === '"') quotePend = true; else field += ch;
              continue;
            }
            if (lastCR) { lastCR = false; if (ch === "\n") continue; }  // CRLF = one row break
            if (ch === '"' && field === "") { inQ = true; continue; }   // quotes only special at field start
            if (ch === delim) { endField(); continue; }
            if (ch === "\r") { lastCR = true; endRow(emit); continue; }
            if (ch === "\n") { endRow(emit); continue; }
            field += ch;
          }
        },
        end: function (emit) {
          if (inQ || quotePend || field !== "" || row.length) endRow(emit);
        }
      };
    }

    function parseText(text, delim, limit) {
      var rows = [], p = makeParser(delim), n = 0;
      function emit(r) { n++; if (limit == null || rows.length < limit) rows.push(r.slice()); }
      p.push(text, emit); p.end(emit);
      return { rows: rows, total: n };
    }

    /* ---- delimiter sniffing: whichever gives the most consistent column count ---- */
    function detectDelim(sample) {
      var cands = [",", ";", "\t"], best = ",", bestScore = -1;
      var cut = sample.lastIndexOf("\n");
      var s = cut > 0 ? sample.slice(0, cut) : sample;   // drop a truncated tail line
      for (var i = 0; i < cands.length; i++) {
        var r = parseText(s, cands[i], 20).rows;
        if (!r.length) continue;
        var counts = {}, modal = 0, modalN = 0;
        for (var j = 0; j < r.length; j++) {
          var c = r[j].length;
          counts[c] = (counts[c] || 0) + 1;
          if (counts[c] > modalN) { modalN = counts[c]; modal = c; }
        }
        var score = modal > 1 ? modal * (modalN / r.length) : 0;
        if (score > bestScore) { bestScore = score; best = cands[i]; }
      }
      return best;
    }

    /* ---- numbers: tolerate thousands separators and accounting negatives, never guess wildly ---- */
    function parseNum(s) {
      s = String(s == null ? "" : s).trim();
      if (!s) return NaN;
      s = s.replace(/[\s '’]/g, "");
      var neg = false;
      if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
      if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");            // 1,234.5
      else if (/^[-+]?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");  // 1.234,5
      else if (/^[-+]?\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, "");          // 1.234.567
      else if (/^[-+]?\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");                    // 12,5
      if (!/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return NaN;
      var v = Number(s);
      return neg ? -v : v;
    }

    /* ---- dates: split first, decide day/month order later (never guess silently) ---- */
    function splitDate(s) {
      s = String(s == null ? "" : s).trim();
      if (!s) return null;
      var m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?![\d])/.exec(s);
      if (m) return { y: +m[1], p: +m[2], q: +m[3], iso: true };
      m = /^(\d{4})(\d{2})(\d{2})(?![\d])/.exec(s);
      if (m) return { y: +m[1], p: +m[2], q: +m[3], iso: true };
      m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})(?![\d])/.exec(s);
      if (m) return { y: +m[3], p: +m[1], q: +m[2], iso: false };
      m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2})(?![\d])/.exec(s);
      if (m) { var yy = +m[3]; return { y: yy + (yy < 70 ? 2000 : 1900), p: +m[1], q: +m[2], iso: false }; }
      return null;
    }
    function toDay(info, fmt) {          // fmt: "dmy" | "mdy" (ignored for ISO rows)
      if (!info) return null;
      var mo, da;
      if (info.iso) { mo = info.p; da = info.q; }
      else if (fmt === "dmy") { da = info.p; mo = info.q; }
      else { mo = info.p; da = info.q; }
      if (info.y < MIN_YEAR || info.y > MAX_YEAR) return null;
      if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
      var d = new Date(Date.UTC(info.y, mo - 1, da));
      if (d.getUTCFullYear() !== info.y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) return null;
      return Math.round(d.getTime() / 86400000);
    }
    function dayToISO(n) {
      var d = new Date(n * 86400000);
      function p2(x) { return (x < 10 ? "0" : "") + x; }
      return d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate());
    }
    /* Scan a sample: can day/month order be settled from the data alone? */
    function sniffDateFmt(rows, col) {
      var dmy = false, mdy = false, iso = 0, seen = 0, bad = 0;
      for (var i = 0; i < rows.length; i++) {
        var v = rows[i][col];
        if (v == null || String(v).trim() === "") continue;
        var info = splitDate(v);
        if (!info) { bad++; continue; }
        seen++;
        if (info.iso) { iso++; continue; }
        if (info.p > 12) dmy = true;      // first number cannot be a month → day first
        if (info.q > 12) mdy = true;      // second number cannot be a month → month first
      }
      if (!seen) return { fmt: null, state: bad ? "unparsable" : "empty" };
      if (iso === seen) return { fmt: "iso", state: "iso" };
      if (dmy && mdy) return { fmt: null, state: "conflict" };
      if (dmy) return { fmt: "dmy", state: "resolved" };
      if (mdy) return { fmt: "mdy", state: "resolved" };
      return { fmt: null, state: "ambiguous" };
    }

    /* ---- incremental aggregator: rows in, per-SKU statistics out ----
       Raw rows never leave this object; only the aggregate does. */
    function makeAgg(opts) {
      var mode = opts.mode, map = opts.map, hasHeader = opts.hasHeader;
      var fmt = opts.dateFmt, zeroFill = opts.zeroFill !== false;
      var pStart = opts.periodStart == null ? null : opts.periodStart;
      var pEnd = opts.periodEnd == null ? null : opts.periodEnd;
      var rowNo = 0, dataRows = 0;
      var ex = { neg: 0, qty: 0, date: 0, sku: 0, period: 0, cols: 0, dupe: 0 };
      var skus = {}, order = [];
      var UNSPEC = "\u0000unspec";

      function bucket(key) {
        var r = skus[key];
        if (!r) { r = skus[key] = { days: {}, min: null, max: null, tx: 0, rows: 0 }; order.push(key); }
        return r;
      }

      function pushRow(row) {
        rowNo++;
        if (hasHeader && rowNo === 1) return;
        if (row.length === 1 && String(row[0]).trim() === "") return;   // blank line
        dataRows++;
        if (mode === "agg") { pushAgg(row); return; }
        var dRaw = map.date >= 0 ? row[map.date] : "";
        var sRaw = map.sku >= 0 ? row[map.sku] : "";
        var qRaw = map.qty >= 0 ? row[map.qty] : "";
        if (map.date >= row.length || map.qty >= row.length) { ex.cols++; return; }
        var info = splitDate(dRaw);
        var day = toDay(info, fmt);
        if (day == null) { ex.date++; return; }
        var qty = parseNum(qRaw);
        if (!isFinite(qty)) { ex.qty++; return; }
        if (qty < 0) { ex.neg++; return; }          // returns are reported, not silently netted
        if (pStart != null && day < pStart) { ex.period++; return; }
        if (pEnd != null && day > pEnd) { ex.period++; return; }
        var sku = String(sRaw == null ? "" : sRaw).trim();
        if (!sku) { sku = UNSPEC; ex.sku++; }       // kept as its own group, never merged away
        var r = bucket(sku);
        if (r.days[day] == null) { r.days[day] = 0; r.tx++; } else { ex.dupe++; }
        r.days[day] += qty;                         // same SKU + same day = one day of demand
        r.rows++;
        if (r.min == null || day < r.min) r.min = day;
        if (r.max == null || day > r.max) r.max = day;
      }

      function pushAgg(row) {
        var sku = String(map.sku >= 0 ? (row[map.sku] || "") : "").trim();
        if (!sku) { sku = UNSPEC; ex.sku++; }
        var dbar = parseNum(map.dbar >= 0 ? row[map.dbar] : "");
        var sig = parseNum(map.sigma >= 0 ? row[map.sigma] : "");
        if (!isFinite(dbar) || dbar < 0) { ex.qty++; return; }
        if (!isFinite(sig) || sig < 0) { ex.qty++; return; }
        var lt = map.lt >= 0 ? parseNum(row[map.lt]) : NaN;
        var r = skus[sku];
        if (!r) { r = skus[sku] = { agg: true }; order.push(sku); }
        r.dbar = dbar; r.sigmad = sig;
        r.ltRaw = isFinite(lt) ? lt : null;
      }

      function finish() {
        var out = [], i, k;
        for (i = 0; i < order.length; i++) {
          k = order[i];
          var r = skus[k];
          var name = k === UNSPEC ? null : k;
          if (mode === "agg") {
            out.push({ sku: name, dbar: r.dbar, sigmad: r.sigmad, obsDays: null,
              txDays: null, zeroDays: 0, ltRaw: r.ltRaw, longWindow: false, from: null, to: null });
            continue;
          }
          var from = pStart != null ? pStart : r.min;
          var to = pEnd != null ? pEnd : r.max;
          var n = 0, mean = 0, m2 = 0, x, delta, tx = 0, d;
          var longWin = (to - from) > MAX_WINDOW;
          if (zeroFill && !longWin) {
            for (d = from; d <= to; d++) {          // Welford over every calendar day in the window
              x = r.days[d] || 0;
              if (r.days[d] != null) tx++;
              n++; delta = x - mean; mean += delta / n; m2 += delta * (x - mean);
            }
          } else {
            for (d in r.days) {                     // selling days only
              if (!r.days.hasOwnProperty(d)) continue;
              x = r.days[d]; tx++;
              n++; delta = x - mean; mean += delta / n; m2 += delta * (x - mean);
            }
          }
          out.push({
            sku: name, dbar: n ? mean : 0, sigmad: n > 1 ? Math.sqrt(m2 / (n - 1)) : null,
            obsDays: n, txDays: tx, zeroDays: zeroFill && !longWin ? n - tx : 0,
            ltRaw: null, longWindow: longWin, from: from == null ? null : dayToISO(from),
            to: to == null ? null : dayToISO(to)
          });
        }
        return { skus: out, excluded: ex, dataRows: dataRows, rowNo: rowNo };
      }

      return { pushRow: pushRow, finish: finish };
    }

    /* ---- encoding: BOM → strict UTF-8 probe → EUC-KR (CP949) fallback for Korean ERP exports ---- */
    function sniffEnc(bytes) {
      if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return "utf-8";
      if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return "utf-16le";
      if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return "utf-16be";
      try { new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true }); return "utf-8"; }
      catch (e) { return "euc-kr"; }
    }

    return {
      makeParser: makeParser, parseText: parseText, detectDelim: detectDelim,
      parseNum: parseNum, splitDate: splitDate, toDay: toDay, dayToISO: dayToISO,
      sniffDateFmt: sniffDateFmt, makeAgg: makeAgg, sniffEnc: sniffEnc
    };
  }

  /* Worker body — same CORE, chunked reads, only the aggregate is posted back. */
  function workerMain() {
    self.onmessage = function (e) {
      var msg = e.data;
      try {
        var agg = CORE.makeAgg(msg.opts);
        var parser = CORE.makeParser(msg.opts.delim);
        function emit(r) { agg.pushRow(r); }
        if (msg.text != null) {
          parser.push(msg.text, emit);
          self.postMessage({ kind: "progress", p: 90 });
        } else {
          var file = msg.file, size = file.size, pos = 0;
          var dec = new TextDecoder(msg.enc);
          var fr = new FileReaderSync();
          while (pos < size) {
            var end = Math.min(pos + msg.chunk, size);
            var buf = fr.readAsArrayBuffer(file.slice(pos, end));
            parser.push(dec.decode(new Uint8Array(buf), { stream: true }), emit);
            pos = end;
            self.postMessage({ kind: "progress", p: Math.round((pos / size) * 90) });
          }
          parser.push(dec.decode(), emit);
        }
        parser.end(emit);
        self.postMessage({ kind: "done", res: agg.finish() });
      } catch (err) {
        self.postMessage({ kind: "error", msg: String(err && err.message || err) });
      }
    };
  }

  var CORE = coreFactory();

  /* =========================================================================
     Public holidays — copied from workday-calc (pure-static, no API).
     RULES are computable (fixed / nth weekday / Easter-relative / JP equinox) so
     they never expire. STATIC holds what a formula cannot express (KR lunar),
     which is why only KR has a year limit. China is deliberately absent: its
     Lunar New Year is set by an annual State Council notice with make-up
     workdays, so no static table can be honest about it.
     ========================================================================= */
  var RULES = {
    "us": [
      { k: "f", m: 1, d: 1, n: "New Year's Day", s: "u" },
      { k: "n", m: 1, w: 1, i: 3, n: "Martin Luther King Jr. Day" },
      { k: "n", m: 2, w: 1, i: 3, n: "Presidents' Day" },
      { k: "l", m: 5, w: 1, n: "Memorial Day" },
      { k: "f", m: 6, d: 19, n: "Juneteenth", s: "u" },
      { k: "f", m: 7, d: 4, n: "Independence Day", s: "u" },
      { k: "n", m: 9, w: 1, i: 1, n: "Labor Day" },
      { k: "n", m: 10, w: 1, i: 2, n: "Columbus Day" },
      { k: "f", m: 11, d: 11, n: "Veterans Day", s: "u" },
      { k: "n", m: 11, w: 4, i: 4, n: "Thanksgiving" },
      { k: "f", m: 12, d: 25, n: "Christmas Day", s: "u" }
    ],
    "uk": [
      { k: "f", m: 1, d: 1, n: "New Year's Day", s: "n" },
      { k: "e", o: -2, n: "Good Friday" },
      { k: "e", o: 1, n: "Easter Monday" },
      { k: "n", m: 5, w: 1, i: 1, n: "Early May bank holiday" },
      { k: "l", m: 5, w: 1, n: "Spring bank holiday" },
      { k: "l", m: 8, w: 1, n: "Summer bank holiday" },
      { k: "f", m: 12, d: 25, n: "Christmas Day", s: "n" },
      { k: "f", m: 12, d: 26, n: "Boxing Day", s: "n" }
    ],
    "ca": [
      { k: "f", m: 1, d: 1, n: "New Year's Day", s: "n" },
      { k: "e", o: -2, n: "Good Friday" },
      { k: "mb", m: 5, d: 25, n: "Victoria Day" },
      { k: "f", m: 7, d: 1, n: "Canada Day", s: "n" },
      { k: "n", m: 9, w: 1, i: 1, n: "Labour Day" },
      { k: "f", m: 9, d: 30, n: "National Day for Truth and Reconciliation", s: "n" },
      { k: "n", m: 10, w: 1, i: 2, n: "Thanksgiving" },
      { k: "f", m: 11, d: 11, n: "Remembrance Day", s: "n" },
      { k: "f", m: 12, d: 25, n: "Christmas Day", s: "n" },
      { k: "f", m: 12, d: 26, n: "Boxing Day", s: "n" }
    ],
    "au": [
      { k: "f", m: 1, d: 1, n: "New Year's Day", s: "n" },
      { k: "f", m: 1, d: 26, n: "Australia Day", s: "n" },
      { k: "e", o: -2, n: "Good Friday" },
      { k: "e", o: 1, n: "Easter Monday" },
      { k: "f", m: 4, d: 25, n: "Anzac Day" },
      { k: "f", m: 12, d: 25, n: "Christmas Day", s: "n" },
      { k: "f", m: 12, d: 26, n: "Boxing Day", s: "n" }
    ],
    "de": [
      { k: "f", m: 1, d: 1, n: "New Year's Day" },
      { k: "e", o: -2, n: "Good Friday" },
      { k: "e", o: 1, n: "Easter Monday" },
      { k: "f", m: 5, d: 1, n: "Labour Day" },
      { k: "e", o: 39, n: "Ascension Day" },
      { k: "e", o: 50, n: "Whit Monday" },
      { k: "f", m: 10, d: 3, n: "German Unity Day" },
      { k: "f", m: 12, d: 25, n: "Christmas Day" },
      { k: "f", m: 12, d: 26, n: "Second Day of Christmas" }
    ],
    "fr": [
      { k: "f", m: 1, d: 1, n: "New Year's Day" },
      { k: "e", o: 1, n: "Easter Monday" },
      { k: "f", m: 5, d: 1, n: "Labour Day" },
      { k: "f", m: 5, d: 8, n: "Victory in Europe Day" },
      { k: "e", o: 39, n: "Ascension Day" },
      { k: "e", o: 50, n: "Whit Monday" },
      { k: "f", m: 7, d: 14, n: "Bastille Day" },
      { k: "f", m: 8, d: 15, n: "Assumption of Mary" },
      { k: "f", m: 11, d: 1, n: "All Saints' Day" },
      { k: "f", m: 11, d: 11, n: "Armistice Day" },
      { k: "f", m: 12, d: 25, n: "Christmas Day" }
    ],
    "es": [
      { k: "f", m: 1, d: 1, n: "New Year's Day" },
      { k: "f", m: 1, d: 6, n: "Epiphany" },
      { k: "e", o: -2, n: "Good Friday" },
      { k: "f", m: 5, d: 1, n: "Labour Day" },
      { k: "f", m: 8, d: 15, n: "Assumption of Mary" },
      { k: "f", m: 10, d: 12, n: "National Day of Spain" },
      { k: "f", m: 11, d: 1, n: "All Saints' Day" },
      { k: "f", m: 12, d: 6, n: "Constitution Day" },
      { k: "f", m: 12, d: 8, n: "Immaculate Conception" },
      { k: "f", m: 12, d: 25, n: "Christmas Day" }
    ],
    "br": [
      { k: "f", m: 1, d: 1, n: "New Year's Day" },
      { k: "e", o: -48, n: "Carnival Monday" },
      { k: "e", o: -47, n: "Carnival Tuesday" },
      { k: "e", o: -2, n: "Good Friday" },
      { k: "f", m: 4, d: 21, n: "Tiradentes' Day" },
      { k: "f", m: 5, d: 1, n: "Labour Day" },
      { k: "e", o: 60, n: "Corpus Christi" },
      { k: "f", m: 9, d: 7, n: "Independence Day" },
      { k: "f", m: 10, d: 12, n: "Our Lady of Aparecida" },
      { k: "f", m: 11, d: 2, n: "All Souls' Day" },
      { k: "f", m: 11, d: 15, n: "Republic Proclamation Day" },
      { k: "f", m: 11, d: 20, n: "Black Awareness Day" },
      { k: "f", m: 12, d: 25, n: "Christmas Day" }
    ],
    "mx": [
      { k: "f", m: 1, d: 1, n: "New Year's Day" },
      { k: "n", m: 2, w: 1, i: 1, n: "Constitution Day" },
      { k: "n", m: 3, w: 1, i: 3, n: "Benito Juárez's Birthday" },
      { k: "f", m: 5, d: 1, n: "Labour Day" },
      { k: "f", m: 9, d: 16, n: "Independence Day" },
      { k: "n", m: 11, w: 1, i: 3, n: "Revolution Day" },
      { k: "f", m: 12, d: 25, n: "Christmas Day" }
    ],
    "in": [
      { k: "f", m: 1, d: 26, n: "Republic Day" },
      { k: "f", m: 8, d: 15, n: "Independence Day" },
      { k: "f", m: 10, d: 2, n: "Gandhi Jayanti" }
    ],
    "ru": [
      { k: "f", m: 1, d: 1, n: "New Year holiday" },
      { k: "f", m: 1, d: 2, n: "New Year holiday" },
      { k: "f", m: 1, d: 3, n: "New Year holiday" },
      { k: "f", m: 1, d: 4, n: "New Year holiday" },
      { k: "f", m: 1, d: 5, n: "New Year holiday" },
      { k: "f", m: 1, d: 6, n: "New Year holiday" },
      { k: "f", m: 1, d: 7, n: "Orthodox Christmas Day" },
      { k: "f", m: 1, d: 8, n: "New Year holiday" },
      { k: "f", m: 2, d: 23, n: "Defender of the Fatherland Day", s: "n" },
      { k: "f", m: 3, d: 8, n: "International Women's Day", s: "n" },
      { k: "f", m: 5, d: 1, n: "Spring and Labour Day", s: "n" },
      { k: "f", m: 5, d: 9, n: "Victory Day", s: "n" },
      { k: "f", m: 6, d: 12, n: "Russia Day", s: "n" },
      { k: "f", m: 11, d: 4, n: "Unity Day", s: "n" }
    ],
    "jp": [
      { k: "f", m: 1, d: 1, n: "New Year's Day" },
      { k: "n", m: 1, w: 1, i: 2, n: "Coming of Age Day" },
      { k: "f", m: 2, d: 11, n: "National Foundation Day" },
      { k: "f", m: 2, d: 23, n: "Emperor's Birthday" },
      { k: "q", sp: true, n: "Vernal Equinox Day" },
      { k: "f", m: 4, d: 29, n: "Shōwa Day" },
      { k: "f", m: 5, d: 3, n: "Constitution Memorial Day" },
      { k: "f", m: 5, d: 4, n: "Greenery Day" },
      { k: "f", m: 5, d: 5, n: "Children's Day" },
      { k: "n", m: 7, w: 1, i: 3, n: "Marine Day" },
      { k: "f", m: 8, d: 11, n: "Mountain Day" },
      { k: "n", m: 9, w: 1, i: 3, n: "Respect for the Aged Day" },
      { k: "q", sp: false, n: "Autumnal Equinox Day" },
      { k: "n", m: 10, w: 1, i: 2, n: "Sports Day" },
      { k: "f", m: 11, d: 3, n: "Culture Day" },
      { k: "f", m: 11, d: 23, n: "Labour Thanksgiving Day" }
    ]
  };
  var STATIC = {
    "kr": {
      "2025-01-01": "New Year's Day", "2025-01-27": "Temporary Holiday",
      "2025-01-28": "Seollal", "2025-01-29": "Seollal", "2025-01-30": "Seollal",
      "2025-03-01": "Independence Movement Day", "2025-03-03": "Substitute Holiday",
      "2025-05-05": "Children's Day / Buddha's Birthday", "2025-05-06": "Substitute Holiday",
      "2025-06-06": "Memorial Day", "2025-08-15": "Liberation Day",
      "2025-10-03": "National Foundation Day", "2025-10-05": "Chuseok",
      "2025-10-06": "Chuseok", "2025-10-07": "Chuseok",
      "2025-10-08": "Substitute Holiday", "2025-10-09": "Hangeul Day", "2025-12-25": "Christmas Day",
      "2026-01-01": "New Year's Day",
      "2026-02-16": "Seollal", "2026-02-17": "Seollal", "2026-02-18": "Seollal",
      "2026-03-01": "Independence Movement Day", "2026-03-02": "Substitute Holiday",
      "2026-05-05": "Children's Day", "2026-05-24": "Buddha's Birthday", "2026-05-25": "Substitute Holiday",
      "2026-06-06": "Memorial Day", "2026-08-15": "Liberation Day", "2026-08-17": "Substitute Holiday",
      "2026-09-24": "Chuseok", "2026-09-25": "Chuseok",
      "2026-09-26": "Chuseok", "2026-09-28": "Substitute Holiday",
      "2026-10-03": "National Foundation Day", "2026-10-05": "Substitute Holiday",
      "2026-10-09": "Hangeul Day", "2026-12-25": "Christmas Day",
      "2027-01-01": "New Year's Day",
      "2027-02-05": "Seollal", "2027-02-06": "Seollal", "2027-02-07": "Seollal",
      "2027-02-08": "Substitute Holiday", "2027-03-01": "Independence Movement Day",
      "2027-05-05": "Children's Day", "2027-05-13": "Buddha's Birthday",
      "2027-06-06": "Memorial Day", "2027-08-15": "Liberation Day", "2027-08-16": "Substitute Holiday",
      "2027-09-14": "Chuseok", "2027-09-15": "Chuseok",
      "2027-09-16": "Chuseok", "2027-10-03": "National Foundation Day",
      "2027-10-04": "Substitute Holiday", "2027-10-09": "Hangeul Day", "2027-10-11": "Substitute Holiday",
      "2027-12-25": "Christmas Day", "2027-12-27": "Substitute Holiday"
    }
  };
  var STATIC_RANGE = { "kr": { from: 2025, to: 2027 } };
  var COUNTRIES = [
    { c: "au", en: "Australia" }, { c: "br", en: "Brazil" }, { c: "ca", en: "Canada" },
    { c: "fr", en: "France" }, { c: "de", en: "Germany" }, { c: "in", en: "India" },
    { c: "jp", en: "Japan" }, { c: "mx", en: "Mexico" }, { c: "ru", en: "Russia" },
    { c: "kr", en: "South Korea" }, { c: "es", en: "Spain" }, { c: "uk", en: "United Kingdom" },
    { c: "us", en: "United States" }
  ];
  var REGION_COUNTRY = { US: "us", GB: "uk", CA: "ca", AU: "au", DE: "de", FR: "fr", ES: "es", BR: "br", MX: "mx", IN: "in", RU: "ru", JP: "jp", KR: "kr" };
  var FRISAT_REGIONS = { SA: 1, EG: 1, BD: 1, IL: 1, KW: 1, QA: 1, BH: 1, OM: 1, JO: 1, IQ: 1, LY: 1, DZ: 1, SY: 1, YE: 1, MV: 1, PS: 1, SD: 1 };

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function toKey(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function nthDow(y, m, w, i) { var d = new Date(y, m - 1, 1), shift = (w - d.getDay() + 7) % 7; return new Date(y, m - 1, 1 + shift + (i - 1) * 7); }
  function lastDow(y, m, w) { var d = new Date(y, m, 0), back = (d.getDay() - w + 7) % 7; return new Date(y, m - 1, d.getDate() - back); }
  function mondayBefore(y, m, d) { var t = new Date(y, m - 1, d), back = (t.getDay() + 6) % 7; if (back === 0) back = 7; return addDays(t, -back); }
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7,
      m = Math.floor((a + 11 * h + 22 * l) / 451),
      mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, mo - 1, da);
  }
  function jpEquinox(y, sp) {
    var base = sp ? 20.8431 : 23.2488;
    return new Date(y, sp ? 2 : 8, Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)));
  }
  function ruleDate(r, y) {
    switch (r.k) {
      case "f": return new Date(y, r.m - 1, r.d);
      case "n": return nthDow(y, r.m, r.w, r.i);
      case "l": return lastDow(y, r.m, r.w);
      case "e": return addDays(easter(y), r.o);
      case "q": return jpEquinox(y, r.sp);
      case "mb": return mondayBefore(y, r.m, r.d);
    }
    return null;
  }
  var yearCache = {};
  function yearHolidays(c, y) {
    var ck = c + ":" + y;
    if (yearCache[ck]) return yearCache[ck];
    var out = {}, rules = RULES[c] || [], i, r, d, name, nd, g, k;
    for (i = 0; i < rules.length; i++) {
      r = rules[i]; d = ruleDate(r, y);
      if (!d) continue;
      name = r.n;
      if (r.s === "u") {
        if (d.getDay() === 6) { d = addDays(d, -1); name += " (observed)"; }
        else if (d.getDay() === 0) { d = addDays(d, 1); name += " (observed)"; }
      } else if (r.s === "n") {
        if (d.getDay() === 0 || d.getDay() === 6) {
          nd = addDays(d, 1); g = 0;
          while ((nd.getDay() === 0 || nd.getDay() === 6 || out[toKey(nd)] != null) && g++ < 14) nd = addDays(nd, 1);
          d = nd; name += " (substitute)";
        }
      }
      if (out[toKey(d)] == null) out[toKey(d)] = name;
    }
    if (c === "jp") {
      var base = {}, keys;
      for (k in out) if (out.hasOwnProperty(k)) base[k] = out[k];
      keys = Object.keys(base).sort();
      keys.forEach(function (kk) {
        var bd = new Date(kk.slice(0, 4), +kk.slice(5, 7) - 1, +kk.slice(8, 10));
        if (bd.getDay() !== 0) return;
        var x = addDays(bd, 1), gg = 0;
        while (out[toKey(x)] != null && gg++ < 14) x = addDays(x, 1);
        if (out[toKey(x)] == null) out[toKey(x)] = "Substitute Holiday";
      });
      keys.forEach(function (kk) {
        var a = new Date(kk.slice(0, 4), +kk.slice(5, 7) - 1, +kk.slice(8, 10));
        var mid = addDays(a, 1), b2 = addDays(a, 2);
        if (base[toKey(b2)] == null) return;
        if (out[toKey(mid)] != null || mid.getDay() === 0) return;
        out[toKey(mid)] = "Citizens' Holiday";
      });
    }
    var st = STATIC[c];
    if (st) { for (k in st) if (st.hasOwnProperty(k) && k.slice(0, 4) === String(y)) out[k] = st[k]; }
    yearCache[ck] = out;
    return out;
  }
  function holidayMap(c, minY, maxY) {
    var map = {}, y, k, src;
    if (c && c !== "none" && (RULES[c] || STATIC[c])) {
      for (y = minY - 1; y <= maxY + 1; y++) {
        src = yearHolidays(c, y);
        for (k in src) if (src.hasOwnProperty(k)) map[k] = src[k];
      }
    }
    return map;
  }
  /* Business days → calendar days. A 5-business-day lead time placed today is not
     5 calendar days of demand exposure, so the formula needs the calendar span. */
  var spanCache = {};
  function busSpan(n, country, weekend) {
    var ck = n + "|" + country + "|" + weekend;
    if (spanCache[ck]) return spanCache[ck];
    var whole = Math.ceil(n);
    var d = new Date(); d.setHours(12, 0, 0, 0);
    var y0 = d.getFullYear();
    var map = holidayMap(country, y0, y0 + Math.ceil(whole / 200) + 1);
    var wk = weekend === "frisat" ? { 5: 1, 6: 1 } : { 0: 1, 6: 1 };
    var counted = 0, span = 0, guard = 0, outside = false;
    while (counted < whole && guard++ < 20000) {
      d = addDays(d, 1); span++;
      var lim = STATIC_RANGE[country];
      if (lim && (d.getFullYear() < lim.from || d.getFullYear() > lim.to)) outside = true;
      if (!wk[d.getDay()] && map[toKey(d)] == null) counted++;
    }
    var ratio = whole ? span / whole : 1;
    var res = { span: n === whole ? span : Math.round(n * ratio * 100) / 100, ratio: ratio, outside: outside };
    spanCache[ck] = res;
    return res;
  }
  function detectRegion() {
    var langs = [], i, m;
    try { if (navigator.languages && navigator.languages.length) langs = [].slice.call(navigator.languages); } catch (e) { /* noop */ }
    try { if (navigator.language) langs.push(navigator.language); } catch (e) { /* noop */ }
    for (i = 0; i < langs.length; i++) {
      m = /[-_]([A-Za-z]{2})$/.exec(String(langs[i] || ""));
      if (m) return m[1].toUpperCase();
    }
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      if (/Seoul/.test(tz)) return "KR"; if (/Tokyo/.test(tz)) return "JP";
    } catch (e) { /* noop */ }
    return "US";
  }

  /* =========================================================================
     i18n / formatting helpers
     ========================================================================= */
  function tr(k, d) { try { var v = window.I18N && window.I18N.t(k); return v == null ? d : v; } catch (e) { return d; } }
  function curLang() { try { return (window.I18N && window.I18N.lang()) || "en"; } catch (e) { return "en"; } }
  function fmt(s, map) { return String(s).replace(/\{(\w+)\}/g, function (_, k) { return map[k] != null ? map[k] : "{" + k + "}"; }); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(v, dp) {
    if (v == null || !isFinite(v)) return "—";
    try { return new Intl.NumberFormat(curLang(), { maximumFractionDigits: dp == null ? 2 : dp }).format(v); }
    catch (e) { return String(Math.round(v * 100) / 100); }
  }
  function raw(v, dp) { return (v == null || !isFinite(v)) ? "" : String(Math.round(v * Math.pow(10, dp == null ? 2 : dp)) / Math.pow(10, dp == null ? 2 : dp)); }

  /* =========================================================================
     Preferences — localStorage, "<slug>:" prefixed. Only settings are stored:
     the sales history and on-hand data live in memory and die on refresh.
     ========================================================================= */
  var storageOk = true;
  (function () { try { localStorage.setItem(SLUG + ":_t", "1"); localStorage.removeItem(SLUG + ":_t"); } catch (e) { storageOk = false; } })();
  var prefs = (function () {
    if (!storageOk) return {};
    try { var r = localStorage.getItem(PREF_KEY); return r ? JSON.parse(r) : {}; } catch (e) { return {}; }
  })();
  function savePrefs() {
    if (!storageOk) return;
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* quota / private mode */ }
  }

  /* =========================================================================
     DOM
     ========================================================================= */
  var $ = function (id) { return document.getElementById(id); };
  var elMode = { history: $("mode-history"), agg: $("mode-agg") };
  var modeHint = $("mode-hint");
  var drop = $("drop"), fileInput = $("file-input"), pickBtn = $("pick-btn");
  var pasteEl = $("in-paste"), sampleBtn = $("sample-btn"), clearBtn = $("clear-btn");
  var srcNote = $("src-note");
  var encEl = $("in-enc"), delimEl = $("in-delim"), headerEl = $("in-header");
  var mapWrap = $("map-wrap"), mapFields = $("map-fields"), previewWrap = $("preview-wrap");
  var dateFmtRow = $("datefmt-row"), dateFmtEl = $("in-datefmt"), dateFmtNote = $("datefmt-note");
  var svcEl = $("in-svc"), ltEl = $("in-lt"), ltUnitEl = $("in-ltunit");
  var busWrap = $("bus-wrap"), countryEl = $("in-country"), weekendEl = $("in-weekend"), busNote = $("bus-note");
  var zeroEl = $("in-zero"), unitEl = $("in-unit");
  var perStartEl = $("in-perstart"), perEndEl = $("in-perend");
  var secPasteEl = $("in-sec"), secMapWrap = $("sec-map"), secNote = $("sec-note");
  var secFileInput = $("sec-file"), secPickBtn = $("sec-pick-btn");
  var revEl = $("in-rev"), eoqSEl = $("in-eoq-s"), eoqHEl = $("in-eoq-h");
  var calcBtn = $("calc-btn"), cancelBtn = $("cancel-btn"), progWrap = $("progress"), progBar = $("prog-bar"), progTxt = $("prog-txt");
  var resultEl = $("result");

  /* =========================================================================
     State (in memory only — never persisted)
     ========================================================================= */
  var mode = prefs.mode === "agg" ? "agg" : "history";
  var srcFile = null;          // File currently loaded (raw bytes stay here)
  var sniff = null;            // { headers, rows, ncols, delim, enc, dateFmt, dateState }
  var lastAgg = null;          // aggregate result (per-SKU stats only)
  var secMap = null;           // sku → { lt, sigmaLT, onHand }
  var secCols = null;
  var secRows = null;
  var view = { sort: "sku", dir: 1, reorderOnly: false, q: "" };
  var worker = null, running = false, runToken = 0;
  var lastRender = null;

  var MAP_FIELDS = {
    history: [
      { id: "date", key: "tool.map.date", def: "Date", req: true, re: /date|일자|날짜|일시|출고|판매일|fecha|datum|дата|日付|日期|tanggal|تاريخ|तारीख|তারিখ|تاریخ/i },
      { id: "sku", key: "tool.map.sku", def: "SKU / item code", req: true, re: /sku|item|product|part|code|material|品番|品目|品名|商品|物料|코드|품목|상품|자재|제품|artikel|producto|artículo|produit|товар|kode|barang|منتج|कोड|পণ্য/i },
      { id: "qty", key: "tool.map.qty", def: "Quantity sold / shipped", req: true, re: /qty|quantity|units|sold|shipped|issue|demand|수량|판매|출고|소요|数量|个数|menge|cantidad|quantité|quantidade|кол|jumlah|كمية|मात्रा|পরিমাণ/i }
    ],
    agg: [
      { id: "sku", key: "tool.map.sku", def: "SKU / item code", req: true, re: /sku|item|product|part|code|품목|코드|品番|artikel|producto|товар/i },
      { id: "dbar", key: "tool.map.dbar", def: "Average daily demand (d̄)", req: true, re: /avg|average|mean|daily|d̄|dbar|평균|일평균|平均|durchschnitt|promedio|moyenne|média|сред|rata/i },
      { id: "sigma", key: "tool.map.sigma", def: "Demand std. deviation (σd)", req: true, re: /std|stdev|sigma|σ|deviation|편차|표준|標準|abweichung|desv|écart|откл|deviasi/i },
      { id: "lt", key: "tool.map.lt", def: "Lead time", req: false, re: /lead|^lt$|리드|납기|조달|リード|納期|lieferzeit|plazo|délai|prazo|срок|waktu/i }
    ]
  };
  var SEC_FIELDS = [
    { id: "sku", key: "tool.map.sku", def: "SKU / item code", req: true, re: /sku|item|product|part|code|품목|코드|品番|artikel|producto|товар/i },
    { id: "lt", key: "tool.map.lt", def: "Lead time", req: false, re: /lead|^lt$|리드|납기|조달|リード|納期|lieferzeit|plazo|délai|prazo|срок/i },
    { id: "slt", key: "tool.map.slt", def: "Lead-time std. deviation (σLT)", req: false, re: /lt.*(std|dev|sigma|σ)|(std|dev|sigma|σ).*lt|리드.*편차|납기.*편차/i },
    { id: "onhand", key: "tool.map.onhand", def: "On-hand stock", req: false, re: /on.?hand|stock|inventory|현재고|재고|在庫|库存|bestand|existencias|stock|остат|persediaan/i }
  ];

  /* =========================================================================
     Sniffing — read only the head of the file so a 200MB export still responds
     ========================================================================= */
  function guessCols(fields, headers, rows, ncols) {
    var used = {}, out = {}, i, f, j;
    for (i = 0; i < fields.length; i++) out[fields[i].id] = -1;
    if (headers) {                                   // 1) by header name
      for (i = 0; i < fields.length; i++) {
        f = fields[i];
        for (j = 0; j < headers.length; j++) {
          if (used[j]) continue;
          if (f.re.test(String(headers[j] || ""))) { out[f.id] = j; used[j] = 1; break; }
        }
      }
    }
    for (i = 0; i < fields.length; i++) {            // 2) by content, for whatever is left
      f = fields[i];
      if (out[f.id] !== -1) continue;
      for (j = 0; j < ncols; j++) {
        if (used[j]) continue;
        var ok = 0, seen = 0;
        for (var r = 0; r < rows.length; r++) {
          var v = rows[r][j];
          if (v == null || String(v).trim() === "") continue;
          seen++;
          if (f.id === "date") { if (CORE.splitDate(v)) ok++; }
          else if (f.id === "sku") { if (!isFinite(CORE.parseNum(v)) && !CORE.splitDate(v)) ok++; }
          else { if (isFinite(CORE.parseNum(v))) ok++; }
        }
        if (seen && ok / seen >= 0.6) { out[f.id] = j; used[j] = 1; break; }
      }
    }
    return out;
  }

  function sniffText(text, encName, fileName, fileSize) {
    var delim = delimEl.value === "auto" ? CORE.detectDelim(text) : (delimEl.value === "tab" ? "\t" : delimEl.value);
    var pr = CORE.parseText(text, delim, 60);
    var rows = pr.rows.filter(function (r) { return !(r.length === 1 && String(r[0]).trim() === ""); });
    if (!rows.length) return null;
    var ncols = 0;
    for (var i = 0; i < rows.length; i++) ncols = Math.max(ncols, rows[i].length);
    var headers = headerEl.checked ? rows[0] : null;
    var body = headerEl.checked ? rows.slice(1) : rows;
    sniff = {
      delim: delim, enc: encName, headers: headers, body: body, ncols: ncols,
      fileName: fileName, fileSize: fileSize, map: null, dateFmt: null, dateState: null
    };
    sniff.map = guessCols(MAP_FIELDS[mode], headers, body, ncols);
    if (mode === "history" && sniff.map.date >= 0) {
      var s = CORE.sniffDateFmt(body, sniff.map.date);
      sniff.dateFmt = s.fmt; sniff.dateState = s.state;
    }
    return sniff;
  }

  function readHead(file, cb) {
    var fr = new FileReader();
    fr.onerror = function () { cb(null, null); };
    fr.onload = function () {
      var bytes = new Uint8Array(fr.result);
      var enc = encEl.value === "auto" ? CORE.sniffEnc(bytes) : encEl.value;
      var text;
      try { text = new TextDecoder(enc).decode(bytes, { stream: true }); }
      catch (e) { cb(null, enc); return; }
      cb(text, enc);
    };
    fr.readAsArrayBuffer(file.slice(0, Math.min(SNIFF_BYTES, file.size)));
  }

  /* =========================================================================
     Running the aggregation
     ========================================================================= */
  function buildOpts() {
    var m = sniff.map;
    var opts = {
      mode: mode, hasHeader: !!headerEl.checked, delim: sniff.delim,
      map: { date: m.date == null ? -1 : m.date, sku: m.sku == null ? -1 : m.sku, qty: m.qty == null ? -1 : m.qty,
        dbar: m.dbar == null ? -1 : m.dbar, sigma: m.sigma == null ? -1 : m.sigma, lt: m.lt == null ? -1 : m.lt },
      dateFmt: dateFmtEl.value === "auto" ? sniff.dateFmt : dateFmtEl.value,
      zeroFill: !!zeroEl.checked,
      periodStart: dayOf(perStartEl.value), periodEnd: dayOf(perEndEl.value)
    };
    return opts;
  }
  function dayOf(v) {
    if (!v) return null;
    var info = CORE.splitDate(v);
    return CORE.toDay(info, "iso");
  }

  function setRunning(on, p) {
    running = on;
    calcBtn.disabled = on;
    cancelBtn.hidden = !on;
    progWrap.hidden = !on;
    if (on) {
      progBar.style.width = (p || 0) + "%";
      progTxt.textContent = fmt(tr("tool.progress", "Processing… {p}%"), { p: p || 0 });
    }
  }
  function stopRun() {
    runToken++;
    if (worker) { try { worker.terminate(); } catch (e) { /* noop */ } worker = null; }
    setRunning(false);
  }

  function runAggregate() {
    if (!sniff) { showEmpty(); return; }
    var err = validate();
    if (err) { showError(err); return; }
    var opts = buildOpts();
    stopRun();
    var token = ++runToken;
    setRunning(true, 0);
    var big = srcFile ? srcFile.size > WORKER_MIN_BYTES : pasteEl.value.length > WORKER_MIN_BYTES;
    if (big && typeof Worker !== "undefined" && typeof Blob !== "undefined" && typeof URL !== "undefined" && URL.createObjectURL) {
      if (tryWorker(token, opts)) return;
    }
    mainThreadRun(token, opts);
  }

  function tryWorker(token, opts) {
    var url = null;
    try {
      var src = "var CORE=(" + coreFactory.toString() + ")();(" + workerMain.toString() + ")();";
      url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      worker = new Worker(url);
    } catch (e) {
      if (url) { try { URL.revokeObjectURL(url); } catch (e2) { /* noop */ } }
      return false;                                   // no Worker → main thread does the same job
    }
    var settled = false;
    worker.onmessage = function (e) {
      if (token !== runToken) return;
      var m = e.data;
      if (m.kind === "progress") { setRunning(true, m.p); return; }
      settled = true;
      try { URL.revokeObjectURL(url); } catch (e2) { /* noop */ }
      if (m.kind === "done") { setRunning(false); finishRun(m.res); }
      else { setRunning(false); showError({ key: "tool.err.parse", def: "Could not read this file: {m}", vars: { m: m.msg } }); }
      if (worker) { worker.terminate(); worker = null; }
    };
    worker.onerror = function () {
      if (settled || token !== runToken) return;
      settled = true;                                 // Worker unavailable (CSP, blob URL) → fall back, don't fail
      try { URL.revokeObjectURL(url); } catch (e2) { /* noop */ }
      if (worker) { worker.terminate(); worker = null; }
      mainThreadRun(token, opts);
    };
    try {
      worker.postMessage(srcFile
        ? { opts: opts, file: srcFile, enc: sniff.enc, chunk: CHUNK_BYTES, text: null }
        : { opts: opts, file: null, text: pasteEl.value, enc: "utf-8", chunk: CHUNK_BYTES });
    } catch (e) {
      settled = true;
      if (worker) { worker.terminate(); worker = null; }
      return false;
    }
    return true;
  }

  /* Main thread path — chunked as well, so a 10MB+ file is never one big string. */
  function mainThreadRun(token, opts) {
    var agg = CORE.makeAgg(opts);
    var parser = CORE.makeParser(opts.delim);
    function emit(r) { agg.pushRow(r); }
    if (!srcFile) {
      var text = pasteEl.value;
      var pos = 0;
      (function step() {
        if (token !== runToken) return;
        var end = Math.min(pos + 400000, text.length);
        parser.push(text.slice(pos, end), emit);
        pos = end;
        if (pos < text.length) { setRunning(true, Math.round(pos / text.length * 90)); setTimeout(step, 0); return; }
        parser.end(emit);
        setRunning(false);
        finishRun(agg.finish());
      })();
      return;
    }
    var dec;
    try { dec = new TextDecoder(sniff.enc); }
    catch (e) { setRunning(false); showError({ key: "tool.err.enc", def: "This browser cannot decode {enc}. Re-save the file as UTF-8.", vars: { enc: sniff.enc } }); return; }
    var size = srcFile.size, at = 0;
    (function step() {
      if (token !== runToken) return;
      var end = Math.min(at + CHUNK_BYTES, size);
      var fr = new FileReader();
      fr.onerror = function () { setRunning(false); showError({ key: "tool.err.fileRead", def: "The file could not be read. It may have been moved or changed." }); };
      fr.onload = function () {
        if (token !== runToken) return;
        try { parser.push(dec.decode(new Uint8Array(fr.result), { stream: true }), emit); }
        catch (e2) { setRunning(false); showError({ key: "tool.err.enc", def: "This browser cannot decode {enc}. Re-save the file as UTF-8.", vars: { enc: sniff.enc } }); return; }
        at = end;
        setRunning(true, Math.round(at / size * 90));
        if (at < size) { setTimeout(step, 0); return; }
        try { parser.push(dec.decode(), emit); } catch (e3) { /* nothing pending */ }
        parser.end(emit);
        setRunning(false);
        finishRun(agg.finish());
      };
      fr.readAsArrayBuffer(srcFile.slice(at, end));
    })();
  }

  function finishRun(res) {
    lastAgg = res;
    mergeSecondary();
    render();
  }

  /* Lead time / σLT / on-hand by SKU — small file, parsed on the main thread. */
  function parseSecondary() {
    secMap = null; secCols = null; secRows = null;
    var txt = secPasteEl.value;
    if (!txt || !txt.trim()) { renderSecMap(); return; }
    var delim = CORE.detectDelim(txt.slice(0, SNIFF_BYTES));
    var pr = CORE.parseText(txt, delim, 20000);
    var rows = pr.rows.filter(function (r) { return !(r.length === 1 && String(r[0]).trim() === ""); });
    if (!rows.length) { renderSecMap(); return; }
    var ncols = 0;
    for (var i = 0; i < rows.length; i++) ncols = Math.max(ncols, rows[i].length);
    var looksHeader = rows[0].some(function (c) { return !isFinite(CORE.parseNum(c)) && String(c).trim() !== ""; })
      && rows.length > 1 && SEC_FIELDS.some(function (f) { return rows[0].some(function (c) { return f.re.test(String(c)); }); });
    var headers = looksHeader ? rows[0] : null;
    var body = looksHeader ? rows.slice(1) : rows;
    secCols = { ncols: ncols, headers: headers, map: guessCols(SEC_FIELDS, headers, body, ncols) };
    secRows = body;
    renderSecMap();
    buildSecMap();
  }
  function buildSecMap() {
    if (!secCols || !secRows) { secMap = null; return; }
    var m = secCols.map, out = {}, n = 0, bad = 0;
    for (var i = 0; i < secRows.length; i++) {
      var row = secRows[i];
      var sku = String(m.sku >= 0 ? (row[m.sku] || "") : "").trim();
      if (!sku) { bad++; continue; }
      var rec = {};
      if (m.lt >= 0) { var lt = CORE.parseNum(row[m.lt]); rec.lt = isFinite(lt) ? lt : null; }
      if (m.slt >= 0) { var sl = CORE.parseNum(row[m.slt]); rec.slt = isFinite(sl) && sl >= 0 ? sl : null; }
      if (m.onhand >= 0) { var oh = CORE.parseNum(row[m.onhand]); rec.onhand = isFinite(oh) ? oh : null; }
      out[sku] = rec; n++;
    }
    secMap = n ? out : null;
    secNote.hidden = !n && !bad;
    secNote.textContent = fmt(tr("tool.sec.loaded", "{n} SKUs loaded · {bad} rows without an SKU skipped"), { n: n, bad: bad });
  }
  function mergeSecondary() {
    if (!lastAgg) return;
    var i, r;
    for (i = 0; i < lastAgg.skus.length; i++) {
      r = lastAgg.skus[i];
      r.secLT = null; r.secSLT = null; r.onHand = null; r.noSales = false;
      var s = secMap && r.sku != null ? secMap[r.sku] : null;
      if (s) { r.secLT = s.lt == null ? null : s.lt; r.secSLT = s.slt == null ? null : s.slt; r.onHand = s.onhand == null ? null : s.onhand; }
    }
    if (!secMap) return;
    var have = {};
    for (i = 0; i < lastAgg.skus.length; i++) if (lastAgg.skus[i].sku != null) have[lastAgg.skus[i].sku] = 1;
    for (var k in secMap) {                       // SKUs with a lead time but no sales at all
      if (!secMap.hasOwnProperty(k) || have[k]) continue;
      lastAgg.skus.push({
        sku: k, dbar: 0, sigmad: 0, obsDays: 0, txDays: 0, zeroDays: 0, longWindow: false,
        from: null, to: null, ltRaw: null, noSales: true,
        secLT: secMap[k].lt == null ? null : secMap[k].lt,
        secSLT: secMap[k].slt == null ? null : secMap[k].slt,
        onHand: secMap[k].onhand == null ? null : secMap[k].onhand
      });
    }
  }

  /* =========================================================================
     Safety stock maths — instant, so every setting re-renders without re-parsing
     ========================================================================= */
  function settings() {
    var z = Z_TABLE[svcEl.value] != null ? Z_TABLE[svcEl.value] : Z_TABLE["95"];
    var defLT = CORE.parseNum(ltEl.value);
    var R = CORE.parseNum(revEl.value);
    var S = CORE.parseNum(eoqSEl.value);
    var H = CORE.parseNum(eoqHEl.value);
    return {
      z: z, svc: svcEl.value, defLT: isFinite(defLT) ? defLT : null,
      busMode: ltUnitEl.value === "bus", country: countryEl.value, weekend: weekendEl.value,
      R: isFinite(R) && R > 0 ? R : 0,
      S: isFinite(S) && S > 0 ? S : null, H: isFinite(H) && H > 0 ? H : null,
      unit: (unitEl.value || "").trim()
    };
  }

  function derive(r, s) {
    var o = { sku: r.sku, dbar: r.dbar, sigmad: r.sigmad, obsDays: r.obsDays, zeroDays: r.zeroDays,
      onHand: r.onHand, warn: [], ss: null, rop: null, eoq: null, lt: null, ltCal: null, order: false };
    var lt = r.secLT != null ? r.secLT : (r.ltRaw != null ? r.ltRaw : s.defLT);
    if (lt == null || !isFinite(lt) || lt <= 0) { o.warn.push("badLT"); o.bad = true; return o; }
    o.lt = lt;
    var sLT = r.secSLT != null ? r.secSLT : 0;
    if (s.busMode) {
      var sp = busSpan(lt, s.country, s.weekend);
      o.ltCal = sp.span; o.busOutside = sp.outside;
      sLT = sLT * sp.ratio;
    } else { o.ltCal = lt; }
    if (r.noSales) { o.warn.push("noSales"); o.ss = 0; o.rop = 0; o.sigmad = 0; o.dbar = 0; }
    if (r.longWindow) o.warn.push("longWindow");
    if (!r.noSales && (r.sigmad == null || !isFinite(r.sigmad))) {
      o.warn.push("noSigma"); o.bad = true; return o;   // n<2 → σ undefined → refuse, do not print a number
    }
    if (!r.noSales) {
      if (r.obsDays != null && r.obsDays >= 2 && r.obsDays < 14) o.warn.push("sampleLow");
      if (r.sigmad === 0) o.warn.push("flat");
      var protect = o.ltCal + s.R;
      o.protect = protect;
      o.ss = s.z * Math.sqrt(protect * r.sigmad * r.sigmad + r.dbar * r.dbar * sLT * sLT);
      o.rop = r.dbar * protect + o.ss;
      if (s.S != null && s.H != null) {
        var D = r.dbar * 365;
        o.eoq = D > 0 ? Math.sqrt(2 * D * s.S / s.H) : 0;
      }
    }
    if (o.onHand != null && o.rop != null) o.order = o.onHand <= o.rop;
    return o;
  }

  /* =========================================================================
     Validation — every refusal says why (no silent fallbacks)
     ========================================================================= */
  function validate() {
    if (!sniff || !sniff.body || !sniff.body.length) return { key: "tool.err.noRows", def: "No data rows found. Check the header row setting and the delimiter." };
    var fields = MAP_FIELDS[mode], missing = [];
    for (var i = 0; i < fields.length; i++) {
      if (fields[i].req && (sniff.map[fields[i].id] == null || sniff.map[fields[i].id] < 0)) missing.push(tr(fields[i].key, fields[i].def));
    }
    if (missing.length) return { key: "tool.err.map", def: "Assign a column for: {list}", vars: { list: missing.join(", ") } };
    if (mode === "history") {
      var f = dateFmtEl.value === "auto" ? sniff.dateFmt : dateFmtEl.value;
      if (!f) {
        if (sniff.dateState === "conflict") return { key: "tool.err.dateConflict", def: "The date column mixes day-first and month-first rows. Pick the format your export uses, or fix the source." };
        if (sniff.dateState === "unparsable") return { key: "tool.err.dateBad", def: "No date could be read from that column. Check the column mapping." };
        return { key: "tool.err.dateAmbig", def: "Dates like 01/02/2026 could be 1 Feb or 2 Jan — choose the date format, we will not guess." };
      }
    }
    var ps = dayOf(perStartEl.value), pe = dayOf(perEndEl.value);
    if (ps != null && pe != null && pe < ps) return { key: "tool.err.period", def: "The period end is before the period start." };
    if (ps != null && pe != null && pe - ps > 40000) return { key: "tool.err.periodLong", def: "That period spans more than 100 years — check the dates." };
    var s = settings();
    if (s.defLT == null || s.defLT <= 0) {
      var anyLT = false;
      if (secMap) { for (var k in secMap) { if (secMap.hasOwnProperty(k) && secMap[k].lt > 0) { anyLT = true; break; } } }
      if (mode === "agg" && sniff.map.lt >= 0) anyLT = true;
      if (!anyLT) return { key: "tool.err.lt", def: "Enter a lead time greater than 0 — safety stock has no meaning without one." };
    }
    return null;
  }

  /* =========================================================================
     Rendering
     ========================================================================= */
  function showEmpty() {
    resultEl.innerHTML = '<p style="margin:0;color:var(--muted);">' + esc(tr("tool.res.empty", "Drop a sales history CSV or paste it above, and every SKU appears here.")) + "</p>";
    lastRender = null;
  }
  function showError(e) {
    lastRender = null;
    var msg = fmt(tr(e.key, e.def), e.vars || {});
    resultEl.innerHTML = '<p style="margin:0;color:var(--muted);"><strong style="font-size:15px;color:var(--ink);">⚠ </strong>' + esc(msg) + "</p>";
  }

  function warnText(w, r) {
    switch (w) {
      case "badLT": return tr("tool.warn.badLT", "Lead time missing or ≤ 0 — not calculated");
      case "noSigma": return tr("tool.warn.noSigma", "Not enough data — 2 days minimum, 14+ recommended");
      case "sampleLow": return tr("tool.warn.sampleLow", "Small sample — under 14 days");
      case "flat": return tr("tool.warn.flat", "No demand variation (σd = 0)");
      case "noSales": return tr("tool.warn.noSales", "No sales history — check for dead stock");
      case "longWindow": return tr("tool.warn.longWindow", "Observation window over 100 years — check the date column");
    }
    return w;
  }

  function render() {
    if (!lastAgg) { showEmpty(); return; }
    var s = settings();
    var rows = [], i, warnCount = 0;
    for (i = 0; i < lastAgg.skus.length; i++) {
      var d = derive(lastAgg.skus[i], s);
      if (d.warn.length) warnCount++;
      rows.push(d);
    }
    lastRender = { rows: rows, s: s };
    var ex = lastAgg.excluded;
    var exTotal = ex.neg + ex.qty + ex.date + ex.period + ex.cols;
    var hasEOQ = s.S != null && s.H != null;
    var hasOnHand = rows.some(function (r) { return r.onHand != null; });
    var anySLT = lastAgg.skus.some(function (r) { return r.secSLT != null && r.secSLT > 0; });
    var zeroTotal = 0;
    for (i = 0; i < rows.length; i++) zeroTotal += rows[i].zeroDays || 0;

    var h = [];
    h.push('<p style="margin:0 0 10px;font-size:15px;">' +
      fmt(esc(tr("tool.res.summary", "{n} SKUs · {ex} rows excluded · {w} with warnings")),
        { n: '<strong>' + num(rows.length, 0) + '</strong>', ex: '<strong>' + num(exTotal, 0) + '</strong>', w: '<strong>' + num(warnCount, 0) + '</strong>' }) + "</p>");

    /* Badges — every modelling assumption is stated, none of them is silent. */
    var badges = [];
    if (!anySLT) badges.push(tr("tool.badge.noSLT", "Demand variability only (σLT = 0) — add a lead-time deviation column and it is included"));
    if (s.R > 0) badges.push(fmt(tr("tool.badge.review", "Periodic review: protection window is LT + R ({r} days), so ROP is the order-up-to level"), { r: num(s.R, 2) }));
    if (zeroTotal > 0) badges.push(fmt(tr("tool.badge.zero", "{n} non-selling days filled with 0 across all SKUs"), { n: num(zeroTotal, 0) }));
    if (!zeroEl.checked) badges.push(tr("tool.badge.noZero", "Selling days only — d̄ runs high and σd runs low versus a zero-filled series"));
    if (s.busMode) {
      var sp = busSpan(s.defLT || 1, s.country, s.weekend);
      badges.push(fmt(tr("tool.badge.bus", "Lead time in business days is converted to calendar days from today using {c} public holidays"), { c: countryName(s.country) }));
      if (s.country === "kr" && sp.outside) badges.push(tr("tool.badge.krRange", "Korean lunar holidays are tabulated for 2025–2027 only; outside that range only weekends are removed"));
    }
    if (badges.length) {
      h.push('<div style="display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px;">');
      for (i = 0; i < badges.length; i++) h.push('<span class="ss-badge">' + esc(badges[i]) + "</span>");
      h.push("</div>");
    }

    /* controls */
    h.push('<div class="ss-controls">');
    if (hasOnHand) h.push('<label class="ss-check"><input type="checkbox" id="f-reorder"' + (view.reorderOnly ? " checked" : "") + "> " + esc(tr("tool.res.filter", "Reorder now only")) + "</label>");
    h.push('<input type="search" id="f-search" value="' + esc(view.q) + '" placeholder="' + esc(tr("tool.res.search", "Search SKU")) + '">');
    h.push("</div>");

    /* table */
    var shown = rows.filter(function (r) {
      if (view.reorderOnly && !r.order) return false;
      if (view.q && String(r.sku == null ? "" : r.sku).toLowerCase().indexOf(view.q.toLowerCase()) === -1) return false;
      return true;
    });
    shown.sort(cmp);
    var unit = s.unit ? " (" + s.unit + ")" : "";
    var cols = [
      { k: "sku", t: tr("tool.res.thSku", "SKU") },
      { k: "dbar", t: tr("tool.res.thDbar", "d̄ / day") + unit },
      { k: "sigmad", t: tr("tool.res.thSigma", "σd") },
      { k: "obsDays", t: tr("tool.res.thObs", "Days") },
      { k: "lt", t: tr("tool.res.thLt", "LT (cal. days)") },
      { k: "ss", t: tr("tool.res.thSS", "Safety stock") + unit },
      { k: "rop", t: (s.R > 0 ? tr("tool.res.thOrderUpTo", "Order-up-to level") : tr("tool.res.thROP", "Reorder point")) + unit }
    ];
    if (hasEOQ) cols.push({ k: "eoq", t: tr("tool.res.thEOQ", "EOQ") + unit });
    if (hasOnHand) cols.push({ k: "onHand", t: tr("tool.res.thOnHand", "On hand") + unit });
    cols.push({ k: "note", t: tr("tool.res.thNote", "Notes"), nosort: true });

    h.push('<div class="ss-tablewrap"><table class="ss-table"><thead><tr>');
    for (i = 0; i < cols.length; i++) {
      var c = cols[i];
      h.push('<th' + (c.nosort ? "" : ' class="ss-sort" data-k="' + c.k + '" tabindex="0" role="button"') + ">" + esc(c.t) +
        (view.sort === c.k ? (view.dir > 0 ? " ▲" : " ▼") : "") + "</th>");
    }
    h.push("</tr></thead><tbody>");
    if (!shown.length) {
      h.push('<tr><td colspan="' + cols.length + '" style="color:var(--muted);text-align:center;padding:18px;">' +
        esc(tr("tool.res.noMatch", "No SKU matches this filter.")) + "</td></tr>");
    }
    for (i = 0; i < Math.min(shown.length, MAX_RENDER); i++) {
      var r = shown[i];
      h.push("<tr" + (r.order ? ' class="ss-order"' : "") + ">");
      h.push("<td>" + (r.sku == null ? '<em style="color:var(--muted);">' + esc(tr("tool.res.unspec", "(no SKU)")) + "</em>" : esc(r.sku)) + "</td>");
      h.push('<td class="n">' + num(r.dbar) + "</td>");
      h.push('<td class="n">' + (r.sigmad == null ? "—" : num(r.sigmad)) + "</td>");
      h.push('<td class="n">' + (r.obsDays == null ? "—" : num(r.obsDays, 0)) + "</td>");
      h.push('<td class="n">' + (r.ltCal == null ? "—" : num(r.ltCal)) + "</td>");
      h.push('<td class="n"><strong>' + (r.ss == null ? "—" : num(r.ss)) + "</strong></td>");
      h.push('<td class="n"><strong>' + (r.rop == null ? "—" : num(r.rop)) + "</strong></td>");
      if (hasEOQ) h.push('<td class="n">' + (r.eoq == null ? "—" : num(r.eoq)) + "</td>");
      if (hasOnHand) h.push('<td class="n">' + (r.onHand == null ? "—" : num(r.onHand)) + (r.order ? ' <span class="ss-flag">' + esc(tr("tool.res.orderNow", "order now")) + "</span>" : "") + "</td>");
      var notes = r.warn.map(function (w) { return warnText(w, r); });
      h.push('<td class="ss-note">' + (notes.length ? esc(notes.join(" · ")) : "") + "</td>");
      h.push("</tr>");
    }
    h.push("</tbody></table></div>");
    if (shown.length > MAX_RENDER) {
      h.push('<p class="ss-cap">' + esc(fmt(tr("tool.res.cap", "Showing the first {n} of {t} rows — download the CSV for the full table."), { n: MAX_RENDER, t: num(shown.length, 0) })) + "</p>");
    }

    h.push('<div class="ss-export"><button type="button" class="btn ss-btn2" id="dl-btn">' + esc(tr("tool.res.download", "Download CSV")) + "</button>");
    h.push('<button type="button" class="btn ss-btn2" id="cp-btn">' + esc(tr("tool.res.copy", "Copy for Excel")) + "</button>");
    h.push('<span id="cp-msg" class="ss-cap" style="margin-inline-start:8px;"></span></div>');

    /* excluded rows — reported with reasons, never dropped in silence */
    if (exTotal > 0 || ex.sku > 0 || ex.dupe > 0) {
      h.push('<details class="ss-ex"><summary>' + esc(fmt(tr("tool.res.excluded", "Excluded rows ({n})"), { n: num(exTotal, 0) })) + "</summary><ul>");
      if (ex.neg) h.push("<li>" + esc(fmt(tr("tool.ex.neg", "{n} rows with a negative quantity (returns) — excluded from demand, not netted off"), { n: num(ex.neg, 0) })) + "</li>");
      if (ex.qty) h.push("<li>" + esc(fmt(tr("tool.ex.qty", "{n} rows whose quantity was not a number"), { n: num(ex.qty, 0) })) + "</li>");
      if (ex.date) h.push("<li>" + esc(fmt(tr("tool.ex.date", "{n} rows whose date could not be read (or fell outside 1990–2100)"), { n: num(ex.date, 0) })) + "</li>");
      if (ex.period) h.push("<li>" + esc(fmt(tr("tool.ex.period", "{n} rows outside the period you set"), { n: num(ex.period, 0) })) + "</li>");
      if (ex.cols) h.push("<li>" + esc(fmt(tr("tool.ex.cols", "{n} rows with fewer columns than the mapping expects"), { n: num(ex.cols, 0) })) + "</li>");
      if (ex.sku) h.push("<li>" + esc(fmt(tr("tool.ex.sku", "{n} rows with an empty SKU — grouped as “(no SKU)”, not hidden"), { n: num(ex.sku, 0) })) + "</li>");
      if (ex.dupe) h.push("<li>" + esc(fmt(tr("tool.ex.dupe", "{n} rows shared an SKU and a date with another row — summed into one day of demand"), { n: num(ex.dupe, 0) })) + "</li>");
      h.push("</ul></details>");
    }
    h.push('<p class="ss-cap" style="margin-top:12px;">' + esc(tr("tool.res.priv", "Nothing was uploaded. Open DevTools → Network and reload: this page makes zero requests while it calculates.")) + "</p>");

    resultEl.innerHTML = h.join("");
    wireResult();
  }

  function countryName(c) {
    for (var i = 0; i < COUNTRIES.length; i++) {
      if (COUNTRIES[i].c !== c) continue;
      try {
        var dn = new Intl.DisplayNames([curLang()], { type: "region" });
        return dn.of(c === "uk" ? "GB" : c.toUpperCase()) || COUNTRIES[i].en;
      } catch (e) { return COUNTRIES[i].en; }
    }
    return c;
  }

  function cmp(a, b) {
    var k = view.sort, va = a[k], vb = b[k];
    if (k === "sku") {
      va = String(va == null ? "" : va); vb = String(vb == null ? "" : vb);
      return va.localeCompare(vb) * view.dir;
    }
    if (va == null) va = -Infinity; if (vb == null) vb = -Infinity;
    return (va - vb) * view.dir;
  }

  function wireResult() {
    var f = $("f-reorder");
    if (f) f.addEventListener("change", function () { view.reorderOnly = f.checked; render(); });
    var q = $("f-search");
    if (q) q.addEventListener("input", function () {
      view.q = q.value; render();
      var nq = $("f-search"); if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); }
    });
    var ths = resultEl.querySelectorAll(".ss-sort");
    for (var i = 0; i < ths.length; i++) {
      (function (th) {
        function go() {
          var k = th.getAttribute("data-k");
          if (view.sort === k) view.dir = -view.dir; else { view.sort = k; view.dir = k === "sku" ? 1 : -1; }
          render();
        }
        th.addEventListener("click", go);
        th.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      })(ths[i]);
    }
    var dl = $("dl-btn"); if (dl) dl.addEventListener("click", downloadCSV);
    var cp = $("cp-btn"); if (cp) cp.addEventListener("click", copyTSV);
  }

  /* =========================================================================
     Export — BOM'd CSV for Excel, TSV for a direct paste
     ========================================================================= */
  function exportRows(sep) {
    if (!lastRender) return "";
    var s = lastRender.s;
    var hasEOQ = s.S != null && s.H != null;
    var hasOnHand = lastRender.rows.some(function (r) { return r.onHand != null; });
    var head = ["SKU", "avg_daily_demand", "sigma_d", "obs_days", "lead_time_cal_days", "safety_stock", s.R > 0 ? "order_up_to_level" : "reorder_point"];
    if (hasEOQ) head.push("eoq");
    if (hasOnHand) head.push("on_hand", "order_now");
    head.push("service_level", "z", "notes");
    var lines = [head];
    var src = lastRender.rows.slice().sort(cmp);
    for (var i = 0; i < src.length; i++) {
      var r = src[i];
      var row = [r.sku == null ? "(no SKU)" : r.sku, raw(r.dbar, 4), raw(r.sigmad, 4), r.obsDays == null ? "" : String(r.obsDays),
        raw(r.ltCal, 4), raw(r.ss, 4), raw(r.rop, 4)];
      if (hasEOQ) row.push(raw(r.eoq, 4));
      if (hasOnHand) row.push(raw(r.onHand, 4), r.onHand == null ? "" : (r.order ? "YES" : "no"));
      row.push(s.svc + "%", String(s.z), r.warn.map(function (w) { return warnText(w, r); }).join(" | "));
      lines.push(row);
    }
    return lines.map(function (row) {
      return row.map(function (c) {
        c = String(c == null ? "" : c);
        return (c.indexOf(sep) >= 0 || c.indexOf('"') >= 0 || c.indexOf("\n") >= 0) ? '"' + c.replace(/"/g, '""') + '"' : c;
      }).join(sep);
    }).join("\r\n");
  }
  function downloadCSV() {
    var txt = exportRows(",");
    if (!txt) return;
    try {
      var blob = new Blob(["﻿" + txt], { type: "text/csv;charset=utf-8;" });   // BOM = Excel opens UTF-8 correctly
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = "safety-stock-" + new Date().toISOString().slice(0, 10) + ".csv";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    } catch (e) {
      var m = $("cp-msg"); if (m) m.textContent = tr("tool.res.dlFail", "This browser blocked the download — use “Copy for Excel” instead.");
    }
  }
  function copyTSV() {
    var txt = exportRows("\t");
    var m = $("cp-msg");
    if (!txt) return;
    function ok() { if (m) { m.textContent = tr("tool.res.copied", "Copied — paste into a spreadsheet"); setTimeout(function () { if (m) m.textContent = ""; }, 2500); } }
    function fail() { if (m) m.textContent = tr("tool.res.copyFail", "Clipboard blocked — select the table and copy manually."); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(ok, fail); return; }
    } catch (e) { /* fall through */ }
    try {
      var ta = document.createElement("textarea");
      ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var done = document.execCommand("copy");
      document.body.removeChild(ta);
      done ? ok() : fail();
    } catch (e2) { fail(); }
  }

  /* =========================================================================
     Mapping UI
     ========================================================================= */
  function colLabel(j) {
    var hs = sniff && sniff.headers;
    var name = hs && hs[j] != null && String(hs[j]).trim() !== "" ? String(hs[j]).trim() : null;
    return name ? name : fmt(tr("tool.map.col", "Column {n}"), { n: j + 1 });
  }
  function selectFor(id, fields, cur, ncols, labelFn) {
    var h = '<div class="ss-mapfield"><label for="map-' + id + '">' + esc(tr(fields.key, fields.def)) + (fields.req ? " *" : "") + '</label><select id="map-' + id + '">';
    h += '<option value="-1">' + esc(tr("tool.map.none", "— not used —")) + "</option>";
    for (var j = 0; j < ncols; j++) h += '<option value="' + j + '"' + (cur === j ? " selected" : "") + ">" + esc(labelFn(j)) + "</option>";
    return h + "</select></div>";
  }
  function renderMap() {
    if (!sniff) { mapWrap.hidden = true; return; }
    mapWrap.hidden = false;
    var fields = MAP_FIELDS[mode], h = "", i;
    for (i = 0; i < fields.length; i++) h += selectFor(fields[i].id, fields[i], sniff.map[fields[i].id], sniff.ncols, colLabel);
    mapFields.innerHTML = h;
    for (i = 0; i < fields.length; i++) {
      (function (f) {
        var sel = $("map-" + f.id);
        sel.addEventListener("change", function () {
          sniff.map[f.id] = parseInt(sel.value, 10);
          if (f.id === "date") {
            var st = sniff.map.date >= 0 ? CORE.sniffDateFmt(sniff.body, sniff.map.date) : { fmt: null, state: "empty" };
            sniff.dateFmt = st.fmt; sniff.dateState = st.state;
          }
          prefs.map = sniff.map; savePrefs();
          renderDateFmt(); renderPreview(); autoRun();
        });
      })(fields[i]);
    }
    renderDateFmt();
    renderPreview();
  }
  function renderDateFmt() {
    if (mode !== "history") { dateFmtRow.hidden = true; return; }
    dateFmtRow.hidden = false;
    var st = sniff ? sniff.dateState : null;
    var msg = "", warn = false;
    if (st === "iso") msg = tr("tool.dateFmt.iso", "Detected: YYYY-MM-DD — unambiguous.");
    else if (st === "resolved") msg = fmt(tr("tool.dateFmt.resolved", "Detected: {f} — a value above 12 in one position settles it."), { f: sniff.dateFmt === "dmy" ? "DD/MM/YYYY" : "MM/DD/YYYY" });
    else if (st === "ambiguous") { msg = tr("tool.dateFmt.ambiguous", "Every date here works both ways (e.g. 01/02/2026). Choose the format — we will not guess."); warn = true; }
    else if (st === "conflict") { msg = tr("tool.dateFmt.conflict", "This column mixes day-first and month-first rows. Choose one; the rest will be reported as excluded."); warn = true; }
    else if (st === "unparsable") { msg = tr("tool.dateFmt.unparsable", "No readable date in that column — check the mapping."); warn = true; }
    dateFmtNote.textContent = msg;
    dateFmtNote.hidden = !msg;
    dateFmtNote.style.color = warn ? "var(--accent-strong)" : "var(--muted)";
    dateFmtNote.style.fontWeight = warn ? "600" : "400";
  }
  function renderPreview() {
    if (!sniff) { previewWrap.innerHTML = ""; return; }
    var h = '<p class="ss-cap">' + esc(tr("tool.preview.title", "First 5 rows, as parsed")) + "</p>";
    h += '<div class="ss-tablewrap"><table class="ss-table ss-prev"><thead><tr>';
    for (var j = 0; j < sniff.ncols; j++) h += "<th>" + esc(colLabel(j)) + "</th>";
    h += "</tr></thead><tbody>";
    for (var i = 0; i < Math.min(5, sniff.body.length); i++) {
      h += "<tr>";
      for (var k = 0; k < sniff.ncols; k++) h += "<td>" + esc(sniff.body[i][k] == null ? "" : sniff.body[i][k]) + "</td>";
      h += "</tr>";
    }
    previewWrap.innerHTML = h + "</tbody></table></div>";
  }
  function renderSecMap() {
    if (!secCols) { secMapWrap.innerHTML = ""; secNote.hidden = true; return; }
    var h = "", i;
    for (i = 0; i < SEC_FIELDS.length; i++) h += selectFor("sec-" + SEC_FIELDS[i].id, SEC_FIELDS[i], secCols.map[SEC_FIELDS[i].id], secCols.ncols, function (j) {
      var hs = secCols.headers;
      var nm = hs && hs[j] != null && String(hs[j]).trim() !== "" ? String(hs[j]).trim() : null;
      return nm ? nm : fmt(tr("tool.map.col", "Column {n}"), { n: j + 1 });
    });
    secMapWrap.innerHTML = h;
    for (i = 0; i < SEC_FIELDS.length; i++) {
      (function (f) {
        var sel = $("map-sec-" + f.id);
        sel.addEventListener("change", function () {
          secCols.map[f.id] = parseInt(sel.value, 10);
          buildSecMap(); mergeSecondary(); render();
        });
      })(SEC_FIELDS[i]);
    }
  }

  /* =========================================================================
     Input plumbing
     ========================================================================= */
  function setSourceNote() {
    if (srcFile) {
      srcNote.hidden = false;
      srcNote.textContent = fmt(tr("tool.src.file", "{name} · {size} · read as {enc} · stays in this tab"), {
        name: srcFile.name, size: humanSize(srcFile.size), enc: (sniff && sniff.enc ? sniff.enc : "utf-8").toUpperCase()
      });
    } else if (pasteEl.value.trim()) {
      srcNote.hidden = false;
      srcNote.textContent = fmt(tr("tool.src.paste", "Pasted text · {size}"), { size: humanSize(pasteEl.value.length) });
    } else { srcNote.hidden = true; }
  }
  function humanSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return num(n / 1024, 1) + " KB";
    return num(n / 1024 / 1024, 1) + " MB";
  }

  function loadFile(file) {
    if (!file) return;
    srcFile = file;
    pasteEl.value = "";
    readHead(file, function (text, enc) {
      if (text == null) {
        showError({ key: "tool.err.enc", def: "This browser cannot decode {enc}. Re-save the file as UTF-8.", vars: { enc: enc || "?" } });
        return;
      }
      if (!sniffText(text, enc, file.name, file.size)) {
        showError({ key: "tool.err.noRows", def: "No data rows found. Check the header row setting and the delimiter." });
        return;
      }
      syncControls();
      setSourceNote();
      renderMap();
      autoRun();
    });
  }
  function loadPaste() {
    srcFile = null;
    var t = pasteEl.value;
    if (!t.trim()) { sniff = null; mapWrap.hidden = true; lastAgg = null; setSourceNote(); showEmpty(); return; }
    if (!sniffText(t.slice(0, SNIFF_BYTES), "utf-8", null, t.length)) {
      showError({ key: "tool.err.noRows", def: "No data rows found. Check the header row setting and the delimiter." });
      return;
    }
    syncControls();
    setSourceNote();
    renderMap();
    autoRun();
  }
  function syncControls() {
    if (!sniff) return;
    if (delimEl.value === "auto") delimEl.setAttribute("data-detected", sniff.delim === "\t" ? "tab" : sniff.delim);
    if (encEl.value === "auto") encEl.setAttribute("data-detected", sniff.enc);
  }
  var autoTimer = null;
  function autoRun() {
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = setTimeout(function () { if (sniff) runAggregate(); }, 60);
  }

  /* ---- sample data: 3 SKUs × 60 days, gaps, a quoted name with commas and a return row ---- */
  function sampleCSV() {
    var seed = 20260717;
    function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
    var skus = [
      { id: "A-1001", nm: 'Hex bolt M6, zinc, 100 pcs' },
      { id: "B-2050", nm: 'Hex nut M6 "standard"' },
      { id: "C-3300", nm: 'Washer, flat, 6 mm' }
    ];
    var base = [12, 4, 40];
    var lines = ["Date,SKU,Product name,Qty"];
    var start = new Date(); start.setHours(12, 0, 0, 0); start = addDays(start, -59);
    var ds = "";
    for (var d = 0; d < 60; d++) {
      var day = addDays(start, d);
      ds = day.getFullYear() + "-" + pad2(day.getMonth() + 1) + "-" + pad2(day.getDate());
      for (var s = 0; s < skus.length; s++) {
        if (rnd() < 0.25) continue;                       // no sale that day — the row simply does not exist
        var q = Math.max(0, Math.round(base[s] * (0.5 + rnd())));
        lines.push(ds + "," + skus[s].id + ',"' + skus[s].nm.replace(/"/g, '""') + '",' + q);
      }
    }
    lines.push(ds + ',A-1001,"Hex bolt M6, zinc, 100 pcs",-6');   // a return → reported, not netted
    return lines.join("\n");
  }
  function sampleSecondary() {
    return "SKU,Lead time,LT deviation,On hand\nA-1001,7,1.5,120\nB-2050,14,3,35\nC-3300,5,0,600\nD-9000,10,2,80";
  }

  /* =========================================================================
     Wiring
     ========================================================================= */
  function setMode(m) {
    mode = m;
    prefs.mode = m; savePrefs();
    elMode.history.setAttribute("aria-selected", m === "history" ? "true" : "false");
    elMode.agg.setAttribute("aria-selected", m === "agg" ? "true" : "false");
    elMode.history.className = "ss-tab" + (m === "history" ? " on" : "");
    elMode.agg.className = "ss-tab" + (m === "agg" ? " on" : "");
    modeHint.textContent = m === "history"
      ? tr("tool.mode.historyHint", "Straight from an ERP or WMS export: one row per transaction. We derive d̄ and σd for you.")
      : tr("tool.mode.aggHint", "For planners who already keep d̄ and σd per SKU in a sheet.");
    $("zero-row").hidden = m !== "history";
    $("period-wrap").hidden = m !== "history";
    if (sniff) {
      sniff.map = guessCols(MAP_FIELDS[mode], sniff.headers, sniff.body, sniff.ncols);
      if (mode === "history" && sniff.map.date >= 0) {
        var st = CORE.sniffDateFmt(sniff.body, sniff.map.date);
        sniff.dateFmt = st.fmt; sniff.dateState = st.state;
      }
      renderMap(); autoRun();
    } else { renderDateFmt(); }
  }
  elMode.history.addEventListener("click", function () { setMode("history"); });
  elMode.agg.addEventListener("click", function () { setMode("agg"); });

  pickBtn.addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function () { if (fileInput.files && fileInput.files[0]) loadFile(fileInput.files[0]); });
  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.add("over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.remove("over"); });
  });
  drop.addEventListener("drop", function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  pasteEl.addEventListener("input", function () { if (srcFile) { srcFile = null; fileInput.value = ""; } loadPaste(); });
  sampleBtn.addEventListener("click", function () {
    srcFile = null; fileInput.value = "";
    setMode("history");
    pasteEl.value = sampleCSV();
    secPasteEl.value = sampleSecondary();
    headerEl.checked = true;
    var sw = $("sec-wrap"); if (sw) sw.open = true;
    parseSecondary();
    loadPaste();
  });
  clearBtn.addEventListener("click", function () {
    stopRun();
    srcFile = null; fileInput.value = ""; pasteEl.value = ""; secPasteEl.value = "";
    sniff = null; lastAgg = null; secMap = null; secCols = null; secRows = null;
    mapWrap.hidden = true; secMapWrap.innerHTML = ""; secNote.hidden = true;
    setSourceNote(); showEmpty();
  });
  secPickBtn.addEventListener("click", function () { secFileInput.click(); });
  secFileInput.addEventListener("change", function () {
    var f = secFileInput.files && secFileInput.files[0];
    if (!f) return;
    var fr = new FileReader();
    fr.onerror = function () { secNote.hidden = false; secNote.textContent = tr("tool.err.fileRead", "The file could not be read. It may have been moved or changed."); };
    fr.onload = function () {
      var bytes = new Uint8Array(fr.result);
      var enc = CORE.sniffEnc(bytes);
      try { secPasteEl.value = new TextDecoder(enc).decode(bytes); }
      catch (e) { secNote.hidden = false; secNote.textContent = fmt(tr("tool.err.enc", "This browser cannot decode {enc}. Re-save the file as UTF-8."), { enc: enc }); return; }
      parseSecondary();
      if (lastAgg) { mergeSecondary(); render(); }
    };
    fr.readAsArrayBuffer(f.slice(0, 4 * 1024 * 1024));
  });
  secPasteEl.addEventListener("input", function () { parseSecondary(); if (lastAgg) { mergeSecondary(); render(); } });

  encEl.addEventListener("change", function () { prefs.enc = encEl.value; savePrefs(); if (srcFile) loadFile(srcFile); else loadPaste(); });
  delimEl.addEventListener("change", function () { prefs.delim = delimEl.value; savePrefs(); if (srcFile) loadFile(srcFile); else loadPaste(); });
  headerEl.addEventListener("change", function () { prefs.header = headerEl.checked; savePrefs(); if (srcFile) loadFile(srcFile); else loadPaste(); });
  dateFmtEl.addEventListener("change", function () { prefs.dateFmt = dateFmtEl.value; savePrefs(); autoRun(); });
  zeroEl.addEventListener("change", function () { prefs.zero = zeroEl.checked; savePrefs(); autoRun(); });
  perStartEl.addEventListener("change", autoRun);
  perEndEl.addEventListener("change", autoRun);

  function onSetting() {
    prefs.svc = svcEl.value; prefs.lt = ltEl.value; prefs.ltUnit = ltUnitEl.value;
    prefs.country = countryEl.value; prefs.weekend = weekendEl.value; prefs.unit = unitEl.value;
    savePrefs();
    busWrap.hidden = ltUnitEl.value !== "bus";
    if (lastAgg) { var e = validate(); if (e) { showError(e); return; } render(); }
  }
  [svcEl, ltEl, ltUnitEl, countryEl, weekendEl, unitEl, revEl, eoqSEl, eoqHEl].forEach(function (el) {
    el.addEventListener("change", onSetting);
    el.addEventListener("input", onSetting);
  });
  calcBtn.addEventListener("click", function () { if (sniff) runAggregate(); else showError({ key: "tool.err.noInput", def: "Nothing to calculate yet — drop a CSV, paste your history, or press “Fill with example data”." }); });
  cancelBtn.addEventListener("click", function () { stopRun(); showError({ key: "tool.err.cancelled", def: "Cancelled. Nothing was sent anywhere — the file never left this tab." }); });

  /* language switch: numbers, badges and column headers are language-dependent */
  document.addEventListener("i18n:change", function () {
    buildCountrySelect();
    modeHint.textContent = mode === "history"
      ? tr("tool.mode.historyHint", "Straight from an ERP or WMS export: one row per transaction. We derive d̄ and σd for you.")
      : tr("tool.mode.aggHint", "For planners who already keep d̄ and σd per SKU in a sheet.");
    if (sniff) { renderMap(); }
    renderSecMap();
    setSourceNote();
    if (lastAgg) render(); else showEmpty();
  });

  function buildCountrySelect() {
    var cur = countryEl.value || prefs.country || REGION_COUNTRY[detectRegion()] || "us";
    var list = COUNTRIES.map(function (co) { return { c: co.c, n: countryName(co.c) }; });
    list.sort(function (a, b) { return a.n.localeCompare(b.n); });
    countryEl.innerHTML = "";
    for (var i = 0; i < list.length; i++) {
      var o = document.createElement("option");
      o.value = list[i].c; o.textContent = list[i].n;
      countryEl.appendChild(o);
    }
    var o2 = document.createElement("option");
    o2.value = "none"; o2.textContent = tr("tool.country.none", "Weekends only (no public holidays)");
    countryEl.appendChild(o2);
    countryEl.value = cur;
    busNote.textContent = tr("tool.bus.note", "China is not listed: its Lunar New Year and make-up workdays are set by an annual State Council notice, so no static table can be honest about it.");
  }

  /* =========================================================================
     Boot — restore preferences only. No history, no on-hand data is persisted.
     ========================================================================= */
  (function boot() {
    if (prefs.svc && Z_TABLE[prefs.svc] != null) svcEl.value = prefs.svc;
    if (prefs.lt != null && prefs.lt !== "") ltEl.value = prefs.lt;
    if (prefs.ltUnit) ltUnitEl.value = prefs.ltUnit;
    if (prefs.enc) encEl.value = prefs.enc;
    if (prefs.delim) delimEl.value = prefs.delim;
    if (prefs.header != null) headerEl.checked = !!prefs.header;
    if (prefs.dateFmt) dateFmtEl.value = prefs.dateFmt;
    if (prefs.zero != null) zeroEl.checked = !!prefs.zero;
    if (prefs.unit) unitEl.value = prefs.unit;
    if (prefs.weekend) weekendEl.value = prefs.weekend;
    else weekendEl.value = FRISAT_REGIONS[detectRegion()] ? "frisat" : "satsun";
    buildCountrySelect();
    if (!prefs.country) countryEl.value = REGION_COUNTRY[detectRegion()] || "us";
    busWrap.hidden = ltUnitEl.value !== "bus";
    setMode(prefs.mode === "agg" ? "agg" : "history");
    if (!storageOk) {
      var n = document.createElement("p");
      n.className = "ss-cap";
      n.textContent = tr("tool.noStore", "Private mode: your settings will not be remembered, but the tool works normally.");
      resultEl.parentNode.insertBefore(n, resultEl);
    }
    showEmpty();
  })();
  // TOOLJS:END
})();
