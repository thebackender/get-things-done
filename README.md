# GTD Planner

A simple local planner: tasks, subtasks, priorities, projects, calendar, dependency graph, sprints and backlog.
Needs only Python 3, no packages to install. All data lives in a single JSON file.

## Run

```bash
python3 server.py          # http://localhost:8000
python3 server.py 9000     # on another port
```

The server listens on `127.0.0.1` only, so it isn't reachable from the network.

## Tabs

| Tab | What it does |
|---|---|
| Tasks | Task list on the left, calendar on the right; both show the same tasks. **Sprint** shows only the current sprint's tasks, with its dates, days left, progress and goals above the list; **All** shows everything. **Project** and **Priority** filter by one or more projects (a project includes its subprojects; there is also "No project") and priorities. Done tasks stay in place, struck through. View: sort, group by project, status or sprint, hide done tasks. Drag a task onto another task to make it a subtask, onto a group header to make it top-level again, or onto a calendar day to set its due date. Right-click a task: Add subtask, Edit, Mark done, Make top-level |
| Backlog | Unfinished tasks without a sprint, plus those left over from sprints that have ended. Sprints are collapsed: click one to see its tasks. Drag a task onto a sprint (open or not) and its unfinished subtasks come along. Create and edit sprints here |
| Graph | The same tasks as the list (Sprint / All, Project, Priority and Hide done are shared with Tasks), as cards with their links, left to right: gray line from a parent to its subtasks, orange dashed arrow from a blocker to the task it blocks. Groups of linked tasks are spaced apart; hovering a task makes its links a little bolder. Drag a card to move it; cards never overlap (dropped on another card, it lands on the nearest free spot, shown with a dashed outline while dragging); moved cards keep their place (saved in `data/settings.json`), View → Reset card positions brings back the automatic layout. Right-click a card for the same actions as in the list (plus Delete). Hover a card and drag its orange → handle onto another card to make the first task block the second; click a link to remove it. Hide subtasks: View → Hide subtasks for all, or, like in XMind, the − button where a parent's branches start for one; folded, it shows how many subtasks are hidden, click it to unfold (shared with the list's collapsed tasks); search and press Enter to jump to a task. Drag or scroll to move, Ctrl + scroll to zoom, Fit to see everything |
| Projects | Projects and subprojects: create, rename, delete, pick a color, mark active or inactive |

### Calendar

The calendar starts at the current sprint (at today if there is none); the Sprint button brings you back.
Month view: 5 weeks from the sprint's first week (or the whole sprint if it's longer), square cells, up to 3 tasks per day ("+N more" opens the rest), every other month tinted. Drag a task to another day to move its due date.
Year view: 12 months from the sprint's month; a dot marks days with tasks (red: overdue, orange: urgent), click a day to see its tasks. Click an empty day in either view to add a task.

## Keyboard shortcuts

- `N`: new task
- `Ctrl+Z`: undo the last action (up to 30 steps while the server is running)
- `Esc`: close the dialog

## Data

Everything is in `data/planner.json`. You can edit it by hand; the page picks up changes on reload.

Deleting is always a soft delete: tasks, sprints and projects get `"is_deleted": true` and disappear from the UI,
but stay in the file with all their links. To restore one, set it back to `false` (or press Ctrl+Z right away).
While something is deleted, links to it are ignored: a task in a deleted sprint shows in the backlog,
a task in a deleted project shows without a project, and a deleted blocker no longer blocks.
Editing a task in the UI drops its links to deleted items.

The UI shows and accepts dates as `DD.MM.YYYY`; the file stores them as `YYYY-MM-DD`.

Before the first write of each day, the server copies the file to `data/backups/planner-YYYY-MM-DD.json` and keeps the last 14 copies.
To roll back, stop the server and copy a backup over `data/planner.json`.

### Task fields

| Field | Meaning |
|---|---|
| `status` | `todo`, `doing`, `waiting`, `done` |
| `priority` | `3` critical ★, `2` highest ⌃⌃, `1` high ⌃, `0` medium = (default), `-1` low ⌄, `-2` lowest ⌄⌄ |
| `parent_id` | parent task or `null` |
| `project_id` | project or subproject, or `null` |
| `depends_on` | "Blocked by": ids of tasks that must be done first. The editor's "Blocking" section edits the same links from the other side |
| `sprint_id` | sprint or `null` (backlog) |
| `waiting_for` | what or who you're waiting for (with status `waiting`) |
| `target`, `unit`, `progress` | measurable goal, e.g. "10 h", with `{date, value}` entries. When the sum reaches the target, the task is marked done |
| `due`, `created`, `done_at` | dates as `YYYY-MM-DD` |

### Projects

`projects` is a list of `{id, name, parent_id, color, is_active}`. A project can have subprojects, one level deep (`parent_id` points to a top-level project).
Everywhere in the UI a task's project shows as `Project` or `Project:Subproject`. Subprojects use their project's color.

- In the task editor, the project is a dropdown. "+ New project…" accepts `Project` or `Project:Subproject` and creates whatever doesn't exist yet.
- `is_active: false` hides a project from that dropdown (a subproject is also hidden when its project is inactive). Tasks that already use it keep it.
- Deleting a project also deletes its subprojects; their tasks stay, just without a project.
- Project names cannot contain `:`.

### Sprints

`sprints` is a list of `{id, name, start, end, goals}`. There is no status: a sprint is current while today is between `start` and `end`
(both required, sprints can't overlap), upcoming before that and past after it. `goals` is a list of strings, one per goal.
Unfinished tasks of a past sprint keep their `sprint_id` but show up in the backlog until you drag them into another sprint.

`history` records changes to status, sprint, priority, due date and progress (last 5000 entries); the task editor shows a task's history.

### UI settings

`data/settings.json` keeps the theme and each tab's view options: the Sprint / All, Project and Priority filters, sorting, grouping, "Hide done" and collapsed tasks in the list,
the year/month view of the calendar, which sprints are open in Backlog, "Linked tasks only", "Hide subtasks" and moved card positions in Graph. The page saves it as you change things.
It is separate from `planner.json`: no undo, no history, no backups. Delete it to reset everything to defaults.

```json
{
  "theme": "dark",
  "list": { "sort": "priority", "group": "project", "showDone": false, "collapsed": [12] },
  "graph": { "showDone": false, "onlyLinked": true }
}
```

`theme` is `light`, `dark` or `system` (follows the OS, the default). The ☾/☀ button in the header switches between light and dark; to go back to `system`, set it here or delete the key.

## Layout

```
server.py            HTTP server and API
data/                data, UI settings and backups
web/index.html       page
web/style.css        styles
web/js/app.js        tabs and keyboard shortcuts
web/js/prefs.js      UI settings (data/settings.json)
web/js/theme.js      light / dark theme
web/js/store.js      state and API calls
web/js/editor.js     task and sprint dialogs
web/js/components.js cards, badges, drag and drop
web/js/views/*.js    one file per tab; tasks.js puts list.js and calendar.js side by side
```
