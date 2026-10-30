// Backlog tab: tasks without a sprint, and sprint planning.
import { store, taskById, descendants, sprintById, activeSprint, sprintOrder, byPriority, updateTasks, updateSprint } from '../store.js';
import { openTaskEditor, openSprintEditor } from '../editor.js';
import { card, cardClicks, dragAndDrop } from '../components.js';
import { esc, fmtDate, empty, toast } from '../util.js';
import { icon } from '../icons.js';

/** Nested cards: a subtask goes under its parent when both are in the same list. */
function nested(tasks) {
  const ids = new Set(tasks.map((t) => t.id));
  const out = [];
  const walk = (t, depth) => {
    out.push(card(t, { depth, showParent: depth === 0 }));
    tasks.filter((c) => c.parent_id === t.id).sort(byPriority).forEach((c) => walk(c, depth + 1));
  };
  tasks.filter((t) => !ids.has(t.parent_id)).sort(byPriority).forEach((t) => walk(t, 0));
  return out.join('');
}

function sprintBox(s) {
  const tasks = store.tasks.filter((t) => t.sprint_id === s.id);
  const done = tasks.filter((t) => t.status === 'done').length;
  return `<div class="sprint-box drop ${s.status}" data-sprint="${s.id}">
    <header>
      <div>
        <b>${esc(s.name)}</b>
        ${s.status === 'active' ? '<span class="badge doing"><i class="live"></i>active</span>' : '<span class="badge outline">planned</span>'}
        <div class="muted">${fmtDate(s.start)} – ${fmtDate(s.end)}${s.goal ? ` · ${icon('target', 12)} ${esc(s.goal)}` : ''}</div>
      </div>
      <div class="actions">
        <span class="muted">${done}/${tasks.length}</span>
        ${s.status === 'planned' ? `<button data-start="${s.id}">${icon('play', 12)} Start</button>` : `<button data-close="${s.id}">${icon('square', 12)} Close</button>`}
        <button class="icon" data-sprint-edit="${s.id}" title="Edit">${icon('pencil', 14)}</button>
      </div>
    </header>
    ${nested(tasks) || '<div class="placeholder">Drag tasks here</div>'}
  </div>`;
}

export function render(root) {
  const backlog = store.tasks.filter((t) => t.sprint_id == null && t.status !== 'done');
  const open = store.sprints.filter((s) => s.status !== 'closed').sort(sprintOrder);
  const closed = store.sprints.filter((s) => s.status === 'closed').sort(sprintOrder);

  root.innerHTML = `
    <div class="backlog-layout">
      <section class="pane drop" data-sprint="">
        <div class="pane-head"><h2>Backlog <span class="count">${backlog.length}</span></h2><button class="new-task">${icon('plus', 14)} Task</button></div>
        <p class="hint">Drag tasks into a sprint on the right. Unfinished subtasks move along with their parent.</p>
        ${nested(backlog) || empty('Backlog is empty')}
      </section>
      <section class="pane">
        <div class="pane-head"><h2>Sprints</h2><button class="primary new-sprint">${icon('plus', 14)} Sprint</button></div>
        ${open.map(sprintBox).join('') || empty('No open sprints. Create one and drag tasks into it.')}
        ${closed.length ? `<details class="closed-sprints"><summary>Closed sprints (${closed.length})</summary><ul>
          ${closed.map((s) => {
            const n = store.tasks.filter((t) => t.sprint_id === s.id && t.status === 'done').length;
            return `<li><b>${esc(s.name)}</b> <span class="muted">${fmtDate(s.start)} – ${fmtDate(s.end)}</span> · done ${n}
              <button class="icon" data-sprint-edit="${s.id}" title="Edit">${icon('pencil', 14)}</button></li>`;
          }).join('')}</ul></details>` : ''}
      </section>
    </div>`;

  root.querySelector('.new-task').addEventListener('click', () => openTaskEditor());
  root.querySelector('.new-sprint').addEventListener('click', () => openSprintEditor());

  root.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-sprint-edit]');
    const start = e.target.closest('[data-start]');
    const close = e.target.closest('[data-close]');
    if (edit) return openSprintEditor(sprintById(Number(edit.dataset.sprintEdit)));
    if (start) {
      const current = activeSprint();
      if (current) return toast(`Sprint "${current.name}" is already active. Close it first.`, 'error');
      return updateSprint(Number(start.dataset.start), { status: 'active' });
    }
    if (close) {
      const s = sprintById(Number(close.dataset.close));
      const left = store.tasks.filter((t) => t.sprint_id === s.id && t.status !== 'done').length;
      const msg = left ? `${left} unfinished task(s) will go back to the backlog.` : 'All tasks are done.';
      if (confirm(`Close "${s.name}"? ${msg}`)) updateSprint(s.id, { status: 'closed' });
    }
  });
  cardClicks(root);

  dragAndDrop(root, '[data-sprint]', (id, zone) => {
    const target = zone.dataset.sprint ? Number(zone.dataset.sprint) : null;
    const task = taskById(id);
    if (!task || task.sprint_id === target) return;
    const moving = [task, ...descendants(id).filter((d) => d.status !== 'done' && d.sprint_id === task.sprint_id)];
    updateTasks(moving.map((t) => ({ id: t.id, sprint_id: target })));
  });
}
