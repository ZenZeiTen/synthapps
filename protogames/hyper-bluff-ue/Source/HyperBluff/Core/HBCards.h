// Hyper Bluff!! rules core: cards, the hand evaluator, the LCG and the win-chance estimate.
// Port of hyper-bluff/godot/scripts/core/cards.gd. Plain C++17, no engine headers.
//
// A card is an int 0..51: rank = c % 13 (0 is the Two, 12 is the Ace), suit = c / 13
// (0 spades, 1 hearts, 2 diamonds, 3 clubs).
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace hb {

// GDScript ints are signed 64-bit and wrap on overflow. These do the arithmetic in
// uint64_t (where wrap-around is defined) and convert back without relying on
// implementation-defined casts.
int64_t WrapI64(uint64_t x);
int64_t WrapMulAdd(int64_t a, uint64_t mul, uint64_t add);

namespace cards {

int Rank(int c);
int Suit(int c);
int Card(const std::string& text);              // "As" -> 12
std::vector<int> Parse(const std::string& text);  // "As Kd" -> {12, 37}
std::string Label(int c);                        // 12 -> "As"

// Step the 64-bit LCG kept in `box` and return a number in 0..n-1 (n > 0).
// x = box * 6364136223846793005 + 1442695040888963407; return ((x >> 33) & 0x7FFFFFFF) % n
int Roll(int64_t& box, int n);

// Best poker hand in 2..7 cards (up to 52 accepted). Bigger is better: category << 20,
// then up to five rank nibbles from the most to the least important card.
int Eval(const int* cs, int n);
int Eval(const std::vector<int>& cs);
int Category(int v);
bool IsRoyal(int v);
// A short name for the meter and the showdown banner, at most 24 characters.
std::string NameOf(int v);

// Monte Carlo win chance of `hole` against one unknown hand. A win counts 2 and a tie 1,
// so chance = score / (2 * samples).
struct EquityScore {
    int64_t score = 0;
    int samples = 0;
};
EquityScore EquityBatch(const std::vector<int>& hole, const std::vector<int>& board,
                        const std::vector<int>& opp_known, const std::vector<int>& dead,
                        int samples, int64_t& box);
double Equity(const std::vector<int>& hole, const std::vector<int>& board,
              const std::vector<int>& opp_known, const std::vector<int>& dead, int samples,
              int64_t& box);

extern const char* const kRankCh;   // "23456789TJQKA"
extern const char* const kSuitCh;   // "shdc"
extern const char* const kRankName[13];
extern const char* const kRankPlural[13];
extern const char* const kCatName[9];

}  // namespace cards
}  // namespace hb
