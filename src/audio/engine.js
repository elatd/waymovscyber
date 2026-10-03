/**
 * engine.js - continuous electric-car sound, driven every frame by
 * AudioManager.updateCar(state).
 *
 * Layers (all loops start once and are steered with setTargetAtTime only):
 *   motor whine (4 partials sharing one frequency "driver") + inverter whine,
 *   regen whine (braking), road roll, off-road rumble / gravel / grass swish,
 *   wind, tire screech, boost turbine, ludicrous sub + whine.
 * Per-frame work is a handful of arithmetic ops plus setTargetAtTime calls,
 * gated by a small epsilon so the automation timeline stays short.
 */
import { clamp, smoothstep, num, makeWave } from './dsp.js';

/** Output levels of each layer (pre sfx-volume). */
const LV = {
  motor: 0.16,
  regen: 0.05,
  roll: 0.22,
  rumble: 0.5,
  crackle: 0.5,
  swish: 0.15,
  wind: 0.3,
  screech: 0.32,
  boost: 0.13,
  ludicrous: 0.2,
};

const SURF = {
  road: { roll: 1, rumble: 0, crackle: 0, swish: 0, screech: 1 },
  grass: { roll: 0.25, rumble: 0.6, crackle: 0.08, swish: 1, screech: 0.15 },
  dirt: { roll: 0.3, rumble: 1, crackle: 1, swish: 0.2, screech: 0.3 },
};

/**
 * Motor character per car. Partials a..d are driven at `ratios` x motor
 * frequency; `waves` are sine-harmonic amplitude lists for PeriodicWaves.
 */
const PROFILES = {
  waymo: {
    // smooth, low, refined
    idle: 105,
    top: 1000,
    curve: 0.85,
    waves: { a: [1, 0.32, 0.1, 0.04], b: [1], c: [1], d: [1, 0.32, 0.1, 0.04] },
    ratios: { a: 1, b: 0.5, c: 2.83, d: 1.0035 },
    gains: { a: 0.5, b: 0.22, c: 0.07, d: 0.3 },
    lpMul: 3.2,
    lpAdd: 500,
    lpQ: 0.6,
    inv: { base: 3100, span: 3800, ratio: 1.5, level: 0.01 },
    wobble: 0,
    level: 1,
  },
  cybercab: {
    // sharper, aggressive, sci-fi: brighter waves, resonant filter, detune shimmer
    idle: 125,
    top: 1250,
    curve: 0.8,
    waves: { a: [1, 0.5, 0.36, 0.26, 0.2, 0.15, 0.1], b: [1, 0, 0.33, 0, 0.2], c: [1], d: [1, 0.5, 0.36, 0.26, 0.2] },
    ratios: { a: 1, b: 0.5, c: 3.41, d: 1.007 },
    gains: { a: 0.4, b: 0.17, c: 0.11, d: 0.28 },
    lpMul: 4.5,
    lpAdd: 900,
    lpQ: 2.4,
    inv: { base: 3600, span: 4400, ratio: 1.333, level: 0.016 },
    wobble: 9,
    level: 1.05,
  },
};

/**
 * Drives several AudioParams at fixed ratios of one value. Uses a
 * ConstantSourceNode (one automation call per frame for all partials) and
 * falls back to automating each param when ConstantSource is unavailable.
 */
class Driver {
  constructor(car, value) {
    this.car = car;
    this.value = value;
    this.list = [];
    const ctx = car.ctx;
    this.src = typeof ctx.createConstantSource === 'function' ? ctx.createConstantSource() : null;
    if (this.src) {
      this.src.offset.value = value;
      this.src.start();
      car.nodes.push(this.src);
      car.srcs.push(this.src);
    }
  }
  attach(param, ratio) {
    const h = { param, ratio, g: null };
    if (this.src) {
      param.value = 0;
      h.g = this.car._g(ratio);
      this.src.connect(h.g);
      h.g.connect(param);
    } else {
      param.value = this.value * ratio;
    }
    this.list.push(h);
    return h;
  }
  setRatio(h, ratio) {
    h.ratio = ratio;
    if (h.g) h.g.gain.value = ratio;
    else h.param.setTargetAtTime(this.value * ratio, this.car.ctx.currentTime, 0.02);
  }
  set(v, t, tau) {
    this.value = v;
    if (this.src) this.src.offset.setTargetAtTime(v, t, tau);
    else for (let i = 0; i < this.list.length; i++) this.list[i].param.setTargetAtTime(v * this.list[i].ratio, t, tau);
  }
}

