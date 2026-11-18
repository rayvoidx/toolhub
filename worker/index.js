/* Public URLs are canonical; /services/ is an internal asset layout only. */
const SEC_HEADERS = {
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(self)",
  "x-frame-options": "SAMEORIGIN",
};
const BLOCKED = /(^|\/)(SERVICE\.yaml|WIKI\.md|wrangler\.jsonc|\.assetsignore|\.gitignore|\.git(\/|$)|worker(\/|$))/;
const SUNSET = { "hourly-to-salary": "hourly-to-salary-calc", "protein-calc": "protein-intake-calc", "binary-translator": "binary-text-conv" };
function secure(res, request) {
  const h = new Headers(res.headers);
  for (const key in SEC_HEADERS) h.set(key, SEC_HEADERS[key]);
  const url = new URL(request.url);
  if (url.searchParams.has("q") || url.searchParams.has("view") || url.searchParams.has("category")) h.set("x-robots-tag", "noindex, follow");
  if (/\/sw\.js$/.test(url.pathname) || /text\/html/.test(h.get("content-type") || "") || url.pathname === "/manifest.webmanifest") h.set("cache-control", "no-cache");
  if (url.pathname === "/manifest.webmanifest") h.set("content-type", "application/manifest+json; charset=utf-8");
  return new Response(request.method === "HEAD" ? null : res.body, { status: res.status, statusText: res.statusText, headers: h });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") return secure(new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } }), request);
    let decoded;
    try { decoded = decodeURIComponent(url.pathname); } catch { return secure(new Response("Bad Request", { status: 400 }), request); }
    if (BLOCKED.test(decoded)) return secure(new Response("Not Found", { status: 404 }), request);
    if (url.pathname === "/services" || url.pathname.startsWith("/services/")) {
      url.pathname = url.pathname.replace(/^\/services(?=\/|$)/, "") || "/";
      return secure(Response.redirect(url.href, 301), request);
    }
    const head = url.pathname.split("/")[1];
    if (SUNSET[head]) {
      url.pathname = url.pathname.replace(`/${head}`, `/${SUNSET[head]}`);
      return secure(Response.redirect(url.href, 301), request);
    }
    const langPage = url.pathname.match(/^\/([^/]+)\/(ko|ja|es)\/?$/);
    if (langPage) {
      url.pathname = `/${langPage[1]}/`; url.searchParams.set("lang", langPage[2]);
      return secure(Response.redirect(url.href, 301), request);
    }
    // Root pages/assets first, then the tools in the internal services directory.
    for (const prefix of ["", "/services"]) {
      const assetURL = new URL(request.url); assetURL.pathname = prefix + url.pathname;
      const res = await env.ASSETS.fetch(new Request(assetURL, request));
      if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
        const location = new URL(res.headers.get("location"), url.origin);
        location.pathname = location.pathname.replace(/^\/services(?=\/)/, "");
        location.search = url.search;
        if (location.origin !== url.origin) return secure(new Response("Not Found", { status: 404 }), request);
        return secure(Response.redirect(location.href, 301), request);
      }
      if (res.status !== 404) return secure(res, request);
    }
    // No dead GitHub origin hop, and never return the homepage for a missing tool.
    const missingURL = new URL("/404", url.origin);
    const missing = await env.ASSETS.fetch(new Request(missingURL));
    return secure(new Response(missing.body, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } }), request);
  },
};
