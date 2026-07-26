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
  var value = $("value"), base = $("base"), customBase = $("custom-base");
  var result = $("result"), errEl = $("err");
  if (!value || !base) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function currentBase() {
    if (base.value !== "custom") return parseInt(base.value, 10);
    var b = parseInt(customBase.value, 10);
    return isFinite(b) ? b : NaN;
  }

  function calc() {
    var raw = String(value.value).trim().replace(/[\s_]/g, "");
    if (!raw) return fail("tool.err.empty");

    var b = currentBase();
    if (!isFinite(b) || b < 2 || b > 36) return fail("tool.err.base");

    var neg = raw.charAt(0) === "-";
    if (neg || raw.charAt(0) === "+") raw = raw.slice(1);
    if (!raw) return fail("tool.err.empty");

    // parseInt 는 잘못된 문자를 조용히 잘라내므로(129 를 8진수로 읽으면 10) 먼저 자릿수를 검사한다.
    var digits = "0123456789abcdefghijklmnopqrstuvwxyz".slice(0, b);
    var lower = raw.toLowerCase();
    for (var i = 0; i < lower.length; i++) {
      if (digits.indexOf(lower.charAt(i)) === -1) return fail("tool.err.digits");
    }

    var n = parseInt(lower, b);
    if (!isFinite(n) || n > Number.MAX_SAFE_INTEGER) return fail("tool.err.range");

    var sign = neg && n !== 0 ? "-" : "";
    $("out-bin").value = sign + n.toString(2);
    $("out-oct").value = sign + n.toString(8);
    $("out-dec").value = sign + n.toString(10);
    $("out-hex").value = sign + n.toString(16).toUpperCase();
    $("out-bits").textContent = n === 0 ? "1" : String(n.toString(2).length);

    errEl.hidden = true;
    result.hidden = false;
  }

  base.addEventListener("change", function () {
    $("custom-wrap").hidden = base.value !== "custom";
    if (!result.hidden || !errEl.hidden) calc();
  });
  if (customBase) customBase.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
  value.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
  value.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  $("calc-btn").addEventListener("click", calc);

  Array.prototype.forEach.call(document.querySelectorAll(".copy-btn"), function (btn) {
    btn.addEventListener("click", function () {
      var el = $(btn.getAttribute("data-copy"));
      if (!el || !el.value) return;
      var done = function () {
        var prev = btn.textContent;
        btn.textContent = t("tool.copied");
        setTimeout(function () { btn.textContent = prev; }, 1200);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(el.value).then(done, function () { el.select(); });
      else { el.select(); document.execCommand("copy"); done(); }
    });
  });

  document.addEventListener("i18n:change", function () { if (!errEl.hidden) calc(); });
  // TOOLJS:END
})();
