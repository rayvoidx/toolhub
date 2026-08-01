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
  var styleSel = $("style"), customWrap = $("custom-wrap"), customMin = $("custom-min");
  var start = $("start"), buffer = $("buffer");
  var result = $("result"), errEl = $("err"), alts = $("alts"), lateEl = $("r-late");
  if (!styleSel || !start || !buffer || !customMin) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var ALTS = [20, 26, 60, 90];
  // 30~60분 구간은 서파(깊은)수면 한가운데라 알람이 수면 관성을 만든다. 85분 이상은 한 주기 끝.
  function tagKey(min) {
    if (min <= 30) return "tool.tag.light";
    if (min >= 85) return "tool.tag.cycle";
    return "tool.tag.deep";
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function fmt(mins) {
    mins = ((Math.round(mins) % 1440) + 1440) % 1440;   // 자정 넘김도 시각으로는 유효하다
    var h = Math.floor(mins / 60), m = mins % 60;
    try {
      return new Date(2000, 0, 1, h, m).toLocaleTimeString(
        document.documentElement.lang || "en", { hour: "numeric", minute: "2-digit" });
    } catch (e) { return pad(h) + ":" + pad(m); }
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function duration() {
    if (styleSel.value !== "custom") return parseInt(styleSel.value, 10);
    var v = parseInt(String(customMin.value).replace(/[^0-9]/g, ""), 10);
    return isFinite(v) ? v : NaN;
  }

  function calc() {
    var m = String(start.value).match(/^([0-9]{1,2}):([0-9]{2})/);
    if (!m) return fail("tool.err.time");
    var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return fail("tool.err.time");

    var dur = duration();
    if (!isFinite(dur) || dur < 5 || dur > 180) return fail("tool.err.custom");

    var buf = parseInt(buffer.value, 10) || 10;
    var startMin = h * 60 + mi;
    var asleep = startMin + buf;   // 눕자마자 자는 게 아니다 — 알람은 잠든 시각 기준

    $("r-alarm").textContent = fmt(asleep + dur);
    $("r-window").textContent = fmt(startMin) + " → " + t("tool.asleep") + " " + fmt(asleep) + " → " + fmt(asleep + dur);
    $("r-total").textContent = (buf + dur) + " " + t("tool.min");

    lateEl.textContent = t("tool.warn.late");
    lateEl.hidden = h < 15;   // 오후 3시 이후 낮잠은 밤잠 압력을 갉아먹는다

    while (alts.firstChild) alts.removeChild(alts.firstChild);
    var picked = styleSel.value === "custom" ? dur : parseInt(styleSel.value, 10);
    ALTS.forEach(function (n) {
      var li = document.createElement("li");
      var cls = n === 60 ? "warn" : "";
      if (n === picked) cls = cls ? cls + " picked" : "picked";
      if (cls) li.className = cls;
      var a = document.createElement("span"); a.className = "a-len"; a.textContent = n + " " + t("tool.min");
      var b = document.createElement("span"); b.className = "a-time"; b.textContent = fmt(asleep + n);
      var c = document.createElement("span"); c.className = "a-tag";
      c.textContent = t(tagKey(n)) + (n === picked ? " · " + t("tool.tag.picked") : "");
      li.appendChild(a); li.appendChild(b); li.appendChild(c);
      alts.appendChild(li);
    });

    errEl.hidden = true;
    result.hidden = false;
  }

  function syncCustom() { customWrap.hidden = styleSel.value !== "custom"; }

  // 기본값은 지금 시각 — 대부분 "지금 누우면 몇 시에 알람?"으로 들어온다. 계획 낮잠이면 바꾸면 된다.
  if (!start.value) {
    var now = new Date();
    start.value = pad(now.getHours()) + ":" + pad(now.getMinutes());
  }
  syncCustom();

  $("calc-btn").addEventListener("click", calc);
  [start, customMin].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  styleSel.addEventListener("change", function () { syncCustom(); if (!result.hidden || !errEl.hidden) calc(); });
  [buffer, start, customMin].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
