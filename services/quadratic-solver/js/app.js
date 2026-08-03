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
  /* Quadratic Equation Solver — ax² + bx + c = 0 via the quadratic formula.
     Discriminant D = b² − 4ac decides the root kind (two real / repeated / complex).
     a = 0 falls back to the linear equation bx + c = 0 (or identity/contradiction
     when b is also 0). State: localStorage "<slug>:state" only. No external API —
     every computation runs locally. */

  var MAX_COEF = 1e12; // 극단값 캡 — 입력 범위 안전선 (계산기 실사용 범위를 넉넉히 초과)

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */

  // 계수 파싱: 빈값/유효하지 않음/범위초과를 구분해 호출부가 각각 다른 문구를 고르게 한다
  function parseCoef(raw) {
    var s = String(raw == null ? "" : raw).replace(/,/g, "").trim();
    if (s === "") return { empty: true };
    var n = Number(s);
    if (!isFinite(n)) return { error: "invalid" };
    if (Math.abs(n) > MAX_COEF) return { error: "range" };
    return { value: n };
  }

  // Infinity/NaN을 안전한 유한값으로 (a가 극도로 작을 때의 나눗셈 폭주 방어)
  function safeNum(v) {
    if (typeof v !== "number" || isNaN(v)) return 0;
    var CAP = Number.MAX_SAFE_INTEGER;
    if (v === Infinity) return CAP;
    if (v === -Infinity) return -CAP;
    return v;
  }

  // 표시용 반올림 — Number.EPSILON으로 부동소수 잡음만 걷어낸다
  function round(n, places) {
    if (places == null) places = 6;
    var m = Math.pow(10, places);
    var bump = n >= 0 ? Number.EPSILON : -Number.EPSILON;
    return Math.round((n + bump) * m) / m;
  }

  /* ax² + bx + c = 0 풀이.
     kind: "identity"(a=b=0,c=0, 해 무한) | "contradiction"(a=b=0,c≠0, 해 없음) |
           "linear"(a=0,b≠0, 1차식) | "two-real"(D>0) | "repeated"(D=0) | "complex"(D<0)
     복소수근은 켤레쌍이므로 im은 항상 0 이상(부호는 표시 시 ±로 처리). */
  function solveQuadratic(a, b, c) {
    if (a === 0) {
      if (b === 0) {
        if (c === 0) return { kind: "identity" };
        return { kind: "contradiction", c: c };
      }
      var xLin = round(safeNum(-c / b), 10);
      return { kind: "linear", x: xLin, b: b, c: c };
    }
    var d = b * b - 4 * a * c;
    var twoA = 2 * a;
    var h = round(safeNum(-b / twoA), 10);
    var k = round(safeNum(c - (b * b) / (4 * a)), 10);
    if (d > 0) {
      var sq = Math.sqrt(d);
      var x1 = round(safeNum((-b + sq) / twoA), 10);
      var x2 = round(safeNum((-b - sq) / twoA), 10);
      return { kind: "two-real", d: d, x1: x1, x2: x2, h: h, k: k };
    }
    if (d === 0) {
      var xr = round(safeNum(-b / twoA), 10);
      return { kind: "repeated", d: d, x: xr, h: h, k: k };
    }
    var sqNeg = Math.sqrt(-d);
    var re = round(safeNum(-b / twoA), 10);
    var im = round(Math.abs(safeNum(sqNeg / twoA)), 10);
    return { kind: "complex", d: d, re: re, im: im, h: h, k: k };
  }

  // 방정식 미리보기 문자열: "2x² − 3x + 5 = 0" 형태 (0인 항은 생략, ±1 계수는 숫자 생략)
  function formatEquation(a, b, c, numFmt) {
    var terms = [];
    function push(coefRaw, suffix) {
      if (coefRaw === 0) return;
      var neg = coefRaw < 0;
      var absC = Math.abs(coefRaw);
      var numPart = (absC === 1 && suffix) ? "" : numFmt(absC);
      terms.push({ neg: neg, text: numPart + suffix });
    }
    push(a, "x²");
    push(b, "x");
    if (c !== 0) terms.push({ neg: c < 0, text: numFmt(Math.abs(c)) });
    if (!terms.length) return "0 = 0";
    var out = "";
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      out += i === 0 ? (t.neg ? "−" : "") + t.text : (t.neg ? " − " : " + ") + t.text;
    }
    return out + " = 0";
  }

  /* 실근일 때의 인수분해 형태: a(x − x₁)(x − x₂). a=1이면 계수 생략, a=−1이면 "−".
     근이 0이면 (x), 음수면 (x + |r|). 복소근/1차식에는 쓰지 않는다. */
  function factoredForm(a, roots, numFmt) {
    var lead = a === 1 ? "" : (a === -1 ? "−" : numFmt(a));
    var out = lead;
    for (var i = 0; i < roots.length; i++) {
      var r = roots[i];
      out += r === 0 ? "(x)" : "(x " + (r > 0 ? "− " : "+ ") + numFmt(Math.abs(r)) + ")";
    }
    return out;
  }

  // node 검증용 노출 — 브라우저에는 module이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseCoef: parseCoef, solveQuadratic: solveQuadratic,
      round: round, safeNum: safeNum, formatEquation: formatEquation,
      factoredForm: factoredForm,
      MAX_COEF: MAX_COEF
    };
    return;
  }

  /* ---- i18n · 표시 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var STORE_KEY = (CFG.slug || "quadratic-solver") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function fmt(str, params) {
    return String(str == null ? "" : str).replace(/\{(\w+)\}/g, function (m, k) {
      return (params && params[k] != null) ? String(params[k]) : m;
    });
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function numFmt(n, maxDec) {
    try { return new Intl.NumberFormat(uiLang(), { maximumFractionDigits: maxDec == null ? 6 : maxDec }).format(n); }
    catch (e) { return String(n); }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var aEl = $("a-input"), bEl = $("b-input"), cEl = $("c-input");
  var eqEl = $("tool-eq"), errEl = $("tool-err");
  var emptyEl = $("result-empty"), noteEl = $("result-note"), badgeEl = $("result-badge");
  var gridEl = $("result-grid"), copyHintEl = $("copy-hint");
  var detailsEl = $("tool-more");
  var formulaLine = $("step-formula"), substLine = $("step-substituted"), discLine = $("step-discriminant");
  var finalLine = $("step-final"), linearLine = $("step-linear");
  var factoredLine = $("step-factored"), vertexLine = $("step-vertex"), axisLine = $("step-axis");
  if (!aEl || !bEl || !cEl || !gridEl) return;
  var card1 = gridEl.querySelector('[data-copy="x1"]');
  var card2 = gridEl.querySelector('[data-copy="x2"]');

  /* ---- 카드 값 세팅 ---- */
  function setCard(card, label, value) {
    if (!card) return;
    var labelEl = card.querySelector(".rc-label");
    var valEl = card.querySelector(".rc-value");
    if (labelEl) labelEl.textContent = label;
    if (valEl) valEl.textContent = value;
    card.setAttribute("data-value", value);
  }

  function hideAllSteps() {
    [formulaLine, substLine, discLine, finalLine, linearLine, factoredLine, vertexLine, axisLine].forEach(function (el) {
      if (el) el.hidden = true;
    });
  }

  /* ---- 렌더 ---- */
  function render() {
    errEl.hidden = true; noteEl.hidden = true; badgeEl.hidden = true; gridEl.hidden = true;
    copyHintEl.hidden = true; emptyEl.hidden = true; eqEl.hidden = true; detailsEl.hidden = true;
    hideAllSteps();

    var pa = parseCoef(aEl.value), pb = parseCoef(bEl.value), pc = parseCoef(cEl.value);
    if (pa.empty || pb.empty || pc.empty) { emptyEl.hidden = false; return; }
    if (pa.error || pb.error || pc.error) {
      var anyRange = pa.error === "range" || pb.error === "range" || pc.error === "range";
      errEl.textContent = anyRange
        ? fmt(tr("tool.err.range", "Please keep coefficients between -{max} and {max}"), { max: numFmt(MAX_COEF, 0) })
        : tr("tool.err.invalid", "Please enter valid numbers for a, b, and c");
      errEl.hidden = false;
      return;
    }

    var a = pa.value, b = pb.value, c = pc.value;
    eqEl.textContent = fmt(tr("tool.solving", "Solving: {eq}"), { eq: formatEquation(a, b, c, function (n) { return numFmt(n, 6); }) });
    eqEl.hidden = false;

    var r = solveQuadratic(a, b, c);

    if (r.kind === "identity") {
      noteEl.textContent = tr("tool.note.identity",
        "With a = 0, b = 0, and c = 0, the equation becomes 0 = 0, which is true for every value of x — every real number is a solution.");
      noteEl.hidden = false;
      return;
    }
    if (r.kind === "contradiction") {
      noteEl.textContent = fmt(tr("tool.note.contradiction",
        "With a = 0 and b = 0, the equation becomes 0 = {c}, which is never true — this equation has no solution."),
        { c: numFmt(r.c, 6) });
      noteEl.hidden = false;
      return;
    }
    if (r.kind === "linear") {
      badgeEl.textContent = tr("tool.badge.linear", "Linear equation (a = 0)");
      badgeEl.hidden = false;
      noteEl.textContent = fmt(tr("tool.note.linearIntro", "a = 0, so this isn't a quadratic equation — it's linear: {b}x + {c} = 0."),
        { b: numFmt(r.b, 6), c: numFmt(r.c, 6) });
      noteEl.hidden = false;
      setCard(card1, tr("tool.res.x", "x"), numFmt(r.x, 8));
      if (card2) card2.hidden = true;
      gridEl.style.gridTemplateColumns = "1fr";
      gridEl.hidden = false;
      copyHintEl.hidden = false;

      linearLine.textContent = fmt(tr("tool.steps.linearWork", "Solve for x: {b}x + {c} = 0 → {b}x = −({c}) → x = −({c}) ÷ {b} = {x}"),
        { b: numFmt(r.b, 6), c: numFmt(r.c, 6), x: numFmt(r.x, 8) });
      linearLine.hidden = false;
      detailsEl.hidden = false;
      return;
    }

    // quadratic path: two-real / repeated / complex — 공통 스텝(공식·대입·판별식)
    formulaLine.textContent = tr("tool.steps.formula", "Quadratic formula: x = (−b ± √(b² − 4ac)) / (2a)");
    formulaLine.hidden = false;
    substLine.textContent = fmt(tr("tool.steps.substituted",
      "Substitute a = {a}, b = {b}, c = {c}: x = (−({b}) ± √(({b})² − 4·({a})·({c}))) / (2·({a}))"),
      { a: numFmt(a, 6), b: numFmt(b, 6), c: numFmt(c, 6) });
    substLine.hidden = false;
    discLine.textContent = fmt(tr("tool.steps.discriminant", "Discriminant: D = b² − 4ac = {d}"), { d: numFmt(r.d, 6) });
    discLine.hidden = false;

    if (r.kind === "two-real") {
      badgeEl.textContent = tr("tool.badge.twoReal", "Two real roots");
      setCard(card1, tr("tool.res.x1", "x₁"), numFmt(r.x1, 8));
      setCard(card2, tr("tool.res.x2", "x₂"), numFmt(r.x2, 8));
      if (card2) card2.hidden = false;
      gridEl.style.gridTemplateColumns = "1fr 1fr";
      finalLine.textContent = fmt(tr("tool.steps.finalTwoReal", "x = (−({b}) ± √{d}) / {twoA} → x₁ = {x1}, x₂ = {x2}"),
        { b: numFmt(b, 6), d: numFmt(r.d, 6), twoA: numFmt(2 * a, 6), x1: numFmt(r.x1, 8), x2: numFmt(r.x2, 8) });
      finalLine.hidden = false;
      factoredLine.textContent = fmt(tr("tool.factored.value", "Factored form: {expr} = 0"),
        { expr: factoredForm(a, [r.x1, r.x2], function (n) { return numFmt(n, 8); }) });
      factoredLine.hidden = false;
    } else if (r.kind === "repeated") {
      badgeEl.textContent = tr("tool.badge.repeated", "One repeated root (double root)");
      setCard(card1, tr("tool.res.x", "x"), numFmt(r.x, 8));
      if (card2) card2.hidden = true;
      gridEl.style.gridTemplateColumns = "1fr";
      noteEl.textContent = fmt(tr("tool.note.repeated", "Both roots equal {x} — the parabola touches the x-axis at exactly one point."),
        { x: numFmt(r.x, 8) });
      noteEl.hidden = false;
      finalLine.textContent = fmt(tr("tool.steps.finalRepeated", "x = −({b}) / {twoA} = {x} (double root)"),
        { b: numFmt(b, 6), twoA: numFmt(2 * a, 6), x: numFmt(r.x, 8) });
      finalLine.hidden = false;
      factoredLine.textContent = fmt(tr("tool.factored.value", "Factored form: {expr} = 0"),
        { expr: factoredForm(a, [r.x, r.x], function (n) { return numFmt(n, 8); }) });
      factoredLine.hidden = false;
    } else { // complex
      badgeEl.textContent = tr("tool.badge.complex", "Two complex roots");
      var reTxt = numFmt(r.re, 6), imTxt = numFmt(r.im, 6);
      setCard(card1, tr("tool.res.x1", "x₁"), reTxt + " + " + imTxt + "i");
      setCard(card2, tr("tool.res.x2", "x₂"), reTxt + " − " + imTxt + "i");
      if (card2) card2.hidden = false;
      gridEl.style.gridTemplateColumns = "1fr 1fr";
      finalLine.textContent = fmt(tr("tool.steps.finalComplex", "x = (−({b}) ± √({d})) / {twoA} = {re} ± {im}i"),
        { b: numFmt(b, 6), d: numFmt(r.d, 6), twoA: numFmt(2 * a, 6), re: reTxt, im: imTxt });
      finalLine.hidden = false;
    }

    badgeEl.hidden = false;
    gridEl.hidden = false;
    copyHintEl.hidden = false;

    vertexLine.textContent = fmt(tr("tool.vertex.value", "Vertex: ({h}, {k})"), { h: numFmt(r.h, 6), k: numFmt(r.k, 6) });
    vertexLine.hidden = false;
    axisLine.textContent = fmt(tr("tool.axis.value", "Axis of symmetry: x = {h}"), { h: numFmt(r.h, 6) });
    axisLine.hidden = false;
    detailsEl.hidden = false;
  }

  /* ---- 클릭 복사 ---- */
  var copiedTimers = {};
  function flashCopied(card) {
    var labelEl = card.querySelector(".rc-label");
    if (!labelEl) return;
    var key = card.getAttribute("data-copy");
    var restore = labelEl.getAttribute("data-restore-label") || labelEl.textContent;
    labelEl.setAttribute("data-restore-label", restore);
    labelEl.textContent = tr("tool.copied", "Copied");
    if (copiedTimers[key]) clearTimeout(copiedTimers[key]);
    copiedTimers[key] = setTimeout(function () {
      labelEl.textContent = labelEl.getAttribute("data-restore-label") || restore;
    }, 1100);
  }
  function legacyCopy(text, done) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch (e) { /* 복사 미지원 — 표시값은 그대로 남는다 */ }
  }
  function copyCard(card) {
    var raw = card.getAttribute("data-value");
    if (raw == null || card.hidden) return;
    var done = function () { flashCopied(card); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(raw).then(done, function () { legacyCopy(raw, done); });
      } else {
        legacyCopy(raw, done);
      }
    } catch (e) {
      legacyCopy(raw, done);
    }
  }
  [card1, card2].forEach(function (card) {
    if (card) card.addEventListener("click", function () { copyCard(card); });
  });

  /* ---- 이벤트 ---- */
  function onEnter(e) {
    if (e.key !== "Enter") return;
    render();
    if (e.target && e.target.blur) e.target.blur();
  }
  [aEl, bEl, cEl].forEach(function (el) {
    el.addEventListener("input", function () { render(); saveState(); });
    el.addEventListener("keydown", onEnter);
  });

  // 언어 전환 시 배지·문구·플레이스홀더 재적용
  document.addEventListener("i18n:change", render);

  /* ---- 상태 저장/복원 ---- */
  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ a: aEl.value, b: bEl.value, c: cEl.value }));
    } catch (e) { /* private mode */ }
  }
  function restoreState() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { s = null; }
    if (!s) return;
    if (typeof s.a === "string") aEl.value = s.a;
    if (typeof s.b === "string") bEl.value = s.b;
    if (typeof s.c === "string") cEl.value = s.c;
  }

  /* ---- 초기화 ---- */
  restoreState();
  render();
  // TOOLJS:END
})();
