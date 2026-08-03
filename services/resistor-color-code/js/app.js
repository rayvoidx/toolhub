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
  var bands = $("bands"), b1 = $("b1"), b2 = $("b2"), b3 = $("b3"), b3wrap = $("b3wrap");
  var mult = $("mult"), tol = $("tol");
  var result = $("result"), errEl = $("err"), strip = $("strip");
  if (!bands || !b1 || !b2 || !b3 || !mult || !tol) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // IEC 60062 컬러코드. d=유효숫자, m=승수, tv=허용오차(%), light=밝은 배경(글자 검정).
  var C = {
    black:  { d: 0, m: 1,    ml: "1",    hex: "#1f2937" },
    brown:  { d: 1, m: 10,   ml: "10",   hex: "#7c4a1e", tv: 1 },
    red:    { d: 2, m: 100,  ml: "100",  hex: "#dc2626", tv: 2 },
    orange: { d: 3, m: 1e3,  ml: "1k",   hex: "#ea580c" },
    yellow: { d: 4, m: 1e4,  ml: "10k",  hex: "#facc15", light: 1 },
    green:  { d: 5, m: 1e5,  ml: "100k", hex: "#16a34a", tv: 0.5 },
    blue:   { d: 6, m: 1e6,  ml: "1M",   hex: "#2563eb", tv: 0.25 },
    violet: { d: 7, m: 1e7,  ml: "10M",  hex: "#7c3aed", tv: 0.1 },
    grey:   { d: 8, m: 1e8,  ml: "100M", hex: "#9ca3af", light: 1, tv: 0.05 },
    white:  { d: 9, m: 1e9,  ml: "1G",   hex: "#f8fafc", light: 1 },
    gold:   { m: 0.1,  ml: "0.1",  hex: "#c9a227", tv: 5,  light: 1 },
    silver: { m: 0.01, ml: "0.01", hex: "#c0c4c8", tv: 10, light: 1 },
    // 3밴드 저항: 오차 밴드가 없으면 ±20% (IEC 60062)
    none:   { tv: 20, hex: "#e9d8b4", light: 1, noBand: 1 }
  };
  var DIGITS = ["black", "brown", "red", "orange", "yellow", "green", "blue", "violet", "grey", "white"];
  var MULTS = DIGITS.concat(["gold", "silver"]);
  var TOLS = ["brown", "red", "green", "blue", "violet", "grey", "gold", "silver", "none"];

  function label(name, kind) {
    var c = C[name], s = t("tool.c." + name);
    if (kind === "d") return s + " — " + c.d;
    if (kind === "m") return s + " ×" + c.ml;
    return s + " ±" + c.tv + "%";
  }
  function fill(sel, list, kind, def) {
    var keep = sel.value || def, i, o;
    sel.textContent = "";
    for (i = 0; i < list.length; i++) {
      o = document.createElement("option");
      o.value = list[i];
      o.textContent = label(list[i], kind);
      o.style.backgroundColor = C[list[i]].hex;
      o.style.color = C[list[i]].light ? "#111827" : "#ffffff";
      sel.appendChild(o);
    }
    sel.value = keep;
    if (!sel.value) sel.value = def;
  }
  // 기본값 노랑-보라-빨강-금 = 4.7 kΩ ±5% (E24 대표값)
  function fillAll() {
    fill(b1, DIGITS, "d", "yellow");
    fill(b2, DIGITS, "d", "violet");
    fill(b3, DIGITS, "d", "black");
    fill(mult, MULTS, "m", "red");
    fill(tol, TOLS, "t", "gold");
  }

  function trim(x) { return x.toFixed(3).replace(/\.?0+$/, ""); }
  function fmt(v) {
    if (v >= 1e9) return trim(v / 1e9) + " GΩ";
    if (v >= 1e6) return trim(v / 1e6) + " MΩ";
    if (v >= 1e3) return trim(v / 1e3) + " kΩ";
    return trim(v) + " Ω";
  }
  function band(name, cls) {
    var d = document.createElement("div");
    d.className = cls || "band";
    d.style.backgroundColor = C[name].hex;
    return d;
  }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var five = bands.value === "5";
    b3wrap.hidden = !five;
    var names = five ? [b1.value, b2.value, b3.value] : [b1.value, b2.value];
    var m = C[mult.value], p = C[tol.value], digits = 0, i, c;
    for (i = 0; i < names.length; i++) {
      c = C[names[i]];
      // 셀렉트라 정상 경로에선 안 걸리지만, 값이 비면 조용히 NaN 을 내지 않고 안내한다.
      if (!c || typeof c.d !== "number") return fail("tool.err.invalid");
      digits = digits * 10 + c.d;
    }
    if (!m || !p || typeof p.tv !== "number") return fail("tool.err.invalid");

    var ohms = digits * m.m;
    $("r-value").textContent = fmt(ohms);
    $("r-tol").textContent = "±" + p.tv + "%";
    $("r-range").textContent = fmt(ohms * (1 - p.tv / 100)) + " – " + fmt(ohms * (1 + p.tv / 100));

    strip.textContent = "";
    var seq = names.concat([mult.value]);
    for (i = 0; i < seq.length; i++) strip.appendChild(band(seq[i]));
    if (!p.noBand) strip.appendChild(band(tol.value, "band tol"));
    $("r-reading").textContent = seq.concat([tol.value]).map(function (n) { return t("tool.c." + n); }).join(" · ");

    errEl.hidden = true;
    result.hidden = false;
  }

  fillAll();
  b3wrap.hidden = bands.value !== "5";
  $("calc-btn").addEventListener("click", calc);
  [bands, b1, b2, b3, mult, tol].forEach(function (el) {
    el.addEventListener("change", function () {
      if (el === bands) b3wrap.hidden = bands.value !== "5";
      if (!result.hidden || !errEl.hidden) calc();
    });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  document.addEventListener("i18n:change", function () {
    fillAll();
    if (!result.hidden || !errEl.hidden) calc();
  });
  // TOOLJS:END
})();
