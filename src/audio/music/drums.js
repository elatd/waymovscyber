/**
 * music/drums.js - synthesized drum recipes and a DrumKit that pre-renders
 * them once into AudioBuffers with an OfflineAudioContext (cheap playback,
 * consistent sound). If offline rendering is unavailable or still running,
 * hits are synthesized live with the same recipes.
 */
import { makeWhiteBank } from '../dsp.js';
import { Voice, envPerc, envADSR, envSeq } from '../voice.js';

// TR-808 style metallic square bank (Hz)
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

function metal(v, t, dur, mult, peak, to) {
  const g = v.gain(peak);
  for (const f of METAL) v.osc('square', f * mult, t, dur).connect(g);
  g.connect(to);
}

function hat(v, decay, bright = 1) {
  const t = v.t;
  const bus = v.gain(1);
  metal(v, t, decay + 0.05, bright, 0.18, bus);
  const n = v.noise('white', t, decay + 0.05);
  const ng = v.gain(0.35);
  n.connect(ng);
  ng.connect(bus);
  const g = v.gain(0);
  envPerc(g.gain, t, 1, 0.0008, decay);
  v.chain(bus, v.bp(10000, 0.9), v.hp(7000, 0.7), g, v.out);
}

function tom(v, f0) {
  const t = v.t;
  const o = v.osc('sine', f0 * 1.45, t, 0.6);
  o.frequency.exponentialRampToValueAtTime(f0, t + 0.07);
  o.frequency.exponentialRampToValueAtTime(f0 * 0.9, t + 0.5);
  const g = v.gain(0);
  envPerc(g.gain, t, 0.9, 0.001, 0.45);
  v.chain(o, g, v.shaper(1.3), v.out);
  v.tone({ type: 'triangle', f: f0 * 1.95, f2: f0 * 1.5, glide: 0.05, d: 0.18, peak: 0.15 });
  v.noiseHit({ d: 0.04, peak: 0.2, f: 2500, q: 1 });
}

/**
 * name -> { len (s), live (approx. gain to match the normalized pre-render), fn(v) }.
 * Each recipe draws at v.t into v.out.
 */
export const RECIPES = {
  kick: {
    len: 0.6,
    fn(v) {
      const t = v.t;
      const o = v.osc('sine', 170, t, 0.6);
      o.frequency.exponentialRampToValueAtTime(58, t + 0.045);
      o.frequency.exponentialRampToValueAtTime(44, t + 0.35);
      const g = v.gain(0);
      envPerc(g.gain, t, 1, 0.002, 0.42);
      v.chain(o, g, v.shaper(1.6), v.out);
      v.noiseHit({ d: 0.012, peak: 0.5, type: 'highpass', f: 1800, q: 0.7 });
      v.tone({ type: 'triangle', f: 1100, f2: 400, glide: 0.01, a: 0.0005, d: 0.012, peak: 0.25 });
    },
  },
  snare: {
    len: 0.45,
    fn(v) {
      const t = v.t;
      v.tone({ type: 'triangle', f: 210, f2: 175, glide: 0.05, a: 0.001, d: 0.11, peak: 0.6 });
      v.tone({ f: 335, f2: 300, glide: 0.04, a: 0.001, d: 0.07, peak: 0.25 });
      const n = v.noise('white', t, 0.4);
      const g = v.gain(0);
      envPerc(g.gain, t, 0.75, 0.001, 0.2);
      v.chain(n, v.hp(1100, 0.7), v.peak(4200, 1, 6), g, v.out);
      v.noiseHit({ d: 0.28, peak: 0.12, f: 6500, q: 0.8 });
    },
  },
  hat: { len: 0.12, live: 4, fn: (v) => hat(v, 0.045) },
  hatOpen: { len: 0.6, live: 4, fn: (v) => hat(v, 0.42) },
  ride: {
    len: 1.6,
    live: 3,
    fn(v) {
      const t = v.t;
      const bus = v.gain(1);
      metal(v, t, 1.6, 1.53, 0.15, bus);
      const n = v.noise('white', t, 1.6);
      const ng = v.gain(0.25);
      n.connect(ng);
      ng.connect(bus);
      const g = v.gain(0);
      envPerc(g.gain, t, 1, 0.001, 1.3);
      v.chain(bus, v.bp(6500, 0.7), v.hp(3500, 0.7), g, v.out);
      v.partials({ f0: 2350, ratios: [1, 1.48], amps: [1, 0.5], decays: [0.6, 0.4], peak: 0.12 });
    },
  },
  crash: {
    len: 2.6,
    live: 2.5,
    fn(v) {
      const t = v.t;
      const bus = v.gain(1);
      metal(v, t, 2.6, 2.13, 0.12, bus);
      const n = v.noise('white', t, 2.6);
      const ng = v.gain(0.5);
      n.connect(ng);
      ng.connect(bus);
      const g = v.gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.3);
      g.gain.exponentialRampToValueAtTime(0.001, t + 2.5);
      g.gain.linearRampToValueAtTime(0, t + 2.55);
      v.chain(bus, v.hp(3800, 0.7), v.peak(7500, 0.8, 4), g, v.out);
    },
  },
  tomHi: { len: 0.6, fn: (v) => tom(v, 190) },
  tomMid: { len: 0.6, fn: (v) => tom(v, 140) },
  tomLo: { len: 0.6, fn: (v) => tom(v, 100) },
  kick808: {
    len: 1.0,
    fn(v) {
      const t = v.t;
      const o = v.osc('sine', 130, t, 1.0);
      o.frequency.exponentialRampToValueAtTime(52, t + 0.06);
      o.frequency.exponentialRampToValueAtTime(46, t + 0.8);
      const g = v.gain(0);
      envPerc(g.gain, t, 1, 0.002, 0.8);
      v.chain(o, g, v.shaper(2.2), v.out);
      v.noiseHit({ d: 0.008, peak: 0.35, type: 'highpass', f: 2500 });
    },
  },
  clap: {
    len: 0.5,
    live: 2,
    fn(v) {
      const t = v.t;
      const n = v.noise('white', t, 0.45);
      const g = v.gain(0);
      envSeq(g.gain, [
        { t, peak: 1, a: 0.001, d: 0.009 },
        { t: t + 0.011, peak: 0.9, a: 0.001, d: 0.009 },
        { t: t + 0.022, peak: 0.8, a: 0.001, d: 0.009 },
        { t: t + 0.033, peak: 1, a: 0.001, d: 0.2 },
      ]);
      v.chain(n, v.bp(1250, 1.1), v.hp(500, 0.7), g, v.out);
    },
  },
  snareGated: {
    len: 0.35,
    fn(v) {
      const t = v.t;
      v.tone({ type: 'triangle', f: 190, f2: 160, glide: 0.05, d: 0.1, peak: 0.5 });
      const n = v.noise('white', t, 0.3);
      const g = v.gain(0);
      envADSR(g.gain, t, 0.13, 0.8, 0.001, 0.04, 0.45, 0.02);
      v.chain(n, v.hp(900, 0.7), v.peak(3000, 1, 4), g, v.out);
    },
  },
  shaker: {
    len: 0.12,
    live: 2,
    fn(v) {
      const t = v.t;
      const n = v.noise('white', t, 0.11);
      const g = v.gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.6, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      g.gain.linearRampToValueAtTime(0, t + 0.085);
      v.chain(n, v.hp(6000, 0.7), v.bp(9000, 1), g, v.out);
    },
  },
};

