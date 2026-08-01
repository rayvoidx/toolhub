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
  var SLUG = cfg.slug || "utm-builder";
  var PREFS_KEY = SLUG + ":prefs";
  var DRAFT_KEY = SLUG + ":draft";
  var WORKER_AT = 5000;    // 이 이상이면 확인 1회 + 워커 + 진행률 + 취소
  var HARD_CAP = 50000;    // 이 이상은 생성 거부 — 조용히 잘라내지 않는다
  var TABLE_LIMIT = 200;   // 화면 테이블만 제한 (CSV 는 항상 전량)
  var MAX_FILE = 10 * 1024 * 1024;

  // ENGINE:START
  /* 순수 로직 — DOM·window 참조 0.
     이 함수의 toString() 을 그대로 Blob 워커에 심어 메인/워커가 동일 코드를 쓴다
     (로직 이중화 금지). node 단위 테스트도 이 블록만 떼어내 실행한다. */
  function makeEngine() {
    "use strict";

    var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_id", "utm_term", "utm_content"];

    /* GA4 기본 채널그룹 규칙 — support.google.com/analytics/answer/9756891.
       전부 소문자 정확일치/정규식이다. 이 대소문자 민감성이 이 도구의 존재 이유. */
    var PAID_RE = /^(.*cp.*|ppc|retargeting|paid.*)$/;
    var SHOP_CAMPAIGN_RE = /^(.*(([^a-df-z]|^)shop|shopping).*)$/;
    var VIDEO_MEDIUM_RE = /^(.*video.*)$/;
    var DISPLAY_MEDIUMS = { "display": 1, "banner": 1, "expandable": 1, "interstitial": 1, "cpm": 1 };
    var SOCIAL_MEDIUMS = { "social": 1, "social-network": 1, "social-media": 1, "sm": 1, "social network": 1, "social media": 1 };
    var EMAIL_VALUES = { "email": 1, "e-mail": 1, "e_mail": 1, "e mail": 1 };
    var REFERRAL_MEDIUMS = { "referral": 1, "app": 1, "link": 1 };

    /* 구글이 배포하는 소스 카테고리 목록(800여 개)의 '자주 쓰이는 부분집합'.
       있으면 카테고리를 단정하고, 없으면 단정하지 않고 '확인 불가'로만 알린다.
       (누락은 certain=false 로 정직하게 노출 — 오탐보다 미확인이 낫다) */
    var SOURCES = {
      "google": "search", "bing": "search", "yahoo": "search", "duckduckgo": "search",
      "baidu": "search", "naver": "search", "daum": "search", "yandex": "search",
      "ecosia": "search", "ask": "search", "aol": "search", "sogou": "search",
      "seznam": "search", "startpage": "search", "qwant": "search", "rambler": "search",
      "lycos": "search", "msn": "search", "mail.ru": "search",
      "facebook": "social", "instagram": "social", "linkedin": "social", "twitter": "social",
      "x": "social", "pinterest": "social", "reddit": "social", "tiktok": "social",
      "snapchat": "social", "vk": "social", "weibo": "social", "tumblr": "social",
      "quora": "social", "whatsapp": "social", "telegram": "social", "discord": "social",
      "threads": "social", "fb": "social", "messenger": "social", "t.co": "social",
      "lnkd.in": "social", "m.facebook.com": "social", "l.facebook.com": "social",
      "youtube": "video", "vimeo": "video", "dailymotion": "video", "twitch": "video",
      "hulu": "video", "netflix": "video",
      "amazon": "shopping", "ebay": "shopping", "etsy": "shopping", "alibaba": "shopping",
      "aliexpress": "shopping", "walmart": "shopping", "mercadolibre": "shopping",
      "shopify": "shopping", "rakuten": "shopping", "taobao": "shopping", "tmall": "shopping"
    };

    /* 문서로 확인된 오사용 → 목록에 실제로 있는 값. meta 가 대표 사례(목록에 없음). */
    var ALIAS = {
      "meta": "facebook", "meta ads": "facebook", "metaads": "facebook", "meta-ads": "facebook",
      "facebook ads": "facebook", "fb ads": "facebook", "fbads": "facebook",
      "facebook.com": "facebook", "www.facebook.com": "facebook",
      "insta": "instagram", "instagram.com": "instagram",
      "google.com": "google", "www.google.com": "google", "adwords": "google",
      "google ads": "google", "googleads": "google", "google-ads": "google", "gads": "google",
      "youtube.com": "youtube", "yt": "youtube", "linkedin.com": "linkedin",
      "twitter.com": "twitter", "x.com": "x", "tiktok.com": "tiktok", "tiktok ads": "tiktok",
      "naver.com": "naver"
    };

    function trim(s) { return String(s == null ? "" : s).replace(/^\s+|\s+$/g, ""); }

    function normalizeValue(v, opts) {
      var s = String(v == null ? "" : v);
      if (opts.trim !== false) s = trim(s);
      if (opts.lower !== false) s = s.toLowerCase();
      if (opts.sep === "-" || opts.sep === "_") s = s.replace(/\s+/g, opts.sep);
      return s;
    }

    /* 값 목록: 줄바꿈 또는 쉼표 구분. trim 은 정규화 토글의 몫이라 여기선 하지 않는다
       (공백만 있는 항목만 버린다). */
    function splitList(text) {
      var parts = String(text == null ? "" : text).replace(/\r/g, "").split(/[\n,]+/);
      var out = [];
      for (var i = 0; i < parts.length; i++) {
        if (trim(parts[i]) === "") continue;
        out.push(parts[i]);
      }
      return out;
    }

    function parseBase(line) {
      var raw = trim(line);
      if (!raw) return { ok: false, reason: "empty", raw: raw };
      if (/\s/.test(raw)) return { ok: false, reason: "space", raw: raw };
      var assumed = false, cand = raw;
      var m = /^([a-zA-Z][a-zA-Z0-9+.\-]*):\/\//.exec(cand);
      if (m) {
        var sch = m[1].toLowerCase();
        if (sch !== "http" && sch !== "https") return { ok: false, reason: "scheme", raw: raw, scheme: sch };
      } else if (/^\/\//.test(cand)) {
        cand = "https:" + cand; assumed = true;
      } else if (/^([a-zA-Z][a-zA-Z0-9+.\-]*):(?!\d)/.test(cand)) {
        // mailto: / tel: / javascript: — 호스트가 아니다 ("host:8080" 은 (?!\d) 로 제외)
        return { ok: false, reason: "scheme", raw: raw, scheme: cand.split(":")[0].toLowerCase() };
      } else {
        cand = "https://" + cand; assumed = true;
      }
      var u;
      try { u = new URL(cand); } catch (e) { return { ok: false, reason: "parse", raw: raw }; }
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return { ok: false, reason: "scheme", raw: raw, scheme: u.protocol.replace(":", "") };
      }
      var h = u.hostname;
      if (!h || (h.indexOf(".") === -1 && h !== "localhost")) return { ok: false, reason: "host", raw: raw };
      return { ok: true, href: u.href, assumed: assumed, raw: raw };
    }

    function parseBases(text) {
      var lines = String(text == null ? "" : text).split(/\r?\n/);
      var ok = [], excluded = [];
      for (var i = 0; i < lines.length; i++) {
        if (trim(lines[i]) === "") continue;
        var r = parseBase(lines[i]);
        if (r.ok) ok.push(r); else excluded.push({ line: i + 1, raw: r.raw, reason: r.reason, scheme: r.scheme });
      }
      return { ok: ok, excluded: excluded };
    }

    /* URL 조립: 기존 쿼리는 원문 그대로 보존하고(재인코딩 부작용 방지),
       utm_* 만 encodeURIComponent 로 넣거나 교체한다. 프래그먼트는 항상 맨 뒤. */
    function splitHref(href) {
      var hIdx = href.indexOf("#");
      var hash = hIdx === -1 ? "" : href.slice(hIdx);
      var noHash = hIdx === -1 ? href : href.slice(0, hIdx);
      var qIdx = noHash.indexOf("?");
      return {
        prefix: qIdx === -1 ? noHash : noHash.slice(0, qIdx),
        query: qIdx === -1 ? "" : noHash.slice(qIdx + 1),
        hash: hash
      };
    }

    function safeDecode(s) {
      try { return decodeURIComponent(String(s).replace(/\+/g, " ")); } catch (e) { return String(s); }
    }

    function assemble(href, params, opts) {
      var p = splitHref(href), pairs = [], i, j;
      if (p.query) {
        var chunks = p.query.split("&");
        for (i = 0; i < chunks.length; i++) {
          if (!chunks[i]) continue;
          var eq = chunks[i].indexOf("=");
          pairs.push({
            rawK: eq === -1 ? chunks[i] : chunks[i].slice(0, eq),
            rawV: eq === -1 ? null : chunks[i].slice(eq + 1)
          });
        }
      }
      var changes = [];
      for (var k = 0; k < UTM_KEYS.length; k++) {
        var key = UTM_KEYS[k], val = params[key];
        if (val == null || val === "") continue;   // 빈 utm_term= 는 만들지 않는다
        var idx = -1;
        for (j = 0; j < pairs.length; j++) { if (safeDecode(pairs[j].rawK) === key) { idx = j; break; } }
        if (idx === -1) { pairs.push({ rawK: key, rawV: encodeURIComponent(val) }); continue; }
        var old = pairs[idx].rawV == null ? "" : safeDecode(pairs[idx].rawV);
        if (opts.existing === "keep") {
          if (old !== val) changes.push({ key: key, mode: "kept", from: old, to: val });
        } else {
          pairs[idx].rawV = encodeURIComponent(val);
          if (old !== val) changes.push({ key: key, mode: "overwritten", from: old, to: val });
        }
      }
      var qs = [];
      for (i = 0; i < pairs.length; i++) {
        qs.push(pairs[i].rawV === null ? pairs[i].rawK : pairs[i].rawK + "=" + pairs[i].rawV);
      }
      return { url: p.prefix + (qs.length ? "?" + qs.join("&") : "") + p.hash, changes: changes };
    }

    /* GA4 기본 채널그룹 판정 — 문서의 평가 순서를 그대로 따른다.
       certain=false 는 "source 가 우리 목록에 없어 카테고리를 확인 못 했다"는 뜻(거짓 단정 금지). */
    function classify(source, medium, campaign) {
      var s = source == null ? "" : source;
      var m = medium == null ? "" : medium;
      var c = campaign == null ? "" : campaign;
      var cat = SOURCES.hasOwnProperty(s) ? SOURCES[s] : null;
      var known = (s === "") || (cat !== null);
      var paid = PAID_RE.test(m);
      var shopCamp = SHOP_CAMPAIGN_RE.test(c);
      var ch;
      if (s === "(direct)" && (m === "" || m === "(none)" || m === "(not set)")) ch = "Direct";
      else if (c.indexOf("cross-network") !== -1) ch = "Cross-network";
      else if ((cat === "shopping" || shopCamp) && paid) ch = "Paid Shopping";
      else if (cat === "search" && paid) ch = "Paid Search";
      else if (cat === "social" && paid) ch = "Paid Social";
      else if (cat === "video" && paid) ch = "Paid Video";
      else if (DISPLAY_MEDIUMS.hasOwnProperty(m)) ch = "Display";
      else if (paid) ch = "Paid Other";
      else if (cat === "shopping" || shopCamp) ch = "Organic Shopping";
      else if (cat === "social" || SOCIAL_MEDIUMS.hasOwnProperty(m)) ch = "Organic Social";
      else if (cat === "video" || VIDEO_MEDIUM_RE.test(m)) ch = "Organic Video";
      else if (cat === "search" || m === "organic") ch = "Organic Search";
      else if (REFERRAL_MEDIUMS.hasOwnProperty(m)) ch = "Referral";
      else if (EMAIL_VALUES.hasOwnProperty(s) || EMAIL_VALUES.hasOwnProperty(m)) ch = "Email";
      else if (m === "affiliate") ch = "Affiliates";
      else if (m === "audio") ch = "Audio";
      else if (s === "sms" || m === "sms") ch = "SMS";
      else if (/push$/.test(m) || m.indexOf("mobile") !== -1 || m.indexOf("notification") !== -1 || s === "firebase") ch = "Mobile Push Notifications";
      else ch = "Unassigned";
      return { channel: ch, category: cat, certain: known || ch === "Direct" || ch === "Cross-network" };
    }

    function rowNotes(row) {
      var notes = [], p = row.params, i, k;
      if (row.assumed) notes.push({ sev: "info", code: "assumedScheme" });

      var upper = [];
      for (i = 0; i < UTM_KEYS.length; i++) { k = UTM_KEYS[i]; if (p[k] && /[A-Z]/.test(p[k])) upper.push(k); }
      if (upper.length) {
        var after = classify(
          (p.utm_source || "").toLowerCase(),
          (p.utm_medium || "").toLowerCase(),
          (p.utm_campaign || "").toLowerCase()
        );
        notes.push({ sev: "err", code: "uppercase", fields: upper, now: row.channel, after: after.channel });
      }
      if (!p.utm_source) notes.push({ sev: "err", code: "missingSource" });
      if (!p.utm_medium) notes.push({ sev: "err", code: "missingMedium" });

      var aliased = false;
      if (p.utm_source) {
        var lo = p.utm_source.toLowerCase();
        if (ALIAS.hasOwnProperty(lo)) { aliased = true; notes.push({ sev: "warn", code: "aliasSource", from: p.utm_source, to: ALIAS[lo] }); }
      }
      if (p.utm_source && p.utm_medium && row.channel === "Unassigned") {
        notes.push({ sev: "warn", code: "unassigned", medium: p.utm_medium });
      }
      if (row.category && p.utm_medium !== "organic" && !PAID_RE.test(p.utm_medium || "") && row.channel.indexOf("Organic ") === 0) {
        notes.push({ sev: "info", code: "organicNotPaid", channel: row.channel, paid: "Paid " + row.channel.slice(8) });
      }
      var na = [];
      for (i = 0; i < UTM_KEYS.length; i++) {
        k = UTM_KEYS[i];
        if (p[k] && /[^\x00-\x7F]/.test(p[k])) na.push({ key: k, value: p[k], enc: encodeURIComponent(p[k]) });
      }
      if (na.length) notes.push({ sev: "info", code: "nonAscii", items: na });
      for (i = 0; i < row.changes.length; i++) {
        var chg = row.changes[i];
        notes.push({ sev: chg.mode === "kept" ? "warn" : "info", code: chg.mode, key: chg.key, from: chg.from, to: chg.to });
      }
      if (!row.certain && p.utm_source && !aliased) {
        notes.push({ sev: "info", code: "uncertain", value: p.utm_source, channel: row.channel });
      }
      return notes;
    }

    function makeRow(base, rawParams, opts) {
      var params = {};
      for (var i = 0; i < UTM_KEYS.length; i++) {
        var k = UTM_KEYS[i], v = rawParams[k];
        params[k] = (v == null || v === "") ? "" : normalizeValue(v, opts);
      }
      var a = assemble(base.href, params, opts);
      var cl = classify(params.utm_source, params.utm_medium, params.utm_campaign);
      var row = {
        base: base.raw, assumed: !!base.assumed, params: params, url: a.url, changes: a.changes,
        channel: cl.channel, category: cl.category, certain: cl.certain
      };
      row.notes = rowNotes(row);
      return row;
    }

    /* ---- 표(CSV/TSV) 파싱 — 따옴표·쉼표·개행 포함 필드를 RFC4180 대로 처리 ---- */
    function detectDelim(text) {
      var i, inQ = false, line = "";
      for (i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        if (ch === '"') inQ = !inQ;
        if (!inQ && (ch === "\n" || ch === "\r")) break;
        line += ch;
      }
      var tabs = 0, commas = 0, semis = 0;
      inQ = false;
      for (i = 0; i < line.length; i++) {
        var c = line.charAt(i);
        if (c === '"') { inQ = !inQ; continue; }
        if (inQ) continue;
        if (c === "\t") tabs++; else if (c === ",") commas++; else if (c === ";") semis++;
      }
      if (tabs > 0 && tabs >= commas && tabs >= semis) return "\t";
      if (semis > 0 && semis > commas) return ";";   // 유럽 로케일 엑셀 CSV
      if (commas > 0) return ",";
      return "\t";
    }

    function parseDelimited(text, delim) {
      var s = String(text == null ? "" : text);
      if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
      var rows = [], row = [], field = "", i = 0, inQ = false, n = s.length, started = false;
      function endField() { row.push(field); field = ""; started = false; }
      function endRow() { endField(); rows.push(row); row = []; }
      while (i < n) {
        var ch = s.charAt(i);
        if (inQ) {
          if (ch === '"') {
            if (s.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
            inQ = false; i++; continue;
          }
          if (ch === "\r") { field += "\n"; if (s.charAt(i + 1) === "\n") i++; i++; continue; }
          field += ch; i++; continue;
        }
        if (ch === '"' && !started) { inQ = true; started = true; i++; continue; }
        if (ch === delim) { endField(); i++; continue; }
        if (ch === "\r") { if (s.charAt(i + 1) === "\n") i++; endRow(); i++; continue; }
        if (ch === "\n") { endRow(); i++; continue; }
        field += ch; started = true; i++;
      }
      if (field !== "" || row.length) endRow();
      var out = [];
      for (i = 0; i < rows.length; i++) {
        var blank = true;
        for (var j = 0; j < rows[i].length; j++) { if (trim(rows[i][j]) !== "") { blank = false; break; } }
        if (!blank) out.push(rows[i]);
      }
      return out;
    }

    var HEADER_MAP = {
      "url": "url", "urls": "url", "base": "url", "base_url": "url", "base url": "url",
      "baseurl": "url", "landing": "url", "landing_page": "url", "landing page": "url",
      "link": "url", "website url": "url", "page": "url", "destination": "url",
      "utm_source": "utm_source", "source": "utm_source", "campaign source": "utm_source",
      "utm_medium": "utm_medium", "medium": "utm_medium", "campaign medium": "utm_medium",
      "utm_campaign": "utm_campaign", "campaign": "utm_campaign", "campaign name": "utm_campaign",
      "utm_id": "utm_id", "id": "utm_id", "campaign id": "utm_id",
      "utm_term": "utm_term", "term": "utm_term", "keyword": "utm_term", "campaign term": "utm_term",
      "utm_content": "utm_content", "content": "utm_content", "campaign content": "utm_content"
    };
    var DEFAULT_COLS = ["url", "utm_source", "utm_medium", "utm_campaign", "utm_id", "utm_term", "utm_content"];

    function parseTable(text) {
      var delim = detectDelim(String(text == null ? "" : text));
      var grid = parseDelimited(text, delim);
      var res = { items: [], excluded: [], headerUsed: false, cols: DEFAULT_COLS.slice(), delim: delim, missing: [] };
      if (!grid.length) return res;

      var head = grid[0], mapped = [], hits = 0, i;
      for (i = 0; i < head.length; i++) {
        var key = trim(head[i]).toLowerCase().replace(/^﻿/, "");
        var m = HEADER_MAP.hasOwnProperty(key) ? HEADER_MAP[key] : null;
        if (m) hits++;
        mapped.push(m);
      }
      var start = 0;
      if (hits >= 2) { res.headerUsed = true; res.cols = mapped; start = 1; }

      for (i = 0; i < res.cols.length; i++) { /* noop — cols 확정 */ }
      if (res.cols.indexOf("url") === -1) res.missing.push("url");
      if (res.cols.indexOf("utm_source") === -1) res.missing.push("utm_source");
      if (res.cols.indexOf("utm_medium") === -1) res.missing.push("utm_medium");

      for (i = start; i < grid.length; i++) {
        var cells = grid[i], rec = { url: "", params: {} }, c;
        for (c = 0; c < cells.length && c < res.cols.length; c++) {
          var col = res.cols[c];
          if (!col) continue;
          if (col === "url") rec.url = cells[c]; else rec.params[col] = cells[c];
        }
        var pb = parseBase(rec.url);
        if (!pb.ok) {
          res.excluded.push({ line: i + 1, raw: trim(rec.url), reason: pb.reason === "empty" ? "emptyUrl" : pb.reason, scheme: pb.scheme });
          continue;
        }
        rec.base = pb;
        res.items.push(rec);
      }
      return res;
    }

    /* ---- 조합 수 산정 (입력 즉시 호출) ---- */
    function analyze(job) {
      var out = { kind: job.kind, total: 0, baseCount: 0, excluded: [], counts: {}, missing: [], headerUsed: false };
      if (job.kind === "rows") {
        var t = parseTable(job.tableText);
        out.total = t.items.length;
        out.excluded = t.excluded;
        out.headerUsed = t.headerUsed;
        out.missing = t.missing;
        out.delim = t.delim;
        return out;
      }
      var b = parseBases(job.baseText);
      out.baseCount = b.ok.length;
      out.excluded = b.excluded;
      var n = b.ok.length;
      for (var i = 0; i < UTM_KEYS.length; i++) {
        var l = splitList((job.raw && job.raw[UTM_KEYS[i]]) || "");
        out.counts[UTM_KEYS[i]] = l.length;
        if (l.length) n *= l.length;
      }
      out.total = n;
      if (!b.ok.length) out.missing.push("url");
      if (!out.counts.utm_source) out.missing.push("utm_source");
      if (!out.counts.utm_medium) out.missing.push("utm_medium");
      return out;
    }

    /* ---- 청크 러너 — 워커/메인 폴백이 같은 인터페이스로 돌린다 ---- */
    function makeMatrixRunner(job) {
      var opts = job.opts || {};
      var b = parseBases(job.baseText);
      var bases = b.ok, lists = [], i;
      for (i = 0; i < UTM_KEYS.length; i++) {
        var l = splitList((job.raw && job.raw[UTM_KEYS[i]]) || "");
        lists.push(l.length ? l : [""]);
      }
      var dims = [bases.length];
      for (i = 0; i < lists.length; i++) dims.push(lists[i].length);
      var total = 1;
      for (i = 0; i < dims.length; i++) total *= dims[i];
      var idx = 0;
      return {
        total: total,
        excluded: b.excluded,
        done: function () { return idx; },
        next: function (limit) {
          var chunk = [], end = Math.min(idx + limit, total);
          for (; idx < end; idx++) {
            var rem = idx, coord = [], k;
            for (k = dims.length - 1; k >= 0; k--) { coord[k] = rem % dims[k]; rem = Math.floor(rem / dims[k]); }
            var params = {};
            for (k = 0; k < UTM_KEYS.length; k++) params[UTM_KEYS[k]] = lists[k][coord[k + 1]];
            chunk.push(makeRow(bases[coord[0]], params, opts));
          }
          return chunk;
        }
      };
    }

    function makeRowsRunner(job) {
      var opts = job.opts || {};
      var t = parseTable(job.tableText);
      var idx = 0;
      return {
        total: t.items.length,
        excluded: t.excluded,
        done: function () { return idx; },
        next: function (limit) {
          var chunk = [], end = Math.min(idx + limit, t.items.length);
          for (; idx < end; idx++) chunk.push(makeRow(t.items[idx].base, t.items[idx].params, opts));
          return chunk;
        }
      };
    }

    function makeRunner(job) { return job.kind === "rows" ? makeRowsRunner(job) : makeMatrixRunner(job); }

    /* ---- 중복 URL: 버리는 게 아니라 합친 사실과 건수를 남긴다 ---- */
    function dedupe(rows) {
      var seen = {}, out = [], merged = 0, i;
      for (i = 0; i < rows.length; i++) {
        var key = "u:" + rows[i].url;
        if (seen.hasOwnProperty(key)) {
          var first = out[seen[key]];
          first.mergedCount = (first.mergedCount || 1) + 1;
          if (!first.mergedFrom) first.mergedFrom = [];
          if (first.mergedFrom.length < 5) first.mergedFrom.push(signature(rows[i]));
          merged++;
          continue;
        }
        seen[key] = out.length;
        out.push(rows[i]);
      }
      for (i = 0; i < out.length; i++) {
        if (out[i].mergedCount > 1) {
          out[i].notes.push({ sev: "warn", code: "merged", n: out[i].mergedCount - 1, from: out[i].mergedFrom });
        }
      }
      return { rows: out, merged: merged };
    }

    function signature(row) {
      var parts = [row.base];
      for (var i = 0; i < UTM_KEYS.length; i++) { if (row.params[UTM_KEYS[i]]) parts.push(row.params[UTM_KEYS[i]]); }
      return parts.join(" · ");
    }

    return {
      UTM_KEYS: UTM_KEYS, SOURCES: SOURCES, ALIAS: ALIAS,
      normalizeValue: normalizeValue, splitList: splitList,
      parseBase: parseBase, parseBases: parseBases,
      detectDelim: detectDelim, parseDelimited: parseDelimited, parseTable: parseTable,
      assemble: assemble, classify: classify, makeRow: makeRow,
      analyze: analyze, makeRunner: makeRunner, dedupe: dedupe, signature: signature
    };
  }
  // ENGINE:END

  var ENGINE = makeEngine();
  var UTM_KEYS = ENGINE.UTM_KEYS;

  /* ---------------- helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function tr(key, fallback) {
    try { if (window.I18N) { var v = window.I18N.t(key); if (v != null) return v; } } catch (e) { /* i18n 미로드 */ }
    return fallback;
  }
  function fmt(s, map) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return map && map[k] != null ? String(map[k]) : m; });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(n) {
    try { return Number(n).toLocaleString(window.I18N ? window.I18N.lang() : "en"); } catch (e) { return String(n); }
  }

  var el = {
    tool: $("tool"), base: $("in-base"), region: $("in-region"), chips: $("chips"),
    rows: $("in-rows"), dropzone: $("dropzone"),
    optLower: $("opt-lower"), optTrim: $("opt-trim"), optSep: $("opt-sep"),
    optExisting: $("opt-existing"), optRemember: $("opt-remember"), storeNote: $("store-note"),
    count: $("count-line"), gen: $("btn-generate"), cancel: $("btn-cancel"),
    progWrap: $("progress-wrap"), progBar: $("progress-bar"), progText: $("progress-text"),
    result: $("result"), report: $("report"), lintBox: $("lint-box"), exBox: $("excluded-box"),
    tableWrap: $("table-wrap"), warnOnly: $("opt-warnonly"), tableTools: $("table-tools"),
    csv: $("btn-csv"), tsv: $("btn-tsv"), urls: $("btn-urls")
  };
  var fieldEls = {};
  for (var fi = 0; fi < UTM_KEYS.length; fi++) fieldEls[UTM_KEYS[fi]] = $("in-" + UTM_KEYS[fi]);

  /* ---------------- 국가·채널 프리셋 (값 채움 힌트일 뿐, 강제 아님) ---------------- */
  var REGIONS = [
    { id: "global", chips: [["google", "cpc"], ["facebook", "cpc"], ["instagram", "cpc"], ["linkedin", "cpc"], ["x", "cpc"], ["youtube", "cpc"], ["email", "email"]] },
    { id: "kr", chips: [["naver", "cpc"], ["kakao", "cpc"], ["daum", "cpc"], ["band", "cpc"]] },
    { id: "jp", chips: [["line", "cpc"], ["yahoo", "cpc"]] },
    { id: "ru", chips: [["yandex", "cpc"], ["vk", "cpc"]] },
    { id: "cn", chips: [["baidu", "cpc"], ["wechat", "cpc"]] }
  ];

  /* ---------------- 상태: localStorage 는 프리셋·토글·국가만. 입력값은 옵트인 시에만 ---------------- */
  var storageOk = true;
  function readStore(k) { try { return localStorage.getItem(k); } catch (e) { storageOk = false; return null; } }
  function writeStore(k, v) { try { localStorage.setItem(k, v); } catch (e) { storageOk = false; } }
  function dropStore(k) { try { localStorage.removeItem(k); } catch (e) { /* noop */ } }

  var prefs = { mode: "matrix", region: "", lower: true, trim: true, sep: "-", existing: "overwrite", remember: false, warnOnly: false };
  (function loadPrefs() {
    var raw = readStore(PREFS_KEY);
    if (!raw) return;
    try {
      var p = JSON.parse(raw);
      for (var k in prefs) { if (prefs.hasOwnProperty(k) && p[k] !== undefined) prefs[k] = p[k]; }
    } catch (e) { dropStore(PREFS_KEY); }
  })();
  function savePrefs() { writeStore(PREFS_KEY, JSON.stringify(prefs)); }

  function saveDraft() {
    if (!prefs.remember) { dropStore(DRAFT_KEY); return; }
    var d = { base: el.base.value, rows: el.rows.value };
    for (var i = 0; i < UTM_KEYS.length; i++) d[UTM_KEYS[i]] = fieldEls[UTM_KEYS[i]].value;
    writeStore(DRAFT_KEY, JSON.stringify(d));
  }
  function loadDraft() {
    var raw = readStore(DRAFT_KEY);
    if (!raw) return;
    try {
      var d = JSON.parse(raw);
      if (d.base) el.base.value = d.base;
      if (d.rows) el.rows.value = d.rows;
      for (var i = 0; i < UTM_KEYS.length; i++) { if (d[UTM_KEYS[i]]) fieldEls[UTM_KEYS[i]].value = d[UTM_KEYS[i]]; }
    } catch (e) { dropStore(DRAFT_KEY); }
  }

  /* ---------------- job ---------------- */
  var allRows = [], lastExcluded = [], lastMerged = 0, confirmPending = false, running = null;

  function currentOpts() {
    return { lower: !!prefs.lower, trim: !!prefs.trim, sep: prefs.sep, existing: prefs.existing };
  }
  function currentJob() {
    var job = { kind: prefs.mode, opts: currentOpts() };
    if (prefs.mode === "rows") { job.tableText = el.rows.value; return job; }
    job.baseText = el.base.value;
    job.raw = {};
    for (var i = 0; i < UTM_KEYS.length; i++) job.raw[UTM_KEYS[i]] = fieldEls[UTM_KEYS[i]].value;
    return job;
  }
  function isBlank() {
    if (prefs.mode === "rows") return ENGINE.parseTable ? !el.rows.value.replace(/\s/g, "") : true;
    if (el.base.value.replace(/\s/g, "")) return false;
    for (var i = 0; i < UTM_KEYS.length; i++) { if (fieldEls[UTM_KEYS[i]].value.replace(/\s/g, "")) return false; }
    return true;
  }

  var FIELD_LABEL = { url: "URL", utm_source: "utm_source", utm_medium: "utm_medium" };
  function missingText(missing) {
    var names = [];
    for (var i = 0; i < missing.length; i++) {
      names.push(missing[i] === "url" ? tr("tool.field.urlName", "landing page URL") : missing[i]);
    }
    return names.join(", ");
  }

  /* ---------------- 조합 수 (입력 즉시) ---------------- */
  var analysis = null, countTimer = null;
  function refreshCount() {
    confirmPending = false;
    el.gen.textContent = tr("tool.btn.generate", "Generate links");
    if (isBlank()) {
      analysis = null;
      el.count.textContent = "";
      el.gen.disabled = false;
      return;
    }
    analysis = ENGINE.analyze(currentJob());
    var parts = [];
    parts.push(fmt(tr("tool.count.label", "{n} links to generate"), { n: num(analysis.total) }));
    if (analysis.missing.length) {
      parts.push(fmt(tr("tool.count.missing", "missing: {fields}"), { fields: missingText(analysis.missing) }));
    }
    if (analysis.excluded.length) {
      parts.push(fmt(tr("tool.count.excluded", "{n} rows excluded"), { n: num(analysis.excluded.length) }));
    }
    el.count.textContent = parts.join(" · ");
    el.count.style.color = analysis.total > HARD_CAP ? "#b91c1c" : "var(--muted)";
    el.gen.disabled = false;
  }
  function queueCount() {
    if (countTimer) clearTimeout(countTimer);
    countTimer = setTimeout(function () { refreshCount(); saveDraft(); }, 180);
  }

  /* ---------------- 생성 ---------------- */
  function showMsg(html, tone) {
    el.result.innerHTML = html;
    el.result.style.color = tone === "err" ? "#b91c1c" : (tone === "muted" ? "var(--muted)" : "");
  }

  function generate() {
    if (isBlank()) {
      showMsg(esc(tr("tool.msg.empty", "Add a landing page URL plus utm_source and utm_medium — your links appear here.")), "muted");
      el.report.hidden = true;
      return;
    }
    analysis = ENGINE.analyze(currentJob());
    var total = analysis.total;

    if (total > HARD_CAP) {
      showMsg(esc(fmt(tr("tool.msg.hardCap", "{n} combinations is over the {cap} limit this tool will build in a browser tab. Nothing was cut silently — narrow a value list and try again."), { n: num(total), cap: num(HARD_CAP) })), "err");
      el.report.hidden = true;
      return;
    }
    if (total === 0) {
      var why = analysis.missing.length
        ? fmt(tr("tool.msg.zeroWhy", "0 links: {fields} is empty."), { fields: missingText(analysis.missing) })
        : tr("tool.msg.zero", "0 links — nothing to build from these inputs.");
      var extra = analysis.excluded.length
        ? " " + fmt(tr("tool.msg.zeroExcluded", "All {n} rows were excluded — see the reasons below."), { n: num(analysis.excluded.length) })
        : "";
      showMsg(esc(why + extra), "err");
      renderExcluded(analysis.excluded);
      el.report.hidden = analysis.excluded.length === 0;
      el.lintBox.innerHTML = "";
      el.tableWrap.innerHTML = "";
      el.tableTools.hidden = true;
      return;
    }
    if (total > WORKER_AT && !confirmPending) {
      confirmPending = true;
      el.gen.textContent = fmt(tr("tool.btn.confirm", "Build {n} links anyway"), { n: num(total) });
      showMsg(esc(fmt(tr("tool.msg.confirm", "{n} links is a lot — it may take a few seconds and the table only previews the first {limit}. Press again to continue."), { n: num(total), limit: num(TABLE_LIMIT) })), "muted");
      return;
    }
    confirmPending = false;
    el.gen.textContent = tr("tool.btn.generate", "Generate links");

    var job = currentJob();
    if (total <= WORKER_AT) {
      var r = ENGINE.makeRunner(job);
      finish(r.next(total), r.excluded);
      return;
    }
    startBusy(total);
    var w = tryWorker(job, total);
    if (!w) running = runOnMain(job, total);
  }

  function startBusy(total) {
    el.gen.disabled = true;
    el.cancel.hidden = false;
    el.progWrap.hidden = false;
    el.progBar.style.width = "0%";
    el.progText.textContent = fmt(tr("tool.progress", "{done} of {total}"), { done: 0, total: num(total) });
    showMsg(esc(tr("tool.msg.working", "Building links…")), "muted");
  }
  function endBusy() {
    el.gen.disabled = false;
    el.cancel.hidden = true;
    el.progWrap.hidden = true;
    running = null;
  }
  function onProgress(done, total) {
    el.progBar.style.width = (total ? Math.round((done / total) * 100) : 0) + "%";
    el.progText.textContent = fmt(tr("tool.progress", "{done} of {total}"), { done: num(done), total: num(total) });
  }

  /* 워커 소스는 makeEngine 자신의 toString() — 메인/워커 로직 이중화 없음 */
  function tryWorker(job, total) {
    if (typeof Worker !== "function" || typeof Blob !== "function" || !window.URL || !URL.createObjectURL) return null;
    var url = null, w = null;
    try {
      var src = "var E=(" + makeEngine.toString() + ")();\n" +
        "self.onmessage=function(ev){var r=E.makeRunner(ev.data.job),out=[];" +
        "function step(){var c=r.next(500),i;for(i=0;i<c.length;i++)out.push(c[i]);" +
        "self.postMessage({type:'progress',done:r.done(),total:r.total});" +
        "if(r.done()<r.total){setTimeout(step,0);}" +
        "else{self.postMessage({type:'done',rows:out,excluded:r.excluded});}}step();};";
      url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      w = new Worker(url);
    } catch (e) {
      if (url) { try { URL.revokeObjectURL(url); } catch (e2) { /* noop */ } }
      return null;   // 워커 불가 → 메인 스레드 청크 폴백
    }
    var settled = false;
    running = {
      cancel: function () {
        settled = true;
        try { w.terminate(); } catch (e) { /* noop */ }
        try { URL.revokeObjectURL(url); } catch (e) { /* noop */ }
      }
    };
    w.onmessage = function (ev) {
      var d = ev.data;
      if (d.type === "progress") { onProgress(d.done, d.total); return; }
      if (d.type === "done") {
        settled = true;
        try { URL.revokeObjectURL(url); } catch (e) { /* noop */ }
        w.terminate();
        finish(d.rows, d.excluded);
      }
    };
    w.onerror = function () {
      if (settled) return;
      settled = true;
      try { URL.revokeObjectURL(url); } catch (e) { /* noop */ }
      try { w.terminate(); } catch (e) { /* noop */ }
      running = runOnMain(job, total);   // 워커가 죽어도 조용히 실패하지 않는다
    };
    try { w.postMessage({ job: job }); } catch (e) {
      settled = true;
      try { w.terminate(); } catch (e2) { /* noop */ }
      return null;
    }
    return running;
  }

  function runOnMain(job, total) {
    var r = ENGINE.makeRunner(job), out = [], cancelled = false;
    function step() {
      if (cancelled) return;
      var c = r.next(400);
      for (var i = 0; i < c.length; i++) out.push(c[i]);
      onProgress(r.done(), r.total);
      if (r.done() < r.total) setTimeout(step, 0);
      else finish(out, r.excluded);
    }
    setTimeout(step, 0);
    return { cancel: function () { cancelled = true; } };
  }

  function finish(rows, excluded) {
    endBusy();
    var d = ENGINE.dedupe(rows);
    allRows = d.rows;
    lastMerged = d.merged;
    lastExcluded = excluded || [];
    for (var i = 0; i < allRows.length; i++) allRows[i]._i = i;
    renderAll();
  }

  /* ---------------- 렌더 ---------------- */
  function sevOf(row) {
    var s = "info";
    for (var i = 0; i < row.notes.length; i++) {
      if (row.notes[i].sev === "err") return "err";
      if (row.notes[i].sev === "warn") s = "warn";
    }
    return s;
  }
  function aggregate(rows) {
    var byCode = {}, order = [], i, j;
    for (i = 0; i < rows.length; i++) {
      var seen = {};
      for (j = 0; j < rows[i].notes.length; j++) {
        var n = rows[i].notes[j];
        if (seen[n.code]) continue;
        seen[n.code] = 1;
        if (!byCode[n.code]) { byCode[n.code] = { code: n.code, sev: n.sev, count: 0, sample: n }; order.push(n.code); }
        byCode[n.code].count++;
      }
    }
    var list = [];
    for (i = 0; i < order.length; i++) list.push(byCode[order[i]]);
    var rank = { err: 0, warn: 1, info: 2 };
    list.sort(function (a, b) { return rank[a.sev] - rank[b.sev]; });
    return list;
  }

  function noteText(agg) {
    var n = agg.sample, c = agg.code;
    if (c === "uppercase") return fmt(tr("tool.note.uppercase", "Uppercase in {fields}. GA4 stores values verbatim, so Facebook / facebook / FACEBOOK become three separate rows — and the default channel rules only match lowercase, so this row lands in {now} instead of {after}. Turn on “Force lowercase” to fix every row at once."), { fields: n.fields.join(", "), now: n.now, after: n.after });
    if (c === "missingSource") return tr("tool.note.missingSource", "utm_source is empty. GA4 needs both source and medium to decide a channel — without it the session is not attributed to your campaign.");
    if (c === "missingMedium") return tr("tool.note.missingMedium", "utm_medium is empty. GA4 needs both source and medium to decide a channel — without it the session is not attributed to your campaign.");
    if (c === "aliasSource") return fmt(tr("tool.note.aliasSource", "“{from}” is not in Google's source-category list — use “{to}”. This is the classic Meta-ads mistake: meta is not listed, facebook is, so meta lands in Referral instead of Paid Social."), { from: n.from, to: n.to });
    if (c === "unassigned") return fmt(tr("tool.note.unassigned", "utm_medium “{medium}” matches none of GA4's default channel rules, so these hits land in Unassigned. Paid placements need a medium matching cpc / ppc / retargeting / paid…"), { medium: n.medium });
    if (c === "organicNotPaid") return fmt(tr("tool.note.organicNotPaid", "This is counted as {channel}, not {paid}. GA4 only reads a placement as paid when utm_medium matches cpc / ppc / retargeting / paid… — a medium like “social” sends paid creative into the organic bucket."), { channel: n.channel, paid: n.paid });
    if (c === "nonAscii") return fmt(tr("tool.note.nonAscii", "Non-ASCII values are percent-encoded in the link ({value} → {enc}) and reports show the encoded form. Keep utm values ASCII if you want them readable in GA4."), { value: n.items[0].value, enc: n.items[0].enc });
    if (c === "overwritten") return fmt(tr("tool.note.overwritten", "{key} was already on the URL and was overwritten ({from} → {to})."), { key: n.key, from: n.from, to: n.to });
    if (c === "kept") return fmt(tr("tool.note.kept", "{key} was already on the URL and was kept as “{from}” — your value “{to}” was not applied."), { key: n.key, from: n.from, to: n.to });
    if (c === "uncertain") return fmt(tr("tool.note.uncertain", "We could not verify “{value}” against Google's source-category list — this tool ships a curated subset of it. If it is not a known search / social / video / shopping network, {channel} is correct."), { value: n.value, channel: n.channel });
    if (c === "merged") return tr("tool.note.merged", "Different value combinations produced a URL that already existed. Duplicates were merged, and the row shows how many were folded in.");
    if (c === "assumedScheme") return tr("tool.note.assumedScheme", "No scheme on the URL — https:// was assumed.");
    return c;
  }

  var SEV_STYLE = {
    err: "border-left:3px solid #dc2626;background:color-mix(in srgb,#dc2626 7%,transparent);",
    warn: "border-left:3px solid #d97706;background:color-mix(in srgb,#d97706 7%,transparent);",
    info: "border-left:3px solid var(--line);"
  };
  var SEV_LABEL = { err: "tool.sev.err", warn: "tool.sev.warn", info: "tool.sev.info" };
  var SEV_FALLBACK = { err: "Breaks tracking", warn: "Check this", info: "For your info" };

  function renderNotes(rows) {
    var list = aggregate(rows);
    if (!list.length) {
      el.lintBox.innerHTML = '<p style="margin:14px 0 0;color:var(--muted);font-size:14px;">' +
        esc(tr("tool.lint.clean", "No GA4 problems found in these links.")) + "</p>";
      return;
    }
    var h = '<h3 style="font-size:15px;margin:16px 0 8px;">' + esc(tr("tool.lint.heading", "GA4 check")) + "</h3>";
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      h += '<div style="' + SEV_STYLE[a.sev] + 'border-radius:0 8px 8px 0;padding:8px 12px;margin-bottom:6px;font-size:13.5px;line-height:1.6;">' +
        '<strong style="font-size:13px;">' + esc(tr(SEV_LABEL[a.sev], SEV_FALLBACK[a.sev])) + "</strong> · " +
        '<span style="color:var(--muted);">' + esc(fmt(tr("tool.lint.rowCount", "{n} links"), { n: num(a.count) })) + "</span><br>" +
        esc(noteText(a)) + "</div>";
    }
    el.lintBox.innerHTML = h;
  }

  var EX_FALLBACK = {
    scheme: "not an http(s) address",
    space: "contains a space — split it or encode it",
    parse: "could not be parsed as a URL",
    host: "no valid host name",
    emptyUrl: "the URL cell is empty"
  };
  function renderExcluded(ex) {
    if (!ex || !ex.length) { el.exBox.innerHTML = ""; return; }
    var h = '<h3 style="font-size:15px;margin:16px 0 8px;">' +
      esc(fmt(tr("tool.excluded.heading", "{n} rows excluded"), { n: num(ex.length) })) + "</h3>" +
      '<p style="margin:0 0 8px;color:var(--muted);font-size:13px;">' +
      esc(tr("tool.excluded.lede", "These lines were not turned into links. Nothing was dropped silently — fix them and generate again.")) + "</p>" +
      '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;"><tbody>';
    for (var i = 0; i < ex.length && i < 50; i++) {
      h += '<tr><td style="padding:5px 8px;border-bottom:1px solid var(--line);color:var(--muted);white-space:nowrap;">' +
        esc(fmt(tr("tool.excluded.line", "line {n}"), { n: ex[i].line })) + "</td>" +
        '<td style="padding:5px 8px;border-bottom:1px solid var(--line);word-break:break-all;"><code>' + esc(ex[i].raw || "—") + "</code></td>" +
        '<td style="padding:5px 8px;border-bottom:1px solid var(--line);color:#b45309;">' +
        esc(tr("tool.excluded." + ex[i].reason, EX_FALLBACK[ex[i].reason] || ex[i].reason)) + "</td></tr>";
    }
    h += "</tbody></table></div>";
    if (ex.length > 50) {
      h += '<p style="margin:8px 0 0;color:var(--muted);font-size:13px;">' +
        esc(fmt(tr("tool.excluded.more", "…and {n} more."), { n: num(ex.length - 50) })) + "</p>";
    }
    el.exBox.innerHTML = h;
  }

  function viewRows() {
    if (!prefs.warnOnly) return allRows;
    var out = [];
    for (var i = 0; i < allRows.length; i++) { if (sevOf(allRows[i]) !== "info") out.push(allRows[i]); }
    return out;
  }

  var DOT = { err: "#dc2626", warn: "#d97706", info: "transparent" };
  function renderTable() {
    var rows = viewRows();
    if (!rows.length) {
      el.tableWrap.innerHTML = '<p style="margin:14px 0 0;color:var(--muted);font-size:14px;">' +
        esc(tr("tool.table.noneShown", "No links match this filter.")) + "</p>";
      return;
    }
    var cols = [
      ["tool.table.base", "Landing page"], ["tool.table.source", "utm_source"],
      ["tool.table.medium", "utm_medium"], ["tool.table.campaign", "utm_campaign"],
      ["tool.table.channel", "GA4 channel"], ["tool.table.url", "Tagged URL"], ["tool.table.copy", "Copy"]
    ];
    var h = '<div style="overflow-x:auto;margin-top:14px;-webkit-overflow-scrolling:touch;">' +
      '<table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:720px;"><thead><tr>';
    for (var c = 0; c < cols.length; c++) {
      h += '<th style="text-align:start;padding:6px 8px;border-bottom:1px solid var(--line);color:var(--muted);font-weight:700;white-space:nowrap;">' +
        esc(tr(cols[c][0], cols[c][1])) + "</th>";
    }
    h += "</tr></thead><tbody>";
    var lim = Math.min(rows.length, TABLE_LIMIT);
    for (var i = 0; i < lim; i++) {
      var r = rows[i], sev = sevOf(r);
      var chTxt = esc(r.channel) + (r.certain ? "" : '<span title="' + esc(tr("tool.table.uncertainTip", "Source not in our copy of Google's list — channel is a best guess.")) + '" style="color:var(--muted);"> ≈</span>');
      var merged = r.mergedCount > 1 ? ' <span style="color:var(--muted);">' + esc(fmt(tr("tool.table.merged", "+{n} merged"), { n: r.mergedCount - 1 })) + "</span>" : "";
      h += '<tr>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--line);word-break:break-all;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + DOT[sev] + ';margin-inline-end:5px;vertical-align:middle;"></span>' + esc(r.base) + "</td>" +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--line);word-break:break-all;">' + esc(r.params.utm_source || "—") + "</td>" +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--line);word-break:break-all;">' + esc(r.params.utm_medium || "—") + "</td>" +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--line);word-break:break-all;">' + esc(r.params.utm_campaign || "—") + merged + "</td>" +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap;' + (r.channel === "Unassigned" ? "color:#b91c1c;" : "") + '">' + chTxt + "</td>" +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--line);word-break:break-all;"><code style="font-size:12px;">' + esc(r.url) + "</code></td>" +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--line);"><button type="button" data-copy="' + r._i + '" style="border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:6px;padding:4px 8px;font-family:inherit;font-size:12px;cursor:pointer;white-space:nowrap;">' + esc(tr("tool.table.copy", "Copy")) + "</button></td></tr>";
    }
    h += "</tbody></table></div>";
    if (rows.length > lim) {
      h += '<p style="margin:10px 0 0;color:var(--muted);font-size:13px;">' +
        esc(fmt(tr("tool.table.previewNote", "Previewing the first {shown} of {total} links — the CSV download always contains every one."), { shown: num(lim), total: num(rows.length) })) + "</p>";
    }
    el.tableWrap.innerHTML = h;
  }

  function renderAll() {
    var extra = [];
    if (lastMerged) extra.push(fmt(tr("tool.summary.merged", "{n} duplicates merged"), { n: num(lastMerged) }));
    if (lastExcluded.length) extra.push(fmt(tr("tool.summary.excluded", "{n} rows excluded"), { n: num(lastExcluded.length) }));
    var errs = 0;
    for (var i = 0; i < allRows.length; i++) { if (sevOf(allRows[i]) === "err") errs++; }
    if (errs) extra.push(fmt(tr("tool.summary.errors", "{n} would break tracking"), { n: num(errs) }));
    showMsg('<strong>' + esc(num(allRows.length)) + "</strong> " + esc(tr("tool.summary.plain", "links ready")) +
      (extra.length ? ' <span style="font-size:14px;color:var(--muted);">· ' + esc(extra.join(" · ")) + "</span>" : ""), "");
    renderNotes(allRows);
    renderExcluded(lastExcluded);
    renderTable();
    el.tableTools.hidden = false;
    el.report.hidden = false;
  }

  /* ---------------- 내보내기 ---------------- */
  var EXPORT_HEAD = ["base_url", "utm_source", "utm_medium", "utm_campaign", "utm_id", "utm_term", "utm_content", "ga4_default_channel", "issues", "tagged_url"];
  function issueCodes(r) {
    var out = [];
    for (var i = 0; i < r.notes.length; i++) { if (r.notes[i].sev !== "info") out.push(r.notes[i].code); }
    return out.join(" ");
  }
  function rowCells(r) {
    var cells = [r.base];
    for (var i = 0; i < UTM_KEYS.length; i++) cells.push(r.params[UTM_KEYS[i]]);
    cells.push(r.channel + (r.certain ? "" : " (unverified)"));
    cells.push(issueCodes(r));
    cells.push(r.url);
    return cells;
  }
  function csvCell(s) {
    s = String(s == null ? "" : s);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(rows) {
    var lines = [EXPORT_HEAD.map(csvCell).join(",")];
    for (var i = 0; i < rows.length; i++) lines.push(rowCells(rows[i]).map(csvCell).join(","));
    return "﻿" + lines.join("\r\n");   // BOM — 엑셀 한글 깨짐 방지
  }
  function toTSV(rows) {
    var lines = [EXPORT_HEAD.join("\t")];
    for (var i = 0; i < rows.length; i++) {
      lines.push(rowCells(rows[i]).map(function (c) { return String(c == null ? "" : c).replace(/[\t\r\n]+/g, " "); }).join("\t"));
    }
    return lines.join("\n");
  }
  function toURLs(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) out.push(rows[i].url);
    return out.join("\n");
  }
  function download(text, name, mime) {
    try {
      var blob = new Blob([text], { type: mime });
      var a = document.createElement("a");
      var u = URL.createObjectURL(blob);
      a.href = u; a.download = name; a.style.display = "none";
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(u); }, 0);
      return true;
    } catch (e) { return false; }
  }
  function flash(btn, key, fallback) {
    var old = btn.getAttribute("data-label") || btn.textContent;
    btn.setAttribute("data-label", old);
    btn.textContent = tr(key, fallback);
    setTimeout(function () { btn.textContent = btn.getAttribute("data-label") || old; }, 1300);
  }
  function copyText(text, btn) {
    function ok() { flash(btn, "tool.copied", "Copied"); }
    function bad() {
      flash(btn, "tool.copyFail", "Copy blocked");
      showMsg(esc(tr("tool.msg.copyFail", "Your browser blocked clipboard access. Use the CSV download instead.")), "err");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () { if (!legacyCopy(text)) bad(); else ok(); });
      return;
    }
    if (legacyCopy(text)) ok(); else bad();
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      var done = document.execCommand("copy");
      document.body.removeChild(ta);
      return done;
    } catch (e) { return false; }
  }
  function needRows(btn) {
    if (allRows.length) return true;
    showMsg(esc(tr("tool.msg.nothingToExport", "Generate some links first — there is nothing to export yet.")), "err");
    return false;
  }

  /* ---------------- CSV 드래그앤드롭 (File API, 업로드 없음) ---------------- */
  function decodeBytes(buf) {
    var bytes = new Uint8Array(buf);
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return new TextDecoder("utf-8").decode(bytes);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (e) {
      // 한국 엑셀이 저장한 CSV 는 대개 EUC-KR — 깨진 채 진행하지 않는다
      try { return new TextDecoder("euc-kr").decode(bytes); } catch (e2) { return new TextDecoder("utf-8").decode(bytes); }
    }
  }
  function loadFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE) {
      showMsg(esc(fmt(tr("tool.msg.fileTooBig", "{name} is {size} MB — over the {max} MB limit. Split it and drop the parts."), {
        name: file.name, size: (file.size / 1048576).toFixed(1), max: MAX_FILE / 1048576
      })), "err");
      return;
    }
    var done = function (buf) {
      var text;
      try { text = decodeBytes(buf); } catch (e) {
        showMsg(esc(tr("tool.msg.fileRead", "That file could not be read as text.")), "err");
        return;
      }
      setMode("rows");
      el.rows.value = text;
      refreshCount();
      saveDraft();
      showMsg(esc(fmt(tr("tool.msg.fileLoaded", "Loaded {name} — {n} rows. It stays in this tab; nothing is uploaded."), {
        name: file.name, n: num(analysis ? analysis.total : 0)
      })), "muted");
      el.report.hidden = true;
    };
    if (file.arrayBuffer) {
      file.arrayBuffer().then(done, function () {
        showMsg(esc(tr("tool.msg.fileRead", "That file could not be read as text.")), "err");
      });
      return;
    }
    var fr = new FileReader();
    fr.onload = function () { done(fr.result); };
    fr.onerror = function () { showMsg(esc(tr("tool.msg.fileRead", "That file could not be read as text.")), "err"); };
    try { fr.readAsArrayBuffer(file); } catch (e) {
      showMsg(esc(tr("tool.msg.fileRead", "That file could not be read as text.")), "err");
    }
  }

  /* ---------------- 모드 · 프리셋 ---------------- */
  function setMode(m) {
    prefs.mode = m; savePrefs();
    var isRows = m === "rows";
    $("panel-matrix").hidden = isRows;
    $("panel-rows").hidden = !isRows;
    $("base-field").hidden = isRows;
    var bm = $("tabbtn-matrix"), br = $("tabbtn-rows");
    bm.setAttribute("aria-selected", isRows ? "false" : "true");
    br.setAttribute("aria-selected", isRows ? "true" : "false");
    bm.style.background = isRows ? "transparent" : "var(--accent)";
    bm.style.color = isRows ? "var(--ink)" : "#fff";
    br.style.background = isRows ? "var(--accent)" : "transparent";
    br.style.color = isRows ? "#fff" : "var(--ink)";
    $("tab-hint").textContent = isRows
      ? tr("tool.tab.hintRows", "One row per link. Paste a table straight from your spreadsheet, or drop a CSV anywhere on this card.")
      : tr("tool.tab.hintMatrix", "One value per line. Every combination of your values becomes a link.");
    refreshCount();
  }

  function regionOf(id) {
    for (var i = 0; i < REGIONS.length; i++) { if (REGIONS[i].id === id) return REGIONS[i]; }
    return REGIONS[0];
  }
  function buildRegionSelect() {
    var cur = prefs.region || guessRegion();
    el.region.innerHTML = "";
    for (var i = 0; i < REGIONS.length; i++) {
      var o = document.createElement("option");
      o.value = REGIONS[i].id;
      o.textContent = tr("tool.region." + REGIONS[i].id, REGIONS[i].id.toUpperCase());
      el.region.appendChild(o);
    }
    el.region.value = cur;
  }
  function guessRegion() {
    var l = "";
    try { l = (window.I18N && window.I18N.lang()) || (navigator.language || "").slice(0, 2); } catch (e) { /* noop */ }
    if (l === "ko") return "kr";
    if (l === "ja") return "jp";
    if (l === "ru") return "ru";
    if (l === "zh") return "cn";
    return "global";
  }
  function renderChips() {
    var reg = regionOf(el.region.value);
    var h = "";
    for (var i = 0; i < reg.chips.length; i++) {
      var s = reg.chips[i][0], m = reg.chips[i][1];
      var cl = ENGINE.classify(s, m, "");
      var tip = "utm_source=" + s + " · utm_medium=" + m + " → " + cl.channel + (cl.certain ? "" : " (?)");
      h += '<button type="button" data-chip-s="' + esc(s) + '" data-chip-m="' + esc(m) + '" title="' + esc(tip) + '" ' +
        'style="padding:6px 12px;border:1px solid var(--line);border-radius:999px;background:var(--bg);color:var(--ink);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;">' +
        esc(s) + '<span style="color:var(--muted);font-weight:400;"> · ' + esc(m) + "</span></button>";
    }
    el.chips.innerHTML = h;
  }
  function addValue(input, v) {
    var cur = ENGINE.splitList(input.value);
    for (var i = 0; i < cur.length; i++) { if (cur[i].replace(/^\s+|\s+$/g, "") === v) return; }
    cur.push(v);
    input.value = cur.join("\n");
  }

  /* ---------------- 이벤트 ---------------- */
  $("tabbtn-matrix").addEventListener("click", function () { setMode("matrix"); });
  $("tabbtn-rows").addEventListener("click", function () { setMode("rows"); });
  el.chips.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("[data-chip-s]") : null;
    if (!b) return;
    addValue(fieldEls.utm_source, b.getAttribute("data-chip-s"));
    addValue(fieldEls.utm_medium, b.getAttribute("data-chip-m"));
    refreshCount(); saveDraft();
  });
  el.region.addEventListener("change", function () {
    prefs.region = el.region.value; savePrefs(); renderChips();
  });
  el.base.addEventListener("input", queueCount);
  el.rows.addEventListener("input", queueCount);
  for (var k = 0; k < UTM_KEYS.length; k++) fieldEls[UTM_KEYS[k]].addEventListener("input", queueCount);

  el.optLower.addEventListener("change", function () { prefs.lower = el.optLower.checked; savePrefs(); refreshCount(); });
  el.optTrim.addEventListener("change", function () { prefs.trim = el.optTrim.checked; savePrefs(); refreshCount(); });
  el.optSep.addEventListener("change", function () { prefs.sep = el.optSep.value; savePrefs(); refreshCount(); });
  el.optExisting.addEventListener("change", function () { prefs.existing = el.optExisting.value; savePrefs(); refreshCount(); });
  el.optRemember.addEventListener("change", function () {
    prefs.remember = el.optRemember.checked; savePrefs();
    if (prefs.remember) saveDraft(); else dropStore(DRAFT_KEY);
  });
  el.warnOnly.addEventListener("change", function () {
    prefs.warnOnly = el.warnOnly.checked; savePrefs(); renderTable();
  });

  el.gen.addEventListener("click", generate);
  el.cancel.addEventListener("click", function () {
    if (running && running.cancel) running.cancel();
    endBusy();
    showMsg(esc(tr("tool.msg.cancelled", "Cancelled — nothing was generated.")), "muted");
  });
  el.tableWrap.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("[data-copy]") : null;
    if (!b) return;
    var r = allRows[Number(b.getAttribute("data-copy"))];
    if (r) copyText(r.url, b);
  });
  el.csv.addEventListener("click", function () {
    if (!needRows()) return;
    if (!download(toCSV(allRows), SLUG + "-" + new Date().toISOString().slice(0, 10) + ".csv", "text/csv;charset=utf-8")) {
      showMsg(esc(tr("tool.msg.downloadFail", "Your browser blocked the download. Copy the TSV instead.")), "err");
    }
  });
  el.tsv.addEventListener("click", function () { if (needRows()) copyText(toTSV(allRows), el.tsv); });
  el.urls.addEventListener("click", function () { if (needRows()) copyText(toURLs(allRows), el.urls); });

  var dragDepth = 0;
  function dragOn(on) { el.tool.style.outline = on ? "2px dashed var(--accent)" : ""; el.tool.style.outlineOffset = on ? "-6px" : ""; }
  el.tool.addEventListener("dragenter", function (ev) { ev.preventDefault(); dragDepth++; dragOn(true); });
  el.tool.addEventListener("dragover", function (ev) { ev.preventDefault(); if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy"; });
  el.tool.addEventListener("dragleave", function () { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dragOn(false); });
  el.tool.addEventListener("drop", function (ev) {
    ev.preventDefault(); dragDepth = 0; dragOn(false);
    var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  $("file-input").addEventListener("change", function (ev) {
    if (ev.target.files && ev.target.files[0]) loadFile(ev.target.files[0]);
    ev.target.value = "";
  });

  document.addEventListener("i18n:change", function () {
    buildRegionSelect(); renderChips(); setMode(prefs.mode);
    if (allRows.length) renderAll();
    else if (isBlank()) showMsg(esc(tr("tool.msg.empty", "Add a landing page URL plus utm_source and utm_medium — your links appear here.")), "muted");
    if (!storageOk && el.storeNote) el.storeNote.textContent = tr("tool.msg.noStorage", "Private mode: your options can't be saved between visits.");
  });

  /* ---------------- init ---------------- */
  (function init() {
    buildRegionSelect();
    prefs.region = el.region.value;
    renderChips();
    el.optLower.checked = !!prefs.lower;
    el.optTrim.checked = !!prefs.trim;
    el.optSep.value = prefs.sep;
    el.optExisting.value = prefs.existing;
    el.optRemember.checked = !!prefs.remember;
    el.warnOnly.checked = !!prefs.warnOnly;
    if (prefs.remember) loadDraft();
    setMode(prefs.mode === "rows" ? "rows" : "matrix");
    showMsg(esc(tr("tool.msg.empty", "Add a landing page URL plus utm_source and utm_medium — your links appear here.")), "muted");
    if (!storageOk && el.storeNote) {
      el.storeNote.hidden = false;
      el.storeNote.textContent = tr("tool.msg.noStorage", "Private mode: your options can't be saved between visits.");
    }
  })();
  // TOOLJS:END
})();
