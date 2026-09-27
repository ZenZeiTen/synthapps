/**
 * Smoke test for the Neural Canvas against the mock kernel.
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

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..", "..");
const SHOTS = join(HERE, "screenshots");
const PORT = Number(process.env.SMOKE_PORT ?? 7462);
const BASE = `http://127.0.0.1:${PORT}`;

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

/** A point inside the canvas where the pane (not a node or overlay) is on top. */
async function emptyPanePoint(page: Page): Promise<{ x: number; y: number }> {
  const pt = await page.evaluate(() => {
    const pane = document.querySelector(".react-flow__pane");
    const area = document.querySelector(".canvas-area")!.getBoundingClientRect();
    for (let y = area.top + 170; y < area.bottom - 200; y += 23) {
      for (let x = area.left + 250; x < area.right - 230; x += 29) {
        const el = document.elementFromPoint(x, y);
        if (el && (el === pane || el.classList.contains("react-flow__pane"))) {
          // Keep away from nodes so the click is unambiguous.
          let clear = true;
          for (const [dx, dy] of [[-30, 0], [30, 0], [0, -30], [0, 30]]) {
            const o = document.elementFromPoint(x + dx, y + dy);
            if (!o || !o.classList.contains("react-flow__pane")) clear = false;
          }
          if (clear) return { x, y };
        }
      }
    }
    return null;
  });
  assert(pt, "no empty pane point found");
  return pt;
}

/** An agent node button fully inside the visible canvas and not covered by an overlay. */
async function visibleNode(page: Page, type: string): Promise<{ x: number; y: number; name: string }> {
  const pt = await page.evaluate((t) => {
    const area = document.querySelector(".canvas-area")!.getBoundingClientRect();
    const bar = document.querySelector(".intent-bar")?.getBoundingClientRect();
    for (const wrap of document.querySelectorAll(`[data-node-type="${t}"]`)) {
      const btn = wrap.querySelector("button");
      if (!btn) continue;
      const r = btn.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + Math.min(20, r.height / 2);
      if (x < area.left + 20 || x > area.right - 200 || y < area.top + 140 || y > area.bottom - 20) continue;
      if (bar && y > bar.top - 10) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && btn.contains(hit)) return { x, y, name: btn.getAttribute("aria-label") ?? "" };
    }
    return null;
  }, type);
  assert(pt, `no visible ${type} node`);
  return pt;
}

/** Opens the root radial with the canvas "Open menu" button (the keyboard path to the root menu). */
async function openRootMenu(page: Page) {
  if (await page.$(".radial-layer")) {
    await page.keyboard.press("Escape");
    await page.waitForSelector(".radial-layer", { state: "detached", timeout: 3000 });
  }
  await page.click(".canvas-menu-btn");
  await radialLabels(page);
}

