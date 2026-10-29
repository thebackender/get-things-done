#!/usr/bin/env python3
"""GTD Planner: local server.

Serves the web UI from web/ and a REST API; data lives in data/planner.json.
Python standard library only.

Run:  python3 server.py [port]   (default 8000)
"""
import copy
import json
import os
import re
import shutil
import sys
import threading
import traceback
from datetime import date, datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DATA_FILE = DATA_DIR / "planner.json"
BACKUP_DIR = DATA_DIR / "backups"
WEB_DIR = ROOT / "web"

KEEP_BACKUPS = 14
UNDO_DEPTH = 30
HISTORY_LIMIT = 5000

TASK_STATUSES = ("todo", "doing", "waiting", "done")
SPRINT_STATUSES = ("planned", "active", "closed")
TRACKED_FIELDS = ("status", "sprint_id", "priority", "due")

TASK_DEFAULTS = {
    "title": "",
    "parent_id": None,
    "status": "todo",
    "priority": 0,
    "project_id": None,
    "due": None,
    "depends_on": [],
    "sprint_id": None,
    "notes": "",
    "waiting_for": "",
    "target": None,
    "unit": "",
    "progress": [],
    "created": None,
    "done_at": None,
    "is_deleted": False,
}
SPRINT_DEFAULTS = {"name": "", "start": None, "end": None, "goal": "", "status": "planned", "is_deleted": False}
PROJECT_DEFAULTS = {"name": "", "parent_id": None, "color": "#9a9893", "is_active": True, "is_deleted": False}
# Deleting never removes records: it sets is_deleted. Deleted items are hidden from the UI
# but stay in planner.json with all their links, so setting is_deleted back to false restores them.

# Categorical palette (same as the UI). New top-level projects take the first unused color.
PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]
OTHER_COLOR = "#9a9893"

lock = threading.Lock()
undo_stack = []


class ApiError(Exception):
    def __init__(self, message, code=400):
        super().__init__(message)
        self.code = code


def today():
    return date.today().isoformat()


def now():
    return datetime.now().isoformat(timespec="seconds")


# ---------- storage ----------

def empty_state():
    return {"tasks": [], "sprints": [], "projects": [], "history": []}


def load():
    if not DATA_FILE.exists():
        return empty_state()
    try:
        with DATA_FILE.open(encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        raise ApiError(f"{DATA_FILE.name} is corrupted: {e}. Backups are in data/backups/", 500)
    migrate_categories(data)
    for key in ("tasks", "sprints", "projects", "history"):
        data.setdefault(key, [])
    # The file may have been edited by hand: fill in missing fields.
    for task in data["tasks"]:
        for key, value in TASK_DEFAULTS.items():
            task.setdefault(key, copy.deepcopy(value))
    for sprint in data["sprints"]:
        for key, value in SPRINT_DEFAULTS.items():
            sprint.setdefault(key, value)
    for project in data["projects"]:
        for key, value in PROJECT_DEFAULTS.items():
            project.setdefault(key, value)
    return data


def live(items):
    """Items that are not soft-deleted."""
    return [item for item in items if not item.get("is_deleted")]


def next_color(projects):
    used = {p["color"].lower() for p in live(projects) if p["parent_id"] is None}
    return next((color for color in PALETTE if color not in used), OTHER_COLOR)


def migrate_categories(data):
    """Older files had free-text categories and tags. Categories become top-level projects; tags are dropped."""
    if "projects" in data:
        return
    projects = []
    for category in data.get("categories", []):
        projects.append({"id": len(projects) + 1, "name": category["name"], "parent_id": None,
                         "color": category.get("color", OTHER_COLOR), "is_active": True})
    by_name = {p["name"]: p["id"] for p in projects}
    for task in data.get("tasks", []):
        name = task.pop("category", "") or ""
        task.pop("tags", None)
        if name and name not in by_name:
            projects.append({"id": len(projects) + 1, "name": name, "parent_id": None,
                             "color": next_color(projects), "is_active": True})
            by_name[name] = projects[-1]["id"]
        task["project_id"] = by_name.get(name)
    data["projects"] = projects
    data.pop("categories", None)
    data.pop("tags", None)


def backup_daily():
    """Before the first write of the day, copy the current file to data/backups/."""
    if not DATA_FILE.exists():
        return
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    target = BACKUP_DIR / f"planner-{today()}.json"
    if target.exists():
        return
    shutil.copy2(DATA_FILE, target)
    for old in sorted(BACKUP_DIR.glob("planner-*.json"))[:-KEEP_BACKUPS]:
        old.unlink()


def save(data):
    DATA_DIR.mkdir(exist_ok=True)
    backup_daily()
    data["history"] = data["history"][-HISTORY_LIMIT:]
    tmp = DATA_FILE.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, DATA_FILE)


