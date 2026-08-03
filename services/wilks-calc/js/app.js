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
  var bw = $("bw"), bwunit = $("bwunit"), total = $("total"), totunit = $("totunit");
  var result = $("result"), errEl = $("err");
  if (!bw || !bwunit || !total || !totunit) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { return parseFloat(String(el.value).replace(/,/g, "")); };
  var LB = 0.45359237;

  // 두 공식 모두 체중(kg) 다항식으로 계수를 만든다. 상수는 발표값 그대로, 차수 오름차순.
  var DOTS = {
    male: [-307.75076, 24.0900756, -0.1918759221, 0.0007391293, -0.000001093],
    female: [-57.96288, 13.6175032, -0.1126655495, 0.0005158568, -0.0000010706]
  };
  var WILKS1 = {
    male: [-216.0475144, 16.2606339, -0.002388645, -0.00113732, 7.01863e-06, -1.291e-08],
    female: [594.31747775582, -27.23842536447, 0.82112226871, -0.00930733913, 4.731582e-05, -9.054e-08]
  };
  var WILKS2 = {
    male: [47.46178854, 8.472061379, 0.07369410346, -0.001395833811, 7.07665973e-06, -1.208043365e-08],
    female: [-125.4255398, 13.71219419, -0.03307250631, -0.001050400051, 9.38773881e-06, -2.33346139e-08]
  };
  // IPF GL(2020) 클래식(로우) 3종목 파라미터 — 계수 = 100 / (A - B*exp(-C*bw))
  var GL = { male: [1199.72839, 1025.18162, 0.00921], female: [610.32796, 1045.59282, 0.03048] };
  function poly(c, x) {
    var s = 0, p = 1;
    for (var i = 0; i < c.length; i++) { s += c[i] * p; p *= x; }
    return s;
  }
  function band(dots) {
    if (dots < 200) return "tool.level.novice";
    if (dots < 300) return "tool.level.inter";
    if (dots < 400) return "tool.level.adv";
    if (dots < 500) return "tool.level.elite";
    return "tool.level.world";
  }
  function kgLb(kg) { return kg.toFixed(1) + " kg (" + (kg / LB).toFixed(1) + " lb)"; }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var b = num(bw), tot = num(total);
    if (!isFinite(b) || !isFinite(tot)) return fail("tool.err.empty");

    var kg = bwunit.value === "lb" ? b * LB : b;
    var totKg = totunit.value === "lb" ? tot * LB : tot;
    if (kg < 30 || kg > 200) return fail("tool.err.bw");
    if (totKg <= 0 || totKg > 2000) return fail("tool.err.total");

    var sex = (document.querySelector('input[name="sex"]:checked') || {}).value === "female" ? "female" : "male";
    var dots = totKg * 500 / poly(DOTS[sex], kg);
    var wilks = totKg * 600 / poly(WILKS2[sex], kg);
    var wilks1 = totKg * 500 / poly(WILKS1[sex], kg);
    var g = GL[sex], gden = g[0] - g[1] * Math.exp(-g[2] * kg);
    var gl = gden > 0 ? totKg * 100 / gden : NaN;
    // 다항식 분모가 0 근처로 가면 점수가 무한·음수가 된다 — 숫자를 그대로 뱉지 않고 범위 안내로 돌린다.
    if (!isFinite(dots) || dots <= 0 || !isFinite(wilks) || wilks <= 0 || !isFinite(wilks1) || wilks1 <= 0 || !isFinite(gl) || gl <= 0) return fail("tool.err.bw");

    $("r-dots").textContent = dots.toFixed(2);
    $("r-wilks").textContent = wilks.toFixed(2);
    $("r-wilks1").textContent = wilks1.toFixed(2);
    $("r-gl").textContent = gl.toFixed(2);
    $("r-level").textContent = t(band(dots));
    $("r-echo").textContent = kgLb(kg) + " · " + kgLb(totKg);

    errEl.hidden = true;
    result.hidden = false;
  }

  var recalc = function () { if (!result.hidden || !errEl.hidden) calc(); };
  $("calc-btn").addEventListener("click", calc);
  [bw, total].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("input", recalc);
  });
  [bwunit, totunit].forEach(function (el) { el.addEventListener("change", recalc); });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="sex"]'), function (r) {
    r.addEventListener("change", recalc);
  });
  document.addEventListener("i18n:change", recalc);
  // TOOLJS:END
})();
