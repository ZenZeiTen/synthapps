import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectLanguage, splitSentences, tokenize } from '../core/text.js';
import { similarity, wordDiff, TmIndex, bandOf } from '../core/tm.js';
import { checkSegment, inconsistencies } from '../core/qa.js';
import { parseText, parseFile, readZip, docxText } from '../core/formats.js';
import { writeDocx } from '../core/docx.js';
import { JsonStore } from '../core/store.js';
import { Tms } from '../core/tms.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lintas-test-'));

test('language detection tells Indonesian from English and Malay', () => {
  assert.equal(detectLanguage('Saya tidak bisa datang ke kantor karena hujan sangat deras hari ini.').lang, 'id');
  assert.equal(detectLanguage('The translation memory stores every sentence that has been confirmed by the translator.').lang, 'en');
  assert.equal(detectLanguage('Saya tak boleh datang ke pejabat kerana hujan.').lang, 'ms');
  assert.equal(detectLanguage('これは日本語の文章です。').lang, 'ja');
});

test('sentence splitting respects abbreviations and Indonesian address forms', () => {
  const s = splitSentences('Yth. Bpk. Ahmad tiba pukul 10.30. Dia membawa dokumen. Dr. Smith ikut juga!', 'id');
  assert.deepEqual(s, ['Yth. Bpk. Ahmad tiba pukul 10.30.', 'Dia membawa dokumen.', 'Dr. Smith ikut juga!']);
});

test('tokenizer keeps reduplicated Indonesian words together', () => {
  assert.deepEqual(tokenize('anak-anak bermain', 'id').map(t => t.text), ['anak-anak', 'bermain']);
});

test('fuzzy matching scores and diffs', () => {
  assert.equal(similarity('Click Save to continue.', 'Click Save to continue.'), 100);
  assert.equal(similarity('Click Save to continue.', 'click save to continue'), 99);
  const s = similarity('Click Save to continue.', 'Click Cancel to continue.');
  assert.ok(s >= 60 && s < 95, String(s));
  const d = wordDiff('Click Save to continue.', 'Click Cancel to continue.');
  assert.deepEqual(d.filter(x => x.op !== 'eq').map(x => x.op + ':' + x.text), ['del:Save', 'ins:Cancel']);
  assert.equal(bandOf(101), '101%'); assert.equal(bandOf(87), '85-94%'); assert.equal(bandOf(10), 'No match');
});

test('TM index finds exact, context and fuzzy matches', () => {
  const ix = new TmIndex({ units: [] });
  ix.add('Open the settings page.', 'Buka halaman pengaturan.', { context: 'Welcome.' });
  ix.add('Close the settings page.', 'Tutup halaman pengaturan.');
  assert.equal(ix.lookup('Open the settings page.', { context: 'Welcome.' })[0].score, 101);
  assert.equal(ix.lookup('Open the settings page.')[0].score, 100);
  const fz = ix.lookup('Open the settings menu.');
  assert.equal(fz[0].unit.target, 'Buka halaman pengaturan.');
  assert.ok(fz[0].score < 100);
});

test('QA checks catch numbers, placeholders, tags and terms', () => {
  const issues = checkSegment({ id: 's1', source: 'You have {count} new messages in <b>3</b> folders.', target: 'Anda punya pesan baru di <b>4</b> folder', status: 'translated' },
    { terms: [{ source: 'messages', target: 'pesan', status: 'preferred' }, { source: 'folders', target: 'folder', status: 'forbidden' }] });
  const checks = issues.map(i => i.check).sort();
  assert.deepEqual(checks, ['end-punctuation', 'number-mismatch', 'placeholder-mismatch', 'term-forbidden']);
  assert.equal(checkSegment({ id: 's2', source: 'Price: 1,000.50', target: 'Harga: 1.000,50', status: 'translated' }).length, 0);
  assert.equal(inconsistencies([{ id: 'a', source: 'Save', target: 'Simpan' }, { id: 'b', source: 'Save', target: 'Menyimpan' }]).length, 1);
});

