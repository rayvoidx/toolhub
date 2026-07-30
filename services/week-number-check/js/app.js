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
  /* Week Number Today — ISO 8601 week number lookup.
     오늘의 ISO 주차를 로드 즉시 표시 + 임의 날짜 조회 + 연간 주차 표.
     상태: localStorage "<slug>:state" (마지막 조회 날짜·연도) 만. 외부 API 없음, 모든 계산은 로컬. */

  /* ---- ISO 8601 순수 계산 (node 단위 검증 대상)
     핵심 규칙: 주는 월요일 시작, 그 해의 "1주차"는 그 해의 첫 번째 목요일이 속한 주
     (= 1월 4일이 항상 속한 주와 동일). 이 규칙 때문에 12/29~31이 다음 해 1주차가 되거나
     1/1~3이 전년도 52·53주차가 될 수 있다 (달력 연도 ≠ ISO 주차 연도).
     모든 날짜 연산은 Date.UTC 로 만든 "순수 달력 좌표" 안에서만 하고(시간대 영향 0),
     화면 표시할 때만 Intl 포맷에 timeZone:"UTC" 를 넘겨 브라우저 지역 시간대로 하루가
     밀리는 걸 막는다(흔한 버그 지점). ---- */
  function pad2(n) { return n < 10 ? "0" + n : String(n); }

  // UTC 기반 Date → "YYYY-MM-DD" (표시용 지역 시간대 영향 없음)
  function isoDateStr(dt) {
    return dt.getUTCFullYear() + "-" + pad2(dt.getUTCMonth() + 1) + "-" + pad2(dt.getUTCDate());
  }

  // "YYYY-MM-DD" 문자열 → {y,m,d} 또는 null (2/30 같은 존재하지 않는 날짜는 왕복검증으로 걸러낸다)
  function parseDateStr(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || "").trim());
    if (!m) return null;
    var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return { y: y, m: mo, d: d };
  }

  // ISO 8601 주차 + 주차연도. 표준 알고리즘: 그 주의 목요일로 이동하면
  // 목요일이 속한 연도가 곧 ISO 주차연도이고, 그 연도 1/1부터 날짜 차이를 7로 나눠 주차를 얻는다.
  function isoWeekInfo(y, m, d) {
    var dt = new Date(Date.UTC(y, m - 1, d));
    var dayNum = dt.getUTCDay() || 7; // 월=1 ... 일=7
    dt.setUTCDate(dt.getUTCDate() + 4 - dayNum); // 이번 주 목요일로 이동
    var isoYear = dt.getUTCFullYear();
    var yearStart = new Date(Date.UTC(isoYear, 0, 1));
    var week = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
    return { week: week, isoYear: isoYear };
  }

  // 주어진 ISO 주차연도·주차의 "월요일"(UTC Date). 1월 4일은 항상 1주차에 속한다는 규칙을 이용.
  function isoWeekMonday(isoYear, week) {
    var jan4 = new Date(Date.UTC(isoYear, 0, 4));
    var dayNum = jan4.getUTCDay() || 7;
    var week1Monday = new Date(jan4);
    week1Monday.setUTCDate(jan4.getUTCDate() - dayNum + 1);
    var monday = new Date(week1Monday);
    monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
    return monday;
  }

  // 그 ISO 주차연도의 총 주차 수(52 또는 53). 12/28은 항상 그 해의 마지막 ISO 주에 속한다.
  function weeksInIsoYear(y) {
    return isoWeekInfo(y, 12, 28).week;
  }

  // 달력연도 기준 1월 1일부터의 일수(그 해 몇 번째 날인지 — ISO 주차연도가 아니라 달력연도 기준)
  function dayOfYear(y, m, d) {
    var dt = new Date(Date.UTC(y, m - 1, d));
    var start = new Date(Date.UTC(y, 0, 1));
    return Math.round((dt - start) / 86400000) + 1;
  }

  function isLeapYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }

  // 연도 입력값 정규화: 정수만, 극단값은 합리적 범위로 캡 (UI 범위 1000–9999)
  function clampYear(n) {
    n = Math.round(Number(n));
    if (!isFinite(n)) return null;
    if (n < 1000) return 1000;
    if (n > 9999) return 9999;
    return n;
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      pad2: pad2, isoDateStr: isoDateStr, parseDateStr: parseDateStr,
      isoWeekInfo: isoWeekInfo, isoWeekMonday: isoWeekMonday,
      weeksInIsoYear: weeksInIsoYear, dayOfYear: dayOfYear,
      isLeapYear: isLeapYear, clampYear: clampYear
    };
    return;
  }

  /* ---- i18n · Intl 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "week-number-check") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmtInt(n) {
    try { return new Intl.NumberFormat(uiLang(), { maximumFractionDigits: 0 }).format(n); }
    catch (e) { return String(n); }
  }
  // UTC 로 만든 Date 를 표시할 때는 항상 timeZone:"UTC" 를 넘긴다 — 안 넘기면 서반구 사용자는
  // 자정 UTC 날짜가 로컬 변환 과정에서 하루 당겨져 보이는 흔한 버그가 생긴다.
  function fmtDate(dt, style) {
    var lang = uiLang();
    var opts = { timeZone: "UTC" };
    if (style === "short") { opts.month = "short"; opts.day = "numeric"; }
    else if (style === "shortYear") { opts.month = "short"; opts.day = "numeric"; opts.year = "numeric"; }
    else { opts.year = "numeric"; opts.month = "long"; opts.day = "numeric"; }
    try { return new Intl.DateTimeFormat(lang, opts).format(dt); }
    catch (e) { return isoDateStr(dt); }
  }
  function fmtMonth(dt) {
    try { return new Intl.DateTimeFormat(uiLang(), { month: "short", timeZone: "UTC" }).format(dt); }
    catch (e) { return String(dt.getUTCMonth() + 1); }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var todayWeekEl = $("today-week"), todayRangeEl = $("today-range");
  var dateInput = $("date-input"), dateErr = $("date-err");
  var dateResult = $("date-result"), dateNote = $("date-note");
  var rWeek = $("r-week"), rYear = $("r-year"), rRange = $("r-range"), rDoy = $("r-doy");
  var yearInput = $("year-input"), yearPrev = $("year-prev"), yearNext = $("year-next");
  var yearJump = $("year-jump"), weeksNoteEl = $("weeks-note"), tbody = $("year-tbody");
  if (!dateInput || !yearInput || !tbody) return;

  /* ---- 로컬(사용자 체감) 오늘 ---- */
  function localToday() {
    var d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }

  /* ---- 상태 저장/복원 ---- */
  function loadState() {
    try {
      var raw = localStorage.getItem(SKEY);
      if (!raw) return {};
      var obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : {};
    } catch (e) { return {}; } // private mode / 손상된 값 — 기본값으로 계속 진행
  }
  function saveState(patch) {
    try {
      var cur = loadState();
      for (var k in patch) { if (Object.prototype.hasOwnProperty.call(patch, k)) cur[k] = patch[k]; }
      localStorage.setItem(SKEY, JSON.stringify(cur));
    } catch (e) { /* noop */ }
  }

  /* ---- 오늘의 주차 (로드 즉시 표시 — 이 도구의 핵심 기능) ---- */
  function renderToday() {
    var t = localToday();
    var info = isoWeekInfo(t.y, t.m, t.d);
    var monday = isoWeekMonday(info.isoYear, info.week);
    var sunday = new Date(monday);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    if (todayWeekEl) {
      todayWeekEl.textContent = tr("tool.today.text", "Week {week} of {year}")
        .replace("{week}", fmtInt(info.week)).replace("{year}", fmtInt(info.isoYear));
    }
    if (todayRangeEl) {
      todayRangeEl.textContent = tr("tool.today.range", "{start} – {end}")
        .replace("{start}", fmtDate(monday, "short")).replace("{end}", fmtDate(sunday, "shortYear"));
    }
    return { today: t, info: info, monday: monday, sunday: sunday };
  }

  /* ---- 임의 날짜 조회 ---- */
  function renderDateCheck(dateStr) {
    var p = parseDateStr(dateStr);
    if (!p) {
      if (dateResult) dateResult.hidden = true;
      if (dateErr) dateErr.hidden = false;
      return;
    }
    if (dateErr) dateErr.hidden = true;
    var info = isoWeekInfo(p.y, p.m, p.d);
    var monday = isoWeekMonday(info.isoYear, info.week);
    var sunday = new Date(monday);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    var doy = dayOfYear(p.y, p.m, p.d);
    var totalDays = isLeapYear(p.y) ? 366 : 365;

    if (rWeek) rWeek.textContent = fmtInt(info.week);
    if (rYear) rYear.textContent = fmtInt(info.isoYear);
    if (rRange) rRange.textContent = fmtDate(monday, "short") + " – " + fmtDate(sunday, "shortYear");
    if (rDoy) rDoy.textContent = fmtInt(doy) + " / " + fmtInt(totalDays);

    if (dateNote) {
      if (info.isoYear !== p.y) {
        var key = info.isoYear < p.y ? "tool.date.note.prevYear" : "tool.date.note.nextYear";
        dateNote.textContent = tr(key, "")
          .replace("{date}", fmtDate(new Date(Date.UTC(p.y, p.m - 1, p.d)), "shortYear"))
          .replace(/\{calYear\}/g, fmtInt(p.y))
          .replace(/\{isoYear\}/g, fmtInt(info.isoYear))
          .replace("{week}", fmtInt(info.week));
        dateNote.hidden = false;
      } else {
        dateNote.hidden = true;
      }
    }
    if (dateResult) dateResult.hidden = false;
    saveState({ date: isoDateStr(new Date(Date.UTC(p.y, p.m - 1, p.d))) });
  }

  /* ---- 연간 주차 표 ---- */
  function renderYearTable(isoYear, todayInfo) {
    var n = weeksInIsoYear(isoYear);
    if (weeksNoteEl) {
      weeksNoteEl.textContent = tr("tool.year.weeksNote", "{year} has {n} ISO weeks.")
        .replace("{year}", fmtInt(isoYear)).replace("{n}", fmtInt(n));
    }
    tbody.textContent = "";
    var frag = document.createDocumentFragment();
    var isCurrentYear = todayInfo && todayInfo.info.isoYear === isoYear;
    for (var w = 1; w <= n; w++) {
      var monday = isoWeekMonday(isoYear, w);
      var sunday = new Date(monday);
      sunday.setUTCDate(sunday.getUTCDate() + 6);
      var tr_ = document.createElement("tr");
      tr_.id = "wk-row-" + w;
      if (isCurrentYear && w === todayInfo.info.week) {
        tr_.className = "wn-current";
        var td0 = document.createElement("td");
        var badge = document.createElement("span");
        badge.className = "wn-badge";
        badge.textContent = tr("tool.year.table.current", "Current");
        td0.appendChild(document.createTextNode(fmtInt(w) + " "));
        td0.appendChild(badge);
        tr_.appendChild(td0);
      } else {
        var td0b = document.createElement("td");
        td0b.textContent = fmtInt(w);
        tr_.appendChild(td0b);
      }
      var td1 = document.createElement("td"); td1.textContent = isoDateStr(monday); tr_.appendChild(td1);
      var td2 = document.createElement("td"); td2.textContent = isoDateStr(sunday); tr_.appendChild(td2);
      var td3 = document.createElement("td");
      var m1 = fmtMonth(monday), m2 = fmtMonth(sunday);
      td3.textContent = m1 === m2 ? m1 : (m1 + "/" + m2);
      tr_.appendChild(td3);
      frag.appendChild(tr_);
    }
    tbody.appendChild(frag);
  }

  /* ---- 이벤트 ---- */
  function currentYearInput() {
    var y = clampYear(yearInput.value);
    if (y == null) y = localToday().y;
    if (String(y) !== yearInput.value) yearInput.value = String(y);
    return y;
  }

  var lastTodayInfo = null;

  function refreshAll() {
    lastTodayInfo = renderToday();
    renderDateCheck(dateInput.value);
    renderYearTable(currentYearInput(), lastTodayInfo);
  }

  dateInput.addEventListener("input", function () { renderDateCheck(dateInput.value); });

  yearInput.addEventListener("input", function () {
    renderYearTable(currentYearInput(), lastTodayInfo);
    saveState({ year: currentYearInput() });
  });
  if (yearPrev) {
    yearPrev.addEventListener("click", function () {
      yearInput.value = String(currentYearInput() - 1);
      renderYearTable(currentYearInput(), lastTodayInfo);
      saveState({ year: currentYearInput() });
    });
  }
  if (yearNext) {
    yearNext.addEventListener("click", function () {
      yearInput.value = String(currentYearInput() + 1);
      renderYearTable(currentYearInput(), lastTodayInfo);
      saveState({ year: currentYearInput() });
    });
  }
  if (yearJump) {
    yearJump.addEventListener("click", function () {
      var t = localToday();
      var info = isoWeekInfo(t.y, t.m, t.d);
      yearInput.value = String(info.isoYear);
      renderYearTable(info.isoYear, lastTodayInfo);
      saveState({ year: info.isoYear });
      var row = $("wk-row-" + info.week);
      if (row && row.scrollIntoView) row.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  // 언어 전환 시 로케일 의존 표시(월 이름·날짜 포맷) 재적용
  document.addEventListener("i18n:change", function () { refreshAll(); });

  /* ---- 초기화 ---- */
  (function init() {
    var t = localToday();
    var todayIso = isoDateStr(new Date(Date.UTC(t.y, t.m - 1, t.d)));
    var state = loadState();
    var initialDate = state.date && parseDateStr(state.date) ? state.date : todayIso;
    dateInput.value = initialDate;

    var todayInfo = isoWeekInfo(t.y, t.m, t.d);
    var initialYear = clampYear(state.year) || todayInfo.isoYear;
    yearInput.value = String(initialYear);

    refreshAll();
  })();
  // TOOLJS:END
})();
