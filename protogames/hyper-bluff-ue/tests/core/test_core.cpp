// Rules tests for the C++ core. The first 40 are hyper-bluff/godot/tests/run_tests.gd ported
// one to one (same names, same assertions); the t_dc_* tests cover Director's Cut.
// Prints "CORE TESTS n/n passed" and exits 1 on any failure. ONLY=name filters by substring.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <set>
#include <string>
#include <vector>

#include "HBAi.h"
#include "HBCards.h"
#include "HBData.h"
#include "HBGame.h"

using namespace hb;
namespace C = hb::cards;
namespace G = hb::game;

namespace {

std::string g_fail;

std::string Str(int v) { return std::to_string(v); }
std::string Str(int64_t v) { return std::to_string(v); }
std::string Str(bool v) { return v ? "true" : "false"; }
std::string Str(double v) {
    char b[64];
    std::snprintf(b, sizeof(b), "%.6f", v);
    return b;
}
std::string Str(const std::string& v) { return v; }
std::string Str(Phase p) { return PhaseName(p); }
std::string Str(Power p) { return std::string("\"") + PowerName(p) + "\""; }
std::string Str(EventType t) { return EventTypeName(t); }
template <typename T>
std::string Str(const std::vector<T>& v) {
    std::string o = "[";
    for (size_t i = 0; i < v.size(); ++i) o += (i ? ", " : "") + Str(v[i]);
    return o + "]";
}
template <typename T, size_t N>
std::string Str(const std::array<T, N>& v) {
    return Str(std::vector<T>(v.begin(), v.end()));
}

void ok(bool cond, const std::string& msg) {
    if (!cond && g_fail.empty()) g_fail = msg;
}

template <typename A, typename B>
void eq(const A& a, const B& b, const std::string& msg) {
    if (!(a == b) && g_fail.empty()) g_fail = msg + ": got " + Str(a) + ", want " + Str(b);
}

std::vector<int> V(std::initializer_list<int> l) { return std::vector<int>(l); }
std::array<int, 2> A2(int a, int b) { return std::array<int, 2>{{a, b}}; }

int ev(const std::string& text) { return C::Eval(C::Parse(text)); }

std::vector<int> Cat(const std::vector<int>& a, const std::vector<int>& b) {
    std::vector<int> o = a;
    o.insert(o.end(), b.begin(), b.end());
    return o;
}

// A hand with chosen cards: hole0, hole1, board (5 cards), player on the button or not.
State rig(const std::string& hole0, const std::string& hole1, const std::string& board,
          int seed_value = 5) {
    State s = G::NewRun(seed_value, "rin");
    G::StartHand(s);
    s.hole = {{C::Parse(hole0), C::Parse(hole1)}};
    s.runout = C::Parse(board);
    bool used[52] = {false};
    for (int c : Cat(Cat(s.hole[0], s.hole[1]), s.runout)) used[c] = true;
    std::vector<int> deck;
    for (int c = 0; c < 52; ++c) {
        if (!used[c]) deck.push_back(c);
    }
    s.deck = deck;
    s.fever = false;
    s.mission = Mission();
    s.powers = {{std::vector<Power>(), std::vector<Power>()}};
    return s;
}

void check_down(State& s) {
    for (int i = 0; i < 12; ++i) {
        if (s.phase == Phase::Bet) {
            G::Act(s, s.to_act, Action::Call);
        } else if (s.phase == Phase::Advance) {
            G::Advance(s);
        } else {
            break;
        }
    }
}

int chips(const State& s) { return s.stack[0] + s.stack[1] + G::Pot(s); }

// One step of a bot playout, as the Godot tests do it. Returns false at run_won.
bool bot_step(State& s, int* hands = nullptr) {
    switch (s.phase) {
        case Phase::Pre:
        case Phase::HandOver:
            G::StartHand(s);
            if (hands) *hands += 1;
            return true;
        case Phase::Bet: ai::Play(s, s.to_act); return true;
        case Phase::Advance: G::Advance(s); return true;
        case Phase::Showdown: G::Settle(s); return true;
        case Phase::MatchOver:
            if (s.winner == 0) {
                G::NextMatch(s);
            } else {
                G::ContinueRun(s);
            }
            return true;
        case Phase::RunWon: return false;
    }
    return false;
}

// ---- evaluator ----------------------------------------------------------------

bool t_eval_categories() {
    eq(C::Category(ev("As Kd 7h 5c 3s 9d 2c")), 0, "high card");
    eq(C::Category(ev("As Ad 7h 5c 3s 9d 2c")), 1, "pair");
    eq(C::Category(ev("As Ad 7h 7c 3s 9d 2c")), 2, "two pair");
    eq(C::Category(ev("As Ad Ah 7c 3s 9d 2c")), 3, "trips");
    eq(C::Category(ev("5s 6d 7h 8c 9s Kd 2c")), 4, "straight");
    eq(C::Category(ev("As Ks 7s 5s 3s 9d 2c")), 5, "flush");
    eq(C::Category(ev("As Ad Ah 7c 7s 9d 2c")), 6, "full house");
    eq(C::Category(ev("As Ad Ah Ac 7s 9d 2c")), 7, "quads");
    eq(C::Category(ev("5s 6s 7s 8s 9s Kd 2c")), 8, "straight flush");
    ok(C::IsRoyal(ev("Ts Js Qs Ks As 2d 2c")), "royal flush");
    ok(!C::IsRoyal(ev("9s Ts Js Qs Ks 2d 2c")), "king-high straight flush is not royal");
    return true;
}

bool t_eval_order_and_kickers() {
    ok(ev("As Ad Kh 5c 3s 9d 2c") > ev("As Ad Qh 5c 3s 9d 2c"), "pair kicker");
    ok(ev("As Ad 7h 7c Ks 9d 2c") > ev("As Ad 7h 7c Qs 9d 2c"), "two pair kicker");
    ok(ev("Ks Kd 7h 7c 2s 9d 3c") > ev("Qs Qd Jh Jc As 9d 3c"), "two pair top pair rules");
    ok(ev("2s 2d 2h 3c 4s 9d Tc") > ev("As Ad Kh Kc Qs 9d 3c"), "trips beat two pair");
    ok(ev("As 2d 3h 4c 5s 9d 9c") > ev("9s 9d 9h 4c 5s Kd 2c"), "wheel beats trips");
    ok(ev("2s 3d 4h 5c 6s 9d Kc") > ev("As 2d 3h 4c 5s 9d 9c"), "six-high straight beats wheel");
    eq(ev("As Kd Qh Jc Ts 2d 2c"), ev("Ah Kc Qs Jd Tc 3d 3c"), "same straight ties");
    ok(ev("As Ks 7s 5s 3s 9d 2c") > ev("As Qs Js 9s 8s 9d 2c"), "flush second card");
    ok(ev("As Ad Ah Kc Ks 9d 2c") > ev("Ks Kd Kh Ac As 9d 2c"), "full house trips rule");
    ok(ev("As Ad Ah Kc Ks Kd 2c") > ev("As Ad Ah Qc Qs 9d 2c"), "two trips make the best full house");
    ok(ev("7s 7d 7h 7c As 9d 2c") > ev("7s 7d 7h 7c Ks 9d 2c"), "quads kicker");
    ok(ev("As Ad 3h 3c 2s 2d Kc") > ev("As Ad 3h 3c 2s 2d Qc"), "three pairs use the best kicker");
    return true;
}

bool t_eval_six_card_flush_and_hidden_straight() {
    eq(C::Category(ev("As Ks Qs 9s 5s 2s 3d")), 5, "six suited cards");
    ok(ev("As Ks Qs 9s 5s 2s 3d") == ev("As Ks Qs 9s 5s 4d 3d"), "flush uses its top five");
    eq(C::Category(ev("4s 5d 6h 7c 8s 8d 8c")), 4, "straight over trips");
    eq(C::Category(ev("5s 6s 7s 8s 9d 9s 9c")), 8, "straight flush found among extras");
    return true;
}

bool t_names_fit() {
    eq(C::NameOf(ev("Ks Kd 7h 5c 3s")), std::string("Pair of Kings"), "pair name");
    eq(C::NameOf(ev("Ts Js Qs Ks As")), std::string("Royal Flush"), "royal name");
    eq(C::NameOf(ev("As Kd")), std::string("Ace high"), "two cards");
    for (int a = 0; a < 52; ++a) {
        for (int b = a + 1; b < 52; b += 5) {
            for (int c = b + 1; c < 52; c += 7) {
                const std::string n = C::NameOf(C::Eval(V({a, b, c, (c + 11) % 52, (c + 23) % 52})));
                ok(n.size() <= 24, "name too long: " + n);
            }
        }
    }
    return true;
}

// ---- win chance -----------------------------------------------------------------

bool t_equity_known_values() {
    int64_t box = 99;
    const double aa = C::Equity(C::Parse("As Ad"), {}, {}, {}, 4000, box);
    ok(std::fabs(aa - 0.852) < 0.03, "AA preflop " + Str(aa));
    const double low = C::Equity(C::Parse("7s 2d"), {}, {}, {}, 4000, box);
    ok(std::fabs(low - 0.346) < 0.03, "72o preflop " + Str(low));
    const double nuts = C::Equity(C::Parse("As Ks"), C::Parse("Qs Js Ts 2d 3c"), {}, {}, 300, box);
    eq(nuts, 1.0, "royal on the river");
    const double dead = C::Equity(C::Parse("2s 3d"), C::Parse("As Ad Ah Kc Kd"), {}, {}, 500, box);
    ok(dead <= 0.5, "playing the board can only tie or lose");
    return true;
}

bool t_equity_uses_peeked_card() {
    int64_t box = 7;
    const double blind = C::Equity(C::Parse("Ks Kd"), {}, {}, {}, 3000, box);
    const double seen = C::Equity(C::Parse("Ks Kd"), {}, C::Parse("Ah"), {}, 3000, box);
    ok(seen < blind - 0.08, "a peeked ace lowers the kings: " + Str(seen) + " vs " + Str(blind));
    return true;
}

bool t_equity_is_deterministic() {
    int64_t b1 = 5, b2 = 5;
    const C::EquityScore a = C::EquityBatch(C::Parse("Qs Jd"), C::Parse("Th 9c 2s"), {}, {}, 200, b1);
    const C::EquityScore b = C::EquityBatch(C::Parse("Qs Jd"), C::Parse("Th 9c 2s"), {}, {}, 200, b2);
    eq(a.score, b.score, "same seed, same estimate");
    eq(a.samples, b.samples, "same seed, same estimate");
    return true;
}

// ---- betting --------------------------------------------------------------------

bool t_blinds_and_button() {
    State s = G::NewRun(1, "rin");
    G::StartHand(s);
    eq(s.button, 0, "player has the button first");
    eq(s.bet, A2(10, 20), "button posts the small blind");
    eq(s.to_act, 0, "button acts first before the flop");
    G::Act(s, 0, Action::Fold);
    G::Settle(s);
    eq(s.stack, A2(790, 810), "blind lost on a fold");
    G::StartHand(s);
    eq(s.button, 1, "button moves");
    eq(s.bet, A2(20, 10), "blinds swap");
    eq(s.to_act, 1, "rival acts first");
    return true;
}

bool t_blinds_rise() {
    State s = G::NewRun(1, "rin");
    std::vector<int> seen;
    for (int i = 0; i < 10; ++i) {
        G::StartHand(s);
        seen.push_back(s.blind[1]);
        s.stack = A2(800, 800);
        G::Act(s, s.to_act, Action::Fold);
        G::Settle(s);
    }
    eq(seen, V({20, 20, 20, 30, 30, 30, 50, 50, 50, 80}), "blind schedule");
    return true;
}

bool t_limp_gives_big_blind_the_option() {
    State s = rig("As Kd", "7h 2c", "Qs Js 3d 4c 8h");
    G::Act(s, 0, Action::Call);
    eq(s.phase, Phase::Bet, "big blind still to act");
    eq(s.to_act, 1, "option goes to the big blind");
    G::Act(s, 1, Action::Call);
    eq(s.phase, Phase::Advance, "check closes the round");
    G::Advance(s);
    eq(static_cast<int>(s.board.size()), 3, "flop");
    eq(s.to_act, 1, "non-button acts first after the flop");
    return true;
}

bool t_min_raise_and_options() {
    State s = rig("As Kd", "7h 2c", "Qs Js 3d 4c 8h");
    eq(G::MinRaiseTo(s, 0), 40, "min raise is one big blind more");
    G::Act(s, 0, Action::Raise, 25);
    eq(s.bet[0], 40, "a short raise is lifted to the minimum");
    G::Act(s, 1, Action::Raise, 100);
    eq(G::MinRaiseTo(s, 0), 160, "re-raise must match the last raise size");
    const std::vector<int> opts = G::RaiseOptions(s, 0);
    ok(opts.size() >= 3, "several sizes offered");
    eq(opts.empty() ? -1 : opts.front(), 160, "first option is the minimum");
    eq(opts.empty() ? -1 : opts.back(), 800, "last option is all-in");
    for (size_t i = 1; i < opts.size(); ++i) ok(opts[i] > opts[i - 1], "options ascend");
    return true;
}

bool t_fold_awards_pot_without_showdown() {
    State s = rig("7s 2d", "As Ad", "Qs Js 3d 4c 8h");
    G::Act(s, 0, Action::Raise, 60);
    G::Act(s, 1, Action::Fold);
    eq(s.phase, Phase::Showdown, "fold ends the hand");
    G::Settle(s);
    eq(s.result.showdown, false, "no showdown");
    eq(s.result.winner, 0, "raiser wins");
    eq(s.stack, A2(820, 780), "wins the big blind");
    eq(s.phase, Phase::HandOver, "next hand");
    return true;
}

bool t_checking_cannot_fold() {
    State s = rig("7s 2d", "As Ad", "Qs Js 3d 4c 8h");
    G::Act(s, 0, Action::Call);
    G::Act(s, 1, Action::Fold);
    eq(s.folded, -1, "a free check is never a fold");
    return true;
}

bool t_showdown_best_hand_wins() {
    State s = rig("As Kd", "7h 2c", "Ah Js 3d 4c 8h");
    check_down(s);
    eq(s.phase, Phase::Showdown, "river checked through");
    G::Settle(s);
    eq(s.result.winner, 0, "pair of aces wins");
    eq(s.stack, A2(820, 780), "pot paid");
    return true;
}

bool t_split_pot() {
    State s = rig("As 2d", "Ah 3c", "Ks Kd Qh Qc Jd");
    check_down(s);
    G::Settle(s);
    eq(s.result.winner, -1, "board plays, tie");
    eq(s.stack, A2(800, 800), "chips returned");
    return true;
}

bool t_all_in_and_call_runs_out() {
    State s = rig("As Ad", "Ks Kd", "2h 7c 9d Jc 3s");
    G::Act(s, 0, Action::Raise, 800);
    eq(std::string(ShownName(s.events.back().a)), std::string("allin"), "shown as all-in");
    G::Act(s, 1, Action::Call);
    eq(s.phase, Phase::Advance, "no more betting");
    G::Advance(s);
    eq(s.phase, Phase::Advance, "flop dealt, still running out");
    G::Advance(s);
    G::Advance(s);
    eq(s.phase, Phase::Showdown, "river reached");
    G::Settle(s);
    eq(s.stack, A2(1600, 0), "aces hold");
    eq(s.phase, Phase::MatchOver, "rival is out");
    eq(s.winner, 0, "player wins the match");
    return true;
}

bool t_short_blind_all_in_refund() {
    State s = G::NewRun(3, "rin");
    s.stack = A2(1588, 12);
    G::StartHand(s);
    eq(s.button, 0, "player on the button");
    eq(s.stack[1], 0, "rival is all-in on the big blind");
    eq(s.to_act, 0, "player still owes two chips");
    G::Act(s, 0, Action::Call);
    eq(s.phase, Phase::Advance, "runs out");
    eq(s.total, A2(12, 12), "only the matched part is in the pot");
    eq(chips(s), 1600, "chips conserved");
    return true;
}

bool t_small_blind_all_in_refunds_big_blind() {
    State s = G::NewRun(3, "rin");
    s.stack = A2(5, 1595);
    G::StartHand(s);
    eq(s.phase, Phase::Advance, "no action possible");
    eq(s.total, A2(5, 5), "big blind excess returned");
    eq(s.stack, A2(0, 1590), "stacks after refund");
    return true;
}

bool t_bots_conserve_chips_and_finish() {
    for (int seed_value : {11, 12, 13, 14}) {
        State s = G::NewRun(seed_value, "rin");
        s.has_bot = true;
        s.bot = Profile{0.6, 0.6, 0.2};
        int hands = 0;
        int guard = 0;
        while (s.phase != Phase::RunWon && guard < 20000) {
            guard += 1;
            bot_step(s, &hands);
            if (s.phase != Phase::RunWon) {
                ok(chips(s) == 2 * data::Rival(s.rival).stack, "chips drifted at seed " + Str(seed_value) + " hand " + Str(hands) +
                                         ": " + Str(chips(s)));
                ok(s.stack[0] >= 0 && s.stack[1] >= 0, "negative stack");
                ok(static_cast<int>(s.powers[0].size()) <= G::kMaxPowers, "too many powers");
            }
        }
        eq(s.phase, Phase::RunWon, "seed " + Str(seed_value) + " never finished");
        ok(hands >= 5, "a run takes at least five hands");
    }
    return true;
}

bool t_same_seed_same_game() {
    std::vector<std::string> out;
    for (int k = 0; k < 2; ++k) {
        State s = G::NewRun(77, "aya");
        s.has_bot = true;
        s.bot = ai::DefaultProfile();
        for (int i = 0; i < 400; ++i) {
            const Phase ph = s.phase;
            if (ph == Phase::MatchOver || ph == Phase::RunWon) break;
            bot_step(s);
        }
        out.push_back(G::Serialize(s));
    }
    eq(out[0], out[1], "replay differs");
    return true;
}

bool t_save_round_trip_mid_hand() {
    State s = G::NewRun(21, "mako");
    G::StartHand(s);
    G::Act(s, 0, Action::Call);
    State copy;
    ok(G::Deserialize(G::Serialize(s), copy), "save loads");
    eq(G::Serialize(copy), G::Serialize(s), "loaded save is the same state");
    State* both[2] = {&s, &copy};
    for (State* st : both) {
        st->has_bot = true;
        st->bot = ai::DefaultProfile();
        for (int i = 0; i < 60; ++i) {
            switch (st->phase) {
                case Phase::HandOver: G::StartHand(*st); break;
                case Phase::Bet: ai::Play(*st, st->to_act); break;
                case Phase::Advance: G::Advance(*st); break;
                case Phase::Showdown: G::Settle(*st); break;
                default: break;
            }
        }
    }
    eq(G::Serialize(s), G::Serialize(copy), "saved game diverged");
    return true;
}

// ---- powers ---------------------------------------------------------------------

bool t_power_hawk_reveals_one_then_the_other() {
    State s = rig("As Kd", "7h 2c", "Qs Js 3d 4c 8h");
    s.powers[0] = {Power::Hawk, Power::Hawk, Power::Hawk};
    ok(G::UsePower(s, 0, 0), "first hawk");
    eq(static_cast<int>(G::KnownOpp(s, 0).size()), 1, "one card seen");
    ok(G::UsePower(s, 0, 0), "second hawk");
    std::vector<int> seen = G::KnownOpp(s, 0);
    std::sort(seen.begin(), seen.end());
    std::vector<int> want = s.hole[1];
    std::sort(want.begin(), want.end());
    eq(seen, want, "both cards seen");
    ok(!G::UsePower(s, 0, 0), "nothing left to see");
    eq(static_cast<int>(s.powers[0].size()), 1, "a refused power is kept");
    return true;
}

bool t_power_swap_replaces_low_card() {
    State s = rig("As 4d", "7h 2c", "Qs Js 3d 4c 8h");
    s.powers[0] = {Power::Swap};
    const int top = s.deck.back();
    ok(G::UsePower(s, 0, 0), "swap");
    eq(s.hole[0], V({C::Card("As"), top}), "low card replaced from the deck");
    eq(s.powers[0], std::vector<Power>(), "power spent");
    ok(std::find(s.deck.begin(), s.deck.end(), top) == s.deck.end(), "card left the deck");
    return true;
}

bool t_power_guard_keeps_half_at_showdown() {
    State s = rig("7s 2d", "As Ad", "Qs Js 3d 4c 8h");
    s.powers[0] = {Power::Guard};
    G::UsePower(s, 0, 0);
    G::Act(s, 0, Action::Raise, 200);
    G::Act(s, 1, Action::Call);
    check_down(s);
    G::Settle(s);
    eq(s.result.winner, 1, "aces win");
    eq(s.stack, A2(700, 900), "loser keeps half of the 200");
    ok(s.result.guarded, "result records the guard");
    return true;
}

bool t_power_guard_does_not_cover_a_fold() {
    State s = rig("7s 2d", "As Ad", "Qs Js 3d 4c 8h");
    s.powers[0] = {Power::Guard};
    G::UsePower(s, 0, 0);
    G::Act(s, 0, Action::Raise, 200);
    G::Act(s, 1, Action::Raise, 600);
    G::Act(s, 0, Action::Fold);
    G::Settle(s);
    eq(s.stack, A2(600, 1000), "a fold loses everything bet");
    return true;
}

bool t_power_overdrive_and_fever_multiply() {
    State base = rig("As Kd", "7h 2c", "Ah Js 3d 4c 8h");
    check_down(base);
    base.star_pot = 0;
    G::Settle(base);
    const int64_t plain = base.result.points;
    eq(plain, static_cast<int64_t>(20 + 100), "pot won plus pair bonus");
    State s = rig("As Kd", "7h 2c", "Ah Js 3d 4c 8h");
    s.powers[0] = {Power::Over};
    G::UsePower(s, 0, 0);
    s.fever = true;
    check_down(s);
    s.star_pot = 0;
    G::Settle(s);
    eq(s.result.points, plain * 6, "overdrive x2 and fever x3");
    eq(s.score, plain * 6, "score counts it");
    return true;
}

bool t_power_sight_shows_next_card() {
    State s = rig("As Kd", "7h 2c", "Qs Js 3d 4c 8h");
    s.powers[0] = {Power::Sight, Power::Sight};
    G::UsePower(s, 0, 0);
    eq(G::KnownBoard(s, 0), V({C::Card("Qs")}), "first flop card known");
    eq(G::KnownBoard(s, 1), std::vector<int>(), "rival knows nothing");
    ok(!G::CanUse(s, 0, Power::Sight), "one look per card");
    check_down(s);
    eq(s.street, 3, "river");
    ok(!G::CanUse(s, 0, Power::Sight) || s.phase != Phase::Bet, "no card left to see on the river");
    return true;
}

bool t_power_glare_blocks_raise_for_the_round() {
    State s = rig("As Kd", "7h 2c", "Qs Js 3d 4c 8h");
    s.powers[1] = {Power::Glare};
    G::Act(s, 0, Action::Call);
    ok(G::UsePower(s, 1, 0), "rival glares");
    G::Act(s, 1, Action::Raise, 80);
    eq(G::RaiseOptions(s, 0), std::vector<int>(), "player cannot raise");
    G::Act(s, 0, Action::Raise, 300);
    eq(s.total, A2(80, 80), "a raise becomes a call");
    G::Advance(s);
    G::Act(s, 1, Action::Call);
    ok(!G::RaiseOptions(s, 0).empty(), "next round is free again");
    return true;
}

bool t_glared_rival_folds_to_a_bet_unless_strong() {
    int folds = 0;
    for (int seed_value = 0; seed_value < 30; ++seed_value) {
        State s = rig("As Kd", "9h 8c", "Qs 5s 3d 4c 2h", seed_value + 1);
        s.rival = data::RivalIndex("goro");
        G::Act(s, 0, Action::Call);
        G::Act(s, 1, Action::Call);
        G::Advance(s);
        G::Act(s, 1, Action::Call);
        s.powers[0] = {Power::Glare};
        G::UsePower(s, 0, 0);
        G::Act(s, 0, Action::Raise, 40);
        ai::Play(s, 1);
        ok(s.bet[1] <= 40, "a glared rival never raises");
        if (s.folded == 1) folds += 1;
    }
    ok(folds >= 24, "nine-high should usually fold under the glare: " + Str(folds) + "/30");
    return true;
}

bool t_powers_only_on_your_turn_and_capped() {
    State s = rig("As Kd", "7h 2c", "Qs Js 3d 4c 8h");
    s.powers[1] = {Power::Hawk};
    ok(!G::UsePower(s, 1, 0), "not the rival's turn");
    s.powers[0] = {Power::Hawk, Power::Swap, Power::Guard};
    eq(G::GrantPower(s, 0), Power::None, "no fourth power");
    ok(!G::UsePower(s, 0, 5), "bad slot");
    return true;
}

bool t_showdown_win_grants_a_power() {
    State s = rig("As Kd", "7h 2c", "Ah Js 3d 4c 8h");
    check_down(s);
    G::Settle(s);
    ok(s.result.power != Power::None, "power granted");
    eq(static_cast<int>(s.powers[0].size()), 1, "inventory grew");
    return true;
}

// ---- bonus points ---------------------------------------------------------------

int64_t mission_points(MissionId id, const std::string& hole0, const std::string& board,
                       const std::string& how) {
    State s = rig(hole0, "7h 2c", board);
    for (const MissionInfo& m : data::Missions()) {
        if (m.id == id) {
            s.mission.id = id;
            s.mission.text = m.text;
            s.mission.points = m.points;
            s.mission.suit = 1;
        }
    }
    if (how == "fold") {
        G::Act(s, 0, Action::Raise, 60);
        G::Act(s, 1, Action::Fold);
    } else if (how == "allin") {
        G::Act(s, 0, Action::Raise, 800);
        G::Act(s, 1, Action::Call);
        check_down(s);
    } else {
        check_down(s);
    }
    G::Settle(s);
    for (const ResultLine& line : s.result.lines) {
        if (line.label == "BONUS MISSION") return line.value;
    }
    return 0;
}

bool t_missions() {
    using M = MissionId;
    eq(mission_points(M::Win, "As Kd", "Ah Js 3d 4c 8h", "show"), int64_t(200), "win");
    eq(mission_points(M::Pair, "As Kd", "Ah Js 3d 4c 8h", "show"), int64_t(300), "pair at showdown");
    eq(mission_points(M::Pair, "As Kd", "Qh Js 3d 4c 8h", "fold"), int64_t(0), "ace high is no pair");
    eq(mission_points(M::Pair, "As Ad", "Qh Js 3d 4c 8h", "fold"), int64_t(300), "pocket pair counts on a fold win");
    eq(mission_points(M::TwoPair, "As Kd", "Ah Ks 3d 4c 8h", "show"), int64_t(800), "two pair");
    eq(mission_points(M::TwoPair, "As Kd", "Ah Js 3d 4c 8h", "show"), int64_t(0), "one pair is not enough");
    eq(mission_points(M::Bluff, "As Kd", "Ah Js 3d 4c 8h", "fold"), int64_t(400), "no showdown");
    eq(mission_points(M::Bluff, "As Kd", "Ah Js 3d 4c 8h", "show"), int64_t(0), "showdown");
    eq(mission_points(M::Suit, "Ah Kh", "As Jh 3d 4c 8h", "show"), int64_t(4 * 150), "four hearts");
    eq(mission_points(M::AllIn, "As Ad", "Qh Js 3d 4c 8h", "allin"), int64_t(1500), "all-in win");
    eq(mission_points(M::AllIn, "As Ad", "Qh Js 3d 4c 8h", "show"), int64_t(0), "no all-in");
    eq(mission_points(M::Big, "As Ad", "Qh Js 3d 4c 8h", "allin"), int64_t(600), "big pot");
    eq(mission_points(M::Big, "As Ad", "Qh Js 3d 4c 8h", "show"), int64_t(0), "small pot");
    eq(mission_points(M::Pure, "As Ad", "Qh Js 3d 4c 8h", "show"), int64_t(350), "no power used");
    return true;
}

bool t_no_points_for_losing() {
    State s = rig("7s 2d", "As Ad", "Qs Js 3d 4c 8h");
    s.mission.id = MissionId::Win;
    s.mission.text = "";
    s.mission.points = 200;
    s.mission.suit = -1;
    s.star_pot = 500;
    check_down(s);
    G::Settle(s);
    eq(s.result.points, int64_t(0), "loser scores nothing");
    eq(s.score, int64_t(0), "score unchanged");
    return true;
}

bool t_mission_is_random_and_always_set() {
    std::set<int> seen;
    State s = G::NewRun(9, "rin");
    for (int i = 0; i < 300; ++i) {
        G::StartHand(s);
        ok(!s.mission.Empty(), "mission missing");
        ok(s.mission.text.size() <= 34, "mission text too long: " + s.mission.text);
        seen.insert(static_cast<int>(s.mission.id));
        s.stack = A2(800, 800);
    }
    eq(static_cast<int>(seen.size()), static_cast<int>(data::Missions().size()), "every mission comes up");
    return true;
}

bool t_star_cards_fill_the_star_pot() {
    int stars = 0;
    int hands = 0;
    int powers = 0;
    std::set<int> values;
    for (int seed_value = 0; seed_value < 400; ++seed_value) {
        State s = rig("As Kd", "7h 2c", "Ah Js 3d 4c 8h", seed_value + 1);
        check_down(s);
        hands += 1;
        int sum = 0;
        for (const auto& kv : s.stars) {
            ok(kv.first >= 0 && kv.first < 5, "star on a real board card");
            sum += kv.second;
            values.insert(kv.second);
            stars += 1;
        }
        eq(s.star_pot, sum, "star pot adds up");
        for (const Event& e : s.events) {
            if (e.t == EventType::Star && e.value == 777) {
                ok(e.power != Power::None, "777 grants a power");
                powers += 1;
            }
        }
        G::Settle(s);
        if (sum > 0) {
            bool found = false;
            for (const ResultLine& line : s.result.lines) {
                if (line.label == "STAR CARDS") found = line.value == sum;
            }
            ok(found, "star points paid to the winner");
        }
    }
    const double rate = static_cast<double>(stars) / static_cast<double>(hands * 5);
    ok(rate > 0.10 && rate < 0.20, "about 15% of board cards sparkle: " + Str(rate));
    ok(values.size() >= 5, "star values vary: " + Str(static_cast<int>(values.size())));
    ok(powers >= 1, "a 777 came up");
    return true;
}

bool t_fever_comes_and_goes() {
    State s = G::NewRun(4, "rin");
    int fevers = 0;
    for (int i = 0; i < 500; ++i) {
        G::StartHand(s);
        if (i == 0) ok(!s.fever, "never on the first hand");
        if (s.fever) fevers += 1;
        s.stack = A2(800, 800);
        s.powers[0].clear();
    }
    ok(fevers > 30 && fevers < 95, "about 12% of hands: " + Str(fevers) + "/500");
    return true;
}

// ---- run flow -------------------------------------------------------------------

bool t_match_ladder_and_continue() {
    State s = G::NewRun(2, "rin");
    eq(std::string(data::kRivals[static_cast<size_t>(s.rival)]), std::string("pochi"), "first rival");
    eq(static_cast<int>(s.powers[0].size()), 2, "two starting powers");
    s.score = 1000;
    s.stack = A2(0, 1600);
    s.phase = Phase::MatchOver;
    s.winner = 1;
    G::ContinueRun(s);
    eq(s.score, int64_t(500), "continue halves the score");
    eq(std::string(data::kRivals[static_cast<size_t>(s.rival)]), std::string("pochi"), "same rival again");
    eq(s.stack, A2(800, 800), "fresh stacks");
    for (int i = 0; i < static_cast<int>(data::kRivals.size()); ++i) {
        eq(s.rival, i, "ladder order");
        const int want = i % 2 == 1 ? 500 : 800;
        eq(s.stack, A2(want, want), std::string("stack for ") + data::kRivals[static_cast<size_t>(i)]);
        eq(s.powers[1], data::Rival(s.rival).powers, "rival powers set");
        s.phase = Phase::MatchOver;
        s.winner = 0;
        G::NextMatch(s);
    }
    eq(s.phase, Phase::RunWon, "nine wins end the run");
    return true;
}

bool t_ladder_story() {
    eq(static_cast<int>(data::kRivals.size()), 9, "five floors and four mini-bosses");
    for (int i = 0; i < static_cast<int>(data::kRivals.size()); ++i) {
        const CastEntry& c = data::Rival(i);
        eq(c.mini, i % 2 == 1, "mini-bosses sit between floors");
        ok(!c.lore.empty(), std::string("lore for ") + c.id);
        ok(c.room >= 1 && c.room <= 5, std::string("room for ") + c.id);
        ok(data::EpisodeLabel(i).size() <= 32, "episode label fits: " + data::EpisodeLabel(i));
    }
    eq(data::EpisodeLabel(0), std::string("EPISODE 1: THE LOBBY PIT"), "first episode");
    eq(data::EpisodeLabel(1), std::string("INTERLUDE: THE STAIRWELL"), "first interlude");
    eq(data::EpisodeLabel(8), std::string("EPISODE 5: THE STARLIGHT TABLE"), "final episode");
    return true;
}

bool t_match_bonus_scales() {
    State s = rig("As Ad", "Ks Kd", "2h 7c 9d Jc 3s");
    s.match = 2;
    G::Act(s, 0, Action::Raise, 800);
    G::Act(s, 1, Action::Call);
    check_down(s);
    G::Settle(s);
    eq(s.result.match_bonus, int64_t(6000), "third match pays 3 x 2000");
    return true;
}

bool t_rivals_play_differently() {
    std::map<std::string, int> raised;
    for (const char* rival : {"pochi", "goro"}) {
        raised[rival] = 0;
        for (int seed_value = 0; seed_value < 120; ++seed_value) {
            State s = G::NewRun(seed_value + 1, "rin");
            s.rival = data::RivalIndex(rival);
            s.powers[1].clear();
            G::StartHand(s);
            G::StartHand(s);
            ai::Play(s, 1);
            if (s.bet[1] > 20) raised[rival] += 1;
        }
    }
    ok(raised["goro"] > raised["pochi"] * 2,
       "the biker opens far more than the rookie: goro " + Str(raised["goro"]) + " pochi " + Str(raised["pochi"]));
    return true;
}

bool t_text_lengths() {
    for (const CastEntry& c : data::Cast()) {
        ok(std::strlen(c.name) <= 20, std::string("name too long: ") + c.id);
        ok(std::strlen(c.title) <= 18, std::string("title too long: ") + c.id);
        ok(std::strlen(c.shout) <= 24, std::string("shout too long: ") + c.id);
    }
    for (const PowerInfo& p : data::Powers()) {
        ok(std::strlen(p.name) <= 12, std::string("power name too long: ") + PowerName(p.id));
        ok(std::strlen(p.desc) <= 40, std::string("power text too long: ") + PowerName(p.id));
    }
    for (const char* id : data::kRivals) {
        const CastEntry* c = data::FindCast(id);
        ok(c != nullptr, std::string("missing rival ") + id);
        if (!c) continue;
        const std::vector<std::string>* lists[] = {&c->intro, &c->win, &c->lose, &c->allin, &c->beaten, &c->gloat};
        for (const auto* l : lists) ok(!l->empty(), std::string(id) + " has a missing line list");
    }
    return true;
}

// ---- Director's Cut: "CUT! RETAKE" ---------------------------------------------

// Play the preflop through and deal the flop: seat 1 (not on the button) acts first.
State dc_flop(const std::string& hole0, const std::string& hole1, const std::string& board, int seed = 5) {
    State s = rig(hole0, hole1, board, seed);
    s.director_cut = true;
    G::Act(s, 0, Action::Call);
    G::Act(s, 1, Action::Call);
    G::Advance(s);
    return s;
}

// No card appears twice among hole cards, board, the rest of the runout and the deck.
bool dc_consistent(const State& s, std::string* why) {
    std::vector<int> all = Cat(s.hole[0], s.hole[1]);
    for (size_t i = 0; i < s.board.size(); ++i) {
        if (i >= s.runout.size() || s.board[i] != s.runout[i]) {
            *why = "board[" + Str(static_cast<int>(i)) + "] != runout";
            return false;
        }
    }
    all = Cat(all, s.runout);
    all = Cat(all, s.deck);
    std::vector<int> sorted = all;
    std::sort(sorted.begin(), sorted.end());
    for (size_t i = 1; i < sorted.size(); ++i) {
        if (sorted[i] == sorted[i - 1]) {
            *why = "card " + C::Label(sorted[i]) + " appears twice";
            return false;
        }
    }
    for (int c : sorted) {
        if (c < 0 || c > 51) {
            *why = "bad card";
            return false;
        }
    }
    return true;
}

bool t_dc_retake_text_and_pool() {
    const PowerInfo& p = data::PowerInfoOf(Power::Retake);
    eq(std::string(p.name), std::string("CUT! RETAKE"), "name");
    eq(std::string(p.desc), std::string("Reshoot the newest table card(s)."), "desc");
    ok(std::strlen(p.desc) <= 40, "desc fits");
    eq(std::string(PowerName(Power::Retake)), std::string("retake"), "id");
    eq(PowerFromName("retake"), Power::Retake, "id round trip");
    eq(static_cast<int>(data::PowerIds(false).size()), 6, "Godot pool unchanged");
    eq(static_cast<int>(data::PowerIds(true).size()), 7, "retake joins the pool");
    // Grants: never retake without the flag, sometimes with it.
    int with = 0;
    int without = 0;
    for (int seed = 1; seed <= 200; ++seed) {
        State a = G::NewRun(seed, "rin", false);
        State b = G::NewRun(seed, "rin", true);
        for (Power x : a.powers[0]) without += x == Power::Retake ? 1 : 0;
        for (Power x : b.powers[0]) with += x == Power::Retake ? 1 : 0;
    }
    eq(without, 0, "no retake grants in the classic pool");
    ok(with > 20, "retake is granted with Director's Cut: " + Str(with));
    // The boss starts with it only under Director's Cut.
    State on = G::NewRun(1, "rin", true);
    on.match = static_cast<int>(data::kRivals.size()) - 1;  // the boss, last on the ladder
    G::StartMatch(on);
    eq(on.powers[1], std::vector<Power>({Power::Swap, Power::Glare, Power::Guard, Power::Hawk, Power::Retake}),
       "onyx gets retake");
    State off = G::NewRun(1, "rin", false);
    off.match = static_cast<int>(data::kRivals.size()) - 1;
    G::StartMatch(off);
    eq(off.powers[1], data::Rival(off.match).powers, "classic onyx unchanged");
    State goro = G::NewRun(1, "rin", true);
    goro.match = 1;
    G::StartMatch(goro);
    eq(goro.powers[1], data::Rival(1).powers, "other rivals unchanged");
    return true;
}

bool t_dc_retake_availability() {
    State s = rig("As Kd", "7h 2c", "Qs Js 3d 4c 8h");
    s.director_cut = true;
    s.powers[0] = {Power::Retake};
    s.powers[1] = {Power::Retake};
    ok(!G::CanUse(s, 0, Power::Retake), "not before the flop");
    G::Act(s, 0, Action::Call);
    G::Act(s, 1, Action::Call);
    ok(!G::CanUse(s, 1, Power::Retake), "not while the street is being dealt");
    G::Advance(s);
    eq(s.to_act, 1, "seat 1 acts first on the flop");
    ok(G::CanUse(s, 1, Power::Retake), "flop just dealt, nobody acted");
    ok(!G::CanUse(s, 0, Power::Retake), "not on the other seat's turn");
    G::Act(s, 1, Action::Call);  // check
    ok(!G::CanUse(s, 0, Power::Retake), "not after a check on this street");
    G::Act(s, 0, Action::Raise, 40);
    ok(!G::CanUse(s, 1, Power::Retake), "not after a bet");
    G::Act(s, 1, Action::Call);
    G::Advance(s);
    ok(G::CanUse(s, 1, Power::Retake), "the turn counts as a new street");
    State low = s;
    low.deck.clear();
    ok(!G::CanUse(low, 1, Power::Retake), "not with an empty deck");
    G::Act(s, 1, Action::Call);
    G::Act(s, 0, Action::Call);
    G::Advance(s);
    ok(G::CanUse(s, 1, Power::Retake), "river is allowed");
    State d = s;
    d.phase = Phase::Showdown;
    ok(!G::CanUse(d, 1, Power::Retake), "only while betting");
    return true;
}

bool t_dc_retake_swaps_flop_and_keeps_runout() {
    State s = dc_flop("As Kd", "7h 2c", "Qs Js 3d 4c 8h");
    s.powers[1] = {Power::Retake};
    s.powers[0] = {Power::Sight};
    const std::vector<int> old_board = s.board;
    const std::vector<int> old_runout = s.runout;
    const std::vector<int> old_deck = s.deck;
    std::string why;
    ok(dc_consistent(s, &why), "consistent before: " + why);
    ok(G::UsePower(s, 1, 0), "retake on the flop");
    eq(static_cast<int>(s.board.size()), 3, "still a flop");
    const size_t nd = old_deck.size();
    eq(s.board, V({old_deck[nd - 1], old_deck[nd - 2], old_deck[nd - 3]}), "fresh cards from the end of the deck");
    eq(static_cast<int>(s.deck.size()), static_cast<int>(nd) - 3, "three cards left the deck");
    eq(s.runout[3], old_runout[3], "turn card unchanged");
    eq(s.runout[4], old_runout[4], "river card unchanged");
    ok(dc_consistent(s, &why), "consistent after: " + why);
    for (int c : old_board) {
        ok(std::find(s.board.begin(), s.board.end(), c) == s.board.end(), "old card off the board");
        ok(std::find(s.deck.begin(), s.deck.end(), c) == s.deck.end(), "old card discarded, not returned");
        ok(std::find(s.runout.begin(), s.runout.end(), c) == s.runout.end(), "old card not in the runout");
    }
    eq(s.events.back().t, EventType::Power, "power event");
    eq(s.events.back().power, Power::Retake, "power event names retake");
    eq(s.powers[1], std::vector<Power>(), "power spent");
    eq(s.fx.used[1], 1, "counted as used");
    // Future Sight after the retake still shows the real next card.
    G::Act(s, 1, Action::Call);
    ok(G::UsePower(s, 0, 0), "sight");
    eq(G::KnownBoard(s, 0), Cat(s.board, V({old_runout[3]})), "sight shows the turn");
    G::Act(s, 0, Action::Call);
    G::Advance(s);
    eq(s.board.back(), old_runout[3], "the turn is what sight showed");
    ok(dc_consistent(s, &why), "consistent on the turn: " + why);
    // A retake on the turn replaces one card.
    s.powers[1] = {Power::Retake};
    s.fx.retake[1] = false;  // pretend a new hand's allowance to exercise the turn swap
    const std::vector<int> flop(s.board.begin(), s.board.begin() + 3);
    const int top = s.deck.back();
    ok(G::UsePower(s, 1, 0), "retake on the turn");
    eq(std::vector<int>(s.board.begin(), s.board.begin() + 3), flop, "flop untouched");
    eq(s.board[3], top, "turn replaced");
    eq(s.runout[3], top, "runout follows");
    ok(dc_consistent(s, &why), "consistent after the turn retake: " + why);
    check_down(s);
    G::Settle(s);
    eq(chips(s), 1600, "chips conserved");
    return true;
}

bool t_dc_retake_star_pot() {
    int rerolled = 0;
    for (int seed = 1; seed <= 200; ++seed) {
        State s = dc_flop("As Kd", "7h 2c", "Qs Js 3d 4c 8h", seed);
        G::Act(s, 1, Action::Call);
        G::Act(s, 0, Action::Call);
        G::Advance(s);  // turn
        s.fever = true;  // 40% star chance, so re-rolled stars show up often
        s.stars = {{0, 100}, {3, 500}};
        s.star_pot = 600;
        s.powers[1] = {Power::Retake};
        const size_t before = s.events.size();
        ok(G::UsePower(s, 1, 0), "retake");
        int sum = 0;
        bool kept = false;
        for (const auto& kv : s.stars) {
            sum += kv.second;
            if (kv.first == 0 && kv.second == 100) kept = true;
        }
        ok(kept, "stars on cards that stay are kept");
        eq(s.star_pot, sum, "star pot matches the stars");
        int star_events = 0;
        for (size_t i = before; i < s.events.size(); ++i) {
            if (s.events[i].t == EventType::Star) {
                star_events += 1;
                eq(s.events[i].idx, 3, "new star on the replaced card");
            }
        }
        const int new_stars = static_cast<int>(s.stars.size()) - 1;
        eq(new_stars, star_events, "every new star announced");
        if (star_events == 0) eq(s.star_pot, 100, "old star value removed");
        if (star_events > 0) rerolled += 1;
    }
    ok(rerolled > 40 && rerolled < 120, "new card rolls for a star at the fever rate: " + Str(rerolled) + "/200");
    return true;
}

bool t_dc_retake_once_per_hand() {
    State s = dc_flop("As Kd", "7h 2c", "Qs Js 3d 4c 8h");
    s.powers[1] = {Power::Retake, Power::Retake};
    ok(G::UsePower(s, 1, 0), "first retake");
    G::Act(s, 1, Action::Call);
    G::Act(s, 0, Action::Call);
    G::Advance(s);
    ok(!G::CanUse(s, 1, Power::Retake), "second retake refused in the same hand");
    ok(!G::UsePower(s, 1, 0), "use refused");
    eq(static_cast<int>(s.powers[1].size()), 1, "refused power is kept");
    check_down(s);
    G::Settle(s);
    s.stack = A2(800, 800);
    G::StartHand(s);
    // Next hand: allowance back.
    for (int i = 0; i < 12 && s.street == 0; ++i) {
        if (s.phase == Phase::Bet) G::Act(s, s.to_act, Action::Call);
        else if (s.phase == Phase::Advance) G::Advance(s);
    }
    ok(s.phase == Phase::Bet && s.street == 1, "flop of the next hand");
    ok(!s.fx.retake[0] && !s.fx.retake[1], "allowance reset");
    ok(G::CanUse(s, s.to_act, Power::Retake), "a new hand gives a new retake");
    return true;
}

bool t_dc_ai_uses_retake_on_a_bad_flop() {
    // Seat 1 holds 7-2 on an ace-king-queen flop: well under 35%.
    State s = dc_flop("As Kd", "7h 2c", "Ad Kc Qh 4c 8h");
    s.powers[1] = {Power::Retake};
    const ai::Decision d = ai::Think(s, 1);
    ok(d.use_power && d.slot == 0, "rival reshoots a hopeless flop");
    State p = dc_flop("As Kd", "7h 2c", "Ad Kc Qh 4c 8h");
    p.powers[1] = {Power::Retake};
    ai::Play(p, 1);
    ok(p.fx.retake[1], "Play used it");
    bool event = false;
    for (const Event& e : p.events) event = event || (e.t == EventType::Power && e.power == Power::Retake);
    ok(event, "power event logged");
    std::string why;
    ok(dc_consistent(p, &why), "consistent: " + why);
    // A strong hand keeps its flop.
    State g = dc_flop("As Kd", "7h 7c", "7d 7s Qh 4c 8h");
    g.powers[1] = {Power::Retake};
    const ai::Decision k = ai::Think(g, 1);
    ok(!k.use_power, "quads keep the flop");
    // Never preflop or on the river.
    State pre = rig("As Kd", "7h 2c", "Ad Kc Qh 4c 8h");
    pre.director_cut = true;
    pre.powers[0] = {Power::Retake};
    ok(!ai::Think(pre, 0).use_power, "no retake preflop");
    return true;
}

bool t_dc_bots_conserve_chips() {
    int retakes = 0;
    int hands = 0;
    for (int seed_value = 1; seed_value <= 40; ++seed_value) {
        State s = G::NewRun(seed_value, "jiro", true);
        s.has_bot = true;
        s.bot = ai::DefaultProfile();
        s.match = seed_value % 5;
        G::StartMatch(s);
        int guard = 0;
        while (s.phase != Phase::RunWon && guard < 20000) {
            guard += 1;
            s.events.clear();
            bot_step(s, &hands);
            for (const Event& e : s.events) retakes += (e.t == EventType::Power && e.power == Power::Retake) ? 1 : 0;
            if (s.phase == Phase::RunWon) break;
            ok(chips(s) == 2 * data::Rival(s.rival).stack, "chips drifted at seed " + Str(seed_value) + ": " + Str(chips(s)));
            ok(s.stack[0] >= 0 && s.stack[1] >= 0, "negative stack");
            int sum = 0;
            for (const auto& kv : s.stars) sum += kv.second;
            ok(s.star_pot == sum, "star pot drifted");
            if (s.phase == Phase::Bet || s.phase == Phase::Advance || s.phase == Phase::Showdown) {
                std::string why;
                ok(dc_consistent(s, &why), "cards inconsistent at seed " + Str(seed_value) + ": " + why);
            }
        }
        eq(s.phase, Phase::RunWon, "seed " + Str(seed_value) + " never finished");
    }
    ok(retakes > 20, "bots reshoot sometimes: " + Str(retakes) + " in " + Str(hands) + " hands");
    return true;
}

bool t_dc_save_round_trip() {
    State s = dc_flop("As Kd", "7h 2c", "Ad Kc Qh 4c 8h");
    s.powers[1] = {Power::Retake};
    G::UsePower(s, 1, 0);
    State copy;
    ok(G::Deserialize(G::Serialize(s), copy), "save loads");
    eq(G::Serialize(copy), G::Serialize(s), "same state after load");
    ok(copy.director_cut && copy.fx.retake[1], "flags survive");
    State bad;
    ok(!G::Deserialize("HB1 nonsense", bad), "garbage is refused");
    return true;
}

struct TestCase {
    const char* name;
    bool (*fn)();
};

}  // namespace

