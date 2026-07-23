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
  var SLUG = cfg.slug || "manday-estimator";
  var STORE_KEY = SLUG + ":settings";

  /* =========================================================================
     CORE:START — 순수 계산부. DOM·window 를 만지지 않는다.
     node 단위 테스트가 이 구간만 잘라내 eval 한다 (WIKI §4 "검증" 참조).
     ========================================================================= */

  /* 환산 상수 — 유일한 진실의 원천(single source).
     KOSA 근무일수는 연 1회 움직인다(2022 20.8 · 2024 20.6 · 2026 20.5).
     20.5 같은 숫자를 코드 곳곳에 흩뿌리지 말고 이 표 한 곳만 고쳐 유지비를 수렴시킨다. */
  var CONV = {
    "kr-kosa": { hpd: 8, dpm: 20.5 },   // KOSA 2026 적용: 월평균 ÷ 20.5일, 일평균 ÷ 8h
    "kr-21":   { hpd: 8, dpm: 21 },     // 관행 (KOSA 산식 아님)
    "kr-22":   { hpd: 8, dpm: 22 },     // 관행 (평일 수 근사)
    "jp-160":  { hpd: 8, dpm: 20 },     // JP 표준 160h/월
    "custom":  { hpd: 8, dpm: 20.5 }
  };

  /* KOSA 공표 단가 — 검증된 값 1건(전 직무 평균 일평균임금)만 싣는다.
     직무별 17종 표는 팩토리에 검증 근거가 없어 싣지 않는다. 추측한 숫자에
     "KOSA 공표" 라벨을 붙이면 우리가 오정보의 출처가 된다(철칙 5). */
  var KOSA_RATE = { year: 2026, perDay: 414762, currency: "KRW" };

  var JP_DIVISORS = [140, 160, 180];   // JP 精算幅 민감도 표기용
  var EXTREME_MM = 10000;              // 단일 행 이 이상이면 '입력 확인' 경고
  var UNASSIGNED = "\u0000unassigned"; // 렌더 시점에 번역되는 센티넬
  var DETAIL_CAP = 200;                // 상세표는 앞 200행만 렌더(내보내기는 전량)

  /* ---------- CSV/TSV 파서 — RFC4180 자체 구현, 외부 라이브러리 0 ---------- */
  function parseDelimited(text, delim) {
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
      if (c === "\r") {
        if (text.charAt(i + 1) === "\n") i++;
        row.push(field); rows.push(row); row = []; field = ""; i++; continue;
      }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function rowIsEmpty(r) {
    for (var i = 0; i < r.length; i++) { if (String(r[i]).trim() !== "") return false; }
    return true;
  }

  /* 구분자 자동 추정 — 앞부분만 보고 열 수가 가장 일관된 후보를 고른다 */
  function sniffDelimiter(text) {
    var cands = ["\t", ",", ";"], head = text.slice(0, 65536);
    var best = null, bestScore = -1, i;
    for (i = 0; i < cands.length; i++) {
      var rows = parseDelimited(head, cands[i]).slice(0, 20), keep = [], j;
      for (j = 0; j < rows.length; j++) { if (!rowIsEmpty(rows[j])) keep.push(rows[j].length); }
      if (!keep.length) continue;
      var counts = {}, mode = 0, modeN = 0;
      for (j = 0; j < keep.length; j++) {
        counts[keep[j]] = (counts[keep[j]] || 0) + 1;
        if (counts[keep[j]] > modeN) { modeN = counts[keep[j]]; mode = keep[j]; }
      }
      if (mode < 2) continue;
      var score = mode * (modeN / keep.length);
      if (score > bestScore) { bestScore = score; best = cands[i]; }
    }
    return best || "\t";
  }

  /* ---------- 숫자 파싱 — 천단위 콤마·전각숫자는 수용, 나머지는 NaN ---------- */
  function parseNum(raw) {
    if (raw == null) return NaN;
    var s = String(raw).trim();
    if (!s) return NaN;
    s = s.replace(/[０-９]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    });
    s = s.replace(/．/g, ".").replace(/[\s 　]/g, "");
    if (!s) return NaN;
    if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
    if (!/^[-+]?(\d+(\.\d+)?|\.\d+)$/.test(s)) return NaN;
    var v = parseFloat(s);
    return isFinite(v) ? v : NaN;
  }

  /* ---------- 단위 토큰 → 'h' | 'd' | 'm' ---------- */
  var UNIT_TOKENS = {
    h: ["h", "hr", "hrs", "hour", "hours", "mh", "m/h", "manhour", "manhours", "man-hour",
        "시간", "시", "인시", "맨아워", "時間", "人時"],
    d: ["d", "day", "days", "md", "m/d", "manday", "mandays", "man-day",
        "일", "인일", "맨데이", "日", "人日"],
    m: ["m", "mo", "mon", "month", "months", "mm", "m/m", "manmonth", "manmonths", "man-month",
        "월", "개월", "인월", "맨먼스", "月", "人月", "ヶ月", "カ月", "か月"]
  };
  function normalizeUnit(raw) {
    if (raw == null) return null;
    var s = String(raw).trim().toLowerCase().replace(/[\s._()]/g, "");
    if (!s) return null;
    for (var k in UNIT_TOKENS) {
      if (!UNIT_TOKENS.hasOwnProperty(k)) continue;
      for (var i = 0; i < UNIT_TOKENS[k].length; i++) {
        if (s === UNIT_TOKENS[k][i]) return k;
      }
    }
    return null;
  }

  /* 공수 셀 — "16", "16h", "3.5인일", "1,200 시간" 을 값 + (있으면) 행 단위로 분리 */
  function parseEffortCell(raw) {
    var out = { value: NaN, unit: null };
    if (raw == null) return out;
    var s = String(raw).trim();
    if (!s) return out;
    var v = parseNum(s);
    if (!isNaN(v)) { out.value = v; return out; }
    var m = s.match(/^([-+]?[\d.,０-９\s 　]+)(.+)$/);
    if (m) {
      var n = parseNum(m[1]), u = normalizeUnit(m[2]);
      if (!isNaN(n) && u) { out.value = n; out.unit = u; }
    }
    return out;
  }

  /* ---------- 헤더 추정 + 컬럼 매핑 ---------- */
  var HEAD_HINTS = {
    effort: ["effort", "manhour", "man-hour", "manhours", "manday", "man-day", "manmonth",
             "man-month", "mh", "md", "mm", "hours", "hour", "days", "estimate", "workload",
             "공수", "인시", "인일", "인월", "맨먼스", "산정", "소요", "工数", "時間", "人日", "人月", "見積", "工数見積"],
    role: ["role", "resource", "assignee", "position", "grade", "job", "jobtitle", "skill",
           "직무", "역할", "등급", "담당", "담당자", "직급", "직책", "투입", "ロール", "役割", "担当", "担当者", "職種", "要員", "スキル"],
    phase: ["phase", "stage", "step", "milestone", "process", "sprint",
            "단계", "공정", "페이즈", "마일스톤", "工程", "フェーズ", "段階"],
    unit: ["unit", "uom", "단위", "単位"],
    task: ["task", "taskname", "activity", "work", "workitem", "item", "wbs", "deliverable", "subject",
           "작업", "작업명", "업무", "항목", "산출물", "タスク", "作業", "作業名", "項目", "成果物"]
  };
  function normHead(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[\s_\-\/().]/g, "");
  }
  function emptyMapping() { return { task: -1, role: -1, effort: -1, phase: -1, unit: -1 }; }

  function guessByHeader(head) {
    var m = emptyMapping(), used = {}, keys = ["effort", "role", "phase", "unit", "task"];
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k], hints = HEAD_HINTS[key], best = -1, bestLen = -1;
      for (var i = 0; i < head.length; i++) {
        if (used[i]) continue;
        var h = normHead(head[i]);
        if (!h) continue;
        for (var j = 0; j < hints.length; j++) {
          var hint = normHead(hints[j]);
          if ((h === hint || h.indexOf(hint) > -1) && hint.length > bestLen) {
            bestLen = hint.length; best = i;
          }
        }
      }
      if (best > -1) { m[key] = best; used[best] = 1; bestLen = -1; }
    }
    return m;
  }

  function headerHintScore(head) {
    var m = guessByHeader(head), n = 0;
    for (var k in m) { if (m.hasOwnProperty(k) && m[k] > -1) n++; }
    return n;
  }

  function looksLikeHeader(rows) {
    if (rows.length < 2) return false;
    var h = rows[0], i, anyNum = false;
    for (i = 0; i < h.length; i++) { if (!isNaN(parseEffortCell(h[i]).value)) { anyNum = true; break; } }
    if (anyNum) return false;
    var nextNum = false;
    for (i = 0; i < rows[1].length; i++) { if (!isNaN(parseEffortCell(rows[1][i]).value)) { nextNum = true; break; } }
    return nextNum || headerHintScore(h) >= 2;
  }

  function colCount(rows) {
    var n = 0;
    for (var i = 0; i < rows.length; i++) { if (rows[i].length > n) n = rows[i].length; }
    return n;
  }

  function numericRatio(rows, col) {
    var seen = 0, ok = 0;
    for (var i = 0; i < rows.length; i++) {
      var v = col < rows[i].length ? String(rows[i][col]).trim() : "";
      if (!v) continue;
      seen++;
      if (!isNaN(parseEffortCell(v).value)) ok++;
    }
    return seen ? ok / seen : 0;
  }
  function unitRatio(rows, col) {
    var seen = 0, ok = 0;
    for (var i = 0; i < rows.length; i++) {
      var v = col < rows[i].length ? String(rows[i][col]).trim() : "";
      if (!v) continue;
      seen++;
      if (normalizeUnit(v)) ok++;
    }
    return seen ? ok / seen : 0;
  }

  /* 헤더가 없으면 자리로 추정: 숫자 비율이 가장 높은 열 = 공수, 나머지 텍스트 열 = 작업/역할/단계 */
  function guessPositional(body) {
    var m = emptyMapping(), cols = colCount(body), i;
    var sample = body.slice(0, 50), bestCol = -1, bestRatio = 0;
    for (i = 0; i < cols; i++) {
      var r = numericRatio(sample, i);
      if (r > bestRatio) { bestRatio = r; bestCol = i; }
    }
    if (bestRatio >= 0.6) m.effort = bestCol;
    for (i = 0; i < cols; i++) {
      if (i === m.effort) continue;
      if (m.unit === -1 && unitRatio(sample, i) >= 0.6) { m.unit = i; continue; }
    }
    var text = [];
    for (i = 0; i < cols; i++) { if (i !== m.effort && i !== m.unit) text.push(i); }
    if (text.length > 0) m.task = text[0];
    if (text.length > 1) m.role = text[1];
    if (text.length > 2) m.phase = text[2];
    return m;
  }

  function guessMapping(rows, hasHeader) {
    if (!rows.length) return emptyMapping();
    if (hasHeader) {
      var m = guessByHeader(rows[0]), body = rows.slice(1), need = false, k;
      for (k in m) { if (m.hasOwnProperty(k) && m[k] > -1) need = true; }
      if (m.effort === -1 && body.length) {
        var p = guessPositional(body);
        if (p.effort > -1) m.effort = p.effort;
      }
      if (need) return m;
      return guessPositional(body);
    }
    return guessPositional(rows);
  }

  /* ---------- 표 → 레코드 ---------- */
  function buildRecords(rows, mapping, hasHeader) {
    var body = hasHeader ? rows.slice(1) : rows, out = [], i;
    for (i = 0; i < body.length; i++) {
      var r = body[i];
      if (rowIsEmpty(r)) continue;
      out.push({
        line: i + (hasHeader ? 2 : 1),
        task: mapping.task > -1 && mapping.task < r.length ? String(r[mapping.task]).trim() : "",
        role: mapping.role > -1 && mapping.role < r.length ? String(r[mapping.role]).trim() : "",
        phase: mapping.phase > -1 && mapping.phase < r.length ? String(r[mapping.phase]).trim() : "",
        unit: mapping.unit > -1 && mapping.unit < r.length ? String(r[mapping.unit]).trim() : "",
        effort: mapping.effort > -1 && mapping.effort < r.length ? String(r[mapping.effort]) : "",
        raw: r
      });
    }
    return out;
  }

  /* ---------- 롤업 — Map 단일 패스 O(n). 청크 처리를 위해 3단 분리 ---------- */
  function rollupCreate(opt) {
    var conv = opt.conv || CONV["kr-kosa"];
    return {
      opt: opt,
      hpd: conv.hpd,
      hpm: conv.hpd * conv.dpm,
      rates: opt.rates || {},
      rateUnit: opt.rateUnit || "m",
      gUnit: opt.unit || "h",
      role: {}, roleOrder: [],
      phase: {}, phaseOrder: [],
      pivot: {},
      ok: [],
      excluded: { nonNumeric: [], zeroNeg: [], empty: [] },
      totalHours: 0, totalCost: 0, costRows: 0,
      noRate: {}, extreme: []
    };
  }

  function rollupPush(a, rec) {
    var raw = rec.effort;
    if (raw == null || String(raw).trim() === "") { a.excluded.empty.push(rec.line); return; }
    var pc = parseEffortCell(raw);
    if (isNaN(pc.value)) { a.excluded.nonNumeric.push(rec.line); return; }
    if (pc.value <= 0) { a.excluded.zeroNeg.push(rec.line); return; }

    // 단위 우선순위: '단위' 열 > 셀 안의 접미사 > 전역 선택
    var unit = normalizeUnit(rec.unit) || pc.unit || a.gUnit;
    var hours = unit === "h" ? pc.value : unit === "d" ? pc.value * a.hpd : pc.value * a.hpm;

    var role = rec.role ? rec.role : UNASSIGNED;
    var phase = rec.phase ? rec.phase : UNASSIGNED;

    var rate = a.rates[role];
    var cost = null;
    if (rate != null && isFinite(rate) && rate >= 0) {
      cost = a.rateUnit === "h" ? hours * rate
           : a.rateUnit === "d" ? (hours / a.hpd) * rate
           : (hours / a.hpm) * rate;
      a.totalCost += cost;
      a.costRows++;
    } else {
      a.noRate[role] = 1;
    }

    if (!a.role[role]) { a.role[role] = { hours: 0, cost: 0, hasCost: false, n: 0 }; a.roleOrder.push(role); }
    var R = a.role[role];
    R.hours += hours; R.n++;
    if (cost != null) { R.cost += cost; R.hasCost = true; }

    if (!a.phase[phase]) { a.phase[phase] = { hours: 0, cost: 0, hasCost: false, n: 0 }; a.phaseOrder.push(phase); }
    var P = a.phase[phase];
    P.hours += hours; P.n++;
    if (cost != null) { P.cost += cost; P.hasCost = true; }

    var pk = role + "\u0001" + phase;
    a.pivot[pk] = (a.pivot[pk] || 0) + hours;

    a.totalHours += hours;
    var mm = hours / a.hpm;
    if (mm > EXTREME_MM) a.extreme.push(rec.line);

    a.ok.push({ line: rec.line, task: rec.task, role: role, phase: phase,
                hours: hours, unit: unit, value: pc.value, cost: cost, raw: rec.raw });
  }

  function rollupDone(a) {
    var roles = [], phases = [], k;
    for (k = 0; k < a.roleOrder.length; k++) {
      var rn = a.roleOrder[k], R = a.role[rn];
      roles.push({ key: rn, hours: R.hours, cost: R.hasCost ? R.cost : null, n: R.n,
                   share: a.totalHours > 0 ? R.hours / a.totalHours : 0 });
    }
    roles.sort(function (x, y) { return y.hours - x.hours; });
    for (k = 0; k < a.phaseOrder.length; k++) {
      var pn = a.phaseOrder[k], P = a.phase[pn];
      phases.push({ key: pn, hours: P.hours, cost: P.hasCost ? P.cost : null, n: P.n,
                    share: a.totalHours > 0 ? P.hours / a.totalHours : 0 });
    }
    var noRate = [];
    for (k in a.noRate) { if (a.noRate.hasOwnProperty(k)) noRate.push(k); }
    return {
      hpd: a.hpd, hpm: a.hpm,
      rows: a.ok,
      excluded: a.excluded,
      excludedCount: a.excluded.nonNumeric.length + a.excluded.zeroNeg.length + a.excluded.empty.length,
      totalHours: a.totalHours,
      totalDays: a.totalHours / a.hpd,
      totalMonths: a.totalHours / a.hpm,
      totalCost: a.costRows > 0 ? a.totalCost : null,
      costPartial: a.costRows > 0 && a.costRows < a.ok.length,
      roles: roles, phases: phases,
      pivot: a.pivot,
      noRateRoles: noRate,
      extreme: a.extreme
    };
  }

  function rollup(recs, opt) {
    var a = rollupCreate(opt);
    for (var i = 0; i < recs.length; i++) rollupPush(a, recs[i]);
    return rollupDone(a);
  }

  /* ---------- CSV 직렬화 ---------- */
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var line = [];
      for (var j = 0; j < rows[i].length; j++) line.push(csvCell(rows[i][j]));
      out.push(line.join(","));
    }
    return out.join("\r\n");
  }
  function toTsv(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var line = [];
      for (var j = 0; j < rows[i].length; j++) {
        line.push(String(rows[i][j] == null ? "" : rows[i][j]).replace(/[\t\r\n]/g, " "));
      }
      out.push(line.join("\t"));
    }
    return out.join("\r\n");
  }
  /* =========================================================================
     CORE:END
     ========================================================================= */

  /* ---------- DOM ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var elData = $("in-data"), elUnit = $("in-unit"), elConv = $("in-conv"), elHpd = $("in-hpd"),
      elDpm = $("in-dpm"), elCur = $("in-currency"), elRateUnit = $("in-rate-unit"),
      elHeader = $("in-header"), elMapBox = $("map-box"), elMapGrid = $("map-grid"),
      elPreview = $("preview-wrap"), elRateGrid = $("rate-grid"), elResult = $("result"),
      elDetail = $("detail-out"), elExports = $("exports"), elEnc = $("enc-banner"),
      elConvNote = $("conv-note"), elKosaBox = $("kosa-box"), elJpNote = $("jp-rate-note"),
      elProgWrap = $("progress-wrap"), elProgBar = $("progress-bar"), elProgTxt = $("progress-txt"),
      elFile = $("in-file");

  var parsed = null;      // { rows, delim, enc }
  var mapping = emptyMapping();
  var rates = {};         // 역할명 → 단가 (재사용 자산 — localStorage 저장 대상)
  var lastResult = null;  // 마지막 렌더용 (표시 전용, 복원용 아님)
  var lastBytes = null;   // 인코딩 재해석용 임시 버퍼 (저장 안 함)
  var busy = false;

  function t(key, fallback) {
    if (window.I18N) { var v = window.I18N.t(key); if (v != null) return v; }
    return fallback != null ? fallback : key;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function roleLabel(k) { return k === UNASSIGNED ? t("tool.unassigned", "Unassigned") : k; }
  function lang() { return (window.I18N && window.I18N.lang()) || "en"; }
  function fmtNum(v, dp) {
    if (v == null || !isFinite(v)) return "—";
    try {
      return new Intl.NumberFormat(lang(), {
        minimumFractionDigits: dp == null ? 0 : dp,
        maximumFractionDigits: dp == null ? 2 : dp
      }).format(v);
    } catch (e) { return String(Math.round(v * 100) / 100); }
  }
  function fmtCur(v) {
    if (v == null || !isFinite(v)) return "—";
    var cur = elCur.value;
    try {
      return new Intl.NumberFormat(lang(), {
        style: "currency", currency: cur,
        maximumFractionDigits: (cur === "KRW" || cur === "JPY") ? 0 : 2
      }).format(v);
    } catch (e) { return cur + " " + fmtNum(v, 0); }
  }

  /* ---------- 설정 저장: 재사용 자산만. 작업명·공수·원가는 절대 저장하지 않는다 ---------- */
  var storageOk = true;
  (function () {
    try { localStorage.setItem(SLUG + ":_t", "1"); localStorage.removeItem(SLUG + ":_t"); }
    catch (e) { storageOk = false; }
  })();
  function loadSettings() {
    if (!storageOk) return {};
    try { var r = localStorage.getItem(STORE_KEY); return r ? JSON.parse(r) : {}; }
    catch (e) { return {}; }
  }
  function saveSettings() {
    if (!storageOk) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        conv: elConv.value, hpd: elHpd.value, dpm: elDpm.value,
        currency: elCur.value, rateUnit: elRateUnit.value,
        unit: elUnit.value, rates: rates, mapping: mapping
      }));
    } catch (e) { /* quota — 설정 저장 실패는 계산을 막지 않는다 */ }
  }

  function activeConv() {
    if (elConv.value === "custom") {
      var h = parseNum(elHpd.value), d = parseNum(elDpm.value);
      return { hpd: isNaN(h) || h <= 0 ? 8 : h, dpm: isNaN(d) || d <= 0 ? 20.5 : d };
    }
    return CONV[elConv.value] || CONV["kr-kosa"];
  }

  function syncConvUi() {
    var c = activeConv(), custom = elConv.value === "custom";
    $("conv-custom").hidden = !custom;
    elConvNote.textContent = t("tool.conv.note", "1 M/M = {h} h")
      .replace("{h}", fmtNum(c.hpd * c.dpm, 2))
      .replace("{hpd}", fmtNum(c.hpd, 2))
      .replace("{dpm}", fmtNum(c.dpm, 2));
    elKosaBox.hidden = elCur.value !== "KRW";
    elJpNote.hidden = elConv.value !== "jp-160";
  }

  /* ---------- 인코딩: BOM → strict UTF-8 → EUC-KR 폴백 ---------- */
  function decodeBytes(buf, forceEnc) {
    var bytes = new Uint8Array(buf);
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), enc: "utf-8" };
    }
    if (forceEnc) {
      try { return { text: new TextDecoder(forceEnc).decode(bytes), enc: forceEnc }; }
      catch (e) { /* 라벨 미지원 → 아래 기본 경로 */ }
    }
    try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), enc: "utf-8" }; }
    catch (e) {
      try { return { text: new TextDecoder("euc-kr").decode(bytes), enc: "euc-kr" }; }
      catch (e2) { return { text: new TextDecoder("utf-8").decode(bytes), enc: "utf-8" }; }
    }
  }

  /* ---------- 입력 파싱 → 매핑 UI ---------- */
  function parseInput(text) {
    var delim = sniffDelimiter(text);
    var rows = parseDelimited(text, delim), keep = [];
    for (var i = 0; i < rows.length; i++) { if (!rowIsEmpty(rows[i])) keep.push(rows[i]); }
    parsed = { rows: keep, delim: delim };
    if (!keep.length) { elMapBox.hidden = true; return; }
    elHeader.checked = looksLikeHeader(keep);
    mapping = guessMapping(keep, elHeader.checked);
    elMapBox.hidden = false;
    renderMapping();
    renderRates();
  }

  function headerNames() {
    var names = [], n = colCount(parsed ? parsed.rows : []), i;
    for (i = 0; i < n; i++) {
      var label = "";
      if (elHeader.checked && parsed.rows.length && i < parsed.rows[0].length) {
        label = String(parsed.rows[0][i]).trim();
      }
      names.push(label || (t("tool.map.col", "Column {n}").replace("{n}", i + 1)));
    }
    return names;
  }

  function renderMapping() {
    if (!parsed || !parsed.rows.length) return;
    var names = headerNames(), fields = [
      ["task", "tool.col.task", "Task"], ["role", "tool.col.role", "Role"],
      ["effort", "tool.col.effort", "Effort"], ["phase", "tool.col.phase", "Phase"],
      ["unit", "tool.col.unit", "Unit"]
    ];
    var html = "";
    for (var f = 0; f < fields.length; f++) {
      var key = fields[f][0];
      html += '<div><label for="map-' + key + '">' + esc(t(fields[f][1], fields[f][2])) +
              (key === "task" || key === "role" || key === "effort" ? "" :
               ' <span style="font-weight:400;color:var(--muted);">(' + esc(t("tool.map.optional", "optional")) + ")</span>") +
              '</label><select id="map-' + key + '" data-field="' + key + '">';
      html += '<option value="-1">' + esc(t("tool.map.none", "— none —")) + "</option>";
      for (var i = 0; i < names.length; i++) {
        html += '<option value="' + i + '"' + (mapping[key] === i ? " selected" : "") + ">" +
                esc(names[i]) + "</option>";
      }
      html += "</select></div>";
    }
    elMapGrid.innerHTML = html;
    var sels = elMapGrid.querySelectorAll("select");
    for (var s = 0; s < sels.length; s++) {
      sels[s].addEventListener("change", function () {
        mapping[this.getAttribute("data-field")] = parseInt(this.value, 10);
        renderPreview(); renderRates(); saveSettings();
      });
    }
    renderPreview();
  }

  var TH = "text-align:start;padding:6px 9px;border-bottom:1px solid var(--line);font-size:12px;color:var(--muted);font-weight:700;white-space:nowrap;";
  var TD = "padding:6px 9px;border-bottom:1px solid var(--line);font-size:13px;white-space:nowrap;";
  var TDN = TD + "text-align:end;font-variant-numeric:tabular-nums;";

  function renderPreview() {
    if (!parsed || !parsed.rows.length) { elPreview.innerHTML = ""; return; }
    var names = headerNames(), body = elHeader.checked ? parsed.rows.slice(1) : parsed.rows;
    var show = body.slice(0, 5), roleOf = {}, k;
    for (k in mapping) { if (mapping.hasOwnProperty(k) && mapping[k] > -1) roleOf[mapping[k]] = k; }
    var labels = { task: t("tool.col.task", "Task"), role: t("tool.col.role", "Role"),
                   effort: t("tool.col.effort", "Effort"), phase: t("tool.col.phase", "Phase"),
                   unit: t("tool.col.unit", "Unit") };
    var html = '<table style="border-collapse:collapse;width:100%;"><thead><tr>';
    for (var i = 0; i < names.length; i++) {
      var tag = roleOf[i] ? '<br><span style="color:var(--accent);font-size:11px;">→ ' + esc(labels[roleOf[i]]) + "</span>" : "";
      html += '<th style="' + TH + '">' + esc(names[i]) + tag + "</th>";
    }
    html += "</tr></thead><tbody>";
    for (var r = 0; r < show.length; r++) {
      html += "<tr>";
      for (var c = 0; c < names.length; c++) {
        var v = c < show[r].length ? show[r][c] : "";
        html += '<td style="' + TD + 'max-width:180px;overflow:hidden;text-overflow:ellipsis;">' + esc(v) + "</td>";
      }
      html += "</tr>";
    }
    html += "</tbody></table>";
    var total = body.length;
    html += '<p style="color:var(--muted);font-size:12px;margin:8px 0 0;">' +
            esc(t("tool.map.preview", "First {shown} of {total} rows").replace("{shown}", fmtNum(show.length))
                .replace("{total}", fmtNum(total))) + "</p>";
    elPreview.innerHTML = html;
  }

  /* 역할 목록 → 단가 입력칸 (역할은 원본에서 뽑고, 값은 재사용 자산) */
  function distinctRoles() {
    if (!parsed || !parsed.rows.length || mapping.role === -1) return [];
    var body = elHeader.checked ? parsed.rows.slice(1) : parsed.rows;
    var seen = {}, out = [];
    for (var i = 0; i < body.length; i++) {
      if (rowIsEmpty(body[i])) continue;
      var v = mapping.role < body[i].length ? String(body[i][mapping.role]).trim() : "";
      var key = v || UNASSIGNED;
      if (!seen[key]) { seen[key] = 1; out.push(key); }
    }
    return out;
  }

  function renderRates() {
    var roles = distinctRoles();
    if (!roles.length) { elRateGrid.innerHTML = ""; return; }
    var html = "";
    for (var i = 0; i < roles.length; i++) {
      var r = roles[i], v = rates[r] != null ? rates[r] : "";
      html += '<div><label for="rate-' + i + '" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
              esc(roleLabel(r)) + '</label><input type="number" id="rate-' + i + '" min="0" step="1" ' +
              'inputmode="decimal" autocomplete="off" value="' + esc(v) + '" data-role="' + esc(r) + '"></div>';
    }
    elRateGrid.innerHTML = html;
    var ins = elRateGrid.querySelectorAll("input");
    for (var k = 0; k < ins.length; k++) {
      ins[k].addEventListener("input", function () {
        var role = this.getAttribute("data-role"), v = parseNum(this.value);
        if (this.value.trim() === "" || isNaN(v) || v < 0) delete rates[role];
        else rates[role] = v;
        saveSettings();
      });
    }
  }

  /* ---------- 계산 ---------- */
  function opts() {
    return { conv: activeConv(), rates: rates, rateUnit: elRateUnit.value, unit: elUnit.value };
  }

  function showError(msgKey, fallback) {
    elResult.innerHTML = '<p style="margin:0;">' + esc(t(msgKey, fallback)) + "</p>";
    elDetail.innerHTML = "";
    elExports.style.display = "none";
    lastResult = null;
  }

  function calculate() {
    if (busy) return;
    var text = elData.value;
    if (!text || !text.trim()) { showError("tool.err.noInput", "Nothing to calculate yet — paste a task list above, or press “Fill 5 example rows”."); return; }
    if (!parsed || !parsed.rows.length) parseInput(text);
    if (!parsed || !parsed.rows.length) { showError("tool.err.parse", "Could not read a table out of that. Check that columns are separated by tabs, commas or semicolons."); return; }
    if (mapping.effort === -1) { showError("tool.err.needEffort", "Tell me which column holds the effort — pick it under “Column mapping”."); return; }

    var recs = buildRecords(parsed.rows, mapping, elHeader.checked);
    if (!recs.length) { showError("tool.err.noRows", "That table has a header but no data rows under it."); return; }

    saveSettings();
    var o = opts();
    if (recs.length <= 10000) { finish(rollup(recs, o)); return; }

    // 대량: 청크로 끊어 UI 를 막지 않고 진행률을 보여준다
    busy = true;
    elProgWrap.hidden = false;
    var acc = rollupCreate(o), i = 0, CH = 2000;
    (function step() {
      var end = Math.min(i + CH, recs.length);
      for (; i < end; i++) rollupPush(acc, recs[i]);
      var pct = Math.round((i / recs.length) * 100);
      elProgBar.style.width = pct + "%";
      elProgTxt.textContent = t("tool.progress", "Crunching {done} of {total} rows…")
        .replace("{done}", fmtNum(i)).replace("{total}", fmtNum(recs.length));
      if (i < recs.length) { setTimeout(step, 0); return; }
      elProgWrap.hidden = true;
      elProgBar.style.width = "0";
      busy = false;
      finish(rollupDone(acc));
    })();
  }

  function finish(res) {
    lastResult = res;
    render();
  }

  function badge(text, tone) {
    var color = tone === "warn" ? "#b45309" : tone === "bad" ? "#b91c1c" : "var(--muted)";
    var bg = tone === "warn" ? "color-mix(in srgb, #f59e0b 14%, transparent)"
           : tone === "bad" ? "color-mix(in srgb, #ef4444 14%, transparent)"
           : "color-mix(in srgb, var(--muted) 12%, transparent)";
    return '<span style="display:inline-block;padding:3px 9px;border-radius:999px;background:' + bg +
           ";color:" + color + ';font-size:12.5px;font-weight:700;margin:0 6px 6px 0;">' + esc(text) + "</span>";
  }

  function lineList(arr) {
    var max = 8, shown = arr.slice(0, max).join(", ");
    return arr.length > max ? shown + " …" : shown;
  }

  function render() {
    if (!lastResult) return;
    var r = lastResult;

    if (!r.rows.length) {
      var why = [];
      if (r.excluded.nonNumeric.length) why.push(t("tool.reason.nonNumeric", "not a number") + " × " + fmtNum(r.excluded.nonNumeric.length));
      if (r.excluded.zeroNeg.length) why.push(t("tool.reason.zeroNeg", "zero or negative") + " × " + fmtNum(r.excluded.zeroNeg.length));
      if (r.excluded.empty.length) why.push(t("tool.reason.empty", "effort cell empty") + " × " + fmtNum(r.excluded.empty.length));
      why = why.slice(0, 3);
      elResult.innerHTML = '<p style="margin:0 0 8px;">' + esc(t("tool.err.noValid", "No usable rows — every row was excluded.")) + "</p>" +
        (why.length ? '<p style="margin:0;color:var(--muted);font-size:13.5px;">' + esc(why.join(" · ")) + "</p>" : "");
      elDetail.innerHTML = "";
      elExports.style.display = "none";
      return;
    }

    /* 요약: M/M · M/D · M/H 동시 표기 + 총 인건비 */
    var big = 'font-size:26px;font-weight:800;letter-spacing:-0.02em;color:var(--accent-strong);';
    var cap = 'font-size:12px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.04em;';
    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:12px;">';
    html += '<div><div style="' + cap + '">' + esc(t("tool.abbr.m", "M/M")) + '</div><div style="' + big + '">' + esc(fmtNum(r.totalMonths, 2)) + "</div></div>";
    html += '<div><div style="' + cap + '">' + esc(t("tool.abbr.d", "M/D")) + '</div><div style="' + big + '">' + esc(fmtNum(r.totalDays, 1)) + "</div></div>";
    html += '<div><div style="' + cap + '">' + esc(t("tool.abbr.h", "M/H")) + '</div><div style="' + big + '">' + esc(fmtNum(r.totalHours, 1)) + "</div></div>";
    if (r.totalCost != null) {
      html += '<div><div style="' + cap + '">' + esc(t("tool.res.cost", "Labour cost")) + '</div><div style="' + big + '">' + esc(fmtCur(r.totalCost)) + "</div></div>";
    }
    html += "</div>";

    html += '<p style="margin:12px 0 0;color:var(--muted);font-size:13px;">' +
            esc(t("tool.res.rowsOk", "{n} rows counted").replace("{n}", fmtNum(r.rows.length))) + " · " +
            esc(t("tool.conv.note", "1 M/M = {h} h").replace("{h}", fmtNum(r.hpm, 2))
                .replace("{hpd}", fmtNum(r.hpd, 2)).replace("{dpm}", fmtNum(r.hpm / r.hpd, 2))) + "</p>";

    /* 배지 — 조용한 실패 금지: 제외·미입력·극단값을 반드시 눈에 보이게 */
    var badges = "";
    if (r.excludedCount) {
      var parts = [];
      if (r.excluded.nonNumeric.length) parts.push(t("tool.reason.nonNumeric", "not a number") + " " + fmtNum(r.excluded.nonNumeric.length) + " (" + t("tool.res.row", "row") + " " + lineList(r.excluded.nonNumeric) + ")");
      if (r.excluded.zeroNeg.length) parts.push(t("tool.reason.zeroNeg", "zero or negative") + " " + fmtNum(r.excluded.zeroNeg.length) + " (" + t("tool.res.row", "row") + " " + lineList(r.excluded.zeroNeg) + ")");
      if (r.excluded.empty.length) parts.push(t("tool.reason.empty", "effort cell empty") + " " + fmtNum(r.excluded.empty.length) + " (" + t("tool.res.row", "row") + " " + lineList(r.excluded.empty) + ")");
      badges += badge(t("tool.badge.excluded", "{n} rows excluded").replace("{n}", fmtNum(r.excludedCount)), "warn");
      badges += '<p style="margin:2px 0 8px;color:var(--muted);font-size:12.5px;">' + esc(parts.join(" · ")) + "</p>";
    }
    if (r.noRateRoles.length) {
      var names = [];
      for (var i = 0; i < r.noRateRoles.length; i++) names.push(roleLabel(r.noRateRoles[i]));
      badges += badge(t("tool.badge.noRate", "{n} roles have no rate — cost shown as “—”").replace("{n}", fmtNum(r.noRateRoles.length)), "warn");
      badges += '<p style="margin:2px 0 8px;color:var(--muted);font-size:12.5px;">' + esc(names.join(", ")) + "</p>";
    }
    if (r.extreme.length) {
      badges += badge(t("tool.badge.extreme", "Check your input: {n} row(s) over {mm} M/M")
        .replace("{n}", fmtNum(r.extreme.length)).replace("{mm}", fmtNum(EXTREME_MM)), "bad");
    }
    var hasUnassigned = false;
    for (var q = 0; q < r.roles.length; q++) { if (r.roles[q].key === UNASSIGNED) hasUnassigned = true; }
    if (hasUnassigned) badges += badge(t("tool.badge.unassigned", "Some rows have no role — grouped as “Unassigned”"), "warn");
    if (badges) html += '<div style="margin-top:12px;">' + badges + "</div>";

    /* 역할별 비중 막대 */
    html += '<div style="margin-top:16px;">';
    html += '<div style="' + cap + 'margin-bottom:8px;">' + esc(t("tool.res.byRole", "By role")) + "</div>";
    for (var b = 0; b < r.roles.length; b++) {
      var R = r.roles[b], pct = Math.round(R.share * 1000) / 10;
      var aria = roleLabel(R.key) + ": " + fmtNum(R.hours / r.hpm, 2) + " " + t("tool.abbr.m", "M/M") + ", " + pct + "%";
      html += '<div style="margin-bottom:9px;" role="img" aria-label="' + esc(aria) + '">';
      html += '<div style="display:flex;justify-content:space-between;gap:10px;font-size:13px;margin-bottom:3px;">' +
              '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;">' + esc(roleLabel(R.key)) + "</span>" +
              '<span style="color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums;">' +
              esc(fmtNum(R.hours / r.hpm, 2)) + " " + esc(t("tool.abbr.m", "M/M")) + " · " + esc(fmtNum(pct, 1)) + "%" +
              (R.cost != null ? " · " + esc(fmtCur(R.cost)) : "") + "</span></div>";
      html += '<div style="height:7px;border-radius:999px;background:var(--line);overflow:hidden;">' +
              '<div style="height:100%;width:' + pct + '%;background:var(--accent);"></div></div></div>';
    }
    html += "</div>";
    elResult.innerHTML = html;

    renderDetail(r);
    elExports.style.display = "flex";
  }

  function renderDetail(r) {
    var html = "";
    var cap = 'font-size:12px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.04em;';

    /* JP 精算幅 민감도 — 같은 공수를 140/160/180h 로 나눈 M/M */
    if (elConv.value === "jp-160") {
      html += '<div style="margin-top:20px;padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--surface);">';
      html += '<div style="' + cap + '">' + esc(t("tool.jp.heading", "Settlement range sensitivity (精算幅)")) + "</div>";
      html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px;">';
      for (var i = 0; i < JP_DIVISORS.length; i++) {
        var d = JP_DIVISORS[i], mm = r.totalHours / d, on = d === 160;
        html += '<div style="text-align:center;padding:10px;border-radius:10px;border:1px solid ' +
                (on ? "var(--accent)" : "var(--line)") + ';">' +
                '<div style="font-size:12px;color:var(--muted);font-weight:700;">' + d + " h</div>" +
                '<div style="font-size:20px;font-weight:800;color:' + (on ? "var(--accent-strong)" : "var(--ink)") + ';">' +
                esc(fmtNum(mm, 2)) + "</div>" +
                '<div style="font-size:11.5px;color:var(--muted);">' + esc(t("tool.abbr.m", "M/M")) + "</div></div>";
      }
      html += "</div>";
      html += '<p style="margin:10px 0 0;color:var(--muted);font-size:12.5px;">' + esc(t("tool.jp.note", "Same work, three divisors.")) + "</p>";
      html += "</div>";
    }

    /* 역할 × 단계 피벗 */
    var phases = r.phases, roles = r.roles;
    if (roles.length && phases.length) {
      html += '<div style="margin-top:20px;"><div style="' + cap + 'margin-bottom:8px;">' +
              esc(t("tool.res.pivot", "Role × phase (M/M)")) + "</div>";
      html += '<div style="overflow-x:auto;"><table style="border-collapse:collapse;width:100%;"><thead><tr>';
      html += '<th style="' + TH + '">' + esc(t("tool.col.role", "Role")) + "</th>";
      for (var p = 0; p < phases.length; p++) {
        html += '<th style="' + TH + 'text-align:end;">' + esc(roleLabel(phases[p].key)) + "</th>";
      }
      html += '<th style="' + TH + 'text-align:end;">' + esc(t("tool.res.total", "Total")) + "</th></tr></thead><tbody>";
      for (var ri = 0; ri < roles.length; ri++) {
        html += '<tr><td style="' + TD + 'font-weight:600;">' + esc(roleLabel(roles[ri].key)) + "</td>";
        for (var pi = 0; pi < phases.length; pi++) {
          var h = r.pivot[roles[ri].key + "\u0001" + phases[pi].key];
          html += '<td style="' + TDN + '">' + (h ? esc(fmtNum(h / r.hpm, 2)) : '<span style="color:var(--muted);">·</span>') + "</td>";
        }
        html += '<td style="' + TDN + 'font-weight:700;">' + esc(fmtNum(roles[ri].hours / r.hpm, 2)) + "</td></tr>";
      }
      html += '<tr><td style="' + TD + 'font-weight:700;">' + esc(t("tool.res.total", "Total")) + "</td>";
      for (var pf = 0; pf < phases.length; pf++) {
        html += '<td style="' + TDN + 'font-weight:700;">' + esc(fmtNum(phases[pf].hours / r.hpm, 2)) + "</td>";
      }
      html += '<td style="' + TDN + 'font-weight:800;">' + esc(fmtNum(r.totalMonths, 2)) + "</td></tr>";
      html += "</tbody></table></div></div>";
    }

    /* 상세 — 원본 순서 보존, 환산 열만 덧붙임 */
    html += '<div style="margin-top:20px;"><div style="' + cap + 'margin-bottom:8px;">' +
            esc(t("tool.res.detail", "Per task")) + "</div>";
    html += '<div style="overflow-x:auto;"><table style="border-collapse:collapse;width:100%;"><thead><tr>';
    html += '<th style="' + TH + '">' + esc(t("tool.col.task", "Task")) + "</th>";
    html += '<th style="' + TH + '">' + esc(t("tool.col.role", "Role")) + "</th>";
    html += '<th style="' + TH + '">' + esc(t("tool.col.phase", "Phase")) + "</th>";
    html += '<th style="' + TH + 'text-align:end;">' + esc(t("tool.abbr.h", "M/H")) + "</th>";
    html += '<th style="' + TH + 'text-align:end;">' + esc(t("tool.abbr.d", "M/D")) + "</th>";
    html += '<th style="' + TH + 'text-align:end;">' + esc(t("tool.abbr.m", "M/M")) + "</th>";
    html += '<th style="' + TH + 'text-align:end;">' + esc(t("tool.res.cost", "Labour cost")) + "</th></tr></thead><tbody>";
    var cut = r.rows.slice(0, DETAIL_CAP);
    for (var k = 0; k < cut.length; k++) {
      var row = cut[k];
      html += "<tr>";
      html += '<td style="' + TD + 'max-width:220px;overflow:hidden;text-overflow:ellipsis;">' + esc(row.task || "—") + "</td>";
      html += '<td style="' + TD + '">' + esc(roleLabel(row.role)) + "</td>";
      html += '<td style="' + TD + '">' + esc(roleLabel(row.phase)) + "</td>";
      html += '<td style="' + TDN + '">' + esc(fmtNum(row.hours, 1)) + "</td>";
      html += '<td style="' + TDN + '">' + esc(fmtNum(row.hours / r.hpd, 2)) + "</td>";
      html += '<td style="' + TDN + '">' + esc(fmtNum(row.hours / r.hpm, 3)) + "</td>";
      html += '<td style="' + TDN + '">' + (row.cost == null ? "—" : esc(fmtCur(row.cost))) + "</td>";
      html += "</tr>";
    }
    html += "</tbody></table></div>";
    if (r.rows.length > DETAIL_CAP) {
      html += '<p style="margin:8px 0 0;color:var(--muted);font-size:12.5px;">' +
              esc(t("tool.res.capped", "Showing the first {cap} rows — the CSV export has all {n}.")
                  .replace("{cap}", fmtNum(DETAIL_CAP)).replace("{n}", fmtNum(r.rows.length))) + "</p>";
    }
    html += "</div>";
    elDetail.innerHTML = html;
  }

  /* ---------- 내보내기 ---------- */
  function detailRows(r) {
    var out = [[t("tool.col.task", "Task"), t("tool.col.role", "Role"), t("tool.col.phase", "Phase"),
                t("tool.abbr.h", "M/H"), t("tool.abbr.d", "M/D"), t("tool.abbr.m", "M/M"),
                t("tool.res.cost", "Labour cost"), t("tool.cur.label", "Currency")]];
    for (var i = 0; i < r.rows.length; i++) {
      var x = r.rows[i];
      out.push([x.task, roleLabel(x.role), roleLabel(x.phase),
                round(x.hours, 2), round(x.hours / r.hpd, 3), round(x.hours / r.hpm, 4),
                x.cost == null ? "" : round(x.cost, 2), x.cost == null ? "" : elCur.value]);
    }
    out.push([]);
    out.push([t("tool.res.total", "Total"), "", "", round(r.totalHours, 2), round(r.totalDays, 3),
              round(r.totalMonths, 4), r.totalCost == null ? "" : round(r.totalCost, 2),
              r.totalCost == null ? "" : elCur.value]);
    return out;
  }
  function round(v, dp) {
    if (v == null || !isFinite(v)) return "";
    var f = Math.pow(10, dp);
    return String(Math.round(v * f) / f);
  }
  /* 견적 품목 CSV — 역할별 1행. 열 구조는 일반적인 견적 서식과 호환된다 */
  function quoteRows(r) {
    var out = [[t("tool.q.item", "Item"), t("tool.q.qty", "Qty (M/M)"), t("tool.q.rate", "Unit price"),
                t("tool.q.amount", "Amount"), t("tool.cur.label", "Currency")]];
    for (var i = 0; i < r.roles.length; i++) {
      var R = r.roles[i], mm = R.hours / r.hpm;
      var unitPrice = R.cost != null && mm > 0 ? R.cost / mm : null;
      out.push([roleLabel(R.key), round(mm, 4), unitPrice == null ? "" : round(unitPrice, 2),
                R.cost == null ? "" : round(R.cost, 2), R.cost == null ? "" : elCur.value]);
    }
    return out;
  }
  function download(name, text) {
    try {
      // UTF-8 BOM — 한글 엑셀이 CSV 를 EUC-KR 로 오해하지 않게 한다
      var blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8;" });
      var url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) { showError("tool.err.export", "This browser blocked the download."); }
  }
  function flash(btn, key, fallback) {
    var old = btn.textContent;
    btn.textContent = t(key, fallback);
    setTimeout(function () { btn.textContent = old; }, 1400);
  }

  /* ---------- 이벤트 ---------- */
  $("btn-calc").addEventListener("click", calculate);
  $("btn-file").addEventListener("click", function () { elFile.click(); });
  elFile.addEventListener("change", function () {
    if (elFile.files && elFile.files[0]) readFile(elFile.files[0]);
  });
  $("btn-clear").addEventListener("click", function () {
    elData.value = ""; parsed = null; lastResult = null; lastBytes = null;
    mapping = emptyMapping();
    elMapBox.hidden = true; elEnc.hidden = true; elDetail.innerHTML = "";
    elExports.style.display = "none"; elRateGrid.innerHTML = "";
    elResult.innerHTML = '<p style="margin:0;color:var(--muted);">' +
      esc(t("tool.res.empty", "Paste a task list and press Calculate.")) + "</p>";
    elData.focus();
  });
  $("btn-sample").addEventListener("click", function () {
    elData.value = t("tool.sample", "Task\tRole\tEffort\tPhase");
    elEnc.hidden = true;
    parseInput(elData.value);
    calculate();
  });
  $("btn-kosa").addEventListener("click", function () {
    var roles = distinctRoles(), unit = elRateUnit.value, per = KOSA_RATE.perDay;
    var c = activeConv();
    var amount = unit === "d" ? per : unit === "h" ? per / c.hpd : per * c.dpm;
    for (var i = 0; i < roles.length; i++) { if (rates[roles[i]] == null) rates[roles[i]] = Math.round(amount); }
    renderRates(); saveSettings();
    if (lastResult) calculate();
  });
  $("btn-euckr").addEventListener("click", function () {
    if (!lastBytes) { elEnc.hidden = true; return; }
    var d = decodeBytes(lastBytes, "euc-kr");
    elData.value = d.text;
    elEnc.hidden = true;
    parseInput(d.text);
  });
  $("btn-csv").addEventListener("click", function () {
    if (lastResult) download(SLUG + ".csv", toCsv(detailRows(lastResult)));
  });
  $("btn-quote").addEventListener("click", function () {
    if (lastResult) download(SLUG + "-quote.csv", toCsv(quoteRows(lastResult)));
  });
  $("btn-tsv").addEventListener("click", function () {
    if (!lastResult) return;
    var btn = this, text = toTsv(detailRows(lastResult));
    if (!navigator.clipboard) { flash(btn, "tool.exp.failed", "Clipboard unavailable"); return; }
    navigator.clipboard.writeText(text).then(function () {
      flash(btn, "tool.exp.copied", "Copied");
    }, function () { flash(btn, "tool.exp.failed", "Clipboard blocked"); });
  });

  elData.addEventListener("input", function () {
    elEnc.hidden = true; lastBytes = null;
    if (elData.value.trim()) parseInput(elData.value);
    else { parsed = null; elMapBox.hidden = true; elRateGrid.innerHTML = ""; }
  });
  elHeader.addEventListener("change", function () {
    if (!parsed) return;
    mapping = guessMapping(parsed.rows, elHeader.checked);
    renderMapping(); renderRates(); saveSettings();
  });
  elConv.addEventListener("change", function () { syncConvUi(); saveSettings(); if (lastResult) calculate(); });
  elCur.addEventListener("change", function () { syncConvUi(); saveSettings(); if (lastResult) render(); });
  elRateUnit.addEventListener("change", function () { saveSettings(); if (lastResult) calculate(); });
  elUnit.addEventListener("change", function () { saveSettings(); if (lastResult) calculate(); });
  elHpd.addEventListener("input", function () { syncConvUi(); saveSettings(); if (lastResult) calculate(); });
  elDpm.addEventListener("input", function () { syncConvUi(); saveSettings(); if (lastResult) calculate(); });

  /* 드래그앤드롭 — File API, 업로드 아님 */
  function readFile(file) {
    var reader = new FileReader();
    reader.onerror = function () { showError("tool.err.file", "That file could not be read."); };
    reader.onload = function (ev) {
      lastBytes = ev.target.result;
      var d = decodeBytes(lastBytes);
      elData.value = d.text;
      elEnc.hidden = !(d.enc === "utf-8" && /�/.test(d.text));
      parseInput(d.text);
    };
    reader.readAsArrayBuffer(file);
  }
  ["dragenter", "dragover"].forEach(function (evt) {
    elData.addEventListener(evt, function (e) {
      e.preventDefault(); elData.style.outline = "2px dashed var(--accent)";
    });
  });
  ["dragleave", "drop"].forEach(function (evt) {
    elData.addEventListener(evt, function () { elData.style.outline = ""; });
  });
  elData.addEventListener("drop", function (e) {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
  });

  /* 언어 전환 시 동적 렌더물 다시 그리기 */
  document.addEventListener("i18n:change", function () {
    syncConvUi();
    if (parsed && parsed.rows.length) { renderMapping(); renderRates(); }
    if (lastResult) render();
    else elResult.innerHTML = '<p style="margin:0;color:var(--muted);">' +
      esc(t("tool.res.empty", "Paste a task list and press Calculate.")) + "</p>";
  });

  /* 저장된 재사용 자산 복원 (단가표·환산상수·매핑만) */
  (function init() {
    var s = loadSettings();
    if (s.conv && CONV[s.conv]) elConv.value = s.conv;
    if (s.hpd) elHpd.value = s.hpd;
    if (s.dpm) elDpm.value = s.dpm;
    if (s.currency) elCur.value = s.currency;
    if (s.rateUnit) elRateUnit.value = s.rateUnit;
    if (s.unit) elUnit.value = s.unit;
    if (s.rates && typeof s.rates === "object") rates = s.rates;
    syncConvUi();
  })();
  // TOOLJS:END
})();
