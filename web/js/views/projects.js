// Projects tab: projects and their subprojects (name, color, active).
import { store, projectList, projectById, isSelectable, createProject, updateProject, deleteProject } from '../store.js';
import { PALETTE, OTHER_COLOR, esc, empty, freshBox, paint, toast } from '../util.js';
import { icon } from '../icons.js';
import { isDark } from '../theme.js';

// Color picker: Coloris (web/vendor/coloris), loaded as a plain script. The palette colors are its quick swatches.
function setupPicker(root) {
  if (!window.Coloris) return;
  window.Coloris({
    el: '.color-input',
    wrap: true,
    themeMode: isDark() ? 'dark' : 'light',
    format: 'hex',
    alpha: false,
    swatches: COLORS,
    closeButton: true,
    closeLabel: 'Done',
    margin: 6,
  });
  window.Coloris.wrap('.color-input'); // fields drawn after start-up need wrapping too
}

const COLORS = [...PALETTE, OTHER_COLOR];
const plural = (n) => `${n} task${n === 1 ? '' : 's'}`;
const subprojectsOf = (id) => store.projects.filter((p) => p.parent_id === id);
const taskCount = (id) => store.tasks.filter((t) => t.project_id === id).length;

function projectRow(p) {
  const isSub = p.parent_id != null;
  const parent = isSub ? projectById(p.parent_id) : null;
  const n = taskCount(p.id) + (isSub ? 0 : subprojectsOf(p.id).reduce((s, c) => s + taskCount(c.id), 0));
  const hiddenByParent = isSub && p.is_active && !isSelectable(p);
  return `<li class="${isSub ? 'sub' : 'root'}${isSelectable(p) ? '' : ' inactive'}" data-project="${p.id}">
    <span class="name">${isSub ? icon('cornerDownRight', 14, 'muted') : `<i class="dot" style="--c:${paint(p.color)}"></i>`}${esc(p.name)}</span>
    <span class="muted">${plural(n)}</span>
    <label class="check" title="Inactive projects are hidden from the task editor's dropdown">
      <input type="checkbox" data-act="active" ${p.is_active ? 'checked' : ''}> active
    </label>
    ${hiddenByParent ? `<span class="muted">hidden: "${esc(parent.name)}" is inactive</span>` : ''}
    <span class="color-cell">${isSub ? '' : `<input class="color-input" value="${esc(p.color)}" data-act="color"
      title="Project color: click to pick" aria-label="Color of ${esc(p.name)}" spellcheck="false" autocomplete="off">`}</span>
    <button type="button" data-act="rename">Rename</button>
    <button type="button" class="danger" data-act="delete">Delete</button>
  </li>`;
}

export function render(view) {
  const root = freshBox(view);
  const list = projectList();
  const roots = list.filter((p) => p.parent_id == null);
  root.innerHTML = `
    <div class="settings">
      <section class="settings-card">
        <h2>Projects <span class="count">${list.length}</span></h2>
        <p class="hint">
          Pick a project in the task editor; it shows as <b>Project</b> or <b>Project:Subproject</b>.
          Subprojects go one level deep and use their project's color.
          Inactive projects are hidden from the editor's dropdown; their tasks keep them.
        </p>
        <form class="add-row">
          <input name="name" placeholder="New project name" autocomplete="off">
          <select name="parent_id" title="Where to add it">
            <option value="">as a top-level project</option>
            ${roots.map((p) => `<option value="${p.id}">as a subproject of ${esc(p.name)}</option>`).join('')}
          </select>
          <button class="primary">Add</button>
        </form>
        ${list.length ? `<ul class="manage-list">${list.map(projectRow).join('')}</ul>` : empty('No projects yet')}
      </section>
    </div>`;

  root.querySelector('.add-row').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = e.target.elements.name.value.trim();
    if (!name) return e.target.elements.name.focus();
    const parent = e.target.elements.parent_id.value;
    createProject({ name, parent_id: parent ? Number(parent) : null });
  });

  setupPicker(root);

  root.addEventListener('change', (e) => {
    const act = e.target.dataset.act;
    if (act !== 'active' && act !== 'color') return;
    const p = projectById(Number(e.target.closest('[data-project]').dataset.project));
    if (act === 'active') return updateProject(p.id, { is_active: e.target.checked });
    // The picker fires change when it closes; typed values are checked here and by the server.
    const color = e.target.value.trim().toLowerCase();
    if (color === p.color) return;
    if (!/^#[0-9a-f]{6}$/.test(color)) {
      e.target.value = p.color;
      return toast('Color must look like #1a2b3c', 'error');
    }
    updateProject(p.id, { color });
  });

  root.addEventListener('click', (e) => {
    const row = e.target.closest('[data-project]');
    if (!row) return;
    const p = projectById(Number(row.dataset.project));
    const act = e.target.closest('button[data-act]')?.dataset.act;
    if (act === 'rename') {
      const name = prompt('Rename project', p.name)?.trim();
      if (name && name !== p.name) updateProject(p.id, { name });
    }
    if (act === 'delete') {
      const subs = subprojectsOf(p.id);
      const n = taskCount(p.id) + subs.reduce((s, c) => s + taskCount(c.id), 0);
      const what = subs.length ? `"${p.name}" and its ${subs.length} subproject(s)` : `"${p.name}"`;
      if (confirm(`Delete ${what}?${n ? ` ${plural(n)} will be left without a project.` : ''}`)) deleteProject(p.id);
    }
  });
}
