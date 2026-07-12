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
  var SLUG = cfg.slug || "dice-roller";
  var PRESETS = [4, 6, 8, 10, 12, 20, 100];
  var MAX_QTY = 100, MIN_SIDES = 2, MAX_SIDES = 1000, MAX_HISTORY = 20;
  var TWO32 = 4294967296; // 2^32
  var DIE_FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"]; // ⚀..⚅

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  // 정수 파싱 + [min,max] clamp. 빈 값·비숫자 → min. (수량·면수 공용)
  function clampInt(raw, min, max) {
    var n = parseInt(String(raw == null ? "" : raw).trim(), 10);
    if (isNaN(n)) return min;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }
  // 수정치: 정수 아니면 0 (부호 유지, clamp 없음)
  function parseMod(raw) {
    var n = parseInt(String(raw == null ? "" : raw).trim(), 10);
    return isNaN(n) ? 0 : n;
  }
  // 주사위 표기 파서: /^\s*(\d*)d(\d+)\s*([+-]\s*\d+)?\s*$/i — 미매치는 null (조용한 실패 금지: 호출부가 오류 표시)
  function parseNotation(str) {
    if (typeof str !== "string") return null;
    var m = /^\s*(\d*)d(\d+)\s*([+-]\s*\d+)?\s*$/i.exec(str);
    if (!m) return null;
    var count = m[1] === "" ? 1 : parseInt(m[1], 10);
    var sides = parseInt(m[2], 10);
    var mod = m[3] ? parseInt(m[3].replace(/\s+/g, ""), 10) : 0;
    return { count: count, sides: sides, mod: mod };
  }
  // 편향 없는 1..sides — rejection sampling (top 나머지 구간 폐기, modulo bias 없음)
  function rollDie(sides, getU32) {
    sides = sides | 0;
    if (sides < 1) sides = 1;
    var limit = TWO32 - (TWO32 % sides);
    var x;
    do { x = getU32() >>> 0; } while (x >= limit);
    return (x % sides) + 1;
  }
  function rollDice(count, sides, getU32) {
    var out = [];
    for (var i = 0; i < count; i++) out.push(rollDie(sides, getU32));
    return out;
  }
  function sumDice(arr) {
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s;
  }
  // 표준 표기 문자열 (히스토리·결과 라벨). 음수 수정치는 하이픈.
  function notationStr(count, sides, mod) {
    var s = count + "d" + sides;
    if (mod > 0) s += "+" + mod;
    else if (mod < 0) s += "-" + Math.abs(mod);
    return s;
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      clampInt: clampInt, parseMod: parseMod, parseNotation: parseNotation,
      rollDie: rollDie, rollDice: rollDice, sumDice: sumDice, notationStr: notationStr
    };
  }

  /* ---- RNG 소스 ---- */
  var CRYPTO_OK = (function () {
    try { return !!(window.crypto && window.crypto.getRandomValues); } catch (e) { return false; }
  })();
  var getU32 = CRYPTO_OK
    ? function () { return window.crypto.getRandomValues(new Uint32Array(1))[0]; }
    : function () { return Math.floor(Math.random() * TWO32); };

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var dieWrap = $("die-buttons");
  var sidesInput = $("in-sides"), qtyInput = $("in-qty"), modInput = $("in-mod");
  var notationInput = $("in-notation"), notationErr = $("notation-err");
  var rollBtn = $("roll-btn");
  var rollResult = $("roll-result"), rollLabel = $("roll-label"), rollDiceEl = $("roll-dice");
  var rollTotal = $("roll-total"), rollBreakdown = $("roll-breakdown"), rollMsg = $("roll-msg");
  var historyEmpty = $("history-empty"), historyList = $("history-list"), clearBtn = $("clear-history");
  if (!dieWrap || !rollBtn || !rollResult) return; // 마크업 없으면 조용히 중단 (스탬핑 직후)
  var presetBtns = [].slice.call(dieWrap.querySelectorAll("[data-sides]"));

  /* ---- 상태 ---- */
  var selectedPreset = 6;          // 눌린 프리셋 버튼의 면수
  var history = [];                // 세션 한정 (spec: history session-only) — 복원 흉내 아님
  var errorActive = false;
  var lastNotes = [];              // i18n 전환 시 재번역할 안내 문구
  var persistentNotes = [];
  if (!CRYPTO_OK) persistentNotes.push({ key: "tool.msg.noCrypto", fallback: "Your browser has no secure random generator, so this uses a standard fallback — still random, just not cryptographic." });

  var CHIP_D6 = "display:inline-flex;align-items:center;justify-content:center;min-width:50px;height:50px;font-size:34px;line-height:1;border:1px solid color-mix(in srgb, var(--accent) 30%, var(--line));border-radius:12px;background:var(--surface);color:var(--ink);";
  var CHIP_NUM = "display:inline-flex;align-items:center;justify-content:center;min-width:46px;height:46px;padding:0 10px;font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;border:1px solid color-mix(in srgb, var(--accent) 25%, var(--line));border-radius:12px;background:var(--surface);color:var(--ink);";

  /* ---- i18n 헬퍼 ---- */
  function tr(key, fallback) {
    try {
      if (window.I18N) {
        var v = window.I18N.t(key);
        if (v != null) return v;
      }
    } catch (e) { /* i18n 부재 시 폴백 */ }
    return fallback;
  }
  function prefersReduce() {
    try { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { return false; }
  }

  /* ---- 안내 문구 (.result) — 조용한 실패 금지 ---- */
  function renderMsg(extra) {
    lastNotes = persistentNotes.concat(extra || []);
    if (!lastNotes.length) { rollMsg.hidden = true; rollMsg.textContent = ""; return; }
    var parts = [];
    for (var i = 0; i < lastNotes.length; i++) parts.push(tr(lastNotes[i].key, lastNotes[i].fallback));
    rollMsg.textContent = parts.join(" · ");
    rollMsg.hidden = false;
  }
  function showError() {
    errorActive = true;
    notationErr.hidden = false;
    notationErr.textContent = tr("tool.err.notation", "That doesn't look like dice notation. Try 2d6+3, d20 or 4d8-2.");
  }
  function clearError() {
    errorActive = false;
    notationErr.hidden = true;
    notationErr.textContent = "";
  }

  /* ---- 주사위 종류 선택 ---- */
  function setPressed(btn, on) {
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.style.background = on ? "var(--accent)" : "transparent";
    btn.style.color = on ? "#fff" : "var(--ink)";
    btn.style.borderColor = on ? "var(--accent)" : "var(--line)";
  }
  function highlightPreset(sides) {
    for (var i = 0; i < presetBtns.length; i++) {
      setPressed(presetBtns[i], parseInt(presetBtns[i].getAttribute("data-sides"), 10) === sides);
    }
  }
  function deselectPresets() {
    for (var i = 0; i < presetBtns.length; i++) setPressed(presetBtns[i], false);
  }
  function isCustomActive() { return sidesInput.value.trim() !== ""; }
  // 굴릴 때의 실제 면수: 커스텀 입력이 있으면 우선(2..1000 clamp), 없으면 선택된 프리셋
  function currentSides() {
    if (isCustomActive()) return clampInt(sidesInput.value, MIN_SIDES, MAX_SIDES);
    return selectedPreset;
  }
  // 표기가 지정한 면수를 컨트롤에 반영
  function reflectSides(sides) {
    if (PRESETS.indexOf(sides) !== -1) {
      selectedPreset = sides; sidesInput.value = ""; highlightPreset(sides);
    } else {
      sidesInput.value = sides; deselectPresets();
    }
  }

  /* ---- 저장/복원 (localStorage "<slug>:*" — 마지막 주사위/수량/수정치) ---- */
  function saveState(sides, qty, mod, custom) {
    try {
      localStorage.setItem(SLUG + ":sides", String(sides));
      localStorage.setItem(SLUG + ":qty", String(qty));
      localStorage.setItem(SLUG + ":mod", String(mod));
      localStorage.setItem(SLUG + ":custom", custom ? "1" : "0");
    } catch (e) { /* private mode — 이번 세션만 유지 */ }
  }
  function loadState() {
    var sides = null, qty = null, mod = null, custom = null;
    try {
      sides = localStorage.getItem(SLUG + ":sides");
      qty = localStorage.getItem(SLUG + ":qty");
      mod = localStorage.getItem(SLUG + ":mod");
      custom = localStorage.getItem(SLUG + ":custom");
    } catch (e) { /* noop */ }
    qtyInput.value = qty != null ? clampInt(qty, 1, MAX_QTY) : 1;
    modInput.value = mod != null ? parseMod(mod) : 0;
    var s = sides != null ? parseInt(sides, 10) : 6;
    if (isNaN(s)) s = 6;
    if (custom === "1") {
      sidesInput.value = clampInt(s, MIN_SIDES, MAX_SIDES);
      selectedPreset = 6;
      deselectPresets();
    } else {
      selectedPreset = PRESETS.indexOf(s) !== -1 ? s : 6;
      sidesInput.value = "";
      highlightPreset(selectedPreset);
    }
  }

  /* ---- 렌더 ---- */
  function renderResult(count, sides, mod, dice, sum, total) {
    rollResult.hidden = false;
    rollLabel.textContent = notationStr(count, sides, mod);
    rollDiceEl.innerHTML = "";
    var reduce = prefersReduce();
    for (var i = 0; i < dice.length; i++) {
      var v = dice[i];
      var chip = document.createElement("span");
      if (sides === 6) {
        chip.textContent = DIE_FACES[v - 1];
        chip.style.cssText = CHIP_D6;
        chip.setAttribute("aria-label", String(v)); // 픽토그램 대체 텍스트
      } else {
        chip.textContent = String(v);
        chip.style.cssText = CHIP_NUM;
      }
      rollDiceEl.appendChild(chip);
      if (!reduce && chip.animate) {
        chip.animate(
          [{ transform: "translateY(-9px) rotate(-7deg)", opacity: 0.25 }, { transform: "none", opacity: 1 }],
          { duration: 300, delay: Math.min(i * 22, 320), easing: "cubic-bezier(.2,.8,.3,1)", fill: "backwards" }
        );
      }
    }
    rollTotal.textContent = String(total);
    if (mod !== 0) {
      rollBreakdown.textContent = "(" + sum + " " + (mod > 0 ? "+" : "−") + " " + Math.abs(mod) + ")";
    } else {
      rollBreakdown.textContent = "";
    }
  }

  function renderHistory() {
    if (!history.length) {
      historyEmpty.hidden = false;
      historyList.innerHTML = "";
      return;
    }
    historyEmpty.hidden = true;
    historyList.innerHTML = "";
    for (var i = 0; i < history.length; i++) {
      var h = history[i];
      var li = document.createElement("li");
      li.style.cssText = "display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums;";
      var left = document.createElement("span");
      var strong = document.createElement("strong");
      strong.textContent = h.notation;
      var vals = document.createElement("span");
      vals.textContent = " " + h.dice.join(", ");
      vals.style.cssText = "color:var(--muted);font-size:13px;";
      left.appendChild(strong); left.appendChild(vals);
      var right = document.createElement("span");
      right.textContent = "= " + h.total;
      right.style.cssText = "font-weight:700;white-space:nowrap;";
      li.appendChild(left); li.appendChild(right);
      historyList.appendChild(li);
    }
  }

  function addHistory(count, sides, mod, dice, total) {
    history.unshift({ notation: notationStr(count, sides, mod), dice: dice.slice(), total: total });
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    renderHistory();
  }

  /* ---- 굴리기 ---- */
  function doRoll() {
    clearError();
    var count, sides, mod, notes = [];
    var notation = notationInput.value.trim();

    if (notation !== "") {
      var parsed = parseNotation(notation);
      if (!parsed) { showError(); return; }       // 잘못된 표기 → 차단(조용한 실패 금지)
      count = parsed.count; sides = parsed.sides; mod = parsed.mod;
      if (count < 1) count = 1;
      if (count > MAX_QTY) { count = MAX_QTY; notes.push({ key: "tool.msg.max", fallback: "Capped at 100 dice." }); }
      if (sides < MIN_SIDES) { sides = MIN_SIDES; notes.push({ key: "tool.msg.sidesLow", fallback: "A die needs at least 2 sides — using 2." }); }
      if (sides > MAX_SIDES) { sides = MAX_SIDES; notes.push({ key: "tool.msg.sidesHigh", fallback: "Sides capped at 1000." }); }
      qtyInput.value = count; modInput.value = mod; reflectSides(sides);
    } else {
      var rawQty = qtyInput.value;
      count = clampInt(rawQty, 1, MAX_QTY);
      var rawN = parseInt(String(rawQty).trim(), 10);
      if (!isNaN(rawN) && rawN > MAX_QTY) notes.push({ key: "tool.msg.max", fallback: "Capped at 100 dice." });
      sides = currentSides();
      mod = parseMod(modInput.value);
      qtyInput.value = count;                      // clamp 값을 화면에 반영
      modInput.value = mod;
      if (isCustomActive()) sidesInput.value = sides; // 2..1000 clamp 반영
    }

    var dice = rollDice(count, sides, getU32);
    var sum = sumDice(dice);
    var total = sum + mod;
    renderResult(count, sides, mod, dice, sum, total);
    addHistory(count, sides, mod, dice, total);
    saveState(isCustomActive() ? sides : selectedPreset, count, mod, isCustomActive());
    renderMsg(notes);
  }

  /* ---- 이벤트 ---- */
  for (var b = 0; b < presetBtns.length; b++) {
    presetBtns[b].addEventListener("click", function () {
      selectedPreset = parseInt(this.getAttribute("data-sides"), 10);
      sidesInput.value = "";
      highlightPreset(selectedPreset);
    });
  }
  sidesInput.addEventListener("input", function () {
    if (isCustomActive()) deselectPresets();
    else highlightPreset(selectedPreset);
  });
  rollBtn.addEventListener("click", doRoll);
  notationInput.addEventListener("input", function () { if (errorActive) clearError(); });
  var enterInputs = [sidesInput, qtyInput, modInput, notationInput];
  for (var e = 0; e < enterInputs.length; e++) {
    enterInputs[e].addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.keyCode === 13) { ev.preventDefault(); doRoll(); }
    });
  }
  if (clearBtn) clearBtn.addEventListener("click", function () { history = []; renderHistory(); });

  // 언어 전환 시 동적 문구 재번역 (정적 라벨은 i18n 엔진이 처리)
  document.addEventListener("i18n:change", function () {
    if (errorActive) notationErr.textContent = tr("tool.err.notation", notationErr.textContent);
    renderMsg(lastNotes.slice(persistentNotes.length));
  });

  /* ---- 초기화 ---- */
  loadState();
  renderHistory();
  renderMsg([]); // CRYPTO 없으면 안내 즉시 노출
  // TOOLJS:END
})();
