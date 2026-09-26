"""Gateway server and guest runner, exercised over local Unix sockets.

Under Firecracker the guest's vsock connection arrives at the host as exactly
this kind of Unix socket, so the same code paths are covered. Nothing here
touches a network.
"""

from __future__ import annotations

import contextlib
import json
import os
import socket
import tempfile
import time
import unittest

from synthapps_zenzeiworld.guest import (
    MAX_FRAME_BYTES,
    WAIT_ACTION,
    GatewayClient,
    ProtocolError,
    extract_action,
    run,
)
from synthapps_zenzeiworld.kernel import AgentStatus, OperatorConsole, WorldKernel
from synthapps_zenzeiworld.server import GatewayServer, ServerConfig
from synthapps_zenzeiworld.world import default_world
from tests.helpers import needs_unix_sockets


class ScriptedBroker:
    def __init__(self, replies: list[str]) -> None:
        self.replies = list(replies)
        self.prompts: list[tuple[str, str]] = []

    def complete(self, agent_id: str, prompt: str) -> str:
        self.prompts.append((agent_id, prompt))
        return self.replies.pop(0) if self.replies else "I will rest."


class BrokenBroker:
    def complete(self, agent_id: str, prompt: str) -> str:
        raise RuntimeError("upstream credentials: sk-should-never-leak")


def wait_until(condition: object, timeout: float = 2.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():  # type: ignore[operator]
            return True
        time.sleep(0.01)
    return False


@needs_unix_sockets
class ServerTestCase(unittest.TestCase):
    broker: object = None

    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="zw-")
        self.kernel = WorldKernel(default_world())
        self.console = OperatorConsole(self.kernel, operators={"alice", "bashir"})
        self.server = GatewayServer(self.kernel, broker=self.broker,  # type: ignore[arg-type]
                                    config=ServerConfig(read_timeout_seconds=5))
        self.paths: dict[str, str] = {}
        for agent_id, (x, y) in {"ada": (20.0, 21.0), "bo": (30.0, 21.0)}.items():
            token = self.kernel.spawn(agent_id, agent_id.title(), x, y)
            self.paths[agent_id] = os.path.join(self.tmp, f"{agent_id}.sock_5000")
            self.server.bind_agent(agent_id, token, self.paths[agent_id])
        self.server.start()
        self.clients: list[GatewayClient] = []

    def tearDown(self) -> None:
        for client in self.clients:
            client.close()
        self.server.stop()
        os.rmdir(self.tmp)

    def client(self, agent_id: str) -> GatewayClient:
        client = GatewayClient.connect_unix(self.paths[agent_id])
        self.clients.append(client)
        return client

    def raw(self, agent_id: str) -> socket.socket:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(3)
        sock.connect(self.paths[agent_id])
        return sock


class GatewayTests(ServerTestCase):
    def test_socket_is_private_to_its_owner(self) -> None:
        self.assertEqual(os.stat(self.paths["ada"]).st_mode & 0o777, 0o600)

    def test_observe_and_submit_round_trip(self) -> None:
        ada = self.client("ada")
        self.assertEqual(ada.observe()["self"]["id"], "ada")
        result = ada.submit('{"action": "say", "params": {"text": "Hello"}}')
        self.assertEqual(result, {"ok": True, "result": {"ok": True, "code": "ok"}})

    def test_identity_comes_from_the_socket_not_the_payload(self) -> None:
        ada = self.client("ada")
        ada.submit('{"action": "move", "params": {"dx": 1, "dy": 0}}')
        self.assertAlmostEqual(self.kernel.world.avatars["ada"].x, 21.0)
        self.assertEqual(self.kernel.world.avatars["bo"].x, 30.0)
        self.assertEqual(self.client("bo").observe()["self"]["id"], "bo")

    def test_kernel_rules_still_apply_through_the_gateway(self) -> None:
        reply = self.client("ada").submit('{"action": "exec", "params": {"cmd": "id"}}')
        self.assertEqual(reply["result"]["code"], "unknown_action")

    def test_oversized_frame_closes_the_connection_and_counts(self) -> None:
        sock = self.raw("ada")
        # The server may hang up before we finish sending.
        with contextlib.suppress(OSError):
            sock.sendall(b"x" * (MAX_FRAME_BYTES + 1024))
        try:
            leftover = sock.recv(1)
        except OSError:
            leftover = b""
        sock.close()
        self.assertEqual(leftover, b"")
        self.assertTrue(wait_until(lambda: self.kernel.monitor.score("ada") > 0))

    def test_malformed_frames_are_answered_then_the_connection_is_dropped(self) -> None:
        sock = self.raw("ada")
        for frame in (b"not json\n", b"[1,2]\n", b'{"op":"exec","cmd":"id"}\n'):
            sock.sendall(frame)
        data = b""
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            data += chunk
        sock.close()
        replies = [json.loads(line) for line in data.splitlines()]
        self.assertEqual([r["code"] for r in replies], ["protocol_error"] * 3)
        self.assertGreaterEqual(self.kernel.monitor.score("ada"), 3 * 8 * 0.9)

    def test_extra_fields_in_a_frame_are_rejected(self) -> None:
        sock = self.raw("ada")
        sock.sendall(b'{"op":"observe","agent":"bo"}\n')
        reply = json.loads(sock.recv(4096))
        sock.close()
        self.assertEqual(reply["code"], "protocol_error")

    def test_only_one_connection_per_agent(self) -> None:
        first = self.client("ada")
        first.observe()
        second = self.raw("ada")
        second.sendall(b'{"op":"observe"}\n')
        try:
            refused = second.recv(4096) == b""
        except ConnectionResetError:
            refused = True
        second.close()
        self.assertTrue(refused)
        self.assertEqual(first.observe()["self"]["id"], "ada")

    def test_infer_is_unavailable_without_a_broker(self) -> None:
        self.assertIsNone(self.client("ada").infer("hello"))


