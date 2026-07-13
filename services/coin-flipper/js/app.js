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

  // GA4 — 설정 시에만 로드, 실패해도 본 기능에 영향 없게 격리 (safeTrack 원칙)
  if (cfg.analytics && cfg.analytics.ga4) {
    try {
      var s = document.createElement("script");
      s.async = true;
      s.src = "https://www.googletagmanager.com/gtag/js?id=" + cfg.analytics.ga4;
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", cfg.analytics.ga4);
    } catch (e) { /* 분석 실패는 조용히 무시 */ }
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
  var cfg = window.APP_CONFIG || {};
  var LS_KEY = (cfg.slug || "coin-flipper") + ":state";
  var MAX_N = 1000;
  var MAX_SEQ = 200; // 시퀀스 스트립에 표시할 최대 칩 수 (성능)

  function $(id) { return document.getElementById(id); }
  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }

  var coinBtn = $("cf-coin");
  var inner = $("cf-coin-inner");
  var faceHeads = $("cf-face-heads");
  var faceTails = $("cf-face-tails");
  var resultEl = $("cf-result");
  var flipBtn = $("cf-flip");
  var noteEl = $("cf-note");
  var countEl = $("cf-count");
  var manyControls = $("cf-many-controls");
  var labelHeadsEl = $("cf-label-heads");
  var labelTailsEl = $("cf-label-tails");
  var emptyEl = $("cf-empty");
  var tallyEl = $("cf-tally");
  var hLabelEl = $("cf-h-label");
  var tLabelEl = $("cf-t-label");
  var hCountEl = $("cf-h-count");
  var tCountEl = $("cf-t-count");
  var hPctEl = $("cf-h-pct");
  var tPctEl = $("cf-t-pct");
  var totalEl = $("cf-total");
  var resetBtn = $("cf-reset");
  var batchEl = $("cf-batch");
  var batchHead = $("cf-batch-head");
  var batchHeads = $("cf-batch-heads");
  var batchTails = $("cf-batch-tails");
  var seqEl = $("cf-seq");
  var truncEl = $("cf-trunc");
  if (!coinBtn || !inner || !flipBtn) return;

  // ---------- calc-core:start — 순수 로직 (node 단위검증 대상, window/DOM 미의존) ----------
  // 한 번의 던지기 = 1비트. 0 = 앞면(heads), 1 = 뒷면(tails).
  function bitFromByte(byte) { return byte & 1; }

  // "몇 개" 입력 파싱 → { n, note }. 빈값·비정수 → 기본 10, 범위 밖 → 클램프.
  function parseCount(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (s === "" || !/^-?\d+$/.test(s)) return { n: 10, note: "many" };
    var n = parseInt(s, 10);
    if (isNaN(n)) return { n: 10, note: "many" };
    if (n < 1) return { n: 1, note: "low" };
    if (n > MAX_N) return { n: MAX_N, note: "high" };
    return { n: n, note: null };
  }

  // N번 던지기. nextBit()가 0/1을 반환. { heads, tails, seq }.
  function tally(n, nextBit) {
    var heads = 0, tails = 0, seq = [];
    for (var i = 0; i < n; i++) {
      var b = nextBit() === 1 ? 1 : 0;
      if (b === 1) { tails++; } else { heads++; }
      seq.push(b);
    }
    return { heads: heads, tails: tails, seq: seq };
  }

  // 백분율 (0..100). total 0 이면 0.
  function pct(part, total) { return total === 0 ? 0 : (part / total) * 100; }
  // ---------- calc-core:end ----------

  // 표시용 백분율 포맷: 소수 첫째 자리, 불필요한 .0 제거.
  function fmtPct(p) {
    var r = Math.round(p * 10) / 10;
    return (Math.round(r) === r) ? String(Math.round(r)) : String(r);
  }
  function fill(tpl, map) {
    return String(tpl).replace(/\{(\w+)\}/g, function (m, k) {
      return (map[k] != null) ? map[k] : m;
    });
  }

  // 안전한 난수 비트: crypto.getRandomValues 전용 (Math.random 미사용).
  var cryptoObj = (typeof window !== "undefined" && (window.crypto || window.msCrypto)) || null;
  var cryptoOK = !!(cryptoObj && cryptoObj.getRandomValues);
  function randomBit() {
    var a = new Uint8Array(1);
    cryptoObj.getRandomValues(a);
    return bitFromByte(a[0]);
  }

  // 현재 라벨 (사용자 지정값 우선, 없으면 현재 언어의 기본값).
  function headsLabel() {
    var v = labelHeadsEl ? labelHeadsEl.value.trim() : "";
    return v || t("tool.headsDefault", "Heads");
  }
  function tailsLabel() {
    var v = labelTailsEl ? labelTailsEl.value.trim() : "";
    return v || t("tool.tailsDefault", "Tails");
  }

  // 영속 상태 (localStorage 만 — 서버 미전송).
  var state = { mode: "single", count: 10, headsLabel: "", tailsLabel: "", heads: 0, tails: 0 };
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
  }
  function restore() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      var p = JSON.parse(raw);
      if (p && typeof p === "object") {
        if (p.mode === "single" || p.mode === "many") state.mode = p.mode;
        if (typeof p.count === "number" && p.count >= 1) state.count = Math.min(MAX_N, Math.floor(p.count));
        if (typeof p.headsLabel === "string") state.headsLabel = p.headsLabel.slice(0, 24);
        if (typeof p.tailsLabel === "string") state.tailsLabel = p.tailsLabel.slice(0, 24);
        if (typeof p.heads === "number" && p.heads >= 0) state.heads = Math.floor(p.heads);
        if (typeof p.tails === "number" && p.tails >= 0) state.tails = Math.floor(p.tails);
      }
    } catch (e) { /* 파싱 실패 — 기본값으로 시작 */ }
  }

  var lastBatch = null;   // 언어 전환 재렌더용 (영속 아님)
  var lastSingle = null;  // 마지막 단일 결과 side (0/1)
  var flipping = false;

  function setNote(kind) {
    if (!noteEl) return;
    if (!kind) { noteEl.textContent = ""; return; }
    var map = {
      many: t("tool.err.many", "Enter a whole number — reset to 10."),
      low: t("tool.err.clampLow", "At least 1 coin — using 1."),
      high: t("tool.err.clampHigh", "Up to 1000 at once — using 1000."),
      nocrypto: t("tool.err.nocrypto", "Your browser blocks secure randomness, so a fair flip isn't available here.")
    };
    noteEl.textContent = map[kind] || "";
  }

  function renderFaces() {
    if (faceHeads) faceHeads.textContent = headsLabel();
    if (faceTails) faceTails.textContent = tailsLabel();
  }

  var rotation = 0;
  function spinTo(side) {
    var base = side === 1 ? 180 : 0;
    var cur = rotation % 360; if (cur < 0) cur += 360;
    rotation += 720 + (base - cur); // 항상 앞으로 최소 2바퀴 회전 후 정확한 면으로 착지
    inner.style.transform = "rotateY(" + rotation + "deg)";
  }

  function renderStats() {
    var total = state.heads + state.tails;
    if (total === 0) {
      if (emptyEl) emptyEl.hidden = false;
      if (tallyEl) tallyEl.hidden = true;
      if (totalEl) totalEl.hidden = true;
      if (resetBtn) resetBtn.hidden = true;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    if (tallyEl) tallyEl.hidden = false;
    if (totalEl) totalEl.hidden = false;
    if (resetBtn) resetBtn.hidden = false;
    hLabelEl.textContent = headsLabel();
    tLabelEl.textContent = tailsLabel();
    hCountEl.textContent = String(state.heads);
    tCountEl.textContent = String(state.tails);
    hPctEl.textContent = fmtPct(pct(state.heads, total)) + "%";
    tPctEl.textContent = fmtPct(pct(state.tails, total)) + "%";
    totalEl.textContent = fill(t("tool.stats.total", "Total flips: {n}"), { n: total });
  }

  function renderResultLine(side) {
    if (!resultEl) return;
    if (side == null) { resultEl.hidden = true; resultEl.textContent = ""; return; }
    var label = side === 1 ? tailsLabel() : headsLabel();
    var parts = t("tool.result.single", "Landed on {side}").split("{side}");
    resultEl.hidden = false;
    resultEl.innerHTML = "";
    resultEl.appendChild(document.createTextNode(parts[0] || ""));
    var strong = document.createElement("strong");
    strong.textContent = label;
    resultEl.appendChild(strong);
    resultEl.appendChild(document.createTextNode(parts.length > 1 ? parts[1] : ""));
  }

  function renderBatch() {
    if (!batchEl || !lastBatch) { if (batchEl) batchEl.hidden = true; return; }
    var b = lastBatch;
    var n = b.heads + b.tails;
    batchEl.hidden = false;
    batchHead.textContent = fill(t("tool.many.resultHeading", "Result of {n} flips"), { n: n });
    var line = t("tool.stats.line", "{label}: {count} ({pct}%)");
    batchHeads.textContent = fill(line, { label: headsLabel(), count: b.heads, pct: fmtPct(pct(b.heads, n)) });
    batchTails.textContent = fill(line, { label: tailsLabel(), count: b.tails, pct: fmtPct(pct(b.tails, n)) });
    // 시퀀스 스트립 (앞에서 MAX_SEQ 개만)
    seqEl.innerHTML = "";
    var shown = Math.min(b.seq.length, MAX_SEQ);
    for (var i = 0; i < shown; i++) {
      var chip = document.createElement("b");
      var isT = b.seq[i] === 1;
      if (isT) chip.className = "cf-t";
      var lab = isT ? tailsLabel() : headsLabel();
      chip.textContent = (lab.charAt(0) || (isT ? "T" : "H")).toUpperCase();
      chip.title = lab;
      seqEl.appendChild(chip);
    }
    if (b.seq.length > MAX_SEQ) {
      truncEl.hidden = false;
      truncEl.textContent = fill(t("tool.many.truncated", "Showing the first {n}."), { n: MAX_SEQ });
    } else {
      truncEl.hidden = true;
    }
  }

  function doFlip() {
    if (flipping) return; // 애니메이션 중 재탭 무시 (중복 카운트 방지)
    if (!cryptoOK) { setNote("nocrypto"); return; }

    if (state.mode === "many") {
      var parsed = parseCount(countEl ? countEl.value : "");
      state.count = parsed.n;
      if (countEl) countEl.value = String(parsed.n);
      setNote(parsed.note);
      var batch = tally(parsed.n, randomBit);
      state.heads += batch.heads;
      state.tails += batch.tails;
      lastBatch = batch;
      lastSingle = null;
      renderResultLine(null);
      renderBatch();
      var lastSide = batch.seq.length ? batch.seq[batch.seq.length - 1] : 0;
      animate(lastSide);
    } else {
      setNote(null);
      var side = randomBit();
      if (side === 1) { state.tails++; } else { state.heads++; }
      lastSingle = side;
      lastBatch = null;
      if (batchEl) batchEl.hidden = true;
      renderResultLine(side);
      animate(side);
    }
    renderStats();
    save();
  }

  function animate(side) {
    flipping = true;
    flipBtn.disabled = true;
    coinBtn.setAttribute("aria-disabled", "true");
    spinTo(side);
    setTimeout(function () {
      flipping = false;
      flipBtn.disabled = false;
      coinBtn.removeAttribute("aria-disabled");
    }, 640);
  }

  function setMode(mode, persist) {
    state.mode = (mode === "many") ? "many" : "single";
    if (manyControls) manyControls.hidden = (state.mode !== "many");
    var radio = document.querySelector('input[name="cf-mode"][value="' + state.mode + '"]');
    if (radio) radio.checked = true;
    if (persist) save();
  }

  function resetStats() {
    state.heads = 0;
    state.tails = 0;
    lastBatch = null;
    lastSingle = null;
    if (batchEl) batchEl.hidden = true;
    renderResultLine(null);
    renderStats();
    save();
  }

  // ---------- 초기화 ----------
  restore();
  setMode(state.mode, false);
  if (countEl) countEl.value = String(state.count);
  if (labelHeadsEl) labelHeadsEl.value = state.headsLabel;
  if (labelTailsEl) labelTailsEl.value = state.tailsLabel;
  renderFaces();
  renderStats();
  if (!cryptoOK) { setNote("nocrypto"); flipBtn.disabled = true; }

  // ---------- 이벤트 ----------
  flipBtn.addEventListener("click", doFlip);
  coinBtn.addEventListener("click", doFlip);
  if (resetBtn) resetBtn.addEventListener("click", resetStats);

  var modeRadios = document.querySelectorAll('input[name="cf-mode"]');
  for (var m = 0; m < modeRadios.length; m++) {
    modeRadios[m].addEventListener("change", function (e) { setMode(e.target.value, true); setNote(null); });
  }
  if (countEl) {
    countEl.addEventListener("keydown", function (e) { if (e.key === "Enter") doFlip(); });
    countEl.addEventListener("change", function () {
      var p = parseCount(countEl.value);
      state.count = p.n; countEl.value = String(p.n); setNote(p.note); save();
    });
  }
  function onLabelChange() {
    state.headsLabel = labelHeadsEl ? labelHeadsEl.value.slice(0, 24) : "";
    state.tailsLabel = labelTailsEl ? labelTailsEl.value.slice(0, 24) : "";
    renderFaces();
    renderStats();
    if (lastBatch) renderBatch();
    if (lastSingle != null) renderResultLine(lastSingle);
    save();
  }
  if (labelHeadsEl) labelHeadsEl.addEventListener("input", onLabelChange);
  if (labelTailsEl) labelTailsEl.addEventListener("input", onLabelChange);

  // 언어 전환 시 동적 문구(라벨·통계·결과·오류)를 다시 렌더
  document.addEventListener("i18n:change", function () {
    renderFaces();
    renderStats();
    if (lastBatch) renderBatch();
    if (lastSingle != null) renderResultLine(lastSingle);
  });
  // TOOLJS:END
})();
