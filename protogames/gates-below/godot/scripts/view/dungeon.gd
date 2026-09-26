## The 3D view of the current level. Static geometry (walls, floors, ceilings) is merged
## into one mesh per texture; doors, decals, teleports, items and monsters are separate
## nodes driven by the core state (game.gd) every frame. One square is 2 x 2 m.
extends Node3D

const CELL := 2.0
const H := 2.0
const EYE := 1.0
const CAM_BACK := 0.75          # the camera stands near the back of its square
const STEP_TIME := 0.16
const TURN_TIME := 0.14
const PX_PER_M := 25.0
const DX: Array[int] = [0, 1, 0, -1]
const DY: Array[int] = [-1, 0, 1, 0]
const CORNER := [Vector2(-0.55, -0.55), Vector2(0.55, -0.55), Vector2(0.55, 0.55), Vector2(-0.55, 0.55)]

var g
var A
var shader: Shader
var cam: Camera3D
var mats: Array = []            # every ShaderMaterial, for per-frame light updates
var anim_mats: Array = []       # [material, texture key, frame count] for animated textures
var static_root: Node3D
var dyn_root: Node3D
var doors = {}                 # edge key -> {node, gate, face}
var decals = {}                # face index -> {node, kind}
var teles = {}                 # cell -> node
var mobs = {}                  # uid -> view state
var item_nodes: Array = []
var items_sig = ""
var lights: Array = []          # Vector4 (pos, strength) for wall torches
var fog = Color(0.1, 0.09, 0.15)
var ambient = 0.3
var time = 0.0
var level_id = ""

# camera animation
var cam_from = Vector3.ZERO
var cam_to = Vector3.ZERO
var yaw_from = 0.0
var yaw_to = 0.0
var cam_t = 1.0
var cam_dur = 0.16
var bump_t = 1.0
var bump_dir = Vector3.ZERO
var shake = 0.0
var demo = false               # title screen: slow turn in place


func setup(game, assets) -> void:
	g = game
	A = assets
	shader = load("res://shaders/world.gdshader")
	cam = Camera3D.new()
	cam.fov = 62.0
	cam.near = 0.05
	cam.far = 40.0
	add_child(cam)
	static_root = Node3D.new()
	add_child(static_root)
	dyn_root = Node3D.new()
	add_child(dyn_root)


func busy() -> bool:
	return cam_t < 1.0


# ------------------------------------------------------------------ materials

func make_mat(key: String, opts: Dictionary = {}) -> ShaderMaterial:
	var m = ShaderMaterial.new()
	m.shader = shader
	m.set_shader_parameter("tex", A.tex(key))
	m.set_shader_parameter("region", A.region(key, 0))
	for k in opts:
		m.set_shader_parameter(k, opts[k])
	if opts.get("two_sided", false):
		m.shader = _two_sided()
		m.set_shader_parameter("tex", A.tex(key))
		m.set_shader_parameter("region", A.region(key, 0))
	mats.append(m)
	if A.frame_count(key) > 1:
		anim_mats.append([m, key, A.frame_count(key)])
	_apply_env(m)
	return m


var _two_sided_shader: Shader = null


func _two_sided() -> Shader:
	if _two_sided_shader == null:
		_two_sided_shader = Shader.new()
		_two_sided_shader.code = shader.code.replace("cull_back", "cull_disabled")
	return _two_sided_shader


func _apply_env(m: ShaderMaterial, boost: float = 0.0) -> void:
	m.set_shader_parameter("fog_color", fog)
	m.set_shader_parameter("ambient", ambient + boost)
	var arr = PackedVector4Array()
	for l in lights:
		arr.append(l)
	while arr.size() < 8:
		arr.append(Vector4.ZERO)
	m.set_shader_parameter("lights", arr)
	m.set_shader_parameter("light_count", mini(lights.size(), 8))


# ------------------------------------------------------------------ building

func cell_pos(c: int) -> Vector3:
	return Vector3((c % g.lv.w) * CELL, 0.0, (c / g.lv.w) * CELL)


