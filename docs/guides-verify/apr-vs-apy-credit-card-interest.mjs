// Figures in guides/apr-vs-apy-credit-card-interest/. Uses apy-calc aprToApy/apyToApr,
// credit-card-interest-calc quickInterest/minPaymentAmount/simulate and debt-payoff-calc simulate.
// The "1% plus interest" row passes a custom payment rule to the same simulate().
import { toolFns, checker, usd, num } from "./lib.mjs";
const { aprToApy, apyToApr } = toolFns("apy-calc", ["aprToApy", "apyToApr"]);
const cc = toolFns("credit-card-interest-calc", ["safe", "quickInterest", "minPaymentAmount", "simulate"], { LIM: { balance: 1e12, apr: 500, months: 600, cycleDays: 31 } });
const dp = toolFns("debt-payoff-calc", ["simulate"], { MAX_MONTHS: 1200 });
const c = checker("apr-vs-apy-credit-card-interest");
const pct3 = (x) => num(x * 100, 3) + "%";
for (const r of [0.045, 0.2236]) for (const n of [1, 12, 365, Infinity]) c.expect("apy", pct3(aprToApy(r, n)));
const gapSave = aprToApy(0.045, Infinity) - 0.045, gapCard = aprToApy(0.2236, 365) - 0.2236;
c.close("about a tenth of a point", Math.round(gapSave * 1000), 1, 0);
c.close(">20x", gapCard / gapSave > 20 ? 1 : 0, 1);
c.expect("25.05%", num(aprToApy(0.2236, 365) * 100, 2) + "%");
c.expect("rev daily", pct3(apyToApr(0.046, 365))); c.expect("rev monthly", pct3(apyToApr(0.046, 12)));
const q30 = cc.quickInterest(3000, 22.36, 30), q31 = cc.quickInterest(3000, 22.36, 31);
c.expect("daily rate", num(q30.dailyRate * 100, 5) + "%"); c.expect("30d", usd(q30.interest, 2)); c.expect("31d", usd(q31.interest, 2));
const B = 5000, A = 22.36;
const two = cc.simulate(B, A, (b) => cc.minPaymentAmount(b, 2, 25), 600);
c.close("2% not paid in 600", two.paidOff ? 0 : two.months, 600, 0);
c.expect("2% first", usd(two.firstPayment, 2)); c.expect("2% paid", usd(two.totalPaid)); c.expect("2% left", usd(two.endingBalance, 2));
c.expect("monthly rate", num(A / 12, 3) + "%"); c.expect("net principal", num(2 - A / 12, 3) + "%");
const onePlus = cc.simulate(B, A, (b) => Math.max(b * 0.01 + b * A / 1200, 25), 600);
const three = cc.simulate(B, A, (b) => cc.minPaymentAmount(b, 3, 25), 600);
const f150 = cc.simulate(B, A, () => 150, 600);
const r = A / 1200, p36 = B * r / (1 - Math.pow(1 + r, -36)), f36 = cc.simulate(B, A, () => p36, 600);
for (const s of [onePlus, three, f150, f36]) { c.expect("first", usd(s.firstPayment, 2)); c.expect("int", usd(s.totalInterest)); c.close("paid", s.paidOff ? 1 : 0, 1); }
c.close("1%+int months", onePlus.months, 231, 0); c.close(">19 years", onePlus.months > 228 ? 1 : 0, 1);
c.close("3% months", three.months, 210, 0); c.close("150 months", f150.months, 53, 0); c.close("36", f36.months, 36, 0);
c.expect("fixed vs 3%", usd(three.totalInterest - f150.totalInterest));
const rows = [{ n: "Store card", bal: 900, apr: 19.99, min: 35 }, { n: "Visa", bal: 6200, apr: 27.99, min: 150 }, { n: "Car loan", bal: 8500, apr: 7.5, min: 265 }];
const av = dp.simulate(rows, 300, "avalanche"), sn = dp.simulate(rows, 300, "snowball"), none = dp.simulate(rows, 0, "avalanche");
c.close("av order", av.order.join(">") === "Visa>Store card>Car loan" ? 1 : 0, 1);
c.close("sn order", sn.order.join(">") === "Store card>Visa>Car loan" ? 1 : 0, 1);
c.expect("av", `debt-free in ${av.months} months, ${usd(av.interest, 2)}`); c.expect("sn", `debt-free in ${sn.months} months, ${usd(sn.interest, 2)}`);
c.expect("none", `${none.months} months, ${usd(none.interest)}`); c.expect("diff", usd(sn.interest - av.interest, 2));
c.close(">$5,000 saved", none.interest - av.interest > 5000 ? 1 : 0, 1);
c.done();
