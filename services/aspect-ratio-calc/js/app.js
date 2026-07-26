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
  var ow = $("ow"), oh = $("oh"), nw = $("nw"), nh = $("nh");
  var result = $("result"), errEl = $("err");
  if (!ow || !oh || !nw || !nh) return;

  var lastEdited = "nw";
  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { var v = parseFloat(String(el.value).replace(/,/g, "")); return isFinite(v) ? v : NaN; };
  function gcd(a, b) { a = Math.round(a); b = Math.round(b); while (b) { var x = a % b; a = b; b = x; } return a || 1; }
  function fmt(n) { return Math.abs(n - Math.round(n)) < 0.005 ? String(Math.round(n)) : n.toFixed(2); }

  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function calc() {
    var w = num(ow), h = num(oh);
    if (isNaN(w) || isNaN(h)) return fail("tool.err.empty");
    if (w <= 0 || h <= 0) return fail("tool.err.positive");

    var tw = num(nw), th = num(nh);
    var haveW = !isNaN(tw) && tw > 0, haveH = !isNaN(th) && th > 0;
    if (!haveW && !haveH) return fail("tool.err.oneside");

    // 둘 다 차 있으면 마지막으로 손댄 쪽을 기준으로 — 결과가 임의로 정해지지 않게.
    var base = (haveW && (lastEdited === "nw" || !haveH)) ? "w" : "h";
    var outW, outH;
    if (base === "w") { outW = tw; outH = tw * h / w; }
    else { outH = th; outW = th * w / h; }

    var g = gcd(w, h);
    $("r-ratio").textContent = Math.round(w / g) + ":" + Math.round(h / g);
    $("r-dec").textContent = (w / h).toFixed(4);
    $("r-size").textContent = fmt(outW) + " x " + fmt(outH);
    if (base === "w") { nh.value = fmt(outH); } else { nw.value = fmt(outW); }

    errEl.hidden = true;
    result.hidden = false;
  }

  nw.addEventListener("input", function () { lastEdited = "nw"; });
  nh.addEventListener("input", function () { lastEdited = "nh"; });

  $("calc-btn").addEventListener("click", calc);
  [ow, oh, nw, nh].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });

  var chips = $("ratio-chips");
  if (chips) {
    chips.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".chip") : null;
      if (!b) return;
      var rw = parseFloat(b.getAttribute("data-w")), rh = parseFloat(b.getAttribute("data-h"));
      ow.value = String(rw * 120); oh.value = String(rh * 120);
      if (!nw.value && !nh.value) { nw.value = String(rw * 80); lastEdited = "nw"; }
      calc();
    });
  }

  // 언어를 바꾸면 표시 중인 오류 문구도 새 언어로 다시 그린다.
  document.addEventListener("i18n:change", function () { if (!errEl.hidden) calc(); });
  // TOOLJS:END
})();
