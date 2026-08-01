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
  var unitEl = $("unit"), ovEl = $("overhang"), lenEl = $("length"), widEl = $("width");
  var pitchEl = $("pitch"), wasteEl = $("waste");
  var result = $("result"), errEl = $("err");
  if (!unitEl || !lenEl || !widEl || !pitchEl || !wasteEl) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var FT_PER_M = 3.280839895, SQFT_PER_M2 = 10.76391, KG_PER_LB = 0.453592;
  var SQFT_PER_SQUARE = 100;        // 1 roofing square = 100 ft²
  var BUNDLES_PER_SQUARE = 3;       // 아키텍처럴/3탭 슁글 표준 커버리지
  var UNDERLAY_SQ_PER_ROLL = 4;     // 합성 방수시트 1롤 ≈ 4스퀘어(겹침 포함)
  var RIDGE_FT_PER_BUNDLE = 33;     // 마루 캡 1번들 ≈ 33 linear ft
  var NAIL_LB_PER_SQUARE = 2.5;     // 1-1/4인치 지붕용 못
  var MAX_DIM = { ft: 500, m: 150 };

  function num(el) { return parseFloat(String(el.value).replace(/,/g, "")); }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var l = num(lenEl), w = num(widEl);
    if (!isFinite(l) || !isFinite(w)) return fail("tool.err.empty");
    if (l <= 0 || w <= 0) return fail("tool.err.dim");

    var metric = unitEl.value === "m";
    var max = metric ? MAX_DIM.m : MAX_DIM.ft;
    if (l > max || w > max) return fail("tool.err.range");

    var ov = ovEl && String(ovEl.value).trim() !== "" ? num(ovEl) : 0;
    if (!isFinite(ov) || ov < 0) return fail("tool.err.overhang");

    // 슁글 규격이 전부 야드파운드계(스퀘어=100ft²)라 내부 계산은 피트 하나로 통일한다.
    var lFt = metric ? l * FT_PER_M : l;
    var wFt = metric ? w * FT_PER_M : w;
    var ovFt = ov / 12;
    var pitch = parseFloat(pitchEl.value) || 1.054;
    var wastePct = parseFloat(wasteEl.value) || 10;

    // 박공(게이블) 가정: 처마 포함 평면적 × 경사 계수 = 실제 지붕면적.
    var areaFt2 = (lFt + 2 * ovFt) * (wFt + 2 * ovFt) * pitch;
    var squares = areaFt2 / SQFT_PER_SQUARE;

    var bundles = Math.ceil(squares * BUNDLES_PER_SQUARE * (1 + wastePct / 100));
    var rolls = Math.ceil(squares / UNDERLAY_SQ_PER_ROLL);
    var ridge = Math.ceil(lFt / RIDGE_FT_PER_BUNDLE);
    var nailsLb = Math.ceil(squares * NAIL_LB_PER_SQUARE);

    $("r-bundles").textContent = bundles + " " + t("tool.u.bundles");
    $("r-squares").textContent = (Math.round(squares * 10) / 10) + " " + t("tool.u.squares");
    $("r-area").textContent = metric
      ? Math.round(areaFt2 / SQFT_PER_M2) + " " + t("tool.u.sqm")
      : Math.round(areaFt2) + " " + t("tool.u.sqft");
    $("r-underlay").textContent = rolls + " " + t("tool.u.rolls");
    $("r-ridge").textContent = ridge + " " + t("tool.u.bundles");
    $("r-nails").textContent = metric
      ? (Math.round(nailsLb * KG_PER_LB * 10) / 10) + " " + t("tool.u.kg")
      : nailsLb + " " + t("tool.u.lb");

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [lenEl, widEl, ovEl].forEach(function (el) {
    if (el) el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [unitEl, pitchEl, wasteEl].forEach(function (el) {
    if (el) el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
