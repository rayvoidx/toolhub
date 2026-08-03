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
  /* Cron Expression Parser — 5필드 cron("분 시 일 월 요일")을 직접 파싱해
     (1) 자연어 설명 (2) 다음 5회 실행 시각 (3) 필드별 분해 를 보여준다.
     외부 cron 라이브러리 없음 — 매칭은 "분 단위 순회"하는 수제 매처. 모든 계산은 로컬.
     상태: localStorage "<slug>:state" (마지막 입력식)만. 외부 API 없음. */

  /* ---- 필드 정의 ---- */
  var FIELD_DEFS = [
    { key: "minute", min: 0, max: 59, size: 60, names: null, sing: "minute", plur: "minutes" },
    { key: "hour", min: 0, max: 23, size: 24, names: null, sing: "hour", plur: "hours" },
    { key: "dom", min: 1, max: 31, size: 31, names: null, sing: "dom", plur: "doms" },
    { key: "month", min: 1, max: 12, size: 12, names: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], sing: "month", plur: "months" },
    // dow: 0-6 = SUN..SAT, and 7 is accepted as an alias for Sunday (POSIX cron convention).
    // size stays 7 (real distinct days) — value 7 normalizes into slot 0 so "0-7"/"*" both read as "every day".
    { key: "dow", min: 0, max: 7, size: 7, names: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"], sing: "dow", plur: "dows" }
  ];

  function CronError(code, vars, fallback) {
    this.code = code;
    this.vars = vars || {};
    this.message = fallback || code;
  }

  // 일부 cron 구현이 지원하는 "닉네임" — 이 도구는 5필드 표준형만 받으므로, 입력되면
  // 정확히 어떤 5필드 식으로 바꿔야 하는지 알려준다(막연한 "invalid" 대신 실질적 안내).
  var NICKNAMES = {
    "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *",
    "@monthly": "0 0 1 * *",
    "@weekly": "0 0 * * 0",
    "@daily": "0 0 * * *", "@midnight": "0 0 * * *",
    "@hourly": "0 * * * *"
  };

  // 필드 하나(콤마로 나뉜 각 조각)를 파싱한다. 조각별 설명은 영어 문자열이 아니라
  // 구조화된 토큰({t:...})으로 남겨서, 렌더 단계에서 14개 언어 전부 i18n으로 조립한다.
  function parseField(raw, def) {
    var text = String(raw == null ? "" : raw).trim();
    if (text === "") throw new CronError("fieldEmpty", { field: def.key }, "The " + def.key + " field is empty.");
    var tokens = text.split(",");
    var size = def.size;
    var allowed = new Array(size);
    for (var i = 0; i < size; i++) allowed[i] = false;
    var tokenDescs = [];
    var tokenCount = 0;

    for (var t = 0; t < tokens.length; t++) {
      var tok = tokens[t].trim();
      tokenCount++;
      if (tok === "") {
        throw new CronError("emptyToken", { field: def.key, text: text }, "Empty value in the " + def.key + " field in \"" + text + "\".");
      }
      var m = /^(\*|[A-Za-z]+|\d+)(-([A-Za-z]+|\d+))?(\/(\d+))?$/.exec(tok);
      if (!m) {
        throw new CronError("badSyntax", { field: def.key, tok: tok }, "Invalid syntax \"" + tok + "\" in the " + def.key + " field.");
      }
      var base = m[1];
      var rangeEndRaw = m[3];
      var stepRaw = m[5];
      var isWildcardBase = base === "*";
      var start, end;

      if (isWildcardBase) {
        if (rangeEndRaw != null) {
          throw new CronError("wildcardRange", { field: def.key, tok: tok }, "\"" + tok + "\" is not valid in the " + def.key + " field.");
        }
        start = def.min; end = def.max;
      } else {
        start = resolveValue(base, def, tok);
        if (rangeEndRaw != null) end = resolveValue(rangeEndRaw, def, tok);
        else if (stepRaw != null) end = def.max; // "N/M" (Vixie-cron): N부터 시작해 필드 최대값까지 step
        else end = start;
      }

      if (end < start) {
        throw new CronError("reversedRange", { field: def.key, tok: tok, a: start, b: end },
          "Invalid range \"" + tok + "\" in the " + def.key + " field — " + start + " comes after " + end + ".");
      }

      var step = 1;
      if (stepRaw != null) {
        step = parseInt(stepRaw, 10);
        if (!(step > 0)) throw new CronError("badStep", { tok: tok }, "The step in \"" + tok + "\" must be a positive whole number.");
      }

      for (var v = start; v <= end; v += step) {
        var norm = def.key === "dow" && v === 7 ? 0 : v;
        var idx = norm - def.min;
        if (idx >= 0 && idx < size) allowed[idx] = true;
      }

      if (isWildcardBase && stepRaw == null) tokenDescs.push({ t: "every" });
      else if (isWildcardBase && stepRaw != null) tokenDescs.push({ t: "everyN", n: step });
      else if (rangeEndRaw != null && stepRaw != null) tokenDescs.push({ t: "rangeFrom", n: step, a: start, b: end });
      else if (rangeEndRaw != null && stepRaw == null) tokenDescs.push({ t: "range", a: start, b: end });
      else if (rangeEndRaw == null && stepRaw != null) tokenDescs.push({ t: "start", n: step, a: start });
      else tokenDescs.push({ t: "value", a: start });
    }

    var full = true;
    for (var k = 0; k < size; k++) { if (!allowed[k]) { full = false; break; } }

    var onCount = 0, onlyVal = null;
    for (var kk = 0; kk < size; kk++) { if (allowed[kk]) { onCount++; onlyVal = kk + def.min; } }
    var singleValue = onCount === 1 ? onlyVal : null;

    var everyStepFull = null;
    if (tokenCount === 1 && tokens[0].trim().indexOf("*/") === 0) everyStepFull = parseInt(tokens[0].trim().slice(2), 10);

    return {
      allowed: allowed, def: def, full: full, tokenDescs: tokenDescs,
      singleValue: singleValue, everyStepFull: full ? null : everyStepFull, raw: text
    };
  }

  function resolveValue(str, def, tokenForError) {
    if (/^\d+$/.test(str)) {
      var n = parseInt(str, 10);
      if (n < def.min || n > def.max) {
        throw new CronError("outOfRange", { field: def.key, tok: tokenForError, min: def.min, max: def.max },
          "\"" + tokenForError + "\" is out of range in the " + def.key + " field — expected a value between " + def.min + " and " + def.max + ".");
      }
      return n;
    }
    if (!def.names) {
      throw new CronError("namesNotAllowed", { field: def.key, tok: tokenForError },
        "\"" + tokenForError + "\" is not valid in the " + def.key + " field — names aren't allowed here, only numbers.");
    }
    var idx = def.names.indexOf(str.toUpperCase());
    if (idx === -1) {
      throw new CronError("unknownName", { field: def.key, str: str, names: def.names.join(", ") },
        "\"" + str + "\" is not a recognized name in the " + def.key + " field.");
    }
    return def.key === "month" ? idx + 1 : idx;
  }

  function parseCron(expr) {
    var text = String(expr == null ? "" : expr).trim();
    if (text === "") throw new CronError("empty", {}, "Enter a cron expression to parse.");
    if (text.charAt(0) === "@") {
      var nick = text.toLowerCase();
      var suggestion = NICKNAMES[nick];
      if (suggestion) {
        throw new CronError("macroKnown", { expr: text, suggestion: suggestion },
          "\"" + text + "\" is a cron nickname — try \"" + suggestion + "\" instead.");
      }
      throw new CronError("macroUnknown", { expr: text }, "\"" + text + "\" looks like a cron nickname, which isn't supported directly.");
    }
    var parts = text.split(/\s+/);
    if (parts.length !== 5) {
      throw new CronError("fieldCount", { count: parts.length },
        "A cron expression needs exactly 5 fields — found " + parts.length + ".");
    }
    return {
      minute: parseField(parts[0], FIELD_DEFS[0]),
      hour: parseField(parts[1], FIELD_DEFS[1]),
      dom: parseField(parts[2], FIELD_DEFS[2]),
      month: parseField(parts[3], FIELD_DEFS[3]),
      dow: parseField(parts[4], FIELD_DEFS[4]),
      raw: text
    };
  }

  /* ================= 렌더(i18n) =================
     ctx.t(key, vars) → 번역 템플릿에 {a}/{b}/{n}... 치환
     ctx.val(fieldKey, v) → 값 표기(숫자 그대로, 또는 month/dow는 로케일 이름)
     조립 순서는 고정(영어 기준)이지만 각 템플릿 문자열 자체는 언어별로 자유 어순 가능. */
  function pad2(n) { n = String(n); return n.length < 2 ? "0" + n : n; }
  function unitWord(def, plural, ctx) { return ctx.t("d.unit." + (plural ? def.plur : def.sing)); }

  function renderPart(def, tok, ctx) {
    switch (tok.t) {
      case "every": return ctx.t("d.everyUnit", { unit: unitWord(def, false, ctx) });
      case "everyN": return ctx.t("d.everyNUnit", { n: tok.n, unit: unitWord(def, true, ctx) });
      case "range": return ctx.t("d.through", { a: ctx.val(def.key, tok.a), b: ctx.val(def.key, tok.b) });
      case "rangeFrom": return ctx.t("d.everyNUnitFrom", { n: tok.n, unit: unitWord(def, true, ctx), a: ctx.val(def.key, tok.a), b: ctx.val(def.key, tok.b) });
      case "start": return ctx.t("d.everyNUnitStart", { n: tok.n, unit: unitWord(def, true, ctx), a: ctx.val(def.key, tok.a) });
      case "value": return ctx.val(def.key, tok.a);
      default: return "";
    }
  }
  function joinAnd(list, ctx) {
    if (list.length === 1) return list[0];
    var and = ctx.t("d.and"), comma = ctx.t("d.listComma");
    if (list.length === 2) return list[0] + " " + and + " " + list[1];
    return list.slice(0, -1).join(comma) + comma + and + " " + list[list.length - 1];
  }
  function renderJoined(pf, ctx) {
    var parts = [];
    for (var i = 0; i < pf.tokenDescs.length; i++) parts.push(renderPart(pf.def, pf.tokenDescs[i], ctx));
    return joinAnd(parts, ctx);
  }
  // 필드 전체 설명 (breakdown 표: 행 라벨이 이미 필드명을 보여주므로 단위어 중복 생략)
  function fieldFull(pf, ctx) {
    if (pf.full) return ctx.t("d.everyUnit", { unit: unitWord(pf.def, false, ctx) });
    return renderJoined(pf, ctx);
  }
  function tokenHasEvery(tok) { return tok.t === "every" || tok.t === "everyN" || tok.t === "rangeFrom" || tok.t === "start"; }
  // 문장 조립용: 단위어 없이는 어색한 경우("past 9 through 17") 필요하면 붙여준다.
  function unitPrefixed(pf, ctx) {
    if (pf.full) return ctx.t("d.everyUnit", { unit: unitWord(pf.def, false, ctx) });
    if (pf.everyStepFull != null) return ctx.t("d.everyNUnit", { n: pf.everyStepFull, unit: unitWord(pf.def, true, ctx) });
    if (pf.singleValue != null) return ctx.t("d.unitValue", { unit: unitWord(pf.def, false, ctx), value: ctx.val(pf.def.key, pf.singleValue) });
    var hasEvery = false;
    for (var i = 0; i < pf.tokenDescs.length; i++) { if (tokenHasEvery(pf.tokenDescs[i])) { hasEvery = true; break; } }
    var body = renderJoined(pf, ctx);
    if (hasEvery) return body;
    return ctx.t("d.unitPrefixedBody", { unit: unitWord(pf.def, true, ctx), body: body });
  }
  function domPhrase(dom, ctx) {
    if (dom.full) return ctx.t("d.everyUnit", { unit: unitWord(dom.def, false, ctx) });
    if (dom.singleValue != null) return ctx.t("d.onDayOfMonth", { d: ctx.val("dom", dom.singleValue) });
    return ctx.t("d.onDaysOfMonthList", { list: renderJoined(dom, ctx) });
  }
  function dowPhrase(dow, ctx) {
    if (dow.full) return ctx.t("d.everyUnit", { unit: unitWord(dow.def, false, ctx) });
    if (dow.singleValue != null) return ctx.t("d.onDow", { x: ctx.val("dow", dow.singleValue) });
    return ctx.t("d.onDow", { x: renderJoined(dow, ctx) });
  }
  function capitalize(s) { return s.replace(/^\s*\S/, function (c) { return c.toUpperCase(); }); }

  function renderDescription(parsed, ctx) {
    var minute = parsed.minute, hour = parsed.hour, dom = parsed.dom, month = parsed.month, dow = parsed.dow;
    var timePart, timeIsInterval = false;

    if (minute.full && hour.full) {
      timePart = ctx.t("d.everyUnit", { unit: unitWord(minute.def, false, ctx) }); timeIsInterval = true;
    } else if (minute.everyStepFull != null && hour.full) {
      timePart = ctx.t("d.everyNUnit", { n: minute.everyStepFull, unit: unitWord(minute.def, true, ctx) }); timeIsInterval = true;
    } else if (minute.singleValue != null && hour.singleValue != null) {
      timePart = ctx.t("d.atTime", { time: pad2(hour.singleValue) + ":" + pad2(minute.singleValue) });
    } else if (minute.singleValue != null && hour.full) {
      timePart = ctx.t("d.atMinutePastEveryHour", { m: minute.singleValue });
    } else if (minute.full && hour.singleValue != null) {
      timePart = ctx.t("d.everyMinuteDuringHour", { h: hour.singleValue });
    } else if (minute.everyStepFull != null && hour.singleValue != null) {
      timePart = ctx.t("d.everyNMinutesPastHour", { n: minute.everyStepFull, h: hour.singleValue });
    } else if (minute.singleValue != null) {
      timePart = ctx.t("d.atMinutePast", { m: minute.singleValue, hourPhrase: unitPrefixed(hour, ctx) });
    } else if (minute.everyStepFull != null) {
      timePart = ctx.t("d.everyNMinutesDuring", { n: minute.everyStepFull, hourPhrase: unitPrefixed(hour, ctx) });
    } else if (minute.full) {
      timePart = ctx.t("d.everyMinuteDuring", { hourPhrase: unitPrefixed(hour, ctx) });
    } else {
      timePart = ctx.t("d.atPast", { minutePhrase: unitPrefixed(minute, ctx), hourPhrase: unitPrefixed(hour, ctx) });
    }

    var domFull = dom.full, dowFull = dow.full;
    var dayPart;
    if (domFull && dowFull) {
      dayPart = timeIsInterval ? "" : ctx.t("d.everyDay");
    } else if (!domFull && dowFull) {
      dayPart = domPhrase(dom, ctx);
    } else if (domFull && !dowFull) {
      dayPart = dowPhrase(dow, ctx);
    } else {
      dayPart = ctx.t("d.orWhicheverMatches", { domPhrase: domPhrase(dom, ctx), dowPhrase: dowPhrase(dow, ctx) });
    }

    var monthPart = month.full ? "" : ctx.t("d.inMonthSuffix", { phrase: fieldFull(month, ctx) });

    var sentence = capitalize(timePart);
    if (dayPart) sentence += ctx.t("d.listComma") + dayPart;
    sentence += monthPart + ctx.t("d.fullStop");
    return sentence;
  }

  /* ---- 다음 실행 시각: 분 단위로 직접 순회하는 수제 매처 ----
     표준 cron 규칙: dom/dow 둘 다 제한(비-'*')이면 OR, 하나만 제한이면 그 필드만, 둘 다 '*'면 매일. */
  function nextRuns(parsed, fromDate, count, maxYears) {
    count = count || 5;
    maxYears = maxYears || 4;
    var start = new Date(fromDate.getTime());
    start.setSeconds(0, 0);
    start.setMinutes(start.getMinutes() + 1);

    var limit = new Date(start.getTime());
    limit.setFullYear(limit.getFullYear() + maxYears);

    var domRestricted = !parsed.dom.full;
    var dowRestricted = !parsed.dow.full;

    var results = [];
    var cur = start;
    var iterations = 0;
    var maxIterations = maxYears * 366 * 24 * 60 + 10;

    while (cur.getTime() <= limit.getTime() && results.length < count && iterations < maxIterations) {
      iterations++;
      var mi = cur.getMinutes(), hh = cur.getHours(), dd = cur.getDate(), mo = cur.getMonth() + 1, wd = cur.getDay();

      var monthOk = parsed.month.allowed[mo - parsed.month.def.min];
      if (!monthOk) { cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1, 0, 0, 0, 0); continue; }

      var minuteOk = parsed.minute.allowed[mi - parsed.minute.def.min];
      var hourOk = parsed.hour.allowed[hh - parsed.hour.def.min];
      var domOk = parsed.dom.allowed[dd - parsed.dom.def.min];
      var dowOk = parsed.dow.allowed[wd - parsed.dow.def.min];

      var dayOk;
      if (domRestricted && dowRestricted) dayOk = domOk || dowOk;
      else if (domRestricted) dayOk = domOk;
      else if (dowRestricted) dayOk = dowOk;
      else dayOk = true;

      if (dayOk && hourOk && minuteOk) {
        results.push(new Date(cur.getTime()));
        cur = new Date(cur.getTime() + 60000);
        continue;
      }
      if (!dayOk) { cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1, 0, 0, 0, 0); continue; }
      if (!hourOk) { cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), cur.getHours() + 1, 0, 0, 0); continue; }
      cur = new Date(cur.getTime() + 60000);
    }
    return results;
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseCron: parseCron, renderDescription: renderDescription, nextRuns: nextRuns,
      CronError: CronError, FIELD_DEFS: FIELD_DEFS, fieldFull: fieldFull, unitPrefixed: unitPrefixed
    };
    return;
  }

  /* ---- 브라우저 전용: i18n 연결 · DOM · 이벤트 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "cron-parser") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function t(key, vars) {
    var raw = tr(key, key);
    return raw.replace(/\{(\w+)\}/g, function (_, k) { return vars && vars[k] != null ? String(vars[k]) : ""; });
  }
  var MONTH_FALLBACK = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var DOW_FALLBACK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  function monthName(v) {
    try { return new Intl.DateTimeFormat(uiLang(), { month: "long" }).format(new Date(2020, v - 1, 1)); }
    catch (e) { return MONTH_FALLBACK[v - 1]; }
  }
  function dowName(v) {
    var vv = v === 7 ? 0 : v;
    try { return new Intl.DateTimeFormat(uiLang(), { weekday: "long" }).format(new Date(2023, 0, 1 + vv)); } // 2023-01-01 = Sunday
    catch (e) { return DOW_FALLBACK[vv]; }
  }
  function val(fieldKey, v) {
    if (fieldKey === "month") return monthName(v);
    if (fieldKey === "dow") return dowName(v);
    return String(v);
  }
  var ctx = { t: t, val: val };

  function fieldLabel(key) { return tr("tool.field." + key, key); }
  function errMessage(err) {
    var vars = {}, k;
    for (k in err.vars) { if (Object.prototype.hasOwnProperty.call(err.vars, k)) vars[k] = err.vars[k]; }
    if (vars.field) vars.field = fieldLabel(vars.field);
    return t("tool.err." + err.code, vars);
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var inputEl = $("cron-input"), errEl = $("err"), emptyEl = $("cp-empty"), resultEl = $("cp-result");
  var descEl = $("cp-desc"), nextListEl = $("cp-next-list"), fieldsBodyEl = $("cp-fields-body");
  var commonListEl = $("cp-common-list");
  var countEl = $("cp-count"), nextHeadingEl = $("cp-next-heading");
  var COUNTS = [5, 10, 20, 50];
  function runCount() {
    var n = countEl ? parseInt(countEl.value, 10) : 5;
    return COUNTS.indexOf(n) === -1 ? 5 : n;
  }
  if (!inputEl || !resultEl) return;

  var FIELD_ORDER = ["minute", "hour", "dom", "month", "dow"];

  var COMMON = [
    { key: "c1", expr: "* * * * *" },
    { key: "c2", expr: "*/5 * * * *" },
    { key: "c3", expr: "*/15 * * * *" },
    { key: "c4", expr: "0 * * * *" },
    { key: "c5", expr: "0 0 * * *" },
    { key: "c6", expr: "0 9 * * *" },
    { key: "c7", expr: "0 9 * * 1-5" },
    { key: "c8", expr: "0 0 * * 0" },
    { key: "c9", expr: "0 0 1 * *" },
    { key: "c10", expr: "0 0 1 1 *" }
  ];

  function saveState(expr) {
    try { localStorage.setItem(SKEY, JSON.stringify({ expr: expr, count: runCount() })); } catch (e) { /* noop */ }
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(SKEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : null;
    } catch (e) { return null; }
  }

  function fmtRunTime(d) {
    try {
      return new Intl.DateTimeFormat(uiLang(), {
        weekday: "short", year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false
      }).format(d);
    } catch (e) {
      var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
      return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + " " + p2(d.getHours()) + ":" + p2(d.getMinutes());
    }
  }

  function renderCommonList() {
    if (!commonListEl) return;
    commonListEl.textContent = "";
    for (var i = 0; i < COMMON.length; i++) {
      (function (item) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cp-common-btn";
        var label = document.createElement("span");
        label.className = "cp-common-label";
        label.textContent = t("tool.common." + item.key);
        var code = document.createElement("span");
        code.className = "cp-common-code";
        code.textContent = item.expr;
        btn.appendChild(label);
        btn.appendChild(code);
        btn.addEventListener("click", function () {
          inputEl.value = item.expr;
          render();
          try { inputEl.focus(); } catch (e) { /* noop */ }
        });
        commonListEl.appendChild(btn);
      })(COMMON[i]);
    }
  }

  function renderFieldsTable(parsed) {
    if (!fieldsBodyEl) return;
    fieldsBodyEl.textContent = "";
    for (var i = 0; i < FIELD_ORDER.length; i++) {
      var key = FIELD_ORDER[i];
      var pf = parsed[key];
      var tr_ = document.createElement("tr");
      var tdLabel = document.createElement("td");
      tdLabel.textContent = fieldLabel(key);
      var tdRaw = document.createElement("td");
      tdRaw.className = "cp-raw";
      tdRaw.textContent = pf.raw;
      var tdMeaning = document.createElement("td");
      tdMeaning.textContent = fieldFull(pf, ctx);
      tr_.appendChild(tdLabel); tr_.appendChild(tdRaw); tr_.appendChild(tdMeaning);
      fieldsBodyEl.appendChild(tr_);
    }
  }

  function renderNextRuns(parsed) {
    if (!nextListEl) return;
    nextListEl.textContent = "";
    var count = runCount();
    if (nextHeadingEl) nextHeadingEl.textContent = t("tool.next.label", { n: count });
    var runs = nextRuns(parsed, new Date(), count);
    for (var i = 0; i < runs.length; i++) {
      var li = document.createElement("li");
      li.className = "cp-next-item result-value";
      li.textContent = fmtRunTime(runs[i]);
      nextListEl.appendChild(li);
    }
    if (!runs.length) {
      var li2 = document.createElement("li");
      li2.className = "cp-next-item";
      li2.textContent = t("tool.next.none");
      nextListEl.appendChild(li2);
    }
  }

  var lastParsed = null;

  function render() {
    var raw = inputEl.value;
    var trimmed = raw.trim();

    if (trimmed === "") {
      lastParsed = null;
      if (errEl) errEl.hidden = true;
      resultEl.hidden = true;
      if (emptyEl) emptyEl.hidden = false;
      return;
    }

    try {
      var parsed = parseCron(trimmed);
      lastParsed = parsed;
      saveState(trimmed);

      if (emptyEl) emptyEl.hidden = true;
      if (errEl) errEl.hidden = true;

      descEl.textContent = renderDescription(parsed, ctx);
      renderNextRuns(parsed);
      renderFieldsTable(parsed);
      resultEl.hidden = false;
    } catch (e) {
      lastParsed = null;
      resultEl.hidden = true;
      if (emptyEl) emptyEl.hidden = true;
      if (errEl) {
        errEl.textContent = (e instanceof CronError) ? errMessage(e) : String(e.message || e);
        errEl.hidden = false;
      }
    }
  }

  /* ---- 이벤트 ---- */
  inputEl.addEventListener("input", render);
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); render(); }
  });

  // 언어 전환 시 (숫자/구조는 그대로, 번역 문구·월/요일 로케일명만) 재조립
  document.addEventListener("i18n:change", function () {
    renderCommonList();
    if (lastParsed) {
      descEl.textContent = renderDescription(lastParsed, ctx);
      renderNextRuns(lastParsed);
      renderFieldsTable(lastParsed);
    }
  });

  if (countEl) countEl.addEventListener("change", render);

  renderCommonList();
  var restored = loadState();
  if (restored) {
    if (typeof restored.expr === "string") inputEl.value = restored.expr;
    if (countEl && COUNTS.indexOf(restored.count) !== -1) countEl.value = String(restored.count);
  }
  render();
  // TOOLJS:END
})();
