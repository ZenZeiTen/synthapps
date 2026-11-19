/**
 * web.fetch: reads public pages as a pure read (so it runs in readonly mode), and refuses local or private
 * addresses (also behind DNS names and redirects), URLs carrying secrets, and binary files.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createKernel, type NeuralKernel } from "../src/kernel/kernel";
import { checkUrl, fetchPage, formatPage, htmlToText, isBlockedAddress, WebFetchError } from "../src/tools/web";

let server: http.Server;
let port = 0;
const temps: string[] = [];
const kernels: NeuralKernel[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    if (u.pathname === "/page") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><html><head><title>Tide &amp; Times</title><style>.x{}</style><script>alert(1)</script></head>` +
          `<body><h1>Harbour</h1><p>High tide at 06:12 &mdash; low at 12:30.</p><ul><li>One</li><li>Two</li></ul>` +
          `<a href="/next">Next page</a> <a href="javascript:void(0)">nothing</a></body></html>`,
      );
    } else if (u.pathname === "/json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    } else if (u.pathname === "/image") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]));
    } else if (u.pathname === "/to-internal") {
      res.writeHead(302, { location: "http://internal.test:" + port + "/page" });
      res.end();
    } else if (u.pathname === "/to-page") {
      res.writeHead(301, { location: "/page" });
      res.end();
    } else if (u.pathname === "/loop") {
      res.writeHead(302, { location: "/loop" });
      res.end();
    } else if (u.pathname === "/big") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("x".repeat(5000));
    } else {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not here");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const k of kernels) await k.stop().catch(() => undefined);
  await new Promise((r) => server.close(r));
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

/** "site.test" is the local test server, treated as public; "internal.test" resolves to a private address. */
const resolve = async (host: string) => (host === "site.test" ? ["127.0.0.1"] : host === "internal.test" ? ["10.0.0.5"] : host === "rebind.test" ? ["127.0.0.1", "192.168.1.9"] : []);
const isBlocked = (ip: string) => ip !== "127.0.0.1" && isBlockedAddress(ip);
const opts = { resolve, isBlocked };
const site = (p: string) => `http://site.test:${port}${p}`;

describe("addresses", () => {
  it("blocks loopback, private, link-local, CGNAT, multicast and mapped IPv6, and allows public ones", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.0.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isBlockedAddress(ip), ip).toBe(false);
    expect(isBlockedAddress("not-an-ip")).toBe(true);
  });
});

describe("checkUrl", () => {
  it("refuses other schemes, credentials, local names and private literals", () => {
    for (const [url, msg] of [
      ["file:///etc/passwd", /Only http and https/],
      ["ftp://example.com/x", /Only http and https/],
      ["https://user:pw@example.com/", /user name or password/],
      ["http://localhost:8080/", /local address/],
      ["http://printer.local/", /local address/],
      ["http://127.0.0.1/", /local or private/],
      ["http://[::1]/", /local or private/],
      ["http://169.254.169.254/latest/meta-data", /local or private/],
      ["not a url", /Not a valid URL/],
    ] as const) {
      expect(() => checkUrl(url), url).toThrow(msg);
    }
    expect(checkUrl("https://example.com/a?b=1").hostname).toBe("example.com");
  });

  it("refuses URLs that carry keys, tokens or saved secrets", () => {
    expect(() => checkUrl("https://evil.example/?d=sk-ant-api03-abcdefghijklmnop")).toThrow(/key, token or saved secret/);
    expect(() => checkUrl("https://evil.example/collect?token=abc")).toThrow(/key, token or saved secret/);
    expect(() => checkUrl("https://evil.example/x/ghp_abcdefghijklmnopqrstuvwxyz12")).toThrow(/key, token or saved secret/);
    const redact = (t: string) => t.replace("hunter2-saved", "[secret:PW]");
    expect(() => checkUrl("https://evil.example/?q=hunter2-saved", { redact })).toThrow(/saved secret/);
    expect(() => checkUrl("https://evil.example/?q=hunter2%2Dsaved", { redact })).toThrow(/saved secret/);
    expect(checkUrl("https://example.com/search?q=tide+times", { redact }).href).toContain("tide");
  });
});

