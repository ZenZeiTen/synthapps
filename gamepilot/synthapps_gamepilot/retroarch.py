"""Talk to RetroArch through its network command interface (UDP, port 55355).

Turn it on in RetroArch: Settings > Network > Network Commands = On, or put
``network_cmd_enable = "true"`` in retroarch.cfg.

This is what makes emulated games play *properly* for a slow thinker: the agent
pauses the game, looks and thinks for as long as it needs, then runs its plan one
emulated frame at a time (``FRAMEADVANCE``) with the virtual pad held exactly as
planned. Nothing happens in the game while the model is thinking.

Save states give a safety net: save before a risky jump, load after a death.
"""

from __future__ import annotations

import socket
from dataclasses import dataclass


class RetroArchError(RuntimeError):
    pass


@dataclass
class Status:
    state: str  # PLAYING, PAUSED or CONTENTLESS
    system: str = ""
    game: str = ""

    @property
    def paused(self) -> bool:
        return self.state == "PAUSED"


class RetroArch:
    def __init__(self, host: str = "127.0.0.1", port: int = 55355, timeout: float = 1.0) -> None:
        self.addr = (host, port)
        self.timeout = timeout
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.settimeout(timeout)

    def close(self) -> None:
        self.sock.close()

    def send(self, command: str) -> None:
        self.sock.sendto(command.encode("ascii"), self.addr)

    def ask(self, command: str) -> str:
        """Send a command that answers, and return the answer line."""
        # drop stale replies from earlier commands
        self.sock.setblocking(False)
        try:
            while True:
                self.sock.recvfrom(65535)
        except (BlockingIOError, OSError):
            pass
        finally:
            self.sock.settimeout(self.timeout)
        self.send(command)
        try:
            data, _ = self.sock.recvfrom(65535)
        except (TimeoutError, ConnectionResetError) as exc:  # Windows reports a closed port as a reset
            raise RetroArchError(
                f"RetroArch did not answer {command.split()[0]} on {self.addr[0]}:{self.addr[1]}; "
                "is it running with Network Commands turned on?"
            ) from exc
        return data.decode("ascii", "replace").strip()

    # --- commands -------------------------------------------------------------
    def version(self) -> str:
        return self.ask("VERSION")

    def status(self) -> Status:
        reply = self.ask("GET_STATUS")
        parts = reply.split(" ", 2)
        if len(parts) < 2 or parts[0] != "GET_STATUS":
            raise RetroArchError(f"unexpected GET_STATUS reply: {reply!r}")
        info = parts[2].split(",") if len(parts) > 2 else []
        return Status(parts[1], info[0] if info else "", info[1] if len(info) > 1 else "")

    def set_paused(self, paused: bool) -> None:
        st = self.status()
        if st.state == "CONTENTLESS":
            raise RetroArchError("RetroArch has no game loaded")
        if st.paused != paused:
            self.send("PAUSE_TOGGLE")

    def frame_advance(self) -> None:
        self.send("FRAMEADVANCE")

    def save_state(self) -> None:
        self.send("SAVE_STATE")

    def load_state(self) -> None:
        self.send("LOAD_STATE")

    def reset(self) -> None:
        self.send("RESET")

    def read_memory(self, address: int, length: int) -> bytes:
        """Read emulated system memory (needs a core with memory maps, most do)."""
        if not 1 <= length <= 256:
            raise ValueError("length must be 1..256")
        reply = self.ask(f"READ_CORE_MEMORY {address:x} {length}")
        parts = reply.split()
        if len(parts) < 3 or parts[0] != "READ_CORE_MEMORY":
            raise RetroArchError(f"unexpected reply: {reply!r}")
        if parts[2] == "-1":
            raise RetroArchError(f"memory at {address:#x} cannot be read: {' '.join(parts[3:])}")
        return bytes(int(b, 16) for b in parts[2:])
