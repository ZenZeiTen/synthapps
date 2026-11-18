// The death policy (web/src/death.js): dying always offers to undo the fatal step.
// godot/tests/death_policy.gd checks the GDScript twin against the same cases.
//   node --test tests/death.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { deathOptions } from '../web/src/death.js';

const snap = (turn, extra = {}) => ({ snap: JSON.stringify({ room: 'hall', turns: turn, dead: false, ...extra }), reason: 'command', room: 'hall', turn });

test('undo rewinds to the moment just before the fatal step', () => {
  const history = [snap(1), snap(2), snap(3)];
  assert.deepEqual(deathOptions(history, false), { rewindTo: 2 });
});

test('undo is offered whether or not there is a save', () => {
  const history = [snap(1), snap(2)];
  assert.deepEqual(deathOptions(history, true), deathOptions(history, false));
});

test('a snapshot that is already dead is skipped', () => {
  const history = [snap(1), snap(2), snap(3, { dead: true })];
  assert.deepEqual(deathOptions(history, false), { rewindTo: 1 });
});

test('with nothing to rewind to, only restore and restart remain', () => {
  assert.deepEqual(deathOptions([], true), { rewindTo: null });
  assert.deepEqual(deathOptions([snap(1, { dead: true })], false), { rewindTo: null });
});
