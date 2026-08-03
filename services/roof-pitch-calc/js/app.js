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
  var mode = $("mode"), rise = $("rise"), run = $("run"), angle = $("angle"), pitch = $("pitch"), span = $("span"), spanUnit = $("span-unit");
  var result = $("result"), errEl = $("err");
  if (!mode || !rise || !run || !angle || !pitch || !span || !spanUnit) return;
  var SPAN_DEFAULT = 24;            // ft — 기본 단위/기본값은 종전과 동일
  var SPAN_DEFAULT_M = 7.2;         // m 선택 시의 기본 스팬(약 24ft)
  // 단위별 허용 범위 — 종전 ft 범위(1~200)를 그대로 두고 m 범위만 환산해 추가.
  var SPAN_RANGE = { ft: [1, 200], m: [0.3, 60] };

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) {
    var v = parseFloat(String(el.value).replace(/,/g, ""));
    return isFinite(v) ? v : null;
  };
  // toFixed 후 꼬리 0 제거 — 정수의 끝자리 0("100")까지 깎지 않도록 소수점이 있을 때만 자른다.
  function fmt(n, d) {
    var s = n.toFixed(d);
    return s.indexOf(".") < 0 ? s : s.replace(/0+$/, "").replace(/\.$/, "");
  }
  function ftIn(ft) {
    var whole = Math.floor(ft), inch = Math.round((ft - whole) * 12);
    if (inch === 12) { whole += 1; inch = 0; }
    return fmt(ft, 2) + " ft (" + whole + "' " + inch + "\")";
  }

  function syncRows() {
    var m = mode.value;
    $("row-riserun").hidden = m !== "riserun";
    $("row-angle").hidden = m !== "angle";
    $("row-pitch").hidden = m !== "pitch";
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function unit() { return spanUnit.value === "m" ? "m" : "ft"; }
  // 스팬은 선택 입력 — 비우면 기본값(ft 24 / m 7.2).
  function spanVal() {
    var u = unit();
    if (String(span.value).trim() === "") return u === "m" ? SPAN_DEFAULT_M : SPAN_DEFAULT;
    var v = num(span), r = SPAN_RANGE[u];
    if (v === null || v < r[0] || v > r[1]) return null;
    return v;
  }
  function syncRafterLabel(s) {
    var el = $("r-rafter-label");
    if (el) el.textContent = t("tool.r.rafter").replace("{span}", fmt(s, 2)).replace("{unit}", unit());
  }

  // 세 입력 모드는 결국 하나의 비(rise/run)로 수렴한다. 그 뒤 계산은 공통.
  function ratioOf(m) {
    if (m === "angle") {
      var a = num(angle);
      if (a === null) return { err: "tool.err.empty" };
      if (a < 0 || a >= 89) return { err: "tool.err.angle" };
      return { r: Math.tan(a * Math.PI / 180) };
    }
    if (m === "pitch") {
      var p = num(pitch);
      if (p === null) return { err: "tool.err.empty" };
      if (p < 0 || p > 48) return { err: "tool.err.pitch" };
      return { r: p / 12 };
    }
    var rs = num(rise), rn = num(run);
    if (rs === null || rn === null) return { err: "tool.err.empty" };
    if (rs < 0) return { err: "tool.err.rise" };
    if (rn <= 0) return { err: "tool.err.run" };   // run 0 = 수직 벽, 각도 정의 불가
    return { r: rs / rn };
  }

  function category(p12) {
    if (p12 < 2) return ["tool.cat.flat", "tool.cat.flat.note"];
    if (p12 < 4) return ["tool.cat.low", "tool.cat.low.note"];
    if (p12 < 9) return ["tool.cat.conv", "tool.cat.conv.note"];
    return ["tool.cat.steep", "tool.cat.steep.note"];
  }

  function calc() {
    var got = ratioOf(mode.value);
    if (got.err) return fail(got.err);
    var sp = spanVal();
    if (sp === null) return fail("tool.err.span");

    var ratio = got.r;
    var p12 = ratio * 12;
    var deg = Math.atan(ratio) * 180 / Math.PI;
    var mult = Math.sqrt(1 + ratio * ratio);

    $("r-pitch").textContent = fmt(p12, 2) + "/12";
    $("r-angle").textContent = fmt(deg, 2) + "\u00B0";
    $("r-slope").textContent = fmt(ratio * 100, 1) + "%";
    $("r-mult").textContent = "\u00D7 " + fmt(mult, 4);
    syncRafterLabel(sp);
    var raft = sp / 2 * mult;   // 스팬의 절반이 수평 run
    $("r-rafter").textContent = unit() === "m" ? fmt(raft, 3) + " m" : ftIn(raft);

    var cat = category(p12);
    $("r-cat").textContent = t(cat[0]);
    $("r-cat-note").textContent = t(cat[1]);

    errEl.hidden = true;
    result.hidden = false;
  }

  function refreshLabel() {
    var s = spanVal();
    syncRafterLabel(s === null ? (unit() === "m" ? SPAN_DEFAULT_M : SPAN_DEFAULT) : s);
  }

  syncRows();
  refreshLabel();
  $("calc-btn").addEventListener("click", calc);
  [rise, run, angle, pitch, span].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  mode.addEventListener("change", function () {
    syncRows();
    if (!result.hidden || !errEl.hidden) calc();
  });
  spanUnit.addEventListener("change", function () {
    var r = SPAN_RANGE[unit()];
    span.min = r[0]; span.max = r[1];
    span.placeholder = unit() === "m" ? "7.2" : "24";
    refreshLabel();
    if (!result.hidden || !errEl.hidden) calc();
  });
  document.addEventListener("i18n:change", function () {
    refreshLabel();
    if (!result.hidden) calc();
  });
  // TOOLJS:END
})();
