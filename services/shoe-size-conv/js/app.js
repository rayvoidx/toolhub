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
  /* Shoe Size Converter — US / UK / EU / cm(Japan·Asia) 상호 변환.
     공식(선형 회귀)이 아니라 실제 판매 사이즈표를 그대로 박은 테이블 조회 방식이라
     브랜드가 신발 박스에 인쇄하는 숫자와 어긋나지 않는다. 남성/여성/아동 3개 표를 분리한
     이유: 같은 물리적 발 길이라도 남성·여성 US 표기가 서로 다르고, 아동은 별도 유소년 표를
     쓴다. cm 입력은 임의의 소수(발 길이 실측값)를 허용하고 표에서 가장 가까운 행을 찾는다
     (동률이면 더 큰 쪽 = 여유 있게 안전한 쪽으로 반올림). 외부 API 없음, 모든 계산은 로컬. */

  /* ---- 사이즈표 (정적 데이터 — 브랜드마다 0.5 사이즈 안팎 편차가 있는 것이 정상이라
     "공식"이 아니라 "표"를 쓴다. 각 행: us/uk/eu/cm 모두 같은 물리적 발 크기를 가리킨다.) ---- */
  var TABLES = {
    men: [
      { us: 6,    uk: 5.5,  eu: 38.5, cm: 24 },
      { us: 6.5,  uk: 6,    eu: 39,   cm: 24.5 },
      { us: 7,    uk: 6.5,  eu: 40,   cm: 25 },
      { us: 7.5,  uk: 7,    eu: 40.5, cm: 25.5 },
      { us: 8,    uk: 7.5,  eu: 41,   cm: 26 },
      { us: 8.5,  uk: 8,    eu: 42,   cm: 26.5 },
      { us: 9,    uk: 8.5,  eu: 42.5, cm: 27 },
      { us: 9.5,  uk: 9,    eu: 43,   cm: 27.5 },
      { us: 10,   uk: 9.5,  eu: 44,   cm: 28 },
      { us: 10.5, uk: 10,   eu: 44.5, cm: 28.5 },
      { us: 11,   uk: 10.5, eu: 45,   cm: 29 },
      { us: 11.5, uk: 11,   eu: 45.5, cm: 29.5 },
      { us: 12,   uk: 11.5, eu: 46,   cm: 30 },
      { us: 13,   uk: 12.5, eu: 47.5, cm: 31 },
      { us: 14,   uk: 13.5, eu: 48.5, cm: 32 },
      { us: 15,   uk: 14.5, eu: 49.5, cm: 33 }
    ],
    women: [
      { us: 5,    uk: 2.5,  eu: 35.5, cm: 22 },
      { us: 5.5,  uk: 3,    eu: 36,   cm: 22.5 },
      { us: 6,    uk: 3.5,  eu: 36.5, cm: 23 },
      { us: 6.5,  uk: 4,    eu: 37.5, cm: 23.5 },
      { us: 7,    uk: 4.5,  eu: 38,   cm: 24 },
      { us: 7.5,  uk: 5,    eu: 38.5, cm: 24.5 },
      { us: 8,    uk: 5.5,  eu: 39,   cm: 25 },
      { us: 8.5,  uk: 6,    eu: 40,   cm: 25.5 },
      { us: 9,    uk: 6.5,  eu: 40.5, cm: 26 },
      { us: 9.5,  uk: 7,    eu: 41,   cm: 26.5 },
      { us: 10,   uk: 7.5,  eu: 42,   cm: 27 },
      { us: 10.5, uk: 8,    eu: 42.5, cm: 27.5 },
      { us: 11,   uk: 8.5,  eu: 43,   cm: 28 },
      { us: 12,   uk: 9.5,  eu: 44,   cm: 29 }
    ],
    // 유소년(youth/big-kid) US 1~7 — 약 만 3~12세. 그 아래(유아/토들러) 사이즈 체계는
    // 별도라 신발 박스에 인쇄된 토들러 표를 대신 참고하도록 FAQ 에서 안내한다.
    kids: [
      { us: 1,    uk: 13.5, eu: 32,   cm: 20 },
      { us: 1.5,  uk: 14,   eu: 33,   cm: 20.5 },
      { us: 2,    uk: 14.5, eu: 33.5, cm: 21 },
      { us: 2.5,  uk: 15,   eu: 34,   cm: 21.5 },
      { us: 3,    uk: 15.5, eu: 35,   cm: 22 },
      { us: 3.5,  uk: 16,   eu: 35.5, cm: 22.5 },
      { us: 4,    uk: 16.5, eu: 36,   cm: 23 },
      { us: 4.5,  uk: 17,   eu: 36.5, cm: 23.5 },
      { us: 5,    uk: 17.5, eu: 37.5, cm: 24 },
      { us: 5.5,  uk: 18,   eu: 38,   cm: 24.5 },
      { us: 6,    uk: 18.5, eu: 38.5, cm: 25 },
      { us: 6.5,  uk: 19,   eu: 39,   cm: 25.5 },
      { us: 7,    uk: 19.5, eu: 40,   cm: 26 }
    ]
  };
  // 카테고리 전환 시 되돌아갈 기본 행(US 기준) — 검색 없이도 그럴듯한 값이 바로 보이게
  var DEFAULT_US = { men: 9, women: 8, kids: 3 };
  var CATEGORIES = ["men", "women", "kids"];
  var SYSTEMS = ["us", "uk", "eu", "cm"];

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  function defaultIndex(category) {
    var rows = TABLES[category], target = DEFAULT_US[category];
    for (var i = 0; i < rows.length; i++) if (rows[i].us === target) return i;
    return Math.floor(rows.length / 2);
  }
  // cm 입력 파싱: 콤마 제거, 숫자 아니면 NaN 그대로 반환(호출부가 유효성 판단)
  function parseCm(raw) {
    if (raw == null) return NaN;
    var n = parseFloat(String(raw).replace(/,/g, "").trim());
    return n;
  }
  // 표에서 cm 값이 가장 가까운 행 탐색. 동률이면 더 큰(넉넉한) 쪽 채택 — 꽉 끼는 것보다
  // 여유 있는 신발이 안전하다는 통념을 반영. 표 범위를 벗어나면 clamped=true 로 알린다.
  function findNearestRow(rows, cm) {
    var best = rows[0], bestDiff = Math.abs(rows[0].cm - cm);
    for (var i = 1; i < rows.length; i++) {
      var diff = Math.abs(rows[i].cm - cm);
      if (diff < bestDiff - 1e-9 || (Math.abs(diff - bestDiff) <= 1e-9 && rows[i].cm > best.cm)) {
        best = rows[i]; bestDiff = diff;
      }
    }
    var clamped = cm < rows[0].cm || cm > rows[rows.length - 1].cm;
    return { row: best, clamped: clamped };
  }
  function normCategory(v) { return CATEGORIES.indexOf(v) === -1 ? null : v; }
  function normSystem(v) { return SYSTEMS.indexOf(v) === -1 ? null : v; }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      TABLES: TABLES, DEFAULT_US: DEFAULT_US,
      defaultIndex: defaultIndex, parseCm: parseCm, findNearestRow: findNearestRow,
      normCategory: normCategory, normSystem: normSystem
    };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "shoe-size-conv") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmtSize(n) {
    try { return Number(n).toLocaleString(uiLang(), { minimumFractionDigits: 0, maximumFractionDigits: 1 }); }
    catch (e) { return String(n); }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var categoryEl = $("category-select"), systemEl = $("system-select");
  var sizeSelectEl = $("size-select"), cmInputEl = $("cm-input"), cmHintEl = $("cm-hint");
  var errCmEl = $("err-cm");
  var emptyEl = $("result-empty"), gridEl = $("result-grid"), badgeEl = $("result-badge");
  var rUs = $("r-us"), rUk = $("r-uk"), rEu = $("r-eu"), rCm = $("r-cm");
  var noteClampedEl = $("note-clamped");
  if (!categoryEl || !systemEl || !sizeSelectEl || !cmInputEl || !gridEl) return;

  /* ---- 상태 (localStorage 복원 → 유효성 검증 → 기본값) ---- */
  function loadState() {
    var s = null;
    try {
      var raw = localStorage.getItem(SKEY);
      if (raw) s = JSON.parse(raw);
    } catch (e) { s = null; } // private mode / 손상된 값 — 기본값으로 진행
    var category = (s && normCategory(s.category)) || "men";
    var system = (s && normSystem(s.system)) || "us";
    var rowIndex = defaultIndex(category);
    if (s && typeof s.rowIndex === "number" && s.rowIndex >= 0 && s.rowIndex < TABLES[category].length) {
      rowIndex = s.rowIndex;
    }
    var cm = (s && typeof s.cm === "string") ? s.cm : String(TABLES[category][rowIndex].cm);
    return { category: category, system: system, rowIndex: rowIndex, cm: cm };
  }
  var state = loadState();
  function saveState() {
    try { localStorage.setItem(SKEY, JSON.stringify(state)); } catch (e) { /* noop */ }
  }

  /* ---- 사이즈 선택 select 채우기 (표 순서 = 옵션 인덱스, 언어별 숫자 표기 반영) ---- */
  function populateSizeSelect() {
    var rows = TABLES[state.category];
    sizeSelectEl.textContent = "";
    for (var i = 0; i < rows.length; i++) {
      var opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = fmtSize(rows[i][state.system]);
      sizeSelectEl.appendChild(opt);
    }
    if (state.rowIndex >= rows.length) state.rowIndex = defaultIndex(state.category);
    sizeSelectEl.value = String(state.rowIndex);
  }

  /* ---- system/category 변경에 따른 필드 표시 전환 ---- */
  function syncFieldVisibility() {
    var isCm = state.system === "cm";
    sizeSelectEl.hidden = isCm;
    cmInputEl.hidden = !isCm;
    cmHintEl.hidden = !isCm;
    if (isCm) {
      cmInputEl.value = state.cm;
    } else {
      populateSizeSelect();
    }
  }

  /* ---- 렌더 ---- */
  function render() {
    var rows = TABLES[state.category];
    var row, clamped = false;

    if (state.system === "cm") {
      var raw = cmInputEl.value;
      if (raw.trim() === "") {
        emptyEl.hidden = false; gridEl.hidden = true; errCmEl.hidden = true;
        return;
      }
      var v = parseCm(raw);
      if (!(isFinite(v) && v > 0)) {
        emptyEl.hidden = true; gridEl.hidden = true; errCmEl.hidden = false;
        return;
      }
      var res = findNearestRow(rows, v);
      row = res.row; clamped = res.clamped;
    } else {
      row = rows[state.rowIndex] || rows[defaultIndex(state.category)];
    }

    errCmEl.hidden = true;
    emptyEl.hidden = true;
    gridEl.hidden = false;
    rUs.textContent = fmtSize(row.us);
    rUk.textContent = fmtSize(row.uk);
    rEu.textContent = fmtSize(row.eu);
    rCm.textContent = fmtSize(row.cm) + " cm";
    badgeEl.textContent = tr("tool.result.badge." + state.category);

    if (clamped) {
      noteClampedEl.textContent = tr("tool.note.clamped", "That's outside the standard chart — showing the closest size instead ({size} cm).")
        .replace("{size}", fmtSize(row.cm));
      noteClampedEl.hidden = false;
    } else {
      noteClampedEl.hidden = true;
    }
  }

  /* ---- 이벤트 ---- */
  categoryEl.addEventListener("change", function () {
    var c = normCategory(categoryEl.value);
    if (!c) { categoryEl.value = state.category; return; }
    state.category = c;
    state.rowIndex = defaultIndex(c);
    if (state.system === "cm") state.cm = String(TABLES[c][state.rowIndex].cm);
    syncFieldVisibility();
    saveState();
    render();
  });

  systemEl.addEventListener("change", function () {
    var s = normSystem(systemEl.value);
    if (!s) { systemEl.value = state.system; return; }
    if (s === "cm" && state.system !== "cm") {
      // us/uk/eu → cm: 지금 고른 행의 cm 값을 그대로 입력칸에 채워, 같은 발 크기를 유지
      state.cm = String(TABLES[state.category][state.rowIndex].cm);
    } else if (s !== "cm" && state.system === "cm") {
      // cm → us/uk/eu: 입력한 cm 과 가장 가까운 행을 찾아 그 행을 새 기준으로 삼는다
      var v = parseCm(cmInputEl.value);
      if (isFinite(v) && v > 0) {
        var res = findNearestRow(TABLES[state.category], v);
        state.rowIndex = TABLES[state.category].indexOf(res.row);
      }
    }
    state.system = s;
    syncFieldVisibility();
    saveState();
    render();
  });

  sizeSelectEl.addEventListener("change", function () {
    var idx = parseInt(sizeSelectEl.value, 10);
    if (isFinite(idx)) state.rowIndex = idx;
    saveState();
    render();
  });

  cmInputEl.addEventListener("input", function () {
    state.cm = cmInputEl.value;
    saveState();
    render();
  });
  cmInputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); this.blur(); render(); }
  });

  // 언어 전환 시 옵션 문구·숫자 표기·배지 문구 재적용
  document.addEventListener("i18n:change", function () {
    if (state.system !== "cm") populateSizeSelect();
    render();
  });

  syncFieldVisibility();
  render();
  // TOOLJS:END
})();
