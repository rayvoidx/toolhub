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
  var mode = $("mode"), price = $("price"), rent = $("rent"), expenses = $("expenses"), target = $("target");
  var result = $("result"), errEl = $("err"), warnEl = $("warn"), tierEl = $("tier"), badgeEl = $("onepct");
  if (!mode || !price || !rent || !expenses || !target || !result) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  // 통화기호·천단위 구분·% 기호가 섞여 들어와도 숫자만 남긴다.
  var num = function (el) {
    var v = parseFloat(String(el.value).replace(/[^0-9.\-]/g, ""));
    return isFinite(v) ? v : NaN;
  };
  var money = function (n) { return n.toLocaleString(undefined, { maximumFractionDigits: 0 }); };
  var pct = function (n) { return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%"; };
  var setVal = function (id, text, neg) {
    var el = $(id);
    el.textContent = text;
    el.className = neg ? "rc-val neg" : "rc-val";
  };

  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function syncFields() {
    var m = mode.value;
    $("price-wrap").hidden = m === "price";
    $("rent-wrap").hidden = m === "noi";
    $("target-wrap").hidden = m === "cap";
  }

  function bandKey(cap) {
    if (cap < 4) return "tool.band.low";
    if (cap < 5) return "tool.band.core";
    if (cap < 8) return "tool.band.typical";
    return "tool.band.high";
  }

  function calc() {
    var m = mode.value;
    var exp = num(expenses);
    if (isNaN(exp)) return fail("tool.err.empty");
    if (exp < 0) return fail("tool.err.negative");

    var p, r, noi, cap, tg;
    if (m === "cap") {
      p = num(price); r = num(rent);
      if (isNaN(p) || isNaN(r)) return fail("tool.err.empty");
      if (p <= 0) return fail("tool.err.price");
      if (r <= 0) return fail("tool.err.rent");
      noi = r - exp;
      cap = noi / p * 100;
    } else if (m === "price") {
      r = num(rent); tg = num(target);
      if (isNaN(r) || isNaN(tg)) return fail("tool.err.empty");
      if (r <= 0) return fail("tool.err.rent");
      if (tg < 0.1 || tg > 30) return fail("tool.err.target");
      noi = r - exp;
      // 순수익이 0 이하면 어떤 가격으로도 목표 수익률이 나오지 않는다 — 음수 가격을 내지 않고 막는다.
      if (noi <= 0) return fail("tool.err.negnoi");
      cap = tg;
      p = noi / (tg / 100);
    } else {
      p = num(price); tg = num(target);
      if (isNaN(p) || isNaN(tg)) return fail("tool.err.empty");
      if (p <= 0) return fail("tool.err.price");
      if (tg < 0.1 || tg > 30) return fail("tool.err.target");
      cap = tg;
      noi = p * tg / 100;
      r = noi + exp; // 목표 NOI를 내려면 필요한 총임대수입
    }

    var monthly = r / 12;
    var ratio = exp / r * 100;
    var gross = r / p * 100;

    var heroKey = m === "price" ? "tool.r.price" : m === "noi" ? "tool.r.noi" : "tool.r.cap";
    var heroLabel = $("r-hero-label");
    heroLabel.setAttribute("data-i18n", heroKey);
    heroLabel.textContent = t(heroKey);
    setVal("r-hero", m === "cap" ? pct(cap) : money(m === "price" ? p : noi), m === "cap" && cap < 0);

    setVal("r-cap", pct(cap), cap < 0);
    setVal("r-noi", money(noi), noi < 0);
    setVal("r-ratio", pct(ratio), ratio >= 100);
    setVal("r-gross", pct(gross), false);
    setVal("r-monthly", money(monthly), false);

    // 1% 규칙: 월세가 매입가의 1% 이상인가 (미국 임대 스크리닝 관행).
    var onepct = monthly / p * 100;
    var passed = onepct >= 1;
    badgeEl.textContent = t(passed ? "tool.onepct.pass" : "tool.onepct.fail") + " · " + pct(onepct);
    badgeEl.className = passed ? "badge" : "badge miss";

    tierEl.setAttribute("data-i18n", bandKey(cap));
    tierEl.textContent = t(bandKey(cap));

    // 비용이 임대료를 넘는 물건도 계산해서 보여주되(빨간 NOI), 경고를 같이 낸다.
    warnEl.hidden = !(noi < 0);
    errEl.hidden = true;
    result.hidden = false;
  }

  mode.addEventListener("change", function () {
    syncFields();
    if (!result.hidden || !errEl.hidden) calc();
  });
  [price, rent, expenses, target].forEach(function (el) {
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  $("calc-btn").addEventListener("click", calc);
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  syncFields();
  // TOOLJS:END
})();
