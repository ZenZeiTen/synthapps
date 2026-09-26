## Input map for keyboard and gamepad, built at startup (so it cannot drift from the docs),
## plus tracking of which device was used last (for on-screen button names).
##
## Gamepads go through Godot's joypad API (SDL game-controller mappings): the D-pad and the
## left stick move; south (A / Cross) jumps; west (X / Square) and east (B / Circle) fire;
## north (Y / Triangle) opens the items screen; Start opens the menu; Back / Select opens
## Tolly's pack. In menus, south confirms and east goes back.
extends Node

const DEADZONE := 0.45

const KEYS := {
	"left": [KEY_LEFT, KEY_A, KEY_KP_4],
	"right": [KEY_RIGHT, KEY_D, KEY_KP_6],
	"up": [KEY_UP, KEY_W, KEY_KP_8],
	"down": [KEY_DOWN, KEY_S, KEY_KP_2],
	"jump": [KEY_Z, KEY_K, KEY_ALT, KEY_CTRL],
	"fire": [KEY_X, KEY_J, KEY_SHIFT, KEY_SPACE],
	"items": [KEY_I, KEY_ENTER, KEY_KP_ENTER],
	"shop": [KEY_B],
	"menu": [KEY_ESCAPE, KEY_P],
	"help": [KEY_F1],
	"accept": [KEY_ENTER, KEY_KP_ENTER, KEY_SPACE, KEY_Z],
	"back": [KEY_ESCAPE, KEY_X, KEY_BACKSPACE],
}
const PAD_BUTTONS := {
	"left": [JOY_BUTTON_DPAD_LEFT], "right": [JOY_BUTTON_DPAD_RIGHT],
	"up": [JOY_BUTTON_DPAD_UP], "down": [JOY_BUTTON_DPAD_DOWN],
	"jump": [JOY_BUTTON_A], "fire": [JOY_BUTTON_X, JOY_BUTTON_B],
	"items": [JOY_BUTTON_Y], "shop": [JOY_BUTTON_BACK], "menu": [JOY_BUTTON_START],
	"accept": [JOY_BUTTON_A], "back": [JOY_BUTTON_B],
}
const PAD_AXES := {
	"left": [JOY_AXIS_LEFT_X, -1.0], "right": [JOY_AXIS_LEFT_X, 1.0],
	"up": [JOY_AXIS_LEFT_Y, -1.0], "down": [JOY_AXIS_LEFT_Y, 1.0],
}

var last_device := "keyboard"    # or "pad"
var pads: Array = []

signal device_changed(kind: String)


func _ready() -> void:
	setup_actions()
	Input.joy_connection_changed.connect(_on_joy)
	pads = Input.get_connected_joypads()
	if not pads.is_empty():
		last_device = "pad"


static func setup_actions() -> void:
	for action in KEYS:
		if InputMap.has_action(action):
			InputMap.erase_action(action)
		InputMap.add_action(action, DEADZONE)
		for k in KEYS[action]:
			var e := InputEventKey.new()
			e.physical_keycode = k
			InputMap.action_add_event(action, e)
		for b in PAD_BUTTONS.get(action, []):
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


func _on_joy(device: int, connected: bool) -> void:
	pads = Input.get_connected_joypads()
	if connected:
		_set_device("pad")
	elif pads.is_empty():
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


## The per-step input for the core: held directions and buttons.
static func held() -> Dictionary:
	var dx := int(Input.is_action_pressed("right")) - int(Input.is_action_pressed("left"))
	var dy := int(Input.is_action_pressed("down")) - int(Input.is_action_pressed("up"))
	return {"dx": dx, "dy": dy, "fire1": Input.is_action_pressed("fire"), "fire2": Input.is_action_pressed("jump")}


## A button name for prompts, following the last device used.
func label(action: String) -> String:
	if last_device == "pad":
		return {"jump": "A", "fire": "X", "items": "Y", "shop": "BACK", "menu": "START", "accept": "A",
			"back": "B"}.get(action, action.to_upper())
	return {"jump": "Z", "fire": "X", "items": "I", "shop": "B", "menu": "ESC", "accept": "ENTER",
		"back": "ESC"}.get(action, action.to_upper())
