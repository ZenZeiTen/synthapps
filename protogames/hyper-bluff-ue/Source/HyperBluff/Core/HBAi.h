// Hyper Bluff!! rules core: rival decisions. Port of hyper-bluff/godot/scripts/core/ai.gd.
// Think() only reads what the seat may know: its own cards, the board, peeked cards.
#pragma once

#include "HBData.h"
#include "HBGame.h"

namespace hb {
namespace ai {

constexpr int kSamples = 140;
// Ai.DEFAULT: the profile seat 0 plays with when State::has_bot is false.
Profile DefaultProfile();

struct Decision {
    bool use_power = false;  // true: use powers[who][slot] first, then ask again
    int slot = -1;
    Action a = Action::Call;
    int amt = 0;  // raise-to amount
};

const Profile& ProfileOf(const State& s, int who);
Decision Think(State& s, int who);
// Apply Think() until the seat has acted (at most 8 decisions). Used by tests and playouts.
void Play(State& s, int who);

}  // namespace ai
}  // namespace hb
