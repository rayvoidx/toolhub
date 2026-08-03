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
  // leap-year-checker — 연도 입력 → 윤년 판정(규칙 분해) + 범위 내 윤년 목록 +
  // 오늘 기준 다음/이전 윤년. 외부 API 없음, 모든 계산은 로컬(그레고리력 기준).
  var cfg = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "leap-year-checker";
  var STATE_KEY = SLUG + ":state";
  var YEAR_MIN = 1, YEAR_MAX = 9999;
  var RANGE_MAX_SPAN = 2000;  // 범위 목록 상한 (극단값 방어) — 2000년 구간의 윤년은 최대 ~485개
  var RANGE_LIST_CAP = 600;   // 화면에 그리는 칩 개수 상한 (span 상한의 윤년 수보다 커서 사실상 전부 렌더)

  /* ---- i18n 헬퍼 ---- */
  function t(key) {
    var s = window.I18N && window.I18N.t(key);
    return s != null ? s : key;
  }
  function fmtStr(s, params) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return params && params[k] != null ? String(params[k]) : m;
    });
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }

  /* ---- 순수 윤년 로직 (node 단위 검증 대상) ---- */

  // 그레고리력 규칙: 4로 나누어떨어지고, 100으로 나누어떨어지지 않거나, 400으로 나누어떨어지면 윤년.
  function isLeap(year) {
    year = Math.trunc(year);
    if (year % 400 === 0) return true;
    if (year % 100 === 0) return false;
    return year % 4 === 0;
  }
  // 판정에 쓰인 분기 케이스 — UI 설명 문구 선택에 사용.
  function leapCase(year) {
    year = Math.trunc(year);
    if (year % 400 === 0) return "leap400";
    if (year % 100 === 0) return "century";
    if (year % 4 === 0) return "leap4";
    return "not4";
  }
  // year 다음(초과) 첫 윤년. 윤년은 늦어도 4년 안에 재발하므로 루프는 항상 종료된다.
  function nextLeapYear(year) {
    var y = Math.trunc(year) + 1;
    while (!isLeap(y)) y++;
    return y;
  }
  // year 이전(미만) 마지막 윤년.
  function prevLeapYear(year) {
    var y = Math.trunc(year) - 1;
    while (!isLeap(y)) y--;
    return y;
  }
  // [from, to] 구간(포함)의 윤년 목록. from>to 면 빈 배열.
  function leapYearsInRange(from, to) {
    var out = [];
    for (var y = from; y <= to; y++) if (isLeap(y)) out.push(y);
    return out;
  }
  // 입력 문자열 → 정수 연도. 공백/콤마/소수/비숫자/범위 밖은 null.
  function parseYear(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!/^-?\d+$/.test(s)) return null;
    var n = parseInt(s, 10);
    if (!isFinite(n) || n < YEAR_MIN || n > YEAR_MAX) return null;
    return n;
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      isLeap: isLeap, leapCase: leapCase, nextLeapYear: nextLeapYear,
      prevLeapYear: prevLeapYear, leapYearsInRange: leapYearsInRange, parseYear: parseYear
    };
    return;
  }

  /* ---- 상태 저장 (localStorage, 단일 JSON 키) ---- */
  var storageOk = true;
  (function () { try { localStorage.setItem(SLUG + ":_t", "1"); localStorage.removeItem(SLUG + ":_t"); } catch (e) { storageOk = false; } })();
  function readState() {
    if (!storageOk) return {};
    try { var r = localStorage.getItem(STATE_KEY); return r ? JSON.parse(r) : {}; } catch (e) { return {}; }
  }
  function persist(state) {
    if (!storageOk) return;
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) { /* quota/private mode */ }
  }

  /* ---- DOM 참조 ---- */
  function $(id) { return document.getElementById(id); }
  var yearEl = $("lyc-year"), errEl = $("lyc-year-err");
  var resultEl = $("lyc-result");
  var badgeEl = $("lyc-badge");
  var ruleDiv4 = $("lyc-rule-div4"), ruleDiv100 = $("lyc-rule-div100"), ruleDiv400 = $("lyc-rule-div400");
  var explainEl = $("lyc-explain"), nearestEl = $("lyc-nearest");
  var febValEl = $("lyc-feb-val"), daysValEl = $("lyc-days-val");

  var fromEl = $("lyc-range-from"), toEl = $("lyc-range-to");
  var rangeErrEl = $("lyc-range-err"), rangeSummaryEl = $("lyc-range-summary"), rangeListEl = $("lyc-range-list");

  var todaySummaryEl = $("lyc-today-summary"), thisYearEl = $("lyc-thisyear");
  var nextValEl = $("lyc-next-val"), prevValEl = $("lyc-prev-val");

  if (!yearEl || !resultEl || !fromEl || !toEl) return;

  function escHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---- 규칙 행 렌더 ---- */
  function setRuleRow(row, state, label) {
    // state: "yes" | "no" | "na"
    if (!row) return;
    var ic = row.querySelector(".ic");
    var lb = row.querySelector(".lb");
    row.classList.toggle("dim", state === "na");
    if (ic) {
      ic.className = "ic " + state;
      ic.textContent = state === "yes" ? "✓" : (state === "no" ? "✕" : "–");
    }
    if (lb) lb.textContent = label;
  }

  /* ---- 섹션 A: 연도 판정 ---- */
  function renderCheck() {
    var raw = yearEl.value;
    if (raw == null || String(raw).trim() === "") {
      resultEl.hidden = true;
      if (errEl) { errEl.hidden = true; }
      return;
    }
    var year = parseYear(raw);
    if (year == null) {
      resultEl.hidden = true;
      if (errEl) { errEl.hidden = false; errEl.textContent = t("tool.err.year"); }
      return;
    }
    if (errEl) errEl.hidden = true;
    resultEl.hidden = false;

    var kase = leapCase(year);
    var leap = kase === "leap400" || kase === "leap4";

    if (badgeEl) {
      badgeEl.className = "lyc-badge " + (leap ? "yes" : "no");
      badgeEl.textContent = fmtStr(t(leap ? "tool.result.yes" : "tool.result.no"), { year: year });
    }

    // 규칙 분해: 4로 나누어떨어지는지 → (그렇다면) 100으로 나누어떨어지는지 → (그렇다면) 400으로 나누어떨어지는지
    var div4 = year % 4 === 0;
    var div100 = div4 && year % 100 === 0;
    var div400 = div100 && year % 400 === 0;
    setRuleRow(ruleDiv4, div4 ? "yes" : "no", t("tool.rule.div4.q"));
    setRuleRow(ruleDiv100, div4 ? (div100 ? "yes" : "no") : "na", t("tool.rule.div100.q"));
    setRuleRow(ruleDiv400, div100 ? (div400 ? "yes" : "no") : "na", t("tool.rule.div400.q"));

    if (explainEl) {
      var explainKey = "tool.explain." + kase;
      explainEl.textContent = fmtStr(t(explainKey), { year: year });
    }

    if (nearestEl) {
      // 입력 연도 기준 앞뒤 가장 가까운 윤년. 둘 다 유효 범위(1~9999) 안일 때만 표시한다.
      var pv = prevLeapYear(year), nx = nextLeapYear(year);
      if (pv >= YEAR_MIN && nx <= YEAR_MAX) {
        nearestEl.hidden = false;
        nearestEl.textContent = fmtStr(t("tool.check.nearest"), { prev: pv, next: nx });
      } else {
        nearestEl.hidden = true;
      }
    }

    if (febValEl) febValEl.textContent = leap ? "29" : "28";
    if (daysValEl) daysValEl.textContent = leap ? "366" : "365";
  }

  /* ---- 섹션 B: 범위 내 윤년 목록 ---- */
  function renderRange() {
    var fromRaw = fromEl.value, toRaw = toEl.value;
    rangeErrEl.hidden = true;
    rangeSummaryEl.hidden = true;
    rangeListEl.hidden = true;
    rangeListEl.textContent = "";

    if (fromRaw == null || String(fromRaw).trim() === "" || toRaw == null || String(toRaw).trim() === "") {
      return; // 빈 입력 — 조용히 대기 (오류 아님)
    }
    var from = parseYear(fromRaw), to = parseYear(toRaw);
    if (from == null || to == null) {
      rangeErrEl.hidden = false;
      rangeErrEl.textContent = t("tool.range.err.value");
      return;
    }
    if (to < from) {
      rangeErrEl.hidden = false;
      rangeErrEl.textContent = t("tool.range.err.order");
      return;
    }
    if (to - from > RANGE_MAX_SPAN) {
      rangeErrEl.hidden = false;
      rangeErrEl.textContent = t("tool.range.err.span");
      return;
    }

    var list = leapYearsInRange(from, to);
    rangeSummaryEl.hidden = false;
    rangeSummaryEl.textContent = fmtStr(t(list.length === 0 ? "tool.range.result.zero" : "tool.range.result.count"),
      { count: list.length, from: from, to: to });

    if (list.length > 0) {
      var frag = document.createDocumentFragment();
      var capped = list.slice(0, RANGE_LIST_CAP);
      for (var i = 0; i < capped.length; i++) {
        var chip = document.createElement("span");
        chip.className = "lyc-chip";
        chip.textContent = String(capped[i]);
        frag.appendChild(chip);
      }
      rangeListEl.appendChild(frag);
      rangeListEl.hidden = false;
    }
  }

  /* ---- 섹션 C: 오늘 기준 다음/이전 윤년 (입력과 무관 — 실행 시점의 실제 오늘) ---- */
  function renderToday() {
    var now = new Date();
    var y = now.getFullYear();

    if (todaySummaryEl) {
      var dateStr;
      try { dateStr = new Intl.DateTimeFormat(uiLang(), { year: "numeric", month: "long", day: "numeric" }).format(now); }
      catch (e) { dateStr = now.toISOString().slice(0, 10); }
      todaySummaryEl.textContent = fmtStr(t("tool.today.summary"), { date: dateStr });
    }
    if (thisYearEl) {
      thisYearEl.textContent = fmtStr(t(isLeap(y) ? "tool.thisyear.leap" : "tool.thisyear.notleap"), { year: y });
    }
    if (nextValEl) {
      var ny = nextLeapYear(y);
      nextValEl.textContent = fmtStr(t("tool.next.value"), { year: ny, n: ny - y });
    }
    if (prevValEl) {
      var py = prevLeapYear(y);
      prevValEl.textContent = fmtStr(t("tool.prev.value"), { year: py, n: y - py });
    }
  }

  /* ---- 상태 저장 ---- */
  function saveState() {
    persist({ year: yearEl.value || "", from: fromEl.value || "", to: toEl.value || "" });
  }

  /* ---- 이벤트 ---- */
  yearEl.addEventListener("input", function () { saveState(); renderCheck(); });
  fromEl.addEventListener("input", function () { saveState(); renderRange(); });
  toEl.addEventListener("input", function () { saveState(); renderRange(); });

  // 언어 전환 시 전 구간 재렌더 (설명·라벨·날짜 포맷이 언어에 의존)
  document.addEventListener("i18n:change", function () {
    renderCheck();
    renderRange();
    renderToday();
  });

  /* ---- 초기화: 저장값 복원, 없으면 스마트 기본값(현재 연도 / 현재~+20) ---- */
  (function init() {
    var nowY = new Date().getFullYear();
    var saved = readState();
    var okYear = saved.year != null && parseYear(saved.year) != null;
    yearEl.value = okYear ? saved.year : String(nowY);

    var okFrom = saved.from != null && parseYear(saved.from) != null;
    var okTo = saved.to != null && parseYear(saved.to) != null;
    fromEl.value = okFrom ? saved.from : String(nowY);
    toEl.value = okTo ? saved.to : String(Math.min(YEAR_MAX, nowY + 20));

    renderCheck();
    renderRange();
    renderToday();
  })();
  // TOOLJS:END
})();