func build() -> void:
	for n in static_root.get_children():
		n.queue_free()
	for n in dyn_root.get_children():
		n.queue_free()
	mats.clear()
	anim_mats.clear()
	doors.clear()
	decals.clear()
	teles.clear()
	mobs.clear()
	item_nodes.clear()
	items_sig = ""
	lights.clear()
	level_id = g.s["level"]
	var L = g.lv
	fog = Color.html(String(L.data.get("fog", "1c1726")))
	ambient = float(L.data.get("ambient", 0.3))
	# wall torches light their surroundings: collect them before any material exists
	for fi in L.faces.size():
		var f: Dictionary = L.faces[fi]
		if not f.is_empty() and f.get("decal", "") == "torch" and lights.size() < 8:
			var d = fi & 3
			var p = cell_pos(fi >> 2) + Vector3(DX[d], 0, DY[d]) * 0.7 + Vector3(0, 1.4, 0)
			lights.append(Vector4(p.x, p.y, p.z, 0.55))
	var tools = {}   # texture -> SurfaceTool
	for c in L.cells.size():
		var cell: Dictionary = L.cells[c]
		if cell.is_empty():
			continue
		var p = cell_pos(c)
		var floor_tex = String(cell["floor"])
		if cell["type"] == "water":
			floor_tex = "water"
		elif cell["type"] == "pit":
			floor_tex = "pit"
		var stairs = String(cell.get("stairs", ""))
		if stairs != "down":
			_quad(tools, floor_tex, p + Vector3(-1, 0, 1), p + Vector3(1, 0, 1), p + Vector3(1, 0, -1), p + Vector3(-1, 0, -1))
		if stairs != "up":
			_quad(tools, String(cell["ceil"]), p + Vector3(1, H, 1), p + Vector3(-1, H, 1), p + Vector3(-1, H, -1), p + Vector3(1, H, -1))
		for d in 4:
			var fi: int = c * 4 + d
			var f: Dictionary = L.faces[fi]
			var fwd = Vector3(DX[d], 0, DY[d])
			var right = Vector3(-DY[d], 0, DX[d])
			var ctr = p + fwd * 1.0
			if f["kind"] in ["wall", "secret"]:
				_quad(tools, String(f["tex"]), ctr - right, ctr + right, ctr + right + Vector3(0, H, 0), ctr - right + Vector3(0, H, 0))
				_decal(fi, f, ctr, fwd, right)
			elif f["kind"] in ["door", "gate"] and L.edge_key(fi) == fi:
				_door(fi, f, ctr, fwd, right)
		if stairs != "":
			_stairs(c, stairs)
		if cell["type"] == "teleport":
			var mi = _mesh_quad("teleport", Vector2(2.0, 2.0), {"glow": 0.8})
			mi.rotation_degrees = Vector3(-90, 0, 0)
			mi.position = p + Vector3(0, 0.03, 0)
			dyn_root.add_child(mi)
			teles[c] = mi
	for key in tools:
		var st: SurfaceTool = tools[key]
		var mesh = st.commit()
		var mi = MeshInstance3D.new()
		mi.mesh = mesh
		mi.material_override = make_mat(key)
		static_root.add_child(mi)
	for m in g.ls["monsters"]:
		_add_mob(m)
	snap_camera()


func _quad(tools: Dictionary, key: String, bl: Vector3, br: Vector3, tr: Vector3, tl: Vector3) -> void:
	if not tools.has(key):
		var st = SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		tools[key] = st
	var s: SurfaceTool = tools[key]
	# clockwise seen from the front (Godot's front face)
	for v in [[bl, Vector2(0, 1)], [tl, Vector2(0, 0)], [tr, Vector2(1, 0)], [bl, Vector2(0, 1)], [tr, Vector2(1, 0)], [br, Vector2(1, 1)]]:
		s.set_uv(v[1])
		s.add_vertex(v[0])


## A textured quad centred on its node, facing +Z.
func _mesh_quad(key: String, size: Vector2, opts: Dictionary = {}) -> MeshInstance3D:
	var mi = MeshInstance3D.new()
	var q = QuadMesh.new()
	q.size = size
	mi.mesh = q
	mi.material_override = make_mat(key, opts)
	return mi


func _face_basis(fwd: Vector3) -> float:
	# rotation.y that turns a +Z-facing quad to face back into the square (-fwd)
	return atan2(-fwd.x, -fwd.z)


