import hashlib
import json
import math
import os
import re
import threading
import tempfile
import uuid
import zipfile
from io import BytesIO
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

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
MAX_PPWR_PDF_BYTES = 20 * 1024 * 1024
MAX_BACKUP_ZIP_BYTES = 100 * 1024 * 1024
MAX_BACKUP_UNPACKED_BYTES = 300 * 1024 * 1024
PPWR_FILES_DIR = DATA_DIR / "ppwr_files"
DOCUMENTS_FILE = DATA_DIR / "pdf_documents.json"
DOCUMENT_LINKS_FILE = DATA_DIR / "material_document_links.json"
DOCUMENTS_DIR = DATA_DIR / "documents"
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
    write_json_file(DATABASE_FILE, database)


def write_json_file(path: Path, database: dict) -> None:
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


def read_ppwr_database() -> dict:
    ensure_legacy_pdf_migration()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if PPWR_DATABASE_FILE.exists():
        with PPWR_DATABASE_FILE.open(encoding="utf-8") as file:
            database = json.load(file)
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
    if not DOCUMENTS_FILE.exists():
        return {"documents": {}}
    with DOCUMENTS_FILE.open(encoding="utf-8") as file:
        database = json.load(file)
    if not isinstance(database, dict) or not isinstance(database.get("documents"), dict):
        raise ValueError("Nieprawidłowa baza dokumentów PDF.")
    return database


def _read_document_links() -> dict:
    if not DOCUMENT_LINKS_FILE.exists():
        return {"items": {}}
    with DOCUMENT_LINKS_FILE.open(encoding="utf-8") as file:
        links = json.load(file)
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
            or len(document["n"]) > 200
            or re.search(r"[\x00-\x1f\x7f]", document["n"])
            or type(document.get("z")) is not int
            or document["z"] < 0
            or not isinstance(document.get("h"), str)
            or not re.fullmatch(r"[a-f0-9]{64}", document["h"])
        ):
            raise HTTPException(400, f"Nieprawidłowe metadane dokumentu {document_id}.")
        documents[document_id] = {
            "n": document["n"].strip(),
            "z": document["z"],
            "h": document["h"],
        }
    return {"documents": documents}


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
    if not PPWR_DATABASE_FILE.exists():
        return
    try:
        with PPWR_DATABASE_FILE.open(encoding="utf-8") as file:
            raw_ppwr = json.load(file)
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
        json.dump(
            {**database, "ppwr": read_ppwr_database()},
            file,
            ensure_ascii=False,
            separators=(",", ":"),
        )
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


def backup_zip_path() -> Path:
    temporary = tempfile.NamedTemporaryFile(
        prefix="material_backup_", suffix=".zip", delete=False
    )
    temporary_path = Path(temporary.name)
    temporary.close()
    try:
        with zipfile.ZipFile(
            temporary_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6
        ) as archive:
            archive.writestr(
                "rcd_material_db.json",
                json.dumps(read_database(), ensure_ascii=False, separators=(",", ":")),
            )
            archive.writestr(
                "ppwr_material_db.json",
                json.dumps(read_ppwr_database(), ensure_ascii=False, separators=(",", ":")),
            )
            documents, links = get_document_stores()
            archive.writestr(
                "pdf_documents.json",
                json.dumps(documents, ensure_ascii=False, separators=(",", ":")),
            )
            archive.writestr(
                "material_document_links.json",
                json.dumps(links, ensure_ascii=False, separators=(",", ":")),
            )
            for document_id, metadata in documents["documents"].items():
                pdf_path = DOCUMENTS_DIR / f"{document_id}.pdf"
                if not pdf_path.is_file():
                    raise HTTPException(500, f"Nie znaleziono pliku PDF: {metadata['n']}.")
                archive.write(pdf_path, f"documents/{document_id}.pdf")
        return temporary_path
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


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
            if info.file_size > MAX_PPWR_PDF_BYTES and name.startswith(("ppwr_files/", "documents/")):
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
                backup_before_change(current_database, force=True)
            elif ppwr_database is not None:
                backup_before_change(current_database, force=True)
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
    return {"status": "ok"}


@app.get("/api/db")
def get_database() -> dict:
    with database_lock:
        return read_database()


@app.get("/api/ppwr")
def get_ppwr_database() -> dict:
    with database_lock:
        return read_ppwr_database()


@app.put("/api/ppwr/items/{key}")
@app.post("/api/ppwr/items/{key}")
async def update_ppwr_item(key: str, request: Request) -> dict:
    key = item_key(key)
    if not key or "/" in key:
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
        backup_before_change(material_database)
        database = read_ppwr_database()
        database["items"][key] = item
        write_json_file(PPWR_DATABASE_FILE, database)
        return {"key": key, "item": item}


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
        linked_materials = {document_id: [] for document_id in documents["documents"]}
        for key, document_ids in links["items"].items():
            for document_id in document_ids:
                linked_materials[document_id].append(key)
        return {
            "documents": [
                {"i": document_id, **metadata, "materials": linked_materials[document_id]}
                for document_id, metadata in documents["documents"].items()
            ]
        }