def mutate(fn, *args):
    """Load data, apply fn, save, and push the previous state onto the undo stack."""
    with lock:
        data = load()
        before = copy.deepcopy(data)
        result = fn(data, *args)
        undo_stack.append(before)
        del undo_stack[:-UNDO_DEPTH]
        save(data)
        return result


def get_state():
    """What the UI sees: deleted items are left out, and links pointing at them are shown as empty
    (a task in a deleted sprint shows in the backlog). The file itself keeps the links."""
    with lock:
        data = load()
    projects, sprints, tasks = live(data["projects"]), live(data["sprints"]), live(data["tasks"])
    project_ids = {p["id"] for p in projects}
    sprint_ids = {s["id"] for s in sprints}
    task_ids = {t["id"] for t in tasks}
    shown = []
    for task in tasks:
        view = dict(task)
        if view["project_id"] not in project_ids:
            view["project_id"] = None
        if view["sprint_id"] not in sprint_ids:
            view["sprint_id"] = None
        if view["parent_id"] not in task_ids:
            view["parent_id"] = None
        view["depends_on"] = [d for d in view["depends_on"] if d in task_ids]
        shown.append(view)
    return {"tasks": shown, "sprints": sprints, "projects": projects,
            "history": data["history"], "can_undo": bool(undo_stack)}


def undo():
    with lock:
        if not undo_stack:
            raise ApiError("Nothing to undo")
        save(undo_stack.pop())
        return {"ok": True}


# ---------- input validation ----------

def as_str(value):
    return "" if value is None else str(value)


def as_int(value, field):
    if isinstance(value, bool):
        raise ApiError(f"{field}: expected an integer")
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ApiError(f"{field}: expected an integer")


def as_int_or_none(value, field):
    return None if value in (None, "") else as_int(value, field)


def as_number(value, field):
    if isinstance(value, bool):
        raise ApiError(f"{field}: expected a number")
    try:
        number = float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        raise ApiError(f"{field}: expected a number")
    return int(number) if number.is_integer() else round(number, 4)


def as_date(value, field):
    if value in (None, ""):
        return None
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ApiError(f"{field}: expected a date as YYYY-MM-DD")
    try:
        date.fromisoformat(value)
    except ValueError:
        raise ApiError(f"{field}: invalid date {value}")
    return value


def as_str_list(value):
    if value in (None, ""):
        return []
    if isinstance(value, str):
        value = value.split(",")
    if not isinstance(value, list):
        raise ApiError("Expected a list")
    out = []
    for item in value:
        item = str(item).strip()
        if item and item not in out:
            out.append(item)
    return out


def as_int_list(value, field):
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise ApiError(f"{field}: expected a list")
    out = []
    for item in value:
        item = as_int(item, field)
        if item not in out:
            out.append(item)
    return out


def clean_progress(value):
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise ApiError("progress: expected a list")
    out = []
    for entry in value:
        if not isinstance(entry, dict):
            raise ApiError("progress: each entry must be an object {date, value}")
        amount = as_number(entry.get("value"), "progress.value")
        if amount == 0:
            continue
        out.append({"date": as_date(entry.get("date"), "progress.date") or today(), "value": amount})
    return out