func _decal(fi: int, f: Dictionary, ctr: Vector3, fwd: Vector3, right: Vector3) -> void:
	var key = ""
	var kind = "decal"
	if f.has("switch"):
		key = "lever_down" if bool(g.ls["switches"].get(str(fi), false)) else "lever_up"
		kind = "switch"
	elif f.has("niche"):
		key = String(f.get("decal", "niche"))
		kind = "niche"
	elif f.get("fountain", false):
		key = "fountain"
	elif f.has("decal"):
		key = String(f["decal"])
	if key == "":
		return
	var size = Vector2(2.0, 2.0)
	var mi = _mesh_quad(key, size, {"glow": 0.9 if key == "torch" else 0.0})
	mi.position = ctr - fwd * 0.02 + Vector3(0, 1.0, 0)
	mi.rotation.y = _face_basis(fwd)
	dyn_root.add_child(mi)
	decals[fi] = {"node": mi, "kind": kind, "key": key}
	if kind == "niche" and key == "gate":
		var n2 = _mesh_quad("niche", Vector2(1.0, 1.0))
		n2.position = ctr - fwd * 0.03 + Vector3(0, 1.0, 0)
		n2.rotation.y = _face_basis(fwd)
		dyn_root.add_child(n2)


func _door(fi: int, f: Dictionary, ctr: Vector3, fwd: Vector3, right: Vector3) -> void:
	var gate: bool = f["kind"] == "gate"
	var size = Vector2(2.0, 2.0) if gate else Vector2(1.44, 1.72)
	var mi = _mesh_quad(String(f["tex"]), size, {"two_sided": true})
	mi.rotation.y = _face_basis(fwd)
	var holder = Node3D.new()
	holder.position = ctr
	dyn_root.add_child(holder)
	holder.add_child(mi)
	mi.position = Vector3(0, size.y / 2.0, 0)
	doors[str(fi)] = {"node": mi, "gate": gate, "h": size.y}
	if not gate:
		var arch: Node3D = A.glb("arch")
		arch.position = ctr - fwd * CELL / 2.0
		arch.rotation.y = _face_basis(-fwd) + PI
		_retex(arch)
		dyn_root.add_child(arch)


func _stairs(c: int, kind: String) -> void:
	var entry = -1
	for d in 4:
		var f: Dictionary = g.lv.faces[c * 4 + d]
		if f["kind"] != "wall":
			entry = (d + 2) & 3   # the party walks in the opposite way
			break
	var model: Node3D = A.glb("stairs_" + kind)
	model.position = cell_pos(c)
	model.rotation.y = -entry * PI / 2.0
	_retex(model)
	dyn_root.add_child(model)


## GLB materials -> the dungeon shader, keeping each surface's texture.
func _retex(n: Node) -> void:
	if n is MeshInstance3D:
		var mi: MeshInstance3D = n
		for s in mi.mesh.get_surface_count():
			var sm = mi.mesh.surface_get_material(s)
			var t: Texture2D = null
			if sm is BaseMaterial3D:
				t = sm.albedo_texture
			var m = ShaderMaterial.new()
			m.shader = shader
			m.set_shader_parameter("tex", t)
			m.set_shader_parameter("region", Vector4(0, 0, 1, 1))
			_apply_env(m)
			mats.append(m)
			mi.set_surface_override_material(s, m)
	for ch in n.get_children():
		_retex(ch)


# ------------------------------------------------------------------ monsters and items

func _add_mob(m: Dictionary) -> void:
	var t: Dictionary = g.mtemplate(m)
	var key = "sprites/" + String(t["sprite"])
	var px: Vector2 = A.frame_px(key)
	var size = px / PX_PER_M
	var glow = {"wisp": 0.85, "warden": 0.4}.get(String(t["sprite"]), 0.0)
	var mi = _mesh_quad(key, size, {"glow": glow})
	mi.set_meta("creature", true)
	mi.material_override.set_shader_parameter("ambient", ambient + 0.22)
	dyn_root.add_child(mi)
	var p = cell_pos(int(m["cell"]))
	mobs[int(m["uid"])] = {"node": mi, "key": key, "size": size, "from": p, "to": p, "t": 1.0, "dur": 0.4,
		"anim": "", "anim_t": 0.0, "flash": 0.0, "dying": -1.0, "phase": randf() * 2.0}


