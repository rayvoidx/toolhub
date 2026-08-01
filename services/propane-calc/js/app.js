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
  var tank = $("tank"), tanklb = $("tanklb"), appliance = $("appliance"), btuhr = $("btuhr");
  var usage = $("usage"), price = $("price");
  var result = $("result"), errEl = $("err");
  if (!tank || !tanklb || !appliance || !btuhr || !usage || !price) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 프로판 1 lb = 21,500 BTU (연소 하한열량). 탱크 표기 파운드가 곧 실제 충전량이다.
  var BTU_PER_LB = 21500;
  var SESSION_HOURS = 3;

  function num(el) { return parseFloat(String(el.value).replace(/,/g, "").trim()); }
  function fmt(n, d) { return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function syncRows() {
    $("tanklb-row").hidden = tank.value !== "custom";
    $("btu-row").hidden = appliance.value !== "custom";
  }

  function calc() {
    var lb = tank.value === "custom" ? num(tanklb) : parseFloat(tank.value);
    if (!isFinite(lb) || lb <= 0 || lb > 2000) return fail("tool.err.tank");

    var rate = appliance.value === "custom" ? num(btuhr) : parseFloat(appliance.value);
    if (!isFinite(rate) || rate < 500 || rate > 1000000) return fail("tool.err.btu");

    var priceRaw = String(price.value).trim();
    var cost = null;
    if (priceRaw !== "") {
      var p = num(price);
      if (!isFinite(p) || p < 0) return fail("tool.err.price");
      cost = p;
    }

    var usableBtu = lb * BTU_PER_LB;
    var hours = usableBtu / (rate * (parseFloat(usage.value) / 100));

    var wholeH = Math.floor(hours);
    var mins = Math.round((hours - wholeH) * 60);
    if (mins === 60) { wholeH += 1; mins = 0; }
    $("r-hours").textContent = fmt(wholeH, 0) + " " + t("tool.u.h") + " " + mins + " " + t("tool.u.min");
    $("r-sessions").textContent = fmt(hours / SESSION_HOURS, 1);
    // 시간당 비용은 탱크 값을 그대로 시간으로 나눈다 — 입력 통화 그대로 표시.
    $("r-cost").textContent = cost === null ? t("tool.r.cost.na") : fmt(cost / hours, 2);
    $("r-btu").textContent = fmt(Math.round(usableBtu), 0) + " BTU";

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [tanklb, btuhr, price].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [tank, appliance, usage].forEach(function (el) {
    el.addEventListener("change", function () { syncRows(); if (!result.hidden || !errEl.hidden) calc(); });
  });
  [tanklb, btuhr, price].forEach(function (el) {
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  syncRows();
  // TOOLJS:END
})();
