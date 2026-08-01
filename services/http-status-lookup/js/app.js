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

  // Cloudflare Web Analytics — 쿠키리스·페이지뷰만. 토큰 설정 시에만 로드.
  // 실패해도 본 기능에 영향 없게 격리 (safeTrack 원칙 — 부가 기능은 본 기능과 격리, 철칙 5)
  // 수집 범위는 privacy.html §3 과 일치해야 한다. 도구 입력값은 절대 실리지 않는다(§1 약속).
  if (cfg.analytics && cfg.analytics.cfBeaconToken) {
    try {
      var s = document.createElement("script");
      s.defer = true;
      s.src = "https://static.cloudflareinsights.com/beacon.min.js";
      s.setAttribute("data-cf-beacon", JSON.stringify({ token: cfg.analytics.cfBeaconToken }));
      document.head.appendChild(s);
    } catch (e) { /* 분석 실패는 조용히 무시 — 본 기능에 영향 없음 */ }
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
  var $ = function (id) { return document.getElementById(id); };
  var codeEl = $("code"), result = $("result"), errEl = $("err"), reflist = $("reflist"), chips = $("chips");
  if (!codeEl || !reflist || !chips) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // [code, name, meaning, where to look] — IANA 표준 코드만 baked. 설명은 RFC·개발자도구 표기와 맞추려 영어 고정.
  var CODES = [
    [100,"Continue","The server has read the request headers and is happy for the client to send the body. It appears when a client sends an Expect: 100-continue header before uploading something large. Browsers almost never show it.","Nothing to fix, it is an interim response. If an upload stalls here, look at the server or a proxy that does not handle Expect correctly."],
    [101,"Switching Protocols","The server agrees to change protocol on the same connection, in practice almost always from HTTP to WebSocket. The client asked with an Upgrade header and the server accepted.","Expected during a WebSocket handshake. If it never arrives, a proxy or load balancer is probably stripping the Upgrade header."],
    [102,"Processing","A WebDAV holding message: the server accepted a long-running request and is still working on it. It exists to stop the client timing out while it waits.","Informational only. Modern servers prefer 103 Early Hints or a streamed response."],
    [103,"Early Hints","The server sends Link headers early so the browser can start preloading CSS, fonts and scripts before the real response is ready. The final status code still follows.","Nothing is broken. If preloads are ignored, check that the client and the CDN in front of it both support Early Hints."],
    [200,"OK","The request succeeded and the body holds what was asked for. For a GET that is the resource itself, for a POST it is the result of the action.","Nothing to fix. If a 200 arrives carrying an error message in the body, the API is hiding failures behind a success code and that belongs on the server fix list."],
    [201,"Created","The request succeeded and a new resource now exists. The Location header should point at the thing that was created.","The correct answer to a POST that creates something. A missing Location header is a server-side omission."],
    [202,"Accepted","The request was accepted for processing but nothing has finished yet. Common for queued jobs, batch imports and asynchronous APIs.","Poll the status URL the server returned. A 202 that never resolves is a worker or queue problem on the server."],
    [203,"Non-Authoritative Information","The request succeeded, but a proxy modified the response that the origin server sent. Rare in practice.","Look at the transforming proxy or CDN if the body is not what the origin actually produced."],
    [204,"No Content","The request succeeded and there is deliberately no body to return. Typical for DELETE and for saves that need no response payload.","Nothing to fix. If your front end renders an empty screen, it is reading a body that was never meant to exist."],
    [205,"Reset Content","Success, and the client should clear the form that produced the request. Almost never used by modern applications.","Instruction for the client; nothing to change on the server."],
    [206,"Partial Content","The server returned only the byte range the client asked for. This powers video seeking, resumable downloads and range requests.","Expected whenever a Range header is sent. If media will not seek, check that the server supports ranges and that no proxy buffers the whole file."],
    [207,"Multi-Status","A WebDAV response whose body carries several status codes, one per sub-operation.","Parse the XML body: individual parts may have failed even though the overall request returned 207."],
    [208,"Already Reported","A WebDAV binding was already listed earlier in the same response, so its members are not repeated.","Internal WebDAV bookkeeping; nothing to fix."],
    [226,"IM Used","The server applied one or more instance manipulations, such as delta encoding, and returned the result. Effectively unused on the public web.","Nothing to fix unless you deliberately run delta encoding."],
    [300,"Multiple Choices","More than one representation exists and the server wants the client to pick. Almost never used because there is no standard way for a browser to choose automatically.","A server-side design decision. Prefer returning one canonical resource with a 301 or 302 instead."],
    [301,"Moved Permanently","The resource has a new home and clients should use the new URL from now on. Browsers cache this aggressively and search engines pass ranking signals to the target.","The right code for a permanent move. Wrong targets are painful to undo because of that caching, so test with curl before shipping."],
    [302,"Found","A temporary redirect. The original URL stays canonical, so clients are expected to keep asking for it next time.","Fine for temporary detours such as a maintenance page. If the move is permanent, 301 or 308 is the correct code for SEO."],
    [303,"See Other","After a POST, fetch a different URL with GET. This is the classic post/redirect/get pattern that stops a page refresh resubmitting a form.","Working as designed. Note that the method always changes to GET, which is the whole point."],
    [304,"Not Modified","The cached copy the client already holds is still valid, so no body is sent. It is a bandwidth saving, not an error.","Nothing to fix. If you expected fresh content, the client sent If-None-Match or If-Modified-Since and the server agreed, so change the URL or the ETag to bust the cache."],
    [305,"Use Proxy","The resource must be reached through the proxy named in the response. Deprecated for security reasons and ignored by browsers.","Do not use it. Configure proxies at the client or network layer instead."],
    [306,"Unused","Reserved. It was defined in an early draft, withdrawn, and no server should return it today.","If you actually see one, something in the path is generating non-standard responses."],
    [307,"Temporary Redirect","Like 302, except the method and body must be preserved, so a POST stays a POST.","Prefer 307 over 302 for APIs, so a redirect cannot silently turn a POST into a GET."],
    [308,"Permanent Redirect","Like 301, except the method and body are preserved. Permanent, cacheable and safe for POST.","The correct code for permanent API moves and for HTTP to HTTPS on endpoints that accept more than GET."],
    [400,"Bad Request","The server could not understand the request at all: malformed JSON, a broken header, an impossible parameter. It is the generic client error used when nothing more specific fits.","Client side. Log the exact body and headers you sent, since many APIs put the parse error in the response body."],
    [401,"Unauthorized","Authentication is missing or has failed. Despite the name it means unauthenticated: the server does not know who you are. A WWW-Authenticate header should say how to log in.","Client side. Send or refresh the token, cookie or API key. A logged-in user seeing 401 usually has an expired session."],
    [402,"Payment Required","Reserved for future use in the original specification, now used by some APIs to signal a billing problem or an exhausted paid quota.","Check the account status with the provider. The fix lives in billing, not in the code."],
    [403,"Forbidden","The server knows who you are and refuses anyway. Authentication is fine, permission is not, so repeating the request with the same credentials will not help.","Permissions, ownership or firewall rules, usually server side. On static hosting a 403 often means a missing index file or wrong file permissions."],
    [404,"Not Found","There is nothing at this URL. The server will not say whether it never existed or was removed, which also lets it hide resources from people who should not know they exist.","Check the path, the capitalisation and the trailing slash first. If the URL is right, the resource moved or the route was never registered on the server."],
    [405,"Method Not Allowed","The URL exists but not for this verb, for example a POST to a GET-only endpoint. The Allow header lists what is permitted.","Read the Allow header and change the method. On the server this usually means the route was registered for only one verb."],
    [406,"Not Acceptable","The server cannot produce any of the formats listed in the client Accept header. Rare, because most servers simply send their default format.","Client side: relax or correct the Accept header. Server side: add the content type the client actually wants."],
    [407,"Proxy Authentication Required","Like 401, except the challenge comes from a proxy between client and server rather than from the server itself.","Corporate networks and captive portals produce this. Supply proxy credentials or check the network proxy settings."],
    [408,"Request Timeout","The client opened a connection and then took too long to send the request, so the server stopped waiting.","Usually a slow or dropped client connection. Retrying is safe; if it repeats, look at the network path or an over-aggressive server timeout."],
    [409,"Conflict","The request clashes with the current state of the resource: an edit against a stale version, a duplicate unique value, two writers at once.","Refetch the resource, merge the change and retry. A blind retry just repeats the same conflict."],
    [410,"Gone","The resource was here and has been deliberately removed with no forwarding address. Unlike 404 it is a promise that it will not come back.","Intentional on the server. Use it when you want pages dropped from search indexes faster than a 404 achieves."],
    [411,"Length Required","The server refuses the request because it carries no Content-Length header.","Client side: send Content-Length, or use chunked transfer encoding if the server accepts it."],
    [412,"Precondition Failed","A conditional header such as If-Match did not hold, so the server refused rather than overwrite something.","Optimistic locking working as designed. Refetch the current ETag and retry with it."],
    [413,"Content Too Large","The request body is bigger than the server will accept. It was called Payload Too Large in older specifications.","Raise the limit on the server (client_max_body_size in nginx, upload_max_filesize in PHP) or upload in smaller chunks."],
    [414,"URI Too Long","The URL exceeds what the server will parse, usually a GET that should have been a POST or a redirect loop piling up query strings.","Move the parameters into a request body. Server limits are typically 4 KB to 8 KB."],
    [415,"Unsupported Media Type","The server will not accept the Content-Type of the body, for example form data sent to a JSON-only endpoint.","Client side: set the Content-Type the API documents, most often application/json."],
    [416,"Range Not Satisfiable","The requested byte range lies outside the file. Common when a resumed download continues against a file that changed size.","Restart the download from zero, or ask the server for the current length first with a HEAD request."],
    [417,"Expectation Failed","The server cannot meet the Expect header the client sent, which in practice is always Expect: 100-continue.","Drop the Expect header, or check whether a proxy in the path fails to support it."],
    [418,"I'm a Teapot","An April Fools joke from 1998 that servers still implement for fun. It is a genuinely registered code and means the server refuses to brew coffee because it is a teapot.","Not a real failure. Some services also return it to bots they want to turn away politely."],
    [421,"Misdirected Request","The connection reached a server that cannot answer for this hostname, typically after HTTP/2 reused one connection for several domains on the same IP address.","Server side: certificate or virtual host configuration. Clients should retry on a fresh connection."],
    [422,"Unprocessable Content","The syntax is valid but the content fails validation: well-formed JSON with a missing required field or an invalid email address.","Client side: read the validation errors in the response body and fix the values, not the format."],
    [423,"Locked","The WebDAV resource is locked by another client and cannot be changed right now.","Wait for the lock to expire, or release it explicitly if you own it."],
    [424,"Failed Dependency","The request failed only because an earlier request it depended on failed.","Fix the upstream request; this one will succeed on its own once the dependency does."],
    [425,"Too Early","The server refuses to process a request replayed in TLS early data, because such replays could be malicious.","Client side: retry once the handshake is complete, without 0-RTT early data."],
    [426,"Upgrade Required","The server will only speak a newer protocol, typically insisting on TLS or on HTTP/2.","Client side: upgrade the connection as described in the Upgrade header the server sent."],
    [428,"Precondition Required","The server refuses unconditional writes and demands an If-Match header, so two clients cannot silently overwrite each other.","Client side: fetch the current ETag first and send it with the update."],
    [429,"Too Many Requests","The client has exceeded a rate limit. A Retry-After header usually says how long to wait before trying again.","Client side: back off, honour Retry-After and use exponential backoff with jitter instead of hammering the endpoint."],
    [431,"Request Header Fields Too Large","The headers, or one single header, exceed the server limit. Oversized cookies are the usual culprit.","Clear cookies for the domain and trim custom headers. Raise the header buffer limits on the server if the size is legitimate."],
    [451,"Unavailable For Legal Reasons","Access is blocked because of a legal demand: a court order, a takedown notice, a regional restriction. The number is a nod to Fahrenheit 451.","Nothing to fix technically. The response should name the authority making the demand."],
    [500,"Internal Server Error","The server hit an unhandled error and cannot say more. It is the catch-all for crashes, uncaught exceptions and broken configuration.","Server side, always. The real cause sits in the application log or stack trace, and the browser will never show it to you."],
    [501,"Not Implemented","The server does not support the functionality needed to fulfil the request, usually an unrecognised method.","Server side: the capability has not been built. Unlike 405 this is about the server as a whole, not about one URL."],
    [502,"Bad Gateway","A proxy or load balancer received an invalid response from the server behind it. The front door is up but the application behind it crashed, is not listening, or replied with garbage.","Server side: check that the upstream process is running on the expected port, then check the proxy upstream configuration."],
    [503,"Service Unavailable","The server is up but cannot handle the request right now, because it is overloaded, out of workers, or deliberately in maintenance mode. It is meant to be temporary.","Server side: capacity or a maintenance flag. A Retry-After header may say when to come back, and retrying later is reasonable."],
    [504,"Gateway Timeout","A proxy waited for the upstream server and gave up. The upstream is reachable but too slow to answer within the timeout.","Server side: find the slow query or external call. Raising the proxy timeout hides the symptom instead of fixing it."],
    [505,"HTTP Version Not Supported","The server refuses the HTTP version used in the request line.","Server configuration, or a client speaking a version the server was never set up to accept."],
    [506,"Variant Also Negotiates","A content negotiation misconfiguration: the chosen variant is itself configured to negotiate, so the server loops.","Server side: fix the Apache MultiViews or content negotiation configuration."],
    [507,"Insufficient Storage","The server cannot store what the request needs, because the disk is full or a quota is exceeded. Defined by WebDAV but used more widely.","Server side: free disk space or raise the quota."],
    [508,"Loop Detected","The server aborted the operation because it found an infinite loop while processing a WebDAV request.","Server side: break the circular reference in the resource tree."],
    [510,"Not Extended","The request needs further extensions before the server will fulfil it. Effectively unused today.","Server side, and part of an obsolete extension mechanism."],
    [511,"Network Authentication Required","You have to log in to the network itself, not to the site. Captive portals on hotel, airport and cafe Wi-Fi generate this.","Not the website fault. Open a browser, complete the network login and try the request again."],
  ];

  var BY_CODE = {}, i;
  for (i = 0; i < CODES.length; i++) BY_CODE[CODES[i][0]] = CODES[i];
  var filter = "all";

  function faultKey(cls) {
    if (cls === 4) return "tool.fault.client";
    if (cls === 5) return "tool.fault.server";
    return "tool.fault.none";
  }

  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function show(code) {
    var cls = Math.floor(code / 100), row = BY_CODE[code], extra = $("r-extra");
    if (row) {
      $("r-title").textContent = code + " " + row[1];
      $("r-meaning").textContent = row[2];
      $("r-fix").textContent = row[3];
      extra.textContent = "";
      extra.hidden = true;
    } else {
      // 미등록 코드 — 클래스 대표 코드(x00) 의미로 설명한다. RFC 9110: 알 수 없는 코드는 x00 처럼 처리.
      var base = BY_CODE[cls * 100];
      $("r-title").textContent = code + " — " + t("tool.unknown.name");
      $("r-meaning").textContent = t("tool.unknown.meaning");
      extra.textContent = t("tool.unknown.treated") + " " + (cls * 100) + " " + base[1] + " — " + base[2];
      extra.hidden = false;
      $("r-fix").textContent = t("tool.unknown.hint");
    }
    $("r-class").textContent = t("tool.cls." + cls);
    $("r-fault").textContent = t(faultKey(cls));
    errEl.hidden = true;
    result.hidden = false;
  }

  function lookup() {
    var raw = String(codeEl.value).trim();
    if (!raw) return fail("tool.err.empty");
    var n = parseInt(raw, 10);
    if (!isFinite(n)) return fail("tool.err.empty");
    if (n < 100 || n > 599) return fail("tool.err.range");
    show(n);
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function renderList() {
    clear(reflist);
    var lastCls = 0, j;
    for (j = 0; j < CODES.length; j++) {
      var cls = Math.floor(CODES[j][0] / 100);
      if (filter !== "all" && String(cls) !== filter) continue;
      if (cls !== lastCls) {
        var h = document.createElement("p");
        h.className = "ref-group";
        h.textContent = t("tool.cls." + cls);
        reflist.appendChild(h);
        lastCls = cls;
      }
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ref-row";
      b.setAttribute("data-code", CODES[j][0]);
      var c = document.createElement("span");
      c.className = "ref-code";
      c.textContent = CODES[j][0];
      var nm = document.createElement("span");
      nm.className = "ref-name";
      nm.textContent = CODES[j][1];
      b.appendChild(c);
      b.appendChild(nm);
      reflist.appendChild(b);
    }
  }

  reflist.addEventListener("click", function (e) {
    var el = e.target;
    while (el && el !== reflist && !el.getAttribute("data-code")) el = el.parentNode;
    if (!el || el === reflist) return;
    codeEl.value = el.getAttribute("data-code");
    lookup();
  });

  chips.addEventListener("click", function (e) {
    var el = e.target;
    if (!el || !el.getAttribute || !el.getAttribute("data-cls")) return;
    filter = el.getAttribute("data-cls");
    var all = chips.getElementsByClassName("chip"), k;
    for (k = 0; k < all.length; k++) {
      all[k].className = "chip" + (all[k].getAttribute("data-cls") === filter ? " on" : "");
    }
    renderList();
  });

  $("calc-btn").addEventListener("click", lookup);
  codeEl.addEventListener("keydown", function (e) { if (e.key === "Enter") lookup(); });
  codeEl.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) lookup(); });
  document.addEventListener("i18n:change", function () {
    renderList();
    if (!result.hidden || !errEl.hidden) lookup();
  });

  renderList();
  // TOOLJS:END
})();