int main() {
    std::vector<TestCase> tests = {
        {"t_eval_categories", t_eval_categories},
        {"t_eval_order_and_kickers", t_eval_order_and_kickers},
        {"t_eval_six_card_flush_and_hidden_straight", t_eval_six_card_flush_and_hidden_straight},
        {"t_names_fit", t_names_fit},
        {"t_equity_known_values", t_equity_known_values},
        {"t_equity_uses_peeked_card", t_equity_uses_peeked_card},
        {"t_equity_is_deterministic", t_equity_is_deterministic},
        {"t_blinds_and_button", t_blinds_and_button},
        {"t_blinds_rise", t_blinds_rise},
        {"t_limp_gives_big_blind_the_option", t_limp_gives_big_blind_the_option},
        {"t_min_raise_and_options", t_min_raise_and_options},
        {"t_fold_awards_pot_without_showdown", t_fold_awards_pot_without_showdown},
        {"t_checking_cannot_fold", t_checking_cannot_fold},
        {"t_showdown_best_hand_wins", t_showdown_best_hand_wins},
        {"t_split_pot", t_split_pot},
        {"t_all_in_and_call_runs_out", t_all_in_and_call_runs_out},
        {"t_short_blind_all_in_refund", t_short_blind_all_in_refund},
        {"t_small_blind_all_in_refunds_big_blind", t_small_blind_all_in_refunds_big_blind},
        {"t_bots_conserve_chips_and_finish", t_bots_conserve_chips_and_finish},
        {"t_same_seed_same_game", t_same_seed_same_game},
        {"t_save_round_trip_mid_hand", t_save_round_trip_mid_hand},
        {"t_power_hawk_reveals_one_then_the_other", t_power_hawk_reveals_one_then_the_other},
        {"t_power_swap_replaces_low_card", t_power_swap_replaces_low_card},
        {"t_power_guard_keeps_half_at_showdown", t_power_guard_keeps_half_at_showdown},
        {"t_power_guard_does_not_cover_a_fold", t_power_guard_does_not_cover_a_fold},
        {"t_power_overdrive_and_fever_multiply", t_power_overdrive_and_fever_multiply},
        {"t_power_sight_shows_next_card", t_power_sight_shows_next_card},
        {"t_power_glare_blocks_raise_for_the_round", t_power_glare_blocks_raise_for_the_round},
        {"t_glared_rival_folds_to_a_bet_unless_strong", t_glared_rival_folds_to_a_bet_unless_strong},
        {"t_powers_only_on_your_turn_and_capped", t_powers_only_on_your_turn_and_capped},
        {"t_showdown_win_grants_a_power", t_showdown_win_grants_a_power},
        {"t_missions", t_missions},
        {"t_no_points_for_losing", t_no_points_for_losing},
        {"t_mission_is_random_and_always_set", t_mission_is_random_and_always_set},
        {"t_star_cards_fill_the_star_pot", t_star_cards_fill_the_star_pot},
        {"t_fever_comes_and_goes", t_fever_comes_and_goes},
        {"t_match_ladder_and_continue", t_match_ladder_and_continue},
        {"t_match_bonus_scales", t_match_bonus_scales},
        {"t_ladder_story", t_ladder_story},
        {"t_rivals_play_differently", t_rivals_play_differently},
        {"t_text_lengths", t_text_lengths},
        {"t_dc_retake_text_and_pool", t_dc_retake_text_and_pool},
        {"t_dc_retake_availability", t_dc_retake_availability},
        {"t_dc_retake_swaps_flop_and_keeps_runout", t_dc_retake_swaps_flop_and_keeps_runout},
        {"t_dc_retake_star_pot", t_dc_retake_star_pot},
        {"t_dc_retake_once_per_hand", t_dc_retake_once_per_hand},
        {"t_dc_ai_uses_retake_on_a_bad_flop", t_dc_ai_uses_retake_on_a_bad_flop},
        {"t_dc_bots_conserve_chips", t_dc_bots_conserve_chips},
        {"t_dc_save_round_trip", t_dc_save_round_trip},
    };
    std::sort(tests.begin(), tests.end(),
              [](const TestCase& a, const TestCase& b) { return std::strcmp(a.name, b.name) < 0; });
    const char* only = std::getenv("ONLY");
    int passed = 0;
    int run = 0;
    for (const TestCase& t : tests) {
        if (only && *only && std::strstr(t.name, only) == nullptr) continue;
        run += 1;
        g_fail.clear();
        const bool finished = t.fn();
        if (!finished && g_fail.empty()) g_fail = "stopped early";
        if (g_fail.empty()) {
            passed += 1;
        } else {
            std::printf("FAIL %s: %s\n", t.name, g_fail.c_str());
        }
    }
    std::printf("CORE TESTS %d/%d passed\n", passed, run);
    return (passed == run && run > 0) ? 0 : 1;
}
