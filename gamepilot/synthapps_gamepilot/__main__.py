"""Command line: ``python -m synthapps_gamepilot <command>``."""

from __future__ import annotations

import argparse
import importlib.util
import os
import platform
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

from . import __version__, controls
from .backends import available_backends, make_backend
from .backends.base import BackendUnavailable
from .safety import Budget, KillSwitch, detect_anti_cheat, stop_file_from_env


def _countdown(seconds: int, what: str) -> None:
    print(f"{what} in {seconds} s. Switch to the window that should receive it. "
          "Kill switch: Pause/Break key (Windows), a file named STOP, or Ctrl+C.")
    for i in range(seconds, 0, -1):
        print(f"  {i}...", flush=True)
        time.sleep(1)


# --- doctor -------------------------------------------------------------------------
def cmd_doctor(args: argparse.Namespace) -> int:
    print(f"gamepilot {__version__} on {platform.system()} {platform.release()}, Python {platform.python_version()}")
    print("\nInput backends:")
    for name, state in available_backends().items():
        print(f"  {name:10} {state}")
    print("\nOptional packages:")
    for mod, why in (("anthropic", "Claude planner"), ("mss", "screen capture"),
                     ("PIL", "smaller screenshots (JPEG, resizing)"), ("psutil", "faster process scan")):
        ok = importlib.util.find_spec(mod) is not None
        print(f"  {mod:10} {'ok' if ok else 'missing'}  ({why})")
    key = bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))
    print(f"\nClaude credentials in environment: {'yes' if key else 'no (or use ant auth login)'}")
    if sys.platform.startswith("linux"):
        session = os.environ.get("XDG_SESSION_TYPE", "unknown")
        print(f"Display session: {session}"
              + ("  (Wayland: window lookup and focus checks are unavailable)" if session == "wayland" else ""))
    found = detect_anti_cheat()
    print("\nAnti-cheat running: " + (", ".join(f"{k} ({v})" for k, v in found.items()) if found else "none found"))
    return 0


# --- controls -----------------------------------------------------------------------
def cmd_controls(args: argparse.Namespace) -> int:
    print("\n".join(controls.all_names()))
    return 0


# --- test-input ---------------------------------------------------------------------
def cmd_test_input(args: argparse.Namespace) -> int:
    from .executor import Executor, RealTimeClock
    from .plan import parse_plan

    try:
        backend = make_backend(args.device, dry_run=args.dry_run)
    except BackendUnavailable as exc:
        print(f"cannot create the {args.device} device: {exc}", file=sys.stderr)
        return 2
    if args.device == "gamepad":
        if not args.dry_run:
            print("A virtual Xbox 360 controller now exists. Open a controller test "
                  "(Windows: joy.cpl, or Steam > Settings > Controller > Test) to watch it.")
        steps = [{"duration_ms": 3000}]
        steps += [{"buttons": [b], "duration_ms": 250} for b in ("A", "B", "X", "Y", "LB", "RB")]
        steps += [{"buttons": [d], "duration_ms": 250} for d in ("DPAD_UP", "DPAD_RIGHT", "DPAD_DOWN", "DPAD_LEFT")]
        steps += [{"left_stick": {"x": x, "y": y}, "duration_ms": 300}
                  for x, y in ((1, 0), (0, 1), (-1, 0), (0, -1))]
        steps += [{"right_trigger": 1.0, "left_trigger": 1.0, "duration_ms": 400}]
    else:
        _countdown(5, "Mouse square and a Shift tap")
        steps = [{"mouse_move": {"dx": dx, "dy": dy}, "duration_ms": 300}
                 for dx, dy in ((200, 0), (0, 200), (-200, 0), (0, -200))]
        steps += [{"buttons": ["KEY_LEFTSHIFT"], "duration_ms": 100}]
    plan = parse_plan(steps)
    kill = KillSwitch(stop_file_from_env())
    report = Executor(backend, RealTimeClock(), should_stop=kill.check).run(plan)
    print(f"done: {report.summary()}; worst lateness {report.max_late_ms:.1f} ms")
    if args.dry_run:
        for t, kind, value in backend.events:  # type: ignore[attr-defined]
            print(f"  {t:10.3f} {kind:5} {value}")
    backend.close()
    return 0


