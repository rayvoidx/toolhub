// Run: node --test worker/
// worker/ is excluded from deployed assets (.assetsignore) and blocked by the worker itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("./index.js", import.meta.url), "utf8");
const worker = (await import("data:text/javascript," + encodeURIComponent(src))).default;

const ORIGIN = "https://tool-hub.me";
const PAGES = new Set(["/services/protein-intake-calc/", "/404"]);
// Binary assets as committed: hub root icons, per-tool og-image.jpg, and PNG icons only for a few tools (age-calc).
const FILES = new Set([
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/services/a1c-calc/og-image.jpg",
  "/services/age-calc/icons/icon-192.png",
]);
const env = {
  ASSETS: {
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (FILES.has(pathname)) return new Response(pathname, { status: 200 });
      return PAGES.has(pathname)
        ? new Response("<!doctype html>ok", { status: 200, headers: { "content-type": "text/html" } })
        : new Response("missing", { status: 404 });
    },
  },
};
const get = (path) => worker.fetch(new Request(ORIGIN + path), env);

test("Object.prototype keys are not treated as sunset slugs", async () => {
  for (const path of ["/constructor/", "/toString", "/__proto__/x", "/hasOwnProperty/", "/valueOf"]) {
    const res = await get(path);
    assert.equal(res.status, 404, `${path} should be 404, got ${res.status} -> ${res.headers.get("location")}`);
    assert.equal(res.headers.get("location"), null);
  }
});

test("real sunset slugs still 301 with subpath and query preserved", async () => {
  const res = await get("/protein-calc/sub?x=1");
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), `${ORIGIN}/protein-intake-calc/sub?x=1`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

test("missing per-tool PNG icons fall back to the hub icons", async () => {
  for (const size of ["192", "512"]) {
    const res = await get(`/a1c-calc/icons/icon-${size}.png`);
    assert.equal(res.status, 200, `icon-${size} should not 404`);
    assert.equal(await res.text(), `/icons/icon-${size}.png`);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  }
});

test("a tool's own PNG icon wins over the hub fallback", async () => {
  const res = await get("/age-calc/icons/icon-192.png");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "/services/age-calc/icons/icon-192.png");
});

test("og-image.png falls back to the same tool's og-image.jpg", async () => {
  const res = await get("/a1c-calc/og-image.png");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "/services/a1c-calc/og-image.jpg");
});

test("fallback never invents assets: unknown tool or other files still 404", async () => {
  for (const path of ["/no-such-tool/og-image.png", "/a1c-calc/icons/icon-64.png", "/a1c-calc/icons/other.png"]) {
    const res = await get(path);
    assert.equal(res.status, 404, `${path} should stay 404`);
  }
});

test("surviving tool is served, not redirected", async () => {
  const res = await get("/protein-intake-calc/");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("location"), null);
});
