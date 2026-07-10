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
  var LS_KEY = (cfg.slug || "loan-calc") + ":last";
  var MAX_AMOUNT = 1e12;   // 통화중립 상한 (KRW·JPY·IDR 자릿수 수용)
  var MAX_MONTHS = 600;    // 50년
  var MAX_RATE = 100;      // %
  var HEAD_ROWS = 12;      // 스케줄 기본 노출 행수
  var METHODS = ["amortized", "equal", "interest"];
  var METHOD_KEY = {
    amortized: "tool.method.amortized",
    equal: "tool.method.equal",
    interest: "tool.method.interest"
  };
  var METHOD_FALLBACK = {
    amortized: "Amortized (equal payment)",
    equal: "Equal principal (declining payment)",
    interest: "Interest-only (balloon)"
  };

  function $(id) { return document.getElementById(id); }
  var amountEl = $("amount-input");
  var rateEl = $("rate-input");
  var termEl = $("term-input");
  var unitEl = $("term-unit");
  var calcBtn = $("calc-btn");
  var box = $("result-box");
  var errEl = $("result-error");
  var bodyEl = $("result-body");
  var warnEl = $("result-warning");
  var monthlyLabelEl = $("monthly-label");
  var monthlyEl = $("r-monthly");
  var monthlyNoteEl = $("monthly-note");
  var interestEl = $("r-interest");
  var totalEl = $("r-total");
  var balloonLineEl = $("r-balloon-line");
  var balloonEl = $("r-balloon");
  var compareEl = $("compare-bars");
  var schedHeadEl = $("sched-head");
  var schedRestEl = $("sched-rest");
  var moreEl = $("schedule-more");
  var moreSummaryEl = $("schedule-more-summary");
  if (!amountEl || !rateEl || !termEl || !unitEl || !calcBtn || !box) return;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function activeLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) || "en";
  }
  // 표시 포맷: 활성 로케일 그룹핑, 통화 기호 미표기, 소수 2자리까지
  function fmt(n) {
    try { return new Intl.NumberFormat(activeLang(), { maximumFractionDigits: 2 }).format(n); }
    catch (e) {
      try { return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(n); }
      catch (e2) { return String(n); }
    }
  }
  function methodName(m) { return t(METHOD_KEY[m], METHOD_FALLBACK[m]); }

  // 금액 입력 천단위 콤마 (통화중립 — 순수 정수 부분만 그룹핑)
  function groupDigits(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function amountDigits() { return amountEl.value.replace(/[^\d]/g, ""); }

  // ── calc-core:start — 순수 계산 코어 (node 단위검증 대상) ──
  function round2(x) { return Math.round((x + 1e-9) * 100) / 100; }

  function computeMethod(P, annualRate, n, method) {
    var r = annualRate / 12 / 100;      // 월이율
    var rows = [];
    var balance = P;
    var totalInterest = 0, totalPayment = 0;
    var i, interest, principal, pay;
    if (method === "amortized") {
      // 원리금균등: 매월 동일 납입. r=0 이면 P/n 으로 분기(0-division 방지)
      var pmt = (r === 0) ? round2(P / n)
        : round2(P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1));
      for (i = 1; i <= n; i++) {
        interest = round2(balance * r);
        if (i === n) { principal = balance; pay = round2(principal + interest); }
        else {
          pay = pmt;
          principal = round2(pay - interest);
          if (principal > balance) { principal = balance; pay = round2(principal + interest); }
        }
        balance = round2(balance - principal);
        totalInterest = round2(totalInterest + interest);
        totalPayment = round2(totalPayment + pay);
        rows.push({ k: i, pay: pay, principal: principal, interest: interest, balance: balance < 0 ? 0 : balance });
      }
    } else if (method === "equal") {
      // 원금균등: 매월 원금 P/n 동일, 이자는 잔금에 비례 → 납입액 점감
      var mp = round2(P / n);
      for (i = 1; i <= n; i++) {
        interest = round2(balance * r);
        principal = (i === n) ? balance : mp;
        if (principal > balance) principal = balance;
        pay = round2(principal + interest);
        balance = round2(balance - principal);
        totalInterest = round2(totalInterest + interest);
        totalPayment = round2(totalPayment + pay);
        rows.push({ k: i, pay: pay, principal: principal, interest: interest, balance: balance < 0 ? 0 : balance });
      }
    } else {
      // 만기일시(interest-only + balloon): 매월 이자만, 마지막에 원금 일시상환
      var mi = round2(P * r);
      for (i = 1; i <= n; i++) {
        interest = mi;
        if (i === n) { principal = balance; pay = round2(principal + interest); }
        else { principal = 0; pay = interest; }
        balance = round2(balance - principal);
        totalInterest = round2(totalInterest + interest);
        totalPayment = round2(totalPayment + pay);
        rows.push({ k: i, pay: pay, principal: principal, interest: interest, balance: balance < 0 ? 0 : balance });
      }
    }
    return {
      rows: rows,
      totalInterest: totalInterest,
      totalPayment: totalPayment,
      first: rows[0].pay,
      last: rows[rows.length - 1].pay
    };
  }

  function computeAll(P, annualRate, n) {
    var out = {};
    for (var i = 0; i < METHODS.length; i++) out[METHODS[i]] = computeMethod(P, annualRate, n, METHODS[i]);
    return out;
  }
  // ── calc-core:end ──

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

  function rowHtml(row) {
    return "<tr style=\"text-align:right;border-bottom:1px solid var(--line);\">" +
      "<td style=\"text-align:left;padding:6px 8px;color:var(--muted);\">" + row.k + "</td>" +
      "<td style=\"padding:6px 8px;font-weight:600;\">" + fmt(row.pay) + "</td>" +
      "<td style=\"padding:6px 8px;\">" + fmt(row.principal) + "</td>" +
      "<td style=\"padding:6px 8px;\">" + fmt(row.interest) + "</td>" +
      "<td style=\"padding:6px 8px;color:var(--muted);\">" + fmt(row.balance) + "</td></tr>";
  }

  function renderCompare(all, selected) {
    var totals = METHODS.map(function (m) { return all[m].totalInterest; });
    var max = Math.max.apply(null, totals) || 1;
    var html = "";
    for (var i = 0; i < METHODS.length; i++) {
      var m = METHODS[i];
      var ti = all[m].totalInterest;
      var pct = max > 0 ? (ti / max) * 100 : 0;
      var isSel = m === selected;
      var barBg = isSel ? "var(--accent)" : "color-mix(in srgb, var(--accent) 35%, var(--line))";
      html += "<div style=\"margin-bottom:10px;\">" +
        "<div style=\"display:flex;justify-content:space-between;gap:8px;font-size:13px;margin-bottom:3px;\">" +
        "<span style=\"font-weight:" + (isSel ? "700" : "500") + ";color:" + (isSel ? "var(--ink)" : "var(--muted)") + ";\">" +
        methodName(m) + "</span>" +
        "<span style=\"font-weight:700;\">" + fmt(ti) + "</span></div>" +
        "<div style=\"height:10px;border-radius:6px;background:var(--line);overflow:hidden;\">" +
        "<div style=\"height:100%;width:" + pct.toFixed(2) + "%;background:" + barBg + ";\"></div></div></div>";
    }
    compareEl.innerHTML = html;
  }

  function renderSchedule(rows) {
    var headRows = rows.slice(0, HEAD_ROWS);
    var restRows = rows.slice(HEAD_ROWS);
    var h = "", i;
    for (i = 0; i < headRows.length; i++) h += rowHtml(headRows[i]);
    schedHeadEl.innerHTML = h;
    if (restRows.length > 0) {
      var r = "";
      for (i = 0; i < restRows.length; i++) r += rowHtml(restRows[i]);
      schedRestEl.innerHTML = r;
      moreSummaryEl.textContent = t("tool.schedule.more", "Show all {n} installments").replace("{n}", fmt(rows.length));
      moreEl.hidden = false;
      moreEl.open = false;
    } else {
      schedRestEl.innerHTML = "";
      moreEl.hidden = true;
    }
  }

  function render(state) {
    last = { kind: "result", state: state };
    var all = state.all;
    var sel = state.method;
    var m = all[sel];
    errEl.hidden = true;
    bodyEl.hidden = false;
    box.hidden = false;

    // 경고(범위 초과 클리핑)
    if (state.warn) { warnEl.hidden = false; warnEl.textContent = t("tool.warn.clip", "Some values exceeded the allowed range and were adjusted to the maximum."); }
    else warnEl.hidden = true;

    // 요약 — 월 납입액
    if (sel === "equal") {
      monthlyEl.textContent = fmt(m.first) + " → " + fmt(m.last);
      monthlyNoteEl.textContent = t("tool.result.decreasing", "Declines every month");
      monthlyNoteEl.hidden = false;
    } else {
      monthlyEl.textContent = fmt(m.first);
      monthlyNoteEl.hidden = true;
      monthlyNoteEl.textContent = "";
    }
    interestEl.textContent = fmt(m.totalInterest);
    totalEl.textContent = fmt(m.totalPayment);

    // 만기일시 — 마지막 balloon 납입액 별도 표기
    if (sel === "interest") {
      balloonLineEl.hidden = false;
      balloonEl.textContent = fmt(m.last);
    } else {
      balloonLineEl.hidden = true;
    }

    renderCompare(all, sel);
    renderSchedule(m.rows);
  }

  // 입력을 읽어 계산 상태를 만든다. 실패 시 showError 후 null.
  function calculate() {
    var amtStr = amountDigits();
    var rateRaw = rateEl.value.trim();
    var termRaw = termEl.value.trim();

    // 빈 입력 → 명시적 안내 (조용한 실패 금지)
    if (amtStr === "" || rateRaw === "" || termRaw === "") {
      showError("tool.err.empty", "Enter loan amount, rate, and term.");
      return;
    }
    var P = Number(amtStr);
    var rate = Number(rateRaw);
    var termVal = Number(termRaw);
    if (isNaN(P) || isNaN(rate) || isNaN(termVal)) {
      showError("tool.err.empty", "Enter loan amount, rate, and term.");
      return;
    }
    // 0·음수 금액 → 안내
    if (P <= 0) { showError("tool.err.empty", "Enter loan amount, rate, and term."); return; }
    // 음수 금리/기간 → 안내
    if (rate < 0) { showError("tool.err.rate", "Enter an interest rate between 0 and 100%."); return; }
    termVal = Math.floor(termVal);
    if (termVal <= 0) { showError("tool.err.term", "Enter a term of at least 1 month."); return; }

    // 개월 변환
    var months = unitEl.value === "months" ? termVal : termVal * 12;

    // 범위 초과 → 상한 클리핑 + 경고 + 입력 동기화
    var warn = false;
    if (P > MAX_AMOUNT) { P = MAX_AMOUNT; warn = true; amountEl.value = groupDigits(String(P)); }
    if (rate > MAX_RATE) { rate = MAX_RATE; warn = true; rateEl.value = String(MAX_RATE); }
    if (months > MAX_MONTHS) {
      months = MAX_MONTHS; warn = true;
      if (unitEl.value === "months") termEl.value = String(MAX_MONTHS);
      else { unitEl.value = "months"; termEl.value = String(MAX_MONTHS); }
    }

    var all = computeAll(P, rate, months);
    var method = radioVal("method") || "amortized";
    if (METHODS.indexOf(method) === -1) method = "amortized";

    render({ all: all, method: method, warn: warn, P: P, rate: rate, months: months });

    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        amount: amountDigits(), rate: rateEl.value.trim(),
        term: termEl.value.trim(), unit: unitEl.value, method: method
      }));
    } catch (e) { /* private mode — 저장 실패는 무시 */ }
  }

  // 금액 입력 실시간 콤마 그룹핑
  amountEl.addEventListener("input", function () {
    var digits = amountDigits();
    amountEl.value = digits === "" ? "" : groupDigits(digits);
  });

  // 상환방식 전환 시, 이미 결과가 있으면 재렌더 (재계산 없이 선택만 변경)
  var methodRadios = document.querySelectorAll('input[name="method"]');
  for (var mr = 0; mr < methodRadios.length; mr++) {
    methodRadios[mr].addEventListener("change", function () {
      if (last && last.kind === "result") {
        last.state.method = radioVal("method") || "amortized";
        render(last.state);
      }
    });
  }

  // 저장된 마지막 입력값 복원 (localStorage — 서버 미전송)
  (function restoreLast() {
    try {
      var saved = localStorage.getItem(LS_KEY);
      if (!saved) return;
      var p = JSON.parse(saved);
      if (p.amount) amountEl.value = groupDigits(String(p.amount).replace(/[^\d]/g, ""));
      if (p.rate != null && p.rate !== "") rateEl.value = p.rate;
      if (p.term != null && p.term !== "") termEl.value = p.term;
      if (p.unit === "years" || p.unit === "months") unitEl.value = p.unit;
      if (METHODS.indexOf(p.method) !== -1) setRadio("method", p.method);
    } catch (e) { /* 접근 불가·파싱 실패 — 빈 폼으로 시작 */ }
  })();

  calcBtn.addEventListener("click", calculate);
  function onEnter(e) { if (e.key === "Enter") calculate(); }
  amountEl.addEventListener("keydown", onEnter);
  rateEl.addEventListener("keydown", onEnter);
  termEl.addEventListener("keydown", onEnter);

  // 언어 전환 시 동적 문구(숫자 포맷·오류·방식 라벨·스케줄) 재렌더
  document.addEventListener("i18n:change", function () {
    if (!last) return;
    if (last.kind === "error") showError(last.key, last.fallback);
    else if (last.kind === "result") render(last.state);
  });
  // TOOLJS:END
})();
