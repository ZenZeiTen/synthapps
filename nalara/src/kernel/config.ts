/**
 * Kernel configuration (ARCHITECTURE.md "Config").
 *
 * Layers, later ones win: built-in defaults -> <root>/nalara.config.json -> environment -> overrides.
 * The config file is validated and unknown keys are rejected, so a typo never silently changes nothing.
 *
 * The HTTP API has no authentication (single-user kernel, SAFETY.md 1), so the server may only bind a
 * loopback address unless NALARA_ALLOW_REMOTE=1 says otherwise.
 */
import { existsSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { AdversarialConfig, AgentBudget, Effort, FleetBudget, Finding, McpServerConfig, NalaraConfig, ToolPolicy } from "./types";

export const CONFIG_FILE = "nalara.config.json";
export const DEFAULT_PORT = 7437;
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_MODEL = "claude-opus-5";

export const DEFAULT_BUDGET: AgentBudget = {
  maxInputTokens: 400_000,
  maxOutputTokens: 64_000,
  maxToolCalls: 60,
  maxTurns: 24,
  maxWallMs: 15 * 60_000,
  maxRepeatCalls: 3,
};

/** Whole-fleet budget per workspace run: generous enough for a plan with critics, small enough to stop a runaway. */
export const DEFAULT_FLEET_BUDGET: FleetBudget = {
  maxAgents: 40,
  maxInputTokens: 4_000_000,
  maxOutputTokens: 600_000,
  maxToolCalls: 600,
  maxMessages: 400,
};

/**
 * Critics that shadow builder steps. Only agents that produce artifacts are builders; each is attacked by the agents
 * whose job is to break that kind of work. Other steps run once, as before.
 */
export const DEFAULT_ADVERSARIAL: AdversarialConfig = {
  enabled: true,
  maxRounds: 3,
  blockingSeverity: "high",
  critics: {
    fullstack_engineer: ["code_reviewer", "security_agent"],
    systems_architect: ["security_agent"],
    gameplay_architect: ["code_reviewer"],
    translator: ["localization_qa"],
    localization_expert: ["localization_qa"],
    writer: ["seo_reviewer"],
    documentation: ["code_reviewer"],
  },
};

const SEVERITIES: Finding["severity"][] = ["critical", "high", "medium", "low", "info"];

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
const POLICY_MODES: ToolPolicy["mode"][] = ["auto", "ask", "readonly"];

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function defaultUserId(): string {
  try {
    const name = userInfo().username;
    return name && name.trim() ? name.trim() : "local";
  } catch {
    return "local";
  }
}

/** True for addresses that only accept connections from this machine. */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || /^127(\.\d{1,3}){3}$/.test(h) || h === "::ffff:127.0.0.1";
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type Checker = (value: unknown, where: string) => unknown;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function str(value: unknown, where: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ConfigError(`${where} must be a non-empty string`);
  return value;
}

function bool(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") throw new ConfigError(`${where} must be true or false`);
  return value;
}

function int(min: number, max = Number.MAX_SAFE_INTEGER): Checker {
  return (value, where) => {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
      throw new ConfigError(`${where} must be an integer between ${min} and ${max}`);
    }
    return value;
  };
}

function strings(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) throw new ConfigError(`${where} must be an array of strings`);
  return [...value];
}

function stringMap(value: unknown, where: string): Record<string, string> {
  if (!isObj(value) || Object.values(value).some((v) => typeof v !== "string")) throw new ConfigError(`${where} must be an object of strings`);
  return { ...(value as Record<string, string>) };
}

function noUnknownKeys(obj: Record<string, unknown>, allowed: string[], where: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw new ConfigError(`${where}: unknown key "${key}" (allowed: ${allowed.join(", ")})`);
  }
}

function policy(value: unknown, where: string): Partial<ToolPolicy> {
  if (!isObj(value)) throw new ConfigError(`${where} must be an object`);
  noUnknownKeys(value, ["mode", "allow", "deny", "approvalTimeoutMs"], where);
  const out: Partial<ToolPolicy> = {};
  if (value.mode !== undefined) {
    if (!POLICY_MODES.includes(value.mode as ToolPolicy["mode"])) throw new ConfigError(`${where}.mode must be one of ${POLICY_MODES.join(", ")}`);
    out.mode = value.mode as ToolPolicy["mode"];
  }
  if (value.allow !== undefined) out.allow = strings(value.allow, `${where}.allow`);
  if (value.deny !== undefined) out.deny = strings(value.deny, `${where}.deny`);
  if (value.approvalTimeoutMs !== undefined) out.approvalTimeoutMs = int(1000)(value.approvalTimeoutMs, `${where}.approvalTimeoutMs`) as number;
  return out;
}

