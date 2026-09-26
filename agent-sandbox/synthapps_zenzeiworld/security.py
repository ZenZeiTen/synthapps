"""Identity and permissions.

* ``SessionAuthority`` issues unforgeable session tokens. An agent's identity
  comes from the token it connected with, never from anything it writes in a
  request, so one agent cannot act as another.
* ``Grants`` is the kernel-side capability table: "may enter the workshop",
  "may use the tool cabinet". Grants are scoped, expire, and are revoked
  wholesale when an agent is quarantined or terminated.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass


class AuthenticationError(Exception):
    """Raised when a session token is missing, forged, revoked or from another run."""


_TOKEN_VERSION = "v1"


class SessionAuthority:
    def __init__(self, secret: bytes | None = None, run_id: str | None = None) -> None:
        # The secret lives only inside the kernel process. Agents never see it.
        self._secret = secret if secret is not None else secrets.token_bytes(32)
        self.run_id = run_id if run_id is not None else secrets.token_hex(8)
        self._revoked: set[str] = set()

    def _mac(self, agent_id: str, nonce: str) -> str:
        message = f"{_TOKEN_VERSION}|{self.run_id}|{agent_id}|{nonce}".encode()
        return hmac.new(self._secret, message, hashlib.sha256).hexdigest()

    def issue(self, agent_id: str) -> str:
        nonce = secrets.token_hex(8)
        return f"{_TOKEN_VERSION}.{self.run_id}.{agent_id}.{nonce}.{self._mac(agent_id, nonce)}"

    def verify(self, token: object) -> str:
        """Return the agent id bound to ``token`` or raise ``AuthenticationError``."""
        if not isinstance(token, str) or len(token) > 256:
            raise AuthenticationError("malformed token")
        parts = token.split(".")
        if len(parts) != 5:
            raise AuthenticationError("malformed token")
        version, run_id, agent_id, nonce, mac = parts
        if version != _TOKEN_VERSION or run_id != self.run_id:
            raise AuthenticationError("token not valid for this run")
        if not hmac.compare_digest(mac, self._mac(agent_id, nonce)):
            raise AuthenticationError("bad signature")
        if nonce in self._revoked:
            raise AuthenticationError("token revoked")
        return agent_id

    def revoke(self, token: str) -> None:
        parts = token.split(".")
        if len(parts) == 5:
            self._revoked.add(parts[3])


@dataclass(frozen=True)
class Grant:
    scope: str  # e.g. "enter:workshop", "use:tool_cabinet"
    expires_tick: int | None  # None means "until revoked"
    granted_by: str


class Grants:
    def __init__(self) -> None:
        self._table: dict[str, dict[str, Grant]] = {}

    def grant(self, agent_id: str, scope: str, granted_by: str,
              expires_tick: int | None = None) -> Grant:
        g = Grant(scope=scope, expires_tick=expires_tick, granted_by=granted_by)
        self._table.setdefault(agent_id, {})[scope] = g
        return g

    def has(self, agent_id: str, scope: str, tick: int) -> bool:
        g = self._table.get(agent_id, {}).get(scope)
        return g is not None and (g.expires_tick is None or tick <= g.expires_tick)

    def revoke(self, agent_id: str, scope: str) -> None:
        self._table.get(agent_id, {}).pop(scope, None)

    def revoke_all(self, agent_id: str) -> None:
        self._table.pop(agent_id, None)

    def scopes(self, agent_id: str, tick: int) -> list[str]:
        return sorted(s for s in self._table.get(agent_id, {}) if self.has(agent_id, s, tick))
