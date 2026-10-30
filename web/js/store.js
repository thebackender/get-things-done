// App state: data from the server, lookup indexes, and all changes via the API.
import * as api from './api.js';
import { OTHER_COLOR, paint, today, toast } from './util.js';

export const store = { tasks: [], sprints: [], projects: [], history: [], canUndo: false, limits: {} };

const listeners = new Set();
export const subscribe = (fn) => listeners.add(fn);

let byId = new Map();
let kids = new Map();
let projectsById = new Map();
let projectOrder = [];

export async function reload() {
  const state = await api.getState();
  store.tasks = state.tasks;
  store.sprints = state.sprints;
  store.projects = state.projects;
  store.history = state.history;
  store.canUndo = state.can_undo;
  store.limits = state.limits ?? {};
  byId = new Map(store.tasks.map((t) => [t.id, t]));
  kids = new Map();
  for (const t of store.tasks) {
    if (t.parent_id == null) continue;
    if (!kids.has(t.parent_id)) kids.set(t.parent_id, []);
    kids.get(t.parent_id).push(t);
  }
  projectsById = new Map(store.projects.map((p) => [p.id, p]));
  // Each top-level project (by name), directly followed by its subprojects (by name).
  const byName = (a, b) => a.name.localeCompare(b.name, 'ru');
  const roots = store.projects.filter((p) => p.parent_id == null || !projectsById.has(p.parent_id)).sort(byName);
  projectOrder = roots.flatMap((r) => [r, ...store.projects.filter((p) => p.parent_id === r.id).sort(byName)]);
  listeners.forEach((fn) => fn());
}

// ---------- queries ----------

/** maxlength="…" for a text field, from the server's limits (see LIMITS in server.py). */
export const maxlength = (key, times = 1) => (store.limits[key] ? `maxlength="${store.limits[key] * times + times - 1}"` : '');
/** max="…" for a number field. */
export const maxNumber = (key) => (store.limits[key] ? `max="${store.limits[key]}"` : '');

export const taskById = (id) => byId.get(id);
export const childrenOf = (id) => kids.get(id) || [];
export function descendants(id) {
  const out = [];
  const walk = (i) => childrenOf(i).forEach((c) => { out.push(c); walk(c.id); });
  walk(id);
  return out;
}

export const sprintById = (id) => store.sprints.find((s) => s.id === id);
// Sprints have no status: the dates decide. The server keeps sprints from overlapping.
/** 'past', 'current' or 'future'. */
export function sprintPhase(s) {
  const now = today();
  if (s.end < now) return 'past';
  return s.start > now ? 'future' : 'current';
}
/** The sprint today falls into, if any. */
export const activeSprint = () => store.sprints.find((s) => sprintPhase(s) === 'current');

/** Sprint order: current, upcoming (soonest first), past (latest first). */
export function sprintOrder(a, b) {
  const rank = { current: 0, future: 1, past: 2 };
  const pa = sprintPhase(a);
  return rank[pa] - rank[sprintPhase(b)] || (pa === 'past' ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start));
}

/**
 * Critical / Highest / High tasks are limited per sprint (LIMITS["sprint_priorities"] in server.py).
 * {used, limit} for a priority in a sprint, not counting task exceptId; null when there is no limit
 * (lower priorities, the backlog, past sprints).
 */
export function prioritySlots(sprintId, priority, exceptId = null) {
  const limit = store.limits.sprint_priorities?.[priority];
  const s = sprintId != null ? sprintById(sprintId) : null;
  if (limit == null || !s || sprintPhase(s) === 'past') return null;
  const used = store.tasks.filter((t) => t.sprint_id === sprintId && t.priority === priority && t.id !== exceptId).length;
  return { used, limit };
}

/** Unfinished tasks with no sprint, or left over in a sprint that has ended, belong to the backlog. */
export function inBacklog(t) {
  if (t.status === 'done') return false;
  const s = t.sprint_id != null ? sprintById(t.sprint_id) : null;
  return !s || sprintPhase(s) === 'past';
}

/** Unfinished tasks that t depends on. */
export const blockers = (t) => t.depends_on.map(taskById).filter((d) => d && d.status !== 'done');
export const isOverdue = (t) => t.status !== 'done' && !!t.due && t.due < today();
export const goalSum = (t) => t.progress.reduce((s, p) => s + Number(p.value || 0), 0);

// ---------- projects ----------

export const projectById = (id) => projectsById.get(id);
/** All projects in display order: each project followed by its subprojects. */
export const projectList = () => projectOrder;
const rootOf = (p) => (p && p.parent_id != null ? projectsById.get(p.parent_id) ?? p : p);
/** "Project" or "Project:Subproject"; empty for no project. */
export function projectLabel(id) {
  const p = projectsById.get(id);
  if (!p) return '';
  const root = rootOf(p);
  return root === p ? p.name : `${root.name}:${p.name}`;
}
/** Subprojects use their top-level project's color (adjusted for the current theme). */
export const projectColor = (id) => paint(rootOf(projectsById.get(id))?.color ?? OTHER_COLOR);
/** Shown in the task editor dropdown: active, and for subprojects the parent is active too. */
export function isSelectable(p) {
  const root = rootOf(p);
  return p.is_active && root.is_active;
}

const dueKey = (t) => t.due || '9999';
/** Done tasks last, then by priority, then by due date. */
export const byPriority = (a, b) =>
  (a.status === 'done') - (b.status === 'done') || b.priority - a.priority || dueKey(a).localeCompare(dueKey(b)) || a.id - b.id;
export const byDue = (a, b) =>
  (a.status === 'done') - (b.status === 'done') || dueKey(a).localeCompare(dueKey(b)) || b.priority - a.priority || a.id - b.id;

// ---------- mutations ----------

async function run(promise, message) {
  try {
    const res = await promise;
    const text = typeof message === 'function' ? message(res) : message;
    if (res?.goal_reached) toast('Goal reached, task marked done');
    else if (text) toast(text);
    return res;
  } catch (e) {
    toast(e.message, 'error');
    return null;
  } finally {
    await reload().catch((e) => toast(e.message, 'error'));
  }
}

export const createTask = (data) => run(api.post('/api/tasks', data));
export const updateTask = (id, data) => run(api.put(`/api/tasks/${id}`, data));
/** Several changes in one request, undone with a single Ctrl+Z. items = [{id, ...fields}] */
export const updateTasks = (items) => run(api.post('/api/tasks/batch', { items }));
export const deleteTask = (id) =>
  run(api.del(`/api/tasks/${id}`), (r) => `Deleted ${r.deleted.length} task(s). Ctrl+Z to restore`);
export const addProgress = (id, value, date) => run(api.post(`/api/tasks/${id}/progress`, { value, date }));

export const createSprint = (data) => run(api.post('/api/sprints', data));
export const updateSprint = (id, data) =>
  run(api.put(`/api/sprints/${id}`, data));
export const deleteSprint = (id) => run(api.del(`/api/sprints/${id}`), 'Sprint deleted');

/** Create a project. {path: "A" or "A:B"} finds or creates; {name, parent_id} creates exactly that. */
export const createProject = (body) => run(api.post('/api/projects', body));
export const updateProject = (id, data) => run(api.put(`/api/projects/${id}`, data));
export const deleteProject = (id) =>
  run(api.del(`/api/projects/${id}`), (r) => `Project deleted${r.cleared ? `, removed from ${r.cleared} task(s)` : ''}`);

export async function undo() {
  if (!store.canUndo) return toast('Nothing to undo');
  await run(api.post('/api/undo'), 'Undone');
}
