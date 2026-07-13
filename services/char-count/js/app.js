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
  var STORAGE_KEY = "char-count:last";

  var textEl   = document.getElementById("main-text");
  var goalEl   = document.getElementById("goal-count");
  var bannerEl = document.getElementById("goal-banner");

  // stat-card 내부 값 DOM 참조
  var statWithSp = document.querySelector("#sc-with-sp  .stat-val");
  var statNoSp   = document.querySelector("#sc-no-sp   .stat-val");
  var statWords  = document.querySelector("#sc-words   .stat-val");
  var statMs     = document.querySelector("#sc-ms      .stat-val");
  var statUtf8   = document.querySelector("#sc-utf8    .stat-val");
  var statEuckr  = document.querySelector("#sc-euckr   .stat-val");

  // ----- 계산 함수 -----

  /** 공백 포함 글자수 (코드포인트 기준) */
  function countWithSpace(text) {
    return Array.from(text).length;
  }

  /** 공백 제외 글자수 (코드포인트 기준) */
  function countNoSpace(text) {
    return Array.from(text.replace(/\s/g, "")).length;
  }

  /** 단어 수 — 빈 문자열이면 0 */
  function countWords(text) {
    var trimmed = text.trim();
    if (trimmed === "") return 0;
    return trimmed.split(/\s+/).filter(Boolean).length;
  }

  /** 원고지 매수 (200자 원고지, 공백 포함 기준) */
  function countManuscript(withSpLen) {
    if (withSpLen === 0) return 0;
    return Math.ceil(withSpLen / 200);
  }

  /** UTF-8 바이트 수 (TextEncoder 실측) */
  function countUtf8Bytes(text) {
    return new TextEncoder().encode(text).byteLength;
  }

  /** EUC-KR 근사 바이트 수 (한글 2byte, 나머지 1byte) */
  function countEuckrBytes(text) {
    var chars = Array.from(text);
    var total = 0;
    for (var i = 0; i < chars.length; i++) {
      total += /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(chars[i]) ? 2 : 1;
    }
    return total;
  }

  // ----- DOM 갱신 -----

  function fmt(n) {
    return n.toLocaleString("ko-KR");
  }

  function updateStats(text) {
    var withSp = countWithSpace(text);
    var noSp   = countNoSpace(text);
    var words  = countWords(text);
    var ms     = countManuscript(withSp);
    var utf8   = countUtf8Bytes(text);
    var euckr  = countEuckrBytes(text);

    statWithSp.textContent = fmt(withSp);
    statNoSp.textContent   = fmt(noSp);
    statWords.textContent  = fmt(words);
    statMs.textContent     = fmt(ms);
    statUtf8.textContent   = fmt(utf8);
    statEuckr.textContent  = fmt(euckr);

    updateGoalBanner(withSp);
  }

  function updateGoalBanner(withSpLen) {
    var raw  = goalEl ? goalEl.value.trim() : "";
    var goal = parseInt(raw, 10);

    // 목표 0/음수/비숫자 → 배너 숨김
    if (!raw || isNaN(goal) || goal <= 0) {
      if (bannerEl) bannerEl.hidden = true;
      return;
    }

    var remain = goal - withSpLen;
    if (bannerEl) {
      bannerEl.hidden = false;
      if (remain >= 0) {
        bannerEl.textContent = "잔여 " + fmt(remain) + "자";
        bannerEl.style.background = "var(--surface)";
        bannerEl.style.border     = "1px solid var(--line)";
        bannerEl.style.color      = "var(--ink)";
      } else {
        bannerEl.textContent = Math.abs(remain) + "자 초과";
        bannerEl.style.background = "#fee2e2";
        bannerEl.style.border     = "1px solid #fca5a5";
        bannerEl.style.color      = "#b91c1c";
      }
    }
  }

  // ----- localStorage 복원/저장 -----

  function saveText(text) {
    try {
      localStorage.setItem(STORAGE_KEY, text);
    } catch (e) { /* 프라이빗 모드 등 — 도구 동작에 영향 없음 */ }
  }

  function restoreText() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (typeof saved === "string" && saved.length > 0 && textEl) {
        textEl.value = saved;
        updateStats(saved);
      }
    } catch (e) { /* 손상된 값 무시 */ }
  }

  // ----- 이벤트 연결 -----

  if (textEl) {
    textEl.addEventListener("input", function () {
      var text = textEl.value;
      updateStats(text);
      saveText(text);
    });
  }

  if (goalEl) {
    goalEl.addEventListener("input", function () {
      var text = textEl ? textEl.value : "";
      var withSp = countWithSpace(text);
      updateGoalBanner(withSp);
    });
  }

  // 초기 렌더 (텍스트 없어도 0으로 표시)
  restoreText();
  if (textEl && textEl.value === "") {
    updateStats("");
  }
  // TOOLJS:END
})();
