/**
 * music/instruments.js - synth instruments for the procedural soundtrack.
 * Each instrument owns a few persistent nodes (amp, filters, effects) and
 * creates one short-lived Voice per note; dispose() tears the persistent
 * part down when its track ends.
 */
import { mtof, driveCurve } from '../dsp.js';
import { Voice, envADSR, envPerc } from '../voice.js';

class Inst {
  constructor(lib) {
    this.lib = lib;
    this.ctx = lib.ctx;
    this.nodes = [];
    this.oscs = [];
  }
  n(node) {
    this.nodes.push(node);
    return node;
  }
  g(v = 1) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return this.n(g);
  }
  f(type, freq, q = 0.707, gain = 0) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = freq;
    b.Q.value = q;
    if (gain) b.gain.value = gain;
    return this.n(b);
  }
  sh(drive, asym = 0) {
    const s = this.ctx.createWaveShaper();
    s.curve = driveCurve(drive, asym);
    s.oversample = '2x';
    return this.n(s);
  }
  pan(p) {
    if (!this.ctx.createStereoPanner) return this.g(1);
    const s = this.ctx.createStereoPanner();
    s.pan.value = p;
    return this.n(s);
  }
  delay(t, max = 2) {
    const d = this.ctx.createDelay(max);
    d.delayTime.value = t;
    return this.n(d);
  }
  lfo(type, freq) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start();
    this.oscs.push(o);
    return this.n(o);
  }
  chain(...nodes) {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1];
  }
  /** Optional reverb send from `node`. */
  sendTo(node, reverb, amount) {
    if (!reverb || !(amount > 0)) return;
    this.chain(node, this.g(amount), reverb);
  }
  dispose() {
    for (const o of this.oscs) {
      try { o.stop(); } catch (e) { /* ignore */ }
    }
    for (const nd of this.nodes) {
      try { nd.disconnect(); } catch (e) { /* ignore */ }
    }
    this.nodes.length = 0;
    this.oscs.length = 0;
  }
}

/** Picked/synth bass: saw + sine through a plucky resonant lowpass and soft drive. */
export class Bass extends Inst {
  constructor(lib, dest, { level = 0.4, drive = 2.2, tone = 2200, sub = 0.55, pluck = 1 } = {}) {
    super(lib);
    this.sub = sub;
    this.pluck = pluck;
    this.input = this.g(1);
    this.out = this.g(level);
    this.chain(this.input, this.sh(drive, 0.05), this.f('lowpass', tone, 0.7), this.f('highpass', 35, 0.7), this.out, dest);
  }
  note(t, midi, dur, vel = 1, { cutoff = 1500, q = 2 } = {}) {
    const v = new Voice(this.lib, this.input, t);
    const f = mtof(midi);
    const lp = v.lp(cutoff, q);
    const top = Math.min(9000, (cutoff * (0.6 + 0.4 * vel) + 300) * this.pluck);
    lp.frequency.setValueAtTime(top, t);
    lp.frequency.setTargetAtTime(Math.max(250, f * 5), t + 0.004, 0.07);
    const g = v.gain(0);
    envADSR(g.gain, t, dur, 0.55 * vel, 0.003, 0.12, 0.65, 0.03);
    v.osc('sawtooth', f, t, dur + 0.06).connect(lp);
    const sub = v.osc('sine', f, t, dur + 0.06);
    const sg = v.gain(this.sub);
    sub.connect(sg);
    sg.connect(g);
    lp.connect(g);
    g.connect(v.out);
    v.done();
  }
}

/**
 * Double-tracked distorted rhythm guitar. Two amp chains (panned L/R) each:
 * drive -> tanh shaper -> cabinet EQ (HP, mid scoop, presence, steep LP).
 * Notes are summed BEFORE the shaper so power chords intermodulate like the real thing.
 */
