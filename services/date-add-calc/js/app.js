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
  // date-add-calc — 시작일에 일/주/월/년을 더하거나 빼서 결과 날짜(+요일)를 계산.
  // 영업일(주말만 제외, 공휴일 미포함) 옵션은 단위가 "일"일 때만 적용된다.
  // 상태는 localStorage "<slug>:state" 하나에만 저장. 외부 API 없음, 모든 계산은 로컬.
  var cfg = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "date-add-calc";
  var STATE_KEY = SLUG + ":state";
  var MIN_DATE = "1900-01-01";
  var MAX_DATE = "2999-12-31";
  var MAX_N = 36500; // 100년치 일수 — 영업일 루프 상한도 이 값에 비례

  /* ---- i18n 헬퍼 ---- */
  function t(key) {
    var s = window.I18N && window.I18N.t(key);
    return s != null ? s : key;
  }
  function fmtStr(s, params) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return params && params[k] != null ? String(params[k]) : m;
    });
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function nf(n) {
    try { return Number(n).toLocaleString(uiLang()); } catch (e) { return String(n); }
  }

  /* ---- 순수 날짜 로직 (node 단위 검증 대상) ---- */

  /** "YYYY-MM-DD" → 로컬 자정 Date. 형식 오류·달력에 없는 날(2/30 등)은 null */
  function parseDateStr(str) {
    if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
    var p = str.split("-");
    var y = Number(p[0]), m = Number(p[1]), d = Number(p[2]);
    var dt = new Date(y, m - 1, d);
    if (isNaN(dt.getTime())) return null;
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return dt;
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function toStr(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function todayStr() { return toStr(new Date()); }
  /** 지원 범위: 1900-01-01 ~ 2999-12-31 */
  function inRange(d) { var y = d.getFullYear(); return y >= 1900 && y <= 2999; }
  function isWeekend(d) { var g = d.getDay(); return g === 0 || g === 6; }

  function addDaysCalendar(d, n) {
    var x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }

  /** 개월(또는 년×12) 가산 + 말일 보정. 원본 start 기준으로 1회 계산 (연쇄 아님).
   *  1/31 + 1개월 = 2/28(윤년 2/29). clamped=true 면 말일 보정이 실제로 일어난 것. */
  function addMonthsClamped(d, months) {
    var anchor = new Date(d.getFullYear(), d.getMonth() + months, 1);
    var dim = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
    var clamped = d.getDate() > dim;
    anchor.setDate(clamped ? dim : d.getDate());
    return { date: anchor, clamped: clamped };
  }

  /** 영업일(주말만 제외, 공휴일 미포함) n일 가산/차감. guard 는 무한루프 방지용 상한. */
  function addBusinessDays(d, n, dirMul) {
    var cur = new Date(d.getTime());
    var counted = 0, guard = 0, maxGuard = n * 3 + 40;
    while (counted < n && guard < maxGuard) {
      guard++;
      cur.setDate(cur.getDate() + dirMul);
      if (!isWeekend(cur)) counted++;
    }
    return { date: cur, ok: counted >= n };
  }

  /** 전체 계산. dir: "add"|"subtract", unit: "days"|"weeks"|"months"|"years".
   *  business 는 unit==="days" 일 때만 의미가 있다 (호출부가 그 외엔 false 로 넘김). */
  function compute(start, dir, n, unit, business) {
    var dirMul = dir === "subtract" ? -1 : 1;
    var date, clamped = false, ok = true;
    if (unit === "days") {
      if (business) {
        var rb = addBusinessDays(start, n, dirMul);
        date = rb.date; ok = rb.ok;
      } else {
        date = addDaysCalendar(start, n * dirMul);
      }
    } else if (unit === "weeks") {
      date = addDaysCalendar(start, n * 7 * dirMul);
    } else if (unit === "months") {
      var rm = addMonthsClamped(start, n * dirMul);
      date = rm.date; clamped = rm.clamped;
    } else if (unit === "years") {
      var ry = addMonthsClamped(start, n * 12 * dirMul);
      date = ry.date; clamped = ry.clamped;
    } else {
      return { error: "unit" };
    }
    if (!ok) return { error: "tooLong" };
    if (!inRange(date)) return { error: "range" };
    var spanDays = Math.abs(Math.round((date.getTime() - start.getTime()) / 86400000));
    return { date: date, clamped: clamped, spanDays: spanDays };
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseDateStr: parseDateStr, toStr: toStr, inRange: inRange,
      addDaysCalendar: addDaysCalendar, addMonthsClamped: addMonthsClamped,
      addBusinessDays: addBusinessDays, compute: compute
    };
    return;
  }

  /* ---- 상태 저장 (localStorage, 단일 JSON 키) ---- */
  var storageOk = true;
  (function () { try { localStorage.setItem(SLUG + ":_t", "1"); localStorage.removeItem(SLUG + ":_t"); } catch (e) { storageOk = false; } })();
  function readState() {
    if (!storageOk) return {};
    try { var r = localStorage.getItem(STATE_KEY); return r ? JSON.parse(r) : {}; } catch (e) { return {}; }
  }
  function persist(state) {
    if (!storageOk) return;
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) { /* quota/private mode */ }
  }

  /* ---- DOM 참조 ---- */
  function $(id) { return document.getElementById(id); }
  var startEl = $("dac-start"), todayBtn = $("dac-today");
  var dirAddBtn = $("dac-dir-add"), dirSubBtn = $("dac-dir-sub");
  var nEl = $("dac-n"), unitEl = $("dac-unit");
  var businessEl = $("dac-business"), businessWrap = $("dac-business-wrap");
  var quickWrap = $("dac-quick");
  var resultEl = $("dac-result");
  if (!startEl || !nEl || !unitEl || !resultEl) return;

  var dirState = "add";
  var lastCopy = null;

  /* ---- 방향 토글 ---- */
  function syncDirButtons() {
    if (dirAddBtn) dirAddBtn.setAttribute("aria-pressed", dirState === "add" ? "true" : "false");
    if (dirSubBtn) dirSubBtn.setAttribute("aria-pressed", dirState === "subtract" ? "true" : "false");
  }
  function setDir(d) { dirState = d; syncDirButtons(); onChange(); }

  /* ---- 단위 변경 시 영업일 체크박스 활성/비활성 ---- */
  function syncBusinessAvailability() {
    var daysUnit = unitEl.value === "days";
    if (businessEl) businessEl.disabled = !daysUnit;
    if (!daysUnit && businessEl) businessEl.checked = false;
    if (businessWrap) businessWrap.setAttribute("aria-disabled", daysUnit ? "false" : "true");
  }

  /* ---- 렌더: 오류 ---- */
  function showError(msg) {
    resultEl.innerHTML = '<p class="dac-msg" role="alert">' + escHtml(msg) + "</p>";
  }
  function escHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---- 렌더: 성공 ---- */
  function fmtFull(d) {
    try {
      return new Intl.DateTimeFormat(uiLang(), { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(d);
    } catch (e) { return toStr(d); }
  }
  function fmtStart(d) {
    if (toStr(d) === todayStr()) return t("tool.today.word");
    try { return new Intl.DateTimeFormat(uiLang(), { year: "numeric", month: "long", day: "numeric" }).format(d); }
    catch (e) { return toStr(d); }
  }

  function render() {
    lastCopy = null;
    var sv = startEl.value;
    if (!sv) { showError(t("tool.err.start")); return; }
    var s = parseDateStr(sv);
    if (!s || !inRange(s)) { showError(t("tool.err.start")); return; }

    var rawN = nEl.value == null ? "" : String(nEl.value).trim();
    if (!/^\d+$/.test(rawN)) { showError(t("tool.err.amount")); return; }
    var n = parseInt(rawN, 10);
    if (!(n >= 0) || n > MAX_N) { showError(t("tool.err.amount")); return; }

    var unit = unitEl.value;
    var business = unit === "days" && !!(businessEl && businessEl.checked);

    var r = compute(s, dirState, n, unit, business);
    if (r.error) { showError(t("tool.err.range")); return; }

    var unitLabel = business ? t("tool.unit.businessDays") : t("tool.unit." + unit).toLowerCase();
    var startLabel = fmtStart(s);
    var resultLabel = fmtFull(r.date);
    var summaryKey = dirState === "subtract" ? "tool.summary.subtract" : "tool.summary.add";
    var summary = fmtStr(t(summaryKey), { n: nf(n), unit: unitLabel, start: startLabel, result: resultLabel });

    var html = '<p class="dac-summary">' + escHtml(summary) + "</p>";
    if (business) {
      html += '<p class="dac-note">' + escHtml(fmtStr(t("tool.business.detail"), { days: nf(r.spanDays) })) + "</p>";
    } else {
      if (r.clamped) html += '<p class="dac-note">' + escHtml(t("tool.clamp.note")) + "</p>";
      // 주/월/년 단위에서도 총 며칠인지 알려준다 (일 단위는 자명하므로 생략)
      if (unit !== "days" && n > 0) {
        html += '<p class="dac-note">' + escHtml(fmtStr(t("tool.span.note"), { days: nf(r.spanDays) })) + "</p>";
      }
    }
    lastCopy = summary;
    html += '<div class="dac-copyrow">' +
      '<button type="button" class="btn" id="dac-copy">' + escHtml(t("tool.copy")) + "</button></div>";
    resultEl.innerHTML = html;
  }

  /* ---- 복사 (Clipboard API → execCommand 폴백) ---- */
  function copyDone() {
    var btn = $("dac-copy");
    if (!btn) return;
    btn.textContent = t("tool.copied");
    setTimeout(function () { var b = $("dac-copy"); if (b) b.textContent = t("tool.copy"); }, 1500);
  }
  function copyFallback(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) copyDone();
    } catch (e) { /* 복사 미지원 — 표시값은 그대로 남는다 */ }
  }
  function copyResult() {
    if (lastCopy == null) return;
    var text = lastCopy;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(copyDone, function () { copyFallback(text); });
    } else {
      copyFallback(text);
    }
  }
  resultEl.addEventListener("click", function (ev) {
    var el = ev.target;
    while (el && el !== resultEl) {
      if (el.id === "dac-copy") { copyResult(); return; }
      el = el.parentNode;
    }
  });

  /* ---- 상태 저장/복원 ---- */
  function saveState() {
    persist({
      start: startEl.value || "", dir: dirState, n: nEl.value || "",
      unit: unitEl.value, business: !!(businessEl && businessEl.checked)
    });
  }
  function onChange() { saveState(); render(); }

  /* ---- 퀵 픽 ---- */
  function applyQuick(nVal, unitVal) {
    startEl.value = todayStr();
    dirState = "add";
    syncDirButtons();
    nEl.value = String(nVal);
    unitEl.value = unitVal;
    syncBusinessAvailability();
    onChange();
  }

  /* ---- 이벤트 ---- */
  startEl.addEventListener("input", onChange);
  if (todayBtn) todayBtn.addEventListener("click", function () { startEl.value = todayStr(); onChange(); });
  if (dirAddBtn) dirAddBtn.addEventListener("click", function () { setDir("add"); });
  if (dirSubBtn) dirSubBtn.addEventListener("click", function () { setDir("subtract"); });
  nEl.addEventListener("input", onChange);
  unitEl.addEventListener("change", function () { syncBusinessAvailability(); onChange(); });
  if (businessEl) businessEl.addEventListener("change", onChange);
  if (quickWrap) {
    quickWrap.addEventListener("click", function (ev) {
      var btn = ev.target.closest ? ev.target.closest("[data-n]") : null;
      if (!btn) return;
      applyQuick(btn.getAttribute("data-n"), btn.getAttribute("data-unit"));
    });
  }

  // 언어 전환 시 결과·단위 라벨 재렌더
  document.addEventListener("i18n:change", render);

  /* ---- 초기화: 저장값 복원, 없으면 오늘 + 30일 스마트 기본값 ---- */
  (function init() {
    var saved = readState();
    var okStart = saved.start && parseDateStr(saved.start) && inRange(parseDateStr(saved.start));
    startEl.value = okStart ? saved.start : todayStr();
    dirState = saved.dir === "subtract" ? "subtract" : "add";
    syncDirButtons();
    var okN = saved.n != null && /^\d+$/.test(String(saved.n));
    nEl.value = okN ? String(saved.n) : "30";
    var okUnit = ["days", "weeks", "months", "years"].indexOf(saved.unit) !== -1;
    unitEl.value = okUnit ? saved.unit : "days";
    syncBusinessAvailability();
    if (businessEl && unitEl.value === "days") businessEl.checked = !!saved.business;
    render();
  })();
  // TOOLJS:END
})();
