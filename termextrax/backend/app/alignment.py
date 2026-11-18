"""Sentence alignment: sequential 1:1 baseline and Gale-Church.

The Gale-Church implementation follows the classic 1993 paper: dynamic
programming over sentence lengths (in characters) with a Gaussian model of
the length ratio between translated sentences, allowing 1-1, 1-0, 0-1,
2-1, 1-2 and 2-2 beads.
"""
from __future__ import annotations

import math

# Prior probabilities of each bead type, from Gale & Church (1993).
_BEAD_PENALTIES = {
    (1, 1): 0.0,
    (1, 0): 4.5,   # -log(prob) style penalties
    (0, 1): 4.5,
    (2, 1): 2.3,
    (1, 2): 2.3,
    (2, 2): 3.3,
}
# Expected target/source character ratio ~1, variance per source character.
_MEAN_RATIO = 1.0
_VARIANCE = 6.8


def _length_cost(src_len: int, tgt_len: int) -> float:
    """-log probability that segments of these lengths are translations."""
    if src_len == 0 and tgt_len == 0:
        return 0.0
    mean = (src_len + tgt_len / _MEAN_RATIO) / 2.0
    if mean == 0:
        return 0.0
    z = (tgt_len - src_len * _MEAN_RATIO) / math.sqrt(_VARIANCE * mean)
    # -log of two-tailed normal probability, cheap approximation.
    return abs(z) * 1.0 + 0.5 * z * z / 10.0


def align_sequential(source: list[str], target: list[str]) -> list[tuple[str, str]]:
    """Baseline 1:1 pairing; the longer side gets empty counterparts."""
    n = max(len(source), len(target))
    return [
        (source[i] if i < len(source) else "", target[i] if i < len(target) else "")
        for i in range(n)
    ]


def align_gale_church(source: list[str], target: list[str]) -> list[tuple[str, str]]:
    """Length-based alignment producing (source_text, target_text) pairs.

    Multi-sentence beads are joined with a space; 1-0 / 0-1 beads yield an
    empty cell on the missing side, which the UI highlights for review.
    """
    if not source or not target:
        return align_sequential(source, target)

    slen = [len(s) for s in source]
    tlen = [len(t) for t in target]
    n, m = len(source), len(target)

    INF = float("inf")
    cost = [[INF] * (m + 1) for _ in range(n + 1)]
    back: list[list[tuple[int, int] | None]] = [[None] * (m + 1) for _ in range(n + 1)]
    cost[0][0] = 0.0

    for i in range(n + 1):
        for j in range(m + 1):
            if cost[i][j] == INF:
                continue
            base = cost[i][j]
            for (di, dj), penalty in _BEAD_PENALTIES.items():
                ni, nj = i + di, j + dj
                if ni > n or nj > m:
                    continue
                c = base + penalty + _length_cost(sum(slen[i:ni]), sum(tlen[j:nj]))
                if c < cost[ni][nj]:
                    cost[ni][nj] = c
                    back[ni][nj] = (di, dj)

    # Backtrack from (n, m).
    beads: list[tuple[int, int, int, int]] = []
    i, j = n, m
    while i > 0 or j > 0:
        step = back[i][j]
        if step is None:  # unreachable in practice, but stay safe
            return align_sequential(source, target)
        di, dj = step
        beads.append((i - di, i, j - dj, j))
        i, j = i - di, j - dj
    beads.reverse()

    return [
        (" ".join(source[a:b]), " ".join(target[c:d]))
        for a, b, c, d in beads
    ]
