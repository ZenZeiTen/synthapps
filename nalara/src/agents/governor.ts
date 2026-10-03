import type { AgentBudget, AgentUsage, AuditLog, EventBus, FleetBudget, FleetUsage, Governor, Priority } from "../kernel/types";

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const FAILURES_TO_OPEN = 5;
const OKS_PER_LANE = 3;
const DEFAULT_COOLDOWN_MS = 10_000;

type TimerHandle = unknown;

interface Waiter {
  instanceId: string;
  rank: number;
  order: number;
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
  cleanup: () => void;
}

interface InstanceState {
  usage: AgentUsage;
  startedAt?: number;
  budget?: AgentBudget;
  repeats: Map<string, number>;
  exceeded?: string;
  fleetId?: string;
}

interface FleetState {
  budget?: FleetBudget;
  usage: FleetUsage;
  exceeded?: string;
}

const zeroFleet = (): FleetUsage => ({ agents: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0, messages: 0 });

/** The first fleet dimension over its limit, or undefined. */
export function fleetOverrun(u: FleetUsage, b: FleetBudget | undefined): string | undefined {
  if (!b) return undefined;
  if (u.agents > b.maxAgents) return `agents ${u.agents} > ${b.maxAgents}`;
  if (u.inputTokens > b.maxInputTokens) return `input tokens ${u.inputTokens} > ${b.maxInputTokens}`;
  if (u.outputTokens > b.maxOutputTokens) return `output tokens ${u.outputTokens} > ${b.maxOutputTokens}`;
  if (u.toolCalls > b.maxToolCalls) return `tool calls ${u.toolCalls} > ${b.maxToolCalls}`;
  if (u.messages > b.maxMessages) return `relay messages ${u.messages} > ${b.maxMessages}`;
  return undefined;
}

const zeroUsage = (): AgentUsage => ({ inputTokens: 0, outputTokens: 0, toolCalls: 0, turns: 0, wallMs: 0 });

/**
 * Admission control, per-instance budgets, repeat-call detection and AIMD backpressure for the model provider.
 *
 * - admit(): priority queue (urgent > high > normal > low, FIFO within a priority); resolves with a release fn.
 * - AIMD: rate_limited / overloaded halve the lanes (min 1); every 3 consecutive "ok" add one lane (max maxLanes).
 * - Circuit: 5 consecutive non-ok outcomes open it. While open, admit() calls stay queued (they are not rejected).
 *   After `cooldownMs` it goes half_open and admits one probe; "ok" closes it, any failure re-opens it.
 * - wallMs is measured by the governor from the instance's first admit/charge; a passed wallMs is ignored.
 * - Repeat detection: identical toolKey counted per instance; exceeded when count > maxRepeatCalls.
 * - Fleet budgets: an instance assigned to a fleet (one workspace run) also charges the fleet. Once any fleet
 *   dimension is over its limit, every instance of that fleet is over budget on its next charge.
 * Clock and timers are injectable for deterministic tests.
 */
