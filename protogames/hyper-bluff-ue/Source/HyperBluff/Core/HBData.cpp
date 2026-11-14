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
const std::array<const char*, 5> kRivals = {"pochi", "goro", "yuki", "zeno", "onyx"};
const std::array<const char*, 5> kExpr = {"neutral", "happy", "shock", "defeat", "fierce"};
const std::array<const char*, 4> kSuitName = {"SPADES", "HEARTS", "DIAMONDS", "CLUBS"};

namespace {
CastEntry Avatar(const char* id, const char* name, const char* title, const char* shout,
                 const char* blurb) {
    CastEntry e{id, name, title, shout, blurb, false, Profile{}, {}, {}, {}, {}, {}, {}, {}};
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
                    Profile{0.9, 0.15, 0.04}, {}, {}, {}, {}, {}, {}, {}};
        e.intro = {"Welcome to the Starlight Showdown! I'm Pochi, your first opponent!",
                   "I only learned the rules last week... but I won't fold! Ever! Probably!"};
        e.win = {"Eh?! I won?! Yay!", "Chips! So many chips!"};
        e.lose = {"Waaah! My stack!", "T-that was just practice!"};
        e.allin = {"Everything! I'm pushing everything!"};
        e.beaten = {"You're amazing... Go get them, okay? I'll cheer from the pit!"};
        e.gloat = {"I did it! Boss, did you see?! ...Sorry about your chips."};
        c.push_back(e);
    }
    {
        CastEntry e{"goro", "Thunder Goro Daimon", "Highway Shogun", "THUNDER RAISE!!", "", true,
                    Profile{0.6, 0.85, 0.33}, {Power::Glare}, {}, {}, {}, {}, {}, {}};
        e.intro = {"So you squeaked past the kid. HAH! I raise like a ten-ton truck!",
                   "Fold now and I'll let you keep your shoelaces!"};
        e.win = {"GWAHAHA! Flattened!", "That's the sound of thunder, pal!"};
        e.lose = {"Tch! Lucky punk!", "My bike payment was in that pot!"};
        e.allin = {"FULL THROTTLE! ALL IN!"};
        e.beaten = {"...Heh. You ride hard. Take the next floor, and don't you dare lose."};
        e.gloat = {"Road's closed, kid. Come back with a bigger engine!"};
        c.push_back(e);
    }
    {
        CastEntry e{"yuki", "Lady Shirayuki", "Frozen Camellia", "FREEZE, AND FOLD.", "", true,
                    Profile{0.15, 0.5, 0.07}, {Power::Guard, Power::Hawk}, {}, {}, {}, {}, {}, {}};
        e.intro = {"How noisy. The tower lets anyone in tonight, it seems.",
                   "I play only hands worth playing. Do try to be worth my time."};
        e.win = {"As expected.", "Snow falls. Chips follow."};
        e.lose = {"...A fluke. Nothing more.", "How dare you melt my stack."};
        e.allin = {"Enough. All of it. Shiver."};
        e.beaten = {"...Warm. I had forgotten. Go. The Professor waits above."};
        e.gloat = {"Do close the door on your way out. There's a draft."};
        c.push_back(e);
    }
    {
        CastEntry e{"zeno", "Professor Zeno Quark", "Odds Alchemist", "EUREKA!! CALCULATED!!", "",
                    true, Profile{0.5, 0.6, 0.18}, {Power::Sight, Power::Swap, Power::Hawk},
                    {}, {}, {}, {}, {}, {}};
        e.intro = {"Fascinating! A live specimen! My formulas put your win chance at 12.7 percent!",
                   "Let us test the hypothesis. For science! And for my grant money!"};
        e.win = {"As the numbers foretold!", "Quod erat demon-STRAIGHT!"};
        e.lose = {"Impossible! Recalculating!", "An outlier! A statistical ghost!"};
        e.allin = {"Maximum variance! ALL IN!"};
        e.beaten = {"My formulas... never counted guts. The Baron is past that door. Beware his mask!"};
        e.gloat = {"Hypothesis confirmed! Please exit through the gift shop!"};
        c.push_back(e);
    }
    {
        CastEntry e{"onyx", "Baron Onyx", "The Midnight Joker", "KNEEL TO THE JOKER!!", "", true,
                    Profile{0.55, 0.75, 0.25},
                    {Power::Swap, Power::Glare, Power::Guard, Power::Hawk}, {}, {}, {}, {}, {}, {}};
        e.intro = {"So. A challenger reaches the Starlight Table.",
                   "Every chip in this city ends its night in my hand. Yours will too."};
        e.win = {"The night is mine.", "Dance, little card."};
        e.lose = {"...Interesting.", "You dare?!"};
        e.allin = {"Midnight strikes. ALL IN."};
        e.beaten = {"Hah... ha ha! The mask slips. Take the crown, champion. Tonight, the stars are yours."};
        e.gloat = {"The tower keeps its crown. Leave your luck at the door."};
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

const std::vector<std::string>& StoryOpen() {
    static const std::vector<std::string> v = {
        "Shin-Akari City, midnight. Above the neon and the rain stands Starlight Tower, where one tournament decides who rules the tables.",
        "Five floors. Five rivals. One rule: the last stack standing takes the Starlight Crown.",
        "They say the cards answer to spirit as much as to luck. Tonight, you find out.",
    };
    return v;
}

const std::vector<std::string>& StoryBoss() {
    static const std::vector<std::string> v = {
        "The top floor. The city glitters far below, small as scattered chips.",
        "A figure waits in the high-backed chair, masked, shuffling a deck that never seems to end.",
        "Baron Onyx, the Midnight Joker. No challenger has ever left this table with a single chip.",
    };
    return v;
}

const std::vector<std::string>& StoryEnd() {
    static const std::vector<std::string> v = {
        "The last chip slides across the felt. For a moment, the whole tower is silent.",
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
