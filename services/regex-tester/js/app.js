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
  /* Regex Tester — JS(ECMAScript) 정규식을 브라우저 안에서 즉시 테스트.
     패턴+플래그(g i m s u y)로 테스트 문자열을 스캔해 매치 하이라이트·인덱스·
     캡처 그룹(번호+named)·치환 미리보기를 실시간 렌더링한다. 외부 API 없음. */

  var LIM = { textLen: 200000, maxMatches: 1000, listRows: 300 };

  /* ---- 순수 계산 (node 단위 검증 대상: DOM 의존 없음) ---- */

  // 정규식 생성: 실패 시 { ok:false, error } — 절대 throw 밖으로 흘리지 않는다.
  function buildRegex(pattern, flags) {
    try {
      return { ok: true, re: new RegExp(pattern, flags) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // 전체 매치 스캔: 사용자가 고른 플래그를 보존하되 반복 탐색을 위해 g 만 강제한다.
  // (스캔 전용 사본 — 실제 치환은 runReplace 가 사용자의 원래 플래그로 별도 수행)
  function scanMatches(pattern, flags, text, maxMatches) {
    var scanFlags = flags.indexOf("g") === -1 ? flags + "g" : flags;
    var built = buildRegex(pattern, scanFlags);
    if (!built.ok) return { ok: false, error: built.error };
    var re = built.re;
    var out = [];
    var truncated = false;
    var m;
    var guardIterations = maxMatches * 4 + 1000; // 빈 매치 방어에도 유한 반복 보장
    var iter = 0;
    while ((m = re.exec(text)) !== null) {
      iter++;
      if (iter > guardIterations) break;
      if (out.length >= maxMatches) { truncated = true; break; }
      var groups = [];
      for (var i = 1; i < m.length; i++) groups.push({ n: i, value: m[i] });
      var named = [];
      if (m.groups) {
        for (var key in m.groups) {
          if (Object.prototype.hasOwnProperty.call(m.groups, key)) named.push({ name: key, value: m.groups[key] });
        }
      }
      out.push({ index: m.index, match: m[0], groups: groups, named: named });
      // 빈 문자열 매치 시 lastIndex 가 그대로라 무한루프 — 표준 가드로 1 전진시킨다.
      if (m[0].length === 0) re.lastIndex += 1;
    }
    return { ok: true, matches: out, truncated: truncated };
  }

  // 치환 미리보기: 사용자가 고른 플래그 그대로(g 없으면 첫 매치만) 네이티브 replace 위임.
  // $1 $<name> $& $$ 등은 브라우저 RegExp 엔진이 그대로 해석 — 재구현하지 않는다.
  function runReplace(pattern, flags, text, replacement) {
    var built = buildRegex(pattern, flags);
    if (!built.ok) return { ok: false, error: built.error };
    try {
      return { ok: true, result: text.replace(built.re, replacement) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  var PRESETS = {
    email: { pattern: "[\\w.+-]+@[\\w-]+\\.[\\w.-]+", flags: "g" },
    url: { pattern: "https?:\\/\\/[^\\s]+", flags: "g" },
    ipv4: { pattern: "\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b", flags: "g" },
    digits: { pattern: "\\d+", flags: "g" },
    whitespace: { pattern: "^\\s+|\\s+$", flags: "gm" }
  };

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { buildRegex: buildRegex, scanMatches: scanMatches, runReplace: runReplace, PRESETS: PRESETS };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "regex-tester") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmtInt(n) {
    try { return Number(n).toLocaleString(uiLang()); } catch (e) { return String(n); }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var patternEl = $("pattern"), testEl = $("test-string"), replEl = $("replacement");
  var flagBoxes = document.querySelectorAll(".rt-flag");
  var errBox = $("pattern-error");
  var summaryEl = $("match-summary");
  var previewEl = $("highlight-preview"), previewEmptyEl = $("preview-empty");
  var listEl = $("matches-list"), listWrap = $("matches-wrap"), listTruncEl = $("matches-trunc");
  var replaceWrap = $("replace-wrap"), replacePreviewEl = $("replace-preview"), replaceHintEl = $("replace-hint");
  var presetsWrap = $("pattern-presets");
  var copyBtn = $("copy-replace");
  if (!patternEl || !testEl || !previewEl || !listEl) return;

  function currentFlags() {
    var f = "";
    for (var i = 0; i < flagBoxes.length; i++) {
      if (flagBoxes[i].checked) f += flagBoxes[i].getAttribute("data-flag");
    }
    return f;
  }

  /* ---- 하이라이트 미리보기: DOM 노드로 조립(innerHTML 미사용) — XSS 원천 차단 ---- */
  function renderHighlight(text, matches) {
    previewEl.textContent = "";
    if (!text) { previewEmptyEl.hidden = false; previewEl.hidden = true; return; }
    previewEmptyEl.hidden = true;
    previewEl.hidden = false;
    if (!matches.length) { previewEl.textContent = text; return; }
    var frag = document.createDocumentFragment();
    var cursor = 0;
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      if (m.index > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, m.index)));
      var mark = document.createElement("mark");
      mark.className = "rt-mark";
      mark.textContent = m.match.length ? m.match : "​";
      mark.title = "#" + (i + 1) + " @" + m.index;
      frag.appendChild(mark);
      cursor = m.index + m.match.length;
    }
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
    previewEl.appendChild(frag);
  }

  /* ---- 매치 목록 렌더 ---- */
  function renderList(matches, truncated) {
    listEl.textContent = "";
    if (!matches.length) { listWrap.hidden = true; listTruncEl.hidden = true; return; }
    listWrap.hidden = false;
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      var li = document.createElement("li");
      li.className = "rt-match-item";

      var head = document.createElement("div");
      head.className = "rt-match-head";
      var idxLabel = document.createElement("span");
      idxLabel.className = "rt-match-n";
      idxLabel.textContent = "#" + (i + 1);
      var idxAt = document.createElement("span");
      idxAt.className = "rt-match-at";
      idxAt.textContent = tr("tool.match.at", "index {i}").replace("{i}", fmtInt(m.index));
      var val = document.createElement("code");
      val.className = "rt-match-val";
      val.textContent = m.match.length ? m.match : tr("tool.match.empty", "(empty match)");
      head.appendChild(idxLabel); head.appendChild(idxAt); head.appendChild(val);
      li.appendChild(head);

      if (m.groups.length) {
        var gWrap = document.createElement("div");
        gWrap.className = "rt-groups";
        for (var g = 0; g < m.groups.length; g++) {
          var gr = m.groups[g];
          var chip = document.createElement("span");
          chip.className = "rt-group-chip";
          var gLabel = tr("tool.group.n", "Group {n}").replace("{n}", String(gr.n));
          var gVal = gr.value == null ? tr("tool.group.nomatch", "no match") : gr.value;
          chip.textContent = gLabel + ": " + gVal;
          gWrap.appendChild(chip);
        }
        li.appendChild(gWrap);
      }
      if (m.named.length) {
        var nWrap = document.createElement("div");
        nWrap.className = "rt-groups";
        for (var n = 0; n < m.named.length; n++) {
          var nr = m.named[n];
          var nchip = document.createElement("span");
          nchip.className = "rt-group-chip rt-group-named";
          var nVal = nr.value == null ? tr("tool.group.nomatch", "no match") : nr.value;
          nchip.textContent = tr("tool.group.named", "Named “{name}”").replace("{name}", nr.name) + ": " + nVal;
          nWrap.appendChild(nchip);
        }
        li.appendChild(nWrap);
      }
      listEl.appendChild(li);
    }
    if (truncated) {
      listTruncEl.hidden = false;
      listTruncEl.textContent = tr("tool.match.truncated", "Showing the first {n} matches.").replace("{n}", fmtInt(LIM.maxMatches));
    } else {
      listTruncEl.hidden = true;
    }
  }

  /* ---- 렌더 ---- */
  function render() {
    var pattern = patternEl.value;
    var flags = currentFlags();
    var text = testEl.value;
    persist();

    if (!pattern) {
      errBox.hidden = true;
      summaryEl.textContent = tr("tool.summary.empty", "Enter a pattern to start matching.");
      renderHighlight(text, []);
      renderList([], false);
      replaceWrap.hidden = true;
      return;
    }

    var scan = scanMatches(pattern, flags, text, LIM.maxMatches);
    if (!scan.ok) {
      errBox.hidden = false;
      errBox.textContent = tr("tool.err.invalid", "Invalid regular expression: {msg}").replace("{msg}", scan.error);
      summaryEl.textContent = "";
      renderHighlight(text, []);
      renderList([], false);
      replaceWrap.hidden = true;
      return;
    }
    errBox.hidden = true;

    var count = scan.matches.length;
    summaryEl.textContent = count === 0
      ? tr("tool.summary.none", "No matches")
      : (count === 1
        ? tr("tool.summary.one", "1 match found")
        : tr("tool.summary.many", "{n} matches found").replace("{n}", fmtInt(count)));

    renderHighlight(text, scan.matches);
    renderList(scan.matches, scan.truncated);

    // 치환 미리보기 — 사용자가 고른 실제 플래그로 (g 없으면 첫 매치만, 네이티브 규칙 그대로)
    replaceWrap.hidden = false;
    var replacement = replEl.value;
    var rep = runReplace(pattern, flags, text, replacement);
    if (!rep.ok) {
      replacePreviewEl.textContent = tr("tool.err.invalid", "Invalid regular expression: {msg}").replace("{msg}", rep.error);
    } else {
      replacePreviewEl.textContent = rep.result;
    }
    replaceHintEl.hidden = flags.indexOf("g") !== -1 || count <= 1;
  }

  /* ---- 프리셋 ---- */
  function applyPreset(key) {
    var p = PRESETS[key];
    if (!p) return;
    patternEl.value = p.pattern;
    for (var i = 0; i < flagBoxes.length; i++) {
      flagBoxes[i].checked = p.flags.indexOf(flagBoxes[i].getAttribute("data-flag")) !== -1;
    }
    render();
  }
  if (presetsWrap) {
    presetsWrap.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-preset]") : null;
      if (!btn) return;
      applyPreset(btn.getAttribute("data-preset"));
    });
  }

  /* ---- 복사 ---- */
  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (e) { /* 복사 미지원 — 표시값은 그대로 남는다 */ }
  }
  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      var text = replacePreviewEl.textContent || "";
      var done = function () {
        var orig = tr("tool.copy", "Copy result");
        copyBtn.textContent = tr("tool.copied", "Copied");
        setTimeout(function () { copyBtn.textContent = orig; }, 1200);
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text); done(); });
        } else { legacyCopy(text); done(); }
      } catch (e) { legacyCopy(text); done(); }
    });
  }

  /* ---- 상태 저장/복원 ---- */
  function persist() {
    try {
      localStorage.setItem(SKEY, JSON.stringify({
        pattern: patternEl.value, flags: currentFlags(),
        test: testEl.value, repl: replEl.value
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }
  }
  function restore() {
    var saved = null;
    try { var s = localStorage.getItem(SKEY); if (s) saved = JSON.parse(s); } catch (e) { saved = null; }
    if (!saved) return;
    if (typeof saved.pattern === "string") patternEl.value = saved.pattern;
    if (typeof saved.test === "string") testEl.value = saved.test;
    if (typeof saved.repl === "string") replEl.value = saved.repl;
    if (typeof saved.flags === "string") {
      for (var i = 0; i < flagBoxes.length; i++) {
        flagBoxes[i].checked = saved.flags.indexOf(flagBoxes[i].getAttribute("data-flag")) !== -1;
      }
    }
  }

  /* ---- 이벤트 ---- */
  patternEl.addEventListener("input", render);
  testEl.addEventListener("input", render);
  replEl.addEventListener("input", render);
  for (var fb = 0; fb < flagBoxes.length; fb++) flagBoxes[fb].addEventListener("change", render);
  document.addEventListener("i18n:change", render);

  restore();
  render();
  // TOOLJS:END
})();
