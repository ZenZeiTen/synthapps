import tempfile
import unittest
from pathlib import Path

from synthapps_gamepilot.__main__ import demo_profile
from synthapps_gamepilot.agent import AntiCheatRunning, GameAgent
from synthapps_gamepilot.capture import FunctionCapture
from synthapps_gamepilot.executor import SteppedClock
from synthapps_gamepilot.planner import Decision
from synthapps_gamepilot.profile import from_dict
from synthapps_gamepilot.safety import Budget, KillSwitch
from synthapps_gamepilot.sim import GemGarden, ScriptedGemPlanner, SimBackend
from synthapps_gamepilot.window import WindowTracker


class ListPlanner:
    def __init__(self, decisions):
        self.decisions = list(decisions)
        self.seen = []

    def decide(self, obs):
        self.seen.append(obs)
        return self.decisions.pop(0) if self.decisions else Decision(steps=[], status="done")


def make(planner, profile=None, game=None, backend=None, **kw):
    game = game or GemGarden()
    profile = profile or demo_profile("gamepad")
    backend = backend or SimBackend(game)
    tmp = Path(tempfile.mkdtemp())
    kw.setdefault("kill_switch", KillSwitch(tmp / "STOP"))
    kw.setdefault("process_names", lambda: [])
    agent = GameAgent(profile, backend, FunctionCapture(game.render), planner,
                      clock=SteppedClock(game.step, tick_hz=60, settle_s=0), log=lambda m: None,
                      sleep=lambda s: None, **kw)
    return agent, game, backend, tmp


class AgentTest(unittest.TestCase):
    def test_scripted_bot_wins_with_dpad_and_stick(self):
        for stick in (False, True):
            with self.subTest(stick=stick):
                agent, game, backend, _ = make(ScriptedGemPlanner(use_stick=stick), game=GemGarden(goal=6, seed=11))
                result = agent.run()
                self.assertEqual(result.status, "done")
                self.assertTrue(game.won)
                self.assertEqual(game.input.held, frozenset())
                self.assertEqual(game.input.axes, (0.0,) * 6)

    def test_keyboard_profile(self):
        agent, game, _, _ = make(ScriptedGemPlanner(), profile=demo_profile("kbm"))
        # The scripted bot presses d-pad names; the kbm profile's bindings do not change raw names.
        self.assertEqual(agent.run().status, "done")

    def test_bad_plan_is_reported_back_and_nothing_pressed(self):
        planner = ListPlanner([Decision(steps=[{"buttons": ["fly"], "duration_ms": 10}]),
                               Decision(steps=[], status="done")])
        agent, game, backend, _ = make(planner)
        agent.run()
        self.assertTrue(planner.seen[1].last_result_is_error)
        self.assertIn("unknown button or action 'fly'", planner.seen[1].last_result)
        self.assertEqual(backend.presses, [])

    def test_anticheat_blocks_start(self):
        agent, _, backend, _ = make(ListPlanner([]), process_names=lambda: ["EasyAntiCheat_EOS.exe"])
        with self.assertRaises(AntiCheatRunning):
            agent.run()

    def test_anticheat_allowed_when_profile_says_so(self):
        profile = demo_profile("gamepad")
        profile.agent.allow_anticheat = True
        logs = []
        agent, _, _, _ = make(ListPlanner([]), profile=profile, process_names=lambda: ["BEService.exe"])
        agent.log = logs.append
        self.assertEqual(agent.run().status, "done")
        self.assertTrue(any("WARNING" in line for line in logs))

    def test_kill_switch_mid_plan_releases(self):
        game = GemGarden()
        agent, _, backend, tmp = make(
            ListPlanner([Decision(steps=[{"buttons": ["DPAD_RIGHT"], "duration_ms": 5000}])] * 5), game=game)
        frames = {"n": 0}

        def step():
            frames["n"] += 1
            game.step()
            if frames["n"] == 30:
                (tmp / "STOP").write_text("")

        agent.clock.advance = step
        result = agent.run()
        self.assertEqual(result.status, "stopped")
        self.assertIn("stop file", result.reason)
        self.assertEqual(game.input.held, frozenset())
        self.assertLess(frames["n"], 40)

    def test_focus_loss_waits_then_resumes(self):
        class Flaky(WindowTracker):
            def __init__(self):
                self.answers = [False, True, True, False]

            def focus_lost(self):
                return self.answers.pop(0) if self.answers else False

        agent, _, _, _ = make(ListPlanner([Decision(steps=[{"duration_ms": 20}]), Decision(steps=[], status="done")]),
                              window=Flaky())
        agent.p.input.focus_check = True
        self.assertEqual(agent.run().status, "done")

    def test_three_stuck_turns_stop(self):
        agent, _, _, _ = make(ListPlanner([Decision(steps=[], status="stuck")] * 3))
        result = agent.run()
        self.assertEqual(result.status, "stuck")

    def test_budget_stops(self):
        agent, _, _, _ = make(ListPlanner([Decision(steps=[{"duration_ms": 10}])] * 10),
                              budget=Budget(max_turns=3))
        result = agent.run()
        self.assertEqual((result.status, result.turns), ("stopped", 3))
        self.assertIn("turn limit", result.reason)

    def test_refusal_stops(self):
        agent, _, _, _ = make(ListPlanner([Decision(steps=[], status="refused", observation="no")]))
        self.assertEqual(agent.run().status, "refused")

    def test_transcript_and_frames(self):
        tmp = Path(tempfile.mkdtemp())
        agent, _, _, _ = make(ScriptedGemPlanner(), transcript=tmp / "t.jsonl", frames_dir=tmp / "f")
        agent.run()
        lines = (tmp / "t.jsonl").read_text().splitlines()
        self.assertGreaterEqual(len(lines), 5)
        self.assertTrue(any((tmp / "f").glob("turn0001_0.png")))


