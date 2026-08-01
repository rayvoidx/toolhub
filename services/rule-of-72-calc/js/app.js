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
  var mode = $("mode"), rate = $("rate"), years = $("years");
  var rateField = $("rate-field"), yearsField = $("years-field");
  var result = $("result"), errEl = $("err");
  if (!mode || !rate || !years) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { return parseFloat(String(el.value).replace(/,/g, "")); };
  var fix = function (n, d) { return n.toFixed(d); };
  var signed = function (n, d) { return (n < 0 ? "-" : "+") + Math.abs(n).toFixed(d); };
  var put = function (id, txt) { $(id).textContent = txt; };

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function syncFields() {
    var wantRate = mode.value === "rate";
    rateField.hidden = wantRate;
    yearsField.hidden = !wantRate;
  }

  function calc() {
    var yr = t("tool.unit.years"), about = t("tool.word.about");
    var r, dbl, mainKey, mainTxt;

    if (mode.value === "rate") {
      // 목표 기간 → 필요한 수익률. 정확값은 2^(1/n)-1 (연복리).
      var target = num(years);
      if (!isFinite(target)) return fail("tool.err.empty");
      if (target <= 0 || target > 200) return fail("tool.err.years");
      r = 72 / target;
      var exactRate = (Math.pow(2, 1 / target) - 1) * 100;
      dbl = target;
      mainKey = "tool.r.rate";
      mainTxt = about + " " + fix(r, 2) + "%";
      put("r-exact", fix(exactRate, 2) + "%");
      put("r-delta", signed(r - exactRate, 2) + " " + t("tool.unit.pp"));
    } else {
      // 수익률 → 두 배 기간. 정확값은 ln(2)/ln(1+r).
      r = num(rate);
      if (!isFinite(r)) return fail("tool.err.empty");
      if (r <= 0 || r > 100) return fail("tool.err.rate");
      dbl = 72 / r;
      var exactYears = Math.log(2) / Math.log(1 + r / 100);
      mainKey = "tool.r.double";
      mainTxt = about + " " + fix(dbl, 1) + " " + yr;
      put("r-exact", fix(exactYears, 1) + " " + yr);
      put("r-delta", signed(dbl - exactYears, 2) + " " + yr);
    }

    var lbl = $("r-main-label");
    lbl.setAttribute("data-i18n", mainKey);
    lbl.textContent = t(mainKey);
    put("r-main", mainTxt);
    put("r-triple", fix(114 / r, 1) + " " + yr);
    put("r-quad", fix(144 / r, 1) + " " + yr);
    // 두 배가 두 번이면 네 배 — 같은 배율 시계로 타임라인을 보여준다.
    put("r-illus", "$10,000 → $20,000: " + fix(dbl, 1) + " " + yr + "  ·  $20,000 → $40,000: " + fix(dbl * 2, 1) + " " + yr);

    errEl.hidden = true;
    result.hidden = false;
  }

  syncFields();
  $("calc-btn").addEventListener("click", calc);
  [rate, years].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  mode.addEventListener("change", function () {
    syncFields();
    if (!result.hidden || !errEl.hidden) calc();
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
