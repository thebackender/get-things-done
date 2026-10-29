// Modal dialogs: task editor and sprint editor (one shared <dialog>).
import {
  store, taskById, childrenOf, descendants, projectList, projectLabel, isSelectable, createProject, sprintById, sprintOrder,
  createTask, updateTask, deleteTask, createSprint, updateSprint, deleteSprint,
} from './store.js';
import {
  PRIORITIES, STATUSES, esc, opt, today, addDays, fmtDate, fmtTs, fmtNum, statusName, prioName, toast,
  dateInput, bindDateInputs, readDate,
} from './util.js';

const dlg = document.getElementById('dialog');

// Clicking the dimmed backdrop closes the dialog.
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

const NEW_TASK = {
  title: '', parent_id: null, status: 'todo', priority: 0, project_id: null, due: null,
  depends_on: [], sprint_id: null, notes: '', waiting_for: '', target: null, unit: '', progress: [],
};

const NEW_PROJECT = '__new__';

/** A filterable checkbox list of other tasks (used for "Blocked by" and "Blocking"). */
function relationSection(name, title, hint, tasks, selected) {
  const sorted = [...tasks].sort((a, b) => selected.includes(b.id) - selected.includes(a.id) ||
    (a.status === 'done') - (b.status === 'done') || a.title.localeCompare(b.title, 'ru'));
  return `<details ${selected.length ? 'open' : ''}>
    <summary>${title} <span class="count rel-count" data-for="${name}">${selected.length}</span> <span class="muted">· ${hint}</span></summary>
    ${sorted.length ? `<input type="search" class="dep-filter" placeholder="Filter…">
    <div class="dep-list">${sorted.map((d) => `<label class="check" data-title="${esc(d.title.toLowerCase())}">
      <input type="checkbox" name="${name}" value="${d.id}" ${selected.includes(d.id) ? 'checked' : ''}>
      ${esc(d.title)}${d.status === 'done' ? ' <span class="muted">(done)</span>' : ''}</label>`).join('')}</div>`
    : '<p class="muted">No other tasks yet.</p>'}
  </details>`;
}

const FIELD_NAMES = {
  status: 'status', sprint_id: 'sprint', priority: 'priority', due: 'due', progress: 'progress',
};

function fmtValue(field, v) {
  if (v == null || v === '') return '—';
  if (field === 'status') return statusName(v);
  if (field === 'priority') return prioName(v);
  if (field === 'sprint_id') return sprintById(v)?.name ?? `#${v}`;
  if (field === 'due') return fmtDate(v);
  if (field === 'progress') return fmtNum(v);
  return String(v);
}

function historyLine(h) {
  let text;
  if (h.field === 'created') text = 'created';
  else if (h.field === 'deleted') text = 'deleted';
  else text = `${FIELD_NAMES[h.field] ?? h.field}: ${esc(fmtValue(h.field, h.from))} → ${esc(fmtValue(h.field, h.to))}`;
  return `<li><time>${fmtTs(h.ts)}</time> ${text}</li>`;
}

/**
 * Open the task editor. task = null creates a new task;
 * preset sets initial fields for a new task (for example parent or due date).
 */
