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
  var SLUG = cfg.slug || "sleep-cycle-calc";
  var LS_LAST = SLUG + ":last";           // 상태 저장은 "<slug>:" prefix 만 사용

  var CYCLE_DEFAULT = 90, CYCLE_MIN = 80, CYCLE_MAX = 120;
  var LAT_DEFAULT = 15, LAT_MIN = 0, LAT_MAX = 60;

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  // 숫자 외 문자 제거 후 min..max clamp, 비면 dflt
  function clampInt(raw, min, max, dflt) {
    var digits = String(raw == null ? "" : raw).replace(/[^\d]/g, "");
    if (!digits) return dflt;
    var n = parseInt(digits, 10);
    if (isNaN(n)) return dflt;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }
  // "HH:MM" -> 하루 분(minutes-of-day) 또는 null
  function parseTime(str) {
    if (!str) return null;
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(str).trim());
    if (!m) return null;
    var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (isNaN(h) || isNaN(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return null;
    return h * 60 + mi;
  }
  // 핵심 엔진: 90분 사이클 역산 → 4옵션.
  //   wake  모드: 기상 anchor 에서 n∈{6,5,4,3} 취침시각 = anchor − latency − n*cycle
  //   bed   모드: 취침 anchor 에서 n∈{3,4,5,6} 기상시각 = anchor + latency + n*cycle
  //   clockMin = 하루 분(mod 1440), dayOffset = 자정 넘김 (음수=전날, 양수=다음날)
  function sleepOptions(mode, anchorMin, latency, cycle) {
    var ns = mode === "wake" ? [6, 5, 4, 3] : [3, 4, 5, 6];
    var out = [];
    for (var i = 0; i < ns.length; i++) {
      var n = ns[i];
      var raw = mode === "wake"
        ? anchorMin - latency - n * cycle
        : anchorMin + latency + n * cycle;
      var clockMin = ((raw % 1440) + 1440) % 1440;
      var dayOffset = Math.floor(raw / 1440);
      out.push({ n: n, clockMin: clockMin, dayOffset: dayOffset, sleepMin: n * cycle, recommended: n >= 5 });
    }
    return out;
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { clampInt: clampInt, parseTime: parseTime, sleepOptions: sleepOptions };
  }

  /* ---- i18n 헬퍼 ---- */
  function t(key, fallback) {
    try { if (window.I18N) { var v = window.I18N.t(key); if (v != null) return v; } }
    catch (e) { /* i18n 부재 시 폴백 */ }
    return fallback != null ? fallback : key;
  }
  function curLang() {
    try { if (window.I18N && window.I18N.lang()) return window.I18N.lang(); } catch (e) { /* noop */ }
    return document.documentElement.lang || "en";
  }
  function fill(tpl, map) {
    return String(tpl).replace(/\{(\w+)\}/g, function (_, k) { return map[k] != null ? map[k] : "{" + k + "}"; });
  }

  /* ---- 시각/기간 포맷 (사용자 로케일 12h/24h 는 Intl 이 결정) ---- */
  function formatClock(min) {
    var d = new Date(2000, 0, 1, Math.floor(min / 60), min % 60, 0);
    try {
      return new Intl.DateTimeFormat(curLang(), { hour: "numeric", minute: "2-digit" }).format(d);
    } catch (e) {
      var h = Math.floor(min / 60), m = min % 60;
      return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
    }
  }
  function formatDur(mins) {
    var h = Math.floor(mins / 60), m = mins % 60;
    return m ? fill(t("tool.durHM", "{h}h {m}m"), { h: h, m: m }) : fill(t("tool.durH", "{h}h"), { h: h });
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var timeEl = $("scc-time"), latEl = $("scc-latency"), cycleEl = $("scc-cycle");
  var calcBtn = $("scc-calc"), nowBtn = $("scc-sleep-now"), resultEl = $("scc-result");
  var labelEl = $("time-label");
  var modeRadios = document.getElementsByName("scc-mode");
  if (!timeEl || !latEl || !calcBtn || !resultEl) return;

  var last = null;         // { mode, anchorMin, latency, cycle, now } — 마지막 유효 계산
  var lastNotice = null;   // { key, fallback } — 마지막 안내 문구 (언어 전환 재번역용)

  function getMode() {
    for (var i = 0; i < modeRadios.length; i++) if (modeRadios[i].checked) return modeRadios[i].value;
    return "wake";
  }
  function setMode(v) {
    for (var i = 0; i < modeRadios.length; i++) modeRadios[i].checked = (modeRadios[i].value === v);
  }
  function syncLabel() {
    if (!labelEl) return;
    labelEl.textContent = getMode() === "wake"
      ? t("tool.labelWake", "What time do you want to wake up?")
      : t("tool.labelBed", "What time are you going to bed?");
  }

  // 조용한 실패 금지 — 빈 입력은 .result 에 안내 문구
  function showNotice(key, fallback) {
    lastNotice = { key: key, fallback: fallback };
    last = null;
    resultEl.hidden = false;
    resultEl.textContent = t(key, fallback);
  }

  function renderResult() {
    if (!last) return;
    lastNotice = null;
    var opts = sleepOptions(last.mode, last.anchorMin, last.latency, last.cycle);
    var head;
    if (last.mode === "wake") {
      head = fill(t("tool.headWake", "To wake up refreshed at {time}, go to bed at one of these times:"), { time: formatClock(last.anchorMin) });
    } else if (last.now) {
      head = t("tool.headBedNow", "If you fall asleep now, wake up at one of these times to feel refreshed:");
    } else {
      head = fill(t("tool.headBed", "If you go to bed at {time}, wake up at one of these times to feel refreshed:"), { time: formatClock(last.anchorMin) });
    }
    var html = '<div style="font-size:15px;line-height:1.5;margin-bottom:14px;">' + head + '</div>';
    for (var i = 0; i < opts.length; i++) {
      var o = opts[i];
      var tag = "";
      if (last.mode === "wake" && o.dayOffset < 0) tag = t("tool.tagPrev", "the night before");
      else if (last.mode === "bed" && o.dayOffset > 0) tag = t("tool.tagNext", "next day");
      var tagHtml = tag ? ' <span style="font-size:12px;font-weight:600;color:var(--muted);">(' + tag + ')</span>' : "";
      var badge = o.recommended ? t("tool.badgeRec", "recommended") : t("tool.badgeShort", "if you're short on time");
      var badgeColor = o.recommended ? "var(--accent)" : "var(--muted)";
      var border = o.recommended ? "var(--accent)" : "var(--line)";
      var bg = o.recommended ? "color-mix(in srgb, var(--accent) 12%, var(--surface))" : "var(--surface)";
      var cyc = fill(t("tool.cycles", "{n} cycles"), { n: o.n });
      html += '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;padding:12px 14px;margin-bottom:8px;border-radius:10px;border:1px solid ' + border + ';background:' + bg + ';">';
      html += '<div><strong>' + formatClock(o.clockMin) + '</strong>' + tagHtml + '</div>';
      html += '<div style="font-size:13px;text-align:end;line-height:1.45;"><span style="color:var(--muted);">' + cyc + ' · ' + formatDur(o.sleepMin) + '</span><br><span style="font-weight:700;color:' + badgeColor + ';">' + badge + '</span></div>';
      html += '</div>';
    }
    html += '<p style="font-size:13.5px;margin:14px 0 0;">' + t("tool.note", "Aim to fall asleep at one of these times so you wake at the end of a cycle, not in the middle of one.") + '</p>';
    html += '<p style="font-size:12.5px;color:var(--muted);margin:8px 0 0;">' + t("tool.footnote", "These are averages only — real sleep cycles vary from about 70 to 120 minutes from person to person and night to night.") + '</p>';
    resultEl.innerHTML = html;
    resultEl.hidden = false;
  }

  function compute(useNow) {
    var mode = getMode();
    var latency = clampInt(latEl.value, LAT_MIN, LAT_MAX, LAT_DEFAULT);
    var cycle = cycleEl ? clampInt(cycleEl.value, CYCLE_MIN, CYCLE_MAX, CYCLE_DEFAULT) : CYCLE_DEFAULT;
    latEl.value = String(latency);
    if (cycleEl) cycleEl.value = String(cycle);
    var anchorMin, now = false;
    if (useNow) {
      mode = "bed"; setMode("bed"); syncLabel();
      var d = new Date();
      anchorMin = d.getHours() * 60 + d.getMinutes();
      timeEl.value = (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
      now = true;
    } else {
      anchorMin = parseTime(timeEl.value);
      if (anchorMin == null) { showNotice("tool.errNoTime", "Pick a time first, or tap Sleep now."); return; }
    }
    last = { mode: mode, anchorMin: anchorMin, latency: latency, cycle: cycle, now: now };
    renderResult();
    save();
  }

  /* ---- 상태 (localStorage "<slug>:last") ---- */
  function save() {
    try {
      localStorage.setItem(LS_LAST, JSON.stringify({
        mode: getMode(), time: timeEl.value,
        latency: latEl.value, cycle: cycleEl ? cycleEl.value : String(CYCLE_DEFAULT)
      }));
    } catch (e) { /* private mode — 세션 한정 동작 */ }
  }
  function restore() {
    var raw = null;
    try { raw = localStorage.getItem(LS_LAST); } catch (e) { /* noop */ }
    var s = null;
    if (raw) { try { s = JSON.parse(raw); } catch (e) { s = null; } }
    if (s) {
      if (s.mode) setMode(s.mode);
      if (s.time) timeEl.value = s.time;
      if (s.latency != null && s.latency !== "") latEl.value = s.latency;
      if (cycleEl && s.cycle != null && s.cycle !== "") cycleEl.value = s.cycle;
    }
    syncLabel();
    // 저장된 시간이 있으면 결과까지 복원 (기상/취침 모드 모두 명시 계산 — 인메모리 흉내 아님)
    var anchorMin = parseTime(timeEl.value);
    if (anchorMin != null) {
      last = {
        mode: getMode(), anchorMin: anchorMin,
        latency: clampInt(latEl.value, LAT_MIN, LAT_MAX, LAT_DEFAULT),
        cycle: cycleEl ? clampInt(cycleEl.value, CYCLE_MIN, CYCLE_MAX, CYCLE_DEFAULT) : CYCLE_DEFAULT,
        now: false
      };
      renderResult();
    }
  }

  /* ---- 이벤트 ---- */
  calcBtn.addEventListener("click", function () { compute(false); });
  if (nowBtn) nowBtn.addEventListener("click", function () { compute(true); });
  for (var r = 0; r < modeRadios.length; r++) {
    modeRadios[r].addEventListener("change", function () {
      syncLabel();
      if (last) compute(false); else save();   // 결과가 있을 때만 즉시 갱신
    });
  }
  function onInputChange() { if (last) compute(false); else save(); }
  timeEl.addEventListener("change", onInputChange);
  latEl.addEventListener("change", onInputChange);
  if (cycleEl) cycleEl.addEventListener("change", onInputChange);

  // 언어 전환: 시각·기간·라벨·안내문구 재렌더
  document.addEventListener("i18n:change", function () {
    syncLabel();
    if (last) renderResult();
    else if (lastNotice) resultEl.textContent = t(lastNotice.key, lastNotice.fallback);
  });

  restore();
  // TOOLJS:END
})();