/** Kit contents: [recipe, variants]. Variants differ by their noise realization. */
const KITS = {
  rock: [['kick', 1], ['snare', 2], ['hat', 3], ['hatOpen', 1], ['ride', 1], ['crash', 1], ['tomHi', 1], ['tomMid', 1], ['tomLo', 1]],
  electro: [['kick808', 1], ['clap', 2], ['snareGated', 1], ['hat', 2], ['hatOpen', 1], ['shaker', 2], ['crash', 1]],
};

function renderOffline(off) {
  return new Promise((resolve, reject) => {
    off.oncomplete = (e) => resolve(e.renderedBuffer);
    const p = off.startRendering();
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

export class DrumKit {
  constructor(lib, name) {
    this.lib = lib;
    this.ctx = lib.ctx;
    this.name = name;
    this.buffers = Object.create(null);
    this.rr = Object.create(null);
    this.ready = false;
    this.promise = this._render().catch((e) => {
      console.warn('[audio] drum pre-render failed, using live synthesis', e);
    });
  }

  async _render() {
    const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (!OAC) return;
    const sr = this.ctx.sampleRate;
    const slots = [];
    let total = 0.01;
    for (const [name, variants] of KITS[this.name]) {
      for (let k = 0; k < variants; k++) {
        slots.push({ name, start: total, len: RECIPES[name].len });
        total += RECIPES[name].len + 0.05;
      }
    }
    const off = new OAC(1, Math.ceil(total * sr), sr);
    const lib = { ctx: off, noise: makeWhiteBank(off, 2) };
    for (const s of slots) RECIPES[s.name].fn(new Voice(lib, off.destination, s.start));
    const rendered = await renderOffline(off);
    const data = rendered.getChannelData(0);
    for (const s of slots) {
      const i0 = Math.floor(s.start * sr);
      const n = Math.min(Math.floor(s.len * sr), data.length - i0);
      if (n <= 0) continue;
      const seg = data.slice(i0, i0 + n);
      let peak = 0;
      for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(seg[i]));
      const k = peak > 1e-6 ? 0.9 / peak : 1;
      const fade = Math.min(n, Math.floor(sr * 0.005));
      for (let i = 0; i < n; i++) seg[i] *= k * (i >= n - fade ? (n - i) / fade : 1);
      const buf = this.ctx.createBuffer(1, n, sr);
      if (buf.copyToChannel) buf.copyToChannel(seg, 0);
      else buf.getChannelData(0).set(seg);
      (this.buffers[s.name] || (this.buffers[s.name] = [])).push(buf);
    }
    this.ready = true;
  }

  /** Play drum `name` at time t into `dest` with gain `vel` and playback `rate`. */
  play(name, t, vel, dest, rate = 1) {
    if (!(vel > 0)) return;
    const vars = this.buffers[name];
    if (vars && vars.length) {
      const i = (this.rr[name] = ((this.rr[name] || 0) + 1) % vars.length);
      const s = this.ctx.createBufferSource();
      s.buffer = vars[i];
      s.playbackRate.value = rate;
      const g = this.ctx.createGain();
      g.gain.value = vel;
      s.connect(g);
      g.connect(dest);
      s.onended = () => {
        s.disconnect();
        g.disconnect();
      };
      s.start(t);
      return;
    }
    const r = RECIPES[name];
    if (!r) return;
    const v = new Voice(this.lib, dest, t, { gain: vel * 0.9 * (r.live || 1) });
    r.fn(v);
    v.done();
  }
}
