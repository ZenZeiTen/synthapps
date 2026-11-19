// Port of hyper-bluff/godot/scripts/core/ai.gd. The floating-point expressions keep the
// GDScript operand order (doubles, no fused multiply-add) so decisions match bit for bit.
#include "HBAi.h"

#include "HBCards.h"

namespace hb {
namespace ai {

namespace {
inline int MaxI(int a, int b) { return a > b ? a : b; }
inline int ClampI(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }

int Size(const State& s, int who, double frac) {
    const int cur = MaxI(s.bet[0], s.bet[1]);
    int x = cur + static_cast<int>(frac * static_cast<double>(game::Pot(s) + game::ToCall(s, who)));
    x -= x % 5;  // non-negative
    return ClampI(x, game::MinRaiseTo(s, who), game::MaxRaiseTo(s, who));
}

Decision Do(Action a, int amt) {
    Decision d;
    d.a = a;
    d.amt = amt;
    return d;
}
}  // namespace

Profile DefaultProfile() { return Profile{0.5, 0.5, 0.15}; }

const Profile& ProfileOf(const State& s, int who) {
    static const Profile kDefault = DefaultProfile();
    if (who == 1) return data::Rival(s.rival).profile;
    return s.has_bot ? s.bot : kDefault;
}

Decision Think(State& s, int who) {
    const int o = 1 - who;
    const Profile p = ProfileOf(s, who);
    const double loose = p.loose;
    const double aggr = p.aggr;
    const double bluff = p.bluff;
    const double eq = cards::Equity(s.hole[who], game::KnownBoard(s, who), game::KnownOpp(s, who),
                                    std::vector<int>(), kSamples, s.rng_ai);
    const int need_chips = game::ToCall(s, who);
    const int pot_size = game::Pot(s);
    const int stack = s.stack[who];
    const int street = s.street;
    const double r = static_cast<double>(cards::Roll(s.rng_ai, 1000)) / 1000.0;
    const bool may_raise = game::CanRaise(s, who);

    if (s.fx.pstreet[who] != street) {
        const std::vector<Power>& inv = s.powers[who];
        for (size_t i = 0; i < inv.size(); ++i) {
            const Power id = inv[i];
            if (!game::CanUse(s, who, id)) continue;
            bool want = false;
            switch (id) {
                case Power::Swap: want = street == 0 && eq < 0.45; break;
                case Power::Hawk:
                    want = need_chips > 0 && need_chips * 10 >= pot_size * 3 && eq > 0.35 && eq < 0.7;
                    break;
                case Power::Sight: want = street >= 1 && street <= 2 && eq > 0.4 && eq < 0.7; break;
                case Power::Guard: want = need_chips > 0 && need_chips * 2 >= stack && eq > 0.4; break;
                case Power::Glare: want = street >= 1 && need_chips == 0 && eq < 0.45 && r < 0.5; break;
                // Director's Cut: reshoot a bad flop or turn.
                case Power::Retake: want = (street == 1 || street == 2) && eq < 0.35; break;
                default: break;
            }
            if (want) {
                Decision d;
                d.use_power = true;
                d.slot = static_cast<int>(i);
                return d;
            }
        }
    }

    const bool scared = s.fx.glare[o] == street;
    if (need_chips == 0) {
        double bet_p = aggr * 0.25;
        if (eq > 0.62) {
            bet_p = 0.35 + aggr * 0.6;
        } else if (eq < 0.42) {
            bet_p = bluff;
        }
        if (s.fx.glare[who] == street) bet_p = 1.0;
        if (may_raise && !scared && r < bet_p) {
            if (eq > 0.9 && r < aggr * 0.3) return Do(Action::Raise, game::MaxRaiseTo(s, who));
            return Do(Action::Raise, Size(s, who, eq > 0.8 ? 1.0 : 0.5));
        }
        return Do(Action::Call, 0);
    }

    const double odds = static_cast<double>(need_chips) / static_cast<double>(pot_size + need_chips);
    double need = odds + 0.12 - loose * 0.2;
    if (need_chips * 2 >= stack) need += 0.08;
    if (scared) need += 0.25;
    const double strong = street > 0 ? 0.72 : 0.6 - aggr * 0.12;
    if (eq >= strong && may_raise && !scared && r < 0.25 + aggr * 0.6) {
        if (eq > 0.88 || stack < pot_size) return Do(Action::Raise, game::MaxRaiseTo(s, who));
        return Do(Action::Raise, Size(s, who, 1.0));
    }
    if (eq >= need) return Do(Action::Call, 0);
    if (may_raise && !scared && r < bluff * 0.5 && need_chips * 5 <= pot_size * 2) {
        return Do(Action::Raise, Size(s, who, 1.0));
    }
    return Do(Action::Fold, 0);
}

void Play(State& s, int who) {
    for (int i = 0; i < 8; ++i) {
        const Decision d = Think(s, who);
        if (d.use_power) {
            game::UsePower(s, who, d.slot);
        } else {
            game::Act(s, who, d.a, d.amt);
            return;
        }
    }
}

}  // namespace ai
}  // namespace hb
