import unittest

from synthapps_gamepilot import controls
from synthapps_gamepilot.controls import Kind
from synthapps_gamepilot.plan import Bindings, PlanError, describe, parse_plan


class ControlsTest(unittest.TestCase):
    def test_names_and_aliases(self):
        self.assertEqual(controls.resolve("a").name, "A")
        self.assertEqual(controls.resolve("L1").name, "LB")
        self.assertEqual(controls.resolve("up").name, "DPAD_UP")
        self.assertEqual(controls.resolve("KEY_UP").name, "KEY_UP")
        self.assertEqual(controls.resolve("KEY_UP").kind, Kind.KEY)
        self.assertEqual(controls.resolve("w").name, "KEY_W")
        self.assertEqual(controls.resolve("space").name, "KEY_SPACE")
        self.assertEqual(controls.resolve("key_escape").name, "KEY_ESC")
        self.assertEqual(controls.resolve("mouse_left").kind, Kind.MOUSE_BUTTON)
        self.assertEqual(controls.resolve("ls_right").kind, Kind.STICK_DIRECTION)

    def test_unknown(self):
        for bad in ("", "KEY_NOPE", "TURBO", "MOUSE_SIDEWAYS"):
            with self.assertRaises(controls.UnknownControl):
                controls.resolve(bad)

    def test_scan_codes(self):
        self.assertEqual(controls.KEYS["W"][:2], (0x11, False))
        self.assertEqual(controls.KEYS["SPACE"][:2], (0x39, False))
        self.assertEqual(controls.KEYS["UP"][:2], (0x48, True))
        self.assertEqual(controls.KEYS["F12"], (0x58, False, 88))
        self.assertEqual(controls.KEYS["RIGHTCTRL"], (0x1D, True, 97))


class PlanTest(unittest.TestCase):
    def setUp(self):
        self.b = Bindings.from_mapping({"jump": "A", "dash": ["X", "RB"], "fwd": "KEY_W"})

    def test_parse_with_bindings(self):
        plan = parse_plan([
            {"buttons": ["jump", "RIGHT"], "duration_ms": 200},
            {"left_stick": {"x": 0.5, "y": -1}, "right_trigger": 1, "duration_ms": 100,
             "release_after": False},
            {"buttons": ["dash"], "mouse_move": {"dx": 30, "dy": -4}, "duration_ms": 50},
            {"duration_ms": 300},
        ], self.b, "test")
        self.assertEqual(len(plan.steps), 4)
        self.assertEqual({c.name for c in plan.steps[0].controls}, {"A", "DPAD_RIGHT"})
        self.assertEqual({c.name for c in plan.steps[2].controls}, {"X", "RB"})
        self.assertEqual(plan.steps[1].left_stick, (0.5, -1.0))
        self.assertFalse(plan.steps[1].release_after)
        self.assertEqual(plan.duration_ms, 650)
        self.assertIn("mouse(+30,-4)", describe(plan))

    def test_rejections_explain_themselves(self):
        cases = [
            ({"buttons": ["jump"]}, "duration_ms is required"),
            ({"duration_ms": 0}, "between"),
            ({"duration_ms": 10, "buttons": "A"}, "list"),
            ({"duration_ms": 10, "buttons": ["fly"]}, "profile actions are"),
            ({"duration_ms": 10, "left_stick": {"x": 2, "y": 0}}, "between -1 and 1"),
            ({"duration_ms": 10, "left_stick": {"x": 0, "z": 0}}, "unknown fields"),
            ({"duration_ms": 10, "teleport": True}, "unknown fields"),
            ({"duration_ms": 10, "release_after": "yes"}, "true or false"),
            ({"duration_ms": 10, "mouse_move": {"dx": 99999, "dy": 0}}, "between"),
            ({"duration_ms": True}, "number"),
        ]
        for step, message in cases:
            with self.subTest(step=step):
                with self.assertRaises(PlanError) as ctx:
                    parse_plan([step], self.b)
                self.assertIn(message, str(ctx.exception))

    def test_plan_limits(self):
        with self.assertRaises(PlanError):
            parse_plan([{"duration_ms": 1}] * 41)
        with self.assertRaises(PlanError):
            parse_plan([{"duration_ms": 5000}] * 4)
        with self.assertRaises(PlanError):
            parse_plan({"duration_ms": 5})

    def test_bad_binding(self):
        with self.assertRaises(PlanError):
            Bindings.from_mapping({"jump": "Q_BUTTON"})
        with self.assertRaises(PlanError):
            Bindings.from_mapping({"jump": []})


if __name__ == "__main__":
    unittest.main()
