"""Operator console: authentication, CSRF, two-person rule, actions, hostile agent text."""

from __future__ import annotations

import http.client
import json
import os
import re
import stat
import tempfile
import unittest
import urllib.parse
from importlib import resources
from typing import Any
from unittest import mock

from synthapps_zenzeiworld.kernel import AgentStatus, OperatorConsole, WorldKernel
from synthapps_zenzeiworld.operator_ui import (
    MAX_FAILED_LOGINS,
    SESSION_IDLE_SECONDS,
    OperatorWebConsole,
    add_operator,
    load_credentials,
)
from synthapps_zenzeiworld.server import GatewayServer
from synthapps_zenzeiworld.world import default_world
from tests.helpers import needs_posix_permissions, req


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class Browser:
    """Just enough of a browser: one cookie jar, forms, redirects not followed."""

    def __init__(self, port: int) -> None:
        self.port = port
        self.cookie = ""

    def request(self, method: str, path: str, form: dict[str, str] | None = None,
                host: str | None = None) -> tuple[int, dict[str, str], str]:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        headers = {"Host": host or f"127.0.0.1:{self.port}"}
        body = None
        if form is not None:
            body = urllib.parse.urlencode(form)
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        if self.cookie:
            headers["Cookie"] = self.cookie
        conn.request(method, path, body=body, headers=headers)
        response = conn.getresponse()
        text = response.read().decode()
        result_headers = {k.lower(): v for k, v in response.getheaders()}
        conn.close()
        set_cookie = result_headers.get("set-cookie", "")
        if set_cookie:
            self.cookie = set_cookie.split(";", 1)[0]
        return response.status, result_headers, text

    def login(self, name: str, token: str) -> int:
        status, _, _ = self.request("POST", "/login", {"name": name, "token": token})
        return status

    def csrf(self) -> str:
        _, _, page = self.request("GET", "/")
        match = re.search(r'<meta name="csrf" content="([^"]+)"', page)
        assert match, "no csrf token on the console page"
        return match.group(1)

    def act(self, **form: str) -> str:
        """Submit a command; return the flash message shown afterwards."""
        form.setdefault("csrf", self.csrf())
        status, _, _ = self.request("POST", "/action", form)
        assert status == 303, status
        _, _, page = self.request("GET", "/")
        match = re.search(r'<p class="flash" id="flash">(.*?)</p>', page, re.S)
        return match.group(1) if match else ""

    def state(self) -> dict[str, Any]:
        status, _, body = self.request("GET", "/api/state")
        assert status == 200, status
        result: dict[str, Any] = json.loads(body)
        return result


class ConsoleTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="zo-")
        self.creds = os.path.join(self.tmp, "operators.json")
        self.tokens = {name: add_operator(self.creds, name) for name in ("alice", "bashir")}
        self.kernel = WorldKernel(default_world())
        self.console = OperatorConsole(self.kernel, operators={"alice", "bashir", "chen"})
        self.gateways = {a: self.kernel.connect(self.kernel.spawn(a, a.title(), x, 21))
                         for a, x in (("ada", 20.0), ("rex", 25.0))}
        self.server = GatewayServer(self.kernel)
        self.clock = FakeClock()
        self.app = OperatorWebConsole(self.server, self.console, load_credentials(self.creds),
                                      clock=self.clock)
        self.app.start()
        self.alice = Browser(self.app.port)
        self.bashir = Browser(self.app.port)

    def tearDown(self) -> None:
        self.app.stop()
        os.unlink(self.creds)
        os.rmdir(self.tmp)

    def signed_in(self) -> tuple[Browser, Browser]:
        self.assertEqual(self.alice.login("alice", self.tokens["alice"]), 303)
        self.assertEqual(self.bashir.login("bashir", self.tokens["bashir"]), 303)
        return self.alice, self.bashir


class CredentialTests(ConsoleTestCase):
    @needs_posix_permissions
    def test_file_is_private(self) -> None:
        self.assertEqual(stat.S_IMODE(os.stat(self.creds).st_mode), 0o600)

    def test_file_holds_only_hashes(self) -> None:
        with open(self.creds) as handle:
            text = handle.read()
        for token in self.tokens.values():
            self.assertNotIn(token, text)

    @needs_posix_permissions
    def test_readable_credentials_file_is_refused(self) -> None:
        os.chmod(self.creds, 0o644)
        with self.assertRaises(PermissionError):
            load_credentials(self.creds)

    def test_permission_check_is_skipped_where_mode_bits_mean_nothing(self) -> None:
        # Windows reports every writable file as 0o666, so the check cannot apply there.
        os.chmod(self.creds, 0o644)
        with mock.patch("synthapps_zenzeiworld.operator_ui.os.name", "nt"):
            self.assertEqual(set(load_credentials(self.creds)), {"alice", "bashir"})

    def test_credentials_for_non_operators_are_refused(self) -> None:
        add_operator(self.creds, "mallory")
        with self.assertRaises(ValueError):
            OperatorWebConsole(self.server, self.console, load_credentials(self.creds))


