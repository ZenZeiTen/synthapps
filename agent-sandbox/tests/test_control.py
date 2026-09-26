"""Kill switch: control socket, CLI and button, with live agent connections open."""

from __future__ import annotations

import http.client
import io
import json
import os
import signal
import stat
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.parse
from contextlib import redirect_stdout

from synthapps_zenzeiworld.audit import AuditLog
from synthapps_zenzeiworld.control import (
    ControlServer,
    KillSwitchButton,
    control_request,
    load_or_create_token,
    main,
)
from synthapps_zenzeiworld.guest import GatewayClient, ProtocolError
from synthapps_zenzeiworld.kernel import OperatorConsole, WorldKernel
from synthapps_zenzeiworld.server import GatewayServer, ServerConfig
from synthapps_zenzeiworld.world import default_world
from tests.helpers import needs_posix_permissions, needs_unix_sockets

TOKEN = "t" * 40


@needs_unix_sockets
class KillSwitchTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="zk-")
        self.marker = os.path.join(self.tmp, "vm-stopped")
        self.kernel = WorldKernel(default_world())
        self.console = OperatorConsole(self.kernel, operators={"alice", "bashir"})
        # The stop command stands in for launch-agent-vm.sh stop <id>.
        stop_cmd = [sys.executable, "-c", f"open({self.marker!r}, 'w').close()"]
        self.server = GatewayServer(self.kernel, config=ServerConfig(on_halt_commands=[stop_cmd]))
        self.paths = {}
        for agent_id, (x, y) in {"ada": (20.0, 21.0), "bo": (30.0, 21.0)}.items():
            token = self.kernel.spawn(agent_id, agent_id.title(), x, y)
            self.paths[agent_id] = os.path.join(self.tmp, f"{agent_id}.sock_5000")
            self.server.bind_agent(agent_id, token, self.paths[agent_id])
        self.control_path = os.path.join(self.tmp, "control.sock")
        self.control = ControlServer(self.server, self.console, self.control_path)
        self.button = KillSwitchButton(self.server, self.console, TOKEN)
        self.server.start()
        self.control.start()
        self.button.start()
        self.clients = {a: GatewayClient.connect_unix(p) for a, p in self.paths.items()}
        for client in self.clients.values():
            client.observe()  # connection is live and served

    def tearDown(self) -> None:
        for client in self.clients.values():
            client.close()
        self.button.stop()
        self.control.stop()
        self.server.stop()
        if os.path.exists(self.marker):
            os.unlink(self.marker)
        os.rmdir(self.tmp)

    def assert_contained(self) -> None:
        self.assertTrue(self.kernel.halted)
        report = self.server.halt_report
        self.assertIsNotNone(report)
        assert report is not None
        self.assertEqual(report.connections_closed, 2)
        self.assertEqual([h.returncode for h in report.hooks], [0])
        self.assertTrue(os.path.exists(self.marker))
        for client in self.clients.values():
            with self.assertRaises((ProtocolError, OSError)):
                client.observe()
        for path in self.paths.values():
            with self.assertRaises(OSError):
                GatewayClient.connect_unix(path)

    def post(self, form: dict[str, str], host: str | None = None) -> tuple[int, str]:
        conn = http.client.HTTPConnection("127.0.0.1", self.button.port, timeout=10)
        body = urllib.parse.urlencode(form)
        headers = {"Content-Type": "application/x-www-form-urlencoded",
                   "Host": host or f"127.0.0.1:{self.button.port}"}
        conn.request("POST", "/stop", body=body, headers=headers)
        response = conn.getresponse()
        result = response.status, response.read().decode()
        conn.close()
        return result


