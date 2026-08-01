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
  var unit = $("unit"), len = $("len"), wid = $("wid"), spacing = $("spacing");
  var pattern = $("pattern"), edge = $("edge");
  var result = $("result"), errEl = $("err"), noteTri = $("note-tri"), noteTight = $("note-tight");
  if (!unit || !len || !wid || !spacing || !pattern || !edge) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var sub = function (k, map) {
    return t(k).replace(/\{(\w+)\}/g, function (m, name) {
      return map[name] === undefined ? m : String(map[name]);
    });
  };
  var num = function (el) { return parseFloat(String(el.value).replace(/,/g, "")); };
  var r2 = function (n) { return String(Math.round(n * 100) / 100); };

  var IN_PER_UNIT = { ft: 12, m: 39.3701 };   // 화단 치수 → 인치
  var IN_PER_SP = { ft: 1, m: 1 / 2.54 };     // 간격 입력(인치/cm) → 인치
  var TRI = 0.8660254;                        // √3/2 — 엇갈린 줄 간격 계수
  var EPS = 1e-9;                             // 108/12 이 8.999… 로 떨어지는 부동소수 보정

  // 한 방향에 들어가는 포기 수. 가장자리 옵션이면 양끝에 간격의 절반씩(=간격 하나)을 뺀다.
  function fit(span, step, gap) {
    var usable = span - (gap ? step : 0);
    if (usable < 0) return 1;
    return Math.floor(usable / step + EPS) + 1;
  }

  function labelUnits() {
    var m = unit.value === "m";
    var bed = m ? "tool.abbr.m" : "tool.abbr.ft";
    var sp = m ? "tool.abbr.cm" : "tool.abbr.in";
    [["len-unit", bed], ["wid-unit", bed], ["sp-unit", sp]].forEach(function (pair) {
      var el = $(pair[0]);
      if (!el) return;
      el.setAttribute("data-i18n", pair[1]);
      el.textContent = t(pair[1]);
    });
  }

  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function calc() {
    var l = num(len), w = num(wid), s = num(spacing);
    if (!isFinite(l) || !isFinite(w) || !isFinite(s)) return fail("tool.err.empty");
    if (l <= 0 || w <= 0 || s <= 0) return fail("tool.err.positive");
    if (l > 10000 || w > 10000 || s > 10000) return fail("tool.err.range");

    var u = unit.value === "m" ? "m" : "ft";
    var lIn = l * IN_PER_UNIT[u], wIn = w * IN_PER_UNIT[u];
    var sIn = s * IN_PER_SP[u];
    if (lIn / sIn > 20000 || wIn / sIn > 20000) return fail("tool.err.range");

    var gap = edge.checked, tri = pattern.value === "tri";
    var total, layout, rows, cols;

    if (!tri) {
      cols = fit(lIn, sIn, gap);
      rows = fit(wIn, sIn, gap);
      total = cols * rows;
      layout = sub("tool.layout.sq", { c: cols, r: rows });
    } else {
      var rowStep = sIn * TRI;
      rows = fit(wIn, rowStep, gap);
      var usableL = lIn - (gap ? sIn : 0);
      cols = fit(lIn, sIn, gap);                                        // 홀수 줄
      var off = Math.max(1, Math.floor((usableL - sIn / 2) / sIn + EPS) + 1); // 짝수 줄(반 칸 밀림)
      total = Math.ceil(rows / 2) * cols + Math.floor(rows / 2) * off;
      layout = cols === off
        ? sub("tool.layout.trieven", { r: rows, a: cols })
        : sub("tool.layout.tri", { r: rows, a: cols, b: off });
      noteTri.textContent = sub("tool.note.tri", { v: r2(rowStep) + " " + t("tool.abbr.in") + " · " + r2(rowStep * 2.54) + " " + t("tool.abbr.cm") });
    }
    noteTri.hidden = !tri;

    var sqft = u === "ft" ? l * w : l * w * 10.7639;
    var sqm = u === "m" ? l * w : l * w * 0.092903;

    $("r-plants").textContent = String(total).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    $("r-layout").textContent = layout;
    $("r-density").textContent = r2(total / sqft) + " " + t("tool.dens.sqft") + " · " + r2(total / sqm) + " " + t("tool.dens.sqm");
    $("r-spacing").textContent = r2(sIn) + " " + t("tool.abbr.in") + " · " + r2(sIn * 2.54) + " " + t("tool.abbr.cm");

    // 간격이 화단보다 넓으면 그 방향은 한 포기로 끝난다 — 조용히 넘기지 않고 알려준다.
    noteTight.textContent = t("tool.note.tight");
    noteTight.hidden = !(sIn > lIn || sIn > wIn);

    errEl.hidden = true;
    result.hidden = false;
  }

  labelUnits();
  $("calc-btn").addEventListener("click", calc);
  [len, wid, spacing].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [unit, pattern, edge].forEach(function (el) {
    el.addEventListener("change", function () {
      labelUnits();
      if (!result.hidden || !errEl.hidden) calc();
    });
  });
  document.addEventListener("i18n:change", function () {
    labelUnits();
    if (!result.hidden || !errEl.hidden) calc();
  });
  // TOOLJS:END
})();
