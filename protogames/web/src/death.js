// Death policy: what the game offers after Gus meets a comic end.
//
// Sierra-era games killed you instantly and made you restore -- if you had saved.
// Modern players expect something gentler. This single function decides where
// Crowmere Hill sits between the two, and the dialog is built from its answer.
//
//   history  snapshots (JSON strings) taken just BEFORE every typed command and at
//            every room change, oldest first. history[history.length - 1] is the
//            moment right before the fatal action. Each entry is { snap, reason,
//            room, turn } where reason is 'command' or 'room'.
//   hasSave  whether an F5 save exists.
//
// Return { rewindTo: <index into history> } to offer "U - undo" (the game resumes
// from that snapshot), or { rewindTo: null } for the classic restore/restart only.

export function deathOptions(history, hasSave) {
  // TODO(you): choose how forgiving Crowmere Hill is.
  return { rewindTo: null };
}
