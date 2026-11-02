/*
 * 2026-09-17 보안 응답 헤더 — 정적 자산 서빙엔 기본으로 없다. CSP 는 페이지 <meta> 가 담당(gen-csp).
 * geolocation 은 자체 도구 1종(sunrise 류)이 쓰므로 self 허용, 카메라·마이크는 어떤 도구도 안 쓴다.
 */
const SEC_HEADERS = {
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(self)",
  "x-frame-options": "SAMEORIGIN",
};
function secure(res) {
  const h = new Headers(res.headers);
  for (const k in SEC_HEADERS) if (!h.has(k)) h.set(k, SEC_HEADERS[k]);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

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
     * 2026-09-07: 언어별 정적 하위 페이지(/<slug>/ko|ja|es/)를 폐기했다 — 본문 가이드가 영어 원문
     * 그대로여서 984 URL 이 중복 페이지로 색인됐고 AdSense 저가치 콘텐츠 판정을 받았다.
     * 잔존 북마크·색인 URL 은 런타임 i18n 이 지원하는 ?lang= 로 영구 이동시킨다.
     */
    /*
     * 2026-09-08: H1·의도 완전 중복 쌍 3 통합(sunset) — 남은 쪽으로 영구 이동(하위 경로·쿼리 보존).
     * 근거: services/hub/WIKI.md §6. 새 sunset 은 여기 한 줄 + 레지스트리 status: sunset.
     */
    const SUNSET = {
      "hourly-to-salary": "hourly-to-salary-calc",
      "protein-calc": "protein-intake-calc",
      "binary-translator": "binary-text-conv",
    };
    const head = url.pathname.split("/")[1];
    // 자체 키만 — /constructor/·/toString·/__proto__/ 가 Object.prototype 값을 물어 엉뚱한 301 을 내던 결함
    if (Object.hasOwn(SUNSET, head)) {
      url.pathname = url.pathname.replace(`/${head}`, `/${SUNSET[head]}`);
      return secure(Response.redirect(url.toString(), 301));
    }

    const langPage = url.pathname.match(/^\/([^/]+)\/(ko|ja|es)\/?$/);
    if (langPage) {
      return secure(Response.redirect(`${url.origin}/${langPage[1]}/?lang=${langPage[2]}`, 301));
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
        return secure(Response.redirect(loc.toString(), 301));
      }

      if (assetResponse.status !== 404) {
        return secure(assetResponse);
      }
    }

    /*
     * services/에도 없는 경로 → 우리 404 페이지를 status 404 로(soft-404 금지).
     * 2026-11-01: rayvoidx.github.io 프록시 폴백 제거 — 2026-07 이후 오리진이 모든 경로에 404(11-01 실측 /, /loan-calc/ 포함)라
     * 404 마다 외부 서브요청 1회·응답 +0.2~0.6s 만 쓰고 오픈 리다이렉트 표면만 남기고 있었다.
     * ponytail: 새 도구는 이제 자산 배포(main push)로만 편입된다 — 외부 오리진 프록시가 다시 필요하면 git 이력의 폴백을 되살린다.
     */
    // 허브 404.html 은 루트 자산 — html_handling 이 /404 를 404.html 로 해석한다
    const nfUrl = new URL(request.url);
    nfUrl.pathname = "/404";
    const nf = await env.ASSETS.fetch(new Request(nfUrl.toString(), { headers: { accept: "text/html" } }));
    if (nf.status === 200) {
      return secure(new Response(request.method === "HEAD" ? null : nf.body, {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8" },
      }));
    }
    return secure(new Response("Not Found", { status: 404 }));
  },
};
