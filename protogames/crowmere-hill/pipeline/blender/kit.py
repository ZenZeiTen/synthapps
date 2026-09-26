"""Room-building kit for The House on Crowmere Hill (Blender 5.2).

A room script calls the Room API to place textured boxes/cylinders, named floor
points and exit zones, lights and toggleable states; Room.render_all() then writes
the raw passes that pipeline/post/compose.py turns into game assets:

  color.png   Workbench FLAT + TEXTURE, Standard view, dither 0, AA off.
              Measured exact to the EGA palette (docs/PIPELINE.md facts F1-F5).
  ids.png     Workbench OBJECT colour, Raw: R + 256*G = outline-group id (exact, F10).
  depth.png   Workbench VERTEX colour, Raw: horizontal distance along the camera's
              ground-plane forward axis (exact to +-1 step, F7). 0 = sky.
  walk.png    the floor plan seen through the camera: walkable surfaces (R=255,
              G=depth) with a no-walk footprint (R=0) under everything that stands
              on them or hangs low over them. Objects do NOT hide the floor behind
              them -- Gus can walk behind a table; the renderer hides him by depth.
  light.png   EEVEE, every surface swapped to white clay: the lighting ramp.
  <state>_color/ids/depth/light.png   the same passes with a state applied.
  meta.json   camera, depth range, projected points/zones, id -> group table.

Coordinates: metres, X right, Y away from the camera, Z up, floor at z = 0.
"""
import bpy, bmesh, json, math, os
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

W, H, PIXEL_ASPECT_Y = 320, 168, 1.2
TEXELS_PER_M = 26.0          # ~1 texel per screen pixel at the rooms' mid depth
PASSES = ('color', 'ids', 'depth', 'walk', 'light')

# Footprints: what blocks the floor in the walk pass.
FOOT_MAX_Z = 1.3             # an underside lower than this blocks the floor beneath (table tops, seats)
FOOT_MIN_H = 0.06            # flatter than this AND resting on the surface below = a mat; never blocks
FOOT_PAD = 0.04              # metres around each footprint, so thin posts still cover whole pixels


def _purge(prefix):
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.worlds):
        for datablock in [d for d in coll if d.name.startswith(prefix)]:
            coll.remove(datablock)


def _pad_polygon(poly, pad):
    """Grow a convex polygon [(x, y), ...] outward by `pad` (mitred corners). A
    degenerate one -- a flat panel seen from above is a line -- becomes a thin
    rectangle around that line, so it still blocks."""
    n = len(poly)
    area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n)) if n >= 3 else 0.0
    if abs(area) < 1e-6:
        a, b = min(poly), max(poly)
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy)
        ux, uy = (dx / length, dy / length) if length > 1e-9 else (1.0, 0.0)
        nx, ny = -uy, ux
        return [(a[0] - (ux + nx) * pad, a[1] - (uy + ny) * pad), (b[0] + (ux - nx) * pad, b[1] + (uy - ny) * pad),
                (b[0] + (ux + nx) * pad, b[1] + (uy + ny) * pad), (a[0] - (ux - nx) * pad, a[1] - (uy - ny) * pad)]
    if area < 0:
        poly = poly[::-1]                              # counter-clockwise: outward is to the right
    out = []
    for i in range(n):
        (px, py), (cx, cy), (qx, qy) = poly[i - 1], poly[i], poly[(i + 1) % n]
        l1, l2 = math.hypot(cx - px, cy - py) or 1.0, math.hypot(qx - cx, qy - cy) or 1.0
        n1 = ((cy - py) / l1, -(cx - px) / l1)
        n2 = ((qy - cy) / l2, -(qx - cx) / l2)
        k = pad / max(1.0 + n1[0] * n2[0] + n1[1] * n2[1], 0.2)
        out.append((cx + (n1[0] + n2[0]) * k, cy + (n1[1] + n2[1]) * k))
    return out


