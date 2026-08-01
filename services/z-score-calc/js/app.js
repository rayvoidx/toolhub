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
  var mode = $("mode"), xEl = $("x"), meanEl = $("mean"), sdEl = $("sd"), zEl = $("zin");
  var result = $("result"), errEl = $("err");
  if (!mode || !xEl || !meanEl || !sdEl || !zEl) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) {
    var v = parseFloat(String(el.value).replace(/,/g, ""));
    return isFinite(v) ? v : null;
  };

  // Abramowitz-Stegun 7.1.26 — 최대 오차 1.5e-7. 표시 자릿수(소수 4자리)에는 충분하다.
  function erf(v) {
    var sign = v < 0 ? -1 : 1, a = Math.abs(v);
    var u = 1 / (1 + 0.3275911 * a);
    var poly = ((((1.061405429 * u - 1.453152027) * u + 1.421413741) * u - 0.284496736) * u + 0.254829592) * u;
    return sign * (1 - poly * Math.exp(-a * a));
  }
  function cdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

  function fmt(n, d) {
    if (!isFinite(n)) return "—";
    var s = n.toFixed(d);
    if (s.indexOf(".") > -1) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s === "-0" ? "0" : s;
  }

  function sync() {
    var m = mode.value;
    $("wrap-x").hidden = m !== "z";
    $("wrap-z").hidden = m === "z";
    $("wrap-ms").hidden = m === "pct";
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var m = mode.value, z, x = null, mu = null, sd = null;

    if (m !== "pct") {
      mu = num(meanEl);
      if (mu === null) return fail("tool.err.mean");
      sd = num(sdEl);
      // 산포가 0이면 (x - 평균)/0 이 되어 z 가 정의되지 않는다 — 조용히 Infinity 를 내보내지 않는다.
      if (sd === null || sd <= 0) return fail("tool.err.sd");
    }
    if (m === "z") {
      x = num(xEl);
      if (x === null) return fail("tool.err.x");
      z = (x - mu) / sd;
    } else {
      z = num(zEl);
      if (z === null) return fail("tool.err.z");
      if (Math.abs(z) > 20) return fail("tool.err.range");
      if (m === "x") x = mu + z * sd;
    }
    if (!isFinite(z)) return fail("tool.err.range");

    var p = cdf(z) * 100;                       // 백분위 = 왼쪽 누적 확률
    var two = (1 - cdf(Math.abs(z))) * 200;     // 양측: 양쪽 꼬리 합
    var mid = Math.abs(p - 50);                 // 평균과 z 사이 면적

    $("r-z").textContent = fmt(z, 4);
    $("r-pct").textContent = fmt(p, 4) + "%";
    $("r-better").textContent = t("tool.r.better").replace("{p}", fmt(p, 2));
    $("r-two").textContent = fmt(two, 4) + "%";
    $("r-mid").textContent = fmt(mid, 4) + "%";
    $("r-x").textContent = x === null ? "—" : fmt(x, 4);

    var pos = Math.max(0, Math.min(100, ((z + 3) / 6) * 100));
    $("marker").style.left = pos + "%";
    $("bell").setAttribute("aria-label",
      t("tool.strip.aria").replace("{z}", fmt(z, 2)).replace("{p}", fmt(p, 2) + "%"));
    // |z| > 6 이면 남은 꼬리가 1e-9 미만이라 백분위가 0/100 으로 붙는다 — 그 사실을 문구로 밝힌다.
    $("clamp-note").hidden = Math.abs(z) <= 6;

    errEl.hidden = true;
    result.hidden = false;
  }

  sync();
  $("calc-btn").addEventListener("click", calc);
  [xEl, meanEl, sdEl, zEl].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("input", function () { if (!result.hidden) calc(); });
  });
  mode.addEventListener("change", function () {
    sync();
    if (!result.hidden || !errEl.hidden) calc();
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
