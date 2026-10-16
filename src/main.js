import { CATEGORIES, computeLife, weeksByCategory, reclaim, withDrainsCut, insights } from './model.js';
import { fmt } from './format.js';
import {
  DEFAULT_STATE, LIMITS, PRESETS, cloneState, sanitizeState,
  encodeState, decodeState, matchingPreset,
} from './state.js';
import { drawLifeGrid } from './grid.js';

const STORAGE_KEY = 'life-in-weeks:v1';
const ORDER = ['rest', 'work', 'upkeep', 'drain'];
const CATEGORY_HINTS = {
  rest: 'Sleep, naps',
  work: 'Paid work and getting there',
  upkeep: 'Keeping yourself and your home running',
  drain: 'Time that slips away without you choosing it',
};

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

// ---------------------------------------------------------------- storage
function loadState() {
  const fromUrl = decodeState(new URLSearchParams(location.search).get('s') || '');
  if (fromUrl) return fromUrl;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return sanitizeState(JSON.parse(saved));
  } catch { /* storage blocked or corrupt: fall back to defaults */ }
  return cloneState(DEFAULT_STATE);
}

let saveTimer = 0;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, 250);
}

let state = loadState();
addEventListener('pagehide', () => {
  clearTimeout(saveTimer);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
});
// A shared link has been applied; clean the address bar so later edits aren't confusing.
if (new URLSearchParams(location.search).has('s')) {
  history.replaceState(null, '', location.pathname);
}

// ---------------------------------------------------------------- controls
function setRangeFill(range) {
  const min = Number(range.min), max = Number(range.max), v = Number(range.value);
  range.style.setProperty('--pct', `${((v - min) / (max - min)) * 100}%`);
}

const fieldRegistry = new Map();

/** Refresh a field's inputs from state (used when one field adjusts another). */
function syncField(id) {
  const f = fieldRegistry.get(id);
  if (!f || document.activeElement === f.num) return;
  f.num.value = f.get();
  f.range.value = Math.min(f.get(), f.max);
  setRangeFill(f.range);
}

/**
 * A labelled number field with a synced slider.
 * `get`/`set` read and write the value in state.
 */
function numberField({ id, label, unit, hint, limits, get, set, sliderMax, onRemove, category }) {
  const max = sliderMax ?? limits.max;
  const numId = `num-${id}`;
  const rangeId = `range-${id}`;

  const num = el('input', {
    id: numId, class: 'num-input', type: 'number', inputmode: 'decimal',
    min: limits.min, max: limits.max, step: limits.step, value: get(),
  });
  const range = el('input', {
    id: rangeId, type: 'range', min: limits.min, max, step: limits.step, value: Math.min(get(), max),
    'aria-label': `${label}${unit ? ` (${unit})` : ''}`,
  });
  setRangeFill(range);

  fieldRegistry.set(id, { num, range, max, get });

  const commit = (raw, source) => {
    const value = Number(raw);
    if (raw === '' || !Number.isFinite(value)) return;
    const clamped = Math.min(limits.max, Math.max(limits.min, value));
    set(clamped);
    if (source !== num) num.value = clamped;
    if (source !== range) range.value = Math.min(clamped, max);
    setRangeFill(range);
    update();
  };
  num.addEventListener('input', () => commit(num.value, num));
  num.addEventListener('change', () => { num.value = get(); });
  range.addEventListener('input', () => commit(range.value, range));

  const labelNode = el('label', { class: 'field-label', for: numId },
    el('span', { class: 'name', text: label }));
  const numWrap = el('div', { class: 'field-num' }, num, unit ? el('span', { class: 'unit-label', text: unit }) : null);
  if (onRemove) {
    numWrap.append(el('button', {
      type: 'button', class: 'remove-btn', 'aria-label': `Remove ${label}`, title: `Remove ${label}`,
      text: '×', onclick: onRemove,
    }));
  }
  const node = el('div', { class: `field${category ? ` cat-${category}` : ''}` }, labelNode, numWrap, range);
  if (hint) node.append(el('p', { class: 'field-hint', text: hint }));
  return node;
}

