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
  var income = $("income"), rule = $("rule"), down = $("down"), rate = $("rate"), debts = $("debts");
  var result = $("result"), errEl = $("err"), warnEl = $("warn-down"), cmpBody = $("cmp-body");
  if (!income || !rule || !rate) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { var v = parseFloat(String(el.value).replace(/[$,\s%]/g, "")); return isFinite(v) ? v : NaN; };
  var or0 = function (el) { var v = num(el); return isFinite(v) ? v : 0; };
  var money0 = function (n) { return Math.round(n).toLocaleString(); };
  var money2 = function (n) { return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  // 연금 현가계수 — 월 납입금으로 감당 가능한 원금(대출 한도)을 되짚는다.
  function loanFrom(payment, i, n) { return i === 0 ? payment * n : payment * (1 - Math.pow(1 + i, -n)) / i; }
  function paymentFrom(loan, i, n) { return i === 0 ? loan / n : loan * i / (1 - Math.pow(1 + i, -n)); }

  var RULES = ["r20410", "rgross", "rpay"];

  // 규칙별 예산. budget(월 여유액)이 0 이하면 납입금 기반 규칙은 성립하지 않아 null 을 돌려준다.
  function byRule(id, ctx) {
    if (id === "rgross") {
      var price = 0.35 * ctx.income;
      var loan = Math.max(0, price - ctx.down);
      return { price: price, loan: loan, payment: paymentFrom(loan, ctx.i, 60), term: 60 };
    }
    var term = id === "r20410" ? 48 : 60;
    if (ctx.budget <= 0) return null;
    var l = loanFrom(ctx.budget, ctx.i, term);
    return { price: l + ctx.down, loan: l, payment: ctx.budget, term: term };
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function row(id, r, selected) {
    var tr = document.createElement("tr");
    if (selected) tr.className = "sel";
    var c1 = document.createElement("td");
    c1.textContent = t("tool.rule." + id).split(" — ")[0];
    var c2 = document.createElement("td");
    var c3 = document.createElement("td");
    c2.textContent = r ? money0(r.price) : "—";
    c3.textContent = r ? money2(r.payment) : "—";
    tr.appendChild(c1); tr.appendChild(c2); tr.appendChild(c3);
    return tr;
  }

  function calc() {
    var inc = num(income), r = num(rate);
    if (isNaN(inc)) return fail("tool.err.empty");
    if (inc <= 0) return fail("tool.err.income");
    if (isNaN(r)) r = 0;
    if (r < 0 || r > 40) return fail("tool.err.rate");
    var d = or0(down), ex = or0(debts);
    if (d < 0 || ex < 0) return fail("tool.err.negative");

    var ctx = { income: inc, down: d, i: r / 100 / 12, budget: inc / 12 * 0.10 - ex };
    var id = rule.value;
    var sel = byRule(id, ctx);
    if (!sel) return fail("tool.err.debts");

    $("r-price").textContent = money0(sel.price);
    $("r-payment").textContent = money2(sel.payment);
    $("r-loan").textContent = money0(sel.loan);
    $("r-term").textContent = sel.term + " " + t("tool.r.months");

    // 20/4/10 은 선수금 20%가 전제 — 부족하면 얼마가 필요한지 숫자로 알려준다.
    var need = 0.20 * sel.price;
    if (id === "r20410" && d < need - 0.5) {
      warnEl.textContent = t("tool.warn.down").replace("{amt}", money0(need));
      warnEl.hidden = false;
    } else { warnEl.hidden = true; }

    while (cmpBody.firstChild) cmpBody.removeChild(cmpBody.firstChild);
    RULES.forEach(function (rid) { cmpBody.appendChild(row(rid, byRule(rid, ctx), rid === id)); });

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [income, down, rate, debts].forEach(function (el) {
    if (!el) return;
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  rule.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
