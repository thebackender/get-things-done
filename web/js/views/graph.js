// Graph tab: the same tasks as the list (Sprint / All, Hide done), drawn as cards with their links.
// Links go left to right: parent → subtask (gray line), blocker → blocked task (orange dashed arrow).
// Layered layout: each group of linked tasks is laid out in columns by depth, groups are packed into rows.
import { store, taskById, activeSprint, updateTask } from '../store.js';
import { openTaskEditor } from '../editor.js';
import { projectChip, metaBadges, openContextMenu, taskMenuItems } from '../components.js';
import { esc, prioIcon, prioClass, prioName, empty, freshBox, trunc, toast } from '../util.js';
import { icon } from '../icons.js';
import { getPrefs, setPrefs } from '../prefs.js';
import { listFilter, listView, setListView, isCollapsed, toggleCollapsed, filterMenus, handleFilterEvent, newTaskPreset as listPreset } from './list.js';

const W = 250; // card size
const H = 58;
const GAP_X = 64; // between columns: room for the links
const GAP_Y = 12; // between cards in a column
// Between groups: clearly wider than between columns (GAP_X), so separate groups don't read as one.
const GROUP_GAP_X = 120;
const GROUP_GAP_Y = 48;
const PAD = 24;

const opts = getPrefs('graph', { onlyLinked: true, hideSubtasks: false, positions: {} });
// Cards moved by hand: { taskId: {x, y} } in canvas coordinates. Saved in data/settings.json; other cards are laid out automatically.
if (!opts.positions || typeof opts.positions !== 'object') opts.positions = {};
const saveOpts = () => {
  for (const id of Object.keys(opts.positions)) if (!taskById(Number(id))) delete opts.positions[id]; // deleted tasks
  setPrefs('graph', { onlyLinked: opts.onlyLinked, hideSubtasks: opts.hideSubtasks, positions: opts.positions });
};
const SNAP = 4; // moved cards snap to a small grid so they line up easily
const MARGIN = 10; // the smallest gap between two cards: cards never overlap

const overlaps = (a, b) => a.x < b.x + W + MARGIN && b.x < a.x + W + MARGIN && a.y < b.y + H + MARGIN && b.y < a.y + H + MARGIN;

/** The free spot nearest to p (top-left corner of a card), given the cards already there. */
function freeSpot(p, others) {
  const free = (q) => others.every((o) => !overlaps(q, o));
  if (free(p)) return p;
  const step = 2 * SNAP;
  // Look on growing square rings around p; within a ring take the closest free spot.
  for (let r = step; r <= 4000; r += step) {
    let best = null, bestD = Infinity;
    for (let i = -r; i <= r; i += step) {
      for (const q of [{ x: p.x + i, y: p.y - r }, { x: p.x + i, y: p.y + r }, { x: p.x - r, y: p.y + i }, { x: p.x + r, y: p.y + i }]) {
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD && free(q)) { best = q; bestD = d; }
      }
    }
    if (best) return best;
  }
  return p;
}
let camera = null; // {x, y, k}: pan and zoom, kept across re-renders
let q = ''; // search; not saved
// Tasks that appeared while the graph was open (e.g. just created with N) show even without links, so they can be linked.
let seen = null;
const fresh = new Set();
let fitCurrent = null; // Fit for the graph on screen (Esc)

export const newTaskPreset = () => listPreset();
export const onEscape = () => fitCurrent?.();
// After folding/unfolding, keep the clicked card at the same spot on screen: {id, x, y} in screen pixels.
let anchor = null;

const matches = (t) => !!q && t.title.toLowerCase().includes(q.toLowerCase());

// ---------- layout ----------

/**
 * Positions {id → {x, y}} and the total size, for nodes and edges {s, t}. maxWidth wraps groups into rows.
 * weight(id) is how many tasks a card stands for (itself plus folded subtasks), so folding doesn't reorder groups.
 */
