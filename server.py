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
    "category": "",
    "tags": [],
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
}
SPRINT_DEFAULTS = {"name": "", "start": None, "end": None, "goal": "", "status": "planned"}

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
    return {"tasks": [], "sprints": [], "history": []}


def load():
    if not DATA_FILE.exists():
        return empty_state()
    try:
        with DATA_FILE.open(encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        raise ApiError(f"{DATA_FILE.name} is corrupted: {e}. Backups are in data/backups/", 500)
    for key in ("tasks", "sprints", "history"):
        data.setdefault(key, [])
    # The file may have been edited by hand: fill in missing fields.
    for task in data["tasks"]:
        for key, value in TASK_DEFAULTS.items():
            task.setdefault(key, copy.deepcopy(value))
    for sprint in data["sprints"]:
        for key, value in SPRINT_DEFAULTS.items():
            sprint.setdefault(key, value)
    return data


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
    with lock:
        data = load()
        data["can_undo"] = bool(undo_stack)
        return data


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
        if key not in TASK_DEFAULTS or key in ("created", "done_at"):
            continue
        if key == "title":
            value = as_str(value).strip()
            if not value:
                raise ApiError("Title cannot be empty")
        elif key in ("category", "unit", "waiting_for"):
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
        elif key in ("parent_id", "sprint_id"):
            value = as_int_or_none(value, key)
        elif key == "due":
            value = as_date(value, "due")
        elif key == "tags":
            value = as_str_list(value)
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
    for item in items:
        if item["id"] == item_id:
            return item
    raise ApiError(f"{what} #{item_id} not found", 404)


def next_id(items):
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
    by_id = {t["id"]: t for t in tasks}
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


def check_task_refs(data, task):
    tasks = data["tasks"]
    ids = {t["id"] for t in tasks}
    parent = task["parent_id"]
    if parent is not None:
        if parent not in ids:
            raise ApiError("Parent task not found")
        if parent == task["id"] or parent in descendant_ids(tasks, task["id"]):
            raise ApiError("A task cannot be a subtask of itself or of its own subtask")
    task["depends_on"] = [d for d in task["depends_on"] if d != task["id"] and d in ids]
    if creates_dependency_cycle(tasks, task["id"], task["depends_on"]):
        raise ApiError("Dependencies form a cycle: the tasks would wait for each other forever")
    if task["sprint_id"] is not None:
        find(data["sprints"], task["sprint_id"], "Sprint")


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
    check_task_refs(data, task)
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
    task = find(data["tasks"], task_id)
    removed = {task_id} | descendant_ids(data["tasks"], task_id)
    for t in data["tasks"]:
        if t["id"] in removed:
            log(data, t["id"], "deleted", t["title"], None)
    data["tasks"] = [t for t in data["tasks"] if t["id"] not in removed]
    for t in data["tasks"]:
        t["depends_on"] = [d for d in t["depends_on"] if d not in removed]
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
        for other in data["sprints"]:
            if other is not sprint and other["status"] == "active":
                raise ApiError(f"Sprint \"{other['name']}\" is already active. Close it first.")


def release_sprint_tasks(data, sprint_id, only_unfinished):
    moved = 0
    for task in data["tasks"]:
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
    find(data["sprints"], sprint_id, "Sprint")
    moved = release_sprint_tasks(data, sprint_id, only_unfinished=False)
    data["sprints"] = [s for s in data["sprints"] if s["id"] != sprint_id]
    return {"ok": True, "moved_to_backlog": moved}


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
