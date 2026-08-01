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
  var basic = $("basic"), hraIn = $("hra"), rent = $("rent"), city = $("city");
  var result = $("result"), errEl = $("err"), zeroNote = $("zero-note");
  if (!basic || !hraIn || !rent || !city) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var inr = function (n) { return "₹" + Math.round(n).toLocaleString("en-IN"); };
  var num = function (el) { return parseFloat(String(el.value).replace(/[₹,\s]/g, "")); };

  var MAX = 10000000; // 월 1 crore 초과는 입력 오류로 본다

  // Section 10(13A): 세 한도 중 최솟값만 면세. 월 기준으로 계산한 뒤 12를 곱한다.
  function limbs(b, h, r, isMetro) {
    return [
      { key: "tool.limb.actual", value: h },
      { key: "tool.limb.rent", value: Math.max(0, r - 0.10 * b) },
      { key: isMetro ? "tool.limb.metro" : "tool.limb.nonmetro", value: (isMetro ? 0.50 : 0.40) * b }
    ];
  }

  function cell(text, cls) {
    var td = document.createElement("td");
    td.textContent = text;
    if (cls) td.className = cls;
    return td;
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var b = num(basic), h = num(hraIn), r = num(rent);
    if (!isFinite(b) || !isFinite(h) || !isFinite(r)) return fail("tool.err.empty");
    if (b < 0 || h < 0 || r < 0) return fail("tool.err.negative");
    if (b <= 0) return fail("tool.err.salary");
    if (b > MAX || h > MAX || r > MAX) return fail("tool.err.range");

    var isMetro = city.value === "metro";
    var rows = limbs(b, h, r, isMetro);
    var bind = 0;
    for (var i = 1; i < rows.length; i++) if (rows[i].value < rows[bind].value) bind = i;
    var exempt = rows[bind].value;

    $("r-exempt").textContent = inr(exempt * 12);
    $("r-exempt-m").textContent = t("tool.r.permonth").replace("{v}", inr(exempt));
    $("r-taxable").textContent = inr(Math.max(0, h - exempt) * 12);
    $("r-binding").textContent = t(rows[bind].key);

    var body = $("limb-body");
    body.textContent = "";
    rows.forEach(function (row, i) {
      var tr = document.createElement("tr");
      if (i === bind) tr.className = "bind";
      tr.appendChild(cell(t(row.key)));
      tr.appendChild(cell(inr(row.value), "num"));
      tr.appendChild(cell(inr(row.value * 12), "num"));
      body.appendChild(tr);
    });

    // 면세 0은 계산 실패가 아니라 결과다 — 왜 0인지 문장으로 밝힌다.
    if (exempt <= 0) {
      zeroNote.textContent = t(h <= 0 ? "tool.note.zerohra" : "tool.note.zerorent");
      zeroNote.hidden = false;
    } else {
      zeroNote.hidden = true;
    }

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [basic, hraIn, rent].forEach(function (el) {
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  city.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
