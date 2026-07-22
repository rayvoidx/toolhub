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
  // period-calc — 마지막 생리 시작일 + 평균 주기 + 생리 기간으로 다음 6주기의
  // 생리 예정일·추정 배란일·가임기를 계산한다. 외부 API 없음, 전부 로컬 계산.
  var cfg = window.APP_CONFIG || {};
  var STORE_KEY = (cfg.slug || "period-calc") + ":state";

  /* ---- 상수 ---- */
  var LUTEAL = 14;          // 황체기: 다음 생리 예정일 − 14일 = 배란 예정일
  var FERTILE_BEFORE = 5;   // 가임기 시작: 배란 −5일 (정자 생존)
  var FERTILE_AFTER = 1;    // 가임기 끝:  배란 +1일 (난자 생존)
  var ROLL_AFTER = 60;      // 60일 이상 과거면 다가오는 주기로 순방향 롤
  var OLD_DAYS = 365;       // 1년 이상 과거면 경고 (계산은 수행)
  var CYCLE_MIN = 21, CYCLE_MAX = 45;
  var LENGTH_MIN = 2, LENGTH_MAX = 10;
  var CYCLES = 6;           // 향후 6주기

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
  /** "YYYY-MM-DD" → 로컬 자정 Date. 실재하지 않는 날짜(2월 30일 등)는 null. */
  function parseISO(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ""));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var dt = new Date(y, mo - 1, d);
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
  /** a → b 의 정수 일수 */
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

  /** 핵심 계산. start(마지막 생리 시작일), cycleLen(평균 주기), periodLen(생리 기간), today
   *  → 향후 CYCLES(6)주기의 생리 시작/종료일·배란일·가임기.
   *  start 가 ROLL_AFTER 일 이상 과거면 다음 생리 예정일이 오늘 이후가 될 때까지 주기를 순방향으로 굴린다. */
  function computeCycles(start, cycleLen, periodLen, today) {
    var anchor = start, rolled = false;
    if (dayDiff(start, today) >= ROLL_AFTER) {
      var guard = 0;
      while (dayDiff(addDays(anchor, cycleLen), today) > 0 && guard < 4000) {
        anchor = addDays(anchor, cycleLen);
        rolled = true;
        guard++;
      }
    }
    var list = [];
    for (var k = 1; k <= CYCLES; k++) {
      var pStart = addDays(anchor, cycleLen * k);
      var pEnd = addDays(pStart, periodLen - 1);
      var ovul = addDays(pStart, -LUTEAL);
      list.push({
        index: k,
        periodStart: pStart,
        periodEnd: pEnd,
        ovulation: ovul,
        fertileStart: addDays(ovul, -FERTILE_BEFORE),
        fertileEnd: addDays(ovul, FERTILE_AFTER)
      });
    }
    return { anchor: anchor, rolled: rolled, cycles: list };
  }

  /** 오늘이 속한 주기를 찾아 현재 단계(period/ovulation/fertile/regular)를 판정한다.
   *  computeCycles 의 60일 롤과 무관하게, "오늘을 포함하는 주기"를 직접 역산한다. */
  function currentPhase(start, cycleLen, periodLen, today) {
    var diff = dayDiff(start, today);
    if (diff < 0) return null;
    var elapsed = Math.floor(diff / cycleLen);
    var curStart = addDays(start, cycleLen * elapsed);
    var curEnd = addDays(curStart, periodLen - 1);
    var nextStart = addDays(curStart, cycleLen);
    var ovul = addDays(nextStart, -LUTEAL);
    var fStart = addDays(ovul, -FERTILE_BEFORE);
    var fEnd = addDays(ovul, FERTILE_AFTER);

    if (dayDiff(curStart, today) >= 0 && dayDiff(today, curEnd) >= 0) {
      return { phase: "period", day: dayDiff(curStart, today) + 1, total: periodLen, nextStart: nextStart };
    }
    if (sameDay(today, ovul)) {
      return { phase: "ovulation", nextStart: nextStart };
    }
    if (dayDiff(fStart, today) >= 0 && dayDiff(today, fEnd) >= 0) {
      return { phase: "fertile", nextStart: nextStart };
    }
    return { phase: "regular", daysToNext: dayDiff(today, nextStart), nextStart: nextStart };
  }

  /* ---- 노출 (node 단위 검증용) ---- */
  if (typeof module === "object" && module.exports) {
    module.exports = {
      parseISO: parseISO, addDays: addDays, dayDiff: dayDiff, isoOf: isoOf,
      computeCycles: computeCycles, currentPhase: currentPhase
    };
    return;
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
    start: document.getElementById("pc-start"),
    cycle: document.getElementById("pc-cycle"),
    length: document.getElementById("pc-length"),
    calc: document.getElementById("pc-calc"),
    clear: document.getElementById("pc-clear"),
    status: document.getElementById("pc-status"),
    result: document.getElementById("pc-result"),
    extra: document.getElementById("pc-extra"),
    tbl: document.getElementById("pc-tbl")
  };
  if (!els.start || !els.cycle || !els.length || !els.result) return; // 마크업이 없으면 조용히 종료

  /* ---- 상태 저장/복원: localStorage 만 (URL 파라미터에는 담지 않는다 — 민감 정보 링크 유출 방지) ---- */
  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        start: els.start.value, cycle: els.cycle.value, length: els.length.value
      }));
    } catch (e) { /* private mode — 저장만 실패, 계산은 계속된다 */ }
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (o && typeof o.start === "string" && parseISO(o.start)) els.start.value = o.start;
      if (o && o.cycle != null && String(o.cycle) !== "") els.cycle.value = String(o.cycle);
      if (o && o.length != null && String(o.length) !== "") els.length.value = String(o.length);
    } catch (e) { /* 손상된 값은 무시하고 기본값으로 시작 */ }
  }

  /* ---- 결과 출력 ---- */
  function showMsg(text, isError) {
    els.result.innerHTML = '<p class="' + (isError ? "pc-err" : "pc-msg") + '">' + escHtml(text) + "</p>";
    els.extra.hidden = true;
  }
  function card(labelKey, dateText, relText, isKey) {
    return '<div class="pc-card' + (isKey ? " is-key" : "") + '">' +
      "<b>" + escHtml(t(labelKey)) + "</b>" +
      '<span class="pc-date">' + escHtml(dateText) + "</span>" +
      '<em class="pc-rel">' + escHtml(relText) + "</em>" +
      "</div>";
  }
  function statusText(ph) {
    if (!ph) return "";
    if (ph.phase === "period") return fmt(t("tool.status.period"), { day: ph.day, total: ph.total });
    if (ph.phase === "ovulation") return t("tool.status.ovulation");
    if (ph.phase === "fertile") return t("tool.status.fertile");
    return fmt(t("tool.status.regular"), { n: ph.daysToNext });
  }

  function render() {
    var today = startOfToday();

    // 1) 마지막 생리 시작일 — 빈 입력 / 형식 오류 / 미래 날짜
    var startRaw = els.start.value;
    if (!startRaw) { showMsg(t("tool.err.noDate"), false); return; }
    var start = parseISO(startRaw);
    if (!start) { showMsg(t("tool.err.invalidDate"), true); return; }
    if (dayDiff(start, today) < 0) { showMsg(t("tool.err.future"), true); return; }

    // 2) 평균 주기 — 빈 값 / 비정수 / 범위 밖(21~45)
    var cycleRaw = String(els.cycle.value).trim();
    if (cycleRaw === "") { showMsg(t("tool.err.cycleEmpty"), true); return; }
    var cycle = Number(cycleRaw);
    if (!isFinite(cycle) || Math.floor(cycle) !== cycle) { showMsg(t("tool.err.cycleInt"), true); return; }
    if (cycle < CYCLE_MIN || cycle > CYCLE_MAX) { showMsg(t("tool.err.cycleRange"), true); return; }

    // 3) 생리 기간 — 빈 값 / 비정수 / 범위 밖(2~10) / 주기보다 길거나 같음
    var lengthRaw = String(els.length.value).trim();
    if (lengthRaw === "") { showMsg(t("tool.err.lengthEmpty"), true); return; }
    var length = Number(lengthRaw);
    if (!isFinite(length) || Math.floor(length) !== length) { showMsg(t("tool.err.lengthInt"), true); return; }
    if (length < LENGTH_MIN || length > LENGTH_MAX) { showMsg(t("tool.err.lengthRange"), true); return; }
    if (length >= cycle) { showMsg(t("tool.err.lengthVsCycle"), true); return; }

    // 4) 계산
    var res = computeCycles(start, cycle, length, today);
    var ph = currentPhase(start, cycle, length, today);
    var c1 = res.cycles[0];

    // 5) 경고 배너 (계산은 수행하되 신뢰도를 알린다)
    var html = "";
    var age = dayDiff(start, today);
    if (age >= OLD_DAYS) html += '<p class="pc-warn">' + escHtml(t("tool.warn.old")) + "</p>";
    if (res.rolled) html += '<p class="pc-warn">' + escHtml(t("tool.warn.rolled")) + "</p>";

    // 6) 오늘 상태
    var st = statusText(ph);
    if (st) html += '<p class="pc-status" role="status">' + escHtml(st) + "</p>";

    // 7) 요약 카드 3개 (가장 가까운 다음 주기 기준)
    var windowLen = dayDiff(c1.fertileStart, c1.fertileEnd) + 1;
    html += '<div class="pc-cards">' +
      card("tool.r.nextPeriod",
           fmtShort(c1.periodStart) + " – " + fmtShort(c1.periodEnd),
           relLabel(c1.periodStart, today) + " · " + fmt(t("tool.r.periodLen"), { n: length }), true) +
      card("tool.r.ovulation", fmtDate(c1.ovulation), relLabel(c1.ovulation, today), false) +
      card("tool.r.fertile",
           fmtShort(c1.fertileStart) + " – " + fmtShort(c1.fertileEnd),
           fmt(t("tool.r.windowLen"), { n: windowLen }), false) +
      "</div>";
    els.result.innerHTML = html;

    els.extra.hidden = false;
    drawTable(res.cycles);
  }

  /* ---- 향후 6주기 표 ---- */
  function drawTable(cycles) {
    var h = "<thead><tr>" +
      '<th scope="col">' + escHtml(t("tool.tbl.cycle")) + "</th>" +
      '<th scope="col">' + escHtml(t("tool.tbl.period")) + "</th>" +
      '<th scope="col">' + escHtml(t("tool.tbl.ovulation")) + "</th>" +
      '<th scope="col">' + escHtml(t("tool.tbl.fertile")) + "</th>" +
      "</tr></thead><tbody>";
    for (var i = 0; i < cycles.length; i++) {
      var c = cycles[i];
      h += "<tr>" +
        '<th scope="row">' + escHtml(fmt(t("tool.tbl.cycleN"), { n: c.index })) + "</th>" +
        "<td>" + escHtml(fmtShort(c.periodStart) + " – " + fmtShort(c.periodEnd)) + "</td>" +
        "<td>" + escHtml(fmtShort(c.ovulation)) + "</td>" +
        "<td>" + escHtml(fmtShort(c.fertileStart) + " – " + fmtShort(c.fertileEnd)) + "</td>" +
        "</tr>";
    }
    els.tbl.innerHTML = h + "</tbody>";
  }

  /* ---- 상태 문구(저장됨 안내 등) ---- */
  var statusTimer = null;
  function flash(text) {
    if (!els.status) return;
    els.status.textContent = text;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { els.status.textContent = ""; }, 2600);
  }

  /* ================= 이벤트 ================= */
  els.start.max = isoOf(startOfToday());   // 브라우저 피커에서도 미래 날짜를 막는다 (JS 검증은 별도 유지)
  els.start.addEventListener("input", function () { render(); saveState(); });
  els.cycle.addEventListener("input", function () { render(); saveState(); });
  els.length.addEventListener("input", function () { render(); saveState(); });
  if (els.calc) els.calc.addEventListener("click", function () { render(); saveState(); });
  if (els.clear) {
    els.clear.addEventListener("click", function () {
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* noop */ }
      els.start.value = "";
      els.cycle.value = "28";
      els.length.value = "5";
      render();
      flash(t("tool.cleared"));
    });
  }
  // Enter 키로 계산 실행
  [els.start, els.cycle, els.length].forEach(function (el) {
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { render(); saveState(); }
    });
  });
  document.addEventListener("i18n:change", function () { render(); });

  loadState();
  render();
  // TOOLJS:END
})();