func on_event(e: Dictionary) -> void:
	match String(e["t"]):
		"mob_move":
			var v = mobs.get(int(e["uid"]))
			var m = g.monster_by_uid(int(e["uid"]))
			if v != null and m != null:
				v["from"] = _mob_base(v)
				v["to"] = cell_pos(int(e["to"]))
				v["t"] = 0.0
				v["dur"] = clampf(float(g.mtemplate(m)["step_ticks"]) * 0.1, 0.2, 1.2)
		"mob_attack":
			var v = mobs.get(int(e["uid"]))
			if v != null:
				v["anim"] = "attack"
				v["anim_t"] = 0.0
			shake = maxf(shake, 0.25 if int(e["dmg"]) > 0 else 0.0)
		"mob_hurt":
			var v = mobs.get(int(e["uid"]))
			if v != null:
				v["anim"] = "hurt"
				v["anim_t"] = 0.0
				v["flash"] = 1.0
		"mob_die":
			var v = mobs.get(int(e["uid"]))
			if v != null:
				v["dying"] = 0.0
				v["flash"] = 1.0
		"step", "teleport", "loaded":
			move_camera(e["t"] == "step")
		"turn":
			move_camera(true)
		"bump":
			bump_t = 0.0
			bump_dir = Vector3(DX[int(e["dir"])], 0, DY[int(e["dir"])])
		"switch":
			var dd = decals.get(int(e["face"]))
			if dd != null:
				var key = "lever_down" if bool(e["on"]) else "lever_up"
				dd["node"].material_override.set_shader_parameter("tex", A.tex(key))
		"join":
			_sync_mobs()


func _mob_base(v: Dictionary) -> Vector3:
	var k = clampf(float(v["t"]), 0.0, 1.0)
	return (v["from"] as Vector3).lerp(v["to"], k)


func _sync_mobs() -> void:
	var live = {}
	for m in g.ls["monsters"]:
		live[int(m["uid"])] = true
		if not mobs.has(int(m["uid"])):
			_add_mob(m)
	for uid in mobs.keys():
		if not live.has(uid) and float(mobs[uid]["dying"]) < 0.0:
			mobs[uid]["node"].queue_free()
			mobs.erase(uid)


func _update_mobs(delta: float) -> void:
	var cf = Vector3(DX[int(g.s["dir"])], 0, DY[int(g.s["dir"])])
	var cr = Vector3(-cf.z, 0, cf.x)
	var by_cell = {}
	for m in g.ls["monsters"]:
		var c = int(m["cell"])
		if not by_cell.has(c):
			by_cell[c] = []
		by_cell[c].append(int(m["uid"]))
	for uid in mobs.keys():
		var v: Dictionary = mobs[uid]
		var node: MeshInstance3D = v["node"]
		if float(v["dying"]) >= 0.0:
			v["dying"] = float(v["dying"]) + delta
			var k: float = float(v["dying"]) / 0.45
			node.scale = Vector3(1.0 + k * 0.3, maxf(0.01, 1.0 - k), 1.0)
			node.material_override.set_shader_parameter("flash", clampf(1.0 - k, 0.0, 1.0))
			if k >= 1.0:
				node.queue_free()
				mobs.erase(uid)
			continue
		var m = g.monster_by_uid(uid)
		if m == null:
			continue
		v["t"] = minf(1.0, float(v["t"]) + delta / float(v["dur"]))
		v["anim_t"] = float(v["anim_t"]) + delta
		v["phase"] = float(v["phase"]) + delta
		var base = _mob_base(v)
		var mates: Array = by_cell.get(int(m["cell"]), [uid])
		mates.sort()
		if mates.size() > 1 and float(v["t"]) >= 1.0:
			base += cr * (0.55 if mates.find(uid) == 0 else -0.55)
		var size: Vector2 = v["size"]
		node.position = base + Vector3(0, size.y / 2.0 + 0.02, 0)
		node.rotation.y = cam.rotation.y
		# which view of the monster: it faces F; we look along cf
		var f = Vector3(DX[int(m["dir"])], 0, DY[int(m["dir"])])
		var toward = -f.dot(cf)            # > 0: facing us
		var tags: Dictionary = A.meta(v["key"])["tags"]
		var frame = 0
		var flip = false
		var walking: bool = float(v["t"]) < 1.0
		var step_frame = int(float(v["phase"]) / 0.18) % 2
		if String(v["anim"]) == "attack" and float(v["anim_t"]) < 0.45 and tags.has("attack"):
			frame = int(tags["attack"][0]) + (0 if float(v["anim_t"]) < 0.2 else 1)
		elif String(v["anim"]) == "hurt" and float(v["anim_t"]) < 0.25 and tags.has("hurt"):
			frame = int(tags["hurt"][0])
		elif toward < -0.5 and tags.has("back"):
			frame = int(tags["back"][0]) + (step_frame if walking else 0)
		elif toward <= 0.5 and tags.has("side"):
			frame = int(tags["side"][0]) + (step_frame if walking else 0)
			flip = f.dot(cr) < 0.0
		else:
			frame = int(tags["idle"][0]) + (int(float(v["phase"]) / 0.45) % 2)
		var mat: ShaderMaterial = node.material_override
		mat.set_shader_parameter("region", A.region(v["key"], frame))
		mat.set_shader_parameter("flip", flip)
		v["flash"] = maxf(0.0, float(v["flash"]) - delta * 4.0)
		mat.set_shader_parameter("flash", float(v["flash"]))


