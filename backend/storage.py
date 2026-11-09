import json
import os
from pathlib import Path


JSON_DOCUMENTS = (
    "rcd_material_db.json",
    "ppwr_material_db.json",
    "pdf_documents.json",
    "material_document_links.json",
)


class StorageNotConfigured(RuntimeError):
    pass


def postgres_enabled() -> bool:
    return bool(os.environ.get("PGHOST"))


def _connect():
    if not postgres_enabled():
        raise StorageNotConfigured("PostgreSQL is not configured.")

    import psycopg

    return psycopg.connect(
        host=os.environ["PGHOST"],
        port=os.environ.get("PGPORT", "5432"),
        dbname=os.environ.get("PGDATABASE", "compliance"),
        user=os.environ.get("PGUSER", "compliance"),
        password=os.environ.get("PGPASSWORD", ""),
    )


def initialize(
    data_dir: Path,
    seed_file: Path,
    bootstrap_username: str | None,
    bootstrap_password_hash: str | None,
) -> None:
    statements = (
        """
        CREATE TABLE IF NOT EXISTS app_json (
            name TEXT PRIMARY KEY,
            payload JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS app_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS app_users (
            username TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS app_sessions (
            token_hash TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            expires_at TIMESTAMPTZ NOT NULL
        )
        """,
        """
        ALTER TABLE app_sessions
        DROP CONSTRAINT IF EXISTS app_sessions_username_fkey
        """,
        """
        CREATE INDEX IF NOT EXISTS app_sessions_expires_at_idx
        ON app_sessions (expires_at)
        """,
        """
        CREATE TABLE IF NOT EXISTS app_audit_log (
            id BIGSERIAL PRIMARY KEY,
            occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            username TEXT,
            method TEXT NOT NULL,
            action TEXT NOT NULL,
            status_code INTEGER NOT NULL,
            client_ip TEXT
        )
        """,
        """
        CREATE INDEX IF NOT EXISTS app_audit_log_occurred_at_idx
        ON app_audit_log (occurred_at DESC)
        """,
    )

    with _connect() as connection:
        for statement in statements:
            connection.execute(statement)

        migration = connection.execute(
            "SELECT value FROM app_metadata WHERE key = %s",
            ("legacy_json_migrated",),
        ).fetchone()
        if migration is None:
            for name in JSON_DOCUMENTS:
                path = data_dir / name
                if path.is_file():
                    with path.open(encoding="utf-8") as file:
                        payload = json.load(file)
                    _write_json(connection, name, payload, only_if_missing=True)

            if _read_json(connection, "rcd_material_db.json") is None:
                with seed_file.open(encoding="utf-8") as file:
                    _write_json(
                        connection, "rcd_material_db.json", json.load(file)
                    )

            connection.execute(
                """
                INSERT INTO app_metadata (key, value)
                VALUES (%s, %s)
                ON CONFLICT (key) DO NOTHING
                """,
                ("legacy_json_migrated", "true"),
            )

        user_count = connection.execute(
            "SELECT count(*) FROM app_users"
        ).fetchone()[0]
        if user_count == 0:
            if not bootstrap_username or not bootstrap_password_hash:
                raise RuntimeError(
                    "Set BOOTSTRAP_ADMIN_USERNAME and "
                    "BOOTSTRAP_ADMIN_PASSWORD before first startup."
                )
            connection.execute(
                """
                INSERT INTO app_users (username, password_hash)
                VALUES (%s, %s)
                """,
                (bootstrap_username, bootstrap_password_hash),
            )

        connection.execute(
            "DELETE FROM app_sessions WHERE expires_at <= now()"
        )


def _read_json(connection, name: str):
    row = connection.execute(
        "SELECT payload FROM app_json WHERE name = %s", (name,)
    ).fetchone()
    return row[0] if row else None


def read_json(name: str):
    with _connect() as connection:
        return _read_json(connection, name)


def check_health() -> None:
    with _connect() as connection:
        connection.execute("SELECT 1")


def _write_json(connection, name: str, payload: dict, only_if_missing=False) -> None:
    from psycopg.types.json import Jsonb

    if only_if_missing:
        connection.execute(
            """
            INSERT INTO app_json (name, payload)
            VALUES (%s, %s)
            ON CONFLICT (name) DO NOTHING
            """,
            (name, Jsonb(payload)),
        )
        return
    connection.execute(
        """
        INSERT INTO app_json (name, payload, updated_at)
        VALUES (%s, %s, now())
        ON CONFLICT (name) DO UPDATE
        SET payload = EXCLUDED.payload, updated_at = now()
        """,
        (name, Jsonb(payload)),
    )


def write_json(name: str, payload: dict) -> None:
    with _connect() as connection:
        _write_json(connection, name, payload)


def create_session(token_hash: str, username: str, expires_at) -> None:
    with _connect() as connection:
        connection.execute(
            """
            INSERT INTO app_sessions (token_hash, username, expires_at)
            VALUES (%s, %s, %s)
            """,
            (token_hash, username, expires_at),
        )


def get_session_username(token_hash: str) -> str | None:
    with _connect() as connection:
        row = connection.execute(
            """
            SELECT username FROM app_sessions
            WHERE token_hash = %s AND expires_at > now()
            """,
            (token_hash,),
        ).fetchone()
        return row[0] if row else None


def delete_session(token_hash: str) -> None:
    with _connect() as connection:
        connection.execute(
            "DELETE FROM app_sessions WHERE token_hash = %s", (token_hash,)
        )


def authenticate_user(username: str) -> str | None:
    with _connect() as connection:
        row = connection.execute(
            "SELECT password_hash FROM app_users WHERE username = %s",
            (username,),
        ).fetchone()
        return row[0] if row else None


def update_user_password(
    username: str, password_hash: str, current_token_hash: str
) -> None:
    with _connect() as connection:
        result = connection.execute(
            "UPDATE app_users SET password_hash = %s WHERE username = %s",
            (password_hash, username),
        )
        if result.rowcount != 1:
            raise RuntimeError("Authenticated user no longer exists.")
        connection.execute(
            """
            DELETE FROM app_sessions
            WHERE username = %s AND token_hash <> %s
            """,
            (username, current_token_hash),
        )


def record_operation(
    username: str | None,
    method: str,
    action: str,
    status_code: int,
    client_ip: str | None,
) -> None:
    with _connect() as connection:
        connection.execute(
            """
            INSERT INTO app_audit_log
                (username, method, action, status_code, client_ip)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (username, method, action, status_code, client_ip),
        )


def list_operations(limit: int) -> list[dict]:
    with _connect() as connection:
        rows = connection.execute(
            """
            SELECT occurred_at, username, method, action, status_code, client_ip
            FROM app_audit_log
            ORDER BY id DESC
            LIMIT %s
            """,
            (limit,),
        ).fetchall()
    return [
        {
            "occurredAt": row[0].isoformat(),
            "username": row[1],
            "method": row[2],
            "action": row[3],
            "statusCode": row[4],
            "clientIp": row[5],
        }
        for row in rows
    ]
