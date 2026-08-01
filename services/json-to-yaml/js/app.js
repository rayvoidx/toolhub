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
  var src = $("src"), indent = $("indent"), out = $("out");
  var result = $("result"), errEl = $("err");
  if (!src || !indent || !out) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var STEP = 2;
  function pad(n) { var s = ""; for (var i = 0; i < n; i++) s += " "; return s; }

  /* 인용 규칙: YAML 1.1 파서까지 통과해야 하므로, 따옴표 없이 두면 타입이 바뀌는 문자열을 전부 잡는다.
     (no/on/y 계열 = Norway 문제, 숫자꼴, 0x·60진수, 지시자 문자로 시작, ": " 포함 등) */
  function needsQuote(s) {
    if (s === "") return true;
    if (/^\s|\s$/.test(s)) return true;
    if (/[\u0000-\u001F\u007F]/.test(s)) return true;
    if (/^(y|n|yes|no|on|off|true|false|null|~)$/i.test(s)) return true;
    if (/^[-+]?\.(inf|nan)$/i.test(s)) return true;
    if (/^[-+]?[0-9][0-9_]*(\.[0-9_]*)?([eE][-+]?[0-9]+)?$/.test(s)) return true;
    if (/^[-+]?\.[0-9]+([eE][-+]?[0-9]+)?$/.test(s)) return true;
    if (/^0[xXbBoO][0-9a-fA-F_]+$/.test(s)) return true;
    if (/^[0-9]+(:[0-5]?[0-9])+$/.test(s)) return true;
    if (/^[-?:,\[\]{}#&*!|>'"%@\u0060]/.test(s)) return true;
    if (/:(\s|$)/.test(s) || /\s#/.test(s)) return true;
    return false;
  }

  function token(v) {
    if (v === null) return "null";
    if (v === true) return "true";
    if (v === false) return "false";
    if (typeof v === "number") return isFinite(v) ? String(v) : "null";
    var s = String(v);
    return needsQuote(s) ? JSON.stringify(s) : s;
  }
  function keyToken(k) { return needsQuote(k) ? JSON.stringify(k) : k; }

  /* 여러 줄 문자열은 리터럴 블록(|)이 읽기 좋다. 단 들여쓰기 표시자나 keep 청킹(|+)이
     필요한 모양이면 정확성을 위해 큰따옴표 인용으로 되돌린다. */
  function isBlock(s) {
    if (s.indexOf("\n") < 0) return false;
    if (/[\r\t]/.test(s)) return false;
    if (/[\u0000-\u0009\u000B-\u001F\u007F]/.test(s)) return false;
    if (/\n\n$/.test(s)) return false;
    var lines = s.split("\n");
    if (lines[0] === "" || /^[ ]/.test(lines[0])) return false;
    return true;
  }

  function pushScalar(head, v, col, lines) {
    if (typeof v === "string" && isBlock(v)) {
      var body = v, chomp = "-";
      if (body.charAt(body.length - 1) === "\n") { body = body.slice(0, -1); chomp = ""; }
      lines.push(head + " |" + chomp);
      var parts = body.split("\n");
      for (var i = 0; i < parts.length; i++) lines.push(parts[i] === "" ? "" : pad(col + STEP) + parts[i]);
      return;
    }
    lines.push(head + " " + token(v));
  }

  function emitMap(obj, col, lines) {
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) emitKeyed(keyToken(keys[i]) + ":", obj[keys[i]], col, lines);
  }

  function emitKeyed(head, v, col, lines) {
    var ind = pad(col);
    if (v === null || typeof v !== "object") { pushScalar(ind + head, v, col, lines); return; }
    if (Array.isArray(v)) {
      if (!v.length) { lines.push(ind + head + " []"); return; }
      lines.push(ind + head);
      emitSeq(v, col + STEP, lines);
      return;
    }
    if (!Object.keys(v).length) { lines.push(ind + head + " {}"); return; }
    lines.push(ind + head);
    emitMap(v, col + STEP, lines);
  }

  function emitSeq(arr, col, lines) {
    var ind = pad(col);
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (v === null || typeof v !== "object") { pushScalar(ind + "-", v, col, lines); continue; }
      if (Array.isArray(v)) {
        if (!v.length) { lines.push(ind + "- []"); continue; }
        lines.push(ind + "-");
        emitSeq(v, col + STEP, lines);
        continue;
      }
      if (!Object.keys(v).length) { lines.push(ind + "- {}"); continue; }
      // 첫 키는 대시 줄에 붙이고, 나머지 줄은 대시 + 2칸 열에 맞춘다.
      var sub = [];
      emitMap(v, col + 2, sub);
      sub[0] = ind + "- " + sub[0].slice(col + 2);
      for (var j = 0; j < sub.length; j++) lines.push(sub[j]);
    }
  }

  function toYaml(data) {
    var lines = [];
    if (data === null || typeof data !== "object") {
      pushScalar("", data, 0, lines);
      lines[0] = lines[0].replace(/^ /, "");
      return lines.join("\n");
    }
    if (Array.isArray(data)) {
      if (!data.length) return "[]";
      emitSeq(data, 0, lines);
    } else {
      if (!Object.keys(data).length) return "{}";
      emitMap(data, 0, lines);
    }
    return lines.join("\n");
  }

  function stats(v, depth, acc) {
    if (depth > acc.depth) acc.depth = depth;
    if (v === null || typeof v !== "object") return acc;
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) stats(v[i], depth + 1, acc);
      return acc;
    }
    var ks = Object.keys(v);
    acc.keys += ks.length;
    for (var j = 0; j < ks.length; j++) stats(v[ks[j]], depth + 1, acc);
    return acc;
  }

  function fail(key, extra) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = extra ? t(key) + " " + extra : t(key);
  }

  function calc() {
    var raw = String(src.value);
    if (!raw.trim()) return fail("tool.err.empty");
    var data;
    try { data = JSON.parse(raw); }
    catch (e) { return fail("tool.err.parse", (e && e.message) || ""); }
    STEP = parseInt(indent.value, 10) === 4 ? 4 : 2;
    var yaml;
    // 아주 깊게 중첩된 문서는 재귀가 스택을 넘길 수 있다 — 조용히 죽지 않고 문구로 알린다.
    try { yaml = toYaml(data); }
    catch (e2) { return fail("tool.err.parse", (e2 && e2.message) || ""); }

    out.value = yaml;
    var acc = stats(data, 0, { keys: 0, depth: 0 });
    $("r-lines").textContent = String(yaml === "" ? 0 : yaml.split("\n").length);
    $("r-keys").textContent = String(acc.keys);
    $("r-depth").textContent = String(acc.depth);
    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  src.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); calc(); }
  });
  src.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
  indent.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });

  $("copy-btn").addEventListener("click", function () {
    var btn = $("copy-btn");
    if (!out.value) return;
    var done = function () {
      var prev = btn.textContent;
      btn.textContent = t("tool.copied");
      setTimeout(function () { btn.textContent = prev; }, 1200);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(out.value).then(done, function () { /* 권한 거부 — 무시 */ });
    else { out.select(); done(); }
  });
  // TOOLJS:END
})();
