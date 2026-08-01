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
  var deposit = $("deposit"), rate = $("rate"), tenure = $("tenure"), months = $("months");
  var result = $("result"), errEl = $("err"), customRow = $("custom-row"), lakhEl = $("r-lakh");
  if (!deposit || !rate || !tenure || !months) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  function num(el) { return parseFloat(String(el.value).replace(/,/g, "")); }
  function grp(s) { var p = String(s).split("."); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ","); return p.join("."); }
  function money(v) { return grp(v.toFixed(2)); }

  // 인도 은행 표준 — 분기 복리. i번째 납입금은 (n-i+1)개월 남으므로 지수는 4*(개월/12) = 개월/3.
  function maturity(p, annualPct, n) {
    var q = 1 + annualPct / 400, total = 0;
    for (var i = 1; i <= n; i++) total += p * Math.pow(q, (n - i + 1) / 3);
    return total;
  }

  function syncCustom() { customRow.hidden = tenure.value !== "custom"; }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var p = num(deposit), r = num(rate);
    if (!isFinite(p) || !isFinite(r)) return fail("tool.err.empty");
    if (p <= 0 || p >= 10000000) return fail("tool.err.deposit");
    if (r <= 0 || r > 20) return fail("tool.err.rate");

    var n = tenure.value === "custom" ? num(months) : parseFloat(tenure.value);
    if (!isFinite(n)) return fail("tool.err.months");
    n = Math.round(n);
    if (n < 6 || n > 120) return fail("tool.err.months");

    var m = maturity(p, r, n), deposited = p * n, interest = m - deposited;
    // 실효 수익률: 회차마다 예치 기간이 달라 표시 금리와 직접 비교가 안 된다.
    // 평균 예치기간 (n+1)/2 개월 기준 단리 환산으로 되돌려 비교 가능한 숫자로 만든다.
    var avgYears = (n + 1) / 24;
    var yieldPct = interest / deposited / avgYears * 100;

    $("r-maturity").textContent = money(m);
    lakhEl.textContent = m >= 100000 ? "≈ " + (m / 100000).toFixed(2) + " " + t("tool.unit.lakh") : "";
    $("r-deposited").textContent = money(deposited);
    $("r-interest").textContent = money(interest);
    $("r-yield").textContent = yieldPct.toFixed(2) + "%";

    errEl.hidden = true;
    result.hidden = false;
  }

  syncCustom();
  $("calc-btn").addEventListener("click", calc);
  [deposit, rate, months].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  tenure.addEventListener("change", function () { syncCustom(); if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
