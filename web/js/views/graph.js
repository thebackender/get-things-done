// Graph tab: the same tasks as the list (Sprint / All, Hide done), drawn as cards with their links.
// Links go left to right: parent → subtask (gray line), blocker → blocked task (orange dashed arrow).
// Layered layout: each group of linked tasks is laid out in columns by depth, groups are packed into rows.
import { store, taskById, activeSprint } from '../store.js';
import { openTaskEditor } from '../editor.js';
import { projectChip, metaBadges } from '../components.js';
import { esc, prioIcon, prioClass, prioName, empty, freshBox } from '../util.js';
import { icon } from '../icons.js';
import { getPrefs, setPrefs } from '../prefs.js';
import { listFilter, listView, setListView, isCollapsed, toggleCollapsed } from './list.js';

const W = 250; // card size
const H = 58;
const GAP_X = 64; // between columns: room for the links
const GAP_Y = 12; // between cards in a column
// Between groups: clearly wider than between columns (GAP_X), so separate groups don't read as one.
const GROUP_GAP_X = 120;
const GROUP_GAP_Y = 48;
const PAD = 24;

const opts = getPrefs('graph', { onlyLinked: true, hideSubtasks: false });
let camera = null; // {x, y, k}: pan and zoom, kept across re-renders
let q = ''; // search; not saved
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

function edgePath(a, b) {
  const x1 = a.x + W, y1 = a.y + H / 2;
  const x2 = b.x, y2 = b.y + H / 2;
  const c = Math.max(30, Math.abs(x2 - x1) / 2);
  return `M${x1} ${y1}C${x1 + c} ${y1} ${x2 - c} ${y2} ${x2 - 2} ${y2}`;
}

/** XMind-style branch button where a parent's links start: "−" folds its subtasks, the count unfolds them. */
function foldHTML(id, p, folded, count) {
  return `<g class="fold${folded ? ' folded' : ''}" data-fold="${id}" transform="translate(${p.x + W},${p.y + H / 2})">
    <title>${folded ? `Show ${count} subtask${count === 1 ? '' : 's'}` : 'Hide subtasks'}</title>
    <circle r="${folded ? 10 : 8}"/>${folded ? `<text>${count}</text>` : '<path d="M-3.5 0H3.5"/>'}
  </g>`;
}

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

