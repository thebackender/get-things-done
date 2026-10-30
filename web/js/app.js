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

function route() {
  const hash = location.hash.slice(1);
  const name = VIEWS[hash] ? hash : ALIASES[hash] ?? 'list';
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

document.getElementById('add-task').addEventListener('click', () => openTaskEditor());
undoBtn.addEventListener('click', () => undo());
document.getElementById('theme-btn').addEventListener('click', toggleTheme);

document.addEventListener('keydown', (e) => {
  const typing = e.target.closest('input, textarea, select, [contenteditable]');
  if (typing || document.getElementById('dialog').open) return;
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'n') {
    e.preventDefault();
    openTaskEditor();
  }
});

reload().catch((e) => {
  main.innerHTML = `<div class="empty error">${esc(e.message)}</div>`;
});
