// Figures in guides/hourly-pay-salary-overtime-us/. Salary conversions call the tool's own computePay;
// overtime mirrors services/overtime-pay-calc/js/app.js calc() (lines 104-135: regH/otH/dtH split, 1.5× and 2×),
// which is DOM-bound, so the split is reproduced here.
import { toolFns, checker, usd, num } from "./lib.mjs";
const c = checker("hourly-pay-salary-overtime-us");
const { computePay } = toolFns("hourly-to-salary-calc", ["computePay", "round2", "safeCap"], { LIM: { wage: 1e7, annual: 1e9, hours: 168, weeks: 52 } });

for (const weeks of [52, 50, 48]) {
  const p = computePay("hourly", 25, 0, 40, weeks);
  c.expect(`${weeks} weeks hours`, num(p.hoursPerYear));
  c.expect(`${weeks} annual`, usd(p.annual, 2));
  c.expect(`${weeks} monthly`, usd(p.monthly, 2));
  c.expect(`${weeks} semimonthly`, usd(p.semimonthly, 2));
}
c.expect("gap", usd(computePay("hourly", 25, 0, 40, 52).annual - computePay("hourly", 25, 0, 40, 48).annual));
c.expect("salary hourly 40h", usd(computePay("salary", 0, 60000, 40, 52).hourly, 2));
c.expect("salary hourly 45h", usd(computePay("salary", 0, 60000, 45, 52).hourly, 2));
c.expect("weekly x4", usd(computePay("hourly", 25, 0, 40, 52).weekly * 4));
c.expect("biweekly", usd(computePay("hourly", 25, 0, 40, 52).biweekly, 2));
c.expect("4.33 weeks", num(52 / 12, 2));

// overtime-pay-calc split
function ot(r, h, otAt = 40, mult = 1.5, dtAt = Infinity, dMult = 2) {
  const regH = Math.min(h, otAt), otH = Math.max(0, Math.min(h, dtAt) - otAt), dtH = Math.max(0, h - Math.max(otAt, dtAt));
  const total = regH * r + otH * r * mult + dtH * r * dMult;
  return { total, eff: total / h, prem: total - h * r };
}
const w46 = ot(20, 46);
c.expect("46h total", usd(w46.total, 2)); c.expect("46h prem", usd(w46.prem, 2)); c.expect("46h eff", usd(w46.eff, 2));
c.expect("ot parts", usd(6 * 30, 2));
// averaging
const correct = ot(20, 30).total + ot(20, 50).total;
c.expect("wk1", usd(ot(20, 30).total, 2)); c.expect("wk2", usd(ot(20, 50).total, 2));
c.expect("2wk correct", usd(correct, 2)); c.expect("2wk averaged", usd(80 * 20, 2)); c.expect("short", usd(correct - 1600, 2));
// regular rate with bonus (29 CFR 778.110(b))
const reg = (12 * 46 + 46) / 46; c.close("CFR regular rate", reg, 13); c.close("CFR total", 12 * 46 + 46 + 6 * reg / 2, 637);
const straight = 46 * 20 + 100, rr = straight / 46, prem = 6 * 0.5 * rr, tot = straight + prem;
c.expect("straight", usd(straight, 2)); c.expect("rr", usd(rr, 2)); c.expect("prem", usd(prem, 2)); c.expect("total", usd(tot, 2));
c.expect("wrong", usd(w46.total + 100, 2)); c.expect("weekly short", usd(tot - (w46.total + 100), 2));
c.expect("yearly short", "$" + Math.round(50 * (tot - (w46.total + 100))));
// weighted average (DIR example)
const wr = (32 * 11 + 10 * 9) / 42;
c.expect("dir sum", usd(442, 2)); c.expect("dir rr", usd(wr, 2)); c.expect("dir total", usd(442 + 2 * 0.5 * wr, 2));
// fixed salary 45h
c.expect("salary rr", usd(405 / 45, 2)); c.expect("salary prem", usd(5 * 405 / 45 / 2, 2)); c.expect("salary total", usd(405 + 5 * 405 / 45 / 2, 2));
// California day-by-day vs federal
const caDay = (h) => Math.min(h, 8) * 20 + Math.max(0, Math.min(h, 12) - 8) * 30 + Math.max(0, h - 12) * 40;
c.expect("5x8", usd(5 * caDay(8), 2)); c.expect("4x10 CA", usd(4 * caDay(10), 2)); c.expect("4x10 fed", usd(ot(20, 40).total, 2));
c.expect("13h fed", usd(ot(20, 13).total, 2)); c.expect("13h CA", usd(caDay(13), 2));
c.close("13h CA via tool thresholds", ot(20, 13, 8, 1.5, 12, 2).total, caDay(13));
c.expect("4x10 parts", "32 × $20.00 + 8 × $30.00");
c.done();
