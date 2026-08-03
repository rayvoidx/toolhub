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
  var pw = $("pw"), result = $("result"), errEl = $("err"), hint = $("hint");
  var gauge = $("gauge"), fill = $("gauge-fill"), flags = $("flags"), rate = $("rate");
  var custom = $("rate-custom"), customWrap = $("rate-custom-wrap");
  if (!pw) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var fmt = function (k, n) { return t(k).replace("{n}", n); };

  // 비밀번호는 절대 저장하지 않는다 — localStorage/URL 파라미터 모두 사용하지 않음(설계상 의도).
  var COMMON = ["password", "passwort", "contrasena", "123456", "1234567", "12345678", "123456789",
    "1234567890", "12345", "qwerty", "qwertyuiop", "qwerty123", "abc123", "password1", "111111",
    "000000", "654321", "121212", "1q2w3e4r", "zaq12wsx", "iloveyou", "sunshine", "princess",
    "football", "baseball", "soccer", "welcome", "admin", "administrator", "letmein", "monkey",
    "dragon", "master", "shadow", "superman", "batman", "starwars", "trustno1", "freedom",
    "whatever", "hello", "login", "guest", "root", "computer", "internet", "michael", "jennifer",
    "jordan", "harley", "ranger", "hunter", "charlie", "matthew", "chocolate", "samsung", "google"];
  var ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890", "qazwsxedc"];
  var LEET = { "@": "a", "4": "a", "8": "b", "(": "c", "3": "e", "6": "g", "1": "l", "!": "i",
    "0": "o", "$": "s", "5": "s", "7": "t", "+": "t", "|": "l" };
  var BANDS = [[28, "tool.band.vweak", "#dc2626"], [36, "tool.band.weak", "#ea580c"],
    [60, "tool.band.fair", "#ca8a04"], [128, "tool.band.strong", "#16a34a"],
    [Infinity, "tool.band.excellent", "#047857"]];

  function isDigit(c) { return c >= 48 && c <= 57; }
  function isAlnum(c) { return isDigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122); }

  // 문자 클래스별 풀 크기 — 공격자가 어떤 알파벳을 훑어야 하는지의 근사치다.
  function poolSize(s) {
    var lo = 0, up = 0, di = 0, sy = 0, ot = 0, i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c >= 97 && c <= 122) lo = 26;
      else if (c >= 65 && c <= 90) up = 26;
      else if (isDigit(c)) di = 10;
      else if (c >= 32 && c <= 126) sy = 33;
      else ot = 100; // 비ASCII: 실제 풀은 훨씬 크지만 보수적으로 100만 더한다
    }
    return lo + up + di + sy + ot;
  }

  function normalize(s) {
    var o = "", i, c;
    for (i = 0; i < s.length; i++) { c = s.charAt(i).toLowerCase(); o += (LEET[c] || c); }
    return o;
  }
  function stripEdges(s) {
    var a = 0, b = s.length;
    while (a < b && !isAlnum(s.charCodeAt(a))) a++;
    while (b > a && !(s.charCodeAt(b - 1) >= 97 && s.charCodeAt(b - 1) <= 122)) b--;
    return s.slice(a, b);
  }

  function hasSequence(s) {
    var run = 1, i, a, b;
    for (i = 1; i < s.length; i++) {
      a = s.toLowerCase().charCodeAt(i - 1); b = s.toLowerCase().charCodeAt(i);
      if (isAlnum(a) && isAlnum(b) && (b - a === 1 || b - a === -1)) { run++; if (run >= 3) return true; }
      else run = 1;
    }
    return false;
  }
  function hasRepeat(s) {
    var i;
    for (i = 2; i < s.length; i++) if (s.charAt(i) === s.charAt(i - 1) && s.charAt(i) === s.charAt(i - 2)) return true;
    // ponytail: 타일링 검사는 64자까지만 — 그 이상은 O(n^2)이고 실익이 없다
    if (s.length >= 4 && s.length <= 64) {
      for (var u = 1; u <= s.length / 2; u++) {
        if (s.length % u) continue;
        var p = s.slice(0, u), ok = true;
        for (var j = u; j < s.length; j += u) if (s.slice(j, j + u) !== p) { ok = false; break; }
        if (ok) return true;
      }
    }
    return false;
  }
  function hasKeyboard(s) {
    var low = s.toLowerCase(), r, i, chunk, rev;
    for (r = 0; r < ROWS.length; r++) {
      for (i = 0; i + 4 <= ROWS[r].length; i++) {
        chunk = ROWS[r].slice(i, i + 4);
        rev = chunk.split("").reverse().join("");
        if (low.indexOf(chunk) >= 0 || low.indexOf(rev) >= 0) return true;
      }
    }
    return false;
  }
  function hasYear(s) { return /(19|20)[0-9][0-9]/.test(s); }

  function analyze(s) {
    var raw = s.length * (Math.log(poolSize(s)) / Math.LN2);
    var n = normalize(s), base = stripEdges(n), warns = [], factor = 1, cap = Infinity, i;
    var exact = false, part = false;
    for (i = 0; i < COMMON.length; i++) {
      if (base === COMMON[i] || n === COMMON[i]) exact = true;
      else if (COMMON[i].length >= 5 && n.indexOf(COMMON[i]) >= 0) part = true;
    }
    if (exact) { warns.push("tool.warn.common"); cap = 14; }
    else if (part) { warns.push("tool.warn.common"); factor *= 0.6; }
    if (hasSequence(s)) { warns.push("tool.warn.sequence"); factor *= 0.8; }
    if (hasRepeat(s)) { warns.push("tool.warn.repeat"); factor *= 0.75; }
    if (hasYear(s)) { warns.push("tool.warn.year"); factor *= 0.85; }
    if (hasKeyboard(s)) { warns.push("tool.warn.keyboard"); factor *= 0.75; }
    return { bits: Math.min(raw * factor, cap), warns: warns };
  }

  // 평균 시도 횟수는 전체 공간의 절반 — 2^(bits-1).
  function crackSeconds(bits, rate) { return Math.pow(2, bits - 1) / rate; }
  function humanize(sec) {
    if (!isFinite(sec) || sec >= 3.156e9) return t("tool.time.centuries"); // 100년 이상
    if (sec < 1) return t("tool.time.instant");
    if (sec < 60) return fmt("tool.time.seconds", Math.max(1, Math.round(sec)));
    if (sec < 3600) return fmt("tool.time.minutes", Math.max(1, Math.round(sec / 60)));
    if (sec < 86400) return fmt("tool.time.hours", Math.max(1, Math.round(sec / 3600)));
    if (sec < 31557600) return fmt("tool.time.days", Math.max(1, Math.round(sec / 86400)));
    return fmt("tool.time.years", Math.max(1, Math.round(sec / 31557600)));
  }

  function chip(key, bad) {
    var el = document.createElement("span");
    el.className = bad ? "flag bad" : "flag";
    el.textContent = t(key);
    flags.appendChild(el);
  }

  function fail(key) {
    result.hidden = true; hint.hidden = true;
    errEl.hidden = false; errEl.textContent = t(key);
  }

  // 프리셋 3종 밖의 하드웨어(대여 GPU 클러스터, 고비용 Argon2)를 쓰는 사람을 위한 직접 입력.
  // null = 잘못된 값 → 호출부에서 오류 문구로 보낸다.
  function offlineRate() {
    if (!rate) return 1e10;
    if (rate.value !== "custom") {
      var preset = parseFloat(rate.value);
      return (isFinite(preset) && preset > 0) ? preset : 1e10;
    }
    var v = parseFloat(custom && custom.value);
    if (!isFinite(v) || v < 1 || v > 1e15) return null;
    return v;
  }

  function render() {
    var v = pw.value;
    // 빈 입력은 오류가 아니다 — 초기 상태로 되돌리고 안내만 남긴다.
    if (!v) { result.hidden = true; errEl.hidden = true; hint.hidden = false; return; }
    if (!v.replace(/\s/g, "").length) return fail("tool.err.blank");

    var a = analyze(v), bits = a.bits, i, band = BANDS[BANDS.length - 1];
    for (i = 0; i < BANDS.length; i++) if (bits < BANDS[i][0]) { band = BANDS[i]; break; }

    $("r-band").textContent = t(band[1]);
    $("r-bits").textContent = fmt("tool.bits", Math.round(bits));
    // 사이트가 어떤 해시로 저장하는지에 따라 오프라인 공격 속도가 몇 자릿수씩 달라진다.
    var offRate = offlineRate();
    if (offRate === null) return fail("tool.err.rate");
    $("r-offline").textContent = humanize(crackSeconds(bits, offRate));
    $("r-online").textContent = humanize(crackSeconds(bits, 1e4));

    fill.style.width = Math.max(2, Math.min(100, bits / 128 * 100)) + "%";
    fill.style.background = band[2];
    gauge.setAttribute("aria-label", t("tool.r.strength") + ": " + t(band[1]));

    while (flags.firstChild) flags.removeChild(flags.firstChild);
    if (a.warns.length) for (i = 0; i < a.warns.length; i++) chip(a.warns[i], true);
    else chip("tool.warn.none", false);

    errEl.hidden = true; hint.hidden = true; result.hidden = false;
  }

  pw.addEventListener("input", render);
  if (rate) rate.addEventListener("change", function () {
    if (customWrap) customWrap.hidden = rate.value !== "custom";
    render();
  });
  if (custom) custom.addEventListener("input", render);
  pw.addEventListener("keydown", function (e) { if (e.key === "Enter") render(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) render(); });
  // TOOLJS:END
})();
