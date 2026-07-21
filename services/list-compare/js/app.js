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

  // Cloudflare Web Analytics — 쿠키리스·페이지뷰만. 토큰 설정 시에만 로드.
  // 실패해도 본 기능에 영향 없게 격리 (safeTrack 원칙 — 부가 기능은 본 기능과 격리, 철칙 5)
  // 수집 범위는 privacy.html §3 과 일치해야 한다. 도구 입력값은 절대 실리지 않는다(§1 약속).
  if (cfg.analytics && cfg.analytics.cfBeaconToken) {
    try {
      var s = document.createElement("script");
      s.defer = true;
      s.src = "https://static.cloudflareinsights.com/beacon.min.js";
      s.setAttribute("data-cf-beacon", JSON.stringify({ token: cfg.analytics.cfBeaconToken }));
      document.head.appendChild(s);
    } catch (e) { /* 분석 실패는 조용히 무시 — 본 기능에 영향 없음 */ }
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
  /* list-compare — 두 명단/ID 목록을 대사(reconcile)해 A만·B만·교집합·합집합 산출
     spec: factory/state/list-compare.yaml

     설계 원칙
     - pure-static: 서버·DB·외부 API 0. 목록 원본은 세션 메모리에만 있고 저장하지 않는다.
       (privacy.html 의 "브라우저를 떠나지 않음" 약속 = 보안팀 무승인 사용의 채택 조건)
     - 정규화는 비교 키에만 적용하고 원본 문자열은 표시·출력용으로 보존한다(철칙: 조용한 변형 금지).
     - 국가 분기(NFC/NFKC/악센트/TR 케이스폴딩)는 전부 Unicode 정적 규칙 — 조회·갱신 불필요.
     - 조용한 실패 금지: 둘 다 빈·한쪽 빈·완전일치·빈 키·중복 축약·인코딩 깨짐·규모 초과 전부 명시 표기.

     저장 (localStorage, prefix "list-compare:")
       :opts  정규화 옵션·프리셋      :mapA/:mapB  컬럼 매핑(헤더 시그니처 일치 시에만 복원)
       목록 데이터(붙여넣은 원본·파일 내용)는 저장하지 않는다.  URL ?preset= 로 프리셋 지정 가능.

     CSV 파서·정규화·Set 연산은 이 파일 안에서 자립 구현했다(백로그 재사용 전제였던
     csv-dedupe 미착수). csv-dedupe·csv-diff·csv-column-split 이 js/csv-table.js 로 재사용하려면
     아래 "PURE" 블록만 그대로 들어내면 된다 — 별도 파일 분리는 셸의 script 태그 추가라
     템플릿 계약 밖이므로 빌더가 임의로 하지 않는다. */

  /* ============================================================
     PURE — DOM 무관. 이 블록만 떼어내면 js/csv-table.js 가 된다.
     ============================================================ */

  var MAX_ROWS = 500000;     // side 당 상한 — 초과분은 조용히 자르지 않고 배지로 알린다
  var BIG_ROWS = 50000;      // 두 목록 합산 이 이상이면 청크 처리 + 진행률·취소
  var BIG_FILE = 5 * 1024 * 1024;
  var TABLE_CAP = 200;       // 패널별 화면 표 최대 행 (전량은 CSV 다운로드로)
  var CHUNK = 5000;

  /* 로케일 프리셋 — 각 프리셋이 정규화 옵션 기본값 세트를 정한다.
     removeSpace 는 '홍 길동' vs '홍길동' 오판을 없애려 CJK 프리셋(KR/JP)에서 기본 ON
     (spec 결정 2026-07-18). 라틴권(EN/EU/TR)은 'Anna Lee' vs 'Ann Alee' 오탐 위험이 커 OFF. */
  var PRESETS = {
    EN: { trim: 1, removeSpace: 0, caseless: 1, nfc: 1, nfkc: 0, accent: 0, turkish: 0, zeros: 0 },
    KR: { trim: 1, removeSpace: 1, caseless: 1, nfc: 1, nfkc: 0, accent: 0, turkish: 0, zeros: 0 },
    JP: { trim: 1, removeSpace: 1, caseless: 1, nfc: 1, nfkc: 1, accent: 0, turkish: 0, zeros: 0 },
    EU: { trim: 1, removeSpace: 0, caseless: 1, nfc: 1, nfkc: 0, accent: 1, turkish: 0, zeros: 0 },
    TR: { trim: 1, removeSpace: 0, caseless: 1, nfc: 1, nfkc: 0, accent: 0, turkish: 1, zeros: 0 }
  };
  var OPT_KEYS = ["trim", "removeSpace", "caseless", "nfc", "nfkc", "accent", "turkish", "zeros"];
  // 지원 14개 언어(+주요 무역 언어)에서 어떤 프리셋이 자연스러운가
  var LANG_PRESET = { ko: "KR", ja: "JP", zh: "JP", de: "EU", fr: "EU", es: "EU", pt: "EU", tr: "TR" };

  /** 비교 키 정규화. 원본은 절대 바꾸지 않고 이 함수의 반환값만 매칭에 쓴다.
      순서가 중요: 폭/합성 정규화 → 악센트 → 공백 → 케이스폴딩 → 앞자리 0. */
  function normalizeKey(s, o) {
    var k = s == null ? "" : String(s);
    // 1. 폭/합성: NFKC(전각↔반각·호환문자)가 NFC 를 포함하므로 둘 다면 NFKC 우선
    try {
      if (o.nfkc) k = k.normalize("NFKC");
      else if (o.nfc) k = k.normalize("NFC");
    } catch (e) { /* 구형 브라우저 normalize 미지원 — 원형 유지 */ }
    // 2. 악센트: NFD 분해 → 결합 발음기호 제거 → 재합성
    if (o.accent) {
      try { k = k.normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC"); }
      catch (e) { /* noop */ }
    }
    // 3. 공백: trim+연속축약, 그 다음 '모든 공백 제거'(CJK). \s 는 U+3000(전각 스페이스)·NBSP 포함
    if (o.trim) k = k.replace(/^\s+|\s+$/g, "").replace(/\s+/g, " ");
    if (o.removeSpace) k = k.replace(/\s+/g, "");
    // 4. 케이스폴딩: TR 안전 — 터키어 로케일이면 I→ı, İ→i (naive toLowerCase 금지)
    if (o.caseless) {
      try { k = o.turkish ? k.toLocaleLowerCase("tr") : k.toLowerCase(); }
      catch (e) { k = k.toLowerCase(); }
    }
    // 5. 앞자리 0: 키가 순수 숫자일 때만 (기본 OFF — '00123' vs '123' 조용한 매칭 방지, spec 결정)
    if (o.zeros && /^[0-9]+$/.test(k)) k = k.replace(/^0+(?=\d)/, "");
    return k;
  }

  function newIndex() { return { map: new Map(), order: [], dupes: 0, blanks: 0, emptyKeys: 0 }; }

  /** cells[i] = 각 행의 비교 키 셀, rows[i] = 그 행 전체(빈 행 vs 빈 키 구분용).
      더러운 행은 버리지 않고 사유별로 카운트한다(철칙 5). 목록 내 중복은 최초 원본 1건만 유지. */
  function indexRange(st, cells, rows, o, start, end) {
    for (var i = start; i < end; i++) {
      var raw = cells[i] == null ? "" : String(cells[i]);
      if (raw.trim() === "") {
        var full = rows ? (rows[i] == null ? "" : String(rows[i])) : raw;
        if (full.replace(/[\t,;|]/g, "").trim() === "") st.blanks++; else st.emptyKeys++;
        continue;
      }
      var key = normalizeKey(raw, o);
      if (key === "") { st.emptyKeys++; continue; } // 정규화 후 빈 키(구두점만 등)도 제외 표기
      var e = st.map.get(key);
      if (e) { e.count++; st.dupes++; }
      else { st.map.set(key, { orig: raw, count: 1 }); st.order.push(key); }
    }
    return st;
  }
  function buildIndex(cells, rows, o) { return indexRange(newIndex(), cells, rows, o, 0, cells.length); }

  /** 두 인덱스의 Set 연산 — A만/B만/교집합/합집합. 총 O(n+m) 1패스, 삽입 순서 보존. */
  function compareIndex(A, B) {
    var onlyA = [], onlyB = [], both = [], union = [], i, k, e;
    for (i = 0; i < A.order.length; i++) {
      k = A.order[i]; e = A.map.get(k);
      if (B.map.has(k)) {
        both.push({ key: k, a: e.orig, b: B.map.get(k).orig });
        union.push({ orig: e.orig, set: "both" });
      } else {
        onlyA.push({ orig: e.orig });
        union.push({ orig: e.orig, set: "a" });
      }
    }
    for (i = 0; i < B.order.length; i++) {
      k = B.order[i];
      if (!A.map.has(k)) {
        e = B.map.get(k);
        onlyB.push({ orig: e.orig });
        union.push({ orig: e.orig, set: "b" });
      }
    }
    return { onlyA: onlyA, onlyB: onlyB, both: both, union: union };
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

  /** 구분자 자동 감지: 후보별로 실제 파싱해 (일관된 열 수 × 그 빈도) 가 최대인 것.
      1열짜리(줄 목록)면 어느 후보도 2열 이상을 못 만들므로 기본 개행분리로 떨어진다. */
  function detectDelim(text) {
    var cands = ["\t", ",", ";", "|"], best = null, bestScore = 0;
    var sample = text.slice(0, 65536);
    for (var c = 0; c < cands.length; c++) {
      var rows = parseDelimited(sample, cands[c]).slice(0, 30).filter(function (r) {
        return r.length > 1 || (r.length === 1 && r[0] !== "");
      });
      if (!rows.length) continue;
      var counts = {}, i, top = 0, mode = 0;
      for (i = 0; i < rows.length; i++) {
        var L = rows[i].length;
        counts[L] = (counts[L] || 0) + 1;
        if (counts[L] > top) { top = counts[L]; mode = L; }
      }
      if (mode < 2) continue;
      var score = mode * (top / rows.length);
      if (score > bestScore) { bestScore = score; best = cands[c]; }
    }
    return best; // null = 구분자 없음(단일 열/줄 목록)
  }

  /** 텍스트 → 2차원 배열. 구분자가 없으면 줄 단위 단일 열. */
  function parseText(text) {
    var delim = detectDelim(text);
    if (!delim) {
      var t = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
      var lines = t.split(/\r\n|\r|\n/);
      return { table: lines.map(function (l) { return [l]; }), delim: null, width: 1 };
    }
    var table = parseDelimited(text, delim);
    var width = 0;
    for (var i = 0; i < Math.min(table.length, 50); i++) width = Math.max(width, table[i].length);
    return { table: table, delim: delim, width: width };
  }

  var HEADER_RE = /(name|email|e-?mail|\bid\b|user|member|code|번호|이름|성명|명단|아이디|회원|사번|코드|고객|메일|氏名|名前|会員|メール|番号|电子邮件|会员|编号|correo|nombre|nome|courriel|nom|e-mail)/i;
  /** 다중열일 때 첫 행이 헤더로 보이는가 — 헤더 키워드가 있거나, 1행엔 숫자가 거의 없고 2행부터 숫자가 많으면. */
  function looksLikeHeader(table, width) {
    if (!table.length || width < 2) return false;
    var r0 = table[0], i;
    for (i = 0; i < r0.length; i++) if (HEADER_RE.test(String(r0[i]))) return true;
    return false;
  }
  /** 헤더에서 비교 키 열 자동 추정 — 헤더 키워드에 걸리는 첫 열, 없으면 0. */
  function autoKeyCol(table, hasHeader) {
    if (!hasHeader || !table.length) return 0;
    var head = table[0];
    for (var i = 0; i < head.length; i++) if (HEADER_RE.test(String(head[i]))) return i;
    return 0;
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
      normalizeKey: normalizeKey, buildIndex: buildIndex, compareIndex: compareIndex,
      parseDelimited: parseDelimited, detectDelim: detectDelim, parseText: parseText,
      looksLikeHeader: looksLikeHeader, autoKeyCol: autoKeyCol, toCSV: toCSV, PRESETS: PRESETS
    };
  }

  /* ============================================================
     UI — 여기서부터 DOM. 도구 마크업이 없으면(테스트 등) 아무것도 하지 않는다.
     ============================================================ */
  var $ = function (id) { return document.getElementById(id); };
  if (typeof document === "undefined" || !$("lc-paste-a")) return;

  var SLUG = (window.APP_CONFIG && window.APP_CONFIG.slug) || "list-compare";
  var K_OPTS = SLUG + ":opts", K_MAP = { a: SLUG + ":mapA", b: SLUG + ":mapB" };

  function t(key, vars) {
    var s = null;
    try { if (window.I18N) s = window.I18N.t(key); } catch (e) { /* noop */ }
    if (s == null) s = "";
    if (vars) for (var k in vars) if (vars.hasOwnProperty(k)) s = s.split("{" + k + "}").join(vars[k]);
    return s;
  }
  function lang() { try { return (window.I18N && window.I18N.lang()) || "en"; } catch (e) { return "en"; } }
  function load(key, fb) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode */ } }
  function fmtNum(v) { try { return new Intl.NumberFormat(lang()).format(v); } catch (e) { return String(v); } }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---- 상태 (목록 원본은 세션 메모리에만 — 저장하지 않는다) ---- */
  var sides = {
    a: { table: [], width: 1, hasHeader: false, keyCol: 0, bytes: null, enc: "utf-8", el: {} },
    b: { table: [], width: 1, hasHeader: false, keyCol: 0, bytes: null, enc: "utf-8", el: {} }
  };
  var opts = null, preset = "EN", lastResult = null, job = null, tab = "onlyA";

  function detectPreset() {
    try {
      var q = new URLSearchParams(location.search).get("preset");
      if (q && PRESETS[q.toUpperCase()]) return q.toUpperCase();
    } catch (e) { /* noop */ }
    var saved = load(K_OPTS, null);
    if (saved && saved.preset && PRESETS[saved.preset]) return saved.preset;
    var navs = navigator.languages || [navigator.language || ""];
    for (var i = 0; i < navs.length; i++) {
      var p = String(navs[i]).split("-")[0].toLowerCase();
      if (LANG_PRESET[p]) return LANG_PRESET[p];
    }
    return "EN";
  }

  /* ---- 옵션 UI 연동 ---- */
  var OPT_EL = {
    trim: "lc-o-trim", removeSpace: "lc-o-space", caseless: "lc-o-case", nfc: "lc-o-nfc",
    nfkc: "lc-o-nfkc", accent: "lc-o-accent", turkish: "lc-o-tr", zeros: "lc-o-zeros"
  };
  function readOpts() {
    var o = {};
    OPT_KEYS.forEach(function (k) { o[k] = $(OPT_EL[k]).checked ? 1 : 0; });
    return o;
  }
  function writeOpts(o) { OPT_KEYS.forEach(function (k) { $(OPT_EL[k]).checked = !!o[k]; }); }
  function applyPreset(name) {
    preset = PRESETS[name] ? name : "EN";
    opts = {}; OPT_KEYS.forEach(function (k) { opts[k] = PRESETS[preset][k]; });
    writeOpts(opts);
    $("lc-preset").value = preset;
    save(K_OPTS, { preset: preset, opts: opts });
  }

  /* ---- 컬럼 매핑 UI ---- */
  function headerSig(side) { var s = sides[side]; return s.table.length ? s.table[0].join("") : ""; }
  function renderMap(side) {
    var s = sides[side], wrap = $("lc-map-" + side);
    if (s.width < 2) { wrap.hidden = true; return; }
    wrap.hidden = false;
    $("lc-header-" + side).checked = s.hasHeader;
    var sel = $("lc-col-" + side);
    sel.innerHTML = "";
    for (var i = 0; i < s.width; i++) {
      var head = s.hasHeader ? String(s.table[0][i] == null ? "" : s.table[0][i]).trim() : "";
      var label = head || t("tool.map.col", { n: i + 1 });
      var op = document.createElement("option");
      op.value = String(i); op.textContent = label;
      sel.appendChild(op);
    }
    if (s.keyCol >= s.width) s.keyCol = 0;
    sel.value = String(s.keyCol);
  }
  function saveMap(side) {
    var s = sides[side];
    save(K_MAP[side], { sig: headerSig(side), hasHeader: s.hasHeader, keyCol: s.keyCol });
  }

  /* ---- 한 side 의 (키 셀 배열, 행 배열) 추출 ---- */
  function extract(side) {
    var s = sides[side], cells = [], rows = [];
    var start = (s.width >= 2 && s.hasHeader) ? 1 : 0;
    var end = Math.min(s.table.length, start + MAX_ROWS);
    var col = s.width >= 2 ? s.keyCol : 0;
    for (var i = start; i < end; i++) {
      var r = s.table[i] || [];
      cells.push(r[col] == null ? "" : r[col]);
      rows.push(r.join(s.width >= 2 ? " " : ""));
    }
    var over = (s.table.length - start) - (end - start);
    return { cells: cells, rows: rows, over: over > 0 ? over : 0 };
  }
  function sideRowCount(side) {
    var s = sides[side];
    if (!s.table.length) return 0;
    var start = (s.width >= 2 && s.hasHeader) ? 1 : 0;
    return Math.max(0, s.table.length - start);
  }

  /* ---- 결과 계산 ---- */
  var elMsg = $("lc-msg"), elOut = $("lc-out");
  function setMsg(html, isErr) {
    elMsg.innerHTML = html;
    elMsg.className = "lc-msg" + (isErr ? " is-err" : "");
    elMsg.hidden = false;
    elOut.hidden = true;
    lastResult = null;
    renderSideStats(null);
  }

  function run() {
    if (job) { job.cancelled = true; job = null; }
    $("lc-progress").hidden = true;
    var ea = extract("a"), eb = extract("b");
    var emptyA = ea.cells.length === 0, emptyB = eb.cells.length === 0;
    if (emptyA && emptyB) { setMsg(esc(t("tool.n.empty"))); return; }

    var total = ea.cells.length + eb.cells.length;
    if (total > BIG_ROWS) {
      var j = { cancelled: false };
      job = j;
      $("lc-progress").hidden = false;
      $("lc-bar").value = 0;
      $("lc-progress-text").textContent = t("tool.progress", { n: fmtNum(total) });
      computeAsync(j, ea, eb, function (res) {
        if (j.cancelled) return;
        job = null; $("lc-progress").hidden = true;
        finish(res, ea, eb);
      });
      return;
    }
    var A = buildIndex(ea.cells, ea.rows, opts);
    var B = buildIndex(eb.cells, eb.rows, opts);
    finish({ A: A, B: B }, ea, eb);
  }

  function computeAsync(j, ea, eb, done) {
    var A = newIndex(), B = newIndex(), phase = 0, i = 0;
    var seqs = [{ st: A, e: ea }, { st: B, e: eb }];
    function step() {
      if (j.cancelled) return;
      var cur = seqs[phase];
      var end = Math.min(i + CHUNK, cur.e.cells.length);
      indexRange(cur.st, cur.e.cells, cur.e.rows, opts, i, end);
      i = end;
      var doneCount = (phase === 0 ? 0 : ea.cells.length) + i;
      $("lc-bar").value = Math.round((doneCount / Math.max(1, ea.cells.length + eb.cells.length)) * 100);
      if (i >= cur.e.cells.length) { phase++; i = 0; }
      if (phase < seqs.length) setTimeout(step, 0);
      else done({ A: A, B: B });
    }
    setTimeout(step, 0);
  }

  function finish(res, ea, eb) {
    var A = res.A, B = res.B;
    var cmp = compareIndex(A, B);
    var out = {
      cmp: cmp, A: A, B: B,
      countA: A.map.size, countB: B.map.size,
      over: { a: ea.over, b: eb.over }
    };
    lastResult = out;
    render(out);
  }

  /* ---- 렌더 ---- */
  function renderSideStats(out) {
    ["a", "b"].forEach(function (side) {
      var el = $("lc-stat-" + side);
      if (!out || !sides[side].table.length) { el.textContent = ""; return; }
      var idx = side === "a" ? out.A : out.B;
      var parts = [t("tool.stat.unique", { n: fmtNum(idx.map.size) })];
      if (idx.dupes) parts.push(t("tool.stat.dupes", { n: fmtNum(idx.dupes) }));
      if (idx.blanks) parts.push(t("tool.stat.blank", { n: fmtNum(idx.blanks) }));
      if (idx.emptyKeys) parts.push(t("tool.stat.emptykey", { n: fmtNum(idx.emptyKeys) }));
      el.textContent = parts.join(" · ");
    });
  }

  function render(out) {
    elMsg.hidden = true;
    elOut.hidden = false;
    renderSideStats(out);

    // 경고/안내 블록 — 조용한 실패 금지
    var warn = $("lc-warn");
    warn.innerHTML = "";
    var lines = [];
    var emptyA = out.countA === 0, emptyB = out.countB === 0;
    if (emptyA && !emptyB) lines.push(t("tool.n.oneA"));
    else if (emptyB && !emptyA) lines.push(t("tool.n.oneB"));
    else if (out.cmp.onlyA.length === 0 && out.cmp.onlyB.length === 0 && out.cmp.both.length > 0) {
      lines.push(t("tool.n.identical"));
    }
    if (out.over.a) lines.push(t("tool.warn.cap", { list: "A", n: fmtNum(MAX_ROWS) }));
    if (out.over.b) lines.push(t("tool.warn.cap", { list: "B", n: fmtNum(MAX_ROWS) }));
    if (out.A.emptyKeys) lines.push(t("tool.warn.emptyKeys", { list: "A", n: fmtNum(out.A.emptyKeys) }));
    if (out.B.emptyKeys) lines.push(t("tool.warn.emptyKeys", { list: "B", n: fmtNum(out.B.emptyKeys) }));
    if (lines.length) {
      var d = document.createElement("div");
      d.className = "lc-warn";
      d.innerHTML = lines.map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("");
      warn.appendChild(d);
    }

    // 탭 배지 건수
    $("lc-cnt-onlyA").textContent = fmtNum(out.cmp.onlyA.length);
    $("lc-cnt-onlyB").textContent = fmtNum(out.cmp.onlyB.length);
    $("lc-cnt-both").textContent = fmtNum(out.cmp.both.length);
    $("lc-cnt-union").textContent = fmtNum(out.cmp.union.length);

    renderPanel();
  }

  function activeRows() {
    if (!lastResult) return [];
    return lastResult.cmp[tab] || [];
  }

  function renderPanel() {
    if (!lastResult) return;
    var rows = activeRows();
    $("lc-panel-count").textContent = t("tool.panelCount", { n: fmtNum(rows.length) });
    var head, bodyFn;
    if (tab === "both") {
      head = "<th class=\"lc-num\">#</th><th>" + esc(t("tool.listA")) + "</th><th>" + esc(t("tool.listB")) + "</th>";
      bodyFn = function (r) { return "<td>" + esc(r.a) + "</td><td>" + esc(r.b) + "</td>"; };
    } else if (tab === "union") {
      head = "<th class=\"lc-num\">#</th><th>" + esc(t("tool.th.item")) + "</th><th>" + esc(t("tool.th.membership")) + "</th>";
      bodyFn = function (r) {
        var cls = r.set === "a" ? "a" : (r.set === "b" ? "b" : "both");
        var lab = r.set === "a" ? t("tool.member.a") : (r.set === "b" ? t("tool.member.b") : t("tool.member.both"));
        return "<td>" + esc(r.orig) + "</td><td><span class=\"lc-mem " + cls + "\">" + esc(lab) + "</span></td>";
      };
    } else {
      head = "<th class=\"lc-num\">#</th><th>" + esc(t("tool.th.item")) + "</th>";
      bodyFn = function (r) { return "<td>" + esc(r.orig) + "</td>"; };
    }
    var html = "<thead><tr>" + head + "</tr></thead><tbody>";
    if (!rows.length) {
      var span = tab === "both" || tab === "union" ? 3 : 2;
      html += "<tr><td colspan=\"" + span + "\" style=\"color:var(--muted)\">" + esc(t("tool.emptyPanel")) + "</td></tr>";
    } else {
      var shown = Math.min(rows.length, TABLE_CAP);
      for (var i = 0; i < shown; i++) {
        html += "<tr><td class=\"lc-num\">" + (i + 1) + "</td>" + bodyFn(rows[i]) + "</tr>";
      }
    }
    html += "</tbody>";
    $("lc-tbl").innerHTML = html;
    var trunc = $("lc-trunc");
    if (rows.length > TABLE_CAP) {
      trunc.hidden = false;
      trunc.textContent = t("tool.trunc", { shown: fmtNum(TABLE_CAP), total: fmtNum(rows.length) });
    } else { trunc.hidden = true; }
  }

  function showTab(k) {
    tab = k;
    ["onlyA", "onlyB", "both", "union"].forEach(function (x) {
      $("lc-tab-" + x).setAttribute("aria-selected", x === k ? "true" : "false");
    });
    renderPanel();
  }

  /* ---- 출력: CSV / 클립보드 ---- */
  function panelRows(which) {
    var cmp = lastResult.cmp, out = [];
    if (which === "both") {
      out.push([t("tool.listA"), t("tool.listB")]);
      cmp.both.forEach(function (r) { out.push([r.a, r.b]); });
    } else if (which === "union") {
      out.push([t("tool.th.item"), t("tool.th.membership")]);
      cmp.union.forEach(function (r) {
        var lab = r.set === "a" ? t("tool.member.a") : (r.set === "b" ? t("tool.member.b") : t("tool.member.both"));
        out.push([r.orig, lab]);
      });
    } else {
      out.push([which === "onlyA" ? t("tool.tab.onlyA") : t("tool.tab.onlyB")]);
      cmp[which].forEach(function (r) { out.push([r.orig]); });
    }
    return out;
  }

  function flash(msg) {
    var s = $("lc-status");
    s.hidden = false; s.textContent = msg;
    setTimeout(function () { s.hidden = true; }, 1800);
  }
  function downloadCSV(rows, suffix) {
    var blob = new Blob(["\ufeff" + toCSV(rows)], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = SLUG + "-" + suffix + "-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    flash(t("tool.downloaded"));
  }

  $("lc-csv").addEventListener("click", function () {
    if (!lastResult) return;
    downloadCSV(panelRows(tab), tab);
  });
  $("lc-csv-all").addEventListener("click", function () {
    if (!lastResult) return;
    downloadCSV(panelRows("union"), "combined");
  });
  $("lc-copy").addEventListener("click", function () {
    if (!lastResult) return;
    var text = panelRows(tab).map(function (r) {
      return r.map(function (v) { return String(v == null ? "" : v).replace(/[\t\r\n]/g, " "); }).join("\t");
    }).join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash(t("tool.copied")); },
        function () { flash(t("tool.copyFail")); });
    } else { flash(t("tool.copyFail")); }
  });

  /* ---- 입력 처리 ---- */
  function setSideText(side, text, fromBytes) {
    var s = sides[side];
    var parsed = parseText(text);
    // 완전 빈 입력 정리 — 마지막 빈 줄 등
    var table = parsed.table.filter(function (r, i) {
      return !(r.length === 1 && r[0].trim() === "" && i === parsed.table.length - 1);
    });
    s.table = table;
    s.width = parsed.width;
    if (!table.length) { renderMap(side); run(); return; }
    if (s.width >= 2) {
      var savedMap = load(K_MAP[side], null);
      if (savedMap && savedMap.sig === headerSig(side)) {
        s.hasHeader = !!savedMap.hasHeader;
        s.keyCol = savedMap.keyCol < s.width ? savedMap.keyCol : 0;
      } else {
        s.hasHeader = looksLikeHeader(table, s.width);
        s.keyCol = autoKeyCol(table, s.hasHeader);
      }
    } else { s.hasHeader = false; s.keyCol = 0; }
    if (!fromBytes) { s.bytes = null; $("lc-enc-" + side).hidden = true; }
    renderMap(side);
    run();
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

  function applyBytes(side, buf, enc) {
    var s = sides[side];
    s.bytes = buf;
    var r = enc ? { text: decode(new Uint8Array(buf), enc), enc: enc, sure: true } : decodeSmart(buf);
    if (r.text == null) { setMsg(esc(t("tool.n.decode")), true); return; }
    s.enc = r.enc;
    var el = s.el.paste;
    el.value = r.text.length > 500000 ? r.text.slice(0, 500000) : r.text;
    var banner = $("lc-enc-" + side);
    var garbled = r.text.indexOf("�") >= 0;
    if (garbled || !r.sure || r.enc === "euc-kr") {
      banner.hidden = false;
      $("lc-enc-" + side + "-text").textContent = r.enc === "euc-kr" ? t("tool.enc.cp949") : t("tool.enc.broken");
      $("lc-enc-" + side + "-btn").textContent = r.enc === "euc-kr" ? t("tool.enc.back") : t("tool.enc.retry");
    } else { banner.hidden = true; }
    setSideText(side, el.value, true);
  }

  function readFile(side, file) {
    if (!file) return;
    if (file.size > BIG_FILE) flash(t("tool.warn.bigFile", { n: fmtNum(Math.round(file.size / 1048576)) }));
    var fr = new FileReader();
    fr.onload = function () { applyBytes(side, fr.result, null); };
    fr.onerror = function () { setMsg(esc(t("tool.n.read")), true); };
    fr.readAsArrayBuffer(file);
  }

  /* ---- side 별 이벤트 바인딩 ---- */
  ["a", "b"].forEach(function (side) {
    var s = sides[side];
    s.el.paste = $("lc-paste-" + side);
    var timer = null;
    s.el.paste.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        s.bytes = null; $("lc-enc-" + side).hidden = true;
        setSideText(side, s.el.paste.value, false);
      }, 200);
    });
    var dz = $("lc-drop-" + side);
    ["dragenter", "dragover"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("is-over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("is-over"); });
    });
    dz.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) readFile(side, e.dataTransfer.files[0]);
    });
    $("lc-pick-" + side).addEventListener("click", function () { $("lc-file-" + side).click(); });
    $("lc-file-" + side).addEventListener("change", function (e) {
      if (e.target.files && e.target.files.length) readFile(side, e.target.files[0]);
      e.target.value = "";
    });
    $("lc-enc-" + side + "-btn").addEventListener("click", function () {
      if (!s.bytes) return;
      applyBytes(side, s.bytes, s.enc === "euc-kr" ? "utf-8" : "euc-kr");
    });
    $("lc-header-" + side).addEventListener("change", function () {
      s.hasHeader = $("lc-header-" + side).checked;
      s.keyCol = autoKeyCol(s.table, s.hasHeader);
      renderMap(side); saveMap(side); run();
    });
    $("lc-col-" + side).addEventListener("change", function () {
      s.keyCol = parseInt($("lc-col-" + side).value, 10) || 0;
      saveMap(side); run();
    });
  });

  /* ---- 옵션·프리셋·버튼 이벤트 ---- */
  $("lc-preset").addEventListener("change", function () { applyPreset($("lc-preset").value); run(); });
  OPT_KEYS.forEach(function (k) {
    $(OPT_EL[k]).addEventListener("change", function () {
      opts = readOpts();
      // 수동 조작 시 프리셋과 어긋나면 저장만 갱신(프리셋 라벨은 그대로 둔다 — 사용자 커스텀)
      save(K_OPTS, { preset: preset, opts: opts });
      run();
    });
  });

  $("lc-sample").addEventListener("click", function () {
    sides.a.el.paste.value = t("tool.sample.a");
    sides.b.el.paste.value = t("tool.sample.b");
    sides.a.bytes = null; sides.b.bytes = null;
    $("lc-enc-a").hidden = true; $("lc-enc-b").hidden = true;
    setSideText("a", sides.a.el.paste.value, false);
    setSideText("b", sides.b.el.paste.value, false);
  });
  $("lc-swap").addEventListener("click", function () {
    var av = sides.a.el.paste.value, bv = sides.b.el.paste.value;
    sides.a.el.paste.value = bv; sides.b.el.paste.value = av;
    sides.a.bytes = null; sides.b.bytes = null;
    $("lc-enc-a").hidden = true; $("lc-enc-b").hidden = true;
    setSideText("a", bv, false);
    setSideText("b", av, false);
  });
  $("lc-clear").addEventListener("click", function () {
    ["a", "b"].forEach(function (side) {
      sides[side].el.paste.value = "";
      sides[side].table = []; sides[side].width = 1; sides[side].bytes = null;
      $("lc-enc-" + side).hidden = true; $("lc-map-" + side).hidden = true;
      $("lc-stat-" + side).textContent = "";
    });
    lastResult = null;
    setMsg(esc(t("tool.n.empty")));
  });
  $("lc-cancel").addEventListener("click", function () {
    if (job) { job.cancelled = true; job = null; }
    $("lc-progress").hidden = true;
    setMsg(esc(t("tool.canceled")), true);
  });
  ["onlyA", "onlyB", "both", "union"].forEach(function (k) {
    $("lc-tab-" + k).addEventListener("click", function () { showTab(k); });
  });

  /* ---- 초기화 ---- */
  applyPreset(detectPreset());
  showTab("onlyA");
  setMsg(esc(t("tool.n.empty")));

  // 언어 전환 — 표 헤더·안내·통계 문구가 따라간다
  document.addEventListener("i18n:change", function () {
    renderMap("a"); renderMap("b");
    if (lastResult) render(lastResult); else setMsg(esc(t("tool.n.empty")));
  });
  // TOOLJS:END
})();
