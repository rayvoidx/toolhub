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
  /* APY Calculator — APR<->APY 상호 변환(복리 주기 반영), 동일 APR의 복리 주기별 비교표,
     예금액 입력 시 1년 후 잔액 성장 예시. 상태: localStorage "<slug>:last" 만. 외부 API 없음. */
  var cfg = window.APP_CONFIG || {};
  var LS_KEY = (cfg.slug || "apy-calc") + ":last";
  var SAFE = Number.MAX_SAFE_INTEGER;
  var LIM = { deposit: 1e15, rateFrac: 10 }; // rateFrac 10 = 1000% 상한 (연속복리 e^x 오버플로 방지)

  var CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CNY", "KRW", "INR", "BRL", "RUB",
    "IDR", "CAD", "AUD", "CHF", "HKD", "SGD", "TWD", "MXN", "ZAR", "TRY", "SEK"];
  var REGION_CCY = { US: "USD", GB: "GBP", JP: "JPY", CN: "CNY", HK: "HKD", TW: "TWD",
    KR: "KRW", IN: "INR", BR: "BRL", RU: "RUB", ID: "IDR", CA: "CAD", AU: "AUD",
    CH: "CHF", SG: "SGD", MX: "MXN", ZA: "ZAR", TR: "TRY", SE: "SEK",
    DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", PT: "EUR", IE: "EUR", AT: "EUR", FI: "EUR" };
  var LANG_CCY = { ko: "KRW", ja: "JPY", zh: "CNY", de: "EUR", fr: "EUR", es: "EUR",
    pt: "BRL", ru: "RUB", id: "IDR", hi: "INR", bn: "BDT", ar: "USD", ur: "PKR", en: "USD" };

  // 복리 주기 목록 — 비교표·셀렉트 옵션 공용 (n=Infinity 는 연속복리)
  var FREQS = [
    { key: "annually", n: 1 },
    { key: "semiannually", n: 2 },
    { key: "quarterly", n: 4 },
    { key: "monthly", n: 12 },
    { key: "biweekly", n: 26 },
    { key: "weekly", n: 52 },
    { key: "daily", n: 365 },
    { key: "continuous", n: Infinity }
  ];

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

  // ── 예금액 입력: 콤마 그룹핑 자동 포맷 · 파싱(소수점=".", 음수 기호는 제거) ──
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
  // 이자율 입력(퍼센트, 소수 허용) 파싱 — type=number 라 valueAsNumber 우선, 콤마 소수점 폴백
  function num(el) {
    if (!el) return null;
    var v = el.valueAsNumber;
    if (isNaN(v)) { var s = String(el.value).trim().replace(",", "."); v = (s === "") ? NaN : Number(s); }
    return isNaN(v) ? null : v;
  }

  // ── Intl 포매팅 (통화·퍼센트 전부 Intl 위임 — 하드코딩 없음) ──
  function nf(opts) { try { return new Intl.NumberFormat(fmtLocale(), opts); } catch (e) { return new Intl.NumberFormat("en", opts); } }
  function cyDec(cur) { try { return nf({ style: "currency", currency: cur }).resolvedOptions().maximumFractionDigits; } catch (e) { return 2; } }
  function money(v, cur) {
    var d = cyDec(cur);
    try { return nf({ style: "currency", currency: cur, minimumFractionDigits: d, maximumFractionDigits: d }).format(safe(v)); }
    catch (e) { return String(safe(v)); }
  }
  function pctFmt(frac) {
    var x = safe(frac * 100);
    return nf({ minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(x) + "%";
  }
  function numFmt(v, maxdec) { return nf({ maximumFractionDigits: maxdec == null ? 3 : maxdec }).format(safe(v)); }

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상, Math 외 DOM 의존 없음)
  // APY = (1+APR/n)^n − 1  ·  연속복리는 n→∞ 의 극한인 e^APR − 1
  function aprToApy(aprFrac, n) {
    if (!isFinite(n)) return Math.exp(aprFrac) - 1;
    return Math.pow(1 + aprFrac / n, n) - 1;
  }
  // APR = n·((1+APY)^(1/n) − 1)  ·  연속복리는 ln(1+APY)
  function apyToApr(apyFrac, n) {
    if (!isFinite(n)) return Math.log(1 + apyFrac);
    return n * (Math.pow(1 + apyFrac, 1 / n) - 1);
  }
  // 입력 이자율(소수) 상한 캡 — 비정상적으로 큰 값이 연속복리 e^x 를 Infinity 로 보내는 것 방지
  function clampRate(frac) {
    if (frac > LIM.rateFrac) return { v: LIM.rateFrac, clipped: true };
    return { v: frac, clipped: false };
  }
  // calc-core:end

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { aprToApy: aprToApy, apyToApr: apyToApr, clampRate: clampRate, FREQS: FREQS };
    return;
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var rateEl = $("rate-input"), rateLabelEl = $("rate-label"), freqEl = $("freq-select");
  var depositEl = $("deposit-input"), curSel = $("currency-select"), calcBtn = $("calc-btn");
  var box = $("result-box"), errEl = $("result-error"), bodyEl = $("result-body");
  var primaryLabelEl = $("primary-label"), primaryValEl = $("r-primary"), subEl = $("r-sub");
  var growthWrap = $("growth-wrap"), growthEl = $("r-growth");
  var cmpBody = $("cmp-body"), clippedEl = $("r-clipped");
  if (!rateEl || !freqEl || !curSel || !calcBtn || !box) return;

  // ── 통화 셀렉터 (브라우저 로케일 → 지역/언어 매핑, 사용자가 바꾸면 저장) ──
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

  function freqN(val) { return val === "continuous" ? Infinity : Number(val); }
  function freqLabel(key) { return t("tool.freq." + key, key); }

  function showNotice(key, fallback) {
    box.hidden = false; bodyEl.hidden = true; errEl.hidden = false;
    errEl.textContent = t(key, fallback);
  }

  // 동일 APR 을 6개 복리 주기에 적용한 APY 비교표 (선택된 주기 행을 강조)
  function renderComparison(aprFrac, selectedN) {
    cmpBody.innerHTML = "";
    for (var i = 0; i < FREQS.length; i++) {
      var f = FREQS[i];
      var apy = aprToApy(aprFrac, f.n);
      var tr = document.createElement("tr");
      if (f.n === selectedN) tr.className = "is-active";
      var td1 = document.createElement("td"); td1.textContent = freqLabel(f.key);
      var td2 = document.createElement("td"); td2.textContent = isFinite(f.n) ? numFmt(f.n, 0) : "∞";
      var td3 = document.createElement("td"); td3.textContent = pctFmt(apy);
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
      cmpBody.appendChild(tr);
    }
  }

  function calculate() {
    var mode = radioVal("convmode") || "aprToApy";
    var rate = num(rateEl);
    var n = freqN(freqEl.value);
    var cur = curSel.value || "USD";
    persist(mode, cur);

    // 엣지케이스(철칙 5 — 전부 명시 처리): 빈 값·음수는 별도 오류 문구
    if (rate == null) return showNotice("tool.err.empty", "Enter an interest rate.");
    if (rate < 0) return showNotice("tool.err.negative", "The rate can't be negative.");

    var rateFrac = rate / 100;
    var cr = clampRate(rateFrac);
    var clipped = cr.clipped;
    rateFrac = cr.v;

    var aprFrac, apyFrac;
    if (mode === "apyToApr") {
      apyFrac = rateFrac;
      aprFrac = apyToApr(apyFrac, n);
    } else {
      aprFrac = rateFrac;
      apyFrac = aprToApy(aprFrac, n);
    }

    errEl.hidden = true; bodyEl.hidden = false; box.hidden = false;

    var isCont = freqEl.value === "continuous";
    var rateNum = numFmt(rate, 3);
    if (mode === "apyToApr") {
      primaryLabelEl.textContent = t("tool.result.apr", "APR (nominal annual rate)");
      primaryValEl.textContent = pctFmt(aprFrac);
      subEl.textContent = (isCont
        ? t("tool.result.subApyToAprCont", "A {apy}% APY compounded continuously equals an APR (nominal rate) of {apr}.")
        : t("tool.result.subApyToApr", "A {apy}% APY compounded {n}× a year equals an APR (nominal rate) of {apr}."))
        .replace("{apy}", rateNum).replace("{n}", freqEl.value).replace("{apr}", pctFmt(aprFrac));
    } else {
      primaryLabelEl.textContent = t("tool.result.apy", "APY (effective annual yield)");
      primaryValEl.textContent = pctFmt(apyFrac);
      subEl.textContent = (isCont
        ? t("tool.result.subAprToApyCont", "A {apr}% APR compounded continuously equals an APY of {apy}.")
        : t("tool.result.subAprToApy", "A {apr}% APR compounded {n}× a year equals an APY of {apy}."))
        .replace("{apr}", rateNum).replace("{n}", freqEl.value).replace("{apy}", pctFmt(apyFrac));
    }

    // 예금 성장 예시(선택 입력) — 방향과 무관하게 항상 유효연수익률(APY) 기준 1년 성장
    var depositRaw = depositEl.value;
    if (depositRaw.trim() === "") {
      growthWrap.hidden = true;
    } else {
      var deposit = parseAmount(depositEl);
      if (deposit == null || deposit <= 0) {
        growthWrap.hidden = false;
        growthEl.className = "subtle warn";
        growthEl.textContent = t("tool.err.depositPositive", "Enter a deposit amount greater than 0 to see the growth example.");
      } else {
        if (deposit > LIM.deposit) { deposit = LIM.deposit; clipped = true; }
        var end = deposit * (1 + apyFrac);
        var gain = end - deposit;
        growthWrap.hidden = false;
        growthEl.className = "subtle";
        growthEl.textContent = t("tool.growth.text", "A deposit of {deposit} at {apy} APY grows to {end} after one year — {gain} in interest earned.")
          .replace("{deposit}", money(deposit, cur))
          .replace("{apy}", pctFmt(apyFrac))
          .replace("{end}", money(end, cur))
          .replace("{gain}", money(gain, cur));
      }
    }

    renderComparison(aprFrac, n);
    clippedEl.hidden = !clipped;
  }

  function persist(mode, cur) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        mode: mode, rate: rateEl.value, freq: freqEl.value, deposit: depositEl.value, currency: cur
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }
  }

  function syncRateLabel() {
    var mode = radioVal("convmode") || "aprToApy";
    rateLabelEl.textContent = mode === "apyToApr"
      ? t("tool.rate.apyLabel", "Annual percentage yield (APY)")
      : t("tool.rate.aprLabel", "Annual interest rate (APR)");
  }

  // ── 초기화 · 복원 (상태는 프로세스 밖 — 철칙 1) ──
  (function init() {
    var saved = null;
    try { var s = localStorage.getItem(LS_KEY); if (s) saved = JSON.parse(s); } catch (e) { saved = null; }
    var startCur = (saved && saved.currency) || detectCurrency();
    fillCurrencies(startCur);
    if (saved) {
      if (saved.mode === "aprToApy" || saved.mode === "apyToApr") {
        var r = document.querySelector('input[name="convmode"][value="' + saved.mode + '"]');
        if (r) r.checked = true;
      }
      if (saved.rate) rateEl.value = saved.rate;
      if (saved.freq) freqEl.value = saved.freq;
      if (saved.deposit) depositEl.value = saved.deposit;
    }
    syncRateLabel();
    if (num(rateEl) != null) calculate();
  })();

  // ── 이벤트 배선: 실시간 재계산(oninput) + Enter ──
  rateEl.addEventListener("input", calculate);
  freqEl.addEventListener("change", calculate);
  function onDepositInput(e) { reformatAmount(e.target); calculate(); }
  depositEl.addEventListener("input", onDepositInput);
  curSel.addEventListener("change", calculate);
  var modeRadios = document.querySelectorAll('input[name="convmode"]');
  for (var mr = 0; mr < modeRadios.length; mr++) {
    modeRadios[mr].addEventListener("change", function () { syncRateLabel(); calculate(); });
  }
  calcBtn.addEventListener("click", calculate);
  function onEnter(e) { if (e.key === "Enter") calculate(); }
  [rateEl, depositEl].forEach(function (el) { el.addEventListener("keydown", onEnter); });

  // ── 언어 전환: 통화기호·라벨·동적 문구를 새 로케일로 재렌더 ──
  document.addEventListener("i18n:change", function () {
    fillCurrencies(curSel.value);
    syncRateLabel();
    if (!box.hidden) calculate();
  });
  // TOOLJS:END
})();
