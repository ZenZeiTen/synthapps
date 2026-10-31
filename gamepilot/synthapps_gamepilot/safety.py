"""Guardrails: anti-cheat detection, the kill switch, and spending limits.

Anti-cheat: driving a game with virtual devices looks like a bot to anti-cheat
software, and in online games it breaks the terms of service. Accounts get banned.
Before playing, the agent looks for well-known anti-cheat services and refuses to
start if one is running, unless the profile explicitly allows it (some offline,
single-player games ship anti-cheat too). Nothing here hides the agent from
anti-cheat; it only keeps you from walking into a ban by accident.

Kill switch: press the Pause/Break key (Windows), create a file named STOP in the
working directory (any system), or press Ctrl+C. Every input is released at once.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path

#: Process names of well-known anti-cheat services (lower case, prefix match).
ANTI_CHEAT = {
    "easyanticheat": "Easy Anti-Cheat",
    "beservice": "BattlEye",
    "bedaisy": "BattlEye",
    "vgc.exe": "Riot Vanguard",
    "vgtray": "Riot Vanguard",
    "faceit": "FACEIT",
    "eaanticheat": "EA Javelin Anti-Cheat",
    "pnkbstr": "PunkBuster",
    "gameguard": "nProtect GameGuard",
    "xigncode": "XIGNCODE3",
    "sguard": "Tencent ACE",
}


def running_process_names() -> list[str]:
    try:
        import psutil  # type: ignore[import-not-found]

        return [p.info["name"] or "" for p in psutil.process_iter(["name"])]
    except ImportError:
        pass
    if sys.platform == "win32":
        out = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True,
                             timeout=10).stdout
        return [line.split('","')[0].strip('"') for line in out.splitlines() if line]
    names = []
    for entry in Path("/proc").glob("[0-9]*"):
        try:  # cmdline, not comm: comm is cut at 15 chars, and Proton games run as wine processes
            first = (entry / "cmdline").read_bytes().split(b"\0", 1)[0].decode(errors="replace")
        except OSError:
            continue
        if first:
            names.append(first.replace("\\", "/").rsplit("/", 1)[-1])
    return names


def detect_anti_cheat(names: Iterable[str] | None = None) -> dict[str, str]:
    """Running process -> anti-cheat product, for every match."""
    found = {}
    for name in names if names is not None else running_process_names():
        low = name.lower()
        for prefix, product in ANTI_CHEAT.items():
            if low.startswith(prefix):
                found[name] = product
    return found


@dataclass
class KillSwitch:
    stop_file: Path = Path("STOP")
    windows_vk: int = 0x13  # VK_PAUSE: Pause/Break, which almost no game uses
    reason: str = ""
    _key_state: Callable[[int], int] | None = None

    def __post_init__(self) -> None:
        if self._key_state is None and sys.platform == "win32":
            import ctypes

            self._key_state = ctypes.windll.user32.GetAsyncKeyState  # type: ignore[attr-defined]

    def trip(self, reason: str) -> None:
        self.reason = self.reason or reason

    def check(self) -> str:
        if self.reason:
            return self.reason
        if self.stop_file.exists():
            self.trip(f"stop file {self.stop_file} exists")
        elif self._key_state is not None and self._key_state(self.windows_vk) & 0x8000:
            self.trip("Pause/Break key pressed")
        return self.reason


#: USD per million tokens (input, output, cache read), from Anthropic's published prices as of
#: 2026-10. The Haiku cache-read figure is an estimate (10% of input). Used only for the budget.
PRICES = {
    "claude-opus-5-5": (4.00, 20.00, 0.20),
    "claude-sonnet-5-5": (2.00, 10.00, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, 0.01),
    "claude-fable-5-1": (10.00, 50.00, 0.25),
}


@dataclass
class Budget:
    max_turns: int = 300
    max_seconds: float = 1800.0
    max_cost_usd: float = 5.0
    model: str = "claude-opus-5-5"
    turns: int = 0
    cost_usd: float = 0.0
    started: float = field(default_factory=time.monotonic)
    clock: Callable[[], float] = time.monotonic

    def add_usage(self, input_tokens: int, output_tokens: int, cache_read: int = 0,
                  cache_write: int = 0) -> None:
        pin, pout, pread = PRICES.get(self.model, PRICES["claude-opus-5-5"])
        # cache writes cost 1.25x input for the 5-minute cache
        self.cost_usd += (input_tokens * pin + output_tokens * pout + cache_read * pread
                          + cache_write * pin * 1.25) / 1e6

    def exhausted(self) -> str:
        if self.turns >= self.max_turns:
            return f"turn limit reached ({self.max_turns})"
        if self.clock() - self.started >= self.max_seconds:
            return f"time limit reached ({self.max_seconds / 60:.0f} min)"
        if self.cost_usd >= self.max_cost_usd:
            return f"spending limit reached (${self.cost_usd:.2f} of ${self.max_cost_usd:.2f})"
        return ""


def stop_file_from_env() -> Path:
    return Path(os.environ.get("GAMEPILOT_STOP_FILE", "STOP"))
