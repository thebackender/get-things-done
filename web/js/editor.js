// Modal dialogs: task editor and sprint editor (one shared <dialog>).
import {
  store, taskById, childrenOf, descendants, categories, sprintById, sprintOrder,
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
  title: '', parent_id: null, status: 'todo', priority: 0, category: '', tags: [], due: null,
  depends_on: [], sprint_id: null, notes: '', waiting_for: '', target: null, unit: '', progress: [],
};

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
  const deps = store.tasks.filter((x) => x.id !== t.id)
    .sort((a, b) => t.depends_on.includes(b.id) - t.depends_on.includes(a.id) ||
      (a.status === 'done') - (b.status === 'done') || a.title.localeCompare(b.title, 'ru'));
  const sprints = store.sprints.filter((s) => s.status !== 'closed' || s.id === t.sprint_id).sort(sprintOrder);
  const kids = isNew ? [] : childrenOf(t.id);
  const history = isNew ? [] : store.history.filter((h) => h.task_id === t.id).slice(-10).reverse();
  const isGoal = t.target != null;

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
      <label>Category<input name="category" list="category-list" value="${esc(t.category)}" autocomplete="off" placeholder="Health, Shopping…">
        <datalist id="category-list">${categories().map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <label>Due date${dateInput('due', t.due)}</label>
      <label>Parent<select name="parent_id"><option value="">— none —</option>${parents.map((p) => opt(p.id, p.title, t.parent_id)).join('')}</select></label>
      <label>Sprint<select name="sprint_id"><option value="">Backlog</option>${sprints.map((s) => opt(s.id, s.name + (s.status === 'active' ? ' (active)' : ''), t.sprint_id)).join('')}</select></label>
    </div>
    <label class="waiting-row" ${t.status === 'waiting' ? '' : 'hidden'}>Waiting for<input name="waiting_for" value="${esc(t.waiting_for)}" placeholder="e.g. reply from the visa office"></label>
    <label>Tags<input name="tags" value="${esc(t.tags.join(', '))}" placeholder="comma-separated"></label>
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

    <details ${t.depends_on.length ? 'open' : ''}>
      <summary>Depends on <span class="count dep-count">${t.depends_on.length}</span></summary>
      ${deps.length ? `<input type="search" class="dep-filter" placeholder="Filter…">
      <div class="dep-list">${deps.map((d) => `<label class="check" data-title="${esc(d.title.toLowerCase())}">
        <input type="checkbox" name="depends_on" value="${d.id}" ${t.depends_on.includes(d.id) ? 'checked' : ''}>
        ${esc(d.title)}${d.status === 'done' ? ' <span class="muted">(done)</span>' : ''}</label>`).join('')}</div>`
      : '<p class="muted">No other tasks yet.</p>'}
    </details>

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

  form.onsubmit = async (e) => {
    e.preventDefault();
    const title = el.title.value.trim();
    if (!title) {
      el.title.classList.add('invalid');
      el.title.focus();
      return;
    }
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
      category: el.category.value.trim(),
      due,
      parent_id: el.parent_id.value ? Number(el.parent_id.value) : null,
      sprint_id: el.sprint_id.value ? Number(el.sprint_id.value) : null,
      tags: el.tags.value.split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean),
      notes: el.notes.value,
      waiting_for: el.waiting_for.value.trim(),
      depends_on: [...form.querySelectorAll('input[name=depends_on]:checked')].map((c) => Number(c.value)),
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
    if (act === 'add-sub') openTaskEditor(null, { parent_id: t.id, category: t.category, sprint_id: t.sprint_id });
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
      form.querySelectorAll('.dep-list label').forEach((l) => (l.hidden = !l.dataset.title.includes(q)));
    }
  };

  form.onchange = (e) => {
    if (e.target.name === 'status') form.querySelector('.waiting-row').hidden = e.target.value !== 'waiting';
    if (e.target.name === 'is_goal') form.querySelector('.goal-body').hidden = !e.target.checked;
    if (e.target.name === 'depends_on') {
      form.querySelector('.dep-count').textContent = form.querySelectorAll('input[name=depends_on]:checked').length;
    }
  };

  // Enter in the progress field adds an entry instead of submitting the form.
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('pv')) {
      e.preventDefault();
      form.querySelector('[data-act=add-progress]').click();
    }
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
