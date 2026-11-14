// Port of hyper-bluff/godot/scripts/core/game.gd. Function bodies follow the GDScript line
// by line; every RNG call happens in the same order, so a seed plays the same game in both.
#include "HBGame.h"

#include <cstddef>
#include <cstdio>
#include <cstdlib>

#include "HBCards.h"

namespace hb {

namespace {
const char* const kPhaseNames[] = {"pre", "bet", "advance", "showdown", "hand_over", "match_over", "run_won"};
const char* const kActionNames[] = {"fold", "call", "raise"};
const char* const kShownNames[] = {"fold", "check", "call", "bet", "raise", "allin"};
const char* const kEventNames[] = {"hand", "fever", "act", "star", "street", "power", "settle"};

inline int MinI(int a, int b) { return a < b ? a : b; }
inline int MaxI(int a, int b) { return a > b ? a : b; }
inline int ClampI(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }
}  // namespace

const char* PhaseName(Phase p) { return kPhaseNames[static_cast<int>(p)]; }

bool PhaseFromName(const std::string& name, Phase& out) {
    for (int i = 0; i <= static_cast<int>(Phase::RunWon); ++i) {
        if (name == kPhaseNames[i]) {
            out = static_cast<Phase>(i);
            return true;
        }
    }
    return false;
}

const char* ActionName(Action a) { return kActionNames[static_cast<int>(a)]; }
const char* ShownName(Shown a) { return kShownNames[static_cast<int>(a)]; }
const char* EventTypeName(EventType t) { return kEventNames[static_cast<int>(t)]; }

namespace game {

const std::array<std::array<int, 2>, 8> kBlinds = {{{{10, 20}}, {{15, 30}}, {{25, 50}}, {{40, 80}},
                                                    {{60, 120}}, {{100, 200}}, {{150, 300}}, {{200, 400}}}};
const std::array<int, 9> kHandPoints = {{0, 100, 250, 500, 1000, 1500, 2500, 5000, 10000}};
const std::array<int, 6> kStarValues = {{100, 200, 300, 500, 777, 1000}};
const std::array<int, 6> kStarWeights = {{30, 25, 20, 15, 7, 3}};

namespace {

void NewFx(State& s) { s.fx = Fx(); }

void Put(State& s, int who, int amount) {
    amount = MinI(amount, s.stack[who]);
    s.stack[who] -= amount;
    s.bet[who] += amount;
}

Mission PickMission(State& s) {
    int total = 0;
    for (const MissionInfo& m : data::Missions()) total += m.weight;
    int r = cards::Roll(s.rng_bonus, total);
    for (const MissionInfo& m : data::Missions()) {
        r -= m.weight;
        if (r < 0) {
            Mission out;
            out.id = m.id;
            out.text = m.text;
            out.points = m.points;
            out.suit = -1;
            if (m.id == MissionId::Suit) {
                out.suit = cards::Roll(s.rng_bonus, 4);
                out.text = std::string("LUCKY ") + data::kSuitName[static_cast<size_t>(out.suit)] +
                           ": 150 EACH ON A WIN";
            }
            return out;
        }
    }
    return Mission();
}

bool RoundDone(const State& s) {
    if (s.folded >= 0) return true;
    for (int i = 0; i < 2; ++i) {
        const int o = 1 - i;
        if (s.stack[i] == 0) {
            if (s.bet[o] >= s.bet[i] || s.stack[o] == 0) return true;
        }
    }
    return s.acted[0] && s.acted[1] && s.bet[0] == s.bet[1];
}

void CloseRound(State& s) {
    if (s.folded < 0) {
        const int d = s.bet[0] - s.bet[1];
        if (d > 0) {
            s.bet[0] -= d;
            s.stack[0] += d;
        } else if (d < 0) {
            s.bet[1] += d;
            s.stack[1] -= d;
        }
    }
    s.total[0] += s.bet[0];
    s.total[1] += s.bet[1];
    s.bet = {{0, 0}};
    if (s.stack[0] == 0 || s.stack[1] == 0) s.allin_seen = true;
    if (s.folded >= 0 || s.street == 3) {
        s.phase = Phase::Showdown;
    } else {
        s.phase = Phase::Advance;
    }
}

// Roll for a star on board index idx (the loop body of advance() in game.gd).
void RollStar(State& s, int idx) {
    const int chance = s.fever ? kStarChanceFever : kStarChance;
    if (cards::Roll(s.rng_bonus, 100) < chance) {
        int total = 0;
        for (int w : kStarWeights) total += w;
        int r = cards::Roll(s.rng_bonus, total);
        size_t k = 0;
        while (r >= kStarWeights[k]) {
            r -= kStarWeights[k];
            k += 1;
        }
        const int value = kStarValues[k];
        // s["stars"][idx] = value: overwrite in place if present, else append.
        bool found = false;
        for (auto& kv : s.stars) {
            if (kv.first == idx) {
                kv.second = value;
                found = true;
            }
        }
        if (!found) s.stars.emplace_back(idx, value);
        s.star_pot += value;
        Power got = Power::None;
        if (value == 777) got = GrantPower(s, 0);
        Event e;
        e.t = EventType::Star;
        e.idx = idx;
        e.value = value;
        e.power = got;
        s.events.push_back(e);
    }
}

int MissionPoints(const State& s, bool showdown, int cat, int pot_size) {
    const Mission& m = s.mission;
    if (m.Empty()) return 0;
    switch (m.id) {
        case MissionId::Win: return m.points;
        case MissionId::Pair: return cat >= 1 ? m.points : 0;
        case MissionId::TwoPair: return (showdown && cat >= 2) ? m.points : 0;
        case MissionId::Bluff: return showdown ? 0 : m.points;
        case MissionId::Suit: {
            int n = 0;
            for (int c : s.hole[0]) {
                if (cards::Suit(c) == m.suit) n += 1;
            }
            for (int c : s.board) {
                if (cards::Suit(c) == m.suit) n += 1;
            }
            return n * m.points;
        }
        case MissionId::AllIn: return s.allin_seen ? m.points : 0;
        case MissionId::Big: return pot_size >= 10 * s.blind[1] ? m.points : 0;
        case MissionId::Pure: return s.fx.used[0] == 0 ? m.points : 0;
        default: break;
    }
    return 0;
}

std::string Upper(std::string t) {
    for (char& c : t) {
        if (c >= 'a' && c <= 'z') c = static_cast<char>(c - 'a' + 'A');
    }
    return t;
}

void RivalPowers(State& s) {
    s.powers[1] = data::Rival(s.rival).powers;
    if (s.director_cut && data::kRivals[static_cast<size_t>(s.rival)] == std::string("onyx")) {
        s.powers[1].push_back(Power::Retake);
    }
}

}  // namespace

int StreetCards(int street) { return street == 1 ? 3 : 1; }

State NewRun(int64_t seed, const std::string& avatar, bool director_cut) {
    State s;
    s.seed = seed;
    s.rng_deck = WrapMulAdd(seed, 2654435761ULL, 1);
    s.rng_ai = WrapMulAdd(seed, 40503ULL, 7);
    s.rng_bonus = WrapMulAdd(seed, 69069ULL, 3);
    s.avatar = avatar;
    s.match = 0;
    s.score = 0;
    s.continues = 0;
    s.director_cut = director_cut;
    for (int i = 0; i < 2; ++i) GrantPower(s, 0);
    StartMatch(s);
    return s;
}

void StartMatch(State& s) {
    s.rival = s.match;
    s.stack = {{kStartStack, kStartStack}};
    s.hand_no = 0;
    s.button = 1;
    RivalPowers(s);
    s.phase = Phase::Pre;
    s.winner = -1;
    s.result = Result();
    s.board.clear();
    s.hole = {{std::vector<int>(), std::vector<int>()}};
    s.bet = {{0, 0}};
    s.total = {{0, 0}};
    s.fever = false;
    s.mission = Mission();
    s.stars.clear();
    s.star_pot = 0;
    s.events.clear();
    NewFx(s);
}

int Pot(const State& s) { return s.total[0] + s.total[1] + s.bet[0] + s.bet[1]; }

int BlindLevel(const State& s) {
    // maxi(hand_no - 1, 0) is never negative, so / truncation matches GDScript.
    return MinI(MaxI(s.hand_no - 1, 0) / kHandsPerLevel, static_cast<int>(kBlinds.size()) - 1);
}

Power GrantPower(State& s, int who) {
    if (static_cast<int>(s.powers[who].size()) >= kMaxPowers) return Power::None;
    const std::vector<Power>& ids = data::PowerIds(s.director_cut);
    const Power id = ids[static_cast<size_t>(cards::Roll(s.rng_bonus, static_cast<int>(ids.size())))];
    s.powers[who].push_back(id);
    return id;
}

void StartHand(State& s) {
    s.hand_no += 1;
    s.button = 1 - s.button;
    s.blind = kBlinds[static_cast<size_t>(BlindLevel(s))];
    std::vector<int> deck(52);
    for (int c = 0; c < 52; ++c) deck[static_cast<size_t>(c)] = c;
    for (int i = 51; i > 0; --i) {
        const int j = cards::Roll(s.rng_deck, i + 1);
        const int t = deck[static_cast<size_t>(i)];
        deck[static_cast<size_t>(i)] = deck[static_cast<size_t>(j)];
        deck[static_cast<size_t>(j)] = t;
    }
    s.hole = {{std::vector<int>{deck[0], deck[2]}, std::vector<int>{deck[1], deck[3]}}};
    s.runout.assign(deck.begin() + 4, deck.begin() + 9);
    s.deck.assign(deck.begin() + 9, deck.end());
    s.board.clear();
    s.street = 0;
    s.bet = {{0, 0}};
    s.total = {{0, 0}};
    s.acted = {{false, false}};
    s.folded = -1;
    s.stars.clear();
    s.star_pot = 0;
    s.result = Result();
    s.events.clear();
    NewFx(s);
    // GDScript `and` short-circuits: no roll on the first hand of a match.
    s.fever = s.hand_no > 1 && cards::Roll(s.rng_bonus, 100) < kFeverChance;
    s.mission = PickMission(s);
    s.allin_seen = false;
    const int b = s.button;
    Put(s, b, s.blind[0]);
    Put(s, 1 - b, s.blind[1]);
    s.last_raise = s.blind[1];
    s.to_act = b;
    s.phase = Phase::Bet;
    Event e;
    e.t = EventType::Hand;
    s.events.push_back(e);
    if (s.fever) {
        const Power got = GrantPower(s, 0);
        Event f;
        f.t = EventType::Fever;
        f.power = got;
        s.events.push_back(f);
    }
    if (RoundDone(s)) CloseRound(s);
}

int ToCall(const State& s, int who) { return MaxI(s.bet[0], s.bet[1]) - s.bet[who]; }

int MaxRaiseTo(const State& s, int who) {
    const int o = 1 - who;
    return MinI(s.bet[who] + s.stack[who], s.bet[o] + s.stack[o]);
}

int MinRaiseTo(const State& s, int who) {
    const int cur = MaxI(s.bet[0], s.bet[1]);
    return MinI(cur + MaxI(s.last_raise, s.blind[1]), MaxRaiseTo(s, who));
}

bool CanRaise(const State& s, int who) {
    if (s.phase != Phase::Bet || s.fx.glare[1 - who] == s.street) return false;
    return MaxRaiseTo(s, who) > MaxI(s.bet[0], s.bet[1]);
}

std::vector<int> RaiseOptions(const State& s, int who) {
    std::vector<int> out;
    if (!CanRaise(s, who)) return out;
    const int cur = MaxI(s.bet[0], s.bet[1]);
    const int lo = MinRaiseTo(s, who);
    const int hi = MaxRaiseTo(s, who);
    const int p = Pot(s) + ToCall(s, who);
    out.push_back(lo);
    const int nums[3] = {1, 2, 4};
    for (int num : nums) {
        int x = cur + (p * num) / 2;  // all operands are non-negative
        x -= x % 5;
        if (x > lo && x < hi) out.push_back(x);
    }
    if (hi > lo) out.push_back(hi);
    return out;
}

void Act(State& s, int who, Action a, int amount) {
    if (s.phase != Phase::Bet || s.to_act != who) return;
    const int o = 1 - who;
    const int cur = MaxI(s.bet[0], s.bet[1]);
    const int need = cur - s.bet[who];
    Shown shown = Shown::Fold;
    if (a == Action::Raise && !CanRaise(s, who)) a = Action::Call;
    if (a == Action::Fold && need == 0) a = Action::Call;
    switch (a) {
        case Action::Fold:
            s.folded = who;
            shown = Shown::Fold;
            break;
        case Action::Call:
            Put(s, who, need);
            s.acted[who] = true;
            shown = need == 0 ? Shown::Check : Shown::Call;
            if (need > 0 && s.stack[who] == 0) shown = Shown::AllIn;
            break;
        case Action::Raise: {
            const int lo = MinRaiseTo(s, who);
            const int hi = MaxRaiseTo(s, who);
            amount = ClampI(amount, lo, hi);
            const int inc = amount - cur;
            if (inc >= s.last_raise) s.last_raise = inc;
            Put(s, who, amount - s.bet[who]);
            s.acted[who] = true;
            s.acted[o] = false;
            shown = cur == 0 ? Shown::Bet : Shown::Raise;
            if (s.stack[who] == 0 || amount == s.bet[o] + s.stack[o]) shown = Shown::AllIn;
            break;
        }
    }
    Event e;
    e.t = EventType::Act;
    e.who = who;
    e.a = shown;
    e.amt = s.bet[who];
    s.events.push_back(e);
    if (RoundDone(s)) {
        CloseRound(s);
    } else {
        s.to_act = o;
    }
}

void Advance(State& s) {
    if (s.phase != Phase::Advance) return;
    s.street += 1;
    const int n = StreetCards(s.street);
    for (int i = 0; i < n; ++i) {
        const int idx = static_cast<int>(s.board.size());
        s.board.push_back(s.runout[static_cast<size_t>(idx)]);
        RollStar(s, idx);
    }
    Event e;
    e.t = EventType::Street;
    e.n = s.street;
    s.events.push_back(e);
    s.acted = {{false, false}};
    s.last_raise = s.blind[1];
    s.to_act = 1 - s.button;
    if (s.stack[0] == 0 || s.stack[1] == 0) {
        s.phase = s.street == 3 ? Phase::Showdown : Phase::Advance;
    } else {
        s.phase = Phase::Bet;
    }
}

void Settle(State& s) {
    if (s.phase != Phase::Showdown) return;
    const int pot_size = s.total[0] + s.total[1];
    const bool showdown = s.folded < 0;
    std::vector<int> h0 = s.hole[0];
    h0.insert(h0.end(), s.board.begin(), s.board.end());
    std::vector<int> h1 = s.hole[1];
    h1.insert(h1.end(), s.board.begin(), s.board.end());
    const std::array<int, 2> vals{{cards::Eval(h0), cards::Eval(h1)}};
    int w = -1;
    if (!showdown) {
        w = 1 - s.folded;
    } else if (vals[0] > vals[1]) {
        w = 0;
    } else if (vals[1] > vals[0]) {
        w = 1;
    }
    std::array<int, 2> pay{{0, 0}};
    bool guarded = false;
    if (w < 0) {
        pay[0] = pot_size / 2;
        pay[1] = pot_size / 2;
        pay[static_cast<size_t>(1 - s.button)] += pot_size % 2;
    } else {
        const int loser = 1 - w;
        int refund = 0;
        if (showdown && s.fx.guard[loser]) {
            refund = s.total[loser] / 2;
            guarded = true;
        }
        pay[static_cast<size_t>(w)] = pot_size - refund;
        pay[static_cast<size_t>(loser)] = refund;
    }
    s.stack[0] += pay[0];
    s.stack[1] += pay[1];
    const int paid_in = s.total[0];
    std::vector<ResultLine> lines;
    int64_t points = 0;
    Power power = Power::None;
    if (w == 0 || (w < 0 && showdown)) {
        const int base = MaxI(pay[0] - paid_in, 0);
        lines.push_back(ResultLine{"POT WON", base});
        int64_t sum = base;
        if (w == 0) {
            const int cat = cards::Category(vals[0]);
            if (showdown) {
                const int hp = cards::IsRoyal(vals[0]) ? kRoyalPoints : kHandPoints[static_cast<size_t>(cat)];
                if (hp > 0) {
                    lines.push_back(ResultLine{Upper(cards::NameOf(vals[0])), hp});
                    sum += hp;
                }
            }
            const int mp = MissionPoints(s, showdown, cat, pot_size);
            if (mp > 0) {
                lines.push_back(ResultLine{"BONUS MISSION", mp});
                sum += mp;
            }
            if (s.star_pot > 0) {
                lines.push_back(ResultLine{"STAR CARDS", s.star_pot});
                sum += s.star_pot;
            }
        }
        int mult = 1;
        if (s.fx.over[0]) mult *= 2;
        if (s.fever) mult *= 3;
        if (mult > 1) lines.push_back(ResultLine{"MULTIPLIER x" + std::to_string(mult), sum * (mult - 1)});
        points = sum * mult;
        s.score += points;
        if (w == 0 && showdown) power = GrantPower(s, 0);
    }
    Result r;
    r.set = true;
    r.pot = pot_size;
    r.showdown = showdown;
    r.winner = w;
    r.vals = vals;
    r.pay = pay;
    r.points = points;
    r.lines = lines;
    r.power = power;
    r.guarded = guarded;
    r.match_bonus = 0;
    s.result = r;
    s.total = {{0, 0}};
    Event e;
    e.t = EventType::Settle;
    e.winner = w;
    s.events.push_back(e);
    if (s.stack[0] == 0 || s.stack[1] == 0) {
        s.phase = Phase::MatchOver;
        s.winner = s.stack[1] == 0 ? 0 : 1;
        if (s.winner == 0) {
            const int64_t bonus = static_cast<int64_t>(kMatchBonus) * (s.match + 1);
            s.score += bonus;
            s.result.match_bonus = bonus;
        }
    } else {
        s.phase = Phase::HandOver;
    }
}

void NextMatch(State& s) {
    if (s.phase != Phase::MatchOver || s.winner != 0) return;
    if (s.match + 1 >= static_cast<int>(data::kRivals.size())) {
        s.phase = Phase::RunWon;
        return;
    }
    s.match += 1;
    StartMatch(s);
}

void ContinueRun(State& s) {
    if (s.phase != Phase::MatchOver || s.winner != 1) return;
    s.score = s.score / 2;  // the score is never negative, so truncation matches GDScript
    s.continues += 1;
    if (s.powers[0].empty()) GrantPower(s, 0);
    StartMatch(s);
}

// ---- spirit powers -----------------------------------------------------------

std::vector<int> KnownBoard(const State& s, int who) {
    std::vector<int> b = s.board;
    if (s.fx.sight[who] > static_cast<int>(b.size()) && b.size() < 5) {
        b.push_back(s.runout[b.size()]);
    }
    return b;
}

std::vector<int> KnownOpp(const State& s, int who) {
    std::vector<int> out;
    for (int i : s.fx.peek[who]) out.push_back(s.hole[1 - who][static_cast<size_t>(i)]);
    return out;
}

bool CanUse(const State& s, int who, Power id) {
    if (s.phase != Phase::Bet || s.to_act != who) return false;
    const Fx& fx = s.fx;
    switch (id) {
        case Power::Hawk: return fx.peek[who].size() < 2;
        case Power::Swap: return !s.deck.empty();
        case Power::Guard: return !fx.guard[who];
        case Power::Over: return !fx.over[who];
        case Power::Sight: return s.street < 3 && fx.sight[who] <= static_cast<int>(s.board.size());
        case Power::Glare: return fx.glare[who] != s.street;
        case Power::Retake: {
            // Director's Cut: only right after a street was dealt, before anyone bets or
            // checks on it, once per seat per hand, and only with enough cards left.
            if (s.street < 1 || s.street > 3 || fx.retake[who]) return false;
            if (s.bet[0] != 0 || s.bet[1] != 0 || s.acted[0] || s.acted[1]) return false;
            const int n = StreetCards(s.street);
            return static_cast<int>(s.board.size()) == s.street + 2 &&
                   static_cast<int>(s.deck.size()) >= n;
        }
        case Power::None: break;
    }
    return false;
}

bool UsePower(State& s, int who, int slot) {
    std::vector<Power>& inv = s.powers[who];
    if (slot < 0 || slot >= static_cast<int>(inv.size())) return false;
    const Power id = inv[static_cast<size_t>(slot)];
    if (!CanUse(s, who, id)) return false;
    Fx& fx = s.fx;
    const int o = 1 - who;
    switch (id) {
        case Power::Hawk: {
            std::vector<int>& seen = fx.peek[who];
            int idx = cards::Roll(s.rng_bonus, 2);
            for (int v : seen) {
                if (v == idx) {
                    idx = 1 - idx;
                    break;
                }
            }
            seen.push_back(idx);
            break;
        }
        case Power::Swap: {
            std::vector<int>& h = s.hole[who];
            const int low = cards::Rank(h[0]) < cards::Rank(h[1]) ? 0 : 1;
            h[static_cast<size_t>(low)] = s.deck.back();
            s.deck.pop_back();
            // Array.erase removes the first occurrence.
            std::vector<int>& pk = fx.peek[o];
            for (size_t i = 0; i < pk.size(); ++i) {
                if (pk[i] == low) {
                    pk.erase(pk.begin() + static_cast<std::ptrdiff_t>(i));
                    break;
                }
            }
            break;
        }
        case Power::Guard: fx.guard[who] = true; break;
        case Power::Over: fx.over[who] = true; break;
        case Power::Sight: fx.sight[who] = static_cast<int>(s.board.size()) + 1; break;
        case Power::Glare: fx.glare[who] = s.street; break;
        case Power::Retake: {
            // Replace this street's cards with fresh ones from the end of the deck. The old
            // cards are discarded. Their stars leave the star pot and the new cards roll for
            // stars with the usual rules. runout follows the board, so Future Sight and the
            // rest of the runout stay consistent.
            const int n = StreetCards(s.street);
            const int first = static_cast<int>(s.board.size()) - n;
            for (int i = first; i < static_cast<int>(s.board.size()); ++i) {
                for (size_t k = 0; k < s.stars.size(); ++k) {
                    if (s.stars[k].first == i) {
                        s.star_pot -= s.stars[k].second;
                        s.stars.erase(s.stars.begin() + static_cast<std::ptrdiff_t>(k));
                        break;
                    }
                }
            }
            for (int i = first; i < static_cast<int>(s.board.size()); ++i) {
                const int c = s.deck.back();
                s.deck.pop_back();
                s.board[static_cast<size_t>(i)] = c;
                s.runout[static_cast<size_t>(i)] = c;
                RollStar(s, i);
            }
            fx.retake[who] = true;
            break;
        }
        case Power::None: return false;
    }
    inv.erase(inv.begin() + slot);
    fx.used[who] += 1;
    fx.pstreet[who] = s.street;
    Event e;
    e.t = EventType::Power;
    e.who = who;
    e.power = id;
    s.events.push_back(e);
    return true;
}

// ---- saves -------------------------------------------------------------------
// A flat token stream: integers in decimal, strings as <length>:<bytes>, names for enums
// (the same names the Godot save uses), doubles with 17 significant digits.

namespace {

class Writer {
public:
    void Int(int64_t v) { Sep(); out_ += std::to_string(v); }
    void Bool(bool v) { Int(v ? 1 : 0); }
    void Str(const std::string& v) {
        Sep();
        out_ += std::to_string(v.size());
        out_ += ':';
        out_ += v;
    }
    void Dbl(double v) {
        char buf[40];
        std::snprintf(buf, sizeof(buf), "%.17g", v);
        Sep();
        out_ += buf;
    }
    void Ints(const std::vector<int>& v) {
        Int(static_cast<int64_t>(v.size()));
        for (int x : v) Int(x);
    }
    std::string Take() { return out_; }

private:
    void Sep() {
        if (!out_.empty()) out_ += ' ';
    }
    std::string out_;
};

class Reader {
public:
    explicit Reader(const std::string& t) : t_(t) {}
    bool ok() const { return ok_; }
    int64_t Int() {
        Skip();
        size_t j = pos_;
        if (j < t_.size() && t_[j] == '-') ++j;
        const size_t digits = j;
        while (j < t_.size() && t_[j] >= '0' && t_[j] <= '9') ++j;
        if (j == digits) {
            ok_ = false;
            return 0;
        }
        const int64_t v = std::strtoll(t_.substr(pos_, j - pos_).c_str(), nullptr, 10);
        pos_ = j;
        return v;
    }
    int I() { return static_cast<int>(Int()); }
    bool Bool() { return Int() != 0; }
    std::string Str() {
        const int64_t n = Int();
        if (!ok_ || n < 0 || pos_ >= t_.size() || t_[pos_] != ':' ||
            pos_ + 1 + static_cast<size_t>(n) > t_.size()) {
            ok_ = false;
            return std::string();
        }
        std::string v = t_.substr(pos_ + 1, static_cast<size_t>(n));
        pos_ += 1 + static_cast<size_t>(n);
        return v;
    }
    double Dbl() {
        Skip();
        size_t j = pos_;
        while (j < t_.size() && t_[j] != ' ') ++j;
        if (j == pos_) {
            ok_ = false;
            return 0.0;
        }
        const double v = std::strtod(t_.substr(pos_, j - pos_).c_str(), nullptr);
        pos_ = j;
        return v;
    }
    std::vector<int> Ints() {
        const int64_t n = Int();
        std::vector<int> v;
        if (n < 0 || n > 64) {
            ok_ = false;
            return v;
        }
        for (int64_t i = 0; i < n && ok_; ++i) v.push_back(I());
        return v;
    }
    bool AtEnd() {
        Skip();
        return pos_ == t_.size();
    }

private:
    void Skip() {
        while (pos_ < t_.size() && t_[pos_] == ' ') ++pos_;
    }
    const std::string& t_;
    size_t pos_ = 0;
    bool ok_ = true;
};

void WritePowers(Writer& w, const std::vector<Power>& v) {
    w.Int(static_cast<int64_t>(v.size()));
    for (Power p : v) w.Str(PowerName(p));
}

std::vector<Power> ReadPowers(Reader& r, bool& ok) {
    const int64_t n = r.Int();
    std::vector<Power> v;
    if (n < 0 || n > 64) {
        ok = false;
        return v;
    }
    for (int64_t i = 0; i < n; ++i) {
        const Power p = PowerFromName(r.Str());
        if (p == Power::None) ok = false;
        v.push_back(p);
    }
    return v;
}

}  // namespace

std::string Serialize(const State& s) {
    Writer w;
    w.Str("HB1");
    w.Int(s.seed);
    w.Int(s.rng_deck);
    w.Int(s.rng_ai);
    w.Int(s.rng_bonus);
    w.Str(s.avatar);
    w.Int(s.match);
    w.Int(s.score);
    w.Int(s.continues);
    WritePowers(w, s.powers[0]);
    WritePowers(w, s.powers[1]);
    w.Int(static_cast<int64_t>(s.events.size()));
    for (const Event& e : s.events) {
        w.Str(EventTypeName(e.t));
        w.Int(e.who);
        w.Str(ShownName(e.a));
        w.Int(e.amt);
        w.Int(e.idx);
        w.Int(e.value);
        w.Str(PowerName(e.power));
        w.Int(e.n);
        w.Int(e.winner);
    }
    w.Str(data::kRivals[static_cast<size_t>(s.rival)]);
    w.Int(s.stack[0]);
    w.Int(s.stack[1]);
    w.Int(s.hand_no);
    w.Int(s.button);
    w.Str(PhaseName(s.phase));
    w.Int(s.winner);
    const Result& r = s.result;
    w.Bool(r.set);
    w.Int(r.pot);
    w.Bool(r.showdown);
    w.Int(r.winner);
    w.Int(r.vals[0]);
    w.Int(r.vals[1]);
    w.Int(r.pay[0]);
    w.Int(r.pay[1]);
    w.Int(r.points);
    w.Int(static_cast<int64_t>(r.lines.size()));
    for (const ResultLine& l : r.lines) {
        w.Str(l.label);
        w.Int(l.value);
    }
    w.Str(PowerName(r.power));
    w.Bool(r.guarded);
    w.Int(r.match_bonus);
    w.Ints(s.board);
    w.Ints(s.hole[0]);
    w.Ints(s.hole[1]);
    w.Int(s.bet[0]);
    w.Int(s.bet[1]);
    w.Int(s.total[0]);
    w.Int(s.total[1]);
    w.Bool(s.fever);
    w.Str(MissionName(s.mission.id));
    w.Str(s.mission.text);
    w.Int(s.mission.points);
    w.Int(s.mission.suit);
    w.Int(static_cast<int64_t>(s.stars.size()));
    for (const auto& kv : s.stars) {
        w.Int(kv.first);
        w.Int(kv.second);
    }
    w.Int(s.star_pot);
    for (int i = 0; i < 2; ++i) w.Ints(s.fx.peek[static_cast<size_t>(i)]);
    for (int i = 0; i < 2; ++i) {
        w.Bool(s.fx.guard[i]);
        w.Bool(s.fx.over[i]);
        w.Int(s.fx.sight[i]);
        w.Int(s.fx.glare[i]);
        w.Int(s.fx.used[i]);
        w.Int(s.fx.pstreet[i]);
        w.Bool(s.fx.retake[i]);
    }
    w.Int(s.blind[0]);
    w.Int(s.blind[1]);
    w.Ints(s.runout);
    w.Ints(s.deck);
    w.Int(s.street);
    w.Int(s.to_act);
    w.Int(s.last_raise);
    w.Bool(s.acted[0]);
    w.Bool(s.acted[1]);
    w.Int(s.folded);
    w.Bool(s.allin_seen);
    w.Bool(s.has_bot);
    w.Dbl(s.bot.loose);
    w.Dbl(s.bot.aggr);
    w.Dbl(s.bot.bluff);
    w.Bool(s.director_cut);
    return w.Take();
}

bool Deserialize(const std::string& text, State& out) {
    Reader r(text);
    bool ok = true;
    State s;
    if (r.Str() != "HB1") return false;
    s.seed = r.Int();
    s.rng_deck = r.Int();
    s.rng_ai = r.Int();
    s.rng_bonus = r.Int();
    s.avatar = r.Str();
    s.match = r.I();
    s.score = r.Int();
    s.continues = r.I();
    s.powers[0] = ReadPowers(r, ok);
    s.powers[1] = ReadPowers(r, ok);
    const int64_t ne = r.Int();
    if (ne < 0 || ne > 4096) return false;
    for (int64_t i = 0; i < ne && r.ok(); ++i) {
        Event e;
        const std::string t = r.Str();
        bool found = false;
        for (int k = 0; k <= static_cast<int>(EventType::Settle); ++k) {
            if (t == kEventNames[k]) {
                e.t = static_cast<EventType>(k);
                found = true;
            }
        }
        e.who = r.I();
        const std::string a = r.Str();
        bool found_a = false;
        for (int k = 0; k <= static_cast<int>(Shown::AllIn); ++k) {
            if (a == kShownNames[k]) {
                e.a = static_cast<Shown>(k);
                found_a = true;
            }
        }
        e.amt = r.I();
        e.idx = r.I();
        e.value = r.I();
        e.power = PowerFromName(r.Str());
        e.n = r.I();
        e.winner = r.I();
        if (!found || !found_a) ok = false;
        s.events.push_back(e);
    }
    s.rival = data::RivalIndex(r.Str());
    if (s.rival < 0) return false;
    s.stack[0] = r.I();
    s.stack[1] = r.I();
    s.hand_no = r.I();
    s.button = r.I();
    if (!PhaseFromName(r.Str(), s.phase)) return false;
    s.winner = r.I();
    Result& res = s.result;
    res.set = r.Bool();
    res.pot = r.I();
    res.showdown = r.Bool();
    res.winner = r.I();
    res.vals[0] = r.I();
    res.vals[1] = r.I();
    res.pay[0] = r.I();
    res.pay[1] = r.I();
    res.points = r.Int();
    const int64_t nl = r.Int();
    if (nl < 0 || nl > 64) return false;
    for (int64_t i = 0; i < nl && r.ok(); ++i) {
        ResultLine l;
        l.label = r.Str();
        l.value = r.Int();
        res.lines.push_back(l);
    }
    res.power = PowerFromName(r.Str());
    res.guarded = r.Bool();
    res.match_bonus = r.Int();
    s.board = r.Ints();
    s.hole[0] = r.Ints();
    s.hole[1] = r.Ints();
    s.bet[0] = r.I();
    s.bet[1] = r.I();
    s.total[0] = r.I();
    s.total[1] = r.I();
    s.fever = r.Bool();
    s.mission.id = MissionFromName(r.Str());
    s.mission.text = r.Str();
    s.mission.points = r.I();
    s.mission.suit = r.I();
    const int64_t ns = r.Int();
    if (ns < 0 || ns > 5) return false;
    for (int64_t i = 0; i < ns; ++i) {
        const int idx = r.I();
        const int val = r.I();
        s.stars.emplace_back(idx, val);
    }
    s.star_pot = r.I();
    for (int i = 0; i < 2; ++i) s.fx.peek[static_cast<size_t>(i)] = r.Ints();
    for (int i = 0; i < 2; ++i) {
        s.fx.guard[i] = r.Bool();
        s.fx.over[i] = r.Bool();
        s.fx.sight[i] = r.I();
        s.fx.glare[i] = r.I();
        s.fx.used[i] = r.I();
        s.fx.pstreet[i] = r.I();
        s.fx.retake[i] = r.Bool();
    }
    s.blind[0] = r.I();
    s.blind[1] = r.I();
    s.runout = r.Ints();
    s.deck = r.Ints();
    s.street = r.I();
    s.to_act = r.I();
    s.last_raise = r.I();
    s.acted[0] = r.Bool();
    s.acted[1] = r.Bool();
    s.folded = r.I();
    s.allin_seen = r.Bool();
    s.has_bot = r.Bool();
    s.bot.loose = r.Dbl();
    s.bot.aggr = r.Dbl();
    s.bot.bluff = r.Dbl();
    s.director_cut = r.Bool();
    if (!ok || !r.ok() || !r.AtEnd()) return false;
    out = s;
    return true;
}

}  // namespace game
}  // namespace hb
