// Figures in guides/percentage-change-vs-percentage-points/.
// Directly calls services/percent-calc/js/app.js (calcChange, calcRate),
// services/margin-calc/js/app.js (calc), and services/discount-calc/js/app.js (calcPrice, calcRate).
import { toolFns, checker, usd } from "./lib.mjs";

const c = checker("percentage-change-vs-percentage-points");
const d = toolFns("discount-calc", ["calcPrice", "calcRate", "money"], { t: (k) => k });

// Sandbox services/percent-calc/js/app.js calcChange() and calcRate()
function createPercentCalc(dec = 2) {
  const state = {
    changeA: "100",
    changeX: "20",
    mode: "increase",
    rateA: "4",
    rateB: "6",
    changeOut: "",
    rateOut: "",
  };
  const fns = toolFns(
    "percent-calc",
    ["decimals", "fmt", "showResult", "showError", "renderPctVisual", "setChangeMode", "calcChange", "calcRate"],
    {
      decimalsEl: { value: String(dec) },
      document: { getElementById: () => null },
      changeA: { get value() { return state.changeA; } },
      changeX: { get value() { return state.changeX; } },
      changeModeIncrease: null,
      changeModeDecrease: null,
      currentChangeMode: "increase",
      changeResult: { set innerHTML(v) { state.changeOut = v; }, className: "", hidden: true, parentNode: null },
      rateA: { get value() { return state.rateA; } },
      rateB: { get value() { return state.rateB; } },
      rateResult: { set innerHTML(v) { state.rateOut = v; }, className: "", hidden: true, parentNode: null },
      t: (k) => k,
    },
  );
  return {
    change(a, x, mode) {
      state.changeA = String(a);
      state.changeX = String(x);
      fns.setChangeMode(mode);
      return parseFloat(state.changeOut);
    },
    rate(a, b) {
      state.rateA = String(a);
      state.rateB = String(b);
      fns.calcRate();
      return state.rateOut.replace(/\s*%$/, "");
    },
  };
}

// Sandbox services/margin-calc/js/app.js calc()
function runMarginCalc({ mode, cost = "", price = "", margin = "" }) {
  const dom = {
    "r-hero-label": { setAttribute() {}, textContent: "" },
    "r-hero": { textContent: "", className: "" },
    "r-margin": { textContent: "", className: "" },
    "r-markup": { textContent: "", className: "" },
    "r-profit": { textContent: "", className: "" },
    "r-price": { textContent: "", className: "" },
    "r-cost": { textContent: "", className: "" },
    "total-card": { hidden: true },
    "r-total": { textContent: "", className: "" },
  };
  const mc = toolFns("margin-calc", ["fail", "calc"], {
    String,
    mode: { value: mode },
    cost: { value: String(cost) },
    price: { value: String(price) },
    margin: { value: String(margin) },
    qty: { value: "" },
    result: { hidden: true },
    errEl: { hidden: true, textContent: "" },
    warnEl: { hidden: true },
    $: (id) => dom[id],
    num: (el) => {
      const v = parseFloat(String(el.value).replace(/[^0-9.-]/g, ""));
      return isFinite(v) ? v : NaN;
    },
    money: (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    pct: (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%",
    setVal: (id, text) => { dom[id].textContent = text; },
    t: (k) => k,
  });
  mc.calc();
  return {
    priceStr: dom["r-price"].textContent,
    profitStr: dom["r-profit"].textContent,
    markupStr: dom["r-markup"].textContent,
    marginStr: dom["r-margin"].textContent,
  };
}

const pc2 = createPercentCalc(2);
const pc1 = createPercentCalc(1);

// 1. +20% then −20% (and reverse) on $100, plus +50% / −50% via percent-calc calcChange()
const up20 = pc2.change(100, 20, "increase");
const upDown20 = pc2.change(up20, 20, "decrease");
const down20 = pc2.change(100, 20, "decrease");
const downUp20 = pc2.change(down20, 20, "increase");
c.close("commute 96", upDown20, downUp20);
c.expect("+20 step", `adds ${usd(up20 - 100, 2)} to reach ${usd(up20, 2)}`);
c.expect("-20 step", `${usd(up20 - upDown20, 2)}, not $20.00 — leaving ${usd(upDown20, 2)}, a net ${pc2.rate(100, upDown20)}% loss`);
c.expect("reverse -20/+20", `down to ${usd(down20, 2)}, and +20% of ${usd(down20, 2)} adds ${usd(downUp20 - down20, 2)} to finish at ${usd(downUp20, 2)}`);
const upDown50 = pc2.change(pc2.change(100, 50, "increase"), 50, "decrease");
c.expect("50% r^2", `leaving ${usd(upDown50, 2)} (${pc2.rate(100, upDown50)}%)`);

// 2. Asymmetric loss-recovery table via percent-calc calcChange() and calcRate()
for (const lossPct of [10, 20, 25, 40, 50, 75]) {
  const left = pc2.change(100, lossPct, "decrease");
  const gap = 100 - left;
  const gainRateStr = pc2.rate(left, 100);
  c.expect(
    `drawdown ${lossPct}%`,
    `−${lossPct}% ${usd(left, 2)} ${usd(gap, 2)} ${gainRateStr}%`,
  );
}

// 3. Percentage points & basis points vs relative % change via percent-calc calcRate()
const rateCases = [
  ["Checkout conversion", 2.5, 3.0],
  ["Mortgage or CD rate", 4.0, 6.0],
  ["Manufacturing defect rate", 5.0, 4.0],
  ["Combined fee or tax rate", 10.0, 12.5],
];
for (const [label, a, b] of rateCases) {
  const pp = b - a;
  const bps = Math.round(pp * 100);
  const sign = pp >= 0 ? "+" : "−";
  const relStr = pc1.rate(a, b);
  c.expect(
    `rate ${label}`,
    `${label} ${a.toFixed(1)}% → ${b.toFixed(1)}% ${sign}${Math.abs(pp).toFixed(1)} pp ${sign}${Math.abs(bps)} bps ${relStr}%`,
  );
}

// 4. Markup vs Gross Margin table on $80.00 unit cost via margin-calc calc()
const cost = 80;
const pricingRows = [
  ["+15.0% markup", { mode: "margin", cost, price: cost * 1.15 }],
  ["+25.0% markup", { mode: "margin", cost, price: cost * 1.25 }],
  ["25.0% target margin", { mode: "price", cost, margin: 25 }],
  ["+50.0% markup", { mode: "margin", cost, price: cost * 1.5 }],
  ["+100.0% markup (keystone)", { mode: "margin", cost, price: cost * 2.0 }],
];
for (const [rule, spec] of pricingRows) {
  const res = runMarginCalc(spec);
  c.expect(
    `margin ${rule}`,
    `${rule} $${res.priceStr} $${res.profitStr} ${res.markupStr} ${res.marginStr}`,
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
