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
  var IDS = ["cash", "gold", "silver", "invest", "inventory", "receivable", "debts", "goldp", "silverp"];
  var els = {}, i;
  for (i = 0; i < IDS.length; i++) {
    els[IDS[i]] = $(IDS[i]);
    if (!els[IDS[i]]) return;
  }
  var result = $("result"), errEl = $("err");

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 니사브는 금 85g / 은 595g — 고전 기준(20 미스칼, 200 디르함)의 그램 환산.
  var GOLD_NISAB_G = 85, SILVER_NISAB_G = 595, RATE = 0.025;

  // 빈 칸은 0으로 보되, "전부 비었는지"는 따로 센다 — 조용히 0원 결과를 내지 않기 위해.
  function num(el) {
    var v = String(el.value).replace(/,/g, "").trim();
    if (v === "") return 0;
    var n = parseFloat(v);
    return isFinite(n) ? n : NaN;
  }
  function filled(el) { return String(el.value).trim() !== ""; }

  function fmt(n) {
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var v = {}, k;
    for (k = 0; k < IDS.length; k++) {
      v[IDS[k]] = num(els[IDS[k]]);
      if (isNaN(v[IDS[k]])) return fail("tool.err.number");
      if (v[IDS[k]] < 0) return fail("tool.err.negative");
    }

    var assets = ["cash", "gold", "silver", "invest", "inventory", "receivable"];
    var anyAsset = false;
    for (k = 0; k < assets.length; k++) if (filled(els[assets[k]]) && v[assets[k]] > 0) anyAsset = true;
    if (!anyAsset) return fail("tool.err.empty");

    // 보유한 금속에는 해당 시세가 있어야 하고, 니사브에는 둘 중 최소 하나가 필요하다.
    if (v.gold > 0 && !(v.goldp > 0)) return fail("tool.err.metalprice");
    if (v.silver > 0 && !(v.silverp > 0)) return fail("tool.err.metalprice");
    if (!(v.goldp > 0) && !(v.silverp > 0)) return fail("tool.err.metalprice");

    // 회수 예상 채권(receivable)은 내 재산이므로 더한다 — FAQ4 의 다수설.
    var zakatable = v.cash + v.gold * v.goldp + v.silver * v.silverp + v.invest + v.inventory + v.receivable - v.debts;

    var goldNisab = v.goldp > 0 ? GOLD_NISAB_G * v.goldp : null;
    var silverNisab = v.silverp > 0 ? SILVER_NISAB_G * v.silverp : null;
    var nisab, basis;
    if (goldNisab !== null && silverNisab !== null) {
      if (silverNisab <= goldNisab) { nisab = silverNisab; basis = "tool.basis.silver"; }
      else { nisab = goldNisab; basis = "tool.basis.gold"; }
    } else if (silverNisab !== null) { nisab = silverNisab; basis = "tool.basis.silver"; }
    else { nisab = goldNisab; basis = "tool.basis.gold"; }

    // 니사브 미만은 오류가 아니라 정당한 결과 — 결과 카드에 그대로 표시한다.
    $("r-zakat").textContent = zakatable >= nisab ? fmt(zakatable * RATE) : t("tool.r.below");
    $("r-wealth").textContent = fmt(zakatable);
    $("r-nisab").textContent = fmt(nisab) + " (" + t(basis) + ")";
    $("r-goldnisab").textContent = goldNisab !== null ? fmt(goldNisab) : "—";
    $("r-silvernisab").textContent = silverNisab !== null ? fmt(silverNisab) : "—";

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  for (i = 0; i < IDS.length; i++) {
    els[IDS[i]].addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    els[IDS[i]].addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  }
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