# --- retroarch ----------------------------------------------------------------------
def cmd_retroarch(args: argparse.Namespace) -> int:
    from .retroarch import RetroArch, RetroArchError

    ra = RetroArch(args.host, args.port)
    try:
        if args.action == "status":
            st = ra.status()
            print(f"{st.state} {st.system} {st.game}".strip())
            print(ra.version())
        elif args.action == "pause":
            ra.set_paused(True)
        elif args.action == "resume":
            ra.set_paused(False)
        elif args.action == "advance":
            for _ in range(args.value or 1):
                ra.frame_advance()
        elif args.action == "save":
            ra.save_state()
        elif args.action == "load":
            ra.load_state()
        elif args.action == "read":
            if args.value is None or args.length is None:
                print("read needs an address and a length: retroarch read 0x7E0019 2", file=sys.stderr)
                return 2
            print(ra.read_memory(args.value, args.length).hex(" "))
    except RetroArchError as exc:
        print(exc, file=sys.stderr)
        return 1
    finally:
        ra.close()
    return 0


# --- launch -------------------------------------------------------------------------
def launch(target: str | list[str]) -> None:
    if not target:
        raise SystemExit("this profile has no game.launch entry")
    if isinstance(target, list):
        subprocess.Popen(target)  # noqa: S603 - the user's own profile
    elif target.startswith("steam://"):
        if sys.platform == "win32":
            os.startfile(target)  # type: ignore[attr-defined]
        else:
            webbrowser.open(target)  # hands steam:// to Steam through the desktop
    else:
        raise SystemExit("game.launch must be a steam:// URL or a command written as a list")


def _load_profile(path: str) -> object | None:
    """Load a settings file, or print a readable error and return None."""
    from .profile import ProfileError, load

    try:
        return load(path)
    except FileNotFoundError:
        print(f"settings file not found: {path} (run this from the folder that contains it)",
              file=sys.stderr)
    except ProfileError as exc:
        print(f"{path}: {exc}", file=sys.stderr)
    return None


def cmd_launch(args: argparse.Namespace) -> int:
    profile = _load_profile(args.profile)
    if profile is None:
        return 2
    launch(profile.game.launch)  # type: ignore[attr-defined]
    return 0


# --- check --------------------------------------------------------------------------
def cmd_check(args: argparse.Namespace) -> int:
    """Check a settings file, find the game window, and save one screenshot."""
    from .imaging import encode_png
    from .window import WindowNotFound, find_window, visible_window_titles

    profile = _load_profile(args.profile)
    if profile is None:
        return 2
    p = profile  # type: ignore[assignment]
    print(f"Settings file OK: {args.profile}")
    print(f"  game:    {p.name}")
    print(f"  device:  {p.input.device}    pacing: {p.pacing.mode}    model: {p.agent.model} "
          f"(effort {p.agent.effort})")
    print(f"  limits:  {p.agent.max_turns} turns, {p.agent.max_minutes:g} min, ${p.agent.max_cost_usd:g}")
    print("  actions Claude can use:")
    for action, targets in p.resolved_bindings().actions.items():
        print(f"    {action:16} -> {' + '.join(c.name for c in targets)}")
    if not p.bindings:
        print("    (none: Claude will use raw control names)")

    try:
        window = find_window(p.game.title_contains)
    except (WindowNotFound, RuntimeError) as exc:
        print(f"\nGame window: NOT FOUND ({exc})")
        titles = visible_window_titles()
        if titles:
            print("Open windows right now (use part of the game's title for title_contains):")
            for t in titles:
                print(f"    {t}")
        else:
            print("Is the game running? title_contains must be part of its window title.")
        return 1
    rect = window.rect()
    where = f"{rect.width}x{rect.height} at ({rect.left}, {rect.top})" if rect else "whole screen"
    print(f"\nGame window: found \"{window.found_title}\", {where}")
    if rect is not None and (rect.width < 100 or rect.height < 100):
        print("  This window is tiny. Is the game minimized? Restore it and run check again.")

    if args.no_screenshot:
        return 0
    from .capture import ScreenCapture

    try:
        cap = ScreenCapture(window)
    except RuntimeError as exc:
        print(f"Screenshot: skipped ({exc})")
        return 1
    try:
        frame = cap.grab()
    finally:
        cap.close()
    out = Path(args.screenshot)
    out.write_bytes(encode_png(frame))
    print(f"Screenshot: saved {out.resolve()} ({frame.width}x{frame.height}). Open it: it should show "
          "only the game. This is what Claude will see.")
    return 0


