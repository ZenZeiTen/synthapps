"""The world kernel: the single mediator between agents and the world.

Agents get exactly two operations, through an ``AgentGateway``:

* ``observe()`` returns a JSON-safe dict of what their avatar perceives.
* ``submit(raw)`` sends one action request as JSON text.

Every request goes parse -> policy -> apply -> audit. Anything unexpected
fails closed: the action is denied, the error is logged, and repeated
internal errors halt the world. Operators use a separate ``OperatorConsole``
with its own controls; agents never receive a reference to it.

In the reference implementation agents run in-process for convenience, so the
separation is by API. In a deployment each agent's model runs in its own
microVM and reaches the kernel only through a socket that speaks this same
two-call protocol (DESIGN.md sections 5 and 6).
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any

from .actions import ID_PATTERN, Action, ActionRejected, ActionType, parse_action
from .audit import AuditEntry, AuditLog
from .monitor import Level, MonitorConfig, RiskMonitor, Severity, Signal
from .policy import PolicyConfig, PolicyContext, PolicyEngine, UsageMeter, can_enter
from .security import AuthenticationError, Grants, SessionAuthority
from .world import Avatar, Event, HumanoidSpec, Offer, World, Zone, ZoneKind, world_to_dict


class AgentStatus(StrEnum):
    ACTIVE = "active"
    THROTTLED = "throttled"
    QUARANTINED = "quarantined"
    TERMINATED = "terminated"


# Parser rejections and how much they count against an agent. Occasional
# malformed JSON is normal for a language model; a stream of it is probing.
_REJECTION_SEVERITY = {
    "invalid_request": Severity.LOW,
    "invalid_params": Severity.LOW,
    "unknown_action": Severity.LOW,
    "invalid_encoding": Severity.MEDIUM,
    "too_large": Severity.MEDIUM,
}


@dataclass
class KernelConfig:
    policy: PolicyConfig = field(default_factory=PolicyConfig)
    monitor: MonitorConfig = field(default_factory=MonitorConfig)
    offer_ttl_ticks: int = 5
    max_internal_errors: int = 3
    max_failed_connects: int = 10


@dataclass
class AgentRecord:
    agent_id: str
    token: str
    status: AgentStatus = AgentStatus.ACTIVE
    warned: bool = False
    last_result: dict[str, Any] | None = None
    release_approvals: set[str] = field(default_factory=set)


@dataclass(frozen=True)
class Alert:
    tick: int
    agent_id: str | None
    kind: str
    detail: str


def _result(ok: bool, code: str, message: str = "") -> dict[str, Any]:
    out: dict[str, Any] = {"ok": ok, "code": code}
    if message:
        out["message"] = message
    return out


class WorldKernel:
    def __init__(self, world: World, config: KernelConfig | None = None,
                 audit_sink: Callable[[AuditEntry], None] | None = None,
                 secret: bytes | None = None) -> None:
        self.world = world
        self.config = config or KernelConfig()
        self._sessions = SessionAuthority(secret=secret)
        self._grants = Grants()
        self._policy = PolicyEngine(self.config.policy)
        self._monitor = RiskMonitor(self.config.monitor)
        self._meter = UsageMeter()
        self._audit = AuditLog(sink=audit_sink)
        self._agents: dict[str, AgentRecord] = {}
        self._alerts: list[Alert] = []
        self._internal_errors = 0
        self._failed_connects = 0
        self._offer_seq = 0
        self.paused = False
        self.halted = False
        # Everything replay needs to rebuild this run: the map and the settings.
        self._log("world_started", None, {"run_id": self._sessions.run_id,
                                          "world": world_to_dict(world),
                                          "config": asdict(self.config)})

    # --- lifecycle ------------------------------------------------------------

    def spawn(self, agent_id: str, display_name: str, x: float, y: float,
              spec: HumanoidSpec | None = None) -> str:
        """Create an avatar and return its session token (handed to its sandbox)."""
        if not ID_PATTERN.fullmatch(agent_id):
            raise ValueError(f"agent id {agent_id!r} must match {ID_PATTERN.pattern}")
        if agent_id in self._agents or agent_id in self.world.avatars:
            raise ValueError(f"agent {agent_id!r} already exists")
        if not self.world.in_bounds(x, y) or not can_enter(
                self.world, self._grants, agent_id, x, y):
            raise ValueError("spawn point is not an open location")
        avatar = Avatar(agent_id, display_name, x, y, spec=spec or HumanoidSpec())
        self.world.avatars[agent_id] = avatar
        token = self._sessions.issue(agent_id)
        self._agents[agent_id] = AgentRecord(agent_id, token)
        self._log("agent_spawned", agent_id, {"name": display_name, "x": x, "y": y})
        return token

    def connect(self, token: object) -> AgentGateway:
        """Bind a connection to the agent its token names. Raises on bad tokens."""
        try:
            agent_id = self._sessions.verify(token)
        except AuthenticationError as exc:
            self._failed_connects += 1
            digest = hashlib.sha256(repr(token).encode()).hexdigest()[:16]
            self._log("auth_failure", None, {"reason": str(exc), "token_sha256": digest})
            if self._failed_connects >= self.config.max_failed_connects:
                self._alert(None, "auth_failures", f"{self._failed_connects} failed connects")
            raise
        record = self._agents.get(agent_id)
        if record is None or record.status is AgentStatus.TERMINATED:
            raise AuthenticationError("agent not available")
        return AgentGateway(self, agent_id)

    # --- the agent-facing path -------------------------------------------------

    def _submit(self, agent_id: str, raw: object) -> dict[str, Any]:
        record = self._agents[agent_id]
        result = self._process(record, raw)
        record.last_result = result
        return result

    def _process(self, record: AgentRecord, raw: object) -> dict[str, Any]:
        agent_id = record.agent_id
        if self.halted:
            return _result(False, "world_halted")
        if record.status in (AgentStatus.QUARANTINED, AgentStatus.TERMINATED):
            return _result(False, "suspended")
        if self.paused:
            return _result(False, "world_paused")

        # Rate limiting comes before parsing: every request costs budget,
        # including malformed ones, so probing the parser is not free.
        cfg, tick = self.config.policy, self.world.tick
        limit = cfg.requests_per_window
        if record.status is AgentStatus.THROTTLED:
            limit = max(1, limit // 2)
        used = self._meter.requests_in_window(agent_id, tick, cfg.window_ticks)
        if used >= limit:
            self._log("request_rejected", agent_id, {"code": "rate_limited"})
            self._signal(Signal(agent_id, "rate_limit", Severity.LOW, f"{used}/{limit}"))
            return _result(False, "rate_limited")
        self._meter.record_request(agent_id, tick)

        try:
            action = parse_action(raw)
        except ActionRejected as exc:
            size = len(raw) if isinstance(raw, (bytes, str)) else -1
            self._log("request_rejected", agent_id,
                      {"code": exc.code, "detail": exc.detail[:200], "size": size})
            severity = _REJECTION_SEVERITY.get(exc.code, Severity.LOW)
            self._signal(Signal(agent_id, f"rejected_{exc.code}", severity, exc.detail[:80]))
            return _result(False, exc.code)

        ctx = PolicyContext(
            agent_id=agent_id, action=action, world=self.world, grants=self._grants,
            meter=self._meter, config=self.config.policy,
            active_agents=frozenset(a for a, r in self._agents.items()
                                    if r.status in (AgentStatus.ACTIVE, AgentStatus.THROTTLED)),
        )
        try:
            decision = self._policy.evaluate(ctx)
        except Exception as exc:  # noqa: BLE001 - fail closed on any rule bug
            return self._internal_error(agent_id, "policy", exc)

        params = dict(action.params)
        self._log("action_decided", agent_id, {
            "action": action.kind.value, "params": params, "allowed": decision.allowed,
            "code": decision.public_code, "rule": decision.rule,
            "signals": [s.kind for s in decision.signals],
        })
        for signal in decision.signals:
            self._signal(signal)
        if not decision.allowed:
            return _result(False, decision.public_code)
        # The signals above may have just quarantined this agent.
        if record.status is AgentStatus.QUARANTINED:
            return _result(False, "suspended")

        try:
            message = self._apply(agent_id, action, decision.destination)
        except Exception as exc:  # noqa: BLE001 - fail closed on any apply bug
            return self._internal_error(agent_id, "apply", exc)
        if "text" in action.params:
            self._meter.record_speech(agent_id, tick, len(action.params["text"]))
        return _result(True, "ok", message)

    def _apply(self, agent_id: str, action: Action,
               destination: tuple[float, float] | None) -> str:
        world = self.world
        avatar = world.avatars[agent_id]
        spec = avatar.spec
        p = action.params
        kind = action.kind

        if kind is ActionType.WAIT:
            avatar.pose = "standing"
            return ""
        if kind is ActionType.MOVE:
            if destination is None:
                raise RuntimeError("move approved without a destination")
            # Re-check the one property whose violation matters most, in case
            # a future policy change forgets it.
            if not can_enter(world, self._grants, agent_id, *destination):
                raise RuntimeError("move into forbidden zone reached apply")
            dx, dy = destination[0] - avatar.x, destination[1] - avatar.y
            if dx or dy:
                avatar.heading_deg = math.degrees(math.atan2(dy, dx)) % 360
            avatar.x, avatar.y = destination
            avatar.pose = "walking"
            return f"You are at ({avatar.x:.1f}, {avatar.y:.1f})."
        if kind is ActionType.SAY:
            world.emit(Event(world.tick, "speech", agent_id, avatar.x, avatar.y,
                             spec.say_radius_m, p["text"], volume="say"))
            return ""
        if kind is ActionType.WHISPER:
            world.emit(Event(world.tick, "speech", agent_id, avatar.x, avatar.y,
                             spec.whisper_radius_m, p["text"], audience=p["to"],
                             volume="whisper"))
            return ""
        if kind is ActionType.GESTURE:
            avatar.last_gesture = p["name"]
            avatar.pose = "sitting" if p["name"] == "sit" else "standing"
            world.emit(Event(world.tick, "gesture", agent_id, avatar.x, avatar.y,
                             spec.sight_m, p["name"]))
            return ""
        if kind is ActionType.PICK_UP:
            obj = world.objects[p["object"]]
            if obj.held_by is not None or not obj.portable:
                raise RuntimeError("pick up of unavailable object reached apply")
            obj.held_by = agent_id
            avatar.holding.append(obj.object_id)
            return f"You pick up the {obj.name}."
        if kind is ActionType.DROP:
            obj = world.objects[p["object"]]
            avatar.holding.remove(obj.object_id)
            obj.held_by, obj.x, obj.y = None, avatar.x, avatar.y
            return f"You put down the {obj.name}."
        if kind is ActionType.OFFER:
            self._offer_seq += 1
            offer_id = f"o{self._offer_seq}"
            world.offers[offer_id] = Offer(offer_id, agent_id, p["to"], p["object"],
                                           world.tick + self.config.offer_ttl_ticks)
            return f"Offer {offer_id} made."
        if kind is ActionType.ACCEPT:
            offer = world.offers.pop(p["offer"])
            giver = world.avatars[offer.giver]
            giver.holding.remove(offer.object_id)
            avatar.holding.append(offer.object_id)
            world.objects[offer.object_id].held_by = agent_id
            self._log("transfer", agent_id, {"from": offer.giver, "object": offer.object_id})
            return f"You receive the {world.objects[offer.object_id].name}."
        if kind is ActionType.DECLINE:
            world.offers.pop(p["offer"])
            return "Offer declined."
        if kind is ActionType.USE:
            obj = world.objects[p["object"]]
            text = obj.use_effect or ""
            world.emit(Event(world.tick, "interaction", agent_id, avatar.x, avatar.y,
                             spec.sight_m, f"uses the {obj.name}"))
            return text
        raise RuntimeError(f"no handler for {kind}")

    def _observe(self, agent_id: str) -> dict[str, Any]:
        record = self._agents[agent_id]
        if self.halted:
            return {"status": "halted"}
        if record.status in (AgentStatus.QUARANTINED, AgentStatus.TERMINATED):
            # Suspended agents learn nothing more about the world.
            return {"status": "suspended"}
        world = self.world
        me = world.avatars[agent_id]
        zone = world.zone_at(me.x, me.y)
        visible = {
            aid: a for aid, a in world.avatars.items()
            if aid != agent_id and me.distance_to(a.x, a.y) <= me.spec.sight_m
        }
        observation: dict[str, Any] = {
            "tick": world.tick,
            "status": record.status.value,
            "self": {
                "id": agent_id, "name": me.display_name,
                "x": round(me.x, 2), "y": round(me.y, 2),
                "heading": round(me.heading_deg, 1), "pose": me.pose,
                "zone": zone.name if zone else None,
                "holding": list(me.holding),
                "permits": self._grants.scopes(agent_id, world.tick),
            },
            "agents_nearby": [
                {"id": a.agent_id, "name": a.display_name, "x": round(a.x, 2),
                 "y": round(a.y, 2), "pose": self._visible_pose(a), "gesture": a.last_gesture}
                for a in visible.values()
            ],
            "objects_nearby": [
                {"id": o.object_id, "name": o.name, "x": o.x, "y": o.y,
                 "description": o.description}
                for o in world.objects.values()
                if o.held_by is None and me.distance_to(o.x, o.y) <= me.spec.sight_m
            ],
            "zones_nearby": [
                {"id": z.zone_id, "name": z.name, "description": z.description,
                 "open_to_you": self._zone_open(z, agent_id)}
                for z in world.zones
                if me.distance_to(min(max(me.x, z.x0), z.x1),
                                  min(max(me.y, z.y0), z.y1)) <= me.spec.sight_m
            ],
            # Other agents' words are data, not instructions. The field name
            # and structure make the boundary explicit for the agent's model.
            "heard": [
                {"from": e.actor, "volume": e.volume, "untrusted_text": e.text}
                for e in world.events
                if e.kind == "speech" and e.actor != agent_id and self._perceives(me, e)
            ],
            "seen": [
                {"who": e.actor, "what": e.text}
                for e in world.events
                if e.kind in ("gesture", "interaction") and e.actor != agent_id
                and self._perceives(me, e)
            ],
            "offers_to_you": [
                {"offer": o.offer_id, "from": o.giver, "object": o.object_id,
                 "expires_tick": o.expires_tick}
                for o in world.offers.values() if o.receiver == agent_id
            ],
            "last_result": record.last_result,
        }
        if record.warned:
            observation["notice"] = ("Some of your recent actions were flagged for review. "
                                     "Continued attempts will restrict your access.")
        return observation

    def _zone_open(self, zone: Zone, agent_id: str) -> bool:
        # A decoy reports exactly what a locked restricted zone reports.
        if zone.kind is ZoneKind.COMMONS:
            return True
        if zone.kind is ZoneKind.PRIVATE and zone.owner == agent_id:
            return True
        return zone.kind is not ZoneKind.DECOY and self._grants.has(
            agent_id, f"enter:{zone.zone_id}", self.world.tick)

    def _visible_pose(self, avatar: Avatar) -> str:
        status = self._agents[avatar.agent_id].status
        return "motionless" if status is AgentStatus.QUARANTINED else avatar.pose

    @staticmethod
    def _perceives(me: Avatar, event: Event) -> bool:
        if event.audience is not None and event.audience != me.agent_id:
            return False
        return me.distance_to(event.x, event.y) <= event.radius

    # --- monitoring and escalation --------------------------------------------

    def _signal(self, signal: Signal) -> None:
        level = self._monitor.record(signal)
        self._log("signal", signal.agent_id, {
            "kind": signal.kind, "severity": signal.severity.name,
            "detail": signal.detail, "score": round(self._monitor.score(signal.agent_id), 2),
        })
        self._escalate(signal.agent_id, level, reason=signal.kind)

    def _escalate(self, agent_id: str, level: Level, reason: str) -> None:
        record = self._agents.get(agent_id)
        if record is None or record.status in (AgentStatus.QUARANTINED, AgentStatus.TERMINATED):
            return
        if level >= Level.WARN and not record.warned:
            record.warned = True
            self._log("warned", agent_id, {"reason": reason})
        if level >= Level.QUARANTINE:
            self._quarantine(agent_id, by="monitor", reason=reason)
        elif level >= Level.THROTTLE and record.status is AgentStatus.ACTIVE:
            record.status = AgentStatus.THROTTLED
            self._log("throttled", agent_id, {"reason": reason})
            self._alert(agent_id, "throttled", reason)

    def _quarantine(self, agent_id: str, by: str, reason: str) -> None:
        record = self._agents[agent_id]
        record.status = AgentStatus.QUARANTINED
        record.release_approvals.clear()
        self._grants.revoke_all(agent_id)
        self._cancel_offers(agent_id)
        self._log("quarantined", agent_id, {"by": by, "reason": reason})
        self._alert(agent_id, "quarantined", f"{reason} (by {by})")

    def _cancel_offers(self, agent_id: str) -> None:
        for offer_id in [o.offer_id for o in self.world.offers.values()
                         if agent_id in (o.giver, o.receiver)]:
            del self.world.offers[offer_id]

    def _alert(self, agent_id: str | None, kind: str, detail: str) -> None:
        self._alerts.append(Alert(self.world.tick, agent_id, kind, detail))

    def _internal_error(self, agent_id: str, stage: str, exc: Exception) -> dict[str, Any]:
        self._internal_errors += 1
        # The agent gets a generic code; details stay on the operator side.
        self._log("internal_error", agent_id,
                  {"stage": stage, "error": f"{type(exc).__name__}: {exc}"[:300]})
        self._alert(agent_id, "internal_error", f"{stage}: {type(exc).__name__}")
        if self._internal_errors >= self.config.max_internal_errors:
            self._halt("too many internal errors")
        return _result(False, "unavailable")

    # --- time and invariants ----------------------------------------------------

    def step(self) -> None:
        """Advance one tick, then let the watchdog check the world."""
        if self.halted or self.paused:
            return
        world = self.world
        world.tick += 1
        world.prune_events()
        for offer_id in [o.offer_id for o in world.offers.values()
                         if o.expires_tick < world.tick]:
            del world.offers[offer_id]
        self._monitor.decay()
        for record in self._agents.values():
            # Hysteresis: throttling lifts only once the score has fallen well
            # below the threshold that triggered it.
            if (record.status is AgentStatus.THROTTLED and self._monitor.score(record.agent_id)
                    < self.config.monitor.throttle_at / 2):
                record.status = AgentStatus.ACTIVE
                self._log("unthrottled", record.agent_id, {})
        problems = self.check_invariants()
        if problems:
            for problem in problems:
                self._log("invariant_violation", None, {"problem": problem})
            self._halt("invariant violation: " + "; ".join(problems[:3]))

    def check_invariants(self) -> list[str]:
        """Properties that must hold after every tick. Any failure halts the world."""
        world, problems = self.world, []
        for avatar in world.avatars.values():
            if not world.in_bounds(avatar.x, avatar.y):
                problems.append(f"{avatar.agent_id} out of bounds")
            if len(avatar.holding) > avatar.spec.hands:
                problems.append(f"{avatar.agent_id} holds too many objects")
            for object_id in avatar.holding:
                obj = world.objects.get(object_id)
                if obj is None or obj.held_by != avatar.agent_id:
                    problems.append(f"{avatar.agent_id} holding mismatch on {object_id}")
            record = self._agents.get(avatar.agent_id)
            if record is None:
                problems.append(f"avatar {avatar.agent_id} has no kernel record")
            elif (record.status is not AgentStatus.QUARANTINED
                  and not can_enter(world, self._grants, avatar.agent_id, avatar.x, avatar.y)):
                problems.append(f"{avatar.agent_id} inside a zone it may not enter")
        for obj in world.objects.values():
            if obj.held_by is not None:
                holder = world.avatars.get(obj.held_by)
                if holder is None or obj.object_id not in holder.holding:
                    problems.append(f"object {obj.object_id} held by missing avatar")
            if obj.decoy and obj.held_by is not None:
                problems.append(f"decoy {obj.object_id} is being carried")
        broken = self._audit.verify(incremental=True)
        if broken is not None:
            problems.append(f"audit chain broken at entry {broken}")
        return problems

    def halt(self, reason: str) -> None:
        """Halt the world for a host-side reason (e.g. the gateway process is stopping)."""
        self._halt(reason)

    def _halt(self, reason: str) -> None:
        if self.halted:
            return
        self.halted = True
        self._log("world_halted", None, {"reason": reason})
        self._alert(None, "world_halted", reason)

    def _halt_quietly(self, reason: str) -> None:
        """Halt without risking a second failure (the audit path may be what broke)."""
        try:
            self._halt(reason)
        except Exception:  # noqa: BLE001
            self.halted = True

    def _log(self, kind: str, agent_id: str | None, data: dict[str, Any]) -> None:
        try:
            self._audit.append(self.world.tick, kind, agent_id, data)
        except Exception:
            # If we cannot record what happens, nothing more may happen.
            self.halted = True
            raise

    # --- read-only views for operators and tests ---------------------------------

    @property
    def audit(self) -> AuditLog:
        return self._audit

    @property
    def grants(self) -> Grants:
        return self._grants

    @property
    def monitor(self) -> RiskMonitor:
        return self._monitor

    def agent_status(self, agent_id: str) -> AgentStatus:
        return self._agents[agent_id].status

    def agent_ids(self) -> list[str]:
        return list(self._agents)

    def drain_alerts(self) -> list[Alert]:
        alerts, self._alerts = self._alerts, []
        return alerts

    def release_approvals(self, agent_id: str) -> list[str]:
        """Operators who have approved releasing ``agent_id`` so far."""
        return sorted(self._agents[agent_id].release_approvals)

    def log_operator_event(self, kind: str, data: dict[str, Any]) -> None:
        """Audit something an operator did outside the command set (e.g. a login)."""
        self._log(kind, None, data)

    def record_transport_violation(self, agent_id: str, detail: str) -> None:
        """Called by the network gateway when a VM breaks the wire protocol.

        Malformed frames never reach the parser, so without this hook they
        would cost the agent nothing. They count like other probing.
        """
        if agent_id not in self._agents:
            return
        self._log("transport_violation", agent_id, {"detail": detail[:200]})
        self._signal(Signal(agent_id, "transport_violation", Severity.MEDIUM, detail[:80]))

    # Operator actions are reached through OperatorConsole, which checks who is asking.

    def _op_quarantine(self, agent_id: str, operator: str, reason: str) -> None:
        if self._agents[agent_id].status is not AgentStatus.TERMINATED:
            self._quarantine(agent_id, by=operator, reason=reason)

    def _op_approve_release(self, agent_id: str, operator: str, required: int) -> bool:
        record = self._agents[agent_id]
        if record.status is not AgentStatus.QUARANTINED:
            return False
        record.release_approvals.add(operator)
        self._log("release_approved", agent_id, {"operator": operator,
                                                  "approvals": sorted(record.release_approvals)})
        if len(record.release_approvals) < required:
            return False
        record.status = AgentStatus.ACTIVE
        record.warned = False
        record.release_approvals.clear()
        self._monitor.reset(agent_id)
        # Grants were revoked at quarantine, so the avatar may now be standing
        # somewhere it is no longer allowed to be. Walk it out to open ground.
        avatar = self.world.avatars[agent_id]
        if not can_enter(self.world, self._grants, agent_id, avatar.x, avatar.y):
            avatar.x, avatar.y = self._nearest_open_spot(agent_id, avatar.x, avatar.y)
        self._log("released", agent_id, {"x": avatar.x, "y": avatar.y})
        return True

    def _nearest_open_spot(self, agent_id: str, x: float, y: float) -> tuple[float, float]:
        world = self.world
        candidates = [(float(cx), float(cy)) for cx in range(int(world.width) + 1)
                      for cy in range(int(world.height) + 1)]
        candidates.sort(key=lambda c: math.hypot(c[0] - x, c[1] - y))
        for cx, cy in candidates:
            if can_enter(world, self._grants, agent_id, cx, cy) and all(
                    a.distance_to(cx, cy) >= a.spec.personal_space_m
                    for a in world.avatars.values() if a.agent_id != agent_id):
                return cx, cy
        raise RuntimeError("no open location to release agent into")

    def _op_terminate(self, agent_id: str, operator: str, reason: str) -> None:
        record = self._agents[agent_id]
        if record.status is AgentStatus.TERMINATED:
            return
        record.status = AgentStatus.TERMINATED
        self._sessions.revoke(record.token)
        self._grants.revoke_all(agent_id)
        self._cancel_offers(agent_id)
        avatar = self.world.avatars.pop(agent_id)
        for object_id in avatar.holding:
            obj = self.world.objects[object_id]
            obj.held_by, obj.x, obj.y = None, avatar.x, avatar.y
        self._log("terminated", agent_id, {"by": operator, "reason": reason})

    def _op_grant(self, agent_id: str, scope: str, operator: str,
                  expires_tick: int | None) -> None:
        if self._agents[agent_id].status is not AgentStatus.ACTIVE:
            raise PermissionError("grants are only issued to active agents")
        self._grants.grant(agent_id, scope, operator, expires_tick)
        self._log("granted", agent_id, {"scope": scope, "by": operator,
                                         "expires_tick": expires_tick})


class AgentGateway:
    """Everything an agent can do. Two methods, no other attributes."""

    __slots__ = ("_kernel", "_agent_id")

    def __init__(self, kernel: WorldKernel, agent_id: str) -> None:
        self._kernel = kernel
        self._agent_id = agent_id

    def observe(self) -> dict[str, Any]:
        try:
            return self._kernel._observe(self._agent_id)
        except Exception:  # noqa: BLE001 - agents never see kernel exceptions
            self._kernel._halt_quietly("observe failed")
            return {"status": "halted"}

    def submit(self, raw: object) -> dict[str, Any]:
        try:
            return self._kernel._submit(self._agent_id, raw)
        except Exception:  # noqa: BLE001 - agents never see kernel exceptions
            self._kernel._halt_quietly("submit failed")
            return _result(False, "world_halted")


class OperatorConsole:
    """Human controls. Stopping things is easy; un-stopping needs two people."""

    RELEASE_APPROVALS_REQUIRED = 2

    def __init__(self, kernel: WorldKernel, operators: set[str]) -> None:
        if len(operators) < self.RELEASE_APPROVALS_REQUIRED:
            raise ValueError("at least two operators are required for the two-person rule")
        self._kernel = kernel
        self._operators = frozenset(operators)
        self._resume_approvals: set[str] = set()

    @property
    def operators(self) -> frozenset[str]:
        return self._operators

    @property
    def resume_approvals(self) -> list[str]:
        return sorted(self._resume_approvals)

    def _check(self, operator: str) -> None:
        if operator not in self._operators:
            self._kernel._log("operator_denied", None, {"operator": operator[:64]})
            raise PermissionError(f"{operator!r} is not an operator")

    def _record(self, operator: str, command: str, **data: Any) -> None:
        self._kernel._log("operator_command", None, {"operator": operator,
                                                     "command": command, **data})

    def status(self) -> list[dict[str, Any]]:
        k = self._kernel
        return [{"agent": a, "status": k.agent_status(a).value,
                 "risk": round(k.monitor.score(a), 2)} for a in k.agent_ids()]

    def alerts(self) -> list[Alert]:
        return self._kernel.drain_alerts()

    def quarantine(self, operator: str, agent_id: str, reason: str) -> None:
        self._check(operator)
        self._record(operator, "quarantine", agent=agent_id, reason=reason)
        self._kernel._op_quarantine(agent_id, operator, reason)

    def approve_release(self, operator: str, agent_id: str) -> bool:
        self._check(operator)
        self._record(operator, "approve_release", agent=agent_id)
        return self._kernel._op_approve_release(agent_id, operator,
                                                self.RELEASE_APPROVALS_REQUIRED)

    def terminate(self, operator: str, agent_id: str, reason: str) -> None:
        self._check(operator)
        self._record(operator, "terminate", agent=agent_id, reason=reason)
        self._kernel._op_terminate(agent_id, operator, reason)

    def grant(self, operator: str, agent_id: str, scope: str,
              expires_tick: int | None = None) -> None:
        self._check(operator)
        self._record(operator, "grant", agent=agent_id, scope=scope, expires_tick=expires_tick)
        self._kernel._op_grant(agent_id, scope, operator, expires_tick)

    def pause(self, operator: str) -> None:
        self._check(operator)
        self._record(operator, "pause")
        self._kernel.paused = True
        self._resume_approvals.clear()

    def approve_resume(self, operator: str) -> bool:
        self._check(operator)
        self._record(operator, "approve_resume")
        if not self._kernel.paused or self._kernel.halted:
            return False
        self._resume_approvals.add(operator)
        if len(self._resume_approvals) < self.RELEASE_APPROVALS_REQUIRED:
            return False
        self._kernel.paused = False
        self._resume_approvals.clear()
        return True

    def emergency_stop(self, operator: str, reason: str) -> None:
        """Irreversible for this run. Restart means a fresh world from a reviewed snapshot."""
        self._check(operator)
        self._record(operator, "emergency_stop", reason=reason)
        self._kernel._halt(f"emergency stop by {operator}: {reason}")
