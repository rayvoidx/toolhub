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
  var unit = $("unit"), mode = $("mode"), tilesize = $("tilesize"), waste = $("waste"), perbox = $("perbox");
  var result = $("result"), errEl = $("err");
  if (!unit || !mode || !tilesize || !waste) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (id) { var v = parseFloat(String($(id).value).replace(/,/g, "")); return isFinite(v) ? v : NaN; };
  var round2 = function (n) { return Math.round(n * 100) / 100; };

  // 프리셋은 인치/센티 두 벌을 들고 있다 — 단위 토글이 규격 표기 자체를 바꾸기 때문(30cm≠12in).
  var PRESETS = {
    "12x12": { in: [12, 12], cm: [30, 30] },
    "12x24": { in: [12, 24], cm: [30, 60] },
    "18x18": { in: [18, 18], cm: [45, 45] },
    "24x24": { in: [24, 24], cm: [60, 60] },
    "6x24": { in: [6, 24], cm: [15, 60] },
    "3x6": { in: [3, 6], cm: [7.5, 15] }
  };

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var ft = unit.value === "ft";
    var sq;

    if (mode.value === "area") {
      sq = num("area");
      if (isNaN(sq)) return fail("tool.err.empty");
      if (sq <= 0) return fail("tool.err.positive");
    } else {
      var len = num("len"), wid = num("wid");
      if (isNaN(len) || isNaN(wid)) return fail("tool.err.empty");
      if (len <= 0 || wid <= 0) return fail("tool.err.positive");
      sq = len * wid;
    }
    if (sq > 1000000) return fail("tool.err.range");

    var w, h;
    if (tilesize.value === "custom") {
      w = num("tilew"); h = num("tileh");
      if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) return fail("tool.err.tile");
    } else {
      var p = PRESETS[tilesize.value][ft ? "in" : "cm"];
      w = p[0]; h = p[1];
    }
    // 타일 한 장 면적을 바닥 면적과 같은 단위로 먼저 맞춘다 — 곱한 뒤 환산하면 144배/10000배 실수가 난다.
    var tileArea = ft ? (w * h) / 144 : (w * h) / 10000;
    if (!(tileArea > 0)) return fail("tool.err.tile");

    var pct = parseFloat(waste.value) || 0;
    var sqWithWaste = sq * (1 + pct / 100);
    // 타일이 방보다 커도 최소 한 장은 필요하다.
    var tiles = Math.max(1, Math.ceil(sqWithWaste / tileArea));

    var boxRaw = perbox ? String(perbox.value).trim() : "";
    if (boxRaw === "") {
      $("r-boxes").textContent = t("tool.r.boxesnone");
    } else {
      var per = Math.floor(num("perbox"));
      if (!(per >= 1)) return fail("tool.err.box");
      $("r-boxes").textContent = String(Math.ceil(tiles / per));
    }

    $("r-tiles").textContent = String(tiles);
    $("r-area").textContent = round2(sqWithWaste) + " " + t(ft ? "tool.u.sqft" : "tool.u.sqm");

    errEl.hidden = true;
    result.hidden = false;
  }

  function sync() {
    var byRoom = mode.value === "room";
    $("room-fields").hidden = !byRoom;
    $("area-fields").hidden = byRoom;
    $("custom-fields").hidden = tilesize.value !== "custom";
    $("unit-hint").textContent = t(unit.value === "ft" ? "tool.note.unitft" : "tool.note.unitm");
    if (!result.hidden || !errEl.hidden) calc();
  }

  $("calc-btn").addEventListener("click", calc);
  ["len", "wid", "area", "tilew", "tileh", "perbox"].forEach(function (id) {
    var el = $(id);
    if (el) el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [unit, mode, tilesize].forEach(function (el) { el.addEventListener("change", sync); });
  [waste, perbox].forEach(function (el) {
    if (el) el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", sync);
  sync();
  // TOOLJS:END
})();
