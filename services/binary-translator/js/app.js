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
  var dir = $("direction"), src = $("src"), out = $("out");
  var result = $("result"), errEl = $("err");
  if (!dir || !src || !out) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 오류 문구는 로케일 문자열의 {c}/{n}/{r} 자리를 채워 넣는다 — 어떤 언어든 위치 정보가 남는다.
  function fail(key, subs) {
    var msg = t(key);
    if (subs) for (var k in subs) msg = msg.replace("{" + k + "}", String(subs[k]));
    result.hidden = true; errEl.hidden = false; errEl.textContent = msg;
  }

  function bits(b) { return ("0000000" + b.toString(2)).slice(-8); }

  // 이모지는 UTF-16 서로게이트 쌍이라 .length 로 세면 2가 된다 — 코드포인트로 센다.
  function cpCount(s) {
    var n = 0, i = 0;
    while (i < s.length) { var c = s.codePointAt(i); i += (c > 0xffff ? 2 : 1); n++; }
    return n;
  }

  function show(text, chars, byteCount) {
    out.value = text;
    $("r-chars").textContent = String(chars);
    $("r-bytes").textContent = String(byteCount);
    $("r-bits").textContent = String(byteCount * 8);
    errEl.hidden = true;
    result.hidden = false;
  }

  function textToBinary(text) {
    var bytes = new TextEncoder().encode(text);
    var parts = [];
    for (var i = 0; i < bytes.length; i++) parts.push(bits(bytes[i]));
    show(parts.join(" "), cpCount(text), bytes.length);
  }

  function binaryToText(raw) {
    // 공백·줄바꿈은 가독성용이므로 버리되, 0/1 이 아닌 글자는 원본 위치와 함께 되돌려준다.
    var compact = "";
    for (var i = 0; i < raw.length; i++) {
      var ch = raw.charAt(i);
      if (/\s/.test(ch)) continue;
      if (ch !== "0" && ch !== "1") return fail("tool.err.chars", { c: ch, n: i + 1 });
      compact += ch;
    }
    if (!compact) return fail("tool.err.empty");
    if (compact.length % 8) return fail("tool.err.group", { n: compact.length, r: compact.length % 8 });

    var bytes = new Uint8Array(compact.length / 8);
    for (var j = 0; j < bytes.length; j++) bytes[j] = parseInt(compact.substr(j * 8, 8), 2);

    var text;
    // fatal:true — 깨진 바이트열을 U+FFFD 로 얼버무리지 않고 명시적 실패로 만든다.
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch (e) { return fail("tool.err.decode"); }
    show(text, cpCount(text), bytes.length);
  }

  function calc() {
    var raw = String(src.value);
    if (!raw.trim()) return fail("tool.err.empty");
    if (dir.value === "b2t") binaryToText(raw); else textToBinary(raw);
  }

  $("calc-btn").addEventListener("click", calc);
  src.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) calc(); });
  src.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
  dir.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });

  $("copy-btn").addEventListener("click", function () {
    var btn = $("copy-btn");
    if (!out.value) return;
    var done = function () {
      var prev = btn.textContent;
      btn.textContent = t("tool.copied");
      setTimeout(function () { btn.textContent = prev; }, 1200);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(out.value).then(done, function () { /* 권한 거부 */ });
    else { out.select(); done(); }
  });
  // TOOLJS:END
})();
