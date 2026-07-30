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
  /* Angle Converter — 도(度)를 기준 단위로 삼아 라디안·백분도(grad)·회전(turn) 4개 필드를
     동시 편집·동기화한다. 편집 중인 필드만 건너뛰고 나머지 3개 + DMS 트리플을 다시 그린다.
     상태: localStorage "<slug>:state" (마지막 각도 + DMS 모드 on/off)만. 외부 API 없음. */
  var cfg = window.APP_CONFIG || {};
  var LS_KEY = (cfg.slug || "angle-conv") + ":state";

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상). 도(度)를 기준 단위로 환산 계수를 둔다.
  var DEG_PER = {
    deg: 1,
    rad: 180 / Math.PI,  // 1 rad = 180/π 度
    grad: 0.9,           // 1 gradian = 0.9 度 (400 grad = 360 度)
    turn: 360             // 1 turn = 360 度
  };

  function toDegrees(value, unit) { return value * DEG_PER[unit]; }
  function fromDegrees(deg, unit) { return deg / DEG_PER[unit]; }

  function gcd(a, b) {
    a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b));
    while (b) { var t = b; b = a % b; a = t; }
    return a || 1;
  }

  // 도(度) → "nπ/d" 꼴의 정확한 분수. 소수점 6자리 넘게 세분화되거나 분모가
  // 360을 넘으면(=흔한 각이 아님) null — 그런 경우는 근사 소수만 보여준다.
  function degToPiFraction(deg) {
    if (!isFinite(deg)) return null;
    if (deg === 0) return { num: 0, den: 1 };
    var neg = deg < 0;
    var a = Math.abs(deg);
    var s = a.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    var dot = s.indexOf(".");
    var intPart = dot === -1 ? s : s.slice(0, dot);
    var fracPart = dot === -1 ? "" : s.slice(dot + 1);
    var denomPow = Math.pow(10, fracPart.length);
    var numerator = parseInt((intPart + fracPart) || "0", 10);
    if (!numerator) return { num: 0, den: 1 };
    var denominator = 180 * denomPow;
    var g = gcd(numerator, denominator);
    numerator = numerator / g;
    denominator = denominator / g;
    if (denominator > 360) return null;
    return { num: neg ? -numerator : numerator, den: denominator };
  }

  function formatPiFraction(fr) {
    if (!fr) return null;
    if (fr.num === 0) return "0";
    var sign = fr.num < 0 ? "-" : "";
    var n = Math.abs(fr.num);
    var head = sign + (n === 1 ? "π" : n + "π");
    return fr.den === 1 ? head : head + "/" + fr.den;
  }

  // 도(度) → 도-분-초 분해 (부동소수 잡음 정리 포함)
  function decomposeDMS(deg) {
    var neg = deg < 0;
    var a = Math.abs(deg);
    var d = Math.floor(a);
    var remMin = (a - d) * 60;
    var m = Math.floor(remMin);
    var sec = (remMin - m) * 60;
    sec = Math.round(sec * 1000) / 1000;
    if (sec >= 60) { sec -= 60; m += 1; }
    if (m >= 60) { m -= 60; d += 1; }
    return { neg: neg, d: d, m: m, s: sec };
  }
  // 도-분-초 → 도(度). 부호는 D(도) 필드에서만 받는다(분·초는 항상 크기로 취급).
  function composeDMS(d, m, s) {
    d = d || 0; m = m || 0; s = s || 0;
    var neg = d < 0 || (d === 0 && 1 / d === -Infinity);
    var mag = Math.abs(d) + Math.abs(m) / 60 + Math.abs(s) / 3600;
    return neg ? -mag : mag;
  }

  // 지수 표기 없는 십진 문자열 (유효숫자 반올림된 값 가정) — 후행 0 제거
  function plain(n) {
    if (n === 0) return "0";
    var neg = n < 0;
    var s = Math.abs(n).toExponential();
    var p = s.split("e");
    var mant = p[0].replace(".", "");
    var exp = parseInt(p[1], 10);
    var pointPos = 1 + exp;
    var out;
    if (pointPos <= 0) {
      out = "0." + new Array(-pointPos + 1).join("0") + mant;
    } else if (pointPos >= mant.length) {
      out = mant + new Array(pointPos - mant.length + 1).join("0");
    } else {
      out = mant.slice(0, pointPos) + "." + mant.slice(pointPos);
    }
    if (out.indexOf(".") !== -1) out = out.replace(/0+$/, "").replace(/\.$/, "");
    return (neg ? "-" : "") + out;
  }
  // 표시·입력 포맷: 유효숫자 10자리 → 후행 0 제거. 극단값은 지수 표기 폴백.
  // <input type=number> 에 그대로 넣을 수 있도록 천단위 구분자는 절대 넣지 않는다.
  function fmt(v) {
    if (!isFinite(v)) return null;
    if (v === 0) return "0";
    var a = Math.abs(v);
    var rounded = Number(v.toPrecision(10));
    if (a >= 1e15 || a < 1e-9) return rounded.toExponential();
    return plain(rounded);
  }
  // 360도 기준으로 축약한 회전 분수(단위원 표의 "회전" 열용). 표에 쓰는 각은 항상 정수이며
  // 0~360 범위 그대로 다룬다 — 나머지 연산으로 감싸면 360°(=1턴)가 0으로 접혀버려 틀린다.
  function turnFraction(deg) {
    if (Math.abs(deg - Math.round(deg)) > 1e-9) return null;
    var r = Math.round(deg);
    if (r === 0) return "0";
    var neg = r < 0;
    r = Math.abs(r);
    var g = gcd(r, 360);
    var num = r / g, den = 360 / g;
    var out = den === 1 ? String(num) : num + "/" + den;
    return neg ? "-" + out : out;
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      DEG_PER: DEG_PER, toDegrees: toDegrees, fromDegrees: fromDegrees,
      gcd: gcd, degToPiFraction: degToPiFraction, formatPiFraction: formatPiFraction,
      decomposeDMS: decomposeDMS, composeDMS: composeDMS, fmt: fmt, turnFraction: turnFraction
    };
    return;
  }
  // calc-core:end

  function $(id) { return document.getElementById(id); }
  var degEl = $("ang-degrees"), radEl = $("ang-radians"), gradEl = $("ang-gradians"), turnEl = $("ang-turns");
  var dmsToggle = $("ang-dms-toggle"), dmsWrap = $("ang-dms-wrap"), degWrap = $("ang-deg-wrap");
  var dDEl = $("ang-dms-d"), dMEl = $("ang-dms-m"), dSEl = $("ang-dms-s");
  var exactEl = $("ang-exact"), errEl = $("ang-err");
  var tbody = $("ang-tbody");
  if (!degEl || !radEl || !gradEl || !turnEl || !tbody) return;

  var ANGLES = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330, 360];
  var current = 30; // 표준각(30° = π/6)을 기본값으로 — 정확분수 기능을 바로 보여준다

  function t(key, fb) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fb : v;
  }

  function saveState() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ deg: current, dms: !!(dmsToggle && dmsToggle.checked) })); }
    catch (e) { /* private mode */ }
  }
  function restoreState() {
    try {
      var s = localStorage.getItem(LS_KEY);
      if (!s) return;
      var p = JSON.parse(s);
      if (p && isFinite(p.deg)) current = p.deg;
      if (p && p.dms && dmsToggle) dmsToggle.checked = true;
    } catch (e) { /* 접근 불가·파싱 실패 — 기본값으로 시작 */ }
  }

  function showError(show) {
    if (!errEl) return;
    errEl.hidden = !show;
    if (show) errEl.textContent = t("tool.err.invalid", "Enter a valid number.");
  }

  function renderExact() {
    if (!exactEl) return;
    var piStr = formatPiFraction(degToPiFraction(current));
    if (piStr == null) { exactEl.hidden = true; return; }
    exactEl.hidden = false;
    exactEl.textContent = t("tool.exact", "Exact: {x} rad").replace("{x}", piStr);
  }

  function renderTableHighlight() {
    var rows = tbody.querySelectorAll("tr");
    for (var i = 0; i < rows.length; i++) {
      var a = Number(rows[i].getAttribute("data-deg"));
      rows[i].className = Math.abs(a - current) < 1e-6 ? "ang-active" : "";
    }
  }

  function setDegView() { if (document.activeElement !== degEl) degEl.value = fmt(current); }
  function setRadView() { if (document.activeElement !== radEl) radEl.value = fmt(fromDegrees(current, "rad")); }
  function setGradView() { if (document.activeElement !== gradEl) gradEl.value = fmt(fromDegrees(current, "grad")); }
  function setTurnView() { if (document.activeElement !== turnEl) turnEl.value = fmt(fromDegrees(current, "turn")); }
  function setDmsView() {
    if (!dDEl || !dMEl || !dSEl) return;
    var ae = document.activeElement;
    if (ae === dDEl || ae === dMEl || ae === dSEl) return;
    var dms = decomposeDMS(current);
    dDEl.value = String(dms.neg ? -dms.d : dms.d);
    dMEl.value = String(dms.m);
    dSEl.value = String(Math.round(dms.s * 100) / 100);
  }

  // skip: 방금 사용자가 편집한 "필드 그룹"은 다시 쓰지 않는다 (커서 위치 보존)
  function renderAll(skip) {
    if (skip !== "deg") setDegView();
    if (skip !== "rad") setRadView();
    if (skip !== "grad") setGradView();
    if (skip !== "turn") setTurnView();
    if (skip !== "dms") setDmsView();
    renderExact();
    renderTableHighlight();
  }

  function handleFieldInput(el, unit) {
    var raw = el.value.trim();
    if (raw === "") { showError(false); return; } // 편집 중 빈값은 다른 필드를 건드리지 않는다
    var num = Number(raw);
    if (!isFinite(num)) { showError(true); return; }
    showError(false);
    current = toDegrees(num, unit);
    renderAll(unit);
    saveState();
  }

  function handleDmsInput() {
    var rawD = dDEl.value.trim(), rawM = dMEl.value.trim(), rawS = dSEl.value.trim();
    if (rawD === "" && rawM === "" && rawS === "") { showError(false); return; }
    var d = rawD === "" ? 0 : Number(rawD);
    var m = rawM === "" ? 0 : Number(rawM);
    var s = rawS === "" ? 0 : Number(rawS);
    if (!isFinite(d) || !isFinite(m) || !isFinite(s)) { showError(true); return; }
    showError(false);
    current = composeDMS(d, m, s);
    renderAll("dms");
    saveState();
  }

  degEl.addEventListener("input", function () { handleFieldInput(degEl, "deg"); });
  radEl.addEventListener("input", function () { handleFieldInput(radEl, "rad"); });
  gradEl.addEventListener("input", function () { handleFieldInput(gradEl, "grad"); });
  turnEl.addEventListener("input", function () { handleFieldInput(turnEl, "turn"); });
  if (dDEl) dDEl.addEventListener("input", handleDmsInput);
  if (dMEl) dMEl.addEventListener("input", handleDmsInput);
  if (dSEl) dSEl.addEventListener("input", handleDmsInput);

  function applyDmsMode() {
    var on = !!(dmsToggle && dmsToggle.checked);
    if (dmsWrap) dmsWrap.hidden = !on;
    if (degWrap) degWrap.hidden = on;
  }
  if (dmsToggle) {
    dmsToggle.addEventListener("change", function () {
      applyDmsMode();
      renderAll(null);
      saveState();
    });
  }

  /* ---- 단위원(기준각) 표 생성 — 언어 무관 숫자라 언어 전환에도 재생성 불필요 ---- */
  function buildTable() {
    tbody.textContent = "";
    for (var i = 0; i < ANGLES.length; i++) {
      var a = ANGLES[i];
      var tr = document.createElement("tr");
      tr.setAttribute("data-deg", String(a));

      var tdDeg = document.createElement("td");
      tdDeg.textContent = a + "°";

      var tdRad = document.createElement("td");
      tdRad.className = "ang-val";
      var piStr = formatPiFraction(degToPiFraction(a));
      tdRad.textContent = piStr == null ? fmt(a * Math.PI / 180) : piStr;

      var tdGrad = document.createElement("td");
      tdGrad.className = "ang-val";
      tdGrad.textContent = fmt(a / DEG_PER.grad);

      var tdTurn = document.createElement("td");
      tdTurn.className = "ang-val";
      var tf = turnFraction(a);
      tdTurn.textContent = tf == null ? fmt(a / 360) : tf;

      tr.appendChild(tdDeg); tr.appendChild(tdRad); tr.appendChild(tdGrad); tr.appendChild(tdTurn);
      tbody.appendChild(tr);
    }
  }

  // 언어 전환 시 동적 문구(정확분수·오류) 재적용 — 정적 라벨은 i18n 엔진이 처리
  document.addEventListener("i18n:change", function () {
    renderExact();
    if (errEl && !errEl.hidden) showError(true);
  });

  restoreState();
  applyDmsMode();
  buildTable();
  renderAll(null);
  // TOOLJS:END
})();
