// A tiny Nintendo DS program for tests, written for retroglot (MIT).
// The ARM9 code turns on the LCDs and 2D engine A (shown on the lower screen), maps VRAM
// bank A for direct display and fills it with horizontal colour bands; the ARM7 waits.
// Assembled from (ARM mode, ARMv5):
//   mov r0,#0x04000000; orr r0,r0,#0x300; orr r0,r0,#4; mov r1,#3; strh r1,[r0]      @ POWCNT1
//   mov r0,#0x04000000; mov r1,#0x20000; str r1,[r0]                                 @ DISPCNT: VRAM display
//   mov r0,#0x04000000; orr r0,r0,#0x240; mov r1,#0x80; strb r1,[r0]                @ VRAMCNT_A: LCDC
//   mov r0,#0x06800000; mov r2,#0
// y: mov r3,r2,lsr #3; and r3,r3,#31; rsb r4,r3,#31; orr r5,r3,r4,lsl #5
//    orr r5,r5,#0x4000; orr r5,r5,#0x8000; mov r6,#256
// x: strh r5,[r0],#2; subs r6,r6,#1; bne x; add r2,r2,#1; cmp r2,#192; bne y
// d: b d
const ARM9 = Buffer.from(
  '0103a0e3030c80e3040080e30310a0e3b010c0e10103a0e30218a0e3001080e50103a0e3090d80e38010a0e3'
  + '0010c0e51a05a0e30020a0e3a231a0e11f3003e21f4063e2845283e1015985e3025985e3016ca0e3b250c0e0'
  + '016056e2fcffff1a012082e2c00052e3f2ffff1afeffffea', 'hex');
const ARM7 = Buffer.from('feffffea', 'hex'); // b .

function crc16(buf) {
  let crc = 0xffff;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

/** The colour (r, g, b, 0..255) the program draws on row `y` (0..191) of the lower screen. */
export function ndsBandColor(y) {
  const v = (y >> 3) & 31;
  const to8 = (c) => Math.round((c * 255) / 31);
  return [to8(v), to8(31 - v), to8(16)];
}

/** A 64 KB .nds image. The code sits past the secure area (0x4000..0x7fff), which emulators decrypt. */
export function makeNds() {
  const rom = Buffer.alloc(0x10000);
  rom.write('RETROGLOTDS', 0, 'latin1');
  rom.write('RGDS00', 0x0c, 'latin1');
  rom.writeUInt32LE(0x8000, 0x20); rom.writeUInt32LE(0x02000000, 0x24); rom.writeUInt32LE(0x02000000, 0x28); rom.writeUInt32LE(ARM9.length, 0x2c);
  rom.writeUInt32LE(0x9000, 0x30); rom.writeUInt32LE(0x02380000, 0x34); rom.writeUInt32LE(0x02380000, 0x38); rom.writeUInt32LE(ARM7.length, 0x3c);
  rom.writeUInt32LE(rom.length, 0x80); rom.writeUInt32LE(0x4000, 0x84);
  rom.writeUInt16LE(crc16(rom.subarray(0, 0x15e)), 0x15e);
  ARM9.copy(rom, 0x8000);
  ARM7.copy(rom, 0x9000);
  return rom;
}
