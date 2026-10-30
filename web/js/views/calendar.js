// Calendar (right side of the Tasks tab). Both views start at the active sprint (at today when no sprint is active):
// - year view: 12 mini months from the month the sprint starts in;
// - month view: 5 weeks from the sprint's first week (more if the sprint is longer), with tasks on their due dates.
import { store, activeSprint, isOverdue, projectColor, projectLabel, byPriority, taskById, updateTask } from '../store.js';
import { openTaskEditor } from '../editor.js';
import { cardClicks, dragAndDrop } from '../components.js';
import { MONTHS, WEEKDAYS, esc, isoDate, parseDate, today, fmtDate, prioClass, prioIcon, freshBox } from '../util.js';
import { icon } from '../icons.js';
import { getPrefs, setPrefs } from '../prefs.js';

const MODES = { year: 'Year', month: 'Month' };
const saved = getPrefs('calendar', { mode: 'month' });
let mode = MODES[saved.mode] ? saved.mode : 'month';
// Which tasks to show: set by the Tasks tab to the list's Sprint / All filter. Done tasks always show (struck through).
let taskFilter = () => true;
export const setFilter = (fn) => { taskFilter = fn; };
const YEAR_MONTHS = 12; // fills the 4×3 grid
const MIN_WEEKS = 5;
const MAX_WEEKS = 12; // a very long sprint still fits a sensible grid
const MAX_CHIPS = 3; // tasks shown in a month-view cell; more → "+N more" opens the day's list
const YEAR_STEP = 12; // ‹ › in the year view, months
const WEEK_STEP = 4; // ‹ › in the month view, weeks: the last week stays on screen as the first one
const DAY = 864e5;
const mondayOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
const addDaysTo = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// How far ‹ › (or a click on a month) moved away from the sprint; 0 = at the sprint.
// Kept as offsets so the views follow when another sprint becomes active.
let monthShift = 0; // year view, in months
let weekShift = 0; // month view, in weeks

/** Where both views start: the active sprint's first day, or today. */
function anchorDate(sprint) {
  return sprint?.start ? parseDate(sprint.start) : new Date();
}
/** The month view's window: its first Monday and how many weeks it shows. */
function weekWindow(sprint) {
  const anchorMonday = mondayOf(anchorDate(sprint));
  const first = addDaysTo(anchorMonday, weekShift * 7);
  let weeks = MIN_WEEKS;
  if (weekShift === 0 && sprint?.end) {
    const span = Math.round((parseDate(sprint.end) - anchorMonday) / DAY) + 1;
    weeks = Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, Math.ceil(span / 7)));
  }
  return { first, weeks, anchorMonday };
}
const persist = () => setPrefs('calendar', { mode });

const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const inSprint = (sprint, iso) => !!(sprint?.start && sprint?.end && iso >= sprint.start && iso <= sprint.end);

function tasksByDate() {
  const map = new Map();
  for (const t of store.tasks) {
    if (!t.due || !taskFilter(t)) continue;
    if (!map.has(t.due)) map.set(t.due, []);
    map.get(t.due).push(t);
  }
  for (const list of map.values()) list.sort(byPriority);
  return map;
}

// ---------- year view ----------

/** Dot under a day number: red if something is overdue, priority color if urgent, faint if all done. */
function dotClass(items) {
  if (items.some(isOverdue)) return 'overdue';
  const open = items.filter((t) => t.status !== 'done');
  if (!open.length) return 'done';
  return open.some((t) => t.priority >= 2) ? 'urgent' : '';
}