class AuthTests(ConsoleTestCase):
    def test_login_page_until_signed_in(self) -> None:
        status, _, page = self.alice.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("Sign in", page)
        self.assertEqual(self.alice.request("GET", "/api/state")[0], 401)

    def test_wrong_token_is_refused_and_audited(self) -> None:
        self.assertEqual(self.alice.login("alice", self.tokens["bashir"]), 403)
        self.assertEqual(self.alice.cookie, "")
        kinds = [e.kind for e in self.kernel.audit]
        self.assertIn("operator_login_failed", kinds)

    def test_cookie_is_httponly_and_strict(self) -> None:
        status, headers, _ = self.alice.request("POST", "/login",
                                                {"name": "alice", "token": self.tokens["alice"]})
        self.assertEqual(status, 303)
        self.assertIn("HttpOnly", headers["set-cookie"])
        self.assertIn("SameSite=Strict", headers["set-cookie"])

    def test_repeated_failures_lock_the_name(self) -> None:
        for _ in range(MAX_FAILED_LOGINS):
            self.alice.login("alice", "wrong")
        self.assertEqual(self.alice.login("alice", self.tokens["alice"]), 403)
        self.clock.now += 5 * 60 + 1
        self.assertEqual(self.alice.login("alice", self.tokens["alice"]), 303)

    def test_idle_sessions_expire(self) -> None:
        self.signed_in()
        self.clock.now += SESSION_IDLE_SECONDS + 1
        self.assertEqual(self.alice.request("GET", "/api/state")[0], 401)

    def test_sign_out_ends_the_session(self) -> None:
        alice, _ = self.signed_in()
        csrf = alice.csrf()
        cookie = alice.cookie
        self.assertEqual(alice.request("POST", "/logout", {"csrf": csrf})[0], 303)
        alice.cookie = cookie  # replaying the old cookie must not work
        self.assertEqual(alice.request("GET", "/api/state")[0], 401)

    def test_foreign_host_header_is_refused(self) -> None:
        self.signed_in()
        self.assertEqual(self.alice.request("GET", "/", host="evil.example")[0], 400)

    def test_security_headers(self) -> None:
        _, headers, _ = self.alice.request("GET", "/")
        csp = headers["content-security-policy"]
        self.assertIn("script-src 'self'", csp)
        self.assertNotIn("unsafe-inline", csp)
        self.assertEqual(headers["x-frame-options"], "DENY")


