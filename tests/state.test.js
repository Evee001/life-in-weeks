import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STATE, PRESETS, LIMITS, cloneState, sanitizeState, encodeState, decodeState, matchingPreset,
} from '../src/state.js';
import { fmt } from '../src/format.js';

test('sanitizeState returns defaults for junk', () => {
  for (const junk of [null, undefined, 42, 'x', [], { activities: 'nope' }]) {
    const s = sanitizeState(junk);
    assert.equal(s.age, DEFAULT_STATE.age);
    assert.ok(Array.isArray(s.activities));
  }
});

test('sanitizeState clamps numbers and keeps age below life expectancy', () => {
  const s = sanitizeState({ age: 500, lifeExpectancy: 60, retirementAge: -5, workdaysPerWeek: 9, activities: [] });
  assert.equal(s.lifeExpectancy, 60);
  assert.equal(s.age, 59);
  assert.equal(s.retirementAge, LIMITS.retirementAge.min);
  assert.equal(s.workdaysPerWeek, 7);
  assert.deepEqual(s.activities, []);
});

test('sanitizeState cleans activities', () => {
  const s = sanitizeState({
    ...DEFAULT_STATE,
    activities: [
      { id: 'x', name: '  Gaming\u0000  night ', hours: 30, category: 'evil', schedule: 'sometimes' },
      { id: 'x', name: 'Gym', hours: 1.1, category: 'upkeep', schedule: 'daily' },
      { id: 'y', name: '', hours: 1 },
      null,
    ],
  });
  assert.equal(s.activities.length, 2);
  assert.deepEqual(s.activities[0], { id: 'x', name: 'Gaming night', hours: 24, category: 'upkeep', schedule: 'daily' });
  assert.equal(s.activities[1].id, 'xx', 'duplicate ids are made unique');
  assert.equal(s.activities[1].hours, 1, 'hours snap to quarter hours');
});

test('names are length-limited and activity count is capped', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ id: `a${i}`, name: 'x'.repeat(200), hours: 0.25 }));
  const s = sanitizeState({ ...DEFAULT_STATE, activities: many });
  assert.equal(s.activities.length, LIMITS.maxActivities);
  assert.equal(s.activities[0].name.length, LIMITS.nameLength);
});

test('share links round-trip, including non-ASCII names', () => {
  const state = cloneState(DEFAULT_STATE);
  state.age = 31;
  state.activities.push({ id: 'c1', name: 'Église & café ☕', hours: 1.5, category: 'drain', schedule: 'daily' });
  const code = encodeState(state);
  assert.match(code, /^[A-Za-z0-9_-]+$/, 'URL-safe');
  assert.deepEqual(decodeState(code), sanitizeState(state));
});

test('decodeState rejects bad input instead of throwing', () => {
  for (const bad of ['', '!!!', 'eyJ4IjoxfQ', 'a'.repeat(5000), null]) {
    assert.equal(decodeState(bad), null);
  }
});

test('presets are valid and recognised', () => {
  for (const preset of PRESETS) {
    assert.deepEqual(sanitizeState(preset.state), cloneState(preset.state), `${preset.id} survives sanitizing`);
    assert.equal(matchingPreset(preset.state), preset.id);
  }
  const edited = cloneState(DEFAULT_STATE);
  edited.age = 40;
  assert.equal(matchingPreset(edited), null);
});

test('formatting helpers', () => {
  assert.equal(fmt.duration(1.3), '1 hr 20 min');
  assert.equal(fmt.duration(2), '2 hrs');
  assert.equal(fmt.duration(0.75), '45 min');
  assert.equal(fmt.duration(0), '0 min');
  assert.equal(fmt.years(3.62), '3.6 years');
  assert.equal(fmt.years(1), '1 year');
  assert.equal(fmt.years(0.5), '6 months');
  assert.equal(fmt.years(0), '0 years');
  assert.equal(fmt.ratio(2.04), 'twice');
  assert.equal(fmt.ratio(3.44), '3.4 times');
  assert.equal(fmt.percent(5.53), '5.5%');
  assert.equal(fmt.hoursShort(5.714), '5.7h');
  assert.equal(fmt.int(12345.6), '12,346');
});
