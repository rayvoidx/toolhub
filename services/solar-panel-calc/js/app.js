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
  var usage = $("usage"), sun = $("sun"), sunc = $("sunc"), sunWrap = $("sun-custom-wrap");
  var panelw = $("panelw"), losses = $("losses");
  var result = $("result"), errEl = $("err"), warnEl = $("r-warn");
  if (!usage || !sun || !sunc || !panelw || !losses) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { return parseFloat(String(el.value).replace(/,/g, "")); };
  var group = function (n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); };

  // 패널 1장이 차지하는 지붕 면적 — 프레임·간격 포함한 업계 관행값(약 21 sq ft ≈ 1.95 m²).
  var SQFT_PER_PANEL = 21;

  function toggleCustom() { sunWrap.hidden = sun.value !== "custom"; }

  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function calc() {
    var kwhMonth = num(usage);
    if (!isFinite(kwhMonth)) return fail("tool.err.usage");
    if (kwhMonth <= 0) return fail("tool.err.zero");

    var sunHours = sun.value === "custom" ? num(sunc) : parseFloat(sun.value);
    if (!isFinite(sunHours) || sunHours < 1 || sunHours > 9) return fail("tool.err.sun");

    // 손실률은 비워두면 업계 표준 14%를 쓴다 — 조용히 0으로 떨어지면 발전량이 과대평가된다.
    var lossPct = String(losses.value).trim() === "" ? 14 : num(losses);
    if (!isFinite(lossPct) || lossPct < 0 || lossPct > 60) return fail("tool.err.loss");

    var derate = 1 - lossPct / 100;
    var dailyKwh = kwhMonth / 30;
    var neededKw = dailyKwh / (sunHours * derate);
    var watts = parseFloat(panelw.value);
    var panels = Math.ceil((neededKw * 1000) / watts);
    // 패널은 장 단위로만 살 수 있으므로 실제 설치 용량은 올림한 장수 기준이다.
    var installedKw = (panels * watts) / 1000;
    var annualKwh = installedKw * sunHours * 365 * derate;
    var sqft = panels * SQFT_PER_PANEL;
    var coverPct = Math.round((annualKwh / (kwhMonth * 12)) * 100);

    $("r-panels").textContent = group(panels);
    $("r-size").textContent = installedKw.toFixed(2) + " kW";
    $("r-roof").textContent = group(Math.round(sqft)) + " sq ft / " + group(Math.round(sqft * 0.0929)) + " m\u00B2";
    $("r-prod").textContent = group(Math.round(annualKwh)) + " kWh";
    $("r-cover").textContent = coverPct + "%";

    var high = kwhMonth > 5000;
    warnEl.hidden = !high;
    warnEl.textContent = high ? t("tool.note.high") : "";

    errEl.hidden = true;
    result.hidden = false;
  }

  toggleCustom();
  $("calc-btn").addEventListener("click", calc);
  [usage, sunc, losses].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  sun.addEventListener("change", toggleCustom);
  [sun, sunc, panelw, losses].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
