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
  var price = $("price"), buyer = $("buyer");
  var result = $("result"), errEl = $("err"), ftbNote = $("ftb-note");
  if (!price || !buyer) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var gbp = function (n) { return "£" + Math.round(n).toLocaleString("en-GB"); };
  var pct = function (r) { return (Math.round(r * 1000) / 10) + "%"; };

  // 잉글랜드·북아일랜드 SDLT 밴드 (2025-04-01 이후). 초과분에만 해당 세율이 붙는 누진 구조.
  var BANDS_STD = [
    { upTo: 125000, rate: 0 },
    { upTo: 250000, rate: 0.02 },
    { upTo: 925000, rate: 0.05 },
    { upTo: 1500000, rate: 0.10 },
    { upTo: Infinity, rate: 0.12 }
  ];
  // 생애최초 감면은 £500,000 이하에서만 — 초과하면 감면 자체가 사라지고 일반 밴드로 돌아간다.
  var BANDS_FTB = [
    { upTo: 300000, rate: 0 },
    { upTo: 500000, rate: 0.05 }
  ];
  var FTB_CAP = 500000;
  var SURCHARGE = 0.05;      // 추가 주택 할증 (2024-10-31 이후)
  var SURCHARGE_FLOOR = 40000; // £40,000 미만 거래에는 할증이 붙지 않는다

  function bandRows(p, kind) {
    var useFtb = kind === "ftb" && p <= FTB_CAP;
    var bands = useFtb ? BANDS_FTB : BANDS_STD;
    var sur = (kind === "additional" && p >= SURCHARGE_FLOOR) ? SURCHARGE : 0;
    var rows = [], lower = 0;
    for (var i = 0; i < bands.length; i++) {
      var upper = Math.min(bands[i].upTo, p);
      var amount = upper - lower;
      if (amount > 0) {
        var rate = bands[i].rate + sur;
        rows.push({ lo: lower, hi: bands[i].upTo, rate: rate, amount: amount, tax: amount * rate });
      }
      lower = bands[i].upTo;
      if (lower >= p) break;
    }
    return rows;
  }

  function cell(text, cls) {
    var td = document.createElement("td");
    td.textContent = text;
    if (cls) td.className = cls;
    return td;
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var p = parseFloat(String(price.value).replace(/[£,\s]/g, ""));
    if (!isFinite(p)) return fail("tool.err.empty");
    if (p <= 0 || p > 50000000) return fail("tool.err.range");

    var kind = buyer.value;
    var rows = bandRows(p, kind);
    var total = 0;
    for (var i = 0; i < rows.length; i++) total += rows[i].tax;

    $("r-duty").textContent = gbp(total);
    $("r-rate").textContent = (total / p * 100).toFixed(2) + "%";

    var body = $("band-body");
    body.textContent = "";
    rows.forEach(function (r) {
      var label = isFinite(r.hi) ? gbp(r.lo) + " – " + gbp(r.hi) : gbp(r.lo) + "+";
      var tr = document.createElement("tr");
      tr.appendChild(cell(label));
      tr.appendChild(cell(pct(r.rate)));
      tr.appendChild(cell(gbp(r.amount), "num"));
      tr.appendChild(cell(gbp(r.tax), "num"));
      body.appendChild(tr);
    });
    var totalRow = document.createElement("tr");
    totalRow.className = "total";
    var label = cell(t("tool.th.total"));
    label.colSpan = 3;
    totalRow.appendChild(label);
    totalRow.appendChild(cell(gbp(total), "num"));
    body.appendChild(totalRow);

    ftbNote.hidden = !(kind === "ftb" && p > FTB_CAP);
    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  price.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
  price.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  buyer.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
