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
  var temp = $("temp"), unit = $("unit"), rh = $("rh");
  var result = $("result"), errEl = $("err");
  if (!temp || !unit || !rh) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var toF = function (c) { return c * 9 / 5 + 32; };
  var toC = function (f) { return (f - 32) * 5 / 9; };

  // NWS Rothfusz 회귀 (°F, %RH) + 저습도·고습도 보정.
  function rothfusz(T, R) {
    var hi = -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R
      - 0.00683783 * T * T - 0.05481717 * R * R + 0.00122874 * T * T * R
      + 0.00085282 * T * R * R - 0.00000199 * T * T * R * R;
    if (R < 13 && T >= 80 && T <= 112) hi -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    else if (R > 85 && T >= 80 && T <= 87) hi += ((R - 85) / 10) * ((87 - T) / 5);
    return hi;
  }
  // NWS 절차: 단순식(Steadman 평균)을 먼저 구하고, 기온과의 평균이 80°F 미만이면 그 값을 쓴다.
  function heatIndexF(T, R) {
    var simple = 0.5 * (T + 61 + (T - 68) * 1.2 + R * 0.094);
    if ((simple + T) / 2 < 80) return { f: simple, mild: true };
    return { f: rothfusz(T, R), mild: false };
  }
  function category(hiF) {
    if (hiF < 80) return "none";
    if (hiF < 90) return "caution";
    if (hiF < 103) return "extcaution";
    if (hiF < 125) return "danger";
    return "extdanger";
  }

  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function calc() {
    var rawT = parseFloat(String(temp.value).replace(/,/g, ""));
    var rawR = parseFloat(String(rh.value).replace(/,/g, ""));
    if (!isFinite(rawT) || !isFinite(rawR)) return fail("tool.err.empty");
    if (rawR < 0 || rawR > 100) return fail("tool.err.rh");

    var tf = unit.value === "c" ? toF(rawT) : rawT;
    if (tf < -60 || tf > 140) return fail("tool.err.temp");

    var out = heatIndexF(tf, rawR);
    var hiF = out.f, hiC = toC(hiF);
    var fTxt = Math.round(hiF) + "°F", cTxt = (Math.round(hiC * 10) / 10) + "°C";
    $("r-hi").textContent = unit.value === "c" ? cTxt + " / " + fTxt : fTxt + " / " + cTxt;

    var cat = category(hiF);
    var catEl = $("r-cat");
    catEl.className = "rc-val cat-" + cat;
    catEl.textContent = t("tool.cat." + cat);

    // 습도가 더한 폭 = 열지수 - 실제 기온. 음수(건조·저온)면 0 으로 보여 오해를 막는다.
    var dF = hiF - tf;
    if (dF < 0) dF = 0;
    var dC = dF * 5 / 9;
    $("r-diff").textContent = "+" + (Math.round(dF * 10) / 10) + "°F / +" + (Math.round(dC * 10) / 10) + "°C";

    $("r-safe").textContent = t("tool.safe." + cat);
    var mild = $("r-mild");
    mild.textContent = t("tool.note.mild");
    mild.hidden = !out.mild;

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [temp, rh].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  unit.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
