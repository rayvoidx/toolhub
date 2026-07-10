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
  var SLUG = cfg.slug || "salary-calc";
  var LS_KEY = SLUG + ":last";

  // 2026년 요율 상수
  var RATES = {
    pension: 0.045,          // 국민연금 4.5%
    pension_cap: 5900000,    // 국민연금 기준월보수 상한 590만원
    health: 0.03545,         // 건강보험 3.545%
    ltc_ratio: 0.9182,       // 장기요양 = 건강보험료 × 9.182% (건보료 대비 비율)
    employment: 0.009        // 고용보험 0.9%
  };

  // 간이세액표 근사: [과세월급여 상한(원), [부양가족1명 세액, 2명, 3명, ...최대7명]]
  // 부양가족 수에 따른 소득세 구간 (2026년 간이세액표 근사)
  // 과세 월급여 구간별로 부양가족 1~7명 세액(원)을 근사 하드코딩
  var TAX_TABLE = [
    // [과세월급여 이하, [1명, 2명, 3명, 4명, 5명, 6명, 7명]]
    [1060000,  [0,       0,      0,     0,     0,     0,     0]],
    [1500000,  [13520,   3390,   0,     0,     0,     0,     0]],
    [1800000,  [30800,   18540,  6280,  0,     0,     0,     0]],
    [2100000,  [51110,   38840,  26580, 14310, 2050,  0,     0]],
    [2400000,  [73690,   61420,  49160, 36890, 24630, 12360, 100]],
    [2700000,  [98760,   86490,  74230, 61960, 49700, 37430, 25170]],
    [3000000,  [126380,  114110, 101840,89570, 77310, 65040, 52780]],
    [3500000,  [167100,  154830, 142570,130300,118040,105770,93510]],
    [4000000,  [216090,  203820, 191560,179290,167030,154760,142500]],
    [4500000,  [277690,  263210, 250950,238680,226420,214150,201890]],
    [5000000,  [360500,  343120, 330860,318590,306330,294060,281800]],
    [5500000,  [463100,  445720, 433460,421190,408930,396660,384400]],
    [6000000,  [574950,  557570, 545310,533040,520780,508510,496250]],
    [7000000,  [740000,  722620, 710360,698090,685830,673560,661300]],
    [8000000,  [930000,  912620, 900360,888090,875830,863560,851300]],
    [10000000, [1240000, 1222620,1210360,1198090,1185830,1173560,1161300]],
    [Infinity, [1550000, 1532620,1520360,1508090,1495830,1483560,1471300]]
  ];

  function getIncomeTax(taxableMonthly, dependants) {
    var dep = Math.max(1, Math.min(dependants, 7));
    var idx = dep - 1;
    for (var i = 0; i < TAX_TABLE.length; i++) {
      if (taxableMonthly <= TAX_TABLE[i][0]) {
        return TAX_TABLE[i][1][idx] || 0;
      }
    }
    return TAX_TABLE[TAX_TABLE.length - 1][1][idx] || 0;
  }

  function calcSalary(annualWan, nonTaxableMonth, dependants) {
    // annualWan: 만원 단위 연봉, nonTaxableMonth: 비과세액(원/월), dependants: 부양가족수(본인포함)
    var annualWon = annualWan * 10000;
    var grossMonthly = annualWon / 12;

    // 비과세 클리핑
    var nonTax = Math.min(nonTaxableMonth, grossMonthly);
    var taxableMonthly = grossMonthly - nonTax;

    // 국민연금: 과세월급여 × 4.5%, 상한 590만원 적용
    var pensionBase = Math.min(taxableMonthly, RATES.pension_cap);
    var pension = Math.floor(pensionBase * RATES.pension);

    // 건강보험: 과세월급여 × 3.545%
    var health = Math.floor(taxableMonthly * RATES.health);

    // 장기요양: 건강보험료 × 9.182%
    var ltc = Math.floor(health * RATES.ltc_ratio);

    // 고용보험: 과세월급여 × 0.9%
    var employ = Math.floor(taxableMonthly * RATES.employment);

    // 소득세 (간이세액표 근사)
    var incomeTax = getIncomeTax(taxableMonthly, dependants);

    // 지방소득세 = 소득세 × 10%
    var localTax = Math.floor(incomeTax * 0.1);

    var totalDeduction = pension + health + ltc + employ + incomeTax + localTax;
    var netMonthly = Math.floor(grossMonthly - totalDeduction);
    var netAnnual = netMonthly * 12;

    return {
      grossMonthly: Math.floor(grossMonthly),
      taxableMonthly: Math.floor(taxableMonthly),
      nonTaxClipped: nonTax < nonTaxableMonth,
      pension: pension,
      health: health,
      ltc: ltc,
      employ: employ,
      incomeTax: incomeTax,
      localTax: localTax,
      totalDeduction: totalDeduction,
      netMonthly: netMonthly,
      netAnnual: netAnnual
    };
  }

  function fmt(n) {
    return n.toLocaleString("ko-KR") + "원";
  }

  function showError(msg) {
    var errEl = document.getElementById("result-error");
    var resEl = document.getElementById("result");
    if (resEl) resEl.hidden = true;
    if (errEl) {
      errEl.textContent = msg;
      errEl.hidden = false;
    }
  }

  function hideError() {
    var errEl = document.getElementById("result-error");
    if (errEl) errEl.hidden = true;
  }

  function showResult(data) {
    var resEl = document.getElementById("result");
    if (!resEl) return;
    document.getElementById("res-monthly").textContent = fmt(data.netMonthly);
    document.getElementById("res-annual").textContent = fmt(data.netAnnual);
    document.getElementById("d-pension").textContent = fmt(data.pension);
    document.getElementById("d-health").textContent = fmt(data.health + data.ltc);
    document.getElementById("d-employ").textContent = fmt(data.employ);
    document.getElementById("d-income").textContent = fmt(data.incomeTax);
    document.getElementById("d-local").textContent = fmt(data.localTax);
    document.getElementById("d-total").textContent = fmt(data.totalDeduction);
    resEl.hidden = false;
  }

  function onCalc() {
    var salaryInput = document.getElementById("annual-salary");
    var nonTaxInput = document.getElementById("non-taxable");
    var depInput = document.getElementById("dependants");

    var salaryVal = salaryInput ? salaryInput.value.trim() : "";
    var nonTaxVal = nonTaxInput ? parseFloat(nonTaxInput.value) || 0 : 0;
    var depVal = depInput ? parseInt(depInput.value, 10) || 1 : 1;

    // 빈 입력 / 0 체크
    if (!salaryVal || salaryVal === "0" || parseFloat(salaryVal) <= 0) {
      showError("연봉을 입력하세요. (예: 4000 → 4,000만원)");
      return;
    }

    var annualWan = parseFloat(salaryVal);

    // 극단값 체크: 50억 = 50만 만원
    if (annualWan > 500000) {
      showError("지원 범위를 초과했습니다. 연봉은 50억원(50만 만원) 이하로 입력해 주세요.");
      return;
    }

    // 음수 체크
    if (annualWan < 0) {
      showError("연봉은 0보다 큰 값을 입력하세요.");
      return;
    }

    // 부양가족 최소 1 강제
    if (depVal < 1) depVal = 1;

    // 비과세 0 미만 방어
    if (nonTaxVal < 0) nonTaxVal = 0;

    hideError();
    var result = calcSalary(annualWan, nonTaxVal, depVal);

    // 비과세 클리핑 경고
    if (result.nonTaxClipped) {
      var errEl = document.getElementById("result-error");
      if (errEl) {
        errEl.textContent = "비과세액이 월급여를 초과해 월급여 한도로 자동 조정되었습니다.";
        errEl.hidden = false;
      }
    }

    showResult(result);

    // 상태 저장 (localStorage)
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        annualWan: annualWan,
        nonTaxable: nonTaxVal,
        dependants: depVal
      }));
    } catch (e) { /* private mode */ }
  }

  // 저장된 상태 복원
  (function restoreState() {
    try {
      var saved = localStorage.getItem(LS_KEY);
      if (!saved) return;
      var parsed = JSON.parse(saved);
      var salaryInput = document.getElementById("annual-salary");
      var nonTaxInput = document.getElementById("non-taxable");
      var depInput = document.getElementById("dependants");
      if (salaryInput && parsed.annualWan) salaryInput.value = parsed.annualWan;
      if (nonTaxInput && parsed.nonTaxable != null) nonTaxInput.value = parsed.nonTaxable;
      if (depInput && parsed.dependants) depInput.value = parsed.dependants;
    } catch (e) { /* noop */ }
  })();

  // 이벤트 바인딩
  var calcBtn = document.getElementById("calc-btn");
  if (calcBtn) calcBtn.addEventListener("click", onCalc);

  // Enter 키로 계산
  ["annual-salary", "non-taxable", "dependants"].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("keydown", function(e) {
      if (e.key === "Enter") onCalc();
    });
  });
  // TOOLJS:END
})();
