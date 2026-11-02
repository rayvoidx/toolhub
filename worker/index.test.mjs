// Run: node --test worker/
// worker/ is excluded from deployed assets (.assetsignore) and blocked by the worker itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("./index.js", import.meta.url), "utf8");
const worker = (await import("data:text/javascript," + encodeURIComponent(src))).default;

const ORIGIN = "https://tool-hub.me";
const PAGES = new Set(["/services/protein-intake-calc/", "/404"]);
const env = {
  ASSETS: {
    async fetch(req) {
      const { pathname } = new URL(req.url);
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

test("surviving tool is served, not redirected", async () => {
  const res = await get("/protein-intake-calc/");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("location"), null);
});
