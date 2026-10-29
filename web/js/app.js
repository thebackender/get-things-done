// Entry point: tabs, keyboard shortcuts, re-render on data changes.
import { store, reload, subscribe, undo } from './store.js';
import { openTaskEditor } from './editor.js';
import { esc } from './util.js';
import * as list from './views/list.js';
import * as board from './views/board.js';
import * as backlog from './views/backlog.js';
import * as calendar from './views/calendar.js';
import * as graph from './views/graph.js';
import * as stats from './views/stats.js';

const VIEWS = { list, board, backlog, calendar, graph, stats };
const main = document.getElementById('view');
const undoBtn = document.getElementById('undo-btn');

function route() {
  const name = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'list';
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

document.getElementById('add-task').addEventListener('click', () => openTaskEditor());
undoBtn.addEventListener('click', () => undo());

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
