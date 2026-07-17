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
  var SLUG = cfg.slug || "workday-calc";
  var STATE_KEY = SLUG + ":state";
  var MAX_SPAN_DAYS = 3653; // ~10 years

  /* =========================================================================
     공휴일 데이터 — 100% 정적. 외부 API·네트워크 호출 없음 (pure-static 아키타입).
     두 종류로 나눈다:
       (1) RULES[c]  — 법으로 규칙이 고정된 공휴일. 고정일 / n번째 요일 / 부활절 기준 /
           일본 춘·추분 공식으로 "계산"하므로 연도 제한이 없다 (데이터 만료 없음).
       (2) STATIC[c] — 음력이나 연간 고시로 움직여 계산이 불가능한 공휴일. 연도별로
           날짜를 박아두고 연 1회 갱신한다 (WIKI §6 유지보수 경계). 현재 한국뿐.
     ========================================================================= */
  var RULES = {
    "us": [
      { k: "f", m: 1, d: 1, n: "New Year's Day", s: "u" },
      { k: "n", m: 1, w: 1, i: 3, n: "Martin Luther King Jr. Day" },
      { k: "n", m: 2, w: 1, i: 3, n: "Presidents' Day" },
      { k: "l", m: 5, w: 1, n: "Memorial Day" },
      { k: "f", m: 6, d: 19, n: "Juneteenth", s: "u" },
      { k: "f", m: 7, d: 4, n: "Independence Day", s: "u" },
      { k: "n", m: 9, w: 1, i: 1, n: "Labor Day" },
      { k: "n", m: 10, w: 1, i: 2, n: "Columbus Day" },
      { k: "f", m: 11, d: 11, n: "Veterans Day", s: "u" },
      { k: "n", m: 11, w: 4, i: 4, n: "Thanksgiving" },
      { k: "f", m: 12, d: 25, n: "Christmas Day", s: "u" }
    ],
    "uk": [
      { k: "f", m: 1, d: 1, n: "New Year's Day", s: "n" },
      { k: "e", o: -2, n: "Good Friday" },
      { k: "e", o: 1, n: "Easter Monday" },
      { k: "n", m: 5, w: 1, i: 1, n: "Early May bank holiday" },
      { k: "l", m: 5, w: 1, n: "Spring bank holiday" },
      { k: "l", m: 8, w: 1, n: "Summer bank holiday" },
      { k: "f", m: 12, d: 25, n: "Christmas Day", s: "n" },
      { k: "f", m: 12, d: 26, n: "Boxing Day", s: "n" }
    ],
    "ca": [
      { k: "f", m: 1, d: 1, n: "New Year's Day", s: "n" },
      { k: "e", o: -2, n: "Good Friday" },
      { k: "mb", m: 5, d: 25, n: "Victoria Day" },
      { k: "f", m: 7, d: 1, n: "Canada Day", s: "n" },
      { k: "n", m: 9, w: 1, i: 1, n: "Labour Day" },
      { k: "f", m: 9, d: 30, n: "National Day for Truth and Reconciliation", s: "n" },
      { k: "n", m: 10, w: 1, i: 2, n: "Thanksgiving" },
      { k: "f", m: 11, d: 11, n: "Remembrance Day", s: "n" },
      { k: "f", m: 12, d: 25, n: "Christmas Day", s: "n" },
      { k: "f", m: 12, d: 26, n: "Boxing Day", s: "n" }
    ],
    "au": [
      { k: "f", m: 1, d: 1, n: "New Year's Day", s: "n" },
      { k: "f", m: 1, d: 26, n: "Australia Day", s: "n" },
      { k: "e", o: -2, n: "Good Friday" },
      { k: "e", o: 1, n: "Easter Monday" },
      { k: "f", m: 4, d: 25, n: "Anzac Day" },
      { k: "f", m: 12, d: 25, n: "Christmas Day", s: "n" },
      { k: "f", m: 12, d: 26, n: "Boxing Day", s: "n" }
    ],
    "de": [
      { k: "f", m: 1, d: 1, n: "New Year's Day" },
      { k: "e", o: -2, n: "Good Friday" },
      { k: "e", o: 1, n: "Easter Monday" },
      { k: "f", m: 5, d: 1, n: "Labour Day" },
      { k: "e", o: 39, n: "Ascension Day" },
      { k: "e", o: 50, n: "Whit Monday" },
      { k: "f", m: 10, d: 3, n: "German Unity Day" },
      { k: "f", m: 12, d: 25, n: "Christmas Day" },
      { k: "f", m: 12, d: 26, n: "Second Day of Christmas" }
    ],
    "fr": [
      { k: "f", m: 1, d: 1, n: "New Year's Day" },
      { k: "e", o: 1, n: "Easter Monday" },
      { k: "f", m: 5, d: 1, n: "Labour Day" },
      { k: "f", m: 5, d: 8, n: "Victory in Europe Day" },
      { k: "e", o: 39, n: "Ascension Day" },
      { k: "e", o: 50, n: "Whit Monday" },
      { k: "f", m: 7, d: 14, n: "Bastille Day" },
      { k: "f", m: 8, d: 15, n: "Assumption of Mary" },
      { k: "f", m: 11, d: 1, n: "All Saints' Day" },
      { k: "f", m: 11, d: 11, n: "Armistice Day" },
      { k: "f", m: 12, d: 25, n: "Christmas Day" }
    ],
    "es": [
      { k: "f", m: 1, d: 1, n: "New Year's Day" },
      { k: "f", m: 1, d: 6, n: "Epiphany" },
      { k: "e", o: -2, n: "Good Friday" },
      { k: "f", m: 5, d: 1, n: "Labour Day" },
      { k: "f", m: 8, d: 15, n: "Assumption of Mary" },
      { k: "f", m: 10, d: 12, n: "National Day of Spain" },
      { k: "f", m: 11, d: 1, n: "All Saints' Day" },
      { k: "f", m: 12, d: 6, n: "Constitution Day" },
      { k: "f", m: 12, d: 8, n: "Immaculate Conception" },
      { k: "f", m: 12, d: 25, n: "Christmas Day" }
    ],
    "br": [
      { k: "f", m: 1, d: 1, n: "New Year's Day" },
      { k: "e", o: -48, n: "Carnival Monday" },
      { k: "e", o: -47, n: "Carnival Tuesday" },
      { k: "e", o: -2, n: "Good Friday" },
      { k: "f", m: 4, d: 21, n: "Tiradentes' Day" },
      { k: "f", m: 5, d: 1, n: "Labour Day" },
      { k: "e", o: 60, n: "Corpus Christi" },
      { k: "f", m: 9, d: 7, n: "Independence Day" },
      { k: "f", m: 10, d: 12, n: "Our Lady of Aparecida" },
      { k: "f", m: 11, d: 2, n: "All Souls' Day" },
      { k: "f", m: 11, d: 15, n: "Republic Proclamation Day" },
      { k: "f", m: 11, d: 20, n: "Black Awareness Day" },
      { k: "f", m: 12, d: 25, n: "Christmas Day" }
    ],
    "mx": [
      { k: "f", m: 1, d: 1, n: "New Year's Day" },
      { k: "n", m: 2, w: 1, i: 1, n: "Constitution Day" },
      { k: "n", m: 3, w: 1, i: 3, n: "Benito Juárez's Birthday" },
      { k: "f", m: 5, d: 1, n: "Labour Day" },
      { k: "f", m: 9, d: 16, n: "Independence Day" },
      { k: "n", m: 11, w: 1, i: 3, n: "Revolution Day" },
      { k: "f", m: 12, d: 25, n: "Christmas Day" }
    ],
    "in": [
      { k: "f", m: 1, d: 26, n: "Republic Day" },
      { k: "f", m: 8, d: 15, n: "Independence Day" },
      { k: "f", m: 10, d: 2, n: "Gandhi Jayanti" }
    ],
    "ru": [
      { k: "f", m: 1, d: 1, n: "New Year holiday" },
      { k: "f", m: 1, d: 2, n: "New Year holiday" },
      { k: "f", m: 1, d: 3, n: "New Year holiday" },
      { k: "f", m: 1, d: 4, n: "New Year holiday" },
      { k: "f", m: 1, d: 5, n: "New Year holiday" },
      { k: "f", m: 1, d: 6, n: "New Year holiday" },
      { k: "f", m: 1, d: 7, n: "Orthodox Christmas Day" },
      { k: "f", m: 1, d: 8, n: "New Year holiday" },
      { k: "f", m: 2, d: 23, n: "Defender of the Fatherland Day", s: "n" },
      { k: "f", m: 3, d: 8, n: "International Women's Day", s: "n" },
      { k: "f", m: 5, d: 1, n: "Spring and Labour Day", s: "n" },
      { k: "f", m: 5, d: 9, n: "Victory Day", s: "n" },
      { k: "f", m: 6, d: 12, n: "Russia Day", s: "n" },
      { k: "f", m: 11, d: 4, n: "Unity Day", s: "n" }
    ],
    "jp": [
      { k: "f", m: 1, d: 1, n: "New Year's Day" },
      { k: "n", m: 1, w: 1, i: 2, n: "Coming of Age Day" },
      { k: "f", m: 2, d: 11, n: "National Foundation Day" },
      { k: "f", m: 2, d: 23, n: "Emperor's Birthday" },
      { k: "q", sp: true, n: "Vernal Equinox Day" },
      { k: "f", m: 4, d: 29, n: "Shōwa Day" },
      { k: "f", m: 5, d: 3, n: "Constitution Memorial Day" },
      { k: "f", m: 5, d: 4, n: "Greenery Day" },
      { k: "f", m: 5, d: 5, n: "Children's Day" },
      { k: "n", m: 7, w: 1, i: 3, n: "Marine Day" },
      { k: "f", m: 8, d: 11, n: "Mountain Day" },
      { k: "n", m: 9, w: 1, i: 3, n: "Respect for the Aged Day" },
      { k: "q", sp: false, n: "Autumnal Equinox Day" },
      { k: "n", m: 10, w: 1, i: 2, n: "Sports Day" },
      { k: "f", m: 11, d: 3, n: "Culture Day" },
      { k: "f", m: 11, d: 23, n: "Labour Thanksgiving Day" }
    ]
  };

  /* 계산 불가능한 공휴일(음력·임시공휴일) — 연 1회 손으로 갱신하는 정적 표. */
  var STATIC = {
    "kr": {
      "2025-01-01": "New Year's Day", "2025-01-27": "Temporary Holiday",
      "2025-01-28": "Korean New Year (Seollal)", "2025-01-29": "Korean New Year (Seollal)", "2025-01-30": "Korean New Year (Seollal)",
      "2025-03-01": "Independence Movement Day", "2025-03-03": "Substitute Holiday",
      "2025-05-05": "Children's Day / Buddha's Birthday", "2025-05-06": "Substitute Holiday",
      "2025-06-06": "Memorial Day", "2025-08-15": "Liberation Day",
      "2025-10-03": "National Foundation Day", "2025-10-05": "Chuseok (Korean Thanksgiving)",
      "2025-10-06": "Chuseok (Korean Thanksgiving)", "2025-10-07": "Chuseok (Korean Thanksgiving)",
      "2025-10-08": "Substitute Holiday", "2025-10-09": "Hangeul Day", "2025-12-25": "Christmas Day",
      "2026-01-01": "New Year's Day",
      "2026-02-16": "Korean New Year (Seollal)", "2026-02-17": "Korean New Year (Seollal)", "2026-02-18": "Korean New Year (Seollal)",
      "2026-03-01": "Independence Movement Day", "2026-03-02": "Substitute Holiday",
      "2026-05-05": "Children's Day", "2026-05-24": "Buddha's Birthday", "2026-05-25": "Substitute Holiday",
      "2026-06-06": "Memorial Day", "2026-08-15": "Liberation Day", "2026-08-17": "Substitute Holiday",
      "2026-09-24": "Chuseok (Korean Thanksgiving)", "2026-09-25": "Chuseok (Korean Thanksgiving)",
      "2026-09-26": "Chuseok (Korean Thanksgiving)", "2026-09-28": "Substitute Holiday",
      "2026-10-03": "National Foundation Day", "2026-10-05": "Substitute Holiday",
      "2026-10-09": "Hangeul Day", "2026-12-25": "Christmas Day",
      "2027-01-01": "New Year's Day",
      "2027-02-05": "Korean New Year (Seollal)", "2027-02-06": "Korean New Year (Seollal)", "2027-02-07": "Korean New Year (Seollal)",
      "2027-02-08": "Substitute Holiday", "2027-03-01": "Independence Movement Day",
      "2027-05-05": "Children's Day", "2027-05-13": "Buddha's Birthday",
      "2027-06-06": "Memorial Day", "2027-08-15": "Liberation Day", "2027-08-16": "Substitute Holiday",
      "2027-09-14": "Chuseok (Korean Thanksgiving)", "2027-09-15": "Chuseok (Korean Thanksgiving)",
      "2027-09-16": "Chuseok (Korean Thanksgiving)", "2027-10-03": "National Foundation Day",
      "2027-10-04": "Substitute Holiday", "2027-10-09": "Hangeul Day", "2027-10-11": "Substitute Holiday",
      "2027-12-25": "Christmas Day", "2027-12-27": "Substitute Holiday"
    }
  };
  /* STATIC 표가 있는 나라만 연도 한계가 있다. RULES 만 쓰는 나라는 무제한. */
  var STATIC_RANGE = { "kr": { from: 2025, to: 2027 } };

  /* 국가 목록 — c: 저장 코드(기존 사용자 localStorage 호환), r: ISO 지역(Intl 표시명용),
     en: Intl 미지원 시 폴백 이름, scope: 범위 라벨 키, note: 주의 문구 키. */
  var COUNTRIES = [
    { c: "us", r: "US", en: "United States", scope: "federal", note: "regional" },
    { c: "uk", r: "GB", en: "United Kingdom", scope: "ukEw", note: "regional" },
    { c: "ca", r: "CA", en: "Canada", scope: "federal", note: "regional" },
    { c: "au", r: "AU", en: "Australia", scope: "national", note: "regional" },
    { c: "de", r: "DE", en: "Germany", scope: "nationwide", note: "regional" },
    { c: "fr", r: "FR", en: "France", scope: "national", note: "regional" },
    { c: "es", r: "ES", en: "Spain", scope: "national", note: "regional" },
    { c: "br", r: "BR", en: "Brazil", scope: "national", note: "optional" },
    { c: "mx", r: "MX", en: "Mexico", scope: "national" },
    { c: "in", r: "IN", en: "India", scope: "national", note: "inNational" },
    { c: "ru", r: "RU", en: "Russia", scope: "national", note: "decree" },
    { c: "jp", r: "JP", en: "Japan", scope: "national" },
    { c: "kr", r: "KR", en: "South Korea", scope: "statutory", note: "lunar" }
  ];
  function countryOf(c) {
    for (var i = 0; i < COUNTRIES.length; i++) if (COUNTRIES[i].c === c) return COUNTRIES[i];
    return null;
  }

  /* 브라우저 지역 → 국가/주말 추정 (사용자가 언제든 바꿀 수 있다). */
  var REGION_COUNTRY = { US: "us", GB: "uk", CA: "ca", AU: "au", DE: "de", FR: "fr", ES: "es", BR: "br", MX: "mx", IN: "in", RU: "ru", JP: "jp", KR: "kr" };
  var LANG_REGION = { en: "US", de: "DE", fr: "FR", es: "ES", pt: "BR", ru: "RU", hi: "IN", ja: "JP", ko: "KR", zh: "CN", ar: "EG", bn: "BD", ur: "PK", id: "ID" };
  /* 금·토를 주말로 쓰는 지역 (공휴일 표가 없어도 주말만은 맞춘다 — 10년에 한 번 바뀌는 상수) */
  var FRISAT_REGIONS = { SA: 1, EG: 1, BD: 1, IL: 1, KW: 1, QA: 1, BH: 1, OM: 1, JO: 1, IQ: 1, LY: 1, DZ: 1, SY: 1, YE: 1, MV: 1, PS: 1, SD: 1 };

  function detectRegion() {
    var langs = [], i, m, p;
    try { if (navigator.languages && navigator.languages.length) langs = [].slice.call(navigator.languages); } catch (e) { /* noop */ }
    try { if (navigator.language) langs.push(navigator.language); } catch (e) { /* noop */ }
    for (i = 0; i < langs.length; i++) {
      m = /[-_]([A-Za-z]{2})$/.exec(String(langs[i] || ""));
      if (m) return m[1].toUpperCase();
    }
    for (i = 0; i < langs.length; i++) {
      p = String(langs[i] || "").toLowerCase().split(/[-_]/)[0];
      if (LANG_REGION[p]) return LANG_REGION[p];
    }
    return "";
  }

  /* ---- i18n helper ---- */
  function tr(key, fallback) {
    try {
      if (window.I18N) { var v = window.I18N.t(key); if (v != null) return v; }
    } catch (e) { /* i18n absent */ }
    return fallback;
  }
  function curLang() {
    try { if (window.I18N && window.I18N.lang) return window.I18N.lang() || "en"; } catch (e) { /* noop */ }
    return "en";
  }
  function fmt(s, map) {
    return String(s).replace(/\{(\w+)\}/g, function (_, k) { return map[k] != null ? map[k] : "{" + k + "}"; });
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---- Date helpers (local midnight — never UTC parsing) ---- */
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function toKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseDate(str) {
    var p = String(str).split("-"), d = new Date(+p[0], +p[1] - 1, +p[2]);
    if (+p[0] < 100) d.setFullYear(+p[0]); // new Date(2,..) 가 1902년이 되는 것 방지
    return d;
  }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function isValid(str) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str || "")) return false;
    var d = parseDate(str); return !isNaN(d.getTime());
  }
  function fmtLong(d) {
    try { return new Intl.DateTimeFormat(curLang(), { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(d); }
    catch (e) { return toKey(d); }
  }
  function fmtShort(d) {
    try { return new Intl.DateTimeFormat(curLang(), { year: "numeric", month: "short", day: "numeric" }).format(d); }
    catch (e) { return toKey(d); }
  }
  function weekendSet(def) { return def === "frisat" ? { 5: 1, 6: 1 } : { 0: 1, 6: 1 }; }

  /* ---- 규칙 → 날짜 ---- */
  function nthDow(y, m, w, i) { var d = new Date(y, m - 1, 1), shift = (w - d.getDay() + 7) % 7; return new Date(y, m - 1, 1 + shift + (i - 1) * 7); }
  function lastDow(y, m, w) { var d = new Date(y, m, 0), back = (d.getDay() - w + 7) % 7; return new Date(y, m - 1, d.getDate() - back); }
  function mondayBefore(y, m, d) { var t = new Date(y, m - 1, d), back = (t.getDay() + 6) % 7; if (back === 0) back = 7; return addDays(t, -back); }
  function easter(y) { // Anonymous Gregorian algorithm
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7,
      m = Math.floor((a + 11 * h + 22 * l) / 451),
      mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, mo - 1, da);
  }
  function jpEquinox(y, sp) { // 春分/秋分 공식 (1980–2099 유효)
    var base = sp ? 20.8431 : 23.2488;
    return new Date(y, sp ? 2 : 8, Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)));
  }
  function ruleDate(r, y) {
    switch (r.k) {
      case "f": return new Date(y, r.m - 1, r.d);
      case "n": return nthDow(y, r.m, r.w, r.i);
      case "l": return lastDow(y, r.m, r.w);
      case "e": return addDays(easter(y), r.o);
      case "q": return jpEquinox(y, r.sp);
      case "mb": return mondayBefore(y, r.m, r.d);
    }
    return null;
  }

  var yearCache = {};
  function yearHolidays(c, y) {
    var ck = c + ":" + y;
    if (yearCache[ck]) return yearCache[ck];
    var out = {}, rules = RULES[c] || [], i, r, d, name, g, nd, k;
    for (i = 0; i < rules.length; i++) {
      r = rules[i]; d = ruleDate(r, y);
      if (!d) continue;
      name = r.n;
      if (r.s === "u") {                       // 미국 연방: 토 → 앞 금, 일 → 뒤 월
        if (d.getDay() === 6) { d = addDays(d, -1); name += " (observed)"; }
        else if (d.getDay() === 0) { d = addDays(d, 1); name += " (observed)"; }
      } else if (r.s === "n") {                // 영국·캐나다·호주·러시아: 주말이면 다음 빈 평일로
        if (d.getDay() === 0 || d.getDay() === 6) {
          nd = addDays(d, 1); g = 0;
          while ((nd.getDay() === 0 || nd.getDay() === 6 || out[toKey(nd)] != null) && g++ < 14) nd = addDays(nd, 1);
          d = nd; name += " (substitute)";
        }
      }
      if (out[toKey(d)] == null) out[toKey(d)] = name;
    }
    if (c === "jp") {                          // 일본: 振替休日 + 国民の休日
      var base = {}, keys;
      for (k in out) if (out.hasOwnProperty(k)) base[k] = out[k];
      keys = Object.keys(base).sort();
      keys.forEach(function (kk) {             // 일요일과 겹치면 다음 빈 날이 대체휴일
        var bd = parseDate(kk); if (bd.getDay() !== 0) return;
        var x = addDays(bd, 1), gg = 0;
        while (out[toKey(x)] != null && gg++ < 14) x = addDays(x, 1);
        if (out[toKey(x)] == null) out[toKey(x)] = "Substitute Holiday";
      });
      keys.forEach(function (kk) {             // 공휴일 사이에 낀 평일 = 국민의 휴일
        var a = parseDate(kk), mid = addDays(a, 1), b2 = addDays(a, 2);
        if (base[toKey(b2)] == null) return;
        if (out[toKey(mid)] != null || mid.getDay() === 0) return;
        out[toKey(mid)] = "Citizens' Holiday";
      });
    }
    var st = STATIC[c];
    if (st) { for (k in st) if (st.hasOwnProperty(k) && k.slice(0, 4) === String(y)) out[k] = st[k]; }
    yearCache[ck] = out;
    return out;
  }

  /* ---- 프리셋 + 커스텀을 합친 공휴일 맵 (날짜당 1회만 판정) ---- */
  function holidayMap(c, minY, maxY) {
    var map = {}, y, k, src;
    if (c && c !== "none" && (RULES[c] || STATIC[c])) {
      for (y = minY - 1; y <= maxY + 1; y++) {   // ±1년: 연말 관측일이 해를 넘는 경우 대비
        src = yearHolidays(c, y);
        for (k in src) if (src.hasOwnProperty(k)) map[k] = src[k];
      }
    }
    var custom = state.custom, cname = tr("tool.customName", "Custom holiday");
    for (var i = 0; i < custom.length; i++) { if (map[custom[i]] == null) map[custom[i]] = cname; }
    return map;
  }

  /* ---- storage (localStorage prefix or session fallback) ---- */
  var storageOk = true, sessionState = {};
  (function () { try { localStorage.setItem(SLUG + ":_t", "1"); localStorage.removeItem(SLUG + ":_t"); } catch (e) { storageOk = false; } })();
  function readState() {
    if (storageOk) { try { var r = localStorage.getItem(STATE_KEY); return r ? JSON.parse(r) : {}; } catch (e) { return {}; } }
    return sessionState;
  }
  var state = readState();
  if (!Array.isArray(state.custom)) state.custom = [];
  function persist() {
    if (storageOk) { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) { /* quota */ } }
    else { sessionState = state; }
  }

  /* 최초 방문이면 브라우저 지역으로 국가·주말을 채운다 (저장된 설정이 있으면 그대로). */
  var region = detectRegion();
  var autoCountry = false;
  if (!state.preset) { state.preset = REGION_COUNTRY[region] || "none"; autoCountry = true; }
  if (!state.weekend) { state.weekend = FRISAT_REGIONS[region] ? "frisat" : "satsun"; }

  /* ---- core: days between two dates ---- */
  function computeRange() {
    var s = startEl.value, e = endEl.value;
    if (!s || !e || !isValid(s) || !isValid(e)) return { error: "empty" };
    var sd = parseDate(s), ed = parseDate(e);
    if (sd.getTime() > ed.getTime()) return { error: "afterEnd" };
    if (Math.round((ed - sd) / 86400000) > MAX_SPAN_DAYS) return { error: "tooLong" };
    var wknd = weekendSet(weekendEl.value), preset = presetEl.value;
    var hmap = holidayMap(preset, sd.getFullYear(), ed.getFullYear());
    var lim = STATIC_RANGE[preset];
    var incStart = incStartEl.checked, incEnd = incEndEl.checked;
    var work = 0, weekend = 0, holiday = 0, total = 0, warn = false, skipped = [];
    var d = new Date(sd.getTime());
    while (d.getTime() <= ed.getTime()) {
      var scope = true;
      if (d.getTime() === sd.getTime() && !incStart) scope = false;
      if (d.getTime() === ed.getTime() && !incEnd) scope = false;
      if (scope) {
        total++;
        var y = d.getFullYear();
        if (lim && (y < lim.from || y > lim.to)) warn = true;
        if (wknd[d.getDay()]) { weekend++; }
        else {
          var key = toKey(d);
          if (hmap[key] != null) { holiday++; skipped.push({ date: new Date(d.getTime()), name: hmap[key] }); }
          else { work++; }
        }
      }
      d.setDate(d.getDate() + 1);
    }
    return { work: work, weekend: weekend, holiday: holiday, total: total, skipped: skipped, warn: warn, country: preset };
  }

  /* ---- core: add / subtract business days ---- */
  function computeAdd() {
    var s = start2El.value;
    if (!s || !isValid(s)) return { error: "emptyStart" };
    var n = parseInt(nEl.value, 10);
    if (!(n >= 1 && n <= 365) || String(nEl.value).indexOf(".") >= 0) return { error: "badCount" };
    var dir = dirEl.value, step = (dir === "before") ? -1 : 1;
    var wknd = weekendSet(weekendEl.value), preset = presetEl.value;
    var sd = parseDate(s), y0 = sd.getFullYear();
    var hmap = holidayMap(preset, y0 - 2, y0 + 2);
    var lim = STATIC_RANGE[preset];
    var d = parseDate(s), counted = 0, warn = false, guard = 0, maxGuard = n * 12 + 500;
    while (counted < n && guard < maxGuard) {
      guard++;
      d.setDate(d.getDate() + step);
      var y = d.getFullYear();
      if (lim && (y < lim.from || y > lim.to)) warn = true;
      if (wknd[d.getDay()]) continue;
      if (hmap[toKey(d)] != null) continue;
      counted++;
    }
    if (counted < n) return { error: "tooLong" };
    return { date: new Date(d.getTime()), startDate: parseDate(s), n: n, dir: dir, warn: warn, country: preset };
  }

  /* ---- DOM refs ---- */
  var tabBtn1 = document.getElementById("tabbtn-1"), tabBtn2 = document.getElementById("tabbtn-2");
  var panel1 = document.getElementById("panel-1"), panel2 = document.getElementById("panel-2");
  var presetEl = document.getElementById("in-preset"), weekendEl = document.getElementById("in-weekend");
  var countryNoteEl = document.getElementById("country-note");
  var startEl = document.getElementById("in-start"), endEl = document.getElementById("in-end");
  var incStartEl = document.getElementById("in-inc-start"), incEndEl = document.getElementById("in-inc-end");
  var start2El = document.getElementById("in-start2"), nEl = document.getElementById("in-n"), dirEl = document.getElementById("in-dir");
  var customInput = document.getElementById("in-custom"), customAddBtn = document.getElementById("custom-add-btn");
  var customListEl = document.getElementById("custom-list"), customMsgEl = document.getElementById("custom-msg");
  var resultEl = document.getElementById("result"), storeNoteEl = document.getElementById("store-note");
  var quickWrap = document.getElementById("quick-range");

  var activeTab = (state.tab === 2) ? 2 : 1;
  var lastResult = null;  // { kind, data } — 언어 전환 시 다시 렌더
  var lastError = null;

  /* ---- 국가 선택 UI (표시명은 Intl.DisplayNames 로 현지화) ---- */
  function countryName(co) {
    try {
      if (typeof Intl !== "undefined" && Intl.DisplayNames) {
        var n = new Intl.DisplayNames([curLang()], { type: "region" }).of(co.r);
        if (n && n !== co.r) return n;
      }
    } catch (e) { /* 구형 브라우저 — 아래 영문 폴백 */ }
    return co.en;
  }
  function buildCountrySelect() {
    if (!presetEl) return;
    var keep = presetEl.value || state.preset || "none";
    var list = COUNTRIES.map(function (co) {
      return { c: co.c, label: countryName(co) + " (" + tr("tool.scope." + co.scope, co.scope) + ")" };
    });
    try {
      var coll = new Intl.Collator(curLang());
      list.sort(function (a, b) { return coll.compare(a.label, b.label); });
    } catch (e) { list.sort(function (a, b) { return a.label < b.label ? -1 : (a.label > b.label ? 1 : 0); }); }
    presetEl.textContent = "";
    list.forEach(function (o) {
      var op = document.createElement("option");
      op.value = o.c; op.textContent = o.label;
      presetEl.appendChild(op);
    });
    var none = document.createElement("option");
    none.value = "none"; none.textContent = tr("tool.opt.weekendsOnly", "Weekends only");
    presetEl.appendChild(none);
    presetEl.value = keep;
    if (!presetEl.value) presetEl.value = "none";
  }
  function renderCountryNote() {
    if (!countryNoteEl) return;
    var co = countryOf(presetEl.value), parts = [], txt;
    if (co && co.note) {
      txt = tr("tool.note." + co.note, "");
      if (co.note === "lunar") {
        var lim = STATIC_RANGE[co.c] || {};
        txt = fmt(txt, { from: lim.from, to: lim.to, country: countryName(co) });
      }
      if (txt) parts.push(txt);
    }
    if (autoCountry && presetEl.value !== "none") parts.push(tr("tool.autoNote", "Set from your region — change it any time."));
    countryNoteEl.textContent = parts.join(" ");
    countryNoteEl.hidden = !parts.length;
  }

  /* ---- rendering ---- */
  function warnBadge(c) {
    var co = countryOf(c), lim = STATIC_RANGE[c] || {};
    var msg = fmt(tr("tool.res.warn", "Public holiday data for {country} covers {from}–{to}. Outside that range only weekends are subtracted — add custom holidays."),
      { country: co ? countryName(co) : "", from: lim.from, to: lim.to });
    return '<p style="margin-top:12px;padding:8px 12px;border-radius:8px;background:color-mix(in srgb,#f59e0b 15%,var(--surface));border:1px solid color-mix(in srgb,#f59e0b 45%,var(--line));font-size:13px;color:var(--ink);">&#9888; ' + esc(msg) + "</p>";
  }
  function renderRange(r) {
    var html = '<div style="text-align:center;">';
    html += '<div style="font-size:clamp(40px,11vw,64px);font-weight:900;letter-spacing:-0.04em;line-height:1;color:var(--accent);">' + r.work + "</div>";
    html += '<div style="font-weight:600;color:var(--muted);margin-top:4px;">' + esc(tr("tool.res.businessDays", "business days")) + "</div></div>";
    html += '<p style="text-align:center;margin:14px 0 0;font-size:15px;">' +
      esc(fmt(tr("tool.res.breakdown", "{total} total days = {work} business + {weekend} weekend + {holiday} public holiday"),
        { total: r.total, work: r.work, weekend: r.weekend, holiday: r.holiday })) + "</p>";
    if (r.warn) html += warnBadge(r.country);
    if (r.skipped.length) {
      html += '<details style="margin-top:14px;"><summary style="cursor:pointer;font-weight:600;">' +
        esc(fmt(tr("tool.res.skipped", "Skipped public holidays ({n})"), { n: r.skipped.length })) + "</summary>";
      html += '<ul style="margin:10px 0 0;padding-left:18px;color:var(--muted);font-size:14px;">';
      r.skipped.forEach(function (h) { html += "<li>" + esc(fmtShort(h.date)) + " &mdash; " + esc(h.name) + "</li>"; });
      html += "</ul></details>";
    } else {
      html += '<p style="text-align:center;margin-top:10px;color:var(--muted);font-size:14px;">' +
        esc(tr("tool.res.skippedNone", "No public holidays fell within this range.")) + "</p>";
    }
    return html;
  }
  function renderAdd(r) {
    var html = '<div style="text-align:center;">';
    html += '<div style="font-size:clamp(22px,6vw,34px);font-weight:800;letter-spacing:-0.02em;line-height:1.2;color:var(--accent);">' + esc(fmtLong(r.date)) + "</div>";
    var key = (r.dir === "before") ? "tool.res.sentenceBefore" : "tool.res.sentenceAfter";
    var def = (r.dir === "before") ? "{n} business days before {date}" : "{n} business days after {date}";
    html += '<p style="margin:10px 0 0;color:var(--muted);font-size:15px;">' +
      esc(fmt(tr(key, def), { n: r.n, date: fmtShort(r.startDate) })) + "</p></div>";
    if (r.warn) html += warnBadge(r.country);
    return html;
  }
  function showError(key, def, withSwap) {
    var html = '<p style="margin:0;font-size:15px;color:var(--muted);">' + esc(tr(key, def)) + "</p>";
    if (withSwap) html += '<button class="btn" id="swap-btn" type="button" style="margin-top:12px;background:var(--muted);">' + esc(tr("tool.swapBtn", "Swap dates")) + "</button>";
    resultEl.innerHTML = html; resultEl.hidden = false;
    if (withSwap) {
      var sb = document.getElementById("swap-btn");
      if (sb) sb.addEventListener("click", function () { var t = startEl.value; startEl.value = endEl.value; endEl.value = t; runRange(); });
    }
  }

  function runRange() {
    var r = computeRange();
    if (r.error) {
      lastResult = null;
      if (r.error === "empty") lastError = { k: "tool.msg.empty", d: "Select a start and end date.", swap: false };
      else if (r.error === "afterEnd") lastError = { k: "tool.msg.afterEnd", d: "The start date is after the end date.", swap: true };
      else lastError = { k: "tool.msg.tooLong", d: "That range is too long — up to 10 years is supported.", swap: false };
      showError(lastError.k, lastError.d, lastError.swap);
      return;
    }
    lastError = null;
    lastResult = { kind: "range", data: r };
    resultEl.innerHTML = renderRange(r); resultEl.hidden = false;
  }
  function runAdd() {
    var r = computeAdd();
    if (r.error) {
      lastResult = null;
      if (r.error === "emptyStart") lastError = { k: "tool.msg.emptyStart", d: "Select a start date.", swap: false };
      else if (r.error === "badCount") lastError = { k: "tool.msg.badCount", d: "Enter a whole number of business days from 1 to 365.", swap: false };
      else lastError = { k: "tool.msg.tooLong", d: "That range is too long — up to 10 years is supported.", swap: false };
      showError(lastError.k, lastError.d, false);
      return;
    }
    lastError = null;
    lastResult = { kind: "add", data: r };
    resultEl.innerHTML = renderAdd(r); resultEl.hidden = false;
  }
  function recompute() { if (activeTab === 1) runRange(); else runAdd(); }

  /* ---- 빠른 기간 프리셋 (이번 달/분기/올해) ---- */
  function quickRange(kind) {
    var now = new Date(), y = now.getFullYear(), m = now.getMonth(), s, e, q;
    if (kind === "quarter") { q = Math.floor(m / 3); s = new Date(y, q * 3, 1); e = new Date(y, q * 3 + 3, 0); }
    else if (kind === "year") { s = new Date(y, 0, 1); e = new Date(y, 11, 31); }
    else { s = new Date(y, m, 1); e = new Date(y, m + 1, 0); }
    startEl.value = toKey(s); endEl.value = toKey(e);
    runRange();
  }

  /* ---- custom holidays ---- */
  var customMsgTimer = null;
  function flashCustom(key, def) {
    if (!customMsgEl) return;
    customMsgEl.textContent = tr(key, def);
    clearTimeout(customMsgTimer);
    customMsgTimer = setTimeout(function () { customMsgEl.textContent = ""; }, 3200);
  }
  function renderCustom() {
    if (!customListEl) return;
    var list = state.custom.slice().sort();
    if (!list.length) {
      customListEl.innerHTML = '<p style="color:var(--muted);font-size:13px;margin:0;">' + esc(tr("tool.customEmpty", "No custom holidays added yet.")) + "</p>";
      return;
    }
    var html = '<div style="display:flex;flex-wrap:wrap;gap:8px;">';
    list.forEach(function (dstr) {
      html += '<span style="display:inline-flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:4px 6px 4px 12px;font-size:13px;">' +
        esc(fmtShort(parseDate(dstr))) +
        '<button type="button" class="cust-del" data-d="' + esc(dstr) + '" aria-label="' + esc(tr("tool.removeAria", "Remove holiday")) +
        '" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;line-height:1;padding:0 2px;">&times;</button></span>';
    });
    html += "</div>";
    customListEl.innerHTML = html;
    var dels = customListEl.querySelectorAll(".cust-del");
    for (var i = 0; i < dels.length; i++) {
      dels[i].addEventListener("click", function () {
        var d = this.getAttribute("data-d"), idx = state.custom.indexOf(d);
        if (idx >= 0) { state.custom.splice(idx, 1); persist(); renderCustom(); recompute(); }
      });
    }
  }
  function addCustom() {
    var v = customInput ? customInput.value : "";
    if (!v || !isValid(v)) { flashCustom("tool.msg.emptyStart", "Select a date first."); return; }
    if (weekendSet(weekendEl.value)[parseDate(v).getDay()]) { flashCustom("tool.msg.weekendSkip", "That date is a weekend — it's already excluded."); return; }
    if (state.custom.indexOf(v) >= 0) { flashCustom("tool.msg.dup", "That date is already excluded."); return; }
    state.custom.push(v); persist();
    if (customInput) customInput.value = "";
    if (customMsgEl) customMsgEl.textContent = "";
    renderCustom(); recompute();
  }

  /* ---- tabs ---- */
  function switchTab(n) {
    activeTab = n; state.tab = n; persist();
    var on = "var(--accent)", onC = "#fff", off = "transparent", offC = "var(--ink)";
    tabBtn1.style.background = n === 1 ? on : off; tabBtn1.style.color = n === 1 ? onC : offC;
    tabBtn2.style.background = n === 2 ? on : off; tabBtn2.style.color = n === 2 ? onC : offC;
    tabBtn1.setAttribute("aria-selected", n === 1 ? "true" : "false");
    tabBtn2.setAttribute("aria-selected", n === 2 ? "true" : "false");
    panel1.hidden = n !== 1; panel2.hidden = n !== 2;
    lastResult = null; lastError = null;
    recompute();
  }

  /* ---- wire events ---- */
  if (tabBtn1) tabBtn1.addEventListener("click", function () { switchTab(1); });
  if (tabBtn2) tabBtn2.addEventListener("click", function () { switchTab(2); });
  if (customAddBtn) customAddBtn.addEventListener("click", addCustom);
  if (quickWrap) {
    quickWrap.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest("[data-range]") : null;
      if (b) quickRange(b.getAttribute("data-range"));
    });
  }
  [startEl, endEl, incStartEl, incEndEl].forEach(function (el) { if (el) el.addEventListener("input", function () { persistSettings(); if (activeTab === 1) runRange(); }); });
  [start2El, nEl, dirEl].forEach(function (el) { if (el) el.addEventListener("input", function () { persistSettings(); if (activeTab === 2) runAdd(); }); });
  [presetEl, weekendEl].forEach(function (el) {
    if (el) el.addEventListener("change", function () {
      if (el === presetEl) { autoCountry = false; renderCountryNote(); }
      persistSettings(); recompute();
    });
  });

  function persistSettings() {
    state.preset = presetEl.value; state.weekend = weekendEl.value;
    state.incStart = incStartEl.checked; state.incEnd = incEndEl.checked;
    state.dir = dirEl.value; persist();
  }

  /* ---- language change: re-render dynamic strings ---- */
  document.addEventListener("i18n:change", function () {
    buildCountrySelect(); renderCountryNote(); renderCustom();
    if (lastResult) {
      resultEl.innerHTML = (lastResult.kind === "range") ? renderRange(lastResult.data) : renderAdd(lastResult.data);
      resultEl.hidden = false;
    } else if (lastError) {
      showError(lastError.k, lastError.d, lastError.swap);
    }
    if (storeNoteEl && !storageOk) storeNoteEl.textContent = tr("tool.msg.noStorage", "Settings can't be saved in private mode — they'll last for this session only.");
  });

  /* ---- init ---- */
  (function init() {
    buildCountrySelect();
    presetEl.value = countryOf(state.preset) ? state.preset : "none";
    if (state.weekend) weekendEl.value = state.weekend;
    if (typeof state.incStart === "boolean") incStartEl.checked = state.incStart;
    if (typeof state.incEnd === "boolean") incEndEl.checked = state.incEnd;
    if (state.dir) dirEl.value = state.dir;
    renderCountryNote();

    // 스마트 기본값: 오늘 → 이번 달 말일이면 첫 화면부터 답이 보인다 (입력 0개로 결과)
    var today = new Date();
    if (!startEl.value) startEl.value = toKey(today);
    if (!endEl.value) endEl.value = toKey(new Date(today.getFullYear(), today.getMonth() + 1, 0));
    if (!start2El.value) start2El.value = toKey(today);

    if (!storageOk && storeNoteEl) {
      storeNoteEl.hidden = false;
      storeNoteEl.textContent = tr("tool.msg.noStorage", "Settings can't be saved in private mode — they'll last for this session only.");
    }
    switchTab(activeTab);
    renderCustom();
  })();
  // TOOLJS:END
})();
