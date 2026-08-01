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
  var unitEl = $("unit"), lenEl = $("length"), spacingEl = $("spacing");
  var cornersEl = $("corners"), doorsEl = $("doors"), windowsEl = $("windows");
  var result = $("result"), errEl = $("err");
  if (!unitEl || !lenEl || !spacingEl) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var FT_PER_M = 3.280839895;
  var MAX_FT = 500;
  var WASTE = 1.10;
  var PLATE_RUNS = 3;            // 하부 1 + 상부 2 (더블 톱 플레이트)
  var STICK_FT = 8;              // 플레이트용 표준 8ft 자재
  var EPS = 1e-9;                // 288/16 = 18.0000000001 로 칸이 하나 늘지 않게

  var PER_CORNER = 3, PER_DOOR = 4, PER_WINDOW = 6;

  function num(el) { return parseFloat(String(el.value).replace(/,/g, "")); }
  function blank(el) { return !el || String(el.value).trim() === ""; }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  // 천단위 구분 — 정규식 없이(템플릿 리터럴 이스케이프 사고 방지)
  function grp(s) {
    var out = "", c = 0;
    for (var i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out;
      if (++c % 3 === 0 && i > 0) out = "," + out;
    }
    return out;
  }
  function fmt(n, d) {
    var s = n.toFixed(d || 0), p = s.split(".");
    return grp(p[0]) + (p[1] ? "." + p[1] : "");
  }

  // 개수 입력은 선택 — 빈칸이면 0, 음수·소수·문자는 NaN 으로 올려 명시적 에러
  function count(el) {
    if (blank(el)) return 0;
    var v = num(el);
    if (!isFinite(v) || v < 0 || Math.abs(v - Math.round(v)) > 1e-6) return NaN;
    return Math.round(v);
  }

  function syncUnits() {
    $("u-len").textContent = t(unitEl.value === "m" ? "tool.u.m" : "tool.u.ft");
  }

  function calc() {
    var len = num(lenEl);
    if (!isFinite(len)) return fail("tool.err.empty");
    if (len <= 0) return fail("tool.err.length");

    var metric = unitEl.value === "m";
    var lenFt = metric ? len * FT_PER_M : len;
    if (lenFt > MAX_FT) return fail("tool.err.range");

    var corners = count(cornersEl), doors = count(doorsEl), windows = count(windowsEl);
    if (isNaN(corners) || isNaN(doors) || isNaN(windows)) return fail("tool.err.count");

    var spacing = parseFloat(spacingEl.value) || 16;
    // 간격이 만드는 것은 칸 수 — 양 끝을 막으려면 스터드가 하나 더 필요하다
    var base = Math.ceil(lenFt * 12 / spacing - EPS) + 1;
    var extra = corners * PER_CORNER + doors * PER_DOOR + windows * PER_WINDOW;
    var studs = Math.ceil((base + extra) * WASTE - EPS);

    var plateFt = PLATE_RUNS * lenFt;
    var sticks = Math.ceil(plateFt / STICK_FT - EPS);

    $("r-base").textContent = fmt(base);
    $("r-extra").textContent = fmt(extra);
    $("r-studs").textContent = fmt(studs);
    var plateTxt = fmt(plateFt, 1) + " " + t("tool.u.ft");
    // 미터 입력이면 피트 값 옆에 원 단위도 같이 — 8ft 자재 규격은 그대로 유지
    if (metric) plateTxt += " (" + fmt(plateFt / FT_PER_M, 1) + " " + t("tool.u.m") + ")";
    $("r-plate").textContent = plateTxt;
    $("r-sticks").textContent = fmt(sticks);
    $("r-total").textContent = fmt(studs + sticks);

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [lenEl, cornersEl, doorsEl, windowsEl].forEach(function (el) {
    if (el) el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [unitEl, spacingEl].forEach(function (el) {
    if (el) el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  unitEl.addEventListener("change", syncUnits);
  document.addEventListener("i18n:change", function () {
    syncUnits();
    if (!result.hidden || !errEl.hidden) calc();
  });
  syncUnits();
  // TOOLJS:END
})();
