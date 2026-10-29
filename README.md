# GTD Planner

A simple local planner: tasks, subtasks, priorities, categories, calendar, dependency graph, sprints, backlog and stats.
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
| List | Task tree. Search, sort, group by category, status or sprint, show done tasks |
| Sprint | Board for the active sprint: To do / In progress / Waiting / Done. Drag cards between columns |
| Backlog | Tasks without a sprint. Drag a task into a sprint and its unfinished subtasks come along. Create, start and close sprints here |
| Calendar | Tasks on their due dates. Click a day to add a task, drag a task to move its due date |
| Graph | Tasks as nodes. Solid line: subtask. Dashed arrow A ⇢ B: B waits for A |
| Stats | Summary, done per week, sprint burndown, categories, priorities, velocity, goals |

## Keyboard shortcuts

- `N`: new task
- `Ctrl+Z`: undo the last action (up to 30 steps while the server is running)
- `Esc`: close the dialog

## Data

Everything is in `data/planner.json`. You can edit it by hand; the page picks up changes on reload.

The UI shows and accepts dates as `DD.MM.YYYY`; the file stores them as `YYYY-MM-DD`.

Before the first write of each day, the server copies the file to `data/backups/planner-YYYY-MM-DD.json` and keeps the last 14 copies.
To roll back, stop the server and copy a backup over `data/planner.json`.

### Task fields

| Field | Meaning |
|---|---|
| `status` | `todo`, `doing`, `waiting`, `done` |
| `priority` | `-1` 🧊 someday, `0` normal, `1` 🔥, `2` 🔥🔥, `3` 🔥🔥🔥 |
| `parent_id` | parent task or `null` |
| `depends_on` | ids of tasks that must be done first |
| `sprint_id` | sprint or `null` (backlog) |
| `waiting_for` | what or who you're waiting for (with status `waiting`) |
| `target`, `unit`, `progress` | measurable goal, e.g. "10 h", with `{date, value}` entries. When the sum reaches the target, the task is marked done |
| `due`, `created`, `done_at` | dates as `YYYY-MM-DD` |

`history` records changes to status, sprint, priority, due date and progress (last 5000 entries). Burndown and cycle time are computed from it.

## Layout

```
server.py            HTTP server and API
data/                data and backups
web/index.html       page
web/style.css        styles
web/js/app.js        tabs and keyboard shortcuts
web/js/store.js      state and API calls
web/js/editor.js     task and sprint dialogs
web/js/components.js cards, badges, drag and drop
web/js/views/*.js    one file per tab
```
