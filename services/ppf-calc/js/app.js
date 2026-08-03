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
  var amount = $("amount"), rate = $("rate"), period = $("period");
  var result = $("result"), errEl = $("err"), tbody = $("tbody");
  if (!amount || !rate || !period) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var toggleBtn = $("toggle-rows"), showAll = false;
  var MIN = 500, CAP = 150000; // 회계연도당 법정 상한 1.5 lakh

  // 인도식 자릿수(마지막 3자리 뒤로 2자리씩): 4068209 -> 40,68,209
  function inr(n) {
    var s = String(Math.round(n)), last3 = s.slice(-3), rest = s.slice(0, -3);
    if (rest) last3 = "," + last3;
    return "₹" + rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + last3;
  }
  function big(n) {
    return n >= 10000000
      ? "≈ ₹" + (n / 10000000).toFixed(2) + " " + t("tool.unit.crore")
      : "≈ ₹" + (n / 100000).toFixed(2) + " " + t("tool.unit.lakh");
  }
  function num(el) { return parseFloat(String(el.value).replace(/,/g, "")); }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  // 연초 납입 가정: 잔액 = (잔액 + 납입액) × (1 + r). PPF 는 매년 이자를 원금에 편입한다.
  function schedule(deposit, r, years) {
    var rows = [], bal = 0, invested = 0;
    for (var y = 1; y <= years; y++) {
      invested += deposit;
      bal = (bal + deposit) * (1 + r);
      rows.push({ year: y, invested: invested, balance: bal });
    }
    return rows;
  }

  function calc() {
    var dep = num(amount);
    if (!isFinite(dep) || dep < MIN) return fail("tool.err.amount");
    if (dep > CAP) return fail("tool.err.cap");
    var pct = num(rate);
    if (!isFinite(pct)) return fail("tool.err.rate");
    if (pct < 0.1 || pct > 20) return fail("tool.err.raterange");

    var years = parseInt(period.value, 10) || 15;
    var rows = schedule(dep, pct / 100, years);
    var last = rows[rows.length - 1];
    var interest = last.balance - last.invested;

    $("r-maturity").textContent = inr(last.balance);
    $("r-words").textContent = big(last.balance);
    $("r-invested").textContent = inr(last.invested);
    $("r-interest").textContent = inr(interest);
    $("r-share").textContent = Math.round((interest / last.balance) * 100) + "%";

    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
    if (toggleBtn) toggleBtn.textContent = t(showAll ? "tool.table.less" : "tool.table.all");
    (showAll ? rows : rows.slice(-3)).forEach(function (row) {
      var tr = document.createElement("tr");
      var c1 = document.createElement("td"); c1.textContent = String(row.year);
      var c2 = document.createElement("td"); c2.className = "num"; c2.textContent = inr(row.invested);
      var c3 = document.createElement("td"); c3.className = "num"; c3.textContent = inr(row.balance);
      tr.appendChild(c1); tr.appendChild(c2); tr.appendChild(c3);
      tbody.appendChild(tr);
    });

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  if (toggleBtn) toggleBtn.addEventListener("click", function () { showAll = !showAll; calc(); });
  [amount, rate].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  period.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
