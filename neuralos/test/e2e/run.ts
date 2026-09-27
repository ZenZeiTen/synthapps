/**
 * End-to-end test: the Nalara core UI against the REAL kernel (no mock).
 *
 *   npm run test:e2e        (node --import tsx test/e2e/run.ts)
 *   NEURALOS_DOCS_SHOTS=1 npm run test:e2e    also refreshes docs/screenshots/core-*.png (256-colour, see png.ts)
 *
 * - builds the UI (vite) when web/dist is missing or older than web/src;
 * - copies demo/breath-of-fire-iv-remake to a fresh temp dir (without .neuralos);
 * - starts createKernel + createHttpServer in-process on a free port: offline, policy "ask", watch and triggers on;
 * - drives headless Chromium (playwright-core, /opt/pw-browsers) at 1886x901 (the design reference's size);
 * - prints PASS/FAIL per check, writes screenshots to test/e2e/screenshots/, exits 1 on any FAIL.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";
import { createKernel, type NeuralKernel } from "../../src/kernel/kernel";
import type { AgentDefinition, AgentInstance, ApprovalRequest, GraphNode, MemoryRecord, ToolPolicy } from "../../src/kernel/types";
import { createHttpServer, type NeuralHttpServer } from "../../src/server/http";
import { BRAND, INTENT_CHIPS } from "../../web/src/brand";
import { shrinkPng } from "./png";

/** Page-side global used inside page.evaluate callbacks; this project compiles without the DOM lib. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const document: any;

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..", "..");
const WEB_DIST = join(ROOT, "web", "dist");
const WEB_SRC = join(ROOT, "web", "src");
const DEMO = join(ROOT, "demo", "breath-of-fire-iv-remake");
const SHOTS = join(HERE, "screenshots");
const DOCS_SHOTS = join(ROOT, "docs", "screenshots");
const DOCS = process.env.NEURALOS_DOCS_SHOTS === "1";
const VIEWPORT = { width: 1886, height: 901 };

// ---------------------------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------------------------

const results: { name: string; ok: boolean; detail?: string }[] = [];
let currentPage: Page | null = null;

async function check(name: string, fn: () => Promise<string | void>): Promise<boolean> {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? undefined });
    console.log(`PASS  ${name}${detail ? `  (${detail})` : ""}`);
    return true;
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    results.push({ name, ok: false, detail: msg });
    const shot = join(SHOTS, `fail-${results.length}.png`);
    await currentPage?.screenshot({ path: shot }).catch(() => undefined);
    console.log(`FAIL  ${name}  ${msg.split("\n")[0]}  [${relative(ROOT, shot)}]`);
    return false;
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function chromePath(): string {
  const base = "/opt/pw-browsers";
  const dir = readdirSync(base)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort()
    .pop();
  const p = dir ? join(base, dir, "chrome-linux", "chrome") : "";
  if (!p || !existsSync(p)) throw new Error("Chromium not found under /opt/pw-browsers/chromium-*/chrome-linux/chrome");
  return p;
}

function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
  }
  return newest;
}

