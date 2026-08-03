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
  var htype = $("htype"), hh = $("hh"), gw = $("gw"), gwc = $("gwc"), slen = $("slen");
  var result = $("result"), errEl = $("err");
  if (!htype || !hh || !gw || !slen || !result) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 같은 기구라도 기준이 다르다: 탱크는 피크 1시간 총 사용량(갤런), 순간식은 동시 유량(GPM).
  var USES = [
    { id: "shower", key: "tool.f.shower", gal: 10, gpm: 2.0 },
    { id: "bath", key: "tool.f.bath", gal: 15, gpm: 4.0 },
    { id: "dish", key: "tool.f.dish", gal: 6, gpm: 1.0 },
    { id: "wash", key: "tool.f.wash", gal: 7, gpm: 1.5 },
    { id: "sink", key: "tool.f.sink", gal: 2, gpm: 1.0 }
  ];
  var TARGET_F = 105;                            // 샤워 사용 온도 기준
  var HH_FLOOR = { a: 30, b: 45, c: 65 };        // 인원별 전형적 피크 FHR(갤런)
  var HH_FIXTURES = { a: 1, b: 2, c: 3 };        // 인원별 전형적 동시 사용 기구 수

  function fmt1(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function fmtG(n) { return String(Math.round(n * 10) / 10); }
  function tankless() { return htype.value === "tankless"; }
  // 샤워 시간은 탱크 사용량의 최대 변수다. 1.25 gal/분(혼합 온수) x 시간 — 기본 8분이 기존 10갤런과 같다.
  var SHOWER_GAL_PER_MIN = 1.25;
  function showerMin() { var v = parseInt(slen.value, 10); return isFinite(v) && v > 0 ? v : 8; }
  function galOf(u) { return u.id === "shower" ? SHOWER_GAL_PER_MIN * showerMin() : u.gal; }
  // 프리셋 3개로는 실제 지역 수온을 다 못 덮는다 — 직접 입력을 허용하되 목표 105F 아래로 묶는다.
  function inletF() {
    if (gw.value !== "custom") return parseFloat(gw.value);
    var raw = String(gwc.value).trim();
    var v = parseFloat(raw);
    if (!/^-?\d+(\.\d+)?$/.test(raw) || !isFinite(v) || v < 33 || v > 95) return null;
    return v;
  }
  function syncGw() { gwc.hidden = !(tankless() && gw.value === "custom"); }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  // 종류를 바꾸면 라벨과 단위 표기가 통째로 바뀐다 — 마크업이 아니라 여기서 한 번에 맞춘다.
  function syncType() {
    var tl = tankless(), headKey = tl ? "tool.use.tankless" : "tool.use.tank";
    $("gw-row").hidden = !tl;
    $("sl-row").hidden = tl;   // 순간식은 유량 기준이라 샤워 길이가 용량을 바꾸지 않는다
    syncGw();
    for (var i = 0; i < slen.options.length; i++) {
      slen.options[i].textContent = slen.options[i].value + " " + t("tool.unit.min");
    }
    var head = $("uses-head");
    head.setAttribute("data-i18n", headKey);
    head.textContent = t(headKey);
    USES.forEach(function (u) {
      $("rate-" + u.id).textContent = tl
        ? fmt1(u.gpm) + " " + t("tool.unit.gpm")
        : fmtG(galOf(u)) + " " + t("tool.unit.gal");
    });
  }

  function calc() {
    var tl = tankless(), picked = [], total = 0, bad = false;
    USES.forEach(function (u) {
      var box = $("c-" + u.id);
      if (!box || !box.checked) return;
      var raw = String($("n-" + u.id).value).trim();
      var n = parseInt(raw, 10);
      if (!/^\d+$/.test(raw) || !isFinite(n) || n < 1 || n > 9) { bad = true; return; }
      var amount = n * (tl ? u.gpm : galOf(u));
      total += amount;
      picked.push({ key: u.key, n: n, amount: amount });
    });
    if (bad) return fail("tool.err.count");
    if (!picked.length) return fail("tool.err.none");

    var rise = 0, sizeText, clsKey, l2Key, v2Text;
    if (tl) {
      var inlet = inletF();
      if (inlet === null) return fail("tool.err.gw");
      rise = Math.round(TARGET_F - inlet);
      sizeText = fmt1(total) + " " + t("tool.unit.gpm") + " @ " + rise + "\u00B0F";
      clsKey = total <= 3.5 ? "tool.cls.k1" : total <= 5 ? "tool.cls.k2" : total <= 7 ? "tool.cls.k3" : "tool.cls.k4";
      l2Key = "tool.r.gpm";
      v2Text = fmt1(total) + " " + t("tool.unit.gpm");
    } else {
      // FHR 구간 → 실제로 파는 탱크 계단. 75 초과는 단일 탱크로 덮기 어려워 2대 옵션을 같이 낸다.
      var rec = total <= 30 ? 30 : total <= 45 ? 40 : total <= 60 ? 50 : total <= 75 ? 65 : 0;
      sizeText = (rec ? String(rec) : "75-80") + " " + t("tool.unit.gal");
      clsKey = rec === 30 ? "tool.cls.t30" : rec === 40 ? "tool.cls.t40" : rec === 50 ? "tool.cls.t50" : rec === 65 ? "tool.cls.t65" : "tool.cls.t80";
      l2Key = "tool.r.fhr";
      v2Text = Math.round(total) + " " + t("tool.unit.gal");
    }

    $("r-size").textContent = sizeText;
    var l2 = $("r-l2");
    l2.setAttribute("data-i18n", l2Key);
    l2.textContent = t(l2Key);
    $("r-v2").textContent = v2Text;
    $("r-v3").textContent = t(clsKey);
    $("rc-rise").hidden = !tl;
    if (tl) $("r-v4").textContent = rise + "\u00B0F (" + Math.round(rise * 5 / 9) + "\u00B0C)";

    var list = $("r-break");
    while (list.firstChild) list.removeChild(list.firstChild);
    picked.forEach(function (p) {
      var li = document.createElement("li");
      var name = document.createElement("span");
      name.textContent = p.n + " \u00D7 " + t(p.key);
      var val = document.createElement("span");
      val.textContent = tl
        ? fmt1(p.amount) + " " + t("tool.unit.gpm")
        : fmtG(p.amount) + " " + t("tool.unit.gal");
      li.appendChild(name);
      li.appendChild(val);
      list.appendChild(li);
    });

    $("r-note").textContent = t(tl ? "tool.note.tankless" : "tool.note.tank");
    var extra = "";
    if (tl && rise >= 60 && total >= 4) extra = t("tool.note.cold");
    else if (tl && picked.length < HH_FIXTURES[hh.value]) extra = t("tool.note.low");
    else if (!tl && total < HH_FLOOR[hh.value]) extra = t("tool.note.low");
    $("r-note2").textContent = extra;
    $("r-note2").hidden = !extra;

    errEl.hidden = true;
    result.hidden = false;
  }

  function live() { return !result.hidden || !errEl.hidden; }

  $("calc-btn").addEventListener("click", calc);
  htype.addEventListener("change", function () { syncType(); if (live()) calc(); });
  slen.addEventListener("change", function () { syncType(); if (live()) calc(); });
  [hh, gw].forEach(function (el) { el.addEventListener("change", function () { syncGw(); if (live()) calc(); }); });
  gwc.addEventListener("input", function () { if (live()) calc(); });
  gwc.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  USES.forEach(function (u) {
    $("c-" + u.id).addEventListener("change", function () { if (live()) calc(); });
    var q = $("n-" + u.id);
    q.addEventListener("change", function () { if (live()) calc(); });
    q.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  document.addEventListener("i18n:change", function () { syncType(); if (live()) calc(); });
  syncType();
  // TOOLJS:END
})();
