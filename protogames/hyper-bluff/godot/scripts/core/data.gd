extends RefCounted
## Cast, powers, missions and story text. All of it original.

const AVATARS := ["rin", "mako", "jiro", "aya"]
## The ladder: five main floors with a mini-boss (a warden of the stairs) between each.
const RIVALS := ["pochi", "tetsu", "goro", "suzu", "yuki", "kagero", "zeno", "q7", "onyx"]
const EXPR := ["neutral", "happy", "shock", "defeat", "fierce"]

## loose: calls lighter. aggr: bets and raises more. bluff: bets weak hands.
const CAST := {
	"rin": {"name": "Rin Hoshikawa", "title": "Comet Rookie", "shout": "BURN, MY LUCK!!",
		"blurb": "Hot-blooded and reckless. Bets with the heart first."},
	"mako": {"name": "Mako Tendo", "title": "Azure Ace", "shout": "READ AND DESTROY!!",
		"blurb": "Cool, exact, and never seen sweating."},
	"jiro": {"name": "Jiro Kanzaki", "title": "Drifting Gambler", "shout": "LET IT RIDE, BABY!!",
		"blurb": "Easygoing drifter who naps between all-ins."},
	"aya": {"name": "Aya Kurogane", "title": "Moonlit Seer", "shout": "THE STARS HAVE SPOKEN!!",
		"blurb": "Reads fortunes. Claims the deck whispers to her."},
	"pochi": {"name": "Pochi Maruyama", "title": "Rookie Dealer", "shout": "I-I'LL DO MY BEST!!",
		"loose": 0.9, "aggr": 0.15, "bluff": 0.04, "powers": [],
		"room": 1, "episode": "THE LOBBY PIT",
		"lore": ["Every challenger starts here, under warm lamps and the clatter of slot machines.",
			"The house deals the first game itself, through its newest dealer. Most challengers underestimate her. Most go home."],
		"intro": ["Welcome to the Starlight Showdown! I'm Pochi, your first opponent!",
			"I only learned the rules last week... but I won't fold! Ever! Probably!"],
		"win": ["Eh?! I won?! Yay!", "Chips! So many chips!"],
		"lose": ["Waaah! My stack!", "T-that was just practice!"],
		"allin": ["Everything! I'm pushing everything!"],
		"beaten": ["You're amazing... Go get them, okay? I'll cheer from the pit!"],
		"gloat": ["I did it! Boss, did you see?! ...Sorry about your chips."]},
	"goro": {"name": "Thunder Goro Daimon", "title": "Highway Shogun", "shout": "THUNDER RAISE!!",
		"loose": 0.6, "aggr": 0.85, "bluff": 0.33, "powers": ["glare"],
		"room": 2, "episode": "THE GARAGE DECK",
		"lore": ["Concrete, engine oil, and a card table bolted to the floor of the tower's parking deck.",
			"Goro Daimon once raced the highways below for pink slips. Now he races stacks, and he has never once braked."],
		"intro": ["So you squeaked past the kid. HAH! I raise like a ten-ton truck!",
			"Fold now and I'll let you keep your shoelaces!"],
		"win": ["GWAHAHA! Flattened!", "That's the sound of thunder, pal!"],
		"lose": ["Tch! Lucky punk!", "My bike payment was in that pot!"],
		"allin": ["FULL THROTTLE! ALL IN!"],
		"beaten": ["...Heh. You ride hard. Take the next floor, and don't you dare lose."],
		"gloat": ["Road's closed, kid. Come back with a bigger engine!"]},
	"yuki": {"name": "Lady Shirayuki", "title": "Frozen Camellia", "shout": "FREEZE, AND FOLD.",
		"loose": 0.15, "aggr": 0.5, "bluff": 0.07, "powers": ["guard", "hawk"],
		"room": 3, "episode": "THE SNOW GARDEN",
		"lore": ["Snow falls indoors here all year, from a ceiling no one has ever seen.",
			"Lady Shirayuki's family built the tower's first card room. She plays to win it back, one cold hand at a time."],
		"intro": ["How noisy. The tower lets anyone in tonight, it seems.",
			"I play only hands worth playing. Do try to be worth my time."],
		"win": ["As expected.", "Snow falls. Chips follow."],
		"lose": ["...A fluke. Nothing more.", "How dare you melt my stack."],
		"allin": ["Enough. All of it. Shiver."],
		"beaten": ["...Warm. I had forgotten. Go. The Professor waits above."],
		"gloat": ["Do close the door on your way out. There's a draft."]},
	"zeno": {"name": "Professor Zeno Quark", "title": "Odds Alchemist", "shout": "EUREKA!! CALCULATED!!",
		"loose": 0.5, "aggr": 0.6, "bluff": 0.18, "powers": ["sight", "swap", "hawk"],
		"room": 4, "episode": "THE ODDS LABORATORY",
		"lore": ["Monitors hum with numbers nobody asked for. Something on the workbench is ticking.",
			"Professor Quark swears he can calculate the Crown's whisper. He has been wrong forty-one times. He says he is due."],
		"intro": ["Fascinating! A live specimen! My formulas put your win chance at 12.7 percent!",
			"Let us test the hypothesis. For science! And for my grant money!"],
		"win": ["As the numbers foretold!", "Quod erat demon-STRAIGHT!"],
		"lose": ["Impossible! Recalculating!", "An outlier! A statistical ghost!"],
		"allin": ["Maximum variance! ALL IN!"],
		"beaten": ["My formulas... never counted guts. The Baron is past that door. Beware his mask!"],
		"gloat": ["Hypothesis confirmed! Please exit through the gift shop!"]},
	"onyx": {"name": "Baron Onyx", "title": "The Midnight Joker", "shout": "KNEEL TO THE JOKER!!",
		"loose": 0.55, "aggr": 0.75, "bluff": 0.25, "powers": ["swap", "glare", "guard", "hawk"],
		"room": 5, "episode": "THE STARLIGHT TABLE",
		"lore": ["The last door opens onto the roof of the world, and a table older than the tower itself."],
		"intro": ["So. A challenger reaches the Starlight Table.",
			"Every chip in this city ends its night in my hand. Yours will too."],
		"win": ["The night is mine.", "Dance, little card."],
		"lose": ["...Interesting.", "You dare?!"],
		"allin": ["Midnight strikes. ALL IN."],
		"beaten": ["Hah... ha ha! The mask slips. Take the crown, champion. Tonight, the stars are yours."],
		"gloat": ["The tower keeps its crown. Leave your luck at the door."]},
	"tetsu": {"name": "Tetsu Kanabo", "title": "Lobby Bouncer", "shout": "NOBODY GETS PAST!!",
		"loose": 0.8, "aggr": 0.3, "bluff": 0.05, "powers": ["guard"], "mini": true, "stack": 500,
		"room": 1, "episode": "THE STAIRWELL",
		"lore": ["Between the Lobby Pit and the Garage Deck there is one staircase, and one very large man standing on it."],
		"intro": ["Name's Tetsu. Nobody climbs these stairs without beating me at cards.",
			"Pochi's my little cousin. You made her cry. ...She says you were nice about it. Still."],
		"win": ["Hmph.", "Wall holds."],
		"lose": ["...Okay. That one stung.", "Tch."],
		"allin": ["Wall comes down on you. ALL IN."],
		"beaten": ["The wall cracks. Go on up. And watch the biker. He doesn't brake."],
		"gloat": ["Stairs are closed. Lobby's that way."]},
	"suzu": {"name": "Suzu Hayate", "title": "Pit-Crew Ace", "shout": "FULL TUNE-UP!!",
		"loose": 0.6, "aggr": 0.7, "bluff": 0.25, "powers": ["swap"], "mini": true, "stack": 500,
		"room": 2, "episode": "THE PIT LANE",
		"lore": ["Goro's mechanic has rigged the freight lift to the next floor. She wants one hand of cards for the key."],
		"intro": ["Boss lost? To YOU? Okay, okay. I gotta see this for myself.",
			"Win and the lift key's yours. Lose and you're washing the bike."],
		"win": ["Zoom! Ha!", "Tuned and tight!"],
		"lose": ["Ow, my gears!", "Pit stop, pit stop!"],
		"allin": ["Redline! Everything goes!"],
		"beaten": ["Fine, fine, the key's yours. Mind the cold up there. The Lady keeps it like a freezer."],
		"gloat": ["Sponge is by the bucket. Start with the wheels!"]},
	"kagero": {"name": "Kagero", "title": "Silent Attendant", "shout": "......!!",
		"loose": 0.3, "aggr": 0.55, "bluff": 0.15, "powers": ["hawk"], "mini": true, "stack": 500,
		"room": 3, "episode": "THE TEA ROOM",
		"lore": ["A silent attendant pours tea and deals cards, and never once looks up from the table."],
		"intro": ["......", "(The attendant slides a cup of tea toward you, then a stack of chips.)"],
		"win": ["......", "(A small bow.)"],
		"lose": ["...!", "(The teacup trembles.)"],
		"allin": ["(Every chip moves forward at once.)"],
		"beaten": ["...The Lady was right about you. The Professor's door is open. Do not touch anything that hums."],
		"gloat": ["(The attendant refills your cup and points to the exit.)"]},
	"q7": {"name": "Unit Q-7", "title": "Lab Assistant", "shout": "BEEP! CALCULATING!!",
		"loose": 0.5, "aggr": 0.5, "bluff": 0.3, "powers": ["sight"], "mini": true, "stack": 500,
		"room": 4, "episode": "THE SERVER ROOM",
		"lore": ["The Professor's robot runs the last elevator. It only accepts payment in chips."],
		"intro": ["GREETINGS, SPECIMEN. ELEVATOR FARE: ALL OF YOUR CHIPS.",
			"PROFESSOR SAYS I AM 98.2 PERCENT UNBEATABLE. ROUNDING UP."],
		"win": ["BEEP BOOP. VICTORY.", "AS COMPUTED."],
		"lose": ["ERROR. ERROR.", "REBOOTING PRIDE..."],
		"allin": ["ALL CHIPS. NO REFUNDS."],
		"beaten": ["ELEVATOR UNLOCKED. TOP FLOOR. WARNING: THE BARON DOES NOT LOSE. PLEASE BE THE EXCEPTION."],
		"gloat": ["ELEVATOR FARE DECLINED. PLEASE TAKE THE STAIRS."]},
}