function mcpServers(value: unknown, where: string): Record<string, McpServerConfig> {
  if (!isObj(value)) throw new ConfigError(`${where} must be an object keyed by server name`);
  const out: Record<string, McpServerConfig> = {};
  for (const [name, raw] of Object.entries(value)) {
    const at = `${where}.${name}`;
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new ConfigError(`${at}: server names may only use letters, digits, "_" and "-"`);
    if (!isObj(raw)) throw new ConfigError(`${at} must be an object`);
    noUnknownKeys(raw, ["command", "args", "env", "cwd", "url", "headers"], at);
    const cfg: McpServerConfig = {};
    if (raw.command !== undefined) cfg.command = str(raw.command, `${at}.command`);
    if (raw.args !== undefined) cfg.args = strings(raw.args, `${at}.args`);
    if (raw.env !== undefined) cfg.env = stringMap(raw.env, `${at}.env`);
    if (raw.cwd !== undefined) cfg.cwd = str(raw.cwd, `${at}.cwd`);
    if (raw.url !== undefined) cfg.url = str(raw.url, `${at}.url`);
    if (raw.headers !== undefined) cfg.headers = stringMap(raw.headers, `${at}.headers`);
    if (!cfg.command === !cfg.url) throw new ConfigError(`${at} needs exactly one of "command" (stdio) or "url" (HTTP)`);
    out[name] = cfg;
  }
  return out;
}

function budget(value: unknown, where: string): Partial<AgentBudget> {
  if (!isObj(value)) throw new ConfigError(`${where} must be an object`);
  const keys = Object.keys(DEFAULT_BUDGET) as (keyof AgentBudget)[];
  noUnknownKeys(value, keys, where);
  const out: Partial<AgentBudget> = {};
  for (const key of keys) if (value[key] !== undefined) out[key] = int(1)(value[key], `${where}.${key}`) as number;
  return out;
}

function fleetBudget(value: unknown, where: string): Partial<FleetBudget> {
  if (!isObj(value)) throw new ConfigError(`${where} must be an object`);
  const keys = Object.keys(DEFAULT_FLEET_BUDGET) as (keyof FleetBudget)[];
  noUnknownKeys(value, keys, where);
  const out: Partial<FleetBudget> = {};
  for (const key of keys) if (value[key] !== undefined) out[key] = int(1)(value[key], `${where}.${key}`) as number;
  return out;
}

function adversarial(value: unknown, where: string): Partial<AdversarialConfig> {
  if (!isObj(value)) throw new ConfigError(`${where} must be an object`);
  noUnknownKeys(value, ["enabled", "maxRounds", "blockingSeverity", "critics"], where);
  const out: Partial<AdversarialConfig> = {};
  if (value.enabled !== undefined) out.enabled = bool(value.enabled, `${where}.enabled`);
  if (value.maxRounds !== undefined) out.maxRounds = int(1, 10)(value.maxRounds, `${where}.maxRounds`) as number;
  if (value.blockingSeverity !== undefined) {
    if (!SEVERITIES.includes(value.blockingSeverity as Finding["severity"])) throw new ConfigError(`${where}.blockingSeverity must be one of ${SEVERITIES.join(", ")}`);
    out.blockingSeverity = value.blockingSeverity as Finding["severity"];
  }
  if (value.critics !== undefined) {
    if (!isObj(value.critics)) throw new ConfigError(`${where}.critics must be an object of agent id -> critic agent ids`);
    const critics: Record<string, string[]> = {};
    for (const [builder, list] of Object.entries(value.critics)) critics[builder] = strings(list, `${where}.critics.${builder}`);
    out.critics = critics;
  }
  return out;
}

/** Keys the config file may set. `root` is not one of them: the file lives in the root. */
const FILE_FIELDS: Record<string, Checker> = {
  dataDir: str,
  port: int(0, 65535),
  host: str,
  model: str,
  effort: (v, w) => {
    if (!EFFORTS.includes(v as Effort)) throw new ConfigError(`${w} must be one of ${EFFORTS.join(", ")}`);
    return v;
  },
  useClaude: bool,
  toolPolicy: policy,
  mcpServers,
  triggers: bool,
  watch: bool,
  maxConcurrentAgents: int(1, 64),
  userId: str,
  maxDelegationDepth: int(0, 10),
  budget,
  testCommand: str,
  procTimeoutMs: int(1000),
  deployCommand: str,
  adversarial,
  fleetBudget,
};

/** Parses and validates the config file's JSON. Exported for tests. */
export function validateConfigFile(raw: unknown, where = CONFIG_FILE): Partial<NalaraConfig> & { budget?: Partial<AgentBudget>; toolPolicy?: Partial<ToolPolicy> } {
  if (!isObj(raw)) throw new ConfigError(`${where} must contain a JSON object`);
  if ("root" in raw) throw new ConfigError(`${where}: "root" cannot be set in the config file (the file lives in the root); use --root or NALARA_ROOT`);
  noUnknownKeys(raw, Object.keys(FILE_FIELDS), where);
  const out: Record<string, unknown> = {};
  for (const [key, check] of Object.entries(FILE_FIELDS)) {
    if (raw[key] !== undefined) out[key] = check(raw[key], `${where}: ${key}`);
  }
  return out as Partial<NalaraConfig>;
}

