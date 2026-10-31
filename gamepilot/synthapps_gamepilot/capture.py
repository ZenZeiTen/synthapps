"""The eyes: grab what is on screen inside the game window."""

from __future__ import annotations

from collections.abc import Callable

from .imaging import Frame
from .window import WindowTracker


class Capture:
    #: Screen area of the last grab (left, top, width, height), or None when unknown.
    last_region: tuple[int, int, int, int] | None = None

    def grab(self) -> Frame:
        raise NotImplementedError

    def close(self) -> None:
        pass


class ScreenCapture(Capture):
    """Screen pixels via ``mss`` (pip install mss): fast, and works on Windows and X11."""

    def __init__(self, window: WindowTracker, monitor: int = 1) -> None:
        try:
            import mss  # type: ignore[import-not-found]
        except ImportError as exc:
            raise RuntimeError("screen capture needs mss: pip install mss") from exc
        self._sct = mss.mss()
        self.window = window
        self.monitor = monitor

    def grab(self) -> Frame:
        r = self.window.rect()
        if r is None:
            region = self._sct.monitors[self.monitor]
        else:
            region = {"left": r.left, "top": r.top, "width": r.width, "height": r.height}
        shot = self._sct.grab(region)
        self.last_region = (int(region["left"]), int(region["top"]), shot.width, shot.height)
        return Frame(shot.width, shot.height, shot.rgb)

    def close(self) -> None:
        self._sct.close()


class FunctionCapture(Capture):
    """Frames from any callable: the built-in demo game, an emulator API, a test."""

    def __init__(self, fn: Callable[[], Frame]) -> None:
        self.fn = fn

    def grab(self) -> Frame:
        return self.fn()
