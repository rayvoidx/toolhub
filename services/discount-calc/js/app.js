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
  var SLUG = cfg.slug || "discount-calc";
  var STORAGE_KEY = SLUG + ":last";

  /* ── 유틸 ── */
  function fmt(n) {
    return n.toLocaleString("ko-KR");
  }

  function showResult(el, html, isError) {
    el.innerHTML = html;
    el.hidden = false;
    el.className = "result" + (isError ? " result--error" : "");
  }

  function hideResult(el) {
    el.hidden = true;
    el.innerHTML = "";
  }

  /* ── 계산 로직 ── */
  function calcRate(original, sale) {
    /* 모드 A: 정가 + 할인가 → 할인율, 할인금액 */
    if (!original || isNaN(original) || original <= 0) {
      return { error: "정가를 올바르게 입력해 주세요." };
    }
    if (!sale || isNaN(sale) || sale < 0) {
      return { error: "할인가를 올바르게 입력해 주세요." };
    }
    if (sale > original) {
      return { error: "할인가가 정가보다 클 수 없습니다." };
    }
    var discountAmt = original - sale;
    var rate = Math.round((discountAmt / original) * 1000) / 10; /* 소수점 1자리 */
    return { rate: rate, discountAmt: Math.round(discountAmt) };
  }

  function calcPrice(original, rate) {
    /* 모드 B: 정가 + 할인율 → 최종가, 할인금액 */
    if (!original || isNaN(original) || original <= 0) {
      return { error: "정가를 올바르게 입력해 주세요." };
    }
    if (rate === "" || isNaN(rate) || rate < 0) {
      return { error: "할인율을 올바르게 입력해 주세요." };
    }
    if (rate > 100) {
      return { error: "할인율은 0~100% 사이여야 합니다." };
    }
    var discountAmt = original * (rate / 100);
    var finalPrice = original - discountAmt;
    return { finalPrice: Math.round(finalPrice), discountAmt: Math.round(discountAmt) };
  }

  /* ── DOM 참조 ── */
  var tabA = document.getElementById("tab-a");
  var tabB = document.getElementById("tab-b");
  var modeA = document.getElementById("mode-a");
  var modeB = document.getElementById("mode-b");

  var aOriginal = document.getElementById("a-original");
  var aSale = document.getElementById("a-sale");
  var aCalcBtn = document.getElementById("a-calc");
  var aResult = document.getElementById("a-result");

  var bOriginal = document.getElementById("b-original");
  var bRate = document.getElementById("b-rate");
  var bCalcBtn = document.getElementById("b-calc");
  var bResult = document.getElementById("b-result");

  /* ── 상태 복원 ── */
  var savedState = null;
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { savedState = JSON.parse(raw); }
  } catch (e) { /* private mode / parse error */ }

  function restoreState(state) {
    if (!state) { return; }
    if (state.mode === "b") {
      switchTab("b");
    }
    if (state.aOriginal) { aOriginal.value = state.aOriginal; }
    if (state.aSale) { aSale.value = state.aSale; }
    if (state.bOriginal) { bOriginal.value = state.bOriginal; }
    if (state.bRate) { bRate.value = state.bRate; }
  }

  function saveState(mode) {
    try {
      var s = {
        mode: mode,
        aOriginal: aOriginal.value,
        aSale: aSale.value,
        bOriginal: bOriginal.value,
        bRate: bRate.value
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch (e) { /* noop */ }
  }

  /* ── 탭 전환 ── */
  function switchTab(target) {
    if (target === "a") {
      tabA.classList.add("active");
      tabA.setAttribute("aria-selected", "true");
      tabB.classList.remove("active");
      tabB.setAttribute("aria-selected", "false");
      modeA.hidden = false;
      modeB.hidden = true;
    } else {
      tabB.classList.add("active");
      tabB.setAttribute("aria-selected", "true");
      tabA.classList.remove("active");
      tabA.setAttribute("aria-selected", "false");
      modeB.hidden = false;
      modeA.hidden = true;
    }
    /* 탭 전환 시 입력값·결과 초기화 (복원 이후 수동 전환에만) */
    if (!restoringFlag) {
      aOriginal.value = "";
      aSale.value = "";
      bOriginal.value = "";
      bRate.value = "";
      hideResult(aResult);
      hideResult(bResult);
    }
    saveState(target);
  }

  var restoringFlag = true;
  restoreState(savedState);
  restoringFlag = false;

  tabA.addEventListener("click", function () { switchTab("a"); });
  tabB.addEventListener("click", function () { switchTab("b"); });

  /* ── 모드 A 계산 ── */
  function runA() {
    var orig = parseFloat(aOriginal.value);
    var sale = parseFloat(aSale.value);
    var res = calcRate(orig, sale);
    if (res.error) {
      showResult(aResult,
        "<p class=\"result__error\">" + res.error + "</p>",
        true);
      return;
    }
    showResult(aResult,
      "<div class=\"result__cards\">" +
        "<div class=\"result__card\">" +
          "<span class=\"result__label\">할인율</span>" +
          "<span class=\"result__value\">" + res.rate + "%</span>" +
        "</div>" +
        "<div class=\"result__card\">" +
          "<span class=\"result__label\">할인금액</span>" +
          "<span class=\"result__value\">" + fmt(res.discountAmt) + "원</span>" +
        "</div>" +
      "</div>",
      false);
    saveState("a");
  }

  /* ── 모드 B 계산 ── */
  function runB() {
    var orig = parseFloat(bOriginal.value);
    var rate = parseFloat(bRate.value);
    var res = calcPrice(orig, rate);
    if (res.error) {
      showResult(bResult,
        "<p class=\"result__error\">" + res.error + "</p>",
        true);
      return;
    }
    showResult(bResult,
      "<div class=\"result__cards\">" +
        "<div class=\"result__card\">" +
          "<span class=\"result__label\">최종가</span>" +
          "<span class=\"result__value\">" + fmt(res.finalPrice) + "원</span>" +
        "</div>" +
        "<div class=\"result__card\">" +
          "<span class=\"result__label\">할인금액</span>" +
          "<span class=\"result__value\">" + fmt(res.discountAmt) + "원</span>" +
        "</div>" +
      "</div>",
      false);
    saveState("b");
  }

  aCalcBtn.addEventListener("click", runA);
  bCalcBtn.addEventListener("click", runB);

  /* Enter 키 지원 */
  [aOriginal, aSale].forEach(function (el) {
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { runA(); }
    });
  });
  [bOriginal, bRate].forEach(function (el) {
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { runB(); }
    });
  });
  // TOOLJS:END
})();