function readConfigFile(root: string): Partial<NalaraConfig> {
  const file = join(root, CONFIG_FILE);
  if (!existsSync(file)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new ConfigError(`${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return validateConfigFile(raw, file);
}

function fromEnv(env: NodeJS.ProcessEnv): Partial<NalaraConfig> & { toolPolicy?: Partial<ToolPolicy> } {
  const out: Partial<NalaraConfig> & { toolPolicy?: Partial<ToolPolicy> } = {};
  if (env.NALARA_PORT?.trim()) out.port = int(0, 65535)(Number(env.NALARA_PORT), "NALARA_PORT") as number;
  if (env.NALARA_HOST?.trim()) out.host = env.NALARA_HOST.trim();
  if (env.NALARA_MODEL?.trim()) out.model = env.NALARA_MODEL.trim();
  if (env.NALARA_OFFLINE === "1" || env.NALARA_OFFLINE === "true") out.useClaude = false;
  if (env.NALARA_ADVERSARIAL === "0" || env.NALARA_ADVERSARIAL === "false") out.adversarial = { enabled: false } as AdversarialConfig;
  if (env.NALARA_POLICY?.trim()) {
    const mode = env.NALARA_POLICY.trim() as ToolPolicy["mode"];
    if (!POLICY_MODES.includes(mode)) throw new ConfigError(`NALARA_POLICY must be one of ${POLICY_MODES.join(", ")}`);
    out.toolPolicy = { mode };
  }
  return out;
}

export type ConfigOverrides = Partial<Omit<NalaraConfig, "budget" | "toolPolicy" | "adversarial" | "fleetBudget">> & {
  budget?: Partial<AgentBudget>;
  toolPolicy?: Partial<ToolPolicy>;
  adversarial?: Partial<AdversarialConfig>;
  fleetBudget?: Partial<FleetBudget>;
};

/**
 * Builds the kernel configuration. `env` defaults to process.env (injectable for tests).
 * Throws ConfigError for an invalid config file, invalid environment values or a non-loopback host
 * without NALARA_ALLOW_REMOTE=1.
 */
export function loadConfig(overrides: ConfigOverrides = {}, env: NodeJS.ProcessEnv = process.env): NalaraConfig {
  const root = resolve(overrides.root ?? (env.NALARA_ROOT?.trim() || process.cwd()));
  if (!existsSync(root)) throw new ConfigError(`root does not exist: ${root}`);

  const defaults: NalaraConfig = {
    root,
    dataDir: join(root, ".nalara"),
    port: DEFAULT_PORT,
    host: DEFAULT_HOST,
    model: DEFAULT_MODEL,
    effort: "high",
    useClaude: true,
    toolPolicy: { mode: "ask" },
    mcpServers: {},
    triggers: true,
    watch: true,
    maxConcurrentAgents: 4,
    userId: defaultUserId(),
    maxDelegationDepth: 3,
    budget: { ...DEFAULT_BUDGET },
    adversarial: { ...DEFAULT_ADVERSARIAL, critics: { ...DEFAULT_ADVERSARIAL.critics } },
    fleetBudget: { ...DEFAULT_FLEET_BUDGET },
  };

  const layers = [readConfigFile(root), fromEnv(env), overrides as Partial<NalaraConfig>];
  let config: NalaraConfig = defaults;
  for (const layer of layers) {
    const { budget: b, toolPolicy: p, mcpServers: m, adversarial: adv, fleetBudget: fb, ...rest } = layer as ConfigOverrides;
    const defined = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    config = {
      ...config,
      ...defined,
      budget: { ...config.budget, ...(b ?? {}) },
      toolPolicy: { ...config.toolPolicy, ...(p ?? {}) },
      mcpServers: { ...config.mcpServers, ...(m ?? {}) },
      // critics replace the whole map when given: a project that names its own critics means exactly those.
      adversarial: { ...config.adversarial, ...(adv ?? {}), critics: { ...(adv?.critics ?? config.adversarial.critics) } },
      fleetBudget: { ...config.fleetBudget, ...(fb ?? {}) },
    };
  }
  config.root = root;
  config.dataDir = isAbsolute(config.dataDir) ? config.dataDir : resolve(root, config.dataDir);

  if (!POLICY_MODES.includes(config.toolPolicy.mode)) throw new ConfigError(`toolPolicy.mode must be one of ${POLICY_MODES.join(", ")}`);
  int(0, 65535)(config.port, "port");
  int(1, 64)(config.maxConcurrentAgents, "maxConcurrentAgents");
  int(0, 10)(config.maxDelegationDepth, "maxDelegationDepth");

  const allowRemote = env.NALARA_ALLOW_REMOTE === "1" || env.NALARA_ALLOW_REMOTE === "true";
  if (!isLoopbackHost(config.host) && !allowRemote) {
    throw new ConfigError(
      `Refusing to bind ${config.host}: the Nalara HTTP API has no authentication, so anyone who can reach it could run agents and tools as you. ` +
        `Use a loopback address (127.0.0.1, ::1, localhost), or set NALARA_ALLOW_REMOTE=1 if you put your own authentication in front of it.`,
    );
  }
  return config;
}
