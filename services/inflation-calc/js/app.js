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
  /* Inflation Calculator — amount, average annual inflation rate %, years -> either
     (a) "future" mode: purchasing power of today's amount N years from now + the
         nominal amount you'd need then to match today's buying power, or
     (b) "past" mode: today's equivalent value of an amount from N years ago.
     Rate-based compounding only (no CPI database) — the rate is whatever the user enters.
     State: localStorage "<slug>:last" only. No external API, no network calls. */

  var cfg = window.APP_CONFIG || {};
  var LS_KEY = (cfg.slug || "inflation-calc") + ":last";
  var SAFE = Number.MAX_SAFE_INTEGER;
  var LIM = { amount: 1e15, rateMin: -99, rateMax: 1000, years: 300, schedRows: 50 };

  var CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CNY", "KRW", "INR", "BRL", "RUB",
    "IDR", "CAD", "AUD", "CHF", "HKD", "SGD", "TWD", "MXN", "ZAR", "TRY", "SEK"];
  var REGION_CCY = { US: "USD", GB: "GBP", JP: "JPY", CN: "CNY", HK: "HKD", TW: "TWD",
    KR: "KRW", IN: "INR", BR: "BRL", RU: "RUB", ID: "IDR", CA: "CAD", AU: "AUD",
    CH: "CHF", SG: "SGD", MX: "MXN", ZA: "ZAR", TR: "TRY", SE: "SEK",
    DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", PT: "EUR", IE: "EUR", AT: "EUR", FI: "EUR" };
  var LANG_CCY = { ko: "KRW", ja: "JPY", zh: "CNY", de: "EUR", fr: "EUR", es: "EUR",
    pt: "BRL", ru: "RUB", id: "IDR", hi: "INR", bn: "BDT", ar: "USD", ur: "PKR", en: "USD" };

  function $(id) { return document.getElementById(id); }
  var amountEl = $("amount-input"), rateEl = $("rate-input"), yearsEl = $("years-input");
  var curSel = $("currency-select"), calcBtn = $("calc-btn");
  var amountNoteEl = $("amount-note"), yearsNoteEl = $("years-note");
  var rateChipsWrap = $("rate-chips"), yearChipsWrap = $("year-chips");
  var box = $("result-box"), errEl = $("result-error"), bodyEl = $("result-body");
  var heroLabelEl = $("r-hero-label"), heroValEl = $("r-hero");
  var inflPctEl = $("r-inflpct");
  var costCardEl = $("card-cost"), costValEl = $("r-cost");
  var subEl = $("r-sub");
  var clippedEl = $("r-clipped");
  var schedThAEl = $("sched-th-a"), schedThBEl = $("sched-th-b");
  var schedBodyEl = $("sched-body"), schedTruncEl = $("sched-trunc");
  if (!amountEl || !rateEl || !yearsEl || !curSel || !calcBtn || !box) return;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function fmtLocale() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) || navigator.language || "en";
  }
  function radioVal(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
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
  // 비율·연수 입력: 소수 허용, 콤마 무시
  function parseNum(raw) {
    if (raw == null) return null;
    var s = String(raw).trim().replace(/,/g, "");
    if (s === "") return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  // ── Intl 포매팅 (하드코딩 없음 — 통화·천단위·소수 전부 Intl 위임, 지수표기 금지) ──
  function nf(opts) { try { return new Intl.NumberFormat(fmtLocale(), opts); } catch (e) { return new Intl.NumberFormat("en", opts); } }
  function cyDec(cur) { try { return nf({ style: "currency", currency: cur }).resolvedOptions().maximumFractionDigits; } catch (e) { return 2; } }
  function money(v, cur) {
    var d = cyDec(cur);
    try { return nf({ style: "currency", currency: cur, minimumFractionDigits: d, maximumFractionDigits: d }).format(safe(v)); }
    catch (e) { return String(safe(v)); }
  }
  function numFmt(v, maxdec) { return nf({ maximumFractionDigits: maxdec == null ? 2 : maxdec }).format(safe(v)); }
  function pctNumFmt(percentAlready, withSign) {
    var x = safe(percentAlready);
    var s = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x) + "%";
    return (withSign && x > 0) ? "+" + s : s;
  }

  // calc-core:start — 순수 계산 코어 (Math·Intl 외 DOM 의존 없음)
  // growth = (1+rate)^years · grown = amount·growth(뒤 방향으로 이동한 금액)
  // shrunk = amount÷growth(앞 방향으로 이동한 금액 = 오늘 금액의 미래 구매력) · inflPct = 누적 물가 변화율
  function computeGrowth(amount, ratePct, years) {
    var r = ratePct / 100;
    var growth = Math.pow(1 + r, years);
    return {
      growth: growth,
      grown: amount * growth,
      shrunk: growth !== 0 ? amount / growth : 0,
      inflPct: (growth - 1) * 100
    };
  }
  // 연도별 표: future = 구매력(감소)+명목 등가비용(증가) 2열, past = 등가가치(증가) 1열
  function buildSchedule(amount, ratePct, years, mode, maxRows) {
    var r = ratePct / 100;
    var full = Math.floor(years);
    var truncated = full > maxRows;
    var lim = truncated ? maxRows : full;
    var rows = [];
    for (var i = 1; i <= lim; i++) {
      var g = Math.pow(1 + r, i);
      if (mode === "future") rows.push({ year: i, power: amount / g, cost: amount * g });
      else rows.push({ year: i, value: amount * g });
    }
    return { rows: rows, truncated: truncated };
  }
  // calc-core:end

  // ── 통화 셀렉터 (cagr-calc 패턴 재사용) ──
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

  function mode() { return radioVal("calcmode") || "future"; }

  function renderModeCopy() {
    var m = mode();
    if (amountNoteEl) amountNoteEl.textContent = t(m === "future" ? "tool.amount.note.future" : "tool.amount.note.past", "");
    if (yearsNoteEl) yearsNoteEl.textContent = t(m === "future" ? "tool.years.note.future" : "tool.years.note.past", "");
    if (costCardEl) costCardEl.hidden = m !== "future";
    if (schedThAEl) schedThAEl.textContent = t(m === "future" ? "tool.sched.power" : "tool.sched.value", "");
    if (schedThBEl) schedThBEl.hidden = m !== "future";
    if (schedThBEl && m === "future") schedThBEl.textContent = t("tool.sched.cost", "");
  }

  var lastRun = false;
  function showNotice(key, fallback) {
    box.hidden = false; bodyEl.hidden = true; errEl.hidden = false;
    errEl.textContent = t(key, fallback);
  }

  function calculate() {
    lastRun = true;
    var cur = curSel.value || "USD";
    var m = mode();
    var amount = parseAmount(amountEl);
    var rate = parseNum(rateEl.value);
    var years = parseNum(yearsEl.value);
    persist(cur, m);
    updateChips(rate, years);
    renderModeCopy();

    // 엣지케이스 (철칙 5 — 전부 명시 처리)
    if (amount == null || rate == null || years == null) {
      return showNotice("tool.err.empty", "Enter an amount, an inflation rate, and the number of years.");
    }
    if (!(amount > 0)) return showNotice("tool.err.amount", "Amount must be greater than 0.");
    if (!(years > 0)) return showNotice("tool.err.years", "Years must be greater than 0.");
    if (rate <= LIM.rateMin) return showNotice("tool.err.rate", "Rate must be greater than -99%.");

    var a = amount, rt = rate, yrs = years, clipped = false;
    if (a > LIM.amount) { a = LIM.amount; clipped = true; }
    if (rt > LIM.rateMax) { rt = LIM.rateMax; clipped = true; }
    if (rt < LIM.rateMin) { rt = LIM.rateMin; clipped = true; }
    if (yrs > LIM.years) { yrs = LIM.years; clipped = true; }
    yrs = Math.floor(yrs);
    if (yrs < 1) yrs = 1;

    var g = computeGrowth(a, rt, yrs);
    errEl.hidden = true; bodyEl.hidden = false; box.hidden = false;

    inflPctEl.textContent = pctNumFmt(g.inflPct, true);

    if (m === "future") {
      heroLabelEl.textContent = t("tool.result.power", "Purchasing power in {years} years").replace("{years}", numFmt(yrs, 0));
      heroValEl.textContent = money(g.shrunk, cur);
      costCardEl.hidden = false;
      costValEl.textContent = money(g.grown, cur);
      subEl.textContent = t("tool.result.sub.future",
        "At {rate}% average annual inflation, {amount} today will have the purchasing power of about {power} in {years} years — and you'd need about {cost} then just to match what {amount} buys today.")
        .replace(/{rate}/g, numFmt(rt, 2)).replace(/{amount}/g, money(a, cur))
        .replace(/{years}/g, numFmt(yrs, 0)).replace(/{power}/g, money(g.shrunk, cur))
        .replace(/{cost}/g, money(g.grown, cur));
    } else {
      heroLabelEl.textContent = t("tool.result.today", "Equivalent value today");
      heroValEl.textContent = money(g.grown, cur);
      costCardEl.hidden = true;
      subEl.textContent = t("tool.result.sub.past",
        "At {rate}% average annual inflation, {amount} from {years} years ago has the same purchasing power as about {today} today.")
        .replace(/{rate}/g, numFmt(rt, 2)).replace(/{amount}/g, money(a, cur))
        .replace(/{years}/g, numFmt(yrs, 0)).replace(/{today}/g, money(g.grown, cur));
    }

    var sc = buildSchedule(a, rt, yrs, m, LIM.schedRows);
    schedBodyEl.innerHTML = "";
    for (var i = 0; i < sc.rows.length; i++) {
      var row = sc.rows[i];
      var tr = document.createElement("tr");
      var tdYear = document.createElement("td");
      tdYear.textContent = numFmt(row.year, 0);
      tr.appendChild(tdYear);
      if (m === "future") {
        var tdPower = document.createElement("td");
        tdPower.textContent = money(row.power, cur);
        tr.appendChild(tdPower);
        var tdCost = document.createElement("td");
        tdCost.textContent = money(row.cost, cur);
        tr.appendChild(tdCost);
      } else {
        var tdVal = document.createElement("td");
        tdVal.textContent = money(row.value, cur);
        tr.appendChild(tdVal);
      }
      schedBodyEl.appendChild(tr);
    }
    if (sc.truncated) {
      schedTruncEl.hidden = false;
      schedTruncEl.textContent = t("tool.sched.truncated", "Showing the first {n} years.").replace("{n}", numFmt(LIM.schedRows, 0));
    } else { schedTruncEl.hidden = true; }

    clippedEl.hidden = !clipped;
  }

  function updateChips(rate, years) {
    var rc = rateChipsWrap ? rateChipsWrap.querySelectorAll(".chip") : [];
    for (var i = 0; i < rc.length; i++) {
      var rv = Number(rc[i].getAttribute("data-rate"));
      rc[i].classList.toggle("is-active", rate != null && rv === rate);
    }
    var yc = yearChipsWrap ? yearChipsWrap.querySelectorAll(".chip") : [];
    for (var j = 0; j < yc.length; j++) {
      var yv = Number(yc[j].getAttribute("data-years"));
      yc[j].classList.toggle("is-active", years != null && yv === years);
    }
  }

  function persist(cur, m) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        amount: amountEl.value, rate: rateEl.value, years: yearsEl.value,
        currency: cur, mode: m
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
      if (saved.amount) amountEl.value = saved.amount;
      if (saved.rate) rateEl.value = saved.rate;
      if (saved.years) yearsEl.value = saved.years;
      if (saved.mode === "past" || saved.mode === "future") {
        var el = document.querySelector('input[name="calcmode"][value="' + saved.mode + '"]');
        if (el) el.checked = true;
      }
    } else {
      // 첫 방문 기본값 — 대표적인 시나리오로 결과를 바로 보여준다
      if (!amountEl.value) amountEl.value = "1,000";
      if (!rateEl.value) rateEl.value = "3";
      if (!yearsEl.value) yearsEl.value = "10";
    }
    renderModeCopy();
    var ready = parseAmount(amountEl) != null && parseNum(rateEl.value) != null && parseNum(yearsEl.value) != null;
    if (ready) calculate(); else updateChips(parseNum(rateEl.value), parseNum(yearsEl.value));
  })();

  // ── 이벤트 배선: 실시간 재계산(oninput) + Enter ──
  function onAmountInput(e) { reformatAmount(e.target); calculate(); }
  amountEl.addEventListener("input", onAmountInput);
  rateEl.addEventListener("input", calculate);
  yearsEl.addEventListener("input", calculate);
  curSel.addEventListener("change", calculate);
  var modeRadios = document.querySelectorAll('input[name="calcmode"]');
  for (var mr = 0; mr < modeRadios.length; mr++) {
    modeRadios[mr].addEventListener("change", function () { renderModeCopy(); calculate(); });
  }
  if (rateChipsWrap) {
    rateChipsWrap.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".chip") : null;
      if (!b) return;
      rateEl.value = b.getAttribute("data-rate");
      calculate();
    });
  }
  if (yearChipsWrap) {
    yearChipsWrap.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".chip") : null;
      if (!b) return;
      yearsEl.value = b.getAttribute("data-years");
      calculate();
    });
  }
  calcBtn.addEventListener("click", calculate);
  function onEnter(e) { if (e.key === "Enter") calculate(); }
  [amountEl, rateEl, yearsEl].forEach(function (el) { el.addEventListener("keydown", onEnter); });

  // ── 언어 전환: 통화기호·모드 문구·동적 문구를 새 로케일로 재렌더 ──
  document.addEventListener("i18n:change", function () {
    fillCurrencies(curSel.value);
    renderModeCopy();
    if (lastRun && !box.hidden) calculate();
  });
  // TOOLJS:END
})();
