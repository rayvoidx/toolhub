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
  var unitEl = $("unit"), coatsEl = $("coats");
  var lenEl = $("room-length"), widEl = $("room-width"), hgtEl = $("wall-height");
  var doorsEl = $("doors"), winsEl = $("windows"), ceilEl = $("ceiling"), covEl = $("coverage");
  var result = $("result"), errEl = $("err");
  if (!unitEl || !lenEl || !widEl || !hgtEl) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var SQFT_PER_M2 = 10.76391, L_PER_GAL = 3.785412;
  var COVER = 350;              // 1갤런 1회 도장 — 이미 도장된 매끈한 면 기준(라벨의 400은 이상 조건)
  var COVER_MIN = 150, COVER_MAX = 600;
  var DOOR = 21, WINDOW = 15;   // 표준 개구부 면적 ft² (문 3×7, 창 3×5)
  var MAX_DIM = { ft: 330, m: 100 };

  function num(el) { return parseFloat(String(el.value).replace(/,/g, "")); }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  // 페인트는 쿼트 단위로 팔린다 — 소요량을 쿼트로 올림한 뒤 갤런+쿼트로 쪼갠다.
  function buyText(gal, metric) {
    if (metric) return Math.max(1, Math.ceil(gal * L_PER_GAL)) + " " + t("tool.u.l");
    var q = Math.max(1, Math.ceil(gal * 4));
    var g = Math.floor(q / 4), r = q % 4, parts = [];
    if (g) parts.push(g + " " + t("tool.u.gal"));
    if (r) parts.push(r + " " + t("tool.u.qt"));
    return parts.join(" + ");
  }

  function calc() {
    var l = num(lenEl), w = num(widEl), h = num(hgtEl);
    if (!isFinite(l) || !isFinite(w) || !isFinite(h)) return fail("tool.err.empty");
    if (l <= 0 || w <= 0 || h <= 0) return fail("tool.err.dim");

    var metric = unitEl.value === "m";
    var max = metric ? MAX_DIM.m : MAX_DIM.ft;
    if (l > max || w > max || h > max) return fail("tool.err.range");

    var doors = String(doorsEl.value).trim() === "" ? 0 : num(doorsEl);
    var wins = String(winsEl.value).trim() === "" ? 0 : num(winsEl);
    if (!isFinite(doors) || !isFinite(wins)) return fail("tool.err.count");
    if (doors < 0 || wins < 0) return fail("tool.err.count");
    doors = Math.round(doors); wins = Math.round(wins);

    // 커버리지 직접 입력(ft²/gal) — 비우면 기본 350. 캔 라벨 값이 다르면 여기서 덮어쓴다.
    var cover = COVER;
    if (covEl && String(covEl.value).trim() !== "") {
      cover = num(covEl);
      if (!isFinite(cover) || cover < COVER_MIN || cover > COVER_MAX) return fail("tool.err.coverage");
    }

    // 커버리지·개구부 상수가 전부 ft² 기준이라 내부 계산은 ft² 하나로 통일한다.
    var k = metric ? SQFT_PER_M2 : 1;
    var wall = 2 * (l + w) * h * k;
    var openings = doors * DOOR + wins * WINDOW;
    if (openings >= wall) return fail("tool.err.openings");

    var area = wall - openings + (ceilEl && ceilEl.checked ? l * w * k : 0);
    var coats = parseInt(coatsEl.value, 10) || 1;
    var total = area * coats;
    var gal = total / cover;
    var areaUnit = metric ? t("tool.u.sqm") : t("tool.u.sqft");

    $("r-gallons").textContent = gal.toFixed(1) + " " + t("tool.u.gal");
    $("r-buy").textContent = buyText(gal, metric);
    $("r-liters").textContent = (gal * L_PER_GAL).toFixed(1) + " " + t("tool.u.l");
    $("r-area").textContent = Math.round(area / k) + " " + areaUnit;
    $("r-total").textContent = Math.round(total / k) + " " + areaUnit;

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [lenEl, widEl, hgtEl, doorsEl, winsEl, covEl].forEach(function (el) {
    if (el) el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [unitEl, coatsEl, ceilEl].forEach(function (el) {
    if (el) el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