test('parsers: PO, XLIFF, JSON, SRT, CSV', () => {
  const po = parseText('po', 'msgid ""\nmsgstr ""\n"Language: id\\n"\n\n#. button\nmsgctxt "nav"\nmsgid "Home"\nmsgstr "Beranda"\n\nmsgid "About \\"us\\""\nmsgstr ""\n');
  assert.equal(po.targetLang, 'id');
  assert.deepEqual(po.units.map(u => [u.text, u.target, u.key]), [['Home', 'Beranda', 'nav'], ['About "us"', '', null]]);
  const x = parseText('xliff', '<xliff version="1.2"><file source-language="en" target-language="id"><body><trans-unit id="a"><source>Hello <g id="1">world</g></source><target>Halo <g id="1">dunia</g></target></trans-unit></body></file></xliff>');
  assert.equal(x.units[0].text, 'Hello {1}world{/}');
  assert.equal(x.sourceLang, 'en');
  assert.deepEqual(parseText('json', '{"a":{"b":"Save","c":["One","Two"]}}').units.map(u => u.key), ['a.b', 'a.c.0', 'a.c.1']);
  const srt = parseText('srt', '1\n00:00:01,000 --> 00:00:02,000\nHalo dunia\n\n2\n00:00:03,000 --> 00:00:04,000\nApa kabar?\n');
  assert.equal(srt.units[1].text, 'Apa kabar?');
  const csv = parseText('csv', 'en,id\nSave,Simpan\n"Hello, world","Halo, dunia"\n');
  assert.equal(csv.units[1].target, 'Halo, dunia');
  assert.equal(csv.targetLang, 'id');
});

test('docx round trip', () => {
  const buf = writeDocx(['Paragraf pertama.', 'Kedua & "ketiga".']);
  assert.ok(readZip(buf)['word/document.xml']);
  assert.equal(docxText(buf), 'Paragraf pertama.\n\nKedua & "ketiga".');
  assert.equal(parseFile('x.docx', buf).text, 'Paragraf pertama.\n\nKedua & "ketiga".');
});

test('TMS workflow: project, import, confirm to TM, lookup, pretranslate, analysis, QA, export', () => {
  const dir = tmp();
  const store = new JsonStore(dir, { delay: 0 });
  const tms = new Tms(store);
  const p = tms.createProject({ name: 'Website', sourceLang: 'en', targetLang: 'id' });
  const f = tms.importText(p.id, { name: 'home.txt', text: 'Open the settings page. Save your work.\n\nOpen the settings page.' });
  assert.equal(f.stats.segments, 3);
  const file = tms.getFile(p.id, f.id);
  const [s1, s2, s3] = file.segments;
  assert.throws(() => tms.updateSegment(p.id, f.id, s1.id, { status: 'translated' }), /Add a translation/);
  tms.updateSegment(p.id, f.id, s1.id, { target: 'Buka halaman pengaturan.', status: 'translated' });
  const look = tms.lookup(p.id, 'Open the settings page.');
  assert.equal(look.matches[0].score, 100);
  const tb = tms.getProject(p.id).termbaseIds[0];
  tms.addTerm(tb, { source: 'settings', target: 'pengaturan', status: 'preferred' });
  assert.equal(tms.lookup(p.id, 'Change the settings.').terms[0].target, 'pengaturan');
  const pre = tms.pretranslate(p.id, f.id);
  assert.equal(pre.fromTm, 1);
  assert.equal(tms.getFile(p.id, f.id).segments[2].target, 'Buka halaman pengaturan.');
  const an = tms.analyze(p.id);
  assert.equal(an.bands.reduce((a, b) => a + b.segments, 0), 3);
  tms.updateSegment(p.id, f.id, s2.id, { target: 'Simpan pekerjaan Anda', status: 'translated' });
  const qa = tms.qa(p.id, f.id);
  assert.ok(qa.issues.some(i => i.check === 'end-punctuation'));
  const out = tms.exportFile(p.id, f.id, 'original');
  assert.equal(out.data, 'Buka halaman pengaturan. Simpan pekerjaan Anda\n\nBuka halaman pengaturan.\n');
  assert.match(tms.exportFile(p.id, f.id, 'xliff').data, /<target>Simpan pekerjaan Anda<\/target>/);
  store.flushAll();
  const again = new Tms(new JsonStore(dir));
  assert.equal(again.dashboard().projects[0].stats.byStatus.translated, 3);
  assert.ok(s3);
});
