// Figures in guides/bmi-vs-waist-to-height-ratio/. BMI bands: bmi-calc classify() + its BANDS table;
// body fat: body-fat-calc computeBodyFat()/classify(); ideal weight: ideal-weight-calc computeIdeal()/healthyRange();
// waist-to-hip bands mirror waist-hip-ratio-calc calc() (ratio rounded to 2 dp, CUT table) — DOM-bound, so reproduced.
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { toolFns, checker, ROOT } from "./lib.mjs";

const c = checker("bmi-vs-waist-to-height-ratio");
const literal = (slug, name) => {
  const src = fs.readFileSync(path.join(ROOT, "services", slug, "js/app.js"), "utf8");
  const m = src.match(new RegExp("var " + name + " = (\\{[\\s\\S]*?\\n  \\});"));
  return vm.runInNewContext("(" + m[1] + ")", { Infinity });
};
const BANDS = literal("bmi-calc", "BANDS");
const CUT = literal("waist-hip-ratio-calc", "CUT");
const { classify } = toolFns("bmi-calc", ["classify"], { BANDS });
const bf = toolFns("body-fat-calc", ["computeBodyFat", "log10", "classify"]);
const iw = toolFns("ideal-weight-calc", ["computeIdeal", "frameFactor", "healthyRange"]);
const WHO = { "tool.band.under": "Under", "tool.band.normal": "Normal", "tool.band.overweight": "Overweight", "tool.band.obese": "Obese" };
const ASIA = { "tool.band.normal": "Normal", "tool.band.preObese": "At risk", "tool.band.obese1": "Obese class I", "tool.band.obese2": "Obese class II" };
const nice = (r) => (r >= 0.6 ? "High" : r >= 0.5 ? "Increased" : r >= 0.4 ? "Healthy" : "unclassified");
const whrBand = (sex, w, h) => { const r = Math.round((w / h) * 100) / 100, k = CUT[sex]; return r >= k.high ? "high" : r >= k.mod ? "mod" : "low"; };

// NICE worked example
c.expect("NICE cm", "96.5 ÷ 170 = " + (96.5 / 170).toFixed(4)); c.expect("NICE in", "38 ÷ 67 = " + (38 / 67).toFixed(4));
c.close("NICE rounds to 0.57", Math.round((96.5 / 170) * 100), 57);

const people = [
  ["A", "male", 175, 82, 81, 40, null], ["B", "male", 165, 64, 88, null, 96],
  ["C", "female", 160, 58, 84, null, 98], ["D", "male", 182, 90, 104, null, 104],
];
for (const [n, sex, h, w, waist, neck, hip] of people) {
  const bmi = w / (h / 100) ** 2, whtr = waist / h;
  const row = `${h} cm, ${w} kg, ${waist} cm ${bmi.toFixed(2)} ${WHO[classify(bmi, "who").key]} ${ASIA[classify(bmi, "asia").key]} ${whtr.toFixed(3)} ${nice(whtr)}`;
  c.expect("table row " + n, row);
  if (hip) c.expect("WHR " + n, (waist / hip).toFixed(n === "D" ? 2 : 3));
}
c.expect("BMI intro", "82 ÷ 1.75² = 26.78");
c.expect("A whtr", "giving 0.463");
const a = bf.computeBodyFat("male", 175, 82, 40, 81, 0);
c.expect("A body fat", "about " + a.bf.toFixed(1) + "% body fat"); c.close("A athletes band", bf.classify("male", a.bf) === "athletes" ? 1 : 0, 1);
c.expect("B 23.51", "sits at 23.51"); c.expect("B whtr", "88 ÷ 165 = 0.533");
c.close("B WHR male >= 0.90", whrBand("male", 88, 96) === "mod" ? 1 : 0, 1);
c.expect("C WHR", "84 ÷ 98 = 0.857"); c.close("C WHR band high", whrBand("female", 84, 98) === "high" ? 1 : 0, 1);
c.close("C waist >= 80 (w1)", 84 >= CUT.female.w1 ? 1 : 0, 1);
c.close("D WHR 1.00", Math.round((104 / 104) * 100) / 100, 1);
c.close("edge 0.8469 shows 0.85 high", whrBand("female", 84.69, 100) === "high" ? 1 : 0, 1);
c.close("swap 98/84 no 1.5x warning", 98 > 84 * 1.5 ? 1 : 0, 0);
for (const h of [175, 160]) c.expect("half height " + h, `under ${num1(h / 2)} cm`);
function num1(x) { return Number.isInteger(x) ? String(x) : x.toFixed(1); }
c.expect("mixed units", "gives " + (34 / 170).toFixed(1));
c.expect("height 2cm BMI", "lowers BMI by about " + ((1 - (165 / 167) ** 2) * 100).toFixed(1) + "%");
c.expect("height 2cm WHtR", "WHtR by about " + ((1 - 165 / 167) * 100).toFixed(1) + "%");

const m = iw.computeIdeal("male", 175, "medium"), f = iw.computeIdeal("female", 160, "medium");
const one = (x) => x.toFixed(1);
const hr = iw.healthyRange(175), hf = iw.healthyRange(160);
c.expect("male ideal", `${one(m.devine)} kg (Devine), ${one(m.robinson)} kg (Robinson), ${one(m.miller)} kg (Miller) and ${one(m.hamwi)} kg (Hamwi)`);
const vals = Object.values(m); c.expect("spread", `a ${one(Math.max(...vals) - Math.min(...vals))} kg spread`);
c.close("BMI range almost 20 kg", Math.round(hr.max - hr.min), 20);
c.expect("male range", `${one(hr.min)} to ${one(hr.max)} kg`);
c.expect("female ideal", `${one(f.devine)}, ${one(f.robinson)}, ${one(f.miller)} and ${one(f.hamwi)} kg`);
c.expect("female range", `${one(hf.min)} to ${one(hf.max)} kg`);
c.done();
