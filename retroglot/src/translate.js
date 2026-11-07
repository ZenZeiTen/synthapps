// Screen translation with Claude: one screenshot in, every piece of text on it
// out, each with its position, its translation, the speaker and what kind of
// text it is. The browser draws the result over the game.
//
// Every request to Claude goes through `requestTranslation`.

import Anthropic from '@anthropic-ai/sdk';

export const MODELS = {
  'claude-opus-5-5': { label: 'Claude Opus 5.5 (best quality)', input: 4, output: 20, cacheRead: 0.2, fallbacks: true },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5 (faster, cheaper)', input: 2, output: 10, cacheRead: 0.2, fallbacks: true },
  'claude-haiku-5-5': { label: 'Claude Haiku 5.5 (fastest, cheapest)', input: 0.1, output: 0.5, cacheRead: 0.01, fallbacks: false },
};
export const EFFORTS = ['low', 'medium', 'high'];
export const STYLES = {
  natural: 'Natural: read like a professional localization, faithful in meaning, fluent in the target language.',
  literal: 'Literal: stay close to the original wording and sentence structure, for learners and fact-checking.',
  localized: 'Localized: adapt jokes, idioms and cultural references so they land for the target audience, as a commercial localization would.',
};
export const KINDS = ['dialogue', 'narration', 'menu', 'ui', 'sign', 'item', 'title', 'other'];

const SYSTEM_PROMPT = `You are the live translator inside a retro game emulator. The player sends you a screenshot of the game screen; you find every piece of text a player would read and translate it, so the emulator can draw your translation on top of the original.

How to read the screen:
- Retro games use small bitmap fonts, often Japanese kana and kanji drawn at 8 to 16 pixels. The screenshot has been enlarged without smoothing, so pixels look blocky. Read glyphs carefully; use the context of the sentence to tell apart look-alike characters (ソ/ン, シ/ツ, ー/一, 力/カ, 口/ロ, 夕/タ).
- Group text that belongs together into one entry: a whole dialogue window is one entry, each menu option or button label is one entry, a sign is one entry. Keep line breaks inside an entry as a single space unless they separate speakers.
- Leave out text that is already in the target language, decorative logos you cannot read, button prompts drawn as icons, and numbers that need no translation (scores, timers, HP values alone).
- If the text is cut off, or a dialogue window is still typing out, translate what is visible and do not invent the rest.
- If there is no text to translate, return an empty list.

How to translate:
- Translate meaning, tone and character voice, not word by word. Keep it short enough to fit roughly the same space as the original; game text is read in a small window.
- Use the glossary exactly as given for names, places, items and spells. If you meet a new proper noun or game term, choose one translation, use it, and report it in new_terms so it stays consistent later.
- The recent dialogue is context for who is talking and what has happened. Do not translate it again.
- Speaker: when a dialogue window shows or clearly implies the speaker (a name tag, a portrait label, a "Name:" prefix), give the speaker's name in the target language; otherwise an empty string. Do not repeat the name tag inside the translation.
- Keep honorifics, sound effects and verbal tics in a form that reads naturally in the target language for the requested style.

Positions:
- box is the rectangle around the original text in pixels of the screenshot as you received it: x and y of the top-left corner, then width and height. The image size is given in the request. Cover the text itself tightly, not the whole window frame.`;

/** JSON schema for structured output. */
export const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['source_language', 'lines', 'new_terms'],
  properties: {
    source_language: { type: 'string', description: 'Language of the text on screen, in English (e.g. "Japanese"), or "none".' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['original', 'translation', 'speaker', 'kind', 'box'],
        properties: {
          original: { type: 'string' },
          translation: { type: 'string' },
          speaker: { type: 'string' },
          kind: { type: 'string', enum: KINDS },
          box: {
            type: 'object',
            additionalProperties: false,
            required: ['x', 'y', 'width', 'height'],
            properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } },
          },
        },
      },
    },
    new_terms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'target', 'note'],
        properties: { source: { type: 'string' }, target: { type: 'string' }, note: { type: 'string' } },
      },
    },
  },
};

