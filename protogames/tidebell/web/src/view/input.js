// Keyboard and gamepad input, with the same actions and button layouts as the Godot build
// (godot/scripts/view/controls.gd). Gamepads are read through the browser Gamepad API with
// the "standard" mapping: 0 south (A / Cross), 1 east (B / Circle), 2 west (X / Square),
// 3 north (Y / Triangle), 9 Start, 12-15 the D-pad; the left stick moves.
const KEYS = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
  jump: ['KeyZ', 'KeyK', 'Space'], attack: ['KeyX', 'KeyJ'], item: ['KeyC', 'KeyL'], special: ['KeyV', 'KeyI'],
  pause: ['Enter', 'Escape', 'NumpadEnter'], accept: ['Enter', 'NumpadEnter', 'Space', 'KeyZ'],
  back: ['Escape', 'Backspace', 'KeyC'],
};
// pad buttons per layout: [jump, attack, item]
export const LAYOUTS = [[0, 2, 1], [2, 0, 1], [1, 0, 2]];
export const LAYOUT_NAMES = ['A jump, X attack', 'X jump, A attack', 'B jump, A attack'];
const PAD_FIXED = { left: [14], right: [15], up: [12], down: [13], special: [3], pause: [9], accept: [0], back: [1] };
const DEADZONE = 0.45;
export const ACTIONS = Object.keys(KEYS);

export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.layout = 0;
    this.now = {};
    this.last = {};
    this.lastDevice = 'keyboard';
    this.virtualPad = null;          // the harness's pad (tests); read like a real one
    target.addEventListener('keydown', (e) => {
      if (Object.values(KEYS).some((l) => l.includes(e.code))) e.preventDefault();
      this.keys.add(e.code);
      this.lastDevice = 'keyboard';
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());
  }

  pads() {
    const out = [];
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of list) if (p && p.connected !== false) out.push(p);
    if (this.virtualPad) out.push(this.virtualPad);
    return out;
  }

  padButtons(action) {
    const lay = LAYOUTS[this.layout];
    if (action === 'jump') return [lay[0]];
    if (action === 'attack') return [lay[1]];
    if (action === 'item') return [lay[2]];
    return PAD_FIXED[action] ?? [];
  }

  // Called once per frame: reads the pads and works out which actions were just pressed.
  update() {
    this.last = this.now;
    const now = {};
    const pads = this.pads();
    for (const a of ACTIONS) {
      let on = KEYS[a].some((k) => this.keys.has(k));
      for (const p of pads) {
        for (const b of this.padButtons(a)) {
          const btn = p.buttons[b];
          if (btn && (btn.pressed || btn.value > 0.5)) {
            on = true;
            this.lastDevice = 'pad';
          }
        }
        const ax = p.axes ?? [];
        if ((a === 'left' && ax[0] < -DEADZONE) || (a === 'right' && ax[0] > DEADZONE) ||
            (a === 'up' && ax[1] < -DEADZONE) || (a === 'down' && ax[1] > DEADZONE)) {
          on = true;
          this.lastDevice = 'pad';
        }
      }
      now[a] = on;
    }
    this.now = now;
  }

  held(a) { return !!this.now[a]; }
  just(a) { return !!this.now[a] && !this.last[a]; }
  any() { return ACTIONS.some((a) => this.just(a)); }

  // The held state the core reads each step.
  core() {
    return { dx: (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0),
      dy: (this.held('down') ? 1 : 0) - (this.held('up') ? 1 : 0),
      jump: this.held('jump'), attack: this.held('attack'), item: this.held('item'), special: this.held('special') };
  }

  label(action) {
    if (this.lastDevice === 'pad') {
      const names = ['A', 'B', 'X', 'Y'];
      const lay = LAYOUTS[this.layout];
      return { jump: names[lay[0]], attack: names[lay[1]], item: names[lay[2]], special: 'Y', pause: 'START',
        accept: 'A', back: 'B' }[action] ?? action.toUpperCase();
    }
    return { jump: 'Z', attack: 'X', item: 'C', special: 'V', pause: 'ENTER', accept: 'ENTER',
      back: 'ESC' }[action] ?? action.toUpperCase();
  }
}

// A pad the harness can press, in the Gamepad API's shape.
export function makeVirtualPad() {
  return { id: 'harness pad (standard)', mapping: 'standard', connected: true, index: 3,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
}
