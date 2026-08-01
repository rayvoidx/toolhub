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
  var $ = function (id) { return document.getElementById(id); };
  var rowsSel = $("rows"), colsSel = $("cols"), grid = $("grid"), aligns = $("aligns");
  var pretty = $("pretty"), result = $("result"), errEl = $("err");
  var out = $("md-out"), preview = $("preview"), copyBtn = $("copy-btn");
  if (!rowsSel || !colsSel || !grid || !aligns || !pretty || !out || !preview || !copyBtn) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var BS = String.fromCharCode(92);          // 백슬래시 — 템플릿 리터럴 이스케이프 함정을 피한다
  var ALIGNS = ["left", "center", "right"];
  var MINSEP = { left: 4, center: 5, right: 4 };  // ":---", ":---:", "---:"
  // 자리표시자 = 유효한 샘플 값(QA 자동입력이 이 값을 그대로 쓴다)
  var PH = [
    ["Name", "Role", "Team", "Status", "Owner", "Priority", "Due", "Notes"],
    ["Ada Lovelace", "Engineer", "Platform", "Active", "A. Turing", "High", "2026-08-01", "First pass"],
    ["Grace Hopper", "Compiler lead", "Tooling", "Active", "J. Backus", "Medium", "2026-08-15", "Needs review"]
  ];

  function dims() {
    var r = parseInt(rowsSel.value, 10), c = parseInt(colsSel.value, 10);
    return { r: r > 1 ? r : 3, c: c > 1 ? c : 3 };
  }
  function alignOf(c) { var s = $("a" + c); return s && MINSEP[s.value] ? s.value : "left"; }
  function rep(ch, n) { return n > 0 ? new Array(n + 1).join(ch) : ""; }
  function pad(s, n) { return s + rep(" ", n - s.length); }

  var store = {};   // 행·열을 줄였다 늘려도 입력값이 살아남게 하는 버퍼(저장이 아니라 세션 내 보존)
  function snapshot() {
    var i, el = grid.getElementsByTagName("input");
    for (i = 0; i < el.length; i++) store[el[i].id] = el[i].value;
    var se = aligns.getElementsByTagName("select");
    for (i = 0; i < se.length; i++) store[se[i].id] = se[i].value;
  }

  function buildGrid() {
    snapshot();
    var d = dims(), r, c, i;
    grid.style.setProperty("--cols", d.c);
    aligns.style.setProperty("--cols", d.c);

    aligns.textContent = "";
    for (c = 0; c < d.c; c++) {
      var sel = document.createElement("select");
      sel.id = "a" + c;
      sel.setAttribute("aria-label", t("tool.align.label") + " — " + t("tool.col") + " " + (c + 1));
      for (i = 0; i < ALIGNS.length; i++) {
        var o = document.createElement("option");
        o.value = ALIGNS[i];
        o.setAttribute("data-i18n", "tool.align." + ALIGNS[i]);
        o.textContent = t("tool.align." + ALIGNS[i]);
        if (store[sel.id] === ALIGNS[i]) o.selected = true;
        sel.appendChild(o);
      }
      aligns.appendChild(sel);
    }

    grid.textContent = "";
    for (r = 0; r < d.r; r++) {
      for (c = 0; c < d.c; c++) {
        var id = "r" + r + "c" + c;
        var inp = document.createElement("input");
        inp.type = "text";
        inp.id = id;
        inp.autocomplete = "off";
        if (r === 0) inp.className = "hdr";
        inp.placeholder = (PH[r] && PH[r][c]) || "";
        inp.setAttribute("aria-label", r === 0
          ? "Header " + (c + 1)
          : "Row " + r + " column " + (c + 1));
        if (store[id]) inp.value = store[id];
        grid.appendChild(inp);
      }
    }
  }

  function cellsNow() {
    var d = dims(), rows = [], r, c;
    for (r = 0; r < d.r; r++) {
      var row = [];
      for (c = 0; c < d.c; c++) {
        var el = $("r" + r + "c" + c);
        row.push(el ? String(el.value).trim() : "");
      }
      rows.push(row);
    }
    return rows;
  }

  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function toMarkdown(esc, aligned, padded) {
    var lines = [], r, c, w = [];
    for (c = 0; c < aligned.length; c++) {
      var m = MINSEP[aligned[c]];
      for (r = 0; r < esc.length; r++) if (esc[r][c].length > m) m = esc[r][c].length;
      w.push(m);
    }
    function line(vals) {
      var parts = [];
      for (var i = 0; i < vals.length; i++) parts.push(padded ? pad(vals[i], w[i]) : vals[i]);
      return "| " + parts.join(" | ") + " |";
    }
    function sep(a, n) {
      if (!padded) return a === "center" ? ":---:" : (a === "right" ? "---:" : ":---");
      if (a === "center") return ":" + rep("-", n - 2) + ":";
      if (a === "right") return rep("-", n - 1) + ":";
      return ":" + rep("-", n - 1);
    }
    var seps = [];
    for (c = 0; c < aligned.length; c++) seps.push(sep(aligned[c], w[c]));
    lines.push(line(esc[0]));
    lines.push("| " + seps.join(" | ") + " |");
    for (r = 1; r < esc.length; r++) lines.push(line(esc[r]));
    return lines.join("\n");
  }

  function renderPreview(raw, aligned) {
    preview.textContent = "";
    var tbl = document.createElement("table"), r, c;
    var thead = document.createElement("thead"), htr = document.createElement("tr");
    for (c = 0; c < aligned.length; c++) {
      var th = document.createElement("th");
      th.textContent = raw[0][c];
      th.style.textAlign = aligned[c];
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    tbl.appendChild(thead);
    var tb = document.createElement("tbody");
    for (r = 1; r < raw.length; r++) {
      var tr = document.createElement("tr");
      for (c = 0; c < aligned.length; c++) {
        var td = document.createElement("td");
        td.textContent = raw[r][c];
        td.style.textAlign = aligned[c];
        tr.appendChild(td);
      }
      tb.appendChild(tr);
    }
    tbl.appendChild(tb);
    preview.appendChild(tbl);
  }

  function calc() {
    var raw = cellsNow(), r, c;
    if (!raw.length || raw[0].join("") === "") return fail("tool.err.empty");
    // 끝에 붙은 완전 빈 행은 버린다 (빈 표 행을 출력하지 않기 위해)
    while (raw.length > 1 && raw[raw.length - 1].join("") === "") raw.pop();

    var esc = [], aligned = [];
    for (r = 0; r < raw.length; r++) {
      var row = [];
      for (c = 0; c < raw[r].length; c++) row.push(raw[r][c].split("|").join(BS + "|"));
      esc.push(row);
    }
    for (c = 0; c < raw[0].length; c++) aligned.push(alignOf(c));

    out.value = toMarkdown(esc, aligned, !!pretty.checked);
    renderPreview(raw, aligned);
    errEl.hidden = true;
    result.hidden = false;
  }

  function refresh() { if (!result.hidden || !errEl.hidden) calc(); }

  $("calc-btn").addEventListener("click", calc);
  grid.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); calc(); } });
  grid.addEventListener("input", function () { if (!result.hidden) calc(); });
  aligns.addEventListener("change", refresh);
  pretty.addEventListener("change", refresh);
  [rowsSel, colsSel].forEach(function (el) {
    el.addEventListener("change", function () { buildGrid(); refresh(); });
  });
  document.addEventListener("i18n:change", refresh);

  copyBtn.addEventListener("click", function () {
    var done = function () {
      copyBtn.textContent = t("tool.copied");
      setTimeout(function () { copyBtn.textContent = t("tool.copy"); }, 1500);
    };
    var manual = function () {
      try {
        out.focus();
        out.select();
        if (document.execCommand && document.execCommand("copy")) { done(); return; }
      } catch (e) { /* 아래에서 안내 문구를 띄운다 */ }
      errEl.hidden = false;
      errEl.textContent = t("tool.copyfail");
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(out.value).then(done, manual);
      } else { manual(); }
    } catch (e) { manual(); }
  });
  // TOOLJS:END
})();
