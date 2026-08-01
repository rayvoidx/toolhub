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
  var mode = $("mode"), value = $("value"), loan = $("loan"), target = $("target"), second = $("second");
  var result = $("result"), errEl = $("err"), warnEl = $("warn"), tierEl = $("tier");
  if (!mode || !value || !loan || !target || !second || !result) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  // 통화기호·천단위 구분·% 기호가 섞여 들어와도 숫자만 남긴다.
  var num = function (el) {
    var v = parseFloat(String(el.value).replace(/[^0-9.\-]/g, ""));
    return isFinite(v) ? v : NaN;
  };
  var money = function (n) { return n.toLocaleString(undefined, { maximumFractionDigits: 0 }); };
  var pct = function (n) { return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%"; };
  var setVal = function (id, text, neg) {
    var el = $(id);
    el.textContent = text;
    el.className = neg ? "rc-val neg" : "rc-val";
  };

  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function syncFields() {
    var m = mode.value;
    $("loan-wrap").hidden = m === "maxloan";
    $("target-wrap").hidden = m !== "maxloan";
  }

  function calc() {
    var v = num(value);
    // 2순위는 선택 입력 — 비어 있으면 0, 값이 있는데 숫자가 아니면 조용히 넘기지 않는다.
    var secRaw = String(second.value).trim();
    var sec = secRaw === "" ? 0 : num(second);
    if (isNaN(v) || isNaN(sec)) return fail("tool.err.empty");
    if (v <= 0) return fail("tool.err.value");
    if (sec < 0) return fail("tool.err.negative");

    var loanV;
    if (mode.value === "maxloan") {
      var tg = num(target);
      if (isNaN(tg)) return fail("tool.err.empty");
      if (tg < 1 || tg > 125) return fail("tool.err.target");
      // 목표는 모든 담보를 합친 기준 — 2순위 잔액만큼 1순위 여력이 줄어든다.
      loanV = v * tg / 100 - sec;
      if (loanV <= 0) return fail("tool.err.noroom");
    } else {
      var ln = num(loan);
      if (isNaN(ln)) return fail("tool.err.empty");
      if (ln < 0) return fail("tool.err.negative");
      loanV = ln;
    }

    var ltv = loanV / v * 100;
    var cltv = (loanV + sec) / v * 100;
    var equity = v - loanV - sec;
    var down = v - loanV;

    var heroKey = mode.value === "maxloan" ? "tool.r.maxloan" : "tool.r.ltv";
    var heroLabel = $("r-hero-label");
    heroLabel.setAttribute("data-i18n", heroKey);
    heroLabel.textContent = t(heroKey);
    setVal("r-hero", mode.value === "maxloan" ? money(loanV) : pct(ltv), false);

    setVal("r-ltv", pct(ltv), ltv > 100);
    setVal("r-cltv", pct(cltv), cltv > 100);
    setVal("r-equity", money(equity), equity < 0);
    setVal("r-equitypct", pct(equity / v * 100), equity < 0);
    setVal("r-down", money(down), down < 0);
    // CLTV 카드는 2순위가 있을 때만 의미가 있다 — 없으면 LTV와 같은 값이라 숨긴다.
    $("cltv-card").hidden = !(sec > 0);

    var tierKey = cltv > 100 ? "tool.tier.underwater"
      : ltv > 95 ? "tool.tier.high"
      : ltv > 80 ? "tool.tier.pmi" : "tool.tier.nopmi";
    tierEl.setAttribute("data-i18n", tierKey);
    tierEl.textContent = t(tierKey);

    // 자릿수 실수(예: 가치 4,000 · 대출 320,000)는 계산은 하되 경고한다.
    warnEl.hidden = !(loanV + sec > v * 1.5);
    errEl.hidden = true;
    result.hidden = false;
  }

  mode.addEventListener("change", function () {
    syncFields();
    if (!result.hidden || !errEl.hidden) calc();
  });
  [value, loan, target, second].forEach(function (el) {
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  $("calc-btn").addEventListener("click", calc);
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  syncFields();
  // TOOLJS:END
})();