func _update_items() -> void:
	var sig = str(g.ls["items"]) + str(g.ls["niches"])
	if sig == items_sig:
		for n in item_nodes:
			n.rotation.y = cam.rotation.y
		return
	items_sig = sig
	for n in item_nodes:
		n.queue_free()
	item_nodes.clear()
	for key in g.ls["items"]:
		var k = int(key)
		var c = k >> 2
		var corner = k & 3
		var pile: Array = g.ls["items"][key]
		for i in pile.size():
			var it: Dictionary = pile[i]
			var icon = "items/" + String(g.item_def(it).get("icon", "bone"))
			var mi = _mesh_quad(icon, Vector2(0.48, 0.48))
			var off: Vector2 = CORNER[corner] * (1.0 - 0.12 * i)
			mi.position = cell_pos(c) + Vector3(off.x, 0.25 + 0.05 * i, off.y)
			mi.rotation.y = cam.rotation.y
			mi.set_meta("pile", [c, corner])
			dyn_root.add_child(mi)
			item_nodes.append(mi)
	for key in g.ls["niches"]:
		var fi = int(key)
		var d = fi & 3
		var items: Array = g.ls["niches"][key]
		for i in items.size():
			var icon = "items/" + String(g.item_def(items[i]).get("icon", "bone"))
			var mi = _mesh_quad(icon, Vector2(0.4, 0.4))
			var fwd = Vector3(DX[d], 0, DY[d])
			var right = Vector3(-DY[d], 0, DX[d])
			mi.position = cell_pos(fi >> 2) + fwd * 0.85 + right * (0.18 * i - 0.1) + Vector3(0, 0.62, 0)
			mi.rotation.y = _face_basis(fwd)
			mi.set_meta("niche", fi)
			dyn_root.add_child(mi)
			item_nodes.append(mi)


# ------------------------------------------------------------------ camera

func eye_for(c: int, d: int) -> Vector3:
	return cell_pos(c) - Vector3(DX[d], 0, DY[d]) * CAM_BACK + Vector3(0, EYE, 0)


func snap_camera() -> void:
	var d = int(g.s["dir"])
	cam_to = eye_for(g.cur_cell(), d)
	cam_from = cam_to
	yaw_to = -d * PI / 2.0
	yaw_from = yaw_to
	cam_t = 1.0
	cam.position = cam_to
	cam.rotation = Vector3(0, yaw_to, 0)


func move_camera(animated: bool) -> void:
	var d = int(g.s["dir"])
	cam_from = cam.position
	yaw_from = cam.rotation.y
	cam_to = eye_for(g.cur_cell(), d)
	var target = -d * PI / 2.0
	# shortest turn
	while target - yaw_from > PI:
		target -= TAU
	while target - yaw_from < -PI:
		target += TAU
	yaw_to = target
	var turning = absf(yaw_to - yaw_from) > 0.01
	cam_dur = TURN_TIME if turning and cam_from.distance_to(cam_to) < 0.1 else STEP_TIME
	cam_t = 0.0 if animated else 1.0
	if not animated:
		cam.position = cam_to
		cam.rotation.y = yaw_to


func _update_camera(delta: float) -> void:
	if demo:
		cam.rotation.y += delta * 0.12
		return
	if cam_t < 1.0:
		cam_t = minf(1.0, cam_t + delta / cam_dur)
		var k = cam_t * cam_t * (3.0 - 2.0 * cam_t)
		cam.position = cam_from.lerp(cam_to, k)
		cam.rotation.y = lerpf(yaw_from, yaw_to, k)
	else:
		cam.position = cam_to
		cam.rotation.y = yaw_to
	var off = Vector3.ZERO
	if bump_t < 1.0:
		bump_t = minf(1.0, bump_t + delta / 0.18)
		off += bump_dir * sin(bump_t * PI) * 0.18
	if shake > 0.0:
		shake = maxf(0.0, shake - delta)
		off += Vector3(randf_range(-1, 1), randf_range(-1, 1), 0) * shake * 0.06
	cam.position += off


