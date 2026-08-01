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
  var waist = $("waist"), hip = $("hip"), unit = $("unit");
  var result = $("result"), errEl = $("err"), warnEl = $("warn");
  if (!waist || !hip || !unit) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // WHO 2008 전문가 협의 기준 — 비율 구간(mod/high)과 허리둘레 단독 절대값을 성별로 나눈다.
  // 인치 기준값(i1/i2)을 따로 둔 이유: 40in = 101.6cm 라 cm 기준으로 환산하면 공표된 인치 경계값이 한 칸 낮게 떨어진다.
  var CUT = {
    female: { mod: 0.80, high: 0.85, w1: 80, w2: 88, i1: 31.5, i2: 34.6 },
    male: { mod: 0.90, high: 1.00, w1: 94, w2: 102, i1: 37, i2: 40 }
  };

  function sex() {
    var r = document.querySelector('input[name="sex"]:checked');
    return r && r.value === "male" ? "male" : "female";
  }
  function num(el) { return parseFloat(String(el.value).replace(/,/g, "")); }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }
  function badge(el, cls, key) { el.className = "badge " + cls; el.textContent = t(key); }

  function calc() {
    var w = num(waist), h = num(hip);
    if (!isFinite(w) || !isFinite(h)) return fail("tool.err.empty");

    var inches = unit.value === "in";
    var k = inches ? 2.54 : 1;
    var wcm = w * k, hcm = h * k;
    if (wcm < 20 || wcm > 300 || hcm < 20 || hcm > 300) return fail("tool.err.range");

    // 화면에 보이는 소수 2자리 값과 구간 판정이 어긋나지 않도록, 반올림한 비율로 밴드를 정한다.
    var ratio = Math.round((wcm / hcm) * 100) / 100;
    var c = CUT[sex()];

    $("r-whr").textContent = ratio.toFixed(2);
    if (ratio >= c.high) badge($("r-risk"), "high", "tool.risk.high");
    else if (ratio >= c.mod) badge($("r-risk"), "mod", "tool.risk.moderate");
    else badge($("r-risk"), "low", "tool.risk.low");

    var wv = inches ? w : wcm, t1 = inches ? c.i1 : c.w1, t2 = inches ? c.i2 : c.w2;
    if (wv >= t2) badge($("r-waist"), "high", "tool.wb.high");
    else if (wv >= t1) badge($("r-waist"), "mod", "tool.wb.increased");
    else badge($("r-waist"), "low", "tool.wb.healthy");

    // 허리가 엉덩이의 1.5배를 넘으면 두 값이 뒤바뀌었거나 단위가 섞였을 가능성 — 결과는 내되 경고한다.
    var swapped = wcm > hcm * 1.5;
    warnEl.hidden = !swapped;
    if (swapped) warnEl.textContent = t("tool.warn.swap");

    errEl.hidden = true;
    result.hidden = false;
  }

  function recalc() { if (!result.hidden || !errEl.hidden) calc(); }

  $("calc-btn").addEventListener("click", calc);
  [waist, hip].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("change", recalc);
  });
  unit.addEventListener("change", recalc);
  Array.prototype.forEach.call(document.querySelectorAll('input[name="sex"]'), function (r) {
    r.addEventListener("change", recalc);
  });
  document.addEventListener("i18n:change", recalc);
  // TOOLJS:END
})();