def clean_task(payload):
    """Keep only known task fields and coerce them to the right types."""
    out = {}
    for key, value in payload.items():
        if key not in TASK_DEFAULTS or key in ("created", "done_at", "is_deleted"):
            continue
        if key == "title":
            value = as_str(value).strip()
            if not value:
                raise ApiError("Title cannot be empty")
        elif key in ("unit", "waiting_for"):
            value = as_str(value).strip()
        elif key == "notes":
            value = as_str(value)
        elif key == "status":
            if value not in TASK_STATUSES:
                raise ApiError(f"Unknown status: {value}")
        elif key == "priority":
            value = as_int(value, "priority")
            if not -1 <= value <= 3:
                raise ApiError("Priority must be between -1 and 3")
        elif key in ("parent_id", "sprint_id", "project_id"):
            value = as_int_or_none(value, key)
        elif key == "due":
            value = as_date(value, "due")
        elif key == "depends_on":
            value = as_int_list(value, "depends_on")
        elif key == "target":
            if value in (None, ""):
                value = None
            else:
                value = as_number(value, "target")
                if value <= 0:
                    raise ApiError("Target must be greater than zero")
        elif key == "progress":
            value = clean_progress(value)
        out[key] = value
    return out


def clean_sprint(payload):
    out = {}
    for key, value in payload.items():
        if key not in SPRINT_DEFAULTS:
            continue
        if key == "name":
            value = as_str(value).strip()
            if not value:
                raise ApiError("Sprint name cannot be empty")
        elif key == "goal":
            value = as_str(value).strip()
        elif key in ("start", "end"):
            value = as_date(value, key)
        elif key == "status":
            if value not in SPRINT_STATUSES:
                raise ApiError(f"Unknown sprint status: {value}")
        out[key] = value
    return out


# ---------- tasks ----------

def find(items, item_id, what="Task"):
    """A live (not deleted) item by id."""
    for item in items:
        if item["id"] == item_id and not item.get("is_deleted"):
            return item
    raise ApiError(f"{what} #{item_id} not found", 404)


def next_id(items):
    """Counts deleted items too, so an id is never reused."""
    return max((item["id"] for item in items), default=0) + 1


def descendant_ids(tasks, task_id):
    found, queue = set(), [task_id]
    while queue:
        current = queue.pop()
        for task in tasks:
            if task["parent_id"] == current and task["id"] not in found:
                found.add(task["id"])
                queue.append(task["id"])
    return found


def creates_dependency_cycle(tasks, task_id, depends_on):
    by_id = {t["id"]: t for t in live(tasks)}
    seen, stack = set(), list(depends_on)
    while stack:
        current = stack.pop()
        if current == task_id:
            return True
        if current in seen or current not in by_id:
            continue
        seen.add(current)
        stack.extend(by_id[current]["depends_on"])
    return False


def check_task_refs(data, task, changed=None):
    """Validate links. changed = fields set by this request (None: all, for a new task).
    Unchanged links may point at soft-deleted items and are kept as they are."""
    tasks = data["tasks"]
    ids = {t["id"] for t in live(tasks)}
    check = (lambda key: True) if changed is None else (lambda key: key in changed)
    parent = task["parent_id"]
    if parent is not None and check("parent_id"):
        if parent not in ids:
            raise ApiError("Parent task not found")
        if parent == task["id"] or parent in descendant_ids(tasks, task["id"]):
            raise ApiError("A task cannot be a subtask of itself or of its own subtask")
    if check("depends_on"):
        task["depends_on"] = [d for d in task["depends_on"] if d != task["id"] and d in ids]
    if creates_dependency_cycle(tasks, task["id"], task["depends_on"]):
        raise ApiError("Dependencies form a cycle: the tasks would wait for each other forever")
    if task["sprint_id"] is not None and check("sprint_id"):
        find(data["sprints"], task["sprint_id"], "Sprint")
    if task["project_id"] is not None and check("project_id"):
        find(data["projects"], task["project_id"], "Project")


def apply_blocking(data, task, payload):
    """payload["blocking"] lists the tasks this one blocks: put this task into their depends_on
    ("Blocked by") and take it out of every other task's. Not stored on the task itself."""
    if "blocking" not in payload:
        return
    wanted = set(as_int_list(payload["blocking"], "blocking")) - {task["id"]}
    for other in live(data["tasks"]):
        if other is task:
            continue
        has = task["id"] in other["depends_on"]
        if other["id"] in wanted and not has:
            other["depends_on"].append(task["id"])
        elif has and other["id"] not in wanted:
            other["depends_on"].remove(task["id"])
    for other in data["tasks"]:
        if other["id"] in wanted and creates_dependency_cycle(data["tasks"], other["id"], other["depends_on"]):
            raise ApiError(f'"{other["title"]}" cannot both block this task and be blocked by it')


