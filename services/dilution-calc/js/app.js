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
  var solve = $("solve"), c1 = $("c1"), cunit = $("cunit"), c2 = $("c2");
  var v1 = $("v1"), v2 = $("v2"), vunit = $("vunit");
  var fc2 = $("f-c2"), fv1 = $("f-v1"), result = $("result"), errEl = $("err");
  if (!solve || !c1 || !c2 || !v1 || !v2) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  function num(el) { return parseFloat(String(el.value).replace(/,/g, "")); }

  // 실험실 값은 0.0001~1000 폭이 넓다 — 크기에 따라 유효자리를 바꾸고 꼬리 0 은 없앤다.
  function fmt(n) {
    if (!isFinite(n)) return "—";
    var a = Math.abs(n);
    var d = a >= 100 ? 1 : a >= 10 ? 2 : a >= 1 ? 3 : 4;
    var s = n.toFixed(d);
    if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s;
  }
  function fill(tpl, map) {
    var out = tpl;
    for (var k in map) { if (map.hasOwnProperty(k)) out = out.split("{" + k + "}").join(map[k]); }
    return out;
  }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function sync() {
    var solvingC2 = solve.value === "c2";
    fc2.hidden = solvingC2;   // C2 를 구하는 모드에서는 C2 입력이 아니라 V1 입력을 받는다
    fv1.hidden = !solvingC2;
  }

  function calc() {
    var mode = solve.value;
    var C1 = num(c1), V2 = num(v2);
    if (!isFinite(C1) || !isFinite(V2)) return fail("tool.err.empty");
    if (C1 <= 0) return fail("tool.err.c1");
    if (V2 <= 0) return fail("tool.err.v2");

    var C2, V1;
    if (mode === "c2") {
      V1 = num(v1);
      if (!isFinite(V1)) return fail("tool.err.empty");
      if (V1 <= 0) return fail("tool.err.v1");
      if (V1 > V2) return fail("tool.err.v1big");
      C2 = C1 * V1 / V2;
    } else {
      C2 = num(c2);
      if (!isFinite(C2)) return fail("tool.err.empty");
      if (C2 <= 0) return fail("tool.err.c2");
      if (C2 > C1) return fail("tool.err.upward");
      V1 = C2 * V2 / C1;
    }

    var diluent = V2 - V1, factor = C1 / C2;
    var vu = " " + vunit.value, cu = " " + cunit.value;
    var sV1 = fmt(V1) + vu, sDil = fmt(diluent) + vu, sFac = "1:" + fmt(factor), sC2 = fmt(C2) + cu;

    $("r-v1").textContent = sV1;
    $("r-diluent").textContent = sDil;
    $("r-factor").textContent = sFac;
    $("r-c2").textContent = sC2;
    $("r-hero-label").textContent = t(mode === "c2" ? "tool.r.c2" : mode === "factor" ? "tool.r.factor" : "tool.r.v1");
    $("r-hero").textContent = mode === "c2" ? sC2 : mode === "factor" ? sFac : sV1;

    var recipe = $("r-recipe");
    // 부동소수 오차로 1.0000000002 가 나오는 경우가 있어 여유를 둔다.
    if (factor <= 1.000001) recipe.textContent = t("tool.recipe.none");
    else recipe.textContent = fill(t("tool.recipe.fmt"), { stock: sV1, diluent: sDil, total: fmt(V2) + vu });

    var serial = $("r-serial");
    // 100배 이상을 한 번에 만들면 피펫 오차가 그대로 결과 오차 — 분할 권고.
    if (factor > 100) {
      serial.hidden = false;
      serial.textContent = fill(t("tool.serial.note"), { factor: fmt(factor) });
    } else {
      serial.hidden = true;
      serial.textContent = "";
    }

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [c1, c2, v1, v2].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  solve.addEventListener("change", function () { sync(); if (!result.hidden || !errEl.hidden) calc(); });
  [cunit, vunit].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  sync();
  // TOOLJS:END
})();
