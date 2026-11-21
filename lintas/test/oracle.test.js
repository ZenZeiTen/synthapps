import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Oracle, OracleMemory, TOOL_ROLE } from '../app/main/oracle.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lintas-oracle-'));

// A scripted fake Anthropic client: each stream() call plays the next scripted message.
function fakeClient(script, calls = []) {
  const stream = params => {
    calls.push({ ...params, messages: [...params.messages] });
    const step = script.shift();
    if (step instanceof Error) throw step;
    const content = step.content;
    const events = [];
    content.forEach((b, index) => {
      events.push({ type: 'content_block_start', index, content_block: b.type === 'text' ? { type: 'text', text: '' } : b });
      if (b.type === 'text') for (const w of b.text.match(/\S+\s*/g) || []) events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: w } });
    });
    const gate = step.gate;
    return {
      async *[Symbol.asyncIterator]() { if (gate) await gate; for (const e of events) { await null; yield e; } },
      async finalMessage() { return { content, stop_reason: step.stop_reason, usage: step.usage || { input_tokens: 100, output_tokens: 10 } }; },
    };
  };
  return { messages: { stream }, beta: { messages: { stream } } };
}

const PAGE = { url: 'https://example.com/a', title: 'Example', paragraphs: [
  { n: 1, text: 'Welcome to the example page.' }, { n: 2, text: 'The refund window is 7 days after purchase.' }, { n: 3, text: 'Contact support for help.' }] };

function setup({ script, tools = {}, calls, dir = tmp() } = {}) {
  const events = [];
  const ran = [];
  const waiters = [];
  const oracle = new Oracle({
    ai: { getSettings: () => ({ model: 'claude-opus-5-5', effort: 'medium' }), usageTotals: {}, addUsage() {}, usesFallback: () => false },
    runTool: async (name, args) => { ran.push([name, args]); if (tools[name]) return tools[name](args); return { ok: true }; },
    readPage: async () => PAGE,
    emit: (e, p) => { events.push(p); for (const w of waiters.splice(0)) w(); },
    dataDir: dir,
    getClient: () => fakeClient(script, calls),
  });
  const until = pred => new Promise(resolve => {
    const check = () => { if (events.some(pred)) resolve(); else waiters.push(check); };
    check();
  });
  return { oracle, events, ran, until, dir };
}

const tu = (id, name, input = {}) => ({ type: 'tool_use', id, name, input });

test('role mapping covers every tool as the contract describes', () => {
  for (const n of ['page_read', 'page_find', 'browser_read_page', 'browser_list_tabs', 'browser_get_selection', 'offline_list', 'web_search']) assert.equal(TOOL_ROLE[n], 'research');
  for (const n of ['memory_recall', 'memory_save', 'tms_lookup', 'tms_search_terms', 'tms_list_projects', 'tms_get_project', 'tms_get_segments', 'tms_qa']) assert.equal(TOOL_ROLE[n], 'memory');
  for (const n of ['browser_open', 'browser_save_offline', 'tms_create_project', 'tms_update_segment', 'tms_add_term', 'tms_import_text', 'tms_capture_page']) assert.equal(TOOL_ROLE[n], 'action');
});

