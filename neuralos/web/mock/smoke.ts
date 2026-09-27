/**
 * Smoke test for the Nalara core UI against the mock kernel.
 *
 *   npx vite build --config web/vite.config.ts && node --import tsx web/mock/smoke.ts
 *
 * Starts web/mock/mock-server.ts on a spare port, drives headless Chromium (playwright-core, browsers in
 * /opt/pw-browsers) and writes screenshots to web/mock/screenshots/.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright-core";
import { BRAND, INTENT_CHIPS } from "../src/brand";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..", "..");
const SHOTS = join(HERE, "screenshots");
const PORT = Number(process.env.SMOKE_PORT ?? 7462);
/** NEURALOS_SMOKE_BASE=http://127.0.0.1:7440 points the smoke test at an already-running real kernel instead of the mock. */
const EXTERNAL_BASE = process.env.NEURALOS_SMOKE_BASE?.replace(/\/+$/, "");
const BASE = EXTERNAL_BASE ?? `http://127.0.0.1:${PORT}`;

function chromePath(): string {
  const base = "/opt/pw-browsers";
  const dir = readdirSync(base)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort()
    .pop();
  const p = dir ? join(base, dir, "chrome-linux", "chrome") : "";
  if (!p || !existsSync(p)) throw new Error("Chromium not found under /opt/pw-browsers");
  return p;
}

const results: { name: string; ok: boolean; detail?: string }[] = [];
let currentPage: Page | null = null;
async function check(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? undefined });
    console.log(`PASS  ${name}${detail ? `  (${detail})` : ""}`);
  } catch (err) {
    results.push({ name, ok: false, detail: (err as Error).message });
    await currentPage?.screenshot({ path: join(SHOTS, `fail-${results.length}.png`) }).catch(() => undefined);
    console.log(`FAIL  ${name}  ${(err as Error).message.split("\n")[0]}`);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function waitForServer(url: string, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`mock server did not start at ${url}`);
}

/** Opens the root radial by clicking the Neural Core. */
async function openRootMenu(page: Page) {
  if (await page.$(".radial-layer")) {
    await page.keyboard.press("Escape");
    await page.waitForSelector(".radial-layer", { state: "detached", timeout: 3000 });
  }
  if (await page.$(".side-panel")) {
    await page.keyboard.press("Escape");
    await page.waitForSelector(".side-panel", { state: "detached", timeout: 3000 });
  }
  await page.click(".core-orb");
  await radialLabels(page);
}

