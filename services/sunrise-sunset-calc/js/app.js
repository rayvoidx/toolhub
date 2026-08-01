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
  var lat = $("lat"), lng = $("lng"), dateEl = $("date"), tz = $("tz");
  var result = $("result"), errEl = $("err"), deltaEl = $("delta"), polarEl = $("polar");
  if (!lat || !lng || !dateEl || !tz) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var lang = function () { return (window.I18N && window.I18N.lang) ? window.I18N.lang() : "en"; };
  var RAD = Math.PI / 180;

  // 날짜는 오늘, UTC 오프셋은 브라우저 값으로 시작한다 (사용자가 덮어쓸 수 있는 입력).
  (function init() {
    var now = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    if (!dateEl.value) dateEl.value = now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate());
    if (!tz.value) tz.value = String(Math.round(-now.getTimezoneOffset() / 60 * 100) / 100);
  })();

  // ── NOAA General Solar Position Calculations (저정밀판) ──
  // 고정밀 Meeus 구현과 비교 시 중위도에서 오차 1~2분. 지평선 굴절은 천정각 90.833도에 포함.
  function gamma(doy, hr) { return 2 * Math.PI / 365 * (doy - 1 + (hr - 12) / 24); }
  function eqTime(g) {
    return 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
      - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  }
  function decl(g) {
    return 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
      - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
      - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  }
  function dayOfYear(y, m, d) { return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1; }

  // 반환: {state:"ok", min: UTC 기준 분} | {state:"day"} 백야 | {state:"night"} 극야
  function event(doy, la, lo, zen, rise) {
    var hr = 12, mins = 0;
    for (var i = 0; i < 3; i++) { // 근사 시각으로 태양 파라미터를 한 번 더 갱신 — 고위도 정확도
      var g = gamma(doy, hr), et = eqTime(g), d = decl(g);
      var c = (Math.cos(zen * RAD) - Math.sin(la * RAD) * Math.sin(d)) / (Math.cos(la * RAD) * Math.cos(d));
      if (c > 1) return { state: "night" };
      if (c < -1) return { state: "day" };
      var ha = Math.acos(c) / RAD;
      mins = 720 - 4 * (lo + (rise ? ha : -ha)) - et;
      hr = mins / 60;
    }
    return { state: "ok", min: mins };
  }
  function solarNoon(doy, lo) { return 720 - 4 * lo - eqTime(gamma(doy, 12)); }

  function clock(utcMin, off) {
    var v = utcMin + off * 60, dayShift = Math.floor(v / 1440);
    v -= dayShift * 1440;
    var h = Math.floor(v / 60), m = Math.round(v - h * 60);
    if (m === 60) { m = 0; h += 1; }
    if (h >= 24) { h -= 24; dayShift += 1; }
    var s;
    try {
      s = new Intl.DateTimeFormat(lang(), { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
        .format(new Date(Date.UTC(2001, 0, 1, h, m)));
    } catch (e) { s = (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m; }
    if (dayShift < 0) s += " (" + t("tool.day.prev") + ")";
    if (dayShift > 0) s += " (" + t("tool.day.next") + ")";
    return s;
  }
  function dur(mins) {
    var m = Math.round(mins), h = Math.floor(m / 60);
    return h + " " + t("tool.unit.h") + " " + (m - h * 60) + " " + t("tool.unit.min");
  }
  function num(el) { return parseFloat(String(el.value).trim().replace(",", ".")); }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var la = num(lat);
    if (!isFinite(la) || la < -90 || la > 90) return fail("tool.err.lat");
    var lo = num(lng);
    if (!isFinite(lo) || lo < -180 || lo > 180) return fail("tool.err.lng");
    var dm = String(dateEl.value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dm) return fail("tool.err.date");
    var y = +dm[1], mo = +dm[2], da = +dm[3];
    if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || da < 1 || da > 31) return fail("tool.err.date");
    var off = num(tz);
    if (!isFinite(off) || off < -14 || off > 14) return fail("tool.err.tz");

    var doy = dayOfYear(y, mo, da);
    var sr = event(doy, la, lo, 90.833, true), ss = event(doy, la, lo, 90.833, false);
    var dawn = event(doy, la, lo, 96, true), dusk = event(doy, la, lo, 96, false);

    errEl.hidden = true;
    result.hidden = false;
    $("r-noon").textContent = clock(solarNoon(doy, lo), off);

    if (sr.state !== "ok" || ss.state !== "ok") { // 극야/백야 — 조용히 비우지 않고 문구로 알린다
      ["r-sunrise", "r-sunset", "r-length", "r-dawn", "r-dusk"].forEach(function (id) { $(id).textContent = "—"; });
      polarEl.hidden = false;
      polarEl.textContent = t(sr.state === "day" ? "tool.polar.day" : "tool.polar.night");
      deltaEl.hidden = true;
      return;
    }

    $("r-sunrise").textContent = clock(sr.min, off);
    $("r-sunset").textContent = clock(ss.min, off);
    $("r-length").textContent = dur(ss.min - sr.min);
    $("r-dawn").textContent = dawn.state === "ok" ? clock(dawn.min, off) : "—";
    $("r-dusk").textContent = dusk.state === "ok" ? clock(dusk.min, off) : "—";
    // 백야 직전 고위도: 해는 뜨고 지지만 시민박명이 밤새 이어진다
    polarEl.hidden = dawn.state === "ok" && dusk.state === "ok";
    if (!polarEl.hidden) polarEl.textContent = t("tool.twilight.none");

    var nd = new Date(Date.UTC(y, mo - 1, da + 1));
    var doy2 = dayOfYear(nd.getUTCFullYear(), nd.getUTCMonth() + 1, nd.getUTCDate());
    var sr2 = event(doy2, la, lo, 90.833, true), ss2 = event(doy2, la, lo, 90.833, false);
    if (sr2.state === "ok" && ss2.state === "ok") {
      var diff = Math.round((ss2.min - sr2.min) - (ss.min - sr.min));
      var txt = Math.abs(diff) + " " + t("tool.unit.min");
      deltaEl.hidden = false;
      deltaEl.textContent = diff === 0 ? t("tool.delta.same")
        : t(diff > 0 ? "tool.delta.longer" : "tool.delta.shorter").split("{m}").join(txt);
    } else { deltaEl.hidden = true; }
  }

  var geoBtn = $("geo-btn");
  if (geoBtn) {
    geoBtn.addEventListener("click", function () {
      if (!navigator.geolocation) return fail("tool.err.geo"); // 권한 거부·미지원 모두 같은 안내
      geoBtn.disabled = true;
      navigator.geolocation.getCurrentPosition(function (pos) {
        geoBtn.disabled = false;
        lat.value = Math.round(pos.coords.latitude * 10000) / 10000;
        lng.value = Math.round(pos.coords.longitude * 10000) / 10000;
        calc();
      }, function () { geoBtn.disabled = false; fail("tool.err.geo"); },
        { timeout: 10000, maximumAge: 600000 });
    });
  }

  $("calc-btn").addEventListener("click", calc);
  [lat, lng, tz].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [lat, lng, dateEl, tz].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
