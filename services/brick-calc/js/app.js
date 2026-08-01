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
  var unit = $("unit"), wallL = $("wall-l"), wallH = $("wall-h"), brick = $("brick");
  var brickL = $("brick-l"), brickH = $("brick-h"), customRow = $("custom-row");
  var joint = $("joint"), waste = $("waste"), openings = $("openings");
  var result = $("result"), errEl = $("err");
  if (!unit || !wallL || !wallH || !brick || !joint) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var SQFT_PER_SQM = 10.7639104;
  // 실제(공칭 아님) 벽돌 치수, 인치. UK 215x65mm 는 인치로 환산해 한 축에서 계산한다.
  var BRICKS = { modular: [7.625, 2.25], queen: [7.625, 2.75], uk: [215 / 25.4, 65 / 25.4] };
  var BRICKS_PER_BAG = 40; // 60lb 몰탈 1포대 ≈ 벽돌 40장 (현장 관행치, note 에 명시)

  function num(el) {
    var raw = String(el.value).replace(/,/g, "").trim();
    return raw === "" ? NaN : parseFloat(raw);
  }
  function fmt(n, d) {
    var s = (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d);
    var p = s.split(".");
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return p.join(".");
  }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }
  function syncCustom() { customRow.hidden = brick.value !== "custom"; }

  function calc() {
    var len = num(wallL), hgt = num(wallH);
    if (!isFinite(len) || !isFinite(hgt)) return fail("tool.err.empty");
    if (len <= 0 || hgt <= 0) return fail("tool.err.zero");
    var metric = unit.value === "m";
    if (len > (metric ? 300 : 1000) || hgt > (metric ? 300 : 1000)) return fail("tool.err.big");

    var dims = BRICKS[brick.value];
    if (!dims) {
      var cl = num(brickL), ch = num(brickH);
      if (!isFinite(cl) || !isFinite(ch) || cl <= 0 || ch <= 0) return fail("tool.err.brick");
      dims = [cl, ch];
    }
    var j = parseFloat(joint.value);
    // 벽돌 한 장이 실제로 덮는 면 = (길이+줄눈) x (높이+줄눈). 줄눈이 커질수록 장수는 줄어든다.
    var faceIn2 = (dims[0] + j) * (dims[1] + j);
    var perSqFt = 144 / faceIn2;

    var wallArea = len * hgt;                        // 입력 단위 그대로 (ft² 또는 m²)
    var open = String(openings.value).trim() === "" ? 0 : num(openings);
    if (!isFinite(open) || open < 0 || open >= wallArea) return fail("tool.err.openings");

    var netArea = wallArea - open;
    var netSqFt = metric ? netArea * SQFT_PER_SQM : netArea;
    var bricks = Math.ceil(netSqFt * perSqFt * (1 + parseFloat(waste.value) / 100));

    $("r-bricks").textContent = fmt(bricks, 0);
    $("r-mortar").textContent = fmt(Math.ceil(bricks / BRICKS_PER_BAG), 0);
    $("r-area").textContent = metric ? fmt(netArea, 2) + " m²" : fmt(netArea, 1) + " ft²";
    $("r-density").textContent = fmt(perSqFt, 2) + "/ft² · " + fmt(perSqFt * SQFT_PER_SQM, 1) + "/m²";
    // 치수 표기는 입력 문맥을 따른다 — 미터 단위나 UK 벽돌이면 mm, 그 외는 인치.
    $("r-face").textContent = (metric || brick.value === "uk")
      ? fmt((dims[0] + j) * 25.4, 0) + " × " + fmt((dims[1] + j) * 25.4, 0) + " mm"
      : fmt(dims[0] + j, 2) + " × " + fmt(dims[1] + j, 2) + " in";

    errEl.hidden = true;
    result.hidden = false;
  }

  var live = function () { if (!result.hidden || !errEl.hidden) calc(); };
  syncCustom();
  $("calc-btn").addEventListener("click", calc);
  [wallL, wallH, brickL, brickH, openings].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  brick.addEventListener("change", function () { syncCustom(); live(); });
  [unit, joint, waste].forEach(function (el) { el.addEventListener("change", live); });
  document.addEventListener("i18n:change", live);
  // TOOLJS:END
})();
