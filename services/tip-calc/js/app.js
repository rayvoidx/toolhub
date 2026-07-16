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
  /* Tip Calculator — 국가별 팁 관습을 기본값으로 깔고, 청구액 x 팁% 가산 + 인원 분할.
     상태: URL ?country= / localStorage "<slug>:country" 만. 외부 API 없음, 모든 계산은 로컬. */

  /* ---- 국가별 팁 관습 (정적 데이터 — 연 1회 갱신으로 수렴, 실시간 조회 없음)
     cur    : ISO 4217 통화 코드 (Intl 이 기호·자릿수·소수점을 현지화)
     unit   : 현금 분할 시 1인당 올림 단위 (₩1,000 / ¥100 처럼 화폐 단위 감각)
     presets: 프리셋 % 버튼, def: 기본 팁 % (사용자가 검색하지 않아도 되는 값)
     note   : 관습 유형 → i18n 키 tool.note.<note>, range: 관습 범위 [하한, 상한] %
     sample : 플레이스홀더 예시 금액 (그 나라 한 끼 정도)
     note==="roundUp" 인 나라는 "올림"이 곧 관습이라 올림 토글이 기본 ON.  */
  var COUNTRIES = {
    US: { cur: "USD", unit: 1,    presets: [15, 18, 20],   def: 15, note: "expected",        range: [15, 20],   sample: 50,     name: "United States" },
    CA: { cur: "CAD", unit: 1,    presets: [15, 18, 20],   def: 15, note: "expected",        range: [15, 20],   sample: 50,     name: "Canada" },
    MX: { cur: "MXN", unit: 5,    presets: [10, 15, 20],   def: 15, note: "expected",        range: [10, 15],   sample: 500,    name: "Mexico" },
    BR: { cur: "BRL", unit: 1,    presets: [0, 10, 15],    def: 10, note: "serviceIncluded", range: [10, 10],   sample: 100,    name: "Brazil" },
    GB: { cur: "GBP", unit: 1,    presets: [0, 10, 12.5],  def: 12.5, note: "serviceIncluded", range: [10, 12.5], sample: 40,   name: "United Kingdom" },
    FR: { cur: "EUR", unit: 1,    presets: [0, 5, 10],     def: 5,  note: "roundUp",         range: [5, 10],    sample: 40,     name: "France" },
    DE: { cur: "EUR", unit: 1,    presets: [0, 5, 10],     def: 10, note: "roundUp",         range: [5, 10],    sample: 40,     name: "Germany" },
    AT: { cur: "EUR", unit: 1,    presets: [0, 5, 10],     def: 10, note: "roundUp",         range: [5, 10],    sample: 40,     name: "Austria" },
    ES: { cur: "EUR", unit: 1,    presets: [0, 5, 10],     def: 5,  note: "roundUp",         range: [5, 10],    sample: 40,     name: "Spain" },
    IT: { cur: "EUR", unit: 1,    presets: [0, 5, 10],     def: 5,  note: "roundUp",         range: [5, 10],    sample: 40,     name: "Italy" },
    NL: { cur: "EUR", unit: 1,    presets: [0, 5, 10],     def: 5,  note: "roundUp",         range: [5, 10],    sample: 40,     name: "Netherlands" },
    PT: { cur: "EUR", unit: 1,    presets: [0, 5, 10],     def: 5,  note: "roundUp",         range: [5, 10],    sample: 40,     name: "Portugal" },
    RU: { cur: "RUB", unit: 10,   presets: [0, 10, 15],    def: 10, note: "expected",        range: [10, 15],   sample: 2000,   name: "Russia" },
    EG: { cur: "EGP", unit: 5,    presets: [5, 10, 15],    def: 10, note: "expected",        range: [5, 10],    sample: 500,    name: "Egypt" },
    SA: { cur: "SAR", unit: 1,    presets: [0, 10, 15],    def: 10, note: "serviceIncluded", range: [10, 15],   sample: 150,    name: "Saudi Arabia" },
    AE: { cur: "AED", unit: 1,    presets: [0, 10, 15],    def: 10, note: "serviceIncluded", range: [10, 15],   sample: 150,    name: "United Arab Emirates" },
    IN: { cur: "INR", unit: 10,   presets: [5, 10, 15],    def: 10, note: "serviceIncluded", range: [5, 10],    sample: 1000,   name: "India" },
    PK: { cur: "PKR", unit: 10,   presets: [0, 5, 10],     def: 10, note: "serviceIncluded", range: [5, 10],    sample: 2000,   name: "Pakistan" },
    BD: { cur: "BDT", unit: 10,   presets: [0, 5, 10],     def: 10, note: "serviceIncluded", range: [5, 10],    sample: 1500,   name: "Bangladesh" },
    ID: { cur: "IDR", unit: 1000, presets: [0, 5, 10],     def: 5,  note: "serviceIncluded", range: [5, 10],    sample: 200000, name: "Indonesia" },
    TH: { cur: "THB", unit: 10,   presets: [0, 5, 10],     def: 10, note: "serviceIncluded", range: [5, 10],    sample: 800,    name: "Thailand" },
    SG: { cur: "SGD", unit: 1,    presets: [0, 5, 10],     def: 0,  note: "serviceIncluded", range: [10, 10],   sample: 60,     name: "Singapore" },
    CN: { cur: "CNY", unit: 1,    presets: [0, 5, 10],     def: 0,  note: "notCustomary",    range: [0, 0],     sample: 300,    name: "China" },
    JP: { cur: "JPY", unit: 100,  presets: [0, 5, 10],     def: 0,  note: "notCustomary",    range: [0, 0],     sample: 5000,   name: "Japan" },
    KR: { cur: "KRW", unit: 1000, presets: [0, 5, 10],     def: 0,  note: "notCustomary",    range: [0, 0],     sample: 50000,  name: "South Korea" },
    AU: { cur: "AUD", unit: 1,    presets: [0, 5, 10],     def: 0,  note: "notCustomary",    range: [0, 10],    sample: 60,     name: "Australia" }
  };
  // 지역 힌트가 없을 때(언어만 아는 경우) 언어 → 대표 국가
  var LANG_COUNTRY = {
    en: "US", zh: "CN", hi: "IN", es: "ES", ar: "AE", fr: "FR", bn: "BD",
    pt: "BR", ru: "RU", ur: "PK", id: "ID", de: "DE", ja: "JP", ko: "KR"
  };
  var DEFAULT_COUNTRY = "US";

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  // 금액 파싱: 콤마 제거, 숫자 아니면 0, 붙여넣은 음수는 절대값(입력 min=0 은 UI 차단)
  function parseAmount(raw) {
    if (raw == null) return 0;
    var n = parseFloat(String(raw).replace(/,/g, "").trim());
    if (!isFinite(n)) return 0;
    return Math.abs(n);
  }
  // 인원 파싱: 정수만, 빈값·0·음수·소수는 1 이상 정수로 정규화 (min=1, step=1)
  function parsePeople(raw) {
    var n = parseFloat(String(raw == null ? "" : raw).replace(/,/g, "").trim());
    if (!isFinite(n)) return 1;
    n = Math.floor(n);
    return n < 1 ? 1 : n;
  }
  // 부동소수 오차 제거 후 소수 둘째 자리 반올림
  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }
  // 현금 단위 올림: unit=1 이면 정수 올림(기존 동작 그대로), ₩1,000·¥100 처럼 나라별 단위 지원.
  // 1e-9 은 부동소수 잡음(18.000000000000004 → 19)만 걷어내는 값 — 실제 몫(23.001)은 그대로 올린다.
  // (몫을 먼저 반올림하면 1인당 합이 총액에 미달해 "올림"이 언더페이가 된다.)
  function ceilTo(n, unit) {
    if (!(unit > 0)) unit = 1;
    return round2(Math.ceil(n / unit - 1e-9) * unit);
  }
  // 국가 코드 정규화: 표에 없는 코드는 null (조용히 US 로 바꾸지 않고 호출부가 판단)
  function normCountry(code) {
    if (code == null) return null;
    var c = String(code).trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(COUNTRIES, c) ? c : null;
  }
  // "ko-KR" → KR, "zh-Hans-CN" → CN (지역 서브태그)
  function countryFromRegion(tag) {
    var parts = String(tag == null ? "" : tag).split("-");
    for (var i = 1; i < parts.length; i++) {
      if (/^[A-Za-z]{2}$/.test(parts[i])) {
        var c = normCountry(parts[i]);
        if (c) return c;
      }
    }
    return null;
  }
  // "ko" → KR (지역 정보가 없는 브라우저 폴백)
  function countryFromLang(tag) {
    var primary = String(tag == null ? "" : tag).split("-")[0].toLowerCase();
    return normCountry(LANG_COUNTRY[primary]);
  }
  // 우선순위: URL ?country= → 저장값 → 브라우저 지역 → 브라우저 언어 → US
  function detectCountry(urlCode, stored, langs) {
    var c = normCountry(urlCode);
    if (c) return c;
    c = normCountry(stored);
    if (c) return c;
    langs = langs || [];
    var i;
    for (i = 0; i < langs.length; i++) { c = countryFromRegion(langs[i]); if (c) return c; }
    for (i = 0; i < langs.length; i++) { c = countryFromLang(langs[i]); if (c) return c; }
    return DEFAULT_COUNTRY;
  }
  // 팁·합계·1인당 계산. roundUp=true 면 1인당을 unit 단위로 올림(현금 분할용), false 면 소수 2자리.
  function computeTip(bill, pct, people, roundUp, unit) {
    bill = Math.abs(bill);
    pct = Math.abs(pct);
    people = people < 1 ? 1 : Math.floor(people);
    if (!(unit > 0)) unit = 1;
    var tip = bill * pct / 100;
    var total = bill + tip;
    var perPersonExact = total / people;
    var perPerson = roundUp ? ceilTo(perPersonExact, unit) : round2(perPersonExact);
    var perPersonTip = tip / people;
    var actualTotal = roundUp ? perPerson * people : total;
    var roundExtra = roundUp ? actualTotal - total : 0;
    return {
      tip: round2(tip),
      total: round2(total),
      perPerson: round2(perPerson),
      perPersonTip: round2(perPersonTip),
      actualTotal: round2(actualTotal),
      roundExtra: round2(roundExtra)
    };
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseAmount: parseAmount, parsePeople: parsePeople,
      round2: round2, ceilTo: ceilTo, computeTip: computeTip,
      detectCountry: detectCountry, COUNTRIES: COUNTRIES
    };
    return;
  }

  /* ---- i18n · Intl 헬퍼 (통화·자릿수·국가명은 전부 Intl 이 현지화 — 하드코딩 없음) ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "tip-calc") + ":country";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmt(n) {
    try { return Number(n).toLocaleString(uiLang(), { maximumFractionDigits: 2 }); }
    catch (e) { return String(n); }
  }
  function fmtMoney(n, cur) {
    try { return new Intl.NumberFormat(uiLang(), { style: "currency", currency: cur }).format(n); }
    catch (e) { return fmt(n); }
  }
  function fmtUnit(n, cur) { // 올림 단위 표시용 — 소수점 없이 ($1 / ₩1,000 / ¥100)
    try {
      return new Intl.NumberFormat(uiLang(), {
        style: "currency", currency: cur, minimumFractionDigits: 0, maximumFractionDigits: 0
      }).format(n);
    } catch (e) { return fmtMoney(n, cur); }
  }
  function fmtPct(p) {
    try { return new Intl.NumberFormat(uiLang(), { style: "percent", maximumFractionDigits: 1 }).format(p / 100); }
    catch (e) { return String(p) + "%"; }
  }
  function fmtRange(range) {
    return range[0] === range[1] ? fmtPct(range[1]) : fmtPct(range[0]) + "–" + fmtPct(range[1]);
  }
  function regionNames() {
    try {
      if (typeof Intl !== "undefined" && Intl.DisplayNames) {
        return new Intl.DisplayNames([uiLang()], { type: "region" });
      }
    } catch (e) { /* 미지원 브라우저 → 영문명 폴백 */ }
    return null;
  }
  function countryName(code, dn) {
    if (dn) {
      try { var n = dn.of(code); if (n && n !== code) return n; }
      catch (e) { /* 폴백 */ }
    }
    return COUNTRIES[code].name;
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var countryEl = $("country"), noteEl = $("country-note");
  var billEl = $("bill"), tipEl = $("tip"), peopleEl = $("people");
  var minusBtn = $("people-minus"), plusBtn = $("people-plus");
  var roundEl = $("roundup"), roundLabelEl = $("roundup-label"), badgeEl = $("tip-badge");
  var emptyEl = $("result-empty"), gridEl = $("result-grid");
  var helperEl = $("round-helper"), copyHintEl = $("copy-hint");
  var presetsWrap = $("tip-presets");
  if (!billEl || !tipEl || !peopleEl || !gridEl) return;
  var presetBtns = presetsWrap ? presetsWrap.querySelectorAll(".tip-preset") : [];
  var cards = gridEl.querySelectorAll(".res-card");
  var PRESET_CSS = "flex:0 0 auto;padding:9px 14px;border:none;border-radius:10px;font-weight:700;font-size:15px;cursor:pointer;background:var(--muted);color:#fff;";

  /* ---- 국가 상태 (URL → localStorage → 브라우저 추정) ---- */
  function urlCountry() {
    try { return new URLSearchParams(location.search).get("country"); }
    catch (e) { return null; }
  }
  function storedCountry() {
    try { return localStorage.getItem(SKEY); }
    catch (e) { return null; } // private mode — 저장만 실패, 계산은 정상
  }
  function saveCountry(code) {
    try { localStorage.setItem(SKEY, code); } catch (e) { /* noop */ }
  }
  var current = detectCountry(urlCountry(), storedCountry(), navigator.languages || [navigator.language || ""]);

  /* ---- 프리셋 활성 표시 ---- */
  function syncPresetActive() {
    var cur = tipEl.value.trim();
    for (var i = 0; i < presetBtns.length; i++) {
      var b = presetBtns[i];
      var on = cur !== "" && parseFloat(cur) === parseFloat(b.getAttribute("data-tip"));
      b.style.background = on ? "var(--accent)" : "var(--muted)";
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  /* ---- 국가 의존 UI (프리셋·관습 안내·통화 문구) ---- */
  function onPresetClick() {
    tipEl.value = this.getAttribute("data-tip");
    render();
  }
  function renderPresets() {
    if (!presetsWrap) return;
    var list = COUNTRIES[current].presets;
    presetsWrap.textContent = "";
    for (var i = 0; i < list.length; i++) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tip-preset";
      b.setAttribute("data-tip", String(list[i]));
      b.setAttribute("aria-pressed", "false");
      b.style.cssText = PRESET_CSS;
      b.textContent = fmtPct(list[i]);
      b.addEventListener("click", onPresetClick);
      presetsWrap.appendChild(b);
    }
    presetBtns = presetsWrap.querySelectorAll(".tip-preset");
  }
  function renderCountryOptions() {
    if (!countryEl) return;
    var dn = regionNames(), list = [], code;
    for (code in COUNTRIES) {
      if (Object.prototype.hasOwnProperty.call(COUNTRIES, code)) {
        list.push({ code: code, name: countryName(code, dn) });
      }
    }
    try {
      var coll = new Intl.Collator(uiLang());
      list.sort(function (a, b) { return coll.compare(a.name, b.name); });
    } catch (e) {
      list.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
    }
    countryEl.textContent = "";
    for (var i = 0; i < list.length; i++) {
      var opt = document.createElement("option");
      opt.value = list[i].code;
      opt.textContent = list[i].name;
      countryEl.appendChild(opt);
    }
    countryEl.value = current;
  }
  function renderCountryCopy() {
    var c = COUNTRIES[current];
    if (noteEl) {
      var txt = tr("tool.note." + c.note, "");
      if (txt) {
        noteEl.textContent = txt
          .replace("{country}", countryName(current, regionNames()))
          .replace("{range}", fmtRange(c.range));
        noteEl.hidden = false;
      } else {
        noteEl.hidden = true;
      }
    }
    // 예시 금액·올림 단위는 선택 국가의 통화로 (Intl 이 기호·자릿수 처리)
    billEl.placeholder = tr("tool.bill.ph", "e.g. {x}").replace("{x}", fmt(c.sample));
    if (roundLabelEl) {
      roundLabelEl.textContent = tr("tool.roundup.label", "Round up per person") +
        " (" + fmtUnit(c.unit, c.cur) + ")";
    }
  }
  // 국가 전환 = 그 나라의 관습을 기본값으로 (팁 %·올림 토글·프리셋·통화 전부 분기)
  function applyCountry(code) {
    current = code;
    tipEl.value = String(COUNTRIES[code].def);
    roundEl.checked = COUNTRIES[code].note === "roundUp"; // 유럽식 라운딩은 그 자체가 관습
    renderPresets();
    renderCountryCopy();
    render();
  }

  /* ---- 카드 값 세팅 ---- */
  function setCard(key, value, cur) {
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getAttribute("data-copy") === key) {
        var valEl = cards[i].querySelector(".rc-value");
        if (valEl) valEl.textContent = fmtMoney(value, cur);
        cards[i].setAttribute("data-value", String(value)); // 복사는 원시 숫자
      }
    }
  }

  /* ---- 렌더 ---- */
  function render() {
    var c = COUNTRIES[current];
    var bill = parseAmount(billEl.value);
    var tipEmpty = tipEl.value.trim() === "";
    var pct = tipEmpty ? 0 : parseAmount(tipEl.value);
    var people = parsePeople(peopleEl.value);
    var roundUp = !!roundEl.checked;

    // 팁% 빈값 → 0% 배지 (청구액이 있을 때만)
    badgeEl.hidden = !(tipEmpty && bill > 0);

    // 빈/0 청구액 → 결과 비활성 (오류 아님, 안내 문구)
    if (!(bill > 0)) {
      gridEl.hidden = true;
      copyHintEl.hidden = true;
      helperEl.hidden = true;
      emptyEl.hidden = false;
      syncPresetActive();
      return;
    }

    var r = computeTip(bill, pct, people, roundUp, c.unit);
    setCard("tip", r.tip, c.cur);
    setCard("total", r.total, c.cur);
    setCard("perPerson", r.perPerson, c.cur);
    setCard("perPersonTip", r.perPersonTip, c.cur);

    emptyEl.hidden = true;
    gridEl.hidden = false;
    copyHintEl.hidden = false;

    if (roundUp && r.roundExtra > 0) {
      helperEl.textContent = tr("tool.roundHelper", "Rounding adds +{x} to the actual total paid")
        .replace("{x}", fmtMoney(r.roundExtra, c.cur));
      helperEl.hidden = false;
    } else {
      helperEl.hidden = true;
    }
    syncPresetActive();
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
      // data-i18n 라벨을 현재 언어로 복원
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
    } catch (e) { /* 복사 미지원 — 표시값은 그대로 남는다 (조용한 실패 아님) */ }
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

  /* ---- 인원 스테퍼 ---- */
  function bumpPeople(delta) {
    var next = parsePeople(peopleEl.value) + delta;
    if (next < 1) next = 1;
    peopleEl.value = String(next);
    render();
  }

  /* ---- 이벤트 ---- */
  billEl.addEventListener("input", render);
  tipEl.addEventListener("input", render);
  peopleEl.addEventListener("input", render);
  roundEl.addEventListener("change", render);
  if (minusBtn) minusBtn.addEventListener("click", function () { bumpPeople(-1); });
  if (plusBtn) plusBtn.addEventListener("click", function () { bumpPeople(1); });
  if (countryEl) {
    countryEl.addEventListener("change", function () {
      var code = normCountry(countryEl.value);
      if (!code) { countryEl.value = current; return; } // 알 수 없는 값 → 되돌리기
      saveCountry(code);
      applyCountry(code);
    });
  }
  for (var i = 0; i < cards.length; i++) {
    cards[i].addEventListener("click", function () { copyCard(this); });
  }
  // 언어 전환 시 국가명·통화 포맷·동적 문구 재적용 (i18n 엔진이 정적 키를 적용한 뒤 발행)
  document.addEventListener("i18n:change", function () {
    renderCountryOptions();
    renderPresets();
    renderCountryCopy();
    render();
  });

  renderCountryOptions();
  applyCountry(current); // 프리셋·팁 기본값·올림 토글·통화를 추정 국가 기준으로 초기화
  // TOOLJS:END
})();