export class CarSound {
  constructor(lib, dest) {
    this.lib = lib;
    this.ctx = lib.ctx;
    this.dest = dest;
    this.nodes = [];
    this.srcs = [];
    this.last = Object.create(null);
    this.P = PROFILES.waymo;
    this.type = null;
    this.active = false;
    this.connected = false;
    this._discTimer = 0;

    // output: mix -> out (start/stop fade) -> pauseG -> dest (connected lazily)
    this.out = this._g(0);
    this.pauseG = this._g(1);
    this.out.connect(this.pauseG);
    const mix = this._g(1);
    mix.connect(this.out);

    // shared noise / modulation sources
    const white = this._noise('white');
    const pink = this._noise('pink');
    const brown = this._noise('brown');
    const chatter = this._noise('chatter');
    this.crackleSrc = this._noise('crackle');
    this.wobbleSrc = this._noise('wobble');

    // 1) motor whine
    this.motorDrv = new Driver(this, this.P.idle);
    const motorSum = this._g(1);
    this.motorLP = this._f('lowpass', 1200, 0.6);
    this.motorGain = this._g(0);
    this._chain(motorSum, this.motorLP, this.motorGain, mix);
    this.parts = ['a', 'b', 'c', 'd'].map((key) => {
      const osc = this._osc('sine', 0);
      const g = this._g(0);
      this._chain(osc, g, motorSum);
      return { key, osc, g, h: this.motorDrv.attach(osc.frequency, 1) };
    });
    const wob = this._osc('sine', 6.5);
    this.wobbleDepth = this._g(0);
    this._chain(wob, this.wobbleDepth, this.parts[3].osc.detune);

    // 2) inverter whine (high, quiet)
    this.inv1 = this._osc('sine', 3000);
    this.inv2 = this._osc('sine', 4500);
    this.invGain = this._g(0);
    const inv2g = this._g(0.5);
    this.inv1.connect(this.invGain);
    this._chain(this.inv2, inv2g, this.invGain);
    this.invGain.connect(mix);

    // 3) regen whine while braking (follows the motor driver, descends with speed)
    const regen = this._osc('triangle', 0);
    this.motorDrv.attach(regen.frequency, 1.5);
    this.regenGain = this._g(0);
    this._chain(regen, this.regenGain, mix);

    // 4) road roll
    this.rollLP = this._f('lowpass', 400, 0.7);
    this.rollGain = this._g(0);
    this._chain(pink, this.rollLP, this._f('peaking', 900, 0.9, 4), this.rollGain, mix);

    // 5) off-road: rumble (bumpy AM), gravel crackle, grass swish
    const bumps = this._g(0.6);
    this.wobbleSrc.connect(bumps);
    const rumbleAM = this._g(1);
    bumps.connect(rumbleAM.gain);
    this.rumbleLP = this._f('lowpass', 200, 0.8);
    this.rumbleGain = this._g(0);
    this._chain(brown, this.rumbleLP, rumbleAM, this.rumbleGain, mix);
    this.crackleGain = this._g(0);
    this._chain(this.crackleSrc, this._f('bandpass', 2400, 0.8), this.crackleGain, mix);
    const swAM = this._g(1);
    const swDepth = this._g(0.5);
    this.wobbleSrc.connect(swDepth);
    swDepth.connect(swAM.gain);
    this.swishGain = this._g(0);
    this._chain(white, this._f('bandpass', 1600, 0.7), swAM, this.swishGain, mix);

    // 6) wind with two slow gust LFOs
    this.windBP = this._f('bandpass', 600, 0.6);
    const windAM = this._g(1);
    for (const [f, d] of [[0.23, 0.18], [0.37, 0.12]]) this._chain(this._osc('sine', f), this._g(d), windAM.gain);
    this.windGain = this._g(0);
    this._chain(pink, this.windBP, windAM, this.windGain, mix);

    // 7) tire screech: tonal pair + resonant noise, jittered by a fast random signal
    this.screechDrv = new Driver(this, 900);
    const s1 = this._osc('sawtooth', 0);
    const s2 = this._osc('square', 0);
    this.screechDrv.attach(s1.frequency, 1);
    this.screechDrv.attach(s2.frequency, 1.49);
    const jitter = this._g(55);
    chatter.connect(jitter);
    jitter.connect(s1.frequency);
    jitter.connect(s2.frequency);
    const sMix = this._g(1);
    const s2g = this._g(0.5);
    s1.connect(sMix);
    this._chain(s2, s2g, sMix);
    const sTone = this._g(0.5);
    this._chain(sMix, this._f('bandpass', 1700, 4), sTone);
    this._chain(sMix, this._f('bandpass', 2600, 6), sTone);
    const sNoiseBP = this._f('bandpass', 1900, 9);
    const nJit = this._g(220);
    chatter.connect(nJit);
    nJit.connect(sNoiseBP.frequency);
    const sNoise = this._g(4);
    this._chain(white, sNoiseBP, sNoise);
    const sAM = this._g(0.75);
    const amD = this._g(0.35);
    chatter.connect(amD);
    amD.connect(sAM.gain);
    sTone.connect(sAM);
    sNoise.connect(sAM);
    this.screechGain = this._g(0);
    this._chain(sAM, this.screechGain, mix);

    // 8) boost: rising turbine/electric whine + jet hiss, with a fast tremolo
    this.boostA = this._osc('sawtooth', 350);
    this.boostB = this._osc('sine', 700);
    this.boostBP = this._f('bandpass', 600, 3);
    const bAM = this._g(0.7);
    this._chain(this._osc('square', 28), this._g(0.3), bAM.gain);
    this.boostA.connect(this.boostBP);
    this._chain(this.boostB, this._g(0.5), this.boostBP);
    this.boostBP.connect(bAM);
    this._chain(white, this._f('highpass', 2500, 0.7), this._f('bandpass', 4500, 1), this._g(0.6), bAM);
    this.boostGain = this._g(0);
    this._chain(bAM, this.boostGain, mix);

    // 9) ludicrous: sub rumble + twin-saw whine + electrical crackle
    const subG = this._g(0.5);
    this._osc('sine', 42).connect(subG);
    this._osc('sine', 63.3).connect(subG);
    this.ludA = this._osc('sawtooth', 500);
    this.ludB = this._osc('sawtooth', 503);
    this.ludBP = this._f('bandpass', 600, 5);
    this.ludA.connect(this.ludBP);
    this.ludB.connect(this.ludBP);
    this.ludGain = this._g(0);
    subG.connect(this.ludGain);
    this._chain(this.ludBP, this._g(0.6), this.ludGain);
    this._chain(this.crackleSrc, this._f('bandpass', 5200, 1), this._g(0.9), this.ludGain);
    this.ludGain.connect(mix);

    this._applyProfile('waymo');
  }

