"""Shared fakes for the tests."""

from __future__ import annotations

from types import SimpleNamespace


class FakeTime:
    def __init__(self) -> None:
        self.t = 0.0
        self.sleeps: list[float] = []

    def now(self) -> float:
        self.t += 1e-5  # a real clock moves on while code runs
        return self.t

    def sleep(self, s: float) -> None:
        self.sleeps.append(s)
        self.t += max(s, 0.0)


class FakeUInput:
    instances: list[FakeUInput] = []

    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs
        self.writes: list[tuple[int, int, int]] = []
        self.syns = 0
        self.closed = False
        FakeUInput.instances.append(self)

    def write(self, etype: int, code: int, value: int) -> None:
        self.writes.append((etype, code, value))

    def syn(self) -> None:
        self.syns += 1

    def close(self) -> None:
        self.closed = True


def fake_evdev() -> SimpleNamespace:
    def absinfo(**kw: int) -> tuple[int, ...]:
        return tuple(kw[k] for k in ("value", "min", "max", "fuzz", "flat", "resolution"))

    return SimpleNamespace(UInput=FakeUInput, AbsInfo=absinfo, UInputError=OSError)


class FakePad:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    def __getattr__(self, name: str):  # noqa: ANN204
        def record(**kw: object) -> None:
            self.calls.append((name, kw))
        return record


def fake_vgamepad() -> SimpleNamespace:
    from synthapps_gamepilot.controls import PAD_BUTTONS

    flags = SimpleNamespace(**{flag: i for i, (flag, _) in enumerate(PAD_BUTTONS.values())})
    return SimpleNamespace(VX360Gamepad=FakePad, XUSB_BUTTON=flags)


def tool_use(id_: str, input_: dict, name: str = "act") -> SimpleNamespace:
    return SimpleNamespace(type="tool_use", id=id_, name=name, input=input_)


def response(content: list, stop: str = "tool_use", stop_details: object = None) -> SimpleNamespace:
    return SimpleNamespace(
        content=content, stop_reason=stop, stop_details=stop_details,
        usage=SimpleNamespace(input_tokens=1000, output_tokens=200, cache_read_input_tokens=500,
                              cache_creation_input_tokens=0),
    )


class FakeClient:
    """Mimics client.beta.messages.create; replies come from a list or a function."""

    def __init__(self, replies: list | None = None, fn: object = None) -> None:
        self.replies = list(replies or [])
        self.fn = fn
        self.requests: list[dict] = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kwargs: object) -> object:
        import copy

        self.requests.append(copy.deepcopy(kwargs))
        if self.fn is not None:
            return self.fn(kwargs)  # type: ignore[operator]
        return self.replies.pop(0)


def act(steps: list, status: str = "playing", **extra: object) -> dict:
    return {"observation": "seen", "intent": "do", "steps": steps, "status": status, **extra}
