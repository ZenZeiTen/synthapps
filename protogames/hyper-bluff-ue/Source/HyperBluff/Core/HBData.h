// Hyper Bluff!! rules core: cast, powers, missions and story text.
// Port of hyper-bluff/godot/scripts/core/data.gd. Plain C++17, no engine headers.
#pragma once

#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace hb {

// Spirit powers. The order of the first six matches Data.POWER_IDS in data.gd, which
// matters: a granted power is POWER_IDS[roll(n)].
enum class Power : uint8_t { Hawk, Swap, Guard, Over, Sight, Glare, Retake, None };

const char* PowerName(Power p);              // "hawk" ... "retake", "" for None
Power PowerFromName(const std::string& name); // Power::None when unknown

// Bonus missions, in Data.MISSIONS order.
enum class MissionId : uint8_t { Win, Pair, TwoPair, Bluff, Suit, AllIn, Big, Pure, None };

const char* MissionName(MissionId id);       // "win" ... "pure", "" for None
MissionId MissionFromName(const std::string& name);

struct Profile {
    double loose = 0.5;
    double aggr = 0.5;
    double bluff = 0.15;
};

struct CastEntry {
    const char* id;
    const char* name;
    const char* title;
    const char* shout;
    const char* blurb;       // avatars only, "" for rivals
    bool is_rival;
    Profile profile;         // rivals only
    std::vector<Power> powers;
    std::vector<std::string> intro, win, lose, allin, beaten, gloat;
};

struct PowerInfo {
    Power id;
    const char* name;
    const char* desc;
};

struct MissionInfo {
    MissionId id;
    const char* text;
    int points;
    int weight;
};

namespace data {

extern const std::array<const char*, 4> kAvatars;
extern const std::array<const char*, 5> kRivals;
extern const std::array<const char*, 5> kExpr;
extern const std::array<const char*, 4> kSuitName;

// All nine characters in data.gd order (four avatars, then five rivals).
const std::vector<CastEntry>& Cast();
const CastEntry* FindCast(const std::string& id);
// Rival by ladder index 0..4.
const CastEntry& Rival(int index);
int RivalIndex(const std::string& id); // -1 when unknown

// The powers the game grants. Without Director's Cut this is exactly data.gd's POWER_IDS;
// with it, "retake" is appended.
const std::vector<Power>& PowerIds(bool director_cut);
// Display info for every power, data.gd order, then retake.
const std::vector<PowerInfo>& Powers();
const PowerInfo& PowerInfoOf(Power p);

const std::vector<MissionInfo>& Missions();

const std::vector<std::string>& StoryOpen();
const std::vector<std::string>& StoryBoss();
const std::vector<std::string>& StoryEnd();
const std::vector<std::string>& Credits();

}  // namespace data
}  // namespace hb