function miniMonth(y, m, showYear, byDate, sprint, now) {
  const start = mondayOf(new Date(y, m, 1));
  let days = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (d.getMonth() !== m) {
      days += `<span class="mini-day other"><span class="n">${d.getDate()}</span></span>`; // neighbouring month: shown, not interactive
      continue;
    }
    const iso = isoDate(d);
    const items = byDate.get(iso) || [];
    const cls = [iso === now && 'today', iso < now && 'past', isWeekend(d) && 'weekend', inSprint(sprint, iso) && 'in-sprint', items.length && 'has-tasks']
      .filter(Boolean).join(' ');
    const tip = items.length
      ? `${items.length} task${items.length > 1 ? 's' : ''}: ${items.slice(0, 5).map((t) => t.title).join(', ')}${items.length > 5 ? ', …' : ''}`
      : 'Click to add a task due on this day';
    days += `<button type="button" class="mini-day ${cls}" data-date="${iso}" title="${esc(tip)}"><span class="n">${d.getDate()}</span>${
      items.length ? `<i class="mini-dot ${dotClass(items)}"></i>` : ''}</button>`;
  }
  return `<section class="mini-month">
    <button type="button" class="mini-title" data-ym="${y}-${m}" title="Open ${MONTHS[m]} ${y}">${MONTHS[m]}${showYear ? ` <span class="mini-year">${y}</span>` : ''}</button>
    <div class="mini-grid">${WEEKDAYS.map((w) => `<span class="mini-dow">${w[0]}</span>`).join('')}${days}</div>
  </section>`;
}

function yearView(firstMonth, byDate, sprint, now) {
  const months = Array.from({ length: YEAR_MONTHS }, (_, i) => new Date(firstMonth.getFullYear(), firstMonth.getMonth() + i, 1));
  // The year is shown on the first month and on every January.
  return `<div class="year-grid">${months.map((d, i) =>
    miniMonth(d.getFullYear(), d.getMonth(), i === 0 || d.getMonth() === 0, byDate, sprint, now)).join('')}</div>`;
}

// Popover with the tasks of one day, and "New task" for that day (month and year view).
function openDayPopover(root, dayEl, items) {
  closePopover();
  const iso = dayEl.dataset.date;
  const d = new Date(`${iso}T00:00`);
  const pop = document.createElement('div');
  pop.className = 'day-pop';
  pop.innerHTML = `
    <header><b>${WEEKDAYS[(d.getDay() + 6) % 7]}, ${fmtDate(iso)}</b><span class="muted">${items.length}</span></header>
    <ul>${items.length ? '' : '<li class="pop-none">No tasks</li>'}${items.map((t) => `<li><button type="button" class="pop-task st-${t.status}${isOverdue(t) ? ' overdue' : ''}" data-id="${t.id}">
      <i class="dot" style="--c:${projectColor(t.project_id)}"></i>${prioIcon(t.priority)}<span class="t">${esc(t.title)}</span></button></li>`).join('')}</ul>
    <button type="button" class="ghost add">${icon('plus', 14)} New task</button>`;
  // The tab's .view element is the anchor (root itself is display: contents and has no box).
  const anchor = root.parentElement;
  anchor.append(pop);
  dayEl.classList.add('open');
  pop.addEventListener('click', (e) => {
    const task = e.target.closest('.pop-task');
    const add = e.target.closest('.add');
    if (!task && !add) return;
    closePopover();
    if (task) openTaskEditor(taskById(Number(task.dataset.id)));
    else openTaskEditor(null, { due: iso });
  });
  // Below the day (above it if there's no room on screen), kept inside the view horizontally.
  const box = anchor.getBoundingClientRect();
  const r = dayEl.getBoundingClientRect();
  const left = Math.min(Math.max(0, r.left - box.left + r.width / 2 - pop.offsetWidth / 2), box.width - pop.offsetWidth);
  const below = r.bottom + 6 + pop.offsetHeight <= window.innerHeight;
  pop.style.left = `${left}px`;
  pop.style.top = `${(below ? r.bottom + 6 : r.top - 6 - pop.offsetHeight) - box.top}px`;
}
/** Returns true if a popover was open. */
function closePopover() {
  const pop = document.querySelector('.day-pop');
  pop?.remove();
  document.querySelector('.mini-day.open, .day.open')?.classList.remove('open');
  return !!pop;
}
document.addEventListener('keydown', (e) => e.key === 'Escape' && closePopover() && e.preventDefault());
// A click anywhere else closes it (days handle their own clicks: another day opens its list instead).
document.addEventListener('pointerdown', (e) => {
  const t = e.target;
  if (t.closest?.('.day-pop') || (t.closest?.('.day, .mini-day') && !t.closest('.cal-task'))) return;
  closePopover();
}, true);

