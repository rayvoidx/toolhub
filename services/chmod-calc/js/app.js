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
  /* Chmod Calculator — 체크박스 그리드 <-> 8진수(755) <-> 심볼릭(rwxr-xr-x) 3표현을 실시간 동기화.
     setuid/setgid/sticky 특수 비트, 자주 쓰는 권한 프리셋(755/644/700/600/750/664/775/777),
     chmod 명령 미리보기까지 전부 로컬 계산. 외부 API 없음. */

  /* ---- 순수 계산 (node 단위 검증 대상) ----
     상태 모델: { owner:{r,w,x}, group:{r,w,x}, other:{r,w,x}, special:{setuid,setgid,sticky} } */

  function digitToPerm(d) {
    d = d | 0;
    return { r: !!(d & 4), w: !!(d & 2), x: !!(d & 1) };
  }
  function permToDigit(p) {
    return (p.r ? 4 : 0) + (p.w ? 2 : 0) + (p.x ? 1 : 0);
  }
  function defaultState() {
    return {
      owner: { r: true, w: true, x: true },
      group: { r: true, w: false, x: true },
      other: { r: true, w: false, x: true },
      special: { setuid: false, setgid: false, sticky: false }
    };
  }
  // 상태 → 8진수 문자열. 특수 비트가 하나라도 켜지면 4자리(선두 특수 자릿수), 아니면 3자리.
  function stateToOctal(state) {
    var special = (state.special.setuid ? 4 : 0) + (state.special.setgid ? 2 : 0) + (state.special.sticky ? 1 : 0);
    var body = String(permToDigit(state.owner)) + String(permToDigit(state.group)) + String(permToDigit(state.other));
    return special > 0 ? String(special) + body : body;
  }
  // "755" / "0755" / "4755" → 상태 객체. 3~4자리, 각 자리 0-7 아니면 null (파싱 실패).
  function parseOctal(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!/^[0-7]{3,4}$/.test(s)) return null;
    var digits = s.split("").map(function (c) { return c.charCodeAt(0) - 48; });
    var special = digits.length === 4 ? digits[0] : 0;
    var o = digits[digits.length - 3], g = digits[digits.length - 2], ot = digits[digits.length - 1];
    return {
      owner: digitToPerm(o), group: digitToPerm(g), other: digitToPerm(ot),
      special: { setuid: !!(special & 4), setgid: !!(special & 2), sticky: !!(special & 1) }
    };
  }
  // 8진수 입력 진행 상태 분류: 빈값 / 아직 자릿수가 덜 참(incomplete, 에러 표시 안 함) / 완전 유효 / 무효(에러 표시)
  function classifyOctal(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (s === "") return "empty";
    if (!/^[0-7]{0,4}$/.test(s)) return "invalid";
    if (s.length < 3) return "incomplete";
    return "valid";
  }
  // 상태 → 심볼릭 9자 문자열 (setuid: owner x자리 s/S, setgid: group x자리 s/S, sticky: other x자리 t/T)
  function stateToSymbolic(state) {
    function seg(p, on, onChar, offChar) {
      var r = p.r ? "r" : "-";
      var w = p.w ? "w" : "-";
      var x = on ? (p.x ? onChar : offChar) : (p.x ? "x" : "-");
      return r + w + x;
    }
    return seg(state.owner, state.special.setuid, "s", "S") +
      seg(state.group, state.special.setgid, "s", "S") +
      seg(state.other, state.special.sticky, "t", "T");
  }
  // "rwxr-xr-x" (9자) 또는 선두에 파일종류 문자가 붙은 10자("-rwxr-xr-x") → 상태 객체, 실패 시 null
  function parseSymbolic(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (s.length === 10) s = s.slice(1);
    if (s.length !== 9) return null;
    var ownerPart = s.slice(0, 3), groupPart = s.slice(3, 6), otherPart = s.slice(6, 9);
    if (!/^[r-][w-][xsS-]$/.test(ownerPart)) return null;
    if (!/^[r-][w-][xsS-]$/.test(groupPart)) return null;
    if (!/^[r-][w-][xtT-]$/.test(otherPart)) return null;
    function parseSeg(seg3, onChar, offChar) {
      var r = seg3.charAt(0) === "r", w = seg3.charAt(1) === "w";
      var xc = seg3.charAt(2);
      var x, special;
      if (xc === onChar) { x = true; special = true; }
      else if (xc === offChar) { x = false; special = true; }
      else if (xc === "x") { x = true; special = false; }
      else { x = false; special = false; }
      return { r: r, w: w, x: x, special: special };
    }
    var o = parseSeg(ownerPart, "s", "S");
    var g = parseSeg(groupPart, "s", "S");
    var ot = parseSeg(otherPart, "t", "T");
    return {
      owner: { r: o.r, w: o.w, x: o.x }, group: { r: g.r, w: g.w, x: g.x }, other: { r: ot.r, w: ot.w, x: ot.x },
      special: { setuid: o.special, setgid: g.special, sticky: ot.special }
    };
  }
  function classifySymbolic(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (s === "") return "empty";
    if (s.length > 10) return "invalid";
    var body = s.length === 10 ? s.slice(1) : s;
    if (body.length < 9) return "incomplete";
    return parseSymbolic(s) ? "valid" : "invalid";
  }
  // 위험한 777(everyone rwx) 여부 — 특수 비트와 무관하게 owner/group/other가 전부 7일 때
  function isDangerous777(state) {
    return permToDigit(state.owner) === 7 && permToDigit(state.group) === 7 && permToDigit(state.other) === 7;
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      digitToPerm: digitToPerm, permToDigit: permToDigit, defaultState: defaultState,
      stateToOctal: stateToOctal, parseOctal: parseOctal, classifyOctal: classifyOctal,
      stateToSymbolic: stateToSymbolic, parseSymbolic: parseSymbolic, classifySymbolic: classifySymbolic,
      isDangerous777: isDangerous777
    };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "chmod-calc") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var CLASSES = ["owner", "group", "other"];
  var TYPES = ["r", "w", "x"];
  var checkboxes = {}; // checkboxes.owner.r 등
  var missingCb = false;
  for (var ci = 0; ci < CLASSES.length; ci++) {
    checkboxes[CLASSES[ci]] = {};
    for (var ti = 0; ti < TYPES.length; ti++) {
      var el = $("perm-" + CLASSES[ci] + "-" + TYPES[ti]);
      checkboxes[CLASSES[ci]][TYPES[ti]] = el;
      if (!el) missingCb = true;
    }
  }
  var octalEl = $("octal-input"), symbolicEl = $("symbolic-input");
  var octalErrEl = $("octal-error"), symbolicErrEl = $("symbolic-error");
  var setuidEl = $("setuid"), setgidEl = $("setgid"), stickyEl = $("sticky");
  var targetEl = $("target-name"), recursiveEl = $("recursive");
  var commandEl = $("command-preview"), copyHintEl = $("command-copy-hint");
  var warnEl = $("perm-warning");
  var presetsWrap = $("perm-presets");
  if (missingCb || !octalEl || !symbolicEl || !commandEl) return;
  var presetBtns = presetsWrap ? presetsWrap.querySelectorAll(".perm-preset") : [];

  /* ---- 상태 저장/복원 ---- */
  function loadState() {
    try {
      var raw = localStorage.getItem(SKEY);
      if (!raw) return defaultState();
      var saved = JSON.parse(raw);
      var parsed = saved && saved.octal ? parseOctal(saved.octal) : null;
      if (!parsed) return defaultState();
      if (saved.target != null) parsed._target = saved.target;
      if (saved.recursive != null) parsed._recursive = !!saved.recursive;
      return parsed;
    } catch (e) { return defaultState(); }
  }
  function saveState(state) {
    try {
      localStorage.setItem(SKEY, JSON.stringify({
        octal: stateToOctal(state),
        target: targetEl ? targetEl.value : "",
        recursive: recursiveEl ? !!recursiveEl.checked : false
      }));
    } catch (e) { /* private mode — 저장만 실패, 계산은 정상 */ }
  }

  var state = loadState();

  /* ---- 렌더 ---- */
  function fmtCopied(el, key) {
    if (!el) return;
    el.textContent = tr(key + ".copied", "Copied");
    setTimeout(function () { el.textContent = tr(key + ".copyHint", el.textContent); }, 1100);
  }

  function render(opts) {
    opts = opts || {};
    var c;
    for (c = 0; c < CLASSES.length; c++) {
      var cls = CLASSES[c];
      for (var t = 0; t < TYPES.length; t++) {
        checkboxes[cls][TYPES[t]].checked = !!state[cls][TYPES[t]];
      }
    }
    if (setuidEl) setuidEl.checked = !!state.special.setuid;
    if (setgidEl) setgidEl.checked = !!state.special.setgid;
    if (stickyEl) stickyEl.checked = !!state.special.sticky;

    if (!opts.skipOctal) octalEl.value = stateToOctal(state);
    if (!opts.skipSymbolic) symbolicEl.value = stateToSymbolic(state);
    if (octalErrEl) octalErrEl.hidden = true;
    if (symbolicErrEl) symbolicErrEl.hidden = true;

    var target = (targetEl && targetEl.value.trim()) || tr("tool.target.default", "example.txt");
    var flag = recursiveEl && recursiveEl.checked ? " -R" : "";
    commandEl.textContent = "chmod" + flag + " " + stateToOctal(state) + " " + target;

    if (warnEl) warnEl.hidden = !isDangerous777(state);

    // 프리셋 활성 표시
    var curOctal = stateToOctal(state).length === 4 ? stateToOctal(state).slice(1) : stateToOctal(state);
    for (var i = 0; i < presetBtns.length; i++) {
      var on = presetBtns[i].getAttribute("data-octal") === curOctal;
      presetBtns[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    saveState(state);
  }

  /* ---- 체크박스 이벤트 ---- */
  for (var cc = 0; cc < CLASSES.length; cc++) {
    (function (cls) {
      for (var tt = 0; tt < TYPES.length; tt++) {
        (function (type) {
          checkboxes[cls][type].addEventListener("change", function () {
            state[cls][type] = this.checked;
            render();
          });
        })(TYPES[tt]);
      }
    })(CLASSES[cc]);
  }
  if (setuidEl) setuidEl.addEventListener("change", function () { state.special.setuid = this.checked; render(); });
  if (setgidEl) setgidEl.addEventListener("change", function () { state.special.setgid = this.checked; render(); });
  if (stickyEl) stickyEl.addEventListener("change", function () { state.special.sticky = this.checked; render(); });

  /* ---- 8진수 입력 ---- */
  octalEl.addEventListener("input", function () {
    var status = classifyOctal(octalEl.value);
    if (status === "valid") {
      var parsed = parseOctal(octalEl.value);
      if (parsed) { state = parsed; render({ skipOctal: true }); }
    } else if (status === "invalid") {
      if (octalErrEl) { octalErrEl.hidden = false; octalErrEl.textContent = tr("tool.octal.err", "Enter 3 or 4 octal digits (0-7)"); }
    } else if (octalErrEl) {
      octalErrEl.hidden = true;
    }
  });
  octalEl.addEventListener("blur", function () {
    if (classifyOctal(octalEl.value) !== "valid") render();
  });

  /* ---- 심볼릭 입력 ---- */
  symbolicEl.addEventListener("input", function () {
    var status = classifySymbolic(symbolicEl.value);
    if (status === "valid") {
      var parsed = parseSymbolic(symbolicEl.value);
      if (parsed) { state = parsed; render({ skipSymbolic: true }); }
    } else if (status === "invalid") {
      if (symbolicErrEl) { symbolicErrEl.hidden = false; symbolicErrEl.textContent = tr("tool.symbolic.err", "Enter 9 characters like rwxr-xr-x"); }
    } else if (symbolicErrEl) {
      symbolicErrEl.hidden = true;
    }
  });
  symbolicEl.addEventListener("blur", function () {
    if (classifySymbolic(symbolicEl.value) !== "valid") render();
  });

  /* ---- 대상 이름 / 재귀 옵션 ---- */
  if (targetEl) targetEl.addEventListener("input", render);
  if (recursiveEl) recursiveEl.addEventListener("change", render);

  /* ---- 프리셋 클릭 ---- */
  function onPresetClick() {
    var octal = this.getAttribute("data-octal");
    var parsed = parseOctal(octal);
    if (!parsed) return;
    state = parsed;
    render();
  }
  for (var pb = 0; pb < presetBtns.length; pb++) {
    presetBtns[pb].addEventListener("click", onPresetClick);
  }

  /* ---- 명령 미리보기 클릭 복사 ---- */
  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch (e) { return false; }
  }
  commandEl.addEventListener("click", function () {
    var text = commandEl.textContent;
    var done = function () { fmtCopied(copyHintEl, "tool.command"); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { if (legacyCopy(text)) done(); });
      } else if (legacyCopy(text)) {
        done();
      }
    } catch (e) { if (legacyCopy(text)) done(); }
  });

  // 언어 전환 시 동적 문구(명령 미리보기·에러·복사힌트) 재적용
  document.addEventListener("i18n:change", function () { render(); });

  render();
  // TOOLJS:END
})();
