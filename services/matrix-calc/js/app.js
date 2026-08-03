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
  var sizeEl = $("size"), opEl = $("op"), dpEl = $("dp"), matA = $("mat-a"), matB = $("mat-b"), bWrap = $("b-wrap");
  var result = $("result"), errEl = $("err");
  if (!sizeEl || !opEl || !matA || !matB) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var BINARY = { mul: 1, add: 1, sub: 1 };
  var LIMIT = 1e9;

  // 표시는 4자리 반올림 — 역행렬의 1/det 나눗셈에서 0.30000000000000004 같은 잡음을 걷어낸다.
  function fmt(x) {
    if (typeof x !== "number" || !isFinite(x)) return "—";
    var dp = dpEl ? parseInt(dpEl.value, 10) : 4;
    if (!(dp >= 0 && dp <= 8)) dp = 4;
    var p = Math.pow(10, dp), r = Math.round(x * p) / p;
    if (r === 0) r = 0;
    return String(r);
  }

  function readMat(prefix, size) {
    var m = [], r, c, el, raw, v;
    for (r = 1; r <= size; r++) {
      m.push([]);
      for (c = 1; c <= size; c++) {
        el = $(prefix + r + c);
        raw = el ? String(el.value).replace(/,/g, "").trim() : "";
        if (raw === "") return "empty";
        v = parseFloat(raw);
        if (!isFinite(v)) return "empty";
        if (Math.abs(v) > LIMIT) return "range";
        m[r - 1].push(v);
      }
    }
    return m;
  }

  function det(m) {
    if (m.length === 2) return m[0][0] * m[1][1] - m[0][1] * m[1][0];
    return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
         - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
         + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  }
  function mul(a, b) {
    var n = a.length, out = [], r, c, k, s;
    for (r = 0; r < n; r++) { out.push([]); for (c = 0; c < n; c++) { s = 0; for (k = 0; k < n; k++) s += a[r][k] * b[k][c]; out[r].push(s); } }
    return out;
  }
  function combine(a, b, sign) {
    var n = a.length, out = [], r, c;
    for (r = 0; r < n; r++) { out.push([]); for (c = 0; c < n; c++) out[r].push(a[r][c] + sign * b[r][c]); }
    return out;
  }
  function transpose(a) {
    var n = a.length, out = [], r, c;
    for (r = 0; r < n; r++) { out.push([]); for (c = 0; c < n; c++) out[r].push(a[c][r]); }
    return out;
  }
  function minor(m, i, j) { // 3x3 에서 i행 j열을 뺀 2x2 소행렬식
    var rows = [], r, c, sub = [];
    for (r = 0; r < 3; r++) { if (r === i) continue; sub = []; for (c = 0; c < 3; c++) { if (c === j) continue; sub.push(m[r][c]); } rows.push(sub); }
    return rows[0][0] * rows[1][1] - rows[0][1] * rows[1][0];
  }
  function inverse(m, d) { // 수반행렬 / det — 2x2·3x3 은 이 방식이 소거법보다 짧고 정확하다
    if (m.length === 2) return [[m[1][1] / d, -m[0][1] / d], [-m[1][0] / d, m[0][0] / d]];
    var out = [], r, c, cof;
    for (r = 0; r < 3; r++) { out.push([]); for (c = 0; c < 3; c++) { cof = ((r + c) % 2 ? -1 : 1) * minor(m, c, r); out[r].push(cof / d); } }
    return out;
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function drawMatrix(m) {
    var out = $("r-matrix"), r, c, cell;
    clear(out);
    out.setAttribute("data-n", String(m.length));
    for (r = 0; r < m.length; r++) for (c = 0; c < m.length; c++) {
      cell = document.createElement("div");
      cell.className = "mcell";
      cell.textContent = fmt(m[r][c]);
      out.appendChild(cell);
    }
  }
  function drawText(msg) {
    var out = $("r-matrix"), p = document.createElement("div");
    clear(out);
    out.setAttribute("data-n", "1");
    p.textContent = msg;
    out.appendChild(p);
  }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function sync() {
    var s = sizeEl.value === "3" ? "3" : "2";
    matA.setAttribute("data-n", s);
    matB.setAttribute("data-n", s);
    bWrap.hidden = !BINARY[opEl.value];
  }

  function calc() {
    var size = sizeEl.value === "3" ? 3 : 2, op = opEl.value;
    var A = readMat("a", size), B = null;
    if (A === "empty") return fail("tool.err.a");
    if (A === "range") return fail("tool.err.range");
    if (BINARY[op]) {
      B = readMat("b", size);
      if (B === "empty") return fail("tool.err.b");
      if (B === "range") return fail("tool.err.range");
    }

    var mat = null, dv = null, steps = "", s = fmt, i, k;
    if (op === "mul") {
      mat = mul(A, B);
      steps = "r11 = ";
      for (k = 0; k < size; k++) steps += (k ? " + " : "") + s(A[0][k]) + "×" + s(B[k][0]);
      steps += " = " + s(mat[0][0]);
    } else if (op === "add" || op === "sub") {
      mat = combine(A, B, op === "add" ? 1 : -1);
      steps = "r11 = " + s(A[0][0]) + (op === "add" ? " + " : " − ") + s(B[0][0]) + " = " + s(mat[0][0]);
    } else if (op === "tra") {
      mat = transpose(A);
      steps = "Aᵀ: r12 = a21 = " + s(A[1][0]);
    } else {
      dv = det(A);
      if (size === 2) {
        steps = "det = ad − bc = " + s(A[0][0]) + "×" + s(A[1][1]) + " − " + s(A[0][1]) + "×" + s(A[1][0]) + " = " + s(dv);
      } else {
        steps = "det = " + s(A[0][0]) + "×(" + s(A[1][1]) + "×" + s(A[2][2]) + " − " + s(A[1][2]) + "×" + s(A[2][1]) + ")"
              + " − " + s(A[0][1]) + "×(" + s(A[1][0]) + "×" + s(A[2][2]) + " − " + s(A[1][2]) + "×" + s(A[2][0]) + ")"
              + " + " + s(A[0][2]) + "×(" + s(A[1][0]) + "×" + s(A[2][1]) + " − " + s(A[1][1]) + "×" + s(A[2][0]) + ")"
              + " = " + s(dv);
      }
      // det 이 0 이면 역행렬은 "없음"이 정답이다 — 입력 오류가 아니므로 결과 영역에 설명을 낸다.
      if (op === "inv") {
        if (Math.abs(dv) < 1e-12) { mat = null; steps = "det = 0 → adj(A)/det undefined"; }
        else { mat = inverse(A, dv); steps = "A⁻¹ = (1/det) × adj(A), det = " + s(dv); }
      }
    }

    $("card-matrix").hidden = op === "det";
    $("card-det").hidden = !(op === "det" || op === "inv");
    if (dv !== null) $("r-det").textContent = s(dv);
    if (op !== "det") { if (mat) drawMatrix(mat); else drawText(t("tool.r.singular")); }
    $("r-steps").textContent = steps;

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  var cells = [].slice.call(document.querySelectorAll("#tool .mat input"));
  cells.forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  [sizeEl, opEl, dpEl].filter(Boolean).forEach(function (el) {
    el.addEventListener("change", function () { sync(); if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  sync();
  // TOOLJS:END
})();
