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
  var unit = $("unit"), len = $("len"), wid = $("wid");
  var spacing = $("spacing"), stick = $("stick"), clr = $("clear");
  var spCustom = $("spacing-custom"), spWrap = $("custom-wrap");
  var size = $("size"), price = $("price"), costCard = $("cost-card");
  var result = $("result"), errEl = $("err"), noteMin = $("note-min");
  if (!unit || !len || !wid || !spacing || !stick || !clr) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var M2F = 3.280839895;

  function num(el) { return parseFloat(String(el.value).replace(/,/g, "")); }
  function fmt(n) { return n >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10); }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var l = num(len), w = num(wid), c = num(clr);
    if (!isFinite(l) || !isFinite(w) || !isFinite(c)) return fail("tool.err.empty");
    if (l <= 0 || w <= 0 || c < 0) return fail("tool.err.zero");

    var metric = unit.value === "m";
    var lf = metric ? l * M2F : l;          // 계산은 전부 피트로 — 간격/여유가 인치라 단위를 하나로 묶는다
    var wf = metric ? w * M2F : w;
    if (lf > 500 || wf > 500) return fail("tool.err.range");

    var cf = c / 12;
    var effL = lf - 2 * cf, effW = wf - 2 * cf;
    if (effL <= 0 || effW <= 0) return fail("tool.err.clear");

    var sp = spacing.value === "custom" ? num(spCustom) : parseFloat(spacing.value);
    if (!isFinite(sp) || sp < 2 || sp > 48) return fail("tool.err.spacing");
    // 길이 방향 철근은 너비를 가로질러 배치된다 — 개수는 반대편 유효 치수로 정해진다.
    // 1e-9 은 미터→피트 환산 오차 보정 — 간격의 정확한 배수에서 칸이 하나 사라지는 것을 막는다.
    var nL = Math.floor(effW * 12 / sp + 1e-9) + 1;
    var nW = Math.floor(effL * 12 / sp + 1e-9) + 1;
    var minned = false;
    if (nL < 2) { nL = 2; minned = true; }
    if (nW < 2) { nW = 2; minned = true; }

    var linear = nL * effL + nW * effW;
    var sl = parseFloat(stick.value);
    var sticks = Math.ceil(linear * 1.05 / sl);   // 5% 는 겹이음 + 자투리
    var ties = nL * nW;
    var chairs = Math.ceil(effL * effW / 4);

    var u = metric ? t("tool.u.m") : t("tool.u.ft");
    var k = metric ? 1 / M2F : 1;
    $("r-linear").textContent = fmt(linear * k) + " " + u;
    $("r-sticks").textContent = sticks + " × " + sl + " " + t("tool.u.ft");
    $("r-barsL").textContent = nL + " × " + fmt(effL * k) + " " + u;
    $("r-barsW").textContent = nW + " × " + fmt(effW * k) + " " + u;
    $("r-ties").textContent = String(ties);
    $("r-chairs").textContent = String(chairs);

    // 중량·비용은 실제로 사는 물량(정척 개수 × 정척 길이) 기준 — 잔재까지 값을 치르기 때문
    var bought = sticks * sl;
    var lbft = size ? parseFloat(size.value) : 0.668;
    if (!isFinite(lbft)) lbft = 0.668;
    var lb = bought * lbft;
    $("r-weight").textContent = metric ? fmt(lb * 0.45359237) + " kg" : fmt(lb) + " lb";

    var pv = price ? String(price.value).trim() : "";
    if (pv === "") { if (costCard) costCard.hidden = true; }
    else {
      var p = num(price);
      if (!isFinite(p) || p < 0) return fail("tool.err.price");
      var cost = sticks * p;
      $("r-cost").textContent = cost >= 1000 ? String(Math.round(cost)) : String(Math.round(cost * 100) / 100);
      if (costCard) costCard.hidden = false;
    }

    if (noteMin) noteMin.hidden = !minned;

    errEl.hidden = true;
    result.hidden = false;
  }

  function syncCustom() { if (spWrap) spWrap.hidden = spacing.value !== "custom"; }
  syncCustom();
  spacing.addEventListener("change", syncCustom);

  $("calc-btn").addEventListener("click", calc);
  [len, wid, clr, spCustom, price].forEach(function (el) {
    if (!el) return;
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [unit, spacing, stick, size].forEach(function (el) {
    el.addEventListener("change", function () {
      // 커스텀으로 막 바꾼 직후 값이 비어 있으면 조용히 기다린다 — 입력 전 에러를 띄우지 않는다
      if (spacing.value === "custom" && spCustom && String(spCustom.value).trim() === "") return;
      if (!result.hidden || !errEl.hidden) calc();
    });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
