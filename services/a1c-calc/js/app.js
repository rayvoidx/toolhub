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
  var direction = $("direction"), value = $("value"), unit = $("unit");
  var result = $("result"), errEl = $("err");
  if (!direction || !value || !unit) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // ADAG 회귀식(Nathan 2008, ADA): eAG(mg/dL) = 28.7 × A1C − 46.7. 역방향은 같은 식을 뒤집는다.
  var MMOL = 18.016;
  function eagFromA1c(a) { return 28.7 * a - 46.7; }
  function a1cFromEag(mg) { return (mg + 46.7) / 28.7; }
  function fmtMg(mg) { return Math.round(mg) + " mg/dL"; }
  function fmtMmol(mg) { return (mg / MMOL).toFixed(1) + " mmol/L"; }
  function fmtG(mg, u) { return u === "mmol" ? fmtMmol(mg) : fmtMg(mg); }
  function catKey(a) { return a < 5.7 ? "tool.cat.normal" : (a < 6.5 ? "tool.cat.pre" : "tool.cat.dia"); }
  function catClass(a) { return a < 5.7 ? "cat-normal" : (a < 6.5 ? "cat-pre" : "cat-dia"); }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  // 라벨은 방향에 따라 바뀐다 — data-i18n 키까지 갈아끼워야 언어 전환 후에도 맞는 문구가 남는다.
  function setLabel(el, key) { el.setAttribute("data-i18n", key); el.textContent = t(key); }

  function syncInput() {
    var toG = direction.value === "a2g";
    setLabel($("value-label"), toG ? "tool.val.a1c" : "tool.val.glucose");
    value.placeholder = toG ? "6.5" : (unit.value === "mmol" ? "7.8" : "140");
  }

  function chart(a1cNow, u) {
    var body = $("chart-body"), p, tr, c1, c2;
    body.textContent = "";
    for (p = 5; p <= 12; p++) {
      tr = document.createElement("tr");
      if (Math.abs(p - a1cNow) < 0.5) tr.className = "hit";
      c1 = document.createElement("td"); c1.textContent = p + "%";
      c2 = document.createElement("td"); c2.textContent = fmtG(eagFromA1c(p), u);
      tr.appendChild(c1); tr.appendChild(c2);
      body.appendChild(tr);
    }
    $("th-eag").textContent = t("tool.th.eag") + (u === "mmol" ? " (mmol/L)" : " (mg/dL)");
  }

  function calc() {
    syncInput();
    var raw = parseFloat(String(value.value).replace(/,/g, ""));
    if (!isFinite(raw)) return fail("tool.err.empty");

    var u = unit.value, toG = direction.value === "a2g", a1c, mg;
    if (toG) {
      if (raw < 3 || raw > 20) return fail("tool.err.a1c");
      a1c = raw;
      mg = eagFromA1c(a1c);
    } else {
      mg = u === "mmol" ? raw * MMOL : raw;
      if (mg < 40 || mg > 600) return fail("tool.err.glucose");
      a1c = a1cFromEag(mg);
    }

    setLabel($("r-main-label"), toG ? "tool.r.eag" : "tool.r.a1c");
    setLabel($("r-alt-label"), toG ? "tool.r.a1c" : "tool.r.eag");
    $("r-main").textContent = toG ? fmtG(mg, u) : (a1c.toFixed(1) + "%");
    $("r-sub").textContent = toG ? (u === "mmol" ? fmtMg(mg) : fmtMmol(mg)) : "";
    $("r-alt").textContent = toG ? (a1c.toFixed(1) + "%") : fmtG(mg, u);

    var badge = $("r-cat");
    badge.className = "badge " + catClass(a1c);
    badge.textContent = t(catKey(a1c));

    chart(a1c, u);
    errEl.hidden = true;
    result.hidden = false;
  }

  syncInput();
  $("calc-btn").addEventListener("click", calc);
  value.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
  value.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  [direction, unit].forEach(function (el) {
    el.addEventListener("change", function () { syncInput(); if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { syncInput(); if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