function layout(nodes, edges, maxWidth, weight) {
  const out = new Map(nodes.map((t) => [t.id, []]));
  const inc = new Map(nodes.map((t) => [t.id, []]));
  for (const e of edges) {
    out.get(e.s).push(e.t);
    inc.get(e.t).push(e.s);
  }

  // Connected groups (links in either direction).
  const group = new Map();
  const groups = [];
  for (const t of nodes) {
    if (group.has(t.id)) continue;
    const ids = [];
    const stack = [t.id];
    group.set(t.id, groups.length);
    while (stack.length) {
      const id = stack.pop();
      ids.push(id);
      for (const n of [...out.get(id), ...inc.get(id)]) {
        if (!group.has(n)) { group.set(n, groups.length); stack.push(n); }
      }
    }
    groups.push(ids);
  }

  // Column = longest chain of links leading to the task. A parent/blocker loop is cut where it is found.
  const col = new Map();
  const visiting = new Set();
  const depth = (id) => {
    if (col.has(id)) return col.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const d = inc.get(id).length ? 1 + Math.max(...inc.get(id).map(depth)) : 0;
    visiting.delete(id);
    col.set(id, d);
    return d;
  };
  nodes.forEach((t) => depth(t.id));

  const prio = (id) => taskById(id).priority;
  const blocks = groups.map((ids) => {
    const cols = [];
    for (const id of ids) (cols[col.get(id)] ??= []).push(id);
    for (let c = 0; c < cols.length; c++) cols[c] ??= [];
    // Order: first column by priority; then each task next to the tasks linking to it (barycenter), twice over.
    cols[0].sort((a, b) => prio(b) - prio(a) || a - b);
    const rank = new Map();
    const setRanks = (c) => c.forEach((id, i) => rank.set(id, i));
    setRanks(cols[0]);
    for (let pass = 0; pass < 2; pass++) {
      for (let c = 1; c < cols.length; c++) {
        const key = (id) => {
          const from = inc.get(id).filter((p) => rank.has(p) && col.get(p) < c);
          return from.length ? from.reduce((s, p) => s + rank.get(p), 0) / from.length : Infinity;
        };
        cols[c].sort((a, b) => key(a) - key(b) || prio(b) - prio(a) || a - b);
        setRanks(cols[c]);
      }
    }
    const tallest = Math.max(...cols.map((c) => c.length));
    const height = tallest * (H + GAP_Y) - GAP_Y;
    const width = cols.length * (W + GAP_X) - GAP_X;
    // Each column is centered against the tallest, so a parent sits in the middle of its subtasks.
    const place = (dx, dy, pos) => cols.forEach((c, ci) => {
      const top = dy + ((tallest - c.length) * (H + GAP_Y)) / 2;
      c.forEach((id, i) => pos.set(id, { x: dx + ci * (W + GAP_X), y: top + i * (H + GAP_Y) }));
    });
    return { width, height, place, size: ids.reduce((n, id) => n + weight(id), 0), first: Math.min(...ids) };
  });

  // Pack groups into rows: biggest first, wrapping at maxWidth.
  blocks.sort((a, b) => b.size - a.size || a.first - b.first);
  const pos = new Map();
  let x = PAD, y = PAD, rowH = 0, totalW = 0;
  for (const b of blocks) {
    if (x > PAD && x + b.width + PAD > maxWidth) {
      x = PAD;
      y += rowH + GROUP_GAP_Y;
      rowH = 0;
    }
    b.place(x, y, pos);
    totalW = Math.max(totalW, x + b.width + PAD);
    x += b.width + GROUP_GAP_X;
    rowH = Math.max(rowH, b.height);
  }
  return { pos, width: totalW, height: y + rowH + PAD };
}

// ---------- drawing ----------

