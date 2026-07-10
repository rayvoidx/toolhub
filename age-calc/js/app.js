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
  var cfg = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "age-calc";
  var STORAGE_KEY = SLUG + ":birth";

  var ZODIAC_LIST = [
    { emoji: "🐀", name: "쥐" },
    { emoji: "🐂", name: "소" },
    { emoji: "🐅", name: "범" },
    { emoji: "🐇", name: "토끼" },
    { emoji: "🐉", name: "용" },
    { emoji: "🐍", name: "뱀" },
    { emoji: "🐎", name: "말" },
    { emoji: "🐑", name: "양" },
    { emoji: "🐒", name: "원숭이" },
    { emoji: "🐓", name: "닭" },
    { emoji: "🐕", name: "개" },
    { emoji: "🐖", name: "돼지" }
  ];

  // 만 나이 계산
  function calcInternationalAge(birthYear, birthMonth, birthDay, baseYear, baseMonth, baseDay) {
    var age = baseYear - birthYear;
    if (baseMonth < birthMonth || (baseMonth === birthMonth && baseDay < birthDay)) {
      age -= 1;
    }
    return age;
  }

  // 세는나이 (한국식)
  function calcKoreanAge(birthYear, baseYear) {
    return baseYear - birthYear + 1;
  }

  // 연나이
  function calcYearAge(birthYear, baseYear) {
    return baseYear - birthYear;
  }

  // 다음 생일 D-day 계산
  function calcDday(birthMonth, birthDay, baseYear, baseMonth, baseDay) {
    var baseDate = new Date(baseYear, baseMonth - 1, baseDay);
    var thisYearBirthday = new Date(baseYear, birthMonth - 1, birthDay);
    var targetBirthday;
    if (
      birthMonth > baseMonth ||
      (birthMonth === baseMonth && birthDay > baseDay)
    ) {
      targetBirthday = thisYearBirthday;
    } else if (birthMonth === baseMonth && birthDay === baseDay) {
      return 0; // 오늘이 생일
    } else {
      targetBirthday = new Date(baseYear + 1, birthMonth - 1, birthDay);
    }
    var diffMs = targetBirthday.getTime() - baseDate.getTime();
    return Math.ceil(diffMs / 86400000);
  }

  // 띠 계산 (양력 기준)
  function calcZodiac(birthYear) {
    var idx = ((birthYear - 4) % 12 + 12) % 12;
    return ZODIAC_LIST[idx];
  }

  // 날짜 파싱 (YYYY-MM-DD → {year, month, day})
  function parseDate(str) {
    if (!str) return null;
    var parts = str.split("-");
    if (parts.length !== 3) return null;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return { year: y, month: m, day: d };
  }

  // 오늘 날짜를 YYYY-MM-DD 로 반환
  function todayStr() {
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, "0");
    var d = String(now.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function showMessage(msg) {
    var resultEl = document.getElementById("result");
    var msgEl = document.getElementById("result-message");
    var msgText = document.getElementById("message-text");
    if (resultEl) resultEl.hidden = true;
    if (msgEl) msgEl.hidden = false;
    if (msgText) msgText.textContent = msg;
  }

  function hideMessage() {
    var msgEl = document.getElementById("result-message");
    if (msgEl) msgEl.hidden = true;
  }

  function showResult(data) {
    hideMessage();
    var resultEl = document.getElementById("result");
    if (!resultEl) return;
    resultEl.hidden = false;

    var valInt = document.getElementById("val-international");
    var valKor = document.getElementById("val-korean");
    var valYear = document.getElementById("val-year");
    var valDday = document.getElementById("val-dday");
    var unitDday = document.getElementById("unit-dday");
    var zodiacEmoji = document.getElementById("zodiac-emoji");
    var zodiacName = document.getElementById("zodiac-name");

    if (valInt) valInt.textContent = data.internationalAge;
    if (valKor) valKor.textContent = data.koreanAge;
    if (valYear) valYear.textContent = data.yearAge;

    if (data.dday === 0) {
      if (valDday) valDday.textContent = "D-0";
      if (unitDday) unitDday.textContent = "오늘이 생일입니다!";
    } else {
      if (valDday) valDday.textContent = "D-" + data.dday;
      if (unitDday) unitDday.textContent = "일 후";
    }

    if (zodiacEmoji) zodiacEmoji.textContent = data.zodiac.emoji;
    if (zodiacName) zodiacName.textContent = data.zodiac.name + "띠";
  }

  function calculate() {
    var birthInput = document.getElementById("birth-date");
    var baseInput = document.getElementById("base-date");

    if (!birthInput) return;

    var birthStr = birthInput.value;
    if (!birthStr) {
      showMessage("생년월일을 입력해 주세요.");
      return;
    }

    var birth = parseDate(birthStr);
    if (!birth) {
      showMessage("올바른 생년월일을 입력해 주세요.");
      return;
    }

    var baseStr = baseInput && baseInput.value ? baseInput.value : todayStr();
    var base = parseDate(baseStr);
    if (!base) {
      showMessage("올바른 기준일을 입력해 주세요.");
      return;
    }

    // 미래 날짜 또는 기준일이 생년월일보다 앞인 경우
    var birthTime = new Date(birth.year, birth.month - 1, birth.day).getTime();
    var baseTime = new Date(base.year, base.month - 1, base.day).getTime();

    if (baseTime < birthTime) {
      showMessage("기준일이 생년월일보다 앞입니다. 날짜를 다시 확인해 주세요.");
      return;
    }

    // localStorage 에 생년월일 저장
    try { localStorage.setItem(STORAGE_KEY, birthStr); } catch (e) { /* private mode */ }

    var intAge = calcInternationalAge(birth.year, birth.month, birth.day, base.year, base.month, base.day);
    var korAge = calcKoreanAge(birth.year, base.year);
    var yearAge = calcYearAge(birth.year, base.year);
    var dday = calcDday(birth.month, birth.day, base.year, base.month, base.day);
    var zodiac = calcZodiac(birth.year);

    showResult({
      internationalAge: intAge,
      koreanAge: korAge,
      yearAge: yearAge,
      dday: dday,
      zodiac: zodiac
    });
  }

  // 초기화 — 저장된 생년월일 복원 및 기준일 기본값 설정
  (function init() {
    var today = todayStr();

    var baseInput = document.getElementById("base-date");
    var birthInput = document.getElementById("birth-date");

    // 입력 max 값 오늘로 제한
    if (baseInput) {
      baseInput.max = today;
      baseInput.value = today;
    }
    if (birthInput) {
      birthInput.max = today;
    }

    // localStorage 에서 마지막 생년월일 복원
    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { /* noop */ }
    if (saved && birthInput) {
      birthInput.value = saved;
      // 복원된 값이 있으면 즉시 계산
      calculate();
    }

    // 계산 버튼
    var calcBtn = document.getElementById("calc-btn");
    if (calcBtn) {
      calcBtn.addEventListener("click", calculate);
    }

    // 생년월일 변경 시 자동 계산
    if (birthInput) {
      birthInput.addEventListener("change", calculate);
    }
    if (baseInput) {
      baseInput.addEventListener("change", calculate);
    }
  })();
  // TOOLJS:END
})();
