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
  var LS_KEY = (cfg.slug || "pregnancy-week-calc") + ":last";

  var TERM_DAYS = 280;      // 40 weeks — Naegele's rule
  var BASE_CYCLE = 28;      // reference cycle the 280-day rule assumes
  var CYCLE_MIN = 21;
  var CYCLE_MAX = 40;
  var OVER_TERM_DAYS = 294; // 42 weeks — beyond this we warn

  function $(id) { return document.getElementById(id); }
  var lmpEl = $("pwc-lmp");
  var cycleEl = $("pwc-cycle");
  var refEl = $("pwc-ref");
  var todayBtn = $("pwc-today");
  var msgEl = $("pwc-msg");
  var bodyEl = $("pwc-body");
  var weeksEl = $("pwc-weeks");
  var triEl = $("pwc-trimester");
  var barEl = $("pwc-bar-fill");
  var progressEl = $("pwc-progress");
  var overdueEl = $("pwc-overdue");
  var dueEl = $("pwc-due");
  var dcountEl = $("pwc-dcount");
  var gestEl = $("pwc-gest");
  var warn42El = $("pwc-warn-over42");
  if (!lmpEl || !cycleEl || !refEl || !msgEl || !bodyEl) return;

  /* ---- i18n helpers ---- */
  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function fmt(s, params) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return params && params[k] != null ? String(params[k]) : m;
    });
  }
  function lang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) || "en";
  }
  /** plural-aware lookup: <base>.one / <base>.other, selected via Intl.PluralRules */
  function plural(base, n, fbOne, fbOther) {
    var cat = "other";
    try { cat = new Intl.PluralRules(lang()).select(n); } catch (e) { /* old browser -> other */ }
    var v = t(base + "." + cat, null);
    if (v == null) v = t(base + ".other", cat === "one" ? fbOne : fbOther);
    return fmt(v, { n: n });
  }

  // ---- calc-core:start — pure functions (node unit-test target) ----
  /** "YYYY-MM-DD" -> local-midnight Date, or null when malformed/not a real date */
  function parseDate(str) {
    if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
    var p = str.split("-");
    var y = Number(p[0]), m = Number(p[1]), d = Number(p[2]);
    var dt = new Date(y, m - 1, d);
    if (isNaN(dt.getTime())) return null;
    // reject rollovers such as 2026-02-31
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return dt;
  }
  function toISO(d) {
    var m = String(d.getMonth() + 1);
    var dd = String(d.getDate());
    return d.getFullYear() + "-" + (m.length < 2 ? "0" + m : m) + "-" + (dd.length < 2 ? "0" + dd : dd);
  }
  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }
  /** whole days from a to b; both are local-midnight so DST cannot bleed in */
  function diffDays(a, b) {
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }
  function trimesterOf(gestDays) {
    if (gestDays <= 97) return 1;   // 0w0d – 13w6d
    if (gestDays <= 195) return 2;  // 14w0d – 27w6d
    return 3;                       // 28w0d +
  }
  /**
   * Core model. Returns { ok:false, reason } or the full result set.
   * cycleAdj shifts a non-28-day cycle: later ovulation -> later due date, fewer days gestated.
   */
  function computePregnancy(lmpStr, cycle, refStr) {
    var lmp = parseDate(lmpStr);
    if (!lmp) return { ok: false, reason: "lmp" };
    if (!(typeof cycle === "number") || !isFinite(cycle) || Math.floor(cycle) !== cycle ||
        cycle < CYCLE_MIN || cycle > CYCLE_MAX) {
      return { ok: false, reason: "cycle" };
    }
    var ref = parseDate(refStr);
    if (!ref) return { ok: false, reason: "ref" };

    var cycleAdj = cycle - BASE_CYCLE;
    var due = addDays(lmp, TERM_DAYS + cycleAdj);
    var gestDays = diffDays(lmp, ref) - cycleAdj;
    if (gestDays < 0) return { ok: false, reason: "order" };

    var remaining = diffDays(ref, due); // >0 before due date, <0 past it
    return {
      ok: true,
      gestDays: gestDays,
      weeks: Math.floor(gestDays / 7),
      days: gestDays % 7,
      dueISO: toISO(due),
      dueDate: due,
      remaining: remaining,
      trimester: trimesterOf(gestDays),
      progressPct: Math.min(100, Math.round((gestDays / TERM_DAYS) * 100)),
      overdue: gestDays > TERM_DAYS,
      over42: gestDays > OVER_TERM_DAYS
    };
  }
  // ---- calc-core:end ----

  function weekdayName(d) {
    try {
      return d.toLocaleDateString(lang(), { weekday: "long" });
    } catch (e) {
      return d.toLocaleDateString("en", { weekday: "long" });
    }
  }

  var last = null; // last rendered state, for re-render on language change (never a store of record)

  function showMsg(key, fallback, isError) {
    last = { kind: "msg", key: key, fallback: fallback, isError: !!isError };
    bodyEl.hidden = true;
    msgEl.hidden = false;
    msgEl.className = isError ? "pwc-msg-error" : "pwc-msg";
    msgEl.textContent = t(key, fallback);
    var resultEl = $("pwc-result");
    if (resultEl) resultEl.className = "result" + (isError ? " pwc-error" : "");
  }

  function render(r) {
    last = { kind: "result", r: r };
    msgEl.hidden = true;
    bodyEl.hidden = false;
    var resultEl = $("pwc-result");
    if (resultEl) resultEl.className = "result";

    var w = plural("tool.res.w", r.weeks, "{n} week", "{n} weeks");
    var d = plural("tool.res.d", r.days, "{n} day", "{n} days");
    weeksEl.textContent = fmt(t("tool.res.wd", "{w} {d}"), { w: w, d: d });
    triEl.textContent = t("tool.res.tri" + r.trimester, "Trimester " + r.trimester);

    barEl.style.width = r.progressPct + "%";
    progressEl.textContent = fmt(t("tool.res.progress", "{pct}% of the way there"), { pct: r.progressPct });
    overdueEl.hidden = !r.overdue;

    dueEl.textContent = fmt(t("tool.res.dueVal", "{date} ({weekday})"), {
      date: r.dueISO, weekday: weekdayName(r.dueDate)
    });
    if (r.remaining > 0) {
      dcountEl.textContent = fmt(t("tool.res.dminus", "D-{n}"), { n: r.remaining });
    } else if (r.remaining === 0) {
      dcountEl.textContent = t("tool.res.dday", "Due today");
    } else {
      dcountEl.textContent = fmt(t("tool.res.dplus", "D+{n}"), { n: Math.abs(r.remaining) });
    }
    gestEl.textContent = fmt(t("tool.res.gestVal", "Day {n} of 280"), { n: r.gestDays });

    warn42El.hidden = !r.over42;
  }

  function parseCycle(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (s === "") return null;
    var n = Number(s);
    return isNaN(n) ? null : n;
  }

  function calculate() {
    var lmpStr = lmpEl.value;
    // empty / invalid input -> explicit notice, never a silent no-op
    if (!lmpStr) {
      showMsg("tool.empty", "Select the first day of your last period to get started.", false);
      return;
    }
    var cycle = parseCycle(cycleEl.value);
    var refStr = refEl.value;

    var r = computePregnancy(lmpStr, cycle, refStr);
    if (!r.ok) {
      if (r.reason === "lmp") {
        showMsg("tool.empty", "Select the first day of your last period to get started.", false);
      } else if (r.reason === "cycle") {
        showMsg("tool.err.cycle", "Enter an average cycle length between 21 and 40 whole days.", true);
      } else if (r.reason === "ref") {
        showMsg("tool.err.ref", "Pick a date to calculate for, or tap Today.", true);
      } else {
        showMsg("tool.err.order", "Your last period must fall on or before the date you are calculating for.", true);
      }
      return;
    }
    render(r);
    persist();
  }

  function persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        lmp: lmpEl.value, cycle: cycleEl.value, ref: refEl.value
      }));
    } catch (e) { /* private mode — inputs simply are not remembered */ }
  }

  function todayISO() { return toISO(new Date()); }

  /* ---- init: LMP cannot be in the future; reference date defaults to today ---- */
  lmpEl.max = todayISO();
  refEl.value = todayISO();

  // restore last inputs (localStorage only — never sent to a server)
  (function restore() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      var p = JSON.parse(raw);
      if (p.lmp && parseDate(p.lmp)) lmpEl.value = p.lmp;
      if (p.cycle) cycleEl.value = p.cycle;
      if (p.ref && parseDate(p.ref)) refEl.value = p.ref;
    } catch (e) { /* unreadable/corrupt — start from defaults */ }
  })();

  [lmpEl, cycleEl, refEl].forEach(function (el) {
    el.addEventListener("input", calculate);
    el.addEventListener("change", calculate);
  });

  if (todayBtn) {
    todayBtn.addEventListener("click", function () {
      refEl.value = todayISO();
      calculate();
    });
  }

  // language switch -> re-render dynamic copy (weeks, weekday name, messages)
  document.addEventListener("i18n:change", function () {
    if (!last) return;
    if (last.kind === "msg") showMsg(last.key, last.fallback, last.isError);
    else render(last.r);
  });

  calculate(); // initial pass: renders restored state, or the explicit empty-input notice
  // TOOLJS:END
})();
