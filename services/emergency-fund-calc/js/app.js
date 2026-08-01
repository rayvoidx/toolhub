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
  var exp = $("exp"), monthsSel = $("months"), saved = $("saved"), save = $("save");
  var result = $("result"), errEl = $("err");
  if (!exp || !monthsSel || !saved || !save) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { var v = parseFloat(String(el.value).replace(/[$,\s]/g, "")); return isFinite(v) ? v : NaN; };
  var money = function (n) { return n.toLocaleString(undefined, { maximumFractionDigits: 0 }); };
  var put = function (s, o) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] === undefined ? m : String(o[k]); });
  };

  var MAX_EXP = 1e7;   // 월 생활비 상한 — 오타(자릿수 실수)를 조용히 통과시키지 않는다.
  var MAX_AMT = 1e12;  // 잔액·월 저축액 상한

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var e = num(exp);
    if (!isFinite(e) || e <= 0) return fail("tool.err.exp");
    if (e > MAX_EXP) return fail("tool.err.range");

    var have = num(saved);
    if (!isFinite(have) || have < 0) return fail("tool.err.saved");
    var per = num(save);
    if (!isFinite(per) || per < 0) return fail("tool.err.save");
    if (have > MAX_AMT || per > MAX_AMT) return fail("tool.err.range");

    var months = parseInt(monthsSel.value, 10) || 6;
    var target = e * months;
    var gap = Math.max(0, target - have);
    var pct = Math.min(100, Math.round(have / target * 100));

    $("r-target").textContent = money(target);
    $("gauge-fill").style.width = pct + "%";
    $("gauge").setAttribute("aria-label", put(t("tool.gauge"), { n: pct }));
    $("r-progress").textContent = pct + "%";

    if (gap <= 0) {
      // 이미 채운 경우엔 0 을 내밀지 않고 초과분을 명시한다.
      $("r-gap").textContent = put(t("tool.fmt.over"), { amount: money(have - target) });
      $("r-time").textContent = t("tool.r.done");
    } else {
      $("r-gap").textContent = money(gap);
      if (per <= 0) {
        // 월 저축액 0 은 오류가 아니라 "기간이 없다"는 사실 — 조용히 비우지 않고 문구로 알린다.
        $("r-time").textContent = t("tool.r.nopace");
      } else {
        var n = Math.ceil(gap / per);
        $("r-time").textContent = put(t(n === 1 ? "tool.fmt.pace1" : "tool.fmt.pace"), { amount: money(per), n: n });
      }
    }

    $("r-risk").textContent = t(months <= 3 ? "tool.risk.low" : (months <= 6 ? "tool.risk.mid" : "tool.risk.high"));
    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [exp, saved, save].forEach(function (el) {
    el.addEventListener("keydown", function (ev) { if (ev.key === "Enter") calc(); });
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  monthsSel.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
