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
  var method = $("method"), dist = $("dist"), dunit = $("dunit"), rhr = $("rhr"), mhr = $("mhr");
  var mm = $("mm"), ss = $("ss"), age = $("age");
  var result = $("result"), errEl = $("err");
  if (!method || !dist || !rhr || !mhr || !mm || !ss || !age) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // Cooper Institute 규준 — [연령 상한, 우수, 양호, 보통] (ml/kg/min). 아래는 '평균 이하'.
  var NORMS = {
    male: [[29, 52, 45, 38], [39, 50, 43, 36], [49, 47, 40, 34], [59, 43, 36, 31], [200, 39, 33, 27]],
    female: [[29, 46, 39, 33], [39, 44, 37, 31], [49, 41, 34, 28], [59, 37, 31, 25], [200, 34, 28, 23]]
  };

  function bandFor(sex, a) {
    var rows = NORMS[sex] || NORMS.male;
    for (var i = 0; i < rows.length; i++) { if (a <= rows[i][0]) return rows[i]; }
    return rows[rows.length - 1];
  }
  function ratingOf(v, row) {
    if (v >= row[1]) return "excellent";
    if (v >= row[2]) return "good";
    if (v >= row[3]) return "average";
    return "below";
  }
  function sexValue() {
    var r = document.querySelector('input[name="sex"]:checked');
    return r ? r.value : "male";
  }
  function num(el) {
    var s = String(el.value).replace(/[,\s]/g, "");
    if (s === "") return NaN;
    var v = parseFloat(s);
    return isFinite(v) ? v : NaN;
  }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function syncFields() {
    var m = method.value;
    $("cooper-wrap").hidden = m !== "cooper";
    $("rhr-wrap").hidden = m !== "rhr";
    $("run-wrap").hidden = m !== "run15";
  }

  function calc() {
    var m = method.value;
    var a = num(age);
    if (isNaN(a)) return fail("tool.err.empty");
    if (a < 10 || a > 100) return fail("tool.err.age");

    var vo2, noteKey;
    if (m === "rhr") {
      var hr = num(rhr);
      if (isNaN(hr)) return fail("tool.err.empty");
      if (hr < 30 || hr > 120) return fail("tool.err.hr");
      var maxHr = 208 - 0.7 * a; // Tanaka 추정
      noteKey = "tool.note.rhr";
      if (String(mhr.value).trim() !== "") {
        var mv = num(mhr);
        if (isNaN(mv) || mv < 100 || mv > 230) return fail("tool.err.mhr");
        if (mv <= hr) return fail("tool.err.mhrOrder");
        maxHr = mv;
        noteKey = "tool.note.rhrCustom";
      }
      vo2 = 15.3 * (maxHr / hr); // Uth–Sørensen
    } else if (m === "run15") {
      var mins = num(mm);
      var secRaw = String(ss.value).replace(/[,\s]/g, "");
      var secs = secRaw === "" ? 0 : parseFloat(secRaw);
      if (isNaN(mins) || !isFinite(secs)) return fail("tool.err.empty");
      if (secs < 0 || secs >= 60) return fail("tool.err.time");
      var total = mins + secs / 60;
      if (total < 5 || total > 25) return fail("tool.err.time");
      vo2 = 3.5 + 483 / total;
      noteKey = "tool.note.run15";
    } else {
      var d = num(dist);
      if (isNaN(d)) return fail("tool.err.empty");
      var meters = dunit.value === "mi" ? d * 1609.344 : (dunit.value === "km" ? d * 1000 : d);
      if (meters < 700 || meters > 7500) return fail("tool.err.dist");
      vo2 = (meters - 504.9) / 44.73;
      noteKey = "tool.note.cooper";
    }

    var row = bandFor(sexValue(), a);
    var rate = ratingOf(vo2, row);
    $("r-vo2").textContent = vo2.toFixed(1);
    var rEl = $("r-rating");
    rEl.className = "rc-val rate-" + rate;
    rEl.textContent = t("tool.rate." + rate);
    $("r-mets").textContent = (vo2 / 3.5).toFixed(1);
    $("r-target").textContent = row[1] + " ml/kg/min";
    $("r-note").textContent = t(noteKey);

    errEl.hidden = true;
    result.hidden = false;
  }

  var live = function () { if (!result.hidden || !errEl.hidden) calc(); };

  syncFields();
  $("calc-btn").addEventListener("click", calc);
  [dist, rhr, mhr, mm, ss, age].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  method.addEventListener("change", function () { syncFields(); live(); });
  dunit.addEventListener("change", live);
  Array.prototype.forEach.call(document.querySelectorAll('input[name="sex"]'), function (el) {
    el.addEventListener("change", live);
  });
  document.addEventListener("i18n:change", live);
  // TOOLJS:END
})();