const POWERS := {
	"hawk": {"name": "HAWK EYE", "desc": "See one of the rival's cards."},
	"swap": {"name": "WILD SWAP", "desc": "Trade your low card for a new one."},
	"guard": {"name": "IRON GUARD", "desc": "Lose a showdown, keep half your chips."},
	"over": {"name": "OVERDRIVE", "desc": "Double this hand's points."},
	"sight": {"name": "FUTURE SIGHT", "desc": "See the next table card early."},
	"glare": {"name": "DEMON GLARE", "desc": "Rival cannot raise this round."},
}
const POWER_IDS := ["hawk", "swap", "guard", "over", "sight", "glare"]

## id, text (at most 34 characters), points, weight
const MISSIONS := [
	["win", "WIN THE HAND", 200, 22],
	["pair", "WIN HOLDING A PAIR OR BETTER", 300, 18],
	["twopair", "WIN WITH TWO PAIR OR BETTER", 800, 10],
	["bluff", "WIN WITHOUT A SHOWDOWN", 400, 14],
	["suit", "LUCKY SUIT: 150 A CARD IF YOU WIN", 150, 12],
	["allin", "WIN AN ALL-IN", 1500, 6],
	["big", "WIN A POT OF 10 BIG BLINDS", 600, 10],
	["pure", "WIN WITHOUT USING A POWER", 350, 8],
]
const SUIT_NAME := ["SPADES", "HEARTS", "DIAMONDS", "CLUBS"]

