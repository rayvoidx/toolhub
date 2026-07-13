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

  // g/kg는 무게, ml/L는 부피, 개는 개수 — 서로 다른 종류는 비교 불가
  function unitCategory(unit) {
    if (unit === "g" || unit === "kg") return "weight";
    if (unit === "ml" || unit === "L") return "volume";
    if (unit === "개") return "count";
    return null;
  }

  // kg→g, L→ml 로 정규화 (g/ml/개는 그대로)
  function normalizedCapacity(capacity, unit) {
    if (unit === "kg" || unit === "L") return capacity * 1000;
    return capacity;
  }

  function displayUnitLabel(category) {
    if (category === "weight") return "100g";
    if (category === "volume") return "100ml";
    return "1개";
  }

  function formatWon(n) {
    var rounded = Math.round(n * 100) / 100;
    return rounded.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + "원";
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

  // 빈 값/0/음수 등 명시적 안내 문구를 돌려준다 (문제 없으면 null)
  function validate(p, label) {
    if (isNaN(p.price) || isNaN(p.capacity) || p.price <= 0 || p.capacity <= 0) {
      return label + "의 가격과 용량을 모두 입력해 주세요.";
    }
    if (isNaN(p.count) || p.count <= 0) {
      return label + "의 묶음 개수를 1 이상으로 입력해 주세요.";
    }
    if (!isFinite(p.price) || !isFinite(p.capacity) || !isFinite(p.count)) {
      return label + "의 값이 너무 큽니다. 다시 확인해 주세요.";
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

    var errA = validate(a, "상품 A");
    if (errA) { showResult("<p>" + errA + "</p>"); return; }
    var errB = validate(b, "상품 B");
    if (errB) { showResult("<p>" + errB + "</p>"); return; }

    var catA = unitCategory(a.unit);
    var catB = unitCategory(b.unit);
    if (catA !== catB) {
      showResult("<p>같은 종류의 단위끼리 비교해 주세요. (무게 g·kg / 부피 ml·L / 개수 개 는 서로 다른 종류라 비교할 수 없습니다.)</p>");
      return;
    }

    var priceA = unitPriceOf(a);
    var priceB = unitPriceOf(b);

    if (!isFinite(priceA) || !isFinite(priceB)) {
      showResult("<p>값이 너무 크거나 작아 계산할 수 없습니다. 입력값을 다시 확인해 주세요.</p>");
      return;
    }

    var label = displayUnitLabel(catA);
    var factor = catA === "count" ? 1 : 100;
    var displayA = priceA * factor;
    var displayB = priceB * factor;

    var html = "<p>상품 A: " + label + "당 " + formatWon(displayA) + "</p>"
      + "<p>상품 B: " + label + "당 " + formatWon(displayB) + "</p>";

    if (priceA === priceB) {
      html += "<p><strong>두 상품의 단위가격이 같습니다.</strong></p>";
    } else {
      var winner = priceA < priceB ? "A" : "B";
      var moreExpensive = Math.max(priceA, priceB);
      var cheaper = Math.min(priceA, priceB);
      var percent = Math.round(((moreExpensive - cheaper) / moreExpensive) * 1000) / 10;
      html += "<p><strong>상품 " + winner + "가 약 " + percent + "% 더 쌉니다.</strong></p>";
    }

    showResult(html);
    save();
  }

  if (els.btn) els.btn.addEventListener("click", compare);
  restore();
  // TOOLJS:END
})();
