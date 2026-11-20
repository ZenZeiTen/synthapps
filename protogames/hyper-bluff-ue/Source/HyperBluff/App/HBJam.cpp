#include "HBJam.h"

#include "HBData.h"

// Everything here reads the rules core's data (HBData.h): the ladder, wardens, rooms,
// episode labels and story pages, the same data the Godot game uses (parity-checked).

namespace hb {
namespace app {
namespace jam {

int LadderSize() { return static_cast<int>(data::kRivals.size()); }

const char* RivalId(int match) {
    if (match < 0) match = 0;
    if (match >= LadderSize()) match = LadderSize() - 1;
    return data::kRivals[static_cast<size_t>(match)];
}

bool IsFinalBoss(int match) { return match == LadderSize() - 1; }

bool IsMiniBoss(int match) { return match >= 0 && match < LadderSize() && data::Rival(match).mini; }

int RoomIndex(int match) {
    if (match < 0) match = 0;
    if (match >= LadderSize()) match = LadderSize() - 1;
    const int r = data::Rival(match).room - 1;
    return r < 0 ? 0 : (r > kRooms - 1 ? kRooms - 1 : r);
}

std::string EpisodeTitle(int match) {
    if (match >= LadderSize()) return "FINALE: CURTAIN CALL";
    return data::EpisodeLabel(match < 0 ? 0 : match);
}

std::string NextEpisodeLine(int match) { return "COMING UP: " + EpisodeTitle(match + 1); }

std::vector<std::string> PagesBefore(int match) {
    if (IsFinalBoss(match)) return data::StoryBoss();
    return {};
}

std::vector<std::string> VersusPages(int match) {
    const CastEntry& c = data::Rival(match);
    std::vector<std::string> pages = c.lore;
    pages.insert(pages.end(), c.intro.begin(), c.intro.end());
    return pages;
}

const std::vector<std::string>& Credits() {
    static const std::vector<std::string> v = [] {
        std::vector<std::string> out;
        for (const std::string& line : data::Credits()) {
            if (line == "THANK YOU FOR PLAYING!") {
                out.push_back("DIRECTOR'S CUT");
                out.push_back("Unreal Engine 5 port for the Epic MegaJam");
                out.push_back("");
            }
            if (line.rfind("Godot 4 project", 0) == 0) {
                out.push_back("Unreal Engine 5, drawn from a 640x360 canvas");
                continue;
            }
            out.push_back(line);
        }
        return out;
    }();
    return v;
}

}  // namespace jam
}  // namespace app
}  // namespace hb
