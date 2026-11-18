## Sound effects with the source's priorities (MUSIC.C snd_play: a sound only interrupts one of
## equal or lower priority) over a few voices, and looping music with a short crossfade.
extends Node

const VOICES := 4

var A
var voices: Array = []
var prio: Array = []
var music_a: AudioStreamPlayer
var music_b: AudioStreamPlayer
var current := ""
var sfx_db := -6.0
var music_db := -10.0


func setup(assets) -> void:
	A = assets
	for i in VOICES:
		var p := AudioStreamPlayer.new()
		add_child(p)
		voices.append(p)
		prio.append(0)
	music_a = AudioStreamPlayer.new()
	music_b = AudioStreamPlayer.new()
	add_child(music_a)
	add_child(music_b)


func play(name: String, pri: int = 2) -> void:
	var s: AudioStream = A.sound("sfx/" + name)
	if s == null:
		return
	# a free voice, else the lowest-priority one that this sound may interrupt
	var best := -1
	for i in VOICES:
		if not voices[i].playing:
			best = i
			break
	if best < 0:
		var low := 99
		for i in VOICES:
			if prio[i] <= pri and prio[i] < low:
				low = prio[i]
				best = i
	if best < 0:
		return
	voices[best].stream = s
	voices[best].volume_db = sfx_db
	voices[best].play()
	prio[best] = pri


func music(track: String) -> void:
	if track == current:
		return
	current = track
	var s: AudioStream = A.sound("music/" + track) if track != "" else null
	if s is AudioStreamOggVorbis:
		(s as AudioStreamOggVorbis).loop = track != "clear"
	var old := music_a
	music_a = music_b
	music_b = old
	if music_b.playing:
		var tw := create_tween()
		tw.tween_property(music_b, "volume_db", -60.0, 0.5)
		tw.tween_callback(music_b.stop)
	if s == null:
		return
	music_a.stream = s
	music_a.volume_db = -40.0
	music_a.play()
	var tw2 := create_tween()
	tw2.tween_property(music_a, "volume_db", music_db, 0.6)


func set_volumes(sfx: float, mus: float) -> void:
	# 0..1 sliders
	sfx_db = linear_to_db(maxf(sfx, 0.001)) - 6.0
	music_db = linear_to_db(maxf(mus, 0.001)) - 10.0
	music_a.volume_db = music_db
