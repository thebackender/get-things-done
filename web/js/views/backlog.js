// Backlog tab: tasks without a sprint (or left over from an ended sprint), and sprint planning.
import { store, taskById, descendants, sprintById, sprintPhase, sprintOrder, inBacklog, byPriority, updateTasks } from '../store.js';
import { openTaskEditor, openSprintEditor } from '../editor.js';
import { card, cardClicks, dragAndDrop, sprintGoals } from '../components.js';
import { esc, fmtDate, empty, today, daysBetween, freshBox } from '../util.js';
import { icon } from '../icons.js';
import { getPrefs, setPrefs } from '../prefs.js';

// Sprints are collapsed until opened; which ones are open (and the past-sprints section) is saved in data/settings.json.
const saved = getPrefs('backlog', { open: [], pastOpen: false });
const openIds = new Set(Array.isArray(saved.open) ? saved.open : []);
let pastOpen = !!saved.pastOpen;
const persist = () => setPrefs('backlog', { open: [...openIds].filter((id) => sprintById(id)), pastOpen });

/** Nested cards: a subtask goes under its parent when both are in the same list. */
function nested(tasks, { leftover = false } = {}) {
  const ids = new Set(tasks.map((t) => t.id));
  const out = [];
  const walk = (t, depth) => {
    // In the backlog, a task still assigned to an ended sprint says where it came from.
    const from = leftover && t.sprint_id != null ? sprintById(t.sprint_id) : null;
    out.push(card(t, { depth, showParent: depth === 0, note: from ? `left over from ${from.name}` : '' }));
    tasks.filter((c) => c.parent_id === t.id).sort(byPriority).forEach((c) => walk(c, depth + 1));
  };
  tasks.filter((t) => !ids.has(t.parent_id)).sort(byPriority).forEach((t) => walk(t, 0));
  return out.join('');
}

function phaseBadge(s) {
  const phase = sprintPhase(s);
  if (phase === 'current') return '<span class="badge doing"><i class="live"></i>current</span>';
  const n = daysBetween(today(), s.start);
  return `<span class="badge outline">${n === 1 ? 'tomorrow' : `in ${n} days`}</span>`;
}

function sprintBox(s) {
  const tasks = store.tasks.filter((t) => t.sprint_id === s.id);
  const done = tasks.filter((t) => t.status === 'done').length;
  const phase = sprintPhase(s);
  const isOpen = openIds.has(s.id);
  // Past sprints are for looking back: tasks can't be dropped into them.
  const droppable = phase !== 'past';
  return `<div class="sprint-box ${phase}${isOpen ? ' open' : ''}${droppable ? ' drop' : ''}"${droppable ? ` data-sprint="${s.id}"` : ''}>
    <header data-toggle="${s.id}" title="${isOpen ? 'Collapse' : 'Show tasks'}">
      <span class="caret">${icon(isOpen ? 'chevronDown' : 'chevronRight', 16)}</span>
      <div class="sprint-title">
        <b>${esc(s.name)}</b> ${phase === 'past' ? '' : phaseBadge(s)}
        <div class="muted">${fmtDate(s.start)} – ${fmtDate(s.end)}</div>
        ${isOpen ? sprintGoals(s) : ''}
      </div>
      <div class="actions">
        <span class="muted" title="${done} of ${tasks.length} done">${done}/${tasks.length}</span>
        <button class="icon" data-sprint-edit="${s.id}" title="Edit sprint">${icon('pencil', 14)}</button>
      </div>
    </header>
    ${isOpen ? nested(tasks) || `<div class="placeholder">${phase === 'past' ? 'No tasks' : 'Drag tasks here'}</div>` : ''}
  </div>`;
}

export function render(view) {
  const root = freshBox(view);
  const backlog = store.tasks.filter(inBacklog);
  const open = store.sprints.filter((s) => sprintPhase(s) !== 'past').sort(sprintOrder);
  const past = store.sprints.filter((s) => sprintPhase(s) === 'past').sort(sprintOrder);

  root.innerHTML = `
    <div class="backlog-layout">
      <section class="pane drop" data-sprint="">
        <div class="pane-head"><h2>Backlog <span class="count">${backlog.length}</span></h2><button class="new-task">${icon('plus', 14)} Task</button></div>
        <p class="hint">Drag tasks into a sprint on the right. Unfinished subtasks move along with their parent.</p>
        ${nested(backlog, { leftover: true }) || empty('Backlog is empty')}
      </section>
      <section class="pane">
        <div class="pane-head"><h2>Sprints</h2><button class="primary new-sprint">${icon('plus', 14)} Sprint</button></div>
        ${open.map(sprintBox).join('') || empty('No current or upcoming sprints. Create one and drag tasks into it.')}
        ${past.length ? `<details class="closed-sprints"${pastOpen ? ' open' : ''}><summary>Past sprints (${past.length})</summary>
          ${past.map(sprintBox).join('')}</details>` : ''}
      </section>
    </div>`;

  root.querySelector('.new-task').addEventListener('click', () => openTaskEditor());
  root.querySelector('.new-sprint').addEventListener('click', () => openSprintEditor());

  root.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-sprint-edit]');
    if (edit) return openSprintEditor(sprintById(Number(edit.dataset.sprintEdit)));
    const toggle = e.target.closest('[data-toggle]');
    if (!toggle) return;
    const id = Number(toggle.dataset.toggle);
    if (openIds.has(id)) openIds.delete(id);
    else openIds.add(id);
    persist();
    render(view);
  });
  root.querySelector('.closed-sprints')?.addEventListener('toggle', (e) => {
    pastOpen = e.target.open;
    persist();
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
