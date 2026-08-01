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
  var balance = $("balance"), rate = $("rate"), remaining = $("remaining");
  var newrate = $("newrate"), newterm = $("newterm"), costs = $("costs");
  var result = $("result"), errEl = $("err");
  if (!balance || !rate || !remaining || !newrate || !newterm) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { var v = parseFloat(String(el.value).replace(/[$,\s]/g, "")); return isFinite(v) ? v : NaN; };
  var or0 = function (el) { var v = num(el); return isFinite(v) ? v : 0; };
  var money = function (n) { return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  // 표준 원리금균등 상환식. 금리 0%면 원금을 개월수로 나눈다(0으로 나누기 방지).
  function payment(P, annualPct, months) {
    var i = annualPct / 100 / 12;
    return i === 0 ? P / months : P * i / (1 - Math.pow(1 + i, -months));
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var P = num(balance), r = num(rate), yrs = num(remaining), nr = num(newrate);
    if (isNaN(P) || isNaN(r) || isNaN(yrs) || isNaN(nr)) return fail("tool.err.empty");
    if (P <= 0 || yrs <= 0) return fail("tool.err.positive");
    if (r < 0 || r > 25 || nr < 0 || nr > 25) return fail("tool.err.rate");
    if (yrs > 40) return fail("tool.err.term");
    var cc = or0(costs);
    if (cc < 0) return fail("tool.err.costs");

    var oldN = Math.max(1, Math.round(yrs * 12));
    var newN = newterm.value === "match" ? oldN : Math.round(parseFloat(newterm.value) * 12);
    var oldPay = payment(P, r, oldN), newPay = payment(P, nr, newN);
    var save = oldPay - newPay;
    var oldInt = oldPay * oldN - P, newInt = newPay * newN - P;
    // 정직한 비교: 새 대출 이자에 클로징 비용을 더해야 실제로 치르는 총액이 된다.
    var diff = (newInt + cc) - oldInt;

    var note = $("r-note");
    if (save > 0.005) {
      $("r-breakeven").textContent = Math.ceil(cc / save) + " " + t("tool.unit.months");
      note.hidden = true;
      note.textContent = "";
    } else {
      // 새 납입액이 더 낮지 않으면 회수할 대상이 없다 — 조용히 0을 내지 않고 명시한다.
      $("r-breakeven").textContent = t("tool.r.nobenefit");
      note.textContent = t("tool.msg.nobenefit");
      note.hidden = false;
    }

    $("r-savings").textContent = money(save);
    $("r-newpay").textContent = money(newPay);
    $("r-oldpay").textContent = money(oldPay);
    $("r-oldint").textContent = money(oldInt);
    $("r-newint").textContent = money(newInt);
    $("r-lifetime").textContent = money(diff);

    var flag = $("r-flag");
    flag.className = "flag " + (diff > 0 ? "warn" : "good");
    flag.textContent = t(diff > 0 ? "tool.badge.more" : "tool.badge.less");
    flag.hidden = false;

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [balance, rate, remaining, newrate, costs].forEach(function (el) {
    if (!el) return;
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  newterm.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
