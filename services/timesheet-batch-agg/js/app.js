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
  // 근태(타각) CSV → 직원×주 근로/연장/야간/휴일 시간 집계 엔진.
  // 전 계산이 이 탭 안에서 끝난다(서버·외부 API 0, Network 요청 0).
  // 사번·근무시각은 보안팀 승인이 필요한 데이터라 "브라우저를 떠나지 않음"이 채택 조건이다.
  // 스코프: 시간을 '집계'만 한다. 위반 판정·통상시급은 자식 도구(overtime-limit-audit·ordinary-wage-batch)의 몫.
  var SLUG = (window.APP_CONFIG && window.APP_CONFIG.slug) || "timesheet-batch-agg";

  var DAY = 1440;            // 하루 분
  var NIGHT_START = 1320;    // 22:00
  var NIGHT_END = 1800;      // 익일 06:00 (= 1440 + 360)
  var MAX_SPAN = 960;        // 16h 합리성 상한 — 초과는 '비합리적 근로시간'으로 제외
  var WORKER_ROWS = 10000;   // 이 초과에서만 롤업을 Worker 로 이관(backlog bulk_strategy)
  var MAX_ROWS = 200000;     // 상한 — 초과분은 조용히 버리지 않고 truncated 로 알린다
  var MAX_EXCLUDED = 2000;   // 제외 리포트 상한
  var MAX_HOLIDAYS = 400;    // 휴일 목록 상한

  /* 국가별 가산 규칙 — 정적 상수 테이블(유지비를 규정 갱신에만 수렴).
     dailyOT: 일 초과 임계(분), dailyDouble: 일 더블타임 임계(분, 0=없음),
     weeklyOT: 주 초과 임계(분), weeklyOTMode: 주 기준 연장(true)/일 기준(false),
     otFactor/doubleFactor/nightFactor: 환산 가산계수, holiday*: 휴일 8h 이내/초과 가산,
     seventh: 7일 연속 근무 규칙(US-CA), euFlags: 준법 플래그(EU). */
  var COUNTRY = {
    "KR":      { weekStart: 1, dailyOT: 480, dailyDouble: 0,   weeklyOT: 2400, weeklyOTMode: false, otFactor: 0.5, doubleFactor: 1.0, nightFactor: 0.5, holidayLoFactor: 0.5, holidayHiFactor: 1.0, holidayThresh: 480, seventh: false, euFlags: false },
    "US-FLSA": { weekStart: 0, dailyOT: 0,   dailyDouble: 0,   weeklyOT: 2400, weeklyOTMode: true,  otFactor: 0.5, doubleFactor: 1.0, nightFactor: 0,   holidayLoFactor: 0,   holidayHiFactor: 0,   holidayThresh: 480, seventh: false, euFlags: false },
    "US-CA":   { weekStart: 0, dailyOT: 480, dailyDouble: 720, weeklyOT: 2400, weeklyOTMode: false, otFactor: 0.5, doubleFactor: 1.0, nightFactor: 0,   holidayLoFactor: 0,   holidayHiFactor: 0,   holidayThresh: 480, seventh: true,  euFlags: false },
    "EU":      { weekStart: 1, dailyOT: 0,   dailyDouble: 0,   weeklyOT: 0,    weeklyOTMode: false, otFactor: 0,   doubleFactor: 0,   nightFactor: 0,   holidayLoFactor: 0,   holidayHiFactor: 0,   holidayThresh: 480, seventh: false, euFlags: true }
  };

  /* ============================================================
     순수 커널 — node 로 단위검증하고, Worker 소스로도 그대로 직렬화한다.
     바깥 참조는 위 상수(DAY·NIGHT_*·MAX_*·COUNTRY)뿐 — Worker 소스에 함께 굽는다.
     ============================================================ */

  /* Howard Hinnant civil_from_days / days_from_civil (1970-01-01 = 0 = 목요일).
     Date 생성자를 쓰지 않는 이유: new Date("01/05/2026") 은 로케일마다 다른 날짜로
     조용히 읽힌다(stock-ledger-recon 과 동일한 못박기). */
  function tsDaysFromCivil(y, m, d) {
    y -= m <= 2 ? 1 : 0;
    var era = Math.floor(y / 400);
    var yoe = y - era * 400;
    var mp = (m + 9) % 12;
    var doy = Math.floor((153 * mp + 2) / 5) + d - 1;
    var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }
  function tsCivilFromDays(z) {
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
  function tsIsValidYmd(y, m, d) {
    if (!(y >= 1000 && y <= 9999) || m < 1 || m > 12 || d < 1) return false;
    var leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    var dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return d <= dim[m - 1];
  }
  function tsMkDate(y, m, d) {
    if (!tsIsValidYmd(y, m, d)) return null;
    return tsDaysFromCivil(y, m, d);
  }
  function tsPad2(n) { return (n < 10 ? "0" : "") + n; }
  function tsIsoFromDay(z) { var c = tsCivilFromDays(z); return c.y + "-" + tsPad2(c.m) + "-" + tsPad2(c.d); }
  function tsDow(day) { return (((day % 7) + 4) % 7 + 7) % 7; }   // 0=일 … 6=토

  /* 날짜 파서(stock-ledger 규칙 재사용). 개별 행이 스스로 형식을 증명하면(첫 필드 >12)
     컬럼 모드보다 그 증거를 우선한다. YYYY-M-D · YYYY.M.D · YYYYMMDD · D/M/Y · M/D/Y. */
  function tsParseDate(raw, mode) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return null;
    var m;
    m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s);
    if (m) return tsMkDate(+m[1], +m[2], +m[3]);
    m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    if (m) return tsMkDate(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(s);
    if (m) {
      var a = +m[1], b = +m[2], y = +m[3];
      if (a > 12 && b <= 12) return tsMkDate(y, b, a);
      if (b > 12 && a <= 12) return tsMkDate(y, a, b);
      return mode === "mdy" ? tsMkDate(y, a, b) : tsMkDate(y, b, a);
    }
    return null;
  }
  function tsScanDateFormat(values, localeOrder) {
    var iso = 0, compact = 0, slash = 0, nonEmpty = 0, dmy = 0, mdy = 0, i, s, m;
    for (i = 0; i < values.length; i++) {
      s = String(values[i] == null ? "" : values[i]).trim();
      if (!s) continue;
      nonEmpty++;
      if (/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.test(s)) { iso++; continue; }
      if (/^\d{8}$/.test(s)) { compact++; continue; }
      m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(s);
      if (m) { slash++; if (+m[1] > 12 && +m[2] <= 12) dmy++; else if (+m[2] > 12 && +m[1] <= 12) mdy++; }
    }
    if (!nonEmpty) return { mode: "iso", ambiguous: false, n: 0 };
    if (slash > iso && slash > compact) {
      if (dmy && !mdy) return { mode: "dmy", ambiguous: false, n: nonEmpty };
      if (mdy && !dmy) return { mode: "mdy", ambiguous: false, n: nonEmpty };
      if (dmy && mdy) return { mode: dmy >= mdy ? "dmy" : "mdy", ambiguous: true, n: nonEmpty };
      return { mode: localeOrder === "mdy" ? "mdy" : "dmy", ambiguous: true, n: nonEmpty };
    }
    return { mode: "iso", ambiguous: false, n: nonEmpty };
  }

  /* 시각 파서(자체) — "9:00","09:00","09:00:00","9:00 AM","0900"(HHMM),"24:00",bare "18".
     자정 이후의 분(0..1440) 반환, 실패는 null. 초는 분 단위로 반영. */
  function tsTime(raw) {
    var s = String(raw == null ? "" : raw).trim().toUpperCase();
    if (s === "") return null;
    var ap = null, mm = s.match(/\s*(AM|PM)$/);
    if (mm) { ap = mm[1]; s = s.slice(0, mm.index).trim(); }
    var h, mi, se = 0, c;
    if ((c = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/))) { h = +c[1]; mi = +c[2]; se = c[3] != null ? +c[3] : 0; }
    else if ((c = s.match(/^(\d{3,4})$/))) {
      var g = c[1];
      if (g.length === 3) { h = +g.slice(0, 1); mi = +g.slice(1); } else { h = +g.slice(0, 2); mi = +g.slice(2); }
    } else if ((c = s.match(/^(\d{1,2})$/))) { h = +c[1]; mi = 0; }
    else return null;
    if (isNaN(h) || isNaN(mi) || isNaN(se) || mi > 59 || se > 59) return null;
    if (ap) {
      if (h < 1 || h > 12) return null;
      if (ap === "AM") h = (h === 12) ? 0 : h; else h = (h === 12) ? 12 : h + 12;
    }
    if (h === 24) return (mi === 0 && se === 0) ? DAY : null;
    if (h > 24 || h < 0) return null;
    return h * 60 + mi + se / 60;
  }

  /* 휴게 파서 — 분 숫자 또는 H:MM 지속시간. 공란은 0, 그 외 실패는 NaN(제외 사유). */
  function tsBreakMin(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (s === "") return 0;
    var m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (m) return +m[1] * 60 + +m[2];
    var t = s.replace(/[\s'"]/g, "").replace(",", ".");
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return NaN;
    return parseFloat(t);
  }

  // 근로구간 [inMin, outMin) 과 야간창 [22:00, 익일06:00) 의 교집합 분.
  function tsNightOverlap(inMin, outMin) {
    var total = 0;
    for (var k = -1; k <= 1; k++) {
      var s = NIGHT_START + DAY * k, e = NIGHT_END + DAY * k;
      var lo = inMin > s ? inMin : s, hi = outMin < e ? outMin : e;
      if (hi > lo) total += hi - lo;
    }
    return total;
  }

  function tsTruthy(s) {
    var v = String(s == null ? "" : s).trim().toLowerCase();
    if (v === "") return false;
    return !(v === "0" || v === "false" || v === "no" || v === "n" || v === "f" || v === "아니오" || v === "x");
  }
  function tsCell(f, idx) { return idx >= 0 && f[idx] != null ? String(f[idx]).trim() : ""; }

  // 증분 RFC4180 토크나이저 — 따옴표 안 구분자·개행·이스케이프("")를 처리하고 청크 경계를 잇는다.
  function tsCsvStream(delim) {
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
  function tsDetectDelim(text) {
    var head = text.slice(0, 8192).split(/\r\n|\r|\n/);
    if (text.length > 8192 && head.length > 1) head.pop();
    var cand = [",", "\t", ";"], best = ",", bestScore = 0, i, c;
    for (c = 0; c < cand.length; c++) {
      var counts = [];
      for (i = 0; i < head.length && counts.length < 6; i++) { if (head[i] === "") continue; counts.push(head[i].split(cand[c]).length - 1); }
      if (!counts.length) continue;
      var min = counts[0], sum = 0;
      for (i = 0; i < counts.length; i++) { if (counts[i] < min) min = counts[i]; sum += counts[i]; }
      var score = min > 0 ? 1000 * min + sum : 0;
      if (score > bestScore) { bestScore = score; best = cand[c]; }
    }
    return best;
  }

  /* 헤더 자동추정 — ko/en 동의어. 가장 긴 동의어가 이긴다("clockout" 이 "out" 로 새지 않게). */
  var TS_SYN = {
    empid: ["employeeid", "employee", "empno", "empid", "staffid", "personid", "id", "사번", "사원번호", "직원번호", "사원", "직원", "이름", "성명"],
    date: ["workdate", "date", "day", "날짜", "일자", "근무일", "근무일자"],
    "in": ["clockin", "timein", "checkin", "starttime", "start", "in", "출근", "출근시각", "출근시간", "시업"],
    out: ["clockout", "timeout", "checkout", "endtime", "finish", "end", "out", "퇴근", "퇴근시각", "퇴근시간", "종업"],
    "break": ["breakmin", "breakminutes", "breaktime", "break", "unpaid", "rest", "휴게", "휴게시간", "휴게분", "휴식"],
    holiday: ["holidayflag", "holiday", "isholiday", "dayoff", "휴일", "공휴일", "휴일여부"]
  };
  function tsNormHead(s) { return String(s == null ? "" : s).toLowerCase().replace(/[\s ()[\]{}·,.\-_/\\:]/g, ""); }
  function tsAutoMap(headers) {
    var m = { empid: -1, date: -1, "in": -1, out: -1, "break": -1, holiday: -1 };
    var cands = [], i, k, j;
    for (i = 0; i < headers.length; i++) {
      var h = tsNormHead(headers[i]);
      if (!h) continue;
      for (k in TS_SYN) {
        if (!TS_SYN.hasOwnProperty(k)) continue;
        var best = 0;
        for (j = 0; j < TS_SYN[k].length; j++) if (h.indexOf(TS_SYN[k][j]) >= 0 && TS_SYN[k][j].length > best) best = TS_SYN[k][j].length;
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

  /* 행 → 타각. 더러운 행은 버리지 않고 excluded(사유별)로 되돌린다(철칙 5).
     자정 넘김은 익일 계산 + overnight 태그(제외 아님), span>16h 만 제외. */
  function tsExtract(records, skip, map, opts) {
    var rows = [], excluded = [], excludedCount = 0, read = 0, overnightCount = 0;
    var reasons = { noempid: 0, baddate: 0, badin: 0, badout: 0, badbreak: 0, nowork: 0, unreasonable: 0, dup: 0 };
    var seen = {};
    var holidaySet = opts.holidaySet || {}, weekendHoliday = !!opts.weekendHoliday, mode = opts.dateMode || "iso";
    function drop(n, reason, val) {
      reasons[reason]++; excludedCount++;
      if (excluded.length < MAX_EXCLUDED) excluded.push({ n: n, reason: reason, val: val || "" });
    }
    for (var r = skip; r < records.length; r++) {
      var f = records[r].f, n = records[r].n;
      read++;
      var emp = tsCell(f, map.empid);
      if (map.empid < 0 || emp === "") { drop(n, "noempid", ""); continue; }
      var dcell = tsCell(f, map.date), day = tsParseDate(dcell, mode);
      if (day == null) { drop(n, "baddate", dcell); continue; }
      var icell = tsCell(f, map["in"]), inMin = tsTime(icell);
      if (inMin == null) { drop(n, "badin", icell); continue; }
      var ocell = tsCell(f, map.out), outMin = tsTime(ocell);
      if (outMin == null) { drop(n, "badout", ocell); continue; }
      var bcell = map["break"] >= 0 ? tsCell(f, map["break"]) : "", brk = tsBreakMin(bcell);
      if (isNaN(brk) || brk < 0) { drop(n, "badbreak", bcell); continue; }
      var dupKey = emp + " " + day + " " + inMin + " " + outMin + " " + brk;
      if (seen[dupKey]) { drop(n, "dup", ""); continue; }
      seen[dupKey] = 1;
      var overnight = false;
      if (outMin <= inMin) { outMin += DAY; overnight = true; }
      var span = outMin - inMin;
      if (span > MAX_SPAN) { drop(n, "unreasonable", (Math.round(span / 6) / 10) + "h"); continue; }
      var workMin = span - brk;
      if (workMin <= 0) { drop(n, "nowork", icell + "-" + ocell + " / break " + bcell); continue; }
      if (overnight) overnightCount++;
      var dow = tsDow(day);
      var isHoliday = (weekendHoliday && (dow === 0 || dow === 6)) || !!holidaySet[day] ||
        (map.holiday >= 0 && tsTruthy(tsCell(f, map.holiday)));
      if (rows.length < MAX_ROWS) {
        rows.push({ emp: emp, day: day, dow: dow, inAbs: day * DAY + inMin, outAbs: day * DAY + outMin,
          work: workMin, night: tsNightOverlap(inMin, outMin), holiday: isHoliday, overnight: overnight });
      }
    }
    return { rows: rows, excluded: excluded, excludedCount: excludedCount, reasons: reasons, read: read, overnightCount: overnightCount };
  }

  // 한 (직원×주) 그룹 → 버킷. 국가 config 상수로 연장/더블/야간/휴일/환산을 분기.
  function tsComputeWeek(days, sortedDays, cfg, country) {
    var weeklyWork = 0, nightTotal = 0, holidayTotal = 0, i, d;
    for (i = 0; i < sortedDays.length; i++) {
      d = days[sortedDays[i]];
      weeklyWork += d.work; nightTotal += d.night; holidayTotal += d.holidayWork;
    }
    // 연속 근무일 위치(US-CA 7일 연속 규칙)
    var pos = {}, run = 0, prev = null, maxRun = 0;
    for (i = 0; i < sortedDays.length; i++) {
      var dn = sortedDays[i];
      run = (prev !== null && dn === prev + 1) ? run + 1 : 1;
      pos[dn] = run; if (run > maxRun) maxRun = run; prev = dn;
    }
    var otMin = 0, doubleMin = 0, flags = [], seventhHit = false;
    if (cfg.weeklyOTMode) {
      otMin = Math.max(0, weeklyWork - cfg.weeklyOT);
    } else if (cfg.dailyOT > 0) {
      for (i = 0; i < sortedDays.length; i++) {
        d = days[sortedDays[i]]; var w = d.work, otPart, dblPart;
        if (cfg.seventh && pos[sortedDays[i]] % 7 === 0) {
          seventhHit = true; otPart = Math.min(w, cfg.dailyOT); dblPart = Math.max(0, w - cfg.dailyOT);
        } else if (cfg.dailyDouble > 0) {
          dblPart = Math.max(0, w - cfg.dailyDouble); otPart = Math.max(0, Math.min(w, cfg.dailyDouble) - cfg.dailyOT);
        } else { otPart = Math.max(0, w - cfg.dailyOT); dblPart = 0; }
        otMin += otPart; doubleMin += dblPart;
      }
    }
    if (seventhHit) flags.push("seventh");
    if (country === "KR" && weeklyWork > cfg.weeklyOT) flags.push("wk40");
    // 휴일 가산(환산용): 8h 이내/초과 분리
    var holidayPremium = 0;
    for (i = 0; i < sortedDays.length; i++) {
      var hw = days[sortedDays[i]].holidayWork;
      if (hw <= 0) continue;
      var lo = Math.min(hw, cfg.holidayThresh), hi = Math.max(0, hw - cfg.holidayThresh);
      holidayPremium += lo * cfg.holidayLoFactor + hi * cfg.holidayHiFactor;
    }
    if (cfg.euFlags) {
      if (weeklyWork > 2880) flags.push("over48");
      if (maxRun >= 7) flags.push("norest");
      var shifts = [];
      for (i = 0; i < sortedDays.length; i++) { d = days[sortedDays[i]]; for (var s = 0; s < d.shifts.length; s++) shifts.push(d.shifts[s]); }
      shifts.sort(function (a, b) { return a.inAbs - b.inAbs; });
      for (i = 1; i < shifts.length; i++) { if (shifts[i].inAbs - shifts[i - 1].outAbs < 660) { flags.push("rest11"); break; } }
    }
    var regularMin = Math.max(0, weeklyWork - otMin - doubleMin);
    var convertedMin = weeklyWork + otMin * cfg.otFactor + doubleMin * cfg.doubleFactor + nightTotal * cfg.nightFactor + holidayPremium;
    var overnight = false;
    for (i = 0; i < sortedDays.length; i++) if (days[sortedDays[i]].overnight) { overnight = true; break; }
    if (overnight && flags.indexOf("overnight") < 0) flags.push("overnight");
    return { work: weeklyWork, regular: regularMin, ot: otMin, dbl: doubleMin, night: nightTotal,
      holiday: holidayTotal, converted: convertedMin, flags: flags };
  }

  // rows → 직원×주 롤업 + 직원 요약 + 총계. 자정 넘김 shift 는 '출근일'의 주에 귀속(고정).
  function tsRollup(rows, country, weekStart) {
    var cfg = COUNTRY[country] || COUNTRY.KR;
    if (weekStart == null) weekStart = cfg.weekStart;
    var groups = {}, order = [], i, row;
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      var wk = row.day - ((row.dow - weekStart + 7) % 7);
      var key = row.emp + " " + wk;
      var g = groups[key];
      if (!g) { g = groups[key] = { emp: row.emp, week: wk, days: {}, sorted: [] }; order.push(key); }
      var dd = g.days[row.day];
      if (!dd) { dd = g.days[row.day] = { work: 0, night: 0, holidayWork: 0, overnight: false, shifts: [] }; g.sorted.push(row.day); }
      dd.work += row.work; dd.night += row.night;
      if (row.holiday) dd.holidayWork += row.work;
      if (row.overnight) dd.overnight = true;
      dd.shifts.push({ inAbs: row.inAbs, outAbs: row.outAbs });
    }
    var weeks = [], empMap = {}, empOrder = [];
    var tot = { work: 0, ot: 0, dbl: 0, night: 0, holiday: 0, converted: 0, regular: 0 };
    for (i = 0; i < order.length; i++) {
      var grp = groups[order[i]];
      grp.sorted.sort(function (a, b) { return a - b; });
      var wkres = tsComputeWeek(grp.days, grp.sorted, cfg, country);
      weeks.push({ emp: grp.emp, week: grp.week, work: wkres.work, regular: wkres.regular, ot: wkres.ot,
        dbl: wkres.dbl, night: wkres.night, holiday: wkres.holiday, converted: wkres.converted, flags: wkres.flags });
      tot.work += wkres.work; tot.ot += wkres.ot; tot.dbl += wkres.dbl; tot.night += wkres.night;
      tot.holiday += wkres.holiday; tot.converted += wkres.converted; tot.regular += wkres.regular;
      var e = empMap[grp.emp];
      if (!e) { e = empMap[grp.emp] = { emp: grp.emp, weeks: 0, work: 0, regular: 0, ot: 0, dbl: 0, night: 0, holiday: 0, converted: 0 }; empOrder.push(grp.emp); }
      e.weeks++; e.work += wkres.work; e.regular += wkres.regular; e.ot += wkres.ot; e.dbl += wkres.dbl;
      e.night += wkres.night; e.holiday += wkres.holiday; e.converted += wkres.converted;
    }
    weeks.sort(function (a, b) { return a.emp < b.emp ? -1 : a.emp > b.emp ? 1 : a.week - b.week; });
    var employees = [];
    for (i = 0; i < empOrder.length; i++) employees.push(empMap[empOrder[i]]);
    employees.sort(function (a, b) { return a.emp < b.emp ? -1 : a.emp > b.emp ? 1 : 0; });
    return { weeks: weeks, employees: employees, totals: tot, country: country, weekStart: weekStart, hasDouble: cfg.dailyDouble > 0 || country === "US-CA" };
  }

  // 파싱된 records → 완결 결과(추출 + 롤업). 메인·Worker 동일 경로.
  function tsCompute(records, skip, map, opts, country, weekStart) {
    var ex = tsExtract(records, skip, map, opts);
    var roll = tsRollup(ex.rows, country, weekStart);
    return {
      weeks: roll.weeks, employees: roll.employees, totals: roll.totals, hasDouble: roll.hasDouble,
      country: country, weekStart: roll.weekStart,
      excluded: ex.excluded, excludedCount: ex.excludedCount, reasons: ex.reasons,
      read: ex.read, overnightCount: ex.overnightCount, validRows: ex.rows.length
    };
  }

  // Worker 본체 — 추출·롤업만 오프로드. 원본 셀은 반환하지 않고 집계·제외표본만 되돌린다.
  function tsWorker(scope) {
    scope.onmessage = function (e) {
      var m = e.data || {};
      if (m.cmd !== "compute") return;
      try {
        scope.postMessage({ type: "progress", pct: 20 });
        var res = tsCompute(m.records, m.skip, m.map, m.opts, m.country, m.weekStart);
        scope.postMessage({ type: "progress", pct: 100 });
        scope.postMessage({ type: "result", res: res });
      } catch (err) { scope.postMessage({ type: "error", message: String(err && err.message || err) }); }
    };
  }

  /* ---------- node 단위검증 훅 ---------- */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      tsTime: tsTime, tsBreakMin: tsBreakMin, tsParseDate: tsParseDate, tsScanDateFormat: tsScanDateFormat,
      tsNightOverlap: tsNightOverlap, tsDow: tsDow, tsIsoFromDay: tsIsoFromDay, tsMkDate: tsMkDate,
      tsCsvStream: tsCsvStream, tsDetectDelim: tsDetectDelim, tsAutoMap: tsAutoMap, tsNormHead: tsNormHead,
      tsExtract: tsExtract, tsRollup: tsRollup, tsComputeWeek: tsComputeWeek, tsCompute: tsCompute,
      COUNTRY: COUNTRY
    };
    return;
  }

  /* ============================================================
     UI
     ============================================================ */
  var $ = function (id) { return document.getElementById(id); };
  var FIELDS = ["empid", "date", "in", "out", "break", "holiday"];

  var state = {
    src: null, srcName: "", parsed: null, hasHeader: true, truncated: false,
    country: "KR", weekStart: 1, weekendHoliday: false, holidayText: "", dateScan: null,
    map: { empid: -1, date: -1, "in": -1, out: -1, "break": -1, holiday: -1 },
    parsing: false, cancelParse: false, computing: false, worker: null, last: null, pgTimer: null
  };

  function t(key, vars) {
    var s = window.I18N ? window.I18N.t(key) : null;
    if (s == null) s = key;
    if (vars) for (var k in vars) if (vars.hasOwnProperty(k)) s = s.split("{" + k + "}").join(String(vars[k]));
    return s;
  }
  function uiLang() { return (window.I18N && window.I18N.lang()) || "en"; }
  function fmtN(v) { try { return new Intl.NumberFormat(uiLang()).format(v); } catch (e) { return String(v); } }
  function h2(min) {
    var v = Math.round(min / 60 * 100) / 100;
    try { return new Intl.NumberFormat(uiLang(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v); }
    catch (e) { return v.toFixed(2); }
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function localeOrder() { var l = uiLang(); return (l === "en" || l === "ja") ? "mdy" : "dmy"; }

  function loadPref(key, fb) { try { var v = localStorage.getItem(SLUG + ":" + key); return v == null ? fb : JSON.parse(v); } catch (e) { return fb; } }
  function savePref(key, val) { try { localStorage.setItem(SLUG + ":" + key, JSON.stringify(val)); } catch (e) { /* private mode */ } }

  var SAMPLE = [
    "Employee,Date,Clock in,Clock out,Break (min)",
    "E001,2024-01-01,09:00,18:00,60",
    "E001,2024-01-02,09:00,20:30,60",
    "E001,2024-01-03,0900,1800,60",
    "E001,2024-01-04,22:00,06:00,30",
    "E001,2024-01-06,10:00,15:00,0",
    "E002,2024-01-01,08:30,17:30,60",
    "E002,2024-01-02,09:00,,45",
    "E002,2024-01-02,09:00,19:00,45",
    "E002,2024-01-02,09:00,19:00,45",
    "E002,2024-01-03,14:00,23:30,30"
  ].join("\n");

  /* ---------- 입력 소스 ---------- */
  function setSrcNote(key, isWarn, vars) {
    var n = $("ts-srcnote");
    n.className = "ts-note" + (isWarn ? " ts-warn" : "");
    if (vars || isWarn) { n.removeAttribute("data-i18n"); n.textContent = t(key, vars); }
    else { n.setAttribute("data-i18n", key); n.textContent = t(key); }
  }
  function resetOutputs() {
    $("ts-setup").hidden = true; $("ts-result").hidden = true; $("ts-opts").hidden = true;
    $("ts-encwarn").hidden = true; $("ts-progress").hidden = true;
  }
  function useText(text, name) {
    if (!text || !text.trim()) { state.src = null; state.parsed = null; resetOutputs(); setSrcNote("tool.empty", false); return; }
    state.src = { kind: "text", text: text }; state.srcName = name || "";
    $("ts-opts").hidden = false; $("ts-enc").disabled = true; $("ts-encwarn").hidden = true;
    startParse();
  }
  function useFile(file) {
    if (!file) return;
    state.src = { kind: "file", file: file }; state.srcName = file.name || "";
    $("ts-paste").value = ""; $("ts-opts").hidden = false; $("ts-enc").disabled = false;
    startParse();
  }
  function makeDecoder(u8, want) {
    function sniff(u) {
      if (u.length >= 3 && u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF) return "utf-8";
      try { new TextDecoder("utf-8", { fatal: true }).decode(u.subarray(0, Math.min(u.length, 262144)), { stream: true }); return "utf-8"; }
      catch (e) { return "euc-kr"; }
    }
    var enc = want && want !== "auto" ? want : sniff(u8);
    try { return { enc: enc, dec: new TextDecoder(enc) }; } catch (e) { return { enc: "utf-8", dec: new TextDecoder("utf-8") }; }
  }
  function startParse() {
    if (!state.src) return;
    state.parsing = true; state.cancelParse = false; state.truncated = false; state.last = null;
    resetOutputs();
    $("ts-pfill").style.width = "0%"; $("ts-ptext").textContent = t("tool.progress", { rows: 0 });
    var pg = $("ts-progress"); pg.hidden = true;
    clearTimeout(state.pgTimer);
    state.pgTimer = setTimeout(function () { if (state.parsing) pg.hidden = false; }, 250);
    var wantDelim = $("ts-delim").value, wantEnc = $("ts-enc").value;
    if (state.src.kind === "text") parseText(state.src.text, wantDelim, onParsed, onProgress);
    else parseFile(state.src.file, wantEnc, wantDelim, onParsed, onProgress, onReadError);
  }
  function onProgress(rows, pct) {
    $("ts-pfill").style.width = pct + "%"; $("ts-ptext").textContent = t("tool.progress", { rows: fmtN(rows) });
    if (rows > 3000 && state.parsing) $("ts-progress").hidden = false;
  }
  function onReadError() { state.parsing = false; clearTimeout(state.pgTimer); $("ts-progress").hidden = true; setSrcNote("tool.err.read", true); }
  function collectRows(records, rows) {
    for (var i = 0; i < rows.length; i++) {
      var f = rows[i], blank = true;
      for (var j = 0; j < f.length; j++) if (String(f[j]).trim() !== "") { blank = false; break; }
      if (blank) continue;
      if (records.length >= MAX_ROWS) return true;
      records.push({ n: records.length + 1, f: f });
    }
    return false;
  }
  function parseText(text, wantDelim, cb, prog) {
    var delim = (wantDelim && wantDelim !== "auto") ? (wantDelim === "tab" ? "\t" : wantDelim) : tsDetectDelim(text);
    var stream = tsCsvStream(delim), records = [], over = false, pos = 0, CH = 262144;
    (function step() {
      if (state.cancelParse) return;
      if (pos >= text.length) { over = collectRows(records, stream.end()) || over; cb({ records: records, delim: delim, enc: "utf-8", over: over }); return; }
      if (collectRows(records, stream.push(text.slice(pos, pos + CH)))) over = true;
      pos += CH; prog(records.length, Math.min(99, Math.round(pos / text.length * 100)));
      if (over) { cb({ records: records, delim: delim, enc: "utf-8", over: over }); return; }
      setTimeout(step, 0);
    })();
  }
  function parseFile(file, wantEnc, wantDelim, cb, prog, err) {
    var stream = null, decoder = null, enc = "utf-8", delim = ",", records = [], over = false, pos = 0, CH = 1048576, first = true, fr;
    try { fr = new FileReader(); } catch (e) { err(); return; }
    fr.onerror = function () { err(); };
    fr.onload = function () {
      if (state.cancelParse) return;
      var u8 = new Uint8Array(fr.result);
      if (!decoder) { var d = makeDecoder(u8, wantEnc); decoder = d.dec; enc = d.enc; }
      var more = pos + CH < file.size, textChunk = decoder.decode(u8, { stream: more });
      if (first) { delim = (wantDelim && wantDelim !== "auto") ? (wantDelim === "tab" ? "\t" : wantDelim) : tsDetectDelim(textChunk); stream = tsCsvStream(delim); first = false; }
      if (collectRows(records, stream.push(textChunk))) over = true;
      pos += CH; prog(records.length, Math.min(99, Math.round(pos / file.size * 100)));
      if (over || pos >= file.size) { if (stream && collectRows(records, stream.end())) over = true; cb({ records: records, delim: delim, enc: enc, over: over }); return; }
      step();
    };
    function step() { if (state.cancelParse) return; try { fr.readAsArrayBuffer(file.slice(pos, Math.min(pos + CH, file.size))); } catch (e) { err(); } }
    step();
  }

  /* ---------- 파싱 완료 → 매핑 UI ---------- */
  function onParsed(res) {
    state.parsing = false; clearTimeout(state.pgTimer); $("ts-progress").hidden = true;
    state.parsed = res; state.truncated = !!res.over;
    if (!res.records.length) { setSrcNote("tool.err.norows", true); return; }
    var cols = 0, i;
    for (i = 0; i < res.records.length; i++) if (res.records[i].f.length > cols) cols = res.records[i].f.length;
    state.parsed.cols = cols;
    var firstRow = res.records[0].f, textish = 0;
    for (i = 0; i < firstRow.length; i++) { var c = String(firstRow[i]).trim(); if (c !== "" && tsTime(c) == null && tsParseDate(c, "iso") == null && isNaN(Number(c))) textish++; }
    state.hasHeader = textish >= 1;
    $("ts-header").checked = state.hasHeader;
    var enc = res.enc || "utf-8";
    $("ts-enc").value = state.src.kind === "text" ? "utf-8" : enc;
    $("ts-encwarn").hidden = !(state.src.kind === "file" && enc === "euc-kr");
    state.map = tsAutoMap(headerNames());
    applySavedMap();
    rescanDate();
    var n = $("ts-srcnote"); n.removeAttribute("data-i18n"); n.className = "ts-note";
    var extra = state.truncated ? "  " + t("tool.truncated", { max: fmtN(MAX_ROWS) }) : "";
    n.textContent = t("tool.loaded", { rows: fmtN(res.records.length), cols: fmtN(cols), enc: enc.toUpperCase() }) + extra;
    buildSetup(); $("ts-setup").hidden = false; $("ts-result").hidden = true;
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
  function rescanDate() {
    var p = state.parsed;
    if (!p || state.map.date < 0) { state.dateScan = null; return; }
    var vals = [], start = state.hasHeader ? 1 : 0;
    for (var i = start; i < p.records.length && vals.length < 200; i++) vals.push(tsCell(p.records[i].f, state.map.date));
    state.dateScan = tsScanDateFormat(vals, localeOrder());
  }
  function dateMode() {
    var sel = $("ts-datefmt") ? $("ts-datefmt").value : "auto";
    if (sel && sel !== "auto") return sel;
    return (state.dateScan && state.dateScan.mode) || "iso";
  }
  function applySavedMap() {
    var saved = loadPref("mapNames", null);
    if (!saved || !state.hasHeader) return;
    var heads = headerNames(), byName = {}, i, k;
    for (i = 0; i < heads.length; i++) byName["#" + tsNormHead(heads[i])] = i;
    for (k in state.map) {
      if (!state.map.hasOwnProperty(k) || saved[k] == null) continue;
      if (saved[k] === "") { state.map[k] = -1; continue; }
      var idx = byName["#" + tsNormHead(saved[k])];
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
    var heads = headerNames(), grid = $("ts-mapgrid"), i, fi;
    grid.textContent = "";
    for (fi = 0; fi < FIELDS.length; fi++) {
      var field = FIELDS[fi], wrap = el("div", "ts-mapcell");
      var lab = el("label", null, t("tool.f." + field)); lab.setAttribute("for", "ts-map-" + field);
      var sel = el("select"); sel.id = "ts-map-" + field;
      var optNone = el("option", null, t("tool.f.none")); optNone.value = "-1"; sel.appendChild(optNone);
      for (i = 0; i < heads.length; i++) { var opt = el("option", null, heads[i]); opt.value = String(i); sel.appendChild(opt); }
      sel.value = String(state.map[field]); sel.setAttribute("data-field", field);
      sel.addEventListener("change", function () {
        state.map[this.getAttribute("data-field")] = parseInt(this.value, 10);
        saveMapNames(); if (this.getAttribute("data-field") === "date") rescanDate(); updateDateBanner();
      });
      wrap.appendChild(lab); wrap.appendChild(sel); grid.appendChild(wrap);
    }
    renderPreview(); updateDateBanner();
  }
  function updateDateBanner() {
    var b = $("ts-datebanner");
    var ds = state.dateScan, sel = $("ts-datefmt") ? $("ts-datefmt").value : "auto";
    if (state.map.date < 0) { b.hidden = true; return; }
    var mode = dateMode();
    var label = mode === "mdy" ? "MM/DD/YYYY" : mode === "dmy" ? "DD/MM/YYYY" : "YYYY-MM-DD";
    b.hidden = false;
    b.className = "ts-banner" + (ds && ds.ambiguous && sel === "auto" ? " ts-warn" : "");
    b.textContent = t(ds && ds.ambiguous && sel === "auto" ? "tool.date.ambig" : "tool.date.fmt", { fmt: label });
  }
  function renderPreview() {
    var p = state.parsed, table = $("ts-preview"); table.textContent = "";
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

  /* ---------- 휴일 목록 파싱 ---------- */
  function holidaySet() {
    var set = {}, txt = state.holidayText || "", mode = dateMode();
    var parts = txt.split(/[\n,;]+/), i, count = 0;
    for (i = 0; i < parts.length && count < MAX_HOLIDAYS; i++) {
      var s = parts[i].trim(); if (!s) continue;
      var day = tsParseDate(s, mode); if (day != null) { set[day] = 1; count++; }
    }
    return set;
  }

  /* ---------- 계산 ---------- */
  function calculate() {
    if (!state.parsed || !state.parsed.records.length) { showTopError("tool.err.empty"); return; }
    var m = state.map;
    if (m.empid < 0 || m.date < 0 || m["in"] < 0 || m.out < 0) { showTopError("tool.err.needcols"); return; }
    var skip = state.hasHeader ? 1 : 0;
    var opts = { dateMode: dateMode(), weekendHoliday: state.weekendHoliday, holidaySet: holidaySet() };
    var approx = state.parsed.records.length - skip;
    if (approx > WORKER_ROWS && canWorker()) runWorker(skip, m, opts);
    else { try { renderResult(tsCompute(state.parsed.records, skip, m, opts, state.country, state.weekStart)); } catch (e) { showTopError("tool.err.compute"); } }
  }
  function showTopError(key) {
    var r = $("ts-result"); r.hidden = false; r.textContent = "";
    r.appendChild(el("p", "ts-err", t(key))); r.scrollIntoView({ block: "nearest" });
  }
  function canWorker() { return typeof Worker === "function" && typeof Blob === "function" && typeof URL !== "undefined" && !!URL.createObjectURL; }
  function workerSource() {
    return [
      "var DAY=" + DAY + ",NIGHT_START=" + NIGHT_START + ",NIGHT_END=" + NIGHT_END + ",MAX_SPAN=" + MAX_SPAN + ",MAX_ROWS=" + MAX_ROWS + ",MAX_EXCLUDED=" + MAX_EXCLUDED + ";",
      "var COUNTRY=" + JSON.stringify(COUNTRY) + ";",
      tsDaysFromCivil.toString(), tsCivilFromDays.toString(), tsIsValidYmd.toString(), tsMkDate.toString(),
      tsDow.toString(), tsParseDate.toString(), tsTime.toString(), tsBreakMin.toString(), tsNightOverlap.toString(),
      tsTruthy.toString(), tsCell.toString(), tsExtract.toString(), tsComputeWeek.toString(), tsRollup.toString(),
      tsCompute.toString(), tsWorker.toString(), "tsWorker(self);"
    ].join("\n");
  }
  function runWorker(skip, map, opts) {
    state.computing = true;
    $("ts-pfill").style.width = "0%"; $("ts-ptext").textContent = t("tool.computing"); $("ts-progress").hidden = false;
    var url, w, records = state.parsed.records;
    function fallback() { try { renderResult(tsCompute(records, skip, map, opts, state.country, state.weekStart)); } catch (e) { showTopError("tool.err.compute"); } }
    try { url = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" })); w = new Worker(url); }
    catch (e) { finishCompute(url, w); fallback(); return; }
    state.worker = w;
    var timer = setTimeout(function () { if (state.computing) { try { w.terminate(); } catch (e2) {} finishCompute(url, w); fallback(); } }, 2000 + Math.min(6000, records.length / 40));
    w.onmessage = function (e) {
      var msg = e.data || {};
      if (msg.type === "progress") { $("ts-pfill").style.width = msg.pct + "%"; return; }
      if (msg.type === "error") { clearTimeout(timer); finishCompute(url, w); fallback(); return; }
      if (msg.type === "result") { clearTimeout(timer); finishCompute(url, w); renderResult(msg.res); }
    };
    w.onerror = function () { clearTimeout(timer); try { w.terminate(); } catch (e3) {} finishCompute(url, w); fallback(); };
    w.postMessage({ cmd: "compute", records: records, skip: skip, map: map, opts: opts, country: state.country, weekStart: state.weekStart });
  }
  function finishCompute(url, w) { state.computing = false; state.worker = null; $("ts-progress").hidden = true; if (url) { try { URL.revokeObjectURL(url); } catch (e) {} } }

  /* ---------- 결과 렌더 ---------- */
  var FLAG_TITLE = { overnight: "tool.flag.overnight", wk40: "tool.flag.wk40", seventh: "tool.flag.seventh", over48: "tool.flag.over48", norest: "tool.flag.norest", rest11: "tool.flag.rest11" };
  var FLAG_SHORT = { overnight: "tool.flags.overnight", wk40: "tool.flags.wk40", seventh: "tool.flags.seventh", over48: "tool.flags.over48", norest: "tool.flags.norest", rest11: "tool.flags.rest11" };
  var MAX_TABLE = 100;  // 미리보기 상세 테이블 상위 렌더 행 수 (spec: 상위 100행)

  function renderResult(res) {
    state.last = res;
    var r = $("ts-result"); r.hidden = false; r.textContent = "";
    var ctyKey = { "KR": "tool.country.kr", "US-FLSA": "tool.country.flsa", "US-CA": "tool.country.ca", "EU": "tool.country.eu" }[res.country];
    r.appendChild(el("div", "ts-badge", t("tool.res.badge", { country: t(ctyKey) })));

    if (res.weeks.length === 0) {
      r.appendChild(el("p", "ts-err", t("tool.err.novalid")));
      appendExclusions(r, res);
      return;
    }

    // 요약 지표
    var grid = el("div", "ts-grid");
    grid.appendChild(metric("tool.res.emp", fmtN(res.employees.length)));
    grid.appendChild(metric("tool.res.weeks", fmtN(res.weeks.length)));
    grid.appendChild(metric("tool.res.work", h2(res.totals.work)));
    grid.appendChild(metric("tool.res.ot", h2(res.totals.ot + res.totals.dbl)));
    grid.appendChild(metric("tool.res.night", h2(res.totals.night)));
    grid.appendChild(metric("tool.res.holiday", h2(res.totals.holiday)));
    r.appendChild(grid);

    var notes = [];
    if (res.overnightCount > 0) notes.push(t("tool.res.overnight", { n: fmtN(res.overnightCount) }));
    if (res.excludedCount > 0) notes.push(t("tool.res.excnote", { n: fmtN(res.excludedCount) }));
    if (notes.length) r.appendChild(el("p", "ts-sub", notes.join("  ·  ")));

    // 직원×주 상세 테이블 (상위 100행)
    r.appendChild(el("h3", "ts-h", t("tool.res.detail")));
    var wrap = el("div", "ts-tablewrap"), table = el("table"), thead = el("thead"), htr = el("tr");
    var cols = ["tool.th.emp", "tool.th.week", "tool.th.work", "tool.th.regular", "tool.th.ot"];
    if (res.hasDouble) cols.push("tool.th.double");
    cols = cols.concat(["tool.th.night", "tool.th.holiday", "tool.th.converted", "tool.th.flags"]);
    for (var ci = 0; ci < cols.length; ci++) htr.appendChild(el("th", ci >= 2 && ci < cols.length - 1 ? "num" : null, t(cols[ci])));
    thead.appendChild(htr); table.appendChild(thead);
    var tbody = el("tbody"), i, shown = Math.min(res.weeks.length, MAX_TABLE);
    for (i = 0; i < shown; i++) {
      var wk = res.weeks[i], tr = el("tr");
      tr.appendChild(el("td", null, wk.emp));
      tr.appendChild(el("td", null, tsIsoFromDay(wk.week)));
      tr.appendChild(el("td", "num", h2(wk.work)));
      tr.appendChild(el("td", "num", h2(wk.regular)));
      tr.appendChild(el("td", "num", h2(wk.ot)));
      if (res.hasDouble) tr.appendChild(el("td", "num", h2(wk.dbl)));
      tr.appendChild(el("td", "num", h2(wk.night)));
      tr.appendChild(el("td", "num", h2(wk.holiday)));
      tr.appendChild(el("td", "num", h2(wk.converted)));
      var ftd = el("td", null);
      for (var fi = 0; fi < wk.flags.length; fi++) {
        var badge = el("span", "ts-flag", t(FLAG_SHORT[wk.flags[fi]] || wk.flags[fi]));
        badge.title = t(FLAG_TITLE[wk.flags[fi]] || wk.flags[fi]);
        ftd.appendChild(badge); ftd.appendChild(document.createTextNode(" "));
      }
      tr.appendChild(ftd); tbody.appendChild(tr);
    }
    table.appendChild(tbody); wrap.appendChild(table); r.appendChild(wrap);
    if (res.weeks.length > shown) r.appendChild(el("p", "ts-sub", t("tool.res.more", { n: fmtN(res.weeks.length - shown) })));

    // 환산시간·야간 정의 안내
    r.appendChild(el("p", "ts-na", t("tool.res.convnote")));
    r.appendChild(el("p", "ts-na", t("tool.res.nightnote")));

    appendExclusions(r, res);

    // 내보내기
    var actions = el("div", "ts-actions");
    var dlW = el("button", "btn"); dlW.type = "button"; dlW.textContent = t("tool.export.week");
    dlW.addEventListener("click", function () { downloadCsv(weekCsv(res), "week"); });
    var dlE = el("button", "ts-mini"); dlE.type = "button"; dlE.textContent = t("tool.export.emp");
    dlE.addEventListener("click", function () { downloadCsv(empCsv(res), "employee"); });
    var cp = el("button", "ts-mini"); cp.type = "button"; cp.textContent = t("tool.export.copy");
    cp.addEventListener("click", function () { copyTsv(weekCsv(res), cp); });
    actions.appendChild(dlW); actions.appendChild(dlE); actions.appendChild(cp);
    r.appendChild(actions);
    r.appendChild(el("p", "ts-na", t("tool.export.note")));
  }
  function metric(labelKey, value) {
    var box = el("div", "ts-metric");
    box.appendChild(el("div", "ts-mlabel", t(labelKey)));
    box.appendChild(el("div", "ts-big", value));
    return box;
  }
  function appendExclusions(r, res) {
    if (res.excludedCount <= 0) return;
    var d = el("details", "ts-excl");
    d.appendChild(el("summary", null, t("tool.excluded", { n: fmtN(res.excludedCount) })));
    // 사유별 카운트
    var rc = res.reasons, order = ["noempid", "baddate", "badin", "badout", "badbreak", "nowork", "unreasonable", "dup"];
    var chips = el("div", "ts-chips"), k;
    for (k = 0; k < order.length; k++) { if (rc[order[k]] > 0) chips.appendChild(el("span", "ts-chip", t("tool.ex." + order[k]) + ": " + fmtN(rc[order[k]]))); }
    d.appendChild(chips);
    var wrap = el("div", "ts-tablewrap"), table = el("table"), tbody = el("tbody"), i;
    for (i = 0; i < res.excluded.length; i++) {
      var ex = res.excluded[i], tr = el("tr");
      tr.appendChild(el("td", null, t("tool.row", { n: fmtN(ex.n) })));
      tr.appendChild(el("td", null, t("tool.ex." + ex.reason)));
      tr.appendChild(el("td", "ts-dim", ex.val || ""));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody); wrap.appendChild(table); d.appendChild(wrap);
    if (res.excludedCount > res.excluded.length) d.appendChild(el("p", "ts-sub", t("tool.excluded.more", { n: fmtN(res.excludedCount - res.excluded.length) })));
    r.appendChild(d);
  }

  /* ---------- 내보내기 (열 이름은 자식 도구 호환을 위해 영어 고정) ---------- */
  function csvCell(s) { var v = s == null ? "" : String(s); return /["\r\n,]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function hh(min) { return (Math.round(min / 60 * 100) / 100).toFixed(2); }
  function weekCsv(res) {
    var head = ["Employee", "Week start", "Work hours", "Regular hours", "Overtime hours"];
    if (res.hasDouble) head.push("Double-time hours");
    head = head.concat(["Night hours", "Holiday hours", "Converted hours", "Country", "Flags"]);
    var rows = [head], i;
    for (i = 0; i < res.weeks.length; i++) {
      var w = res.weeks[i], row = [w.emp, tsIsoFromDay(w.week), hh(w.work), hh(w.regular), hh(w.ot)];
      if (res.hasDouble) row.push(hh(w.dbl));
      row = row.concat([hh(w.night), hh(w.holiday), hh(w.converted), res.country, w.flags.join(";")]);
      rows.push(row);
    }
    return toCsv(rows);
  }
  function empCsv(res) {
    var head = ["Employee", "Weeks", "Work hours", "Regular hours", "Overtime hours"];
    if (res.hasDouble) head.push("Double-time hours");
    head = head.concat(["Night hours", "Holiday hours", "Converted hours", "Country"]);
    var rows = [head], i;
    for (i = 0; i < res.employees.length; i++) {
      var e = res.employees[i], row = [e.emp, String(e.weeks), hh(e.work), hh(e.regular), hh(e.ot)];
      if (res.hasDouble) row.push(hh(e.dbl));
      row = row.concat([hh(e.night), hh(e.holiday), hh(e.converted), res.country]);
      rows.push(row);
    }
    return toCsv(rows);
  }
  function toCsv(rows) {
    var out = [], i, j;
    for (i = 0; i < rows.length; i++) { var line = []; for (j = 0; j < rows[i].length; j++) line.push(csvCell(rows[i][j])); out.push(line.join(",")); }
    return out.join("\r\n");
  }
  function downloadCsv(csv, kind) {
    var name = SLUG + "-" + kind + "-" + new Date().toISOString().slice(0, 10) + ".csv";
    try {
      var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });   // UTF-8 BOM — 엑셀 한글 호환
      var url = URL.createObjectURL(blob), a = el("a"); a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) { /* 다운로드 불가 환경 */ }
  }
  function copyTsv(csv, btn) {
    var lines = csv.split("\r\n"), tsv = [];
    for (var i = 0; i < lines.length; i++) {
      var cells = [], cur = "", inq = false, line = lines[i];
      for (var j = 0; j < line.length; j++) {
        var ch = line.charAt(j);
        if (inq) { if (ch === '"') { if (line.charAt(j + 1) === '"') { cur += '"'; j++; } else inq = false; } else cur += ch; }
        else if (ch === '"') inq = true;
        else if (ch === ",") { cells.push(cur); cur = ""; }
        else cur += ch;
      }
      cells.push(cur); tsv.push(cells.join("\t"));
    }
    var text = tsv.join("\n");
    function ok() { var old = btn.textContent; btn.textContent = t("tool.copied"); setTimeout(function () { btn.textContent = old; }, 1400); }
    function legacy() {
      try {
        var ta = el("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        if (document.execCommand("copy")) ok(); document.body.removeChild(ta);
      } catch (e) { /* noop */ }
    }
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, legacy); else legacy(); } catch (e) { legacy(); }
  }

  /* ---------- 이벤트 배선 ---------- */
  function initPrefs() {
    var lang = uiLang();
    var savedC = loadPref("country", null);
    var guess = savedC || (lang === "ko" ? "KR" : (lang === "en" ? "US-FLSA" : (lang === "de" || lang === "fr" || lang === "es" || lang === "pt" || lang === "id" ? "EU" : "KR")));
    if (!COUNTRY[guess]) guess = "KR";
    state.country = guess; $("ts-country").value = guess;
    var savedW = loadPref("weekStart", null);
    state.weekStart = savedW == null ? COUNTRY[guess].weekStart : savedW;
    $("ts-weekstart").value = String(state.weekStart);
    state.weekendHoliday = !!loadPref("weekendHoliday", false);
    $("ts-weekend").checked = state.weekendHoliday;
    state.holidayText = loadPref("holidays", "") || "";
    $("ts-holidays").value = state.holidayText;
  }
  function recompute() { if (state.last && !$("ts-result").hidden) calculate(); }
  function bind() {
    var drop = $("ts-drop"), fileInput = $("ts-file");
    $("ts-paste").addEventListener("input", function () { useText(this.value, ""); });
    $("ts-pick").addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function () { if (this.files && this.files[0]) useFile(this.files[0]); this.value = ""; });
    $("ts-sample").addEventListener("click", function () { $("ts-paste").value = SAMPLE; useText(SAMPLE, "sample"); });
    $("ts-clear").addEventListener("click", function () { $("ts-paste").value = ""; useText("", ""); setSrcNote("tool.empty", false); });
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); if (ev === "dragleave" && drop.contains(e.relatedTarget)) return; drop.classList.remove("is-over"); }); });
    drop.addEventListener("drop", function (e) { var dt = e.dataTransfer; if (dt && dt.files && dt.files[0]) useFile(dt.files[0]); });
    $("ts-enc").addEventListener("change", function () { if (state.src) startParse(); });
    $("ts-delim").addEventListener("change", function () { if (state.src) startParse(); });
    $("ts-datefmt").addEventListener("change", function () { updateDateBanner(); recompute(); });
    $("ts-cancel").addEventListener("click", function () {
      state.cancelParse = true; state.parsing = false;
      if (state.worker) { try { state.worker.terminate(); } catch (e) {} }
      state.computing = false; clearTimeout(state.pgTimer); $("ts-progress").hidden = true; setSrcNote("tool.cancelled", true);
    });
    $("ts-header").addEventListener("change", function () { state.hasHeader = this.checked; state.map = tsAutoMap(headerNames()); applySavedMap(); rescanDate(); buildSetup(); });
    $("ts-country").addEventListener("change", function () {
      state.country = this.value; savePref("country", this.value);
      state.weekStart = COUNTRY[this.value].weekStart; $("ts-weekstart").value = String(state.weekStart); savePref("weekStart", state.weekStart);
      recompute();
    });
    $("ts-weekstart").addEventListener("change", function () { state.weekStart = parseInt(this.value, 10); savePref("weekStart", state.weekStart); recompute(); });
    $("ts-weekend").addEventListener("change", function () { state.weekendHoliday = this.checked; savePref("weekendHoliday", this.checked); recompute(); });
    $("ts-holidays").addEventListener("input", function () { state.holidayText = this.value; savePref("holidays", this.value); });
    $("ts-holidays").addEventListener("change", function () { recompute(); });
    $("ts-calc").addEventListener("click", calculate);
    document.addEventListener("i18n:change", function () {
      if (!state.parsed && !state.src) setSrcNote("tool.empty", false);
      if (state.parsed && !$("ts-setup").hidden) buildSetup();
      if (state.last && !$("ts-result").hidden) renderResult(state.last);
    });
  }
  function boot() {
    if (!$("ts-country")) return;   // TOOL 마크업이 없으면 초기화하지 않음
    initPrefs(); bind(); setSrcNote("tool.empty", false);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  // TOOLJS:END
})();
