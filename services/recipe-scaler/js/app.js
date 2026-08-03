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
  var orig = $("orig"), want = $("want"), ing = $("ingredients");
  var result = $("result"), errEl = $("err"), rowsEl = $("rows");
  var copyBtn = $("copy-btn"), copyStatus = $("copy-status");
  if (!orig || !want || !ing || !rowsEl) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var UNI = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125, "⅜": 0.375,
              "⅝": 0.625, "⅞": 0.875, "⅕": 0.2, "⅖": 0.4, "⅗": 0.6, "⅘": 0.8, "⅙": 1 / 6, "⅚": 5 / 6 };

  // 줄머리 수량: "1 1/2" · "1½" · "3/4" · "½" · "2.5" — 긴 형태를 먼저 봐야 "1 1/2" 가 1 로 잘리지 않는다.
  var QTY = /^\s*(?:(\d+)\s+(\d+)\s*\/\s*(\d+)|(\d+)\s*([½¼¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚])|(\d+)\s*\/\s*(\d+)|([½¼¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚])|(\d+(?:[.,]\d+)?))/;
  var RANGE = /^\s*(?:-|–|—|to\b)\s*/;   // "2-3 cloves", "1 to 2 tsp"
  var EGG = /\beggs?\b/i;

  // 스푼/컵은 tsp 기준으로 환산해, 12 tbsp 같은 결과에 "= ¾ cup" 을 덧붙인다.
  var UNITS = [
    { re: /^\s*(?:tsp|teaspoons?)\b/i, tsp: 1, name: "tsp" },
    { re: /^\s*(?:tbsp|tbs|tablespoons?)\b/i, tsp: 3, name: "tbsp" },
    { re: /^\s*(?:cups?)\b/i, tsp: 48, name: "cup" }
  ];

  function altUnit(value, rest) {
    var i, u = null, m;
    for (i = 0; i < UNITS.length; i++) { m = UNITS[i].re.exec(rest); if (m) { u = UNITS[i]; break; } }
    if (!u || !isFinite(value) || value <= 0) return "";
    var tsp = value * u.tsp;
    var target = tsp >= 24 ? UNITS[2] : (tsp >= 3 ? UNITS[1] : UNITS[0]);
    if (target === u) return "";
    var n = tsp / target.tsp;
    return "= " + fmtQty(n) + " " + target.name + (target.name === "cup" && n >= 2 ? "s" : "");
  }

  function parseQty(str) {
    var m = QTY.exec(str), v;
    if (!m) return null;
    if (m[1]) v = parseFloat(m[1]) + parseFloat(m[2]) / parseFloat(m[3]);
    else if (m[4]) v = parseFloat(m[4]) + UNI[m[5]];
    else if (m[6]) v = parseFloat(m[6]) / parseFloat(m[7]);
    else if (m[8]) v = UNI[m[8]];
    else v = parseFloat(String(m[9]).replace(",", "."));
    if (!isFinite(v) || v <= 0) return null;
    return { value: v, rest: str.slice(m[0].length) };
  }

  function parseLine(line) {
    var a = parseQty(line);
    if (!a) return null;
    var sep = RANGE.exec(a.rest);
    if (sep) {
      var b = parseQty(a.rest.slice(sep[0].length));
      if (b) return { value: a.value, value2: b.value, rest: b.rest };
    }
    return { value: a.value, value2: 0, rest: a.rest };
  }

  // 주방에서 쓰는 눈금(8분·3분·6분)으로 스냅한다. 0.666… 을 "0.67컵"으로 내면 계량스푼이 없다.
  var STEPS = [
    { v: 0, s: "" }, { v: 0.125, s: "⅛" }, { v: 1 / 6, s: "⅙" }, { v: 0.25, s: "¼" },
    { v: 1 / 3, s: "⅓" }, { v: 0.375, s: "⅜" }, { v: 0.5, s: "½" }, { v: 0.625, s: "⅝" },
    { v: 2 / 3, s: "⅔" }, { v: 0.75, s: "¾" }, { v: 5 / 6, s: "⅚" }, { v: 0.875, s: "⅞" }, { v: 1, s: "" }
  ];

  function fmtQty(v) {
    // 1/16 미만을 분수로 반올림하면 두 배 넘게 틀린다 — 그럴 땐 소수 그대로 둔다.
    if (v < 0.0625) return String(Math.round(v * 100) / 100);
    var whole = Math.floor(v), frac = v - whole, best = STEPS[0], i;
    for (i = 1; i < STEPS.length; i++) {
      if (Math.abs(STEPS[i].v - frac) < Math.abs(best.v - frac)) best = STEPS[i];
    }
    if (best.v === 1) { whole += 1; best = STEPS[0]; }
    if (!whole && !best.v) return String(Math.round(v * 100) / 100);
    if (!best.s) return String(whole);
    return whole ? String(whole) + best.s : best.s;
  }

  function isFractional(v) { return Math.abs(v - Math.round(v)) > 0.02; }

  var rows = [];        // {qty, rest, text, note, pass}
  var factorText = "";
  var lastErr = null;   // 언어를 바꿔도 떠 있는 오류 문구가 옛 언어로 남지 않도록 키를 들고 있는다.

  function fail(key) {
    lastErr = key;
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function scale(factor) {
    var lines = ing.value.split("\n"), out = [], i, line, p, qty;
    for (i = 0; i < lines.length; i++) {
      line = lines[i].trim();
      if (!line) continue;
      p = parseLine(line);
      // 수량을 못 읽은 줄(섹션 제목, "소금 약간")은 버리지 않고 그대로 넘기되 표시를 남긴다.
      if (!p) { out.push({ qty: "", rest: "", text: line, note: "tool.taste", pass: true }); continue; }
      qty = fmtQty(p.value * factor);
      if (p.value2) qty += "–" + fmtQty(p.value2 * factor);
      out.push({
        qty: qty,
        rest: p.rest,
        text: "",
        note: (EGG.test(p.rest) && isFractional(p.value * factor)) ? "tool.egg" : "",
        alt: p.value2 ? "" : altUnit(p.value * factor, p.rest),
        pass: false
      });
    }
    return out;
  }

  function render() {
    rowsEl.textContent = "";
    rows.forEach(function (r) {
      var card = document.createElement("div");
      card.className = r.pass ? "rcard passthru" : "rcard";
      if (r.pass) {
        card.appendChild(document.createTextNode(r.text));
      } else {
        var q = document.createElement("span");
        q.className = "qty";
        q.textContent = r.qty;
        card.appendChild(q);
        card.appendChild(document.createTextNode(r.rest));
      }
      if (r.note) {
        var n = document.createElement("span");
        n.className = "note";
        n.textContent = "· " + t(r.note);
        card.appendChild(n);
      }
      if (r.alt) {
        var a = document.createElement("span");
        a.className = "note";
        a.textContent = "· " + r.alt;
        card.appendChild(a);
      }
      rowsEl.appendChild(card);
    });
    $("r-factor").textContent = factorText;
  }

  function calc() {
    copyStatus.hidden = true;
    var o = parseFloat(String(orig.value).replace(/,/g, ""));
    var w = parseFloat(String(want.value).replace(/,/g, ""));
    if (!isFinite(o) || !isFinite(w) || o <= 0 || w <= 0) return fail("tool.err.servings");
    var factor = w / o;
    if (factor < 0.02 || factor > 50) return fail("tool.err.factor");

    var out = scale(factor);
    if (!out.length) return fail("tool.err.empty");

    rows = out;
    factorText = "×" + String(Math.round(factor * 1000) / 1000);
    lastErr = null;
    errEl.hidden = true;
    result.hidden = false;
    render();
  }

  function listText() {
    return rows.map(function (r) {
      var s = r.pass ? r.text : r.qty + r.rest;
      if (r.note) s += " (" + t(r.note) + ")";
      if (r.alt) s += " (" + r.alt + ")";
      return s;
    }).join("\n");
  }

  function say(key) { copyStatus.hidden = false; copyStatus.textContent = t(key); }

  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "readonly");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    say(ok ? "tool.copied" : "tool.copyfail");
  }

  function copyList() {
    if (!rows.length) return;
    var text = listText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { say("tool.copied"); }, function () { legacyCopy(text); });
      return;
    }
    legacyCopy(text);
  }

  function live() { if (!result.hidden || !errEl.hidden) calc(); }

  $("calc-btn").addEventListener("click", calc);
  copyBtn.addEventListener("click", copyList);
  [orig, want].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("input", live);
  });
  // textarea 안에서 Enter 는 줄바꿈이어야 하므로 환산은 Ctrl/Cmd+Enter 로 건다.
  ing.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); calc(); } });
  ing.addEventListener("input", live);

  document.addEventListener("i18n:change", function () {
    copyStatus.hidden = true;
    if (!errEl.hidden && lastErr) { errEl.textContent = t(lastErr); return; }
    if (!result.hidden) render();
  });
  // TOOLJS:END
})();
