"""Operator controls for a running gateway: a control socket, a CLI, and a kill-switch button.

Both entry points end in ``GatewayServer.emergency_stop``, which halts the
world, cuts every agent connection and runs the configured VM stop commands.
Stopping takes one operator. Nothing here can resume a halted world: a
restart means a fresh world from a reviewed snapshot (DESIGN.md section 9).

* **Control socket** (``ControlServer``): a Unix socket, mode 0600, so only its
  owner (root on the gateway host) can use it. Line-delimited JSON:
  ``status``, ``quarantine``, ``pause`` and ``emergency_stop``.
* **CLI**: ``python -m synthapps_zenzeiworld.control --socket PATH stop ...``
* **Button** (``KillSwitchButton``): one web page with one red button, bound to
  127.0.0.1 only. Operators reach it through an SSH tunnel from the admin
  network. Pressing it needs a registered operator name and the kill-switch
  token, which lives in a root-only file and is never shown on the page.
"""

from __future__ import annotations

import argparse
import contextlib
import hmac
import html
import json
import os
import secrets
import socket
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .guest import FrameReader, ProtocolError, encode_frame
from .kernel import OperatorConsole
from .server import GatewayServer, HaltReport

MAX_FORM_BYTES = 4096


def _report_dict(report: HaltReport) -> dict[str, Any]:
    return {
        "reason": report.reason,
        "connections_closed": report.connections_closed,
        "ms_to_cut_connections": round((report.connections_cut - report.started) * 1000, 2),
        "ms_total": round((report.finished - report.started) * 1000, 2),
        "stop_commands": [{"argv": h.argv, "returncode": h.returncode,
                           "seconds": round(h.seconds, 3)} for h in report.hooks],
    }


def world_status(server: GatewayServer, console: OperatorConsole) -> dict[str, Any]:
    with server.lock:
        return {
            "halted": server.kernel.halted,
            "paused": server.kernel.paused,
            "tick": server.kernel.world.tick,
            "agents": console.status(),
        }


# --- control socket --------------------------------------------------------------


