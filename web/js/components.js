// Shared markup and behavior: task card, badges, drag and drop.
import { taskById, childrenOf, descendants, blockers, isOverdue, goalSum, projectColor, projectLabel, addProgress, updateTask, deleteTask } from './store.js';
import { openTaskEditor } from './editor.js';
import { esc, fmtDate, fmtNum, prioIcon, prioClass, trunc, toast } from './util.js';
import { icon } from './icons.js';

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
    parts.push(`<span class="badge" title="Subtasks">${icon('listChecks', 12)} ${done}/${kids.length}</span>`);
  }
  if (t.target != null) parts.push(goalBar(t));
  if (t.status === 'waiting') {
    const what = t.waiting_for ? esc(trunc(t.waiting_for, 28)) : 'waiting';
    parts.push(`<span class="badge waiting" title="${esc(t.waiting_for)}">${icon('hourglass', 12)} ${what}</span>`);
  }
  const blocking = t.status !== 'done' ? blockers(t) : [];
  if (blocking.length) {
    const titles = blocking.map((b) => b.title).join(', ');
    parts.push(`<span class="badge blocked" title="First: ${esc(titles)}">${icon('lock', 12)} blocked</span>`);
  }
  if (t.due) {
    const overdue = isOverdue(t);
    parts.push(`<span class="badge due${overdue ? ' overdue' : ''}" title="${overdue ? 'Overdue' : 'Due date'}">${icon(overdue ? 'alert' : 'calendar', 12)} ${fmtDate(t.due)}</span>`);
  }
  return parts.join('');
}

export function card(t, { depth = 0, showParent = true, note = '' } = {}) {
  const parent = showParent && t.parent_id != null ? taskById(t.parent_id) : null;
  const progressBtn = t.target != null && t.status !== 'done'
    ? `<button class="icon add-progress" data-progress="${t.id}" title="Add progress">${icon('plus', 14)}</button>` : '';
  return `<div class="card st-${t.status} prio-${prioClass(t.priority)}" data-id="${t.id}" draggable="true" style="--depth:${depth}">
    <div class="card-top">${prioIcon(t.priority)}<span class="card-title">${esc(t.title)}</span>${progressBtn}</div>
    ${parent ? `<div class="card-parent">${icon('cornerDownRight', 12)} ${esc(parent.title)}</div>` : ''}
    ${note ? `<div class="card-parent">${icon('undo', 12)} ${esc(note)}</div>` : ''}
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

/** A sprint's goals as a list of items. */
export function sprintGoals(s) {
  return s.goals?.length
    ? `<ul class="sprint-goals">${s.goals.map((g) => `<li>${icon('target', 12)}<span>${esc(g)}</span></li>`).join('')}</ul>` : '';
}

// ---------- context menu ----------

/** A right-click menu at (x, y). items: [{ label, icon, action, danger }], or null for a divider. */
export function openContextMenu(x, y, items) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items.map((it, i) => (it
    ? `<button type="button" role="menuitem" data-i="${i}"${it.danger ? ' class="danger"' : ''}>${it.icon ? icon(it.icon, 14) : ''}${esc(it.label)}</button>`
    : '<hr>')).join('');
  document.body.append(menu);
  // Keep it on screen.
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-i]');
    if (!btn) return;
    closeContextMenu();
    items[btn.dataset.i].action();
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = [...menu.querySelectorAll('button')];
    const i = buttons.indexOf(document.activeElement);
    buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length].focus();
  });
  menu.querySelector('button')?.focus();
}

/** Returns true if a menu was open. */
export function closeContextMenu() {
  const menu = document.querySelector('.ctx-menu');
  menu?.remove();
  return !!menu;
}

document.addEventListener('pointerdown', (e) => !e.target.closest?.('.ctx-menu') && closeContextMenu(), true);
// Esc closes the menu first; preventDefault tells app.js the key is used up.
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeContextMenu() && e.preventDefault());
window.addEventListener('resize', closeContextMenu);
document.addEventListener('scroll', closeContextMenu, true);

/** Right-click actions for a task, shared by the list and the graph. */
export function taskMenuItems(t) {
  const done = t.status === 'done';
  const subs = descendants(t.id).length;
  return [
    { label: 'Add subtask', icon: 'plus', action: () => openTaskEditor(null, { parent_id: t.id, project_id: t.project_id, sprint_id: t.sprint_id }) },
    { label: 'Edit', icon: 'pencil', action: () => openTaskEditor(t) },
    null,
    { label: done ? 'Mark not done' : 'Mark done', icon: done ? 'undo' : 'check', action: () => updateTask(t.id, { status: done ? 'todo' : 'done' }) },
    t.parent_id != null && taskById(t.parent_id)
      ? { label: 'Make top-level', icon: 'cornerDownRight', action: () => updateTask(t.id, { parent_id: null }) } : undefined,
    null,
    {
      label: 'Delete…', icon: 'x', danger: true,
      action: () => confirm(`Delete "${t.title}"${subs ? ` and its ${subs} subtask(s)` : ''}? Ctrl+Z brings it back.`) && deleteTask(t.id),
    },
  ].filter((it) => it !== undefined);
}
