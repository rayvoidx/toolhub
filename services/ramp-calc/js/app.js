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
  var rise = $("rise"), unit = $("unit"), app = $("app");
  var custom = $("custom-ratio"), customWrap = $("custom-wrap");
  var result = $("result"), errEl = $("err"), notes = $("notes");
  if (!rise || !unit || !app) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 기울기 분모: ADA 공공 1:12, 주거 탑승 1:8, 비탑승 하역 1:6.
  var RATIO = { walk: 20, uk15: 15, ada: 12, res10: 10, res: 8, unocc: 6 };
  var MAX_RUN_RISE = 30;   // 한 구간(run)당 최대 높이 30in — ADA 405.6
  var LANDING = 60;        // 참 한 곳의 길이 60in (5ft)
  var HANDRAIL_AT = 6;     // 높이 6in 초과면 양쪽 핸드레일 — ADA 405.8

  function fmtLen(inches) {
    var whole = Math.round(inches);
    var ft = Math.floor(whole / 12), inch = whole - ft * 12;
    var m = (inches * 0.0254).toFixed(2);
    return ft + " " + t("tool.u.ft") + " " + inch + " " + t("tool.u.in") + " (" + m + " " + t("tool.u.m") + ")";
  }

  function note(key, cls, n) {
    var p = document.createElement("p");
    var txt = t(key);
    if (n !== undefined) txt = txt.replace("{n}", String(n));
    p.textContent = txt;
    if (cls) p.className = cls;
    notes.appendChild(p);
  }

  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function calc() {
    var raw = parseFloat(String(rise.value).replace(/,/g, ""));
    if (!isFinite(raw)) return fail("tool.err.empty");
    var riseIn = unit.value === "cm" ? raw / 2.54 : raw;
    if (riseIn <= 0) return fail("tool.err.zero");
    if (riseIn > 240) return fail("tool.err.range");

    var ratio;
    if (app.value === "custom") {
      ratio = parseFloat(String(custom.value).replace(/,/g, ""));
      if (!isFinite(ratio) || ratio < 4 || ratio > 20) return fail("tool.err.slope");
    } else {
      ratio = RATIO[app.value] || 12;
    }
    var run = riseIn * ratio;
    // 1:20 이하는 ADA상 '경사로'가 아닌 보행로 — 구간 분할·핸드레일 의무 없음.
    var isWalkway = ratio >= 20;
    var needsRail = !isWalkway && riseIn > HANDRAIL_AT;
    var mid = isWalkway ? 0 : Math.max(0, Math.ceil(riseIn / MAX_RUN_RISE) - 1);
    var deg = Math.atan(1 / ratio) * 180 / Math.PI;

    $("r-length").textContent = fmtLen(run);
    $("r-slope").textContent = "1:" + (Math.round(ratio * 10) / 10) + " · " + deg.toFixed(1) + "° · " + (100 / ratio).toFixed(1) + "%";
    $("r-landings").textContent = String(mid + 2);
    $("r-handrail").textContent = t(needsRail ? "tool.v.hr.yes" : "tool.v.hr.no");
    $("r-footprint").textContent = fmtLen(run + mid * LANDING + 2 * LANDING);

    while (notes.firstChild) notes.removeChild(notes.firstChild);
    if (ratio < 12) note("tool.note.caution", "warn");
    if (riseIn > 60) note("tool.note.lift", "warn");
    if (mid > 0) note("tool.note.mid", "", mid);
    if (needsRail) note("tool.note.handrail");
    note("tool.note.landing");
    note("tool.note.width");

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  rise.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  app.addEventListener("change", function () { customWrap.hidden = app.value !== "custom"; });
  custom.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  [unit, app, custom].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
