// Run: node --test worker/*.test.mjs
// Every figure quoted in /guides/<slug>/ is recomputed by docs/guides-verify/<slug>.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../docs/guides-verify/", import.meta.url));
for (const f of readdirSync(dir).filter((f) => f.endsWith(".mjs") && f !== "lib.mjs")) {
  test(`guide numbers: ${f}`, () => {
    const r = spawnSync(process.execPath, [dir + f], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  });
}
