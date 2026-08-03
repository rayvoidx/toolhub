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
  var monthly = $("monthly"), ret = $("ret"), years = $("years"), stepup = $("stepup"), infl = $("infl"), lump = $("lump");
  var result = $("result"), errEl = $("err"), warnEl = $("warn");
  if (!monthly || !ret || !years || !stepup || !infl || !lump) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { return parseFloat(String(el.value).replace(/,/g, "")); };

  // 인도식 자릿수 구분(23,23,391)은 en-IN 로케일이 해준다 — 미지원 환경은 원시 숫자로 폴백.
  function fmt(n) {
    var v = Math.round(n);
    try { return "₹" + v.toLocaleString("en-IN"); } catch (e) { return "₹" + v; }
  }
  function lakhLine(n) {
    if (n >= 1e7) return "≈ ₹" + (n / 1e7).toFixed(2) + " " + t("tool.unit.crore");
    if (n >= 1e5) return "≈ ₹" + (n / 1e5).toFixed(1) + " " + t("tool.unit.lakh");
    return "";
  }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var p0 = num(monthly), r = num(ret), y = num(years);
    var st = String(stepup.value).trim() === "" ? 0 : num(stepup);
    var inf = String(infl.value).trim() === "" ? 0 : num(infl);
    var lp = String(lump.value).trim() === "" ? 0 : num(lump);
    if (!isFinite(p0) || p0 <= 0) return fail("tool.err.monthly");
    if (!isFinite(r) || r < 0 || r > 60) return fail("tool.err.return");
    if (!isFinite(y) || y < 1 || y > 50) return fail("tool.err.years");
    if (!isFinite(st) || st < 0 || st > 50) return fail("tool.err.stepup");
    if (!isFinite(inf) || inf < 0 || inf > 30) return fail("tool.err.infl");
    if (!isFinite(lp) || lp < 0) return fail("tool.err.lump");

    // 월 실효 이율: r/12 가 아니라 (1+r)^(1/12)-1 — 입력한 연 수익률이 그대로 전체 XIRR 이 된다.
    var i = Math.pow(1 + r / 100, 1 / 12) - 1;
    var n = Math.round(y * 12);
    // 기존 목돈은 0개월차부터 함께 복리 — 기본값 0 이면 종전 결과와 동일하다.
    var fv = lp, p = p0, invested = lp, last = p0;
    for (var m = 0; m < n; m++) {
      fv = (fv + p) * (1 + i);            // 월초 납입 = annuity-due
      invested += p;
      last = p;
      if ((m + 1) % 12 === 0) p = p * (1 + st / 100);
    }

    $("r-maturity").textContent = fmt(fv);
    $("r-lakh").textContent = lakhLine(fv);
    $("r-invested").textContent = fmt(invested);
    $("r-gain").textContent = fmt(fv - invested);
    $("r-final").textContent = fmt(last);
    // 실질 가치는 만기 시점 물가로 할인 — 납입 개월 수(n)를 그대로 써 기간과 일치시킨다.
    $("real-card").hidden = inf <= 0;
    if (inf > 0) $("r-real").textContent = fmt(fv / Math.pow(1 + inf / 100, n / 12));

    warnEl.textContent = r > 30 ? t("tool.warn.high") : "";
    warnEl.hidden = r <= 30;
    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [monthly, ret, years, stepup, infl, lump].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