export function createGovernor(opts: {
  maxLanes: number;
  bus?: EventBus;
  audit?: AuditLog;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  cooldownMs?: number;
}): Governor {
  const maxLanes = Math.max(1, Math.floor(opts.maxLanes));
  const now = opts.now ?? Date.now;
  const setTimer =
    opts.setTimer ??
    ((fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      t.unref?.();
      return t;
    });
  const clearTimer = opts.clearTimer ?? ((h: TimerHandle) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;

  let lanes = maxLanes;
  let running = 0;
  let order = 0;
  let circuit: "closed" | "open" | "half_open" = "closed";
  let probeInFlight = false;
  let failures = 0;
  let oks = 0;
  let cooldownTimer: TimerHandle | undefined;
  const queue: Waiter[] = [];
  const instances = new Map<string, InstanceState>();
  const fleets = new Map<string, FleetState>();

  const fleet = (id: string): FleetState => {
    let f = fleets.get(id);
    if (!f) fleets.set(id, (f = { usage: zeroFleet() }));
    return f;
  };

  function exceedFleet(id: string, f: FleetState, reason: string) {
    f.exceeded = reason;
    opts.bus?.publish("budget.exceeded", { fleetId: id, workspaceId: id, reason: `fleet budget: ${reason}`, usage: { ...f.usage } }, { source: "governor", correlationId: id });
    opts.audit?.append({ kind: "budget", principal: null, subject: id, outcome: "denied", detail: { fleet: true, reason, usage: { ...f.usage } } });
  }

  const state = (id: string, startClock = true): InstanceState => {
    let s = instances.get(id);
    if (!s) instances.set(id, (s = { usage: zeroUsage(), repeats: new Map() }));
    if (startClock) s.startedAt ??= now();
    return s;
  };

  const log = (level: "info" | "warn", message: string) => opts.bus?.publish("kernel.log", { level, message, circuit, lanes }, { source: "governor" });

  function canAdmit(): boolean {
    if (running >= lanes) return false;
    if (circuit === "open") return false;
    if (circuit === "half_open") return !probeInFlight;
    return true;
  }

  function pump() {
    while (queue.length > 0 && canAdmit()) {
      let best = 0;
      for (let i = 1; i < queue.length; i++) {
        const a = queue[i];
        const b = queue[best];
        if (a.rank < b.rank || (a.rank === b.rank && a.order < b.order)) best = i;
      }
      const [w] = queue.splice(best, 1);
      w.cleanup();
      running++;
      const isProbe = circuit === "half_open";
      if (isProbe) probeInFlight = true;
      let released = false;
      w.resolve(() => {
        if (released) return;
        released = true;
        running--;
        // A probe that finished without a provider report must not block the half-open circuit forever.
        if (isProbe && circuit === "half_open") probeInFlight = false;
        pump();
      });
    }
  }

  function openCircuit() {
    circuit = "open";
    probeInFlight = false;
    if (cooldownTimer !== undefined) clearTimer(cooldownTimer);
    cooldownTimer = setTimer(() => {
      cooldownTimer = undefined;
      circuit = "half_open";
      log("info", "provider circuit half-open: admitting one probe");
      pump();
    }, cooldownMs);
    log("warn", `provider circuit open after ${failures} consecutive failures; retry in ${cooldownMs} ms`);
  }

  function exceed(id: string, s: InstanceState, reason: string) {
    s.exceeded = reason;
    opts.bus?.publish("budget.exceeded", { instanceId: id, reason, usage: { ...s.usage } }, { source: "governor" });
    opts.audit?.append({ kind: "budget", principal: null, subject: id, outcome: "denied", detail: { reason, usage: { ...s.usage } } });
  }

  return {
    admit(instanceId, priority, signal) {
      state(instanceId);
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new Error(`admission aborted for ${instanceId}`));
        const onAbort = () => {
          const i = queue.indexOf(w);
          if (i >= 0) queue.splice(i, 1);
          reject(new Error(`admission aborted for ${instanceId}`));
        };
        const w: Waiter = {
          instanceId,
          rank: PRIORITY_RANK[priority] ?? PRIORITY_RANK.normal,
          order: order++,
          resolve,
          reject,
          cleanup: () => signal?.removeEventListener("abort", onAbort),
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        queue.push(w);
        pump();
      });
    },

    setBudget(instanceId, budget) {
      state(instanceId, false).budget = { ...budget };
    },

    charge(instanceId, usage) {
      const s = state(instanceId);
      const u = s.usage;
      u.inputTokens += usage.inputTokens ?? 0;
      u.outputTokens += usage.outputTokens ?? 0;
      u.toolCalls += usage.toolCalls ?? 0;
      u.turns += usage.turns ?? 0;
      u.wallMs = now() - (s.startedAt ?? now());
      let repeats = 0;
      if (usage.toolKey) {
        repeats = (s.repeats.get(usage.toolKey) ?? 0) + 1;
        s.repeats.set(usage.toolKey, repeats);
      }
      if (s.exceeded) return { exceeded: true, reason: s.exceeded };
      if (s.fleetId) {
        const f = fleet(s.fleetId);
        f.usage.inputTokens += usage.inputTokens ?? 0;
        f.usage.outputTokens += usage.outputTokens ?? 0;
        f.usage.toolCalls += usage.toolCalls ?? 0;
        if (!f.exceeded) {
          const over = fleetOverrun(f.usage, f.budget);
          if (over) exceedFleet(s.fleetId, f, over);
        }
        if (f.exceeded) {
          const reason = `fleet budget: ${f.exceeded}`;
          exceed(instanceId, s, reason);
          return { exceeded: true, reason };
        }
      }
      const b = s.budget;
      if (!b) return { exceeded: false };
      const reason =
        u.inputTokens > b.maxInputTokens ? `input tokens ${u.inputTokens} > ${b.maxInputTokens}`
        : u.outputTokens > b.maxOutputTokens ? `output tokens ${u.outputTokens} > ${b.maxOutputTokens}`
        : u.toolCalls > b.maxToolCalls ? `tool calls ${u.toolCalls} > ${b.maxToolCalls}`
        : u.turns > b.maxTurns ? `turns ${u.turns} > ${b.maxTurns}`
        : u.wallMs > b.maxWallMs ? `wall time ${u.wallMs} ms > ${b.maxWallMs} ms`
        : repeats > b.maxRepeatCalls ? `repeated identical call ${repeats} times (limit ${b.maxRepeatCalls}): ${usage.toolKey}`
        : undefined;
      if (!reason) return { exceeded: false };
      exceed(instanceId, s, reason);
      return { exceeded: true, reason };
    },

    usage(instanceId) {
      const s = instances.get(instanceId);
      if (!s) return zeroUsage();
      return { ...s.usage, wallMs: s.startedAt === undefined ? 0 : now() - s.startedAt };
    },

    reportProvider(outcome) {
      if (outcome === "ok") {
        failures = 0;
        if (circuit !== "closed") {
          circuit = "closed";
          probeInFlight = false;
          log("info", "provider circuit closed");
        }
        if (++oks >= OKS_PER_LANE) {
          oks = 0;
          lanes = Math.min(maxLanes, lanes + 1);
        }
        pump();
        return;
      }
      oks = 0;
      failures++;
      if (outcome === "rate_limited" || outcome === "overloaded") lanes = Math.max(1, Math.floor(lanes / 2));
      if (circuit === "half_open" || (circuit === "closed" && failures >= FAILURES_TO_OPEN)) openCircuit();
    },

    snapshot() {
      return { lanes, maxLanes, running, queued: queue.length, circuit };
    },

    release(instanceId) {
      instances.delete(instanceId);
    },

    setFleetBudget(fleetId, budget) {
      fleets.set(fleetId, { budget: { ...budget }, usage: zeroFleet() });
    },

    assignFleet(instanceId, fleetId) {
      const s = state(instanceId, false);
      s.fleetId = fleetId;
      const f = fleet(fleetId);
      f.usage.agents++;
      if (!f.exceeded) {
        const over = fleetOverrun(f.usage, f.budget);
        if (over) exceedFleet(fleetId, f, over);
      }
      return f.exceeded ? { exceeded: true, reason: `fleet budget: ${f.exceeded}` } : { exceeded: false };
    },

    chargeFleet(fleetId, usage) {
      const f = fleet(fleetId);
      f.usage.messages += usage.messages ?? 0;
      if (!f.exceeded) {
        const over = fleetOverrun(f.usage, f.budget);
        if (over) exceedFleet(fleetId, f, over);
      }
      return f.exceeded ? { exceeded: true, reason: `fleet budget: ${f.exceeded}` } : { exceeded: false };
    },

    fleetUsage(fleetId) {
      const f = fleets.get(fleetId);
      if (!f) return undefined;
      return { ...(f.budget ? { budget: { ...f.budget } } : {}), usage: { ...f.usage }, ...(f.exceeded ? { exceeded: f.exceeded } : {}) };
    },
  };
}
