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
  var dist = $("dist"), cust = $("cust"), custUnit = $("cust-unit");
  var hh = $("hh"), mm = $("mm"), ss = $("ss");
  var target = $("target"), tcust = $("tcust"), tcustUnit = $("tcust-unit");
  var result = $("result"), errEl = $("err"), noteEl = $("r-note"), body = $("splits-body");
  if (!dist || !target || !hh || !body) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var KM = { "5k": 5, "10k": 10, half: 21.0975, full: 42.195 };
  var MI = 1.609344;      // 1 mile in km
  var EXP = 1.06;         // Riegel fatigue exponent — the standard value

  function fmt(sec) {
    sec = Math.round(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return h > 0 ? h + ":" + p(m) + ":" + p(s) : m + ":" + p(s);
  }
  function num(el) { var v = parseFloat(String(el.value).replace(/,/g, "")); return isFinite(v) ? v : 0; }
  function km(sel, inp, unit) {
    if (sel.value !== "custom") return KM[sel.value];
    var v = parseFloat(String(inp.value).replace(/,/g, ""));
    if (!isFinite(v) || v <= 0) return NaN;
    v = unit.value === "mi" ? v * MI : v;
    return (v >= 0.1 && v <= 1000) ? v : NaN;
  }
  function toggleCustom() {
    $("cust-wrap").hidden = dist.value !== "custom";
    $("tcust-wrap").hidden = target.value !== "custom";
  }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function row(kmMark, sec, isFinish) {
    var tr = document.createElement("tr");
    if (isFinish) tr.className = "fin";
    var cells = [
      kmMark.toFixed(kmMark < 10 ? 1 : 2).replace(/\.?0+$/, "") + (isFinish ? " · " + t("tool.th.finish") : ""),
      (kmMark / MI).toFixed(2),
      fmt(sec)
    ];
    for (var i = 0; i < cells.length; i++) {
      var td = document.createElement("td");
      td.textContent = cells[i];
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }

  function calc() {
    var blank = !String(hh.value).trim() && !String(mm.value).trim() && !String(ss.value).trim();
    if (blank) return fail("tool.err.empty");
    var h = num(hh), m = num(mm), s = num(ss);
    if (h < 0 || m < 0 || s < 0) return fail("tool.err.zero");
    var t1 = h * 3600 + m * 60 + s;
    if (!(t1 > 0)) return fail("tool.err.zero");
    if (t1 >= 86400) return fail("tool.err.long");

    var d1 = km(dist, cust, custUnit), d2 = km(target, tcust, tcustUnit);
    if (!isFinite(d1) || !isFinite(d2)) return fail("tool.err.dist");

    var t2 = t1 * Math.pow(d2 / d1, EXP);
    $("r-time").textContent = fmt(t2);
    $("r-pacekm").textContent = fmt(t2 / d2);
    $("r-pacemi").textContent = fmt(t2 / d2 * MI);

    // 정직성 문구: 같은 거리면 예측이 아니고, 4배 넘는 외삽은 리겔이 낙관적으로 나온다.
    var noteKey = Math.abs(d2 - d1) < 0.001 ? "tool.note.same" : (d2 / d1 > 4 ? "tool.note.stretch" : "");
    noteEl.textContent = noteKey ? t(noteKey) : "";
    noteEl.hidden = !noteKey;

    while (body.firstChild) body.removeChild(body.firstChild);
    var step = 5 * Math.ceil(d2 / 200);   // 극단적 거리에서 표가 수백 줄 되지 않게 간격을 넓힌다
    for (var k = step; k < d2 - 0.05; k += step) row(k, t2 * k / d2, false);
    row(d2, t2, true);

    errEl.hidden = true;
    result.hidden = false;
  }

  toggleCustom();
  $("calc-btn").addEventListener("click", calc);
  [hh, mm, ss, cust, tcust].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [dist, target].forEach(function (el) {
    el.addEventListener("change", function () { toggleCustom(); if (!result.hidden || !errEl.hidden) calc(); });
  });
  [custUnit, tcustUnit, cust, tcust].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
