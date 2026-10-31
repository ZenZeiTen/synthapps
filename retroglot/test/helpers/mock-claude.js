// A stand-in for the Claude Messages API, for tests. It records every request
// and answers translation requests with a fixed result for the Hoshifuri demo.
import http from 'node:http';

/** Translations of the demo's five screens, keyed by a phrase from each. */
export const DEMO_SCREENS = [
  { speaker: '村長', original: 'ようこそ、旅の人。ここは星降る村です。', translation: 'Welcome, traveler. This is Starfall Village.' },
  { speaker: '村長', original: '北の塔には、古い魔法の本が眠っていると言われています。', translation: 'They say an old book of magic sleeps in the northern tower.' },
  { speaker: 'リナ', original: 'わかりました。明日の朝、塔へ向かいます！', translation: "Understood. I'll head for the tower tomorrow morning!" },
  { speaker: '村長', original: '夜の森には影の獣が出ます。どうか気をつけて。', translation: 'Shadow beasts roam the forest at night. Please be careful.' },
  { speaker: '', original: '塔へ行きますか？ ▶はい いいえ', translation: 'Go to the tower? ▶Yes  No' },
];

/**
 * Start the mock. `pickScreen(requestBody, index)` chooses which demo screen to answer with
 * (default: the n-th request gets screen n, wrapping).
 */
export async function startMockClaude({ pickScreen } = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    requests.push({ url: req.url, headers: req.headers, body });
    if (req.url.startsWith('/v1/models')) {
      // SDK 1.x sends the key as a bearer token; older ones use x-api-key.
      if (req.headers['x-api-key'] === 'sk-ant-bad' || req.headers.authorization === 'Bearer sk-ant-bad') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-01-01T00:00:00Z' }], has_more: false, first_id: 'claude-opus-5-5', last_id: 'claude-opus-5-5' }));
    }
    if (req.url.startsWith('/v1/messages')) {
      const user = body.messages?.[0]?.content || [];
      const text = user.find((b) => b.type === 'text')?.text || '';
      const size = /Screenshot size: (\d+) x (\d+)/.exec(text);
      const W = size ? Number(size[1]) : 960;
      const H = size ? Number(size[2]) : 600;
      const n = pickScreen ? pickScreen(body, requests.length - 1) : (requests.length - 1) % DEMO_SCREENS.length;
      const s = DEMO_SCREENS[n];
      // The demo's dialogue window is at x 16..300, y 150..190 of 320x200.
      const result = {
        source_language: 'Japanese',
        lines: [{
          original: s.original, translation: s.translation, speaker: s.speaker === '村長' ? 'Village Elder' : s.speaker === 'リナ' ? 'Lina' : '',
          kind: s.speaker ? 'dialogue' : 'menu',
          box: { x: (16 / 320) * W, y: (148 / 200) * H, width: (284 / 320) * W, height: (40 / 200) * H },
        }],
        new_terms: n === 0 ? [{ source: '星降る村', target: 'Starfall Village', note: 'place name' }] : [],
      };
      const payload = {
        id: `msg_mock_${requests.length}`, type: 'message', role: 'assistant', model: body.model,
        content: [{ type: 'text', text: JSON.stringify(result) }],
        stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 1800, output_tokens: 120, cache_read_input_tokens: requests.length > 1 ? 900 : 0, cache_creation_input_tokens: requests.length > 1 ? 0 : 900 },
      };
      res.writeHead(200, { 'Content-Type': 'application/json', 'request-id': `req_${requests.length}` });
      return res.end(JSON.stringify(payload));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'not found' } }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, requests, close: () => new Promise((r) => server.close(r)) };
}
