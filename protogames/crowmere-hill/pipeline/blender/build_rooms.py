"""Build and render rooms. Two ways in, same code path:

  headless:  blender -b --factory-startup --python pipeline/blender/build_rooms.py -- hall kitchen
             (add --walk-only to re-render just the walk mask)
  live MCP:  exec this file in the connected Blender, then call build_room('hall')
             or rebuild_walk('hall')

Raw passes go to build/rooms/<room>/, an editable scene to art/blender/<room>.blend.
pipeline/post/compose.py turns the passes into content/rooms/<room>/.
"""
import bpy, importlib, json, os, sys, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')) \
    if '__file__' in globals() else r'E:\Claude Code\crowmere-hill'
sys.path.insert(0, os.path.join(ROOT, 'pipeline', 'blender'))
import kit  # noqa: E402

ALL_ROOMS = ['gate', 'hall', 'library', 'kitchen', 'bedroom', 'cellar']


def _module(name):
    # a long-lived Blender session caches package directory listings; without this a
    # room file added after the first import is "not found"
    importlib.invalidate_caches()
    importlib.reload(kit)
    # shared helpers (rooms._shell) too: a room's `from rooms._shell import shell` would
    # otherwise keep the version from the session's first import, silently
    for helper in [m for m in list(sys.modules) if m.startswith('rooms._')]:
        importlib.reload(sys.modules[helper])
    mod = importlib.import_module('rooms.' + name)
    return importlib.reload(mod)


def build_room(name, samples=24, save_blend=True, only_base=False):
    t0 = time.time()
    mod = _module(name)

    def fresh():
        R = kit.Room(name, ROOT)
        mod.build(R)
        return R

    out = os.path.join(ROOT, 'build', 'rooms', name)
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        if f.endswith('.png'):
            os.remove(os.path.join(out, f))
    R = fresh()
    gid = R.render_passes(out, samples=samples)
    meta = R.meta(gid)
    if not only_base:
        for sname, (apply, base) in list(R.states.items()):
            S = fresh()
            if base:
                S.states[base][0](S)
            apply(S)
            S.render_passes(out, prefix=sname + '_', samples=samples)
    with open(os.path.join(out, 'meta.json'), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(meta, fh, indent=1)
    if save_blend:
        R = fresh()
        os.makedirs(os.path.join(ROOT, 'art', 'blender'), exist_ok=True)
        bpy.data.libraries.write(os.path.join(ROOT, 'art', 'blender', f'{name}.blend'), {R.scene}, fake_user=True)
    return {'room': name, 'seconds': round(time.time() - t0, 1), 'states': list(meta['states']), 'out': out}


def rebuild_walk(name):
    """Re-render only walk.png (and meta.json, which carries the probes). The art
    passes don't depend on walkability, so they -- and bg.png -- stay byte-identical."""
    t0 = time.time()
    mod = _module(name)
    R = kit.Room(name, ROOT)
    mod.build(R)
    out = os.path.join(ROOT, 'build', 'rooms', name)
    gid = R.render_passes(out, passes=('walk',))
    meta = R.meta(gid)
    with open(os.path.join(out, 'meta.json'), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(meta, fh, indent=1)
    return {'room': name, 'seconds': round(time.time() - t0, 1), 'probes': len(meta['probes'])}


def preview(name, path):
    """Colour pass only, for fast layout iteration."""
    mod = _module(name)
    R = kit.Room(name, ROOT)
    mod.build(R)
    R._visible(lambda f: not f.get('blocker') and not f.get('hidden'))
    R._workbench('TEXTURE', raw=False)
    R._render(path)
    return {n: R.project(v) for n, v in R.points3d.items()}


if __name__ == '__main__' and bpy.app.background:
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    walk_only = '--walk-only' in args
    for room in ([a for a in args if not a.startswith('--')] or ALL_ROOMS):
        print('built', rebuild_walk(room) if walk_only else build_room(room), flush=True)
