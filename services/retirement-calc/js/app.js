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
  var age = $("age"), retage = $("retage"), balance = $("balance"), salary = $("salary");
  var contrib = $("contrib"), match = $("match"), matchrate = $("matchrate"), rate = $("rate"), growth = $("growth"), infl = $("infl");
  var result = $("result"), errEl = $("err");
  if (!age || !retage || !salary || !contrib) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { var v = parseFloat(String(el.value).replace(/[$,\s]/g, "")); return isFinite(v) ? v : NaN; };
  var money = function (n) { return Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 }); };

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var a0 = num(age), a1 = num(retage), bal = num(balance), sal = num(salary);
    var you = num(contrib), cap = num(match), r = num(rate), g = num(growth);
    var vals = [a0, a1, bal, sal, you, cap, r, g];
    for (var i = 0; i < vals.length; i++) { if (isNaN(vals[i])) return fail("tool.err.empty"); }

    if (a0 < 18 || a0 > 80 || a1 < 20 || a1 > 90) return fail("tool.err.age");
    if (a1 <= a0) return fail("tool.err.order");
    if (bal < 0 || sal < 0) return fail("tool.err.negative");
    if (you < 0 || you > 100 || cap < 0 || cap > 100 || r < -20 || r > 30 || g < -10 || g > 20) return fail("tool.err.pct");
    if (sal <= 0 && bal <= 0) return fail("tool.err.nothing");
    // 인플레이션은 선택 입력 — 비우면 0(기존 동작 유지).
    var inflRaw = infl ? String(infl.value).trim() : "";
    var inf = inflRaw === "" ? 0 : num(infl);
    if (isNaN(inf) || inf < 0 || inf > 20) return fail("tool.err.infl");

    // 매칭률은 선택 입력 — 비우면 100%(기존 동작 유지). 50%면 "1달러당 50센트" 플랜.
    var mrRaw = matchrate ? String(matchrate.value).trim() : "";
    var mr = mrRaw === "" ? 100 : num(matchrate);
    if (isNaN(mr) || mr < 0 || mr > 100) return fail("tool.err.matchrate");

    // "급여의 X%까지 매칭" — 내가 상한보다 적게 넣으면 넣은 만큼만, 그 위에 매칭률을 곱한다.
    var eff = Math.min(you, cap) * mr / 100;
    var b = bal, s = sal, mine = 0, emp = 0;
    for (var y = Math.floor(a0); y < Math.floor(a1); y++) {
      var c1 = s * you / 100, c2 = s * eff / 100;
      // 납입은 1년에 걸쳐 분산되므로 그해 납입분은 반년치 수익만 얻는다(mid-year 관행).
      b = b * (1 + r / 100) + (c1 + c2) * (1 + r / 200);
      mine += c1; emp += c2;
      s = s * (1 + g / 100);
    }

    $("r-balance").textContent = money(b);
    $("r-you").textContent = money(mine);
    $("r-match").textContent = money(emp);
    $("r-growth").textContent = money(b - bal - mine - emp);
    var realCard = $("rc-real");
    if (realCard) {
      if (inf > 0) {
        $("r-real").textContent = money(b / Math.pow(1 + inf / 100, Math.floor(a1) - Math.floor(a0)));
        realCard.hidden = false;
      } else { realCard.hidden = true; }
    }

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [age, retage, balance, salary, contrib, match, matchrate, rate, growth, infl].forEach(function (el) {
    if (!el) return;
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
