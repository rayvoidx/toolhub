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
  var entries = $("entries"), removeWinner = $("remove-winner");
  var result = $("result"), errEl = $("err"), btn = $("calc-btn");
  if (!entries || !btn) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var history = [];
  var rolling = null;

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }
  function list() {
    return entries.value.split("\n").map(function (s) { return s.trim(); }).filter(function (s) { return s.length; });
  }

  // 편향 없는 정수 난수 — 나머지 연산은 앞쪽 항목을 더 자주 뽑게 만든다. 초과 구간은 버리고 다시 뽑는다.
  function randomIndex(n) {
    if (n <= 0) return 0;
    var g = (window.crypto && window.crypto.getRandomValues) ? window.crypto : null;
    if (!g) return Math.floor(Math.random() * n);
    var limit = Math.floor(4294967296 / n) * n;
    var buf = new Uint32Array(1);
    do { g.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % n;
  }

  function renderHistory() {
    var wrap = $("history-wrap"), ol = $("history");
    if (!history.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    ol.textContent = "";
    history.slice(0, 12).forEach(function (name) {
      var li = document.createElement("li");
      li.textContent = name;
      ol.appendChild(li);
    });
  }

  function finish(items, winner) {
    $("r-winner").textContent = winner;
    $("winner-box").classList.remove("rolling");
    if (removeWinner.checked) {
      var idx = items.indexOf(winner);
      if (idx > -1) items.splice(idx, 1);
      entries.value = items.join("\n");
    }
    $("r-count").textContent = String(list().length);
    history.unshift(winner);
    renderHistory();
    btn.textContent = t("tool.again");
    btn.disabled = false;
  }

  function spin() {
    if (rolling) return;
    var items = list();
    if (items.length === 0) return fail("tool.err.empty");
    if (items.length === 1) return fail("tool.err.one");

    errEl.hidden = true;
    result.hidden = false;
    $("winner-box").classList.add("rolling");
    btn.disabled = true;

    // 결과는 먼저 정해두고 화면만 잠깐 굴린다 — 애니메이션 타이밍이 결과를 바꾸지 못하게.
    var winner = items[randomIndex(items.length)];
    var ticks = 0;
    rolling = setInterval(function () {
      $("r-winner").textContent = items[randomIndex(items.length)];
      if (++ticks >= 12) {
        clearInterval(rolling); rolling = null;
        finish(items, winner);
      }
    }, 60);
  }

  btn.addEventListener("click", spin);
  $("clear-history").addEventListener("click", function () { history = []; renderHistory(); });
  entries.addEventListener("input", function () {
    if (!errEl.hidden) errEl.hidden = true;
    if (!result.hidden) $("r-count").textContent = String(list().length);
  });

  document.addEventListener("i18n:change", function () {
    if (!result.hidden) btn.textContent = t(history.length ? "tool.again" : "tool.spin");
  });
  // TOOLJS:END
})();
