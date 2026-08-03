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
  var amount = $("amount"), fromY = $("from-year"), toY = $("to-year");
  var result = $("result"), errEl = $("err");
  if (!amount || !fromY || !toY) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // BLS CPI-U(도시 소비자, 1982-84=100) 연평균 — 1913부터 한 해도 빠짐없이. 2025는 잠정치.
  var BASE = 1913;
  var CPI = ("9.9 10.0 10.1 10.9 12.8 15.1 17.3 20.0 17.9 16.8 17.1 17.1 17.5 17.7 17.4 17.1 17.1 " +
    "16.7 15.2 13.7 13.0 13.4 13.7 13.9 14.4 14.1 13.9 14.0 14.7 16.3 17.3 17.6 18.0 19.5 22.3 24.1 " +
    "23.8 24.1 26.0 26.5 26.7 26.9 26.8 27.2 28.1 28.9 29.1 29.6 29.9 30.2 30.6 31.0 31.5 32.4 33.4 " +
    "34.8 36.7 38.8 40.5 41.8 44.4 49.3 53.8 56.9 60.6 65.2 72.6 82.4 90.9 96.5 99.6 103.9 107.6 " +
    "109.6 113.6 118.3 124.0 130.7 136.2 140.3 144.5 148.2 152.4 156.9 160.5 163.0 166.6 172.2 177.1 " +
    "179.9 184.0 188.9 195.3 201.6 207.3 215.3 214.5 218.1 224.9 229.6 233.0 236.7 237.0 240.0 245.1 " +
    "251.1 255.7 258.8 271.0 292.7 304.7 313.7 322.6").split(" ").map(Number);
  var LAST = BASE + CPI.length - 1;

  var money = function (n) {
    var d = Math.abs(n) < 1 ? 4 : 2;
    return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: d });
  };
  var pct = function (n, d) { return n.toFixed(d) + "%"; };

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var a = parseFloat(String(amount.value).replace(/[$,\s]/g, ""));
    if (!isFinite(a)) return fail("tool.err.amount");
    if (a <= 0) return fail("tool.err.positive");
    if (a >= 1e12) return fail("tool.err.max");

    var f = parseInt(String(fromY.value).replace(/[,\s]/g, ""), 10);
    var y = parseInt(String(toY.value).replace(/[,\s]/g, ""), 10);
    if (!isFinite(f) || !isFinite(y)) return fail("tool.err.year");
    if (f < BASE || f > LAST || y < BASE || y > LAST) return fail("tool.err.range");

    // 양방향 동일 공식: 금액 x (도착연도 지수 / 출발연도 지수). 역방향이면 비율<1 이라 자동으로 디플레이트된다.
    var ratio = CPI[y - BASE] / CPI[f - BASE];
    var adjusted = a * ratio;
    var span = Math.abs(y - f);
    // 같은 해면 지수 변화가 없다 — 0으로 나누지 않고 0%로 못 박는다.
    var annual = span === 0 ? 0 : (Math.pow(ratio, 1 / span) - 1) * 100;

    $("r-adjusted").textContent = money(adjusted);
    $("r-summary").textContent = t("tool.r.summary")
      .replace("{from}", money(a)).replace("{fy}", String(f))
      .replace("{to}", money(adjusted)).replace("{ty}", String(y));
    $("r-total").textContent = pct((ratio - 1) * 100, 1);
    $("r-annual").textContent = pct(annual, 2);

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [amount, fromY, toY].forEach(function (el) {
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
