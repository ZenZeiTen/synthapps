/**
 * Kernel configuration (ARCHITECTURE.md "Config").
 *
 * Layers, later ones win: built-in defaults -> <root>/neuralos.config.json -> environment -> overrides.
 * The config file is validated and unknown keys are rejected, so a typo never silently changes nothing.
 *
 * The HTTP API has no authentication (single-user kernel, SAFETY.md 1), so the server may only bind a
 * loopback address unless NEURALOS_ALLOW_REMOTE=1 says otherwise.
 */
import { existsSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { AgentBudget, Effort, McpServerConfig, NeuralOSConfig, ToolPolicy } from "./types";

export const CONFIG_FILE = "neuralos.config.json";
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
};

/** Parses and validates the config file's JSON. Exported for tests. */
export function validateConfigFile(raw: unknown, where = CONFIG_FILE): Partial<NeuralOSConfig> & { budget?: Partial<AgentBudget>; toolPolicy?: Partial<ToolPolicy> } {
  if (!isObj(raw)) throw new ConfigError(`${where} must contain a JSON object`);
  if ("root" in raw) throw new ConfigError(`${where}: "root" cannot be set in the config file (the file lives in the root); use --root or NEURALOS_ROOT`);
  noUnknownKeys(raw, Object.keys(FILE_FIELDS), where);
  const out: Record<string, unknown> = {};
  for (const [key, check] of Object.entries(FILE_FIELDS)) {
    if (raw[key] !== undefined) out[key] = check(raw[key], `${where}: ${key}`);
  }
  return out as Partial<NeuralOSConfig>;
}

function readConfigFile(root: string): Partial<NeuralOSConfig> {
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

function fromEnv(env: NodeJS.ProcessEnv): Partial<NeuralOSConfig> & { toolPolicy?: Partial<ToolPolicy> } {
  const out: Partial<NeuralOSConfig> & { toolPolicy?: Partial<ToolPolicy> } = {};
  if (env.NEURALOS_PORT?.trim()) out.port = int(0, 65535)(Number(env.NEURALOS_PORT), "NEURALOS_PORT") as number;
  if (env.NEURALOS_HOST?.trim()) out.host = env.NEURALOS_HOST.trim();
  if (env.NEURALOS_MODEL?.trim()) out.model = env.NEURALOS_MODEL.trim();
  if (env.NEURALOS_OFFLINE === "1" || env.NEURALOS_OFFLINE === "true") out.useClaude = false;
  if (env.NEURALOS_POLICY?.trim()) {
    const mode = env.NEURALOS_POLICY.trim() as ToolPolicy["mode"];
    if (!POLICY_MODES.includes(mode)) throw new ConfigError(`NEURALOS_POLICY must be one of ${POLICY_MODES.join(", ")}`);
    out.toolPolicy = { mode };
  }
  return out;
}

export type ConfigOverrides = Partial<Omit<NeuralOSConfig, "budget" | "toolPolicy">> & {
  budget?: Partial<AgentBudget>;
  toolPolicy?: Partial<ToolPolicy>;
};

/**
 * Builds the kernel configuration. `env` defaults to process.env (injectable for tests).
 * Throws ConfigError for an invalid config file, invalid environment values or a non-loopback host
 * without NEURALOS_ALLOW_REMOTE=1.
 */
export function loadConfig(overrides: ConfigOverrides = {}, env: NodeJS.ProcessEnv = process.env): NeuralOSConfig {
  const root = resolve(overrides.root ?? (env.NEURALOS_ROOT?.trim() || process.cwd()));
  if (!existsSync(root)) throw new ConfigError(`root does not exist: ${root}`);

  const defaults: NeuralOSConfig = {
    root,
    dataDir: join(root, ".neuralos"),
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
  };

  const layers = [readConfigFile(root), fromEnv(env), overrides as Partial<NeuralOSConfig>];
  let config: NeuralOSConfig = defaults;
  for (const layer of layers) {
    const { budget: b, toolPolicy: p, mcpServers: m, ...rest } = layer as ConfigOverrides;
    const defined = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    config = {
      ...config,
      ...defined,
      budget: { ...config.budget, ...(b ?? {}) },
      toolPolicy: { ...config.toolPolicy, ...(p ?? {}) },
      mcpServers: { ...config.mcpServers, ...(m ?? {}) },
    };
  }
  config.root = root;
  config.dataDir = isAbsolute(config.dataDir) ? config.dataDir : resolve(root, config.dataDir);

  if (!POLICY_MODES.includes(config.toolPolicy.mode)) throw new ConfigError(`toolPolicy.mode must be one of ${POLICY_MODES.join(", ")}`);
  int(0, 65535)(config.port, "port");
  int(1, 64)(config.maxConcurrentAgents, "maxConcurrentAgents");
  int(0, 10)(config.maxDelegationDepth, "maxDelegationDepth");

  const allowRemote = env.NEURALOS_ALLOW_REMOTE === "1" || env.NEURALOS_ALLOW_REMOTE === "true";
  if (!isLoopbackHost(config.host) && !allowRemote) {
    throw new ConfigError(
      `Refusing to bind ${config.host}: the NeuralOS HTTP API has no authentication, so anyone who can reach it could run agents and tools as you. ` +
        `Use a loopback address (127.0.0.1, ::1, localhost), or set NEURALOS_ALLOW_REMOTE=1 if you put your own authentication in front of it.`,
    );
  }
  return config;
}
