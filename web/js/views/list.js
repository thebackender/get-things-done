// Task list (left side of the Tasks tab): task tree with search, a Sprint / All filter, sorting and grouping.
import { store, taskById, childrenOf, descendants, sprintById, sprintPhase, activeSprint, projectById, projectList, projectLabel, projectColor, updateTask } from '../store.js';
import { openTaskEditor, openSprintEditor } from '../editor.js';
import { projectChip, metaBadges, progressBar, sprintGoals, openContextMenu } from '../components.js';
import { esc, prioIcon, prioClass, statusName, empty, freshBox, fmtDate, today, daysBetween, trunc, toast, PRIORITIES } from '../util.js';
import { icon } from '../icons.js';
import { getPrefs, setPrefs } from '../prefs.js';

// View options are saved in data/settings.json; the search box is not.
// projects: project ids (and 'none' for tasks without one); priorities: priority values. Empty = no filter.
const state = {
  ...getPrefs('list', { scope: 'sprint', sort: 'priority', group: 'project', hideDone: false, projects: [], priorities: [], collapsed: [] }),
  q: '',
};
const persist = () => setPrefs('list', {
  scope: state.scope, sort: state.sort, group: state.group, hideDone: state.hideDone,
  projects: state.projects.filter((id) => id === 'none' || projectById(id)), // forget deleted projects
  priorities: state.priorities,
  collapsed: state.collapsed.filter((id) => taskById(id)), // forget deleted tasks
});

const SCOPES = { sprint: 'Sprint', all: 'All' };
const SORTS = { priority: 'Priority', due: 'Due date', created: 'Newest first', title: 'Title' };
const GROUPS = { project: 'Project', status: 'Status', sprint: 'Sprint', none: 'None' };
if (!GROUPS[state.group]) state.group = 'project'; // saved views from before projects existed
if (!SORTS[state.sort]) state.sort = 'priority';
if (!SCOPES[state.scope]) state.scope = 'sprint';
for (const key of ['collapsed', 'projects', 'priorities']) if (!Array.isArray(state[key])) state[key] = [];
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

// ---------- filters ----------
// Sprint / All, Project and Priority are shared by the list, the calendar and the Graph tab.
// "Hide done" is shared by the list and the graph (the calendar always shows done tasks, struck through).

/** "Sprint" shows only the active sprint's tasks; without an active sprint it shows everything. */
const scopeSprint = () => (state.scope === 'sprint' ? activeSprint() : null);

/** A top-level project also matches its subprojects; 'none' matches tasks without a (live) project. */
function projectMatch(t) {
  if (!state.projects.length) return true;
  const p = projectById(t.project_id);
  if (!p) return state.projects.includes('none');
  return state.projects.includes(p.id) || (p.parent_id != null && state.projects.includes(p.parent_id));
}
const priorityMatch = (t) => !state.priorities.length || state.priorities.includes(t.priority);

/** Sprint / All + Project + Priority: what the calendar shows. */
export function scopeFilter(t) {
  const sprint = scopeSprint();
  return (!sprint || t.sprint_id === sprint.id) && projectMatch(t) && priorityMatch(t);
}
/** What the list (and the graph) shows: scopeFilter minus done tasks when "Hide done" is on. */
const shown = (t) => scopeFilter(t) && !(state.hideDone && t.status === 'done');
export const listFilter = (t) => shown(t);

export const listView = () => ({ scope: state.scope, hideDone: state.hideDone });
export function setListView(patch) {
  Object.assign(state, patch);
  persist();
}
/** Collapsed tasks (their subtasks are hidden) are shared with the Graph tab too. */
export const isCollapsed = (id) => state.collapsed.includes(id);
export function toggleCollapsed(id) {
  state.collapsed = isCollapsed(id) ? state.collapsed.filter((x) => x !== id) : [...state.collapsed, id];
  persist();
}

function projectSummary() {
  const sel = state.projects;
  if (!sel.length) return 'Project';
  if (sel.length > 1) return `Projects: ${sel.length}`;
  if (sel[0] === 'none') return 'No project';
  return `Project: ${esc(trunc(projectById(sel[0])?.name ?? '?', 18))}`;
}
function prioritySummary() {
  if (!state.priorities.length) return 'Priority';
  return `Priority ${PRIORITIES.filter((p) => state.priorities.includes(p.value)).map((p) => prioIcon(p.value)).join('')}`;
}

/** The Project and Priority dropdowns (checkbox lists). Used in the list's and the graph's toolbars. */
export function filterMenus(openKey = null) {
  const check = (key, value, label) => `<label class="check"><input type="checkbox" data-filter-val="${value}" ${state[key].includes(value) ? 'checked' : ''}> ${label}</label>`;
  const menu = (key, summary, body) => `<details class="view-menu filter-menu" data-filter="${key}"${openKey === key ? ' open' : ''}>
    <summary class="${state[key].length ? 'active' : ''}">${summary}${icon('chevronDown', 14)}</summary>
    <div class="menu">${body}${state[key].length ? `<button type="button" class="ghost clear" data-clear="${key}">Clear</button>` : ''}</div>
  </details>`;
  const projects = projectList().map((p) => check('projects', p.id,
    `${p.parent_id == null ? `<i class="dot" style="--c:${projectColor(p.id)}"></i>` : `<span class="sub-indent"></span>`}${esc(p.name)}`)).join('');
  return menu('projects', projectSummary(), projects + check('projects', 'none', '<span class="muted">No project</span>')) +
    menu('priorities', prioritySummary(), PRIORITIES.map((p) => check('priorities', p.value, `${prioIcon(p.value)} ${p.name}`)).join(''));
}