// ---------- month view ----------

function chip(t) {
  const overdue = isOverdue(t);
  return `<div class="cal-task st-${t.status} prio-${prioClass(t.priority)}${overdue ? ' overdue' : ''}" draggable="true" data-id="${t.id}"
    style="--c:${projectColor(t.project_id)}" title="${esc(t.title)}${t.project_id ? ` · ${esc(projectLabel(t.project_id))}` : ''}${overdue ? ' (overdue)' : ''}">
    ${overdue ? icon('alert', 12, 'overdue-icon') : ''}${prioIcon(t.priority)}${esc(t.title)}</div>`;
}

function monthView({ first, weeks }, byDate, sprint, now) {
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDaysTo(first, i);
    const iso = isoDate(d);
    // Every other month gets a tinted background, so month boundaries are visible mid-week.
    const cls = [d.getMonth() % 2 && 'alt', iso < now && 'past', iso === now && 'today', inSprint(sprint, iso) && 'in-sprint', isWeekend(d) && 'weekend']
      .filter(Boolean).join(' ');
    // The month name goes on the first cell and on each 1st.
    const mon = i === 0 || d.getDate() === 1 ? `<span class="mon">${MONTHS[d.getMonth()]}</span>` : '';
    const items = byDate.get(iso) || [];
    const shown = items.length > MAX_CHIPS ? items.slice(0, MAX_CHIPS - 1) : items;
    const more = items.length - shown.length;
    cells += `<div class="day drop ${cls}" data-date="${iso}" title="Click to see this day's tasks or add one">
      <div class="day-num"><span class="n">${d.getDate()}</span>${mon}</div>${shown.map(chip).join('')}${
      more ? `<button type="button" class="more">+${more} more</button>` : ''}</div>`;
  }
  return `<div class="calendar" style="--weeks:${weeks}">${WEEKDAYS.map((w) => `<div class="dow">${w}</div>`).join('')}${cells}</div>`;
}

/** Hide the chips that don't fit in their cell (a long month name, a small window) behind "+N more". */
function fitChips(cal) {
  for (const day of cal.querySelectorAll('.day')) {
    // The content may use the cell's bottom padding (4px).
    const overflows = () => day.scrollHeight > day.clientHeight + 5;
    if (!overflows()) continue;
    const chips = [...day.querySelectorAll('.cal-task')];
    let more = day.querySelector('.more');
    let hidden = Number(more?.textContent.match(/\d+/)?.[0] ?? 0);
    while (overflows() && chips.length) {
      chips.pop().remove();
      hidden++;
      if (!more) {
        more = document.createElement('button');
        more.type = 'button';
        more.className = 'more';
        day.append(more);
      }
      more.textContent = `+${hidden} more`;
    }
  }
}

// The cells follow the window size: when the calendar changes width, it is redrawn to fit its chips again.
let resizeObs = null;
let resizeTimer;
function refitOnResize(cal, view) {
  const width = cal.offsetWidth;
  resizeObs = new ResizeObserver(() => {
    if (!cal.isConnected || cal.offsetWidth === width) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => cal.isConnected && render(view), 100);
  });
  resizeObs.observe(cal);
}

// ---------- tab ----------

