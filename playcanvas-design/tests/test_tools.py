"""Offline tests for the playcanvas-design tools (no browser, GPU or Blender needed).

Run from the repository root:
    python -m unittest discover -s playcanvas-design/tests -t playcanvas-design
"""
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.join(HERE, '..', 'plugins', 'playcanvas-design', 'skills', 'playcanvas-design')
SCRIPTS = os.path.join(SKILL, 'scripts')


def run_py(script, *args):
    return subprocess.run([sys.executable, os.path.join(SCRIPTS, script), *map(str, args)],
                          capture_output=True, text=True)


def write_frames(folder, n, fps=30, size=(64, 48), alpha=False, draw=None, manifest=True, extra=0):
    """Frames like render.mjs writes them: frame_00000.png ... plus manifest.json."""
    os.makedirs(folder, exist_ok=True)
    for i in range(n):
        im = Image.new('RGBA', size, (0, 0, 0, 0) if alpha else (20, 22, 30, 255))
        (draw or default_draw)(ImageDraw.Draw(im), i, n, size)
        im.save(os.path.join(folder, f'frame_{i:05d}.png'))
    if manifest:
        with open(os.path.join(folder, 'manifest.json'), 'w', encoding='utf-8') as fh:
            json.dump({'ok': True, 'fps': fps, 'frames': n, 'extra': extra, 'alpha': alpha}, fh)


