// Graph tab: tasks as nodes, with "subtask" and "depends on" links.
// Hand-written force layout (Fruchterman–Reingold) in SVG, no libraries.
import { store, taskById, projectById, projectList, projectColor } from '../store.js';
import { openTaskEditor } from '../editor.js';
import { esc, trunc, empty, freshBox, paint, OTHER_COLOR } from '../util.js';
import { getPrefs, setPrefs } from '../prefs.js';

const K = 120; // preferred distance between linked nodes
const pos = new Map(); // id -> {x, y}; kept across re-renders so the graph doesn't jump
const opts = getPrefs('graph', { showDone: false, onlyLinked: true });
let camera = null; // {x, y, k}: pan and zoom

const radius = (t) => 7 + Math.max(0, t.priority) * 3;

function simulate(nodes, edges, iterations, startTemp) {
  const n = nodes.length;
  const P = nodes.map((t) => pos.get(t.id));
  const index = new Map(nodes.map((t, i) => [t.id, i]));
  const E = edges.map((e) => [index.get(e.s), index.get(e.t)]);
  for (let it = 0; it < iterations; it++) {
    const temp = startTemp * (1 - it / iterations) + 0.5;
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);
    // Every node repels every other node.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let x = P[i].x - P[j].x;
        let y = P[i].y - P[j].y;
        let d = Math.hypot(x, y);
        if (d < 0.01) { x = Math.random() - 0.5; y = Math.random() - 0.5; d = Math.hypot(x, y); }
        if (d > K * 3) continue; // far nodes don't repel, so unrelated groups stay close together
        const f = (K * K) / d;
        dx[i] += (x / d) * f; dy[i] += (y / d) * f;
        dx[j] -= (x / d) * f; dy[j] -= (y / d) * f;
      }
    }
    // Edges pull linked nodes together.
    for (const [a, b] of E) {
      const x = P[a].x - P[b].x;
      const y = P[a].y - P[b].y;
      const d = Math.hypot(x, y) || 0.01;
      const f = (d * d) / K;
      dx[a] -= (x / d) * f; dy[a] -= (y / d) * f;
      dx[b] += (x / d) * f; dy[b] += (y / d) * f;
    }
    // Light gravity toward the center keeps groups from drifting apart; each step is capped by the temperature.
    for (let i = 0; i < n; i++) {
      dx[i] -= P[i].x * 0.08;
      dy[i] -= P[i].y * 0.08;
      const len = Math.hypot(dx[i], dy[i]);
      if (len > 0) {
        const s = Math.min(len, temp) / len;
        P[i].x += dx[i] * s;
        P[i].y += dy[i] * s;
      }
    }
  }
}

