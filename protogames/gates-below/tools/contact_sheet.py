"""Preview helper: tile each texture 2x2 (seam check) at 3x zoom on one sheet."""
import glob, os, sys
from PIL import Image, ImageDraw
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
d = sys.argv[1] if len(sys.argv) > 1 else "textures"
out = sys.argv[2] if len(sys.argv) > 2 else "/tmp/claude-0/sheet.png"
tile = "--tile" in sys.argv
zoom = 3
files = sorted(glob.glob(os.path.join(ROOT, "godot", "content", d, "*.png")))
cells = []
for f in files:
    im = Image.open(f).convert("RGBA")
    h = im.height
    fr = im.crop((0, 0, min(im.width, h if im.width > h * 1.5 else im.width), h))
    if tile:
        t = Image.new("RGBA", (fr.width * 2, fr.height * 2), (40, 40, 60, 255))
        for i in range(2):
            for j in range(2):
                t.alpha_composite(fr, (i * fr.width, j * fr.height))
        fr = t
    bg = Image.new("RGBA", fr.size, (60, 50, 70, 255)); bg.alpha_composite(fr)
    cells.append((os.path.basename(f)[:-4], bg.resize((bg.width * zoom, bg.height * zoom), Image.NEAREST)))
cw = max(c[1].width for c in cells) + 8; ch = max(c[1].height for c in cells) + 18
cols = 6
sheet = Image.new("RGB", (cw * cols, ch * ((len(cells) + cols - 1) // cols)), (20, 20, 24))
dr = ImageDraw.Draw(sheet)
for i, (n, im) in enumerate(cells):
    x, y = (i % cols) * cw, (i // cols) * ch
    sheet.paste(im, (x + 4, y + 14)); dr.text((x + 4, y + 2), n, fill=(220, 220, 220))
sheet.save(out); print(out, sheet.size)