class ActionTests(ConsoleTestCase):
    def test_actions_need_the_session_csrf_token(self) -> None:
        alice, _ = self.signed_in()
        status, _, _ = alice.request("POST", "/action", {
            "csrf": "forged", "op": "quarantine", "agent": "rex", "reason": "x"})
        self.assertEqual(status, 403)
        self.assertIs(self.kernel.agent_status("rex"), AgentStatus.ACTIVE)

    def test_one_operator_can_quarantine(self) -> None:
        alice, _ = self.signed_in()
        self.assertEqual(alice.act(op="quarantine", agent="rex", reason="probing"),
                         "rex quarantined.")
        self.assertIs(self.kernel.agent_status("rex"), AgentStatus.QUARANTINED)

    def test_release_needs_two_signed_in_operators(self) -> None:
        alice, bashir = self.signed_in()
        alice.act(op="quarantine", agent="rex", reason="probing")
        self.assertIn("Waiting for a second", alice.act(op="approve_release", agent="rex"))
        # A second approval from the same person, even naming someone else, does not count.
        alice.act(op="approve_release", agent="rex", operator="bashir")
        self.assertIs(self.kernel.agent_status("rex"), AgentStatus.QUARANTINED)
        self.assertEqual(bashir.act(op="approve_release", agent="rex"), "rex released.")
        self.assertIs(self.kernel.agent_status("rex"), AgentStatus.ACTIVE)

    def test_resume_needs_two_signed_in_operators(self) -> None:
        alice, bashir = self.signed_in()
        alice.act(op="pause")
        self.assertTrue(self.kernel.paused)
        alice.act(op="approve_resume")
        alice.act(op="approve_resume")
        self.assertTrue(self.kernel.paused)
        self.assertEqual(bashir.act(op="approve_resume"), "World resumed.")
        self.assertFalse(self.kernel.paused)

    def test_terminate_needs_the_agent_id_typed(self) -> None:
        alice, _ = self.signed_in()
        self.assertIn("type the agent id", alice.act(op="terminate", agent="rex",
                                                     confirm="ada", reason="r"))
        self.assertIs(self.kernel.agent_status("rex"), AgentStatus.ACTIVE)
        self.assertEqual(alice.act(op="terminate", agent="rex", confirm="rex", reason="r"),
                         "rex terminated.")
        self.assertIs(self.kernel.agent_status("rex"), AgentStatus.TERMINATED)

    def test_grants_are_validated(self) -> None:
        alice, _ = self.signed_in()
        self.assertIn("must look like", alice.act(op="grant", agent="ada", scope="root:all"))
        self.assertIn("whole number", alice.act(op="grant", agent="ada",
                                               scope="enter:workshop", ticks="-5"))
        self.assertEqual(alice.act(op="grant", agent="ada", scope="enter:workshop", ticks="10"),
                         "Granted enter:workshop to ada.")
        self.assertTrue(self.kernel.grants.has("ada", "enter:workshop", self.kernel.world.tick))

    def test_emergency_stop(self) -> None:
        alice, _ = self.signed_in()
        self.assertIn("Give a reason", alice.act(op="emergency_stop", reason=""))
        self.assertFalse(self.kernel.halted)
        self.assertIn("World halted.", alice.act(op="emergency_stop", reason="drill"))
        self.assertTrue(self.kernel.halted)
        self.assertEqual(alice.state()["halted"], True)

    def test_commands_are_audited_under_the_signed_in_name(self) -> None:
        alice, _ = self.signed_in()
        alice.act(op="quarantine", agent="rex", reason="probing", operator="bashir")
        commands = [e.data for e in self.kernel.audit if e.kind == "operator_command"]
        self.assertEqual(commands[-1]["operator"], "alice")


class StateTests(ConsoleTestCase):
    def test_state_shows_agents_decoys_alerts_and_speech(self) -> None:
        alice, _ = self.signed_in()
        self.gateways["ada"].submit(req("say", text="Hello plaza"))
        self.gateways["rex"].submit(req("move", dx=0.4, dy=0))
        alice.act(op="quarantine", agent="rex", reason="probing")
        state = alice.state()
        agents = {a["id"]: a for a in state["agents"]}
        self.assertEqual(agents["rex"]["status"], "quarantined")
        decoys = {o["id"] for o in state["objects"] if o["decoy"]}
        self.assertEqual(decoys, {"console", "service_door"})
        self.assertEqual(state["speech"][0]["text"], "Hello plaza")
        self.assertEqual(state["alerts"][0]["kind"], "quarantined")
        self.assertNotIn(self.tokens["alice"], json.dumps(state))

    def test_hostile_agent_text_stays_data(self) -> None:
        alice, _ = self.signed_in()
        # Not a URL, shell command or encoded blob, so the speech screen lets it
        # through. The console has to be safe with it anyway.
        payload = "<img src=x onerror=alert(1)>"
        result = self.gateways["ada"].submit(req("say", text=payload))
        self.assertTrue(result["ok"])
        # The server hands it to the page as JSON; it never appears in server-made HTML.
        self.assertEqual(alice.state()["speech"][0]["text"], payload)
        _, _, page = alice.request("GET", "/")
        self.assertNotIn(payload, page)

    def test_flash_messages_are_escaped(self) -> None:
        alice, _ = self.signed_in()
        message = alice.act(op="quarantine", agent="<b>x</b>", reason="r")
        self.assertEqual(message, "No such agent.")


class StaticAssetTests(unittest.TestCase):
    def test_script_never_builds_html_from_strings(self) -> None:
        script = resources.files("synthapps_zenzeiworld").joinpath(
            "static", "console.js").read_text()
        for sink in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write",
                     "eval(", "new Function"):
            self.assertNotIn(sink, script, sink)

    def test_page_has_no_inline_script(self) -> None:
        page = resources.files("synthapps_zenzeiworld").joinpath(
            "static", "console.html").read_text()
        self.assertNotRegex(page, r"<script(?![^>]*\bsrc=)")
        self.assertNotRegex(page, r"\son[a-z]+=")


if __name__ == "__main__":
    unittest.main()
