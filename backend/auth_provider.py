from typing import Protocol

from pwdlib import PasswordHash

import storage


class AuthenticationProvider(Protocol):
    def authenticate(self, username: str, password: str) -> bool: ...


class LocalAuthenticationProvider:
    def __init__(self, password_hasher: PasswordHash, dummy_password_hash: str):
        self.password_hasher = password_hasher
        self.dummy_password_hash = dummy_password_hash

    def authenticate(self, username: str, password: str) -> bool:
        password_hash = storage.authenticate_user(username)
        verified = self.password_hasher.verify(
            password, password_hash or self.dummy_password_hash
        )
        return bool(password_hash and verified)
