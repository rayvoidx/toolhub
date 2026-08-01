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
  var unit = $("unit"), preset = $("preset"), len = $("len"), wid = $("wid"), depth = $("depth"), stype = $("stype");
  var result = $("result"), errEl = $("err"), notes = $("notes");
  if (!unit || !preset || !len || !wid || !depth || !stype) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 벌크 밀도(lb/yd³, 건조~약간 젖은 상태 기준). 폴리머 줄눈 모래는 부피가 아니라 포대로 파므로 안내를 따로 붙인다.
  var DENSITY = { masonry: 2700, play: 2400, poly: 2700 };
  var PRESET_IN = { paver: 1, level: 1, sandbox: 6 }; // custom 은 사용자 입력을 그대로 둔다

  function isMetric() { return unit.value === "m"; }
  function fmt(n, d) { return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }

  function unitLabels() {
    var m = isMetric();
    $("u-len").textContent = m ? "(m)" : "(ft)";
    $("u-wid").textContent = m ? "(m)" : "(ft)";
    $("u-depth").textContent = m ? "(cm)" : "(in)";
  }

  function applyPreset() {
    var d = PRESET_IN[preset.value];
    if (d == null) return;
    depth.value = isMetric() ? String(Math.round(d * 2.54 * 10) / 10) : String(d);
  }

  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function note(key) {
    var p = document.createElement("p");
    p.textContent = t(key);
    notes.appendChild(p);
  }

  function calc() {
    var m = isMetric();
    var l = parseFloat(len.value), w = parseFloat(wid.value), d = parseFloat(depth.value);
    if (!isFinite(l) || !isFinite(w) || !isFinite(d)) return fail("tool.err.empty");
    if (l <= 0 || w <= 0 || d <= 0) return fail("tool.err.zero");

    var lft = m ? l * 3.280839895 : l;
    var wft = m ? w * 3.280839895 : w;
    var din = m ? d / 2.54 : d;
    if (lft > 1000 || wft > 1000 || din > 48) return fail("tool.err.max");

    var cuft = lft * wft * (din / 12);
    var yd3 = cuft / 27;
    var lbs = yd3 * DENSITY[stype.value];
    var bags = Math.ceil(lbs / 50);
    var areaft = lft * wft;

    $("r-vol").textContent = fmt(yd3, yd3 < 10 ? 2 : 1) + " yd³";
    $("r-vol-sub").textContent = fmt(cuft, cuft < 100 ? 1 : 0) + " ft³ · " + fmt(cuft * 0.0283168, 2) + " m³";
    $("r-tons").textContent = fmt(lbs / 2000, 2);
    $("r-kg").textContent = fmt(lbs, 0) + " lb · " + fmt(lbs * 0.45359237, 0) + " kg";
    $("r-bags").textContent = fmt(bags, 0);
    $("r-area").textContent = fmt(areaft, areaft < 100 ? 1 : 0) + " ft²";
    $("r-area-sub").textContent = fmt(areaft * 0.09290304, 1) + " m²";

    while (notes.firstChild) notes.removeChild(notes.firstChild);
    // 깔모래는 1인치 스크리드가 상한 — 더 두꺼우면 침하로 바퀴 자국이 남는다.
    if (preset.value === "paver" && din > 1.5) note("tool.note.paver");
    if (stype.value === "poly") note("tool.note.poly");

    errEl.hidden = true;
    result.hidden = false;
  }

  unitLabels();
  applyPreset();

  $("calc-btn").addEventListener("click", calc);
  [len, wid, depth].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  preset.addEventListener("change", function () {
    applyPreset();
    if (!result.hidden || !errEl.hidden) calc();
  });
  unit.addEventListener("change", function () {
    unitLabels();
    applyPreset();
    if (!result.hidden || !errEl.hidden) calc();
  });
  stype.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
