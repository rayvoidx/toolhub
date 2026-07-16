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
  var SLUG_KEY = (cfg.slug || "tax-calc") + ":last";
  var MAX_AMOUNT = 9000000000000; // 9조 (통화 무관 상한 — 기존 동작 유지)

  /* ------------------------------------------------------------------
     국가별 VAT/GST 표준 세율 — 정적 표 (기준: 2026-07, 연 1회 갱신 수렴).
     실시간 API 를 쓰지 않는다 (pure-static 원칙 · docs/OPTIMIZATION.md 축4
     "요율/공휴일 등 연 1회 갱신으로 수렴하는 정적 데이터만 국가 분기").
       rate: 표준세율(%) — null 이면 전국 단일 부가세가 없는 나라(미국·브라질)
       cur : ISO 4217 통화코드 (소수 자릿수는 Intl 이 판단 — 하드코딩 안 함)
       note: 오해를 부를 수 있는 나라에만 다는 안내 키 (locales.js)
     국가명은 여기에 두지 않는다 — Intl.DisplayNames 로 현재 언어에 맞춰 렌더.
     ------------------------------------------------------------------ */
  var VAT_TABLE = {
    KR: { rate: 10,  cur: "KRW" },
    JP: { rate: 10,  cur: "JPY" },
    CN: { rate: 13,  cur: "CNY" },
    IN: { rate: 18,  cur: "INR", note: "tool.note.IN" },
    ID: { rate: 11,  cur: "IDR" },
    BD: { rate: 15,  cur: "BDT" },
    PK: { rate: 18,  cur: "PKR" },
    SA: { rate: 15,  cur: "SAR" },
    AE: { rate: 5,   cur: "AED" },
    EG: { rate: 14,  cur: "EGP" },
    GB: { rate: 20,  cur: "GBP" },
    US: { rate: null, cur: "USD", note: "tool.note.US" },
    CA: { rate: 5,   cur: "CAD", note: "tool.note.CA" },
    AU: { rate: 10,  cur: "AUD" },
    DE: { rate: 19,  cur: "EUR" },
    AT: { rate: 20,  cur: "EUR" },
    CH: { rate: 8.1, cur: "CHF" },
    FR: { rate: 20,  cur: "EUR" },
    ES: { rate: 21,  cur: "EUR" },
    IT: { rate: 22,  cur: "EUR" },
    NL: { rate: 21,  cur: "EUR" },
    PT: { rate: 23,  cur: "EUR" },
    MX: { rate: 16,  cur: "MXN" },
    AR: { rate: 21,  cur: "ARS" },
    BR: { rate: null, cur: "BRL", note: "tool.note.BR" },
    RU: { rate: 20,  cur: "RUB" }
  };
  var RATES_ASOF = "2026-07";

  // Intl.DisplayNames 미지원 브라우저 폴백용 영문명
  var EN_NAME = {
    KR: "South Korea", JP: "Japan", CN: "China", IN: "India", ID: "Indonesia",
    BD: "Bangladesh", PK: "Pakistan", SA: "Saudi Arabia", AE: "United Arab Emirates",
    EG: "Egypt", GB: "United Kingdom", US: "United States", CA: "Canada",
    AU: "Australia", DE: "Germany", AT: "Austria", CH: "Switzerland", FR: "France",
    ES: "Spain", IT: "Italy", NL: "Netherlands", PT: "Portugal", MX: "Mexico",
    AR: "Argentina", BR: "Brazil", RU: "Russia"
  };

  // 언어만 알고 지역을 모를 때의 기본 국가 (locales 14개 언어 전부 대응)
  var LANG_COUNTRY = {
    en: "GB", zh: "CN", hi: "IN", es: "ES", ar: "SA", fr: "FR", bn: "BD",
    pt: "PT", ru: "RU", ur: "PK", id: "ID", de: "DE", ja: "JP", ko: "KR"
  };

  var countrySelect = document.getElementById("country-select");
  var amountInput = document.getElementById("amount-input");
  var amountLabel = document.getElementById("amount-label");
  var rateInput   = document.getElementById("rate-input");
  var rateHint    = document.getElementById("rate-hint");
  var ratesAsOf   = document.getElementById("rates-asof");
  var calcBtn     = document.getElementById("calc-btn");
  var resetBtn    = document.getElementById("reset-btn");
  var resultBox   = document.getElementById("result-box");
  var resultError = document.getElementById("result-error");
  var resultNotice = document.getElementById("result-notice");
  var resultRows  = document.getElementById("result-rows");
  var rSupply     = document.getElementById("r-supply");
  var rVat        = document.getElementById("r-vat");
  var rTotal      = document.getElementById("r-total");
  var rSupplyLabel = document.getElementById("r-supply-label");
  var rVatLabel   = document.getElementById("r-vat-label");
  var rTotalLabel = document.getElementById("r-total-label");
  var appliedNote = document.getElementById("applied-note");
  var countryNote = document.getElementById("country-note");
  var roundNote   = document.getElementById("round-note");
  var dirForward  = document.getElementById("dir-forward");
  var dirReverse  = document.getElementById("dir-reverse");

  /* ---- i18n 헬퍼 ---- */
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function lang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) || "ko";
  }
  function fill(str, vars) {
    Object.keys(vars).forEach(function (k) {
      str = str.split("{" + k + "}").join(vars[k]);
    });
    return str;
  }

  /* ---- 현지화 포맷 (Intl — 통화·국가명·퍼센트 하드코딩 금지) ---- */
  var dnCache = {};
  function countryName(code) {
    var l = lang();
    if (!(l in dnCache)) {
      try {
        dnCache[l] = (typeof Intl !== "undefined" && Intl.DisplayNames)
          ? new Intl.DisplayNames([l, "en"], { type: "region" }) : null;
      } catch (e) { dnCache[l] = null; }
    }
    if (dnCache[l]) {
      try {
        var n = dnCache[l].of(code);
        if (n && n !== code) return n;
      } catch (e) { /* 미지원 코드 — 폴백 */ }
    }
    return EN_NAME[code] || code;
  }
  function decimalsOf(cur) {
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency: cur })
        .resolvedOptions().maximumFractionDigits;
    } catch (e) { return 2; }
  }
  function fmtMoney(n, cur) {
    try {
      return new Intl.NumberFormat(lang(), { style: "currency", currency: cur }).format(n);
    } catch (e) {
      return fmtPlain(n, decimalsOf(cur)) + " " + cur;
    }
  }
  // 입력창 표기용 — 언어와 무관하게 콤마 3자리 + 마침표 소수점 (파싱 모호성 제거)
  function fmtPlain(n, d) {
    try {
      return Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });
    } catch (e) { return String(n); }
  }
  function fmtRate(rate) {
    try {
      // 3자리까지 — 직접 입력한 세율(예: 미국 지방세 8.875%)이 표기에서 뭉개지지 않게
      return new Intl.NumberFormat(lang(), { style: "percent", maximumFractionDigits: 3 }).format(rate / 100);
    } catch (e) { return rate + "%"; }
  }
  function symbolOf(cur) {
    var opts = [{ currencyDisplay: "narrowSymbol" }, {}];
    for (var i = 0; i < opts.length; i++) {
      try {
        var o = { style: "currency", currency: cur };
        if (opts[i].currencyDisplay) o.currencyDisplay = opts[i].currencyDisplay;
        var parts = new Intl.NumberFormat(lang(), o).formatToParts(1);
        for (var j = 0; j < parts.length; j++) {
          if (parts[j].type === "currency") return parts[j].value;
        }
      } catch (e) { /* 다음 후보로 */ }
    }
    return cur;
  }

  /* ---- 반올림 (통화 최소단위 기준) ---- */
  function roundTo(v, d) {
    // toFixed 는 0.5 를 올림(spec: 두 후보 중 큰 값) — 기존 Math.round 동작과 동일
    return Number(Number(v).toFixed(d));
  }
  function needsRounding(v, d) {
    var s = Number(v).toFixed(d + 4);
    var frac = s.slice(s.indexOf(".") + 1);
    return /[1-9]/.test(frac.slice(d));
  }

  /* ---- 국가 판정: URL → localStorage → 브라우저 지역 → 언어 기본 → KR ---- */
  function detectCountry() {
    var langs = navigator.languages || [navigator.language || ""];
    var i, m;
    for (i = 0; i < langs.length; i++) {
      m = String(langs[i]).match(/[-_]([A-Za-z]{2})\b/);
      if (m && VAT_TABLE[m[1].toUpperCase()]) return m[1].toUpperCase();
    }
    var byLang = LANG_COUNTRY[lang()];
    if (byLang && VAT_TABLE[byLang]) return byLang;
    for (i = 0; i < langs.length; i++) {
      var primary = String(langs[i]).toLowerCase().split(/[-_]/)[0];
      if (LANG_COUNTRY[primary]) return LANG_COUNTRY[primary];
    }
    return "KR"; // 최종 폴백 — 런칭 시점(한국 전용) 동작 보존
  }

  function currentMeta() {
    return VAT_TABLE[countrySelect.value] || VAT_TABLE.KR;
  }
  // 상세 조정의 직접 입력 세율: { has, bad, value }
  function readCustomRate() {
    var v = String(rateInput.value || "").trim().replace(",", ".");
    if (v === "") return { has: false };
    var n = Number(v);
    if (!isFinite(n) || n < 0 || n > 100) return { has: true, bad: true };
    return { has: true, value: n };
  }

  /* ---- 렌더 ---- */
  function buildCountryOptions() {
    var keep = countrySelect.value;
    var codes = Object.keys(VAT_TABLE);
    var collator;
    try { collator = new Intl.Collator(lang()); } catch (e) { collator = null; }
    codes.sort(function (a, b) {
      var na = countryName(a), nb = countryName(b);
      return collator ? collator.compare(na, nb) : (na < nb ? -1 : na > nb ? 1 : 0);
    });
    countrySelect.textContent = "";
    codes.forEach(function (code) {
      var meta = VAT_TABLE[code];
      var opt = document.createElement("option");
      opt.value = code;
      // 세율을 선택지에 함께 노출 — 고르기 전에 값이 보인다
      opt.textContent = countryName(code) + " · " +
        (meta.rate == null ? tr("tool.opt.norate") : fmtRate(meta.rate));
      countrySelect.appendChild(opt);
    });
    if (keep && VAT_TABLE[keep]) countrySelect.value = keep;
  }

  function updateLabels() {
    var meta = currentMeta();
    var d = decimalsOf(meta.cur);
    var isForward = dirForward.checked;
    var name = countryName(countrySelect.value);

    amountLabel.textContent = tr(isForward ? "tool.amount.forward" : "tool.amount.reverse") +
      " (" + symbolOf(meta.cur) + ")";

    // 예시 금액도 통화·방향·세율에 맞춰 생성 (KRW 이면 1,000,000 — 기존 표기 유지)
    var base = (d === 0) ? 1000000 : 1000;
    if (!isForward && meta.rate != null) base = base * (1 + meta.rate / 100);
    amountInput.placeholder = fill(tr("tool.amount.ph"), { n: fmtPlain(roundTo(base, d), d) });

    if (meta.rate == null) {
      rateHint.textContent = fill(tr("tool.rate.hint.norate"), { country: name });
      rateInput.placeholder = fill(tr("tool.rate.ph"), { rate: "18" });
    } else {
      rateHint.textContent = fill(tr("tool.rate.hint"), { country: name, rate: fmtRate(meta.rate) });
      rateInput.placeholder = fill(tr("tool.rate.ph"), { rate: fmtPlain(meta.rate, 2) });
    }
    ratesAsOf.textContent = fill(tr("tool.rates.asof"), { date: RATES_ASOF });

    rSupplyLabel.textContent = tr("tool.row.supply");
    rTotalLabel.textContent = tr("tool.row.total");
  }

  function hideResult() {
    resultBox.hidden = true;
    resultError.hidden = true;
    resultNotice.hidden = true;
    resultRows.hidden = true;
  }
  function showError(msg) {
    resultBox.hidden = false;
    resultError.hidden = false;
    resultError.textContent = msg;
    resultNotice.hidden = true;
    resultRows.hidden = true;
  }
  // 오류가 아니라 "다음 행동 안내" (미국·브라질처럼 단일 세율이 없는 나라)
  function showNotice(msg) {
    resultBox.hidden = false;
    resultError.hidden = true;
    resultNotice.hidden = false;
    resultNotice.textContent = msg;
    resultRows.hidden = true;
  }

  function calculate(fromUser) {
    var meta = currentMeta();
    var cur = meta.cur;
    var d = decimalsOf(cur);
    var name = countryName(countrySelect.value);

    var custom = readCustomRate();
    if (custom.has && custom.bad) { showError(tr("tool.err.rate")); return; }
    var rate = custom.has ? custom.value : meta.rate;

    // 세율을 알 수 없는 나라 — 조용히 실패하지 않고 다음 행동을 안내
    if (rate == null) {
      showNotice(fill(tr("tool.notice.norate"), { country: name }) +
        (meta.note ? " " + tr(meta.note) : ""));
      return;
    }

    var raw = String(amountInput.value).replace(/,/g, "");
    // 빈 입력: 버튼·Enter 로 요청했을 때만 안내, 타이핑 중에는 결과만 숨김
    if (!raw) {
      if (fromUser) showError(tr("tool.err.empty"));
      else hideResult();
      return;
    }
    var val = parseFloat(raw);
    if (!isFinite(val) || val === 0) { showError(tr("tool.err.empty")); return; }
    if (val < 0) { showError(tr("tool.err.negative")); return; }
    if (val > MAX_AMOUNT) {
      showError(fill(tr("tool.err.max"), { max: fmtMoney(MAX_AMOUNT, cur) }));
      return;
    }

    var supply, vat, total, hasRound, rawSupply, rawVat;
    var r = rate / 100;

    if (dirForward.checked) {
      // 공급가 → 부가세, 공급대가
      supply = roundTo(val, d);
      rawVat = supply * r;
      vat = roundTo(rawVat, d);
      total = roundTo(supply + vat, d);
      hasRound = needsRounding(rawVat, d);
    } else {
      // 공급대가 → 공급가, 부가세
      total = roundTo(val, d);
      rawSupply = total / (1 + r);
      supply = roundTo(rawSupply, d);
      vat = roundTo(total - supply, d); // 합이 정확히 맞도록 차액으로 계산
      hasRound = needsRounding(rawSupply, d);
    }

    resultBox.hidden = false;
    resultError.hidden = true;
    resultNotice.hidden = true;
    resultRows.hidden = false;

    rSupply.textContent = fmtMoney(supply, cur);
    rVat.textContent = fmtMoney(vat, cur);
    rTotal.textContent = fmtMoney(total, cur);
    // 복사는 서식 없는 숫자로 (송장·회계 프로그램에 그대로 붙여넣기)
    rSupply.setAttribute("data-value", String(supply));
    rVat.setAttribute("data-value", String(vat));
    rTotal.setAttribute("data-value", String(total));

    rVatLabel.textContent = tr("tool.row.vat") + " (" + fmtRate(rate) + ")";
    appliedNote.textContent = custom.has
      ? fill(tr("tool.applied.custom"), { rate: fmtRate(rate) })
      : fill(tr("tool.applied"), { country: name, rate: fmtRate(rate) });

    if (meta.note) {
      countryNote.hidden = false;
      countryNote.textContent = tr(meta.note);
    } else {
      countryNote.hidden = true;
    }
    roundNote.textContent = tr("tool.round");
    roundNote.hidden = !hasRound;

    persist(raw, custom);
  }

  /* ---- 상태 저장: localStorage("tax-calc:last") + URL 파라미터 ---- */
  function persist(raw, custom) {
    try {
      localStorage.setItem(SLUG_KEY, JSON.stringify({
        dir: dirForward.checked ? "forward" : "reverse",
        raw: raw,
        country: countrySelect.value,
        rate: (custom && custom.has && !custom.bad) ? custom.value : null
      }));
    } catch (e) { /* private mode — 조용히 무시 */ }
    syncUrl(raw, custom);
  }

  var urlTimer = null;
  function syncUrl(raw, custom) {
    if (urlTimer) clearTimeout(urlTimer);
    urlTimer = setTimeout(function () {
      try {
        var cur = new URLSearchParams(location.search);
        var p = new URLSearchParams();
        if (cur.get("lang")) p.set("lang", cur.get("lang")); // i18n 엔진 파라미터 보존
        p.set("country", countrySelect.value);
        p.set("dir", dirForward.checked ? "forward" : "reverse");
        if (raw) p.set("amount", raw);
        if (custom && custom.has && !custom.bad) p.set("rate", String(custom.value));
        history.replaceState(null, "", location.pathname + "?" + p.toString());
      } catch (e) { /* 구형 브라우저·rate limit — 공유 링크는 부가 기능이라 무시 */ }
    }, 400);
  }

  /* ---- 입력 포맷 (콤마 자동 삽입, 통화 소수 자릿수 허용) ---- */
  function formatInput(str, d) {
    var s = String(str).replace(/,/g, "");
    if (d > 0) {
      s = s.replace(/[^0-9.]/g, "");
      var first = s.indexOf(".");
      if (first !== -1) {
        s = s.slice(0, first + 1) + s.slice(first + 1).replace(/\./g, "");
      }
      var parts = s.split(".");
      var ip = parts[0];
      var head = ip ? Number(ip).toLocaleString("en-US") : (parts.length > 1 ? "0" : "");
      if (parts.length > 1) return head + "." + parts[1].slice(0, d);
      return head;
    }
    var digits = s.replace(/[^0-9]/g, "");
    if (!digits) return "";
    return Number(digits).toLocaleString("en-US");
  }

  /* ---- 이벤트 ---- */
  amountInput.addEventListener("input", function () {
    // 음수 부호 감지: formatInput() 이 부호를 제거하기 전에 원본 값을 검사
    if (amountInput.value.indexOf("-") !== -1) {
      amountInput.value = "";
      showError(tr("tool.err.negative"));
      return;
    }
    var d = decimalsOf(currentMeta().cur);
    var cursor = amountInput.selectionStart;
    var oldLen = amountInput.value.length;
    amountInput.value = formatInput(amountInput.value, d);
    var newLen = amountInput.value.length;
    try {
      amountInput.selectionStart = amountInput.selectionEnd = Math.max(0, cursor + (newLen - oldLen));
    } catch (e) { /* 일부 모바일 IME */ }
    calculate(false); // 즉시 계산
  });

  amountInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); calculate(true); }
  });

  countrySelect.addEventListener("change", function () {
    // 통화 소수 자릿수가 바뀌면 입력값도 그 통화에 맞게 다시 포맷
    var d = decimalsOf(currentMeta().cur);
    amountInput.value = formatInput(amountInput.value, d);
    updateLabels();
    calculate(false);
  });

  function onDirChange() { updateLabels(); calculate(false); }
  dirForward.addEventListener("change", onDirChange);
  dirReverse.addEventListener("change", onDirChange);
  rateInput.addEventListener("input", function () { calculate(false); });

  calcBtn.addEventListener("click", function () { calculate(true); });
  resetBtn.addEventListener("click", function () {
    amountInput.value = "";
    rateInput.value = "";
    hideResult();
    updateLabels();
    amountInput.focus();
    try { localStorage.removeItem(SLUG_KEY); } catch (e) { /* noop */ }
    try { history.replaceState(null, "", location.pathname); } catch (e) { /* noop */ }
  });

  // 복사 버튼
  document.querySelectorAll(".copy-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var el = document.getElementById(btn.getAttribute("data-target"));
      if (!el) return;
      var text = el.getAttribute("data-value") || el.textContent;
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = "✓";
        setTimeout(function () { btn.textContent = tr("tool.copy"); }, 1200);
      }).catch(function () {
        btn.textContent = tr("tool.copyfail");
        setTimeout(function () { btn.textContent = tr("tool.copy"); }, 1200);
      });
    });
  });

  // 언어 전환 시 국가명·통화·세율 표기 다시 렌더
  document.addEventListener("i18n:change", function () {
    buildCountryOptions();
    updateLabels();
    if (!resultBox.hidden) calculate(false);
  });

  /* ---- 초기화: URL → localStorage → 브라우저 추정 ---- */
  (function init() {
    var params, saved = null;
    try { params = new URLSearchParams(location.search); } catch (e) { params = null; }
    try {
      var s = localStorage.getItem(SLUG_KEY);
      if (s) saved = JSON.parse(s); // 구버전 {dir,raw} 도 그대로 읽힌다
    } catch (e) { saved = null; }

    var qCountry = params ? String(params.get("country") || "").toUpperCase() : "";
    var country = VAT_TABLE[qCountry] ? qCountry
      : (saved && VAT_TABLE[saved.country]) ? saved.country
      : detectCountry();

    buildCountryOptions();
    countrySelect.value = country;

    var dir = (params && params.get("dir")) || (saved && saved.dir) || "forward";
    if (dir === "reverse") { dirReverse.checked = true; dirForward.checked = false; }

    var rate = params && params.get("rate") != null ? params.get("rate")
      : (saved && saved.rate != null ? String(saved.rate) : "");
    if (rate !== "") rateInput.value = rate;

    updateLabels();

    var amount = params && params.get("amount") != null ? params.get("amount")
      : (saved && saved.raw) || "";
    if (amount) {
      amountInput.value = formatInput(amount, decimalsOf(currentMeta().cur));
      calculate(false);
    } else if (currentMeta().rate == null) {
      // 단일 세율이 없는 나라는 입력 전에 미리 알린다 (타이핑 후 헛수고 방지)
      calculate(false);
    }
  })();
  // TOOLJS:END
})();
