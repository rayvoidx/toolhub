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
  var unit = $("unit"), thick = $("thick");
  var len = $("len"), wid = $("wid"), tcustom = $("tcustom"), density = $("density"), price = $("price"), waste = $("waste");
  var result = $("result"), errEl = $("err"), warnEl = $("warn"), coverEl = $("r-cover");
  if (!unit || !thick || !len || !wid) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 프리셋 두께는 단위계마다 현장에서 부르는 숫자가 다르다 — 2in 을 5.08cm 로 보여주면 아무도 안 쓴다.
  var PRESET_CM = { "2": 5, "3": 7.5, "4": 10 };
  var DEF_LB_FT3 = 145, DEF_KG_M3 = 2322;   // 다짐된 가열 아스팔트 표준 밀도
  var LB_PER_TON = 2000, KG_PER_TONNE = 1000;
  var MIN_IN = 1.5;                          // 이보다 얇으면 롤러 전에 식어 다짐이 안 된다

  function num(el) { return el ? parseFloat(String(el.value).replace(/,/g, "")) : NaN; }
  function blank(el) { return !el || String(el.value).trim() === ""; }
  function fmt(n, d) {
    var p = n.toFixed(d).split(".");
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return p.join(".");
  }
  function fail(key) {
    result.hidden = true;
    errEl.hidden = false; errEl.textContent = t(key);
  }

  function sync() {
    var ft = unit.value === "ft";
    $("f-custom").hidden = thick.value !== "custom";
    var lu = t(ft ? "tool.u.ft" : "tool.u.m");
    $("u-len").textContent = lu; $("u-wid").textContent = lu;
    $("u-thick").textContent = t(ft ? "tool.u.in" : "tool.u.cm");
    $("u-density").textContent = t(ft ? "tool.u.lbft3" : "tool.u.kgm3");
  }

  function calc() {
    sync();
    var ft = unit.value === "ft";

    var l = num(len), w = num(wid);
    if (!isFinite(l) || !isFinite(w)) return fail("tool.err.empty");
    if (l <= 0 || w <= 0) return fail("tool.err.zero");
    if (l > 100000 || w > 100000) return fail("tool.err.range");

    var tv;
    if (thick.value === "custom") {
      tv = num(tcustom);
      if (!isFinite(tv) || tv <= 0) return fail("tool.err.thickness");
      if (tv > (ft ? 36 : 90)) return fail("tool.err.range");
    } else {
      tv = ft ? parseFloat(thick.value) : PRESET_CM[thick.value];
    }

    var d;
    if (blank(density)) {
      d = ft ? DEF_LB_FT3 : DEF_KG_M3;
    } else {
      d = num(density);
      // 단위를 헷갈려 145 를 kg/m3 칸에 넣는 실수가 흔하다 — 조용히 계산하지 말고 막는다.
      if (!isFinite(d)) return fail("tool.err.density");
      if (ft ? (d < 80 || d > 200) : (d < 1200 || d > 3200)) return fail("tool.err.density");
    }

    var p = null;
    if (!blank(price)) {
      p = num(price);
      if (!isFinite(p) || p < 0) return fail("tool.err.price");
    }

    // 노트에서 "5~10% 더하라"고 안내만 하고 계산은 안 해주던 부분 — 발주량은 여유율 포함이 실제 주문 단위다.
    var wpct = 0;
    if (!blank(waste)) {
      wpct = num(waste);
      if (!isFinite(wpct) || wpct < 0 || wpct > 50) return fail("tool.err.waste");
    }

    var area = l * w, vol, tons, volTxt, areaTxt, coverTxt;
    if (ft) {
      vol = area * (tv / 12);                    // cu ft
      tons = vol * d / LB_PER_TON;               // US short tons
      volTxt = fmt(vol / 27, 2) + " " + t("tool.u.yd3");
      areaTxt = fmt(area, 0) + " " + t("tool.u.sqft");
      coverTxt = t("tool.r.cover.ton").replace("{a}", fmt(area / tons, 0) + " " + t("tool.u.sqft"));
    } else {
      vol = area * (tv / 100);                   // m3
      tons = vol * d / KG_PER_TONNE;             // metric tonnes
      volTxt = fmt(vol, 2) + " " + t("tool.u.m3");
      areaTxt = fmt(area, 1) + " " + t("tool.u.sqm");
      coverTxt = t("tool.r.cover.tonne").replace("{a}", fmt(area / tons, 1) + " " + t("tool.u.sqm"));
    }

    $("r-tons").textContent = fmt(tons, 1) + " " + t(ft ? "tool.u.tons" : "tool.u.tonnes");
    $("r-volume").textContent = volTxt;
    $("r-area").textContent = areaTxt;
    coverEl.textContent = coverTxt;

    var orderTons = tons * (1 + wpct / 100);
    if (wpct > 0) {
      $("c-order").hidden = false;
      $("r-order").textContent = fmt(orderTons, 1) + " " + t(ft ? "tool.u.tons" : "tool.u.tonnes");
    } else {
      $("c-order").hidden = true; $("r-order").textContent = "—";
    }

    if (p === null) {
      $("c-cost").hidden = true; $("r-cost").textContent = "—";
    } else {
      $("c-cost").hidden = false; $("r-cost").textContent = fmt(orderTons * p, 2);
    }

    var inches = ft ? tv : tv / 2.54;
    if (inches < MIN_IN) { warnEl.hidden = false; warnEl.textContent = t("tool.warn.thin"); }
    else { warnEl.hidden = true; warnEl.textContent = ""; }

    errEl.hidden = true;
    result.hidden = false;
  }

  function recalc() { if (!result.hidden || !errEl.hidden) calc(); else sync(); }

  sync();
  $("calc-btn").addEventListener("click", calc);
  [len, wid, tcustom, density, price, waste].forEach(function (el) {
    if (!el) return;
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("input", recalc);
  });
  [unit, thick].forEach(function (el) { el.addEventListener("change", recalc); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); else sync(); });
  // TOOLJS:END
})();
