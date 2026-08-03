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
  var price = $("price"), vcost = $("vcost"), fixed = $("fixed"), target = $("target"), sales = $("sales");
  var result = $("result"), errEl = $("err"), tcard = $("card-target"), mcard = $("card-mos");
  if (!price || !vcost || !fixed) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  // 통화 기호·천 단위 쉼표·공백을 걷어낸 뒤 파싱한다. 글자만 남으면 빈 문자열 → NaN 으로 걸린다.
  var num = function (el) {
    var v = parseFloat(String(el.value).replace(/[^0-9.\-]/g, ""));
    return isFinite(v) ? v : NaN;
  };
  var money = function (n) { return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var whole = function (n) { return n.toLocaleString(undefined, { maximumFractionDigits: 0 }); };

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var p = num(price), v = num(vcost), f = num(fixed);
    if (isNaN(p) || isNaN(v) || isNaN(f)) return fail("tool.err.empty");
    if (p <= 0 || v < 0 || f < 0) return fail("tool.err.positive");

    // 공헌이익이 0 이하이면 아무리 팔아도 고정비를 못 메운다 — 수식상 무한대라 값을 내지 않는다.
    var cm = p - v;
    if (cm <= 0) return fail("tool.err.margin");

    // 단위는 쪼개 팔 수 없으므로 올림. 내림하면 실제로는 여전히 적자다.
    var beUnits = Math.ceil(f / cm);
    $("r-units").textContent = whole(beUnits);
    $("r-revenue").textContent = money(beUnits * p);
    $("r-cm").textContent = money(cm);
    $("r-cmratio").textContent = (cm / p * 100).toFixed(1) + "%";

    var raw = target ? String(target.value).trim() : "";
    if (raw === "") {
      tcard.hidden = true;
    } else {
      var g = num(target);
      if (isNaN(g) || g < 0) return fail("tool.err.target");
      $("r-target").textContent = whole(Math.ceil((f + g) / cm));
      tcard.hidden = false;
    }

    // 안전한계율: 현재 판매량이 손익분기점 대비 얼마나 여유가 있는지. 0 이하면 비율이 정의되지 않는다.
    var srow = sales ? String(sales.value).trim() : "";
    if (srow === "") {
      mcard.hidden = true;
    } else {
      var s = num(sales);
      if (isNaN(s) || s <= 0) return fail("tool.err.sales");
      $("r-mos").textContent = ((s - beUnits) / s * 100).toFixed(1) + "%";
      mcard.hidden = false;
    }

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [price, vcost, fixed, target, sales].forEach(function (el) {
    if (!el) return;
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
