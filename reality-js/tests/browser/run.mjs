// Start the static server and a headless Chromium page with WebGL2.
// By default Chromium uses SwiftShader (a CPU implementation), so this runs
// on machines without a GPU; pass { gpu: true } to use the real GPU.
import { startServer } from '../../tools/serve.mjs';

async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    // Fall back to a global install (common in CI images).
    const { execSync } = await import('node:child_process');
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return (await import(`${root}/playwright/index.mjs`)).chromium;
  }
}

export async function launch({ gpu = false } = {}) {
  const chromium = await loadChromium();
  const server = await startServer(0);
  const port = server.address().port;
  const args = gpu
    ? ['--ignore-gpu-blocklist', '--enable-gpu']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const browser = await chromium.launch({ args });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', (e) => logs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/tools/headless.html`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  return {
    page, logs, base: `http://127.0.0.1:${port}`,
    close: async () => { await browser.close(); server.close(); },
  };
}
