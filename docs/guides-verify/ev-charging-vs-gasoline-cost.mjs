// Figures in guides/ev-charging-vs-gasoline-cost/. Gasoline costs call fuel-cost-calc's own compute();
// the charging session mirrors services/ev-charging-calc/js/app.js calc() lines 117-150 (toBattery, fromWall = ÷eff,
// hours = fromWall/kW, range from toBattery, cost from fromWall) and uses its own fmtTime();
// mpg conversions mirror services/mpg-calc/js/app.js calc() lines 116-130 (×1.201, 235.215 ÷ mpg).
import { toolFns, checker, usd, num } from "./lib.mjs";
const c = checker("ev-charging-vs-gasoline-cost");
const fuel = toolFns("fuel-cost-calc", ["compute", "litersPerKm", "pricePerLiter"], { KM_PER_MI: 1.609344, L_PER_US_GAL: 3.785411784, L_PER_UK_GAL: 4.54609 });
const { fmtTime } = toolFns("ev-charging-calc", ["fmtTime"], { t: (k) => (k === "tool.unit.h" ? "h" : "min") });
const GAS = 3.805, ELEC = 0.1816, KWH100 = 30, L2 = 0.30, DC = 0.48;

const gas100 = (mpg) => fuel.compute(100, "mi", mpg, "mpgUS", GAS, "usgal", false, 1, "usgal");
for (const mpg of [25, 30, 40, 50]) {
  const r = gas100(mpg);
  c.expect(`${mpg} gal`, r.gallons.toFixed(2)); c.expect(`${mpg} cost`, usd(r.totalCost, 2));
  c.close(`${mpg} costPerDist`, r.costPerDist * 100, r.totalCost, 1e-9);
}
c.expect("home", usd(KWH100 * ELEC, 2)); c.expect("L2", usd(KWH100 * L2, 2)); c.expect("DC", usd(KWH100 * DC, 2));
for (const mpg of [25, 30, 50]) c.expect(`breakeven ${mpg}`, (gas100(mpg).totalCost / KWH100 * 100).toFixed(1) + "¢/kWh");

// dashboard → wall
c.expect("wall", (27 / 0.9).toFixed(1) + " kWh per 100 miles from the wall"); c.expect("dash direct", usd(27 * ELEC, 2));
c.expect("10% low", Math.round((1 - 27 * ELEC / (30 * ELEC)) * 100) + "% too low");

// ev-charging-calc session
const toBattery = 75 * (80 - 20) / 100, fromWall = toBattery / 0.9, hours = fromWall / 7.2;
c.expect("battery", toBattery + " kWh"); c.expect("wall kWh", fromWall.toFixed(1) + " kWh");
c.expect("time", fmtTime(hours)); c.expect("range", Math.round(toBattery * 3.5) + " mi"); c.expect("session cost", "$" + (fromWall * ELEC).toFixed(2));

// MPGe
const mpge = 33.7 / (KWH100 / 100);
c.expect("mpge", mpge.toFixed(1) + " MPGe"); c.close("mpge back to cost", 100 * 33.7 / mpge * ELEC, KWH100 * ELEC, 1e-9);
c.expect("3.7x", (mpge / 30).toFixed(1) + " times"); c.expect("2.3x", (gas100(30).totalCost / (KWH100 * ELEC)).toFixed(1) + " times");

// year
const MI = 12000, kwhYr = MI * KWH100 / 100, gasYr = fuel.compute(MI, "mi", 30, "mpgUS", GAS, "usgal", false, 1, "usgal");
c.expect("kwh yr", num(kwhYr) + " kWh"); c.expect("gal yr", Math.round(gasYr.gallons) + " gallons"); c.expect("gas yr", usd(gasYr.totalCost, 2));
c.expect("home yr", usd(kwhYr * ELEC, 2)); const mix = kwhYr * (0.8 * ELEC + 0.2 * DC); c.expect("mix yr", usd(mix, 2));
c.expect("dc yr", usd(kwhYr * DC, 2)); c.expect("mix saving", usd(gasYr.totalCost - mix, 2));

// mpg-calc
const mpg = 342 / 11.4; c.expect("mpg", mpg.toFixed(1) + " mpg"); c.expect("l100", (235.215 / mpg).toFixed(2) + " L/100 km"); c.expect("imp", (mpg * 1.201).toFixed(1) + " mpg in imperial");
c.expect("km→mi", (18 * 1.609344).toFixed(2) + " kWh per 100 miles");
c.close("UK mpg ≈ 20% higher", 1.201, 4.54609 / 3.785411784, 0.001);
// Level 1 (electricity-cost-calc: kWh/day = W × h / 1000)
c.expect("L1 kWh", (1440 * 8 / 1000) + " kWh"); c.expect("L1 cost", usd(1440 * 8 / 1000 * ELEC, 2));
c.done();
