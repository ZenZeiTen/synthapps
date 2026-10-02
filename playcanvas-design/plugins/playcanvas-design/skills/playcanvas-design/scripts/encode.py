#!/usr/bin/env python3
"""Encode a render.mjs frame folder into a video or animated image.

    python encode.py <frames dir> <out file> [--fps 30] [--crf 18] [--loop 0]
                     [--scale 0.5] [--colors 256] [--start 0] [--end N]

The format comes from the extension of <out file>:
    .mp4 / .mov / .mkv / .webm  -> ffmpeg if on PATH, else Blender's built-in FFmpeg
    .gif                        -> Pillow (palette per frame, transparency kept)
    .webp                       -> Pillow animated WebP (alpha kept, lossless unless --quality)
    .png / .apng                -> Pillow animated PNG (alpha kept, lossless)

fps defaults to manifest.json's fps when present. Frames rendered with render.mjs --extra
(loop proof frames past the duration) are dropped unless --keep-extra.
"""
import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile

BLENDER_CANDIDATES = [
    os.environ.get('BLENDER'),
    r'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
    *sorted(glob.glob(r'C:/Program Files/Blender Foundation/Blender */blender.exe'), reverse=True),
    '/Applications/Blender.app/Contents/MacOS/Blender',
    shutil.which('blender'),
]

BLENDER_SCRIPT = r'''
import bpy, sys, json
cfg = json.loads(sys.argv[sys.argv.index('--') + 1])
scene = bpy.context.scene
scene.render.resolution_x = cfg['w']
scene.render.resolution_y = cfg['h']
scene.render.resolution_percentage = 100
scene.render.fps = int(round(cfg['fps']))
scene.render.fps_base = scene.render.fps / cfg['fps']
if not scene.sequence_editor:
    scene.sequence_editor_create()
se = scene.sequence_editor
coll = se.strips if hasattr(se, 'strips') else se.sequences   # 4.4+ renamed; an empty collection is falsy
files = cfg['files']
strip = coll.new_image(name='frames', filepath=files[0], channel=1, frame_start=1)
for f in files[1:]:
    strip.elements.append(f.replace('\\', '/').split('/')[-1])
scene.frame_start = 1
scene.frame_end = len(files)
r = scene.render
if hasattr(r.image_settings, 'media_type'):
    r.image_settings.media_type = 'VIDEO'          # Blender 5.x: video is its own media type
r.image_settings.file_format = 'FFMPEG'
ff = r.ffmpeg
ext = cfg['ext']
ff.format = {'mp4': 'MPEG4', 'mov': 'QUICKTIME', 'mkv': 'MKV', 'webm': 'WEBM'}[ext]
ff.codec = 'WEBM' if ext == 'webm' else 'H264'
if ext == 'webm':
    ff.codec = 'WEBM'
ff.constant_rate_factor = cfg['crf_name']
ff.ffmpeg_preset = 'GOOD'
ff.audio_codec = 'NONE'
try:
    r.image_settings.color_management = 'OVERRIDE'
    r.image_settings.view_settings.view_transform = 'Standard'
except Exception:
    pass
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1
scene.sequencer_colorspace_settings.name = 'sRGB'
strip.colorspace_settings.name = 'sRGB'
r.use_sequencer = True
r.use_compositing = False
r.filepath = cfg['out']
r.use_file_extension = False
bpy.ops.render.render(animation=True)
print('ENCODED', cfg['out'])
'''

CRF_NAMES = [(0, 'LOSSLESS'), (17, 'PERC_LOSSLESS'), (20, 'HIGH'), (23, 'MEDIUM'), (26, 'LOW'), (29, 'VERYLOW'), (99, 'LOWEST')]


def crf_name(crf):
    for limit, name in CRF_NAMES:
        if crf <= limit:
            return name
    return 'LOWEST'


def load_frames(folder, start, end):
    files = sorted(glob.glob(os.path.join(folder, 'frame_*.png')))
    if not files:
        sys.exit(f'no frame_*.png in {folder}')
    return files[start:end]


