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
  var unit = $("unit"), mode = $("mode"), len = $("len"), wid = $("wid"), area = $("area");
  var targetr = $("targetr"), existing = $("existing"), material = $("material"), coverage = $("coverage");
  var rowDims = $("row-dims"), rowArea = $("row-area"), rowCov = $("row-cov");
  var result = $("result"), errEl = $("err");
  if (!unit || !mode || !targetr || !material) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 자재별 인치당 R값 — 제조사 카탈로그의 통상값.
  var PER_INCH = { batt: 3.2, blownfg: 2.5, cellulose: 3.5, foam: 6.5 };
  // 취입 포대 모델: 한 포대가 R-19 두께로 약 110 ft² 를 덮는다는 단순화. 라벨의 시공표가 최종 기준.
  var BAG_R_FT2 = 110 * 19;
  var SQFT_PER_M2 = 10.7639;

  function num(el) { return parseFloat(String(el.value).replace(/,/g, "")); }
  function grp(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  function sync() {
    var isM = unit.value === "m";
    $("u-len").textContent = isM ? "m" : "ft";
    $("u-wid").textContent = isM ? "m" : "ft";
    $("u-area").textContent = isM ? "m\u00B2" : "ft\u00B2";
    $("u-cov").textContent = isM ? "m\u00B2" : "ft\u00B2";
    rowDims.hidden = mode.value !== "dims";
    rowArea.hidden = mode.value === "dims";
    rowCov.hidden = material.value !== "batt";
  }

  function qtyKey(mat) {
    if (mat === "batt") return "tool.r.packs";
    if (mat === "foam") return "tool.r.bdft";
    return "tool.r.bags";
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var isM = unit.value === "m", sqft;
    if (mode.value === "dims") {
      var l = num(len), w = num(wid);
      if (!isFinite(l) || !isFinite(w)) return fail("tool.err.empty");
      if (l <= 0 || w <= 0) return fail("tool.err.pos");
      sqft = l * w;
    } else {
      var a = num(area);
      if (!isFinite(a)) return fail("tool.err.empty");
      if (a <= 0) return fail("tool.err.pos");
      sqft = a;
    }
    if (isM) sqft *= SQFT_PER_M2;
    if (sqft > 200000) return fail("tool.err.big");

    var mat = material.value;
    var needed = parseFloat(targetr.value) - parseFloat(existing.value);
    var unitLabel = isM ? t("tool.u.cm") : t("tool.u.in");
    $("r-qty-label").textContent = t(qtyKey(mat));

    // 기존 단열재가 목표 이상이면 오류가 아니라 "더 넣을 것 없음"이 정답이다.
    if (needed <= 0) {
      $("r-needed").textContent = "R-0";
      $("r-depth").textContent = "0 " + unitLabel;
      $("r-qty").textContent = "0";
      $("r-note").textContent = t("tool.r.attarget");
      errEl.hidden = true; result.hidden = false;
      return;
    }

    var cov = 0;
    if (mat === "batt") {
      cov = num(coverage);
      if (!isFinite(cov) || cov <= 0) return fail("tool.err.cov");
      if (isM) cov *= SQFT_PER_M2;
    }

    var inches = needed / PER_INCH[mat];
    $("r-needed").textContent = "R-" + (Math.round(needed * 10) / 10);
    $("r-depth").textContent = (isM ? (inches * 2.54).toFixed(1) : inches.toFixed(1)) + " " + unitLabel;
    if (mat === "batt") $("r-qty").textContent = grp(Math.ceil(sqft / cov));
    else if (mat === "foam") $("r-qty").textContent = grp(Math.ceil(sqft * inches));
    else $("r-qty").textContent = grp(Math.ceil(sqft * needed / BAG_R_FT2));
    $("r-note").textContent = t("tool.r.model");

    errEl.hidden = true; result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [len, wid, area, coverage].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [unit, mode, targetr, existing, material].forEach(function (el) {
    el.addEventListener("change", function () { sync(); if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  sync();
  // TOOLJS:END
})();
