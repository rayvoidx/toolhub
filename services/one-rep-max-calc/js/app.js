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
  var weight = $("weight"), reps = $("reps"), unit = $("unit"), formula = $("formula");
  var rounding = $("rounding"), result = $("result"), errEl = $("err");
  if (!weight || !reps || !unit || !formula) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { var v = parseFloat(String(el.value).replace(/,/g, "")); return isFinite(v) ? v : NaN; };
  var round = function (n) { return Math.round(n * 10) / 10; };
  // 체육관에서 실제로 끼울 수 있는 원판 단위로 훈련 중량을 맞춘다 (0 = 반올림 안 함).
  var step = function (n) {
    var s = rounding ? parseFloat(rounding.value) : 0;
    return (isFinite(s) && s > 0) ? Math.round(n / s) * s : round(n);
  };

  // 반복이 늘수록 공식 간 차이가 벌어진다 — 하나만 쓰지 않고 범위를 함께 보여준다.
  var FORMULAS = {
    epley: function (w, r) { return w * (1 + r / 30); },
    brzycki: function (w, r) { return w * 36 / (37 - r); },
    lombardi: function (w, r) { return w * Math.pow(r, 0.10); },
    oconner: function (w, r) { return w * (1 + r / 40); },
    wathan: function (w, r) { return 100 * w / (48.8 + 53.8 * Math.exp(-0.075 * r)); },
  };
  var PCTS = [[100, "1"], [95, "2"], [90, "4"], [85, "6"], [80, "8"], [75, "10"], [70, "12"], [65, "15"]];

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var w = num(weight), r = num(reps);
    if (isNaN(w) || isNaN(r)) return fail("tool.err.empty");
    if (w <= 0) return fail("tool.err.positive");
    if (r < 1 || r > 12) return fail("tool.err.reps");

    var u = unit.value;
    var all = Object.keys(FORMULAS).map(function (k) { return FORMULAS[k](w, r); });
    var max = FORMULAS[formula.value](w, r);

    // 체육관 원판이 kg/lb 로 갈리므로 반대 단위 환산을 함께 보여준다.
    var twin = u === "kg" ? round(max * 2.20462) + " lb" : round(max / 2.20462) + " kg";
    $("r-max").textContent = round(max) + " " + u + " (" + twin + ")";
    $("r-spread").textContent = round(Math.min.apply(null, all)) + "-" + round(Math.max.apply(null, all)) + " " + u;

    var body = $("pct-body");
    body.textContent = "";
    PCTS.forEach(function (row) {
      var tr = document.createElement("tr");
      [row[0] + "%", step(max * row[0] / 100) + " " + u, row[1]].forEach(function (v) {
        var td = document.createElement("td"); td.textContent = v; tr.appendChild(td);
      });
      body.appendChild(tr);
    });

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [weight, reps].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [unit, formula, rounding].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!errEl.hidden) calc(); });
  // TOOLJS:END
})();
