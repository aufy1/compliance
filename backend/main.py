import hashlib
import json
import logging
import math
import os
import re
import secrets
import subprocess
import threading
import tempfile
import unicodedata
import uuid
import zipfile
from io import BytesIO
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool

import storage
from auth_provider import LocalAuthenticationProvider

BACKEND_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", BACKEND_DIR / "data"))
DATABASE_FILE = DATA_DIR / "rcd_material_db.json"
PPWR_DATABASE_FILE = DATA_DIR / "ppwr_material_db.json"
BACKUP_DIR = DATA_DIR / "backups"
SEED_FILE = Path(
    os.environ.get("SEED_FILE", BACKEND_DIR / "seed" / "rcd_material_db.json")
)
BACKUP_KEEP = max(1, int(os.environ.get("BACKUP_KEEP", "30")))
MAX_BODY_BYTES = 64 * 1024 * 1024
MAX_PDF_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_BACKUP_PDF_BYTES = 20 * 1024 * 1024
MAX_BACKUP_ZIP_BYTES = 100 * 1024 * 1024
MAX_BACKUP_UNPACKED_BYTES = 300 * 1024 * 1024
MAX_DOCUMENT_NAME_LENGTH = 230
DOCUMENT_TYPES = {
    "RCD",
    "PPWR",
    "RoHS",
    "REACH",
    "CA Prop 65",
    "TSCA",
    "PFAS",
    "Specification",
    "Drawing",
    "FMD",
}
PPWR_FILES_DIR = DATA_DIR / "ppwr_files"
DOCUMENTS_FILE = DATA_DIR / "pdf_documents.json"
DOCUMENT_LINKS_FILE = DATA_DIR / "material_document_links.json"
DOCUMENTS_DIR = DATA_DIR / "documents"
DOCUMENT_NAME_TIMESTAMP = re.compile(
    r"^(?P<timestamp>\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})__(?P<name>.+)$"
)
LEGACY_JSON_BACKUP_PATTERN = re.compile(
    r"^(?:material_db|rcd)_\d{8}_\d{6}_[a-f0-9-]+\.json$"
)
POSTGRES_BACKUP_PATTERN = re.compile(
    r"^postgresql_(?:daily|manual)_\d{8}_\d{6}_[a-f0-9-]+\.dump$"
)
REMOVED_ITEM_FIELDS = {"a", "rs", "rr", "rv", "re", "reach", "reachStatus"}

app = FastAPI(title="Compliance RCD API")
database_lock = threading.RLock()
logger = logging.getLogger(__name__)
SESSION_COOKIE = "compliance_session"
SESSION_TTL_HOURS = 12


@app.on_event("startup")
def initialize_application() -> None:
    if not storage.postgres_enabled():
        raise RuntimeError("PostgreSQL must be configured before starting the API.")

    username = os.environ.get("BOOTSTRAP_ADMIN_USERNAME", "").strip()
    password = os.environ.get("BOOTSTRAP_ADMIN_PASSWORD", "")
    if (
        not re.fullmatch(r"[A-Za-z0-9._@-]{1,80}", username)
        or len(password) < 12
        or len(password) > 256
    ):
        raise RuntimeError(
            "Set a valid BOOTSTRAP_ADMIN_USERNAME and a "
            "BOOTSTRAP_ADMIN_PASSWORD of 12–256 characters."
        )

    from pwdlib import PasswordHash

    password_hasher = PasswordHash.recommended()
    dummy_password_hash = password_hasher.hash(secrets.token_urlsafe(32))
    app.state.authentication_provider = LocalAuthenticationProvider(
        password_hasher, dummy_password_hash
    )
    storage.initialize(
        DATA_DIR,
        SEED_FILE,
        username,
        password_hasher.hash(password),
    )


def _session_cookie_secure() -> bool:
    return os.environ.get("SESSION_COOKIE_SECURE", "true").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@app.middleware("http")
async def authenticate_and_audit(request: Request, call_next):
    if not storage.postgres_enabled() or not request.url.path.startswith("/api/"):
        return await call_next(request)

    path = request.url.path
    username = None
    if path not in {"/api/health", "/api/auth/login"}:
        token = request.cookies.get(SESSION_COOKIE)
        if token:
            username = storage.get_session_username(_token_hash(token))
        if not username:
            response = JSONResponse(
                status_code=401, content={"detail": "Wymagane jest zalogowanie."}
            )
            if request.method not in {"GET", "HEAD", "OPTIONS"}:
                storage.record_operation(
                    None, request.method, path, response.status_code,
                    request.headers.get("x-real-ip")
                    or (request.client.host if request.client else None),
                )
            return response
        request.state.username = username

    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin")
        if origin:
            try:
                origin_host = urlsplit(origin).netloc.casefold()
            except ValueError:
                origin_host = ""
            request_host = (
                request.headers.get("x-forwarded-host")
                or request.headers.get("host", "")
            ).casefold()
            if not origin_host or origin_host != request_host:
                response = JSONResponse(
                    status_code=403, content={"detail": "Nieprawidłowe źródło żądania."}
                )
                storage.record_operation(
                    username, request.method, path, response.status_code,
                    request.headers.get("x-real-ip")
                    or (request.client.host if request.client else None),
                )
                return response

    if (
        request.method not in {"GET", "HEAD", "OPTIONS"}
        and path.startswith("/api/")
        and path != "/api/auth/login"
        and not path.startswith("/api/backups")
    ):
        try:
            await run_in_threadpool(ensure_daily_postgres_backup)
        except (OSError, subprocess.SubprocessError, RuntimeError):
            logger.exception("Automatic PostgreSQL backup failed; write was blocked.")
            response = JSONResponse(
                status_code=503,
                content={"detail": "Nie udało się utworzyć dziennej kopii PostgreSQL. Zmiana nie została zapisana."},
            )
            storage.record_operation(
                username,
                request.method,
                path,
                response.status_code,
                request.headers.get("x-real-ip")
                or (request.client.host if request.client else None),
            )
            return response

    response = await call_next(request)
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        route = request.scope.get("route")
        action = getattr(route, "path", path)
        username = getattr(request.state, "username", username)
        storage.record_operation(
            username,
            request.method,
            action,
            response.status_code,
            request.headers.get("x-real-ip")
            or (request.client.host if request.client else None),
        )
    return response


@app.post("/api/auth/login")
async def login(request: Request, response: Response) -> dict:
    body = await read_json_body(request)
    if (
        not isinstance(body, dict)
        or not isinstance(body.get("username"), str)
        or not isinstance(body.get("password"), str)
        or len(body["username"]) > 80
        or len(body["password"]) > 256
    ):
        raise HTTPException(400, "Podaj nazwę użytkownika i hasło.")
    username = body["username"].strip()
    if not request.app.state.authentication_provider.authenticate(
        username, body["password"]
    ):
        raise HTTPException(401, "Nieprawidłowa nazwa użytkownika lub hasło.")

    request.state.username = username
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=SESSION_TTL_HOURS)
    storage.create_session(_token_hash(token), username, expires_at)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_TTL_HOURS * 60 * 60,
        httponly=True,
        secure=_session_cookie_secure(),
        samesite="strict",
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return {"user": {"username": username}}


@app.get("/api/auth/me")
def current_user(request: Request) -> dict:
    return {"user": {"username": request.state.username}}


