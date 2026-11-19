## Loads every script so parse errors show up in one run.
extends SceneTree
func _init() -> void:
	for p in ["res://scripts/core/game.gd", "res://scripts/core/kinds.gd", "res://scripts/core/level.gd"]:
		var s = load(p)
		print(p, " ", s != null)
	quit()
