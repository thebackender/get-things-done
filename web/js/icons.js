// Icons in the style of Lucide (24×24 grid, 2px stroke, currentColor), plus the priority icons.
// Each icon is one <svg> with a single <path>: all strokes of an icon are merged into one path string.
// That keeps the DOM small without <use> (a sprite with <use> measured ~40% slower to render here).

/** Rounded rectangle and circle as path data, so they can be merged into one path. */
const rect = (x, y, w, h, r) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}` +
  `h-${w - 2 * r}a${r} ${r} 0 0 1 -${r} -${r}v-${h - 2 * r}a${r} ${r} 0 0 1 ${r} -${r}z`;
const circle = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 -${2 * r} 0`;

const LINE = {
  calendar: [rect(3, 4, 18, 18, 2), 'M16 2v4M8 2v4M3 10h18'],
  x: ['M18 6 6 18M6 6l12 12'],
  pencil: ['M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z', 'm15 5 4 4'],
  alert: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4M12 17h.01'],
  hourglass: ['M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2'],
  lock: [rect(3, 11, 18, 11, 2), 'M7 11V7a5 5 0 0 1 10 0v4'],
  listChecks: ['m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8'],
  zap: ['M13 2 3 14h9l-1 8 10-12h-9l1-8z'],
  target: [circle(12, 12, 10), circle(12, 12, 6), circle(12, 12, 2)],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  plus: ['M5 12h14M12 5v14'],
  play: ['M6 3l14 9-14 9z'],
  square: [rect(5, 5, 14, 14, 2)],
  check: ['M20 6 9 17l-5-5'],
  chevronRight: ['m9 18 6-6-6-6'],
  chevronDown: ['m6 9 6 6 6-6'],
  chevronLeft: ['m15 18-6-6 6-6'],
  cornerDownRight: ['m15 10 5 5-5 5', 'M4 4v7a4 4 0 0 0 4 4h12'],
  sun: [circle(12, 12, 4), 'M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2M20 12h2m-15.66 5.66-1.41 1.41M19.07 4.93l-1.41 1.41'],
  moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
  monitor: [rect(2, 3, 20, 14, 2), 'M8 21h8M12 17v4'],
  loader: ['M12 2v4M16.2 7.8l2.9-2.9M18 12h4M16.2 16.2l2.9 2.9M12 18v4M4.9 19.1l2.9-2.9M2 12h4M4.9 4.9l2.9 2.9'],
  clock: [circle(12, 12, 10), 'M12 6v6l4 2'],
  locate: [circle(12, 12, 7), circle(12, 12, 3), 'M2 12h3M19 12h3M12 2v3M12 19v3'],
  sliders: ['M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4'],
};
const LINE_D = Object.fromEntries(Object.entries(LINE).map(([name, parts]) => [name, parts.join('')]));

const STROKE = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

/** Inline icon. size in px; extra class names go on the <svg>. */
export function icon(name, size = 16, cls = '') {
  return `<svg class="i${cls ? ` ${cls}` : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" ${STROKE} stroke-width="2" aria-hidden="true">` +
    `<path d="${LINE_D[name]}"/></svg>`;
}

// Priority icons (16×16): ★ Critical, ⌃⌃ Highest, ⌃ High, = Medium, ⌄ Low, ⌄⌄ Lowest.
const chevrons = (ys, dir) => ys.map((y) => (dir === 'up' ? `M3 ${y + 4}L8 ${y}L13 ${y + 4}` : `M3 ${y}L8 ${y + 4}L13 ${y}`)).join('');
const PRIORITY = {
  critical: `<path d="M8 1.2l2.1 4.3 4.7.7-3.4 3.3.8 4.7L8 11.9l-4.2 2.3.8-4.7L1.2 6.2l4.7-.7z" fill="currentColor" stroke-width="1"/>`,
  highest: `<path d="${chevrons([3.5, 7.5], 'up')}"/>`,
  high: `<path d="${chevrons([5.5], 'up')}"/>`,
  medium: '<path d="M3 6H13M3 10H13"/>', // "=" sign, not an arrow
  low: `<path d="${chevrons([5.5], 'down')}"/>`,
  lowest: `<path d="${chevrons([3.5, 7.5], 'down')}"/>`,
};

/** Priority icon shape by CSS name ("critical", "high", …); the color comes from the wrapper's CSS class. */
export const prioSvg = (css) => `<svg width="16" height="16" viewBox="0 0 16 16" ${STROKE} stroke-width="2" aria-hidden="true">${PRIORITY[css]}</svg>`;
