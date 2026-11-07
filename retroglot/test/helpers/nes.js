// Tiny NES programs for tests, written for retroglot (MIT).

/**
 * An MMC1 cartridge with battery-backed RAM at $6000. At power-on it copies byte 1 of the
 * save RAM to byte 2, writes 0x42 to byte 0 and adds one to byte 3 (a boot counter), then waits.
 */
export function makeBatteryNes() {
  const code = [0x78, 0xad, 0x01, 0x60, 0x8d, 0x02, 0x60, 0xa9, 0x42, 0x8d, 0x00, 0x60, 0xee, 0x03, 0x60, 0x4c, 0x0f, 0x80];
  const prg = Buffer.alloc(16384);
  Buffer.from(code).copy(prg, 0);
  for (const v of [0x3ffa, 0x3ffc, 0x3ffe]) prg.writeUInt16LE(0x8000, v);
  const header = Buffer.from([0x4e, 0x45, 0x53, 0x1a, 1, 1, 0x12, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // mapper 1, battery
  return Buffer.concat([header, prg, Buffer.alloc(8192)]);
}
