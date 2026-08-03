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
  /* Square Root Calculator — square/cube/nth root with exact-perfect-power detection
     and integer radical simplification (sqrt(72) = 6√2, cbrt(24) = 2∛3, etc.).
     State: localStorage "<slug>:state" only (value/mode/degree/precision). No external API —
     every computation (root value + prime-factor simplification) runs locally. */

  var MAX_INPUT = 1e15;      // 입력 상한 — Number.MAX_SAFE_INTEGER 근방에서 부동소수 정밀도가 무너지기 전 안전선
  var SIMPLIFY_MAX = 1e12;   // 소인수분해로 근호 간소화를 시도하는 상한(시행 나눗셈 성능 안전선, sqrt(1e12)=1e6회)
  var MIN_DEGREE = 2, MAX_DEGREE = 100;

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */

  // 숫자 파싱: 콤마 제거, 빈값/NaN/범위초과를 구분해 호출부가 각각 다른 문구를 고르게 한다
  function parseNumberInput(raw) {
    var s = String(raw == null ? "" : raw).replace(/,/g, "").trim();
    if (s === "") return { empty: true };
    var n = Number(s);
    if (!isFinite(n)) return { error: "invalid" };
    if (Math.abs(n) > MAX_INPUT) return { error: "range" };
    return { value: n };
  }

  // 차수(n) 파싱: 정수 2~12로 클램프(빈값/NaN 은 null → 호출부가 기본값 사용)
  function parseDegree(raw) {
    var n = parseInt(String(raw == null ? "" : raw).trim(), 10);
    if (isNaN(n) || !isFinite(n)) return null;
    if (n < MIN_DEGREE) n = MIN_DEGREE;
    if (n > MAX_DEGREE) n = MAX_DEGREE;
    return n;
  }

  // 소인수분해(시행 나눗셈). n 은 2 이상의 정수. 반환: {소수: 지수}
  function primeFactorize(n) {
    var factors = {};
    var x = n;
    while (x % 2 === 0) { factors[2] = (factors[2] || 0) + 1; x = x / 2; }
    for (var p = 3; p * p <= x; p += 2) {
      while (x % p === 0) { factors[p] = (factors[p] || 0) + 1; x = x / p; }
    }
    if (x > 1) factors[x] = (factors[x] || 0) + 1;
    return factors;
  }

  /* 근호 간소화: n = coef^degree × radicand 로 분해한다(radicand 는 degree제곱 인수가 남지 않은 최소값).
     예) simplifyRadical(72, 2) → {coef:6, radicand:2}  (72 = 6²×2, √72 = 6√2)
         simplifyRadical(24, 3) → {coef:2, radicand:3}  (24 = 2³×3, ∛24 = 2∛3)
         simplifyRadical(-8, 3) → {coef:-2, radicand:1, exact:true} (∛-8 = -2, 홀수 차수라 음수 허용)
     null 인 경우: n 이 정수가 아니거나, |n| 이 SIMPLIFY_MAX 를 넘거나(성능 안전선),
     n<0 인데 degree 가 짝수(실수 근이 없음 — 허수 처리는 호출부 몫). */
  function simplifyRadical(n, degree) {
    if (!Number.isInteger(n) || !Number.isInteger(degree) || degree < 2) return null;
    if (n === 0) return { coef: 0, radicand: 1, exact: true };
    var negative = n < 0;
    if (negative && degree % 2 === 0) return null;
    var absN = Math.abs(n);
    if (absN > SIMPLIFY_MAX) return null;
    var factors = primeFactorize(absN);
    var coef = 1, radicand = 1;
    for (var p in factors) {
      if (!Object.prototype.hasOwnProperty.call(factors, p)) continue;
      var e = factors[p];
      var coefExp = Math.floor(e / degree);
      var remExp = e % degree;
      if (coefExp > 0) coef *= Math.pow(Number(p), coefExp);
      if (remExp > 0) radicand *= Math.pow(Number(p), remExp);
    }
    if (negative) coef = -coef;
    return { coef: coef, radicand: radicand, exact: radicand === 1 };
  }

  // 실수 근 계산. 짝수 차수 + 음수 입력이면 실수 근이 없어 null(허수 처리는 호출부 몫)
  function computeRoot(n, degree) {
    if (n === 0) return 0;
    if (n < 0 && degree % 2 === 0) return null;
    var sign = n < 0 ? -1 : 1;
    return sign * Math.pow(Math.abs(n), 1 / degree);
  }

  // 표시용 반올림 — Number.EPSILON 으로 부동소수 잡음만 걷어낸다
  function roundTo(n, places) {
    var m = Math.pow(10, places);
    var bump = n >= 0 ? Number.EPSILON : -Number.EPSILON;
    return Math.round((n + bump) * m) / m;
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseNumberInput: parseNumberInput, parseDegree: parseDegree,
      primeFactorize: primeFactorize, simplifyRadical: simplifyRadical,
      computeRoot: computeRoot, roundTo: roundTo,
      MAX_INPUT: MAX_INPUT, SIMPLIFY_MAX: SIMPLIFY_MAX, MIN_DEGREE: MIN_DEGREE, MAX_DEGREE: MAX_DEGREE
    };
    return;
  }

  /* ---- i18n · 표시 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var STORE_KEY = (CFG.slug || "square-root-calc") + ":state";
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
  function fmtInt(n) {
    try { return new Intl.NumberFormat(uiLang(), { maximumFractionDigits: 0 }).format(n); }
    catch (e) { return String(n); }
  }
  function fmtDec(n, precision) {
    try { return new Intl.NumberFormat(uiLang(), { maximumFractionDigits: precision }).format(n); }
    catch (e) { return String(n); }
  }

  // 근호 기호: 제곱근 √, 세제곱근 ∛, 네제곱근 ∜ 은 전용 유니코드 글리프, 그 이상은 위첨자 숫자 + √
  var SUP = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
  function toSuperscript(n) {
    return String(n).split("").map(function (ch) { return SUP[ch] || ch; }).join("");
  }
  function rootSymbol(degree) {
    if (degree === 2) return "√";
    if (degree === 3) return "∛";
    if (degree === 4) return "∜";
    return toSuperscript(degree) + "√";
  }
  // {coef, radicand} → 표시 문자열. |coef|=1 이면 계수 생략("√7", "-∛7"), 아니면 그대로("6√2")
  function formatRadical(coef, radicand, degree) {
    var prefix = Math.abs(coef) === 1 ? (coef < 0 ? "-" : "") : fmtInt(coef);
    return prefix + rootSymbol(degree) + fmtInt(radicand);
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var modeBtns = document.querySelectorAll(".mode-btn");
  var numEl = $("num-input"), degreeEl = $("degree-input"), degreeGroupEl = $("degree-group");
  var precisionEl = $("precision-select");
  var noteEl = $("tool-note"), errEl = $("tool-err");
  var badgeEl = $("result-badge"), emptyEl = $("result-empty"), gridEl = $("result-grid");
  var copyHintEl = $("copy-hint");
  if (!numEl || !degreeEl || !gridEl) return;
  var valueCard = gridEl.querySelector('[data-copy="value"]');
  var simpCard = gridEl.querySelector('[data-copy="simplified"]');

  var MODE_SAMPLE = { sqrt: 72, cbrt: 24, nth: 48 };
  var currentMode = "sqrt";

  function activeDegree() {
    if (currentMode === "sqrt") return 2;
    if (currentMode === "cbrt") return 3;
    var d = parseDegree(degreeEl.value);
    return d == null ? 4 : d;
  }

  function refreshPlaceholder() {
    numEl.placeholder = fmt(tr("tool.number.ph", "e.g. {x}"), { x: fmtInt(MODE_SAMPLE[currentMode]) });
  }

  function setMode(mode) {
    currentMode = (mode === "cbrt" || mode === "nth") ? mode : "sqrt";
    for (var i = 0; i < modeBtns.length; i++) {
      var b = modeBtns[i];
      var on = b.getAttribute("data-mode") === currentMode;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.style.background = on ? "var(--accent)" : "var(--muted)";
      b.style.color = "#fff";
    }
    if (degreeGroupEl) degreeGroupEl.hidden = (currentMode !== "nth");
    refreshPlaceholder();
    render();
  }

  /* ---- 카드 값 세팅 ---- */
  function setCard(card, text) {
    if (!card) return;
    var valEl = card.querySelector(".rc-value");
    if (valEl) valEl.textContent = text;
    card.setAttribute("data-value", text);
  }

  /* ---- 렌더 ---- */
  function render() {
    errEl.hidden = true;
    noteEl.hidden = true;
    badgeEl.hidden = true;
    gridEl.hidden = true;
    copyHintEl.hidden = true;
    emptyEl.hidden = true;

    var parsed = parseNumberInput(numEl.value);
    if (parsed.empty) { emptyEl.hidden = false; return; }
    if (parsed.error === "invalid") {
      errEl.textContent = tr("tool.err.invalid", "Please enter a valid number");
      errEl.hidden = false;
      return;
    }
    if (parsed.error === "range") {
      errEl.textContent = fmt(tr("tool.err.range", "Please enter a number between -{max} and {max}"),
        { max: fmtInt(MAX_INPUT) });
      errEl.hidden = false;
      return;
    }

    var n = parsed.value;
    var degree = activeDegree();
    var precision = parseInt(precisionEl.value, 10);
    if (!(precision >= 0)) precision = 4;

    var value = computeRoot(n, degree);

    if (value === null) {
      // 짝수 차수의 음수 입력 — 실수 근이 없다
      if (degree === 2) {
        var absN = Math.abs(n);
        var imagVal = computeRoot(absN, 2);
        var imagSimp = Number.isInteger(absN) ? simplifyRadical(absN, 2) : null;
        var imagStr = imagSimp
          ? (imagSimp.radicand === 1 ? fmtInt(imagSimp.coef) : formatRadical(imagSimp.coef, imagSimp.radicand, 2))
          : fmtDec(roundTo(imagVal, precision), precision);
        noteEl.textContent = fmt(
          tr("tool.note.imaginarySqrt", "√{value} isn't a real number — negative numbers have no real square root. In the complex numbers, it equals {imag}i."),
          { value: fmtInt(n), imag: imagStr }
        );
      } else {
        noteEl.textContent = tr("tool.note.imaginaryEven",
          "There's no real result here: raising any real number to an even root degree (2, 4, 6 …) never produces a negative number.");
      }
      noteEl.hidden = false;
      return;
    }

    var simp = Number.isInteger(n) ? simplifyRadical(n, degree) : null;

    if (simp && simp.radicand === 1) {
      setCard(valueCard, fmtInt(simp.coef));
      badgeEl.textContent = tr("tool.badge.exact", "Exact result");
      if (simpCard) simpCard.hidden = true;
    } else {
      var rounded = roundTo(value, precision);
      setCard(valueCard, fmtDec(rounded, precision));
      badgeEl.textContent = fmt(tr("tool.badge.rounded", "Rounded to {n} decimal places"), { n: String(precision) });
      if (simp && simp.radicand > 1 && simpCard) {
        setCard(simpCard, formatRadical(simp.coef, simp.radicand, degree));
        simpCard.hidden = false;
      } else if (simpCard) {
        simpCard.hidden = true;
      }
    }
    // 카드가 하나뿐이면 빈 두 번째 칸이 남지 않도록 그리드를 1열로 좁힌다
    gridEl.style.gridTemplateColumns = (simpCard && !simpCard.hidden) ? "1fr 1fr" : "1fr";
    badgeEl.hidden = false;
    gridEl.hidden = false;
    copyHintEl.hidden = false;
  }

  /* ---- 클릭 복사 ---- */
  var copiedTimers = {};
  function flashCopied(card) {
    var labelEl = card.querySelector(".rc-label");
    if (!labelEl) return;
    var key = card.getAttribute("data-copy");
    var labelKey = key === "value" ? "tool.res.result" : "tool.res.simplified";
    labelEl.textContent = tr("tool.copied", "Copied");
    if (copiedTimers[key]) clearTimeout(copiedTimers[key]);
    copiedTimers[key] = setTimeout(function () {
      labelEl.textContent = tr(labelKey, labelEl.textContent);
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
  [valueCard, simpCard].forEach(function (card) {
    if (card) card.addEventListener("click", function () { copyCard(card); });
  });

  /* ---- 이벤트 ---- */
  function onEnter(e) {
    if (e.key !== "Enter") return;
    render();
    if (e.target && e.target.blur) e.target.blur();
  }
  numEl.addEventListener("input", function () { render(); saveState(); });
  numEl.addEventListener("keydown", onEnter);
  degreeEl.addEventListener("input", function () { render(); saveState(); });
  degreeEl.addEventListener("keydown", onEnter);
  if (precisionEl) precisionEl.addEventListener("change", function () { render(); saveState(); });
  for (var mi = 0; mi < modeBtns.length; mi++) {
    modeBtns[mi].addEventListener("click", function () { setMode(this.getAttribute("data-mode")); saveState(); });
  }

  // 언어 전환 시 플레이스홀더·배지·안내 문구 재적용
  document.addEventListener("i18n:change", function () { refreshPlaceholder(); render(); });

  /* ---- 상태 저장/복원 ---- */
  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        value: numEl.value, mode: currentMode, degree: degreeEl.value,
        precision: precisionEl ? precisionEl.value : "4"
      }));
    } catch (e) { /* private mode */ }
  }
  function restoreState() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { s = null; }
    if (!s) return;
    if (typeof s.value === "string") numEl.value = s.value;
    if (typeof s.degree === "string") degreeEl.value = s.degree;
    if (precisionEl && typeof s.precision === "string") precisionEl.value = s.precision;
    if (s.mode === "cbrt" || s.mode === "nth") currentMode = s.mode;
  }

  /* ---- 초기화 ---- */
  restoreState();
  setMode(currentMode);
  // TOOLJS:END
})();