class FakeRetroArch:
    def __init__(self, game):
        self.game, self.calls, self.paused = game, [], False

    def set_paused(self, value):
        self.calls.append(("paused", value))

    def frame_advance(self):
        self.calls.append("advance")
        self.game.step()

    def save_state(self):
        self.calls.append("save")

    def load_state(self):
        self.calls.append("load")

    def read_memory(self, address, length):
        return bytes([3] + [0] * (length - 1))


class RetroArchModeTest(unittest.TestCase):
    def test_paused_frame_advance_and_save_states(self):
        profile = from_dict({
            "name": "Emu", "input": {"focus_check": False}, "pacing": {"mode": "retroarch"},
            "retroarch": {"watch": [{"name": "lives", "address": 0x7E0DBE, "length": 2}]},
            "agent": {"frames_per_turn": 2, "frame_gap_ms": 100},
        })
        game = GemGarden()
        ra = FakeRetroArch(game)
        planner = ListPlanner([Decision(steps=[{"buttons": ["DPAD_RIGHT"], "duration_ms": 1000}],
                                        emulator="save_state"),
                               Decision(steps=[], status="done")])
        agent = GameAgent(profile, SimBackend(game), FunctionCapture(game.render), planner, retroarch=ra,
                          kill_switch=KillSwitch(Path(tempfile.mkdtemp()) / "STOP"),
                          process_names=lambda: [], log=lambda m: None, sleep=lambda s: None)
        agent.clock.settle_s = 0
        self.assertEqual(agent.run().status, "done")
        self.assertEqual(ra.calls[0], ("paused", True))
        self.assertIn("save", ra.calls)
        self.assertEqual(planner.seen[0].memory_readings, {"lives": "3"})
        self.assertEqual(len(planner.seen[0].frames), 2)
        # 6 gap frames before each turn's second screenshot, 61 for the plan
        self.assertEqual(ra.calls.count("advance"), 6 + 61 + 6)


if __name__ == "__main__":
    unittest.main()
