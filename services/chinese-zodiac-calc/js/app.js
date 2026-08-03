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
  /* Chinese Zodiac Calculator — birth year (+ optional month/day) -> the 12-animal
     Chinese zodiac sign, its 5-element/yin-yang combination, a full years chart, and
     lighthearted trine/clash "compatibility" notes. Entertainment only. State:
     localStorage "<slug>:state" (last inputs). No external API — the animal/element
     math is pure arithmetic and the Lunar New Year boundary uses a static built-in
     lookup table (1930-2030); everything runs locally. */

  /* ---- 12 animals in cycle order, starting at Rat (animalIndex 0) ---- */
  var ANIMALS = ["rat", "ox", "tiger", "rabbit", "dragon", "snake", "horse", "goat", "monkey", "rooster", "dog", "pig"];
  var ANIMAL_SYMBOLS = ["🐀", "🐂", "🐅", "🐇", "🐉", "🐍", "🐎", "🐐", "🐒", "🐓", "🐕", "🐖"];
  /* ---- 5 elements, each spanning 2 heavenly-stem years, starting at Wood (elementIndex 0) ---- */
  var ELEMENTS = ["wood", "fire", "earth", "metal", "water"];
  /* ---- 4 trine ("San He") friendship groups, by animalIndex ---- */
  var TRINES = [
    [0, 4, 8],   // rat, dragon, monkey
    [1, 5, 9],   // ox, snake, rooster
    [2, 6, 10],  // tiger, horse, dog
    [3, 7, 11]   // rabbit, goat, pig
  ];
  /* ---- 6 clash ("Liu Chong") opposite pairs, exactly 6 positions apart ---- */
  var CLASH = [6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5];
  // Jia-Zi ("Wood Rat") reference year — 1984 and 1924 both start a 60-year cycle.
  var EPOCH = 1984;

  /* ---- Lunar New Year (Chinese New Year) Gregorian dates, 1930-2030 [month, day].
     Static reference data (source-checked against multiple published almanacs),
     used only to decide which side of the boundary a birth date falls on. ---- */
  var LNY_MIN_YEAR = 1930, LNY_MAX_YEAR = 2030;
  var LNY_DATES = {
    1930: [1, 30], 1931: [2, 17], 1932: [2, 6], 1933: [1, 26], 1934: [2, 14],
    1935: [2, 4], 1936: [1, 24], 1937: [2, 11], 1938: [1, 31], 1939: [2, 19],
    1940: [2, 8], 1941: [1, 27], 1942: [2, 15], 1943: [2, 4], 1944: [1, 25],
    1945: [2, 13], 1946: [2, 1], 1947: [1, 22], 1948: [2, 10], 1949: [1, 29],
    1950: [2, 17], 1951: [2, 6], 1952: [1, 27], 1953: [2, 14], 1954: [2, 3],
    1955: [1, 24], 1956: [2, 12], 1957: [1, 31], 1958: [2, 18], 1959: [2, 8],
    1960: [1, 28], 1961: [2, 15], 1962: [2, 5], 1963: [1, 25], 1964: [2, 13],
    1965: [2, 2], 1966: [1, 21], 1967: [2, 9], 1968: [1, 30], 1969: [2, 17],
    1970: [2, 6], 1971: [1, 27], 1972: [2, 15], 1973: [2, 3], 1974: [1, 23],
    1975: [2, 11], 1976: [1, 31], 1977: [2, 18], 1978: [2, 7], 1979: [1, 28],
    1980: [2, 16], 1981: [2, 5], 1982: [1, 25], 1983: [2, 13], 1984: [2, 2],
    1985: [2, 20], 1986: [2, 9], 1987: [1, 29], 1988: [2, 17], 1989: [2, 6],
    1990: [1, 27], 1991: [2, 15], 1992: [2, 4], 1993: [1, 23], 1994: [2, 10],
    1995: [1, 31], 1996: [2, 19], 1997: [2, 7], 1998: [1, 28], 1999: [2, 16],
    2000: [2, 5], 2001: [1, 24], 2002: [2, 12], 2003: [2, 1], 2004: [1, 22],
    2005: [2, 9], 2006: [1, 29], 2007: [2, 18], 2008: [2, 7], 2009: [1, 26],
    2010: [2, 14], 2011: [2, 3], 2012: [1, 23], 2013: [2, 10], 2014: [1, 31],
    2015: [2, 19], 2016: [2, 8], 2017: [1, 28], 2018: [2, 16], 2019: [2, 5],
    2020: [1, 25], 2021: [2, 12], 2022: [2, 1], 2023: [1, 22], 2024: [2, 10],
    2025: [1, 29], 2026: [2, 17], 2027: [2, 6], 2028: [1, 26], 2029: [2, 13],
    2030: [2, 3]
  };

  /* ---- 참조 연도 범위: 연도 입력 검증 + 차트 생성 ---- */
  var YEAR_MIN = 1901;
  var CHART_START = 1924, CHART_END = 2043; // 정확히 60년 x 2바퀴 — 동물당 10회씩 등장

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  function mod(n, m) { return ((n % m) + m) % m; }
  function animalIndexOf(year) { return mod(year - EPOCH, 12); }
  function stemIndexOf(year) { return mod(year - EPOCH, 10); }
  function elementIndexOf(year) { return Math.floor(stemIndexOf(year) / 2); }
  function polarityOf(year) { return stemIndexOf(year) % 2 === 0 ? "yang" : "yin"; }

  // 생년(+월/일)이 있으면 그 해 음력설(LNY) 이전인지 판정해 실제 "띠 연도"를 반환.
  // month/day 가 없거나 그 해 LNY 데이터가 표 범위(1930-2030) 밖이면 조정하지 않는다.
  function resolveZodiacYear(year, month, day) {
    var lny = LNY_DATES[year];
    var hasMD = month != null && day != null && month >= 1 && month <= 12 && day >= 1 && day <= 31;
    if (!hasMD) return { zYear: year, adjusted: false, outOfRange: false, lny: lny || null };
    if (!lny) return { zYear: year, adjusted: false, outOfRange: true, lny: null };
    var before = (month < lny[0]) || (month === lny[0] && day < lny[1]);
    return { zYear: before ? year - 1 : year, adjusted: before, outOfRange: false, lny: lny };
  }

  function computeZodiac(year, month, day) {
    var r = resolveZodiacYear(year, month, day);
    var ai = animalIndexOf(r.zYear);
    var ei = elementIndexOf(r.zYear);
    return {
      zYear: r.zYear, adjusted: r.adjusted, outOfRange: r.outOfRange, lny: r.lny,
      animalIndex: ai, animal: ANIMALS[ai], symbol: ANIMAL_SYMBOLS[ai],
      elementIndex: ei, element: ELEMENTS[ei], polarity: polarityOf(r.zYear)
    };
  }

  // trine(친구) 2마리 + clash(상충) 1마리의 animalIndex 배열
  function compatibilityOf(animalIndex) {
    var trine = null, i, j;
    for (i = 0; i < TRINES.length; i++) {
      if (TRINES[i].indexOf(animalIndex) !== -1) { trine = TRINES[i]; break; }
    }
    var best = [];
    if (trine) { for (j = 0; j < trine.length; j++) { if (trine[j] !== animalIndex) best.push(trine[j]); } }
    return { best: best, tricky: [CLASH[animalIndex]] };
  }

  // [startYear, endYear] 구간에서 animalIndex 에 해당하는 연도 목록 (오름차순)
  function yearsForAnimal(animalIndex, startYear, endYear) {
    var out = [];
    for (var y = startYear; y <= endYear; y++) {
      if (animalIndexOf(y) === animalIndex) out.push(y);
    }
    return out;
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      ANIMALS: ANIMALS, ELEMENTS: ELEMENTS, TRINES: TRINES, CLASH: CLASH, EPOCH: EPOCH,
      LNY_DATES: LNY_DATES, LNY_MIN_YEAR: LNY_MIN_YEAR, LNY_MAX_YEAR: LNY_MAX_YEAR,
      mod: mod, animalIndexOf: animalIndexOf, stemIndexOf: stemIndexOf,
      elementIndexOf: elementIndexOf, polarityOf: polarityOf,
      resolveZodiacYear: resolveZodiacYear, computeZodiac: computeZodiac,
      compatibilityOf: compatibilityOf, yearsForAnimal: yearsForAnimal
    };
    return;
  }

  /* ---- i18n · Intl 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "chinese-zodiac-calc") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function animalName(idx) { return tr("tool.animal." + ANIMALS[idx], ANIMALS[idx]); }
  function elementName(idx) { return tr("tool.element." + ELEMENTS[idx], ELEMENTS[idx]); }
  function polarityName(p) { return tr("tool.polarity." + p, p); }
  function monthName(m) {
    try {
      var d = new Date(Date.UTC(2001, m - 1, 1));
      return new Intl.DateTimeFormat(uiLang(), { month: "long", timeZone: "UTC" }).format(d);
    } catch (e) { return String(m); }
  }
  function fmtDate(year, month, day) {
    try {
      var d = new Date(Date.UTC(year, month - 1, day));
      return new Intl.DateTimeFormat(uiLang(), { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(d);
    } catch (e) { return year + "-" + month + "-" + day; }
  }
  function fmtList(names) {
    try {
      if (typeof Intl !== "undefined" && Intl.ListFormat) {
        return new Intl.ListFormat(uiLang(), { style: "long", type: "conjunction" }).format(names);
      }
    } catch (e) { /* 폴백 */ }
    return names.join(", ");
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var yearEl2 = $("birth-year"), monthEl = $("birth-month"), dayEl = $("birth-day");
  var emptyEl = $("result-empty"), errEl = $("result-err"), cardEl = $("result-card");
  var symbolEl = $("res-symbol"), nameEl = $("res-name"), subEl = $("res-sub");
  var traitEl = $("res-trait"), precisionEl = $("res-precision");
  var compatBestEl = $("res-compat-best"), compatTrickyEl = $("res-compat-tricky");
  var yearsBody = $("years-table-body");
  if (!yearEl2 || !cardEl || !yearsBody) return;

  // 미래 연도(아직 태어나지 않은 연도) 방지 — 셸의 연도 표기와 동일한 로컬 연도 기준
  // 출산 예정 등 가까운 미래 연도도 조회 가능 — 음력설 표가 있는 2030년까지 허용
  var MAX_YEAR = Math.max(new Date().getFullYear(), LNY_MAX_YEAR);
  yearEl2.max = String(MAX_YEAR);

  /* ---- 월 셀렉트 옵션 (Intl 로 현지화된 월 이름 — 번역 카탈로그에 12개월 키를 두지 않는다) ---- */
  function renderMonthOptions() {
    var prev = monthEl.value;
    monthEl.textContent = "";
    var optEmpty = document.createElement("option");
    optEmpty.value = "";
    optEmpty.textContent = tr("tool.month.opt", "Month");
    monthEl.appendChild(optEmpty);
    for (var m = 1; m <= 12; m++) {
      var opt = document.createElement("option");
      opt.value = String(m);
      opt.textContent = monthName(m);
      monthEl.appendChild(opt);
    }
    monthEl.value = prev;
  }

  /* ---- 연간 차트 (12 동물 x 등장 연도 목록) ---- */
  function renderYearsTable() {
    yearsBody.textContent = "";
    for (var i = 0; i < ANIMALS.length; i++) {
      var tr2 = document.createElement("tr");
      var tdAnimal = document.createElement("td");
      tdAnimal.textContent = ANIMAL_SYMBOLS[i] + " " + animalName(i);
      tr2.appendChild(tdAnimal);
      var tdYears = document.createElement("td");
      tdYears.className = "yt-years";
      tdYears.textContent = yearsForAnimal(i, CHART_START, CHART_END).join(", ");
      tr2.appendChild(tdYears);
      yearsBody.appendChild(tr2);
    }
  }

  /* ---- 결과 렌더 ---- */
  function showEmpty() {
    cardEl.hidden = true; errEl.hidden = true; emptyEl.hidden = false;
  }
  function showErr() {
    cardEl.hidden = true; emptyEl.hidden = true; errEl.hidden = false;
    errEl.textContent = tr("tool.err.year", "Enter a valid birth year, e.g. between 1901 and {max}.").replace("{max}", String(MAX_YEAR));
  }
  function showDayErr(maxDay) {
    cardEl.hidden = true; emptyEl.hidden = true; errEl.hidden = false;
    errEl.textContent = tr("tool.err.day", "That day doesn't exist in the month you picked — enter a day between 1 and {max}.").replace("{max}", String(maxDay));
  }
  function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
  function parseIntOrNull(raw) {
    if (raw == null || String(raw).trim() === "") return null;
    var n = parseInt(raw, 10);
    return isFinite(n) ? n : null;
  }
  function render() {
    var year = parseIntOrNull(yearEl2.value);
    if (year == null) { showEmpty(); return; }
    if (year < YEAR_MIN || year > MAX_YEAR) { showErr(); return; }

    var month = parseIntOrNull(monthEl.value);
    var day = parseIntOrNull(dayEl.value);
    // 잘못된 날짜(2월 30일, 45일 등)는 조용히 무시하지 않고 명시적으로 안내한다
    if (day != null) {
      var dmax = month != null ? daysInMonth(year, month) : 31;
      if (day < 1 || day > dmax) { showDayErr(dmax); return; }
    }
    var z = computeZodiac(year, month, day);

    symbolEl.textContent = z.symbol;
    nameEl.textContent = tr("tool.res.title", "{element} {animal}")
      .replace("{element}", elementName(z.elementIndex)).replace("{animal}", animalName(z.animalIndex));
    subEl.textContent = tr("tool.res.subtitle", "{polarity} energy · Year of the {animal}")
      .replace("{polarity}", polarityName(z.polarity)).replace("{animal}", animalName(z.animalIndex));
    traitEl.textContent = tr("tool.trait." + z.animal, "");

    if (z.adjusted && month != null && day != null && z.lny) {
      precisionEl.className = "rc-note warn";
      precisionEl.textContent = tr("tool.precision.adjusted", "Your birthday ({date}) falls before Chinese New Year {lnyDate} — so your zodiac year is {zyear}, not {year}.")
        .replace("{date}", fmtDate(year, month, day))
        .replace("{lnyDate}", fmtDate(year, z.lny[0], z.lny[1]))
        .replace("{zyear}", String(z.zYear)).replace("{year}", String(year));
      precisionEl.hidden = false;
    } else if (!z.adjusted && month != null && day != null && z.lny) {
      precisionEl.className = "rc-note";
      precisionEl.textContent = tr("tool.precision.confirmed", "Your birthday ({date}) falls on or after Chinese New Year {lnyDate}, so your zodiac year matches your birth year.")
        .replace("{date}", fmtDate(year, month, day))
        .replace("{lnyDate}", fmtDate(year, z.lny[0], z.lny[1]));
      precisionEl.hidden = false;
    } else if (z.outOfRange) {
      precisionEl.className = "rc-note warn";
      precisionEl.textContent = tr("tool.precision.outOfRange", "Exact Chinese New Year date isn't available before 1930 or after 2030, so this uses the calendar year without adjustment.");
      precisionEl.hidden = false;
    } else {
      precisionEl.hidden = true;
    }

    var compat = compatibilityOf(z.animalIndex);
    var bestNames = compat.best.map(animalName);
    var trickyNames = compat.tricky.map(animalName);
    compatBestEl.textContent = tr("tool.compat.best", "Great match: {list}").replace("{list}", fmtList(bestNames));
    compatTrickyEl.textContent = tr("tool.compat.tricky", "Needs extra effort: {list}").replace("{list}", fmtList(trickyNames));

    emptyEl.hidden = true; errEl.hidden = true; cardEl.hidden = false;

    try { localStorage.setItem(SKEY, JSON.stringify({ y: yearEl2.value, m: monthEl.value, d: dayEl.value })); }
    catch (e) { /* private mode */ }
  }

  /* ---- 상태 복원 ---- */
  function restore() {
    var raw = null;
    try { raw = localStorage.getItem(SKEY); } catch (e) { /* noop */ }
    if (!raw) return;
    try {
      var s = JSON.parse(raw);
      if (s && s.y) yearEl2.value = s.y;
      if (s && s.m) monthEl.value = s.m;
      if (s && s.d) dayEl.value = s.d;
    } catch (e) { /* 손상된 저장값 무시 */ }
  }

  /* ---- 이벤트 ---- */
  yearEl2.addEventListener("input", render);
  monthEl.addEventListener("change", render);
  dayEl.addEventListener("input", render);
  document.addEventListener("i18n:change", function () {
    renderMonthOptions();
    renderYearsTable();
    render();
  });

  renderMonthOptions();
  renderYearsTable();
  restore();
  render();
  // TOOLJS:END
})();
