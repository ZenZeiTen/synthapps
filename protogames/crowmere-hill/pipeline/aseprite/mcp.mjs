// Thin stdio client for the user's Aseprite MCP server (E:\aseprite-mcp-stable, v0.3.0).
//
// The pipeline drives Aseprite *through the MCP*, not around it: every sprite in
// content/art/sprites is produced by create_sprite / draw_pixels / add_frame /
// add_tag / export_spritesheet calls, so the .aseprite sources stay editable by
// hand and the server's own contract (TOOLS.md) governs what gets written.
//
// The SDK is imported from the server's own node_modules so this repo needs no
// npm install of its own.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SERVER_DIR = process.env.ASEPRITE_MCP_DIR || 'E:/aseprite-mcp-stable';
const ASEPRITE = process.env.ASEPRITE_PATH || 'C:/Program Files/Aseprite/Aseprite.exe';

const sdk = (rel) => pathToFileURL(path.join(SERVER_DIR, 'node_modules/@modelcontextprotocol/sdk/dist/esm', rel)).href;
const { Client } = await import(sdk('client/index.js'));
const { StdioClientTransport } = await import(sdk('client/stdio.js'));

export async function connect({ timeoutMs = 120000 } = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(SERVER_DIR, 'src', 'index.js')],
    // Full environment on purpose: a scrubbed env (no APPDATA) makes Aseprite hang
    // forever (aseprite-mcp measured fact; see its docs/AESPRITE-NOTES.md).
    env: { ...process.env, ASEPRITE_PATH: ASEPRITE, ASEPRITE_MCP_TIMEOUT_MS: String(timeoutMs) },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'crowmere-pipeline', version: '0.1.0' });
  await client.connect(transport);
  let calls = 0;
  return {
    async call(name, args) {
      calls++;
      const res = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs + 10000 });
      const text = res.content?.find((c) => c.type === 'text')?.text ?? '';
      if (res.isError) throw new Error(`${name} failed: ${text}`);
      try { return JSON.parse(text); } catch { return { raw: text }; }
    },
    async tools() { return (await client.listTools()).tools.map((t) => t.name); },
    get calls() { return calls; },
    close: () => client.close(),
  };
}
