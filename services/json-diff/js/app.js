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
  var aEl = $("json-a"), bEl = $("json-b");
  var result = $("result"), errEl = $("err"), dlist = $("dlist"), listTitle = $("list-title");
  if (!aEl || !bEl) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  // 목록만 잘라 그린다 — 카운터는 항상 전체 기준이다.
  var MAX_ROWS = 500;

  function fail(key, extra) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = extra ? t(key) + " " + extra : t(key);
  }

  function isContainer(v) { return v !== null && typeof v === "object"; }
  function childPath(path, key, inArray) {
    if (inArray) return path + "[" + key + "]";
    return path ? path + "." + key : String(key);
  }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // 재귀 비교. 배열은 인덱스 기준, 객체는 키 기준, 타입이 바뀌면 통째로 changed 로 본다.
  function walk(a, b, path, out) {
    var aArr = Array.isArray(a), bArr = Array.isArray(b), i, k;
    if (aArr && bArr) {
      var n = Math.max(a.length, b.length);
      for (i = 0; i < n; i++) {
        if (i >= a.length) out.push({ kind: "added", path: childPath(path, i, true), nv: b[i] });
        else if (i >= b.length) out.push({ kind: "removed", path: childPath(path, i, true), ov: a[i] });
        else walk(a[i], b[i], childPath(path, i, true), out);
      }
      return;
    }
    if (isContainer(a) && isContainer(b) && !aArr && !bArr) {
      var seen = Object.create(null);
      for (k in a) {
        if (!has(a, k)) continue;
        seen[k] = 1;
        if (has(b, k)) walk(a[k], b[k], childPath(path, k, false), out);
        else out.push({ kind: "removed", path: childPath(path, k, false), ov: a[k] });
      }
      for (k in b) {
        if (has(b, k) && !seen[k]) out.push({ kind: "added", path: childPath(path, k, false), nv: b[k] });
      }
      return;
    }
    if (a !== b) out.push({ kind: "changed", path: path, ov: a, nv: b });
  }

  function fmt(v) {
    var s;
    try { s = JSON.stringify(v); } catch (e) { s = null; }
    if (typeof s !== "string") s = String(v);
    return s.length > 80 ? s.slice(0, 80) + "…" : s;
  }

  function span(cls, text) {
    var el = document.createElement("span");
    el.className = cls;
    el.textContent = text;
    return el;
  }

  function row(d) {
    var div = document.createElement("div");
    div.className = "drow";
    div.appendChild(span("badge " + (d.kind === "added" ? "add" : d.kind === "removed" ? "rem" : "chg"), t("tool.r." + d.kind)));
    var p = document.createElement("code");
    p.className = "dpath";
    p.textContent = d.path || t("tool.path.root");
    div.appendChild(p);
    if (d.kind !== "added") div.appendChild(span("dval old", fmt(d.ov)));
    if (d.kind === "changed") div.appendChild(span("arrow", "→"));
    if (d.kind !== "removed") div.appendChild(span("dval", fmt(d.nv)));
    return div;
  }

  function calc() {
    var sa = String(aEl.value).trim(), sb = String(bEl.value).trim();
    if (!sa && !sb) return fail("tool.err.empty");
    if (!sa) return fail("tool.err.emptyA");
    if (!sb) return fail("tool.err.emptyB");

    var A, B;
    try { A = JSON.parse(sa); } catch (e) { return fail("tool.err.parseA", e.message); }
    try { B = JSON.parse(sb); } catch (e) { return fail("tool.err.parseB", e.message); }

    var diffs = [];
    walk(A, B, "", diffs);

    var counts = { added: 0, removed: 0, changed: 0 }, i;
    for (i = 0; i < diffs.length; i++) counts[diffs[i].kind]++;

    $("r-total").textContent = diffs.length ? String(diffs.length) : t("tool.r.identical");
    $("r-added").textContent = String(counts.added);
    $("r-removed").textContent = String(counts.removed);
    $("r-changed").textContent = String(counts.changed);

    while (dlist.firstChild) dlist.removeChild(dlist.firstChild);
    var shown = Math.min(diffs.length, MAX_ROWS);
    for (i = 0; i < shown; i++) dlist.appendChild(row(diffs[i]));
    if (diffs.length > MAX_ROWS) {
      var more = document.createElement("div");
      more.className = "drow";
      more.textContent = t("tool.r.more") + " " + (diffs.length - MAX_ROWS);
      dlist.appendChild(more);
    }
    dlist.hidden = diffs.length === 0;
    listTitle.hidden = diffs.length === 0;

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [aEl, bEl].forEach(function (el) {
    // 텍스트에어리어에서 맨 Enter 는 줄바꿈이어야 하므로 Ctrl/Cmd+Enter 로 실행한다.
    el.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); calc(); } });
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
