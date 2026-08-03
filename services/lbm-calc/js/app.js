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
  var height = $("height"), hunit = $("hunit"), weight = $("weight"), wunit = $("wunit"), bodyfat = $("bodyfat");
  var height2 = $("height2"), weight2 = $("weight2"), h2wrap = $("h2-wrap"), w2wrap = $("w2-wrap");
  var result = $("result"), errEl = $("err");
  if (!height || !hunit || !weight || !wunit || !bodyfat) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { return parseFloat(String(el.value).replace(/,/g, "")); };
  var LB = 0.45359237;

  // 세 공식 모두 W=kg, H=cm 입력으로 발표된 회귀식이다 — 단위 변환을 끝내고 넣는다.
  function boer(kg, cm, male) {
    return male ? 0.407 * kg + 0.267 * cm - 19.2 : 0.252 * kg + 0.473 * cm - 48.3;
  }
  function james(kg, cm, male) {
    var r = kg / cm;
    return male ? 1.1 * kg - 128 * r * r : 1.07 * kg - 148 * r * r;
  }
  function hume(kg, cm, male) {
    return male ? 0.32810 * kg + 0.33929 * cm - 29.5336 : 0.29569 * kg + 0.41813 * cm - 43.2933;
  }

  function fmt(kg) {
    if (!isFinite(kg) || kg <= 0) return "—";
    return kg.toFixed(1) + " kg (" + (kg / LB).toFixed(1) + " lb)";
  }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  // 빈칸은 0으로 보되, 값이 있으면 자릿수 범위를 검사한다 (9피트 30인치 같은 입력 차단).
  function part(el, max) {
    var raw = el ? String(el.value).replace(/,/g, "").trim() : "";
    if (raw === "") return 0;
    var v = parseFloat(raw);
    return (isFinite(v) && v >= 0 && v < max) ? v : NaN;
  }

  function syncUnits() {
    if (h2wrap) h2wrap.hidden = hunit.value !== "ftin";
    if (w2wrap) w2wrap.hidden = wunit.value !== "stlb";
  }

  function calc() {
    var h = num(height), w = num(weight);
    if (!isFinite(h) || !isFinite(w)) return fail("tool.err.empty");

    var cm, kg;
    if (hunit.value === "ftin") {
      var inPart = part(height2, 12);
      if (!isFinite(inPart)) return fail("tool.err.hin");
      cm = (h * 12 + inPart) * 2.54;
    } else {
      cm = hunit.value === "in" ? h * 2.54 : h;
    }
    if (wunit.value === "stlb") {
      var lbPart = part(weight2, 14);
      if (!isFinite(lbPart)) return fail("tool.err.wlb");
      kg = (w * 14 + lbPart) * LB;
    } else {
      kg = wunit.value === "lb" ? w * LB : w;
    }
    if (cm < 100 || cm > 250) return fail("tool.err.height");
    if (kg < 20 || kg > 300) return fail("tool.err.weight");

    // 빈칸이면 추정 공식, 값이 있으면 직접법 — 빈칸과 잘못된 값은 구분해서 처리한다.
    var bfRaw = String(bodyfat.value).replace(/,/g, "").trim();
    var bf = bfRaw === "" ? null : parseFloat(bfRaw);
    if (bf !== null && (!isFinite(bf) || bf < 2 || bf > 60)) return fail("tool.err.bf");

    var male = (document.querySelector('input[name="sex"]:checked') || {}).value !== "female";
    var b = boer(kg, cm, male), j = james(kg, cm, male), u = hume(kg, cm, male);
    var lbm = bf !== null ? kg * (1 - bf / 100) : b;

    $("r-lbm").textContent = fmt(lbm);
    $("r-method").textContent = t(bf !== null ? "tool.method.direct" : "tool.method.boer");
    $("r-fat").textContent = fmt(kg - lbm);
    $("r-pct").textContent = (lbm / kg * 100).toFixed(1) + "%";
    $("r-boer").textContent = fmt(b);
    $("r-james").textContent = fmt(j);
    $("r-hume").textContent = fmt(u);

    errEl.hidden = true;
    result.hidden = false;
  }

  var recalc = function () { if (!result.hidden || !errEl.hidden) calc(); };
  $("calc-btn").addEventListener("click", calc);
  [height, height2, weight, weight2, bodyfat].forEach(function (el) {
    if (!el) return;
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("input", recalc);
  });
  [hunit, wunit].forEach(function (el) { el.addEventListener("change", function () { syncUnits(); recalc(); }); });
  syncUnits();
  Array.prototype.forEach.call(document.querySelectorAll('input[name="sex"]'), function (r) {
    r.addEventListener("change", recalc);
  });
  document.addEventListener("i18n:change", recalc);
  // TOOLJS:END
})();
