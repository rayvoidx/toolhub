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
  var capacity = $("capacity"), socNow = $("soc-now"), socTarget = $("soc-target");
  var powerSel = $("power-sel"), powerCustom = $("power-custom"), customRow = $("custom-row");
  var eff = $("eff"), price = $("price"), rate = $("rate");
  var result = $("result"), errEl = $("err"), costCard = $("cost-card"), taperNote = $("taper-note");
  if (!capacity || !socNow || !socTarget || !powerSel || !eff) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { return parseFloat(String(el.value).replace(/,/g, "")); };
  var blank = function (el) { return String(el.value).trim() === ""; };

  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  // 시간은 "1 h 48 min" 형태로 — 단위 문자열은 언어별 키에서 가져온다.
  function fmtTime(hours) {
    var total = Math.round(hours * 60);
    var h = Math.floor(total / 60), m = total % 60;
    return (h > 0 ? h + " " + t("tool.unit.h") + " " : "") + m + " " + t("tool.unit.min");
  }

  function calc() {
    var cap = num(capacity), a = num(socNow), b = num(socTarget);
    if (!isFinite(cap) || !isFinite(a) || !isFinite(b)) return fail("tool.err.empty");
    if (cap <= 0 || cap > 300) return fail("tool.err.capacity");
    if (a < 0 || a > 100 || b < 0 || b > 100) return fail("tool.err.soc");
    if (b <= a) return fail("tool.err.target");

    var kw = powerSel.value === "custom" ? num(powerCustom) : parseFloat(powerSel.value);
    if (!isFinite(kw) || kw <= 0 || kw > 1000) return fail("tool.err.power");

    // 효율 미입력은 AC 기본값 90% — 조용히 0으로 두면 시간이 무한대가 된다.
    var e = blank(eff) ? 90 : num(eff);
    if (!isFinite(e) || e < 50 || e > 100) return fail("tool.err.eff");

    // 배터리에 실제로 들어가는 양과 벽에서 빠져나가는 양은 다르다 (온보드 충전기 손실).
    var toBattery = cap * (b - a) / 100;
    var fromWall = toBattery / (e / 100);
    var hours = fromWall / kw;

    $("r-time").textContent = fmtTime(hours);
    $("r-energy").textContent = fromWall.toFixed(1) + " kWh";
    // 전비는 차종별 편차가 크다 (픽업 2, 소형 5) — 미입력은 기존 기본값 3.5 mi/kWh 유지.
    var miPerKwh = blank(rate) ? 3.5 : num(rate);
    if (!isFinite(miPerKwh) || miPerKwh < 0.5 || miPerKwh > 20) return fail("tool.err.rate");

    $("r-range").textContent = Math.round(toBattery * miPerKwh) + " mi / " + Math.round(toBattery * miPerKwh * 1.609) + " km";
    if ($("range-note")) $("range-note").hidden = !blank(rate);

    if (blank(price)) {
      costCard.hidden = true;
      $("r-cost").textContent = "—";
    } else {
      var p = num(price);
      if (!isFinite(p) || p < 0) return fail("tool.err.price");
      costCard.hidden = false;
      $("r-cost").textContent = (fromWall * p).toFixed(2);
    }

    // DC 급속은 80% 위에서 출력을 크게 줄인다 — 평탄 출력 가정임을 숨기지 않는다.
    taperNote.hidden = !(kw >= 50 && b > 80);

    errEl.hidden = true;
    result.hidden = false;
  }

  function syncCustom() { customRow.hidden = powerSel.value !== "custom"; }
  syncCustom();

  $("calc-btn").addEventListener("click", calc);
  [capacity, socNow, socTarget, powerCustom, eff, price, rate].forEach(function (el) {
    if (el) el.addEventListener("keydown", function (ev) { if (ev.key === "Enter") calc(); });
  });
  powerSel.addEventListener("change", function () {
    syncCustom();
    if (!result.hidden || !errEl.hidden) calc();
  });
  [capacity, socNow, socTarget, powerCustom, eff, price, rate].forEach(function (el) {
    if (el) el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
