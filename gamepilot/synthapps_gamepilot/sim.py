"""Gem Garden: a tiny built-in game to try the whole agent without a real game.

It behaves like an emulated game: it runs at 60 frames per second, reads a virtual
gamepad or keyboard every frame, and renders pixels. The agent sees it only
through screenshots and plays it only through the same backend interface it uses
for real devices, so a run here exercises the full loop: capture, plan, frame-timed
input, and release.

Rules: walk the red square onto yellow gems (d-pad, left stick, arrow keys or
WASD). Holding a direction moves one tile at once and one more every 8 frames.
Collect ``goal`` gems to win.
"""

from __future__ import annotations

import random
from collections import deque
from dataclasses import dataclass, field

from .backends.base import Backend, InputState
from .controls import Control, Kind
from .imaging import Frame
from .planner import Decision, Observation

TILE = 16
COLS, ROWS = 12, 9
HUD = 1  # rows of score display above the field
REPEAT_FRAMES = 8
SCALE = 2

BG = (24, 64, 36)
WALL = (110, 110, 118)
PLAYER = (220, 52, 52)
GEM = (242, 208, 40)
HUD_BG = (12, 12, 16)
PIP = (242, 208, 40)

LAYOUT = [
    "............",
    "..##....#...",
    "..#.....#...",
    "......###...",
    ".##.........",
    "......#..##.",
    "..#...#.....",
    "..#.........",
    "............",
]

DIRS = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}
_INPUTS = {
    "up": {"DPAD_UP", "KEY_UP", "KEY_W"},
    "down": {"DPAD_DOWN", "KEY_DOWN", "KEY_S"},
    "left": {"DPAD_LEFT", "KEY_LEFT", "KEY_A"},
    "right": {"DPAD_RIGHT", "KEY_RIGHT", "KEY_D"},
}


@dataclass
class GemGarden:
    goal: int = 5
    seed: int = 7
    frame_no: int = 0
    collected: int = 0
    player: tuple[int, int] = (0, 0)
    gem: tuple[int, int] = (0, 0)
    input: InputState = field(default_factory=InputState)
    _held_dir: str = ""
    _held_frames: int = 0

    def __post_init__(self) -> None:
        self.walls = {(x, y) for y, row in enumerate(LAYOUT) for x, ch in enumerate(row) if ch == "#"}
        self.rng = random.Random(self.seed)
        self.gem = self._free_cell()

    @property
    def won(self) -> bool:
        return self.collected >= self.goal

    def _free_cell(self) -> tuple[int, int]:
        while True:
            cell = (self.rng.randrange(COLS), self.rng.randrange(ROWS))
            if cell not in self.walls and cell != self.player:
                return cell

    def _direction(self) -> str:
        names = {c.name for c in self.input.held}
        lx, ly = self.input.axes[0], self.input.axes[1]
        for d, keys in _INPUTS.items():
            if names & keys:
                return d
        if abs(lx) >= 0.5 or abs(ly) >= 0.5:
            if abs(lx) >= abs(ly):
                return "right" if lx > 0 else "left"
            return "up" if ly > 0 else "down"
        return ""

    def step(self) -> None:
        """Advance one frame using the current input state."""
        self.frame_no += 1
        if self.won:
            return
        d = self._direction()
        if d != self._held_dir:
            self._held_dir, self._held_frames = d, 0
        if d:
            if self._held_frames % REPEAT_FRAMES == 0:
                self._move(DIRS[d])
            self._held_frames += 1

    def _move(self, delta: tuple[int, int]) -> None:
        x, y = self.player[0] + delta[0], self.player[1] + delta[1]
        if 0 <= x < COLS and 0 <= y < ROWS and (x, y) not in self.walls:
            self.player = (x, y)
            if self.player == self.gem:
                self.collected += 1
                if not self.won:
                    self.gem = self._free_cell()

    def render(self) -> Frame:
        w, h = COLS * TILE, (ROWS + HUD) * TILE
        px = bytearray(bytes(HUD_BG) * (w * HUD * TILE) + bytes(BG) * (w * ROWS * TILE))

        def fill(x0: int, y0: int, size: int, color: tuple[int, int, int], inset: int = 0) -> None:
            c = bytes(color)
            for y in range(y0 + inset, y0 + size - inset):
                row = (y * w + x0 + inset) * 3
                px[row:row + (size - 2 * inset) * 3] = c * (size - 2 * inset)

        for x, y in self.walls:
            fill(x * TILE, (y + HUD) * TILE, TILE, WALL)
        if not self.won:
            fill(self.gem[0] * TILE, (self.gem[1] + HUD) * TILE, TILE, GEM, inset=4)
        fill(self.player[0] * TILE, (self.player[1] + HUD) * TILE, TILE, PLAYER, inset=1)
        for i in range(self.collected):
            fill(i * TILE, 0, TILE, PIP, inset=5)
        frame = Frame(w, h, bytes(px))
        return upscale(frame, SCALE)