class BrokerTests(ServerTestCase):
    def setUp(self) -> None:
        self.broker = ScriptedBroker([])
        super().setUp()

    def test_prompts_reach_the_broker_tagged_with_the_right_agent(self) -> None:
        self.broker.replies = ["hi there"]  # type: ignore[attr-defined]
        self.assertEqual(self.client("bo").infer("what now?"), "hi there")
        self.assertEqual(self.broker.prompts, [("bo", "what now?")])  # type: ignore[attr-defined]

    def test_inference_has_a_per_tick_budget(self) -> None:
        bo = self.client("bo")
        self.assertIsNotNone(bo.infer("1"))
        self.assertIsNotNone(bo.infer("2"))
        self.assertIsNone(bo.infer("3"))
        self.server.step()
        self.assertIsNotNone(bo.infer("4"))

    def test_quarantined_agents_get_no_inference(self) -> None:
        self.console.quarantine("alice", "ada", "review")
        self.assertIsNone(self.client("ada").infer("let me out"))
        self.assertEqual(self.broker.prompts, [])  # type: ignore[attr-defined]


class BrokenBrokerTests(ServerTestCase):
    def setUp(self) -> None:
        self.broker = BrokenBroker()
        super().setUp()

    def test_broker_errors_never_reach_the_guest(self) -> None:
        sock = self.raw("ada")
        sock.sendall(b'{"op":"infer","prompt":"hi"}\n')
        reply = sock.recv(4096)
        sock.close()
        self.assertEqual(json.loads(reply), {"ok": False, "code": "unavailable"})
        self.assertNotIn(b"sk-", reply)


class GuestRunnerTests(ServerTestCase):
    def setUp(self) -> None:
        self.broker = ScriptedBroker([
            'Sure! {"action": "say", "params": {"text": "Good morning, town!"}}',
            'I think I will walk: {"action": "move", "params": {"dx": 1, "dy": 0}} ok?',
            "Let me just run rm -rf / first.",
        ])
        super().setUp()

    def test_runner_plays_turns_and_never_executes_model_output(self) -> None:
        ada = self.client("ada")
        turns = run(ada, max_turns=3, sleep=lambda _: self.server.step())
        self.assertEqual(turns, 3)
        decided = [e.data for e in self.kernel.audit if e.kind == "action_decided"]
        self.assertEqual([d["action"] for d in decided], ["say", "move", "wait"])
        self.assertTrue(all(d["allowed"] for d in decided))
        prompt = self.broker.prompts[0][1]  # type: ignore[attr-defined]
        self.assertIn("untrusted_text", prompt)
        self.assertIn('"id": "ada"', prompt)

    def test_runner_stops_when_the_world_halts(self) -> None:
        self.console.emergency_stop("alice", "drill")
        self.assertEqual(run(self.client("ada"), max_turns=5, sleep=lambda _: None), 0)

    def test_runner_idles_while_suspended(self) -> None:
        self.console.quarantine("alice", "ada", "review")
        polls: list[float] = []
        turns = run(self.client("ada"), max_turns=1,
                    sleep=lambda s: polls.append(s) if len(polls) < 3
                    else self.console.emergency_stop("alice", "end test"))
        self.assertEqual(turns, 0)
        self.assertEqual(len(polls), 3)
        self.assertIs(self.kernel.agent_status("ada"), AgentStatus.QUARANTINED)


class ExtractActionTests(unittest.TestCase):
    def test_finds_the_first_action_object(self) -> None:
        text = 'Thinking {"mood": "ok"} then {"action": "wave"} and {"action": "wait"}'
        self.assertEqual(json.loads(extract_action(text)), {"action": "wave"})

    def test_handles_nested_objects(self) -> None:
        text = 'x {"action": "say", "params": {"text": "a {b} c"}} y'
        self.assertEqual(json.loads(extract_action(text))["params"]["text"], "a {b} c")

    def test_falls_back_to_wait(self) -> None:
        for text in (None, "", "no json here", "{broken", '{"act": "say"}', '{"action": 5}'):
            self.assertEqual(extract_action(text), WAIT_ACTION)


class ClientTests(unittest.TestCase):
    def test_client_refuses_oversized_frames_before_sending(self) -> None:
        left, right = socket.socketpair()
        client = GatewayClient(left)
        with self.assertRaises(ProtocolError):
            client.submit("x" * MAX_FRAME_BYTES)
        client.close()
        right.close()


if __name__ == "__main__":
    unittest.main()
