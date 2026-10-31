import tempfile
import tomllib
import unittest
from pathlib import Path

from synthapps_gamepilot.__main__ import demo_profile
from synthapps_gamepilot.agent import FREE_PLAY, GameAgent
from synthapps_gamepilot.capture import FunctionCapture
from synthapps_gamepilot.executor import SteppedClock
from synthapps_gamepilot.planner import Decision
from synthapps_gamepilot.profile import ProfileError, from_dict
from synthapps_gamepilot.safety import Budget, KillSwitch
from synthapps_gamepilot.sim import GemGarden, SimBackend


class Planner:
    def __init__(self, decisions):
        self.decisions, self.seen = list(decisions), []

    def decide(self, obs):
        self.seen.append(obs)
        return self.decisions.pop(0) if self.decisions else Decision(steps=[], status="done")


def run(profile, decisions, budget=None):
    game = GemGarden()
    planner = Planner(decisions)
    logs = []
    agent = GameAgent(profile, SimBackend(game), FunctionCapture(game.render), planner,
                      clock=SteppedClock(game.step, tick_hz=60, settle_s=0),
                      kill_switch=KillSwitch(Path(tempfile.mkdtemp()) / "STOP"), budget=budget,
                      process_names=lambda: [], log=logs.append, sleep=lambda s: None)
    return agent.run(), planner, logs


DONE = Decision(steps=[], status="done", intent="did it")
WORK = Decision(steps=[{"duration_ms": 20}])


class GoalTest(unittest.TestCase):
    def test_single_goal_stops_when_done(self):
        result, planner, _ = run(demo_profile("gamepad"), [WORK, DONE])
        self.assertEqual((result.status, result.turns), ("done", 2))
        self.assertEqual(planner.seen[0].goal, "")

    def test_goals_are_played_in_order(self):
        profile = demo_profile("gamepad")
        profile.agent.goals = ["Second goal", "Third goal"]
        result, planner, logs = run(profile, [DONE, WORK, DONE, DONE])
        self.assertEqual(result.status, "done")
        self.assertEqual([o.goal for o in planner.seen], ["", "Second goal", "Second goal", "Third goal"])
        self.assertIn("Your next goal: Second goal", planner.seen[1].last_result)
        self.assertTrue(any("next: Third goal" in line for line in logs))

    def test_free_play_continues_until_a_limit(self):
        profile = demo_profile("gamepad")
        profile.agent.free_play = True
        decisions = [Decision(steps=[], status="done", intent=f"thing {i}") for i in range(10)]
        result, planner, _ = run(profile, decisions, budget=Budget(max_turns=4))
        self.assertEqual(result.status, "stopped")
        self.assertIn("turn limit", result.reason)
        self.assertTrue(planner.seen[1].goal.startswith(FREE_PLAY))
        self.assertIn("thing 1", planner.seen[2].goal)  # what Claude did is remembered, not the prompt
        self.assertNotIn(FREE_PLAY, planner.seen[3].goal[len(FREE_PLAY):])


class ProfileGoalTest(unittest.TestCase):
    def test_validation(self):
        p = from_dict({"name": "x", "agent": {"goals": ["a", "b"], "free_play": True}})
        self.assertEqual((p.agent.goals, p.agent.free_play), (["a", "b"], True))
        for bad in ({"goals": "a"}, {"goals": [""]}, {"goals": [1]}, {"free_play": "yes"}):
            with self.subTest(bad=bad), self.assertRaises(ProfileError):
                from_dict({"name": "x", "agent": bad})

    def test_setup_writes_goals(self):
        from synthapps_gamepilot.recognize import Recognition, profile_text
        from synthapps_gamepilot.window import Rect, WindowInfo

        r = Recognition(WindowInfo(1, "G", "g.exe", Rect(0, 0, 800, 600)), "G", "high", "", "G", "kbm",
                        "waits", "", {}, "", "First")
        p = from_dict(tomllib.loads(profile_text(r, goals=["Second"], free_play=True)))
        self.assertEqual((p.agent.goal, p.agent.goals, p.agent.free_play), ("First", ["Second"], True))


if __name__ == "__main__":
    unittest.main()