# ------------------------------------------------------------------ per frame

func update(delta: float) -> void:
	time += delta
	_update_camera(delta)
	# doors slide up into the ceiling as they open
	for key in doors:
		var dd: Dictionary = doors[key]
		var p = float(g.ls["doors"].get(key, {"p": 0.0})["p"])
		var h: float = dd["h"]
		dd["node"].position.y = h / 2.0 + p * (h - 0.12)
	for c in teles:
		teles[c].visible = bool(g.ls["tele"].get(str(c), true))
	# animated textures (water, torches, teleports)
	for am in anim_mats:
		var n: int = am[2]
		var fr = int(time / 0.14) % n
		am[0].set_shader_parameter("region", A.region(am[1], fr))
	# the party's torch flickers a little
	var flick = 0.9 + 0.06 * sin(time * 7.3) + 0.04 * sin(time * 13.1)
	for m in mats:
		m.set_shader_parameter("torch", flick)
	_sync_mobs()
	_update_mobs(delta)
	_update_items()


# ------------------------------------------------------------------ picking

## What is under a click in the 3D view (pos in view pixels).
func pick(pos: Vector2) -> Dictionary:
	# items and monsters first: their sprites stand in front of walls
	var best = {}
	var best_d = 1e9
	for n in item_nodes:
		var r = _screen_rect(n, 0.48)
		if r.has_point(pos):
			var d: float = cam.global_position.distance_to(n.global_position)
			if d < best_d:
				best_d = d
				best = {"kind": "niche", "face": int(n.get_meta("niche"))} if n.has_meta("niche") else {"kind": "pile", "cell": n.get_meta("pile")[0], "corner": n.get_meta("pile")[1]}
	for uid in mobs:
		var v: Dictionary = mobs[uid]
		var r = _screen_rect(v["node"], (v["size"] as Vector2).x * 0.6)
		if r.has_point(pos):
			var d: float = cam.global_position.distance_to(v["node"].global_position)
			if d < best_d:
				best_d = d
				best = {"kind": "mob", "uid": uid}
	if not best.is_empty():
		return best
	var o = cam.project_ray_origin(pos)
	var dir = cam.project_ray_normal(pos)
	# the wall (or door) ahead of the party's own square
	var d = int(g.s["dir"])
	var c: int = g.cur_cell()
	var fwd = Vector3(DX[d], 0, DY[d])
	var plane_p = cell_pos(c) + fwd
	var denom = dir.dot(fwd)
	var t_wall = 1e9
	if denom > 0.0001:
		t_wall = (plane_p - o).dot(fwd) / denom
	var t_floor = 1e9
	if dir.y < -0.0001:
		t_floor = -o.y / dir.y
	var f: Dictionary = g.lv.faces[c * 4 + d]
	if t_wall < t_floor and not g.face_passable(c * 4 + d):
		var hit = o + dir * t_wall
		var right = Vector3(-fwd.z, 0, fwd.x)
		var u = (hit - plane_p).dot(right)
		var v = hit.y
		var near_fitting: bool = absf(u) < 0.6 and v > 0.4 and v < 1.8
		return {"kind": "face", "face": c * 4 + d, "fitting": near_fitting}
	if t_floor < 1e8:
		var hit = o + dir * t_floor
		var cx = int(roundf(hit.x / CELL))
		var cz = int(roundf(hit.z / CELL))
		if g.lv.valid(cx, cz):
			var lx = hit.x - cx * CELL
			var lz = hit.z - cz * CELL
			var corner = 0
			if lx >= 0 and lz < 0:
				corner = 1
			elif lx >= 0 and lz >= 0:
				corner = 2
			elif lx < 0 and lz >= 0:
				corner = 3
			return {"kind": "floor", "cell": g.lv.idx(cx, cz), "corner": corner}
	return {}


func _screen_rect(n: Node3D, width_m: float) -> Rect2:
	if cam.is_position_behind(n.global_position):
		return Rect2()
	var p = n.global_position
	var right = cam.global_transform.basis.x
	var top = cam.unproject_position(p + Vector3(0, width_m * 0.55, 0))
	var bot = cam.unproject_position(p - Vector3(0, width_m * 0.55, 0))
	var lft = cam.unproject_position(p - right * width_m * 0.5)
	var rgt = cam.unproject_position(p + right * width_m * 0.5)
	return Rect2(Vector2(lft.x, top.y), Vector2(rgt.x - lft.x, bot.y - top.y))
