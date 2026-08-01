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
  var unit = $("unit"), under = $("under"), bust = $("bust");
  var result = $("result"), errEl = $("err");
  if (!unit || !under || !bust) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 인덱스 = 반올림한 (가슴 − 밴드) 인치. 같은 인덱스라도 시장별 표기가 갈린다.
  var CUP_US = ["AA", "A", "B", "C", "D", "DD", "DDD", "G", "H", "I", "J"];
  var CUP_UK = ["AA", "A", "B", "C", "D", "DD", "E", "F", "FF", "G", "GG"];
  var CUP_EU = ["AA", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
  var MAX_IDX = CUP_US.length - 1;

  function bandOf(underIn) {
    var r = Math.round(underIn);
    return r % 2 === 0 ? r : r + 1; // 밴드는 짝수 인치만 존재 — 홀수면 위로
  }
  function num(el) { return parseFloat(String(el.value).replace(/,/g, "").trim()); }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var u = num(under), b = num(bust);
    if (!isFinite(u) || !isFinite(b)) return fail("tool.err.empty");
    if (unit.value === "cm") { u = u / 2.54; b = b / 2.54; }
    if (u < 20 || u > 60 || b < 20 || b > 60) return fail("tool.err.range");
    if (b <= u) return fail("tool.err.bust");

    var band = bandOf(u);
    var diff = b - band;
    var idx = Math.max(0, Math.round(diff));
    var i = Math.min(idx, MAX_IDX);
    var over = idx > MAX_IDX ? "+" : ""; // 표 밖으로 나간 경우 숨기지 않고 표시한다
    var euBand = Math.round(band * 2.54 / 5) * 5;

    var us = band + CUP_US[i] + over;
    $("r-us").textContent = us;
    $("r-uk").textContent = band + CUP_UK[i] + over;
    $("r-eu").textContent = euBand + CUP_EU[i] + over;
    $("r-diff").textContent = diff.toFixed(1) + " in";

    // 시스터 사이즈: 컵 용량은 그대로 두고 밴드만 ±2 — 표 경계를 넘는 쪽은 뺀다.
    var sis = [];
    if (!over && band - 2 >= 28 && i + 1 <= MAX_IDX) sis.push((band - 2) + CUP_US[i + 1]);
    sis.push(us);
    if (i - 1 >= 0) sis.push((band + 2) + CUP_US[i - 1]);
    $("r-sister").textContent = sis.join("  =  ");

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [under, bust].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  unit.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
