"""The operator console: a web app for watching and controlling a running world.

Bound to 127.0.0.1 only; operators reach it through an SSH tunnel, as with the
kill-switch page. What it adds over that page is day-to-day control:
a live map, agent risk and status, alerts, recent speech and an audit feed,
plus quarantine, two-person release, terminate, permits, pause, two-person
resume and emergency stop.

Security choices, and why:

* **One credential per operator.** A shared password would let one person
  type two names and satisfy the two-person rule alone. Here every approval
  comes from a separately authenticated session, and the operator's name is
  taken from the session, never from the form.
* **Credentials are stored hashed** in a file that must be private to its
  owner (mode 0600). Tokens are 256-bit random, so a plain SHA-256 is enough.
* **Agent text is hostile.** Speech shown on the console is written by agents.
  It only ever reaches the page as JSON and is inserted with ``textContent``,
  under a CSP that allows no inline script. Otherwise an agent could run code
  in an operator's browser and, for example, approve its own release.
* **Sessions**: random ids in an HttpOnly, SameSite=Strict cookie, 30 minutes
  idle expiry, a per-session CSRF token on every action, and a Host header
  check against DNS rebinding.
* **Lockout**: five failed logins for a name lock it for five minutes.
* Every login, failed login and command goes to the audit log.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import html
import json
import os
import re
import secrets
import sys
import threading
import time
import urllib.parse
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources
from typing import Any

from .kernel import OperatorConsole
from .server import GatewayServer

SESSION_IDLE_SECONDS = 30 * 60
MAX_FAILED_LOGINS = 5
LOCKOUT_SECONDS = 5 * 60
MAX_BODY_BYTES = 8192
SCOPE_PATTERN = re.compile(r"^(enter|use):[a-z0-9][a-z0-9_-]{0,31}$")
NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")

# Audit entries worth showing an operator, newest first in the feed.
_FEED_KINDS = frozenset({
    "signal", "warned", "throttled", "unthrottled", "quarantined", "released",
    "terminated", "granted", "operator_command", "operator_login", "operator_login_failed",
    "world_halted", "invariant_violation", "transport_violation", "internal_error",
})


# --- credentials ---------------------------------------------------------------------


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def load_credentials(path: str) -> dict[str, str]:
    """Read ``{operator: sha256(token)}``. Refuses a file others can read or write.

    The permission check applies on Linux and macOS, where the gateway is
    deployed. Windows does not expose POSIX mode bits (every writable file
    reads as 0o666), so there the check is skipped; that is only for trying
    the demo locally.
    """
    mode = os.stat(path).st_mode
    if os.name == "posix" and mode & 0o077:
        raise PermissionError(f"{path} must not be accessible by group or others (chmod 600)")
    with open(path) as handle:
        data = json.load(handle)
    if not isinstance(data, dict) or not all(
            isinstance(k, str) and isinstance(v, str) and len(v) == 64 for k, v in data.items()):
        raise ValueError(f"{path} must map operator names to SHA-256 hex digests")
    return data


def add_operator(path: str, name: str) -> str:
    """Create or replace ``name``'s credential. Returns the token; only its hash is stored."""
    if not NAME_PATTERN.fullmatch(name):
        raise ValueError(f"operator name must match {NAME_PATTERN.pattern}")
    data = load_credentials(path) if os.path.exists(path) else {}
    token = secrets.token_urlsafe(32)
    data[name] = hash_token(token)
    tmp = f"{path}.tmp-{secrets.token_hex(4)}"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump(data, handle, indent=2, sort_keys=True)
    os.replace(tmp, path)
    return token


# --- sessions ----------------------------------------------------------------------------


@dataclass
class Session:
    operator: str
    csrf: str
    expires: float
    flash: str = ""


@dataclass
class _Lockout:
    failures: int = 0
    locked_until: float = 0.0


@dataclass
class _Feeds:
    alerts: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=100))
    speech: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=60))
    log: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=80))
    next_seq: int = 0


