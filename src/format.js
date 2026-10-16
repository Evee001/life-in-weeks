/** Human-friendly number formatting. Pure functions, unit-tested. */

const plural = (n, one, many) => (n === 1 ? one : many);

const intFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function int(value) {
  return intFormat.format(Math.round(value));
}

/** 18.2341 -> "18.2 years", 1 -> "1 year", 0.4 -> "5 months" */
export function years(value) {
  if (value > 0 && value < 1) {
    const months = Math.max(1, Math.round(value * 12));
    if (months < 12) return `${months} ${plural(months, 'month', 'months')}`;
  }
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toFixed(rounded % 1 === 0 ? 0 : 1)} ${plural(rounded, 'year', 'years')}`;
}

/** Hours as a duration rounded to 5 minutes: 1.3 -> "1 hr 20 min" */
export function duration(hours) {
  const totalMinutes = Math.round((Math.max(0, hours) * 60) / 5) * 5;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0 && m === 0) return '0 min';
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} ${plural(h, 'hr', 'hrs')}`;
  return `${h} ${plural(h, 'hr', 'hrs')} ${m} min`;
}

/** Short hours for compact labels: 5.714 -> "5.7h" */
export function hoursShort(hours) {
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}h`;
}

/** 2.43 -> "2.4 times", 1.5 -> "1.5 times" */
export function ratio(value) {
  if (!Number.isFinite(value)) return 'many times';
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 2) return 'twice';
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} times`;
}

export function percent(value) {
  if (value > 0 && value < 0.1) return '<0.1%';
  return `${(Math.round(value * 10) / 10).toFixed(1)}%`;
}

export const fmt = { int, years, duration, hoursShort, ratio, percent };
