/* ============================================================
   tool-hub.me 하이브리드 라우터 (Cloudflare Worker)
   - 허브 파일(이 레포)은 Workers 정적 자산으로 서빙된다 (assets 우선).
   - 자산에 없는 경로(개별 도구의 GitHub Pages 프로젝트 페이지)는
     rayvoidx.github.io 로 프록시한다 → 새 도구가 런칭되면
     tool-hub.me/<slug>/ 가 자동으로 살아난다 (재배포 불필요).
   - 전제: 허브 레포에 CNAME 파일이 없어야 한다 (있으면 GitHub이
     tool-hub.me 로 301 을 돌려보내 프록시가 루프에 빠진다).
   ============================================================ */
const ORIGIN = "https://rayvoidx.github.io";

// 내부 문서·메타 파일은 어떤 경로 깊이에서도 서빙하지 않는다 (자산·프록시 공통 차단)
const BLOCKED = /(^|\/)(SERVICE\.yaml|WIKI\.md|wrangler\.jsonc|\.assetsignore|\.gitignore|\.git(\/|$)|worker(\/|$))/;

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    const url = new URL(request.url);
    if (BLOCKED.test(url.pathname)) {
      return new Response("Not Found", { status: 404 });
    }
    const upstream = await fetch(ORIGIN + url.pathname + url.search, {
      method: request.method,
      headers: { accept: request.headers.get("accept") || "*/*" },
      redirect: "manual",
      cf: { cacheTtl: 300 },
    });

    // GitHub 의 리다이렉트(트레일링 슬래시 301 등)는 호스트를 우리 도메인으로 재작성
    const location = upstream.headers.get("location");
    if (upstream.status >= 300 && upstream.status < 400 && location) {
      const loc = new URL(location, ORIGIN);
      // github.io 로 돌아가는 Location 은 tool-hub.me 로 치환 (도메인 일관성)
      if (loc.hostname === "rayvoidx.github.io" || loc.hostname === url.hostname) {
        loc.protocol = "https:";
        loc.hostname = url.hostname;
      }
      const headers = new Headers(upstream.headers);
      headers.set("location", loc.toString());
      return new Response(null, { status: upstream.status, headers });
    }

    return upstream;
  },
};
