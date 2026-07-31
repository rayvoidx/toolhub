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
  /* Pythagorean Theorem Calculator — a² + b² = c² for right triangles.
     Enter any two of the three sides (leg a, leg b, hypotenuse c) and the
     third is solved live. Enter all three to verify whether they satisfy
     the theorem. State: localStorage "<slug>:state" only. No external API —
     every computation runs locally. */

  var MAX_SIDE = 1e9; // 극단값 캡 — 입력 범위 안전선 (실사용 범위를 넉넉히 초과)

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */

  // 변 길이 파싱: 빈값/유효하지 않음/0 이하/범위초과를 구분해 호출부가 각각 다른 문구를 고르게 한다
  function parseSide(raw) {
    var s = String(raw == null ? "" : raw).replace(/,/g, "").trim();
    if (s === "") return { empty: true };
    var n = Number(s);
    if (!isFinite(n)) return { error: "invalid" };
    if (n <= 0) return { error: "nonpositive" };
    if (n > MAX_SIDE) return { error: "range" };
    return { value: n };
  }

  // 표시용 반올림 — Number.EPSILON으로 부동소수 잡음만 걷어낸다
  function round(n, places) {
    if (places == null) places = 6;
    var m = Math.pow(10, places);
    var bump = n >= 0 ? Number.EPSILON : -Number.EPSILON;
    return Math.round((n + bump) * m) / m;
  }

  /* a, b, c 는 각각 숫자 또는 null(미입력).
     known=2  → 나머지 한 변을 구한다("solve"). c 를 구할 땐 항상 유효하지만,
                다리(a 또는 b)를 구할 땐 빗변이 다른 다리보다 길어야 한다("error").
     known=3  → a² + b² = c² 를 만족하는지 검증한다("verify"). 만족할 때만
                넓이·둘레를 함께 계산한다(만족하지 않으면 직각삼각형이 아니므로
                0.5×a×b 넓이 공식이 성립하지 않는다). */
  function computeTriangle(aIn, bIn, cIn) {
    var known = (aIn != null ? 1 : 0) + (bIn != null ? 1 : 0) + (cIn != null ? 1 : 0);
    if (known < 2) return { mode: "incomplete" };

    if (known === 3) {
      var sumSq = round(aIn * aIn + bIn * bIn, 8);
      var cSq = round(cIn * cIn, 8);
      var tol = Math.max(1e-6 * Math.max(cSq, 1), 1e-9);
      var valid = Math.abs(sumSq - cSq) <= tol;
      var out = { mode: "verify", valid: valid, a: aIn, b: bIn, c: cIn, sumSq: sumSq, cSq: cSq };
      if (valid) {
        out.area = round(0.5 * aIn * bIn, 6);
        out.perimeter = round(aIn + bIn + cIn, 6);
      }
      return out;
    }

    var missing, a, b, c;
    if (aIn == null) {
      missing = "a"; b = bIn; c = cIn;
      if (!(c > b)) return { mode: "error", reason: "hyp" };
      a = round(Math.sqrt(c * c - b * b), 9);
    } else if (bIn == null) {
      missing = "b"; a = aIn; c = cIn;
      if (!(c > a)) return { mode: "error", reason: "hyp" };
      b = round(Math.sqrt(c * c - a * a), 9);
    } else {
      missing = "c"; a = aIn; b = bIn;
      c = round(Math.sqrt(a * a + b * b), 9);
    }
    return {
      mode: "solve", missing: missing, a: a, b: b, c: c,
      area: round(0.5 * a * b, 6), perimeter: round(a + b + c, 6)
    };
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseSide: parseSide, round: round, computeTriangle: computeTriangle, MAX_SIDE: MAX_SIDE
    };
    return;
  }

  /* ---- i18n · 표시 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var STORE_KEY = (CFG.slug || "pythagorean-calc") + ":state";
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
  var aEl = $("side-a"), bEl = $("side-b"), cEl = $("side-c");
  var errEl = $("tool-err");
  var emptyEl = $("result-empty"), badgeEl = $("result-badge"), noteEl = $("result-note");
  var gridEl = $("result-grid"), copyHintEl = $("copy-hint");
  var sideCard = gridEl ? gridEl.querySelector('[data-copy="side"]') : null;
  var areaCard = gridEl ? gridEl.querySelector('[data-copy="area"]') : null;
  var perimCard = gridEl ? gridEl.querySelector('[data-copy="perimeter"]') : null;
  var diagramWrap = $("tool-diagram"), captionEl = $("diagram-caption");
  var shapeEl = $("pyth-shape"), angleEl = $("pyth-angle");
  var labelAEl = $("pyth-label-a"), labelBEl = $("pyth-label-b"), labelCEl = $("pyth-label-c");
  var detailsEl = $("tool-more"), stepMainEl = $("step-main"), stepAreaEl = $("step-area"), stepPerimEl = $("step-perimeter");
  var clearBtn = $("clear-btn");
  var presetBtns = document.querySelectorAll(".triple-preset");
  if (!aEl || !bEl || !cEl || !gridEl) return;

  /* ---- 다이어그램 (직각을 왼쪽 아래 고정, 두 다리 비율만 근사 반영 — 정밀 축척 아님) ---- */
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function renderDiagram(a, b, c) {
    if (!diagramWrap || !shapeEl) return;
    var maxLeg = Math.max(a, b) || 1;
    var scale = 100 / maxLeg;
    var sa = clamp(a * scale, 18, 100);
    var sb = clamp(b * scale, 18, 100);
    var p0x = 34, p0y = 148;
    var p1x = 34, p1y = p0y - sa;
    var p2x = p0x + sb, p2y = p0y;
    shapeEl.setAttribute("points", p1x + "," + p1y + " " + p0x + "," + p0y + " " + p2x + "," + p2y);
    if (angleEl) {
      var m = clamp(Math.min(sa, sb) * 0.28, 5, 11);
      angleEl.setAttribute("points", (p0x + m) + "," + p0y + " " + (p0x + m) + "," + (p0y - m) + " " + p0x + "," + (p0y - m));
    }
    if (labelAEl) { labelAEl.setAttribute("x", p0x - 14); labelAEl.setAttribute("y", (p0y + p1y) / 2 + 4); }
    if (labelBEl) { labelBEl.setAttribute("x", (p0x + p2x) / 2); labelBEl.setAttribute("y", p0y + 18); }
    if (labelCEl) {
      var midx = (p1x + p2x) / 2, midy = (p1y + p2y) / 2;
      labelCEl.setAttribute("x", midx + 14); labelCEl.setAttribute("y", midy - 6);
    }
    if (captionEl) {
      captionEl.textContent = fmt(tr("tool.diagram.caption", "a = {a}, b = {b}, c = {c}"),
        { a: numFmt(a), b: numFmt(b), c: numFmt(c) });
    }
    diagramWrap.hidden = false;
  }

  /* ---- 카드 값 세팅 ---- */
  function setCard(card, label, value) {
    if (!card) return;
    var labelEl = card.querySelector(".rc-label");
    var valEl = card.querySelector(".rc-value");
    if (labelEl) labelEl.textContent = label;
    if (valEl) valEl.textContent = value;
    card.setAttribute("data-value", value);
    card.hidden = false;
  }

  /* ---- 풀이 과정 문구 ---- */
  function renderStepsForSolve(r) {
    if (r.missing === "c") {
      var aSq = round(r.a * r.a, 6), bSq = round(r.b * r.b, 6), sum = round(aSq + bSq, 6);
      stepMainEl.textContent = fmt(tr("tool.steps.solveC", "c = √(a² + b²)\nc = √({a}² + {b}²) = √({aSq} + {bSq})\nc = √{sum} ≈ {result}"), {
        a: numFmt(r.a), b: numFmt(r.b), aSq: numFmt(aSq), bSq: numFmt(bSq), sum: numFmt(sum), result: numFmt(r.c)
      });
    } else {
      var missing = r.missing, other = missing === "a" ? "b" : "a";
      var otherVal = missing === "a" ? r.b : r.a;
      var resultVal = missing === "a" ? r.a : r.b;
      var cSq = round(r.c * r.c, 6), otherSq = round(otherVal * otherVal, 6), diff = round(cSq - otherSq, 6);
      stepMainEl.textContent = fmt(tr("tool.steps.solveLeg", "{missing} = √(c² − {other}²)\n{missing} = √({c}² − {otherVal}²) = √({cSq} − {otherSq})\n{missing} = √{diff} ≈ {result}"), {
        missing: missing, other: other, c: numFmt(r.c), otherVal: numFmt(otherVal),
        cSq: numFmt(cSq), otherSq: numFmt(otherSq), diff: numFmt(diff), result: numFmt(resultVal)
      });
    }
    stepMainEl.hidden = false;
    stepAreaEl.textContent = fmt(tr("tool.steps.area", "Area = ½ × a × b = ½ × {a} × {b} = {area}"),
      { a: numFmt(r.a), b: numFmt(r.b), area: numFmt(r.area) });
    stepAreaEl.hidden = false;
    stepPerimEl.textContent = fmt(tr("tool.steps.perimeter", "Perimeter = a + b + c = {a} + {b} + {c} = {perimeter}"),
      { a: numFmt(r.a), b: numFmt(r.b), c: numFmt(r.c), perimeter: numFmt(r.perimeter) });
    stepPerimEl.hidden = false;
    detailsEl.hidden = false;
  }

  function renderStepsForVerify(r) {
    var aSq = round(r.a * r.a, 6), bSq = round(r.b * r.b, 6);
    stepMainEl.textContent = fmt(tr("tool.steps.verify", "a² + b² = {a}² + {b}² = {aSq} + {bSq} = {sumSq}\nc² = {c}² = {cSq}"), {
      a: numFmt(r.a), b: numFmt(r.b), c: numFmt(r.c), aSq: numFmt(aSq), bSq: numFmt(bSq),
      sumSq: numFmt(r.sumSq), cSq: numFmt(r.cSq)
    });
    stepMainEl.hidden = false;
    if (r.valid) {
      stepAreaEl.textContent = fmt(tr("tool.steps.area", "Area = ½ × a × b = ½ × {a} × {b} = {area}"),
        { a: numFmt(r.a), b: numFmt(r.b), area: numFmt(r.area) });
      stepAreaEl.hidden = false;
      stepPerimEl.textContent = fmt(tr("tool.steps.perimeter", "Perimeter = a + b + c = {a} + {b} + {c} = {perimeter}"),
        { a: numFmt(r.a), b: numFmt(r.b), c: numFmt(r.c), perimeter: numFmt(r.perimeter) });
      stepPerimEl.hidden = false;
    } else {
      stepAreaEl.hidden = true;
      stepPerimEl.hidden = true;
    }
    detailsEl.hidden = false;
  }

  /* ---- 렌더 ---- */
  function render() {
    errEl.hidden = true; emptyEl.hidden = true; badgeEl.hidden = true; noteEl.hidden = true;
    gridEl.hidden = true; copyHintEl.hidden = true;
    if (sideCard) sideCard.hidden = true;
    if (areaCard) areaCard.hidden = true;
    if (perimCard) perimCard.hidden = true;
    if (diagramWrap) diagramWrap.hidden = true;
    detailsEl.hidden = true;
    stepMainEl.hidden = true; stepAreaEl.hidden = true; stepPerimEl.hidden = true;

    var pa = parseSide(aEl.value), pb = parseSide(bEl.value), pc = parseSide(cEl.value);
    var errs = [pa, pb, pc].filter(function (p) { return p.error; });
    if (errs.length) {
      var msgKey = "tool.err.invalid", fallback = "Please enter valid numbers for the sides.";
      if (errs.some(function (e) { return e.error === "range"; })) {
        msgKey = "tool.err.range"; fallback = "Please keep side lengths under {max}.";
      } else if (errs.some(function (e) { return e.error === "nonpositive"; })) {
        msgKey = "tool.err.nonpositive"; fallback = "Side lengths must be greater than 0.";
      }
      errEl.textContent = fmt(tr(msgKey, fallback), { max: numFmt(MAX_SIDE, 0) });
      errEl.hidden = false;
      return;
    }

    var a = pa.empty ? null : pa.value, b = pb.empty ? null : pb.value, c = pc.empty ? null : pc.value;
    var known = (a != null ? 1 : 0) + (b != null ? 1 : 0) + (c != null ? 1 : 0);
    if (known < 2) { emptyEl.hidden = false; return; }

    var r = computeTriangle(a, b, c);
    if (r.mode === "error") {
      errEl.textContent = tr("tool.err.hyp", "The hypotenuse (c) must be longer than each leg (a and b). Please check your numbers.");
      errEl.hidden = false;
      return;
    }

    if (r.mode === "solve") {
      badgeEl.textContent = fmt(tr("tool.badge.solving", "Solving for {side}"), { side: tr("tool.side." + r.missing, r.missing) });
      badgeEl.hidden = false;
      setCard(sideCard, tr("tool." + r.missing + ".label", r.missing), numFmt(r[r.missing]));
      setCard(areaCard, tr("tool.res.area", "Area"), numFmt(r.area));
      setCard(perimCard, tr("tool.res.perimeter", "Perimeter"), numFmt(r.perimeter));
      gridEl.hidden = false;
      copyHintEl.hidden = false;
      renderDiagram(r.a, r.b, r.c);
      renderStepsForSolve(r);
      return;
    }

    // verify — 셋 다 입력된 경우
    badgeEl.textContent = r.valid
      ? tr("tool.badge.validTitle", "✓ Valid right triangle")
      : tr("tool.badge.invalidTitle", "✗ Not a right triangle");
    badgeEl.hidden = false;
    var compare = fmt(tr("tool.note.compare", "a² + b² = {sumSq}, and c² = {cSq}."), { sumSq: numFmt(r.sumSq), cSq: numFmt(r.cSq) });
    noteEl.textContent = r.valid ? compare : compare + " " + tr("tool.note.invalidExtra", "These three lengths don't satisfy a² + b² = c², so they can't form a right triangle.");
    noteEl.hidden = false;
    renderStepsForVerify(r);

    if (r.valid) {
      setCard(areaCard, tr("tool.res.area", "Area"), numFmt(r.area));
      setCard(perimCard, tr("tool.res.perimeter", "Perimeter"), numFmt(r.perimeter));
      gridEl.hidden = false;
      copyHintEl.hidden = false;
      renderDiagram(r.a, r.b, r.c);
    }
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
  [sideCard, areaCard, perimCard].forEach(function (card) {
    if (card) card.addEventListener("click", function () { copyCard(card); });
  });

  /* ---- 프리셋 · 지우기 ---- */
  presetBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      aEl.value = btn.getAttribute("data-a");
      bEl.value = btn.getAttribute("data-b");
      cEl.value = btn.getAttribute("data-c");
      render();
      saveState();
    });
  });
  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      aEl.value = ""; bEl.value = ""; cEl.value = "";
      render();
      saveState();
      aEl.focus();
    });
  }

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

  // 언어 전환 시 배지·문구·통화 형식 재적용
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
