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
  // ovulation-calc — 황체기 14일 기준 배란일·가임기 예측 (spec: factory/state/ovulation-calc.yaml)
  // 상태: localStorage "ovulation-calc:last" (마지막 생리일·주기). 외부 API 없음 — 전부 로컬 계산.
  var cfg = window.APP_CONFIG || {};
  var STORE_KEY = (cfg.slug || "ovulation-calc") + ":last";

  /* ---- 상수 (spec 고정값) ---- */
  var LUTEAL = 14;         // 황체기: 다음 생리 예정일 − 14일 = 배란 예정일
  var FERTILE_BEFORE = 5;  // 가임기 시작: 배란 −5일 (정자 생존)
  var FERTILE_AFTER = 1;   // 가임기 끝:  배란 +1일 (난자 생존)
  var ROLL_AFTER = 60;     // 60일 이상 과거면 다가오는 주기로 순방향 롤
  var OLD_DAYS = 365;      // 1년 이상 과거면 경고 (계산은 수행)
  var CYCLE_MIN = 21, CYCLE_MAX = 45;
  var CYCLES = 3;          // 향후 3주기

  /* ---- i18n 헬퍼 ---- */
  function t(key) {
    var s = window.I18N && window.I18N.t(key);
    return (s != null) ? s : key;
  }
  function fmt(s, params) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return (params && params[k] != null) ? String(params[k]) : m;
    });
  }
  function escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function curLang() {
    var l = window.I18N && window.I18N.lang();
    return l || "en";
  }

  /* ================= 순수 날짜 코어 (Date 객체 일 단위 가산 — 문자열 연산 없음) ================= */
  /** "YYYY-MM-DD" → 로컬 자정 Date. 실재하지 않는 날짜(2월 30일 등)는 null.
   *  new Date("YYYY-MM-DD") 는 UTC 자정으로 해석돼 시간대에 따라 하루 밀리므로 쓰지 않는다. */
  function parseISO(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ""));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var dt = new Date(y, mo - 1, d);
    // 롤오버 검증: 2026-02-30 → 3월 2일이 되므로 되돌려 확인 (윤년도 이 검사로 걸러진다)
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return dt;
  }
  function isoOf(dt) {
    var m = dt.getMonth() + 1, d = dt.getDate();
    return dt.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (d < 10 ? "0" + d : d);
  }
  /** 일 단위 가산 — 월 경계·윤년·연도 경계를 Date 가 알아서 처리한다 */
  function addDays(dt, n) {
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n);
  }
  /** a → b 의 정수 일수. 로컬 자정 기준 + 반올림이라 DST(23·25시간 날)도 안전 */
  function dayDiff(a, b) {
    var ms = new Date(b.getFullYear(), b.getMonth(), b.getDate()) -
             new Date(a.getFullYear(), a.getMonth(), a.getDate());
    return Math.round(ms / 86400000);
  }
  function startOfToday() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }
  function sameDay(a, b) { return dayDiff(a, b) === 0; }

  /** 핵심 계산. lmp(마지막 생리 시작일), cycle(주기 일수), today → 향후 CYCLES 주기.
   *  lmp 가 ROLL_AFTER 일 이상 과거면 다음 생리 예정일이 오늘 이후가 될 때까지 주기를 순방향으로 굴린다. */
  function computeCycles(lmp, cycle, today) {
    var anchor = lmp, rolled = false;
    if (dayDiff(lmp, today) >= ROLL_AFTER) {
      var guard = 0;
      // addDays(anchor, cycle) 가 오늘보다 과거인 동안 계속 롤 (오늘 당일이면 멈춘다)
      while (dayDiff(addDays(anchor, cycle), today) > 0 && guard < 4000) {
        anchor = addDays(anchor, cycle);
        rolled = true;
        guard++;
      }
    }
    var list = [];
    for (var k = 1; k <= CYCLES; k++) {
      var period = addDays(anchor, cycle * k);
      var ovul = addDays(period, -LUTEAL);
      list.push({
        index: k,
        period: period,
        ovulation: ovul,
        fertileStart: addDays(ovul, -FERTILE_BEFORE),
        fertileEnd: addDays(ovul, FERTILE_AFTER)
      });
    }
    return { anchor: anchor, rolled: rolled, cycles: list };
  }

  /* ---- 노출 (node 단위 검증용) ---- */
  if (typeof module === "object" && module.exports) {
    module.exports = { parseISO: parseISO, addDays: addDays, dayDiff: dayDiff, computeCycles: computeCycles, isoOf: isoOf };
  }

  /* ================= 표시 포맷 (Intl — 실패 시 ISO 폴백) ================= */
  function fmtDate(dt) {
    try {
      return new Intl.DateTimeFormat(curLang(), {
        year: "numeric", month: "short", day: "numeric", weekday: "short"
      }).format(dt);
    } catch (e) { return isoOf(dt); }
  }
  function fmtShort(dt) {
    try {
      return new Intl.DateTimeFormat(curLang(), { month: "short", day: "numeric" }).format(dt);
    } catch (e) { return isoOf(dt); }
  }
  function fmtMonth(dt) {
    try {
      return new Intl.DateTimeFormat(curLang(), { year: "numeric", month: "long" }).format(dt);
    } catch (e) { return dt.getFullYear() + "-" + (dt.getMonth() + 1); }
  }
  function weekdayNames() {
    var out = [];
    try {
      var f = new Intl.DateTimeFormat(curLang(), { weekday: "short" });
      // 1970-01-04 는 일요일 — 일요일 시작 7칸
      for (var i = 0; i < 7; i++) out.push(f.format(new Date(1970, 0, 4 + i)));
    } catch (e) { out = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; }
    return out;
  }
  function relLabel(dt, today) {
    var d = dayDiff(today, dt);
    if (d === 0) return t("tool.rel.today");
    if (d === 1) return t("tool.rel.tomorrow");
    if (d === -1) return t("tool.rel.yesterday");
    if (d > 0) return fmt(t("tool.rel.inDays"), { n: d });
    return fmt(t("tool.rel.daysAgo"), { n: -d });
  }

  /* ================= DOM ================= */
  var els = {
    lmp: document.getElementById("ov-lmp"),
    cycle: document.getElementById("ov-cycle"),
    calc: document.getElementById("ov-calc"),
    clear: document.getElementById("ov-clear"),
    status: document.getElementById("ov-status"),
    result: document.getElementById("ov-result"),
    extra: document.getElementById("ov-extra"),
    prev: document.getElementById("ov-prev"),
    next: document.getElementById("ov-next"),
    calMonth: document.getElementById("ov-calmonth"),
    cal: document.getElementById("ov-cal"),
    tbl: document.getElementById("ov-tbl")
  };
  if (!els.lmp || !els.cycle || !els.result) return; // 도구 마크업이 없으면 조용히 종료 (셸만 있는 페이지)

  var lastResult = null;  // 마지막 성공 계산 {anchor, rolled, cycles}
  var calOffset = 0;      // 기준월(가임기 달) 대비 표시 월 오프셋

  /* ---- 상태 저장/복원: localStorage 만 (URL 파라미터에는 담지 않는다 — 민감 정보 링크 유출 방지) ---- */
  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ lmp: els.lmp.value, cycle: els.cycle.value }));
    } catch (e) { /* private mode — 저장만 실패, 계산은 계속된다 */ }
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (o && typeof o.lmp === "string" && parseISO(o.lmp)) els.lmp.value = o.lmp;
      if (o && o.cycle != null && String(o.cycle) !== "") els.cycle.value = String(o.cycle);
    } catch (e) { /* 손상된 값은 무시하고 기본값으로 시작 */ }
  }

  /* ---- 결과 출력 ---- */
  function showMsg(text, isError) {
    els.result.innerHTML = '<p class="' + (isError ? "ov-err" : "ov-msg") + '">' + escHtml(text) + "</p>";
    els.extra.hidden = true;
    lastResult = null;
  }
  function card(labelKey, dateText, relText, isKey) {
    return '<div class="ov-card' + (isKey ? " is-key" : "") + '">' +
      "<b>" + escHtml(t(labelKey)) + "</b>" +
      '<span class="ov-date">' + escHtml(dateText) + "</span>" +
      '<em class="ov-rel">' + escHtml(relText) + "</em>" +
      "</div>";
  }

  function render(resetCal) {
    if (resetCal) calOffset = 0;
    var today = startOfToday();

    // 1) 마지막 생리 시작일 — 빈 입력 / 형식 오류 / 미래 날짜
    var lmpRaw = els.lmp.value;
    if (!lmpRaw) { showMsg(t("tool.err.noDate"), false); return; }
    var lmp = parseISO(lmpRaw);
    if (!lmp) { showMsg(t("tool.err.invalidDate"), true); return; }
    if (dayDiff(lmp, today) < 0) { showMsg(t("tool.err.future"), true); return; }

    // 2) 주기 — 빈 값 / 비정수 / 범위 밖(21~45)
    var cycleRaw = String(els.cycle.value).trim();
    if (cycleRaw === "") { showMsg(t("tool.err.cycleEmpty"), true); return; }
    var cycle = Number(cycleRaw);
    if (!isFinite(cycle)) { showMsg(t("tool.err.cycleInt"), true); return; }
    if (Math.floor(cycle) !== cycle) { showMsg(t("tool.err.cycleInt"), true); return; }
    if (cycle < CYCLE_MIN || cycle > CYCLE_MAX) { showMsg(t("tool.err.cycleRange"), true); return; }

    // 3) 계산
    var res = computeCycles(lmp, cycle, today);
    lastResult = res;
    var c1 = res.cycles[0];

    // 4) 경고 배너 (계산은 수행하되 신뢰도를 알린다)
    var html = "";
    var age = dayDiff(lmp, today);
    if (age >= OLD_DAYS) html += '<p class="ov-warn">' + escHtml(t("tool.warn.old")) + "</p>";
    if (res.rolled) html += '<p class="ov-warn">' + escHtml(t("tool.warn.rolled")) + "</p>";

    // 5) 결과 카드 3개
    var windowLen = dayDiff(c1.fertileStart, c1.fertileEnd) + 1;
    html += '<div class="ov-cards">' +
      card("tool.r.ovulation", fmtDate(c1.ovulation), relLabel(c1.ovulation, today), true) +
      card("tool.r.fertile",
           fmtShort(c1.fertileStart) + " – " + fmtShort(c1.fertileEnd),
           fmt(t("tool.r.windowLen"), { n: windowLen }), false) +
      card("tool.r.nextPeriod", fmtDate(c1.period), relLabel(c1.period, today), false) +
      "</div>";
    els.result.innerHTML = html;

    els.extra.hidden = false;
    drawCalendar();
    drawTable();
  }

  /* ---- 달력: 생리 시작일(빨강)·가임기(연분홍)·배란일(진분홍)·오늘(테두리) ---- */
  function markOf(day, res, lmp) {
    var mark = { period: false, fertile: false, ovul: false, labels: [] };
    if (lmp && sameDay(day, lmp)) { mark.period = true; mark.labels.push(t("tool.legend.period")); }
    for (var i = 0; i < res.cycles.length; i++) {
      var c = res.cycles[i];
      if (sameDay(day, c.period)) { mark.period = true; mark.labels.push(t("tool.legend.period")); }
      if (dayDiff(c.fertileStart, day) >= 0 && dayDiff(day, c.fertileEnd) >= 0) {
        mark.fertile = true; mark.labels.push(t("tool.legend.fertile"));
      }
      if (sameDay(day, c.ovulation)) { mark.ovul = true; mark.labels.push(t("tool.legend.ovulation")); }
    }
    return mark;
  }
  function drawCalendar() {
    var res = lastResult;
    if (!res) return;
    var today = startOfToday();
    var lmp = parseISO(els.lmp.value);
    var base = res.cycles[0].ovulation;                                  // 기준월 = 다가오는 배란일의 달
    var first = new Date(base.getFullYear(), base.getMonth() + calOffset, 1);
    els.calMonth.textContent = fmtMonth(first);

    var names = weekdayNames();
    var head = "<thead><tr>";
    for (var w = 0; w < 7; w++) head += '<th scope="col">' + escHtml(names[w]) + "</th>";
    head += "</tr></thead>";

    var daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    var lead = first.getDay();                                           // 일요일 시작
    var body = "<tbody><tr>";
    var col = 0, i;
    for (i = 0; i < lead; i++) { body += '<td><span class="ov-day is-blank" aria-hidden="true"></span></td>'; col++; }
    for (var d = 1; d <= daysInMonth; d++) {
      if (col === 7) { body += "</tr><tr>"; col = 0; }
      var day = new Date(first.getFullYear(), first.getMonth(), d);
      var m = markOf(day, res, lmp);
      var cls = "ov-day";
      if (m.fertile) cls += " is-fertile";
      if (m.ovul) cls += " is-ovul";
      if (m.period) cls += " is-period";
      if (sameDay(day, today)) { cls += " is-today"; m.labels.push(t("tool.legend.today")); }
      var title = m.labels.length ? ' title="' + escHtml(m.labels.join(" · ")) + '"' : "";
      var sr = m.labels.length ? '<span class="ov-sr">' + escHtml(" (" + m.labels.join(", ") + ")") + "</span>" : "";
      body += '<td><span class="' + cls + '"' + title + ">" + d + sr + "</span></td>";
      col++;
    }
    while (col < 7 && col > 0) { body += '<td><span class="ov-day is-blank" aria-hidden="true"></span></td>'; col++; }
    body += "</tr></tbody>";
    els.cal.innerHTML = head + body;
  }

  /* ---- 향후 3주기 표 ---- */
  function drawTable() {
    var res = lastResult;
    if (!res) return;
    var h = "<thead><tr>" +
      '<th scope="col">' + escHtml(t("tool.tbl.cycle")) + "</th>" +
      '<th scope="col">' + escHtml(t("tool.tbl.period")) + "</th>" +
      '<th scope="col">' + escHtml(t("tool.tbl.ovulation")) + "</th>" +
      '<th scope="col">' + escHtml(t("tool.tbl.fertile")) + "</th>" +
      "</tr></thead><tbody>";
    for (var i = 0; i < res.cycles.length; i++) {
      var c = res.cycles[i];
      h += "<tr>" +
        '<th scope="row">' + escHtml(fmt(t("tool.tbl.cycleN"), { n: c.index })) + "</th>" +
        "<td>" + escHtml(fmtShort(c.period)) + "</td>" +
        "<td>" + escHtml(fmtShort(c.ovulation)) + "</td>" +
        "<td>" + escHtml(fmtShort(c.fertileStart) + " – " + fmtShort(c.fertileEnd)) + "</td>" +
        "</tr>";
    }
    els.tbl.innerHTML = h + "</tbody>";
  }

  /* ---- 상태 문구 ---- */
  var statusTimer = null;
  function flash(text) {
    els.status.textContent = text;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { els.status.textContent = ""; }, 2600);
  }

  /* ================= 이벤트 ================= */
  els.lmp.max = isoOf(startOfToday());   // 브라우저 피커에서도 미래 날짜를 막는다 (JS 검증은 별도 유지)
  els.lmp.addEventListener("input", function () { render(true); saveState(); });
  els.cycle.addEventListener("input", function () { render(true); saveState(); });
  if (els.calc) els.calc.addEventListener("click", function () { render(true); saveState(); });
  if (els.clear) {
    els.clear.addEventListener("click", function () {
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* noop */ }
      els.lmp.value = "";
      els.cycle.value = "28";
      calOffset = 0;
      render(true);
      flash(t("tool.cleared"));
    });
  }
  if (els.prev) els.prev.addEventListener("click", function () { calOffset--; drawCalendar(); });
  if (els.next) els.next.addEventListener("click", function () { calOffset++; drawCalendar(); });
  document.addEventListener("i18n:change", function () { render(false); });

  loadState();
  render(true);
  // TOOLJS:END
})();
