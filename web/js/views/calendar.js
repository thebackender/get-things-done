// Calendar tab: a month view with tasks on their due dates.
import { store, activeSprint, isOverdue, projectColor, projectLabel, byPriority, taskById, updateTask } from '../store.js';
import { openTaskEditor } from '../editor.js';
import { cardClicks, dragAndDrop } from '../components.js';
import { MONTHS, WEEKDAYS, esc, isoDate, today, prioClass, prioIcon, freshBox } from '../util.js';
import { icon } from '../icons.js';
import { getPrefs, setPrefs } from '../prefs.js';

let cursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let { showDone } = getPrefs('calendar', { showDone: true });

function chip(t) {
  const overdue = isOverdue(t);
  return `<div class="cal-task st-${t.status} prio-${prioClass(t.priority)}${overdue ? ' overdue' : ''}" draggable="true" data-id="${t.id}"
    style="--c:${projectColor(t.project_id)}" title="${esc(t.title)}${t.project_id ? ` · ${esc(projectLabel(t.project_id))}` : ''}${overdue ? ' (overdue)' : ''}">
    ${overdue ? icon('alert', 12, 'overdue-icon') : ''}${prioIcon(t.priority)}${esc(t.title)}</div>`;
}

export function render(view) {
  const root = freshBox(view);
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
  const end = new Date(y, m, last.getDate() + (6 - ((last.getDay() + 6) % 7)));
  const sprint = activeSprint();
  const now = today();

  const byDate = new Map();
  for (const t of store.tasks) {
    if (!t.due || (!showDone && t.status === 'done')) continue;
    if (!byDate.has(t.due)) byDate.set(t.due, []);
    byDate.get(t.due).push(t);
  }

  let cells = '';
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = isoDate(d);
    const items = (byDate.get(iso) || []).sort(byPriority);
    const cls = [
      d.getMonth() !== m && 'other',
      iso === now && 'today',
      sprint?.start && sprint?.end && iso >= sprint.start && iso <= sprint.end && 'in-sprint',
      (d.getDay() === 0 || d.getDay() === 6) && 'weekend',
    ].filter(Boolean).join(' ');
    cells += `<div class="day drop ${cls}" data-date="${iso}" title="Click to add a task due on this day">
      <div class="day-num">${d.getDate()}</div>${items.map(chip).join('')}</div>`;
  }

  const noDue = store.tasks.filter((t) => !t.due && t.status !== 'done').length;
  root.innerHTML = `
    <div class="toolbar">
      <button class="icon" data-nav="-1" title="Previous month">${icon('chevronLeft')}</button>
      <button data-nav="0">Today</button>
      <button class="icon" data-nav="1" title="Next month">${icon('chevronRight')}</button>
      <h2>${MONTHS[m]} ${y}</h2>
      <label class="check"><input type="checkbox" class="show-done" ${showDone ? 'checked' : ''}> show done</label>
      <span class="spacer"></span>
      ${sprint ? `<span class="legend-sprint"><i></i> ${esc(sprint.name)}</span>` : ''}
      <span class="muted">No due date: ${noDue}</span>
    </div>
    <div class="calendar">
      ${WEEKDAYS.map((w) => `<div class="dow">${w}</div>`).join('')}
      ${cells}
    </div>`;

  root.querySelector('.toolbar').addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (!nav) return;
    const step = Number(nav.dataset.nav);
    cursor = step === 0 ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(y, m + step, 1);
    render(view);
  });
  root.querySelector('.show-done').addEventListener('change', (e) => {
    showDone = e.target.checked;
    setPrefs('calendar', { showDone });
    render(view);
  });
  cardClicks(root);
  root.querySelector('.calendar').addEventListener('click', (e) => {
    if (e.target.closest('.cal-task')) return;
    const day = e.target.closest('.day');
    if (day) openTaskEditor(null, { due: day.dataset.date });
  });
  dragAndDrop(root, '.day', (id, zone) => {
    if (taskById(id)?.due !== zone.dataset.date) updateTask(id, { due: zone.dataset.date });
  });
}
