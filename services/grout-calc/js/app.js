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
  var area = $("area"), unit = $("unit"), tsize = $("tsize"), cw = $("cw"), cl = $("cl");
  var thick = $("thick"), joint = $("joint"), customRow = $("custom-row");
  var result = $("result"), errEl = $("err");
  if (!area || !unit || !tsize || !thick || !joint) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var SIZES = { "12x12": [12, 12], "12x24": [12, 24], "18x18": [18, 18], "24x24": [24, 24], "3x6": [3, 6] };
  var SQFT_PER_SQM = 10.7639;
  var LB_PER_FT3 = 120;   // 건조 시멘트계 그라우트 벌크 밀도
  var WASTE = 1.1;        // 배합 손실·줄눈 다짐 여유 10%

  function num(el) {
    var v = parseFloat(String(el.value).replace(/,/g, ""));
    return isFinite(v) ? v : NaN;
  }
  function fmt(n) {
    if (n >= 100) return String(Math.round(n));
    if (n >= 10) return n.toFixed(1);
    return n.toFixed(2);
  }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function syncCustom() { customRow.hidden = tsize.value !== "custom"; }

  function calc() {
    var a = num(area);
    if (isNaN(a)) return fail("tool.err.empty");
    if (a <= 0) return fail("tool.err.zero");
    var sqft = unit.value === "m" ? a * SQFT_PER_SQM : a;
    if (sqft > 100000) return fail("tool.err.range");

    var w, l;
    if (tsize.value === "custom") {
      w = num(cw); l = num(cl);
      if (isNaN(w) || isNaN(l)) return fail("tool.err.custom");
      if (w < 0.5 || l < 0.5 || w > 120 || l > 120) return fail("tool.err.customrange");
    } else {
      var s = SIZES[tsize.value] || SIZES["12x12"];
      w = s[0]; l = s[1];
    }

    var j = parseFloat(joint.value), d = parseFloat(thick.value);
    // 타일 한 장이 차지하는 면적당 줄눈 부피: (W+L)/(W*L) * 줄눈폭 * 깊이 → in³/in².
    // in³/in² × 144 in²/ft² ÷ 1728 in³/ft³ = ÷12 → ft³ per ft².
    var perIn = ((w + l) / (w * l)) * j * d * WASTE;
    var lbPerSqft = (perIn / 12) * LB_PER_FT3;
    var lb = lbPerSqft * sqft;
    var coverSqft = 10 / lbPerSqft;

    $("r-total").textContent = fmt(lb) + " lb (" + fmt(lb * 0.45359) + " kg)";
    $("r-b10").textContent = String(Math.ceil(lb / 10));
    $("r-b25").textContent = String(Math.ceil(lb / 25));
    $("r-cover").textContent = unit.value === "m"
      ? fmt(coverSqft / SQFT_PER_SQM) + " m²"
      : fmt(coverSqft) + " ft²";
    $("r-type").textContent = t(j >= 0.125 ? "tool.type.sanded" : "tool.type.unsanded");

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [area, cw, cl].forEach(function (el) {
    if (el) el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  tsize.addEventListener("change", syncCustom);
  [unit, tsize, thick, joint].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  syncCustom();
  // TOOLJS:END
})();
