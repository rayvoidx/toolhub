// Figures in guides/fixed-rate-loan-term-extra-payments/. Uses the tools' own functions:
// mortgage-calc computeSchedule, biweekly-mortgage-calc simulate, refinance-calc payment.
// Refinance break-even/lifetime lines mirror refinance-calc calc(): ceil(costs/save), (newInt+costs)-oldInt.
import { toolFns, checker, usd, num } from "./lib.mjs";
const { computeSchedule } = toolFns("mortgage-calc", ["computeSchedule"], { LIM: { value: 1e12, years: 50, rate: 30 } });
const { simulate } = toolFns("biweekly-mortgage-calc", ["simulate"]);
const { payment } = toolFns("refinance-calc", ["payment"]);
const c = checker("fixed-rate-loan-term-extra-payments");
const P = 300000;
const t30 = computeSchedule(P, 7.28, 30, 0), t20 = computeSchedule(P, 7.0, 20, 0), t15 = computeSchedule(P, 6.66, 15, 0);
for (const t of [t30, t20, t15]) {
  c.expect("payment", usd(t.payment, 2)); c.expect("interest", usd(t.totalInterestBase)); c.expect("total", usd(t.totalPaidBase));
}
const gap = t15.payment - t30.payment;
c.expect("gap", usd(gap, 2)); c.close("~29% more", Math.round(gap / t30.payment * 100), 29, 0);
c.expect("interest cut", usd(t30.totalInterestBase - t15.totalInterestBase));
c.close("60%", Math.round((t30.totalInterestBase - t15.totalInterestBase) / t30.totalInterestBase * 100), 60, 0);
let i1 = 0, p1 = 0; for (let k = 0; k < 12; k++) { i1 += t30.schedule[k].interest; p1 += t30.schedule[k].principal; }
c.expect("12 payments", usd(t30.payment * 12)); c.expect("y1 principal", usd(p1)); c.expect("y1 interest", usd(i1));
const bal36 = t30.schedule[35].balance;
c.expect("bal 36", usd(bal36)); c.expect("bal 60", usd(t30.schedule[59].balance));
const ex = {};
for (const x of [100, 200, 500]) {
  const s = (ex[x] = computeSchedule(P, 7.28, 30, x));
  c.expect("extra months", `${s.payoffMonths} months`); c.expect("extra int", usd(s.totalInterestActual)); c.expect("saved", usd(s.interestSaved));
}
c.close("less than triples", ex[500].interestSaved / ex[100].interestSaved < 3 ? 1 : 0, 1);
const as15 = computeSchedule(P, 7.28, 30, gap);
c.expect("as15 months", `${as15.payoffMonths} months`); c.close("16y2m", as15.payoffMonths, 16 * 12 + 2, 0);
c.expect("as15 int", usd(as15.totalInterestActual)); c.expect("rate worth", usd(as15.totalInterestActual - t15.totalInterestBase));
c.close("1y2m sooner", as15.payoffMonths - 180, 14, 0);
// biweekly-mortgage-calc calc(): M from payment formula, simulate(p, i, M + M/12)
const M = payment(P, 7.28, 360), bi = simulate(P, 7.28 / 1200, M + M / 12);
c.expect("half", usd(M / 2, 2)); c.expect("bi months", `${bi.months} months`); c.close("23y7m", bi.months, 23 * 12 + 7, 0);
c.expect("bi int", usd(bi.interest)); c.expect("bi saved", usd(M * 360 - P - bi.interest)); c.expect("M/12", usd(M / 12, 2));
const viaExtra = computeSchedule(P, 7.28, 30, M / 12); c.close("same as extra M/12", viaExtra.payoffMonths, bi.months, 0);
// refinance
const oldN = 324, old = payment(bal36, 7.28, oldN), oldInt = old * oldN - bal36, cc = 6000;
c.close("old payment equals original", old, t30.payment, 1e-6);
for (const [nr, n] of [[6.28, 324], [6.28, 360], [6.66, 180]]) {
  const np = payment(bal36, nr, n), save = old - np, diff = np * n - bal36 + cc - oldInt;
  c.expect("new pay", usd(np, 2));
  c.expect("save", save > 0 ? usd(save, 2) : "−" + usd(-save, 2));
  if (save > 0) c.expect("breakeven", `${Math.ceil(cc / save)} months`);
  c.expect("lifetime", usd(-diff) + " less");
}
c.done();