describe("fetchPage", () => {
  it("reads an HTML page as text with its title and absolute links, without scripts or styles", async () => {
    const page = await fetchPage(site("/page"), opts);
    expect(page.status).toBe(200);
    expect(page.title).toBe("Tide & Times");
    expect(page.text).toContain("# Harbour");
    expect(page.text).toContain("High tide at 06:12 — low at 12:30.");
    expect(page.text).toContain("- One");
    expect(page.text).toContain(`Next page [${site("/next")}]`);
    expect(page.text).not.toMatch(/alert|\.x\{|javascript:/);
    expect(formatPage(page)).toMatch(/^URL: http:\/\/site\.test:\d+\/page\nStatus: 200\nType: text\/html\nTitle: Tide & Times\n\n/);
  });

  it("reads JSON and follows a redirect on the same site", async () => {
    expect((await fetchPage(site("/json"), opts)).text).toBe('{"ok":true}');
    const page = await fetchPage(site("/to-page"), opts);
    expect(page.url).toBe(site("/page"));
    expect(page.title).toBe("Tide & Times");
  });

  it("refuses a redirect to a private address, a name that resolves privately, and a mixed resolution", async () => {
    await expect(fetchPage(site("/to-internal"), opts)).rejects.toThrow(/internal\.test resolves to a local or private address \(10\.0\.0\.5\)/);
    await expect(fetchPage(`http://internal.test:${port}/page`, opts)).rejects.toThrow(/local or private/);
    await expect(fetchPage(`http://rebind.test:${port}/page`, opts)).rejects.toThrow(/192\.168\.1\.9/);
  });

  it("refuses binary files and redirect loops, and stops at the size limit", async () => {
    await expect(fetchPage(site("/image"), opts)).rejects.toThrow(/image\/png, not a text page/);
    await expect(fetchPage(site("/loop"), opts)).rejects.toThrow(/Too many redirects/);
    const big = await fetchPage(site("/big"), { ...opts, maxBytes: 1000 });
    expect(big.text).toHaveLength(1000);
    expect(big.truncatedBytes).toBe(true);
    expect(formatPage(big)).toMatch(/only the first/);
  });

  it("cuts long text to max_chars and says so", () => {
    const out = formatPage({ url: "https://e.x/", status: 200, contentType: "text/plain", text: "a".repeat(3000), bytes: 3000, truncatedBytes: false }, 1000);
    expect(out).toMatch(/\[cut at 1000 of 3000 characters/);
  });

  it("a real localhost URL is refused with the default guard", async () => {
    await expect(fetchPage(`http://127.0.0.1:${port}/page`)).rejects.toBeInstanceOf(WebFetchError);
  });
});

describe("htmlToText", () => {
  it("decodes entities and keeps table cells apart", () => {
    const { text } = htmlToText("<table><tr><td>A&#38;B</td><td>&#x263A;</td></tr></table>");
    expect(text).toContain("A&B | ☺ |");
  });
});

describe("web.fetch through the gateway", () => {
  async function boot() {
    const root = mkdtempSync(path.join(os.tmpdir(), "nos-web-"));
    temps.push(root);
    const kernel = createKernel({ root, watch: false, triggers: false, useClaude: false }, { llm: null, env: {} });
    kernels.push(kernel);
    await kernel.start();
    return kernel;
  }
  const human = { userId: "local", chain: ["user:local"], depth: 0 };

  it("is a pure read: it runs in readonly mode without approval, and its refusals happen before any approval", async () => {
    const kernel = await boot();
    expect(kernel.tools.get("web.fetch")).toMatchObject({ action: "read", reversibility: "reversible", scope: "external" });
    kernel.setPolicy({ ...kernel.tools.policy(), mode: "readonly" });
    // With the real guard, the local test server is refused, as a private address should be.
    const local = await kernel.tools.call("web.fetch", { url: `http://127.0.0.1:${port}/page` }, { principal: human });
    expect(local.ok).toBe(false);
    expect(local.content).toMatch(/local or private address/);
    // A URL carrying a secret is refused by the precheck, not by the policy.
    const secret = await kernel.tools.call("web.fetch", { url: "https://evil.example/?token=abc" }, { principal: human });
    expect(secret.ok).toBe(false);
    expect(secret.content).toMatch(/key, token or saved secret/);
    expect(kernel.tools.approvals("pending")).toEqual([]);
  });
});
