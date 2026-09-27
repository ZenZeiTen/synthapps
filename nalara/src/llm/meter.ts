/**
 * Provider-agnostic metering for LLM providers.
 *
 * The Governor must see every model request (admission before it, usage charged after it), including
 * each turn inside `runAgentLoop`. A wrapper cannot see those inner requests on its own, so providers
 * may implement the small `HookableProvider` protocol below: `withHooks(hooks)` returns a view of the
 * provider that calls the hooks around every single API request. The Claude provider and the scripted
 * test double both implement it. For any other provider `meterProvider` falls back to metering each
 * public call as one unit (usage estimated from text length for complete/structured).
 *
 * Wiring in the kernel (the Governor is another module):
 *
 *   const llm = meterProvider(provider, {
 *     beforeCall: (signal) => governor.admit(instanceId, priority, signal),
 *     afterCall: (usage) => governor.charge(instanceId, usage),
 *   });
 */
import { LLMError, type AgentLoopResult, type LLMProvider } from "../kernel/types";

export interface ModelCallUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Called by a provider around every API request it makes. */
export interface ModelCallHooks {
  /** Waits for admission; resolves to a release function the provider calls when the request settles. */
  beforeModelCall?: (signal?: AbortSignal) => Promise<() => void>;
  /** Called after every response. Throwing (for example an LLMError) aborts the current call or loop. */
  afterModelCall?: (usage: ModelCallUsage) => void;
}

export interface HookableProvider extends LLMProvider {
  withHooks(hooks: ModelCallHooks): LLMProvider;
}

export function isHookableProvider(provider: LLMProvider): provider is HookableProvider {
  return typeof (provider as Partial<HookableProvider>).withHooks === "function";
}

/** Usage charged per model request; `turns` is 1 per request so a Governor can enforce maxTurns. */
export interface MeteredUsage extends ModelCallUsage {
  turns: number;
}

export interface MeterHooks {
  /** Admission control, e.g. `governor.admit(instanceId, priority, signal)`. */
  beforeCall?: (signal?: AbortSignal) => Promise<() => void>;
  /** Charge usage, e.g. `governor.charge(instanceId, usage)`. */
  afterCall?: (usage: MeteredUsage) => { exceeded: boolean; reason?: string };
}

export const BUDGET_EXCEEDED_PREFIX = "Budget exceeded";

/**
 * Wraps a provider so every model call waits for admission and charges usage. When a budget is exceeded
 * the current call or agent loop is stopped with `LLMError(kind "budget")`, and every later call on the
 * same metered provider fails the same way (a budget does not refill within one instance).
 */
export function meterProvider(provider: LLMProvider, hooks: MeterHooks): LLMProvider {
  let exceededReason: string | undefined;

  const budgetError = (reason: string) =>
    new LLMError(`${BUDGET_EXCEEDED_PREFIX}: ${reason}`, "budget", { budgetExceeded: reason });

  const ensureWithinBudget = () => {
    if (exceededReason !== undefined) throw budgetError(exceededReason);
  };

  const charge = (usage: ModelCallUsage) => {
    const verdict = hooks.afterCall?.({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, turns: 1 });
    if (verdict?.exceeded) {
      exceededReason = verdict.reason ?? "limit reached";
      throw budgetError(exceededReason);
    }
  };

  const admit = async (signal?: AbortSignal) => {
    ensureWithinBudget();
    return (await hooks.beforeCall?.(signal)) ?? (() => {});
  };

  if (isHookableProvider(provider)) {
    const inner = provider.withHooks({ beforeModelCall: admit, afterModelCall: charge });
    return {
      name: provider.name,
      model: provider.model,
      complete: (req) => inner.complete(req),
      structured: (req) => inner.structured(req),
      runAgentLoop: (req) => inner.runAgentLoop(req),
    };
  }

  // Coarse mode: one admission per public call; usage from the loop result or estimated from text length.
  const estimate = (text: string) => Math.ceil(text.length / 4);
  async function metered<T>(signal: AbortSignal | undefined, run: () => Promise<T>, usageOf: (value: T) => ModelCallUsage): Promise<T> {
    const release = await admit(signal);
    let value: T;
    try {
      value = await run();
    } finally {
      release();
    }
    charge(usageOf(value));
    return value;
  }

  return {
    name: provider.name,
    model: provider.model,
    complete: (req) =>
      metered(req.signal, () => provider.complete(req), (text) => ({ inputTokens: estimate(req.system + req.prompt), outputTokens: estimate(text) })),
    structured: <T>(req: Parameters<LLMProvider["structured"]>[0]) =>
      metered(
        req.signal,
        () => provider.structured<T>(req),
        (value) => ({ inputTokens: estimate(req.system + req.prompt + JSON.stringify(req.schema)), outputTokens: estimate(JSON.stringify(value) ?? "") }),
      ),
    runAgentLoop: (req) => metered<AgentLoopResult>(req.signal, () => provider.runAgentLoop(req), (result) => result.usage),
  };
}

/** Runs `beforeModelCall` for each hook set in order and returns one release that undoes them in reverse. */
export async function acquireAll(hooks: ModelCallHooks[], signal?: AbortSignal): Promise<() => void> {
  const releases: (() => void)[] = [];
  let released = false;
  const releaseAll = () => {
    if (released) return;
    released = true;
    for (let i = releases.length - 1; i >= 0; i--) releases[i]();
  };
  try {
    for (const h of hooks) if (h.beforeModelCall) releases.push(await h.beforeModelCall(signal));
  } catch (err) {
    releaseAll();
    throw err;
  }
  return releaseAll;
}

export function reportUsage(hooks: ModelCallHooks[], usage: ModelCallUsage): void {
  for (const h of hooks) h.afterModelCall?.(usage);
}
