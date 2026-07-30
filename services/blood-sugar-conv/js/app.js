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
  /* Blood Sugar Converter — mg/dL <-> mmol/L 양방향 순간 변환 + 상황별(공복/식후) 참고 범위 분류.
     외부 API 없음, 모든 계산은 로컬. 상태: localStorage "<slug>:state" (마지막 값 + 상황) 만 저장.
     교육용 도구 — 진단이 아니며, 실제 관리는 항상 의료진 지침을 따르도록 안내한다. */

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상)
  // 18.016 = 포도당(glucose) 몰질량 180.16 g/mol ÷ 10. mg/dL ÷ 18.016 = mmol/L.
  var FACTOR = 18.016;

  function mgToMmol(mg) { return mg / FACTOR; }
  function mmolToMg(mmol) { return mmol * FACTOR; }

  // 상황(공복/식후)별 참고 범위로 분류 — ADA(미국당뇨병학회) 기준을 따른 통상 임계값.
  // low 는 상황과 무관하게 70 mg/dL(3.9 mmol/L) 미만이면 항상 우선 적용된다(저혈당은 언제든 발생 가능).
  function classify(mg, ctx) {
    if (mg < 70) return "low";
    var normalMax = ctx === "postmeal" ? 140 : 100;
    var diabetesMin = ctx === "postmeal" ? 200 : 126;
    if (mg < normalMax) return "normal";
    if (mg < diabetesMin) return "prediabetes";
    return "diabetes";
  }

  // 문자열 → 유한수. 빈 값/비숫자는 NaN (호출부가 "빈 입력"과 "오류"를 구분해 처리).
  function parseNum(raw) {
    if (raw == null) return NaN;
    var s = String(raw).trim();
    if (s === "") return NaN;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { FACTOR: FACTOR, mgToMmol: mgToMmol, mmolToMg: mmolToMg, classify: classify, parseNum: parseNum };
    return;
  }
  // calc-core:end

  var cfg = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "blood-sugar-conv";
  var LS_KEY = SLUG + ":state";

  function $(id) { return document.getElementById(id); }
  var mgdlEl = $("bg-mgdl"), mmolEl = $("bg-mmol"), clearBtn = $("bg-clear");
  var ctxBtns = document.querySelectorAll(".bg-ctx-btn");
  var emptyEl = $("result-empty"), verdictWrap = $("result-verdict");
  var eqEl = $("bg-eq-text"), badgeEl = $("bg-badge"), verdictTextEl = $("bg-verdict-text"), warnEl = $("bg-warn");
  var tableRows = document.querySelectorAll("#bg-ref-table tbody tr");
  var commonBody = $("bg-common-tbody");
  if (!mgdlEl || !mmolEl || !emptyEl || !verdictWrap) return;

  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function T(key, params) {
    var s = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    if (s == null) s = key;
    if (params) {
      for (var p in params) {
        if (Object.prototype.hasOwnProperty.call(params, p)) s = s.split("{" + p + "}").join(params[p]);
      }
    }
    return s;
  }
  // 표시용 mg/dL(정수 단위 — 실제 혈당계 표기 관례) / mmol/L(소수 1자리 — 임상 표기 관례) 포맷
  function fmtMg(n) {
    try { return new Intl.NumberFormat(uiLang(), { maximumFractionDigits: 0 }).format(Math.round(n)); }
    catch (e) { return String(Math.round(n)); }
  }
  function fmtMmol(n) {
    try {
      return new Intl.NumberFormat(uiLang(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
    } catch (e) { return (Math.round(n * 10) / 10).toFixed(1); }
  }

  var CAT_KEY = { low: "tool.badge.low", normal: "tool.badge.normal", prediabetes: "tool.badge.prediabetes", diabetes: "tool.badge.diabetes" };
  var CTX_KEY = { fasting: "tool.context.fasting", postmeal: "tool.context.postmeal" };

  /* ---- 흔히 검색되는 값 — SEO 겸 빠른 참조표 (mg/dL 은 정수 관례) ---- */
  var COMMON_VALUES = [70, 80, 90, 100, 110, 120, 126, 140, 150, 180, 200, 250, 300];

  function renderCommonTable() {
    if (!commonBody) return;
    commonBody.textContent = "";
    for (var i = 0; i < COMMON_VALUES.length; i++) {
      var mg = COMMON_VALUES[i];
      var tr = document.createElement("tr");
      var tdMg = document.createElement("td");
      tdMg.textContent = fmtMg(mg) + " mg/dL";
      var tdMmol = document.createElement("td");
      tdMmol.className = "bg-val";
      tdMmol.textContent = fmtMmol(mgToMmol(mg)) + " mmol/L";
      tr.appendChild(tdMg);
      tr.appendChild(tdMmol);
      commonBody.appendChild(tr);
    }
  }

  /* ---- 상태 ---- */
  var context = "fasting";     // "fasting" | "postmeal"
  var currentMg = NaN;         // 정상 값의 캐노니컬 mg/dL (NaN = 없음)
  var hasError = false;        // 음수 등 명시적 오류

  function setActiveContext() {
    for (var i = 0; i < ctxBtns.length; i++) {
      var on = ctxBtns[i].getAttribute("data-ctx") === context;
      ctxBtns[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function highlightTable(cat) {
    for (var i = 0; i < tableRows.length; i++) {
      var row = tableRows[i];
      row.className = (cat && row.getAttribute("data-cat") === cat) ? "bg-active" : "";
    }
  }

  function showEmpty() {
    verdictWrap.hidden = true;
    emptyEl.hidden = false;
    emptyEl.className = "";
    emptyEl.textContent = T("tool.placeholder");
  }
  function showError() {
    verdictWrap.hidden = true;
    emptyEl.hidden = false;
    emptyEl.className = "bg-error";
    emptyEl.setAttribute("role", "alert");
    emptyEl.textContent = T("tool.err.negative");
  }

  function showVerdict(cat, warnExtreme) {
    emptyEl.hidden = true;
    verdictWrap.hidden = false;
    if (eqEl) eqEl.textContent = fmtMg(currentMg) + " mg/dL ≈ " + fmtMmol(mgToMmol(currentMg)) + " mmol/L";
    if (badgeEl) {
      badgeEl.className = "bg-badge cat-" + cat;
      badgeEl.textContent = T(CAT_KEY[cat]);
    }
    if (verdictTextEl) {
      verdictTextEl.textContent = T("tool.verdict", { context: T(CTX_KEY[context]), category: T(CAT_KEY[cat]) });
    }
    if (warnEl) {
      warnEl.hidden = !warnExtreme;
      if (warnExtreme) warnEl.textContent = T("tool.warn.extreme");
    }
  }

  function saveState() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ mg: currentMg, ctx: context }));
    } catch (e) { /* private mode — 저장만 실패, 계산은 정상 */ }
  }

  function render() {
    setActiveContext();
    if (hasError) { showError(); highlightTable(null); return; }
    if (isNaN(currentMg)) { showEmpty(); highlightTable(null); return; }
    var warnExtreme = currentMg > 600; // ~33.3 mmol/L — 극단값(예: 오탈자) 알림, 계산은 계속 표시
    var cat = classify(currentMg, context);
    showVerdict(cat, warnExtreme);
    highlightTable(cat);
    saveState();
  }

  /* ---- 입력 동기화: 한쪽에 입력하면 다른 쪽만 갱신(자기 자신은 건드리지 않아 커서 튐 방지) ---- */
  function onMgInput() {
    var raw = mgdlEl.value;
    if (raw.trim() === "") { mmolEl.value = ""; currentMg = NaN; hasError = false; render(); return; }
    var v = parseNum(raw);
    if (isNaN(v)) { mmolEl.value = ""; currentMg = NaN; hasError = false; render(); return; }
    if (v < 0) { hasError = true; currentMg = NaN; mmolEl.value = ""; render(); return; }
    hasError = false;
    currentMg = v;
    mmolEl.value = String(Math.round(mgToMmol(v) * 10) / 10);
    render();
  }
  function onMmolInput() {
    var raw = mmolEl.value;
    if (raw.trim() === "") { mgdlEl.value = ""; currentMg = NaN; hasError = false; render(); return; }
    var v = parseNum(raw);
    if (isNaN(v)) { mgdlEl.value = ""; currentMg = NaN; hasError = false; render(); return; }
    if (v < 0) { hasError = true; currentMg = NaN; mgdlEl.value = ""; render(); return; }
    hasError = false;
    var mg = mmolToMg(v);
    currentMg = mg;
    mgdlEl.value = String(Math.round(mg));
    render();
  }

  mgdlEl.addEventListener("input", onMgInput);
  mmolEl.addEventListener("input", onMmolInput);

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      mgdlEl.value = "";
      mmolEl.value = "";
      currentMg = NaN;
      hasError = false;
      render();
      try { localStorage.removeItem(LS_KEY); } catch (e) { /* private mode */ }
      mgdlEl.focus();
    });
  }

  for (var i = 0; i < ctxBtns.length; i++) {
    ctxBtns[i].addEventListener("click", function () {
      var next = this.getAttribute("data-ctx");
      if (next === context) return;
      context = next;
      render();
    });
  }

  // 언어 전환 시 동적으로 그린 문구(배지·설명·경고·공통값표)를 새 언어로 재적용
  document.addEventListener("i18n:change", function () {
    renderCommonTable();
    render();
  });

  /* ---- 초기화: 마지막 값 복원(상황 + mg/dL) ---- */
  (function restore() {
    var saved = null;
    try { saved = localStorage.getItem(LS_KEY); } catch (e) { /* private mode */ }
    if (saved) {
      try {
        var p = JSON.parse(saved);
        if (p && (p.ctx === "fasting" || p.ctx === "postmeal")) context = p.ctx;
        if (p && typeof p.mg === "number" && isFinite(p.mg) && p.mg >= 0) {
          mgdlEl.value = String(Math.round(p.mg));
          mmolEl.value = String(Math.round(mgToMmol(p.mg) * 10) / 10);
          currentMg = p.mg;
        }
      } catch (e) { /* 손상된 값은 무시 */ }
    }
  })();

  renderCommonTable();
  render();
  // TOOLJS:END
})();
