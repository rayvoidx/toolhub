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
  /* Moon Phase Calculator — approximate moon phase for today or any date, using the
     average synodic month from a known reference new moon. Loads with today's phase,
     supports any-date lookup, shows illumination %, moon age, and next full/new moon.
     Approximate (~±1 day) — honestly disclosed, not for navigation/tide/scientific use.
     State: localStorage "<slug>:state" (last date looked up). No external API — all
     math runs locally. */

  /* ---- 상수 (참조 신월 기준시각 2000-01-06 18:14 UTC — 널리 쓰이는 공개 근사 기준점)
     SYNODIC_DAYS: 삭망월(신월→신월) 평균 길이. 실제 주기는 계절적으로 약간 변동하지만
     평균값 사용은 널리 쓰이는 근사법이며 결과 정확도는 대략 ±1일 수준이다. */
  var SYNODIC_DAYS = 29.530588853;
  var DAY_MS = 86400000;
  var EPOCH_MS = Date.UTC(2000, 0, 6, 18, 14, 0); // 기준 신월(New Moon)

  // 8단계 위상 id (순서 고정) + 참조용 유니코드 글리프
  var PHASE_IDS = ["new", "waxingCrescent", "firstQuarter", "waxingGibbous",
    "full", "waningGibbous", "lastQuarter", "waningCrescent"];
  var PHASE_GLYPHS = ["🌑", "🌒", "🌓", "🌔",
    "🌕", "🌖", "🌗", "🌘"];

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  // 기준 신월 이후 경과일(0 ~ SYNODIC_DAYS) — 음수 나머지 보정 포함
  function moonAgeDays(ms) {
    var days = (ms - EPOCH_MS) / DAY_MS;
    var age = days % SYNODIC_DAYS;
    if (age < 0) age += SYNODIC_DAYS;
    return age;
  }
  // 경과일 -> 8단계 인덱스. 각 구간은 삭망월/8 폭이며 경계는 구간 중심으로 반올림.
  function phaseIndex(ageDays) {
    var seg = SYNODIC_DAYS / 8;
    return Math.floor((ageDays + seg / 2) / seg) % 8;
  }
  // 경과일 -> 조도(0~1). 코사인 근사(실제 위상각과 대략 일치, 궤도 이심률 등은 무시).
  function illumination(ageDays) {
    var frac = ageDays / SYNODIC_DAYS;
    return (1 - Math.cos(2 * Math.PI * frac)) / 2;
  }
  // 주어진 시각 이후(포함) 가장 가까운 신월 시각(ms)
  function nextNewMoonMs(ms) {
    var cycles = (ms - EPOCH_MS) / (SYNODIC_DAYS * DAY_MS);
    var k = Math.ceil(cycles - 1e-9);
    return EPOCH_MS + k * SYNODIC_DAYS * DAY_MS;
  }
  // 주어진 시각 이후(포함) 가장 가까운 보름달 시각(ms) — 신월 기준 + 반주기
  function nextFullMoonMs(ms) {
    var fullEpoch = EPOCH_MS + (SYNODIC_DAYS / 2) * DAY_MS;
    var cycles = (ms - fullEpoch) / (SYNODIC_DAYS * DAY_MS);
    var k = Math.ceil(cycles - 1e-9);
    return fullEpoch + k * SYNODIC_DAYS * DAY_MS;
  }
  // "YYYY-MM-DD" (input[type=date].value 형식) -> UTC 정오 ms, 또는 null.
  // 정오를 쓰는 이유: 근사 계산이라 자정 경계에서의 하루 오차는 어차피 고지된 오차범위 안.
  function parseISODate(str) {
    if (!str) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str).trim());
    if (!m) return null;
    var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), da = parseInt(m[3], 10);
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    var check = new Date(Date.UTC(y, mo - 1, da));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== da) return null;
    return Date.UTC(y, mo - 1, da, 12, 0, 0);
  }
  function isoFromMs(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }
  function computeMoon(isoStr) {
    var ms = parseISODate(isoStr);
    if (ms == null) return null;
    var age = moonAgeDays(ms);
    return {
      ms: ms,
      ageDays: age,
      phaseIdx: phaseIndex(age),
      illum: illumination(age),
      nextFullMs: nextFullMoonMs(ms),
      nextNewMs: nextNewMoonMs(ms)
    };
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      SYNODIC_DAYS: SYNODIC_DAYS, EPOCH_MS: EPOCH_MS, PHASE_IDS: PHASE_IDS,
      moonAgeDays: moonAgeDays, phaseIndex: phaseIndex, illumination: illumination,
      nextNewMoonMs: nextNewMoonMs, nextFullMoonMs: nextFullMoonMs,
      parseISODate: parseISODate, isoFromMs: isoFromMs, computeMoon: computeMoon
    };
    return;
  }

  /* ---- i18n · Intl 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "moon-phase-calc") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmtNum(n, digits) {
    try { return new Intl.NumberFormat(uiLang(), { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n); }
    catch (e) { return n.toFixed(digits); }
  }
  function fmtPercent(frac) {
    try { return new Intl.NumberFormat(uiLang(), { style: "percent", maximumFractionDigits: 0 }).format(frac); }
    catch (e) { return Math.round(frac * 100) + "%"; }
  }
  function fmtDate(ms) {
    try {
      return new Intl.DateTimeFormat(uiLang(), { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(ms));
    } catch (e) { return isoFromMs(ms); }
  }
  function phaseName(id) { return tr("tool.phase." + id, id); }
  function phaseDesc(id) { return tr("tool.phaseDesc." + id, ""); }
  function todayISO() {
    var d = new Date();
    var mm = String(d.getMonth() + 1); if (mm.length < 2) mm = "0" + mm;
    var dd = String(d.getDate()); if (dd.length < 2) dd = "0" + dd;
    return d.getFullYear() + "-" + mm + "-" + dd;
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var dateEl = $("moon-date"), todayBtn = $("today-btn");
  var emptyEl = $("result-empty"), errEl = $("result-err"), cardEl = $("result-card");
  var glyphEl = $("res-glyph"), nameEl = $("res-name");
  var illumEl = $("res-illum"), ageEl = $("res-age"), nextFullEl = $("res-nextfull"), nextNewEl = $("res-nextnew");
  var stripEl = $("phase-strip");
  if (!dateEl || !cardEl || !stripEl) return;

  /* ---- 8단계 참조 스트립 (SEO/롱테일 대응 — 위상 이름 설명) ---- */
  function renderStrip(curIdx) {
    stripEl.textContent = "";
    for (var i = 0; i < PHASE_IDS.length; i++) {
      var id = PHASE_IDS[i];
      var item = document.createElement("div");
      item.className = "phase-item" + (i === curIdx ? " cur" : "");

      var g = document.createElement("span");
      g.className = "phase-glyph";
      g.setAttribute("aria-hidden", "true");
      g.textContent = PHASE_GLYPHS[i];
      item.appendChild(g);

      var n = document.createElement("p");
      n.className = "phase-name";
      n.textContent = phaseName(id);
      item.appendChild(n);

      var d = document.createElement("p");
      d.className = "phase-desc";
      d.textContent = phaseDesc(id);
      item.appendChild(d);

      stripEl.appendChild(item);
    }
  }

  /* ---- 결과 렌더 ---- */
  function showEmpty() { cardEl.hidden = true; errEl.hidden = true; emptyEl.hidden = false; renderStrip(-1); }
  function showErr() { cardEl.hidden = true; emptyEl.hidden = true; errEl.hidden = false; renderStrip(-1); }

  function fmtRelDate(targetMs, nowMs) {
    var days = Math.round((targetMs - nowMs) / DAY_MS);
    var suffix = days <= 0 ? tr("tool.res.today", "Today") : tr("tool.res.inDays", "in {n} days").replace("{n}", fmtNum(days, 0));
    return fmtDate(targetMs) + " · " + suffix;
  }

  function render() {
    var raw = dateEl.value;
    if (!raw) { showEmpty(); return; }

    var r = computeMoon(raw);
    if (!r) { showErr(); return; }

    glyphEl.textContent = PHASE_GLYPHS[r.phaseIdx];
    nameEl.textContent = phaseName(PHASE_IDS[r.phaseIdx]);
    illumEl.textContent = fmtPercent(r.illum);
    ageEl.textContent = fmtNum(r.ageDays, 1) + " " + tr("tool.unit.days", "days");
    nextFullEl.textContent = fmtRelDate(r.nextFullMs, r.ms);
    nextNewEl.textContent = fmtRelDate(r.nextNewMs, r.ms);

    emptyEl.hidden = true;
    errEl.hidden = true;
    cardEl.hidden = false;

    renderStrip(r.phaseIdx);

    try { localStorage.setItem(SKEY, raw); } catch (e) { /* private mode */ }
  }

  /* ---- 상태 복원 (없으면 오늘) ---- */
  function restore() {
    var stored = null;
    try { stored = localStorage.getItem(SKEY); } catch (e) { /* noop */ }
    dateEl.value = (stored && parseISODate(stored)) ? stored : todayISO();
  }

  /* ---- 이벤트 ---- */
  dateEl.addEventListener("input", render);
  dateEl.addEventListener("change", render);
  if (todayBtn) {
    todayBtn.addEventListener("click", function () {
      dateEl.value = todayISO();
      render();
    });
  }
  document.addEventListener("i18n:change", function () {
    render();
  });

  restore();
  render();
  // TOOLJS:END
})();