export function render(view) {
  resizeObs?.disconnect();
  const root = freshBox(view);
  const sprint = activeSprint();
  const now = today();
  const byDate = tasksByDate();
  const unit = mode === 'year' ? `${YEAR_STEP} months` : `${WEEK_STEP} weeks`;
  const anchor = anchorDate(sprint);
  const firstMonth = new Date(anchor.getFullYear(), anchor.getMonth() + monthShift, 1);
  const win = weekWindow(sprint);
  let heading;
  if (mode === 'year') {
    const last = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + YEAR_MONTHS - 1, 1);
    heading = `${MONTHS[firstMonth.getMonth()]} ${firstMonth.getFullYear()} – ${MONTHS[last.getMonth()]} ${last.getFullYear()}`;
  } else {
    const last = addDaysTo(win.first, win.weeks * 7 - 1);
    const sameYear = last.getFullYear() === win.first.getFullYear();
    heading = `${win.first.getDate()} ${MONTHS[win.first.getMonth()]}${sameYear ? '' : ` ${win.first.getFullYear()}`} – ${last.getDate()} ${MONTHS[last.getMonth()]} ${last.getFullYear()}`;
  }
  const home = sprint?.start
    ? { title: `Back to the current sprint: ${sprint.name}` }
    : { title: 'Back to today' };

  root.innerHTML = `<div class="cal-wrap ${mode}" style="--weeks:${win.weeks}">
    <div class="toolbar cal-toolbar">
      <h2 class="cal-heading">${heading}</h2>
      <div class="segmented" role="radiogroup" aria-label="Calendar view">
        ${Object.entries(MODES).map(([v, l]) => `<button type="button" role="radio" aria-checked="${mode === v}" class="${mode === v ? 'on' : ''}" data-mode="${v}">${l}</button>`).join('')}
      </div>
      <span class="spacer"></span>
      <span class="nav-group">
        <button class="icon" data-nav="-1" title="Previous ${unit}">${icon('chevronLeft')}</button>
        <button class="icon" data-nav="0" title="${esc(home.title)}" aria-label="${esc(home.title)}">${icon('locate')}</button>
        <button class="icon" data-nav="1" title="Next ${unit}">${icon('chevronRight')}</button>
      </span>
    </div>
    ${mode === 'year' ? yearView(firstMonth, byDate, sprint, now) : monthView(win, byDate, sprint, now)}
  </div>`;

  root.querySelector('.toolbar').addEventListener('click', (e) => {
    const modeBtn = e.target.closest('[data-mode]');
    if (modeBtn) {
      mode = modeBtn.dataset.mode;
      persist();
      return render(view);
    }
    const nav = e.target.closest('[data-nav]');
    if (!nav) return;
    const step = Number(nav.dataset.nav);
    if (step === 0) {
      monthShift = 0;
      weekShift = 0;
    } else if (mode === 'year') {
      monthShift += step * YEAR_STEP;
    } else {
      weekShift += step * WEEK_STEP;
    }
    render(view);
  });


  if (mode === 'year') {
    root.addEventListener('click', (e) => {
      const title = e.target.closest('.mini-title');
      if (title) {
        const [y, m] = title.dataset.ym.split('-').map(Number);
        weekShift = Math.round((mondayOf(new Date(y, m, 1)) - win.anchorMonday) / (7 * DAY)); // the weeks of that month
        mode = 'month';
        persist();
        return render(view);
      }
      const day = e.target.closest('.mini-day[data-date]');
      if (!day) return closePopover();
      const items = byDate.get(day.dataset.date) || [];
      if (!items.length) return openTaskEditor(null, { due: day.dataset.date });
      if (day.classList.contains('open')) return closePopover(); // second click closes it
      openDayPopover(root, day, items);
      day.classList.add('open');
    });
    dragAndDrop(root, '.mini-day[data-date]', moveDue);
    return;
  }

  const cal = root.querySelector('.calendar');
  fitChips(cal);
  refitOnResize(cal, view);
  cardClicks(root);
  root.querySelector('.calendar').addEventListener('click', (e) => {
    if (e.target.closest('.cal-task')) return;
    const day = e.target.closest('.day');
    if (!day) return;
    // A day opens its task list (with "New task" at the bottom); a second click closes it.
    if (day.classList.contains('open')) return closePopover();
    openDayPopover(root, day, byDate.get(day.dataset.date) || []);
  });
  dragAndDrop(root, '.day', moveDue);
}

/** Drop a task (from the list or the calendar itself) on a day: that day becomes its due date. */
function moveDue(id, zone) {
  if (taskById(id)?.due !== zone.dataset.date) updateTask(id, { due: zone.dataset.date });
}
