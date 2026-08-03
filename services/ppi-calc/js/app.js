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
  var hres = $("hres"), vres = $("vres"), diag = $("diag");
  var result = $("result"), errEl = $("err"), unit = $("diag-unit");
  if (!hres || !vres || !diag) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { var v = parseFloat(String(el.value).replace(/,/g, "")); return isFinite(v) ? v : NaN; };
  function gcd(a, b) { a = Math.round(a); b = Math.round(b); while (b) { var x = a % b; a = b; b = x; } return a || 1; }

  function densityKey(ppi) {
    if (ppi < 100) return "tool.d.low";
    if (ppi < 150) return "tool.d.std";
    if (ppi < 220) return "tool.d.high";
    return "tool.d.retina";
  }

  // 1 arcminute = 사람 눈의 대략적 분해 한계. 픽셀 하나가 1'보다 작아 보이기 시작하는 거리.
  // 라디안 환산: (1/60)deg = 0.00029089 rad → 거리(inch) = (1/ppi) / 0.00029089 ≈ 3437.75 / ppi
  var ARCMIN_INCH = 3437.75;

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var w = num(hres), h = num(vres), d = num(diag);
    if (unit && unit.value === "cm" && isFinite(d)) d = d / 2.54;
    if (isNaN(w) || isNaN(h) || isNaN(d)) return fail("tool.err.empty");
    if (w <= 0 || h <= 0 || d <= 0) return fail("tool.err.positive");
    if (w > 30000 || h > 30000) return fail("tool.err.res");
    if (d < 0.5 || d > 120) return fail("tool.err.diag");

    var ppi = Math.sqrt(w * w + h * h) / d;
    var pitch = 25.4 / ppi;
    var distIn = ARCMIN_INCH / ppi;

    var g = gcd(w, h), rw = Math.round(w) / g, rh = Math.round(h) / g;
    // 2556x1179 처럼 약분해도 큰 수가 남는 화면은 284:131 대신 2.17:1 이 더 읽힌다.
    var aspect = (rw > 50 || rh > 50) ? (w / h).toFixed(2) + ":1" : rw + ":" + rh;

    $("r-ppi").textContent = ppi.toFixed(1) + " PPI";
    $("r-pitch").textContent = pitch.toFixed(4) + " mm";
    $("r-mp").textContent = (w * h / 1e6).toFixed(2) + " MP";
    $("r-aspect").textContent = aspect;
    $("r-dist").textContent = distIn.toFixed(1) + " in / " + (distIn * 2.54).toFixed(0) + " cm";
    $("r-class").textContent = t(densityKey(ppi));

    var hyp = Math.sqrt(w * w + h * h);
    var wIn = d * w / hyp, hIn = d * h / hyp;
    $("r-size").textContent = wIn.toFixed(1) + " x " + hIn.toFixed(1) + " in / " +
      (wIn * 2.54).toFixed(1) + " x " + (hIn * 2.54).toFixed(1) + " cm";

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [hres, vres, diag].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });

  if (unit) {
    unit.addEventListener("change", function () {
      diag.max = unit.value === "cm" ? "305" : "120";
      var v = num(diag);
      if (isFinite(v) && v > 0) diag.value = String(Math.round((unit.value === "cm" ? v * 2.54 : v / 2.54) * 10) / 10);
      if (!result.hidden || !errEl.hidden) calc();
    });
  }

  var chips = $("screen-chips");
  if (chips) {
    chips.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".chip") : null;
      if (!b) return;
      if (unit) { unit.value = "in"; diag.max = "120"; }
      hres.value = b.getAttribute("data-w");
      vres.value = b.getAttribute("data-h");
      diag.value = b.getAttribute("data-d");
      calc();
    });
  }

  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