/** Handle a change or click inside the filter menus. Returns the filter key that changed, or null. */
export function handleFilterEvent(e) {
  const clear = e.type === 'click' && e.target.closest('[data-clear]');
  if (clear) {
    state[clear.dataset.clear] = [];
    persist();
    return clear.dataset.clear;
  }
  if (e.type !== 'change' || !e.target.matches('[data-filter-val]')) return null;
  const menu = e.target.closest('[data-filter]');
  const key = menu.dataset.filter;
  state[key] = [...menu.querySelectorAll('[data-filter-val]:checked')].map((el) =>
    (el.dataset.filterVal === 'none' ? 'none' : Number(el.dataset.filterVal)));
  persist();
  return key;
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

/**
 * Render into pane. onScopeChange runs after Sprint / All, Project or Priority changes (the calendar follows them).
 * openMenu: a filter menu to keep open across the re-render, so several values can be ticked in a row.
 */
export function render(pane, opts = {}, openMenu = null) {
  const root = freshBox(pane);
  const active = activeSprint();
  const sprint = scopeSprint();
  root.innerHTML = `
    <div class="toolbar list-toolbar">
      <input type="search" class="q" placeholder="Search…" value="${esc(state.q)}">
      ${active ? `<div class="segmented" role="radiogroup" aria-label="Show">
        ${Object.entries(SCOPES).map(([v, l]) => `<button type="button" role="radio" aria-checked="${state.scope === v}" class="${state.scope === v ? 'on' : ''}" data-scope="${v}">${l}</button>`).join('')}
      </div>` : ''}
      ${filterMenus(openMenu)}
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
  const refilter = (e) => {
    const key = handleFilterEvent(e);
    if (!key) return false;
    render(pane, opts, e.type === 'change' ? key : null);
    opts.onScopeChange?.();
    return true;
  };
  root.querySelector('.toolbar').addEventListener('change', refilter);
  root.querySelector('.toolbar').addEventListener('click', (e) => {
    if (refilter(e)) return;
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
  // ---------- drag and drop ----------
  // A row dropped on another row becomes its subtask; dropped on a group header, a top-level task.
  // Rows can also be dropped on a calendar day to set the due date (the calendar handles that drop).
  let dragId = null;
  const clearMarks = () => tree.querySelectorAll('.drop-into').forEach((el) => el.classList.remove('drop-into'));
  /** Where the dragged task would go: { el, parent } or null when the drop isn't allowed. */
  const dropTarget = (e) => {
    const t = taskById(dragId);
    if (!t) return null;
    const row = e.target.closest('.row');
    if (row) {
      const target = Number(row.dataset.id);
      // Not onto itself, its current parent or its own subtasks (that would make a loop).
      if (target === t.id || target === t.parent_id || descendants(t.id).some((d) => d.id === target)) return null;
      return { el: row, parent: target };
    }
    const header = e.target.closest('.group h3');
    return header && t.parent_id != null ? { el: header, parent: null } : null;
  };
  tree.addEventListener('dragstart', (e) => {
    const row = e.target.closest?.('.row[draggable]');
    if (!row) return;
    dragId = Number(row.dataset.id);
    e.dataTransfer.setData('text/plain', row.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  tree.addEventListener('dragover', (e) => {
    const target = dropTarget(e);
    clearMarks();
    if (!target) return;
    e.preventDefault();
    target.el.classList.add('drop-into');
  });
  tree.addEventListener('dragleave', (e) => !tree.contains(e.relatedTarget) && clearMarks());
  tree.addEventListener('drop', async (e) => {
    const target = dropTarget(e);
    clearMarks();
    if (!target) return;
    e.preventDefault();
    const t = taskById(dragId);
    if (await updateTask(t.id, { parent_id: target.parent })) {
      toast(target.parent == null ? `"${trunc(t.title, 40)}" is a top-level task now` : `"${trunc(t.title, 40)}" is a subtask of "${trunc(taskById(target.parent).title, 40)}"`);
    }
  });
  tree.addEventListener('dragend', (e) => {
    e.target.closest?.('.row')?.classList.remove('dragging');
    clearMarks();
    dragId = null;
  });

  // ---------- right-click menu ----------
  tree.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    e.preventDefault();
    const t = taskById(Number(row.dataset.id));
    const done = t.status === 'done';
    openContextMenu(e.clientX, e.clientY, [
      { label: 'Add subtask', icon: 'plus', action: () => openTaskEditor(null, { parent_id: t.id, project_id: t.project_id, sprint_id: t.sprint_id }) },
      { label: 'Edit', icon: 'pencil', action: () => openTaskEditor(t) },
      null,
      { label: done ? 'Mark not done' : 'Mark done', icon: done ? 'undo' : 'check', action: () => updateTask(t.id, { status: done ? 'todo' : 'done' }) },
      t.parent_id != null && taskById(t.parent_id)
        ? { label: 'Make top-level', icon: 'cornerDownRight', action: () => updateTask(t.id, { parent_id: null }) } : undefined,
    ].filter((it) => it !== undefined));
  });
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
    </section>`).join('') || empty(state.projects.length || state.priorities.length
    ? 'No tasks match the Project / Priority filters.'
    : scopeSprint() ? 'No tasks in this sprint. Add tasks to it in the <a href="#backlog">Backlog</a> tab, or switch to All.'
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
