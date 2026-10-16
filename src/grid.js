/**
 * Draws the "life in weeks" calendar on a canvas: one square per week,
 * 52 squares per row (one row per year of life).
 * Lived weeks come first; the remaining weeks are grouped by category,
 * in the order given, so the purposeful share shows up as a single block.
 */

const WEEKS_PER_ROW = 52;
const COLOR_VARS = {
  lived: '--lived',
  future: '--future',
  rest: '--c-rest',
  work: '--c-work',
  upkeep: '--c-upkeep',
  drain: '--c-drain',
  purposeful: '--c-purpose',
  label: '--ink-soft',
};

function readColors() {
  const styles = getComputedStyle(document.documentElement);
  const out = {};
  for (const [key, cssVar] of Object.entries(COLOR_VARS)) out[key] = styles.getPropertyValue(cssVar).trim();
  return out;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{totalWeeks:number, weeksLived:number, groups:Array<{key:string,count:number}>, lifeExpectancy:number}} data
 */
export function drawLifeGrid(canvas, { totalWeeks, weeksLived, groups }) {
  const colors = readColors();
  const cssWidth = Math.max(240, canvas.parentElement.clientWidth);
  const labelWidth = 28;
  const pitch = Math.min(10, (cssWidth - labelWidth) / WEEKS_PER_ROW);
  const gap = pitch >= 9 ? 2 : 1;
  const cell = pitch - gap;
  const rows = Math.ceil(totalWeeks / WEEKS_PER_ROW);
  const gridWidth = labelWidth + pitch * WEEKS_PER_ROW;
  const cssHeight = Math.ceil(rows * pitch);

  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.style.width = `${gridWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(gridWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, gridWidth, cssHeight);

  // Colour for each week index.
  const sequence = [{ key: 'lived', count: weeksLived }, ...groups];
  let index = 0;
  const radius = Math.min(2, cell / 4);
  for (const { key, count } of sequence) {
    ctx.fillStyle = colors[key] || colors.future;
    for (let k = 0; k < count && index < totalWeeks; k += 1, index += 1) {
      const row = Math.floor(index / WEEKS_PER_ROW);
      const col = index % WEEKS_PER_ROW;
      const x = labelWidth + col * pitch;
      const y = row * pitch;
      if (ctx.roundRect && radius > 0.5) {
        ctx.beginPath();
        ctx.roundRect(x, y, cell, cell, radius);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, cell, cell);
      }
    }
  }
  // Any rounding leftovers.
  ctx.fillStyle = colors.future;
  for (; index < totalWeeks; index += 1) {
    ctx.fillRect(labelWidth + (index % WEEKS_PER_ROW) * pitch, Math.floor(index / WEEKS_PER_ROW) * pitch, cell, cell);
  }

  // Age labels every 10 years.
  ctx.fillStyle = colors.label;
  ctx.font = `${Math.max(9, Math.min(11, pitch + 1))}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  for (let age = 0; age < rows; age += 10) {
    ctx.fillText(String(age), labelWidth - 6, age * pitch + cell / 2);
  }
}
