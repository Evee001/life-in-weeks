/**
 * Life in Weeks: calculation engine.
 *
 * Pure functions only (no DOM), so everything here is unit-tested.
 *
 * Model
 * -----
 * The years you have left are split into two phases:
 *   1. working years  (now until retirement age)
 *   2. retired years  (retirement age until life expectancy)
 *
 * Each activity takes a number of hours a day. Activities with
 * schedule "workdays" (work, commute) only happen on workdays and stop at
 * retirement; "daily" activities happen every day for the rest of your life.
 *
 * Whatever is left of the 24 hours is purposeful time: time to invest in
 * yourself, your craft, your people, or whatever you were born to do.
 */

export const HOURS_PER_DAY = 24;
export const DAYS_PER_YEAR = 365.25; // includes leap years
export const WEEKS_PER_YEAR = DAYS_PER_YEAR / 7; // ~52.18
export const HOURS_PER_YEAR = HOURS_PER_DAY * DAYS_PER_YEAR;

export const CATEGORIES = Object.freeze({
  rest: { label: 'Sleep & rest' },
  work: { label: 'Work & commute' },
  upkeep: { label: 'Upkeep' },
  drain: { label: 'Time drains' },
});

/** Average hours per calendar day an activity takes while you are working. */
export function dailyAverage(activity, workdaysPerWeek) {
  if (activity.schedule === 'workdays') {
    return (activity.hours * workdaysPerWeek) / 7;
  }
  return activity.hours;
}

