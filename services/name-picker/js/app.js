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
  /* Random Name Picker — 이름 목록에서 1명 또는 N명의 당첨자를 편향 없이 뽑는다.
     외부 API 없음, 모든 계산은 로컬. 상태는 localStorage "<slug>:state" 에만 저장.

     wheel-spinner(단일 당첨자)와의 차이:
       1) 한 번에 N명 동시 추첨 (winner-count)
       2) "remove-winner" 와 별개로 "no-repeat" 옵션 — 목록은 그대로 두되
          이전 라운드에서 이미 당첨된 이름을 이번 회차 추첨 대상에서 제외한다. */

  var MAX_WINNERS = 200;   // 극단값 캡 — 수천 명 카드 렌더링으로 인한 프리즈 방지
  var MAX_HISTORY = 500;   // 무제한 클릭 시 메모리 방어용 상한 (화면엔 최근 10라운드만 노출)
  var ANIM_TICK_MS = 55;
  var ANIM_BASE_TICKS = 6;   // 첫 슬롯이 고정되기까지의 최소 틱 수
  var ANIM_STAGGER_BUDGET = 18; // 슬롯 전체에 분배되는 "차례로 고정" 연출 틱 예산(인원수와 무관하게 상한)

  /* ---- 순수 계산 ---- */
  // 줄바꿈 단위 파싱: 빈 줄 제거, trim. 중복 이름은 그대로 둔다 = 표를 두 번 넣은 것과 같은 가중치.
  function parseNames(raw) {
    return String(raw == null ? "" : raw)
      .split("\n")
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }
  // 당첨자 수: 1 이상의 정수만 유효. 빈칸·0·음수·소수·문자는 null 을 돌려주고 호출부가 안내 문구를 띄운다.
  function parseWinnerCount(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!/^\d+$/.test(s)) return null;
    var n = parseInt(s, 10);
    if (!isFinite(n) || n < 1) return null;
    return n;
  }
  // 편향 없는 정수 난수 — crypto.getRandomValues + 기각 표집(rejection sampling).
  // 나머지 연산만 쓰면 2^32 가 n 으로 나누어떨어지지 않을 때 앞쪽 항목이 미세하게 더 자주 뽑힌다.
  function randomIndex(n) {
    if (n <= 0) return 0;
    var g = (typeof window !== "undefined" && window.crypto && window.crypto.getRandomValues) ? window.crypto : null;
    if (!g) return Math.floor(Math.random() * n);
    var limit = Math.floor(4294967296 / n) * n;
    var buf = new Uint32Array(1);
    do { g.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % n;
  }
  // 비복원추출로 count 명을 뽑는다 — 매 슬롯마다 남은 풀에서 균등하게 뽑고 그 위치를 제거.
  // 같은 이름이 여러 줄(=여러 장의 표)로 들어있으면 한 라운드 안에서도 여러 슬롯을 채울 수 있다(의도된 동작).
  function pickWinners(pool, count) {
    var arr = pool.slice();
    var out = [];
    var n = Math.min(count, arr.length);
    for (var i = 0; i < n; i++) {
      var idx = randomIndex(arr.length);
      out.push(arr[idx]);
      arr.splice(idx, 1);
    }
    return out;
  }
  // "이번 회차 추첨 대상" 산출: no-repeat 이 켜져 있으면 과거 라운드에서 이미 당첨된 이름을 제외.
  // 목록 자체(items)는 건드리지 않는다 — remove-winner 와 달리 원본 목록은 참고용으로 남는다.
  function eligiblePool(items, history) {
    if (!history || !history.length) return items.slice();
    var won = {};
    for (var r = 0; r < history.length; r++) {
      for (var i = 0; i < history[r].length; i++) won[history[r][i]] = true;
    }
    return items.filter(function (name) { return !won[name]; });
  }
  // remove-winner 옵션용: 당첨된 이름을 원본 목록에서 항목 단위로 한 번씩만 제거.
  function removeWinnersFromItems(items, winners) {
    var copy = items.slice();
    for (var i = 0; i < winners.length; i++) {
      var idx = copy.indexOf(winners[i]);
      if (idx > -1) copy.splice(idx, 1);
    }
    return copy;
  }

  /* ---- DOM ---- */
  var $ = function (id) { return document.getElementById(id); };
  var namesEl = $("names"), countEl = $("winner-count");
  var removeEl = $("remove-winner"), noRepeatEl = $("no-repeat");
  var btn = $("calc-btn"), errEl = $("err"), resultEl = $("result");
  var gridEl = $("winners-grid"), countOutEl = $("r-count");
  var clearBtn = $("clear-history"), historyWrap = $("history-wrap"), historyEl = $("history");
  if (!namesEl || !countEl || !btn || !resultEl || !gridEl) return;

  var CFG = window.APP_CONFIG || {};
  var STATE_KEY = (CFG.slug || "name-picker") + ":state";
  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function fill(template, vars) {
    var out = template;
    for (var k in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, k)) out = out.split("{" + k + "}").join(String(vars[k]));
    }
    return out;
  }

  var history = [];   // 최근이 [0] — 각 원소는 그 라운드의 당첨자 이름 배열
  var rolling = null; // setInterval 핸들 (진행 중이면 재클릭 방지)

  /* ---- 상태 저장/복원 ---- */
  function saveState() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        names: namesEl.value,
        count: countEl.value,
        remove: !!removeEl.checked,
        noRepeat: !!noRepeatEl.checked
      }));
    } catch (e) { /* private mode — 저장만 실패, 기능은 정상 */ }
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(STATE_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (s && typeof s.names === "string") namesEl.value = s.names;
      if (s && s.count != null) countEl.value = s.count;
      if (removeEl) removeEl.checked = !!(s && s.remove);
      if (noRepeatEl) noRepeatEl.checked = !!(s && s.noRepeat);
    } catch (e) { /* 저장값 손상 — 기본값으로 진행 */ }
  }

  /* ---- 오류 표시 ---- */
  function fail(key, vars) {
    resultEl.hidden = true;
    errEl.hidden = false;
    errEl.textContent = fill(t(key, key), vars || {});
  }

  /* ---- 결과 카드 ---- */
  function buildSlots(count) {
    gridEl.textContent = "";
    for (var i = 0; i < count; i++) {
      var slot = document.createElement("div");
      slot.className = "win-slot rolling";
      var no = document.createElement("span");
      no.className = "slot-no";
      no.textContent = "#" + (i + 1);
      var nm = document.createElement("span");
      nm.className = "slot-name";
      nm.textContent = "…";
      slot.appendChild(no);
      slot.appendChild(nm);
      gridEl.appendChild(slot);
    }
  }

  function renderHistory() {
    if (!historyWrap || !historyEl) return;
    if (!history.length) { historyWrap.hidden = true; historyEl.textContent = ""; return; }
    historyWrap.hidden = false;
    historyEl.textContent = "";
    var total = history.length;
    var shown = history.slice(0, 10);
    for (var i = 0; i < shown.length; i++) {
      var roundNum = total - i;
      var li = document.createElement("li");
      li.textContent = fill(t("tool.round.label", "Round {n}:"), { n: roundNum }) + " " + shown[i].join(", ");
      historyEl.appendChild(li);
    }
  }

  /* ---- 추첨 애니메이션 (결과는 시작 전에 이미 확정 — 연출 타이밍이 결과를 바꾸지 못한다) ---- */
  function animate(pool, winners, done) {
    var slots = gridEl.querySelectorAll(".slot-name");
    var count = winners.length;
    var step = count > 1 ? Math.max(1, Math.floor(ANIM_STAGGER_BUDGET / (count - 1))) : 0;
    var locked = [];
    var lockAt = [];
    for (var i = 0; i < count; i++) { locked.push(false); lockAt.push(ANIM_BASE_TICKS + i * step); }
    var maxTick = lockAt[count - 1];
    var tick = 0;
    rolling = setInterval(function () {
      tick++;
      for (var j = 0; j < count; j++) {
        if (locked[j]) continue;
        if (tick >= lockAt[j]) {
          slots[j].textContent = winners[j];
          slots[j].parentNode.classList.remove("rolling");
          locked[j] = true;
        } else {
          slots[j].textContent = pool[randomIndex(pool.length)];
        }
      }
      if (tick >= maxTick) {
        clearInterval(rolling);
        rolling = null;
        done();
      }
    }, ANIM_TICK_MS);
  }

  function finish(items, winners) {
    history.unshift(winners.slice());
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;

    if (removeEl.checked) {
      items = removeWinnersFromItems(items, winners);
      namesEl.value = items.join("\n");
    }
    countOutEl.textContent = String(parseNames(namesEl.value).length);
    renderHistory();
    saveState();
    btn.textContent = t("tool.btn.again", "Pick again");
    btn.disabled = false;
  }

  function draw() {
    if (rolling) return;
    var items = parseNames(namesEl.value);
    if (items.length === 0) { fail("tool.err.empty"); return; }

    var requested = parseWinnerCount(countEl.value);
    if (requested === null) { fail("tool.err.count", { max: MAX_WINNERS }); return; }
    if (requested > MAX_WINNERS) { fail("tool.err.tooMany", { max: MAX_WINNERS }); return; }

    var noRepeat = !!(noRepeatEl && noRepeatEl.checked);
    var pool = noRepeat ? eligiblePool(items, history) : items.slice();

    if (pool.length === 0) {
      fail(noRepeat && items.length > 0 ? "tool.err.exhausted" : "tool.err.empty");
      return;
    }
    if (requested > pool.length) {
      fail("tool.err.notEnough", { n: requested, m: pool.length });
      return;
    }

    errEl.hidden = true;
    resultEl.hidden = false;
    btn.disabled = true;

    var winners = pickWinners(pool, requested); // 연출 시작 전에 결과 확정
    buildSlots(winners.length);
    animate(pool, winners, function () { finish(items, winners); });
  }

  /* ---- 이벤트 ---- */
  btn.addEventListener("click", draw);
  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      history = [];
      renderHistory();
      saveState();
    });
  }
  namesEl.addEventListener("input", function () {
    if (!errEl.hidden) errEl.hidden = true;
    if (!resultEl.hidden) countOutEl.textContent = String(parseNames(namesEl.value).length);
    saveState();
  });
  countEl.addEventListener("input", saveState);
  if (removeEl) removeEl.addEventListener("change", saveState);
  if (noRepeatEl) noRepeatEl.addEventListener("change", saveState);

  document.addEventListener("i18n:change", function () {
    btn.textContent = t(history.length ? "tool.btn.again" : "tool.btn.pick", history.length ? "Pick again" : "Pick winner(s)");
    renderHistory();
  });

  loadState();
  // TOOLJS:END
})();
