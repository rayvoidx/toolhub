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
  var mode = $("mode"), cost = $("cost"), price = $("price"), margin = $("margin"), qty = $("qty");
  var result = $("result"), errEl = $("err"), warnEl = $("warn");
  if (!mode || !cost || !price || !margin || !result) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  // 통화기호·천단위 구분·% 기호가 섞여 들어와도 숫자만 남긴다.
  var num = function (el) {
    var v = parseFloat(String(el.value).replace(/[^0-9.\-]/g, ""));
    return isFinite(v) ? v : NaN;
  };
  var money = function (n) { return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var pct = function (n) { return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%"; };
  var setVal = function (id, text, neg) {
    var el = $(id);
    el.textContent = text;
    el.className = neg ? "rc-val neg" : "rc-val";
  };

  function fail(key) {
    result.hidden = true;
    warnEl.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function syncFields() {
    var m = mode.value;
    $("cost-wrap").hidden = m === "cost";
    $("price-wrap").hidden = m === "price";
    $("margin-wrap").hidden = m === "margin";
  }

  function calc() {
    var m = mode.value;
    var c = num(cost), p = num(price), gm = num(margin);
    var costV, priceV, marginPct;

    if (m === "price") {
      // 원가 + 목표 마진 → 판매가. 마진은 판매가 기준이므로 (1 - m) 으로 나눈다.
      if (isNaN(c) || isNaN(gm)) return fail("tool.err.empty");
      if (c < 0) return fail("tool.err.negative");
      if (c === 0) return fail("tool.err.zerocost");
      if (gm >= 100) return fail("tool.err.margin100");
      if (gm <= -99) return fail("tool.err.marginrange");
      costV = c; marginPct = gm; priceV = c / (1 - gm / 100);
    } else if (m === "cost") {
      // 판매가 + 목표 마진 → 허용 가능한 최대 원가.
      if (isNaN(p) || isNaN(gm)) return fail("tool.err.empty");
      if (p < 0) return fail("tool.err.negative");
      if (p === 0) return fail("tool.err.zeroprice");
      if (gm >= 100) return fail("tool.err.margin100");
      if (gm <= -99) return fail("tool.err.marginrange");
      priceV = p; marginPct = gm; costV = p * (1 - gm / 100);
    } else {
      if (isNaN(c) || isNaN(p)) return fail("tool.err.empty");
      if (c < 0 || p < 0) return fail("tool.err.negative");
      if (p === 0) return fail("tool.err.zeroprice");
      costV = c; priceV = p; marginPct = (p - c) / p * 100;
    }

    // 수량은 선택 입력 — 비우면 기존 개당 결과 그대로.
    var qRaw = String(qty.value).trim();
    var q = qRaw === "" ? 1 : num(qty);
    if (qRaw !== "" && (isNaN(q) || q < 1 || q > 10000000)) return fail("tool.err.qty");

    var profit = priceV - costV;
    // 원가가 0이면 마크업은 정의되지 않는다(0으로 나누기) — Infinity 대신 기호로 표시.
    var markupTxt = costV > 0 ? pct(profit / costV * 100) : "\u221E";
    var heroKey = m === "price" ? "tool.r.price" : (m === "cost" ? "tool.r.maxcost" : "tool.r.margin");
    var heroTxt = m === "margin" ? pct(marginPct) : (m === "price" ? money(priceV) : money(costV));

    var heroLabel = $("r-hero-label");
    heroLabel.setAttribute("data-i18n", heroKey);
    heroLabel.textContent = t(heroKey);

    setVal("r-hero", heroTxt, m === "margin" ? marginPct < 0 : false);
    setVal("r-margin", pct(marginPct), marginPct < 0);
    setVal("r-markup", markupTxt, profit < 0);
    setVal("r-profit", money(profit), profit < 0);
    setVal("r-price", money(priceV), false);
    setVal("r-cost", money(costV), false);
    $("total-card").hidden = qRaw === "";
    if (qRaw !== "") setVal("r-total", money(profit * q), profit < 0);

    warnEl.hidden = profit >= 0;
    errEl.hidden = true;
    result.hidden = false;
  }

  mode.addEventListener("change", function () {
    syncFields();
    if (!result.hidden || !errEl.hidden) calc();
  });
  [cost, price, margin, qty].forEach(function (el) {
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  $("calc-btn").addEventListener("click", calc);
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  syncFields();
  // TOOLJS:END
})();
