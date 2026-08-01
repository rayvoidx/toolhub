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
  var urlEl = $("url-input"), rawEl = $("raw-toggle");
  var result = $("result"), errEl = $("err");
  var ptable = $("ptable"), pbody = $("pbody"), noParams = $("no-params");
  var segs = $("segs"), segsTitle = $("segs-title"), schemeNote = $("scheme-note");
  if (!urlEl || !rawEl) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 스킴 판정: 콜론 뒤가 // 이거나, 숫자·슬래시가 아닌 문자여야 스킴이다.
  // example.com:8080/x 의 콜론은 포트 구분자라 스킴으로 오인하면 안 된다(그때는 https:// 를 붙인다).
  var SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.\-]*:(\/\/|[^\/0-9])/;

  // 깨진 시퀀스(%zz)는 decodeURIComponent 가 던진다 — 그럴 땐 원문을 그대로 보여준다.
  function dec(s, plus) {
    var v = plus ? String(s).replace(/\+/g, " ") : String(s);
    try { return decodeURIComponent(v); } catch (e) { return String(s); }
  }

  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function parse(raw) {
    var schemed = SCHEME_RE.test(raw);
    try { return { url: new URL(schemed ? raw : "https://" + raw), fixed: !schemed }; }
    catch (e) { return null; }
  }

  // 같은 키가 반복돼도 합치지 않는다 — 서버 프레임워크마다 처리가 달라 원본 순서가 정보다.
  function rowsOf(q, showRaw) {
    var out = [], parts = q.split("&"), i, p, eq, k, v;
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      if (!p) continue;
      eq = p.indexOf("=");
      k = eq === -1 ? p : p.slice(0, eq);
      v = eq === -1 ? "" : p.slice(eq + 1);
      out.push({ k: showRaw ? k : dec(k, true), v: showRaw ? v : dec(v, true) });
    }
    return out;
  }

  function cell(text) { var td = document.createElement("td"); td.textContent = text; return td; }

  function calc() {
    var raw = String(urlEl.value).trim();
    if (!raw) return fail("tool.err.empty");
    var got = parse(raw);
    if (!got) return fail("tool.err.invalid");

    var u = got.url, showRaw = !!rawEl.checked, i;
    schemeNote.hidden = !got.fixed;

    $("r-origin").textContent = (u.origin && u.origin !== "null") ? u.origin : t("tool.val.none");
    $("r-protocol").textContent = u.protocol;
    $("r-host").textContent = u.hostname || t("tool.val.none");
    $("r-port").textContent = u.port || (u.host ? t("tool.val.defaultport") : t("tool.val.none"));
    $("r-path").textContent = showRaw ? (u.pathname || "/") : dec(u.pathname || "/", false);
    $("r-hash").textContent = u.hash ? (showRaw ? u.hash : dec(u.hash, false)) : t("tool.val.none");

    var rows = rowsOf(u.search.slice(1), showRaw), tr;
    while (pbody.firstChild) pbody.removeChild(pbody.firstChild);
    for (i = 0; i < rows.length; i++) {
      tr = document.createElement("tr");
      tr.appendChild(cell(rows[i].k === "" ? t("tool.val.none") : rows[i].k));
      tr.appendChild(cell(rows[i].v === "" ? t("tool.val.none") : rows[i].v));
      pbody.appendChild(tr);
    }
    ptable.hidden = rows.length === 0;
    noParams.hidden = rows.length !== 0;

    var seg = String(u.pathname || "").split("/"), list = [], li;
    for (i = 0; i < seg.length; i++) if (seg[i]) list.push(showRaw ? seg[i] : dec(seg[i], false));
    while (segs.firstChild) segs.removeChild(segs.firstChild);
    for (i = 0; i < list.length; i++) {
      li = document.createElement("li");
      li.textContent = list[i];
      segs.appendChild(li);
    }
    segs.hidden = list.length === 0;
    segsTitle.hidden = list.length === 0;

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  // URL 에 줄바꿈은 없다 — Enter 는 실행으로 쓴다.
  urlEl.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); calc(); } });
  [urlEl, rawEl].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
