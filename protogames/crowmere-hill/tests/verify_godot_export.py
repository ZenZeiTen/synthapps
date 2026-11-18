"""Checks that a Godot export carries the whole content package, byte for byte.

    python tests/verify_godot_export.py [--run] [--no-sync]

1. Syncs content/ into godot/content (tools/sync_godot.mjs), unless --no-sync.
2. Exports the "Windows Desktop" preset as a .pck. A pack needs no export templates.
3. Reads the pack's own file table (PCK format 4, Godot 4.7). Every file of content/
   must be inside and unchanged (md5), and the headless test scripts must not be.
   Each entry's stored md5 is also checked against its bytes, which proves the table
   was read correctly.
4. With --run, starts the game from the pack alone (a window opens for ~2 s) and
   checks that the screenshot it saves shows a real room.

Why this exists: the folder used to carry a .gdignore, which Godot honours by
leaving the folder out of exports. Include filters don't override that (measured).
"""
import hashlib, os, struct, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GODOT = os.environ.get('GODOT', os.path.join(os.path.expanduser('~'), 'Downloads', 'Godot_v4.7.2-stable_win64.exe', 'Godot_v4.7.2-stable_win64_console.exe'))
PRESET = 'Windows Desktop'


def read_pack(path):
    b = open(path, 'rb').read()
    if b[:4] != b'GDPC':
        raise SystemExit(f'{path}: not a Godot pack')
    fmt = struct.unpack_from('<I', b, 4)[0]
    if fmt != 4:
        raise SystemExit(f'PCK format {fmt}: this reader was measured on format 4 (Godot 4.7); re-measure')
    file_base, dir_offset = struct.unpack_from('<QQ', b, 24)
    pos = dir_offset
    count = struct.unpack_from('<I', b, pos)[0]
    pos += 4
    files = {}
    for _ in range(count):
        plen = struct.unpack_from('<I', b, pos)[0]
        pos += 4
        name = b[pos:pos + plen].rstrip(b'\0').decode('utf-8')
        pos += plen
        ofs, size = struct.unpack_from('<QQ', b, pos)
        pos += 16
        md5 = b[pos:pos + 16].hex()
        pos += 20                                  # md5 + per-file flags
        if hashlib.md5(b[file_base + ofs:file_base + ofs + size]).hexdigest() != md5:
            raise SystemExit(f'pack table misread at {name}: stored md5 does not match its bytes')
        files[name.removeprefix('res://')] = md5
    return files


def main():
    errors = []
    if '--no-sync' not in sys.argv:
        subprocess.run(['node', os.path.join(ROOT, 'tools', 'sync_godot.mjs')], check=True, capture_output=True)
    tmp = tempfile.mkdtemp(prefix='crowmere-export-')
    pck = os.path.join(tmp, 'crowmere-hill.pck')
    p = subprocess.run([GODOT, '--headless', '--path', os.path.join(ROOT, 'godot'), '--export-pack', PRESET, pck],
                       capture_output=True, text=True, timeout=600)
    if not os.path.exists(pck):
        raise SystemExit('export produced no pack:\n' + (p.stdout + p.stderr)[-2000:])
    packed = read_pack(pck)

    content = os.path.join(ROOT, 'content')
    n = 0
    for root, _, names in os.walk(content):
        for fn in names:
            n += 1
            rel = 'content/' + os.path.relpath(os.path.join(root, fn), content).replace(os.sep, '/')
            want = hashlib.md5(open(os.path.join(root, fn), 'rb').read()).hexdigest()
            if rel not in packed:
                errors.append(f'missing from the export: {rel}')
            elif packed[rel] != want:
                errors.append(f'changed in the export (re-encoded?): {rel}')
    for name in packed:
        if name.startswith('tests/'):
            errors.append(f'test script shipped in the export: {name}')

    if '--run' in sys.argv and not errors:
        shot = os.path.join(tmp, 'from_pack.png')
        subprocess.run([GODOT, '--main-pack', pck, '--', '--demo-room=hall', f'--screenshot={shot}'],
                       cwd=tmp, capture_output=True, text=True, timeout=120)
        if not os.path.exists(shot):
            errors.append('the game did not start from the pack (no screenshot)')
        else:
            from PIL import Image
            colours = len(Image.open(shot).convert('RGB').getcolors(1 << 24))
            if colours < 8:
                errors.append(f'the game started from the pack but drew only {colours} colours')

    if errors:
        print('\n'.join(errors))
        print(f'{len(errors)} problem(s)')
        sys.exit(1)
    extra = ', and the game runs from it' if '--run' in sys.argv else ''
    print(f'ok: the "{PRESET}" export carries all {n} content files byte for byte, no test scripts{extra} '
          f'({os.path.getsize(pck) / 1048576:.1f} MB pack)')


if __name__ == '__main__':
    main()
