// Stats tab: summary tiles and SVG charts.
import { store, activeSprint, sprintOrder, isOverdue, goalSum, categories, categoryColor } from '../store.js';
import { PALETTE, OTHER_COLOR, PRIORITIES, esc, trunc, today, addDays, weekStart, fmtDate, fmtNum, daysBetween, freshBox, empty } from '../util.js';

// Charts are drawn at the card's actual width so text never gets stretched.
// The markup holds an empty slot that is filled once it is in the DOM.
let slots = [];
let currentRoot = null;
const slot = (draw) => {
  slots.push(draw);
  return `<div class="chart-slot" data-slot="${slots.length - 1}"></div>`;
};
function drawSlots(root) {
  root.querySelectorAll('.chart-slot').forEach((el) => (el.innerHTML = slots[el.dataset.slot](Math.max(280, el.clientWidth))));
}
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => currentRoot?.isConnected && drawSlots(currentRoot), 150);
});
const BLUE = PALETTE[0];
const ORANGE = PALETTE[1];
let selectedGoal = null;

// ---------- chart primitives ----------

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((m) => m * p).find((x) => x >= v);
}

function ticks(max) {
  const n = max <= 5 && Number.isInteger(max) ? max : 5;
  return Array.from({ length: n + 1 }, (_, i) => (max / n) * i);
}

/** A column growing from the baseline: 4px rounding on the top end only. */
function columnPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** A horizontal segment: rounded on the right end only, if round. */
function barPath(x, y, w, h, round) {
  const r = round ? Math.min(4, h / 2, w) : 0;
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}

function yAxis(max, pad, ih, W) {
  const y = (v) => pad.t + ih - (v / max) * ih;
  return ticks(max).map((t) => `
    <line class="${t === 0 ? 'baseline' : 'grid'}" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>
    <text class="axis" x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${fmtNum(t)}</text>`).join('');
}

