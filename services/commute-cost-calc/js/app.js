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
  var dist = $("dist"), units = $("units"), days = $("days"), method = $("method");
  var mpg = $("mpg"), gasprice = $("gasprice"), rate = $("rate");
  var parking = $("parking"), tolls = $("tolls"), transit = $("transit"), minutes = $("minutes");
  var parkbasis = $("parkbasis"), rateLabel = $("rate-label");
  var result = $("result"), errEl = $("err"), gasRow = $("gas-row"), rateRow = $("rate-row");
  var cardTransit = $("card-transit"), cardHours = $("card-hours"), noteIrs = $("note-irs");
  if (!dist || !days || !method || !parking || !tolls) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { var v = parseFloat(String(el.value).replace(/[,\s]/g, "")); return isFinite(v) ? v : NaN; };
  // 선택 입력: 빈 칸은 0으로 취급하되, 글자가 들어오면 NaN 을 그대로 흘려 검증에서 잡는다.
  var optNum = function (el) { return String(el.value).trim() === "" ? 0 : num(el); };
  var money = function (n) { return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var money0 = function (n) { return n.toLocaleString(undefined, { maximumFractionDigits: 0 }); };

  var IRS_RATE = 0.70;          // 2025 IRS 표준 마일리지 요율 — 연료·감가상각·보험·정비·타이어 전부 포함
  var KM_PER_MI = 1.609344;
  var WEEKS_PER_MONTH = 52 / 12; // 4.333… — "한 달 4주"로 잡으면 연 4주치가 사라진다

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function syncMethod() {
    gasRow.hidden = method.value !== "gas";
    rateRow.hidden = method.value !== "custom";
  }

  // 거리를 km 로 입력하면 직접 요율도 km 기준으로 받는다 — 손으로 환산하게 두지 않는다.
  function syncRateLabel() {
    var key = units.value === "km" ? "tool.rate.label.km" : "tool.rate.label";
    rateLabel.setAttribute("data-i18n", key);
    rateLabel.textContent = t(key);
  }

  function calc() {
    var d = num(dist);
    if (isNaN(d)) return fail("tool.err.dist");
    if (d <= 0 || d >= 500) return fail("tool.err.distrange");

    var wd = num(days);
    if (isNaN(wd)) return fail("tool.err.days");
    if (wd < 1 || wd > 7) return fail("tool.err.daysrange");

    var perMile;
    if (method.value === "gas") {
      var m = num(mpg);
      if (isNaN(m) || m <= 0) return fail("tool.err.mpg");
      var g = num(gasprice);
      if (isNaN(g) || g <= 0) return fail("tool.err.gasprice");
      perMile = g / m;
    } else if (method.value === "custom") {
      var r = num(rate);
      if (isNaN(r) || r <= 0) return fail("tool.err.rate");
      perMile = units.value === "km" ? r * KM_PER_MI : r;
    } else {
      perMile = IRS_RATE;
    }

    var pk = optNum(parking), tl = optNum(tolls), tr = optNum(transit);
    if (isNaN(pk) || isNaN(tl) || isNaN(tr) || pk < 0 || tl < 0 || tr < 0) return fail("tool.err.neg");

    var minRaw = String(minutes.value).trim();
    var mins = minRaw === "" ? NaN : num(minutes);
    if (minRaw !== "" && (isNaN(mins) || mins < 0 || mins > 300)) return fail("tool.err.minutes");

    var distPerWeek = d * 2 * wd;                                             // 입력 단위 그대로 (표시용)
    var milesPerWeek = units.value === "km" ? distPerWeek / KM_PER_MI : distPerWeek; // 요율은 마일 기준
    // 월정액 주차권은 출근 일수와 무관하게 매달 같은 금액이 나간다 — 주 단위로만 환산한다.
    var parkWeekly = parkbasis.value === "month" ? pk / WEEKS_PER_MONTH : pk * wd;
    var weekly = milesPerWeek * perMile + parkWeekly + wd * tl;
    var monthly = weekly * WEEKS_PER_MONTH;

    $("r-month").textContent = money(monthly);
    $("r-year").textContent = money0(weekly * 52);
    $("r-trip").textContent = money(weekly / wd);
    $("r-dist").textContent = money0(distPerWeek) + " " + t(units.value === "km" ? "tool.unit.km" : "tool.unit.mi");

    // 정기권을 넣은 사람에게만 비교 카드를 보인다 — 0 은 "입력 안 함"과 같게 다룬다.
    cardTransit.hidden = !(tr > 0);
    if (tr > 0) {
      var delta = monthly - tr;
      $("r-transit").textContent = money(Math.abs(delta));
      $("r-transit-note").textContent = t(delta >= 0 ? "tool.transit.save" : "tool.transit.extra");
    }

    cardHours.hidden = !(minRaw !== "" && mins > 0);
    if (minRaw !== "" && mins > 0) $("r-hours").textContent = money0(mins * 2 * wd * 52 / 60);

    noteIrs.hidden = method.value !== "irs";
    errEl.hidden = true;
    result.hidden = false;
  }

  var live = function () { if (!result.hidden || !errEl.hidden) calc(); };

  syncMethod();
  syncRateLabel();
  $("calc-btn").addEventListener("click", calc);
  [dist, days, mpg, gasprice, rate, parking, tolls, transit, minutes].forEach(function (el) {
    if (!el) return;
    el.addEventListener("input", live);
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  units.addEventListener("change", function () { syncRateLabel(); live(); });
  parkbasis.addEventListener("change", live);
  method.addEventListener("change", function () { syncMethod(); live(); });
  document.addEventListener("i18n:change", function () { syncRateLabel(); live(); });
  // TOOLJS:END
})();
