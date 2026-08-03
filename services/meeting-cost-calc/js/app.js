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
  var attendees = $("attendees"), salary = $("salary"), hourly = $("hourly");
  var minutes = $("minutes"), customMin = $("custom-min"), customField = $("custom-field");
  var recur = $("recur"), loaded = $("loaded");
  var result = $("result"), errEl = $("err");
  if (!attendees || !salary || !hourly || !minutes || !recur || !loaded) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (v) { return parseFloat(String(v).replace(/[\s,]/g, "")); };
  // 큰 금액은 소수점이 소음이고, 분당 소모액은 소수점이 없으면 0으로 뭉개진다.
  var money = function (n) {
    return n.toLocaleString(undefined, { maximumFractionDigits: n >= 1000 ? 0 : 2 });
  };

  var HOURS_PER_YEAR = 2080, LOAD = 1.3, WORKDAYS = 250;
  var PER_YEAR = { weekly: 52, biweekly: 26, monthly: 12, daily: WORKDAYS };

  function syncCustom() { customField.hidden = minutes.value !== "custom"; }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var heads = Math.floor(num(attendees.value));
    if (!isFinite(heads) || heads < 1) return fail("tool.err.attendees");

    // 시급을 적어 넣었으면 그게 진본이고, 비워 두면 연봉을 2,080시간으로 나눈다.
    var perHour;
    if (String(hourly.value).trim() !== "") {
      perHour = num(hourly.value);
      if (!isFinite(perHour) || perHour <= 0) return fail("tool.err.pay");
    } else {
      var sal = num(salary.value);
      if (!isFinite(sal) || sal <= 0) return fail("tool.err.pay");
      perHour = sal / HOURS_PER_YEAR;
    }

    var mins = minutes.value === "custom" ? num(customMin.value) : parseFloat(minutes.value);
    if (!isFinite(mins) || mins <= 0 || mins > 1440) return fail("tool.err.minutes");

    var loadedRate = perHour * (loaded.checked ? LOAD : 1);
    var cost = heads * loadedRate * mins / 60;
    if (!isFinite(cost)) return fail("tool.err.pay");
    var mult = PER_YEAR[recur.value] || 0;

    $("r-cost").textContent = money(cost);
    $("r-burn").textContent = money(cost / mins);
    $("r-hours").textContent = (heads * mins / 60).toLocaleString(undefined, { maximumFractionDigits: 1 });
    $("r-rate").textContent = money(loadedRate);
    $("annual-card").hidden = !mult;
    $("r-annual").textContent = mult ? money(cost * mult) : "—";

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [attendees, salary, hourly, customMin].forEach(function (el) {
    if (el) el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  minutes.addEventListener("change", syncCustom);
  [minutes, recur, loaded].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  syncCustom();
  // TOOLJS:END
})();
