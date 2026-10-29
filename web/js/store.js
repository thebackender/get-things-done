// App state: data from the server, lookup indexes, and all changes via the API.
import * as api from './api.js';
import { PALETTE, OTHER_COLOR, today, toast } from './util.js';

export const store = { tasks: [], sprints: [], history: [], canUndo: false };

const listeners = new Set();
export const subscribe = (fn) => listeners.add(fn);

let byId = new Map();
let kids = new Map();
let cats = [];

export async function reload() {
  const state = await api.getState();
  store.tasks = state.tasks;
  store.sprints = state.sprints;
  store.history = state.history;
  store.canUndo = state.can_undo;
  byId = new Map(store.tasks.map((t) => [t.id, t]));
  kids = new Map();
  for (const t of store.tasks) {
    if (t.parent_id == null) continue;
    if (!kids.has(t.parent_id)) kids.set(t.parent_id, []);
    kids.get(t.parent_id).push(t);
  }
  cats = [...new Set(store.tasks.map((t) => t.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  listeners.forEach((fn) => fn());
}

// ---------- queries ----------

export const taskById = (id) => byId.get(id);
export const childrenOf = (id) => kids.get(id) || [];
export function descendants(id) {
  const out = [];
  const walk = (i) => childrenOf(i).forEach((c) => { out.push(c); walk(c.id); });
  walk(id);
  return out;
}

export const sprintById = (id) => store.sprints.find((s) => s.id === id);
export const activeSprint = () => store.sprints.find((s) => s.status === 'active');

/** Sprint order: active, planned by date, closed (newest first). */
export function sprintOrder(a, b) {
  const rank = { active: 0, planned: 1, closed: 2 };
  return rank[a.status] - rank[b.status] ||
    (a.status === 'closed' ? (b.start || '').localeCompare(a.start || '') : (a.start || '').localeCompare(b.start || ''));
}

/** Unfinished tasks that t depends on. */
export const blockers = (t) => t.depends_on.map(taskById).filter((d) => d && d.status !== 'done');
export const isOverdue = (t) => t.status !== 'done' && !!t.due && t.due < today();
export const goalSum = (t) => t.progress.reduce((s, p) => s + Number(p.value || 0), 0);

export const categories = () => cats;
export function categoryColor(cat) {
  const i = cats.indexOf(cat);
  return i >= 0 && i < PALETTE.length ? PALETTE[i] : OTHER_COLOR;
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
    if (res?.goal_reached) toast('🎯 Goal reached, task marked done');
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
  run(api.put(`/api/sprints/${id}`, data), (r) => (r.moved_to_backlog ? `${r.moved_to_backlog} task(s) moved back to the backlog` : null));
export const deleteSprint = (id) => run(api.del(`/api/sprints/${id}`), 'Sprint deleted');

export async function undo() {
  if (!store.canUndo) return toast('Nothing to undo');
  await run(api.post('/api/undo'), 'Undone');
}
