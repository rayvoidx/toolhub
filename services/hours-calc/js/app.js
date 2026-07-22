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
  /* Hours Calculator — 두 시각의 근무시간 계산(휴게시간 차감, 야간 근무 자동 롤오버) +
     시각에 시/분을 더하거나 빼는 모드. 상태는 localStorage "<slug>:state" 하나에만 저장.
     외부 API 없음, 모든 계산은 로컬(정수 분 단위 산술). */
  var CFG = window.APP_CONFIG || {};
  var SLUG = CFG.slug || "hours-calc";
  var MIN_DAY = 1440; // 24h in minutes

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */

  // "HH:MM"(24h, <input type=time> 의 표준 값) → 0~1439 분. 형식 오류·빈값은 null
  function parseTimeValue(v) {
    if (v == null) return null;
    var m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(v).trim());
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  // 음수·소수·콤마·빈값을 견디는 정수 파서: 절대값 → 내림 → [min,max] 로 캡. 파싱 실패는 fallback
  function clampInt(raw, min, max, fallback) {
    if (raw == null || String(raw).trim() === "") return fallback;
    var n = parseFloat(String(raw).replace(/,/g, "").trim());
    if (!isFinite(n)) return fallback;
    n = Math.floor(Math.abs(n));
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
  }

  // 부동소수 오차 제거 후 소수 둘째 자리 반올림
  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /**
   * 시작~종료 시각 구간 계산.
   * end < start 면 다음날로 롤오버(overnight=true, 에러 아님 — 야간 근무의 정상 케이스).
   * end === start 는 0분 구간(같은 시각, overnight 아님)으로 취급.
   * 휴게시간이 총 구간보다 길면 구간 길이로 캡(clamped=true, 순 근무 0분, 음수 금지).
   */
  function computeDuration(startMin, endMin, breakMin) {
    var overnight = endMin < startMin;
    var same = endMin === startMin;
    var gross = endMin - startMin;
    if (overnight) gross += MIN_DAY;
    var clamped = breakMin > gross;
    var usedBreak = clamped ? gross : breakMin;
    var net = gross - usedBreak;
    return {
      overnight: overnight, same: same,
      gross: gross, usedBreak: usedBreak, clamped: clamped, net: net
    };
  }

  // 총분 → {h, m} (min 은 0 이상 정수 가정)
  function minutesToParts(min) {
    return { h: Math.floor(min / 60), m: min % 60 };
  }

  // 총분 → 소수 시간 (7h30m → 7.5)
  function decimalHours(min) {
    return round2(min / 60);
  }

  /**
   * 기준 시각에 분 단위 델타를 가산/감산. sign 은 +1(더하기)/-1(빼기).
   * 결과는 항상 [0,1440) 로 정규화되고, dayOffset 은 며칠 이동했는지(음수 가능) 를 알려준다.
   * Math.floor 기반 나눗셈이라 음수 raw(자정 이전으로 빼기)에서도 올바르게 이전 날로 롤오버된다.
   */
  function addSubtract(baseMin, deltaMin, sign) {
    var raw = baseMin + sign * deltaMin;
    var dayOffset = Math.floor(raw / MIN_DAY);
    var resultMin = raw - dayOffset * MIN_DAY;
    return { resultMin: resultMin, dayOffset: dayOffset };
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseTimeValue: parseTimeValue, clampInt: clampInt, round2: round2,
      computeDuration: computeDuration, minutesToParts: minutesToParts,
      decimalHours: decimalHours, addSubtract: addSubtract
    };
    return;
  }

  /* ---- i18n · 포맷 헬퍼 ---- */
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmt(str, params) {
    return String(str).replace(/\{(\w+)\}/g, function (m, k) {
      return params && params[k] != null ? String(params[k]) : m;
    });
  }
  function nf(n) {
    try { return Number(n).toLocaleString(uiLang(), { maximumFractionDigits: 2 }); }
    catch (e) { return String(n); }
  }
  function pad2(n) { n = String(n); return n.length < 2 ? "0" + n : n; }
  function fmtHM(min) {
    var p = minutesToParts(min);
    return fmt(tr("tool.fmt.hm", "{h}h {m}m"), { h: nf(p.h), m: nf(p.m) });
  }
  // 24h 분 오프셋 → 로케일 존중 시각 문자열 (en-US 는 12h AM/PM, 대부분 다른 로케일은 24h)
  function fmtClock(min) {
    try {
      var d = new Date(2000, 0, 1, Math.floor(min / 60), min % 60);
      return new Intl.DateTimeFormat(uiLang(), { hour: "numeric", minute: "2-digit" }).format(d);
    } catch (e) {
      return pad2(Math.floor(min / 60)) + ":" + pad2(min % 60);
    }
  }

  /* ---- 상태 저장 (localStorage, 단일 JSON 키) ---- */
  var SKEY = SLUG + ":state";
  function loadState() {
    try {
      var raw = localStorage.getItem(SKEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; } // private mode / 손상된 JSON — 빈 상태로 계속
  }
  function saveState(patch) {
    try {
      var cur = loadState();
      for (var k in patch) { if (Object.prototype.hasOwnProperty.call(patch, k)) cur[k] = patch[k]; }
      localStorage.setItem(SKEY, JSON.stringify(cur));
    } catch (e) { /* noop */ }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var tabDur = $("hc-tab-dur"), tabAddsub = $("hc-tab-addsub");
  var panelDur = $("hc-panel-dur"), panelAddsub = $("hc-panel-addsub");

  var startEl = $("hc-start"), endEl = $("hc-end"), breakEl = $("hc-break");
  var durEmpty = $("hc-dur-empty"), durBody = $("hc-dur-body");
  var netCard = $("hc-dur-net-card"), decCard = $("hc-dur-dec-card");
  var netEl = $("hc-dur-net"), decEl = $("hc-dur-decimal");
  var breakdownEl = $("hc-dur-breakdown");
  var overnightEl = $("hc-dur-overnight"), sameEl = $("hc-dur-same"), clampedEl = $("hc-dur-clamped");

  var baseEl = $("hc-base");
  var opAddBtn = $("hc-op-add"), opSubBtn = $("hc-op-sub");
  var addHoursEl = $("hc-add-hours"), addMinutesEl = $("hc-add-minutes");
  var asEmpty = $("hc-as-empty"), asBody = $("hc-as-body");
  var asCard = $("hc-as-card"), asValueEl = $("hc-as-value"), asDayEl = $("hc-as-day");

  if (!startEl || !endEl || !baseEl) return;

  var DUR_PLACEHOLDER = durEmpty.textContent;
  var AS_PLACEHOLDER = asEmpty.textContent;

  var currentMode = "duration";
  var currentOp = "add";

  /* ---- 탭 전환 ---- */
  function setMode(mode) {
    currentMode = mode;
    var isDur = mode === "duration";
    if (tabDur) { tabDur.classList.toggle("is-active", isDur); tabDur.setAttribute("aria-selected", isDur ? "true" : "false"); }
    if (tabAddsub) { tabAddsub.classList.toggle("is-active", !isDur); tabAddsub.setAttribute("aria-selected", !isDur ? "true" : "false"); }
    if (panelDur) panelDur.hidden = !isDur;
    if (panelAddsub) panelAddsub.hidden = isDur;
    saveState({ mode: mode });
  }
  if (tabDur) tabDur.addEventListener("click", function () { setMode("duration"); });
  if (tabAddsub) tabAddsub.addEventListener("click", function () { setMode("addsub"); });

  /* ---- 가산/감산 연산자 토글 ---- */
  function setOp(op) {
    currentOp = op;
    if (opAddBtn) { opAddBtn.classList.toggle("is-active", op === "add"); opAddBtn.setAttribute("aria-pressed", op === "add" ? "true" : "false"); }
    if (opSubBtn) { opSubBtn.classList.toggle("is-active", op === "subtract"); opSubBtn.setAttribute("aria-pressed", op === "subtract" ? "true" : "false"); }
    saveState({ op: op });
    renderAddSub();
  }
  if (opAddBtn) opAddBtn.addEventListener("click", function () { setOp("add"); });
  if (opSubBtn) opSubBtn.addEventListener("click", function () { setOp("subtract"); });

  /* ---- 렌더: 구간 모드 ---- */
  function renderDuration() {
    if (!durEmpty || !durBody) return;
    var sv = startEl.value, ev = endEl.value;

    if (!sv || !ev) {
      durEmpty.textContent = DUR_PLACEHOLDER;
      durEmpty.hidden = false;
      durBody.hidden = true;
      return;
    }
    var s = parseTimeValue(sv), e = parseTimeValue(ev);
    if (s == null || e == null) {
      durEmpty.textContent = tr("tool.err.invalidTime", "That doesn't look like a valid time.");
      durEmpty.hidden = false;
      durBody.hidden = true;
      return;
    }

    var breakMin = clampInt(breakEl ? breakEl.value : "", 0, MIN_DAY, 0);
    var r = computeDuration(s, e, breakMin);

    if (netEl) netEl.textContent = fmtHM(r.net);
    if (decEl) decEl.textContent = fmt(tr("tool.fmt.decimal", "{n} h"), { n: nf(decimalHours(r.net)) });
    if (netCard) netCard.setAttribute("data-value", netEl ? netEl.textContent : "");
    if (decCard) decCard.setAttribute("data-value", decEl ? decEl.textContent : "");

    if (breakdownEl) {
      if (r.usedBreak > 0) {
        breakdownEl.textContent = fmt(tr("tool.res.breakdown", "{gross} gross − {brk} break = {net} net"), {
          gross: fmtHM(r.gross), brk: fmtHM(r.usedBreak), net: fmtHM(r.net)
        });
        breakdownEl.hidden = false;
      } else {
        breakdownEl.hidden = true;
      }
    }
    if (overnightEl) overnightEl.hidden = !r.overnight;
    if (sameEl) sameEl.hidden = !(r.same && !r.overnight);
    if (clampedEl) {
      if (r.clamped) {
        clampedEl.textContent = fmt(tr("tool.note.clamped", "The break ({brk}) was longer than the shift, so it's capped — net duration is 0h 0m."), { brk: fmtHM(breakMin) });
        clampedEl.hidden = false;
      } else {
        clampedEl.hidden = true;
      }
    }

    durEmpty.hidden = true;
    durBody.hidden = false;
  }

  /* ---- 렌더: 가산/감산 모드 ---- */
  function renderAddSub() {
    if (!asEmpty || !asBody) return;
    var bv = baseEl.value;
    if (!bv) {
      asEmpty.textContent = AS_PLACEHOLDER;
      asEmpty.hidden = false;
      asBody.hidden = true;
      return;
    }
    var b = parseTimeValue(bv);
    if (b == null) {
      asEmpty.textContent = tr("tool.err.invalidTime", "That doesn't look like a valid time.");
      asEmpty.hidden = false;
      asBody.hidden = true;
      return;
    }

    var hours = clampInt(addHoursEl ? addHoursEl.value : "", 0, 999999, 0);
    var minutes = clampInt(addMinutesEl ? addMinutesEl.value : "", 0, 999999, 0);
    var delta = hours * 60 + minutes;
    var sign = currentOp === "subtract" ? -1 : 1;
    var res = addSubtract(b, delta, sign);
    var text = fmtClock(res.resultMin);

    if (asValueEl) asValueEl.textContent = text;
    if (asCard) asCard.setAttribute("data-value", text);
    if (asDayEl) {
      if (res.dayOffset === 0) {
        asDayEl.textContent = tr("tool.day.same", "Same day");
      } else {
        var signStr = res.dayOffset > 0 ? "+" : "−";
        asDayEl.textContent = fmt(tr("tool.day.label", "Day offset: {n}"), { n: signStr + nf(Math.abs(res.dayOffset)) });
      }
    }

    asEmpty.hidden = true;
    asBody.hidden = false;
  }

  function renderAll() { renderDuration(); renderAddSub(); }

  /* ---- 클릭 복사 (카드에 표시된 값을 그대로 복사) ---- */
  var copiedTimers = {};
  function flashCopied(card) {
    var labelEl = card.querySelector(".hc-clabel");
    if (!labelEl) return;
    var key = labelEl.getAttribute("data-i18n");
    labelEl.textContent = tr("tool.copied", "Copied");
    if (copiedTimers[key]) clearTimeout(copiedTimers[key]);
    copiedTimers[key] = setTimeout(function () {
      labelEl.textContent = tr(key, labelEl.textContent);
    }, 1100);
  }
  function legacyCopy(text, done) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch (e) { /* 복사 미지원 — 표시값은 그대로 남는다 (조용한 실패 아님) */ }
  }
  function copyCard(card) {
    var raw = card.getAttribute("data-value");
    if (raw == null) return;
    var done = function () { flashCopied(card); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(raw).then(done, function () { legacyCopy(raw, done); });
      } else {
        legacyCopy(raw, done);
      }
    } catch (e) {
      legacyCopy(raw, done);
    }
  }
  [netCard, decCard, asCard].forEach(function (card) {
    if (card) card.addEventListener("click", function () { copyCard(card); });
  });

  /* ---- 이벤트 ---- */
  function onDurChange() {
    saveState({ start: startEl.value, end: endEl.value, brk: breakEl ? breakEl.value : "" });
    renderDuration();
  }
  function onAsChange() {
    saveState({ base: baseEl.value, addH: addHoursEl ? addHoursEl.value : "", addM: addMinutesEl ? addMinutesEl.value : "" });
    renderAddSub();
  }
  startEl.addEventListener("input", onDurChange);
  endEl.addEventListener("input", onDurChange);
  if (breakEl) breakEl.addEventListener("input", onDurChange);
  baseEl.addEventListener("input", onAsChange);
  if (addHoursEl) addHoursEl.addEventListener("input", onAsChange);
  if (addMinutesEl) addMinutesEl.addEventListener("input", onAsChange);

  // Enter 키로 즉시 반영(숫자 입력 중 blur 유도) — 값 자체는 이미 input 이벤트로 실시간 반영됨
  [breakEl, addHoursEl, addMinutesEl].forEach(function (el) {
    if (!el) return;
    el.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); el.blur(); }
    });
  });

  // 언어 전환 시 결과·안내 문구 재렌더(포맷·복사 라벨 포함)
  document.addEventListener("i18n:change", function () {
    DUR_PLACEHOLDER = tr("tool.dur.placeholder", DUR_PLACEHOLDER);
    AS_PLACEHOLDER = tr("tool.as.placeholder", AS_PLACEHOLDER);
    renderAll();
  });

  /* ---- 초기화: 저장값 복원 ---- */
  (function init() {
    var st = loadState();
    if (st.start && parseTimeValue(st.start) != null) startEl.value = st.start;
    if (st.end && parseTimeValue(st.end) != null) endEl.value = st.end;
    if (breakEl && st.brk != null) breakEl.value = st.brk;
    if (st.base && parseTimeValue(st.base) != null) baseEl.value = st.base;
    if (addHoursEl && st.addH != null) addHoursEl.value = st.addH;
    if (addMinutesEl && st.addM != null) addMinutesEl.value = st.addM;

    setMode(st.mode === "addsub" ? "addsub" : "duration");
    setOp(st.op === "subtract" ? "subtract" : "add");
    renderAll();
  })();
  // TOOLJS:END
})();
