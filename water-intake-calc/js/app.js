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
  var cfg = window.APP_CONFIG || {};
  var LS_KEY = (cfg.slug || "water-intake-calc") + ":last";
  var LB_PER_KG = 2.20462;     // 1 kg = 2.20462 lb
  var ML_PER_KG = 33;          // 통용 30~35 mL/kg 의 중간값 (FAQ 에 범위 명시)
  var LIM = { kgMin: 10, kgMax: 300, lbMin: 22, lbMax: 660 };
  var EXTREME_KG = 250;        // 이상 경고 임계 (kg 환산 기준)
  var HYPO_ML = 5000;          // 저나트륨혈증 주의 임계
  var ACT = {                  // 활동량 보정(mL) — select value 로 사용
    "0":   { key: "tool.activity.low",      fallback: "Low — mostly sitting (+0 mL)" },
    "350": { key: "tool.activity.moderate", fallback: "Moderate — exercise 1–3×/week (+350 mL)" },
    "700": { key: "tool.activity.high",     fallback: "High — exercise 4+×/week or physical work (+700 mL)" }
  };

  function $(id) { return document.getElementById(id); }
  var weightEl = $("weight-input");
  var activityEl = $("activity-select");
  var calcBtn = $("calc-btn");
  var box = $("result-box");
  var errEl = $("result-error");
  var bodyEl = $("result-body");
  var warnEl = $("result-warning");
  var outLiters = $("r-liters");
  var outDetail = $("r-detail");
  var outCups = $("r-cups");
  var outBottles = $("r-bottles");
  var hypoEl = $("r-hypo");
  if (!weightEl || !activityEl || !calcBtn || !box) return;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function d1(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function fill(tpl, map) {
    return tpl.replace(/\{(\w+)\}/g, function (_, k) { return map[k] != null ? map[k] : ""; });
  }

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상)
  function toKg(weight, unit) {
    return unit === "lb" ? weight / LB_PER_KG : weight;
  }
  function computeIntake(weightKg, adjustMl) {
    var base = weightKg * ML_PER_KG;         // 기본 권장량
    var total = base + adjustMl;             // + 활동량 보정
    return {
      kg: weightKg,
      ml: total,
      liters: total / 1000,
      floz: total / 29.5735,                 // US fluid ounce
      cups: total / 236.6,                   // US 8 fl oz 컵
      bottles: total / 500,                  // 500 mL 생수병
      extreme: weightKg >= EXTREME_KG,       // 이상값 경고 (bmi-calc 패턴)
      hypo: total > HYPO_ML                  // 과다 섭취 주의
    };
  }
  // calc-core:end

  var last = null; // 마지막 렌더 상태 (언어 전환 재렌더용 — 영속 상태는 localStorage 에만)

  function radioVal(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }
  function setRadio(name, value) {
    var el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (el) el.checked = true;
  }
  function currentUnit() { return radioVal("unit") === "lb" ? "lb" : "kg"; }

  function applyUnitBounds() {
    if (currentUnit() === "lb") {
      weightEl.min = LIM.lbMin; weightEl.max = LIM.lbMax;
    } else {
      weightEl.min = LIM.kgMin; weightEl.max = LIM.kgMax;
    }
  }

  function showError(key, fallback) {
    last = { kind: "error", key: key, fallback: fallback };
    box.hidden = false;
    bodyEl.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key, fallback);
  }
  function render(r, factorStr) {
    last = { kind: "result", r: r, factorStr: factorStr };
    errEl.hidden = true;
    bodyEl.hidden = false;
    box.hidden = false;
    warnEl.hidden = !r.extreme;
    hypoEl.hidden = !r.hypo;
    outLiters.textContent = fill(t("tool.result.liters", "{n} L"), { n: d1(r.liters) });
    outDetail.textContent = fill(t("tool.result.detail", "{ml} mL · {oz} fl oz"),
      { ml: group(Math.round(r.ml)), oz: group(Math.round(r.floz)) });
    outCups.textContent = fill(t("tool.result.cups", "≈ {n} cups (8 fl oz)"), { n: d1(r.cups) });
    outBottles.textContent = fill(t("tool.result.bottles", "≈ {n} bottles (500 mL)"), { n: d1(r.bottles) });
  }

  function calculate() {
    var unit = currentUnit();
    var raw = weightEl.value.trim();
    var weight = raw === "" ? NaN : Number(raw);

    // 빈 입력 → 명시적 안내 (조용한 실패 금지)
    if (raw === "" || isNaN(weight)) {
      showError("tool.err.empty", "Enter your weight to see your daily water target.");
      return;
    }
    // 범위 밖(0·음수 포함) — input min/max 와 별개로 JS 에서도 명시적 차단
    var min = unit === "lb" ? LIM.lbMin : LIM.kgMin;
    var max = unit === "lb" ? LIM.lbMax : LIM.kgMax;
    if (weight < min || weight > max) {
      if (unit === "lb") showError("tool.err.range.lb", "Enter a weight between 22 and 660 lb.");
      else showError("tool.err.range.kg", "Enter a weight between 10 and 300 kg.");
      return;
    }

    var factorStr = ACT[activityEl.value] ? activityEl.value : "0";
    var r = computeIntake(toKg(weight, unit), Number(factorStr));
    render(r, factorStr);

    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        weight: weight, unit: unit, activity: factorStr
      }));
    } catch (e) { /* private mode — 저장 실패는 무시 */ }
  }

  // 저장된 마지막 입력값 복원 (localStorage — 서버 미전송)
  (function restoreLast() {
    try {
      var saved = localStorage.getItem(LS_KEY);
      if (saved) {
        var p = JSON.parse(saved);
        if (p.unit === "kg" || p.unit === "lb") setRadio("unit", p.unit);
        if (p.weight != null && p.weight !== "") weightEl.value = p.weight;
        if (ACT[p.activity]) activityEl.value = p.activity;
      }
    } catch (e) { /* 접근 불가·파싱 실패 — 빈 폼으로 시작 */ }
    applyUnitBounds();
  })();

  calcBtn.addEventListener("click", calculate);
  weightEl.addEventListener("keydown", function (e) { if (e.key === "Enter") calculate(); });
  // 활동량 변경 시, 이미 결과가 있으면 즉시 재계산
  activityEl.addEventListener("change", function () { if (!box.hidden) calculate(); });
  // 단위 토글: 입력 숫자는 유지하고 min/max 갱신, 결과 표시 중이면 재계산
  var unitRadios = document.querySelectorAll('input[name="unit"]');
  for (var ui = 0; ui < unitRadios.length; ui++) {
    unitRadios[ui].addEventListener("change", function () {
      applyUnitBounds();
      if (!box.hidden) calculate();
    });
  }

  // 언어 전환 시 동적 문구(단위 환산·오류) 재렌더
  document.addEventListener("i18n:change", function () {
    if (!last) return;
    if (last.kind === "error") showError(last.key, last.fallback);
    else render(last.r, last.factorStr);
  });
  // TOOLJS:END
})();
