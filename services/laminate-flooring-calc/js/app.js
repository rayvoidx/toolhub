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
  var unit = $("unit"), len = $("len"), wid = $("wid"), boxcov = $("boxcov");
  var waste = $("waste"), pad = $("pad"), doors = $("doors"), price = $("price"), roll = $("roll");
  var result = $("result"), errEl = $("err");
  if (!unit || !len || !wid || !boxcov || !waste) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var SQFT_PER_SQM = 10.7639;
  var ROLL_SQFT = 100;   // 표준 언더레이 롤 1개 = 100 sq ft

  function num(el) { return parseFloat(String(el.value).replace(/,/g, "")); }
  function fmt(n) { return (Math.round(n * 10) / 10).toLocaleString(); }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var l = num(len), w = num(wid), cov = num(boxcov);
    if (!isFinite(l) || !isFinite(w) || !isFinite(cov)) return fail("tool.err.empty");
    if (l <= 0 || w <= 0) return fail("tool.err.zero");
    if (cov < 5 || cov > 60) return fail("tool.err.box");

    var dRaw = String(doors.value).trim();
    var d = dRaw === "" ? 0 : parseFloat(dRaw);
    if (!isFinite(d) || d < 0) return fail("tool.err.doors");

    var pRaw = String(price.value).replace(/,/g, "").trim();
    var p = pRaw === "" ? NaN : parseFloat(pRaw);
    if (pRaw !== "" && (!isFinite(p) || p < 0)) return fail("tool.err.price");

    var rRaw = roll ? String(roll.value).replace(/,/g, "").trim() : "";
    var rollSqft = ROLL_SQFT;
    if (rRaw !== "") {
      rollSqft = parseFloat(rRaw);
      if (!isFinite(rollSqft) || rollSqft < 10 || rollSqft > 1000) return fail("tool.err.roll");
    }

    // 박스 라벨은 어느 나라 제품이든 sq ft 로 통일해 입력받는다 — 미터 입력이면 면적만 환산.
    var area = unit.value === "m" ? l * w * SQFT_PER_SQM : l * w;
    var total = area * (1 + parseFloat(waste.value) / 100);
    var boxes = Math.ceil(total / cov);
    var sqft = t("tool.u.sqft");

    $("r-boxes").textContent = boxes.toLocaleString() + " " + t("tool.u.boxes");
    $("r-area").textContent = fmt(area) + " " + sqft;
    $("r-total").textContent = fmt(total) + " " + sqft;
    // 언더레이는 재단 손실이 거의 없어 실면적 기준. 일체형 패드 제품이면 아예 불필요.
    $("r-rolls").textContent = (pad && pad.checked) ? t("tool.r.rolls.none") : String(Math.ceil(area / rollSqft));
    $("r-strips").textContent = String(Math.round(d));
    $("r-cost").textContent = isFinite(p) ? (boxes * p).toFixed(2) : "—";

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [len, wid, boxcov, doors, price, roll].forEach(function (el) {
    if (el) el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [unit, waste, pad].forEach(function (el) {
    if (el) el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
