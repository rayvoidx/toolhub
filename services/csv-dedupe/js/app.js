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
  /* csv-dedupe — 한 표에서 중복 행을 선택 열(복합키) 기준으로 제거
     spec: factory/state/csv-dedupe.yaml

     설계 원칙
     - pure-static: 서버·DB·외부 API 0. 표 원본은 세션 메모리에만 있고 저장하지 않는다.
       (privacy.html 의 "브라우저를 떠나지 않음" = 명단·발송목록 처리에서 보안팀 무승인 사용의 채택 조건)
     - 정규화는 비교 키에만 적용하고 원본 행은 표시·출력용으로 보존한다(조용한 변형 금지).
     - 비파괴: 지우는 게 아니라 정제본 + '제거된 중복만' + 리포트 배지 세 갈래로 낸다(조용한 삭제 금지·철칙5).
     - 국가 분기(NFC/NFKC/악센트/TR 케이스폴딩)는 전부 Unicode 정적 규칙 — 조회·갱신 불필요.

     저장 (localStorage, prefix "csv-dedupe:")
       :opts  정규화 옵션·프리셋   :cfg  구분자·헤더·유지정책   :map  컬럼 매핑(헤더 시그니처 일치 시 복원)
       표 데이터(붙여넣은 원본·파일 내용)는 저장하지 않는다.  URL ?preset= 로 프리셋 지정 가능.

     PURE 코어(파서·정규화)는 list-compare 의 검증된 코어를 진본으로 복사하고(백로그 결정 2026-07-18),
     dedupe 로직(Map 1패스·복합키·유지정책)만 신규로 얹었다. 아래 "PURE" 블록은 DOM 무관이라
     대용량 처리 시 그대로 Web Worker Blob 으로 직렬화되어 백그라운드에서 재사용된다. */

  /* ============================================================
     PURE — DOM 무관. Worker 로 직렬화되며, 메인 스레드 소량 처리에도 같은 함수를 쓴다
     (결과 동일성 보장). 외부 클로저 참조가 없어야 Worker 직렬화가 안전하다.
     ============================================================ */

  var HARD_ROWS = 1000000;        // 이 이상은 "앞 N행만/계속" 확인 (조용한 절삭 금지)
  var WORKER_ROWS = 50000;        // 데이터 행 이 이하는 메인 스레드(수만 행 ms — 과잉설계 금지)
  var WORKER_BYTES = 5 * 1024 * 1024;
  var HARD_BYTES = 50 * 1024 * 1024;
  var BIG_FILE = 5 * 1024 * 1024;
  var TABLE_CAP = 200;            // 화면 미리보기 최대 행 (전량은 CSV 다운로드로)
  var PROGRESS_STEP = 20000;      // 진행률·양보 간격

  var PRESETS = {
    EN: { trim: 1, removeSpace: 0, caseless: 1, nfc: 1, nfkc: 0, accent: 0, turkish: 0, zeros: 0 },
    KR: { trim: 1, removeSpace: 1, caseless: 1, nfc: 1, nfkc: 0, accent: 0, turkish: 0, zeros: 0 },
    JP: { trim: 1, removeSpace: 1, caseless: 1, nfc: 1, nfkc: 1, accent: 0, turkish: 0, zeros: 0 },
    EU: { trim: 1, removeSpace: 0, caseless: 1, nfc: 1, nfkc: 0, accent: 1, turkish: 0, zeros: 0 },
    TR: { trim: 1, removeSpace: 0, caseless: 1, nfc: 1, nfkc: 0, accent: 0, turkish: 1, zeros: 0 }
  };
  var OPT_KEYS = ["trim", "removeSpace", "caseless", "nfc", "nfkc", "accent", "turkish", "zeros"];
  var LANG_PRESET = { ko: "KR", ja: "JP", zh: "JP", de: "EU", fr: "EU", es: "EU", pt: "EU", tr: "TR" };
  // de/fr/es 엑셀은 CSV 를 세미콜론으로 내보낸다 — 구분자 자동추정 실패 시의 로케일 힌트
  var LANG_DELIM = { de: ";", fr: ";", es: ";", pt: ";", it: ";", nl: ";" };

  /** 비교 키 정규화. 원본은 절대 바꾸지 않고 이 반환값만 매칭에 쓴다.
      순서: 폭/합성 → 악센트 → 공백 → 케이스폴딩 → 앞자리 0. */
  function normalizeKey(s, o) {
    var k = s == null ? "" : String(s);
    try {
      if (o.nfkc) k = k.normalize("NFKC");
      else if (o.nfc) k = k.normalize("NFC");
    } catch (e) { /* 구형 브라우저 normalize 미지원 — 원형 유지 */ }
    if (o.accent) {
      try { k = k.normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC"); }
      catch (e) { /* noop */ }
    }
    if (o.trim) k = k.replace(/^\s+|\s+$/g, "").replace(/\s+/g, " ");
    if (o.removeSpace) k = k.replace(/\s+/g, "");
    if (o.caseless) {
      try { k = o.turkish ? k.toLocaleLowerCase("tr") : k.toLowerCase(); }
      catch (e) { k = k.toLowerCase(); }
    }
    if (o.zeros && /^[0-9]+$/.test(k)) k = k.replace(/^0+(?=\d)/, "");
    return k;
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

  /** 구분자 자동 감지: 후보별로 파싱해 (일관된 열 수 × 그 빈도) 최대. 1열이면 null. */
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
    return best;
  }

  /** 텍스트 → { table, delim, width }. delim==="auto" 면 자동추정, 아니면 강제. */
  function parseTable(text, delimChoice) {
    var delim = delimChoice && delimChoice !== "auto" ? delimChoice : detectDelim(text);
    if (!delim) {
      var t = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
      var lines = t.split(/\r\n|\r|\n/);
      return { table: lines.map(function (l) { return [l]; }), delim: null, width: 1 };
    }
    var table = parseDelimited(text, delim);
    var width = 0;
    for (var i = 0; i < table.length; i++) if (table[i].length > width) width = table[i].length;
    return { table: table, delim: delim, width: width };
  }

  var HEADER_RE = /(name|email|e-?mail|\bid\b|user|member|code|phone|tel|번호|이름|성명|명단|아이디|회원|사번|코드|고객|메일|전화|氏名|名前|会員|メール|番号|电子邮件|会员|编号|correo|nombre|nome|courriel|nom)/i;
  /** 다중열일 때 첫 행이 헤더로 보이는가 — 헤더 키워드가 있거나, 1행엔 숫자가 거의 없는데 아래는 많으면. */
  function looksLikeHeader(table, width) {
    if (!table.length || width < 2) return false;
    var r0 = table[0], i;
    for (i = 0; i < r0.length; i++) if (HEADER_RE.test(String(r0[i] == null ? "" : r0[i]))) return true;
    // 첫 행 전부 비수치 + 2행에 수치가 있으면 헤더로 추정
    if (table.length >= 2) {
      var numRe = /^\s*-?\d[\d.,]*\s*$/, r0num = 0, r1num = 0;
      for (i = 0; i < width; i++) {
        if (numRe.test(String(r0[i] == null ? "" : r0[i]))) r0num++;
        if (numRe.test(String((table[1][i]) == null ? "" : table[1][i]))) r1num++;
      }
      if (r0num === 0 && r1num > 0) return true;
    }
    return false;
  }

  /** 헤더에서 키 열 자동 추정 — 헤더 키워드에 걸리는 첫 열(email/id 우선). 없으면 [0]. */
  function autoKeyCols(table, hasHeader, width) {
    if (!hasHeader || !table.length || width < 2) return [0];
    var head = table[0], i;
    for (i = 0; i < head.length; i++) if (/(email|e-?mail|메일|correo|courriel)/i.test(String(head[i]))) return [i];
    for (i = 0; i < head.length; i++) if (HEADER_RE.test(String(head[i] == null ? "" : head[i]))) return [i];
    return [0];
  }

  /** 배열 → CSV (RFC4180 인용). 엑셀 한글 깨짐 방지 UTF-8 BOM 은 Blob 생성 시 붙인다. */
  function toCSV(rows) {
    return rows.map(function (r) {
      return r.map(function (v) {
        var s = v == null ? "" : String(v);
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(",");
    }).join("\r\n");
  }

  /** 핵심: 파싱된 table 에서 중복 행을 분류한다. Map 1패스 × 2 = O(n), 삽입 순서 보존.
      cfg = { startRow, width, keyCols(빈 배열=행 전체), opts, keepPolicy('first'|'last') }
      반환 인덱스만 — 원본 행은 호출자(메인 스레드)가 보유(프라이버시·메모리, spec). */
  function dedupeRows(table, cfg, onProgress) {
    var startRow = cfg.startRow || 0;
    var width = cfg.width || 1;
    var keyCols = (cfg.keyCols && cfg.keyCols.length) ? cfg.keyCols : null; // null = 전 컬럼
    var opts = cfg.opts || {};
    var keepLast = cfg.keepPolicy === "last";
    var US = ""; // 복합키 셀 구분자 — 데이터에 안 나타나는 unit separator
    var n = table.length;
    var keys = new Array(n);       // key(문자열)=유효 / null=빈키 / undefined=빈행·헤더
    var blank = [], emptyKey = [], mismatch = 0, dataCount = 0;
    var i, j, row, cell, nk, parts, any, cols;

    for (i = startRow; i < n; i++) {
      row = table[i] || [];
      // 완전 빈 행?
      var allBlank = true;
      for (j = 0; j < row.length; j++) {
        if (String(row[j] == null ? "" : row[j]).trim() !== "") { allBlank = false; break; }
      }
      if (allBlank) { blank.push(i); keys[i] = undefined; continue; }
      dataCount++;
      if (row.length !== width) mismatch++;
      // 키 조립
      cols = keyCols; parts = []; any = false;
      if (cols) {
        for (j = 0; j < cols.length; j++) {
          cell = row[cols[j]]; nk = normalizeKey(cell == null ? "" : cell, opts);
          if (nk !== "") any = true; parts.push(nk);
        }
      } else {
        for (j = 0; j < width; j++) {
          cell = row[j]; nk = normalizeKey(cell == null ? "" : cell, opts);
          if (nk !== "") any = true; parts.push(nk);
        }
      }
      if (!any) { keys[i] = null; emptyKey.push(i); }
      else keys[i] = parts.join(US);
      if (onProgress && dataCount % PROGRESS_STEP === 0) onProgress(dataCount);
    }

    // 유지정책에 맞춰 대표 인덱스 확정
    var idxMap = new Map(), key;
    for (i = startRow; i < n; i++) {
      key = keys[i];
      if (key === undefined || key === null) continue;
      if (keepLast) idxMap.set(key, i);
      else if (!idxMap.has(key)) idxMap.set(key, i);
    }

    // 오름차순 분류 — 정제본은 원래 순서 보존
    var keptOut = [], removed = [];
    for (i = startRow; i < n; i++) {
      key = keys[i];
      if (key === undefined) continue;               // 빈 행 — 출력 제외
      if (key === null) { keptOut.push(i); continue; } // 빈 키 — 정제본에 통과(중복 병합 안 함)
      if (idxMap.get(key) === i) keptOut.push(i);
      else removed.push(i);
    }

    return {
      keptOut: keptOut, removed: removed, emptyKey: emptyKey, blank: blank, mismatch: mismatch,
      stats: {
        totalRows: n - startRow,
        cleaned: keptOut.length,
        removed: removed.length,
        emptyKey: emptyKey.length,
        blank: blank.length
      }
    };
  }

  // node 단위 검증용 (브라우저에는 module 이 없어 무시된다 — 게이트 QA 는 브라우저 실측)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      normalizeKey: normalizeKey, parseDelimited: parseDelimited, detectDelim: detectDelim,
      parseTable: parseTable, looksLikeHeader: looksLikeHeader, autoKeyCols: autoKeyCols,
      toCSV: toCSV, dedupeRows: dedupeRows, PRESETS: PRESETS
    };
  }

  /* ============================================================
     UI — 여기서부터 DOM. 도구 마크업이 없으면(node 테스트 등) 아무것도 하지 않는다.
     ============================================================ */
  var $ = function (id) { return document.getElementById(id); };
  if (typeof document === "undefined" || !$("cd-paste")) return;

  var SLUG = (window.APP_CONFIG && window.APP_CONFIG.slug) || "csv-dedupe";
  var K_OPTS = SLUG + ":opts", K_CFG = SLUG + ":cfg", K_MAP = SLUG + ":map";

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
  function padRow(row, width) {
    var r = row ? row.slice(0) : [];
    while (r.length < width) r.push("");
    return r;
  }

  /* ---- 상태 (표 원본은 세션 메모리에만 — 저장하지 않는다) ---- */
  var S = {
    table: [], width: 1, delimChoice: "auto", detectedDelim: null,
    hasHeader: false, keyCols: [0], keepPolicy: "first",
    bytes: null, enc: "utf-8"
  };
  var opts = null, preset = "EN", lastResult = null, worker = null, tab = "clean";

  /* ---- 프리셋 결정 ---- */
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
  function localeDelimHint() {
    var navs = navigator.languages || [navigator.language || ""];
    for (var i = 0; i < navs.length; i++) {
      var p = String(navs[i]).split("-")[0].toLowerCase();
      if (LANG_DELIM[p]) return LANG_DELIM[p];
    }
    return null;
  }

  /* ---- 옵션 UI 연동 ---- */
  var OPT_EL = {
    trim: "cd-o-trim", removeSpace: "cd-o-space", caseless: "cd-o-case", nfc: "cd-o-nfc",
    nfkc: "cd-o-nfkc", accent: "cd-o-accent", turkish: "cd-o-tr", zeros: "cd-o-zeros"
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
    $("cd-preset").value = preset;
    save(K_OPTS, { preset: preset, opts: opts });
  }
  function saveCfg() {
    save(K_CFG, { delimChoice: S.delimChoice, hasHeader: S.hasHeader, keepPolicy: S.keepPolicy });
  }
  function headerSig() { return S.table.length ? S.table[0].join("") : ""; }
  function saveMap() { save(K_MAP, { sig: headerSig(), keyCols: S.keyCols }); }

  /* ---- 매핑 UI (구분자·헤더·키 컬럼·유지정책) ---- */
  function renderControls() {
    var multi = S.width >= 2;
    $("cd-delim").value = S.delimChoice;
    $("cd-header").checked = S.hasHeader;
    $("cd-header-wrap").hidden = !S.table.length;

    var keyWrap = $("cd-keys");
    if (!multi) {
      keyWrap.hidden = true;
      $("cd-keywhole").hidden = !S.table.length;
      return;
    }
    $("cd-keywhole").hidden = true;
    keyWrap.hidden = false;
    var box = $("cd-keycols");
    box.innerHTML = "";
    for (var i = 0; i < S.width; i++) {
      var head = S.hasHeader ? String(S.table[0][i] == null ? "" : S.table[0][i]).trim() : "";
      var label = head || t("tool.map.col", { n: i + 1 });
      var id = "cd-key-" + i;
      var lab = document.createElement("label");
      lab.className = "cd-chip";
      var cb = document.createElement("input");
      cb.type = "checkbox"; cb.id = id; cb.value = String(i);
      cb.checked = S.keyCols.indexOf(i) >= 0;
      cb.addEventListener("change", onKeyColChange);
      var sp = document.createElement("span");
      sp.textContent = label;
      lab.appendChild(cb); lab.appendChild(sp);
      box.appendChild(lab);
    }
    updateKeyNote();
  }
  function updateKeyNote() {
    var note = $("cd-key-note");
    if (S.width < 2) { note.hidden = true; return; }
    note.hidden = false;
    note.textContent = S.keyCols.length ? t("tool.keyHint") : t("tool.keyWhole");
  }
  function onKeyColChange() {
    var box = $("cd-keycols"), cbs = box.querySelectorAll("input[type=checkbox]");
    var cols = [];
    for (var i = 0; i < cbs.length; i++) if (cbs[i].checked) cols.push(parseInt(cbs[i].value, 10));
    S.keyCols = cols;
    updateKeyNote(); saveMap(); run();
  }

  /* ---- 표 세팅 ---- */
  function setTableText(text, fromBytes) {
    var parsed = parseTable(text, S.delimChoice);
    // 마지막 빈 줄 제거
    var table = parsed.table.filter(function (r, i) {
      return !(r.length === 1 && r[0].trim() === "" && i === parsed.table.length - 1);
    });
    S.table = table;
    S.width = parsed.width;
    S.detectedDelim = parsed.delim;
    if (!table.length) { renderControls(); run(); return; }
    if (S.width >= 2) {
      var savedMap = load(K_MAP, null);
      var savedCfg = load(K_CFG, null);
      if (savedCfg && typeof savedCfg.hasHeader === "boolean" && savedMap && savedMap.sig === headerSig()) {
        S.hasHeader = savedCfg.hasHeader;
      } else {
        S.hasHeader = looksLikeHeader(table, S.width);
      }
      if (savedMap && savedMap.sig === headerSig() && savedMap.keyCols) {
        S.keyCols = savedMap.keyCols.filter(function (c) { return c < S.width; });
      } else {
        S.keyCols = autoKeyCols(table, S.hasHeader, S.width);
      }
    } else {
      S.hasHeader = false; S.keyCols = [0];
    }
    if (!fromBytes) { S.bytes = null; $("cd-enc").hidden = true; }
    renderControls();
    run();
  }

  /* ---- 인코딩 디코드 (BOM → UTF-8 엄격 → euc-kr 폴백) ---- */
  function decode(bytes, enc) {
    try { return new TextDecoder(enc, { fatal: false }).decode(bytes); }
    catch (e) { return null; }
  }
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
  function applyBytes(buf, enc) {
    S.bytes = buf;
    var r = enc ? { text: decode(new Uint8Array(buf), enc), enc: enc, sure: true } : decodeSmart(buf);
    if (r.text == null) { setMsg(esc(t("tool.n.decode")), true); return; }
    S.enc = r.enc;
    var el = $("cd-paste");
    el.value = r.text.length > 5000000 ? r.text.slice(0, 5000000) : r.text;
    var banner = $("cd-enc");
    var garbled = r.text.indexOf("�") >= 0;
    if (garbled || !r.sure || r.enc === "euc-kr") {
      banner.hidden = false;
      $("cd-enc-text").textContent = r.enc === "euc-kr" ? t("tool.enc.cp949") : t("tool.enc.broken");
      $("cd-enc-btn").textContent = r.enc === "euc-kr" ? t("tool.enc.back") : t("tool.enc.retry");
    } else { banner.hidden = true; }
    setTableText(el.value, true);
  }
  function readFile(file) {
    if (!file) return;
    if (file.size > HARD_BYTES) {
      var mb = Math.round(file.size / 1048576);
      if (!window.confirm(t("tool.confirm.bigFile", { n: fmtNum(mb) }))) { flash(t("tool.n.scaleAbort")); return; }
    } else if (file.size > BIG_FILE) {
      flash(t("tool.warn.bigFile", { n: fmtNum(Math.round(file.size / 1048576)) }));
    }
    var fr = new FileReader();
    fr.onload = function () { applyBytes(fr.result, null); };
    fr.onerror = function () { setMsg(esc(t("tool.n.read")), true); };
    fr.readAsArrayBuffer(file);
  }

  /* ---- 데이터 행 범위 ---- */
  function dataRowCount() {
    if (!S.table.length) return 0;
    return Math.max(0, S.table.length - (S.hasHeader ? 1 : 0));
  }

  /* ---- 결과 계산 ---- */
  var elMsg = $("cd-msg"), elOut = $("cd-out");
  function setMsg(html, isErr) {
    elMsg.innerHTML = html;
    elMsg.className = "cd-msg" + (isErr ? " is-err" : "");
    elMsg.hidden = false;
    elOut.hidden = true;
    lastResult = null;
  }
  function stopWorker() {
    if (worker) { try { worker.terminate(); } catch (e) { /* noop */ } worker = null; }
    $("cd-progress").hidden = true;
  }

  function cfgFor(total) {
    return {
      startRow: S.hasHeader ? 1 : 0,
      width: S.width,
      keyCols: S.width >= 2 ? S.keyCols.slice(0) : [],
      opts: opts,
      keepPolicy: S.keepPolicy
    };
  }

  function run() {
    stopWorker();
    if (!S.table.length) { setMsg(esc(t("tool.n.empty"))); return; }
    var total = dataRowCount();
    if (total === 0) { setMsg(esc(t("tool.n.headerOnly"))); return; }

    // 규모 초과 — 조용한 절삭 금지: 확인 후 앞 N행만
    var table = S.table, truncated = 0;
    if (total > HARD_ROWS) {
      if (!window.confirm(t("tool.confirm.scale", { n: fmtNum(total), max: fmtNum(HARD_ROWS) }))) {
        setMsg(esc(t("tool.n.scaleAbort")), true); return;
      }
      var head = S.hasHeader ? 1 : 0;
      table = S.table.slice(0, head + HARD_ROWS);
      truncated = total - HARD_ROWS;
    }

    var cfg = cfgFor();
    var bytes = S.bytes ? S.bytes.byteLength : 0;
    var heavy = table.length > WORKER_ROWS || bytes > WORKER_BYTES;

    if (heavy && typeof Worker !== "undefined") {
      runWorker(table, cfg, truncated);
    } else {
      var res = dedupeRows(table, cfg, null);
      finish(res, table, cfg, truncated);
    }
  }

  /* ---- Web Worker: PURE 함수를 Blob 으로 직렬화해 백그라운드 처리 ---- */
  function buildWorker() {
    var src =
      "var PROGRESS_STEP=" + PROGRESS_STEP + ";\n" +
      "var normalizeKey=" + normalizeKey.toString() + ";\n" +
      "var dedupeRows=" + dedupeRows.toString() + ";\n" +
      "onmessage=function(e){var d=e.data;try{" +
      "var res=dedupeRows(d.table,d.cfg,function(done){postMessage({type:'progress',done:done});});" +
      "postMessage({type:'done',result:res});}catch(err){postMessage({type:'error',message:String(err&&err.message||err)});}};";
    var blob = new Blob([src], { type: "application/javascript" });
    return new Worker(URL.createObjectURL(blob));
  }
  function runWorker(table, cfg, truncated) {
    var total = table.length - cfg.startRow;
    $("cd-progress").hidden = false;
    $("cd-bar").value = 0;
    $("cd-progress-text").textContent = t("tool.progress", { n: fmtNum(total) });
    var w;
    try { w = buildWorker(); }
    catch (e) { // Worker 생성 실패(CSP 등) → 메인 스레드 폴백
      $("cd-progress").hidden = true;
      var res = dedupeRows(table, cfg, null);
      finish(res, table, cfg, truncated); return;
    }
    worker = w;
    w.onmessage = function (ev) {
      var m = ev.data || {};
      if (m.type === "progress") {
        $("cd-bar").value = Math.round((m.done / Math.max(1, total)) * 100);
      } else if (m.type === "done") {
        stopWorker();
        finish(m.result, table, cfg, truncated);
      } else if (m.type === "error") {
        stopWorker();
        setMsg(esc(t("tool.n.workerFail")), true);
      }
    };
    w.onerror = function () {
      stopWorker();
      // 폴백: 메인 스레드로 재시도
      var res = dedupeRows(table, cfg, null);
      finish(res, table, cfg, truncated);
    };
    w.postMessage({ table: table, cfg: cfg });
  }

  function finish(res, table, cfg, truncated) {
    lastResult = {
      res: res, table: table, cfg: cfg, truncated: truncated,
      hasHeader: S.hasHeader, width: S.width,
      header: S.hasHeader && table.length ? padRow(table[0], S.width) : null
    };
    tab = "clean";
    render();
  }

  /* ---- 출력 테이블 만들기 ---- */
  function outRows(which) {
    var r = lastResult, res = r.res, width = r.width, header = r.header, out = [], idxs, i;
    if (header) out.push(header.slice(0));
    if (which === "clean") idxs = res.keptOut;
    else if (which === "removed") idxs = res.removed;
    else idxs = res.emptyKey;
    for (i = 0; i < idxs.length; i++) out.push(padRow(r.table[idxs[i]], width));
    return out;
  }

  /* ---- 렌더 ---- */
  function render() {
    elMsg.hidden = true;
    elOut.hidden = false;
    var r = lastResult, st = r.res.stats;

    // 리포트 배지 (조용한 삭제 금지)
    var parts = [];
    parts.push("<strong>" + esc(t("tool.rep.orig", { n: fmtNum(st.totalRows) })) + "</strong>");
    parts.push(esc(t("tool.rep.clean", { n: fmtNum(st.cleaned) })));
    parts.push("<strong>" + esc(t("tool.rep.removed", { n: fmtNum(st.removed) })) + "</strong>");
    if (st.emptyKey) parts.push(esc(t("tool.rep.emptyKey", { n: fmtNum(st.emptyKey) })));
    if (st.blank) parts.push(esc(t("tool.rep.blank", { n: fmtNum(st.blank) })));
    $("cd-badge").innerHTML = parts.join(" · ");

    // 경고/안내 (조용한 실패 금지)
    var lines = [];
    if (st.removed === 0) lines.push(t("tool.rep.none"));
    if (r.res.mismatch) lines.push(t("tool.warn.mismatch", { n: fmtNum(r.res.mismatch) }));
    if (r.truncated) lines.push(t("tool.warn.cap", { n: fmtNum(HARD_ROWS) }));
    var warn = $("cd-warn");
    if (lines.length) {
      warn.hidden = false;
      warn.innerHTML = lines.map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("");
    } else { warn.hidden = true; }

    // 탭 배지
    $("cd-cnt-clean").textContent = fmtNum(r.res.stats.cleaned);
    $("cd-cnt-removed").textContent = fmtNum(r.res.stats.removed);
    $("cd-cnt-emptykey").textContent = fmtNum(r.res.stats.emptyKey);
    $("cd-tab-emptykey").hidden = r.res.stats.emptyKey === 0;
    if (tab === "emptykey" && r.res.stats.emptyKey === 0) tab = "clean";

    renderPanel();
  }

  function activeIdx() {
    var res = lastResult.res;
    return tab === "clean" ? res.keptOut : (tab === "removed" ? res.removed : res.emptyKey);
  }

  function renderPanel() {
    if (!lastResult) return;
    var r = lastResult, idxs = activeIdx();
    ["clean", "removed", "emptykey"].forEach(function (x) {
      var b = $("cd-tab-" + x);
      if (b) b.setAttribute("aria-selected", x === tab ? "true" : "false");
    });
    $("cd-panel-count").textContent = t("tool.panelCount", { n: fmtNum(idxs.length) });

    var width = r.width, header = r.header;
    var cols = width, html = "<thead><tr><th class=\"cd-num\">#</th>";
    for (var c = 0; c < cols; c++) {
      var h = header ? String(header[c] == null ? "" : header[c]) : t("tool.map.col", { n: c + 1 });
      html += "<th>" + esc(h) + "</th>";
    }
    html += "</tr></thead><tbody>";
    if (!idxs.length) {
      var msg = tab === "clean" ? t("tool.empty.clean") : (tab === "removed" ? t("tool.empty.removed") : t("tool.empty.emptykey"));
      html += "<tr><td colspan=\"" + (cols + 1) + "\" style=\"color:var(--muted)\">" + esc(msg) + "</td></tr>";
    } else {
      var shown = Math.min(idxs.length, TABLE_CAP);
      for (var i = 0; i < shown; i++) {
        var row = padRow(r.table[idxs[i]], width);
        html += "<tr><td class=\"cd-num\">" + (i + 1) + "</td>";
        for (var j = 0; j < width; j++) html += "<td>" + esc(row[j]) + "</td>";
        html += "</tr>";
      }
    }
    html += "</tbody>";
    $("cd-tbl").innerHTML = html;
    var trunc = $("cd-trunc");
    if (idxs.length > TABLE_CAP) {
      trunc.hidden = false;
      trunc.textContent = t("tool.trunc", { shown: fmtNum(TABLE_CAP), total: fmtNum(idxs.length) });
    } else { trunc.hidden = true; }
  }

  function showTab(k) { tab = k; renderPanel(); }

  /* ---- 출력: CSV / 클립보드 ---- */
  function flash(msg) {
    var s = $("cd-status");
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

  $("cd-dl-clean").addEventListener("click", function () { if (lastResult) downloadCSV(outRows("clean"), "cleaned"); });
  $("cd-dl-removed").addEventListener("click", function () { if (lastResult) downloadCSV(outRows("removed"), "removed-duplicates"); });
  $("cd-copy").addEventListener("click", function () {
    if (!lastResult) return;
    var rows = outRows(tab);
    var text = rows.map(function (r) {
      return r.map(function (v) { return String(v == null ? "" : v).replace(/[\t\r\n]/g, " "); }).join("\t");
    }).join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash(t("tool.copied")); },
        function () { flash(t("tool.copyFail")); });
    } else { flash(t("tool.copyFail")); }
  });

  /* ---- 입력 이벤트 ---- */
  var pasteEl = $("cd-paste");
  var timer = null;
  pasteEl.addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      S.bytes = null; $("cd-enc").hidden = true;
      setTableText(pasteEl.value, false);
    }, 220);
  });
  var dz = $("cd-drop");
  ["dragenter", "dragover"].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("is-over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("is-over"); });
  });
  dz.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) readFile(e.dataTransfer.files[0]);
  });
  $("cd-pick").addEventListener("click", function () { $("cd-file").click(); });
  $("cd-file").addEventListener("change", function (e) {
    if (e.target.files && e.target.files.length) readFile(e.target.files[0]);
    e.target.value = "";
  });
  $("cd-enc-btn").addEventListener("click", function () {
    if (!S.bytes) return;
    applyBytes(S.bytes, S.enc === "euc-kr" ? "utf-8" : "euc-kr");
  });

  /* ---- 컨트롤 이벤트 ---- */
  $("cd-delim").addEventListener("change", function () {
    S.delimChoice = $("cd-delim").value; saveCfg();
    setTableText(pasteEl.value, !!S.bytes);
  });
  $("cd-header").addEventListener("change", function () {
    S.hasHeader = $("cd-header").checked;
    if (S.width >= 2) S.keyCols = autoKeyCols(S.table, S.hasHeader, S.width);
    renderControls(); saveCfg(); saveMap(); run();
  });
  ["first", "last"].forEach(function (p) {
    $("cd-keep-" + p).addEventListener("change", function () {
      if ($("cd-keep-" + p).checked) { S.keepPolicy = p; saveCfg(); run(); }
    });
  });

  /* ---- 옵션·프리셋 이벤트 ---- */
  $("cd-preset").addEventListener("change", function () { applyPreset($("cd-preset").value); run(); });
  OPT_KEYS.forEach(function (k) {
    $(OPT_EL[k]).addEventListener("change", function () {
      opts = readOpts();
      save(K_OPTS, { preset: preset, opts: opts });
      run();
    });
  });

  /* ---- 버튼 ---- */
  $("cd-sample").addEventListener("click", function () {
    pasteEl.value = t("tool.sample.data");
    S.bytes = null; S.delimChoice = "auto"; $("cd-enc").hidden = true;
    $("cd-delim").value = "auto";
    setTableText(pasteEl.value, false);
  });
  $("cd-clear").addEventListener("click", function () {
    pasteEl.value = "";
    S.table = []; S.width = 1; S.bytes = null; S.keyCols = [0]; S.hasHeader = false;
    $("cd-enc").hidden = true;
    renderControls();
    setMsg(esc(t("tool.n.empty")));
  });
  $("cd-cancel").addEventListener("click", function () {
    stopWorker();
    setMsg(esc(t("tool.canceled")), true);
  });
  ["clean", "removed", "emptykey"].forEach(function (k) {
    $("cd-tab-" + k).addEventListener("click", function () { showTab(k); });
  });

  /* ---- 탭·유지정책·구분자 초기화 ---- */
  (function initCfg() {
    var savedCfg = load(K_CFG, null);
    if (savedCfg) {
      if (savedCfg.delimChoice) S.delimChoice = savedCfg.delimChoice;
      if (savedCfg.keepPolicy === "last" || savedCfg.keepPolicy === "first") S.keepPolicy = savedCfg.keepPolicy;
    }
    $("cd-delim").value = S.delimChoice;
    $("cd-keep-" + S.keepPolicy).checked = true;
  })();

  applyPreset(detectPreset());
  setMsg(esc(t("tool.n.empty")));

  // 언어 전환 — 라벨·안내·통계 문구가 따라간다
  document.addEventListener("i18n:change", function () {
    renderControls();
    if (lastResult) render(); else setMsg(esc(t("tool.n.empty")));
  });
  // TOOLJS:END
})();
