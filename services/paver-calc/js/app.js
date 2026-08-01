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
  var unit = $("unit"), len = $("len"), wid = $("wid"), paver = $("paver");
  var pw = $("pw"), pl = $("pl"), waste = $("waste"), price = $("price");
  var result = $("result"), errEl = $("err"), customRow = $("custom-row"), costCard = $("cost-card");
  if (!unit || !len || !wid || !paver || !waste || !price) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var FT_PER_M = 3.280839895, IN_PER_CM = 0.3937007874, M3_PER_YD3 = 0.764554858;
  var GRAVEL_IN = 4, SAND_IN = 1;

  function num(el) { return parseFloat(String(el.value).replace(/,/g, "")); }
  function grp(s) { var p = s.split("."); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ","); return p.join("."); }
  function fmt(v, dp) {
    if (typeof dp === "number") return grp(v.toFixed(dp));
    var s = v >= 100 ? v.toFixed(0) : (v >= 10 ? v.toFixed(1) : v.toFixed(2));
    if (s.indexOf(".") > -1) s = s.replace(/\.?0+$/, "");
    return grp(s);
  }

  // 단위 접미사는 선택한 단위계에 따라 키가 갈리므로 data-i18n 이 아니라 JS 가 채운다.
  function setUnits() {
    var m = unit.value === "m";
    $("u-len").textContent = t(m ? "tool.u.m" : "tool.u.ft");
    $("u-wid").textContent = t(m ? "tool.u.m" : "tool.u.ft");
    $("u-pw").textContent = t(m ? "tool.u.cm" : "tool.u.in");
    $("u-pl").textContent = t(m ? "tool.u.cm" : "tool.u.in");
  }
  function syncCustom() { customRow.hidden = paver.value !== "custom"; }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var l = num(len), w = num(wid);
    if (!isFinite(l) || !isFinite(w)) return fail("tool.err.empty");
    if (l <= 0 || w <= 0) return fail("tool.err.zero");

    var metric = unit.value === "m";
    var lFt = metric ? l * FT_PER_M : l, wFt = metric ? w * FT_PER_M : w;
    if (lFt > 500 || wFt > 500) return fail("tool.err.range");

    var pwIn, plIn;
    if (paver.value === "custom") {
      var a = num(pw), b = num(pl);
      if (!isFinite(a) || !isFinite(b) || a <= 0 || b <= 0) return fail("tool.err.paver");
      pwIn = metric ? a * IN_PER_CM : a;
      plIn = metric ? b * IN_PER_CM : b;
      if (pwIn > 48 || plIn > 48) return fail("tool.err.paver");
    } else {
      var parts = paver.value.split("x");
      pwIn = parseFloat(parts[0]); plIn = parseFloat(parts[1]);
    }

    var priced = String(price.value).trim() !== "";
    var unitPrice = priced ? num(price) : 0;
    if (priced && (!isFinite(unitPrice) || unitPrice < 0)) return fail("tool.err.price");

    // 면적은 전부 ft² 로 맞춘 뒤 in² 로 올려 블록 한 장 면적으로 나눈다 — 규격이 인치라서.
    var areaFt2 = lFt * wFt;
    var wasteMul = 1 + parseFloat(waste.value) / 100;
    var pavers = Math.max(1, Math.ceil(areaFt2 * 144 / (pwIn * plIn) * wasteMul));
    var gravelYd3 = areaFt2 * (GRAVEL_IN / 12) / 27;
    var sandYd3 = areaFt2 * (SAND_IN / 12) / 27;

    var vol = function (yd3) {
      return metric ? fmt(yd3 * M3_PER_YD3) + " m³ · " + fmt(yd3) + " yd³" : fmt(yd3) + " yd³";
    };
    $("r-pavers").textContent = grp(String(pavers));
    $("r-area").textContent = metric ? fmt(l * w) + " m²" : fmt(areaFt2) + " ft²";
    $("r-gravel").textContent = vol(gravelYd3);
    $("r-sand").textContent = vol(sandYd3);
    $("r-cost").textContent = priced ? fmt(pavers * unitPrice, 2) : "—";
    costCard.hidden = !priced;

    errEl.hidden = true;
    result.hidden = false;
  }

  setUnits();
  syncCustom();
  $("calc-btn").addEventListener("click", calc);
  [len, wid, pw, pl, price].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  unit.addEventListener("change", function () { setUnits(); if (!result.hidden || !errEl.hidden) calc(); });
  paver.addEventListener("change", function () { syncCustom(); if (!result.hidden || !errEl.hidden) calc(); });
  waste.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { setUnits(); if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
