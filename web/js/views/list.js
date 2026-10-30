// Task list (left side of the Tasks tab): task tree with search, a Sprint / All filter, sorting and grouping.
import { store, taskById, childrenOf, sprintById, sprintPhase, activeSprint, projectById, projectList, projectLabel, projectColor, updateTask } from '../store.js';
import { openTaskEditor, openSprintEditor } from '../editor.js';
import { projectChip, metaBadges, progressBar, sprintGoals } from '../components.js';
import { esc, prioIcon, prioClass, statusName, empty, freshBox, fmtDate, today, daysBetween } from '../util.js';
import { icon } from '../icons.js';
import { getPrefs, setPrefs } from '../prefs.js';

// View options are saved in data/settings.json; the search box is not.
const state = { ...getPrefs('list', { scope: 'sprint', sort: 'priority', group: 'project', hideDone: false, collapsed: [] }), q: '' };
const persist = () => setPrefs('list', {
  scope: state.scope, sort: state.sort, group: state.group, hideDone: state.hideDone,
  collapsed: state.collapsed.filter((id) => taskById(id)), // forget deleted tasks
});

const SCOPES = { sprint: 'Sprint', all: 'All' };
const SORTS = { priority: 'Priority', due: 'Due date', created: 'Newest first', title: 'Title' };
const GROUPS = { project: 'Project', status: 'Status', sprint: 'Sprint', none: 'None' };
if (!GROUPS[state.group]) state.group = 'project'; // saved views from before projects existed
if (!SORTS[state.sort]) state.sort = 'priority';
if (!SCOPES[state.scope]) state.scope = 'sprint';
if (!Array.isArray(state.collapsed)) state.collapsed = [];
const STATUS_ORDER = { doing: 0, todo: 1, waiting: 2, done: 3 };

// Done tasks stay where the sort puts them (they are shown struck through), not moved to the bottom.
const dueKey = (t) => t.due || '9999';
const COMPARE = {
  priority: (a, b) => b.priority - a.priority || dueKey(a).localeCompare(dueKey(b)) || a.id - b.id,
  due: (a, b) => dueKey(a).localeCompare(dueKey(b)) || b.priority - a.priority || a.id - b.id,
  created: (a, b) => b.id - a.id,
  title: (a, b) => a.title.localeCompare(b.title, 'ru'),
};
const cmp = (a, b) => COMPARE[state.sort](a, b);

/** "Sprint" shows only the active sprint's tasks; without an active sprint it shows everything. */
const scopeSprint = () => (state.scope === 'sprint' ? activeSprint() : null);
/** The Sprint / All filter, shared with the calendar. */
/** What the list shows: the scope, minus done tasks when "Hide done" is on. The calendar uses scopeFilter only. */
const shown = (t) => scopeFilter(t) && !(state.hideDone && t.status === 'done');

// The Graph tab shows the same tasks as the list and shares these two options with it.
export const listFilter = (t) => shown(t);
export const listView = () => ({ scope: state.scope, hideDone: state.hideDone });
/** Collapsed tasks (their subtasks are hidden) are shared with the Graph tab too. */
export const isCollapsed = (id) => state.collapsed.includes(id);
export function toggleCollapsed(id) {
  state.collapsed = isCollapsed(id) ? state.collapsed.filter((x) => x !== id) : [...state.collapsed, id];
  persist();
}
export function setListView(patch) {
  Object.assign(state, patch);
  persist();
}
export function scopeFilter(t) {
  const sprint = scopeSprint();
  return !sprint || t.sprint_id === sprint.id;
}

// Close the View menu on a click outside it.
document.addEventListener('click', (e) => {
  document.querySelectorAll('details.view-menu[open]').forEach((d) => !d.contains(e.target) && d.removeAttribute('open'));
});