@app.get("/api/backup/documents")
def download_document_database() -> JSONResponse:
    with database_lock:
        documents, _ = get_document_stores()
        return JSONResponse(
            content=documents,
            headers={"Content-Disposition": 'attachment; filename="pdf_documents.json"'},
        )


@app.get("/api/backup/document-links")
def download_document_links() -> JSONResponse:
    with database_lock:
        _, links = get_document_stores()
        return JSONResponse(
            content=links,
            headers={"Content-Disposition": 'attachment; filename="material_document_links.json"'},
        )


@app.get("/api/materials/{key}/documents")
def get_material_documents(key: str) -> dict:
    key = item_key(key)
    if not key or "/" in key:
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


@app.post("/api/documents")
async def upload_document(request: Request, filename: str = "") -> dict:
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "application/pdf":
        raise HTTPException(415, "Dozwolone są wyłącznie pliki PDF.")
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_PPWR_PDF_BYTES:
        raise HTTPException(413, "Plik PDF przekracza limit 20 MB.")
    content = await request.body()
    if len(content) > MAX_PPWR_PDF_BYTES:
        raise HTTPException(413, "Plik PDF przekracza limit 20 MB.")
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
                "n": name,
                "z": len(content),
                "h": digest,
            }
            backup_before_change(read_database())
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


@app.post("/api/materials/{key}/documents/{document_id}/link")
def link_document_to_material(key: str, document_id: str) -> dict:
    key = item_key(key)
    if not key or "/" in key or not re.fullmatch(r"[a-f0-9-]{36}", document_id):
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
            backup_before_change(read_database())
            material_links.append(document_id)
            write_json_file(DOCUMENT_LINKS_FILE, links)
        return {"key": key, "document": {"i": document_id, **documents["documents"][document_id]}}


@app.post("/api/materials/{key}/documents/{document_id}/unlink")
def unlink_document_from_material(key: str, document_id: str) -> dict:
    key = item_key(key)
    if not key or "/" in key or not re.fullmatch(r"[a-f0-9-]{36}", document_id):
        raise HTTPException(400, "Nieprawidłowy materiał lub dokument.")
    with database_lock:
        documents, links = get_document_stores()
        material_links = links["items"].get(key)
        if not material_links or document_id not in material_links:
            raise HTTPException(404, "Dokument nie jest powiązany z tym materiałem.")
        backup_before_change(read_database())
        material_links.remove(document_id)
        if not material_links:
            del links["items"][key]
        write_json_file(DOCUMENT_LINKS_FILE, links)
        return {"key": key, "documents": material_links}


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
        if metadata["n"] != name:
            backup_before_change(read_database())
            metadata["n"] = name
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
        backup_before_change(read_database())
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


@app.get("/api/backup")
def download_current_backup() -> JSONResponse:
    with database_lock:
        database = read_database()
        return JSONResponse(
            content={**database, "ppwr": read_ppwr_database()},
            headers={"Content-Disposition": 'attachment; filename="material_db.json"'},
        )


@app.get("/api/backup/materials")
def download_materials_json() -> JSONResponse:
    with database_lock:
        return JSONResponse(
            content=read_database(),
            headers={
                "Content-Disposition": 'attachment; filename="rcd_material_db.json"'
            },
        )


@app.get("/api/backup/ppwr")
def download_ppwr_json() -> JSONResponse:
    with database_lock:
        return JSONResponse(
            content=read_ppwr_database(),
            headers={
                "Content-Disposition": 'attachment; filename="ppwr_material_db.json"'
            },
        )


@app.get("/api/backup.zip")
def download_backup_zip() -> FileResponse:
    with database_lock:
        zip_path = backup_zip_path()
    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename="compliance_backup.zip",
        background=BackgroundTask(zip_path.unlink, missing_ok=True),
    )


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
        backup_before_change(read_database(), force=True)
        write_json_file(PPWR_DATABASE_FILE, database)
        return {"items": len(database["items"])}


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
        remove_ppwr_item(key)
        document_links = _read_document_links()
        if document_links["items"].pop(key, None) is not None:
            write_json_file(DOCUMENT_LINKS_FILE, document_links)
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
        previous_ppwr = read_ppwr_database()
        if "ppwr" in body:
            reject_embedded_ppwr_documents(body["ppwr"])
        ppwr_database = validate_ppwr_database(body["ppwr"]) if "ppwr" in body else None
        if any(not isinstance(item, dict) for item in body["items"].values()):
            raise HTTPException(400, "Rekord w bazie ma nieprawidłowy format.")
        items = {
            key: {
                field: value
                for field, value in item.items()
                if field not in REMOVED_ITEM_FIELDS
            }
            for key, item in body["items"].items()
        }
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
            **{key: value for key, value in body.items() if key not in {"reach", "ppwr"}},
            "items": items,
            "n": len(items),
            "updated": utc_now(),
        }
        backup_name = backup_before_change(previous_database, force=True)
        write_database(database)
        write_json_file(PPWR_DATABASE_FILE, ppwr_database)
        write_json_file(DOCUMENT_LINKS_FILE, document_links)
        return {"meta": get_meta(database), "backup": backup_name}


@app.post("/api/db/clear")
def clear_database() -> dict:
    with database_lock:
        previous_database = read_database()
        read_ppwr_database()
        backup_name = backup_before_change(previous_database, force=True)
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
