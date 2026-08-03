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
  var input = $("color-input"), pick = $("color-pick");
  var result = $("result"), errEl = $("err");
  if (!input || !pick) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function parseColor(raw) {
    var s = String(raw).trim().toLowerCase();
    if (!s) return null;
    // 3/4/6/8자리 hex — 알파(4·8자리)는 대비비 계산이 불가능하므로 버린다
    var m = s.match(/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
    if (m) {
      var h = m[1];
      if (h.length === 4) h = h.slice(0, 3);
      if (h.length === 8) h = h.slice(0, 6);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    m = s.match(/^rgba?\(\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)/);
    if (m) {
      var rgb = [m[1], m[2], m[3]].map(function (v) { return Math.round(Math.min(255, Math.max(0, parseFloat(v)))); });
      return rgb.some(isNaN) ? null : rgb;
    }
    m = s.match(/^hsla?\(\s*([0-9.]+)\s*(?:deg)?[,\s]+([0-9.]+)%?[,\s]+([0-9.]+)%?/);
    if (m) return hslToRgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
    // CSS 색 이름(tomato, rebeccapurple…) — 브라우저가 inline style 을 rgb() 로 정규화해준다
    if (/^[a-z]+$/.test(s)) {
      var probe = document.createElement("span");
      probe.style.color = s;
      var norm = probe.style.color;
      if (norm) {
        var n = norm.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
        if (n) return [+n[1], +n[2], +n[3]];
      }
    }
    return null;
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360; s = Math.min(100, Math.max(0, s)) / 100; l = Math.min(100, Math.max(0, l)) / 100;
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    var p = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return p.map(function (v) { return Math.round((v + m) * 255); });
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d) {
      if (mx === r) h = 60 * (((g - b) / d) % 6);
      else if (mx === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    var l = (mx + mn) / 2;
    var s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    return [Math.round(((h % 360) + 360) % 360), Math.round(s * 100), Math.round(l * 100)];
  }
  var hex2 = function (n) { return ("0" + n.toString(16)).slice(-2); };

  // WCAG 2.x 상대 휘도 — 채널을 선형화한 뒤 녹색에 가장 큰 가중치
  function luminance(rgb) {
    var c = rgb.map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function ratio(a, b) {
    var l1 = luminance(a), l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  function tagFor(r) {
    if (r >= 7) return ["ok", t("tool.pass.aaa")];
    if (r >= 4.5) return ["ok", t("tool.pass.aa")];
    return ["no", t("tool.pass.fail")];
  }

  function calc() {
    var raw = input.value.trim();
    if (!raw) return fail("tool.err.empty");
    var rgb = parseColor(raw);
    if (!rgb) return fail("tool.err.parse");

    var hex = "#" + rgb.map(hex2).join("");
    var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    $("out-hex").value = hex.toUpperCase();
    $("out-rgb").value = "rgb(" + rgb.join(", ") + ")";
    $("out-hsl").value = "hsl(" + hsl[0] + ", " + hsl[1] + "%, " + hsl[2] + "%)";
    $("swatch").style.background = hex;
    pick.value = hex;

    var rw = ratio(rgb, [255, 255, 255]), rb = ratio(rgb, [0, 0, 0]);
    $("cw").textContent = rw.toFixed(2) + ":1";
    $("cb").textContent = rb.toFixed(2) + ":1";
    var tw = tagFor(rw), tb = tagFor(rb);
    $("cw-tag").className = "tag " + tw[0]; $("cw-tag").textContent = tw[1];
    $("cb-tag").className = "tag " + tb[0]; $("cb-tag").textContent = tb[1];

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  input.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  pick.addEventListener("input", function () { input.value = pick.value; calc(); });

  Array.prototype.forEach.call(document.querySelectorAll(".copy-btn"), function (btn) {
    btn.addEventListener("click", function () {
      var el = $(btn.getAttribute("data-copy"));
      if (!el || !el.value) return;
      var done = function () {
        var prev = btn.textContent;
        btn.textContent = t("tool.copied");
        setTimeout(function () { btn.textContent = prev; }, 1200);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(el.value).then(done, function () { el.select(); });
      else { el.select(); document.execCommand("copy"); done(); }
    });
  });

  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
