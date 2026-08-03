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
  var miles = $("miles"), period = $("period"), rate = $("rate"), custom = $("custom-rate"), taxRate = $("tax-rate");
  var customRow = $("custom-row"), result = $("result"), errEl = $("err"), sanity = $("sanity");
  if (!miles || !period || !rate || !custom || !taxRate) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 2025 IRS standard mileage rates (Notice 2025-05). 회사 자체 요율은 custom 으로 받는다.
  var RATES = { irs: 0.70, medical: 0.21, charity: 0.14 };
  var MULT = { week: 52, month: 12, quarter: 4, year: 1 };
  var MONTHS = { week: 12 / 52, month: 1, quarter: 3, year: 12 };

  function money(n) {
    var s = Math.abs(n).toFixed(2).split(".");
    return "$" + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + s[1];
  }

  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function calc() {
    var m = parseFloat(String(miles.value).replace(/,/g, ""));
    if (!isFinite(m)) return fail("tool.err.empty");
    if (m <= 0) return fail("tool.err.zero");
    if (m >= 1000000) return fail("tool.err.range");

    var r;
    if (rate.value === "custom") {
      r = parseFloat(String(custom.value).replace(/[$,]/g, ""));
      if (!isFinite(r) || r < 0.01 || r > 5) return fail("tool.err.rate");
    } else {
      r = RATES[rate.value];
    }

    var tx = parseFloat(String(taxRate.value).replace(/%/g, ""));
    if (String(taxRate.value).trim() === "") tx = 22;
    if (!isFinite(tx) || tx < 0 || tx > 60) return fail("tool.err.tax");

    var p = MULT[period.value] ? period.value : "month";
    var total = m * r;

    $("r-total").textContent = money(total);
    $("r-rate").textContent = money(r) + " " + t("tool.permile");
    $("r-annual").textContent = money(total * MULT[p]);
    $("r-annual-sub").textContent = t("tool.annual." + p);
    // 22% 구간은 예시 — 공제 가능 여부와 실제 세율은 사람마다 다르다(문구로 명시).
    $("r-tax").textContent = money(total * tx / 100);
    $("r-tax-sub").textContent = "@ " + (Math.round(tx * 10) / 10) + "%";

    var perMonth = m / MONTHS[p];
    if (perMonth > 20000) {
      sanity.textContent = t("tool.note.sanity");
      sanity.hidden = false;
    } else {
      sanity.hidden = true;
    }

    errEl.hidden = true;
    result.hidden = false;
  }

  function syncCustom() { customRow.hidden = rate.value !== "custom"; }

  $("calc-btn").addEventListener("click", calc);
  [miles, custom, taxRate].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [period, rate, custom, taxRate].forEach(function (el) {
    el.addEventListener("change", function () {
      syncCustom();
      if (!result.hidden || !errEl.hidden) calc();
    });
  });
  syncCustom();
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
