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
  /* Ratio Calculator — 세 개 탭:
     1) Solve proportion  — A:B = C:D 에서 셋을 알 때 나머지 하나를 교차곱으로 계산
     2) Simplify ratio    — 두 항 비율을 최대공약수로 약분 + 1:n 형태 + 소수 형태
     3) Scale ratio        — 두 항 비율을 배율만큼 곱해 확대/축소
     상태: localStorage "<slug>:state" 만. 외부 API 없음, 모든 계산은 로컬. */

  var cfg = window.APP_CONFIG || {};
  var LS_KEY = (cfg.slug || "ratio-calc") + ":state";
  var LIM = { maxDecimals: 6, maxAbs: 1e12 };

  function $(id) { return document.getElementById(id); }

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function fmtLocale() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) || document.documentElement.getAttribute("lang") || navigator.language || "en";
  }
  function nf(opts) { try { return new Intl.NumberFormat(fmtLocale(), opts); } catch (e) { return new Intl.NumberFormat("en", opts); } }
  function safe(v) {
    if (typeof v !== "number" || isNaN(v)) return 0;
    if (v === Infinity) return Number.MAX_SAFE_INTEGER;
    if (v === -Infinity) return -Number.MAX_SAFE_INTEGER;
    return v;
  }
  function numFmt(v, maxdec) { return nf({ maximumFractionDigits: maxdec == null ? 6 : maxdec }).format(safe(v)); }

  // ── calc-core:start — 순수 계산 함수 (Math·Intl 외 DOM 의존 없음) ──
  // 입력 문자열에서 소수 자리수를 센다 (부동소수 오차 없이 "그 사람이 입력한 그대로" 기준)
  function decimalPlaces(raw) {
    var s = String(raw == null ? "" : raw).trim();
    var i = s.indexOf(".");
    return i === -1 ? 0 : Math.min(s.length - i - 1, LIM.maxDecimals);
  }
  // 빈 문자열/숫자 아님 → null (조용한 실패 방지 — 호출부가 명시적으로 처리)
  function parseNum(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (s === "") return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }
  // 유클리드 호제법 — 정수 절대값 기준. gcd(0,x)=x, gcd(0,0)=0.
  function gcd(a, b) {
    a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b));
    while (b) { var r = a % b; a = b; b = r; }
    return a;
  }
  // 비율 두 항을 최대공약수로 약분. 소수는 두 항의 소수 자리수 중 큰 쪽으로 스케일업 후 정수로 약분.
  // 세 번째 항(rawC)은 선택 — 비우면 기존 2항 동작 그대로.
  function simplifyRatio(rawA, rawB, rawC) {
    var raws = [rawA, rawB];
    var hasC = rawC != null && String(rawC).trim() !== "";
    if (hasC) raws.push(rawC);
    var vals = [], dec = 0, i;
    for (i = 0; i < raws.length; i++) {
      var n = parseNum(raws[i]);
      if (n == null) return { ok: false, reason: "empty" };
      if (n < 0) return { ok: false, reason: "negative" };
      vals.push(n);
      dec = Math.max(dec, decimalPlaces(raws[i]));
    }
    var allZero = true;
    for (i = 0; i < vals.length; i++) if (vals[i] !== 0) allZero = false;
    if (allZero) return { ok: false, reason: "bothZero" };
    var scale = Math.pow(10, dec);
    var ints = [], g = 0;
    for (i = 0; i < vals.length; i++) { ints.push(Math.round(vals[i] * scale)); g = gcd(g, ints[i]); }
    g = g || 1;
    var simp = [];
    for (i = 0; i < ints.length; i++) simp.push(ints[i] / g);
    return { ok: true, vals: vals, simp: simp, a: vals[0], b: vals[1], sa: simp[0], sb: simp[1] };
  }
  // 비례식 A:B = C:D 교차곱: A*D = B*C. solveFor 로 지정된 하나를 나머지 셋으로 구한다.
  function solveProportion(a, b, c, d, solveFor) {
    if (solveFor === "a") { if (d === 0) return { ok: false, reason: "div0" }; return { ok: true, value: (b * c) / d }; }
    if (solveFor === "b") { if (c === 0) return { ok: false, reason: "div0" }; return { ok: true, value: (a * d) / c }; }
    if (solveFor === "c") { if (b === 0) return { ok: false, reason: "div0" }; return { ok: true, value: (a * d) / b }; }
    if (solveFor === "d") { if (a === 0) return { ok: false, reason: "div0" }; return { ok: true, value: (b * c) / a }; }
    return { ok: false, reason: "badvar" };
  }
  // 두 항을 동일 배율로 확대/축소 — 단순화된 비율(모양)은 그대로, 크기만 바뀐다.
  function scaleRatio(a, b, factor) {
    return { na: a * factor, nb: b * factor };
  }
  // node 단위 검증용 노출 (브라우저에는 module 없음 — 조용히 통과)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { decimalPlaces: decimalPlaces, parseNum: parseNum, gcd: gcd, simplifyRatio: simplifyRatio, solveProportion: solveProportion, scaleRatio: scaleRatio };
    return;
  }
  // ── calc-core:end ──

  var toolRoot = $("tool");
  if (!toolRoot) return;

  /* ── 탭 전환 ── */
  var tabBtns = toolRoot.querySelectorAll(".tab-btn");
  var tabPanels = toolRoot.querySelectorAll(".tab-panel");
  var state = { tab: "solve" };

  function switchTab(target) {
    state.tab = target;
    for (var i = 0; i < tabBtns.length; i++) {
      var active = tabBtns[i].getAttribute("data-tab") === target;
      tabBtns[i].classList.toggle("active", active);
      tabBtns[i].setAttribute("aria-selected", active ? "true" : "false");
    }
    for (var j = 0; j < tabPanels.length; j++) {
      tabPanels[j].hidden = tabPanels[j].id !== "tab-" + target;
    }
    var hint = $("copy-hint");
    if (hint) hint.hidden = true;
    persist();
  }
  for (var tb = 0; tb < tabBtns.length; tb++) {
    (function (btn) { btn.addEventListener("click", function () { switchTab(btn.getAttribute("data-tab")); }); })(tabBtns[tb]);
  }

  /* ── 클릭 복사 (결과 카드 공통) ── */
  var copiedTimers = {};
  function legacyCopy(text, done) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch (e) { /* 복사 미지원 — 표시값은 그대로 남는다 (조용한 실패 아님) */ }
  }
  function flashCopied(card) {
    var labelEl = card.querySelector(".rc-label");
    if (!labelEl) return;
    var labelKey = card.getAttribute("data-label-key");
    var origKey = labelKey;
    labelEl.textContent = t("tool.copied", "Copied");
    var timerKey = card.getAttribute("data-copy");
    if (copiedTimers[timerKey]) clearTimeout(copiedTimers[timerKey]);
    copiedTimers[timerKey] = setTimeout(function () {
      if (origKey) labelEl.textContent = t(origKey, labelEl.textContent);
    }, 1100);
  }
  function copyCard(card) {
    var raw = card.getAttribute("data-value");
    if (raw == null) return;
    var done = function () {
      flashCopied(card);
      var hint = $("copy-hint");
      if (hint) hint.hidden = false;
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(raw).then(done, function () { legacyCopy(raw, done); });
      } else { legacyCopy(raw, done); }
    } catch (e) { legacyCopy(raw, done); }
  }
  var resCards = toolRoot.querySelectorAll(".res-card");
  for (var rc = 0; rc < resCards.length; rc++) {
    resCards[rc].addEventListener("click", function () { copyCard(this); });
  }

  /* ══════════════ Tab 1: Solve proportion ══════════════ */
  var propA = $("prop-a"), propB = $("prop-b"), propC = $("prop-c"), propD = $("prop-d");
  var propInputs = { a: propA, b: propB, c: propC, d: propD };
  var propChips = document.querySelectorAll("#prop-solve-for .chip");
  var propCalcBtn = $("prop-calc-btn"), propErr = $("prop-err"), propResult = $("prop-result");
  var propResultCard = $("prop-result-card"), propResultLabel = $("prop-result-label"), propResultValue = $("prop-result-value"), propEquation = $("prop-equation");
  var solveFor = "d";
  var propLastRun = false;

  function setSolveFor(v) {
    solveFor = v;
    for (var i = 0; i < propChips.length; i++) {
      var on = propChips[i].getAttribute("data-var") === v;
      propChips[i].classList.toggle("is-active", on);
    }
    var keys = { a: propA, b: propB, c: propC, d: propD };
    for (var k in keys) {
      if (Object.prototype.hasOwnProperty.call(keys, k)) keys[k].disabled = (k === v);
    }
  }
  for (var pc = 0; pc < propChips.length; pc++) {
    (function (chip) {
      chip.addEventListener("click", function () {
        setSolveFor(chip.getAttribute("data-var"));
        propResult.hidden = true; propErr.hidden = true;
        persist();
      });
    })(propChips[pc]);
  }

  function propReadyToCalc() {
    var names = ["a", "b", "c", "d"];
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (name === solveFor) continue;
      if (parseNum(propInputs[name].value) == null) return false;
    }
    return true;
  }
  function propShowErr(key, fallback) {
    propResult.hidden = true;
    propErr.hidden = false;
    propErr.textContent = t(key, fallback);
  }

  function calcProportion() {
    propLastRun = true;
    var vals = {};
    var names = ["a", "b", "c", "d"];
    var missingOrBad = false;
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (name === solveFor) { vals[name] = null; continue; }
      var n = parseNum(propInputs[name].value);
      if (n == null) { missingOrBad = true; }
      else if (n < 0) { propShowErr("tool.solve.err.negative", "Ratio values must be zero or greater."); return; }
      vals[name] = n;
    }
    if (missingOrBad) return propShowErr("tool.solve.err.empty", "Enter values in all three known fields.");

    var r = solveProportion(vals.a, vals.b, vals.c, vals.d, solveFor);
    if (!r.ok) return propShowErr("tool.solve.err.div0", "Can't solve — that would require dividing by zero. Check your known values.");
    if (r.value < 0) return propShowErr("tool.solve.err.negative", "Ratio values must be zero or greater.");

    vals[solveFor] = r.value;
    propErr.hidden = true; propResult.hidden = false;

    var labelKey = "tool.solve.result." + solveFor;
    propResultLabel.textContent = t(labelKey, solveFor.toUpperCase() + " =");
    propResultCard.setAttribute("data-label-key", labelKey);
    var shown = numFmt(vals[solveFor], 6);
    propResultValue.textContent = shown;
    propResultCard.setAttribute("data-value", shown);
    propInputs[solveFor].value = shown;

    propEquation.textContent = numFmt(vals.a, 6) + " : " + numFmt(vals.b, 6) + "  =  " + numFmt(vals.c, 6) + " : " + numFmt(vals.d, 6);
    persist();
  }
  propCalcBtn.addEventListener("click", calcProportion);
  var propAll = [propA, propB, propC, propD];
  for (var pi = 0; pi < propAll.length; pi++) {
    propAll[pi].addEventListener("keydown", function (e) { if (e.key === "Enter") calcProportion(); });
  }

  /* ══════════════ Tab 2: Simplify ratio ══════════════ */
  var simpA = $("simp-a"), simpB = $("simp-b"), simpC = $("simp-c"), simpCalcBtn = $("simp-calc-btn");
  var simpErr = $("simp-err"), simpResult = $("simp-result");
  var simpSimplified = $("simp-result-simplified"), simpOneToN = $("simp-result-oneToN"), simpDecimal = $("simp-result-decimal")
  var simpPercent = $("simp-result-percent");
  var simpOneToNNote = $("simp-oneToN-note");
  var simpLastRun = false;

  function simpShowErr(key, fallback) {
    simpResult.hidden = true;
    simpErr.hidden = false;
    simpErr.textContent = t(key, fallback);
  }
  function calcSimplify() {
    simpLastRun = true;
    var r = simplifyRatio(simpA.value, simpB.value, simpC ? simpC.value : "");
    if (!r.ok) {
      if (r.reason === "empty") return simpShowErr("tool.simplify.err.empty", "Enter both terms of the ratio.");
      if (r.reason === "negative") return simpShowErr("tool.simplify.err.negative", "Ratio terms must be zero or greater.");
      if (r.reason === "bothZero") return simpShowErr("tool.simplify.err.bothZero", "Enter at least one term greater than zero.");
      return simpShowErr("tool.simplify.err.empty", "Enter both terms of the ratio.");
    }
    simpErr.hidden = true; simpResult.hidden = false;
    var i;
    var parts = [];
    for (i = 0; i < r.simp.length; i++) parts.push(numFmt(r.simp[i], 0));
    var simplifiedStr = parts.join(" : ");
    simpSimplified.textContent = simplifiedStr;
    simpSimplified.closest(".res-card").setAttribute("data-value", simplifiedStr);

    if (r.simp[0] === 0) {
      simpOneToN.textContent = "—";
      simpOneToN.closest(".res-card").setAttribute("data-value", "");
      simpOneToNNote.hidden = false;
    } else {
      var oneParts = ["1"];
      for (i = 1; i < r.simp.length; i++) oneParts.push(numFmt(r.simp[i] / r.simp[0], 6));
      var oneToNStr = oneParts.join(" : ");
      simpOneToN.textContent = oneToNStr;
      simpOneToN.closest(".res-card").setAttribute("data-value", oneToNStr);
      simpOneToNNote.hidden = true;
    }

    // 소수(a/b) 는 두 항일 때만 뜻이 있다 — 3항이면 카드를 숨긴다
    var decCard = simpDecimal.closest(".res-card");
    if (r.vals.length > 2) {
      decCard.hidden = true;
      decCard.setAttribute("data-value", "");
    } else {
      decCard.hidden = false;
      var decStr = (r.a === 0 && r.b === 0) ? "—" : (r.b === 0 ? "∞" : numFmt(r.a / r.b, 6));
      simpDecimal.textContent = decStr;
      decCard.setAttribute("data-value", decStr === "∞" ? "" : decStr);
    }

    // 백분율 배분 — 합 > 0 은 bothZero 검증으로 보장된다 (0 나눗셈 없음)
    var tot = 0;
    for (i = 0; i < r.vals.length; i++) tot += r.vals[i];
    var pcts = [];
    for (i = 0; i < r.vals.length; i++) pcts.push(numFmt(r.vals[i] / tot * 100, 1) + "%");
    var pctStr = pcts.join(" : ");
    simpPercent.textContent = pctStr;
    simpPercent.closest(".res-card").setAttribute("data-value", pctStr);
    persist();
  }
  simpCalcBtn.addEventListener("click", calcSimplify);
  [simpA, simpB, simpC].forEach(function (el) { if (el) el.addEventListener("keydown", function (e) { if (e.key === "Enter") calcSimplify(); }); });

  /* ══════════════ Tab 3: Scale ratio ══════════════ */
  var scaleA = $("scale-a"), scaleB = $("scale-b"), scaleFactor = $("scale-factor"), scaleCalcBtn = $("scale-calc-btn");
  var scaleErr = $("scale-err"), scaleResult = $("scale-result"), scaleResultValue = $("scale-result-value"), scaleEquation = $("scale-equation");
  var scaleChips = document.querySelectorAll("#scale-chips .chip");
  var scaleLastRun = false;

  function scaleShowErr(key, fallback) {
    scaleResult.hidden = true;
    scaleErr.hidden = false;
    scaleErr.textContent = t(key, fallback);
  }
  function calcScale() {
    scaleLastRun = true;
    var a = parseNum(scaleA.value), b = parseNum(scaleB.value), f = parseNum(scaleFactor.value);
    if (a == null || b == null || f == null) return scaleShowErr("tool.scale.err.empty", "Enter both ratio terms and a scale factor.");
    if (a < 0 || b < 0) return scaleShowErr("tool.scale.err.negative", "Ratio terms must be zero or greater.");
    if (a === 0 && b === 0) return scaleShowErr("tool.scale.err.bothZero", "Enter at least one ratio term greater than zero.");
    if (!(f > 0)) return scaleShowErr("tool.scale.err.factor", "Scale factor must be greater than zero.");

    var r = scaleRatio(a, b, f);
    scaleErr.hidden = true; scaleResult.hidden = false;
    var scaledStr = numFmt(r.na, 6) + " : " + numFmt(r.nb, 6);
    scaleResultValue.textContent = scaledStr;
    scaleResultValue.closest(".res-card").setAttribute("data-value", scaledStr);
    scaleEquation.textContent = numFmt(a, 6) + " : " + numFmt(b, 6) + "  ×  " + numFmt(f, 6) + "  =  " + scaledStr;
    persist();
  }
  scaleCalcBtn.addEventListener("click", calcScale);
  [scaleA, scaleB, scaleFactor].forEach(function (el) { el.addEventListener("keydown", function (e) { if (e.key === "Enter") calcScale(); }); });
  for (var sc = 0; sc < scaleChips.length; sc++) {
    (function (chip) {
      chip.addEventListener("click", function () {
        scaleFactor.value = chip.getAttribute("data-factor");
        for (var i = 0; i < scaleChips.length; i++) scaleChips[i].classList.toggle("is-active", scaleChips[i] === chip);
        calcScale();
      });
    })(scaleChips[sc]);
  }

  /* ── 상태 저장/복원 (철칙 1 — 상태는 프로세스 밖) ── */
  function persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        tab: state.tab,
        prop: { a: propA.value, b: propB.value, c: propC.value, d: propD.value, solveFor: solveFor },
        simp: { a: simpA.value, b: simpB.value, c: simpC ? simpC.value : "" },
        scale: { a: scaleA.value, b: scaleB.value, factor: scaleFactor.value }
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }
  }
  (function init() {
    var data = null;
    try { var raw = localStorage.getItem(LS_KEY); if (raw) data = JSON.parse(raw); } catch (e) { data = null; }
    if (data) {
      if (data.prop) {
        if (data.prop.a) propA.value = data.prop.a;
        if (data.prop.b) propB.value = data.prop.b;
        if (data.prop.c) propC.value = data.prop.c;
        if (data.prop.d) propD.value = data.prop.d;
        if (data.prop.solveFor) setSolveFor(data.prop.solveFor); else setSolveFor("d");
      } else { setSolveFor("d"); }
      if (data.simp) {
        if (data.simp.a) simpA.value = data.simp.a;
        if (data.simp.b) simpB.value = data.simp.b;
        if (data.simp.c && simpC) simpC.value = data.simp.c;
      }
      if (data.scale) {
        if (data.scale.a) scaleA.value = data.scale.a;
        if (data.scale.b) scaleB.value = data.scale.b;
        if (data.scale.factor) scaleFactor.value = data.scale.factor;
      }
      if (data.tab) switchTab(data.tab);
    } else {
      setSolveFor("d");
    }

    if (propReadyToCalc()) calcProportion();
    if (parseNum(simpA.value) != null && parseNum(simpB.value) != null) calcSimplify();
    if (parseNum(scaleA.value) != null && parseNum(scaleB.value) != null && parseNum(scaleFactor.value) != null) calcScale();
  })();

  /* ── 언어 전환: 라벨·오류 문구·Intl 포맷을 새 로케일로 재렌더 (에러 상태 포함) ── */
  document.addEventListener("i18n:change", function () {
    if (propLastRun) calcProportion();
    if (simpLastRun) calcSimplify();
    if (scaleLastRun) calcScale();
  });
  // TOOLJS:END
})();
