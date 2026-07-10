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
  var SLUG = cfg.slug || "dday-calc";
  var STORAGE_KEY = SLUG + ":list";
  var MAX_CARDS = 5;

  /* ---- 날짜 유틸 ---- */

  /** 오늘 날짜를 YYYY-MM-DD 로 반환 (KST 보정 없이 시스템 로컬 기준) */
  function todayStr() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + dd;
  }

  /** YYYY-MM-DD 문자열을 자정 기준 Date 로 변환 */
  function parseDate(str) {
    // new Date("YYYY-MM-DD") 는 UTC 자정이므로 로컬 자정으로 파싱
    var parts = str.split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  /** 날짜 유효성: 1970-01-01 ~ 9999-12-31 범위 */
  function isValidDate(str) {
    if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
    var d = parseDate(str);
    if (isNaN(d.getTime())) return false;
    var y = d.getFullYear();
    return y >= 1970 && y <= 9999;
  }

  /** D-day 숫자 계산: 양수=미래, 0=당일, 음수=과거 */
  function calcDiff(targetStr) {
    var today = parseDate(todayStr());
    var target = parseDate(targetStr);
    var ms = target.getTime() - today.getTime();
    return Math.round(ms / 86400000);
  }

  /** D-day 표시 문자열 생성 */
  function diffLabel(diff) {
    if (diff > 0) return "D-" + diff;
    if (diff === 0) return "D-Day";
    return "D+" + Math.abs(diff);
  }

  /**
   * 해당 연도 수능 날짜 (11월 둘째 목요일) 반환 → YYYY-MM-DD
   * 11월 1일부터 첫 번째 목요일을 찾고 +7일
   */
  function suneungDate(year) {
    var d = new Date(year, 10, 1); // 11월 1일
    // getDay(): 0=일,1=월,...,4=목
    var dow = d.getDay();
    var daysToThursday = (4 - dow + 7) % 7;
    var firstThursday = 1 + daysToThursday;
    var secondThursday = firstThursday + 7;
    var y = year;
    var m = String(11).padStart(2, "0"); // "11"
    var dd = String(secondThursday).padStart(2, "0");
    return y + "-" + m + "-" + dd;
  }

  /* ---- localStorage 폴백 ---- */
  var storageAvailable = false;
  var storageWarned = false;
  (function checkStorage() {
    try {
      localStorage.setItem(SLUG + ":_test", "1");
      localStorage.removeItem(SLUG + ":_test");
      storageAvailable = true;
    } catch (e) {
      storageAvailable = false;
    }
  })();

  // 세션 폴백용 메모리
  var sessionCards = null;

  function loadCards() {
    if (storageAvailable) {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        return [];
      }
    } else {
      return sessionCards || [];
    }
  }

  function saveCards(cards) {
    if (storageAvailable) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
      } catch (e) { /* noop */ }
    } else {
      sessionCards = cards;
      if (!storageWarned) {
        storageWarned = true;
        showFormMsg("개인정보 보호 모드에서는 날짜가 세션 동안만 유지됩니다.", false);
      }
    }
  }

  /* ---- DOM 참조 ---- */
  var dateInput = document.getElementById("dday-date");
  var nameInput = document.getElementById("dday-name");
  var addBtn = document.getElementById("dday-add-btn");
  var listEl = document.getElementById("dday-list");
  var formMsgEl = document.getElementById("dday-form-msg");
  var toastEl = document.getElementById("dday-toast");
  var presetSuneung = document.getElementById("preset-suneung");
  var presetXmas = document.getElementById("preset-xmas");
  var presetNewyear = document.getElementById("preset-newyear");

  /* ---- 안내 / 토스트 ---- */
  function showFormMsg(msg, isError) {
    if (!formMsgEl) return;
    formMsgEl.textContent = msg;
    formMsgEl.style.display = msg ? "" : "none";
    formMsgEl.style.borderColor = isError
      ? "color-mix(in srgb, #ef4444 40%, var(--line))"
      : "";
  }

  var toastTimer = null;
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.style.display = "";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.style.display = "none";
    }, 2800);
  }

  /* ---- 카드 렌더 ---- */
  function renderCards() {
    if (!listEl) return;
    var cards = loadCards();
    if (cards.length === 0) {
      listEl.innerHTML = '<p style="color:var(--muted);text-align:center;font-size:15px;">아직 추가된 날짜가 없습니다. 날짜를 선택하고 추가해 보세요.</p>';
      return;
    }
    var html = '<div style="display:flex;flex-direction:column;gap:14px;">';
    cards.forEach(function (card, idx) {
      var diff = calcDiff(card.date);
      var label = diffLabel(diff);
      var isDday = diff === 0;
      var isPast = diff < 0;
      var accentColor = isDday ? "#10b981" : (isPast ? "var(--muted)" : "var(--accent)");
      html += '<div class="result" style="position:relative;padding:18px 20px;">';
      html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;">';
      html += '<div>';
      html += '<div style="font-weight:700;font-size:14px;color:var(--muted);margin-bottom:4px;">' + escHtml(card.name) + '</div>';
      html += '<div style="font-size:clamp(32px,8vw,52px);font-weight:900;color:' + accentColor + ';letter-spacing:-0.04em;line-height:1.1;">' + escHtml(label) + '</div>';
      html += '<div style="font-size:13px;color:var(--muted);margin-top:4px;">' + formatDateKo(card.date) + '</div>';
      html += '</div>';
      html += '<button type="button" data-idx="' + idx + '" class="dday-remove-btn" aria-label="' + escHtml(card.name) + ' 삭제" style="background:none;border:1px solid var(--line);border-radius:8px;color:var(--muted);font-size:18px;width:32px;height:32px;cursor:pointer;line-height:1;flex-shrink:0;">×</button>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';
    listEl.innerHTML = html;

    // 삭제 버튼 이벤트
    var removeBtns = listEl.querySelectorAll(".dday-remove-btn");
    removeBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var i = Number(btn.getAttribute("data-idx"));
        var c = loadCards();
        c.splice(i, 1);
        saveCards(c);
        renderCards();
      });
    });
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDateKo(str) {
    var parts = str.split("-");
    return parts[0] + "년 " + Number(parts[1]) + "월 " + Number(parts[2]) + "일";
  }

  /* ---- 입력 이벤트 ---- */
  if (dateInput) {
    dateInput.addEventListener("input", function () {
      var val = dateInput.value;
      if (!val) {
        addBtn.disabled = true;
        showFormMsg("날짜를 선택하세요.", false);
        return;
      }
      if (!isValidDate(val)) {
        addBtn.disabled = true;
        showFormMsg("유효하지 않은 날짜입니다. (1970-01-01 ~ 9999-12-31)", true);
        return;
      }
      addBtn.disabled = false;
      showFormMsg("", false);
    });
  }

  if (addBtn) {
    addBtn.addEventListener("click", function () {
      var val = dateInput ? dateInput.value : "";
      if (!val) {
        showFormMsg("날짜를 선택하세요.", true);
        return;
      }
      if (!isValidDate(val)) {
        showFormMsg("유효하지 않은 날짜입니다.", true);
        return;
      }
      var cards = loadCards();
      if (cards.length >= MAX_CARDS) {
        showToast("최대 5개까지 추가 가능합니다.");
        return;
      }
      var name = (nameInput && nameInput.value.trim()) || "D-day";
      cards.push({ date: val, name: name });
      saveCards(cards);
      renderCards();
      // 폼 초기화
      if (dateInput) dateInput.value = "";
      if (nameInput) nameInput.value = "";
      addBtn.disabled = true;
      showFormMsg("", false);
    });
  }

  /* ---- 프리셋 버튼 ---- */
  function applyPreset(dateStr, name) {
    if (!dateInput) return;
    dateInput.value = dateStr;
    if (nameInput) nameInput.value = name;
    addBtn.disabled = false;
    showFormMsg("", false);
    dateInput.focus();
  }

  if (presetSuneung) {
    presetSuneung.addEventListener("click", function () {
      var today = parseDate(todayStr());
      var year = today.getFullYear();
      var thisYearSuneung = suneungDate(year);
      // 이미 지났으면 내년 수능
      if (parseDate(thisYearSuneung).getTime() < today.getTime()) {
        thisYearSuneung = suneungDate(year + 1);
      }
      applyPreset(thisYearSuneung, year + "년 수능");
    });
  }

  if (presetXmas) {
    presetXmas.addEventListener("click", function () {
      var year = new Date().getFullYear();
      var xmas = year + "-12-25";
      if (parseDate(xmas).getTime() < parseDate(todayStr()).getTime()) {
        xmas = (year + 1) + "-12-25";
      }
      applyPreset(xmas, "크리스마스");
    });
  }

  if (presetNewyear) {
    presetNewyear.addEventListener("click", function () {
      var year = new Date().getFullYear() + 1;
      applyPreset(year + "-01-01", year + "년 새해");
    });
  }

  /* ---- 초기화 ---- */
  // 날짜 입력 없는 상태에서 안내 표시
  showFormMsg("날짜를 선택하세요.", false);
  renderCards();

  /* ---- 실시간 갱신 (1분마다) ---- */
  var lastDate = todayStr();
  setInterval(function () {
    var current = todayStr();
    if (current !== lastDate) {
      lastDate = current;
    }
    renderCards();
  }, 60000);
  // TOOLJS:END
})();
