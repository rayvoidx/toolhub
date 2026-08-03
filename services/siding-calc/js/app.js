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
  var IDS = ["perim", "wallh", "gables", "gw", "gh", "doors", "windows", "corners"];
  var unit = $("unit"), waste = $("waste"), boxcov = $("boxcov"), result = $("result"), errEl = $("err");
  var els = {};
  for (var i = 0; i < IDS.length; i++) { els[IDS[i]] = $(IDS[i]); if (!els[IDS[i]]) return; }
  if (!unit || !waste || !boxcov || !result || !errEl) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 업계 관행 상수: 문 21ft², 창 15ft² 공제, 스퀘어 = 100ft², 비닐 사이딩 1스퀘어 = 2박스,
  // J채널은 문 둘레 17ft·창 둘레 14ft, 코너 포스트는 10ft 단위.
  var DOOR_SQFT = 21, WIN_SQFT = 15, J_DOOR = 17, J_WIN = 14, M_TO_FT = 3.28084;

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var v = {};
    for (var i = 0; i < IDS.length; i++) {
      var raw = String(els[IDS[i]].value).replace(/,/g, "").trim();
      if (raw === "") return fail("tool.err.empty");
      var n = parseFloat(raw);
      if (!isFinite(n)) return fail("tool.err.empty");
      v[IDS[i]] = n;
    }
    if (v.gables < 0 || v.doors < 0 || v.windows < 0 || v.corners < 0 || v.gw < 0 || v.gh < 0) return fail("tool.err.neg");
    if (v.perim <= 0 || v.wallh <= 0) return fail("tool.err.zero");

    // 빈칸이면 기존 기본값(스퀘어당 2박스 = 박스당 50ft²)을 그대로 쓴다.
    var covRaw = String(boxcov.value).replace(/,/g, "").trim();
    var cov = 50;
    if (covRaw !== "") {
      cov = parseFloat(covRaw);
      if (!isFinite(cov) || cov <= 0 || cov > 1000) return fail("tool.err.boxcov");
    }

    var f = unit.value === "m" ? M_TO_FT : 1;
    var perim = v.perim * f, wallh = v.wallh * f, gw = v.gw * f, gh = v.gh * f;
    var gables = Math.round(v.gables), doors = Math.round(v.doors);
    var windows = Math.round(v.windows), corners = Math.round(v.corners);

    if (gables > 0 && (gw <= 0 || gh <= 0)) return fail("tool.err.gable");
    if (perim > 3000 || wallh > 60 || gw > 300 || gh > 100 ||
        gables > 100 || doors > 300 || windows > 500 || corners > 200) return fail("tool.err.range");

    var gross = perim * wallh + gables * (gw * gh / 2);
    var net = gross - (doors * DOOR_SQFT + windows * WIN_SQFT);
    if (net <= 0) return fail("tool.err.openings");

    var squares = net * (1 + parseFloat(waste.value) / 100) / 100;
    // 박공 사선(레이크) 양쪽에 J채널이 들어간다 — 빗변 = sqrt((밑변/2)² + 높이²).
    var rake = gables > 0 ? 2 * Math.sqrt((gw / 2) * (gw / 2) + gh * gh) * gables : 0;

    $("r-squares").textContent = squares.toFixed(1);
    // 순 벽면적: 미터 입력이면 ㎡도 같이 보여준다.
    $("r-area").textContent = Math.round(net).toLocaleString() + " sq ft" +
      (unit.value === "m" ? " (" + (net / 10.7639).toFixed(1) + " m²)" : "");
    $("r-boxes").textContent = String(Math.ceil(squares * 100 / cov));
    $("r-starter").textContent = String(Math.ceil(perim));
    $("r-jchannel").textContent = String(Math.ceil(doors * J_DOOR + windows * J_WIN + rake));
    $("r-posts").textContent = String(corners * Math.ceil(wallh / 10));

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  var live = function () { if (!result.hidden || !errEl.hidden) calc(); };
  for (var k = 0; k < IDS.length; k++) {
    els[IDS[k]].addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    els[IDS[k]].addEventListener("change", live);
  }
  unit.addEventListener("change", live);
  waste.addEventListener("change", live);
  boxcov.addEventListener("change", live);
  boxcov.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  document.addEventListener("i18n:change", live);
  // TOOLJS:END
})();
