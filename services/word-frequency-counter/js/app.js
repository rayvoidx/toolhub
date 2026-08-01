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
  var text = $("text"), stopBox = $("stopwords"), minlen = $("minlen"), topn = $("topn");
  var rows = $("rows"), result = $("result"), errEl = $("err");
  if (!text || !stopBox || !minlen || !topn || !rows) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  /* 영어 기능어 63개. 목록을 영어로 한정한 건 의도다 — 다른 언어는 원문 그대로 집계한다(FAQ 2). */
  var STOP = ("a about all am an and any are as at be been but by can do for from had has have he " +
    "her his how i if in is it its me my no not of on or our so than that the their them then there " +
    "they this to up was we were what when which who will with would you your").split(" ");
  var STOPSET = Object.create(null);
  for (var si = 0; si < STOP.length; si++) STOPSET[STOP[si]] = 1;

  /* 구두점·공백만 분리자로 본다. 하이픈(-)과 아포스트로피(')는 빠져 있어 don't, well-known 이 한 단어로 남는다. */
  var SPLIT = /[\s!-&(-,.\/:-@\[-`{-~\u00a0\u00a1\u00ab\u00bb\u00bf\u060c\u061b\u061f\u06d4\u2000-\u206f\u3000-\u303f\uff01-\uff65]+/;
  var EDGE_L = /^['\-]+/, EDGE_R = /['\-]+$/;

  function tokenize(s) {
    var parts = String(s).toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'").split(SPLIT);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var w = parts[i].replace(EDGE_L, "").replace(EDGE_R, "");
      if (w) out.push(w);
    }
    return out;
  }

  function fmtPct(p) { return (p >= 1 ? p.toFixed(1) : p.toFixed(2)) + "%"; }

  function cell(txt, cls) {
    var td = document.createElement("td");
    td.className = cls;
    td.textContent = txt;
    return td;
  }

  var csvText = "";

  function fail(key) {
    csvText = "";
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function calc() {
    var tokens = tokenize(text.value);
    var total = tokens.length;
    if (!total) return fail("tool.err.empty");

    var counts = Object.create(null), unique = 0, i;
    for (i = 0; i < total; i++) {
      var w = tokens[i];
      if (counts[w]) counts[w]++; else { counts[w] = 1; unique++; }
    }

    var min = parseInt(minlen.value, 10) || 1;
    var useStop = stopBox.checked;
    var list = [];
    for (var k in counts) {
      if (k.length < min) continue;
      if (useStop && STOPSET[k] === 1) continue;
      list.push([k, counts[k]]);
    }
    if (!list.length) return fail("tool.err.nowords");

    // 동점은 알파벳 순 — 같은 입력이면 항상 같은 표가 나오도록.
    list.sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0); });

    var limit = topn.value === "all" ? list.length : Math.min(parseInt(topn.value, 10) || 10, list.length);
    var maxCount = list[0][1];

    $("r-top").textContent = list[0][0];
    $("r-total").textContent = String(total);
    $("r-unique").textContent = String(unique);

    while (rows.firstChild) rows.removeChild(rows.firstChild);
    var csv = ["rank,word,count,density_percent"];
    for (i = 0; i < limit; i++) {
      var word = list[i][0], n = list[i][1], pct = n / total * 100;
      var tr = document.createElement("tr");
      tr.appendChild(cell(String(i + 1), "rank"));
      tr.appendChild(cell(word, "word"));
      tr.appendChild(cell(String(n), "num"));
      var td = document.createElement("td");
      td.className = "dens";
      var lab = document.createElement("div");
      lab.textContent = fmtPct(pct);
      td.appendChild(lab);
      var bar = document.createElement("div");
      bar.className = "bar";
      var fill = document.createElement("span");
      fill.style.width = (n / maxCount * 100).toFixed(1) + "%";
      bar.appendChild(fill);
      td.appendChild(bar);
      tr.appendChild(td);
      rows.appendChild(tr);
      csv.push((i + 1) + "," + word + "," + n + "," + pct.toFixed(2));
    }
    csvText = csv.join("\n");

    errEl.hidden = true;
    result.hidden = false;
  }

  var live = function () { if (!result.hidden || !errEl.hidden) calc(); };

  $("calc-btn").addEventListener("click", calc);
  text.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); calc(); }
  });
  text.addEventListener("input", live);
  [stopBox, minlen, topn].forEach(function (el) { el.addEventListener("change", live); });
  document.addEventListener("i18n:change", live);

  $("copy-btn").addEventListener("click", function () {
    var btn = $("copy-btn");
    if (!csvText) return;
    var done = function () {
      var prev = btn.textContent;
      btn.textContent = t("tool.copied");
      setTimeout(function () { btn.textContent = prev; }, 1200);
    };
    var fallback = function () {
      var ta = document.createElement("textarea");
      ta.value = csvText;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { /* 클립보드 차단 — 버튼 상태만 유지 */ }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(csvText).then(done, fallback);
    } else fallback();
  });
  // TOOLJS:END
})();
