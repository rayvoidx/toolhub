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
  var unit = $("unit"), len = $("len"), wid = $("wid"), depth = $("depth"), type = $("type");
  var result = $("result"), errEl = $("err"), liftNote = $("lift-note");
  if (!unit || !len || !wid || !depth || !type) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var FT_PER_M = 3.280839895, IN_PER_CM = 0.3937007874;
  var M3_PER_YD3 = 0.764554858, TONNE_PER_TON = 0.90718474;

  function num(el) { return parseFloat(String(el.value).replace(/,/g, "")); }
  function grp(s) { var p = s.split("."); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ","); return p.join("."); }
  function fmt(v) {
    var s = v >= 100 ? v.toFixed(0) : (v >= 10 ? v.toFixed(1) : v.toFixed(2));
    if (s.indexOf(".") > -1) s = s.replace(/\.?0+$/, "");
    return grp(s);
  }

  // 단위 접미사는 data-i18n 이 아니라 JS 가 채운다 — 선택한 단위계에 따라 키가 달라지기 때문.
  function setUnits() {
    var m = unit.value === "m";
    $("u-len").textContent = t(m ? "tool.u.m" : "tool.u.ft");
    $("u-wid").textContent = t(m ? "tool.u.m" : "tool.u.ft");
    $("u-depth").textContent = t(m ? "tool.u.cm" : "tool.u.in");
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var l = num(len), w = num(wid), d = num(depth);
    if (!isFinite(l) || !isFinite(w) || !isFinite(d)) return fail("tool.err.empty");
    if (l <= 0 || w <= 0 || d <= 0) return fail("tool.err.zero");

    var metric = unit.value === "m";
    var lFt = metric ? l * FT_PER_M : l;
    var wFt = metric ? w * FT_PER_M : w;
    var dIn = metric ? d * IN_PER_CM : d;
    if (lFt > 5000 || wFt > 5000 || dIn > 60) return fail("tool.err.range");

    // 부피는 전부 피트로 맞춘 뒤 27로 나눠 세제곱야드로 — 업계 견적 단위가 yd³ 라서.
    var areaFt2 = lFt * wFt;
    var yd3 = areaFt2 * (dIn / 12) / 27;
    var tons = yd3 * parseFloat(type.value) / 2000;

    $("r-yards").textContent = fmt(yd3) + " yd³";
    $("r-tons").textContent = fmt(tons) + " " + t("tool.u.tons");
    $("r-area").textContent = metric ? fmt(l * w) + " m²" : fmt(areaFt2) + " ft²";
    $("r-order").textContent = fmt(yd3 * 1.1) + " yd³ · " + fmt(tons * 1.1) + " " + t("tool.u.tons");
    $("r-metric").textContent = fmt(yd3 * M3_PER_YD3) + " m³ · " + fmt(tons * TONNE_PER_TON) + " " + t("tool.u.tonnes");
    liftNote.hidden = dIn <= 12;

    errEl.hidden = true;
    result.hidden = false;
  }

  setUnits();
  $("calc-btn").addEventListener("click", calc);
  [len, wid, depth].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  unit.addEventListener("change", function () { setUnits(); if (!result.hidden || !errEl.hidden) calc(); });
  type.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { setUnits(); if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
