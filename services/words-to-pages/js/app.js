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
  var words = $("words"), font = $("font"), spacing = $("spacing"), size = $("size"), margin = $("margin");
  var result = $("result"), errEl = $("err");
  if (!words || !font || !spacing || !size || !margin) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var fill = function (k, n) { return t(k).replace("{n}", n); };

  // 12pt 본문 기준 싱글 행간 페이지당 단어 수 (여백 1인치). 행간은 그대로 나눗셈으로 들어간다.
  var WPP = { times: 550, arial: 500, verdana: 460, calibri: 620 };
  var SPACE = { double: 2, onehalf: 1.5, single: 1 };
  var READ_WPM = 200, SPEAK_WPM = 130;

  function dur(min) {
    if (min < 60) return min + " " + t("tool.unit.min");
    var h = Math.floor(min / 60), r = min % 60;
    return h + " " + t("tool.unit.hr") + (r ? " " + r + " " + t("tool.unit.min") : "");
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var n = parseFloat(String(words.value).replace(/[,\s]/g, ""));
    if (!isFinite(n)) return fail("tool.err.empty");
    // 0·음수·비현실적 대용량은 조용히 넘기지 않고 명시적으로 막는다.
    if (n <= 0 || n > 200000) return fail("tool.err.range");

    var pt = parseFloat(size.value) || 12;
    // 글자 크기는 면적 기준 — 12pt 대비 (12/pt)^2 로 페이지당 단어 수가 늘고 준다.
    // 여백은 본문 면적 비율로 반영 — 레터 8.5x11in, 1인치 여백(6.5x9in)이 기준값 1.0.
    var m = parseFloat(margin.value);
    if (!isFinite(m) || m < 0 || m > 3) m = 1;
    var areaFactor = ((8.5 - 2 * m) * (11 - 2 * m)) / (6.5 * 9);
    var perPage = (WPP[font.value] || WPP.times) * Math.pow(12 / pt, 2) * areaFactor / (SPACE[spacing.value] || 1);
    var pages = n / perPage;

    $("r-pages").textContent = fill("tool.r.pagesfmt", pages.toFixed(1));
    $("r-read").textContent = dur(Math.max(1, Math.round(n / READ_WPM)));
    $("r-speak").textContent = dur(Math.max(1, Math.round(n / SPEAK_WPM)));
    $("r-rev").textContent = fill("tool.r.rev", Math.round(perPage));

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  words.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  [font, spacing, size, margin].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