export function render(view) {
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
  const nodes = opts.onlyLinked ? tasks.filter((t) => linked.has(t.id)) : tasks;
  const kidCount = (id) => all.filter((t) => t.parent_id === id).length;

  root.innerHTML = `
    <div class="toolbar list-toolbar graph-toolbar">
      <input type="search" class="q" placeholder="Search… (Enter jumps to it)" value="${esc(q)}">
      ${activeSprint() ? `<div class="segmented" role="radiogroup" aria-label="Show">
        ${[['sprint', 'Sprint'], ['all', 'All']].map(([v, l]) => `<button type="button" role="radio" aria-checked="${scope === v}" class="${scope === v ? 'on' : ''}" data-scope="${v}">${l}</button>`).join('')}
      </div>` : ''}
      <details class="view-menu">
        <summary title="Which tasks to show">${icon('sliders', 15)} View</summary>
        <div class="menu">
          <label class="check"><input type="checkbox" data-opt="hideDone" ${hideDone ? 'checked' : ''}> Hide done</label>
          <label class="check"><input type="checkbox" data-opt="onlyLinked" ${opts.onlyLinked ? 'checked' : ''}> Linked tasks only</label>
          <label class="check"><input type="checkbox" data-opt="hideSubtasks" ${opts.hideSubtasks ? 'checked' : ''}> Hide subtasks</label>
        </div>
      </details>
      <span class="spacer"></span>
      <span class="legend">
        <span><svg width="26" height="10"><path d="M2 5H24" class="edge child"/></svg> subtask</span>
        <span><svg width="26" height="10"><path d="M2 5H18" class="edge dep" marker-end="url(#arrow)"/></svg> blocks</span>
      </span>
      <button data-act="fit" title="Show the whole graph">Fit</button>
    </div>
    <div class="graph-wrap">
      <svg class="graph">
        <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
        <g class="viewport"><g class="edges"></g><g class="nodes"></g><g class="folds"></g></g>
      </svg>
      ${nodes.length ? '<div class="graph-hint">Drag or scroll to move · Ctrl + scroll to zoom · click a task to edit</div>'
        : empty(opts.onlyLinked ? 'No links between these tasks. Set a parent or "Blocked by" in the task editor, or turn off "Linked tasks only" under View.' : 'No tasks.')}
    </div>`;

  const svg = root.querySelector('svg.graph');
  const viewport = root.querySelector('.viewport');
  const maxWidth = Math.max(W + 2 * PAD, svg.clientWidth || 1200);
  // A card's weight: itself plus every subtask folded under it.
  const weight = (id) => 1 + all.filter((t) => t.parent_id === id && hidden(t)).reduce((n, t) => n + weight(t.id), 0);
  const { pos, width, height } = layout(nodes, edges, maxWidth, weight);

  root.querySelector('.edges').innerHTML = edges.filter((e) => pos.has(e.s) && pos.has(e.t)).map((e) =>
    `<path class="edge ${e.kind}" data-s="${e.s}" data-t="${e.t}" d="${edgePath(pos.get(e.s), pos.get(e.t))}"${e.kind === 'dep' ? ' marker-end="url(#arrow)"' : ''}/>`).join('');
  root.querySelector('.nodes').innerHTML = nodes.map((t) => nodeHTML(t, pos.get(t.id))).join('');
  // Fold buttons, unless "Hide subtasks" already hides them all (the card's 0/5 badge still shows they exist).
  if (!opts.hideSubtasks) {
    root.querySelector('.folds').innerHTML = nodes.filter((t) => hasKids.has(t.id))
      .map((t) => foldHTML(t.id, pos.get(t.id), isCollapsed(t.id), kidCount(t.id))).join('');
  }

  // ---------- camera ----------
  const apply = () => viewport.setAttribute('transform', `translate(${camera.x},${camera.y}) scale(${camera.k})`);
  const fit = () => {
    const k = Math.min(1, svg.clientWidth / width, svg.clientHeight / height);
    camera = { k, x: (svg.clientWidth - width * k) / 2, y: Math.max(0, (svg.clientHeight - height * k) / 2) };
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

  // ---------- hover: the card itself changes (CSS); its links get a little bolder ----------
  let hovered = null;
  const highlight = (id) => {
    if (id === hovered) return;
    hovered = id;
    root.querySelectorAll('.edges .hl').forEach((el) => el.classList.remove('hl'));
    if (id == null) return;
    root.querySelectorAll(`.edges [data-s="${id}"], .edges [data-t="${id}"]`).forEach((el) => el.classList.add('hl'));
  };
  svg.addEventListener('pointerover', (e) => {
    if (drag?.moved) return;
    const node = e.target.closest?.('[data-node]');
    highlight(node ? Number(node.dataset.node) : null);
  });
  svg.addEventListener('pointerleave', () => highlight(null));

  // ---------- pan, zoom, click ----------
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const node = e.target.closest('[data-node]');
    const fold = e.target.closest('[data-fold]');
    drag = { id: node ? Number(node.dataset.node) : null, fold: fold ? Number(fold.dataset.fold) : null, sx: e.clientX, sy: e.clientY, cx: camera.x, cy: camera.y, moved: false };
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const mx = e.clientX - drag.sx, my = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(mx, my) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      svg.setPointerCapture(e.pointerId);
      svg.classList.add('panning');
    }
    camera.x = drag.cx + mx;
    camera.y = drag.cy + my;
    apply();
  });
  const endDrag = () => {
    const click = drag && !drag.moved ? drag : null;
    svg.classList.remove('panning');
    drag = null;
    if (click?.fold != null) {
      const p = pos.get(click.fold);
      anchor = { id: click.fold, x: camera.x + p.x * camera.k, y: camera.y + p.y * camera.k };
      toggleCollapsed(click.fold);
      return render(view);
    }
    if (click?.id != null) openTaskEditor(taskById(click.id));
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', () => { drag = null; svg.classList.remove('panning'); });
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
  toolbar.addEventListener('click', (e) => {
    const scopeBtn = e.target.closest('[data-scope]');
    if (scopeBtn && scopeBtn.dataset.scope !== scope) {
      setListView({ scope: scopeBtn.dataset.scope });
      return render(view);
    }
    if (e.target.closest('[data-act="fit"]')) fit();
  });
  toolbar.addEventListener('change', (e) => {
    const key = e.target.dataset.opt;
    if (key === 'hideDone') setListView({ hideDone: e.target.checked });
    else if (key === 'onlyLinked' || key === 'hideSubtasks') {
      opts[key] = e.target.checked;
      setPrefs('graph', { onlyLinked: opts.onlyLinked, hideSubtasks: opts.hideSubtasks });
    } else return;
    render(view);
  });
  markMatches();
}