export class Guitar extends Inst {
  constructor(lib, dest, { level = 0.2, drive = 10, width = 0.85, reverb = null, rev = 0.1 } = {}) {
    super(lib);
    this.out = this.g(level);
    this.out.connect(dest);
    this.sendTo(this.out, reverb, rev);
    this.amps = [-width, width].map((p) => {
      const input = this.g(1);
      this.chain(
        input,
        this.g(4),
        this.sh(drive, 0.08),
        this.f('highpass', 95, 0.7),
        this.f('peaking', 520, 1.0, -3.5),
        this.f('peaking', 1900, 0.9, 3.5),
        this.f('lowpass', 5000, 0.75),
        this.f('lowpass', 6200, 0.6),
        this.pan(p),
        this.out,
      );
      return input;
    });
  }
  /**
   * Power chord on `root` (MIDI). mute = palm-muted chug (dark, fast decay).
   * `notes` are semitone offsets (default root, fifth, octave).
   */
  chord(t, root, dur, vel = 1, { mute = false, notes = null } = {}) {
    const ns = notes || [0, 7, 12];
    for (let side = 0; side < 2; side++) {
      // the second "take" is a few ms late and differently detuned (double tracking)
      const tt = t + (side ? 0.004 + Math.random() * 0.008 : Math.random() * 0.003);
      const v = new Voice(this.lib, this.amps[side], tt);
      const pre = v.lp(mute ? 700 : 3400, mute ? 1.1 : 0.6);
      const env = v.gain(0);
      if (mute) envADSR(env.gain, tt, Math.max(0.03, dur * 0.8), 0.5 * vel, 0.002, 0.03, 0.02, 0.03);
      else envADSR(env.gain, tt, dur, 0.45 * vel, 0.003, 0.35, 0.6, 0.05);
      v.chain(pre, env, v.out);
      // pick attack: a tiny noise "chk" that the amp turns into a percussive edge
      v.noiseHit({ d: mute ? 0.02 : 0.012, peak: (mute ? 0.3 : 0.18) * vel, f: mute ? 1800 : 2800, q: 1.2 });
      const oct = v.gain(0.6);
      oct.connect(pre);
      for (let i = 0; i < ns.length; i++) {
        const det = (side ? 6 : -5) + (Math.random() - 0.5) * 6;
        const o = v.osc('sawtooth', mtof(root + ns[i]), tt, dur + 0.12);
        o.detune.setValueAtTime(det + 14, tt); // pick attack is slightly sharp...
        o.detune.linearRampToValueAtTime(det, tt + 0.03); // ...then settles
        o.connect(ns[i] >= 12 ? oct : pre);
      }
      v.done();
    }
  }
}

/** Lead synth/guitar: square + saw, pitch scoop, delayed vibrato, echo and reverb. */
export class Lead extends Inst {
  constructor(lib, dest, { level = 0.16, drive = 2, cutoff = 3800, wave = 'square', wave2 = 'sawtooth', echo = 0.28, echoTime = 0.26, fb = 0.3, reverb = null, rev = 0.25, pan = 0 } = {}) {
    super(lib);
    this.wave = wave;
    this.wave2 = wave2;
    this.input = this.g(1);
    this.out = this.g(level);
    const p = this.pan(pan);
    this.chain(this.input, this.sh(drive), this.f('lowpass', cutoff, 0.8), this.out, p, dest);
    if (echo > 0) {
      const dl = this.delay(echoTime);
      const fbg = this.g(fb);
      const wet = this.g(echo);
      this.chain(this.out, dl, fbg, dl);
      this.chain(dl, this.f('lowpass', 2600, 0.7), wet, dest);
    }
    this.sendTo(this.out, reverb, rev);
  }
  note(t, midi, dur, vel = 1, { vib = 1, scoop = -35 } = {}) {
    const v = new Voice(this.lib, this.input, t);
    const f = mtof(midi);
    const g = v.gain(0);
    envADSR(g.gain, t, dur, 0.5 * vel, 0.006, 0.25, 0.75, 0.07);
    const a = v.osc(this.wave, f, t, dur + 0.12);
    const b = v.osc(this.wave2, f, t, dur + 0.12);
    a.detune.setValueAtTime(scoop, t);
    a.detune.linearRampToValueAtTime(0, t + 0.045);
    b.detune.setValueAtTime(scoop + 7, t);
    b.detune.linearRampToValueAtTime(7, t + 0.045);
    const bg = v.gain(0.5);
    b.connect(bg);
    bg.connect(g);
    a.connect(g);
    if (vib > 0 && dur > 0.2) {
      const lfo = v.osc('sine', 5.6, t, dur + 0.12);
      const depth = v.gain(0);
      depth.gain.setValueAtTime(0, t + 0.15);
      depth.gain.linearRampToValueAtTime(16 * vib, t + Math.max(0.2, Math.min(dur, 0.5)));
      lfo.connect(depth);
      depth.connect(a.detune);
      depth.connect(b.detune);
    }
    g.connect(v.out);
    v.done();
  }
}

