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
  var SLUG = cfg.slug || "world-clock";
  var LS_CITIES = SLUG + ":cities";   // 상태 저장은 "<slug>:" prefix 만
  var LS_FORMAT = SLUG + ":format";
  var MAX_CITIES = 10;
  var DEFAULT_TZ = ["America/New_York", "Europe/London", "Asia/Tokyo", "Australia/Sydney"];

  // 내장 도시 목록 (외부 API 0건). alias = 영어 + 한글 검색어.
  var CITIES = [
    { tz: "America/New_York", name: "New York", alias: "new york nyc usa united states 뉴욕 미국" },
    { tz: "America/Los_Angeles", name: "Los Angeles", alias: "los angeles la california usa 로스앤젤레스 la 미국" },
    { tz: "America/Chicago", name: "Chicago", alias: "chicago usa 시카고 미국" },
    { tz: "America/Denver", name: "Denver", alias: "denver usa 덴버 미국" },
    { tz: "America/Anchorage", name: "Anchorage", alias: "anchorage alaska usa 앵커리지 알래스카" },
    { tz: "America/Toronto", name: "Toronto", alias: "toronto canada 토론토 캐나다" },
    { tz: "America/Mexico_City", name: "Mexico City", alias: "mexico city 멕시코시티 멕시코" },
    { tz: "America/Sao_Paulo", name: "Sao Paulo", alias: "sao paulo brazil 상파울루 브라질" },
    { tz: "America/Argentina/Buenos_Aires", name: "Buenos Aires", alias: "buenos aires argentina 부에노스아이레스 아르헨티나" },
    { tz: "Europe/London", name: "London", alias: "london uk united kingdom england 런던 영국" },
    { tz: "Europe/Paris", name: "Paris", alias: "paris france 파리 프랑스" },
    { tz: "Europe/Berlin", name: "Berlin", alias: "berlin germany 베를린 독일" },
    { tz: "Europe/Madrid", name: "Madrid", alias: "madrid spain 마드리드 스페인" },
    { tz: "Europe/Rome", name: "Rome", alias: "rome italy 로마 이탈리아" },
    { tz: "Europe/Amsterdam", name: "Amsterdam", alias: "amsterdam netherlands 암스테르담 네덜란드" },
    { tz: "Europe/Moscow", name: "Moscow", alias: "moscow russia 모스크바 러시아" },
    { tz: "Europe/Istanbul", name: "Istanbul", alias: "istanbul turkey turkiye 이스탄불 터키" },
    { tz: "Africa/Cairo", name: "Cairo", alias: "cairo egypt 카이로 이집트" },
    { tz: "Africa/Lagos", name: "Lagos", alias: "lagos nigeria 라고스 나이지리아" },
    { tz: "Africa/Nairobi", name: "Nairobi", alias: "nairobi kenya 나이로비 케냐" },
    { tz: "Africa/Johannesburg", name: "Johannesburg", alias: "johannesburg south africa 요하네스버그 남아공" },
    { tz: "Asia/Dubai", name: "Dubai", alias: "dubai uae emirates 두바이 아랍에미리트" },
    { tz: "Asia/Riyadh", name: "Riyadh", alias: "riyadh saudi arabia 리야드 사우디" },
    { tz: "Asia/Tehran", name: "Tehran", alias: "tehran iran 테헤란 이란" },
    { tz: "Asia/Karachi", name: "Karachi", alias: "karachi pakistan 카라치 파키스탄" },
    { tz: "Asia/Kolkata", name: "Delhi", alias: "delhi new delhi mumbai india 델리 뉴델리 뭄바이 인도" },
    { tz: "Asia/Kathmandu", name: "Kathmandu", alias: "kathmandu nepal 카트만두 네팔" },
    { tz: "Asia/Dhaka", name: "Dhaka", alias: "dhaka bangladesh 다카 방글라데시" },
    { tz: "Asia/Bangkok", name: "Bangkok", alias: "bangkok thailand 방콕 태국" },
    { tz: "Asia/Jakarta", name: "Jakarta", alias: "jakarta indonesia 자카르타 인도네시아" },
    { tz: "Asia/Singapore", name: "Singapore", alias: "singapore 싱가포르" },
    { tz: "Asia/Hong_Kong", name: "Hong Kong", alias: "hong kong 홍콩" },
    { tz: "Asia/Shanghai", name: "Shanghai", alias: "shanghai beijing china 상하이 베이징 중국" },
    { tz: "Asia/Manila", name: "Manila", alias: "manila philippines 마닐라 필리핀" },
    { tz: "Asia/Seoul", name: "Seoul", alias: "seoul korea 서울 한국" },
    { tz: "Asia/Tokyo", name: "Tokyo", alias: "tokyo japan 도쿄 일본" },
    { tz: "Australia/Adelaide", name: "Adelaide", alias: "adelaide australia 애들레이드 호주" },
    { tz: "Australia/Sydney", name: "Sydney", alias: "sydney australia 시드니 호주" },
    { tz: "Pacific/Auckland", name: "Auckland", alias: "auckland new zealand 오클랜드 뉴질랜드" },
    { tz: "Pacific/Honolulu", name: "Honolulu", alias: "honolulu hawaii usa 호놀룰루 하와이" }
  ];
  var BY_TZ = {};
  for (var ci = 0; ci < CITIES.length; ci++) BY_TZ[CITIES[ci].tz] = CITIES[ci];

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  // 주어진 순간의 tz 가 UTC 로부터 몇 분 앞/뒤인지 (DST 자동 반영 — 브라우저 IANA DB)
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
  function zoneOffsetMinutes(date, tz) {
    var p = numParts(makeNumFmt(tz), date);
    var asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return Math.round((asUTC - date.getTime()) / 60000);
  }
  // 도시 벽시계 − 내 벽시계 (분). 30/45분 오프셋도 정확히 유지.
  function offsetBetween(date, cityTz, homeTz) {
    return zoneOffsetMinutes(date, cityTz) - zoneOffsetMinutes(date, homeTz);
  }
  // 도시 달력일 − 내 달력일 (일수: 보통 -1/0/1)
  function dateDiffDays(date, cityTz, homeTz) {
    var c = numParts(makeNumFmt(cityTz), date);
    var h = numParts(makeNumFmt(homeTz), date);
    return Math.round((Date.UTC(c.year, c.month - 1, c.day) - Date.UTC(h.year, h.month - 1, h.day)) / 86400000);
  }
  function formatOffset(min) {
    var sign = min < 0 ? "-" : "+";
    var a = Math.abs(min), hh = Math.floor(a / 60), mm = a % 60;
    return sign + hh + ":" + (mm < 10 ? "0" : "") + mm;
  }
  function dayNightOf(hour) { return (hour >= 6 && hour < 18) ? "day" : "night"; }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다 (DOM 접근 전에 먼저 노출)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      zoneOffsetMinutes: zoneOffsetMinutes,
      offsetBetween: offsetBetween,
      dateDiffDays: dateDiffDays,
      formatOffset: formatOffset,
      dayNightOf: dayNightOf
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
  function relLabel(diff) {
    if (diff === 0) return tr("tool.rel.today", "Today");
    if (diff === -1) return tr("tool.rel.yesterday", "Yesterday");
    if (diff === 1) return tr("tool.rel.tomorrow", "Tomorrow");
    return (diff > 0 ? "+" : "") + diff + "d"; // 극단 케이스(±2일) 폴백
  }

  /* ---- Intl timeZone 지원 감지 (조용한 실패 금지) ---- */
  var HOME_TZ;
  var intlOk = true;
  try {
    HOME_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    makeNumFmt(HOME_TZ).format(new Date()); // 실제 포맷 시도
  } catch (e) { intlOk = false; }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var homeTimeEl = $("wc-home-time"), homeDateEl = $("wc-home-date"), homeZoneEl = $("wc-home-zone");
  var searchEl = $("wc-search"), suggestEl = $("wc-suggest");
  var noticeEl = $("wc-notice"), gridEl = $("wc-grid"), emptyEl = $("wc-empty"), toastEl = $("wc-toast");
  var fmtBtns = document.querySelectorAll(".wc-fmt");
  if (!gridEl || !homeTimeEl || !searchEl) return; // node/구형 환경 — 안전 종료

  /* ---- 안내 문구 (.result) ---- */
  var notices = []; // { key, fallback }
  function renderNotices() {
    if (!noticeEl) return;
    if (!notices.length) { noticeEl.hidden = true; noticeEl.textContent = ""; return; }
    var parts = [];
    for (var i = 0; i < notices.length; i++) parts.push(tr(notices[i].key, notices[i].fallback));
    noticeEl.textContent = parts.join(" · ");
    noticeEl.hidden = false;
  }
  function addNotice(key, fallback) {
    for (var i = 0; i < notices.length; i++) if (notices[i].key === key) return;
    notices.push({ key: key, fallback: fallback });
    renderNotices();
  }

  // Intl 미지원이면 여기서 중단하고 명시적으로 안내
  if (!intlOk) {
    addNotice("tool.noTz", "This browser doesn't support time zones, so the world clock can't run. Please update your browser.");
    if (searchEl) searchEl.disabled = true;
    for (var fb = 0; fb < fmtBtns.length; fb++) fmtBtns[fb].disabled = true;
    return;
  }

  /* ---- 토스트 ---- */
  var toastTimer = null;
  function toast(key, fallback) {
    if (!toastEl) return;
    toastEl.textContent = tr(key, fallback);
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2200);
  }

  /* ---- 저장소 ---- */
  var storageOk = true;
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { storageOk = false; return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { storageOk = false; } }

  /* ---- 상태 ---- */
  var cities = loadCities();   // tz id 배열
  var use24 = loadFormat();    // true = 24h
  var cards = [];              // { tz, timeEl, dateEl, relEl, offEl, iconEl }

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
          return clean.slice(0, MAX_CITIES); // 빈 배열이면 그대로(사용자가 모두 지운 상태) 존중
        }
      } catch (e) { /* 손상값 → 기본값 */ }
      return DEFAULT_TZ.slice();
    }
    return DEFAULT_TZ.slice(); // 첫 방문
  }
  function loadFormat() {
    var raw = lsGet(LS_FORMAT);
    if (raw === "12") return false;
    if (raw === "24") return true;
    return true; // 기본 24시간
  }
  function saveCities() { lsSet(LS_CITIES, JSON.stringify(cities)); }
  function saveFormat() { lsSet(LS_FORMAT, use24 ? "24" : "12"); }

  /* ---- 도시 이름(현지화 우선, 없으면 baked 영어) ---- */
  function cityName(tz) {
    var v = tr("tool.city." + tz, null);
    return v != null ? v : (BY_TZ[tz] ? BY_TZ[tz].name : tz);
  }

  /* ---- 시간 포맷 ---- */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function timeString(p) {
    if (use24) return pad2(p.hour) + ":" + pad2(p.minute) + ":" + pad2(p.second);
    var h = p.hour % 12; if (h === 0) h = 12;
    var ampm = p.hour < 12 ? "AM" : "PM";
    return h + ":" + pad2(p.minute) + ":" + pad2(p.second) + " " + ampm;
  }
  function dateString(date, tz) {
    try {
      return new Intl.DateTimeFormat(uiLang(), {
        timeZone: tz, weekday: "short", month: "short", day: "numeric"
      }).format(date);
    } catch (e) {
      var p = numParts(makeNumFmt(tz), date);
      return p.year + "-" + pad2(p.month) + "-" + pad2(p.day);
    }
  }

  /* ---- 그리드 렌더 (도시 목록 변경 시에만 재생성) ---- */
  function rebuildGrid() {
    cards = [];
    gridEl.innerHTML = "";
    if (!cities.length) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    var mono = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
    for (var i = 0; i < cities.length; i++) {
      var tz = cities[i];
      var card = document.createElement("div");
      card.className = "wc-card";
      card.setAttribute("data-tz", tz);
      card.style.cssText = "position:relative;border:1px solid var(--line);border-radius:12px;padding:14px 12px;background:var(--surface);";

      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "wc-remove";
      rm.setAttribute("aria-label", tr("tool.removeCity", "Remove") + " " + cityName(tz));
      rm.textContent = "×";
      rm.style.cssText = "position:absolute;top:6px;right:6px;width:26px;height:26px;line-height:1;border:none;background:none;color:var(--muted);font-size:20px;cursor:pointer;border-radius:6px;";
      (function (t) { rm.addEventListener("click", function () { removeCity(t); }); })(tz);

      var nameEl = document.createElement("div");
      nameEl.style.cssText = "font-weight:700;font-size:15px;padding-right:22px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      nameEl.textContent = cityName(tz);

      var timeEl = document.createElement("div");
      timeEl.style.cssText = "font-family:" + mono + ";font-variant-numeric:tabular-nums;font-size:24px;font-weight:700;margin:6px 0 2px;";
      timeEl.textContent = "--:--:--";

      var dateEl = document.createElement("div");
      dateEl.style.cssText = "color:var(--muted);font-size:13px;";

      var footer = document.createElement("div");
      footer.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:9px;";
      var relEl = document.createElement("span");
      relEl.style.cssText = "font-size:12px;font-weight:600;";
      var badge = document.createElement("span");
      badge.style.cssText = "display:inline-flex;align-items:center;gap:4px;font-size:12px;font-variant-numeric:tabular-nums;color:var(--muted);";
      var iconEl = document.createElement("span");
      iconEl.textContent = "☀️";
      var offEl = document.createElement("span");
      badge.appendChild(iconEl); badge.appendChild(offEl);
      footer.appendChild(relEl); footer.appendChild(badge);

      card.appendChild(rm); card.appendChild(nameEl); card.appendChild(timeEl);
      card.appendChild(dateEl); card.appendChild(footer);
      gridEl.appendChild(card);

      cards.push({ tz: tz, timeEl: timeEl, dateEl: dateEl, relEl: relEl, offEl: offEl, iconEl: iconEl });
    }
  }

  /* ---- 매 틱 갱신 (텍스트만) ---- */
  function render() {
    var now = new Date();

    // 내 시계
    var hp = numParts(makeNumFmt(HOME_TZ), now);
    homeTimeEl.textContent = timeString(hp);
    homeDateEl.textContent = dateString(now, HOME_TZ);
    homeZoneEl.textContent = HOME_TZ.replace(/_/g, " ") + " · " + "UTC" + formatOffset(zoneOffsetMinutes(now, HOME_TZ));

    // 도시 카드
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var p = numParts(makeNumFmt(c.tz), now);
      c.timeEl.textContent = timeString(p);
      c.dateEl.textContent = dateString(now, c.tz);

      var diff = dateDiffDays(now, c.tz, HOME_TZ);
      c.relEl.textContent = relLabel(diff);
      c.relEl.style.color = diff === 0 ? "var(--muted)" : "var(--accent)";

      var off = offsetBetween(now, c.tz, HOME_TZ);
      c.offEl.textContent = off === 0 ? tr("tool.sameTime", "Same time") : formatOffset(off);

      var dn = dayNightOf(p.hour);
      c.iconEl.textContent = dn === "day" ? "☀️" : "🌙";
      c.iconEl.setAttribute("title", dn === "day" ? tr("tool.day", "Daytime") : tr("tool.night", "Nighttime"));
      c.iconEl.setAttribute("aria-label", dn === "day" ? tr("tool.day", "Daytime") : tr("tool.night", "Nighttime"));
    }
  }

  /* ---- 초 경계에 맞춘 틱 ---- */
  var intervalId = null, alignTimer = null;
  function startTicking() {
    stopTicking();
    render();
    var delay = 1000 - (Date.now() % 1000);
    alignTimer = setTimeout(function () {
      render();
      intervalId = setInterval(render, 1000);
    }, delay);
  }
  function stopTicking() {
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    if (alignTimer) { clearTimeout(alignTimer); alignTimer = null; }
  }

  /* ---- 도시 추가/삭제 ---- */
  function addCity(tz) {
    if (!BY_TZ[tz]) return;
    if (cities.indexOf(tz) !== -1) { toast("tool.duplicate", "That city is already on your board."); return; }
    if (cities.length >= MAX_CITIES) { toast("tool.max", "You can add up to 10 cities."); return; }
    cities.push(tz);
    saveCities();
    rebuildGrid();
    render();
  }
  function removeCity(tz) {
    var idx = cities.indexOf(tz);
    if (idx === -1) return;
    cities.splice(idx, 1);
    saveCities();
    rebuildGrid();
    render();
  }

  /* ---- 검색 / 자동완성 ---- */
  function matches(q) {
    q = q.toLowerCase().trim();
    if (!q) return [];
    var out = [];
    for (var i = 0; i < CITIES.length; i++) {
      var c = CITIES[i];
      if (cities.indexOf(c.tz) !== -1) continue; // 이미 추가된 도시 제외
      var name = cityName(c.tz).toLowerCase();
      if (name.indexOf(q) !== -1 || c.alias.indexOf(q) !== -1) out.push(c);
      if (out.length >= 8) break;
    }
    return out;
  }
  function closeSuggest() {
    suggestEl.hidden = true;
    suggestEl.innerHTML = "";
    searchEl.setAttribute("aria-expanded", "false");
  }
  function renderSuggest() {
    var q = searchEl.value;
    var list = matches(q);
    suggestEl.innerHTML = "";
    if (!q.trim()) { closeSuggest(); return; }
    if (!list.length) {
      var li = document.createElement("li");
      li.textContent = tr("tool.noMatch", "No matching city. Try another name.");
      li.style.cssText = "padding:9px 10px;color:var(--muted);font-size:14px;";
      suggestEl.appendChild(li);
      suggestEl.hidden = false;
      searchEl.setAttribute("aria-expanded", "true");
      return;
    }
    for (var i = 0; i < list.length; i++) {
      (function (c) {
        var li = document.createElement("li");
        li.setAttribute("role", "option");
        li.textContent = cityName(c.tz);
        li.style.cssText = "padding:9px 10px;border-radius:8px;cursor:pointer;font-size:14px;";
        li.addEventListener("mouseenter", function () { li.style.background = "var(--bg)"; });
        li.addEventListener("mouseleave", function () { li.style.background = "none"; });
        // mousedown: input blur 이전에 처리
        li.addEventListener("mousedown", function (ev) {
          ev.preventDefault();
          addCity(c.tz);
          searchEl.value = "";
          closeSuggest();
        });
        suggestEl.appendChild(li);
      })(list[i]);
    }
    suggestEl.hidden = false;
    searchEl.setAttribute("aria-expanded", "true");
  }
  searchEl.addEventListener("input", renderSuggest);
  searchEl.addEventListener("focus", renderSuggest);
  searchEl.addEventListener("blur", function () { setTimeout(closeSuggest, 120); });
  searchEl.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") {
      var list = matches(searchEl.value);
      if (list.length) { addCity(list[0].tz); searchEl.value = ""; closeSuggest(); }
      ev.preventDefault();
    } else if (ev.key === "Escape") {
      closeSuggest();
    }
  });

  /* ---- 포맷 토글 ---- */
  function paintFmt() {
    for (var i = 0; i < fmtBtns.length; i++) {
      var on = (fmtBtns[i].getAttribute("data-fmt") === "24") === use24;
      fmtBtns[i].style.background = on ? "var(--accent)" : "var(--muted)";
      fmtBtns[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
  }
  for (var b = 0; b < fmtBtns.length; b++) {
    (function (btn) {
      btn.addEventListener("click", function () {
        use24 = btn.getAttribute("data-fmt") === "24";
        saveFormat();
        paintFmt();
        render();
      });
    })(fmtBtns[b]);
  }

  /* ---- 언어 전환 시 재렌더 ---- */
  document.addEventListener("i18n:change", function () {
    renderNotices();
    rebuildGrid(); // 도시명/삭제버튼 aria 재번역
    render();
  });

  /* ---- 탭 복귀 시 즉시 갱신 + 재정렬 ---- */
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) startTicking();
  });

  /* ---- 부팅 ---- */
  if (!storageOk) addNotice("tool.noStorage", "Your city list can't be saved in private mode — it will last for this session only.");
  paintFmt();
  rebuildGrid();
  startTicking();
  // TOOLJS:END
})();
