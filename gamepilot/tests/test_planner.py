import unittest
from types import SimpleNamespace

from synthapps_gamepilot.__main__ import demo_profile
from synthapps_gamepilot.planner import ClaudePlanner, Observation, act_tool, system_prompt
from synthapps_gamepilot.sim import GemGarden

from .helpers import FakeClient, act, response, tool_use


def obs(turn, result="ok", error=False, frames=1):
    g = GemGarden()
    return Observation([g.render()] * frames, result, turn, {"lives": "3"}, error)


class PlannerTest(unittest.TestCase):
    def setUp(self):
        self.profile = demo_profile("gamepad")
        self.usage = []

    def planner(self, client, **kw):
        return ClaudePlanner(self.profile, client=client, on_usage=lambda *u: self.usage.append(u),
                             log=lambda m: None, sleep=lambda s: None, **kw)

    def test_request_shape_and_threading(self):
        client = FakeClient([
            response([SimpleNamespace(type="thinking", thinking="", signature="s"),
                      tool_use("t1", act([{"buttons": ["up"], "duration_ms": 100}], memory="gem is north"))]),
            response([tool_use("t2", act([], status="done"))]),
        ])
        p = self.planner(client)
        d1 = p.decide(obs(1, frames=2))
        self.assertEqual(d1.steps, [{"buttons": ["up"], "duration_ms": 100}])
        self.assertEqual(p.memory, "gem is north")
        req = client.requests[0]
        self.assertEqual(req["model"], "claude-opus-5-5")
        self.assertEqual(req["betas"], ["server-side-fallback-2026-07-01"])
        self.assertEqual(req["extra_body"]["fallbacks"], "default")
        self.assertEqual(req["extra_body"]["output_config"], {"effort": "low"})
        self.assertEqual(req["tool_choice"], {"type": "auto"})
        self.assertNotIn("thinking", req)
        kinds = [b["type"] for b in req["messages"][0]["content"]]
        self.assertEqual(kinds, ["text", "image", "image", "text"])
        self.assertIn("lives=3", req["messages"][0]["content"][-1]["text"])

        d2 = p.decide(obs(2, "Plan completed: 9/9 ticks"))
        self.assertEqual(d2.status, "done")
        msgs = client.requests[1]["messages"]
        self.assertEqual([m["role"] for m in msgs], ["user", "assistant", "user"])
        self.assertEqual(msgs[1]["content"][0].type, "thinking")  # passed back unchanged
        first = msgs[2]["content"][0]
        self.assertEqual((first["type"], first["tool_use_id"]), ("tool_result", "t1"))
        self.assertIn("gem is north", msgs[2]["content"][-1]["text"])
        self.assertEqual(len(self.usage), 2)

    def test_history_is_append_only(self):
        client = FakeClient(fn=lambda req: response([tool_use(f"t{len(req['messages'])}", act([]))]))
        p = self.planner(client)
        for turn in range(1, 6):
            p.decide(obs(turn))
        for earlier, later in zip(client.requests, client.requests[1:], strict=False):
            n = len(earlier["messages"])
            self.assertEqual(later["messages"][:n], earlier["messages"])

    def test_rollover_starts_fresh_and_carries_notes(self):
        self.profile.agent.turns_per_conversation = 2
        counter = {"n": 0}

        def reply(req):
            counter["n"] += 1
            return response([tool_use(f"t{counter['n']}", act([], memory=f"note {counter['n']}"))])

        client = FakeClient(fn=reply)
        p = self.planner(client)
        for turn in range(1, 4):
            p.decide(obs(turn))
        third = client.requests[2]["messages"]
        self.assertEqual(len(third), 1)
        self.assertEqual(third[0]["content"][0]["type"], "text")
        self.assertIn("continues an earlier session", third[0]["content"][0]["text"])
        self.assertIn("note 2", third[0]["content"][-1]["text"])

    def test_nudges_when_no_tool_call(self):
        client = FakeClient([
            response([SimpleNamespace(type="text", text="I will go up.")], stop="end_turn"),
            response([tool_use("t1", act([{"duration_ms": 50}]))]),
        ])
        d = self.planner(client).decide(obs(1))
        self.assertEqual(d.steps, [{"duration_ms": 50}])
        nudge = client.requests[1]["messages"][-1]
        self.assertEqual(nudge["role"], "user")
        self.assertIn("act tool", nudge["content"][-1]["text"])

    def test_extra_tool_calls_get_results(self):
        client = FakeClient([
            response([tool_use("a1", act([{"duration_ms": 10}])), tool_use("a2", act([{"duration_ms": 20}]))]),
            response([tool_use("a3", act([]))]),
        ])
        p = self.planner(client)
        self.assertEqual(p.decide(obs(1)).steps, [{"duration_ms": 10}])
        p.decide(obs(2))
        results = [b for b in client.requests[1]["messages"][2]["content"] if b["type"] == "tool_result"]
        self.assertEqual([r["tool_use_id"] for r in results], ["a1", "a2"])
        self.assertTrue(results[1]["is_error"])

    def test_refusal(self):
        client = FakeClient([response([], stop="refusal",
                                      stop_details=SimpleNamespace(explanation="policy"))])
        d = self.planner(client).decide(obs(1))
        self.assertEqual(d.status, "refused")
        self.assertIn("policy", d.observation)

    def test_gives_up_after_three_tries(self):
        client = FakeClient(fn=lambda req: response([SimpleNamespace(type="text", text="hmm")], stop="end_turn"))
        d = self.planner(client).decide(obs(1))
        self.assertEqual(d.status, "stuck")
        self.assertEqual(len(client.requests), 3)

    def test_rejected_plan_is_an_error_result(self):
        client = FakeClient(fn=lambda req: response([tool_use(f"t{len(req['messages'])}", act([]))]))
        p = self.planner(client)
        p.decide(obs(1))
        p.decide(obs(2, "Your plan was rejected", error=True))
        self.assertTrue(client.requests[1]["messages"][2]["content"][0]["is_error"])

    def test_tool_and_prompt(self):
        self.assertNotIn("emulator", act_tool(False)["input_schema"]["properties"])
        self.assertIn("emulator", act_tool(True)["input_schema"]["properties"])
        text = system_prompt(self.profile)
        self.assertIn("frozen while you think", text)
        self.assertIn("up: DPAD_UP", text)

    def test_works_with_older_sdk_signatures(self):
        # Older anthropic releases reject fallbacks, cache_control and output_config as keyword
        # arguments; they must travel in extra_body, which every release accepts.
        requests = []

        def create(*, model, max_tokens, messages, system=None, tools=None, tool_choice=None,
                   betas=None, extra_body=None, **unsupported):
            if unsupported:
                raise TypeError(f"unexpected keyword argument {sorted(unsupported)[0]!r}")
            requests.append(extra_body)
            return response([tool_use("t1", act([]))])

        client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(create=create)))
        self.planner(client).decide(obs(1))
        self.assertEqual(requests[0]["fallbacks"], "default")
        self.assertEqual(requests[0]["output_config"], {"effort": "low"})
        self.assertEqual(requests[0]["cache_control"], {"type": "ephemeral"})

    def test_no_fallbacks_option(self):
        client = FakeClient([response([tool_use("t", act([]))])])
        self.planner(client, use_fallbacks=False).decide(obs(1))
        self.assertNotIn("fallbacks", client.requests[0]["extra_body"])
        self.assertNotIn("betas", client.requests[0])


if __name__ == "__main__":
    unittest.main()
