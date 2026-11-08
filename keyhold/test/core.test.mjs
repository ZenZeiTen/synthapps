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
