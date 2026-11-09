import asyncio
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import main


class PostgresBackupTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.backup_dir = Path(self.directory.name)
        self.backup_dir_patch = mock.patch.object(main, "BACKUP_DIR", self.backup_dir)
        self.backup_dir_patch.start()
        self.addCleanup(self.backup_dir_patch.stop)

    @mock.patch.dict(os.environ, {
        "PGHOST": "postgres",
        "PGPORT": "5432",
        "PGUSER": "compliance",
        "PGDATABASE": "compliance",
        "PGPASSWORD": "test-password",
    })
    @mock.patch("main.subprocess.run")
    def test_creates_atomic_custom_format_dump_without_password_in_arguments(self, run):
        def write_dump(command, **kwargs):
            output_path = Path(command[command.index("--file") + 1])
            output_path.write_bytes(b"PGDMP")

        run.side_effect = write_dump
        name = main.create_postgres_backup()

        self.assertRegex(name, main.POSTGRES_BACKUP_PATTERN)
        dump_path = self.backup_dir / name
        self.assertEqual(dump_path.read_bytes(), b"PGDMP")
        command = run.call_args.args[0]
        self.assertIn("--format=custom", command)
        self.assertIn("--compress=9", command)
        self.assertNotIn("test-password", command)
        self.assertEqual(run.call_args.kwargs["env"]["PGPASSWORD"], "test-password")
        self.assertEqual(list(self.backup_dir.glob("*.tmp")), [])

    def test_daily_backup_is_not_recreated_when_one_exists_today(self):
        today = datetime.now(timezone.utc).strftime("%Y%m%d")
        existing = self.backup_dir / f"postgresql_daily_{today}_000000_12345678.dump"
        existing.write_bytes(b"PGDMP")
        with mock.patch("main.create_postgres_backup") as create:
            result = main.ensure_daily_postgres_backup()

        self.assertIsNone(result)
        create.assert_not_called()

    def test_daily_backup_uses_daily_filename(self):
        with mock.patch("main.subprocess.run") as run:
            def write_dump(command, **kwargs):
                Path(command[command.index("--file") + 1]).write_bytes(b"PGDMP")

            run.side_effect = write_dump
            name = main.create_postgres_backup(automatic=True)

        self.assertTrue(name.startswith("postgresql_daily_"))

    def test_removes_legacy_json_backups_after_postgres_backup(self):
        legacy_backup = self.backup_dir / (
            "material_db_20261109_131522_6d8c5d6f-57c8-461a-a35e-9e574a18112c.json"
        )
        legacy_backup.write_text('{"items":{}}', encoding="utf-8")
        with mock.patch("main.subprocess.run") as run:
            def write_dump(command, **kwargs):
                Path(command[command.index("--file") + 1]).write_bytes(b"PGDMP")

            run.side_effect = write_dump
            main.create_postgres_backup()

        self.assertFalse(legacy_backup.exists())

    def test_backup_listing_only_includes_postgresql_archives(self):
        postgres_backup = self.backup_dir / (
            "postgresql_manual_20261109_131522_6d8c5d6f-57c8-461a-a35e-9e574a18112c.dump"
        )
        json_backup = self.backup_dir / (
            "material_db_20261109_131522_6d8c5d6f-57c8-461a-a35e-9e574a18112c.json"
        )
        postgres_backup.write_bytes(b"PGDMP")
        json_backup.write_text('{"items":{}}', encoding="utf-8")

        self.assertEqual(main.list_backup_files(), [postgres_backup])

    def test_manual_backup_returns_service_unavailable_when_pg_dump_is_missing(self):
        with mock.patch("main.subprocess.run", side_effect=FileNotFoundError("pg_dump")):
            with self.assertRaises(main.HTTPException) as error:
                main.post_postgres_backup()

        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(list(self.backup_dir.iterdir()), [])

    def test_backup_failure_blocks_mutating_request(self):
        request = SimpleNamespace(
            method="POST",
            url=SimpleNamespace(path="/api/items"),
            headers={},
            cookies={main.SESSION_COOKIE: "session-token"},
            state=SimpleNamespace(username=None),
            client=SimpleNamespace(host="127.0.0.1"),
            scope={},
        )
        called = False

        async def next_handler(_request):
            nonlocal called
            called = True
            return None

        with (
            mock.patch("main.storage.postgres_enabled", return_value=True),
            mock.patch("main.storage.get_session_username", return_value="admin"),
            mock.patch("main.storage.record_operation"),
            mock.patch("main.ensure_daily_postgres_backup", side_effect=RuntimeError("dump failed")),
        ):
            response = asyncio.run(main.authenticate_and_audit(request, next_handler))

        self.assertEqual(response.status_code, 503)
        self.assertFalse(called)


if __name__ == "__main__":
    unittest.main()
