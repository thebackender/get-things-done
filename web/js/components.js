// Shared markup and behavior: task card, badges, drag and drop.
import { taskById, childrenOf, blockers, isOverdue, goalSum, projectColor, projectLabel, addProgress } from './store.js';
import { openTaskEditor } from './editor.js';
import { esc, fmtDate, fmtNum, prioIcon, prioClass, trunc, toast } from './util.js';

/** "Project" or "Project:Subproject" with the project's color dot. */
export function projectChip(id) {
  const label = projectLabel(id);
  return label ? `<span class="chip" title="Project"><i class="dot" style="--c:${projectColor(id)}"></i>${esc(label)}</span>` : '';
}

export function goalBar(t) {
  const sum = goalSum(t);
  const pct = Math.min(100, (sum / t.target) * 100);
  const label = `${fmtNum(sum)}/${fmtNum(t.target)}${t.unit ? ' ' + esc(t.unit) : ''}`;
  return `<span class="goal-bar" title="${label}"><span class="track"><span class="fill" style="width:${pct}%"></span></span>${label}</span>`;
}

export function progressBar(done, total) {
  const pct = total ? (done / total) * 100 : 0;
  return `<span class="track wide"><span class="fill" style="width:${pct}%"></span></span>`;
}

/** Task status badges: subtasks, goal, waiting, blocked, due date. */
export function metaBadges(t) {
  const parts = [];
  const kids = childrenOf(t.id);
  if (kids.length) {
    const done = kids.filter((k) => k.status === 'done').length;
    parts.push(`<span class="badge" title="Subtasks">☑ ${done}/${kids.length}</span>`);
  }
  if (t.target != null) parts.push(goalBar(t));
  if (t.status === 'waiting') {
    const what = t.waiting_for ? esc(trunc(t.waiting_for, 28)) : 'waiting';
    parts.push(`<span class="badge waiting" title="${esc(t.waiting_for)}">⏳ ${what}</span>`);
  }
  const blocking = t.status !== 'done' ? blockers(t) : [];
  if (blocking.length) {
    const titles = blocking.map((b) => b.title).join(', ');
    parts.push(`<span class="badge blocked" title="First: ${esc(titles)}">⛓ blocked</span>`);
  }
  if (t.due) {
    const overdue = isOverdue(t);
    parts.push(`<span class="badge due${overdue ? ' overdue' : ''}" title="${overdue ? 'Overdue' : 'Due date'}">${overdue ? '⚠' : '📅'} ${fmtDate(t.due)}</span>`);
  }
  return parts.join('');
}

export function card(t, { depth = 0, showParent = true } = {}) {
  const parent = showParent && t.parent_id != null ? taskById(t.parent_id) : null;
  const progressBtn = t.target != null && t.status !== 'done'
    ? `<button class="icon add-progress" data-progress="${t.id}" title="Add progress">+</button>` : '';
  return `<div class="card st-${t.status} prio-${prioClass(t.priority)}" data-id="${t.id}" draggable="true" style="--depth:${depth}">
    <div class="card-top">${prioIcon(t.priority)}<span class="card-title">${esc(t.title)}</span>${progressBtn}</div>
    ${parent ? `<div class="card-parent">↳ ${esc(parent.title)}</div>` : ''}
    <div class="card-meta">${projectChip(t.project_id)}${metaBadges(t)}</div>
  </div>`;
}

export async function promptProgress(id) {
  const t = taskById(id);
  const raw = prompt(`How much to add to "${t.title}"${t.unit ? ` (${t.unit})` : ''}?`);
  if (raw == null || !raw.trim()) return;
  const value = Number(raw.replace(',', '.'));
  if (!Number.isFinite(value) || value === 0) return toast('Enter a non-zero number', 'error');
  await addProgress(id, value);
}

/** Clicking a card opens the editor; the "+" button adds goal progress. */
export function cardClicks(root) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-progress]');
    if (btn) return promptProgress(Number(btn.dataset.progress));
    const el = e.target.closest('.card, .cal-task');
    if (el) openTaskEditor(taskById(Number(el.dataset.id)));
  });
}

/** Drag elements with data-id onto zones matching selector. onDrop(id, zone). */
export function dragAndDrop(root, selector, onDrop) {
  root.addEventListener('dragstart', (e) => {
    const el = e.target.closest?.('[data-id][draggable]');
    if (!el) return;
    e.dataTransfer.setData('text/plain', el.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    el.classList.add('dragging');
  });
  root.addEventListener('dragend', (e) => e.target.closest?.('[data-id]')?.classList.remove('dragging'));
  root.addEventListener('dragover', (e) => {
    const zone = e.target.closest(selector);
    if (!zone) return;
    e.preventDefault();
    root.querySelectorAll('.drag-over').forEach((z) => z !== zone && z.classList.remove('drag-over'));
    zone.classList.add('drag-over');
  });
  root.addEventListener('dragleave', (e) => {
    const zone = e.target.closest(selector);
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
  });
  root.addEventListener('drop', (e) => {
    const zone = e.target.closest(selector);
    if (!zone) return;
    e.preventDefault();
    zone.classList.remove('drag-over');
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (id) onDrop(id, zone);
  });
}
