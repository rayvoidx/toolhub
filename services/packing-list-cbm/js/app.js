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
  // packing-list-cbm — 패킹리스트 일괄 CBM · 부피중량 · 청구 CW · R/T · 컨테이너 적재
  // (spec: factory/state/packing-list-cbm.yaml)
  //
  // 흐름: 붙여넣기(엑셀 TSV) 또는 CSV 드롭 → 자체 RFC4180 파서 → 컬럼 매핑 '제안' →
  //       사용자 [확정] → 순수 산술 집계. 추측만으로 계산하지 않는다.
  // 외부 호출 0 · 업로드 0 · 의존성 0. 패킹리스트 원본은 어디에도 저장하지 않는다.
  // 저장은 localStorage("<slug>:prefs" = 단위·모드·적재계수, "<slug>:map" = 직전 컬럼 매핑) 뿐.

  /* ============================================================
     PURE:START — DOM·I18N 비의존 순수 로직.
     이 블록은 원본이 하나이며 세 곳이 같은 소스를 쓴다:
       (1) 브라우저 메인스레드 (아래 UI 코드가 직접 호출)
       (2) Web Worker  — workerSource() 가 Function.prototype.toString() 으로 직렬화
       (3) node 단위테스트 — PURE:START/END 마커로 추출해 eval
     따라서 이 안에서는 window·document·localStorage 를 절대 참조하지 않는다.
     ============================================================ */
  var CM_PER = { cm: 1, mm: 0.1, m: 100, "in": 2.54 };      // → cm
  var KG_PER = { kg: 1, lb: 0.45359237 };                    // → kg
  var CFT_PER_CBM = 35.3146667;                              // 1 CBM = 35.3147 cu ft
  var DIVISOR = { air: 6000, courier: 5000, road: 3000, ocean: null }; // 부피중량 제수 (해상은 해당 없음)
  /* ISO 668 공칭 내부 용적/페이로드 — 국제표준(정적). 선사·도로규제별 실제값은 다르며 각주로 고지한다. */
  var CONTAINERS = [
    { id: "20ft", cbm: 33.2, payload: 28200 },
    { id: "40ft", cbm: 67.7, payload: 26700 },
    { id: "40hq", cbm: 76.3, payload: 26500 }
  ];
  var MAX_ROWS = 200000;   // 초과분은 잘라내고 명시적으로 경고 (조용한 절단 금지)
  var PREVIEW_ROWS = 5;
  var HEAD_BYTES = 65536;
  // 숫자 셀: 천단위 콤마 제거 후 '숫자 + (선택)단위토큰' 만 인정. 그 외는 NaN → '제외된 행' 으로 노출.
  var NUM_RE_SRC = "^([-+]?\\d*\\.?\\d+)(cm|mm|m|inches|inch|in|\"|kgs|kg|g|lbs|lb|ea|pcs|pc|ctns|ctn|boxes|box)?$";
  var NUM_RE = new RegExp(NUM_RE_SRC, "i");
  var CYL_RE_SRC = "cyl|round|drum|tube|roll|원통|원형|둥근|円筒|円柱|圆柱|圆筒";
  var CYL_RE = new RegExp(CYL_RE_SRC, "i");
  /* 헤더 자동추정 규칙 — 순서가 우선순위. 지원 14개 언어의 실무 표기를 함께 인식한다
     (docs/I18N.md: 기능과 언어는 한 몸 — 헤더가 현지어여도 제안이 나와야 한다).
     결과는 어디까지나 '제안' 이고 사용자가 확정해야 계산이 시작된다. */
  var MAP_RULES = [
    ["shape", "^shape$|^form$|형상|모양|형태|形状|forma|forme|bentuk|شكل"],
    ["qty", "q'?ty|quantity|^qty|ctns?|cartons?|boxes|packages|pkgs|^pcs$|^ea$|수량|박스|카톤|상자|개수|箱数|件数|数量|cajas|bultos|kisten|kartons|caixas|volumes|коробк|кол-во|количество|dus|jumlah|كرتون|عدد|कार्टन|मात्रा|কার্টন|পরিমাণ|کارٹن|تعداد"],
    ["wgt", "weight|^g\\.?w\\.?$|^n\\.?w\\.?$|gross|net|^kgs?$|^lbs?$|중량|무게|重量|peso|poids|gewicht|вес|масса|berat|وزن|वजन|ওজন"],
    ["len", "^l$|^l[\\s._-]|length|^len$|길이|가로|长|長|奥行|largo|longitud|longueur|comprimento|comprim|länge|lange|длина|panjang|طول|लंबाई|দৈর্ঘ্য|لمبائی"],
    ["wid", "^w$|^w[\\s._-]|width|^wid$|폭|너비|세로|宽|幅|ancho|anchura|largeur|largura|breite|ширина|lebar|عرض|चौड़ाई|প্রস্থ|چوڑائی"],
    ["hei", "^h$|^h[\\s._-]|height|^hgt$|^ht$|높이|高|高さ|alto|altura|hauteur|höhe|hohe|высота|tinggi|ارتفاع|ऊंचाई|উচ্চতা|اونچائی"],
    ["name", "item|desc|product|goods|model|article|commodity|품목|품명|제품|상품|이름|名称|品名|artículo|articulo|produto|mercancía|artikel|товар|наименование|barang|صنف|بضاعة|वस्तु|उत्पाद|পণ্য|شے"]
  ];
  var MAP_RES = buildRules(MAP_RULES);
  var FIELDS = ["name", "qty", "len", "wid", "hei", "wgt", "shape"];

  function buildRules(rules) {
    var out = [];
    for (var i = 0; i < rules.length; i++) out.push({ f: rules[i][0], re: new RegExp(rules[i][1], "i") });
    return out;
  }

  /* ---- 셀 파싱: "1,234.5" · "50cm" · "22.5 kg" 은 인정, "abc" · "12x34" 는 NaN.
         단위 토큰이 붙어 있으면 그대로 돌려준다 — 자동 변환하지 않고 경고에만 쓴다(spec). ---- */
  function parseCell(str) {
    var raw = str == null ? "" : String(str);
    var s = raw.replace(/[\s ]/g, "").replace(/,/g, "");
    if (s === "") return { v: NaN, unit: null, raw: raw, empty: true };
    var m = NUM_RE.exec(s);
    if (!m) return { v: NaN, unit: null, raw: raw, empty: false };
    var u = m[2] ? m[2].toLowerCase() : null;
    if (u === "inch" || u === "inches" || u === "\"") u = "in";
    else if (u === "kgs") u = "kg";
    else if (u === "lbs") u = "lb";
    else if (u === "ea" || u === "pcs" || u === "pc" || u === "ctn" || u === "ctns" ||
             u === "box" || u === "boxes") u = null; // 개수 단위는 치수·중량 단위가 아니다
    return { v: parseFloat(m[1]), unit: u, raw: raw, empty: false };
  }

  /* ---- RFC4180 파서 (스트리밍 상태머신) — 따옴표·이스케이프("")·셀 내 개행·CRLF 처리.
         push() 를 여러 번 나눠 호출해도 청크 경계에서 상태가 유지된다. ---- */
  function createRowParser(delim) {
    var st = 0;          // 0=비인용, 1=인용, 2=인용중 따옴표 목격(이스케이프/종료 미정)
    var field = "", row = [], rows = [], wasCR = false;
    function endField() { row.push(field); field = ""; }
    function endRow() { endField(); rows.push(row); row = []; }
    return {
      push: function (chunk) {
        for (var i = 0; i < chunk.length; i++) {
          var c = chunk.charAt(i);
          if (st === 1) { if (c === "\"") st = 2; else field += c; wasCR = false; continue; }
          if (st === 2) {
            if (c === "\"") { field += "\""; st = 1; wasCR = false; continue; }
            st = 0; // 인용 종료 — 이 문자는 비인용 규칙으로 이어서 처리
          }
          var cr = wasCR; wasCR = false;
          if (c === "\n") { if (cr) continue; endRow(); continue; }
          if (c === "\r") { endRow(); wasCR = true; continue; }
          if (c === delim) { endField(); continue; }
          if (c === "\"" && field === "") { st = 1; continue; }
          field += c;
        }
      },
      drain: function () { var out = rows; rows = []; return out; },
      end: function () {
        if (field !== "" || row.length) endRow();
        var out = rows; rows = []; return out;
      },
      openQuote: function () { return st === 1; }
    };
  }

  function parseAll(text, delim, limit) {
    var p = createRowParser(delim);
    p.push(text);
    var rows = p.drain();
    var tail = p.end();
    for (var i = 0; i < tail.length; i++) rows.push(tail[i]);
    if (limit && rows.length > limit) rows = rows.slice(0, limit);
    return rows;
  }

  function isBlankRow(r) {
    for (var i = 0; i < r.length; i++) if (String(r[i]).replace(/[\s ]/g, "") !== "") return false;
    return true;
  }

  /* ---- 구분자 자동추정: 후보별로 시험 파싱 후 '컬럼 수가 크고 일정한' 쪽을 고른다 ---- */
  function sniffDelimiter(text) {
    var head = text.slice(0, 20000);
    var cands = ["\t", ",", ";", "|"];
    var best = "\t", bestScore = -1;
    for (var i = 0; i < cands.length; i++) {
      var rows = parseAll(head, cands[i], 30), counts = {}, n = 0;
      for (var r = 0; r < rows.length; r++) {
        if (isBlankRow(rows[r])) continue;
        counts[rows[r].length] = (counts[rows[r].length] || 0) + 1; n++;
      }
      if (!n) continue;
      var top = 0, topLen = 0;
      for (var k in counts) if (counts.hasOwnProperty(k) && counts[k] > top) { top = counts[k]; topLen = +k; }
      if (topLen < 2) continue;
      var score = topLen * (top / n);
      if (score > bestScore) { bestScore = score; best = cands[i]; }
    }
    return bestScore < 0 ? "\t" : best;
  }

  function normHeader(s) {
    return String(s == null ? "" : s)
      .replace(/\([^)]*\)/g, " ")     // "Weight(kg)" → "Weight"
      .replace(/[\[\]{}]/g, " ")
      .replace(/[\s ]+/g, " ")
      .trim().toLowerCase();
  }

  /* 첫 행이 헤더인가: 비어있지 않은 셀의 과반이 숫자가 아니면 헤더로 본다 */
  function detectHeaderRow(rows) {
    if (!rows.length) return false;
    var r = rows[0], nonEmpty = 0, nonNum = 0;
    for (var i = 0; i < r.length; i++) {
      var c = parseCell(r[i]);
      if (c.empty) continue;
      nonEmpty++;
      if (isNaN(c.v)) nonNum++;
    }
    return nonEmpty > 0 && nonNum * 2 > nonEmpty;
  }

  function emptyMap() {
    var m = {};
    for (var i = 0; i < FIELDS.length; i++) m[FIELDS[i]] = -1;
    return m;
  }

  /* ---- 컬럼 매핑 '제안'. 헤더가 있으면 정규식, 없으면 흔한 자릿수 배치.
         반환 .by = "header" | "position" | "none" — UI 가 근거를 문구로 밝힌다. ---- */
  function autoMap(headers, colCount) {
    var m = emptyMap();
    if (headers) {
      for (var c = 0; c < headers.length; c++) {
        var h = normHeader(headers[c]);
        if (!h) continue;
        for (var r = 0; r < MAP_RES.length; r++) {
          var rule = MAP_RES[r];
          if (m[rule.f] === -1 && rule.re.test(h)) { m[rule.f] = c; break; }
        }
      }
      if (m.len >= 0 && m.hei >= 0) { m.by = "header"; return m; }
    }
    var pos = null;
    if (colCount === 6) pos = { name: 0, qty: 1, len: 2, wid: 3, hei: 4, wgt: 5 };
    else if (colCount === 5) pos = { qty: 0, len: 1, wid: 2, hei: 3, wgt: 4 };
    else if (colCount === 4) pos = { len: 0, wid: 1, hei: 2, wgt: 3 };
    if (pos) {
      var p = emptyMap();
      for (var k in pos) if (pos.hasOwnProperty(k)) p[k] = pos[k];
      p.by = "position";
      return p;
    }
    m.by = "none";
    return m;
  }

  function implausibleDim(v, unit) {
    // 20ft 컨테이너 내부 길이(약 5.9 m)를 크게 넘는 '한 박스' 치수 → 단위 오지정 의심
    if (unit === "cm") return v > 1300;
    if (unit === "mm") return v > 13000;
    if (unit === "m") return v > 13;
    if (unit === "in") return v > 240;
    return false;
  }

  function ceilHalf(kg) { return Math.ceil(kg * 2 - 1e-9) / 2; }   // 항공 관행: 0.5kg 올림

  function containerPlan(cbm, actualKg, loadFactor) {
    var out = [];
    for (var i = 0; i < CONTAINERS.length; i++) {
      var c = CONTAINERS[i];
      var byVol = Math.ceil(cbm / (c.cbm * loadFactor) - 1e-9);
      var byWt = actualKg == null ? null : Math.ceil(actualKg / c.payload - 1e-9);
      var need = byWt == null ? byVol : Math.max(byVol, byWt);
      if (need < 0) need = 0;
      var reason = byWt == null ? "vol" : (byWt > byVol ? "wt" : (byVol > byWt ? "vol" : "both"));
      out.push({
        id: c.id, cap: c.cbm, payload: c.payload,
        need: need, byVol: byVol, byWt: byWt, reason: reason,
        eff: need > 0 ? cbm / (need * c.cbm) * 100 : 0
      });
    }
    return out;
  }

  function cellAt(row, idx) { return idx != null && idx >= 0 && idx < row.length ? row[idx] : ""; }

  /* ---- 집계. 행당 O(1) 순수 산술.
         제외 사유는 행번호·원본값과 함께 전부 돌려준다 — 버리는 행은 없다(철칙 5). ---- */
  function computeAll(rows, map, opts) {
    var divisor = opts.divisor || null;
    var dimK = CM_PER[opts.dimUnit] || 1;
    var wtK = KG_PER[opts.wtUnit] || 1;
    var loadFactor = opts.loadFactor || 0.85;
    var hasWgtCol = map.wgt != null && map.wgt >= 0;
    var items = [], excluded = [];
    var blank = 0, qtyAssumed = 0, unitWarn = false;
    var totCbm = 0, totAct = 0, totBoxes = 0, totRowCw = 0;

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var rowNo = i + 1 + (opts.rowOffset || 0);
      if (isBlankRow(r)) { blank++; continue; }

      var shape = opts.shape === "cylinder" ? "cylinder" : "cuboid";
      if (map.shape != null && map.shape >= 0) {
        shape = CYL_RE.test(String(cellAt(r, map.shape))) ? "cylinder" : "cuboid";
      }
      var needWid = shape !== "cylinder";

      var pl = parseCell(cellAt(r, map.len));
      var ph = parseCell(cellAt(r, map.hei));
      var pw = needWid ? parseCell(cellAt(r, map.wid)) : null;
      var dims = needWid ? [pl, pw, ph] : [pl, ph];

      var bad = null, badRaw = "";
      for (var d = 0; d < dims.length; d++) {
        var pc = dims[d];
        if (pc.unit && CM_PER[pc.unit] && pc.unit !== opts.dimUnit) unitWarn = true;
        if (!isNaN(pc.v) && implausibleDim(pc.v, opts.dimUnit)) unitWarn = true;
        if (bad) continue;
        if (pc.empty || isNaN(pc.v)) { bad = "dim"; badRaw = pc.raw; }
        else if (pc.v <= 0) { bad = "dimZero"; badRaw = pc.raw; }
      }

      var qty = 1, assumed = false;
      if (map.qty != null && map.qty >= 0) {
        var pq = parseCell(cellAt(r, map.qty));
        if (pq.empty) assumed = true;
        else if (isNaN(pq.v) || pq.v <= 0) { if (!bad) { bad = "qty"; badRaw = pq.raw; } }
        else qty = pq.v;
      } else assumed = true;

      var act = null;
      if (hasWgtCol) {
        var pg = parseCell(cellAt(r, map.wgt));
        if (pg.unit && (KG_PER[pg.unit] || pg.unit === "g") && pg.unit !== opts.wtUnit) unitWarn = true;
        if (pg.empty || isNaN(pg.v)) { if (!bad) { bad = "weight"; badRaw = pg.raw; } }
        else if (pg.v <= 0) { if (!bad) { bad = "weightZero"; badRaw = pg.raw; } }
        else act = pg.v * wtK * qty;
      }

      if (bad) { excluded.push({ n: rowNo, reason: bad, raw: badRaw, cells: r.slice(0, 8) }); continue; }
      if (assumed) qtyAssumed++;

      var Lc = pl.v * dimK, Hc = ph.v * dimK, Wc = needWid ? pw.v * dimK : 0;
      var one = shape === "cylinder" ? Math.PI * (Lc / 2) * (Lc / 2) * Hc : Lc * Wc * Hc;
      var cbm = one / 1e6 * qty;
      var vol = divisor ? cbm * 1e6 / divisor : null;
      var cw = (act != null && vol != null) ? Math.max(act, vol) : null;

      items.push({
        n: rowNo, name: String(cellAt(r, map.name) || ""), qty: qty, shape: shape,
        cbm: cbm, cft: cbm * CFT_PER_CBM, actual: act, vol: vol, cw: cw
      });
      totCbm += cbm; totBoxes += qty;
      if (act != null) totAct += act;
      if (cw != null) totRowCw += ceilHalf(cw);
    }

    var hasWeight = hasWgtCol && items.length > 0;
    var totVol = divisor ? totCbm * 1e6 / divisor : null;
    // 청구 CW = 선적 합계 기준 max(총실중량, 총부피중량). 행별 CW 합계와 다른 것이 정상.
    var cwBill = (hasWeight && totVol != null) ? ceilHalf(Math.max(totAct, totVol)) : null;
    var rt = null;
    if (hasWeight) {
      rt = Math.max(totCbm, totAct / 1000);
      if (opts.minRT && rt < 1) rt = 1;
    }
    return {
      items: items, excluded: excluded, blank: blank, qtyAssumed: qtyAssumed,
      unitWarn: unitWarn, hasWeight: hasWeight, hasWgtCol: hasWgtCol, divisor: divisor,
      totals: {
        boxes: totBoxes, cbm: totCbm, cft: totCbm * CFT_PER_CBM,
        actual: hasWeight ? totAct : null, vol: totVol,
        cwBill: cwBill, cwRowSum: (hasWeight && divisor) ? totRowCw : null, rt: rt
      },
      containers: containerPlan(totCbm, hasWeight ? totAct : null, loadFactor)
    };
  }

  function parseAndCompute(text, delim, hasHeader, map, opts) {
    var cap = MAX_ROWS + (hasHeader ? 1 : 0);
    var rows = parseAll(text, delim);
    var truncated = rows.length > cap;
    if (truncated) rows = rows.slice(0, cap);
    var headers = hasHeader ? rows.shift() : null;
    var o = {};
    for (var k in opts) if (opts.hasOwnProperty(k)) o[k] = opts[k];
    o.rowOffset = hasHeader ? 1 : 0;
    var res = computeAll(rows, map, o);
    res.truncated = truncated;
    res.headers = headers || null;
    return res;
  }

  /* ---- 인코딩: BOM 우선 → UTF-8 디코드에 U+FFFD 가 보이면 euc-kr(CP949) 재시도.
         국내 포워더 엑셀 CSV 대비. 판정은 제안일 뿐이며 UI 에 토글을 상시 노출한다. ---- */
  function decodeBytes(bytes, forceEnc, probeOnly) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var bom = u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF;
    var body = bom ? u8.subarray(3) : u8;
    var enc = forceEnc || null;
    if (!enc) {
      enc = "utf-8";
      if (!bom) {
        // 청크 경계에서 잘린 멀티바이트가 오탐을 내지 않도록 끝 4바이트는 판정에서 제외
        var probe = probeOnly && body.length > 4 ? body.subarray(0, body.length - 4) : body;
        if (new TextDecoder("utf-8").decode(probe).indexOf("�") !== -1) {
          try {
            if (new TextDecoder("euc-kr").decode(probe).indexOf("�") === -1) enc = "euc-kr";
          } catch (e) { /* euc-kr 미지원 환경 → utf-8 유지 */ }
        }
      }
    }
    if (probeOnly) return { text: null, enc: enc, bom: bom };
    return { text: new TextDecoder(enc, { fatal: false }).decode(body), enc: enc, bom: bom };
  }

  function blobBuffer(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(fr.error || new Error("read failed")); };
      fr.readAsArrayBuffer(blob);
    });
  }

  /* ---- 원본 텍스트 확보. 파일은 File.stream() 으로 청크 디코드 —
         대용량에서 ArrayBuffer 전체를 메모리에 상주시키지 않는다.
         (원본 미저장 원칙상 IndexedDB 영속화는 하지 않는다 — privacy.html 공개 약속) ---- */
  function readSourceText(job, onProgress) {
    if (job.text != null) return Promise.resolve({ text: job.text, enc: job.enc || "utf-8" });
    var file = job.file;
    if (!file.stream || typeof file.stream !== "function") {
      return blobBuffer(file).then(function (buf) { return decodeBytes(buf, job.enc); });
    }
    var reader = file.stream().getReader();
    var total = file.size || 0;
    var dec = null, enc = job.enc || null, out = "", read = 0;
    function step() {
      return reader.read().then(function (r) {
        if (r.done) {
          if (dec) out += dec.decode();
          return { text: out, enc: enc || "utf-8" };
        }
        var chunk = r.value;
        read += chunk.length;
        if (!dec) {
          var probe = decodeBytes(chunk, job.enc, true);
          enc = probe.enc;
          dec = new TextDecoder(enc, { fatal: false });
          if (probe.bom) chunk = chunk.subarray(3);
        }
        out += dec.decode(chunk, { stream: true });
        if (onProgress && total) onProgress(read / total);
        return step();
      });
    }
    return step();
  }

  function csvEscape(v) {
    var s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
  }
  function toCSV(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var line = [];
      for (var j = 0; j < rows[i].length; j++) line.push(csvEscape(rows[i][j]));
      out.push(line.join(","));
    }
    return out.join("\r\n");
  }
  function toTSV(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var line = [];
      for (var j = 0; j < rows[i].length; j++) {
        line.push(String(rows[i][j] == null ? "" : rows[i][j]).replace(/[\t\r\n]+/g, " "));
      }
      out.push(line.join("\t"));
    }
    return out.join("\n");
  }

  var PURE_FNS = [buildRules, parseCell, createRowParser, parseAll, isBlankRow, sniffDelimiter,
    normHeader, detectHeaderRow, emptyMap, autoMap, implausibleDim, ceilHalf, containerPlan,
    cellAt, computeAll, parseAndCompute, decodeBytes, blobBuffer, readSourceText,
    csvEscape, toCSV, toTSV];

  /* Worker 소스는 위 순수 함수들을 직렬화해서 만든다 — 로직 사본을 따로 두지 않기 위함.
     (함수 선언은 호이스팅되므로 상수 프리앰블에서 buildRules 를 호출해도 안전) */
  function workerSource() {
    var pre = "\"use strict\";\n" +
      "var CM_PER=" + JSON.stringify(CM_PER) + ",KG_PER=" + JSON.stringify(KG_PER) +
      ",CFT_PER_CBM=" + CFT_PER_CBM + ",DIVISOR=" + JSON.stringify(DIVISOR) +
      ",CONTAINERS=" + JSON.stringify(CONTAINERS) + ",MAX_ROWS=" + MAX_ROWS +
      ",PREVIEW_ROWS=" + PREVIEW_ROWS + ",HEAD_BYTES=" + HEAD_BYTES +
      ",NUM_RE_SRC=" + JSON.stringify(NUM_RE_SRC) + ",NUM_RE=new RegExp(NUM_RE_SRC,\"i\")" +
      ",CYL_RE_SRC=" + JSON.stringify(CYL_RE_SRC) + ",CYL_RE=new RegExp(CYL_RE_SRC,\"i\")" +
      ",MAP_RULES=" + JSON.stringify(MAP_RULES) + ",MAP_RES=buildRules(MAP_RULES)" +
      ",FIELDS=" + JSON.stringify(FIELDS) + ";\n";
    var body = "";
    for (var i = 0; i < PURE_FNS.length; i++) body += PURE_FNS[i].toString() + "\n";
    var boot = "self.onmessage=function(e){var j=e.data;try{" +
      "readSourceText(j,function(p){self.postMessage({t:\"p\",p:p});})" +
      ".then(function(r){var res=parseAndCompute(r.text,j.delim,j.hasHeader,j.map,j.opts);" +
      "res.enc=r.enc;self.postMessage({t:\"d\",res:res});})" +
      ".catch(function(err){self.postMessage({t:\"e\",m:String((err&&err.message)||err)});});" +
      "}catch(err2){self.postMessage({t:\"e\",m:String((err2&&err2.message)||err2)});}};";
    return pre + body + boot;
  }
  /* PURE:END */

  /* ============================================================
     UI — 여기서부터는 DOM/i18n 의존
     ============================================================ */
  var cfg = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "packing-list-cbm";
  var PREFS_KEY = SLUG + ":prefs";
  var MAP_KEY = SLUG + ":map";
  var RENDER_CAP = 200;      // 표는 앞 200행만 그린다 (전체는 CSV 로)
  var WORKER_MIN_BYTES = 1048576;  // 1MB(≈2만 행) 초과 → Worker + 진행률
  var MAX_FILE_BYTES = 52428800;   // 50MB

  var els = {};
  var ids = ["paste", "drop", "file", "pick", "example", "clear", "fname", "mapsec", "delim",
    "encwrap", "enc", "hdr", "preview", "maphint", "confirm", "dim", "dimbadge", "wt", "wtbadge",
    "mode", "shape", "shapenote", "load", "loadout", "minrt", "result"];
  for (var q = 0; q < ids.length; q++) els[ids[q]] = document.getElementById("plc-" + ids[q]);
  if (!els.paste || !els.result) return;

  var S = {
    src: null,          // { kind:"text"|"file", text?, file?, size, name? }
    enc: null, encAuto: true,
    delim: null, delimAuto: true,
    hasHeader: true, headerAuto: true,
    cols: 0, headers: null, preview: [],
    map: null, mapBy: "none",
    sig: null, confirmed: false,
    res: null, job: 0, busy: false,
    unitGuessed: true
  };
  var worker = null, workerURL = null;

  function t(key, vars) {
    var s = null;
    try { s = window.I18N && window.I18N.t ? window.I18N.t(key) : null; } catch (e) { s = null; }
    if (s == null) s = key;
    if (vars) {
      for (var k in vars) if (vars.hasOwnProperty(k)) s = s.split("{" + k + "}").join(String(vars[k]));
    }
    return s;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "\"" ? "&quot;" : "&#39;";
    });
  }
  function lang() { try { return (window.I18N && window.I18N.lang()) || undefined; } catch (e) { return undefined; } }
  function nf(v, d) {
    if (v == null || typeof v !== "number" || !isFinite(v)) return "—";
    try { return v.toLocaleString(lang(), { minimumFractionDigits: d, maximumFractionDigits: d }); }
    catch (e) { return v.toFixed(d); }
  }
  function delimValue(v) { return v === "tab" ? "\t" : v; }
  function delimKey(d) { return d === "\t" ? "tab" : d; }

  /* ---- 설정 저장 (패킹리스트 원본은 저장하지 않는다) ---- */
  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) { p = null; }
    if (!p || typeof p !== "object") return null;
    return p;
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        dim: els.dim.value, wt: els.wt.value, mode: els.mode.value, shape: els.shape.value,
        load: +els.load.value, minrt: !!els.minrt.checked, guessed: S.unitGuessed
      }));
    } catch (e) { /* private mode — 저장만 안 될 뿐 기능은 그대로 */ }
  }
  function saveMap() {
    if (!S.sig || !S.map) return;
    try { localStorage.setItem(MAP_KEY, JSON.stringify({ sig: S.sig, map: S.map })); } catch (e) { /* noop */ }
  }
  function recallMap(sig) {
    try {
      var m = JSON.parse(localStorage.getItem(MAP_KEY) || "null");
      if (m && m.sig === sig && m.map) return m.map;
    } catch (e) { /* noop */ }
    return null;
  }

  /* 브라우저 로케일로 단위 '추정' — 배지를 달아 추정임을 밝히고 사용자가 언제든 덮어쓴다 */
  function guessUnits() {
    var region = "";
    try {
      var l = navigator.languages && navigator.languages.length ? navigator.languages[0] : navigator.language;
      var m = /[-_]([A-Za-z]{2})\b/.exec(String(l || ""));
      if (m) region = m[1].toUpperCase();
    } catch (e) { /* noop */ }
    var imperial = region === "US" || region === "GB";
    return { dim: imperial ? "in" : "cm", wt: imperial ? "lb" : "kg" };
  }
  function setUnitBadges() {
    if (els.dimbadge) els.dimbadge.hidden = !S.unitGuessed;
    if (els.wtbadge) els.wtbadge.hidden = !S.unitGuessed;
  }

  function currentOpts() {
    return {
      dimUnit: els.dim.value, wtUnit: els.wt.value,
      divisor: DIVISOR[els.mode.value] || null,
      shape: els.shape.value, loadFactor: (+els.load.value || 85) / 100,
      minRT: !!els.minrt.checked
    };
  }

  /* ---- 입력 → 미리보기 ---- */
  function setSource(src) {
    S.src = src;
    S.res = null;
    S.confirmed = false;
    S.encAuto = true; S.delimAuto = true; S.headerAuto = true;
    if (els.fname) {
      els.fname.hidden = !(src && src.kind === "file");
      if (src && src.kind === "file") {
        els.fname.textContent = src.name + " · " + nf(Math.round(src.size / 1024), 0) + " KB";
      }
    }
    if (els.encwrap) els.encwrap.hidden = !(src && src.kind === "file");
    if (!src) { S.headers = null; S.preview = []; els.mapsec.hidden = true; render(); return; }
    preview();
  }

  function preview() {
    var src = S.src;
    if (!src) return;
    var p = src.kind === "text"
      ? Promise.resolve({ text: src.text, enc: "utf-8" })
      : blobBuffer(src.file.slice(0, HEAD_BYTES)).then(function (buf) {
          return decodeBytes(buf, S.encAuto ? null : S.enc);
        });
    p.then(function (r) {
      if (S.encAuto) { S.enc = r.enc; if (els.enc) els.enc.value = r.enc; }
      buildPreview(r.text);
    }).catch(function () {
      S.headers = null; S.preview = [];
      els.mapsec.hidden = true;
      showError(t("tool.err.read"));
    });
  }

  function buildPreview(headText) {
    if (S.delimAuto) { S.delim = sniffDelimiter(headText); els.delim.value = delimKey(S.delim); }
    var rows = [];
    var all = parseAll(headText, S.delim, PREVIEW_ROWS + 3);
    for (var i = 0; i < all.length; i++) if (!isBlankRow(all[i])) rows.push(all[i]);
    if (!rows.length) {
      S.headers = null; S.preview = []; S.cols = 0;
      els.mapsec.hidden = true;
      render();
      return;
    }
    if (S.headerAuto) { S.hasHeader = detectHeaderRow(rows); els.hdr.checked = S.hasHeader; }
    var cols = 0;
    for (var j = 0; j < rows.length; j++) if (rows[j].length > cols) cols = rows[j].length;
    S.cols = cols;
    S.headers = S.hasHeader ? rows[0] : null;
    S.preview = (S.hasHeader ? rows.slice(1) : rows).slice(0, PREVIEW_ROWS);

    var sig = (S.hasHeader ? "h:" + rows[0].join("") : "c:" + cols) + "|" + S.cols;
    if (sig !== S.sig) {
      S.sig = sig;
      S.confirmed = false;
      var recalled = recallMap(sig);
      if (recalled) { S.map = recalled; S.mapBy = "recall"; }
      else {
        var am = autoMap(S.headers, cols);
        S.mapBy = am.by; delete am.by;
        S.map = am;
      }
    }
    els.mapsec.hidden = false;
    renderPreview();
    // 컬럼 구조가 그대로면 확정 상태를 유지하고 즉시 재계산 (매번 재확정 요구는 소음)
    if (S.confirmed && mappingReady()) compute();
    else render();
  }

  function renderPreview() {
    var thead = els.preview.tHead, tbody = els.preview.tBodies[0];
    var opts = "";
    var labels = { none: t("tool.f.none"), name: t("tool.f.name"), qty: t("tool.f.qty"),
      len: t("tool.f.len"), wid: t("tool.f.wid"), hei: t("tool.f.hei"),
      wgt: t("tool.f.wgt"), shape: t("tool.f.shape") };
    var h = "<tr>";
    for (var c = 0; c < S.cols; c++) {
      var sel = "";
      for (var f = -1; f < FIELDS.length; f++) {
        var key = f < 0 ? "" : FIELDS[f];
        var on = f < 0 ? notMapped(c) : S.map[key] === c;
        sel += "<option value=\"" + esc(key) + "\"" + (on ? " selected" : "") + ">" +
               esc(f < 0 ? labels.none : labels[key]) + "</option>";
      }
      h += "<th><select class=\"plc-mapsel\" data-col=\"" + c + "\" aria-label=\"" +
           esc(t("tool.map.aria", { n: c + 1 })) + "\">" + sel + "</select></th>";
    }
    h += "</tr>";
    thead.innerHTML = h;

    var b = "";
    if (S.headers) {
      b += "<tr class=\"plc-hdrrow\">";
      for (var hc = 0; hc < S.cols; hc++) b += "<td>" + esc(S.headers[hc] || "") + "</td>";
      b += "</tr>";
    }
    for (var r = 0; r < S.preview.length; r++) {
      b += "<tr>";
      for (var rc = 0; rc < S.cols; rc++) b += "<td>" + esc(S.preview[r][rc] || "") + "</td>";
      b += "</tr>";
    }
    tbody.innerHTML = b;

    var sels = thead.querySelectorAll("select");
    for (var s = 0; s < sels.length; s++) sels[s].addEventListener("change", onMapChange);

    els.maphint.textContent = S.mapBy === "header" ? t("tool.map.hint")
      : S.mapBy === "position" ? t("tool.map.hintPos")
      : S.mapBy === "recall" ? t("tool.map.hintRecall")
      : t("tool.map.hintNone");
    if (els.shapenote) els.shapenote.hidden = !(S.map && S.map.shape >= 0);
  }

  function notMapped(c) {
    for (var i = 0; i < FIELDS.length; i++) if (S.map[FIELDS[i]] === c) return false;
    return true;
  }

  function onMapChange(e) {
    var col = +e.target.getAttribute("data-col");
    var field = e.target.value;
    for (var i = 0; i < FIELDS.length; i++) if (S.map[FIELDS[i]] === col) S.map[FIELDS[i]] = -1;
    if (field) S.map[field] = col;
    S.mapBy = "manual";
    renderPreview();
    saveMap();
    if (S.confirmed) compute();
  }

  function mappingReady() {
    if (!S.map) return false;
    if (S.map.len < 0 || S.map.hei < 0) return false;
    // 폭은 직육면체에만 필요 — '전 행 원통' 일 때만 없어도 된다
    var allCylinder = els.shape.value === "cylinder" && S.map.shape < 0;
    if (!allCylinder && S.map.wid < 0) return false;
    return true;
  }

  /* ---- 계산 ---- */
  function compute() {
    if (!S.src || !mappingReady()) return;
    S.confirmed = true;
    saveMap();
    var job = ++S.job;
    S.busy = true;
    showStatus(t("tool.res.calc"));

    var payload = {
      delim: S.delim, hasHeader: S.hasHeader, map: S.map, opts: currentOpts(),
      enc: S.src.kind === "file" ? S.enc : "utf-8"
    };
    if (S.src.kind === "text") payload.text = S.src.text; else payload.file = S.src.file;
    var big = (S.src.kind === "file" ? S.src.size : S.src.text.length) > WORKER_MIN_BYTES;

    function done(res) {
      if (job !== S.job) return;         // 오래된 작업 결과는 버린다
      S.busy = false; S.res = res; render();
    }
    function fail(msg) {
      if (job !== S.job) return;
      S.busy = false; S.res = null; showError(msg || t("tool.err.read"));
    }
    function onProg(p) {
      if (job !== S.job) return;
      showStatus(t("tool.res.working", { pct: Math.round(p * 100) }));
    }

    if (big && runWorker(payload, onProg, done, function () { runMain(payload, onProg, done, fail); })) return;
    runMain(payload, onProg, done, fail);
  }

  function runMain(payload, onProg, done, fail) {
    readSourceText(payload, onProg).then(function (r) {
      done(parseAndCompute(r.text, payload.delim, payload.hasHeader, payload.map, payload.opts));
    }).catch(function (err) { fail(String((err && err.message) || err)); });
  }

  /* Worker: 실패(CSP·Blob 차단·구형 브라우저)하면 조용히 죽지 말고 메인스레드로 폴백 */
  function runWorker(payload, onProg, done, fallback) {
    try {
      if (typeof Worker !== "function" || typeof Blob !== "function" || !window.URL || !URL.createObjectURL) return false;
      if (!worker) {
        workerURL = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
        worker = new Worker(workerURL);
      }
      worker.onmessage = function (e) {
        var m = e.data || {};
        if (m.t === "p") onProg(m.p);
        else if (m.t === "d") done(m.res);
        else if (m.t === "e") { killWorker(); fallback(); }
      };
      worker.onerror = function () { killWorker(); fallback(); };
      worker.postMessage(payload);
      return true;
    } catch (e) {
      killWorker();
      return false;
    }
  }
  function killWorker() {
    try { if (worker) worker.terminate(); } catch (e) { /* noop */ }
    try { if (workerURL) URL.revokeObjectURL(workerURL); } catch (e) { /* noop */ }
    worker = null; workerURL = null;
  }

  /* ---- 출력 ---- */
  function showStatus(msg) { els.result.innerHTML = "<p class=\"plc-note\">" + esc(msg) + "</p>"; }
  function showError(msg) { els.result.innerHTML = "<p class=\"plc-note\"><strong>" + esc(msg) + "</strong></p>"; }

  function render() {
    if (S.busy) return;
    if (!S.src || (!S.headers && !S.preview.length)) {
      els.result.innerHTML = "<p class=\"plc-note\">" + esc(t("tool.res.empty")) + "</p>";
      return;
    }
    if (!S.confirmed || !S.res) {
      var why = mappingReady() ? t("tool.res.needConfirm") : t("tool.err.nodims");
      els.result.innerHTML = "<p class=\"plc-note\">" + esc(why) + "</p>";
      return;
    }
    var r = S.res, T = r.totals;
    var isOcean = !r.divisor;
    var h = "";

    // 대표값: 항공·특송·트럭 = 청구 CW / 해상 LCL = R/T
    var big, cap, basis;
    if (isOcean) {
      cap = t("tool.res.rt"); big = T.rt == null ? "—" : nf(T.rt, 3);
      basis = T.rt == null ? t("tool.res.basis.noweight") : t("tool.res.basis.rt");
    } else {
      cap = t("tool.res.cw"); big = T.cwBill == null ? "—" : nf(T.cwBill, 1) + " kg";
      basis = T.cwBill == null ? t("tool.res.basis.noweight")
        : t("tool.res.basis.cw", { d: nf(r.divisor, 0) });
    }
    h += "<p class=\"plc-headline\"><span class=\"plc-cap\">" + esc(cap) + "</span>" +
         "<span class=\"plc-big\">" + esc(big) + "</span></p>" +
         "<p class=\"plc-basis\">" + esc(basis) + "</p>";

    // 합계 카드
    h += "<dl class=\"plc-cells\">";
    h += cell(t("tool.t.boxes"), nf(T.boxes, 0));
    h += cell(t("tool.t.cbm"), nf(T.cbm, 3), nf(T.cft, 1) + " " + t("tool.unit.cft"));
    h += cell(t("tool.t.actual"), T.actual == null ? "—" : nf(T.actual, 1) + " kg",
      T.actual == null ? t("tool.noweight") : null);
    h += cell(t("tool.t.vol"), T.vol == null ? "—" : nf(T.vol, 1) + " kg",
      isOcean ? t("tool.t.vol.na") : null);
    h += cell(isOcean ? t("tool.t.cw") : t("tool.t.rt"),
      isOcean ? (T.cwBill == null ? "—" : nf(T.cwBill, 1) + " kg") : (T.rt == null ? "—" : nf(T.rt, 3)),
      isOcean ? t("tool.t.cw.na") : null);
    h += "</dl>";

    // 행별 CW 합계 ≠ 청구 CW — 인컴번트가 놓치는 실무 함정이라 명시적으로 병기
    if (T.cwRowSum != null && T.cwBill != null && Math.abs(T.cwRowSum - T.cwBill) > 0.001) {
      h += "<p class=\"plc-flag\">" + esc(t("tool.t.rowsum.note", { v: nf(T.cwRowSum, 1) })) + "</p>";
    }

    // 컨테이너
    h += "<p class=\"plc-sub2\">" + esc(t("tool.cont.title")) + "</p><div class=\"plc-conts\">";
    var bestEff = -1, bestIdx = -1;
    for (var b = 0; b < r.containers.length; b++) {
      if (r.containers[b].need > 0 && r.containers[b].eff > bestEff) { bestEff = r.containers[b].eff; bestIdx = b; }
    }
    for (var i = 0; i < r.containers.length; i++) {
      var c = r.containers[i];
      h += "<div class=\"plc-cont" + (i === bestIdx ? " is-pick" : "") + "\">" +
           "<h4>" + esc(t("tool.cont." + c.id)) + "</h4>" +
           "<div class=\"plc-need\">" + esc(t("tool.cont.units", { n: nf(c.need, 0) })) + "</div>" +
           "<p>" + esc(c.need > 0 ? t("tool.cont.eff", { p: nf(c.eff, 1) }) : t("tool.cont.zero")) + "</p>" +
           (c.need > 0 ? "<p>" + esc(t("tool.cont.by." + c.reason)) + "</p>" : "") +
           "</div>";
    }
    h += "</div>";

    // 배지·경고
    if (r.unitWarn) h += "<p class=\"plc-flag is-warn\">" + esc(t("tool.units.warn")) + "</p>";
    if (r.qtyAssumed > 0) h += "<p class=\"plc-flag\">" + esc(t("tool.qty1", { n: nf(r.qtyAssumed, 0) })) + "</p>";
    if (r.truncated) h += "<p class=\"plc-flag is-warn\">" + esc(t("tool.trunc", { n: nf(MAX_ROWS, 0) })) + "</p>";
    if (!r.hasWgtCol) h += "<p class=\"plc-flag\">" + esc(t("tool.res.basis.noweight")) + "</p>";

    // 행별 표
    if (!r.items.length) {
      h += "<p class=\"plc-flag is-warn\">" + esc(t("tool.res.none")) + "</p>";
    } else {
      h += "<p class=\"plc-sub2\">" + esc(t("tool.rows.title")) + "</p><div class=\"plc-wrap\"><table><thead><tr>" +
        "<th>#</th><th>" + esc(t("tool.th.item")) + "</th><th>" + esc(t("tool.th.qty")) + "</th>" +
        "<th>" + esc(t("tool.th.cbm")) + "</th><th>" + esc(t("tool.th.cft")) + "</th>" +
        "<th>" + esc(t("tool.th.actual")) + "</th><th>" + esc(t("tool.th.vol")) + "</th>" +
        "<th>" + esc(t("tool.th.cw")) + "</th></tr></thead><tbody>";
      var lim = Math.min(r.items.length, RENDER_CAP);
      for (var k = 0; k < lim; k++) {
        var it = r.items[k];
        h += "<tr><td>" + it.n + "</td><td>" + esc(it.name || "—") + "</td><td>" + nf(it.qty, 0) + "</td>" +
             "<td>" + nf(it.cbm, 4) + "</td><td>" + nf(it.cft, 2) + "</td>" +
             "<td>" + (it.actual == null ? "—" : nf(it.actual, 1)) + "</td>" +
             "<td>" + (it.vol == null ? "—" : nf(it.vol, 1)) + "</td>" +
             "<td>" + (it.cw == null ? "—" : nf(ceilHalf(it.cw), 1)) + "</td></tr>";
      }
      h += "</tbody></table></div>";
      if (r.items.length > lim) {
        h += "<p class=\"plc-hint\">" + esc(t("tool.rows.cap", { n: nf(lim, 0), t: nf(r.items.length, 0) })) + "</p>";
      }
    }

    // 제외된 행 — 버리지 않고 행번호·원본값·사유를 전부 보여준다
    if (r.excluded.length) {
      h += "<details class=\"plc-excl\"><summary>" + esc(t("tool.excl.title", { n: nf(r.excluded.length, 0) })) +
           "</summary><p class=\"plc-hint\">" + esc(t("tool.excl.hint")) + "</p><div class=\"plc-wrap\"><table><thead><tr>" +
           "<th>#</th><th>" + esc(t("tool.excl.th.reason")) + "</th><th>" + esc(t("tool.excl.th.value")) + "</th>" +
           "</tr></thead><tbody>";
      var elim = Math.min(r.excluded.length, RENDER_CAP);
      for (var x = 0; x < elim; x++) {
        var ex = r.excluded[x];
        h += "<tr><td>" + ex.n + "</td><td>" + esc(t("tool.excl.r." + ex.reason)) + "</td>" +
             "<td>" + esc(ex.raw === "" ? t("tool.excl.blank") : ex.raw) + "</td></tr>";
      }
      h += "</tbody></table></div></details>";
    }
    if (r.blank) h += "<p class=\"plc-hint\">" + esc(t("tool.blank", { n: nf(r.blank, 0) })) + "</p>";

    h += "<div class=\"plc-exports\">" +
         "<button type=\"button\" class=\"btn\" id=\"plc-csv\">" + esc(t("tool.csv.btn")) + "</button>" +
         "<button type=\"button\" class=\"btn plc-ghost\" id=\"plc-copy\">" + esc(t("tool.copy.btn")) + "</button>" +
         "<span class=\"plc-status\" id=\"plc-copied\" hidden>" + esc(t("tool.copied")) + "</span></div>";
    h += "<p class=\"plc-foot\">" + esc(t("tool.cont.foot")) + "</p>";

    els.result.innerHTML = h;
    var csvBtn = document.getElementById("plc-csv");
    var copyBtn = document.getElementById("plc-copy");
    if (csvBtn) csvBtn.addEventListener("click", downloadCSV);
    if (copyBtn) copyBtn.addEventListener("click", copyTSV);
  }

  function cell(dt, dd, sub) {
    return "<div class=\"plc-cell\"><dt>" + esc(dt) + "</dt><dd>" + esc(dd) +
      (sub ? "<span class=\"plc-sub\">" + esc(sub) + "</span>" : "") + "</dd></div>";
  }

  /* ---- 내보내기 (전 행 — 화면 표의 200행 캡과 무관) ---- */
  function exportRows() {
    var r = S.res, T = r.totals, rows = [];
    rows.push(["#", t("tool.th.item"), t("tool.th.qty"), t("tool.th.cbm"), t("tool.th.cft"),
      t("tool.th.actual"), t("tool.th.vol"), t("tool.th.cw")]);
    for (var i = 0; i < r.items.length; i++) {
      var it = r.items[i];
      rows.push([it.n, it.name, it.qty, round(it.cbm, 4), round(it.cft, 2),
        it.actual == null ? "" : round(it.actual, 2),
        it.vol == null ? "" : round(it.vol, 2),
        it.cw == null ? "" : ceilHalf(it.cw)]);
    }
    rows.push([]);
    rows.push([t("tool.t.boxes"), T.boxes]);
    rows.push([t("tool.t.cbm"), round(T.cbm, 4)]);
    rows.push([t("tool.unit.cft"), round(T.cft, 2)]);
    rows.push([t("tool.t.actual"), T.actual == null ? "" : round(T.actual, 2)]);
    rows.push([t("tool.t.vol"), T.vol == null ? "" : round(T.vol, 2)]);
    rows.push([t("tool.res.cw"), T.cwBill == null ? "" : T.cwBill]);
    rows.push([t("tool.t.rowsum"), T.cwRowSum == null ? "" : T.cwRowSum]);
    rows.push([t("tool.res.rt"), T.rt == null ? "" : round(T.rt, 3)]);
    rows.push([]);
    for (var c = 0; c < r.containers.length; c++) {
      var ct = r.containers[c];
      rows.push([t("tool.cont." + ct.id), ct.need, ct.need > 0 ? round(ct.eff, 1) + "%" : "",
        ct.need > 0 ? t("tool.cont.by." + ct.reason) : ""]);
    }
    if (r.excluded.length) {
      rows.push([]);
      rows.push([t("tool.excl.title", { n: r.excluded.length })]);
      rows.push(["#", t("tool.excl.th.reason"), t("tool.excl.th.value")]);
      for (var x = 0; x < r.excluded.length; x++) {
        rows.push([r.excluded[x].n, t("tool.excl.r." + r.excluded[x].reason), r.excluded[x].raw]);
      }
    }
    return rows;
  }
  function round(v, d) { var p = Math.pow(10, d); return Math.round(v * p) / p; }

  function downloadCSV() {
    if (!S.res) return;
    try {
      // UTF-8 BOM — 엑셀이 한글·중국어를 깨뜨리지 않게
      var blob = new Blob(["﻿" + toCSV(exportRows())], { type: "text/csv;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = SLUG + "-" + new Date().toISOString().slice(0, 10) + ".csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) {
      showError(t("tool.err.download"));
    }
  }

  function copyTSV() {
    if (!S.res) return;
    var text = toTSV(exportRows());
    var done = document.getElementById("plc-copied");
    function ok() { if (done) { done.hidden = false; setTimeout(function () { done.hidden = true; }, 1600); } }
    function no() {
      var btn = document.getElementById("plc-copy");
      if (btn) btn.textContent = t("tool.copyfail");
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok, no);
      } else no();
    } catch (e) { no(); }
  }

  /* ---- 이벤트 ---- */
  var pasteTimer = null;
  els.paste.addEventListener("input", function () {
    if (pasteTimer) clearTimeout(pasteTimer);
    pasteTimer = setTimeout(function () {
      var v = els.paste.value;
      if (!v.trim()) { setSource(null); return; }
      // setSource 와 달리 확정 상태를 유지한다 — 구조가 바뀌면 buildPreview 가 알아서 해제한다
      S.src = { kind: "text", text: v, size: v.length };
      S.encAuto = true;
      if (els.fname) els.fname.hidden = true;
      if (els.encwrap) els.encwrap.hidden = true;
      preview();
    }, 260);
  });

  els.pick.addEventListener("click", function () { els.file.click(); });
  els.file.addEventListener("change", function () {
    if (els.file.files && els.file.files[0]) takeFile(els.file.files[0]);
  });

  function takeFile(f) {
    if (f.size > MAX_FILE_BYTES) {
      setSource(null);
      showError(t("tool.err.big", { n: nf(Math.round(MAX_FILE_BYTES / 1048576), 0) }));
      return;
    }
    els.paste.value = "";
    setSource({ kind: "file", file: f, size: f.size, name: f.name });
  }

  ["dragenter", "dragover"].forEach(function (ev) {
    els.drop.addEventListener(ev, function (e) { e.preventDefault(); els.drop.classList.add("is-over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    els.drop.addEventListener(ev, function () { els.drop.classList.remove("is-over"); });
  });
  els.drop.addEventListener("drop", function (e) {
    e.preventDefault();
    var dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) takeFile(dt.files[0]);
  });

  els.example.addEventListener("click", function () {
    els.paste.value = t("tool.example.data");
    els.file.value = "";
    setSource({ kind: "text", text: els.paste.value, size: els.paste.value.length });
  });
  els.clear.addEventListener("click", function () {
    els.paste.value = ""; els.file.value = "";
    S.sig = null; S.map = null;
    setSource(null);
    els.paste.focus();
  });

  els.delim.addEventListener("change", function () {
    S.delimAuto = false; S.delim = delimValue(els.delim.value); S.confirmed = false; preview();
  });
  els.enc.addEventListener("change", function () {
    S.encAuto = false; S.enc = els.enc.value; S.confirmed = false; preview();
  });
  els.hdr.addEventListener("change", function () {
    S.headerAuto = false; S.hasHeader = els.hdr.checked; S.confirmed = false; preview();
  });
  els.confirm.addEventListener("click", function () {
    if (!mappingReady()) { showError(t("tool.err.nodims")); return; }
    compute();
  });

  function onOpt(unitTouched) {
    return function () {
      if (unitTouched) { S.unitGuessed = false; setUnitBadges(); }
      if (els.shapenote) els.shapenote.hidden = !(S.map && S.map.shape >= 0);
      savePrefs();
      if (S.confirmed) compute(); else render();
    };
  }
  els.dim.addEventListener("change", onOpt(true));
  els.wt.addEventListener("change", onOpt(true));
  els.mode.addEventListener("change", onOpt(false));
  els.shape.addEventListener("change", onOpt(false));
  els.minrt.addEventListener("change", onOpt(false));
  els.load.addEventListener("input", function () {
    els.loadout.value = els.load.value + "%";
  });
  els.load.addEventListener("change", onOpt(false));

  document.addEventListener("i18n:change", function () {
    els.loadout.value = els.load.value + "%";
    if (S.cols) renderPreview();
    render();
  });

  /* ---- 초기화 ---- */
  (function init() {
    var p = loadPrefs();
    var g = guessUnits();
    if (p) {
      if (CM_PER[p.dim]) els.dim.value = p.dim;
      if (KG_PER[p.wt]) els.wt.value = p.wt;
      if (DIVISOR.hasOwnProperty(p.mode)) els.mode.value = p.mode;
      if (p.shape === "cuboid" || p.shape === "cylinder") els.shape.value = p.shape;
      if (p.load >= 70 && p.load <= 95) els.load.value = p.load;
      els.minrt.checked = p.minrt !== false;
      S.unitGuessed = p.guessed !== false;
      if (S.unitGuessed) { els.dim.value = g.dim; els.wt.value = g.wt; }
    } else {
      els.dim.value = g.dim; els.wt.value = g.wt;
    }
    els.loadout.value = els.load.value + "%";
    setUnitBadges();
    render();
  })();
  // TOOLJS:END
})();