def goal_sum(task):
    return sum(entry["value"] for entry in task["progress"])


def apply_goal(task):
    """If the goal is reached, mark the task done. Returns True if that happened."""
    if task["target"] is not None and task["status"] != "done" and goal_sum(task) >= task["target"]:
        task["status"] = "done"
        return True
    return False


def apply_done_at(task):
    if task["status"] == "done":
        task["done_at"] = task["done_at"] or today()
    else:
        task["done_at"] = None


def log(data, task_id, field, old, new):
    data["history"].append({"ts": now(), "task_id": task_id, "field": field, "from": old, "to": new})


def log_changes(data, before, task):
    for field in TRACKED_FIELDS:
        if before.get(field) != task[field]:
            log(data, task["id"], field, before.get(field), task[field])
    old_sum, new_sum = goal_sum(before) if before.get("progress") else 0, goal_sum(task)
    if old_sum != new_sum:
        log(data, task["id"], "progress", old_sum, new_sum)


def create_task(data, payload):
    fields = clean_task(payload)
    if not fields.get("title"):
        raise ApiError("Title cannot be empty")
    task = {"id": next_id(data["tasks"]), **copy.deepcopy(TASK_DEFAULTS), **fields, "created": today()}
    data["tasks"].append(task)
    check_task_refs(data, task)
    apply_blocking(data, task, payload)
    goal_reached = apply_goal(task)
    apply_done_at(task)
    log(data, task["id"], "created", None, task["title"])
    if task["status"] != "todo":
        log(data, task["id"], "status", None, task["status"])
    return {"item": task, "goal_reached": goal_reached}


def update_task(data, task_id, payload):
    task = find(data["tasks"], task_id)
    before = copy.deepcopy(task)
    fields = clean_task(payload)
    task.update(fields)
    check_task_refs(data, task, fields)
    apply_blocking(data, task, payload)
    goal_reached = False
    if "progress" in fields or "target" in fields:
        goal_reached = apply_goal(task)
    apply_done_at(task)
    log_changes(data, before, task)
    return {"item": task, "goal_reached": goal_reached}


def batch_update(data, payload):
    items = payload.get("items")
    if not isinstance(items, list):
        raise ApiError("Expected {items: [...]}")
    results = [update_task(data, as_int(item.get("id"), "id"), item) for item in items]
    return {"items": [r["item"] for r in results], "goal_reached": any(r["goal_reached"] for r in results)}


def delete_task(data, task_id):
    """Soft delete: the task and its subtasks get is_deleted; links to them stay in the file."""
    task = find(data["tasks"], task_id)
    removed = {task_id} | descendant_ids(live(data["tasks"]), task_id)
    for t in live(data["tasks"]):
        if t["id"] in removed:
            t["is_deleted"] = True
            log(data, t["id"], "deleted", t["title"], None)
    return {"ok": True, "deleted": sorted(removed), "title": task["title"]}


def add_progress(data, task_id, payload):
    task = find(data["tasks"], task_id)
    if task["target"] is None:
        raise ApiError("This is not a measurable goal: set a target first")
    amount = as_number(payload.get("value"), "value")
    if amount == 0:
        raise ApiError("Value cannot be zero")
    before = copy.deepcopy(task)
    task["progress"].append({"date": as_date(payload.get("date"), "date") or today(), "value": amount})
    goal_reached = apply_goal(task)
    apply_done_at(task)
    log_changes(data, before, task)
    return {"item": task, "goal_reached": goal_reached}


# ---------- sprints ----------

def check_sprint(data, sprint):
    if sprint["start"] and sprint["end"] and sprint["end"] < sprint["start"]:
        raise ApiError("Sprint end is before its start")
    if sprint["status"] == "active":
        for other in live(data["sprints"]):
            if other is not sprint and other["status"] == "active":
                raise ApiError(f"Sprint \"{other['name']}\" is already active. Close it first.")


