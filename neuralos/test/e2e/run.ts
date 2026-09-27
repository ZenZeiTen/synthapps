/**
 * End-to-end test: the Neural Canvas UI against the REAL kernel (no mock).
 *
 *   npm run test:e2e        (node --import tsx test/e2e/run.ts)
 *
 * - builds the UI (vite) when web/dist is missing or older than web/src;
 * - copies demo/breath-of-fire-iv-remake to a fresh temp dir (without .neuralos);
 * - starts createKernel + createHttpServer in-process on a free port: offline, policy "ask", watch and triggers on;
 * - drives headless Chromium (playwright-core, /opt/pw-browsers) through the checks below;
 * - prints PASS/FAIL per check, writes screenshots to test/e2e/screenshots/, exits 1 on any FAIL.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";
import { createKernel, type NeuralKernel } from "../../src/kernel/kernel";
import type { AgentInstance, ApprovalRequest, MemoryRecord, ToolPolicy } from "../../src/kernel/types";
import { createHttpServer, type NeuralHttpServer } from "../../src/server/http";

/** Page-side global used inside page.evaluate callbacks; this project compiles without the DOM lib. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const document: any;

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..", "..");
const WEB_DIST = join(ROOT, "web", "dist");
const WEB_SRC = join(ROOT, "web", "src");
const DEMO = join(ROOT, "demo", "breath-of-fire-iv-remake");
const SHOTS = join(HERE, "screenshots");
const VIEWPORT = { width: 1440, height: 900 };

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
  const stale = existsSync(index) && newestMtime(WEB_SRC) > statSync(index).mtimeMs;
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

/** A point inside the canvas where the pane (not a node or overlay) is on top. */
async function emptyPanePoint(page: Page): Promise<{ x: number; y: number }> {
  const pt = await page.evaluate(() => {
    const area = document.querySelector(".canvas-area")!.getBoundingClientRect();
    for (let y = area.top + 170; y < area.bottom - 200; y += 23) {
      for (let x = area.left + 250; x < area.right - 230; x += 29) {
        let clear = true;
        for (const [dx, dy] of [[0, 0], [-30, 0], [30, 0], [0, -30], [0, 30]]) {
          const o = document.elementFromPoint(x + dx, y + dy);
          if (!o || !o.classList.contains("react-flow__pane")) clear = false;
        }
        if (clear) return { x, y };
      }
    }
    return null;
  });
  assert(pt, "no empty pane point found");
  return pt;
}

/** A node button of the given graph type fully inside the visible canvas and not covered by an overlay. */
async function visibleNode(page: Page, type: string, nameMatch?: string): Promise<{ x: number; y: number; name: string; id: string }> {
  const pt = await page.evaluate(
    ([t, match]) => {
      const area = document.querySelector(".canvas-area")!.getBoundingClientRect();
      const bar = document.querySelector(".intent-bar")?.getBoundingClientRect();
      for (const wrap of document.querySelectorAll(`[data-node-type="${t}"]`)) {
        const btn = wrap.querySelector("button");
        if (!btn) continue;
        const label = btn.getAttribute("aria-label") ?? "";
        if (match && !label.includes(match)) continue;
        const r = btn.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + Math.min(20, r.height / 2);
        if (x < area.left + 20 || x > area.right - 200 || y < area.top + 140 || y > area.bottom - 20) continue;
        if (bar && y > bar.top - 10) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit && btn.contains(hit)) return { x, y, name: label, id: wrap.getAttribute("data-node-id") ?? "" };
      }
      return null;
    },
    [type, nameMatch ?? ""] as const,
  );
  assert(pt, `no visible ${type} node${nameMatch ? ` matching "${nameMatch}"` : ""}`);
  return pt;
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

async function openPanel(page: Page, id: string) {
  await closeRadial(page);
  if (await page.$(".side-panel")) {
    await page.keyboard.press("Escape");
    await page.waitForSelector(".side-panel", { state: "detached", timeout: 3000 });
  }
  await page.click(".canvas-menu-btn");
  await radialLabels(page);
  await page.click(`.radial-opt[data-action-id="${id}"]`);
  await page.waitForSelector(".side-panel", { timeout: 3000 });
}

