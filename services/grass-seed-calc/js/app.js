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
  var unit = $("unit"), mode = $("mode"), len = $("len"), wid = $("wid"), area = $("area");
  var project = $("project"), grass = $("grass"), result = $("result"), errEl = $("err");
  if (!unit || !mode || !len || !wid || !area || !project || !grass) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 파종률: 초종별 lb / 1,000 sq ft (미국 종묘 표준 권장치). 덧파종은 절반.
  var RATE = { kbg: 3, tf: 8, prg: 7, ff: 5, ber: 1.5, zoy: 2 };
  var BAGS = [20, 7, 3];          // 소매 봉지 규격(lb)
  var SQFT_PER_M2 = 10.7639;
  var LB_PER_KG = 0.45359237;

  function num(el) { var v = parseFloat(String(el.value).replace(/,/g, "")); return isFinite(v) ? v : NaN; }
  function fmt(n, d) { return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }); }

  // 큰 봉지부터 채우고 남은 자투리는 가장 작은 봉지 하나로 덮는다(모자라게 사는 쪽이 더 나쁘다).
  function bagMix(need) {
    var counts = [0, 0, 0], rem = need, i;
    for (i = 0; i < BAGS.length; i++) { counts[i] = Math.floor(rem / BAGS[i]); rem -= counts[i] * BAGS[i]; }
    if (rem > 0.001) counts[BAGS.length - 1]++;
    return counts;
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function syncMode() {
    var byDims = mode.value === "dims";
    $("dims-row").hidden = !byDims;
    $("direct-row").hidden = byDims;
  }

  function calc() {
    var raw;
    if (mode.value === "dims") {
      var l = num(len), w = num(wid);
      if (isNaN(l) || isNaN(w)) return fail("tool.err.empty");
      if (l <= 0 || w <= 0) return fail("tool.err.zero");
      raw = l * w;
    } else {
      raw = num(area);
      if (isNaN(raw)) return fail("tool.err.empty");
      if (raw <= 0) return fail("tool.err.zero");
    }

    var sqft = unit.value === "m" ? raw * SQFT_PER_M2 : raw;
    if (sqft > 1000000) return fail("tool.err.range");

    var rate = RATE[grass.value] * (project.value === "over" ? 0.5 : 1);
    var lbs = sqft / 1000 * rate;
    var lbUnit = t("tool.u.lb"), sqftUnit = t("tool.u.sqft");

    var counts = bagMix(lbs), parts = [], bagLbs = 0, i;
    for (i = 0; i < BAGS.length; i++) {
      if (!counts[i]) continue;
      parts.push(counts[i] + " × " + BAGS[i] + " " + lbUnit);
      bagLbs += counts[i] * BAGS[i];
    }

    $("r-seed").textContent = fmt(lbs, lbs < 10 ? 2 : 1) + " " + lbUnit +
      " (" + fmt(lbs * LB_PER_KG, lbs < 10 ? 2 : 1) + " " + t("tool.u.kg") + ")";
    $("r-area").textContent = fmt(sqft, 0) + " " + sqftUnit + " · " + fmt(sqft / SQFT_PER_M2, 1) + " m²";
    $("r-rate").textContent = fmt(rate, rate % 1 === 0 ? 0 : 1) + " " + lbUnit + " " + t("tool.u.per1000");
    $("r-bags").textContent = parts.join(" + ");
    $("r-covers").textContent = fmt(bagLbs / rate * 1000, 0) + " " + sqftUnit;

    errEl.hidden = true;
    result.hidden = false;
  }

  function recalc() { if (!result.hidden || !errEl.hidden) calc(); }

  $("calc-btn").addEventListener("click", calc);
  [len, wid, area].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  mode.addEventListener("change", function () { syncMode(); recalc(); });
  [unit, project, grass].forEach(function (el) { el.addEventListener("change", recalc); });
  document.addEventListener("i18n:change", recalc);
  syncMode();
  // TOOLJS:END
})();
