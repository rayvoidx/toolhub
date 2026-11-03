// Run: node --test worker/
// Lives under worker/ because that directory is excluded from deployed assets (.assetsignore);
// it exercises the hub tool-search module in /js/app.js (TOOLJS:START..END) against a minimal fake DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const body = src.slice(src.indexOf("// TOOLJS:START"), src.indexOf("// TOOLJS:END"));
assert.ok(body.length > 0, "TOOLJS block not found in js/app.js");

function run(query, cardTexts) {
  const cards = cardTexts.map(([name, text]) => ({
    hidden: false,
    textContent: text,
    getAttribute: (a) => (a === "data-name" ? name : null),
  }));
  const group = {
    hidden: false,
    querySelectorAll: () => cards.filter((c) => !c.hidden),
  };
  const els = {
    "tool-search": { value: query, addEventListener() {} },
    "tool-list": { querySelectorAll: (sel) => (sel === ".tool-item" ? cards : [group]) },
    "tool-empty": { hidden: true },
    "tool-count": { textContent: "" },
  };
  const document = {
    getElementById: (id) => els[id] || null,
    documentElement: { classList: { toggle() {} } },
  };
  new Function("document", "location", body)(document, { search: "" });
  return { visible: cards.filter((c) => !c.hidden).map((c) => c.textContent), empty: els["tool-empty"].hidden === false };
}

const CARDS = [
  ["loan calc 대출", "ローン計算機 Calculadora de préstamo Кредитный калькулятор"],
  ["protein intake", "タンパク質摂取量 Calculadora de proteína Белок"],
];

test("non-Latin/Korean UI-language queries filter instead of showing every card", () => {
  assert.deepEqual(run("ローン", CARDS).visible, [CARDS[0][1]]);
  assert.deepEqual(run("кредитный", CARDS).visible, [CARDS[0][1]]);
  assert.deepEqual(run("タンパク質", CARDS).visible, [CARDS[1][1]]);
});

test("accented words are not split into fragments", () => {
  assert.deepEqual(run("préstamo", CARDS).visible, [CARDS[0][1]]);
});

test("unmatched non-Latin query shows the empty state", () => {
  const r = run("存在しない", CARDS);
  assert.deepEqual(r.visible, []);
  assert.equal(r.empty, true);
});

test("English intent queries and Korean still behave as before", () => {
  assert.deepEqual(run("how much protein", CARDS).visible, [CARDS[1][1]]);
  assert.deepEqual(run("loan-calc", CARDS).visible, [CARDS[0][1]]);
  assert.deepEqual(run("대출", CARDS).visible, [CARDS[0][1]]);
  assert.equal(run("", CARDS).visible.length, 2);
});
