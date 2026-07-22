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
  // pregnancy-due-date-calc — LMP(Naegele's rule, 조정 가능 주기) · 수정일 · IVF 이식일(3일차/5일차)
  // 세 방법 모두 "조정된 LMP 상당일(anchor)"로 정규화한 뒤 그 한 지점에서
  // 예정일(+280일)·현재 임신 주수·삼분기 이정표를 전부 파생시킨다 (일관성 보장).
  // 상태: localStorage "<slug>:state" 만. 외부 API 없음, 전부 로컬 계산.
  var cfg = window.APP_CONFIG || {};
  var STORE_KEY = (cfg.slug || "pregnancy-due-date-calc") + ":state";

  /* ---- 상수 (spec 고정값 — 임상 관행 기준) ---- */
  var DUE_DAYS = 280;           // Naegele's rule: LMP 상당일 + 280일(40주) = 예정일
  var CONCEPTION_OFFSET = 14;   // 표준 28일 주기에서 배란/수정은 LMP + 14일 부근
  var IVF_DAY3_OFFSET = 17;     // 3일차 이식배아 나이 ≈ LMP 상당일 + 17일 (배란+3일)
  var IVF_DAY5_OFFSET = 19;     // 5일차(포배) 이식배아 나이 ≈ LMP 상당일 + 19일 (배란+5일)
  var CYCLE_MIN = 21, CYCLE_MAX = 45, CYCLE_DEFAULT = 28;
  var TOO_OLD_DAYS = 320;       // 45주 초과 — 현재 임신으로 보기 어려운 값(연도 오타 등) → 오류
  var POSTTERM_DAYS = 294;      // 42주 초과 — 오류는 아니지만 경고
  var IVF_FUTURE_CAP_DAYS = 300; // 이식 예정일이 과도하게 먼 미래인 경우 상한
  var MILESTONES = [
    { key: "t1end",    week: 12 },
    { key: "t2start",  week: 13 },
    { key: "anatomy",  week: 20 },
    { key: "viability", week: 24 },
    { key: "t3start",  week: 28 },
    { key: "fullterm", week: 37 },
    { key: "dueDate",  week: 40 }
  ];

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

  /* ---- 핵심 계산 (node 단위 검증 대상) ----
     method별 입력을 "LMP 상당일(anchor)" 하나로 정규화한다.
     anchor 는 표준 28일 주기라면 실제 LMP 와 같고, 그 외에는 그 지점을 기준으로
     예정일·현재 임신 주수·삼분기 이정표를 전부 유도한다 — 세 방법 간 다른 계산식이
     서로 어긋나지 않도록 하는 단일 기준점. */
  function anchorFromLMP(lmp, cycleDays) {
    return addDays(lmp, cycleDays - 28);
  }
  function anchorFromConception(conception) {
    return addDays(conception, -CONCEPTION_OFFSET);
  }
  function anchorFromIVF(transferDate, stage) {
    var offset = (Number(stage) === 3) ? IVF_DAY3_OFFSET : IVF_DAY5_OFFSET;
    return addDays(transferDate, -offset);
  }
  function computeDueDate(anchor) {
    return addDays(anchor, DUE_DAYS);
  }
  function computeMilestoneDates(anchor) {
    var out = [];
    for (var i = 0; i < MILESTONES.length; i++) {
      out.push({ key: MILESTONES[i].key, week: MILESTONES[i].week, date: addDays(anchor, MILESTONES[i].week * 7) });
    }
    return out;
  }
  function trimesterOfWeek(weeks) {
    if (weeks < 13) return 1;
    if (weeks < 28) return 2;
    return 3;
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseISO: parseISO, addDays: addDays, dayDiff: dayDiff, isoOf: isoOf,
      anchorFromLMP: anchorFromLMP, anchorFromConception: anchorFromConception, anchorFromIVF: anchorFromIVF,
      computeDueDate: computeDueDate, computeMilestoneDates: computeMilestoneDates, trimesterOfWeek: trimesterOfWeek,
      DUE_DAYS: DUE_DAYS, CONCEPTION_OFFSET: CONCEPTION_OFFSET,
      IVF_DAY3_OFFSET: IVF_DAY3_OFFSET, IVF_DAY5_OFFSET: IVF_DAY5_OFFSET
    };
    return;
  }

  /* ================= 표시 포맷 (Intl — 실패 시 ISO 폴백) ================= */
  function fmtDate(dt) {
    try {
      return new Intl.DateTimeFormat(curLang(), { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(dt);
    } catch (e) { return isoOf(dt); }
  }
  function fmtShort(dt) {
    try {
      return new Intl.DateTimeFormat(curLang(), { year: "numeric", month: "short", day: "numeric" }).format(dt);
    } catch (e) { return isoOf(dt); }
  }

  /* ================= DOM ================= */
  var els = {
    methodLmp: document.getElementById("pdd-method-lmp"),
    methodConception: document.getElementById("pdd-method-conception"),
    methodIvf: document.getElementById("pdd-method-ivf"),
    groupLmp: document.getElementById("pdd-group-lmp"),
    groupConception: document.getElementById("pdd-group-conception"),
    groupIvf: document.getElementById("pdd-group-ivf"),
    lmp: document.getElementById("pdd-lmp"),
    cycle: document.getElementById("pdd-cycle"),
    conception: document.getElementById("pdd-conception"),
    ivfDate: document.getElementById("pdd-ivf-date"),
    ivfStage: document.getElementById("pdd-ivf-stage"),
    calc: document.getElementById("pdd-calc"),
    clear: document.getElementById("pdd-clear"),
    status: document.getElementById("pdd-status"),
    result: document.getElementById("pdd-result"),
    extra: document.getElementById("pdd-extra"),
    tbl: document.getElementById("pdd-tbl")
  };
  if (!els.result || !els.methodLmp) return; // 도구 마크업이 없으면 조용히 종료 (셸만 있는 페이지)

  var lastAnchor = null; // 마지막 성공 계산의 anchor (언어 전환 시 재렌더용)

  /* ---- 방법 선택 ---- */
  function getMethod() {
    if (els.methodConception && els.methodConception.checked) return "conception";
    if (els.methodIvf && els.methodIvf.checked) return "ivf";
    return "lmp";
  }
  function syncGroups() {
    var m = getMethod();
    els.groupLmp.hidden = m !== "lmp";
    els.groupConception.hidden = m !== "conception";
    els.groupIvf.hidden = m !== "ivf";
  }

  /* ---- 상태 저장/복원: localStorage 만 (URL 파라미터에는 담지 않는다 — 민감 정보 링크 유출 방지) ---- */
  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        method: getMethod(),
        lmp: els.lmp.value,
        cycle: els.cycle.value,
        conception: els.conception.value,
        ivfDate: els.ivfDate.value,
        ivfStage: els.ivfStage.value
      }));
    } catch (e) { /* private mode — 저장만 실패, 계산은 계속된다 */ }
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (!o) return;
      if (o.method === "conception" && els.methodConception) els.methodConception.checked = true;
      else if (o.method === "ivf" && els.methodIvf) els.methodIvf.checked = true;
      else if (els.methodLmp) els.methodLmp.checked = true;
      if (typeof o.lmp === "string" && parseISO(o.lmp)) els.lmp.value = o.lmp;
      if (o.cycle != null && String(o.cycle) !== "") els.cycle.value = String(o.cycle);
      if (typeof o.conception === "string" && parseISO(o.conception)) els.conception.value = o.conception;
      if (typeof o.ivfDate === "string" && parseISO(o.ivfDate)) els.ivfDate.value = o.ivfDate;
      if (o.ivfStage === "3" || o.ivfStage === "5") els.ivfStage.value = o.ivfStage;
    } catch (e) { /* 손상된 값은 무시하고 기본값으로 시작 */ }
  }

  /* ---- 결과 출력 ---- */
  function showMsg(text, isError) {
    els.result.innerHTML = '<p class="' + (isError ? "pdd-err" : "pdd-msg") + '">' + escHtml(text) + "</p>";
    els.extra.hidden = true;
    lastAnchor = null;
  }

  function render(resetCal) {
    void resetCal;
    var today = startOfToday();
    syncGroups();
    var method = getMethod();
    var anchor = null;

    if (method === "lmp") {
      var lmpRaw = els.lmp.value;
      if (!lmpRaw) { showMsg(t("tool.err.noDate"), false); return; }
      var lmp = parseISO(lmpRaw);
      if (!lmp) { showMsg(t("tool.err.invalidDate"), true); return; }
      if (dayDiff(lmp, today) < 0) { showMsg(t("tool.err.future"), true); return; }
      var cycleRaw = String(els.cycle.value).trim();
      if (cycleRaw === "") { showMsg(t("tool.err.cycleEmpty"), true); return; }
      var cycle = Number(cycleRaw);
      if (!isFinite(cycle) || Math.floor(cycle) !== cycle) { showMsg(t("tool.err.cycleInt"), true); return; }
      if (cycle < CYCLE_MIN || cycle > CYCLE_MAX) { showMsg(t("tool.err.cycleRange"), true); return; }
      anchor = anchorFromLMP(lmp, cycle);
    } else if (method === "conception") {
      var cRaw = els.conception.value;
      if (!cRaw) { showMsg(t("tool.err.noDate"), false); return; }
      var conception = parseISO(cRaw);
      if (!conception) { showMsg(t("tool.err.invalidDate"), true); return; }
      if (dayDiff(conception, today) < 0) { showMsg(t("tool.err.future"), true); return; }
      anchor = anchorFromConception(conception);
    } else {
      var ivfRaw = els.ivfDate.value;
      if (!ivfRaw) { showMsg(t("tool.err.noDate"), false); return; }
      var ivfDate = parseISO(ivfRaw);
      if (!ivfDate) { showMsg(t("tool.err.invalidDate"), true); return; }
      if (dayDiff(today, ivfDate) > IVF_FUTURE_CAP_DAYS) { showMsg(t("tool.err.ivfFuture"), true); return; }
      anchor = anchorFromIVF(ivfDate, els.ivfStage.value);
    }

    var gaDays = dayDiff(anchor, today);
    if (gaDays > TOO_OLD_DAYS) { showMsg(t("tool.err.tooOld"), true); return; }

    lastAnchor = anchor;
    var dueDate = computeDueDate(anchor);

    var html = "";
    if (gaDays > POSTTERM_DAYS && gaDays <= TOO_OLD_DAYS) {
      html += '<p class="pdd-warn">' + escHtml(t("tool.warn.postterm")) + "</p>";
    }

    html += '<div class="pdd-cards">';
    html += '<div class="pdd-card is-key"><b>' + escHtml(t("tool.result.dueDate")) + '</b>' +
      '<span class="pdd-date">' + escHtml(fmtDate(dueDate)) + "</span></div>";

    if (gaDays >= 0) {
      var weeks = Math.floor(gaDays / 7), remDays = gaDays % 7;
      var gaText = fmt(t("tool.result.gaValue"), { w: weeks, d: remDays });
      var tri = trimesterOfWeek(weeks);
      var triLabel = tri === 1 ? t("tool.trimester.first") : (tri === 2 ? t("tool.trimester.second") : t("tool.trimester.third"));
      html += '<div class="pdd-card"><b>' + escHtml(t("tool.result.ga")) + '</b>' +
        '<span class="pdd-date">' + escHtml(gaText) + "</span>" +
        '<em class="pdd-rel">' + escHtml(fmt(t("tool.result.trimester"), { n: triLabel })) + "</em></div>";
    } else {
      html += '<p class="pdd-msg pdd-notyet">' + escHtml(t("tool.result.notYet")) + "</p>";
    }
    html += "</div>";

    els.result.innerHTML = html;
    els.extra.hidden = false;
    drawMilestones(anchor);
  }

  /* ---- 삼분기 이정표 표 ---- */
  function drawMilestones(anchor) {
    var rows = computeMilestoneDates(anchor);
    var h = "<thead><tr>" +
      '<th scope="col">' + escHtml(t("tool.milestones.col.milestone")) + "</th>" +
      '<th scope="col">' + escHtml(t("tool.milestones.col.week")) + "</th>" +
      '<th scope="col">' + escHtml(t("tool.milestones.col.date")) + "</th>" +
      "</tr></thead><tbody>";
    for (var i = 0; i < rows.length; i++) {
      h += "<tr>" +
        '<th scope="row">' + escHtml(t("tool.milestone." + rows[i].key)) + "</th>" +
        "<td>" + rows[i].week + "</td>" +
        "<td>" + escHtml(fmtShort(rows[i].date)) + "</td>" +
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
  var today0 = startOfToday();
  els.lmp.max = isoOf(today0);           // 생리 시작일은 미래일 수 없다 (브라우저 피커에서도 차단)
  els.conception.max = isoOf(today0);    // 수정일도 마찬가지

  [els.methodLmp, els.methodConception, els.methodIvf].forEach(function (r) {
    if (r) r.addEventListener("change", function () { render(true); saveState(); });
  });
  [els.lmp, els.cycle, els.conception, els.ivfDate, els.ivfStage].forEach(function (el) {
    el.addEventListener("input", function () { render(true); saveState(); });
    el.addEventListener("change", function () { render(true); saveState(); });
    // Enter 키로 계산 실행
    el.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { render(true); saveState(); }
    });
  });
  if (els.calc) els.calc.addEventListener("click", function () { render(true); saveState(); });
  if (els.clear) {
    els.clear.addEventListener("click", function () {
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* noop */ }
      els.methodLmp.checked = true;
      els.lmp.value = "";
      els.cycle.value = String(CYCLE_DEFAULT);
      els.conception.value = "";
      els.ivfDate.value = "";
      els.ivfStage.value = "5";
      render(true);
      flash(t("tool.cleared"));
    });
  }
  document.addEventListener("i18n:change", function () { render(false); });

  loadState();
  render(true);
  // TOOLJS:END
})();
