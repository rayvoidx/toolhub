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
  var unitEl = $("unit"), lenEl = $("length"), spacingEl = $("spacing"), railsEl = $("rails");
  var gatesEl = $("gates"), gateWEl = $("gate-width");
  var usePick = $("use-pickets"), pwEl = $("picket-width"), gapEl = $("picket-gap");
  var cPostEl = $("cost-post"), cRailEl = $("cost-rail"), cPickEl = $("cost-picket");
  var result = $("result"), errEl = $("err");
  if (!unitEl || !lenEl || !spacingEl || !railsEl) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var FT_PER_M = 3.280839895;
  var MAX_FT = 5000;
  var EPS = 1e-9;               // 148.000000001 / 8 같은 부동소수 찌꺼기로 구간이 하나 더 늘지 않게

  function num(el) { return parseFloat(String(el.value).replace(/,/g, "")); }
  function blank(el) { return !el || String(el.value).trim() === ""; }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  // 천단위 구분 — 정규식 없이(템플릿 리터럴 이스케이프 사고 방지)
  function grp(s) {
    var out = "", c = 0;
    for (var i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out;
      if (++c % 3 === 0 && i > 0) out = "," + out;
    }
    return out;
  }
  function fmt(n, d) {
    var s = n.toFixed(d || 0), p = s.split(".");
    return grp(p[0]) + (p[1] ? "." + p[1] : "");
  }

  function syncUnits() {
    var m = unitEl.value === "m";
    var big = t(m ? "tool.u.m" : "tool.u.ft"), small = t(m ? "tool.u.cm" : "tool.u.in");
    $("u-len").textContent = big;
    $("u-gate").textContent = big;
    $("u-pw").textContent = small;
    $("u-gap").textContent = small;
  }
  function syncPickets() { $("picket-fields").hidden = !usePick.checked; }

  // 단가는 셋 다 선택 입력 — 빈칸은 0으로 보되, 하나도 없으면 비용 카드를 감춘다.
  function price(el) {
    if (blank(el)) return null;
    var v = num(el);
    return (!isFinite(v) || v < 0) ? NaN : v;
  }

  function calc() {
    var len = num(lenEl);
    if (!isFinite(len)) return fail("tool.err.empty");
    if (len <= 0) return fail("tool.err.length");

    var metric = unitEl.value === "m";
    var lenFt = metric ? len * FT_PER_M : len;
    if (lenFt > MAX_FT) return fail("tool.err.range");

    var gates = blank(gatesEl) ? 0 : num(gatesEl);
    if (!isFinite(gates) || gates < 0) return fail("tool.err.count");
    gates = Math.round(gates);

    var gw = 0;
    if (gates > 0) {
      if (blank(gateWEl)) return fail("tool.err.gatew");
      gw = num(gateWEl);
      if (!isFinite(gw) || gw < 0) return fail("tool.err.count");
    }
    var netFt = lenFt - gates * (metric ? gw * FT_PER_M : gw);
    if (netFt <= 0) return fail("tool.err.gate");

    var spacing = parseFloat(spacingEl.value) || 8;
    var sections = Math.ceil(netFt / spacing - EPS);
    var posts = sections + 1 + 2 * gates;      // 게이트마다 힌지·래치 기둥 한 쌍이 따로 선다
    var railsPer = parseInt(railsEl.value, 10) || 2;
    var rails = sections * railsPer;

    var pickets = 0, wantPickets = !!(usePick && usePick.checked);
    if (wantPickets) {
      var pw = num(pwEl), gap = blank(gapEl) ? 0 : num(gapEl);
      if (!isFinite(pw) || !isFinite(gap) || pw < 0 || gap < 0) return fail("tool.err.picket");
      if (pw + gap <= 0) return fail("tool.err.picket");
      // 판재 폭·간격은 작은 단위(in 또는 cm)로 받으므로 순 길이를 같은 단위로 환산해 나눈다
      var netSmall = (metric ? netFt / FT_PER_M : netFt) * (metric ? 100 : 12);
      pickets = Math.ceil(netSmall / (pw + gap) - EPS);
    }

    var cPost = price(cPostEl), cRail = price(cRailEl), cPick = price(cPickEl);
    if (isNaN(cPost) || isNaN(cRail) || isNaN(cPick)) return fail("tool.err.cost");
    var priced = cPost !== null || cRail !== null || cPick !== null;
    var total = posts * (cPost || 0) + rails * (cRail || 0) + pickets * (cPick || 0);

    $("r-posts").textContent = fmt(posts);
    $("r-rails").textContent = fmt(rails);
    $("r-sections").textContent = fmt(sections);
    $("r-pickets").textContent = wantPickets ? fmt(pickets) : "—";
    $("picket-card").hidden = !wantPickets;
    $("r-cost").textContent = priced ? fmt(total, 2) : "—";
    $("cost-card").hidden = !priced;

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [lenEl, gatesEl, gateWEl, pwEl, gapEl, cPostEl, cRailEl, cPickEl].forEach(function (el) {
    if (el) el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [unitEl, spacingEl, railsEl].forEach(function (el) {
    if (el) el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  if (usePick) usePick.addEventListener("change", function () {
    syncPickets();
    if (!result.hidden || !errEl.hidden) calc();
  });
  unitEl.addEventListener("change", syncUnits);
  document.addEventListener("i18n:change", function () {
    syncUnits();
    if (!result.hidden || !errEl.hidden) calc();
  });
  syncUnits();
  syncPickets();
  // TOOLJS:END
})();