  /** Per-frame update. See AudioManager.updateCar for the state shape. */
  update(s) {
    const now = this.ctx.currentTime;
    const speed = Math.max(0, num(s.speed, 0));
    const maxS = num(s.maxSpeed, 45) > 1 ? num(s.maxSpeed, 45) : 45;
    const thr = clamp(num(s.throttle, 0));
    const brk = clamp(num(s.brake, 0));
    const drift = clamp(num(s.drift, 0));
    const grounded = s.grounded !== false;
    const boost = !!s.boost;
    const lud = !!s.ludicrous;

    if (!this.active) {
      // after stopCar(), only real driving input brings the loops back
      if (thr > 0.02 || speed > 0.3 || drift > 0.15 || boost || lud) this._activate(now);
      else return;
    }
    const type = s.carType === 'cybercab' ? 'cybercab' : 'waymo';
    if (type !== this.type) this._applyProfile(type);
    const W = SURF[s.surface] || SURF.road;
    const P = this.P;
    const n = clamp(speed / maxS, 0, 1.6);
    const nc = Math.min(n, 1.4);
    const g = grounded ? 1 : 0;

    // --- motor pitch & level
    let f = P.idle + (P.top - P.idle) * Math.pow(n, P.curve);
    if (!grounded) f *= 1.1 + 0.08 * thr; // wheels free-spinning
    f *= 1 - 0.05 * brk * Math.min(1, n * 2); // regen dip
    if (boost) f *= 1.04;
    if (lud) f *= 1.07;
    this._drv(this.motorDrv, 'mf', f, now, grounded ? 0.07 : 0.3);
    const presence = 0.05 + 0.95 * smoothstep(0, 0.22, n);
    let lvl = presence * (0.3 + 0.7 * thr) * (boost ? 1.25 : 1) * LV.motor * P.level;
    if (!grounded) lvl *= 0.9 + 0.3 * thr;
    this._set('ml', this.motorGain.gain, lvl, now, 0.05);
    this._set('mlp', this.motorLP.frequency, Math.min(16000, f * P.lpMul + P.lpAdd + 1500 * thr), now, 0.06);

    // --- inverter whine
    const invF = P.inv.base + P.inv.span * Math.min(n, 1.3);
    this._set('if1', this.inv1.frequency, invF, now, 0.08);
    this._set('if2', this.inv2.frequency, invF * P.inv.ratio, now, 0.08);
    this._set('il', this.invGain.gain, P.inv.level * smoothstep(0, 0.08, n) * (0.35 + 0.65 * thr), now, 0.06);

    // --- regen whine
    const regen = brk > 0.3 && grounded ? (LV.regen * (brk - 0.3)) / 0.7 * smoothstep(0.1, 0.5, n) : 0;
    this._set('rg', this.regenGain.gain, regen, now, 0.08);

    // --- tires on the surface
    const roll = n > 0.01 ? g * W.roll * (0.04 + 0.96 * Math.pow(nc, 1.3)) * LV.roll : 0;
    this._set('rl', this.rollGain.gain, roll, now, 0.07);
    this._set('rf', this.rollLP.frequency, 220 + 1700 * nc, now, 0.1);
    const off = g * smoothstep(0, 0.12, n);
    this._set('ru', this.rumbleGain.gain, off * W.rumble * (0.3 + 0.7 * Math.min(n, 1)) * LV.rumble, now, 0.08);
    this._set('rlp', this.rumbleLP.frequency, 120 + 380 * Math.min(n, 1), now, 0.15);
    this._set('rr', this.wobbleSrc.playbackRate, 0.6 + 2.4 * nc, now, 0.2);
    const gravel = W.crackle * (Math.pow(Math.min(n, 1.2), 0.7) + 0.6 * drift);
    this._set('cr', this.crackleGain.gain, off * gravel * LV.crackle, now, 0.08);
    this._set('cp', this.crackleSrc.playbackRate, 0.6 + 0.9 * nc, now, 0.2);
    this._set('sw', this.swishGain.gain, off * W.swish * Math.min(n, 1.2) * LV.swish, now, 0.08);

    // --- wind
    this._set('wl', this.windGain.gain, smoothstep(0.25, 1.3, n) * (grounded ? 1 : 1.3) * LV.wind, now, 0.15);
    this._set('wf', this.windBP.frequency, 450 + 900 * Math.min(n, 1.5), now, 0.2);

    // --- tire screech
    const d = smoothstep(0.15, 0.75, drift) * g * smoothstep(1.5, 7, speed) * W.screech;
    const prev = this.last.sl === undefined ? 0 : this.last.sl;
    this._set('sl', this.screechGain.gain, d * LV.screech, now, d * LV.screech > prev ? 0.03 : 0.07);
    this._drv(this.screechDrv, 'sf', 820 + 520 * d + 150 * Math.min(n, 1), now, 0.05);

    // --- boost: a slow time-constant makes the whine rise when it kicks in
    const bf = boost ? 900 + 1300 * Math.min(n, 1.5) : 350;
    const btau = boost ? 0.6 : 0.4;
    this._set('bf', this.boostA.frequency, bf, now, btau);
    this._set('bf2', this.boostB.frequency, bf * 2.01, now, btau);
    this._set('bbp', this.boostBP.frequency, bf * 1.6, now, btau);
    this._set('bl', this.boostGain.gain, boost ? LV.boost : 0, now, boost ? 0.08 : 0.3);

    // --- ludicrous
    const lf = lud ? 1800 + 2400 * Math.min(n, 1.5) : 500;
    const ltau = lud ? 0.9 : 0.4;
    this._set('lfa', this.ludA.frequency, lf, now, ltau);
    this._set('lfb', this.ludB.frequency, lf * 1.006, now, ltau);
    this._set('lbp', this.ludBP.frequency, lf * 1.1, now, ltau);
    this._set('ll', this.ludGain.gain, lud ? LV.ludicrous : 0, now, lud ? 0.1 : 0.35);
  }

