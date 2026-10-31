"""What every input backend shares: the snapshot of held inputs, and diffing.

The executor hands a backend one :class:`InputState` per tick. The backend compares
it with what it last sent and emits only the changes, so a button held for 40 ticks
produces exactly one press and one release, as a real controller would.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..controls import Control, Kind

AXES = ("LX", "LY", "RX", "RY", "LT", "RT")


@dataclass(frozen=True)
class InputState:
    held: frozenset[Control] = frozenset()
    axes: tuple[float, float, float, float, float, float] = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    mouse_dx: int = 0  # relative movement during this tick only
    mouse_dy: int = 0
    pointer: tuple[int, int] | None = None  # absolute screen position to jump to this tick

    def axis(self, name: str) -> float:
        return self.axes[AXES.index(name)]


NEUTRAL = InputState()


class BackendUnavailable(RuntimeError):
    """The backend cannot run here; the message says what to install or enable."""


@dataclass
class Backend:
    """Base class. Subclasses implement the four ``_emit_*`` hooks and ``_flush``."""

    name: str = "base"
    kinds: frozenset[Kind] = field(default_factory=frozenset)
    supports_pointer: bool = False  # can jump the pointer to an absolute screen position
    _current: InputState = field(default=NEUTRAL, init=False)

    def supports(self, control: Control) -> bool:
        return control.kind in self.kinds

    def apply(self, state: InputState) -> None:
        prev = self._current
        changed = False
        if state.pointer is not None and self.supports_pointer:
            self._emit_pointer(*state.pointer)  # before any click in the same tick
            changed = True
        for c in sorted(prev.held - state.held, key=lambda c: c.name):
            if self.supports(c):
                self._emit_button(c, False)
                changed = True
        for c in sorted(state.held - prev.held, key=lambda c: c.name):
            if self.supports(c):
                self._emit_button(c, True)
                changed = True
        if state.axes != prev.axes and Kind.PAD_BUTTON in self.kinds:
            self._emit_axes(state.axes)
            changed = True
        if (state.mouse_dx or state.mouse_dy) and Kind.MOUSE_BUTTON in self.kinds:
            self._emit_mouse_move(state.mouse_dx, state.mouse_dy)
            changed = True
        if changed:
            self._flush()
        self._current = InputState(state.held, state.axes)

    def release_all(self) -> None:
        """Let go of everything. Safe to call any number of times."""
        self.apply(NEUTRAL)

    def close(self) -> None:
        try:
            self.release_all()
        finally:
            self._close()

    # hooks
    def _emit_button(self, control: Control, down: bool) -> None:
        raise NotImplementedError

    def _emit_axes(self, axes: tuple[float, ...]) -> None:
        raise NotImplementedError

    def _emit_mouse_move(self, dx: int, dy: int) -> None:
        raise NotImplementedError

    def _emit_pointer(self, x: int, y: int) -> None:
        raise NotImplementedError

    def _flush(self) -> None:
        pass

    def _close(self) -> None:
        pass


class MultiBackend(Backend):
    """Sends gamepad controls to one backend and keyboard/mouse to another."""

    def __init__(self, *parts: Backend) -> None:
        kinds: set[Kind] = set()
        for p in parts:
            kinds |= p.kinds
        super().__init__(name="+".join(p.name for p in parts), kinds=frozenset(kinds),
                         supports_pointer=any(p.supports_pointer for p in parts))
        self.parts = parts

    def apply(self, state: InputState) -> None:
        for p in self.parts:
            p.apply(state)
        self._current = InputState(state.held, state.axes)

    def close(self) -> None:
        errors = []
        for p in self.parts:
            try:
                p.close()
            except Exception as exc:  # keep releasing the others
                errors.append(exc)
        if errors:
            raise errors[0]
