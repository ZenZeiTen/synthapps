// Port of hyper-bluff/godot/scripts/core/cards.gd. Every loop and RNG call keeps the
// GDScript order, because the parity check compares the RNG state after every step.
#include "HBCards.h"

#include <array>
#include <cstring>

namespace hb {

int64_t WrapI64(uint64_t x) {
    if (x <= static_cast<uint64_t>(INT64_MAX)) return static_cast<int64_t>(x);
    // x - 2^64, written so that no intermediate overflows.
    return -static_cast<int64_t>(~x) - 1;
}

int64_t WrapMulAdd(int64_t a, uint64_t mul, uint64_t add) {
    // int64 -> uint64 is well defined (modulo 2^64).
    return WrapI64(static_cast<uint64_t>(a) * mul + add);
}

namespace cards {

const char* const kRankCh = "23456789TJQKA";
const char* const kSuitCh = "shdc";
const char* const kRankName[13] = {"Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
                                   "Nine", "Ten", "Jack", "Queen", "King", "Ace"};
const char* const kRankPlural[13] = {"Twos", "Threes", "Fours", "Fives", "Sixes", "Sevens",
                                     "Eights", "Nines", "Tens", "Jacks", "Queens", "Kings",
                                     "Aces"};
const char* const kCatName[9] = {"High Card", "Pair", "Two Pair", "Three of a Kind", "Straight",
                                 "Flush", "Full House", "Four of a Kind", "Straight Flush"};

int Rank(int c) { return c % 13; }
int Suit(int c) { return c / 13; }

namespace {
int IndexOf(const char* s, char ch) {
    const char* p = std::strchr(s, ch);
    return (p && ch != '\0') ? static_cast<int>(p - s) : -1;
}

int StraightTop(int mask) {
    for (int top = 12; top > 3; --top) {
        if (((mask >> (top - 4)) & 0x1F) == 0x1F) return top;
    }
    if ((mask & 0x100F) == 0x100F) return 3;
    return -1;
}

inline int MaxI(int a, int b) { return a > b ? a : b; }
}  // namespace

int Card(const std::string& text) {
    if (text.size() < 2) return -1;
    return IndexOf(kSuitCh, text[1]) * 13 + IndexOf(kRankCh, text[0]);
}

std::vector<int> Parse(const std::string& text) {
    std::vector<int> out;
    size_t i = 0;
    while (i < text.size()) {
        while (i < text.size() && text[i] == ' ') ++i;
        size_t j = i;
        while (j < text.size() && text[j] != ' ') ++j;
        if (j > i) out.push_back(Card(text.substr(i, j - i)));
        i = j;
    }
    return out;
}

std::string Label(int c) {
    std::string s;
    s += kRankCh[c % 13];
    s += kSuitCh[c / 13];
    return s;
}

int Roll(int64_t& box, int n) {
    const uint64_t x = static_cast<uint64_t>(box) * 6364136223846793005ULL + 1442695040888963407ULL;
    box = WrapI64(x);
    // GDScript's >> is arithmetic, but the mask keeps only bits 33..63, so a logical
    // shift of the unsigned value gives the same 31 bits.
    return static_cast<int>(((x >> 33) & 0x7FFFFFFFULL) % static_cast<uint64_t>(n));
}

int Eval(const int* cs, int n) {
    int rc[13] = {0};
    int sc[4] = {0};
    int sm[4] = {0};
    int rmask = 0;
    for (int i = 0; i < n; ++i) {
        const int r = cs[i] % 13;
        const int s = cs[i] / 13;
        rc[r] += 1;
        sc[s] += 1;
        sm[s] |= 1 << r;
        rmask |= 1 << r;
    }
    int fs = -1;
    for (int s = 0; s < 4; ++s) {
        if (sc[s] >= 5) fs = s;
    }
    if (fs >= 0) {
        const int sf = StraightTop(sm[fs]);
        if (sf >= 0) return (8 << 20) | (sf << 16);
    }
    int quad = -1;
    int trips[13], pairs[13], singles[13];
    int nt = 0, np = 0, ns = 0;
    for (int r = 12; r >= 0; --r) {
        switch (rc[r]) {
            case 4: quad = r; break;
            case 3: trips[nt++] = r; break;
            case 2: pairs[np++] = r; break;
            case 1: singles[ns++] = r; break;
            default: break;
        }
    }
    if (quad >= 0) {
        int k = -1;
        for (int r = 12; r >= 0; --r) {
            if (r != quad && rc[r] > 0) {
                k = r;
                break;
            }
        }
        return (7 << 20) | (quad << 16) | (MaxI(k, 0) << 12);
    }
    if (nt >= 2 || (nt == 1 && np >= 1)) {
        int p = -1;
        if (nt >= 2) p = trips[1];
        if (np >= 1) p = MaxI(p, pairs[0]);
        return (6 << 20) | (trips[0] << 16) | (p << 12);
    }
    if (fs >= 0) {
        int v = 5 << 20;
        int sh = 16;
        for (int r = 12; r >= 0; --r) {
            if (sm[fs] & (1 << r)) {
                v |= r << sh;
                sh -= 4;
                if (sh < 0) break;
            }
        }
        return v;
    }
    const int st = StraightTop(rmask);
    if (st >= 0) return (4 << 20) | (st << 16);
    if (nt == 1) {
        int v3 = (3 << 20) | (trips[0] << 16);
        int sh3 = 12;
        for (int i = 0; i < ns; ++i) {
            v3 |= singles[i] << sh3;
            sh3 -= 4;
            if (sh3 < 4) break;
        }
        return v3;
    }
    if (np >= 2) {
        int k2 = -1;
        if (np >= 3) k2 = pairs[2];
        if (ns > 0) k2 = MaxI(k2, singles[0]);
        return (2 << 20) | (pairs[0] << 16) | (pairs[1] << 12) | (MaxI(k2, 0) << 8);
    }
    if (np == 1) {
        int v1 = (1 << 20) | (pairs[0] << 16);
        int sh1 = 12;
        for (int i = 0; i < ns; ++i) {
            v1 |= singles[i] << sh1;
            sh1 -= 4;
            if (sh1 < 4) break;
        }
        return v1;
    }
    int v0 = 0;
    int sh0 = 16;
    for (int i = 0; i < ns; ++i) {
        v0 |= singles[i] << sh0;
        sh0 -= 4;
        if (sh0 < 0) break;
    }
    return v0;
}

int Eval(const std::vector<int>& cs) { return Eval(cs.data(), static_cast<int>(cs.size())); }

int Category(int v) { return v >> 20; }

bool IsRoyal(int v) { return (v >> 20) == 8 && ((v >> 16) & 15) == 12; }

std::string NameOf(int v) {
    const int cat = v >> 20;
    const int a = (v >> 16) & 15;
    switch (cat) {
        case 8: return a == 12 ? "Royal Flush" : "Straight Flush";
        case 7: return std::string("Four ") + kRankPlural[a];
        case 6: return std::string("Full House, ") + kRankPlural[a];
        case 5: return std::string("Flush, ") + kRankName[a] + " high";
        case 4: return std::string("Straight to ") + kRankName[a];
        case 3: return std::string("Three ") + kRankPlural[a];
        case 2: return std::string("Two Pair, ") + kRankPlural[a];
        case 1: return std::string("Pair of ") + kRankPlural[a];
        default: break;
    }
    return std::string(kRankName[a]) + " high";
}

EquityScore EquityBatch(const std::vector<int>& hole, const std::vector<int>& board,
                        const std::vector<int>& opp_known, const std::vector<int>& dead,
                        int samples, int64_t& box) {
    bool used[52] = {false};
    for (int c : hole) used[c] = true;
    for (int c : board) used[c] = true;
    for (int c : opp_known) used[c] = true;
    for (int c : dead) used[c] = true;
    int rest[52];
    int n = 0;
    for (int c = 0; c < 52; ++c) {
        if (!used[c]) rest[n++] = c;
    }
    const int need_opp = 2 - static_cast<int>(opp_known.size());
    const int need_board = 5 - static_cast<int>(board.size());
    const int need = need_opp + need_board;
    int64_t score = 0;
    // mine = hole + board (+ need_board), theirs = opp_known + board (+ need_opp + need_board)
    int mine[16];
    int theirs[16];
    int base_m = 0;
    for (int c : hole) mine[base_m++] = c;
    for (int c : board) mine[base_m++] = c;
    int base_t = 0;
    for (int c : opp_known) theirs[base_t++] = c;
    for (int c : board) theirs[base_t++] = c;
    for (int i = 0; i < samples; ++i) {
        for (int j = 0; j < need; ++j) {
            const int k = j + Roll(box, n - j);
            const int t = rest[j];
            rest[j] = rest[k];
            rest[k] = t;
        }
        for (int j = 0; j < need_opp; ++j) theirs[base_t + j] = rest[j];
        for (int j = 0; j < need_board; ++j) {
            const int c = rest[need_opp + j];
            mine[base_m + j] = c;
            theirs[base_t + need_opp + j] = c;
        }
        const int a = Eval(mine, base_m + need_board);
        const int b = Eval(theirs, base_t + need_opp + need_board);
        if (a > b) {
            score += 2;
        } else if (a == b) {
            score += 1;
        }
    }
    EquityScore r;
    r.score = score;
    r.samples = samples;
    return r;
}

double Equity(const std::vector<int>& hole, const std::vector<int>& board,
              const std::vector<int>& opp_known, const std::vector<int>& dead, int samples,
              int64_t& box) {
    const EquityScore r = EquityBatch(hole, board, opp_known, dead, samples, box);
    return static_cast<double>(r.score) / static_cast<double>(2 * r.samples);
}

}  // namespace cards
}  // namespace hb
