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
  var solve = $("solve"), mass = $("mass"), munit = $("munit"), vel = $("vel"), vunit = $("vunit"),
      energy = $("energy"), eunit = $("eunit"), result = $("result"), errEl = $("err"), noteNeg = $("note-neg");
  if (!solve || !mass || !vel || !energy) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var MU = { kg: 1, lb: 0.45359237, g: 0.001 };          // → kg
  var VU = { ms: 1, kmh: 1 / 3.6, mph: 0.44704 };        // → m/s
  var EU = { j: 1, kj: 1000, kwh: 3600000 };             // → J
  var ULAB = { kg: "kg", lb: "lb", g: "g", ms: "m/s", kmh: "km/h", mph: "mph" };
  // 1 g TNT = 4184 J = 1 food Calorie — 두 환산의 분모가 같은 건 우연이 아니라 정의(열화학 칼로리) 때문이다.
  var TNT_J = 4184;
  var ANCHORS = [
    { k: "tool.anchor.car", j: 550000 },
    { k: "tool.anchor.bullet", j: 1800 },
    { k: "tool.anchor.ball", j: 120 }
  ];

  function num(el) {
    var v = parseFloat(String(el.value).replace(/,/g, ""));
    return isFinite(v) ? v : null;
  }
  function sig(n) {
    var a = Math.abs(n), d;
    if (a > 0 && a < 0.001) return n.toPrecision(3);
    if (a >= 100) d = 0; else if (a >= 10) d = 1; else if (a >= 1) d = 2; else d = 4;
    try { return n.toLocaleString(undefined, { maximumFractionDigits: d }); }
    catch (e) { return String(Math.round(n * 10000) / 10000); }
  }
  function ratio(r) {                     // 비교 배수는 유효숫자 2~3자리면 충분하다
    if (r >= 10) return sig(r);
    var d = r >= 1 ? 10 : 100;
    return String(Math.round(r * d) / d);
  }
  function energyText(j) {
    if (j >= 1e6) return sig(j / 1e6) + " MJ";
    if (j >= 1000) return sig(j / 1000) + " kJ";
    return sig(j) + " J";
  }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }
  function syncRows() {
    var m = solve.value;
    $("row-mass").hidden = (m === "mass");
    $("row-vel").hidden = (m === "vel");
    $("row-energy").hidden = (m === "ke");
  }

  function calc() {
    var mode = solve.value, j, kg, ms, neg = false, sub = "", labelKey;

    if (mode === "mass" || mode === "vel") {
      j = num(energy);
      if (j === null || j <= 0) return fail("tool.err.energy");
      j *= EU[eunit.value];
    }
    if (mode === "ke" || mode === "vel") {
      kg = num(mass);
      if (kg === null || kg <= 0) return fail("tool.err.mass");
      kg *= MU[munit.value];
    }
    if (mode === "ke" || mode === "mass") {
      ms = num(vel);
      if (ms === null) return fail("tool.err.vel");
      ms *= VU[vunit.value];
      if (ms < 0) { neg = true; ms = -ms; }   // 부호는 방향일 뿐 — v² 이라 결과는 같다
    }

    if (mode === "ke") {
      j = 0.5 * kg * ms * ms;
      labelKey = "tool.solve.ke";
      sub = sig(kg) + " kg \u00d7 (" + sig(ms) + " m/s)\u00b2 \u00f7 2";
    } else if (mode === "mass") {
      if (ms === 0) return fail("tool.err.velzero");
      kg = 2 * j / (ms * ms);
      labelKey = "tool.solve.mass";
      sub = sig(kg) + " kg \u00b7 " + sig(kg / MU.lb) + " lb";
    } else {
      ms = Math.sqrt(2 * j / kg);
      labelKey = "tool.solve.vel";
      sub = sig(ms) + " m/s \u00b7 " + sig(ms * 3.6) + " km/h \u00b7 " + sig(ms / VU.mph) + " mph";
    }

    var lbl = $("r-main-label");
    lbl.setAttribute("data-i18n", labelKey);
    lbl.textContent = t(labelKey);
    if (mode === "ke") $("r-main").textContent = energyText(j);
    else if (mode === "mass") $("r-main").textContent = sig(kg / MU[munit.value]) + " " + ULAB[munit.value];
    else $("r-main").textContent = sig(ms / VU[vunit.value]) + " " + ULAB[vunit.value];
    $("r-sub").textContent = sub;

    $("r-joules").textContent = sig(j) + " J";
    $("r-kwh").textContent = sig(j / 3600000) + " kWh";
    $("r-cal").textContent = sig(j / TNT_J) + " kcal";
    $("r-tnt").textContent = j >= TNT_J * 1000
      ? sig(j / (TNT_J * 1000)) + " kg"
      : sig(j / TNT_J) + " g";

    var best = ANCHORS[0], bestD = Infinity;
    for (var i = 0; i < ANCHORS.length; i++) {
      var d = Math.abs(Math.log(j / ANCHORS[i].j));
      if (d < bestD) { bestD = d; best = ANCHORS[i]; }
    }
    $("r-anchor").textContent = ratio(j / best.j) + "\u00d7 " + t(best.k);

    noteNeg.hidden = !neg;
    errEl.hidden = true;
    result.hidden = false;
  }

  syncRows();
  $("calc-btn").addEventListener("click", calc);
  [mass, vel, energy].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  solve.addEventListener("change", function () { syncRows(); if (!result.hidden || !errEl.hidden) calc(); });
  [munit, vunit, eunit].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
