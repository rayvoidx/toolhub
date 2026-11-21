// Figures in guides/compound-interest-inflation-fees/. Uses compound-interest-calc computeCompound,
// savings-calc computeSavings and the CPI array from inflation-calc/js/app.js (lines "var CPI = (...").
// SEC table: 100000 × (1.04 × (1 − fee))^20. Rule of 72 rows mirror rule-of-72-calc calc(): 72/r and ln2/ln(1+r/100).
import fs from "node:fs";
import path from "node:path";
import { toolFns, checker, usd, num, ROOT } from "./lib.mjs";
const { computeCompound } = toolFns("compound-interest-calc", ["effMonthlyRate", "computeCompound"], { LIM: { amount: 1e12, years: 100, ratePct: 1000, schedRows: 50 } });
const { computeSavings } = toolFns("savings-calc", ["interestFor", "breakdown", "computeSavings"]);
const c = checker("compound-interest-inflation-fees");
const sec = (f) => 100000 * Math.pow(1.04 * (1 - f / 100), 20);
for (const f of [0, 0.25, 0.5, 1]) { c.expect("sec", usd(sec(f))); if (f) c.expect("sec lost", usd(sec(0) - sec(f))); }
const run = (rate) => computeCompound(10000, rate, 30, 12, 500, 50);
const base = run(7);
c.expect("contributed", usd(base.totalContributed)); c.expect("growth", usd(base.totalInterest));
c.expect("y10", usd(base.rows[9].balance)); c.expect("y20", usd(base.rows[19].balance));
c.close("half in last decade", base.finalBalance - base.rows[19].balance > base.finalBalance / 2 ? 1 : 0, 1);
c.close("annual-vs-subtract < 0.1pp", Math.abs((1.07 * 0.99 - 1) - 0.06) < 0.001 ? 1 : 0, 1);
// CPI annual averages straight from the tool's data
const src = fs.readFileSync(path.join(ROOT, "services/inflation-calc/js/app.js"), "utf8");
const CPI = eval(src.match(/var CPI = (\([\s\S]*?\)\.split\(" "\)\.map\(Number\));/)[1]);
const i1994 = CPI[1994 - 1913], i2024 = CPI[2024 - 1913];
c.expect("cpi94", num(i1994, 1)); c.expect("cpi24", num(i2024, 1));
const ratio = i2024 / i1994, infl = Math.pow(ratio, 1 / 30) - 1;
c.expect("ratio", num(ratio, 3)); c.expect("infl", num(infl * 100, 2) + "%");
const real = {};
for (const f of [0, 0.05, 0.25, 0.5, 1, 1.5]) {
  const b = run(7 - f).finalBalance; real[f] = b / ratio;
  c.expect("bal", usd(b)); c.expect("real", usd(b / ratio));
  if (f) c.expect("lost", usd(base.finalBalance - b));
}
const lost1 = base.finalBalance - run(6).finalBalance;
c.expect("18.6%", num(lost1 / base.finalBalance * 100, 1) + "%");
c.close("about $266,000", Math.round(real[1] / 1000), 266, 0);
const fisher = 1.07 / (1 + infl) - 1;
c.expect("fisher", num(fisher * 100, 2) + "%"); c.expect("naive", num(7 - infl * 100, 2) + "%");
const indexed = run(Math.round(fisher * 10000) / 100).finalBalance;
c.expect("indexed", usd(indexed));
c.close("indexing beats 0.5% fee cut", indexed - real[0] > real[0] - real[0.5] ? 1 : 0, 1);
for (const r of [2, 4, 7, 10, 12]) { c.expect("72", num(72 / r, 2)); c.expect("exact", num(Math.log(2) / Math.log(1 + r / 100), 2)); }
c.expect("halve 72", num(72 / (infl * 100), 1) + " years"); c.expect("halve exact", num(Math.log(2) / Math.log(1 + infl), 1) + " years");
const sv = computeSavings({ start: 0, monthly: 500, months: 36, annualRate: 4, taxRate: 0, method: "compound" });
c.expect("sv comp", usd(sv.compound.preTax)); c.expect("sv simple", usd(sv.simple.preTax)); c.expect("sv diff", usd(sv.diff));
c.done();