async function radialLabels(page: Page): Promise<string[]> {
  await page.waitForSelector(".radial-opt", { timeout: 5000 });
  return page.$$eval(".radial-opt", (els) => els.map((e) => (e.textContent ?? "").trim()));
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  assert(existsSync(join(ROOT, "web", "dist", "index.html")), "web/dist is missing: run the vite build first");

  const server = spawn(process.execPath, ["--import", "tsx", join(HERE, "mock-server.ts")], {
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
    await page.waitForSelector(".react-flow__node", { timeout: 15000 });
    await page.waitForTimeout(1200); // fit view + fonts
    await page.evaluate(() => document.fonts.ready);

    await check("canvas renders nodes of each shape type", async () => {
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
      return Object.entries(counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
    });
    await page.screenshot({ path: join(SHOTS, "canvas.png") });

    await check("clicking the pane opens the root radial with 7 options", async () => {
      const p = await emptyPanePoint(page);
      await page.mouse.click(p.x, p.y);
      const labels = await radialLabels(page);
      assert(labels.length === 7, `expected 7 options, got ${labels.length}: ${labels.join(", ")}`);
      const want = ["Search", "Files", "Agents", "Projects", "Apps", "Memory", "Settings"];
      assert(JSON.stringify(labels) === JSON.stringify(want), `labels ${labels.join(", ")}`);
      assert(requests.includes("GET /api/radial/root"), "GET /api/radial/root not requested");
      return labels.join(", ");
    });
    await page.waitForTimeout(300); // ring-in animation
    await page.screenshot({ path: join(SHOTS, "radial-root.png") });

    await check("radial keyboard: arrows move focus, Escape closes", async () => {
      const first = await page.evaluate(() => document.activeElement?.textContent?.trim());
      await page.keyboard.press("ArrowRight");
      const second = await page.evaluate(() => document.activeElement?.textContent?.trim());
      assert(first === "Search" && second === "Files", `focus went ${first} -> ${second}`);
      await page.keyboard.press("Escape");
      await page.waitForSelector(".radial-layer", { state: "detached", timeout: 3000 });
    });

    await check("clicking an agent node opens the agent radial with 7 options", async () => {
      const a = await visibleNode(page, "agent");
      await page.mouse.click(a.x, a.y);
      const labels = await radialLabels(page);
      const want = ["Review", "Explain", "Compare", "Improve", "Test", "Collaborate", "Replace"];
      assert(JSON.stringify(labels) === JSON.stringify(want), `labels ${labels.join(", ")}`);
      const disabled = await page.$$eval(".radial-opt.is-disabled", (els) => els.map((e) => `${e.textContent}: ${e.getAttribute("title")}`));
      return `${a.name.split(",")[0]}; disabled: ${disabled.join(" | ")}`;
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, "radial-agent.png") });
    await page.keyboard.press("Escape");
    await page.waitForSelector(".radial-layer", { state: "detached", timeout: 3000 });

    await check("Files panel opens a file and focuses its node; file radial runs a server action", async () => {
      await openRootMenu(page);
      await page.click('.radial-opt[data-action-id="files"]');
      await page.waitForSelector(".side-panel .tree", { timeout: 3000 });
      await page.click('.side-panel .tree-btn:has-text("damage_calc.ts")');
      await page.waitForSelector(".viewer .code-line", { timeout: 5000 });
      await page.keyboard.press("Escape"); // viewer
      await page.waitForSelector(".viewer", { state: "detached", timeout: 3000 });
      await page.keyboard.press("Escape"); // panel
      await page.waitForSelector(".side-panel", { state: "detached", timeout: 3000 });
      await page.waitForTimeout(700); // focus animation
      const f = await visibleNode(page, "file");
      await page.mouse.click(f.x, f.y);
      const labels = await radialLabels(page);
      assert(labels.join(",") === "Open,Summarize,Translate,Refactor,Analyze,Attach Agent", `labels ${labels.join(", ")}`);
      const [req] = await Promise.all([
        page.waitForRequest((r) => r.method() === "POST" && /\/api\/radial\/file%3A.*\/summarize$/.test(r.url()), { timeout: 5000 }),
        page.click('.radial-opt[data-action-id="summarize"]'),
      ]);
      await page.waitForSelector(".toast", { timeout: 5000 });
      await page.screenshot({ path: join(SHOTS, "file-focus.png") });
      return `${f.name.split(",")[0]} -> ${decodeURIComponent(new URL(req.url()).pathname)}`;
    });

    await check("submitting an intent calls POST /api/intents (with live classification preview)", async () => {
      await page.fill("#nos-intent", "Review inventory module");
      await page.waitForSelector(".intent-preview .intent-class", { timeout: 5000 });
      const cls = await page.textContent(".intent-preview .intent-class");
      assert(requests.includes("POST /api/intents/classify"), "classify not requested");
      const [req, res] = await Promise.all([
        page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/intents", { timeout: 5000 }),
        page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/intents", { timeout: 5000 }),
        page.click('button:has-text("Generate workspace")'),
      ]);
      const body = req.postDataJSON() as { text: string; run: boolean };
      assert(body.text === "Review inventory module" && body.run === true, `body ${JSON.stringify(body)}`);
      assert(req.headers()["x-neuralos-client"] === "1", "missing X-NeuralOS-Client header");
      assert(res.status() === 200, `status ${res.status()}`);
      const ws = ((await res.json()) as { workspace: { id: string } }).workspace.id;
      await page.waitForFunction((id) => document.querySelector(".exec .exec-status-row")?.textContent?.includes(id), ws, { timeout: 5000 });
      await page.waitForSelector(`[data-node-id="workspace:${ws}"]`, { timeout: 5000 });
      return `classified ${cls}; created ${ws}`;
    });
    await page.waitForTimeout(4200); // let the mock swarm finish so the live update is visible
    await page.screenshot({ path: join(SHOTS, "after-intent.png") });

    await check("approvals bar shows the pending approval and Approve calls the endpoint", async () => {
      const text = await page.textContent(".approvals");
      assert(text?.includes("proc.run_tests") && text.includes("irreversible"), `approvals bar text: ${text}`);
      await page.screenshot({ path: join(SHOTS, "approvals.png"), clip: { x: 0, y: 0, width: 1440, height: 200 } });
      const [req, res] = await Promise.all([
        page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/approvals/apr_1", { timeout: 5000 }),
        page.waitForResponse((r) => new URL(r.url()).pathname === "/api/approvals/apr_1" && r.request().method() === "POST", { timeout: 5000 }),
        page.click('button[aria-label="Approve proc.run_tests"]'),
      ]);
      assert((req.postDataJSON() as { approved: boolean }).approved === true, "approved flag not true");
      assert(res.status() === 200, `status ${res.status()}`);
      await page.waitForSelector(".approvals", { state: "detached", timeout: 5000 });
      return "approved apr_1; bar cleared";
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

    await check("execution panel shows ws_review with ranked findings", async () => {
      // Select ws_review through the Apps panel item whose id matches.
      await openRootMenu(page);
      await page.click('.radial-opt[data-action-id="apps"]');
      const items = page.locator(".side-panel .ws-item");
      // The canned review (ws_review) is the oldest "Review inventory module" workspace: last in the newest-first list.
      const reviews = items.filter({ hasText: "Review inventory module" });
      assert((await reviews.count()) > 0, "no review workspace in Apps");
      await reviews.last().click();
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => document.querySelector(".exec .exec-status-row")?.textContent?.includes("ws_review"), undefined, { timeout: 5000 });
      await page.waitForSelector(".exec .findings .finding", { timeout: 5000 });
      const sev = await page.$$eval(".exec .finding .sev", (els) => els.map((e) => e.textContent));
      assert(sev[0] === "high", `first severity ${sev[0]}`);
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(SHOTS, "execution-panel.png"), clip: { x: 1060, y: 48, width: 380, height: 852 } });
      await page.screenshot({ path: join(SHOTS, "workspace-selected.png") });
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

    await check("kill switch halts with confirmation and resumes", async () => {
      await page.click(".btn-halt");
      await page.waitForSelector('[role="alertdialog"]', { timeout: 3000 });
      await page.fill('[role="alertdialog"] input', "smoke test");
      const [req] = await Promise.all([
        page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/kernel/halt", { timeout: 5000 }),
        page.click('[role="alertdialog"] .btn-danger'),
      ]);
      assert((req.postDataJSON() as { reason: string }).reason === "smoke test", "halt reason not sent");
      await page.waitForSelector(".halt-banner", { timeout: 5000 });
      await page.screenshot({ path: join(SHOTS, "halted.png") });
      await Promise.all([
        page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/kernel/resume", { timeout: 5000 }),
        page.click(".halt-banner .btn-resume"),
      ]);
      await page.waitForSelector(".halt-banner", { state: "detached", timeout: 5000 });
    });

    await check("fit view shows the whole graph", async () => {
      await page.click(".react-flow__controls-fitview");
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(SHOTS, "overview.png") });
    });

    await check("no console errors", async () => {
      assert(consoleErrors.length === 0, consoleErrors.join(" | "));
      return fontsOk ? "fonts loaded from Google Fonts" : "Google Fonts unreachable: served empty stylesheet";
    });
    // Runs after the console check: the simulated outage logs failed requests on purpose.
    await check("kernel unreachable: banner with Retry, recovers when the kernel is back", async () => {
      await page.route("**/api/**", (route) => route.abort("connectionrefused"));
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector(".offline-banner", { timeout: 8000 });
      await page.waitForSelector(".canvas-state-error", { timeout: 8000 });
      await page.screenshot({ path: join(SHOTS, "unreachable.png") });
      await page.unroute("**/api/**");
      await page.click(".offline-banner button");
      await page.waitForSelector(".offline-banner", { state: "detached", timeout: 8000 });
      await page.waitForSelector(".cn-workspace", { timeout: 8000 });
    });
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in ${SHOTS}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
