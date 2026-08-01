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
  var preset = $("preset"), sitemap = $("sitemap"), out = $("out");
  var result = $("result"), errEl = $("err");
  if (!preset || !sitemap || !out) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  /* 자율 준수를 선언한 AI 크롤러들 — 토큰이 공개된 것만 넣는다. 나머지는 서버 차단 영역. */
  var AI_BOTS = ["GPTBot", "ClaudeBot", "Google-Extended", "CCBot", "PerplexityBot", "Bytespider"];

  /* dis 의 "" 는 "Disallow:" 빈 값(= 전체 허용) 줄을 뜻한다 — robots.txt 표준 표현. */
  var PRESETS = {
    allowall: [{ ua: "*", dis: [""], allow: [] }],
    blockall: [{ ua: "*", dis: ["/"], allow: [] }],
    wordpress: [{ ua: "*", dis: ["/wp-admin/", "/?s=", "/search/"], allow: ["/wp-admin/admin-ajax.php"] }],
    custom: []
  };

  function presetGroups(p) {
    if (p === "blockai") {
      var g = [{ ua: "*", dis: [""], allow: [] }];
      for (var i = 0; i < AI_BOTS.length; i++) g.push({ ua: AI_BOTS[i], dis: ["/"], allow: [] });
      return g;
    }
    return (PRESETS[p] || []).slice();
  }

  var fixedPaths = [];
  function normPath(v) {
    var p = String(v == null ? "" : v).trim();
    if (!p) return "";
    // 경로는 / 로 시작해야 유효하다. 와일드카드 시작(*)만 예외로 인정하고, 나머지는 붙여주고 알린다.
    if (p.charAt(0) !== "/" && p.charAt(0) !== "*") { fixedPaths.push(p); p = "/" + p; }
    return p;
  }

  function validSitemap(u) { return /^https?:\/\/[^\s\/]+\/[^\s]*$/i.test(u) || /^https?:\/\/[^\s\/]+$/i.test(u); }

  function utf8len(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      n += c < 128 ? 1 : c < 2048 ? 2 : (c >= 0xD800 && c < 0xDC00) ? 2 : 3;
    }
    return n;
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    fixedPaths = [];
    var notes = [], skipped = 0, i, j;
    var groups = presetGroups(preset.value);

    for (i = 1; i <= 3; i++) {
      var ua = String($("ua" + i).value).trim();
      var d = normPath($("dis" + i).value);
      var a = normPath($("alw" + i).value);
      if (!ua && !d && !a) { skipped++; continue; }
      groups.push({ ua: ua || "*", dis: d ? [d] : [], allow: a ? [a] : [] });
    }

    if (!groups.length) return fail("tool.err.norule");

    var lines = [], rules = 0;
    for (i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (lines.length) lines.push("");
      lines.push("User-agent: " + g.ua);
      var dis = g.dis, alw = g.allow || [];
      if (!dis.length && !alw.length) dis = [""];
      // 빈 Disallow 는 "Disallow:" 로만 쓴다 — 뒤에 공백을 남기면 파일이 지저분해진다.
      for (j = 0; j < dis.length; j++) { lines.push(dis[j] ? "Disallow: " + dis[j] : "Disallow:"); rules++; }
      for (j = 0; j < alw.length; j++) { lines.push("Allow: " + alw[j]); rules++; }
    }

    var sm = String(sitemap.value).trim();
    if (sm) {
      if (validSitemap(sm)) { lines.push(""); lines.push("Sitemap: " + sm); }
      else notes.push(t("tool.note.sitemap"));
    }

    var text = lines.join("\n") + "\n";
    out.value = text;

    if (preset.value === "blockai") notes.push(t("tool.note.ai"));
    if (fixedPaths.length) notes.push(t("tool.note.slash") + " " + fixedPaths.join(", "));
    if (skipped) notes.push(skipped + " " + t("tool.note.skipped"));
    if (!notes.length) notes.push(t("tool.note.ok"));

    $("r-groups").textContent = String(groups.length);
    $("r-rules").textContent = String(rules);
    $("r-size").textContent = utf8len(text) + " B";
    $("r-notes").textContent = notes.join(" ");

    errEl.hidden = true;
    result.hidden = false;
  }

  var inputs = [sitemap];
  for (var n = 1; n <= 3; n++) inputs.push($("ua" + n), $("dis" + n), $("alw" + n));

  $("calc-btn").addEventListener("click", calc);
  inputs.forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); calc(); } });
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  preset.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });

  $("copy-btn").addEventListener("click", function () {
    var btn = $("copy-btn");
    if (!out.value) return;
    var done = function () {
      var prev = btn.textContent;
      btn.textContent = t("tool.copied");
      setTimeout(function () { btn.textContent = prev; }, 1200);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(out.value).then(done, function () { /* 권한 거부 — 무시 */ });
    else { out.select(); done(); }
  });

  $("dl-btn").addEventListener("click", function () {
    if (!out.value) return;
    var blob = new Blob([out.value], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "robots.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });
  // TOOLJS:END
})();
