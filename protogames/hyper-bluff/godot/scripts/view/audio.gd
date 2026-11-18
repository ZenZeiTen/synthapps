extends Node
## Sound: a small pool of players for effects and one looping music player.

const SFX := ["allin", "cancel", "card_deal", "card_flip", "check", "chip_bet", "chip_win", "cutin",
	"error", "fever", "fold", "lose_hand", "meter_tick", "move", "ok", "powerup", "roulette_tick",
	"star", "type", "win_hand"]
const MUSIC := ["title", "match", "boss", "fever", "ending", "victory", "defeat"]
const LOOPS := ["title", "match", "boss", "fever", "ending"]

var _sfx := {}
var _music := {}
var _pool: Array = []
var _next := 0
var _player: AudioStreamPlayer
var current := ""
var last_sfx := ""
var sfx_volume := 8
var music_volume := 7

func _ready() -> void:
	for n in SFX:
		var p := "res://assets/audio/%s.wav" % n
		if ResourceLoader.exists(p):
			_sfx[n] = load(p)
	for n in MUSIC:
		var p := "res://assets/audio/%s.ogg" % n
		if ResourceLoader.exists(p):
			_music[n] = load(p)
			if _music[n] is AudioStreamOggVorbis:
				_music[n].loop = LOOPS.has(n)
	for _i in 8:
		var a := AudioStreamPlayer.new()
		add_child(a)
		_pool.append(a)
	_player = AudioStreamPlayer.new()
	add_child(_player)
	apply_volume()

static func _db(v: int) -> float:
	return -80.0 if v <= 0 else linear_to_db(float(v) / 10.0)

func apply_volume() -> void:
	for a in _pool:
		a.volume_db = _db(sfx_volume)
	_player.volume_db = _db(music_volume) - 4.0

func play(n: String) -> void:
	if n != "meter_tick" and n != "type":
		last_sfx = n
	if not _sfx.has(n):
		return
	var a: AudioStreamPlayer = _pool[_next]
	_next = (_next + 1) % _pool.size()
	a.stream = _sfx[n]
	a.play()

func music(n: String) -> void:
	if n == current:
		return
	current = n
	_player.stop()
	if _music.has(n):
		_player.stream = _music[n]
		_player.play()
