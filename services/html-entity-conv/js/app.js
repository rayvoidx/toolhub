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
  /* HTML Entity Encoder / Decoder — 전부 브라우저 로컬, 외부 API 없음.
     인코드: & < > " ' 는 항상 이스케이프. 그 외 문자는 표준 HTML4 명명 엔티티
     (총 253개, apostrophe 는 관례상 &#39;) 표에 있으면 이름형으로, 없으면
     "Encode all non-ASCII" 토글이 켜져 있을 때만 숫자형(&#NNNN;)으로 변환한다.
     디코드: 분리된(문서에 붙지 않는) textarea 에 innerHTML 을 대입해 값을 읽는
     표준 트릭 — textarea 내부는 RCDATA 라 태그가 실행되지 않고 문자 참조만
     해석되므로 named/decimal/hex 엔티티 전부를 브라우저 자신의 파서로 안전하게
     디코딩한다(스크립트 실행 없음, DOM에 삽입되지 않음). */

  // 코드포인트 → HTML4 표준 명명 엔티티 이름(& ; 제외). 39(apostrophe)는 &apos; 대신
  // 관례적으로 더 폭넓게 호환되는 &#39; 를 쓰도록 이름 자리에 "#39" 를 넣어둔다.
  var NAMED_BY_CP = {
    34:"quot",38:"amp",39:"#39",60:"lt",62:"gt",160:"nbsp",161:"iexcl",162:"cent",
    163:"pound",164:"curren",165:"yen",166:"brvbar",167:"sect",168:"uml",169:"copy",170:"ordf",
    171:"laquo",172:"not",173:"shy",174:"reg",175:"macr",176:"deg",177:"plusmn",178:"sup2",
    179:"sup3",180:"acute",181:"micro",182:"para",183:"middot",184:"cedil",185:"sup1",186:"ordm",
    187:"raquo",188:"frac14",189:"frac12",190:"frac34",191:"iquest",192:"Agrave",193:"Aacute",194:"Acirc",
    195:"Atilde",196:"Auml",197:"Aring",198:"AElig",199:"Ccedil",200:"Egrave",201:"Eacute",202:"Ecirc",
    203:"Euml",204:"Igrave",205:"Iacute",206:"Icirc",207:"Iuml",208:"ETH",209:"Ntilde",210:"Ograve",
    211:"Oacute",212:"Ocirc",213:"Otilde",214:"Ouml",215:"times",216:"Oslash",217:"Ugrave",218:"Uacute",
    219:"Ucirc",220:"Uuml",221:"Yacute",222:"THORN",223:"szlig",224:"agrave",225:"aacute",226:"acirc",
    227:"atilde",228:"auml",229:"aring",230:"aelig",231:"ccedil",232:"egrave",233:"eacute",234:"ecirc",
    235:"euml",236:"igrave",237:"iacute",238:"icirc",239:"iuml",240:"eth",241:"ntilde",242:"ograve",
    243:"oacute",244:"ocirc",245:"otilde",246:"ouml",247:"divide",248:"oslash",249:"ugrave",250:"uacute",
    251:"ucirc",252:"uuml",253:"yacute",254:"thorn",255:"yuml",338:"OElig",339:"oelig",352:"Scaron",
    353:"scaron",376:"Yuml",402:"fnof",710:"circ",732:"tilde",913:"Alpha",914:"Beta",915:"Gamma",
    916:"Delta",917:"Epsilon",918:"Zeta",919:"Eta",920:"Theta",921:"Iota",922:"Kappa",923:"Lambda",
    924:"Mu",925:"Nu",926:"Xi",927:"Omicron",928:"Pi",929:"Rho",931:"Sigma",932:"Tau",
    933:"Upsilon",934:"Phi",935:"Chi",936:"Psi",937:"Omega",945:"alpha",946:"beta",947:"gamma",
    948:"delta",949:"epsilon",950:"zeta",951:"eta",952:"theta",953:"iota",954:"kappa",955:"lambda",
    956:"mu",957:"nu",958:"xi",959:"omicron",960:"pi",961:"rho",962:"sigmaf",963:"sigma",
    964:"tau",965:"upsilon",966:"phi",967:"chi",968:"psi",969:"omega",977:"thetasym",978:"upsih",
    982:"piv",8194:"ensp",8195:"emsp",8201:"thinsp",8204:"zwnj",8205:"zwj",8206:"lrm",8207:"rlm",
    8211:"ndash",8212:"mdash",8216:"lsquo",8217:"rsquo",8218:"sbquo",8220:"ldquo",8221:"rdquo",8222:"bdquo",
    8224:"dagger",8225:"Dagger",8226:"bull",8230:"hellip",8240:"permil",8242:"prime",8243:"Prime",8249:"lsaquo",
    8250:"rsaquo",8254:"oline",8260:"frasl",8364:"euro",8465:"image",8472:"weierp",8476:"real",8482:"trade",
    8501:"alefsym",8592:"larr",8593:"uarr",8594:"rarr",8595:"darr",8596:"harr",8629:"crarr",8656:"lArr",
    8657:"uArr",8658:"rArr",8659:"dArr",8660:"hArr",8704:"forall",8706:"part",8707:"exist",8709:"empty",
    8711:"nabla",8712:"isin",8713:"notin",8715:"ni",8719:"prod",8721:"sum",8722:"minus",8727:"lowast",
    8730:"radic",8733:"prop",8734:"infin",8736:"ang",8743:"and",8744:"or",8745:"cap",8746:"cup",
    8747:"int",8756:"there4",8764:"sim",8773:"cong",8776:"asymp",8800:"ne",8801:"equiv",8804:"le",
    8805:"ge",8834:"sub",8835:"sup",8836:"nsub",8838:"sube",8839:"supe",8853:"oplus",8855:"otimes",
    8869:"perp",8901:"sdot",8968:"lceil",8969:"rceil",8970:"lfloor",8971:"rfloor",9001:"lang",9002:"rang",
    9674:"loz",9824:"spades",9827:"clubs",9829:"hearts",9830:"diams"
  };

  /* ---- 순수 변환 로직 (node 검증 대상) ---- */

  // 서로게이트 쌍을 인식해 완전한 코드포인트 배열로 분해 (이모지 등 astral 지원)
  function codePointsOf(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        var c2 = str.charCodeAt(i + 1);
        if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
          out.push(((c - 0xD800) * 0x400) + (c2 - 0xDC00) + 0x10000);
          i++;
          continue;
        }
      }
      out.push(c);
    }
    return out;
  }
  // 코드포인트 → 문자열 (astral 은 서로게이트 쌍으로 재조립, ES5 호환)
  function cpToChar(cp) {
    if (cp <= 0xFFFF) return String.fromCharCode(cp);
    cp -= 0x10000;
    var hi = 0xD800 + (cp >> 10);
    var lo = 0xDC00 + (cp & 0x3FF);
    return String.fromCharCode(hi, lo);
  }

  // Text → HTML 엔티티. & < > " ' 는 항상 이스케이프, 그 외 명명 엔티티가 있는 문자는
  // 항상 이름형으로, 이름이 없는 비 ASCII 문자는 allNonAscii 가 true 일 때만 숫자형으로.
  function encodeEntities(str, allNonAscii) {
    if (str === "") return "";
    var cps = codePointsOf(str);
    var out = "";
    for (var i = 0; i < cps.length; i++) {
      var cp = cps[i];
      var name = NAMED_BY_CP[cp];
      if (name) { out += "&" + name + ";"; continue; }
      if (cp < 128) { out += cpToChar(cp); continue; }
      out += allNonAscii ? ("&#" + cp + ";") : cpToChar(cp);
    }
    return out;
  }

  // HTML 엔티티 soup → Text. 분리된 textarea 에 innerHTML 대입 후 value 를 읽는
  // 표준 트릭 — RCDATA 콘텐츠 모델이라 태그가 파싱/실행되지 않고 문자 참조만
  // 해석된다(요소는 document 에 삽입되지 않음). named/decimal/hex 전부 지원.
  var scratchTA = null;
  function decodeEntities(str) {
    if (str === "") return "";
    if (!scratchTA) scratchTA = document.createElement("textarea");
    scratchTA.innerHTML = str;
    return scratchTA.value;
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      codePointsOf: codePointsOf, cpToChar: cpToChar,
      encodeEntities: encodeEntities, NAMED_BY_CP: NAMED_BY_CP
    };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  function t(key) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v == null ? key : v;
  }

  /* ---- DOM ---- */
  var textEl    = document.getElementById("ec-text");
  var htmlEl    = document.getElementById("ec-html");
  var asciiEl   = document.getElementById("ec-ascii");
  var encodeBtn = document.getElementById("dir-encode");
  var decodeBtn = document.getElementById("dir-decode");
  var clearBtn  = document.getElementById("ec-clear");
  var feedback  = document.getElementById("ec-feedback");

  if (!textEl || !htmlEl) return; // 마크업이 없으면 조용히 중단(셸은 계속 동작)

  var LAST_KEY = (window.APP_CONFIG && window.APP_CONFIG.slug ? window.APP_CONFIG.slug : "html-entity-conv") + ":last";
  var ASCII_KEY = (window.APP_CONFIG && window.APP_CONFIG.slug ? window.APP_CONFIG.slug : "html-entity-conv") + ":allNonAscii";
  var dir = "encode"; // "encode" | "decode"

  /* ---- 방향 버튼 표시 ---- */
  function styleDirBtn(btn, active) {
    if (!btn) return;
    btn.style.background  = active ? "var(--accent)" : "var(--bg)";
    btn.style.color       = active ? "#fff" : "var(--ink)";
    btn.style.borderColor = active ? "var(--accent)" : "var(--line)";
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  }
  function setDir(next) {
    dir = next;
    styleDirBtn(encodeBtn, dir === "encode");
    styleDirBtn(decodeBtn, dir === "decode");
    if (asciiEl) asciiEl.parentNode.style.opacity = dir === "encode" ? "1" : ".55";
  }

  /* ---- 변환 실행 ---- */
  function convert() {
    if (dir === "encode") {
      htmlEl.value = encodeEntities(textEl.value, !!(asciiEl && asciiEl.checked));
    } else {
      textEl.value = decodeEntities(htmlEl.value);
    }
  }

  function saveState() {
    try { localStorage.setItem(LAST_KEY, textEl.value); } catch (e) { /* private mode */ }
    try { localStorage.setItem(ASCII_KEY, (asciiEl && asciiEl.checked) ? "1" : "0"); } catch (e) { /* noop */ }
  }

  /* ---- 피드백 메시지 ---- */
  var fbTimer = null;
  function showFeedback(msg) {
    if (!feedback) return;
    feedback.hidden = false;
    feedback.textContent = msg;
    if (fbTimer) clearTimeout(fbTimer);
    fbTimer = setTimeout(function () { feedback.hidden = true; }, 1800);
  }

  /* ---- 복사 ---- */
  function fallbackCopy(value) {
    try {
      var ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      showFeedback(ok ? t("tool.msg.copied") : t("tool.msg.copyError"));
    } catch (e) {
      showFeedback(t("tool.msg.copyError"));
    }
  }
  function copyText(value) {
    if (!value) { showFeedback(t("tool.msg.nothingToCopy")); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(
        function () { showFeedback(t("tool.msg.copied")); },
        function () { fallbackCopy(value); }
      );
    } else {
      fallbackCopy(value);
    }
  }

  /* ---- 이벤트 ---- */
  textEl.addEventListener("input", function () {
    if (dir !== "encode") setDir("encode");
    convert();
    saveState();
  });
  htmlEl.addEventListener("input", function () {
    if (dir !== "decode") setDir("decode");
    convert();
  });
  if (encodeBtn) encodeBtn.addEventListener("click", function () { setDir("encode"); convert(); saveState(); });
  if (decodeBtn) decodeBtn.addEventListener("click", function () { setDir("decode"); convert(); });
  if (asciiEl) asciiEl.addEventListener("change", function () { if (dir === "encode") convert(); saveState(); });
  if (clearBtn) clearBtn.addEventListener("click", function () {
    textEl.value = "";
    htmlEl.value = "";
    setDir("encode");
    try { localStorage.removeItem(LAST_KEY); } catch (e) { /* noop */ }
    if (textEl.focus) textEl.focus();
  });

  var copyBtns = document.querySelectorAll(".ec-copy");
  for (var ci = 0; ci < copyBtns.length; ci++) {
    copyBtns[ci].addEventListener("click", function () {
      var target = document.getElementById(this.getAttribute("data-copy"));
      copyText(target ? target.value : "");
    });
  }

  /* ---- 언어 전환 시 재적용할 동적 문구는 없음(피드백은 일시적) ---- */

  /* ---- 초기화 ---- */
  (function init() {
    try {
      var a = localStorage.getItem(ASCII_KEY);
      if (a === "1" && asciiEl) asciiEl.checked = true;
    } catch (e) { /* noop */ }
    try {
      var last = localStorage.getItem(LAST_KEY);
      if (typeof last === "string" && last.length > 0) textEl.value = last;
    } catch (e) { /* 손상값 무시 */ }
    setDir("encode");
    convert(); // 복원된 텍스트를 즉시 인코딩
  })();
  // TOOLJS:END
})();