function renderAboutYou() {
  const specs = {
    age: { label: 'Your age', unit: 'yrs' },
    lifeExpectancy: { label: 'Life expectancy', unit: 'yrs', hint: 'The age you plan for. Try your country’s average, or your family’s.' },
    retirementAge: { label: 'Retirement age', unit: 'yrs', hint: 'Work and commuting stop here.' },
  };
  const fields = Object.entries(specs).map(([key, spec]) => numberField({
    id: key, ...spec, limits: LIMITS[key],
    get: () => state[key],
    set: (v) => {
      state[key] = Math.round(v);
      // Keep age below life expectancy without fighting the user.
      if (key === 'lifeExpectancy' && state.age >= state.lifeExpectancy) state.age = Math.max(0, state.lifeExpectancy - 1);
      if (key === 'age' && state.age >= state.lifeExpectancy) state.lifeExpectancy = Math.min(LIMITS.lifeExpectancy.max, state.age + 1);
      for (const other of Object.keys(specs)) if (other !== key) syncField(other);
    },
  }));
  $('about-fields').replaceChildren(...fields);
}

function renderActivities() {
  const host = $('activity-groups');
  host.replaceChildren();
  for (const cat of ORDER) {
    const items = state.activities.filter((a) => a.category === cat);
    const fieldset = el('fieldset', { class: 'group' },
      el('legend', {},
        el('span', { class: `swatch sw-${cat}`, 'aria-hidden': 'true' }),
        el('span', { text: CATEGORIES[cat].label }),
        el('span', { class: 'group-total', 'data-total': cat })));
    fieldset.append(el('p', { class: 'field-hint', text: CATEGORY_HINTS[cat] }));

    if (cat === 'work') {
      fieldset.append(numberField({
        id: 'workdays', label: 'Workdays a week', unit: 'days', limits: LIMITS.workdaysPerWeek,
        get: () => state.workdaysPerWeek, set: (v) => { state.workdaysPerWeek = Math.round(v * 2) / 2; },
        category: 'work',
      }));
    }
    for (const activity of items) {
      fieldset.append(numberField({
        id: activity.id, label: activity.name, unit: 'hrs', category: cat,
        hint: activity.schedule === 'workdays' ? 'Per workday' : null,
        limits: LIMITS.hours, sliderMax: Math.max(12, Math.ceil(activity.hours)),
        get: () => activity.hours,
        set: (v) => { activity.hours = Math.round(v * 4) / 4; },
        onRemove: () => {
          state.activities = state.activities.filter((a) => a !== activity);
          renderControls();
          update();
          toast(`Removed ${activity.name}`);
        },
      }));
    }
    if (items.length === 0 && cat !== 'work') {
      fieldset.append(el('p', { class: 'field-hint', text: 'Nothing here yet. Add an activity below.' }));
    }
    host.append(fieldset);
  }
}

function renderPresets() {
  const host = $('presets');
  host.replaceChildren(...PRESETS.map((preset) => el('button', {
    type: 'button', class: 'chip', 'data-preset': preset.id, 'aria-pressed': 'false', text: preset.label,
    onclick: () => {
      state = cloneState(preset.state);
      renderControls();
      update();
    },
  })));
}

function renderControls() {
  renderAboutYou();
  renderActivities();
}

// ---------------------------------------------------------------- outputs
const CAT_VAR = { rest: '--c-rest', work: '--c-work', upkeep: '--c-upkeep', drain: '--c-drain', purposeful: '--c-purpose' };

function renderSummary(r) {
  const yearsNode = $('purposeful-years');
  const [value, ...unitParts] = fmt.years(r.purposefulYears).split(' ');
  yearsNode.replaceChildren(document.createTextNode(value), el('span', { class: 'unit', text: unitParts.join(' ') }));

  const lede = $('lede');
  const tail = $('tail');
  if (r.yearsLeft <= 0) {
    lede.textContent = 'Set your age below your life expectancy to see';
    tail.textContent = 'of purposeful time.';
    return;
  }
  lede.replaceChildren('Of the ', el('strong', { text: fmt.years(r.yearsLeft) }), ' ahead of you, about');
  tail.replaceChildren(
    'are free for purposeful living. That averages ',
    el('strong', { text: `${fmt.duration(r.freePerDayAverage)} a day` }),
    ` across your working and retired years, or ${fmt.percent(r.purposefulPercent)} of the time you have left.`,
  );
}

function renderOverbooked(r) {
  const box = $('overbooked');
  if (!r.overbooked) { box.hidden = true; return; }
  box.hidden = false;
  box.textContent = `Your day adds up to more than 24 hours. Take ${fmt.duration(r.overbookedBy)} off something to make it fit.`;
}

