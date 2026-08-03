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
  var mode = $("mode"), principal = $("principal"), rate = $("rate");
  var years = $("years"), payment = $("payment");
  var result = $("result"), errEl = $("err");
  if (!mode || !principal || !rate || !years || !payment) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { var v = parseFloat(String(el.value).replace(/[$,\s]/g, "")); return isFinite(v) ? v : NaN; };
  var money = function (n) { return Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 }); };

  function ym(months) {
    var y = Math.floor(months / 12), m = Math.round(months - y * 12);
    if (m === 12) { y += 1; m = 0; }
    return y + " " + t("tool.unit.y") + " " + m + " " + t("tool.unit.m");
  }

  // 모드마다 푸는 미지수가 다르니 그 칸만 감춘다 (남은 칸들이 입력).
  function sync() {
    var m = mode.value;
    $("f-payment").style.display = m === "payout" ? "none" : "";
    $("f-years").style.display = m === "duration" ? "none" : "";
    $("f-principal").style.display = m === "principal" ? "none" : "";
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var m = mode.value;
    var pct = num(rate);
    if (!isFinite(pct) || pct < 0 || pct > 40) return fail("tool.err.rate");
    var r = pct / 100 / 12; // 월 이율 — r=0 도 유효 입력이라 나눗셈 전에 분기한다.

    var P, PMT, n;
    if (m !== "principal") {
      P = num(principal);
      if (!isFinite(P) || P <= 0) return fail("tool.err.principal");
    }
    if (m !== "duration") {
      var y = num(years);
      if (!isFinite(y) || y < 1 || y > 60) return fail("tool.err.years");
      n = y * 12;
    }
    if (m !== "payout") {
      PMT = num(payment);
      if (!isFinite(PMT) || PMT <= 0) return fail("tool.err.payment");
    }

    var heroKey, heroVal, forever = false;
    if (m === "payout") {
      PMT = r === 0 ? P / n : (P * r) / (1 - Math.pow(1 + r, -n));
      heroKey = "tool.r.payout";
      heroVal = money(PMT) + " " + t("tool.unit.permonth");
    } else if (m === "duration") {
      // 인출액이 월 이자 이하면 원금이 줄지 않는다 — 로그 안의 값이 0 이하가 되는 구간.
      if (r > 0 && PMT <= P * r) forever = true;
      else n = r === 0 ? P / PMT : -Math.log(1 - (P * r) / PMT) / Math.log(1 + r);
      heroKey = "tool.r.duration";
      heroVal = forever ? t("tool.v.forever") : ym(n);
    } else {
      P = r === 0 ? PMT * n : (PMT * (1 - Math.pow(1 + r, -n))) / r;
      heroKey = "tool.r.principal";
      heroVal = money(P);
    }

    $("r-hero-label").textContent = t(heroKey);
    $("r-hero").textContent = heroVal;
    if (forever) {
      $("r-total").textContent = "—";
      $("r-interest").textContent = "—";
      $("r-note").textContent = t("tool.note.forever");
    } else {
      var total = PMT * n;
      $("r-total").textContent = money(total);
      $("r-interest").textContent = money(total - P);
      $("r-note").textContent = t("tool.note.depletes");
    }
    // 원금을 건드리지 않는 월 인출 한도 = P x 월이율 (r=0 이면 존재하지 않는다).
    $("r-safe").textContent = r > 0 ? money(P * r) + " " + t("tool.unit.permonth") : "—";

    errEl.hidden = true;
    result.hidden = false;
  }

  sync();
  $("calc-btn").addEventListener("click", calc);
  [principal, rate, years, payment].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  mode.addEventListener("change", function () { sync(); if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