# --- play ---------------------------------------------------------------------------
def cmd_play(args: argparse.Namespace) -> int:
    from .agent import AntiCheatRunning, GameAgent
    from .capture import ScreenCapture
    from .planner import ClaudePlanner
    from .retroarch import RetroArch
    from .window import WindowNotFound, find_window

    profile = _load_profile(args.profile)
    if profile is None:
        return 2
    if args.model:
        profile.agent.model = args.model
    if args.effort:
        profile.agent.effort = args.effort
    if args.no_focus_check:
        profile.input.focus_check = False
    if args.max_cost is not None:
        profile.agent.max_cost_usd = args.max_cost
    if args.launch:
        launch(profile.game.launch)
        print("launched; waiting 20 s for the game to open")
        time.sleep(20)
    try:
        window = find_window(profile.game.title_contains)
    except (WindowNotFound, RuntimeError) as exc:
        print(f"cannot find the game window: {exc}", file=sys.stderr)
        return 2
    if os.environ.get("XDG_SESSION_TYPE") == "wayland" and profile.input.focus_check:
        print("Wayland session: focus cannot be checked. Use --no-focus-check and keep the game in front.",
              file=sys.stderr)
        return 2
    try:
        backend = make_backend(profile.input.device, dry_run=args.dry_run)
    except BackendUnavailable as exc:
        print(f"cannot create the virtual {profile.input.device}: {exc}", file=sys.stderr)
        return 2
    ra = RetroArch(profile.retroarch.host, profile.retroarch.port) if profile.pacing.mode == "retroarch" else None
    a = profile.agent
    budget = Budget(a.max_turns, a.max_minutes * 60, a.max_cost_usd, a.model)
    planner = ClaudePlanner(profile, on_usage=budget.add_usage)
    agent = GameAgent(
        profile, backend, ScreenCapture(window), planner, window=window, retroarch=ra,
        kill_switch=KillSwitch(stop_file_from_env()), budget=budget,
        transcript=Path(args.transcript) if args.transcript else None,
        frames_dir=Path(args.save_frames) if args.save_frames else None,
    )
    window.activate()
    if not args.dry_run:
        _countdown(3, f"Playing {profile.name}")
    try:
        result = agent.run()
    except AntiCheatRunning as exc:
        print(exc, file=sys.stderr)
        return 3
    finally:
        backend.close()
        if ra:
            ra.close()
    print(f"{result.status}: {result.reason}; {result.turns} turns, about ${result.cost_usd:.2f}")
    return 0 if result.status in ("done", "stopped") else 1


# --- demo ---------------------------------------------------------------------------
def demo_profile(device: str) -> object:
    from .profile import from_dict

    return from_dict({
        "name": "Gem Garden",
        "game": {"fps": 60},
        "input": {"device": device, "focus_check": False},
        "pacing": {"mode": "stepped"},
        "agent": {
            "goal": "Collect 5 yellow gems by walking the red square onto them.",
            "notes": "Top-down grid, 12x9 tiles. Gray tiles are walls. Holding a direction moves one "
                     "tile at once and one more every 8 frames (133 ms). Collected gems show as yellow "
                     "dots in the dark bar at the top.",
            "max_turns": 40, "max_cost_usd": 1.0, "image_max_edge": 400,
        },
        "bindings": {"up": "DPAD_UP", "down": "DPAD_DOWN", "left": "DPAD_LEFT", "right": "DPAD_RIGHT"}
        if device == "gamepad" else {"up": "KEY_W", "down": "KEY_S", "left": "KEY_A", "right": "KEY_D"},
    })


