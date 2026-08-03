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
  var guests = $("guests"), drinkers = $("drinkers"), hours = $("hours"), crowd = $("crowd");
  var mixBeer = $("mix-beer"), mixWine = $("mix-wine"), mixSpirits = $("mix-spirits"), pour = $("pour"), shot = $("shot");
  var result = $("result"), errEl = $("err"), listEl = $("list");
  if (!guests || !drinkers || !hours || !crowd || !mixBeer) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 업계 통념: 첫 시간 2잔 + 이후 시간당 1잔. 성향 계수는 그 위에 곱한다.
  var CROWD = { light: 0.75, standard: 1, heavy: 1.25 };
  var COCKTAILS_PER_LITER = 3; // 믹서 1L 당 칵테일 3잔
  var ICE_LB_PER_GUEST = 1.5;

  var num = function (el) { return parseFloat(String(el.value).replace(/,/g, "")); };
  var fmt = function (n) { return n.toLocaleString(); };

  function fail(key, extra) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key) + (extra || "");
  }

  function calc() {
    var g = num(guests);
    if (!isFinite(g) || g < 1 || g > 5000) return fail("tool.err.guests");
    var pct = num(drinkers);
    if (!isFinite(pct) || pct < 1 || pct > 100) return fail("tool.err.pct");
    var h = num(hours);
    if (!isFinite(h) || h < 0.5 || h > 24) return fail("tool.err.hours");

    var b = parseInt(mixBeer.value, 10), w = parseInt(mixWine.value, 10), s = parseInt(mixSpirits.value, 10);
    var sum = b + w + s;
    if (sum !== 100) return fail("tool.err.mix", " " + sum + "%.");

    var pourMl = parseFloat(pour && pour.value) || 150;
    var winePerBottle = 750 / pourMl;   // 선택한 잔 용량 기준 병당 잔 수
    var shotMl = parseFloat(shot && shot.value) || 44;   // 기본 1.5oz 미국 샷
    var shotsPerBottle = 750 / shotMl;

    var drinkerCount = Math.round(g * pct / 100);
    if (drinkerCount < 1) drinkerCount = 1;
    var total = drinkerCount * (h + 1) * CROWD[crowd.value];

    var vals = {
      "r-total": Math.round(total),
      "r-beer": Math.ceil(total * b / 100),
      "r-wine": Math.ceil(total * w / 100 / winePerBottle),
      "r-spirits": Math.ceil(total * s / 100 / shotsPerBottle),
      "r-mixers": Math.ceil(total * s / 100 / COCKTAILS_PER_LITER),
      "r-ice": Math.ceil(g * ICE_LB_PER_GUEST),
      "r-soda": Math.ceil(Math.max(0, g - drinkerCount) * 2),
      "r-water": Math.ceil(g * h / 2)
    };
    var order = ["r-total", "r-beer", "r-wine", "r-spirits", "r-mixers", "r-ice", "r-soda", "r-water"];
    var labels = {
      "r-total": "tool.r.total", "r-beer": "tool.r.beer", "r-wine": "tool.r.wine",
      "r-spirits": "tool.r.spirits", "r-mixers": "tool.r.mixers", "r-ice": "tool.r.ice",
      "r-soda": "tool.r.soda", "r-water": "tool.r.water"
    };
    var lines = [];
    for (var i = 0; i < order.length; i++) {
      var id = order[i];
      $(id).textContent = fmt(vals[id]);
      lines.push(t(labels[id]) + ": " + fmt(vals[id]));
    }
    listEl.textContent = lines.join("\n");

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [guests, drinkers, hours].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [crowd, mixBeer, mixWine, mixSpirits, pour, shot].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });

  $("copy-btn").addEventListener("click", function () {
    var btn = $("copy-btn"), text = listEl.textContent;
    if (!text) return;
    var done = function () {
      var prev = btn.textContent;
      btn.textContent = t("tool.copied");
      setTimeout(function () { btn.textContent = prev; }, 1200);
    };
    if (navigator.clipboard) { navigator.clipboard.writeText(text).then(done, function () { /* 권한 거부 */ }); return; }
    var ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { /* 구형 브라우저 */ }
    document.body.removeChild(ta);
  });
  // TOOLJS:END
})();
