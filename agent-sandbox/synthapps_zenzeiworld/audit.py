"""Tamper-evident audit log.

Every entry carries the SHA-256 of the previous entry, so editing, deleting
or reordering any past record breaks the chain from that point on. In a real
deployment each entry is also streamed to write-once storage outside the
enclave (see ``sink``), so even a fully compromised kernel host cannot
rewrite history that has already left it.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any

GENESIS_HASH = "0" * 64


def _canonical(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


@dataclass(frozen=True)
class AuditEntry:
    seq: int
    tick: int
    kind: str
    agent_id: str | None
    data: dict[str, Any]
    prev_hash: str
    hash: str

    def body(self) -> dict[str, Any]:
        return {
            "seq": self.seq,
            "tick": self.tick,
            "kind": self.kind,
            "agent_id": self.agent_id,
            "data": self.data,
            "prev_hash": self.prev_hash,
        }

    def to_json(self) -> str:
        return json.dumps({**self.body(), "hash": self.hash}, sort_keys=True)


class AuditLog:
    def __init__(self, sink: Callable[[AuditEntry], None] | None = None) -> None:
        self._entries: list[AuditEntry] = []
        self._sink = sink
        self._verified_upto = 0

    def append(self, tick: int, kind: str, agent_id: str | None,
               data: dict[str, Any] | None = None) -> AuditEntry:
        prev = self._entries[-1].hash if self._entries else GENESIS_HASH
        # Round-trip through JSON so the stored data is exactly what was hashed.
        clean = json.loads(_canonical(data or {}))
        body = {"seq": len(self._entries), "tick": tick, "kind": kind,
                "agent_id": agent_id, "data": clean, "prev_hash": prev}
        entry = AuditEntry(**body, hash=hashlib.sha256(_canonical(body)).hexdigest())
        self._entries.append(entry)
        if self._sink is not None:
            self._sink(entry)
        return entry

    def __len__(self) -> int:
        return len(self._entries)

    def __iter__(self) -> Iterator[AuditEntry]:
        return iter(self._entries)

    def verify(self, incremental: bool = False) -> int | None:
        """Return the index of the first broken entry, or ``None`` if intact.

        With ``incremental=True`` only entries added since the last clean
        check are re-hashed, which keeps per-tick watchdog checks cheap.
        """
        start = self._verified_upto if incremental else 0
        prev = self._entries[start - 1].hash if start > 0 else GENESIS_HASH
        for index in range(start, len(self._entries)):
            entry = self._entries[index]
            if entry.seq != index or entry.prev_hash != prev:
                return index
            if hashlib.sha256(_canonical(entry.body())).hexdigest() != entry.hash:
                return index
            prev = entry.hash
        self._verified_upto = len(self._entries)
        return None

    @staticmethod
    def verify_jsonl(lines: list[str]) -> int | None:
        """Verify an exported log, e.g. one fetched back from cold storage."""
        prev = GENESIS_HASH
        for index, line in enumerate(lines):
            record = json.loads(line)
            claimed = record.pop("hash")
            if record.get("seq") != index or record.get("prev_hash") != prev:
                return index
            if hashlib.sha256(_canonical(record)).hexdigest() != claimed:
                return index
            prev = claimed
        return None
