import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest import mock

import main
import storage


class PasswordHasher:
    def verify(self, password, password_hash):
        return password == "current password" and password_hash == "stored hash"

    def hash(self, password):
        return f"hashed:{password}"


class Request:
    def __init__(self, body):
        self._body = json.dumps(body).encode()
        self.headers = {}
        self.cookies = {main.SESSION_COOKIE: "session-token"}
        self.state = SimpleNamespace(username="admin")
        self.app = SimpleNamespace(state=SimpleNamespace(
            authentication_provider=SimpleNamespace(
                authenticate=lambda username, password: (
                    username == "admin"
                    and PasswordHasher().verify(password, "stored hash")
                ),
                password_hasher=PasswordHasher(),
            )
        ))

    async def body(self):
        return self._body


class PasswordChangeTests(unittest.TestCase):
    @mock.patch("main.storage.update_user_password")
    def test_changes_password_and_preserves_current_session(self, update_password):
        result = asyncio.run(main.change_password(Request({
            "currentPassword": "current password",
            "newPassword": "a new secure password",
        })))

        self.assertEqual(result, {"changed": True})
        update_password.assert_called_once_with(
            "admin",
            "hashed:a new secure password",
            main._token_hash("session-token"),
        )

    @mock.patch("main.storage.update_user_password")
    def test_rejects_incorrect_current_password(self, update_password):
        with self.assertRaises(main.HTTPException) as error:
            asyncio.run(main.change_password(Request({
                "currentPassword": "wrong password",
                "newPassword": "a new secure password",
            })))

        self.assertEqual(error.exception.status_code, 400)
        update_password.assert_not_called()

    @mock.patch("main.storage.update_user_password")
    def test_rejects_short_new_password(self, update_password):
        with self.assertRaises(main.HTTPException) as error:
            asyncio.run(main.change_password(Request({
                "currentPassword": "current password",
                "newPassword": "short",
            })))

        self.assertEqual(error.exception.status_code, 400)
        update_password.assert_not_called()

    def test_password_storage_revokes_every_session_except_current(self):
        connection = mock.MagicMock()
        connection.execute.return_value.rowcount = 1
        connection.__enter__.return_value = connection

        with mock.patch("storage._connect", return_value=connection):
            storage.update_user_password("admin", "new hash", "current-token-hash")

        self.assertEqual(connection.execute.call_count, 2)
        self.assertEqual(
            connection.execute.call_args.args[1],
            ("admin", "current-token-hash"),
        )
        self.assertIn("token_hash <>", connection.execute.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
