// Unit tests for the web client's core (no browser needed): node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from '../web/js/crypto.js';
import { parseTotp, totpCode } from '../web/js/totp.js';
import * as G from '../web/js/generator.js';
import * as M from '../web/js/model.js';
import * as I from '../web/js/importers.js';
import { MemoryStore, ConflictError } from '../web/js/storage.js';
import { Session } from '../web/js/session.js';

const FAST = { iterations: 1000, minIterations: 1000 };
const fast = { minIterations: 1000 };

test('vault round trip, wrong password, recovery code', async () => {
  const payload = M.emptyPayload();
  const { envelope, keys, recovery } = await C.createVault('correct horse battery staple', payload, FAST);
  assert.equal(envelope.format, 'keyhold-vault');
  assert.ok(!JSON.stringify(envelope).includes('autoLockMinutes'), 'contents must not be readable');
  const opened = await C.openVault(envelope, 'correct horse battery staple', fast);
  assert.deepEqual(opened.payload, payload);
  assert.equal(opened.keys.authKey, keys.authKey, 'same password gives the same sign-in key');
  await assert.rejects(C.openVault(envelope, 'wrong', fast), C.WrongPasswordError);
  assert.match(recovery.code, /^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
  const viaCode = await C.openVaultWithRecovery(envelope, recovery.code.toLowerCase().replace(/-/g, ' '));
  assert.deepEqual(viaCode.payload, payload);
  assert.notEqual(viaCode.keys.authKey, keys.authKey);
});

test('the sign-in key cannot open the vault and tampering is detected', async () => {
  const { envelope } = await C.createVault('pw-pw-pw-pw', { a: 1 }, FAST);
  const bad = structuredClone(envelope);
  const ct = C.b64.dec(bad.data.ct); ct[3] ^= 1; bad.data.ct = C.b64.enc(ct);
  const k = await C.openVault(envelope, 'pw-pw-pw-pw', fast);
  await assert.rejects(C.decryptPayload(bad, k.keys.dataKey));
  const swapped = structuredClone(envelope); swapped.id = 'another-vault';
  await assert.rejects(C.openVault(swapped, 'pw-pw-pw-pw', fast), C.WrongPasswordError);
  const weak = structuredClone(envelope); weak.kdf.iterations = 10;
  await assert.rejects(C.openVault(weak, 'pw-pw-pw-pw'), /Unsafe/);
});

test('changing the password keeps the data key and drops the old password', async () => {
  const { envelope } = await C.createVault('old password!', { x: 'y' }, FAST);
  const o = await C.openVault(envelope, 'old password!', fast);
  const { envelope: e2 } = await C.changePassword(envelope, o.keys, 'new password!', FAST);
  await assert.rejects(C.openVault(e2, 'old password!', fast));
  const o2 = await C.openVault(e2, 'new password!', fast);
  assert.deepEqual(o2.payload, { x: 'y' });
  assert.deepEqual([...o2.keys.dek], [...o.keys.dek]);
});

test('TOTP matches RFC 6238 test vectors', async () => {
  const b32 = (s) => C.base32Encode(new TextEncoder().encode(s));
  const cases = [
    ['SHA1', '12345678901234567890', 59, '94287082'],
    ['SHA1', '12345678901234567890', 1111111109, '07081804'],
    ['SHA256', '12345678901234567890123456789012', 59, '46119246'],
    ['SHA512', '1234567890123456789012345678901234567890123456789012345678901234', 59, '90693936'],
  ];
  for (const [alg, seed, t, want] of cases) {
    const cfg = parseTotp(`otpauth://totp/x?secret=${b32(seed)}&algorithm=${alg}&digits=8`);
    assert.equal((await totpCode(cfg, t * 1000)).code, want, alg + ' ' + t);
  }
  const plain = parseTotp('JBSW Y3DP EHPK 3PXP');
  assert.equal(plain.digits, 6);
  assert.throws(() => parseTotp('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP'));
});

test('generator: lengths, required classes, uniform choice', () => {
  for (let i = 0; i < 200; i++) {
    const p = G.generatePassword({ length: 16 });
    assert.equal(p.length, 16);
    assert.match(p, /[a-z]/); assert.match(p, /[A-Z]/); assert.match(p, /\d/); assert.match(p, /[^a-zA-Z0-9]/);
  }
  assert.doesNotMatch(G.generatePassword({ length: 200, avoidAmbiguous: true }), /[Il1O0o]/);
  const counts = new Array(10).fill(0);
  for (let i = 0; i < 20000; i++) counts[G.randomInt(10)]++;
  for (const c of counts) assert.ok(c > 1700 && c < 2300, 'roughly uniform: ' + counts);
  const words = readFileSync(new URL('../web/words/eff_large_wordlist.txt', import.meta.url), 'utf8').split('\n').map((l) => l.split('\t')[1]).filter(Boolean);
  assert.equal(words.length, 7776);
  const pp = G.generatePassphrase(words, { count: 5 });
  assert.equal(pp.split('-').length, 5);
  const dict = new Set(words);
  assert.ok(G.estimateStrength(pp, dict).score >= 3, pp);
});

test('strength estimate catches common patterns', () => {
  const dict = new Set(['monkey', 'dragon', 'sunshine', 'correct', 'horse', 'battery', 'staple']);
  for (const p of ['password', 'P@ssw0rd', 'qwerty123', '123456789', 'aaaaaaaaaaaa', 'abcdefghijkl', 'Sunshine2024!']) {
    assert.ok(G.estimateStrength(p, dict).score <= 1, p + ' ' + JSON.stringify(G.estimateStrength(p, dict)));
  }
  assert.equal(G.estimateStrength('k#9vQ!2mZr@7Lp$w', dict).score, 4);
  assert.ok(G.estimateStrength('correct horse battery staple', dict).bits < 30, 'only 4 words from a 7-word list');
});

test('edits keep history; search skips secrets', () => {
  const a = M.newItem('login', { title: 'Mail', fields: { username: 'amy', password: 'one' } });
  const b = M.applyEdit(a, { ...a, fields: { ...a.fields, password: 'two' } });
  assert.equal(b.history[0].value, 'one');
  assert.equal(b.id, a.id);
  assert.equal(M.search([b], 'mail amy').length, 1);
  assert.equal(M.search([b], 'two').length, 0, 'passwords are not searchable');
  assert.equal(M.safeUrl('javascript:alert(1)'), null);
  assert.equal(M.safeUrl('example.com/login'), 'https://example.com/login');
});

test('merge: newest edit wins, loser kept in history, purges stick', () => {
  const base = M.emptyPayload();
  const it = M.newItem('login', { title: 'Bank', fields: { password: 'base' } });
  base.items[it.id] = it;
  const left = structuredClone(base), right = structuredClone(base);
  left.items[it.id] = { ...it, fields: { password: 'left' }, updatedAt: '2030-01-01T00:00:00.000Z' };
  right.items[it.id] = { ...it, fields: { password: 'right' }, updatedAt: '2030-01-02T00:00:00.000Z' };
  const extra = M.newItem('note', { title: 'Only left' });
  left.items[extra.id] = extra;
  const m = M.mergePayloads(left, right);
  assert.equal(m.items[it.id].fields.password, 'right');
  assert.ok(m.items[it.id].history.some((h) => h.value === 'left'));
  assert.ok(m.items[extra.id]);
  assert.equal(M.stableStringify(M.mergePayloads(left, right)), M.stableStringify(M.mergePayloads(right, left)), 'order does not matter');
  const gone = structuredClone(m); delete gone.items[extra.id]; gone.purged[extra.id] = '2099-01-01T00:00:00.000Z';
  assert.equal(M.mergePayloads(m, gone).items[extra.id], undefined);
});

test('health report finds weak, reused and old passwords', () => {
  const items = [
    M.newItem('login', { title: 'a', fields: { password: 'password' } }),
    M.newItem('login', { title: 'b', fields: { password: 'Zq8#rT2!pL9@xV4m' } }),
    M.newItem('login', { title: 'c', fields: { password: 'Zq8#rT2!pL9@xV4m' } }),
    { ...M.newItem('login', { title: 'd', fields: { password: 'Kd93!sLq#29xBv7c' } }), passwordChangedAt: '2001-01-01T00:00:00.000Z' },
  ];
  const r = M.healthReport(items, (p) => G.estimateStrength(p));
  assert.equal(r.weak.length, 1);
  assert.equal(r.reused.length, 1);
  assert.equal(r.old.length, 1);
  assert.equal(r.score, 0);
});

const PWS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<passwordsafe delimiter="&#187;" Database="test.psafe3" FromDatabaseFormat="3.17">
  <entry id="1" normal="true">
    <group><![CDATA[Work.Clients\\.co]]></group>
    <title><![CDATA[Portal & <Admin>]]></title>
    <username><![CDATA[amy]]></username>
    <password><![CDATA[s3cr<et]]]]><![CDATA[>]]></password>
    <twofactorkey><![CDATA[JBSWY3DPEHPK3PXP]]></twofactorkey>
    <url><![CDATA[https://portal.example.com]]></url>
    <notes><![CDATA[line one»line two]]></notes>
    <ctimex>2020-01-02T03:04:05</ctimex>
    <pwhistory><status>1</status><max>3</max><num>1</num><history_entries>
      <history_entry num="1"><changedx>2019-05-05T00:00:00</changedx><oldpassword><![CDATA[old1]]></oldpassword></history_entry>
    </history_entries></pwhistory>
    <custom_fields><custom_field><name><![CDATA[PIN]]></name><value><![CDATA[1234]]></value><sensitive>1</sensitive></custom_field></custom_fields>
  </entry>
  <entry id="2"><title>Plain note</title><password></password><notes>just text</notes></entry>
</passwordsafe>`;

test('imports a Password Safe XML export', () => {
  const items = I.importPasswordSafeXML(PWS_XML);
  assert.equal(items.length, 2);
  const [a, b] = items;
  assert.equal(a.title, 'Portal & <Admin>');
  assert.equal(a.folder, 'Work/Clients.co');
  assert.equal(a.fields.password, 's3cr<et]]>');
  assert.equal(a.fields.totp, 'JBSWY3DPEHPK3PXP');
  assert.equal(a.notes, 'line one\nline two');
  assert.equal(a.history[0].value, 'old1');
  assert.deepEqual(a.custom[0], { name: 'PIN', value: '1234', hidden: true });
  assert.equal(b.type, 'note');
  assert.throws(() => I.parseXML('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>'), /DOCTYPE/);
});

test('CSV import from other managers and CSV export round trip', () => {
  const bw = 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n' +
    'Social,1,login,Twitter,"multi\nline",,0,https://twitter.com,amy,"pa,ss""word",\n';
  const [t] = I.importCSV(bw);
  assert.equal(t.title, 'Twitter'); assert.equal(t.folder, 'Social'); assert.equal(t.favorite, true);
  assert.equal(t.fields.password, 'pa,ss"word'); assert.equal(t.notes, 'multi\nline');
  const chrome = 'name,url,username,password\nsite,https://a.example,bob,pw\n';
  assert.equal(I.importCSV(chrome)[0].fields.username, 'bob');
  const it = M.newItem('login', { title: '=HYPERLINK("x")', fields: { username: 'u', password: '-starts-with-dash' } });
  const csv = I.exportCSV([it]);
  assert.match(csv, /"'=HYPERLINK/);
  const back = I.importCSV(csv)[0];
  assert.equal(back.fields.password, '-starts-with-dash', 'passwords are exported exactly');
});

test('session: saves, merges a second window, syncs two devices', async () => {
  const { MemoryStore: MS } = await import('../web/js/storage.js');
  const local = new MS();
  const { envelope, keys } = await C.createVault('device password', M.emptyPayload(), FAST);
  const s1 = new Session({ envelope, keys, payload: M.emptyPayload(), local });
  const a = M.newItem('login', { title: 'A', fields: { password: 'pa' } });
  await s1.upsert(a);
  assert.equal(local.rec.rev, 1);

  // A second window saves first; the first window merges instead of overwriting.
  const o2 = await C.openVault(local.rec.vault, 'device password', fast);
  const s2 = new Session({ envelope: local.rec.vault, keys: o2.keys, payload: o2.payload, local, localRev: 1 });
  await s2.upsert(M.newItem('note', { title: 'From window 2' }));
  await s1.upsert(M.newItem('note', { title: 'From window 1' }));
  const titles = s1.items().map((i) => i.title).sort();
  assert.deepEqual(titles, ['A', 'From window 1', 'From window 2']);

  // Fake sync server with the same contract as the real one.
  const server = new FakeServer();
  s1.remote = server.client(); s1.username = 'amy';
  server.vault = null;
  await server.register('amy', s1.keys.authKey, await s1.sealChecked());
  s1.meta.remoteRev = 1;
  const dev2Local = new MS();
  const o3 = await C.openVault(server.vault, 'device password', fast);
  const d2 = new Session({ envelope: server.vault, keys: o3.keys, payload: o3.payload, local: dev2Local, remote: server.client(), username: 'amy' });
  await d2.upsert(M.newItem('card', { title: 'Card on phone' }));
  await d2.sync();
  await s1.trash(a.id);
  await s1.sync();
  await d2.sync();
  assert.ok(d2.items().find((i) => i.id === a.id).deletedAt, 'trash synced');
  assert.ok(s1.items().find((i) => i.title === 'Card on phone'), 'card synced');
  assert.equal(M.stableStringify(s1.payload), M.stableStringify(d2.payload));

  // Password changed on device 2: device 1 is asked for the new one, then continues.
  await d2.changePassword('brand new password', FAST);
  s1.remote.token = null;
  await assert.rejects(s1.sync(), /changed on another device/);
  await s1.relogin('brand new password', fast);
  assert.equal(s1.status.state, 'synced');
  const reopened = await C.openVault(local.rec.vault, 'brand new password', fast);
  assert.equal(Object.keys(reopened.payload.items).length, 4);
});

// Minimal in-memory stand-in for the Go sync server.
class FakeServer {
  constructor() { this.rev = 0; this.vault = null; this.auth = null; this.tokens = new Set(); }
  async register(u, authKey, vault) { this.auth = authKey; this.vault = vault; this.rev = 1; }
  client() {
    const srv = this;
    const err = (status) => { const { RemoteError } = srvMods; return new RemoteError(status, 'x', 'x'); };
    return {
      token: null,
      async login(u, key) { if (key !== srv.auth) throw err(401); this.token = 't' + Math.random(); srv.tokens.add(this.token); },
      async prelogin() { return { kdf: srv.vault.kdf }; },
      async getVault() { if (!srv.tokens.has(this.token)) throw err(401); return { rev: srv.rev, vault: structuredClone(srv.vault) }; },
      async putVault(rev, vault) {
        if (!srv.tokens.has(this.token)) throw err(401);
        if (rev !== srv.rev) throw new ConflictError(srv.rev);
        srv.vault = structuredClone(vault); srv.rev++; return { rev: srv.rev };
      },
      async setKeys(b) {
        if (b.rev !== srv.rev) throw new ConflictError(srv.rev);
        if (b.authKey) { srv.auth = b.authKey; srv.tokens = new Set([this.token]); }
        srv.vault = structuredClone(b.vault); srv.rev++; return { rev: srv.rev };
      },
      async logout() {},
    };
  }
}
const srvMods = await import('../web/js/storage.js');

// ---------- features modelled on Password Safe's interface ----------
test('policies: minimum counts, custom symbols, hex, pronounceable', () => {
  for (let i = 0; i < 100; i++) {
    const p = G.generatePassword({ length: 16, minDigits: 4, minSymbols: 3, symbolSet: '#!', minUpper: 2 });
    assert.equal(p.length, 16);
    assert.ok((p.match(/\d/g) || []).length >= 4, p);
    assert.ok((p.match(/[#!]/g) || []).length >= 3, p);
    assert.doesNotMatch(p, /[^A-Za-z0-9#!]/, 'only the custom symbols: ' + p);
    assert.ok((p.match(/[A-Z]/g) || []).length >= 2, p);
  }
  assert.match(G.generatePassword({ length: 32, hex: true }), /^[0-9a-f]{32}$/);
  const pr = G.generatePassword({ length: 14, pronounceable: true, minDigits: 2, symbols: false });
  assert.equal(pr.length, 14);
  assert.ok((pr.match(/\d/g) || []).length >= 2);
  assert.throws(() => G.generatePassword({ length: 6, minDigits: 4, minSymbols: 4 }), /add up/);
});

test('history keeps the configured number; 0 keeps none', () => {
  let it = M.newItem('login', { fields: { password: 'p0' } });
  for (let i = 1; i <= 6; i++) it = M.applyEdit(it, { ...it, fields: { password: 'p' + i } }, { historyKeep: 3 });
  assert.deepEqual(it.history.map((h) => h.value), ['p5', 'p4', 'p3']);
  const none = M.applyEdit(it, { ...it, fields: { password: 'new' } }, { historyKeep: 0 });
  assert.equal(none.history.length, 0);
});

test('subset of password positions', () => {
  assert.deepEqual(M.parsePositions('1, 3,5', 8), [1, 3, 5]);
  assert.deepEqual(M.parsePositions('2-4 -1', 8), [2, 3, 4, 8]);
  assert.throws(() => M.parsePositions('9', 8), /between 1 and 8/);
  assert.throws(() => M.parsePositions('a', 8), /numbers/);
});

test('saved filters and settings defaults survive old vaults', () => {
  const old = { items: {}, settings: { autoLockMinutes: 1, policies: [{ id: 'x', name: 'PIN', length: 6, digits: true, lower: false, upper: false, symbols: false }] } };
  const p = M.normalizePayload(old);
  assert.equal(p.settings.autoLockMinutes, 1);
  assert.equal(p.settings.historyKeep, 30);
  assert.equal(p.settings.policies[0].minDigits, 1, 'policy filled from defaults');
  assert.match(G.generatePassword(p.settings.policies[0]), /^\d{6}$/);
  const items = [M.newItem('login', { title: 'Bank', folder: 'Finance/Banks', fields: { username: 'amy' } }), M.newItem('note', { title: 'Bank note', folder: 'Finance' })];
  assert.equal(M.applyFilter(items, { query: 'bank', type: 'login' }).length, 1);
  assert.equal(M.applyFilter(items, { folder: 'Finance' }).length, 2);
});

test('Password Safe XML export imports back into Password Safe format and into Keyhold', () => {
  const login = M.newItem('login', { title: 'Mail ]]> & <co>', folder: 'Work/v1.2', tags: ['x'], fields: { username: 'amy', password: 'p]]>w&<', url: 'https://m.example', email: 'a@m.example', totp: 'JBSWY3DPEHPK3PXP' }, notes: 'two\nlines', custom: [{ name: 'PIN', value: '12', hidden: true }], history: [{ value: 'old', changedAt: '2020-01-01T00:00:00.000Z' }], protected: true });
  const card = M.newItem('card', { title: 'Visa', fields: { cardholder: 'Amy', number: '4111111111111111', cvv: '123' } });
  const xml = I.exportPasswordSafeXML([login, card]);
  assert.match(xml, /<group><!\[CDATA\[Work\.v1\\\.2\]\]><\/group>/, 'dots inside a folder name are escaped');
  const back = I.importPasswordSafeXML(xml);
  assert.equal(back.length, 2);
  const [l, c] = back;
  assert.equal(l.title, login.title);
  assert.equal(l.folder, 'Work/v1.2');
  assert.equal(l.fields.password, 'p]]>w&<');
  assert.equal(l.fields.totp, 'JBSWY3DPEHPK3PXP');
  assert.equal(l.notes, 'two\nlines');
  assert.equal(l.history[0].value, 'old');
  assert.equal(l.protected, true);
  assert.ok(l.custom.find((x) => x.name === 'PIN' && x.hidden));
  assert.equal(c.fields.password, '4111111111111111', 'card number becomes the Password Safe password');
  assert.ok(c.custom.find((x) => x.name === 'Security code' && x.value === '123' && x.hidden));
  const rep = I.importReport(back);
  assert.equal(rep.total, 2); assert.equal(rep.withTotp, 1); assert.equal(rep.withHistory, 1);
});

test('read-only sessions refuse changes but still record last use', async () => {
  const local = new MemoryStore();
  const { envelope, keys } = await C.createVault('read only test', M.emptyPayload(), FAST);
  const s = new Session({ envelope, keys, payload: M.emptyPayload(), local });
  const it = M.newItem('login', { title: 'A', fields: { password: 'x' } });
  await s.upsert(it);
  await s.updateSettings({ trackAccess: true });
  s.readOnly = true;
  await assert.rejects(s.upsert({ ...it, title: 'B' }), /read-only/);
  await assert.rejects(s.trash(it.id), /read-only/);
  await s.touch(it.id);
  assert.ok(s.payload.items[it.id].accessedAt);
  assert.equal(s.payload.items[it.id].title, 'A');
});

// ---------- 1.2: fixes and features ----------
test('search filters: type, folder, tag, is, has, phrases and exclusions', () => {
  const past = new Date(Date.now() - 864e5).toISOString();
  const items = [
    M.newItem('login', { title: 'Work mail', folder: 'Work/Mail', tags: ['Office'], favorite: true, fields: { username: 'amy', password: 'hunter2', url: 'https://mail.example', totp: 'JBSWY3DPEHPK3PXP' } }),
    M.newItem('card', { title: 'Visa gold', folder: 'Money', fields: { number: '4111111111111111' }, notes: 'travel card', expiresAt: past }),
    M.newItem('note', { title: 'Door code draft', folder: 'Home', notes: 'two words here' }),
    M.newItem('login', { title: 'Old forum', tags: ['old'], fields: { username: 'amy', password: 'x' }, history: [{ value: 'w', changedAt: past }] }),
  ];
  const names = (q) => M.search(items, q).map((i) => i.title).sort();
  assert.deepEqual(names('type:card'), ['Visa gold']);
  assert.deepEqual(names('type:logins'), ['Old forum', 'Work mail']);
  assert.deepEqual(names('folder:work'), ['Work mail']);
  assert.deepEqual(names('folder:mail'), ['Work mail'], 'a nested folder is found by its own name');
  assert.deepEqual(names('tag:office amy'), ['Work mail']);
  assert.deepEqual(names('amy -tag:old'), ['Work mail']);
  assert.deepEqual(names('is:favorite'), ['Work mail']);
  assert.deepEqual(names('is:expired'), ['Visa gold']);
  assert.deepEqual(names('has:totp'), ['Work mail']);
  assert.deepEqual(names('has:history'), ['Old forum']);
  assert.deepEqual(names('has:notes -draft'), ['Visa gold']);
  assert.deepEqual(names('"two words"'), ['Door code draft']);
  assert.deepEqual(names('words two'), ['Door code draft'], 'plain words still match in any order');
  assert.deepEqual(names('https://mail.example'), ['Work mail'], 'a web address is text, not a filter');
  assert.equal(names('tag:').length, 4, 'a filter still being typed hides nothing');
  assert.deepEqual(names('hunter2'), [], 'secrets are never searched');
  assert.deepEqual(names('type:card is:favorite'), []);
  assert.deepEqual(M.applyFilter(items, { query: 'has:totp', type: 'login' }).map((i) => i.title), ['Work mail'], 'saved filters understand them too');
});

test('merge gives the same result in either order, also when settings tie', () => {
  const a = M.emptyPayload(), b = M.emptyPayload();
  a.settings = { ...a.settings, theme: 'dark', folders: ['B', 'A'], updatedAt: '2025-01-01T00:00:00.000Z' };
  b.settings = { ...b.settings, theme: 'light', folders: ['C'], updatedAt: '2025-01-01T00:00:00.000Z' };
  a.settings.vault = b.settings.vault;
  const ab = M.mergePayloads(a, b), ba = M.mergePayloads(b, a);
  assert.equal(M.stableStringify(ab), M.stableStringify(ba));
  assert.deepEqual(ab.settings.folders, ['A', 'B', 'C']);
  assert.deepEqual(a.settings.folders, ['B', 'A'], 'inputs are not changed');
  const byTime = M.sortItems([M.newItem('note', { title: 'x', updatedAt: '2025-01-01T00:00:00.000Z' }), M.newItem('note', { title: 'y', updatedAt: '2025-01-01T00:00:00.000Z' })], 'updated');
  assert.deepEqual(byTime.map((i) => i.title), ['x', 'y'], 'equal times keep their order');
});

test('import skips entries already in the vault; Keyhold CSV brings every item type back', () => {
  const vault = [
    M.newItem('card', { title: 'Visa', folder: 'Money', fields: { cardholder: 'Amy A', number: '4111 1111 1111 1111', expiry: '12/29', cvv: '123' }, custom: [{ name: 'Limit', value: '5000', hidden: false }] }),
    M.newItem('wifi', { title: 'Home', fields: { ssid: 'HomeNet', password: 'wifi-pass', security: 'WPA3' } }),
    M.newItem('identity', { title: 'Me', fields: { fullName: 'Amy A', email: 'amy@example.com', address: '1 Road\nTown' } }),
    M.newItem('login', { title: 'Mail', fields: { username: 'amy', password: 'pw', url: 'https://mail.example' }, notes: 'n' }),
  ];
  const back = I.importCSV(I.exportCSV(vault));
  assert.equal(back.length, 4);
  const card = back.find((i) => i.type === 'card');
  assert.deepEqual(card.fields, vault[0].fields, 'card details survive the round trip');
  assert.deepEqual(card.custom.map((c) => [c.name, c.value]), [['Limit', '5000']]);
  assert.equal(back.find((i) => i.type === 'wifi').fields.password, 'wifi-pass');
  assert.equal(back.find((i) => i.type === 'wifi').fields.ssid, 'HomeNet');
  assert.equal(back.find((i) => i.type === 'identity').fields.address, '1 Road\nTown', 'values over several lines stay whole');
  assert.equal(back.find((i) => i.type === 'identity').fields.email, 'amy@example.com');

  // Importing the same file again adds nothing; one changed entry is added.
  let r = M.dedupeImport(vault.filter((i) => i.type !== 'card'), back);
  assert.deepEqual(r.fresh.map((i) => i.title), ['Visa']);
  assert.equal(r.duplicates.length, 3);
  const changed = I.importCSV('name,url,username,password\nMail,https://mail.example,amy,OTHER\nMail,https://mail.example,amy,OTHER\n');
  r = M.dedupeImport(vault, changed);
  assert.equal(r.fresh.length, 1, 'a different password is a different entry; a repeat inside the file is not');
  assert.equal(r.duplicates.length, 1);
  assert.equal(M.dedupeImport([{ ...vault[3], deletedAt: M.now() }], I.importCSV(I.exportCSV([vault[3]]))).fresh.length, 1, 'items in the trash do not count');
  assert.equal(I.importCSV('url,username,password\nhttps://www.example.org/login,bob,pw\n')[0].title, 'www.example.org', 'no name column: the site name is used');
  assert.throws(() => I.parseXML('</a>'), /Mismatched/);
});

test('reminder dates keep their calendar day; old trash is found; a restored password leaves the history', () => {
  const d = new Date(2026, 11, 1); // local midnight, as the date field stores it
  assert.equal(M.localDay(d.toISOString()), '2026-12-01');
  assert.equal(M.localDay('nonsense'), '');
  const at = Date.parse('2026-06-30T00:00:00Z');
  const items = [
    M.newItem('note', { title: 'old', deletedAt: '2026-05-01T00:00:00Z' }),
    M.newItem('note', { title: 'recent', deletedAt: '2026-06-20T00:00:00Z' }),
    M.newItem('note', { title: 'live' }),
  ];
  assert.deepEqual(M.staleTrash(items, 30, at), [items[0].id]);
  assert.deepEqual(M.staleTrash(items, 0, at), [], '0 keeps the trash until it is emptied by hand');
  let it = M.newItem('login', { title: 'x', fields: { password: 'one' } });
  it = M.applyEdit(it, { ...it, fields: { password: 'two' } });
  it = M.applyEdit(it, { ...it, fields: { password: 'one' } });
  assert.deepEqual(it.history.map((h) => h.value), ['two'], 'the value in use is not also listed as a previous value');
  const odd = M.normalizeItem({ title: 't', tags: 'not-a-list', history: [null, { value: 5 }, { value: 'ok', changedAt: 'x' }], custom: [null, { name: 'a' }] });
  assert.deepEqual([odd.tags, odd.history.length, odd.custom.length], [[], 1, 1], 'badly shaped data is cleaned, not fatal');
  const rep = M.healthReport([M.newItem('login', { title: 'plain', fields: { password: 'Xk9$mQ2!vR7#pL4@wZ', url: 'http://shop.example' } }),
    M.newItem('login', { title: 'router', fields: { password: 'Xk9$mQ2!vR7#pL4@wY', url: 'http://192.168.1.1' } })], (pw) => G.estimateStrength(pw));
  assert.deepEqual(rep.insecure.map((e) => e.item.title), ['plain'], 'http sites are listed, devices on the home network are not');
});

test('session: locked vaults refuse work; trash clean-up; failed account sign-in and password change leave the vault as it was', async () => {
  const local = new MemoryStore();
  const { envelope, keys } = await C.createVault('local password', M.emptyPayload(), FAST);
  const s = new Session({ envelope, keys, payload: M.emptyPayload(), local });
  const keep = M.newItem('login', { title: 'Mine', fields: { password: 'p' } });
  await s.upsert(keep);
  await s.addItems([M.newItem('note', { title: 'gone', deletedAt: '2020-01-01T00:00:00.000Z' }), M.newItem('note', { title: 'fresh', deletedAt: M.now() })]);
  assert.equal(await s.purgeStaleTrash(30), 1);
  assert.deepEqual(s.items().map((i) => i.title).sort(), ['Mine', 'fresh']);
  assert.equal(Object.keys(s.payload.purged).length, 1, 'removed on every device');

  // A sync account whose server accepts sign-in but fails to store the merged vault.
  // Sign-in derives keys with the app's real minimum, so this account uses 100,000 rounds.
  const acct = await C.createVault('account password', M.emptyPayload(), { iterations: 100000 });
  const realFetch = globalThis.fetch;
  let failPut = true, stored = acct.envelope, rev = 1;
  globalThis.fetch = async (url, o = {}) => {
    const path = new URL(url).pathname, body = o.body ? JSON.parse(o.body) : null;
    const json = (status, data) => ({ ok: status < 300, status, json: async () => data });
    if (path === '/api/v1/prelogin') return json(200, { kdf: stored.kdf });
    if (path === '/api/v1/login') return body.authKey === acct.keys.authKey ? json(200, { token: 'tok' }) : json(401, { error: 'wrong_credentials' });
    if (path === '/api/v1/vault' && o.method === 'PUT') { if (failPut) return json(500, { error: 'write_failed', message: 'Could not save.' }); stored = body.vault; return json(200, { rev: ++rev }); }
    if (path === '/api/v1/vault') return json(200, { rev, vault: stored });
    if (path === '/api/v1/account/keys') return json(500, { error: 'write_failed', message: 'Could not save.' });
    return json(404, {});
  };
  try {
    const oldKeys = s.keys, before = M.stableStringify(s.payload);
    await assert.rejects(s.signInToAccount('http://localhost:9', 'amy', 'account password'), /Could not save/);
    assert.equal(s.keys, oldKeys, 'still on its own keys');
    assert.equal(s.remote, null);
    assert.equal(M.stableStringify(s.payload), before);
    await s.upsert({ ...keep, title: 'Mine, edited' });
    assert.equal((await C.openVault(local.rec.vault, 'local password', fast)).payload.items[keep.id].title, 'Mine, edited', 'the old password still opens it');

    failPut = false;
    await s.signInToAccount('http://localhost:9', 'amy', 'account password');
    assert.equal(s.username, 'amy');
    assert.ok((await C.openVault(local.rec.vault, 'account password')).payload.items[keep.id], 'now under the account password, items merged');
    assert.equal(s.settings.sync.username, 'amy');

    // The server refuses the new keys: the old password must keep working everywhere.
    const changedAt = s.settings.vault.passwordChangedAt;
    await assert.rejects(s.changePassword('another password', { iterations: 100000 }), /Could not save/);
    assert.equal(s.settings.vault.passwordChangedAt, changedAt, 'nothing recorded for a change that did not happen');
    await s.upsert({ ...s.payload.items[keep.id], title: 'After failed change' });
    assert.ok(await C.openVault(local.rec.vault, 'account password'));
  } finally { globalThis.fetch = realFetch; }

  clearTimeout(s.syncTimer);
  s.lock();
  await assert.rejects(s.upsert(keep), /locked/);
  await s.sync();
});
