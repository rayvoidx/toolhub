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
  // 성별 임금격차 리포트 — 전 계산이 이 탭 안에서 끝난다(서버·외부 API 0, Network 요청 0).
  // 급여 원본은 최고 민감 데이터라 "브라우저를 떠나지 않음"이 기능이 아니라 채택 조건이다.
  var SLUG = (window.APP_CONFIG && window.APP_CONFIG.slug) || "paygap-report";

  var EU_TRIGGER = 5;        // 지침 2023/970: 범주별 격차 5% 초과 → 공동임금평가 검토 신호(법적 확정 아님)
  var UK_THRESHOLD = 250;    // 250인+ 법정 보고 대상
  var WORKER_ROWS = 5000;    // 이 초과에서만 Worker 가동(backlog bulk_strategy · 통계는 O(n log n) 이라 과잉설계 금지)
  var MAX_ROWS = 200000;     // 상한 — 초과분은 조용히 버리지 않고 truncated 로 알린다
  var MAX_EXCLUDED = 1000;   // 제외 리포트 상한
  var MAX_CATEGORY = 400;    // 범주 상한

  /* ============================================================
     순수 커널 — node 로 단위검증하고, Worker 소스로도 그대로 직렬화한다.
     바깥 변수는 EU_TRIGGER 만 참조(Worker 소스에 상수로 함께 굽는다).
     ============================================================ */

  // 임금 문자열 → 숫자. 통화기호·공백 제거, 천단위/소수 구분자를 값 단위로 판별
  // (영국식 1,234.56 과 유럽식 1.234,56 · 1234,56 을 모두 해석 — EU 모드 대비).
  function pgNum(s) {
    if (s == null) return NaN;
    var t = String(s).trim().replace(/[£€₩$¥₹\s '"]/g, "");
    if (t === "") return NaN;
    var neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }   // 회계식 음수 (1,234)
    var hasC = t.indexOf(",") >= 0, hasD = t.indexOf(".") >= 0;
    if (hasC && hasD) {
      if (t.lastIndexOf(",") > t.lastIndexOf(".")) t = t.replace(/\./g, "").replace(",", "."); // 유럽식
      else t = t.replace(/,/g, "");                                                            // 영미식
    } else if (hasC) {
      var parts = t.split(","), thousands = parts.length > 1 && parts[0].length >= 1 && parts[0].length <= 3;
      for (var pi = 1; pi < parts.length && thousands; pi++) if (parts[pi].length !== 3) thousands = false;
      t = thousands ? t.replace(/,/g, "") : t.replace(",", ".");   // 1,234 은 천단위 / 12,5 는 소수
    }
    if (neg && t.charAt(0) !== "-") t = "-" + t;
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return NaN;
    return parseFloat(t);
  }

  // 성별 정규화 — 미매핑·공란·논바이너리·기타는 'other'(별도 분류 버킷). 강제 남/여 분류·삭제 금지.
  function pgNormGender(raw) {
    var s = String(raw == null ? "" : raw).trim().toLowerCase();
    if (s === "") return "other";
    if (s === "m" || s === "male" || s === "man" || s === "men" || s === "boy" || s === "1" ||
        s === "남" || s === "남성" || s === "남자" || s === "männlich" || s === "homme" ||
        s === "hombre" || s === "masculino" || s === "男" || s === "男性") return "male";
    if (s === "f" || s === "female" || s === "woman" || s === "women" || s === "girl" || s === "w" || s === "2" ||
        s === "여" || s === "여성" || s === "여자" || s === "weiblich" || s === "femme" ||
        s === "mujer" || s === "feminino" || s === "女" || s === "女性") return "female";
    return "other";
  }

  // 증분 RFC4180 토크나이저 — 따옴표 안의 구분자·개행·이스케이프("")를 처리하고
  // 청크 경계에 걸친 행을 내부 상태로 이어붙인다(스트리밍).
  function pgCsvStream(delim) {
    var out = [], field = "", row = [], st = 0, cr = false;
    function endRow() { row.push(field); field = ""; out.push(row); row = []; st = 0; }
    function flush() { var r = out; out = []; return r; }
    return {
      push: function (text) {
        for (var i = 0; i < text.length; i++) {
          var c = text.charAt(i);
          if (cr) { cr = false; if (c === "\n") continue; }
          if (st === 2) { if (c === '"') st = 3; else field += c; continue; }
          if (st === 3) { if (c === '"') { field += '"'; st = 2; continue; } st = 1; }
          if (c === '"' && st === 0) { st = 2; continue; }
          if (c === delim) { row.push(field); field = ""; st = 0; continue; }
          if (c === "\n") { endRow(); continue; }
          if (c === "\r") { endRow(); cr = true; continue; }
          field += c;
          if (st === 0) st = 1;
        }
        return flush();
      },
      end: function () { if (st !== 0 || field !== "" || row.length) endRow(); return flush(); }
    };
  }

  // 구분자 자동감지 — 모든 행에 일관되게 나타나는 후보(, ; \t)를 고른다.
  function pgDetectDelim(text) {
    var truncated = text.length > 8192;
    var head = text.slice(0, 8192).split(/\r\n|\r|\n/);
    if (truncated && head.length > 1) head.pop();
    var cand = [",", "\t", ";"], best = ",", bestScore = 0, i, c;
    for (c = 0; c < cand.length; c++) {
      var counts = [];
      for (i = 0; i < head.length && counts.length < 6; i++) {
        if (head[i] === "") continue;
        counts.push(head[i].split(cand[c]).length - 1);
      }
      if (!counts.length) continue;
      var min = counts[0], sum = 0;
      for (i = 0; i < counts.length; i++) { if (counts[i] < min) min = counts[i]; sum += counts[i]; }
      var score = min > 0 ? 1000 * min + sum : 0;
      if (score > bestScore) { bestScore = score; best = cand[c]; }
    }
    return best;
  }

  // Welford 누적 평균 — 대량 합의 자리수 손실 방지.
  function pgMean(arr) {
    var m = 0, k = 0;
    for (var i = 0; i < arr.length; i++) { k++; m += (arr[i] - m) / k; }
    return k ? m : null;
  }

  // 오름차순 정렬된 배열의 중앙값 — 짝수 표본은 가운데 두 값의 평균.
  function pgMedian(sorted) {
    var n = sorted.length;
    if (n === 0) return null;
    var mid = Math.floor(n / 2);
    return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // 사분위 배치 — 시급 오름차순 정렬된 이분 대상(male/female)만 입력.
  // N 이 4로 안 나눠지면 잔여를 앞 구간부터 1명씩, 경계 동률(straddle)은 성비가
  // 구간 간 최대한 고르게 갈리도록 재배분(UK 공식 가이드 규칙).
  function pgQuartiles(sorted) {
    var res = [{ male: 0, female: 0, total: 0 }, { male: 0, female: 0, total: 0 },
               { male: 0, female: 0, total: 0 }, { male: 0, female: 0, total: 0 }];
    var N = sorted.length;
    if (N === 0) return { quartiles: res, straddle: 0 };
    var base = Math.floor(N / 4), r = N % 4;
    var sizes = [base + (r > 0 ? 1 : 0), base + (r > 1 ? 1 : 0), base + (r > 2 ? 1 : 0), base];
    var q = new Array(N), idx = 0, g, c, i, k;
    for (g = 0; g < 4; g++) for (c = 0; c < sizes[g]; c++) q[idx++] = g;
    var straddle = 0;
    i = 0;
    while (i < N) {
      var j = i;
      while (j + 1 < N && sorted[j + 1].h === sorted[i].h) j++;
      if (q[j] !== q[i]) {                         // 동일 시급이 경계를 걸친다
        straddle += (j - i + 1);
        var slotOrder = [];
        for (k = i; k <= j; k++) slotOrder.push(q[k]);   // 이 구간의 분위 슬롯 수는 그대로 유지
        var males = [], females = [];
        for (k = i; k <= j; k++) { if (sorted[k].g === "male") males.push(k); else females.push(k); }
        var ordered = [], mi = 0, fi = 0;               // 큰 쪽부터 번갈아 뽑아 각 성별을 고르게 퍼뜨린다
        while (mi < males.length || fi < females.length) {
          var remM = males.length - mi, remF = females.length - fi;
          if (remF === 0 || (remM > 0 && remM >= remF)) ordered.push(males[mi++]);
          else ordered.push(females[fi++]);
        }
        for (k = 0; k < ordered.length; k++) q[ordered[k]] = slotOrder[k];
      }
      i = j + 1;
    }
    for (i = 0; i < N; i++) {
      var qq = q[i];
      res[qq].total++;
      if (sorted[i].g === "male") res[qq].male++; else res[qq].female++;
    }
    return { quartiles: res, straddle: straddle };
  }

  function pgCell(f, idx) { return idx >= 0 && f[idx] != null ? String(f[idx]).trim() : ""; }

  // 행 → 이분 대상 모집단 추출. 시급 도출·성별 정규화·상여/등급 파싱을 한 곳에 모은다.
  // 더러운 행은 버리지 않고 excluded 로, 성별 미상은 separate 로 되돌린다(철칙 5).
  function pgExtract(records, skip, map) {
    var pop = [], excluded = [], excludedCount = 0, separateN = 0, read = 0, bonusBad = 0;
    var cats = [], catIdx = {};
    function intern(name) {
      var key = "#" + name.toLowerCase();
      if (catIdx[key] == null) { catIdx[key] = cats.length; cats.push(name); }
      return catIdx[key];
    }
    for (var r = skip; r < records.length; r++) {
      var f = records[r].f, n = records[r].n;
      read++;
      var hourly = NaN, reason = "", val = "";
      var hcell = map.hourly >= 0 ? pgCell(f, map.hourly) : "";
      if (map.hourly >= 0 && hcell !== "") {
        hourly = pgNum(hcell);
        if (isNaN(hourly)) { reason = "nonum"; val = hcell; }
        else if (hourly < 0) { reason = "neg"; val = hcell; }
      } else if (map.base >= 0 && map.hours >= 0) {
        var bcell = pgCell(f, map.base), hrcell = pgCell(f, map.hours);
        var bv = pgNum(bcell), hh = pgNum(hrcell);
        if (isNaN(bv) || isNaN(hh)) { reason = "nonum"; val = bcell + " / " + hrcell; }
        else if (bv < 0) { reason = "neg"; val = bcell; }
        else if (hh <= 0) { reason = "nohours"; val = hrcell; }
        else hourly = bv / hh;
      } else {
        reason = "nopay";
      }
      if (reason) {
        excludedCount++;
        if (excluded.length < MAX_EXCLUDED) excluded.push({ n: n, reason: reason, val: val });
        continue;
      }
      var g = pgNormGender(pgCell(f, map.gender));
      if (g !== "male" && g !== "female") { separateN++; continue; }
      var bonus = 0;
      if (map.bonus >= 0) {
        var bc = pgCell(f, map.bonus);
        if (bc !== "") { var bn = pgNum(bc); if (isNaN(bn)) bonusBad++; else bonus = Math.max(0, bn); }
      }
      var gi = -1;
      if (map.grade >= 0) {
        var gc = pgCell(f, map.grade);
        if (gc !== "" && (cats.length < MAX_CATEGORY || catIdx["#" + gc.toLowerCase()] != null)) gi = intern(gc);
      }
      pop.push({ h: hourly, b: bonus, g: g, gi: gi, i: pop.length });
    }
    return {
      pop: pop, excluded: excluded, excludedCount: excludedCount, separateN: separateN,
      read: read, bonusBad: bonusBad, categories: cats,
      hasBonus: map.bonus >= 0, hasGrade: map.grade >= 0,
      hourlySource: map.hourly >= 0 ? "column" : "computed"
    };
  }

  // 모집단 → 법정 지표. 무거운 정렬은 여기(>5천이면 Worker 안에서).
  function pgStats(ext, country) {
    var pop = ext.pop, i, p;
    var maleH = [], femaleH = [], maleB = [], femaleB = [];
    var maleN = 0, femaleN = 0, maleRec = 0, femaleRec = 0;
    for (i = 0; i < pop.length; i++) {
      p = pop[i];
      if (p.g === "male") { maleH.push(p.h); maleN++; if (ext.hasBonus && p.b > 0) { maleB.push(p.b); maleRec++; } }
      else { femaleH.push(p.h); femaleN++; if (ext.hasBonus && p.b > 0) { femaleB.push(p.b); femaleRec++; } }
    }
    function numAsc(a, b) { return a - b; }
    var meanHM = maleN ? pgMean(maleH) : null, meanHF = femaleN ? pgMean(femaleH) : null;
    var medHM = maleN ? pgMedian(maleH.slice().sort(numAsc)) : null;
    var medHF = femaleN ? pgMedian(femaleH.slice().sort(numAsc)) : null;
    var meanBM = maleRec ? pgMean(maleB) : null, meanBF = femaleRec ? pgMean(femaleB) : null;
    var medBM = maleRec ? pgMedian(maleB.slice().sort(numAsc)) : null;
    var medBF = femaleRec ? pgMedian(femaleB.slice().sort(numAsc)) : null;

    function hourlyGap(m, f) {
      if (maleN === 0 || femaleN === 0) return { ok: false, reason: "onesided" };
      if (m === 0) return { ok: false, reason: "zerodenom", m: m, f: f };
      return { ok: true, value: (m - f) / m * 100, m: m, f: f };
    }
    function bonusGap(m, f) {
      if (!ext.hasBonus) return { ok: false, reason: "nobonus" };
      if (maleRec === 0 || femaleRec === 0) return { ok: false, reason: "norecipients" };
      if (m === 0) return { ok: false, reason: "zerodenom", m: m, f: f };
      return { ok: true, value: (m - f) / m * 100, m: m, f: f };
    }

    var sortedPop = pop.slice().sort(function (a, b) { return a.h - b.h || a.i - b.i; });   // 안정 정렬
    var quart = pgQuartiles(sortedPop);

    var categories = [];
    if (ext.hasGrade) {
      var byCat = {}, order = [];
      for (i = 0; i < pop.length; i++) {
        p = pop[i];
        if (p.gi < 0) continue;
        var key = "#" + p.gi;
        if (!byCat[key]) { byCat[key] = { name: ext.categories[p.gi], mH: [], fH: [] }; order.push(key); }
        if (p.g === "male") byCat[key].mH.push(p.h); else byCat[key].fH.push(p.h);
      }
      for (var o = 0; o < order.length; o++) {
        var cobj = byCat[order[o]];
        var cmM = cobj.mH.length ? pgMean(cobj.mH) : null, cmF = cobj.fH.length ? pgMean(cobj.fH) : null;
        var gap = null, flag = false, comparable = cobj.mH.length > 0 && cobj.fH.length > 0;
        if (comparable && cmM !== 0) { gap = (cmM - cmF) / cmM * 100; flag = Math.abs(gap) > EU_TRIGGER; }
        categories.push({ name: cobj.name, meanM: cmM, meanF: cmF, gap: gap,
                          n: cobj.mH.length + cobj.fH.length, flag: flag, comparable: comparable });
      }
    }

    return {
      country: country, read: ext.read, excludedCount: ext.excludedCount, excluded: ext.excluded,
      separateN: ext.separateN, bonusBad: ext.bonusBad, hasBonus: ext.hasBonus, hasGrade: ext.hasGrade,
      hourlySource: ext.hourlySource, binaryN: maleN + femaleN, maleN: maleN, femaleN: femaleN,
      maleRec: maleRec, femaleRec: femaleRec,
      meanHM: meanHM, meanHF: meanHF, medHM: medHM, medHF: medHF,
      meanBM: meanBM, meanBF: meanBF, medBM: medBM, medBF: medBF,
      meanHourly: hourlyGap(meanHM, meanHF), medianHourly: hourlyGap(medHM, medHF),
      meanBonus: bonusGap(meanBM, meanBF), medianBonus: bonusGap(medBM, medBF),
      propM: maleN ? maleRec / maleN * 100 : null, propF: femaleN ? femaleRec / femaleN * 100 : null,
      quartiles: quart.quartiles, straddle: quart.straddle, categories: categories
    };
  }

  function pgCompute(records, skip, map, country) { return pgStats(pgExtract(records, skip, map), country); }

  var PG_SYN = {
    gender: ["gender", "sex", "성별", "성", "남녀", "geschlecht", "sexe", "sexo", "genre", "性別", "lingg"],
    hourly: ["hourlypay", "hourlyrate", "hourlywage", "payperhour", "ratepayhour", "hourly", "시급", "시간당임금", "시간당", "stundenlohn", "tauxhoraire"],
    base: ["basepay", "basesalary", "grosspay", "salary", "wage", "기본급", "월급여", "급여", "통상임금", "basispay", "grundgehalt", "salaire"],
    bonus: ["bonuspay", "bonus", "incentive", "commission", "상여", "보너스", "성과급", "인센티브", "prämie", "prime"],
    hours: ["hoursworked", "workinghours", "hours", "fte", "근로시간", "노동시간", "시간", "arbeitsstunden", "heures"],
    grade: ["jobgrade", "paygrade", "grade", "band", "category", "jobcategory", "role", "level", "등급", "직급", "직군", "직무", "범주", "kategorie", "niveau"]
  };

  function pgNormHead(s) { return String(s == null ? "" : s).toLowerCase().replace(/[\s ()[\]{}·,.\-_/\\:]/g, ""); }

  // 가장 긴 동의어가 이긴다 — "hourlypay" 가 base("pay")로 새지 않게 하는 장치.
  function pgAutoMap(headers) {
    var m = { gender: -1, hourly: -1, base: -1, bonus: -1, hours: -1, grade: -1 };
    var cands = [], i, k, j;
    for (i = 0; i < headers.length; i++) {
      var h = pgNormHead(headers[i]);
      if (!h) continue;
      for (k in PG_SYN) {
        if (!PG_SYN.hasOwnProperty(k)) continue;
        var best = 0;
        for (j = 0; j < PG_SYN[k].length; j++) if (h.indexOf(PG_SYN[k][j]) >= 0 && PG_SYN[k][j].length > best) best = PG_SYN[k][j].length;
        if (best) cands.push({ col: i, field: k, score: best });
      }
    }
    cands.sort(function (a, b) { return b.score - a.score || a.col - b.col; });
    var usedCol = {};
    for (i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (m[c.field] >= 0 || usedCol["#" + c.col]) continue;
      m[c.field] = c.col; usedCol["#" + c.col] = 1;
    }
    return m;
  }

  function pgCsvCell(s) { var t = s == null ? "" : String(s); return /["\r\n,]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }

  // 리포트 CSV — 규제기관 제출용이라 열 이름은 영어 고정(UI 언어와 무관하게 안정).
  function pgExportCsv(st) {
    function pct(x) { return x == null ? "" : (Math.round(x * 10) / 10).toFixed(1); }
    function pv(o) { return o && o.ok ? pct(o.value) : ""; }
    function num(x) { return x == null ? "" : (Math.round(x * 100) / 100); }
    var rows = [["Metric", "Value (%)", "Men", "Women", "Notes"]];
    var na = { onesided: "needs both men and women", zerodenom: "men figure is 0 (undefined)",
               nobonus: "no bonus column", norecipients: "no bonus recipients on one side" };
    function metricRow(label, o, mv, wv) {
      rows.push([label, pv(o), o && o.ok ? num(mv) : "", o && o.ok ? num(wv) : "", o && o.ok ? "" : (na[o && o.reason] || "")]);
    }
    metricRow("Mean hourly pay gap", st.meanHourly, st.meanHM, st.meanHF);
    metricRow("Median hourly pay gap", st.medianHourly, st.medHM, st.medHF);
    metricRow("Mean bonus gap", st.meanBonus, st.meanBM, st.meanBF);
    metricRow("Median bonus gap", st.medianBonus, st.medBM, st.medBF);
    rows.push(["Proportion receiving a bonus", "", st.propM == null ? "" : pct(st.propM), st.propF == null ? "" : pct(st.propF),
               st.hasBonus ? "" : "no bonus column"]);
    var qn = ["Lower quartile", "Lower middle quartile", "Upper middle quartile", "Upper quartile"];
    for (var i = 0; i < 4; i++) {
      var q = st.quartiles[i], tot = q.total || 1;
      rows.push([qn[i] + " — % men / women", "", (Math.round(q.male / tot * 1000) / 10).toFixed(1),
                 (Math.round(q.female / tot * 1000) / 10).toFixed(1), "n=" + q.total]);
    }
    if (st.hasGrade) {
      for (i = 0; i < st.categories.length; i++) {
        var c = st.categories[i];
        rows.push(["Category: " + c.name, c.comparable && c.gap != null ? pct(c.gap) : "",
                   num(c.meanM), num(c.meanF), (c.flag ? ">5% review signal" : (c.comparable ? "" : "one gender only"))]);
      }
    }
    rows.push(["Binary (statutory) population", String(st.binaryN), String(st.maleN), String(st.femaleN), ""]);
    rows.push(["Separately classified (unknown / non-binary)", String(st.separateN), "", "", "excluded from statutory figures"]);
    rows.push(["Excluded rows (data errors)", String(st.excludedCount), "", "", ""]);
    var out = [];
    for (i = 0; i < rows.length; i++) {
      var line = [];
      for (var j = 0; j < rows[i].length; j++) line.push(pgCsvCell(rows[i][j]));
      out.push(line.join(","));
    }
    return out.join("\r\n");
  }

  // Worker 본체 — 통계만 오프로드(>5천). 원본 셀은 넘어가지 않고 익명 수치 모집단만 오간다.
  function pgStatsWorker(scope) {
    scope.onmessage = function (e) {
      var m = e.data || {};
      if (m.cmd === "stats") {
        scope.postMessage({ type: "progress", pct: 15 });
        var st = pgStats(m.ext, m.country);
        scope.postMessage({ type: "progress", pct: 100 });
        scope.postMessage({ type: "result", stats: st });
      }
    };
  }

  /* ---------- node 단위검증 훅 — 브라우저에는 module 이 없어 그대로 UI 초기화로 진행 ---------- */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      pgNum: pgNum, pgNormGender: pgNormGender, pgCsvStream: pgCsvStream, pgDetectDelim: pgDetectDelim,
      pgMean: pgMean, pgMedian: pgMedian, pgQuartiles: pgQuartiles, pgExtract: pgExtract,
      pgStats: pgStats, pgCompute: pgCompute, pgAutoMap: pgAutoMap, pgExportCsv: pgExportCsv,
      pgNormHead: pgNormHead, EU_TRIGGER: EU_TRIGGER, UK_THRESHOLD: UK_THRESHOLD
    };
    return;
  }

  /* ============================================================
     UI
     ============================================================ */
  var $ = function (id) { return document.getElementById(id); };
  var FIELDS = ["gender", "hourly", "base", "bonus", "hours", "grade"];

  var state = {
    src: null, srcName: "", parsed: null, hasHeader: true, truncated: false,
    country: "UK", map: { gender: -1, hourly: -1, base: -1, bonus: -1, hours: -1, grade: -1 },
    parsing: false, cancelParse: false, computing: false, worker: null, lastStats: null, pgTimer: null
  };

  function t(key, vars) {
    var s = window.I18N ? window.I18N.t(key) : null;
    if (s == null) s = key;
    if (vars) for (var k in vars) if (vars.hasOwnProperty(k)) s = s.split("{" + k + "}").join(String(vars[k]));
    return s;
  }
  function uiLang() { return (window.I18N && window.I18N.lang()) || "en"; }
  function fmtN(v) { try { return new Intl.NumberFormat(uiLang()).format(v); } catch (e) { return String(v); } }
  function fmtNum(v, d) {
    if (v == null) return "–";
    try { return new Intl.NumberFormat(uiLang(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v); }
    catch (e) { return v.toFixed(d); }
  }
  function fmtPct(v) { return fmtNum(v, 1) + "%"; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function loadPref(key, fallback) {
    try { var v = localStorage.getItem(SLUG + ":" + key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function savePref(key, val) {
    try { localStorage.setItem(SLUG + ":" + key, JSON.stringify(val)); } catch (e) { /* private mode */ }
  }

  var SAMPLE = [
    "Employee,Gender,Hourly pay,Bonus,Grade",
    '"Adeyemi, Ada",F,18.40,500,Analyst',
    "Baker John,M,21.10,1500,Analyst",
    "Chen Wei,F,19.75,0,Analyst",
    "Diaz Marco,M,20.30,900,Analyst",
    "Evans Sarah,F,27.60,2200,Manager",
    "Foster James,M,33.20,4800,Manager",
    "Green Priya,F,31.10,3600,Manager",
    "Hughes David,M,34.80,5200,Manager",
    "Ito Kenji,M,24.50,1800,Senior",
    "Jones Emma,F,23.20,1200,Senior",
    "Khan Aisha,F,22.90,0,Senior",
    "Lopez Diego,M,25.75,2000,Senior",
    "Morgan Alex,X,26.00,1500,Senior",
    "Novak Petra,F,17.80,300,Analyst",
    "OBrien Sean,M,19.90,0,Analyst",
    "Park Jimin,F,29.40,2600,Manager",
    "Quinn Riley,M,30.10,3100,Manager",
    "Rossi Giulia,F,21.60,700,Senior",
    "Smith Tom,M,22.40,1100,Senior",
    "Tanaka Yuki,F,,900,Analyst",
    "Usman Bilal,M,not-paid,0,Analyst"
  ].join("\n");

  /* ---------- 입력 ---------- */

  function setSrcNote(key, isWarn, vars) {
    var n = $("pg-srcnote");
    n.className = "pg-note" + (isWarn ? " pg-warn" : "");
    if (vars || isWarn) { n.removeAttribute("data-i18n"); n.textContent = t(key, vars); }
    else { n.setAttribute("data-i18n", key); n.textContent = t(key); }
  }

  function resetOutputs() {
    $("pg-setup").hidden = true;
    $("pg-result").hidden = true;
    $("pg-opts").hidden = true;
    $("pg-encwarn").hidden = true;
    $("pg-progress").hidden = true;
  }

  function useText(text, name) {
    if (!text || !text.trim()) {
      state.src = null; state.parsed = null;
      resetOutputs();
      setSrcNote("tool.empty", false);
      return;
    }
    state.src = { kind: "text", text: text };
    state.srcName = name || "";
    $("pg-opts").hidden = false;
    $("pg-enc").disabled = true;              // 붙여넣기는 이미 디코드된 텍스트
    $("pg-encwarn").hidden = true;
    startParse();
  }

  function useFile(file) {
    if (!file) return;
    state.src = { kind: "file", file: file };
    state.srcName = file.name || "";
    $("pg-paste").value = "";
    $("pg-opts").hidden = false;
    $("pg-enc").disabled = false;
    startParse();
  }

  function makeDecoder(u8, want) {
    function sniff(u) {
      if (u.length >= 3 && u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF) return "utf-8";
      try { new TextDecoder("utf-8", { fatal: true }).decode(u.subarray(0, Math.min(u.length, 262144)), { stream: true }); return "utf-8"; }
      catch (e) { return "euc-kr"; }
    }
    var enc = want && want !== "auto" ? want : sniff(u8);
    try { return { enc: enc, dec: new TextDecoder(enc) }; }
    catch (e) { return { enc: "utf-8", dec: new TextDecoder("utf-8") }; }
  }

  function startParse() {
    if (!state.src) return;
    state.parsing = true; state.cancelParse = false; state.truncated = false; state.lastStats = null;
    resetOutputs();
    $("pg-pfill").style.width = "0%";
    $("pg-ptext").textContent = t("tool.progress", { rows: 0 });
    var pg = $("pg-progress");
    pg.hidden = true;
    clearTimeout(state.pgTimer);
    state.pgTimer = setTimeout(function () { if (state.parsing) pg.hidden = false; }, 250);   // 작은 파일은 깜빡이지 않게
    var wantDelim = $("pg-delim").value, wantEnc = $("pg-enc").value;
    if (state.src.kind === "text") parseText(state.src.text, wantDelim, onParsed, onProgress);
    else parseFile(state.src.file, wantEnc, wantDelim, onParsed, onProgress, onReadError);
  }

  function onProgress(rows, pct) {
    $("pg-pfill").style.width = pct + "%";
    $("pg-ptext").textContent = t("tool.progress", { rows: fmtN(rows) });
    if (rows > 3000 && state.parsing) $("pg-progress").hidden = false;
  }
  function onReadError() {
    state.parsing = false; clearTimeout(state.pgTimer);
    $("pg-progress").hidden = true;
    setSrcNote("tool.err.read", true);
  }

  function collectRows(records, rows) {
    for (var i = 0; i < rows.length; i++) {
      var f = rows[i], blank = true;
      for (var j = 0; j < f.length; j++) if (String(f[j]).trim() !== "") { blank = false; break; }
      if (blank) continue;
      if (records.length >= MAX_ROWS) return true;   // 상한 도달
      records.push({ n: records.length + 1, f: f });
    }
    return false;
  }

  function parseText(text, wantDelim, cb, prog) {
    var delim = (wantDelim && wantDelim !== "auto") ? (wantDelim === "tab" ? "\t" : wantDelim) : pgDetectDelim(text);
    var stream = pgCsvStream(delim), records = [], over = false, pos = 0, CH = 262144;
    (function step() {
      if (state.cancelParse) return;
      if (pos >= text.length) { over = collectRows(records, stream.end()) || over; cb({ records: records, delim: delim, enc: "utf-8", over: over }); return; }
      if (collectRows(records, stream.push(text.slice(pos, pos + CH)))) over = true;
      pos += CH;
      prog(records.length, Math.min(99, Math.round(pos / text.length * 100)));
      if (over) { cb({ records: records, delim: delim, enc: "utf-8", over: over }); return; }
      setTimeout(step, 0);
    })();
  }

  function parseFile(file, wantEnc, wantDelim, cb, prog, err) {
    var stream = null, decoder = null, enc = "utf-8", delim = ",", records = [], over = false;
    var pos = 0, CH = 1048576, first = true, fr;
    try { fr = new FileReader(); } catch (e) { err(); return; }
    fr.onerror = function () { err(); };
    fr.onload = function () {
      if (state.cancelParse) return;
      var u8 = new Uint8Array(fr.result);
      if (!decoder) { var d = makeDecoder(u8, wantEnc); decoder = d.dec; enc = d.enc; }
      var more = pos + CH < file.size;
      var textChunk = decoder.decode(u8, { stream: more });
      if (first) {
        delim = (wantDelim && wantDelim !== "auto") ? (wantDelim === "tab" ? "\t" : wantDelim) : pgDetectDelim(textChunk);
        stream = pgCsvStream(delim); first = false;
      }
      if (collectRows(records, stream.push(textChunk))) over = true;
      pos += CH;
      prog(records.length, Math.min(99, Math.round(pos / file.size * 100)));
      if (over || pos >= file.size) { if (stream && collectRows(records, stream.end())) over = true; cb({ records: records, delim: delim, enc: enc, over: over }); return; }
      step();
    };
    function step() {
      if (state.cancelParse) return;
      try { fr.readAsArrayBuffer(file.slice(pos, Math.min(pos + CH, file.size))); }
      catch (e) { err(); }
    }
    step();
  }

  /* ---------- 파싱 완료 → 매핑 UI ---------- */

  function onParsed(res) {
    state.parsing = false;
    clearTimeout(state.pgTimer);
    $("pg-progress").hidden = true;
    state.parsed = res;
    state.truncated = !!res.over;
    if (!res.records.length) { setSrcNote("tool.err.norows", true); return; }
    var cols = 0, i;
    for (i = 0; i < res.records.length; i++) if (res.records[i].f.length > cols) cols = res.records[i].f.length;
    state.parsed.cols = cols;
    // 헤더 추정: 첫 행에 숫자 셀이 2개 미만이면 헤더로 본다
    var firstRow = res.records[0].f, numeric = 0;
    for (i = 0; i < firstRow.length; i++) if (!isNaN(pgNum(firstRow[i]))) numeric++;
    state.hasHeader = numeric < 2;
    $("pg-header").checked = state.hasHeader;
    var enc = res.enc || "utf-8";
    $("pg-enc").value = state.src.kind === "text" ? "utf-8" : enc;
    $("pg-encwarn").hidden = !(state.src.kind === "file" && enc === "euc-kr");
    state.map = pgAutoMap(headerNames());
    applySavedMap();
    var extra = "";
    if (state.truncated) extra = "  " + t("tool.truncated", { max: fmtN(MAX_ROWS) });
    setSrcNote("tool.loaded", false, {}); // placeholder, replaced below
    var n = $("pg-srcnote");
    n.removeAttribute("data-i18n");
    n.className = "pg-note";
    n.textContent = t("tool.loaded", { rows: fmtN(res.records.length), cols: fmtN(cols) }) + extra;
    buildSetup();
    $("pg-setup").hidden = false;
    $("pg-result").hidden = true;
  }

  function headerNames() {
    var p = state.parsed, out = [], i;
    if (!p) return out;
    var h = (state.hasHeader && p.records.length) ? p.records[0].f : null;
    for (i = 0; i < p.cols; i++) {
      var name = h && h[i] != null && String(h[i]).trim() !== "" ? String(h[i]).trim() : null;
      out.push(name || t("tool.col", { n: i + 1 }));
    }
    return out;
  }

  function applySavedMap() {
    var saved = loadPref("mapNames", null);
    if (!saved || !state.hasHeader) return;
    var heads = headerNames(), byName = {}, i, k;
    for (i = 0; i < heads.length; i++) byName["#" + pgNormHead(heads[i])] = i;
    for (k in state.map) {
      if (!state.map.hasOwnProperty(k) || saved[k] == null) continue;
      if (saved[k] === "") { state.map[k] = -1; continue; }
      var idx = byName["#" + pgNormHead(saved[k])];
      if (idx != null) state.map[k] = idx;
    }
  }
  function saveMapNames() {
    if (!state.hasHeader) return;
    var heads = headerNames(), out = {}, k;
    for (k in state.map) if (state.map.hasOwnProperty(k)) out[k] = state.map[k] >= 0 ? heads[state.map[k]] : "";
    savePref("mapNames", out);
  }

  function buildSetup() {
    var heads = headerNames(), grid = $("pg-mapgrid"), i, fi;
    grid.textContent = "";
    for (fi = 0; fi < FIELDS.length; fi++) {
      var field = FIELDS[fi];
      var wrap = el("div", "pg-mapcell");
      var lab = el("label", null, t("tool.f." + field));
      lab.setAttribute("for", "pg-map-" + field);
      var sel = el("select");
      sel.id = "pg-map-" + field;
      var optNone = el("option", null, t("tool.f.none"));
      optNone.value = "-1";
      sel.appendChild(optNone);
      for (i = 0; i < heads.length; i++) {
        var opt = el("option", null, heads[i]);
        opt.value = String(i);
        sel.appendChild(opt);
      }
      sel.value = String(state.map[field]);
      sel.setAttribute("data-field", field);
      sel.addEventListener("change", function () {
        state.map[this.getAttribute("data-field")] = parseInt(this.value, 10);
        saveMapNames();
      });
      wrap.appendChild(lab);
      wrap.appendChild(sel);
      grid.appendChild(wrap);
    }
    renderPreview();
  }

  function renderPreview() {
    var p = state.parsed, table = $("pg-preview");
    table.textContent = "";
    if (!p) return;
    var heads = headerNames(), start = state.hasHeader ? 1 : 0, shown = 0, i, j;
    var thead = el("thead"), htr = el("tr");
    for (j = 0; j < p.cols; j++) htr.appendChild(el("th", null, heads[j]));
    thead.appendChild(htr); table.appendChild(thead);
    var tbody = el("tbody");
    for (i = start; i < p.records.length && shown < 5; i++, shown++) {
      var tr = el("tr"), f = p.records[i].f;
      for (j = 0; j < p.cols; j++) tr.appendChild(el("td", null, f[j] != null ? String(f[j]) : ""));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }

  /* ---------- 계산 ---------- */

  function calculate() {
    if (!state.parsed || !state.parsed.records.length) { showTopError("tool.err.empty"); return; }
    if (state.map.gender < 0) { showTopError("tool.err.gender"); return; }
    if (state.map.hourly < 0 && !(state.map.base >= 0 && state.map.hours >= 0)) { showTopError("tool.err.hourly"); return; }
    var skip = state.hasHeader ? 1 : 0;
    var ext = pgExtract(state.parsed.records, skip, state.map);
    if (ext.pop.length === 0) { renderResult(pgStats(ext, state.country)); return; }   // 전부 별도분류/제외여도 사유는 보여준다
    if (ext.pop.length > WORKER_ROWS && canWorker()) runWorkerStats(ext);
    else renderResult(pgStats(ext, state.country));
  }

  function showTopError(key) {
    var r = $("pg-result");
    r.hidden = false;
    r.textContent = "";
    r.appendChild(el("p", "pg-err", t(key)));
    r.scrollIntoView({ block: "nearest" });
  }

  function canWorker() {
    return typeof Worker === "function" && typeof Blob === "function" && typeof URL !== "undefined" && !!URL.createObjectURL;
  }
  function statsWorkerSource() {
    return [
      "var EU_TRIGGER=" + EU_TRIGGER + ";",
      pgMean.toString(), pgMedian.toString(), pgQuartiles.toString(),
      pgStats.toString(), pgStatsWorker.toString(), "pgStatsWorker(self);"
    ].join("\n");
  }
  function runWorkerStats(ext) {
    state.computing = true;
    $("pg-pfill").style.width = "0%";
    $("pg-ptext").textContent = t("tool.computing");
    $("pg-progress").hidden = false;
    var url, w;
    try {
      url = URL.createObjectURL(new Blob([statsWorkerSource()], { type: "text/javascript" }));
      w = new Worker(url);
    } catch (e) { finishCompute(url, w); renderResult(pgStats(ext, state.country)); return; }
    state.worker = w;
    var timer = setTimeout(function () {   // 1.5초 안에 응답 없으면 메인으로 폴백
      if (state.computing) { try { w.terminate(); } catch (e2) {} finishCompute(url, w); renderResult(pgStats(ext, state.country)); }
    }, 1500 + Math.min(4000, ext.pop.length / 50));
    w.onmessage = function (e) {
      var m = e.data || {};
      if (m.type === "progress") { $("pg-pfill").style.width = m.pct + "%"; return; }
      if (m.type === "result") { clearTimeout(timer); finishCompute(url, w); renderResult(m.stats); }
    };
    w.onerror = function () { clearTimeout(timer); try { w.terminate(); } catch (e3) {} finishCompute(url, w); renderResult(pgStats(ext, state.country)); };
    w.postMessage({ cmd: "stats", ext: ext, country: state.country });
  }
  function finishCompute(url, w) {
    state.computing = false; state.worker = null;
    $("pg-progress").hidden = true;
    if (url) { try { URL.revokeObjectURL(url); } catch (e) {} }
  }

  /* ---------- 결과 렌더 ---------- */

  function gapText(o) {
    if (!o || !o.ok) return null;
    var v = o.value, mag = Math.abs(v);
    if (mag < 0.05) return { text: fmtNum(0, 1) + "%", favour: t("tool.favours.none"), v: 0 };
    return { text: fmtNum(mag, 1) + "%", favour: v > 0 ? t("tool.favours.men") : t("tool.favours.women"), v: v };
  }
  function naText(o) {
    var r = o ? o.reason : "onesided";
    return t("tool.na." + r);
  }

  function metricBlock(labelKey, o, mv, wv, unitMoney) {
    var box = el("div", "pg-metric");
    box.appendChild(el("div", "pg-mlabel", t(labelKey)));
    var g = gapText(o);
    if (g) {
      var big = el("div", "pg-big");
      big.appendChild(el("span", null, g.text));
      if (g.v !== 0) big.appendChild(el("span", "pg-favour", " " + g.favour));
      box.appendChild(big);
      if (unitMoney && o.m != null) box.appendChild(el("div", "pg-sub",
        t("tool.men") + " " + fmtNum(o.m, 2) + " · " + t("tool.women") + " " + fmtNum(o.f, 2)));
    } else {
      box.appendChild(el("div", "pg-na", naText(o)));
    }
    return box;
  }

  function renderResult(st) {
    state.lastStats = st;
    var r = $("pg-result");
    r.hidden = false;
    r.textContent = "";

    // 상단 요약
    var sum = el("div", "pg-summary");
    sum.appendChild(el("strong", null, fmtN(st.binaryN)));
    sum.appendChild(document.createTextNode(" " + t("tool.summary.binary")));
    var subline = el("div", "pg-sub", t("tool.sub.split", { men: fmtN(st.maleN), women: fmtN(st.femaleN) }));
    r.appendChild(sum);
    r.appendChild(subline);

    if (st.separateN > 0) r.appendChild(el("p", "pg-note pg-flag", t("tool.sep.note", { m: fmtN(st.separateN) })));
    if (st.binaryN > 0 && st.binaryN < UK_THRESHOLD) r.appendChild(el("p", "pg-note pg-warn", t("tool.small", { n: fmtN(UK_THRESHOLD) })));
    if (st.bonusBad > 0) r.appendChild(el("p", "pg-note", t("tool.bonusbad", { n: fmtN(st.bonusBad) })));

    if (st.binaryN === 0) {
      r.appendChild(el("p", "pg-err", t("tool.err.nogenders")));
      appendExclusions(r, st);
      return;
    }

    // 국가 배지
    var badgeKey = st.country === "EU" ? "tool.eu.badge" : (st.country === "KR" ? "tool.kr.badge" : "tool.uk.badge");
    r.appendChild(el("div", "pg-badge", t(badgeKey)));

    // 지표 섹션
    var head = st.country === "KR" ? "tool.h.kr" : (st.country === "EU" ? "tool.h.eu" : "tool.h.uk");
    r.appendChild(el("h3", "pg-h", t(head)));
    var grid = el("div", "pg-grid");
    grid.appendChild(metricBlock("tool.m.meanhourly", st.meanHourly, st.meanHM, st.meanHF, true));
    grid.appendChild(metricBlock("tool.m.medianhourly", st.medianHourly, st.medHM, st.medHF, true));
    if (st.country !== "KR") {
      grid.appendChild(metricBlock("tool.m.meanbonus", st.meanBonus, st.meanBM, st.meanBF, true));
      grid.appendChild(metricBlock("tool.m.medianbonus", st.medianBonus, st.medBM, st.medBF, true));
      var bp = el("div", "pg-metric");
      bp.appendChild(el("div", "pg-mlabel", t("tool.m.bonusprop")));
      if (!st.hasBonus) bp.appendChild(el("div", "pg-na", t("tool.na.nobonus")));
      else {
        bp.appendChild(el("div", "pg-big2", t("tool.men") + " " + fmtPct(st.propM) + " · " + t("tool.women") + " " + fmtPct(st.propF)));
      }
      grid.appendChild(bp);
    } else {
      var comp = el("div", "pg-metric");
      comp.appendChild(el("div", "pg-mlabel", t("tool.m.compose")));
      comp.appendChild(el("div", "pg-big2", t("tool.men") + " " + fmtN(st.maleN) + " (" + fmtPct(st.maleN / st.binaryN * 100) + ") · " +
        t("tool.women") + " " + fmtN(st.femaleN) + " (" + fmtPct(st.femaleN / st.binaryN * 100) + ")"));
      grid.appendChild(comp);
    }
    r.appendChild(grid);

    // 사분위
    r.appendChild(el("h3", "pg-h", t("tool.h.quart")));
    var legend = el("div", "pg-legend");
    var l1 = el("span", "pg-lg"); l1.appendChild(el("i", "pg-sw pg-sw-m")); l1.appendChild(document.createTextNode(t("tool.men")));
    var l2 = el("span", "pg-lg"); l2.appendChild(el("i", "pg-sw pg-sw-w")); l2.appendChild(document.createTextNode(t("tool.women")));
    legend.appendChild(l1); legend.appendChild(l2);
    r.appendChild(legend);
    var cv = el("canvas", "pg-canvas");
    cv.id = "pg-chart";
    r.appendChild(cv);
    drawQuartiles(cv, st);
    if (st.straddle > 0) r.appendChild(el("p", "pg-note", t("tool.straddle", { n: fmtN(st.straddle) })));

    // EU 범주표
    if (st.country === "EU") {
      r.appendChild(el("h3", "pg-h", t("tool.h.cat")));
      if (!st.hasGrade) r.appendChild(el("p", "pg-note", t("tool.cat.none")));
      else appendCategoryTable(r, st);
    }

    appendExclusions(r, st);

    // 내보내기
    var actions = el("div", "pg-actions");
    var dl = el("button", "btn"); dl.type = "button"; dl.textContent = t("tool.export.csv");
    dl.addEventListener("click", function () { downloadCsv(st); });
    var cp = el("button", "pg-mini"); cp.type = "button"; cp.textContent = t("tool.export.copy");
    cp.addEventListener("click", function () { copyTsv(st, cp); });
    actions.appendChild(dl); actions.appendChild(cp);
    r.appendChild(actions);
    r.appendChild(el("p", "pg-note", t("tool.export.note")));
  }

  function appendCategoryTable(r, st) {
    var wrap = el("div", "pg-tablewrap"), table = el("table", "pg-cat");
    var thead = el("thead"), htr = el("tr");
    htr.appendChild(el("th", null, t("tool.cat.header")));
    htr.appendChild(el("th", "num", t("tool.cat.n")));
    htr.appendChild(el("th", "num", t("tool.cat.gap")));
    thead.appendChild(htr); table.appendChild(thead);
    var tbody = el("tbody"), i;
    for (i = 0; i < st.categories.length; i++) {
      var c = st.categories[i], tr = el("tr");
      tr.appendChild(el("td", null, c.name));
      tr.appendChild(el("td", "num", fmtN(c.n)));
      var td = el("td", "num");
      if (!c.comparable || c.gap == null) td.appendChild(el("span", "pg-dim", t("tool.cat.incomparable")));
      else {
        var g = gapText({ ok: true, value: c.gap });
        td.appendChild(document.createTextNode(g.text + (g.v !== 0 ? " " + g.favour : "")));
        if (c.flag) { var b = el("span", "pg-flagbadge", "!"); td.appendChild(document.createTextNode(" ")); td.appendChild(b); }
      }
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    r.appendChild(wrap);
    var flagged = false;
    for (i = 0; i < st.categories.length; i++) if (st.categories[i].flag) flagged = true;
    if (flagged) r.appendChild(el("p", "pg-note pg-flag", t("tool.cat.flag", { pct: EU_TRIGGER })));
  }

  function appendExclusions(r, st) {
    if (st.excludedCount <= 0) return;
    var d = el("details", "pg-excl");
    var sm = el("summary", null, t("tool.excluded", { n: fmtN(st.excludedCount) }));
    d.appendChild(sm);
    var reasons = { nonum: t("tool.reason.nonum"), neg: t("tool.reason.neg"),
                    nohours: t("tool.reason.nohours"), nopay: t("tool.reason.nopay") };
    var wrap = el("div", "pg-tablewrap"), table = el("table"), tbody = el("tbody"), i;
    for (i = 0; i < st.excluded.length; i++) {
      var ex = st.excluded[i], tr = el("tr");
      tr.appendChild(el("td", null, t("tool.row", { n: fmtN(ex.n) })));
      tr.appendChild(el("td", null, reasons[ex.reason] || ex.reason));
      tr.appendChild(el("td", "pg-dim", ex.val || ""));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody); wrap.appendChild(table); d.appendChild(wrap);
    if (st.excludedCount > st.excluded.length) d.appendChild(el("p", "pg-note", t("tool.excluded.more", { n: fmtN(st.excludedCount - st.excluded.length) })));
    r.appendChild(d);
  }

  function cssVar(name, fallback) {
    try { var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; }
    catch (e) { return fallback; }
  }

  function drawQuartiles(cv, st) {
    var dpr = window.devicePixelRatio || 1;
    var cssW = cv.clientWidth || 640, rowH = 46, padL = 92, padR = 12, top = 8;
    var cssH = top * 2 + rowH * 4;
    cv.style.height = cssH + "px";
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
    var ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    var menCol = cssVar("--accent", "#5b21b6");
    var womenCol = "#a78bfa";
    var ink = cssVar("--ink", "#1f2937");
    var barW = cssW - padL - padR;
    var labels = [t("tool.q.lower"), t("tool.q.lowermid"), t("tool.q.uppermid"), t("tool.q.upper")];
    ctx.font = "600 12px " + (cssVar("--font", "sans-serif"));
    ctx.textBaseline = "middle";
    for (var i = 0; i < 4; i++) {
      var q = st.quartiles[i], tot = q.total || 1;
      var y = top + rowH * i + 6, h = rowH - 18;
      var mFrac = q.male / tot, wFrac = q.female / tot;
      ctx.fillStyle = ink;
      ctx.textAlign = "left";
      ctx.fillText(labels[i], 0, y + h / 2 - 2);
      var mw = Math.round(barW * mFrac);
      ctx.fillStyle = menCol;
      ctx.fillRect(padL, y, mw, h);
      ctx.fillStyle = womenCol;
      ctx.fillRect(padL + mw, y, barW - mw, h);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "left";
      if (mFrac > 0.12) ctx.fillText(Math.round(mFrac * 100) + "%", padL + 6, y + h / 2);
      if (wFrac > 0.12) { ctx.textAlign = "right"; ctx.fillText(Math.round(wFrac * 100) + "%", padL + barW - 6, y + h / 2); }
    }
  }

  /* ---------- 내보내기 ---------- */

  function downloadCsv(st) {
    var csv = pgExportCsv(st);
    var name = SLUG + "-" + new Date().toISOString().slice(0, 10) + ".csv";
    try {
      var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });   // UTF-8 BOM — 엑셀 호환
      var url = URL.createObjectURL(blob);
      var a = el("a"); a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) { /* 다운로드 불가 환경 — 조용히 실패하지 않도록 복사로 안내 */ }
  }

  function copyTsv(st, btn) {
    var csv = pgExportCsv(st).split("\r\n");
    var tsv = [];
    for (var i = 0; i < csv.length; i++) {
      // CSV 한 줄을 TSV 로 — 간단 파서(따옴표 처리)
      var cells = [], cur = "", inq = false, line = csv[i];
      for (var j = 0; j < line.length; j++) {
        var ch = line.charAt(j);
        if (inq) { if (ch === '"') { if (line.charAt(j + 1) === '"') { cur += '"'; j++; } else inq = false; } else cur += ch; }
        else if (ch === '"') inq = true;
        else if (ch === ",") { cells.push(cur); cur = ""; }
        else cur += ch;
      }
      cells.push(cur);
      tsv.push(cells.join("\t"));
    }
    var text = tsv.join("\n");
    function ok() { var old = btn.textContent; btn.textContent = t("tool.copied"); setTimeout(function () { btn.textContent = old; }, 1400); }
    function legacy() {
      try {
        var ta = el("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        var done = document.execCommand("copy"); document.body.removeChild(ta);
        if (done) ok();
      } catch (e) { /* noop */ }
    }
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, legacy); else legacy(); }
    catch (e) { legacy(); }
  }

  /* ---------- 이벤트 배선 ---------- */

  function initCountry() {
    var saved = loadPref("country", null);
    var lang = uiLang();
    var guess = saved || (lang === "ko" ? "KR" : (lang === "de" || lang === "fr" || lang === "es" || lang === "pt" ? "EU" : "UK"));
    if (guess !== "UK" && guess !== "EU" && guess !== "KR") guess = "UK";
    state.country = guess;
    $("pg-country").value = guess;
  }

  function bind() {
    var drop = $("pg-drop"), fileInput = $("pg-file");
    $("pg-paste").addEventListener("input", function () { useText(this.value, ""); });
    $("pg-pick").addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function () { if (this.files && this.files[0]) useFile(this.files[0]); this.value = ""; });
    $("pg-sample").addEventListener("click", function () { $("pg-paste").value = SAMPLE; useText(SAMPLE, "sample"); });
    $("pg-clear").addEventListener("click", function () { $("pg-paste").value = ""; useText("", ""); setSrcNote("tool.empty", false); });
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); if (ev === "dragleave" && drop.contains(e.relatedTarget)) return; drop.classList.remove("is-over"); });
    });
    drop.addEventListener("drop", function (e) {
      var dt = e.dataTransfer; if (dt && dt.files && dt.files[0]) useFile(dt.files[0]);
    });
    $("pg-enc").addEventListener("change", function () { if (state.src) startParse(); });
    $("pg-delim").addEventListener("change", function () { if (state.src) startParse(); });
    $("pg-cancel").addEventListener("click", function () {
      state.cancelParse = true; state.parsing = false;
      if (state.worker) { try { state.worker.terminate(); } catch (e) {} }
      state.computing = false;
      clearTimeout(state.pgTimer);
      $("pg-progress").hidden = true;
      setSrcNote("tool.cancelled", true);
    });
    $("pg-header").addEventListener("change", function () {
      state.hasHeader = this.checked;
      state.map = pgAutoMap(headerNames());
      applySavedMap();
      buildSetup();
    });
    $("pg-country").addEventListener("change", function () {
      state.country = this.value; savePref("country", this.value);
      if (state.lastStats) { state.lastStats.country = this.value; calculate(); }
    });
    $("pg-calc").addEventListener("click", calculate);
    document.addEventListener("i18n:change", function () {
      // 언어 전환 시 소스 노트·결과 재렌더(동적 문구 갱신)
      if (!state.parsed && !state.src) setSrcNote("tool.empty", false);
      if (state.lastStats && !$("pg-result").hidden) renderResult(state.lastStats);
      if (state.parsed && !$("pg-setup").hidden) buildSetup();
    });
  }

  function boot() {
    if (!$("pg-country")) return;   // TOOL 마크업이 없으면 초기화하지 않음
    initCountry();
    bind();
    setSrcNote("tool.empty", false);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  // TOOLJS:END
})();
