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
  var attended = $("attended"), total = $("total"), req = $("req");
  var reqc = $("reqc"), reqcWrap = $("reqc-wrap"), perweek = $("perweek");
  var result = $("result"), errEl = $("err");
  if (!attended || !total || !req) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  function fill(key, vars) {
    var s = t(key);
    for (var p in vars) { if (vars.hasOwnProperty(p)) s = s.split("{" + p + "}").join(vars[p]); }
    return s;
  }
  function num(el) {
    var v = String(el.value).replace(/,/g, "").trim();
    if (!v) return null;
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }
  function fmt(x) { return String(Math.round(x * 100) / 100); }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }
  function syncReq() { reqcWrap.hidden = req.value !== "custom"; }

  function calc() {
    var a = num(attended), n = num(total);
    if (a === null || n === null) return fail("tool.err.empty");
    if (a < 0 || n < 0) return fail("tool.err.neg");
    if (n <= 0) return fail("tool.err.total");
    if (a > n) return fail("tool.err.over");

    var r = req.value === "custom" ? num(reqc) : parseFloat(req.value);
    if (r === null || !isFinite(r) || r < 1 || r > 100) return fail("tool.err.req");

    var w = null;
    if (String(perweek.value).trim() !== "") {
      w = num(perweek);
      if (w === null || w <= 0) return fail("tool.err.week");
    }

    // 출석 횟수는 개수 — 소수 입력은 반올림해서 센다.
    a = Math.round(a); n = Math.round(n);

    var pct = a / n * 100;
    var exact = Math.abs(pct - r) < 1e-9;
    var below = pct < r && !exact;
    var rTxt = fmt(r);

    var cur = $("r-current");
    cur.textContent = fmt(pct) + "%";
    cur.className = "rc-val " + (below ? "bad" : "ok");
    $("r-status").textContent = t(exact ? "tool.st.exact" : (below ? "tool.st.below" : "tool.st.above"));

    var steps = null; // 앞으로 필요한 연속 출석 수(미달) 또는 남은 결석 가능 수(충족)
    if (below) {
      $("r-action-label").textContent = t("tool.r.need");
      if (r >= 100) {
        // 100% 요구는 분모가 0 — 한 번 빠지면 복구 경로가 존재하지 않는다.
        $("r-action").textContent = "—";
        $("r-msg").textContent = t("tool.msg.no100");
      } else {
        steps = Math.ceil((r * n - 100 * a) / (100 - r) - 1e-9);
        if (steps < 1) steps = 1;
        $("r-action").textContent = String(steps);
        $("r-msg").textContent = fill("tool.msg.need", { n: steps, r: rTxt });
      }
    } else {
      steps = Math.floor((100 * a - r * n) / r + 1e-9);
      if (steps < 0) steps = 0;
      $("r-action-label").textContent = t("tool.r.spare");
      $("r-action").textContent = String(steps);
      $("r-msg").textContent = steps > 0
        ? fill("tool.msg.spare", { n: steps, r: rTxt })
        : fill("tool.msg.zero", { r: rTxt });
    }

    var wk = $("card-weeks");
    if (w && steps !== null && steps > 0) {
      $("r-weeks").textContent = fill("tool.val.weeks", { n: fmt(Math.round(steps / w * 10) / 10) });
      wk.hidden = false;
    } else {
      wk.hidden = true;
    }

    errEl.hidden = true;
    result.hidden = false;
  }

  syncReq();
  $("calc-btn").addEventListener("click", calc);
  [attended, total, reqc, perweek].forEach(function (el) {
    if (!el) return;
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  req.addEventListener("change", function () { syncReq(); if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
