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
  /* Slope Calculator — given two points (x1,y1) and (x2,y2), computes the
     slope m = (y2-y1)/(x2-x1), the line equation y = mx + b, the angle of
     incline (atan(m) in degrees), the percent grade (m*100), the distance
     between the points, and their midpoint. Vertical lines (x1===x2) and
     identical points are handled as explicit, explained edge cases rather
     than errors. Every computation runs locally — no external API calls. */

  var CFG = window.APP_CONFIG || {};
  var STORE_KEY = (CFG.slug || "slope-calc") + ":state";
  var MAX_COEF = 1e12; // 극단값 캡 — 좌표 입력 범위 안전선

  /* ---- i18n · 표시 헬퍼 ---- */
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
  function nf(opts) { try { return new Intl.NumberFormat(uiLang(), opts); } catch (e) { return new Intl.NumberFormat("en", opts); } }
  function numFmt(n, maxDec) { return nf({ maximumFractionDigits: maxDec == null ? 6 : maxDec }).format(safeNum(n)); }

  // Infinity/NaN을 안전한 유한값으로
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

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */

  // 좌표 파싱: 빈값/유효하지 않음/범위초과를 구분
  function parseCoord(raw) {
    var s = String(raw == null ? "" : raw).replace(/,/g, "").trim();
    if (s === "") return { empty: true };
    var n = Number(s);
    if (!isFinite(n)) return { error: "invalid" };
    if (Math.abs(n) > MAX_COEF) return { error: "range" };
    return { value: n };
  }

  /* 두 점으로부터 기울기·방정식·거리·중점을 계산한다.
     kind: "same"(동일점, 직선 미정의) | "vertical"(x1=x2, 기울기 미정의) | "line"(일반)
     line 인 경우 m=0(수평)도 포함한다. */
  function computeSlope(x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var distance = Math.sqrt(dx * dx + dy * dy);
    var midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;

    if (dx === 0 && dy === 0) {
      return { kind: "same", dx: dx, dy: dy, distance: 0, midX: midX, midY: midY };
    }
    if (dx === 0) {
      return { kind: "vertical", dx: dx, dy: dy, distance: safeNum(distance), midX: midX, midY: midY, angleDeg: 90 };
    }
    var m = dy / dx;
    // b = (x2*y1 - x1*y2) / (x2-x1) — 두 점 어느 쪽을 대입해도 동일하도록 대칭식 사용
    var b = (x2 * y1 - x1 * y2) / dx;
    var angleDeg = Math.atan(m) * (180 / Math.PI);
    var gradePct = m * 100;
    return {
      kind: "line", dx: dx, dy: dy, m: safeNum(m), b: safeNum(b),
      distance: safeNum(distance), midX: midX, midY: midY,
      angleDeg: safeNum(angleDeg), gradePct: safeNum(gradePct)
    };
  }

  // 직선의 방정식 문자열 "y = mx + b" 조립 (m=±1은 계수 생략, b=0은 항 생략)
  function formatLineEq(m, b, numFn) {
    var terms = [];
    if (m !== 0) {
      var negM = m < 0, absM = Math.abs(m);
      terms.push({ neg: negM, text: (absM === 1 ? "" : numFn(absM)) + "x" });
    }
    if (b !== 0 || !terms.length) terms.push({ neg: b < 0, text: numFn(Math.abs(b)) });
    var out = "";
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      out += i === 0 ? (t.neg ? "−" : "") + t.text : (t.neg ? " − " : " + ") + t.text;
    }
    return "y = " + out;
  }

  // node 검증용 노출 — 브라우저에는 module이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseCoord: parseCoord, computeSlope: computeSlope,
      formatLineEq: formatLineEq, round: round, safeNum: safeNum, MAX_COEF: MAX_COEF
    };
    return;
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var x1El = $("x1-input"), y1El = $("y1-input"), x2El = $("x2-input"), y2El = $("y2-input");
  var errEl = $("tool-err");
  var emptyEl = $("result-empty"), noticeEl = $("result-notice"), eqEl = $("result-eq");
  var gridEl = $("result-grid"), copyHintEl = $("copy-hint");
  var plotWrap = $("plot-wrap"), plotSvg = $("plot-svg");
  var detailsEl = $("tool-more");
  var stepFormula = $("step-formula"), stepSubstituted = $("step-substituted");
  var stepResult = $("step-result"), stepIntercept = $("step-intercept");
  if (!x1El || !y1El || !x2El || !y2El || !gridEl) return;

  var slopeCard = gridEl.querySelector('[data-copy="slope"]');
  var angleCard = gridEl.querySelector('[data-copy="angle"]');
  var gradeCard = gridEl.querySelector('[data-copy="grade"]');
  var ratioCard = gridEl.querySelector('[data-copy="ratio"]');
  var distCard = gridEl.querySelector('[data-copy="distance"]');
  var midCard = gridEl.querySelector('[data-copy="midpoint"]');

  function setCard(card, text) {
    if (!card) return;
    var v = card.querySelector(".rc-value");
    if (v) v.textContent = text;
    card.setAttribute("data-value", text);
  }

  function hideSteps() {
    [stepFormula, stepSubstituted, stepResult, stepIntercept].forEach(function (el) { if (el) el.hidden = true; });
  }

  /* ---- 작은 SVG 플롯: 두 점 + 두 점을 지나는 직선 ---- */
  var SVGNS = "http://www.w3.org/2000/svg";
  function svgEl(tagName, attrs) {
    var el = document.createElementNS(SVGNS, tagName);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) el.setAttribute(k, attrs[k]);
    return el;
  }
  function niceSpan(lo, hi) {
    var span = hi - lo;
    if (span === 0) {
      var mag = Math.max(Math.abs(lo), Math.abs(hi), 1);
      var half = mag * 0.5;
      return { lo: lo - half, hi: hi + half };
    }
    var pad = span * 0.15;
    return { lo: lo - pad, hi: hi + pad };
  }
  function px2(n) { return Math.round(n * 100) / 100; }

  function renderPlot(x1, y1, x2, y2, r) {
    while (plotSvg.firstChild) plotSvg.removeChild(plotSvg.firstChild);
    var W = 300, H = 200, margin = 24;
    var plotW = W - 2 * margin, plotH = H - 2 * margin;

    var rawMinX = Math.min(x1, x2), rawMaxX = Math.max(x1, x2);
    var rawMinY = Math.min(y1, y2), rawMaxY = Math.max(y1, y2);
    var vx = niceSpan(rawMinX, rawMaxX), vy = niceSpan(rawMinY, rawMaxY);
    var viewMinX = vx.lo, viewMaxX = vx.hi, viewMinY = vy.lo, viewMaxY = vy.hi;
    var spanX = (viewMaxX - viewMinX) || 1, spanY = (viewMaxY - viewMinY) || 1;

    function mapX(x) { return margin + (x - viewMinX) / spanX * plotW; }
    function mapY(y) { return margin + (viewMaxY - y) / spanY * plotH; }

    // 배경 테두리
    plotSvg.appendChild(svgEl("rect", {
      x: margin, y: margin, width: plotW, height: plotH,
      fill: "none", style: "stroke:var(--line);stroke-width:1"
    }));

    // 축(0선) — 보이는 범위 안에 있을 때만
    if (viewMinX <= 0 && 0 <= viewMaxX) {
      var ax = px2(mapX(0));
      plotSvg.appendChild(svgEl("line", {
        x1: ax, y1: margin, x2: ax, y2: margin + plotH,
        style: "stroke:var(--line);stroke-width:1;stroke-dasharray:3,3"
      }));
    }
    if (viewMinY <= 0 && 0 <= viewMaxY) {
      var ay = px2(mapY(0));
      plotSvg.appendChild(svgEl("line", {
        x1: margin, y1: ay, x2: margin + plotW, y2: ay,
        style: "stroke:var(--line);stroke-width:1;stroke-dasharray:3,3"
      }));
    }

    // 두 점을 지나는 직선 (뷰포트 밖으로 나가는 부분은 SVG 기본 클리핑으로 잘린다)
    if (r.kind === "vertical") {
      var vxPix = px2(mapX(x1));
      plotSvg.appendChild(svgEl("line", {
        x1: vxPix, y1: margin, x2: vxPix, y2: margin + plotH,
        style: "stroke:var(--accent);stroke-width:2"
      }));
    } else if (r.kind === "line") {
      var y1e = r.m * viewMinX + r.b, y2e = r.m * viewMaxX + r.b;
      plotSvg.appendChild(svgEl("line", {
        x1: px2(mapX(viewMinX)), y1: px2(mapY(y1e)),
        x2: px2(mapX(viewMaxX)), y2: px2(mapY(y2e)),
        style: "stroke:var(--accent);stroke-width:2"
      }));
    }

    // 점 1
    plotSvg.appendChild(svgEl("circle", {
      cx: px2(mapX(x1)), cy: px2(mapY(y1)), r: 5,
      style: "fill:var(--accent);stroke:var(--surface);stroke-width:2"
    }));
    // 점 2 (동일점이면 생략 — 점 1과 겹친다)
    if (r.kind !== "same") {
      plotSvg.appendChild(svgEl("circle", {
        cx: px2(mapX(x2)), cy: px2(mapY(y2)), r: 5,
        style: "fill:var(--accent);stroke:var(--surface);stroke-width:2"
      }));
    }
  }

  /* ---- 렌더 ---- */
  function render() {
    errEl.hidden = true; emptyEl.hidden = true; noticeEl.hidden = true; eqEl.hidden = true;
    gridEl.hidden = true; copyHintEl.hidden = true; plotWrap.hidden = true; detailsEl.hidden = true;
    hideSteps();

    var p1 = parseCoord(x1El.value), p2 = parseCoord(y1El.value);
    var p3 = parseCoord(x2El.value), p4 = parseCoord(y2El.value);
    if (p1.empty || p2.empty || p3.empty || p4.empty) { emptyEl.hidden = false; return; }
    if (p1.error || p2.error || p3.error || p4.error) {
      var anyRange = p1.error === "range" || p2.error === "range" || p3.error === "range" || p4.error === "range";
      errEl.textContent = anyRange
        ? fmt(tr("tool.err.range", "Please keep coordinates between -{max} and {max}"), { max: numFmt(MAX_COEF, 0) })
        : tr("tool.err.invalid", "Please enter valid numbers for all four coordinates");
      errEl.hidden = false;
      return;
    }

    var x1 = p1.value, y1 = p2.value, x2 = p3.value, y2 = p4.value;
    var r = computeSlope(x1, y1, x2, y2);

    if (r.kind === "same") {
      noticeEl.textContent = tr("tool.notice.same", "These two points are identical, so they don't define a unique line — the slope is undefined.");
      noticeEl.hidden = false;
    } else if (r.kind === "vertical") {
      noticeEl.textContent = tr("tool.notice.vertical", "These points share the same x-coordinate, so the line through them is vertical — the slope is undefined.");
      noticeEl.hidden = false;
    }

    if (r.kind === "vertical") {
      eqEl.textContent = fmt(tr("tool.eq.vertical", "x = {x}"), { x: numFmt(round(x1, 6), 6) });
      eqEl.hidden = false;
    } else if (r.kind === "line") {
      eqEl.textContent = formatLineEq(round(r.m, 6), round(r.b, 6), function (n) { return numFmt(n, 6); });
      eqEl.hidden = false;
    }

    var undefVertical = tr("tool.val.undefinedVertical", "Undefined (vertical line)");
    var undefSame = tr("tool.val.undefinedSame", "N/A (same point)");

    if (r.kind === "line") {
      setCard(slopeCard, numFmt(round(r.m, 6), 6));
      setCard(angleCard, numFmt(round(r.angleDeg, 2), 2) + "°");
      setCard(gradeCard, numFmt(round(r.gradePct, 2), 2) + "%");
      // 경사비 1:N (램프·지붕·도로에서 쓰는 표기) — m=0은 수평
      setCard(ratioCard, r.m === 0 ? tr("tool.val.level", "0 (level)")
        : "1 : " + numFmt(round(Math.abs(1 / r.m), 2), 2));
    } else if (r.kind === "vertical") {
      setCard(slopeCard, undefVertical);
      setCard(angleCard, numFmt(90, 0) + "°");
      setCard(gradeCard, undefVertical);
      setCard(ratioCard, undefVertical);
    } else { // same
      setCard(slopeCard, undefSame);
      setCard(angleCard, undefSame);
      setCard(gradeCard, undefSame);
      setCard(ratioCard, undefSame);
    }
    setCard(distCard, numFmt(round(r.distance, 4), 4));
    setCard(midCard, "(" + numFmt(round(r.midX, 6), 6) + ", " + numFmt(round(r.midY, 6), 6) + ")");
    gridEl.hidden = false;
    copyHintEl.hidden = false;

    renderPlot(x1, y1, x2, y2, r);
    plotWrap.hidden = false;

    // 단계별 풀이
    stepFormula.textContent = tr("tool.steps.formula", "Slope formula: m = (y₂ − y₁) / (x₂ − x₁)");
    stepFormula.hidden = false;
    stepSubstituted.textContent = fmt(tr("tool.steps.substituted", "m = ({y2} − {y1}) / ({x2} − {x1}) = {dy} / {dx}"),
      { y2: numFmt(y2, 6), y1: numFmt(y1, 6), x2: numFmt(x2, 6), x1: numFmt(x1, 6), dy: numFmt(r.dy, 6), dx: numFmt(r.dx, 6) });
    stepSubstituted.hidden = false;

    if (r.kind === "line") {
      stepResult.textContent = fmt(tr("tool.steps.result", "m = {dy} / {dx} = {m}"),
        { dy: numFmt(r.dy, 6), dx: numFmt(r.dx, 6), m: numFmt(round(r.m, 6), 6) });
      stepResult.hidden = false;
      stepIntercept.textContent = fmt(tr("tool.steps.intercept", "Using y = mx + b with point (x₁, y₁): b = y₁ − m·x₁ = {b}"),
        { b: numFmt(round(r.b, 6), 6) });
      stepIntercept.hidden = false;
    } else if (r.kind === "vertical") {
      stepResult.textContent = tr("tool.steps.resultVertical", "x₂ − x₁ = 0, so the slope is undefined — this is a vertical line.");
      stepResult.hidden = false;
    } else {
      stepResult.textContent = tr("tool.steps.resultSame", "Both points are identical, so there's no unique line and the slope is undefined.");
      stepResult.hidden = false;
    }
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
  [slopeCard, angleCard, gradeCard, ratioCard, distCard, midCard].forEach(function (card) {
    if (card) card.addEventListener("click", function () { copyCard(card); });
  });

  /* ---- 이벤트 ---- */
  function onEnter(e) {
    if (e.key !== "Enter") return;
    render();
    if (e.target && e.target.blur) e.target.blur();
  }
  [x1El, y1El, x2El, y2El].forEach(function (el) {
    el.addEventListener("input", function () { render(); saveState(); });
    el.addEventListener("keydown", onEnter);
  });

  // 언어 전환 시 문구·숫자 포맷을 새 로케일로 재렌더
  document.addEventListener("i18n:change", render);

  /* ---- 상태 저장/복원 (프로세스 밖 — 철칙 1) ---- */
  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        x1: x1El.value, y1: y1El.value, x2: x2El.value, y2: y2El.value
      }));
    } catch (e) { /* private mode */ }
  }
  function restoreState() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { s = null; }
    if (!s) return;
    if (typeof s.x1 === "string") x1El.value = s.x1;
    if (typeof s.y1 === "string") y1El.value = s.y1;
    if (typeof s.x2 === "string") x2El.value = s.x2;
    if (typeof s.y2 === "string") y2El.value = s.y2;
  }

  /* ---- 초기화 ---- */
  restoreState();
  render();
  // TOOLJS:END
})();
