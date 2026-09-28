class_name GameAudio
extends Node
## Sound effects by name (content/audio/sfx/<name>.wav) and looping music
## (content/audio/music/<track>_<set>.wav, set = "16" arranged or "8" chip).
## Files are read raw so exports carry them byte for byte. Missing files are silent.

var _sfx_cache: Dictionary = {}
var _players: Array[AudioStreamPlayer] = []
var _music: AudioStreamPlayer = null
var _music_name := ""
var sfx_volume := 0.8
var music_volume := 0.7
var soundtrack := "16"
var loaded_tracks: Dictionary = {}   # for tests: track -> sample count


func _ready() -> void:
	for i in 10:
		var p := AudioStreamPlayer.new()
		add_child(p)
		_players.append(p)
	_music = AudioStreamPlayer.new()
	add_child(_music)


static func load_wav(path: String, loop: bool) -> AudioStreamWAV:
	if not FileAccess.file_exists(path):
		return null
	var bytes := FileAccess.get_file_as_bytes(path)
	var w := AudioStreamWAV.load_from_buffer(bytes)
	if w == null:
		return null
	if loop:
		w.loop_mode = AudioStreamWAV.LOOP_FORWARD
		var frames := w.get_length() * w.mix_rate
		w.loop_begin = 0
		w.loop_end = int(round(frames))
	return w


func play(name: String) -> void:
	var st: AudioStreamWAV = null
	if _sfx_cache.has(name):
		st = _sfx_cache[name]
	else:
		st = load_wav("res://content/audio/sfx/%s.wav" % name, false)
		_sfx_cache[name] = st
	if st == null:
		return
	# the same sound restarts its own voice instead of stacking
	for p in _players:
		if p.stream == st and p.playing:
			p.play()
			return
	for p in _players:
		if not p.playing:
			p.stream = st
			p.volume_db = linear_to_db(maxf(sfx_volume, 0.0001))
			p.play()
			return
	_players[0].stream = st
	_players[0].play()


func music(track: String) -> void:
	var key := track + "_" + soundtrack
	if key == _music_name:
		return
	_music_name = key
	_music.stop()
	if track == "":
		return
	var st := load_wav("res://content/audio/music/%s.wav" % key, true)
	if st == null:
		return
	loaded_tracks[key] = st.get_length()
	_music.stream = st
	_music.volume_db = linear_to_db(maxf(music_volume, 0.0001))
	_music.play()


func set_volumes(m: float, s: float) -> void:
	music_volume = m
	sfx_volume = s
	if _music != null:
		_music.volume_db = linear_to_db(maxf(m, 0.0001))


func current() -> String:
	return _music_name


func stop_all() -> void:
	_music.stop()
	for p in _players:
		p.stop()
