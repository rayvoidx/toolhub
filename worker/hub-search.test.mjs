// Run: node --test worker/
// Lives under worker/ because that directory is excluded from deployed assets (.assetsignore).
// 2026-11-18: rewritten against the Codex-era search in /js/app.js — normalize() is NFKD + mark-strip +
// locale lowercase, tokens are \p{L}\p{N} runs. The 11/04 regression (non-Latin queries tokenized to nothing →
// every card shown; accented words split) is asserted on the extracted functions instead of a fake DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const normSrc = src.match(/function normalize\(s\) \{[^\n]*\}/)?.[0];
assert.ok(normSrc, "normalize() not found in js/app.js");
const tokenRe = src.match(/q\.match\((\/[^/]+\/[a-z]*)\)/)?.[1];
assert.ok(tokenRe, "token regex not found in js/app.js");
const normalize = new Function(normSrc + "; return normalize;")();
const tokens = (q) => (normalize(q).match(new Function("return " + tokenRe)()) || []);
const stop = /^(how|much|many|what|is|are|to|a|an|the|my|of|for|in|on|calculate|calculator|calc|online|free)$/;
const filter = (q) => { const raw = tokens(q); const t = raw.filter((w) => !stop.test(w)); return t.length ? t : raw; };

const CARDS = [
  "loan calc 대출 ローン計算機 Calculadora de préstamo Кредитный калькулятор",
  "protein intake タンパク質摂取量 Calculadora de proteína Белок",
].map(normalize);
const visible = (q) => CARDS.filter((hay) => filter(q).every((w) => hay.includes(w)));

test("non-Latin/Korean UI-language queries filter instead of showing every card", () => {
  for (const q of ["ローン", "대출", "Кредит", "タンパク"]) {
    assert.ok(tokens(q).length > 0, `tokens for ${q}`);
    assert.equal(visible(q).length, 1, q);
  }
});

test("accented words are not split into fragments", () => {
  assert.deepEqual(tokens("préstamo"), ["prestamo"]);
  assert.equal(visible("préstamo").length, 1);
  assert.equal(visible("prestamo").length, 1, "mark-stripped query matches accented card");
});

test("unmatched non-Latin query shows the empty state", () => {
  assert.equal(visible("税金").length, 0);
});

test("English intent queries and Korean still behave as before", () => {
  assert.deepEqual(filter("how much protein"), ["protein"]);
  assert.equal(visible("how much protein").length, 1);
  assert.equal(visible("loan").length, 1);
  assert.equal(visible("ローン計算機").length, 1, "CJK run without spaces matches as one token");
});
