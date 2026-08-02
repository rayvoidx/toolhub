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
  var income = $("income"), debts = $("debts"), down = $("down");
  var rate = $("rate"), term = $("term"), taxins = $("taxins"), hoa = $("hoa");
  var result = $("result"), errEl = $("err");
  if (!income || !rate || !term) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { var v = parseFloat(String(el.value).replace(/[$£€,\s]/g, "")); return isFinite(v) ? v : NaN; };
  var or0 = function (el) { var v = num(el); return isFinite(v) ? v : 0; };
  var money0 = function (n) { return Math.round(n).toLocaleString(); };
  var money2 = function (n) { return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  // 월 원리금 1 단위가 지탱하는 원금 = 연금현가계수. 금리 0이면 개월 수만큼 그대로 쌓인다.
  function loanFor(pi, monthlyRate, n) {
    return monthlyRate === 0 ? pi * n : pi * (1 - Math.pow(1 + monthlyRate, -n)) / monthlyRate;
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var inc = num(income), r = num(rate);
    if (isNaN(inc) || isNaN(r)) return fail("tool.err.empty");
    if (inc <= 0) return fail("tool.err.income");
    if (r < 0 || r > 25) return fail("tool.err.rate");

    var d = or0(debts), dp = or0(down), ti = or0(taxins), hf = or0(hoa);
    if (d < 0 || dp < 0 || ti < 0 || hf < 0) return fail("tool.err.negative");

    var mi = inc / 12;
    // 28/36 규칙: 주거비는 총소득의 28%, 기존 부채를 포함한 총부채는 36% 이내. 둘 중 낮은 쪽이 한도.
    // 관리비(HOA)는 세금·보험과 함께 주거비 한도에서 먼저 빠진다 — 심사도 PITI+HOA 로 본다.
    var housing = Math.min(0.28 * mi, 0.36 * mi - d);
    var pi = housing - ti - hf;
    if (pi <= 0) return fail(hf > 0 ? "tool.err.hoa" : "tool.err.debt");

    var mr = r / 100 / 12;
    var n = parseInt(term.value, 10) || 360;
    var principal = loanFor(pi, mr, n);

    // 보수적 기준: 대출 심사가 아니라 생활 여유 기준인 25% 선. 36% 한도는 여전히 적용된다.
    var pi25 = Math.min(0.25 * mi, 0.36 * mi - d) - ti - hf;
    var comfort = pi25 > 0 ? loanFor(pi25, mr, n) + dp : dp;

    $("r-price").textContent = money0(principal + dp);
    $("r-comfort").textContent = money0(comfort);
    $("r-payment").textContent = money2(housing);
    $("r-loan").textContent = money0(principal);

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [income, debts, down, rate, taxins, hoa].forEach(function (el) {
    if (!el) return;
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  term.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!errEl.hidden) calc(); });
  // TOOLJS:END
})();