const STORY_OPEN := [
	"Shin-Akari City, midnight. Above the neon and the rain stands Starlight Tower, where one tournament decides who rules the tables.",
	"Legend says the Starlight Crown is a single chip cut from a falling star. Whoever holds it hears the deck whisper before every card.",
	"For twenty years the Crown has not left the top floor. Its keeper, the masked Baron Onyx, has never lost a hand that mattered.",
	"Five floors. Five rivals. Wardens on the stairs between them. One rule: the last stack standing climbs.",
	"They say the cards answer to spirit as much as to luck. Tonight, you find out.",
]
const STORY_BOSS := [
	"The top floor. The city glitters far below, small as scattered chips.",
	"Some say the Baron was once a rookie dealer in the Lobby Pit, who held the Crown for one night and never let it go.",
	"A figure waits in the high-backed chair, masked, shuffling a deck that never seems to end.",
	"Baron Onyx, the Midnight Joker. No challenger has ever left this table with a single chip.",
]
const STORY_END := [
	"The last chip slides across the felt. For a moment, the whole tower is silent.",
	"The Baron's mask lies on the table, cracked down the middle. Nobody saw him leave.",
	"As your hand closes on the Crown, it whispers. Not the next card. Just your name.",
	"Then the skyline lights up, floor by floor, as if every window were cheering.",
	"The Starlight Crown is yours. Somewhere below, a rookie dealer is already telling the story wrong.",
]

## Header for a match on the versus screen: "EPISODE 2: THE GARAGE DECK" or
## "INTERLUDE: THE STAIRWELL".
static func episode_label(match_index: int) -> String:
	var id: String = RIVALS[match_index]
	if CAST[id].get("mini", false):
		return "INTERLUDE: " + CAST[id]["episode"]
	var n := 0
	for i in match_index + 1:
		if not CAST[RIVALS[i]].get("mini", false):
			n += 1
	return "EPISODE %d: %s" % [n, CAST[id]["episode"]]
const CREDITS := [
	"HYPER BLUFF!!",
	"STARLIGHT SHOWDOWN",
	"",
	"GAME DESIGN AND RULES",
	"Built with Claude Code",
	"",
	"CHARACTER PIXEL ART",
	"Authored as Aseprite sources",
	"",
	"3D SETS AND PROPS",
	"Modelled and rendered in Blender",
	"",
	"MUSIC AND SOUND",
	"Synthesised from original scores",
	"",
	"ENGINE",
	"Godot 4 project, ready for Summer Engine",
	"",
	"All characters, art, music and text",
	"are original to this game.",
	"",
	"THANK YOU FOR PLAYING!",
]
