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

  /* ── 유틸 ── */
  function fmt(n) {
    return n.toFixed(2);
  }

  function showResult(el, html, type) {
    // type: 'value' | 'increase' | 'decrease' | 'error' | 'neutral'
    el.innerHTML = html;
    el.className = "result result--" + (type || "value");
    el.hidden = false;

    var hintEl = document.getElementById("copy-hint");
    if (hintEl && type !== "error") hintEl.hidden = false;
  }

  function showError(el, msg) {
    el.innerHTML = msg;
    el.className = "result result--error";
    el.hidden = false;

    var hintEl = document.getElementById("copy-hint");
    if (hintEl) hintEl.hidden = true;
  }

  /* 결과 클릭 시 클립보드 복사 */
  function attachCopy(el) {
    el.style.cursor = "pointer";
    el.addEventListener("click", function () {
      var text = el.textContent || el.innerText;
      if (!text || el.className.indexOf("result--error") !== -1) return;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text.trim()).then(function () {
          var orig = el.innerHTML;
          el.innerHTML = "복사됨 ✓";
          setTimeout(function () { el.innerHTML = orig; }, 1000);
        }).catch(function () { /* 복사 실패 무시 */ });
      }
    });
  }

  /* ── 탭 전환 ── */
  var tabBtns = document.querySelectorAll(".tab-btn");
  var tabPanels = document.querySelectorAll(".tab-panel");

  function switchTab(targetId) {
    tabBtns.forEach(function (btn) {
      var active = btn.getAttribute("data-tab") === targetId;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    tabPanels.forEach(function (panel) {
      panel.hidden = panel.id !== "tab-" + targetId;
    });
    var hintEl = document.getElementById("copy-hint");
    if (hintEl) hintEl.hidden = true;
  }

  tabBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      switchTab(btn.getAttribute("data-tab"));
    });
  });

  /* ── 탭 1: A는 B의 몇 %인가 ── */
  var ratioA = document.getElementById("ratio-a");
  var ratioB = document.getElementById("ratio-b");
  var ratioResult = document.getElementById("ratio-result");
  var ratioCalcBtn = document.getElementById("ratio-calc-btn");

  if (ratioResult) attachCopy(ratioResult);

  function calcRatio() {
    var a = ratioA ? ratioA.value.trim() : "";
    var b = ratioB ? ratioB.value.trim() : "";
    if (a === "" || b === "") {
      showError(ratioResult, "A와 B를 모두 입력해 주세요.");
      return;
    }
    var numA = parseFloat(a);
    var numB = parseFloat(b);
    if (isNaN(numA) || isNaN(numB)) {
      showError(ratioResult, "숫자만 입력해 주세요.");
      return;
    }
    if (numB === 0) {
      showError(ratioResult, "분모(B)는 0이 될 수 없습니다.");
      return;
    }
    var result = (numA / numB) * 100;
    showResult(ratioResult, fmt(result) + " %", "value");
  }

  if (ratioCalcBtn) ratioCalcBtn.addEventListener("click", calcRatio);
  if (ratioA) ratioA.addEventListener("input", calcRatio);
  if (ratioB) ratioB.addEventListener("input", calcRatio);

  /* ── 탭 2: A에서 X% 오르면/내리면 얼마인가 ── */
  var changeA = document.getElementById("change-a");
  var changeX = document.getElementById("change-x");
  var changeResult = document.getElementById("change-result");
  var changeCalcBtn = document.getElementById("change-calc-btn");
  var changeModeIncrease = document.getElementById("change-increase");
  var changeModeDecrease = document.getElementById("change-decrease");
  var currentChangeMode = "increase";

  if (changeResult) attachCopy(changeResult);

  function setChangeMode(mode) {
    currentChangeMode = mode;
    if (changeModeIncrease) changeModeIncrease.classList.toggle("active", mode === "increase");
    if (changeModeDecrease) changeModeDecrease.classList.toggle("active", mode === "decrease");
    calcChange();
  }

  if (changeModeIncrease) changeModeIncrease.addEventListener("click", function () { setChangeMode("increase"); });
  if (changeModeDecrease) changeModeDecrease.addEventListener("click", function () { setChangeMode("decrease"); });

  function calcChange() {
    var a = changeA ? changeA.value.trim() : "";
    var x = changeX ? changeX.value.trim() : "";
    if (a === "" || x === "") {
      showError(changeResult, "기준값 A와 퍼센트 X를 모두 입력해 주세요.");
      return;
    }
    var numA = parseFloat(a);
    var numX = parseFloat(x);
    if (isNaN(numA) || isNaN(numX)) {
      showError(changeResult, "숫자만 입력해 주세요.");
      return;
    }
    if (numX < 0) {
      showError(changeResult, "퍼센트(X)에 음수를 입력하셨습니다. 양수를 입력하고 감소 모드를 선택하세요.");
      return;
    }
    var delta, result, sign;
    if (currentChangeMode === "increase") {
      result = numA * (1 + numX / 100);
      delta = result - numA;
      sign = "+";
    } else {
      result = numA * (1 - numX / 100);
      delta = result - numA;
      sign = delta >= 0 ? "+" : "−";
    }

    var warningHtml = "";
    if (currentChangeMode === "decrease" && numX > 100) {
      warningHtml = "<small style='display:block;margin-top:4px;color:var(--color-warning, #d97706)'>감소율이 100% 초과 — 결과가 음수일 수 있습니다.</small>";
    }

    var displayDelta = Math.abs(delta);
    var dispSign = currentChangeMode === "increase" ? "+" : "−";
    showResult(
      changeResult,
      fmt(result) + " <small>(" + dispSign + fmt(displayDelta) + ")</small>" + warningHtml,
      currentChangeMode === "increase" ? "increase" : "decrease"
    );
  }

  if (changeCalcBtn) changeCalcBtn.addEventListener("click", calcChange);
  if (changeA) changeA.addEventListener("input", calcChange);
  if (changeX) changeX.addEventListener("input", calcChange);

  /* ── 탭 3: A에서 B로 변하면 증감률은? ── */
  var rateA = document.getElementById("rate-a");
  var rateB = document.getElementById("rate-b");
  var rateResult = document.getElementById("rate-result");
  var rateCalcBtn = document.getElementById("rate-calc-btn");

  if (rateResult) attachCopy(rateResult);

  function calcRate() {
    var a = rateA ? rateA.value.trim() : "";
    var b = rateB ? rateB.value.trim() : "";
    if (a === "" || b === "") {
      showError(rateResult, "이전값 A와 이후값 B를 모두 입력해 주세요.");
      return;
    }
    var numA = parseFloat(a);
    var numB = parseFloat(b);
    if (isNaN(numA) || isNaN(numB)) {
      showError(rateResult, "숫자만 입력해 주세요.");
      return;
    }
    if (numA === 0) {
      showError(rateResult, "기준값(A)은 0이 될 수 없습니다.");
      return;
    }
    if (numA === numB) {
      showResult(rateResult, "0.00 % <small>(변동 없음)</small>", "neutral");
      return;
    }
    var rate = ((numB - numA) / numA) * 100;
    var sign = rate >= 0 ? "+" : "−";
    var displayRate = Math.abs(rate);
    showResult(
      rateResult,
      sign + fmt(displayRate) + " %",
      rate > 0 ? "increase" : "decrease"
    );
  }

  if (rateCalcBtn) rateCalcBtn.addEventListener("click", calcRate);
  if (rateA) rateA.addEventListener("input", calcRate);
  if (rateB) rateB.addEventListener("input", calcRate);
  // TOOLJS:END
})();
