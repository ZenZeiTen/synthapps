// Parity dump for the C++ core: the twin of dump.gd. Both write the same canonical lines;
// run_core_tests.sh diffs them. Keep the two files in step.
//
// Usage: parity_dump <runs|eval|data> <shard> <shards> <seeds> <evals> <out>
#include <cmath>
#include <cstdio>
#include <cstdlib>
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

const int kMaxEnds = 2;
const int kFullEvery = 25;
const int kMaxSteps = 20000;

FILE* g_out = nullptr;

void Line(const std::string& s) {
    std::fputs(s.c_str(), g_out);
    std::fputc('\n', g_out);
}

std::string S(int64_t v) { return std::to_string(v); }
std::string B01(bool v) { return v ? "1" : "0"; }

template <typename T>
std::string Ints(const T& a) {
    std::string o;
    bool first = true;
    for (auto x : a) {
        if (!first) o += ",";
        o += S(x);
        first = false;
    }
    return o;
}

std::string Labels(const std::vector<int>& a) {
    if (a.empty()) return "-";
    std::string o;
    for (size_t i = 0; i < a.size(); ++i) {
        if (i) o += ",";
        o += C::Label(a[i]);
    }
    return o;
}

std::string Names(const std::vector<Power>& a) {
    if (a.empty()) return "-";
    std::string o;
    for (size_t i = 0; i < a.size(); ++i) {
        if (i) o += ",";
        o += PowerName(a[i]);
    }
    return o;
}

std::string Pw(Power p) { return p == Power::None ? "-" : PowerName(p); }

std::string Events(const State& s) {
    std::string o;
    for (const Event& e : s.events) {
        if (!o.empty()) o += ";";
        switch (e.t) {
            case EventType::Hand: o += "hand"; break;
            case EventType::Fever: o += "fever:" + Pw(e.power); break;
            case EventType::Act: o += "act:" + S(e.who) + ":" + ShownName(e.a) + ":" + S(e.amt); break;
            case EventType::Star: o += "star:" + S(e.idx) + ":" + S(e.value) + ":" + Pw(e.power); break;
            case EventType::Street: o += "street:" + S(e.n); break;
            case EventType::Power: o += "power:" + S(e.who) + ":" + PowerName(e.power); break;
            case EventType::Settle: o += "settle:" + S(e.winner); break;
        }
    }
    return o.empty() ? "-" : o;
}

std::string Stars(const State& s) {
    std::string o;
    for (const auto& kv : s.stars) {
        if (!o.empty()) o += ";";
        o += S(kv.first) + ":" + S(kv.second);
    }
    return o.empty() ? "-" : o;
}

std::string MissionText(const State& s) {
    const Mission& m = s.mission;
    if (m.Empty()) return "-";
    return std::string(MissionName(m.id)) + ":" + S(m.suit) + ":" + S(m.points) + ":" + m.text;
}

std::string FxText(const State& s) {
    const Fx& x = s.fx;
    return "pk=" + Ints(x.peek[0]) + "/" + Ints(x.peek[1]) + " g=" + B01(x.guard[0]) + "," + B01(x.guard[1]) +
           " o=" + B01(x.over[0]) + "," + B01(x.over[1]) + " si=" + Ints(x.sight) + " gl=" + Ints(x.glare) +
           " u=" + Ints(x.used) + " ps=" + Ints(x.pstreet);
}

std::string StateText(const State& s) {
    return std::string("ph=") + PhaseName(s.phase) + " st=" + S(s.street) + " ta=" + S(s.to_act) +
           " stk=" + Ints(s.stack) + " bet=" + Ints(s.bet) + " tot=" + Ints(s.total) + " brd=" + Labels(s.board) +
           " stars=" + Stars(s) + " sp=" + S(s.star_pot) + " fev=" + B01(s.fever) + " mis=" + MissionText(s) +
           " sc=" + S(s.score) + " m=" + S(s.match) + " r=" + data::kRivals[static_cast<size_t>(s.rival)] +
           " c=" + S(s.continues) + " pw=" + Names(s.powers[0]) + "|" + Names(s.powers[1]) + " " + FxText(s) +
           " rng=" + S(s.rng_deck) + "," + S(s.rng_ai) + "," + S(s.rng_bonus) + " ev=" + Events(s);
}

std::string EqText(const C::EquityScore& r) { return S(r.score) + "/" + S(r.samples); }

std::string DealInfo(const State& s, int64_t seed, int start) {
    int64_t box = seed * 7919 + static_cast<int64_t>(s.hand_no) * 31 + start;
    const C::EquityScore e0 = C::EquityBatch(s.hole[0], {}, {}, {}, 50, box);
    const std::vector<int> flop(s.runout.begin(), s.runout.begin() + 3);
    const C::EquityScore e1 = C::EquityBatch(s.hole[1], flop, {s.hole[0][0]}, {s.deck[0]}, 50, box);
    const std::vector<int> top(s.deck.end() - 3, s.deck.end());
    return " | hole=" + Labels(s.hole[0]) + "|" + Labels(s.hole[1]) + " run=" + Labels(s.runout) +
           " deck=" + S(static_cast<int64_t>(s.deck.size())) + ":" + Labels(top) + " blind=" + Ints(s.blind) +
           " btn=" + S(s.button) + " hand=" + S(s.hand_no) + " al=" + B01(s.allin_seen) + " eq=" + EqText(e0) +
           "," + EqText(e1) + "," + S(box);
}

