// Figures in guides/percentage-change-vs-percentage-points/.
// Verifies asymmetric drawdown/recovery math, percentage-point vs relative-% table,
// margin-calc markup/gross-margin table, and discount-calc promotional break-even.
import { toolFns, checker, usd } from "./lib.mjs";

const c = checker("percentage-change-vs-percentage-points");
const d = toolFns("discount-calc", ["calcPrice", "calcRate", "money"], { t: (k) => k });

// 1. +20% then −20% (and reverse) on $100, plus +50% / −50%
const up20 = 100 * 1.2;
const upDown20 = up20 * 0.8;
const down20 = 100 * 0.8;
const downUp20 = down20 * 1.2;
c.close("commute 96", upDown20, downUp20);
c.expect("+20 step", `adds ${usd(up20 - 100, 2)} to reach ${usd(up20, 2)}`);
c.expect("-20 step", `${usd(up20 - upDown20, 2)}, not $20.00 — leaving ${usd(upDown20, 2)}, a net −${((1 - upDown20 / 100) * 100).toFixed(2)}% loss`);
c.expect("reverse -20/+20", `down to ${usd(down20, 2)}, and +20% of ${usd(down20, 2)} adds ${usd(downUp20 - down20, 2)} to finish at ${usd(downUp20, 2)}`);
const upDown50 = 100 * 1.5 * 0.5;
c.expect("50% r^2", `leaving ${usd(upDown50, 2)} (−${((1 - upDown50 / 100) * 100).toFixed(2)}%)`);

// 2. Asymmetric loss-recovery table: gain = d / (1 - d)
for (const lossPct of [10, 20, 25, 40, 50, 75]) {
  const left = 100 * (1 - lossPct / 100);
  const gap = 100 - left;
  const gainPct = ((100 - left) / left) * 100;
  c.expect(
    `drawdown ${lossPct}%`,
    `−${lossPct}% ${usd(left, 2)} ${usd(gap, 2)} +${gainPct.toFixed(2)}%`,
  );
}

// 3. Percentage points & basis points vs relative % change (percent-calc rate formula: (b - a) / a * 100)
const rateCases = [
  ["Checkout conversion", 2.5, 3.0],
  ["Mortgage or CD rate", 4.0, 6.0],
  ["Manufacturing defect rate", 5.0, 4.0],
  ["Combined fee or tax rate", 10.0, 12.5],
];
for (const [label, a, b] of rateCases) {
  const pp = b - a;
  const bps = Math.round(pp * 100);
  const rel = ((b - a) / a) * 100;
  const sign = pp >= 0 ? "+" : "−";
  c.expect(
    `rate ${label}`,
    `${label} ${a.toFixed(1)}% → ${b.toFixed(1)}% ${sign}${Math.abs(pp).toFixed(1)} pp ${sign}${Math.abs(bps)} bps ${sign}${Math.abs(rel).toFixed(1)}%`,
  );
}

// 4. Markup vs Gross Margin table on $80.00 unit cost (mirrors services/margin-calc/js/app.js)
const cost = 80;
const pricingRows = [
  ["+15.0% markup", cost * 1.15],
  ["+25.0% markup", cost * 1.25],
  ["25.0% target margin", cost / (1 - 0.25)],
  ["+50.0% markup", cost * 1.5],
  ["+100.0% markup (keystone)", cost * 2.0],
];
for (const [rule, price] of pricingRows) {
  const profit = price - cost;
  const markup = (profit / cost) * 100;
  const margin = (profit / price) * 100;
  c.expect(
    `margin ${rule}`,
    `${rule} ${usd(price, 2)} ${usd(profit, 2)} ${markup.toFixed(1)}% ${margin.toFixed(1)}%`,
  );
}

// 5. Promotional discount wipeout via discount-calc calcPrice(100, 20)
const promo = d.calcPrice(100, 20);
const wipedRate = d.calcRate(100, promo.finalPrice);
c.close("promo 80", promo.finalPrice, cost);
c.close("promo rate 20", wipedRate.rate, 20);
c.expect(
  "promo wipeout",
  `20% off $100.00 cuts ${usd(promo.discountAmt, 2)} from the ticket — dropping revenue right back to ${usd(promo.finalPrice, 2)} and wiping out 100% of your gross profit ($0.00 left)`,
);

c.done();
