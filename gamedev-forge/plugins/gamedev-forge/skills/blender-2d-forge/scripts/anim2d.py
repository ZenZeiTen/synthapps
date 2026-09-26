"""
anim2d.py — keyframe helpers for Blender 4.4+/5.x

Handles slotted Actions. In 4.4 and later, `action.fcurves` no longer exists;
curves live at action.layers[].strips[].channelbags[].fcurves. Code that only
calls keyframe_insert() appears to work while silently ignoring interpolation
settings, which is how camera cuts turn into slow slides.

Every function here routes curve access through _fcurves(), which works on both
the legacy and slotted APIs.
"""

import bpy
import math

D = lambda deg: math.radians(deg)


# ------------------------------------------------- version-safe accessors ----

def _fcurves(idb):
    """All F-curves on an ID block, legacy or slotted Action."""
    ad = getattr(idb, "animation_data", None)
    if not (ad and ad.action):
        return []
    act = ad.action
    legacy = getattr(act, "fcurves", None)
    if legacy is not None:
        try:
            return list(legacy)
        except Exception:
            pass
    out = []
    slot = getattr(ad, "action_slot", None)
    for layer in act.layers:
        for strip in layer.strips:
            cb = None
            if slot is not None:
                try:
                    cb = strip.channelbag(slot)
                except Exception:
                    cb = None
            if cb is not None:
                out.extend(cb.fcurves)
            else:
                for c in strip.channelbags:
                    out.extend(c.fcurves)
    return out


def _interp(idb, path, frame, mode):
    for fc in _fcurves(idb):
        if fc.data_path != path:
            continue
        for kp in fc.keyframe_points:
            if abs(kp.co[0] - frame) < 0.51:
                kp.interpolation = mode


def clear_curves(idb, paths):
    """Delete F-curves for the given data paths. Use before re-keying —
    patching visibility keys in place produces colliding adjacent frames."""
    ad = getattr(idb, "animation_data", None)
    if not (ad and ad.action):
        return
    for fc in list(_fcurves(idb)):
        if fc.data_path in paths:
            try:
                fc.id_data.animation_data.action.layers[0].strips[0] \
                  .channelbags[0].fcurves.remove(fc)
            except Exception:
                try:
                    ad.action.fcurves.remove(fc)
                except Exception:
                    pass


# ------------------------------------------------------------ core keying ----

def K(ob, path, frame, value, interp="BEZIER"):
    """Set a property and key it, with interpolation actually applied."""
    setattr(ob, path, value)
    ob.keyframe_insert(path, frame=frame)
    _interp(ob, path, frame, interp)


def show(ob, f_on, f_off):
    """Visible only within [f_on, f_off]. CONSTANT interpolation, both
    hide_viewport and hide_render so viewport and render agree."""
    for p in ("hide_viewport", "hide_render"):
        setattr(ob, p, True);  ob.keyframe_insert(p, frame=max(1, f_on - 1))
        setattr(ob, p, False); ob.keyframe_insert(p, frame=f_on)
        setattr(ob, p, False); ob.keyframe_insert(p, frame=f_off)
        setattr(ob, p, True);  ob.keyframe_insert(p, frame=f_off + 1)
        for fr in (max(1, f_on - 1), f_on, f_off, f_off + 1):
            _interp(ob, p, fr, "CONSTANT")


def showg(ob, f_on, f_off):
    """show() applied to an object and its whole child hierarchy."""
    show(ob, f_on, f_off)
    for c in ob.children_recursive:
        show(c, f_on, f_off)


# ------------------------------------------------------------- movement -----

def pop(ob, f, s, dur=10):
    """Squash-and-stretch entrance: nothing -> overshoot -> settle."""
    K(ob, "scale", f, (0.02, 0.02, 0.02))
    K(ob, "scale", f + int(dur * 0.55), (s * 1.16, s * 1.16, s * 1.16))
    K(ob, "scale", f + dur, (s, s, s))


def unpop(ob, f, s, dur=8):
    K(ob, "scale", f, (s, s, s))
    K(ob, "scale", f + dur, (0.02, 0.02, 0.02))


def bob(ob, f0, f1, x, y, amp=0.12, period=36):
    """Gentle vertical idle. Keeps a character alive between beats."""
    z = ob.location[2]
    step = max(4, period // 8)
    f = f0
    while f <= f1:
        dy = amp * math.sin(2 * math.pi * ((f - f0) / float(period)))
        K(ob, "location", f, (x, y + dy, z))
        f += step
    K(ob, "location", f1, (x, y, z))


def swing(ob, f0, f1, base, amp, period=30):
    """Oscillate rotation around a base angle, in degrees."""
    step = max(3, period // 8)
    f = f0
    while f <= f1:
        ang = base + amp * math.sin(2 * math.pi * ((f - f0) / float(period)))
        K(ob, "rotation_euler", f, (0, 0, D(ang)))
        f += step
    K(ob, "rotation_euler", f1, (0, 0, D(base)))


def hold_rot(ob, f, deg):
    K(ob, "rotation_euler", f, (0, 0, D(deg)))


def hold_loc(ob, f, x, y, z=None):
    K(ob, "location", f, (x, y, ob.location[2] if z is None else z))


def hold_scale(ob, f, s):
    K(ob, "scale", f, (s, s, s))


# --------------------------------------------------------------- camera -----

def cam_cut(f, ortho, x=0.0, y=0.0):
    """Hard cut. The CONSTANT-interpolated key on f-1 is what makes it a cut
    rather than a slide — without it the camera eases between scenes."""
    cam = bpy.context.scene.camera
    cd = cam.data
    if f > 1:
        cd.keyframe_insert("ortho_scale", frame=f - 1)
        _interp(cd, "ortho_scale", f - 1, "CONSTANT")
        cam.keyframe_insert("location", frame=f - 1)
        _interp(cam, "location", f - 1, "CONSTANT")
    cd.ortho_scale = ortho
    cd.keyframe_insert("ortho_scale", frame=f)
    cam.location = (x, y, 20.0)
    cam.keyframe_insert("location", frame=f)


def cam_drift(f, ortho, x=0.0, y=0.0):
    """Slow move within a scene. Pair with cam_cut at the scene boundary."""
    cam = bpy.context.scene.camera
    cd = cam.data
    cd.ortho_scale = ortho
    cd.keyframe_insert("ortho_scale", frame=f)
    cam.location = (x, y, 20.0)
    cam.keyframe_insert("location", frame=f)


# ------------------------------------------------------ text and effects ----

def caption(name, f_on, f_off):
    """Caption in with a small overshoot, hold, out."""
    o = bpy.data.objects[name]
    show(o, f_on, f_off)
    K(o, "scale", f_on, (0.3, 0.3, 0.3))
    K(o, "scale", f_on + 7, (1.08, 1.08, 1.08))
    K(o, "scale", f_on + 12, (1, 1, 1))
    K(o, "scale", f_off, (1, 1, 1))


def sparkle(name, f, x, y, life=32, s=1.0):
    """Reusable star: place, grow, rotate, shrink away."""
    o = bpy.data.objects[name]
    show(o, f, f + life)
    hold_loc(o, f, x, y)
    K(o, "scale", f, (0.02,) * 3)
    K(o, "scale", f + int(life * 0.3), (s * 1.05,) * 3)
    K(o, "scale", f + life, (0.02,) * 3)
    K(o, "rotation_euler", f, (0, 0, 0))
    K(o, "rotation_euler", f + life, (0, 0, D(110)))