async function closePanel(page: Page) {
  if (await page.$(".side-panel")) {
    await page.keyboard.press("Escape");
    await page.waitForSelector(".side-panel", { state: "detached", timeout: 3000 });
  }
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

// ---------------------------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------------------------

async function main() {
  mkdirSync(SHOTS, { recursive: true });
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
    await page.waitForSelector(".react-flow__node", { timeout: 20000 });
    await page.waitForTimeout(1200); // fit view + fonts
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => document.querySelector(".conn")?.textContent?.includes("live"), undefined, { timeout: 10000 }).catch(() => undefined);

    // ---- a ---------------------------------------------------------------------------------------------------
    await check("a. canvas shows project, file, agent, mcp, workflow and concept nodes from the real graph", async () => {
      const counts = (await page.evaluate(`(() => {
        const out = {};
        for (const t of ["project", "file", "agent", "mcp", "workflow", "concept", "folder", "workspace"]) out[t] = document.querySelectorAll('[data-node-type="' + t + '"]').length;
        out.edges = document.querySelectorAll(".react-flow__edge").length;
        return out;
      })()`)) as Record<string, number>;
      for (const t of ["project", "file", "agent", "mcp", "workflow", "concept"]) assert(counts[t] > 0, `no ${t} nodes (counts ${JSON.stringify(counts)})`);
      assert(counts.edges > 0, "no edges");
      const graph = await api<{ nodes: { id: string; type: string }[] }>("GET", "/api/graph");
      const project = graph.nodes.find((n) => n.type === "project");
      assert(project && (await page.$(`[data-node-id="${project.id}"]`)), `project node ${project?.id} from /api/graph not on the canvas`);
      assert(await page.$('[data-node-id="file:src/combat/damage.ts"]'), "file:src/combat/damage.ts not on the canvas");
      return Object.entries(counts)
        .map(([key, v]) => `${key}=${v}`)
        .join(" ");
    });
    await page.screenshot({ path: join(SHOTS, "01-canvas.png") });

    // ---- b ---------------------------------------------------------------------------------------------------
    await check("b. clicking the pane opens the root radial with Search, Files, Agents, Projects, Apps, Memory, Settings", async () => {
      const p = await emptyPanePoint(page);
      await page.mouse.click(p.x, p.y);
      const labels = await radialLabels(page);
      const want = ["Search", "Files", "Agents", "Projects", "Apps", "Memory", "Settings"];
      assert(JSON.stringify(labels) === JSON.stringify(want), `labels ${labels.join(", ")}`);
      assert(apiCalls.includes("GET /api/radial/root"), "GET /api/radial/root not requested");
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(SHOTS, "02-radial-root.png") });
      await closeRadial(page);
      return labels.join(", ");
    });

    // ---- c ---------------------------------------------------------------------------------------------------
    let wsId = "";
    const seenBadges = new Set<string>();
    let qaBefore = "";
    await check('c. intent "Review inventory module": workspace node, intent engineering_review, three agents with live state badges', async () => {
      await page.fill("#nos-intent", "Review inventory module");
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/intents", { timeout: 15000 }),
        page.click('button:has-text("Generate workspace")'),
      ]);
      assert(res.status() === 200, `POST /api/intents -> ${res.status()}`);
      wsId = ((await res.json()) as { workspace: { id: string } }).workspace.id;
      await page.waitForSelector(`[data-node-id="workspace:${wsId}"]`, { timeout: 10000 });
      await page.waitForFunction((id) => document.querySelector(".exec .exec-status-row")?.textContent?.includes(id), wsId, { timeout: 10000 });
      const intent = (await page.textContent(".exec .exec-head .id-tag"))?.trim();
      assert(intent === "engineering_review", `execution panel intent "${intent}"`);
      // Sample the agent chips while the swarm runs: the badges must move off "dormant" without a reload.
      const end = Date.now() + 20000;
      let chips: string[] = [];
      while (Date.now() < end) {
        chips = await page.$$eval(".exec .chip-agent", (els) => els.map((e) => (e.textContent ?? "").trim()));
        for (const s of await page.$$eval(".exec .chip-agent .state-badge", (els) => els.map((e) => e.textContent ?? ""))) seenBadges.add(s);
        if (await page.$(".approvals")) break;
        await sleep(150);
      }
      const names = ["Systems Architect", "Code Reviewer", "QA Engineer"];
      assert(chips.length === 3, `expected 3 agent chips, got ${chips.length}: ${chips.join(" | ")}`);
      for (const n of names) assert(chips.some((c) => c.startsWith(n)), `no chip for ${n}: ${chips.join(" | ")}`);
      const live = [...seenBadges].filter((s) => s !== "dormant");
      assert(live.length > 0, `state badges never left dormant: ${[...seenBadges].join(", ")}`);
      qaBefore = (await page.locator(".exec .chip-agent").filter({ hasText: "QA Engineer" }).locator(".state-badge").textContent())?.trim() ?? "";
      await page.screenshot({ path: join(SHOTS, "03-after-intent.png") });
      return `${wsId}; chips ${chips.join(" | ")}; badge states seen: ${[...seenBadges].join(", ")}`;
    });

    // ---- d ---------------------------------------------------------------------------------------------------
    await check("d. proc.run_tests approval (irreversible, principal chain) -> Approve -> completed, ranked findings, Open report", async () => {
      assert(wsId, "no workspace from check c");
      await page.waitForSelector(".approvals .approval", { timeout: 30000 });
      const row = page.locator(".approvals .approval").filter({ hasText: "proc.run_tests" }).first();
      await row.waitFor({ timeout: 10000 });
      const rev = (await row.locator(".rev").textContent())?.trim();
      const chain = (await row.locator(".approval-chain").textContent())?.trim() ?? "";
      assert(rev === "irreversible", `reversibility "${rev}"`);
      const pending = await api<ApprovalRequest[]>("GET", "/api/approvals?status=pending");
      const apr = pending.find((a) => a.tool === "proc.run_tests");
      assert(apr, "no pending proc.run_tests approval on the server");
      assert(chain === apr.principal.chain.join(" > "), `chain shown "${chain}" != server "${apr.principal.chain.join(" > ")}"`);
      assert(chain.startsWith(`user:`) && chain.includes("qa_engineer"), `chain "${chain}" does not run user > ... > qa_engineer`);
      await page.screenshot({ path: join(SHOTS, "04-approvals.png") });
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/approvals/${apr.id}`, { timeout: 5000 }),
        row.locator("button.btn-approve").click(),
      ]);
      assert(res.status() === 200, `approve -> ${res.status()}`);
      const resolved = await api<ApprovalRequest[]>("GET", "/api/approvals");
      assert(resolved.find((a) => a.id === apr.id)?.status === "approved", "server does not show the approval as approved");
      await page.waitForFunction(() => document.querySelector(".exec .exec-status-row .badge")?.textContent === "completed", undefined, { timeout: 90000 });
      await page.waitForSelector(".exec .findings .finding", { timeout: 10000 });
      const sev = await page.$$eval(".exec .finding .sev", (els) => els.map((e) => e.textContent ?? ""));
      const order = ["critical", "high", "medium", "low", "info"];
      for (let i = 1; i < sev.length; i++) assert(order.indexOf(sev[i - 1]) <= order.indexOf(sev[i]), `findings not ranked: ${sev.join(", ")}`);
      const chipStates = await page.$$eval(".exec .chip-agent .state-badge", (els) => els.map((e) => e.textContent ?? ""));
      // Live badges: the QA Engineer chip was waiting on the approval and must now read completed, without a reload.
      const qaAfter = (await page.locator(".exec .chip-agent").filter({ hasText: "QA Engineer" }).locator(".state-badge").textContent())?.trim();
      assert(qaBefore && qaBefore !== "completed" && qaAfter === "completed", `QA Engineer badge ${qaBefore} -> ${qaAfter}`);
      await page.screenshot({ path: join(SHOTS, "05-completed.png") });
      await page.screenshot({ path: join(SHOTS, "05b-execution-panel.png"), clip: { x: VIEWPORT.width - 380, y: 48, width: 380, height: VIEWPORT.height - 48 } });
      const link = page.locator(".exec .report-link");
      const reportPath = ((await link.locator(".mono").textContent()) ?? "").trim();
      assert(reportPath.endsWith("report.md"), `report link path "${reportPath}"`);
      await link.click();
      await page.waitForSelector(".viewer .code-line", { timeout: 8000 });
      const viewerPath = (await page.textContent(".viewer .viewer-path"))?.trim();
      assert(viewerPath === reportPath, `viewer shows "${viewerPath}", expected "${reportPath}"`);
      const lines = await page.$$eval(".viewer .code-line", (els) => els.length);
      await page.screenshot({ path: join(SHOTS, "06-report-viewer.png") });
      await page.keyboard.press("Escape");
      await page.waitForSelector(".viewer", { state: "detached", timeout: 3000 });
      return `${apr.id} chain ${chain}; QA badge ${qaBefore} -> ${qaAfter}; ${sev.length} findings (${sev.join(", ")}); agents ${chipStates.join(", ")}; report ${reportPath} (${lines} lines)`;
    });

    // ---- e ---------------------------------------------------------------------------------------------------
    await check('e. agent node -> agent radial with 7 actions; "Explain" returns a result toast', async () => {
      await closePanel(page);
      await closeRadial(page);
      const a = await visibleNode(page, "agent");
      await page.mouse.click(a.x, a.y);
      const labels = await radialLabels(page);
      const want = ["Review", "Explain", "Compare", "Improve", "Test", "Collaborate", "Replace"];
      assert(JSON.stringify(labels) === JSON.stringify(want), `labels ${labels.join(", ")}`);
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(SHOTS, "07-radial-agent.png") });
      const before = await page.$$eval(".toast", (els) => els.length);
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/radial\/agent%3A[^/]+\/explain$/.test(r.url()), { timeout: 8000 }),
        page.click('.radial-opt[data-action-id="explain"]'),
      ]);
      assert(res.status() === 200, `explain -> ${res.status()}`);
      const agentName = a.name.split(",")[0];
      const toast = await toastsAfter(page, before, new RegExp(agentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      await closeRadial(page);
      return `${agentName}: ${toast}`;
    });

    // ---- f ---------------------------------------------------------------------------------------------------
    await check('f. file node -> file radial; "Summarize" starts a run and shows a result', async () => {
      await closeRadial(page);
      // The canvas is zoomed on the new workspace; bring a file into view the way a user would: the Files panel.
      await openPanel(page, "files");
      await page.locator(".side-panel .tree-btn:not(.tree-dir)").filter({ hasText: /^damage\.ts$/ }).click();
      await page.waitForSelector(".viewer .code-line", { timeout: 8000 });
      await page.keyboard.press("Escape");
      await page.waitForSelector(".viewer", { state: "detached", timeout: 3000 });
      await closePanel(page);
      await page.waitForTimeout(800); // focus animation
      const f = await visibleNode(page, "file", "damage.ts, file");
      assert(f.id === "file:src/combat/damage.ts", `focused file node is ${f.id}`);
      await page.mouse.click(f.x, f.y);
      const labels = await radialLabels(page);
      assert(labels.join(",") === "Open,Summarize,Translate,Refactor,Analyze,Attach Agent", `labels ${labels.join(", ")}`);
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(SHOTS, "08-radial-file.png") });
      const before = await page.$$eval(".toast", (els) => els.length);
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/radial\/file%3A.*\/summarize$/.test(r.url()), { timeout: 8000 }),
        page.click('.radial-opt[data-action-id="summarize"]'),
      ]);
      assert(res.status() === 200, `summarize -> ${res.status()}`);
      const body = (await res.json()) as { ok: boolean; instanceId?: string; message: string };
      assert(body.ok && body.instanceId, `summarize result ${JSON.stringify(body)}`);
      const toast = await toastsAfter(page, before, /started: Summarize/);
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
      await page.screenshot({ path: join(SHOTS, "09-file-summarize.png") });
      return `${f.id}: toast "${toast}"; ${done.agentId} ${done.state}: ${done.output!.summary.split("\n")[0].slice(0, 90)}`;
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
        if (q === "combat code") await page.screenshot({ path: join(SHOTS, "10-search.png") });
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
      await page.screenshot({ path: join(SHOTS, "11-memory-proposed.png") });
      await item.locator(`button[aria-label="Confirm memory ${key}"]`).click();
      await page.locator(".side-panel .mem:not(.proposed)").filter({ hasText: key }).waitFor({ timeout: 8000 });
      const server = await api<MemoryRecord[]>("GET", `/api/memory?includeProposed=true&limit=500`);
      const after = server.find((r) => r.id === rec.id);
      assert(after?.status === "active", `server status after confirm: ${after?.status}`);
      await page.screenshot({ path: join(SHOTS, "12-memory-confirmed.png") });
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
      await page.screenshot({ path: join(SHOTS, "13-settings-readonly.png") });
      await page.click('.side-panel label.radio:has(input[value="ask"])');
      const back = await until("GET /api/policy to report ask", async () => ((await api<ToolPolicy>("GET", "/api/policy")).mode === "ask" ? "ask" : undefined), 5000);
      await page.waitForSelector('.side-panel label.radio.on:has(input[value="ask"])', { timeout: 5000 });
      await closePanel(page);
      return `${ro} -> ${back}`;
    });

    // ---- j ---------------------------------------------------------------------------------------------------
    await check("j. kill switch: Halt with confirmation shows the banner and the server reports halted; Resume clears it", async () => {
      await page.click(".btn-halt");
      await page.waitForSelector('[role="alertdialog"]', { timeout: 3000 });
      await page.fill('[role="alertdialog"] input', "e2e kill switch");
      await page.click('[role="alertdialog"] .btn-danger');
      await page.waitForSelector(".halt-banner", { timeout: 5000 });
      const halted = await api<{ halted: boolean }>("GET", "/api/status");
      assert(halted.halted === true, "server does not report halted");
      const audit = await api<{ entries: { kind: string; detail: Record<string, unknown> }[] }>("GET", "/api/audit?limit=500");
      const entry = [...audit.entries].reverse().find((e) => e.kind === "halt");
      assert(entry && JSON.stringify(entry.detail).includes("e2e kill switch"), `no halt audit entry with the reason: ${JSON.stringify(entry)}`);
      await page.screenshot({ path: join(SHOTS, "14-halted.png") });
      await page.click(".halt-banner .btn-resume");
      await page.waitForSelector(".halt-banner", { state: "detached", timeout: 5000 });
      const resumed = await api<{ halted: boolean }>("GET", "/api/status");
      assert(resumed.halted === false, "server still halted after Resume");
      return `halted (audit: ${JSON.stringify(entry.detail)}) -> resumed`;
    });

    // ---- k ---------------------------------------------------------------------------------------------------
    await check("k. live trigger chain: editing src/combat/damage.ts shows File Updated then the Code Reviewer run within 15 s", async () => {
      await closePanel(page);
      const t0 = Date.now();
      appendFileSync(join(projectRoot, "src", "combat", "damage.ts"), `\n// e2e edit ${new Date().toISOString()}\n`);
      const found = await until(
        "File Updated and a Code Reviewer event in the event log",
        async () => {
          const rows = await page.$$eval(".eventlog .ev", (els) =>
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
      await page.screenshot({ path: join(SHOTS, "15-trigger-chain.png") });
      await page.screenshot({ path: join(SHOTS, "15b-event-log.png"), clip: { x: VIEWPORT.width - 380, y: 48, width: 380, height: VIEWPORT.height - 48 } });
      return `#${found.upd.seq} ${found.upd.type} ${found.upd.detail} -> #${found.review.seq} ${found.review.type} ${found.review.detail} after ${ms} ms`;
    });

    // Let the rest of the chain settle so late errors are caught by check l.
    await page.waitForTimeout(2500);
    await page.click(".react-flow__controls-fitview").catch(() => undefined);
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(SHOTS, "16-overview.png") });

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
  } finally {
    await browser?.close().catch(() => undefined);
    await http?.close().catch(() => undefined);
    await kernel?.stop().catch(() => undefined);
    rmSync(tmp, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in ${relative(ROOT, SHOTS)}/`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