class Room:
    def __init__(self, name, root, tex_dir=None):
        self.name = name
        self.root = root
        self.tex_dir = tex_dir or os.path.join(root, 'art', 'textures')
        self.prefix = f'{name}__'
        old = bpy.data.scenes.get(f'room_{name}')
        if old:
            bpy.data.scenes.remove(old)
        _purge(self.prefix)
        self.scene = bpy.data.scenes.new(f'room_{name}')
        self.objects = []            # (obj, flags)
        self.by_name = {}
        self.points3d, self.zones3d, self.states, self.markers, self.probes3d = {}, {}, {}, {}, {}
        self._mats, self._images = {}, {}
        self.cam = None
        r = self.scene.render
        r.resolution_x, r.resolution_y, r.resolution_percentage = W, H, 100
        r.pixel_aspect_x, r.pixel_aspect_y = 1.0, PIXEL_ASPECT_Y
        r.dither_intensity = 0.0
        # no Date/RenderTime metadata in the PNGs: an unchanged scene must re-render to
        # identical files, or every rebuild shows up in git as a binary change
        for prop in r.bl_rna.properties:
            if prop.identifier.startswith('use_stamp') and prop.type == 'BOOLEAN':
                setattr(r, prop.identifier, False)
        r.film_transparent = True
        r.image_settings.file_format = 'PNG'
        r.image_settings.color_mode = 'RGBA'
        r.image_settings.color_depth = '8'
        self.scene.view_settings.look = 'None'
        world = bpy.data.worlds.new(self.prefix + 'world')
        world.use_nodes = True
        self.world_bg = [n for n in world.node_tree.nodes if n.type == 'BACKGROUND'][0]
        self.world_bg.inputs[0].default_value = (0.02, 0.02, 0.035, 1.0)
        self.world_bg.inputs[1].default_value = 1.0
        self.scene.world = world
        self.ambient = 0.03

    # ------------------------------------------------------------ materials

    def image(self, tex):
        if tex not in self._images:
            path = os.path.join(self.tex_dir, tex + '.png')
            if not os.path.exists(path):
                raise FileNotFoundError(path)
            img = bpy.data.images.load(path, check_existing=True)
            img.colorspace_settings.name = 'sRGB'
            self._images[tex] = img
        return self._images[tex]

    def mat(self, tex):
        """Material showing texture `tex` (art/textures/<tex>.png) with nearest sampling."""
        if tex in self._mats:
            return self._mats[tex]
        m = bpy.data.materials.new(self.prefix + 'm_' + tex)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'][0]
        node = nt.nodes.new('ShaderNodeTexImage')
        node.image = self.image(tex)
        node.interpolation = 'Closest'
        nt.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
        nt.nodes.active = node
        self._mats[tex] = m
        return m

    # ------------------------------------------------------------ geometry

    def _finish(self, bm, name, tex, loc, rot, uv, flags, pivot=None):
        """Common tail: rotate (degrees XYZ, about the local origin), move to `loc`,
        UV-map in world space, then optionally re-origin at `pivot` so a state can
        swing the object on a hinge by setting rotation_euler."""
        from mathutils import Euler
        me = bpy.data.meshes.new(self.prefix + name)
        if rot:
            if not isinstance(rot, (tuple, list)):
                rot = (0, 0, rot)
            m = Euler([math.radians(a) for a in rot], 'XYZ').to_matrix()
            bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=m)
        bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(loc))
        bm.normal_update()
        self._uv(bm, tex, uv)
        if pivot is not None:
            bmesh.ops.translate(bm, verts=bm.verts, vec=-Vector(pivot))
        bm.to_mesh(me)
        bm.free()
        me.materials.append(self.mat(tex))
        ob = bpy.data.objects.new(self.prefix + name, me)
        if pivot is not None:
            ob.location = pivot
        self.scene.collection.objects.link(ob)
        flags = dict(flags)
        flags.setdefault('group', name)
        self.objects.append((ob, flags))
        self.by_name[name] = ob
        return ob

    def get(self, name):
        return self.by_name[name]

    def _uv(self, bm, tex, mode):
        img = self.image(tex)
        tw, th = img.size
        uvl = bm.loops.layers.uv.new('UVMap')
        for f in bm.faces:
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            if mode == 'fit':
                # the whole texture exactly once across the face (portraits, windows, doors)
                a_i, b_i = {0: (1, 2), 1: (0, 2), 2: (0, 1)}[ax]
                cs = [v.co for v in f.verts]
                amin, amax = min(c[a_i] for c in cs), max(c[a_i] for c in cs)
                bmin, bmax = min(c[b_i] for c in cs), max(c[b_i] for c in cs)
                flip = (ax == 0 and n[0] < 0) or (ax == 1 and n[1] > 0)
                for loop in f.loops:
                    u = (loop.vert.co[a_i] - amin) / max(amax - amin, 1e-6)
                    v = (loop.vert.co[b_i] - bmin) / max(bmax - bmin, 1e-6)
                    loop[uvl].uv = (1 - u if flip else u, v)
            else:
                a_i, b_i = {0: (1, 2), 1: (0, 2), 2: (0, 1)}[ax]
                for loop in f.loops:
                    c = loop.vert.co
                    loop[uvl].uv = (c[a_i] * TEXELS_PER_M / tw, c[b_i] * TEXELS_PER_M / th)

    def box(self, name, size, loc, tex, rot=0, uv='world', pivot=None, **flags):
        """Box of `size`; `loc` is the centre of its BOTTOM face (after `rot`)."""
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
        bmesh.ops.translate(bm, verts=bm.verts, vec=Vector((0, 0, size[2] / 2)))
        return self._finish(bm, name, tex, loc, rot, uv, flags, pivot)

    def span(self, name, x0, x1, y0, y1, z0, z1, tex, uv='world', pivot=None, **flags):
        """Box from explicit extents -- the natural way to lay out walls and floors."""
        return self.box(name, (x1 - x0, y1 - y0, z1 - z0), ((x0 + x1) / 2, (y0 + y1) / 2, z0), tex, uv=uv, pivot=pivot, **flags)

    def blocker(self, name, x0, x1, y0, y1, z=0.0):
        """Invisible no-walk area (only the walk pass sees it), for limits no object
        provides. Every visible object already blocks its own footprint automatically."""
        return self.span(name, x0, x1, y0, y1, z + 0.005, z + 0.02, 'c_black', blocker=True)

    def quad(self, name, corners, tex, uv='world', **flags):
        """A single face from 4 corners (counter-clockwise seen from its front)."""
        bm = bmesh.new()
        vs = [bm.verts.new(c) for c in corners]
        bm.faces.new(vs)
        bm.normal_update()
        return self._finish(bm, name, tex, (0, 0, 0), 0, uv, flags)

    def cyl(self, name, radius, height, loc, tex, segs=10, radius2=None, rot=0, uv='world', pivot=None, **flags):
        """Cylinder (or cone with radius2) standing on `loc`, optionally rotated."""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=radius,
                              radius2=radius if radius2 is None else radius2, depth=height)
        bmesh.ops.translate(bm, verts=bm.verts, vec=Vector((0, 0, height / 2)))
        return self._finish(bm, name, tex, loc, rot, uv, flags, pivot)

    def ball(self, name, radius, loc, tex, segs=8, **flags):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=max(4, segs // 2), radius=radius)
        return self._finish(bm, name, tex, loc, 0, 'world', flags)

    def prism(self, name, profile, depth_y, loc, tex, uv='world', **flags):
        """Extrude a 2D profile (list of (x, z)) along +Y by depth_y (stairs, roofs)."""
        bm = bmesh.new()
        front = [bm.verts.new((x, 0, z)) for x, z in profile]
        back = [bm.verts.new((x, depth_y, z)) for x, z in profile]
        bm.faces.new(list(reversed(front)))
        bm.faces.new(back)
        n = len(profile)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new([front[i], front[j], back[j], back[i]])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return self._finish(bm, name, tex, loc, 0, uv, flags)

    def stairs(self, name, x0, x1, y0, steps, rise, run, tex, runner=None, runner_w=0.0, back=None, **flags):
        """A straight flight climbing in +Y from a first riser at y0: one box per step,
        each running to `back`, so risers and treads are real faces."""
        back = back if back is not None else y0 + steps * run + 0.5
        for i in range(steps):
            ya, top = y0 + i * run, rise * (i + 1)
            self.span(f'{name}_{i:02d}', x0, x1, ya, back, 0.0, top, tex, group=flags.get('group', name), **{k: v for k, v in flags.items() if k != 'group'})
            if runner:
                cx = (x0 + x1) / 2
                self.span(f'{name}_run{i:02d}', cx - runner_w / 2, cx + runner_w / 2, ya - 0.01, ya + run, top - 0.01, top + 0.012, runner,
                          group=flags.get('group', name), **{k: v for k, v in flags.items() if k != 'group'})

    # ------------------------------------------------------------ gameplay markup

    def point(self, name, x, y, z=0.0):
        """A named floor position (where Gus's feet go). Projected into room.json."""
        self.points3d[name] = Vector((x, y, z))

    def zone(self, name, corners, target):
        """An exit zone: floor polygon (list of (x, y[, z])) and a walk target inside it."""
        self.zones3d[name] = ([Vector(c if len(c) == 3 else (c[0], c[1], 0.0)) for c in corners],
                              Vector(target if len(target) == 3 else (target[0], target[1], 0.0)))

    def marker(self, name, x, y, z):
        """A non-floor screen anchor (sprite placement: eyes, bubbles, crow)."""
        self.markers[name] = Vector((x, y, z))

    def probe(self, name, x, y, walkable, z=0.0):
        """A floor spot with an expected answer -- 'behind the table is walkable', 'under
        it is not'. Never snapped; tests/lint.test.mjs checks each one against the walk
        mask, and that walkable probes are reachable from where Gus enters the room."""
        self.probes3d[name] = (Vector((x, y, z)), bool(walkable))

    def state(self, name, apply, base=None):
        """A toggleable variant (open door...). `apply(room)` mutates objects in place;
        states are rendered from a fresh rebuild, so they need no undo. `base` names
        another state this one is diffed against (e.g. an item inside an open drawer)."""
        self.states[name] = (apply, base)

    def camera(self, loc, target, lens=50.0):
        cd = bpy.data.cameras.new(self.prefix + 'cam')
        cd.lens = lens
        cd.clip_start, cd.clip_end = 0.1, 200.0
        cam = bpy.data.objects.new(self.prefix + 'cam', cd)
        self.scene.collection.objects.link(cam)
        d = Vector(target) - Vector(loc)
        cam.location = loc
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        self.scene.camera = cam
        self.cam = cam
        self.scene.view_layers[0].update()
        return cam

    def light(self, kind, loc, energy, color=(1, 1, 1), size=0.2, rot=None, spot=None):
        ld = bpy.data.lights.new(self.prefix + f'L{len(self.scene.objects)}', kind)
        ld.energy = energy
        ld.color = color
        if kind in ('POINT', 'SPOT'):
            ld.shadow_soft_size = size
        if kind == 'AREA':
            ld.size = size
        if kind == 'SPOT' and spot:
            ld.spot_size = math.radians(spot)
        ob = bpy.data.objects.new(ld.name, ld)
        ob.location = loc
        if rot:
            ob.rotation_euler = [math.radians(a) for a in rot]
        self.scene.collection.objects.link(ob)
        return ob

    # ------------------------------------------------------------ projection

    def project(self, v):
        p = world_to_camera_view(self.scene, self.cam, v)
        return [round(p.x * W, 2), round((1.0 - p.y) * H, 2)]

    def _fwd_h(self):
        f = (self.cam.matrix_world.to_3x3() @ Vector((0, 0, -1)))
        fh = Vector((f.x, f.y, 0))
        return fh.normalized()

    def hdepth(self, v):
        return (v - self.cam.matrix_world.translation).dot(self._fwd_h())

    # ------------------------------------------------------------ passes

    def _meshes(self, include):
        return [(o, f) for o, f in self.objects if include(f)]

    def _set_depth_attrs(self):
        C, fh = self.cam.matrix_world.translation.copy(), self._fwd_h()
        ds = []
        for ob, f in self.objects:
            for v in ob.data.vertices:
                ds.append((ob.matrix_world @ v.co - C).dot(fh))
        self.near, self.far = min(ds) - 0.01, max(ds) + 0.01
        span = self.far - self.near
        for ob, f in self.objects:
            me = ob.data
            for a in list(me.color_attributes):
                me.color_attributes.remove(a)
            dep = me.color_attributes.new('depth', 'FLOAT_COLOR', 'POINT')
            wlk = me.color_attributes.new('walk', 'FLOAT_COLOR', 'POINT')
            walk_r = 1.0 if f.get('walk') else 0.0
            for i, v in enumerate(me.vertices):
                d = ((ob.matrix_world @ v.co - C).dot(fh) - self.near) / span
                d = 1.0 / 255 + d * 253.0 / 255          # bytes 1..254; 0 means "nothing"
                dep.data[i].color = (d, d, d, 1.0)
                wlk.data[i].color = (walk_r, d if walk_r else 0.0, 0.0, 1.0)

    def _use_attr(self, name):
        for ob, f in self.objects:
            ca = ob.data.color_attributes
            ca.active_color = ca[name]
            try:
                ca.render_color_index = ca.active_color_index
            except Exception:
                pass

    def _visible(self, pred):
        for ob, f in self.objects:
            ob.hide_render = not pred(f)

    def _workbench(self, color_type, raw):
        s = self.scene
        s.render.engine = 'BLENDER_WORKBENCH'
        s.display.render_aa = 'OFF'
        sh = s.display.shading
        sh.light = 'FLAT'
        sh.color_type = color_type
        sh.show_object_outline = False
        sh.show_shadows = False
        sh.show_cavity = False
        s.view_settings.view_transform = 'Raw' if raw else 'Standard'

    def _render(self, path):
        self.scene.render.filepath = path
        bpy.ops.render.render(write_still=True, scene=self.scene.name)

    def _render_light(self, path, samples):
        s = self.scene
        s.render.engine = 'BLENDER_EEVEE'
        s.view_settings.view_transform = 'Standard'
        s.eevee.taa_render_samples = samples
        self.world_bg.inputs[0].default_value = (self.ambient, self.ambient, self.ambient * 1.15, 1.0)
        clay = bpy.data.materials.get(self.prefix + 'LM_clay') or bpy.data.materials.new(self.prefix + 'LM_clay')
        clay.use_nodes = True
        nt = clay.node_tree
        if not any(n.type == 'BSDF_DIFFUSE' for n in nt.nodes):
            for n in list(nt.nodes):
                if n.type != 'OUTPUT_MATERIAL':
                    nt.nodes.remove(n)
            dif = nt.nodes.new('ShaderNodeBsdfDiffuse')
            dif.inputs['Color'].default_value = (0.8, 0.8, 0.8, 1)
            nt.links.new(dif.outputs[0], [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0].inputs['Surface'])
        glow = bpy.data.materials.get(self.prefix + 'LM_glow') or bpy.data.materials.new(self.prefix + 'LM_glow')
        glow.use_nodes = True
        gt = glow.node_tree
        if not any(n.type == 'EMISSION' for n in gt.nodes):
            for n in list(gt.nodes):
                if n.type != 'OUTPUT_MATERIAL':
                    gt.nodes.remove(n)
            em = gt.nodes.new('ShaderNodeEmission')
            em.inputs['Strength'].default_value = 1.0
            gt.links.new(em.outputs[0], [n for n in gt.nodes if n.type == 'OUTPUT_MATERIAL'][0].inputs['Surface'])
        saved = {}
        for ob, f in self.objects:
            me = ob.data
            if me.name in saved:
                continue
            saved[me.name] = list(me.materials)
            me.materials.clear()
            me.materials.append(glow if f.get('glow') else clay)
        try:
            self._render(path)
        finally:
            for ob, f in self.objects:
                me = ob.data
                if me.name in saved:
                    mats = saved.pop(me.name)
                    me.materials.clear()
                    for m in mats:
                        me.materials.append(m)

    def _footprints(self):
        """Temporary no-walk polygons for the walk pass: one under every object that
        stands on the floor or hangs lower than FOOT_MAX_Z over it (a table top blocks
        the floor between its legs). Each lies just above the highest walkable surface
        under it, so it wins the depth test there and nowhere else."""
        from mathutils.geometry import convex_hull_2d
        tops = []                                  # (x0, x1, y0, y1, z_top) of walk surfaces
        for ob, f in self.objects:
            if f.get('walk') and not f.get('hidden'):
                vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
                tops.append((min(v.x for v in vs), max(v.x for v in vs), min(v.y for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
        made = []
        for ob, f in self.objects:
            if f.get('walk') or f.get('hidden') or f.get('blocker') or f.get('footprint') is False:
                continue
            vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
            if not vs:
                continue
            zb, zt = min(v.z for v in vs), max(v.z for v in vs)
            if zt <= 0.02 or zb > FOOT_MAX_Z:
                continue                           # sits below the floor, or is overhead
            pts = list({(round(v.x, 4), round(v.y, 4)) for v in vs})
            poly = [pts[i] for i in convex_hull_2d(pts)] if len(pts) >= 3 else pts
            poly = _pad_polygon(poly, FOOT_PAD)
            cx, cy = sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly)
            support = max([t[4] for t in tops if t[0] <= cx <= t[1] and t[2] <= cy <= t[3] and t[4] <= zb + 0.05], default=0.0)
            if zt - zb < FOOT_MIN_H and zb - support < 0.05:
                continue                           # lies flat ON the surface (a mat); a thin seat in the air still blocks
            me = bpy.data.meshes.new(self.prefix + 'foot_' + ob.name)
            me.from_pydata([(x, y, support + 0.012) for x, y in poly], [], [list(range(len(poly)))])
            ca = me.color_attributes.new('walk', 'FLOAT_COLOR', 'POINT')
            for d in ca.data:
                d.color = (0.0, 0.0, 0.0, 1.0)
            ca_idx = list(me.color_attributes).index(ca)
            me.color_attributes.active_color_index = ca_idx
            try:
                me.color_attributes.render_color_index = ca_idx
            except Exception:
                pass
            fo = bpy.data.objects.new(me.name, me)
            self.scene.collection.objects.link(fo)
            made.append(fo)
        return made

    def render_passes(self, out_dir, prefix='', samples=24, passes=PASSES):
        """Render the requested passes (all by default). Walkability lives only in the
        walk pass, so a walk-only re-render leaves the art passes -- and bg.png -- as is."""
        os.makedirs(out_dir, exist_ok=True)
        P = lambda n: os.path.join(out_dir, prefix + n)
        self.scene.view_layers[0].update()
        self._set_depth_attrs()
        groups = sorted({f['group'] for o, f in self.objects})
        gid = {g: i + 1 for i, g in enumerate(groups)}
        for ob, f in self.objects:
            i = gid[f['group']]
            ob.color = ((i % 256) / 255.0, (i // 256) / 255.0, 0.0, 1.0)
        shown = lambda f: not f.get('blocker') and not f.get('hidden')
        self._visible(shown)
        if 'color' in passes:
            self._workbench('TEXTURE', raw=False)
            self._render(P('color.png'))
        if 'ids' in passes:
            self._workbench('OBJECT', raw=True)
            self._render(P('ids.png'))
        if 'depth' in passes:
            self._use_attr('depth')
            self._workbench('VERTEX', raw=True)
            self._render(P('depth.png'))
        if 'walk' in passes and not prefix:
            # The floor plan: walkable surfaces plus footprints, nothing else drawn. An
            # object never hides floor that is really behind it; `occlude=True` restores
            # that for a backdrop whose far side must stay out of reach.
            feet = self._footprints()
            try:
                self._visible(lambda f: not f.get('hidden') and (f.get('walk') or f.get('blocker') or f.get('occlude', False)))
                self._use_attr('walk')
                self._workbench('VERTEX', raw=True)
                self._render(P('walk.png'))
            finally:
                for fo in feet:
                    me = fo.data
                    bpy.data.objects.remove(fo)
                    bpy.data.meshes.remove(me)
        self._visible(shown)
        if 'light' in passes:
            self._render_light(P('light.png'), samples)
        return {g: i for g, i in gid.items()}

    def meta(self, gid):
        return {
            'room': self.name, 'size': [W, H], 'pixel_aspect_y': PIXEL_ASPECT_Y,
            'near': self.near, 'far': self.far,
            'camera': {'loc': list(self.cam.location), 'rot': list(self.cam.rotation_euler), 'lens': self.cam.data.lens},
            'points': {n: self.project(v) + [round(self.hdepth(v), 3)] for n, v in self.points3d.items()},
            'zones': {n: {'poly': [self.project(c) for c in cs], 'target': self.project(t)} for n, (cs, t) in self.zones3d.items()},
            'markers': {n: self.project(v) + [round(self.hdepth(v), 3)] for n, v in self.markers.items()},
            'probes': {n: self.project(v) + [walkable] for n, (v, walkable) in self.probes3d.items()},
            'groups': gid,
            'states': {n: {'base': b} for n, (a, b) in self.states.items()},
            'shade': getattr(self, 'shade', {}), 'sky': getattr(self, 'sky', False), 'erode': getattr(self, 'erode', [3, 0]),
            'glow_ids': sorted({gid[f['group']] for o, f in self.objects if f.get('glow')}),
        }
