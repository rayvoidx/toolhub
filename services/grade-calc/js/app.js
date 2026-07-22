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
  // grade-calc — within-one-class weighted grade calculator.
  // Rows: assignment name (optional) + score (percent or "earned/possible" fraction) + weight %.
  // current weighted average = Σ(score_i × weight_i) / Σ(weight_i) over rows that have BOTH
  // a valid score and a valid weight — so the average always reflects only the assignments
  // that have actually been graded so far, even before every category exists yet.
  // totalWeightAll = Σ(weight_i) over every row with a valid weight (score optional) — this is
  // what gets compared against 100% for the "weights don't add up" warning, since that reflects
  // the grading scheme as defined (including not-yet-graded categories like a future final exam).
  // Not a GPA calculator (see gpa-calc for cross-course GPA on 4.0/4.3/4.5 with credit hours) —
  // this tool is purely a single-class percentage/letter-grade average from assignment weights.
  // 100% local: no external API, state only in localStorage "<slug>:state".
  var cfg = window.APP_CONFIG || {};

  /* ---- i18n 헬퍼 ---- */
  function t(key) { var s = window.I18N && window.I18N.t(key); return s != null ? s : key; }
  function fmt(s, params) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return params && params[k] != null ? String(params[k]) : m;
    });
  }
  function escHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---- 순수 계산 로직 ----
     row.kind: "empty" (필드 비어있음 → 조용히 제외), "ok" (사용), "invalid" (형식 오류 → ignored 카운트) */
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  var BOUND = 100000; // 극단값 가드 — 오타로 인한 오버플로 표시 방지

  // 점수 필드: "92" · "92%" · "46/50" (획득/배점) 전부 허용. 60/0 처럼 분모 0 은 invalid.
  function parseScoreField(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (s === "") return { kind: "empty" };
    var frac = s.match(/^(-?[\d.]+)\s*\/\s*(-?[\d.]+)$/);
    if (frac) {
      var num = parseFloat(frac[1]), den = parseFloat(frac[2]);
      if (!isFinite(num) || !isFinite(den) || den === 0) return { kind: "invalid" };
      var pct = (num / den) * 100;
      if (!isFinite(pct) || Math.abs(pct) > BOUND) return { kind: "invalid" };
      return { kind: "ok", value: pct };
    }
    var s2 = s.replace(/%\s*$/, "").trim();
    if (s2 === "" || s2 === "-" || s2 === "." || !/^-?\d*\.?\d*$/.test(s2)) return { kind: "invalid" };
    var n = parseFloat(s2);
    if (!isFinite(n) || Math.abs(n) > BOUND) return { kind: "invalid" };
    return { kind: "ok", value: n };
  }
  // 가중치 필드: 음수·비수치는 invalid. 빈 값은 empty.
  function parseWeightField(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (s === "") return { kind: "empty" };
    var s2 = s.replace(/%\s*$/, "").trim();
    if (s2 === "" || s2 === "." || !/^\d*\.?\d*$/.test(s2)) return { kind: "invalid" };
    var n = parseFloat(s2);
    if (!isFinite(n) || n > BOUND) return { kind: "invalid" };
    return { kind: "ok", value: n };
  }

  /**
   * rows: [{ scoreRaw, weightRaw }]
   * counted 행 = score 유효 && weight 유효(>0) 인 행만 평균 분자/분모에 반영.
   * weightAll = weight 가 유효한 모든 행의 합(점수 유무 무관) — 100% 대비 경고용.
   * invalid(형식 오류가 있는 비어있지 않은 값)는 ignored 로 카운트하고 계산에서 제외한다.
   */
  function computeGrade(rows) {
    var sumWeighted = 0, weightUsed = 0, weightAll = 0, ignored = 0, counted = 0, weightRows = 0;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || {};
      var w = parseWeightField(row.weightRaw);
      var s = parseScoreField(row.scoreRaw);
      if (w.kind === "invalid" || s.kind === "invalid") { ignored++; continue; }
      if (w.kind === "ok") {
        weightAll += w.value;
        if (w.value > 0) weightRows++;
        if (s.kind === "ok") {
          sumWeighted += s.value * w.value;
          weightUsed += w.value;
          counted++;
        }
      }
    }
    var average = weightUsed > 0 ? sumWeighted / weightUsed : null;
    return {
      average: average,
      weightUsed: round2(weightUsed), weightAll: round2(weightAll),
      ignored: ignored, counted: counted, weightRows: weightRows
    };
  }

  // 표준 US 10점 스케일(+/- 3~4점 간격). 학교/강사마다 컷오프가 다르므로 FAQ 에서 참고용임을 안내.
  var THRESHOLDS = [
    [97, "A+"], [93, "A"], [90, "A-"], [87, "B+"], [83, "B"], [80, "B-"],
    [77, "C+"], [73, "C"], [70, "C-"], [67, "D+"], [63, "D"], [60, "D-"]
  ];
  function letterGrade(avg) {
    if (avg == null || !isFinite(avg)) return null;
    for (var i = 0; i < THRESHOLDS.length; i++) if (avg >= THRESHOLDS[i][0]) return THRESHOLDS[i][1];
    return "F";
  }

  // node/브라우저 콘솔 검증용 노출 (UI 상태 아님)
  if (typeof window !== "undefined") {
    window.__GRADE_TEST = {
      parseScoreField: parseScoreField, parseWeightField: parseWeightField,
      computeGrade: computeGrade, letterGrade: letterGrade, round2: round2
    };
  }

  /* ---- 숫자 표시 (Intl, 현재 언어) ---- */
  function nf(n, maxFrac) {
    try {
      var lang = window.I18N && window.I18N.lang();
      return Number(n).toLocaleString(lang || undefined, { maximumFractionDigits: maxFrac == null ? 1 : maxFrac });
    } catch (e) { return String(n); }
  }

  /* ---- DOM 참조 (없으면 여기서 종료 — 순수 로직은 위에서 이미 export 됨) ---- */
  var rowsEl = document.getElementById("grade-rows");
  var addBtn = document.getElementById("grade-add");
  var resultEl = document.getElementById("grade-result");
  var copyBtn = document.getElementById("grade-copy");
  var clearBtn = document.getElementById("grade-clear");
  var statusEl = document.getElementById("grade-status");
  if (!rowsEl || !resultEl) return;

  var LS_KEY = (cfg.slug || "grade-calc") + ":state";
  var lastSummary = "";

  /* ---- 입력 정리: 가중치는 숫자+소수점만 (음수 불허) ---- */
  function cleanWeightInput(el) {
    var v = el.value;
    var d = v.replace(/[^\d.]/g, "");
    var fi = d.indexOf(".");
    if (fi !== -1) d = d.slice(0, fi + 1) + d.slice(fi + 1).replace(/\./g, "");
    if (d !== v) {
      var pos = el.selectionStart;
      el.value = d;
      try { if (pos != null) el.setSelectionRange(d.length, d.length); } catch (e) { /* noop */ }
    }
  }

  /* ---- 행 생성 ---- */
  function buildRow(data) {
    data = data || {};
    var row = document.createElement("div");
    row.className = "grade-row";

    var name = document.createElement("input");
    name.type = "text"; name.className = "grade-name"; name.autocomplete = "off";
    name.value = data.name || "";
    name.setAttribute("data-i18n-placeholder", "tool.name.ph");
    name.setAttribute("data-i18n-aria-label", "tool.col.name");
    name.placeholder = t("tool.name.ph");
    name.setAttribute("aria-label", t("tool.col.name"));

    var score = document.createElement("input");
    score.type = "text"; score.className = "grade-score"; score.inputMode = "decimal"; score.autocomplete = "off";
    score.value = data.score || "";
    score.setAttribute("data-i18n-placeholder", "tool.score.ph");
    score.setAttribute("data-i18n-aria-label", "tool.col.score");
    score.placeholder = t("tool.score.ph");
    score.setAttribute("aria-label", t("tool.col.score"));

    var weight = document.createElement("input");
    weight.type = "text"; weight.className = "grade-weight"; weight.inputMode = "decimal"; weight.autocomplete = "off";
    weight.value = data.weight || "";
    weight.setAttribute("data-i18n-placeholder", "tool.weight.ph");
    weight.setAttribute("data-i18n-aria-label", "tool.col.weight");
    weight.placeholder = t("tool.weight.ph");
    weight.setAttribute("aria-label", t("tool.col.weight"));

    var rm = document.createElement("button");
    rm.type = "button"; rm.className = "grade-remove";
    rm.setAttribute("data-i18n-aria-label", "tool.remove");
    rm.setAttribute("aria-label", t("tool.remove"));
    rm.innerHTML = "&times;";

    row.appendChild(name); row.appendChild(score); row.appendChild(weight); row.appendChild(rm);

    name.addEventListener("input", onChange);
    score.addEventListener("input", onChange);
    weight.addEventListener("input", function () { cleanWeightInput(weight); onChange(); });
    rm.addEventListener("click", function () { removeRow(row); });
    return row;
  }

  function addRow(data) { rowsEl.appendChild(buildRow(data)); }
  function removeRow(row) {
    if (row && row.parentNode === rowsEl) rowsEl.removeChild(row);
    if (!rowsEl.querySelector(".grade-row")) addRow({}); // 최소 1행 유지
    onChange();
  }

  function gatherRows() {
    var out = [], rows = rowsEl.querySelectorAll(".grade-row");
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      out.push({
        name: r.querySelector(".grade-name").value,
        scoreRaw: r.querySelector(".grade-score").value,
        weightRaw: r.querySelector(".grade-weight").value
      });
    }
    return out;
  }

  /* ---- 상태 저장/복원 ---- */
  function saveState() {
    try {
      var rows = gatherRows().map(function (r) {
        return { name: r.name, score: r.scoreRaw, weight: r.weightRaw };
      });
      localStorage.setItem(LS_KEY, JSON.stringify({ rows: rows }));
    } catch (e) { /* private mode */ }
  }
  function loadState() {
    try { var raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }

  /* ---- 렌더 ---- */
  function cell(label, value, note) {
    return '<div><dt>' + escHtml(label) + '</dt><dd>' + value +
      (note ? '<span class="grade-cell-note">' + escHtml(note) + '</span>' : '') + '</dd></div>';
  }
  function showStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text;
    clearTimeout(showStatus._t);
    showStatus._t = setTimeout(function () { if (statusEl) statusEl.textContent = ""; }, 1800);
  }

  function render() {
    if (!resultEl) return;
    var res = computeGrade(gatherRows());

    var noticeHtml = (res.ignored > 0)
      ? '<p class="grade-note">ⓘ ' + escHtml(fmt(t("tool.note.ignored"), { n: res.ignored })) + '</p>' : "";

    if (res.counted === 0) {
      lastSummary = "";
      resultEl.innerHTML = noticeHtml + '<p class="grade-hint">' + escHtml(t("tool.res.hint")) + '</p>';
      return;
    }

    if (!isFinite(res.average) || Math.abs(res.average) > BOUND) {
      lastSummary = "";
      resultEl.innerHTML = '<p class="grade-note">ⓘ ' + escHtml(t("tool.note.extreme")) + '</p>';
      return;
    }

    var avg = res.average;
    var letter = letterGrade(avg);
    var html = noticeHtml;

    html += '<div class="grade-heroLabel">' + escHtml(t("tool.res.avgLabel")) + '</div>';
    html += '<div class="grade-hero-row">';
    html += '<div class="grade-big">' + escHtml(nf(avg)) + '%</div>';
    html += '<div class="grade-letter">' + escHtml(letter) + '</div>';
    html += '</div>';

    html += '<dl class="grade-cards">';
    html += cell(t("tool.res.weightLabel"), escHtml(nf(res.weightAll)) + '%', t("tool.res.weightNote"));
    html += '</dl>';

    var diff = round2(res.weightAll - 100);
    if (Math.abs(diff) > 0.05) {
      var warnKey = diff < 0 ? "tool.warn.under" : "tool.warn.over";
      html += '<p class="grade-warn">⚠ ' + escHtml(fmt(t(warnKey), { pct: nf(res.weightAll) })) + '</p>';
    }

    html += '<p class="grade-disclaimer">' + escHtml(t("tool.disclaimer")) + '</p>';

    resultEl.innerHTML = html;

    lastSummary = fmt(t("tool.copy.text"), { avg: nf(avg), letter: letter, weight: nf(res.weightAll) });
  }

  function onChange() { saveState(); render(); }

  /* ---- 복사 ---- */
  function copyFallback(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      showStatus(ok ? t("tool.copied") : t("tool.copyFail"));
    } catch (e) { showStatus(t("tool.copyFail")); }
  }
  function copyText(text) {
    if (!text) { showStatus(t("tool.res.hint")); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { showStatus(t("tool.copied")); },
        function () { copyFallback(text); }
      );
    } else { copyFallback(text); }
  }

  /* ---- 이벤트 ---- */
  if (addBtn) addBtn.addEventListener("click", function () { addRow({}); onChange(); });
  if (copyBtn) copyBtn.addEventListener("click", function () { copyText(lastSummary); });
  if (clearBtn) clearBtn.addEventListener("click", function () {
    rowsEl.innerHTML = "";
    for (var i = 0; i < 4; i++) addRow({});
    onChange();
  });

  // 언어 전환 시 결과 재렌더 (엔진이 정적 라벨·placeholder·aria 는 이미 갱신)
  document.addEventListener("i18n:change", render);

  /* ---- 초기화 ---- */
  var st = loadState();
  if (st && st.rows && st.rows.length) {
    for (var i = 0; i < st.rows.length; i++) addRow(st.rows[i]);
  } else {
    for (var j = 0; j < 4; j++) addRow({});
  }
  render();
  // TOOLJS:END
})();
