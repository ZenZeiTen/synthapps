## The input map for keyboard and gamepad, built at start (so it cannot drift from the
## Controls page), the three button layouts of the Options (DESIGN: control choice), and
## which device was used last (for the button names shown on screen).
##
## Pads go through Godot's joypad API (SDL game-controller mappings). The D-pad and the left
## stick move. Layout 1: south (A / Cross) jumps, west (X / Square) attacks, east (B /
## Circle) uses the item, north (Y / Triangle) is the Tide Cleave. Start pauses.
extends Node

const DEADZONE := 0.45

const KEYS := {
	"left": [KEY_LEFT, KEY_A], "right": [KEY_RIGHT, KEY_D], "up": [KEY_UP, KEY_W], "down": [KEY_DOWN, KEY_S],
	"jump": [KEY_Z, KEY_K, KEY_SPACE], "attack": [KEY_X, KEY_J], "item": [KEY_C, KEY_L],
	"special": [KEY_V, KEY_I], "pause": [KEY_ENTER, KEY_ESCAPE, KEY_KP_ENTER],
	"accept": [KEY_ENTER, KEY_KP_ENTER, KEY_SPACE, KEY_Z], "back": [KEY_ESCAPE, KEY_BACKSPACE, KEY_C],
}
# pad buttons per layout: [jump, attack, item]
const LAYOUTS := [
	[JOY_BUTTON_A, JOY_BUTTON_X, JOY_BUTTON_B],
	[JOY_BUTTON_X, JOY_BUTTON_A, JOY_BUTTON_B],
	[JOY_BUTTON_B, JOY_BUTTON_A, JOY_BUTTON_X],
]
const LAYOUT_NAMES := ["A jump, X attack", "X jump, A attack", "B jump, A attack"]
const PAD_FIXED := {
	"left": [JOY_BUTTON_DPAD_LEFT], "right": [JOY_BUTTON_DPAD_RIGHT], "up": [JOY_BUTTON_DPAD_UP],
	"down": [JOY_BUTTON_DPAD_DOWN], "special": [JOY_BUTTON_Y], "pause": [JOY_BUTTON_START],
	"accept": [JOY_BUTTON_A], "back": [JOY_BUTTON_B],
}
const PAD_AXES := {
	"left": [JOY_AXIS_LEFT_X, -1.0], "right": [JOY_AXIS_LEFT_X, 1.0],
	"up": [JOY_AXIS_LEFT_Y, -1.0], "down": [JOY_AXIS_LEFT_Y, 1.0],
}

var last_device := "keyboard"
var layout := 0

signal device_changed(kind: String)


func _ready() -> void:
	setup_actions(layout)
	Input.joy_connection_changed.connect(_on_joy)
	if not Input.get_connected_joypads().is_empty():
		last_device = "pad"


static func setup_actions(lay: int) -> void:
	var pads: Array = LAYOUTS[clampi(lay, 0, 2)]
	var pad_of := {"jump": [pads[0]], "attack": [pads[1]], "item": [pads[2]]}
	for action in KEYS:
		if InputMap.has_action(action):
			InputMap.erase_action(action)
		InputMap.add_action(action, DEADZONE)
		for k in KEYS[action]:
			var e := InputEventKey.new()
			e.physical_keycode = k
			InputMap.action_add_event(action, e)
		for b in pad_of.get(action, PAD_FIXED.get(action, [])):
			var j := InputEventJoypadButton.new()
			j.button_index = b
			j.device = -1
			InputMap.action_add_event(action, j)
		if PAD_AXES.has(action):
			var m := InputEventJoypadMotion.new()
			m.axis = PAD_AXES[action][0]
			m.axis_value = PAD_AXES[action][1]
			m.device = -1
			InputMap.action_add_event(action, m)


func set_layout(lay: int) -> void:
	layout = clampi(lay, 0, 2)
	setup_actions(layout)


func _on_joy(_device: int, connected: bool) -> void:
	if connected:
		_set_device("pad")
	elif Input.get_connected_joypads().is_empty():
		_set_device("keyboard")


func note_event(e: InputEvent) -> void:
	if e is InputEventJoypadButton and e.pressed:
		_set_device("pad")
	elif e is InputEventJoypadMotion and absf(e.axis_value) > DEADZONE:
		_set_device("pad")
	elif e is InputEventKey and e.pressed:
		_set_device("keyboard")


func _set_device(k: String) -> void:
	if k != last_device:
		last_device = k
		device_changed.emit(k)


## The held state the core reads each step.
static func held() -> Dictionary:
	return {"dx": int(Input.is_action_pressed("right")) - int(Input.is_action_pressed("left")),
		"dy": int(Input.is_action_pressed("down")) - int(Input.is_action_pressed("up")),
		"jump": Input.is_action_pressed("jump"), "attack": Input.is_action_pressed("attack"),
		"item": Input.is_action_pressed("item"), "special": Input.is_action_pressed("special")}


## A button name for prompts, following the last device used.
func label(action: String) -> String:
	if last_device == "pad":
		var names := {JOY_BUTTON_A: "A", JOY_BUTTON_B: "B", JOY_BUTTON_X: "X", JOY_BUTTON_Y: "Y"}
		var pads: Array = LAYOUTS[layout]
		match action:
			"jump": return names[pads[0]]
			"attack": return names[pads[1]]
			"item": return names[pads[2]]
			"special": return "Y"
			"pause": return "START"
			"accept": return "A"
			"back": return "B"
	return {"jump": "Z", "attack": "X", "item": "C", "special": "V", "pause": "ENTER", "accept": "ENTER",
		"back": "ESC"}.get(action, action.to_upper())
