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

  /* ==========================================================================
     CORE:START — 순수 계산부. document/window DOM 을 참조하지 않는다.
     이 구간은 node 로 그대로 eval 해서 단위 검증한다 (테스트용 훅 없음).
     공휴일 규칙 엔진(RULES/STATIC/STATIC_RANGE/ruleDate/yearHolidays/holidayMap)은
     부모 workday-calc js/app.js 에서 이식. 원본 holidayMap 은 state.custom 을 클로저로
     읽었으나, 여기서는 custom 을 인자로 받는다 (상태 모양이 다름).
     ========================================================================== */

  var MAX_ROWS = 10000;        // 이 이상은 앞부분만 처리하고 경고
  var MAX_ROW_DAYS = 5000;     // 한 작업의 소요 영업일 상한
  var MAX_TOTAL_BIZ = 26000;   // 합계 상한 ≈ 영업일 100년. 역산이 마감 100년 이전으로 벗어나는 것을 막는다
  var MAX_FILE_BYTES = 5 * 1024 * 1024;
  var MIN_YEAR = 1970, MAX_YEAR = 2199;

  /* ---- i18n helper (카탈로그 없으면 폴백 문자열) ---- */
  function tr(key, fallback) {
    try {
      if (typeof window !== "undefined" && window.I18N) {
        var v = window.I18N.t(key);
        if (v != null) return v;
      }
    } catch (e) { /* i18n absent */ }
    return fallback;
  }
  function curLang() {
    try {
      if (typeof window !== "undefined" && window.I18N && window.I18N.lang) return window.I18N.lang() || "en";
    } catch (e) { /* noop */ }
    return "en";
  }
  function fmt(s, map) {
    return String(s).replace(/\{(\w+)\}/g, function (_, k) { return map[k] != null ? map[k] : "{" + k + "}"; });
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---- Date helpers (로컬 자정 기준 — UTC 파싱 금지) ---- */
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function toKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseDate(str) {
    var p = String(str).split("-"), d = new Date(+p[0], +p[1] - 1, +p[2]);
    if (+p[0] < 100) d.setFullYear(+p[0]);
    return d;
  }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function isValidDate(str) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str || "")) return false;
    var d = parseDate(str);
    if (isNaN(d.getTime())) return false;
    return toKey(d) === str;
  }
  function inYearRange(d) { var y = d.getFullYear(); return y >= MIN_YEAR && y <= MAX_YEAR; }
  function weekendSet(def) { return def === "frisat" ? { 5: 1, 6: 1 } : { 0: 1, 6: 1 }; }

  /* =========================================================================
     공휴일 데이터 — 100% 정적. 외부 API·네트워크 호출 없음 (pure-static 아키타입).
       (1) RULES[c]  — 법으로 규칙이 고정된 공휴일(고정일/n번째 요일/부활절 기준/일본 춘추분)
                       → 계산으로 구하므로 연도 제한 없음.
       (2) STATIC[c] — 음력·연간 고시로 움직여 계산 불가 → 연도별로 박고 연 1회 갱신.
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

  /* 계산 불가능한 공휴일(음력) — 연 1회 손으로 갱신하는 정적 표. */
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
  var STATIC_RANGE = { "kr": { from: 2025, to: 2027 } };

  /* 국가 목록 — c: 저장 코드, r: ISO 지역(Intl 표시명), en: 폴백 이름, scope/note: 라벨 키 */
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

  /* ---- 프리셋 + 수동추가를 합친 공휴일 맵. custom 은 인자 (부모와 달리 클로저 참조 안 함) ---- */
  function holidayMap(c, minY, maxY, custom) {
    var map = {}, y, k, src;
    if (c && c !== "none" && (RULES[c] || STATIC[c])) {
      for (y = minY - 1; y <= maxY + 1; y++) {   // ±1년: 연말 관측일이 해를 넘는 경우 대비
        src = yearHolidays(c, y);
        for (k in src) if (src.hasOwnProperty(k)) map[k] = src[k];
      }
    }
    var cname = tr("tool.customName", "Custom holiday"), list = custom || [];
    for (var i = 0; i < list.length; i++) { if (map[list[i]] == null) map[list[i]] = cname; }
    return map;
  }

  /* ---- 영업일 판정 / 이동 ---- */
  function isBiz(d, wknd, hmap) { return !wknd[d.getDay()] && hmap[toKey(d)] == null; }
  function lastBizOnOrBefore(d, wknd, hmap) {
    var x = new Date(d.getTime()), g = 0;
    while (!isBiz(x, wknd, hmap) && g++ < 400) x = addDays(x, -1);
    return x;
  }
  function prevBiz(d, wknd, hmap) {
    var x = addDays(d, -1), g = 0;
    while (!isBiz(x, wknd, hmap) && g++ < 400) x = addDays(x, -1);
    return x;
  }
  /* (a, b] 구간의 영업일 수 — a 제외, b 포함 */
  function countBizBetween(a, b, wknd, hmap) {
    var n = 0, d = addDays(a, 1), g = 0;
    while (d.getTime() <= b.getTime() && g++ < 200000) {
      if (isBiz(d, wknd, hmap)) n++;
      d = addDays(d, 1);
    }
    return n;
  }

  /* ---- 숫자 파싱 — 소요일 칸. 날짜처럼 생긴 값은 거부한다 ---- */
  function parseNum(s) {
    if (s == null) return null;
    s = String(s).trim();
    if (!s) return null;
    if (/[\/:]/.test(s)) return null;                    // 2026/05/01, 09:30 → 소요일이 아님
    s = s.replace(/\s+/g, "");
    if (/^-?\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, "");   // 1,500 = 천단위 구분
    var m = /^(-?\d+(?:[.,]\d+)?)(?:[a-zÀ-ɏ가-힣぀-ヿ一-鿿Ѐ-ӿ]{0,6})?$/i.exec(s);
    if (!m) return null;
    var v = parseFloat(m[1].replace(",", "."));
    return isFinite(v) ? v : null;
  }

  /* ---- RFC4180 자체 파서 (따옴표 이스케이프·셀내 개행). 외부 라이브러리 0 ---- */
  function parseDelimited(text, delim) {
    var rows = [], row = [], field = "", i = 0, inQ = false, c, quoted = false;
    while (i < text.length) {
      c = text.charAt(i);
      if (inQ) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"' && field === "" && !quoted) { inQ = true; quoted = true; i++; continue; }
      if (c === delim) { row.push(field); field = ""; quoted = false; i++; continue; }
      if (c === "\r") {
        if (text.charAt(i + 1) === "\n") i++;
        row.push(field); rows.push(row); row = []; field = ""; quoted = false; i++; continue;
      }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; quoted = false; i++; continue; }
      field += c; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /* 첫 비어있지 않은 논리적 행(따옴표 안의 개행은 행 끝이 아니다)을 원문 그대로 뽑는다 */
  function firstRowRaw(text) {
    var i = 0, inQ = false, out = "", c;
    while (i < text.length) {
      c = text.charAt(i);
      if (inQ) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { out += '""'; i += 2; continue; }
          inQ = false; out += '"'; i++; continue;
        }
        out += c; i++; continue;
      }
      if (c === '"') { inQ = true; out += '"'; i++; continue; }
      if (c === "\r" || c === "\n") {
        if (out.replace(/\s/g, "") === "") { out = ""; i++; continue; }   // 선행 빈 줄은 건너뛴다
        break;
      }
      out += c; i++;
    }
    return out;
  }
  function countOutside(s, ch) {
    var n = 0, inQ = false, c;
    for (var i = 0; i < s.length; i++) {
      c = s.charAt(i);
      if (c === '"') {
        if (inQ && s.charAt(i + 1) === '"') { i++; continue; }
        inQ = !inQ; continue;
      }
      if (!inQ && c === ch) n++;
    }
    return n;
  }
  /* 따옴표 밖 탭·,·; 중 빈도 최다 (동수면 탭 > , > ;) */
  function detectDelim(text) {
    var head = firstRowRaw(text), best = "\t", bestN = -1, cands = ["\t", ",", ";"], i, n;
    for (i = 0; i < cands.length; i++) {
      n = countOutside(head, cands[i]);
      if (n > bestN) { bestN = n; best = cands[i]; }
    }
    return bestN > 0 ? best : "\t";
  }

  function maxCols(rows) {
    var n = 0;
    for (var i = 0; i < rows.length; i++) if (rows[i].length > n) n = rows[i].length;
    return n;
  }
  function isBlankRow(r) {
    for (var i = 0; i < r.length; i++) if (String(r[i] == null ? "" : r[i]).trim() !== "") return false;
    return true;
  }
  /* 헤더 판정: 2번째 열이 숫자가 아니고 행이 2행 이상 */
  function looksHeader(rows) {
    if (rows.length < 2) return false;
    var r0 = rows[0];
    if (!r0 || r0.length < 2) return false;
    return parseNum(r0[1]) == null;
  }

  var HDR_TASK = /(task|name|activity|item|step|작업|업무|단계|タスク|項目|tarea|tâche|aufgabe|tarefa|задач)/i;
  var HDR_DAYS = /(days?|duration|effort|work|소요|일수|기간|工数|期間|日数|días|dias|dura|jours|dauer|tage|дн)/i;
  var HDR_OWNER = /(owner|assignee|resp|person|담당|담당자|担当|负责|responsable|verantwort|ответств)/i;

  function firstUnused(cols, map, from) {
    for (var i = from; i < cols; i++) if (i !== map.task && i !== map.days && i !== map.owner) return i;
    return -1;
  }
  /* 헤더명 매칭 → 실패 시 1·2·3열 순서 폴백. 사용자가 드롭다운으로 언제든 덮어쓴다 */
  function detectMapping(rows, hasHeader) {
    var cols = maxCols(rows), map = { task: -1, days: -1, owner: -1 }, matched = false, i, v;
    if (hasHeader && rows.length) {
      for (i = 0; i < cols; i++) {
        v = String(rows[0][i] == null ? "" : rows[0][i]).trim();
        if (!v) continue;
        if (map.days < 0 && HDR_DAYS.test(v)) { map.days = i; matched = true; continue; }
        if (map.owner < 0 && HDR_OWNER.test(v)) { map.owner = i; matched = true; continue; }
        if (map.task < 0 && HDR_TASK.test(v)) { map.task = i; matched = true; continue; }
      }
    }
    if (map.task < 0) map.task = firstUnused(cols, map, 0);
    if (map.days < 0) map.days = firstUnused(cols, map, 0);
    if (map.owner < 0) map.owner = firstUnused(cols, map, 0);
    return { map: map, matched: matched, cols: cols };
  }

  /* ---- 행 정규화: 더러운 행을 버리지 않고 사유와 함께 남긴다 (철칙 5) ---- */
  function rowText(r) { return r.join(" | ").slice(0, 120); }
  function normalizeRows(rows, map, hasHeader) {
    var valid = [], excluded = [], adjusted = [], i, r, line, name, owner, raw, n, up;
    for (i = hasHeader ? 1 : 0; i < rows.length; i++) {
      r = rows[i]; line = i + 1;
      if (isBlankRow(r)) continue;                  // 사용자가 만든 행이 아니다 — 조용히 넘어가도 되는 유일한 경우
      name = map.task >= 0 ? String(r[map.task] == null ? "" : r[map.task]).trim() : "";
      owner = map.owner >= 0 ? String(r[map.owner] == null ? "" : r[map.owner]).trim() : "";
      raw = map.days >= 0 ? r[map.days] : null;
      if (!name) { excluded.push({ line: line, reason: "noName", raw: rowText(r) }); continue; }
      if (map.days < 0) { excluded.push({ line: line, reason: "noDaysCol", raw: rowText(r) }); continue; }
      n = parseNum(raw);
      if (n == null || n <= 0) { excluded.push({ line: line, reason: "badDays", raw: rowText(r) }); continue; }
      up = Math.ceil(n);
      if (up > MAX_ROW_DAYS) { excluded.push({ line: line, reason: "tooManyDays", raw: rowText(r) }); continue; }
      if (up !== n) adjusted.push({ line: line, name: name, from: n, to: up });
      valid.push({ name: name, owner: owner, days: up, line: line });
    }
    return { valid: valid, excluded: excluded, adjusted: adjusted };
  }

  /* ---- 핵심: 마감에서 거꾸로 1패스 역산 ----
     cursor = 마감일 이하의 마지막 영업일
     i = 마지막 행 → 첫 행: finish[i] = cursor; start[i] = finish[i] 에서 (소요일-1) 영업일 후진;
                            cursor = start[i] 의 직전 영업일
     포함 규칙: 소요일 1 = 착수일 == 완료일 */
  function computeSchedule(o) {
    var tasks = o.tasks || [];
    if (!tasks.length) return { error: "noTasks" };
    var totalBiz = 0, i;
    for (i = 0; i < tasks.length; i++) totalBiz += tasks[i].days;
    if (totalBiz > MAX_TOTAL_BIZ) return { error: "unrealistic", totalBiz: totalBiz };

    var wknd = weekendSet(o.weekend);
    var dlY = o.deadline.getFullYear(), baseY = o.baseline.getFullYear();
    var yearsBack = Math.ceil(totalBiz / 200) + 1;
    var minY = Math.min(dlY - yearsBack - 1, baseY - 1);
    var maxY = Math.max(dlY + 1, baseY + 1);
    var hmap = holidayMap(o.preset, minY, maxY, o.custom);   // 결정적 1회 선계산

    var cursor = lastBizOnOrBefore(o.deadline, wknd, hmap);
    var shifted = Math.round((o.deadline.getTime() - cursor.getTime()) / 86400000);

    var out = new Array(tasks.length), s, togo;
    for (i = tasks.length - 1; i >= 0; i--) {
      s = cursor; togo = tasks[i].days - 1;
      while (togo > 0) { s = prevBiz(s, wknd, hmap); togo--; }
      out[i] = { name: tasks[i].name, owner: tasks[i].owner, days: tasks[i].days, line: tasks[i].line, start: s, finish: cursor };
      if (i > 0) cursor = prevBiz(s, wknd, hmap);
    }

    var first = out[0].start, last = out[out.length - 1].finish;
    var verdict;
    if (first.getTime() > o.baseline.getTime()) {
      verdict = { kind: "slack", days: countBizBetween(o.baseline, first, wknd, hmap) };
    } else if (first.getTime() === o.baseline.getTime()) {
      verdict = { kind: "today", days: 0 };
    } else {
      verdict = { kind: "late", days: countBizBetween(first, o.baseline, wknd, hmap) };
    }

    /* 제외된 공휴일 목록 (일정 구간 안에서 실제로 건너뛴 것만 — 신뢰 요소) */
    var skipped = [], d = new Date(first.getTime()), g = 0, key;
    while (d.getTime() <= last.getTime() && g++ < 400000) {
      if (!wknd[d.getDay()]) {
        key = toKey(d);
        if (hmap[key] != null) skipped.push({ date: new Date(d.getTime()), name: hmap[key] });
      }
      d = addDays(d, 1);
    }

    /* KR 음력표 범위 밖이면 경고 */
    var lim = STATIC_RANGE[o.preset], lunarWarn = false;
    if (lim) {
      for (var y = first.getFullYear(); y <= last.getFullYear(); y++) if (y < lim.from || y > lim.to) lunarWarn = true;
    }

    return {
      tasks: out, verdict: verdict, totalBiz: totalBiz, skipped: skipped,
      shifted: shifted, deadline: o.deadline, baseline: o.baseline,
      start: first, end: last, preset: o.preset, lunarWarn: lunarWarn,
      noHolidayData: !(o.preset && o.preset !== "none" && (RULES[o.preset] || STATIC[o.preset])),
      deadlinePast: o.deadline.getTime() < o.baseline.getTime()
    };
  }

  /* ---- 출력 직렬화 ---- */
  function csvCell(s) {
    s = String(s == null ? "" : s);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function tsvCell(s) { return String(s == null ? "" : s).replace(/[\t\r\n]+/g, " "); }
  function buildCsv(res, h) {
    var lines = [["#", h.task, h.owner, h.start, h.finish, h.days].map(csvCell).join(",")];
    res.tasks.forEach(function (t, i) {
      lines.push([i + 1, t.name, t.owner, toKey(t.start), toKey(t.finish), t.days].map(csvCell).join(","));
    });
    return lines.join("\r\n");
  }
  function buildTsv(res, h) {
    var lines = [["#", h.task, h.owner, h.start, h.finish, h.days].map(tsvCell).join("\t")];
    res.tasks.forEach(function (t, i) {
      lines.push([i + 1, t.name, t.owner, toKey(t.start), toKey(t.finish), t.days].map(tsvCell).join("\t"));
    });
    return lines.join("\r\n");
  }
  /* 중립 간트 포맷 — 특정 서비스 전용이 아니다. 컬럼명은 기계가 읽으므로 번역하지 않는다. */
  function buildGanttCsv(res) {
    var lines = ["Task Name,Start Date,Duration"];
    res.tasks.forEach(function (t) {
      lines.push([csvCell(t.name), toKey(t.start), t.days].join(","));
    });
    return lines.join("\r\n");
  }
  /* CORE:END */

  /* ==========================================================================
     DOM 배선부
     ========================================================================== */
  var cfg = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "workback-schedule";
  var STATE_KEY = SLUG + ":state";

  /* ---- 브라우저 지역 → 국가/주말 추정 (사용자가 언제든 바꾼다) ---- */
  var REGION_COUNTRY = { US: "us", GB: "uk", CA: "ca", AU: "au", DE: "de", FR: "fr", ES: "es", BR: "br", MX: "mx", IN: "in", RU: "ru", JP: "jp", KR: "kr" };
  var LANG_REGION = { en: "US", de: "DE", fr: "FR", es: "ES", pt: "BR", ru: "RU", hi: "IN", ja: "JP", ko: "KR", zh: "CN", ar: "EG", bn: "BD", ur: "PK", id: "ID" };
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

  /* ---- 표시 서식 (Intl — 하드코딩 금지) ---- */
  function fmtShort(d) {
    try { return new Intl.DateTimeFormat(curLang(), { year: "numeric", month: "short", day: "numeric" }).format(d); }
    catch (e) { return toKey(d); }
  }
  function fmtDow(d) {
    try { return new Intl.DateTimeFormat(curLang(), { weekday: "short" }).format(d); }
    catch (e) { return ""; }
  }
  function fmtLong(d) {
    try { return new Intl.DateTimeFormat(curLang(), { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(d); }
    catch (e) { return toKey(d); }
  }
  function fmtInt(n) {
    try { return new Intl.NumberFormat(curLang()).format(n); }
    catch (e) { return String(n); }
  }

  /* ---- storage (localStorage prefix "<slug>:" 또는 세션 폴백) ---- */
  var storageOk = true, sessionState = {};
  (function () {
    try { localStorage.setItem(SLUG + ":_t", "1"); localStorage.removeItem(SLUG + ":_t"); }
    catch (e) { storageOk = false; }
  })();
  function readState() {
    if (storageOk) { try { var r = localStorage.getItem(STATE_KEY); return r ? JSON.parse(r) : {}; } catch (e) { return {}; } }
    return sessionState;
  }
  var state = readState();
  if (!Array.isArray(state.custom)) state.custom = [];
  if (!state.map || typeof state.map !== "object") state.map = null;
  function persist() {
    if (storageOk) { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) { /* quota */ } }
    else { sessionState = state; }
  }

  var region = detectRegion();
  var autoCountry = false;
  if (!state.preset) { state.preset = REGION_COUNTRY[region] || "none"; autoCountry = true; }
  if (!state.weekend) { state.weekend = FRISAT_REGIONS[region] ? "frisat" : "satsun"; }

  /* ---- DOM refs ---- */
  var deadlineEl = document.getElementById("in-deadline");
  var tasksEl = document.getElementById("in-tasks");
  var fileEl = document.getElementById("in-file"), fileBtn = document.getElementById("file-btn");
  var dropZone = document.getElementById("drop-zone");
  var sampleBtn = document.getElementById("sample-btn");
  var encBadge = document.getElementById("enc-badge"), rowsBadge = document.getElementById("rows-badge");
  var previewWrap = document.getElementById("preview-wrap"), previewTable = document.getElementById("preview-table");
  var mapTaskEl = document.getElementById("map-task"), mapDaysEl = document.getElementById("map-days"), mapOwnerEl = document.getElementById("map-owner");
  var presetEl = document.getElementById("in-preset"), weekendEl = document.getElementById("in-weekend");
  var countryNoteEl = document.getElementById("country-note");
  var baselineEl = document.getElementById("in-baseline");
  var customInput = document.getElementById("in-custom"), customAddBtn = document.getElementById("custom-add-btn");
  var customListEl = document.getElementById("custom-list"), customMsgEl = document.getElementById("custom-msg");
  var runBtn = document.getElementById("run-btn"), resultEl = document.getElementById("result");
  var exportWrap = document.getElementById("export-wrap"), exportMsg = document.getElementById("export-msg");
  var csvBtn = document.getElementById("csv-btn"), copyBtn = document.getElementById("copy-btn"), ganttBtn = document.getElementById("gantt-btn");
  var storeNoteEl = document.getElementById("store-note");

  var parsed = null;      // { rows, hasHeader, cols, delim } — 세션 메모리에만 산다. 저장하지 않는다
  var lastRes = null;     // 언어 전환 시 다시 렌더하기 위한 마지막 계산 결과
  var lastErr = null;
  var rowCapped = false;

  /* ---- 국가 선택 UI (표시명은 Intl.DisplayNames 로 현지화) ---- */
  function countryName(co) {
    try {
      if (typeof Intl !== "undefined" && Intl.DisplayNames) {
        var n = new Intl.DisplayNames([curLang()], { type: "region" }).of(co.r);
        if (n && n !== co.r) return n;
      }
    } catch (e) { /* 구형 브라우저 — 영문 폴백 */ }
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
    countryNoteEl.hidden = parts.length === 0;
  }

  /* ---- 수동 공휴일 ---- */
  function renderCustomList() {
    if (!customListEl) return;
    customListEl.textContent = "";
    if (!state.custom.length) {
      var p = document.createElement("p");
      p.style.cssText = "color:var(--muted);font-size:13px;margin:0;";
      p.textContent = tr("tool.customEmpty", "No custom holidays added yet.");
      customListEl.appendChild(p);
      return;
    }
    var wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;";
    state.custom.slice().sort().forEach(function (k) {
      var chip = document.createElement("span");
      chip.style.cssText = "display:inline-flex;align-items:center;gap:6px;padding:5px 8px 5px 11px;border:1px solid var(--line);border-radius:999px;background:var(--bg);font-size:13px;";
      chip.appendChild(document.createTextNode(fmtShort(parseDate(k))));
      var x = document.createElement("button");
      x.type = "button";
      x.textContent = "×";
      x.setAttribute("aria-label", tr("tool.removeAria", "Remove holiday") + " " + k);
      x.style.cssText = "border:none;background:none;color:var(--muted);font-size:16px;line-height:1;cursor:pointer;padding:0 2px;";
      x.addEventListener("click", function () {
        state.custom = state.custom.filter(function (v) { return v !== k; });
        persist(); renderCustomList(); run();
      });
      chip.appendChild(x);
      wrap.appendChild(chip);
    });
    customListEl.appendChild(wrap);
  }
  function addCustom() {
    var v = customInput.value;
    if (!v || !isValidDate(v)) { customMsgEl.textContent = tr("tool.msg.noDeadline", "Pick a valid date."); return; }
    var d = parseDate(v);
    if (!inYearRange(d)) { customMsgEl.textContent = fmt(tr("tool.msg.dateRange", "Dates must be between {from} and {to}."), { from: MIN_YEAR, to: MAX_YEAR }); return; }
    var wknd = weekendSet(weekendEl.value);
    if (wknd[d.getDay()]) { customMsgEl.textContent = tr("tool.msg.weekendSkip", "That date is a weekend — it's already excluded."); return; }
    if (state.custom.indexOf(v) >= 0) { customMsgEl.textContent = tr("tool.msg.dup", "That date is already excluded."); return; }
    state.custom.push(v); persist();
    customMsgEl.textContent = "";
    customInput.value = "";
    renderCustomList(); run();
  }

  /* ---- 입력 파싱 파이프라인 ---- */
  function ingestText(text, enc) {
    encBadge.hidden = (enc !== "euc-kr");
    if (!text || !text.replace(/\s/g, "")) { parsed = null; renderPreview(); return; }
    var delim = detectDelim(text);
    var rows = parseDelimited(text, delim);
    rowCapped = false;
    if (rows.length > MAX_ROWS) { rows = rows.slice(0, MAX_ROWS); rowCapped = true; }
    var hasHeader = looksHeader(rows);
    var det = detectMapping(rows, hasHeader);
    var map = det.map;
    /* 저장된 컬럼 매핑은 헤더명 매칭이 실패했을 때만, 그리고 범위 안일 때만 적용한다 */
    if (!det.matched && state.map && inRange(state.map, det.cols)) {
      map = { task: state.map.task, days: state.map.days, owner: state.map.owner };
    }
    parsed = { rows: rows, hasHeader: hasHeader, cols: det.cols, delim: delim, map: map };
    renderPreview();
  }
  function inRange(m, cols) {
    return m.task >= 0 && m.task < cols && m.days >= 0 && m.days < cols && m.owner < cols;
  }
  function colLabel(i) {
    if (!parsed) return "";
    if (parsed.hasHeader) {
      var v = String(parsed.rows[0][i] == null ? "" : parsed.rows[0][i]).trim();
      if (v) return v;
    }
    return fmt(tr("tool.colGeneric", "Column {n}"), { n: i + 1 });
  }
  function fillMapSelect(sel, cur, allowNone) {
    if (!sel) return;
    sel.textContent = "";
    if (allowNone) {
      var op0 = document.createElement("option");
      op0.value = "-1"; op0.textContent = tr("tool.colNone", "— none —");
      sel.appendChild(op0);
    }
    for (var i = 0; i < parsed.cols; i++) {
      var op = document.createElement("option");
      op.value = String(i); op.textContent = colLabel(i);
      sel.appendChild(op);
    }
    sel.value = String(cur);
    if (!sel.value) sel.value = allowNone ? "-1" : "0";
  }
  function renderPreview() {
    if (!parsed) {
      previewWrap.hidden = true;
      rowsBadge.hidden = true;
      return;
    }
    fillMapSelect(mapTaskEl, parsed.map.task, false);
    fillMapSelect(mapDaysEl, parsed.map.days, true);   // 열이 1개뿐인 입력 → "없음" 이 되어 noDaysCol 사유가 뜬다
    fillMapSelect(mapOwnerEl, parsed.map.owner, true);

    /* 첫 5행 미리보기 */
    var body = parsed.rows.slice(parsed.hasHeader ? 1 : 0).filter(function (r) { return !isBlankRow(r); });
    var show = body.slice(0, 5);
    var html = '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px;"><thead><tr>';
    for (var c = 0; c < parsed.cols; c++) {
      html += '<th style="text-align:start;padding:5px 8px;border-bottom:1px solid var(--line);color:var(--muted);font-weight:600;white-space:nowrap;">' + esc(colLabel(c)) + "</th>";
    }
    html += "</tr></thead><tbody>";
    show.forEach(function (r) {
      html += "<tr>";
      for (var c2 = 0; c2 < parsed.cols; c2++) {
        html += '<td style="padding:5px 8px;border-bottom:1px solid var(--line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;">' + esc(String(r[c2] == null ? "" : r[c2])) + "</td>";
      }
      html += "</tr>";
    });
    html += "</tbody></table>";
    previewTable.innerHTML = html;
    previewWrap.hidden = false;

    rowsBadge.textContent = fmt(tr("tool.rowsRead", "{n} rows read"), { n: fmtInt(body.length) });
    rowsBadge.hidden = false;
  }

  /* ---- 파일 (File API — 업로드 아님) ---- */
  function decodeBuffer(buf) {
    var bytes = new Uint8Array(buf);
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), enc: "utf-8" };
    }
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), enc: "utf-16le" };
    }
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
      return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), enc: "utf-16be" };
    }
    try {
      return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), enc: "utf-8" };
    } catch (e) {
      try { return { text: new TextDecoder("euc-kr").decode(bytes), enc: "euc-kr" }; }   // 국내 PMO 엑셀 CSV
      catch (e2) { return { text: new TextDecoder("utf-8").decode(bytes), enc: "utf-8" }; }
    }
  }
  function readFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      showError("fileBig");
      return;
    }
    var fr = new FileReader();
    fr.onload = function () {
      var dec;
      try { dec = decodeBuffer(fr.result); }
      catch (e) { showError("fileErr"); return; }
      tasksEl.value = dec.text;
      ingestText(dec.text, dec.enc);
      run();
    };
    fr.onerror = function () { showError("fileErr"); };
    try { fr.readAsArrayBuffer(file); }
    catch (e) { showError("fileErr"); }
  }

  /* ---- 렌더 ---- */
  function showError(code) {
    lastRes = null; lastErr = code;
    exportWrap.hidden = true;
    renderError(code);
  }
  function renderError(code) {
    var msg = {
      empty: tr("tool.msg.empty", "Paste your task list above — one task per line, with the number of business days it needs."),
      noDeadline: tr("tool.msg.noDeadline", "Pick a deadline first."),
      dateRange: fmt(tr("tool.msg.dateRange", "Dates must be between {from} and {to}."), { from: MIN_YEAR, to: MAX_YEAR }),
      unrealistic: tr("tool.msg.unrealistic", "The durations add up to more than a century of business days — check the business days column."),
      fileErr: tr("tool.msg.fileErr", "That file couldn't be read. Try saving it as CSV or paste the rows instead."),
      fileBig: tr("tool.msg.fileBig", "That file is larger than 5 MB. Paste the task rows instead — this tool schedules task lists, not exports."),
      noTasks: tr("tool.msg.empty", "Paste your task list above — one task per line, with the number of business days it needs.")
    }[code] || "";
    resultEl.textContent = "";
    var p = document.createElement("p");
    p.style.cssText = "margin:0;color:var(--muted);";
    p.textContent = msg;
    resultEl.appendChild(p);
  }
  function reasonText(reason) {
    return {
      noName: tr("tool.reason.noName", "no task name"),
      noDaysCol: tr("tool.reason.noDaysCol", "no business days column — pick one above"),
      badDays: tr("tool.reason.badDays", "business days is not a positive number"),
      tooManyDays: fmt(tr("tool.reason.tooManyDays", "more than {n} business days"), { n: fmtInt(MAX_ROW_DAYS) })
    }[reason] || reason;
  }
  function detailsBlock(summaryText, buildBody) {
    var det = document.createElement("details");
    det.style.cssText = "margin-top:12px;border-top:1px solid color-mix(in srgb, var(--accent) 20%, var(--line));padding-top:10px;";
    var sum = document.createElement("summary");
    sum.style.cssText = "cursor:pointer;font-size:14px;font-weight:600;color:var(--muted);";
    sum.textContent = summaryText;
    det.appendChild(sum);
    buildBody(det);
    return det;
  }

  function render(res, norm) {
    resultEl.textContent = "";

    /* 판정 배지 — 이 도구의 핵심 */
    var badge = document.createElement("div");
    var v = res.verdict, tone, text;
    if (v.kind === "slack") {
      tone = "var(--accent)";
      text = fmt(tr("tool.res.slack", "{n} business days of slack — start by {date} at the latest"), { n: fmtInt(v.days), date: fmtLong(res.start) });
    } else if (v.kind === "today") {
      tone = "#b45309";
      text = fmt(tr("tool.res.today", "Start today — zero slack. Any slip breaks the deadline."), { date: fmtLong(res.start) });
    } else {
      tone = "#b91c1c";
      text = fmt(tr("tool.res.late", "Already {n} business days late — this deadline cannot be met as planned. The chain would have had to start on {date}."), { n: fmtInt(v.days), date: fmtLong(res.start) });
    }
    badge.style.cssText = "font-size:17px;font-weight:700;line-height:1.5;color:" + tone + ";margin-bottom:6px;";
    badge.textContent = text;
    resultEl.appendChild(badge);

    var sum = document.createElement("p");
    sum.style.cssText = "margin:0 0 14px;color:var(--muted);font-size:14px;";
    sum.textContent = fmt(tr("tool.res.summary", "{tasks} tasks · {days} business days of work · {start} → {end}"), {
      tasks: fmtInt(res.tasks.length), days: fmtInt(res.totalBiz),
      start: fmtShort(res.start), end: fmtShort(res.end)
    });
    resultEl.appendChild(sum);

    /* 상황 배지들 */
    var notes = [];
    if (res.shifted > 0) notes.push(fmt(tr("tool.res.deadlineShift", "The deadline isn't a business day — the last task was pulled back {n} day(s) to {date}."), { n: fmtInt(res.shifted), date: fmtShort(res.end) }));
    if (res.deadlinePast) notes.push(tr("tool.res.deadlinePast", "This deadline is already in the past."));
    if (res.noHolidayData) notes.push(tr("tool.res.weekendsOnlyBadge", "No public holiday table for this setting — excluding weekends only."));
    if (res.lunarWarn) notes.push(fmt(tr("tool.res.lunarWarn", "Part of this schedule falls outside {from}–{to}, where the lunar holiday table ends — add those holidays manually."), (STATIC_RANGE[res.preset] || {})));
    if (rowCapped) notes.push(fmt(tr("tool.res.rowCap", "Only the first {n} rows were processed."), { n: fmtInt(MAX_ROWS) }));
    notes.forEach(function (t) {
      var p = document.createElement("p");
      p.style.cssText = "margin:0 0 8px;font-size:13.5px;color:var(--muted);padding-inline-start:10px;border-inline-start:3px solid color-mix(in srgb, var(--accent) 35%, var(--line));";
      p.textContent = t;
      resultEl.appendChild(p);
    });

    /* 작업별 표 */
    var wrap = document.createElement("div");
    wrap.style.cssText = "overflow-x:auto;margin-top:6px;";
    var h = {
      task: tr("tool.res.thTask", "Task"), owner: tr("tool.res.thOwner", "Owner"),
      start: tr("tool.res.thStart", "Start"), finish: tr("tool.res.thFinish", "Finish"),
      days: tr("tool.res.thDays", "Business days")
    };
    var html = '<table style="width:100%;border-collapse:collapse;font-size:14px;"><thead><tr>';
    ["#", h.task, h.owner, h.start, h.finish, h.days].forEach(function (t, i) {
      html += '<th style="text-align:' + (i >= 3 ? "end" : "start") + ';padding:7px 8px;border-bottom:1px solid var(--line);color:var(--muted);font-weight:600;font-size:12.5px;white-space:nowrap;">' + esc(t) + "</th>";
    });
    html += "</tr></thead><tbody>";
    res.tasks.forEach(function (t, i) {
      var late = t.start.getTime() < res.baseline.getTime();
      html += "<tr>";
      html += '<td style="padding:7px 8px;border-bottom:1px solid var(--line);color:var(--muted);">' + (i + 1) + "</td>";
      html += '<td style="padding:7px 8px;border-bottom:1px solid var(--line);font-weight:600;">' + esc(t.name) + "</td>";
      html += '<td style="padding:7px 8px;border-bottom:1px solid var(--line);color:var(--muted);">' + esc(t.owner || "—") + "</td>";
      html += '<td style="padding:7px 8px;border-bottom:1px solid var(--line);text-align:end;white-space:nowrap;' + (late ? "color:#b91c1c;font-weight:600;" : "") + '">' + esc(fmtShort(t.start)) + ' <span style="color:var(--muted);font-weight:400;">' + esc(fmtDow(t.start)) + "</span></td>";
      html += '<td style="padding:7px 8px;border-bottom:1px solid var(--line);text-align:end;white-space:nowrap;">' + esc(fmtShort(t.finish)) + ' <span style="color:var(--muted);font-weight:400;">' + esc(fmtDow(t.finish)) + "</span></td>";
      html += '<td style="padding:7px 8px;border-bottom:1px solid var(--line);text-align:end;">' + esc(fmtInt(t.days)) + "</td>";
      html += "</tr>";
    });
    html += "</tbody></table>";
    wrap.innerHTML = html;
    resultEl.appendChild(wrap);

    /* 제외된 공휴일 — 신뢰 요소 */
    if (res.skipped.length) {
      resultEl.appendChild(detailsBlock(fmt(tr("tool.res.holidays", "{n} public holidays excluded"), { n: fmtInt(res.skipped.length) }), function (det) {
        var ul = document.createElement("ul");
        ul.style.cssText = "margin:8px 0 0;padding-inline-start:20px;color:var(--muted);font-size:13.5px;";
        res.skipped.forEach(function (s) {
          var li = document.createElement("li");
          li.textContent = fmtShort(s.date) + " (" + fmtDow(s.date) + ") — " + s.name;
          ul.appendChild(li);
        });
        det.appendChild(ul);
      }));
    } else {
      var none = document.createElement("p");
      none.style.cssText = "margin:12px 0 0;font-size:13.5px;color:var(--muted);";
      none.textContent = tr("tool.res.holidaysNone", "No public holidays fall inside this schedule — weekends only.");
      resultEl.appendChild(none);
    }

    /* 보정된 행 */
    if (norm.adjusted.length) {
      resultEl.appendChild(detailsBlock(fmt(tr("tool.res.adjusted", "{n} rows rounded up to whole days"), { n: fmtInt(norm.adjusted.length) }), function (det) {
        var ul = document.createElement("ul");
        ul.style.cssText = "margin:8px 0 0;padding-inline-start:20px;color:var(--muted);font-size:13.5px;";
        norm.adjusted.forEach(function (a) {
          var li = document.createElement("li");
          li.textContent = fmt(tr("tool.res.rowLabel", "Row {n}"), { n: a.line }) + ": " + a.name + " — " + a.from + " → " + a.to;
          ul.appendChild(li);
        });
        det.appendChild(ul);
      }));
    }

    /* 제외된 행 — 버리지 않고 행번호·사유와 함께 (철칙 5) */
    if (norm.excluded.length) {
      resultEl.appendChild(detailsBlock(fmt(tr("tool.res.excluded", "{n} rows excluded"), { n: fmtInt(norm.excluded.length) }), function (det) {
        var ul = document.createElement("ul");
        ul.style.cssText = "margin:8px 0 0;padding-inline-start:20px;color:var(--muted);font-size:13.5px;";
        norm.excluded.forEach(function (x) {
          var li = document.createElement("li");
          li.textContent = fmt(tr("tool.res.rowLabel", "Row {n}"), { n: x.line }) + ": " + reasonText(x.reason) + (x.raw ? " — " + x.raw : "");
          ul.appendChild(li);
        });
        det.appendChild(ul);
      }));
    }
  }

  /* 유효 행 0개: 가짜 결과 대신 사유별 집계 */
  function renderAllExcluded(norm) {
    resultEl.textContent = "";
    var total = norm.excluded.length;
    var head = document.createElement("p");
    head.style.cssText = "margin:0 0 10px;font-weight:700;color:#b45309;";
    head.textContent = fmt(tr("tool.res.allExcluded", "All {n} rows were excluded — nothing left to schedule."), { n: fmtInt(total) });
    resultEl.appendChild(head);

    var byReason = {};
    norm.excluded.forEach(function (x) { byReason[x.reason] = (byReason[x.reason] || 0) + 1; });
    var ul = document.createElement("ul");
    ul.style.cssText = "margin:0;padding-inline-start:20px;color:var(--muted);font-size:14px;";
    Object.keys(byReason).forEach(function (r) {
      var li = document.createElement("li");
      li.textContent = reasonText(r) + ": " + fmtInt(byReason[r]);
      ul.appendChild(li);
    });
    resultEl.appendChild(ul);

    resultEl.appendChild(detailsBlock(fmt(tr("tool.res.excluded", "{n} rows excluded"), { n: fmtInt(total) }), function (det) {
      var ul2 = document.createElement("ul");
      ul2.style.cssText = "margin:8px 0 0;padding-inline-start:20px;color:var(--muted);font-size:13.5px;";
      norm.excluded.slice(0, 200).forEach(function (x) {
        var li = document.createElement("li");
        li.textContent = fmt(tr("tool.res.rowLabel", "Row {n}"), { n: x.line }) + ": " + reasonText(x.reason) + (x.raw ? " — " + x.raw : "");
        ul2.appendChild(li);
      });
      det.appendChild(ul2);
    }));
  }

  /* ---- 실행 ---- */
  function run() {
    exportMsg.textContent = "";
    lastRes = null; lastErr = null;

    var dv = deadlineEl.value;
    if (!dv || !isValidDate(dv)) { showError("noDeadline"); return; }
    var deadline = parseDate(dv);
    if (!inYearRange(deadline)) { showError("dateRange"); return; }

    var bv = baselineEl.value;
    var baseline = (bv && isValidDate(bv)) ? parseDate(bv) : today();
    if (!inYearRange(baseline)) { showError("dateRange"); return; }

    if (!parsed) { showError("empty"); return; }

    var map = {
      task: parseInt(mapTaskEl.value, 10),
      days: parseInt(mapDaysEl.value, 10),
      owner: parseInt(mapOwnerEl.value, 10)
    };
    if (isNaN(map.task)) map.task = -1;
    if (isNaN(map.days)) map.days = -1;
    if (isNaN(map.owner)) map.owner = -1;
    parsed.map = map;
    state.map = { task: map.task, days: map.days, owner: map.owner };
    persist();

    var norm = normalizeRows(parsed.rows, map, parsed.hasHeader);
    if (!norm.valid.length) {
      exportWrap.hidden = true;
      if (!norm.excluded.length) { showError("empty"); return; }
      lastErr = "allExcluded"; lastRes = { norm: norm };
      renderAllExcluded(norm);
      return;
    }

    var res = computeSchedule({
      tasks: norm.valid, deadline: deadline, baseline: baseline,
      weekend: weekendEl.value, preset: presetEl.value, custom: state.custom
    });
    if (res.error) { showError(res.error); return; }

    lastRes = { res: res, norm: norm };
    render(res, norm);
    exportWrap.hidden = false;
  }
  function today() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }

  /* ---- 내보내기 ---- */
  function headerLabels() {
    return {
      task: tr("tool.res.thTask", "Task"), owner: tr("tool.res.thOwner", "Owner"),
      start: tr("tool.res.thStart", "Start"), finish: tr("tool.res.thFinish", "Finish"),
      days: tr("tool.res.thDays", "Business days")
    };
  }
  function download(text, name) {
    try {
      var blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });   // BOM: 엑셀 한글 깨짐 방지
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) {
      exportMsg.textContent = tr("tool.msg.copyFail", "Your browser blocked that. Select the table and copy it manually.");
    }
  }

  /* ---- 이벤트 배선 ---- */
  var debounceId = null;
  function debouncedRun() {
    if (debounceId) clearTimeout(debounceId);
    debounceId = setTimeout(function () { ingestText(tasksEl.value, "utf-8"); run(); }, 250);
  }

  tasksEl.addEventListener("input", debouncedRun);
  deadlineEl.addEventListener("change", run);
  deadlineEl.addEventListener("input", run);
  baselineEl.addEventListener("change", run);
  baselineEl.addEventListener("input", run);
  runBtn.addEventListener("click", function () { ingestText(tasksEl.value, encBadge.hidden ? "utf-8" : "euc-kr"); run(); });

  presetEl.addEventListener("change", function () {
    state.preset = presetEl.value; autoCountry = false; persist();
    renderCountryNote(); run();
  });
  weekendEl.addEventListener("change", function () {
    state.weekend = weekendEl.value; persist(); run();
  });
  [mapTaskEl, mapDaysEl, mapOwnerEl].forEach(function (el) {
    el.addEventListener("change", run);
  });
  customAddBtn.addEventListener("click", addCustom);
  customInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addCustom(); } });

  sampleBtn.addEventListener("click", function () {
    tasksEl.value = tr("tool.sampleRows", "Creative review\t3\tDana\nPrint production\t5\tVendor\nStore setup\t2\tOps");
    ingestText(tasksEl.value, "utf-8");
    run();
  });

  fileBtn.addEventListener("click", function () { fileEl.click(); });
  fileEl.addEventListener("change", function () { if (fileEl.files && fileEl.files[0]) readFile(fileEl.files[0]); });

  ["dragenter", "dragover"].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) {
      e.preventDefault(); e.stopPropagation();
      dropZone.style.borderColor = "var(--accent)";
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) {
      e.preventDefault(); e.stopPropagation();
      dropZone.style.borderColor = "var(--line)";
    });
  });
  dropZone.addEventListener("drop", function (e) {
    var dt = e.dataTransfer;
    if (dt && dt.files && dt.files[0]) readFile(dt.files[0]);
  });
  /* 드롭존 밖에 떨어뜨렸을 때 브라우저가 파일로 이동해버리는 것만 막는다 */
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) { e.preventDefault(); });

  csvBtn.addEventListener("click", function () {
    if (!lastRes || !lastRes.res) return;
    download(buildCsv(lastRes.res, headerLabels()), SLUG + "-" + toKey(lastRes.res.deadline) + ".csv");
  });
  ganttBtn.addEventListener("click", function () {
    if (!lastRes || !lastRes.res) return;
    download(buildGanttCsv(lastRes.res), SLUG + "-gantt-" + toKey(lastRes.res.deadline) + ".csv");
  });
  copyBtn.addEventListener("click", function () {
    if (!lastRes || !lastRes.res) return;
    var text = buildTsv(lastRes.res, headerLabels());
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          exportMsg.textContent = tr("tool.msg.copied", "Copied — paste it straight into a spreadsheet.");
        }, function () {
          exportMsg.textContent = tr("tool.msg.copyFail", "Your browser blocked that. Select the table and copy it manually.");
        });
      } else {
        exportMsg.textContent = tr("tool.msg.copyFail", "Your browser blocked that. Select the table and copy it manually.");
      }
    } catch (e) {
      exportMsg.textContent = tr("tool.msg.copyFail", "Your browser blocked that. Select the table and copy it manually.");
    }
  });

  /* ---- 언어 전환 시 다시 그린다 ---- */
  document.addEventListener("i18n:change", function () {
    buildCountrySelect();
    renderCountryNote();
    renderCustomList();
    if (parsed) renderPreview();
    if (lastRes && lastRes.res) render(lastRes.res, lastRes.norm);
    else if (lastErr === "allExcluded" && lastRes) renderAllExcluded(lastRes.norm);
    else if (lastErr) renderError(lastErr);
    if (!storageOk && storeNoteEl) storeNoteEl.textContent = tr("tool.msg.noStorage", "Settings can't be saved in private mode — they'll last for this session only.");
  });

  /* ---- 초기화 ---- */
  (function init() {
    var t = today();
    deadlineEl.value = toKey(addDays(t, 30));   // 기본값 오늘+30일 → 붙여넣기만 하면 결과가 나온다
    baselineEl.value = toKey(t);
    buildCountrySelect();
    presetEl.value = state.preset || "none";
    weekendEl.value = state.weekend || "satsun";
    renderCountryNote();
    renderCustomList();
    if (!storageOk && storeNoteEl) {
      storeNoteEl.textContent = tr("tool.msg.noStorage", "Settings can't be saved in private mode — they'll last for this session only.");
      storeNoteEl.hidden = false;
    }
    ingestText(tasksEl.value, "utf-8");   // 브라우저가 새로고침 때 textarea 를 복원한 경우 대비
    run();   // 빈 입력 → 회색 안내 (조용한 실패 금지)
  })();

  // TOOLJS:END
})();