std::string ResultInfo(const State& s, int64_t seed) {
    const Result& r = s.result;
    std::string lines;
    for (size_t i = 0; i < r.lines.size(); ++i) {
        if (i) lines += ";";
        lines += r.lines[i].label + "=" + S(r.lines[i].value);
    }
    int64_t box = seed * 104729 + s.hand_no;
    const C::EquityScore e = C::EquityBatch(s.hole[0], s.board, {}, {}, 40, box);
    return " | res=" + S(r.pot) + "," + B01(r.showdown) + "," + S(r.winner) + " vals=" + Ints(r.vals) +
           " pay=" + Ints(r.pay) + " pts=" + S(r.points) + " pwr=" + Pw(r.power) + " gd=" + B01(r.guarded) +
           " mb=" + S(r.match_bonus) + " w=" + S(s.winner) + " lines=" + lines + " name=" + C::NameOf(r.vals[0]) +
           "/" + C::NameOf(r.vals[1]) + " eq=" + EqText(e);
}

void Play(int64_t seed, int start) {
    State s = G::NewRun(seed, data::kAvatars[static_cast<size_t>(seed % 4)]);
    s.has_bot = true;
    s.bot = ai::DefaultProfile();
    if (start > 0) {
        s.match = start;
        G::StartMatch(s);
    }
    const bool full = start == 0 && seed % kFullEvery == 0;
    Line("RUN " + S(seed) + " " + S(start) + " full=" + B01(full));
    Line("init " + StateText(s));
    int steps = 0;
    int ends = 0;
    while (s.phase != Phase::RunWon && steps < kMaxSteps) {
        if (s.phase == Phase::MatchOver && !full && ends >= kMaxEnds) break;
        s.events.clear();
        const Phase ph = s.phase;
        std::string extra;
        switch (ph) {
            case Phase::Pre:
            case Phase::HandOver:
                G::StartHand(s);
                extra = DealInfo(s, seed, start);
                break;
            case Phase::Bet: {
                // ai.gd never picks Overdrive; seat 0 fires it when it can so the x2 path is compared.
                int slot = -1;
                for (size_t i = 0; i < s.powers[0].size() && slot < 0; ++i) {
                    if (s.powers[0][i] == Power::Over) slot = static_cast<int>(i);
                }
                if (s.to_act == 0 && slot >= 0 && G::CanUse(s, 0, Power::Over)) G::UsePower(s, 0, slot);
                ai::Play(s, s.to_act);
                break;
            }
            case Phase::Advance: G::Advance(s); break;
            case Phase::Showdown:
                G::Settle(s);
                extra = ResultInfo(s, seed);
                break;
            case Phase::MatchOver:
                ends += 1;
                if (s.winner == 0) {
                    G::NextMatch(s);
                } else {
                    G::ContinueRun(s);
                }
                break;
            case Phase::RunWon: break;
        }
        steps += 1;
        Line(std::string(PhaseName(ph)) + " " + StateText(s) + extra);
    }
    Line("END " + S(seed) + " " + S(start) + " steps=" + S(steps) + " ends=" + S(ends) + " phase=" +
         PhaseName(s.phase) + " score=" + S(s.score));
}

void Evals(int shard, int64_t count) {
    int64_t box = 1000 + shard;
    std::vector<int> perm(52);
    for (int c = 0; c < 52; ++c) perm[static_cast<size_t>(c)] = c;
    uint64_t h = 17;
    std::vector<int64_t> cats(9, 0);
    for (int64_t i = 0; i < count; ++i) {
        const int size = 5 + C::Roll(box, 3);
        for (int j = 0; j < size; ++j) {
            const int k = j + C::Roll(box, 52 - j);
            std::swap(perm[static_cast<size_t>(j)], perm[static_cast<size_t>(k)]);
        }
        const std::vector<int> hand(perm.begin(), perm.begin() + size);
        const int v = C::Eval(hand);
        cats[static_cast<size_t>(v >> 20)] += 1;
        h = h * 1000003ULL + static_cast<uint64_t>(static_cast<int64_t>(v));
        if (i % 499 == 0) Line("N " + S(i) + " " + Labels(hand) + " " + S(v) + " " + C::NameOf(v));
        if ((i + 1) % 100000 == 0) Line("H " + S(i) + " " + S(WrapI64(h)));
    }
    Line("C " + Ints(cats));
    Line("H end " + S(WrapI64(h)));
    for (int n : {2, 3, 4}) {
        uint64_t h2 = 5;
        for (int i = 0; i < 20000; ++i) {
            for (int j = 0; j < n; ++j) {
                const int k = j + C::Roll(box, 52 - j);
                std::swap(perm[static_cast<size_t>(j)], perm[static_cast<size_t>(k)]);
            }
            const int v = C::Eval(perm.data(), n);
            h2 = h2 * 1000003ULL + static_cast<uint64_t>(static_cast<int64_t>(v));
            if (i % 997 == 0) Line("S " + S(n) + " " + S(v) + " " + C::NameOf(v));
        }
        Line("HS " + S(n) + " " + S(WrapI64(h2)));
    }
}

