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
  var cat = $("category"), sys = $("system"), size = $("size");
  var result = $("result"), errEl = $("err"), betweenEl = $("between"), kidsHint = $("kids-hint");
  if (!cat || !sys || !size) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // [US, UK, EU, 발 길이 cm] — 소매 표준 차트. cm 열이 유일한 물리량이고 나머지는 라벨이다.
  var CHART = {
    men: [
      [6, 5, 38.5, 24.0], [6.5, 5.5, 39, 24.5], [7, 6, 40, 25.0], [7.5, 6.5, 40.5, 25.5],
      [8, 7, 41, 26.0], [8.5, 7.5, 41.5, 26.5], [9, 8, 42, 27.0], [9.5, 8.5, 42.5, 27.5],
      [10, 9, 43, 28.0], [10.5, 9.5, 44, 28.5], [11, 10, 44.5, 29.0], [11.5, 10.5, 45, 29.5],
      [12, 11, 46, 30.0], [12.5, 11.5, 46.5, 30.5], [13, 12, 47, 31.0], [14, 13, 48, 32.0],
      [15, 14, 49, 33.0], [16, 15, 50, 34.0], [17, 16, 51, 35.0], [18, 17, 52, 36.0]
    ],
    women: [
      [4, 2, 34.5, 21.2], [4.5, 2.5, 35, 21.6], [5, 3, 35.5, 22.0], [5.5, 3.5, 36, 22.4], [6, 4, 36.5, 22.9], [6.5, 4.5, 37, 23.3],
      [7, 5, 37.5, 23.8], [7.5, 5.5, 38, 24.2], [8, 6, 38.5, 24.6], [8.5, 6.5, 39, 25.0],
      [9, 7, 40, 25.4], [9.5, 7.5, 40.5, 25.8], [10, 8, 41, 26.2], [10.5, 8.5, 41.5, 26.7],
      [11, 9, 42, 27.1], [11.5, 9.5, 42.5, 27.5], [12, 10, 43, 27.9],
      [12.5, 10.5, 43.5, 28.3], [13, 11, 44, 28.8]
    ],
    // 아동 US/UK 열은 13.5C 다음 1Y 로 되감긴다 — 그래서 단조 증가가 아니고, 탐색은 인접 행끼리만 한다.
    kids: [
      ["10.5C", 10, 28, 17.1], ["11C", 10.5, 28.5, 17.5], ["11.5C", 11, 29, 17.9],
      ["12C", 11.5, 30, 18.3], ["12.5C", 12, 30.5, 18.8], ["13C", 12.5, 31, 19.2],
      ["13.5C", 13, 31.5, 19.6], ["1Y", 13.5, 32, 20.0], ["1.5Y", 1, 32.5, 20.4],
      ["2Y", 1.5, 33.5, 20.8], ["2.5Y", 2, 34, 21.2], ["3Y", 2.5, 34.5, 21.6],
      ["3.5Y", 3, 35, 22.1], ["4Y", 3.5, 35.5, 22.5], ["4.5Y", 4, 36, 22.9],
      ["5Y", 4.5, 37, 23.3], ["5.5Y", 5, 37.5, 23.7], ["6Y", 5.5, 38, 24.1]
    ]
  };
  var COL = { us: 0, uk: 1, eu: 2, cm: 3 };
  // 행 간격이 0.4~0.5cm 이므로 이 값을 넘으면 어느 사이즈에도 얹히지 않는다는 뜻.
  var BETWEEN_CM = 0.15;

  function num(row, c) { return parseFloat(row[c]); }

  // 입력값을 cm 로 옮긴다. 정확히 맞는 행이 없으면 인접한 두 행 사이를 선형 보간한다.
  function toCm(rows, c, v) {
    var i, a, b;
    for (i = 0; i < rows.length; i++) if (Math.abs(num(rows[i], c) - v) < 1e-9) return rows[i][3];
    for (i = 0; i < rows.length - 1; i++) {
      a = num(rows[i], c); b = num(rows[i + 1], c);
      if (v > a && v < b) return rows[i][3] + (rows[i + 1][3] - rows[i][3]) * (v - a) / (b - a);
    }
    return null; // 차트 밖 (아동 되감김 구간 포함)
  }
  function nearest(rows, cm) {
    var best = rows[0], d = Math.abs(rows[0][3] - cm), i, dd;
    for (i = 1; i < rows.length; i++) {
      dd = Math.abs(rows[i][3] - cm);
      if (dd < d) { d = dd; best = rows[i]; }
    }
    return best;
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var raw = parseFloat(String(size.value).replace(/,/g, ""));
    if (!isFinite(raw)) return fail("tool.err.empty");

    var rows = CHART[cat.value] || CHART.men;
    // 인치로 잰 발 길이는 cm 로 옮겨 같은 열을 쓴다.
    var svs = sys.value === "in" ? "cm" : sys.value;
    var val = sys.value === "in" ? raw * 2.54 : raw;
    var cm = val > 0 ? toCm(rows, COL[svs], val) : null;
    if (cm === null) return fail("tool.err.range." + cat.value);

    var row = nearest(rows, cm);
    $("r-us").textContent = String(row[0]);
    $("r-uk").textContent = String(row[1]);
    $("r-eu").textContent = String(row[2]);
    $("r-len").textContent = row[3].toFixed(1) + " cm / " + (row[3] / 2.54).toFixed(1) + " in";
    betweenEl.hidden = Math.abs(row[3] - cm) <= BETWEEN_CM;

    errEl.hidden = true;
    result.hidden = false;
  }

  function syncHint() { kidsHint.hidden = cat.value !== "kids"; }

  $("calc-btn").addEventListener("click", calc);
  size.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  [cat, sys].forEach(function (el) {
    el.addEventListener("change", function () {
      syncHint();
      if (!result.hidden || !errEl.hidden) calc();
    });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  syncHint();
  // TOOLJS:END
})();
