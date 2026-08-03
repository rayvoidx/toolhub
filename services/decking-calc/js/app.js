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
  var unit = $("unit"), dlen = $("dlen"), dwid = $("dwid"), board = $("board");
  var cw = $("cw"), cl = $("cl"), customRow = $("custom-row"), gap = $("gap"), waste = $("waste"), jspace = $("jspace");
  var result = $("result"), errEl = $("err");
  if (!unit || !dlen || !dwid || !board || !gap || !waste) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 보드 폭(인치) x 길이(피트). 북미 유통 규격 — 2x6 실치수 5.5in, 2x4 실치수 3.5in.
  var BOARDS = {
    w55x12: [5.5, 12], w55x16: [5.5, 16],
    w35x12: [3.5, 12], w35x16: [3.5, 16],
    c55x16: [5.5, 16], c55x20: [5.5, 20]
  };
  var M_TO_FT = 3.280839895;

  function num(el) { return parseFloat(String(el.value).replace(/,/g, "")); }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }
  function round1(n) { return n >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10); }

  function syncCustom() { if (customRow) customRow.hidden = board.value !== "custom"; }

  function calc() {
    var l = num(dlen), w = num(dwid);
    if (!isFinite(l) || !isFinite(w)) return fail("tool.err.empty");
    if (l <= 0 || w <= 0) return fail("tool.err.zero");

    var metric = unit.value === "m";
    var lenFt = metric ? l * M_TO_FT : l;
    var widFt = metric ? w * M_TO_FT : w;
    if (lenFt > 200 || widFt > 200) return fail("tool.err.range");

    var bw, bl;
    if (board.value === "custom") {
      bw = cw ? num(cw) : NaN;
      bl = cl ? num(cl) : NaN;
      // 커스텀은 조용히 기본값으로 떨어뜨리지 않는다 — 값이 없거나 비현실적이면 명시적으로 알린다.
      if (!isFinite(bw) || !isFinite(bl) || bw <= 0 || bl <= 0 || bw > 24 || bl > 40) return fail("tool.err.board");
    } else {
      var b = BOARDS[board.value] || BOARDS.w55x12;
      bw = b[0]; bl = b[1];
    }

    var gapIn = parseFloat(gap.value) || 0;
    var wastePct = parseFloat(waste.value) || 0;

    var rows = Math.ceil((widFt * 12) / (bw + gapIn));
    var perRow = Math.ceil(lenFt / bl);
    var total = Math.ceil(rows * perRow * (1 + wastePct / 100));

    var areaFt = lenFt * widFt;
    var sp = (jspace && parseFloat(jspace.value)) || 16;
    // 16in OC 면판 시공 기준 100 sq ft 당 350개(장선 교차마다 보드 1장에 2개). 간격이 좁으면 교차가 늘어 비례 증가.
    var screws = Math.ceil((areaFt * 3.5 * (16 / sp)) / 10) * 10;
    var joists = Math.ceil((lenFt * 12) / sp) + 1;

    $("r-boards").textContent = String(total);
    $("r-screws").textContent = String(screws);
    $("r-joists").textContent = String(joists);
    $("r-area").textContent = metric
      ? round1(l * w) + " " + t("tool.u.sqm")
      : round1(areaFt) + " " + t("tool.u.sqft");
    $("r-rows").textContent = rows + " x " + perRow;

    errEl.hidden = true;
    result.hidden = false;
  }

  function live() { if (!result.hidden || !errEl.hidden) calc(); }

  syncCustom();
  $("calc-btn").addEventListener("click", calc);
  [dlen, dwid, cw, cl].forEach(function (el) {
    if (!el) return;
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("input", live);
  });
  board.addEventListener("change", function () { syncCustom(); live(); });
  [unit, gap, waste, jspace].forEach(function (el) { if (el) el.addEventListener("change", live); });
  document.addEventListener("i18n:change", live);
  // TOOLJS:END
})();
