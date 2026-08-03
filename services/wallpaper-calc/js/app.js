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
  var unit = $("unit"), width = $("width"), height = $("height");
  var rollw = $("rollw"), rolll = $("rolll"), repeatEl = $("repeat");
  var doors = $("doors"), windows = $("windows"), priceEl = $("price");
  var rollwC = $("rollw-custom"), rolllC = $("rolll-custom");
  var result = $("result"), errEl = $("err"), warnEl = $("warn");
  if (!unit || !width || !height || !rollw || !rolll) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el, dflt) {
    var v = parseFloat(String(el ? el.value : "").replace(/,/g, ""));
    return isFinite(v) ? v : dflt;
  };

  // 계산은 전부 인치로 통일한다 — 롤 규격(20.5in, 33ft)이 인치 기준이라 변환 지점을 하나로 묶는다.
  var TRIM = 4;        // 위아래 재단 여유 (2in + 2in)
  var DOOR_W = 36, DOOR_H = 80, WIN_W = 36, WIN_H = 48;  // 표준 개구부 (in)

  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function calc() {
    var isM = unit.value === "m";
    var toIn = isM ? 39.3700787 : 12;

    var w = num(width, NaN), h = num(height, NaN);
    if (!isFinite(w) || !isFinite(h)) return fail("tool.err.empty");
    var wIn = w * toIn, hIn = h * toIn;
    if (wIn <= 0 || hIn <= 0 || wIn > 12000 || hIn > 240) return fail("tool.err.range");

    var repIn = num(repeatEl, 0) * (isM ? 0.3937008 : 1);
    var doorsN = num(doors, 0), winsN = num(windows, 0);
    if (repIn < 0 || repIn > 240 || doorsN < 0 || winsN < 0 || num(priceEl, 0) < 0) return fail("tool.err.range");
    doorsN = Math.floor(doorsN); winsN = Math.floor(winsN);

    // 프리셋 밖 규격(필앤스틱 등)은 직접 입력 — 폭은 in/cm, 길이는 ft/m 단위로 받는다.
    var rollW = rollw.value === "custom"
      ? num(rollwC, NaN) * (isM ? 0.3937008 : 1)
      : parseFloat(rollw.value);
    var rollL = rolll.value === "custom"
      ? num(rolllC, NaN) * toIn
      : parseFloat(rolll.value) * 12;
    if (!isFinite(rollW) || !isFinite(rollL)) return fail("tool.err.empty");
    if (rollW < 4 || rollW > 120 || rollL < 12 || rollL > 2400) return fail("tool.err.range");

    // 리피트가 있으면 한 폭 길이를 다음 리피트 배수까지 올림한다 — 이게 무늬 손실의 정체다.
    var dropH = hIn + TRIM;
    if (repIn > 0) dropH = Math.ceil(dropH / repIn) * repIn;

    var perRoll = Math.floor(rollL / dropH);
    if (perRoll < 1) return fail("tool.err.short");

    var drops = Math.ceil(wIn / rollW);
    // 개구부는 너비의 절반만 인정한다 (무늬가 위아래로 계속 이어져야 해서 나머지는 버려진다).
    var credit = Math.floor(0.5 * (
      doorsN * (DOOR_W / rollW) * Math.min(1, DOOR_H / hIn) +
      winsN * (WIN_W / rollW) * Math.min(1, WIN_H / hIn)
    ));
    drops = Math.max(1, drops - credit);

    var rolls = Math.ceil(drops / perRoll);
    var wasteIn = dropH - hIn;
    var wastePct = Math.round((wasteIn / hIn) * 100);
    var wasteLen = isM ? Math.round(wasteIn * 2.54) + " cm" : Math.round(wasteIn) + " in";

    $("r-rolls").textContent = String(rolls);
    $("r-strips").textContent = String(drops);
    $("r-perroll").textContent = String(perRoll);
    $("r-waste").textContent = wastePct + "% · " + wasteLen;

    // 롤당 가격을 넣었을 때만 총액을 보여준다 — 통화는 사용자가 넣은 값 그대로.
    var price = num(priceEl, 0);
    var costCard = $("cost-card");
    if (costCard) {
      if (isFinite(price) && price > 0) {
        costCard.hidden = false;
        $("r-cost").textContent = (rolls * price).toLocaleString(undefined, { maximumFractionDigits: 2 });
      } else {
        costCard.hidden = true;
        $("r-cost").textContent = "—";
      }
    }

    if (repIn > 36) { warnEl.hidden = false; warnEl.textContent = t("tool.warn.repeat"); }
    else { warnEl.hidden = true; warnEl.textContent = ""; }

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [width, height, repeatEl, doors, windows, priceEl].forEach(function (el) {
    if (!el) return;
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  function syncCustom() {
    if (rollwC) rollwC.hidden = rollw.value !== "custom";
    if (rolllC) rolllC.hidden = rolll.value !== "custom";
  }
  syncCustom();
  [unit, rollw, rolll].forEach(function (el) {
    el.addEventListener("change", function () { syncCustom(); if (!result.hidden || !errEl.hidden) calc(); });
  });
  [rollwC, rolllC].forEach(function (el) {
    if (!el) return;
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
