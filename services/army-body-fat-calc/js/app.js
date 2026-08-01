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
  var height = $("height"), waist = $("waist"), hunit = $("hunit"), wunit = $("wunit"), ageband = $("ageband");
  var result = $("result"), errEl = $("err");
  if (!height || !waist || !ageband) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var MAX = {
    male: { b1: 20, b2: 22, b3: 24, b4: 26 },
    female: { b1: 30, b2: 32, b3: 34, b4: 36 }
  };

  function bodyFat(sex, hIn, wIn) {
    return sex === "female"
      ? 1.51 * wIn - 0.156 * hIn - 9.15
      : 1.99 * wIn - 0.12 * hIn - 41.5;
  }
  function sexVal() {
    var r = document.querySelector('input[name="sex"]:checked');
    return r && r.value === "female" ? "female" : "male";
  }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var h = parseFloat(String(height.value).replace(/,/g, ""));
    var w = parseFloat(String(waist.value).replace(/,/g, ""));
    if (!isFinite(h) || !isFinite(w)) return fail("tool.err.empty");

    var hIn = hunit.value === "cm" ? h / 2.54 : h;
    var wIn = wunit.value === "cm" ? w / 2.54 : w;
    if (hIn < 58 || hIn > 80) return fail("tool.err.height");
    if (wIn < 20 || wIn > 60) return fail("tool.err.waist");

    var sex = sexVal();
    // 극단적으로 마른 조합에서는 선형식이 음수를 낸다 — 필수지방 하한으로 막는다.
    var bf = Math.max(sex === "female" ? 8 : 3, bodyFat(sex, hIn, wIn));
    var max = MAX[sex][ageband.value] || MAX[sex].b2;
    var pass = bf <= max;

    $("r-bf").textContent = bf.toFixed(1) + "%";
    var st = $("r-status");
    st.textContent = t(pass ? "tool.pass" : "tool.fail");
    st.className = "rc-val " + (pass ? "ok" : "bad");
    $("r-max").textContent = max + "%";
    $("r-margin").textContent = Math.abs(max - bf).toFixed(1) + " " + t(pass ? "tool.margin.under" : "tool.margin.over");

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [height, waist].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  var inputs = [hunit, wunit, ageband].concat(
    Array.prototype.slice.call(document.querySelectorAll('input[name="sex"]'))
  );
  inputs.forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