test('two-round loop: page_read then a cited answer', async () => {
  const calls = [];
  const s = setup({ calls, script: [
    { stop_reason: 'tool_use', content: [tu('t1', 'page_read')] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'You can get a refund within 7 days [2].' }] },
  ] });
  const { runId } = s.oracle.ask(5, 'What is the refund window?', { history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }] });
  await s.until(e => e.type === 'done' || e.type === 'error');
  const done = s.events.at(-1);
  assert.equal(done.type, 'done');
  assert.ok(s.events.every(e => e.runId === runId));
  assert.equal(done.answer, 'You can get a refund within 7 days [2].');
  assert.deepEqual(done.citations, [{ n: 2, quote: 'The refund window is 7 days after purchase.' }]);
  assert.deepEqual(done.usage, { inputTokens: 200, outputTokens: 20 });
  assert.deepEqual(done.roles, ['research', 'planning']);

  const seq = s.events.map(e => e.type === 'role' ? `role:${e.role}:${e.state}` : e.type === 'tool' ? `tool:${e.status}` : e.type);
  const text = seq.indexOf('text');
  assert.deepEqual(seq.slice(0, 7), ['role:planning:active', 'role:planning:idle', 'role:research:active', 'tool:running', 'tool:done', 'role:research:idle', 'role:planning:active']);
  assert.ok(text > 7 && seq.at(-1) === 'done');
  assert.equal(s.events[0].detail, 'Understanding your question');
  assert.equal(s.events.filter(e => e.type === 'role' && e.role === 'planning' && e.state === 'active')[1].detail, 'Deciding the next step');
  const toolDone = s.events.find(e => e.type === 'tool' && e.status === 'done');
  assert.equal(toolDone.summary, 'Read 3 paragraphs');
  // second request carries the tool_result and the history
  assert.equal(calls.length, 2);
  assert.equal(calls[1].messages.at(-1).content[0].tool_use_id, 't1');
  assert.match(calls[1].messages.at(-1).content[0].content, /\[2\] The refund window/);
  assert.equal(calls[0].messages[0].content, 'hi');
});

test('private tabs are filtered from the tab list', async () => {
  const s = setup({
    tools: { browser_list_tabs: () => ({ tabs: [{ id: 1, title: 'A', url: 'https://a', private: false }, { id: 2, title: 'Secret', url: 'https://s', private: true }] }) },
    script: [{ stop_reason: 'tool_use', content: [tu('t1', 'browser_list_tabs')] }, { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }],
  });
  const calls = [];
  s.oracle.getClient = () => fakeClient([{ stop_reason: 'tool_use', content: [tu('t1', 'browser_list_tabs')] }, { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }], calls);
  s.oracle.ask(1, 'list my tabs');
  await s.until(e => e.type === 'done');
  const result = calls[1].messages.at(-1).content[0].content;
  assert.ok(result.includes('"A"') && !result.includes('Secret'));
  assert.equal(s.events.find(e => e.type === 'tool' && e.status === 'done').summary, '1 open tab');
});

test('changing tools need approval: allow runs the tool', async () => {
  const s = setup({ script: [
    { stop_reason: 'tool_use', content: [tu('t1', 'browser_open', { url: 'https://example.org' })] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Opened.' }] },
  ] });
  const { runId } = s.oracle.ask(1, 'open example.org');
  await s.until(e => e.type === 'approval');
  const ap = s.events.find(e => e.type === 'approval');
  assert.equal(ap.callId, 't1'); assert.equal(ap.detail, 'Open a new tab: https://example.org');
  assert.equal(s.ran.length, 0);
  assert.equal(s.oracle.approve(runId, 't1', true), true);
  await s.until(e => e.type === 'done');
  assert.deepEqual(s.ran, [['browser_open', { url: 'https://example.org' }]]);
  assert.ok(s.events.some(e => e.type === 'role' && e.role === 'action' && e.state === 'active'));
  assert.deepEqual(s.events.at(-1).roles.includes('action'), true);
});

test('declining an action returns the declined result and does not run it', async () => {
  const calls = [];
  const s = setup({ calls, script: [
    { stop_reason: 'tool_use', content: [tu('t1', 'memory_save', { text: 'likes tea' })] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'No problem.' }] },
  ] });
  const { runId } = s.oracle.ask(1, 'remember I like tea');
  await s.until(e => e.type === 'approval');
  assert.equal(s.events.find(e => e.type === 'approval').detail, 'Remember: likes tea');
  s.oracle.approve(runId, 't1', false);
  await s.until(e => e.type === 'done');
  assert.ok(s.events.some(e => e.type === 'tool' && e.status === 'denied'));
  assert.equal(calls[1].messages.at(-1).content[0].content, 'The user declined this action.');
  assert.deepEqual(s.oracle.memory(), []);
});

