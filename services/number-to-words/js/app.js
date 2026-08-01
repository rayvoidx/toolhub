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
  var num = $("num"), result = $("result"), errEl = $("err");
  if (!num || !result || !errEl) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var ONES = ["zero","one","two","three","four","five","six","seven","eight","nine","ten",
    "eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
  var TENS = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
  var SCALE = ["", " thousand", " million", " billion", " trillion"];

  function under1000(n) {
    var out = "";
    if (n >= 100) { out = ONES[Math.floor(n / 100)] + " hundred"; n = n % 100; if (n) out += " "; }
    if (n >= 20) { out += TENS[Math.floor(n / 10)]; if (n % 10) out += "-" + ONES[n % 10]; }
    else if (n > 0) { out += ONES[n]; }
    return out;
  }

  // 문자열 자릿수 그대로 3자리씩 끊는다 — parseFloat 로 바꾸면 15자리에서 정밀도가 흔들린다.
  function intWords(digits) {
    if (/^0*$/.test(digits)) return "zero";
    var groups = [], s = digits;
    while (s.length > 3) { groups.unshift(s.slice(-3)); s = s.slice(0, -3); }
    groups.unshift(s);
    var parts = [];
    for (var i = 0; i < groups.length; i++) {
      var v = parseInt(groups[i], 10);
      if (!v) continue;
      parts.push(under1000(v) + SCALE[groups.length - 1 - i]);
    }
    return parts.join(" ");
  }

  function incStr(d) {
    var a = d.split(""), i = a.length - 1;
    while (i >= 0) {
      if (a[i] === "9") { a[i] = "0"; i--; }
      else { a[i] = String(parseInt(a[i], 10) + 1); break; }
    }
    if (i < 0) a.unshift("1");
    return a.join("");
  }

  // 센트는 셋째 자리에서 반올림하고, 100이 되면 정수부로 올림한다 (0.999 -> 1 and 00/100).
  function cents(frac) {
    var d = (frac + "000").slice(0, 3);
    var c = parseInt(d.slice(0, 2), 10);
    if (parseInt(d.charAt(2), 10) >= 5) c += 1;
    if (c >= 100) return { c: "00", carry: true };
    return { c: (c < 10 ? "0" : "") + c, carry: false };
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var raw = String(num.value).replace(/[\s,_]/g, "").replace(/^[$£€¥₩]/, "");
    if (!raw) return fail("tool.err.empty");
    var m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(raw);
    if (!m || (!m[2] && !m[3])) return fail("tool.err.nan");

    var intPart = (m[2] || "").replace(/^0+/, "") || "0";
    var frac = m[3] || "";
    if (intPart.length > 15) return fail("tool.err.range");

    var isZero = intPart === "0" && /^0*$/.test(frac);
    var sign = (m[1] === "-" && !isZero) ? "negative " : "";

    var cc = cents(frac);
    var checkInt = cc.carry ? incStr(intPart) : intPart;
    if (checkInt.length > 15) return fail("tool.err.range");

    var words = sign + intWords(intPart);
    if (frac) {
      words += " point";
      for (var i = 0; i < frac.length; i++) words += " " + ONES[parseInt(frac.charAt(i), 10)];
    }

    $("r-check").textContent = sign + intWords(checkInt) + " and " + cc.c + "/100";
    $("r-words").textContent = words;
    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  num.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  num.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