/** Single-series column chart. data: [{label, value, tip}] */
function columnChart(data, { color = BLUE, height = 190, aria }) {
  return slot((W) => {
    const pad = { l: 34, r: 8, t: 12, b: 24 };
    const iw = W - pad.l - pad.r;
    const ih = height - pad.t - pad.b;
    const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
    const step = iw / data.length;
    const bw = Math.min(24, step * 0.6);
    const every = Math.max(1, Math.ceil((data.length * 72) / iw));
    const bars = data.map((d, i) => {
      const h = (d.value / max) * ih;
      const x = pad.l + i * step;
      return `${h > 0 ? `<path d="${columnPath(x + (step - bw) / 2, pad.t + ih - h, bw, h)}" fill="${color}"/>` : ''}
        ${i % every === 0 ? `<text class="axis" x="${x + step / 2}" y="${height - 6}" text-anchor="middle">${esc(d.label)}</text>` : ''}
        <rect class="hit" x="${x}" y="${pad.t}" width="${step}" height="${ih}" data-tip="${esc(d.tip)}"/>`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(aria)}">${yAxis(max, pad, ih, W)}${bars}</svg>`;
  });
}

/** Stacked horizontal bars. rows: [{label, values: [..]}], series: [{name, color}] */
function stackedBars(rows, series, aria) {
  return slot((W) => {
    const labelW = 140, padR = 56, rowH = 28, barH = 14, gap = 2;
    const height = rows.length * rowH + 8;
    const iw = W - labelW - padR;
    const max = Math.max(1, ...rows.map((r) => r.values.reduce((a, b) => a + b, 0)));
    const body = rows.map((r, i) => {
      const y = 4 + i * rowH;
      const total = r.values.reduce((a, b) => a + b, 0);
      const lastIdx = r.values.findLastIndex((v) => v > 0);
      let x = labelW;
      const segs = r.values.map((v, j) => {
        if (!v) return '';
        const w = Math.max(1, (v / max) * iw - (j < lastIdx ? gap : 0));
        const path = `<path d="${barPath(x, y + (rowH - barH) / 2, w, barH, j === lastIdx)}" fill="${series[j].color}"/>`;
        x += w + gap;
        return path;
      }).join('');
      const tip = `${r.label}: ${series.map((s, j) => `${s.name.toLowerCase()} ${r.values[j]}`).join(', ')}`;
      return `<text class="label" x="${labelW - 8}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(trunc(r.label, 20))}</text>
        ${segs}<text class="value" x="${x + 4}" y="${y + rowH / 2 + 4}">${total}</text>
        <rect class="hit" x="0" y="${y}" width="${W}" height="${rowH}" data-tip="${esc(tip)}"/>`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(aria)}">
      <line class="baseline" x1="${labelW}" x2="${labelW}" y1="0" y2="${height}"/>${body}</svg>`;
  });
}

const legend = (items) =>
  `<div class="chart-legend">${items.map((s) => `<span><i class="${s.dashed ? 'line dashed' : 'dot'}" style="--c:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;

const tableView = (headers, rows) => `<details class="table-view"><summary>Show table</summary>
  <table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;

const statCard = (title, body, wide = false) => `<section class="stat-card${wide ? ' wide' : ''}"><h3>${title}</h3>${body}</section>`;

// ---------- calculations ----------

/** Average days from "in progress" to "done", based on change history. */
function cycleTime() {
  const started = new Map();
  const durations = [];
  for (const h of store.history) {
    if (h.field !== 'status') continue;
    if (h.to === 'doing' && !started.has(h.task_id)) started.set(h.task_id, h.ts);
    if (h.to === 'done' && started.has(h.task_id)) {
      durations.push((new Date(h.ts) - new Date(started.get(h.task_id))) / 86400000);
      started.delete(h.task_id);
    }
  }
  if (!durations.length) return null;
  return { avg: durations.reduce((a, b) => a + b, 0) / durations.length, n: durations.length };
}

function tiles() {
  const open = store.tasks.filter((t) => t.status !== 'done');
  const weekAgo = addDays(today(), -6);
  const done7 = store.tasks.filter((t) => t.done_at && t.done_at >= weekAgo).length;
  const overdue = open.filter(isOverdue).length;
  const cycle = cycleTime();
  const tile = (value, label, sub = '', cls = '') =>
    `<div class="tile ${cls}"><div class="tile-value">${value}</div><div class="tile-label">${label}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}</div>`;
  return `<div class="tiles">
    ${tile(open.length, 'open', `${open.filter((t) => t.status === 'doing').length} in progress`)}
    ${tile(open.filter((t) => t.status === 'waiting').length, '⏳ waiting')}
    ${tile(done7, 'done in last 7 days')}
    ${tile(overdue, overdue ? '⚠ overdue' : 'overdue', '', overdue ? 'critical' : '')}
    ${tile(cycle ? `${fmtNum(cycle.avg.toFixed(1))} d` : '—', 'from in progress to done',
      cycle ? `across ${cycle.n} task(s)` : 'shows up once tasks go through "In progress"')}
  </div>`;
}

function weeklyDone() {
  const thisWeek = weekStart(today());
  const data = Array.from({ length: 8 }, (_, i) => {
    const ws = addDays(thisWeek, -7 * (7 - i));
    const we = addDays(ws, 6);
    const n = store.tasks.filter((t) => t.done_at && t.done_at >= ws && t.done_at <= we).length;
    return { label: fmtDate(ws), value: n, tip: `Week of ${fmtDate(ws)}: ${n} done` };
  });
  return statCard('Done per week',
    columnChart(data, { aria: 'Tasks done per week' }) +
    tableView(['Week of', 'Done'], data.map((d) => [d.label, d.value])));
}

function byCategory() {
  const series = [{ name: 'Done', color: BLUE }, { name: 'Open', color: ORANGE }];
  const names = [...categories(), ''];
  const rows = names.map((c) => {
    const list = store.tasks.filter((t) => t.category === c);
    return { label: c || 'No category', values: [list.filter((t) => t.status === 'done').length, list.filter((t) => t.status !== 'done').length] };
  }).filter((r) => r.values[0] + r.values[1] > 0);
  if (!rows.length) return statCard('By category', empty('No tasks'));
  return statCard('By category',
    legend(series) + stackedBars(rows, series, 'Tasks by category') +
    tableView(['Category', 'Done', 'Open'], rows.map((r) => [r.label, ...r.values])));
}

function byPriority() {
  const open = store.tasks.filter((t) => t.status !== 'done');
  const data = PRIORITIES.map((p) => {
    const n = open.filter((t) => t.priority === p.value).length;
    return { label: p.icon || 'normal', value: n, tip: `${p.name}: ${n}` };
  });
  return statCard('Open by priority',
    columnChart(data, { aria: 'Open tasks by priority' }) +
    tableView(['Priority', 'Tasks'], PRIORITIES.map((p, i) => [p.name, data[i].value])));
}

function goals() {
  const list = store.tasks.filter((t) => t.target != null)
    .sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.due || '9999').localeCompare(b.due || '9999'));
  if (!list.length) return statCard('Goals', empty('No measurable goals. Turn on "Measurable goal" in the task editor.'), true);
  const goal = list.find((t) => t.id === selectedGoal) ?? list[0];
  const rows = list.map((t) => {
    const sum = goalSum(t);
    const pct = Math.min(100, (sum / t.target) * 100);
    return `<div class="goal-row st-${t.status}">
      <span class="goal-title">${t.status === 'done' ? '✓ ' : ''}${esc(t.title)}</span>
      <span class="track wide"><span class="fill" style="width:${pct}%"></span></span>
      <span class="goal-num">${fmtNum(sum)} / ${fmtNum(t.target)} ${esc(t.unit)}</span>
      <span class="muted">${t.due ? fmtDate(t.due) : ''}</span>
    </div>`;
  }).join('');

  // Daily progress of the selected goal over the last 3 weeks (or since the first entry).
  const first = goal.progress.map((p) => p.date).sort()[0] ?? today();
  const from = first > addDays(today(), -20) ? first : addDays(today(), -20);
  const days = Array.from({ length: daysBetween(from, today()) + 1 }, (_, i) => addDays(from, i));
  const data = days.map((d) => {
    const v = goal.progress.filter((p) => p.date === d).reduce((s, p) => s + p.value, 0);
    return { label: fmtDate(d), value: Math.max(0, v), tip: `${fmtDate(d)}: ${fmtNum(v)} ${goal.unit}` };
  });
  return statCard('Goals', `${rows}
    <div class="goal-pick">Daily progress:
      <select class="goal-select">${list.map((t) => `<option value="${t.id}" ${t.id === goal.id ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select>
    </div>
    ${columnChart(data, { height: 170, aria: `Daily progress for ${goal.title}` })}
    ${tableView(['Date', goal.unit || 'Value'], data.filter((d) => d.value).map((d) => [d.label, fmtNum(d.value)]))}`, true);
}

function burndown() {
  const sp = activeSprint();
  if (!sp) return statCard('Sprint burndown', empty('No active sprint'));
  if (!sp.start || !sp.end) return statCard(`Burndown: ${esc(sp.name)}`, empty('This sprint has no dates'));
  const tasks = store.tasks.filter((t) => t.sprint_id === sp.id);
  const total = tasks.length;
  const days = Array.from({ length: daysBetween(sp.start, sp.end) + 1 }, (_, i) => addDays(sp.start, i));
  const now = today();
  const left = (d) => tasks.filter((t) => !(t.done_at && t.done_at <= d)).length;
  const ideal = (i) => total * (1 - i / Math.max(1, days.length - 1));

  const svg = slot((W) => {
    const height = 200;
    const pad = { l: 34, r: 12, t: 12, b: 24 };
    const iw = W - pad.l - pad.r;
    const ih = height - pad.t - pad.b;
    const max = niceMax(Math.max(1, total));
    const x = (i) => pad.l + (days.length > 1 ? (i / (days.length - 1)) * iw : iw / 2);
    const y = (v) => pad.t + ih - (v / max) * ih;
    const actual = days.map((d, i) => ({ i, d, v: left(d) })).filter((p) => p.d <= now);
    const every = Math.max(1, Math.ceil((days.length * 72) / iw));
    const step = days.length > 1 ? iw / (days.length - 1) : iw;

    return `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="Sprint burndown">
      ${yAxis(max, pad, ih, W)}
      <polyline class="ideal" points="${days.map((_, i) => `${x(i)},${y(ideal(i))}`).join(' ')}"/>
      ${actual.length ? `<polyline class="actual" stroke="${BLUE}" points="${actual.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')}"/>` : ''}
      ${days.length <= 31 ? actual.map((p) => `<circle cx="${x(p.i)}" cy="${y(p.v)}" r="4" fill="${BLUE}" class="marker"/>`).join('') : ''}
      ${days.map((d, i) => `${i % every === 0 ? `<text class="axis" x="${x(i)}" y="${height - 6}" text-anchor="middle">${fmtDate(d)}</text>` : ''}
        <rect class="hit" x="${x(i) - step / 2}" y="${pad.t}" width="${step}" height="${ih}"
          data-tip="${fmtDate(d)}: ${d <= now ? `${left(d)} left, ` : ''}plan ${fmtNum(ideal(i).toFixed(1))}"/>`).join('')}
    </svg>`;
  });
  return statCard(`Burndown: ${esc(sp.name)}`,
    legend([{ name: 'Tasks left', color: BLUE }, { name: 'Ideal pace', color: OTHER_COLOR, dashed: true }]) + svg +
    tableView(['Day', 'Left', 'Plan'], days.map((d, i) => [fmtDate(d), d <= now ? left(d) : '', fmtNum(ideal(i).toFixed(1))])));
}

function velocity() {
  const closed = store.sprints.filter((s) => s.status === 'closed').sort(sprintOrder).reverse().slice(-10);
  if (!closed.length) return statCard('Velocity', empty('Shows up after the first closed sprint'));
  const data = closed.map((s) => {
    const n = store.tasks.filter((t) => t.sprint_id === s.id && t.status === 'done').length;
    return { label: trunc(s.name, 12), value: n, tip: `${s.name}: ${n} done` };
  });
  return statCard('Velocity: done per sprint',
    columnChart(data, { aria: 'Tasks done per sprint' }) +
    tableView(['Sprint', 'Done'], closed.map((s, i) => [s.name, data[i].value])));
}

// ---------- tab ----------

export function render(view) {
  const root = freshBox(view);
  currentRoot = root;
  slots = [];
  if (!store.tasks.length) {
    root.innerHTML = empty('Stats show up once you have tasks.');
    return;
  }
  root.innerHTML = `${tiles()}
    <div class="stats-grid">${weeklyDone()}${burndown()}${byCategory()}${byPriority()}${velocity()}${goals()}</div>
    <div class="tooltip" hidden></div>`;
  drawSlots(root);

  const tip = root.querySelector('.tooltip');
  root.addEventListener('mousemove', (e) => {
    const target = e.target.closest('[data-tip]');
    if (!target) return (tip.hidden = true);
    tip.textContent = target.dataset.tip;
    tip.hidden = false;
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${e.clientY + 14}px`;
  });
  root.addEventListener('mouseleave', () => (tip.hidden = true));
  root.querySelector('.goal-select')?.addEventListener('change', (e) => {
    selectedGoal = Number(e.target.value);
    render(view);
  });
}
