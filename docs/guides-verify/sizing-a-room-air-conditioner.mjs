// Figures in guides/sizing-a-room-air-conditioner/.
// rule(): mirrors services/btu-calc/js/app.js calc() lines 106-131 (20 BTU/sq ft × h/8 × sun, +600/person over 2,
// +4000 kitchen, × climate, round to 500) — DOM-bound there, so reproduced. Unit factors are read from the converters.
// monthCost(): mirrors services/electricity-cost-calc/js/app.js calc() lines 105-125 (kWh/day × 30.44).
import fs from "node:fs";
import { ROOT, checker, usd, num } from "./lib.mjs";
const c = checker("sizing-a-room-air-conditioner");
const pc = fs.readFileSync(ROOT + "/services/power-conv/js/app.js", "utf8");
const W_PER_BTUH = parseFloat(pc.match(/btuh:\s*([\d.]+)/)[1]), W_PER_TON = parseFloat(pc.match(/rt:\s*([\d.]+)/)[1]);
const ec = fs.readFileSync(ROOT + "/services/energy-conv/js/app.js", "utf8");
const J_PER_BTU = parseFloat(ec.match(/BTU:\s*([\d.]+)/)[1]);
const BTU_PER_KWH = 3.6e6 / J_PER_BTU;

for (const b of [5000, 8000, 12000, 24000]) {
  c.expect(`${b} tons`, (b / 12000).toFixed(2)); c.expect(`${b} W`, num(b * W_PER_BTUH) + " W");
}
c.close("ton = 12000 BTU/h", W_PER_TON, 12000 * W_PER_BTUH, 1e-6);

const CHART = [[100, 150, 5000], [150, 250, 6000], [250, 300, 7000], [300, 350, 8000], [350, 400, 9000], [400, 450, 10000], [450, 550, 12000],
  [550, 700, 14000], [700, 1000, 18000], [1000, 1200, 21000], [1200, 1400, 23000], [1400, 1500, 24000], [1500, 2000, 30000], [2000, 2500, 34000]];
for (const [lo, hi, cap] of [[100, 150, 5000], [250, 300, 7000], [450, 550, 12000], [1000, 1200, 21000], [2000, 2500, 34000]])
  c.expect(`implied ${lo}`, (cap / ((lo + hi) / 2)).toFixed(1));
const chart = (a) => CHART.find(([lo, hi]) => a >= lo && a < hi)[2];
const es = (a, sun = 1, people = 2, kitchen = false) => chart(a) * sun + Math.max(0, people - 2) * 600 + (kitchen ? 4000 : 0);
function rule(lenFt, widFt, hFt = 8, sun = 1, people = 2, kitchen = false, cf = 1) {
  let btu = lenFt * widFt * 20 * (hFt / 8) * sun + Math.max(0, people - 2) * 600 + (kitchen ? 4000 : 0);
  return Math.round(btu * cf / 500) * 500;
}
const M = 3.280839895; // TO_FT.m in btu-calc
const rooms = [
  ["A", rule(10, 12), es(120)], ["B", rule(14, 16, 8, 1.1, 4), es(224, 1.1, 4)], ["C", rule(20, 25, 8, 1, 3, true), es(500, 1, 3, true)],
  ["D", rule(12, 15, 10, 0.9), es(180, 0.9)], ["E", rule(4 * M, 5 * M), es(4 * M * 5 * M)],
];
const want = { A: [2500, 5000], B: [6000, 7800], C: [14500, 16600], D: [4000, 5400], E: [4500, 6000] };
for (const [k, r, e] of rooms) { c.close(`room ${k} rule`, r, want[k][0]); c.close(`room ${k} chart`, Math.round(e), want[k][1]); c.expect(`room ${k}`, num(r)); c.expect(`room ${k} es`, num(e)); }
c.expect("E sqft", (4 * M * 5 * M).toFixed(1) + " sq ft");
c.expect("B raw", num(224 * 20 * 1.1 + 1200));
c.expect("D raw", num(180 * 20 * 1.25 * 0.9));
c.expect("E kW", (6000 * W_PER_BTUH / 1000).toFixed(2) + " kW");

// CEER → kWh (FEMP table: 584 / 612 / 826)
const PRICE = 0.1816, HRS = 750;
const kwh = (ceer) => 12000 / ceer * HRS / 1000;
const femp = { 15.4: 584, 14.7: 612, 10.9: 826 };
for (const [ceer, k] of Object.entries(femp)) { c.close(`FEMP ${ceer}`, Math.round(kwh(+ceer)), k); c.expect(`cost ${ceer}`, usd(kwh(+ceer) * PRICE, 2)); }
const save = (kwh(10.9) - kwh(14.7)) * PRICE;
c.expect("saving", usd(save, 2)); c.expect("9 yr", "$" + Math.round(save * 9));
// running watts and electricity-cost-calc month
const w = 12000 / 14.7; c.expect("watts", Math.round(w) + " W");
const kwhMonth = Math.round(w) * 8 / 1000 * 30.44;
c.expect("month kWh", Math.round(kwhMonth) + " kWh"); c.expect("month $", usd(kwhMonth * PRICE, 2));
c.expect("BTU per kWh", num(BTU_PER_KWH) + " BTU");
c.expect("2.1 million", (kwh(14.7) * BTU_PER_KWH / 1e6).toFixed(1) + " million BTU");
c.expect("9 million", (12000 * HRS / 1e6) + " million BTU");
c.expect("kitchen third", "4,000 BTU/h is a third of the 12,000");
c.expect("4x factor", "about four times"); c.close("cooling/electric ratio ≈ 4", 12000 * W_PER_BTUH / w, 4.3, 0.05);
c.done();
