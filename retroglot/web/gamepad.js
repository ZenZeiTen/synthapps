// Menu navigation with a game controller (standard mapping: A B X Y, shoulders, d-pad,
// left stick). Calls onButton(name) with repeat while a direction is held.
const NAMES = { 0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb', 8: 'select', 9: 'start', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
const REPEATS = new Set(['up', 'down', 'left', 'right']);

export function watchGamepads(onButton, { isActive = () => true } = {}) {
  const held = new Map(); // name -> next repeat time
  let raf = 0;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (!isActive() || document.visibilityState !== 'visible') { held.clear(); return; }
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const down = new Set();
    for (const p of pads) {
      p.buttons.forEach((b, i) => { if (NAMES[i] && (b.pressed || b.value > 0.5)) down.add(NAMES[i]); });
      const [x = 0, y = 0] = p.axes;
      if (x < -0.6) down.add('left'); if (x > 0.6) down.add('right');
      if (y < -0.6) down.add('up'); if (y > 0.6) down.add('down');
    }
    for (const name of down) {
      if (!held.has(name)) { held.set(name, now + 380); onButton(name); }
      else if (REPEATS.has(name) && now >= held.get(name)) { held.set(name, now + 110); onButton(name); }
    }
    for (const name of [...held.keys()]) if (!down.has(name)) held.delete(name);
  };
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}
