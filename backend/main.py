import json
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse

BACKEND_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", BACKEND_DIR / "data"))
DATABASE_FILE = DATA_DIR / "rcd_material_db.json"
BACKUP_DIR = DATA_DIR / "backups"
SEED_FILE = Path(
    os.environ.get("SEED_FILE", BACKEND_DIR / "seed" / "rcd_material_db.json")
)
BACKUP_KEEP = max(1, int(os.environ.get("BACKUP_KEEP", "30")))
MAX_BODY_BYTES = 64 * 1024 * 1024
BACKUP_PATTERN = re.compile(
    r"^(?:material_db|rcd)_\d{8}_\d{6}_[a-f0-9-]+\.json$"
)
LEGACY_BACKUP_PATTERN = re.compile(r"^rcd_\d{8}_\d{6}_[a-f0-9-]+\.json$")
REMOVED_ITEM_FIELDS = {"a", "rs", "rr", "rv", "re", "reach", "reachStatus"}

app = FastAPI(title="Compliance RCD API")
database_lock = threading.RLock()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def item_key(value: object) -> str:
    return re.sub(r"\s+", "", str(value or "")).upper()


def get_items(database: object) -> dict:
    if (
        not isinstance(database, dict)
        or not isinstance(database.get("items"), dict)
    ):
        raise ValueError("Nieprawidłowy format bazy: brak obiektu items.")
    return database["items"]


def get_meta(database: dict) -> dict:
    return {
        "n": len(get_items(database)),
        "src": database.get("src", ""),
        "built": database.get("built", ""),
        "updated": database.get("updated", ""),
    }