/** Plucky arpeggio synth with a filter envelope and stereo ping-pong delay. */
export class Pluck extends Inst {
  constructor(lib, dest, { level = 0.12, wave = 'square', cutoff = 1200, env = 3500, delay = 0.3, fb = 0.35, wet = 0.3, reverb = null, rev = 0.15 } = {}) {
    super(lib);
    this.wave = wave;
    this.cutoff = cutoff;
    this.envAmt = env;
    this.input = this.g(1);
    this.out = this.g(level);
    this.chain(this.input, this.out, dest);
    if (wet > 0) {
      const dL = this.delay(delay);
      const dR = this.delay(delay);
      const fbg = this.g(fb);
      const w = this.g(wet);
      this.chain(this.out, dL, dR, fbg, dL);
      this.chain(dL, this.pan(-0.7), w);
      this.chain(dR, this.pan(0.7), w);
      w.connect(dest);
    }
    this.sendTo(this.out, reverb, rev);
  }
  note(t, midi, dur, vel = 1) {
    const v = new Voice(this.lib, this.input, t);
    const lp = v.lp(this.cutoff, 3);
    lp.frequency.setValueAtTime(this.cutoff + this.envAmt * vel, t);
    lp.frequency.exponentialRampToValueAtTime(this.cutoff, t + 0.12);
    const g = v.gain(0);
    envPerc(g.gain, t, 0.4 * vel, 0.002, Math.max(0.08, dur));
    v.chain(v.osc(this.wave, mtof(midi), t, dur + 0.15), lp, g, v.out);
    v.done();
  }
}

/** Polysynth for chord stabs, pads and brass: detuned saws, filter env, stereo chorus. */
export class Poly extends Inst {
  constructor(lib, dest, { level = 0.15, chorus = true, width = 0.6, reverb = null, rev = 0.25 } = {}) {
    super(lib);
    this.input = this.g(1);
    this.out = this.g(level);
    this.out.connect(dest);
    if (chorus) {
      this.chain(this.input, this.g(0.6), this.out);
      const lfo = this.lfo('sine', 0.45);
      const d1 = this.delay(0.013, 0.1);
      const d2 = this.delay(0.017, 0.1);
      this.chain(lfo, this.g(0.0025), d1.delayTime);
      this.chain(lfo, this.g(-0.0025), d2.delayTime);
      this.chain(this.input, d1, this.pan(-width), this.out);
      this.chain(this.input, d2, this.pan(width), this.out);
    } else {
      this.input.connect(this.out);
    }
    this.sendTo(this.out, reverb, rev);
  }
  chord(t, midis, dur, vel = 1, o = {}) {
    const { wave = 'sawtooth', detune = 9, a = 0.004, dTau = 0.12, sus = 0.45, rel = 0.1, cutoff = 900, envAmt = 2600, q = 1.2, fTau = 0.09, voices = 2 } = o;
    const v = new Voice(this.lib, this.input, t);
    const lp = v.lp(cutoff, q);
    lp.frequency.setValueAtTime(Math.min(16000, cutoff + envAmt * vel), t);
    lp.frequency.setTargetAtTime(cutoff, t + a, fTau);
    const g = v.gain(0);
    const peak = (0.3 / Math.sqrt(midis.length * voices)) * vel;
    envADSR(g.gain, t, dur, peak, a, dTau, sus, rel);
    for (const m of midis) {
      for (let k = 0; k < voices; k++) {
        const det = voices === 1 ? 0 : ((k / (voices - 1)) * 2 - 1) * detune;
        v.osc(wave, mtof(m), t, dur + rel + 0.05, det).connect(lp);
      }
    }
    v.chain(lp, g, v.out);
    v.done();
  }
}
