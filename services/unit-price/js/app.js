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

  // GA4 — 설정 시에만 로드, 실패해도 본 기능에 영향 없게 격리 (safeTrack 원칙)
  if (cfg.analytics && cfg.analytics.ga4) {
    try {
      var s = document.createElement("script");
      s.async = true;
      s.src = "https://www.googletagmanager.com/gtag/js?id=" + cfg.analytics.ga4;
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", cfg.analytics.ga4);
    } catch (e) { /* 분석 실패는 조용히 무시 */ }
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
  var STORAGE_KEY = "unit-price:last";

  /* ---- i18n 헬퍼 (docs/I18N.md) ---- */
  function t(key) {
    var s = window.I18N && window.I18N.t(key);
    return s != null ? s : key;
  }
  function fmt(s, params) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return params && params[k] != null ? String(params[k]) : m;
    });
  }
  // 통화 기호 하드코딩 금지 — 현재 언어 로케일로 숫자만 포맷 (단위가격은 비율이라 통화 중립)
  function nf(n) {
    var rounded = Math.round(n * 100) / 100;
    try {
      var lang = window.I18N && window.I18N.lang();
      return rounded.toLocaleString(lang || undefined, { maximumFractionDigits: 2 });
    } catch (e) { return String(rounded); }
  }
  function escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  var els = {
    aPrice: document.getElementById("a-price"),
    aCapacity: document.getElementById("a-capacity"),
    aUnit: document.getElementById("a-unit"),
    aCount: document.getElementById("a-count"),
    bPrice: document.getElementById("b-price"),
    bCapacity: document.getElementById("b-capacity"),
    bUnit: document.getElementById("b-unit"),
    bCount: document.getElementById("b-count"),
    btn: document.getElementById("compare-btn"),
    result: document.getElementById("result")
  };

  // g/kg는 무게, ml/L는 부피, ea(개)는 개수 — 서로 다른 종류는 비교 불가
  function unitCategory(unit) {
    if (unit === "g" || unit === "kg") return "weight";
    if (unit === "ml" || unit === "L") return "volume";
    if (unit === "ea") return "count";
    return null;
  }

  // kg→g, L→ml 로 정규화 (g/ml/ea는 그대로)
  function normalizedCapacity(capacity, unit) {
    if (unit === "kg" || unit === "L") return capacity * 1000;
    return capacity;
  }

  // 결과에 붙는 "per 100 g / per 100 ml / per item" 라벨 (언어별)
  function perLabel(category) {
    if (category === "weight") return t("tool.per.weight");
    if (category === "volume") return t("tool.per.volume");
    return t("tool.per.count");
  }

  function parseNumber(el) {
    var raw = el.value.trim();
    if (raw === "") return NaN;
    return parseFloat(raw);
  }

  function readProduct(prefix) {
    var countRaw = els[prefix + "Count"].value.trim();
    return {
      price: parseNumber(els[prefix + "Price"]),
      capacity: parseNumber(els[prefix + "Capacity"]),
      unit: els[prefix + "Unit"].value,
      count: countRaw === "" ? 1 : parseFloat(countRaw)
    };
  }

  // 빈 값/0/음수 등 명시적 안내 문구를 돌려준다 (문제 없으면 null). name = 현지화된 상품명
  function validate(p, name) {
    if (isNaN(p.price) || isNaN(p.capacity) || p.price <= 0 || p.capacity <= 0) {
      return fmt(t("tool.err.priceAmount"), { name: name });
    }
    if (isNaN(p.count) || p.count <= 0) {
      return fmt(t("tool.err.pack"), { name: name });
    }
    if (!isFinite(p.price) || !isFinite(p.capacity) || !isFinite(p.count)) {
      return fmt(t("tool.err.tooLarge"), { name: name });
    }
    return null;
  }

  // 상품의 단위가격(정규화된 1g / 1ml / 1개 당 가격)
  function unitPriceOf(p) {
    var totalCapacity = normalizedCapacity(p.capacity, p.unit) * p.count;
    return p.price / totalCapacity;
  }

  function showResult(html) {
    els.result.innerHTML = html;
    els.result.hidden = false;
  }
  function showMsg(msg) { showResult("<p>" + escHtml(msg) + "</p>"); }

  function save() {
    try {
      var data = {
        aPrice: els.aPrice.value, aCapacity: els.aCapacity.value, aUnit: els.aUnit.value, aCount: els.aCount.value,
        bPrice: els.bPrice.value, bCapacity: els.bCapacity.value, bUnit: els.bUnit.value, bCount: els.bCount.value
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) { /* 프라이빗 모드 등에서 저장 불가 — 조용히 무시 */ }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d || typeof d !== "object") return;
      if (d.aPrice) els.aPrice.value = d.aPrice;
      if (d.aCapacity) els.aCapacity.value = d.aCapacity;
      if (d.aUnit) els.aUnit.value = d.aUnit;
      if (d.aCount) els.aCount.value = d.aCount;
      if (d.bPrice) els.bPrice.value = d.bPrice;
      if (d.bCapacity) els.bCapacity.value = d.bCapacity;
      if (d.bUnit) els.bUnit.value = d.bUnit;
      if (d.bCount) els.bCount.value = d.bCount;
    } catch (e) { /* 손상된 저장값은 무시하고 빈 폼으로 진행 */ }
  }

  function compare() {
    var a = readProduct("a");
    var b = readProduct("b");
    var nameA = t("tool.legendA");
    var nameB = t("tool.legendB");

    var errA = validate(a, nameA);
    if (errA) { showMsg(errA); return; }
    var errB = validate(b, nameB);
    if (errB) { showMsg(errB); return; }

    var catA = unitCategory(a.unit);
    var catB = unitCategory(b.unit);
    if (catA !== catB) { showMsg(t("tool.err.mismatch")); return; }

    var priceA = unitPriceOf(a);
    var priceB = unitPriceOf(b);
    if (!isFinite(priceA) || !isFinite(priceB)) { showMsg(t("tool.err.compute")); return; }

    var per = perLabel(catA);
    var factor = catA === "count" ? 1 : 100;

    var lineTpl = t("tool.r.line");
    var html = "<p>" + escHtml(fmt(lineTpl, { name: nameA, price: nf(priceA * factor), per: per })) + "</p>"
      + "<p>" + escHtml(fmt(lineTpl, { name: nameB, price: nf(priceB * factor), per: per })) + "</p>";

    if (priceA === priceB) {
      html += "<p><strong>" + escHtml(t("tool.r.same")) + "</strong></p>";
    } else {
      var winner = priceA < priceB ? "A" : "B";
      var moreExpensive = Math.max(priceA, priceB);
      var cheaper = Math.min(priceA, priceB);
      var percent = Math.round(((moreExpensive - cheaper) / moreExpensive) * 1000) / 10;
      html += "<p><strong>" + escHtml(fmt(t("tool.r.cheaper"), { winner: winner, percent: nf(percent) })) + "</strong></p>";
    }

    showResult(html);
    save();
  }

  if (els.btn) els.btn.addEventListener("click", compare);
  // 언어 전환 시 이미 표시 중인 결과를 새 언어로 다시 렌더 (숨김 상태면 그대로 둔다)
  document.addEventListener("i18n:change", function () {
    if (els.result && !els.result.hidden) compare();
  });
  restore();
  // TOOLJS:END
})();
