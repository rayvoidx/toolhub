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
  var size = $("size"), sizeunit = $("sizeunit"), speed = $("speed"), speedunit = $("speedunit"), overhead = $("overhead");
  var result = $("result"), errEl = $("err"), cmpBody = $("cmp-body");
  if (!size || !speed || !sizeunit || !speedunit || !overhead) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // SI 기준: 파일 1 GB = 1000 MB. 회선은 비트 단위라 8로 나눠야 MB/s 가 된다.
  var SIZE_MB = { mb: 1, gb: 1000, tb: 1000000 };
  var SPD_MBPS = { mbps: 0.125, mbyte: 1, gbps: 125 };
  var TIERS = [25, 100, 500, 1000];

  function group(n) {
    var p = String(n).split(".");
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return p.join(".");
  }

  function human(total) {
    if (!isFinite(total) || total < 0) return "—";
    if (total < 10) return (Math.round(total * 10) / 10) + " " + t("tool.u.s");
    var s = Math.round(total);
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60), sec = s % 60;
    var out = [];
    if (d) out.push(group(d) + " " + t("tool.u.d"));
    if (h) out.push(h + " " + t("tool.u.h"));
    if (m && !d) out.push(m + " " + t("tool.u.m"));
    if (sec && !d && !h) out.push(sec + " " + t("tool.u.s"));
    if (!out.length) out.push("0 " + t("tool.u.s"));
    return out.join(" ");
  }

  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function calc() {
    var szRaw = parseFloat(String(size.value).replace(/,/g, ""));
    if (!isFinite(szRaw) || szRaw <= 0) return fail("tool.err.size");
    var spRaw = parseFloat(String(speed.value).replace(/,/g, ""));
    if (!isFinite(spRaw) || spRaw <= 0) return fail("tool.err.speed");

    var mb = szRaw * (SIZE_MB[sizeunit.value] || 1);
    if (mb > 1e9) return fail("tool.err.range");

    var oh = parseFloat(overhead.value) || 0;
    var eff = spRaw * (SPD_MBPS[speedunit.value] || 1) * (1 - oh);
    if (!(eff > 0)) return fail("tool.err.speed");

    $("r-time").textContent = human(mb / eff);
    $("r-eff").textContent = group(Math.round(eff * 100) / 100) + " MB/s";
    $("r-size").textContent = group(mb >= 10 ? Math.round(mb) : Math.round(mb * 100) / 100) + " MB";

    while (cmpBody.firstChild) cmpBody.removeChild(cmpBody.firstChild);
    for (var i = 0; i < TIERS.length; i++) {
      var tierEff = TIERS[i] * 0.125 * (1 - oh);
      var tr = document.createElement("tr");
      var td1 = document.createElement("td");
      td1.textContent = group(TIERS[i]) + " Mbps";
      var td2 = document.createElement("td");
      td2.textContent = human(mb / tierEff);
      tr.appendChild(td1);
      tr.appendChild(td2);
      cmpBody.appendChild(tr);
    }

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [size, speed].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [sizeunit, speedunit, overhead].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
