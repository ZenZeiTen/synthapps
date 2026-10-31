import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { TranslationMemory, exportScript, languageCode } from '../../src/memory.js';
import { Store, freePath, safeFileName } from '../../src/store.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'retroglot-test-'));

test('scan lists games and folds cue sheets together with their bins', () => {
  const home = tmp();
  const store = new Store(home);
  const lib = store.dirs.library;
  fs.writeFileSync(path.join(lib, 'Hero (J).sfc'), Buffer.alloc(1024));
  fs.mkdirSync(path.join(lib, 'disc'));
  const track = Buffer.alloc(0x9400);
  track.write('PLAYSTATION', 0x9320, 'latin1');
  fs.writeFileSync(path.join(lib, 'disc', 'Quest (Track 1).bin'), track);
  fs.writeFileSync(path.join(lib, 'disc', 'Quest.cue'), 'FILE "Quest (Track 1).bin" BINARY\n  TRACK 01 MODE2/2352\n');
  fs.writeFileSync(path.join(lib, 'notes.txt'), 'not a game');
  const r = store.scan();
  assert.equal(r.total, 2);
  const games = store.list().sort((a, b) => a.title.localeCompare(b.title));
  assert.deepEqual(games.map((g) => [g.title, g.system]), [['Hero (J)', 'snes'], ['Quest', 'psx']]);
  assert.deepEqual(games[1].extraFiles, ['Quest (Track 1).bin']);
  assert.equal(games[1].detection.reason, 'disc header');
  assert.equal(games[0].sourceLanguage, 'Japanese');
  // Deleting a file drops it from the library on the next scan.
  fs.rmSync(path.join(lib, 'Hero (J).sfc'));
  assert.equal(store.scan().removed, 1);
  // Settings and games survive a restart.
  store.update(store.list()[0].id, { favorite: true, title: 'Quest!' });
  const again = new Store(home);
  assert.equal(again.list()[0].title, 'Quest!');
  assert.equal(again.list()[0].favorite, true);
});

test('uploads never overwrite and refuse non-game files', async () => {
  const store = new Store(tmp());
  const a = await store.importStream('../../evil/Game.nes', Readable.from([Buffer.from('NES\x1a')]));
  const b = await store.importStream('Game.nes', Readable.from([Buffer.from('NES\x1a')]));
  assert.equal(path.dirname(a.file), store.dirs.library);
  assert.notEqual(a.file, b.file);
  assert.match(path.basename(b.file), /^Game-2\.nes$/);
  await assert.rejects(store.importStream('run.sh', Readable.from([Buffer.from('x')])), /Not a game file/);
  assert.equal(safeFileName('a<b>:c?.sfc'), 'a_b__c_.sfc');
  const p = path.join(store.dirs.library, 'Game.nes');
  assert.equal(freePath(p), path.join(store.dirs.library, 'Game-3.nes'));
});

test('save states keep their picture and slot number', () => {
  const store = new Store(tmp());
  const meta = store.writeSave('abcabcabcabc', 3, Buffer.from('STATE'), Buffer.from('PNG'));
  assert.equal(meta.slot, 3);
  assert.equal(fs.readFileSync(store.savePath('abcabcabcabc', 3)).toString(), 'STATE');
  assert.deepEqual(store.listSaves('abcabcabcabc').map((s) => s.slot), [3]);
  assert.throws(() => store.writeSave('abcabcabcabc', 100, Buffer.from('x')), /0\.\.99/);
  store.deleteSave('abcabcabcabc', 3);
  assert.deepEqual(store.listSaves('abcabcabcabc'), []);
});

test('settings are checked', () => {
  const store = new Store(tmp());
  assert.equal(store.updateSettings({ targetLanguage: 'Indonesian' }).targetLanguage, 'Indonesian');
  assert.throws(() => store.updateSettings({ nope: 1 }), /Unknown setting/);
  assert.throws(() => store.updateSettings({ autoTranslate: 'yes' }), /must be a boolean/);
});

test('BIOS files are found by their usual names, in any letter case', () => {
  const store = new Store(tmp());
  fs.writeFileSync(path.join(store.dirs.bios, 'SCPH5501.BIN'), 'x');
  assert.equal(path.basename(store.biosFor('psx')), 'SCPH5501.BIN');
  assert.equal(store.biosFor('snes'), null);
});

test('translation memory: script, glossary and screen cache', () => {
  const file = path.join(tmp(), 'm.json');
  const m = new TranslationMemory(file);
  m.addLines([{ original: 'ようこそ', translation: 'Welcome', speaker: 'Elder', kind: 'dialogue' }], 'English');
  m.addLines([{ original: 'ようこそ', translation: 'Welcome', speaker: 'Elder', kind: 'dialogue' }], 'English');
  assert.equal(m.lines.length, 1, 'a line still on screen is not added twice');
  m.addTerms([{ source: '星降る村', target: 'Starfall Village' }], 'suggested');
  m.addTerms([{ source: 'リナ', target: 'Lina' }], 'user');
  m.addTerms([{ source: 'リナ', target: 'Rina' }], 'suggested');
  assert.equal(m.glossary.find((g) => g.source === 'リナ').target, 'Lina', 'a suggestion never replaces the user’s term');
  m.rememberScreen('h1', { lines: [] });
  assert.deepEqual(m.cachedScreen('h1'), { lines: [] });
  assert.equal(m.cachedScreen('h2'), null);
  m.addUsage({ input_tokens: 1000, output_tokens: 100 }, 0.006);
  m.save();
  const again = new TranslationMemory(file);
  assert.equal(again.lines.length, 1);
  assert.equal(again.glossary.length, 2);
  assert.equal(again.usage.requests, 1);
  assert.equal(again.usage.cachedScreens, 1);
});

test('script export: CSV quoting, TMX escaping, plain text', () => {
  const m = new TranslationMemory(path.join(tmp(), 'm.json'));
  m.addLines([{ original: '「A&B」<x>', translation: 'Say "hi", friend', speaker: 'Lina', kind: 'dialogue' }], 'Indonesian');
  const csv = exportScript(m, 'csv').body;
  assert.match(csv, /"Say ""hi"", friend"/);
  const tmx = exportScript(m, 'tmx', { sourceLanguage: 'Japanese', title: 'T&T' }).body;
  assert.match(tmx, /srclang="ja"/);
  assert.match(tmx, /<tuv xml:lang="id"><seg>Say &quot;hi&quot;, friend<\/seg>/);
  assert.match(tmx, /<seg>「A&amp;B」&lt;x&gt;<\/seg>/);
  assert.match(tmx, /T&amp;T/);
  assert.match(exportScript(m, 'txt', { title: 'Demo' }).body, /Lina: Say "hi", friend/);
  assert.equal(languageCode('Brazilian Portuguese'), 'pt-BR');
  assert.equal(languageCode('Klingon'), 'und');
});
