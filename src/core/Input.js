// Keyboard + gamepad + touch input, merged into one analog state.
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered this frame
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, special: false, horn: false };
    this.touch = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, special: false };
    this.gpPrev = {};
    this.usingGamepad = false;
    this.listeners = [];
    window.addEventListener('keydown', (e) => {
      // typing into a text field (e.g. the YouTube link box) is not driving input
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab'].includes(e.key)) e.preventDefault();
      const k = e.code;
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      this.usingGamepad = false;
      for (const fn of this.listeners) fn(k, e);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  onKey(fn) { this.listeners.push(fn); }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }

  // Consume edge presses (for menus / one-shot actions)
  hit(...codes) {
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }

  update() {
    const s = this.state;
    const k = (...c) => this.down(...c);
    let thr = k('KeyW', 'ArrowUp') ? 1 : 0;
    let brk = k('KeyS', 'ArrowDown') ? 1 : 0;
    let steer = (k('KeyA', 'ArrowLeft') ? 1 : 0) - (k('KeyD', 'ArrowRight') ? 1 : 0);
    let hb = k('Space');
    let boost = k('ShiftLeft', 'ShiftRight');
    let special = this.hit('KeyE', 'KeyQ');
    let horn = this.hit('KeyH');
    // gamepad
    // getGamepads() throws in frames where the gamepad feature is blocked by permissions policy
    let pads = [];
    if (!this.noGamepad) {
      try { pads = (navigator.getGamepads && navigator.getGamepads()) || []; } catch { this.noGamepad = true; pads = []; }
    }
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const ax = gp.axes[0] || 0;
      const dead = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const rt = gp.buttons[7] ? gp.buttons[7].value : 0;
      const lt = gp.buttons[6] ? gp.buttons[6].value : 0;
      const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      const edge = (i) => {
        const now = b(i);
        const was = this.gpPrev[i];
        this.gpPrev[i] = now;
        return now && !was;
      };
      if (Math.abs(ax) > 0.12 || rt > 0.05 || lt > 0.05 || gp.buttons.some((bb) => bb.pressed)) this.usingGamepad = true;
      if (this.usingGamepad) {
        steer = steer || -dead(ax);
        thr = Math.max(thr, rt, b(0) ? 1 : 0);
        brk = Math.max(brk, lt);
        hb = hb || b(2) || b(5);
        boost = boost || b(1) || b(4);
        if (edge(3)) special = true;
        if (edge(10) || edge(11)) horn = true;
        if (edge(9)) this.pressed.add('Escape');
        if (edge(12)) this.pressed.add('ArrowUp');
        if (edge(13)) this.pressed.add('ArrowDown');
        if (edge(14)) this.pressed.add('ArrowLeft');
        if (edge(15)) this.pressed.add('ArrowRight');
        if (edge(0)) this.pressed.add('Enter');
        if (edge(1)) this.pressed.add('Backspace');
        if (Math.abs(ax) > 0.6) {
          const dirKey = ax > 0 ? 'ArrowRight' : 'ArrowLeft';
          if (!this.gpPrev.axis) this.pressed.add(dirKey);
          this.gpPrev.axis = true;
        } else this.gpPrev.axis = false;
      }
      break;
    }
    // touch
    const t = this.touch;
    thr = Math.max(thr, t.throttle);
    brk = Math.max(brk, t.brake);
    if (t.steer) steer = t.steer;
    hb = hb || t.handbrake;
    boost = boost || t.boost;
    if (t.special) { special = true; t.special = false; }
    s.throttle = thr;
    s.brake = brk;
    s.steer = Math.max(-1, Math.min(1, steer));
    s.handbrake = hb;
    s.boost = boost;
    s.special = special;
    s.horn = horn;
    return s;
  }

  endFrame() {
    this.pressed.clear();
  }
}