const select = (key, options) =>
  `<select data-key="${key}">${Object.entries(options).map(([v, l]) => `<option value="${v}" ${state[key] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;

function sprintLine(sprint) {
  const tasks = store.tasks.filter((t) => t.sprint_id === sprint.id);
  const done = tasks.filter((t) => t.status === 'done').length;
  const left = sprint.end ? daysBetween(today(), sprint.end) : null;
  const timing = left == null ? '' : left >= 0 ? ` · ${left} day${left === 1 ? '' : 's'} left` : ` · <span class="overdue">${-left} day(s) overdue</span>`;
  return `<div class="sprint-line">
    <div class="sprint-info">
      <div><b>${esc(sprint.name)}</b> <span class="muted">${fmtDate(sprint.start)} – ${fmtDate(sprint.end)}${timing}</span></div>
      ${sprintGoals(sprint)}
    </div>
    <span class="sprint-progress" title="${done} of ${tasks.length} done">${progressBar(done, tasks.length)} ${done}/${tasks.length}</span>
    <button class="icon edit-sprint" title="Edit sprint">${icon('pencil', 15)}</button>
  </div>`;
}

/** Render into pane. onScopeChange runs after the Sprint / All filter changes (the calendar follows it). */
export function render(pane, opts = {}) {
  const root = freshBox(pane);
  const active = activeSprint();
  const sprint = scopeSprint();
  root.innerHTML = `
    <div class="toolbar list-toolbar">
      <input type="search" class="q" placeholder="Search…" value="${esc(state.q)}">
      ${active ? `<div class="segmented" role="radiogroup" aria-label="Show">
        ${Object.entries(SCOPES).map(([v, l]) => `<button type="button" role="radio" aria-checked="${state.scope === v}" class="${state.scope === v ? 'on' : ''}" data-scope="${v}">${l}</button>`).join('')}
      </div>` : ''}
      <details class="view-menu">
        <summary title="Sorting, grouping, done tasks">${icon('sliders', 15)} View</summary>
        <div class="menu">
          <label>Sort ${select('sort', SORTS)}</label>
          <label>Group ${select('group', GROUPS)}</label>
          <label class="check"><input type="checkbox" class="hide-done" ${state.hideDone ? 'checked' : ''}> Hide done</label>
        </div>
      </details>
    </div>
    ${sprint ? sprintLine(sprint) : ''}
    <div class="tree"></div>`;
  renderBody(root);

  root.querySelector('.q').addEventListener('input', (e) => {
    state.q = e.target.value;
    renderBody(root);
  });
  root.querySelector('.toolbar').addEventListener('click', (e) => {
    const scope = e.target.closest('[data-scope]')?.dataset.scope;
    if (!scope || scope === state.scope) return;
    state.scope = scope;
    persist();
    render(pane, opts);
    opts.onScopeChange?.();
  });
  root.querySelector('.edit-sprint')?.addEventListener('click', () => openSprintEditor(sprint));
  root.addEventListener('change', (e) => {
    if (e.target.matches('select[data-key]')) {
      state[e.target.dataset.key] = e.target.value;
    } else if (e.target.matches('.hide-done')) {
      state.hideDone = e.target.checked;
    } else if (e.target.matches('.done-toggle')) {
      const id = Number(e.target.closest('.row').dataset.id);
      return updateTask(id, { status: e.target.checked ? 'done' : 'todo' });
    } else return;
    persist();
    renderBody(root);
  });
  const tree = root.querySelector('.tree');
  tree.addEventListener('click', (e) => {
    if (e.target.matches('.done-toggle')) return;
    const row = e.target.closest('.row');
    if (!row) return;
    const id = Number(row.dataset.id);
    if (e.target.closest('.caret') && childrenOf(id).length) {
      state.collapsed = state.collapsed.includes(id) ? state.collapsed.filter((x) => x !== id) : [...state.collapsed, id];
      persist();
      return renderBody(root);
    }
    openTaskEditor(taskById(id));
  });
  // Rows can be dropped on a calendar day to set the due date (the calendar handles the drop).
  tree.addEventListener('dragstart', (e) => {
    const row = e.target.closest?.('.row[draggable]');
    if (!row) return;
    e.dataTransfer.setData('text/plain', row.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  tree.addEventListener('dragend', (e) => e.target.closest?.('.row')?.classList.remove('dragging'));
}

function renderBody(root) {
  const body = root.querySelector('.tree');
  if (!store.tasks.length) {
    body.innerHTML = empty('No tasks yet. Click "New task" or press <kbd>N</kbd>.');
    return;
  }

  const q = state.q.trim().toLowerCase();
  if (q) {
    const hits = store.tasks
      .filter((t) => shown(t) && [t.title, t.notes, projectLabel(t.project_id), t.waiting_for].join(' ').toLowerCase().includes(q))
      .sort(cmp);
    body.innerHTML = hits.map((t) => row(t, 0, { flat: true })).join('') || empty('Nothing found');
    return;
  }

  // A task is a root here if its parent isn't shown (e.g. the parent is in another sprint).
  const roots = store.tasks.filter((t) => shown(t) && !(t.parent_id != null && taskById(t.parent_id) && shown(taskById(t.parent_id)))).sort(cmp);
  body.innerHTML = groups(roots).map(({ name, color, items }) => `
    <section class="group">
      ${state.group !== 'none' ? `<h3>${color ? `<i class="dot" style="--c:${color}"></i>` : ''}${esc(name)} <span class="count">${items.length}</span></h3>` : ''}
      ${items.map((t) => tree(t, 0)).join('')}
    </section>`).join('') || empty(scopeSprint()
    ? 'No tasks in this sprint. Add tasks to it in the <a href="#backlog">Backlog</a> tab, or switch to All.'
    : state.hideDone ? 'Nothing left to do. Turn off "Hide done" under View to see finished tasks.' : 'No tasks.');
}

function groups(roots) {
  if (state.group === 'none') return [{ name: '', items: roots }];
  const keyOf = {
    project: (t) => (projectById(t.project_id) ? t.project_id : ''),
    status: (t) => t.status,
    sprint: (t) => t.sprint_id ?? '',
  }[state.group];
  const map = new Map();
  for (const t of roots) {
    const k = keyOf(t);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  let keys = [...map.keys()];
  if (state.group === 'project') {
    // Same order as everywhere else: each project followed by its subprojects; no project last.
    const order = new Map(projectList().map((p, i) => [p.id, i]));
    keys.sort((a, b) => (a === '') - (b === '') || order.get(a) - order.get(b));
    return keys.map((k) => ({ name: k === '' ? 'No project' : projectLabel(k), color: k === '' ? null : projectColor(k), items: map.get(k) }));
  }
  if (state.group === 'status') {
    keys.sort((a, b) => STATUS_ORDER[a] - STATUS_ORDER[b]);
    return keys.map((k) => ({ name: statusName(k), items: map.get(k) }));
  }
  const rank = (k) => (k === '' || !sprintById(k) ? 3 : { current: 0, future: 1, past: 2 }[sprintPhase(sprintById(k))]);
  keys.sort((a, b) => rank(a) - rank(b));
  return keys.map((k) => ({ name: k === '' ? 'Backlog' : sprintById(k)?.name ?? `Sprint #${k}`, items: map.get(k) }));
}

function tree(t, depth) {
  const kids = childrenOf(t.id).filter(shown).sort(cmp);
  const collapsed = state.collapsed.includes(t.id);
  return row(t, depth, { hasKids: childrenOf(t.id).length > 0, collapsed }) +
    (collapsed ? '' : kids.map((k) => tree(k, depth + 1)).join(''));
}

function row(t, depth, { flat = false, hasKids = false, collapsed = false } = {}) {
  const parent = flat && t.parent_id != null ? taskById(t.parent_id) : null;
  const sprint = t.sprint_id != null && state.group !== 'sprint' && !scopeSprint() ? sprintById(t.sprint_id) : null;
  return `<div class="row st-${t.status} prio-${prioClass(t.priority)}" data-id="${t.id}" style="--depth:${depth}" draggable="true">
    <span class="caret">${hasKids ? icon(collapsed ? 'chevronRight' : 'chevronDown', 14) : ''}</span>
    <input type="checkbox" class="done-toggle" ${t.status === 'done' ? 'checked' : ''} title="Done">
    ${prioIcon(t.priority)}
    <span class="title">${esc(t.title)}${parent ? ` <span class="muted">· in ${esc(parent.title)}</span>` : ''}</span>
    ${t.status === 'doing' ? '<span class="badge doing">in progress</span>' : ''}
    <span class="meta">
      ${metaBadges(t)}
      ${sprint && sprintPhase(sprint) !== 'past' ? `<span class="badge sprint icon-only" title="Sprint: ${esc(sprint.name)}">${icon('zap', 12)}</span>` : ''}
      ${state.group !== 'project' ? projectChip(t.project_id) : ''}
    </span>
  </div>`;
}
