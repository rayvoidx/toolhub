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
  var solve = $("solve"), val = $("value"), unit = $("unit");
  var result = $("result"), errEl = $("err");
  if (!solve || !val || !unit) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var C = 299792458;          // 진공 광속 — 1983년 미터 정의 이후 오차 없는 정확값
  var H = 6.62607015e-34;     // 플랑크 상수 (2019 SI 재정의로 정확값)
  var EV = 1.602176634e-19;   // 1 eV = 이 만큼의 줄

  var FREQ_UNITS = [["Hz", 1], ["kHz", 1e3], ["MHz", 1e6], ["GHz", 1e9], ["THz", 1e12]];
  var WL_UNITS = [["m", 1], ["cm", 1e-2], ["mm", 1e-3], ["\u00b5m", 1e-6], ["nm", 1e-9]];

  // 표시용 사다리 — 큰 단위부터. cm 는 SI 접두어 계단을 벗어나지만 12.5 cm(와이파이) 같은
  // 일상 감각을 살리려고 일부러 넣었다.
  var FREQ_SCALE = [["EHz", 1e18], ["PHz", 1e15], ["THz", 1e12], ["GHz", 1e9], ["MHz", 1e6], ["kHz", 1e3], ["Hz", 1]];
  var WL_SCALE = [["km", 1e3], ["m", 1], ["cm", 1e-2], ["mm", 1e-3], ["\u00b5m", 1e-6], ["nm", 1e-9], ["pm", 1e-12]];
  var TIME_SCALE = [["s", 1], ["ms", 1e-3], ["\u00b5s", 1e-6], ["ns", 1e-9], ["ps", 1e-12], ["fs", 1e-15], ["as", 1e-18]];
  var EV_SCALE = [["MeV", 1e6], ["keV", 1e3], ["eV", 1], ["meV", 1e-3], ["\u00b5eV", 1e-6], ["neV", 1e-9]];

  function sig(x) {
    var s = x.toPrecision(4);
    if (s.indexOf("e") < 0 && s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s;
  }
  function fmt(x, scale) {
    for (var i = 0; i < scale.length; i++) {
      if (x >= scale[i][1]) return sig(x / scale[i][1]) + " " + scale[i][0];
    }
    var last = scale[scale.length - 1];
    return (x / last[1]).toExponential(3) + " " + last[0];
  }

  // 가시광 안에서는 색 이름까지 붙인다 (경계는 관례값 — 실제 눈의 감도는 서서히 줄어든다).
  function visible(nm) {
    if (nm >= 620) return ["tool.color.red", "#ef4444"];
    if (nm >= 590) return ["tool.color.orange", "#f97316"];
    if (nm >= 570) return ["tool.color.yellow", "#eab308"];
    if (nm >= 495) return ["tool.color.green", "#22c55e"];
    if (nm >= 450) return ["tool.color.blue", "#3b82f6"];
    return ["tool.color.violet", "#8b5cf6"];
  }
  function band(lam) {
    if (lam > 1) return { k: "tool.band.radio", c: "#64748b" };
    if (lam > 1e-3) return { k: "tool.band.micro", c: "#0ea5e9" };
    if (lam > 750e-9) return { k: "tool.band.ir", c: "#b91c1c" };
    if (lam >= 380e-9) {
      var v = visible(lam * 1e9);
      return { k: "tool.band.visible", c: v[1], ck: v[0] };
    }
    if (lam >= 10e-9) return { k: "tool.band.uv", c: "#7c3aed" };
    if (lam >= 10e-12) return { k: "tool.band.xray", c: "#0f766e" };
    return { k: "tool.band.gamma", c: "#be123c" };
  }

  function unitsFor(mode) {
    if (mode === "wl") return FREQ_UNITS;
    if (mode === "fr") return WL_UNITS;
    return FREQ_UNITS.concat(WL_UNITS);
  }
  // 모드에 따라 단위 목록을 다시 만든다. 기존 선택이 새 목록에 있으면 유지.
  function setUnits() {
    var list = unitsFor(solve.value), prev = unit.value, keep = false, i, o;
    for (i = 0; i < list.length; i++) if (list[i][0] === prev) keep = true;
    while (unit.firstChild) unit.removeChild(unit.firstChild);
    for (i = 0; i < list.length; i++) {
      o = document.createElement("option");
      o.value = list[i][0];
      o.textContent = list[i][0];
      unit.appendChild(o);
    }
    unit.value = keep ? prev : (solve.value === "fr" ? "m" : "MHz");
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var raw = parseFloat(String(val.value).replace(/,/g, ""));
    if (!isFinite(raw)) return fail("tool.err.empty");
    if (raw <= 0) return fail("tool.err.zero");

    var u = unit.value, f = 0, lam = 0, isFreq = null, i;
    for (i = 0; i < FREQ_UNITS.length; i++) if (FREQ_UNITS[i][0] === u) { isFreq = true; f = raw * FREQ_UNITS[i][1]; }
    for (i = 0; i < WL_UNITS.length; i++) if (WL_UNITS[i][0] === u) { isFreq = false; lam = raw * WL_UNITS[i][1]; }
    if (isFreq === null) return fail("tool.err.range");
    if (isFreq) lam = C / f; else f = C / lam;
    // 오버플로/언더플로는 조용히 넘기지 않고 범위 안내로 돌린다.
    if (!isFinite(f) || f <= 0 || !isFinite(lam) || lam <= 0) return fail("tool.err.range");

    var joule = H * f, ev = joule / EV, b = band(lam), mode = solve.value;
    var mainKey = mode === "fr" ? "tool.r.frequency" : (mode === "pe" ? "tool.r.energy" : "tool.r.wavelength");
    var lbl = $("r-main-label");
    lbl.setAttribute("data-i18n", mainKey);
    lbl.textContent = t(mainKey);
    $("r-main").textContent = mode === "fr" ? fmt(f, FREQ_SCALE) : (mode === "pe" ? fmt(ev, EV_SCALE) : fmt(lam, WL_SCALE));
    $("r-main-sub").textContent = mode === "pe" ? joule.toExponential(3) + " J" : "";

    $("r-wl").textContent = fmt(lam, WL_SCALE);
    $("r-freq").textContent = fmt(f, FREQ_SCALE);
    $("r-ev").textContent = fmt(ev, EV_SCALE);
    $("r-joule").textContent = joule.toExponential(3) + " J";
    $("r-period").textContent = fmt(1 / f, TIME_SCALE);
    $("r-band").textContent = t(b.k) + (b.ck ? " \u00b7 " + t(b.ck) : "");
    $("band-dot").style.background = b.c;

    // 히어로에 이미 나온 값은 카드에서 뺀다.
    $("c-wl").hidden = mode === "wl";
    $("c-freq").hidden = mode === "fr";
    $("c-energy").hidden = mode === "pe";

    errEl.hidden = true;
    result.hidden = false;
  }

  function live() { return !result.hidden || !errEl.hidden; }

  $("calc-btn").addEventListener("click", calc);
  val.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  solve.addEventListener("change", function () { setUnits(); if (live()) calc(); });
  unit.addEventListener("change", function () { if (live()) calc(); });
  document.addEventListener("i18n:change", function () { if (live()) calc(); });
  setUnits();
  // TOOLJS:END
})();
