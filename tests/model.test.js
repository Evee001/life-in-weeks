import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLife, dailyAverage, allocate, weeksByCategory, reclaim, withDrainsCut, insights,
  DAYS_PER_YEAR, HOURS_PER_YEAR,
} from '../src/model.js';
import { DEFAULT_STATE, cloneState } from '../src/state.js';
import { fmt } from '../src/format.js';

const close = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} ≈ ${expected}`);

const base = () => cloneState(DEFAULT_STATE);

test('workday activities are averaged over the week', () => {
  close(dailyAverage({ hours: 8, schedule: 'workdays' }, 5), 40 / 7);
  close(dailyAverage({ hours: 8, schedule: 'daily' }, 5), 8);
  close(dailyAverage({ hours: 8, schedule: 'workdays' }, 0), 0);
});

test('matches the original lifeInWeeks() numbers when work never stops', () => {
  // The original console version: age 24, life to 90, no retirement.
  const input = { ...base(), age: 24, lifeExpectancy: 90, retirementAge: 100 };
  const r = computeLife(input);
  close(r.yearsLeft, 66);
  close(r.workingYears, 66);
  close(r.retiredYears, 0);
  close(r.usedPerDayWorking, 8 + 40 / 7 + 5 / 7 + 1 + 0.75 + 1 + 1 + 2.5 + 2);
  close(r.freePerDayWorking, 24 - r.usedPerDayWorking);
  // ~1.3 hrs a day is ~5.5% of the time left, as in the original output.
  assert.equal(r.freePerDayWorking.toFixed(1), '1.3');
  assert.equal(r.purposefulPercent.toFixed(1), '5.5');
  close(r.purposefulYears, (r.freePerDayWorking / 24) * 66);
});

test('work and commute stop at retirement', () => {
  const r = computeLife({ ...base(), age: 24, lifeExpectancy: 80, retirementAge: 65 });
  close(r.workingYears, 41);
  close(r.retiredYears, 15);
  const work = r.rows.find((x) => x.id === 'work');
  close(work.perDayRetired, 0);
  close(work.lifetimeYears, (40 / 7 / 24) * 41);
  // Retired days are freer than working days.
  assert.ok(r.freePerDayRetired > r.freePerDayWorking);
  close(r.freePerDayRetired - r.freePerDayWorking, 45 / 7);
});

test('every remaining hour is accounted for when the day fits', () => {
  const r = computeLife(base());
  const activityHours = r.rows.reduce((s, x) => s + x.lifetimeHours, 0);
  close(activityHours + r.purposefulHours, r.totalHours, 1e-3);
  close(r.totalHours, r.yearsLeft * HOURS_PER_YEAR);
});

test('retirement age already passed means no working years', () => {
  const r = computeLife({ ...base(), age: 70, lifeExpectancy: 80, retirementAge: 65 });
  close(r.workingYears, 0);
  close(r.retiredYears, 10);
  assert.equal(r.rows.find((x) => x.id === 'work').lifetimeHours, 0);
});

test('retirement after life expectancy means working all the way', () => {
  const r = computeLife({ ...base(), age: 30, lifeExpectancy: 60, retirementAge: 70 });
  close(r.workingYears, 30);
  close(r.retiredYears, 0);
});

test('an over-full day is flagged and purposeful time never goes negative', () => {
  const input = base();
  input.activities.find((a) => a.id === 'sleep').hours = 14;
  const r = computeLife(input);
  assert.equal(r.overbooked, true);
  assert.ok(r.overbookedBy > 0);
  assert.equal(r.freePerDayWorking, 0);
  assert.ok(r.purposefulHours >= 0);
});

test('a heavy workday is not flagged once you are retired', () => {
  const input = { ...base(), age: 70, lifeExpectancy: 85, retirementAge: 65 };
  input.activities.find((a) => a.id === 'work').hours = 20;
  assert.equal(computeLife(input).overbooked, false);
});

test('no years left gives zeros, not NaN', () => {
  const r = computeLife({ ...base(), age: 80, lifeExpectancy: 80 });
  assert.equal(r.yearsLeft, 0);
  assert.equal(r.purposefulYears, 0);
  assert.equal(r.purposefulPercent, 0);
  assert.equal(r.freePerDayAverage, 0);
  for (const value of Object.values(r)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
});

test('weeks lived and left add up to the whole grid', () => {
  const r = computeLife(base());
  assert.equal(r.weeksLived + r.weeksLeft, r.totalWeeks);
  assert.equal(r.totalWeeks, Math.round(80 * DAYS_PER_YEAR / 7));
});

test('allocate always hands out exactly the total', () => {
  const parts = [{ key: 'a', weight: 1 }, { key: 'b', weight: 1 }, { key: 'c', weight: 1 }];
  const out = allocate(parts, 10);
  assert.equal(out.reduce((s, p) => s + p.count, 0), 10);
  assert.deepEqual(allocate(parts, 0).map((p) => p.count), [0, 0, 0]);
  assert.deepEqual(allocate([{ key: 'a', weight: 0 }], 5).map((p) => p.count), [0]);
});

test('weeksByCategory fills every remaining week', () => {
  const r = computeLife(base());
  const groups = weeksByCategory(r);
  assert.equal(groups.reduce((s, g) => s + g.count, 0), r.weeksLeft);
  assert.equal(groups.at(-1).key, 'purposeful');
  assert.ok(groups.at(-1).count > 0);
});

test('cutting time drains only touches drains and gives time back', () => {
  const input = base();
  const cut = withDrainsCut(input, 0.5);
  assert.equal(cut.activities.find((a) => a.id === 'social').hours, 1.25);
  assert.equal(cut.activities.find((a) => a.id === 'sleep').hours, 8);
  assert.equal(input.activities.find((a) => a.id === 'social').hours, 2.5, 'input is not mutated');

  const gain = reclaim(input, 0.5);
  close(gain.hoursPerDay, 2.25);
  assert.ok(gain.years > 0);
  close(reclaim(input, 0).years, 0);
});

test('insights are plain sentences and skip impossible plans', () => {
  const input = base();
  const r = computeLife(input);
  const list = insights(input, r, fmt);
  assert.ok(list.length >= 3);
  for (const item of list) assert.equal(typeof item.text, 'string');
  assert.ok(list.some((i) => i.id === 'cut-biggest' && i.text.includes('social media')));

  const over = base();
  over.activities.find((a) => a.id === 'sleep').hours = 20;
  assert.deepEqual(insights(over, computeLife(over), fmt), []);
});
