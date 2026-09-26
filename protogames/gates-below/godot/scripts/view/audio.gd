## Sound effects (a small pool of players) and looping music with a short crossfade.
## Volume of positional effects comes from the core (the original's distance curve).
extends Node

var A
var sfx_players: Array = []
var music_a: AudioStreamPlayer
var music_b: AudioStreamPlayer
var current = ""
var sound_on = true
var music_on = true
const MUSIC_DB := -9.0


func setup(assets) -> void:
	A = assets
	for i in 10:
		var p = AudioStreamPlayer.new()
		add_child(p)
		sfx_players.append(p)
	music_a = AudioStreamPlayer.new()
	music_b = AudioStreamPlayer.new()
	add_child(music_a)
	add_child(music_b)


func play(name: String, vol: float = 1.0) -> void:
	if not sound_on or vol <= 0.01:
		return
	var s: AudioStream = A.wav("sfx/" + name)
	if s == null:
		return
	for p in sfx_players:
		if not p.playing:
			p.stream = s
			p.volume_db = linear_to_db(clampf(vol, 0.05, 1.0)) - 4.0
			p.pitch_scale = randf_range(0.96, 1.04)
			p.play()
			return


func music(track: String) -> void:
	if track == current:
		return
	current = track
	var s: AudioStream = A.wav("music/" + track)
	if s is AudioStreamWAV:
		(s as AudioStreamWAV).loop_mode = AudioStreamWAV.LOOP_FORWARD
		(s as AudioStreamWAV).loop_end = (s as AudioStreamWAV).get_length() * (s as AudioStreamWAV).mix_rate
	var old = music_a
	music_a = music_b
	music_b = old
	var tw = create_tween()
	tw.tween_property(music_b, "volume_db", -60.0, 0.6)
	tw.tween_callback(music_b.stop)
	if s == null or not music_on:
		return
	music_a.stream = s
	music_a.volume_db = -40.0
	music_a.play()
	var tw2 = create_tween()
	tw2.tween_property(music_a, "volume_db", MUSIC_DB, 0.8)


func set_music_on(on: bool) -> void:
	music_on = on
	if not on:
		music_a.stop()
		music_b.stop()
	else:
		var t = current
		current = ""
		music(t)
