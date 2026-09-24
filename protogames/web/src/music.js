// Which background track should be playing right now. Pure, so both engines can
// share one rule and one set of test cases (Godot's twin is music_for() in
// godot/scripts/main.gd; tests/music.test.mjs and godot/tests/music_policy.gd).
//
//   mode   'title' | 'play' | 'ending'
//   state  the game state (room, dead) -- ignored outside play
//   index  content/music/music.json: { tracks, title, ending, rooms: { room: id } }
//
// Returns a track id, or null for silence: while Gus lies dead, so the death
// jingle lands on its own, and anywhere the index doesn't name a track.

export function musicFor(mode, state, index) {
  if (!index) return null;
  if (mode === 'title') return index.title || null;
  if (mode === 'ending') return index.ending || null;
  if (mode !== 'play' || !state || state.dead) return null;
  const id = index.rooms ? index.rooms[state.room] : null;
  return id || null;
}