/** A curved link from card a to card b, leaving and entering on the sides that face each other. */
function edgePath(a, b) {
  if (b.x >= a.x + W - 1) return curve(a.x + W, a.y + H / 2, b.x, b.y + H / 2, 'x', 1); // b is to the right
  if (b.x + W <= a.x + 1) return curve(a.x, a.y + H / 2, b.x + W, b.y + H / 2, 'x', -1); // b is to the left
  return b.y >= a.y // one above the other
    ? curve(a.x + W / 2, a.y + H, b.x + W / 2, b.y, 'y', 1)
    : curve(a.x + W / 2, a.y, b.x + W / 2, b.y + H, 'y', -1);
}
/** Cubic curve from (x1, y1) to (x2, y2) leaving along the axis in direction dir; stops 2px short for the arrowhead. */
function curve(x1, y1, x2, y2, axis, dir) {
  const c = Math.max(axis === 'x' ? 30 : 20, Math.abs(axis === 'x' ? x2 - x1 : y2 - y1) / 2) * dir;
  return axis === 'x'
    ? `M${x1} ${y1}C${x1 + c} ${y1} ${x2 - c} ${y2} ${x2 - 2 * dir} ${y2}`
    : `M${x1} ${y1}C${x1} ${y1 + c} ${x2} ${y2 - c} ${x2} ${y2 - 2 * dir}`;
}
/** While drawing a blocker: from card a to the pointer. */
function pointerPath(a, pt) {
  const right = pt.x >= a.x + W / 2;
  return curve(right ? a.x + W : a.x, a.y + H / 2, pt.x, pt.y, 'x', right ? 1 : -1);
}

/** XMind-style branch button where a parent's links start: "−" folds its subtasks, the count unfolds them. */
function foldHTML(id, p, folded, count, left) {
  return `<g class="fold${folded ? ' folded' : ''}" data-fold="${id}" transform="${foldAt(p, left)}">
    <title>${folded ? `Show ${count} subtask${count === 1 ? '' : 's'}` : 'Hide subtasks'}</title>
    <circle r="${folded ? 10 : 8}"/>${folded ? `<text>${count}</text>` : '<path d="M-3.5 0H3.5"/>'}
  </g>`;
}

/** The fold button sits on the side the subtask links leave from. */
const foldAt = (p, left) => `translate(${left ? p.x : p.x + W},${p.y + H / 2})`;

/** Shown on hover at the card's bottom edge: drag it onto another card to make this task block that one. */
function handleHTML(id, p) {
  return `<g class="link-handle" data-link="${id}" transform="translate(${p.x + W - 24},${p.y + H})">
    <title>Drag onto a task: this task blocks it</title>
    <circle r="8"/><path d="M-3.5 0H3.5M1 -2.5L3.5 0L1 2.5"/>
  </g>`;
}

const HELP = [
  'Click a card to edit it; right-click it for more actions.',
  'Hover a card and drag the orange → handle onto another card: the first task then blocks the second.',
  'Click a link to remove it.',
  '− on a card folds its subtasks.',
  'N creates a task (it shows here right away, ready to link); Esc fits the whole graph.',
  'Drag a card to move it (Reset card positions under View puts them back); drag the background or scroll to move the view; Ctrl + scroll to zoom.',
].join('\n');

const short = (t) => `"${trunc(t.title, 32)}"`;

function nodeHTML(t, p) {
  const cls = [`st-${t.status}`, `prio-${prioClass(t.priority)}`, matches(t) && 'match'].filter(Boolean).join(' ');
  return `<foreignObject x="${p.x}" y="${p.y}" width="${W}" height="${H}" data-node="${t.id}">
    <div xmlns="http://www.w3.org/1999/xhtml" class="gnode ${cls}" title="${esc(t.title)} · ${prioName(t.priority)}">
      <div class="gnode-top">${prioIcon(t.priority)}<span class="title">${esc(t.title)}</span></div>
      <div class="gnode-meta">${t.status === 'doing' ? '<span class="badge doing">in progress</span>' : ''}${metaBadges(t)}${projectChip(t.project_id)}</div>
    </div>
  </foreignObject>`;
}

// ---------- tab ----------

