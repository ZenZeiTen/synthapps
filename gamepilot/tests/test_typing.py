import unittest

from synthapps_gamepilot.backends.record import RecordingBackend
from synthapps_gamepilot.executor import Timing, compile_plan
from synthapps_gamepilot.plan import PlanError, parse_plan


def typed(text):
    """What a US-layout keyboard driver would produce from the recorded key events."""
    from synthapps_gamepilot.controls import TEXT_KEYS

    backend = RecordingBackend()
    for tick in compile_plan(parse_plan([{"type_text": text}]), Timing(60, 2, 2), 120):
        backend.apply(tick)
    by_key = {(k, s): c for c, (k, s) in TEXT_KEYS.items()}
    out, shift = [], False
    for _, kind, name in backend.events:
        if name == "KEY_LEFTSHIFT":
            shift = kind == "down"
        elif kind == "down":
            out.append(by_key[(name[4:], shift)])
    return "".join(out), backend


class TypingTest(unittest.TestCase):
    def test_round_trip(self):
        for text in ("Water the plants", "Hello, World! (v2.0) a+b=c? 'yes' \"no\" ~/path_1|x", "aa  bb"):
            with self.subTest(text=text):
                result, backend = typed(text)
                self.assertEqual(result, text)
                self.assertEqual(backend.held_now(), set())

    def test_shift_goes_down_first_and_up_last(self):
        _, backend = typed("A")
        names = [(k, v) for _, k, v in backend.events]
        self.assertEqual(names, [("down", "KEY_LEFTSHIFT"), ("down", "KEY_A"),
                                 ("up", "KEY_A"), ("up", "KEY_LEFTSHIFT")])

    def test_rejections(self):
        for step, message in (
            ({"type_text": "héllo"}, "cannot be typed"),
            ({"type_text": ""}, "non-empty"),
            ({"type_text": "x" * 201}, "at most 200"),
            ({"type_text": "hi", "duration_ms": 50}, "no other fields"),
        ):
            with self.subTest(step=step), self.assertRaises(PlanError) as ctx:
                parse_plan([step])
            self.assertIn(message, str(ctx.exception))

    def test_counts_as_one_step_for_the_limit(self):
        plan = parse_plan([{"type_text": "x" * 150}] + [{"duration_ms": 1}] * 39)
        self.assertEqual(len(plan.steps), 189)


if __name__ == "__main__":
    unittest.main()
