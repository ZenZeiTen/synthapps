import tempfile
import unittest
from pathlib import Path

from synthapps_gamepilot.__main__ import demo_profile
from synthapps_gamepilot.agent import GameAgent
from synthapps_gamepilot.backends import uinput, win_sendinput
from synthapps_gamepilot.backends.record import RecordingBackend
from synthapps_gamepilot.capture import Capture
from synthapps_gamepilot.executor import SteppedClock, Timing, compile_plan
from synthapps_gamepilot.imaging import Frame
from synthapps_gamepilot.plan import PlanError, PointerMap, map_pointer, parse_plan
from synthapps_gamepilot.planner import ClaudePlanner, Decision, Observation, system_prompt
from synthapps_gamepilot.safety import KillSwitch

from .helpers import FakeClient, FakeUInput, act, fake_evdev, response, tool_use

T60 = Timing(60, 2, 2)
CLICK = {"mouse_to": {"x": 480, "y": 270}, "buttons": ["MOUSE_LEFT"], "duration_ms": 50}


class PlanTest(unittest.TestCase):
    def test_parse_and_map(self):
        plan = parse_plan([CLICK])
        self.assertEqual(plan.steps[0].pointer, (480.0, 270.0))
        where = PointerMap(100, 50, 1920, 1080, 960, 540)
        mapped = map_pointer(plan, where)
        self.assertEqual(mapped.steps[0].pointer, (100 + 961, 50 + 541))  # centre of that pixel
        corner = map_pointer(parse_plan([{"mouse_to": {"x": 959, "y": 539}, "duration_ms": 5}]), where)
        self.assertEqual(corner.steps[0].pointer, (100 + 1919, 50 + 1079))

    def test_rejections(self):
        where = PointerMap(0, 0, 1920, 1080, 960, 540)
        with self.assertRaises(PlanError) as ctx:
            map_pointer(parse_plan([{"mouse_to": {"x": 960, "y": 10}, "duration_ms": 5}]), where)
        self.assertIn("960x540", str(ctx.exception))
        with self.assertRaises(PlanError):
            map_pointer(parse_plan([CLICK]), None)
        with self.assertRaises(PlanError):
            parse_plan([{"mouse_to": {"x": 1}, "duration_ms": 5}])
        self.assertIs(map_pointer(p := parse_plan([{"duration_ms": 5}]), None), p)


class TickTest(unittest.TestCase):
    def test_pointer_moves_a_frame_before_the_click(self):
        plan = map_pointer(parse_plan([CLICK]), PointerMap(0, 0, 960, 540, 960, 540))
        ticks = compile_plan(plan, T60, 60)
        self.assertEqual(ticks[0].pointer, (480, 270))
        self.assertEqual(ticks[0].held, frozenset())
        self.assertEqual({c.name for c in ticks[1].held}, {"MOUSE_LEFT"})
        self.assertIsNone(ticks[1].pointer)

    def test_drag_keeps_the_button_held(self):
        plan = parse_plan([
            {"mouse_to": {"x": 10, "y": 10}, "buttons": ["MOUSE_LEFT"], "duration_ms": 50, "release_after": False},
            {"mouse_to": {"x": 300, "y": 200}, "buttons": ["MOUSE_LEFT"], "duration_ms": 50},
        ])
        ticks = compile_plan(plan, T60, 60)
        jump = [t for t in ticks if t.pointer == (300, 200)][0]
        self.assertEqual({c.name for c in jump.held}, {"MOUSE_LEFT"})
        backend = RecordingBackend()
        for t in ticks:
            backend.apply(t)
        self.assertEqual(backend.presses("MOUSE_LEFT"), 1)
        kinds = [k for _, k, _ in backend.events]
        self.assertEqual(kinds, ["pointer", "down", "pointer", "up"])


