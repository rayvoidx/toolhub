// Figures in guides/business-days-calendar-days-deadlines/.
// Directly calls services/date-diff-calc/js/app.js (parseDate, compute) and
// services/date-add-calc/js/app.js (parseDateStr, toStr, compute) in a VM sandbox.
import { toolFns, checker } from "./lib.mjs";

const c = checker("business-days-calendar-days-deadlines");

const ddc = toolFns(
  "date-diff-calc",
  ["parseDate", "toStr", "diffDays", "addMonthsClamped", "calendarDiff", "weekdaysInclusive", "businessDays", "compute"],
  { Date, String, MS_DAY: 86400000 },
);

const dac = toolFns(
  "date-add-calc",
  ["parseDateStr", "pad2", "toStr", "inRange", "isWeekend", "addDaysCalendar", "addMonthsClamped", "addBusinessDays", "compute"],
  { Date, String },
);

// 1. Calendar days vs business days from Monday 2026-03-02 across 10, 15, 30, 45, 60 days
const start = dac.parseDateStr("2026-03-02");
for (const n of [10, 15, 30, 45, 60]) {
  const cal = dac.compute(start, "add", n, "days", false);
  const biz = dac.compute(start, "add", n, "days", true);
  const calStr = dac.toStr(cal.date);
  const bizStr = dac.toStr(biz.date);
  const extra = biz.spanDays - n;
  c.expect(
    `window ${n}`,
    `${n} days ${calStr} ${bizStr} ${biz.spanDays} days +${extra} days`,
  );
}

// 2. Exclusive (interval) vs Inclusive (both ends) on 2026-03-02 to 2026-03-31 via date-diff-calc compute()
const excl = ddc.compute(ddc.parseDate("2026-03-02"), ddc.parseDate("2026-03-31"), false);
const incl = ddc.compute(ddc.parseDate("2026-03-02"), ddc.parseDate("2026-03-31"), true);
c.expect("excl hours", `hotel nights (${excl.hours} hours)`);
c.expect("excl row", `${excl.total} days ${excl.business} ${excl.weekend}`);
c.expect("incl row", `${incl.total} days ${incl.business} ${incl.weekend}`);
c.close("fencepost +1 day", incl.total - excl.total, 1);
c.close("fencepost +1 weekday", incl.business - excl.business, 1);

// 3. Leap year 2028-02-29 vs non-leap 2027 February intervals & month-end clamping
const feb27 = ddc.compute(ddc.parseDate("2027-02-01"), ddc.parseDate("2027-03-01"), false);
const feb28 = ddc.compute(ddc.parseDate("2028-02-01"), ddc.parseDate("2028-03-01"), false);
c.expect(
  "feb 2027",
  `2027-02-01 to 2027-03-01 is ${feb27.total} days (${feb27.hours} hours: ${feb27.business} weekdays and ${feb27.weekend} weekend days)`,
);
c.expect(
  "feb 2028",
  `2028-02-01 to 2028-03-01 is ${feb28.total} days (${feb28.hours} hours: ${feb28.business} weekdays and ${feb28.weekend} weekend days)`,
);

const clamp27 = dac.compute(dac.parseDateStr("2027-01-31"), "add", 1, "months", false);
const clamp28 = dac.compute(dac.parseDateStr("2028-01-31"), "add", 1, "months", false);
const leapYr = dac.compute(dac.parseDateStr("2028-02-29"), "add", 1, "years", false);
const chainStep2 = dac.compute(clamp27.date, "add", 1, "months", false);
const direct2Mo = dac.compute(dac.parseDateStr("2027-01-31"), "add", 2, "months", false);

c.close("clamp27 flag", clamp27.clamped ? 1 : 0, 1);
c.close("clamp28 flag", clamp28.clamped ? 1 : 0, 1);
c.close("leapYr flag", leapYr.clamped ? 1 : 0, 1);
c.expect("clamp 2027-02-28", `clamps to ${dac.toStr(clamp27.date)}`);
c.expect("clamp 2028-02-29", `clamps to ${dac.toStr(clamp28.date)}`);
c.expect("leap +1 yr", `2028-02-29 clamps to ${dac.toStr(leapYr.date)}, spanning ${leapYr.spanDays} calendar days`);
c.expect(
  "non-associative months",
  `from ${dac.toStr(clamp27.date)} lands on ${dac.toStr(chainStep2.date)}, whereas adding 2 months directly to 2027-01-31 lands on ${dac.toStr(direct2Mo.date)}`,
);

c.done();
