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
  // Toolhub 는 계산 로직이 없는 디렉토리형 서비스다.
  // 유일한 상호작용은 도구 카드 검색(필터)이며, 입력은 저장하지 않는다(상태 없음 — spec 참고).
  var searchEl = document.getElementById("tool-search");
  var listEl = document.getElementById("tool-list");
  var emptyEl = document.getElementById("tool-empty");

  function normalize(s) {
    return (s || "").toLowerCase().trim();
  }

  function filterCards() {
    if (!searchEl || !listEl) return; // 카드 목록이 없는 상태에서도 조용히 실패하지 않음
    var query = normalize(searchEl.value);
    var cards = listEl.querySelectorAll(".tool-item");
    var visibleCount = 0;

    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      // data-name(영·한 키워드) + 화면에 표시된 현재 언어 텍스트 둘 다 검색 대상 — 어느 언어로 검색해도 매칭
      var haystack = normalize((card.getAttribute("data-name") || "") + " " + card.textContent);
      var match = query === "" || haystack.indexOf(query) !== -1;
      card.hidden = !match;
      if (match) visibleCount++;
    }

    // 빈 검색 결과 — 조용한 실패 금지: 명시적 안내 문구를 보여준다
    // 빈 카테고리 그룹 숨김

    var groups = listEl.querySelectorAll(".tool-group");

    for (var g = 0; g < groups.length; g++) {

      groups[g].hidden = groups[g].querySelectorAll(".tool-item:not([hidden])").length === 0;

    }

    if (emptyEl) emptyEl.hidden = visibleCount > 0;
  }

  if (searchEl) {
    searchEl.addEventListener("input", filterCards);
    // ?q= 딥링크 — WebSite SearchAction 스키마(index.html JSON-LD)의 target 이 실제로 동작해야 한다.
    // 스키마가 가리키는 URL 이 기능하지 않으면 구조화 데이터 스팸 신호가 된다.
    try {
      var q = new URLSearchParams(location.search).get("q");
      if (q) searchEl.value = q;
    } catch (e) { /* URLSearchParams 미지원 구형 브라우저 — 검색 자체는 정상 동작 */ }
    filterCards();
  }
  // TOOLJS:END
})();
