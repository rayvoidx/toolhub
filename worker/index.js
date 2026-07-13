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

      if (assetResponse.status !== 404) {
        return assetResponse;
      }
    }

    /*
     * services/에도 없는 경로만 기존 GitHub Pages 프로젝트로 넘긴다.
     */
    const upstream = await fetch(
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
