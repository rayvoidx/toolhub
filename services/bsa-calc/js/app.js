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
  var height = $("height"), hunit = $("hunit"), weight = $("weight"), wunit = $("wunit");
  var result = $("result"), errEl = $("err");
  if (!height || !hunit || !weight || !wunit) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { return parseFloat(String(el.value).replace(/,/g, "")); };

  // 세 공식 모두 cm·kg 입력을 전제로 발표된 회귀식이다 — 단위 변환을 먼저 끝내고 넣는다.
  function mosteller(cm, kg) { return Math.sqrt(cm * kg / 3600); }
  function dubois(cm, kg) { return 0.007184 * Math.pow(cm, 0.725) * Math.pow(kg, 0.425); }
  function haycock(cm, kg) { return 0.024265 * Math.pow(cm, 0.3964) * Math.pow(kg, 0.5378); }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var h = num(height), w = num(weight);
    if (!isFinite(h) || !isFinite(w)) return fail("tool.err.empty");

    var cm = h;
    if (hunit.value === "in") cm = h * 2.54;
    else if (hunit.value === "ftin") {
      // 피트 칸이 h, 인치 칸은 선택 입력(빈 칸 = 0인치).
      var inPart = parseFloat(String($("hin").value).replace(/,/g, ""));
      if (!isFinite(inPart)) inPart = 0;
      if (inPart < 0) return fail("tool.err.height");
      cm = (h * 12 + inPart) * 2.54;
    }
    var kg = wunit.value === "lb" ? w * 0.45359237 : w;
    if (cm < 50 || cm > 250) return fail("tool.err.height");
    if (kg < 10 || kg > 300) return fail("tool.err.weight");

    var m = mosteller(cm, kg), d = dubois(cm, kg), y = haycock(cm, kg);
    var fmt = function (v) { return v.toFixed(2) + " m\u00B2"; };
    $("r-most").textContent = fmt(m);
    $("r-dubois").textContent = fmt(d);
    $("r-haycock").textContent = fmt(y);
    $("r-avg").textContent = fmt((m + d + y) / 3);

    errEl.hidden = true;
    result.hidden = false;
  }

  function syncHeightUnit() {
    var ft = hunit.value === "ftin";
    $("hin-row").hidden = !ft;
    height.placeholder = ft ? "5" : (hunit.value === "in" ? "67" : "170");
  }
  syncHeightUnit();
  hunit.addEventListener("change", syncHeightUnit);

  $("calc-btn").addEventListener("click", calc);
  [height, weight, $("hin")].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [hunit, wunit].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
