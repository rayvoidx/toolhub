// Figures in guides/predicting-race-times/. Riegel step mirrors race-time-predictor calc()
// (t2 = t1 * Math.pow(d2 / d1, exponent()); pace = t2 / d2, mile pace = t2 / d2 * MI; note when d2/d1 > 4).
// Rounding uses the tool's own fmt(); pace/speed use pace-calc deriveStats() and formatClock().
import { toolFns, checker } from "./lib.mjs";

const c = checker("predicting-race-times");
const { fmt } = toolFns("race-time-predictor", ["fmt"]);
const MI = 1.609344, KM = { "5k": 5, "10k": 10, half: 21.0975, full: 42.195 }; // race-time-predictor KM table
const { deriveStats, formatClock } = toolFns("pace-calc", ["deriveStats", "formatClock"], { MI_M: 1609.344 });
const riegel = (t1, d1, d2, k = 1.06) => t1 * Math.pow(d2 / d1, k);

c.expect("2^1.06", "2 1.06 = " + (2 ** 1.06).toFixed(3));
c.expect("per doubling 1.06", "about " + ((2 ** 0.06 - 1) * 100).toFixed(1) + "% slower");
c.expect("per doubling 1.07", "1.07 the pace penalty per doubling is " + ((2 ** 0.07 - 1) * 100).toFixed(1) + "%");
c.expect("per doubling 1.08", "at 1.08 it is " + ((2 ** 0.08 - 1) * 100).toFixed(1) + "%");
c.close("5K→marathon > 3 doublings", Math.log2(KM.full / 5) > 3 ? 1 : 0, 1);

const s5 = deriveStats(5000, 1500);
c.expect("5K pace", `8:03 per mile, ${s5.speedKmh} km/h or ${s5.speedMph.toFixed(2)} mph`);
c.close("8:03/mi", formatClock(s5.paceMiSec) === "8:03" ? 1 : 0, 1);
for (const [k, label] of [["10k", "10K"], ["half", "Half marathon (21.0975 km)"], ["full", "Marathon (42.195 km)"]]) {
  const t = riegel(1500, 5, KM[k]);
  c.expect("5K table " + k, `${label} ${fmt(t)} ${fmt(t / KM[k])} ${fmt((t / KM[k]) * MI)}`);
}
c.expect("ratio", "42.195 ÷ 5 = " + (KM.full / 5).toFixed(3));
c.expect("multiplier", "8.439 1.06 = " + Math.pow(KM.full / 5, 1.06).toFixed(3));
c.expect("24:00 5K", "A 24:00 5K forecasts " + fmt(riegel(1440, 5, KM.full)));
c.expect("stretch note ratio", "a ratio of " + (KM.half / 5).toFixed(4)); c.close("note fires", KM.half / 5 > 4 ? 1 : 0, 1);

const th = 6900, t10 = 3120;
c.expect("own k", "= " + (Math.log(th / t10) / Math.log(KM.half / 10)).toFixed(3));
const ks = [1.04, 1.05, 1.06, 1.07, 1.08], fulls = ks.map((k) => riegel(th, KM.half, KM.full, k));
ks.forEach((k, i) => c.expect("exp row " + k, `${k.toFixed(2)} ${fmt(fulls[i])} ${fmt(fulls[i] / KM.full)}`));
const span = Math.round(fulls[4]) - Math.round(fulls[0]);
c.expect("span", `spans ${Math.floor(span / 60)} minutes ${span % 60} seconds`);

const f106 = riegel(th, KM.half, KM.full);
c.expect("1.06 from half", "was " + fmt(f106) + "; ten minutes slower is " + fmt(f106 + 600) + ", or " + fmt((f106 + 600) / KM.full));
c.expect("implied k", "about " + (Math.log((f106 + 600) / th) / Math.log(KM.full / KM.half)).toFixed(3));

const gps = riegel(1500, 5.12, KM.full), off = riegel(1500, 5, KM.full);
c.expect("GPS forecast", "produces a " + fmt(gps) + " marathon forecast"); c.expect("GPS official", "the " + fmt(off) + " from the official");
c.close("almost six minutes", Math.round((off - gps) / 60), 6);

const sf = deriveStats(42195, f106);
c.expect("marathon pace mi", fmt(f106 / KM.full) + " per km marathon pace is " + formatClock(sf.paceMiSec) + " per mile");
c.expect("marathon speed", `${sf.speedKmh.toFixed(2)} km/h and ${sf.speedMph.toFixed(2)} mph`);
c.expect("decimal", "which is " + formatClock(5.3 * 60));
c.close("decimal trap > 8 min", (12 * KM.full) / 60 > 8 ? 1 : 0, 1);
c.done();
