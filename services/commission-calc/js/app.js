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
  var sale = $("sale"), structure = $("structure"), rate = $("rate");
  var tier1 = $("tier1"), thresh = $("thresh"), tier2 = $("tier2"), base = $("base"), split = $("split");
  var grpRate = $("grp-rate"), grpTier = $("grp-tier"), grpBase = $("grp-base");
  var result = $("result"), errEl = $("err"), warnEl = $("warn-tier"), bdBody = $("bd-body");
  if (!sale || !structure || !rate) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { var v = parseFloat(String(el.value).replace(/[$,\s%]/g, "")); return isFinite(v) ? v : NaN; };
  var money = function (n) { return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var money0 = function (n) { return Math.round(n).toLocaleString(); };
  var pct = function (n) { return (Math.round(n * 100) / 100) + "%"; };

  // 구조에 따라 필요한 입력만 보여준다 — 숨은 칸의 값은 읽지 않는다.
  function syncMode() {
    var m = structure.value;
    grpRate.hidden = m === "tiered";
    grpTier.hidden = m !== "tiered";
    grpBase.hidden = m !== "base";
  }

  function fail(key) { result.hidden = true; warnEl.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function row(labelKey, basis, amount) {
    var tr = document.createElement("tr");
    var c1 = document.createElement("td"), c2 = document.createElement("td"), c3 = document.createElement("td");
    c1.textContent = t(labelKey);
    c2.textContent = basis;
    c3.textContent = money(amount);
    tr.appendChild(c1); tr.appendChild(c2); tr.appendChild(c3);
    return tr;
  }

  function calc() {
    var s = num(sale);
    if (isNaN(s)) return fail("tool.err.empty");
    if (s <= 0) return fail("tool.err.sale");

    var mode = structure.value, rows = [], commission = 0, warn = false;

    if (mode === "tiered") {
      var r1 = num(tier1), r2 = num(tier2), th = num(thresh);
      if (isNaN(r1) || isNaN(r2)) return fail("tool.err.rate");
      if (r1 < 0 || r1 > 100 || r2 < 0 || r2 > 100) return fail("tool.err.rate");
      if (isNaN(th)) return fail("tool.err.fields");
      if (th < 0) return fail("tool.err.negative");
      // 초과분에만 높은 요율 — 전체 판매액에 소급 적용하지 않는다.
      var band1 = Math.min(s, th), band2 = Math.max(0, s - th);
      commission = band1 * r1 / 100 + band2 * r2 / 100;
      rows.push(["tool.bd.tier1", money0(band1) + " x " + r1 + "%", band1 * r1 / 100]);
      rows.push(["tool.bd.tier2", money0(band2) + " x " + r2 + "%", band2 * r2 / 100]);
      warn = r2 <= r1;
    } else {
      var r = num(rate);
      if (isNaN(r) || r < 0 || r > 100) return fail("tool.err.rate");
      var variable = s * r / 100;
      commission = variable;
      if (mode === "base") {
        var b = num(base);
        if (isNaN(b)) return fail("tool.err.fields");
        if (b < 0) return fail("tool.err.negative");
        commission += b;
        rows.push(["tool.bd.base", "—", b]);
        rows.push(["tool.bd.variable", money0(s) + " x " + r + "%", variable]);
      } else {
        rows.push(["tool.bd.flat", money0(s) + " x " + r + "%", variable]);
      }
    }

    // 분배율은 선택 입력 — 비워두면 기존 동작 그대로(전액 본인 몫).
    var sp = split && String(split.value).trim() !== "" ? num(split) : NaN;
    if (split && String(split.value).trim() !== "") {
      if (isNaN(sp) || sp < 0 || sp > 100) return fail("tool.err.rate");
    }

    $("r-commission").textContent = money(commission);
    $("r-effective").textContent = pct(commission / s * 100);
    $("r-net").textContent = money(s - commission);

    while (bdBody.firstChild) bdBody.removeChild(bdBody.firstChild);
    rows.forEach(function (r) { bdBody.appendChild(row(r[0], r[1], r[2])); });

    $("card-yours").hidden = isNaN(sp);
    if (!isNaN(sp)) $("r-yours").textContent = money(commission * sp / 100);

    warnEl.hidden = !warn;
    if (warn) warnEl.textContent = t("tool.warn.tier");
    errEl.hidden = true;
    result.hidden = false;
  }

  syncMode();
  $("calc-btn").addEventListener("click", calc);
  [sale, rate, tier1, thresh, tier2, base, split].forEach(function (el) {
    if (!el) return;
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  structure.addEventListener("change", function () { syncMode(); if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