def release_sprint_tasks(data, sprint_id, only_unfinished):
    moved = 0
    for task in live(data["tasks"]):
        if task["sprint_id"] == sprint_id and not (only_unfinished and task["status"] == "done"):
            log(data, task["id"], "sprint_id", sprint_id, None)
            task["sprint_id"] = None
            moved += 1
    return moved


def create_sprint(data, payload):
    fields = clean_sprint(payload)
    new_id = next_id(data["sprints"])
    sprint = {"id": new_id, **SPRINT_DEFAULTS, **fields}
    sprint["name"] = sprint["name"] or f"Sprint {new_id}"
    data["sprints"].append(sprint)
    check_sprint(data, sprint)
    return {"item": sprint}


def update_sprint(data, sprint_id, payload):
    sprint = find(data["sprints"], sprint_id, "Sprint")
    old_status = sprint["status"]
    sprint.update(clean_sprint(payload))
    check_sprint(data, sprint)
    moved = 0
    if sprint["status"] == "closed" and old_status != "closed":
        moved = release_sprint_tasks(data, sprint_id, only_unfinished=True)
    return {"item": sprint, "moved_to_backlog": moved}


def delete_sprint(data, sprint_id):
    """Soft delete. Its tasks keep sprint_id in the file but show up in the backlog."""
    sprint = find(data["sprints"], sprint_id, "Sprint")
    sprint["is_deleted"] = True
    moved = sum(1 for t in live(data["tasks"]) if t["sprint_id"] == sprint_id)
    return {"ok": True, "moved_to_backlog": moved}


# ---------- projects ----------
# Projects have one optional level of subprojects. Shown as "Project" or "Project:Subproject".
# is_active controls whether a project shows up in the task editor's dropdown.

def clean_color(value):
    color = as_str(value).strip().lower()
    if not re.fullmatch(r"#[0-9a-f]{6}", color):
        raise ApiError("Color must look like #1a2b3c")
    return color


def clean_project_name(value):
    name = as_str(value).strip()
    if not name:
        raise ApiError("Project name cannot be empty")
    if ":" in name:
        raise ApiError('Project name cannot contain ":" (it separates project and subproject)')
    return name


def sibling_named(data, name, parent_id, exclude=None):
    return next((p for p in live(data["projects"])
                 if p["name"] == name and p["parent_id"] == parent_id and p is not exclude), None)


def check_parent(data, parent_id, project=None):
    if parent_id is None:
        return
    parent = find(data["projects"], parent_id, "Project")
    if parent["parent_id"] is not None:
        raise ApiError("Subprojects can only go one level deep")
    if project is not None:
        if parent is project:
            raise ApiError("A project cannot be its own parent")
        if any(p["parent_id"] == project["id"] for p in live(data["projects"])):
            raise ApiError("This project has subprojects, so it cannot become a subproject itself")


def new_project(data, name, parent_id, color=None, is_active=True):
    project = {"id": next_id(data["projects"]), "name": name, "parent_id": parent_id,
               "color": color or (OTHER_COLOR if parent_id else next_color(data["projects"])),
               "is_active": is_active}
    data["projects"].append(project)
    return project


def create_project(data, body):
    """Two forms:
    {name, parent_id?, color?, is_active?} creates exactly that project (error if the name is taken);
    {path: "Project" or "Project:Subproject"} finds or creates each part (used by the task editor)."""
    if "path" in body:
        parts = [part.strip() for part in as_str(body["path"]).split(":")]
        if len(parts) > 2:
            raise ApiError('Use "Project" or "Project:Subproject" (one level of subprojects)')
        names = [clean_project_name(part) for part in parts]
        root = sibling_named(data, names[0], None) or new_project(data, names[0], None)
        root["is_active"] = True
        if len(names) == 1:
            return {"item": root}
        sub = sibling_named(data, names[1], root["id"]) or new_project(data, names[1], root["id"])
        sub["is_active"] = True
        return {"item": sub}

    name = clean_project_name(body.get("name"))
    parent_id = as_int_or_none(body.get("parent_id"), "parent_id")
    check_parent(data, parent_id)
    if sibling_named(data, name, parent_id):
        raise ApiError(f'Project "{name}" already exists here')
    color = clean_color(body["color"]) if body.get("color") else None
    return {"item": new_project(data, name, parent_id, color, bool(body.get("is_active", True)))}


