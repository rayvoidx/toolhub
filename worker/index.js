const ORIGIN = "https://rayvoidx.github.io";

const BLOCKED =
  /(^|\/)(SERVICE\.yaml|WIKI\.md|wrangler\.jsonc|\.assetsignore|\.gitignore|\.git(\/|$)|worker(\/|$))/;

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }

    const url = new URL(request.url);

    if (BLOCKED.test(url.pathname)) {
      return new Response("Not Found", { status: 404 });
    }

    /*
     * 외부 공개 URL:
     *   /loan-calc/
     *
     * 실제 저장소 경로:
     *   /services/loan-calc/
     *
     * 브라우저 URL은 바꾸지 않고 내부 정적 파일만 services/에서 조회한다.
     */
    if (!url.pathname.startsWith("/services/")) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = `/services${url.pathname}`;

      const assetRequest = new Request(assetUrl.toString(), request);
      const assetResponse = await env.ASSETS.fetch(assetRequest);

      /*
       * html_handling 이 /age-calc 를 307 Location: /services/age-calc/ 로 돌려준다.
       * 내부 /services/ 경로가 공개 URL 로 새면 중복 URL 색인 오염이므로
       * 공개 경로로 되돌리고, 임시(307) 대신 영구(301)로 내보낸다.
       */
      const assetLoc = assetResponse.headers.get("location");
      if (
        assetResponse.status >= 300 &&
        assetResponse.status < 400 &&
        assetLoc
      ) {
        const loc = new URL(assetLoc, url.origin);
        loc.pathname = loc.pathname.replace(/^\/services(?=\/)/, "");
        return Response.redirect(loc.toString(), 301);
      }

      if (assetResponse.status !== 404) {
        return assetResponse;
      }
    }

    /*
     * services/에도 없는 경로만 기존 GitHub Pages 프로젝트로 넘긴다.
     * ★ 폴백 오리진(rayvoidx.github.io)은 2026-07 기준 죽어 있다("Site not found" 404).
     *   그대로 흘려보내면 사용자가 GitHub 의 404 를 보게 되므로, 오리진이 404/5xx/실패면
     *   우리 404 페이지(ASSETS /404)를 status 404 로 서빙한다.
     */
    let upstream = null;
    try {
      upstream = await fetch(
        ORIGIN + url.pathname + url.search,
        {
          method: request.method,
          headers: {
            accept: request.headers.get("accept") || "*/*",
          },
          redirect: "manual",
          cf: {
            cacheTtl: 300,
          },
        }
      );
    } catch (e) { /* 오리진 접속 실패 — 아래 404 폴백 */ }

    if (!upstream || upstream.status === 404 || upstream.status >= 500) {
      // 허브 404.html 은 루트 자산 — html_handling 이 /404 를 404.html 로 해석한다
      const nfUrl = new URL(request.url);
      nfUrl.pathname = "/404";
      const nf = await env.ASSETS.fetch(new Request(nfUrl.toString(), { headers: { accept: "text/html" } }));
      if (nf.status === 200) {
        return new Response(nf.body, {
          status: 404,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return new Response("Not Found", { status: 404 });
    }

    const location = upstream.headers.get("location");

    if (
      upstream.status >= 300 &&
      upstream.status < 400 &&
      location
    ) {
      const loc = new URL(location, ORIGIN);

      if (
        loc.hostname === "rayvoidx.github.io" ||
        loc.hostname === url.hostname
      ) {
        loc.protocol = "https:";
        loc.hostname = url.hostname;
      }

      const headers = new Headers(upstream.headers);
      headers.set("location", loc.toString());

      return new Response(null, {
        status: upstream.status,
        headers,
      });
    }

    return upstream;
  },
};
