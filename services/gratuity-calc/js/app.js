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
  var salary = $("salary"), years = $("years"), covered = $("covered");
  var result = $("result"), errEl = $("err");
  if (!salary || !years || !covered) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var CAP = 2000000; // 법정 비과세 상한 20 lakh — 초과분은 과세지만 지급 자체는 막지 않는다.

  // 인도식 자릿수 구분(마지막 3자리 뒤로는 2자리씩): 40000 -> 40,000 / 1846154 -> 18,46,154
  function inr(n) {
    var s = String(Math.round(n)), last3 = s.slice(-3), rest = s.slice(0, -3);
    if (rest) last3 = "," + last3;
    return "₹" + rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + last3;
  }
  function num(el) { return parseFloat(String(el.value).replace(/,/g, "")); }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var pay = num(salary);
    if (!isFinite(pay) || pay <= 0) return fail("tool.err.salary");
    var yrs = num(years);
    if (!isFinite(yrs)) return fail("tool.err.years");
    if (yrs < 0 || yrs > 50) return fail("tool.err.range");

    var isCovered = covered.value === "yes";
    var whole = Math.floor(yrs), frac = yrs - whole;
    // 법 적용: 6개월 이상은 1년으로 올림. 미적용: 완성 연수만.
    var counted = isCovered ? (frac >= 0.5 ? whole + 1 : whole) : whole;
    var perDay = isCovered ? pay / 26 : pay / 30;
    var amount = perDay * 15 * counted;

    $("r-amount").textContent = inr(amount);
    $("r-lakh").textContent = "≈ ₹" + (amount / 100000).toFixed(2) + " " + t("tool.unit.lakh");
    $("r-years").textContent = String(counted);
    $("r-formula").textContent = inr(pay) + " × 15 ÷ " + (isCovered ? "26" : "30") + " × " + counted;

    var roundNote = "";
    if (isCovered && frac >= 0.5) roundNote = t("tool.round.up").replace("{y}", String(yrs));
    else if (!isCovered) roundNote = t("tool.round.down").replace("{y}", String(yrs));
    $("r-round").textContent = roundNote;

    // 5년 미만은 오류가 아니라 자격 안내 — 금액은 자격 충족 시 받을 액수로 그대로 보여준다.
    $("b-elig").textContent = yrs < 5 ? t("tool.banner.ineligible") : t("tool.banner.ok");
    var cap = $("b-cap");
    cap.textContent = t("tool.banner.cap");
    cap.hidden = amount <= CAP;

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [salary, years].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  covered.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