std::string Join(const std::vector<std::string>& v) {
    std::string o;
    for (size_t i = 0; i < v.size(); ++i) o += (i ? "," : "") + v[i];
    return o;
}

template <typename A>
std::string JoinC(const A& a) {
    std::vector<std::string> v;
    for (const char* x : a) v.push_back(x);
    return Join(v);
}

int64_t Micro(double x) { return std::llround(x * 1000000.0); }

void DumpData() {
    Line("AVATARS " + JoinC(data::kAvatars));
    Line("RIVALS " + JoinC(data::kRivals));
    Line("EXPR " + JoinC(data::kExpr));
    for (const CastEntry& c : data::Cast()) {
        Line(std::string("CAST ") + c.id + "|" + c.name + "|" + c.title + "|" + c.shout + "|" + c.blurb);
        if (c.is_rival) {
            Line(std::string("PROF ") + c.id + " " + S(Micro(c.profile.loose)) + " " + S(Micro(c.profile.aggr)) + " " +
                 S(Micro(c.profile.bluff)) + " " + Names(c.powers));
            const std::pair<const char*, const std::vector<std::string>*> lists[] = {
                {"intro", &c.intro}, {"win", &c.win}, {"lose", &c.lose},
                {"allin", &c.allin}, {"beaten", &c.beaten}, {"gloat", &c.gloat}};
            for (const auto& l : lists) {
                for (const std::string& line : *l.second) Line(std::string("LINE ") + c.id + " " + l.first + " " + line);
            }
        }
    }
    for (Power p : data::PowerIds(false)) {
        const PowerInfo& i = data::PowerInfoOf(p);
        Line(std::string("POWER ") + PowerName(p) + "|" + i.name + "|" + i.desc);
    }
    for (const MissionInfo& m : data::Missions()) {
        Line(std::string("MISSION ") + MissionName(m.id) + "|" + m.text + "|" + S(m.points) + "|" + S(m.weight));
    }
    Line("SUITS " + JoinC(data::kSuitName));
    for (const std::string& l : data::StoryOpen()) Line("OPEN " + l);
    for (const std::string& l : data::StoryBoss()) Line("BOSS " + l);
    for (const std::string& l : data::StoryEnd()) Line("END " + l);
    for (const std::string& l : data::Credits()) Line("CREDIT " + l);
    std::string blinds = "[";
    for (size_t i = 0; i < G::kBlinds.size(); ++i) {
        blinds += (i ? ", [" : "[") + S(G::kBlinds[i][0]) + ", " + S(G::kBlinds[i][1]) + "]";
    }
    Line("BLINDS " + blinds + "]");
    Line("CONST " + S(G::kStartStack) + " " + S(G::kHandsPerLevel) + " " + S(G::kMaxPowers) + " " +
         Ints(G::kHandPoints) + " " + S(G::kRoyalPoints) + " " + Ints(G::kStarValues) + " " + Ints(G::kStarWeights) +
         " " + S(G::kStarChance) + " " + S(G::kStarChanceFever) + " " + S(G::kFeverChance) + " " + S(G::kMatchBonus) +
         " " + S(ai::kSamples));
    const Profile d = ai::DefaultProfile();
    Line("DEFAULT " + S(Micro(d.loose)) + " " + S(Micro(d.aggr)) + " " + S(Micro(d.bluff)));
}

}  // namespace

int main(int argc, char** argv) {
    if (argc != 7) {
        std::fprintf(stderr, "usage: parity_dump <runs|eval|data> <shard> <shards> <seeds> <evals> <out>\n");
        return 2;
    }
    const std::string mode = argv[1];
    const int shard = std::atoi(argv[2]);
    int shards = std::atoi(argv[3]);
    if (shards < 1) shards = 1;
    const int seeds = std::atoi(argv[4]);
    const int64_t evals = std::atoll(argv[5]);
    g_out = std::fopen(argv[6], "wb");
    if (!g_out) {
        std::fprintf(stderr, "cannot open %s\n", argv[6]);
        return 2;
    }
    if (mode == "runs") {
        for (int seed = 1; seed <= seeds; ++seed) {
            if ((seed - 1) % shards != shard) continue;
            for (int start = 0; start < 5; ++start) Play(seed, start);
        }
    } else if (mode == "eval") {
        Evals(shard, evals / shards);
    } else if (mode == "data") {
        DumpData();
    } else {
        std::fprintf(stderr, "unknown mode %s\n", mode.c_str());
        std::fclose(g_out);
        return 2;
    }
    std::fclose(g_out);
    return 0;
}
