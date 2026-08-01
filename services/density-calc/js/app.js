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
  var solve = $("solve"), mass = $("mass"), munit = $("munit");
  var vol = $("vol"), vunit = $("vunit"), dens = $("dens"), dunit = $("dunit");
  var result = $("result"), errEl = $("err"), mainLabel = $("r-main-label");
  if (!solve || !mass || !vol || !dens || !dunit) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 전부 SI 기준(그램·세제곱센티미터)으로 정규화한 뒤 한 번만 나눈다 — 단위 조합마다 분기하지 않으려고.
  var M2G = { g: 1, kg: 1000, lb: 453.59237 };
  var V2CM3 = { ml: 1, l: 1000, cm3: 1, m3: 1000000, ft3: 28316.846592 };
  var LB_FT3 = 62.427960576; // 1 g/cm³
  var D2GCM3 = { gcm3: 1, kgm3: 0.001, lbft3: 1 / LB_FT3 };

  function fmt(n) {
    var a = Math.abs(n);
    var d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 4 : 6;
    var s = n.toFixed(d);
    if (s.indexOf(".") > -1) s = s.replace(/0+$/, "").replace(/\.$/, "");
    var p = s.split(".");
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return p.join(".");
  }
  function num(el) {
    var v = parseFloat(String(el.value).replace(/,/g, ""));
    return isFinite(v) ? v : NaN;
  }
  function unitText(el) { return el.options[el.selectedIndex].text; }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function sync() {
    var s = solve.value;
    $("mass-wrap").style.display = s === "mass" ? "none" : "";
    $("vol-wrap").style.display = s === "volume" ? "none" : "";
    $("dens-wrap").style.display = s === "density" ? "none" : "";
    $("row-mass").className = "field-row" + (s === "mass" ? " solo" : "");
    $("row-vol").className = "field-row" + (s === "volume" ? " solo" : "");
    $("row-dens").className = "field-row" + (s === "density" ? " solo" : "");
    var k = s === "mass" ? "tool.r.mass" : s === "volume" ? "tool.r.volume" : "tool.r.density";
    mainLabel.setAttribute("data-i18n", k);
    mainLabel.textContent = t(k);
  }

  function calc() {
    var s = solve.value, dGcm3, outVal, outUnit, overflowKey;

    if (s === "density") {
      var m = num(mass);
      if (!(m > 0)) return fail("tool.err.mass");
      var v = num(vol);
      if (v === 0) return fail("tool.err.zerovol");
      if (!(v > 0)) return fail("tool.err.vol");
      dGcm3 = (m * M2G[munit.value]) / (v * V2CM3[vunit.value]);
      outVal = dGcm3 / D2GCM3[dunit.value];
      outUnit = unitText(dunit);
      overflowKey = "tool.err.mass";
    } else if (s === "mass") {
      var dm = num(dens);
      if (!(dm > 0)) return fail("tool.err.dens");
      var vm = num(vol);
      if (vm === 0) return fail("tool.err.zerovol");
      if (!(vm > 0)) return fail("tool.err.vol");
      dGcm3 = dm * D2GCM3[dunit.value];
      outVal = (dGcm3 * vm * V2CM3[vunit.value]) / M2G[munit.value];
      outUnit = unitText(munit);
      overflowKey = "tool.err.vol";
    } else {
      var dv = num(dens);
      if (!(dv > 0)) return fail("tool.err.dens");
      var mv = num(mass);
      if (!(mv > 0)) return fail("tool.err.mass");
      dGcm3 = dv * D2GCM3[dunit.value];
      outVal = (mv * M2G[munit.value]) / dGcm3 / V2CM3[vunit.value];
      outUnit = unitText(vunit);
      overflowKey = "tool.err.mass";
    }

    // 1e308 급 입력이면 곱셈에서 Infinity 가 난다 — 조용히 Infinity 를 찍지 않는다.
    if (!isFinite(dGcm3) || !isFinite(outVal) || dGcm3 <= 0) return fail(overflowKey);

    $("r-main").textContent = fmt(outVal) + " " + outUnit;
    $("r-gcm3").textContent = fmt(dGcm3);
    $("r-kgm3").textContent = fmt(dGcm3 * 1000);
    $("r-lbft3").textContent = fmt(dGcm3 * LB_FT3);
    $("r-water").textContent = t(dGcm3 < 0.999 ? "tool.float.floats" : dGcm3 > 1.001 ? "tool.float.sinks" : "tool.float.neutral");

    errEl.hidden = true;
    result.hidden = false;
  }

  function live() { if (!result.hidden || !errEl.hidden) calc(); }

  sync();
  $("calc-btn").addEventListener("click", calc);
  [mass, vol, dens].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  solve.addEventListener("change", function () { sync(); live(); });
  [munit, vunit, dunit].forEach(function (el) { el.addEventListener("change", live); });
  document.addEventListener("i18n:change", function () { sync(); live(); });
  // TOOLJS:END
})();
