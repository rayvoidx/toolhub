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
  var shape = $("shape"), unit = $("unit"), waste = $("waste");
  var result = $("result"), errEl = $("err");
  if (!shape || !unit || !waste) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (id) { var v = parseFloat(String($(id).value).replace(/,/g, "")); return isFinite(v) ? v : NaN; };
  // 입력 단위를 피트로 먼저 통일한다 — 곱한 뒤 환산하면 제곱 단위에서 144배 실수가 난다.
  var TO_FT = { ft: 1, in: 1 / 12, m: 3.280839895, cm: 0.03280839895 };
  var round = function (n) { return Math.round(n * 100) / 100; };

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var f = TO_FT[unit.value], s = shape.value, areaFt;

    if (s === "circle") {
      var d = num("dia");
      if (isNaN(d)) return fail("tool.err.empty");
      if (d <= 0) return fail("tool.err.positive");
      var r = d * f / 2;
      areaFt = Math.PI * r * r;
    } else {
      var len = num("len"), wid = num("wid");
      if (isNaN(len) || isNaN(wid)) return fail("tool.err.empty");
      if (len <= 0 || wid <= 0) return fail("tool.err.positive");
      areaFt = (len * f) * (wid * f);
      if (s === "lshape") {
        var len2 = num("len2"), wid2 = num("wid2");
        if (isNaN(len2) || isNaN(wid2)) return fail("tool.err.empty");
        if (len2 <= 0 || wid2 <= 0) return fail("tool.err.positive");
        areaFt += (len2 * f) * (wid2 * f);
      }
    }

    var pct = parseFloat(waste.value) || 0;
    $("r-area").textContent = round(areaFt) + " sq ft";
    $("r-sqm").textContent = round(areaFt * 0.09290304) + " m2";
    $("r-order").textContent = Math.ceil(areaFt * (1 + pct / 100)) + " sq ft";

    errEl.hidden = true;
    result.hidden = false;
  }

  function syncShape() {
    var s = shape.value;
    $("rect-fields").hidden = s === "circle";
    $("l-fields").hidden = s !== "lshape";
    $("circle-fields").hidden = s !== "circle";
    if (!result.hidden || !errEl.hidden) calc();
  }

  shape.addEventListener("change", syncShape);
  [unit, waste].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  ["len", "wid", "len2", "wid2", "dia"].forEach(function (id) {
    var el = $(id);
    if (el) el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  $("calc-btn").addEventListener("click", calc);
  document.addEventListener("i18n:change", function () { if (!errEl.hidden) calc(); });
  // TOOLJS:END
})();
