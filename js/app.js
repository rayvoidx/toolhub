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
    themeBtn.setAttribute("aria-pressed", String((root.getAttribute("data-theme") || "auto") === "dark"));
    themeBtn.addEventListener("click", function () {
      var order = ["auto", "light", "dark"];
      var cur = root.getAttribute("data-theme") || "auto";
      var next = order[(order.indexOf(cur) + 1) % order.length];
      root.setAttribute("data-theme", next);
      themeBtn.setAttribute("aria-pressed", String(next === "dark")); // 2026-10-13 a11y: 상태 노출
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

/* Home directory: progressive enhancement over crawlable static tool links. */
(function () {
  "use strict";
  var search = document.getElementById("tool-search");
  var list = document.getElementById("tool-list");
  if (!search || !list || !window.Toolhub) return;
  var app = window.Toolhub;
  var cards = Array.from(list.querySelectorAll(".tool-item"));
  var groups = Array.from(list.querySelectorAll(".tool-group"));
  var empty = document.getElementById("tool-empty");
  var count = document.getElementById("tool-count");
  var clear = document.getElementById("clear-search");
  var nav = document.getElementById("cat-nav");
  var state = { group: "all", view: "all" }, expanded = {}, timer, firstResult;
  var stop = /^(how|much|many|what|is|are|to|a|an|the|my|of|for|in|on|calculate|calculator|calc|online|free)$/;
  function normalize(s) { return String(s || "").normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim(); }
  function translate(key) { return window.I18N && window.I18N.t(key) || key; }
  function title(card) { return card.querySelector(".tool-name").textContent.trim(); }
  function readURL() {
    var params = new URLSearchParams(location.search);
    search.value = (params.get("q") || "").slice(0, 240);
    var group = params.get("category");
    state.group = groups.some(function (g) { return g.dataset.group === group; }) ? group : "all";
    state.view = ["saved", "recent"].includes(params.get("view")) ? params.get("view") : "all";
  }
  function syncURL(push) {
    clearTimeout(timer);
    var url = new URL(location.href);
    [["q", search.value.trim()], ["category", state.group === "all" ? "" : state.group], ["view", state.view === "all" ? "" : state.view]].forEach(function (pair) {
      if (pair[1]) url.searchParams.set(pair[0], pair[1]); else url.searchParams.delete(pair[0]);
    });
    url.searchParams.delete("focus");
    if (url.href !== location.href) history[push ? "pushState" : "replaceState"](history.state, "", url);
  }
  function choose(key, value) { syncURL(false); state[key] = value; expanded = {}; syncURL(true); filter(); }
  cards.forEach(function (card, index) {
    card._slug = new URL(card.href).pathname.split("/").filter(Boolean)[0]; card._index = index;
    var wrapper = document.createElement("div"); wrapper.className = "tool-tile";
    card.parentNode.insertBefore(wrapper, card); wrapper.appendChild(card);
    var save = document.createElement("button"); save.type = "button"; save.className = "save-tool";
    save.addEventListener("click", function () {
      var visible = cards.filter(function (c) { return !c.hidden; });
      var at = visible.indexOf(card), wasFocused = document.activeElement === save;
      app.toggle(card._slug, title(card));
      if (card.hidden && wasFocused) {
        var next = visible.slice(at + 1).concat(visible.slice(0, at).reverse()).find(function (c) { return !c.hidden; });
        (next ? next._save : document.querySelector('[data-view="saved"]')).focus({ preventScroll: true });
      }
    });
    wrapper.appendChild(save); card._save = save; card._wrapper = wrapper;
  });
  groups.forEach(function (group) {
    group._cards = Array.from(group.querySelectorAll(".tool-item")); group._grid = group.querySelector(".tool-grid");
    var button = document.createElement("button"); button.type = "button"; button.className = "group-expand";
    button.addEventListener("click", function (e) {
      var next = group.querySelectorAll(".tool-item")[6];
      expanded[group.dataset.group] = true; filter();
      if (e.detail === 0 && next) next.focus();
    });
    group.appendChild(button); group._expand = button;
  });
  var picker = document.createElement("div"); picker.className = "category-picker";
  var pickerLabel = document.createElement("label"); pickerLabel.htmlFor = "category-select";
  var select = document.createElement("select"); select.id = "category-select";
  picker.append(pickerLabel, select); nav.before(picker);
  select.addEventListener("change", function () { choose("group", select.value); });
  var meta = document.createElement("div"); meta.className = "directory-meta"; count.before(meta);
  var reset = document.createElement("button"); reset.type = "button"; reset.className = "directory-reset"; reset.id = "clear-filters";
  meta.append(reset, count);
  function categories() {
    nav.textContent = ""; select.textContent = ""; pickerLabel.textContent = app.t("categories");
    [{ key: "all", label: app.t("all"), n: cards.length }].concat(groups.map(function (group) {
      return { key: group.dataset.group, label: translate("cat." + group.dataset.group), n: group.querySelectorAll(".tool-item").length };
    })).forEach(function (cat) {
      var btn = document.createElement("button"); btn.type = "button"; btn.dataset.group = cat.key;
      var dot = document.createElement("span"); dot.className = "dot"; dot.setAttribute("aria-hidden", "true");
      var label = document.createElement("span"); label.textContent = cat.label;
      var num = document.createElement("span"); num.className = "cat-count"; num.textContent = cat.n;
      btn.append(dot, label, num); btn.addEventListener("click", function () { choose("group", cat.key); }); nav.appendChild(btn);
      var option = document.createElement("option"); option.value = cat.key; option.textContent = cat.label + " · " + cat.n; select.appendChild(option);
    });
    nav.hidden = false;
  }
  function indexCards() {
    var en = (window.I18N_LOCALES || {}).en || {};
    cards.forEach(function (card) {
      card._name = normalize(title(card) + " " + (en["tool." + card._slug + ".name"] || ""));
      card._haystack = normalize((card.dataset.name || "") + " " + card.textContent + " " + (en["tool." + card._slug + ".desc"] || ""));
    });
  }
  function recent() {
    var box = document.getElementById("recent-tools"); box.textContent = "";
    var rows = app.recent().map(function (row) { return cards.find(function (c) { return c._slug === row.s; }); }).filter(Boolean).slice(0, 4);
    box.hidden = !rows.length;
    if (!rows.length) return;
    var heading = document.createElement("p"); heading.className = "recent-title"; heading.textContent = app.t("recentTitle");
    var row = document.createElement("div"); row.className = "recent-row";
    rows.forEach(function (card) { var a = document.createElement("a"); a.href = card.href; a.textContent = title(card); row.appendChild(a); }); box.append(heading, row);
  }
  function filter() {
    var focused = document.activeElement;
    var q = normalize(search.value), raw = q.match(/[\p{L}\p{N}]+/gu) || [];
    var tokens = raw.filter(function (word) { return !stop.test(word); });
    if (q && !tokens.length) tokens = raw.length ? raw : [q];
    document.documentElement.classList.toggle("is-searching", !!q); // 검색 중 프로모 카드([data-promo]) 접기 — origin 83fea651 포팅 (2026-11-18)
    var recents = app.recent().map(function (r) { return r.s; });
    var saved = app.saved().map(function (r) { return r.s; });
    var matched = 0, best = -Infinity; firstResult = null;
    groups.forEach(function (group, groupIndex) {
      var hits = [], groupBest = -Infinity;
      group._cards.forEach(function (card) {
        var match = (state.group === "all" || group.dataset.group === state.group) && tokens.every(function (word) { return card._haystack.includes(word); }) &&
          (state.view === "all" || (state.view === "saved" ? app.has(card._slug) : recents.includes(card._slug)));
        card.hidden = !match; card._wrapper.hidden = !match;
        var score = q ? tokens.reduce(function (s, word) { return s + (card._name.includes(word) ? 20 : 1); }, 0) + (card._name.startsWith(q) ? 50 : 0) : 0;
        if (!q && state.view !== "all") score = 100 - (state.view === "saved" ? saved : recents).indexOf(card._slug);
        card._score = score;
        if (match) { hits.push(card); groupBest = Math.max(groupBest, score); if (score > best) { best = score; firstResult = card; } }
        var active = app.has(card._slug), label = app.t(active ? "unsave" : "save") + ": " + title(card);
        card._save.textContent = active ? "★" : "☆"; card._save.setAttribute("aria-pressed", String(active)); card._save.setAttribute("aria-label", label); card._save.title = label;
      });
      group._score = groupBest; group._index = groupIndex;
      matched += hits.length;
      var preview = !q && state.group === "all" && state.view === "all" && !expanded[group.dataset.group];
      if (preview) hits.slice(6).forEach(function (card) { card.hidden = true; card._wrapper.hidden = true; });
      group.hidden = !hits.length; group._expand.hidden = !preview || hits.length <= 6;
      group._expand.textContent = app.t("showAll") + " · " + hits.length;
      var heading = group.querySelector(".tool-group-title"), badge = heading.querySelector(".cat-count");
      if (!badge) { badge = document.createElement("span"); badge.className = "cat-count"; heading.appendChild(badge); } badge.textContent = hits.length;
      var ordered = group._cards.slice().sort(function (a, b) { return (q || state.view !== "all" ? b._score - a._score : 0) || a._index - b._index; });
      ordered.forEach(function (card, i) { if (group._grid.children[i] !== card._wrapper) group._grid.insertBefore(card._wrapper, group._grid.children[i] || null); });
    });
    // DOM order follows ranking too, so Tab and screen-reader order match the screen.
    groups.slice().sort(function (a, b) { return (q || state.view !== "all" ? b._score - a._score : 0) || a._index - b._index; }).forEach(function (group, i) {
      if (list.children[i] !== group) list.insertBefore(group, list.children[i] || null);
    });
    if (focused && document.activeElement !== focused && focused.isConnected && !focused.closest("[hidden]")) focused.focus({ preventScroll: true });
    empty.hidden = matched > 0;
    var emptyKind = !q && state.group === "all" ? state.view : "all";
    empty.querySelector("h3").textContent = app.t(emptyKind === "saved" ? "emptySaved" : emptyKind === "recent" ? "emptyRecent" : "empty");
    empty.querySelector("p").textContent = app.t(emptyKind === "saved" ? "emptySavedHelp" : emptyKind === "recent" ? "emptyRecentHelp" : "emptyHelp");
    count.textContent = matched + " " + app.t("tools");
    clear.hidden = !search.value; reset.hidden = !q && state.group === "all" && state.view === "all"; reset.textContent = app.t("reset");
    select.value = state.group;
    var shortcut = document.querySelector(".search-shortcut"); if (shortcut) shortcut.hidden = !!search.value;
    document.querySelectorAll("[data-view]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.view === state.view)); });
    nav.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.group === state.group)); });
  }
  search.addEventListener("input", function () { filter(); clearTimeout(timer); timer = setTimeout(function () { syncURL(false); }, 180); });
  search.addEventListener("keydown", function (e) {
    if (e.isComposing) return;
    if (e.key === "Escape") { e.preventDefault(); search.value = ""; syncURL(false); filter(); }
    if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); syncURL(false); if (firstResult) firstResult.focus(); }
  });
  list.addEventListener("click", function (e) { if (e.target.closest("a")) syncURL(false); });
  clear.addEventListener("click", function () { syncURL(false); search.value = ""; syncURL(true); filter(); search.focus(); });
  document.querySelectorAll("[data-view]").forEach(function (button) { button.addEventListener("click", function () { choose("view", button.dataset.view); }); });
  function resetFilters() { syncURL(false); state = { group: "all", view: "all" }; search.value = ""; syncURL(true); filter(); search.focus(); }
  document.getElementById("reset-filters").addEventListener("click", resetFilters); reset.addEventListener("click", resetFilters);
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && !e.defaultPrevented && !document.querySelector("dialog[open]") && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.closest("input,textarea,select,[contenteditable]")) { e.preventDefault(); search.focus(); }
  });
  document.addEventListener("i18n:change", function () { indexCards(); categories(); recent(); filter(); });
  document.addEventListener("toolhub:saved", filter);
  window.addEventListener("popstate", function () { clearTimeout(timer); readURL(); filter(); });
  window.addEventListener("pageshow", function () { recent(); filter(); });
  readURL(); indexCards(); categories(); recent(); filter();
  if (new URLSearchParams(location.search).get("focus") === "search") search.focus({ preventScroll: false });
})();
