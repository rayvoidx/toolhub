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
  /* csv-diff — 두 CSV/표를 키 컬럼으로 조인해 added/removed/changed/unchanged 4분류
     spec: factory/state/csv-diff.yaml   parent: list-compare (PURE 코어 재사용)

     설계 원칙
     - pure-static: 서버·DB·외부 API 0. 표 원본은 세션 메모리에만 있고 저장하지 않는다.
       (privacy.html 의 "브라우저를 떠나지 않음" 약속 = 보안팀 무승인 사용의 채택 조건)
     - list-compare(집합 유무)와 달리 csv-diff 는 '키로 짝지어 셀 단위 변경(changed)'까지 잡는다.
       텍스트 라인 diff 가 아니라 키 조인 diff 라 행·열 순서가 바뀌어도 정확히 대사한다.
     - 정규화는 키·값 비교에만 적용하고 원본 셀은 표시·출력용으로 보존한다(철칙: 조용한 변형 금지).
     - '숫자로 비교'·'날짜 정규화'·'앞자리 0 무시'는 전부 기본 OFF — 사번/사업자번호를 조용히
       숫자화하면 '00123' vs '123' 이 가짜 changed 로 뜨므로 사용자가 명시적으로 켤 때만 흡수.
     - 조용한 실패 금지: 둘 다 빈·한쪽 빈·완전일치·키 미선택·빈 키·빈 행·열 수 불일치·중복 키·
       인코딩 깨짐·규모 초과 전부 명시 표기.

     저장 (localStorage, prefix "csv-diff:")
       :opts  정규화/비교 옵션·프리셋       :cfg  키 컬럼·머리글·컬럼 매핑(헤더 시그니처 일치 시 복원)
       표 데이터(붙여넣은 원본·파일 내용)는 저장하지 않는다.  URL ?preset= 로 프리셋 지정 가능.

     PURE 코어(parseDelimited·detectDelim·parseText·normalizeKey·toCSV·PRESETS)는 parent
     list-compare 에서 복사 재사용하고, 조인/4분류·로케일 숫자/날짜 파서만 신규로 얹었다. */

  /* ============================================================
     PURE — DOM 무관. node 단위 검증 가능(module.exports 가드).
     ============================================================ */

  var MAX_ROWS = 200000;     // side 당 상한 — 초과분은 조용히 자르지 않고 배지로 알린다
  var BIG_ROWS = 50000;      // 두 파일 합산 이 이상이면 청크 처리 + 진행률·취소
  var BIG_FILE = 5 * 1024 * 1024;
  var HUGE_FILE = 20 * 1024 * 1024;
  var TABLE_CAP = 200;       // 패널별 화면 표 최대 행 (전량은 CSV 다운로드로)
  var CHUNK = 5000;
  var KSEP = "\u0001";       // 복합키 조인 구분자 (데이터에 안 나오는 제어문자)

  /* 로케일 프리셋 — 각 프리셋이 정규화 옵션 기본값 세트 + 날짜 해석 순서를 정한다.
     removeSpace 는 CJK 프리셋(KR/JP)에서 기본 ON('홍 길동' vs '홍길동'). 날짜 순서는
     미국식 MDY vs 유럽/한국식 DMY 로 갈리는 애매 케이스(01/02/2026)에만 쓰인다. */
  var PRESETS = {
    EN: { trim: 1, removeSpace: 0, caseless: 1, nfc: 1, nfkc: 0, accent: 0, turkish: 0, zeros: 0, dateOrder: "MDY" },
    KR: { trim: 1, removeSpace: 1, caseless: 1, nfc: 1, nfkc: 0, accent: 0, turkish: 0, zeros: 0, dateOrder: "DMY" },
    JP: { trim: 1, removeSpace: 1, caseless: 1, nfc: 1, nfkc: 1, accent: 0, turkish: 0, zeros: 0, dateOrder: "MDY" },
    EU: { trim: 1, removeSpace: 0, caseless: 1, nfc: 1, nfkc: 0, accent: 1, turkish: 0, zeros: 0, dateOrder: "DMY" },
    TR: { trim: 1, removeSpace: 0, caseless: 1, nfc: 1, nfkc: 0, accent: 0, turkish: 1, zeros: 0, dateOrder: "DMY" }
  };
  var OPT_KEYS = ["trim", "removeSpace", "caseless", "nfc", "nfkc", "accent", "turkish", "zeros"];
  var VAL_KEYS = ["numeric", "dates"]; // 값 비교 전용 옵션 (기본 OFF)
  var LANG_PRESET = { ko: "KR", ja: "JP", zh: "JP", de: "EU", fr: "EU", es: "EU", pt: "EU", tr: "TR" };

  /** 비교 키 정규화. 원본은 절대 바꾸지 않고 이 함수의 반환값만 매칭에 쓴다.
      순서: 폭/합성 정규화 → 악센트 → 공백 → 케이스폴딩 → 앞자리 0. */
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

  /** 로케일 함정 흡수 — 천단위/소수점 구분이 갈리는 두 표기를 같은 수로 파싱.
      DE "1.234,56" 과 US "1,234.56" 은 둘 다 1234.56. 파싱 불가면 null. */
  function parseLooseNumber(raw) {
    var s = raw == null ? "" : String(raw).trim();
    if (s === "") return null;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }     // 회계식 음수 (123)
    s = s.replace(/[\s\u00a0\u202f\u2009]/g, "");                    // 각종 공백 제거
    s = s.replace(/^[^\d(,.\-+]*/, "").replace(/[^\d,.%]*$/, "");    // 앞뒤 통화기호 등 제거
    var pct = false;
    if (s.slice(-1) === "%") { pct = true; s = s.slice(0, -1); }
    if (s.charAt(0) === "-") { neg = !neg; s = s.slice(1); }
    else if (s.charAt(0) === "+") { s = s.slice(1); }
    if (!/^[\d.,]*\d[\d.,]*$/.test(s)) return null;
    var num, hasC = s.indexOf(",") >= 0, hasD = s.indexOf(".") >= 0;
    if (hasC && hasD) {
      // 마지막에 나오는 구분자가 소수점, 다른 하나는 천단위
      num = s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(/,/g, ".").replace(/\.(?=.*\.)/g, "")
        : s.replace(/,/g, "");
    } else if (hasC) {
      var pc = s.split(",");
      if (pc.length === 2 && pc[1].length !== 3) num = pc[0] + "." + pc[1]; // 소수점
      else num = pc.join("");                                               // 천단위(들)
    } else if (hasD) {
      var pd = s.split(".");
      if (pd.length > 2) num = pd.join("");                                 // 1.234.567 천단위
      else num = s;                                                         // 통상 소수점
    } else num = s;
    var v = parseFloat(num);
    if (isNaN(v)) return null;
    if (pct) v = v / 100;
    return neg ? -v : v;
  }

  /** 흔한 날짜 서식 → ISO(yyyy-mm-dd). 애매하면 order(MDY/DMY) 적용. 파싱 불가면 null. */
  function parseLooseDate(raw, order) {
    var s = raw == null ? "" : String(raw).trim();
    if (s === "") return null;
    function iso(y, m, d) {
      if (m < 1 || m > 12 || d < 1 || d > 31) return null;
      return String(y) + "-" + (m < 10 ? "0" + m : m) + "-" + (d < 10 ? "0" + d : d);
    }
    // 엑셀 일련번호 (5~6자리 정수 — 4자리 연도와 구분). serial 1 = 1900-01-01(1899-12-30 기준)
    if (/^\d{5,6}$/.test(s)) {
      var serial = parseInt(s, 10);
      if (serial >= 10000 && serial <= 600000) {
        var dt = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
        return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
      }
    }
    var m = s.match(/^(\d{1,4})[.\/\-](\d{1,2})[.\/\-](\d{1,4})$/);
    if (!m) return null;
    var a = parseInt(m[1], 10), b = parseInt(m[2], 10), c = parseInt(m[3], 10);
    if (m[1].length === 4) return iso(a, b, c);                    // yyyy-mm-dd
    var year = c;
    if (m[3].length <= 2) year = c < 70 ? 2000 + c : 1900 + c;     // 2자리 연도
    var day, mon;
    if (a > 12) { day = a; mon = b; }
    else if (b > 12) { mon = a; day = b; }
    else { if (order === "MDY") { mon = a; day = b; } else { day = a; mon = b; } }
    return iso(year, mon, day);
  }

  /** 숫자 비교 허용 오차. o.tol(>0)은 절대값(abs) 또는 큰 쪽 대비 %(pct).
      tol 이 없거나 비정상이면 기존 동작(부동소수 오차만 흡수)으로 폴백한다. */
  function numberEpsilon(na, nb, o) {
    var base = 1e-9 * Math.max(1, Math.abs(na), Math.abs(nb));
    var tol = Number(o && o.tol);
    if (!isFinite(tol) || tol <= 0) return base;
    var extra = o.tolMode === "pct" ? Math.max(Math.abs(na), Math.abs(nb)) * tol / 100 : tol;
    return isFinite(extra) && extra > 0 ? extra + base : base;   // base 는 부동소수 여유분
  }

  /** 값 셀 동일성— 텍스트(정규화) → (옵션 시) 숫자 → (옵션 시) 날짜 순서로 비교. */
  function valueEqual(a, b, o) {
    var sa = a == null ? "" : String(a), sb = b == null ? "" : String(b);
    if (sa === sb) return true;
    if (normalizeKey(sa, o) === normalizeKey(sb, o)) return true;
    if (o.numeric) {
      var na = parseLooseNumber(sa), nb = parseLooseNumber(sb);
      if (na != null && nb != null && Math.abs(na - nb) <= numberEpsilon(na, nb, o)) return true;
    }
    if (o.dates) {
      var da = parseLooseDate(sa, o.dateOrder), db = parseLooseDate(sb, o.dateOrder);
      if (da != null && db != null && da === db) return true;
    }
    return false;
  }

  /** 복합키 생성. keyIdxs 열들의 정규화 값을 KSEP 로 잇는다. 전부 빈 값이면 hasKey=false. */
  function compositeKey(row, keyIdxs, o) {
    var parts = [], has = false;
    for (var j = 0; j < keyIdxs.length; j++) {
      var raw = row[keyIdxs[j]]; raw = raw == null ? "" : String(raw);
      var nk = normalizeKey(raw, o);
      if (nk !== "") has = true;
      parts.push(nk);
    }
    return { key: parts.join(KSEP), has: has };
  }

  /** 표 → Map<복합키,{cells,count}> + 사유별 카운트. 첫 행 기준(조용한 병합 금지 — dupes 리포트). */
  function buildRowIndex(rows, keyIdxs, o) {
    var st = { map: new Map(), order: [], dupes: 0, blanks: 0, emptyKeys: 0 };
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || [];
      var allEmpty = true;
      for (var c = 0; c < r.length; c++) { if (String(r[c] == null ? "" : r[c]).trim() !== "") { allEmpty = false; break; } }
      if (allEmpty) { st.blanks++; continue; }
      var ck = compositeKey(r, keyIdxs, o);
      if (!ck.has) { st.emptyKeys++; continue; }
      var e = st.map.get(ck.key);
      if (e) { e.count++; st.dupes++; }
      else { st.map.set(ck.key, { cells: r, count: 1 }); st.order.push(ck.key); }
    }
    return st;
  }

  /** 조인 1패스 — added/removed/changed/unchanged. valPairs=[{name,old,new}] 값 컬럼 매핑. */
  function diffTables(O, N, valPairs, o) {
    var added = [], removed = [], changed = [], unchanged = [], i, k;
    for (i = 0; i < O.order.length; i++) {
      k = O.order[i];
      var oe = O.map.get(k);
      if (N.map.has(k)) {
        var ne = N.map.get(k), diffs = [];
        for (var p = 0; p < valPairs.length; p++) {
          var vp = valPairs[p];
          var ov = vp.old >= 0 ? oe.cells[vp.old] : "";
          var nv = vp.new >= 0 ? ne.cells[vp.new] : "";
          if (!valueEqual(ov, nv, o)) diffs.push({ name: vp.name, old: ov, "new": nv });
        }
        if (diffs.length) changed.push({ key: k, oldCells: oe.cells, newCells: ne.cells, diffs: diffs });
        else unchanged.push({ key: k, cells: ne.cells, oldCells: oe.cells });
      } else {
        removed.push({ key: k, cells: oe.cells });
      }
    }
    for (i = 0; i < N.order.length; i++) {
      k = N.order[i];
      if (!O.map.has(k)) added.push({ key: k, cells: N.map.get(k).cells });
    }
    return { added: added, removed: removed, changed: changed, unchanged: unchanged };
  }

  /** 한 열의 유니크율(0..1) — 키 자동추천용. 정규화 후 서로 다른 값 / 비어있지 않은 행. */
  function uniqueRate(rows, colIdx, o) {
    var seen = new Set(), total = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || [];
      var raw = r[colIdx]; raw = raw == null ? "" : String(raw);
      var nk = normalizeKey(raw, o);
      if (nk === "") continue;
      total++; seen.add(nk);
    }
    return total ? seen.size / total : 0;
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

  /** 구분자 자동 감지: 후보별로 실제 파싱해 (일관된 열 수 × 그 빈도) 최대인 것. */
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
    return best; // null = 구분자 없음(단일 열)
  }

  /** 텍스트 → 2차원 배열 + 최대 열 수. 구분자가 없으면 줄 단위 단일 열. */
  function parseText(text) {
    var delim = detectDelim(text);
    if (!delim) {
      var t = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
      var lines = t.split(/\r\n|\r|\n/);
      return { table: lines.map(function (l) { return [l]; }), delim: null, width: 1 };
    }
    var table = parseDelimited(text, delim);
    var width = 0;
    for (var i = 0; i < table.length; i++) width = Math.max(width, table[i].length);
    return { table: table, delim: delim, width: width };
  }

  var HEADER_RE = /(name|email|e-?mail|\bid\b|user|member|code|sku|번호|이름|성명|명단|아이디|회원|사번|코드|고객|메일|거래처|氏名|名前|会員|メール|番号|电子邮件|会员|编号|correo|nombre|nome|courriel|nom)/i;
  /** 다중열일 때 첫 행이 헤더로 보이는가 — 헤더 키워드가 있거나, 첫 행에 숫자가 거의 없으면. */
  function looksLikeHeader(table, width) {
    if (!table.length || width < 2) return false;
    var r0 = table[0], i, numeric = 0, nonEmpty = 0;
    for (i = 0; i < r0.length; i++) {
      if (HEADER_RE.test(String(r0[i]))) return true;
      var v = String(r0[i] == null ? "" : r0[i]).trim();
      if (v === "") continue;
      nonEmpty++;
      if (/^[\d.,\-+%$€£¥\s]+$/.test(v)) numeric++;
    }
    return nonEmpty > 0 && numeric === 0 && width >= 2;
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
      normalizeKey: normalizeKey, parseLooseNumber: parseLooseNumber, parseLooseDate: parseLooseDate,
      valueEqual: valueEqual, compositeKey: compositeKey, buildRowIndex: buildRowIndex,
      diffTables: diffTables, uniqueRate: uniqueRate, parseDelimited: parseDelimited,
      detectDelim: detectDelim, parseText: parseText, looksLikeHeader: looksLikeHeader,
      toCSV: toCSV, PRESETS: PRESETS
    };
  }

  /* ============================================================
     UI — 여기서부터 DOM. 도구 마크업이 없으면(테스트 등) 아무것도 하지 않는다.
     ============================================================ */
  var $ = function (id) { return document.getElementById(id); };
  if (typeof document === "undefined" || !$("cd-paste-old")) return;

  var SLUG = (window.APP_CONFIG && window.APP_CONFIG.slug) || "csv-diff";
  var K_OPTS = SLUG + ":opts", K_CFG = SLUG + ":cfg";

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

  /* ---- 상태 (표 원본은 세션 메모리에만 — 저장하지 않는다) ---- */
  var sides = {
    old: { table: [], width: 1, hasHeader: false, bytes: null, enc: "utf-8", el: {} },
    "new": { table: [], width: 1, hasHeader: false, bytes: null, enc: "utf-8", el: {} }
  };
  var opts = null, preset = "EN", tab = "changed";
  var columns = { pairs: [], needsMap: false }; // pairs: {name, old, new}
  var keySel = [];        // 선택된 키 pair 인덱스(복합키)
  var keyReco = null;     // {idx, rate} 자동추천
  var lastResult = null, job = null;

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

  /* ---- 옵션 UI ---- */
  var OPT_EL = {
    trim: "cd-o-trim", removeSpace: "cd-o-space", caseless: "cd-o-case", nfc: "cd-o-nfc",
    nfkc: "cd-o-nfkc", accent: "cd-o-accent", turkish: "cd-o-tr", zeros: "cd-o-zeros",
    numeric: "cd-o-numeric", dates: "cd-o-dates"
  };
  var ALL_OPT_KEYS = OPT_KEYS.concat(VAL_KEYS);
  function readOpts() {
    var o = { dateOrder: PRESETS[preset] ? PRESETS[preset].dateOrder : "MDY" };
    ALL_OPT_KEYS.forEach(function (k) { o[k] = $(OPT_EL[k]).checked ? 1 : 0; });
    var raw = String($("cd-tol").value || "").trim();
    var tol = raw === "" ? 0 : Number(raw.replace(",", "."));
    var bad = raw !== "" && (!isFinite(tol) || tol < 0);
    o.tol = bad ? 0 : tol;
    o.tolMode = $("cd-tol-mode").value === "pct" ? "pct" : "abs";
    var msg = $("cd-tol-msg");
    msg.textContent = (bad ? t("tool.tol.bad") : t("tool.tol.hint")) ||
      (bad ? "Enter 0 or a positive number — the tolerance was ignored."
           : "0 means exact match. Use it to absorb rounding (e.g. 0.01).");
    msg.classList.toggle("is-warn", bad);
    var dord = $("cd-dord").value;
    if (dord === "MDY" || dord === "DMY") o.dateOrder = dord;
    $("cd-tol-wrap").hidden = !o.numeric;
    $("cd-dord-wrap").hidden = !o.dates;
    return o;
  }
  function writeOpts(o) { ALL_OPT_KEYS.forEach(function (k) { $(OPT_EL[k]).checked = !!o[k]; }); }
  function applyPreset(name) {
    preset = PRESETS[name] ? name : "EN";
    opts = { dateOrder: PRESETS[preset].dateOrder };
    OPT_KEYS.forEach(function (k) { opts[k] = PRESETS[preset][k]; });
    VAL_KEYS.forEach(function (k) { opts[k] = 0; }); // 숫자/날짜는 프리셋 무관 기본 OFF
    writeOpts(opts);
    opts = readOpts();   // 허용오차·날짜순서 입력값 반영 + 조건부 표시 동기화
    $("cd-preset").value = preset;
    save(K_OPTS, { preset: preset, opts: opts });
  }

  /* ---- 헤더 이름 / 컬럼 모델 ---- */
  function colName(side, idx) {
    var s = sides[side];
    if (s.hasHeader && s.table.length) {
      var h = String(s.table[0][idx] == null ? "" : s.table[0][idx]).trim();
      if (h) return h;
    }
    return t("tool.map.col", { n: idx + 1 });
  }
  function dataRows(side) {
    var s = sides[side];
    if (!s.table.length) return [];
    var start = s.hasHeader ? 1 : 0;
    var rows = s.table.slice(start);
    if (rows.length > MAX_ROWS) rows = rows.slice(0, MAX_ROWS);
    return rows;
  }
  function overflow(side) {
    var s = sides[side];
    var start = s.hasHeader ? 1 : 0;
    var n = Math.max(0, s.table.length - start);
    return n > MAX_ROWS ? n - MAX_ROWS : 0;
  }

  /* 컬럼 매핑 — 이름 일치로 자동 페어링, 저장된 매핑이 있으면 복원. */
  function cfgSig() {
    return sides.old.width + "x" + (sides.old.hasHeader ? headerJoin("old") : "") + "|" +
      sides["new"].width + "x" + (sides["new"].hasHeader ? headerJoin("new") : "");
  }
  function headerJoin(side) {
    var s = sides[side];
    return s.table.length ? s.table[0].join("␟") : "";
  }
  function norm(s) { return String(s == null ? "" : s).trim().toLowerCase(); }

  function buildColumns(savedMap) {
    var ow = sides.old.width, nw = sides["new"].width;
    var pairs = [], needsMap = false;
    var usedNew = {};
    if (savedMap && savedMap.length) {
      // 저장된 매핑 복원 (pair 배열 그대로)
      savedMap.forEach(function (p) {
        pairs.push({ name: p.name, old: p.old, "new": p["new"] });
        if (p["new"] >= 0) usedNew[p["new"]] = 1;
        if (p.old < 0 || p["new"] < 0) needsMap = true;
      });
    } else if (sides.old.hasHeader && sides["new"].hasHeader) {
      // 헤더 이름 매칭
      var newByName = {};
      for (var j = 0; j < nw; j++) { var nm = norm(colName("new", j)); if (!(nm in newByName)) newByName[nm] = j; }
      for (var i = 0; i < ow; i++) {
        var name = colName("old", i), nn = norm(name);
        if (nn in newByName && !usedNew[newByName[nn]]) {
          pairs.push({ name: name, old: i, "new": newByName[nn] }); usedNew[newByName[nn]] = 1;
        } else { pairs.push({ name: name, old: i, "new": -1 }); needsMap = true; }
      }
      for (var k = 0; k < nw; k++) if (!usedNew[k]) { pairs.push({ name: colName("new", k), old: -1, "new": k }); needsMap = true; }
    } else {
      // 위치 기반 (머리글 없음/한쪽만) — 인덱스로 페어
      var wmax = Math.max(ow, nw);
      for (var m = 0; m < wmax; m++) {
        var o = m < ow ? m : -1, nx = m < nw ? m : -1;
        var nmName = o >= 0 ? colName("old", o) : colName("new", nx);
        pairs.push({ name: nmName, old: o, "new": nx });
        if (o < 0 || nx < 0) needsMap = true;
      }
      if (ow !== nw) needsMap = true;
    }
    columns = { pairs: pairs, needsMap: needsMap };
  }

  function bothPairs() { return columns.pairs.filter(function (p) { return p.old >= 0 && p["new"] >= 0; }); }

  /* 키 자동추천 — both 열 중 Old 에서 유니크율 100% 인 첫 열, 없으면 최상위 + 경고. */
  function recommendKey() {
    var rows = dataRows("old"), both = [];
    columns.pairs.forEach(function (p, idx) { if (p.old >= 0 && p["new"] >= 0) both.push(idx); });
    if (!both.length) { keyReco = null; return; }
    var best = both[0], bestRate = -1;
    for (var i = 0; i < both.length; i++) {
      var rate = rows.length ? uniqueRate(rows, columns.pairs[both[i]].old, opts) : 0;
      if (rate >= 0.9999) { keyReco = { idx: both[i], rate: 1 }; return; }
      if (rate > bestRate) { bestRate = rate; best = both[i]; }
    }
    keyReco = { idx: best, rate: bestRate };
  }

  /* ---- 렌더: 키/매핑 UI ---- */
  function renderConfig() {
    var wrapK = $("cd-keys"), wrapM = $("cd-map");
    var both = bothPairs();
    if (!columns.pairs.length || (!sides.old.table.length && !sides["new"].table.length)) {
      wrapK.hidden = true; wrapM.hidden = true; return;
    }
    // 컬럼 매핑 (필요할 때만)
    if (columns.needsMap && (sides.old.table.length && sides["new"].table.length)) {
      wrapM.hidden = false;
      var oldOpts = ['<option value="-1">' + esc(t("tool.map.newonly")) + "</option>"];
      columns.pairs.forEach(function (p) { if (p.old >= 0) oldOpts.push('<option value="' + p.old + '">' + esc(colName("old", p.old)) + "</option>"); });
      var rowsHtml = "";
      columns.pairs.forEach(function (p, idx) {
        if (p["new"] < 0) return; // New 에 없는(Old 전용) 열은 아래 별도 표기
        rowsHtml += '<div class="cd-maprow"><span class="cd-mapnew">' + esc(colName("new", p["new"])) +
          '</span><span class="cd-maparrow">↔</span><select class="cd-mapsel" data-newidx="' + p["new"] + '">' +
          oldOpts.map(function (op) {
            var val = op.match(/value="(-?\d+)"/)[1];
            return op.replace(">", (parseInt(val, 10) === p.old ? ' selected>' : ">"));
          }).join("") + "</select></div>";
      });
      var oldOnly = columns.pairs.filter(function (p) { return p.old >= 0 && p["new"] < 0; });
      var oldOnlyHtml = oldOnly.length ? '<p class="cd-sub">' + esc(t("tool.map.oldonlyList", { cols: oldOnly.map(function (p) { return colName("old", p.old); }).join(", ") })) + "</p>" : "";
      $("cd-map-body").innerHTML = rowsHtml + oldOnlyHtml;
      Array.prototype.forEach.call(document.querySelectorAll("#cd-map-body .cd-mapsel"), function (sel) {
        sel.addEventListener("change", onMapChange);
      });
    } else { wrapM.hidden = true; }

    // 키 컬럼 체크박스
    wrapK.hidden = false;
    if (!both.length) {
      $("cd-key-body").innerHTML = '<p class="cd-sub">' + esc(t("tool.keyNone")) + "</p>";
    } else {
      $("cd-key-body").innerHTML = both.map(function (idx) {
        var p = columns.pairs[idx];
        var checked = keySel.indexOf(idx) >= 0 ? " checked" : "";
        return '<label class="cd-check"><input type="checkbox" class="cd-keychk" value="' + idx + '"' + checked +
          '><span>' + esc(p.name) + "</span></label>";
      }).join("");
      Array.prototype.forEach.call(document.querySelectorAll("#cd-key-body .cd-keychk"), function (chk) {
        chk.addEventListener("change", onKeyChange);
      });
    }
    // 키 안내 문구
    var note = $("cd-key-note");
    if (!keySel.length) { note.textContent = t("tool.keyNote.none"); note.className = "cd-sub is-warn"; }
    else if (keyReco && keyReco.rate >= 0.9999 && keySel.length === 1 && keySel[0] === keyReco.idx) {
      note.textContent = t("tool.keyNote.reco", { name: columns.pairs[keyReco.idx].name }); note.className = "cd-sub";
    } else if (keyReco && keyReco.rate < 0.9999) {
      note.textContent = t("tool.keyNote.weak", { name: columns.pairs[keyReco.idx].name, pct: Math.round(keyReco.rate * 100) });
      note.className = "cd-sub is-warn";
    } else { note.textContent = t("tool.keyHint"); note.className = "cd-sub"; }
  }

  function onMapChange(e) {
    var newIdx = parseInt(e.target.getAttribute("data-newidx"), 10);
    var oldIdx = parseInt(e.target.value, 10);
    // 같은 old 를 다른 곳에서 쓰고 있으면 그쪽을 해제
    columns.pairs.forEach(function (p) { if (p.old === oldIdx && p["new"] !== newIdx) p.old = -1; });
    var target = null;
    columns.pairs.forEach(function (p) { if (p["new"] === newIdx) target = p; });
    if (target) { target.old = oldIdx; if (oldIdx >= 0) target.name = colName("new", newIdx); }
    // pairs 정리: old 전용으로 떨어진 것들 반영
    normalizePairs();
    keySel = keySel.filter(function (i) { return columns.pairs[i] && columns.pairs[i].old >= 0 && columns.pairs[i]["new"] >= 0; });
    if (!keySel.length) autoSelectKey();
    persistCfg(); renderConfig(); run();
  }
  function normalizePairs() {
    // old 인덱스가 어떤 pair 에도 안 쓰이면 old-only pair 로 추가/유지
    var used = {};
    columns.pairs.forEach(function (p) { if (p.old >= 0) used[p.old] = 1; });
    for (var i = 0; i < sides.old.width; i++) {
      if (!used[i] && !columns.pairs.some(function (p) { return p.old === i; })) {
        columns.pairs.push({ name: colName("old", i), old: i, "new": -1 });
      }
    }
    columns.needsMap = columns.pairs.some(function (p) { return p.old < 0 || p["new"] < 0; }) || sides.old.width !== sides["new"].width;
  }

  function autoSelectKey() {
    recommendKey();
    keySel = keyReco ? [keyReco.idx] : [];
  }
  function onKeyChange() {
    var sel = [];
    Array.prototype.forEach.call(document.querySelectorAll("#cd-key-body .cd-keychk"), function (chk) {
      if (chk.checked) sel.push(parseInt(chk.value, 10));
    });
    keySel = sel;
    persistCfg(); renderConfig(); run();
  }
  function persistCfg() {
    save(K_CFG, {
      sig: cfgSig(),
      oldHeader: sides.old.hasHeader, newHeader: sides["new"].hasHeader,
      pairs: columns.pairs, keySel: keySel
    });
  }

  /* ---- 결과 계산 ---- */
  var elMsg = $("cd-msg"), elOut = $("cd-out");
  function setMsg(html, isErr) {
    elMsg.innerHTML = html;
    elMsg.className = "cd-msg" + (isErr ? " is-err" : "");
    elMsg.hidden = false;
    elOut.hidden = true;
    lastResult = null;
    renderSideStats(null);
  }

  function run() {
    if (job) { job.cancelled = true; job = null; }
    $("cd-progress").hidden = true;
    var hasOld = sides.old.table.length > 0, hasNew = sides["new"].table.length > 0;
    if (!hasOld && !hasNew) { setMsg(esc(t("tool.n.empty"))); return; }

    var both = bothPairs();
    // 키 미선택 또는 키가 both 가 아님 → 진행 차단
    var validKeys = keySel.filter(function (i) { return columns.pairs[i] && columns.pairs[i].old >= 0 && columns.pairs[i]["new"] >= 0; });
    if (!validKeys.length) { setMsg(esc(t("tool.n.noKey"))); return; }

    var oldRows = dataRows("old"), newRows = dataRows("new");
    var keyIdxOld = validKeys.map(function (i) { return columns.pairs[i].old; });
    var keyIdxNew = validKeys.map(function (i) { return columns.pairs[i]["new"]; });
    var valPairs = both.filter(function (p) {
      return validKeys.indexOf(columns.pairs.indexOf(p)) < 0;
    });

    var total = oldRows.length + newRows.length;
    if (total > BIG_ROWS) {
      var j = { cancelled: false };
      job = j;
      $("cd-progress").hidden = false;
      $("cd-bar").value = 0;
      $("cd-progress-text").textContent = t("tool.progress", { n: fmtNum(total) });
      computeAsync(j, oldRows, newRows, keyIdxOld, keyIdxNew, function (O, N) {
        if (j.cancelled) return;
        job = null; $("cd-progress").hidden = true;
        finish(O, N, valPairs, keyIdxOld, keyIdxNew);
      });
      return;
    }
    var O = buildRowIndex(oldRows, keyIdxOld, opts);
    var N = buildRowIndex(newRows, keyIdxNew, opts);
    finish(O, N, valPairs, keyIdxOld, keyIdxNew);
  }

  function computeAsync(j, oldRows, newRows, kOld, kNew, done) {
    var O = { map: new Map(), order: [], dupes: 0, blanks: 0, emptyKeys: 0 };
    var N = { map: new Map(), order: [], dupes: 0, blanks: 0, emptyKeys: 0 };
    var seqs = [{ st: O, rows: oldRows, keys: kOld }, { st: N, rows: newRows, keys: kNew }];
    var phase = 0, i = 0;
    function indexChunk(st, rows, keys, start, end) {
      for (var r = start; r < end; r++) {
        var partial = buildRowIndex(rows.slice(r, r + 1), keys, opts);
        // 청크 병합
        st.blanks += partial.blanks; st.emptyKeys += partial.emptyKeys;
        partial.order.forEach(function (k) {
          var e = st.map.get(k);
          if (e) { e.count++; st.dupes++; }
          else { st.map.set(k, partial.map.get(k)); st.order.push(k); }
        });
      }
    }
    function step() {
      if (j.cancelled) return;
      var cur = seqs[phase];
      var end = Math.min(i + CHUNK, cur.rows.length);
      indexChunk(cur.st, cur.rows, cur.keys, i, end);
      i = end;
      var doneCount = (phase === 0 ? 0 : oldRows.length) + i;
      $("cd-bar").value = Math.round((doneCount / Math.max(1, oldRows.length + newRows.length)) * 100);
      if (i >= cur.rows.length) { phase++; i = 0; }
      if (phase < seqs.length) setTimeout(step, 0);
      else done(O, N);
    }
    setTimeout(step, 0);
  }

  function finish(O, N, valPairs, keyIdxOld, keyIdxNew) {
    var diff = diffTables(O, N, valPairs, opts);
    lastResult = {
      diff: diff, O: O, N: N, valPairs: valPairs,
      keyIdxOld: keyIdxOld, keyIdxNew: keyIdxNew,
      over: { old: overflow("old"), "new": overflow("new") }
    };
    render(lastResult);
  }

  /* ---- 렌더 ---- */
  function renderSideStats(out) {
    ["old", "new"].forEach(function (side) {
      var el = $("cd-stat-" + side);
      if (!out || !sides[side].table.length) { el.textContent = ""; return; }
      var idx = side === "old" ? out.O : out.N;
      var parts = [t("tool.stat.rows", { n: fmtNum(idx.map.size) })];
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
    var d = out.diff;

    // 경고/안내 블록 — 조용한 실패 금지
    var warn = $("cd-warn");
    warn.innerHTML = "";
    var lines = [];
    var oldN = out.O.map.size, newN = out.N.map.size;
    if (oldN === 0 && newN > 0) lines.push(t("tool.n.oldEmpty"));
    else if (newN === 0 && oldN > 0) lines.push(t("tool.n.newEmpty"));
    else if (d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0 && d.unchanged.length > 0) {
      lines.push(t("tool.n.identical"));
    }
    if (out.over.old) lines.push(t("tool.warn.cap", { file: t("tool.file.old"), n: fmtNum(MAX_ROWS) }));
    if (out.over["new"]) lines.push(t("tool.warn.cap", { file: t("tool.file.new"), n: fmtNum(MAX_ROWS) }));
    if (out.O.dupes) lines.push(t("tool.warn.dupes", { file: t("tool.file.old"), n: fmtNum(out.O.dupes) }));
    if (out.N.dupes) lines.push(t("tool.warn.dupes", { file: t("tool.file.new"), n: fmtNum(out.N.dupes) }));
    if (out.O.emptyKeys) lines.push(t("tool.warn.emptyKeys", { file: t("tool.file.old"), n: fmtNum(out.O.emptyKeys) }));
    if (out.N.emptyKeys) lines.push(t("tool.warn.emptyKeys", { file: t("tool.file.new"), n: fmtNum(out.N.emptyKeys) }));
    if (lines.length) {
      warn.innerHTML = '<div class="cd-warn">' + lines.map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("") + "</div>";
    }

    // 요약
    $("cd-summary").textContent = t("tool.summary", {
      a: fmtNum(d.added.length), r: fmtNum(d.removed.length),
      c: fmtNum(d.changed.length), u: fmtNum(d.unchanged.length),
      n: fmtNum(out.O.map.size + d.added.length)
    });

    // 탭 배지
    $("cd-cnt-added").textContent = fmtNum(d.added.length);
    $("cd-cnt-removed").textContent = fmtNum(d.removed.length);
    $("cd-cnt-changed").textContent = fmtNum(d.changed.length);
    $("cd-cnt-unchanged").textContent = fmtNum(d.unchanged.length);

    renderPanel();
  }

  function keyNames() {
    return lastResult.keyIdxOld.map(function (oi, i) {
      var p = null;
      columns.pairs.forEach(function (pp) { if (pp.old === oi && pp["new"] === lastResult.keyIdxNew[i]) p = pp; });
      return p ? p.name : t("tool.th.key");
    });
  }
  function valNames() { return lastResult.valPairs.map(function (p) { return p.name; }); }

  function activeRows() { return lastResult ? (lastResult.diff[tab] || []) : []; }

  function renderPanel() {
    if (!lastResult) return;
    var rows = activeRows();
    $("cd-panel-count").textContent = t("tool.panelCount", { n: fmtNum(rows.length) });
    var kNames = keyNames(), vNames = valNames();
    var html, headCells;

    if (tab === "changed") {
      headCells = kNames.concat([t("tool.th.col"), t("tool.th.old"), t("tool.th.new")]);
      html = "<thead><tr><th class=\"cd-num\">#</th>" + headCells.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") + "</tr></thead><tbody>";
      if (!rows.length) {
        html += "<tr><td colspan=\"" + (headCells.length + 1) + "\" class=\"cd-empty\">" + esc(t("tool.emptyPanel")) + "</td></tr>";
      } else {
        var shownC = 0, ri;
        for (ri = 0; ri < rows.length && shownC < TABLE_CAP; ri++) {
          var rec = rows[ri];
          var kcells = lastResult.keyIdxNew.map(function (ni) { return rec.newCells[ni]; });
          for (var di = 0; di < rec.diffs.length && shownC < TABLE_CAP; di++) {
            var ch = rec.diffs[di];
            html += "<tr><td class=\"cd-num\">" + (shownC + 1) + "</td>" +
              kcells.map(function (kc) { return "<td>" + esc(kc) + "</td>"; }).join("") +
              "<td>" + esc(ch.name) + "</td><td class=\"cd-old\">" + esc(ch.old) + "</td><td class=\"cd-new\">" + esc(ch["new"]) + "</td></tr>";
            shownC++;
          }
        }
      }
      html += "</tbody>";
    } else {
      var cols = kNames.concat(vNames);
      var side = tab === "removed" ? "oldCells" : "cells";
      headCells = cols;
      html = "<thead><tr><th class=\"cd-num\">#</th>" + headCells.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") + "</tr></thead><tbody>";
      if (!rows.length) {
        html += "<tr><td colspan=\"" + (headCells.length + 1) + "\" class=\"cd-empty\">" + esc(t("tool.emptyPanel")) + "</td></tr>";
      } else {
        var idxs = lastResult.keyIdxNew, vpairs = lastResult.valPairs;
        var useOld = tab === "removed";
        var keyI = useOld ? lastResult.keyIdxOld : lastResult.keyIdxNew;
        var shown = Math.min(rows.length, TABLE_CAP);
        for (var i = 0; i < shown; i++) {
          var cells = rows[i].cells;
          var line = keyI.map(function (ki) { return "<td>" + esc(cells[ki]) + "</td>"; }).join("");
          line += vpairs.map(function (p) { var ci = useOld ? p.old : p["new"]; return "<td>" + esc(ci >= 0 ? cells[ci] : "") + "</td>"; }).join("");
          html += "<tr><td class=\"cd-num\">" + (i + 1) + "</td>" + line + "</tr>";
        }
      }
      html += "</tbody>";
    }
    $("cd-tbl").innerHTML = html;

    var trunc = $("cd-trunc");
    var screenRows = tab === "changed"
      ? rows.reduce(function (a, r) { return a + r.diffs.length; }, 0)
      : rows.length;
    if (screenRows > TABLE_CAP) {
      trunc.hidden = false;
      trunc.textContent = t("tool.trunc", { shown: fmtNum(TABLE_CAP), total: fmtNum(screenRows) });
    } else { trunc.hidden = true; }
  }

  function showTab(k) {
    tab = k;
    ["added", "removed", "changed", "unchanged"].forEach(function (x) {
      $("cd-tab-" + x).setAttribute("aria-selected", x === k ? "true" : "false");
    });
    renderPanel();
  }

  /* ---- 출력: CSV / 클립보드 ---- */
  function panelMatrix(which) {
    var d = lastResult.diff, out = [], kNames = keyNames(), vNames = valNames();
    if (which === "changed") {
      out.push(kNames.concat([t("tool.th.col"), t("tool.th.old"), t("tool.th.new")]));
      d.changed.forEach(function (rec) {
        var kc = lastResult.keyIdxNew.map(function (ni) { return rec.newCells[ni]; });
        rec.diffs.forEach(function (ch) { out.push(kc.concat([ch.name, ch.old, ch["new"]])); });
      });
    } else {
      out.push(kNames.concat(vNames));
      var useOld = which === "removed";
      var keyI = useOld ? lastResult.keyIdxOld : lastResult.keyIdxNew;
      d[which].forEach(function (rec) {
        var cells = rec.cells;
        var line = keyI.map(function (ki) { return cells[ki]; });
        lastResult.valPairs.forEach(function (p) { var ci = useOld ? p.old : p["new"]; line.push(ci >= 0 ? cells[ci] : ""); });
        out.push(line);
      });
    }
    return out;
  }

  /* 통합 CSV — 모든 행 + _status 열. added/changed/unchanged 는 New, removed 는 Old 셀. */
  function combinedMatrix() {
    var d = lastResult.diff, kNames = keyNames(), vNames = valNames();
    var head = kNames.concat(vNames).concat(["_status"]);
    var out = [head];
    function pushRows(list, status, useOld) {
      var keyI = useOld ? lastResult.keyIdxOld : lastResult.keyIdxNew;
      list.forEach(function (rec) {
        var cells = rec.cells || (useOld ? rec.oldCells : rec.newCells);
        var line = keyI.map(function (ki) { return cells[ki]; });
        lastResult.valPairs.forEach(function (p) { var ci = useOld ? p.old : p["new"]; line.push(ci >= 0 ? cells[ci] : ""); });
        line.push(status);
        out.push(line);
      });
    }
    pushRows(d.added, "added", false);
    pushRows(d.removed, "removed", true);
    // changed: New 값 기준
    d.changed.forEach(function (rec) {
      var line = lastResult.keyIdxNew.map(function (ki) { return rec.newCells[ki]; });
      lastResult.valPairs.forEach(function (p) { line.push(p["new"] >= 0 ? rec.newCells[p["new"]] : ""); });
      line.push("changed"); out.push(line);
    });
    pushRows(d.unchanged, "unchanged", false);
    return out;
  }

  function flash(msg) {
    var s = $("cd-status");
    s.hidden = false; s.textContent = msg;
    setTimeout(function () { s.hidden = true; }, 1800);
  }
  function downloadCSV(rows, suffix) {
    var blob = new Blob(["﻿" + toCSV(rows)], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = SLUG + "-" + suffix + "-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    flash(t("tool.downloaded"));
  }

  $("cd-csv").addEventListener("click", function () { if (lastResult) downloadCSV(panelMatrix(tab), tab); });
  $("cd-csv-all").addEventListener("click", function () { if (lastResult) downloadCSV(combinedMatrix(), "combined"); });
  $("cd-copy").addEventListener("click", function () {
    if (!lastResult) return;
    var text = panelMatrix(tab).map(function (r) {
      return r.map(function (v) { return String(v == null ? "" : v).replace(/[\t\r\n]/g, " "); }).join("\t");
    }).join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash(t("tool.copied")); }, function () { flash(t("tool.copyFail")); });
    } else { flash(t("tool.copyFail")); }
  });

  /* ---- 입력 처리 ---- */
  function afterParse(side) {
    var s = sides[side];
    if (!s.table.length) return;
    s.hasHeader = looksLikeHeader(s.table, s.width);
    $("cd-header-" + side).checked = s.hasHeader;
  }

  function refreshColumns(fromSaved) {
    var saved = fromSaved ? load(K_CFG, null) : null;
    if (saved && saved.sig === cfgSig()) {
      sides.old.hasHeader = !!saved.oldHeader; sides["new"].hasHeader = !!saved.newHeader;
      $("cd-header-old").checked = sides.old.hasHeader; $("cd-header-new").checked = sides["new"].hasHeader;
      buildColumns(saved.pairs);
      keySel = (saved.keySel || []).filter(function (i) { return columns.pairs[i] && columns.pairs[i].old >= 0 && columns.pairs[i]["new"] >= 0; });
      recommendKey();
      if (!keySel.length) autoSelectKey();
    } else {
      buildColumns(null);
      recommendKey();
      autoSelectKey();
    }
    renderConfig();
  }

  function setSideText(side, text, fromBytes) {
    var s = sides[side];
    var parsed = parseText(text);
    var table = parsed.table.filter(function (r, i) {
      return !(r.length === 1 && r[0].trim() === "" && i === parsed.table.length - 1);
    });
    s.table = table; s.width = parsed.width;
    if (!fromBytes) { s.bytes = null; $("cd-enc-" + side).hidden = true; }
    afterParse(side);
    refreshColumns(true);
    run();
  }

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

  function applyBytes(side, buf, enc) {
    var s = sides[side];
    s.bytes = buf;
    var r = enc ? { text: decode(new Uint8Array(buf), enc), enc: enc, sure: true } : decodeSmart(buf);
    if (r.text == null) { setMsg(esc(t("tool.n.decode")), true); return; }
    s.enc = r.enc;
    s.el.paste.value = r.text.length > 1000000 ? r.text.slice(0, 1000000) : r.text;
    var banner = $("cd-enc-" + side);
    var garbled = r.text.indexOf("�") >= 0;
    if (garbled || !r.sure || r.enc === "euc-kr") {
      banner.hidden = false;
      $("cd-enc-" + side + "-text").textContent = r.enc === "euc-kr" ? t("tool.enc.cp949") : t("tool.enc.broken");
      $("cd-enc-" + side + "-btn").textContent = r.enc === "euc-kr" ? t("tool.enc.back") : t("tool.enc.retry");
    } else { banner.hidden = true; }
    setSideText(side, s.el.paste.value, true);
  }

  function readFile(side, file) {
    if (!file) return;
    if (file.size > HUGE_FILE) {
      if (!window.confirm(t("tool.confirm.huge", { n: fmtNum(Math.round(file.size / 1048576)) }))) return;
    } else if (file.size > BIG_FILE) {
      flash(t("tool.warn.bigFile", { n: fmtNum(Math.round(file.size / 1048576)) }));
    }
    var fr = new FileReader();
    fr.onload = function () { applyBytes(side, fr.result, null); };
    fr.onerror = function () { setMsg(esc(t("tool.n.read")), true); };
    fr.readAsArrayBuffer(file);
  }

  /* ---- side 별 이벤트 바인딩 ---- */
  ["old", "new"].forEach(function (side) {
    var s = sides[side];
    s.el.paste = $("cd-paste-" + side);
    var timer = null;
    s.el.paste.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        s.bytes = null; $("cd-enc-" + side).hidden = true;
        setSideText(side, s.el.paste.value, false);
      }, 200);
    });
    var dz = $("cd-drop-" + side);
    ["dragenter", "dragover"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("is-over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("is-over"); });
    });
    dz.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) readFile(side, e.dataTransfer.files[0]);
    });
    $("cd-pick-" + side).addEventListener("click", function () { $("cd-file-" + side).click(); });
    $("cd-file-" + side).addEventListener("change", function (e) {
      if (e.target.files && e.target.files.length) readFile(side, e.target.files[0]);
      e.target.value = "";
    });
    $("cd-enc-" + side + "-btn").addEventListener("click", function () {
      if (!s.bytes) return;
      applyBytes(side, s.bytes, s.enc === "euc-kr" ? "utf-8" : "euc-kr");
    });
    $("cd-header-" + side).addEventListener("change", function () {
      s.hasHeader = $("cd-header-" + side).checked;
      buildColumns(null); recommendKey(); autoSelectKey();
      persistCfg(); renderConfig(); run();
    });
  });

  /* ---- 옵션·프리셋·버튼 이벤트 ---- */
  $("cd-preset").addEventListener("change", function () { applyPreset($("cd-preset").value); recommendKey(); renderConfig(); run(); });
  ["cd-tol", "cd-tol-mode", "cd-dord"].forEach(function (id) {
    $(id).addEventListener("input", function () {
      opts = readOpts();
      save(K_OPTS, { preset: preset, opts: opts });
      run();
    });
  });
  ALL_OPT_KEYS.forEach(function (k) {
    $(OPT_EL[k]).addEventListener("change", function () {
      opts = readOpts();
      save(K_OPTS, { preset: preset, opts: opts });
      recommendKey(); renderConfig(); run();
    });
  });

  $("cd-sample").addEventListener("click", function () {
    sides.old.el.paste.value = t("tool.sample.old");
    sides["new"].el.paste.value = t("tool.sample.new");
    sides.old.bytes = null; sides["new"].bytes = null;
    $("cd-enc-old").hidden = true; $("cd-enc-new").hidden = true;
    setSideText("old", sides.old.el.paste.value, false);
    setSideText("new", sides["new"].el.paste.value, false);
  });
  $("cd-swap").addEventListener("click", function () {
    var ov = sides.old.el.paste.value, nv = sides["new"].el.paste.value;
    sides.old.el.paste.value = nv; sides["new"].el.paste.value = ov;
    sides.old.bytes = null; sides["new"].bytes = null;
    $("cd-enc-old").hidden = true; $("cd-enc-new").hidden = true;
    setSideText("old", nv, false);
    setSideText("new", ov, false);
  });
  $("cd-clear").addEventListener("click", function () {
    ["old", "new"].forEach(function (side) {
      sides[side].el.paste.value = "";
      sides[side].table = []; sides[side].width = 1; sides[side].bytes = null; sides[side].hasHeader = false;
      $("cd-enc-" + side).hidden = true; $("cd-stat-" + side).textContent = "";
    });
    columns = { pairs: [], needsMap: false }; keySel = []; keyReco = null; lastResult = null;
    $("cd-keys").hidden = true; $("cd-map").hidden = true;
    setMsg(esc(t("tool.n.empty")));
  });
  $("cd-cancel").addEventListener("click", function () {
    if (job) { job.cancelled = true; job = null; }
    $("cd-progress").hidden = true;
    setMsg(esc(t("tool.canceled")), true);
  });
  ["added", "removed", "changed", "unchanged"].forEach(function (k) {
    $("cd-tab-" + k).addEventListener("click", function () { showTab(k); });
  });

  /* ---- 초기화 ---- */
  applyPreset(detectPreset());
  showTab("changed");
  setMsg(esc(t("tool.n.empty")));

  // 언어 전환 — 키/매핑 UI·표 헤더·안내가 따라간다
  document.addEventListener("i18n:change", function () {
    if (columns.pairs.length) renderConfig();
    if (lastResult) render(lastResult); else setMsg(esc(t("tool.n.empty")));
  });
  // TOOLJS:END
})();
