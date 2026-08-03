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
  var measured = $("measured"), accepted = $("accepted");
  var result = $("result"), errEl = $("err");
  if (!measured || !accepted) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (s) {
    var v = String(s == null ? "" : s).replace(/[\s,]/g, "");
    if (!v) return null;
    var n = parseFloat(v);
    return isFinite(n) ? n : NaN;
  };
  // 부동소수 잔재(9.81-9.5 = 0.3100000000000005) 제거용. 유효숫자 6자리면 실험값에 충분하다.
  var trim = function (x) { return String(Number(x.toPrecision(6))); };

  function qualityKey(pct) {
    if (pct < 1) return "tool.q.excellent";
    if (pct < 5) return "tool.q.good";
    if (pct <= 10) return "tool.q.ok";
    return "tool.q.recheck";
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var m = num(measured.value), a = num(accepted.value);
    if (m === null || a === null) return fail("tool.err.empty");
    if (isNaN(m) || isNaN(a)) return fail("tool.err.num");

    var tolEl = $("tol");
    var tol = tolEl ? num(tolEl.value) : null;   // null = 미입력(선택 항목)
    if (tol !== null && (isNaN(tol) || tol <= 0)) return fail("tool.err.tol");

    var diff = m - a;
    var absErr = Math.abs(diff);
    $("r-abs").textContent = trim(absErr);
    var tolCard = $("tol-card");
    if (tolCard) tolCard.hidden = true;

    if (a === 0) {
      // 참값이 0이면 상대오차는 0으로 나누기 — 값을 지어내지 않고 정의되지 않음을 밝힌다.
      $("r-pct").textContent = t("tool.r.undef");
      $("r-quality").textContent = "—";
      $("r-dir").textContent = t("tool.note.zero");
    } else {
      var dpEl = $("dp");
      var dp = dpEl ? parseInt(dpEl.value, 10) : 2;
      if (!(dp >= 0 && dp <= 4)) dp = 2;
      var pct = absErr / Math.abs(a) * 100;
      var pctStr = pct.toFixed(dp);
      $("r-pct").textContent = pctStr + "%";
      $("r-quality").textContent = t(qualityKey(pct));
      var dirKey = diff === 0 ? "tool.dir.exact" : (diff > 0 ? "tool.dir.above" : "tool.dir.below");
      $("r-dir").textContent = t(dirKey).replace("{p}", pctStr);
      if (tol !== null && tolCard) {
        var tolStr = trim(tol);
        $("r-tol").textContent = t(pct <= tol ? "tool.tol.pass" : "tool.tol.fail").replace("{t}", tolStr);
        tolCard.hidden = false;
      }
    }

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  if ($("dp")) $("dp").addEventListener("change", function () { if (!result.hidden) calc(); });
  [measured, accepted, $("tol")].filter(Boolean).forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
