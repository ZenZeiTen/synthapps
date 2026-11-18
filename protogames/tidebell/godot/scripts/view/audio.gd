## Sound effects over a few voices (a new sound takes a free voice, else the oldest), and
## looping music with a short crossfade. Volumes come from the options.
extends Node

const VOICES := 6

var A
var voices: Array = []
var started: Array = []
var music_a: AudioStreamPlayer
var music_b: AudioStreamPlayer
var current := ""
var sfx_vol := 0.9
var music_vol := 0.7
var fade := 0.0


func setup(assets) -> void:
	A = assets
	for i in VOICES:
		var p := AudioStreamPlayer.new()
		add_child(p)
		voices.append(p)
		started.append(0)
	music_a = AudioStreamPlayer.new()
	music_b = AudioStreamPlayer.new()
	add_child(music_a)
	add_child(music_b)


func db(v: float) -> float:
	return linear_to_db(maxf(v, 0.0001))


func play(name: String) -> void:
	var s: AudioStream = A.sound("sfx/" + name)
	if s == null or sfx_vol <= 0.0:
		return
	var best := 0
	for i in VOICES:
		if not voices[i].playing:
			best = i
			break
		if started[i] < started[best]:
			best = i
	voices[best].stream = s
	voices[best].volume_db = db(sfx_vol) - 4.0
	voices[best].play()
	started[best] = Time.get_ticks_msec()


func music(track: String) -> void:
	if track == current:
		return
	current = track
	var s: AudioStream = A.sound("music/" + track) if track != "" and track != "none" else null
	if s is AudioStreamOggVorbis:
		(s as AudioStreamOggVorbis).loop = not (track in ["clear", "over"])
	var old := music_a
	music_a = music_b
	music_b = old
	fade = 0.0
	if s != null:
		music_a.stream = s
		music_a.volume_db = -60.0
		music_a.play()
	else:
		music_a.stop()


func set_volumes(m: float, s: float) -> void:
	music_vol = m
	sfx_vol = s


func _process(delta: float) -> void:
	fade = minf(fade + delta * 2.5, 1.0)
	if music_a.playing:
		music_a.volume_db = db(music_vol * fade) - 6.0
	if music_b.playing:
		music_b.volume_db = db(music_vol * (1.0 - fade)) - 6.0
		if fade >= 1.0:
			music_b.stop()