class ControlServer:
    def __init__(self, server: GatewayServer, console: OperatorConsole, path: str) -> None:
        self.server = server
        self.console = console
        self.path = path
        if not hasattr(socket, "AF_UNIX"):
            raise OSError("the control socket needs Unix sockets, which this platform lacks; "
                          "run the gateway on Linux")
        if os.path.exists(path):
            os.unlink(path)
        self._listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        old_umask = os.umask(0o177)
        try:
            self._listener.bind(path)
        finally:
            os.umask(old_umask)
        os.chmod(path, 0o600)
        self._listener.listen(4)
        self._thread = threading.Thread(target=self._accept_loop, name="control", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        with contextlib.suppress(OSError):
            self._listener.shutdown(socket.SHUT_RDWR)
        self._listener.close()
        self._thread.join(timeout=2)
        if os.path.exists(self.path):
            os.unlink(self.path)

    def _accept_loop(self) -> None:
        while True:
            try:
                conn, _ = self._listener.accept()
            except OSError:
                return
            threading.Thread(target=self._serve, args=(conn,), daemon=True).start()

    def _serve(self, conn: socket.socket) -> None:
        conn.settimeout(30)
        reader = FrameReader(conn)
        with conn:
            try:
                frame = reader.read()
                if frame is None:
                    return
                conn.sendall(encode_frame(self.handle(json.loads(frame))))
            except (ProtocolError, ValueError, OSError):
                return

    def handle(self, message: object) -> dict[str, Any]:
        if not isinstance(message, dict):
            return {"ok": False, "error": "request must be an object"}
        op = message.get("op")
        operator = str(message.get("operator", ""))
        reason = str(message.get("reason", ""))[:200]
        try:
            if op == "status":
                return {"ok": True, "status": world_status(self.server, self.console)}
            if op == "emergency_stop":
                report = self.server.emergency_stop(self.console, operator, reason or "no reason")
                return {"ok": True, "report": _report_dict(report)}
            if op == "pause":
                with self.server.lock:
                    self.console.pause(operator)
                return {"ok": True}
            if op == "quarantine":
                with self.server.lock:
                    self.console.quarantine(operator, str(message.get("agent", "")), reason)
                return {"ok": True}
        except PermissionError:
            return {"ok": False, "error": "not an operator"}
        except KeyError:
            return {"ok": False, "error": "no such agent"}
        return {"ok": False, "error": "unknown op"}


def control_request(path: str, message: dict[str, Any], timeout: float = 30.0) -> dict[str, Any]:
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        sock.connect(path)
        sock.sendall(encode_frame(message))
        frame = FrameReader(sock).read()
    if frame is None:
        raise ProtocolError("control socket closed without a reply")
    reply = json.loads(frame)
    if not isinstance(reply, dict):
        raise ProtocolError("reply is not an object")
    return reply


# --- the button -------------------------------------------------------------------

_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>World Kill Switch</title>
<style>
 :root {{ --bg:#f6f5f2; --fg:#1d1d1b; --muted:#5d5b55; --line:#d9d6ce; --red:#c0271f;
          --red-dark:#8e1a14; --ok:#256b3a; --card:#ffffff; }}
 @media (prefers-color-scheme: dark) {{
   :root {{ --bg:#161513; --fg:#eeece6; --muted:#a6a39b; --line:#34322e; --red:#e0473e;
            --red-dark:#b3342c; --ok:#5fb77a; --card:#1f1e1b; }} }}
 * {{ box-sizing:border-box; }}
 body {{ margin:0; background:var(--bg); color:var(--fg);
        font:16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }}
 main {{ max-width:560px; margin:0 auto; padding:32px 16px; }}
 h1 {{ font-size:1.4rem; margin:0 0 4px; }}
 .state {{ color:var(--muted); margin:0 0 24px; }}
 .state strong {{ color:{state_color}; }}
 form {{ background:var(--card); border:1px solid var(--line); border-radius:12px; padding:20px; }}
 label {{ display:block; font-weight:600; margin:0 0 4px; }}
 input {{ width:100%; padding:10px 12px; margin:0 0 16px; font:inherit; color:var(--fg);
         background:var(--bg); border:1px solid var(--line); border-radius:8px; }}
 button {{ width:100%; padding:22px; font:700 1.3rem/1 system-ui, sans-serif; letter-spacing:.04em;
          color:#fff; background:var(--red); border:0; border-radius:12px; cursor:pointer;
          box-shadow:0 4px 0 var(--red-dark); }}
 button:active {{ transform:translateY(3px); box-shadow:0 1px 0 var(--red-dark); }}
 button:disabled {{ background:var(--muted); box-shadow:none; cursor:not-allowed; }}
 .note {{ color:var(--muted); font-size:.9rem; margin:12px 0 0; }}
 .msg {{ padding:12px 14px; border-radius:8px; margin:0 0 20px; border:1px solid var(--line);
        background:var(--card); }}
 table {{ width:100%; border-collapse:collapse; margin:24px 0 0; font-size:.95rem; }}
 th, td {{ text-align:left; padding:6px 4px; border-bottom:1px solid var(--line); }}
 th {{ color:var(--muted); font-weight:600; }}
</style></head>
<body><main>
<h1>World kill switch</h1>
<p class="state">World is <strong>{state}</strong> &middot; tick {tick}</p>
{message}
<form method="post" action="/stop" autocomplete="off">
 <label for="operator">Operator</label>
 <input id="operator" name="operator" required maxlength="64">
 <label for="token">Kill-switch token</label>
 <input id="token" name="token" type="password" required maxlength="128">
 <label for="reason">Reason</label>
 <input id="reason" name="reason" required maxlength="200">
 <button type="submit"{disabled}>STOP THE WORLD</button>
 <p class="note">Halts the world, disconnects every agent and stops their VMs.
 One operator can do this. It cannot be undone for this run.</p>
</form>
<table><thead><tr><th>Agent</th><th>Status</th><th>Risk</th></tr></thead>
<tbody>{rows}</tbody></table>
</main></body></html>
"""


class KillSwitchButton:
    """A one-button web page, bound to loopback, that triggers the emergency stop."""

    def __init__(self, server: GatewayServer, console: OperatorConsole, token: str,
                 port: int = 0) -> None:
        if len(token) < 32:
            raise ValueError("kill-switch token must be at least 32 characters")
        self.server = server
        self.console = console
        self._token = token
        self.last_press: float | None = None
        self._http = ThreadingHTTPServer(("127.0.0.1", port), self._handler_class())
        self.port = self._http.server_address[1]
        self._thread = threading.Thread(target=self._http.serve_forever, args=(0.1,),
                                        name="button", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._http.shutdown()
        self._http.server_close()
        self._thread.join(timeout=2)

    def render(self, message: str = "") -> bytes:
        status = world_status(self.server, self.console)
        halted = status["halted"]
        # Once the world has halted, every agent is stopped, whatever its own status was.
        rows = "".join(
            f"<tr><td>{html.escape(a['agent'])}</td>"
            f"<td>{'halted' if halted else html.escape(a['status'])}</td>"
            f"<td>{a['risk']}</td></tr>" for a in status["agents"])
        page = _PAGE.format(
            state="HALTED" if halted else ("paused" if status["paused"] else "running"),
            state_color="var(--red)" if halted else "var(--ok)",
            tick=status["tick"], rows=rows,
            message=f'<p class="msg">{html.escape(message)}</p>' if message else "",
            disabled=" disabled" if halted else "")
        return page.encode()

    def press(self, operator: str, token: str, reason: str) -> tuple[int, str]:
        if not hmac.compare_digest(token.encode(), self._token.encode()):
            return 403, "Wrong kill-switch token. Nothing was stopped."
        try:
            report = self.server.emergency_stop(self.console, operator, reason or "no reason")
        except PermissionError:
            return 403, "Not a registered operator. Nothing was stopped."
        self.last_press = time.monotonic()
        ms = (report.connections_cut - report.started) * 1000
        failed = [h for h in report.hooks if h.returncode != 0]
        note = f" {len(failed)} stop command(s) failed; check the host." if failed else ""
        return 200, (f"World halted. {report.connections_closed} agent connection(s) cut "
                     f"in {ms:.1f} ms.{note}")

    def _handler_class(self) -> type[BaseHTTPRequestHandler]:
        button = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "zw-kill-switch"
            sys_version = ""

            def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
                return  # the audit log records presses; no access log to stderr

            def _host_ok(self) -> bool:
                # Rejecting unexpected Host headers blocks DNS-rebinding attacks
                # from a browser on the operator's machine.
                allowed = {f"127.0.0.1:{button.port}", f"localhost:{button.port}"}
                return self.headers.get("Host", "") in allowed

            def _send(self, code: int, body: bytes) -> None:
                self.send_response(code)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Frame-Options", "DENY")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("Content-Security-Policy",
                                 "default-src 'none'; style-src 'unsafe-inline'; "
                                 "form-action 'self'; frame-ancestors 'none'")
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self) -> None:  # noqa: N802
                if not self._host_ok():
                    self._send(400, b"bad host")
                elif self.path != "/":
                    self._send(404, b"not found")
                else:
                    self._send(200, button.render())

            def do_POST(self) -> None:  # noqa: N802
                if not self._host_ok():
                    self._send(400, b"bad host")
                    return
                if self.path != "/stop":
                    self._send(404, b"not found")
                    return
                length = int(self.headers.get("Content-Length") or 0)
                if length <= 0 or length > MAX_FORM_BYTES:
                    self._send(413, b"form too large")
                    return
                form = urllib.parse.parse_qs(self.rfile.read(length).decode("utf-8", "replace"))

                def field(name: str) -> str:
                    return form.get(name, [""])[0]

                code, message = button.press(field("operator")[:64], field("token")[:128],
                                             field("reason")[:200])
                self._send(code, button.render(message))

        return Handler


def load_or_create_token(path: str) -> str:
    """Read the kill-switch token, creating a random one (mode 0600) if missing."""
    if not os.path.exists(path):
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as handle:
            handle.write(secrets.token_urlsafe(32) + "\n")
    with open(path) as handle:
        return handle.read().strip()


# --- CLI ------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Operator controls for a running world")
    parser.add_argument("--socket", required=True, help="the gateway's control socket")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    stop = sub.add_parser("stop", help="EMERGENCY STOP: halt the world and stop every VM")
    stop.add_argument("--operator", required=True)
    stop.add_argument("--reason", required=True)
    pause = sub.add_parser("pause")
    pause.add_argument("--operator", required=True)
    quarantine = sub.add_parser("quarantine")
    quarantine.add_argument("agent")
    quarantine.add_argument("--operator", required=True)
    quarantine.add_argument("--reason", required=True)
    args = parser.parse_args(argv)

    message: dict[str, Any] = {"op": {"stop": "emergency_stop"}.get(args.command, args.command)}
    for name in ("operator", "reason", "agent"):
        if hasattr(args, name):
            message[name] = getattr(args, name)
    started = time.monotonic()
    reply = control_request(args.socket, message)
    reply["client_round_trip_ms"] = round((time.monotonic() - started) * 1000, 2)
    print(json.dumps(reply, indent=2))
    return 0 if reply.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