def write_database(database: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    temporary_file = DATA_DIR / f".{DATABASE_FILE.name}.{uuid.uuid4()}.tmp"
    try:
        with temporary_file.open("x", encoding="utf-8") as file:
            json.dump(database, file, ensure_ascii=False, separators=(",", ":"))
            file.flush()
            os.fsync(file.fileno())
        temporary_file.replace(DATABASE_FILE)
    finally:
        temporary_file.unlink(missing_ok=True)


def read_database() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if DATABASE_FILE.exists():
        with DATABASE_FILE.open(encoding="utf-8") as file:
            database = json.load(file)
        get_items(database)
        return database

    with SEED_FILE.open(encoding="utf-8") as file:
        database = json.load(file)
    get_items(database)
    write_database(database)
    return database


def list_backup_files() -> list[Path]:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    for legacy_path in BACKUP_DIR.iterdir():
        if legacy_path.is_file() and LEGACY_BACKUP_PATTERN.fullmatch(legacy_path.name):
            renamed_path = BACKUP_DIR / f"material_db_{legacy_path.name[4:]}"
            if not renamed_path.exists():
                legacy_path.rename(renamed_path)
    return sorted(
        (
            path
            for path in BACKUP_DIR.iterdir()
            if path.is_file() and BACKUP_PATTERN.fullmatch(path.name)
        ),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )


def prune_backups() -> None:
    for path in list_backup_files()[BACKUP_KEEP:]:
        path.unlink()


def create_backup(database: dict) -> str:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    name = f"material_db_{timestamp}_{uuid.uuid4()}.json"
    destination = BACKUP_DIR / name
    with destination.open("x", encoding="utf-8") as file:
        json.dump(database, file, ensure_ascii=False, separators=(",", ":"))
    prune_backups()
    return name


def backup_before_change(database: dict, force: bool = False) -> str | None:
    if not force:
        today = datetime.now(timezone.utc).strftime("%Y%m%d")
        if any(
            path.name.startswith((f"material_db_{today}_", f"rcd_{today}_"))
            for path in list_backup_files()
        ):
            return None
    return create_backup(database)


async def read_json_body(request: Request) -> object:
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_BODY_BYTES:
        raise HTTPException(413, "Żądanie przekracza maksymalny rozmiar 64 MB.")
    body = await request.body()
    if len(body) > MAX_BODY_BYTES:
        raise HTTPException(413, "Żądanie przekracza maksymalny rozmiar 64 MB.")
    try:
        return json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise HTTPException(400, "Nieprawidłowy JSON.") from error


def validate_item(value: object) -> dict:
    if (
        not isinstance(value, dict)
        or not isinstance(value.get("i"), str)
        or not item_key(value["i"])
    ):
        raise HTTPException(400, "Rekord musi zawierać niepuste pole ITEM (i).")
    if any(not isinstance(item, dict) for item in [value]):
        raise HTTPException(400, "Rekord ma nieprawidłowy format.")
    return {
        key: field_value
        for key, field_value in value.items()
        if key not in REMOVED_ITEM_FIELDS
    }


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/db")
def get_database() -> dict:
    with database_lock:
        return read_database()


@app.get("/api/meta")
def get_database_meta() -> dict:
    with database_lock:
        return get_meta(read_database())


@app.get("/api/backup")
def download_current_backup() -> FileResponse:
    with database_lock:
        read_database()
        return FileResponse(
            DATABASE_FILE,
            media_type="application/json",
            filename="material_db.json",
        )


@app.get("/api/backups")
def get_backups() -> list[dict]:
    with database_lock:
        return [
            {
                "name": path.name,
                "size": path.stat().st_size,
                "mtime": datetime.fromtimestamp(
                    path.stat().st_mtime, timezone.utc
                ).isoformat(),
            }
            for path in list_backup_files()
        ]


@app.post("/api/backups", status_code=201)
def post_backup() -> dict:
    with database_lock:
        return {"name": create_backup(read_database())}


@app.get("/api/backups/{name}")
def download_backup(name: str) -> FileResponse:
    if Path(name).name != name or not BACKUP_PATTERN.fullmatch(name):
        raise HTTPException(400, "Nieprawidłowa nazwa kopii.")
    path = BACKUP_DIR / name
    if not path.is_file() and LEGACY_BACKUP_PATTERN.fullmatch(name):
        path = BACKUP_DIR / f"material_db_{name[4:]}"
    if not path.is_file():
        raise HTTPException(404, "Nie znaleziono kopii zapasowej.")
    return FileResponse(path, media_type="application/json", filename=path.name)


@app.post("/api/backups/{name}/delete")
def delete_backup(name: str) -> dict:
    if Path(name).name != name or not BACKUP_PATTERN.fullmatch(name):
        raise HTTPException(400, "Nieprawidłowa nazwa kopii.")
    with database_lock:
        path = BACKUP_DIR / name
        if not path.is_file() and LEGACY_BACKUP_PATTERN.fullmatch(name):
            path = BACKUP_DIR / f"material_db_{name[4:]}"
        if not path.is_file():
            raise HTTPException(404, "Nie znaleziono kopii zapasowej.")
        path.unlink()
    return {"name": name, "deleted": True}


@app.post("/api/items", status_code=201)
async def create_item(request: Request) -> dict:
    body = await read_json_body(request)
    item = validate_item(body.get("item") if isinstance(body, dict) else None)
    key = item_key(item["i"])
    with database_lock:
        database = read_database()
        items = get_items(database)
        if key in items:
            raise HTTPException(409, f"Rekord ITEM „{items[key].get('i', key)}” już istnieje.")
        backup_before_change(database)
        saved_item = {**item, "mod": utc_now()}
        items[key] = saved_item
        database["updated"] = utc_now()
        database["n"] = len(items)
        write_database(database)
        return {"key": key, "item": saved_item, "meta": get_meta(database)}


@app.put("/api/items/{key}")
@app.post("/api/items/{key}")
async def update_item(key: str, request: Request) -> dict:
    key = item_key(key)
    if not key or "/" in key:
        raise HTTPException(400, "Nieprawidłowy klucz ITEM.")
    body = await read_json_body(request)
    item = validate_item(body.get("item") if isinstance(body, dict) else None)
    new_key = item_key(item["i"])
    with database_lock:
        database = read_database()
        items = get_items(database)
        current = items.get(key)
        if current is None:
            raise HTTPException(404, "Nie znaleziono rekordu.")
        if (body.get("base") if isinstance(body, dict) else None) != current.get("mod"):
            raise HTTPException(
                409,
                "Rekord został zmieniony przez inną osobę. Odśwież bazę i spróbuj ponownie.",
            )
        if new_key != key and new_key in items:
            raise HTTPException(
                409, f"Rekord ITEM „{items[new_key].get('i', new_key)}” już istnieje."
            )
        backup_before_change(database)
        saved_item = {**item, "mod": utc_now()}
        del items[key]
        items[new_key] = saved_item
        database["updated"] = utc_now()
        database["n"] = len(items)
        write_database(database)
        return {
            "key": new_key,
            "oldKey": key,
            "item": saved_item,
            "meta": get_meta(database),
        }


@app.delete("/api/items/{key}")
@app.post("/api/items/{key}/delete")
def delete_item(key: str) -> dict:
    key = item_key(key)
    if not key or "/" in key:
        raise HTTPException(400, "Nieprawidłowy klucz ITEM.")
    with database_lock:
        database = read_database()
        items = get_items(database)
        if key not in items:
            raise HTTPException(404, "Nie znaleziono rekordu.")
        backup_before_change(database)
        del items[key]
        database["updated"] = utc_now()
        database["n"] = len(items)
        write_database(database)
        return {"meta": get_meta(database)}


@app.put("/api/db")
@app.post("/api/db")
async def replace_database(request: Request) -> dict:
    body = await read_json_body(request)
    if not isinstance(body, dict) or not isinstance(body.get("items"), dict):
        raise HTTPException(
            400, "Nieprawidłowy format bazy: wymagany jest obiekt items."
        )
    with database_lock:
        previous_database = read_database()
        backup_name = backup_before_change(previous_database, force=True)
        items = {
            key: {
                field: value
                for field, value in item.items()
                if field not in REMOVED_ITEM_FIELDS
            }
            for key, item in body["items"].items()
        }
        database = {
            **{key: value for key, value in body.items() if key != "reach"},
            "items": items,
            "n": len(items),
            "updated": utc_now(),
        }
        write_database(database)
        return {"meta": get_meta(database), "backup": backup_name}


@app.post("/api/db/clear")
def clear_database() -> dict:
    with database_lock:
        previous_database = read_database()
        backup_name = backup_before_change(previous_database, force=True)
        database = {
            **previous_database,
            "items": {},
            "n": 0,
            "updated": utc_now(),
        }
        write_database(database)
        return {"meta": get_meta(database), "backup": backup_name}
