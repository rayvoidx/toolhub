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
  var unit = $("unit"), shape = $("shape"), depthmode = $("depthmode");
  var len = $("len"), wid = $("wid"), dia = $("dia");
  var depth = $("depth"), shallow = $("shallow"), deep = $("deep");
  var freefactor = $("freefactor");
  var result = $("result"), errEl = $("err");
  if (!unit || !shape || !depthmode || !len) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var GAL_PER_FT3 = 7.48052, L_PER_FT3 = 28.316846592, M3_PER_FT3 = 0.028316846592;
  var FT_PER_M = 3.280839895;

  function num(el) {
    var v = parseFloat(String(el.value).replace(/,/g, ""));
    return isFinite(v) ? v : NaN;
  }
  function fmt(n, d) { return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  // 형태·수심 모드에 따라 필요한 입력만 남기고, 길이 단위 표기(ft/m)를 라벨에 반영한다.
  function syncFields() {
    var isRound = shape.value === "round";
    $("g-lw").hidden = isRound;
    $("g-dia").hidden = !isRound;
    $("g-factor").hidden = shape.value !== "free";
    var sloped = depthmode.value === "slope";
    $("g-const").hidden = sloped;
    $("g-slope").hidden = !sloped;
    var label = unit.value === "m" ? "m" : "ft";
    var spans = document.querySelectorAll("#tool .u");
    for (var i = 0; i < spans.length; i++) spans[i].textContent = label;
  }

  function calc() {
    var toFt = unit.value === "m" ? FT_PER_M : 1;
    var isRound = shape.value === "round";
    var a = isRound ? num(dia) : num(len);
    var b = isRound ? a : num(wid);
    var sloped = depthmode.value === "slope";
    var d1 = sloped ? num(shallow) : num(depth);
    var d2 = sloped ? num(deep) : d1;

    if (!isFinite(a) || !isFinite(b) || !isFinite(d1) || !isFinite(d2)) return fail("tool.err.empty");
    if (a <= 0 || b <= 0 || d1 <= 0 || d2 <= 0) return fail("tool.err.zero");
    if (sloped && d2 < d1) return fail("tool.err.deep");
    var limit = unit.value === "m" ? 150 : 500;
    if (a > limit || b > limit || d1 > limit || d2 > limit) return fail("tool.err.range");
    // 자유형은 외접 직사각형 대비 잔여 비율을 직접 조정할 수 있다(기본 90%).
    var factor = 0.9;
    if (shape.value === "free") {
      var fp = num(freefactor);
      if (!isFinite(fp) || fp < 50 || fp > 100) return fail("tool.err.factor");
      factor = fp / 100;
    }

    // 일정 경사 바닥은 평균 수심이 정확값이다(깊은 쪽에서 늘어난 쐐기 = 얕은 쪽에서 줄어든 쐐기).
    var avgD = (d1 + d2) / 2;
    // 수면 면적: 직사각형은 L×W, 원형·타원형은 π/4 × 장축 × 단축(원은 두 축이 지름으로 동일).
    // 자유형·콩팥형은 외접 직사각형에서 10% 뺀 현장 추정치(가이드 본문과 동일 규칙).
    var aFt = a * toFt, bFt = b * toFt;
    var areaFt2 = shape.value === "rect" ? aFt * bFt
      : shape.value === "free" ? aFt * bFt * factor
      : Math.PI / 4 * aFt * bFt;
    var ft3 = areaFt2 * avgD * toFt;

    $("r-gal").textContent = fmt(Math.round(ft3 * GAL_PER_FT3), 0);
    $("r-lit").textContent = fmt(Math.round(ft3 * L_PER_FT3), 0);
    $("r-ft3").textContent = fmt(Math.round(ft3), 0);
    $("r-m3").textContent = fmt(ft3 * M3_PER_FT3, 1);
    $("r-avg").textContent = fmt(avgD, 1) + (unit.value === "m" ? " m" : " ft");
    // 수위 1인치당 갤런 = 수면 면적(ft²) × 1/12 ft × 7.48052
    $("r-inch").textContent = fmt(Math.round(areaFt2 * GAL_PER_FT3 / 12), 0);

    errEl.hidden = true;
    result.hidden = false;
  }

  var live = function () { if (!result.hidden || !errEl.hidden) calc(); };

  $("calc-btn").addEventListener("click", calc);
  [len, wid, dia, depth, shallow, deep, freefactor].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [unit, shape, depthmode].forEach(function (el) {
    el.addEventListener("change", function () { syncFields(); live(); });
  });
  document.addEventListener("i18n:change", function () { syncFields(); live(); });
  syncFields();
  // TOOLJS:END
})();