export function openTaskEditor(task = null, preset = {}) {
  const isNew = !task;
  const t = structuredClone(task ?? { ...NEW_TASK, ...preset });
  let progress = [...t.progress];

  const banned = new Set(isNew ? [] : [t.id, ...descendants(t.id).map((d) => d.id)]);
  const parents = store.tasks.filter((x) => !banned.has(x.id) && x.status !== 'done' || x.id === t.parent_id)
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  // "Blocked by" is stored on this task (depends_on). "Blocking" is the reverse: tasks whose depends_on holds this one.
  const blockedBy = t.depends_on;
  const blocking = isNew ? [] : store.tasks.filter((x) => x.depends_on.includes(t.id)).map((x) => x.id);
  const others = store.tasks.filter((x) => x.id !== t.id);
  const sprints = store.sprints.filter((s) => s.status !== 'closed' || s.id === t.sprint_id).sort(sprintOrder);
  const kids = isNew ? [] : childrenOf(t.id);
  const history = isNew ? [] : store.history.filter((h) => h.task_id === t.id).slice(-10).reverse();
  const isGoal = t.target != null;
  // Inactive projects are hidden from the dropdown, except the one this task already uses.
  const projects = projectList().filter((p) => isSelectable(p) || p.id === t.project_id);

  dlg.innerHTML = `
  <form class="editor" novalidate>
    <header>
      <h2>${isNew ? (t.parent_id ? 'New subtask' : 'New task') : `Task #${t.id}`}</h2>
      <button type="button" class="icon" data-act="close" title="Close (Esc)">✕</button>
    </header>
    <input name="title" class="title-input" placeholder="What needs to be done?" value="${esc(t.title)}" autocomplete="off">
    <div class="grid">
      <label>Status<select name="status">${STATUSES.map((s) => opt(s.value, s.name, t.status)).join('')}</select></label>
      <label>Priority<select name="priority">${PRIORITIES.map((p) => opt(p.value, `${p.icon} ${p.name}`.trim(), t.priority)).join('')}</select></label>
      <div class="field">Project
        <select name="project_id">
          <option value="">— none —</option>
          ${projects.map((p) => opt(p.id, projectLabel(p.id) + (isSelectable(p) ? '' : ' (inactive)'), t.project_id)).join('')}
          <option value="${NEW_PROJECT}">+ New project…</option>
        </select>
        <span class="inline-new" hidden>
          <input class="new-project" placeholder="Project or Project:Subproject" autocomplete="off">
          <button type="button" data-act="add-project">Add</button>
          <button type="button" class="icon" data-act="cancel-project" title="Cancel">✕</button>
        </span>
      </div>
      <label>Due date${dateInput('due', t.due)}</label>
      <label>Parent<select name="parent_id"><option value="">— none —</option>${parents.map((p) => opt(p.id, p.title, t.parent_id)).join('')}</select></label>
      <label>Sprint<select name="sprint_id"><option value="">Backlog</option>${sprints.map((s) => opt(s.id, s.name + (s.status === 'active' ? ' (active)' : ''), t.sprint_id)).join('')}</select></label>
    </div>
    <label class="waiting-row" ${t.status === 'waiting' ? '' : 'hidden'}>Waiting for<input name="waiting_for" value="${esc(t.waiting_for)}" placeholder="e.g. reply from the visa office"></label>
    <label>Notes<textarea name="notes" rows="4">${esc(t.notes)}</textarea></label>

    <fieldset class="goal">
      <label class="check"><input type="checkbox" name="is_goal" ${isGoal ? 'checked' : ''}> Measurable goal (hours, pages, km…)</label>
      <div class="goal-body" ${isGoal ? '' : 'hidden'}>
        <div class="grid">
          <label>Target<input type="number" name="target" min="0" step="any" value="${t.target ?? ''}"></label>
          <label>Unit<input name="unit" value="${esc(t.unit)}" placeholder="h"></label>
        </div>
        <div class="progress-box"></div>
      </div>
    </fieldset>

    ${relationSection('depends_on', 'Blocked by', 'tasks that must be done before this one', others, blockedBy)}
    ${relationSection('blocking', 'Blocking', 'tasks that wait for this one', others, blocking)}

    ${isNew ? '' : `<details ${kids.length ? 'open' : ''}>
      <summary>Subtasks <span class="count">${kids.length}</span></summary>
      <ul class="subtasks">${kids.map((k) => `<li class="st-${k.status}"><a href="#" data-open="${k.id}">${k.status === 'done' ? '✓ ' : ''}${esc(k.title)}</a></li>`).join('')}</ul>
      <button type="button" data-act="add-sub">+ subtask</button>
    </details>`}

    ${history.length ? `<details><summary>History</summary><ul class="history">${history.map(historyLine).join('')}</ul></details>` : ''}

    <footer>
      ${isNew ? '' : '<button type="button" class="danger" data-act="delete">Delete</button>'}
      <span class="spacer"></span>
      <button type="button" data-act="close">Cancel</button>
      <button type="submit" class="primary">Save</button>
    </footer>
  </form>`;

  const form = dlg.querySelector('form');
  const el = form.elements;
  bindDateInputs(form);
  const progressBox = form.querySelector('.progress-box');

  function renderProgress() {
    const sum = progress.reduce((s, p) => s + p.value, 0);
    const target = Number(el.target.value) || 0;
    const pct = target ? Math.min(100, (sum / target) * 100) : 0;
    const unit = esc(el.unit.value.trim());
    progressBox.innerHTML = `
      <div class="goal-summary"><span class="track wide"><span class="fill" style="width:${pct}%"></span></span>
        <b>${fmtNum(sum)}</b> / ${fmtNum(target)} ${unit}</div>
      <div class="progress-add">
        <input type="number" step="any" class="pv" placeholder="+ amount">
        ${dateInput('', today(), 'class="pd"')}
        <button type="button" data-act="add-progress">Add</button>
      </div>
      <ul class="progress-list">${progress.map((p, i) => ({ p, i })).reverse().map(({ p, i }) =>
        `<li><time>${fmtDate(p.date)}</time> ${p.value > 0 ? '+' : ''}${fmtNum(p.value)} ${unit}
         <button type="button" class="icon" data-act="del-progress" data-i="${i}" title="Delete entry">✕</button></li>`).join('')}</ul>`;
  }
  renderProgress();

  // ---- project: dropdown with inline "new project" ("Project" or "Project:Subproject") ----
  const projectSelect = el.project_id;
  const newProjectRow = form.querySelector('.inline-new');
  const newProjectInput = form.querySelector('.new-project');
  let lastProject = projectSelect.value;
  async function addProject() {
    const path = newProjectInput.value.trim();
    if (!path) return newProjectInput.focus();
    const res = await createProject({ path }); // finds or creates; the store is reloaded when it returns
    if (!res) return; // the error was already shown
    const id = String(res.item.id);
    if (![...projectSelect.options].some((o) => o.value === id)) {
      projectSelect.querySelector(`option[value="${NEW_PROJECT}"]`).before(new Option(projectLabel(res.item.id), id));
    }
    projectSelect.value = lastProject = id;
    newProjectInput.value = '';
    newProjectRow.hidden = true;
  }

  // A task can't be both "Blocked by" and "Blocking" (that would be a cycle): checking it in one list disables it in the other.
  const checkedIds = (name) => [...form.querySelectorAll(`input[name=${name}]:checked`)].map((c) => Number(c.value));
  function syncRelations() {
    const pairs = [['depends_on', 'blocking', 'Blocking'], ['blocking', 'depends_on', 'Blocked by']];
    for (const [name, other, otherTitle] of pairs) {
      const taken = new Set(checkedIds(other));
      form.querySelectorAll(`input[name=${name}]`).forEach((c) => {
        c.disabled = taken.has(Number(c.value));
        c.closest('label').title = c.disabled ? `Already in "${otherTitle}"` : '';
      });
      const count = form.querySelector(`.rel-count[data-for=${name}]`);
      if (count) count.textContent = checkedIds(name).length;
    }
  }
  syncRelations();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const title = el.title.value.trim();
    if (!title) {
      el.title.classList.add('invalid');
      el.title.focus();
      return;
    }
    // A new project typed in but not added yet still counts.
    if (!newProjectRow.hidden && newProjectInput.value.trim()) await addProject();
    const due = readDate(el.due, 'Due date');
    if (due === undefined) return;
    const goal = el.is_goal.checked;
    const target = goal ? Number(el.target.value) : null;
    if (goal && !(target > 0)) {
      toast('Set a target greater than zero', 'error');
      el.target.focus();
      return;
    }
    const data = {
      title,
      status: el.status.value,
      priority: Number(el.priority.value),
      project_id: projectSelect.value && projectSelect.value !== NEW_PROJECT ? Number(projectSelect.value) : null,
      due,
      parent_id: el.parent_id.value ? Number(el.parent_id.value) : null,
      sprint_id: el.sprint_id.value ? Number(el.sprint_id.value) : null,
      notes: el.notes.value,
      waiting_for: el.waiting_for.value.trim(),
      depends_on: checkedIds('depends_on'),
      blocking: checkedIds('blocking'), // the server updates "Blocked by" on those tasks
      target,
      unit: goal ? el.unit.value.trim() : '',
      progress,
    };
    dlg.close();
    if (isNew) await createTask(data);
    else await updateTask(t.id, data);
  };

  form.onclick = (e) => {
    const open = e.target.closest('[data-open]');
    if (open) {
      e.preventDefault();
      return openTaskEditor(taskById(Number(open.dataset.open)));
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') dlg.close();
    if (act === 'add-project') addProject();
    if (act === 'cancel-project') newProjectRow.hidden = true;
    if (act === 'add-sub') openTaskEditor(null, { parent_id: t.id, project_id: t.project_id, sprint_id: t.sprint_id });
    if (act === 'delete') {
      const n = descendants(t.id).length;
      if (confirm(`Delete "${t.title}"${n ? ` and its ${n} subtask(s)` : ''}?`)) {
        dlg.close();
        deleteTask(t.id);
      }
    }
    if (act === 'add-progress') {
      const value = Number(form.querySelector('.pv').value);
      if (!value) return toast('Enter a number', 'error');
      const date = readDate(form.querySelector('.pd'), 'Progress date');
      if (date === undefined) return;
      progress.push({ date: date || today(), value });
      renderProgress();
    }
    if (act === 'del-progress') {
      progress.splice(Number(e.target.closest('[data-i]').dataset.i), 1);
      renderProgress();
    }
  };

  form.oninput = (e) => {
    if (e.target.name === 'title' || e.target.closest('.date-field')) e.target.classList.remove('invalid');
    if (e.target.name === 'target' || e.target.name === 'unit') renderProgress();
    if (e.target.classList.contains('dep-filter')) {
      const q = e.target.value.trim().toLowerCase();
      e.target.nextElementSibling.querySelectorAll('label').forEach((l) => (l.hidden = !l.dataset.title.includes(q)));
    }
  };

  form.onchange = (e) => {
    if (e.target.name === 'status') form.querySelector('.waiting-row').hidden = e.target.value !== 'waiting';
    if (e.target === projectSelect) {
      if (projectSelect.value === NEW_PROJECT) {
        projectSelect.value = lastProject;
        newProjectRow.hidden = false;
        newProjectInput.focus();
      } else lastProject = projectSelect.value;
    }
    if (e.target.name === 'is_goal') form.querySelector('.goal-body').hidden = !e.target.checked;
    if (e.target.name === 'depends_on' || e.target.name === 'blocking') syncRelations();
  };

  // Enter in the progress and new project boxes adds an item instead of submitting the form.
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const cls = e.target.classList;
    if (cls.contains('pv')) form.querySelector('[data-act=add-progress]').click();
    else if (cls.contains('new-project')) addProject();
    else return;
    e.preventDefault();
  });

  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  if (isNew) el.title.focus();
}

/** Open the sprint editor. sprint = null creates a new sprint. */
export function openSprintEditor(sprint = null) {
  const isNew = !sprint;
  let s = sprint;
  if (isNew) {
    const lastEnd = store.sprints.map((x) => x.end).filter(Boolean).sort().at(-1);
    const start = lastEnd && lastEnd >= today() ? addDays(lastEnd, 1) : today();
    s = { name: `Sprint ${store.sprints.length + 1}`, start, end: addDays(start, 6), goal: '', status: 'planned' };
  }
  const count = isNew ? 0 : store.tasks.filter((x) => x.sprint_id === s.id).length;

  dlg.innerHTML = `
  <form class="editor narrow" novalidate>
    <header><h2>${isNew ? 'New sprint' : 'Sprint'}</h2><button type="button" class="icon" data-act="close">✕</button></header>
    <label>Name<input name="name" value="${esc(s.name)}" autocomplete="off"></label>
    <div class="grid">
      <label>Start${dateInput('start', s.start)}</label>
      <label>End${dateInput('end', s.end)}</label>
    </div>
    <label>Sprint goal<textarea name="goal" rows="2" placeholder="What I want to achieve in these days">${esc(s.goal)}</textarea></label>
    ${isNew ? '' : `<p class="muted">Status: ${s.status} · tasks: ${count}</p>`}
    <footer>
      ${isNew ? '' : '<button type="button" class="danger" data-act="delete">Delete</button>'}
      <span class="spacer"></span>
      <button type="button" data-act="close">Cancel</button>
      <button type="submit" class="primary">Save</button>
    </footer>
  </form>`;

  const form = dlg.querySelector('form');
  const el = form.elements;
  bindDateInputs(form);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const start = readDate(el.start, 'Start');
    if (start === undefined) return;
    const end = readDate(el.end, 'End');
    if (end === undefined) return;
    const data = { name: el.name.value.trim(), start, end, goal: el.goal.value.trim() };
    if (!data.name) return el.name.focus();
    if (data.start && data.end && data.end < data.start) return toast('Sprint end is before its start', 'error');
    dlg.close();
    if (isNew) await createSprint(data);
    else await updateSprint(s.id, data);
  };
  form.onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') dlg.close();
    if (act === 'delete' && confirm(`Delete sprint "${s.name}"?${count ? ` Its ${count} task(s) will go back to the backlog.` : ''}`)) {
      dlg.close();
      deleteSprint(s.id);
    }
  };
  if (!dlg.open) dlg.showModal();
  el.name.focus();
}
