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
  var unit = $("unit"), mode = $("mode"), depth = $("depth");
  var len = $("len"), wid = $("wid"), dia = $("dia"), area = $("area"), dcustom = $("dcustom");
  var result = $("result"), errEl = $("err"), metric = $("r-metric");
  if (!unit || !mode || !depth) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 프리셋 깊이는 단위계마다 현장에서 쓰는 숫자가 다르다 — 2in 을 5.08cm 로 보여주면 아무도 안 쓴다.
  var PRESET = { "2": { inch: 2, cm: 5 }, "4": { inch: 4, cm: 10 }, "6": { inch: 6, cm: 15 } };
  var BAG_CUFT = 0.75;        // 40 lb 자루 1개 ≈ 0.75 cu ft
  var TON_PER_YD3 = 1.35;     // 체 친 마른 양토. 습도에 따라 1.0~1.7 (문구로 고지)
  var SQFT_PER_SQM = 10.7639104, FT_PER_M = 3.280839895;

  function num(el) { return el ? parseFloat(String(el.value).replace(/,/g, "")) : NaN; }
  function fmt(n, d) {
    var p = n.toFixed(d).split(".");
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return p.join(".");
  }
  function fail(key) {
    result.hidden = true; metric.hidden = true;
    errEl.hidden = false; errEl.textContent = t(key);
  }

  function sync() {
    var m = mode.value, ft = unit.value === "ft";
    $("f-rect").hidden = m !== "rect";
    $("f-circle").hidden = m !== "circle";
    $("f-direct").hidden = m !== "direct";
    $("f-custom").hidden = depth.value !== "custom";
    var lu = t(ft ? "tool.u.ft" : "tool.u.m");
    $("u-len").textContent = lu; $("u-wid").textContent = lu; $("u-dia").textContent = lu;
    $("u-area").textContent = t(ft ? "tool.u.sqft" : "tool.u.sqm");
    $("u-depth").textContent = t(ft ? "tool.u.in" : "tool.u.cm");
  }

  function calc() {
    var ft = unit.value === "ft", m = mode.value, a;
    if (m === "rect") {
      var l = num(len), w = num(wid);
      if (!isFinite(l) || !isFinite(w)) return fail("tool.err.empty");
      if (l <= 0 || w <= 0) return fail("tool.err.zero");
      if (l > 10000 || w > 10000) return fail("tool.err.range");
      a = l * w;
    } else if (m === "circle") {
      var d = num(dia);
      if (!isFinite(d)) return fail("tool.err.empty");
      if (d <= 0) return fail("tool.err.zero");
      if (d > 10000) return fail("tool.err.range");
      a = Math.PI * d * d / 4;
    } else {
      a = num(area);
      if (!isFinite(a)) return fail("tool.err.empty");
      if (a <= 0) return fail("tool.err.zero");
      if (a > 1e8) return fail("tool.err.range");
    }

    var dv;
    if (depth.value === "custom") {
      dv = num(dcustom);
      if (!isFinite(dv) || dv <= 0) return fail("tool.err.depth");
      if (dv > (ft ? 60 : 150)) return fail("tool.err.range");
    } else {
      dv = ft ? PRESET[depth.value].inch : PRESET[depth.value].cm;
    }

    var areaFt = ft ? a : a * SQFT_PER_SQM;
    var depthFt = ft ? dv / 12 : (dv / 100) * FT_PER_M;
    var cuft = areaFt * depthFt;
    var yd3 = cuft / 27;

    $("r-yards").textContent = fmt(yd3, 1) + " " + t("tool.u.yd3");
    $("r-cuft").textContent = fmt(cuft, 1) + " " + t("tool.u.cuft");
    // 자루는 쪼개 살 수 없다 — 항상 올림.
    $("r-bags").textContent = fmt(Math.ceil(cuft / BAG_CUFT), 0) + " " + t("tool.u.bags");
    $("r-tons").textContent = fmt(yd3 * TON_PER_YD3, 2) + " " + t("tool.u.tons");
    $("r-area").textContent = ft ? fmt(a, 0) + " " + t("tool.u.sqft") : fmt(a, 1) + " " + t("tool.u.sqm");

    if (ft) { metric.hidden = true; metric.textContent = ""; }
    else { metric.hidden = false; metric.textContent = t("tool.r.cbm") + ": " + fmt(cuft / 35.3146667, 2) + " m3"; }

    errEl.hidden = true;
    result.hidden = false;
  }

  function recalc() { if (!result.hidden || !errEl.hidden) calc(); }

  sync();
  $("calc-btn").addEventListener("click", calc);
  [len, wid, dia, area, dcustom].forEach(function (el) {
    if (!el) return;
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("input", recalc);
  });
  [unit, mode, depth].forEach(function (el) {
    el.addEventListener("change", function () { sync(); recalc(); });
  });
  document.addEventListener("i18n:change", function () { sync(); recalc(); });
  // TOOLJS:END
})();
