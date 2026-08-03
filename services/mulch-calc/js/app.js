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
  var unit = $("unit"), shape = $("shape"), depth = $("depth"), beds = $("beds");
  var len = $("len"), wid = $("wid"), dia = $("dia");
  var depthCustom = $("depth-custom"), depthCustomBox = $("depth-custom-field");
  var rectBox = $("rect-fields"), circleBox = $("circle-fields");
  var result = $("result"), errEl = $("err"), warnEl = $("warn-deep");
  if (!unit || !shape || !depth || !beds || !len || !wid || !dia || !depthCustom || !depthCustomBox) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var M2_TO_FT2 = 10.76391;   // 1 m² = 10.76391 ft²
  var CUFT_PER_YD3 = 27;

  function num(el) {
    var v = parseFloat(String(el.value).replace(/,/g, ""));
    return isFinite(v) ? v : NaN;
  }
  function fmt(v) {
    var r = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
    return r.toLocaleString();
  }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function syncShape() {
    var circle = shape.value === "circle";
    rectBox.hidden = circle;
    circleBox.hidden = !circle;
  }

  function calc() {
    var area; // 입력 단위의 제곱 — ft² 또는 m²
    if (shape.value === "circle") {
      var d = num(dia);
      if (isNaN(d)) return fail("tool.err.empty");
      if (d <= 0) return fail("tool.err.zero");
      area = Math.PI * d * d / 4;
    } else {
      var l = num(len), w = num(wid);
      if (isNaN(l) || isNaN(w)) return fail("tool.err.empty");
      if (l <= 0 || w <= 0) return fail("tool.err.zero");
      area = l * w;
    }

    // 화단 수는 비우면 1로 본다. 0·음수는 조용히 넘기지 않고 오류로 돌려준다.
    var rawBeds = String(beds.value).replace(/,/g, "").replace(/^\s+|\s+$/g, "");
    var n = rawBeds === "" ? 1 : parseFloat(rawBeds);
    if (!isFinite(n) || n <= 0) return fail("tool.err.zero");

    var totalFt2 = (unit.value === "m" ? area * M2_TO_FT2 : area) * n;
    if (totalFt2 > 5000000) return fail("tool.err.range");

    var inches;
    if (depth.value === "custom") {
      inches = num(depthCustom);
      if (isNaN(inches)) return fail("tool.err.empty");
      if (inches < 0.5 || inches > 12) return fail("tool.err.depth");
    } else {
      inches = parseFloat(depth.value);
    }
    var cuft = totalFt2 * (inches / 12);
    var yd3 = cuft / CUFT_PER_YD3;

    $("r-yards").textContent = (yd3 < 0.1 ? yd3.toFixed(2) : yd3.toFixed(1)) + " yd³";
    $("r-cuft").textContent = fmt(cuft) + " ft³";
    $("r-area").textContent = fmt(area * n) + (unit.value === "m" ? " m²" : " ft²");
    $("r-bags2").textContent = String(Math.ceil(cuft / 2));
    $("r-bags3").textContent = String(Math.ceil(cuft / 3));
    // 6인치 이상은 뿌리 질식 위험 — 결과와 함께 경고를 띄운다.
    warnEl.hidden = inches < 6;

    errEl.hidden = true;
    result.hidden = false;
  }

  function syncDepth() { depthCustomBox.hidden = depth.value !== "custom"; }

  syncShape();
  syncDepth();
  $("calc-btn").addEventListener("click", calc);
  [len, wid, dia, beds, depthCustom].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  shape.addEventListener("change", function () { syncShape(); if (!result.hidden || !errEl.hidden) calc(); });
  [unit, depth, depthCustom].forEach(function (el) {
    el.addEventListener("change", function () { syncDepth(); if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