def encode_video(files, out, fps, crf, scale):
    ext = os.path.splitext(out)[1].lower().lstrip('.')
    ffmpeg = shutil.which('ffmpeg')
    from PIL import Image
    w, h = Image.open(files[0]).size
    if scale != 1:
        w, h = int(w * scale) // 2 * 2, int(h * scale) // 2 * 2
    if w % 2 or h % 2:
        w, h = w // 2 * 2, h // 2 * 2   # H.264 needs even sizes
    if ffmpeg:
        with tempfile.TemporaryDirectory() as tmp:
            lst = os.path.join(tmp, 'list.txt')
            with open(lst, 'w') as fh:
                for f in files:
                    fh.write(f"file '{os.path.abspath(f)}'\nduration {1 / fps}\n")
            vcodec = ['-c:v', 'libvpx-vp9', '-crf', str(crf), '-b:v', '0'] if ext == 'webm' else \
                ['-c:v', 'libx264', '-crf', str(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
            cmd = [ffmpeg, '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-r', str(fps),
                   '-vf', f'scale={w}:{h}:flags=lanczos', *vcodec, out]
            subprocess.run(cmd, check=True)
        return 'ffmpeg'
    blender = next((b for b in BLENDER_CANDIDATES if b and os.path.exists(b)), None)
    if not blender:
        sys.exit('no ffmpeg on PATH and no Blender found: install one, or encode to .gif/.webp/.apng instead')
    cfg = {'w': w, 'h': h, 'fps': fps, 'ext': ext, 'crf_name': crf_name(crf),
           'files': [os.path.abspath(f).replace('\\', '/') for f in files],
           'out': os.path.abspath(out).replace('\\', '/')}
    with tempfile.NamedTemporaryFile('w', suffix='.py', delete=False) as fh:
        fh.write(BLENDER_SCRIPT)
        script = fh.name
    try:
        p = subprocess.run([blender, '-b', '--factory-startup', '-noaudio', '--python', script, '--', json.dumps(cfg)],
                           capture_output=True, text=True)
        if 'ENCODED' not in p.stdout or not os.path.exists(out):
            sys.stderr.write(p.stdout[-4000:] + p.stderr[-4000:])
            sys.exit('Blender encode failed')
    finally:
        os.unlink(script)
    return 'blender'


def encode_image(files, out, fps, loop, scale, colors, quality):
    from PIL import Image
    ext = os.path.splitext(out)[1].lower()
    frames = []
    for f in files:
        im = Image.open(f).convert('RGBA')
        if scale != 1:
            im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS)
        frames.append(im)
    # Per-frame delays by cumulative rounding, so the total equals frames/fps exactly.
    # GIF stores centiseconds (Pillow rounds 33 ms down to 30 ms: a 4 s loop plays in 3.6 s).
    unit = 10 if ext == '.gif' else 1
    ticks = 1000 / unit / fps
    ms = [(round((i + 1) * ticks) - round(i * ticks)) * unit for i in range(len(frames))]
    if ext == '.gif':
        conv = []
        has_alpha = any(im.getextrema()[3][0] < 255 for im in frames)
        for im in frames:
            if has_alpha:
                alpha = im.getchannel('A')
                p = im.convert('RGB').quantize(colors=min(colors, 255), method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)
                p.paste(255, alpha.point(lambda a: 255 if a < 128 else 0))
                p.info['transparency'] = 255
            else:
                p = im.convert('RGB').quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)
            conv.append(p)
        kw = {'transparency': 255, 'disposal': 2} if has_alpha else {}
        conv[0].save(out, save_all=True, append_images=conv[1:], duration=ms, loop=loop, optimize=False, **kw)
    elif ext == '.webp':
        kw = {'lossless': True} if quality is None else {'quality': quality}
        frames[0].save(out, save_all=True, append_images=frames[1:], duration=ms, loop=loop, **kw)
    elif ext in ('.png', '.apng'):
        frames[0].save(out, format='PNG', save_all=True, append_images=frames[1:], duration=ms, loop=loop)
    else:
        sys.exit(f'unsupported extension {ext}')
    return 'pillow'


def readback_duration(path):
    """Total playback time (ms) and frame count of an animated GIF/WebP/APNG as written."""
    if path.lower().endswith('.webp'):
        # Pillow's WebP reader doesn't expose per-frame durations: read the ANMF chunks.
        import struct
        b = open(path, 'rb').read()
        i, total, n = 12, 0, 0
        while i + 8 <= len(b):
            tag, size = b[i:i + 4], struct.unpack('<I', b[i + 4:i + 8])[0]
            if tag == b'ANMF':
                total += int.from_bytes(b[i + 20:i + 23], 'little')
                n += 1
            i += 8 + size + (size & 1)
        return total, n
    from PIL import Image
    im = Image.open(path)
    total, n = 0, getattr(im, 'n_frames', 1)
    for i in range(n):
        im.seek(i)
        total += im.info.get('duration', 0) or 0
    return total, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('frames')
    ap.add_argument('out')
    ap.add_argument('--fps', type=float)
    ap.add_argument('--crf', type=int, default=18)
    ap.add_argument('--loop', type=int, default=0)
    ap.add_argument('--scale', type=float, default=1)
    ap.add_argument('--colors', type=int, default=256)
    ap.add_argument('--quality', type=int)
    ap.add_argument('--start', type=int, default=0)
    ap.add_argument('--end', type=int)
    ap.add_argument('--keep-extra', action='store_true')
    a = ap.parse_args()
    fps = a.fps
    man = os.path.join(a.frames, 'manifest.json')
    manifest = json.load(open(man)) if os.path.exists(man) else {}
    if fps is None:
        fps = manifest.get('fps')
    extra = int(manifest.get('extra') or 0)
    if extra and not a.keep_extra and a.end is None:
        a.end = -extra
        print(f'dropping {extra} --extra frame(s) past the loop/duration')
    fps = fps or 30
    files = load_frames(a.frames, a.start, a.end)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    ext = os.path.splitext(a.out)[1].lower()
    if ext in ('.mp4', '.mov', '.mkv', '.webm'):
        how = encode_video(files, a.out, fps, a.crf, a.scale)
    else:
        how = encode_image(files, a.out, fps, a.loop, a.scale, a.colors, a.quality)
    print(f'{a.out}: {len(files)} frames @ {fps} fps via {how}, {os.path.getsize(a.out)} bytes')
    if how == 'pillow':
        total, n = readback_duration(a.out)
        want = len(files) * 1000 / fps
        flag = '' if abs(total - want) <= 10 else '  <-- MISMATCH'
        print(f'read back: {n} frames, {total} ms (expected {want:.0f} ms){flag}')


if __name__ == '__main__':
    main()
