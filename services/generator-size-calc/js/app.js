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
  var custom = $("custom"), result = $("result"), errEl = $("err");
  if (!custom || !result) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 명판 기준 대표값. surge 는 모터 돌입(정격의 2~3배), 저항성 부하는 surge = run.
  var ITEMS = [
    { id: "i-fridge", key: "tool.item.fridge", run: 700, surge: 2200 },
    { id: "i-freezer", key: "tool.item.freezer", run: 500, surge: 1500 },
    { id: "i-sump", key: "tool.item.sump", run: 800, surge: 2000 },
    { id: "i-well", key: "tool.item.well", run: 1000, surge: 3000 },
    { id: "i-furnace", key: "tool.item.furnace", run: 800, surge: 2300 },
    { id: "i-winac", key: "tool.item.winac", run: 1200, surge: 3600 },
    { id: "i-centralac", key: "tool.item.centralac", run: 3500, surge: 8000 },
    { id: "i-lights", key: "tool.item.lights", run: 300, surge: 300 },
    { id: "i-tv", key: "tool.item.tv", run: 500, surge: 500 },
    { id: "i-micro", key: "tool.item.micro", run: 1000, surge: 1000 },
    { id: "i-ev", key: "tool.item.ev", run: 7200, surge: 7200 }
  ];
  // 시중에 실제로 파는 용량 계단. 이 위는 상시 설치형 영역이라 1kW 단위로 올림한다.
  var SIZES = [2200, 3500, 5500, 7500, 9500, 12000, 22000];

  function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function shortName(key) { return String(t(key)).split("—")[0].trim(); }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var extra = 0;
    var raw = String(custom.value).replace(/,/g, "").trim();
    if (raw !== "") {
      extra = parseFloat(raw);
      if (!isFinite(extra) || extra < 0 || extra > 100000) return fail("tool.err.custom");
    }

    var running = extra, maxDelta = 0, biggest = null;
    ITEMS.forEach(function (it) {
      var box = $(it.id);
      if (!box || !box.checked) return;
      running += it.run;
      var delta = it.surge - it.run;
      if (delta > maxDelta) { maxDelta = delta; biggest = it; }
    });
    if (running <= 0) return fail("tool.err.none");

    // 모터는 하나씩 기동한다고 본다 — 전체 상시 부하 + 가장 큰 서지 증분 하나.
    var peak = running + maxDelta;
    var hEl = $("headroom");
    var hPct = hEl ? parseFloat(hEl.value) : 10;
    if (!isFinite(hPct) || hPct < 0 || hPct > 100) hPct = 10;
    var need = peak * (1 + hPct / 100);
    var size = 0;
    for (var i = 0; i < SIZES.length; i++) { if (SIZES[i] >= need) { size = SIZES[i]; break; } }
    var over = size === 0;
    if (over) size = Math.ceil(need / 1000) * 1000;

    $("r-size").textContent = fmt(size) + " W";
    $("r-pick").textContent = over ? t("tool.pick.over") : t(size >= 12000 ? "tool.pick.standby" : "tool.pick.portable");
    $("r-running").textContent = fmt(running) + " W";
    $("r-peak").textContent = fmt(peak) + " W";
    $("r-headroom").textContent = "+" + Math.round((size / peak - 1) * 100) + "%";
    $("r-biggest").textContent = biggest
      ? t("tool.note.biggest") + ": " + shortName(biggest.key) + " (+" + fmt(maxDelta) + " W)"
      : "";

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  var headroomEl = $("headroom");
  if (headroomEl) headroomEl.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  custom.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  custom.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  ITEMS.forEach(function (it) {
    var box = $(it.id);
    if (box) box.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
