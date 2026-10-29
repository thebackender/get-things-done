// List tab: task tree with sorting, grouping and search.
import { store, taskById, childrenOf, sprintById, projectById, projectList, projectLabel, projectColor, byPriority, byDue, updateTask } from '../store.js';
import { openTaskEditor } from '../editor.js';
import { projectChip, metaBadges } from '../components.js';
import { esc, prioIcon, statusName, empty } from '../util.js';

const KEY = 'gtd.list';
const state = { sort: 'priority', group: 'project', showDone: false, collapsed: [], ...JSON.parse(localStorage.getItem(KEY) || '{}'), q: '' };
const persist = () => localStorage.setItem(KEY, JSON.stringify({ ...state, q: '' }));

const SORTS = { priority: 'Priority', due: 'Due date', created: 'Newest first', title: 'Title' };
const GROUPS = { project: 'Project', status: 'Status', sprint: 'Sprint', none: 'None' };
if (!GROUPS[state.group]) state.group = 'project'; // saved views from before projects existed
const STATUS_ORDER = { doing: 0, todo: 1, waiting: 2, done: 3 };

const doneLast = (a, b) => (a.status === 'done') - (b.status === 'done');
const COMPARE = {
  priority: byPriority,
  due: byDue,
  created: (a, b) => doneLast(a, b) || b.id - a.id,
  title: (a, b) => doneLast(a, b) || a.title.localeCompare(b.title, 'ru'),
};
const cmp = (a, b) => COMPARE[state.sort](a, b);
const visible = (t) => state.showDone || t.status !== 'done';

const select = (key, options) =>
  `<select data-key="${key}">${Object.entries(options).map(([v, l]) => `<option value="${v}" ${state[key] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;

export function render(root) {
  root.innerHTML = `
    <div class="toolbar">
      <input type="search" class="q" placeholder="Search titles, notes, projects…" value="${esc(state.q)}">
      <label>Sort ${select('sort', SORTS)}</label>
      <label>Group ${select('group', GROUPS)}</label>
      <label class="check"><input type="checkbox" class="show-done" ${state.showDone ? 'checked' : ''}> show done</label>
      <span class="spacer"></span>
      <span class="muted summary"></span>
    </div>
    <div class="tree"></div>`;
  renderBody(root);

  root.querySelector('.q').addEventListener('input', (e) => {
    state.q = e.target.value;
    renderBody(root);
  });
  root.addEventListener('change', (e) => {
    if (e.target.matches('select[data-key]')) {
      state[e.target.dataset.key] = e.target.value;
    } else if (e.target.matches('.show-done')) {
      state.showDone = e.target.checked;
    } else if (e.target.matches('.done-toggle')) {
      const id = Number(e.target.closest('.row').dataset.id);
      return updateTask(id, { status: e.target.checked ? 'done' : 'todo' });
    } else return;
    persist();
    renderBody(root);
  });
  root.querySelector('.tree').addEventListener('click', (e) => {
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
}

function renderBody(root) {
  const body = root.querySelector('.tree');
  const open = store.tasks.filter((t) => t.status !== 'done').length;
  root.querySelector('.summary').textContent = `${open} open · ${store.tasks.length - open} done`;

  if (!store.tasks.length) {
    body.innerHTML = empty('No tasks yet. Click "+ Task" or press <kbd>N</kbd>.');
    return;
  }

  const q = state.q.trim().toLowerCase();
  if (q) {
    const hits = store.tasks
      .filter((t) => visible(t) && [t.title, t.notes, projectLabel(t.project_id), t.waiting_for].join(' ').toLowerCase().includes(q))
      .sort(cmp);
    body.innerHTML = hits.map((t) => row(t, 0, { flat: true })).join('') || empty('Nothing found');
    return;
  }

  const roots = store.tasks.filter((t) => (t.parent_id == null || !taskById(t.parent_id)) && visible(t)).sort(cmp);
  body.innerHTML = groups(roots).map(({ name, color, items }) => `
    <section class="group">
      ${state.group !== 'none' ? `<h3>${color ? `<i class="dot" style="--c:${color}"></i>` : ''}${esc(name)} <span class="count">${items.length}</span></h3>` : ''}
      ${items.map((t) => tree(t, 0)).join('')}
    </section>`).join('') || empty('All done 🎉 Turn on "show done" to see them.');
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
  const rank = (k) => (k === '' ? 3 : { active: 0, planned: 1, closed: 2 }[sprintById(k)?.status] ?? 3);
  keys.sort((a, b) => rank(a) - rank(b));
  return keys.map((k) => ({ name: k === '' ? 'Backlog' : sprintById(k)?.name ?? `Sprint #${k}`, items: map.get(k) }));
}

function tree(t, depth) {
  const kids = childrenOf(t.id).filter(visible).sort(cmp);
  const collapsed = state.collapsed.includes(t.id);
  return row(t, depth, { hasKids: childrenOf(t.id).length > 0, collapsed }) +
    (collapsed ? '' : kids.map((k) => tree(k, depth + 1)).join(''));
}

function row(t, depth, { flat = false, hasKids = false, collapsed = false } = {}) {
  const parent = flat && t.parent_id != null ? taskById(t.parent_id) : null;
  const sprint = t.sprint_id != null && state.group !== 'sprint' ? sprintById(t.sprint_id) : null;
  return `<div class="row st-${t.status}" data-id="${t.id}" style="--depth:${depth}">
    <span class="caret">${hasKids ? (collapsed ? '▸' : '▾') : ''}</span>
    <input type="checkbox" class="done-toggle" ${t.status === 'done' ? 'checked' : ''} title="Done">
    <span class="prio">${prioIcon(t.priority)}</span>
    <span class="title">${esc(t.title)}${parent ? ` <span class="muted">← ${esc(parent.title)}</span>` : ''}</span>
    ${t.status === 'doing' ? '<span class="badge doing">in progress</span>' : ''}
    <span class="meta">
      ${metaBadges(t)}
      ${sprint && sprint.status !== 'closed' ? `<span class="badge sprint" title="Sprint">🏃 ${esc(sprint.name)}</span>` : ''}
      ${state.group !== 'project' ? projectChip(t.project_id) : ''}
    </span>
  </div>`;
}