test('approved memory_save persists, and stop aborts a run with "Stopped."', async () => {
  const s = setup({ script: [
    { stop_reason: 'tool_use', content: [tu('t1', 'memory_save', { text: 'likes tea' })] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Saved.' }] },
  ] });
  const { runId } = s.oracle.ask(1, 'remember I like tea');
  await s.until(e => e.type === 'approval');
  s.oracle.approve(runId, 't1', true);
  await s.until(e => e.type === 'done');
  assert.equal(s.oracle.memory()[0].text, 'likes tea');

  let release;
  const gate = new Promise(r => { release = r; });
  const s2 = setup({ script: [{ stop_reason: 'end_turn', gate, content: [{ type: 'text', text: 'late' }] }] });
  const r2 = s2.oracle.ask(9, 'hello');
  await s2.until(e => e.type === 'role');
  assert.equal(s2.oracle.stop(r2.runId), true);
  release();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(s2.events.at(-1).type, 'error');
  assert.equal(s2.events.at(-1).message, 'Stopped.');
  assert.equal(s2.events.filter(e => e.type === 'error' || e.type === 'done').length, 1);
  assert.equal(s2.events.some(e => e.type === 'text'), false);
});

test('stopping while waiting for approval declines it and ends the run', async () => {
  const s = setup({ script: [{ stop_reason: 'tool_use', content: [tu('t1', 'browser_open', { url: 'https://x.y' })] }] });
  const { runId } = s.oracle.ask(1, 'open it');
  await s.until(e => e.type === 'approval');
  s.oracle.stop(runId);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(s.events.at(-1).message, 'Stopped.');
  assert.equal(s.ran.length, 0);
});

test('a rejected web search tool is retried once without it', async () => {
  const calls = [];
  const bad = Object.assign(new Error('400 web_search tool is not enabled'), { status: 400 });
  const s = setup({ calls, script: [bad, { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hello.' }] }] });
  s.oracle.ask(1, 'hi');
  await s.until(e => e.type === 'done');
  assert.ok(calls[0].tools.some(t => t.name === 'web_search'));
  assert.ok(!calls[1].tools.some(t => t.name === 'web_search'));
  s.oracle.ask(1, 'again');
  assert.equal(s.oracle.noWebSearch, true);
});

test('page_find ranks paragraphs; memory save, recall and forget persist', async () => {
  const calls = [];
  const s = setup({ calls, script: [
    { stop_reason: 'tool_use', content: [tu('t1', 'page_find', { query: 'refund days' })] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Seven days [2].' }] },
  ] });
  s.oracle.ask(1, 'refund?');
  await s.until(e => e.type === 'done');
  assert.match(calls[1].messages.at(-1).content[0].content, /\[2\] The refund window/);
  assert.equal(s.events.find(e => e.type === 'tool' && e.status === 'done').summary, 'Found 1 matching paragraph');

  const dir = tmp();
  const m = new OracleMemory(dir);
  const a = m.save('The user translates Indonesian legal documents');
  m.save('Prefers British spelling');
  assert.equal(m.recall('legal documents')[0].id, a.id);
  assert.deepEqual(m.recall('zebra'), []);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'oracle-memory.json')).mode & 0o777, 0o600);
  const again = new OracleMemory(dir);
  assert.equal(again.list().length, 2);
  again.forget(a.id);
  assert.equal(new OracleMemory(dir).list().length, 1);
  new OracleMemory(dir).forget('*');
  assert.equal(new OracleMemory(dir).list().length, 0);
  const big = new OracleMemory(tmp());
  for (let i = 0; i < 210; i++) big.save(`memory number ${i}`);
  assert.equal(big.list().length, 200);
  assert.equal(big.save('x'.repeat(900)).text.length, 500);
});
