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
  /* WBS Weighted Progress & EVM Rollup
     ── 계산 코어(WBS_CORE_FACTORY)는 DOM 을 전혀 모르는 순수 함수 묶음이다.
        같은 소스를 메인스레드와 Web Worker(2만행 초과) 양쪽에서 쓰고 node 로 단위 검증한다.
     ── 원가·일정 원본은 어디에도 저장하지 않는다. localStorage 에는 컬럼 매핑과 형식 설정만 남는다.
     ── 외부 의존 0. 네트워크 호출 0. */

  function WBS_CORE_FACTORY() {
    "use strict";

    var MAX_ROWS = 100000;
    var MAX_DEPTH = 10;

    /* ---------- RFC4180 파서 (따옴표 · 셀 내 개행 · "" 이스케이프) ---------- */
    function parseDelimited(text, delim) {
      var rows = [], row = [], field = "", inQ = false, i = 0, n = text.length, c;
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
        if (c === "\r" || c === "\n") {
          if (c === "\r" && text.charAt(i + 1) === "\n") i++;
          row.push(field); rows.push(row); row = []; field = ""; i++; continue;
        }
        field += c; i++;
      }
      if (field !== "" || row.length) { row.push(field); rows.push(row); }
      return rows;
    }

    /* 구분자 자동추정 — 열 개수가 가장 일관되게 2 이상인 후보 */
    function sniffDelimiter(text) {
      var cands = ["\t", ",", ";"], sample = text.slice(0, 65536), best = null, bestScore = 0;
      for (var i = 0; i < cands.length; i++) {
        var rows = parseDelimited(sample, cands[i]);
        if (rows.length > 31) rows = rows.slice(0, 30);
        else if (rows.length > 1 && sample.length >= 65536) rows = rows.slice(0, rows.length - 1);
        if (!rows.length) continue;
        var counts = {}, mode = 0, modeN = 0, k;
        for (var r = 0; r < rows.length; r++) {
          k = rows[r].length;
          counts[k] = (counts[k] || 0) + 1;
          if (counts[k] > modeN) { modeN = counts[k]; mode = k; }
        }
        if (mode < 2) continue;
        var score = mode + 3 * (modeN / rows.length);
        if (score > bestScore) { bestScore = score; best = cands[i]; }
      }
      return best || "\t";
    }

    /* ---------- 숫자 (1,234.56 / 1.234,56) ---------- */
    var STRIP = /[\s  %₩$€£¥￦]/g;

    function toNumber(raw, fmt) {
      if (raw == null) return null;
      var s = String(raw).replace(STRIP, "");
      if (!s) return null;
      var neg = false;
      if (s.charAt(0) === "(" && s.charAt(s.length - 1) === ")") { neg = true; s = s.slice(1, -1); }
      s = fmt === "comma" ? s.replace(/\./g, "").replace(/,/g, ".") : s.replace(/,/g, "");
      if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return NaN;
      var v = parseFloat(s);
      if (!isFinite(v)) return NaN;
      return neg ? -v : v;
    }

    /* 오판하면 진척률이 통째로 틀어지므로 확신도까지 돌려준다 (UI 가 상시 표기) */
    function sniffNumberFormat(samples) {
      var dot = 0, comma = 0, i, s, hasC, hasD;
      for (i = 0; i < samples.length; i++) {
        s = String(samples[i] == null ? "" : samples[i]).replace(STRIP, "");
        if (!s || !/\d/.test(s)) continue;
        hasC = s.indexOf(",") >= 0; hasD = s.indexOf(".") >= 0;
        if (hasC && hasD) {
          if (s.lastIndexOf(",") > s.lastIndexOf(".")) comma += 5; else dot += 5;
        } else if (hasC) {
          if (/^[+-]?[1-9]\d{0,2}(,\d{3}){2,}$/.test(s)) dot += 5;
          else if (/,\d{1,2}$/.test(s)) comma += 3;
          else if (/^[+-]?[1-9]\d{0,2},\d{3}$/.test(s)) dot += 1;
          else comma += 1;
        } else if (hasD) {
          if (/^[+-]?[1-9]\d{0,2}(\.\d{3}){2,}$/.test(s)) comma += 5;
          else if (/\.\d{1,2}$/.test(s)) dot += 3;
          else if (/^[+-]?[1-9]\d{0,2}\.\d{3}$/.test(s)) comma += 1;
          else dot += 1;
        }
      }
      return { fmt: comma > dot ? "comma" : "dot", decided: (comma + dot) > 0, dot: dot, comma: comma };
    }

    /* ---------- 날짜 ---------- */
    function dateParts(raw) {
      var s = String(raw == null ? "" : raw).trim();
      if (!s) return null;
      s = s.split(/[T ]/)[0];
      var m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})\.?$/);
      if (m) return { y: +m[1], a: +m[2], b: +m[3], iso: true };
      m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})\.?$/);
      if (m) {
        var y = +m[3];
        if (y < 100) y += (y < 70 ? 2000 : 1900);
        return { y: y, a: +m[1], b: +m[2], iso: false };
      }
      return null;
    }

    /* 32일 이상 값 스캔으로 MM/DD·DD/MM 판정 — 판정 불가면 'ambiguous' */
    function sniffDateOrder(list) {
      var aBig = false, bBig = false, sawNonIso = false, sawAny = false, i, p;
      for (i = 0; i < list.length; i++) {
        p = dateParts(list[i]);
        if (!p) continue;
        sawAny = true;
        if (p.iso) continue;
        sawNonIso = true;
        if (p.a > 12) aBig = true;
        if (p.b > 12) bBig = true;
      }
      if (!sawAny) return "none";
      if (!sawNonIso) return "iso";
      if (aBig && bBig) return "conflict";
      if (aBig) return "dmy";
      if (bBig) return "mdy";
      return "ambiguous";
    }

    function toDay(raw, order) {
      var p = dateParts(raw);
      if (!p) return null;
      var mo, d;
      if (p.iso) { mo = p.a; d = p.b; }
      else if (order === "dmy") { d = p.a; mo = p.b; }
      else { mo = p.a; d = p.b; }
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      var ms = Date.UTC(p.y, mo - 1, d), chk = new Date(ms);
      if (chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return null;
      return Math.round(ms / 86400000);
    }

    /* 기준일 직선보간: 기준일 ≥ 종료 → 100, ≤ 시작 → 0, 사이는 일수 비례 */
    function plannedPct(s, e, at) {
      if (s == null || e == null || at == null) return null;
      if (e < s) return null;
      if (at >= e) return 100;
      if (at <= s) return 0;
      return (at - s) / (e - s) * 100;
    }

    /* '.' 우선. 전 행이 일관될 때만 '-' 허용 */
    function sniffCodeSep(codes) {
      var dotted = 0, dashed = 0, i, c;
      for (i = 0; i < codes.length; i++) {
        c = codes[i];
        if (!c) continue;
        if (c.indexOf(".") >= 0) dotted++;
        else if (c.indexOf("-") >= 0) dashed++;
      }
      if (dotted > 0) return ".";
      if (dashed > 0) return "-";
      return ".";
    }

    function cell(row, idx) {
      if (idx == null) return "";
      var v = row[idx];
      return v == null ? "" : String(v).trim();
    }

    function isBlankRow(row) {
      for (var i = 0; i < row.length; i++) if (String(row[i] == null ? "" : row[i]).trim()) return false;
      return true;
    }

    /* ---------- 본체: 파싱된 표 → 계층 롤업 + EVM ---------- */
    function analyze(grid, o) {
      o = o || {};
      var map = o.map || {};
      var start = o.header ? 1 : 0;
      var at = o.dataDay;
      var scale = o.progressScale === 100 ? 100 : 1;
      var onProgress = typeof o.onProgress === "function" ? o.onProgress : null;

      var weightSource = map.weight != null ? "weight" : (map.effort != null ? "effort" : "equal");
      var valueSource = map.planCost != null ? "planCost" : (map.effort != null ? "effort" : "none");
      var hasPlanDates = map.start != null && map.end != null;

      var notes = {
        blankProgress: 0, missingWeight: 0, noPlanDates: 0, badDateRange: 0, invalidValues: 0,
        virtual: 0, duplicate: 0, normalizedGroups: 0, equalGroups: 0, normSample: null,
        truncated: 0, totalRows: 0, fractionSuspect: false
      };
      var exCounts = {}, exList = [], exTotal = 0;
      function exclude(line, code, reason) {
        exTotal++;
        exCounts[reason] = (exCounts[reason] || 0) + 1;
        if (exList.length < 200) exList.push({ line: line, code: code, reason: reason });
      }

      var totalRows = grid.length - start;
      if (totalRows < 0) totalRows = 0;
      notes.totalRows = totalRows;
      var end = grid.length;
      if (totalRows > MAX_ROWS) { end = start + MAX_ROWS; notes.truncated = totalRows; }

      /* 1패스 — 행 수집 + 형식 추정 표본 */
      var raw = [], numSamples = [], dateSamples = [], r, row;
      for (r = start; r < end; r++) {
        row = grid[r] || [];
        if (onProgress && r % 5000 === 0) onProgress((r - start) / Math.max(1, end - start) * 0.6);
        if (isBlankRow(row)) { exclude(r + 1, "", "blank"); continue; }
        var code = cell(row, map.code);
        if (!code) { exclude(r + 1, "", "code"); continue; }
        raw.push({ line: r + 1, code: code, row: row });
        if (numSamples.length < 600) {
          if (map.weight != null) numSamples.push(cell(row, map.weight));
          if (map.effort != null) numSamples.push(cell(row, map.effort));
          if (map.planCost != null) numSamples.push(cell(row, map.planCost));
          if (map.actualCost != null) numSamples.push(cell(row, map.actualCost));
        }
        if (dateSamples.length < 600 && hasPlanDates) {
          dateSamples.push(cell(row, map.start));
          dateSamples.push(cell(row, map.end));
        }
      }

      var fixedNum = (o.numFmt === "dot" || o.numFmt === "comma") ? o.numFmt : null;
      var sn = sniffNumberFormat(numSamples);
      var fixedDate = (o.dateOrder === "mdy" || o.dateOrder === "dmy") ? o.dateOrder : null;
      var sd = sniffDateOrder(dateSamples);
      var meta = {
        numFmt: fixedNum || sn.fmt, numFmtAuto: !fixedNum, numFmtDecided: sn.decided,
        dateOrder: fixedDate || (sd === "mdy" || sd === "dmy" ? sd : (o.localeDateOrder === "dmy" ? "dmy" : "mdy")),
        dateOrderAuto: !fixedDate, dateSniff: sd,
        weightSource: weightSource, valueSource: valueSource, hasPlanDates: hasPlanDates,
        sep: ".", dataDay: at
      };

      function num(v) {
        var x = toNumber(v, meta.numFmt);
        if (x !== null && x !== x) { notes.invalidValues++; return null; }
        return x;
      }

      /* 2패스 — 코드 검증 + 값 파싱 */
      var codes = [], i;
      for (i = 0; i < raw.length; i++) codes.push(raw[i].code);
      var sep = sniffCodeSep(codes);
      meta.sep = sep;

      var nodes = [], byCode = Object.create(null), dupCodes = Object.create(null);
      var fracAllLE1 = true, fracAnyPos = false;

      for (i = 0; i < raw.length; i++) {
        if (onProgress && i % 5000 === 0) onProgress(0.6 + (i / Math.max(1, raw.length)) * 0.3);
        var it = raw[i], segs = it.code.split(sep), bad = false, s;
        for (s = 0; s < segs.length; s++) if (!segs[s].trim()) { bad = true; break; }
        if (bad) { exclude(it.line, it.code, "segment"); continue; }
        if (segs.length > MAX_DEPTH) { exclude(it.line, it.code, "depth"); continue; }

        var pRaw = toNumber(cell(it.row, map.progress), meta.numFmt), progress;
        if (pRaw === null) { progress = 0; notes.blankProgress++; }
        else if (pRaw !== pRaw) { exclude(it.line, it.code, "progressInvalid"); continue; }
        else {
          if (pRaw > 1) fracAllLE1 = false;
          if (pRaw > 0) fracAnyPos = true;
          progress = pRaw * scale;
          if (progress < 0 || progress > 100) { exclude(it.line, it.code, "progressRange"); continue; }
        }

        var w = null;
        if (weightSource !== "equal") {
          var wv = toNumber(cell(it.row, weightSource === "weight" ? map.weight : map.effort), meta.numFmt);
          if (wv !== null && (wv !== wv || wv < 0)) { exclude(it.line, it.code, "weightInvalid"); continue; }
          w = wv;
        }

        var bac = null;
        if (valueSource === "planCost") bac = num(cell(it.row, map.planCost));
        else if (valueSource === "effort") bac = num(cell(it.row, map.effort));
        var ac = map.actualCost != null ? num(cell(it.row, map.actualCost)) : null;

        var ds = null, de = null;
        if (hasPlanDates) {
          ds = toDay(cell(it.row, map.start), meta.dateOrder);
          de = toDay(cell(it.row, map.end), meta.dateOrder);
        }

        var node = {
          code: it.code, name: cell(it.row, map.name), line: it.line, depth: segs.length,
          parentCode: segs.length > 1 ? segs.slice(0, -1).join(sep) : null,
          wRaw: w, progress: progress, ds: ds, de: de, bac: bac, ac: ac,
          children: [], virtual: false, dup: false, order: it.line
        };
        nodes.push(node);
        if (byCode[node.code] == null) byCode[node.code] = node;
        else { node.dup = true; byCode[node.code].dup = true; dupCodes[node.code] = 1; }
      }
      notes.fractionSuspect = scale === 1 && fracAllLE1 && fracAnyPos;
      for (i in dupCodes) notes.duplicate++;

      /* 트리 — 고아 코드는 버리지 않고 가상 부모를 만들어 연결 */
      var roots = [], n, p, psegs;
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        if (!n.parentCode) { roots.push(n); continue; }
        p = byCode[n.parentCode];
        if (!p) {
          psegs = n.parentCode.split(sep);
          p = {
            code: n.parentCode, name: null, line: null, depth: psegs.length,
            parentCode: psegs.length > 1 ? psegs.slice(0, -1).join(sep) : null,
            wRaw: null, progress: 0, ds: null, de: null, bac: null, ac: null,
            children: [], virtual: true, dup: false, order: n.order
          };
          byCode[p.code] = p;
          nodes.push(p);
          notes.virtual++;
        }
        if (p.virtual && n.order < p.order) p.order = n.order;
        p.children.push(n);
      }

      function byOrder(a, b) { return a.order - b.order; }
      roots.sort(byOrder);
      for (i = 0; i < nodes.length; i++) if (nodes[i].children.length > 1) nodes[i].children.sort(byOrder);

      var rootNode = {
        code: "", name: null, line: null, depth: 0, parentCode: null, wRaw: null,
        progress: 0, ds: null, de: null, bac: null, ac: null,
        children: roots, virtual: true, dup: false, order: 0, normW: 100
      };

      /* 가중치: 자기 값 우선 → 없으면 자식 합계 → 리프인데 없으면 null(형제 그룹에서 균등 처리) */
      function effWeight(x) {
        var i2, k, sum = 0, any = false;
        for (i2 = 0; i2 < x.children.length; i2++) {
          k = x.children[i2];
          effWeight(k);
          if (k.eff != null) { sum += k.eff; any = true; }
        }
        if (x.wRaw != null) x.eff = x.wRaw;
        else if (any) x.eff = sum;
        else x.eff = null;
      }

      /* 같은 부모 아래 형제 가중치 합을 100% 로 정규화 */
      function normalize(group) {
        var i2, sum = 0, known = 0, missing = 0, w;
        if (!group.length) return 0;
        for (i2 = 0; i2 < group.length; i2++) {
          w = group[i2].eff;
          if (w == null) missing++;
          else { sum += w; if (w > 0) known++; }
        }
        if (known === 0 || sum <= 0) {
          for (i2 = 0; i2 < group.length; i2++) group[i2].normW = 100 / group.length;
          notes.equalGroups++;
          return sum;
        }
        for (i2 = 0; i2 < group.length; i2++) group[i2].normW = (group[i2].eff != null ? group[i2].eff : 0) / sum * 100;
        if (missing > 0) notes.missingWeight += missing;
        if (Math.abs(sum - 100) > 0.5) {
          notes.normalizedGroups++;
          if (notes.normSample == null) notes.normSample = sum;
        }
        return sum;
      }

      function normalizeAll(x) {
        if (!x.children.length) return;
        normalize(x.children);
        for (var i2 = 0; i2 < x.children.length; i2++) normalizeAll(x.children[i2]);
      }

      function finish(x) {
        x.diff = x.planPct == null ? null : x.progress - x.planPct;
        x.sv = (x.ev != null && x.pv != null) ? x.ev - x.pv : null;
        x.cv = (x.ev != null && x.ac != null) ? x.ev - x.ac : null;
        x.spi = (x.ev != null && x.pv != null && x.pv !== 0) ? x.ev / x.pv : null;
        x.cpi = (x.ev != null && x.ac != null && x.ac !== 0) ? x.ev / x.ac : null;
        x.eac = (x.bac != null && x.cpi != null && x.cpi !== 0) ? x.bac / x.cpi : null;
      }

      /* 리프 → 상위 후위 순회 1패스 */
      function rollup(x) {
        var kids = x.children, i2, k;
        if (!kids.length) {
          x.planPct = plannedPct(x.ds, x.de, at);
          if (hasPlanDates) {
            if (x.ds == null || x.de == null) notes.noPlanDates++;
            else if (x.de < x.ds) notes.badDateRange++;
          }
          x.ev = x.bac != null ? x.bac * x.progress / 100 : null;
          x.pv = (x.bac != null && x.planPct != null) ? x.bac * x.planPct / 100 : null;
          finish(x);
          return;
        }
        var prog = 0, wsum = 0, pacc = 0;
        var bac = null, ev = null, pv = null, ac = null;
        for (i2 = 0; i2 < kids.length; i2++) {
          k = kids[i2];
          rollup(k);
          prog += (k.normW / 100) * k.progress;
          if (k.planPct != null) { wsum += k.normW; pacc += k.normW * k.planPct; }
          if (k.bac != null) bac = (bac == null ? 0 : bac) + k.bac;
          if (k.ev != null) ev = (ev == null ? 0 : ev) + k.ev;
          if (k.pv != null) pv = (pv == null ? 0 : pv) + k.pv;
          if (k.ac != null) ac = (ac == null ? 0 : ac) + k.ac;
        }
        x.progress = prog;
        /* 자식에 계획일정이 없으면 자기 행의 일정으로 폴백 (요약 레벨에만 일정이 있는 WBS) */
        x.planPct = wsum > 0 ? pacc / wsum : plannedPct(x.ds, x.de, at);
        /* 자식 합계 우선, 자식에 값이 하나도 없으면 자기 행 값 (요약 레벨에만 예산이 있는 WBS) */
        x.bac = bac != null ? bac : x.bac;
        x.ac = ac != null ? ac : x.ac;
        x.ev = ev != null ? ev : (x.bac != null ? x.bac * x.progress / 100 : null);
        x.pv = pv != null ? pv : ((x.bac != null && x.planPct != null) ? x.bac * x.planPct / 100 : null);
        finish(x);
      }

      effWeight(rootNode);
      normalizeAll(rootNode);
      rollup(rootNode);
      if (onProgress) onProgress(0.95);

      /* 구조 복제(Worker postMessage) 가능한 평면 배열로 — 순환 참조 없음 */
      var flat = [];
      (function walk(x, parentIdx) {
        for (var i2 = 0; i2 < x.children.length; i2++) {
          var k = x.children[i2], idx = flat.length;
          flat.push({
            code: k.code, name: k.name, line: k.line, depth: k.depth,
            virtual: k.virtual, dup: k.dup, leaf: k.children.length === 0,
            parentIdx: parentIdx, kids: k.children.length,
            normW: k.normW, progress: k.progress, planPct: k.planPct, diff: k.diff,
            bac: k.bac, pv: k.pv, ev: k.ev, ac: k.ac,
            sv: k.sv, cv: k.cv, spi: k.spi, cpi: k.cpi, eac: k.eac
          });
          walk(k, idx);
        }
      })(rootNode, -1);

      return {
        flat: flat,
        total: {
          progress: rootNode.progress, planPct: rootNode.planPct, diff: rootNode.diff,
          bac: rootNode.bac, pv: rootNode.pv, ev: rootNode.ev, ac: rootNode.ac,
          sv: rootNode.sv, cv: rootNode.cv, spi: rootNode.spi, cpi: rootNode.cpi, eac: rootNode.eac
        },
        excluded: { total: exTotal, counts: exCounts, list: exList },
        notes: notes,
        meta: meta
      };
    }

    /* ---------- 출력 포맷 ---------- */
    function fmtDisp(v, digits, fmt) {
      if (v == null || v !== v || !isFinite(v)) return "—";
      var s = Math.abs(v).toFixed(digits), parts = s.split("."), int = parts[0], dec = parts[1] || "";
      var group = fmt === "comma" ? "." : ",", dp = fmt === "comma" ? "," : ".";
      int = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ").split(" ").join(group);
      return (v < 0 ? "−" : "") + int + (dec ? dp + dec : "");
    }

    function fmtRaw(v, digits, fmt) {
      if (v == null || v !== v || !isFinite(v)) return "";
      var s = v.toFixed(digits);
      return fmt === "comma" ? s.replace(".", ",") : s;
    }

    function csvCell(s, delim) {
      s = String(s == null ? "" : s);
      if (s.indexOf('"') >= 0 || s.indexOf(delim) >= 0 || s.indexOf("\n") >= 0 || s.indexOf("\r") >= 0)
        return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }

    function csvLine(cells, delim) {
      var out = [];
      for (var i = 0; i < cells.length; i++) out.push(csvCell(cells[i], delim));
      return out.join(delim);
    }

    function mdCell(s) {
      return String(s == null ? "" : s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
    }

    function fiscal(y, m, startMonth) {
      var idx = (m - startMonth + 12) % 12;
      return { fy: m >= startMonth ? y : y - 1, q: Math.floor(idx / 3) + 1 };
    }

    return {
      parseDelimited: parseDelimited, sniffDelimiter: sniffDelimiter,
      toNumber: toNumber, sniffNumberFormat: sniffNumberFormat,
      dateParts: dateParts, sniffDateOrder: sniffDateOrder, toDay: toDay,
      plannedPct: plannedPct, sniffCodeSep: sniffCodeSep, analyze: analyze,
      fmtDisp: fmtDisp, fmtRaw: fmtRaw, csvLine: csvLine, csvCell: csvCell,
      mdCell: mdCell, fiscal: fiscal, MAX_ROWS: MAX_ROWS, MAX_DEPTH: MAX_DEPTH
    };
  }

  var CORE = WBS_CORE_FACTORY();
  window.__WBS_CORE__ = CORE;   // node 단위검증·디버그용 (순수 함수만)

  /* ============================================================
     UI 층 — 여기부터 DOM
     ============================================================ */
  var SLUG = (window.APP_CONFIG || {}).slug || "wbs-progress-rollup";
  function $(id) { return document.getElementById(id); }

  var input = $("wbs-input");
  if (!input) return;   // DOM 없는 환경(node 검증) — 코어만 노출하고 종료

  var dropBtn = $("wbs-drop"), fileIn = $("wbs-file"), dateIn = $("wbs-date");
  var runBtn = $("wbs-run"), sampleBtn = $("wbs-sample"), clearBtn = $("wbs-clear");
  var numSel = $("wbs-numfmt"), dateSel = $("wbs-datefmt"), fiscalSel = $("wbs-fiscal"), tabSel = $("wbs-deftab");
  var mapPanel = $("wbs-map"), headerChk = $("wbs-header"), mapGrid = $("wbs-map-grid");
  var previewBox = $("wbs-preview"), result = $("wbs-result");

  var WORKER_LIMIT = 20000, RENDER_CAP = 3000, LATE_CAP = 50, FILE_CAP = 25 * 1024 * 1024;

  var state = {
    text: "", grid: null, delim: "\t", headers: [], preview: [], colCount: 0,
    map: {}, res: null, collapsed: null, scale: 1, enc: null, tabPref: "auto", busy: false
  };

  /* ---------- 저장 (매핑·형식 설정만. 원가·일정 원본은 저장하지 않는다) ---------- */
  function lsGet(k) { try { return localStorage.getItem(SLUG + ":" + k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(SLUG + ":" + k, v); } catch (e) { /* private mode */ } }

  /* ---------- i18n ---------- */
  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function tf(key, fallback, vars) {
    var s = t(key, fallback);
    for (var k in vars) s = s.split("{" + k + "}").join(String(vars[k]));
    return s;
  }
  function curLang() { return (window.I18N && window.I18N.lang && window.I18N.lang()) || "en"; }

  function el(tag, props, text) {
    var e = document.createElement(tag);
    if (props) for (var k in props) {
      if (k === "className") e.className = props[k];
      else e.setAttribute(k, props[k]);
    }
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---------- 날짜 유틸 ---------- */
  function todayDay() {
    var d = new Date();
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  }
  function toISO(day) {
    var d = new Date(day * 86400000);
    function p(x) { return (x < 10 ? "0" : "") + x; }
    return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
  }
  function dataDay() {
    var v = dateIn.value;
    if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      var p = v.split("-");
      return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
    }
    return todayDay();
  }
  function dateLabel(day) {
    var d = new Date(day * 86400000);
    try {
      return new Intl.DateTimeFormat(curLang(), { dateStyle: "medium", timeZone: "UTC" }).format(d);
    } catch (e) { return toISO(day); }
  }
  function monthName(m) {
    try {
      return new Intl.DateTimeFormat(curLang(), { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2021, m - 1, 1)));
    } catch (e) { return String(m); }
  }
  function fiscalMonth() {
    var v = parseInt(fiscalSel.value, 10);
    return (v >= 1 && v <= 12) ? v : 1;
  }

  /* ---------- 컬럼 매핑 ---------- */
  var ROLES = ["code", "name", "progress", "weight", "effort", "start", "end", "planCost", "actualCost"];
  var REQUIRED = ["code", "name", "progress"];
  var SAMPLE_ROLES = ["code", "name", "weight", "progress", "start", "end", "planCost", "actualCost"];
  var KEYWORDS = [
    ["actualCost", ["actualcost", "actualspend", "spentcost", "실적원가", "실적비용", "실투입", "実績原価", "実績コスト", "actual", "spent", "실적"]],
    ["planCost", ["plannedcost", "plancost", "budgetcost", "budget", "bac", "계획원가", "계획비용", "예산", "予算", "計画原価", "coûtprévu", "kosten"]],
    ["end", ["planend", "plannedend", "planfinish", "plannedfinish", "enddate", "finishdate", "duedate", "end", "finish", "due", "종료", "완료일", "마감", "終了", "完了", "期限"]],
    ["start", ["planstart", "plannedstart", "startdate", "start", "begin", "시작", "착수", "開始"]],
    ["progress", ["percentcomplete", "%complete", "complete%", "progress%", "progress", "complete", "진행률", "진척률", "공정률", "달성률", "進捗率", "進捗", "完成度"]],
    ["weight", ["weightage", "weighting", "weight", "가중치", "비중", "웨이트", "ウェイト", "重み"]],
    ["effort", ["plannedeffort", "planeffort", "effort", "manday", "mandays", "workload", "hours", "공수", "투입", "工数", "aufwand"]],
    ["name", ["taskname", "activityname", "workname", "wbsname", "task", "activity", "name", "작업명", "업무명", "작업", "업무", "태스크", "タスク", "作業名", "名称"]],
    ["code", ["wbscode", "wbsid", "wbsno", "wbs", "code", "id", "no", "코드", "번호", "番号"]]
  ];

  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[\s_\-–—.·:()]/g, ""); }

  /* 14개 언어 샘플 헤더를 그대로 인식표로 재사용 — 샘플과 자동추정이 어긋날 수 없다 */
  function sampleHeaderTable() {
    var tbl = Object.create(null), L = window.I18N_LOCALES || {}, lang, i;
    for (lang in L) {
      var h = L[lang]["tool.sample.headers"];
      if (!h) continue;
      var p = String(h).split("\t");
      for (i = 0; i < SAMPLE_ROLES.length && i < p.length; i++) {
        var key = norm(p[i]);
        if (key && tbl[key] == null) tbl[key] = SAMPLE_ROLES[i];
      }
    }
    return tbl;
  }

  function guessMap(headers, rows) {
    var m = {}, used = {}, tbl = sampleHeaderTable(), normed = [], i, r, k;
    for (i = 0; i < state.colCount; i++) normed.push(norm(headers[i]));
    for (i = 0; i < normed.length; i++) {
      var role = normed[i] ? tbl[normed[i]] : null;
      if (role && m[role] == null && !used[i]) { m[role] = i; used[i] = 1; }
    }
    for (r = 0; r < KEYWORDS.length; r++) {
      var rk = KEYWORDS[r][0], kws = KEYWORDS[r][1];
      if (m[rk] != null) continue;
      var best = -1, bestLen = -1;
      for (i = 0; i < normed.length; i++) {
        if (used[i] || !normed[i]) continue;
        for (k = 0; k < kws.length; k++) {
          if (normed[i].indexOf(kws[k]) >= 0 && kws[k].length > bestLen) { best = i; bestLen = kws[k].length; }
        }
      }
      if (best >= 0) { m[rk] = best; used[best] = 1; }
    }
    /* 헤더로 못 찾으면 내용으로 — WBS 코드꼴 / 텍스트 열 */
    var body = rows.slice(headers.length ? 1 : 0);
    if (m.code == null) {
      var c = scoreColumn(body, used, /^\d+([.\-]\d+)*$/, 0.6);
      if (c >= 0) { m.code = c; used[c] = 1; }
    }
    if (m.name == null) {
      var n2 = scoreColumn(body, used, /[^\d.,%\s\-+]/, 0.6);
      if (n2 >= 0) { m.name = n2; used[n2] = 1; }
    }
    return m;
  }

  function scoreColumn(rows, used, re, minRatio) {
    var best = -1, bestScore = minRatio, c, r, hit, seen, v;
    for (c = 0; c < state.colCount; c++) {
      if (used[c]) continue;
      hit = 0; seen = 0;
      for (r = 0; r < rows.length; r++) {
        v = rows[r] && rows[r][c] != null ? String(rows[r][c]).trim() : "";
        if (!v) continue;
        seen++;
        if (re.test(v)) hit++;
      }
      if (seen && hit / seen > bestScore) { bestScore = hit / seen; best = c; }
    }
    return best;
  }

  function colLabel(c) {
    var h = state.headers[c];
    return (h && String(h).trim()) ? String(h).trim() : tf("tool.map.col", "Column {n}", { n: c + 1 });
  }

  function saveMapping() {
    var o = {}, k;
    for (k in state.map) if (state.map[k] != null) o[k] = state.headers[state.map[k]] || ("#" + state.map[k]);
    lsSet("mapping", JSON.stringify(o));
  }

  function restoreMapping(headers) {
    var raw = lsGet("mapping");
    if (!raw) return null;
    var o;
    try { o = JSON.parse(raw); } catch (e) { return null; }
    if (!o || typeof o !== "object") return null;
    var m = {}, hit = 0, k, idx;
    for (k in o) {
      idx = -1;
      for (var i = 0; i < headers.length; i++) if (headers[i] === o[k]) { idx = i; break; }
      if (idx < 0 && /^#\d+$/.test(String(o[k]))) idx = parseInt(String(o[k]).slice(1), 10);
      if (idx >= 0 && idx < state.colCount) { m[k] = idx; hit++; }
    }
    return hit >= 2 ? m : null;
  }

  function renderMap() {
    mapGrid.innerHTML = "";
    for (var i = 0; i < ROLES.length; i++) {
      var role = ROLES[i], id = "wbs-col-" + role;
      var wrap = el("div");
      var lab = el("label", { "for": id, "data-i18n": "tool.map." + role }, t("tool.map." + role, role));
      var sel = el("select", { id: id, "data-role": role });
      sel.appendChild(el("option", { value: "" }, t("tool.map.none", "— not used")));
      for (var c = 0; c < state.colCount; c++) sel.appendChild(el("option", { value: String(c) }, colLabel(c)));
      sel.value = state.map[role] == null ? "" : String(state.map[role]);
      sel.addEventListener("change", onMapChange);
      wrap.appendChild(lab);
      wrap.appendChild(sel);
      mapGrid.appendChild(wrap);
    }
  }

  function onMapChange() {
    var m = {};
    for (var i = 0; i < ROLES.length; i++) {
      var sel = $("wbs-col-" + ROLES[i]);
      if (sel && sel.value !== "") m[ROLES[i]] = parseInt(sel.value, 10);
    }
    state.map = m;
    state.collapsed = null;
    saveMapping();
    runAnalyze();
  }

  function renderPreview() {
    previewBox.innerHTML = "";
    var rows = state.preview.slice(0, headerChk.checked ? 6 : 5);
    if (!rows.length) return;
    var table = el("table", { className: "wbs-t" });
    var thead = el("thead"), htr = el("tr");
    for (var c = 0; c < state.colCount; c++) htr.appendChild(el("th", null, colLabel(c)));
    thead.appendChild(htr);
    table.appendChild(thead);
    var tbody = el("tbody");
    for (var r = headerChk.checked ? 1 : 0; r < rows.length; r++) {
      var tr = el("tr");
      for (c = 0; c < state.colCount; c++) {
        var td = el("td", null, rows[r][c] == null ? "" : String(rows[r][c]));
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    previewBox.appendChild(table);
  }

  /* ---------- 입력 → 파싱 ---------- */
  function estRows(text) {
    var c = 0, i = -1;
    while ((i = text.indexOf("\n", i + 1)) >= 0) c++;
    return c + 1;
  }

  function numCount(row) {
    var c = 0;
    for (var i = 0; i < row.length; i++) {
      var s = String(row[i] == null ? "" : row[i]).trim();
      if (s && /^[\d.,\-+%\s]+$/.test(s)) c++;
    }
    return c;
  }

  function looksLikeHeader(rows) {
    if (!rows.length) return false;
    if (rows.length < 2) return numCount(rows[0]) === 0;
    return numCount(rows[1]) > numCount(rows[0]);
  }

  function rebuild() {
    var text = state.text;
    if (!text.trim()) { mapPanel.hidden = true; showEmpty(); return; }
    state.delim = CORE.sniffDelimiter(text);
    var head = CORE.parseDelimited(text.slice(0, 65536), state.delim);
    if (head.length > 6) head = head.slice(0, 6);
    var cols = 0;
    for (var i = 0; i < head.length; i++) if (head[i].length > cols) cols = head[i].length;
    state.colCount = cols;
    state.preview = head;
    state.headers = (headerChk.checked && head.length) ? head[0] : [];
    var saved = state.headers.length ? restoreMapping(state.headers) : null;
    state.map = saved || guessMap(state.headers, head);
    mapPanel.hidden = false;
    renderMap();
    renderPreview();
    runAnalyze();
  }

  var debounceId = null;
  function onInput() {
    if (debounceId) clearTimeout(debounceId);
    debounceId = setTimeout(function () {
      state.text = input.value;
      state.grid = null;
      state.collapsed = null;
      state.scale = 1;
      state.res = null;
      if (state.text.trim()) {
        var head = CORE.parseDelimited(state.text.slice(0, 8192), CORE.sniffDelimiter(state.text));
        headerChk.checked = looksLikeHeader(head.slice(0, 2));
      }
      rebuild();
    }, 250);
  }

  /* ---------- 분석 실행 ---------- */
  function buildOpts() {
    return {
      header: !!headerChk.checked,
      map: state.map,
      numFmt: numSel.value,
      dateOrder: dateSel.value,
      dataDay: dataDay(),
      progressScale: state.scale,
      localeDateOrder: curLang() === "en" ? "mdy" : "dmy"
    };
  }

  function runAnalyze() {
    if (!state.text.trim()) { showEmpty(); return; }
    var missing = [];
    for (var i = 0; i < REQUIRED.length; i++) {
      if (state.map[REQUIRED[i]] == null) missing.push(t("tool.map." + REQUIRED[i], REQUIRED[i]));
    }
    if (missing.length) {
      showNotice(tf("tool.err.needCols", "Choose a column for: {cols}", { cols: missing.join(", ") }), true);
      return;
    }
    var opts = buildOpts();
    if (estRows(state.text) > WORKER_LIMIT && runWorker(opts)) return;
    runMain(opts);
  }

  function runMain(opts) {
    try {
      if (!state.grid) state.grid = CORE.parseDelimited(state.text, state.delim);
      state.res = CORE.analyze(state.grid, opts);
      setBusy(false);
      render();
    } catch (e) {
      setBusy(false);
      showNotice(t("tool.err.crash", "Something went wrong while rolling up this WBS.") +
        " (" + (e && e.message ? e.message : String(e)) + ")", true);
    }
  }

  var worker = null, workerBroken = false;
  function runWorker(opts) {
    if (workerBroken || typeof Worker === "undefined" || typeof Blob === "undefined" ||
        !window.URL || !window.URL.createObjectURL) return false;
    try {
      if (worker) { worker.terminate(); worker = null; }
      var src = "var CORE=(" + WBS_CORE_FACTORY.toString() + ")();\n" +
        "self.onmessage=function(e){var d=e.data;try{" +
        "var grid=CORE.parseDelimited(d.text,d.delim);var o=d.opts;" +
        "o.onProgress=function(p){self.postMessage({type:'progress',pct:p});};" +
        "self.postMessage({type:'done',res:CORE.analyze(grid,o)});" +
        "}catch(err){self.postMessage({type:'error',msg:String(err&&err.message||err)});}};";
      var url = window.URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      worker = new Worker(url);
      window.URL.revokeObjectURL(url);
    } catch (e) { workerBroken = true; worker = null; return false; }

    var rows = estRows(state.text);
    setBusy(true, rows, 0);
    worker.onmessage = function (e) {
      var d = e.data || {};
      if (d.type === "progress") { setBusy(true, rows, d.pct); return; }
      setBusy(false);
      if (d.type === "error") { showNotice(t("tool.err.crash", "Something went wrong while rolling up this WBS.") + " (" + d.msg + ")", true); return; }
      state.res = d.res;
      render();
    };
    worker.onerror = function () {
      workerBroken = true;
      if (worker) { worker.terminate(); worker = null; }
      setBusy(false);
      runMain(buildOpts());   // 폴백 — 메인스레드에서 계속한다 (조용한 실패 금지)
    };
    worker.postMessage({ text: state.text, delim: state.delim, opts: opts });
    return true;
  }

  function setBusy(on, rows, pct) {
    state.busy = !!on;
    result.setAttribute("aria-busy", on ? "true" : "false");
    if (runBtn) runBtn.disabled = !!on;
    if (!on) return;
    result.innerHTML = "";
    result.appendChild(el("p", { className: "wbs-empty" },
      tf("tool.progress.working", "Rolling up {n} rows… {pct}%", {
        n: CORE.fmtDisp(rows, 0, "dot"), pct: Math.round((pct || 0) * 100)
      })));
  }

  /* ---------- 표시 ---------- */
  function showEmpty() {
    result.innerHTML = "";
    result.appendChild(el("p", { className: "wbs-empty" },
      t("tool.empty", "Paste a WBS above (or drop a CSV) and the weighted rollup appears here.")));
  }

  function showNotice(msg, warn) {
    result.innerHTML = "";
    var box = el("div", { className: "wbs-badges" });
    box.appendChild(el("span", { className: "wbs-badge" + (warn ? " warn" : "") }, msg));
    result.appendChild(box);
  }

  function badge(kind, text, btnLabel, onClick) {
    var b = el("span", { className: "wbs-badge" + (kind ? " " + kind : "") }, text);
    if (btnLabel) {
      var x = el("button", { type: "button", className: "wbs-mini" }, btnLabel);
      x.addEventListener("click", onClick);
      b.appendChild(x);
    }
    return b;
  }

  function activeTab() {
    var pref = state.tabPref;
    if (pref === "weighted" || pref === "evm") return pref;
    var res = state.res;
    if (res && res.meta.valueSource === "none") return "weighted";
    return curLang() === "ko" ? "weighted" : "evm";
  }

  function isCollapsed(f) { return !!(state.collapsed && state.collapsed[f.code]); }

  function visibleIdx(flat) {
    var out = [], hidden = Object.create(null), i, f;
    for (i = 0; i < flat.length; i++) {
      f = flat[i];
      if (f.parentIdx >= 0 && (hidden[f.parentIdx] || isCollapsed(flat[f.parentIdx]))) { hidden[i] = 1; continue; }
      out.push(i);
    }
    return out;
  }

  function COLS(tab) {
    return tab === "evm"
      ? ["code", "name", "normW", "progress", "planPct", "bac", "pv", "ev", "ac", "sv", "cv", "spi", "cpi", "eac"]
      : ["code", "name", "normW", "progress", "planPct", "diff"];
  }

  function colLabelKey(c) {
    return { code: "tool.col.wbs", name: "tool.col.task", normW: "tool.col.weight", progress: "tool.col.progress",
      planPct: "tool.col.plan", diff: "tool.col.diff", bac: "tool.col.bac", pv: "tool.col.pv", ev: "tool.col.ev",
      ac: "tool.col.ac", sv: "tool.col.sv", cv: "tool.col.cv", spi: "tool.col.spi", cpi: "tool.col.cpi", eac: "tool.col.eac" }[c];
  }

  function cellText(f, c, fmt, raw) {
    var fd = raw ? CORE.fmtRaw : CORE.fmtDisp;
    switch (c) {
      case "code": return f.code;
      case "name": return f.name || (f.virtual ? t("tool.virtualName", "(no row — parent created)") : "");
      case "normW": return fd(f.normW, 1, fmt) + (raw ? "" : "%");
      case "progress": return fd(f.progress, 1, fmt) + (raw ? "" : "%");
      case "planPct": return f.planPct == null ? (raw ? "" : "—") : fd(f.planPct, 1, fmt) + (raw ? "" : "%");
      case "diff": return f.diff == null ? (raw ? "" : "—") : (raw ? fd(f.diff, 1, fmt) : (f.diff > 0 ? "+" : "") + fd(f.diff, 1, fmt) + "%p");
      case "bac": return fd(f.bac, 0, fmt);
      case "pv": return fd(f.pv, 0, fmt);
      case "ev": return fd(f.ev, 0, fmt);
      case "ac": return fd(f.ac, 0, fmt);
      case "sv": return f.sv == null ? (raw ? "" : "—") : (raw ? fd(f.sv, 0, fmt) : (f.sv > 0 ? "+" : "") + fd(f.sv, 0, fmt));
      case "cv": return f.cv == null ? (raw ? "" : "—") : (raw ? fd(f.cv, 0, fmt) : (f.cv > 0 ? "+" : "") + fd(f.cv, 0, fmt));
      case "spi": return fd(f.spi, 2, fmt);
      case "cpi": return fd(f.cpi, 2, fmt);
      case "eac": return fd(f.eac, 0, fmt);
    }
    return "";
  }

  function render() {
    var res = state.res;
    if (!res) { showEmpty(); return; }
    if (state.collapsed == null) {
      state.collapsed = Object.create(null);
      if (res.flat.length > 200) {
        for (var i = 0; i < res.flat.length; i++) {
          if (res.flat[i].kids && res.flat[i].depth >= 2) state.collapsed[res.flat[i].code] = 1;
        }
      }
    }
    result.innerHTML = "";
    result.appendChild(renderBadges(res));
    if (!res.flat.length) {
      result.appendChild(el("p", { className: "wbs-empty" },
        t("tool.err.noRows", "No usable rows — check the column mapping above.")));
      if (res.excluded.total) result.appendChild(renderExcluded(res));
      return;
    }
    result.appendChild(renderSummary(res));
    result.appendChild(renderTabs());
    result.appendChild(renderTable(res));
    result.appendChild(renderLate(res));
    result.appendChild(renderExports(res));
    if (res.excluded.total) result.appendChild(renderExcluded(res));
    result.appendChild(el("p", { className: "wbs-note" },
      t("tool.privacy.note", "Everything above was computed in this tab. Nothing was uploaded.")));
  }

  function renderBadges(res) {
    var box = el("div", { className: "wbs-badges" }), m = res.meta, n = res.notes;

    box.appendChild(badge("info", t("tool.banner.weight." + m.weightSource,
      m.weightSource === "weight" ? "Weights: weight column" : m.weightSource === "effort"
        ? "No weight column — using planned effort as the weight"
        : "No weight or effort column — sibling tasks weighted equally")));

    if (m.valueSource === "effort") box.appendChild(badge("warn", t("tool.banner.value.effort", "No planned cost column — planned effort is the value unit for EVM")));
    else if (m.valueSource === "none") box.appendChild(badge("warn", t("tool.banner.value.none", "No planned cost or effort column — EVM can't be computed")));
    if (!m.hasPlanDates) box.appendChild(badge("warn", t("tool.banner.noPlanDates", "No plan start/end columns — plan % and PV can't be computed")));

    box.appendChild(badge("", tf("tool.badge.numfmt", "Reading numbers as {fmt}", { fmt: m.numFmt === "comma" ? "1.234,56" : "1,234.56" }),
      t("tool.badge.switch", "Switch"), function () {
        numSel.value = m.numFmt === "comma" ? "dot" : "comma";
        lsSet("numfmt", numSel.value);
        runAnalyze();
      }));

    if (m.hasPlanDates && m.dateOrderAuto && m.dateSniff === "ambiguous") {
      box.appendChild(badge("warn", tf("tool.badge.dateAmbiguous", "Date order is ambiguous — reading as {fmt}",
        { fmt: m.dateOrder === "dmy" ? "DD/MM" : "MM/DD" }), t("tool.badge.switch", "Switch"), function () {
          dateSel.value = m.dateOrder === "dmy" ? "mdy" : "dmy";
          lsSet("datefmt", dateSel.value);
          runAnalyze();
        }));
    } else if (m.hasPlanDates && m.dateSniff === "conflict") {
      box.appendChild(badge("warn", t("tool.badge.dateConflict", "Dates don't fit one order — some rows will be skipped")));
    }

    if (state.enc && state.enc !== "utf-8") box.appendChild(badge("", tf("tool.badge.enc", "File read as {enc}", { enc: state.enc.toUpperCase() })));
    if (n.truncated) box.appendChild(badge("warn", tf("tool.badge.truncated", "Only the first {cap} rows were processed ({n} pasted)",
      { cap: CORE.fmtDisp(CORE.MAX_ROWS, 0, m.numFmt), n: CORE.fmtDisp(n.truncated, 0, m.numFmt) })));
    if (n.normalizedGroups) box.appendChild(badge("", tf("tool.badge.normalized", "Weights normalized ({sum} → 100%) · {n} group(s)",
      { sum: CORE.fmtDisp(n.normSample, 1, m.numFmt), n: n.normalizedGroups })));
    if (n.equalGroups) box.appendChild(badge("", tf("tool.badge.equal", "{n} group(s) had no weights — split equally", { n: n.equalGroups })));
    if (n.missingWeight) box.appendChild(badge("warn", tf("tool.badge.missingWeight", "{n} task(s) had no weight while siblings did — counted as weight 0", { n: n.missingWeight })));
    if (n.virtual) box.appendChild(badge("warn", tf("tool.badge.virtual", "{n} parent code(s) missing — virtual nodes created", { n: n.virtual })));
    if (n.duplicate) box.appendChild(badge("warn", tf("tool.badge.dupe", "{n} duplicate code(s) — shown separately, not merged", { n: n.duplicate })));
    if (n.blankProgress) box.appendChild(badge("", tf("tool.badge.blankProgress", "{n} row(s) had a blank progress — counted as 0%", { n: n.blankProgress })));
    if (n.noPlanDates) box.appendChild(badge("", tf("tool.badge.noPlanRows", "{n} task(s) have no plan dates — left out of plan %", { n: n.noPlanDates })));
    if (n.badDateRange) box.appendChild(badge("warn", tf("tool.badge.badRange", "{n} task(s) end before they start — plan % skipped", { n: n.badDateRange })));
    if (n.invalidValues) box.appendChild(badge("", tf("tool.badge.invalidValues", "{n} cost cell(s) weren't numbers — treated as empty", { n: n.invalidValues })));

    if (n.fractionSuspect) {
      box.appendChild(badge("warn", t("tool.badge.fraction", "Every progress value is 1 or less — is 0.85 meant as 85%?"),
        t("tool.badge.fractionApply", "Read as ×100"), function () { state.scale = 100; runAnalyze(); }));
    } else if (state.scale === 100) {
      box.appendChild(badge("info", t("tool.badge.fractionOn", "Progress read as ×100 (0.85 → 85%)"),
        t("tool.badge.fractionUndo", "Undo"), function () { state.scale = 1; runAnalyze(); }));
    }

    if (res.excluded.total) box.appendChild(badge("warn", tf("tool.badge.excluded", "{n} row(s) excluded", { n: res.excluded.total })));
    return box;
  }

  function renderSummary(res) {
    var m = res.meta, tot = res.total, day = res.meta.dataDay == null ? dataDay() : res.meta.dataDay;
    var box = el("div");
    var line = el("div", { className: "wbs-sum" });
    line.appendChild(el("span", { className: "wbs-big" }, CORE.fmtDisp(tot.progress, 1, m.numFmt) + "%"));
    if (tot.diff != null) {
      line.appendChild(el("span", { className: "wbs-delta" + (tot.diff < 0 ? " neg" : "") },
        (tot.diff > 0 ? "+" : "") + CORE.fmtDisp(tot.diff, 1, m.numFmt) + "%p"));
    }
    box.appendChild(line);

    var d = new Date(day * 86400000);
    var f = CORE.fiscal(d.getUTCFullYear(), d.getUTCMonth() + 1, fiscalMonth());
    var bits = [tf("tool.summary.asof", "as of {date}", { date: dateLabel(day) }),
                tf("tool.summary.fy", "FY{y} Q{q}", { y: f.fy, q: f.q })];
    if (tot.planPct != null) bits.push(tf("tool.summary.plan", "plan {v}%", { v: CORE.fmtDisp(tot.planPct, 1, m.numFmt) }));
    bits.push(tf("tool.summary.rows", "{n} tasks", { n: CORE.fmtDisp(res.flat.length, 0, m.numFmt) }));
    box.appendChild(el("div", { className: "wbs-asof" }, bits.join(" · ")));
    return box;
  }

  function renderTabs() {
    var box = el("div", { className: "wbs-tabs", role: "tablist" }), tab = activeTab();
    function mk(id, key, fallback) {
      var b = el("button", { type: "button", className: "wbs-tab", role: "tab",
        "aria-selected": tab === id ? "true" : "false", "data-i18n": key }, t(key, fallback));
      b.addEventListener("click", function () {
        state.tabPref = id;
        tabSel.value = id;
        lsSet("tab", id);
        render();
      });
      return b;
    }
    box.appendChild(mk("weighted", "tool.tab.weighted", "Weighted progress"));
    box.appendChild(mk("evm", "tool.tab.evm", "EVM (SPI · CPI)"));
    return box;
  }

  function renderTable(res) {
    var tab = activeTab(), cols = COLS(tab), fmt = res.meta.numFmt;
    var box = el("div");
    var vis = visibleIdx(res.flat);
    var capped = vis.length > RENDER_CAP;
    if (capped) vis = vis.slice(0, RENDER_CAP);

    var bar = el("div", { className: "wbs-hint" });
    var expand = el("button", { type: "button", className: "wbs-mini" }, t("tool.expandAll", "Expand all"));
    expand.addEventListener("click", function () { state.collapsed = Object.create(null); render(); });
    var collapse = el("button", { type: "button", className: "wbs-mini" }, t("tool.collapseAll", "Collapse to level 1"));
    collapse.addEventListener("click", function () {
      state.collapsed = Object.create(null);
      for (var i = 0; i < res.flat.length; i++) if (res.flat[i].kids && res.flat[i].depth >= 1) state.collapsed[res.flat[i].code] = 1;
      render();
    });
    bar.appendChild(expand);
    bar.appendChild(collapse);
    box.appendChild(bar);

    var wrap = el("div", { className: "wbs-scroll" });
    var table = el("table", { className: "wbs-t" });
    var thead = el("thead"), htr = el("tr"), i, c;
    for (c = 0; c < cols.length; c++) {
      var key = colLabelKey(cols[c]);
      var th = el("th", { "data-i18n": key, className: (cols[c] === "code" || cols[c] === "name") ? "" : "num" }, t(key, cols[c]));
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = el("tbody");
    for (i = 0; i < vis.length; i++) {
      var f = res.flat[vis[i]];
      var tr = el("tr", { className: "d" + f.depth + (f.virtual ? " virt" : "") + (f.leaf && f.diff != null && f.diff < 0 ? " late" : "") });
      for (c = 0; c < cols.length; c++) {
        var col = cols[c], isNum = !(col === "code" || col === "name");
        var td = el("td", { className: isNum ? "num" + (col === "diff" ? " diff" : "") : "" });
        if (col === "name") {
          td.setAttribute("style", "padding-inline-start:" + (9 + (f.depth - 1) * 13) + "px");
          if (f.kids) {
            var tg = el("button", { type: "button", className: "wbs-tog",
              "aria-label": t(isCollapsed(f) ? "tool.expand" : "tool.collapse", isCollapsed(f) ? "Expand" : "Collapse") },
              isCollapsed(f) ? "▶" : "▼");
            tg.addEventListener("click", toggler(f.code));
            td.appendChild(tg);
          }
          var nm = el("span", { className: "wbs-name", title: cellText(f, col, fmt, false) }, cellText(f, col, fmt, false));
          td.appendChild(nm);
        } else {
          td.textContent = cellText(f, col, fmt, false);
          if (col === "code" && f.dup) td.title = t("tool.badge.dupeCell", "Duplicate WBS code");
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    box.appendChild(wrap);
    if (capped) {
      box.appendChild(el("p", { className: "wbs-note" },
        tf("tool.rows.capped", "Showing the first {shown} of {total} visible rows — the CSV has every row.",
          { shown: CORE.fmtDisp(RENDER_CAP, 0, fmt), total: CORE.fmtDisp(visibleIdx(res.flat).length, 0, fmt) })));
    }
    return box;
  }

  function toggler(code) {
    return function () {
      if (state.collapsed[code]) delete state.collapsed[code];
      else state.collapsed[code] = 1;
      render();
    };
  }

  function renderLate(res) {
    var tab = activeTab(), fmt = res.meta.numFmt, box = el("div", { className: "wbs-late" });
    var list = [], i, f;
    for (i = 0; i < res.flat.length; i++) {
      f = res.flat[i];
      if (!f.leaf) continue;
      if (tab === "evm") { if (f.spi != null && f.spi < 1) list.push(f); }
      else if (f.diff != null && f.diff < -1e-9) list.push(f);
    }
    list.sort(tab === "evm" ? function (a, b) { return a.spi - b.spi; } : function (a, b) { return a.diff - b.diff; });

    box.appendChild(el("h2", { "data-i18n": tab === "evm" ? "tool.late.headingEvm" : "tool.late.heading",
      className: "", style: "font-size:15px;margin:18px 0 0;" },
      t(tab === "evm" ? "tool.late.headingEvm" : "tool.late.heading",
        tab === "evm" ? "Behind schedule (leaf tasks with SPI < 1)" : "Behind plan (leaf tasks below their plan %)")));
    if (!list.length) {
      box.appendChild(el("p", { className: "wbs-hint" }, t("tool.late.none", "No leaf task is behind plan at this data date.")));
      return box;
    }
    var ul = el("ul");
    for (i = 0; i < list.length && i < LATE_CAP; i++) {
      f = list[i];
      var txt = f.code + "  " + (f.name || "") + " — " + (tab === "evm"
        ? "SPI " + CORE.fmtDisp(f.spi, 2, fmt) + " · EV " + CORE.fmtDisp(f.ev, 0, fmt) + " / PV " + CORE.fmtDisp(f.pv, 0, fmt)
        : CORE.fmtDisp(f.progress, 1, fmt) + "% / " + tf("tool.late.plan", "plan {v}%", { v: CORE.fmtDisp(f.planPct, 1, fmt) }) +
          " (" + CORE.fmtDisp(f.diff, 1, fmt) + "%p)");
      ul.appendChild(el("li", null, txt));
    }
    box.appendChild(ul);
    if (list.length > LATE_CAP) box.appendChild(el("p", { className: "wbs-hint" }, tf("tool.late.more", "…and {n} more", { n: list.length - LATE_CAP })));
    return box;
  }

  /* ---------- 출력 ---------- */
  function exportTable(res, raw, visibleOnly) {
    var tab = activeTab(), cols = COLS(tab), fmt = res.meta.numFmt;
    var head = [], body = [], i, c;
    for (c = 0; c < cols.length; c++) head.push(t(colLabelKey(cols[c]), cols[c]));
    var idx = visibleOnly ? visibleIdx(res.flat) : null;
    var count = visibleOnly ? idx.length : res.flat.length;
    for (i = 0; i < count; i++) {
      var f = res.flat[visibleOnly ? idx[i] : i], row = [];
      for (c = 0; c < cols.length; c++) row.push(cellText(f, cols[c], fmt, raw));
      body.push(row);
    }
    return { head: head, body: body };
  }

  function summaryLine(res) {
    var m = res.meta, tot = res.total, day = m.dataDay == null ? dataDay() : m.dataDay;
    var d = new Date(day * 86400000), f = CORE.fiscal(d.getUTCFullYear(), d.getUTCMonth() + 1, fiscalMonth());
    var s = t("tool.summary.overall", "Overall progress") + ": " + CORE.fmtDisp(tot.progress, 1, m.numFmt) + "%";
    if (tot.planPct != null) s += " (" + tf("tool.summary.plan", "plan {v}%", { v: CORE.fmtDisp(tot.planPct, 1, m.numFmt) }) +
      ", " + (tot.diff > 0 ? "+" : "") + CORE.fmtDisp(tot.diff, 1, m.numFmt) + "%p)";
    s += " · " + tf("tool.summary.asof", "as of {date}", { date: toISO(day) }) +
      " · " + tf("tool.summary.fy", "FY{y} Q{q}", { y: f.fy, q: f.q });
    return s;
  }

  function toMarkdown(res) {
    var tbl = exportTable(res, false, true), lines = [], i;
    lines.push("**" + CORE.mdCell(summaryLine(res)) + "**");
    lines.push("");
    var head = [], sep = [];
    for (i = 0; i < tbl.head.length; i++) { head.push(CORE.mdCell(tbl.head[i])); sep.push(i < 2 ? "---" : "---:"); }
    lines.push("| " + head.join(" | ") + " |");
    lines.push("| " + sep.join(" | ") + " |");
    for (i = 0; i < tbl.body.length; i++) {
      var row = [];
      for (var c = 0; c < tbl.body[i].length; c++) row.push(CORE.mdCell(tbl.body[i][c]));
      lines.push("| " + row.join(" | ") + " |");
    }
    return lines.join("\n");
  }

  function toTsv(res) {
    var tbl = exportTable(res, true, true), lines = [CORE.csvLine(tbl.head, "\t")], i;
    for (i = 0; i < tbl.body.length; i++) lines.push(CORE.csvLine(tbl.body[i], "\t"));
    return lines.join("\n");
  }

  function toCsv(res) {
    /* 독일식(1.234,56) 로 읽었으면 소수점이 쉼표이므로 CSV 구분자는 ';' — 엑셀에서 바로 열린다 */
    var delim = res.meta.numFmt === "comma" ? ";" : ",";
    var tbl = exportTable(res, true, false), lines = [CORE.csvLine(tbl.head, delim)], i;
    for (i = 0; i < tbl.body.length; i++) lines.push(CORE.csvLine(tbl.body[i], delim));
    return "﻿" + lines.join("\r\n");
  }

  function copyText(text, btn) {
    function done(ok) {
      var old = btn.textContent;
      btn.textContent = ok ? t("tool.export.copied", "Copied") : t("tool.export.copyFail", "Couldn't copy");
      setTimeout(function () { btn.textContent = old; }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallback(); });
    } else fallback();
    function fallback() {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("style", "position:fixed;top:-9999px;left:-9999px;");
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        done(ok);
      } catch (e) { done(false); }
    }
  }

  function renderExports(res) {
    var box = el("div");
    var row = el("div", { className: "wbs-out" });

    var md = el("button", { type: "button", className: "wbs-ghost" }, t("tool.export.md", "Copy as Markdown"));
    md.addEventListener("click", function () { copyText(toMarkdown(res), md); });
    var tsv = el("button", { type: "button", className: "wbs-ghost" }, t("tool.export.tsv", "Copy as TSV"));
    tsv.addEventListener("click", function () { copyText(toTsv(res), tsv); });
    var csv = el("button", { type: "button", className: "wbs-ghost" }, t("tool.export.csv", "Download CSV"));
    csv.addEventListener("click", function () { download(toCsv(res)); });

    row.appendChild(md);
    row.appendChild(tsv);
    row.appendChild(csv);
    box.appendChild(row);
    box.appendChild(el("p", { className: "wbs-note" },
      t("tool.export.hint", "Markdown and TSV copy what's expanded above — collapse the tree to a reporting level first. The CSV always holds every row.")));
    return box;
  }

  function download(text) {
    try {
      var blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
      var url = window.URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "wbs-rollup-" + toISO(dataDay()) + ".csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { window.URL.revokeObjectURL(url); }, 1000);
    } catch (e) {
      showNotice(t("tool.err.download", "Your browser blocked the download — use “Copy as TSV” instead."), true);
    }
  }

  function renderExcluded(res) {
    var d = el("details"), sum = el("summary");
    sum.textContent = tf("tool.excluded.heading", "Excluded rows ({n})", { n: res.excluded.total });
    d.appendChild(sum);
    var ul = el("ul", { className: "wbs-hint" });
    var counts = res.excluded.counts, k;
    for (k in counts) {
      ul.appendChild(el("li", null, t("tool.reason." + k, k) + " — " + tf("tool.excluded.count", "{n} row(s)", { n: counts[k] })));
    }
    d.appendChild(ul);
    var lines = [], i;
    for (i = 0; i < res.excluded.list.length && i < 30; i++) {
      var x = res.excluded.list[i];
      lines.push(tf("tool.excluded.line", "line {n}", { n: x.line }) + (x.code ? " · " + x.code : "") + " — " + t("tool.reason." + x.reason, x.reason));
    }
    if (lines.length) {
      var ul2 = el("ul", { className: "wbs-hint" });
      for (i = 0; i < lines.length; i++) ul2.appendChild(el("li", null, lines[i]));
      d.appendChild(ul2);
      if (res.excluded.total > lines.length) {
        d.appendChild(el("p", { className: "wbs-hint" }, tf("tool.late.more", "…and {n} more", { n: res.excluded.total - lines.length })));
      }
    }
    return d;
  }

  /* ---------- 샘플 ---------- */
  var SAMPLE = [
    { c: "1", w: "30", p: "100", s: -46, e: -27, pc: "12000", ac: "11500" },
    { c: "1.1", w: "40", p: "100", s: -46, e: -39, pc: "5000", ac: "4800" },
    { c: "1.2", w: "60", p: "100", s: -38, e: -27, pc: "7000", ac: "6700" },
    { c: "2", w: "50", p: "40", s: -26, e: 24, pc: "30000", ac: "14000" },
    { c: "2.1", w: "60", p: "60", s: -26, e: 3, pc: "18000", ac: "11000" },
    { c: "2.2", w: "40", p: "10", s: -16, e: 24, pc: "12000", ac: "3000" },
    { c: "3", w: "20", p: "0", s: 25, e: 45, pc: "8000", ac: "0" },
    { c: "3.1", w: "100", p: "0", s: 25, e: 45, pc: "8000", ac: "0" }
  ];

  function sampleText() {
    var base = dataDay();
    var heads = t("tool.sample.headers", "WBS\tTask\tWeight\tProgress %\tPlan start\tPlan end\tPlanned cost\tActual cost").split("\t");
    var tasks = t("tool.sample.tasks", "Design\tRequirements\tUI design\tBuild\tAPI\tFront-end\tQA\tTest cases").split("\t");
    var lines = [heads.join("\t")], i;
    for (i = 0; i < SAMPLE.length; i++) {
      var r = SAMPLE[i];
      lines.push([r.c, tasks[i] || ("Task " + (i + 1)), r.w, r.p, toISO(base + r.s), toISO(base + r.e), r.pc, r.ac].join("\t"));
    }
    return lines.join("\n");
  }

  /* ---------- 파일 ---------- */
  function decodeBuf(buf) {
    var u8 = new Uint8Array(buf);
    if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF)
      return { text: new TextDecoder("utf-8").decode(u8.subarray(3)), enc: "utf-8" };
    if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE)
      return { text: new TextDecoder("utf-16le").decode(u8.subarray(2)), enc: "utf-16le" };
    if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF)
      return { text: new TextDecoder("utf-16be").decode(u8.subarray(2)), enc: "utf-16be" };
    try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(u8), enc: "utf-8" }; } catch (e) { /* 한글 엑셀 CSV 폴백 */ }
    try { return { text: new TextDecoder("euc-kr").decode(u8), enc: "euc-kr" }; } catch (e2) { /* 미지원 브라우저 */ }
    return null;
  }

  function readFile(file) {
    if (!file) return;
    if (file.size > FILE_CAP) {
      showNotice(tf("tool.err.fileBig", "That file is over {mb} MB — paste the rows you need instead.", { mb: 25 }), true);
      return;
    }
    var fr = new FileReader();
    fr.onerror = function () { showNotice(t("tool.err.fileRead", "Couldn't read that file."), true); };
    fr.onload = function () {
      var got = null;
      try { got = decodeBuf(fr.result); } catch (e) { got = null; }
      if (!got) { showNotice(t("tool.err.decode", "Couldn't decode that file — save it as UTF-8 CSV and try again."), true); return; }
      state.enc = got.enc;
      input.value = got.text;
      state.text = got.text;
      state.grid = null;
      state.collapsed = null;
      state.scale = 1;
      var head = CORE.parseDelimited(got.text.slice(0, 8192), CORE.sniffDelimiter(got.text));
      headerChk.checked = looksLikeHeader(head.slice(0, 2));
      rebuild();
    };
    fr.readAsArrayBuffer(file);
  }

  /* ---------- 배선 ---------- */
  input.addEventListener("input", onInput);
  headerChk.addEventListener("change", function () { state.collapsed = null; rebuild(); });
  dateIn.addEventListener("change", function () { state.collapsed = null; runAnalyze(); });
  runBtn.addEventListener("click", function () { state.grid = null; rebuild(); });
  clearBtn.addEventListener("click", function () {
    input.value = "";
    state.text = "";
    state.grid = null;
    state.res = null;
    state.enc = null;
    state.scale = 1;
    mapPanel.hidden = true;
    showEmpty();
  });
  sampleBtn.addEventListener("click", function () {
    state.enc = null;
    input.value = sampleText();
    state.text = input.value;
    state.grid = null;
    state.collapsed = null;
    state.scale = 1;
    headerChk.checked = true;
    rebuild();
  });

  numSel.addEventListener("change", function () { lsSet("numfmt", numSel.value); runAnalyze(); });
  dateSel.addEventListener("change", function () { lsSet("datefmt", dateSel.value); runAnalyze(); });
  fiscalSel.addEventListener("change", function () { lsSet("fiscal", fiscalSel.value); if (state.res) render(); });
  tabSel.addEventListener("change", function () { state.tabPref = tabSel.value; lsSet("tab", tabSel.value); if (state.res) render(); });

  dropBtn.addEventListener("click", function () { fileIn.click(); });
  fileIn.addEventListener("change", function () { if (fileIn.files && fileIn.files[0]) readFile(fileIn.files[0]); fileIn.value = ""; });
  ["dragenter", "dragover"].forEach(function (ev) {
    dropBtn.addEventListener(ev, function (e) { e.preventDefault(); dropBtn.classList.add("is-over"); });
    input.addEventListener(ev, function (e) { e.preventDefault(); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    dropBtn.addEventListener(ev, function () { dropBtn.classList.remove("is-over"); });
  });
  function onDrop(e) {
    e.preventDefault();
    dropBtn.classList.remove("is-over");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
  }
  dropBtn.addEventListener("drop", onDrop);
  input.addEventListener("drop", onDrop);

  document.addEventListener("i18n:change", function () {
    fillFiscal();
    if (state.colCount) { renderMap(); renderPreview(); }
    if (state.res) render(); else if (!state.text.trim()) showEmpty();
  });

  /* ---------- 초기화 ---------- */
  function fillFiscal() {
    var cur = fiscalSel.value || lsGet("fiscal") || "1";
    fiscalSel.innerHTML = "";
    for (var m = 1; m <= 12; m++) fiscalSel.appendChild(el("option", { value: String(m) }, monthName(m)));
    fiscalSel.value = cur;
  }

  (function init() {
    dateIn.value = toISO(todayDay());
    fillFiscal();
    var n = lsGet("numfmt"); if (n === "dot" || n === "comma" || n === "auto") numSel.value = n;
    var d = lsGet("datefmt"); if (d === "mdy" || d === "dmy" || d === "auto") dateSel.value = d;
    var tb = lsGet("tab"); if (tb === "weighted" || tb === "evm" || tb === "auto") state.tabPref = tb;
    tabSel.value = state.tabPref;
    showEmpty();
  })();
  // TOOLJS:END
})();