async function radialLabels(page: Page): Promise<string[]> {
  await page.waitForSelector(".radial-opt", { timeout: 5000 });
  return page.$$eval(".radial-opt", (els) => els.map((e) => (e.textContent ?? "").trim()));
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  assert(existsSync(join(ROOT, "web", "dist", "index.html")), "web/dist is missing: run the vite build first");

  const server = EXTERNAL_BASE
    ? null
    : spawn(process.execPath, ["--import", "tsx", join(HERE, "mock-server.ts")], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(PORT), MOCK_QUIET: "1", MOCK_TICK_MS: "1500" },
        stdio: ["ignore", "inherit", "inherit"],
      });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    await waitForServer(`${BASE}/api/status`);
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    browser = await chromium.launch({
      executablePath: chromePath(),
      headless: true,
      // Only Google Fonts leave the machine; the kernel is local.
      proxy: proxy ? { server: proxy, bypass: "127.0.0.1,localhost" } : undefined,
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, deviceScaleFactor: 1 });
    const page = await context.newPage();
    currentPage = page;

    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    const requests: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/")) requests.push(`${r.method()} ${u.pathname}`);
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
    await page.waitForSelector(".core-orb", { timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);

    await check("the core renders: live HUD, orb, intent bar with three chips, and the mock's pending approval", async () => {
      const left = ((await page.textContent(".hud-left")) ?? "").trim();
      assert(left.startsWith(`${BRAND.toUpperCase()} · CORE `), `HUD "${left}"`);
      const chips = await page.$$eval(".dock-chip", (els) => els.map((e) => (e.textContent ?? "").trim()));
      assert(JSON.stringify(chips) === JSON.stringify([...INTENT_CHIPS]), `chips ${chips.join(" | ")}`);
      const card = (await page.textContent(".approval-card")) ?? "";
      assert(card.includes("proc.run_tests") && card.includes("irreversible"), `approval card: ${card}`);
      const status = ((await page.textContent(".core-status")) ?? "").trim();
      assert(status.startsWith("HOLDING"), `core status "${status}"`);
      return `${left} | ${status} | ${((await page.textContent(".hud-field")) ?? "").trim()}`;
    });
    await page.screenshot({ path: join(SHOTS, "core.png") });

    await check("the Field view renders nodes of each type", async () => {
      await page.click(".btn-field");
      await page.waitForSelector(".field .react-flow__node", { timeout: 10000 });
      await page.waitForTimeout(800);
      // String body: tsx would wrap named helpers in __name(), which does not exist in the page.
      const counts = (await page.evaluate(`(() => {
        const sel = { project: ".cn-project", file: ".cn-file", agent: ".cn-agent", mcp: ".cn-mcp", workflow: ".cn-workflow",
          workspace: ".cn-workspace", concept: ".cn-concept", edges: ".react-flow__edge" };
        const out = {};
        for (const k of Object.keys(sel)) out[k] = document.querySelectorAll(sel[k]).length;
        return out;
      })()`)) as Record<string, number>;
      for (const k of ["project", "file", "agent", "mcp", "workflow", "workspace"] as const) assert(counts[k] > 0, `no ${k} nodes`);
      assert(counts.edges > 0, "no edges");
      await page.screenshot({ path: join(SHOTS, "field.png") });
      await page.click(".btn-field");
      await page.waitForSelector(".field-layer", { state: "detached", timeout: 3000 });
      return Object.entries(counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
    });

    await check("clicking the core opens the root radial with 7 options", async () => {
      await openRootMenu(page);
      const labels = await radialLabels(page);
      const want = ["Search", "Files", "Agents", "Projects", "Apps", "Memory", "Settings"];
      assert(JSON.stringify(labels) === JSON.stringify(want), `labels ${labels.join(", ")}`);
      assert(requests.includes("GET /api/radial/root"), "GET /api/radial/root not requested");
      return labels.join(", ");
    });
    await page.waitForTimeout(400); // ring-in animation
    await page.screenshot({ path: join(SHOTS, "radial-root.png") });

    await check("radial keyboard: arrows move focus, Escape closes", async () => {
      const first = await page.evaluate(() => document.activeElement?.textContent?.trim());
      await page.keyboard.press("ArrowRight");
      const second = await page.evaluate(() => document.activeElement?.textContent?.trim());
      assert(first === "Search" && second === "Files", `focus went ${first} -> ${second}`);
      await page.keyboard.press("Escape");
      await page.waitForSelector(".radial-layer", { state: "detached", timeout: 3000 });
    });

    await check("an agent from the Agents panel opens its radial with 7 options", async () => {
      await openRootMenu(page);
      await page.click('.radial-opt[data-action-id="agents"]');
      await page.waitForSelector(".side-panel .agent-name", { timeout: 3000 });
      const name = ((await page.textContent(".side-panel .agent-name")) ?? "").trim();
      await page.click(".side-panel .agent-name");
      const labels = await radialLabels(page);
      const want = ["Review", "Explain", "Compare", "Improve", "Test", "Collaborate", "Replace"];
      assert(JSON.stringify(labels) === JSON.stringify(want), `labels ${labels.join(", ")}`);
      const title = ((await page.textContent(".radial-title")) ?? "").trim();
      assert(title === name, `radial title "${title}", expected "${name}"`);
      const disabled = await page.$$eval(".radial-opt.is-disabled", (els) => els.map((e) => `${e.textContent}: ${e.getAttribute("title")}`));
      await page.waitForTimeout(900);
      await page.screenshot({ path: join(SHOTS, "radial-agent.png") });
      await page.keyboard.press("Escape");
      await page.waitForSelector(".radial-layer", { state: "detached", timeout: 3000 });
      return `${name}; disabled: ${disabled.join(" | ")}`;
    });

    await check("Files panel opens a file; its actions open the file radial, which runs a server action", async () => {
      await openRootMenu(page);
      await page.click('.radial-opt[data-action-id="files"]');
      await page.waitForSelector(".side-panel .tree", { timeout: 3000 });
      await page.click('.side-panel .tree-btn:has-text("damage_calc.ts")');
      await page.waitForSelector(".viewer .code-line", { timeout: 5000 });
      await page.keyboard.press("Escape"); // viewer
      await page.waitForSelector(".viewer", { state: "detached", timeout: 3000 });
      await page.click('.side-panel button[aria-label="Actions for damage_calc.ts"]');
      const labels = await radialLabels(page);
      assert(labels.join(",") === "Open,Summarize,Translate,Refactor,Analyze,Attach Agent", `labels ${labels.join(", ")}`);
      const [req] = await Promise.all([
        page.waitForRequest((r) => r.method() === "POST" && /\/api\/radial\/file%3A.*\/summarize$/.test(r.url()), { timeout: 5000 }),
        page.click('.radial-opt[data-action-id="summarize"]'),
      ]);
      await page.waitForSelector(".toast", { timeout: 5000 });
      await page.screenshot({ path: join(SHOTS, "file-action.png") });
      return decodeURIComponent(new URL(req.url()).pathname);
    });

    await check("submitting an intent (INTENT button) calls POST /api/intents; the swarm orbits and the results sheet opens", async () => {
      await page.fill("#nos-intent", "Review inventory module");
      await page.waitForSelector(".dock-hint.on", { timeout: 5000 });
      const hint = ((await page.textContent(".dock-hint")) ?? "").trim();
      assert(requests.includes("POST /api/intents/classify"), "classify not requested");
      const [req, res] = await Promise.all([
        page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/intents", { timeout: 5000 }),
        page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/intents", { timeout: 5000 }),
        page.click(".dock-submit"),
      ]);
      const body = req.postDataJSON() as { text: string; run: boolean };
      assert(body.text === "Review inventory module" && body.run === true, `body ${JSON.stringify(body)}`);
      assert(req.headers()["x-neuralos-client"] === "1", "missing X-NeuralOS-Client header");
      assert(res.status() === 200, `status ${res.status()}`);
      const ws = ((await res.json()) as { workspace: { id: string } }).workspace.id;
      await page.waitForSelector(".satellite", { timeout: 5000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: join(SHOTS, "swarm.png") });
      await page.waitForFunction(
        (id) => document.querySelector(".results-sheet .eyebrow")?.textContent?.includes(id) && document.querySelector(".results-sheet .sheet-status")?.textContent === "completed",
        ws,
        { timeout: 15000 },
      );
      await page.screenshot({ path: join(SHOTS, "results.png") });
      return `hint "${hint}"; created ${ws}, completed`;
    });

    await check("the approval card's Approve calls the endpoint and the card clears", async () => {
      const [req, res] = await Promise.all([
        page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/approvals/apr_1", { timeout: 5000 }),
        page.waitForResponse((r) => new URL(r.url()).pathname === "/api/approvals/apr_1" && r.request().method() === "POST", { timeout: 5000 }),
        page.click('button[aria-label="Approve proc.run_tests"]'),
      ]);
      assert((req.postDataJSON() as { approved: boolean }).approved === true, "approved flag not true");
      assert(res.status() === 200, `status ${res.status()}`);
      await page.waitForSelector(".approval-card", { state: "detached", timeout: 5000 });
      return "approved apr_1; card cleared";
    });

    await check('search panel returns results for "combat code"', async () => {
      await openRootMenu(page);
      await page.click('.radial-opt[data-action-id="search"]');
      await page.waitForSelector(".side-panel #nos-search", { timeout: 3000 });
      await page.click('.side-panel .chip-btn:has-text("combat code")');
      await page.waitForSelector(".hit", { timeout: 5000 });
      const paths = await page.$$eval(".hit-path", (els) => els.map((e) => e.textContent ?? ""));
      assert(paths.length > 0 && paths[0].includes("src/combat/"), `first hit ${paths[0]}`);
      assert(requests.some((r) => r === "GET /api/search"), "GET /api/search not requested");
      await page.screenshot({ path: join(SHOTS, "search.png") });
      await page.click(".hit");
      await page.waitForSelector(".viewer .code-line", { timeout: 5000 });
      const lines = await page.$$eval(".viewer .code-line", (els) => els.length);
      await page.screenshot({ path: join(SHOTS, "file-viewer.png") });
      await page.keyboard.press("Escape");
      await page.waitForSelector(".viewer", { state: "detached", timeout: 3000 });
      await page.keyboard.press("Escape");
      return `${paths.length} hits, first ${paths[0]}; viewer showed ${lines} lines`;
    });

    await check("Apps panel opens ws_review's results with ranked findings", async () => {
      await openRootMenu(page);
      await page.click('.radial-opt[data-action-id="apps"]');
      const items = page.locator(".side-panel .ws-item");
      // The canned review (ws_review) is the oldest "Review inventory module" workspace: last in the newest-first list.
      const reviews = items.filter({ hasText: "Review inventory module" });
      assert((await reviews.count()) > 0, "no review workspace in Apps");
      await reviews.last().click();
      await page.waitForFunction(() => document.querySelector(".results-sheet .eyebrow")?.textContent?.includes("ws_review"), undefined, { timeout: 5000 });
      await page.waitForSelector(".results-sheet .findings .finding", { timeout: 5000 });
      const sev = await page.$$eval(".results-sheet .finding .sev", (els) => els.map((e) => e.textContent));
      assert(sev[0] === "high", `first severity ${sev[0]}`);
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(SHOTS, "results-review.png") });
      return `severities: ${sev.join(", ")}`;
    });

    await check("settings and memory panels load", async () => {
      for (const id of ["settings", "memory"]) {
        await openRootMenu(page);
        await page.click(`.radial-opt[data-action-id="${id}"]`);
        await page.waitForSelector(".side-panel", { timeout: 3000 });
        if (id === "settings") await page.waitForSelector(".side-panel .chain-ok", { timeout: 5000 });
        if (id === "memory") await page.waitForSelector(".side-panel .mem.proposed", { timeout: 5000 });
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(SHOTS, `${id}.png`) });
        await page.keyboard.press("Escape");
        await page.waitForSelector(".side-panel", { state: "detached", timeout: 3000 });
      }
    });

    await check("kill switch halts with confirmation (ember core) and resumes", async () => {
      await page.click(".hud .btn-halt");
      await page.waitForSelector('[role="alertdialog"]', { timeout: 3000 });
      await page.fill('[role="alertdialog"] input', "smoke test");
      const [req] = await Promise.all([
        page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/kernel/halt", { timeout: 5000 }),
        page.click('[role="alertdialog"] .btn-danger'),
      ]);
      assert((req.postDataJSON() as { reason: string }).reason === "smoke test", "halt reason not sent");
      await page.waitForFunction(() => document.querySelector(".core-status")?.textContent === "HALTED · ALL AGENTS STOPPED", undefined, { timeout: 5000 });
      await page.screenshot({ path: join(SHOTS, "halted.png") });
      await Promise.all([
        page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/kernel/resume", { timeout: 5000 }),
        page.click(".core-action .btn-resume"),
      ]);
      await page.waitForFunction(() => !document.querySelector(".core-status")?.textContent?.startsWith("HALTED"), undefined, { timeout: 5000 });
    });

    await check("no console errors", async () => {
      assert(consoleErrors.length === 0, consoleErrors.join(" | "));
      return fontsOk ? "fonts loaded from Google Fonts" : "Google Fonts unreachable: served empty stylesheet";
    });
    // Runs after the console check: the simulated outage logs failed requests on purpose.
    await check("kernel unreachable: grey core with Retry, recovers when the kernel is back", async () => {
      await page.route("**/api/**", (route) => route.abort("connectionrefused"));
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelector(".core-status")?.textContent === "CORE OFFLINE · RECONNECTING", undefined, { timeout: 8000 });
      await page.waitForSelector(".core-action .btn-retry", { timeout: 3000 });
      await page.screenshot({ path: join(SHOTS, "unreachable.png") });
      await page.unroute("**/api/**");
      await page.click(".core-action .btn-retry");
      await page.waitForFunction(() => !document.querySelector(".core-status")?.textContent?.startsWith("CORE OFFLINE"), undefined, { timeout: 8000 });
      await page.waitForFunction(() => /AGENTS? RESTING/.test(document.querySelector(".hud-left")?.textContent ?? ""), undefined, { timeout: 8000 });
    });
  } finally {
    await browser?.close();
    server?.kill("SIGTERM");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in ${SHOTS}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
