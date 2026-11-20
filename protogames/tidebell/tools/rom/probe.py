"""Measure the source game's mechanics in an emulator (docs/ANALYSIS.md cites this).

The ROM is not part of this repository. Pass the path to your own copy:

    pip install stable-retro numpy
    python3 tools/rom/probe.py /path/to/rom.md

It boots the cartridge, drives the menus with the real pad (Start, then C), and
measures walking, jumping, attack timing and the health values through RAM.
Genesis Plus GX keeps 68000 RAM as byte-swapped 16-bit words, so word(a) reads
the word at 68000 address a the way the CPU sees it.
"""
import os
import shutil
import sys
import tempfile
import warnings

warnings.filterwarnings("ignore")
import numpy as np  # noqa: E402
import stable_retro as retro  # noqa: E402

BTN = ["B", "A", "MODE", "START", "UP", "DOWN", "LEFT", "RIGHT", "C", "Y", "X", "Z"]
X, VX, Y, VY, ANIM = 0xFF2142, 0xFF214A, 0xFF2156, 0xFF215E, 0xFF213C
HP, HP_SHOWN, HP_MAX, LIVES, DIFFICULTY = 0xFF0F66, 0xFF0F68, 0xFF0F6A, 0xFF0EF6, 0xFF0EB0


class Emu:
    def __init__(self, rom):
        d = tempfile.mkdtemp()
        path = os.path.join(d, "game.md")  # stable-retro picks the core by extension
        shutil.copy(rom, path)
        self.e = retro.RetroEmulator(path)
        self.gd = retro.data.GameData()
        self.e.configure_data(self.gd)

    def ram(self):
        self.gd.update_ram()
        return bytes(self.gd.memory.blocks[0xFF0000])

    def word(self, a, signed=False):
        r = self.ram()
        i = a - 0xFF0000
        v = r[i] | (r[i + 1] << 8)  # byte-swapped storage
        return v - 0x10000 if signed and v > 0x7FFF else v

    def fixed(self, a):  # 16.16 fixed point
        return self.word(a, True) + self.word(a + 2) / 65536

    def step(self, n=1, btn=()):
        m = np.zeros(12, np.uint8)
        for b in btn:
            m[BTN.index(b)] = 1
        for _ in range(n):
            self.e.set_button_mask(m, 0)
            self.e.step()

    def tap(self, b, after):
        self.step(2, (b,))
        self.step(after)


def boot_to_play(emu):
    emu.step(300)
    for _ in range(12):
        emu.tap("START", 60)
    for _ in range(12):
        emu.step(90)
        emu.tap("START", 30)
    for b in ["C", "C", "C", "C", "RIGHT", "C", "C", "C", "RIGHT", "C", "DOWN", "C"]:
        emu.step(4, (b,))
        emu.step(60)
    emu.step(30)
    return emu.e.get_state()


def main(rom):
    emu = Emu(rom)
    play = boot_to_play(emu)
    print("health %d / max %d, lives %d, difficulty %d" % (
        emu.word(HP), emu.word(HP_MAX), emu.word(LIVES) >> 8, emu.word(DIFFICULTY)))

    emu.e.set_state(play)
    vx = []
    for _ in range(10):
        emu.step(1, ("RIGHT",))
        vx.append(emu.fixed(VX))
    print("walk vx per frame:", [round(v, 4) for v in vx])
    emu.step(1)
    print("vx one frame after release:", emu.fixed(VX))

    emu.e.set_state(play)
    y0 = emu.word(Y)
    ys, vys = [], []
    for i in range(60):
        emu.step(1, ("B",) if i < 40 else ())
        ys.append(emu.fixed(Y))
        vys.append(emu.fixed(VY))
    air = sum(1 for y in ys if y < y0)
    print("jump: launch vy %.6f, gravity %.6f, height %.2f px, %d frames in the air" % (
        vys[1], vys[2] - vys[1], y0 - min(ys), air))

    for name, plan in [
        ("attack", lambda i: ("A",) if i < 2 else ()),
        ("attack every 10", lambda i: ("A",) if i % 10 < 2 else ()),
        ("crouch attack", lambda i: ("DOWN", "A") if i < 2 else ("DOWN",)),
        ("jump attack", lambda i: ("B",) if i < 2 else (("A",) if 8 <= i < 10 else ())),
    ]:
        emu.e.set_state(play)
        seq = []
        for i in range(40):
            emu.step(1, plan(i))
            seq.append(emu.word(ANIM))
        print("%-16s" % name, " ".join("%02x" % v for v in seq))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
