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

  // Cloudflare Web Analytics — 쿠키리스·페이지뷰만. 토큰 설정 시에만 로드.
  // 실패해도 본 기능에 영향 없게 격리 (safeTrack 원칙 — 부가 기능은 본 기능과 격리, 철칙 5)
  // 수집 범위는 privacy.html §3 과 일치해야 한다. 도구 입력값은 절대 실리지 않는다(§1 약속).
  if (cfg.analytics && cfg.analytics.cfBeaconToken) {
    try {
      var s = document.createElement("script");
      s.defer = true;
      s.src = "https://static.cloudflareinsights.com/beacon.min.js";
      s.setAttribute("data-cf-beacon", JSON.stringify({ token: cfg.analytics.cfBeaconToken }));
      document.head.appendChild(s);
    } catch (e) { /* 분석 실패는 조용히 무시 — 본 기능에 영향 없음 */ }
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
  var $ = function (id) { return document.getElementById(id); };
  var method = $("method"), solve = $("solve"), amount = $("amount"), custom = $("custom"), strength = $("strength");
  var result = $("result"), errEl = $("err"), amountLabel = $("amount-label"), mainLabel = $("r-main-label");
  if (!method || !solve || !amount || !custom || !strength) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var CUP_ML = 240;   // 미국 기준 한 잔
  var TBSP_G = 5.5;   // 분쇄 원두 큰술 — 로스팅/분쇄도에 따라 4.5~7g, 중앙값
  var MIN_RATIO = 1.5; // 에스프레소(1:2)에 strong(-2)을 걸어도 0 이하로 내려가지 않게 하한

  var num = function (el) { return parseFloat(String(el.value).replace(/,/g, "")); };

  function setLabel(el, key) {
    if (!el) return;
    el.setAttribute("data-i18n", key);
    el.textContent = t(key);
  }
  function syncLabels() {
    var toWater = solve.value === "water";
    setLabel(amountLabel, toWater ? "tool.amount.coffee" : "tool.amount.water");
    setLabel(mainLabel, toWater ? "tool.r.water" : "tool.r.coffee");
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var raw = num(amount);
    if (!isFinite(raw)) return fail("tool.err.empty");
    if (raw <= 0 || raw >= 20000) return fail("tool.err.range");

    // 직접 비율은 비어 있으면 추출 방식 값을 쓰고, 값이 들어왔는데 범위를 벗어나면 조용히 넘기지 않는다.
    var base = parseFloat(method.value);
    if (String(custom.value).trim() !== "") {
      var c = num(custom);
      if (!isFinite(c) || c < 1 || c > 30) return fail("tool.err.ratio");
      base = c;
    }
    var ratio = Math.max(MIN_RATIO, base + parseFloat(strength.value));

    var toWater = solve.value === "water";
    var coffee = toWater ? raw : raw / ratio;
    var water = toWater ? raw * ratio : raw;

    $("r-main").textContent = (toWater ? water : coffee).toFixed(1) + " g";
    $("r-ratio").textContent = "1:" + ratio.toFixed(1).replace(/\.0$/, "");
    $("r-cups").textContent = (water / CUP_ML).toFixed(1);
    $("r-tbsp").textContent = (coffee / TBSP_G).toFixed(1);

    errEl.hidden = true;
    result.hidden = false;
  }

  var live = function () { return !result.hidden || !errEl.hidden; };

  $("calc-btn").addEventListener("click", calc);
  [amount, custom].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [method, solve, strength, custom].forEach(function (el) {
    el.addEventListener("change", function () { syncLabels(); if (live()) calc(); });
  });
  document.addEventListener("i18n:change", function () { syncLabels(); if (live()) calc(); });
  syncLabels();
  // TOOLJS:END
})();
