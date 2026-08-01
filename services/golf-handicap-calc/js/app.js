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
  var ROWS = 5;
  var result = $("result"), errEl = $("err"), diffList = $("r-difflist");
  if (!$("s1") || !result || !diffList) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 빈칸은 null(미입력), 쓰레기 값은 NaN — 둘을 섞으면 "안 쓴 행"과 "잘못 쓴 행"을 구분 못 한다.
  function num(el) {
    var v = String(el.value).replace(/,/g, "").trim();
    if (!v) return null;
    var n = parseFloat(v);
    return isFinite(n) ? n : NaN;
  }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }
  // WHS 는 플러스 핸디캡을 +2.1 처럼 표기한다 (마이너스가 아니라 더 잘 친다는 뜻).
  function fmt(v) { return v < 0 ? "+" + Math.abs(v).toFixed(1) : v.toFixed(1); }

  function collect() {
    var rows = [], i, s, r, sl;
    for (i = 1; i <= ROWS; i++) {
      s = num($("s" + i)); r = num($("cr" + i)); sl = num($("sl" + i));
      if (s === null && r === null && sl === null) continue;
      if (s === null || r === null || sl === null || isNaN(s) || isNaN(r) || isNaN(sl)) return { err: "tool.err.incomplete" };
      if (s < 40 || s > 200) return { err: "tool.err.score" };
      if (r < 60 || r > 80) return { err: "tool.err.rating" };
      if (sl < 55 || sl > 155) return { err: "tool.err.slope" };
      // 디퍼렌셜은 WHS 규정대로 소수 첫째 자리에서 반올림한 뒤 사용한다.
      rows.push({ n: i, s: s, r: r, sl: sl, d: Math.round((s - r) * 113 / sl * 10) / 10 });
    }
    if (!rows.length) return { err: "tool.err.empty" };
    return { rows: rows };
  }

  function calc() {
    var got = collect();
    if (got.err) return fail(got.err);
    var rows = got.rows, n = rows.length;
    var sorted = rows.slice().sort(function (a, b) { return a.d - b.d; });
    // 20라운드 미만 축소표: 1~3개는 최저 -2.0, 4개는 최저 -1.0, 5개는 최저 그대로.
    var adj = n <= 3 ? 2 : (n === 4 ? 1 : 0);
    var idx = Math.round((sorted[0].d - adj) * 10) / 10;
    if (idx > 54) idx = 54; // WHS 최대 핸디캡 인덱스

    $("r-index").textContent = fmt(idx);
    $("r-used").textContent = String(n);
    $("r-low").textContent = fmt(sorted[0].d);
    $("r-adj").textContent = adj === 0 ? "0.0" : "-" + adj.toFixed(1);

    while (diffList.firstChild) diffList.removeChild(diffList.firstChild);
    rows.forEach(function (row) {
      var li = document.createElement("li");
      li.textContent = t("tool.h.round") + " " + row.n + " — " + row.s + " · " +
        row.r.toFixed(1) + " / " + row.sl + " → " + fmt(row.d);
      diffList.appendChild(li);
    });

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  var i, el;
  for (i = 1; i <= ROWS; i++) {
    ["s", "cr", "sl"].forEach(function (p) {
      el = $(p + i);
      if (!el) return;
      el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
      el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
    });
  }
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
