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
  // vehicle-log-agg — 업무용승용차 운행기록부 집계 (spec: factory/state/vehicle-log-agg.yaml)
  //
  // 설계 요약
  // - 운행 원본(사용자 이름·이동 이력 = 개인정보)은 어디에도 저장하지 않는다. 네트워크 호출 0.
  //   localStorage 에는 다음 결산의 재입력을 없애는 프리셋만 담는다
  //   (vehicle-log-agg:mapNames / :purpose / :vehicles / :months).
  // - 파싱·집계는 Blob Worker 로 오프로드해 대용량에서도 탭이 멈추지 않는다(진행률·취소).
  //   Worker 를 만들 수 없는 환경(file:// 등)에서는 "같은 함수"를 메인 스레드 shim 으로 돌린다 —
  //   메시지 프로토콜이 동일해 호출부가 하나뿐이고, 두 구현이 어긋날 수 없다.
  // - 세법 상수는 2개(1,500만원·800만원)뿐. 사업연도 12개월 미만이면 월할(법인세법 §50조의2).
  //   개정 시 이 두 숫자만 교체한다.

  var LIMIT_NO_LOG = 15000000;       // 기록부 미작성 시 인정 한도 (원/사업연도)
  var LIMIT_DEPRECIATION = 8000000;  // 감가상각비 손금 한도 (원/사업연도), 초과분 차기 이월
  var MAX_EXCLUDED = 200;            // 제외 행 표시 상한 (집계는 전 행 대상)
  var MAX_PURPOSE = 60;              // 사용목적 고유값 표시 상한 (넘으면 열 오지정 의심)

  /* ============================================================
     순수 코어 — 아래 8개 함수는 "클로저를 참조하지 않는" self-contained 함수다.
     Blob worker 소스를 toString() 직렬화로 만들기 때문에 바깥 변수를 참조하면
     worker 안에서 ReferenceError 로 죽는다. 상수는 인자로 받는다.
     ============================================================ */

  // 표시 문자열 → 숫자. 천단위 콤마·공백만 허용하고 그 밖의 문자가 섞이면 NaN(= 명시적 제외 사유).
  function vlaNum(s) {
    if (s == null) return NaN;
    var t = String(s).replace(/[\s, 　]/g, "");
    if (t === "") return NaN;
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return NaN;
    return parseFloat(t);
  }

  // 증분 CSV 토크나이저. 따옴표 안의 구분자·개행·이스케이프("")를 처리하고,
  // 청크 경계에 걸친 행은 내부 상태로 이어붙인다 → 스트리밍 파싱 가능.
  function vlaCsvStream(delim) {
    var out = [], field = "", row = [], st = 0, cr = false;
    // st: 0=필드 시작, 1=일반 필드, 2=따옴표 안, 3=따옴표 안에서 " 를 만남
    function endRow() { row.push(field); field = ""; out.push(row); row = []; st = 0; }
    function flush() { var r = out; out = []; return r; }
    return {
      push: function (text) {
        for (var i = 0; i < text.length; i++) {
          var c = text.charAt(i);
          if (cr) { cr = false; if (c === "\n") continue; }
          if (st === 2) { if (c === '"') st = 3; else field += c; continue; }
          if (st === 3) {
            if (c === '"') { field += '"'; st = 2; continue; }
            st = 1; // 닫는 따옴표였다 — 아래 일반 처리로 흘려보낸다
          }
          if (c === '"' && st === 0) { st = 2; continue; }
          if (c === delim) { row.push(field); field = ""; st = 0; continue; }
          if (c === "\n") { endRow(); continue; }
          if (c === "\r") { endRow(); cr = true; continue; }
          field += c;
          if (st === 0) st = 1;
        }
        return flush();
      },
      end: function () {
        if (st !== 0 || field !== "" || row.length) endRow();
        return flush();
      }
    };
  }

  // 사용목적 원본 문자열 → 3분류 추정. 못 알아보면 ""(분류 필요) — 비업무로 간주하지 않는다.
  function vlaGuessPurpose(raw) {
    var s = String(raw == null ? "" : raw).toLowerCase().replace(/[\s \-_()[\]/.]/g, "");
    if (!s) return "";
    // "비업무" 안에 "업무" 가 들어있다 — 비업무를 반드시 먼저 판정한다
    if (s.indexOf("비업무") >= 0 || s.indexOf("사적") >= 0 || s.indexOf("개인") >= 0 ||
        s.indexOf("사용안함") >= 0 || s.indexOf("nonbusiness") >= 0 || s.indexOf("nonbiz") >= 0 ||
        s.indexOf("private") >= 0 || s.indexOf("personal") >= 0) return "nonbiz";
    if (s.indexOf("출퇴근") >= 0 || s.indexOf("출근") >= 0 || s.indexOf("퇴근") >= 0 ||
        s.indexOf("commut") >= 0) return "commute";
    if (s.indexOf("업무") >= 0 || s.indexOf("일반") >= 0 || s.indexOf("영업") >= 0 ||
        s.indexOf("외근") >= 0 || s.indexOf("출장") >= 0 || s.indexOf("거래처") >= 0 ||
        s.indexOf("배송") >= 0 || s.indexOf("납품") >= 0 || s.indexOf("현장") >= 0 ||
        s.indexOf("business") >= 0 || s.indexOf("work") >= 0 || s.indexOf("sales") >= 0 ||
        s.indexOf("delivery") >= 0 || s.indexOf("client") >= 0) return "biz";
    return "";
  }

  // 행 1개 해석 — 집계와 국세청 서식 내보내기가 같은 판정을 쓰도록 여기 한 곳에만 둔다.
  function vlaRow(f, map, purposeMap) {
    function cell(idx) { return idx >= 0 && f[idx] != null ? String(f[idx]).trim() : ""; }
    var km = NaN, reason = "", val = "";
    var ds = cell(map.dist), sa = cell(map.start), sb = cell(map.end);
    if (map.dist >= 0 && ds !== "") {
      km = vlaNum(ds);
      if (isNaN(km)) { reason = "nonum"; val = ds; }
      else if (km < 0) { reason = "neg"; val = ds; }
    } else if (map.start >= 0 && map.end >= 0) {
      var a = vlaNum(sa), b = vlaNum(sb);
      if (isNaN(a) || isNaN(b)) { reason = "nonum"; val = sa + " → " + sb; }
      else if (a < 0 || b < 0) { reason = "neg"; val = sa + " → " + sb; }
      else if (b < a) { reason = "back"; val = sa + " → " + sb; }
      else km = b - a;
    } else {
      reason = "nodist";
    }
    var praw = cell(map.purpose);
    var cat = purposeMap["#" + praw.toLowerCase()];
    if (cat !== "biz" && cat !== "commute" && cat !== "nonbiz") cat = vlaGuessPurpose(praw);
    if (!reason && !cat) { reason = "purpose"; val = praw; }
    return { km: km, cat: cat, reason: reason, val: val, praw: praw,
             id: cell(map.vehicle), date: cell(map.date), user: cell(map.user), s: sa, e: sb };
  }

  // 차량별 1패스 집계 O(n). 더러운 행은 버리지 않고 excluded 로 사유와 함께 되돌린다.
  function vlaAggregate(records, skip, map, purposeMap, maxExcluded, maxPurpose) {
    var byId = {}, order = [], excluded = [], counted = 0, needClass = 0, read = 0;
    var pvals = {}, porder = [], ptrunc = false;
    for (var i = skip; i < records.length; i++) {
      var rec = records[i], r = vlaRow(rec.f, map, purposeMap);
      read++;
      if (map.purpose >= 0) {
        var pk = "#" + r.praw.toLowerCase();
        if (!pvals[pk]) {
          if (porder.length < maxPurpose) { pvals[pk] = { key: pk, v: r.praw, n: 0, cat: r.cat }; porder.push(pk); }
          else ptrunc = true;
        }
        if (pvals[pk]) pvals[pk].n++;
      }
      if (r.reason) {
        if (r.reason === "purpose") needClass++;
        if (excluded.length < maxExcluded) excluded.push({ n: rec.n, reason: r.reason, val: r.val });
        continue;
      }
      var key = "#" + r.id;
      var v = byId[key];
      if (!v) { v = byId[key] = { id: r.id, totalKm: 0, bizKm: 0, commuteKm: 0, nonbizKm: 0, rows: 0 }; order.push(key); }
      v.totalKm += r.km;
      v.rows++;
      if (r.cat === "commute") { v.bizKm += r.km; v.commuteKm += r.km; }
      else if (r.cat === "biz") { v.bizKm += r.km; }
      else { v.nonbizKm += r.km; }
      counted++;
    }
    var vehicles = [];
    for (var j = 0; j < order.length; j++) vehicles.push(byId[order[j]]);
    var purposeValues = [];
    for (var k = 0; k < porder.length; k++) purposeValues.push(pvals[porder[k]]);
    return { vehicles: vehicles, excluded: excluded, counted: counted, read: read,
             needClass: needClass, purposeValues: purposeValues, purposeTrunc: ptrunc };
  }

  function vlaCsvCell(s) {
    var t = s == null ? "" : String(s);
    return /["\r\n,]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }

  // 국세청 별지 서식(운행기록부) 열 순서로 내보낸다.
  // 열 이름과 비고 문구는 한국 세무 서식이므로 UI 언어와 무관하게 항상 한국어다(번역하면 서식이 아니게 된다).
  // 제외된 행도 비고에 사유를 적어 함께 내보낸다 — 내보내기에서 조용히 사라지면 안 된다.
  function vlaExportCsv(records, skip, map, purposeMap) {
    var HEAD = ["차종", "자동차등록번호", "사용일자", "사용자(부서/성명)",
                "주행전 계기판거리(km)", "주행후 계기판거리(km)", "주행거리(km)",
                "업무용 사용거리(km) 출퇴근용", "업무용 사용거리(km) 일반업무용",
                "비업무용 사용거리(km)", "비고"];
    var REASON = { nonum: "제외: 숫자가 아닌 값", neg: "제외: 음수", back: "제외: 계기판 역행",
                   purpose: "제외: 사용목적 미분류", nodist: "제외: 주행거리 정보 없음" };
    var lines = [], i, c;
    var h = [];
    for (i = 0; i < HEAD.length; i++) h.push(vlaCsvCell(HEAD[i]));
    lines.push(h.join(","));
    for (i = skip; i < records.length; i++) {
      var r = vlaRow(records[i].f, map, purposeMap);
      var km = r.reason ? "" : String(r.km);
      var cells = ["", r.id, r.date, r.user, r.s, r.e, km,
                   r.reason ? "" : (r.cat === "commute" ? String(r.km) : "0"),
                   r.reason ? "" : (r.cat === "biz" ? String(r.km) : "0"),
                   r.reason ? "" : (r.cat === "nonbiz" ? String(r.km) : "0"),
                   r.reason ? (REASON[r.reason] + (r.val ? " (" + r.val + ")" : "")) : ""];
      var esc = [];
      for (c = 0; c < cells.length; c++) esc.push(vlaCsvCell(cells[c]));
      lines.push(esc.join(","));
    }
    return lines.join("\r\n");
  }

  // Worker 본체 — 실제 Worker 에서는 vlaWorkerMain(self), 폴백에서는 vlaWorkerMain(shim) 으로 같은 코드를 돈다.
  function vlaWorkerMain(scope) {
    var MAXR = 200000;          // 상한 초과는 조용히 자르지 않고 over 플래그로 알린다
    var CHUNK_TEXT = 262144;
    var CHUNK_FILE = 1048576;
    var records = [], meta = { enc: "utf-8", delim: ",", cols: 0 };
    var stream = null, decoder = null, rowNo = 0, over = false, cancelled = false;

    function post(m) { scope.postMessage(m); }

    function sniff(u8) {
      if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) return "utf-8";
      try {
        // stream:true — 청크 끝에서 잘린 멀티바이트는 오류로 치지 않는다(오탐 방지)
        new TextDecoder("utf-8", { fatal: true }).decode(u8.subarray(0, Math.min(u8.length, 262144)), { stream: true });
        return "utf-8";
      } catch (e) { return "euc-kr"; }
    }
    function makeDecoder(u8, want) {
      var enc = want && want !== "auto" ? want : sniff(u8);
      try { return { enc: enc, dec: new TextDecoder(enc) }; }
      catch (e) { return { enc: "utf-8", dec: new TextDecoder("utf-8") }; }
    }
    function detectDelim(text) {
      var truncated = text.length > 8192;
      var head = text.slice(0, 8192).split(/\r\n|\r|\n/);
      if (truncated && head.length > 1) head.pop();   // 잘린 마지막 줄은 세지 않는다
      var cand = [",", "\t", ";"], best = ",", bestScore = 0, i, c;
      for (c = 0; c < cand.length; c++) {
        var counts = [];
        for (i = 0; i < head.length && counts.length < 5; i++) {
          if (head[i] === "") continue;
          counts.push(head[i].split(cand[c]).length - 1);
        }
        if (!counts.length) continue;
        var min = counts[0], sum = 0;
        for (i = 0; i < counts.length; i++) { if (counts[i] < min) min = counts[i]; sum += counts[i]; }
        var score = min > 0 ? 1000 * min + sum : 0;   // 모든 행에 일관되게 나타나는 구분자를 우선
        if (score > bestScore) { bestScore = score; best = cand[c]; }
      }
      return best;
    }
    function take(rows) {
      for (var i = 0; i < rows.length; i++) {
        var f = rows[i], blank = true;
        for (var j = 0; j < f.length; j++) { if (String(f[j]).trim() !== "") { blank = false; break; } }
        if (blank) continue;                 // 완전한 빈 행은 데이터가 아니다 — 읽은 행수에도 넣지 않는다
        if (records.length >= MAXR) { over = true; return; }
        rowNo++;
        records.push({ n: rowNo, f: f });
        if (f.length > meta.cols) meta.cols = f.length;
      }
    }
    function feed(text, first, wantDelim) {
      if (first) {
        meta.delim = (wantDelim && wantDelim !== "auto")
          ? (wantDelim === "tab" ? "\t" : wantDelim)
          : detectDelim(text);
        stream = vlaCsvStream(meta.delim);
      }
      take(stream.push(text));
    }
    function guessHeader(f) {
      if (!f) return true;
      var numeric = 0;
      for (var i = 0; i < f.length; i++) if (!isNaN(vlaNum(f[i]))) numeric++;
      return numeric < 2;   // 헤더 행에 숫자 셀이 2개 이상인 경우는 드물다
    }
    function done() {
      if (cancelled) return;
      if (stream) take(stream.end());
      var first = [];
      for (var i = 0; i < records.length && i < 6; i++) first.push(records[i].f);
      post({ type: "parsed", enc: meta.enc, delim: meta.delim, cols: meta.cols,
             total: records.length, first: first, over: over,
             hasHeader: guessHeader(records.length ? records[0].f : null) });
    }
    function parseText(text, wantDelim) {
      var pos = 0, first = true;
      meta.enc = "utf-8";   // 붙여넣기는 이미 디코드된 텍스트다 — 인코딩 개념이 없다
      (function step() {
        if (cancelled) return;
        if (pos >= text.length) { done(); return; }
        feed(text.slice(pos, pos + CHUNK_TEXT), first, wantDelim);
        first = false;
        pos += CHUNK_TEXT;
        post({ type: "progress", rows: records.length, pct: Math.min(99, Math.round(pos / text.length * 100)) });
        if (over) { done(); return; }
        setTimeout(step, 0);
      })();
    }
    function parseFile(file, wantEnc, wantDelim) {
      var pos = 0, first = true, fr;
      try { fr = new FileReader(); } catch (e) { post({ type: "error", code: "read" }); return; }
      fr.onerror = function () { post({ type: "error", code: "read" }); };
      fr.onload = function () {
        if (cancelled) return;
        var u8 = new Uint8Array(fr.result);
        if (!decoder) { var d = makeDecoder(u8, wantEnc); decoder = d.dec; meta.enc = d.enc; }
        var more = pos + CHUNK_FILE < file.size;
        feed(decoder.decode(u8, { stream: more }), first, wantDelim);
        first = false;
        pos += CHUNK_FILE;
        post({ type: "progress", rows: records.length, pct: Math.min(99, Math.round(pos / file.size * 100)) });
        if (over) { done(); return; }
        setTimeout(step, 0);
      };
      function step() {
        if (cancelled) return;
        if (pos >= file.size) { done(); return; }
        try { fr.readAsArrayBuffer(file.slice(pos, Math.min(pos + CHUNK_FILE, file.size))); }
        catch (e) { post({ type: "error", code: "read" }); }
      }
      step();
    }
    scope.onmessage = function (e) {
      var m = e.data || {};
      if (m.cmd === "ping") { post({ type: "pong" }); return; }
      if (m.cmd === "cancel") { cancelled = true; return; }
      if (m.cmd === "parse") {
        cancelled = false; records = []; stream = null; decoder = null;
        rowNo = 0; over = false; meta = { enc: "utf-8", delim: ",", cols: 0 };
        if (m.src.kind === "text") parseText(m.src.text, m.delim);
        else parseFile(m.src.file, m.enc, m.delim);
        return;
      }
      if (m.cmd === "agg") {
        post({ type: "agg", token: m.token,
               result: vlaAggregate(records, m.skip, m.map, m.purposeMap, m.maxExcluded, m.maxPurpose) });
        return;
      }
      if (m.cmd === "export") {
        post({ type: "export", csv: vlaExportCsv(records, m.skip, m.map, m.purposeMap) });
        return;
      }
    };
  }

  /* ---------- 손금 판정 (메인 스레드 전용 — 요약값 위에서만 도는 순수 산술) ---------- */

  // 한 시나리오의 손금산입액. 감가상각비는 업무사용분이라도 한도(월할 적용)를 넘으면 그만큼 이월된다.
  function vlaScenario(cost, dep, ratio, depCap) {
    var over = Math.max(0, dep * ratio - depCap);
    return { deduct: cost * ratio - over, carry: over };
  }

  // 차량 1대의 최종 판정. cost 가 null 이면 비율만 산출한다(0원으로 위장하지 않는다).
  function vlaVehicleResult(v, cost, months) {
    var mf = Math.min(Math.max(months, 1), 12) / 12;   // 사업연도 1년 미만 → 두 한도 모두 월할
    var noLogLimit = LIMIT_NO_LOG * mf, depCap = LIMIT_DEPRECIATION * mf;
    var ratio = v.totalKm > 0 ? v.bizKm / v.totalKm : null;   // 0 나눗셈 금지
    var out = { ratio: ratio, cost: null, dep: 0, gated: !!(cost && cost.insured === false),
                withLog: null, noLog: null, underLimit: false, noLogRatio: null,
                depCap: depCap, noLogLimit: noLogLimit };
    if (!cost || !cost.has) return out;
    out.cost = cost.dep + cost.fuel + cost.ins + cost.repair + cost.tax + cost.toll;
    out.dep = cost.dep;
    out.underLimit = out.cost <= noLogLimit;
    out.noLogRatio = out.underLimit ? 1 : (out.cost > 0 ? noLogLimit / out.cost : 1);
    if (ratio == null) return out;   // 운행 기록 없음 → 비율 산출 불가, 손금액 계산하지 않는다
    if (out.gated) {
      // 업무전용자동차보험 미가입 → 비율과 무관하게 관련비용 전액 손금불산입.
      // 좋은 숫자를 먼저 보여주면 조용한 실패이므로 계산된 값을 0원으로 덮는다.
      out.withLog = { deduct: 0, carry: 0, disallow: out.cost };
      out.noLog = { deduct: 0, carry: 0, disallow: out.cost };
      return out;
    }
    var w = vlaScenario(out.cost, out.dep, ratio, depCap);
    out.withLog = { deduct: w.deduct, carry: w.carry, disallow: out.cost - w.deduct };
    var n = vlaScenario(out.cost, out.dep, out.noLogRatio, depCap);
    out.noLog = { deduct: n.deduct, carry: n.carry, disallow: out.cost - n.deduct };
    return out;
  }

  /* ---------- 헤더 → 열 추정 ---------- */

  var SYN = {
    vehicle: ["자동차등록번호", "차량번호", "등록번호", "번호판", "차대번호", "차번", "차량",
              "vehiclenumber", "vehicleno", "licenseplate", "vehicle", "plate", "carno", "car"],
    date: ["운행일자", "사용일자", "운행일", "사용일", "일자", "날짜", "tripdate", "usedate", "date", "day"],
    user: ["사용자부서성명", "사용자", "운전자", "부서", "성명", "이름",
           "department", "employee", "driver", "user", "dept", "name"],
    start: ["주행전계기판거리", "주행전계기판", "출발계기판", "시작계기판", "계기판전", "주행전", "전계기판",
            "출발", "시작", "startodometer", "odometerstart", "startodo", "odostart", "start", "before"],
    end: ["주행후계기판거리", "주행후계기판", "도착계기판", "종료계기판", "계기판후", "주행후", "후계기판",
          "도착", "종료", "endodometer", "odometerend", "endodo", "odoend", "end", "after"],
    dist: ["업무용사용거리", "주행거리", "운행거리", "이동거리", "distance", "mileage", "거리", "km"],
    purpose: ["사용목적", "운행목적", "업무구분", "목적", "용도", "구분",
              "purpose", "category", "reason", "usage", "type"]
  };

  function normHead(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[\s ()[\]{}·,.\-_/\\:]/g, "");
  }

  // 가장 긴 동의어가 이긴다 — "주행전계기판거리(km)" 가 dist("거리")로 새지 않게 하는 유일한 장치.
  function vlaAutoMap(headers) {
    var cands = [], m = { vehicle: -1, date: -1, user: -1, start: -1, end: -1, dist: -1, purpose: -1 };
    var i, k, j;
    for (i = 0; i < headers.length; i++) {
      var h = normHead(headers[i]);
      if (!h) continue;
      for (k in SYN) {
        if (!SYN.hasOwnProperty(k)) continue;
        var best = 0;
        for (j = 0; j < SYN[k].length; j++) {
          if (h.indexOf(SYN[k][j]) >= 0 && SYN[k][j].length > best) best = SYN[k][j].length;
        }
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

  /* ---------- node 단위 검증 훅 (브라우저에는 module 이 없어 그대로 UI 초기화) ---------- */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      vlaNum: vlaNum, vlaCsvStream: vlaCsvStream, vlaGuessPurpose: vlaGuessPurpose,
      vlaRow: vlaRow, vlaAggregate: vlaAggregate, vlaExportCsv: vlaExportCsv,
      vlaCsvCell: vlaCsvCell, vlaScenario: vlaScenario, vlaVehicleResult: vlaVehicleResult,
      vlaAutoMap: vlaAutoMap, vlaWorkerMain: vlaWorkerMain,
      LIMIT_NO_LOG: LIMIT_NO_LOG, LIMIT_DEPRECIATION: LIMIT_DEPRECIATION
    };
    return;
  }

  /* ============================================================
     엔진 — Worker 우선, 못 만들면 같은 코드를 메인 스레드에서 돌리는 shim.
     ping/pong 으로 한 번만 가용성을 확인하고, 그 전에 온 명령은 큐에 쌓아 순서를 지킨다.
     ============================================================ */
  var engine = (function () {
    var impl = null, ready = false, queue = [], handler = null, timer = null;

    function workerSource() {
      return [
        vlaNum.toString(), vlaCsvStream.toString(), vlaGuessPurpose.toString(),
        vlaRow.toString(), vlaAggregate.toString(), vlaCsvCell.toString(),
        vlaExportCsv.toString(), vlaWorkerMain.toString(), "vlaWorkerMain(self);"
      ].join("\n");
    }
    function deliver(msg) {
      if (msg && msg.type === "pong") { if (!ready) { clearTimeout(timer); ready = true; flush(); } return; }
      if (handler) handler(msg);
    }
    function flush() { while (queue.length && impl) impl.postMessage(queue.shift()); }
    function makeShim() {
      var inner = null;
      var shimScope = {
        onmessage: null,
        postMessage: function (m) { setTimeout(function () { deliver(m); }, 0); }
      };
      vlaWorkerMain(shimScope);
      inner = shimScope;
      return {
        postMessage: function (m) { setTimeout(function () { if (inner.onmessage) inner.onmessage({ data: m }); }, 0); },
        terminate: function () { if (inner.onmessage) inner.onmessage({ data: { cmd: "cancel" } }); }
      };
    }
    function useShim() {
      if (impl && impl.terminate) { try { impl.terminate(); } catch (e) { /* 이미 죽음 */ } }
      impl = makeShim(); ready = true; flush();
    }
    function boot() {
      var w = null, url = null;
      try {
        if (typeof Worker === "function" && typeof Blob === "function" &&
            typeof URL !== "undefined" && URL.createObjectURL) {
          url = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
          w = new Worker(url);
        }
      } catch (e) { w = null; }   // file:// 등 blob worker 차단 환경 → shim
      if (url) { try { URL.revokeObjectURL(url); } catch (e2) { /* noop */ } }
      if (!w) { useShim(); return; }
      w.onmessage = function (e) { deliver(e.data); };
      w.onerror = function () { if (!ready) useShim(); };   // 뜨자마자 죽는 환경도 폴백
      impl = w;
      timer = setTimeout(function () { if (!ready) useShim(); }, 1500);
      w.postMessage({ cmd: "ping" });
    }
    return {
      send: function (m) {
        if (!impl) boot();
        if (ready && impl) impl.postMessage(m); else queue.push(m);
      },
      on: function (fn) { handler = fn; },
      reset: function () {
        queue.length = 0;
        if (impl) { try { impl.postMessage({ cmd: "cancel" }); impl.terminate(); } catch (e) { /* noop */ } }
        impl = null; ready = false; clearTimeout(timer);
      }
    };
  })();

  /* ============================================================
     UI
     ============================================================ */
  var cfg = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "vehicle-log-agg";
  var COST_FIELDS = ["dep", "fuel", "ins", "repair", "tax", "toll"];
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    src: null, srcName: "", parsed: null, hasHeader: true, agg: null,
    map: { vehicle: -1, date: -1, user: -1, start: -1, end: -1, dist: -1, purpose: -1 },
    purposeMap: {}, costs: {}, months: 12, token: 0, parsing: false, results: null, pgTimer: null
  };

  function t(key, vars) {
    var s = window.I18N ? window.I18N.t(key) : null;
    if (s == null) s = key;
    if (vars) for (var k in vars) if (vars.hasOwnProperty(k)) s = s.split("{" + k + "}").join(String(vars[k]));
    return s;
  }
  function uiLang() { return (window.I18N && window.I18N.lang()) || "en"; }
  function fmtKrw(v) {
    try { return new Intl.NumberFormat(uiLang(), { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(Math.round(v)); }
    catch (e) { return "₩" + Math.round(v); }
  }
  function fmtKm(v) {
    try { return new Intl.NumberFormat(uiLang(), { maximumFractionDigits: 1 }).format(v) + " km"; }
    catch (e) { return v + " km"; }
  }
  function fmtPct(r) {
    try { return new Intl.NumberFormat(uiLang(), { style: "percent", maximumFractionDigits: 1 }).format(r); }
    catch (e) { return (r * 100).toFixed(1) + "%"; }
  }
  function fmtN(v) {
    try { return new Intl.NumberFormat(uiLang()).format(v); } catch (e) { return String(v); }
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function loadPref(key, fallback) {
    try {
      var v = localStorage.getItem(SLUG + ":" + key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }
  function savePref(key, val) {
    try { localStorage.setItem(SLUG + ":" + key, JSON.stringify(val)); } catch (e) { /* private mode */ }
  }

  /* ---------- 입력 ---------- */

  var SAMPLE = [
    "차량번호,운행일자,사용자,주행전계기판(km),주행후계기판(km),사용목적",
    '12가3456,2026-01-05,"김철수, 영업2팀",10000,10120,일반업무',
    "12가3456,2026-01-06,김철수,10120,10152,출퇴근",
    "12가3456,2026-02-11,김철수,10152,10460,일반업무",
    "12가3456,2026-03-02,김철수,10460,10492,출퇴근",
    "12가3456,2026-04-18,김철수,10492,10530,개인용무",
    "12가3456,2026-05-09,김철수,10530,10980,거래처 방문",
    "34나5678,2026-01-08,이영희,52000,52240,일반업무",
    "34나5678,2026-01-09,이영희,52240,52268,출퇴근",
    "34나5678,2026-02-20,이영희,52268,52180,일반업무",
    "34나5678,2026-03-15,이영희,52268,52640,출장",
    "34나5678,2026-06-01,이영희,52640,52700,개인용무",
    "56다7890,2026-01-12,박민수,300,760,납품",
    "56다7890,2026-02-03,박민수,760,792,출퇴근",
    "56다7890,2026-04-22,박민수,792,1310,일반업무"
  ].join("\n");

  function setSrcNote(msg, isWarn) {
    var n = $("vla-srcnote");
    n.textContent = msg;
    n.className = "vla-note" + (isWarn ? " vla-warn" : "");
    n.removeAttribute("data-i18n");
  }

  function startParse() {
    if (!state.src) return;
    state.parsing = true;
    state.agg = null;
    state.results = null;
    $("vla-setup").hidden = true;
    $("vla-result").hidden = true;
    $("vla-pfill").style.width = "0%";
    $("vla-ptext").textContent = t("tool.progress", { rows: 0 });
    // 진행률 UI 는 250ms 넘게 걸릴 때만 띄운다 — 작은 파일에서 깜빡이지 않게
    var pg = $("vla-progress");
    pg.hidden = true;
    state.pgTimer = setTimeout(function () { if (state.parsing) pg.hidden = false; }, 250);
    engine.send({
      cmd: "parse", src: state.src,
      enc: $("vla-enc").value, delim: $("vla-delim").value
    });
  }

  function useText(text, name) {
    if (!text || !text.trim()) {
      state.src = null; state.parsed = null;
      $("vla-setup").hidden = true;
      $("vla-result").hidden = true;
      $("vla-opts").hidden = true;
      $("vla-encwarn").hidden = true;
      $("vla-progress").hidden = true;
      var n = $("vla-srcnote");
      n.className = "vla-note";
      n.setAttribute("data-i18n", "tool.src.empty");
      n.textContent = t("tool.src.empty");
      return;
    }
    state.src = { kind: "text", text: text };
    state.srcName = name || "";
    $("vla-opts").hidden = false;
    $("vla-enc").disabled = true;          // 붙여넣기는 이미 디코드된 텍스트다
    $("vla-encwarn").hidden = true;
    startParse();
  }

  function useFile(file) {
    if (!file) return;
    state.src = { kind: "file", file: file };
    state.srcName = file.name || "";
    $("vla-paste").value = "";
    $("vla-opts").hidden = false;
    $("vla-enc").disabled = false;
    startParse();
  }

  /* ---------- 파싱 결과 → 화면 ---------- */

  function headerNames() {
    var p = state.parsed, out = [], i;
    if (!p) return out;
    var h = (state.hasHeader && p.first.length) ? p.first[0] : null;
    for (i = 0; i < p.cols; i++) {
      var name = h && h[i] != null && String(h[i]).trim() !== "" ? String(h[i]).trim() : null;
      out.push(name || t("tool.col", { n: i + 1 }));
    }
    return out;
  }

  function applySavedMap(m, headers) {
    var saved = loadPref("mapNames", null);
    if (!saved) return m;
    var byName = {}, i, k;
    for (i = 0; i < headers.length; i++) byName["#" + normHead(headers[i])] = i;
    for (k in m) {
      if (!m.hasOwnProperty(k) || saved[k] == null) continue;
      if (saved[k] === "") { m[k] = -1; continue; }
      var idx = byName["#" + normHead(saved[k])];
      if (idx != null) m[k] = idx;
    }
    return m;
  }

  function saveMapNames() {
    if (!state.hasHeader) return;   // 헤더가 없으면 이름으로 복원할 수 없다
    var heads = headerNames(), out = {}, k;
    for (k in state.map) {
      if (!state.map.hasOwnProperty(k)) continue;
      out[k] = state.map[k] >= 0 ? heads[state.map[k]] : "";
    }
    savePref("mapNames", out);
  }

  function onParsed(m) {
    state.parsing = false;
    clearTimeout(state.pgTimer);
    $("vla-progress").hidden = true;
    state.parsed = m;
    state.hasHeader = m.hasHeader;
    $("vla-header").checked = m.hasHeader;
    if (!m.total) {
      setSrcNote(t("tool.err.empty"), true);
      $("vla-setup").hidden = true;
      $("vla-result").hidden = true;
      return;
    }
    $("vla-encwarn").hidden = state.src.kind !== "file";
    var rows = m.total - (state.hasHeader ? 1 : 0);
    var note = t("tool.src.loaded", { rows: fmtN(rows), name: state.srcName || t("tool.src.pasted") });
    if (state.src.kind === "file") note += " " + t("tool.enc.detected", { enc: m.enc.toUpperCase() });
    if (m.over) note += " " + t("tool.err.big", { max: fmtN(200000) });
    setSrcNote(note, !!m.over);
    state.map = applySavedMap(vlaAutoMap(headerNames()), headerNames());
    state.purposeMap = loadPref("purpose", {}) || {};
    state.costs = loadPref("vehicles", {}) || {};
    state.months = loadPref("months", 12) || 12;
    $("vla-months").value = String(state.months);
    $("vla-setup").hidden = false;
    renderMap();
    renderPreview();
    requestAgg();
  }

  function renderMap() {
    var g = $("vla-mapgrid");
    g.innerHTML = "";
    var heads = headerNames();
    var fields = ["vehicle", "date", "user", "start", "end", "dist", "purpose"];
    for (var i = 0; i < fields.length; i++) {
      (function (f) {
        var wrap = el("div");
        var id = "vla-map-" + f;
        var lab = el("label", null, t("tool.map." + f));
        lab.setAttribute("for", id);
        var sel = el("select");
        sel.id = id;
        var o0 = el("option", null, t("tool.map.none"));
        o0.value = "-1";
        sel.appendChild(o0);
        for (var c = 0; c < heads.length; c++) {
          var o = el("option", null, heads[c]);
          o.value = String(c);
          sel.appendChild(o);
        }
        sel.value = String(state.map[f]);
        sel.addEventListener("change", function () {
          state.map[f] = parseInt(sel.value, 10);
          saveMapNames();
          requestAgg();
        });
        wrap.appendChild(lab); wrap.appendChild(sel);
        g.appendChild(wrap);
      })(fields[i]);
    }
  }

  function renderPreview() {
    var tb = $("vla-preview");
    tb.innerHTML = "";
    var p = state.parsed;
    if (!p) return;
    var heads = headerNames(), i, c;
    var thead = el("thead"), trh = el("tr");
    for (c = 0; c < heads.length; c++) trh.appendChild(el("th", null, heads[c]));
    thead.appendChild(trh); tb.appendChild(thead);
    var tbody = el("tbody");
    var start = state.hasHeader ? 1 : 0;
    for (i = start; i < p.first.length && i < start + 5; i++) {
      var tr = el("tr");
      for (c = 0; c < heads.length; c++) tr.appendChild(el("td", null, p.first[i][c] != null ? p.first[i][c] : ""));
      tbody.appendChild(tr);
    }
    tb.appendChild(tbody);
  }

  /* ---------- 집계 ---------- */

  function requestAgg() {
    if (!state.parsed) return;
    var res = $("vla-result");
    // 필수 열이 없으면 집계 자체가 불가능하다 — 전 행을 '제외'로 쏟아내지 않고 무엇이 없는지 말한다
    var missing = null;
    if (state.map.purpose < 0) missing = "tool.map.needPurpose";
    else if (state.map.dist < 0 && (state.map.start < 0 || state.map.end < 0)) missing = "tool.map.needDist";
    if (missing) {
      state.agg = null;
      $("vla-purposegrid").innerHTML = "";
      $("vla-purposewarn").hidden = true;
      $("vla-vehicles").innerHTML = "";
      res.hidden = false;
      res.innerHTML = "";
      res.appendChild(el("p", "vla-warn", t(missing)));
      return;
    }
    state.token++;
    engine.send({
      cmd: "agg", token: state.token, skip: state.hasHeader ? 1 : 0,
      map: state.map, purposeMap: state.purposeMap,
      maxExcluded: MAX_EXCLUDED, maxPurpose: MAX_PURPOSE
    });
  }

  function onAgg(m) {
    if (m.token !== state.token) return;   // 낡은 결과 무시
    state.agg = m.result;
    renderPurpose();
    renderVehicles();
    renderResult();
  }

  function renderPurpose() {
    var g = $("vla-purposegrid");
    g.innerHTML = "";
    var vals = state.agg ? state.agg.purposeValues : [];
    var CATS = ["", "biz", "commute", "nonbiz"];
    for (var i = 0; i < vals.length; i++) {
      (function (pv) {
        var wrap = el("div");
        var id = "vla-p-" + i;
        var lab = el("label", null,
          (pv.v === "" ? t("tool.purpose.blank") : pv.v) + " ×" + fmtN(pv.n));
        lab.setAttribute("for", id);
        var sel = el("select");
        sel.id = id;
        for (var c = 0; c < CATS.length; c++) {
          var o = el("option", null, t(CATS[c] ? "tool.purpose." + CATS[c] : "tool.purpose.unset"));
          o.value = CATS[c];
          sel.appendChild(o);
        }
        sel.value = pv.cat || "";
        sel.addEventListener("change", function () {
          if (sel.value) state.purposeMap[pv.key] = sel.value;
          else delete state.purposeMap[pv.key];
          savePref("purpose", state.purposeMap);
          requestAgg();
        });
        wrap.appendChild(lab); wrap.appendChild(sel);
        g.appendChild(wrap);
      })(vals[i]);
    }
    var warn = $("vla-purposewarn");
    var msgs = [];
    if (state.agg && state.agg.needClass) msgs.push(t("tool.purpose.warn", { n: fmtN(state.agg.needClass) }));
    if (state.agg && state.agg.purposeTrunc) msgs.push(t("tool.purpose.trunc", { max: fmtN(MAX_PURPOSE) }));
    warn.textContent = msgs.join(" ");
    warn.hidden = !msgs.length;
  }

  function costOf(id) {
    var c = state.costs["#" + id];
    if (!c) c = state.costs["#" + id] = { dep: "", fuel: "", ins: "", repair: "", tax: "", toll: "", insured: true };
    if (c.insured !== false) c.insured = true;
    return c;
  }

  // 입력 문자열 → 판정용 숫자 묶음. 빈칸은 0 이 아니라 '없음'이다.
  function costNumbers(c) {
    var out = { has: false, insured: c.insured !== false, bad: false };
    for (var i = 0; i < COST_FIELDS.length; i++) {
      var raw = String(c[COST_FIELDS[i]] == null ? "" : c[COST_FIELDS[i]]).trim();
      if (raw === "") { out[COST_FIELDS[i]] = 0; continue; }
      var v = vlaNum(raw);
      if (isNaN(v) || v < 0) { out.bad = true; out[COST_FIELDS[i]] = 0; continue; }
      out[COST_FIELDS[i]] = v;
      out.has = true;
    }
    return out;
  }

  function renderVehicles() {
    var box = $("vla-vehicles");
    box.innerHTML = "";
    if (!state.agg) return;
    var vs = state.agg.vehicles;
    for (var i = 0; i < vs.length; i++) {
      (function (v) {
        var c = costOf(v.id);
        var d = el("details", "vla-veh");
        var sm = el("summary");
        sm.appendChild(document.createTextNode(v.id || t("tool.res.unnamed")));
        sm.appendChild(el("span", "vla-vsum",
          "  " + fmtKm(v.totalKm) + " · " + t("tool.res.rowsN", { n: fmtN(v.rows) })));
        d.appendChild(sm);
        var grid = el("div", "vla-grid");
        for (var f = 0; f < COST_FIELDS.length; f++) {
          (function (key) {
            var wrap = el("div");
            var id = "vla-c-" + i + "-" + key;
            var lab = el("label", null, t("tool.cost." + key));
            lab.setAttribute("for", id);
            var inp = el("input");
            inp.type = "text";
            inp.id = id;
            inp.inputMode = "numeric";
            inp.autocomplete = "off";
            inp.placeholder = t("tool.cost.ph");
            inp.value = c[key] == null ? "" : c[key];
            inp.addEventListener("input", function () {
              c[key] = inp.value;
              savePref("vehicles", state.costs);
              renderResult();
            });
            wrap.appendChild(lab); wrap.appendChild(inp);
            grid.appendChild(wrap);
          })(COST_FIELDS[f]);
        }
        d.appendChild(grid);
        d.appendChild(el("p", "vla-hint", t("tool.cost.depHint")));
        var chk = el("label", "vla-check");
        var cb = el("input");
        cb.type = "checkbox";
        cb.checked = c.insured !== false;
        cb.addEventListener("change", function () {
          c.insured = cb.checked;
          savePref("vehicles", state.costs);
          renderResult();
        });
        chk.appendChild(cb);
        chk.appendChild(el("span", null, t("tool.insured")));
        d.appendChild(chk);
        d.appendChild(el("p", "vla-hint", t("tool.insuredHint")));
        box.appendChild(d);
      })(vs[i]);
    }
  }

  /* ---------- 결과 ---------- */

  function readMonths() {
    var raw = $("vla-months").value.trim();
    var v = vlaNum(raw);
    var bad = raw === "" || isNaN(v) || v < 1 || v > 12 || Math.floor(v) !== v;
    $("vla-monthserr").hidden = !bad;
    if (bad) return state.months;   // 마지막 정상값 유지 — 잘못된 값으로 조용히 계산하지 않는다
    state.months = v;
    savePref("months", v);
    return v;
  }

  function renderResult() {
    var res = $("vla-result");
    if (!state.agg) return;
    var months = readMonths();
    var vs = state.agg.vehicles;
    var rows = [], i;
    var sum = { totalKm: 0, bizKm: 0, cost: 0, deduct: 0, disallow: 0, carry: 0, noLog: 0, hasCost: false, gated: 0 };
    var anyComputable = false;
    for (i = 0; i < vs.length; i++) {
      var c = costNumbers(costOf(vs[i].id));
      var r = vlaVehicleResult(vs[i], c.has ? c : { has: false, insured: c.insured }, months);
      rows.push({ v: vs[i], r: r, bad: c.bad });
      sum.totalKm += vs[i].totalKm;
      sum.bizKm += vs[i].bizKm;
      if (r.gated) sum.gated++;
      if (r.cost != null) { sum.cost += r.cost; sum.hasCost = true; }
      if (r.withLog) {
        sum.deduct += r.withLog.deduct;
        sum.disallow += r.withLog.disallow;
        sum.carry += r.withLog.carry;
        sum.noLog += r.noLog.deduct;
        anyComputable = true;
      }
    }
    state.results = { rows: rows, sum: sum, months: months, anyComputable: anyComputable };

    res.hidden = false;
    res.innerHTML = "";

    // 헤드라인 — 비용이 있으면 손금산입 합계, 없으면 전체 업무사용비율
    var hl = el("div");
    if (anyComputable) {
      hl.appendChild(el("p", "vla-headline", t("tool.res.hlDeduct")));
      hl.appendChild(el("div", "vla-big", fmtKrw(sum.deduct)));
    } else {
      hl.appendChild(el("p", "vla-headline", t("tool.res.hlRatio")));
      hl.appendChild(el("div", "vla-big", sum.totalKm > 0 ? fmtPct(sum.bizKm / sum.totalKm) : "—"));
    }
    res.appendChild(hl);

    if (sum.gated) {
      res.appendChild(el("p", "vla-gate", t("tool.res.gate", { n: fmtN(sum.gated) })));
    }

    var counts = el("p", "vla-hint", t("tool.res.counts", {
      read: fmtN(state.agg.read), counted: fmtN(state.agg.counted), excluded: fmtN(state.agg.read - state.agg.counted)
    }));
    counts.setAttribute("role", "status");
    res.appendChild(counts);

    // 차량별 요약표
    var wrap = el("div", "vla-tablewrap");
    var tbl = el("table");
    var head = ["vehicle", "totalKm", "bizKm", "ratio", "cost", "deduct", "disallow", "carry"];
    var thead = el("thead"), trh = el("tr");
    for (i = 0; i < head.length; i++) {
      var th = el("th", i ? "num" : null, t("tool.res." + head[i]));
      trh.appendChild(th);
    }
    thead.appendChild(trh); tbl.appendChild(thead);
    var tbody = el("tbody");
    for (i = 0; i < rows.length; i++) {
      var row = rows[i], r = row.r, tr = el("tr");
      tr.appendChild(el("td", null, row.v.id || t("tool.res.unnamed")));
      tr.appendChild(el("td", "num", fmtKm(row.v.totalKm)));
      tr.appendChild(el("td", "num", fmtKm(row.v.bizKm)));
      if (r.ratio == null) {
        tr.appendChild(el("td", "num", "—"));
        var td = el("td", "is-soft", t("tool.res.noDrive"));
        td.colSpan = 4;
        tr.appendChild(td);
      } else {
        tr.appendChild(el("td", "num", fmtPct(r.ratio)));
        if (r.cost == null) {
          var td2 = el("td", "is-soft", row.bad ? t("tool.cost.bad") : t("tool.res.noCost"));
          td2.colSpan = 4;
          tr.appendChild(td2);
        } else {
          tr.appendChild(el("td", "num", fmtKrw(r.cost)));
          tr.appendChild(el("td", "num", fmtKrw(r.withLog.deduct)));
          tr.appendChild(el("td", "num", fmtKrw(r.withLog.disallow)));
          tr.appendChild(el("td", "num", r.withLog.carry > 0 ? fmtKrw(r.withLog.carry) : "—"));
        }
      }
      tbody.appendChild(tr);
    }
    if (rows.length > 1) {
      var trt = el("tr", "is-total");
      trt.appendChild(el("td", null, t("tool.res.total")));
      trt.appendChild(el("td", "num", fmtKm(sum.totalKm)));
      trt.appendChild(el("td", "num", fmtKm(sum.bizKm)));
      trt.appendChild(el("td", "num", sum.totalKm > 0 ? fmtPct(sum.bizKm / sum.totalKm) : "—"));
      trt.appendChild(el("td", "num", sum.hasCost ? fmtKrw(sum.cost) : "—"));
      trt.appendChild(el("td", "num", anyComputable ? fmtKrw(sum.deduct) : "—"));
      trt.appendChild(el("td", "num", anyComputable ? fmtKrw(sum.disallow) : "—"));
      trt.appendChild(el("td", "num", anyComputable && sum.carry > 0 ? fmtKrw(sum.carry) : "—"));
      tbody.appendChild(trt);
    }
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    res.appendChild(wrap);

    // 기록부 작성 vs 미작성 비교
    var cmp = el("div", "vla-cmp");
    cmp.appendChild(el("p", "vla-headline", t("tool.cmp.title")));
    if (!anyComputable) {
      cmp.appendChild(el("p", "vla-hint", t("tool.cmp.none")));
    } else {
      var max = Math.max(sum.deduct, sum.noLog, 1);
      cmp.appendChild(cmpRow("tool.cmp.withLog", sum.deduct, max, false));
      cmp.appendChild(cmpRow("tool.cmp.noLog", sum.noLog, max, true));
      var diff = sum.deduct - sum.noLog;
      cmp.appendChild(el("p", "vla-hint",
        diff > 0.5 ? t("tool.cmp.diff", { amount: fmtKrw(diff) })
          : (diff < -0.5 ? t("tool.cmp.worse", { amount: fmtKrw(-diff) }) : t("tool.cmp.same"))));
    }
    res.appendChild(cmp);

    // 제외된 행
    if (state.agg.excluded.length) {
      var det = el("details", "vla-excl");
      det.appendChild(el("summary", null,
        t("tool.excl.title", { n: fmtN(state.agg.read - state.agg.counted) })));
      var ew = el("div", "vla-tablewrap");
      var et = el("table"), eh = el("thead"), ehr = el("tr");
      var ehead = ["row", "reason", "value"];
      for (i = 0; i < ehead.length; i++) ehr.appendChild(el("th", null, t("tool.excl." + ehead[i])));
      eh.appendChild(ehr); et.appendChild(eh);
      var eb = el("tbody");
      for (i = 0; i < state.agg.excluded.length; i++) {
        var x = state.agg.excluded[i], xtr = el("tr");
        xtr.appendChild(el("td", "num", fmtN(x.n)));
        xtr.appendChild(el("td", null, t("tool.r." + x.reason)));
        xtr.appendChild(el("td", null, x.val || "—"));
        eb.appendChild(xtr);
      }
      et.appendChild(eb); ew.appendChild(et); det.appendChild(ew);
      if (state.agg.read - state.agg.counted > state.agg.excluded.length) {
        det.appendChild(el("p", "vla-hint", t("tool.excl.more", { n: fmtN(MAX_EXCLUDED) })));
      }
      res.appendChild(det);
    }

    // 내보내기
    var acts = el("div", "vla-actions");
    var bcsv = el("button", "btn", t("tool.export.csv"));
    bcsv.type = "button";
    bcsv.addEventListener("click", exportCsv);
    var bcopy = el("button", "vla-mini", t("tool.export.copy"));
    bcopy.type = "button";
    bcopy.addEventListener("click", copySummary);
    var st = el("span", "vla-status");
    st.id = "vla-copystatus";
    st.setAttribute("role", "status");
    acts.appendChild(bcsv); acts.appendChild(bcopy); acts.appendChild(st);
    res.appendChild(acts);
    res.appendChild(el("p", "vla-hint", t("tool.saved")));
  }

  function cmpRow(labelKey, value, max, dim) {
    var row = el("div", "vla-cmprow");
    row.appendChild(el("span", "vla-cmplab", t(labelKey)));
    var track = el("div", "vla-cmptrack" + (dim ? " is-dim" : ""));
    var fill = el("span");
    fill.style.width = Math.max(0, Math.min(100, value / max * 100)) + "%";
    track.appendChild(fill);
    track.setAttribute("role", "img");
    track.setAttribute("aria-label", t(labelKey) + ": " + fmtKrw(value));
    row.appendChild(track);
    row.appendChild(el("span", "vla-cmpval", fmtKrw(value)));
    return row;
  }

  /* ---------- 내보내기 ---------- */

  function status(msg) {
    var s = $("vla-copystatus");
    if (!s) return;
    s.textContent = msg;
    setTimeout(function () { if (s.textContent === msg) s.textContent = ""; }, 2600);
  }

  function exportCsv() {
    if (!state.parsed) return;
    engine.send({ cmd: "export", skip: state.hasHeader ? 1 : 0, map: state.map, purposeMap: state.purposeMap });
  }

  function onExport(m) {
    var csv = m.csv;
    var r = state.results;
    if (r) {
      var lines = ["", "차량,과세기간 총주행거리(km),업무용 사용거리(km),업무사용비율(%),관련비용(원),손금산입액(원),손금불산입액(원),감가상각비 이월액(원)"];
      for (var i = 0; i < r.rows.length; i++) {
        var row = r.rows[i], x = row.r;
        lines.push([
          vlaCsvCell(row.v.id || "차량 미지정"),
          row.v.totalKm, row.v.bizKm,
          x.ratio == null ? "" : (x.ratio * 100).toFixed(1),
          x.cost == null ? "" : x.cost,
          x.withLog ? Math.round(x.withLog.deduct) : "",
          x.withLog ? Math.round(x.withLog.disallow) : "",
          x.withLog ? Math.round(x.withLog.carry) : ""
        ].join(","));
      }
      csv += "\r\n" + lines.join("\r\n");
    }
    var name = "vehicle-log-agg-" + new Date().toISOString().slice(0, 10) + ".csv";
    try {
      // UTF-8 BOM — 이게 없으면 한국어 엑셀이 CP949 로 열어 전부 깨진다
      var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = el("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) {
      status(t("tool.export.fail"));
    }
  }

  function copySummary() {
    var r = state.results;
    if (!r) return;
    var head = ["vehicle", "totalKm", "bizKm", "ratio", "cost", "deduct", "disallow", "carry"], i;
    var out = [];
    for (i = 0; i < head.length; i++) head[i] = t("tool.res." + head[i]);
    out.push(head.join("\t"));
    for (i = 0; i < r.rows.length; i++) {
      var row = r.rows[i], x = row.r;
      out.push([
        row.v.id || t("tool.res.unnamed"),
        Math.round(row.v.totalKm * 10) / 10,
        Math.round(row.v.bizKm * 10) / 10,
        x.ratio == null ? t("tool.res.noDrive") : fmtPct(x.ratio),
        x.cost == null ? t("tool.res.noCost") : Math.round(x.cost),
        x.withLog ? Math.round(x.withLog.deduct) : "",
        x.withLog ? Math.round(x.withLog.disallow) : "",
        x.withLog ? Math.round(x.withLog.carry) : ""
      ].join("\t"));
    }
    var text = out.join("\n");
    function ok() { status(t("tool.export.copied")); }
    function legacy() {
      try {
        var ta = el("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var done = document.execCommand("copy");
        document.body.removeChild(ta);
        if (done) ok(); else status(t("tool.export.fail"));
      } catch (e) { status(t("tool.export.fail")); }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok, legacy);
      } else legacy();
    } catch (e) { legacy(); }
  }

  /* ---------- 엔진 메시지 ---------- */

  engine.on(function (m) {
    if (!m) return;
    if (m.type === "progress") {
      $("vla-pfill").style.width = m.pct + "%";
      $("vla-ptext").textContent = t("tool.progress", { rows: fmtN(m.rows) });
      if (m.rows > 3000 && state.parsing) $("vla-progress").hidden = false;
      return;
    }
    if (m.type === "parsed") { onParsed(m); return; }
    if (m.type === "agg") { onAgg(m); return; }
    if (m.type === "export") { onExport(m); return; }
    if (m.type === "error") {
      state.parsing = false;
      clearTimeout(state.pgTimer);
      $("vla-progress").hidden = true;
      setSrcNote(t("tool.err.read"), true);
    }
  });

  /* ---------- 이벤트 배선 ---------- */

  var pasteTimer = null;
  $("vla-paste").addEventListener("input", function () {
    clearTimeout(pasteTimer);
    var v = $("vla-paste").value;
    pasteTimer = setTimeout(function () { useText(v, ""); }, 260);
  });
  $("vla-pick").addEventListener("click", function () { $("vla-file").click(); });
  $("vla-file").addEventListener("change", function () {
    if (this.files && this.files[0]) useFile(this.files[0]);
  });
  $("vla-sample").addEventListener("click", function () {
    $("vla-paste").value = SAMPLE;
    useText(SAMPLE, "");
  });
  $("vla-clear").addEventListener("click", function () {
    $("vla-paste").value = "";
    $("vla-file").value = "";
    engine.reset();
    state.parsing = false;
    clearTimeout(state.pgTimer);
    useText("", "");
  });
  $("vla-cancel").addEventListener("click", function () {
    engine.reset();
    state.parsing = false;
    clearTimeout(state.pgTimer);
    $("vla-progress").hidden = true;
    setSrcNote(t("tool.err.cancelled"), true);
    $("vla-setup").hidden = true;
    $("vla-result").hidden = true;
  });
  $("vla-header").addEventListener("change", function () {
    state.hasHeader = this.checked;
    renderMap();
    renderPreview();
    requestAgg();
  });
  $("vla-enc").addEventListener("change", function () {
    if (state.src && state.src.kind === "file") startParse();
  });
  $("vla-delim").addEventListener("change", function () { if (state.src) startParse(); });
  $("vla-months").addEventListener("input", function () { if (state.agg) renderResult(); });

  var drop = $("vla-drop");
  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) {
      e.preventDefault();
      e.stopPropagation();
      drop.classList.add("is-over");
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (ev === "dragleave" && drop.contains(e.relatedTarget)) return;
      drop.classList.remove("is-over");
    });
  });
  drop.addEventListener("drop", function (e) {
    var dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) useFile(dt.files[0]);
  });

  // 언어 전환 — JS 로 만든 부분은 카탈로그가 아니라 이 함수들이 그린다. 값은 state 에 있으니 그대로 다시 그린다.
  document.addEventListener("i18n:change", function () {
    if (!state.parsed) return;
    renderMap();
    renderPreview();
    renderPurpose();
    renderVehicles();
    if (state.agg) renderResult();
  });
  // TOOLJS:END
})();