def load_json(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def default_draw(d, i, n, size):
    # a box that moves along a closed circle: frame n would equal frame 0 (a true loop)
    w, h = size
    a = 2 * math.pi * (i % n) / n   # i % n: frame n is exactly frame 0
    cx, cy = w / 2 + math.cos(a) * w / 4, h / 2 + math.sin(a) * h / 4
    d.rectangle([cx - 6, cy - 6, cx + 6, cy + 6], fill=(240, 120, 40, 255))


class SpriteSheetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_playcanvas_rects_count_y_from_bottom(self):
        frames = os.path.join(self.tmp, 'f')
        write_frames(frames, 6, alpha=True)
        out = os.path.join(self.tmp, 'sheet.png')
        r = run_py('spritesheet.py', frames, out, '--cols', 3)
        self.assertEqual(r.returncode, 0, r.stderr)
        meta = load_json(os.path.join(self.tmp, 'sheet.json'))
        pcf = load_json(os.path.join(self.tmp, 'sheet.playcanvas.json'))['frames']
        H = meta['size'][1]
        sheet = Image.open(out)
        for i, f in enumerate(meta['frames']):
            x, y, w, h = pcf[str(i)]['rect']
            self.assertEqual((x, w, h), (f['x'], f['w'], f['h']))
            self.assertEqual(y, H - f['y'] - f['h'])          # bottom-up
            src = Image.open(os.path.join(frames, f'frame_{i:05d}.png'))
            cell = sheet.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']))
            self.assertEqual(cell.tobytes(), src.tobytes())

    def test_names_per_frame_and_rows(self):
        frames = os.path.join(self.tmp, 'f')
        write_frames(frames, 4, alpha=True)
        r = run_py('spritesheet.py', frames, os.path.join(self.tmp, 's.png'), '--names', 'S,W,N,E', '--cols', 4)
        self.assertEqual(r.returncode, 0, r.stderr)
        names = [f['name'] for f in load_json(os.path.join(self.tmp, 's.json'))['frames']]
        self.assertEqual(names, ['S', 'W', 'N', 'E'])
        r = run_py('spritesheet.py', frames, os.path.join(self.tmp, 's2.png'), '--names', 'S,N', '--per-row', 2)
        self.assertEqual(r.returncode, 0, r.stderr)
        names = [f['name'] for f in load_json(os.path.join(self.tmp, 's2.json'))['frames']]
        self.assertEqual(names, ['S_0', 'S_1', 'N_0', 'N_1'])
        r = run_py('spritesheet.py', frames, os.path.join(self.tmp, 's3.png'), '--names', 'S,W,N')
        self.assertNotEqual(r.returncode, 0)

    def test_cell_overflow_is_an_error_and_fit_scales(self):
        frames = os.path.join(self.tmp, 'f')
        write_frames(frames, 2, size=(64, 48))
        r = run_py('spritesheet.py', frames, os.path.join(self.tmp, 'c.png'), '--cell', '32x32')
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('cropped', r.stdout + r.stderr)
        r = run_py('spritesheet.py', frames, os.path.join(self.tmp, 'c.png'), '--cell', '32x32', '--fit')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(load_json(os.path.join(self.tmp, 'c.json'))['cell'], [32, 32])


class EncodeTimingTests(unittest.TestCase):
    """Animated images must play for exactly frames / fps (GIF stores centiseconds)."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.frames = os.path.join(self.tmp, 'f')
        write_frames(self.frames, 30, fps=30)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def total_ms(self, path):
        if path.endswith('.webp'):
            b = open(path, 'rb').read()
            i, total = 12, 0
            while i + 8 <= len(b):
                tag, size = b[i:i + 4], struct.unpack('<I', b[i + 4:i + 8])[0]
                if tag == b'ANMF':
                    total += int.from_bytes(b[i + 20:i + 23], 'little')
                i += 8 + size + (size & 1)
            return total
        im = Image.open(path)
        total = 0
        for k in range(im.n_frames):
            im.seek(k)
            total += im.info.get('duration', 0)
        return total

    def check(self, ext, fps=None, expected=1000):
        out = os.path.join(self.tmp, 'o' + ext)
        args = [self.frames, out] + (['--fps', fps] if fps else [])
        r = run_py('encode.py', *args)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn('MISMATCH', r.stdout)
        self.assertAlmostEqual(self.total_ms(out), expected, delta=1)

    def test_gif_30fps(self):
        self.check('.gif')

    def test_gif_24fps(self):
        self.check('.gif', fps=24, expected=1250)

    def test_webp(self):
        self.check('.webp')

    def test_apng(self):
        self.check('.apng')

    def test_extra_frames_are_dropped(self):
        f = os.path.join(self.tmp, 'x')
        write_frames(f, 31, fps=30, extra=1)
        out = os.path.join(self.tmp, 'x.gif')
        r = run_py('encode.py', f, out)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(Image.open(out).n_frames, 30)


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_clean_render_passes(self):
        f = os.path.join(self.tmp, 'ok')
        write_frames(f, 20)
        r = run_py('review.py', f, '--out', os.path.join(self.tmp, 'c.png'))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertTrue(os.path.exists(os.path.join(self.tmp, 'c.png')))

    def test_missing_frame_fails(self):
        f = os.path.join(self.tmp, 'miss')
        write_frames(f, 20)
        os.remove(os.path.join(f, 'frame_00007.png'))
        r = run_py('review.py', f)
        self.assertEqual(r.returncode, 1)
        self.assertIn('MISSING', r.stdout)

    def test_blank_and_frozen_are_reported(self):
        f = os.path.join(self.tmp, 'bf')
        write_frames(f, 10, draw=lambda d, i, n, s: None if i in (3, 4, 5) else default_draw(d, i, n, s))
        r = run_py('review.py', f)
        self.assertIn('blank frames: [3, 4, 5]', r.stdout)
        self.assertIn('(3, 5)', r.stdout)

    def test_loop_seamless_with_extra_frame(self):
        f = os.path.join(self.tmp, 'loop')
        n = 24
        # render n + 1 frames of an n-frame loop: frame n == frame 0
        write_frames(f, n + 1, extra=1, draw=lambda d, i, _n, s: default_draw(d, i, n, s))
        r = run_py('review.py', f, '--loop')
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn('IDENTICAL', r.stdout)
        self.assertIn('seamless', r.stdout)

    def test_loop_pop_fails(self):
        f = os.path.join(self.tmp, 'pop')
        # half a circle: the wrap jumps across the frame
        write_frames(f, 24, draw=lambda d, i, n, s: default_draw(d, i, 2 * n, s))
        r = run_py('review.py', f, '--loop')
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn('POP', r.stdout)


class TimelineTests(unittest.TestCase):
    """timeline.mjs sampling, easing and {offset, period}, run under Node."""

    def node(self, code):
        if not shutil.which('node'):
            self.skipTest('node not installed')
        tl = os.path.join(SKILL, 'templates', 'code-scene', 'timeline.mjs').replace('\\', '/')
        src = f"import {{ Timeline, sample, EASE }} from 'file:///{tl.lstrip('/')}';\n{code}"
        r = subprocess.run(['node', '--input-type=module', '-e', src], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_sample_and_ease(self):
        out = self.node("console.log(JSON.stringify([sample([[0,0],[1,10]],0.5), sample([[0,0],[1,10,'outCubic']],0.5), sample([[0,[0,0]],[2,[2,4]]],1), sample([[0,5],[1,6]],-1), sample([[0,5],[1,6]],9)]))")
        self.assertEqual(out[0], 5)
        self.assertAlmostEqual(out[1], 10 * (1 - 0.5 ** 3))
        self.assertEqual(out[2], [1, 2])
        self.assertEqual(out[3:], [5, 6])

    def test_offset_period_and_dt_driven_time(self):
        out = self.node("""
const handlers = []; const app = { on: (e, f) => handlers.push(f) };
const tl = new Timeline(app); const seen = [];
tl.value(v => seen.push(v), [[0, 0], [1, 1]], { period: 1, offset: 0.25 });
tl.setDuration(4);
for (let k = 0; k < 8; k++) handlers.forEach(f => f(0.25));
console.log(JSON.stringify({ seen, time: tl.time, duration: tl.duration }));
""")
        # t = 0 (initial), then 0.25 .. 2.0; local = (t - 0.25) mod 1
        expect = [((t - 0.25) % 1) for t in [0] + [0.25 * k for k in range(1, 9)]]
        for a, b in zip(out['seen'], expect):
            self.assertAlmostEqual(a, b)
        self.assertAlmostEqual(out['time'], 2.0)
        self.assertEqual(out['duration'], 4)


class ScriptSanityTests(unittest.TestCase):
    def test_js_parses(self):
        if not shutil.which('node'):
            self.skipTest('node not installed')
        for rel in ['scripts/render.mjs', 'scripts/recorder.js', 'editor-scripts/keyframe-animator.js',
                    'templates/code-scene/timeline.mjs']:
            p = os.path.join(SKILL, rel)
            src = open(p, encoding='utf-8').read().replace('__RENDER_CONFIG__', '{}')
            with tempfile.NamedTemporaryFile('w', suffix=os.path.splitext(p)[1], delete=False, encoding='utf-8') as fh:
                fh.write(src)
            try:
                r = subprocess.run(['node', '--check', fh.name], capture_output=True, text=True)
                self.assertEqual(r.returncode, 0, f'{rel}: {r.stderr}')
            finally:
                os.unlink(fh.name)

    def test_render_requires_root(self):
        if not shutil.which('node'):
            self.skipTest('node not installed')
        r = subprocess.run(['node', os.path.join(SCRIPTS, 'render.mjs')], capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)
        self.assertIn('usage', r.stderr)

    def test_skill_files_mentioned_exist(self):
        text = open(os.path.join(SKILL, 'SKILL.md'), encoding='utf-8').read()
        for rel in ['scripts/render.mjs', 'scripts/recorder.js', 'scripts/encode.py', 'scripts/spritesheet.py',
                    'scripts/review.py', 'templates/code-scene', 'templates/turntable',
                    'editor-scripts/keyframe-animator.js', 'references/editor-mcp.md',
                    'references/look-and-motion.md', 'references/game-assets.md', 'references/measured-facts.md']:
            self.assertIn(rel.split('/')[-1].split('.')[0], text)
            self.assertTrue(os.path.exists(os.path.join(SKILL, rel)), rel)


if __name__ == '__main__':
    unittest.main()
