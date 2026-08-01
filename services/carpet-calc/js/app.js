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
  var unit = $("unit"), len = $("len"), wid = $("wid");
  var roll = $("roll"), waste = $("waste"), price = $("price"), priceunit = $("priceunit");
  var result = $("result"), errEl = $("err");
  if (!unit || !len || !wid || !roll || !waste) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var FT_PER_M = 3.280839895, SQFT_PER_SQM = 10.76391;
  var SQFT_PER_SQYD = 9;                 // 야드 단위 견적의 함정 — 1 sq yd = 9 sq ft
  var MAX_DIM = { ft: 300, m: 90 };
  var EPS = 1e-9;                        // 3.66m→12.0000000002ft 같은 부동소수 오차로 스트립이 하나 늘어나는 것 방지

  function num(el) { return el ? parseFloat(String(el.value).replace(/,/g, "")) : NaN; }
  function blank(el) { return !el || String(el.value).trim() === ""; }
  function fmt(n, d) {
    var p = n.toFixed(d).split(".");
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return p.join(".");
  }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  // 카펫은 롤 폭 스트립으로만 잘린다. 길이 방향/너비 방향 두 배치를 다 계산해 덜 드는 쪽을 쓴다.
  function layout(runLen, across, rollW) {
    var strips = Math.ceil(across / rollW - EPS);
    return { strips: strips, sqft: strips * rollW * runLen };
  }

  function calc() {
    var l = num(len), w = num(wid);
    if (!isFinite(l) || !isFinite(w)) return fail("tool.err.empty");
    if (l <= 0 || w <= 0) return fail("tool.err.zero");

    var metric = unit.value === "m";
    var max = metric ? MAX_DIM.m : MAX_DIM.ft;
    if (l > max || w > max) return fail("tool.err.range");

    var p = null;
    if (!blank(price)) {
      p = num(price);
      if (!isFinite(p) || p < 0) return fail("tool.err.price");
    }

    var k = metric ? FT_PER_M : 1;
    var lFt = l * k, wFt = w * k;
    var rollW = parseFloat(roll.value) || 12;
    var areaSqft = lFt * wFt;

    var a = layout(lFt, wFt, rollW), b = layout(wFt, lFt, rollW);
    var best = b.sqft < a.sqft ? b : a;

    var factor = 1 + (parseFloat(waste.value) || 0) / 100;
    // 180 × 1.1 이 198.00000000000003 이라 그냥 ceil 하면 199 가 된다 — 1/1000 ft² 오차는 깎고 올린다.
    var buySqft = Math.ceil(best.sqft * factor - 1e-3);
    var padSqft = Math.ceil(areaSqft - 1e-3);

    $("r-buy").textContent = fmt(buySqft, 0) + " " + t("tool.u.sqft");
    $("r-sqyd").textContent = fmt(buySqft / SQFT_PER_SQYD, 1) + " " + t("tool.u.sqyd");
    $("c-sqm").hidden = !metric;
    $("r-sqm").textContent = fmt(buySqft / SQFT_PER_SQM, 1) + " " + t("tool.u.sqm");
    $("r-area").textContent = metric
      ? fmt(l * w, 1) + " " + t("tool.u.sqm")
      : fmt(areaSqft, 0) + " " + t("tool.u.sqft");
    $("r-padding").textContent = fmt(padSqft, 0) + " " + t("tool.u.sqft") +
      " (" + fmt(padSqft / SQFT_PER_SQYD, 1) + " " + t("tool.u.sqyd") + ")";
    $("r-seams").textContent = best.strips === 1
      ? t("tool.seam.one")
      : best.strips + " " + t("tool.seam.many");

    // 업계는 sq ft 와 sq yd 양쪽으로 견적을 부른다 — 입력한 기준 그대로 곱해야 금액이 맞는다.
    if (p === null) {
      $("c-cost").hidden = true; $("r-cost").textContent = "—";
    } else {
      var qty = (priceunit && priceunit.value === "sqyd") ? buySqft / SQFT_PER_SQYD : buySqft;
      $("c-cost").hidden = false; $("r-cost").textContent = fmt(qty * p, 2);
    }

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [len, wid, price].forEach(function (el) {
    if (el) el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [unit, roll, waste, priceunit].forEach(function (el) {
    if (el) el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
