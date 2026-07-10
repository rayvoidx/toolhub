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

  // GA4 — 설정 시에만 로드, 실패해도 본 기능에 영향 없게 격리 (safeTrack 원칙)
  if (cfg.analytics && cfg.analytics.ga4) {
    try {
      var s = document.createElement("script");
      s.async = true;
      s.src = "https://www.googletagmanager.com/gtag/js?id=" + cfg.analytics.ga4;
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", cfg.analytics.ga4);
    } catch (e) { /* 분석 실패는 조용히 무시 */ }
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
  var cfg = window.APP_CONFIG || {};
  var LS_KEY = (cfg.slug || "savings-calc") + ":last";
  var LIM = { startMax: 1000000000, monthlyMax: 100000000, rateMax: 30, termMax: 360, taxMax: 60 };

  function $(id) { return document.getElementById(id); }
  var startEl = $("start-input");
  var monthlyEl = $("monthly-input");
  var rateEl = $("rate-input");
  var termEl = $("term-input");
  var taxEl = $("tax-input");
  var calcBtn = $("calc-btn");
  var box = $("result-box");
  var errEl = $("result-error");
  var bodyEl = $("result-body");
  var outMaturity = $("r-maturity");
  var outSub = $("r-sub");
  var outCompare = $("r-compare");
  var outPrincipal = $("r-principal");
  var outPreTax = $("r-pretax");
  var outTax = $("r-tax");
  var outAfterTax = $("r-aftertax");
  var clipNote = $("r-clipped");
  if (!startEl || !monthlyEl || !rateEl || !termEl || !taxEl || !calcBtn || !box) return;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function digitsOnly(s) { return String(s).replace(/[^\d]/g, ""); }

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상, Math 외 의존 없음)
  // 월초 납입 annuity-due, m = 연이율/100/12, n = 개월
  function interestFor(method, start, monthly, m, n) {
    if (method === "simple") {
      // 단리 세전이자 = 시작잔액·m·n + 월납입·m·n(n+1)/2
      return start * m * n + monthly * m * n * (n + 1) / 2;
    }
    // 월복리: m=0 이면 이자 0 (0-division 분기)
    if (m === 0) return 0;
    var growth = Math.pow(1 + m, n);
    var fv = start * growth + monthly * (1 + m) * (growth - 1) / m; // annuity-due FV
    return fv - (start + monthly * n);
  }
  function breakdown(rawInterest, principal, taxRate) {
    if (rawInterest < 0) rawInterest = 0;
    var preTax = Math.floor(rawInterest);
    var tax = Math.floor(rawInterest * taxRate / 100); // 과세율은 퍼센트값 — floor
    var afterTax = preTax - tax;                        // floor(pre) - tax → 카드 합이 항상 일치
    return { principal: principal, preTax: preTax, tax: tax, afterTax: afterTax, maturity: principal + afterTax };
  }
  function computeSavings(o) {
    var m = o.annualRate / 1200;
    var n = o.months;
    var principal = o.start + o.monthly * n;
    var simple = breakdown(interestFor("simple", o.start, o.monthly, m, n), principal, o.taxRate);
    var compound = breakdown(interestFor("compound", o.start, o.monthly, m, n), principal, o.taxRate);
    var sel = o.method === "simple" ? simple : compound;
    return {
      principal: principal,
      selected: sel,
      simple: simple,
      compound: compound,
      diff: compound.maturity - simple.maturity // 복리 우위 (m>=0 이면 >=0)
    };
  }
  // calc-core:end

  var last = null; // 마지막 렌더 상태 (언어 전환 재렌더용 — 영속 상태는 localStorage 에만)

  function radioVal(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }
  function setRadio(name, value) {
    var el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (el) el.checked = true;
  }
  function showError(key, fallback) {
    last = { kind: "error", key: key, fallback: fallback };
    box.hidden = false;
    bodyEl.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key, fallback);
  }
  function render(state) {
    last = { kind: "result", state: state };
    var res = state.res;
    errEl.hidden = true;
    bodyEl.hidden = false;
    box.hidden = false;

    outMaturity.textContent = group(res.selected.maturity);

    var methodName = state.method === "simple"
      ? t("tool.method.simple", "Simple interest")
      : t("tool.method.compound", "Monthly compound");
    outSub.textContent = methodName + " · " + state.rateLabel + "% · " + state.months + " " + t("tool.unit.months", "months");

    if (res.diff > 0) {
      outCompare.textContent = t("tool.compare.gain", "Monthly compounding earns {amt} more than simple interest over this term.").replace("{amt}", group(res.diff));
    } else {
      outCompare.textContent = t("tool.compare.same", "At this rate and term, simple and compound interest come out the same.");
    }

    outPrincipal.textContent = group(res.selected.principal);
    outPreTax.textContent = group(res.selected.preTax);
    outTax.textContent = (res.selected.tax > 0 ? "−" : "") + group(res.selected.tax);
    outAfterTax.textContent = group(res.selected.afterTax);

    clipNote.hidden = !state.clipped;
  }

  function calculate() {
    var startDigits = digitsOnly(startEl.value);
    var monthlyDigits = digitsOnly(monthlyEl.value);
    var rateRaw = rateEl.value.trim().replace(",", ".");
    var termRaw = termEl.value.trim();
    var taxRaw = taxEl.value.trim().replace(",", ".");
    var clipped = false;

    // 월 납입액 필수 — 빈값/0/음수는 명시 안내 (조용한 실패 금지)
    if (monthlyDigits === "" || Number(monthlyDigits) <= 0) {
      showError("tool.err.deposit", "Enter a monthly deposit greater than 0.");
      return;
    }
    // 연 이율 필수 (0% 는 유효)
    if (rateRaw === "" || isNaN(Number(rateRaw))) {
      showError("tool.err.rate", "Enter an annual interest rate between 0 and 30%.");
      return;
    }
    // 기간 필수 — 빈값/0/음수 차단
    var termNum = Math.floor(Number(termRaw));
    if (termRaw === "" || isNaN(Number(termRaw)) || termNum < 1) {
      showError("tool.err.term", "Enter a term between 1 and 360 months.");
      return;
    }

    // 상한 클리핑 (조합 최대 ≈ 3.6e13 → Number 안전 정수 범위 내)
    var startNum = startDigits === "" ? 0 : Number(startDigits);
    if (startNum > LIM.startMax) { startNum = LIM.startMax; clipped = true; }

    var monthlyNum = Number(monthlyDigits);
    if (monthlyNum > LIM.monthlyMax) { monthlyNum = LIM.monthlyMax; clipped = true; }

    var rateNum = Number(rateRaw);
    if (rateNum < 0) { rateNum = 0; clipped = true; }
    if (rateNum > LIM.rateMax) { rateNum = LIM.rateMax; clipped = true; }

    if (termNum > LIM.termMax) { termNum = LIM.termMax; clipped = true; }

    var taxNum = taxRaw === "" ? 0 : Number(taxRaw);
    if (isNaN(taxNum) || taxNum < 0) { taxNum = 0; clipped = true; }
    if (taxNum > LIM.taxMax) { taxNum = LIM.taxMax; clipped = true; }

    var method = radioVal("method") === "simple" ? "simple" : "compound";

    var res = computeSavings({
      start: startNum, monthly: monthlyNum, annualRate: rateNum,
      months: termNum, taxRate: taxNum, method: method
    });
    render({ res: res, method: method, rateLabel: rateNum, months: termNum, clipped: clipped });

    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        start: startNum, monthly: monthlyNum, rate: rateNum, term: termNum, method: method, tax: taxNum
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }

    updateChips();
  }

  function formatAmount(el) {
    var d = digitsOnly(el.value);
    el.value = d === "" ? "" : group(Number(d));
  }
  function updateChips() {
    var termVal = digitsOnly(termEl.value);
    var tc = document.querySelectorAll("#term-chips .chip");
    for (var i = 0; i < tc.length; i++) {
      tc[i].classList.toggle("is-active", tc[i].getAttribute("data-term") === termVal && termVal !== "");
    }
    var taxRaw = taxEl.value.trim().replace(",", ".");
    var xc = document.querySelectorAll("#tax-chips .chip");
    for (var j = 0; j < xc.length; j++) {
      var dv = xc[j].getAttribute("data-tax");
      xc[j].classList.toggle("is-active", taxRaw !== "" && Number(dv) === Number(taxRaw));
    }
  }

  // 이벤트 배선 — 실시간 재계산 + Enter
  startEl.addEventListener("input", function () { formatAmount(startEl); calculate(); });
  monthlyEl.addEventListener("input", function () { formatAmount(monthlyEl); calculate(); });
  rateEl.addEventListener("input", calculate);
  termEl.addEventListener("input", function () { calculate(); });
  taxEl.addEventListener("input", calculate);
  calcBtn.addEventListener("click", calculate);

  var methodRadios = document.querySelectorAll('input[name="method"]');
  for (var mi = 0; mi < methodRadios.length; mi++) methodRadios[mi].addEventListener("change", calculate);

  var termChipEls = document.querySelectorAll("#term-chips .chip");
  for (var ti = 0; ti < termChipEls.length; ti++) {
    termChipEls[ti].addEventListener("click", function () { termEl.value = this.getAttribute("data-term"); calculate(); });
  }
  var taxChipEls = document.querySelectorAll("#tax-chips .chip");
  for (var xi = 0; xi < taxChipEls.length; xi++) {
    taxChipEls[xi].addEventListener("click", function () { taxEl.value = this.getAttribute("data-tax"); calculate(); });
  }

  function onEnter(e) { if (e.key === "Enter") calculate(); }
  var enterEls = [startEl, monthlyEl, rateEl, termEl, taxEl];
  for (var ei = 0; ei < enterEls.length; ei++) enterEls[ei].addEventListener("keydown", onEnter);

  // 마지막 입력값 복원 (localStorage — 서버 미전송)
  (function restore() {
    try {
      var saved = localStorage.getItem(LS_KEY);
      if (!saved) return;
      var p = JSON.parse(saved);
      if (p.start != null && p.start > 0) startEl.value = group(p.start);
      if (p.monthly != null && p.monthly > 0) monthlyEl.value = group(p.monthly);
      if (p.rate != null) rateEl.value = p.rate;
      if (p.term != null) termEl.value = p.term;
      if (p.method === "simple" || p.method === "compound") setRadio("method", p.method);
      if (p.tax != null && p.tax > 0) taxEl.value = p.tax;
      if (p.monthly != null && p.monthly > 0) calculate();
    } catch (e) { /* 접근 불가·파싱 실패 — 빈 폼으로 시작 */ }
  })();
  updateChips();

  // 언어 전환 시 동적 문구(금액·비교·방식·오류) 재렌더
  document.addEventListener("i18n:change", function () {
    if (!last) return;
    if (last.kind === "error") showError(last.key, last.fallback);
    else render(last.state);
  });
  // TOOLJS:END
})();
