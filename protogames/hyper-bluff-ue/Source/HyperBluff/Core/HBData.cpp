// Port of hyper-bluff/godot/scripts/core/data.gd. All text is original to the game and
// copied verbatim; tests/parity compares every string against the Godot file.
#include "HBData.h"

namespace hb {

namespace {
const char* const kPowerNames[] = {"hawk", "swap", "guard", "over", "sight", "glare", "retake", ""};
const char* const kMissionNames[] = {"win", "pair", "twopair", "bluff", "suit", "allin", "big", "pure", ""};
}  // namespace

const char* PowerName(Power p) { return kPowerNames[static_cast<int>(p)]; }

Power PowerFromName(const std::string& name) {
    for (int i = 0; i < static_cast<int>(Power::None); ++i) {
        if (name == kPowerNames[i]) return static_cast<Power>(i);
    }
    return Power::None;
}

const char* MissionName(MissionId id) { return kMissionNames[static_cast<int>(id)]; }

MissionId MissionFromName(const std::string& name) {
    for (int i = 0; i < static_cast<int>(MissionId::None); ++i) {
        if (name == kMissionNames[i]) return static_cast<MissionId>(i);
    }
    return MissionId::None;
}

namespace data {

const std::array<const char*, 4> kAvatars = {"rin", "mako", "jiro", "aya"};
const std::array<const char*, kLadder> kRivals = {"pochi", "tetsu", "goro", "suzu", "yuki", "kagero", "zeno", "q7", "onyx"};
const std::array<const char*, 5> kExpr = {"neutral", "happy", "shock", "defeat", "fierce"};
const std::array<const char*, 4> kSuitName = {"SPADES", "HEARTS", "DIAMONDS", "CLUBS"};

namespace {
CastEntry Avatar(const char* id, const char* name, const char* title, const char* shout,
                 const char* blurb) {
    CastEntry e{id, name, title, shout, blurb, false, Profile{}, {}, {}, {}, {}, {}, {}, {}, false, 800, 1, "", {}};
    return e;
}

std::vector<CastEntry> BuildCast() {
    std::vector<CastEntry> c;
    c.push_back(Avatar("rin", "Rin Hoshikawa", "Comet Rookie", "BURN, MY LUCK!!",
                       "Hot-blooded and reckless. Bets with the heart first."));
    c.push_back(Avatar("mako", "Mako Tendo", "Azure Ace", "READ AND DESTROY!!",
                       "Cool, exact, and never seen sweating."));
    c.push_back(Avatar("jiro", "Jiro Kanzaki", "Drifting Gambler", "LET IT RIDE, BABY!!",
                       "Easygoing drifter who naps between all-ins."));
    c.push_back(Avatar("aya", "Aya Kurogane", "Moonlit Seer", "THE STARS HAVE SPOKEN!!",
                       "Reads fortunes. Claims the deck whispers to her."));
    {
        CastEntry e{"pochi", "Pochi Maruyama", "Rookie Dealer", "I-I'LL DO MY BEST!!", "", true,
                    Profile{0.9, 0.15, 0.04}, {}, {}, {}, {}, {}, {}, {}, false, 800, 1, "", {}};
        e.intro = {"Welcome to the Starlight Showdown! I'm Pochi, your first opponent!",
                   "I only learned the rules last week... but I won't fold! Ever! Probably!"};
        e.win = {"Eh?! I won?! Yay!",
                 "Chips! So many chips!"};
        e.lose = {"Waaah! My stack!",
                  "T-that was just practice!"};
        e.allin = {"Everything! I'm pushing everything!"};
        e.beaten = {"You're amazing... Go get them, okay? I'll cheer from the pit!"};
        e.gloat = {"I did it! Boss, did you see?! ...Sorry about your chips."};
        e.mini = false;
        e.stack = 800;
        e.room = 1;
        e.episode = "THE LOBBY PIT";
        e.lore = {"Every challenger starts here, under warm lamps and the clatter of slot machines.",
                  "The house deals the first game itself, through its newest dealer. Most challengers underestimate her. Most go home."};
        c.push_back(e);
    }
    {
        CastEntry e{"goro", "Thunder Goro Daimon", "Highway Shogun", "THUNDER RAISE!!", "", true,
                    Profile{0.6, 0.85, 0.33}, {Power::Glare}, {}, {}, {}, {}, {}, {}, false, 800, 1, "", {}};
        e.intro = {"So you squeaked past the kid. HAH! I raise like a ten-ton truck!",
                   "Fold now and I'll let you keep your shoelaces!"};
        e.win = {"GWAHAHA! Flattened!",
                 "That's the sound of thunder, pal!"};
        e.lose = {"Tch! Lucky punk!",
                  "My bike payment was in that pot!"};
        e.allin = {"FULL THROTTLE! ALL IN!"};
        e.beaten = {"...Heh. You ride hard. Take the next floor, and don't you dare lose."};
        e.gloat = {"Road's closed, kid. Come back with a bigger engine!"};
        e.mini = false;
        e.stack = 800;
        e.room = 2;
        e.episode = "THE GARAGE DECK";
        e.lore = {"Concrete, engine oil, and a card table bolted to the floor of the tower's parking deck.",
                  "Goro Daimon once raced the highways below for pink slips. Now he races stacks, and he has never once braked."};
        c.push_back(e);
    }
    {
        CastEntry e{"yuki", "Lady Shirayuki", "Frozen Camellia", "FREEZE, AND FOLD.", "", true,
                    Profile{0.15, 0.5, 0.07}, {Power::Guard, Power::Hawk}, {}, {}, {}, {}, {}, {}, false, 800, 1, "", {}};
        e.intro = {"How noisy. The tower lets anyone in tonight, it seems.",
                   "I play only hands worth playing. Do try to be worth my time."};
        e.win = {"As expected.",
                 "Snow falls. Chips follow."};
        e.lose = {"...A fluke. Nothing more.",
                  "How dare you melt my stack."};
        e.allin = {"Enough. All of it. Shiver."};
        e.beaten = {"...Warm. I had forgotten. Go. The Professor waits above."};
        e.gloat = {"Do close the door on your way out. There's a draft."};
        e.mini = false;
        e.stack = 800;
        e.room = 3;
        e.episode = "THE SNOW GARDEN";
        e.lore = {"Snow falls indoors here all year, from a ceiling no one has ever seen.",
                  "Lady Shirayuki's family built the tower's first card room. She plays to win it back, one cold hand at a time."};
        c.push_back(e);
    }
    {
        CastEntry e{"zeno", "Professor Zeno Quark", "Odds Alchemist", "EUREKA!! CALCULATED!!", "", true,
                    Profile{0.5, 0.6, 0.18}, {Power::Sight, Power::Swap, Power::Hawk}, {}, {}, {}, {}, {}, {}, false, 800, 1, "", {}};
        e.intro = {"Fascinating! A live specimen! My formulas put your win chance at 12.7 percent!",
                   "Let us test the hypothesis. For science! And for my grant money!"};
        e.win = {"As the numbers foretold!",
                 "Quod erat demon-STRAIGHT!"};
        e.lose = {"Impossible! Recalculating!",
                  "An outlier! A statistical ghost!"};
        e.allin = {"Maximum variance! ALL IN!"};
        e.beaten = {"My formulas... never counted guts. The Baron is past that door. Beware his mask!"};
        e.gloat = {"Hypothesis confirmed! Please exit through the gift shop!"};
        e.mini = false;
        e.stack = 800;
        e.room = 4;
        e.episode = "THE ODDS LABORATORY";
        e.lore = {"Monitors hum with numbers nobody asked for. Something on the workbench is ticking.",
                  "Professor Quark swears he can calculate the Crown's whisper. He has been wrong forty-one times. He says he is due."};
        c.push_back(e);
    }
    {
        CastEntry e{"onyx", "Baron Onyx", "The Midnight Joker", "KNEEL TO THE JOKER!!", "", true,
                    Profile{0.55, 0.75, 0.25}, {Power::Swap, Power::Glare, Power::Guard, Power::Hawk}, {}, {}, {}, {}, {}, {}, false, 800, 1, "", {}};
        e.intro = {"So. A challenger reaches the Starlight Table.",
                   "Every chip in this city ends its night in my hand. Yours will too."};
        e.win = {"The night is mine.",
                 "Dance, little card."};
        e.lose = {"...Interesting.",
                  "You dare?!"};
        e.allin = {"Midnight strikes. ALL IN."};
        e.beaten = {"Hah... ha ha! The mask slips. Take the crown, champion. Tonight, the stars are yours."};
        e.gloat = {"The tower keeps its crown. Leave your luck at the door."};
        e.mini = false;
        e.stack = 800;
        e.room = 5;
        e.episode = "THE STARLIGHT TABLE";
        e.lore = {"The last door opens onto the roof of the world, and a table older than the tower itself."};
        c.push_back(e);
    }
    {
        CastEntry e{"tetsu", "Tetsu Kanabo", "Lobby Bouncer", "NOBODY GETS PAST!!", "", true,
                    Profile{0.8, 0.3, 0.05}, {Power::Guard}, {}, {}, {}, {}, {}, {}, false, 800, 1, "", {}};
        e.intro = {"Name's Tetsu. Nobody climbs these stairs without beating me at cards.",
                   "Pochi's my little cousin. You made her cry. ...She says you were nice about it. Still."};
        e.win = {"Hmph.",
                 "Wall holds."};
        e.lose = {"...Okay. That one stung.",
                  "Tch."};
        e.allin = {"Wall comes down on you. ALL IN."};
        e.beaten = {"The wall cracks. Go on up. And watch the biker. He doesn't brake."};
        e.gloat = {"Stairs are closed. Lobby's that way."};
        e.mini = true;
        e.stack = 500;
        e.room = 1;
        e.episode = "THE STAIRWELL";
        e.lore = {"Between the Lobby Pit and the Garage Deck there is one staircase, and one very large man standing on it."};
        c.push_back(e);
    }
    {
        CastEntry e{"suzu", "Suzu Hayate", "Pit-Crew Ace", "FULL TUNE-UP!!", "", true,
                    Profile{0.6, 0.7, 0.25}, {Power::Swap}, {}, {}, {}, {}, {}, {}, false, 800, 1, "", {}};
        e.intro = {"Boss lost? To YOU? Okay, okay. I gotta see this for myself.",
                   "Win and the lift key's yours. Lose and you're washing the bike."};
        e.win = {"Zoom! Ha!",
                 "Tuned and tight!"};
        e.lose = {"Ow, my gears!",
                  "Pit stop, pit stop!"};
        e.allin = {"Redline! Everything goes!"};
        e.beaten = {"Fine, fine, the key's yours. Mind the cold up there. The Lady keeps it like a freezer."};
        e.gloat = {"Sponge is by the bucket. Start with the wheels!"};
        e.mini = true;
        e.stack = 500;
        e.room = 2;
        e.episode = "THE PIT LANE";
        e.lore = {"Goro's mechanic has rigged the freight lift to the next floor. She wants one hand of cards for the key."};
        c.push_back(e);
    }
    {
        CastEntry e{"kagero", "Kagero", "Silent Attendant", "......!!", "", true,
                    Profile{0.3, 0.55, 0.15}, {Power::Hawk}, {}, {}, {}, {}, {}, {}, false, 800, 1, "", {}};
        e.intro = {"......",
                   "(The attendant slides a cup of tea toward you, then a stack of chips.)"};
        e.win = {"......",
                 "(A small bow.)"};
        e.lose = {"...!",
                  "(The teacup trembles.)"};
        e.allin = {"(Every chip moves forward at once.)"};
        e.beaten = {"...The Lady was right about you. The Professor's door is open. Do not touch anything that hums."};
        e.gloat = {"(The attendant refills your cup and points to the exit.)"};
        e.mini = true;
        e.stack = 500;
        e.room = 3;
        e.episode = "THE TEA ROOM";
        e.lore = {"A silent attendant pours tea and deals cards, and never once looks up from the table."};
        c.push_back(e);
    }
    {
        CastEntry e{"q7", "Unit Q-7", "Lab Assistant", "BEEP! CALCULATING!!", "", true,
                    Profile{0.5, 0.5, 0.3}, {Power::Sight}, {}, {}, {}, {}, {}, {}, false, 800, 1, "", {}};
        e.intro = {"GREETINGS, SPECIMEN. ELEVATOR FARE: ALL OF YOUR CHIPS.",
                   "PROFESSOR SAYS I AM 98.2 PERCENT UNBEATABLE. ROUNDING UP."};
        e.win = {"BEEP BOOP. VICTORY.",
                 "AS COMPUTED."};
        e.lose = {"ERROR. ERROR.",
                  "REBOOTING PRIDE..."};
        e.allin = {"ALL CHIPS. NO REFUNDS."};
        e.beaten = {"ELEVATOR UNLOCKED. TOP FLOOR. WARNING: THE BARON DOES NOT LOSE. PLEASE BE THE EXCEPTION."};
        e.gloat = {"ELEVATOR FARE DECLINED. PLEASE TAKE THE STAIRS."};
        e.mini = true;
        e.stack = 500;
        e.room = 4;
        e.episode = "THE SERVER ROOM";
        e.lore = {"The Professor's robot runs the last elevator. It only accepts payment in chips."};
        c.push_back(e);
    }
    return c;
}
}  // namespace

const std::vector<CastEntry>& Cast() {
    static const std::vector<CastEntry> cast = BuildCast();
    return cast;
}

const CastEntry* FindCast(const std::string& id) {
    for (const CastEntry& e : Cast()) {
        if (id == e.id) return &e;
    }
    return nullptr;
}

const CastEntry& Rival(int index) { return *FindCast(kRivals[static_cast<size_t>(index)]); }

int RivalIndex(const std::string& id) {
    for (size_t i = 0; i < kRivals.size(); ++i) {
        if (id == kRivals[i]) return static_cast<int>(i);
    }
    return -1;
}

const std::vector<Power>& PowerIds(bool director_cut) {
    static const std::vector<Power> base = {Power::Hawk, Power::Swap, Power::Guard,
                                            Power::Over, Power::Sight, Power::Glare};
    static const std::vector<Power> cut = {Power::Hawk, Power::Swap, Power::Guard, Power::Over,
                                           Power::Sight, Power::Glare, Power::Retake};
    return director_cut ? cut : base;
}

const std::vector<PowerInfo>& Powers() {
    static const std::vector<PowerInfo> p = {
        {Power::Hawk, "HAWK EYE", "See one of the rival's cards."},
        {Power::Swap, "WILD SWAP", "Trade your low card for a new one."},
        {Power::Guard, "IRON GUARD", "Lose a showdown, keep half your chips."},
        {Power::Over, "OVERDRIVE", "Double this hand's points."},
        {Power::Sight, "FUTURE SIGHT", "See the next table card early."},
        {Power::Glare, "DEMON GLARE", "Rival cannot raise this round."},
        // Director's Cut (C++ core only).
        {Power::Retake, "CUT! RETAKE", "Reshoot the newest table card(s)."},
    };
    return p;
}

const PowerInfo& PowerInfoOf(Power p) {
    const std::vector<PowerInfo>& all = Powers();
    for (const PowerInfo& i : all) {
        if (i.id == p) return i;
    }
    return all.front();
}

const std::vector<MissionInfo>& Missions() {
    // id, text (at most 34 characters), points, weight
    static const std::vector<MissionInfo> m = {
        {MissionId::Win, "WIN THE HAND", 200, 22},
        {MissionId::Pair, "WIN HOLDING A PAIR OR BETTER", 300, 18},
        {MissionId::TwoPair, "WIN WITH TWO PAIR OR BETTER", 800, 10},
        {MissionId::Bluff, "WIN WITHOUT A SHOWDOWN", 400, 14},
        {MissionId::Suit, "LUCKY SUIT: 150 A CARD IF YOU WIN", 150, 12},
        {MissionId::AllIn, "WIN AN ALL-IN", 1500, 6},
        {MissionId::Big, "WIN A POT OF 10 BIG BLINDS", 600, 10},
        {MissionId::Pure, "WIN WITHOUT USING A POWER", 350, 8},
    };
    return m;
}

std::string EpisodeLabel(int match) {
    const CastEntry& c = Rival(match);
    if (c.mini) return std::string("INTERLUDE: ") + c.episode;
    int n = 0;
    for (int i = 0; i <= match; ++i) {
        if (!Rival(i).mini) n += 1;
    }
    return "EPISODE " + std::to_string(n) + ": " + c.episode;
}

const std::vector<std::string>& StoryOpen() {
    static const std::vector<std::string> v = {
        "Shin-Akari City, midnight. Above the neon and the rain stands Starlight Tower, where one tournament decides who rules the tables.",
        "Legend says the Starlight Crown is a single chip cut from a falling star. Whoever holds it hears the deck whisper before every card.",
        "For twenty years the Crown has not left the top floor. Its keeper, the masked Baron Onyx, has never lost a hand that mattered.",
        "Five floors. Five rivals. Wardens on the stairs between them. One rule: the last stack standing climbs.",
        "They say the cards answer to spirit as much as to luck. Tonight, you find out.",
    };
    return v;
}

const std::vector<std::string>& StoryBoss() {
    static const std::vector<std::string> v = {
        "The top floor. The city glitters far below, small as scattered chips.",
        "Some say the Baron was once a rookie dealer in the Lobby Pit, who held the Crown for one night and never let it go.",
        "A figure waits in the high-backed chair, masked, shuffling a deck that never seems to end.",
        "Baron Onyx, the Midnight Joker. No challenger has ever left this table with a single chip.",
    };
    return v;
}

const std::vector<std::string>& StoryEnd() {
    static const std::vector<std::string> v = {
        "The last chip slides across the felt. For a moment, the whole tower is silent.",
        "The Baron's mask lies on the table, cracked down the middle. Nobody saw him leave.",
        "As your hand closes on the Crown, it whispers. Not the next card. Just your name.",
        "Then the skyline lights up, floor by floor, as if every window were cheering.",
        "The Starlight Crown is yours. Somewhere below, a rookie dealer is already telling the story wrong.",
    };
    return v;
}

const std::vector<std::string>& Credits() {
    static const std::vector<std::string> v = {
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
    };
    return v;
}

}  // namespace data
}  // namespace hb
