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
  /* Time Card Calculator — 7일 주간 타임카드: 출근/퇴근/휴게(분) -> 일별 순 근무시간
     (소수+시:분) 및 주간 합계. 선택: 시급 입력 -> 주 40시간 초과분 1.5배 초과근무 규정
     적용 여부 토글 -> 정규/초과 시간·급여·총급여. 인쇄 친화적. 상태는
     localStorage "<slug>:state" 만. 외부 API 없음, 모든 계산은 로컬. */

  var DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  var OT_THRESHOLD_MIN = 40 * 60; // 주 40시간 = 2400분
  var OT_MULT = 1.5;
  var MAX_RATE = 1e7; // 극단값 캡 — 실수 입력(자릿수 오류 등) 방어

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  // "HH:MM" -> 자정 기준 분. 빈 값/형식 오류는 null.
  function parseTimeToMinutes(raw) {
    if (raw == null || raw === "") return null;
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(raw).trim());
    if (!m) return null;
    var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
    return h * 60 + mi;
  }
  // 휴게 분: 빈값/음수/숫자아님 -> 0, 24시간(1440분) 초과는 캡.
  function parseBreakMinutes(raw) {
    if (raw == null || raw === "") return 0;
    var n = parseFloat(String(raw).replace(/,/g, "").trim());
    if (!isFinite(n) || n < 0) return 0;
    return Math.min(Math.round(n), 1440);
  }
  // 하루치 계산. status: empty(둘다 공백) | incomplete(한쪽만) | same(시작=종료) |
  // clamped(휴게가 근무시간보다 김) | ok. 종료<시작이면 익일로 넘어간 것으로 간주(야간 근무).
  function computeDay(startRaw, endRaw, breakRaw) {
    var sMin = parseTimeToMinutes(startRaw), eMin = parseTimeToMinutes(endRaw);
    var brk = parseBreakMinutes(breakRaw);
    if (sMin == null && eMin == null) return { netMin: 0, grossMin: 0, breakMin: brk, status: "empty" };
    if (sMin == null || eMin == null) return { netMin: 0, grossMin: 0, breakMin: brk, status: "incomplete" };
    if (sMin === eMin) return { netMin: 0, grossMin: 0, breakMin: brk, status: "same" };
    var gross = eMin > sMin ? (eMin - sMin) : (eMin + 1440 - sMin); // 자정 넘김 처리
    var net = gross - brk;
    if (net <= 0) return { netMin: 0, grossMin: gross, breakMin: brk, status: "clamped" };
    return { netMin: net, grossMin: gross, breakMin: brk, status: "ok" };
  }
  // 분 -> "H:MM"
  function minutesToHm(min) {
    var m = Math.max(0, Math.round(min));
    var h = Math.floor(m / 60), mm = m % 60;
    return h + ":" + (mm < 10 ? "0" + mm : String(mm));
  }
  // 분 -> 소수 시간(반올림 2자리)
  function minutesToDecimal(min) {
    return Math.round((min / 60) * 100) / 100;
  }
  // 주간 합계 + 급여. rate<=0 이면 pay 관련 값은 전부 0(placeholder UI가 처리).
  // thresholdH(주 기준시간)·mult(배수)는 선택 — 빈값/범위밖이면 기본값(40h, 1.5×)으로 클램프.
  function normThresholdMin(thresholdH) {
    var h = parseFloat(thresholdH);
    if (!isFinite(h) || h <= 0) return OT_THRESHOLD_MIN;
    return Math.min(Math.max(h, 1), 168) * 60;
  }
  function normMult(mult) {
    var m = parseFloat(mult);
    if (!isFinite(m) || m <= 0) return OT_MULT;
    return Math.min(Math.max(m, 1), 5);
  }
  function computePay(totalMin, rate, otEnabled, thresholdH, mult) {
    rate = isFinite(rate) && rate > 0 ? Math.min(rate, MAX_RATE) : 0;
    var thrMin = normThresholdMin(thresholdH);
    var otMult = normMult(mult);
    var regMin, otMin;
    if (otEnabled && totalMin > thrMin) {
      regMin = thrMin;
      otMin = totalMin - thrMin;
    } else {
      regMin = totalMin;
      otMin = 0;
    }
    var regPay = (regMin / 60) * rate;
    var otPay = (otMin / 60) * rate * otMult;
    return {
      regMin: regMin, otMin: otMin,
      regPay: regPay, otPay: otPay, grossPay: regPay + otPay,
      hasRate: rate > 0
    };
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseTimeToMinutes: parseTimeToMinutes, parseBreakMinutes: parseBreakMinutes,
      computeDay: computeDay, minutesToHm: minutesToHm, minutesToDecimal: minutesToDecimal,
      computePay: computePay, DAY_KEYS: DAY_KEYS, OT_THRESHOLD_MIN: OT_THRESHOLD_MIN
    };
    return;
  }

  /* ---- 통화 (cagr-calc 패턴 재사용 — 사용자 선택, localStorage 저장) ---- */
  var CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CNY", "KRW", "INR", "BRL", "RUB",
    "IDR", "CAD", "AUD", "CHF", "HKD", "SGD", "MXN", "ZAR", "TRY", "PKR", "BDT"];
  var REGION_CCY = { US: "USD", GB: "GBP", JP: "JPY", CN: "CNY", HK: "HKD", KR: "KRW",
    IN: "INR", BR: "BRL", RU: "RUB", ID: "IDR", CA: "CAD", AU: "AUD", CH: "CHF",
    SG: "SGD", MX: "MXN", ZA: "ZAR", TR: "TRY", PK: "PKR", BD: "BDT",
    DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", PT: "EUR", IE: "EUR", AT: "EUR" };
  var LANG_CCY = { ko: "KRW", ja: "JPY", zh: "CNY", de: "EUR", fr: "EUR", es: "EUR",
    pt: "BRL", ru: "RUB", id: "IDR", hi: "INR", bn: "BDT", ar: "USD", ur: "PKR", en: "USD" };

  function detectCurrency() {
    var langs = navigator.languages || [navigator.language || ""];
    for (var i = 0; i < langs.length; i++) {
      var parts = String(langs[i]).split("-");
      if (parts.length > 1) {
        var region = parts[parts.length - 1].toUpperCase();
        if (REGION_CCY[region]) return REGION_CCY[region];
      }
    }
    var primary = String(langs[0] || "en").split("-")[0].toLowerCase();
    return LANG_CCY[primary] || "USD";
  }

  /* ---- i18n · Intl 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "timesheet-calc") + ":state";
  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function nf(opts) { try { return new Intl.NumberFormat(uiLang(), opts); } catch (e) { return new Intl.NumberFormat("en", opts); } }
  function curSymbol(cur) {
    try {
      var parts = nf({ style: "currency", currency: cur }).formatToParts(0);
      for (var i = 0; i < parts.length; i++) if (parts[i].type === "currency") return parts[i].value;
    } catch (e) { /* noop */ }
    return cur;
  }
  function money(v, cur) {
    try { return nf({ style: "currency", currency: cur, maximumFractionDigits: 2 }).format(v); }
    catch (e) { return String(Math.round(v * 100) / 100) + " " + cur; }
  }
  function dayLabel(key) { return t("tool.day." + key, key); }
  function weekdayFormatter() {
    try { return new Intl.DateTimeFormat(uiLang(), { month: "short", day: "numeric" }); }
    catch (e) { return null; }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var weekStartEl = $("week-start"), thisWeekBtn = $("this-week-btn");
  var rowsBody = $("timecard-rows");
  var totalDecEl = $("total-dec"), totalHmEl = $("total-hm");
  var placeholderEl = $("tool-placeholder"), summaryEl = $("tool-summary");
  var rateEl = $("rate-input"), curSel = $("currency-select"), otToggle = $("ot-toggle");
  var otThrEl = $("ot-threshold"), otMultEl = $("ot-mult"), otOptsEl = $("ot-opts");
  var payEmptyEl = $("pay-empty"), payBodyEl = $("pay-body");
  var regHoursEl = $("pay-reg-hours"), otHoursEl = $("pay-ot-hours");
  var regPayEl = $("pay-reg-pay"), otPayEl = $("pay-ot-pay"), grossPayEl = $("pay-gross");
  var printBtn = $("print-btn"), clearBtn = $("clear-btn");
  if (!rowsBody || !totalDecEl) return;

  var rowEls = []; // { tr, start, end, brk, hoursOut, noteOut }

  /* ---- 행 렌더 ---- */
  function buildRows() {
    rowsBody.textContent = "";
    rowEls = [];
    for (var i = 0; i < DAY_KEYS.length; i++) {
      (function (key, idx) {
        var tr = document.createElement("tr");

        var tdDay = document.createElement("td");
        tdDay.className = "ts-day";
        var dayName = document.createElement("span");
        dayName.className = "ts-dayname";
        dayName.textContent = dayLabel(key);
        var dayDate = document.createElement("span");
        dayDate.className = "ts-daydate";
        tdDay.appendChild(dayName);
        tdDay.appendChild(dayDate);

        var tdStart = document.createElement("td");
        var startInp = document.createElement("input");
        startInp.type = "time"; startInp.className = "ts-time"; startInp.setAttribute("aria-label", dayLabel(key) + " " + t("tool.field.start", "Start"));
        tdStart.appendChild(startInp);

        var tdEnd = document.createElement("td");
        var endInp = document.createElement("input");
        endInp.type = "time"; endInp.className = "ts-time"; endInp.setAttribute("aria-label", dayLabel(key) + " " + t("tool.field.end", "End"));
        tdEnd.appendChild(endInp);

        var tdBrk = document.createElement("td");
        var brkInp = document.createElement("input");
        brkInp.type = "number"; brkInp.min = "0"; brkInp.step = "1"; brkInp.inputMode = "numeric";
        brkInp.className = "ts-break"; brkInp.placeholder = "0";
        brkInp.setAttribute("aria-label", dayLabel(key) + " " + t("tool.field.break", "Break (min)"));
        tdBrk.appendChild(brkInp);

        var tdHours = document.createElement("td");
        tdHours.className = "ts-hours";
        var hoursOut = document.createElement("span");
        hoursOut.className = "ts-hours-val";
        var noteOut = document.createElement("span");
        noteOut.className = "ts-note";
        noteOut.hidden = true;
        tdHours.appendChild(hoursOut);
        tdHours.appendChild(noteOut);

        tr.appendChild(tdDay); tr.appendChild(tdStart); tr.appendChild(tdEnd);
        tr.appendChild(tdBrk); tr.appendChild(tdHours);
        rowsBody.appendChild(tr);

        var entry = { key: key, start: startInp, end: endInp, brk: brkInp, hoursOut: hoursOut, noteOut: noteOut, dateOut: dayDate, nameOut: dayName };
        rowEls.push(entry);

        function onChange() { render(); persist(); }
        startInp.addEventListener("input", onChange);
        endInp.addEventListener("input", onChange);
        brkInp.addEventListener("input", onChange);
        [startInp, endInp, brkInp].forEach(function (el) {
          el.addEventListener("keydown", function (e) { if (e.key === "Enter") render(); });
        });
      })(DAY_KEYS[i], i);
    }
  }

  /* ---- 주 시작일에 따른 요일별 날짜 표시 ---- */
  function renderDates() {
    var fmt = weekdayFormatter();
    var base = weekStartEl && weekStartEl.value ? parseLocalDate(weekStartEl.value) : null;
    for (var i = 0; i < rowEls.length; i++) {
      if (base && fmt) {
        var d = new Date(base.getTime());
        d.setDate(d.getDate() + i);
        rowEls[i].dateOut.textContent = fmt.format(d);
        rowEls[i].dateOut.hidden = false;
      } else {
        rowEls[i].dateOut.textContent = "";
        rowEls[i].dateOut.hidden = true;
      }
    }
  }
  function parseLocalDate(isoDate) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate));
    if (!m) return null;
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  }
  function isoMondayOfThisWeek() {
    var now = new Date();
    var dow = now.getDay(); // 0=Sun..6=Sat
    var diff = dow === 0 ? -6 : (1 - dow); // 이번 주 월요일까지 offset
    var mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
    var yyyy = mon.getFullYear(), mm = String(mon.getMonth() + 1).padStart(2, "0"), dd = String(mon.getDate()).padStart(2, "0");
    return yyyy + "-" + mm + "-" + dd;
  }

  /* ---- 렌더: 일별 시간 + 주간 합계 + 급여 ---- */
  var hadAnyEntry = false;
  function render() {
    var totalMin = 0;
    hadAnyEntry = false;
    for (var i = 0; i < rowEls.length; i++) {
      var e = rowEls[i];
      var r = computeDay(e.start.value, e.end.value, e.brk.value);
      if (r.status !== "empty") hadAnyEntry = true;
      totalMin += r.netMin;
      if (r.status === "ok" || r.status === "same" || r.status === "clamped") {
        e.hoursOut.textContent = t("tool.hours.tpl", "{dec} h ({hm})")
          .replace("{dec}", nf({ maximumFractionDigits: 2 }).format(minutesToDecimal(r.netMin)))
          .replace("{hm}", minutesToHm(r.netMin));
      } else {
        e.hoursOut.textContent = "—";
      }
      if (r.status === "incomplete") {
        e.noteOut.textContent = t("tool.row.incomplete", "Enter both a start and end time for this day.");
        e.noteOut.hidden = false;
      } else if (r.status === "same") {
        e.noteOut.textContent = t("tool.row.same", "Start and end are the same — 0 hours logged.");
        e.noteOut.hidden = false;
      } else if (r.status === "clamped") {
        e.noteOut.textContent = t("tool.row.clamped", "Break is longer than the shift, so net hours are capped at 0.");
        e.noteOut.hidden = false;
      } else {
        e.noteOut.hidden = true;
      }
    }

    if (hadAnyEntry) {
      placeholderEl.hidden = true;
      summaryEl.hidden = false;
      totalDecEl.textContent = nf({ maximumFractionDigits: 2 }).format(minutesToDecimal(totalMin));
      totalHmEl.textContent = minutesToHm(totalMin);
    } else {
      placeholderEl.hidden = false;
      summaryEl.hidden = true;
    }

    renderPay(totalMin);
    renderDates();
  }

  function renderPay(totalMin) {
    var rateVal = rateEl ? parseFloat(String(rateEl.value).replace(/,/g, "")) : NaN;
    var otOn = !!(otToggle && otToggle.checked);
    var r = computePay(totalMin, rateVal, otOn,
      otThrEl ? otThrEl.value : "", otMultEl ? otMultEl.value : "");
    var cur = curSel ? curSel.value : "USD";
    if (otOptsEl) otOptsEl.hidden = !otOn;
    if (!r.hasRate || !hadAnyEntry) {
      payEmptyEl.hidden = false;
      payBodyEl.hidden = true;
      return;
    }
    payEmptyEl.hidden = true;
    payBodyEl.hidden = false;
    regHoursEl.textContent = nf({ maximumFractionDigits: 2 }).format(minutesToDecimal(r.regMin));
    otHoursEl.textContent = nf({ maximumFractionDigits: 2 }).format(minutesToDecimal(r.otMin));
    regPayEl.textContent = money(r.regPay, cur);
    otPayEl.textContent = money(r.otPay, cur);
    grossPayEl.textContent = money(r.grossPay, cur);
    var otRow = $("pay-ot-row");
    if (otRow) otRow.hidden = !(otToggle && otToggle.checked);
  }

  /* ---- 통화 셀렉트 ---- */
  function fillCurrencies(selected) {
    if (!curSel) return;
    var list = CURRENCIES.slice();
    if (list.indexOf(selected) === -1) list.unshift(selected);
    curSel.textContent = "";
    for (var i = 0; i < list.length; i++) {
      var opt = document.createElement("option");
      opt.value = list[i];
      opt.textContent = list[i] + " (" + curSymbol(list[i]) + ")";
      curSel.appendChild(opt);
    }
    curSel.value = selected;
  }

  /* ---- 저장/복원 ---- */
  function persist() {
    try {
      var days = rowEls.map(function (e) { return { s: e.start.value, e: e.end.value, b: e.brk.value }; });
      localStorage.setItem(SKEY, JSON.stringify({
        weekStart: weekStartEl ? weekStartEl.value : "",
        days: days,
        rate: rateEl ? rateEl.value : "",
        currency: curSel ? curSel.value : "",
        ot: !!(otToggle && otToggle.checked),
        otThr: otThrEl ? otThrEl.value : "",
        otMult: otMultEl ? otMultEl.value : ""
      }));
    } catch (e) { /* private mode — 저장 실패는 계산에 영향 없음 */ }
  }
  function restore() {
    var saved = null;
    try { var s = localStorage.getItem(SKEY); if (s) saved = JSON.parse(s); } catch (e) { saved = null; }
    var startCur = (saved && saved.currency) || detectCurrency();
    fillCurrencies(startCur);
    if (!saved) return;
    if (weekStartEl && saved.weekStart) weekStartEl.value = saved.weekStart;
    if (Array.isArray(saved.days)) {
      for (var i = 0; i < rowEls.length && i < saved.days.length; i++) {
        var d = saved.days[i];
        if (!d) continue;
        if (d.s) rowEls[i].start.value = d.s;
        if (d.e) rowEls[i].end.value = d.e;
        if (d.b) rowEls[i].brk.value = d.b;
      }
    }
    if (rateEl && saved.rate) rateEl.value = saved.rate;
    if (otToggle) otToggle.checked = !!saved.ot;
    if (otThrEl && saved.otThr) otThrEl.value = saved.otThr;
    if (otMultEl && saved.otMult) otMultEl.value = saved.otMult;
  }

  /* ---- 지우기 ---- */
  function clearWeek() {
    if (!window.confirm(t("tool.clear.confirm", "Clear all entries for this week?"))) return;
    for (var i = 0; i < rowEls.length; i++) {
      rowEls[i].start.value = "";
      rowEls[i].end.value = "";
      rowEls[i].brk.value = "";
    }
    if (weekStartEl) weekStartEl.value = "";
    if (rateEl) rateEl.value = "";
    if (otToggle) otToggle.checked = true;
    if (otThrEl) otThrEl.value = "";
    if (otMultEl) otMultEl.value = "";
    persist();
    render();
  }

  /* ---- 이벤트 ---- */
  buildRows();
  restore();
  if (weekStartEl) weekStartEl.addEventListener("change", function () { persist(); render(); });
  if (thisWeekBtn) thisWeekBtn.addEventListener("click", function () {
    if (weekStartEl) { weekStartEl.value = isoMondayOfThisWeek(); persist(); render(); }
  });
  if (rateEl) rateEl.addEventListener("input", function () { persist(); render(); });
  if (curSel) curSel.addEventListener("change", function () { persist(); render(); });
  if (otToggle) otToggle.addEventListener("change", function () { persist(); render(); });
  [otThrEl, otMultEl].forEach(function (el) {
    if (el) el.addEventListener("input", function () { persist(); render(); });
  });
  if (printBtn) printBtn.addEventListener("click", function () { window.print(); });
  if (clearBtn) clearBtn.addEventListener("click", clearWeek);

  // 언어 전환: 요일 라벨·통화 표기·동적 문구를 새 로케일로 재렌더
  document.addEventListener("i18n:change", function () {
    for (var i = 0; i < rowEls.length; i++) {
      var e = rowEls[i];
      e.nameOut.textContent = dayLabel(e.key);
      e.start.setAttribute("aria-label", dayLabel(e.key) + " " + t("tool.field.start", "Start"));
      e.end.setAttribute("aria-label", dayLabel(e.key) + " " + t("tool.field.end", "End"));
      e.brk.setAttribute("aria-label", dayLabel(e.key) + " " + t("tool.field.break", "Break (min)"));
    }
    fillCurrencies(curSel ? curSel.value : detectCurrency());
    render();
  });

  render();
  // TOOLJS:END
})();
