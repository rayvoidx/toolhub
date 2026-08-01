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
  var names = $("names"), noRecip = $("no-reciprocal");
  var result = $("result"), errEl = $("err"), btn = $("calc-btn");
  var rowsEl = $("rows"), revealBtn = $("reveal-btn"), copyBtn = $("copy-btn"), copyStatus = $("copy-status");
  if (!names || !btn || !rowsEl) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var MAX = 200, ATTEMPTS = 1000;

  var people = [];   // 확정된 참가자 이름 (중복 번호 부여 후)
  var pick = [];     // pick[i] = i 번 참가자가 선물할 상대의 인덱스
  var shown = [];    // 줄별 공개 여부

  var lastErr = null;   // 언어를 바꿔도 떠 있는 오류 문구가 그대로 남지 않도록 키를 들고 있는다.

  function fail(key) {
    lastErr = key;
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function lines() {
    return names.value.split("\n").map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
  }

  // 같은 이름이 두 번 이상 나오면 번호를 붙인다 — 안 붙이면 결과 화면에서 누가 누구인지 구분되지 않는다.
  function numberDuplicates(raw) {
    var count = {}, used = {}, out = [], dupes = false;
    raw.forEach(function (n) { var k = "#" + n.toLowerCase(); count[k] = (count[k] || 0) + 1; });
    raw.forEach(function (n) {
      var k = "#" + n.toLowerCase();
      if (count[k] > 1) { used[k] = (used[k] || 0) + 1; dupes = true; out.push(n + " (" + used[k] + ")"); }
      else { out.push(n); }
    });
    return { list: out, dupes: dupes };
  }

  // 편향 없는 정수 난수 — 나머지 연산만 쓰면 앞쪽 인덱스가 더 자주 나온다. 초과 구간은 버리고 다시 뽑는다.
  function randomIndex(n) {
    if (n <= 1) return 0;
    var g = (window.crypto && window.crypto.getRandomValues) ? window.crypto : null;
    if (!g) return Math.floor(Math.random() * n);
    var limit = Math.floor(4294967296 / n) * n;
    var buf = new Uint32Array(1);
    do { g.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % n;
  }

  function shuffledIndexes(n) {
    var a = [], i, j, tmp;
    for (i = 0; i < n; i++) a.push(i);
    for (i = n - 1; i > 0; i--) { j = randomIndex(i + 1); tmp = a[i]; a[i] = a[j]; a[j] = tmp; }
    return a;
  }

  // 완전순열(derangement) — 자기 자신을 뽑은 배열은 버리고 다시 섞는다.
  // 무작위 셔플이 조건을 만족할 확률은 약 37%(1/e)라 보통 두세 번이면 끝난다.
  // avoidPairs 면 서로 주고받는 2-사이클도 버린다 (확률 약 22%로 떨어지지만 여전히 충분).
  function derange(n, avoidPairs) {
    for (var attempt = 0; attempt < ATTEMPTS; attempt++) {
      var a = shuffledIndexes(n), ok = true;
      for (var i = 0; i < n; i++) {
        if (a[i] === i || (avoidPairs && a[a[i]] === i)) { ok = false; break; }
      }
      if (ok) return a;
    }
    return null; // 이론상 n>=3 이면 도달하지 않는다 — 도달하면 조용히 넘기지 말고 알린다.
  }

  function syncRevealBtn() {
    var allShown = shown.length > 0 && shown.every(function (v) { return v; });
    revealBtn.textContent = t(allShown ? "tool.hide" : "tool.reveal");
  }

  function render() {
    rowsEl.textContent = "";
    people.forEach(function (name, i) {
      var card = document.createElement("div");
      card.className = "rcard";

      var giver = document.createElement("span");
      giver.className = "giver";
      giver.textContent = name;

      var label = document.createElement("span");
      label.className = "rc-label";
      label.textContent = t("tool.r.gives");

      var recip = document.createElement("button");
      recip.type = "button";
      recip.className = shown[i] ? "recip" : "recip masked";
      recip.textContent = people[pick[i]];
      recip.addEventListener("click", function () {
        shown[i] = !shown[i];
        recip.className = shown[i] ? "recip" : "recip masked";
        syncRevealBtn();
      });

      card.appendChild(giver);
      card.appendChild(label);
      card.appendChild(recip);
      rowsEl.appendChild(card);
    });
    $("r-count").textContent = String(people.length);
    syncRevealBtn();
  }

  function draw() {
    copyStatus.hidden = true;
    var raw = lines();
    if (raw.length === 0) return fail("tool.err.empty");
    if (raw.length < 3) return fail("tool.err.min");
    if (raw.length > MAX) return fail("tool.err.max");

    var norm = numberDuplicates(raw);
    var order = derange(norm.list.length, !!(noRecip && noRecip.checked));
    if (!order) return fail("tool.err.impossible");

    people = norm.list;
    pick = order;
    shown = people.map(function () { return false; });

    $("dupe-warn").hidden = !norm.dupes;
    errEl.hidden = true;
    result.hidden = false;
    render();
    btn.textContent = t("tool.redraw");
  }

  function assignmentText() {
    return people.map(function (name, i) { return name + " -> " + people[pick[i]]; }).join("\n");
  }

  function say(key) {
    copyStatus.hidden = false;
    copyStatus.textContent = t(key);
  }

  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "readonly");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    say(ok ? "tool.copied" : "tool.copyfail");
  }

  function copyList() {
    if (!people.length) return;
    var text = assignmentText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { say("tool.copied"); }, function () { legacyCopy(text); });
      return;
    }
    legacyCopy(text);
  }

  btn.addEventListener("click", draw);
  revealBtn.addEventListener("click", function () {
    var allShown = shown.length > 0 && shown.every(function (v) { return v; });
    shown = shown.map(function () { return !allShown; });
    render();
  });
  copyBtn.addEventListener("click", copyList);

  // textarea 안에서 Enter 는 줄바꿈이어야 하므로 추첨은 Ctrl/Cmd+Enter 로 건다.
  names.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); draw(); }
  });
  names.addEventListener("input", function () { if (!errEl.hidden) errEl.hidden = true; });
  // 옵션은 추첨 조건 자체라 결과가 떠 있으면 다시 뽑는다.
  if (noRecip) noRecip.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) draw(); });

  document.addEventListener("i18n:change", function () {
    btn.textContent = t(people.length ? "tool.redraw" : "tool.draw");
    if (!errEl.hidden && lastErr) { errEl.textContent = t(lastErr); return; }
    if (!result.hidden) { copyStatus.hidden = true; render(); }
  });
  // TOOLJS:END
})();
