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
  var cfg = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "perf-rating-calibrator";
  var PREFS_KEY = SLUG + ":prefs";        // 프리셋·매핑·가중치만. 평가 원본은 절대 저장하지 않는다.

  var WORKER_MIN_ROWS = 5000;             // 초과 시 Web Worker (그 이하는 동기 — 과잉설계 금지)
  var BIG_ROWS = 200000;                  // 초과 시 메모리 경고 (차단하지 않는다)
  var CHUNK_BYTES = 4194304;              // Blob.slice 청크 크기 — 전체 문자열 메모리 적재 금지
  var SNIFF_BYTES = 65536;                // 인코딩·구분자 감지 표본
  var WORKER_TIMEOUT_MS = 120000;
  var PREVIEW_ROWS = 6;
  var MAX_TABLE_ROWS = 200;               // DOM 폭발 방지 — 전체 목록은 CSV 로
  var MAX_TYPES = 40;

  /* ==========================================================================
     CORE:START — 순수 계산부. DOM·클로저·전역 의존 0.
     같은 소스가 세 곳에서 실행된다: (1) 메인 스레드 (2) Web Worker (toString()
     으로 Blob 주입) (3) node 단위 테스트. 그래서 self-contained 여야 한다.
     ========================================================================== */
  function calibCore() {
    "use strict";

    /* ---- 구분자 파서 (RFC4180 계열 상태기계, 스트리밍 가능) --------------
       따옴표 안의 구분자·개행·이스케이프("")를 모두 처리한다. write() 는 청크
       경계를 넘어 상태를 유지하므로 Blob.slice 스트림 파싱에 그대로 쓰인다. */
    function makeParser(delim) {
      var rows = [], field = "", row = [];
      var inQuoted = false, quoteSeen = false, lastCR = false;

      function endField() { row.push(field); field = ""; }
      function endRow() {
        endField();
        if (!(row.length === 1 && row[0] === "")) rows.push(row); // 빈 줄 무시
        row = [];
      }

      return {
        write: function (text) {
          for (var i = 0; i < text.length; i++) {
            var ch = text.charAt(i);
            if (quoteSeen) {                       // 닫는 따옴표 직후
              quoteSeen = false;
              if (ch === '"') { field += '"'; lastCR = false; continue; } // "" → 리터럴 "
              inQuoted = false;                    // 필드 종료 — 아래 비따옴표 처리로 폴스루
            }
            if (inQuoted) {
              if (ch === '"') { quoteSeen = true; lastCR = false; }
              else if (ch === "\r") { field += "\n"; lastCR = true; }
              else if (ch === "\n") { if (!lastCR) field += "\n"; lastCR = false; }
              else { field += ch; lastCR = false; }
              continue;
            }
            if (ch === '"' && field === "") { inQuoted = true; lastCR = false; continue; }
            if (ch === delim) { endField(); lastCR = false; continue; }
            if (ch === "\r") { endRow(); lastCR = true; continue; }
            if (ch === "\n") { if (lastCR) { lastCR = false; continue; } endRow(); continue; }
            field += ch; lastCR = false;
          }
        },
        end: function () {
          if (field !== "" || row.length) endRow();
          return rows;
        }
      };
    }

    function parseText(text, delim) {
      var p = makeParser(delim);
      p.write(String(text == null ? "" : text));
      return p.end();
    }

    /* ---- 구분자 자동 감지 -------------------------------------------------
       세 후보로 실제 파싱해서 "열 개수가 일관된 쪽"을 고른다. 문자를 세는
       방식과 달리 따옴표 안의 쉼표에 속지 않는다. */
    function detectDelimiter(sample) {
      var cands = ["\t", ",", ";"], best = null, bestCons = -1, bestModal = 0;
      for (var i = 0; i < cands.length; i++) {
        var rows = parseText(sample, cands[i]);
        if (!rows.length) continue;
        var counts = {}, r;
        for (r = 0; r < rows.length; r++) {
          var c = rows[r].length;
          counts[c] = (counts[c] || 0) + 1;
        }
        var modal = 0, modalN = 0;
        for (var k in counts) {
          if (!counts.hasOwnProperty(k)) continue;
          if (counts[k] > modalN || (counts[k] === modalN && Number(k) > modal)) { modalN = counts[k]; modal = Number(k); }
        }
        if (modal < 2) continue;                       // 열이 안 쪼개지면 후보 아님
        var cons = modalN / rows.length;               // 열 개수 일관성
        /* 일관성이 1순위, 열 개수는 동률일 때의 2순위. 열 개수를 점수에 곱하면
           탭 파일 안의 따옴표 쉼표("1,2,3,4,5")에 속아 쉼표를 고른다. */
        if (cons > bestCons + 0.05 || (Math.abs(cons - bestCons) <= 0.05 && modal > bestModal)) {
          bestCons = cons; bestModal = modal; best = cands[i];
        }
      }
      if (best) return best;
      return String(sample).indexOf("\t") >= 0 ? "\t" : ",";
    }

    /* ---- 헤더 동의어 사전 (ko/en) — 정적 상수라 유지비 0 ---------------- */
    var SYN = {
      emp: ["employee id", "employeeid", "empid", "emp no", "empno", "employee no", "employee number",
        "employee code", "staff id", "staff no", "worker id", "person id", "member id", "user id",
        "사번", "사원번호", "직원번호", "사원코드", "임직원번호", "사원 id", "직원 id", "아이디", "employee", "id"],
      name: ["employee name", "full name", "staff name", "이름", "성명", "성함", "직원명", "사원명", "name"],
      rater: ["rater id", "raterid", "rater", "reviewer id", "reviewer", "evaluator id", "evaluator",
        "appraiser", "assessor", "manager id", "manager", "supervisor", "평가자", "평가자 사번",
        "평가자id", "고과자", "심사자", "리뷰어", "평가자명"],
      score: ["review score", "rating score", "raw score", "score", "rating", "points", "point", "grade score",
        "evaluation score", "평가점수", "평점", "점수", "고과점수", "총점", "원점수"],
      org: ["department", "dept", "division", "team", "org", "organization", "unit", "group", "business unit",
        "부서", "부서명", "조직", "팀", "소속", "본부", "실"],
      type: ["review type", "reviewtype", "evaluation type", "appraisal type", "review round", "round",
        "type", "category", "평가유형", "평가구분", "평가종류", "평가차수", "차수", "구분", "유형"]
    };

    function normHeader(h) {
      return String(h == null ? "" : h).toLowerCase().replace(/[\s_\-.\/\\()\[\]#:]/g, "");
    }

    /* 열 ↔ 역할 매칭: 가장 긴(=구체적인) 동의어가 이긴다. "평가자 사번" 이
       emp("사번") 이 아니라 rater("평가자") 로 가는 이유. */
    function guessMapping(headers) {
      var roles = ["emp", "name", "rater", "score", "org", "type"];
      var pairs = [], c, r, s;
      for (c = 0; c < headers.length; c++) {
        var h = normHeader(headers[c]);
        if (!h) continue;
        for (r = 0; r < roles.length; r++) {
          var syns = SYN[roles[r]], best = 0;
          for (s = 0; s < syns.length; s++) {
            var sy = normHeader(syns[s]);
            if (!sy) continue;
            var sc = 0;
            if (h === sy) sc = 1000 + sy.length;
            else if (h.indexOf(sy) >= 0) sc = sy.length;
            if (sc > best) best = sc;
          }
          if (best > 0) pairs.push({ c: c, r: roles[r], s: best });
        }
      }
      pairs.sort(function (a, b) { return b.s - a.s || a.c - b.c; });
      var map = { emp: -1, name: -1, rater: -1, score: -1, org: -1, type: -1 }, used = {};
      for (var i = 0; i < pairs.length; i++) {
        var p = pairs[i];
        if (map[p.r] !== -1 || used[p.c]) continue;
        map[p.r] = p.c; used[p.c] = 1;
      }
      return map;
    }

    /* ---- 점수 파서 — 유럽식 소수점(3,5)·천단위(1.234,5)·% 를 흡수 ------ */
    function parseScore(v) {
      if (v == null) return NaN;
      var t = String(v).replace(/[\s ]/g, "").replace(/%$/, "");
      if (!t) return NaN;
      if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
      else if (t.indexOf(",") >= 0 && t.indexOf(".") < 0) t = t.replace(",", ".");
      else t = t.replace(/,/g, "");
      if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
      var n = parseFloat(t);
      return isFinite(n) ? n : NaN;
    }

    function pick(row, idx) {
      if (idx < 0 || idx >= row.length) return "";
      var v = row[idx];
      return v == null ? "" : String(v).replace(/^[\s ]+|[\s ]+$/g, "");
    }

    function looksLikeHeader(rows) {
      if (!rows.length) return false;
      var r0 = rows[0], numeric = 0, total = 0;
      for (var i = 0; i < r0.length; i++) {
        var v = String(r0[i] == null ? "" : r0[i]).replace(/^\s+|\s+$/g, "");
        if (!v) continue;
        total++;
        if (!isNaN(parseScore(v))) numeric++;
      }
      if (!total) return false;
      var m = guessMapping(r0);
      if (m.score >= 0 || m.emp >= 0 || m.rater >= 0) return numeric / total < 0.5;
      return numeric === 0 && rows.length > 1;
    }

    /* ---- 행 → 레코드. 더러운 행은 버리지 않고 격리한다 (철칙 5) -------- */
    function buildRecords(rows, map, hasHeader, onProgress) {
      var recs = [], dirty = [], dirtyCount = 0, dupes = 0;
      var seen = Object.create(null);            // 사용자 데이터가 키 → 프로토타입 오염 방지
      var start = hasHeader ? 1 : 0, total = Math.max(1, rows.length - start);
      for (var i = start; i < rows.length; i++) {
        if (onProgress && (i & 2047) === 0) onProgress((i - start) / total);
        var row = rows[i];
        var emp = pick(row, map.emp), rater = pick(row, map.rater), sRaw = pick(row, map.score);
        var reason = "";
        if (!emp) reason = "missingEmp";
        else if (!rater) reason = "missingRater";
        else if (!sRaw) reason = "missingScore";
        var score = NaN;
        if (!reason) {
          score = parseScore(sRaw);
          if (isNaN(score)) reason = "nonNumeric";
        }
        if (reason) {
          dirtyCount++;
          if (dirty.length < 500) dirty.push({ line: i + 1, reason: reason, raw: row.join(" | ").slice(0, 160) });
          continue;
        }
        var rec = {
          emp: emp, name: pick(row, map.name), rater: rater, score: score,
          org: pick(row, map.org), type: pick(row, map.type), line: i + 1
        };
        var key = emp + " " + rater + " " + rec.type;
        if (seen[key] !== undefined) { recs[seen[key]] = rec; dupes++; }   // 마지막 값 사용
        else { seen[key] = recs.length; recs.push(rec); }
      }
      return { recs: recs, dirty: dirty, dirtyCount: dirtyCount, dupes: dupes };
    }

    function lowerBound(arr, x) {
      var lo = 0, hi = arr.length;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; }
      return lo;
    }
    function upperBound(arr, x) {
      var lo = 0, hi = arr.length;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (arr[mid] <= x) lo = mid + 1; else hi = mid; }
      return lo;
    }
    /* 중간순위 백분위 — 동점자는 같은 값을 받는다 */
    function pctRank(sorted, x) {
      var below = lowerBound(sorted, x), equal = upperBound(sorted, x) - below;
      return (below + equal / 2) / sorted.length * 100;
    }

    /* ---- 평가자 통계: 모집단 SD (피평가자 전원이 모집단이므로 n-1 아님) - */
    function raterStats(recs) {
      var by = Object.create(null), order = [], i;
      for (i = 0; i < recs.length; i++) {
        var r = recs[i].rater;
        if (!by[r]) { by[r] = { rater: r, n: 0, sum: 0, scores: [] }; order.push(r); }
        var o = by[r];
        o.n++; o.sum += recs[i].score; o.scores.push(recs[i].score);
      }
      for (i = 0; i < order.length; i++) {
        var s = by[order[i]], acc = 0, k;
        s.mean = s.sum / s.n;
        for (k = 0; k < s.n; k++) { var d = s.scores[k] - s.mean; acc += d * d; }
        s.sd = Math.sqrt(acc / s.n);
        s.sorted = s.scores.slice().sort(function (a, b) { return a - b; });
      }
      return { by: by, order: order };
    }

    /* ---- 강제배분 할당 ---------------------------------------------------
       내림차순 정렬 → 목표 누적 비율로 자르되, 경계에 동점이 걸리면 상위
       등급으로 묶어 넘긴다. 비율을 맞추려 동점자를 임의로 가르지 않는다. */
    function assignGrades(sorted, grades, valueKey, gradeKey, idxKey) {
      var N = sorted.length, idx = 0, cum = 0, counts = [], g, i;
      for (g = 0; g < grades.length; g++) {
        cum += grades[g].pct;
        var target = (g === grades.length - 1) ? N : Math.round(N * cum / 100);
        var end = Math.min(Math.max(target, idx), N);
        while (end > idx && end < N && sorted[end][valueKey] === sorted[end - 1][valueKey]) end++;
        for (i = idx; i < end; i++) { sorted[i][gradeKey] = grades[g].label; sorted[i][idxKey] = g; }
        counts.push(end - idx);
        idx = end;
      }
      return counts;
    }

    function calibrate(rows, opts, onProgress) {
      opts = opts || {};
      var map = opts.map || { emp: -1, name: -1, rater: -1, score: -1, org: -1, type: -1 };
      var hasHeader = !!opts.hasHeader;
      var norm = opts.norm || "z";
      var grades = opts.grades || [];
      var weights = opts.weights || {};
      var res = {
        employees: [], raters: [], grades: [], dirty: [], dirtyCount: 0, dupes: 0,
        effNorm: norm, notes: {},
        overall: { records: 0, employees: 0, raters: 0, mean: 0, sd: 0 }
      };
      var i, j;

      var b = buildRecords(rows, map, hasHeader, function (p) { if (onProgress) onProgress(p * 40); });
      res.dirty = b.dirty; res.dirtyCount = b.dirtyCount; res.dupes = b.dupes;
      var recs = b.recs;
      res.overall.records = recs.length;
      if (!recs.length) { res.notes.noValidRows = true; return res; }

      var sum = 0;
      for (i = 0; i < recs.length; i++) sum += recs[i].score;
      var omean = sum / recs.length, oacc = 0;
      for (i = 0; i < recs.length; i++) { var od = recs[i].score - omean; oacc += od * od; }
      res.overall.mean = omean;
      res.overall.sd = Math.sqrt(oacc / recs.length);

      var st = raterStats(recs);
      res.overall.raters = st.order.length;
      if (onProgress) onProgress(50);

      var zeroVar = 0, singleRatee = 0;
      for (i = 0; i < st.order.length; i++) {
        var o = st.by[st.order[i]];
        if (o.n < 2) singleRatee++;
        else if (o.sd === 0) zeroVar++;
      }
      // 정규화가 무의미한 구성이면 조용히 이상한 답을 내지 않고 원점수로 되돌린다
      if (norm !== "none") {
        if (st.order.length < 2) { norm = "none"; res.notes.singleRater = true; }
        else if (singleRatee === st.order.length) { norm = "none"; res.notes.allSingleRatee = true; }
      }
      res.effNorm = norm;
      if (norm !== "none") {
        res.notes.zeroVarRaters = zeroVar;
        res.notes.singleRateeRaters = singleRatee;
      }

      for (i = 0; i < recs.length; i++) {
        var rec = recs[i], rs = st.by[rec.rater];
        rec.mean = rs.mean; rec.sd = rs.sd; rec.rn = rs.n;
        rec.z = (rs.n > 1 && rs.sd > 0) ? (rec.score - rs.mean) / rs.sd : 0;
        if (norm === "z") rec.val = rec.z;
        else if (norm === "pct") rec.val = rs.n > 1 ? pctRank(rs.sorted, rec.score) : 50;
        else rec.val = rec.score;
      }
      if (onProgress) onProgress(65);

      /* 직원별 집계: 평가유형별 평균 → 존재하는 유형만으로 가중치 재정규화 */
      var byEmp = Object.create(null), empOrder = [];
      for (i = 0; i < recs.length; i++) {
        var rc = recs[i], e = byEmp[rc.emp];
        if (!e) {
          e = byEmp[rc.emp] = {
            emp: rc.emp, name: "", org: "", n: 0, first: rc,
            raterSet: Object.create(null), raterCount: 0, firstRater: rc.rater,
            types: Object.create(null), typeOrder: []
          };
          empOrder.push(rc.emp);
        }
        if (!e.name && rc.name) e.name = rc.name;
        if (!e.org && rc.org) e.org = rc.org;
        if (!e.raterSet[rc.rater]) { e.raterSet[rc.rater] = 1; e.raterCount++; }
        var t = e.types[rc.type];
        if (!t) { t = e.types[rc.type] = { v: 0, raw: 0, n: 0 }; e.typeOrder.push(rc.type); }
        t.v += rc.val; t.raw += rc.score; t.n++;
        e.n++;
      }
      var zeroWeight = 0;
      for (i = 0; i < empOrder.length; i++) {
        var em = byEmp[empOrder[i]], wsum = 0, vsum = 0, rsum = 0;
        for (j = 0; j < em.typeOrder.length; j++) {
          var ty = em.typeOrder[j], w = weights[ty];
          if (typeof w !== "number" || !isFinite(w) || w < 0) w = 1;
          if (w === 0) continue;              // 사용자가 명시적으로 뺀 평가유형
          var tt = em.types[ty];
          wsum += w; vsum += w * (tt.v / tt.n); rsum += w * (tt.raw / tt.n);
        }
        if (wsum === 0) { zeroWeight++; em.val = 0; em.raw = 0; }
        else { em.val = vsum / wsum; em.raw = rsum / wsum; }
        // 평가자 μ/σ 는 "그 직원을 평가한 사람이 한 명일 때"만 단일 값으로 뜻이 있다
        em.rater = em.raterCount === 1 ? em.firstRater : "";
        em.rMean = em.n === 1 ? em.first.mean : null;
        em.rSd = em.n === 1 ? em.first.sd : null;
        delete em.first; delete em.firstRater; delete em.raterSet;
        delete em.types; delete em.typeOrder;
      }
      if (zeroWeight) res.notes.zeroWeightEmployees = zeroWeight;
      res.overall.employees = empOrder.length;
      if (onProgress) onProgress(80);

      var list = [];
      for (i = 0; i < empOrder.length; i++) list.push(byEmp[empOrder[i]]);
      function cmpEmp(a, b) { return a.emp < b.emp ? -1 : a.emp > b.emp ? 1 : 0; }
      list.sort(function (a, b) { return b.val - a.val || cmpEmp(a, b); });
      for (i = 0; i < list.length; i++) list[i].rank = i + 1;

      if (grades.length) {
        var counts = assignGrades(list, grades, "val", "grade", "gi");
        if (norm !== "none") {
          var rawList = list.slice().sort(function (a, b) { return b.raw - a.raw || cmpEmp(a, b); });
          assignGrades(rawList, grades, "raw", "rawGrade", "rgi");
          for (i = 0; i < list.length; i++) {
            var L = list[i];
            L.change = (L.gi === L.rgi) ? 0 : (L.gi < L.rgi ? 1 : -1);   // 등급 인덱스가 작을수록 상위
          }
        }
        for (i = 0; i < grades.length; i++) {
          res.grades.push({
            label: grades[i].label, pct: grades[i].pct, count: counts[i],
            actual: list.length ? counts[i] / list.length * 100 : 0
          });
        }
      }
      res.employees = list;

      for (i = 0; i < st.order.length; i++) {
        var rr = st.by[st.order[i]];
        res.raters.push({ rater: rr.rater, n: rr.n, mean: rr.mean, sd: rr.sd, dev: rr.mean - omean });
      }
      res.raters.sort(function (a, b) { return b.dev - a.dev; });
      if (onProgress) onProgress(100);
      return res;
    }

    return {
      makeParser: makeParser,
      parseText: parseText,
      detectDelimiter: detectDelimiter,
      guessMapping: guessMapping,
      looksLikeHeader: looksLikeHeader,
      parseScore: parseScore,
      calibrate: calibrate
    };
  }
  /* ========================== CORE:END ==================================== */

  var CORE = calibCore();

  /* ---- DOM 참조 --------------------------------------------------------- */
  function $(id) { return document.getElementById(id); }
  var UI = {
    paste: $("in-paste"), file: $("in-file"), fileBtn: $("file-btn"), sampleBtn: $("sample-btn"),
    clearBtn: $("clear-btn"), drop: $("drop-zone"), chips: $("parse-chips"), chipRows: $("chip-rows"),
    chipDelim: $("chip-delim"), chipEnc: $("chip-enc"), enc: $("in-enc"), inputBanners: $("input-banners"),
    mapSec: $("map-sec"), header: $("in-header"), mapGrid: $("map-grid"), previewWrap: $("preview-wrap"),
    optSec: $("opt-sec"), norm: $("in-norm"), normHint: $("norm-hint"), preset: $("in-preset"),
    gradesEditor: $("grades-editor"), weightsWrap: $("weights-wrap"), weightsGrid: $("weights-grid"),
    calcBtn: $("calc-btn"), progress: $("progress"), result: $("result"), notes: $("notes"),
    outSec: $("out-sec"), empWrap: $("emp-table-wrap"), empNote: $("emp-note"),
    raterWrap: $("rater-table-wrap"), distWrap: $("dist-table-wrap"), canvas: $("dist-canvas"),
    exclWrap: $("excl-table-wrap"), exclNote: $("excl-note"), csvBtn: $("csv-btn"), tsvBtn: $("tsv-btn")
  };
  if (!UI.paste || !UI.result) return;

  var S = {
    rows: [], headers: [], delim: ",", enc: "utf-8", encForced: "auto", file: null, fileName: "",
    hasHeader: true, map: { emp: -1, name: -1, rater: -1, score: -1, org: -1, type: -1 },
    types: [], grades: [], presetId: "kr5", replacement: false, result: null, busy: false, valid: false
  };

  /* ---- 저장: 프리셋·매핑·가중치만. 평가 원본은 절대 쓰지 않는다 -------- */
  var storageOk = true;
  (function () {
    try { localStorage.setItem(SLUG + ":_t", "1"); localStorage.removeItem(SLUG + ":_t"); }
    catch (e) { storageOk = false; }
  })();
  var prefs = (function () {
    if (!storageOk) return {};
    try { var r = localStorage.getItem(PREFS_KEY); return (r && JSON.parse(r)) || {}; }
    catch (e) { return {}; }
  })();
  function savePrefs() {
    if (!storageOk) return;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* quota */ }
  }

  /* ---- i18n · 표기 헬퍼 ------------------------------------------------- */
  function tr(k, fb) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(k) : null;
    return v == null ? fb : v;
  }
  function lang() {
    var l = (window.I18N && window.I18N.lang) ? window.I18N.lang() : null;
    return l || undefined;
  }
  function fill(tpl, o) {
    return String(tpl).replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? String(o[k]) : m; });
  }
  var nfCache = {};
  function fmt(v, d) {
    if (v == null || typeof v !== "number" || !isFinite(v)) return "—";
    var key = lang() + "|" + d;
    if (!nfCache[key]) {
      try { nfCache[key] = new Intl.NumberFormat(lang(), { minimumFractionDigits: d, maximumFractionDigits: d }); }
      catch (e) { nfCache[key] = { format: function (x) { return x.toFixed(d); } }; }
    }
    return nfCache[key].format(v);
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   // 항상 textContent — 사용자 CSV 가 마크업이 될 여지를 두지 않는다
    return n;
  }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function banner(box, msg, kind) {
    box.appendChild(el("div", "banner" + (kind ? " " + kind : ""), msg));
  }

  /* ---- 등급 프리셋 (정적 상수 = 유지비 0) ------------------------------ */
  var PRESETS = {
    kr5: [["S", 10], ["A", 20], ["B", 40], ["C", 20], ["D", 10]],
    us3: [["tool.g.top", 20], ["tool.g.core", 70], ["tool.g.low", 10]],
    us4: [["tool.g.exceeds", 20], ["tool.g.meets", 60], ["tool.g.partially", 15], ["tool.g.below", 5]],
    none: []
  };
  var G_FB = {
    "tool.g.top": "Top", "tool.g.core": "Core", "tool.g.low": "Low", "tool.g.exceeds": "Exceeds",
    "tool.g.meets": "Meets", "tool.g.partially": "Partially meets", "tool.g.below": "Below"
  };
  function presetGrades(id) {
    var p = PRESETS[id] || [], out = [];
    for (var i = 0; i < p.length; i++) {
      var l = p[i][0];
      out.push({ label: l.indexOf("tool.g.") === 0 ? tr(l, G_FB[l]) : l, pct: p[i][1] });
    }
    return out;
  }
  function cloneGrades(g) {
    var o = [];
    for (var i = 0; i < g.length; i++) {
      var lab = String(g[i] && g[i].label != null ? g[i].label : "");
      var pct = Number(g[i] && g[i].pct);
      o.push({ label: lab, pct: isFinite(pct) ? pct : 0 });
    }
    return o;
  }

  /* ---- 샘플 데이터 — 관대한 M-01 / 엄격한 M-02 + 더러운 행·중복 포함 --- */
  var SAMPLE = [
    "employee_id\tname\tteam\trater_id\treview_type\tscore",
    "E101\tDana Kim\tPlatform\tM-01\t1st\t4.8",
    "E102\tRosa Silva\tPlatform\tM-01\t1st\t4.6",
    "E103\tOmar Haddad\tPlatform\tM-01\t1st\t4.5",
    "E104\tYuki Tanaka\tPlatform\tM-01\t1st\t4.3",
    "E105\tPriya Nair\tPlatform\tM-01\t1st\t4.2",
    "E201\tLars Weber\tSales\tM-02\t1st\t3.4",
    "E202\tAmina Diallo\tSales\tM-02\t1st\t3.1",
    "E203\tChen Wei\tSales\tM-02\t1st\t3.0",
    "E204\tSofia Rossi\tSales\tM-02\t1st\t2.8",
    "E205\tJack O'Neil\tSales\tM-02\t1st\t2.5",
    "E101\tDana Kim\tPlatform\tM-03\t2nd\t4.0",
    "E102\tRosa Silva\tPlatform\tM-03\t2nd\t3.2",
    "E103\tOmar Haddad\tPlatform\tM-03\t2nd\t4.4",
    "E104\tYuki Tanaka\tPlatform\tM-03\t2nd\t3.6",
    "E105\tPriya Nair\tPlatform\tM-03\t2nd\t3.9",
    "E201\tLars Weber\tSales\tM-03\t2nd\t4.1",
    "E202\tAmina Diallo\tSales\tM-03\t2nd\t3.3",
    "E203\tChen Wei\tSales\tM-03\t2nd\t3.8",
    "E204\tSofia Rossi\tSales\tM-03\t2nd\t3.5",
    "E205\tJack O'Neil\tSales\tM-03\t2nd\t2.9",
    "E103\tOmar Haddad\tPlatform\tM-01\t1st\t4.7",
    "E206\tNoa Levi\tSales\tM-02\t1st\tN/A",
    "E207\tHugo Martin\tSales\t\t1st\t3.2"
  ].join("\n");

  /* ---- 열 역할 --------------------------------------------------------- */
  var ROLES = [
    { k: "emp", key: "tool.col.emp", fb: "Employee ID", req: true },
    { k: "name", key: "tool.col.name", fb: "Name", req: false },
    { k: "rater", key: "tool.col.rater", fb: "Rater ID", req: true },
    { k: "score", key: "tool.col.score", fb: "Score", req: true },
    { k: "org", key: "tool.col.org", fb: "Team / Dept", req: false },
    { k: "type", key: "tool.col.type", fb: "Review type", req: false }
  ];

  /* ---- 평가유형 기본 가중치 -------------------------------------------- */
  var KINDS = {
    self: ["자기", "자기평가", "본인", "self", "selfreview", "selfassessment"],
    peer: ["동료", "동료평가", "peer", "peers", "360"],
    primary: ["1차", "일차", "1차평가", "primary", "1st", "first", "manager", "supervisor", "상급자"],
    secondary: ["2차", "이차", "2차평가", "secondary", "2nd", "second", "skip", "skiplevel", "차상위"]
  };
  function typeKind(t) {
    var n = String(t).toLowerCase().replace(/[\s_\-.]/g, "");
    if (!n) return "other";
    var order = ["self", "peer", "primary", "secondary"];
    for (var i = 0; i < order.length; i++) {
      var list = KINDS[order[i]];
      for (var j = 0; j < list.length; j++) {
        var s = list[j].toLowerCase().replace(/[\s_\-.]/g, "");
        if (n === s || n.indexOf(s) >= 0) return order[i];
      }
    }
    return "other";
  }
  function defaultWeight(t) {
    var k = typeKind(t);
    if (k === "primary") return 60;
    if (k === "secondary") return 40;
    if (k === "self" || k === "peer") return 0;   // 기본 제외 — 아래 배너로 반드시 알린다
    return 50;
  }
  function currentWeights() {
    var saved = prefs.weights || {}, w = {}, i, t, v, all0 = true, anySaved = false;
    for (i = 0; i < S.types.length; i++) {
      t = S.types[i];
      v = saved[t];
      if (typeof v !== "number" || !isFinite(v) || v < 0) v = defaultWeight(t);
      else anySaved = true;
      w[t] = v;
      if (v > 0) all0 = false;
    }
    // 기본값만으로 전부 0 이 되는 구성(예: 자기평가만 있는 파일)은 기본값이 스스로를 무력화한다
    if (all0 && !anySaved) for (i = 0; i < S.types.length; i++) w[S.types[i]] = 100;
    return w;
  }
  function typeLabel(t) { return t === "" ? tr("tool.typeBlank", "(blank)") : t; }

  /* ---- 인코딩 · 파일 읽기 (Blob.slice 청크 — 전체 문자열 적재 금지) ---- */
  function readSlice(file, start, end) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error || new Error("read error")); };
      try { fr.readAsArrayBuffer(file.slice(start, end)); } catch (e) { reject(e); }
    });
  }
  /* BOM → 강제 지정 → UTF-8(fatal) 시도 → 실패 시 euc-kr(CP949) 폴백.
     추측 결과는 칩에 표시한다 (추측 후 침묵 금지). */
  function sniffEncoding(file, forced) {
    return readSlice(file, 0, Math.min(file.size, SNIFF_BYTES)).then(function (buf) {
      var u8 = new Uint8Array(buf);
      if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) return "utf-8";
      if (forced) return forced;
      try {
        // stream:true 라 청크 끝의 잘린 멀티바이트는 오탐이 되지 않는다
        new TextDecoder("utf-8", { fatal: true }).decode(u8, { stream: true });
        return "utf-8";
      } catch (e) { /* 잘못된 바이트 → 한글 엑셀 CSV(CP949) 가능성 */ }
      try { new TextDecoder("euc-kr"); return "euc-kr"; } catch (e2) { return "utf-8"; }
    });
  }
  function streamParse(file, enc) {
    var dec;
    try { dec = new TextDecoder(enc, { fatal: false }); }
    catch (e) { dec = new TextDecoder("utf-8", { fatal: false }); enc = "utf-8"; }
    var chunks = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));
    var parser = null, head = "", delim = null, replaced = false, i = 0;
    function step() {
      if (i >= chunks) {
        if (!parser) { delim = CORE.detectDelimiter(head); parser = CORE.makeParser(delim); parser.write(head); head = ""; }
        var tail = dec.decode();
        if (tail) { if (tail.indexOf("�") >= 0) replaced = true; parser.write(tail); }
        return Promise.resolve({ rows: parser.end(), delim: delim, replacement: replaced, enc: enc });
      }
      var s = i * CHUNK_BYTES, e = Math.min(file.size, s + CHUNK_BYTES);
      i++;
      return readSlice(file, s, e).then(function (buf) {
        var text = dec.decode(new Uint8Array(buf), { stream: true });
        if (!replaced && text.indexOf("�") >= 0) replaced = true;
        if (!parser) {
          head += text;
          if (head.length >= SNIFF_BYTES || i >= chunks) {
            delim = CORE.detectDelimiter(head.slice(0, SNIFF_BYTES));
            parser = CORE.makeParser(delim);
            parser.write(head);
            head = "";
          }
        } else parser.write(text);
        setBusy(true, Math.round(i / chunks * 100));
        return step();
      });
    }
    return step();
  }

  /* ---- Web Worker: 5,000행 초과일 때만. 실패하면 동기로 되돌린다 ------- */
  var workerURL = null;
  function makeWorker() {
    try {
      if (typeof Worker !== "function" || typeof Blob !== "function" || !window.URL || !URL.createObjectURL) return null;
      if (!workerURL) {
        var src = "var CORE=(" + calibCore.toString() + ")();\n" +
          "self.onmessage=function(e){var d=e.data;try{" +
          "var r=CORE.calibrate(d.rows,d.opts,function(p){self.postMessage({t:'p',p:p});});" +
          "self.postMessage({t:'d',r:r});}catch(err){self.postMessage({t:'e',m:String((err&&err.message)||err)});}};";
        workerURL = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      }
      return new Worker(workerURL);
    } catch (e) { return null; }
  }

  /* ---- 상태 표시 ------------------------------------------------------- */
  function setStatus(msg, kind) {
    clear(UI.result);
    var p = el("p", null, msg);
    p.style.margin = "0";
    p.style.fontSize = "15px";
    if (kind === "err") p.style.color = "#dc2626";
    else if (kind === "hint") p.style.color = "var(--muted)";
    UI.result.appendChild(p);
  }
  function setBusy(v, pct) {
    S.busy = v;
    UI.calcBtn.disabled = v || !S.valid;
    UI.fileBtn.disabled = v; UI.sampleBtn.disabled = v;
    UI.progress.hidden = !v;
    if (v && typeof pct === "number") UI.progress.value = pct;
  }

  /* ---- 입력 처리 ------------------------------------------------------- */
  function resetAll() {
    S.rows = []; S.headers = []; S.result = null; S.valid = false;
    UI.chips.hidden = true; UI.mapSec.hidden = true; UI.optSec.hidden = true; UI.outSec.hidden = true;
    clear(UI.notes); clear(UI.inputBanners);
    UI.calcBtn.disabled = true;
    setStatus(tr("tool.msg.empty", "Paste your review scores above, or load the sample data to see how it works."), "hint");
    if (!storageOk) banner(UI.notes, tr("tool.msg.noStorage", "Private mode: your preset and column mapping can't be remembered for next time."), "warn");
  }
  function ingestText(text) {
    S.file = null; S.fileName = "";
    S.encForced = "auto"; UI.enc.value = "auto";
    if (!text || !/\S/.test(text)) { resetAll(); return; }
    var delim = CORE.detectDelimiter(text.slice(0, SNIFF_BYTES));
    afterParse(CORE.parseText(text, delim), delim, text.indexOf("�") >= 0, false);
  }
  function readFile(file) {
    if (!file || S.busy) return;
    S.file = file; S.fileName = file.name || "";
    clear(UI.inputBanners);
    setStatus(tr("tool.msg.reading", "Reading the file…"), "hint");
    setBusy(true, 0);
    var forced = S.encForced === "auto" ? null : S.encForced;
    sniffEncoding(file, forced)
      .then(function (enc) { S.enc = enc; return streamParse(file, enc); })
      .then(function (o) {
        setBusy(false);
        UI.paste.value = "";     // 대용량 원본을 DOM 에 통째로 올리지 않는다
        afterParse(o.rows, o.delim, o.replacement, true);
      })
      .catch(function (e) {
        setBusy(false);
        setStatus(tr("tool.msg.readErr", "Couldn't read that file."), "err");
        banner(UI.inputBanners, tr("tool.msg.readErr", "Couldn't read that file.") + " " + String((e && e.message) || e), "err");
      });
  }
  function rebuildHeaders() {
    var w = 0, i, lim = Math.min(S.rows.length, 50);
    for (i = 0; i < lim; i++) w = Math.max(w, S.rows[i].length);
    S.headers = [];
    for (i = 0; i < w; i++) {
      var h = (S.hasHeader && S.rows[0][i] != null) ? String(S.rows[0][i]).replace(/^\s+|\s+$/g, "") : "";
      S.headers.push(h || fill(tr("tool.colN", "Column {n}"), { n: i + 1 }));
    }
  }
  function resolveMapping() {
    var guess = CORE.guessMapping(S.headers), names = (S.hasHeader && prefs.mapNames) || {};
    var map = { emp: -1, name: -1, rater: -1, score: -1, org: -1, type: -1 }, used = {}, i, k, c;
    for (i = 0; i < ROLES.length; i++) {          // 저장된 매핑(헤더 이름 기준)이 우선
      k = ROLES[i].k;
      if (!names[k]) continue;
      for (c = 0; c < S.headers.length; c++) {
        if (S.headers[c] === names[k] && !used[c]) { map[k] = c; used[c] = 1; break; }
      }
    }
    for (i = 0; i < ROLES.length; i++) {          // 나머지는 자동 추정
      k = ROLES[i].k;
      if (map[k] >= 0) continue;
      c = guess[k];
      if (c >= 0 && !used[c]) { map[k] = c; used[c] = 1; }
    }
    return map;
  }
  function afterParse(rows, delim, replaced, isFile) {
    clear(UI.inputBanners); clear(UI.notes);
    S.rows = rows; S.delim = delim; S.replacement = !!replaced;
    S.result = null; UI.outSec.hidden = true;
    if (!rows.length) {
      S.valid = false; UI.calcBtn.disabled = true;
      UI.chips.hidden = true; UI.mapSec.hidden = true; UI.optSec.hidden = true;
      setStatus(tr("tool.msg.noRows", "No rows found in there — the file or paste looks empty."), "err");
      return;
    }
    S.hasHeader = CORE.looksLikeHeader(rows);
    UI.header.checked = S.hasHeader;
    rebuildHeaders();
    S.map = resolveMapping();
    renderMapping(); renderPreview(); refreshTypes();
    UI.chips.hidden = false;
    UI.chipEnc.hidden = !isFile; UI.enc.hidden = !isFile;
    renderChips();
    UI.mapSec.hidden = false; UI.optSec.hidden = false;
    if (S.replacement) banner(UI.inputBanners, tr("tool.msg.encBroken", "Some characters came out garbled. Re-save the file as UTF-8, or switch the encoding above."), "warn");
    if (rows.length > BIG_ROWS) banner(UI.inputBanners, fill(tr("tool.msg.bigFile", "{n} rows — that is past what a browser tab handles comfortably. If it struggles, split the file by department."), { n: fmt(rows.length, 0) }), "warn");
    validate();
  }
  function renderChips() {
    var n = S.rows.length - (S.hasHeader ? 1 : 0);
    UI.chipRows.textContent = (S.fileName ? S.fileName + " · " : "") + fill(tr("tool.chip.rows", "{n} rows"), { n: fmt(Math.max(0, n), 0) });
    var dn = S.delim === "\t" ? tr("tool.delim.tab", "Tab-separated") : S.delim === ";" ? tr("tool.delim.semi", "Semicolon-separated") : tr("tool.delim.comma", "Comma-separated");
    UI.chipDelim.textContent = dn;
    UI.chipEnc.textContent = S.enc === "euc-kr" ? tr("tool.enc.detEuckr", "Detected: EUC-KR") : tr("tool.enc.detUtf8", "Detected: UTF-8");
  }

  /* ---- 매핑 UI --------------------------------------------------------- */
  function renderMapping() {
    clear(UI.mapGrid);
    for (var i = 0; i < ROLES.length; i++) {
      var role = ROLES[i], wrap = el("div"), lb = el("label");
      lb.setAttribute("for", "map-" + role.k);
      lb.appendChild(document.createTextNode(tr(role.key, role.fb)));
      if (role.req) lb.appendChild(el("span", "req", " *"));
      var sel = el("select");
      sel.id = "map-" + role.k;
      sel.setAttribute("data-role", role.k);
      var none = el("option", null, tr("tool.colNone", "— not used —"));
      none.value = "-1";
      sel.appendChild(none);
      for (var c = 0; c < S.headers.length; c++) {
        var o = el("option", null, S.headers[c]);
        o.value = String(c);
        sel.appendChild(o);
      }
      sel.value = String(S.map[role.k]);
      sel.addEventListener("change", onMapChange);
      wrap.appendChild(lb); wrap.appendChild(sel);
      UI.mapGrid.appendChild(wrap);
    }
  }
  function onMapChange(e) {
    var role = e.target.getAttribute("data-role"), v = parseInt(e.target.value, 10);
    if (v >= 0) {                       // 한 열을 두 역할에 줄 수 없다 — 이전 역할을 해제
      for (var i = 0; i < ROLES.length; i++) {
        var k = ROLES[i].k;
        if (k !== role && S.map[k] === v) {
          S.map[k] = -1;
          var other = $("map-" + k);
          if (other) other.value = "-1";
        }
      }
    }
    S.map[role] = v;
    if (S.hasHeader) { prefs.mapNames = mapToNames(); savePrefs(); }
    if (role === "type") refreshTypes();
    invalidate();
  }
  function mapToNames() {
    var o = {};
    for (var i = 0; i < ROLES.length; i++) {
      var k = ROLES[i].k, c = S.map[k];
      if (c >= 0 && S.headers[c]) o[k] = S.headers[c];
    }
    return o;
  }
  function renderPreview() {
    clear(UI.previewWrap);
    if (!S.rows.length) return;
    var tbl = el("table"), thead = el("thead"), hr = el("tr"), c;
    for (c = 0; c < S.headers.length; c++) hr.appendChild(el("th", null, S.headers[c]));
    thead.appendChild(hr); tbl.appendChild(thead);
    var tb = el("tbody"), start = S.hasHeader ? 1 : 0;
    for (var r = start; r < Math.min(S.rows.length, start + PREVIEW_ROWS); r++) {
      var tr1 = el("tr");
      for (c = 0; c < S.headers.length; c++) {
        var v = S.rows[r][c];
        tr1.appendChild(el("td", null, v == null ? "" : String(v).slice(0, 48)));
      }
      tb.appendChild(tr1);
    }
    tbl.appendChild(tb); UI.previewWrap.appendChild(tbl);
  }

  /* ---- 평가유형 · 가중치 ----------------------------------------------- */
  function refreshTypes() {
    S.types = [];
    if (S.map.type >= 0) {
      var seen = Object.create(null), start = S.hasHeader ? 1 : 0;
      for (var i = start; i < S.rows.length; i++) {
        var row = S.rows[i];
        var v = (S.map.type < row.length && row[S.map.type] != null) ? String(row[S.map.type]).replace(/^\s+|\s+$/g, "") : "";
        if (seen[v] === undefined) {
          seen[v] = 1; S.types.push(v);
          if (S.types.length > MAX_TYPES) break;
        }
      }
    }
    renderWeights();
  }
  function renderWeights() {
    clear(UI.weightsGrid);
    if (S.types.length < 2 || S.types.length > MAX_TYPES) {
      UI.weightsWrap.hidden = true;   // 유형이 1개면 재정규화로 어차피 무의미, 40개 초과면 전부 동일 가중치
      return;
    }
    UI.weightsWrap.hidden = false;
    var w = currentWeights(), zeroed = [];
    for (var i = 0; i < S.types.length; i++) {
      (function (t) {
        var row = el("div", "w-row");
        row.appendChild(el("span", "w-name", typeLabel(t)));
        var inp = el("input");
        inp.type = "number"; inp.min = "0"; inp.step = "1"; inp.value = String(w[t]);
        inp.setAttribute("aria-label", fill(tr("tool.weightAria", "Weight for {t}"), { t: typeLabel(t) }));
        inp.addEventListener("input", function () {
          var v = inp.value === "" ? NaN : parseFloat(inp.value);
          prefs.weights = prefs.weights || {};
          prefs.weights[t] = (isFinite(v) && v >= 0) ? v : 0;
          savePrefs(); invalidate();
        });
        row.appendChild(inp);
        UI.weightsGrid.appendChild(row);
        if (w[t] === 0 && !(prefs.weights && typeof prefs.weights[t] === "number")) zeroed.push(typeLabel(t));
      })(S.types[i]);
    }
    if (zeroed.length) {   // 기본 0 을 조용히 적용하지 않는다 — 펼쳐서 알린다
      UI.weightsWrap.open = true;
      banner(UI.weightsGrid, fill(tr("tool.msg.zeroDefault", "{types} start at weight 0, so they are left out. Give them a weight above to count them in."), { types: zeroed.join(", ") }), "warn");
    }
  }

  /* ---- 등급 편집기 ----------------------------------------------------- */
  function markCustom() {
    if (S.presetId !== "custom") { S.presetId = "custom"; UI.preset.value = "custom"; prefs.preset = "custom"; }
    prefs.grades = cloneGrades(S.grades);
    savePrefs();
  }
  function gradeSum() {
    var s = 0;
    for (var i = 0; i < S.grades.length; i++) {
      var p = S.grades[i].pct;
      if (typeof p !== "number" || !isFinite(p)) return NaN;
      s += p;
    }
    return s;
  }
  function renderGrades() {
    clear(UI.gradesEditor);
    if (!S.grades.length) {
      UI.gradesEditor.appendChild(el("p", "hint", tr("tool.noGradeHint", "No grades — everyone is simply ranked by their calibrated score.")));
      return;
    }
    for (var i = 0; i < S.grades.length; i++) {
      (function (idx) {
        var row = el("div", "grade-row");
        var li = el("input", "g-label");
        li.type = "text"; li.value = S.grades[idx].label;
        li.setAttribute("aria-label", tr("tool.gradeLabelAria", "Grade label"));
        li.addEventListener("input", function () { S.grades[idx].label = li.value; markCustom(); invalidate(); });
        var pi = el("input", "g-pct");
        pi.type = "number"; pi.min = "0"; pi.max = "100"; pi.step = "0.1";
        pi.value = String(S.grades[idx].pct);
        pi.setAttribute("aria-label", tr("tool.gradePctAria", "Share of employees, in percent"));
        pi.addEventListener("input", function () {
          var v = pi.value === "" ? NaN : parseFloat(pi.value);
          S.grades[idx].pct = v;
          markCustom(); renderSum(); invalidate();
        });
        var rm = el("button", "g-rm", "×");
        rm.type = "button";
        rm.setAttribute("aria-label", tr("tool.removeGrade", "Remove this grade"));
        rm.addEventListener("click", function () {
          S.grades.splice(idx, 1); markCustom(); renderGrades(); invalidate();
        });
        row.appendChild(li); row.appendChild(pi); row.appendChild(rm);
        UI.gradesEditor.appendChild(row);
      })(i);
    }
    var add = el("button", "btn ghost", tr("tool.addGrade", "Add a grade"));
    add.type = "button";
    add.addEventListener("click", function () {
      S.grades.push({ label: "", pct: 0 }); markCustom(); renderGrades(); invalidate();
    });
    UI.gradesEditor.appendChild(add);
    var sum = el("p", "sum-line");
    sum.id = "sum-line";
    UI.gradesEditor.appendChild(sum);
    renderSum();
  }
  function renderSum() {
    var box = $("sum-line");
    if (!box) return;
    var s = gradeSum();
    var ok = isFinite(s) && Math.abs(s - 100) < 0.01;
    box.className = "sum-line" + (ok ? "" : " bad");
    box.textContent = isFinite(s)
      ? fill(tr("tool.sumLine", "Total {s}%"), { s: fmt(s, Math.round(s) === s ? 0 : 1) }) + (ok ? "" : " — " + tr("tool.sumMustBe", "must be exactly 100%"))
      : tr("tool.sumInvalid", "Every grade needs a percentage.");
  }

  /* ---- 검증 (조용한 실패 금지: 막을 땐 이유를 쓴다) -------------------- */
  function invalidate() {
    S.result = null;
    UI.outSec.hidden = true;
    clear(UI.notes);
    if (!storageOk) banner(UI.notes, tr("tool.msg.noStorage", "Private mode: your preset and column mapping can't be remembered for next time."), "warn");
    validate();
  }
  function validate() {
    var ok = true, msg = "", kind = "hint";
    if (!S.rows.length) { S.valid = false; UI.calcBtn.disabled = true; return false; }
    var missing = [];
    for (var i = 0; i < ROLES.length; i++) {
      if (ROLES[i].req && S.map[ROLES[i].k] < 0) missing.push(tr(ROLES[i].key, ROLES[i].fb));
    }
    var s = gradeSum();
    var w = currentWeights(), anyW = false, k;
    for (k in w) if (w.hasOwnProperty(k) && w[k] > 0) anyW = true;
    if (missing.length) {
      ok = false;
      msg = fill(tr("tool.msg.needCols", "Pick a column for {cols} to continue."), { cols: missing.join(", ") });
      kind = "err";
    } else if (S.grades.length && !(isFinite(s) && Math.abs(s - 100) < 0.01)) {
      ok = false;
      msg = isFinite(s)
        ? fill(tr("tool.msg.sumNot100", "Your grades add up to {s}% — fix them to total exactly 100% (we won't silently adjust them)."), { s: fmt(s, Math.round(s) === s ? 0 : 1) })
        : tr("tool.sumInvalid", "Every grade needs a percentage.");
      kind = "err";
    } else if (S.types.length > 1 && S.types.length <= MAX_TYPES && !anyW) {
      ok = false;
      msg = tr("tool.msg.allZeroWeights", "Every review type is weighted 0 — give at least one a weight above 0.");
      kind = "err";
    } else {
      msg = fill(tr("tool.msg.ready", "Ready — {n} rows mapped. Hit Calibrate ratings."), { n: fmt(Math.max(0, S.rows.length - (S.hasHeader ? 1 : 0)), 0) });
    }
    S.valid = ok;
    UI.calcBtn.disabled = !ok || S.busy;
    if (!S.result) setStatus(msg, kind);
    return ok;
  }

  /* ---- 계산 실행 ------------------------------------------------------- */
  function runCalibrate() {
    if (S.busy || !validate()) return;
    var opts = {
      map: { emp: S.map.emp, name: S.map.name, rater: S.map.rater, score: S.map.score, org: S.map.org, type: S.map.type },
      hasHeader: S.hasHeader, norm: UI.norm.value,
      grades: cloneGrades(S.grades), weights: currentWeights()
    };
    var dataRows = S.rows.length - (S.hasHeader ? 1 : 0);
    setBusy(true, 0);
    setStatus(tr("tool.msg.working", "Calibrating…"), "hint");

    function done(res) {
      setBusy(false);
      try { renderResult(res); }
      catch (e) { setStatus(tr("tool.msg.calcErr", "Something went wrong while calibrating.") + " " + String((e && e.message) || e), "err"); }
    }
    function runSync(warn) {
      setTimeout(function () {     // 상태 문구가 먼저 그려지도록 한 틱 양보
        try {
          var res = CORE.calibrate(S.rows, opts, null);
          done(res);
          if (warn) banner(UI.notes, warn, "warn");
        } catch (e) {
          setBusy(false);
          setStatus(tr("tool.msg.calcErr", "Something went wrong while calibrating.") + " " + String((e && e.message) || e), "err");
        }
      }, 0);
    }

    if (dataRows > WORKER_MIN_ROWS) {
      var w = makeWorker();
      if (w) {
        var timer = setTimeout(function () {
          try { w.terminate(); } catch (e) { /* noop */ }
          setBusy(false);
          setStatus(tr("tool.msg.timeout", "Calibration was taking too long and was stopped. Try splitting the file by department."), "err");
        }, WORKER_TIMEOUT_MS);
        w.onmessage = function (ev) {
          var d = ev.data || {};
          if (d.t === "p") { setBusy(true, d.p); return; }
          clearTimeout(timer);
          try { w.terminate(); } catch (e) { /* noop */ }
          if (d.t === "d") done(d.r);
          else runSync(null);
        };
        w.onerror = function () {
          clearTimeout(timer);
          try { w.terminate(); } catch (e) { /* noop */ }
          runSync(null);
        };
        try { w.postMessage({ rows: S.rows, opts: opts }); return; }
        catch (e) {
          clearTimeout(timer);
          try { w.terminate(); } catch (e2) { /* noop */ }
        }
      }
      runSync(tr("tool.msg.noWorker", "Background processing isn't available here, so the page may freeze for a moment on a file this size."));
      return;
    }
    runSync(null);
  }

  /* ---- 결과 렌더 ------------------------------------------------------- */
  var TABS = ["emp", "rater", "dist", "excl"];
  function switchTab(name) {
    for (var i = 0; i < TABS.length; i++) {
      var b = $("tabbtn-" + TABS[i]), p = $("panel-" + TABS[i]), on = TABS[i] === name;
      if (b) b.setAttribute("aria-selected", on ? "true" : "false");
      if (p) p.hidden = !on;
    }
    if (name === "dist") drawDist();
  }
  function changeText(c) {
    return c === 1 ? tr("tool.badge.up", "Up") : c === -1 ? tr("tool.badge.down", "Down") : "—";
  }
  function empColumns(res) {
    var cols = [];
    cols.push({ h: tr("tool.th.rank", "#"), num: true, v: function (e) { return fmt(e.rank, 0); } });
    cols.push({ h: tr("tool.th.emp", "Employee ID"), v: function (e) { return e.emp; } });
    if (S.map.name >= 0) cols.push({ h: tr("tool.th.name", "Name"), v: function (e) { return e.name; } });
    if (S.map.org >= 0) cols.push({ h: tr("tool.th.org", "Team"), v: function (e) { return e.org; } });
    cols.push({
      h: tr("tool.th.rater", "Rater"),
      v: function (e) { return e.rater || fill(tr("tool.nRaters", "{n} raters"), { n: fmt(e.raterCount, 0) }); }
    });
    cols.push({ h: tr("tool.th.mean", "Rater avg"), num: true, v: function (e) { return fmt(e.rMean, 2); } });
    cols.push({ h: tr("tool.th.sd", "Rater SD"), num: true, v: function (e) { return fmt(e.rSd, 2); } });
    cols.push({ h: tr("tool.th.raw", "Raw score"), num: true, v: function (e) { return fmt(e.raw, 2); } });
    if (res.effNorm !== "none") {
      cols.push({
        h: res.effNorm === "pct" ? tr("tool.th.pct", "Percentile") : tr("tool.th.z", "Z-score"),
        num: true, v: function (e) { return fmt(e.val, res.effNorm === "pct" ? 1 : 2); }
      });
    }
    if (res.grades.length) cols.push({ h: tr("tool.th.grade", "Grade"), v: function (e) { return e.grade || "—"; } });
    if (res.grades.length && res.effNorm !== "none") {
      cols.push({ h: tr("tool.th.change", "Change"), badge: true, v: function (e) { return changeText(e.change); } });
    }
    return cols;
  }
  function renderEmp(res) {
    clear(UI.empWrap);
    var cols = empColumns(res), i, j;
    var tbl = el("table"), thead = el("thead"), hr = el("tr");
    for (j = 0; j < cols.length; j++) {
      var th = el("th", cols[j].num ? "num" : null, cols[j].h);
      hr.appendChild(th);
    }
    thead.appendChild(hr); tbl.appendChild(thead);
    var tb = el("tbody"), n = Math.min(res.employees.length, MAX_TABLE_ROWS);
    for (i = 0; i < n; i++) {
      var e = res.employees[i], row = el("tr");
      for (j = 0; j < cols.length; j++) {
        var c = cols[j];
        if (c.badge) {
          var td = el("td");
          if (e.change === 1 || e.change === -1) td.appendChild(el("span", "badge " + (e.change === 1 ? "up" : "down"), changeText(e.change)));
          else td.textContent = "—";
          row.appendChild(td);
        } else {
          row.appendChild(el("td", c.num ? "num" : null, c.v(e)));
        }
      }
      tb.appendChild(row);
    }
    tbl.appendChild(tb); UI.empWrap.appendChild(tbl);
    UI.empNote.textContent = res.employees.length > n
      ? fill(tr("tool.msg.truncated", "Showing the top {n} of {total} — download the CSV for the full list."), { n: fmt(n, 0), total: fmt(res.employees.length, 0) })
      : "";
  }
  function renderRaters(res) {
    clear(UI.raterWrap);
    var maxAbs = 0, i;
    for (i = 0; i < res.raters.length; i++) maxAbs = Math.max(maxAbs, Math.abs(res.raters[i].dev));
    var tbl = el("table"), thead = el("thead"), hr = el("tr");
    var heads = [
      [tr("tool.rth.rater", "Rater"), false], [tr("tool.rth.n", "Ratees"), true],
      [tr("tool.rth.mean", "Their avg"), true], [tr("tool.rth.sd", "Their SD"), true],
      [tr("tool.rth.dev", "vs overall"), true], [tr("tool.rth.bias", "Leniency"), false]
    ];
    for (i = 0; i < heads.length; i++) hr.appendChild(el("th", heads[i][1] ? "num" : null, heads[i][0]));
    thead.appendChild(hr); tbl.appendChild(thead);
    var tb = el("tbody");
    for (i = 0; i < res.raters.length && i < MAX_TABLE_ROWS; i++) {
      var r = res.raters[i], row = el("tr");
      row.appendChild(el("td", null, r.rater));
      row.appendChild(el("td", "num", fmt(r.n, 0)));
      row.appendChild(el("td", "num", fmt(r.mean, 2)));
      row.appendChild(el("td", "num", fmt(r.sd, 2)));
      row.appendChild(el("td", "num", (r.dev > 0 ? "+" : "") + fmt(r.dev, 2)));
      var td = el("td"), wrap = el("div", "bar-wrap"), track = el("div", "bar-track");
      track.appendChild(el("div", "bar-mid"));
      var fillEl = el("div", "bar-fill"), pct = maxAbs ? Math.abs(r.dev) / maxAbs * 50 : 0;
      fillEl.style.width = pct + "%";
      fillEl.style.insetInlineStart = (r.dev >= 0 ? 50 : 50 - pct) + "%";
      track.appendChild(fillEl);
      wrap.appendChild(track);
      td.appendChild(wrap);
      row.appendChild(td);
      tb.appendChild(row);
    }
    tbl.appendChild(tb); UI.raterWrap.appendChild(tbl);
  }
  function renderDist(res) {
    clear(UI.distWrap);
    UI.canvas.hidden = !res.grades.length;
    if (!res.grades.length) {
      UI.distWrap.appendChild(el("p", "hint", tr("tool.dist.noGrades", "No grade distribution — you picked ranking only.")));
      return;
    }
    var tbl = el("table"), thead = el("thead"), hr = el("tr");
    var heads = [
      [tr("tool.dth.grade", "Grade"), false], [tr("tool.dth.target", "Target"), true],
      [tr("tool.dth.actual", "Actual"), true], [tr("tool.dth.count", "People"), true]
    ];
    for (var i = 0; i < heads.length; i++) hr.appendChild(el("th", heads[i][1] ? "num" : null, heads[i][0]));
    thead.appendChild(hr); tbl.appendChild(thead);
    var tb = el("tbody");
    for (i = 0; i < res.grades.length; i++) {
      var g = res.grades[i], row = el("tr");
      row.appendChild(el("td", null, g.label || "—"));
      row.appendChild(el("td", "num", fmt(g.pct, Math.round(g.pct) === g.pct ? 0 : 1) + "%"));
      row.appendChild(el("td", "num", fmt(g.actual, 1) + "%"));
      row.appendChild(el("td", "num", g.count === 0 ? tr("tool.dist.nobody", "None") : fmt(g.count, 0)));
      tb.appendChild(row);
    }
    tbl.appendChild(tb); UI.distWrap.appendChild(tbl);
  }
  function drawDist() {
    var res = S.result;
    if (!res || !res.grades.length || !UI.canvas) return;
    var c = UI.canvas, ctx = c.getContext && c.getContext("2d");
    if (!ctx) return;                                   // Canvas 미지원 → 아래 표가 같은 정보를 준다
    var W = (c.parentNode && c.parentNode.clientWidth) || 0;
    if (!W) return;
    var H = 220, PL = 36, PR = 10, PT = 26, PB = 30, dpr = window.devicePixelRatio || 1;
    c.style.width = "100%"; c.style.height = H + "px";
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var cs = getComputedStyle(document.documentElement);
    var accent = (cs.getPropertyValue("--accent") || "").trim() || "#9333ea";
    var lineC = (cs.getPropertyValue("--line") || "").trim() || "#e5e7eb";
    var mutedC = (cs.getPropertyValue("--muted") || "").trim() || "#6b7280";
    var maxPct = 10, i;
    for (i = 0; i < res.grades.length; i++) maxPct = Math.max(maxPct, res.grades[i].pct, res.grades[i].actual);
    maxPct = Math.ceil(maxPct / 10) * 10;
    var plotW = W - PL - PR, plotH = H - PT - PB;
    ctx.font = "11px " + ((cs.getPropertyValue("--font") || "").trim() || "sans-serif");
    ctx.textBaseline = "middle";
    for (i = 0; i <= 4; i++) {                          // 가로 눈금
      var gy = PT + plotH - (plotH * i / 4), gv = maxPct * i / 4;
      ctx.strokeStyle = lineC; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PL, Math.round(gy) + 0.5); ctx.lineTo(W - PR, Math.round(gy) + 0.5); ctx.stroke();
      ctx.fillStyle = mutedC; ctx.textAlign = "right";
      ctx.fillText(fmt(gv, 0) + "%", PL - 6, gy);
    }
    var n = res.grades.length, slot = plotW / n, bw = Math.min(26, slot * 0.34);
    var aria = [];
    for (i = 0; i < n; i++) {
      var g = res.grades[i], cx = PL + slot * (i + 0.5);
      var th = plotH * (g.pct / maxPct), ah = plotH * (g.actual / maxPct);
      ctx.fillStyle = lineC;                            // 목표: 연한 막대
      ctx.fillRect(cx - bw - 2, PT + plotH - th, bw, th);
      ctx.strokeStyle = mutedC; ctx.lineWidth = 1;
      ctx.strokeRect(cx - bw - 2 + 0.5, PT + plotH - th + 0.5, bw - 1, Math.max(0, th - 1));
      ctx.fillStyle = accent;                           // 실제: 강조 막대
      ctx.fillRect(cx + 2, PT + plotH - ah, bw, ah);
      ctx.fillStyle = mutedC; ctx.textAlign = "center";
      ctx.fillText(String(g.label || "—").slice(0, 8), cx, H - PB / 2);
      aria.push(fill(tr("tool.dist.ariaItem", "{g}: target {t}%, actual {a}%, {n} people"), {
        g: g.label || "—", t: fmt(g.pct, 0), a: fmt(g.actual, 1), n: fmt(g.count, 0)
      }));
    }
    ctx.textAlign = "left";                             // 범례
    ctx.fillStyle = lineC; ctx.fillRect(PL, PT - 16, 10, 10);
    ctx.strokeStyle = mutedC; ctx.strokeRect(PL + 0.5, PT - 15.5, 9, 9);
    ctx.fillStyle = mutedC; ctx.fillText(tr("tool.dist.target", "Target"), PL + 15, PT - 11);
    var lx = PL + 20 + ctx.measureText(tr("tool.dist.target", "Target")).width + 10;
    ctx.fillStyle = accent; ctx.fillRect(lx, PT - 16, 10, 10);
    ctx.fillStyle = mutedC; ctx.fillText(tr("tool.dist.actual", "Actual"), lx + 15, PT - 11);
    c.setAttribute("aria-label", tr("tool.dist.ariaTitle", "Grade distribution, target versus actual") + " — " + aria.join("; "));
  }
  function renderExcl(res) {
    clear(UI.exclWrap);
    var REASON = {
      missingEmp: ["tool.reason.missingEmp", "No employee ID"],
      missingRater: ["tool.reason.missingRater", "No rater ID"],
      missingScore: ["tool.reason.missingScore", "Score is empty"],
      nonNumeric: ["tool.reason.nonNumeric", "Score isn't a number"]
    };
    if (!res.dirtyCount) {
      UI.exclNote.textContent = tr("tool.excl.none", "Nothing was excluded — every row had an employee, a rater and a numeric score.");
      return;
    }
    UI.exclNote.textContent = fill(tr("tool.excl.note", "{n} rows were left out of the calculation. They are listed here with their line number so you can fix the source file — nothing was silently dropped."), { n: fmt(res.dirtyCount, 0) })
      + (res.dirtyCount > res.dirty.length ? " " + fill(tr("tool.excl.capped", "Showing the first {m}."), { m: fmt(res.dirty.length, 0) }) : "");
    var tbl = el("table"), thead = el("thead"), hr = el("tr");
    hr.appendChild(el("th", "num", tr("tool.eth.line", "Line")));
    hr.appendChild(el("th", null, tr("tool.eth.reason", "Why")));
    hr.appendChild(el("th", null, tr("tool.eth.row", "Row")));
    thead.appendChild(hr); tbl.appendChild(thead);
    var tb = el("tbody");
    for (var i = 0; i < res.dirty.length; i++) {
      var d = res.dirty[i], row = el("tr");
      row.appendChild(el("td", "num", fmt(d.line, 0)));
      var rs = REASON[d.reason] || ["", d.reason];
      row.appendChild(el("td", null, tr(rs[0], rs[1])));
      row.appendChild(el("td", null, d.raw));
      tb.appendChild(row);
    }
    tbl.appendChild(tb); UI.exclWrap.appendChild(tbl);
  }
  function renderSummary(res) {
    clear(UI.result);
    var p = el("p");
    p.style.margin = "0";
    p.appendChild(el("strong", null, fmt(res.overall.employees, 0)));
    var bits = [" " + tr("tool.sum.employees", "employees calibrated")];
    bits.push(fill(tr("tool.sum.raters", "{n} raters"), { n: fmt(res.overall.raters, 0) }));
    if (res.effNorm === "z") bits.push(tr("tool.sum.normZ", "z-score normalized"));
    else if (res.effNorm === "pct") bits.push(tr("tool.sum.normPct", "percentile normalized"));
    else bits.push(tr("tool.sum.normNone", "raw scores"));
    if (res.dirtyCount) bits.push(fill(tr("tool.sum.excluded", "{n} rows excluded"), { n: fmt(res.dirtyCount, 0) }));
    p.appendChild(document.createTextNode(bits.join(" · ")));
    UI.result.appendChild(p);
  }
  function renderNotes(res) {
    clear(UI.notes);
    var n = res.notes || {};
    if (!storageOk) banner(UI.notes, tr("tool.msg.noStorage", "Private mode: your preset and column mapping can't be remembered for next time."), "warn");
    if (n.singleRater) banner(UI.notes, tr("tool.msg.singleRater", "Only one rater in this data — there is no second scale to correct against, so raw scores were used."), "warn");
    if (n.allSingleRatee) banner(UI.notes, tr("tool.msg.allSingleRatee", "Every rater reviewed just one person, so a rater average is meaningless here. Raw scores were used instead."), "warn");
    if (n.zeroVarRaters) banner(UI.notes, fill(tr("tool.msg.zeroVar", "{n} rater(s) gave every one of their people the identical score. There is no spread to normalize, so their scores sit at the neutral middle."), { n: fmt(n.zeroVarRaters, 0) }), "warn");
    if (n.singleRateeRaters) banner(UI.notes, fill(tr("tool.msg.singleRatee", "{n} rater(s) reviewed only one person — left out of normalization and placed at the neutral middle."), { n: fmt(n.singleRateeRaters, 0) }), "warn");
    if (res.dupes) banner(UI.notes, fill(tr("tool.msg.dupes", "{n} duplicate rows (same employee, rater and review type) — the last one in the file won."), { n: fmt(res.dupes, 0) }), "warn");
    if (res.dirtyCount) banner(UI.notes, fill(tr("tool.msg.dirty", "{n} rows were excluded — see the Excluded rows tab for the line numbers."), { n: fmt(res.dirtyCount, 0) }), "warn");
    if (n.zeroWeightEmployees) banner(UI.notes, fill(tr("tool.msg.zeroWeightEmp", "{n} employees only have review types you weighted 0, so they scored 0. Give one of their types a weight."), { n: fmt(n.zeroWeightEmployees, 0) }), "warn");
  }
  function renderResult(res) {
    S.result = res;
    renderSummary(res); renderNotes(res);
    renderEmp(res); renderRaters(res); renderDist(res); renderExcl(res);
    UI.outSec.hidden = false;
    var active = "emp";
    for (var i = 0; i < TABS.length; i++) {
      var b = $("tabbtn-" + TABS[i]);
      if (b && b.getAttribute("aria-selected") === "true") active = TABS[i];
    }
    switchTab(active);
  }

  /* ---- 내보내기 -------------------------------------------------------- */
  function tableRows(res) {
    var cols = empColumns(res), out = [], head = [], i, j;
    for (j = 0; j < cols.length; j++) head.push(cols[j].h);
    out.push(head);
    for (i = 0; i < res.employees.length; i++) {
      var e = res.employees[i], row = [];
      for (j = 0; j < cols.length; j++) row.push(String(cols[j].v(e)));
      out.push(row);
    }
    return out;
  }
  function csvCell(v) {
    var s = String(v == null ? "" : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function flash(btn, msg) {
    var old = btn.textContent;
    btn.textContent = msg;
    setTimeout(function () { btn.textContent = old; }, 1400);
  }
  function doDownload() {
    if (!S.result) return;
    var rows = tableRows(S.result), lines = [], i, j;
    for (i = 0; i < rows.length; i++) {
      var cells = [];
      for (j = 0; j < rows[i].length; j++) cells.push(csvCell(rows[i][j]));
      lines.push(cells.join(","));
    }
    try {
      // UTF-8 BOM — 없으면 한글 엑셀에서 깨진다
      var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
      var url = URL.createObjectURL(blob), a = document.createElement("a");
      var d = new Date(), pad = function (x) { return (x < 10 ? "0" : "") + x; };
      a.href = url;
      a.download = "calibrated-ratings-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + ".csv";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    } catch (e) {
      setStatus(tr("tool.msg.downloadErr", "Your browser blocked the download. Use “Copy for Excel” instead."), "err");
    }
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }
  function doCopy() {
    if (!S.result) return;
    var rows = tableRows(S.result), lines = [], i, j;
    for (i = 0; i < rows.length; i++) {
      var cells = [];
      for (j = 0; j < rows[i].length; j++) cells.push(String(rows[i][j]).replace(/[\t\r\n]+/g, " "));
      lines.push(cells.join("\t"));
    }
    var text = lines.join("\n");
    function ok() { flash(UI.tsvBtn, tr("tool.msg.copied", "Copied")); }
    function fail() { setStatus(tr("tool.msg.copyErr", "Your browser blocked clipboard access — use “Download CSV” instead."), "err"); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () { if (legacyCopy(text)) ok(); else fail(); });
    } else if (legacyCopy(text)) ok();
    else fail();
  }

  /* ---- 이벤트 ---------------------------------------------------------- */
  var pasteTimer = null;
  UI.paste.addEventListener("input", function () {
    if (pasteTimer) clearTimeout(pasteTimer);
    pasteTimer = setTimeout(function () { ingestText(UI.paste.value); }, 300);
  });
  UI.fileBtn.addEventListener("click", function () { UI.file.click(); });
  UI.file.addEventListener("change", function () {
    if (UI.file.files && UI.file.files[0]) readFile(UI.file.files[0]);
  });
  UI.sampleBtn.addEventListener("click", function () {
    UI.file.value = "";
    UI.paste.value = SAMPLE;
    ingestText(SAMPLE);
  });
  UI.clearBtn.addEventListener("click", function () {
    UI.paste.value = ""; UI.file.value = "";
    S.file = null; S.fileName = "";
    resetAll();
    UI.paste.focus();
  });
  UI.enc.addEventListener("change", function () {
    S.encForced = UI.enc.value;
    if (S.file) readFile(S.file);
  });
  UI.header.addEventListener("change", function () {
    S.hasHeader = UI.header.checked;
    rebuildHeaders();
    S.map = resolveMapping();
    renderMapping(); renderPreview(); refreshTypes(); renderChips(); invalidate();
  });
  UI.norm.addEventListener("change", function () {
    prefs.norm = UI.norm.value; savePrefs();
    updateNormHint(); invalidate();
  });
  UI.preset.addEventListener("change", function () {
    S.presetId = UI.preset.value;
    prefs.preset = S.presetId;
    if (S.presetId !== "custom") { S.grades = presetGrades(S.presetId); prefs.grades = null; }
    savePrefs(); renderGrades(); invalidate();
  });
  UI.calcBtn.addEventListener("click", runCalibrate);
  UI.csvBtn.addEventListener("click", doDownload);
  UI.tsvBtn.addEventListener("click", doCopy);
  for (var ti = 0; ti < TABS.length; ti++) {
    (function (name) {
      var b = $("tabbtn-" + name);
      if (b) b.addEventListener("click", function () { switchTab(name); });
    })(TABS[ti]);
  }
  /* 드롭은 문서 전체에서 받는다 — 존을 살짝 빗나갔다고 브라우저가 파일을
     열어버려 입력을 통째로 날리는 게 최악이다 */
  function stopEv(e) { e.preventDefault(); e.stopPropagation(); }
  document.addEventListener("dragover", function (e) { stopEv(e); });
  document.addEventListener("drop", function (e) {
    stopEv(e);
    UI.drop.className = "drop";
    var dt = e.dataTransfer;
    if (!dt) return;
    if (dt.files && dt.files[0]) { UI.file.value = ""; readFile(dt.files[0]); return; }
    var t = dt.getData && dt.getData("text");
    if (t) { UI.paste.value = t; ingestText(t); }
  });
  UI.drop.addEventListener("dragenter", function (e) { stopEv(e); UI.drop.className = "drop over"; });
  UI.drop.addEventListener("dragover", function (e) { stopEv(e); UI.drop.className = "drop over"; });
  UI.drop.addEventListener("dragleave", function (e) { stopEv(e); UI.drop.className = "drop"; });

  function updateNormHint() {
    var v = UI.norm.value;
    UI.normHint.textContent = v === "z"
      ? tr("tool.norm.hintZ", "Each rater's scores are re-expressed as distance from that rater's own average, so a generous manager and a strict one land on the same scale.")
      : v === "pct"
        ? tr("tool.norm.hintPct", "Each score becomes a rank within that rater's own group. Robust to outliers, but it throws away how far apart people were.")
        : tr("tool.norm.hintNone", "Scores are ranked exactly as they were entered — whoever had the most generous reviewer wins.");
  }

  var redrawTimer = null;
  function scheduleRedraw() {
    if (redrawTimer) clearTimeout(redrawTimer);
    redrawTimer = setTimeout(function () {
      var b = $("tabbtn-dist");
      if (b && b.getAttribute("aria-selected") === "true") drawDist();
    }, 150);
  }
  window.addEventListener("resize", scheduleRedraw);
  // 테마 토글(셸)에는 이벤트가 없다 — 속성 변화를 보고 차트 색을 다시 칠한다
  if (window.MutationObserver) {
    new MutationObserver(scheduleRedraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  document.addEventListener("i18n:change", function () {
    nfCache = {};
    updateNormHint();
    if (S.presetId !== "custom") { S.grades = presetGrades(S.presetId); }
    renderGrades();
    if (S.rows.length) {
      rebuildHeaders(); renderMapping(); renderPreview(); renderWeights(); renderChips();
    }
    if (S.result) renderResult(S.result);
    else validate();
  });

  /* ---- init ------------------------------------------------------------ */
  (function init() {
    if (prefs.norm === "z" || prefs.norm === "pct" || prefs.norm === "none") UI.norm.value = prefs.norm;
    S.presetId = prefs.preset || "kr5";
    if (S.presetId !== "custom" && !PRESETS[S.presetId]) S.presetId = "kr5";
    UI.preset.value = S.presetId;
    S.grades = (S.presetId === "custom" && prefs.grades && prefs.grades.length)
      ? cloneGrades(prefs.grades)
      : presetGrades(S.presetId);
    renderGrades();
    updateNormHint();
    resetAll();
  })();
  // TOOLJS:END
})();
