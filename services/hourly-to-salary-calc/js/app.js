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
  /* Hourly to Salary Calculator — 시급 <-> 연봉 양방향 환산.
     입력: 시급 또는 연봉(모드로 전환) + 주당 근무시간(기본 40) + 연간 근무 주 수(기본 52).
     출력: 시급 · 주급 · 격주급 · 반월급 · 월급 · 연봉 6장. 통화는 표시용 선택(환율 변환 없음 — currency-agnostic).
     상태: localStorage "<slug>:state" 만. 외부 API 없음, 모든 계산은 로컬. */

  var cfg = window.APP_CONFIG || {};
  var SKEY = (cfg.slug || "hourly-to-salary-calc") + ":state";

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  var LIM = { wage: 1e7, annual: 1e9, hours: 168, weeks: 52 };

  // 금액 파싱: 콤마 제거, 음수는 절대값(붙여넣은 음수 대비), 숫자 아니면 null
  function parseAmount(raw) {
    if (raw == null) return null;
    var s = String(raw).replace(/,/g, "").trim();
    if (s === "") return null;
    var n = parseFloat(s);
    if (!isFinite(n)) return null;
    return Math.abs(n);
  }
  // 시간/주 파싱: 빈값·비정상값은 기본값으로, 범위를 벗어나면 캡(clamped=true)
  function parseBounded(raw, def, min, max) {
    var s = String(raw == null ? "" : raw).replace(/,/g, "").trim();
    if (s === "") return { value: def, clamped: false, empty: true };
    var n = parseFloat(s);
    if (!isFinite(n) || n <= 0) return { value: def, clamped: false, empty: true };
    if (n > max) return { value: max, clamped: true, empty: false };
    if (n < min) return { value: min, clamped: true, empty: false };
    return { value: n, clamped: false, empty: false };
  }
  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }
  function safeCap(n, cap) {
    if (!isFinite(n)) return cap;
    return n > cap ? cap : n;
  }
  // 핵심 계산: mode="hourly" 면 wage 기준으로 연봉 산출, "salary" 면 salary 기준으로 시급 산출.
  function computePay(mode, wage, salary, hoursPerWeek, weeksPerYear) {
    var hoursPerYear = hoursPerWeek * weeksPerYear;
    var hourly, annual;
    if (mode === "salary") {
      annual = safeCap(Math.max(0, salary || 0), LIM.annual);
      hourly = hoursPerYear > 0 ? annual / hoursPerYear : 0;
    } else {
      hourly = safeCap(Math.max(0, wage || 0), LIM.wage);
      annual = safeCap(hourly * hoursPerYear, LIM.annual);
    }
    var weekly = hourly * hoursPerWeek;
    var monthly = annual / 12;
    return {
      hourly: round2(hourly),
      weekly: round2(weekly),
      biweekly: round2(weekly * 2),
      semimonthly: round2(annual / 24),
      monthly: round2(monthly),
      annual: round2(annual),
      hoursPerYear: round2(hoursPerYear)
    };
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseAmount: parseAmount, parseBounded: parseBounded, round2: round2, computePay: computePay };
    return;
  }

  /* ---- i18n · Intl 헬퍼 ---- */
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function nf(opts) { try { return new Intl.NumberFormat(uiLang(), opts); } catch (e) { return new Intl.NumberFormat("en", opts); } }
  function fmt(n) { return nf({ maximumFractionDigits: 2 }).format(n); }
  function cyDec(cur) { try { return nf({ style: "currency", currency: cur }).resolvedOptions().maximumFractionDigits; } catch (e) { return 2; } }
  function money(n, cur) {
    var d = cyDec(cur);
    try { return nf({ style: "currency", currency: cur, minimumFractionDigits: d, maximumFractionDigits: d }).format(n); }
    catch (e) { return fmt(n); }
  }
  function curSymbol(cur) {
    try {
      var parts = nf({ style: "currency", currency: cur }).formatToParts(0);
      for (var i = 0; i < parts.length; i++) if (parts[i].type === "currency") return parts[i].value;
    } catch (e) { /* noop */ }
    return cur;
  }

  /* ---- 통화(표시용 — 환율 변환 없음, currency-agnostic) ---- */
  var CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CNY", "KRW", "INR", "BRL", "RUB",
    "IDR", "CAD", "AUD", "CHF", "HKD", "SGD", "TWD", "MXN", "ZAR", "TRY", "SEK"];
  var REGION_CCY = { US: "USD", GB: "GBP", JP: "JPY", CN: "CNY", HK: "HKD", TW: "TWD",
    KR: "KRW", IN: "INR", BR: "BRL", RU: "RUB", ID: "IDR", CA: "CAD", AU: "AUD",
    CH: "CHF", SG: "SGD", MX: "MXN", ZA: "ZAR", TR: "TRY", SE: "SEK",
    DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", PT: "EUR", IE: "EUR", AT: "EUR", FI: "EUR" };
  var LANG_CCY = { ko: "KRW", ja: "JPY", zh: "CNY", de: "EUR", fr: "EUR", es: "EUR",
    pt: "BRL", ru: "RUB", id: "IDR", hi: "INR", bn: "BDT", ar: "USD", ur: "PKR", en: "USD" };
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
  function fillCurrencies(sel, selected) {
    var list = CURRENCIES.slice();
    if (list.indexOf(selected) === -1) list.unshift(selected);
    sel.textContent = "";
    for (var i = 0; i < list.length; i++) {
      var opt = document.createElement("option");
      opt.value = list[i];
      opt.textContent = list[i] + " (" + curSymbol(list[i]) + ")";
      sel.appendChild(opt);
    }
    sel.value = selected;
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var modeHourlyBtn = $("mode-hourly"), modeSalaryBtn = $("mode-salary");
  var wageField = $("wage-field"), salaryField = $("salary-field");
  var wageEl = $("wage"), salaryEl = $("salary");
  var hoursEl = $("hours"), weeksEl = $("weeks");
  var currencySel = $("currency-select");
  var hoursNoteEl = $("hours-note");
  var emptyEl = $("result-empty"), gridEl = $("result-grid");
  var clampNoteEl = $("clamp-note"), copyHintEl = $("copy-hint");
  if (!wageEl || !salaryEl || !hoursEl || !weeksEl || !gridEl) return;
  var cards = gridEl.querySelectorAll(".res-card");

  var mode = "hourly";

  /* ---- 상태 저장/복원 ---- */
  function loadState() {
    try {
      var raw = localStorage.getItem(SKEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveState() {
    try {
      localStorage.setItem(SKEY, JSON.stringify({
        mode: mode,
        wage: wageEl.value,
        salary: salaryEl.value,
        hours: hoursEl.value,
        weeks: weeksEl.value,
        currency: currencySel ? currencySel.value : undefined
      }));
    } catch (e) { /* private mode — 저장만 실패, 계산은 정상 */ }
  }

  /* ---- 모드 토글 ---- */
  function applyMode() {
    var isHourly = mode === "hourly";
    if (wageField) wageField.hidden = !isHourly;
    if (salaryField) salaryField.hidden = isHourly;
    if (modeHourlyBtn) modeHourlyBtn.setAttribute("aria-pressed", isHourly ? "true" : "false");
    if (modeSalaryBtn) modeSalaryBtn.setAttribute("aria-pressed", isHourly ? "false" : "true");
  }
  function setMode(next) {
    mode = next === "salary" ? "salary" : "hourly";
    applyMode();
    saveState();
    render();
  }
  if (modeHourlyBtn) modeHourlyBtn.addEventListener("click", function () { setMode("hourly"); });
  if (modeSalaryBtn) modeSalaryBtn.addEventListener("click", function () { setMode("salary"); });

  /* ---- 카드 값 세팅 ---- */
  function setCard(key, value, cur) {
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getAttribute("data-copy") === key) {
        var valEl = cards[i].querySelector(".rc-value");
        if (valEl) valEl.textContent = money(value, cur);
        cards[i].setAttribute("data-value", String(value));
      }
    }
  }

  /* ---- 렌더 ---- */
  function render() {
    var wage = parseAmount(wageEl.value);
    var salary = parseAmount(salaryEl.value);
    var hoursR = parseBounded(hoursEl.value, 40, 0.1, LIM.hours);
    var weeksR = parseBounded(weeksEl.value, 52, 0.1, LIM.weeks);
    var cur = currencySel ? (currencySel.value || "USD") : "USD";

    // 활성 모드의 기준 입력이 비어 있으면(또는 0) 안내만 표시 — 오류가 아니라 대기 상태
    var baseEmpty = mode === "hourly" ? !(wage > 0) : !(salary > 0);
    if (baseEmpty) {
      gridEl.hidden = true;
      copyHintEl.hidden = true;
      if (hoursNoteEl) hoursNoteEl.hidden = true;
      if (clampNoteEl) clampNoteEl.hidden = true;
      emptyEl.hidden = false;
      return;
    }

    var r = computePay(mode, wage, salary, hoursR.value, weeksR.value);
    setCard("hourly", r.hourly, cur);
    setCard("weekly", r.weekly, cur);
    setCard("biweekly", r.biweekly, cur);
    setCard("semimonthly", r.semimonthly, cur);
    setCard("monthly", r.monthly, cur);
    setCard("annual", r.annual, cur);

    emptyEl.hidden = true;
    gridEl.hidden = false;
    copyHintEl.hidden = false;

    if (hoursNoteEl) {
      hoursNoteEl.textContent = tr("tool.hoursYear", "That's {x} hours worked per year").replace("{x}", fmt(r.hoursPerYear));
      hoursNoteEl.hidden = false;
    }

    // 캡(clamp) 안내 — 시간·주 값이 현실적 상한을 넘어 잘렸을 때만 표시
    if (clampNoteEl) {
      var notes = [];
      if (hoursR.clamped) notes.push(tr("tool.clamp.hours", "Hours per week capped to {x}").replace("{x}", fmt(hoursR.value)));
      if (weeksR.clamped) notes.push(tr("tool.clamp.weeks", "Weeks per year capped to {x}").replace("{x}", fmt(weeksR.value)));
      if (notes.length) {
        clampNoteEl.textContent = notes.join(" · ");
        clampNoteEl.hidden = false;
      } else {
        clampNoteEl.hidden = true;
      }
    }
  }

  /* ---- 클릭 복사 ---- */
  var copiedTimers = {};
  function flashCopied(card) {
    var labelEl = card.querySelector(".rc-label");
    if (!labelEl) return;
    var key = card.getAttribute("data-copy");
    labelEl.textContent = tr("tool.copied", "Copied");
    if (copiedTimers[key]) clearTimeout(copiedTimers[key]);
    copiedTimers[key] = setTimeout(function () {
      labelEl.textContent = tr("tool.res." + key, labelEl.textContent);
    }, 1100);
  }
  function legacyCopy(text, done) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch (e) { /* 복사 미지원 — 표시값은 그대로 남는다 */ }
  }
  function copyCard(card) {
    var raw = card.getAttribute("data-value");
    if (raw == null) return;
    var done = function () { flashCopied(card); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(raw).then(done, function () { legacyCopy(raw, done); });
      } else {
        legacyCopy(raw, done);
      }
    } catch (e) {
      legacyCopy(raw, done);
    }
  }
  for (var i = 0; i < cards.length; i++) {
    cards[i].addEventListener("click", function () { copyCard(this); });
  }

  /* ---- 이벤트 ---- */
  wageEl.addEventListener("input", function () { saveState(); render(); });
  salaryEl.addEventListener("input", function () { saveState(); render(); });
  hoursEl.addEventListener("input", function () { saveState(); render(); });
  weeksEl.addEventListener("input", function () { saveState(); render(); });
  if (currencySel) currencySel.addEventListener("change", function () { saveState(); render(); });
  document.addEventListener("i18n:change", render);

  /* ---- 초기화: 저장 상태 복원 → 통화 채우기 → 렌더 ---- */
  var initial = loadState();
  if (initial && (initial.mode === "hourly" || initial.mode === "salary")) mode = initial.mode;
  applyMode();
  if (initial) {
    if (initial.wage != null) wageEl.value = initial.wage;
    if (initial.salary != null) salaryEl.value = initial.salary;
    if (initial.hours != null && initial.hours !== "") hoursEl.value = initial.hours;
    if (initial.weeks != null && initial.weeks !== "") weeksEl.value = initial.weeks;
  }
  if (currencySel) {
    var savedCur = (initial && initial.currency) || detectCurrency();
    fillCurrencies(currencySel, savedCur);
  }
  render();
  // TOOLJS:END
})();
