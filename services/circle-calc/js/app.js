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
  /* Circle Calculator — 반지름/지름/둘레/넓이 중 아무 필드에나 입력하면 나머지 세
     값을 그 자리에서 계산해 채운다. 항상 반지름(r)을 기준으로 역산 → 정산하는 방식이라
     어느 필드에서 시작해도 결과가 일관된다. 단위는 표시용 레이블(변환 없음, passthrough).
     상태: localStorage "<slug>:state" 에 { field, value, unit, precision } 만 저장.
     외부 API 없음, 전부 로컬 계산. */

  var FIELDS = ["radius", "diameter", "circumference", "area"];
  var MAX_VALUE = 1e12; // 극단값 캡 — 물리적으로 무의미한 입력을 걸러 화면 표시를 안정적으로 유지

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  // 입력된 필드 + 그 값으로부터 반지름을 역산
  function radiusFromField(field, value) {
    if (field === "radius") return value;
    if (field === "diameter") return value / 2;
    if (field === "circumference") return value / (2 * Math.PI);
    if (field === "area") return Math.sqrt(value / Math.PI);
    return NaN;
  }
  // 반지름 하나로 나머지 세 값을 전부 정산 (항상 동일한 기준에서 계산해 필드 간 불일치를 없앤다)
  function computeAll(r) {
    return {
      radius: r,
      diameter: 2 * r,
      circumference: 2 * Math.PI * r,
      area: Math.PI * r * r
    };
  }
  // 필드+원시값 → 검증 결과. ok=false 인 경우 reason 으로 empty/invalid/negative 구분.
  function solve(field, raw) {
    if (raw == null || String(raw).trim() === "") return { ok: false, reason: "empty" };
    var value = parseFloat(raw);
    if (!isFinite(value)) return { ok: false, reason: "invalid" };
    if (value < 0) return { ok: false, reason: "negative" };
    var capped = false;
    if (value > MAX_VALUE) { value = MAX_VALUE; capped = true; }
    var r = radiusFromField(field, value);
    return { ok: true, capped: capped, values: computeAll(r) };
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { radiusFromField: radiusFromField, computeAll: computeAll, solve: solve, MAX_VALUE: MAX_VALUE };
    return;
  }

  /* ---- i18n · 숫자 포맷 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "circle-calc") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  // {name} 스타일 치환 — 같은 자리표시자가 반복돼도 전부 채운다
  function tpl(str, map) {
    return String(str).replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : m;
    });
  }
  // 결과 문장에 쓰는 로케일 존중 숫자 표시 (선택한 소수 자릿수로 고정)
  function fmtDisplay(n, precision) {
    try {
      return new Intl.NumberFormat(uiLang(), {
        minimumFractionDigits: precision, maximumFractionDigits: precision
      }).format(n);
    } catch (e) { return n.toFixed(precision); }
  }
  // <input type=number> 에 되쓰는 값 — 로케일 구분자 없이 순수 숫자 문자열만 허용된다
  function fmtInputValue(n, precision) {
    var num = Number(n.toFixed(precision));
    if (Object.is(num, -0)) num = 0;
    return String(num);
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var FIELD_EL = { radius: $("radius"), diameter: $("diameter"), circumference: $("circumference"), area: $("area") };
  var unitEl = $("unit"), precisionEl = $("precision"), clearBtn = $("clear-btn");
  var errorEl = $("tool-error"), capNoteEl = $("cap-note"), zeroNoteEl = $("zero-note");
  var emptyEl = $("result-empty"), detailsEl = $("result-details");
  var lineEl = {
    radius: $("line-radius"), diameter: $("line-diameter"),
    circumference: $("line-circumference"), area: $("line-area")
  };
  if (!FIELD_EL.radius || !FIELD_EL.diameter || !FIELD_EL.circumference || !FIELD_EL.area || !detailsEl) return;

  var lastField = null, lastValues = null, lastCapped = false;

  /* ---- 상태 저장/복원 ---- */
  function saveState() {
    try {
      localStorage.setItem(SKEY, JSON.stringify({
        field: lastField,
        value: lastField ? FIELD_EL[lastField].value : "",
        unit: unitEl.value,
        precision: precisionEl.value
      }));
    } catch (e) { /* private mode — 저장만 실패, 계산은 정상 */ }
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(SKEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  /* ---- 상태 표시 헬퍼 ---- */
  function showEmpty() {
    emptyEl.hidden = false;
    detailsEl.hidden = true;
    errorEl.hidden = true;
  }
  function showError() {
    emptyEl.hidden = true;
    errorEl.textContent = tr("tool.err.negative", "Enter a positive number.");
    errorEl.hidden = false;
  }
  function buildLine(key, value, precision, unitStr) {
    var line = tpl(tr(key), { v: fmtDisplay(value, precision), u: unitStr });
    return line.replace(/\s+$/, "");
  }

  /* ---- 렌더 ---- */
  function render(field, values, capped) {
    lastField = field; lastValues = values; lastCapped = capped;

    var precision = parseInt(precisionEl.value, 10);
    if (!isFinite(precision) || precision < 0) precision = 2;
    var unit = unitEl.value.trim();
    var unitSq = unit ? unit + "²" : "²";
    var enteredTag = tr("tool.enteredTag", "");

    FIELDS.forEach(function (f) {
      if (f !== field) FIELD_EL[f].value = fmtInputValue(values[f], precision);
    });

    lineEl.radius.textContent = buildLine("tool.line.radius", values.radius, precision, unit) + (field === "radius" ? enteredTag : "");
    lineEl.diameter.textContent = buildLine("tool.line.diameter", values.diameter, precision, unit) + (field === "diameter" ? enteredTag : "");
    lineEl.circumference.textContent = buildLine("tool.line.circumference", values.circumference, precision, unit) + (field === "circumference" ? enteredTag : "");
    lineEl.area.textContent = buildLine("tool.line.area", values.area, precision, unitSq) + (field === "area" ? enteredTag : "");

    zeroNoteEl.hidden = !(values.radius === 0);
    if (capped) {
      capNoteEl.textContent = tpl(tr("tool.err.capped", "Capped at the maximum supported value ({max})."), { max: fmtDisplay(MAX_VALUE, 0) });
      capNoteEl.hidden = false;
    } else {
      capNoteEl.hidden = true;
    }

    errorEl.hidden = true;
    emptyEl.hidden = true;
    detailsEl.hidden = false;
  }

  function clearAll() {
    FIELDS.forEach(function (f) { FIELD_EL[f].value = ""; });
    lastField = null; lastValues = null; lastCapped = false;
    showEmpty();
    capNoteEl.hidden = true;
    zeroNoteEl.hidden = true;
    saveState();
    try { FIELD_EL.radius.focus(); } catch (e) { /* noop */ }
  }

  /* ---- 필드 입력 처리 (모든 필드가 서로의 입력이자 결과) ---- */
  function handleFieldChange(field) {
    var raw = FIELD_EL[field].value;
    var res = solve(field, raw);
    if (!res.ok) {
      if (res.reason === "empty") {
        FIELDS.forEach(function (f) { if (f !== field) FIELD_EL[f].value = ""; });
        lastField = null; lastValues = null; lastCapped = false;
        showEmpty();
        capNoteEl.hidden = true;
        zeroNoteEl.hidden = true;
      } else if (res.reason === "negative") {
        showError();
      }
      // reason === "invalid" (예: 입력 중인 "-", ".") — 조용히 대기, 이전 상태 유지
      saveState();
      return;
    }
    render(field, res.values, res.capped);
    saveState();
  }

  /* ---- 이벤트 ---- */
  FIELDS.forEach(function (f) {
    FIELD_EL[f].addEventListener("input", function () { handleFieldChange(f); });
    FIELD_EL[f].addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); this.blur(); }
    });
  });
  if (clearBtn) clearBtn.addEventListener("click", clearAll);
  if (unitEl) unitEl.addEventListener("input", function () {
    if (lastField && lastValues) render(lastField, lastValues, lastCapped);
    saveState();
  });
  if (precisionEl) precisionEl.addEventListener("change", function () {
    if (lastField && lastValues) render(lastField, lastValues, lastCapped);
    saveState();
  });
  // 언어 전환 시 숫자 포맷·안내 문구를 새 로케일로 재적용
  document.addEventListener("i18n:change", function () {
    if (lastField && lastValues) render(lastField, lastValues, lastCapped);
    else if (errorEl.hidden === false) showError();
  });

  /* ---- 초기화: 저장된 상태 복원 ---- */
  (function init() {
    var state = loadState();
    if (state && typeof state.unit === "string" && state.unit) unitEl.value = state.unit;
    if (state && state.precision) precisionEl.value = state.precision;
    if (state && state.field && FIELDS.indexOf(state.field) !== -1 && state.value) {
      FIELD_EL[state.field].value = state.value;
      handleFieldChange(state.field);
    } else {
      showEmpty();
    }
  })();
  // TOOLJS:END
})();