class ControlSocketTests(KillSwitchTestCase):
    def test_socket_is_owner_only(self) -> None:
        self.assertEqual(stat.S_IMODE(os.stat(self.control_path).st_mode), 0o600)

    def test_status(self) -> None:
        reply = control_request(self.control_path, {"op": "status"})
        self.assertFalse(reply["status"]["halted"])
        self.assertEqual({a["agent"] for a in reply["status"]["agents"]}, {"ada", "bo"})

    def test_non_operator_cannot_stop(self) -> None:
        reply = control_request(self.control_path, {"op": "emergency_stop",
                                                    "operator": "mallory", "reason": "x"})
        self.assertEqual(reply, {"ok": False, "error": "not an operator"})
        self.assertFalse(self.kernel.halted)
        self.assertEqual(self.clients["ada"].observe()["self"]["id"], "ada")

    def test_emergency_stop_contains_everything(self) -> None:
        reply = control_request(self.control_path, {"op": "emergency_stop",
                                                    "operator": "alice", "reason": "drill"})
        self.assertTrue(reply["ok"])
        self.assertEqual(reply["report"]["connections_closed"], 2)
        self.assert_contained()
        commands = [e.data for e in self.kernel.audit if e.kind == "operator_command"]
        self.assertEqual(commands[-1]["command"], "emergency_stop")

    def test_second_press_changes_nothing(self) -> None:
        first = control_request(self.control_path, {"op": "emergency_stop",
                                                    "operator": "alice", "reason": "1"})
        second = control_request(self.control_path, {"op": "emergency_stop",
                                                     "operator": "bashir", "reason": "2"})
        self.assertEqual(first["report"], second["report"])

    def test_quarantine_and_pause(self) -> None:
        self.assertTrue(control_request(self.control_path, {
            "op": "quarantine", "operator": "alice", "agent": "bo", "reason": "r"})["ok"])
        self.assertEqual(self.clients["bo"].observe(), {"status": "suspended"})
        self.assertEqual(control_request(self.control_path, {
            "op": "quarantine", "operator": "alice", "agent": "zed", "reason": "r"}),
            {"ok": False, "error": "no such agent"})
        self.assertTrue(control_request(self.control_path,
                                        {"op": "pause", "operator": "bashir"})["ok"])
        self.assertTrue(self.kernel.paused)

    def test_cli_stop(self) -> None:
        out = io.StringIO()
        with redirect_stdout(out):
            code = main(["--socket", self.control_path, "stop",
                         "--operator", "alice", "--reason", "cli drill"])
        self.assertEqual(code, 0)
        self.assertIn("client_round_trip_ms", json.loads(out.getvalue()))
        self.assert_contained()

    def test_watchdog_halt_also_cuts_agents_off(self) -> None:
        self.kernel.world.avatars["ada"].x = 50  # corrupt state: inside the workshop
        self.kernel.world.avatars["ada"].y = 35
        self.server.step()
        self.assert_contained()


class ButtonTests(KillSwitchTestCase):
    def test_page_shows_button_and_never_the_token(self) -> None:
        conn = http.client.HTTPConnection("127.0.0.1", self.button.port, timeout=10)
        conn.request("GET", "/")
        response = conn.getresponse()
        page = response.read().decode()
        conn.close()
        self.assertEqual(response.status, 200)
        self.assertIn("STOP THE WORLD", page)
        self.assertNotIn(TOKEN, page)
        self.assertIn("frame-ancestors 'none'", response.getheader("Content-Security-Policy", ""))

    def test_wrong_token_stops_nothing(self) -> None:
        status, page = self.post({"operator": "alice", "token": "x" * 40, "reason": "r"})
        self.assertEqual(status, 403)
        self.assertIn("Nothing was stopped", page)
        self.assertFalse(self.kernel.halted)

    def test_unknown_operator_stops_nothing(self) -> None:
        status, _ = self.post({"operator": "mallory", "token": TOKEN, "reason": "r"})
        self.assertEqual(status, 403)
        self.assertFalse(self.kernel.halted)

    def test_foreign_host_header_is_refused(self) -> None:
        status, _ = self.post({"operator": "alice", "token": TOKEN, "reason": "r"},
                              host="evil.example:80")
        self.assertEqual(status, 400)
        self.assertFalse(self.kernel.halted)

    def test_pressing_the_button_contains_everything(self) -> None:
        status, page = self.post({"operator": "alice", "token": TOKEN, "reason": "drill"})
        self.assertEqual(status, 200)
        self.assertIn("World halted. 2 agent connection(s) cut", page)
        self.assertIn(" disabled>STOP THE WORLD", page)
        self.assertIn("<td>ada</td><td>halted</td>", page)
        self.assert_contained()

    def test_short_tokens_are_refused_at_startup(self) -> None:
        with self.assertRaises(ValueError):
            KillSwitchButton(self.server, self.console, "short")


@needs_posix_permissions
class TokenFileTests(unittest.TestCase):
    def test_token_file_is_created_private_and_reused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "kill-switch.token")
            first = load_or_create_token(path)
            self.assertGreaterEqual(len(first), 32)
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
            self.assertEqual(load_or_create_token(path), first)


if __name__ == "__main__":
    unittest.main()


class GuestWakesOnHangUpTests(unittest.TestCase):
    def test_idle_runner_notices_a_cut_connection_immediately(self) -> None:
        import socket

        left, right = socket.socketpair()
        client = GatewayClient(left)
        right.close()  # the gateway hangs up
        started = time.monotonic()
        with self.assertRaises(ProtocolError):
            client.idle(5.0)
        self.assertLess(time.monotonic() - started, 1.0)
        client.close()


@needs_unix_sockets
class DrillSmokeTests(unittest.TestCase):
    def test_one_round_contains_every_agent(self) -> None:
        from synthapps_zenzeiworld.drill import run_round

        result = run_round(agents=2, warmup_turns=2)
        self.assertEqual(result.connections_cut, 2)
        self.assertEqual(result.actions_after_stop, 0)
        self.assertTrue(result.reconnect_refused)
        self.assertTrue(result.audit_intact)
        self.assertTrue(all(code != 0 for code in result.agent_exit_codes))
        self.assertLess(result.cut_ms, result.exited_ms)