def cmd_demo(args: argparse.Namespace) -> int:
    from .agent import GameAgent
    from .capture import FunctionCapture
    from .executor import SteppedClock
    from .planner import ClaudePlanner
    from .sim import GemGarden, ScriptedGemPlanner, SimBackend

    profile = demo_profile(args.device)
    game = GemGarden(goal=args.gems, seed=args.seed)
    a = profile.agent  # type: ignore[attr-defined]
    budget = Budget(a.max_turns, a.max_minutes * 60, a.max_cost_usd, a.model)
    planner = (ClaudePlanner(profile, on_usage=budget.add_usage) if args.planner == "claude"  # type: ignore[arg-type]
               else ScriptedGemPlanner())
    agent = GameAgent(
        profile, SimBackend(game), FunctionCapture(game.render), planner,  # type: ignore[arg-type]
        clock=SteppedClock(game.step, tick_hz=60, settle_s=0), budget=budget,
        kill_switch=KillSwitch(stop_file_from_env()),
        frames_dir=Path(args.save_frames) if args.save_frames else None,
        process_names=lambda: [],
    )
    result = agent.run()
    print(f"{result.status}: {game.collected}/{game.goal} gems in {game.frame_no} frames, "
          f"{result.turns} turns, about ${result.cost_usd:.2f}")
    return 0 if game.won else 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="gamepilot", description=__doc__)
    ap.add_argument("--version", action="version", version=__version__)
    sub = ap.add_subparsers(dest="command", required=True)

    sub.add_parser("doctor", help="check what works on this computer").set_defaults(fn=cmd_doctor)
    sub.add_parser("controls", help="list every control name").set_defaults(fn=cmd_controls)

    t = sub.add_parser("test-input", help="create a virtual device and exercise it")
    t.add_argument("device", choices=["gamepad", "kbm"])
    t.add_argument("--dry-run", action="store_true", help="record instead of sending")
    t.set_defaults(fn=cmd_test_input)

    p = sub.add_parser("play", help="play a game described by a profile")
    p.add_argument("profile")
    p.add_argument("--dry-run", action="store_true", help="think and plan, but send no input")
    p.add_argument("--launch", action="store_true", help="start the game first (game.launch)")
    p.add_argument("--model")
    p.add_argument("--effort", choices=["low", "medium", "high", "xhigh", "max"])
    p.add_argument("--max-cost", type=float, help="stop after spending about this many USD")
    p.add_argument("--no-focus-check", action="store_true")
    p.add_argument("--transcript", help="append one JSON line per turn to this file")
    p.add_argument("--save-frames", help="save every screenshot sent to the model in this folder")
    p.set_defaults(fn=cmd_play)

    c = sub.add_parser("check", help="check a settings file, find the game window, save a screenshot")
    c.add_argument("profile")
    c.add_argument("--screenshot", default="check.png", help="where to save the screenshot")
    c.add_argument("--no-screenshot", action="store_true")
    c.set_defaults(fn=cmd_check)

    lp = sub.add_parser("launch", help="start the game in a profile")
    lp.add_argument("profile")
    lp.set_defaults(fn=cmd_launch)

    d = sub.add_parser("demo", help="play the built-in Gem Garden game")
    d.add_argument("--planner", choices=["scripted", "claude"], default="scripted")
    d.add_argument("--device", choices=["gamepad", "kbm"], default="gamepad")
    d.add_argument("--gems", type=int, default=5)
    d.add_argument("--seed", type=int, default=7)
    d.add_argument("--save-frames")
    d.set_defaults(fn=cmd_demo)

    r = sub.add_parser("retroarch", help="send a network command to RetroArch")
    r.add_argument("action", choices=["status", "pause", "resume", "advance", "save", "load", "read"])
    r.add_argument("value", nargs="?", type=lambda s: int(s, 0), help="frames to advance, or address")
    r.add_argument("length", nargs="?", type=int, help="bytes to read")
    r.add_argument("--host", default="127.0.0.1")
    r.add_argument("--port", type=int, default=55355)
    r.set_defaults(fn=cmd_retroarch)

    args = ap.parse_args(argv)
    return int(args.fn(args))


if __name__ == "__main__":
    sys.exit(main())
