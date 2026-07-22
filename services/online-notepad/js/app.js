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
  /* Online Notepad — 브라우저에만 저장되는 다중(최대 5개) 노트 메모장.
     상태: localStorage "<slug>:notes"(JSON 배열) / ":active"(인덱스) /
     ":mono" / ":fontsize". 외부 API 없음, 서버 전송 없음. */

  var CFG = window.APP_CONFIG || {};
  var SLUG = CFG.slug || "online-notepad";
  var K_NOTES = SLUG + ":notes";
  var K_ACTIVE = SLUG + ":active";
  var K_MONO = SLUG + ":mono";
  var K_FONTSIZE = SLUG + ":fontsize";

  var MAX_NOTES = 5;
  var MAX_LEN = 300000; // 극단값 캡 — 노트 1개당 약 300,000자 (일반 사용량 대비 충분히 넉넉함)
  var SAVE_DEBOUNCE = 500; // ms
  var DEFAULT_FONTSIZE = 16;
  var TAB_LABEL_LEN = 16; // 탭에 보일 첫 줄 미리보기 길이

  function t(key, fallback) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }

  /* ---- 순수 함수 (단어/글자 수 계산 — word-counter 와 동일한 CJK 인식 로직) ---- */
  // CJK(한자·가나·CJK호환): 공백 없이 이어 쓰므로 글자 단위로 셈
  var CJK_RE = /[一-鿿㐀-䶿぀-ヿ豈-﫿]/gu;
  function countWords(text) {
    var han = (text.match(CJK_RE) || []).length;
    var rest = text.replace(CJK_RE, "").trim();
    var restWords = 0;
    if (rest !== "") {
      var tokens = rest.split(/\s+/);
      for (var i = 0; i < tokens.length; i++) {
        if (/[\p{L}\p{N}]/u.test(tokens[i])) restWords++;
      }
    }
    return han + restWords;
  }
  function countChars(text) { return Array.from(text).length; }

  /* ---- 상태 로드/검증 (손상된 localStorage 값에도 안전하게 폴백) ---- */
  function loadNotes() {
    try {
      var raw = localStorage.getItem(K_NOTES);
      if (!raw) return [""];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr) || arr.length === 0) return [""];
      var out = [];
      for (var i = 0; i < arr.length && i < MAX_NOTES; i++) {
        out.push(typeof arr[i] === "string" ? arr[i] : "");
      }
      return out.length ? out : [""];
    } catch (e) { return [""]; }
  }
  function loadActive(len) {
    var n = 0;
    try {
      var raw = localStorage.getItem(K_ACTIVE);
      n = parseInt(raw, 10);
    } catch (e) { n = 0; }
    if (!isFinite(n) || n < 0) n = 0;
    if (n >= len) n = len - 1;
    return n;
  }

  var notes = loadNotes();
  var active = loadActive(notes.length);
  var storageBroken = false; // private mode / 쿼터 초과 등 — 첫 실패 시 한 번만 안내

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var tabbarEl = $("np-tabbar");
  var textEl = $("np-text");
  var monoEl = $("np-mono");
  var fontsizeEl = $("np-fontsize");
  var fontsizeValEl = $("np-fontsize-val");
  var wordsEl = $("np-words");
  var charsEl = $("np-chars");
  var savedStateEl = $("np-savedstate");
  var copyBtn = $("np-copy");
  var downloadBtn = $("np-download");
  var clearBtn = $("np-clear");
  var msgEl = $("np-msg");
  var confirmEl = $("np-confirm");
  var confirmMsgEl = $("np-confirm-msg");
  var confirmOkEl = $("np-confirm-ok");
  var confirmCancelEl = $("np-confirm-cancel");

  if (!textEl || !tabbarEl) return;

  /* ---- 저장 (디바운스) ---- */
  var saveTimer = null;
  function persistNow() {
    try {
      localStorage.setItem(K_NOTES, JSON.stringify(notes));
      localStorage.setItem(K_ACTIVE, String(active));
      storageBroken = false;
      setStatus("saved");
    } catch (e) {
      storageBroken = true;
      setStatus("error");
    }
    renderTabs(); // 탭 라벨(첫 줄 미리보기)은 저장 시점에만 갱신
  }
  function scheduleSave() {
    setStatus("typing");
    saveTimer = saveTimer && clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveTimer = null; persistNow(); }, SAVE_DEBOUNCE);
  }

  /* ---- 저장 상태 표시 ---- */
  function setStatus(state) {
    if (!savedStateEl) return;
    savedStateEl.classList.remove("is-warn");
    if (state === "typing") {
      savedStateEl.textContent = t("tool.status.typing", "Typing…");
    } else if (state === "saved") {
      savedStateEl.textContent = t("tool.status.saved", "Saved");
    } else if (state === "error") {
      savedStateEl.textContent = t("tool.status.error", "Not saved — private browsing?");
      savedStateEl.classList.add("is-warn");
    } else {
      savedStateEl.textContent = "";
    }
  }

  /* ---- 일시 메시지 (복사/다운로드 피드백·오류) ---- */
  var msgTimer = null;
  function showMsg(text, persist) {
    if (!msgEl) return;
    msgEl.hidden = false;
    msgEl.textContent = text;
    if (msgTimer) clearTimeout(msgTimer);
    if (!persist) {
      msgTimer = setTimeout(function () { msgEl.hidden = true; }, 2600);
    }
  }

  /* ---- 탭 라벨: 내용 첫 줄 미리보기, 없으면 "Note {n}" ---- */
  function tabLabel(i) {
    var v = (notes[i] || "").trim();
    if (!v) return t("tool.tab.label", "Note {n}").replace("{n}", String(i + 1));
    var firstLine = v.split(/\r?\n/)[0];
    return firstLine.length > TAB_LABEL_LEN ? firstLine.slice(0, TAB_LABEL_LEN) + "…" : firstLine;
  }

  /* ---- 탭바 렌더 ---- */
  function renderTabs() {
    tabbarEl.textContent = "";
    for (var i = 0; i < notes.length; i++) {
      (function (i) {
        var tab = document.createElement("button");
        tab.type = "button";
        tab.className = "np-tab" + (i === active ? " is-active" : "");
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", i === active ? "true" : "false");

        var label = document.createElement("span");
        label.className = "np-tab-label";
        label.textContent = tabLabel(i);
        tab.appendChild(label);

        if (notes.length > 1) {
          var closeBtn = document.createElement("span");
          closeBtn.className = "np-tab-close";
          closeBtn.setAttribute("role", "button");
          closeBtn.setAttribute("tabindex", "-1");
          closeBtn.setAttribute("aria-label", t("tool.tab.close", "Close this note"));
          closeBtn.textContent = "×";
          closeBtn.addEventListener("click", function (ev) {
            ev.stopPropagation();
            requestCloseTab(i);
          });
          tab.appendChild(closeBtn);
        }

        tab.addEventListener("click", function () { switchTab(i); });
        tabbarEl.appendChild(tab);
      })(i);
    }

    var addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "np-tab-add";
    addBtn.textContent = "+";
    var canAdd = notes.length < MAX_NOTES;
    addBtn.disabled = !canAdd;
    addBtn.setAttribute("aria-label", t("tool.tab.add", "Add a new note"));
    addBtn.title = canAdd ? t("tool.tab.add", "Add a new note") : t("tool.tab.addMax", "5-note limit reached — close a tab to add another");
    addBtn.addEventListener("click", addTab);
    tabbarEl.appendChild(addBtn);
  }

  /* ---- 탭 전환/추가/닫기 ---- */
  function switchTab(i) {
    if (i === active) return;
    active = i;
    textEl.value = notes[active];
    renderCounts();
    persistNow(); // 내부에서 renderTabs() 재실행 (활성 탭 표시 갱신)
    textEl.focus();
  }
  function addTab() {
    if (notes.length >= MAX_NOTES) return;
    notes.push("");
    active = notes.length - 1;
    textEl.value = "";
    renderCounts();
    persistNow(); // 내부에서 renderTabs() 재실행
    textEl.focus();
  }
  var pendingCloseIndex = -1;
  function requestCloseTab(i) {
    if (notes.length <= 1) return;
    pendingCloseIndex = i;
    openConfirm(t("tool.confirm.closeTab", "Close this note and delete its text? This can't be undone."), doCloseTab);
  }
  function doCloseTab() {
    var i = pendingCloseIndex;
    pendingCloseIndex = -1;
    if (i < 0 || i >= notes.length || notes.length <= 1) return;
    notes.splice(i, 1);
    if (active > i) active--;
    if (active >= notes.length) active = notes.length - 1;
    textEl.value = notes[active];
    renderCounts();
    persistNow(); // 내부에서 renderTabs() 재실행
  }

  /* ---- 글자/단어 수 렌더 ---- */
  function renderCounts() {
    var text = textEl.value;
    if (wordsEl) wordsEl.textContent = fmt(countWords(text));
    if (charsEl) charsEl.textContent = fmt(countChars(text));
  }
  function fmt(n) {
    try {
      var lang = (window.I18N && window.I18N.lang && window.I18N.lang()) || undefined;
      return n.toLocaleString(lang);
    } catch (e) { return String(n); }
  }

  /* ---- 입력 처리 ---- */
  textEl.addEventListener("input", function () {
    var v = textEl.value;
    if (v.length > MAX_LEN) {
      v = v.slice(0, MAX_LEN);
      textEl.value = v;
      showMsg(t("tool.msg.tooLong", "This note hit its length limit, so extra text past that point wasn't saved."));
    }
    notes[active] = v;
    renderCounts();
    // 탭 라벨(첫 줄 미리보기)은 저장 시점에만 갱신 — 매 키 입력마다 DOM을 다시 그리지 않는다
    scheduleSave();
  });

  /* ---- 모노스페이스 / 글자 크기 ---- */
  function loadMono() {
    var v = null;
    try { v = localStorage.getItem(K_MONO); } catch (e) { /* noop */ }
    return v === "1";
  }
  function applyMono(on) {
    textEl.classList.toggle("np-mono", on);
    if (monoEl) monoEl.checked = on;
  }
  function loadFontsize() {
    var n = DEFAULT_FONTSIZE;
    try {
      var v = parseInt(localStorage.getItem(K_FONTSIZE), 10);
      if (isFinite(v) && v >= 13 && v <= 24) n = v;
    } catch (e) { /* noop */ }
    return n;
  }
  function applyFontsize(n) {
    textEl.style.fontSize = n + "px";
    if (fontsizeEl) fontsizeEl.value = String(n);
    if (fontsizeValEl) fontsizeValEl.textContent = n + "px";
  }

  if (monoEl) {
    monoEl.addEventListener("change", function () {
      applyMono(monoEl.checked);
      try { localStorage.setItem(K_MONO, monoEl.checked ? "1" : "0"); } catch (e) { /* noop */ }
    });
  }
  if (fontsizeEl) {
    fontsizeEl.addEventListener("input", function () {
      var n = parseInt(fontsizeEl.value, 10);
      if (!isFinite(n)) n = DEFAULT_FONTSIZE;
      applyFontsize(n);
      try { localStorage.setItem(K_FONTSIZE, String(n)); } catch (e) { /* noop */ }
    });
  }

  /* ---- 복사 전체 ---- */
  function legacyCopy(text, done, fail) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) done(); else fail();
    } catch (e) { fail(); }
  }
  function copyAll() {
    var text = notes[active] || "";
    if (!text.trim()) {
      showMsg(t("tool.msg.copyEmpty", "Nothing to copy — this note is empty."));
      return;
    }
    var done = function () { showMsg(t("tool.msg.copied", "Copied!")); };
    var fail = function () { showMsg(t("tool.msg.copyError", "Couldn't copy — select the text and copy it manually.")); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text, done, fail); });
      } else {
        legacyCopy(text, done, fail);
      }
    } catch (e) { legacyCopy(text, done, fail); }
  }
  if (copyBtn) copyBtn.addEventListener("click", copyAll);

  /* ---- .txt 다운로드 ---- */
  function downloadTxt() {
    var text = notes[active] || "";
    if (!text.trim()) {
      showMsg(t("tool.msg.downloadEmpty", "Nothing to download — write something first."));
      return;
    }
    try {
      var blob = new Blob([text], { type: "text/plain;charset=utf-8;" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = SLUG + "-note-" + (active + 1) + ".txt";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) {
      showMsg(t("tool.msg.copyError", "Couldn't copy — select the text and copy it manually."));
    }
  }
  if (downloadBtn) downloadBtn.addEventListener("click", downloadTxt);

  /* ---- 확인 모달 (지우기 / 탭 닫기 공용) ---- */
  var confirmAction = null;
  function openConfirm(message, action) {
    if (!confirmEl) { action(); return; } // 모달 마크업이 없으면 즉시 실행(안전장치)
    confirmAction = action;
    if (confirmMsgEl) confirmMsgEl.textContent = message;
    confirmEl.hidden = false;
    if (confirmOkEl) confirmOkEl.focus();
  }
  function closeConfirm() {
    confirmEl.hidden = true;
    confirmAction = null;
    pendingCloseIndex = -1;
  }
  if (confirmOkEl) {
    confirmOkEl.addEventListener("click", function () {
      var action = confirmAction;
      confirmEl.hidden = true;
      confirmAction = null;
      if (action) action();
    });
  }
  if (confirmCancelEl) confirmCancelEl.addEventListener("click", closeConfirm);
  if (confirmEl) {
    confirmEl.addEventListener("click", function (ev) {
      if (ev.target === confirmEl) closeConfirm();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && !confirmEl.hidden) closeConfirm();
    });
  }

  /* ---- 지우기 ---- */
  function requestClear() {
    if (!(notes[active] || "").trim()) return; // 빈 노트는 확인 없이 아무것도 하지 않음
    openConfirm(t("tool.confirm.clear", "Clear this note? This can't be undone."), doClear);
  }
  function doClear() {
    notes[active] = "";
    textEl.value = "";
    renderCounts();
    persistNow(); // 내부에서 renderTabs() 재실행
    textEl.focus();
  }
  if (clearBtn) clearBtn.addEventListener("click", requestClear);

  /* ---- 언어 전환 시 동적 문구 재적용 ---- */
  document.addEventListener("i18n:change", function () {
    renderTabs();
    // 저장 상태 문구는 최근 상태를 다시 그대로 반영(진행 중 타이머는 유지)
    if (savedStateEl && savedStateEl.textContent) {
      setStatus(storageBroken ? "error" : (saveTimer ? "typing" : "saved"));
    }
  });

  /* ---- 초기화 ---- */
  textEl.value = notes[active] || "";
  applyMono(loadMono());
  applyFontsize(loadFontsize());
  renderTabs();
  renderCounts();
  // TOOLJS:END
})();
