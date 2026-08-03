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
  var rent = $("rent"), movein = $("movein"), method = $("method"), period = $("period");
  var result = $("result"), errEl = $("err");
  if (!rent || !movein || !method || !period) return;

  // 날짜 라벨은 청구 기간에 따라 입주일/퇴거일로 바뀐다.
  function syncDateLabel() {
    var lab = document.querySelector('label[for="movein"]');
    if (!lab) return;
    lab.setAttribute("data-i18n", period.value === "out" ? "tool.date.label.out" : "tool.date.label");
    lab.textContent = t(lab.getAttribute("data-i18n"));
  }

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var money = function (n) { return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  // 빈 날짜 칸은 브라우저마다 표시가 달라 첫 화면이 애매하다 — 이번 달 중순으로 시작한다.
  if (!movein.value) {
    var now = new Date();
    movein.value = now.getFullYear() + "-" + (now.getMonth() < 9 ? "0" : "") + (now.getMonth() + 1) + "-18";
  }

  var METHODS = [
    { key: "actual", label: "tool.method.actual" },
    { key: "banker", label: "tool.method.banker" },
    { key: "year", label: "tool.method.year" }
  ];

  // 세 방식은 하루 단가만 다르다. 거주 일수(입주일~월말)는 공통이라 비교가 성립한다.
  function dailyRate(key, monthly, daysInMonth) {
    if (key === "banker") return monthly / 30;
    if (key === "year") return monthly * 12 / 365;
    return monthly / daysInMonth;
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var monthly = parseFloat(String(rent.value).replace(/,/g, ""));
    if (!isFinite(monthly) || monthly <= 0) return fail("tool.err.rent");
    if (monthly >= 100000000) return fail("tool.err.max");

    var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(movein.value || "");
    if (!parts) return fail("tool.err.date");
    var y = +parts[1], mo = +parts[2], d = +parts[3];
    if (mo < 1 || mo > 12 || d < 1) return fail("tool.err.date");
    var daysInMonth = new Date(y, mo, 0).getDate();
    if (d > daysInMonth) return fail("tool.err.date");

    // 입주는 그날부터 월말까지, 퇴거는 1일부터 그날까지 — 양쪽 다 해당일 포함.
    var daysOccupied = period.value === "out" ? d : daysInMonth - d + 1;
    var chosen = dailyRate(method.value, monthly, daysInMonth);

    $("r-prorated").textContent = money(chosen * daysOccupied);
    $("r-daily").textContent = money(chosen);
    $("r-days").textContent = daysOccupied + " / " + daysInMonth;

    var body = $("cmp-body");
    while (body.firstChild) body.removeChild(body.firstChild);
    METHODS.forEach(function (m) {
      var rate = dailyRate(m.key, monthly, daysInMonth);
      var tr = document.createElement("tr");
      if (m.key === method.value) tr.className = "sel";
      [t(m.label), money(rate), money(rate * daysOccupied)].forEach(function (txt) {
        var td = document.createElement("td");
        td.textContent = txt;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [rent, movein].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  [movein, method, period].forEach(function (el) {
    el.addEventListener("change", function () { syncDateLabel(); if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { syncDateLabel(); if (!result.hidden || !errEl.hidden) calc(); });
  syncDateLabel();
  // TOOLJS:END
})();
