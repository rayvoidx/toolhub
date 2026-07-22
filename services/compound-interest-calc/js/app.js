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
  /* Compound Interest Calculator — principal + optional recurring monthly contribution,
     compounded daily/monthly/quarterly/annually. 상태: localStorage "<slug>:last" 만.
     외부 API 없음, 모든 계산은 로컬(월 단위 시뮬레이션). */

  var LS_KEY = ((window.APP_CONFIG && window.APP_CONFIG.slug) || "compound-interest-calc") + ":last";
  var SAFE = Number.MAX_SAFE_INTEGER;
  var LIM = { amount: 1e12, years: 100, ratePct: 1000, schedRows: 50 };

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상, Math 외 DOM 의존 없음)
  // 명목 연이율 r, 연 복리횟수 freq 에 대해 "그 복리 방식과 수학적으로 동일한" 월간 실효
  // 성장률을 구해 월 단위로 시뮬레이션한다: (1+r/freq)^freq = (1+rMonthly)^12 가 되도록
  // rMonthly = (1+r/freq)^(freq/12) - 1. 기여금은 매월 말(경상연금 관례)에 더해진다.
  function effMonthlyRate(r, freq) {
    if (!(freq > 0)) freq = 12;
    return Math.pow(1 + r / freq, freq / 12) - 1;
  }
  function computeCompound(principal, ratePct, years, freq, contribution, schedRowsCap) {
    var clipped = false;
    if (principal > LIM.amount) { principal = LIM.amount; clipped = true; }
    if (contribution > LIM.amount) { contribution = LIM.amount; clipped = true; }
    if (ratePct > LIM.ratePct) { ratePct = LIM.ratePct; clipped = true; }
    if (years > LIM.years) { years = LIM.years; clipped = true; }

    var r = ratePct / 100;
    var rMonthly = effMonthlyRate(r, freq);
    var totalMonths = Math.max(1, Math.round(years * 12));

    var balance = principal;
    var contributed = principal;
    var yearRows = [];
    var i;
    for (i = 1; i <= totalMonths; i++) {
      balance = balance * (1 + rMonthly) + contribution;
      contributed += contribution;
      if (i % 12 === 0 || i === totalMonths) {
        yearRows.push({
          yearLabel: i / 12,
          fractional: i % 12 !== 0,
          contributed: contributed,
          balance: balance,
          interest: balance - contributed
        });
      }
    }

    var truncated = false;
    var rows = yearRows;
    if (rows.length > schedRowsCap) {
      // cagr-calc 관례를 따라 앞에서부터 schedRowsCap 개만 보여주고 절삭 안내를 남긴다.
      rows = rows.slice(0, schedRowsCap);
      truncated = true;
    }

    return {
      ok: true, clipped: clipped,
      principal: principal, ratePct: ratePct, years: years, freq: freq, contribution: contribution,
      finalBalance: balance, totalContributed: contributed, totalInterest: balance - contributed,
      rows: rows, truncated: truncated
    };
  }
  // calc-core:end

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { effMonthlyRate: effMonthlyRate, computeCompound: computeCompound };
    return;
  }

  var CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CNY", "KRW", "INR", "BRL", "RUB",
    "IDR", "CAD", "AUD", "CHF", "HKD", "SGD", "TWD", "MXN", "ZAR", "TRY", "SEK"];
  var REGION_CCY = { US: "USD", GB: "GBP", JP: "JPY", CN: "CNY", HK: "HKD", TW: "TWD",
    KR: "KRW", IN: "INR", BR: "BRL", RU: "RUB", ID: "IDR", CA: "CAD", AU: "AUD",
    CH: "CHF", SG: "SGD", MX: "MXN", ZA: "ZAR", TR: "TRY", SE: "SEK",
    DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", PT: "EUR", IE: "EUR", AT: "EUR", FI: "EUR" };
  var LANG_CCY = { ko: "KRW", ja: "JPY", zh: "CNY", de: "EUR", fr: "EUR", es: "EUR",
    pt: "BRL", ru: "RUB", id: "IDR", hi: "INR", bn: "BDT", ar: "USD", ur: "PKR", en: "USD" };

  function $(id) { return document.getElementById(id); }
  var principalEl = $("principal-input"), rateEl = $("rate-input"), yearsEl = $("years-input");
  var freqEl = $("freq-select"), contribEl = $("contribution-input"), curSel = $("currency-select");
  var calcBtn = $("calc-btn");
  var box = $("result-box"), errEl = $("result-error"), bodyEl = $("result-body");
  if (!principalEl || !rateEl || !yearsEl || !freqEl || !curSel || !calcBtn || !box) return;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function fmtLocale() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) || navigator.language || "en";
  }
  // 유한화 가드 — Infinity/NaN 을 안전한 유한값으로 (지수표기 방지·조용한 실패 방지)
  function safe(v) {
    if (typeof v !== "number") return 0;
    if (isNaN(v)) return 0;
    if (v === Infinity) return SAFE;
    if (v === -Infinity) return -SAFE;
    if (v > SAFE) return SAFE;
    if (v < -SAFE) return -SAFE;
    return v;
  }

  // ── 금액 입력: 콤마 그룹핑 자동 포맷 · 파싱(소수점=".") ──
  function parseAmount(el) {
    if (!el) return null;
    var raw = String(el.value);
    var s = raw.replace(/[^0-9.]/g, "");
    var fd = s.indexOf(".");
    if (fd !== -1) s = s.slice(0, fd + 1) + s.slice(fd + 1).replace(/\./g, "");
    if (s === "" || s === ".") return null;
    var v = Number(s);
    return isFinite(v) ? v : null;
  }
  function reformatAmount(el) {
    var raw = el.value;
    var caret = el.selectionStart == null ? raw.length : el.selectionStart;
    var digitsBefore = (raw.slice(0, caret).match(/[0-9]/g) || []).length;
    var cleaned = raw.replace(/[^0-9.]/g, "");
    var fd = cleaned.indexOf(".");
    if (fd !== -1) cleaned = cleaned.slice(0, fd + 1) + cleaned.slice(fd + 1).replace(/\./g, "");
    var segs = cleaned.split(".");
    var intPart = segs[0].replace(/^0+(?=\d)/, "");
    var grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var out = grouped + (segs.length > 1 ? "." + segs[1] : "");
    if (out !== raw) {
      el.value = out;
      var pos = 0, seen = 0;
      while (pos < out.length && seen < digitsBefore) {
        if (/[0-9]/.test(out.charAt(pos))) seen++;
        pos++;
      }
      try { el.setSelectionRange(pos, pos); } catch (e) { /* noop */ }
    }
  }
  function num(el) {
    if (!el) return null;
    var v = el.valueAsNumber;
    if (isNaN(v)) { var s = String(el.value).trim().replace(",", "."); v = (s === "") ? NaN : Number(s); }
    return isNaN(v) ? null : v;
  }

  // ── Intl 포매팅 (하드코딩 없음 — 통화·천단위·소수 전부 Intl 위임, 지수표기 금지) ──
  function nf(opts) { try { return new Intl.NumberFormat(fmtLocale(), opts); } catch (e) { return new Intl.NumberFormat("en", opts); } }
  function cyDec(cur) { try { return nf({ style: "currency", currency: cur }).resolvedOptions().maximumFractionDigits; } catch (e) { return 2; } }
  function money(v, cur) {
    var d = cyDec(cur);
    try { return nf({ style: "currency", currency: cur, minimumFractionDigits: d, maximumFractionDigits: d }).format(safe(v)); }
    catch (e) { return String(safe(v)); }
  }
  function numFmt(v, maxdec) { return nf({ maximumFractionDigits: maxdec == null ? 0 : maxdec }).format(safe(v)); }

  // ── 통화 셀렉터 ──
  function detectCurrency() {
    var langs = navigator.languages || [navigator.language || ""];
    for (var i = 0; i < langs.length; i++) {
      var parts = String(langs[i]).split("-");
      if (parts.length > 1) {
        var region = parts[parts.length - 1].toUpperCase();
        if (REGION_CCY[region]) return REGION_CCY[region];
      }
    }
    var primary = String(langs[0] || "en").split("-")[0].toLowerCase();
    return LANG_CCY[primary] || "USD";
  }
  function curSymbol(cur) {
    try {
      var parts = nf({ style: "currency", currency: cur }).formatToParts(0);
      for (var i = 0; i < parts.length; i++) if (parts[i].type === "currency") return parts[i].value;
    } catch (e) { /* noop */ }
    return cur;
  }
  function fillCurrencies(selected) {
    var list = CURRENCIES.slice();
    if (list.indexOf(selected) === -1) list.unshift(selected);
    curSel.innerHTML = "";
    for (var i = 0; i < list.length; i++) {
      var opt = document.createElement("option");
      opt.value = list[i];
      opt.textContent = list[i] + " (" + curSymbol(list[i]) + ")";
      curSel.appendChild(opt);
    }
    curSel.value = selected;
  }

  var lastRun = false;
  function showNotice(key, fallback) {
    box.hidden = false; bodyEl.hidden = true; errEl.hidden = false;
    errEl.textContent = t(key, fallback);
  }

  function calculate() {
    lastRun = true;
    var cur = curSel.value || "USD";
    var principal = parseAmount(principalEl);
    var ratePct = num(rateEl);
    var years = num(yearsEl);
    var freq = Number(freqEl.value) || 12;
    var contribRaw = contribEl.value.trim();
    var contribution = contribRaw === "" ? 0 : parseAmount(contribEl);
    persist(cur);
    updateChips(years);

    // 엣지케이스(철칙 5 — 전부 명시 처리)
    if (principal == null && (contribution == null || contribution === 0)) {
      return showNotice("tool.err.empty", "Enter a principal amount, a monthly contribution, or both.");
    }
    if (principal == null) principal = 0;
    if (contribution == null) return showNotice("tool.err.contribution", "Monthly contribution can't be negative.");
    if (principal < 0) return showNotice("tool.err.principal", "Principal can't be negative.");
    if (contribution < 0) return showNotice("tool.err.contribution", "Monthly contribution can't be negative.");
    if (ratePct == null || ratePct < 0) return showNotice("tool.err.rate", "Interest rate can't be negative.");
    if (years == null || years <= 0) return showNotice("tool.err.years", "Number of years must be greater than 0.");

    var r = computeCompound(principal, ratePct, years, freq, contribution, LIM.schedRows);
    errEl.hidden = true; bodyEl.hidden = false; box.hidden = false;

    $("r-balance").textContent = money(r.finalBalance, cur);
    $("r-contrib").textContent = money(r.totalContributed, cur);
    $("r-interest").textContent = money(r.totalInterest, cur);

    var freqKey = freq === 365 ? "tool.freq.daily" : freq === 4 ? "tool.freq.quarterly" : freq === 1 ? "tool.freq.annually" : "tool.freq.monthly";
    $("r-sub").textContent = t("tool.result.sub", "From {principal} over {years} years at {rate}% annual interest, compounded {freq}.")
      .replace("{principal}", money(r.principal, cur))
      .replace("{years}", numFmt(r.years, 2))
      .replace("{rate}", numFmt(r.ratePct, 2))
      .replace("{freq}", t(freqKey, freqKey).toLowerCase());

    var contribNoteEl = $("r-contribnote");
    if (r.contribution > 0) {
      contribNoteEl.hidden = false;
      contribNoteEl.textContent = t("tool.result.contribNote", "Includes a {x} monthly contribution.")
        .replace("{x}", money(r.contribution, cur));
    } else {
      contribNoteEl.hidden = true;
    }

    var tbody = $("sched-body"); tbody.innerHTML = "";
    for (var i = 0; i < r.rows.length; i++) {
      var row = r.rows[i];
      var tr = document.createElement("tr");
      var tdY = document.createElement("td");
      tdY.textContent = row.fractional ? numFmt(row.yearLabel, 2) : numFmt(row.yearLabel, 0);
      var tdC = document.createElement("td"); tdC.textContent = money(row.contributed, cur);
      var tdI = document.createElement("td"); tdI.textContent = money(row.interest, cur);
      var tdB = document.createElement("td"); tdB.textContent = money(row.balance, cur);
      tr.appendChild(tdY); tr.appendChild(tdC); tr.appendChild(tdI); tr.appendChild(tdB);
      tbody.appendChild(tr);
    }
    var trunc = $("sched-trunc");
    if (r.truncated) {
      trunc.hidden = false;
      trunc.textContent = t("tool.sched.truncated", "Showing the first {n} years.").replace("{n}", numFmt(LIM.schedRows, 0));
    } else { trunc.hidden = true; }

    $("r-clipped").hidden = !r.clipped;
  }

  function updateChips(yv) {
    var chips = document.querySelectorAll("#year-chips .chip");
    for (var i = 0; i < chips.length; i++) {
      var dv = Number(chips[i].getAttribute("data-years"));
      chips[i].classList.toggle("is-active", yv != null && dv === yv);
    }
  }

  function persist(cur) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        principal: principalEl.value, rate: rateEl.value, years: yearsEl.value,
        freq: freqEl.value, contribution: contribEl.value, currency: cur
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }
  }

  // ── 초기화 · 복원 (상태는 프로세스 밖 — 철칙 1) ──
  (function init() {
    var saved = null;
    try { var s = localStorage.getItem(LS_KEY); if (s) saved = JSON.parse(s); } catch (e) { saved = null; }
    var startCur = (saved && saved.currency) || detectCurrency();
    fillCurrencies(startCur);
    if (saved) {
      if (saved.principal) principalEl.value = saved.principal;
      if (saved.rate) rateEl.value = saved.rate;
      if (saved.years) yearsEl.value = saved.years;
      if (saved.freq) freqEl.value = saved.freq;
      if (saved.contribution) contribEl.value = saved.contribution;
    } else {
      // 첫 방문자용 데모 기본값 — 즉시 결과를 보여줘 도구의 쓸모를 바로 체감하게 한다.
      principalEl.value = "10,000";
      rateEl.value = "6";
      yearsEl.value = "10";
      freqEl.value = "12";
    }
    updateChips(num(yearsEl));
    var ready = parseAmount(principalEl) != null || (contribEl.value.trim() !== "" && parseAmount(contribEl) != null);
    if (ready && num(yearsEl) != null) calculate();
  })();

  // ── 이벤트 배선: 실시간 재계산(oninput) + Enter ──
  function onAmountInput(e) { reformatAmount(e.target); calculate(); }
  principalEl.addEventListener("input", onAmountInput);
  contribEl.addEventListener("input", onAmountInput);
  rateEl.addEventListener("input", calculate);
  yearsEl.addEventListener("input", calculate);
  freqEl.addEventListener("change", calculate);
  curSel.addEventListener("change", calculate);
  var yearChips = document.querySelectorAll("#year-chips .chip");
  for (var yc = 0; yc < yearChips.length; yc++) {
    yearChips[yc].addEventListener("click", function () { yearsEl.value = this.getAttribute("data-years"); calculate(); });
  }
  calcBtn.addEventListener("click", calculate);
  function onEnter(e) { if (e.key === "Enter") calculate(); }
  [principalEl, rateEl, yearsEl, contribEl].forEach(function (el) { el.addEventListener("keydown", onEnter); });

  // ── 언어 전환: 통화기호·동적 문구·Intl 포맷을 새 로케일로 재렌더 ──
  document.addEventListener("i18n:change", function () {
    fillCurrencies(curSel.value);
    if (lastRun && !box.hidden) calculate();
  });
  // TOOLJS:END
})();