@app.post("/api/auth/change-password")
async def change_password(request: Request) -> dict:
    body = await read_json_body(request)
    if (
        not isinstance(body, dict)
        or not isinstance(body.get("currentPassword"), str)
        or not isinstance(body.get("newPassword"), str)
        or len(body["currentPassword"]) > 256
        or not 12 <= len(body["newPassword"]) <= 256
    ):
        raise HTTPException(
            400, "Podaj obecne hasło oraz nowe hasło o długości 12–256 znaków."
        )

    username = request.state.username
    provider = request.app.state.authentication_provider
    if not provider.authenticate(username, body["currentPassword"]):
        raise HTTPException(400, "Obecne hasło jest nieprawidłowe.")

    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(401, "Wymagane jest zalogowanie.")
    password_hash = provider.password_hasher.hash(body["newPassword"])
    storage.update_user_password(username, password_hash, _token_hash(token))
    return {"changed": True}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response) -> dict:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        storage.delete_session(_token_hash(token))
    response.delete_cookie(
        SESSION_COOKIE,
        httponly=True,
        secure=_session_cookie_secure(),
        samesite="strict",
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return {"loggedOut": True}


@app.get("/api/audit")
def get_audit_log(limit: int = Query(default=100, ge=1, le=500)) -> dict:
    return {"operations": storage.list_operations(limit)}


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


def normalize_material_keys(database: dict) -> bool:
    items = get_items(database)
    normalized_items = {}
    for key, item in items.items():
        normalized_key = item_key(key)
        if not normalized_key or normalized_key in normalized_items:
            raise ValueError(f"Nieprawidłowy lub powtórzony klucz ITEM: {key}.")
        normalized_items[normalized_key] = item

    if normalized_items == items:
        return False

    database["items"] = normalized_items
    database["n"] = len(normalized_items)
    return True


def get_meta(database: dict) -> dict:
    return {
        "n": len(get_items(database)),
        "src": database.get("src", ""),
        "built": database.get("built", ""),
        "updated": database.get("updated", ""),
    }


def fold_search(value: object) -> str:
    text = str(value or "").casefold().replace("ł", "l")
    return "".join(
        character
        for character in unicodedata.normalize("NFD", text)
        if not unicodedata.combining(character)
    )


def natural_sort_key(value: object) -> list[tuple[int, object]]:
    return [
        (0, int(part)) if part.isdigit() else (1, part.casefold())
        for part in re.split(r"(\d+)", str(value or ""))
    ]


def item_array(item: dict, field: str) -> list:
    value = item.get(field)
    return value if isinstance(value, list) else []


def item_object(item: dict, field: str) -> dict:
    value = item.get(field)
    return value if isinstance(value, dict) else {}


def reach_status(item: dict) -> str:
    if isinstance(item.get("rc"), bool):
        return "compliant" if item["rc"] else "non-compliant"
    states = (
        "compliant_no_svhc",
        "compliant_svhc",
        "compliant_unspecified_svhc",
        "svhc_verify",
        "non_compliant",
        "pending_verify",
        "not_applicable",
        "no_data",
        "verify",
    )
    index = item.get("rs")
    state = states[index] if type(index) is int and 0 <= index < len(states) else (
        item_object(item, "re").get("s")
    )
    if state in states[:3]:
        return "compliant"
    if state == "non_compliant":
        return "non-compliant"
    return "unknown"


def material_filter_value(key: str, item: dict, labels: dict | None = None) -> str:
    labels = labels or {}
    if key == "item":
        return " ".join([key, str(item.get("i") or ""), *(str(value) for value in item_array(item, "al"))])
    if key == "description":
        return " ".join([str(item.get("d") or ""), *(str(value) for value in item_array(item, "w"))])
    if key == "supplier":
        return str(item.get("sup") or "")
    if key == "rohs":
        return " ".join([str(item.get("r") or ""), *(str(value) for value in item_array(item, "ex"))])
    if key == "reach":
        version = item.get("rn")
        return f"{reach_status(item)} svhc {version}" if version is not None else reach_status(item)
    if key == "date":
        return str(item.get("dt") or "")
    if key == "substances":
        values = []
        for substance_id, details in item_object(item, "h").items():
            values.append(str(substance_id))
            if substance_id in labels:
                values.append(labels[substance_id])
            if isinstance(details, list):
                values.extend(str(value) for value in details if value)
        return " ".join(values)
    if key == "missing":
        return " ".join(
            " ".join([str(value), str(labels.get(value, ""))])
            for value in item_array(item, "u")
        )
    return ""


def filtered_material_items(database: dict, query: str, filters: dict) -> dict:
    words = [fold_search(word) for word in query.strip().split() if word]
    matches = {}
    for key, item in get_items(database).items():
        if not isinstance(item, dict):
            continue
        haystack = fold_search(" ".join([
            key,
            str(item.get("i") or ""),
            str(item.get("d") or ""),
            str(item.get("sup") or ""),
            str(item.get("r") or ""),
            material_filter_value("reach", item),
            " ".join(str(value) for value in item_array(item, "al")),
        ]))
        if not all(word in haystack for word in words):
            continue
        include = True
        for field, criteria in filters.items():
            value = material_filter_value(field, item, criteria.get("labels"))
            mode = criteria["mode"]
            if mode == "empty" and value.strip():
                include = False
            elif mode == "nonempty" and not value.strip():
                include = False
            elif mode == "text":
                terms = [fold_search(term) for term in criteria["query"].split() if term]
                candidate = fold_search(value)
                if field == "supplier" and criteria["match"] == "exact":
                    include = not terms or candidate == " ".join(terms)
                else:
                    include = all(term in candidate for term in terms)
            if not include:
                break
        if include:
            matches[key] = item
    return matches


def validate_material_filters(raw_filters: str) -> dict:
    try:
        filters = json.loads(raw_filters)
    except json.JSONDecodeError as error:
        raise HTTPException(400, "Nieprawidłowe filtry bazy.") from error
    allowed_fields = {
        "item", "description", "supplier", "rohs", "reach", "date",
        "substances", "missing",
    }
    if not isinstance(filters, dict) or set(filters) - allowed_fields:
        raise HTTPException(400, "Nieprawidłowe filtry bazy.")
    validated = {}
    for field, criteria in filters.items():
        mode = criteria.get("mode") if isinstance(criteria, dict) else None
        match = criteria.get("match", "contains") if isinstance(criteria, dict) else None
        if (
            not isinstance(criteria, dict)
            or not isinstance(mode, str)
            or mode not in {"all", "empty", "nonempty", "text"}
            or not isinstance(criteria.get("query", ""), str)
            or len(criteria.get("query", "")) > 200
            or not isinstance(match, str)
            or match not in {"contains", "exact"}
            or (
                "labels" in criteria
                and (
                    not isinstance(criteria["labels"], dict)
                    or len(criteria["labels"]) > 500
                    or any(
                        not isinstance(label, str) or len(label) > 200
                        for label in criteria["labels"].values()
                    )
                )
            )
        ):
            raise HTTPException(400, "Nieprawidłowy filtr bazy.")
        validated[field] = {
            "mode": mode,
            "query": criteria.get("query", ""),
            "match": match,
            "labels": criteria.get("labels", {}),
        }
    return validated


def material_sort_value(key: str, item: dict, sort: str):
    if sort == "description":
        return fold_search(item.get("d"))
    if sort == "rohs":
        return fold_search(item.get("r"))
    if sort == "reach":
        return fold_search(material_filter_value("reach", item))
    if sort == "date":
        value = str(item.get("dt") or "")
        match = re.match(r"^(\d{2})\.(\d{2})\.(\d{4})", value)
        return f"{match.group(3)}-{match.group(2)}-{match.group(1)}" if match else value
    if sort == "substances":
        return len(item_object(item, "h"))
    if sort == "missing":
        return len(item_array(item, "u"))
    return natural_sort_key(key)


def lookup_materials(tokens: list[str], database: dict) -> dict:
    items = get_items(database)
    exact = {item_key(key): key for key in items}
    compact = {}
    aliases = {}
    for key, item in items.items():
        normalized = re.sub(r"[^A-Z0-9]", "", key.upper()).lstrip("0")
        if normalized:
            compact.setdefault(normalized, key)
        if not isinstance(item, dict):
            continue
        for alias in item_array(item, "al"):
            normalized_alias = re.sub(r"[^A-Z0-9]", "", str(alias).upper()).lstrip("0")
            if normalized_alias:
                aliases.setdefault(normalized_alias, key)
    found = {}
    for token in tokens:
        normalized_key = item_key(token)
        key = exact.get(normalized_key)
        if key is None:
            normalized = re.sub(r"[^A-Z0-9]", "", token.upper()).lstrip("0")
            key = compact.get(normalized) or aliases.get(normalized)
        if key is not None:
            found[key] = items[key]
    return found


def write_database(database: dict) -> None:
    normalize_material_keys(database)
    write_json_file(DATABASE_FILE, database)


def write_json_file(path: Path, database: dict) -> None:
    if storage.postgres_enabled():
        storage.write_json(path.name, database)
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    temporary_file = DATA_DIR / f".{path.name}.{uuid.uuid4()}.tmp"
    try:
        with temporary_file.open("x", encoding="utf-8") as file:
            json.dump(database, file, ensure_ascii=False, separators=(",", ":"))
            file.flush()
            os.fsync(file.fileno())
        temporary_file.replace(path)
    finally:
        temporary_file.unlink(missing_ok=True)


def read_json_file(path: Path):
    if storage.postgres_enabled():
        return storage.read_json(path.name)
    if not path.exists():
        return None
    with path.open(encoding="utf-8") as file:
        return json.load(file)


def read_database() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    database = read_json_file(DATABASE_FILE)
    if database is not None:
        get_items(database)
        normalize_material_keys(database)
        return database

    with SEED_FILE.open(encoding="utf-8") as file:
        database = json.load(file)
    get_items(database)
    write_database(database)
    return database


def read_ppwr_database() -> dict:
    ensure_legacy_pdf_migration()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    database = read_json_file(PPWR_DATABASE_FILE)
    if database is not None:
        if not isinstance(database, dict) or not isinstance(database.get("items"), dict):
            raise ValueError("Nieprawidłowy format bazy PPWR: brak obiektu items.")
        normalized = validate_ppwr_database(database)
        if normalized != database:
            write_json_file(PPWR_DATABASE_FILE, normalized)
        return normalized

    database = {"items": {}}
    write_json_file(PPWR_DATABASE_FILE, database)
    return database

def _read_document_database() -> dict:
    database = read_json_file(DOCUMENTS_FILE)
    if database is None:
        return {"documents": {}}
    if not isinstance(database, dict) or not isinstance(database.get("documents"), dict):
        raise ValueError("Nieprawidłowa baza dokumentów PDF.")
    return database


def _read_document_links() -> dict:
    links = read_json_file(DOCUMENT_LINKS_FILE)
    if links is None:
        return {"items": {}}
    if not isinstance(links, dict) or not isinstance(links.get("items"), dict):
        raise ValueError("Nieprawidłowy plik powiązań dokumentów.")
    return links


def validate_document_database(value: object) -> dict:
    if not isinstance(value, dict) or not isinstance(value.get("documents"), dict):
        raise HTTPException(400, "Nieprawidłowa baza dokumentów PDF.")
    documents = {}
    for document_id, document in value["documents"].items():
        if (
            not isinstance(document_id, str)
            or not re.fullmatch(r"[a-f0-9-]{36}", document_id)
            or not isinstance(document, dict)
            or not isinstance(document.get("n"), str)
            or not document["n"].strip()
            or len(document["n"]) > MAX_DOCUMENT_NAME_LENGTH
            or re.search(r"[\x00-\x1f\x7f]", document["n"])
            or type(document.get("z")) is not int
            or document["z"] < 0
            or (
                document.get("type") is not None
                and (
                    not isinstance(document.get("type"), str)
                    or document.get("type") not in DOCUMENT_TYPES
                )
            )
            or (
                document.get("dt") is not None
                and not is_document_date(document.get("dt"))
            )
            or not isinstance(document.get("h"), str)
            or not re.fullmatch(r"[a-f0-9]{64}", document["h"])
        ):
            raise HTTPException(400, f"Nieprawidłowe metadane dokumentu {document_id}.")
        documents[document_id] = {
            "n": document["n"].strip(),
            "z": document["z"],
            "h": document["h"],
            "type": document.get("type"),
            "dt": document.get("dt"),
        }
    return {"documents": documents}


def is_document_date(value: object) -> bool:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def validate_document_date(value: object) -> str | None:
    if value is None or value == "":
        return None
    if not is_document_date(value):
        raise HTTPException(400, "Podaj prawidłową datę deklaracji.")
    return value


def validate_document_type(value: object, required: bool = False) -> str | None:
    if value is None or value == "":
        if required:
            raise HTTPException(400, "Wybierz typ dokumentu.")
        return None
    if not isinstance(value, str) or value not in DOCUMENT_TYPES:
        raise HTTPException(400, "Nieprawidłowy typ dokumentu.")
    return value


def split_document_name(name: str) -> tuple[str, str | None]:
    match = DOCUMENT_NAME_TIMESTAMP.fullmatch(name)
    if not match:
        return name, None
    return match.group("name"), match.group("timestamp")


def document_name_with_timestamp(name: str, timestamp: str | None = None) -> str:
    if timestamp is None:
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M-%S")
    return f"{timestamp}__{name}"


def validate_document_links(value: object, documents: dict, materials: dict) -> dict:
    if not isinstance(value, dict) or not isinstance(value.get("items"), dict):
        raise HTTPException(400, "Nieprawidłowy plik powiązań dokumentów.")
    links = {}
    for raw_key, document_ids in value["items"].items():
        key = item_key(raw_key)
        if not key or key not in materials or not isinstance(document_ids, list):
            raise HTTPException(400, f"Nieprawidłowe powiązania dokumentów dla ITEM {raw_key}.")
        if any(
            not isinstance(document_id, str)
            or not re.fullmatch(r"[a-f0-9-]{36}", document_id)
            or document_id not in documents
            for document_id in document_ids
        ):
            raise HTTPException(400, f"Nieznany dokument w powiązaniach ITEM {key}.")
        if len(document_ids) != len(set(document_ids)):
            raise HTTPException(400, f"Powtórzone powiązanie dokumentu dla ITEM {key}.")
        if document_ids:
            links[key] = list(document_ids)
    return {"items": links}


def ensure_legacy_pdf_migration() -> None:
    try:
        raw_ppwr = read_json_file(PPWR_DATABASE_FILE)
    except (OSError, json.JSONDecodeError):
        return
    if not isinstance(raw_ppwr, dict) or not isinstance(raw_ppwr.get("items"), dict):
        return
    raw_attachments = {
        item_key(key): item.get("f", [])
        for key, item in raw_ppwr["items"].items()
        if isinstance(item, dict) and item.get("f")
    }
    if not raw_attachments:
        return

    documents = validate_document_database(_read_document_database())["documents"]
    links = _read_document_links()["items"]
    materials = get_items(read_database())
    DOCUMENTS_DIR.mkdir(parents=True, exist_ok=True)
    migrated_files = []
    for key, attachments in raw_attachments.items():
        if not isinstance(attachments, list):
            raise ValueError(f"Nieprawidłowa lista dokumentów PPWR dla ITEM {key}.")
        for attachment in attachments:
            if not isinstance(attachment, dict):
                raise ValueError(f"Nieprawidłowe metadane starego PDF dla ITEM {key}.")
            document_id = attachment.get("i")
            name = attachment.get("n")
            size = attachment.get("z")
            if (
                not isinstance(document_id, str)
                or not re.fullmatch(r"[a-f0-9-]{36}", document_id)
                or not isinstance(name, str)
                or not name.strip()
                or type(size) is not int
                or size < 0
            ):
                raise ValueError(f"Nieprawidłowe metadane starego PDF dla ITEM {key}.")
            old_path = PPWR_FILES_DIR / f"{document_id}.pdf"
            new_path = DOCUMENTS_DIR / f"{document_id}.pdf"
            source_path = old_path if old_path.is_file() else new_path
            if not source_path.is_file():
                raise ValueError(f"Brakuje pliku starego PDF: {name}.")
            content = source_path.read_bytes()
            if not content.startswith(b"%PDF-"):
                raise ValueError(f"Nieprawidłowy plik PDF: {name}.")
            digest = hashlib.sha256(content).hexdigest()
            existing_id = next(
                (
                    candidate_id
                    for candidate_id, candidate in documents.items()
                    if candidate["h"] == digest
                    and (DOCUMENTS_DIR / f"{candidate_id}.pdf").is_file()
                ),
                None,
            )
            if source_path == old_path:
                migrated_files.append(old_path)
            if existing_id:
                document_id = existing_id
            else:
                if source_path == old_path:
                    new_path.write_bytes(content)
                documents[document_id] = {"n": name.strip(), "z": len(content), "h": digest}
            if key in materials:
                target_links = links.setdefault(key, [])
                if document_id not in target_links:
                    target_links.append(document_id)
    write_json_file(DOCUMENTS_FILE, {"documents": documents})
    write_json_file(DOCUMENT_LINKS_FILE, {"items": links})

    normalized_ppwr = validate_ppwr_database(raw_ppwr)
    write_json_file(PPWR_DATABASE_FILE, normalized_ppwr)
    for old_path in migrated_files:
        old_path.unlink(missing_ok=True)


def get_document_stores() -> tuple[dict, dict]:
    ensure_legacy_pdf_migration()
    documents = validate_document_database(_read_document_database())
    materials = get_items(read_database())
    links = validate_document_links(_read_document_links(), documents["documents"], materials)
    return documents, links


def validate_ppwr_item(value: object) -> dict:
    if not isinstance(value, dict):
        raise HTTPException(400, "Dane PPWR muszą być obiektem JSON.")
    if "packagingType" in value or "heavyMetalsMgKg" in value:
        legacy_stage = value.get("stage", "")
        stage_codes = {"primary": "p", "secondary": "s", "tertiary": "t"}
        old_metals = value.get("heavyMetalsCompliance", "unknown")
        legacy_metals = {
            "unknown": "u",
            "compliant": "c",
            "nonCompliant": "n",
        }
        measured_metals = value.get("heavyMetalsMgKg")
        if measured_metals is not None:
            try:
                finite_metals = math.isfinite(measured_metals)
            except (OverflowError, TypeError):
                finite_metals = False
            if (
                isinstance(measured_metals, bool)
                or not isinstance(measured_metals, (int, float))
                or not finite_metals
                or measured_metals < 0
            ):
                raise HTTPException(400, "Nieprawidłowa wartość metali ciężkich.")
            old_metals = "compliant" if measured_metals <= 100 else "nonCompliant"
        legacy_attachments = value.get("attachments", [])
        if not isinstance(legacy_attachments, list) or any(
            not isinstance(entry, dict) for entry in legacy_attachments
        ):
            raise HTTPException(400, "Nieprawidłowa lista załączników PPWR.")
        value = {
            "t": value.get("packagingType", ""),
            "w": value.get("weightGrams"),
            "m": value.get("manufacturer", ""),
            "s": [stage_codes[legacy_stage]] if isinstance(legacy_stage, str) and legacy_stage in stage_codes else [],
            "h": legacy_metals.get(old_metals, "u")
            if isinstance(old_metals, str)
            else "u",
            "f": [
                {"i": entry.get("id"), "n": entry.get("name"), "z": entry.get("size")}
                for entry in legacy_attachments
                if isinstance(entry, dict)
            ],
        }
    unknown_fields = set(value) - {"t", "w", "m", "s", "h", "f"}
    if unknown_fields:
        raise HTTPException(400, "Dane PPWR zawierają nieobsługiwane pola.")

    packaging_type = value.get("t", "")
    if not isinstance(packaging_type, str):
        raise HTTPException(400, "Typ opakowania musi być tekstem.")

    manufacturer = value.get("m", "")
    if not isinstance(manufacturer, str):
        raise HTTPException(400, "Nazwa MFG musi być tekstem.")

    stages = value.get("s", [])
    if not isinstance(stages, list) or any(
        not isinstance(stage, str) or stage not in {"p", "s", "t"} for stage in stages
    ) or len(stages) != len(set(stages)):
        raise HTTPException(400, "Nieprawidłowy etap opakowania.")

    metals_compliance = value.get("h", "u")
    if not isinstance(metals_compliance, str) or metals_compliance not in {"u", "c", "n"}:
        raise HTTPException(400, "Nieprawidłowy status zgodności metali ciężkich.")

    attachments = value.get("f", [])
    if not isinstance(attachments, list) or any(
        not isinstance(attachment, dict)
        or not isinstance(attachment.get("i"), str)
        or not re.fullmatch(r"[a-f0-9-]{36}", attachment["i"])
        or not isinstance(attachment.get("n"), str)
        or not attachment["n"].strip()
        or len(attachment["n"]) > 200
        or re.search(r"[\x00-\x1f\x7f]", attachment["n"])
        or type(attachment.get("z")) is not int
        or attachment["z"] < 0
        for attachment in attachments
    ):
        raise HTTPException(400, "Nieprawidłowa lista załączników PPWR.")
    if len({attachment["i"] for attachment in attachments}) != len(attachments):
        raise HTTPException(400, "Załącznik PDF występuje więcej niż raz.")

    def numeric_field(name: str) -> float | None:
        field_value = value.get(name)
        if field_value is None:
            return None
        try:
            finite = math.isfinite(field_value)
        except (OverflowError, TypeError):
            finite = False
        if (
            isinstance(field_value, bool)
            or not isinstance(field_value, (int, float))
            or not finite
            or field_value < 0
        ):
            raise HTTPException(400, f"Pole {name} musi być nieujemną liczbą albo null.")
        return field_value

    return {
        "t": packaging_type.strip(),
        "w": numeric_field("w"),
        "m": manufacturer.strip(),
        "s": stages,
        "h": metals_compliance,
    }


def validate_ppwr_database(value: object) -> dict:
    if not isinstance(value, dict) or not isinstance(value.get("items"), dict):
        raise HTTPException(
            400, "Nieprawidłowy format bazy PPWR: wymagany jest obiekt items."
        )
    items = {}
    for key, item in value["items"].items():
        normalized_key = item_key(key)
        if not normalized_key or normalized_key in items:
            raise HTTPException(
                400, "Nieprawidłowy lub powtórzony klucz ITEM w bazie PPWR."
            )
        items[normalized_key] = validate_ppwr_item(item)
    return {"items": items}


def reject_embedded_ppwr_documents(value: object) -> None:
    if not isinstance(value, dict) or not isinstance(value.get("items"), dict):
        return
    if any(
        isinstance(item, dict) and item.get("f")
        for item in value["items"].values()
    ):
        raise HTTPException(
            400,
            "PDF-y są teraz przechowywane w bibliotece dokumentów; przywróć pełny backup ZIP.",
        )


def remove_ppwr_item(key: str) -> None:
    ppwr_database = read_ppwr_database()
    item = ppwr_database["items"].pop(key, None)
    if item is not None:
        write_json_file(PPWR_DATABASE_FILE, ppwr_database)
        for attachment in item.get("f", []):
            attachment_id = attachment.get("i", "")
            if re.fullmatch(r"[a-f0-9-]{36}", attachment_id):
                (PPWR_FILES_DIR / f"{attachment_id}.pdf").unlink(missing_ok=True)


def rename_ppwr_item(old_key: str, new_key: str) -> None:
    ppwr_database = read_ppwr_database()
    if old_key in ppwr_database["items"]:
        ppwr_database["items"].setdefault(new_key, ppwr_database["items"][old_key])
        del ppwr_database["items"][old_key]
        write_json_file(PPWR_DATABASE_FILE, ppwr_database)


def list_backup_files() -> list[Path]:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    return sorted(
        (
            path
            for path in BACKUP_DIR.iterdir()
            if path.is_file() and POSTGRES_BACKUP_PATTERN.fullmatch(path.name)
        ),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )


def list_postgres_backup_files() -> list[Path]:
    return [
        path
        for path in list_backup_files()
        if POSTGRES_BACKUP_PATTERN.fullmatch(path.name)
    ]


def prune_backups() -> None:
    for path in BACKUP_DIR.iterdir():
        if path.is_file() and LEGACY_JSON_BACKUP_PATTERN.fullmatch(path.name):
            path.unlink()
    for path in list_postgres_backup_files()[BACKUP_KEEP:]:
        path.unlink()


def create_postgres_backup_or_503(automatic: bool = False) -> str:
    try:
        return create_postgres_backup(automatic=automatic)
    except (OSError, subprocess.SubprocessError, RuntimeError) as error:
        logger.exception("PostgreSQL backup failed.")
        raise HTTPException(
            503,
            "Nie udało się utworzyć kopii PostgreSQL.",
        ) from error


def create_postgres_backup(automatic: bool = False) -> str:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_type = "daily" if automatic else "manual"
    name = f"postgresql_{backup_type}_{timestamp}_{uuid.uuid4()}.dump"
    temporary = tempfile.NamedTemporaryFile(
        prefix=".postgresql_", suffix=".tmp", dir=BACKUP_DIR, delete=False
    )
    temporary_path = Path(temporary.name)
    temporary.close()
    os.chmod(temporary_path, 0o600)

    environment = os.environ.copy()
    command = [
        "pg_dump",
        "--no-password",
        "--format=custom",
        "--compress=9",
        "--host",
        os.environ.get("PGHOST", ""),
        "--port",
        os.environ.get("PGPORT", "5432"),
        "--username",
        os.environ.get("PGUSER", ""),
        "--dbname",
        os.environ.get("PGDATABASE", ""),
        "--file",
        str(temporary_path),
    ]
    try:
        subprocess.run(
            command,
            check=True,
            capture_output=True,
            timeout=3600,
            env=environment,
        )
        with temporary_path.open("r+b") as dump_file:
            os.fsync(dump_file.fileno())
        destination = BACKUP_DIR / name
        os.replace(temporary_path, destination)
        prune_backups()
        return name
    finally:
        temporary_path.unlink(missing_ok=True)


def ensure_daily_postgres_backup() -> str | None:
    with database_lock:
        today = datetime.now(timezone.utc).strftime("%Y%m%d")
        if any(
            path.name.startswith(f"postgresql_daily_{today}_")
            for path in list_postgres_backup_files()
        ):
            return None
        return create_postgres_backup(automatic=True)


def restore_backup_zip(data: bytes) -> dict:
    try:
        archive_file = zipfile.ZipFile(BytesIO(data))
    except (zipfile.BadZipFile, OSError) as error:
        raise HTTPException(400, "Nieprawidłowy plik ZIP.") from error

    with archive_file:
        entries = {}
        unpacked_size = 0
        for info in archive_file.infolist():
            if info.is_dir():
                continue
            name = info.filename
            if (
                name.startswith("/")
                or "\\" in name
                or any(part in {"", ".", ".."} for part in name.split("/"))
            ):
                raise HTTPException(400, "Archiwum ZIP zawiera nieprawidłową ścieżkę.")
            if name in entries:
                raise HTTPException(400, "Archiwum ZIP zawiera powtórzone pliki.")
            unpacked_size += info.file_size
            if unpacked_size > MAX_BACKUP_UNPACKED_BYTES:
                raise HTTPException(413, "Rozpakowany ZIP przekracza limit 300 MB.")
            if info.file_size > MAX_BACKUP_PDF_BYTES and name.startswith(("ppwr_files/", "documents/")):
                raise HTTPException(413, "Plik PDF w ZIP przekracza limit 20 MB.")
            entries[name] = info

        main_name = next(
            (name for name in ("rcd_material_db.json", "material_db.json") if name in entries),
            None,
        )
        ppwr_name = "ppwr_material_db.json" if "ppwr_material_db.json" in entries else None
        documents_name = "pdf_documents.json" if "pdf_documents.json" in entries else None
        links_name = "material_document_links.json" if "material_document_links.json" in entries else None
        legacy_pdf_names = {name for name in entries if re.fullmatch(r"ppwr_files/[a-f0-9-]{36}\.pdf", name)}
        pdf_names = {name for name in entries if re.fullmatch(r"documents/[a-f0-9-]{36}\.pdf", name)}
        allowed_names = {
            name for name in (main_name, ppwr_name, documents_name, links_name) if name is not None
        } | pdf_names | legacy_pdf_names
        if set(entries) != allowed_names or not allowed_names:
            raise HTTPException(400, "ZIP zawiera nieoczekiwane pliki.")
        if main_name is None and ppwr_name is None:
            raise HTTPException(400, "ZIP nie zawiera bazy JSON.")
        if (documents_name is None) != (links_name is None):
            raise HTTPException(400, "ZIP musi zawierać bazę dokumentów i plik powiązań razem.")
        if documents_name and legacy_pdf_names:
            raise HTTPException(400, "ZIP nie może mieszać nowej i starej struktury PDF.")

        try:
            main_database = (
                json.loads(archive_file.read(main_name)) if main_name else None
            )
            raw_ppwr_database = json.loads(archive_file.read(ppwr_name)) if ppwr_name else None
            ppwr_database = (
                validate_ppwr_database(raw_ppwr_database)
                if raw_ppwr_database is not None
                else None
            )
            if main_database is not None:
                get_items(main_database)
                normalize_material_keys(main_database)
                embedded_ppwr = main_database.get("ppwr")
                if ppwr_database is None and embedded_ppwr is not None:
                    raw_ppwr_database = embedded_ppwr
                    ppwr_database = validate_ppwr_database(raw_ppwr_database)
            document_database = (
                validate_document_database(json.loads(archive_file.read(documents_name)))
                if documents_name
                else None
            )
            document_links = (
                json.loads(archive_file.read(links_name)) if links_name else None
            )
            pdf_data = {
                name.split("/", 1)[1][:-4]: archive_file.read(name)
                for name in pdf_names | legacy_pdf_names
            }
        except (json.JSONDecodeError, UnicodeDecodeError, KeyError, zipfile.BadZipFile) as error:
            raise HTTPException(400, "Nieprawidłowy JSON w archiwum ZIP.") from error
        except ValueError as error:
            raise HTTPException(400, str(error)) from error

    if any(not pdf.startswith(b"%PDF-") for pdf in pdf_data.values()):
        raise HTTPException(400, "Plik w archiwum nie jest prawidłowym PDF-em.")
    if document_database is not None:
        if set(document_database["documents"]) != set(pdf_data):
            raise HTTPException(400, "PDF-y w ZIP nie zgadzają się z bazą dokumentów.")
        if any(
            document_database["documents"][document_id]["z"] != len(pdf)
            or document_database["documents"][document_id]["h"] != hashlib.sha256(pdf).hexdigest()
            for document_id, pdf in pdf_data.items()
        ):
            raise HTTPException(400, "Zawartość PDF nie zgadza się z metadanymi dokumentu.")

    with database_lock:
        current_database = read_database()
        current_ppwr = read_ppwr_database()
        current_documents, current_links = get_document_stores()
        target_items = (
            get_items(main_database)
            if main_database is not None
            else get_items(current_database)
        )
        if main_database is not None and any(
            not isinstance(item, dict) for item in target_items.values()
        ):
            raise HTTPException(400, "Baza materiałów w ZIP ma nieprawidłowy format.")
        if document_database is not None:
            document_links = validate_document_links(
                document_links, document_database["documents"], target_items
            )
        elif ppwr_database is not None:
            document_database = current_documents
            document_links = current_links
            legacy_pdf_map = {}
            expected_legacy_ids = set()
            for key, raw_item in (
                raw_ppwr_database.get("items", {}).items()
                if raw_ppwr_database
                else []
            ):
                for attachment in raw_item.get("f", []):
                    source_id = attachment["i"]
                    expected_legacy_ids.add(source_id)
                    pdf = pdf_data.get(source_id)
                    if pdf is None:
                        raise HTTPException(400, f"Brakuje PDF-a {attachment['n']} w ZIP-ie.")
                    digest = hashlib.sha256(pdf).hexdigest()
                    existing_id = next(
                        (
                            candidate_id
                            for candidate_id, metadata in document_database["documents"].items()
                            if metadata["h"] == digest
                        ),
                        None,
                    )
                    document_id = existing_id or source_id
                    if not existing_id:
                        document_database["documents"][document_id] = {
                            "n": attachment["n"],
                            "z": len(pdf),
                            "h": digest,
                        }
                    linked = document_links["items"].setdefault(item_key(key), [])
                    if document_id not in linked:
                        linked.append(document_id)
                    legacy_pdf_map[source_id] = document_id
            if expected_legacy_ids != set(pdf_data):
                raise HTTPException(400, "Stare pliki PDF w ZIP nie zgadzają się z załącznikami PPWR.")
            if legacy_pdf_map:
                pdf_data = {
                    legacy_pdf_map.get(document_id, document_id): content
                    for document_id, content in pdf_data.items()
                }
        elif main_database is not None:
            document_database = current_documents
            document_links = current_links

        if document_database is None:
            document_database = current_documents
            document_links = current_links
        document_links["items"] = {
            key: linked
            for key, ids in document_links["items"].items()
            if key in target_items and (linked := [entry for entry in ids if entry in document_database["documents"]])
        }
        if ppwr_database is not None:
            for key in ppwr_database["items"]:
                material = target_items.get(key)
                if material is None or not material.get("packing"):
                    raise HTTPException(
                        400,
                        f"ITEM {key} w PPWR nie jest materiałem opakowaniowym.",
                    )
        elif main_database is not None:
            ppwr_database = current_ppwr
            ppwr_database["items"] = {
                key: item
                for key, item in ppwr_database["items"].items()
                if key in target_items and target_items[key].get("packing")
            }
        items = {
            key: {
                field: field_value
                for field, field_value in item.items()
                if field not in REMOVED_ITEM_FIELDS
            }
            for key, item in target_items.items()
        }
        if main_database is not None:
            main_database = {
                **{
                    key: value
                    for key, value in main_database.items()
                    if key not in {"reach", "ppwr"}
                },
                "items": items,
                "n": len(items),
                "updated": utc_now(),
            }

        stage_dir = None
        replace_document_directory = documents_name is not None
        old_dir = DATA_DIR / f".documents_old_{uuid.uuid4()}"
        try:
            if replace_document_directory:
                stage_dir = DATA_DIR / f".documents_{uuid.uuid4()}"
                stage_dir.mkdir(parents=True)
                for attachment_id, pdf in pdf_data.items():
                    (stage_dir / f"{attachment_id}.pdf").write_bytes(pdf)
            if main_database is not None:
                create_postgres_backup_or_503()
            elif ppwr_database is not None:
                create_postgres_backup_or_503()
            if stage_dir is not None:
                if DOCUMENTS_DIR.exists():
                    DOCUMENTS_DIR.replace(old_dir)
                stage_dir.replace(DOCUMENTS_DIR)
            elif legacy_pdf_names:
                DOCUMENTS_DIR.mkdir(parents=True, exist_ok=True)
                for document_id, pdf in pdf_data.items():
                    destination = DOCUMENTS_DIR / f"{document_id}.pdf"
                    temporary = DOCUMENTS_DIR / f".{document_id}.restore.tmp"
                    temporary.write_bytes(pdf)
                    temporary.replace(destination)
            if main_database is not None:
                write_database(main_database)
            if ppwr_database is not None:
                write_json_file(PPWR_DATABASE_FILE, ppwr_database)
            write_json_file(DOCUMENTS_FILE, document_database)
            write_json_file(DOCUMENT_LINKS_FILE, document_links)
        except Exception:
            if old_dir.exists():
                if DOCUMENTS_DIR.exists():
                    for path in DOCUMENTS_DIR.iterdir():
                        path.unlink()
                    DOCUMENTS_DIR.rmdir()
                old_dir.replace(DOCUMENTS_DIR)
            raise
        finally:
            if stage_dir is not None and stage_dir.exists():
                for path in stage_dir.iterdir():
                    path.unlink()
                stage_dir.rmdir()
            if old_dir.exists():
                for path in old_dir.iterdir():
                    path.unlink()
                old_dir.rmdir()
        return get_meta(read_database())


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
    if storage.postgres_enabled():
        storage.check_health()
    return {"status": "ok"}


@app.get("/api/db")
def get_database() -> dict:
    with database_lock:
        return read_database()


@app.get("/api/items/page")
def get_material_page(
    page: int = Query(default=0, ge=0),
    page_size: int = Query(default=50, ge=1, le=100),
    query: str = Query(default="", max_length=200),
    filters: str = "{}",
    sort: str = "item",
    direction: str = "asc",
) -> dict:
    allowed_sorts = {"item", "description", "rohs", "reach", "date", "substances", "missing"}
    if sort not in allowed_sorts or direction not in {"asc", "desc"}:
        raise HTTPException(400, "Nieprawidłowe sortowanie bazy.")
    validated_filters = validate_material_filters(filters)
    with database_lock:
        all_items = filtered_material_items(read_database(), query, validated_filters)
    ordered = sorted(
        all_items.items(),
        key=lambda entry: (
            material_sort_value(entry[0], entry[1], sort),
            natural_sort_key(entry[0]),
        ),
        reverse=direction == "desc",
    )
    start = page * page_size
    selected = ordered[start:start + page_size]
    return {
        "items": dict(selected),
        "total": len(ordered),
        "page": page,
        "pageSize": page_size,
        "pages": max(1, (len(ordered) + page_size - 1) // page_size),
    }


@app.get("/api/items/by-key")
def get_material_by_key(key: str = Query(min_length=1, max_length=200)) -> dict:
    normalized_key = item_key(key)
    with database_lock:
        item = get_items(read_database()).get(normalized_key)
    if item is None:
        raise HTTPException(404, "Nie znaleziono rekordu.")
    return {"key": normalized_key, "item": item}


@app.post("/api/items/lookup")
async def lookup_material_records(request: Request) -> dict:
    body = await read_json_body(request)
    tokens = body.get("tokens") if isinstance(body, dict) else None
    if (
        not isinstance(tokens, list)
        or len(tokens) > 5000
        or any(not isinstance(token, str) or len(token) > 200 for token in tokens)
    ):
        raise HTTPException(400, "Nieprawidłowa lista ITEM do wyszukania.")
    with database_lock:
        items = lookup_materials(tokens, read_database())
    return {"items": items}


@app.get("/api/items/counts")
def get_material_counts() -> dict:
    counts = {}
    with database_lock:
        items = get_items(read_database())
    for item in items.values():
        if not isinstance(item, dict):
            continue
        for substance_id in item_object(item, "h"):
            counts[substance_id] = counts.get(substance_id, 0) + 1
        for missing in item_array(item, "u"):
            if missing in {"pfas", "pip"}:
                count_key = f"{missing}u"
                counts[count_key] = counts.get(count_key, 0) + 1
    return {"counts": counts}


@app.get("/api/items/suggestions")
def get_material_suggestions() -> dict:
    suppliers = {}
    rohs_values = {}
    with database_lock:
        items = get_items(read_database())
    for item in items.values():
        if not isinstance(item, dict):
            continue
        supplier = item.get("sup")
        rohs = item.get("r")
        if isinstance(supplier, str) and supplier:
            suppliers[supplier] = suppliers.get(supplier, 0) + 1
        if isinstance(rohs, str) and rohs:
            rohs_values[rohs] = rohs_values.get(rohs, 0) + 1
    return {
        "sup": sorted(suppliers, key=lambda value: (-suppliers[value], fold_search(value)))[:400],
        "r": sorted(rohs_values, key=lambda value: (-rohs_values[value], fold_search(value)))[:25],
    }


@app.get("/api/items/packing")
def get_packing_material_page(
    page: int = Query(default=0, ge=0),
    page_size: int = Query(default=25, ge=1, le=100),
    query: str = Query(default="", max_length=200),
    ppwr_filter: str = "all",
) -> dict:
    if ppwr_filter not in {"all", "with", "without"}:
        raise HTTPException(400, "Nieprawidłowy filtr PPWR.")
    with database_lock:
        database = read_database()
        ppwr = read_ppwr_database()
        documents, links = get_document_stores()
        items = get_items(database)
    ppwr_documents = {
        key
        for key, document_ids in links["items"].items()
        if any(
            documents["documents"].get(document_id, {}).get("type") == "PPWR"
            for document_id in document_ids
        )
    }
    search = fold_search(query.strip())
    matches = []
    for key, item in items.items():
        if not isinstance(item, dict) or not item.get("packing"):
            continue
        has_document = key in ppwr_documents
        if ppwr_filter == "with" and not has_document:
            continue
        if ppwr_filter == "without" and has_document:
            continue
        ppwr_item = ppwr["items"].get(key, {})
        haystack = fold_search(" ".join([
            key,
            str(item.get("i") or ""),
            str(item.get("d") or ""),
            str(item.get("sup") or ""),
            str(ppwr_item.get("m") or ""),
            str(ppwr_item.get("t") or ""),
        ]))
        if search and search not in haystack:
            continue
        matches.append((key, item))
    matches.sort(key=lambda entry: natural_sort_key(entry[0]))
    start = page * page_size
    selected = matches[start:start + page_size]
    manufacturers = sorted({
        item["sup"].strip()
        for item in items.values()
        if isinstance(item, dict)
        and isinstance(item.get("sup"), str)
        and item["sup"].strip()
    }, key=fold_search)
    return {
        "materials": dict(selected),
        "ppwr": {key: ppwr["items"][key] for key, _ in selected if key in ppwr["items"]},
        "manufacturers": manufacturers,
        "total": len(matches),
        "page": page,
        "pageSize": page_size,
        "pages": max(1, (len(matches) + page_size - 1) // page_size),
    }


@app.get("/api/ppwr")
def get_ppwr_database() -> dict:
    with database_lock:
        return read_ppwr_database()


@app.put("/api/ppwr/items/{key}")
@app.post("/api/ppwr/items/{key}")
async def update_ppwr_item(key: str, request: Request) -> dict:
    key = item_key(key)
    if not key:
        raise HTTPException(400, "Nieprawidłowy klucz ITEM.")
    body = await read_json_body(request)
    item = validate_ppwr_item(body)
    with database_lock:
        material_database = read_database()
        material = get_items(material_database).get(key)
        if material is None:
            raise HTTPException(404, "Nie znaleziono rekordu materiału.")
        if not material.get("packing"):
            raise HTTPException(
                409, "Rekord nie jest oznaczony jako materiał opakowaniowy."
            )
        database = read_ppwr_database()
        database["items"][key] = item
        write_json_file(PPWR_DATABASE_FILE, database)
        return {"key": key, "item": item}


@app.post("/api/ppwr/item")
async def update_ppwr_item_by_key(key: str, request: Request) -> dict:
    return await update_ppwr_item(key, request)


@app.post("/api/ppwr/items/{key}/files")
async def upload_ppwr_pdf(key: str, request: Request, filename: str = "") -> dict:
    result = await upload_document(request, filename)
    document = result["document"]
    link_document_to_material(key, document["i"])
    return {
        "key": item_key(key),
        "attachment": {"i": document["i"], "n": document["n"], "z": document["z"]},
        "shared": result["existing"],
    }


@app.post("/api/ppwr/items/{key}/files/{attachment_id}/link")
def link_ppwr_pdf(key: str, attachment_id: str) -> dict:
    result = link_document_to_material(key, attachment_id)
    document = result["document"]
    return {
        "key": result["key"],
        "attachment": {"i": document["i"], "n": document["n"], "z": document["z"]},
    }


@app.post("/api/ppwr/items/{key}/files/{attachment_id}/rename")
async def rename_ppwr_pdf(key: str, attachment_id: str, request: Request) -> dict:
    return await rename_document(attachment_id, request)


@app.post("/api/ppwr/items/{key}/files/{attachment_id}/delete")
def unlink_ppwr_pdf(key: str, attachment_id: str) -> dict:
    result = unlink_document_from_material(key, attachment_id)
    return {"key": result["key"]}


@app.get("/api/ppwr/items/{key}/files/{attachment_id}")
def download_ppwr_pdf(key: str, attachment_id: str) -> FileResponse:
    documents = get_material_documents(key)["documents"]
    if not any(document["i"] == attachment_id for document in documents):
        raise HTTPException(404, "Nie znaleziono załącznika.")
    return download_document(attachment_id)


@app.get("/api/documents")
def get_documents() -> dict:
    with database_lock:
        documents, links = get_document_stores()
        materials = get_items(read_database())
        linked_materials = {document_id: [] for document_id in documents["documents"]}
        for key, document_ids in links["items"].items():
            for document_id in document_ids:
                linked_materials[document_id].append(key)
        return {
            "documents": [
                {
                    "i": document_id,
                    **metadata,
                    "materials": linked_materials[document_id],
                    "materialDetails": {
                        key: {
                            "i": materials[key].get("i", key),
                            "d": materials[key].get("d", ""),
                            "sup": materials[key].get("sup", ""),
                        }
                        for key in linked_materials[document_id]
                        if key in materials
                    },
                }
                for document_id, metadata in documents["documents"].items()
            ]
        }


@app.get("/api/materials/{key}/documents")
def get_material_documents(key: str) -> dict:
    key = item_key(key)
    if not key:
        raise HTTPException(400, "Nieprawidłowy klucz ITEM.")
    with database_lock:
        documents, links = get_document_stores()
        if key not in get_items(read_database()):
            raise HTTPException(404, "Nie znaleziono rekordu materiału.")
        return {
            "documents": [
                {"i": document_id, **documents["documents"][document_id]}
                for document_id in links["items"].get(key, [])
            ]
        }


@app.get("/api/materials/documents")
def get_material_documents_by_key(key: str) -> dict:
    return get_material_documents(key)


@app.post("/api/documents")
async def upload_document(
    request: Request,
    filename: str = "",
    document_type: str = "",
    declaration_date: str = "",
) -> dict:
    document_type = validate_document_type(document_type, required=True)
    declaration_date = validate_document_date(declaration_date)
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "application/pdf":
        raise HTTPException(415, "Dozwolone są wyłącznie pliki PDF.")
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_PDF_UPLOAD_BYTES:
        raise HTTPException(413, "Plik PDF przekracza limit 5 MB.")
    content = await request.body()
    if len(content) > MAX_PDF_UPLOAD_BYTES:
        raise HTTPException(413, "Plik PDF przekracza limit 5 MB.")
    if not content.startswith(b"%PDF-"):
        raise HTTPException(400, "Plik nie ma prawidłowego nagłówka PDF.")
    name = Path(filename.replace("\\", "/")).name.strip()
    name = re.sub(r"[\x00-\x1f\x7f]", "", name)
    if (
        not name
        or name.lower() == ".pdf"
        or len(name) > 200
        or not name.lower().endswith(".pdf")
    ):
        raise HTTPException(400, "Podaj prawidłową nazwę pliku PDF.")

    with database_lock:
        documents, _ = get_document_stores()
        digest = hashlib.sha256(content).hexdigest()
        for document_id, metadata in documents["documents"].items():
            path = DOCUMENTS_DIR / f"{document_id}.pdf"
            if metadata["h"] == digest and path.is_file():
                stored_name = document_name_with_timestamp(
                    name, split_document_name(metadata["n"])[1]
                )
                if (
                    metadata["n"] != stored_name
                    or metadata["type"] != document_type
                    or metadata["dt"] != declaration_date
                ):
                    metadata["n"] = stored_name
                    metadata["type"] = document_type
                    metadata["dt"] = declaration_date
                    write_json_file(DOCUMENTS_FILE, documents)
                return {"document": {"i": document_id, **metadata}, "existing": True}

        document_id = str(uuid.uuid4())
        DOCUMENTS_DIR.mkdir(parents=True, exist_ok=True)
        file_path = DOCUMENTS_DIR / f"{document_id}.pdf"
        temporary_file = DOCUMENTS_DIR / f".{document_id}.tmp"
        try:
            with temporary_file.open("xb") as file:
                file.write(content)
                file.flush()
                os.fsync(file.fileno())
            temporary_file.replace(file_path)
            documents["documents"][document_id] = {
                "n": document_name_with_timestamp(name),
                "z": len(content),
                "h": digest,
                "type": document_type,
                "dt": declaration_date,
            }
            write_json_file(DOCUMENTS_FILE, documents)
        except Exception:
            file_path.unlink(missing_ok=True)
            raise
        finally:
            temporary_file.unlink(missing_ok=True)
        return {
            "document": {"i": document_id, **documents["documents"][document_id]},
            "existing": False,
        }


@app.post("/api/documents/{document_id}/metadata")
async def update_document_metadata(document_id: str, request: Request) -> dict:
    if not re.fullmatch(r"[a-f0-9-]{36}", document_id):
        raise HTTPException(400, "Nieprawidłowy identyfikator dokumentu.")
    body = await read_json_body(request)
    if (
        not isinstance(body, dict)
        or not isinstance(body.get("name"), str)
        or "type" not in body
        or "dt" not in body
    ):
        raise HTTPException(400, "Podaj nazwę, typ i datę deklaracji.")
    name = Path(body["name"].replace("\\", "/")).name.strip()
    name = re.sub(r"[\x00-\x1f\x7f]", "", name)
    if (
        not name
        or name.lower() == ".pdf"
        or len(name) > 200
        or not name.lower().endswith(".pdf")
    ):
        raise HTTPException(400, "Podaj prawidłową nazwę pliku PDF.")
    document_type = validate_document_type(body["type"], required=True)
    declaration_date = validate_document_date(body["dt"])
    with database_lock:
        documents, _ = get_document_stores()
        metadata = documents["documents"].get(document_id)
        if metadata is None or not (DOCUMENTS_DIR / f"{document_id}.pdf").is_file():
            raise HTTPException(404, "Nie znaleziono dokumentu PDF.")
        _, timestamp = split_document_name(metadata["n"])
        stored_name = document_name_with_timestamp(name, timestamp)
        if (
            metadata["n"] != stored_name
            or metadata["type"] != document_type
            or metadata["dt"] != declaration_date
        ):
            metadata["n"] = stored_name
            metadata["type"] = document_type
            metadata["dt"] = declaration_date
            write_json_file(DOCUMENTS_FILE, documents)
        return {"document": {"i": document_id, **metadata}}


@app.post("/api/documents/{document_id}/type")
async def update_document_type(document_id: str, request: Request) -> dict:
    if not re.fullmatch(r"[a-f0-9-]{36}", document_id):
        raise HTTPException(400, "Nieprawidłowy identyfikator dokumentu.")
    body = await read_json_body(request)
    if not isinstance(body, dict) or "type" not in body:
        raise HTTPException(400, "Podaj typ dokumentu.")
    document_type = validate_document_type(body["type"])
    with database_lock:
        documents, _ = get_document_stores()
        metadata = documents["documents"].get(document_id)
        if metadata is None or not (DOCUMENTS_DIR / f"{document_id}.pdf").is_file():
            raise HTTPException(404, "Nie znaleziono dokumentu PDF.")
        if metadata["type"] != document_type:
            metadata["type"] = document_type
            write_json_file(DOCUMENTS_FILE, documents)
        return {"document": {"i": document_id, **metadata}}


@app.post("/api/materials/{key}/documents/{document_id}/link")
def link_document_to_material(key: str, document_id: str) -> dict:
    key = item_key(key)
    if not key or not re.fullmatch(r"[a-f0-9-]{36}", document_id):
        raise HTTPException(400, "Nieprawidłowy materiał lub dokument.")
    with database_lock:
        materials = get_items(read_database())
        if key not in materials:
            raise HTTPException(404, "Nie znaleziono rekordu materiału.")
        documents, links = get_document_stores()
        file_path = DOCUMENTS_DIR / f"{document_id}.pdf"
        if document_id not in documents["documents"] or not file_path.is_file():
            raise HTTPException(404, "Nie znaleziono dokumentu PDF.")
        material_links = links["items"].setdefault(key, [])
        if document_id not in material_links:
            material_links.append(document_id)
            write_json_file(DOCUMENT_LINKS_FILE, links)
        return {"key": key, "document": {"i": document_id, **documents["documents"][document_id]}}


@app.post("/api/materials/documents/{document_id}/link")
def link_document_to_material_by_key(document_id: str, key: str) -> dict:
    return link_document_to_material(key, document_id)


@app.post("/api/materials/{key}/documents/{document_id}/unlink")
def unlink_document_from_material(key: str, document_id: str) -> dict:
    key = item_key(key)
    if not key or not re.fullmatch(r"[a-f0-9-]{36}", document_id):
        raise HTTPException(400, "Nieprawidłowy materiał lub dokument.")
    with database_lock:
        documents, links = get_document_stores()
        material_links = links["items"].get(key)
        if not material_links or document_id not in material_links:
            raise HTTPException(404, "Dokument nie jest powiązany z tym materiałem.")
        material_links.remove(document_id)
        if not material_links:
            del links["items"][key]
        write_json_file(DOCUMENT_LINKS_FILE, links)
        return {"key": key, "documents": material_links}


@app.post("/api/materials/documents/{document_id}/unlink")
def unlink_document_from_material_by_key(document_id: str, key: str) -> dict:
    return unlink_document_from_material(key, document_id)


@app.post("/api/documents/{document_id}/rename")
async def rename_document(document_id: str, request: Request) -> dict:
    if not re.fullmatch(r"[a-f0-9-]{36}", document_id):
        raise HTTPException(400, "Nieprawidłowy identyfikator dokumentu.")
    body = await read_json_body(request)
    if not isinstance(body, dict) or not isinstance(body.get("name"), str):
        raise HTTPException(400, "Podaj nową nazwę dokumentu.")
    name = Path(body["name"].replace("\\", "/")).name.strip()
    name = re.sub(r"[\x00-\x1f\x7f]", "", name)
    if (
        not name
        or name.lower() == ".pdf"
        or len(name) > 200
        or not name.lower().endswith(".pdf")
    ):
        raise HTTPException(400, "Nazwa dokumentu musi kończyć się rozszerzeniem .pdf.")
    with database_lock:
        documents, _ = get_document_stores()
        metadata = documents["documents"].get(document_id)
        if metadata is None or not (DOCUMENTS_DIR / f"{document_id}.pdf").is_file():
            raise HTTPException(404, "Nie znaleziono dokumentu PDF.")
        _, timestamp = split_document_name(metadata["n"])
        stored_name = document_name_with_timestamp(name, timestamp) if timestamp else name
        if metadata["n"] != stored_name:
            metadata["n"] = stored_name
            write_json_file(DOCUMENTS_FILE, documents)
        return {"document": {"i": document_id, **metadata}}


@app.post("/api/documents/{document_id}/delete")
def delete_document(document_id: str) -> dict:
    if not re.fullmatch(r"[a-f0-9-]{36}", document_id):
        raise HTTPException(400, "Nieprawidłowy identyfikator dokumentu.")
    with database_lock:
        documents, links = get_document_stores()
        if document_id not in documents["documents"]:
            raise HTTPException(404, "Nie znaleziono dokumentu PDF.")

        del documents["documents"][document_id]
        links["items"] = {
            key: linked
            for key, ids in links["items"].items()
            if (linked := [entry for entry in ids if entry != document_id])
        }
        write_json_file(DOCUMENT_LINKS_FILE, links)
        write_json_file(DOCUMENTS_FILE, documents)
        (DOCUMENTS_DIR / f"{document_id}.pdf").unlink(missing_ok=True)
        return {"deleted": document_id}


@app.get("/api/documents/{document_id}/file")
def download_document(document_id: str) -> FileResponse:
    if not re.fullmatch(r"[a-f0-9-]{36}", document_id):
        raise HTTPException(400, "Nieprawidłowy identyfikator dokumentu.")
    with database_lock:
        documents, _ = get_document_stores()
        metadata = documents["documents"].get(document_id)
        file_path = DOCUMENTS_DIR / f"{document_id}.pdf"
        if metadata is None or not file_path.is_file():
            raise HTTPException(404, "Nie znaleziono dokumentu PDF.")
        return FileResponse(
            file_path,
            media_type="application/pdf",
            filename=metadata["n"],
            content_disposition_type="inline",
        )


@app.get("/api/meta")
def get_database_meta() -> dict:
    with database_lock:
        return get_meta(read_database())


@app.post("/api/db/import-zip")
async def import_backup_zip(request: Request) -> dict:
    if request.headers.get("content-type", "").split(";", 1)[0].lower() not in {
        "application/zip",
        "application/x-zip-compressed",
        "application/octet-stream",
    }:
        raise HTTPException(415, "Wymagany jest plik ZIP.")
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_BACKUP_ZIP_BYTES:
        raise HTTPException(413, "ZIP przekracza limit 100 MB.")
    body = await request.body()
    if len(body) > MAX_BACKUP_ZIP_BYTES:
        raise HTTPException(413, "ZIP przekracza limit 100 MB.")
    meta = restore_backup_zip(body)
    return {"meta": meta}


@app.post("/api/db/import-preview")
async def preview_database_import(request: Request) -> dict:
    body = await read_json_body(request)
    if not isinstance(body, dict) or not isinstance(body.get("items"), dict):
        raise HTTPException(400, "Nieprawidłowy format bazy: wymagany jest obiekt items.")
    if any(not isinstance(item, dict) for item in body["items"].values()):
        raise HTTPException(400, "Rekord w bazie ma nieprawidłowy format.")
    imported = {"items": body["items"]}
    try:
        normalize_material_keys(imported)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    with database_lock:
        current = get_items(read_database())
    manual = {
        key: item
        for key, item in current.items()
        if isinstance(item, dict) and item.get("mod")
    }
    if body.get("keepManual") is True:
        imported["items"].update(manual)
    current_keys = set(current)
    imported_keys = set(imported["items"])
    return {
        "manualCount": len(manual),
        "added": len(imported_keys - current_keys),
        "removed": len(current_keys - imported_keys),
        "count": len(imported_keys),
    }


@app.post("/api/ppwr")
async def replace_ppwr_database(request: Request) -> dict:
    body = await read_json_body(request)
    reject_embedded_ppwr_documents(body)
    database = validate_ppwr_database(body)
    with database_lock:
        materials = get_items(read_database())
        for key in database["items"]:
            material = materials.get(key)
            if material is None or not material.get("packing"):
                raise HTTPException(
                    400, f"ITEM {key} w PPWR nie jest materiałem opakowaniowym."
                )
        create_postgres_backup_or_503()
        write_json_file(PPWR_DATABASE_FILE, database)
        return {"items": len(database["items"])}


@app.get("/api/backups")
def get_backups() -> list[dict]:
    with database_lock:
        return [
            {
                "name": path.name,
                "size": path.stat().st_size,
                "type": "postgresql",
                "format": "custom",
                "mtime": datetime.fromtimestamp(
                    path.stat().st_mtime, timezone.utc
                ).isoformat(),
            }
            for path in list_backup_files()
        ]


@app.post("/api/backups/postgresql", status_code=201)
def post_postgres_backup() -> dict:
    with database_lock:
        return {"name": create_postgres_backup_or_503()}


@app.get("/api/backups/{name}")
def download_backup(name: str) -> FileResponse:
    if Path(name).name != name or not POSTGRES_BACKUP_PATTERN.fullmatch(name):
        raise HTTPException(400, "Nieprawidłowa nazwa kopii.")
    path = BACKUP_DIR / name
    if not path.is_file():
        raise HTTPException(404, "Nie znaleziono kopii zapasowej.")
    return FileResponse(path, media_type="application/octet-stream", filename=path.name)


@app.post("/api/backups/{name}/delete")
def delete_backup(name: str) -> dict:
    if Path(name).name != name or not POSTGRES_BACKUP_PATTERN.fullmatch(name):
        raise HTTPException(400, "Nieprawidłowa nazwa kopii.")
    with database_lock:
        path = BACKUP_DIR / name
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
        saved_item = {
            **item,
            "mod": utc_now(),
            "updatedBy": request.state.username,
        }
        items[key] = saved_item
        database["updated"] = utc_now()
        database["n"] = len(items)
        write_database(database)
        return {"key": key, "item": saved_item, "meta": get_meta(database)}


@app.put("/api/items/{key}")
@app.post("/api/items/{key}")
async def update_item(key: str, request: Request) -> dict:
    key = item_key(key)
    if not key:
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
        saved_item = {
            **item,
            "mod": utc_now(),
            "updatedBy": request.state.username,
        }
        del items[key]
        items[new_key] = saved_item
        database["updated"] = utc_now()
        database["n"] = len(items)
        write_database(database)
        if new_key != key:
            rename_ppwr_item(key, new_key)
            document_links = _read_document_links()
            if key in document_links["items"]:
                existing_links = document_links["items"].get(new_key, [])
                for document_id in document_links["items"][key]:
                    if document_id not in existing_links:
                        existing_links.append(document_id)
                if existing_links:
                    document_links["items"][new_key] = existing_links
                del document_links["items"][key]
                write_json_file(DOCUMENT_LINKS_FILE, document_links)
        if not saved_item.get("packing"):
            remove_ppwr_item(new_key)
        return {
            "key": new_key,
            "oldKey": key,
            "item": saved_item,
            "meta": get_meta(database),
        }


@app.post("/api/items/by-key/update")
async def update_item_by_key(key: str, request: Request) -> dict:
    return await update_item(key, request)


@app.delete("/api/items/{key}")
@app.post("/api/items/{key}/delete")
def delete_item(key: str) -> dict:
    key = item_key(key)
    if not key:
        raise HTTPException(400, "Nieprawidłowy klucz ITEM.")
    with database_lock:
        database = read_database()
        items = get_items(database)
        if key not in items:
            raise HTTPException(404, "Nie znaleziono rekordu.")
        del items[key]
        database["updated"] = utc_now()
        database["n"] = len(items)
        write_database(database)
        remove_ppwr_item(key)
        document_links = _read_document_links()
        if document_links["items"].pop(key, None) is not None:
            write_json_file(DOCUMENT_LINKS_FILE, document_links)
        return {"meta": get_meta(database)}


@app.post("/api/items/by-key/delete")
def delete_item_by_key(key: str) -> dict:
    return delete_item(key)


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
        previous_ppwr = read_ppwr_database()
        if "ppwr" in body:
            reject_embedded_ppwr_documents(body["ppwr"])
        ppwr_database = validate_ppwr_database(body["ppwr"]) if "ppwr" in body else None
        if any(not isinstance(item, dict) for item in body["items"].values()):
            raise HTTPException(400, "Rekord w bazie ma nieprawidłowy format.")
        imported_database = {"items": body["items"]}
        try:
            normalize_material_keys(imported_database)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        items = {
            key: {
                field: value
                for field, value in item.items()
                if field not in REMOVED_ITEM_FIELDS
            }
            for key, item in imported_database["items"].items()
        }
        if body.get("keepManual") is True:
            items.update({
                key: item
                for key, item in get_items(previous_database).items()
                if isinstance(item, dict) and item.get("mod")
            })
        ppwr_database = ppwr_database or previous_ppwr
        if "ppwr" in body:
            for key in ppwr_database["items"]:
                material = items.get(key)
                if material is None or not material.get("packing"):
                    raise HTTPException(
                        400, f"ITEM {key} w PPWR nie jest materiałem opakowaniowym."
                    )
        ppwr_database["items"] = {
            key: ppwr_item
            for key, ppwr_item in ppwr_database["items"].items()
            if key in items and items[key].get("packing")
        }
        document_links = _read_document_links()
        document_links["items"] = {
            key: linked
            for key, document_ids in document_links["items"].items()
            if key in items and (linked := list(document_ids))
        }
        database = {
            **{
                key: value
                for key, value in body.items()
                if key not in {"reach", "ppwr", "keepManual"}
            },
            "items": items,
            "n": len(items),
            "updated": utc_now(),
        }
        backup_name = create_postgres_backup_or_503()
        write_database(database)
        write_json_file(PPWR_DATABASE_FILE, ppwr_database)
        write_json_file(DOCUMENT_LINKS_FILE, document_links)
        return {"meta": get_meta(database), "backup": backup_name}


@app.post("/api/db/clear")
def clear_database() -> dict:
    with database_lock:
        previous_database = read_database()
        read_ppwr_database()
        backup_name = create_postgres_backup_or_503()
        database = {
            **previous_database,
            "items": {},
            "n": 0,
            "updated": utc_now(),
        }
        write_database(database)
        write_json_file(PPWR_DATABASE_FILE, {"items": {}})
        write_json_file(DOCUMENT_LINKS_FILE, {"items": {}})
        return {"meta": get_meta(database), "backup": backup_name}
