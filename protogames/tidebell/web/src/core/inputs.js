// One step of recorded input as a small integer (routes, replays, the parity check).
// The same as godot/scripts/core/inputs.gd.
export function pack(i) {
  return ((i.dx | 0) + 1) | (((i.dy | 0) + 1) << 2) | ((i.jump ? 1 : 0) << 4) | ((i.attack ? 1 : 0) << 5) |
    ((i.item ? 1 : 0) << 6) | ((i.special ? 1 : 0) << 7);
}

export function unpack(c) {
  return { dx: (c & 3) - 1, dy: ((c >> 2) & 3) - 1, jump: (c & 16) !== 0, attack: (c & 32) !== 0,
    item: (c & 64) !== 0, special: (c & 128) !== 0 };
}
