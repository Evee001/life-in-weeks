/**
 * App state: defaults, presets, validation and (de)serialisation.
 *
 * Anything coming from the URL or localStorage is untrusted, so it always goes
 * through sanitizeState() before the app uses it.
 */

import { CATEGORIES } from './model.js';

export const LIMITS = Object.freeze({
  age: { min: 0, max: 109, step: 1 },
  lifeExpectancy: { min: 30, max: 110, step: 1 },
  retirementAge: { min: 30, max: 100, step: 1 },
  workdaysPerWeek: { min: 0, max: 7, step: 0.5 },
  hours: { min: 0, max: 24, step: 0.25 },
  nameLength: 40,
  maxActivities: 20,
});

export const SCHEDULES = Object.freeze(['daily', 'workdays']);

/**
 * Starting averages. They are deliberately round numbers for a typical
 * working adult, not survey data. Every one of them is editable in the app.
 */
const DEFAULT_ACTIVITIES = [
  { id: 'sleep', name: 'Sleep', hours: 8, category: 'rest', schedule: 'daily' },
  { id: 'work', name: 'Work', hours: 8, category: 'work', schedule: 'workdays' },
  { id: 'commute', name: 'Commute', hours: 1, category: 'work', schedule: 'workdays' },
  { id: 'cooking', name: 'Cooking', hours: 1, category: 'upkeep', schedule: 'daily' },
  { id: 'cleaning', name: 'Cleaning & chores', hours: 0.75, category: 'upkeep', schedule: 'daily' },
  { id: 'eating', name: 'Eating', hours: 1, category: 'upkeep', schedule: 'daily' },
  { id: 'care', name: 'Personal care', hours: 1, category: 'upkeep', schedule: 'daily' },
  { id: 'social', name: 'Social media', hours: 2.5, category: 'drain', schedule: 'daily' },
  { id: 'tv', name: 'TV & streaming', hours: 2, category: 'drain', schedule: 'daily' },
];

export const DEFAULT_STATE = Object.freeze({
  age: 24,
  lifeExpectancy: 80,
  retirementAge: 65,
  workdaysPerWeek: 5,
  activities: DEFAULT_ACTIVITIES,
});

function withHours(overrides) {
  return DEFAULT_ACTIVITIES.map((a) => (a.id in overrides ? { ...a, hours: overrides[a.id] } : { ...a }));
}

export const PRESETS = Object.freeze([
  {
    id: 'average',
    label: 'Average adult',
    state: { ...DEFAULT_STATE, activities: withHours({}) },
  },
  {
    id: 'lagos',
    label: 'Lagos commuter',
    state: {
      ...DEFAULT_STATE,
      workdaysPerWeek: 5.5,
      activities: withHours({ sleep: 7, commute: 3, cooking: 1.25, social: 3, tv: 1 }),
    },
  },
  {
    id: 'remote',
    label: 'Remote worker',
    state: {
      ...DEFAULT_STATE,
      activities: withHours({ commute: 0, sleep: 7.5, social: 3, tv: 2.5 }),
    },
  },
]);

export function cloneState(state) {
  return { ...state, activities: state.activities.map((a) => ({ ...a })) };
}

function num(value, { min, max }, fallback) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanName(value) {
  if (typeof value !== 'string') return '';
  // Strip control characters and collapse whitespace.
  return value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.nameLength);
}

function cleanId(value, index) {
  const id = typeof value === 'string' ? value.replace(/[^a-z0-9-]/gi, '').slice(0, 24) : '';
  return id || `a${index}`;
}

/** Validate and normalise any state-like object. Never throws. */
export function sanitizeState(raw) {
  const base = cloneState(DEFAULT_STATE);
  if (!raw || typeof raw !== 'object') return base;

  const lifeExpectancy = Math.round(num(raw.lifeExpectancy, LIMITS.lifeExpectancy, base.lifeExpectancy));
  const age = Math.round(num(raw.age, { min: LIMITS.age.min, max: lifeExpectancy - 1 }, Math.min(base.age, lifeExpectancy - 1)));
  const retirementAge = Math.round(num(raw.retirementAge, LIMITS.retirementAge, base.retirementAge));
  const workdaysPerWeek = Math.round(num(raw.workdaysPerWeek, LIMITS.workdaysPerWeek, base.workdaysPerWeek) * 2) / 2;

  let activities = base.activities;
  if (Array.isArray(raw.activities)) {
    const seen = new Set();
    activities = raw.activities
      .slice(0, LIMITS.maxActivities)
      .map((a, i) => {
        if (!a || typeof a !== 'object') return null;
        const name = cleanName(a.name);
        if (!name) return null;
        let id = cleanId(a.id, i);
        while (seen.has(id)) id = `${id}x`;
        seen.add(id);
        return {
          id,
          name,
          hours: Math.round(num(a.hours, LIMITS.hours, 0) * 4) / 4,
          category: Object.hasOwn(CATEGORIES, a.category) ? a.category : 'upkeep',
          schedule: SCHEDULES.includes(a.schedule) ? a.schedule : 'daily',
        };
      })
      .filter(Boolean);
  }

  return { age, lifeExpectancy, retirementAge, workdaysPerWeek, activities };
}

// ---- URL sharing -----------------------------------------------------------
// Compact array form keeps share links short:
// [v, age, lifeExpectancy, retirementAge, workdays, [[id,name,hours,cat,sched],...]]

const CAT_CODES = { rest: 'r', work: 'w', upkeep: 'u', drain: 'd' };
const CAT_FROM_CODE = Object.fromEntries(Object.entries(CAT_CODES).map(([k, v]) => [v, k]));

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded) {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeState(state) {
  const compact = [
    1,
    state.age,
    state.lifeExpectancy,
    state.retirementAge,
    state.workdaysPerWeek,
    state.activities.map((a) => [a.id, a.name, a.hours, CAT_CODES[a.category], a.schedule === 'workdays' ? 1 : 0]),
  ];
  return toBase64Url(JSON.stringify(compact));
}

/** Returns a sanitised state, or null if the string isn't a valid share code. */
export function decodeState(encoded) {
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > 4000) return null;
  try {
    const data = JSON.parse(fromBase64Url(encoded));
    if (!Array.isArray(data) || data[0] !== 1 || !Array.isArray(data[5])) return null;
    return sanitizeState({
      age: data[1],
      lifeExpectancy: data[2],
      retirementAge: data[3],
      workdaysPerWeek: data[4],
      activities: data[5].map((a) =>
        Array.isArray(a)
          ? { id: a[0], name: a[1], hours: a[2], category: CAT_FROM_CODE[a[3]], schedule: a[4] === 1 ? 'workdays' : 'daily' }
          : null,
      ),
    });
  } catch {
    return null;
  }
}

/** Which preset (if any) the state matches exactly. */
export function matchingPreset(state) {
  const key = encodeState(state);
  const preset = PRESETS.find((p) => encodeState(p.state) === key);
  return preset ? preset.id : null;
}
