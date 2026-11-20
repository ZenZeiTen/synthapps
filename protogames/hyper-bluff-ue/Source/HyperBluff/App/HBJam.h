// Ladder and Director's Cut framing, read from the rules core (Core/HBData.h). This is the
// ONE place the app asks how long the ladder is, which match is a warden (mini-boss) or the
// final boss, which room a match uses, its episode label and the story pages around it.
// Nothing else in the app hard-codes floors.
#pragma once

#include <string>
#include <vector>

namespace hb {
namespace app {
namespace jam {

int LadderSize();                     // number of matches in a run (data::kRivals.size())
const char* RivalId(int match);       // cast id of the rival of ladder match `match`
bool IsFinalBoss(int match);          // last match of the ladder
bool IsMiniBoss(int match);           // a mini-boss match between main floors
int RoomIndex(int match);             // 0..kRooms-1: which bg_floor<n+1>.png the match uses
constexpr int kRooms = 5;             // room images shipped in Content/Raw/Art
// "EPISODE 2: THE GARAGE DECK" / "INTERLUDE: THE STAIRWELL"; past the last match the
// ending, "FINALE: CURTAIN CALL".
std::string EpisodeTitle(int match);
// Floor-clear teaser for what comes after `match` ("COMING UP: EPISODE 2: ...").
std::string NextEpisodeLine(int match);
// Story pages shown before match `match` starts (the boss scene); empty when none.
std::vector<std::string> PagesBefore(int match);
// The versus pages of a match: the rival's lore, then the intro (main.gd begin_versus).
std::vector<std::string> VersusPages(int match);
// The credits roll: the rules core's credits with the Unreal port and jam lines.
const std::vector<std::string>& Credits();

}  // namespace jam
}  // namespace app
}  // namespace hb