def upscale(frame: Frame, k: int) -> Frame:
    if k == 1:
        return frame
    out = bytearray()
    for y in range(frame.height):
        row = frame.rgb[y * frame.width * 3:(y + 1) * frame.width * 3]
        wide = b"".join(row[i:i + 3] * k for i in range(0, len(row), 3))
        out += wide * k
    return Frame(frame.width * k, frame.height * k, bytes(out))


class SimBackend(Backend):
    """Feeds input states straight into the demo game, like a virtual device would."""

    def __init__(self, game: GemGarden, kinds: frozenset[Kind] | None = None) -> None:
        super().__init__(name="sim", kinds=kinds or frozenset({Kind.PAD_BUTTON, Kind.KEY, Kind.MOUSE_BUTTON}))
        self.game = game
        self.presses: list[str] = []

    def apply(self, state: InputState) -> None:
        new = state.held - self._current.held
        self.presses.extend(sorted(c.name for c in new))
        super().apply(state)
        self.game.input = InputState(
            frozenset(c for c in state.held if self.supports(c)), state.axes)

    def _emit_button(self, control: Control, down: bool) -> None:
        pass

    def _emit_axes(self, axes: tuple[float, ...]) -> None:
        pass

    def _emit_mouse_move(self, dx: int, dy: int) -> None:
        pass


class ScriptedGemPlanner:
    """A non-AI planner that reads the screenshot pixels and walks to the gem.

    It exists to show (and test) that the loop works end to end without an API key:
    it sees only the frame, not the game's internals.
    """

    def __init__(self, use_stick: bool = False) -> None:
        self.use_stick = use_stick

    @staticmethod
    def read(frame: Frame) -> tuple[tuple[int, int] | None, tuple[int, int] | None, set[tuple[int, int]]]:
        size = TILE * frame.width // (COLS * TILE)
        player = gem = None
        walls = set()
        for y in range(ROWS):
            for x in range(COLS):
                color = frame.pixel(x * size + size // 2, (y + HUD) * size + size // 2)
                if color == PLAYER:
                    player = (x, y)
                elif color == GEM:
                    gem = (x, y)
                elif color == WALL:
                    walls.add((x, y))
        return player, gem, walls

    def decide(self, obs: Observation) -> Decision:
        player, gem, walls = self.read(obs.frames[-1])
        if player is None:
            return Decision(steps=[], status="stuck", observation="cannot find the player")
        if gem is None:
            return Decision(steps=[], status="done", observation="no gem left on screen")
        path = _bfs(player, gem, walls)
        if not path:
            return Decision(steps=[], status="stuck", observation="no path to the gem")
        steps = []
        for direction, count in _runs(path):
            frames = (count - 1) * REPEAT_FRAMES + 1
            ms = frames * 1000 // 60 + 1
            if self.use_stick:
                x, y = DIRS[direction]
                steps.append({"left_stick": {"x": x, "y": -y}, "duration_ms": ms})
            else:
                steps.append({"buttons": [f"DPAD_{direction.upper()}"], "duration_ms": ms})
        return Decision(steps=steps, intent=f"walk to the gem at {gem}",
                        observation=f"player {player}, gem {gem}")


def _bfs(start: tuple[int, int], goal: tuple[int, int], walls: set[tuple[int, int]]) -> list[str]:
    prev: dict[tuple[int, int], tuple[tuple[int, int], str] | None] = {start: None}
    queue = deque([start])
    while queue:
        cell = queue.popleft()
        if cell == goal:
            break
        for name, (dx, dy) in DIRS.items():
            nxt = (cell[0] + dx, cell[1] + dy)
            if 0 <= nxt[0] < COLS and 0 <= nxt[1] < ROWS and nxt not in walls and nxt not in prev:
                prev[nxt] = (cell, name)
                queue.append(nxt)
    if goal not in prev:
        return []
    path, cell = [], goal
    while prev[cell] is not None:
        cell, name = prev[cell]  # type: ignore[misc]
        path.append(name)
    return path[::-1]


def _runs(path: list[str]) -> list[tuple[str, int]]:
    runs: list[tuple[str, int]] = []
    for d in path:
        if runs and runs[-1][0] == d:
            runs[-1] = (d, runs[-1][1] + 1)
        else:
            runs.append((d, 1))
    return runs