function renderDayBar(r) {
  const bar = $('daybar');
  const parts = r.rows
    .filter((row) => row.perDayWorking > 0)
    .sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category));
  const total = Math.max(24, r.usedPerDayWorking);
  const segments = parts.map((row) => el('span', {
    title: `${row.name}: ${fmt.duration(row.perDayWorking)}`,
    style: `flex: 0 0 calc(${(row.perDayWorking / total) * 100}% - 2px); background: var(${CAT_VAR[row.category]})`,
  }));
  if (r.freePerDayWorking > 0) {
    segments.push(el('span', {
      title: `Purposeful: ${fmt.duration(r.freePerDayWorking)}`,
      style: `flex: 1 1 auto; background: var(--c-purpose)`,
    }));
  }
  bar.replaceChildren(...segments);
  bar.setAttribute('aria-label',
    `24-hour day: ${parts.map((p) => `${p.name} ${fmt.duration(p.perDayWorking)}`).join(', ')}; purposeful time ${fmt.duration(r.freePerDayWorking)}.`);

  $('day-free').textContent = r.workingYears > 0
    ? `${fmt.duration(r.freePerDayWorking)} free`
    : `Retired: ${fmt.duration(r.freePerDayRetired)} free a day`;

  const legend = ORDER.map((cat) => [cat, CATEGORIES[cat].label, r.byCategory[cat].perDayWorking])
    .filter(([, , h]) => h > 0);
  legend.push(['purposeful', 'Purposeful', r.freePerDayWorking]);
  $('day-legend').replaceChildren(...legend.map(([cat, label, hours]) => el('li', {},
    el('span', { class: `swatch sw-${cat}`, 'aria-hidden': 'true' }),
    el('span', { text: `${label} ` }), el('strong', { text: fmt.hoursShort(hours) }))));
}

function renderDayTotal(r) {
  const used = r.usedPerDayWorking;
  $('day-total-value').textContent = `${fmt.hoursShort(used)} of 24h`;
  $('day-total-meter').style.width = `${Math.min(100, (used / 24) * 100)}%`;
  $('day-total').classList.toggle('is-over', used > 24);
  for (const cat of ORDER) {
    const node = document.querySelector(`[data-total="${cat}"]`);
    if (node) node.textContent = `${fmt.hoursShort(r.byCategory[cat].perDayWorking)} a day`;
  }
}

function renderBreakdown(r) {
  const rows = r.rows
    .filter((row) => row.lifetimeYears > 0)
    .map((row) => ({ name: row.name, years: row.lifetimeYears, cat: row.category }));
  rows.push({ name: 'Purposeful time', years: r.purposefulYears, cat: 'purposeful' });
  rows.sort((a, b) => b.years - a.years);
  const max = Math.max(...rows.map((x) => x.years), 0.0001);

  $('breakdown').replaceChildren(...rows.map((row) => el('li', { class: row.cat === 'purposeful' ? 'is-purpose' : '' },
    el('span', { class: 'b-name', text: row.name }),
    el('span', { class: 'b-track', 'aria-hidden': 'true' },
      el('span', { class: 'b-fill', style: `width: ${(row.years / max) * 100}%; background: var(${CAT_VAR[row.cat]})` })),
    el('span', { class: 'b-val', text: fmt.years(row.years) }))));

  $('breakdown-sub').textContent = r.yearsLeft > 0
    ? `Out of ${fmt.years(r.yearsLeft)}: ${fmt.years(r.workingYears)} working and ${fmt.years(r.retiredYears)} retired.`
    : '';
}

function renderGrid(r) {
  const groups = weeksByCategory(r);
  const canvas = $('life-grid');
  drawLifeGrid(canvas, {
    totalWeeks: r.totalWeeks,
    weeksLived: r.weeksLived,
    groups,
    lifeExpectancy: state.lifeExpectancy,
  });
  const labels = { ...Object.fromEntries(ORDER.map((c) => [c, CATEGORIES[c].label])), purposeful: 'Purposeful' };
  const items = [['lived', 'Lived', r.weeksLived], ...groups.map((g) => [g.key, labels[g.key], g.count])];
  $('grid-legend').replaceChildren(...items.filter(([, , n]) => n > 0).map(([key, label, n]) => el('li', {},
    el('span', { class: `swatch sw-${key}`, 'aria-hidden': 'true' }),
    el('span', { text: `${label} ` }), el('strong', { text: fmt.int(n) }))));
  const purposeWeeks = groups.find((g) => g.key === 'purposeful')?.count ?? 0;
  $('grid-note').textContent = r.weeksLeft > 0
    ? `Only ${fmt.int(purposeWeeks)} of your ${fmt.int(r.weeksLeft)} remaining weeks are yours to spend on purpose.`
    : '';
  canvas.setAttribute('aria-label',
    `Grid of ${fmt.int(r.totalWeeks)} weeks. ${fmt.int(r.weeksLived)} lived. Of the ${fmt.int(r.weeksLeft)} left: ` +
    groups.map((g) => `${labels[g.key]} ${fmt.int(g.count)}`).join(', ') + '.');
}