class OperatorWebConsole:
    def __init__(self, server: GatewayServer, console: OperatorConsole,
                 credentials: dict[str, str], port: int = 0,
                 clock: Callable[[], float] = time.monotonic) -> None:
        unknown = set(credentials) - set(console.operators)
        if unknown:
            raise ValueError(f"credentials for people who are not operators: {sorted(unknown)}")
        self.server = server
        self.console = console
        self._credentials = dict(credentials)
        self._clock = clock
        self._sessions: dict[str, Session] = {}
        self._lockouts: dict[str, _Lockout] = {}
        self._feeds = _Feeds()
        self._auth_lock = threading.Lock()
        self._http = ThreadingHTTPServer(("127.0.0.1", port), _make_handler(self))
        self.port = self._http.server_address[1]
        self._thread = threading.Thread(target=self._http.serve_forever, args=(0.1,),
                                        name="operator-console", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._http.shutdown()
        self._http.server_close()
        self._thread.join(timeout=2)

    # --- authentication ---------------------------------------------------------

    def login(self, name: str, token: str) -> tuple[str, Session] | None:
        now = self._clock()
        with self._auth_lock:
            lock = self._lockouts.setdefault(name, _Lockout())
            expected = self._credentials.get(name)
            # Always compare, even for unknown names, so timing does not reveal who exists.
            supplied = hash_token(token)
            matches = hmac.compare_digest(supplied, expected or "0" * 64)
            ok = expected is not None and matches and now >= lock.locked_until
            if not ok:
                lock.failures += 1
                if lock.failures >= MAX_FAILED_LOGINS:
                    lock.locked_until = now + LOCKOUT_SECONDS
                    lock.failures = 0
            else:
                lock.failures = 0
        with self.server.lock:
            self.server.kernel.log_operator_event(
                "operator_login" if ok else "operator_login_failed", {"operator": name[:64]})
        if not ok:
            return None
        session_id = secrets.token_urlsafe(32)
        session = Session(name, secrets.token_urlsafe(24), now + SESSION_IDLE_SECONDS)
        with self._auth_lock:
            self._sessions[session_id] = session
        return session_id, session

    def session(self, session_id: str | None) -> Session | None:
        if not session_id:
            return None
        now = self._clock()
        with self._auth_lock:
            session = self._sessions.get(session_id)
            if session is None:
                return None
            if now > session.expires:
                del self._sessions[session_id]
                return None
            session.expires = now + SESSION_IDLE_SECONDS
            return session

    def logout(self, session_id: str) -> None:
        with self._auth_lock:
            self._sessions.pop(session_id, None)

    # --- state -------------------------------------------------------------------

    def _refresh_feeds(self) -> None:
        """Pull new alerts and audit entries. Caller holds the gateway lock."""
        kernel, feeds = self.server.kernel, self._feeds
        for alert in self.console.alerts():
            feeds.alerts.appendleft({"tick": alert.tick, "agent": alert.agent_id,
                                     "kind": alert.kind, "detail": alert.detail})
        entries = list(kernel.audit)
        for entry in entries[feeds.next_seq:]:
            data = entry.data
            if (entry.kind == "action_decided" and data.get("allowed")
                    and data.get("action") in ("say", "whisper")):
                params = data.get("params", {})
                feeds.speech.appendleft({"tick": entry.tick, "from": entry.agent_id,
                                         "to": params.get("to"), "volume": data["action"],
                                         "text": params.get("text", "")})
            if entry.kind in _FEED_KINDS:
                feeds.log.appendleft({"seq": entry.seq, "tick": entry.tick, "kind": entry.kind,
                                      "agent": entry.agent_id,
                                      "detail": json.dumps(data, sort_keys=True)[:240]})
        feeds.next_seq = len(entries)

    def state(self, session: Session) -> dict[str, Any]:
        with self.server.lock:
            self._refresh_feeds()
            kernel = self.server.kernel
            world = kernel.world
            agents = []
            for agent_id in kernel.agent_ids():
                status = kernel.agent_status(agent_id).value
                avatar = world.avatars.get(agent_id)
                agents.append({
                    "id": agent_id,
                    "name": avatar.display_name if avatar else agent_id,
                    "x": round(avatar.x, 2) if avatar else None,
                    "y": round(avatar.y, 2) if avatar else None,
                    "pose": avatar.pose if avatar else None,
                    "holding": list(avatar.holding) if avatar else [],
                    "status": status,
                    "risk": round(kernel.monitor.score(agent_id), 1),
                    "permits": kernel.grants.scopes(agent_id, world.tick),
                    "release_approvals": kernel.release_approvals(agent_id),
                })
            return {
                "operator": session.operator,
                "tick": world.tick,
                "halted": kernel.halted,
                "paused": kernel.paused,
                "resume_approvals": self.console.resume_approvals,
                "world": {"width": world.width, "height": world.height},
                "zones": [{"id": z.zone_id, "name": z.name, "kind": z.kind.value,
                           "x0": z.x0, "y0": z.y0, "x1": z.x1, "y1": z.y1}
                          for z in world.zones],
                "objects": [{"id": o.object_id, "name": o.name, "x": o.x, "y": o.y,
                             "decoy": o.decoy, "held_by": o.held_by}
                            for o in world.objects.values()],
                "agents": agents,
                "alerts": list(self._feeds.alerts)[:50],
                "speech": list(self._feeds.speech)[:30],
                "log": list(self._feeds.log)[:40],
            }

    # --- actions -----------------------------------------------------------------------

    def act(self, session: Session, form: dict[str, str]) -> str:
        """Run one operator command as ``session.operator``. Returns a message for the page."""
        op = form.get("op", "")
        me = session.operator
        agent = form.get("agent", "")
        reason = form.get("reason", "").strip()[:200]
        kernel = self.server.kernel
        try:
            if op == "emergency_stop":
                if not reason:
                    return "Give a reason for the emergency stop."
                report = self.server.emergency_stop(self.console, me, reason)
                return (f"World halted. {report.connections_closed} agent connection(s) cut "
                        f"in {(report.connections_cut - report.started) * 1000:.1f} ms.")
            with self.server.lock:
                if op == "pause":
                    self.console.pause(me)
                    return "World paused. Resuming needs two different operators."
                if op == "approve_resume":
                    if not kernel.paused:
                        return "The world is not paused."
                    if kernel.halted:
                        return "The world is halted. It cannot be resumed."
                    if self.console.approve_resume(me):
                        return "World resumed."
                    return "Resume approved. Waiting for a second, different operator."
                if agent not in kernel.agent_ids():
                    return "No such agent."
                if op == "quarantine":
                    if not reason:
                        return "Give a reason for the quarantine."
                    self.console.quarantine(me, agent, reason)
                    return f"{agent} quarantined."
                if op == "approve_release":
                    if kernel.agent_status(agent).value != "quarantined":
                        return f"{agent} is not quarantined."
                    if self.console.approve_release(me, agent):
                        return f"{agent} released."
                    return (f"Release of {agent} approved by {me}. "
                            "Waiting for a second, different operator.")
                if op == "terminate":
                    if form.get("confirm", "") != agent:
                        return f"To terminate, type the agent id ({agent}) to confirm."
                    if not reason:
                        return "Give a reason for the termination."
                    self.console.terminate(me, agent, reason)
                    return f"{agent} terminated."
                if op == "grant":
                    scope = form.get("scope", "").strip()
                    if not SCOPE_PATTERN.fullmatch(scope):
                        return "Permit must look like enter:<zone> or use:<object>."
                    ticks = form.get("ticks", "").strip()
                    expires = None
                    if ticks:
                        if not ticks.isdigit() or not 1 <= int(ticks) <= 100_000:
                            return "Duration must be a whole number of ticks, 1 to 100000."
                        expires = kernel.world.tick + int(ticks)
                    self.console.grant(me, agent, scope, expires)
                    return f"Granted {scope} to {agent}."
        except PermissionError as exc:
            return f"Refused: {exc}"
        return "Unknown command."


# --- HTTP ------------------------------------------------------------------------------

_CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; "
        "connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
_STATIC = {"console.js": "text/javascript", "console.css": "text/css"}
COOKIE = "zw_session"


def _static(name: str) -> bytes:
    return resources.files(__package__).joinpath("static", name).read_bytes()


def _login_page(message: str = "") -> bytes:
    note = f'<p class="flash">{html.escape(message)}</p>' if message else ""
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Operator Console</title><link rel="stylesheet" href="/static/console.css"></head>
<body class="login"><main>
<h1>Operator console</h1>
<p class="muted">Sign in with your own operator token. Tokens are personal: approvals
that need two people only count once per operator.</p>
{note}
<form method="post" action="/login" autocomplete="off" class="card">
<label for="name">Operator</label><input id="name" name="name" required maxlength="32">
<label for="token">Token</label>
<input id="token" name="token" type="password" required maxlength="128">
<button type="submit" class="primary">Sign in</button>
</form></main></body></html>""".encode()


def _console_page(session: Session) -> bytes:
    flash, session.flash = session.flash, ""
    note = f'<p class="flash" id="flash">{html.escape(flash)}</p>' if flash else ""
    return (_static("console.html").decode()
            .replace("{{CSRF}}", html.escape(session.csrf, quote=True))
            .replace("{{OPERATOR}}", html.escape(session.operator))
            .replace("{{FLASH}}", note)).encode()


def _make_handler(app: OperatorWebConsole) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "zw-operator-console"
        sys_version = ""

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            return

        def _host_ok(self) -> bool:
            return self.headers.get("Host", "") in {f"127.0.0.1:{app.port}",
                                                    f"localhost:{app.port}"}

        def _cookie(self) -> str | None:
            for part in self.headers.get("Cookie", "").split(";"):
                name, _, value = part.strip().partition("=")
                if name == COOKIE:
                    return value
            return None

        def _send(self, code: int, body: bytes, content_type: str = "text/html; charset=utf-8",
                  headers: dict[str, str] | None = None) -> None:
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", _CSP)
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body)

        def _redirect(self, cookie: str | None = None) -> None:
            headers = {"Location": "/"}
            if cookie is not None:
                headers["Set-Cookie"] = cookie
            self._send(303, b"", headers=headers)

        def _form(self) -> dict[str, str] | None:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY_BYTES:
                return None
            raw = self.rfile.read(length).decode("utf-8", "replace")
            return {k: v[0] for k, v in urllib.parse.parse_qs(raw).items()}

        def do_GET(self) -> None:  # noqa: N802
            if not self._host_ok():
                self._send(400, b"bad host", "text/plain")
                return
            path = self.path.split("?", 1)[0]
            if path.startswith("/static/") and path[8:] in _STATIC:
                self._send(200, _static(path[8:]), _STATIC[path[8:]])
                return
            session = app.session(self._cookie())
            if path == "/":
                self._send(200, _console_page(session) if session else _login_page())
            elif path == "/api/state":
                if session is None:
                    self._send(401, b'{"error":"not signed in"}', "application/json")
                else:
                    body = json.dumps(app.state(session)).encode()
                    self._send(200, body, "application/json")
            else:
                self._send(404, b"not found", "text/plain")

        def do_POST(self) -> None:  # noqa: N802
            if not self._host_ok():
                self._send(400, b"bad host", "text/plain")
                return
            form = self._form()
            if form is None:
                self._send(413, b"form too large or empty", "text/plain")
                return
            if self.path == "/login":
                result = app.login(form.get("name", "")[:32], form.get("token", "")[:128])
                if result is None:
                    self._send(403, _login_page("Sign-in failed. Repeated failures lock the "
                                                "name for five minutes."))
                    return
                session_id, _ = result
                self._redirect(f"{COOKIE}={session_id}; HttpOnly; SameSite=Strict; Path=/")
                return
            cookie = self._cookie()
            session = app.session(cookie)
            if session is None or cookie is None:
                self._send(401, _login_page("Your session has ended. Sign in again."))
                return
            if not hmac.compare_digest(form.get("csrf", ""), session.csrf):
                self._send(403, b"bad csrf token", "text/plain")
                return
            if self.path == "/logout":
                app.logout(cookie)
                self._redirect(f"{COOKIE}=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/")
            elif self.path == "/action":
                session.flash = app.act(session, form)
                self._redirect()
            else:
                self._send(404, b"not found", "text/plain")

    return Handler


# --- CLI ------------------------------------------------------------------------------------


def _run_demo(port: int, tick_seconds: float) -> int:
    """A world with scripted residents and one rogue, plus the console, for trying it out."""
    import copy
    import tempfile

    from .simulation import build

    kernel, console, agents, _ = build()
    server = GatewayServer(kernel)
    creds_path = os.path.join(tempfile.mkdtemp(prefix="zw-demo-"), "operators.json")
    tokens = {name: add_operator(creds_path, name) for name in sorted(console.operators)}
    app = OperatorWebConsole(server, console, load_credentials(creds_path), port=port)
    app.start()
    print(f"Operator console (demo): http://127.0.0.1:{app.port}")
    for name, token in tokens.items():
        print(f"  operator {name:<10} token {token}")
    stop = threading.Event()

    def play() -> None:
        while not stop.wait(tick_seconds):
            with server.lock:
                if kernel.halted:
                    return
                for agent, gateway in agents:
                    agent_obs = copy.deepcopy(gateway.observe())
                    gateway.submit(agent.act(agent_obs))
                kernel.step()

    threading.Thread(target=play, daemon=True).start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        app.stop()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Operator console tools")
    sub = parser.add_subparsers(dest="command", required=True)
    add = sub.add_parser("add-operator", help="create or replace an operator's token")
    add.add_argument("--file", required=True, help="credentials file (created 0600)")
    add.add_argument("name")
    demo = sub.add_parser("demo", help="run a demo world with the console on 127.0.0.1")
    demo.add_argument("--port", type=int, default=8788)
    demo.add_argument("--tick-seconds", type=float, default=1.0)
    args = parser.parse_args(argv)
    if args.command == "add-operator":
        token = add_operator(args.file, args.name)
        print(f"Token for {args.name} (shown once; give it to them privately):\n{token}")
        return 0
    return _run_demo(args.port, args.tick_seconds)


if __name__ == "__main__":
    sys.exit(main())
