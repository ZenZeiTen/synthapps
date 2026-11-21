import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Bridge, claudeEntry, writeClaudeConfig, readClaudeConfig, TOOLS } from '../app/main/bridge.js';

const server = path.resolve(import.meta.dirname, '../app/mcp/server.cjs');

function mcp(dataDir, messages) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [server], { env: { ...process.env, LINTAS_DATA_DIR: dataDir } });
    let out = '';
    p.stdout.on('data', d => { out += d; if (out.split('\n').filter(Boolean).length >= messages.filter(m => m.id !== undefined).length) p.stdin.end(); });
    p.on('close', () => resolve(out.split('\n').filter(Boolean).map(l => JSON.parse(l)).sort((a, b) => a.id - b.id)));
    p.on('error', reject);
    for (const m of messages) p.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  });
}

test('MCP server speaks the protocol and forwards tool calls through the bridge', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lintas-mcp-'));
  const calls = [];
  const bridge = new Bridge({ dataDir: dir, run: async (tool, args) => { calls.push([tool, args]); if (tool === 'tms_qa') throw new Error('That project no longer exists.'); return { ok: true, tool }; } });
  await bridge.start();
  try {
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'mcp-bridge.json')).mode & 0o777, 0o600);
  const [init, list, ok, err, unknown] = await mcp(dir, [
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { method: 'notifications/initialized' },
    { id: 2, method: 'tools/list' },
    { id: 3, method: 'tools/call', params: { name: 'tms_list_projects', arguments: {} } },
    { id: 4, method: 'tools/call', params: { name: 'tms_qa', arguments: { projectId: 'x' } } },
    { id: 5, method: 'tools/call', params: { name: 'rm_rf', arguments: {} } },
  ]);
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'lintas');
  assert.equal(list.result.tools.length, TOOLS.length);
  assert.deepEqual(JSON.parse(ok.result.content[0].text), { ok: true, tool: 'tms_list_projects' });
  assert.equal(err.result.isError, true);
  assert.match(err.result.content[0].text, /no longer exists/);
  assert.equal(unknown.error.code, -32602);
  assert.deepEqual(calls.map(c => c[0]).sort(), ['tms_list_projects', 'tms_qa']);
  } finally { bridge.stop(); }
  assert.ok(!fs.existsSync(path.join(dir, 'mcp-bridge.json')));
});

test('the bridge rejects a wrong token, and a stopped bridge gives a clear message', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lintas-mcp-'));
  const bridge = new Bridge({ dataDir: dir, run: async () => 'ran' });
  await bridge.start();
  const info = JSON.parse(fs.readFileSync(path.join(dir, 'mcp-bridge.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'mcp-bridge.json'), JSON.stringify({ ...info, token: 'f'.repeat(64) }));
  const [bad] = await mcp(dir, [{ id: 1, method: 'tools/call', params: { name: 'lintas_status', arguments: {} } }]);
  assert.match(bad.result.content[0].text, /Not authorised/);
  bridge.stop();
  const [off] = await mcp(dir, [{ id: 1, method: 'tools/call', params: { name: 'lintas_status', arguments: {} } }]);
  assert.match(off.result.content[0].text, /Claude Desktop access/);
});

test('Claude Desktop config: entry added, other servers and a backup kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lintas-cfg-'));
  const file = path.join(dir, 'Claude', 'claude_desktop_config.json');
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: 'x' } }, globalShortcut: 'Ctrl+Space' }));
  writeClaudeConfig(claudeEntry({ execPath: '/opt/Lintas/lintas', appPath: '/opt/Lintas/resources/app.asar', dataDir: '/home/u/.config/Lintas' }), file);
  const cfg = readClaudeConfig(file);
  assert.equal(cfg.mcpServers.other.command, 'x');
  assert.equal(cfg.globalShortcut, 'Ctrl+Space');
  assert.equal(cfg.mcpServers.lintas.env.ELECTRON_RUN_AS_NODE, '1');
  assert.ok(cfg.mcpServers.lintas.args[0].endsWith(path.join('app', 'mcp', 'server.cjs')));
  assert.ok(fs.existsSync(file + '.lintas-backup'));
});
