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
  var unit = $("unit"), wallL = $("wall-l"), wallH = $("wall-h"), block = $("block");
  var blockW = $("block-w"), blockH = $("block-h"), customRow = $("custom-row");
  var useCap = $("use-cap"), useBack = $("use-backfill");
  var backW = $("back-w"), backRow = $("backfill-row");
  var waste = $("waste"), price = $("price"), costCard = $("cost-card");
  var result = $("result"), errEl = $("err"), warnEl = $("warn");
  if (!unit || !wallL || !wallH || !block) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var FT_PER_M = 3.2808399;
  var YD3_TO_M3 = 0.764554858;
  // 블록 전면 치수(인치). 12x4 는 북미 조경용 표준, 16x6 은 대형 블록.
  var BLOCKS = { std: [12, 4], big: [16, 6] };
  var BACKFILL_FT = 1;   // 벽 뒤 배수 자갈 기본 폭 12in (사용자 재정의 가능)
  var BASE_EXTRA_IN = 8; // 기초 자갈 폭 = 블록 폭 + 8in (앞뒤 4in 여유)
  var BASE_DEPTH_FT = 0.5;

  function num(el) {
    var raw = String(el.value).replace(/,/g, "").trim();
    return raw === "" ? NaN : parseFloat(raw);
  }
  function fmt(n, d) {
    var s = (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d);
    var p = s.split(".");
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return p.join(".");
  }
  function vol(yd3, metric) {
    return metric ? fmt(yd3 * YD3_TO_M3, 2) + " m³" : fmt(yd3, 2) + " yd³";
  }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }
  function syncCustom() { customRow.hidden = block.value !== "custom"; }
  function syncBackfill() { if (backRow) backRow.hidden = !(useBack && useBack.checked); }
  function syncUnits() {
    var u = unit.value === "m" ? "m" : "ft";
    $("u-len").textContent = u;
    $("u-hgt").textContent = u;
  }

  function calc() {
    var len = num(wallL), hgt = num(wallH);
    if (!isFinite(len) || !isFinite(hgt)) return fail("tool.err.empty");
    if (len <= 0 || hgt <= 0) return fail("tool.err.zero");
    var metric = unit.value === "m";
    if (len > (metric ? 150 : 500) || hgt > (metric ? 6 : 20)) return fail("tool.err.big");

    var dims = BLOCKS[block.value];
    if (!dims) {
      var cw = num(blockW), ch = num(blockH);
      if (!isFinite(cw) || !isFinite(ch) || cw <= 0 || ch <= 0 || cw > 96 || ch > 96) return fail("tool.err.block");
      dims = [cw, ch];
    }

    var lenFt = metric ? len * FT_PER_M : len;
    var hgtFt = metric ? hgt * FT_PER_M : hgt;

    // 노출 높이만큼의 단수 + 지중 매설 1단. 매설단이 앞쪽 흙을 눌러 밑동 밀림을 막는다.
    var rows = Math.ceil((hgtFt * 12) / dims[1]) + 1;
    var perRow = Math.ceil((lenFt * 12) / dims[0]);
    var wallBlocks = rows * perRow;
    var caps = useCap && useCap.checked ? perRow : 0;

    // 여유율: 곡선·절단·파손분. 기본 0% 라 기존 결과는 그대로.
    var wpct = waste ? parseFloat(waste.value) || 0 : 0;
    // 부동소수 오차로 200*1.1 이 221 이 되는 것을 막는다.
    var up = function (n) { return Math.ceil(n * (1 + wpct / 100) - 1e-9); };
    if (wpct > 0) {
      wallBlocks = up(wallBlocks);
      if (caps) caps = up(caps);
    }

    // 블록 단가(선택). 비워두면 카드 자체를 숨긴다 — 통화는 사용자 것 그대로.
    var costCell = costCard;
    var pv = price ? num(price) : NaN;
    if (price && String(price.value).trim() !== "") {
      if (!isFinite(pv) || pv < 0) return fail("tool.err.price");
      $("r-cost").textContent = fmt((wallBlocks + caps) * pv, 2);
      if (costCell) costCell.hidden = false;
    } else if (costCell) {
      costCell.hidden = true;
    }

    var baseYd3 = (lenFt * ((dims[0] + BASE_EXTRA_IN) / 12) * BASE_DEPTH_FT) / 27;
    // 배수 구간 폭: 기본 12in. 비워두면 기본값 그대로라 기존 결과는 변하지 않는다.
    var backFt = BACKFILL_FT;
    if (backW && String(backW.value).trim() !== "") {
      var bw = num(backW);
      if (!isFinite(bw) || bw < 4 || bw > 48) return fail("tool.err.width");
      backFt = bw / 12;
    }
    var backYd3 = (lenFt * hgtFt * backFt) / 27;

    $("r-blocks").textContent = fmt(wallBlocks, 0);
    $("r-caps").textContent = caps ? fmt(caps, 0) : t("tool.r.none");
    $("r-rows").textContent = fmt(rows, 0);
    $("r-base").textContent = vol(baseYd3, metric);
    $("r-backfill").textContent = (useBack && useBack.checked) ? vol(backYd3, metric) : t("tool.r.none");

    // 노출 4ft 초과는 구조 설계 영역 — 조용히 숫자만 내주지 않는다.
    var over = hgtFt > 4;
    warnEl.hidden = !over;
    warnEl.textContent = over ? t("tool.warn.height") : "";

    errEl.hidden = true;
    result.hidden = false;
  }

  var live = function () { if (!result.hidden || !errEl.hidden) calc(); };
  syncCustom();
  syncBackfill();
  syncUnits();
  $("calc-btn").addEventListener("click", calc);
  [wallL, wallH, blockW, blockH, price, backW].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  block.addEventListener("change", function () { syncCustom(); live(); });
  unit.addEventListener("change", function () { syncUnits(); live(); });
  [useCap, useBack, waste, backW].forEach(function (el) { el.addEventListener("change", live); });
  useBack.addEventListener("change", syncBackfill);
  document.addEventListener("i18n:change", live);
  // TOOLJS:END
})();
