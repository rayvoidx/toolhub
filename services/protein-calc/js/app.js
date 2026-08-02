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
  var weight = $("weight"), unit = $("unit"), goal = $("goal"), meals = $("meals");
  var result = $("result"), errEl = $("err");
  if (!weight || !unit || !goal || !meals) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // g/kg 밴드 — ISSN·ACSM 포지션 스탠드 권장 구간 (하한/상한)
  var TIERS = {
    sedentary: [0.8, 1.0],
    active: [1.2, 1.6],
    muscle: [1.6, 2.2],
    cut: [1.8, 2.4],
    endurance: [1.2, 1.8],
    senior: [1.0, 1.2],
  };
  var LB_PER_KG = 2.20462;
  var CHICKEN_G = 31; // 조리된 닭가슴살 100 g 당 단백질 g
  var EGG_G = 6;      // 대란 1개 당 단백질 g

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }
  function rng(a, b) {
    var lo = Math.max(1, Math.round(a)), hi = Math.max(lo, Math.round(b));
    return lo === hi ? String(lo) : lo + "-" + hi;
  }

  function calc() {
    var raw = parseFloat(String(weight.value).replace(/,/g, ""));
    if (!isFinite(raw)) return fail("tool.err.empty");
    if (raw <= 0) return fail("tool.err.positive");

    var kg = unit.value === "lb" ? raw / LB_PER_KG : raw;
    if (kg < 30 || kg > 300) return fail("tool.err.range");

    var tier = TIERS[goal.value] || TIERS.active;
    var lo = kg * tier[0], hi = kg * tier[1];
    var m = parseInt(meals.value, 10);
    if (!(m >= 1 && m <= 6)) m = 3; // 1끼(OMAD)~6끼, 값이 깨지면 3끼로
    var g = t("tool.g");

    $("r-daily").textContent = rng(lo, hi) + " " + g;
    $("r-meal").textContent = rng(lo / m, hi / m) + " " + g;
    $("r-tier").textContent = unit.value === "lb"
      ? (tier[0] / LB_PER_KG).toFixed(2) + "-" + (tier[1] / LB_PER_KG).toFixed(2) + " g/lb"
      : tier[0].toFixed(1) + "-" + tier[1].toFixed(1) + " g/kg";
    $("r-food").textContent = t("tool.food.fmt")
      .replace("{a}", rng(lo / CHICKEN_G, hi / CHICKEN_G))
      .replace("{b}", rng(lo / EGG_G, hi / EGG_G));
    $("r-note").textContent = t("tool.note." + goal.value);
    var omad = $("r-omad");
    omad.textContent = m === 1 ? t("tool.note.omad") : "";
    omad.hidden = m !== 1;

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  weight.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  [unit, goal, meals].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
