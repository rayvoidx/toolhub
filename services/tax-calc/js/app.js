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
  var SLUG_KEY = (cfg.slug || "tax-calc") + ":last";
  var MAX_AMOUNT = 9000000000000; // 9조

  var amountInput = document.getElementById("amount-input");
  var amountLabel = document.getElementById("amount-label");
  var calcBtn     = document.getElementById("calc-btn");
  var resetBtn    = document.getElementById("reset-btn");
  var resultBox   = document.getElementById("result-box");
  var resultError = document.getElementById("result-error");
  var resultRows  = document.getElementById("result-rows");
  var rSupply     = document.getElementById("r-supply");
  var rVat        = document.getElementById("r-vat");
  var rTotal      = document.getElementById("r-total");
  var roundNote   = document.getElementById("round-note");
  var dirForward  = document.getElementById("dir-forward");
  var dirReverse  = document.getElementById("dir-reverse");

  // 세 자리 콤마 포맷
  function fmtNum(n) {
    return Math.round(n).toLocaleString("ko-KR") + "원";
  }

  // 입력 중 콤마 자동 삽입 (숫자만 남기고 재포맷)
  function formatInput(str) {
    var digits = str.replace(/[^0-9]/g, "");
    if (!digits) return "";
    return Number(digits).toLocaleString("ko-KR");
  }

  // 방향 라디오에 따라 레이블 변경
  function updateLabel() {
    var isForward = dirForward.checked;
    amountLabel.textContent = isForward ? "공급가 (원)" : "공급대가 (원)";
    amountInput.placeholder = isForward ? "예: 1,000,000" : "예: 1,100,000";
  }

  dirForward.addEventListener("change", function() { updateLabel(); hideResult(); });
  dirReverse.addEventListener("change", function() { updateLabel(); hideResult(); });

  // 실시간 콤마 포맷
  amountInput.addEventListener("input", function() {
    // 음수 부호 감지: formatInput() 이 부호를 제거하기 전에 원본 값을 검사
    if (amountInput.value.indexOf("-") !== -1) {
      amountInput.value = "";
      showError("0 이상의 금액을 입력해 주세요.");
      return;
    }
    var cursor = amountInput.selectionStart;
    var oldLen = amountInput.value.length;
    var formatted = formatInput(amountInput.value);
    amountInput.value = formatted;
    // 커서 보정
    var newLen = amountInput.value.length;
    amountInput.selectionStart = amountInput.selectionEnd = cursor + (newLen - oldLen);
  });

  // Enter 키로 계산
  amountInput.addEventListener("keydown", function(e) {
    if (e.key === "Enter") { e.preventDefault(); calculate(); }
  });

  function hideResult() {
    resultBox.hidden = true;
    resultError.hidden = true;
    resultRows.hidden = true;
  }

  function showError(msg) {
    resultBox.hidden = false;
    resultError.hidden = false;
    resultError.textContent = msg;
    resultRows.hidden = true;
  }

  function showRows(supply, vat, total, hasRound) {
    resultBox.hidden = false;
    resultError.hidden = true;
    resultRows.hidden = false;
    rSupply.textContent = fmtNum(supply);
    rVat.textContent    = fmtNum(vat);
    rTotal.textContent  = fmtNum(total);
    roundNote.hidden = !hasRound;
  }

  function calculate() {
    var raw = amountInput.value.replace(/[^0-9.]/g, "");

    // 빈 입력 또는 0
    if (!raw || Number(raw) === 0) {
      showError("금액을 입력해 주세요.");
      return;
    }

    var val = parseFloat(raw);

    // 최대값 초과
    if (val > MAX_AMOUNT) {
      showError("입력 가능한 최대 금액은 9,000,000,000,000원입니다.");
      return;
    }

    var supply, vat, total, hasRound;

    if (dirForward.checked) {
      // 공급가 → 부가세, 공급대가
      supply = val;
      // 원 단위 정수 공급가에서 부가세는 공급가 % 10 !== 0 일 때 소수 발생
      hasRound = (supply % 10 !== 0);
      vat    = Math.round(supply * 0.1);
      total  = supply + vat;
    } else {
      // 공급대가 → 공급가, 부가세
      total = val;
      // 공급대가 % 11 !== 0 이면 나누어 떨어지지 않아 반올림 발생
      hasRound = (total % 11 !== 0);
      supply = Math.round(total / 1.1);
      vat    = total - supply;
    }

    showRows(supply, vat, total, hasRound);

    // localStorage에 마지막 입력값 저장
    try {
      localStorage.setItem(SLUG_KEY, JSON.stringify({
        dir: dirForward.checked ? "forward" : "reverse",
        raw: raw
      }));
    } catch (e) { /* private mode — 조용히 무시 */ }
  }

  function reset() {
    amountInput.value = "";
    hideResult();
    amountInput.focus();
    try { localStorage.removeItem(SLUG_KEY); } catch (e) { /* noop */ }
  }

  calcBtn.addEventListener("click", function() { calculate(); });
  resetBtn.addEventListener("click", function() { reset(); });

  // 복사 버튼
  document.querySelectorAll(".copy-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var targetId = btn.getAttribute("data-target");
      var el = document.getElementById(targetId);
      if (!el) return;
      // 숫자만 복사 (원 단위, 콤마 포함)
      var text = el.textContent.replace(/원$/, "").replace(/,/g, "");
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function() {
          btn.textContent = "✓";
          setTimeout(function() { btn.textContent = "복사"; }, 1200);
        }).catch(function() {
          btn.textContent = "실패";
          setTimeout(function() { btn.textContent = "복사"; }, 1200);
        });
      }
    });
  });

  // 페이지 로드 시 localStorage 복원
  (function restore() {
    try {
      var saved = localStorage.getItem(SLUG_KEY);
      if (!saved) return;
      var data = JSON.parse(saved);
      if (data.dir === "reverse") {
        dirReverse.checked = true;
        dirForward.checked = false;
        updateLabel();
      }
      if (data.raw) {
        amountInput.value = formatInput(data.raw);
        calculate();
      }
    } catch (e) { /* 복원 실패 무시 */ }
  })();
  // TOOLJS:END
})();