export function render(view) {
  const root = freshBox(view);
  const tasks = store.tasks.filter((t) => opts.showDone || t.status !== 'done');
  const ids = new Set(tasks.map((t) => t.id));
  const edges = [];
  for (const t of tasks) {
    if (t.parent_id != null && ids.has(t.parent_id)) edges.push({ s: t.parent_id, t: t.id, kind: 'child' });
    for (const d of t.depends_on) if (ids.has(d)) edges.push({ s: d, t: t.id, kind: 'dep' });
  }
  const linked = new Set(edges.flatMap((e) => [e.s, e.t]));
  const nodes = opts.onlyLinked ? tasks.filter((t) => linked.has(t.id)) : tasks;

  // Legend: top-level projects that appear in the graph (subprojects share their parent's color).
  const rootId = (id) => { const p = projectById(id); return p ? p.parent_id ?? p.id : null; };
  const usedRoots = projectList().filter((p) => p.parent_id == null && nodes.some((t) => rootId(t.project_id) === p.id));
  const hasNoProject = nodes.some((t) => !projectById(t.project_id));

  root.innerHTML = `
    <div class="toolbar">
      <label class="check"><input type="checkbox" data-opt="showDone" ${opts.showDone ? 'checked' : ''}> show done</label>
      <label class="check"><input type="checkbox" data-opt="onlyLinked" ${opts.onlyLinked ? 'checked' : ''}> linked only</label>
      <button data-act="fit">Fit</button>
      <button data-act="relayout">Re-layout</button>
      <span class="spacer"></span>
      <span class="legend">
        <span><svg width="30" height="10"><line x1="2" y1="5" x2="28" y2="5" class="edge child"/></svg> subtask</span>
        <span><svg width="30" height="10"><line x1="2" y1="5" x2="22" y2="5" class="edge dep" marker-end="url(#arrow)"/></svg> A ⇢ B: A blocks B</span>
        <span><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="#9a9893" class="ring-waiting"/></svg> waiting</span>
      </span>
    </div>
    <div class="graph-wrap">
      <svg class="graph">
        <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
        <g class="viewport"><g class="edges"></g><g class="nodes"></g></g>
      </svg>
      ${nodes.length ? '' : empty('No links yet. Set a parent, "Blocked by" or "Blocking" in the task editor, or uncheck "linked only".')}
      ${usedRoots.length || hasNoProject ? `<div class="cat-legend">
        ${usedRoots.map((p) => `<span><i class="dot" style="--c:${paint(p.color)}"></i>${esc(p.name)}</span>`).join('')}
        ${hasNoProject ? `<span><i class="dot" style="--c:${OTHER_COLOR}"></i>no project</span>` : ''}
      </div>` : ''}
    </div>`;

  const svg = root.querySelector('svg.graph');
  const viewport = root.querySelector('.viewport');
  const edgesLayer = root.querySelector('.edges');
  const nodesLayer = root.querySelector('.nodes');

  // Place new nodes near their parent or dependency, then run the layout.
  const fresh = nodes.filter((t) => !pos.has(t.id));
  for (const t of fresh) {
    const anchor = pos.get(t.parent_id) ?? pos.get(t.depends_on.find((d) => pos.has(d)));
    const a = Math.random() * Math.PI * 2;
    const r = anchor ? K * 0.6 : 150 + Math.random() * 250;
    pos.set(t.id, { x: (anchor?.x ?? 0) + Math.cos(a) * r, y: (anchor?.y ?? 0) + Math.sin(a) * r });
  }
  const fullLayout = fresh.length === nodes.length;
  if (fresh.length) simulate(nodes, edges, fullLayout ? 400 : 120, fullLayout ? 80 : 15);

  const applyCamera = () => viewport.setAttribute('transform', `translate(${camera.x},${camera.y}) scale(${camera.k})`);

  function fit() {
    if (!nodes.length) {
      camera = { x: 0, y: 0, k: 1 };
      return applyCamera();
    }
    const xs = nodes.map((t) => pos.get(t.id).x);
    const ys = nodes.map((t) => pos.get(t.id).y);
    const minX = Math.min(...xs) - 100, maxX = Math.max(...xs) + 100;
    const minY = Math.min(...ys) - 40, maxY = Math.max(...ys) + 50;
    const W = svg.clientWidth || 800, H = svg.clientHeight || 600;
    const k = Math.min(1.6, W / (maxX - minX), H / (maxY - minY));
    camera = { k, x: W / 2 - ((minX + maxX) / 2) * k, y: H / 2 - ((minY + maxY) / 2) * k };
    applyCamera();
  }

  function drawEdges() {
    edgesLayer.innerHTML = edges.map((e) => {
      const a = pos.get(e.s), b = pos.get(e.t);
      if (!a || !b) return '';
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      const ra = radius(taskById(e.s)) + 1;
      const rb = radius(taskById(e.t)) + (e.kind === 'dep' ? 4 : 1);
      return `<line class="edge ${e.kind}" x1="${a.x + (dx / d) * ra}" y1="${a.y + (dy / d) * ra}" x2="${b.x - (dx / d) * rb}" y2="${b.y - (dy / d) * rb}" ${e.kind === 'dep' ? 'marker-end="url(#arrow)"' : ''}/>`;
    }).join('');
  }

  nodesLayer.innerHTML = nodes.map((t) => {
    const p = pos.get(t.id);
    const r = radius(t);
    return `<g class="node st-${t.status}${t.priority >= 3 ? ' prio-critical' : ''}" data-id="${t.id}" transform="translate(${p.x},${p.y})">
      <circle r="${r + 8}" class="hit"/>
      <circle r="${r}" fill="${projectColor(t.project_id)}" class="${t.status === 'waiting' ? 'ring-waiting' : ''}"/>
      <text y="${r + 14}">${esc(trunc(t.title, 30))}</text>
      <title>${esc(t.title)}</title>
    </g>`;
  }).join('');
  drawEdges();
  if (!camera || fullLayout) fit();
  else applyCamera();

  // ---------- interaction ----------
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    const node = e.target.closest('.node');
    drag = { id: node ? Number(node.dataset.id) : null, el: node, sx: e.clientX, sy: e.clientY, cx: camera.x, cy: camera.y, moved: false };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const mx = e.clientX - drag.sx, my = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(mx, my) < 4) return;
    drag.moved = true;
    if (drag.id != null) {
      const rect = svg.getBoundingClientRect();
      const p = pos.get(drag.id);
      p.x = (e.clientX - rect.left - camera.x) / camera.k;
      p.y = (e.clientY - rect.top - camera.y) / camera.k;
      drag.el.setAttribute('transform', `translate(${p.x},${p.y})`);
      drawEdges();
    } else {
      camera.x = drag.cx + mx;
      camera.y = drag.cy + my;
      applyCamera();
    }
  });
  svg.addEventListener('pointerup', () => {
    if (drag && !drag.moved && drag.id != null) openTaskEditor(taskById(drag.id));
    drag = null;
  });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const k = Math.min(4, Math.max(0.15, camera.k * Math.exp(-e.deltaY * 0.0015)));
    camera.x = mx - ((mx - camera.x) * k) / camera.k;
    camera.y = my - ((my - camera.y) * k) / camera.k;
    camera.k = k;
    applyCamera();
  }, { passive: false });

  root.querySelector('.toolbar').addEventListener('change', (e) => {
    const key = e.target.dataset.opt;
    if (!key) return;
    opts[key] = e.target.checked;
    setPrefs('graph', { showDone: opts.showDone, onlyLinked: opts.onlyLinked });
    render(view);
  });
  root.querySelector('.toolbar').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'fit') fit();
    if (act === 'relayout') {
      pos.clear();
      camera = null;
      render(view);
    }
  });
}