function ensureUiBuilt(): string {
  const index = join(WEB_DIST, "index.html");
  const stale = existsSync(index) && Math.max(newestMtime(WEB_SRC), statSync(join(ROOT, "web", "index.html")).mtimeMs) > statSync(index).mtimeMs;
  if (existsSync(index) && !stale) return "web/dist up to date";
  console.log(stale ? "web/src is newer than web/dist: rebuilding the UI..." : "web/dist is missing: building the UI...");
  execFileSync("npx", ["vite", "build", "--config", "web/vite.config.ts"], { cwd: ROOT, stdio: "inherit" });
  return "built web/dist";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(what: string, fn: () => Promise<T | undefined | null | false> | T | undefined | null | false, ms: number, every = 250): Promise<T> {
  const end = Date.now() + ms;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch (err) {
      last = err;
    }
    await sleep(every);
  }
  throw new Error(`timed out after ${ms} ms waiting for ${what}${last ? ` (${(last as Error).message})` : ""}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Page helpers (evaluate bodies avoid named inner functions: tsx would wrap them in __name(), absent in the page)
// ---------------------------------------------------------------------------------------------------------------

async function shot(page: Page, name: string, docsName?: string) {
  const path = join(SHOTS, name);
  await page.screenshot({ path });
  if (DOCS && docsName) {
    copyFileSync(path, join(DOCS_SHOTS, docsName));
    shrinkPng(join(DOCS_SHOTS, docsName));
  }
}

async function coreStatus(page: Page): Promise<string> {
  return ((await page.textContent(".core-status")) ?? "").trim();
}

async function closeRadial(page: Page) {
  if (await page.$(".radial-layer")) {
    await page.keyboard.press("Escape");
    await page.waitForSelector(".radial-layer", { state: "detached", timeout: 3000 });
  }
}

async function radialLabels(page: Page): Promise<string[]> {
  await page.waitForSelector(".radial-opt", { timeout: 5000 });
  return page.$$eval(".radial-opt", (els) => els.map((e) => (e.textContent ?? "").trim()));
}

async function closePanel(page: Page) {
  if (await page.$(".side-panel")) {
    await page.keyboard.press("Escape");
    await page.waitForSelector(".side-panel", { state: "detached", timeout: 3000 });
  }
}

/** Root radial from the core, then one of its panels. */
async function openPanel(page: Page, id: string) {
  await closeRadial(page);
  await closePanel(page);
  await page.click(".core-orb");
  await radialLabels(page);
  await page.click(`.radial-opt[data-action-id="${id}"]`);
  await page.waitForSelector(".side-panel", { timeout: 3000 });
}

async function toastsAfter(page: Page, count: number, pattern: RegExp, ms = 8000): Promise<string> {
  const handle = await page.waitForFunction(
    ([n, src, flags]) => {
      const re = new RegExp(src, flags);
      const all = [...document.querySelectorAll(".toast")].map((t) => t.textContent ?? "");
      return all.slice(n).find((t) => re.test(t)) ?? all.find((t) => re.test(t)) ?? false;
    },
    [count, pattern.source, pattern.flags] as const,
    { timeout: ms },
  );
  return (await handle.jsonValue()) as string;
}

async function satellites(page: Page): Promise<{ agent: string; state: string; name: string }[]> {
  return page.$$eval(".satellite:not(.leaving)", (els) =>
    els.map((e) => ({ agent: e.getAttribute("data-agent-id") ?? "", state: e.getAttribute("data-state") ?? "", name: (e.querySelector(".sat-name")?.textContent ?? "").trim() })),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------------------------

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  if (DOCS) mkdirSync(DOCS_SHOTS, { recursive: true });
  for (const f of readdirSync(SHOTS)) if (f.endsWith(".png")) rmSync(join(SHOTS, f));
  const built = ensureUiBuilt();

  const tmp = mkdtempSync(join(tmpdir(), "neuralos-e2e-"));
  const projectRoot = join(tmp, "breath-of-fire-iv-remake");
  cpSync(DEMO, projectRoot, {
    recursive: true,
    filter: (src) => !relative(DEMO, src).split(/[\\/]/).includes(".neuralos") && !relative(DEMO, src).split(/[\\/]/).includes("node_modules"),
  });

  let kernel: NeuralKernel | null = null;
  let http: NeuralHttpServer | null = null;
  let browser: Browser | null = null;
  try {
    kernel = createKernel(
      { root: projectRoot, port: 0, host: "127.0.0.1", useClaude: false, toolPolicy: { mode: "ask" }, watch: true, triggers: true },
      { llm: null, env: {} },
    );
    await kernel.start();
    http = createHttpServer(kernel, { staticDir: WEB_DIST });
    const { url: BASE } = await http.listen(0, "127.0.0.1");
    const k = kernel;
    const st = k.status();
    console.log(`e2e: ${built}; real kernel ${st.version} at ${BASE} on ${projectRoot} (mode ${st.mode}, policy ${st.toolPolicy}, ${st.files} files, ${st.graph.nodes} nodes)\n`);

    const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      const r = await fetch(`${BASE}${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-NeuralOS-Client": "1" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text}`);
      return JSON.parse(text) as T;
    };

    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    browser = await chromium.launch({
      executablePath: chromePath(),
      headless: true,
      // Only Google Fonts leave the machine; the kernel is local.
      proxy: proxy ? { server: proxy, bypass: "127.0.0.1,localhost" } : undefined,
    });
    const context = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true, deviceScaleFactor: 1 });
    const page = await context.newPage();
    currentPage = page;

    // ---- console + network watchers (check l) --------------------------------------------------------------
    const consoleErrors: string[] = [];
    const ignoredConsole: string[] = [];
    const isProxyNotice = (t: string) => /agent[- ]?proxy|__agentproxy|blocked by (the )?(sandbox|proxy)/i.test(t) || /(googleapis|gstatic|google)\.com/i.test(t);
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      (isProxyNotice(m.text()) ? ignoredConsole : consoleErrors).push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    // No check triggers a 4xx on purpose, so every /api response >= 400 is a failure.
    const apiFailures: string[] = [];
    const aborted: string[] = [];
    page.on("response", (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/") && r.status() >= 400) apiFailures.push(`${r.request().method()} ${u.pathname} -> ${r.status()}`);
    });
    page.on("requestfailed", (r) => {
      const u = new URL(r.url());
      if (!u.pathname.startsWith("/api/")) return;
      const why = r.failure()?.errorText ?? "failed";
      // net::ERR_ABORTED is the client cancelling (AbortController on a superseded load, SSE on navigation).
      (why.includes("ERR_ABORTED") ? aborted : apiFailures).push(`${r.method()} ${u.pathname}: ${why}`);
    });
    const apiCalls: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/")) apiCalls.push(`${r.method()} ${u.pathname}`);
    });
    let fontsOk = true;
    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, async (route) => {
      try {
        const res = await route.fetch({ timeout: 8000 });
        await route.fulfill({ response: res });
      } catch {
        fontsOk = false;
        await route.fulfill({ status: 200, contentType: route.request().url().includes("googleapis") ? "text/css" : "font/woff2", body: "" });
      }
    });

    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".core-orb", { timeout: 20000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => /AGENTS? RESTING/.test(document.querySelector(".hud-left")?.textContent ?? ""), undefined, { timeout: 10000 });
    await page.waitForTimeout(1500); // particles settle into their orbits, fonts

    // ---- a ---------------------------------------------------------------------------------------------------
    await check("a. idle core: live HUD strings from the kernel, clock, intent bar and chips; the Field view shows the real graph", async () => {
      const catalog = await api<AgentDefinition[]>("GET", "/api/agents");
      const running = (await api<AgentInstance[]>("GET", "/api/agents/instances")).filter((i) => ["summoned", "active", "collaborating"].includes(i.state));
      const system = catalog.filter((a) => a.group === "system").map((a) => a.id);
      const resting = system.filter((id) => !running.some((i) => i.agentId === id)).length;
      const left = ((await page.textContent(".hud-left")) ?? "").trim();
      const wantLeft = `${BRAND.toUpperCase()} · CORE IDLE · ${resting} ${resting === 1 ? "AGENT" : "AGENTS"} RESTING`;
      assert(left === wantLeft, `top left "${left}", expected "${wantLeft}"`);
      const field = ((await page.textContent(".hud-field")) ?? "").trim();
      assert(field === "FIELD STABLE · 0 AGENTS", `field "${field}"`);
      const clock = ((await page.textContent(".hud-clock")) ?? "").trim();
      assert(/^\d{1,2}:\d{2}(\s?[AP]M)?$/i.test(clock), `clock "${clock}"`);
      const status = await coreStatus(page);
      assert(status === "BREATHING · AWAITING INTENT", `core status "${status}"`);
      const title = ((await page.textContent(".core-title")) ?? "").trim();
      assert(title === "Neural Core", `title "${title}"`);
      const placeholder = await page.getAttribute("#nos-intent", "placeholder");
      assert(placeholder === "Tell the OS what you intend...", `placeholder "${placeholder}"`);
      const label = ((await page.textContent('label[for="nos-intent"]')) ?? "").trim();
      assert(label.length > 0, "the intent input has no label");
      const chips = await page.$$eval(".dock-chip", (els) => els.map((e) => (e.textContent ?? "").trim()));
      assert(JSON.stringify(chips) === JSON.stringify([...INTENT_CHIPS]), `chips ${chips.join(" | ")}`);
      assert((await page.title()) === BRAND, `page title "${await page.title()}"`);
      // Geometry: orb centred, about a quarter of the height; the bar about 44% of the width.
      const geo = (await page.evaluate(`(() => {
        const o = document.querySelector(".core-orb").getBoundingClientRect();
        const b = document.querySelector(".dock-bar").getBoundingClientRect();
        return { cx: o.left + o.width / 2, cy: o.top + o.height / 2, d: o.width, bw: b.width };
      })()`)) as { cx: number; cy: number; d: number; bw: number };
      assert(Math.abs(geo.cx - VIEWPORT.width / 2) < 4 && Math.abs(geo.cy / VIEWPORT.height - 0.53) < 0.02, `orb centre ${geo.cx},${geo.cy}`);
      assert(Math.abs(geo.d / VIEWPORT.height - 0.262) < 0.02 && Math.abs(geo.bw / VIEWPORT.width - 0.439) < 0.02, `orb ${geo.d}px, bar ${geo.bw}px`);
      await shot(page, "01-core-idle.png", "core-idle.png");

      // The knowledge graph lives in the Field view.
      await page.click(".btn-field");
      await page.waitForSelector(".field .react-flow__node", { timeout: 15000 });
      await page.waitForTimeout(900);
      const counts = (await page.evaluate(`(() => {
        const out = {};
        for (const t of ["project", "file", "agent", "mcp", "workflow", "concept", "folder", "workspace"]) out[t] = document.querySelectorAll('[data-node-type="' + t + '"]').length;
        out.edges = document.querySelectorAll(".react-flow__edge").length;
        return out;
      })()`)) as Record<string, number>;
      for (const t of ["project", "file", "agent", "mcp", "workflow", "concept"]) assert(counts[t] > 0, `no ${t} nodes (counts ${JSON.stringify(counts)})`);
      assert(counts.edges > 0, "no edges");
      const graph = await api<{ nodes: GraphNode[] }>("GET", "/api/graph");
      const project = graph.nodes.find((n) => n.type === "project");
      assert(project && (await page.$(`[data-node-id="${project.id}"]`)), `project node ${project?.id} from /api/graph not in the field`);
      assert(await page.$('[data-node-id="file:src/combat/damage.ts"]'), "file:src/combat/damage.ts not in the field");
      await shot(page, "02-field.png", "core-field.png");
      await page.click(".btn-field");
      await page.waitForSelector(".field-layer", { state: "detached", timeout: 3000 });
      return `${left} | ${clock} | ${field} | orb ${Math.round(geo.d)}px at ${Math.round(geo.cx)},${Math.round(geo.cy)}, bar ${Math.round(geo.bw)}px | field: ${Object.entries(counts)
        .map(([key, v]) => `${key}=${v}`)
        .join(" ")}`;
    });

    // ---- b ---------------------------------------------------------------------------------------------------
    await check("b. clicking the core opens the root radial with Search, Files, Agents, Projects, Apps, Memory, Settings", async () => {
      await page.click(".core-orb");
      const labels = await radialLabels(page);
      const want = ["Search", "Files", "Agents", "Projects", "Apps", "Memory", "Settings"];
      assert(JSON.stringify(labels) === JSON.stringify(want), `labels ${labels.join(", ")}`);
      assert(apiCalls.includes("GET /api/radial/root"), "GET /api/radial/root not requested");
      const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
      await page.keyboard.press("ArrowRight");
      const next = await page.evaluate(() => document.activeElement?.textContent?.trim());
      assert(focused === "Search" && next === "Files", `keyboard focus ${focused} -> ${next}`);
      await page.waitForTimeout(400);
      await shot(page, "03-radial-root.png", "core-radial.png");
      await closeRadial(page);
      return `${labels.join(", ")}; arrows move focus`;
    });

    if (DOCS) {
      // The review swarm below goes straight to an approval; photograph a working swarm with another intent first.
      await page.fill("#nos-intent", "Localize this website to Indonesian");
      await page.press("#nos-intent", "Enter");
      await page.waitForFunction(
        () => document.querySelector(".core-status")?.textContent?.startsWith("ACTIVE") && document.querySelectorAll(".satellite:not(.leaving)").length >= 2,
        undefined,
        { timeout: 15000, polling: 50 },
      );
      await page.waitForTimeout(300);
      await shot(page, "04b-core-active.png", "core-active.png");
      await page.waitForSelector(".results-sheet", { timeout: 30000 });
      await page.click('.results-sheet button[aria-label="Close results"]');
      await page.waitForTimeout(1800);
    }

    // ---- c ---------------------------------------------------------------------------------------------------
    let wsId = "";
    const seenStates = new Set<string>();
    const seenStatus = new Set<string>();
    let qaBefore = "";
    await check('c. intent "Review inventory module": live classification hint, Enter submits, the core thinks, three agents orbit with live states', async () => {
      await page.fill("#nos-intent", "Review inventory module");
      const hint = await until("the classification hint", async () => {
        const t = ((await page.textContent(".dock-hint.on")) ?? "").trim();
        return t.includes("ENGINEERING REVIEW") ? t : undefined;
      }, 6000, 100);
      assert(apiCalls.includes("POST /api/intents/classify"), "POST /api/intents/classify not requested");
      if (DOCS) {
        // Hold the submission briefly so the thinking core can be photographed; the kernel is not slowed.
        await page.route("**/api/intents", async (route) => {
          await sleep(1400);
          await route.continue();
        });
      }
      // Record every core status and satellite state the page shows, however briefly.
      await page.evaluate(`(() => {
        window.__statuses = [];
        window.__sats = [];
        const note = () => {
          const st = document.querySelector(".core-status")?.textContent ?? "";
          if (window.__statuses[window.__statuses.length - 1] !== st) window.__statuses.push(st);
          for (const el of document.querySelectorAll(".satellite:not(.leaving)")) {
            const v = el.getAttribute("data-agent-id") + ":" + el.getAttribute("data-state");
            if (!window.__sats.includes(v)) window.__sats.push(v);
          }
        };
        window.__observer = new MutationObserver(note);
        window.__observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["data-state"] });
        note();
      })()`);
      const resP = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/intents", { timeout: 15000 });
      await page.press("#nos-intent", "Enter");
      if (DOCS) {
        await page.waitForFunction(() => document.querySelector(".core-status")?.textContent?.startsWith("THINKING"), undefined, { timeout: 3000 });
        await page.waitForTimeout(500);
        await shot(page, "04-core-thinking.png", "core-thinking.png");
      }
      const res = await resP;
      if (DOCS) await page.unroute("**/api/intents");
      assert(res.status() === 200, `POST /api/intents -> ${res.status()}`);
      wsId = ((await res.json()) as { workspace: { id: string } }).workspace.id;
      // Wait for the swarm to take its places: three satellites, the QA Engineer live (it waits on the approval).
      const sats = await until(
        "three agents in orbit with the QA Engineer live",
        async () => {
          const list = await satellites(page);
          const qa = list.find((x) => x.agent === "qa_engineer");
          return list.length >= 3 && qa && ["active", "collaborating"].includes(qa.state) ? list : undefined;
        },
        20000,
        60,
      );
      const recorded = (await page.evaluate(`(() => { window.__observer.disconnect(); return { statuses: window.__statuses, sats: window.__sats }; })()`)) as {
        statuses: string[];
        sats: string[];
      };
      for (const st of recorded.statuses) seenStatus.add(st.split(" · ")[0]);
      for (const v of recorded.sats) seenStates.add(v);
      const names = ["SYSTEMS ARCHITECT", "CODE REVIEWER", "QA ENGINEER"];
      const shown = sats.map((s) => s.name.toUpperCase());
      for (const n of names) assert(shown.includes(n), `no satellite for ${n}: ${shown.join(" | ")}`);
      // Satellites pass through their states in order: the architect is seen summoned, working and completed.
      for (const st of ["summoned", "completed"]) assert(seenStates.has(`systems_architect:${st}`), `Systems Architect never shown ${st}: ${[...seenStates].join(", ")}`);
      assert(["active", "collaborating"].some((st) => seenStates.has(`systems_architect:${st}`)), `Systems Architect never shown working: ${[...seenStates].join(", ")}`);
      assert(seenStatus.has("THINKING"), `the core never showed THINKING: ${[...seenStatus].join(" > ")}`);
      assert(seenStatus.has("HOLDING"), `the core never showed HOLDING for the approval: ${[...seenStatus].join(" > ")}`);
      qaBefore = sats.find((s) => s.agent === "qa_engineer")?.state ?? "";
      return `${wsId}; hint "${hint}"; core ${[...seenStatus].join(" > ")}; satellites seen ${[...seenStates].join(", ")}`;
    });

    // ---- d ---------------------------------------------------------------------------------------------------
    await check("d. approval card: proc.run_tests, irreversible, exact command, principal chain -> Approve -> results sheet, ranked findings, Open report", async () => {
      assert(wsId, "no workspace from check c");
      const row = page.locator(".approval-card .approval").filter({ hasText: "proc.run_tests" }).first();
      await row.waitFor({ timeout: 30000 });
      const rev = (await row.locator(".rev").textContent())?.trim();
      const chain = (await row.locator(".approval-chain").textContent())?.trim() ?? "";
      assert(rev === "irreversible", `reversibility "${rev}"`);
      const pending = await api<ApprovalRequest[]>("GET", "/api/approvals?status=pending");
      const apr = pending.find((a) => a.tool === "proc.run_tests");
      assert(apr, "no pending proc.run_tests approval on the server");
      assert(chain === apr.principal.chain.join(" > "), `chain shown "${chain}" != server "${apr.principal.chain.join(" > ")}"`);
      assert(chain.startsWith(`user:`) && chain.includes("qa_engineer"), `chain "${chain}" does not run user > ... > qa_engineer`);
      // The approval must say what will actually run, and it must be visible.
      const detail = row.locator(".approval-detail");
      const detailText = ((await detail.textContent()) ?? "").trim();
      assert(/^Runs: npm test/.test(detailText) && (await detail.isVisible()), `approval detail does not show the command: "${detailText}"`);
      const status = await coreStatus(page);
      assert(status.startsWith("HOLDING"), `core status during approval "${status}"`);
      await page.waitForTimeout(600);
      await shot(page, "06-approval.png", "core-approval.png");
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/approvals/${apr.id}`, { timeout: 5000 }),
        row.locator("button.btn-approve").click(),
      ]);
      assert(res.status() === 200, `approve -> ${res.status()}`);
      const resolved = await api<ApprovalRequest[]>("GET", "/api/approvals");
      assert(resolved.find((a) => a.id === apr.id)?.status === "approved", "server does not show the approval as approved");
      await page.waitForFunction(() => document.querySelector(".results-sheet .sheet-status")?.textContent === "completed", undefined, { timeout: 90000 });
      await page.waitForSelector(".results-sheet .findings .finding", { timeout: 10000 });
      const sev = await page.$$eval(".results-sheet .finding .sev", (els) => els.map((e) => e.textContent ?? ""));
      const order = ["critical", "high", "medium", "low", "info"];
      for (let i = 1; i < sev.length; i++) assert(order.indexOf(sev[i - 1]) <= order.indexOf(sev[i]), `findings not ranked: ${sev.join(", ")}`);
      const loc = await page.$$eval(".results-sheet .finding-loc", (els) => els.map((e) => (e.textContent ?? "").trim()));
      assert(loc.some((l) => /:\d+$/.test(l)), `no file:line on any finding: ${loc.join(", ")}`);
      // Live satellites: the QA Engineer was waiting on the approval and must now read completed, without a reload.
      const qaAfter = await until(
        "the QA Engineer satellite to complete",
        async () => {
          const s = await page.getAttribute('.satellite[data-agent-id="qa_engineer"]:not(.leaving)', "data-state");
          return s === "completed" ? s : undefined;
        },
        8000,
        100,
      );
      assert(qaBefore && qaBefore !== "completed", `QA Engineer before approval was "${qaBefore}"`);
      const settled = await until(
        "the core to settle",
        async () => {
          const st = await coreStatus(page);
          return st === "SETTLED · WORKSPACE COMPLETE" ? st : undefined;
        },
        8000,
        100,
      );
      const agentStates = await page.$$eval(".results-sheet .sheet-agent .state-badge", (els) => els.map((e) => e.textContent ?? ""));
      await page.waitForTimeout(700);
      await shot(page, "07-results.png", "core-results.png");
      const link = page.locator(".results-sheet .report-link");
      const reportPath = ((await link.locator(".mono").textContent()) ?? "").trim();
      assert(reportPath.endsWith("report.md"), `report link path "${reportPath}"`);
      await link.click();
      await page.waitForSelector(".viewer .code-line", { timeout: 8000 });
      const viewerPath = (await page.textContent(".viewer .viewer-path"))?.trim();
      assert(viewerPath === reportPath, `viewer shows "${viewerPath}", expected "${reportPath}"`);
      const lines = await page.$$eval(".viewer .code-line", (els) => els.length);
      await shot(page, "08-report-viewer.png");
      await page.keyboard.press("Escape");
      await page.waitForSelector(".viewer", { state: "detached", timeout: 3000 });
      return `${apr.id} chain ${chain}; QA ${qaBefore} -> ${qaAfter}; core ${settled}; ${sev.length} findings (${sev.join(", ")}); agents ${agentStates.join(", ")}; report ${reportPath} (${lines} lines)`;
    });

    // ---- e ---------------------------------------------------------------------------------------------------
    await check('e. clicking an agent satellite opens its radial with 7 actions; "Explain" returns a result toast', async () => {
      await closePanel(page);
      await closeRadial(page);
      const sat = page.locator('.satellite[data-agent-id="code_reviewer"]:not(.leaving)');
      await sat.waitFor({ timeout: 5000 });
      await sat.click();
      const labels = await radialLabels(page);
      const want = ["Review", "Explain", "Compare", "Improve", "Test", "Collaborate", "Replace"];
      assert(JSON.stringify(labels) === JSON.stringify(want), `labels ${labels.join(", ")}`);
      assert(apiCalls.includes("GET /api/radial/agent:code_reviewer") || apiCalls.includes("GET /api/radial/agent%3Acode_reviewer"), "GET /api/radial/agent:code_reviewer not requested");
      const title = ((await page.textContent(".radial-title")) ?? "").trim();
      assert(title === "Code Reviewer", `radial title "${title}"`);
      await page.waitForTimeout(400);
      await shot(page, "09-radial-agent.png", "core-radial-agent.png");
      const before = await page.$$eval(".toast", (els) => els.length);
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/radial\/agent%3Acode_reviewer\/explain$/.test(r.url()), { timeout: 8000 }),
        page.click('.radial-opt[data-action-id="explain"]'),
      ]);
      assert(res.status() === 200, `explain -> ${res.status()}`);
      const toast = await toastsAfter(page, before, /Code Reviewer/);
      await closeRadial(page);
      return `Code Reviewer: ${toast}`;
    });

    // ---- f ---------------------------------------------------------------------------------------------------
    await check('f. Files panel: open damage.ts, then its actions; "Summarize" starts a run that orbits the core and finishes', async () => {
      await closeRadial(page);
      await openPanel(page, "files");
      await page.locator(".side-panel .tree-btn:not(.tree-dir)").filter({ hasText: /^damage\.ts$/ }).click();
      await page.waitForSelector(".viewer .code-line", { timeout: 8000 });
      const viewerPath = (await page.textContent(".viewer .viewer-path"))?.trim();
      assert(viewerPath === "src/combat/damage.ts", `viewer path "${viewerPath}"`);
      await page.keyboard.press("Escape");
      await page.waitForSelector(".viewer", { state: "detached", timeout: 3000 });
      await page.click('.side-panel button[aria-label="Actions for damage.ts"]');
      const labels = await radialLabels(page);
      assert(labels.join(",") === "Open,Summarize,Translate,Refactor,Analyze,Attach Agent", `labels ${labels.join(", ")}`);
      assert(!(await page.$(".side-panel")), "the Files panel stayed open under the file radial");
      await page.waitForTimeout(900); // the ring follows the core back to the centre
      await shot(page, "10-radial-file.png");
      const before = await page.$$eval(".toast", (els) => els.length);
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/radial\/file%3A.*\/summarize$/.test(r.url()), { timeout: 8000 }),
        page.click('.radial-opt[data-action-id="summarize"]'),
      ]);
      assert(res.status() === 200, `summarize -> ${res.status()}`);
      const body = (await res.json()) as { ok: boolean; instanceId?: string; message: string };
      assert(body.ok && body.instanceId, `summarize result ${JSON.stringify(body)}`);
      const toast = await toastsAfter(page, before, /started: Summarize/);
      const inOrbit = await until(
        "the summarizing agent in orbit",
        async () => ((await page.$(`.satellite[data-instance-id="${body.instanceId}"]`)) ? "yes" : undefined),
        5000,
        50,
      ).catch(() => "no");
      const done = await until(
        "the summarize run to finish",
        async () => {
          const list = await api<AgentInstance[]>("GET", "/api/agents/instances");
          const inst = list.find((i) => i.instanceId === body.instanceId);
          return inst && ["completed", "failed", "terminated"].includes(inst.state) ? inst : undefined;
        },
        30000,
      );
      assert(done.state === "completed" && done.output?.summary, `run ended ${done.state}: ${done.error ?? ""}`);
      assert(inOrbit === "yes", "the summarizing agent never appeared as a satellite");
      return `toast "${toast}"; ${done.agentId} orbited the core and ${done.state}: ${done.output!.summary.split("\n")[0].slice(0, 80)}`;
    });

    // ---- g ---------------------------------------------------------------------------------------------------
    await check("g. search panel: the four spec queries return the expected first hit", async () => {
      await closeRadial(page);
      await openPanel(page, "search");
      const want: [string, (p: string) => boolean, string][] = [
        ["combat code", (p) => p.startsWith("src/combat/"), "src/combat/..."],
        ["latest damage calculations", (p) => p === "src/combat/damage.ts", "src/combat/damage.ts"],
        ["files related to inventory", (p) => p === "src/inventory/inventory.ts", "src/inventory/inventory.ts"],
        ["design docs referencing merchants", (p) => p === "docs/design/merchants.md", "docs/design/merchants.md"],
      ];
      const out: string[] = [];
      const bad: string[] = [];
      for (const [q, ok, label] of want) {
        await page.click(`.side-panel .chip-btn:has-text("${q}")`);
        await page.waitForFunction((qq) => [...document.querySelectorAll(".side-panel p")].some((p) => p.textContent?.includes(`for “${qq}”`)), q, { timeout: 8000 });
        const first = ((await page.textContent(".hit .hit-path")) ?? "").trim().replace(/:\d+$/, "");
        out.push(`"${q}" -> ${first}`);
        if (!ok(first)) bad.push(`"${q}": first hit ${first}, expected ${label}`);
        if (q === "combat code") await shot(page, "11-search.png", "core-search.png");
      }
      assert(!bad.length, bad.join("; "));
      await closePanel(page);
      return out.join("; ");
    });

    // ---- h ---------------------------------------------------------------------------------------------------
    await check("h. memory panel: an agent-proposed record shows as proposed; Confirm makes it active", async () => {
      const key = `e2e-proposal-${Date.now().toString(36)}`;
      const result = await k.tools.call(
        "memory.remember",
        { category: "coding_standard", key, content: "Damage formulas live in src/combat/damage.ts and stay pure functions.", tags: ["e2e"] },
        { principal: { userId: k.config.userId, agentId: "code_reviewer", chain: [`user:${k.config.userId}`, "agent:code_reviewer#e2e"], depth: 1 } },
      );
      assert(result.ok, `memory.remember failed: ${result.content}`);
      const rec = (result.data as { record: MemoryRecord }).record;
      assert(rec.status === "proposed", `record status ${rec.status}`);
      await openPanel(page, "memory");
      const item = page.locator(".side-panel .mem.proposed").filter({ hasText: key });
      await item.waitFor({ timeout: 8000 });
      const badge = (await item.locator(".badge").textContent())?.trim();
      assert(badge === "proposed", `badge "${badge}"`);
      await shot(page, "12-memory-proposed.png");
      await item.locator(`button[aria-label="Confirm memory ${key}"]`).click();
      await page.locator(".side-panel .mem:not(.proposed)").filter({ hasText: key }).waitFor({ timeout: 8000 });
      const server = await api<MemoryRecord[]>("GET", `/api/memory?includeProposed=true&limit=500`);
      const after = server.find((r) => r.id === rec.id);
      assert(after?.status === "active", `server status after confirm: ${after?.status}`);
      await closePanel(page);
      return `${rec.id} (${rec.source}) proposed -> ${after.status}`;
    });

    // ---- i ---------------------------------------------------------------------------------------------------
    await check("i. settings: switching the policy to readonly via the UI is reflected by GET /api/policy; switch back", async () => {
      await openPanel(page, "settings");
      await page.waitForSelector('.side-panel input[name="policy-mode"][value="readonly"]', { timeout: 5000 });
      await page.click('.side-panel label.radio:has(input[value="readonly"])');
      const ro = await until("GET /api/policy to report readonly", async () => ((await api<ToolPolicy>("GET", "/api/policy")).mode === "readonly" ? "readonly" : undefined), 5000);
      await page.waitForSelector('.side-panel label.radio.on:has(input[value="readonly"])', { timeout: 5000 });
      await shot(page, "13-settings-readonly.png");
      await page.click('.side-panel label.radio:has(input[value="ask"])');
      const back = await until("GET /api/policy to report ask", async () => ((await api<ToolPolicy>("GET", "/api/policy")).mode === "ask" ? "ask" : undefined), 5000);
      await page.waitForSelector('.side-panel label.radio.on:has(input[value="ask"])', { timeout: 5000 });
      await closePanel(page);
      return `${ro} -> ${back}`;
    });

    // ---- j ---------------------------------------------------------------------------------------------------
    await check("j. kill switch: Halt with confirmation turns the core into an ember and the server reports halted; Resume clears it", async () => {
      await page.click(".hud .btn-halt");
      await page.waitForSelector('[role="alertdialog"]', { timeout: 3000 });
      await page.fill('[role="alertdialog"] input', "e2e kill switch");
      await page.click('[role="alertdialog"] .btn-danger');
      await page.waitForFunction(() => document.querySelector(".core-status")?.textContent === "HALTED · ALL AGENTS STOPPED", undefined, { timeout: 5000 });
      await page.waitForSelector(".core-action .btn-resume", { timeout: 3000 });
      const field = ((await page.textContent(".hud-field")) ?? "").trim();
      assert(field.startsWith("FIELD HALTED"), `field "${field}"`);
      assert(await page.isDisabled("#nos-intent"), "the intent bar accepts input while halted");
      const halted = await api<{ halted: boolean }>("GET", "/api/status");
      assert(halted.halted === true, "server does not report halted");
      const audit = await api<{ entries: { kind: string; detail: Record<string, unknown> }[] }>("GET", "/api/audit?limit=500");
      const entry = [...audit.entries].reverse().find((e) => e.kind === "halt");
      assert(entry && JSON.stringify(entry.detail).includes("e2e kill switch"), `no halt audit entry with the reason: ${JSON.stringify(entry)}`);
      await page.waitForTimeout(900);
      await shot(page, "14-halted.png", "core-halted.png");
      await page.click(".core-action .btn-resume");
      await page.waitForFunction(() => !document.querySelector(".core-status")?.textContent?.startsWith("HALTED"), undefined, { timeout: 5000 });
      const resumed = await api<{ halted: boolean }>("GET", "/api/status");
      assert(resumed.halted === false, "server still halted after Resume");
      return `halted (audit: ${JSON.stringify(entry.detail)}; ${field}) -> resumed, core "${await coreStatus(page)}"`;
    });

    // ---- k ---------------------------------------------------------------------------------------------------
    await check("k. live trigger chain: editing src/combat/damage.ts shows File Updated then the Code Reviewer run (ticker -> event log) within 15 s", async () => {
      await closePanel(page);
      const t0 = Date.now();
      appendFileSync(join(projectRoot, "src", "combat", "damage.ts"), `\n// e2e edit ${new Date().toISOString()}\n`);
      const ticker = page.locator(".ticker");
      await ticker.waitFor({ timeout: 8000 });
      const tickerText = ((await ticker.textContent()) ?? "").trim();
      await ticker.click();
      await page.waitForSelector(".side-panel .eventlog", { timeout: 3000 });
      const found = await until(
        "File Updated and a Code Reviewer event in the event log",
        async () => {
          const rows = await page.$$eval(".side-panel .eventlog .ev", (els) =>
            els.map((e) => ({
              seq: Number((e.querySelector(".ev-seq")?.textContent ?? "#0").slice(1)),
              type: e.querySelector(".ev-type")?.textContent ?? "",
              detail: e.querySelector(".ev-detail")?.textContent ?? "",
            })),
          );
          const upd = rows.find((r) => r.type === "File Updated" && r.detail.includes("src/combat/damage.ts"));
          if (!upd) return undefined;
          // Rows are newest first: take the earliest Code Reviewer event after the update (the trigger or the summon).
          const review = rows
            .filter((r) => r.seq > upd.seq && /code[ _]reviewer/i.test(r.detail) && /^Agent (Triggered|Summoned)$/.test(r.type))
            .sort((a, b) => a.seq - b.seq)[0];
          return review ? { upd, review } : undefined;
        },
        15000,
      );
      const ms = Date.now() - t0;
      await shot(page, "15-trigger-chain.png", "core-events.png");
      await closePanel(page);
      return `ticker "${tickerText}"; #${found.upd.seq} ${found.upd.type} ${found.upd.detail} -> #${found.review.seq} ${found.review.type} ${found.review.detail} after ${ms} ms`;
    });

    // Let the rest of the chain settle so late errors are caught by check l.
    await page.waitForTimeout(2500);
    await shot(page, "16-after.png");

    // ---- l ---------------------------------------------------------------------------------------------------
    await check("l. no console errors and no failed /api requests", async () => {
      const problems = [...consoleErrors.map((c) => `console: ${c}`), ...apiFailures.map((f) => `api: ${f}`)];
      assert(!problems.length, problems.join(" | "));
      return [
        `${apiCalls.length} /api requests`,
        "no /api status >= 400",
        aborted.length ? `${aborted.length} client-aborted (${[...new Set(aborted)].join(", ")})` : "none aborted",
        ignoredConsole.length ? `${ignoredConsole.length} proxy notice(s) ignored` : "no proxy notices",
        fontsOk ? "fonts from Google Fonts" : "Google Fonts unreachable: empty stylesheet served",
      ].join("; ");
    });

    // After the checks (the simulated outage logs failed requests on purpose): the offline core, for the docs.
    if (DOCS) {
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.route("**/api/**", (route) => route.abort("connectionrefused"));
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelector(".core-status")?.textContent?.startsWith("CORE OFFLINE"), undefined, { timeout: 10000 });
      await page.waitForTimeout(1200);
      await shot(page, "17-offline.png", "core-offline.png");
      await page.unroute("**/api/**");
    }
  } finally {
    await browser?.close().catch(() => undefined);
    await http?.close().catch(() => undefined);
    await kernel?.stop().catch(() => undefined);
    rmSync(tmp, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in ${relative(ROOT, SHOTS)}/${DOCS ? ` and ${relative(ROOT, DOCS_SHOTS)}/` : ""}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
