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
  var mode = $("mode"), initial = $("initial"), remaining = $("remaining");
  var halflife = $("halflife"), unit = $("unit"), elapsed = $("elapsed");
  var result = $("result"), errEl = $("err");
  if (!mode || !initial || !remaining || !halflife || !unit || !elapsed) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { return parseFloat(String(el.value).replace(/,/g, "")); };

  // 자릿수는 크기에 맞춘다 — 5730년도, 0.0003mg 도 같은 함수로 읽히게.
  function fmt(x) {
    if (!isFinite(x)) return "—";
    var a = Math.abs(x);
    if (a === 0) return "0";
    if (a < 0.0001 || a >= 1e9) return x.toExponential(2);
    var d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : 4;
    var v = parseFloat(x.toFixed(d));
    return a >= 1000 ? v.toLocaleString("en-US") : String(v);
  }

  // 모드마다 푸는 미지수가 다르니 그 칸만 감춘다 (남은 두 칸이 입력).
  function sync() {
    var m = mode.value;
    $("f-remaining").style.display = m === "remaining" ? "none" : "";
    $("f-halflife").style.display = m === "halflife" ? "none" : "";
    $("f-elapsed").style.display = m === "time" ? "none" : "";
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var m = mode.value;
    var n0 = num(initial);
    if (!isFinite(n0) || n0 <= 0) return fail("tool.err.initial");

    var n, T, el;
    if (m !== "remaining") {
      n = num(remaining);
      if (!isFinite(n) || n <= 0) return fail("tool.err.remaining");
      if (n >= n0) return fail("tool.err.order");
    }
    if (m !== "halflife") {
      T = num(halflife);
      if (!isFinite(T) || T <= 0) return fail("tool.err.halflife");
    }
    if (m !== "time") {
      el = num(elapsed);
      if (!isFinite(el) || el < 0) return fail("tool.err.elapsed");
      if (m === "halflife" && el === 0) return fail("tool.err.elapsedpos");
    }

    var u = t("tool.unit." + unit.value);
    var hl, heroKey, heroVal;
    if (m === "remaining") {
      hl = el / T;
      n = n0 * Math.pow(0.5, hl);
      heroKey = "tool.r.remaining"; heroVal = fmt(n);
    } else if (m === "time") {
      hl = Math.log(n0 / n) / Math.LN2;
      heroKey = "tool.r.time"; heroVal = fmt(T * hl) + " " + u;
    } else {
      hl = Math.log(n0 / n) / Math.LN2;
      heroKey = "tool.r.halflife"; heroVal = fmt(el / hl) + " " + u;
    }

    $("r-hero-label").textContent = t(heroKey);
    $("r-hero").textContent = heroVal;
    $("r-percent").textContent = fmt((n / n0) * 100) + "%";
    $("r-hl").textContent = fmt(hl);

    errEl.hidden = true;
    result.hidden = false;
  }

  sync();
  $("calc-btn").addEventListener("click", calc);
  [initial, remaining, halflife, elapsed].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  unit.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  mode.addEventListener("change", function () { sync(); if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
