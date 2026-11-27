// Run: node --test worker/*.test.mjs
// Every figure quoted in /guides/<slug>/ is recomputed by docs/guides-verify/<slug>.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../docs/guides-verify/", import.meta.url));
for (const f of readdirSync(dir).filter((f) => f.endsWith(".mjs") && f !== "lib.mjs")) {
  test(`guide numbers: ${f}`, () => {
    const r = spawnSync(process.execPath, [dir + f], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  });
}

test("indexed English guides carry Consent Mode v2, GTM, AdSense toggle marker, and valid CSP hashes", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const pages = [
    "guides/index.html",
    ...readdirSync(dir)
      .filter((f) => f.endsWith(".mjs") && f !== "lib.mjs")
      .map((f) => `guides/${f.replace(/\.mjs$/, "")}/index.html`),
  ];
  for (const rel of pages) {
    const html = readFileSync(root + rel, "utf8");
    assert.ok(html.includes('name="google-adsense-account" content="ca-pub-6324953789479730"'), `${rel}: missing adsense meta`);
    assert.ok(html.includes("'ad_storage': 'denied'") && html.includes("GTM-TFBT774X"), `${rel}: missing Consent v2 or GTM`);
    assert.ok(
      html.includes("ADSENSE:START") || html.includes("pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"),
      `${rel}: missing AdSense loader or toggle marker`
    );
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || "";
    const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.ok(inlineScripts.length >= 2, `${rel}: expected Consent + GTM inline scripts`);
    for (const m of inlineScripts) {
      const h = `'sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}'`;
      assert.ok(csp.includes(h), `${rel}: CSP missing hash ${h}`);
    }
  }
});

test("robots.txt allows AdSense crawlers and homepage ItemList contains only indexed tools", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const robots = readFileSync(root + "robots.txt", "utf8");
  assert.match(robots, /User-agent:\s*Mediapartners-Google\s*\nAllow:\s*\//);
  assert.match(robots, /User-agent:\s*AdsBot-Google\s*\nAllow:\s*\//);

  const tiers = JSON.parse(readFileSync(root + "docs/index-tiers.json", "utf8"));
  const keep = new Set(tiers.tools.filter((t) => t.tier === "keep").map((t) => t.slug));
  const indexHtml = readFileSync(root + "index.html", "utf8");
  const itemListLine = indexHtml.split("\n").find((l) => l.includes('"@type":"ItemList"'));
  assert.ok(itemListLine, "index.html missing ItemList JSON-LD");
  const ld = JSON.parse(itemListLine);
  assert.equal(ld.numberOfItems, keep.size);
  assert.equal(ld.itemListElement.length, keep.size);
  for (const el of ld.itemListElement) {
    const slug = el.url.replace(/\/$/, "").split("/").pop();
    assert.ok(keep.has(slug), `noindex tool leaked into homepage ItemList: ${slug}`);
  }
});
