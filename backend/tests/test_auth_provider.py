import unittest
from unittest import mock

from auth_provider import LocalAuthenticationProvider


class PasswordHasher:
    def verify(self, password, password_hash):
        return password == "correct password" and password_hash == "stored hash"


class LocalAuthenticationProviderTests(unittest.TestCase):
    def setUp(self):
        self.provider = LocalAuthenticationProvider(PasswordHasher(), "dummy hash")

    @mock.patch("auth_provider.storage.authenticate_user", return_value="stored hash")
    def test_authenticates_valid_local_credentials(self, authenticate_user):
        self.assertTrue(self.provider.authenticate("admin", "correct password"))
        authenticate_user.assert_called_once_with("admin")

    @mock.patch("auth_provider.storage.authenticate_user", return_value=None)
    def test_verifies_unknown_users_against_dummy_hash(self, authenticate_user):
        self.assertFalse(self.provider.authenticate("unknown", "wrong password"))
        authenticate_user.assert_called_once_with("unknown")


if __name__ == "__main__":
    unittest.main()
