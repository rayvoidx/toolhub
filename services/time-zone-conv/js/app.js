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
  var SLUG = cfg.slug || "time-zone-conv";
  var LS_CITIES = SLUG + ":cities";   // 상태 저장은 "<slug>:" prefix 만
  var LS_BASE = SLUG + ":base";       // 기준 시간대
  var MAX_CITIES = 12;
  var DEFAULT_CITIES = [
    "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Paris",
    "Asia/Tokyo", "Asia/Singapore", "Australia/Sydney", "UTC"
  ];

  // 내장 도시 프리셋 (외부 API 0건). alias = 영어 + 한글 검색어(향후 검색용).
  var CITIES = [
    { tz: "UTC", name: "UTC", alias: "utc gmt zulu" },
    { tz: "America/Los_Angeles", name: "Los Angeles", alias: "los angeles la usa 로스앤젤레스 미국" },
    { tz: "America/Denver", name: "Denver", alias: "denver usa 덴버 미국" },
    { tz: "America/Chicago", name: "Chicago", alias: "chicago usa 시카고 미국" },
    { tz: "America/New_York", name: "New York", alias: "new york nyc usa 뉴욕 미국" },
    { tz: "America/Toronto", name: "Toronto", alias: "toronto canada 토론토 캐나다" },
    { tz: "America/Mexico_City", name: "Mexico City", alias: "mexico city 멕시코시티 멕시코" },
    { tz: "America/Sao_Paulo", name: "Sao Paulo", alias: "sao paulo brazil 상파울루 브라질" },
    { tz: "Europe/London", name: "London", alias: "london uk england 런던 영국" },
    { tz: "Europe/Paris", name: "Paris", alias: "paris france 파리 프랑스" },
    { tz: "Europe/Berlin", name: "Berlin", alias: "berlin germany 베를린 독일" },
    { tz: "Europe/Moscow", name: "Moscow", alias: "moscow russia 모스크바 러시아" },
    { tz: "Europe/Istanbul", name: "Istanbul", alias: "istanbul turkey 이스탄불 터키" },
    { tz: "Africa/Cairo", name: "Cairo", alias: "cairo egypt 카이로 이집트" },
    { tz: "Africa/Johannesburg", name: "Johannesburg", alias: "johannesburg south africa 요하네스버그 남아공" },
    { tz: "Asia/Dubai", name: "Dubai", alias: "dubai uae 두바이 아랍에미리트" },
    { tz: "Asia/Kolkata", name: "Delhi", alias: "delhi mumbai india 델리 뭄바이 인도" },
    { tz: "Asia/Dhaka", name: "Dhaka", alias: "dhaka bangladesh 다카 방글라데시" },
    { tz: "Asia/Bangkok", name: "Bangkok", alias: "bangkok thailand 방콕 태국" },
    { tz: "Asia/Jakarta", name: "Jakarta", alias: "jakarta indonesia 자카르타 인도네시아" },
    { tz: "Asia/Singapore", name: "Singapore", alias: "singapore 싱가포르" },
    { tz: "Asia/Hong_Kong", name: "Hong Kong", alias: "hong kong 홍콩" },
    { tz: "Asia/Shanghai", name: "Shanghai", alias: "shanghai beijing china 상하이 베이징 중국" },
    { tz: "Asia/Seoul", name: "Seoul", alias: "seoul korea 서울 한국" },
    { tz: "Asia/Tokyo", name: "Tokyo", alias: "tokyo japan 도쿄 일본" },
    { tz: "Australia/Sydney", name: "Sydney", alias: "sydney australia 시드니 호주" },
    { tz: "Pacific/Auckland", name: "Auckland", alias: "auckland new zealand 오클랜드 뉴질랜드" }
  ];
  var BY_TZ = {};
  for (var ci = 0; ci < CITIES.length; ci++) BY_TZ[CITIES[ci].tz] = CITIES[ci];

  /* ============================================================
     순수 계산 (node 단위 검증 대상 — 브라우저 IANA DB로 DST 자동 반영)
     ============================================================ */
  function makeNumFmt(tz) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
  }
  function numParts(fmt, date) {
    var o = {}, parts = fmt.formatToParts(date);
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].type !== "literal") o[parts[i].type] = parseInt(parts[i].value, 10);
    }
    if (o.hour === 24) o.hour = 0; // 일부 엔진의 자정 '24' 보정
    return o;
  }
  // 주어진 순간, tz 가 UTC 로부터 몇 분 앞/뒤인지 (동쪽 +) — DST 자동
  function zoneOffsetMinutes(date, tz) {
    var p = numParts(makeNumFmt(tz), date);
    var asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return Math.round((asUTC - date.getTime()) / 60000);
  }
  // tz 의 벽시계 시각(y..mi) → epoch(ms). 오프셋을 두 번 반복해 DST 경계에서 수렴.
  function wallToEpoch(y, mo, d, h, mi, tz) {
    var guess = Date.UTC(y, mo - 1, d, h, mi, 0);
    var off1 = zoneOffsetMinutes(new Date(guess), tz);
    var epoch = guess - off1 * 60000;
    var off2 = zoneOffsetMinutes(new Date(epoch), tz);
    if (off2 !== off1) epoch = guess - off2 * 60000;
    return epoch;
  }
  // 봄철 건너뛴 벽시계(예: 뉴욕 DST 시작 2:30)면 1시간 앞으로 밀고 adjusted=true.
  function resolveBase(y, mo, d, h, mi, tz) {
    var epoch = wallToEpoch(y, mo, d, h, mi, tz);
    var p = numParts(makeNumFmt(tz), new Date(epoch));
    if (p.hour === h && p.minute === mi) return { epoch: epoch, adjusted: false };
    // 존재하지 않는 로컬 시각 → 벽시계 +1시간으로 재해석
    var g2 = new Date(Date.UTC(y, mo - 1, d, h, mi, 0) + 3600000);
    epoch = wallToEpoch(g2.getUTCFullYear(), g2.getUTCMonth() + 1, g2.getUTCDate(),
      g2.getUTCHours(), g2.getUTCMinutes(), tz);
    return { epoch: epoch, adjusted: true };
  }
  // 대상 도시의 달력일 − 기준 도시의 달력일 (일수: -1 / 0 / +1)
  function dayOffset(epoch, targetTz, baseY, baseMo, baseD) {
    var t = numParts(makeNumFmt(targetTz), new Date(epoch));
    return Math.round((Date.UTC(t.year, t.month - 1, t.day) -
      Date.UTC(baseY, baseMo - 1, baseD)) / 86400000);
  }
  // 그 순간에 DST 적용 중인가? 표준시 = 1월/7월 오프셋의 최솟값 → 그보다 크면 DST.
  // (남반구 포함 정확히 동작 — 오프셋 하드코딩 없음)
  function isDST(epoch, tz) {
    var d = new Date(epoch);
    var y = numParts(makeNumFmt(tz), d).year;
    var jan = zoneOffsetMinutes(new Date(Date.UTC(y, 0, 1, 12, 0, 0)), tz);
    var jul = zoneOffsetMinutes(new Date(Date.UTC(y, 6, 1, 12, 0, 0)), tz);
    return zoneOffsetMinutes(d, tz) > Math.min(jan, jul);
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function formatOffset(min) {
    var sign = min < 0 ? "-" : "+";
    var a = Math.abs(min), hh = Math.floor(a / 60), mm = a % 60;
    return sign + hh + ":" + pad2(mm);
  }

  // node 검증용 노출 (DOM 접근 전에 먼저 — 브라우저엔 module 이 없어 건너뜀)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      zoneOffsetMinutes: zoneOffsetMinutes,
      wallToEpoch: wallToEpoch,
      resolveBase: resolveBase,
      dayOffset: dayOffset,
      isDST: isDST,
      formatOffset: formatOffset
    };
  }

  /* ---- i18n 헬퍼 ---- */
  function tr(key, fallback) {
    try {
      if (window.I18N) { var v = window.I18N.t(key); if (v != null) return v; }
    } catch (e) { /* i18n 부재 시 폴백 */ }
    return fallback;
  }
  function uiLang() {
    try { if (window.I18N && window.I18N.lang()) return window.I18N.lang(); } catch (e) { /* noop */ }
    return undefined;
  }
  function cityName(tz) { return BY_TZ[tz] ? BY_TZ[tz].name : tz.replace(/_/g, " "); }

  /* ---- Intl timeZone 지원 감지 (조용한 실패 금지) ---- */
  var HOME_TZ, intlOk = true;
  try {
    HOME_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    makeNumFmt(HOME_TZ).format(new Date());
  } catch (e) { intlOk = false; HOME_TZ = "UTC"; }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var dtInput = $("tzc-datetime"), nowBtn = $("tzc-now");
  var baseSel = $("tzc-basezone"), addSel = $("tzc-addcity");
  var noticeEl = $("tzc-notice"), gridEl = $("tzc-grid"), emptyEl = $("tzc-empty");
  var toastEl = $("tzc-toast");
  if (!dtInput || !baseSel || !gridEl) return; // node/구형 환경 — 안전 종료

  // Intl 미지원 → 명시적 안내 후 중단
  if (!intlOk) {
    if (noticeEl) {
      noticeEl.hidden = false;
      noticeEl.textContent = tr("tool.noTz",
        "This browser doesn't support time zones, so the converter can't run. Please update your browser.");
    }
    dtInput.disabled = true; if (nowBtn) nowBtn.disabled = true;
    baseSel.disabled = true; if (addSel) addSel.disabled = true;
    return;
  }

  /* ---- 저장소 (private mode 대응) ---- */
  var storageOk = true;
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { storageOk = false; return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { storageOk = false; } }

  /* ---- 상태 ---- */
  var cities = loadCities();     // tz id 배열
  var baseTz = loadBase();       // 기준 시간대
  var cards = [];                // { tz, nameEl, timeEl, dateEl, offEl, dayEl, dstEl, copyBtn }
  var lastEpoch = null, lastValid = false;

  function loadCities() {
    var raw = lsGet(LS_CITIES);
    if (raw != null) {
      try {
        var arr = JSON.parse(raw);
        if (Object.prototype.toString.call(arr) === "[object Array]") {
          var clean = [];
          for (var i = 0; i < arr.length; i++) {
            if (BY_TZ[arr[i]] && clean.indexOf(arr[i]) === -1) clean.push(arr[i]);
          }
          return clean.slice(0, MAX_CITIES); // 사용자가 전부 지운 빈 배열도 존중
        }
      } catch (e) { /* 손상 → 기본값 */ }
      return DEFAULT_CITIES.slice();
    }
    return DEFAULT_CITIES.slice(); // 첫 방문
  }
  function loadBase() {
    var raw = lsGet(LS_BASE);
    if (raw && (BY_TZ[raw] || raw === HOME_TZ)) return raw;
    return HOME_TZ;
  }
  function saveCities() { lsSet(LS_CITIES, JSON.stringify(cities)); }
  function saveBase() { lsSet(LS_BASE, baseTz); }

  /* ---- 표시 포맷 (로케일·DST 반영) ---- */
  function fmtTime(tz, date) {
    try {
      return new Intl.DateTimeFormat(uiLang(), {
        timeZone: tz, hour: "numeric", minute: "2-digit"
      }).format(date);
    } catch (e) {
      var p = numParts(makeNumFmt(tz), date);
      return pad2(p.hour) + ":" + pad2(p.minute);
    }
  }
  function fmtDate(tz, date) {
    try {
      return new Intl.DateTimeFormat(uiLang(), {
        timeZone: tz, weekday: "short", year: "numeric", month: "short", day: "numeric"
      }).format(date);
    } catch (e) {
      var p = numParts(makeNumFmt(tz), date);
      return p.year + "-" + pad2(p.month) + "-" + pad2(p.day);
    }
  }
  function dayLabel(diff) {
    if (diff === 0) return tr("tool.daySame", "Same day");
    if (diff === 1) return tr("tool.dayPlus1", "+1 day");
    if (diff === -1) return tr("tool.dayMinus1", "−1 day");
    return (diff > 0 ? "+" : "−") + Math.abs(diff) + "d"; // 극단 폴백
  }

  /* ---- 안내 문구 (.result) ---- */
  function showNotices(list) {
    if (!noticeEl) return;
    if (!list.length) { noticeEl.hidden = true; noticeEl.textContent = ""; return; }
    noticeEl.textContent = list.join(" · ");
    noticeEl.hidden = false;
  }

  /* ---- 토스트 ---- */
  var toastTimer = null;
  function toast(key, fallback) {
    if (!toastEl) return;
    toastEl.textContent = tr(key, fallback);
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2000);
  }

  /* ---- 기준 시각 읽기 (빈 입력 → 현재 시각 + 안내) ---- */
  function readBase() {
    var tz = baseSel.value || HOME_TZ;
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(dtInput.value);
    if (!m) {
      var p = numParts(makeNumFmt(tz), new Date());
      return { tz: tz, y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute, fromNow: true };
    }
    return { tz: tz, y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], fromNow: false };
  }

  /* ---- 셀렉트 채우기 ---- */
  function buildBaseSelect() {
    baseSel.innerHTML = "";
    var seen = {};
    // 감지된 홈 존이 프리셋에 없으면 맨 위에 추가
    if (!BY_TZ[HOME_TZ]) {
      var oh = document.createElement("option");
      oh.value = HOME_TZ;
      oh.textContent = HOME_TZ.replace(/_/g, " ");
      baseSel.appendChild(oh); seen[HOME_TZ] = 1;
    }
    for (var i = 0; i < CITIES.length; i++) {
      if (seen[CITIES[i].tz]) continue;
      var o = document.createElement("option");
      o.value = CITIES[i].tz;
      o.textContent = cityName(CITIES[i].tz) + " (UTC" +
        formatOffset(zoneOffsetMinutes(new Date(), CITIES[i].tz)) + ")";
      baseSel.appendChild(o);
    }
    baseSel.value = baseTz;
  }
  function buildAddSelect() {
    if (!addSel) return;
    addSel.innerHTML = "";
    var ph = document.createElement("option");
    ph.value = "";
    ph.textContent = tr("tool.addCityOption", "Add a city…");
    addSel.appendChild(ph);
    for (var i = 0; i < CITIES.length; i++) {
      if (cities.indexOf(CITIES[i].tz) !== -1) continue; // 이미 추가된 도시 제외
      var o = document.createElement("option");
      o.value = CITIES[i].tz;
      o.textContent = cityName(CITIES[i].tz);
      addSel.appendChild(o);
    }
    addSel.value = "";
  }

  /* ---- 카드 그리드 (도시 목록 변경 시에만 재생성) ---- */
  function rebuildGrid() {
    cards = [];
    gridEl.innerHTML = "";
    if (!cities.length) { emptyEl.hidden = false; return; }
    emptyEl.hidden = true;
    var mono = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
    for (var i = 0; i < cities.length; i++) {
      var tz = cities[i];
      var card = document.createElement("div");
      card.style.cssText = "position:relative;border:1px solid var(--line);border-radius:12px;padding:14px 12px;background:var(--surface);";

      var rm = document.createElement("button");
      rm.type = "button";
      rm.setAttribute("aria-label", tr("tool.remove", "Remove") + " " + cityName(tz));
      rm.textContent = "×";
      rm.style.cssText = "position:absolute;top:6px;right:6px;width:26px;height:26px;line-height:1;border:none;background:none;color:var(--muted);font-size:20px;cursor:pointer;border-radius:6px;";
      (function (t) { rm.addEventListener("click", function () { removeCity(t); }); })(tz);

      var nameEl = document.createElement("div");
      nameEl.style.cssText = "font-weight:700;font-size:15px;padding-right:22px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      nameEl.textContent = cityName(tz);

      var timeEl = document.createElement("div");
      timeEl.style.cssText = "font-family:" + mono + ";font-variant-numeric:tabular-nums;font-size:26px;font-weight:700;margin:6px 0 2px;";
      timeEl.textContent = "—";

      var dateEl = document.createElement("div");
      dateEl.style.cssText = "color:var(--muted);font-size:13px;";

      var badges = document.createElement("div");
      badges.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:10px;";
      var offEl = document.createElement("span");
      offEl.style.cssText = "font-size:12px;font-variant-numeric:tabular-nums;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:2px 8px;";
      var dayEl = document.createElement("span");
      dayEl.style.cssText = "font-size:12px;font-weight:600;border-radius:999px;padding:2px 8px;";
      var dstEl = document.createElement("span");
      dstEl.style.cssText = "font-size:12px;font-weight:600;border-radius:999px;padding:2px 8px;background:color-mix(in srgb, var(--accent) 16%, var(--surface));color:var(--accent-strong);";
      dstEl.hidden = true;
      badges.appendChild(offEl); badges.appendChild(dayEl); badges.appendChild(dstEl);

      var copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn";
      copyBtn.textContent = tr("tool.copy", "Copy");
      copyBtn.style.cssText = "margin-top:12px;padding:7px 12px;font-size:13px;width:100%;";
      (function (t, btn) {
        btn.addEventListener("click", function () { copyCity(t, btn); });
      })(tz, copyBtn);

      card.appendChild(rm); card.appendChild(nameEl); card.appendChild(timeEl);
      card.appendChild(dateEl); card.appendChild(badges); card.appendChild(copyBtn);
      gridEl.appendChild(card);

      cards.push({ tz: tz, timeEl: timeEl, dateEl: dateEl, offEl: offEl, dayEl: dayEl, dstEl: dstEl });
    }
  }

  /* ---- 변환 렌더 (기준 시각/시간대 변경 시) ---- */
  function render() {
    var b = readBase();
    var msgs = [];

    if (b.y < 1970 || b.y > 2099) {
      lastValid = false;
      msgs.push(tr("tool.rangeError", "Only years 1970–2099 are supported."));
      showNotices(msgs);
      for (var k = 0; k < cards.length; k++) {
        cards[k].timeEl.textContent = "—";
        cards[k].dateEl.textContent = "";
        cards[k].offEl.textContent = ""; cards[k].dayEl.textContent = "";
        cards[k].dstEl.hidden = true;
      }
      return;
    }

    var res = resolveBase(b.y, b.mo, b.d, b.h, b.mi, b.tz);
    var epoch = res.epoch;
    lastEpoch = epoch; lastValid = true;
    var date = new Date(epoch);
    var basP = numParts(makeNumFmt(b.tz), date); // 재해석 후 기준 도시 벽시계 날짜

    if (b.fromNow) msgs.push(tr("tool.basedOnNow", "No base time set, so this shows the current time."));
    if (res.adjusted) msgs.push(tr("tool.springForward",
      "That local time is skipped when clocks spring forward, so it was moved ahead one hour."));
    if (!storageOk) msgs.push(tr("tool.noStorage",
      "Your city list can't be saved in private mode — it will last for this session only."));
    showNotices(msgs);

    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      c.timeEl.textContent = fmtTime(c.tz, date);
      c.dateEl.textContent = fmtDate(c.tz, date);
      c.offEl.textContent = "UTC" + formatOffset(zoneOffsetMinutes(date, c.tz));
      var diff = dayOffset(epoch, c.tz, basP.year, basP.month, basP.day);
      c.dayEl.textContent = dayLabel(diff);
      c.dayEl.style.color = diff === 0 ? "var(--muted)" : "var(--accent)";
      c.dayEl.style.background = diff === 0 ? "none"
        : "color-mix(in srgb, var(--accent) 12%, var(--surface))";
      if (isDST(epoch, c.tz)) {
        c.dstEl.hidden = false;
        c.dstEl.textContent = tr("tool.dstBadge", "DST");
        c.dstEl.setAttribute("title", tr("tool.dstTitle", "Daylight saving time is in effect"));
      } else {
        c.dstEl.hidden = true;
      }
    }
  }

  /* ---- 복사 ---- */
  function copyCity(tz, btn) {
    if (!lastValid || lastEpoch == null) return;
    var date = new Date(lastEpoch);
    var text = cityName(tz) + " — " + fmtDate(tz, date) + " " + fmtTime(tz, date) +
      " (UTC" + formatOffset(zoneOffsetMinutes(date, tz)) + ")";
    function done() {
      var old = btn.textContent;
      btn.textContent = tr("tool.copied", "Copied");
      setTimeout(function () { btn.textContent = old; }, 1200);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { toast("tool.copy", "Copy"); });
      } else {
        var ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        document.execCommand("copy"); document.body.removeChild(ta); done();
      }
    } catch (e) { /* 복사 실패는 조용히 넘어가되 UI는 그대로 */ }
  }

  /* ---- 도시 추가/삭제 ---- */
  function addCity(tz) {
    if (!BY_TZ[tz]) return;
    if (cities.indexOf(tz) !== -1) { toast("tool.duplicate", "That city is already in your list."); return; }
    if (cities.length >= MAX_CITIES) { toast("tool.max", "You can convert up to 12 cities at once."); return; }
    cities.push(tz);
    saveCities();
    buildAddSelect();
    rebuildGrid();
    render();
  }
  function removeCity(tz) {
    var idx = cities.indexOf(tz);
    if (idx === -1) return;
    cities.splice(idx, 1);
    saveCities();
    buildAddSelect();
    rebuildGrid();
    render();
  }

  /* ---- 이벤트 ---- */
  dtInput.addEventListener("input", render);
  dtInput.addEventListener("change", render);
  baseSel.addEventListener("change", function () {
    baseTz = baseSel.value || HOME_TZ;
    saveBase();
    render();
  });
  if (nowBtn) nowBtn.addEventListener("click", function () {
    var p = numParts(makeNumFmt(baseTz), new Date());
    dtInput.value = p.year + "-" + pad2(p.month) + "-" + pad2(p.day) + "T" + pad2(p.hour) + ":" + pad2(p.minute);
    render();
  });
  if (addSel) addSel.addEventListener("change", function () {
    if (addSel.value) addCity(addSel.value);
    addSel.value = "";
  });

  /* ---- 언어 전환 시 동적 문구 재렌더 ---- */
  document.addEventListener("i18n:change", function () {
    buildAddSelect();
    rebuildGrid();
    render();
  });

  /* ---- 부팅 ---- */
  buildBaseSelect();
  buildAddSelect();
  // 기준 시각 초기값 = 기준 시간대의 현재 벽시계 시각
  (function initNow() {
    var p = numParts(makeNumFmt(baseTz), new Date());
    dtInput.value = p.year + "-" + pad2(p.month) + "-" + pad2(p.day) + "T" + pad2(p.hour) + ":" + pad2(p.minute);
  })();
  rebuildGrid();
  render();
  // TOOLJS:END
})();
