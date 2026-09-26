import contextlib
import json
import random
import unittest

from synthapps_zenzeiworld.actions import (
    MAX_REQUEST_BYTES,
    ActionRejected,
    ActionType,
    parse_action,
)


class ParseActionTests(unittest.TestCase):
    def assertRejected(self, raw: object, code: str) -> None:
        with self.assertRaises(ActionRejected) as ctx:
            parse_action(raw)
        self.assertEqual(ctx.exception.code, code)

    def test_accepts_well_formed_actions(self) -> None:
        action = parse_action('{"action": "move", "params": {"dx": 1, "dy": -0.5}}')
        self.assertIs(action.kind, ActionType.MOVE)
        self.assertEqual(dict(action.params), {"dx": 1.0, "dy": -0.5})
        self.assertIs(parse_action('{"action": "wait"}').kind, ActionType.WAIT)

    def test_params_are_read_only(self) -> None:
        action = parse_action('{"action": "say", "params": {"text": "hi"}}')
        with self.assertRaises(TypeError):
            action.params["text"] = "changed"  # type: ignore[index]

    def test_unknown_verbs_do_not_exist(self) -> None:
        for verb in ("exec", "shell", "open_socket", "read_file", "__import__", "MOVE"):
            self.assertRejected(json.dumps({"action": verb, "params": {}}), "unknown_action")

    def test_rejects_extra_missing_and_smuggled_fields(self) -> None:
        self.assertRejected('{"action": "say", "params": {"text": "hi", "to": "bo"}}',
                            "invalid_params")
        self.assertRejected('{"action": "say", "params": {}}', "invalid_params")
        self.assertRejected('{"action": "say", "params": {"text": "hi"}, "agent_id": "bo"}',
                            "invalid_request")

    def test_rejects_wrong_types(self) -> None:
        self.assertRejected('{"action": "move", "params": {"dx": true, "dy": 0}}',
                            "invalid_params")
        self.assertRejected('{"action": "move", "params": {"dx": "1", "dy": 0}}',
                            "invalid_params")
        self.assertRejected('{"action": "move", "params": {"dx": 1e308, "dy": 0}}',
                            "invalid_params")
        self.assertRejected('{"action": "pick_up", "params": {"object": "../../etc"}}',
                            "invalid_params")
        self.assertRejected('{"action": "gesture", "params": {"name": "punch"}}',
                            "invalid_params")

    def test_rejects_non_finite_numbers(self) -> None:
        for constant in ("NaN", "Infinity", "-Infinity"):
            self.assertRejected(f'{{"action": "move", "params": {{"dx": {constant}, "dy": 0}}}}',
                                "invalid_request")

    def test_rejects_duplicate_keys(self) -> None:
        self.assertRejected('{"action": "wait", "action": "exec"}', "invalid_request")

    def test_rejects_oversized_before_parsing(self) -> None:
        self.assertRejected(b"{" + b" " * MAX_REQUEST_BYTES + b"}", "too_large")

    def test_rejects_bad_encoding_and_types(self) -> None:
        self.assertRejected(b'{"action": "say", "params": {"text": "\xff"}}', "invalid_encoding")
        self.assertRejected("\ud800", "invalid_encoding")
        self.assertRejected(None, "invalid_request")
        self.assertRejected(42, "invalid_request")
        self.assertRejected("[]", "invalid_request")

    def test_rejects_deep_nesting(self) -> None:
        self.assertRejected('{"action": "say", "params": {"text": {"a": {"b": 1}}}}',
                            "invalid_request")
        self.assertRejected("[" * 1000 + "]" * 1000, "invalid_request")

    def test_rejects_hidden_characters_in_speech(self) -> None:
        for hidden in ("​", "‮", "⁦", "\x00", "\x1b", "﻿", "­"):
            self.assertRejected(json.dumps({"action": "say", "params": {"text": f"a{hidden}b"}}),
                                "invalid_params")

    def test_random_bytes_never_escape_as_other_exceptions(self) -> None:
        rng = random.Random(1234)
        for _ in range(2000):
            blob = bytes(rng.randrange(256) for _ in range(rng.randrange(64)))
            with contextlib.suppress(ActionRejected):
                parse_action(blob)


if __name__ == "__main__":
    unittest.main()
