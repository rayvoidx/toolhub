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
  var net = $("net"), w2 = $("w2");
  var result = $("result"), errEl = $("err"), warnEl = $("warn"), noteEl = $("note");
  if (!net || !w2) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { var v = parseFloat(String(el.value).replace(/[^0-9.\-]/g, "")); return isFinite(v) ? v : NaN; };
  var money = function (n) { return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };

  // 2025 federal figures.
  var SE_FACTOR = 0.9235;   // 고용주 몫 7.65% 상당을 먼저 덜어낸 뒤 과세 — 직장인과의 형평.
  var SS_RATE = 0.124, MED_RATE = 0.029, ADDL_MED_RATE = 0.009;
  var SS_WAGE_BASE = 176100, ADDL_MED_THRESHOLD = 200000, FILING_FLOOR = 400;

  function fail(key) {
    result.hidden = true; warnEl.hidden = true; noteEl.hidden = true;
    errEl.hidden = false; errEl.textContent = t(key);
  }

  function show(id, txt) { $(id).textContent = txt; }

  function calc() {
    var profit = num(net);
    if (isNaN(profit)) return fail("tool.err.empty");
    if (profit <= 0) return fail("tool.err.positive");
    if (profit >= 100000000) return fail("tool.err.range");

    var wages = String(w2.value).trim() === "" ? 0 : num(w2);
    if (isNaN(wages)) return fail("tool.err.w2");
    if (wages < 0) return fail("tool.err.w2");
    if (wages >= 100000000) return fail("tool.err.range");

    var base = profit * SE_FACTOR;

    // 400 미만 순수익은 Schedule SE 자체가 면제 — 0 을 조용히 내지 말고 이유를 밝힌다.
    if (base < FILING_FLOOR) {
      show("r-setax", money(0));
      show("r-ss", money(0));
      show("r-medicare", money(0));
      show("r-base", money(Math.round(base)));
      show("r-deduction", money(0));
      show("r-quarterly", money(0));
      show("r-rate", "0.00%");
      warnEl.hidden = true;
      noteEl.textContent = t("tool.note.threshold");
      noteEl.hidden = false;
      errEl.hidden = true; result.hidden = false;
      return;
    }

    // W-2 급여가 사회보장 과세 상한을 먼저 소진한다 — 남은 여유분에만 12.4%.
    var ssRoom = Math.max(0, SS_WAGE_BASE - wages);
    var ssTaxable = Math.min(base, ssRoom);
    var ss = ssTaxable * SS_RATE;
    var medicare = base * MED_RATE;
    var seTax = ss + medicare;
    var addl = Math.max(0, (base + wages) - ADDL_MED_THRESHOLD) * ADDL_MED_RATE;

    show("r-setax", money(Math.round(seTax)));
    show("r-ss", money(Math.round(ss)));
    show("r-medicare", money(Math.round(medicare)));
    show("r-base", money(Math.round(base)));
    show("r-deduction", money(Math.round(seTax / 2)));
    show("r-quarterly", money(Math.round(seTax / 4)));
    show("r-rate", (seTax / profit * 100).toFixed(2) + "%");

    var msgs = [];
    if (addl > 0) msgs.push(t("tool.warn.addl") + " " + money(Math.round(addl)));
    if (base > ssRoom) msgs.push(t("tool.warn.cap"));
    warnEl.textContent = msgs.join(" ");
    warnEl.hidden = msgs.length === 0;

    noteEl.textContent = t("tool.warn.quarterly");
    noteEl.hidden = false;
    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [net, w2].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
