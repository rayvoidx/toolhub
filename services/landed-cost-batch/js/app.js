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
  /* landed-cost-batch — 다품목 수입 인보이스 → 품목별 착지원가
     spec: factory/state/landed-cost-batch.yaml

     설계 원칙
     - pure-static: 서버·DB·외부 API 0. 인보이스 원본은 세션 메모리에만 있고 저장하지 않는다.
       (privacy.html 의 "브라우저를 떠나지 않음" 약속 = 이 도구의 채택 조건)
     - 국가 상수(과세기준·세율·MPF/HMF)는 연 1회 갱신 정적값. 실시간성 있는 값
       (품목별 관세율·고시환율)은 조회하지 않고 사용자 입력으로 받는다 — 조회를 넣는 순간
       DB 서비스가 되어 아키타입을 이탈한다. 세율 필드도 편집 가능 → 상수가 낡아도 사용자가 덮어쓴다.
     - 조용한 실패 금지: 안분 불가·관세율 미입력·수량 0·더러운 행은 전부 명시 표기.

     저장 (localStorage, prefix "landed-cost-batch:")
       :costs   공통비 항목·안분기준·과세여부   :ship  국가·통화·환율·운송모드·세율 등 프리셋
       :map     컬럼 매핑(헤더 시그니처 일치 시에만 복원)
       품목 행은 저장하지 않는다.  URL ?country= 로 국가 지정 가능.

     CSV 파서·컬럼 매퍼는 이 파일 안에서 자립 구현했다. invoice-recon·ar-aging 이
     js/csv-table.js 로 재사용하려면 아래 "PURE" 블록만 그대로 들어내면 된다
     (별도 파일 분리는 셸의 script 태그 추가 = 템플릿 계약 밖이라 빌더가 임의로 하지 않음). */

  /* ============================================================
     PURE — DOM 무관. 이 블록만 떼어내면 js/csv-table.js 가 된다.
     ============================================================ */

  var MPF_RATE = 0.003464;   // US Merchandise Processing Fee — 물품가(FOB) 기준
  var MPF_MIN = 33.58;       // FY2026 하한 (CBP user fee 고시)
  var MPF_MAX = 651.50;      // FY2026 상한 — 건당
  var MPF_MANUAL = 4.03;     // 수기(종이) 신고 가산 — 상·하한과 별개로 가산
  var HMF_RATE = 0.00125;    // US Harbor Maintenance Fee — 해상만. 항공·트럭·철도 면제
  var MAX_ROWS = 10000;      // 인보이스 규모를 벗어나는 입력의 상한
  var BIG_ROWS = 1000;       // 이 이상이면 청크 처리 + 진행률·취소
  var BIG_FILE = 5 * 1024 * 1024;
  var TABLE_CAP = 200;       // 화면 표 최대 행 (전량은 CSV 다운로드로)
  var CHUNK = 500;

  /* 국가 상수 — basis: 과세기준(CIF=운임·보험 포함, FOB=물품가만)
     tax: 세금 스택 분기  vat: 표준세율 기본값(사용자가 덮어쓸 수 있음) */
  var COUNTRIES = {
    KR: { cur: "KRW", basis: "CIF", tax: "kr", vat: 10,   name: "South Korea" },
    JP: { cur: "JPY", basis: "CIF", tax: "jp", vat: 10,   name: "Japan" },
    US: { cur: "USD", basis: "FOB", tax: "us", vat: 0,    name: "United States" },
    AT: { cur: "EUR", basis: "CIF", tax: "eu", vat: 20,   name: "Austria" },
    BE: { cur: "EUR", basis: "CIF", tax: "eu", vat: 21,   name: "Belgium" },
    BG: { cur: "EUR", basis: "CIF", tax: "eu", vat: 20,   name: "Bulgaria" },
    HR: { cur: "EUR", basis: "CIF", tax: "eu", vat: 25,   name: "Croatia" },
    CY: { cur: "EUR", basis: "CIF", tax: "eu", vat: 19,   name: "Cyprus" },
    CZ: { cur: "CZK", basis: "CIF", tax: "eu", vat: 21,   name: "Czechia" },
    DK: { cur: "DKK", basis: "CIF", tax: "eu", vat: 25,   name: "Denmark" },
    EE: { cur: "EUR", basis: "CIF", tax: "eu", vat: 24,   name: "Estonia" },
    FI: { cur: "EUR", basis: "CIF", tax: "eu", vat: 25.5, name: "Finland" },
    FR: { cur: "EUR", basis: "CIF", tax: "eu", vat: 20,   name: "France" },
    DE: { cur: "EUR", basis: "CIF", tax: "eu", vat: 19,   name: "Germany" },
    GR: { cur: "EUR", basis: "CIF", tax: "eu", vat: 24,   name: "Greece" },
    HU: { cur: "HUF", basis: "CIF", tax: "eu", vat: 27,   name: "Hungary" },
    IE: { cur: "EUR", basis: "CIF", tax: "eu", vat: 23,   name: "Ireland" },
    IT: { cur: "EUR", basis: "CIF", tax: "eu", vat: 22,   name: "Italy" },
    LV: { cur: "EUR", basis: "CIF", tax: "eu", vat: 21,   name: "Latvia" },
    LT: { cur: "EUR", basis: "CIF", tax: "eu", vat: 21,   name: "Lithuania" },
    LU: { cur: "EUR", basis: "CIF", tax: "eu", vat: 17,   name: "Luxembourg" },
    MT: { cur: "EUR", basis: "CIF", tax: "eu", vat: 18,   name: "Malta" },
    NL: { cur: "EUR", basis: "CIF", tax: "eu", vat: 21,   name: "Netherlands" },
    PL: { cur: "PLN", basis: "CIF", tax: "eu", vat: 23,   name: "Poland" },
    PT: { cur: "EUR", basis: "CIF", tax: "eu", vat: 23,   name: "Portugal" },
    RO: { cur: "RON", basis: "CIF", tax: "eu", vat: 21,   name: "Romania" },
    SK: { cur: "EUR", basis: "CIF", tax: "eu", vat: 23,   name: "Slovakia" },
    SI: { cur: "EUR", basis: "CIF", tax: "eu", vat: 22,   name: "Slovenia" },
    ES: { cur: "EUR", basis: "CIF", tax: "eu", vat: 21,   name: "Spain" },
    SE: { cur: "SEK", basis: "CIF", tax: "eu", vat: 25,   name: "Sweden" }
  };
  // 인보이스 통화 후보 (수입 결제에 실제로 쓰이는 통화 위주)
  var CURRENCIES = ["USD", "EUR", "JPY", "CNY", "KRW", "GBP", "HKD", "TWD", "SGD", "VND",
    "THB", "INR", "IDR", "MYR", "PHP", "AUD", "CAD", "CHF", "TRY", "AED",
    "PLN", "SEK", "DKK", "CZK", "HUF", "RON", "BRL", "MXN"];
  // 언어만 아는 경우의 수입국 추정 (지원 세금 스택 4종 안에서만)
  var LANG_COUNTRY = { ko: "KR", ja: "JP", de: "DE", fr: "FR", es: "ES", pt: "PT", en: "US" };
  var DEFAULT_COUNTRY = "US";
  var BASES = ["value", "weight", "cbm", "qty"];
  var PRESETS = [
    { key: "freight",   basis: "cbm",    dutiable: true },
    { key: "insurance", basis: "value",  dutiable: true },
    { key: "thc",       basis: "weight", dutiable: true },
    { key: "clearance", basis: "value",  dutiable: false },
    { key: "inland",    basis: "weight", dutiable: false }
  ];

  /** 표시 문자열 → 숫자. 천단위 콤마·통화기호·% 제거, "1.234,56"(EU 표기)도 인식.
      숫자가 아니면 NaN — 0 으로 뭉개지 않는다(호출부가 '제외'로 명시 처리). */
  function parseNum(s) {
    if (s == null) return NaN;
    var t = String(s).trim();
    if (!t) return NaN;
    t = t.replace(/[%\s\u00a0\u2009]/g, "").replace(/[$€£¥₩₫฿₹]/g, "");
    var hasC = t.indexOf(",") >= 0, hasD = t.indexOf(".") >= 0;
    if (hasC && hasD) {
      // 마지막에 오는 기호가 소수점이다: "1.234,56"(EU) vs "1,234.56"(US)
      if (t.lastIndexOf(",") > t.lastIndexOf(".")) t = t.replace(/\./g, "").replace(",", ".");
      else t = t.replace(/,/g, "");
    } else if (hasC) {
      var p = t.split(",");
      // "1,234" / "1,234,567" 은 천단위, "12,5" 는 소수 — 3자리 그룹이면 천단위로 본다
      if (p.length > 2 || (p[1] && p[1].length === 3)) t = t.replace(/,/g, "");
      else t = t.replace(",", ".");
    }
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
    return parseFloat(t);
  }

  /** 반올림 (부동소수 경계 보정). 통화 소수 자릿수는 Intl 이 결정 — 하드코딩 없음. */
  function roundTo(v, d) {
    if (!isFinite(v)) return 0;
    var f = Math.pow(10, d);
    return Math.round(v * f * (1 + Number.EPSILON)) / f;
  }

  function currencyDecimals(cur) {
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency: cur })
        .resolvedOptions().maximumFractionDigits;
    } catch (e) { return 2; }
  }

  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function idxOfMax(a) {
    var m = -Infinity, k = 0;
    for (var i = 0; i < a.length; i++) { if (a[i] > m) { m = a[i]; k = i; } }
    return k;
  }

  /** 비례 안분 + 단수차 흡수.
      반올림 후 잔차(= 총액 − Σ안분액)를 최대 basis 항목에 몰아주고 그 사실을 반환한다
      (조용히 흡수 금지 — 호출부가 행 배지와 요약에 표기). basis 합이 0이면 null = 안분 불가. */
  function apportion(total, weights, dec) {
    var s = sum(weights);
    if (!(s > 0)) return null;
    var target = roundTo(total, dec);
    var parts = [], i;
    for (i = 0; i < weights.length; i++) parts.push(roundTo(total * (weights[i] / s), dec));
    var residual = roundTo(target - sum(parts), dec);
    var at = idxOfMax(weights);
    if (residual !== 0) parts[at] = roundTo(parts[at] + residual, dec);
    return { parts: parts, residual: residual, at: at };
  }

  /** RFC4180 계열 구분자 파서 — 따옴표 안의 구분자/개행/이스케이프("")를 보존한다. */
  function parseDelimited(text, delim) {
    var rows = [], row = [], field = "", inQ = false, i = 0;
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM
    var n = text.length;
    while (i < n) {
      var ch = text.charAt(i);
      if (inQ) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQ = true; i++; continue; }
      if (ch === delim) { row.push(field); field = ""; i++; continue; }
      if (ch === "\r" || ch === "\n") {
        if (ch === "\r" && text.charAt(i + 1) === "\n") i++;
        row.push(field); rows.push(row); row = []; field = ""; i++; continue;
      }
      field += ch; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /** 구분자 자동 감지: 후보별로 실제 파싱해 열 수 일관성 × 열 수 가 최대인 것. */
  function detectDelim(text) {
    var cands = ["\t", ",", ";", "|"], best = ",", bestScore = -1;
    var sample = text.slice(0, 65536);
    for (var c = 0; c < cands.length; c++) {
      var rows = parseDelimited(sample, cands[c]).slice(0, 20).filter(function (r) {
        return r.length > 1 || (r.length === 1 && r[0] !== "");
      });
      if (!rows.length) continue;
      var counts = {}, i, best2 = 0, mode = 0;
      for (i = 0; i < rows.length; i++) {
        var L = rows[i].length;
        counts[L] = (counts[L] || 0) + 1;
        if (counts[L] > best2) { best2 = counts[L]; mode = L; }
      }
      if (mode < 2) continue;
      var score = mode * (best2 / rows.length);
      if (score > bestScore) { bestScore = score; best = cands[c]; }
    }
    return best;
  }

  /* 컬럼 후보 패턴 — 우선순위 순(구체적인 것 먼저). "Unit Price" 가 qty 의 /units?/ 에
     먼저 걸리지 않도록 price 를 qty 보다 앞에 둔다. 사용자의 엑셀 헤더 언어를 알 수 없으므로
     지원 14개 언어 + 주요 무역 언어의 관용 표기를 함께 받는다.
     (\b 는 ASCII 기준이라 비라틴 문자에는 쓰지 않는다 — 그쪽은 원형 그대로 나열한다.) */
  var COLDEFS = [
    { key: "hs",     re: /(\bhs\b|\bhts\b|세번|관세\s*번호|품목\s*번호|品目番号|税番|海关编码|hs코드|tariff\s*(code|no)|commodity\s*code|zolltarif|code\s*sh|тн\s*вэд)/i },
    { key: "duty",   re: /(관세율|관\s*세|세\s*율|関税率|关税率|duty|tariff\s*rate|zollsatz|arancel|droit|taxa\s*aduaneira|пошлин|शुल्क|শুল্ক|رسوم|ڈیوٹی|\bbea\b)/i },
    { key: "cbm",    re: /(cbm|부\s*피|체\s*적|용\s*적|容積|体积|volume|volumen|m3|m³|meas|\bvol\b|объ[её]м)/i },
    { key: "weight", re: /(중\s*량|무\s*게|重量|weight|\bkgs?\b|gross|\bg\.?w\.?\b|gewicht|peso|poids|berat|вес|वज़न|वजन|ওজন|وزن|\bкг\b)/i },
    { key: "price",  re: /(단\s*가|단위\s*가격|unit\s*(price|cost)|\bprice\b|\bcost\b|単価|单价|preis|precio|pre[çc]o|prix|harga|цена|मूल्य|মূল্য|سعر|قیمت)/i },
    { key: "qty",    re: /(수\s*량|개\s*수|数量|q'?ty|quantity|\bpcs\b|\bpieces\b|\bunits?\b|menge|cantidad|quantit|jumlah|кол-?во|количество|मात्रा|পরিমাণ|كمية|مقدار)/i },
    { key: "name",   re: /(품\s*명|품\s*목|제\s*품|상\s*품|명\s*칭|品名|品目|商品|货物|貨物|item|desc|product|goods|article|artikel|producto|artículo|produit|designation|товар|наименование|वस्तु|পণ্য|صنف|آئٹم|barang)/i }
  ];
  var COLKEYS = ["name", "hs", "qty", "price", "weight", "cbm", "duty"];

  /** 첫 행이 헤더인가: 컬럼 패턴에 2개 이상 걸리거나, 1행은 숫자가 거의 없는데 2행은 숫자가 많으면 헤더. */
  function looksLikeHeader(table) {
    if (!table.length) return false;
    var r0 = table[0], hits = 0, i, d;
    for (i = 0; i < r0.length; i++) {
      for (d = 0; d < COLDEFS.length; d++) {
        if (COLDEFS[d].re.test(String(r0[i]))) { hits++; break; }
      }
    }
    if (hits >= 2) return true;
    if (table.length < 2) return false;
    function numCount(r) {
      var c = 0;
      for (var j = 0; j < r.length; j++) if (isFinite(parseNum(r[j]))) c++;
      return c;
    }
    return numCount(r0) <= 1 && numCount(table[1]) >= 2;
  }

  /** 헤더 → 컬럼 매핑 자동 추정. 헤더가 없으면 스펙의 열 순서대로 위치 매핑. */
  function autoMap(table, hasHeader) {
    var map = { name: null, hs: null, qty: null, price: null, weight: null, cbm: null, duty: null };
    if (!table.length) return map;
    var width = 0, i;
    for (i = 0; i < Math.min(table.length, 20); i++) width = Math.max(width, table[i].length);
    if (!hasHeader) {
      for (i = 0; i < COLKEYS.length && i < width; i++) map[COLKEYS[i]] = i;
      return map;
    }
    var head = table[0], taken = {};
    for (var d = 0; d < COLDEFS.length; d++) {
      for (i = 0; i < head.length; i++) {
        if (taken[i]) continue;
        if (COLDEFS[d].re.test(String(head[i]))) { map[COLDEFS[d].key] = i; taken[i] = 1; break; }
      }
    }
    if (map.name == null) {
      for (i = 0; i < width; i++) { if (!taken[i]) { map.name = i; taken[i] = 1; break; } }
    }
    return map;
  }

  function cellOf(row, idx) {
    if (idx == null || idx < 0 || !row) return "";
    var v = row[idx];
    return v == null ? "" : String(v).trim();
  }

  /** 한 행 정규화. 더러운 행은 버리지 않고 사유와 함께 excluded 로 넘긴다(철칙 5). */
  function normalizeOne(row, line, map, out, excluded) {
    var name = cellOf(row, map.name), hs = cellOf(row, map.hs);
    var qs = cellOf(row, map.qty), ps = cellOf(row, map.price);
    var ws = cellOf(row, map.weight), cs = cellOf(row, map.cbm), ds = cellOf(row, map.duty);
    var raw = (row || []).join(" | ");
    if (raw.replace(/\|/g, "").trim() === "") { excluded.push({ line: line, reason: "blank", raw: raw }); return; }
    if (!name && !hs && !qs && !ps && !ws && !cs && !ds) { excluded.push({ line: line, reason: "blank", raw: raw }); return; }
    var qty = parseNum(qs), price = parseNum(ps);
    if (!isFinite(qty) || !isFinite(price)) { excluded.push({ line: line, reason: "nan", raw: raw }); return; }
    if (qty < 0 || price < 0) { excluded.push({ line: line, reason: "negative", raw: raw }); return; }
    var weight = ws === "" ? 0 : parseNum(ws);
    var cbm = cs === "" ? 0 : parseNum(cs);
    if (!isFinite(weight) || !isFinite(cbm)) { excluded.push({ line: line, reason: "nan", raw: raw }); return; }
    if (weight < 0 || cbm < 0) { excluded.push({ line: line, reason: "negative", raw: raw }); return; }
    var duty = ds === "" ? null : parseNum(ds);
    if (duty != null && (!isFinite(duty) || duty < 0)) duty = null; // 0% 로 간주하지 않는다 → '미입력' 배지
    out.push({ line: line, name: name, hs: hs, qty: qty, price: price, weight: weight, cbm: cbm, duty: duty });
  }

  function normalizeRows(table, map, hasHeader) {
    var out = [], excluded = [], start = hasHeader ? 1 : 0;
    for (var i = start; i < table.length; i++) normalizeOne(table[i], i + 1, map, out, excluded);
    return { rows: out, excluded: excluded };
  }

  /**
   * 핵심 계산.
   * input = { rows, costs, country, fx, vatRate, mode, excise, includeVat, mpfManual }
   *   rows  : normalizeRows 의 결과 (qty>=0, price>=0, duty=null 이면 관세율 미입력)
   *   costs : [{ label, amount(인보이스 통화), basis, dutiable }] — 건 단위 공통비
   *   fx    : 인보이스 통화 1 단위당 정산(과세) 통화 — 0/미입력은 호출 전에 차단
   *   excise: 개별소비세(KR, 정산통화, 건 단위) — 세금이므로 환산하지 않는다
   * 반환 { ok, err, dec, cur, basis, items[], totals, roundingAdj, notes }
   */
  function computeLanded(input) {
    var C = COUNTRIES[input.country];
    if (!C) return { ok: false, err: "country" };
    var dec = currencyDecimals(C.cur);
    var rows = input.rows, n = rows.length, i;
    if (!n) return { ok: false, err: "norows" };
    if (!(input.fx > 0)) return { ok: false, err: "fx" };

    // 1. 물품가 (인보이스 통화 → 정산통화)
    var goods = [];
    for (i = 0; i < n; i++) goods.push(roundTo(rows[i].qty * rows[i].price * input.fx, dec));

    // 2. 안분 — 기준은 공통비 항목별로 각각
    var basisVals = { value: goods.slice(), weight: [], cbm: [], qty: [] };
    for (i = 0; i < n; i++) {
      basisVals.weight.push(rows[i].weight);
      basisVals.cbm.push(rows[i].cbm);
      basisVals.qty.push(rows[i].qty);
    }
    var alloc = [], allocDutiable = [], residualBy = [];
    for (i = 0; i < n; i++) { alloc.push(0); allocDutiable.push(0); residualBy.push(0); }

    var roundingAdj = 0, costLines = [], zeroBasis = [], partialBasis = [];
    for (var c = 0; c < input.costs.length; c++) {
      var cost = input.costs[c];
      var amt = cost.amount;
      if (!isFinite(amt) || amt <= 0) continue; // 금액 0 = 비용 없음 (오류 아님)
      var w = basisVals[cost.basis];
      if (!w) continue;
      if (!(sum(w) > 0)) { zeroBasis.push({ label: cost.label, basis: cost.basis }); continue; }
      var a = apportion(amt * input.fx, w, dec);
      // US 는 FOB — 어떤 공통비도 과세가격에 들어갈 수 없다 (체크박스는 UI 에서 강제 비활성)
      var dutiable = (C.basis === "CIF") && !!cost.dutiable;
      var zeros = 0;
      for (i = 0; i < n; i++) {
        alloc[i] = roundTo(alloc[i] + a.parts[i], dec);
        if (dutiable) allocDutiable[i] = roundTo(allocDutiable[i] + a.parts[i], dec);
        if (!(w[i] > 0)) zeros++;
      }
      if (zeros > 0) partialBasis.push({ label: cost.label, basis: cost.basis, rows: zeros });
      if (a.residual) { roundingAdj = roundTo(roundingAdj + a.residual, dec); residualBy[a.at] = roundTo(residualBy[a.at] + a.residual, dec); }
      costLines.push({ label: cost.label, basis: cost.basis, dutiable: dutiable, amount: roundTo(amt * input.fx, dec) });
    }
    if (zeroBasis.length) return { ok: false, err: "basis", zeroBasis: zeroBasis };

    // 3. 과세가격 — CIF(KR/JP/EU): 물품가 + 과세대상 공통비 안분액 / FOB(US): 물품가만
    var cv = [];
    for (i = 0; i < n; i++) cv.push(C.basis === "CIF" ? roundTo(goods[i] + allocDutiable[i], dec) : goods[i]);

    // 4. 개별소비세 (KR, 건 단위 입력 → 과세가격 비율로 안분). 부가세 과세표준에 들어간다.
    var excise = [], exciseSkipped = false;
    for (i = 0; i < n; i++) excise.push(0);
    if (C.tax === "kr" && input.excise > 0) {
      var ea = apportion(input.excise, cv, dec);
      if (ea) {
        excise = ea.parts;
        if (ea.residual) { roundingAdj = roundTo(roundingAdj + ea.residual, dec); residualBy[ea.at] = roundTo(residualBy[ea.at] + ea.residual, dec); }
      } else { exciseSkipped = true; } // 과세가격 합계가 0 → 안분 불가
    }

    // 5. 관세 — 관세율 미입력 행은 0% 로 간주하지 않고 null 로 남긴다
    var duty = [], noDuty = 0;
    for (i = 0; i < n; i++) {
      if (rows[i].duty == null) { duty.push(null); noDuty++; }
      else duty.push(roundTo(cv[i] * rows[i].duty / 100, dec));
    }

    // 6. 세금 스택 분기. 관세를 모르면 부가세 과세표준도 모른다 → null 전파
    var vat = [], rate = input.vatRate;
    for (i = 0; i < n; i++) {
      if (C.tax === "us" || !(rate > 0) || duty[i] == null) { vat.push(null); continue; }
      // KR 은 캐스케이드: 과세표준 = 과세가격 + 관세 + 개별소비세
      var base = cv[i] + duty[i] + (C.tax === "kr" ? excise[i] : 0);
      vat.push(roundTo(base * rate / 100, dec));
    }

    // 7. US 건 단위 수수료 — 물품가(FOB) 기준으로 산출 후 과세가격 비율로 품목 안분
    var mpf = [], hmf = [], mpfTotal = 0, hmfTotal = 0, mpfFlag = null, hmfAir = false;
    for (i = 0; i < n; i++) { mpf.push(0); hmf.push(0); }
    if (C.tax === "us") {
      var goodsSum = sum(goods);
      var mpfRaw = goodsSum * MPF_RATE;
      mpfTotal = mpfRaw;
      if (mpfRaw < MPF_MIN) { mpfTotal = MPF_MIN; mpfFlag = "min"; }
      else if (mpfRaw > MPF_MAX) { mpfTotal = MPF_MAX; mpfFlag = "max"; }
      if (input.mpfManual) mpfTotal += MPF_MANUAL; // 가산은 상·하한 밖
      mpfTotal = roundTo(mpfTotal, dec);
      hmfAir = input.mode !== "sea";
      hmfTotal = hmfAir ? 0 : roundTo(goodsSum * HMF_RATE, dec); // 해상만 — 항공·트럭·철도 면제
      var ma = apportion(mpfTotal, cv, dec);
      if (ma) {
        mpf = ma.parts;
        if (ma.residual) { roundingAdj = roundTo(roundingAdj + ma.residual, dec); residualBy[ma.at] = roundTo(residualBy[ma.at] + ma.residual, dec); }
      } else { mpfTotal = 0; }
      if (hmfTotal > 0) {
        var ha = apportion(hmfTotal, cv, dec);
        if (ha) {
          hmf = ha.parts;
          if (ha.residual) { roundingAdj = roundTo(roundingAdj + ha.residual, dec); residualBy[ha.at] = roundTo(residualBy[ha.at] + ha.residual, dec); }
        } else { hmfTotal = 0; }
      }
    }

    // 8. 착지원가 — 부가세는 기본 제외(매입세액 공제 대상 = 원가 아님). 관세 미상 행은 산출 불가.
    var items = [], landedSum = 0, dutySum = 0, vatSum = 0;
    for (i = 0; i < n; i++) {
      var landed = null, unit = null;
      if (duty[i] != null) {
        landed = roundTo(goods[i] + alloc[i] + duty[i] + excise[i] + mpf[i] + hmf[i] +
          (input.includeVat && vat[i] != null ? vat[i] : 0), dec);
        landedSum = roundTo(landedSum + landed, dec);
        dutySum = roundTo(dutySum + duty[i], dec);
        if (vat[i] != null) vatSum = roundTo(vatSum + vat[i], dec);
        if (rows[i].qty > 0) unit = landed / rows[i].qty; // 수량 0 → 나눗셈 금지, null 로 표기
      }
      items.push({
        line: rows[i].line, name: rows[i].name, hs: rows[i].hs, qty: rows[i].qty,
        goods: goods[i], alloc: alloc[i], allocDutiable: allocDutiable[i], cv: cv[i],
        dutyRate: rows[i].duty, duty: duty[i], excise: excise[i], vat: vat[i],
        mpf: mpf[i], hmf: hmf[i], fees: roundTo(mpf[i] + hmf[i], dec),
        landed: landed, unit: unit, residual: residualBy[i]
      });
    }

    return {
      ok: true, dec: dec, cur: C.cur, basis: C.basis, tax: C.tax, items: items,
      totals: {
        rows: n, goods: roundTo(sum(goods), dec), alloc: roundTo(sum(alloc), dec),
        cv: roundTo(sum(cv), dec), duty: dutySum, excise: roundTo(sum(excise), dec),
        vat: vatSum, mpf: mpfTotal, hmf: hmfTotal, landed: landedSum, noDuty: noDuty
      },
      roundingAdj: roundingAdj, costLines: costLines, partialBasis: partialBasis,
      mpfFlag: mpfFlag, hmfAir: hmfAir, exciseSkipped: exciseSkipped
    };
  }

  /** 배열 → CSV (RFC4180 인용). 엑셀 한글 깨짐 방지용 UTF-8 BOM 은 Blob 생성 시 붙인다. */
  function toCSV(rows) {
    return rows.map(function (r) {
      return r.map(function (v) {
        var s = v == null ? "" : String(v);
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(",");
    }).join("\r\n");
  }

  // node 단위 검증용 (브라우저에서는 module 이 없어 무시된다 — 게이트 QA 는 브라우저 실측)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseNum: parseNum, roundTo: roundTo, apportion: apportion, parseDelimited: parseDelimited,
      detectDelim: detectDelim, looksLikeHeader: looksLikeHeader, autoMap: autoMap,
      normalizeRows: normalizeRows, computeLanded: computeLanded, toCSV: toCSV,
      COUNTRIES: COUNTRIES, currencyDecimals: currencyDecimals
    };
  }

  /* ============================================================
     UI — 여기서부터 DOM. 도구 마크업이 없으면(테스트 등) 아무것도 하지 않는다.
     ============================================================ */
  var $ = function (id) { return document.getElementById(id); };
  if (typeof document === "undefined" || !$("lcb-paste")) return;

  var SLUG = (window.APP_CONFIG && window.APP_CONFIG.slug) || "landed-cost-batch";
  var K_COSTS = SLUG + ":costs", K_SHIP = SLUG + ":ship", K_MAP = SLUG + ":map";

  function t(key, vars) {
    var s = null;
    try { if (window.I18N) s = window.I18N.t(key); } catch (e) { /* noop */ }
    if (s == null) s = "";
    if (vars) for (var k in vars) if (vars.hasOwnProperty(k)) s = s.split("{" + k + "}").join(vars[k]);
    return s;
  }
  function lang() {
    try { return (window.I18N && window.I18N.lang()) || "en"; } catch (e) { return "en"; }
  }
  function load(key, fb) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fb; } catch (e) { return fb; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode */ }
  }
  function countryName(code) {
    try {
      var d = new Intl.DisplayNames([lang()], { type: "region" }).of(code);
      if (d) return d;
    } catch (e) { /* 구형 브라우저 */ }
    return COUNTRIES[code] ? COUNTRIES[code].name : code;
  }
  function currencyName(code) {
    try {
      var d = new Intl.DisplayNames([lang()], { type: "currency" }).of(code);
      if (d && d !== code) return code + " — " + d;
    } catch (e) { /* noop */ }
    return code;
  }
  function fmtMoney(v, cur, dec) {
    if (v == null) return "—";
    try {
      return new Intl.NumberFormat(lang(), {
        style: "currency", currency: cur, minimumFractionDigits: dec, maximumFractionDigits: dec
      }).format(v);
    } catch (e) { return cur + " " + v.toFixed(dec); }
  }
  function fmtNum(v, dec) {
    if (v == null) return "—";
    try { return new Intl.NumberFormat(lang(), { minimumFractionDigits: dec || 0, maximumFractionDigits: dec == null ? 3 : dec }).format(v); }
    catch (e) { return String(v); }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---- 상태 (인보이스 원본은 세션 메모리에만 — 저장하지 않는다) ---- */
  var table = [];        // 파싱된 2차원 배열
  var mapping = null;    // 컬럼 매핑
  var hasHeader = true;
  var lastBytes = null;  // 인코딩 재해석용 원본 바이트 (파일 입력일 때만)
  var lastEnc = "utf-8";
  var lastResult = null;
  var job = null;
  var tab = "items";

  var costs = load(K_COSTS, null);
  if (!costs || !costs.length) {
    costs = PRESETS.map(function (p) { return { key: p.key, label: "", amount: "", basis: p.basis, dutiable: p.dutiable }; });
  }
  var ship = load(K_SHIP, {}) || {};

  function detectCountry() {
    try {
      var q = new URLSearchParams(location.search).get("country");
      if (q && COUNTRIES[q.toUpperCase()]) return q.toUpperCase();
    } catch (e) { /* noop */ }
    if (ship.country && COUNTRIES[ship.country]) return ship.country;
    var navs = navigator.languages || [navigator.language || ""];
    for (var i = 0; i < navs.length; i++) {
      var parts = String(navs[i]).split("-");
      if (parts[1] && COUNTRIES[parts[1].toUpperCase()]) return parts[1].toUpperCase();
    }
    for (var j = 0; j < navs.length; j++) {
      var p = String(navs[j]).split("-")[0].toLowerCase();
      if (LANG_COUNTRY[p]) return LANG_COUNTRY[p];
    }
    return DEFAULT_COUNTRY;
  }

  /* ---- 셀렉트 채우기 ---- */
  var elCountry = $("lcb-country"), elCur = $("lcb-cur"), elFx = $("lcb-fx"),
    elMode = $("lcb-mode"), elVat = $("lcb-vat"), elExcise = $("lcb-excise"),
    elIncVat = $("lcb-incvat"), elMpfMan = $("lcb-mpfman"), elMsg = $("lcb-msg"),
    elOut = $("lcb-out"), elPaste = $("lcb-paste");

  function fillCountries() {
    var codes = Object.keys(COUNTRIES);
    var named = codes.map(function (c) { return { c: c, n: countryName(c) }; });
    try { named.sort(function (a, b) { return a.n.localeCompare(b.n, lang()); }); }
    catch (e) { named.sort(function (a, b) { return a.n < b.n ? -1 : 1; }); }
    var cur = elCountry.value;
    elCountry.innerHTML = "";
    named.forEach(function (o) {
      var op = document.createElement("option");
      op.value = o.c; op.textContent = o.n;
      elCountry.appendChild(op);
    });
    if (cur) elCountry.value = cur;
  }
  function fillCurrencies() {
    var cur = elCur.value;
    elCur.innerHTML = "";
    CURRENCIES.forEach(function (c) {
      var op = document.createElement("option");
      op.value = c; op.textContent = currencyName(c);
      elCur.appendChild(op);
    });
    if (cur) elCur.value = cur;
  }

  /* ---- 공통비 표 ---- */
  function costLabel(c) { return c.key ? t("tool.preset." + c.key) : (c.label || ""); }

  function renderCosts() {
    var C = COUNTRIES[elCountry.value] || COUNTRIES[DEFAULT_COUNTRY];
    var fob = C.basis === "FOB";
    var body = $("lcb-costs-body");
    body.innerHTML = "";
    costs.forEach(function (c, i) {
      var tr = document.createElement("tr");
      var opts = BASES.map(function (b) {
        return '<option value="' + b + '"' + (c.basis === b ? " selected" : "") + ">" + esc(t("tool.basis." + b)) + "</option>";
      }).join("");
      tr.innerHTML =
        '<td class="lcb-tl lcb-cell-lab"><input type="text" class="lcb-c-label" data-i="' + i + '" value="' + esc(costLabel(c)) + '"></td>' +
        '<td class="lcb-cell-amt"><input type="text" class="lcb-c-amt" inputmode="decimal" data-i="' + i + '" value="' + esc(c.amount) + '" placeholder="0"></td>' +
        '<td class="lcb-cell-basis"><select class="lcb-c-basis" data-i="' + i + '">' + opts + "</select></td>" +
        '<td><input type="checkbox" class="lcb-c-duty" data-i="' + i + '"' + (c.dutiable && !fob ? " checked" : "") +
        (fob ? ' disabled title="' + esc(t("tool.dutiable.fobOff")) + '"' : "") + "></td>" +
        '<td><button type="button" class="lcb-x" data-i="' + i + '" aria-label="' + esc(t("tool.costs.remove")) + '" title="' + esc(t("tool.costs.remove")) + '">&times;</button></td>';
      body.appendChild(tr);
    });
    $("lcb-costs-note").textContent = t("tool.costs.note", { cur: elCur.value, taxcur: C.cur });
  }

  function readCosts() {
    return costs.map(function (c) {
      return { label: costLabel(c), amount: parseNum(c.amount), basis: c.basis, dutiable: c.dutiable };
    });
  }

  /* ---- 컬럼 매핑 UI ---- */
  function headerSig() {
    if (!table.length) return "";
    return table[0].join("");
  }
  function renderMapping() {
    var wrap = $("lcb-map-wrap");
    if (!table.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    $("lcb-hasheader").checked = hasHeader;
    var width = 0, i;
    for (i = 0; i < Math.min(table.length, 20); i++) width = Math.max(width, table[i].length);
    var maps = $("lcb-maps");
    maps.innerHTML = "";
    COLKEYS.forEach(function (k) {
      var id = "lcb-map-" + k;
      var d = document.createElement("div");
      var req = (k === "qty" || k === "price") ? " *" : "";
      var sel = '<select id="' + id + '" class="lcb-mapsel" data-k="' + k + '"><option value="">' + esc(t("tool.map.none")) + "</option>";
      for (i = 0; i < width; i++) {
        var head = hasHeader ? cellOf(table[0], i) : "";
        var label = head || t("tool.map.col", { n: i + 1 });
        sel += '<option value="' + i + '"' + (mapping[k] === i ? " selected" : "") + ">" + esc(label) + "</option>";
      }
      sel += "</select>";
      d.innerHTML = '<label for="' + id + '">' + esc(t("tool.col." + k)) + req + "</label>" + sel;
      maps.appendChild(d);
    });
    // 미리보기 (첫 5행)
    var start = hasHeader ? 1 : 0;
    var prev = $("lcb-preview"), html = "<thead><tr>";
    for (i = 0; i < width; i++) {
      var h = hasHeader ? cellOf(table[0], i) : t("tool.map.col", { n: i + 1 });
      html += '<th class="lcb-tl">' + esc(h) + "</th>";
    }
    html += "</tr></thead><tbody>";
    for (i = start; i < Math.min(start + 5, table.length); i++) {
      html += "<tr>";
      for (var j = 0; j < width; j++) html += '<td class="lcb-tl">' + esc(cellOf(table[i], j)) + "</td>";
      html += "</tr>";
    }
    html += "</tbody>";
    prev.innerHTML = html;
  }

  /* ---- 입력 수집 → 계산 ---- */
  function setMsg(text, isErr) {
    elMsg.textContent = text;
    elMsg.className = "lcb-msg" + (isErr ? " is-err" : "");
    elMsg.hidden = false;
    elOut.hidden = true;
    lastResult = null;
  }

  function runCalc() {
    if (job) { job.cancelled = true; job = null; }
    $("lcb-progress").hidden = true;
    if (!table.length) { setMsg(t("tool.n.empty")); return; }
    if (mapping.qty == null || mapping.price == null) { setMsg(t("tool.n.cols"), true); return; }
    var fx = parseNum(elFx.value);
    if (!isFinite(fx) || fx <= 0) { setMsg(t("tool.n.fx"), true); return; }

    var rowCount = table.length - (hasHeader ? 1 : 0);
    if (rowCount > BIG_ROWS) {
      var j = { cancelled: false };
      job = j;
      $("lcb-progress").hidden = false;
      $("lcb-bar").value = 0;
      $("lcb-progress-text").textContent = t("tool.parsing", { n: fmtNum(rowCount, 0) });
      normalizeAsync(j, function (res) {
        if (j.cancelled) return;
        job = null;
        $("lcb-progress").hidden = true;
        finish(res, fx);
      });
      return;
    }
    finish(normalizeRows(table.slice(0, MAX_ROWS + (hasHeader ? 1 : 0)), mapping, hasHeader), fx);
  }

  function normalizeAsync(j, done) {
    var out = [], excluded = [], start = hasHeader ? 1 : 0;
    var end = Math.min(table.length, MAX_ROWS + start);
    var i = start;
    function step() {
      if (j.cancelled) return;
      var stop = Math.min(i + CHUNK, end);
      for (; i < stop; i++) normalizeOne(table[i], i + 1, mapping, out, excluded);
      if (i < end) {
        $("lcb-bar").value = Math.round(((i - start) / Math.max(1, end - start)) * 100);
        setTimeout(step, 0);
      } else { done({ rows: out, excluded: excluded }); }
    }
    setTimeout(step, 0);
  }

  function finish(norm, fx) {
    var country = elCountry.value, C = COUNTRIES[country];
    var res = computeLanded({
      rows: norm.rows, costs: readCosts(), country: country, fx: fx,
      vatRate: C.tax === "us" ? 0 : parseNum(elVat.value) || 0,
      mode: elMode.value, excise: C.tax === "kr" ? (parseNum(elExcise.value) || 0) : 0,
      includeVat: elIncVat.checked, mpfManual: C.tax === "us" && elMpfMan.checked
    });
    if (!res.ok) {
      if (res.err === "basis") { renderBasisError(res.zeroBasis); return; }
      if (res.err === "norows") {
        if (norm.excluded.length) { renderAllExcluded(norm.excluded); return; }
        setMsg(t("tool.n.empty")); return;
      }
      if (res.err === "fx") { setMsg(t("tool.n.fx"), true); return; }
      setMsg(t("tool.n.empty"), true); return;
    }
    res.excluded = norm.excluded;
    res.truncated = (table.length - (hasHeader ? 1 : 0)) > MAX_ROWS;
    lastResult = res;
    render(res);
  }

  /* ---- 결과 렌더 ---- */
  function renderBasisError(zero) {
    elOut.hidden = true;
    elMsg.hidden = false;
    elMsg.className = "lcb-msg is-err";
    lastResult = null;
    var z = zero[0];
    elMsg.textContent = t("tool.warn.basisZero", { label: z.label, basis: t("tool.basis." + z.basis) });
    // 대체 기준 버튼 — 균등배분으로 조용히 대체하지 않는다
    var fix = document.createElement("div");
    fix.className = "lcb-fixrow";
    BASES.forEach(function (b) {
      if (b === z.basis) return;
      var btn = document.createElement("button");
      btn.type = "button"; btn.className = "lcb-fix";
      btn.textContent = t("tool.warn.basisFix", { basis: t("tool.basis." + b) });
      btn.addEventListener("click", function () {
        costs.forEach(function (c) { if (costLabel(c) === z.label && c.basis === z.basis) c.basis = b; });
        save(K_COSTS, costs); renderCosts(); runCalc();
      });
      fix.appendChild(btn);
    });
    elMsg.appendChild(fix);
  }

  function renderAllExcluded(excluded) {
    elOut.hidden = true;
    elMsg.hidden = false;
    elMsg.className = "lcb-msg is-err";
    lastResult = null;
    elMsg.textContent = t("tool.n.allExcluded", { n: fmtNum(excluded.length, 0) }) + " " + excludedSummary(excluded);
  }

  function excludedSummary(excluded) {
    var by = { nan: 0, negative: 0, blank: 0 };
    excluded.forEach(function (e) { by[e.reason] = (by[e.reason] || 0) + 1; });
    var out = [];
    ["nan", "negative", "blank"].forEach(function (r) {
      if (by[r]) out.push(t("tool.exc." + r) + ": " + fmtNum(by[r], 0));
    });
    return out.join(" · ");
  }

  function cols(res) {
    var C = COUNTRIES[elCountry.value];
    var list = [
      { k: "name", th: "tool.th.name", tl: true },
      { k: "qty", th: "tool.th.qty" },
      { k: "goods", th: "tool.th.goods", money: true },
      { k: "alloc", th: "tool.th.alloc", money: true },
      { k: "cv", th: "tool.th.cv", money: true },
      { k: "duty", th: "tool.th.duty", money: true }
    ];
    if (C.tax === "kr" && res.totals.excise > 0) list.push({ k: "excise", th: "tool.th.excise", money: true });
    if (C.tax === "us") list.push({ k: "fees", th: "tool.th.fees", money: true });
    else list.push({ k: "vat", th: "tool.th.vat", money: true });
    list.push({ k: "landed", th: "tool.th.landed", money: true });
    list.push({ k: "unit", th: "tool.th.unit", unit: true });
    return list;
  }

  function render(res) {
    var cur = res.cur, dec = res.dec, C = COUNTRIES[elCountry.value];
    elMsg.hidden = true;
    elOut.hidden = false;
    $("lcb-total").textContent = fmtMoney(res.totals.landed, cur, dec);
    $("lcb-total-sub").textContent = t("tool.res.sub", {
      n: fmtNum(res.totals.rows, 0), country: countryName(elCountry.value), basis: res.basis
    });

    // 경고 블록
    var warn = $("lcb-warn");
    warn.innerHTML = "";
    var lines = [];
    if (res.totals.noDuty) lines.push(t("tool.warn.noDuty", { n: fmtNum(res.totals.noDuty, 0) }));
    if (res.roundingAdj) lines.push(t("tool.warn.rounding", { amt: fmtMoney(res.roundingAdj, cur, dec) }));
    res.partialBasis.forEach(function (p) {
      lines.push(t("tool.warn.partialBasis", { n: fmtNum(p.rows, 0), basis: t("tool.basis." + p.basis), label: p.label }));
    });
    if (res.exciseSkipped) lines.push(t("tool.warn.exciseSkip"));
    if (res.mpfFlag === "min") lines.push(t("tool.note.mpfMin", { amt: fmtMoney(MPF_MIN, "USD", 2) }));
    if (res.mpfFlag === "max") lines.push(t("tool.note.mpfMax", { amt: fmtMoney(MPF_MAX, "USD", 2) }));
    if (C.tax === "us" && res.hmfAir) lines.push(t("tool.note.hmfAir"));
    if (res.truncated) lines.push(t("tool.warn.cap", { n: fmtNum(MAX_ROWS, 0) }));
    lines.push(elIncVat.checked ? t("tool.note.vatIncluded") : t("tool.note.vatExcluded"));
    if (lines.length) {
      var d = document.createElement("div");
      d.className = "lcb-warn";
      d.innerHTML = lines.map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("");
      warn.appendChild(d);
    }

    // 품목 표 (화면은 상위 TABLE_CAP 행 — 전량은 CSV)
    var cs = cols(res);
    var html = "<thead><tr><th>#</th>";
    cs.forEach(function (c) { html += "<th" + (c.tl ? ' class="lcb-tl"' : "") + ">" + esc(t(c.th)) + "</th>"; });
    html += "</tr></thead><tbody>";
    var shown = Math.min(res.items.length, TABLE_CAP);
    for (var i = 0; i < shown; i++) {
      var it = res.items[i];
      html += "<tr><td>" + (i + 1) + "</td>";
      cs.forEach(function (c) {
        var v = it[c.k], cell;
        if (c.k === "name") {
          cell = esc(it.name || "—") + (it.hs ? ' <span class="lcb-badge">' + esc(it.hs) + "</span>" : "");
          if (it.residual) cell += ' <span class="lcb-badge">' + esc(t("tool.badge.round")) + "</span>";
        } else if (c.k === "qty") {
          cell = esc(fmtNum(it.qty, null));
        } else if (c.k === "duty") {
          cell = it.duty == null
            ? '<span class="lcb-badge">' + esc(t("tool.badge.noDuty")) + "</span>"
            : esc(fmtMoney(it.duty, cur, dec)) + ' <span class="lcb-badge">' + esc(fmtNum(it.dutyRate, null)) + "%</span>";
        } else if (c.k === "unit") {
          if (it.landed == null) cell = "—";
          else if (it.qty <= 0) cell = '<span class="lcb-badge">' + esc(t("tool.cell.qty0")) + "</span>";
          else cell = esc(fmtMoney(it.unit, cur, Math.max(dec, 2)));
        } else if (c.money) {
          cell = v == null ? "—" : esc(fmtMoney(v, cur, dec));
        } else {
          cell = esc(String(v == null ? "—" : v));
        }
        html += "<td" + (c.tl ? ' class="lcb-tl"' : "") + ">" + cell + "</td>";
      });
      html += "</tr>";
    }
    html += "</tbody><tfoot><tr><td></td>";
    cs.forEach(function (c) {
      var v = "";
      if (c.k === "name") v = esc(t("tool.th.total"));
      else if (c.k === "qty") v = esc(fmtNum(res.items.reduce(function (a, b) { return a + b.qty; }, 0), null));
      else if (c.k === "unit") v = "";
      else if (c.k === "fees") v = esc(fmtMoney(roundTo(res.totals.mpf + res.totals.hmf, dec), cur, dec));
      else if (c.money) v = esc(fmtMoney(res.totals[c.k], cur, dec));
      html += "<td" + (c.tl ? ' class="lcb-tl"' : "") + ">" + v + "</td>";
    });
    html += "</tr></tfoot>";
    $("lcb-items").innerHTML = html;
    var trunc = $("lcb-trunc");
    if (res.items.length > TABLE_CAP) {
      trunc.hidden = false;
      trunc.textContent = t("tool.warn.truncTable", { shown: fmtNum(TABLE_CAP, 0), total: fmtNum(res.items.length, 0) });
    } else { trunc.hidden = true; }

    // 세금 요약
    var rowsHtml = "";
    function line(labelKey, val, isTot) {
      rowsHtml += '<div' + (isTot ? ' class="lcb-tot"' : "") + "><dt>" + esc(t(labelKey)) + "</dt><dd>" + esc(val) + "</dd></div>";
    }
    line("tool.sum.goods", fmtMoney(res.totals.goods, cur, dec));
    line("tool.sum.costs", fmtMoney(res.totals.alloc, cur, dec));
    line("tool.sum.cv", fmtMoney(res.totals.cv, cur, dec));
    line("tool.sum.duty", fmtMoney(res.totals.duty, cur, dec));
    if (res.totals.excise > 0) line("tool.sum.excise", fmtMoney(res.totals.excise, cur, dec));
    if (C.tax === "us") {
      line("tool.sum.mpf", fmtMoney(res.totals.mpf, cur, dec));
      line("tool.sum.hmf", res.hmfAir ? t("tool.note.hmfAir") : fmtMoney(res.totals.hmf, cur, dec));
    } else {
      line("tool.sum.vat", fmtMoney(res.totals.vat, cur, dec));
    }
    if (res.roundingAdj) line("tool.sum.rounding", fmtMoney(res.roundingAdj, cur, dec));
    line("tool.sum.rows", fmtNum(res.totals.rows, 0) + (res.totals.noDuty ? " (" + t("tool.sum.noDuty", { n: fmtNum(res.totals.noDuty, 0) }) + ")" : ""));
    line("tool.sum.landed", fmtMoney(res.totals.landed, cur, dec), true);
    $("lcb-panel-summary").innerHTML = '<dl class="lcb-dl">' + rowsHtml + "</dl>";

    // 제외된 행
    var ex = res.excluded || [];
    $("lcb-tab-excluded").textContent = t("tool.tab.excluded") + (ex.length ? " (" + fmtNum(ex.length, 0) + ")" : "");
    if (!ex.length) {
      $("lcb-panel-excluded").innerHTML = '<p class="lcb-sub">' + esc(t("tool.exc.none")) + "</p>";
    } else {
      var eh = '<p class="lcb-sub">' + esc(t("tool.exc.head", { n: fmtNum(ex.length, 0) })) + " " + esc(excludedSummary(ex)) +
        '</p><div class="lcb-scroll"><table class="lcb-table"><thead><tr><th>' + esc(t("tool.exc.line")) +
        '</th><th class="lcb-tl">' + esc(t("tool.exc.reason")) + '</th><th class="lcb-tl">' + esc(t("tool.exc.raw")) + "</th></tr></thead><tbody>";
      ex.slice(0, TABLE_CAP).forEach(function (e) {
        eh += "<tr><td>" + e.line + '</td><td class="lcb-tl">' + esc(t("tool.exc." + e.reason)) +
          '</td><td class="lcb-tl">' + esc(e.raw.slice(0, 90)) + "</td></tr>";
      });
      eh += "</tbody></table></div>";
      if (ex.length > TABLE_CAP) eh += '<p class="lcb-sub">' + esc(t("tool.warn.truncTable", { shown: fmtNum(TABLE_CAP, 0), total: fmtNum(ex.length, 0) })) + "</p>";
      $("lcb-panel-excluded").innerHTML = eh;
    }
    showTab(tab);
  }

  function showTab(which) {
    tab = which;
    ["items", "summary", "excluded"].forEach(function (k) {
      var btn = $("lcb-tab-" + k), panel = $("lcb-panel-" + k);
      if (btn) btn.setAttribute("aria-selected", k === which ? "true" : "false");
      if (panel) panel.hidden = k !== which;
    });
  }

  /* ---- 출력: CSV / 클립보드 ---- */
  function resultRows(res) {
    var cs = cols(res), out = [], head = ["#"];
    cs.forEach(function (c) {
      var label = t(c.th);
      if (c.money || c.unit) label += " (" + res.cur + ")";
      head.push(label);
    });
    head.push(t("tool.th.rate"));
    out.push(head);
    res.items.forEach(function (it, i) {
      var r = [i + 1];
      cs.forEach(function (c) {
        var v = it[c.k];
        if (c.k === "name") r.push(it.name + (it.hs ? " [" + it.hs + "]" : ""));
        else if (c.k === "unit") r.push(it.landed == null || it.qty <= 0 ? "" : roundTo(it.unit, Math.max(res.dec, 2)));
        else r.push(v == null ? "" : v);
      });
      r.push(it.dutyRate == null ? "" : it.dutyRate);
      out.push(r);
    });
    return out;
  }

  function flash(msg) {
    var s = $("lcb-status");
    s.hidden = false; s.textContent = msg;
    setTimeout(function () { s.hidden = true; }, 1800);
  }

  $("lcb-csv").addEventListener("click", function () {
    if (!lastResult) return;
    // 엑셀이 UTF-8 을 인식하도록 BOM 을 붙인다 (한글 깨짐 방지)
    var blob = new Blob(["\ufeff" + toCSV(resultRows(lastResult))], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = SLUG + "-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    flash(t("tool.downloaded"));
  });

  $("lcb-copy").addEventListener("click", function () {
    if (!lastResult) return;
    // 엑셀에 바로 붙도록 TSV
    var text = resultRows(lastResult).map(function (r) {
      return r.map(function (v) { return String(v == null ? "" : v).replace(/[\t\r\n]/g, " "); }).join("\t");
    }).join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash(t("tool.copied")); },
        function () { flash(t("tool.copyFail")); });
    } else { flash(t("tool.copyFail")); }
  });

  /* ---- 입력 처리 ---- */
  function setTable(text, fromBytes) {
    var delim = detectDelim(text);
    var parsed = parseDelimited(text, delim).filter(function (r) {
      return !(r.length === 1 && r[0].trim() === "");
    });
    table = parsed;
    if (!table.length) { mapping = autoMap([], true); renderMapping(); runCalc(); return; }
    hasHeader = looksLikeHeader(table);
    var saved = load(K_MAP, null);
    if (saved && saved.sig === headerSig() && saved.map) {
      mapping = saved.map;
      hasHeader = !!saved.hasHeader;
    } else {
      mapping = autoMap(table, hasHeader);
    }
    if (!fromBytes) { lastBytes = null; $("lcb-enc").hidden = true; }
    renderMapping();
    runCalc();
  }

  function decode(bytes, enc) {
    try { return new TextDecoder(enc, { fatal: false }).decode(bytes); }
    catch (e) { return null; }
  }
  // 한글 엑셀은 CSV 를 CP949 로 내보낸다 — BOM 검사 → UTF-8 엄격 디코드 → 실패 시 euc-kr 폴백
  function decodeSmart(buf) {
    var bytes = new Uint8Array(buf);
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return { text: decode(bytes, "utf-8"), enc: "utf-8", sure: true };
    }
    try {
      var strict = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return { text: strict, enc: "utf-8", sure: true };
    } catch (e) { /* UTF-8 아님 → 한국어권 CSV 는 대개 CP949 */ }
    var k = decode(bytes, "euc-kr");
    if (k != null && k.indexOf("�") < 0) return { text: k, enc: "euc-kr", sure: false };
    var f = decode(bytes, "utf-8");
    return { text: f == null ? "" : f, enc: "utf-8", sure: false };
  }

  function applyBytes(buf, enc) {
    lastBytes = buf;
    var r = enc ? { text: decode(new Uint8Array(buf), enc), enc: enc, sure: true } : decodeSmart(buf);
    if (r.text == null) { setMsg(t("tool.n.decode"), true); return; }
    lastEnc = r.enc;
    elPaste.value = r.text.length > 400000 ? r.text.slice(0, 400000) : r.text;
    var banner = $("lcb-enc");
    var garbled = r.text.indexOf("�") >= 0;
    if (garbled || !r.sure || r.enc === "euc-kr") {
      banner.hidden = false;
      $("lcb-enc-text").textContent = r.enc === "euc-kr" ? t("tool.enc.cp949") : t("tool.enc.broken");
      $("lcb-enc-btn").textContent = r.enc === "euc-kr" ? t("tool.enc.back") : t("tool.enc.retry");
    } else { banner.hidden = true; }
    setTable(r.text, true);
  }

  function readFile(file) {
    if (!file) return;
    if (file.size > BIG_FILE) flash(t("tool.warn.bigFile", { n: Math.round(file.size / 1048576) }));
    var fr = new FileReader();
    fr.onload = function () { applyBytes(fr.result, null); };
    fr.onerror = function () { setMsg(t("tool.n.read"), true); };
    fr.readAsArrayBuffer(file);
  }

  $("lcb-enc-btn").addEventListener("click", function () {
    if (!lastBytes) return;
    applyBytes(lastBytes, lastEnc === "euc-kr" ? "utf-8" : "euc-kr");
  });

  var dz = $("lcb-drop");
  ["dragenter", "dragover"].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("is-over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("is-over"); });
  });
  dz.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) readFile(e.dataTransfer.files[0]);
  });
  $("lcb-pick").addEventListener("click", function () { $("lcb-file").click(); });
  $("lcb-file").addEventListener("change", function (e) {
    if (e.target.files && e.target.files.length) readFile(e.target.files[0]);
    e.target.value = "";
  });

  var pasteTimer = null;
  elPaste.addEventListener("input", function () {
    clearTimeout(pasteTimer);
    pasteTimer = setTimeout(function () {
      $("lcb-enc").hidden = true;
      lastBytes = null;
      setTable(elPaste.value, false);
    }, 220);
  });

  $("lcb-sample").addEventListener("click", function () {
    elPaste.value = t("tool.sample.csv");
    lastBytes = null;
    $("lcb-enc").hidden = true;
    setTable(elPaste.value, false);
    // 샘플은 공통비가 채워져 있어야 의미가 있다 — 비어 있을 때만 예시 금액(인보이스 통화)을 넣는다
    var empty = costs.every(function (c) { return !isFinite(parseNum(c.amount)) || parseNum(c.amount) <= 0; });
    if (empty) {
      var demo = { freight: 1800, insurance: 60, thc: 240, clearance: 150, inland: 320 };
      costs.forEach(function (c) { if (c.key && demo[c.key]) c.amount = String(demo[c.key]); });
      save(K_COSTS, costs);
      renderCosts();
    }
    runCalc();
  });

  $("lcb-clear").addEventListener("click", function () {
    elPaste.value = "";
    table = []; lastBytes = null; lastResult = null;
    $("lcb-enc").hidden = true;
    $("lcb-map-wrap").hidden = true;
    setMsg(t("tool.n.empty"));
  });

  $("lcb-cancel").addEventListener("click", function () {
    if (job) { job.cancelled = true; job = null; }
    $("lcb-progress").hidden = true;
    setMsg(t("tool.canceled"), true);
  });

  $("lcb-hasheader").addEventListener("change", function () {
    hasHeader = $("lcb-hasheader").checked;
    mapping = autoMap(table, hasHeader);
    saveMap();
    renderMapping();
    runCalc();
  });

  $("lcb-maps").addEventListener("change", function (e) {
    var sel = e.target;
    if (!sel.classList.contains("lcb-mapsel")) return;
    var k = sel.getAttribute("data-k");
    mapping[k] = sel.value === "" ? null : parseInt(sel.value, 10);
    saveMap();
    runCalc();
  });
  function saveMap() { save(K_MAP, { sig: headerSig(), map: mapping, hasHeader: hasHeader }); }

  /* ---- 공통비 편집 ---- */
  $("lcb-costs-body").addEventListener("input", function (e) {
    var el = e.target, i = parseInt(el.getAttribute("data-i"), 10);
    if (isNaN(i) || !costs[i]) return;
    if (el.classList.contains("lcb-c-label")) { costs[i].key = null; costs[i].label = el.value; }
    else if (el.classList.contains("lcb-c-amt")) { costs[i].amount = el.value; }
    else return;
    save(K_COSTS, costs);
    runCalc();
  });
  $("lcb-costs-body").addEventListener("change", function (e) {
    var el = e.target, i = parseInt(el.getAttribute("data-i"), 10);
    if (isNaN(i) || !costs[i]) return;
    if (el.classList.contains("lcb-c-basis")) costs[i].basis = el.value;
    else if (el.classList.contains("lcb-c-duty")) costs[i].dutiable = el.checked;
    else return;
    save(K_COSTS, costs);
    runCalc();
  });
  $("lcb-costs-body").addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest(".lcb-x") : null;
    if (!btn) return;
    var i = parseInt(btn.getAttribute("data-i"), 10);
    if (isNaN(i)) return;
    costs.splice(i, 1);
    save(K_COSTS, costs);
    renderCosts();
    runCalc();
  });
  $("lcb-addcost").addEventListener("click", function () {
    costs.push({ key: null, label: "", amount: "", basis: "value", dutiable: COUNTRIES[elCountry.value].basis === "CIF" });
    save(K_COSTS, costs);
    renderCosts();
    runCalc();
  });
  $("lcb-resetcost").addEventListener("click", function () {
    costs = PRESETS.map(function (p) { return { key: p.key, label: "", amount: "", basis: p.basis, dutiable: p.dutiable }; });
    save(K_COSTS, costs);
    renderCosts();
    runCalc();
  });

  /* ---- 국가/통화 연동 ---- */
  function syncCountry(resetRate) {
    var C = COUNTRIES[elCountry.value] || COUNTRIES[DEFAULT_COUNTRY];
    var us = C.tax === "us";
    $("lcb-vat-wrap").hidden = us;
    $("lcb-excise-wrap").hidden = C.tax !== "kr";
    $("lcb-mpfman-wrap").hidden = !us;
    $("lcb-excise-label").textContent = t("tool.excise.label", { cur: C.cur });
    $("lcb-vat-label").textContent = t(C.tax === "jp" ? "tool.vat.labelJp" : "tool.vat.label");
    if (resetRate) elVat.value = String(C.vat);
    // 같은 통화면 환율은 정의상 1 — '미입력을 1로 가정' 이 아니라 잠그고 사유를 표기한다
    var same = C.cur === elCur.value;
    if (same) { elFx.value = "1"; elFx.readOnly = true; }
    else {
      elFx.readOnly = false;
      if (!isFinite(parseNum(elFx.value)) || elFx.value === "1") elFx.value = ship.fx || "";
    }
    $("lcb-fx-note").textContent = same
      ? t("tool.fx.same", { cur: C.cur })
      : t("tool.fx.note", { cur: elCur.value, taxcur: C.cur });
    elFx.placeholder = same ? "1" : t("tool.fx.ph", { cur: elCur.value, taxcur: C.cur });
    $("lcb-basis-note").textContent = us
      ? t("tool.basisNote.fob", { country: countryName(elCountry.value) })
      : t("tool.basisNote.cif", { country: countryName(elCountry.value) });
    renderCosts();
  }

  function persistShip() {
    ship = {
      country: elCountry.value, cur: elCur.value, fx: elFx.readOnly ? (ship.fx || "") : elFx.value,
      mode: elMode.value, vat: elVat.value, excise: elExcise.value,
      incVat: elIncVat.checked, mpfMan: elMpfMan.checked
    };
    save(K_SHIP, ship);
  }

  elCountry.addEventListener("change", function () { syncCountry(true); persistShip(); runCalc(); });
  elCur.addEventListener("change", function () { syncCountry(false); persistShip(); runCalc(); });
  [elFx, elVat, elExcise].forEach(function (el) {
    el.addEventListener("input", function () { persistShip(); runCalc(); });
  });
  [elMode, elIncVat, elMpfMan].forEach(function (el) {
    el.addEventListener("change", function () { persistShip(); runCalc(); });
  });
  ["items", "summary", "excluded"].forEach(function (k) {
    $("lcb-tab-" + k).addEventListener("click", function () { showTab(k); });
  });

  /* ---- 초기화 ---- */
  fillCountries();
  fillCurrencies();
  elCountry.value = detectCountry();
  var C0 = COUNTRIES[elCountry.value];
  // 인보이스 통화 기본값: 수입 결제의 사실상 표준이 USD — 저장된 선택이 있으면 그것을 쓴다
  elCur.value = (ship.cur && CURRENCIES.indexOf(ship.cur) >= 0) ? ship.cur : "USD";
  elMode.value = ship.mode === "air" ? "air" : "sea";
  elVat.value = ship.vat != null && ship.vat !== "" ? ship.vat : String(C0.vat);
  elExcise.value = ship.excise || "";
  elIncVat.checked = !!ship.incVat;
  elMpfMan.checked = !!ship.mpfMan;
  if (ship.fx) elFx.value = ship.fx;
  syncCountry(ship.vat == null || ship.vat === "");
  mapping = autoMap([], true);
  showTab("items");
  setMsg(t("tool.n.empty"));

  // 언어 전환 — 프리셋 라벨·표·안내 문구가 따라간다 (사용자가 라벨을 고치면 그 행은 사용자 데이터)
  document.addEventListener("i18n:change", function () {
    fillCountries();   // 국가·통화 표기는 Intl.DisplayNames 가 언어별로 만든다
    fillCurrencies();
    syncCountry(false);
    renderMapping();
    if (lastResult) render(lastResult); else setMsg(t("tool.n.empty"));
  });
  // TOOLJS:END
})();
