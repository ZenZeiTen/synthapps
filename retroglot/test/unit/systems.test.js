import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cueFiles, detectSystem, extOf, regionFromFile, sniffDisc, sniffPbp, systemFromZipNames, titleFromFile, zipEntries } from '../../src/systems.js';
import { makeZip } from '../helpers/zip.js';

test('extensions that name one system', () => {
  assert.equal(detectSystem('Game (J).sfc').system, 'snes');
  assert.equal(detectSystem('game.Z64').system, 'n64');
  assert.equal(detectSystem('HOSHI.COM').system, 'dos');
  assert.equal(detectSystem('a.gbc').system, 'gb');
  assert.equal(detectSystem('Game (Europe).nds').system, 'nds');
  assert.equal(detectSystem('game.cso').system, 'psp');
  assert.equal(detectSystem('a.gg').system, 'segaGG');
  assert.equal(detectSystem('readme.txt').system, null);
});

test('a .bin with a Mega Drive header is a cartridge, not a disc', () => {
  const head = Buffer.alloc(0x200);
  head.write('SEGA MEGA DRIVE ', 0x100, 'latin1');
  assert.deepEqual(detectSystem('sonic.bin', { head }).system, 'segaMD');
});

test('disc images are told apart by their first sectors', () => {
  const raw = (text, at) => { const b = Buffer.alloc(0x9400); b.write(text, at, 'latin1'); return b; };
  assert.equal(sniffDisc(raw('PLAYSTATION', 0x9320)), 'psx');
  assert.equal(sniffDisc(raw('SEGADISCSYSTEM  ', 0x10)), 'segaCD');
  assert.equal(sniffDisc(raw('SEGA SEGASATURN ', 0x10)), 'segaSaturn');
  const opera = Buffer.alloc(64); opera.set([1, 0x5a, 0x5a, 0x5a, 0x5a, 0x5a, 1], 0);
  assert.equal(sniffDisc(opera), '3do');
  assert.equal(detectSystem('x.cue').system, 'psx');
  assert.equal(detectSystem('x.cue').confidence, 'low');
  assert.equal(detectSystem('x.iso', { head: raw('SEGADISCSYSTEM', 0) }).system, 'segaCD');
});

test('zips are judged by the files inside', () => {
  const dos = makeZip({ 'GAME/START.EXE': 'MZ', 'GAME/DATA.DAT': 'x' });
  assert.deepEqual(zipEntries(dos), ['GAME/START.EXE', 'GAME/DATA.DAT']);
  assert.equal(detectSystem('game.zip', { head: dos, tail: dos }).system, 'dos');
  const nes = makeZip({ 'Zelda (J).nes': 'NES\x1a' });
  assert.equal(detectSystem('zelda.zip', { tail: nes }).system, 'nes');
  assert.equal(systemFromZipNames(['pacman.6e', 'pacman.6f']), 'arcade');
  assert.equal(systemFromZipNames(['disc.cue', 'disc.bin']), 'psx');
});

test('cue sheets list their data files', () => {
  const cue = 'FILE "Game (Track 1).bin" BINARY\r\n  TRACK 01 MODE2/2352\r\nFILE track2.bin BINARY\n';
  assert.deepEqual(cueFiles(cue), ['Game (Track 1).bin', 'track2.bin']);
});

test('titles and regions from file names', () => {
  assert.equal(titleFromFile('Some_Game (Japan) [!].sfc'), 'Some Game (Japan)');
  assert.equal(regionFromFile('Some Game (Japan).sfc'), 'JP');
  assert.equal(regionFromFile('Game (J) [!].nes'), 'JP');
  assert.equal(regionFromFile('Game (USA, Europe).md'), 'US');
  assert.equal(regionFromFile('Game.md'), null);
  assert.equal(extOf('a/b.tar.GZ'), 'gz');
});

/** An EBOOT.PBP whose PARAM.SFO has the given CATEGORY, optionally with a PS1 disc image in DATA.PSAR. */
function pbp(category, psarTag = '') {
  const sfo = Buffer.alloc(64);
  sfo.writeUInt32BE(0x00505346, 0); // "\0PSF"
  sfo.writeUInt32LE(0x101, 4);
  sfo.writeUInt32LE(20 + 16, 8); // key table after one entry
  sfo.writeUInt32LE(20 + 16 + 12, 12); // data table
  sfo.writeUInt32LE(1, 16);
  sfo.writeUInt16LE(0, 20); sfo.writeUInt16LE(0x0204, 22); sfo.writeUInt32LE(3, 24); sfo.writeUInt32LE(4, 28); sfo.writeUInt32LE(0, 32);
  sfo.write('CATEGORY\0', 36, 'latin1');
  sfo.write(category, 48, 'latin1');
  const head = Buffer.alloc(40);
  head.writeUInt32BE(0x00504250, 0); // "\0PBP"
  head.writeUInt32LE(0x10000, 4);
  head.writeUInt32LE(40, 8);
  const psar = Buffer.from(psarTag, 'latin1');
  head.writeUInt32LE(psar.length ? 40 + sfo.length : 0xffffff, 36);
  return Buffer.concat([head, sfo, psar]);
}

test('EBOOT.PBP files are told apart: PSP games and homebrew, or PlayStation games for the PSP', () => {
  assert.equal(sniffPbp(pbp('MG')), 'psp');
  assert.equal(sniffPbp(pbp('UG')), 'psp');
  assert.equal(sniffPbp(pbp('ME')), 'psx');
  assert.equal(sniffPbp(pbp('MG', 'PSISOIMG0000')), 'psx');
  assert.equal(sniffPbp(Buffer.from('not a pbp file at all, just some text here...')), null);
  assert.deepEqual(detectSystem('EBOOT.PBP', { head: pbp('ME') }).system, 'psx');
  assert.deepEqual(detectSystem('EBOOT.PBP', { head: pbp('UG') }).system, 'psp');
  assert.equal(detectSystem('EBOOT.PBP').system, 'psp');
});

test('a PSP disc image is recognised by its volume descriptor', () => {
  const iso = Buffer.alloc(2048 * 17);
  iso.write('\x01CD001\x01\x00PSP GAME', 2048 * 16, 'latin1');
  assert.equal(sniffDisc(iso), 'psp');
  assert.equal(detectSystem('Game (USA).iso', { head: iso }).system, 'psp');
  assert.equal(systemFromZipNames(['Game (Japan).nds']), 'nds');
});
