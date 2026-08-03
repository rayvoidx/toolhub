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
  /* Random Team Generator — 이름 목록을 Fisher–Yates(crypto random)로 섞은 뒤
     "팀 수" 또는 "팀당 인원"으로 라운드로빈 분배한다. 외부 API 없음, 모든 계산은 로컬.
     상태는 localStorage "<slug>:state" 에만 저장.

     라운드로빈 분배 이유: 나머지 인원을 마지막 한 팀에 몰아주지 않고 앞쪽 팀부터
     한 명씩 나눠주므로, 가장 큰 팀과 가장 작은 팀의 차이가 항상 1명 이하로 유지된다. */

  var MAX_NAMES = 500;  // 극단값 캡 — 수천 줄 붙여넣기로 인한 렌더 프리즈 방지
  var MAX_TEAMS = 100;  // 팀 카드 수 상한 (팀 수 모드에서 사용자가 직접 입력하는 값)

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  // 줄바꿈 단위 파싱: 빈 줄 제거, trim. 중복 이름은 그대로 둔다(별개 인원으로 취급).
  // 줄이 하나뿐인데 쉼표가 있으면 쉼표 목록으로 붙여넣은 것으로 보고 쉼표로 나눈다.
  // (여러 줄일 때는 나누지 않는다 — "Doe, John" 같은 성-이름 표기를 깨지 않기 위해)
  function parseNames(raw) {
    var lines = String(raw == null ? "" : raw)
      .split("\n")
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
    if (lines.length === 1 && lines[0].indexOf(",") >= 0) {
      lines = lines[0].split(",")
        .map(function (s) { return s.trim(); })
        .filter(function (s) { return s.length > 0; });
    }
    return lines;
  }
  // 팀 이름도 동일한 줄바꿈 파싱 규칙 사용 (빈 줄은 무시)
  function parseTeamNames(raw) {
    return parseNames(raw);
  }
  // 정수 파싱: 빈값·0·음수·소수는 조용히 fallback 정수로 정규화 (min=1)
  function parseIntClamp(raw, fallback) {
    var n = parseInt(String(raw == null ? "" : raw).trim(), 10);
    if (!isFinite(n) || isNaN(n) || n < 1) return fallback;
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
  // 고전 Fisher–Yates(Durstenfeld) 셔플 — 뒤에서부터 남은 구간 안에서 하나씩 교환.
  // 원본 배열은 건드리지 않는다(복사본 반환).
  function fisherYatesShuffle(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = randomIndex(i + 1);
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }
  // 라운드로빈 분배: shuffled[i] → teams[i % teamCount]. 나머지 인원이 앞쪽 팀부터
  // 한 명씩 배정되므로 팀 간 인원 차는 항상 0 또는 1.
  function distribute(shuffled, teamCount) {
    var teams = [];
    var i;
    for (i = 0; i < teamCount; i++) teams.push([]);
    for (i = 0; i < shuffled.length; i++) teams[i % teamCount].push(shuffled[i]);
    return teams;
  }
  // 모드에 따라 실제 팀 개수를 산출. "size" 모드는 총원을 팀당 인원으로 올림 나눗셈.
  function deriveTeamCount(mode, value, total) {
    if (mode === "size") {
      var size = value < 1 ? 1 : value;
      return Math.max(1, Math.ceil(total / size));
    }
    return value < 1 ? 1 : value;
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseNames: parseNames, parseTeamNames: parseTeamNames, parseIntClamp: parseIntClamp,
      randomIndex: randomIndex, fisherYatesShuffle: fisherYatesShuffle,
      distribute: distribute, deriveTeamCount: deriveTeamCount
    };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var STATE_KEY = (CFG.slug || "random-team-gen") + ":state";
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

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var namesEl = $("names"), teamNamesEl = $("team-names");
  var modeTeamsBtn = $("mode-teams"), modeSizeBtn = $("mode-size");
  var valueEl = $("split-value"), valueLabelEl = $("split-value-label");
  var btn = $("calc-btn"), errEl = $("err"), resultEl = $("result");
  var summaryEl = $("r-summary"), gridEl = $("teams-grid"), noteEl = $("split-note");
  var copyAllBtn = $("copy-all"), copyHintEl = $("copy-hint");
  if (!namesEl || !valueEl || !btn || !resultEl || !gridEl) return;

  var mode = "teams"; // "teams" | "size"
  var lastValues = { teams: "2", size: "4" };
  var lastResult = null; // { teams:[{name,members[]}], total, teamCount, extra, big, small }

  /* ---- 상태 저장/복원 ---- */
  function saveState() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        names: namesEl.value,
        teamNames: teamNamesEl.value,
        mode: mode,
        teamsValue: lastValues.teams,
        sizeValue: lastValues.size
      }));
    } catch (e) { /* private mode — 저장만 실패, 기능은 정상 */ }
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(STATE_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (s && typeof s.names === "string") namesEl.value = s.names;
      if (s && typeof s.teamNames === "string") teamNamesEl.value = s.teamNames;
      if (s && (s.mode === "teams" || s.mode === "size")) mode = s.mode;
      if (s && s.teamsValue != null) lastValues.teams = String(s.teamsValue);
      if (s && s.sizeValue != null) lastValues.size = String(s.sizeValue);
    } catch (e) { /* 저장값 손상 — 기본값으로 진행 */ }
  }

  /* ---- 오류 표시 ---- */
  function fail(key, vars) {
    resultEl.hidden = true;
    errEl.hidden = false;
    errEl.textContent = fill(t(key, key), vars || {});
  }

  /* ---- 모드 UI ---- */
  function applyModeUI() {
    var isTeams = mode === "teams";
    modeTeamsBtn.setAttribute("aria-pressed", isTeams ? "true" : "false");
    modeSizeBtn.setAttribute("aria-pressed", isTeams ? "false" : "true");
    valueLabelEl.textContent = t(isTeams ? "tool.teams.label" : "tool.size.label", isTeams ? "Number of teams" : "People per team");
    valueEl.value = isTeams ? lastValues.teams : lastValues.size;
  }
  function switchMode(next) {
    if (next === mode) return;
    // 전환 전 현재 입력값을 그 모드용으로 저장해 두어야 되돌아왔을 때 값이 남는다
    lastValues[mode] = valueEl.value;
    mode = next;
    applyModeUI();
    saveState();
  }

  /* ---- 결과 렌더 ---- */
  function teamLabel(idx, customNames) {
    return (customNames[idx] && customNames[idx].length) ? customNames[idx] : fill(t("tool.team.default", "Team {n}"), { n: idx + 1 });
  }

  function renderTeams(result) {
    gridEl.textContent = "";
    for (var i = 0; i < result.teams.length; i++) {
      var team = result.teams[i];
      var card = document.createElement("button");
      card.type = "button";
      card.className = "team-card";
      card.setAttribute("data-idx", String(i));

      var nameEl = document.createElement("span");
      nameEl.className = "team-name";
      nameEl.textContent = team.name;
      card.appendChild(nameEl);

      var listEl = document.createElement("span");
      listEl.className = "team-members";
      for (var j = 0; j < team.members.length; j++) {
        var li = document.createElement("span");
        li.textContent = team.members[j];
        listEl.appendChild(li);
      }
      card.appendChild(listEl);

      card.addEventListener("click", function () { copyTeam(this); });
      gridEl.appendChild(card);
    }
  }

  function renderSummaryAndNote(result) {
    summaryEl.textContent = fill(t("tool.r.summary", "{n} people split into {teams} teams"), {
      n: result.total, teams: result.teamCount
    });
    var notes = [];
    if (result.extra > 0) {
      notes.push(fill(t("tool.note.uneven", "Split as evenly as possible: {big} team(s) get {bigSize} members, {small} team(s) get {smallSize} members."), {
        big: result.extra, bigSize: result.smallSize + 1,
        small: result.teamCount - result.extra, smallSize: result.smallSize
      }));
    }
    if (result.truncated) notes.push(fill(t("tool.note.truncated", "Only the first {max} names are used."), { max: MAX_NAMES }));
    if (result.capped) notes.push(fill(t("tool.note.capped", "Capped at {max} teams to keep results readable — try a larger team size."), { max: MAX_TEAMS }));
    if (notes.length) {
      noteEl.textContent = notes.join(" ");
      noteEl.hidden = false;
    } else {
      noteEl.hidden = true;
    }
  }

  function buildResultText(result) {
    var lines = [];
    for (var i = 0; i < result.teams.length; i++) {
      var team = result.teams[i];
      lines.push(team.name + ": " + team.members.join(", "));
    }
    return lines.join("\n");
  }

  /* ---- 복사 ---- */
  var copiedTimer = null;
  function legacyCopy(text, done) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch (e) { /* 복사 미지원 — 표시값은 그대로 남는다 (조용한 실패 아님) */ }
  }
  function doCopy(text, done) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text, done); });
      } else {
        legacyCopy(text, done);
      }
    } catch (e) { legacyCopy(text, done); }
  }
  function flashCard(card) {
    var nameEl = card.querySelector(".team-name");
    if (!nameEl) return;
    var original = nameEl.getAttribute("data-orig") || nameEl.textContent;
    nameEl.setAttribute("data-orig", original);
    nameEl.textContent = t("tool.copied", "Copied");
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(function () {
      nameEl.textContent = nameEl.getAttribute("data-orig") || original;
    }, 1100);
  }
  function copyTeam(card) {
    if (!lastResult) return;
    var idx = parseInt(card.getAttribute("data-idx"), 10);
    var team = lastResult.teams[idx];
    if (!team) return;
    doCopy(team.name + ": " + team.members.join(", "), function () { flashCard(card); });
  }
  function copyAll() {
    if (!lastResult) return;
    var original = copyAllBtn.textContent;
    doCopy(buildResultText(lastResult), function () {
      copyAllBtn.textContent = t("tool.copied", "Copied");
      setTimeout(function () { copyAllBtn.textContent = original; }, 1100);
    });
  }

  /* ---- 메인 생성 로직 ---- */
  function generate() {
    var rawNames = parseNames(namesEl.value);
    if (rawNames.length === 0) { fail("tool.err.empty"); return; }

    var truncated = rawNames.length > MAX_NAMES;
    var names = truncated ? rawNames.slice(0, MAX_NAMES) : rawNames;

    var isTeams = mode === "teams";
    var raw = valueEl.value;
    var value = parseIntClamp(raw, isTeams ? 2 : 1);
    lastValues[mode] = String(value);

    if (isTeams && value > MAX_TEAMS) { fail("tool.err.tooMany", { max: MAX_TEAMS }); return; }
    if (isTeams && value > names.length) {
      fail("tool.err.tooManyTeams", { n: value, m: names.length });
      return;
    }

    var rawTeamCount = deriveTeamCount(mode, value, names.length);
    var capped = rawTeamCount > MAX_TEAMS;
    var teamCount = capped ? MAX_TEAMS : rawTeamCount;

    var shuffled = fisherYatesShuffle(names);
    var groups = distribute(shuffled, teamCount);
    var customNames = parseTeamNames(teamNamesEl.value);

    var teams = [];
    for (var i = 0; i < groups.length; i++) {
      teams.push({ name: teamLabel(i, customNames), members: groups[i] });
    }

    var smallSize = Math.floor(names.length / teamCount);
    var extra = names.length % teamCount; // 앞쪽 extra 개 팀이 smallSize+1 명

    lastResult = {
      teams: teams, total: names.length, teamCount: teamCount,
      smallSize: smallSize, extra: extra, truncated: truncated, capped: capped
    };

    errEl.hidden = true;
    resultEl.hidden = false;
    renderTeams(lastResult);
    renderSummaryAndNote(lastResult);
    copyHintEl.hidden = false;

    btn.textContent = t("tool.btn.reshuffle", "Reshuffle");
    saveState();
  }

  /* ---- 이벤트 ---- */
  btn.addEventListener("click", generate);
  if (copyAllBtn) copyAllBtn.addEventListener("click", copyAll);
  if (modeTeamsBtn) modeTeamsBtn.addEventListener("click", function () { switchMode("teams"); });
  if (modeSizeBtn) modeSizeBtn.addEventListener("click", function () { switchMode("size"); });
  namesEl.addEventListener("input", function () {
    if (!errEl.hidden) errEl.hidden = true;
    saveState();
  });
  teamNamesEl.addEventListener("input", saveState);
  valueEl.addEventListener("input", function () {
    lastValues[mode] = valueEl.value;
    saveState();
  });

  // 언어 전환 시 정적 라벨·동적 문구를 재적용 (재추첨 없이 현재 결과를 새 언어로 다시 표기)
  document.addEventListener("i18n:change", function () {
    applyModeUI();
    btn.textContent = t(lastResult ? "tool.btn.reshuffle" : "tool.btn.shuffle", lastResult ? "Reshuffle" : "Shuffle teams");
    if (lastResult) {
      renderTeams(lastResult);
      renderSummaryAndNote(lastResult);
    }
  });

  loadState();
  applyModeUI();
  // TOOLJS:END
})();