def update_project(data, project_id, body):
    project = find(data["projects"], project_id, "Project")
    if "parent_id" in body:
        parent_id = as_int_or_none(body["parent_id"], "parent_id")
        check_parent(data, parent_id, project)
        project["parent_id"] = parent_id
    if "name" in body:
        project["name"] = clean_project_name(body["name"])
    if sibling_named(data, project["name"], project["parent_id"], exclude=project):
        raise ApiError(f'Project "{project["name"]}" already exists here')
    if "color" in body:
        project["color"] = clean_color(body["color"])
    if "is_active" in body:
        project["is_active"] = bool(body["is_active"])
    return {"item": project}


def delete_project(data, project_id):
    """Soft delete of the project and its subprojects. Their tasks keep project_id in the file
    but show up without a project."""
    find(data["projects"], project_id, "Project")
    removed = {project_id} | {p["id"] for p in live(data["projects"]) if p["parent_id"] == project_id}
    for project in data["projects"]:
        if project["id"] in removed:
            project["is_deleted"] = True
    cleared = sum(1 for t in live(data["tasks"]) if t["project_id"] in removed)
    return {"ok": True, "deleted": len(removed), "cleared": cleared}


# ---------- HTTP ----------

ROUTES = [
    ("GET", r"/api/state", lambda body, i: get_state()),
    ("POST", r"/api/undo", lambda body, i: undo()),
    ("POST", r"/api/tasks", lambda body, i: mutate(create_task, body)),
    ("POST", r"/api/tasks/batch", lambda body, i: mutate(batch_update, body)),
    ("PUT", r"/api/tasks/(\d+)", lambda body, i: mutate(update_task, i, body)),
    ("DELETE", r"/api/tasks/(\d+)", lambda body, i: mutate(delete_task, i)),
    ("POST", r"/api/tasks/(\d+)/progress", lambda body, i: mutate(add_progress, i, body)),
    ("POST", r"/api/sprints", lambda body, i: mutate(create_sprint, body)),
    ("PUT", r"/api/sprints/(\d+)", lambda body, i: mutate(update_sprint, i, body)),
    ("DELETE", r"/api/sprints/(\d+)", lambda body, i: mutate(delete_sprint, i)),
    ("POST", r"/api/projects", lambda body, i: mutate(create_project, body)),
    ("PUT", r"/api/projects/(\d+)", lambda body, i: mutate(update_project, i, body)),
    ("DELETE", r"/api/projects/(\d+)", lambda body, i: mutate(delete_project, i)),
]


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".css": "text/css",
        ".html": "text/html; charset=utf-8",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_request(self, code="-", size="-"):
        # Keep the console quiet for successful requests; errors are still shown.
        if not str(code).startswith(("2", "3")):
            super().log_request(code, size)

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            body = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ApiError("Invalid JSON in request")
        if not isinstance(body, dict):
            raise ApiError("Expected a JSON object")
        return body

    def handle_api(self, method):
        path = self.path.split("?", 1)[0].rstrip("/")
        if not path.startswith("/api/"):
            return False
        try:
            for route_method, pattern, handler in ROUTES:
                match = re.fullmatch(pattern, path)
                if match and route_method == method:
                    body = self.read_body() if method in ("POST", "PUT") else {}
                    item_id = int(match.group(1)) if match.groups() else None
                    self.send_json(handler(body, item_id))
                    return True
            raise ApiError("No such API endpoint", 404)
        except ApiError as e:
            self.send_json({"error": str(e)}, e.code)
        except Exception as e:  # noqa: BLE001 — show the error in the UI instead of crashing
            traceback.print_exc()
            self.send_json({"error": f"Internal server error: {e}"}, 500)
        return True

    def do_GET(self):
        if not self.handle_api("GET"):
            super().do_GET()

    def do_POST(self):
        if not self.handle_api("POST"):
            self.send_error(404)

    def do_PUT(self):
        if not self.handle_api("PUT"):
            self.send_error(404)

    def do_DELETE(self):
        if not self.handle_api("DELETE"):
            self.send_error(404)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    if not DATA_FILE.exists():
        save(empty_state())
    try:
        load()
    except ApiError as e:
        sys.exit(str(e))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"GTD Planner: http://localhost:{port}   (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
