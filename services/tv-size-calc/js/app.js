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
  var mode = $("mode"), dist = $("dist"), distunit = $("distunit"), size = $("size"), content = $("content");
  var angle = $("angle"), angleField = $("angle-field");
  var distField = $("dist-field"), sizeField = $("size-field"), chips = $("chips");
  var result = $("result"), errEl = $("err");
  if (!mode || !dist || !size || !content) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 거리 ÷ 계수 = 대각선(인치). 계수는 THX/SMPTE 시야각 목표를 인치 경험칙으로 바꾼 값이다.
  var FACTOR = { cine: 1.2, mixed: 1.6, hd: 2.5 };
  var COMMON = [32, 40, 43, 50, 55, 65, 75, 85, 98];
  var W_RATIO = 16 / Math.sqrt(337);  // 16:9 화면 폭 ÷ 대각선 = 0.8716
  var H_RATIO = 9 / Math.sqrt(337);   // 16:9 화면 높이 ÷ 대각선 = 0.4903
  var ARCMIN = Math.PI / (180 * 60);  // 1분각 — 시력 1.0 의 해상 한계

  function angleDeg(diagIn, distIn) {
    return 2 * Math.atan((diagIn * W_RATIO / 2) / distIn) * 180 / Math.PI;
  }
  // 세로 픽셀 하나가 1분각까지 줄어드는 거리 = 그 해상도가 온전히 보이는 최대 거리
  function fullDetailDist(diagIn, lines) {
    return (diagIn * H_RATIO / lines) / Math.tan(ARCMIN);
  }
  function lenNum(inches) {
    return distunit.value === "m" ? (inches / 39.3701).toFixed(1) : (inches / 12).toFixed(1);
  }
  function lenUnit() { return distunit.value === "m" ? t("tool.u.m") : t("tool.u.ft"); }
  function sizeText(inches) {
    return Math.round(inches) + " " + t("tool.u.in") + " (" + Math.round(inches * 2.54) + " " + t("tool.u.cm") + ")";
  }
  function nearestTwo(diag) {
    var sorted = COMMON.slice().sort(function (a, b) { return Math.abs(a - diag) - Math.abs(b - diag); });
    return sorted.slice(0, 2).sort(function (a, b) { return a - b; });
  }
  function drawChips(picks) {
    while (chips.firstChild) chips.removeChild(chips.firstChild);
    COMMON.forEach(function (c) {
      var el = document.createElement("span");
      el.className = picks.indexOf(c) >= 0 ? "chip on" : "chip";
      el.textContent = c + '"';
      chips.appendChild(el);
    });
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function syncMode() {
    var isSize = mode.value === "size";
    distField.hidden = !isSize;
    sizeField.hidden = isSize;
    angleField.hidden = content.value !== "custom";
  }

  function calc() {
    var isSize = mode.value === "size";
    var f;
    if (content.value === "custom") {
      var a = parseFloat(String(angle.value).replace(/,/g, ""));
      if (!isFinite(a) || a < 10 || a > 60) return fail("tool.err.anglerange");
      // 시야각 → 거리계수: 폭/2 = 거리 * tan(각/2)
      f = W_RATIO / (2 * Math.tan(a * Math.PI / 360));
    } else {
      f = FACTOR[content.value] || 1.6;
    }
    var distIn, diag;

    if (isSize) {
      var d = parseFloat(String(dist.value).replace(/,/g, ""));
      if (!isFinite(d)) return fail("tool.err.dist");
      distIn = distunit.value === "m" ? d * 39.3701 : d * 12;
      if (distIn < 12 || distIn > 720) return fail("tool.err.distrange");
      diag = distIn / f;
    } else {
      var s = parseFloat(String(size.value).replace(/,/g, ""));
      if (!isFinite(s)) return fail("tool.err.size");
      if (s < 15 || s > 150) return fail("tool.err.sizerange");
      diag = s;
      distIn = diag * f;
    }

    var picks = nearestTwo(diag);
    // 시야각은 실제로 살 크기 기준이 유용하다 — 크기 모드에서는 가장 가까운 시판 크기로 계산.
    var shown = isSize ? picks[Math.abs(picks[0] - diag) <= Math.abs(picks[1] - diag) ? 0 : 1] : diag;

    var mainKey = isSize ? "tool.r.size" : "tool.r.dist";
    var label = $("r-main-label");
    label.setAttribute("data-i18n", mainKey);
    label.textContent = t(mainKey);
    $("r-main").textContent = isSize ? sizeText(diag) : lenNum(distIn) + " " + lenUnit();
    $("r-angle").textContent = Math.round(angleDeg(shown, distIn)) + "°";
    $("r-range").textContent = isSize
      ? Math.round(distIn / FACTOR.hd) + "–" + Math.round(distIn / FACTOR.cine) + " " + t("tool.u.in")
      : lenNum(diag * FACTOR.cine) + "–" + lenNum(diag * FACTOR.hd) + " " + lenUnit();
    $("r-closest").textContent = picks[0] + " / " + picks[1] + " " + t("tool.u.in");
    $("r-dims").textContent = (diag * W_RATIO).toFixed(1) + " x " + (diag * H_RATIO).toFixed(1) + " " + t("tool.u.in")
      + " (" + Math.round(diag * W_RATIO * 2.54) + " x " + Math.round(diag * H_RATIO * 2.54) + " " + t("tool.u.cm") + ")";

    var d4k = fullDetailDist(shown, 2160), d1080 = fullDetailDist(shown, 1080);
    $("r-4k").textContent = t(distIn <= d4k ? "tool.msg.4kfull" : distIn <= d1080 ? "tool.msg.4kpart" : "tool.msg.4knone");
    drawChips(picks);

    errEl.hidden = true;
    result.hidden = false;
  }

  syncMode();
  $("calc-btn").addEventListener("click", calc);
  [dist, size, angle].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  angle.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  mode.addEventListener("change", function () {
    syncMode();
    if (!result.hidden || !errEl.hidden) calc();
  });
  [distunit, content].forEach(function (el) {
    el.addEventListener("change", function () { syncMode(); if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
