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
  var unit = $("unit"), shape = $("shape"), fill = $("fill");
  var dia = $("dia"), len = $("len"), rl = $("rl"), rw = $("rw"), rh = $("rh");
  var result = $("result"), errEl = $("err");
  if (!unit || !shape || !dia || !rl || !fill) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var IN3_PER_GAL = 231;        // 1 US 갤런 = 231 in³ (정의값)
  var IN3_PER_IMPGAL = 277.4194327916;   // 1 영국 갤런 = 4.54609 L
  var LITER_PER_IN3 = 0.016387064;
  var IN3_PER_FT3 = 1728;
  var UNIT_TO_IN = { in: 1, cm: 1 / 2.54, ft: 12, m: 39.3700787401575 };

  function num(el) {
    var v = parseFloat(String(el.value).replace(/,/g, ""));
    return isFinite(v) ? v : NaN;
  }
  function fmt(n, d) {
    var p = n.toFixed(d).split(".");
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return p.join(".");
  }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  // 형태에 따라 쓰는 칸이 다르다. 세운 원통에서는 "길이"가 사실상 높이라 라벨도 바꾼다.
  function sync() {
    var isRect = shape.value === "rect";
    $("cyl-fields").hidden = isRect;
    $("rect-fields").hidden = !isRect;
    var k = shape.value === "vcyl" ? "tool.height.label" : "tool.len.label";
    var lab = $("len-label");
    lab.setAttribute("data-i18n", k);
    lab.textContent = t(k);
  }

  // 눕힌 원통의 부분 체적 = 원형 세그먼트 넓이 × 길이. 깊이-부피가 선형이 아닌 유일한 형태다.
  function segment(r, h, length) {
    var a = (r - h) / r;
    if (a > 1) a = 1; else if (a < -1) a = -1;   // 부동소수 오차로 acos 가 NaN 이 되는 것 방지
    var w = 2 * r * h - h * h;
    if (w < 0) w = 0;
    return length * (r * r * Math.acos(a) - (r - h) * Math.sqrt(w));
  }

  function calc() {
    var isRect = shape.value === "rect";
    var dims = isRect ? [num(rl), num(rw), num(rh)] : [num(dia), num(len)];
    var i;
    for (i = 0; i < dims.length; i++) if (isNaN(dims[i])) return fail("tool.err.empty");
    for (i = 0; i < dims.length; i++) if (dims[i] <= 0) return fail("tool.err.zero");

    var k = UNIT_TO_IN[unit.value] || 1;   // 내부 계산은 전부 인치³
    for (i = 0; i < dims.length; i++) {
      dims[i] = dims[i] * k;
      if (dims[i] > 5000) return fail("tool.err.range");
    }

    var full, maxDepth, r;
    if (isRect) {
      full = dims[0] * dims[1] * dims[2];
      maxDepth = dims[2];
    } else {
      r = dims[0] / 2;
      full = Math.PI * r * r * dims[1];
      maxDepth = shape.value === "vcyl" ? dims[1] : dims[0];
    }

    var partial = null;
    if (String(fill.value).trim() !== "") {
      var h = num(fill);
      if (isNaN(h)) return fail("tool.err.empty");
      if (h < 0) return fail("tool.err.zero");
      h = h * k;
      if (h > maxDepth * 1.0000001) return fail("tool.err.fill");
      if (h > maxDepth) h = maxDepth;
      if (isRect) partial = dims[0] * dims[1] * h;
      else if (shape.value === "vcyl") partial = Math.PI * r * r * h;
      else partial = segment(r, h, dims[1]);
    }

    var v = partial === null ? full : partial;
    var gal = v / IN3_PER_GAL;
    $("r-gal").textContent = fmt(gal, 1);
    $("r-impgal").textContent = fmt(v / IN3_PER_IMPGAL, 1);
    $("r-liters").textContent = fmt(v * LITER_PER_IN3, 1);
    $("r-ft3").textContent = fmt(v / IN3_PER_FT3, 2);
    var lbPerGal = parseFloat($("liquid").value);
    if (!isFinite(lbPerGal) || lbPerGal <= 0) lbPerGal = 8.34;
    $("r-weight").textContent = fmt(gal * lbPerGal, 0);

    $("c-pct").hidden = partial === null;
    $("c-cap").hidden = partial === null;
    if (partial !== null) {
      $("r-pct").textContent = fmt(partial / full * 100, 1) + "%";
      $("r-cap").textContent = fmt(full / IN3_PER_GAL, 1);
    }

    errEl.hidden = true;
    result.hidden = false;
  }

  function live() { if (!result.hidden || !errEl.hidden) calc(); }

  $("calc-btn").addEventListener("click", calc);
  [dia, len, rl, rw, rh, fill].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("change", live);
  });
  unit.addEventListener("change", live);
  $("liquid").addEventListener("change", live);
  shape.addEventListener("change", function () { sync(); live(); });
  document.addEventListener("i18n:change", function () { sync(); live(); });
  sync();
  // TOOLJS:END
})();
