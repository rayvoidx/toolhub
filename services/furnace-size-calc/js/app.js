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
  var area = $("area"), unit = $("unit"), zone = $("zone"), insul = $("insul"), ceilSel = $("ceil");
  var result = $("result"), errEl = $("err"), noteBig = $("note-big");
  if (!area || !unit || !zone || !insul || !ceilSel) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var SQFT_PER_SQM = 10.7639;
  var AFUE = 0.95;                       // 응축식 기준. 제품 라벨은 입력 BTU 라서 output 을 이 값으로 나눈다.
  var COMMON = [40000, 60000, 80000, 100000, 120000];
  var MAX_SQFT = 20000, MANUAL_J_SQFT = 6000;

  function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var raw = parseFloat(String(area.value).replace(/,/g, ""));
    if (!isFinite(raw)) return fail("tool.err.empty");
    var sqft = unit.value === "m" ? raw * SQFT_PER_SQM : raw;
    if (sqft <= 0 || sqft > MAX_SQFT) return fail("tool.err.range");

    var factor = parseFloat(zone.value) * parseFloat(insul.value) * parseFloat(ceilSel.value);
    var load = sqft * factor;            // 실내로 실제 공급돼야 하는 열량(output)
    var input = load / AFUE;             // 그걸 내려면 태워야 하는 열량(input, 카탈로그 표기값)

    // 표준 용량은 부하보다 작으면 안 되므로 올림으로 고른다. 120k 를 넘으면 단일기로 커버 불가.
    var size = null;
    for (var i = 0; i < COMMON.length; i++) { if (COMMON[i] >= input) { size = COMMON[i]; break; } }

    var perUnit = unit.value === "m" ? factor * SQFT_PER_SQM : factor;
    $("r-load").textContent = fmt(load) + " " + t("tool.btuh");
    $("r-input").textContent = fmt(input) + " " + t("tool.btuh");
    $("r-size").textContent = size ? fmt(size) + " " + t("tool.btuh") : t("tool.size.over");
    $("r-factor").textContent = (Math.round(perUnit * 10) / 10) + " " + t(unit.value === "m" ? "tool.perm" : "tool.perft");
    noteBig.hidden = sqft <= MANUAL_J_SQFT;

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  area.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  [unit, zone, insul, ceilSel].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
