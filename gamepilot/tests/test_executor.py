import unittest

from synthapps_gamepilot.backends.base import NEUTRAL
from synthapps_gamepilot.backends.record import RecordingBackend
from synthapps_gamepilot.executor import (
    Executor,
    RealTimeClock,
    SteppedClock,
    Timing,
    compile_plan,
    ms_to_ticks,
)
from synthapps_gamepilot.plan import parse_plan

from .helpers import FakeTime

T60 = Timing(game_fps=60, min_hold_frames=2, min_release_frames=2)


def names(state):
    return sorted(c.name for c in state.held)


class CompileTest(unittest.TestCase):
    def test_short_press_is_stretched_to_min_hold(self):
        ticks = compile_plan(parse_plan([{"buttons": ["A"], "duration_ms": 1}]), T60, 120)
        # 2 game frames at 60 fps = 4 ticks at 120 Hz, then the final neutral tick
        self.assertEqual([names(t) for t in ticks], [["A"]] * 4 + [[]])

    def test_repress_gets_a_release_gap(self):
        plan = parse_plan([{"buttons": ["A"], "duration_ms": 50}, {"buttons": ["A"], "duration_ms": 50}])
        ticks = compile_plan(plan, T60, 60)
        self.assertEqual([names(t) for t in ticks], [["A"]] * 3 + [[]] * 2 + [["A"]] * 3 + [[]])

    def test_hold_through_steps(self):
        plan = parse_plan([
            {"buttons": ["RIGHT"], "duration_ms": 50, "release_after": False},
            {"buttons": ["RIGHT", "A"], "duration_ms": 50},
        ])
        ticks = compile_plan(plan, T60, 60)
        self.assertTrue(all("DPAD_RIGHT" in names(t) for t in ticks[:-1]))
        self.assertEqual(len(ticks), 3 + 3 + 1)

    def test_gap_only_for_the_repressed_input(self):
        plan = parse_plan([{"buttons": ["RIGHT", "A"], "duration_ms": 50}, {"buttons": ["A"], "duration_ms": 50}])
        ticks = compile_plan(plan, T60, 60)
        self.assertEqual(names(ticks[3]), ["DPAD_RIGHT"])  # A up, RIGHT still held in the gap

    def test_mouse_movement_is_spread_and_exact(self):
        plan = parse_plan([{"mouse_move": {"dx": 101, "dy": -7}, "duration_ms": 100}])
        ticks = compile_plan(plan, T60, 120)
        self.assertEqual(sum(t.mouse_dx for t in ticks), 101)
        self.assertEqual(sum(t.mouse_dy for t in ticks), -7)
        self.assertLessEqual(max(abs(t.mouse_dx) for t in ticks), 9)

    def test_stick_directions_become_axes(self):
        plan = parse_plan([{"buttons": ["LS_UP", "LS_RIGHT", "RS_LEFT"], "duration_ms": 20}])
        state = compile_plan(plan, T60, 60)[0]
        self.assertEqual(state.axes[:4], (1.0, 1.0, -1.0, 0.0))
        self.assertEqual(state.held, frozenset())

    def test_trigger_names_pull_fully(self):
        plan = parse_plan([{"buttons": ["LT", "R2", "A"], "duration_ms": 20}])
        state = compile_plan(plan, T60, 60)[0]
        self.assertEqual(state.axes[4:], (1.0, 1.0))
        self.assertEqual(names(state), ["A"])

    def test_ends_neutral(self):
        plan = parse_plan([{"left_trigger": 0.5, "buttons": ["KEY_W"], "duration_ms": 30}])
        self.assertEqual(compile_plan(plan, T60, 120)[-1], NEUTRAL)

    def test_ms_to_ticks(self):
        self.assertEqual(ms_to_ticks(1000, 60), 60)
        self.assertEqual(ms_to_ticks(1, 60), 1)
        self.assertEqual(ms_to_ticks(17, 60), 2)


class RunTest(unittest.TestCase):
    def test_real_time_clock_keeps_schedule(self):
        ft = FakeTime()
        clock = RealTimeClock(tick_hz=100, now=ft.now, sleep=ft.sleep)
        backend = RecordingBackend(clock=ft.now)
        ex = Executor(backend, clock, T60, now=ft.now)
        report = ex.run(parse_plan([{"buttons": ["A"], "duration_ms": 500}]))
        self.assertTrue(report.completed)
        downs = [t for t, k, v in backend.events if k == "down"]
        ups = [t for t, k, v in backend.events if k == "up"]
        self.assertAlmostEqual(ups[0] - downs[0], 0.5, places=3)
        self.assertEqual(backend.presses("A"), 1)

    def test_stepped_clock_advances_once_per_tick(self):
        frames = []
        clock = SteppedClock(lambda: frames.append(1), tick_hz=60, settle_s=0)
        report = Executor(RecordingBackend(), clock, T60).run(parse_plan([{"buttons": ["A"], "duration_ms": 1000}]))
        self.assertEqual(len(frames), 61)
        self.assertEqual(report.ticks_run, 61)

    def test_stop_releases_everything(self):
        backend = RecordingBackend()
        calls = {"n": 0}

        def stop():
            calls["n"] += 1
            return "kill switch" if calls["n"] > 5 else ""

        clock = SteppedClock(lambda: None, tick_hz=60, settle_s=0)
        report = Executor(backend, clock, T60, should_stop=stop).run(
            parse_plan([{"buttons": ["A", "KEY_W"], "left_stick": {"x": 1, "y": 0}, "duration_ms": 2000}]))
        self.assertEqual(report.stopped, "kill switch")
        self.assertEqual(report.ticks_run, 5)
        self.assertEqual(backend.held_now(), set())
        self.assertEqual(backend.events[-1][1:], ("axes", (0.0,) * 6))

    def test_exception_still_releases(self):
        backend = RecordingBackend()

        ticks = {"n": 0}

        def boom():
            ticks["n"] += 1
            if ticks["n"] == 3:
                raise RuntimeError("device vanished")

        clock = SteppedClock(boom, tick_hz=60, settle_s=0)
        with self.assertRaises(RuntimeError):
            Executor(backend, clock, T60).run(parse_plan([{"buttons": ["B"], "duration_ms": 500}]))
        self.assertEqual(backend.presses("B"), 1)
        self.assertEqual(backend.held_now(), set())

    def test_unsupported_controls_are_reported(self):
        from synthapps_gamepilot.controls import Kind

        backend = RecordingBackend(kinds=frozenset({Kind.PAD_BUTTON}))
        clock = SteppedClock(lambda: None, tick_hz=60, settle_s=0)
        report = Executor(backend, clock, T60).run(parse_plan([{"buttons": ["A", "KEY_W"], "duration_ms": 50}]))
        self.assertEqual(report.unsupported, ["KEY_W"])
        self.assertEqual(backend.presses("KEY_W"), 0)
        self.assertIn("KEY_W", report.summary())


if __name__ == "__main__":
    unittest.main()