  /** Fade out all loops (menus, game over). The graph is detached after the fade. */
  stop() {
    if (!this.active) return;
    this.active = false;
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.12);
    clearTimeout(this._discTimer);
    this._discTimer = setTimeout(() => {
      if (!this.active) this._detach();
    }, 1000);
  }

  setPaused(p) {
    this.pauseG.gain.setTargetAtTime(p ? 0 : 1, this.ctx.currentTime, 0.04);
  }

  dispose() {
    clearTimeout(this._discTimer);
    for (const s of this.srcs) {
      try { s.stop(); } catch (e) { /* ignore */ }
    }
    for (const nd of this.nodes) {
      try { nd.disconnect(); } catch (e) { /* ignore */ }
    }
    this.nodes.length = 0;
    this.srcs.length = 0;
    this.connected = false;
  }

  // ---- internals ----------------------------------------------------------
  _activate(now) {
    this.active = true;
    clearTimeout(this._discTimer);
    if (!this.connected) {
      this.pauseG.connect(this.dest);
      this.connected = true;
    }
    this.out.gain.setTargetAtTime(1, now, 0.05);
  }

  _detach() {
    if (!this.connected) return;
    try { this.pauseG.disconnect(); } catch (e) { /* ignore */ }
    this.connected = false; // un-pulled graph costs (almost) no CPU
  }

  _applyProfile(type) {
    const P = (this.P = PROFILES[type] || PROFILES.waymo);
    this.type = type;
    for (const p of this.parts) {
      p.osc.setPeriodicWave(makeWave(this.ctx, P.waves[p.key]));
      this.motorDrv.setRatio(p.h, P.ratios[p.key]);
      p.g.gain.value = P.gains[p.key];
    }
    this.motorLP.Q.value = P.lpQ;
    this.wobbleDepth.gain.value = P.wobble;
    for (const k in this.last) delete this.last[k]; // force all targets to be re-sent
  }

  /** setTargetAtTime only when the target moved by more than ~0.4%. */
  _set(key, param, v, now, tau) {
    const last = this.last[key];
    if (last !== undefined && Math.abs(v - last) <= Math.max(1e-4, Math.abs(last) * 0.004)) return;
    this.last[key] = v;
    param.setTargetAtTime(v, now, tau);
  }

  _drv(driver, key, v, now, tau) {
    const last = this.last[key];
    if (last !== undefined && Math.abs(v - last) <= Math.abs(last) * 0.003) return;
    this.last[key] = v;
    driver.set(v, now, tau);
  }

  _g(v) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    this.nodes.push(g);
    return g;
  }

  _f(type, f, q = 0.707, gain = 0) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    if (gain) b.gain.value = gain;
    this.nodes.push(b);
    return b;
  }

  _osc(type, f) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.start();
    this.nodes.push(o);
    this.srcs.push(o);
    return o;
  }

  _noise(kind) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.lib.noise[kind];
    s.loop = true;
    s.start(0, Math.random() * s.buffer.duration * 0.9);
    this.nodes.push(s);
    this.srcs.push(s);
    return s;
  }

  _chain(...nodes) {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1];
  }
}