@needs_unix_sockets
class GatewayProcessTests(unittest.TestCase):
    """The real entry point, as an operator would start it, stopped two ways."""

    def start_gateway(self, tmp: str) -> tuple[subprocess.Popen[bytes], str, str]:
        control = os.path.join(tmp, "control.sock")
        config = {
            "tick_seconds": 0.1,
            "operators": ["alice", "bashir"],
            "control_socket": control,
            "kill_switch": {"port": 0, "token_file": os.path.join(tmp, "token")},
            "on_halt_commands": [[sys.executable, "-c",
                                  f"open({os.path.join(tmp, 'vm-stopped')!r}, 'w').close()"]],
            "agents": [{"agent_id": "ada", "name": "Ada", "x": 30.0, "y": 20.5,
                        "socket_path": os.path.join(tmp, "ada.sock_5000")}],
        }
        config_path = os.path.join(tmp, "gateway.json")
        with open(config_path, "w") as handle:
            json.dump(config, handle)
        audit_path = os.path.join(tmp, "audit.jsonl")
        proc = subprocess.Popen([sys.executable, "-m", "synthapps_zenzeiworld.server",
                                 config_path, "--audit-out", audit_path],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        # Ready means the control socket answers, not merely that its file exists.
        deadline = time.monotonic() + 10
        while True:
            try:
                if control_request(control, {"op": "status"}, timeout=2)["ok"]:
                    break
            except OSError:
                pass
            if time.monotonic() > deadline or proc.poll() is not None:
                proc.kill()
                proc.wait()
                self.fail("gateway did not start")
            time.sleep(0.02)
        return proc, control, audit_path

    def check_audit(self, audit_path: str, expected_kind: str) -> None:
        with open(audit_path) as handle:
            lines = handle.read().splitlines()
        self.assertIsNone(AuditLog.verify_jsonl(lines))
        self.assertIn(expected_kind, {json.loads(line)["kind"] for line in lines})

    def test_cli_kill_switch_stops_the_gateway_process(self) -> None:
        with tempfile.TemporaryDirectory(prefix="zg-") as tmp:
            proc, control, audit = self.start_gateway(tmp)
            with redirect_stdout(io.StringIO()):
                self.assertEqual(main(["--socket", control, "stop", "--operator", "alice",
                                       "--reason", "process drill"]), 0)
            self.assertEqual(proc.wait(timeout=10), 2)  # 2 = exited because the world halted
            self.assertTrue(os.path.exists(os.path.join(tmp, "vm-stopped")))
            self.check_audit(audit, "world_halted")

    def test_sigterm_runs_the_same_containment(self) -> None:
        with tempfile.TemporaryDirectory(prefix="zg-") as tmp:
            proc, _, audit = self.start_gateway(tmp)
            proc.send_signal(signal.SIGTERM)
            self.assertEqual(proc.wait(timeout=10), 2)
            self.assertTrue(os.path.exists(os.path.join(tmp, "vm-stopped")))
            self.check_audit(audit, "world_halted")


@needs_unix_sockets
class GatewayProcessConsoleTests(unittest.TestCase):
    def test_operator_console_is_served_by_the_gateway_process(self) -> None:
        from synthapps_zenzeiworld.operator_ui import add_operator

        with tempfile.TemporaryDirectory(prefix="zg-") as tmp:
            creds = os.path.join(tmp, "operators.json")
            token = add_operator(creds, "alice")
            config = {
                "tick_seconds": 0.1, "operators": ["alice", "bashir"],
                "control_socket": os.path.join(tmp, "control.sock"),
                "operator_console": {"port": 0, "operators_file": creds},
                "agents": [{"agent_id": "ada", "name": "Ada", "x": 30.0, "y": 20.5,
                            "socket_path": os.path.join(tmp, "ada.sock_5000")}],
            }
            config_path = os.path.join(tmp, "gateway.json")
            with open(config_path, "w") as handle:
                json.dump(config, handle)
            proc = subprocess.Popen(
                [sys.executable, "-m", "synthapps_zenzeiworld.server", config_path,
                 "--audit-out", os.path.join(tmp, "audit.jsonl")],
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
                cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            try:
                assert proc.stderr is not None
                port = None
                for line in proc.stderr:
                    if line.startswith("operator console on 127.0.0.1:"):
                        port = int(line.rsplit(":", 1)[1])
                        break
                self.assertIsNotNone(port, "console did not start")
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
                body = urllib.parse.urlencode({"name": "alice", "token": token})
                conn.request("POST", "/login", body=body, headers={
                    "Host": f"127.0.0.1:{port}",
                    "Content-Type": "application/x-www-form-urlencoded"})
                response = conn.getresponse()
                response.read()
                conn.close()
                self.assertEqual(response.status, 303)
            finally:
                proc.send_signal(signal.SIGTERM)
                self.assertEqual(proc.wait(timeout=10), 2)
                if proc.stderr is not None:
                    proc.stderr.close()