export class TranslationError extends Error {
  constructor(message, { status = 502, code = 'translation_failed', hint = '' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

let secrets = null;
let client = null;
let clientOverride = null;

/** Use a key store ({get, set, clear}) for a key typed into Settings. */
export function useSecrets(store) {
  secrets = store;
  client = null;
}

/** Where Claude credentials come from, without revealing them. A key saved in Settings wins. */
export function credentialStatus(env = process.env) {
  const saved = secrets?.get();
  if (saved) return { ok: true, source: 'saved in Settings', saved: true, hint: `…${saved.slice(-4)}` };
  if (env.ANTHROPIC_API_KEY) return { ok: true, source: 'ANTHROPIC_API_KEY', saved: false, hint: null };
  if (env.ANTHROPIC_AUTH_TOKEN) return { ok: true, source: 'ANTHROPIC_AUTH_TOKEN', saved: false, hint: null };
  if (env.ANTHROPIC_PROFILE) return { ok: true, source: `profile ${env.ANTHROPIC_PROFILE}`, saved: false, hint: null };
  return { ok: null, source: 'none found (add your key in Settings)', saved: false, hint: null };
}

export function getClient() {
  if (clientOverride) return clientOverride;
  if (!client) {
    const saved = secrets?.get();
    client = new Anthropic({ maxRetries: 2, timeout: 120_000, ...(saved ? { apiKey: saved, authToken: null } : {}) });
  }
  return client;
}

/** Forget the current client, so the next request picks up a changed key. */
export function resetClient() {
  client = null;
}

/** For tests: use a different client (null to go back to the real one). */
export function setClient(c) {
  clientOverride = c;
}

/** Check that the credentials work, with a free request (list one model). */
export async function testCredentials() {
  try {
    await getClient().models.list({ limit: 1 });
    return { ok: true };
  } catch (err) {
    const e = mapApiError(err);
    return { ok: false, error: e.message, hint: e.hint, code: e.code };
  }
}

/** Build the user turn: game facts, glossary and recent lines, then the screenshot. */
export function buildUserContent({ imageBase64, width, height, game, settings, glossary, recent }) {
  const lines = [
    `Game: ${game.title} (${game.systemName}${game.region ? `, ${game.region} release` : ''}).`,
    `Text on screen is probably in: ${game.sourceLanguage && game.sourceLanguage !== 'auto' ? game.sourceLanguage : 'unknown, detect it'}.`,
    `Translate into: ${settings.targetLanguage}.`,
    `Style: ${STYLES[settings.style] || STYLES.natural}`,
    `Screenshot size: ${width} x ${height} pixels.`,
  ];
  if (glossary.length) {
    lines.push('', 'Glossary (always use these):');
    for (const g of glossary.slice(0, 200)) lines.push(`- ${g.source} = ${g.target}${g.note ? ` (${g.note})` : ''}`);
  }
  if (recent.length) {
    lines.push('', 'Recent dialogue, oldest first (context only):');
    for (const r of recent) lines.push(`- ${r.speaker ? `${r.speaker}: ` : ''}${r.original} => ${r.translation}`);
  }
  if (game.notes) lines.push('', `Player notes about this game: ${game.notes}`);
  return [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } },
    { type: 'text', text: lines.join('\n') },
  ];
}

/** Clamp boxes to the image and convert them to fractions of the screen (0..1). */
export function normalizeResult(raw, width, height) {
  const lines = [];
  for (const l of Array.isArray(raw?.lines) ? raw.lines : []) {
    const original = String(l.original || '').trim();
    const translation = String(l.translation || '').trim();
    if (!original || !translation) continue;
    const b = l.box || {};
    let x = Number(b.x) || 0, y = Number(b.y) || 0, w = Number(b.width) || 0, h = Number(b.height) || 0;
    x = Math.min(Math.max(0, x), width); y = Math.min(Math.max(0, y), height);
    w = Math.min(Math.max(0, w), width - x); h = Math.min(Math.max(0, h), height - y);
    lines.push({
      original,
      translation,
      speaker: String(l.speaker || '').trim(),
      kind: KINDS.includes(l.kind) ? l.kind : 'other',
      box: w >= 2 && h >= 2 ? { x: x / width, y: y / height, w: w / width, h: h / height } : null,
    });
  }
  return {
    sourceLanguage: String(raw?.source_language || 'unknown'),
    lines,
    newTerms: (Array.isArray(raw?.new_terms) ? raw.new_terms : []).filter((t) => t && t.source && t.target),
  };
}

export function estimateCost(model, usage) {
  const p = MODELS[model];
  if (!p || !usage) return 0;
  const uncached = (usage.input_tokens || 0);
  const writes = (usage.cache_creation_input_tokens || 0) * p.input * 1.25;
  const reads = (usage.cache_read_input_tokens || 0) * p.cacheRead;
  return (uncached * p.input + writes + reads + (usage.output_tokens || 0) * p.output) / 1e6;
}

/**
 * Ask Claude to translate one screenshot.
 * @returns {Promise<{result: object, usage: object, model: string}>}
 */
export async function requestTranslation({ imageBase64, width, height, game, settings, glossary = [], recent = [] }) {
  const model = MODELS[settings.model] ? settings.model : 'claude-opus-5-5';
  const effort = EFFORTS.includes(settings.effort) ? settings.effort : 'low';
  const params = {
    model,
    max_tokens: 16000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    output_config: { effort, format: { type: 'json_schema', schema: RESULT_SCHEMA } },
    messages: [{ role: 'user', content: buildUserContent({ imageBase64, width, height, game, settings, glossary, recent }) }],
  };
  if (MODELS[model].fallbacks) {
    // If a safety classifier declines the screen, let the API retry on its recommended model.
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  let response;
  try {
    response = await getClient().beta.messages.create(params);
  } catch (err) {
    throw mapApiError(err);
  }
  if (response.stop_reason === 'refusal') {
    throw new TranslationError('Claude declined to translate this screen.', { status: 422, code: 'refusal', hint: response.stop_details?.explanation || '' });
  }
  if (response.stop_reason === 'max_tokens') {
    throw new TranslationError('The translation was cut off before it finished.', { code: 'max_tokens', hint: 'Try again, or translate a screen with less text.' });
  }
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new TranslationError('Claude returned a translation that could not be read.', { code: 'bad_output' });
  }
  return { result: normalizeResult(raw, width, height), usage: response.usage || {}, model: response.model || model };
}

function mapApiError(err) {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new TranslationError('Claude rejected the API credentials.', { status: 401, code: 'auth', hint: 'Check the API key in Settings.' });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new TranslationError('Too many translation requests right now.', { status: 429, code: 'rate_limit', hint: 'Wait a few seconds, or turn auto-translate off.' });
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new TranslationError(`Claude could not process the request: ${err.message}`, { status: 400, code: 'bad_request' });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new TranslationError('Could not reach the Claude API.', { status: 503, code: 'offline', hint: 'Check the internet connection.' });
  }
  if (err instanceof Anthropic.APIError) {
    return new TranslationError(`Claude API error ${err.status ?? ''}: ${err.message}`, { status: 502, code: 'api_error' });
  }
  if (/credentials|api key|apiKey|authToken/i.test(String(err?.message))) {
    return new TranslationError('No Claude API key yet.', { status: 401, code: 'auth', hint: 'Add your key in Settings (gear icon in the library).' });
  }
  return new TranslationError(String(err?.message || err), { code: 'unknown' });
}
