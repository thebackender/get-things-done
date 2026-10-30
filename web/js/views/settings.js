// Settings tab: theme, and projects with their subprojects (name, color, active).
import { store, projectList, projectById, isSelectable, createProject, updateProject, deleteProject } from '../store.js';
import { PALETTE, OTHER_COLOR, esc, empty, freshBox, paint } from '../util.js';
import { icon } from '../icons.js';
import { THEMES, themeMode, setTheme } from '../theme.js';

const COLORS = [...PALETTE, OTHER_COLOR];
const THEME_ICONS = { light: 'sun', dark: 'moon', system: 'monitor' };
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
    <span class="swatches">${isSub ? '' : COLORS.map((c) =>
      `<button type="button" class="swatch${c === p.color ? ' on' : ''}" style="--c:${paint(c)}" data-color="${c}" title="Use this color"></button>`).join('')}</span>
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
        <h2>Appearance</h2>
        <p class="hint">System follows your OS setting. The theme, filters and sorting of every tab are saved in <code>data/settings.json</code>.</p>
        <div class="segmented" role="radiogroup" aria-label="Theme">
          ${Object.entries(THEMES).map(([value, label]) => `<button type="button" role="radio" data-theme-mode="${value}"
            aria-checked="${themeMode() === value}" class="${themeMode() === value ? 'on' : ''}">${icon(THEME_ICONS[value], 15)}${label}</button>`).join('')}
        </div>
      </section>
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

  root.addEventListener('change', (e) => {
    if (e.target.dataset.act !== 'active') return;
    const id = Number(e.target.closest('[data-project]').dataset.project);
    updateProject(id, { is_active: e.target.checked });
  });

  root.addEventListener('click', (e) => {
    const mode = e.target.closest('[data-theme-mode]')?.dataset.themeMode;
    if (mode) return setTheme(mode);
    const row = e.target.closest('[data-project]');
    if (!row) return;
    const p = projectById(Number(row.dataset.project));
    const swatch = e.target.closest('.swatch');
    if (swatch) return updateProject(p.id, { color: swatch.dataset.color });
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