function renderReclaim(r) {
  const range = $('reclaim-range');
  const fraction = Number(range.value) / 100;
  setRangeFill(range);
  $('reclaim-pct').textContent = `${range.value}%`;
  const out = $('reclaim-result');
  const apply = $('reclaim-apply');
  const drainHours = r.byCategory.drain.perDayWorking;

  if (r.yearsLeft <= 0 || drainHours <= 0) {
    out.textContent = drainHours <= 0 ? 'You have no time drains left to cut.' : '';
    apply.disabled = true;
    return;
  }
  const gain = reclaim(state, fraction);
  apply.disabled = fraction === 0;
  if (fraction === 0) {
    out.textContent = 'Move the slider to see what you would gain.';
    return;
  }
  out.replaceChildren(
    'You would gain ', el('strong', { text: `${fmt.duration(gain.hoursPerDay)} a day` }),
    `, about `, el('strong', { text: fmt.years(gain.years) }), ' of purposeful time over your life.',
  );
}

function renderInsights(r) {
  const list = insights(state, r, fmt);
  $('insights').replaceChildren(...list.map((i) => el('li', { text: i.text })));
  $('insights').hidden = list.length === 0;
}

function renderPresetState() {
  const active = matchingPreset(state);
  document.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === active)));
}

let frame = 0;
function update() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const r = computeLife(state);
    renderSummary(r);
    renderOverbooked(r);
    renderDayBar(r);
    renderDayTotal(r);
    renderBreakdown(r);
    renderGrid(r);
    renderReclaim(r);
    renderInsights(r);
    renderPresetState();
    saveState();
  });
}

// ---------------------------------------------------------------- actions
let toastTimer = 0;
function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 2200);
}

$('share-btn').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?s=${encodeState(state)}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch {
    window.prompt('Copy this link:', url);
  }
});

$('reset-btn').addEventListener('click', () => {
  state = cloneState(DEFAULT_STATE);
  $('reclaim-range').value = 30;
  renderControls();
  update();
  toast('Reset to the average adult');
});

$('reclaim-range').addEventListener('input', () => renderReclaim(computeLife(state)));
$('reclaim-apply').addEventListener('click', () => {
  const fraction = Number($('reclaim-range').value) / 100;
  state = sanitizeState(withDrainsCut(state, fraction));
  $('reclaim-range').value = 0;
  renderControls();
  update();
  toast('Applied to your day');
});

$('add-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const error = $('add-error');
  const name = String(data.get('name') || '').trim();
  const hours = Number(data.get('hours'));

  let message = '';
  if (!name) message = 'Give the activity a name.';
  else if (state.activities.length >= LIMITS.maxActivities) message = `You can track up to ${LIMITS.maxActivities} activities.`;
  else if (!Number.isFinite(hours) || hours < 0 || hours > 24) message = 'Hours must be between 0 and 24.';
  else if (state.activities.some((a) => a.name.toLowerCase() === name.toLowerCase())) message = `${name} is already on your list.`;
  if (message) { error.textContent = message; error.hidden = false; return; }
  error.hidden = true;

  const next = sanitizeState({
    ...state,
    activities: [...state.activities, {
      id: `c${Date.now().toString(36)}`, name, hours,
      category: data.get('category'), schedule: data.get('schedule'),
    }],
  });
  state = next;
  form.reset();
  renderControls();
  update();
  toast(`Added ${name}`);
});

let resizeFrame = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => renderGrid(computeLife(state)));
}).observe($('life-grid').parentElement);

// Redraw the canvas when the colour scheme changes.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => update());

renderPresets();
renderControls();
update();
