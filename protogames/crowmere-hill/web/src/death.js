// Death policy: what the game offers after Gus meets a comic end.
//
// Sierra-era games killed you instantly and made you restore -- if you had saved.
// Crowmere Hill keeps the sudden deaths but always offers to undo the fatal step, so
// dying is a joke to laugh at rather than an hour to replay. Restoring an F5 save and
// starting over stay on the menu as well.
//
//   history  snapshots (JSON strings) taken just BEFORE every typed command and at
//            every room change, oldest first. Each entry is { snap, reason, room,
//            turn } where reason is 'command' or 'room'.
//   hasSave  whether an F5 save exists. Undo doesn't depend on it.
//
// Returns { rewindTo: <index into history> } to offer "U - undo" (the game resumes
// from that snapshot), or { rewindTo: null } for the classic restore/restart only.
// Godot's twin is death_options() in godot/scripts/main.gd.

export function deathOptions(history, hasSave) {
  // The newest snapshot is the moment just before the fatal action: before the typed
  // command, or at the last room change if Gus walked into trouble. Skip any snapshot
  // that is already dead -- a room that killed on entry would be recorded after the
  // fact, and undoing into a corpse would help no one.
  for (let i = history.length - 1; i >= 0; i--) {
    if (!JSON.parse(history[i].snap).dead) return { rewindTo: i };
  }
  return { rewindTo: null };
}
