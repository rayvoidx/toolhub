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
  var salary = $("salary"), freq = $("freq"), filing = $("filing"), k401 = $("k401"), stateEl = $("state");
  var result = $("result"), errEl = $("err");
  if (!salary || !freq || !filing || !k401 || !stateEl) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el, dflt) {
    var s = String(el.value).replace(/[$,\s]/g, "");
    if (s === "") return dflt;
    var v = parseFloat(s);
    return isFinite(v) ? v : NaN;
  };
  var money = function (n, dp) {
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  };

  // 2025 연방 세율표 — [상한, 세율]. 부부합산은 37% 구간(751,600)만 빼면 정확히 2배.
  var BRACKETS = {
    single: [[11925, 0.10], [48475, 0.12], [103350, 0.22], [197300, 0.24], [250525, 0.32], [626350, 0.35], [Infinity, 0.37]],
    married: [[23850, 0.10], [96950, 0.12], [206700, 0.22], [394600, 0.24], [501050, 0.32], [751600, 0.35], [Infinity, 0.37]]
  };
  var STD_DEDUCTION = { single: 15000, married: 30000 };
  var SS_RATE = 0.062, SS_WAGE_BASE = 176100;
  var MEDICARE_RATE = 0.0145, ADDL_MEDICARE_RATE = 0.009, ADDL_MEDICARE_FLOOR = 200000;

  function federalTax(taxable, status) {
    var rows = BRACKETS[status], tax = 0, prev = 0;
    for (var i = 0; i < rows.length; i++) {
      var cap = rows[i][0];
      if (taxable <= prev) break;
      tax += (Math.min(taxable, cap) - prev) * rows[i][1];
      prev = cap;
    }
    return tax;
  }
  function ficaTax(gross) {
    // FICA 는 401(k) 공제 전 총급여 기준 — 이연해도 줄지 않는다.
    var ss = Math.min(gross, SS_WAGE_BASE) * SS_RATE;
    var med = gross * MEDICARE_RATE + Math.max(0, gross - ADDL_MEDICARE_FLOOR) * ADDL_MEDICARE_RATE;
    return ss + med;
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var gross = num(salary, NaN);
    if (isNaN(gross) || gross <= 0) return fail("tool.err.salary");
    var pct401 = num(k401, 0);
    if (isNaN(pct401) || pct401 < 0 || pct401 > 50) return fail("tool.err.k401");
    var pctState = num(stateEl, 0);
    if (isNaN(pctState) || pctState < 0 || pctState > 20) return fail("tool.err.state");

    var status = filing.value === "married" ? "married" : "single";
    var periods = parseFloat(freq.value) || 26;

    var contrib = gross * pct401 / 100;
    var taxable = Math.max(0, gross - contrib - STD_DEDUCTION[status]);
    var fed = federalTax(taxable, status);
    var fica = ficaTax(gross);
    var st = taxable * pctState / 100;
    var totalTax = fed + fica + st;
    var netAnnual = gross - totalTax - contrib;

    $("r-net").textContent = money(netAnnual / periods, 2);
    $("r-annual").textContent = money(netAnnual, 0);
    $("r-rate").textContent = (totalTax / gross * 100).toFixed(1) + "%";
    $("r-fed").textContent = money(fed, 0);
    $("r-fica").textContent = money(fica, 0);
    $("r-state").textContent = money(st, 0);
    $("r-401k").textContent = money(contrib, 0);

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [salary, k401, stateEl].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [freq, filing].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
