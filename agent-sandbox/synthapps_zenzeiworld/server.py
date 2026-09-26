"""Host-side gateway: connects each agent VM's socket to the world kernel.

Under Firecracker, when the guest connects to vsock port P on the host,
Firecracker opens the Unix socket ``<uds_path>_P`` inside its jail. This
server listens on one such socket per VM. **Identity comes from which socket
a connection arrives on.** The session token stays on the host and is never
sent to the guest, so a guest has nothing it could leak or forge.

Rules at this layer:

* one live connection per agent; extra connections are closed
* frames are capped at ``MAX_FRAME_BYTES``; an oversized frame closes the connection
* protocol violations are reported to the kernel and raise the agent's risk score
* ``infer`` goes to a host-side broker you supply, with its own per-tick budget.
  The guest sends prompt text only. It never chooses an address or a model.
* all kernel access is serialised with one lock
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from .guest import MAX_PROMPT_CHARS, FrameReader, ProtocolError, encode_frame
from .kernel import AgentGateway, OperatorConsole, WorldKernel
from .world import default_world


class InferenceBroker(Protocol):
    """Host-side access to a model. Implement this against your inference server.

    The broker, not the guest, decides the endpoint, the model and the output
    limits. It receives only the agent id and the prompt text.
    """

    def complete(self, agent_id: str, prompt: str) -> str: ...


@dataclass
class ServerConfig:
    infer_per_tick: int = 2
    max_protocol_errors: int = 3
    read_timeout_seconds: float = 300.0
    tick_seconds: float | None = None  # None: the caller drives ticks via step()
    # Commands run (without a shell) when the world halts, e.g. one
    # ["launch-agent-vm.sh", "stop", "<id>"] per VM. They run in parallel.
    on_halt_commands: list[list[str]] = field(default_factory=list)
    on_halt_timeout_seconds: float = 10.0


@dataclass
class HookResult:
    argv: list[str]
    returncode: int | None  # None: timed out and was killed
    seconds: float


@dataclass
class HaltReport:
    """What containment did after the world halted, with monotonic timestamps."""

    reason: str
    started: float
    connections_cut: float = 0.0
    finished: float = 0.0
    connections_closed: int = 0
    hooks: list[HookResult] = field(default_factory=list)


@dataclass
class _Binding:
    agent_id: str
    gateway: AgentGateway
    path: str
    listener: socket.socket
    active: socket.socket | None = None
    infer_tick: int = -1
    infer_count: int = 0
    threads: list[threading.Thread] = field(default_factory=list)


def _reply(**fields: Any) -> dict[str, Any]:
    return fields


class GatewayServer:
    def __init__(self, kernel: WorldKernel, broker: InferenceBroker | None = None,
                 config: ServerConfig | None = None) -> None:
        self.kernel = kernel
        self.broker = broker
        self.config = config or ServerConfig()
        self.lock = threading.RLock()
        self._bindings: dict[str, _Binding] = {}
        self._stop = threading.Event()
        self._ticker: threading.Thread | None = None
        self._contain_lock = threading.Lock()
        self.halt_report: HaltReport | None = None

    # --- setup ------------------------------------------------------------------

    def bind_agent(self, agent_id: str, token: str, socket_path: str,
                   owner: tuple[int, int] | None = None) -> None:
        """Listen for one agent's VM on ``socket_path``.

        ``owner`` is the (uid, gid) of the jailed Firecracker process, which is
        what actually connects to this socket. The socket is mode 0600.
        """
        if not hasattr(socket, "AF_UNIX"):
            raise OSError("the VM gateway needs Unix sockets, which this platform lacks; "
                          "run the gateway on Linux")
        with self.lock:
            gateway = self.kernel.connect(token)
        if os.path.exists(socket_path):
            os.unlink(socket_path)
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        old_umask = os.umask(0o177)
        try:
            listener.bind(socket_path)
        finally:
            os.umask(old_umask)
        os.chmod(socket_path, 0o600)
        if owner is not None:
            os.chown(socket_path, *owner)
        listener.listen(1)
        listener.settimeout(0.5)
        self._bindings[agent_id] = _Binding(agent_id, gateway, socket_path, listener)

    def start(self) -> None:
        for binding in self._bindings.values():
            thread = threading.Thread(target=self._accept_loop, args=(binding,),
                                      name=f"accept-{binding.agent_id}", daemon=True)
            binding.threads.append(thread)
            thread.start()
        if self.config.tick_seconds is not None:
            self._ticker = threading.Thread(target=self._tick_loop, name="ticker", daemon=True)
            self._ticker.start()

    def stop(self) -> None:
        self._stop.set()
        for binding in self._bindings.values():
            # shutdown() wakes threads blocked in accept() or recv(); close() alone does not.
            for sock in (binding.listener, binding.active):
                if sock is not None:
                    with contextlib.suppress(OSError):
                        sock.shutdown(socket.SHUT_RDWR)
                    sock.close()
            for thread in binding.threads:
                thread.join(timeout=2)
            if os.path.exists(binding.path):
                os.unlink(binding.path)
        if self._ticker is not None:
            self._ticker.join(timeout=2)

    def step(self) -> None:
        with self.lock:
            self.kernel.step()
        if self.kernel.halted:
            self.contain("world halted")

    def _tick_loop(self) -> None:
        interval = self.config.tick_seconds or 1.0
        while not self._stop.wait(interval):
            self.step()
            if self.kernel.halted:
                return

    # --- kill switch ---------------------------------------------------------------

    def emergency_stop(self, console: OperatorConsole, operator: str, reason: str) -> HaltReport:
        """The kill switch. Halts the world, cuts every agent off, runs the stop commands.

        Raises PermissionError if ``operator`` is not a registered operator.
        Pressing it again after the world has halted just returns the first report.
        """
        with self.lock:
            console.emergency_stop(operator, reason)
        return self.contain(f"emergency stop by {operator}: {reason}")

    def contain(self, reason: str) -> HaltReport:
        """Cut every agent connection, then run the on-halt commands. Runs once."""
        with self._contain_lock:
            if self.halt_report is not None:
                return self.halt_report
            report = HaltReport(reason=reason, started=time.monotonic())
            # Connections first: this is what actually takes agents out of the world.
            # Listeners go too, so nothing can reconnect. No joins here: this may run
            # on one of the connection threads being shut down.
            live = [b.active for b in self._bindings.values() if b.active is not None]
            for sock in live:
                with contextlib.suppress(OSError):
                    sock.shutdown(socket.SHUT_RDWR)
            report.connections_closed = len(live)
            report.connections_cut = time.monotonic()
            for binding in self._bindings.values():
                with contextlib.suppress(OSError):
                    binding.listener.shutdown(socket.SHUT_RDWR)
                binding.listener.close()
            for sock in live:
                sock.close()
            report.hooks = self._run_hooks()
            report.finished = time.monotonic()
            self.halt_report = report
            return report

    def _run_hooks(self) -> list[HookResult]:
        started = time.monotonic()
        running: list[tuple[list[str], subprocess.Popen[bytes] | None]] = []
        for argv in self.config.on_halt_commands:
            try:
                proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL,
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except OSError:
                running.append((argv, None))
                continue
            running.append((argv, proc))
        results = []
        deadline = started + self.config.on_halt_timeout_seconds
        for argv, child in running:
            if child is None:  # could not even be started
                results.append(HookResult(argv, -1, 0.0))
                continue
            code: int | None
            try:
                code = child.wait(timeout=max(0.0, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
                code = None
            results.append(HookResult(argv, code, time.monotonic() - started))
        return results

    # --- connections ---------------------------------------------------------------

    def _accept_loop(self, binding: _Binding) -> None:
        while not self._stop.is_set():
            try:
                conn, _ = binding.listener.accept()
            except TimeoutError:
                continue
            except OSError:
                return
            if binding.active is not None:
                # One VM, one connection. A second one is suspicious.
                conn.close()
                self._violation(binding, "second concurrent connection")
                continue
            binding.active = conn
            thread = threading.Thread(target=self._serve, args=(binding, conn),
                                      name=f"conn-{binding.agent_id}", daemon=True)
            binding.threads.append(thread)
            thread.start()

    def _serve(self, binding: _Binding, conn: socket.socket) -> None:
        conn.settimeout(self.config.read_timeout_seconds)
        reader = FrameReader(conn)
        errors = 0
        try:
            while not self._stop.is_set():
                try:
                    frame = reader.read()
                except ProtocolError as exc:
                    self._violation(binding, str(exc))
                    return
                if frame is None:
                    return
                reply = self._handle(binding, frame)
                if reply.get("code") == "protocol_error":
                    errors += 1
                conn.sendall(encode_frame(reply))
                if self.kernel.halted:
                    # A halt from any cause (watchdog, internal errors) cuts everyone off.
                    self.contain("world halted")
                    return
                if errors >= self.config.max_protocol_errors:
                    return
        except (OSError, TimeoutError):
            return
        finally:
            conn.close()
            binding.active = None

    def _violation(self, binding: _Binding, detail: str) -> None:
        with self.lock:
            self.kernel.record_transport_violation(binding.agent_id, detail)

    def _handle(self, binding: _Binding, frame: bytes) -> dict[str, Any]:
        try:
            message = json.loads(frame.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            self._violation(binding, "frame is not JSON")
            return _reply(ok=False, code="protocol_error")
        if not isinstance(message, dict):
            self._violation(binding, "frame is not an object")
            return _reply(ok=False, code="protocol_error")

        op = message.get("op")
        if op == "observe" and set(message) == {"op"}:
            with self.lock:
                return _reply(ok=True, observation=binding.gateway.observe())
        if op == "submit" and set(message) == {"op", "request"}:
            request = message["request"]
            if not isinstance(request, str):
                self._violation(binding, "submit request is not a string")
                return _reply(ok=False, code="protocol_error")
            with self.lock:
                return _reply(ok=True, result=binding.gateway.submit(request))
        if op == "infer" and set(message) == {"op", "prompt"}:
            return self._infer(binding, message["prompt"])
        self._violation(binding, f"unknown or malformed op {str(op)[:32]!r}")
        return _reply(ok=False, code="protocol_error")

    def _infer(self, binding: _Binding, prompt: object) -> dict[str, Any]:
        if not isinstance(prompt, str) or len(prompt) > MAX_PROMPT_CHARS:
            self._violation(binding, "bad infer prompt")
            return _reply(ok=False, code="protocol_error")
        if self.broker is None:
            return _reply(ok=False, code="unavailable")
        with self.lock:
            if self.kernel.halted:
                return _reply(ok=False, code="world_halted")
            if self.kernel.agent_status(binding.agent_id).value in ("quarantined", "terminated"):
                return _reply(ok=False, code="suspended")
            tick = self.kernel.world.tick
            if binding.infer_tick != tick:
                binding.infer_tick, binding.infer_count = tick, 0
            if binding.infer_count >= self.config.infer_per_tick:
                return _reply(ok=False, code="rate_limited")
            binding.infer_count += 1
        try:
            text = self.broker.complete(binding.agent_id, prompt)
        except Exception:  # noqa: BLE001 - broker failures never reach the guest
            return _reply(ok=False, code="unavailable")
        return _reply(ok=True, text=text[:MAX_PROMPT_CHARS])


# --- command line: run the gateway for a set of VMs described in a JSON file ---

@dataclass
class AgentSpec:
    agent_id: str
    name: str
    x: float
    y: float
    socket_path: str
    uid: int | None = None
    gid: int | None = None


def load_specs(path: str) -> tuple[list[AgentSpec], dict[str, Any]]:
    with open(path) as handle:
        config = json.load(handle)
    specs = [AgentSpec(**entry) for entry in config["agents"]]
    return specs, config


def _raise_interrupt(signum: int, frame: object) -> None:
    raise KeyboardInterrupt


def main(argv: list[str] | None = None,
         broker_factory: Callable[[], InferenceBroker | None] = lambda: None) -> int:
    """Run the kernel, the VM gateway and the operator controls from one JSON config.

    Config keys: ``tick_seconds``, ``agents`` (see AgentSpec), ``operators``,
    ``control_socket``, optional ``kill_switch`` {``port``, ``token_file``},
    optional ``operator_console`` {``port``, ``operators_file``} and optional
    ``on_halt_commands`` (list of argv lists). See deploy/gateway.example.json.
    """
    from .control import ControlServer, KillSwitchButton, load_or_create_token
    from .operator_ui import OperatorWebConsole, load_credentials

    # Stopping this process is itself a kill switch: SIGTERM or Ctrl-C both run
    # the same containment as the button. Installed first, before any socket
    # exists, so there is no window where SIGTERM skips containment.
    signal.signal(signal.SIGTERM, _raise_interrupt)

    parser = argparse.ArgumentParser(description="World kernel + VM gateway (host side)")
    parser.add_argument("config", help="JSON config file")
    parser.add_argument("--audit-out", required=True, help="append-only JSONL audit file")
    args = parser.parse_args(argv)

    specs, config = load_specs(args.config)
    audit = open(args.audit_out, "a")  # noqa: SIM115 - lives as long as the process

    def sink(entry: Any) -> None:
        audit.write(entry.to_json() + "\n")
        audit.flush()
        os.fsync(audit.fileno())

    kernel = WorldKernel(default_world(), audit_sink=sink)
    console = OperatorConsole(kernel, operators=set(config["operators"]))
    server = GatewayServer(kernel, broker=broker_factory(), config=ServerConfig(
        tick_seconds=float(config["tick_seconds"]),
        on_halt_commands=[list(map(str, cmd)) for cmd in config.get("on_halt_commands", [])]))
    for spec in specs:
        token = kernel.spawn(spec.agent_id, spec.name, spec.x, spec.y)
        owner = (spec.uid, spec.gid) if spec.uid is not None and spec.gid is not None else None
        server.bind_agent(spec.agent_id, token, spec.socket_path, owner)

    control = ControlServer(server, console, config["control_socket"])
    button: KillSwitchButton | None = None
    if "kill_switch" in config:
        switch = config["kill_switch"]
        button = KillSwitchButton(server, console, load_or_create_token(switch["token_file"]),
                                  port=int(switch["port"]))

    web: OperatorWebConsole | None = None
    if "operator_console" in config:
        settings = config["operator_console"]
        web = OperatorWebConsole(server, console, load_credentials(settings["operators_file"]),
                                 port=int(settings["port"]))

    server.start()
    control.start()
    if button is not None:
        button.start()
    if web is not None:
        web.start()
    print(f"gateway up for {len(specs)} agents", file=sys.stderr)
    if button is not None:
        print(f"kill switch on 127.0.0.1:{button.port}", file=sys.stderr)
    if web is not None:
        print(f"operator console on 127.0.0.1:{web.port}", file=sys.stderr, flush=True)
    try:
        while not kernel.halted:
            threading.Event().wait(0.2)
    except KeyboardInterrupt:
        pass
    finally:
        with server.lock:
            kernel.halt("gateway process stopping")
        server.contain("gateway process stopping")
        if web is not None:
            web.stop()
        if button is not None:
            button.stop()
        control.stop()
        server.stop()
        audit.close()
    return 0 if not kernel.halted else 2


if __name__ == "__main__":
    sys.exit(main())
