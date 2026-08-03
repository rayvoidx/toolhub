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
  var cigs = $("cigs"), price = $("price"), packsize = $("packsize"), years = $("years");
  var psCustom = $("packsize-custom"), rate = $("rate"), invRate = $("inv-rate");
  var result = $("result"), errEl = $("err"), nolife = $("nolife");
  if (!cigs || !price || !packsize || !years) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { var v = parseFloat(String(el.value).replace(/[,\s]/g, "")); return isFinite(v) ? v : NaN; };
  var money = function (n) { return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var money0 = function (n) { return n.toLocaleString(undefined, { maximumFractionDigits: 0 }); };

  var MIN_PER_CIG = 11;     // BMJ 2000 (Shaw·Mitchell·Dorling) 인구 평균치 — 개인 예측이 아니다.
  var RETURN_RATE = 0.07;   // 투자 대안: 명목 연 7% (미국 주식 장기 평균 통념치)
  var HORIZON = 10;

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var c = num(cigs);
    if (isNaN(c)) return fail("tool.err.cigs");
    if (c <= 0 || c > 100) return fail("tool.err.cigsrange");

    var p = num(price);
    if (isNaN(p)) return fail("tool.err.price");
    if (p <= 0) return fail("tool.err.pricerange");

    // 흡연 기간은 선택 입력 — 비우면 누적 지출만 비우고 나머지는 정상 계산한다.
    var yRaw = String(years.value).trim();
    var y = yRaw === "" ? 0 : num(years);
    if (isNaN(y) || y < 0 || y > 80) return fail("tool.err.years");

    // 갑당 개비 수: 프리셋 밖 시장(10·30개비, 낱개 포장)을 위해 직접 입력 허용.
    var ps;
    if (packsize.value === "custom") {
      ps = num(psCustom);
      if (isNaN(ps) || ps < 1 || ps > 100) return fail("tool.err.packsize");
    } else {
      ps = parseFloat(packsize.value) || 20;
    }
    // 투자 수익률은 선택 입력 — 비우면 기본 7%.
    var rRaw = rate ? String(rate.value).trim() : "";
    var rPct = rRaw === "" ? RETURN_RATE * 100 : num(rate);
    if (isNaN(rPct) || rPct < 0 || rPct > 30) return fail("tool.err.rate");

    var daily = c / ps * p;
    var yearly = daily * 365.25;
    // 매년 1년치 담뱃값을 연말에 넣었을 때의 미래가치(연금 종가) — 일시불이 아니다.
    var r = rPct / 100;
    var invested = r === 0 ? yearly * HORIZON : yearly * (Math.pow(1 + r, HORIZON) - 1) / r;
    var daysPerYear = c * 365.25 * MIN_PER_CIG / 1440;

    $("r-year").textContent = money(yearly);
    $("r-month").textContent = money(daily * 30.4375);
    $("r-week").textContent = money(daily * 7);
    $("r-ten").textContent = money0(yearly * HORIZON);
    $("r-invested").textContent = money0(invested);
    if (invRate) invRate.textContent = rPct.toLocaleString(undefined, { maximumFractionDigits: 2 }) + "%";
    $("r-life").textContent = y > 0 ? money0(yearly * y) : "—";
    $("r-time").textContent = daysPerYear.toLocaleString(undefined, { maximumFractionDigits: daysPerYear < 10 ? 1 : 0 });
    if (nolife) nolife.hidden = y > 0;

    errEl.hidden = true;
    result.hidden = false;
  }

  var live = function () { if (!result.hidden || !errEl.hidden) calc(); };

  $("calc-btn").addEventListener("click", calc);
  [cigs, price, years, psCustom, rate].forEach(function (el) {
    if (!el) return;
    el.addEventListener("input", live);
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  packsize.addEventListener("change", function () {
    if (psCustom) psCustom.hidden = packsize.value !== "custom";
    live();
  });
  document.addEventListener("i18n:change", live);
  // TOOLJS:END
})();
