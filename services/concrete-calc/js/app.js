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
  var shape = $("shape"), waste = $("waste"), result = $("result"), errEl = $("err");
  if (!shape || !result || !errEl) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 형태별 입력 id — 순서가 계산식의 인자 순서다.
  var FIELDS = {
    slab: ["slab-len", "slab-wid", "slab-thk"],
    footing: ["ftg-len", "ftg-wid", "ftg-dep"],
    column: ["col-dia", "col-hgt", "col-cnt"]
  };
  var SHAPES = ["slab", "footing", "column"];
  // 봉투 수율(cu ft) — 제조사 표기 기준. 80lb 0.60, 60lb 0.45.
  var YIELD80 = 0.6, YIELD60 = 0.45;
  var FT3_TO_M3 = 0.0283168466;

  function num(id) {
    var el = $(id);
    if (!el) return NaN;
    var s = String(el.value).replace(/,/g, "").trim();
    if (!s) return NaN;
    var v = parseFloat(s);
    return isFinite(v) ? v : NaN;
  }
  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }
  function showFields() {
    for (var i = 0; i < SHAPES.length; i++) {
      var g = $("g-" + SHAPES[i]);
      if (g) g.hidden = SHAPES[i] !== shape.value;
    }
  }

  function calc() {
    var sh = FIELDS[shape.value] ? shape.value : "slab";
    var ids = FIELDS[sh], v = [], i;
    for (i = 0; i < ids.length; i++) {
      var n = num(ids[i]);
      if (isNaN(n)) return fail("tool.err.empty");
      v.push(n);
    }
    // 기둥 개수는 정수 1 이상 — 0.5개짜리 기둥은 없다.
    if (sh === "column") {
      if (v[2] < 1) return fail("tool.err.count");
      v[2] = Math.floor(v[2]);
    }
    for (i = 0; i < v.length; i++) if (v[i] <= 0) return fail("tool.err.zero");

    // 인치 치수는 곱하기 전에 피트로 바꾼다 — 나중에 나누면 12배·144배 오차가 난다.
    var ft3;
    if (sh === "slab") ft3 = v[0] * v[1] * (v[2] / 12);
    else if (sh === "footing") ft3 = v[0] * (v[1] / 12) * (v[2] / 12);
    else ft3 = Math.PI * Math.pow(v[0] / 24, 2) * v[1] * v[2];

    if (waste && waste.checked) ft3 = ft3 * 1.1;
    var yd3 = ft3 / 27;

    $("r-yards").textContent = (yd3 < 0.05 ? yd3.toFixed(3) : yd3.toFixed(2)) + " yd³";
    $("r-meters").textContent = (ft3 * FT3_TO_M3).toFixed(2) + " m³";
    $("r-feet").textContent = ft3.toFixed(2) + " ft³";
    $("r-bags80").textContent = Math.ceil(ft3 / YIELD80).toLocaleString();
    $("r-bags60").textContent = Math.ceil(ft3 / YIELD60).toLocaleString();

    var note = $("r-note");
    if (yd3 > 1) { note.textContent = t("tool.note.readymix"); note.hidden = false; }
    else { note.textContent = ""; note.hidden = true; }

    // 100 yd³ 초과는 대개 단위 착오(인치를 피트로 넣음) — 막지는 않고 경고만 한다.
    var warn = $("r-warn");
    if (yd3 > 100) { warn.textContent = t("tool.note.big"); warn.hidden = false; }
    else { warn.textContent = ""; warn.hidden = true; }

    errEl.hidden = true;
    result.hidden = false;
  }

  function recalc() { if (!result.hidden || !errEl.hidden) calc(); }

  showFields();
  $("calc-btn").addEventListener("click", calc);
  shape.addEventListener("change", function () { showFields(); recalc(); });
  if (waste) waste.addEventListener("change", recalc);
  Array.prototype.forEach.call(document.querySelectorAll("#tool input[type=number]"), function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  document.addEventListener("i18n:change", recalc);
  // TOOLJS:END
})();