/** openMenu: a filter menu to keep open across the re-render. */
export function render(view, openMenu = null) {
  const root = freshBox(view);
  const { scope, hideDone } = listView();
  const all = store.tasks.filter(listFilter);
  const allIds = new Set(all.map((t) => t.id));
  // Subtasks are hidden everywhere with "Hide subtasks", or under a task folded with its ▾ button (shared with the list).
  const hasKids = new Set(all.filter((t) => t.parent_id != null && allIds.has(t.parent_id)).map((t) => t.parent_id));
  const folded = (id) => opts.hideSubtasks || isCollapsed(id);
  const hidden = (t) => {
    for (let p = taskById(t.parent_id); p && allIds.has(p.id); p = taskById(p.parent_id)) if (folded(p.id)) return true;
    return false;
  };
  const tasks = all.filter((t) => !hidden(t));
  const ids = new Set(tasks.map((t) => t.id));
  const edges = [];
  for (const t of tasks) {
    if (t.parent_id != null && ids.has(t.parent_id)) edges.push({ s: t.parent_id, t: t.id, kind: 'child' });
    for (const d of t.depends_on) if (ids.has(d)) edges.push({ s: d, t: t.id, kind: 'dep' });
  }
  // A task with subtasks counts as linked even while they're hidden.
  const linked = new Set([...edges.flatMap((e) => [e.s, e.t]), ...hasKids]);
  const appeared = seen ? store.tasks.filter((t) => !seen.has(t.id)).map((t) => t.id) : [];
  appeared.forEach((id) => fresh.add(id));
  seen = new Set(store.tasks.map((t) => t.id));
  const nodes = opts.onlyLinked ? tasks.filter((t) => linked.has(t.id) || fresh.has(t.id)) : tasks;
  const kidCount = (id) => all.filter((t) => t.parent_id === id).length;

  root.innerHTML = `
    <div class="toolbar list-toolbar graph-toolbar">
      <input type="search" class="q" placeholder="Search… (Enter jumps to it)" value="${esc(q)}">
      ${activeSprint() ? `<div class="segmented" role="radiogroup" aria-label="Show">
        ${[['sprint', 'Sprint'], ['all', 'All']].map(([v, l]) => `<button type="button" role="radio" aria-checked="${scope === v}" class="${scope === v ? 'on' : ''}" data-scope="${v}">${l}</button>`).join('')}
      </div>` : ''}
      ${filterMenus(openMenu)}
      <details class="view-menu">
        <summary title="Which tasks to show">${icon('sliders', 15)} View</summary>
        <div class="menu">
          <label class="check"><input type="checkbox" data-opt="hideDone" ${hideDone ? 'checked' : ''}> Hide done</label>
          <label class="check"><input type="checkbox" data-opt="onlyLinked" ${opts.onlyLinked ? 'checked' : ''}> Linked tasks only</label>
          <label class="check"><input type="checkbox" data-opt="hideSubtasks" ${opts.hideSubtasks ? 'checked' : ''}> Hide subtasks</label>
          ${Object.keys(opts.positions).length ? '<button type="button" class="ghost reset-layout" data-act="reset-layout">Reset card positions</button>' : ''}
        </div>
      </details>
      <span class="spacer"></span>
      <span class="legend">
        <span><svg width="26" height="10"><path d="M2 5H24" class="edge child"/></svg> subtask</span>
        <span><svg width="26" height="10"><path d="M2 5H18" class="edge dep" marker-end="url(#arrow)"/></svg> blocks</span>
      </span>
      <span class="help" tabindex="0" title="${esc(HELP)}">?</span>
      <button data-act="fit" title="Show the whole graph">Fit</button>
    </div>
    <div class="graph-wrap">
      <svg class="graph">
        <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
        <g class="viewport"><rect class="drop-ghost" width="${W}" height="${H}" rx="6" visibility="hidden"/><g class="edges"></g><g class="nodes"></g><g class="folds"></g><g class="handles"></g></g>
      </svg>
      ${nodes.length ? '' : empty(opts.onlyLinked ? 'No links between these tasks. Set a parent or "Blocked by" in the task editor, or turn off "Linked tasks only" under View.' : 'No tasks.')}
    </div>`;

  const svg = root.querySelector('svg.graph');
  const viewport = root.querySelector('.viewport');
  const maxWidth = Math.max(W + 2 * PAD, svg.clientWidth || 1200);
  // A card's weight: itself plus every subtask folded under it.
  const weight = (id) => 1 + all.filter((t) => t.parent_id === id && hidden(t)).reduce((n, t) => n + weight(t.id), 0);
  const { pos } = layout(nodes, edges, maxWidth, weight);
  // Cards moved by hand keep their place; an automatically placed card that would land on one moves to the nearest free spot.
  {
    const placed = [];
    const put = (id, p) => { const q = freeSpot(p, placed); pos.set(id, q); placed.push(q); };
    for (const t of nodes) if (opts.positions[t.id]) put(t.id, { ...opts.positions[t.id] });
    for (const t of nodes) if (!opts.positions[t.id]) put(t.id, pos.get(t.id));
  }
  const bounds = () => {
    const ps = [...pos.values()];
    if (!ps.length) return { x: 0, y: 0, w: 1, h: 1 };
    const x = Math.min(...ps.map((p) => p.x)) - PAD, y = Math.min(...ps.map((p) => p.y)) - PAD;
    return { x, y, w: Math.max(...ps.map((p) => p.x + W)) + PAD - x, h: Math.max(...ps.map((p) => p.y + H)) + PAD - y };
  };

  const drawn = edges.filter((e) => pos.has(e.s) && pos.has(e.t));
  // Each link is drawn twice: the visible line, and a wide transparent one on top that is easy to click.
  root.querySelector('.edges').innerHTML =
    drawn.map((e) => `<path class="edge ${e.kind}" data-s="${e.s}" data-t="${e.t}" d="${edgePath(pos.get(e.s), pos.get(e.t))}"${e.kind === 'dep' ? ' marker-end="url(#arrow)"' : ''}/>`).join('') +
    drawn.map((e) => `<path class="edge-hit" data-kind="${e.kind}" data-s="${e.s}" data-t="${e.t}" d="${edgePath(pos.get(e.s), pos.get(e.t))}"/>`).join('');
  /** Are a parent's visible subtasks mostly to its left (it was moved to the right of them)? */
  const kidsOnLeft = (id) => {
    const kids = nodes.filter((t) => t.parent_id === id && pos.has(t.id));
    if (!kids.length) return false;
    const avg = kids.reduce((sum, t) => sum + pos.get(t.id).x, 0) / kids.length;
    return avg + W <= pos.get(id).x + 1;
  };
  root.querySelector('.handles').innerHTML = nodes.map((t) => handleHTML(t.id, pos.get(t.id))).join('');
  root.querySelector('.nodes').innerHTML = nodes.map((t) => nodeHTML(t, pos.get(t.id))).join('');
  // Fold buttons, unless "Hide subtasks" already hides them all (the card's 0/5 badge still shows they exist).
  if (!opts.hideSubtasks) {
    root.querySelector('.folds').innerHTML = nodes.filter((t) => hasKids.has(t.id))
      .map((t) => foldHTML(t.id, pos.get(t.id), isCollapsed(t.id), kidCount(t.id), kidsOnLeft(t.id))).join('');
  }

  // ---------- camera ----------
  const apply = () => viewport.setAttribute('transform', `translate(${camera.x},${camera.y}) scale(${camera.k})`);
  const fit = () => {
    const b = bounds();
    const k = Math.min(1, svg.clientWidth / b.w, svg.clientHeight / b.h);
    camera = { k, x: (svg.clientWidth - b.w * k) / 2 - b.x * k, y: Math.max(0, (svg.clientHeight - b.h * k) / 2) - b.y * k };
    apply();
  };
  const centerOn = (id) => {
    const p = pos.get(id);
    camera.x = svg.clientWidth / 2 - (p.x + W / 2) * camera.k;
    camera.y = svg.clientHeight / 2 - (p.y + H / 2) * camera.k;
    apply();
  };
  // Start at 100% so the cards are readable; the Fit button shows everything.
  if (!camera) camera = { k: 1, x: 0, y: 0 };
  if (anchor && pos.has(anchor.id)) {
    const p = pos.get(anchor.id);
    camera.x = anchor.x - p.x * camera.k;
    camera.y = anchor.y - p.y * camera.k;
  }
  anchor = null;
  apply();
  fitCurrent = fit;
  // Bring a task that was just created into view.
  const created = appeared.filter((id) => pos.has(id)).at(-1);
  if (created != null) centerOn(created);

  // ---------- hover: the card itself changes (CSS); its links get a little bolder; its link handle shows ----------
  let hovered = null;
  const highlight = (key) => {
    if (key === hovered) return;
    hovered = key;
    root.querySelectorAll('.edges .hl, .handles .show').forEach((el) => el.classList.remove('hl', 'show'));
    if (key == null) return;
    if (typeof key === 'string') { // a single link, "s-t"
      const [s, t] = key.split('-');
      root.querySelector(`.edges .edge[data-s="${s}"][data-t="${t}"]`)?.classList.add('hl');
      return;
    }
    root.querySelectorAll(`.edges .edge[data-s="${key}"], .edges .edge[data-t="${key}"]`).forEach((el) => el.classList.add('hl'));
    root.querySelector(`.link-handle[data-link="${key}"]`)?.classList.add('show');
  };
  svg.addEventListener('pointerover', (e) => {
    if (drag?.moved || drag?.link != null) return;
    const node = e.target.closest?.('[data-node], [data-link]');
    const hit = e.target.closest?.('.edge-hit');
    highlight(node ? Number(node.dataset.node ?? node.dataset.link) : hit ? `${hit.dataset.s}-${hit.dataset.t}` : null);
  });
  svg.addEventListener('pointerleave', () => !drag && highlight(null));

  // ---------- link actions ----------
  /** Keep this card where it is on screen through the re-render that follows a change. */
  const pin = (id) => {
    const p = pos.get(id);
    if (p) anchor = { id, x: camera.x + p.x * camera.k, y: camera.y + p.y * camera.k };
  };
  const addBlocker = async (from, to) => {
    const a = taskById(from), b = taskById(to);
    if (b.depends_on.includes(from)) return toast(`${short(a)} already blocks ${short(b)}`);
    pin(to);
    if (await updateTask(to, { depends_on: [...b.depends_on, from] })) toast(`${short(a)} blocks ${short(b)} now`);
  };
  const linkMenu = (x, y, kind, s, t) => {
    const a = taskById(s), b = taskById(t);
    openContextMenu(x, y, kind === 'dep'
      ? [{ label: `Remove: ${short(a)} blocks ${short(b)}`, icon: 'x', danger: true, action: () => { pin(t); updateTask(t, { depends_on: b.depends_on.filter((d) => d !== s) }); } }]
      : [{ label: `Detach ${short(b)} from ${short(a)}`, icon: 'x', danger: true, action: () => { pin(s); updateTask(t, { parent_id: null }); } }]);
  };
  svg.addEventListener('contextmenu', (e) => {
    const node = e.target.closest('[data-node]');
    const hit = e.target.closest('.edge-hit');
    if (!node && !hit) return;
    e.preventDefault();
    if (node) openContextMenu(e.clientX, e.clientY, taskMenuItems(taskById(Number(node.dataset.node))));
    else linkMenu(e.clientX, e.clientY, hit.dataset.kind, Number(hit.dataset.s), Number(hit.dataset.t));
  });

  // ---------- pan, zoom, click ----------
  let drag = null;
  /** Put a card (and its links, fold button and link handle) at a new spot without re-rendering. */
  const moveCard = (id, x, y) => {
    pos.set(id, { x, y });
    const fo = root.querySelector(`[data-node="${id}"]`);
    fo.setAttribute('x', x);
    fo.setAttribute('y', y);
    // This card's fold button, and its parent's (a subtask moving across can flip the parent's side).
    for (const f of [id, taskById(id)?.parent_id]) {
      if (f != null && pos.has(f)) root.querySelector(`.fold[data-fold="${f}"]`)?.setAttribute('transform', foldAt(pos.get(f), kidsOnLeft(f)));
    }
    root.querySelector(`.link-handle[data-link="${id}"]`)?.setAttribute('transform', `translate(${x + W - 24},${y + H})`);
    root.querySelectorAll(`.edges [data-s="${id}"], .edges [data-t="${id}"]`).forEach((el) => {
      el.setAttribute('d', edgePath(pos.get(Number(el.dataset.s)), pos.get(Number(el.dataset.t))));
    });
  };
  /** Keep getting pointer events while dragging outside the canvas (not available for every pointer). */
  const capture = (e) => {
    try { svg.setPointerCapture(e.pointerId); } catch { /* no active pointer: dragging still works inside the canvas */ }
  };
  const toCanvas = (e) => {
    const rect = svg.getBoundingClientRect();
    return { x: (e.clientX - rect.left - camera.x) / camera.k, y: (e.clientY - rect.top - camera.y) / camera.k };
  };
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const node = e.target.closest('[data-node]');
    const fold = e.target.closest('[data-fold]');
    const handle = e.target.closest('[data-link]');
    const hit = e.target.closest('.edge-hit');
    drag = {
      id: node ? Number(node.dataset.node) : null, fold: fold ? Number(fold.dataset.fold) : null,
      link: handle ? Number(handle.dataset.link) : null, hit,
      sx: e.clientX, sy: e.clientY, cx: camera.x, cy: camera.y, moved: false,
    };
    if (drag.id != null) drag.start = { ...pos.get(drag.id) }; // dragging a card moves it
    if (drag.link != null) {
      // Draw a blocker link: an orange arrow follows the pointer until it is dropped on a card.
      capture(e);
      svg.classList.add('linking');
      root.querySelector('.edges').insertAdjacentHTML('beforeend', '<path class="edge dep temp" marker-end="url(#arrow)"/>');
    }
  });
  const linkTarget = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node]');
    const id = el && Number(el.dataset.node);
    return id != null && id !== drag.link ? el : null;
  };
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.link != null) {
      const p = pos.get(drag.link);
      const target = linkTarget(e);
      root.querySelectorAll('.link-target').forEach((el) => el !== target && el.classList.remove('link-target'));
      target?.classList.add('link-target');
      root.querySelector('.temp').setAttribute('d', target ? edgePath(p, pos.get(Number(target.dataset.node))) : pointerPath(p, toCanvas(e)));
      return;
    }
    const mx = e.clientX - drag.sx, my = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(mx, my) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      capture(e);
      svg.classList.add('panning');
      if (drag.id != null) {
        const fo = root.querySelector(`[data-node="${drag.id}"]`);
        fo.classList.add('moving');
        fo.parentNode.append(fo); // on top of the other cards while it moves
      }
    }
    if (drag.id != null) {
      const snap = (v) => Math.round(v / SNAP) * SNAP;
      const p = { x: snap(drag.start.x + mx / camera.k), y: snap(drag.start.y + my / camera.k) };
      moveCard(drag.id, p.x, p.y);
      // Where it will land if dropped here: the nearest spot that doesn't overlap another card.
      drag.landing = freeSpot(p, [...pos].filter(([id]) => id !== drag.id).map(([, q]) => q));
      const ghost = root.querySelector('.drop-ghost');
      const show = drag.landing !== p;
      ghost.setAttribute('visibility', show ? 'visible' : 'hidden');
      if (show) { ghost.setAttribute('x', drag.landing.x); ghost.setAttribute('y', drag.landing.y); }
      return;
    }
    camera.x = drag.cx + mx;
    camera.y = drag.cy + my;
    apply();
  });
  const endDrag = (e) => {
    if (drag?.link != null) {
      const target = linkTarget(e);
      const from = drag.link;
      drag = null;
      svg.classList.remove('linking');
      root.querySelector('.temp')?.remove();
      root.querySelectorAll('.link-target').forEach((el) => el.classList.remove('link-target'));
      if (target) addBlocker(from, Number(target.dataset.node));
      return;
    }
    const click = drag && !drag.moved ? drag : null;
    if (drag?.moved && drag.id != null) {
      root.querySelector(`[data-node="${drag.id}"]`)?.classList.remove('moving');
      root.querySelector('.drop-ghost').setAttribute('visibility', 'hidden');
      if (drag.landing) moveCard(drag.id, drag.landing.x, drag.landing.y);
      opts.positions[drag.id] = pos.get(drag.id);
      saveOpts();
    }
    svg.classList.remove('panning');
    drag = null;
    if (click?.hit) return linkMenu(e.clientX, e.clientY, click.hit.dataset.kind, Number(click.hit.dataset.s), Number(click.hit.dataset.t));
    if (click?.fold != null) {
      const p = pos.get(click.fold);
      anchor = { id: click.fold, x: camera.x + p.x * camera.k, y: camera.y + p.y * camera.k };
      toggleCollapsed(click.fold);
      return render(view);
    }
    if (click?.id != null) openTaskEditor(taskById(click.id));
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', () => {
    if (drag?.moved && drag.id != null) moveCard(drag.id, drag.start.x, drag.start.y); // put it back
    root.querySelector('.moving')?.classList.remove('moving');
    root.querySelector('.drop-ghost')?.setAttribute('visibility', 'hidden');
    drag = null;
    svg.classList.remove('panning', 'linking');
    root.querySelector('.temp')?.remove();
  });
  // Scroll / two-finger swipe moves the canvas; Ctrl + scroll (and trackpad pinch) zooms.
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      // A mouse wheel notch (deltaY ~100) zooms ~1.35×; trackpad pinch sends small deltas and zooms smoothly.
      const d = Math.max(-50, Math.min(50, e.deltaY));
      const k = Math.min(2, Math.max(0.2, camera.k * Math.exp(-d * 0.006)));
      camera.x = mx - ((mx - camera.x) * k) / camera.k;
      camera.y = my - ((my - camera.y) * k) / camera.k;
      camera.k = k;
    } else {
      camera.x -= e.deltaX;
      camera.y -= e.deltaY;
    }
    apply();
  }, { passive: false });

  // ---------- toolbar ----------
  const toolbar = root.querySelector('.toolbar');
  const search = toolbar.querySelector('.q');
  const markMatches = () => {
    root.querySelectorAll('[data-node]').forEach((el) => {
      el.firstElementChild.classList.toggle('match', matches(taskById(Number(el.dataset.node))));
    });
    svg.classList.toggle('searching', !!q);
  };
  search.addEventListener('input', () => {
    q = search.value.trim();
    markMatches();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const hit = nodes.find(matches);
    if (hit) centerOn(hit.id);
  });
  const refilter = (e) => {
    const key = handleFilterEvent(e);
    if (!key) return false;
    render(view, e.type === 'change' ? key : null);
    return true;
  };
  toolbar.addEventListener('click', (e) => {
    if (refilter(e)) return;
    const scopeBtn = e.target.closest('[data-scope]');
    if (scopeBtn && scopeBtn.dataset.scope !== scope) {
      setListView({ scope: scopeBtn.dataset.scope });
      return render(view);
    }
    if (e.target.closest('[data-act="fit"]')) fit();
    if (e.target.closest('[data-act="reset-layout"]')) {
      opts.positions = {};
      saveOpts();
      render(view);
    }
  });
  toolbar.addEventListener('change', (e) => {
    if (refilter(e)) return;
    const key = e.target.dataset.opt;
    if (key === 'hideDone') setListView({ hideDone: e.target.checked });
    else if (key === 'onlyLinked' || key === 'hideSubtasks') {
      opts[key] = e.target.checked;
      saveOpts();
    } else return;
    render(view);
  });
  markMatches();
}
