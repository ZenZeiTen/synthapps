import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cueFiles, detectSystem, extOf, regionFromFile, sniffDisc, systemFromZipNames, titleFromFile, zipEntries } from '../../src/systems.js';
import { makeZip } from '../helpers/zip.js';

test('extensions that name one system', () => {
  assert.equal(detectSystem('Game (J).sfc').system, 'snes');
  assert.equal(detectSystem('game.Z64').system, 'n64');
  assert.equal(detectSystem('HOSHI.COM').system, 'dos');
  assert.equal(detectSystem('a.gbc').system, 'gb');
  assert.equal(detectSystem('a.pbp').system, 'psx');
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
