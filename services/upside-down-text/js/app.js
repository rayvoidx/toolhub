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
  /* Upside Down Text Generator — 입력 한 번으로 3가지 변환을 항상 동시에 계산해 카드로 보여준다.
     upsideDown : 문자별 뒤집힌 유니코드 대체 글리프로 치환 + 줄 내부 문자 순서 반전 + 줄 순서 자체도 반전
                  (실제로 종이를 180도 돌리면 마지막 줄이 맨 위로 오는 것과 같은 원리)
     mirror     : 좌우 거울상에 가까운 소수의 유니코드 대체 글리프만 치환 + 줄 내부 문자 순서 반전
                  (거울은 좌우만 뒤집으므로 줄 순서는 그대로 둔다 — upsideDown과의 핵심 차이, FAQ 참고)
     smallCaps  : 소문자만 작은 대문자 모양 글리프로 치환, 순서 변경 없음 (스타일 치환일 뿐)
     세 변환 모두 "진짜 글자를 회전/반사한 것이 아니라 모양이 비슷한 다른 유니코드 문자로
     바꿔치기"한 것이다 — 표준 폰트 렌더링 한계·스크린리더 오독 가능성을 FAQ/안내 문구에
     정직하게 밝힌다. 상태: localStorage "<slug>:last" / "<slug>:remember" 만. 외부 API 없음. */

  /* ---- 업사이드다운(뒤집기) 문자 맵 — 세로 180도 회전 모양과 닮은 유니코드 문자로 치환.
     완벽한 회전 글리프가 없는 문자(Q, X, 숫자 대부분 등)는 근사치이며, 매핑에 없는 문자는
     원문 그대로 통과시킨다(조용히 깨지지 않되 완전한 변환도 아님 — FAQ에 명시). */
  var UPSIDE_MAP = {
    a: "ɐ", b: "q", c: "ɔ", d: "p", e: "ǝ", f: "ɟ", g: "ƃ", h: "ɥ", i: "ᴉ", j: "ɾ",
    k: "ʞ", l: "l", m: "ɯ", n: "u", o: "o", p: "d", q: "b", r: "ɹ", s: "s", t: "ʇ",
    u: "n", v: "ʌ", w: "ʍ", x: "x", y: "ʎ", z: "z",
    A: "Ɐ", B: "𐐒", C: "Ɔ", D: "ᗡ", E: "Ǝ", F: "Ⅎ", G: "⅁", H: "H", I: "I", J: "ſ",
    K: "ʞ", L: "˥", M: "W", N: "N", O: "O", P: "Ԁ", Q: "Ό", R: "ᴚ", S: "S", T: "⊥",
    U: "∩", V: "Λ", W: "M", X: "X", Y: "⅄", Z: "Z",
    "0": "0", "1": "Ɩ", "2": "ᄅ", "3": "Ɛ", "4": "ㄣ", "5": "ϛ", "6": "9", "7": "ㄥ", "8": "8", "9": "6",
    ".": "˙", ",": "'", "'": ",", "\"": "„", "`": ",", "!": "¡", "?": "¿",
    "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{",
    "<": ">", ">": "<", "&": "⅋", "_": "‾", ";": "؛"
  };

  /* ---- 미러(좌우 거울상) 문자 맵 — 라틴 알파벳 대부분은 좌우로 뒤집었을 때를 닮은
     별도 유니코드 문자가 아예 없다(대칭이 아니라서 대체 글리프를 만들 수 없음). 그래서
     아래 소수의 "진짜 거울 짝"이 존재하는 문자만 치환하고 나머지는 원문 그대로 둔다.
     b/d/p/q처럼 흔한 글자일수록 그럴듯해 보이지만, 짧은 단어일수록 효과가 뚜렷하다. */
  var MIRROR_MAP = {
    b: "d", d: "b", p: "q", q: "p",
    S: "Ƨ", "Ƨ": "S", s: "ƨ", "ƨ": "s",
    C: "Ɔ", c: "ɔ", E: "Ǝ", e: "ǝ",
    N: "И", R: "Я", "3": "Ɛ", "&": "⅋"
  };

  /* ---- 스몰캡스(작은 대문자) 문자 맵 — 소문자만 대문자를 축소한 모양의 유니코드
     "modifier letter"로 치환한다(순서 변경 없음, 스타일만 바뀜). q/x는 폭넓게 지원되는
     스몰캡스 글리프가 없어(q는 유니코드 14에 추가됐지만 구형 폰트는 네모(tofu)로 보일 수
     있음) 원문 그대로 둔다 — FAQ에 명시. */
  var SMALLCAPS_MAP = {
    a: "ᴀ", b: "ʙ", c: "ᴄ", d: "ᴅ", e: "ᴇ", f: "ꜰ", g: "ɢ", h: "ʜ", i: "ɪ", j: "ᴊ",
    k: "ᴋ", l: "ʟ", m: "ᴍ", n: "ɴ", o: "ᴏ", p: "ᴘ", q: "ꞯ", r: "ʀ", s: "ꜱ", t: "ᴛ",
    u: "ᴜ", v: "ᴠ", w: "ᴡ", x: "x", y: "ʏ", z: "ᴢ"
  };

  var MAX_LEN = 5000; // 극단값 캡 — textarea maxlength와 동일, 성능/표시 한도

  // ----- 순수 변환 함수 (모두 브라우저 로컬, 외부 API 0) -----
  // Array.from 은 UTF-16 서로게이트 쌍을 코드포인트 단위로 묶어 순회하므로 대부분의
  // 이모지가 반쪽으로 잘리지 않는다(ZWJ 합성 이모지는 예외 — FAQ 참고, reverse-text와 동일 원리).
  function mapChars(str, map) {
    return Array.from(str).map(function (ch) {
      return Object.prototype.hasOwnProperty.call(map, ch) ? map[ch] : ch;
    }).join("");
  }
  function reverseCP(str) {
    return Array.from(str).reverse().join("");
  }
  /** 업사이드다운 — 줄마다 문자 치환 + 문자 순서 반전을 하고, 마지막에 줄 자체의 순서도 뒤집는다. */
  function upsideDown(text) {
    var lines = String(text).split("\n");
    var out = lines.map(function (line) { return reverseCP(mapChars(line, UPSIDE_MAP)); });
    return out.reverse().join("\n");
  }
  /** 미러 — 줄마다 문자 치환(소수) + 문자 순서만 반전한다. 줄 순서는 그대로(거울은 좌우만 뒤집음). */
  function mirrorText(text) {
    var lines = String(text).split("\n");
    var out = lines.map(function (line) { return reverseCP(mapChars(line, MIRROR_MAP)); });
    return out.join("\n");
  }
  /** 스몰캡스 — 순서 변경 없이 소문자만 치환한다. */
  function smallCaps(text) {
    return mapChars(String(text), SMALLCAPS_MAP);
  }

  var MODES = [
    { id: "upside", fn: upsideDown },
    { id: "mirror", fn: mirrorText },
    { id: "smallcaps", fn: smallCaps }
  ];

  var PLACEHOLDER = "—"; // 빈 입력일 때 카드에 표시(조용한 실패 금지)

  var cfg = window.APP_CONFIG || {};
  var TEXT_KEY = (cfg.slug || "upside-down-text") + ":last";
  var REMEMBER_KEY = (cfg.slug || "upside-down-text") + ":remember";

  function $(id) { return document.getElementById(id); }
  var inputEl = $("udt-text");
  var clearEl = $("udt-clear");
  var rememberEl = $("udt-remember");
  var countEl = $("udt-count");
  var feedbackEl = $("udt-feedback");
  var grid = $("udt-grid");
  if (!inputEl || !grid) return;

  // ----- i18n 헬퍼 -----
  function t(key) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v == null ? key : v;
  }

  // 결과 값 캐시(복사용) + DOM 참조 캐시
  var values = {};
  var valEls = {};
  MODES.forEach(function (m) {
    valEls[m.id] = document.querySelector("#udt-" + m.id + " .udt-val");
  });

  function setVal(id, value) {
    values[id] = value;
    var el = valEls[id];
    if (el) el.textContent = value.length ? value : PLACEHOLDER;
  }

  function updateCount(len) {
    if (!countEl) return;
    countEl.textContent = t("tool.count").replace("{n}", String(len)).replace("{max}", String(MAX_LEN));
  }

  function render() {
    var raw = inputEl.value || "";
    if (raw.length > MAX_LEN) raw = raw.slice(0, MAX_LEN); // 극단값 캡 — 조용히 자르되 카운터로 알림
    for (var i = 0; i < MODES.length; i++) setVal(MODES[i].id, MODES[i].fn(raw));
    updateCount(raw.length);
  }

  // ----- 복사 (navigator.clipboard 우선, execCommand 폴백) -----
  var feedbackTimer = null;
  function showFeedback(msg, isError) {
    if (!feedbackEl) return;
    feedbackEl.hidden = false;
    feedbackEl.textContent = msg;
    feedbackEl.style.color = isError ? "#b91c1c" : "var(--accent)";
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(function () { feedbackEl.hidden = true; }, 2000);
  }

  function fallbackCopy(value) {
    try {
      var ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) showFeedback(t("tool.copied"), false);
      else showFeedback(t("tool.copyError"), true);
    } catch (e) {
      showFeedback(t("tool.copyError"), true);
    }
  }

  function copyValue(value) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(
        function () { showFeedback(t("tool.copied"), false); },
        function () { fallbackCopy(value); }
      );
    } else {
      fallbackCopy(value);
    }
  }

  function onCardClick(e) {
    var card = e.target && e.target.closest ? e.target.closest(".udt-card") : null;
    if (!card || !card.id) return;
    var id = card.id.replace(/^udt-/, "");
    var value = values[id];
    if (!value || value.length === 0) { // 빈 입력 → 조용한 실패 대신 안내
      showFeedback(t("tool.emptyCopy"), true);
      return;
    }
    copyValue(value);
  }
  grid.addEventListener("click", onCardClick);

  // ----- localStorage 저장/복원 (저장 거부 시 세션 메모리만 유지) -----
  function shouldRemember() { return !rememberEl || rememberEl.checked; }

  function saveText(text) {
    if (!shouldRemember()) return;
    try { localStorage.setItem(TEXT_KEY, text); } catch (e) { /* private mode */ }
  }

  function loadPrefs() {
    try {
      var r = localStorage.getItem(REMEMBER_KEY);
      if (rememberEl) rememberEl.checked = (r !== "0");
    } catch (e) { /* noop */ }
    if (shouldRemember()) {
      try {
        var savedText = localStorage.getItem(TEXT_KEY);
        if (typeof savedText === "string" && savedText.length > 0) inputEl.value = savedText;
      } catch (e) { /* 손상된 값 무시 */ }
    }
  }

  // ----- 이벤트 -----
  inputEl.addEventListener("input", function () {
    render();
    saveText(inputEl.value);
  });
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) render(); // IME 확정 등 엣지케이스 대비(입력은 이미 실시간 반영)
  });

  if (clearEl) {
    clearEl.addEventListener("click", function () {
      inputEl.value = "";
      inputEl.focus();
      render();
      try { if (shouldRemember()) localStorage.removeItem(TEXT_KEY); } catch (e) { /* noop */ }
    });
  }

  if (rememberEl) {
    rememberEl.addEventListener("change", function () {
      try { localStorage.setItem(REMEMBER_KEY, rememberEl.checked ? "1" : "0"); } catch (e) { /* noop */ }
      if (rememberEl.checked) {
        saveText(inputEl.value);
      } else {
        try { localStorage.removeItem(TEXT_KEY); } catch (e) { /* noop */ } // 저장본만 삭제, 화면 텍스트는 유지
      }
    });
  }

  // 언어 전환 시 카운터 문구만 다시 조립(결과 값 자체는 언어 무관)
  document.addEventListener("i18n:change", function () { updateCount((inputEl.value || "").length); });

  // 초기화
  loadPrefs();
  render();
  // TOOLJS:END
})();