function sum(values) {
  return values.reduce((total, v) => total + v, 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Work out where the rest of a life goes.
 * @param {{age:number, lifeExpectancy:number, retirementAge:number,
 *          workdaysPerWeek:number, activities:Array}} input
 */
export function computeLife(input) {
  const { age, lifeExpectancy, retirementAge, workdaysPerWeek, activities } = input;

  const yearsLeft = Math.max(0, lifeExpectancy - age);
  const workingYears = clamp(Math.min(retirementAge, lifeExpectancy) - age, 0, yearsLeft);
  const retiredYears = yearsLeft - workingYears;
  const workingDays = workingYears * DAYS_PER_YEAR;
  const retiredDays = retiredYears * DAYS_PER_YEAR;
  const totalHours = yearsLeft * HOURS_PER_YEAR;

  const rows = activities.map((activity) => {
    const perDayWorking = dailyAverage(activity, workdaysPerWeek);
    const perDayRetired = activity.schedule === 'workdays' ? 0 : activity.hours;
    const lifetimeHours = perDayWorking * workingDays + perDayRetired * retiredDays;
    return {
      ...activity,
      perDayWorking,
      perDayRetired,
      lifetimeHours,
      lifetimeYears: lifetimeHours / HOURS_PER_YEAR,
    };
  });

  const usedPerDayWorking = sum(rows.map((r) => r.perDayWorking));
  const usedPerDayRetired = sum(rows.map((r) => r.perDayRetired));
  const freePerDayWorking = Math.max(0, HOURS_PER_DAY - usedPerDayWorking);
  const freePerDayRetired = Math.max(0, HOURS_PER_DAY - usedPerDayRetired);

  const purposefulHours = freePerDayWorking * workingDays + freePerDayRetired * retiredDays;
  const purposefulDays = purposefulHours / HOURS_PER_DAY;

  // A day can't hold more than 24 hours. The busiest phase you will
  // actually live through decides whether the plan is impossible.
  const overbookedBy = Math.max(
    retiredYears > 0 && workingYears === 0 ? 0 : usedPerDayWorking - HOURS_PER_DAY,
    retiredYears > 0 ? usedPerDayRetired - HOURS_PER_DAY : 0,
  );

  const byCategory = {};
  for (const key of Object.keys(CATEGORIES)) {
    const inCategory = rows.filter((r) => r.category === key);
    byCategory[key] = {
      perDayWorking: sum(inCategory.map((r) => r.perDayWorking)),
      lifetimeHours: sum(inCategory.map((r) => r.lifetimeHours)),
      lifetimeYears: sum(inCategory.map((r) => r.lifetimeYears)),
    };
  }

  const totalWeeks = Math.round(lifeExpectancy * WEEKS_PER_YEAR);
  const weeksLived = Math.min(totalWeeks, Math.round(age * WEEKS_PER_YEAR));

  return {
    yearsLeft,
    workingYears,
    retiredYears,
    daysLeft: yearsLeft * DAYS_PER_YEAR,
    totalHours,
    rows,
    byCategory,
    usedPerDayWorking,
    usedPerDayRetired,
    freePerDayWorking,
    freePerDayRetired,
    // Averaged over the whole remaining life (working + retired years).
    freePerDayAverage: yearsLeft > 0 ? purposefulHours / (yearsLeft * DAYS_PER_YEAR) : 0,
    purposefulHours,
    purposefulDays,
    purposefulWeeks: purposefulDays / 7,
    purposefulYears: purposefulHours / HOURS_PER_YEAR,
    purposefulPercent: totalHours > 0 ? (purposefulHours / totalHours) * 100 : 0,
    overbooked: overbookedBy > 1e-9,
    overbookedBy: Math.max(0, overbookedBy),
    totalWeeks,
    weeksLived,
    weeksLeft: totalWeeks - weeksLived,
  };
}

/**
 * Split `total` whole units between parts in proportion to their weights,
 * using the largest-remainder method so the counts always add up exactly.
 * @param {Array<{key:string, weight:number}>} parts
 */
export function allocate(parts, total) {
  const weightSum = sum(parts.map((p) => Math.max(0, p.weight)));
  if (total <= 0 || weightSum <= 0) {
    return parts.map((p) => ({ key: p.key, count: 0 }));
  }
  const exact = parts.map((p) => (Math.max(0, p.weight) / weightSum) * total);
  const counts = exact.map(Math.floor);
  let remaining = total - sum(counts);
  const order = exact
    .map((value, i) => ({ i, rem: value - Math.floor(value) }))
    .sort((a, b) => b.rem - a.rem);
  for (let k = 0; remaining > 0; k = (k + 1) % order.length, remaining -= 1) {
    counts[order[k].i] += 1;
  }
  return parts.map((p, i) => ({ key: p.key, count: counts[i] }));
}

/** The remaining weeks, grouped by category, for the life grid. */
export function weeksByCategory(result) {
  const parts = Object.keys(CATEGORIES).map((key) => ({
    key,
    weight: result.byCategory[key].lifetimeHours,
  }));
  parts.push({ key: 'purposeful', weight: result.purposefulHours });
  return allocate(parts, result.weeksLeft);
}

/** Return a copy of the input with every time-drain activity cut by `fraction`. */
export function withDrainsCut(input, fraction) {
  const keep = 1 - clamp(fraction, 0, 1);
  return {
    ...input,
    activities: input.activities.map((a) =>
      a.category === 'drain' ? { ...a, hours: a.hours * keep } : a,
    ),
  };
}

/** How much purposeful time you gain by cutting time drains by `fraction`. */
export function reclaim(input, fraction) {
  const before = computeLife(input);
  const after = computeLife(withDrainsCut(input, fraction));
  return {
    hoursPerDay: after.freePerDayWorking - before.freePerDayWorking,
    years: after.purposefulYears - before.purposefulYears,
    weeks: after.purposefulWeeks - before.purposefulWeeks,
  };
}

/**
 * Plain-language findings for the current numbers.
 * Each insight is {id, text}; text is plain (rendered with textContent).
 */
export function insights(input, result, fmt) {
  const out = [];
  if (result.yearsLeft <= 0 || result.overbooked) return out;

  const drains = result.rows.filter((r) => r.category === 'drain' && r.hours > 0);
  const drainYears = result.byCategory.drain.lifetimeYears;

  if (drains.length > 0 && drainYears > 0) {
    const ratio = result.purposefulYears > 0 ? drainYears / result.purposefulYears : Infinity;
    const comparison =
      result.purposefulYears <= 0
        ? 'and leave no purposeful time at all.'
        : ratio >= 1.05
          ? `which is ${fmt.ratio(ratio)} your purposeful time.`
          : ratio <= 0.95
            ? `which is less than your purposeful time. Good.`
            : 'about the same as your purposeful time.';
    out.push({
      id: 'drains',
      text: `Time drains will take ${fmt.years(drainYears)} of your remaining life, ${comparison}`,
    });

    const biggest = [...drains].sort((a, b) => b.hours - a.hours)[0];
    const cut = Math.min(1, biggest.hours);
    const cutInput = {
      ...input,
      activities: input.activities.map((a) =>
        a.id === biggest.id ? { ...a, hours: a.hours - cut } : a,
      ),
    };
    const gained = computeLife(cutInput).purposefulYears - result.purposefulYears;
    if (gained > 0) {
      out.push({
        id: 'cut-biggest',
        text: `Spending ${fmt.duration(cut)} less a day on ${biggest.name.toLowerCase()} gives you back ${fmt.years(gained)}.`,
      });
    }
  }

  if (result.workingYears > 0 && result.retiredYears > 0) {
    const diff = result.freePerDayRetired - result.freePerDayWorking;
    if (diff > 0.05) {
      out.push({
        id: 'retirement',
        text: `After you retire at ${input.retirementAge}, your free time grows from ${fmt.duration(result.freePerDayWorking)} to ${fmt.duration(result.freePerDayRetired)} a day.`,
      });
    }
  }

  const weekly = result.freePerDayWorking * 7;
  if (result.workingYears > 0 && weekly > 0) {
    out.push({
      id: 'weekly',
      text: `While you are working, that is ${fmt.duration(weekly)} a week. One hour a day on a single skill adds up to 365 hours a year.`,
    });
  }

  return out;
}
