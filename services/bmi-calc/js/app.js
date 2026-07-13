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
  var SLUG = cfg.slug || "bmi-calc";
  var LS_KEY = SLUG + ":last";

  var heightInput = document.getElementById("height-input");
  var weightInput = document.getElementById("weight-input");
  var calcBtn = document.getElementById("calc-btn");
  var resultEl = document.getElementById("result");

  // 저장된 마지막 값 복원
  (function restoreLast() {
    try {
      var saved = localStorage.getItem(LS_KEY);
      if (!saved) return;
      var parsed = JSON.parse(saved);
      if (parsed.height && heightInput) heightInput.value = parsed.height;
      if (parsed.weight && weightInput) weightInput.value = parsed.weight;
    } catch (e) { /* localStorage 접근 불가 환경 */ }
  })();

  function classifyWHO(bmi) {
    if (bmi < 18.5) return { label: "저체중", cls: "badge-blue" };
    if (bmi < 25)   return { label: "정상",   cls: "badge-green" };
    if (bmi < 30)   return { label: "과체중", cls: "badge-orange" };
    return             { label: "비만",   cls: "badge-red" };
  }

  function classifyAsia(bmi) {
    if (bmi < 18.5) return { label: "저체중",    cls: "badge-blue" };
    if (bmi < 23)   return { label: "정상",      cls: "badge-green" };
    if (bmi < 25)   return { label: "비만 전단계", cls: "badge-orange" };
    if (bmi < 30)   return { label: "1단계 비만", cls: "badge-red" };
    return             { label: "2단계 비만",  cls: "badge-red" };
  }

  function isExtreme(height, weight) {
    // 극단값: BMI < 10 또는 > 60 이면 비정상 경고
    var bmi = weight / Math.pow(height / 100, 2);
    return bmi < 10 || bmi > 60;
  }

  function showResult(html) {
    resultEl.innerHTML = html;
    resultEl.hidden = false;
  }

  function calculate() {
    var hVal = parseFloat(heightInput.value);
    var wVal = parseFloat(weightInput.value);

    // 빈 입력 체크
    if (!heightInput.value.trim() || !weightInput.value.trim() || isNaN(hVal) || isNaN(wVal)) {
      showResult('<p class="result-error">키와 몸무게를 입력해 주세요.</p>');
      return;
    }

    // 범위 체크 (input[min/max]가 있지만 JS에서도 명시적으로 처리)
    if (hVal <= 0 || hVal < 50 || hVal > 250) {
      showResult('<p class="result-error">키를 50~250 cm 범위로 입력해 주세요.</p>');
      return;
    }
    if (wVal <= 0 || wVal < 10 || wVal > 300) {
      showResult('<p class="result-error">몸무게를 10~300 kg 범위로 입력해 주세요.</p>');
      return;
    }

    // BMI 계산
    var heightM = hVal / 100;
    var bmi = wVal / (heightM * heightM);
    var bmiRounded = Math.round(bmi * 100) / 100;

    var who = classifyWHO(bmi);
    var asia = classifyAsia(bmi);

    // 건강 체중 범위 (아시아 기준 정상: BMI 18.5~22.9)
    var minWeight = Math.round(18.5 * heightM * heightM * 10) / 10;
    var maxWeight = Math.round(22.9 * heightM * heightM * 10) / 10;

    // 극단값 경고
    var warningHtml = "";
    if (isExtreme(hVal, wVal)) {
      warningHtml = '<p class="result-warning">비정상적인 수치일 수 있습니다. 키와 몸무게를 다시 확인해 주세요.</p>';
    }

    var html = warningHtml +
      '<div class="bmi-number">BMI <strong>' + bmiRounded.toFixed(2) + '</strong></div>' +
      '<div class="badge-row">' +
        '<span class="badge ' + who.cls + '">WHO: ' + who.label + '</span>' +
        '<span class="badge ' + asia.cls + '">아시아 기준: ' + asia.label + '</span>' +
      '</div>' +
      '<p class="healthy-range">건강 체중 범위 (아시아 정상 기준): <strong>' + minWeight.toFixed(1) + ' ~ ' + maxWeight.toFixed(1) + ' kg</strong></p>';

    showResult(html);

    // localStorage 저장
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ height: hVal, weight: wVal }));
    } catch (e) { /* noop */ }
  }

  if (calcBtn) {
    calcBtn.addEventListener("click", calculate);
  }

  // Enter 키 지원
  function onEnter(e) {
    if (e.key === "Enter") calculate();
  }
  if (heightInput) heightInput.addEventListener("keydown", onEnter);
  if (weightInput) weightInput.addEventListener("keydown", onEnter);
  // TOOLJS:END
})();