class BackendTest(unittest.TestCase):
    def test_sendinput_absolute_move_before_click(self):
        sent = []

        def fake_send(n, array, size):
            sent.extend(array[i] for i in range(n))
            return n

        b = win_sendinput.SendInputKeyboardMouse(send=fake_send, desktop=lambda: (-1920, 0, 3840, 1080))
        from synthapps_gamepilot.backends.base import InputState
        from synthapps_gamepilot.controls import resolve

        b.apply(InputState(frozenset({resolve("MOUSE_LEFT")}), pointer=(0, 1079)))
        first, second = sent[0], sent[1]
        self.assertEqual(first.mi.dwFlags, 0x0001 | 0x8000 | 0x4000)
        self.assertEqual((first.mi.dx, first.mi.dy), (round(1920 * 65535 / 3839), 65535))
        self.assertEqual(second.mi.dwFlags, 0x0002)  # left button down, after the move

    def test_uinput_pointer(self):
        moves = []
        kbm = uinput.UInputKeyboardMouse(module=fake_evdev(), pointer=lambda x, y: moves.append((x, y)))
        self.assertTrue(kbm.supports_pointer)
        from synthapps_gamepilot.backends.base import InputState

        kbm.apply(InputState(pointer=(12, 34)))
        self.assertEqual(moves, [(12, 34)])
        FakeUInput.instances.clear()
        self.assertFalse(uinput.UInputKeyboardMouse(module=fake_evdev(), pointer=None).supports_pointer)


class Screen(Capture):
    def __init__(self):
        self.frame = Frame(1920, 1080, bytes(1920 * 1080 * 3))

    def grab(self):
        self.last_region = (100, 50, 1920, 1080)
        return self.frame


class ListPlanner:
    def __init__(self, decisions):
        self.decisions, self.seen = list(decisions), []

    def decide(self, obs):
        self.seen.append(obs)
        return self.decisions.pop(0) if self.decisions else Decision(steps=[], status="done")


class AgentTest(unittest.TestCase):
    def run_agent(self, decisions):
        profile = demo_profile("kbm")
        profile.agent.image_max_edge = 960
        backend = RecordingBackend()
        planner = ListPlanner(decisions)
        agent = GameAgent(profile, backend, Screen(), planner,
                          clock=SteppedClock(lambda: None, tick_hz=60, settle_s=0),
                          kill_switch=KillSwitch(Path(tempfile.mkdtemp()) / "STOP"),
                          process_names=lambda: [], log=lambda m: None, sleep=lambda s: None)
        agent.run()
        return backend, planner

    def test_click_lands_on_the_screen_position(self):
        backend, _ = self.run_agent([Decision(steps=[CLICK])])
        pointer = [v for _, k, v in backend.events if k == "pointer"]
        self.assertEqual(pointer, [(100 + 961, 50 + 541)])
        self.assertEqual(backend.presses("MOUSE_LEFT"), 1)

    def test_outside_click_is_rejected_and_explained(self):
        backend, planner = self.run_agent([Decision(steps=[{"mouse_to": {"x": 1500, "y": 10}, "duration_ms": 9}])])
        self.assertTrue(planner.seen[1].last_result_is_error)
        self.assertIn("960x540", planner.seen[1].last_result)
        self.assertEqual(backend.events, [])


class PlannerTextTest(unittest.TestCase):
    def test_prompt_and_size(self):
        kbm = demo_profile("kbm")
        self.assertIn("mouse_to", system_prompt(kbm))
        self.assertNotIn("mouse_to {x, y}", system_prompt(demo_profile("gamepad")))
        client = FakeClient([response([tool_use("t", act([CLICK]))])])
        kbm.agent.image_max_edge = 960
        ClaudePlanner(kbm, client=client, log=lambda m: None).decide(
            Observation([Frame(1920, 1080, bytes(1920 * 1080 * 3))], "start", 1))
        status = client.requests[0]["messages"][0]["content"][-1]["text"]
        self.assertIn("Screenshot size: 960x540", status)


if __name__ == "__main__":
    unittest.main()
