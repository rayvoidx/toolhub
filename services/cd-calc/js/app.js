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
  var deposit = $("deposit"), apy = $("apy"), term = $("term"), months = $("months"), penalty = $("penalty");
  var monthsRow = $("months-row"), result = $("result"), errEl = $("err");
  var noteBreak = $("note-break"), notePrincipal = $("note-principal"), noteApy = $("note-apy");
  if (!deposit || !apy || !term || !months || !penalty) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (v) { return parseFloat(String(v).replace(/[$,%\s]/g, "")); };
  var money = function (n) { return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var fill = function (key, vals) {
    var s = t(key);
    for (var p in vals) { if (Object.prototype.hasOwnProperty.call(vals, p)) s = s.split("{" + p + "}").join(vals[p]); }
    return s;
  };
  // 비교 기준은 4% 고금리 저축계좌로 고정 — 문구에도 4%라고 명시한다.
  var HYSA = 0.04;

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var P = num(deposit.value), r = num(apy.value);
    if (!isFinite(P) || !isFinite(r)) return fail("tool.err.empty");
    if (P <= 0) return fail("tool.err.deposit");
    if (r <= 0 || r > 100) return fail("tool.err.apy");

    var m;
    if (term.value === "custom") {
      m = num(months.value);
      if (!isFinite(m) || m < 1 || m > 600) return fail("tool.err.months");
      m = Math.round(m);
    } else {
      m = parseInt(term.value, 10);
    }

    var rate = r / 100;
    // APY 기준: 복리가 이미 이율에 반영돼 있으므로 연 단위 지수만 올린다 (월 복리 재적용 아님).
    var maturity = P * Math.pow(1 + rate, m / 12);
    var interest = maturity - P;
    // 은행 관행: 해지 금액에 대한 "N개월치 이자"를 약정 이율 기준 단리로 뗀다.
    var pen = P * rate * (parseInt(penalty.value, 10) / 12);

    $("r-maturity").textContent = money(maturity);
    $("r-sub").textContent = fill("tool.r.sub", { p: money(P), r: r + "%", m: m });
    $("r-interest").textContent = money(interest);
    $("r-monthly").textContent = money(interest / m);
    $("r-penalty").textContent = "-" + money(pen);

    // 월별로 훑어 페널티 차감 후 4% 저축계좌를 넘어서는 첫 달과, 원금이 깎이지 않게 되는 첫 달을 찾는다.
    var breakMonth = 0, principalMonth = 0, k, net;
    for (k = 1; k <= m; k++) {
      net = P * Math.pow(1 + rate, k / 12) - pen;
      if (!principalMonth && net >= P) principalMonth = k;
      if (!breakMonth && net >= P * Math.pow(1 + HYSA, k / 12)) breakMonth = k;
    }
    noteBreak.textContent = breakMonth === 1 ? t("tool.note.always")
      : breakMonth > 1 ? fill("tool.note.break", { m: breakMonth })
      : t("tool.note.nobreak");
    if (principalMonth > 1) {
      notePrincipal.textContent = fill("tool.note.principal", { m: principalMonth });
      notePrincipal.hidden = false;
    } else {
      notePrincipal.hidden = true;
    }
    // 10% 초과는 오타이거나 CD가 아닌 상품 — 계산은 하되 경고를 띄운다.
    noteApy.textContent = t("tool.note.highapy");
    noteApy.hidden = r <= 10;

    errEl.hidden = true;
    result.hidden = false;
  }

  function syncTerm() { monthsRow.hidden = term.value !== "custom"; }
  syncTerm();

  $("calc-btn").addEventListener("click", calc);
  [deposit, apy, months].forEach(function (el) {
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [term, penalty].forEach(function (el) {
    el.addEventListener("change", function () { syncTerm(); if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
