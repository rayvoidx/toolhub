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
  // fuel-cost-calc — trip fuel cost (spec: factory/state/fuel-cost-calc.yaml)
  // 국가를 고르면 거리·연비·유가 단위와 통화가 한 번에 맞춰진다 — 사용자는 숫자 3개만 넣는다.
  // 전 계산을 metric base(리터·km)로 정규화. 실시간 유가 API 미사용 → 외부 호출 0.
  // 저장: 국가 localStorage("<slug>:country") + 단위 override·왕복 localStorage("<slug>:prefs"),
  //       URL ?country=. 숫자 입력값(거리·연비·유가)은 저장하지 않는다.

  var KM_PER_MI = 1.609344;
  var L_PER_US_GAL = 3.785411784;
  var L_PER_UK_GAL = 4.54609;

  /* ---- 국가별 운전 관습 (정적 데이터 — 연 1회 갱신으로 수렴, 실시간 조회 없음)
     cur    : ISO 4217 통화 코드 — 기호·소수 자릿수·천단위는 Intl 이 현지화(하드코딩 없음)
     dist   : 거리 단위 | eff: 계기판 연비 표기 | price: 주유소가 파는 단위
     sample : 그 나라 유가 예시 — placeholder(자릿수 감각) 전용. 계산에는 절대 쓰지 않는다
              (유가는 항상 사용자 입력 — 그래서 유가가 올라도 이 표는 낡지 않는다).
     name   : Intl.DisplayNames 미지원 브라우저용 영문명 폴백.
     관습 안내 문구는 (dist·eff·price) 조합에서 파생되는 4개 아키타입 → i18n 키 tool.note.<key> */
  var COUNTRIES = {
    AE: { cur: "AED", dist: "km", eff: "kmL",   price: "perL",  sample: 3,     name: "United Arab Emirates" },
    AT: { cur: "EUR", dist: "km", eff: "l100",  price: "perL",  sample: 1.75,  name: "Austria" },
    AU: { cur: "AUD", dist: "km", eff: "l100",  price: "perL",  sample: 1.9,   name: "Australia" },
    BD: { cur: "BDT", dist: "km", eff: "kmL",   price: "perL",  sample: 120,   name: "Bangladesh" },
    BE: { cur: "EUR", dist: "km", eff: "l100",  price: "perL",  sample: 1.75,  name: "Belgium" },
    BR: { cur: "BRL", dist: "km", eff: "kmL",   price: "perL",  sample: 6,     name: "Brazil" },
    CA: { cur: "CAD", dist: "km", eff: "l100",  price: "perL",  sample: 1.6,   name: "Canada" },
    CH: { cur: "CHF", dist: "km", eff: "l100",  price: "perL",  sample: 1.8,   name: "Switzerland" },
    CN: { cur: "CNY", dist: "km", eff: "l100",  price: "perL",  sample: 8,     name: "China" },
    DE: { cur: "EUR", dist: "km", eff: "l100",  price: "perL",  sample: 1.75,  name: "Germany" },
    EG: { cur: "EGP", dist: "km", eff: "kmL",   price: "perL",  sample: 15,    name: "Egypt" },
    ES: { cur: "EUR", dist: "km", eff: "l100",  price: "perL",  sample: 1.65,  name: "Spain" },
    FR: { cur: "EUR", dist: "km", eff: "l100",  price: "perL",  sample: 1.8,   name: "France" },
    GB: { cur: "GBP", dist: "mi", eff: "mpgUK", price: "perL",  sample: 1.45,  name: "United Kingdom" },
    ID: { cur: "IDR", dist: "km", eff: "kmL",   price: "perL",  sample: 13000, name: "Indonesia" },
    IE: { cur: "EUR", dist: "km", eff: "l100",  price: "perL",  sample: 1.75,  name: "Ireland" },
    IN: { cur: "INR", dist: "km", eff: "kmL",   price: "perL",  sample: 100,   name: "India" },
    IT: { cur: "EUR", dist: "km", eff: "l100",  price: "perL",  sample: 1.85,  name: "Italy" },
    JP: { cur: "JPY", dist: "km", eff: "kmL",   price: "perL",  sample: 175,   name: "Japan" },
    KR: { cur: "KRW", dist: "km", eff: "kmL",   price: "perL",  sample: 1700,  name: "South Korea" },
    MX: { cur: "MXN", dist: "km", eff: "kmL",   price: "perL",  sample: 24,    name: "Mexico" },
    MY: { cur: "MYR", dist: "km", eff: "l100",  price: "perL",  sample: 2.1,   name: "Malaysia" },
    NL: { cur: "EUR", dist: "km", eff: "l100",  price: "perL",  sample: 2,     name: "Netherlands" },
    NO: { cur: "NOK", dist: "km", eff: "l100",  price: "perL",  sample: 22,    name: "Norway" },
    NZ: { cur: "NZD", dist: "km", eff: "l100",  price: "perL",  sample: 2.6,   name: "New Zealand" },
    PH: { cur: "PHP", dist: "km", eff: "kmL",   price: "perL",  sample: 60,    name: "Philippines" },
    PK: { cur: "PKR", dist: "km", eff: "kmL",   price: "perL",  sample: 260,   name: "Pakistan" },
    PL: { cur: "PLN", dist: "km", eff: "l100",  price: "perL",  sample: 6.5,   name: "Poland" },
    PT: { cur: "EUR", dist: "km", eff: "l100",  price: "perL",  sample: 1.8,   name: "Portugal" },
    RU: { cur: "RUB", dist: "km", eff: "l100",  price: "perL",  sample: 60,    name: "Russia" },
    SA: { cur: "SAR", dist: "km", eff: "kmL",   price: "perL",  sample: 2.3,   name: "Saudi Arabia" },
    SE: { cur: "SEK", dist: "km", eff: "l100",  price: "perL",  sample: 19,    name: "Sweden" },
    SG: { cur: "SGD", dist: "km", eff: "l100",  price: "perL",  sample: 2.8,   name: "Singapore" },
    TH: { cur: "THB", dist: "km", eff: "kmL",   price: "perL",  sample: 40,    name: "Thailand" },
    TR: { cur: "TRY", dist: "km", eff: "l100",  price: "perL",  sample: 45,    name: "Türkiye" },
    US: { cur: "USD", dist: "mi", eff: "mpgUS", price: "usgal", sample: 3.5,   name: "United States" },
    ZA: { cur: "ZAR", dist: "km", eff: "l100",  price: "perL",  sample: 23,    name: "South Africa" }
  };
  // 지역 힌트가 없을 때(언어만 아는 경우) 언어 → 대표 국가 (locales 14개 전부 커버)
  var LANG_COUNTRY = {
    en: "US", zh: "CN", hi: "IN", es: "ES", ar: "AE", fr: "FR", bn: "BD",
    pt: "BR", ru: "RU", ur: "PK", id: "ID", de: "DE", ja: "JP", ko: "KR"
  };
  var DEFAULT_COUNTRY = "US";
  // placeholder 예시 — 단위를 바꾸면 예시도 그 단위의 감각으로 따라간다
  var DIST_SAMPLE = { km: 320, mi: 200 };
  var EFF_SAMPLE = { kmL: 12, l100: 7.5, mpgUS: 30, mpgUK: 45 };

  /* ---- 파싱: 표시 문자열 → 숫자 (콤마 자릿구분 제거, 첫 소수점만 인정) ---- */
  function parseNum(str) {
    if (str == null) return NaN;
    var s = String(str).replace(/,/g, "").trim();
    if (s === "" || s === "-" || s === "." || s === "-." || s === "+") return NaN;
    if (!/^[-+]?\d*\.?\d*$/.test(s)) return NaN;
    return parseFloat(s);
  }

  /* ---- 표시 숫자 포맷 (스펙: Number(v.toPrecision(10)) 후 후행 0 제거,
         |v|>=1e12 또는 0<|v|<1e-4 는 지수 표기) ---- */
  function fmtNum(v) {
    if (v == null || typeof v !== "number" || !isFinite(v)) return null;
    var n = Number(v.toPrecision(10));
    var abs = Math.abs(n);
    if (abs !== 0 && (abs >= 1e12 || abs < 1e-4)) {
      // 지수 표기 + 가수부 후행 0 제거
      return n.toExponential(4).replace(/\.?0+e/, "e").replace(/e\+?/, "e");
    }
    var lang;
    try { lang = window.I18N && window.I18N.lang(); } catch (e) { /* noop */ }
    try {
      return n.toLocaleString(lang || undefined, { maximumFractionDigits: 12 });
    } catch (e) {
      return String(n);
    }
  }

  /* ---- 순수 계산 로직 (전부 metric base 로 정규화) ---- */

  /** 연비 단위 → 리터/km */
  function litersPerKm(eff, effUnit) {
    switch (effUnit) {
      case "l100":  return eff / 100;
      case "mpgUS": return L_PER_US_GAL / (eff * KM_PER_MI);
      case "mpgUK": return L_PER_UK_GAL / (eff * KM_PER_MI);
      case "kmL":
      default:      return 1 / eff;
    }
  }
  /** 유가 단위 → 리터당 가격 */
  function pricePerLiter(price, priceUnit) {
    switch (priceUnit) {
      case "usgal": return price / L_PER_US_GAL;
      case "ukgal": return price / L_PER_UK_GAL;
      case "perL":
      default:      return price;
    }
  }

  /**
   * 핵심 계산.
   * dist>=0, eff>0, price>=0, distUnit∈{km,mi}, people>=1 정수, roundTrip bool.
   * 반환: liters(주유량 L), totalCost, perPersonCost, costPerDist(선택 거리단위 1당 비용), gallons.
   */
  function compute(dist, distUnit, eff, effUnit, price, priceUnit, roundTrip, people, galUnit) {
    var distKm = dist * (distUnit === "mi" ? KM_PER_MI : 1);
    var lpkm = litersPerKm(eff, effUnit);
    var ppl = pricePerLiter(price, priceUnit);
    var factor = roundTrip ? 2 : 1;
    var liters = distKm * lpkm * factor;
    var totalCost = liters * ppl;
    var perPerson = totalCost / people;
    // 거리 1단위(선택한 km/mi)당 비용 = 리터당가 × 리터/km × (km/단위) — 편도·왕복·거리값 무관 rate
    var costPerDist = ppl * lpkm * (distUnit === "mi" ? KM_PER_MI : 1);
    var galLiters = (galUnit === "ukgal") ? L_PER_UK_GAL : L_PER_US_GAL;
    var gallons = liters / galLiters;
    return {
      liters: liters,
      gallons: gallons,
      totalCost: totalCost,
      perPerson: perPerson,
      costPerDist: costPerDist
    };
  }

  /* ---- 국가 → 단위·통화 분기 (순수 함수) ---- */

  /** 유가 단위 → 주유량 표시 단위. 리터로 파는 나라엔 갤런을 보여주지 않는다(잡음). */
  function volUnitFor(priceUnit) {
    if (priceUnit === "usgal") return "usgal";
    if (priceUnit === "ukgal") return "ukgal";
    return "L";
  }
  /** 관습 안내 아키타입 — (거리·연비·유가) 조합에서 파생. 4종으로 37개국을 덮는다. */
  function noteKeyFor(c) {
    if (c.eff === "mpgUS") return "us";        // 마일 + MPG + 갤런당 (미국)
    if (c.eff === "mpgUK") return "ukMixed";   // 리터로 팔면서 마일·임페리얼 MPG (영국)
    if (c.eff === "l100") return "l100";       // km + L/100km + 리터당 (유럽·중국 등)
    return "kmL";                              // km + km/L + 리터당 (한국·일본·브라질·인도 등)
  }
  /** 국가 코드 정규화 — 표에 없으면 null (조용히 US 로 바꾸지 않고 호출부가 판단) */
  function normCountry(code) {
    if (code == null) return null;
    var c = String(code).trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(COUNTRIES, c) ? c : null;
  }
  /** "ko-KR" → KR, "zh-Hans-CN" → CN (지역 서브태그) */
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
  /** "ko" → KR (지역 정보가 없는 브라우저 폴백) */
  function countryFromLang(tag) {
    var primary = String(tag == null ? "" : tag).split("-")[0].toLowerCase();
    return normCountry(LANG_COUNTRY[primary]);
  }
  /** 우선순위: URL ?country= → 저장값 → 브라우저 지역 → 브라우저 언어 → US */
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
  /** 국가 표준 유가 예시를 현재 선택된 유가 단위로 환산 (placeholder 전용 — 계산 입력 아님) */
  function samplePrice(code, priceUnit) {
    var c = COUNTRIES[normCountry(code) || DEFAULT_COUNTRY];
    var perL = pricePerLiter(c.sample, c.price);
    var v = perL;
    if (priceUnit === "usgal") v = perL * L_PER_US_GAL;
    else if (priceUnit === "ukgal") v = perL * L_PER_UK_GAL;
    return v >= 100 ? Math.round(v) : Math.round(v * 100) / 100;
  }

  // node 단위 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      litersPerKm: litersPerKm, pricePerLiter: pricePerLiter,
      compute: compute, fmtNum: fmtNum, parseNum: parseNum,
      volUnitFor: volUnitFor, noteKeyFor: noteKeyFor, normCountry: normCountry,
      detectCountry: detectCountry, samplePrice: samplePrice,
      COUNTRIES: COUNTRIES, LANG_COUNTRY: LANG_COUNTRY,
      DIST_SAMPLE: DIST_SAMPLE, EFF_SAMPLE: EFF_SAMPLE,
      KM_PER_MI: KM_PER_MI, L_PER_US_GAL: L_PER_US_GAL, L_PER_UK_GAL: L_PER_UK_GAL
    };
    return;
  }

  /* ---- 여기서부터 브라우저 전용 (DOM·Intl·localStorage) ---- */
  var cfg = window.APP_CONFIG || {};
  var PREFS_KEY = (cfg.slug || "fuel-cost-calc") + ":prefs";
  var COUNTRY_KEY = (cfg.slug || "fuel-cost-calc") + ":country";

  // 브라우저 단위 검증 훅 (UI 상태 아님)
  window.__FCC_TEST = {
    litersPerKm: litersPerKm, pricePerLiter: pricePerLiter,
    compute: compute, fmtNum: fmtNum, parseNum: parseNum,
    detectCountry: detectCountry, samplePrice: samplePrice, COUNTRIES: COUNTRIES,
    KM_PER_MI: KM_PER_MI, L_PER_US_GAL: L_PER_US_GAL, L_PER_UK_GAL: L_PER_UK_GAL
  };

  /* ---- i18n 헬퍼 ---- */
  function t(key) {
    var s = window.I18N && window.I18N.t(key);
    return s != null ? s : key;
  }
  function fmt(s, params) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return params && params[k] != null ? String(params[k]) : m;
    });
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }

  /* ---- 통화 포맷 — 기호·자릿수·천단위 전부 Intl 위임 (기호 하드코딩 없음) ---- */
  function curDigits(cur) {
    try {
      return new Intl.NumberFormat(uiLang(), { style: "currency", currency: cur })
        .resolvedOptions().maximumFractionDigits;
    } catch (e) { return 2; }
  }
  function curSymbol(cur) {
    try {
      var parts = new Intl.NumberFormat(uiLang(), { style: "currency", currency: cur }).formatToParts(1);
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === "currency") return parts[i].value;
      }
    } catch (e) { /* 구형 브라우저 → 코드 표기 폴백 */ }
    return cur;
  }
  /** 금액 표시. 극단값은 기존 규칙대로 지수 표기, 그 외엔 통화별 소수 자릿수를 따른다.
      단, 그 자릿수로 0 이 되어버리는 소액(거리당 비용 등)은 자릿수를 늘려 "0" 으로 뭉개지 않는다. */
  function fmtMoney(n, cur) {
    if (n == null || typeof n !== "number" || !isFinite(n)) return null;
    var abs = Math.abs(n);
    if (abs !== 0 && (abs >= 1e12 || abs < 1e-4)) return curSymbol(cur) + fmtNum(n);
    var d = curDigits(cur);
    if (abs > 0) {
      var need = Math.ceil(-Math.log10(abs)) + 1;  // 유효숫자 2자리가 보이는 최소 자릿수
      if (need > d) d = Math.min(need, 8);
    }
    try {
      return new Intl.NumberFormat(uiLang(), {
        style: "currency", currency: cur, maximumFractionDigits: d
      }).format(n);
    } catch (e) {
      return curSymbol(cur) + fmtNum(n);
    }
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

  /* ---- DOM 참조 ---- */
  var countryEl = document.getElementById("fcc-country");
  var noteEl = document.getElementById("fcc-country-note");
  var curBadgeEl = document.getElementById("fcc-curbadge");
  var distEl = document.getElementById("fcc-dist");
  var distUnitEl = document.getElementById("fcc-dist-unit");
  var effEl = document.getElementById("fcc-eff");
  var effUnitEl = document.getElementById("fcc-eff-unit");
  var priceEl = document.getElementById("fcc-price");
  var priceUnitEl = document.getElementById("fcc-price-unit");
  var moreEl = document.getElementById("fcc-more");
  var roundTripEl = document.getElementById("fcc-roundtrip");
  var peopleEl = document.getElementById("fcc-people");
  var minusBtn = document.getElementById("fcc-minus");
  var plusBtn = document.getElementById("fcc-plus");

  var msgEl = document.getElementById("fcc-msg");
  var outEl = document.getElementById("fcc-out");
  var totalEl = document.getElementById("fcc-total");
  var fuelCell = document.getElementById("fcc-fuel-cell");
  var fuelEl = document.getElementById("fcc-fuel");
  var perDistCell = document.getElementById("fcc-perdist-cell");
  var perDistLabel = document.getElementById("fcc-perdist-label");
  var perDistEl = document.getElementById("fcc-perdist");
  var perPersonCell = document.getElementById("fcc-perperson-cell");
  var perPersonEl = document.getElementById("fcc-perperson");
  var copyBtn = document.getElementById("fcc-copy");
  var statusEl = document.getElementById("fcc-status");
  var resultEl = document.getElementById("fcc-result");

  /* ---- 국가 상태 ---- */
  var current = DEFAULT_COUNTRY;

  function urlCountry() {
    try { return new URLSearchParams(location.search).get("country"); }
    catch (e) { return null; }  // 구형 브라우저
  }
  function storedCountry() {
    try { return localStorage.getItem(COUNTRY_KEY); }
    catch (e) { return null; }  // private mode
  }
  function saveCountry(code) {
    try { localStorage.setItem(COUNTRY_KEY, code); } catch (e) { /* private mode */ }
  }
  /** 국가 기본값을 단위 select 에 깔아준다 — 사용자가 단위를 고민하지 않게 하는 핵심 */
  function applyCountry(code) {
    var c = COUNTRIES[code];
    if (!c) return;
    if (distUnitEl) distUnitEl.value = c.dist;
    if (effUnitEl) effUnitEl.value = c.eff;
    if (priceUnitEl) priceUnitEl.value = c.price;
  }

  /* ---- 상태 저장/복원 (단위 override·왕복만 — 숫자 입력값은 저장하지 않는다) ----
     prefs 에 country 를 함께 적어, 다른 나라로 바뀌면(?country= 공유 링크 등)
     예전 나라의 단위가 따라오지 않게 한다. */
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        v: 2,
        country: current,
        distUnit: distUnitEl ? distUnitEl.value : "km",
        effUnit: effUnitEl ? effUnitEl.value : "kmL",
        priceUnit: priceUnitEl ? priceUnitEl.value : "perL",
        roundTrip: roundTripEl ? !!roundTripEl.checked : false
      }));
    } catch (e) { /* private mode — 저장 생략 */ }
  }
  function restorePrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) { p = null; }
    if (!p || typeof p !== "object") return;
    function setSel(el, val, allowed) {
      if (el && val != null && allowed.indexOf(val) !== -1) el.value = val;
    }
    // 같은 나라에서 사용자가 직접 바꾼 단위만 복원한다.
    // v1(통화 select 시절) prefs 의 단위·통화는 국가 기본값에 양보 — 폐기가 아니라 승격.
    if (p.v === 2 && normCountry(p.country) === current) {
      setSel(distUnitEl, p.distUnit, ["km", "mi"]);
      setSel(effUnitEl, p.effUnit, ["kmL", "l100", "mpgUS", "mpgUK"]);
      setSel(priceUnitEl, p.priceUnit, ["perL", "usgal", "ukgal"]);
    }
    // 왕복은 단위·국가와 무관 → v1 사용자도 그대로 이어받는다
    if (roundTripEl && typeof p.roundTrip === "boolean") roundTripEl.checked = p.roundTrip;
  }

  /* ---- 렌더 헬퍼 ---- */
  function showMsg(key, isErr) {
    if (msgEl) {
      msgEl.textContent = t(key);
      msgEl.className = "fcc-msg" + (isErr ? " is-err" : "");
      msgEl.hidden = false;
    }
    if (outEl) outEl.hidden = true;
  }

  function currentPeople() {
    if (!peopleEl) return 1;
    var pf = parseNum(peopleEl.value);
    if (isNaN(pf) || pf < 1) return 1;
    var p = Math.floor(pf);
    return p < 1 ? 1 : p;
  }

  /* ---- 국가 의존 UI (국가·언어가 바뀌면 다시 그린다) ---- */
  function fillCountrySelect() {
    if (!countryEl) return;
    var dn = regionNames(), list = [], code;
    for (code in COUNTRIES) {
      if (Object.prototype.hasOwnProperty.call(COUNTRIES, code)) {
        list.push({ code: code, name: countryName(code, dn) });
      }
    }
    list.sort(function (a, b) {
      try { return a.name.localeCompare(b.name, uiLang()); }
      catch (e) { return a.name < b.name ? -1 : 1; }
    });
    countryEl.textContent = "";
    for (var i = 0; i < list.length; i++) {
      var opt = document.createElement("option");
      opt.value = list[i].code;
      opt.textContent = list[i].name;
      countryEl.appendChild(opt);
    }
    countryEl.value = current;
  }
  function renderNote() {
    if (!noteEl) return;
    var c = COUNTRIES[current];
    if (!c) { noteEl.textContent = ""; return; }
    noteEl.textContent = fmt(t("tool.note." + noteKeyFor(c)), {
      country: countryName(current, regionNames())
    });
  }
  /** 플레이스홀더는 "선택된 단위"의 감각으로 — 국가를 바꾸든 단위를 바꾸든 예시가 따라온다 */
  function renderPlaceholders() {
    var tpl = t("tool.ph");
    var distUnit = distUnitEl ? distUnitEl.value : "km";
    var effUnit = effUnitEl ? effUnitEl.value : "kmL";
    var priceUnit = priceUnitEl ? priceUnitEl.value : "perL";
    if (distEl) distEl.placeholder = fmt(tpl, { n: fmtNum(DIST_SAMPLE[distUnit] || 320) });
    if (effEl) effEl.placeholder = fmt(tpl, { n: fmtNum(EFF_SAMPLE[effUnit] || 12) });
    if (priceEl) priceEl.placeholder = fmt(tpl, { n: fmtNum(samplePrice(current, priceUnit)) });
  }
  function renderCurBadge() {
    if (!curBadgeEl) return;
    var c = COUNTRIES[current];
    curBadgeEl.textContent = c ? curSymbol(c.cur) : "";
  }

  function render() {
    if (!msgEl || !outEl) return;

    var distRaw = distEl ? distEl.value : "";
    var effRaw = effEl ? effEl.value : "";
    var priceRaw = priceEl ? priceEl.value : "";

    var dist = parseNum(distRaw);
    var eff = parseNum(effRaw);
    var price = parseNum(priceRaw);

    var hasDist = distRaw.trim() !== "" && !isNaN(dist);
    var hasEff = effRaw.trim() !== "" && !isNaN(eff);
    var hasPrice = priceRaw.trim() !== "" && !isNaN(price);

    // 빈 입력(거리/연비/유가 중 하나라도) → 안내만, 계산 중단
    if (!hasDist || !hasEff || !hasPrice) { showMsg("tool.n.empty", false); return; }

    // 연비 0 또는 음수 → 계산 중단 (0으로 나눗셈 차단)
    if (eff <= 0) { showMsg("tool.n.eff", true); return; }

    // 음수 거리·유가 → 안내 (0은 정상: 총비용 0)
    if (dist < 0 || price < 0) { showMsg("tool.n.neg", true); return; }

    var distUnit = distUnitEl ? distUnitEl.value : "km";
    var effUnit = effUnitEl ? effUnitEl.value : "kmL";
    var priceUnit = priceUnitEl ? priceUnitEl.value : "perL";
    var currency = (COUNTRIES[current] || COUNTRIES[DEFAULT_COUNTRY]).cur;  // 통화는 국가가 정한다
    var roundTrip = roundTripEl ? !!roundTripEl.checked : false;
    var people = currentPeople();
    var vol = volUnitFor(priceUnit);
    var galUnit = (vol === "ukgal") ? "ukgal" : "usgal";

    var r = compute(dist, distUnit, eff, effUnit, price, priceUnit, roundTrip, people, galUnit);

    // 극단값이라도 fmtNum/fmtMoney 가 지수 표기로 처리. 비정상(Infinity)만 방어.
    var totalDisplay = fmtMoney(r.totalCost, currency);
    var litersStr = fmtNum(r.liters);
    var gallonsStr = fmtNum(r.gallons);
    var perDistDisplay = fmtMoney(r.costPerDist, currency);
    if (totalDisplay == null || litersStr == null || perDistDisplay == null) {
      showMsg("tool.n.empty", false);
      return;
    }
    var litersLabel = litersStr + " " + t("tool.unit.L");

    // 총 유류비
    if (totalEl) {
      totalEl.textContent = totalDisplay;
      totalEl.setAttribute("data-copy", totalDisplay);
    }

    // 필요 주유량 — 그 나라가 파는 단위로. 갤런 나라만 리터를 괄호로 병기한다.
    var fuelDisplay = litersLabel;
    if (vol !== "L") {
      fuelDisplay = (gallonsStr || "—") + " " + t(vol === "ukgal" ? "tool.galUK" : "tool.galUS") +
        " (" + litersLabel + ")";
    }
    if (fuelEl) fuelEl.textContent = fuelDisplay;
    if (fuelCell) fuelCell.setAttribute("data-copy", fuelDisplay);

    // 거리당 비용 (선택 거리단위 기준)
    if (perDistLabel) perDistLabel.textContent = fmt(t("tool.res.perDist"), { unit: distUnit });
    if (perDistEl) perDistEl.textContent = perDistDisplay;
    if (perDistCell) perDistCell.setAttribute("data-copy", perDistDisplay);

    // 인원 > 1 이면 1인당 비용
    if (people > 1) {
      var perPersonDisplay = fmtMoney(r.perPerson, currency);
      if (perPersonDisplay == null) perPersonDisplay = totalDisplay;
      if (perPersonEl) perPersonEl.textContent = perPersonDisplay;
      if (perPersonCell) {
        perPersonCell.hidden = false;
        perPersonCell.setAttribute("data-copy", perPersonDisplay);
      }
    } else if (perPersonCell) {
      perPersonCell.hidden = true;
    }

    // 복사 버튼: 요약 문구
    var summary = fmt(t("tool.copyMsg"), { total: totalDisplay, fuel: litersLabel });
    if (copyBtn) copyBtn.setAttribute("data-copy", summary);

    msgEl.hidden = true;
    outEl.hidden = false;
  }

  /* ---- 복사 (Clipboard API → execCommand 폴백 → 실패 안내) ---- */
  function showStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.hidden = false;
    clearTimeout(showStatus._t);
    showStatus._t = setTimeout(function () {
      if (statusEl) { statusEl.hidden = true; statusEl.textContent = ""; }
    }, 1600);
  }
  function copyFallback(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      showStatus(ok ? t("tool.copied") : t("tool.copyFail"));
    } catch (e) { showStatus(t("tool.copyFail")); }
  }
  function copyText(text) {
    if (text == null || text === "") return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { showStatus(t("tool.copied")); },
        function () { copyFallback(text); }
      );
    } else {
      copyFallback(text);
    }
  }

  /* ---- 이벤트 ---- */
  function onNumInput() { render(); }
  // 단위를 직접 바꾸면 예시(placeholder)도 그 단위로 따라간다
  function onPrefChange() { savePrefs(); renderPlaceholders(); render(); }

  if (distEl) distEl.addEventListener("input", onNumInput);
  if (effEl) effEl.addEventListener("input", onNumInput);
  if (priceEl) priceEl.addEventListener("input", onNumInput);
  if (peopleEl) peopleEl.addEventListener("input", onNumInput);

  if (distUnitEl) distUnitEl.addEventListener("change", onPrefChange);
  if (effUnitEl) effUnitEl.addEventListener("change", onPrefChange);
  if (priceUnitEl) priceUnitEl.addEventListener("change", onPrefChange);
  if (roundTripEl) roundTripEl.addEventListener("change", onPrefChange);

  if (countryEl) {
    countryEl.addEventListener("change", function () {
      var code = normCountry(countryEl.value);
      if (!code) { countryEl.value = current; return; }  // 알 수 없는 값 → 되돌리기
      current = code;
      saveCountry(code);
      applyCountry(code);   // 거리·연비·유가 단위가 한 번에 그 나라 기준으로
      savePrefs();
      renderNote();
      renderCurBadge();
      renderPlaceholders();
      render();
    });
  }

  function stepPeople(delta) {
    if (!peopleEl) return;
    var cur = parseNum(peopleEl.value);
    if (isNaN(cur)) cur = (delta > 0) ? 0 : 2;
    var next = Math.max(1, Math.floor(cur) + delta);
    peopleEl.value = String(next);
    render();
  }
  if (minusBtn) minusBtn.addEventListener("click", function () { stepPeople(-1); });
  if (plusBtn) plusBtn.addEventListener("click", function () { stepPeople(1); });

  // 결과 영역의 복사 대상은 위임 처리 (data-copy)
  if (resultEl) {
    resultEl.addEventListener("click", function (ev) {
      var el = ev.target;
      while (el && el !== resultEl) {
        if (el.getAttribute && el.getAttribute("data-copy") != null && el.getAttribute("data-copy") !== "") {
          copyText(el.getAttribute("data-copy"));
          return;
        }
        el = el.parentNode;
      }
    });
    resultEl.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      var el = ev.target;
      if (el && el.getAttribute && el.getAttribute("data-copy") != null && el.getAttribute("data-copy") !== "") {
        ev.preventDefault();
        copyText(el.getAttribute("data-copy"));
      }
    });
  }

  // 언어 전환 시 국가명·통화·예시·결과 전부 그 언어로 다시 그린다
  document.addEventListener("i18n:change", function () {
    fillCountrySelect();
    renderNote();
    renderCurBadge();
    renderPlaceholders();
    render();
  });

  /* ---- 초기화 ----
     국가 추정(URL → 저장값 → 브라우저 지역 → 브라우저 언어 → US) → 그 나라 단위를 깔고
     → 같은 나라에서 사용자가 직접 바꿨던 단위만 덮어쓴다. */
  current = detectCountry(
    urlCountry(), storedCountry(),
    navigator.languages || [navigator.language || ""]
  );
  applyCountry(current);
  restorePrefs();
  // 복원된 설정이 접힌 곳에 있으면 펼쳐서 보여준다 (숨은 상태로 결과가 달라지지 않게)
  if (moreEl && roundTripEl && roundTripEl.checked) moreEl.open = true;
  fillCountrySelect();
  renderNote();
  renderCurBadge();
  renderPlaceholders();
  render();
  // TOOLJS:END
})();
