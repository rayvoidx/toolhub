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
  var age = $("age"), rest = $("rest"), maxhr = $("maxhr"), method = $("method"), formula = $("formula");
  var result = $("result"), errEl = $("err");
  if (!age || !rest || !method) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { var v = parseFloat(String(el.value).replace(/,/g, "")); return isFinite(v) ? v : NaN; };

  var ZONES = [
    { key: "tool.z1", eff: "tool.e1", lo: 0.50, hi: 0.60 },
    { key: "tool.z2", eff: "tool.e2", lo: 0.60, hi: 0.70 },
    { key: "tool.z3", eff: "tool.e3", lo: 0.70, hi: 0.80 },
    { key: "tool.z4", eff: "tool.e4", lo: 0.80, hi: 0.90 },
    { key: "tool.z5", eff: "tool.e5", lo: 0.90, hi: 1.00 },
  ];

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var a = num(age), r = num(rest);
    if (isNaN(a) || isNaN(r)) return fail("tool.err.empty");
    if (a < 10 || a > 100) return fail("tool.err.age");
    if (r < 30 || r > 120) return fail("tool.err.rest");

    // 실측 최대심박이 있으면 그 값을 쓴다 — 추정식은 표준편차 10~12회짜리 거친 값이다.
    var raw = String(maxhr.value).trim();
    var known = num(maxhr);
    if (raw !== "" && (!isFinite(known) || known < 100 || known > 230 || known <= r)) return fail("tool.err.max");
    var est = (formula && formula.value === "tanaka") ? 208 - 0.7 * a : 220 - a;
    var hrMax = raw !== "" ? Math.round(known) : Math.round(est);
    var reserve = hrMax - r;
    if (reserve <= 0) return fail("tool.err.rest");

    $("r-max").textContent = hrMax + " bpm";
    $("r-reserve").textContent = reserve + " bpm";

    var useKarvonen = method.value === "karvonen";
    var body = $("zone-body");
    body.textContent = "";
    ZONES.forEach(function (z) {
      var lo = useKarvonen ? r + reserve * z.lo : hrMax * z.lo;
      var hi = useKarvonen ? r + reserve * z.hi : hrMax * z.hi;
      var tr = document.createElement("tr");
      var c1 = document.createElement("td"); c1.textContent = t(z.key);
      var c2 = document.createElement("td"); c2.className = "bpm"; c2.textContent = Math.round(lo) + "-" + Math.round(hi);
      var c3 = document.createElement("td"); c3.textContent = t(z.eff);
      tr.appendChild(c1); tr.appendChild(c2); tr.appendChild(c3);
      body.appendChild(tr);
    });

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [age, rest, maxhr].forEach(function (el) {
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [method, formula].forEach(function (el) {
    if (el) el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
