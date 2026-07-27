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
  var amount = $("amount"), state = $("state"), local = $("local"), customRate = $("custom-rate");
  var result = $("result"), errEl = $("err");
  if (!amount || !state) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { var v = parseFloat(String(el.value).replace(/[$,\s]/g, "")); return isFinite(v) ? v : NaN; };
  var money = function (n) { return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var mode = function () { var r = document.querySelector('input[name="mode"]:checked'); return r ? r.value : "add"; };

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function combinedRate() {
    var base = state.value === "custom" ? num(customRate) : parseFloat(state.value);
    var extra = num(local);
    if (!isFinite(extra)) extra = 0;
    if (!isFinite(base)) return NaN;
    return base + extra;
  }

  function calc() {
    var amt = num(amount);
    if (isNaN(amt)) return fail("tool.err.empty");
    if (amt <= 0) return fail("tool.err.positive");

    var rate = combinedRate();
    if (isNaN(rate) || rate < 0 || rate > 30) return fail("tool.err.rate");

    var pre, tax, total;
    if (mode() === "add") {
      pre = amt; tax = amt * rate / 100; total = pre + tax;
    } else {
      // 총액에서 세율을 빼면 안 된다 — 나눠야 세전 가격이 나온다.
      total = amt; pre = amt / (1 + rate / 100); tax = total - pre;
    }

    $("r-total").textContent = money(total);
    $("r-pre").textContent = money(pre);
    $("r-tax").textContent = money(tax);
    $("r-rate").textContent = (Math.round(rate * 1000) / 1000) + "%";

    errEl.hidden = true;
    result.hidden = false;
  }

  state.addEventListener("change", function () {
    $("custom-wrap").hidden = state.value !== "custom";
    if (!result.hidden || !errEl.hidden) calc();
  });
  [amount, local, customRate].forEach(function (el) {
    if (!el) return;
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="mode"]'), function (r) {
    r.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  $("calc-btn").addEventListener("click", calc);
  document.addEventListener("i18n:change", function () { if (!errEl.hidden) calc(); });
  // TOOLJS:END
})();
