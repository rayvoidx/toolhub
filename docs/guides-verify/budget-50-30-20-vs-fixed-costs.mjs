// Figures in guides/budget-50-30-20-vs-fixed-costs/.
// Calls services/budget-calc/js/app.js splitFor() and money(), plus emergency-fund-calc ceiling pace math.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { toolFns, checker, ROOT, usd } from "./lib.mjs";

const c = checker("budget-50-30-20-vs-fixed-costs");

const budgetSrc = fs.readFileSync(path.join(ROOT, "services/budget-calc/js/app.js"), "utf8");
const RULES = vm.runInNewContext("(" + budgetSrc.match(/var RULES = (\{[^\n;]+\});/)[1] + ")");
const FREQ = vm.runInNewContext("(" + budgetSrc.match(/var FREQ = (\{[^\n;]+\});/)[1] + ")");

const customInputs = { a: 60, b: 20, c: 20 };
const b = toolFns("budget-calc", ["num", "money", "pct", "splitFor"], {
  RULES,
  pNeeds: { get value() { return String(customInputs.a); } },
  pWants: { get value() { return String(customInputs.b); } },
  pSave: { get value() { return String(customInputs.c); } },
});

// 1. Classic 50/30/20 table across $3,500, $5,500, $8,000
const classic = b.splitFor("classic");
c.close("classic sum", classic[0] + classic[1] + classic[2], 100);
for (const inc of [3500, 5500, 8000]) {
  const needs = (inc * classic[0]) / 100;
  const wants = (inc * classic[1]) / 100;
  const save = (inc * classic[2]) / 100;
  c.expect(
    `classic ${inc}`,
    `$${b.money(inc)} $${b.money(needs)} $${b.money(wants)} $${b.money(save)} $${b.money(save * 12)}`,
  );
}

// 2. Biweekly paycheck conversion (FREQ.biweek = 26 / 12)
const biweekly = 2100;
const naiveMonthly = biweekly * 2;
const trueMonthly = Math.round(biweekly * FREQ.biweek);
c.close("biweekly 4550", trueMonthly, 4550);
c.expect("biweekly naive", `${usd(biweekly)} biweekly take-home check looks like ${usd(naiveMonthly)}`);
c.expect("biweekly true", `average ${usd(trueMonthly)} a month (${usd(trueMonthly * 0.5)} needs, ${usd(trueMonthly * 0.3)} wants, ${usd(trueMonthly * 0.2)} savings, or ${usd(trueMonthly * 0.2 * 12)} a year)`);
c.expect("biweekly extra", `deliver ${usd((trueMonthly - naiveMonthly) * 12)} a year (${usd(trueMonthly - naiveMonthly)} × 12)`);

// 3. Five splits on $5,500 take-home + emergency-fund timelines (3-month & 6-month essential reserve)
const splits = [
  ["50% / 30% / 20% (classic)", "classic", null, "50% / 30% / 20%"],
  ["60% / 20% / 20% (trim wants)", "custom", [60, 20, 20], "60% / 20% / 20%"],
  ["60% / 30% / 10% (HCOL preset)", "hcol", null, "60% / 30% / 10%"],
  ["65% / 20% / 15% (tight rent)", "custom", [65, 20, 15], "65% / 20% / 15%"],
  ["70% / 20% / 10% (heavy fixed)", "custom", [70, 20, 10], "70% / 20% / 10%"],
];

const inc = 5500;
for (const [label, mode, customArr, shortLabel] of splits) {
  if (customArr) {
    [customInputs.a, customInputs.b, customInputs.c] = customArr;
  }
  const s = b.splitFor(mode);
  c.close(`${label} valid`, Array.isArray(s) ? s[0] + s[1] + s[2] : 0, 100);
  const needs = (inc * s[0]) / 100;
  const wants = (inc * s[1]) / 100;
  const save = (inc * s[2]) / 100;
  c.expect(
    `split row ${label}`,
    `${label} $${b.money(needs)} $${b.money(wants)} $${b.money(save)} $${b.money(save * 12)}`,
  );

  // Emergency-fund-calc formula: target = essentials * months; pace = Math.ceil(gap / save)
  const t3 = needs * 3;
  const t6 = needs * 6;
  const m3 = Math.ceil(t3 / save);
  const m6 = Math.ceil(t6 / save);
  c.expect(
    `efund row ${shortLabel}`,
    `${shortLabel} $${b.money(needs)} $${b.money(t3)} $${b.money(t6)} ${m3} months ${m6} months`,
  );
}

// 4. Starter savings example ($2,000 saved against $8,250 3-month target at $1,100/mo)
const gapWithStarter = 8250 - 2000;
const monthsWithStarter = Math.ceil(gapWithStarter / 1100);
c.expect("7.5 ceiling", `$8,250 ÷ $1,100 is ${(8250 / 1100).toFixed(1)} months`);
c.expect(
  "starter 2000",
  `remaining ${usd(gapWithStarter)} gap takes ${monthsWithStarter} months at $1,100 a month (${usd(gapWithStarter)} ÷ $1,100 = ${(gapWithStarter / 1100).toFixed(2)}, rounded up to ${monthsWithStarter})`,
);
c.close("multiplier 2.4x", (60 / 50) * (20 / 10), 2.4);
c.expect("multiplier text", "1.2 × 2 = 2.4× (15 months × 2.4 = 36 months)");

c.done();
