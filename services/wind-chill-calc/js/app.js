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
  var temp = $("temp"), tempunit = $("tempunit"), wind = $("wind"), windunit = $("windunit");
  var result = $("result"), errEl = $("err"), noteRange = $("note-range");
  if (!temp || !tempunit || !wind || !windunit) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // NWS/Environment Canada 2001 — 화씨·mph 기준. 유효 구간: T <= 50F, V >= 3mph.
  function chillF(tF, vMph) {
    var p = Math.pow(vMph, 0.16);
    return 35.74 + 0.6215 * tF - 35.75 * p + 0.4275 * tF * p;
  }
  function toC(f) { return (f - 32) * 5 / 9; }
  // -0.04 → "-0.0" 같은 표시를 막는다.
  function fx(n, d) { return n.toFixed(d).replace(/^-(0(?:\.0+)?)$/, "$1"); }

  function riskKey(wcF) {
    if (wcF <= -48) return "tool.risk.min5";
    if (wcF <= -32) return "tool.risk.min10";
    if (wcF <= -18) return "tool.risk.min30";
    return "tool.risk.low";
  }
  function riskClass(wcF) {
    if (wcF <= -32) return "risk-danger";
    if (wcF <= -18) return "risk-warn";
    return "";
  }
  function catKey(wcF) {
    if (wcF >= 32) return "tool.cat.chilly";
    if (wcF >= 16) return "tool.cat.cold";
    if (wcF >= 0) return "tool.cat.verycold";
    if (wcF >= -18) return "tool.cat.frigid";
    return "tool.cat.extreme";
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var rawT = parseFloat(String(temp.value).replace(/,/g, ""));
    var rawV = parseFloat(String(wind.value).replace(/,/g, ""));
    if (!isFinite(rawT) || !isFinite(rawV)) return fail("tool.err.empty");
    if (rawV < 0) return fail("tool.err.wind");

    var tF = tempunit.value === "c" ? rawT * 9 / 5 + 32 : rawT;
    if (tF < -148 || tF > 158) return fail("tool.err.temp");
    var vMph = windunit.value === "kmh" ? rawV / 1.609344 : rawV;

    // 유효 구간 밖에서는 공식이 정의되지 않는다 — 조용히 외삽하지 않고 실제 기온을 그대로 보여준다.
    var inRange = tF <= 50 && vMph >= 3;
    var wcF = inRange ? chillF(tF, vMph) : tF;
    var dropF = tF - wcF;

    // 두 단위를 같은 자릿수로 반올림해야 13 °F / -10.8 °C 처럼 어긋나 보이지 않는다.
    $("r-feels").textContent = fx(wcF, 0) + " °F / " + fx(toC(wcF), 0) + " °C";
    $("r-drop").textContent = fx(dropF, 0) + " °F / " + fx(dropF * 5 / 9, 0) + " °C";
    $("r-cat").textContent = t(catKey(wcF));
    var riskEl = $("r-risk");
    riskEl.textContent = t(riskKey(wcF));
    riskEl.className = "rc-val risk-small " + riskClass(wcF);

    noteRange.textContent = inRange ? "" : t("tool.note.range");
    noteRange.hidden = inRange;
    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [temp, wind].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [temp, wind, tempunit, windunit].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
