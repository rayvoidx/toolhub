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
  var ROWS = 12;
  var result = $("result"), errEl = $("err"), breakList = $("r-breaklist");
  if (!$("o1") || !result || !breakList) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 빈칸은 null(안 쓴 과목), 쓰레기 값은 NaN — 섞으면 "생략한 행"과 "잘못 쓴 행"을 구분 못 한다.
  function num(el) {
    var v = String(el.value).replace(/,/g, "").trim();
    if (!v) return null;
    var n = parseFloat(v);
    return isFinite(n) ? n : NaN;
  }
  function fail(key, n) {
    result.hidden = true; errEl.hidden = false;
    errEl.textContent = t(key).replace("{n}", String(n));
  }
  // 인도 학교에서 흔한 등급대. 위원회마다 커트라인이 달라 화면에도 그렇게 표기한다.
  function gradeKey(p) {
    if (p >= 90) return "tool.grade.aplus";
    if (p >= 80) return "tool.grade.a";
    if (p >= 70) return "tool.grade.b";
    if (p >= 60) return "tool.grade.c";
    if (p >= 50) return "tool.grade.d";
    return "tool.grade.ni";
  }
  // 0.5 같은 부분점수를 허용하되 부동소수 꼬리(74.99999…)는 잘라 낸다.
  function fmt(v) { return String(Math.round(v * 100) / 100); }

  function collect() {
    var rows = [], i, o, m;
    for (i = 1; i <= ROWS; i++) {
      o = num($("o" + i)); m = num($("m" + i));
      if (o === null && m === null) continue;
      if (o === null || m === null || isNaN(o) || isNaN(m)) return { err: "tool.err.incomplete", n: i };
      if (o < 0 || m < 0) return { err: "tool.err.negative", n: i };
      if (m <= 0) return { err: "tool.err.maxzero", n: i };
      if (o > m) return { err: "tool.err.over", n: i };
      rows.push({ n: i, o: o, m: m, p: o / m * 100 });
    }
    if (!rows.length) return { err: "tool.err.empty", n: 0 };
    return { rows: rows };
  }

  function calc() {
    var got = collect();
    if (got.err) return fail(got.err, got.n);
    var rows = got.rows, sumO = 0, sumM = 0;
    rows.forEach(function (r) { sumO += r.o; sumM += r.m; });
    var pct = sumO / sumM * 100;

    $("r-pct").textContent = pct.toFixed(2) + "%";
    $("r-obtained").textContent = fmt(sumO);
    $("r-max").textContent = fmt(sumM);
    $("r-count").textContent = String(rows.length);
    $("r-grade").textContent = t(gradeKey(pct));
    // CBSE 관례: 백분율 = CGPA x 9.5 — FAQ에서 설명하던 값을 화면에도 낸다.
    $("r-cgpa").textContent = (pct / 9.5).toFixed(2);

    while (breakList.firstChild) breakList.removeChild(breakList.firstChild);
    rows.forEach(function (r) {
      var li = document.createElement("li");
      li.textContent = t("tool.h.subject") + " " + r.n + " — " + fmt(r.o) + " / " + fmt(r.m) +
        " = " + r.p.toFixed(2) + "%";
      breakList.appendChild(li);
    });

    errEl.hidden = true;
    result.hidden = false;
  }

  // 7~12번 과목 행은 기본 숨김. 6과목이 넘는 성적표(보드 시험 등)에서만 한 줄씩 펼친다.
  var extras = [].slice.call(document.querySelectorAll("#tool .srow[data-extra]"));
  var addBtn = $("add-row");
  if (addBtn) {
    addBtn.addEventListener("click", function () {
      var next = extras.filter(function (r) { return r.hidden; })[0];
      if (next) {
        next.hidden = false;
        var inp = next.querySelector("input");
        if (inp) inp.focus();
      }
      if (!extras.some(function (r) { return r.hidden; })) addBtn.hidden = true;
    });
  }

  $("calc-btn").addEventListener("click", calc);
  var i;
  for (i = 1; i <= ROWS; i++) {
    ["o", "m"].forEach(function (p) {
      var el = $(p + i);
      if (!el) return;
      el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
      el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
    });
  }
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
