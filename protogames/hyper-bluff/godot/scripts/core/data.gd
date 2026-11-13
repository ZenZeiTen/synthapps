extends RefCounted
## Cast, powers, missions and story text. All of it original.

const AVATARS := ["rin", "mako", "jiro", "aya"]
const RIVALS := ["pochi", "goro", "yuki", "zeno", "onyx"]
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
		"intro": ["Welcome to the Starlight Showdown! I'm Pochi, your first opponent!",
			"I only learned the rules last week... but I won't fold! Ever! Probably!"],
		"win": ["Eh?! I won?! Yay!", "Chips! So many chips!"],
		"lose": ["Waaah! My stack!", "T-that was just practice!"],
		"allin": ["Everything! I'm pushing everything!"],
		"beaten": ["You're amazing... Go get them, okay? I'll cheer from the pit!"],
		"gloat": ["I did it! Boss, did you see?! ...Sorry about your chips."]},
	"goro": {"name": "Thunder Goro Daimon", "title": "Highway Shogun", "shout": "THUNDER RAISE!!",
		"loose": 0.6, "aggr": 0.85, "bluff": 0.33, "powers": ["glare"],
		"intro": ["So you squeaked past the kid. HAH! I raise like a ten-ton truck!",
			"Fold now and I'll let you keep your shoelaces!"],
		"win": ["GWAHAHA! Flattened!", "That's the sound of thunder, pal!"],
		"lose": ["Tch! Lucky punk!", "My bike payment was in that pot!"],
		"allin": ["FULL THROTTLE! ALL IN!"],
		"beaten": ["...Heh. You ride hard. Take the next floor, and don't you dare lose."],
		"gloat": ["Road's closed, kid. Come back with a bigger engine!"]},
	"yuki": {"name": "Lady Shirayuki", "title": "Frozen Camellia", "shout": "FREEZE, AND FOLD.",
		"loose": 0.15, "aggr": 0.5, "bluff": 0.07, "powers": ["guard", "hawk"],
		"intro": ["How noisy. The tower lets anyone in tonight, it seems.",
			"I play only hands worth playing. Do try to be worth my time."],
		"win": ["As expected.", "Snow falls. Chips follow."],
		"lose": ["...A fluke. Nothing more.", "How dare you melt my stack."],
		"allin": ["Enough. All of it. Shiver."],
		"beaten": ["...Warm. I had forgotten. Go. The Professor waits above."],
		"gloat": ["Do close the door on your way out. There's a draft."]},
	"zeno": {"name": "Professor Zeno Quark", "title": "Odds Alchemist", "shout": "EUREKA!! CALCULATED!!",
		"loose": 0.5, "aggr": 0.6, "bluff": 0.18, "powers": ["sight", "swap", "hawk"],
		"intro": ["Fascinating! A live specimen! My formulas put your win chance at 12.7 percent!",
			"Let us test the hypothesis. For science! And for my grant money!"],
		"win": ["As the numbers foretold!", "Quod erat demon-STRAIGHT!"],
		"lose": ["Impossible! Recalculating!", "An outlier! A statistical ghost!"],
		"allin": ["Maximum variance! ALL IN!"],
		"beaten": ["My formulas... never counted guts. The Baron is past that door. Beware his mask!"],
		"gloat": ["Hypothesis confirmed! Please exit through the gift shop!"]},
	"onyx": {"name": "Baron Onyx", "title": "The Midnight Joker", "shout": "KNEEL TO THE JOKER!!",
		"loose": 0.55, "aggr": 0.75, "bluff": 0.25, "powers": ["swap", "glare", "guard", "hawk"],
		"intro": ["So. A challenger reaches the Starlight Table.",
			"Every chip in this city ends its night in my hand. Yours will too."],
		"win": ["The night is mine.", "Dance, little card."],
		"lose": ["...Interesting.", "You dare?!"],
		"allin": ["Midnight strikes. ALL IN."],
		"beaten": ["Hah... ha ha! The mask slips. Take the crown, champion. Tonight, the stars are yours."],
		"gloat": ["The tower keeps its crown. Leave your luck at the door."]},
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
	"Five floors. Five rivals. One rule: the last stack standing takes the Starlight Crown.",
	"They say the cards answer to spirit as much as to luck. Tonight, you find out.",
]
const STORY_BOSS := [
	"The top floor. The city glitters far below, small as scattered chips.",
	"A figure waits in the high-backed chair, masked, shuffling a deck that never seems to end.",
	"Baron Onyx, the Midnight Joker. No challenger has ever left this table with a single chip.",
]
const STORY_END := [
	"The last chip slides across the felt. For a moment, the whole tower is silent.",
	"Then the skyline lights up, floor by floor, as if every window were cheering.",
	"The Starlight Crown is yours. Somewhere below, a rookie dealer is already telling the story wrong.",
]
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
