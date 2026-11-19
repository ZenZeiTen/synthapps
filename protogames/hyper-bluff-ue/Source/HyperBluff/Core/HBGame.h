// Hyper Bluff!! rules core: heads-up no-limit hold'em with spirit powers, bonus missions,
// star cards and fever hands. Port of hyper-bluff/godot/scripts/core/game.gd.
// Plain C++17, no engine headers, no exceptions, no global mutable state.
//
// The whole game is one hb::State (the Godot version is one Dictionary `s`). Seat 0 is the
// player, seat 1 the rival.
//
// Phases: Pre (call StartHand) -> Bet (call Act / UsePower for s.to_act)
// -> Advance (call Advance: deals the next street) -> Showdown (call Settle)
// -> HandOver (call StartHand) or MatchOver (call NextMatch / ContinueRun)
// -> RunWon after the last rival.
#pragma once

#include <array>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include "HBData.h"

namespace hb {

enum class Phase : uint8_t { Pre, Bet, Advance, Showdown, HandOver, MatchOver, RunWon };
const char* PhaseName(Phase p);  // "pre", "bet", "advance", "showdown", "hand_over", ...
bool PhaseFromName(const std::string& name, Phase& out);

// What a seat asks for. Call is also a check.
enum class Action : uint8_t { Fold, Call, Raise };
const char* ActionName(Action a);  // "fold", "call", "raise"

// What the table shows after an action (the "a" of an "act" event).
enum class Shown : uint8_t { Fold, Check, Call, Bet, Raise, AllIn };
const char* ShownName(Shown a);  // "fold", "check", "call", "bet", "raise", "allin"

enum class EventType : uint8_t { Hand, Fever, Act, Star, Street, Power, Settle };
const char* EventTypeName(EventType t);  // "hand", "fever", "act", "star", ...

// One entry of s["events"]. Only the fields of its type are meaningful:
// hand: -; fever: power; act: who, a, amt; star: idx, value, power; street: n;
// power: who, power; settle: winner.
struct Event {
    EventType t = EventType::Hand;
    int who = -1;
    Shown a = Shown::Check;
    int amt = 0;
    int idx = -1;
    int value = 0;
    Power power = Power::None;  // None prints as "" like the Godot event
    int n = 0;
    int winner = -1;
};

struct Mission {
    MissionId id = MissionId::None;  // None: the Godot dictionary is empty
    std::string text;
    int points = 0;
    int suit = -1;
    bool Empty() const { return id == MissionId::None; }
};

struct Fx {
    std::array<std::vector<int>, 2> peek;  // rival hole indexes each seat has seen
    std::array<bool, 2> guard{{false, false}};
    std::array<bool, 2> over{{false, false}};
    std::array<int, 2> sight{{0, 0}};
    std::array<int, 2> glare{{-1, -1}};
    std::array<int, 2> used{{0, 0}};
    std::array<int, 2> pstreet{{-1, -1}};
    // Director's Cut: retake used this hand. Not part of the Godot state.
    std::array<bool, 2> retake{{false, false}};
};

struct ResultLine {
    std::string label;
    int64_t value = 0;
};

struct Result {
    bool set = false;  // false: the Godot dictionary is empty
    int pot = 0;
    bool showdown = false;
    int winner = -1;
    std::array<int, 2> vals{{0, 0}};
    std::array<int, 2> pay{{0, 0}};
    int64_t points = 0;
    std::vector<ResultLine> lines;
    Power power = Power::None;
    bool guarded = false;
    int64_t match_bonus = 0;
};

struct State {
    int64_t seed = 0;
    int64_t rng_deck = 0;
    int64_t rng_ai = 0;
    int64_t rng_bonus = 0;
    std::string avatar;
    int match = 0;
    int64_t score = 0;
    int continues = 0;
    std::array<std::vector<Power>, 2> powers;
    std::vector<Event> events;

    int rival = 0;  // ladder index into data::kRivals
    std::array<int, 2> stack{{0, 0}};
    int hand_no = 0;
    int button = 1;
    Phase phase = Phase::Pre;
    int winner = -1;
    Result result;
    std::vector<int> board;
    std::array<std::vector<int>, 2> hole;
    std::array<int, 2> bet{{0, 0}};
    std::array<int, 2> total{{0, 0}};
    bool fever = false;
    Mission mission;
    // index -> value, in insertion order (Godot dictionaries keep insertion order).
    std::vector<std::pair<int, int>> stars;
    int star_pot = 0;
    Fx fx;

    // Set by StartHand; absent from the Godot dictionary before the first hand.
    std::array<int, 2> blind{{0, 0}};
    std::vector<int> runout;
    std::vector<int> deck;
    int street = 0;
    int to_act = 0;
    int last_raise = 0;
    std::array<bool, 2> acted{{false, false}};
    int folded = -1;
    bool allin_seen = false;

    // s["bot"]: a profile for seat 0 so the AI can play the player's seat (tests, playouts).
    bool has_bot = false;
    Profile bot;

    // Director's Cut: when true, "retake" joins the power pool and Baron Onyx starts with
    // it. Default false keeps the rules identical to the Godot game.
    bool director_cut = false;
};

namespace game {

constexpr int kStartStack = 800;
constexpr int kHandsPerLevel = 3;
constexpr int kMaxPowers = 3;
constexpr int kRoyalPoints = 25000;
constexpr int kStarChance = 15;
constexpr int kStarChanceFever = 40;
constexpr int kFeverChance = 12;
constexpr int kMatchBonus = 2000;
extern const std::array<std::array<int, 2>, 8> kBlinds;
extern const std::array<int, 9> kHandPoints;
extern const std::array<int, 6> kStarValues;
extern const std::array<int, 6> kStarWeights;

State NewRun(int64_t seed, const std::string& avatar, bool director_cut = false);
void StartMatch(State& s);
int Pot(const State& s);
int BlindLevel(const State& s);
Power GrantPower(State& s, int who);  // Power::None when the inventory is full
void StartHand(State& s);
int ToCall(const State& s, int who);
int MaxRaiseTo(const State& s, int who);
int MinRaiseTo(const State& s, int who);
bool CanRaise(const State& s, int who);
std::vector<int> RaiseOptions(const State& s, int who);
void Act(State& s, int who, Action a, int amount = 0);
void Advance(State& s);
void Settle(State& s);
void NextMatch(State& s);
void ContinueRun(State& s);

std::vector<int> KnownBoard(const State& s, int who);
std::vector<int> KnownOpp(const State& s, int who);
bool CanUse(const State& s, int who, Power id);
bool UsePower(State& s, int who, int slot);

// Number of table cards the current street dealt (3 on the flop, 1 on turn and river).
int StreetCards(int street);

// Canonical text form of the whole state, for saves and for "same seed, same game" checks.
// Deserialize returns false on malformed input and leaves `out` unspecified.
std::string Serialize(const State& s);
bool Deserialize(const std::string& text, State& out);

}  // namespace game
}  // namespace hb
