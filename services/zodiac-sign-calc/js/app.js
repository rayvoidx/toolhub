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
  /* Zodiac Sign Calculator — birth date -> Western (tropical) zodiac sign, element,
     modality, a short for-fun trait blurb, and a cusp note near boundary dates.
     Entertainment only. State: localStorage "<slug>:state" (last date entered). No
     external API — sign/date-range table is static data, computed entirely locally. */

  /* ---- 12 signs, standard tropical date ranges (widely-cited approximation —
     exact solar ingress can shift by about a day depending on year/time zone,
     which is why a cusp note is shown near the boundaries).
     start/end: [month, day]. element/modality are classic astrology groupings. */
  var SIGNS = [
    { id: "aries",       symbol: "♈", start: [3, 21],  end: [4, 19],  element: "fire",  modality: "cardinal" },
    { id: "taurus",      symbol: "♉", start: [4, 20],  end: [5, 20],  element: "earth", modality: "fixed" },
    { id: "gemini",      symbol: "♊", start: [5, 21],  end: [6, 20],  element: "air",   modality: "mutable" },
    { id: "cancer",      symbol: "♋", start: [6, 21],  end: [7, 22],  element: "water", modality: "cardinal" },
    { id: "leo",         symbol: "♌", start: [7, 23],  end: [8, 22],  element: "fire",  modality: "fixed" },
    { id: "virgo",       symbol: "♍", start: [8, 23],  end: [9, 22],  element: "earth", modality: "mutable" },
    { id: "libra",       symbol: "♎", start: [9, 23],  end: [10, 22], element: "air",   modality: "cardinal" },
    { id: "scorpio",     symbol: "♏", start: [10, 23], end: [11, 21], element: "water", modality: "fixed" },
    { id: "sagittarius", symbol: "♐", start: [11, 22], end: [12, 21], element: "fire",  modality: "mutable" },
    { id: "capricorn",   symbol: "♑", start: [12, 22], end: [1, 19],  element: "earth", modality: "cardinal" },
    { id: "aquarius",    symbol: "♒", start: [1, 20],  end: [2, 18],  element: "air",   modality: "fixed" },
    { id: "pisces",      symbol: "♓", start: [2, 19],  end: [3, 20],  element: "water", modality: "mutable" }
  ];

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  function mmdd(m, d) { return m * 100 + d; }

  // month(1-12)/day(1-31) -> SIGNS 인덱스. capricorn 만 연말/연초를 넘나든다(wrap).
  function findSignIndex(month, day) {
    var v = mmdd(month, day);
    for (var i = 0; i < SIGNS.length; i++) {
      var s = SIGNS[i];
      var sv = mmdd(s.start[0], s.start[1]), ev = mmdd(s.end[0], s.end[1]);
      if (sv <= ev) {
        if (v >= sv && v <= ev) return i;
      } else if (v >= sv || v <= ev) {
        return i; // wrap-around range (capricorn)
      }
    }
    return -1;
  }

  // 기준연도(임의, 윤년 여부는 이 계산에 영향 없음) 안에서 month/day 에 delta 일을 더한 [month, day]
  function addDays(month, day, delta) {
    var d = new Date(Date.UTC(2001, month - 1, day));
    d.setUTCDate(d.getUTCDate() + delta);
    return [d.getUTCMonth() + 1, d.getUTCDate()];
  }
  function sameMD(a, b) { return a[0] === b[0] && a[1] === b[1]; }

  // 경계(첫날/마지막날 근방 1일 이내)면 이웃 별자리 인덱스를 반환, 아니면 null
  function findCusp(idx, month, day) {
    var s = SIGNS[idx];
    var md = [month, day];
    var startPlus1 = addDays(s.start[0], s.start[1], 1);
    var endMinus1 = addDays(s.end[0], s.end[1], -1);
    if (sameMD(md, s.start) || sameMD(md, startPlus1)) return (idx - 1 + 12) % 12;
    if (sameMD(md, s.end) || sameMD(md, endMinus1)) return (idx + 1) % 12;
    return null;
  }

  // "YYYY-MM-DD" (input[type=date].value 형식) -> {y,m,d} 또는 null
  function parseISODate(str) {
    if (!str) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str).trim());
    if (!m) return null;
    var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), da = parseInt(m[3], 10);
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    // 실제 존재하는 날짜인지(2월 30일 등 방지) — UTC 왕복으로 검증
    var check = new Date(Date.UTC(y, mo - 1, da));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== da) return null;
    return { y: y, m: mo, d: da };
  }

  function computeZodiac(isoStr) {
    var parsed = parseISODate(isoStr);
    if (!parsed) return null;
    var idx = findSignIndex(parsed.m, parsed.d);
    if (idx < 0) return null;
    var cuspIdx = findCusp(idx, parsed.m, parsed.d);
    return {
      index: idx,
      sign: SIGNS[idx],
      cuspIndex: cuspIdx,
      cuspSign: cuspIdx == null ? null : SIGNS[cuspIdx]
    };
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      SIGNS: SIGNS, mmdd: mmdd, findSignIndex: findSignIndex, addDays: addDays,
      findCusp: findCusp, parseISODate: parseISODate, computeZodiac: computeZodiac
    };
    return;
  }

  /* ---- i18n · Intl 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "zodiac-sign-calc") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  // 연도 없이 월/일만 그 언어 관례대로 표시 (기준연도는 임의 — 결과에 노출되지 않는다)
  function fmtMonthDay(month, day) {
    try {
      var d = new Date(Date.UTC(2001, month - 1, day));
      return new Intl.DateTimeFormat(uiLang(), { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
    } catch (e) { return month + "/" + day; }
  }
  function fmtRange(sign) {
    return fmtMonthDay(sign.start[0], sign.start[1]) + " – " + fmtMonthDay(sign.end[0], sign.end[1]);
  }
  function signName(sign) { return tr("tool.sign." + sign.id, sign.id); }
  function elementName(el) { return tr("tool.element." + el, el); }
  function modalityName(mo) { return tr("tool.modality." + mo, mo); }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var dateEl = $("birth-date");
  var emptyEl = $("result-empty"), cardEl = $("result-card"), errEl = $("result-err");
  var symbolEl = $("res-symbol"), nameEl = $("res-name"), rangeEl = $("res-range");
  var elementEl = $("res-element"), modalityEl = $("res-modality"), traitEl = $("res-trait");
  var cuspEl = $("res-cusp");
  var tableBody = $("sign-table-body");
  if (!dateEl || !cardEl || !tableBody) return;

  // 미래 날짜(아직 태어나지 않은 날짜) 방지
  (function capMaxDate() {
    var today = new Date();
    var mm = String(today.getMonth() + 1); if (mm.length < 2) mm = "0" + mm;
    var dd = String(today.getDate()); if (dd.length < 2) dd = "0" + dd;
    dateEl.max = today.getFullYear() + "-" + mm + "-" + dd;
  })();

  /* ---- 전체 12 별자리 표 (참조 테이블 — SEO/롱테일 대응) ---- */
  function renderTable() {
    tableBody.textContent = "";
    for (var i = 0; i < SIGNS.length; i++) {
      var s = SIGNS[i];
      var tr2 = document.createElement("tr");

      var tdSign = document.createElement("td");
      tdSign.textContent = s.symbol + " " + signName(s);
      tr2.appendChild(tdSign);

      var tdRange = document.createElement("td");
      tdRange.textContent = fmtRange(s);
      tr2.appendChild(tdRange);

      var tdEl = document.createElement("td");
      tdEl.textContent = elementName(s.element);
      tr2.appendChild(tdEl);

      var tdMo = document.createElement("td");
      tdMo.textContent = modalityName(s.modality);
      tr2.appendChild(tdMo);

      tableBody.appendChild(tr2);
    }
  }

  /* ---- 결과 렌더 ---- */
  function showEmpty() {
    cardEl.hidden = true;
    errEl.hidden = true;
    emptyEl.hidden = false;
  }
  function showErr() {
    cardEl.hidden = true;
    emptyEl.hidden = true;
    errEl.hidden = false;
  }
  function render() {
    var raw = dateEl.value;
    if (!raw) { showEmpty(); return; }

    var result = computeZodiac(raw);
    if (!result) { showErr(); return; }

    var s = result.sign;
    symbolEl.textContent = s.symbol;
    nameEl.textContent = signName(s);
    rangeEl.textContent = fmtRange(s);
    elementEl.textContent = elementName(s.element);
    modalityEl.textContent = modalityName(s.modality);
    traitEl.textContent = tr("tool.trait." + s.id, "");

    if (result.cuspSign) {
      var parsed = parseISODate(raw);
      cuspEl.textContent = tr("tool.cusp.note", "")
        .replace("{date}", fmtMonthDay(parsed.m, parsed.d))
        .replace("{a}", signName(s))
        .replace("{b}", signName(result.cuspSign));
      cuspEl.hidden = false;
    } else {
      cuspEl.hidden = true;
    }

    emptyEl.hidden = true;
    errEl.hidden = true;
    cardEl.hidden = false;

    try { localStorage.setItem(SKEY, raw); } catch (e) { /* private mode */ }
  }

  /* ---- 상태 복원 ---- */
  function restore() {
    var stored = null;
    try { stored = localStorage.getItem(SKEY); } catch (e) { /* noop */ }
    if (stored && parseISODate(stored)) dateEl.value = stored;
  }

  /* ---- 이벤트 ---- */
  dateEl.addEventListener("input", render);
  dateEl.addEventListener("change", render);
  document.addEventListener("i18n:change", function () {
    renderTable();
    render();
  });

  renderTable();
  restore();
  render();
  // TOOLJS:END
})();
