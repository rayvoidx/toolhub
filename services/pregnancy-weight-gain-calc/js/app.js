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
  var weight = $("weight"), wunit = $("wunit"), hunit = $("hunit");
  var ftEl = $("ft"), inEl = $("in"), cmEl = $("cm"), week = $("week"), twins = $("twins");
  var impWrap = $("imperial-wrap"), metWrap = $("metric-wrap");
  var result = $("result"), errEl = $("err"), noteEl = $("r-note");
  if (!weight || !wunit || !hunit || !week || !twins || !impWrap || !metWrap) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { return parseFloat(String(el.value).replace(/[\s,]/g, "")); };

  var LB_PER_KG = 2.2046226;
  // IOM 2009 총 증가량(lb). 단태아 기준 — BMI 구간별 상·하한.
  var SINGLE = { under: [28, 40], normal: [25, 35], over: [15, 25], obese: [11, 20] };
  // 쌍둥이는 IOM 잠정 범위. 저체중 구간은 근거 부족으로 미제시라 정상 BMI 범위를 대체 표시하고 안내한다.
  var TWIN = { under: [37, 54], normal: [37, 54], over: [31, 50], obese: [25, 42] };
  var FIRST_SINGLE = [1.1, 4.4];   // 1분기 총 증가량(lb)
  var FIRST_TWIN = [4, 6];
  var LATE_WEEKS = 27;             // 14~40주

  function fmt(v, d) { return v.toFixed(d).replace(/\.0+$/, ""); }

  // 표시 단위는 체중 입력 단위를 따르고, 반대 단위는 괄호로 항상 함께 보여준다.
  function range(loLb, hiLb, lbDec, kgDec) {
    var loKg = loLb / LB_PER_KG, hiKg = hiLb / LB_PER_KG;
    var lb = fmt(loLb, lbDec) + "\u2013" + fmt(hiLb, lbDec) + " lb";
    var kg = fmt(loKg, kgDec) + "\u2013" + fmt(hiKg, kgDec) + " kg";
    return wunit.value === "kg" ? kg + " (" + lb + ")" : lb + " (" + kg + ")";
  }

  function category(bmi) {
    if (bmi < 18.5) return "under";
    if (bmi < 25) return "normal";
    if (bmi < 30) return "over";
    return "obese";
  }

  function syncUnits() {
    var metric = hunit.value === "metric";
    metWrap.hidden = !metric;
    impWrap.hidden = metric;
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    if (String(weight.value).trim() === "") return fail("tool.err.weight");
    var w = num(weight);
    if (!isFinite(w) || w <= 0) return fail("tool.err.weight");
    var lb = wunit.value === "kg" ? w * LB_PER_KG : w;
    if (lb < 60 || lb > 500) return fail("tool.err.wrange");

    var cm;
    if (hunit.value === "metric") {
      cm = num(cmEl);
    } else {
      var f = num(ftEl);
      var i = String(inEl.value).trim() === "" ? 0 : num(inEl);
      if (!isFinite(f) || !isFinite(i) || i < 0) return fail("tool.err.height");
      cm = (f * 12 + i) * 2.54;
    }
    if (!isFinite(cm) || cm < 120 || cm > 220) return fail("tool.err.height");

    if (String(week.value).trim() === "") return fail("tool.err.week");
    var wk = num(week);
    if (!isFinite(wk)) return fail("tool.err.week");
    if (wk < 4 || wk > 42) return fail("tool.err.wkrange");

    var m = cm / 100;
    var bmi = (lb / LB_PER_KG) / (m * m);
    var cat = category(bmi);
    var isTwin = twins.checked;
    var total = (isTwin ? TWIN : SINGLE)[cat];
    var first = isTwin ? FIRST_TWIN : FIRST_SINGLE;

    // 2·3분기 주당 속도 = (총 범위 - 1분기 몫) / 27주.
    var rateLo = (total[0] - first[0]) / LATE_WEEKS;
    var rateHi = (total[1] - first[1]) / LATE_WEEKS;

    // 40주 이후(41~42주)는 총량에서 더 늘려 잡지 않는다.
    var wEff = Math.min(wk, 40);
    var expLo, expHi;
    if (wEff <= 13) {
      expLo = first[0] * wEff / 13;
      expHi = first[1] * wEff / 13;
    } else {
      expLo = first[0] + rateLo * (wEff - 13);
      expHi = first[1] + rateHi * (wEff - 13);
    }

    $("r-total").textContent = range(total[0], total[1], 1, 1);
    $("r-week").textContent = range(expLo, expHi, 1, 1);
    $("r-rate").textContent = range(rateLo, rateHi, 1, 2) + " " + t("tool.unit.perweek");
    $("r-bmi").textContent = fmt(bmi, 1) + " \u2014 " + t("tool.cat." + cat);

    if (isTwin) {
      noteEl.hidden = false;
      noteEl.textContent = cat === "under" ? t("tool.note.twinsunder") : t("tool.note.twins");
    } else {
      noteEl.hidden = true;
      noteEl.textContent = "";
    }

    errEl.hidden = true;
    result.hidden = false;
  }

  syncUnits();
  $("calc-btn").addEventListener("click", calc);
  [weight, ftEl, inEl, cmEl, week].forEach(function (el) {
    if (el) el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  hunit.addEventListener("change", function () { syncUnits(); if (!result.hidden || !errEl.hidden) calc(); });
  [wunit, twins].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
