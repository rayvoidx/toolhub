// Figures in guides/unit-price-and-discount-stacking/. Unit prices: unit-price unitPriceOf()/normalizedCapacity()/
// unitCategory() with its UNIT_FACTOR table; the "% cheaper" line mirrors unit-price compare() ((dear − cheap) / dear, 1 dp).
// Discounts: discount-calc calcPrice()/calcRate(). Tax: mirrors sales-tax-calc calc() (add: amt × rate; remove: amt ÷ (1 + rate)).
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { toolFns, checker, ROOT, usd } from "./lib.mjs";

const c = checker("unit-price-and-discount-stacking");
const src = fs.readFileSync(path.join(ROOT, "services/unit-price/js/app.js"), "utf8");
const UNIT_FACTOR = vm.runInNewContext("(" + src.match(/var UNIT_FACTOR = (\{[\s\S]*?\n  \});/)[1] + ")");
const u = toolFns("unit-price", ["unitCategory", "normalizedCapacity", "unitPriceOf"], { UNIT_FACTOR });
const d = toolFns("discount-calc", ["calcPrice", "calcRate", "money"], { t: (k) => k });
const cheaper = (a, b) => Math.round(((Math.max(a, b) - Math.min(a, b)) / Math.max(a, b)) * 1000) / 10;

const coffee = [["12 oz bag", 8.99, 12, "oz", 1, "$8.99", "340.2 g"], ["1 kg bag", 24.5, 1, "kg", 1, "$24.50", "1,000 g"], ["Twin pack, 2 × 340 g", 16.49, 340, "g", 2, "$16.49", "680 g"]];
const up = {};
for (const [n, price, cap, unit, count, ps, ws] of coffee) {
  const p = u.unitPriceOf({ price, capacity: cap, unit, count }); up[n] = p;
  c.expect("coffee " + n, `${n} ${ps} ${ws} ${usd(p * 100, 3)} ${usd(p * UNIT_FACTOR.lb, 2)}`);
}
const [p12, p1k, p2x] = Object.values(up);
c.expect("twin beats 1kg", "by " + cheaper(p1k, p2x).toFixed(1) + "%");
c.expect("12 oz in g", "12 oz is " + u.normalizedCapacity(12, "oz").toFixed(1) + " g");
c.expect("oz factor", String(UNIT_FACTOR.oz) + " g");
c.expect("7.3% cheaper", `"${cheaper(p12, p1k).toFixed(1)}% cheaper"`);
c.expect("7.9% dearer", (((p12 / p1k) - 1) * 100).toFixed(1) + "% more expensive");
c.close("oz vs floz refused", u.unitCategory("oz") !== u.unitCategory("floz") ? 1 : 0, 1);

const can24 = u.unitPriceOf({ price: 11.99, capacity: 12, unit: "floz", count: 24 }) * u.normalizedCapacity(12, "floz");
const can12 = u.unitPriceOf({ price: 5.49, capacity: 12, unit: "floz", count: 12 }) * u.normalizedCapacity(12, "floz");
c.expect("24-pack", usd(can24, 4) + " a can"); c.expect("12-pack", usd(can12, 4) + " a can, " + cheaper(can24, can12).toFixed(1) + "% cheaper");
c.expect("BOGO50", (100 * (1 - 1.5 / 2)) + "% off each"); c.expect("B2G1", (100 * (1 - 2 / 3)).toFixed(1) + "% off each");

const s1 = d.calcPrice(80, 25), s2 = d.calcPrice(s1.finalPrice, 20), r = d.calcRate(80, s2.finalPrice);
c.expect("jacket", `$80 jacket at 25% off is ${usd(s1.finalPrice)}`);
c.expect("extra 20", `${usd(s2.discountAmt)}, leaving ${usd(s2.finalPrice)}`);
c.expect("total", `Total savings: ${usd(r.discountAmt)}`); c.expect("as 40%", `as a ${r.rate}% discount`);
const stack = (...rs) => 1 - rs.reduce((acc, x) => acc * (1 - x / 100), 1);
for (const [label, rs, sounds] of [["25% + extra 20%", [25, 20], 45], ["50% + extra 50%", [50, 50], 100], ["30% + extra 10%", [30, 10], 40], ["20% + 20% + 20%", [20, 20, 20], 60]])
  c.expect("stack " + label, `${label} ${sounds}% ${+(stack(...rs) * 100).toFixed(1)}%`);
c.expect("gap", "25% × 20% = " + (25 * 20) / 100 + " points");

const pctFirst = d.calcPrice(60, 20).finalPrice - 10, couponFirst = d.calcPrice(60 - 10, 20).finalPrice;
c.expect("order pct first", `60 × 0.80 − 10 ${usd(pctFirst)} ${d.calcRate(60, pctFirst).rate}%`);
c.expect("order coupon first", `(60 − 10) × 0.80 ${usd(couponFirst)} ${d.calcRate(60, couponFirst).rate}%`);
c.expect("order diff", `The difference, ${usd(couponFirst - pctFirst)}, is exactly`);

const tax = (amt, rate) => amt * rate / 100; // sales-tax-calc "add" mode
c.expect("NY store", usd((1 - 0.25) + tax(1 - 0.25, 8), 2) + " with a store coupon");
c.expect("NY mfr", usd(1 + tax(1, 8) - 0.25, 2) + " with a manufacturer's coupon");
c.expect("40 store", "(40 − 5) × 1.08 = " + usd(35 + tax(35, 8), 2));
c.expect("40 mfr", "40 × 1.08 − 5 = " + usd(40 + tax(40, 8) - 5, 2));
c.expect("40 gap", "The " + Math.round((tax(40, 8) - tax(35, 8)) * 100) + "-cent gap");
c.expect("backout", "$54.13 ÷ 1.0825 = " + usd(54.13 / 1.0825, 2)); // sales-tax-calc "remove" mode
c.expect("backout wrong", "gives " + usd(54.13 * (1 - 0.0825), 2));

c.expect("ice before", usd(5.99 / 64, 4) + " before"); c.expect("ice after", usd(5.99 / 60, 4) + " after, a " + ((64 / 60 - 1) * 100).toFixed(1) + "%");
c.close("16→15 also 6.7%", +((16 / 15 - 1) * 100).toFixed(1), 6.7);
c.expect("NIST rounding", "$2.425 per 100 g displays as $2.43"); c.close("2.425 rounds up", Math.round(2.425 * 1000) % 10, 5);
c.done();
