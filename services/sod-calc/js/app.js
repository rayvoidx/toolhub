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
  var unit = $("unit"), shape = $("shape"), waste = $("waste"), sold = $("sold");
  var len = $("len"), wid = $("wid"), dia = $("dia"), area = $("area");
  var cover = $("cover"), price = $("price"), pallet = $("pallet");
  var rectBox = $("rect-fields"), circleBox = $("circle-fields"), directBox = $("direct-fields"), coverBox = $("cover-field");
  var result = $("result"), errEl = $("err");
  if (!unit || !shape || !waste || !sold || !len || !wid || !dia || !area || !cover || !price || !pallet) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var M2_TO_FT2 = 10.76391;   // 1 m² = 10.76391 ft²
  var PALLET_FT2 = 450;       // 업계 관행 400~500의 중앙값 — 배송 계획용 고정 기준

  function raw(el) { return String(el.value).replace(/,/g, "").replace(/^\s+|\s+$/g, ""); }
  function num(el) {
    var v = parseFloat(raw(el));
    return isFinite(v) ? v : NaN;
  }
  function fmt(v) {
    var r = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
    return r.toLocaleString();
  }
  function money(v) {
    return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }
  // 1500 × 1.1 = 1650.0000000000002 → 나눗셈 후 올림이 한 단위 튄다. 부동소수 오차만큼 빼고 올린다.
  function ceilUnits(v) { return Math.ceil(v - 1e-9); }

  function syncShape() {
    var s = shape.value;
    rectBox.hidden = s !== "rect";
    circleBox.hidden = s !== "circle";
    directBox.hidden = s !== "direct";
  }
  function syncSold() { coverBox.hidden = sold.value !== "custom"; }

  var NOUN = { "10": "tool.n.rolls", "2.66": "tool.n.slabs", "450": "tool.n.pallets" };

  function calc() {
    var a; // 입력 단위의 제곱 — ft² 또는 m²
    if (shape.value === "circle") {
      var d = num(dia);
      if (isNaN(d)) return fail("tool.err.empty");
      if (d <= 0) return fail("tool.err.zero");
      a = Math.PI * d * d / 4;
    } else if (shape.value === "direct") {
      a = num(area);
      if (isNaN(a)) return fail("tool.err.empty");
      if (a <= 0) return fail("tool.err.zero");
    } else {
      var l = num(len), w = num(wid);
      if (isNaN(l) || isNaN(w)) return fail("tool.err.empty");
      if (l <= 0 || w <= 0) return fail("tool.err.zero");
      a = l * w;
    }

    var ft2 = unit.value === "m" ? a * M2_TO_FT2 : a;
    if (ft2 > 500000) return fail("tool.err.range");

    // 판매 단위: 프리셋은 값 자체가 커버 면적, custom 은 사용자가 직접 넣는다.
    var per = sold.value === "custom" ? num(cover) : parseFloat(sold.value);
    if (!isFinite(per) || per <= 0) return fail("tool.err.cover");

    // 가격은 선택 입력 — 비우면 비용 칸만 비운다. 음수는 조용히 넘기지 않는다.
    var p = null, praw = raw(price);
    if (praw !== "") {
      p = parseFloat(praw);
      if (!isFinite(p) || p < 0) return fail("tool.err.price");
    }

    // 팔레트 면적은 400~500으로 지역·공급업체마다 다르다. 비우면 450 기준.
    var palFt2 = PALLET_FT2, palraw = raw(pallet);
    if (palraw !== "") {
      palFt2 = parseFloat(palraw);
      if (!isFinite(palFt2) || palFt2 <= 0) return fail("tool.err.pallet");
    }

    var withWaste = ft2 * (1 + parseFloat(waste.value) / 100);
    var units = ceilUnits(withWaste / per);
    var pallets = ceilUnits(withWaste / palFt2);

    $("r-units").textContent = units.toLocaleString() + " " + t(NOUN[sold.value] || "tool.n.units");
    $("r-area").textContent = unit.value === "m"
      ? fmt(withWaste / M2_TO_FT2) + " " + t("tool.u.sqm") + " (" + fmt(withWaste) + " " + t("tool.u.sqft") + ")"
      : fmt(withWaste) + " " + t("tool.u.sqft");
    $("r-pallets").textContent = pallets.toLocaleString();
    $("r-cost").textContent = p === null ? "—" : money(units * p);

    errEl.hidden = true;
    result.hidden = false;
  }

  syncShape();
  syncSold();
  $("calc-btn").addEventListener("click", calc);
  [len, wid, dia, area, cover, price, pallet].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  shape.addEventListener("change", function () { syncShape(); if (!result.hidden || !errEl.hidden) calc(); });
  sold.addEventListener("change", function () { syncSold(); if (!result.hidden || !errEl.hidden) calc(); });
  [unit, waste].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
