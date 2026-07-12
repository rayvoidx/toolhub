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
  // gpa-calc — semester / cumulative GPA on 4.0·4.3·4.5 scales (spec: factory/state/gpa-calc.yaml)
  // 전부 브라우저 로컬. 외부 API 없음. 상태는 localStorage "gpa-calc:state".
  var cfg = window.APP_CONFIG || {};

  /* ---- 스케일 테이블 (canonical grade key 로 스케일 간 매핑 유지) ----
     k = canonical key(스케일 전환 시 보존), label = 표시, p = grade point, excl = P/NP(제외) */
  var SCALES = {
    us40: { max: 4.0, weighted: true, grades: [
      { k: "Ap", label: "A+", p: 4.0 }, { k: "A", label: "A", p: 4.0 }, { k: "Am", label: "A-", p: 3.7 },
      { k: "Bp", label: "B+", p: 3.3 }, { k: "B", label: "B", p: 3.0 }, { k: "Bm", label: "B-", p: 2.7 },
      { k: "Cp", label: "C+", p: 2.3 }, { k: "C", label: "C", p: 2.0 }, { k: "Cm", label: "C-", p: 1.7 },
      { k: "Dp", label: "D+", p: 1.3 }, { k: "D", label: "D", p: 1.0 }, { k: "Dm", label: "D-", p: 0.7 },
      { k: "F", label: "F", p: 0.0 }, { k: "P", label: "P", p: null, excl: true }, { k: "NP", label: "NP", p: null, excl: true }
    ] },
    kr45: { max: 4.5, weighted: false, grades: [
      { k: "Ap", label: "A+", p: 4.5 }, { k: "A", label: "A0", p: 4.0 }, { k: "Bp", label: "B+", p: 3.5 },
      { k: "B", label: "B0", p: 3.0 }, { k: "Cp", label: "C+", p: 2.5 }, { k: "C", label: "C0", p: 2.0 },
      { k: "Dp", label: "D+", p: 1.5 }, { k: "D", label: "D0", p: 1.0 }, { k: "F", label: "F", p: 0.0 },
      { k: "P", label: "P", p: null, excl: true }, { k: "NP", label: "NP", p: null, excl: true }
    ] },
    kr43: { max: 4.3, weighted: false, grades: [
      { k: "Ap", label: "A+", p: 4.3 }, { k: "A", label: "A0", p: 4.0 }, { k: "Bp", label: "B+", p: 3.3 },
      { k: "B", label: "B0", p: 3.0 }, { k: "Cp", label: "C+", p: 2.3 }, { k: "C", label: "C0", p: 2.0 },
      { k: "Dp", label: "D+", p: 1.3 }, { k: "D", label: "D0", p: 1.0 }, { k: "F", label: "F", p: 0.0 },
      { k: "P", label: "P", p: null, excl: true }, { k: "NP", label: "NP", p: null, excl: true }
    ] }
  };
  var BOOST = { reg: 0, hon: 0.5, ap: 1.0 };

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

  /* ---- 순수 계산 로직 (node 검증 대상) ---- */
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function fx2(n) { if (n == null || !isFinite(n)) return "—"; return (Math.round(n * 100) / 100).toFixed(2); }
  function fx1(n) { if (n == null || !isFinite(n)) return "—"; return (Math.round(n * 10) / 10).toFixed(1); }

  /** 표시 문자열 → 숫자. 콤마(자릿구분) 제거, 부호·소수점 1개만 인정. 실패 시 NaN */
  function parseNum(str) {
    if (str == null) return NaN;
    var s = String(str).replace(/,/g, "").trim();
    if (s === "" || s === "-" || s === "." || s === "-.") return NaN;
    if (!/^-?\d*\.?\d*$/.test(s)) return NaN;
    return parseFloat(s);
  }

  function findGrade(scale, key) {
    if (!key) return null;
    for (var i = 0; i < scale.grades.length; i++) if (scale.grades[i].k === key) return scale.grades[i];
    return null;
  }

  /**
   * 핵심 GPA 계산.
   * rows: [{ creditRaw, gradeKey, type }]
   *  - 유효 행 = grade 선택 && grade∉{P,NP} && credits 가 양수(>0)
   *  - credits 공백/0/P·NP/grade 미선택 → 조용히 제외
   *  - credits 가 음수·비수치(비어있지 않은 잘못된 값) → ignored 카운트(안내)
   */
  function computeGPA(rows, scaleKey, weighted) {
    var scale = SCALES[scaleKey];
    if (!scale) return null;
    var sumCredits = 0, sumQP = 0, sumQPw = 0, ignored = 0, counted = 0;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || {};
      var g = findGrade(scale, row.gradeKey);
      if (!g || g.excl) continue;                    // grade 미선택 또는 P/NP → 제외
      var raw = row.creditRaw == null ? "" : String(row.creditRaw).trim();
      if (raw === "") continue;                       // credits 공백 + grade 있음 → 조용히 제외
      var c = parseNum(raw);
      if (isNaN(c) || c < 0) { ignored++; continue; } // 음수·비수치 → 안내 후 제외
      if (c === 0) continue;                          // 0학점 → 제외
      counted++;
      sumCredits += c;
      sumQP += g.p * c;
      if (weighted && scale.weighted) {
        var boost = (row.gradeKey === "F") ? 0 : (BOOST[row.type] || 0);
        sumQPw += (g.p + boost) * c;
      }
    }
    var gpa = sumCredits > 0 ? sumQP / sumCredits : null;
    var gpaW = (weighted && scale.weighted && sumCredits > 0) ? sumQPw / sumCredits : null;
    return {
      sumCredits: round2(sumCredits), sumQP: round2(sumQP), sumQPw: round2(sumQPw),
      counted: counted, ignored: ignored, gpa: gpa, gpaW: gpaW
    };
  }

  /** 누적 GPA: (현재 quality points + priorGPA·priorCredits) / (현재 credits + priorCredits) */
  function computeCumulative(currentQP, currentCredits, priorGPA, priorCredits) {
    var totalCredits = currentCredits + priorCredits;
    if (!(totalCredits > 0)) return null;
    return (currentQP + priorGPA * priorCredits) / totalCredits;
  }

  /** 선형 근사 스케일 환산 (참고용) */
  function convert(gpa, scaleMax) {
    if (gpa == null || !(scaleMax > 0)) return { s40: null, s43: null, s45: null, pct: null };
    var r = gpa / scaleMax;
    return { s40: r * 4.0, s43: r * 4.3, s45: r * 4.5, pct: r * 100 };
  }

  // node 단위 검증 훅 (UI 상태 저장 아님)
  if (typeof window !== "undefined") {
    window.__GPA_TEST = {
      SCALES: SCALES, BOOST: BOOST, computeGPA: computeGPA,
      computeCumulative: computeCumulative, convert: convert, parseNum: parseNum, round2: round2
    };
  }

  /* ---- 숫자 표시 (Intl, 현재 언어) — 학점/QP 용. GPA 값은 학술 표기라 점(.) 고정 ---- */
  function nf(n) {
    try {
      var lang = window.I18N && window.I18N.lang();
      return Number(n).toLocaleString(lang || undefined, { maximumFractionDigits: 2 });
    } catch (e) { return String(n); }
  }

  /* ---- DOM 참조 (node 검증 시 전부 null — 모든 사용처 가드) ---- */
  var scaleEl = document.getElementById("gpa-scale");
  var weightedEl = document.getElementById("gpa-weighted");
  var weightedWrap = document.getElementById("gpa-weighted-wrap");
  var headEl = document.getElementById("gpa-head");
  var rowsEl = document.getElementById("gpa-rows");
  var addBtn = document.getElementById("gpa-add");
  var cumulEl = document.getElementById("gpa-cumul");
  var priorGpaEl = document.getElementById("gpa-prior-gpa");
  var priorCreditsEl = document.getElementById("gpa-prior-credits");
  var resultEl = document.getElementById("gpa-result");
  var copyBtn = document.getElementById("gpa-copy");
  var clearBtn = document.getElementById("gpa-clear");
  var statusEl = document.getElementById("gpa-status");

  // DOM 이 없으면(=node 검증 환경) 여기서 종료 — 순수 로직은 위에서 export 됨
  if (!rowsEl || !resultEl || !scaleEl) return;

  var LS_KEY = (cfg.slug || "gpa-calc") + ":state";
  var lastSummary = "";
  var MAXV = Number.MAX_SAFE_INTEGER;

  function currentScale() { return SCALES[scaleEl.value] || SCALES.us40; }
  function isWeighted() { return scaleEl.value === "us40" && !!(weightedEl && weightedEl.checked); }

  /* ---- 입력 정리 ---- */
  function cleanCredit(el) {
    var v = el.value;
    var neg = /^\s*-/.test(v);
    var d = v.replace(/[^\d.]/g, "");
    var fi = d.indexOf(".");
    if (fi !== -1) d = d.slice(0, fi + 1) + d.slice(fi + 1).replace(/\./g, "");
    var out = (neg ? "-" : "") + d;
    if (out !== v) {
      var pos = el.selectionStart;
      el.value = out;
      try { if (pos != null) el.setSelectionRange(out.length, out.length); } catch (e) { /* noop */ }
    }
  }

  /* ---- select 채우기 ---- */
  function populateGradeSelect(sel, scale, keepKey) {
    var cur = keepKey != null ? keepKey : sel.value;
    sel.innerHTML = "";
    var o0 = document.createElement("option");
    o0.value = ""; o0.textContent = "—";
    sel.appendChild(o0);
    var exists = cur === "";
    for (var i = 0; i < scale.grades.length; i++) {
      var g = scale.grades[i];
      var o = document.createElement("option");
      o.value = g.k; o.textContent = g.label;
      sel.appendChild(o);
      if (g.k === cur) exists = true;
    }
    sel.value = exists ? cur : "";
  }
  function populateTypeSelect(sel, keep) {
    sel.innerHTML = "";
    var opts = [["reg", "tool.type.reg"], ["hon", "tool.type.hon"], ["ap", "tool.type.ap"]];
    for (var i = 0; i < opts.length; i++) {
      var o = document.createElement("option");
      o.value = opts[i][0];
      o.setAttribute("data-i18n", opts[i][1]);
      o.textContent = t(opts[i][1]);
      sel.appendChild(o);
    }
    sel.value = keep || "reg";
  }

  /* ---- 행 생성 ---- */
  function buildRow(data) {
    data = data || {};
    var row = document.createElement("div");
    row.className = "gpa-row";

    var name = document.createElement("input");
    name.type = "text"; name.className = "gpa-name"; name.autocomplete = "off";
    name.value = data.name || "";
    name.setAttribute("data-i18n-placeholder", "tool.course.ph");
    name.setAttribute("data-i18n-aria-label", "tool.col.course");
    name.placeholder = t("tool.course.ph");
    name.setAttribute("aria-label", t("tool.col.course"));

    var credit = document.createElement("input");
    credit.type = "text"; credit.className = "gpa-credit"; credit.inputMode = "decimal"; credit.autocomplete = "off";
    credit.value = data.credit || "";
    credit.setAttribute("data-i18n-placeholder", "tool.credits.ph");
    credit.setAttribute("data-i18n-aria-label", "tool.col.credits");
    credit.placeholder = t("tool.credits.ph");
    credit.setAttribute("aria-label", t("tool.col.credits"));

    var grade = document.createElement("select");
    grade.className = "gpa-grade";
    grade.setAttribute("data-i18n-aria-label", "tool.col.grade");
    grade.setAttribute("aria-label", t("tool.col.grade"));
    populateGradeSelect(grade, currentScale(), data.grade || "");

    var type = document.createElement("select");
    type.className = "gpa-type";
    type.setAttribute("data-i18n-aria-label", "tool.col.type");
    type.setAttribute("aria-label", t("tool.col.type"));
    populateTypeSelect(type, data.type || "reg");

    var rm = document.createElement("button");
    rm.type = "button"; rm.className = "gpa-remove";
    rm.setAttribute("data-i18n-aria-label", "tool.remove");
    rm.setAttribute("aria-label", t("tool.remove"));
    rm.innerHTML = "&times;";

    row.appendChild(name); row.appendChild(credit); row.appendChild(grade);
    row.appendChild(type); row.appendChild(rm);

    name.addEventListener("input", onChange);
    credit.addEventListener("input", function () { cleanCredit(credit); onChange(); });
    grade.addEventListener("change", onChange);
    type.addEventListener("change", onChange);
    rm.addEventListener("click", function () { removeRow(row); });
    return row;
  }

  function addRow(data) { rowsEl.appendChild(buildRow(data)); }
  function removeRow(row) {
    if (row && row.parentNode === rowsEl) rowsEl.removeChild(row);
    if (!rowsEl.querySelector(".gpa-row")) addRow({}); // 최소 1행 유지
    onChange();
  }

  function gatherRows() {
    var out = [], rows = rowsEl.querySelectorAll(".gpa-row");
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      out.push({
        name: r.querySelector(".gpa-name").value,
        creditRaw: r.querySelector(".gpa-credit").value,
        gradeKey: r.querySelector(".gpa-grade").value,
        type: r.querySelector(".gpa-type").value
      });
    }
    return out;
  }

  function updateWeightedVisibility() {
    var isUs = scaleEl.value === "us40";
    if (weightedWrap) weightedWrap.style.display = isUs ? "" : "none";
    var on = isUs && weightedEl && weightedEl.checked;
    rowsEl.classList.toggle("is-weighted", !!on);
    if (headEl) headEl.classList.toggle("is-weighted", !!on);
  }

  /* ---- 상태 저장/복원 ---- */
  function saveState() {
    try {
      var rows = gatherRows().map(function (r) {
        return { name: r.name, credit: r.creditRaw, grade: r.gradeKey, type: r.type };
      });
      var state = {
        scale: scaleEl.value, weighted: !!(weightedEl && weightedEl.checked),
        prior: { gpa: priorGpaEl ? priorGpaEl.value : "", credits: priorCreditsEl ? priorCreditsEl.value : "" },
        cumulOpen: !!(cumulEl && cumulEl.open), rows: rows
      };
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (e) { /* private mode */ }
  }
  function loadState() {
    try { var raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }

  /* ---- 렌더 ---- */
  function cell(label, value) {
    return '<div><dt>' + escHtml(label) + '</dt><dd>' + value + '</dd></div>';
  }
  function showStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text;
    clearTimeout(showStatus._t);
    showStatus._t = setTimeout(function () { if (statusEl) statusEl.textContent = ""; }, 1800);
  }

  function render() {
    if (!resultEl) return;
    var scaleKey = scaleEl.value;
    var scale = SCALES[scaleKey] || SCALES.us40;
    var weighted = isWeighted();
    var res = computeGPA(gatherRows(), scaleKey, weighted);

    var noticeHtml = (res && res.ignored > 0)
      ? '<p class="gpa-note">ⓘ ' + escHtml(fmt(t("tool.note.ignored"), { n: res.ignored })) + '</p>' : "";

    if (!res || res.counted === 0) {
      lastSummary = "";
      resultEl.innerHTML = noticeHtml + '<p class="gpa-hint">' + escHtml(t("tool.res.hint")) + '</p>';
      return;
    }

    // 극단값 가드 (지수표기/오버플로 방지)
    if (!isFinite(res.gpa) || res.sumCredits > MAXV || res.sumQP > MAXV || (res.gpaW != null && !isFinite(res.gpaW))) {
      lastSummary = "";
      resultEl.innerHTML = '<p class="gpa-note">ⓘ ' + escHtml(t("tool.note.extreme")) + '</p>';
      return;
    }

    var html = noticeHtml;

    // 히어로
    if (weighted && res.gpaW != null) {
      html += '<div class="gpa-heroLabel">' + escHtml(t("tool.res.weightedLabel")) + '</div>';
      html += '<div class="gpa-big">' + escHtml(fx2(res.gpaW)) + '</div>';
      html += '<div class="gpa-sub">' + escHtml(fmt(t("tool.res.unweighted"), { v: fx2(res.gpa) })) + '</div>';
    } else {
      html += '<div class="gpa-heroLabel">' + escHtml(t("tool.res.gpaLabel")) + '</div>';
      html += '<div class="gpa-big">' + escHtml(fx2(res.gpa)) + '</div>';
    }

    // 요약 카드
    html += '<dl class="gpa-cards">';
    html += cell(t("tool.res.credits"), escHtml(nf(res.sumCredits)));
    html += cell(t("tool.res.qp"), escHtml(nf(res.sumQP)));

    // 누적 GPA
    var cum = null, cumTotalCredits = null;
    if (priorCreditsEl && priorGpaEl) {
      var pc = parseNum(priorCreditsEl.value);
      var pg = parseNum(priorGpaEl.value);
      var hasPrior = priorCreditsEl.value.trim() !== "" && !isNaN(pc) && pc > 0 && !isNaN(pg) && pg >= 0;
      if (hasPrior) {
        cum = computeCumulative(res.sumQP, res.sumCredits, pg, pc);
        cumTotalCredits = round2(res.sumCredits + pc);
        if (cum != null && isFinite(cum)) {
          html += cell(t("tool.res.cumulative"),
            escHtml(fx2(cum)) + '<span class="gpa-cell-note">' +
            escHtml(fmt(t("tool.res.over"), { n: nf(cumTotalCredits) })) + '</span>');
        } else { cum = null; }
      }
    }
    html += '</dl>';

    // 스케일 환산 (미가중 GPA 기준)
    var conv = convert(res.gpa, scale.max);
    html += '<div class="gpa-conv"><div class="gpa-conv-title">' + escHtml(t("tool.conv.title")) + '</div>';
    html += '<table class="gpa-conv-t"><tbody>';
    html += '<tr><th>4.0</th><th>4.3</th><th>4.5</th><th>' + escHtml(t("tool.conv.pct")) + '</th></tr>';
    html += '<tr><td>' + escHtml(fx2(conv.s40)) + '</td><td>' + escHtml(fx2(conv.s43)) +
      '</td><td>' + escHtml(fx2(conv.s45)) + '</td><td>' + escHtml(fx1(conv.pct)) + '%</td></tr>';
    html += '</tbody></table>';
    html += '<p class="gpa-conv-note">' + escHtml(t("tool.conv.note")) + '</p></div>';

    resultEl.innerHTML = html;

    // 복사 요약
    var scaleName = t("tool.scale." + scaleKey);
    var lines = [];
    if (weighted && res.gpaW != null) {
      lines.push(fmt(t("tool.copy.textW"), { gpaW: fx2(res.gpaW), gpa: fx2(res.gpa), scale: scaleName, credits: nf(res.sumCredits) }));
    } else {
      lines.push(fmt(t("tool.copy.text"), { gpa: fx2(res.gpa), scale: scaleName, credits: nf(res.sumCredits), qp: nf(res.sumQP) }));
    }
    if (cum != null) lines.push(fmt(t("tool.copy.cumul"), { cum: fx2(cum), n: nf(cumTotalCredits) }));
    lines.push(fmt(t("tool.copy.conv"), { s40: fx2(conv.s40), s43: fx2(conv.s43), s45: fx2(conv.s45), pct: fx1(conv.pct) }));
    lastSummary = lines.join("\n");
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
  scaleEl.addEventListener("change", function () {
    var scale = currentScale();
    var selects = rowsEl.querySelectorAll(".gpa-grade");
    for (var i = 0; i < selects.length; i++) populateGradeSelect(selects[i], scale, selects[i].value);
    updateWeightedVisibility();
    onChange();
  });
  if (weightedEl) weightedEl.addEventListener("change", function () { updateWeightedVisibility(); onChange(); });
  if (addBtn) addBtn.addEventListener("click", function () { addRow({}); onChange(); });
  if (priorGpaEl) priorGpaEl.addEventListener("input", function () { cleanCredit(priorGpaEl); onChange(); });
  if (priorCreditsEl) priorCreditsEl.addEventListener("input", function () { cleanCredit(priorCreditsEl); onChange(); });
  if (cumulEl) cumulEl.addEventListener("toggle", saveState);
  if (copyBtn) copyBtn.addEventListener("click", function () { copyText(lastSummary); });
  if (clearBtn) clearBtn.addEventListener("click", function () {
    rowsEl.innerHTML = "";
    for (var i = 0; i < 5; i++) addRow({});
    if (priorGpaEl) priorGpaEl.value = "";
    if (priorCreditsEl) priorCreditsEl.value = "";
    onChange();
  });

  // 언어 전환 시 결과 재렌더 (엔진이 정적 라벨·placeholder·aria 는 이미 갱신)
  document.addEventListener("i18n:change", render);

  /* ---- 초기화 ---- */
  var st = loadState();
  if (st) {
    if (st.scale && SCALES[st.scale]) scaleEl.value = st.scale;
    if (weightedEl) weightedEl.checked = !!st.weighted;
    if (st.prior) {
      if (priorGpaEl) priorGpaEl.value = st.prior.gpa || "";
      if (priorCreditsEl) priorCreditsEl.value = st.prior.credits || "";
      if (cumulEl && (st.cumulOpen || (st.prior.gpa || st.prior.credits))) cumulEl.open = true;
    }
    var rd = (st.rows && st.rows.length) ? st.rows : null;
    if (rd) { for (var i = 0; i < rd.length; i++) addRow(rd[i]); }
    else { for (var j = 0; j < 5; j++) addRow({}); }
  } else {
    for (var k = 0; k < 5; k++) addRow({});
  }
  updateWeightedVisibility();
  render();
  // TOOLJS:END
})();
