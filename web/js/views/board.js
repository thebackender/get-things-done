// Sprint tab: board with a column per status.
import { store, sprintById, activeSprint, sprintOrder, byPriority, taskById, updateTask } from '../store.js';
import { openSprintEditor } from '../editor.js';
import { card, cardClicks, dragAndDrop, progressBar } from '../components.js';
import { STATUSES, esc, fmtDate, today, daysBetween, empty, freshBox } from '../util.js';
import { icon } from '../icons.js';

let selectedId = null;

export function render(view) {
  const root = freshBox(view);
  const sprint = sprintById(selectedId) ?? activeSprint() ?? store.sprints.filter((s) => s.status !== 'closed').sort(sprintOrder)[0];
  if (!sprint) {
    root.innerHTML = empty('No sprints yet. <a href="#backlog">Create one in the Backlog tab</a>.');
    return;
  }

  const tasks = store.tasks.filter((t) => t.sprint_id === sprint.id);
  const done = tasks.filter((t) => t.status === 'done').length;
  const left = sprint.end ? daysBetween(today(), sprint.end) : null;
  const timing = {
    closed: 'closed',
    planned: 'planned',
    active: left == null ? 'active' : left >= 0 ? `${left} day(s) left` : `${icon('alert', 12)} ${-left} day(s) overdue`,
  }[sprint.status];

  root.innerHTML = `
    <div class="sprint-head">
      <select class="sprint-select" title="Choose sprint">
        ${store.sprints.slice().sort(sprintOrder).map((s) =>
          `<option value="${s.id}" ${s.id === sprint.id ? 'selected' : ''}>${esc(s.name)}${s.status === 'active' ? ' (active)' : s.status === 'closed' ? ' (closed)' : ''}</option>`).join('')}
      </select>
      <div class="sprint-info">
        <div><b>${esc(sprint.name)}</b> <span class="muted">${fmtDate(sprint.start)} – ${fmtDate(sprint.end)} · ${timing}</span></div>
        ${sprint.goal ? `<div class="sprint-goal">${icon('target', 14)} ${esc(sprint.goal)}</div>` : ''}
      </div>
      <div class="sprint-progress">${progressBar(done, tasks.length)} <span>${done}/${tasks.length}</span></div>
      <button class="icon edit-sprint" title="Edit sprint">${icon('pencil', 16)}</button>
    </div>
    ${tasks.length ? '' : '<p class="hint">No tasks in this sprint. Move some in from the <a href="#backlog">backlog</a>.</p>'}
    <div class="board">
      ${STATUSES.map((col) => {
        const items = tasks.filter((t) => t.status === col.value).sort(byPriority);
        return `<div class="column drop col-${col.value}" data-status="${col.value}">
          <h3>${col.name} <span class="count">${items.length}</span></h3>
          ${items.map((t) => card(t)).join('') || '<div class="placeholder">Drop here</div>'}
        </div>`;
      }).join('')}
    </div>`;

  root.querySelector('.sprint-select').addEventListener('change', (e) => {
    selectedId = Number(e.target.value);
    render(view);
  });
  root.querySelector('.edit-sprint').addEventListener('click', () => openSprintEditor(sprint));
  cardClicks(root);
  dragAndDrop(root, '.column', (id, zone) => {
    if (taskById(id)?.status !== zone.dataset.status) updateTask(id, { status: zone.dataset.status });
  });
}
