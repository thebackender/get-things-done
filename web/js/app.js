// Entry point: tabs, keyboard shortcuts, re-render on data changes.
import { store, reload, subscribe, undo } from './store.js';
import { openTaskEditor } from './editor.js';
import { esc } from './util.js';
import { toggleTheme } from './theme.js';
import * as tasks from './views/tasks.js';
import * as backlog from './views/backlog.js';
import * as graph from './views/graph.js';
import * as projects from './views/projects.js';

const VIEWS = { list: tasks, backlog, graph, projects };
// Old tab links still work: Sprint and Calendar were merged into Tasks, Stats was removed, Settings became Projects.
const ALIASES = { board: 'list', calendar: 'list', stats: 'list', settings: 'projects' };
const main = document.getElementById('view');
const undoBtn = document.getElementById('undo-btn');

let current = 'list';

function route() {
  const hash = location.hash.slice(1);
  const name = VIEWS[hash] ? hash : ALIASES[hash] ?? 'list';
  current = name;
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${name}`));
  // A fresh container each time, so the old view's event listeners go away with it.
  const root = document.createElement('div');
  root.className = `view view-${name}`;
  main.replaceChildren(root);
  VIEWS[name].render(root);
}

subscribe(() => {
  undoBtn.disabled = !store.canUndo;
  route();
});
window.addEventListener('hashchange', route);
window.addEventListener('themechange', route); // charts and the graph pick their colors in JS

/** New task with the current tab's defaults (its filters, or no sprint in the backlog). */
const newTask = () => openTaskEditor(null, VIEWS[current].newTaskPreset?.() ?? {});
document.getElementById('add-task').addEventListener('click', newTask);
undoBtn.addEventListener('click', () => undo());
document.getElementById('theme-btn').addEventListener('click', toggleTheme);

// Shortcuts use e.code (the physical key), so they also work with a Russian keyboard layout.
document.addEventListener('keydown', (e) => {
  const typing = e.target.closest('input, textarea, select, [contenteditable]');
  const dialogOpen = document.getElementById('dialog').open || document.getElementById('confirm-dialog').open;
  if (e.key === 'Escape') {
    // Esc closes what's open first (menus, popovers and dialogs handle it themselves), then acts on the tab.
    if (e.defaultPrevented || dialogOpen) return;
    const menus = document.querySelectorAll('details.view-menu[open]');
    if (menus.length) return menus.forEach((d) => d.removeAttribute('open'));
    if (typing) return e.target.blur();
    VIEWS[current].onEscape?.();
    return;
  }
  if (typing || dialogOpen) return;
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyZ') {
    e.preventDefault();
    undo();
  } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'KeyN') {
    e.preventDefault();
    newTask();
  } else if (!e.ctrlKey && !e.metaKey && !e.altKey && /^(Digit|Numpad)[1-9]$/.test(e.code)) {
    // 1–4: the tabs in header order.
    const tab = document.querySelectorAll('#tabs a')[Number(e.code.at(-1)) - 1];
    if (tab) {
      e.preventDefault();
      location.hash = tab.getAttribute('href');
    }
  }
});

reload().catch((e) => {
  main.innerHTML = `<div class="empty error">${esc(e.message)}</div>`;
});
