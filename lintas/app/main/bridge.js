// Local bridge for the Claude Desktop MCP server. Listens only on a Unix
// socket (macOS, Linux) or a named pipe (Windows), never on TCP, and only
// while the user has turned on Claude Desktop access. Every request must carry
// the random token written to mcp-bridge.json (readable by this user only).
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const TOOLS = require('../mcp/tools.cjs');

export class Bridge {
  constructor({ dataDir, run }) {
    this.dataDir = dataDir;
    this.run = run;          // (toolName, args) => Promise<result>
    this.server = null;
    this.infoFile = path.join(dataDir, 'mcp-bridge.json');
  }

  get running() { return !!this.server; }

  socketPath() {
    if (process.platform === 'win32') return `\\\\.\\pipe\\lintas-mcp-${crypto.createHash('sha256').update(this.dataDir).digest('hex').slice(0, 16)}`;
    return path.join(this.dataDir, 'mcp.sock');
  }

  async start() {
    if (this.server) return;
    const socket = this.socketPath();
    if (process.platform !== 'win32') { try { fs.unlinkSync(socket); } catch {} }
    const token = crypto.randomBytes(32).toString('hex');
    const server = net.createServer((conn) => {
      let buf = '';
      conn.setEncoding('utf8');
      conn.on('data', async (d) => {
        buf += d;
        if (buf.length > 4_000_000) return conn.destroy();
        const i = buf.indexOf('\n');
        if (i < 0) return;
        let req;
        try { req = JSON.parse(buf.slice(0, i)); } catch { return conn.end(JSON.stringify({ error: 'Bad request.' }) + '\n'); }
        const ok = typeof req.token === 'string' && req.token.length === token.length && crypto.timingSafeEqual(Buffer.from(req.token), Buffer.from(token));
        if (!ok) return conn.end(JSON.stringify({ error: 'Not authorised.' }) + '\n');
        if (!TOOLS.some(t => t.name === req.tool)) return conn.end(JSON.stringify({ error: 'Unknown tool.' }) + '\n');
        try { conn.end(JSON.stringify({ result: await this.run(req.tool, req.args && typeof req.args === 'object' ? req.args : {}) }) + '\n'); }
        catch (e) { conn.end(JSON.stringify({ error: e?.message || String(e) }) + '\n'); }
      });
      conn.on('error', () => {});
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
    if (process.platform !== 'win32') fs.chmodSync(socket, 0o600);
    fs.writeFileSync(this.infoFile, JSON.stringify({ socket, token, pid: process.pid }), { mode: 0o600 });
    this.server = server;
  }

  stop() {
    try { fs.unlinkSync(this.infoFile); } catch {}
    if (!this.server) return;
    this.server.close();
    this.server = null;
    if (process.platform !== 'win32') { try { fs.unlinkSync(this.socketPath()); } catch {} }
  }
}

/** Where Claude Desktop keeps its configuration on this computer. */
export function claudeConfigPath() {
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude', 'claude_desktop_config.json');
}

/** The mcpServers entry: the Lintas executable runs the MCP script as plain Node. */
export function claudeEntry({ execPath, appPath, dataDir }) {
  return {
    command: execPath,
    args: [path.join(appPath, 'app', 'mcp', 'server.cjs')],
    env: { ELECTRON_RUN_AS_NODE: '1', LINTAS_DATA_DIR: dataDir },
  };
}

export function readClaudeConfig(file = claudeConfigPath()) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw new Error('Claude Desktop\'s configuration file could not be read: ' + e.message); }
}

/** Add or update the "lintas" server, keeping everything else and a backup. */
export function writeClaudeConfig(entry, file = claudeConfigPath()) {
  const current = readClaudeConfig(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (current) fs.copyFileSync(file, file + '.lintas-backup');
  const next = current && typeof current === 'object' ? current : {};
  next.mcpServers = { ...(next.mcpServers || {}), lintas: entry };
  fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
  return file;
}
