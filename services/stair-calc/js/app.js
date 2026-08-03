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
  var unit = $("unit"), rise = $("rise"), tread = $("tread"), target = $("target");
  var result = $("result"), errEl = $("err");
  var customWrap = $("custom-wrap"), customRiser = $("custom-riser");
  if (!unit || !rise || !tread || !target) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 코드 한도는 전부 인치 기준(IRC) — 내부 계산은 인치로 통일하고 표시할 때만 되돌린다.
  var IN_PER_CM = 2.54;
  var MAX_RISER = 7.75, MIN_TREAD = 10;
  var COMFORT_LO = 24, COMFORT_HI = 25;

  function num(el) { var v = parseFloat(String(el.value).replace(/,/g, "")); return isFinite(v) ? v : NaN; }
  function fmt(v) { return String(Math.round(v * 100) / 100); }
  // 인치 모드에서는 줄자 눈금(1/16")으로도 같이 보여준다 — 목수는 소수 인치로 자르지 않는다.
  function frac16(inches) {
    var sixteenths = Math.round(inches * 16);
    var whole = Math.floor(sixteenths / 16), rem = sixteenths % 16;
    if (rem === 0) return whole + "\"";
    var den = 16;
    while (rem % 2 === 0) { rem /= 2; den /= 2; }
    return (whole ? whole + "-" : "") + rem + "/" + den + "\"";
  }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }
  function setBadge(el, ok, okKey, badKey) {
    el.className = "badge " + (ok ? "pass" : "warn");
    el.textContent = t(ok ? okKey : badKey);
  }

  function calc() {
    var perIn = unit.value === "cm" ? IN_PER_CM : (unit.value === "mm" ? IN_PER_CM * 10 : 1);
    var f = 1 / perIn;                          // 화면 단위 → 인치
    var u = unit.value === "in" ? " in" : " " + unit.value;
    var toUnit = function (inches) { return fmt(inches * perIn) + u; };

    var riseRaw = num(rise);
    if (isNaN(riseRaw)) return fail("tool.err.rise");
    var riseIn = riseRaw * f;
    if (riseIn <= 0 || riseIn < 10 || riseIn > 240) return fail("tool.err.riserange");

    var treadRaw = num(tread);
    if (isNaN(treadRaw)) return fail("tool.err.tread");
    var treadIn = treadRaw * f;
    if (treadIn <= 0 || treadIn < 6 || treadIn > 20) return fail("tool.err.treadrange");

    var targetIn;
    if (target.value === "custom") {
      var cRaw = num(customRiser);
      if (isNaN(cRaw)) return fail("tool.err.riser");
      targetIn = cRaw * f;
      if (!(targetIn >= 4 && targetIn <= 8.25)) return fail("tool.err.riser");
    } else {
      targetIn = parseFloat(target.value);
    }

    var steps = Math.round(riseIn / targetIn);
    if (steps < 1) steps = 1;
    var riserIn = riseIn / steps;
    // 4~8.25in 밖이면 이 단 수로는 못 쓴다 — 조용히 이상한 값을 내지 않고 안내한다.
    if (riserIn < 4 || riserIn > 8.25) return fail("tool.err.riser");

    var treads = steps - 1;
    var runIn = treads * treadIn;
    var stringerIn = Math.sqrt(riseIn * riseIn + runIn * runIn);
    var comfortIn = 2 * riserIn + treadIn;

    $("r-risers").textContent = steps + " × " + toUnit(riserIn) + (unit.value === "in" ? " (" + frac16(riserIn) + ")" : "");
    $("r-treads").textContent = String(treads);
    $("r-run").textContent = toUnit(runIn);
    $("r-stringer").textContent = toUnit(stringerIn);
    $("r-comfort").textContent = toUnit(comfortIn);
    $("r-angle").textContent = fmt(Math.atan(riserIn / treadIn) * 180 / Math.PI) + "°";

    setBadge($("b-riser"), riserIn <= MAX_RISER + 1e-9, "tool.badge.riserok", "tool.badge.riserover");
    setBadge($("b-tread"), treadIn >= MIN_TREAD - 1e-9, "tool.badge.treadok", "tool.badge.treadunder");
    setBadge($("b-comfort"), comfortIn >= COMFORT_LO && comfortIn <= COMFORT_HI, "tool.badge.comfortok", "tool.badge.comfortoff");

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  function syncCustom() { customWrap.hidden = target.value !== "custom"; }
  syncCustom();

  [rise, tread, customRiser].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [unit, target].forEach(function (el) {
    el.addEventListener("change", function () { syncCustom(); if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
