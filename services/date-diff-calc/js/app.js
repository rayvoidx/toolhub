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
  // date-diff-calc — 두 날짜 구간 계산 (spec: factory/state/date-diff-calc.yaml)
  // 자정 정규화 로컬 Date 연산 + Math.round 로 DST 무관. 상태는 localStorage "<slug>:" prefix 에만.
  var cfg = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "date-diff-calc";
  var MS_DAY = 86400000;
  var MIN_DATE = "1900-01-01";
  var MAX_DATE = "2999-12-31";

  /* ---- i18n 헬퍼 ---- */
  function t(key) {
    var s = window.I18N && window.I18N.t(key);
    return s != null ? s : key;
  }
  function fmt(s, params) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return params && params[k] != null ? String(params[k]) : m;
    });
  }
  function nf(n) {
    try {
      var lang = window.I18N && window.I18N.lang();
      return Number(n).toLocaleString(lang || undefined);
    } catch (e) { return String(n); }
  }
  function escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---- 순수 날짜 로직 ---- */

  /** "YYYY-MM-DD" → 로컬 자정 Date. 형식 오류·달력에 없는 날(2/30 등)은 null */
  function parseDate(str) {
    if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
    var p = str.split("-");
    var y = Number(p[0]), m = Number(p[1]), d = Number(p[2]);
    var dt = new Date(y, m - 1, d);
    if (isNaN(dt.getTime())) return null;
    // Date 롤오버(2월 30일 → 3월 2일 등) 거부
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  function toStr(d) {
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function todayStr() { return toStr(new Date()); }

  /** 지원 범위: 1900-01-01 ~ 2999-12-31 */
  function inRange(d) {
    var y = d.getFullYear();
    return y >= 1900 && y <= 2999;
  }

  /** 자정 정규화된 두 Date 의 일수 차 (DST 로 ±1h 어긋나도 round 로 흡수) */
  function diffDays(a, b) {
    return Math.round((b.getTime() - a.getTime()) / MS_DAY);
  }

  /** 개월 가산 + 말일 보정 (1/31 + 1개월 = 2/28·29) */
  function addMonthsClamped(d, months) {
    var anchor = new Date(d.getFullYear(), d.getMonth() + months, 1);
    var dim = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
    anchor.setDate(Math.min(d.getDate(), dim));
    return anchor;
  }

  /** 달력 기준 분해: 시작일에 년→월 순서로 가산(말일 보정) 후 잔여 일수. start <= end 전제 */
  function calendarDiff(start, end) {
    var totalMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    if (totalMonths > 0 && addMonthsClamped(start, totalMonths).getTime() > end.getTime()) totalMonths -= 1;
    var anchor = addMonthsClamped(start, totalMonths);
    return {
      years: Math.floor(totalMonths / 12),
      months: totalMonths % 12,
      days: diffDays(anchor, end),
      totalMonths: totalMonths
    };
  }

  /**
   * 전체 계산. end < start 면 자동 스왑(swapped=true, 에러 아님).
   * includeEnd(당일 포함)는 총 일수(total)에만 +1 — 분해 값은 구간(interval) 기준 유지.
   */
  function compute(start, end, includeEnd) {
    var swapped = false;
    if (end.getTime() < start.getTime()) {
      var tmp = start; start = end; end = tmp;
      swapped = true;
    }
    var interval = diffDays(start, end);
    var cal = calendarDiff(start, end);
    return {
      swapped: swapped,
      startStr: toStr(start),
      endStr: toStr(end),
      interval: interval,
      total: includeEnd ? interval + 1 : interval,
      years: cal.years,
      months: cal.months,
      days: cal.days,
      weeks: Math.floor(interval / 7),
      weekDays: interval % 7,
      totalMonths: cal.totalMonths,
      hours: interval * 24,
      minutes: interval * 1440
    };
  }

  // 브라우저 밖(node) 단위 검증용 훅 — UI 상태 저장 용도 아님
  window.__DDC_TEST = {
    parseDate: parseDate, toStr: toStr, diffDays: diffDays,
    addMonthsClamped: addMonthsClamped, calendarDiff: calendarDiff, compute: compute
  };

  /* ---- 상태 저장 (localStorage, "<slug>:" prefix 전용) ---- */
  function store(key, val) {
    try { localStorage.setItem(SLUG + ":" + key, String(val)); } catch (e) { /* private mode */ }
  }
  function load(key) {
    try { return localStorage.getItem(SLUG + ":" + key); } catch (e) { return null; }
  }

  /* ---- DOM 참조 (node 검증 시 전부 null — 모든 사용처 가드) ---- */
  var startEl = document.getElementById("ddc-start");
  var endEl = document.getElementById("ddc-end");
  var includeEl = document.getElementById("ddc-include");
  var swapBtn = document.getElementById("ddc-swap");
  var presetStartBtn = document.getElementById("ddc-preset-start");
  var presetEndBtn = document.getElementById("ddc-preset-end");
  var resultEl = document.getElementById("ddc-result");

  var lastCopy = null; // 현재 결과의 복사 문자열 (렌더마다 재계산 — 복원 용도 아님)

  /* ---- 렌더 ---- */
  function msgHtml(msg) {
    return '<p class="ddc-msg">' + escHtml(msg) + "</p>";
  }

  function render() {
    if (!resultEl) return;
    lastCopy = null;
    var sv = startEl ? startEl.value : "";
    var ev = endEl ? endEl.value : "";
    var inc = !!(includeEl && includeEl.checked);

    // 엣지: 한쪽이라도 미입력 → 안내만, 계산 안 함
    if (!sv || !ev) { resultEl.innerHTML = msgHtml(t("tool.n.empty")); return; }
    var s = parseDate(sv), e = parseDate(ev);
    if (!s || !e) { resultEl.innerHTML = msgHtml(t("tool.n.invalid")); return; }
    if (!inRange(s) || !inRange(e)) { resultEl.innerHTML = msgHtml(t("tool.n.range")); return; }

    var r = compute(s, e, inc);
    var html = "";

    var notices = [];
    if (r.swapped) notices.push(t("tool.n.swapped"));
    if (r.interval === 0) notices.push(t("tool.n.same"));
    if (inc) notices.push(t("tool.n.include"));
    if (notices.length) {
      html += '<div class="ddc-notices">';
      for (var i = 0; i < notices.length; i++) html += "<p>ⓘ " + escHtml(notices[i]) + "</p>";
      html += "</div>";
    }

    // 대형 표시: 총 {n}일 (당일 포함 시 {n}일차 병기)
    html += '<div class="ddc-big">' + escHtml(fmt(t("tool.v.totalDays"), { n: nf(r.total) }));
    if (inc) html += ' <span class="ddc-dayth">' + escHtml(fmt(t("tool.v.dayth"), { n: nf(r.total) })) + "</span>";
    html += "</div>";

    // 분해 카드 3종 (구간 기준)
    html += '<dl class="ddc-cards">';
    html += '<div class="ddc-cell"><dt>' + escHtml(t("tool.k.ymd")) + "</dt><dd>" +
      escHtml(fmt(t("tool.v.ymd"), { y: nf(r.years), m: nf(r.months), d: nf(r.days) })) + "</dd></div>";
    html += '<div class="ddc-cell"><dt>' + escHtml(t("tool.k.weeks")) + "</dt><dd>" +
      escHtml(fmt(t("tool.v.weeks"), { w: nf(r.weeks), d: nf(r.weekDays) })) + "</dd></div>";
    html += '<div class="ddc-cell"><dt>' + escHtml(t("tool.k.ref")) + "</dt><dd>" +
      escHtml(fmt(t("tool.v.months"), { n: nf(r.totalMonths) })) + " · " +
      escHtml(fmt(t("tool.v.hours"), { n: nf(r.hours) })) + " · " +
      escHtml(fmt(t("tool.v.minutes"), { n: nf(r.minutes) })) + "</dd></div>";
    html += "</dl>";

    // 복사: "2024-01-01 ~ 2026-07-10 = 921일" (+ 당일 포함 시 일차 병기)
    lastCopy = r.startStr + " ~ " + r.endStr + " = " + fmt(t("tool.v.days"), { n: r.total });
    if (inc) lastCopy += " (" + fmt(t("tool.v.dayth"), { n: r.total }) + ")";
    html += '<div class="ddc-copyrow">' +
      '<button type="button" class="btn" id="ddc-copy">' + escHtml(t("tool.copy")) + "</button>" +
      '<span class="ddc-copytext">' + escHtml(lastCopy) + "</span></div>";

    resultEl.innerHTML = html;
  }

  /* ---- 복사 (Clipboard API → execCommand 폴백 → 실패 안내) ---- */
  function copyDone() {
    var btn = document.getElementById("ddc-copy");
    if (!btn) return;
    btn.textContent = t("tool.copied");
    setTimeout(function () {
      var b = document.getElementById("ddc-copy");
      if (b) b.textContent = t("tool.copy");
    }, 1500);
  }
  function copyFail() {
    if (!resultEl || resultEl.querySelector(".ddc-copyfail")) return;
    var row = resultEl.querySelector(".ddc-copyrow");
    if (!row) return;
    var p = document.createElement("p");
    p.className = "ddc-copyfail";
    p.textContent = "ⓘ " + t("tool.copyFail");
    row.parentNode.insertBefore(p, row.nextSibling);
  }
  function copyFallback(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) copyDone(); else copyFail();
    } catch (e) { copyFail(); }
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

  /* ---- 이벤트 ---- */
  function persist() {
    if (startEl) store("start", startEl.value || "");
    if (endEl) store("end", endEl.value || "");
    if (includeEl) store("include", includeEl.checked ? "1" : "0");
  }
  function onChange() { persist(); render(); }

  if (startEl) startEl.addEventListener("input", onChange);
  if (endEl) endEl.addEventListener("input", onChange);
  if (includeEl) includeEl.addEventListener("change", onChange);

  if (presetStartBtn) {
    presetStartBtn.addEventListener("click", function () {
      if (!startEl) return;
      startEl.value = todayStr();
      onChange();
    });
  }
  if (presetEndBtn) {
    presetEndBtn.addEventListener("click", function () {
      if (!endEl) return;
      endEl.value = todayStr();
      onChange();
    });
  }
  if (swapBtn) {
    swapBtn.addEventListener("click", function () {
      if (!startEl || !endEl) return;
      var tmp = startEl.value;
      startEl.value = endEl.value;
      endEl.value = tmp;
      onChange();
    });
  }
  if (resultEl) {
    // 결과 영역은 렌더마다 갈아끼우므로 복사 버튼은 위임으로 처리
    resultEl.addEventListener("click", function (ev) {
      var el = ev.target;
      while (el && el !== resultEl) {
        if (el.id === "ddc-copy") { copyResult(); return; }
        el = el.parentNode;
      }
    });
  }

  // 언어 전환 시 결과·안내 문구 재렌더
  document.addEventListener("i18n:change", render);

  /* ---- 초기화: 저장값 복원, 없으면 시작일=오늘·종료일=빈값 ---- */
  (function init() {
    var savedStart = load("start");
    var savedEnd = load("end");
    var savedInc = load("include");
    if (startEl) {
      var okStart = savedStart && parseDate(savedStart) && inRange(parseDate(savedStart));
      startEl.value = okStart ? savedStart : todayStr();
    }
    if (endEl && savedEnd && parseDate(savedEnd) && inRange(parseDate(savedEnd))) {
      endEl.value = savedEnd;
    }
    if (includeEl) includeEl.checked = savedInc === "1";
    render();
  })();
  // TOOLJS:END
})();
