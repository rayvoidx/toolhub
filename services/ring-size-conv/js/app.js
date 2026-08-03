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
  /* Ring Size Converter — US/CA <-> UK/AU letters <-> EU(ISO 원둘레 mm) <-> Japan/Korea(号)
     <-> 내경 mm 상호 변환. 공식(선형 회귀)이 아니라 실제 유통되는 반지 사이즈표를 그대로
     박은 테이블 조회 방식이라 브랜드가 반지 안쪽에 각인하는 숫자와 어긋나지 않는다.
     일본과 한국은 号(호수) 표기가 동일한 척도라 하나의 jp 컬럼으로 양쪽 수요를 함께
     커버한다. EU 는 정의상 원둘레(mm) 그 자체이고, mm(내경)은 그와는 다른 물리량이라
     별도 컬럼으로 둔다 — 반지를 이미 갖고 있어 안지름을 재는 사용자를 위해서다.
     us/uk/jp 는 이산적인 값이라 드롭다운으로, eu/mm 은 자로 잰 임의의 소수를 입력받아
     표에서 가장 가까운 행을 찾는다(동률이면 더 큰 쪽 = 여유 있게 안전한 쪽 채택).
     외부 API 없음, 모든 계산은 로컬. */

  /* ---- 사이즈표 (정적 데이터 — US 3~13, 0.5 간격 반 사이즈까지 포함) ----
     us : 미국·캐나다 반지 사이즈
     uk : 영국·호주·아일랜드 알파벳 사이즈 (반 사이즈는 첨자 ½)
     eu : EU/ISO 8653 사이즈 = 손가락 원둘레(mm) 그 자체
     jp : 일본·한국 호수(号) — 한국의 "반지 호수"도 이 척도와 동일
     mm : 반지 내경(안지름, mm) — 이미 맞는 반지를 갖고 있을 때 재는 값 */
  var TABLE = [
    /* 저연령·핑키(새끼손가락)·미디 링 수요 — 시중 브랜드가 판매하는 US 2 까지 확장.
       내경 0.4mm 간격, UK 는 D/E, EU 는 내경×π 원둘레, 号는 2/3. */
    { us: 2,    uk: "D",  eu: 41.7, jp: 2,  mm: 13.3 },
    { us: 2.5,  uk: "E",  eu: 42.9, jp: 3,  mm: 13.7 },
    { us: 3,    uk: "F",  eu: 44.0, jp: 4,  mm: 14.1 },
    { us: 3.5,  uk: "G",  eu: 45.5, jp: 5,  mm: 14.5 },
    { us: 4,    uk: "H",  eu: 46.8, jp: 7,  mm: 14.9 },
    { us: 4.5,  uk: "I",  eu: 48.0, jp: 8,  mm: 15.3 },
    { us: 5,    uk: "J½", eu: 49.3, jp: 9,  mm: 15.7 },
    { us: 5.5,  uk: "K½", eu: 50.6, jp: 10, mm: 16.1 },
    { us: 6,    uk: "L½", eu: 51.9, jp: 12, mm: 16.5 },
    { us: 6.5,  uk: "M½", eu: 53.1, jp: 13, mm: 16.9 },
    { us: 7,    uk: "N½", eu: 54.4, jp: 14, mm: 17.3 },
    { us: 7.5,  uk: "O½", eu: 55.7, jp: 15, mm: 17.7 },
    { us: 8,    uk: "P½", eu: 57.0, jp: 17, mm: 18.1 },
    { us: 8.5,  uk: "Q½", eu: 58.3, jp: 18, mm: 18.5 },
    { us: 9,    uk: "R½", eu: 59.5, jp: 19, mm: 18.9 },
    { us: 9.5,  uk: "S½", eu: 60.8, jp: 21, mm: 19.3 },
    { us: 10,   uk: "T½", eu: 62.1, jp: 22, mm: 19.7 },
    { us: 10.5, uk: "U½", eu: 63.4, jp: 23, mm: 20.1 },
    { us: 11,   uk: "V½", eu: 64.6, jp: 24, mm: 20.5 },
    { us: 11.5, uk: "W½", eu: 65.9, jp: 26, mm: 20.9 },
    { us: 12,   uk: "X½", eu: 67.2, jp: 27, mm: 21.3 },
    { us: 12.5, uk: "Y½", eu: 68.5, jp: 28, mm: 21.7 },
    { us: 13,   uk: "Z½", eu: 69.7, jp: 29, mm: 22.2 },
    /* 남성용 대형 사이즈 — 시중 브랜드가 실제로 판매하는 US 16까지 확장.
       UK 는 Z 이후 Z+1…Z+6 표기, 내경 0.4mm 간격, EU 는 내경×π 원둘레. */
    { us: 13.5, uk: "Z+1", eu: 71.0, jp: 30, mm: 22.6 },
    { us: 14,   uk: "Z+2", eu: 72.3, jp: 31, mm: 23.0 },
    { us: 14.5, uk: "Z+3", eu: 73.5, jp: 32, mm: 23.4 },
    { us: 15,   uk: "Z+4", eu: 74.8, jp: 33, mm: 23.8 },
    { us: 15.5, uk: "Z+5", eu: 76.0, jp: 35, mm: 24.2 },
    { us: 16,   uk: "Z+6", eu: 77.3, jp: 36, mm: 24.6 }
  ];
  var DEFAULT_US = 7; // 흔히 쓰이는 중간값 — 검색 없이도 그럴듯한 결과가 바로 보이게
  var SYSTEMS = ["us", "uk", "eu", "jp", "mm"];
  var SELECT_SYSTEMS = ["us", "uk", "jp"];   // 이산값 → 드롭다운
  var NUMERIC_SYSTEMS = ["eu", "mm"];        // 연속값(실측 mm) → 텍스트 입력 + 최근접 탐색

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  function defaultIndex() {
    for (var i = 0; i < TABLE.length; i++) if (TABLE[i].us === DEFAULT_US) return i;
    return Math.floor(TABLE.length / 2);
  }
  // 숫자 파싱: 콤마 제거, 숫자 아니면 NaN 그대로 반환(호출부가 유효성 판단)
  function parseNum(raw) {
    if (raw == null) return NaN;
    return parseFloat(String(raw).replace(/,/g, "").trim());
  }
  // 표에서 field(eu|mm) 값이 가장 가까운 행 탐색. 동률이면 더 큰(여유 있는) 쪽 채택.
  // 표 범위를 벗어나면 clamped=true 로 알린다.
  function findNearestRow(rows, value, field) {
    var best = rows[0], bestDiff = Math.abs(rows[0][field] - value);
    for (var i = 1; i < rows.length; i++) {
      var diff = Math.abs(rows[i][field] - value);
      if (diff < bestDiff - 1e-9 || (Math.abs(diff - bestDiff) <= 1e-9 && rows[i][field] > best[field])) {
        best = rows[i]; bestDiff = diff;
      }
    }
    var clamped = value < rows[0][field] || value > rows[rows.length - 1][field];
    return { row: best, clamped: clamped };
  }
  function normSystem(v) { return SYSTEMS.indexOf(v) === -1 ? null : v; }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      TABLE: TABLE, DEFAULT_US: DEFAULT_US, SYSTEMS: SYSTEMS,
      SELECT_SYSTEMS: SELECT_SYSTEMS, NUMERIC_SYSTEMS: NUMERIC_SYSTEMS,
      defaultIndex: defaultIndex, parseNum: parseNum,
      findNearestRow: findNearestRow, normSystem: normSystem
    };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  // v2: 표 앞쪽에 US 2~2.5 를 추가해 rowIndex 의미가 바뀌었다 — 옛 키는 버리고 기본값으로 시작
  var SKEY = (CFG.slug || "ring-size-conv") + ":state2";
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
  var systemEl = $("system-select"), sizeSelectEl = $("size-select");
  var euInputEl = $("eu-input"), mmInputEl = $("mm-input");
  var euHintEl = $("eu-hint"), mmHintEl = $("mm-hint");
  var errEuEl = $("err-eu"), errMmEl = $("err-mm");
  var emptyEl = $("result-empty"), gridEl = $("result-grid");
  var rUs = $("r-us"), rUk = $("r-uk"), rEu = $("r-eu"), rJp = $("r-jp"), rMm = $("r-mm");
  var noteClampedEl = $("note-clamped");
  if (!systemEl || !sizeSelectEl || !euInputEl || !mmInputEl || !gridEl) return;

  /* ---- 상태 (localStorage 복원 → 유효성 검증 → 기본값) ---- */
  function loadState() {
    var s = null;
    try {
      var raw = localStorage.getItem(SKEY);
      if (raw) s = JSON.parse(raw);
    } catch (e) { s = null; } // private mode / 손상된 값 — 기본값으로 진행
    var system = (s && normSystem(s.system)) || "us";
    var rowIndex = defaultIndex();
    if (s && typeof s.rowIndex === "number" && s.rowIndex >= 0 && s.rowIndex < TABLE.length) {
      rowIndex = s.rowIndex;
    }
    var eu = (s && typeof s.eu === "string") ? s.eu : String(TABLE[rowIndex].eu);
    var mm = (s && typeof s.mm === "string") ? s.mm : String(TABLE[rowIndex].mm);
    return { system: system, rowIndex: rowIndex, eu: eu, mm: mm };
  }
  var state = loadState();
  function saveState() {
    try { localStorage.setItem(SKEY, JSON.stringify(state)); } catch (e) { /* noop */ }
  }

  /* ---- 사이즈 선택 select 채우기 (표 순서 = 옵션 인덱스, 언어별 숫자 표기 반영) ---- */
  function populateSizeSelect() {
    var sys = state.system;
    sizeSelectEl.textContent = "";
    for (var i = 0; i < TABLE.length; i++) {
      var opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = sys === "uk" ? TABLE[i].uk : fmtSize(TABLE[i][sys]);
      sizeSelectEl.appendChild(opt);
    }
    if (state.rowIndex < 0 || state.rowIndex >= TABLE.length) state.rowIndex = defaultIndex();
    sizeSelectEl.value = String(state.rowIndex);
  }

  /* ---- system 변경에 따른 필드 표시 전환 ---- */
  function syncFieldVisibility() {
    var sys = state.system;
    var isSelect = SELECT_SYSTEMS.indexOf(sys) !== -1;
    sizeSelectEl.hidden = !isSelect;
    euInputEl.hidden = sys !== "eu";
    mmInputEl.hidden = sys !== "mm";
    euHintEl.hidden = sys !== "eu";
    mmHintEl.hidden = sys !== "mm";
    errEuEl.hidden = true;
    errMmEl.hidden = true;
    if (isSelect) {
      populateSizeSelect();
    } else if (sys === "eu") {
      euInputEl.value = state.eu;
    } else if (sys === "mm") {
      mmInputEl.value = state.mm;
    }
  }

  /* ---- 렌더 ---- */
  function render() {
    var sys = state.system;
    var row, clamped = false, field = null;

    if (SELECT_SYSTEMS.indexOf(sys) !== -1) {
      row = TABLE[state.rowIndex] || TABLE[defaultIndex()];
    } else {
      field = sys; // "eu" | "mm"
      var inputEl = sys === "eu" ? euInputEl : mmInputEl;
      var errEl = sys === "eu" ? errEuEl : errMmEl;
      var raw = inputEl.value;
      if (raw.trim() === "") {
        emptyEl.hidden = false; gridEl.hidden = true;
        errEuEl.hidden = true; errMmEl.hidden = true;
        return;
      }
      var v = parseNum(raw);
      if (!(isFinite(v) && v > 0)) {
        emptyEl.hidden = true; gridEl.hidden = true;
        errEl.hidden = false;
        return;
      }
      var res = findNearestRow(TABLE, v, field);
      row = res.row; clamped = res.clamped;
    }

    errEuEl.hidden = true; errMmEl.hidden = true;
    emptyEl.hidden = true;
    gridEl.hidden = false;
    rUs.textContent = fmtSize(row.us);
    rUk.textContent = row.uk;
    rEu.textContent = fmtSize(row.eu) + " mm";
    rJp.textContent = fmtSize(row.jp);
    rMm.textContent = fmtSize(row.mm) + " mm";

    if (clamped) {
      var shown = field === "eu" ? fmtSize(row.eu) + " mm" : fmtSize(row.mm) + " mm";
      noteClampedEl.textContent = tr("tool.note.clamped", "That's outside the standard chart — showing the closest size instead ({size}).")
        .replace("{size}", shown);
      noteClampedEl.hidden = false;
    } else {
      noteClampedEl.hidden = true;
    }
  }

  /* ---- 이벤트 ---- */
  systemEl.addEventListener("change", function () {
    var s = normSystem(systemEl.value);
    if (!s) { systemEl.value = state.system; return; }
    if (s === state.system) return;

    // 시스템을 바꿔도 "같은 반지 크기"를 유지하도록 현재 행을 먼저 확정한다.
    var curRow;
    if (SELECT_SYSTEMS.indexOf(state.system) !== -1) {
      curRow = TABLE[state.rowIndex] || TABLE[defaultIndex()];
    } else {
      var inputEl = state.system === "eu" ? euInputEl : mmInputEl;
      var v = parseNum(inputEl.value);
      if (isFinite(v) && v > 0) {
        curRow = findNearestRow(TABLE, v, state.system).row;
      } else {
        curRow = TABLE[state.rowIndex] || TABLE[defaultIndex()];
      }
    }
    state.rowIndex = TABLE.indexOf(curRow);
    if (s === "eu") state.eu = String(curRow.eu);
    if (s === "mm") state.mm = String(curRow.mm);

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

  euInputEl.addEventListener("input", function () {
    state.eu = euInputEl.value;
    saveState();
    render();
  });
  euInputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); this.blur(); render(); }
  });
  mmInputEl.addEventListener("input", function () {
    state.mm = mmInputEl.value;
    saveState();
    render();
  });
  mmInputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); this.blur(); render(); }
  });

  // 언어 전환 시 옵션 문구(UK 알파벳 표기 제외 숫자 표기)·안내 문구 재적용
  document.addEventListener("i18n:change", function () {
    if (SELECT_SYSTEMS.indexOf(state.system) !== -1) populateSizeSelect();
    render();
  });

  syncFieldVisibility();
  render();
  // TOOLJS:END
})();
