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
  var SLUG = cfg.slug || "password-gen";

  var CHARSETS = {
    upper:  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    lower:  "abcdefghijklmnopqrstuvwxyz",
    digit:  "0123456789",
    symbol: "!@#$%^&*"
  };

  // DOM refs
  var sliderEl   = document.getElementById("pw-length");
  var lengthVal  = document.getElementById("pw-length-val");
  var optUpper   = document.getElementById("opt-upper");
  var optLower   = document.getElementById("opt-lower");
  var optDigit   = document.getElementById("opt-digit");
  var optSymbol  = document.getElementById("opt-symbol");
  var btnGen     = document.getElementById("btn-generate");
  var btnCopy    = document.getElementById("btn-copy");
  var resultEl   = document.getElementById("pw-result");
  var strengthWrap  = document.getElementById("pw-strength-wrap");
  var strengthBar   = document.getElementById("pw-strength-bar");
  var strengthLabel = document.getElementById("pw-strength-label");
  var toastEl    = document.getElementById("pw-toast");

  // Restore length from localStorage
  (function restorePrefs() {
    try {
      var savedLen = localStorage.getItem(SLUG + ":length");
      if (savedLen) {
        var n = Math.min(64, Math.max(8, parseInt(savedLen, 10)));
        sliderEl.value = n;
        lengthVal.textContent = String(n);
      }
      var savedUpper  = localStorage.getItem(SLUG + ":upper");
      var savedLower  = localStorage.getItem(SLUG + ":lower");
      var savedDigit  = localStorage.getItem(SLUG + ":digit");
      var savedSymbol = localStorage.getItem(SLUG + ":symbol");
      if (savedUpper  !== null) optUpper.checked  = savedUpper  === "1";
      if (savedLower  !== null) optLower.checked  = savedLower  === "1";
      if (savedDigit  !== null) optDigit.checked  = savedDigit  === "1";
      if (savedSymbol !== null) optSymbol.checked = savedSymbol === "1";
    } catch (e) { /* private mode — noop */ }
  })();

  // Cryptographically secure random integer in [0, max)
  function secureRandInt(max) {
    var arr = new Uint32Array(1);
    var limit = Math.floor(0xFFFFFFFF / max) * max;
    do {
      crypto.getRandomValues(arr);
    } while (arr[0] >= limit);
    return arr[0] % max;
  }

  // Build character pool from checked options
  function buildPool() {
    var pool = "";
    if (optUpper.checked)  pool += CHARSETS.upper;
    if (optLower.checked)  pool += CHARSETS.lower;
    if (optDigit.checked)  pool += CHARSETS.digit;
    if (optSymbol.checked) pool += CHARSETS.symbol;
    return pool;
  }

  // Strength rating: weak / medium / strong
  function rateStrength(length, poolSize) {
    var entropy = length * Math.log2(poolSize || 1);
    if (entropy < 40)  return { level: "weak",   label: "약함 (Weak)",   pct: 33,  color: "#ef4444" };
    if (entropy < 80)  return { level: "medium", label: "보통 (Medium)", pct: 66,  color: "#f59e0b" };
    return              { level: "strong", label: "강함 (Strong)", pct: 100, color: "#22c55e" };
  }

  function showToast(msg, durationMs) {
    toastEl.textContent = msg;
    toastEl.style.display = "block";
    clearTimeout(toastEl._tid);
    toastEl._tid = setTimeout(function () {
      toastEl.style.display = "none";
    }, durationMs || 2000);
  }

  function generate() {
    var len = Math.min(64, Math.max(8, parseInt(sliderEl.value, 10)));
    sliderEl.value = len;
    lengthVal.textContent = String(len);

    // Ensure at least one charset is active
    var anyChecked = optUpper.checked || optLower.checked || optDigit.checked || optSymbol.checked;
    if (!anyChecked) {
      optLower.checked = true;
      showToast("최소 한 가지 문자 유형이 필요해 소문자를 자동으로 활성화했습니다.");
    }

    var pool = buildPool();
    if (pool.length === 0) {
      resultEl.textContent = "문자 유형을 하나 이상 선택하세요.";
      btnCopy.disabled = true;
      return;
    }

    var pwd = "";
    for (var i = 0; i < len; i++) {
      pwd += pool[secureRandInt(pool.length)];
    }

    resultEl.textContent = pwd;
    btnCopy.disabled = false;

    // Strength bar
    var rating = rateStrength(len, pool.length);
    strengthWrap.hidden = false;
    strengthBar.style.width  = rating.pct + "%";
    strengthBar.style.background = rating.color;
    strengthLabel.textContent = "강도: " + rating.label;

    // Persist preferences
    try {
      localStorage.setItem(SLUG + ":length", String(len));
      localStorage.setItem(SLUG + ":upper",  optUpper.checked  ? "1" : "0");
      localStorage.setItem(SLUG + ":lower",  optLower.checked  ? "1" : "0");
      localStorage.setItem(SLUG + ":digit",  optDigit.checked  ? "1" : "0");
      localStorage.setItem(SLUG + ":symbol", optSymbol.checked ? "1" : "0");
    } catch (e) { /* noop */ }
  }

  function copyToClipboard() {
    var text = resultEl.textContent;
    if (!text || btnCopy.disabled) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        btnCopy.textContent = "복사됨!";
        setTimeout(function () { btnCopy.textContent = "복사"; }, 1500);
      }).catch(function () {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity  = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      btnCopy.textContent = "복사됨!";
      setTimeout(function () { btnCopy.textContent = "복사"; }, 1500);
    } catch (e) {
      showToast("클립보드 접근이 거부되었습니다. 비밀번호를 직접 선택해 복사하세요.");
    }
  }

  // Slider live update
  sliderEl.addEventListener("input", function () {
    var n = Math.min(64, Math.max(8, parseInt(sliderEl.value, 10)));
    sliderEl.value = n;
    lengthVal.textContent = String(n);
  });

  btnGen.addEventListener("click", generate);
  btnCopy.addEventListener("click", copyToClipboard);

  // Auto-generate on load
  generate();
  // TOOLJS:END
})();
