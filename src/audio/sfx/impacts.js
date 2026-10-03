/**
 * sfx/impacts.js - collisions, breakables, landings, water.
 * Every recipe has the signature (v: Voice, o: { volume, pan, rate, intensity })
 * and schedules its sound starting at v.t into v.out.
 */
import { rand } from '../dsp.js';
import { scatter } from './util.js';

/** Hard hit on a building / car: low thump + distorted metal crunch + ring + debris. */
export function crash(v, o) {
  const I = 0.35 + 0.65 * o.intensity;
  const R = o.rate * rand(0.92, 1.08);
  // low body thump
  v.tone({ f: 95 * R, f2: 36 * R, glide: 0.25, a: 0.002, d: 0.35 + 0.25 * I, peak: 0.45 * I });
  v.noiseHit({ kind: 'brown', a: 0.002, d: 0.3 + 0.2 * I, peak: 0.7 * I, type: 'lowpass', f: 420, q: 0.8 });
  // metal crunch: cluster of band-passed bursts through a distortion
  const crunch = v.gain(1);
  const out = v.gain(0.3 * I);
  v.chain(crunch, v.shaper(3 + 5 * I), v.hp(250), v.lp(7000), out, v.out);
  v.send(out, 0.22);
  const n = 3 + Math.round(4 * I);
  for (let i = 0; i < n; i++) {
    v.noiseHit({ at: i ? rand(0.005, 0.1 + 0.1 * I) : 0, d: rand(0.04, 0.14), peak: rand(0.4, 0.9), f: rand(700, 3400) * R, q: rand(1.2, 3.5), to: crunch });
  }
  // sheet-metal ring
  v.partials({
    f0: rand(260, 420) * R,
    ratios: [1, 2.31, 3.17, 4.53, 5.92],
    amps: [0.6, 0.45, 0.35, 0.25, 0.15],
    decays: [0.55, 0.42, 0.32, 0.24, 0.18].map((d) => d * (0.7 + 0.6 * I)),
    at: 0.003,
    peak: 0.12 * I,
    rev: 0.2,
  });
  // debris rattle in two colours
  v.ticks({ times: scatter(5 + Math.round(8 * I), 0.05, 0.45 + 0.4 * I, 1.6), peaks: [1, 0.6, 0.8, 0.4], peak: 0.12 * I, d: 0.025, f: rand(2600, 4200), q: 4 });
  v.ticks({ times: scatter(3 + Math.round(6 * I), 0.08, 0.6 + 0.3 * I, 1.4), peaks: [0.7, 1, 0.5], peak: 0.09 * I, d: 0.04, f: rand(5000, 7500), q: 5, rev: 0.15 });
  // a few glass tinkles on heavy hits
  if (I > 0.7) {
    v.pings({ times: scatter(6, 0.03, 0.5, 1.5), freqs: [3100, 4400, 5200, 6100, 3700, 6900].map((x) => x * rand(0.9, 1.1)), peak: 0.05, d: [0.05, 0.08, 0.12], poly: 3 });
  }
}

/** Light car contact. */
export function bump(v, o) {
  const I = 0.45 + 0.55 * o.intensity;
  const R = o.rate * rand(0.9, 1.1);
  v.tone({ f: 140 * R, f2: 62 * R, glide: 0.08, a: 0.002, d: 0.12, peak: 0.45 * I });
  v.noiseHit({ kind: 'brown', d: 0.08, peak: 0.6 * I, type: 'lowpass', f: 700, q: 0.8 });
  v.noiseHit({ at: 0.002, d: 0.03, peak: 0.1 * I, f: 1900 * R, q: 3 });
  v.partials({ f0: rand(500, 700) * R, ratios: [1, 2.76], amps: [1, 0.5], decays: [0.12, 0.08], peak: 0.04 * I });
}

/** Short metal scrape: resonant noise with a grinding sawtooth AM + faint squeal. */
export function scrape(v, o) {
  const I = 0.45 + 0.55 * o.intensity;
  const R = o.rate * rand(0.9, 1.1);
  const t = v.t;
  const dur = rand(0.32, 0.5);
  const src = v.noise('white', t, dur + 0.05);
  const b1 = v.bp(3000 * R, 5);
  const b2 = v.bp(5400 * R, 8);
  b1.frequency.setValueAtTime(3000 * R, t);
  b1.frequency.exponentialRampToValueAtTime(1800 * R, t + dur);
  const am = v.gain(0.55);
  const lfo = v.osc('sawtooth', rand(35, 65), t, dur + 0.05);
  const depth = v.gain(0.45);
  lfo.connect(depth);
  depth.connect(am.gain);
  const env = v.gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(1.4 * I, t + 0.02);
  env.gain.linearRampToValueAtTime(0.9 * I, t + dur * 0.7);
  env.gain.linearRampToValueAtTime(0, t + dur);
  src.connect(b1);
  src.connect(b2);
  b1.connect(am);
  b2.connect(am);
  v.chain(am, env, v.out);
  v.send(env, 0.15);
  v.tone({ type: 'triangle', f: 2900 * R * rand(0.95, 1.05), f2: 2400 * R, glide: dur, a: 0.03, d: dur, peak: 0.04 * I });
}

/** Trash can / cone / plastic box: hollow knock and a few bounces with rattle. */
export function break_plastic(v, o) {
  const I = 0.5 + 0.5 * o.intensity;
  const R = o.rate * rand(0.88, 1.12);
  v.noiseHit({ d: 0.05, peak: 0.45 * I, f: 1200 * R, q: 2 });
  v.noiseHit({ kind: 'brown', d: 0.07, peak: 0.5 * I, type: 'lowpass', f: 900 });
  const f = rand(240, 360) * R;
  const bounces = [0, 0.16, 0.27, 0.35, 0.41];
  for (let i = 0; i < bounces.length; i++) {
    const at = bounces[i] * rand(0.9, 1.1);
    const k = Math.pow(0.62, i);
    v.tone({ type: 'triangle', f: f * (1 + 0.05 * i), f2: f * 0.82, glide: 0.07, at, a: 0.001, d: 0.09, peak: 0.32 * I * k });
    v.noiseHit({ at, d: 0.025, peak: 0.18 * I * k, f: 2300 * R, q: 2 });
  }
  v.ticks({ times: scatter(6, 0.04, 0.5, 1.3), peak: 0.08 * I, d: 0.02, f: 3600 * R, q: 4 });
}

/** Parking meter / newspaper box: metal-bar clang plus a smaller bounce clang. */
export function break_metal(v, o) {
  const I = 0.5 + 0.5 * o.intensity;
  const R = o.rate * rand(0.9, 1.1);
  v.noiseHit({ d: 0.04, peak: 0.35 * I, type: 'highpass', f: 1800, q: 0.7 });
  v.tone({ f: 170 * R, f2: 70 * R, glide: 0.1, d: 0.16, peak: 0.4 * I });
  const f0 = rand(330, 480) * R;
  // free-free bar modes (1, 2.76, 5.40, 8.93) + a body mode
  v.partials({ f0, ratios: [1, 1.47, 2.76, 5.4, 8.93], amps: [1, 0.5, 0.6, 0.4, 0.25], decays: [0.9, 0.7, 0.6, 0.4, 0.25], peak: 0.14 * I, rev: 0.25 });
  const at = rand(0.2, 0.3);
  v.partials({ at, f0: f0 * 1.04, ratios: [1, 2.76, 5.4], amps: [1, 0.5, 0.3], decays: [0.45, 0.3, 0.2], peak: 0.07 * I });
  v.noiseHit({ at, d: 0.03, peak: 0.12 * I, f: 3000, q: 2 });
}

/** Bench: splintering crack, woody body resonance, planks hitting the ground. */
export function break_wood(v, o) {
  const I = 0.5 + 0.5 * o.intensity;
  const R = o.rate * rand(0.9, 1.1);
  v.ticks({ times: [0, 0.011, 0.027, 0.05, 0.07], peaks: [1, 0.7, 0.8, 0.45, 0.3], peak: 0.45 * I, d: 0.035, f: 2000 * R, q: 1.3 });
  v.noiseHit({ d: 0.16, peak: 0.6 * I, f: rand(200, 300) * R, q: 9 });
  v.noiseHit({ d: 0.11, peak: 0.35 * I, f: rand(520, 720) * R, q: 7 });
  const hits = [0.13, 0.25, 0.34];
  for (let i = 0; i < hits.length; i++) {
    const at = hits[i] * rand(0.9, 1.12);
    const k = Math.pow(0.65, i);
    v.tone({ type: 'triangle', f: rand(150, 220) * R, f2: 95 * R, glide: 0.05, at, d: 0.08, peak: 0.3 * I * k });
    v.noiseHit({ at, d: 0.05, peak: 0.25 * I * k, f: 900 * R, q: 2 });
  }
}

/** Glass shatter: bright impact, wash, and a shower of pitched shards. */
export function glass(v, o) {
  const I = 0.5 + 0.5 * o.intensity;
  const R = o.rate * rand(0.92, 1.08);
  v.noiseHit({ a: 0.0005, d: 0.07, peak: 0.4 * I, type: 'highpass', f: 2500, q: 0.7, rev: 0.2 });
  v.noiseHit({ d: 0.3, peak: 0.12 * I, f: 5200, q: 0.9, rev: 0.3 });
  const n = 14 + Math.round(10 * I);
  const freqs = [];
  for (let i = 0; i < n; i++) freqs.push(rand(2300, 7600) * R);
  v.pings({ times: scatter(n, 0.005, 0.75, 1.8), freqs, peaks: [1, 0.6, 0.8, 0.45, 0.7], peak: 0.09 * I, d: [0.05, 0.09, 0.14, 0.07], poly: 4, rev: 0.35 });
  v.ticks({ times: scatter(10, 0.02, 0.6, 1.5), peak: 0.06 * I, d: 0.015, type: 'highpass', f: 6500, q: 0.7 });
}

/** Fire hydrant knocked off: heavy clank, then a ~1.4 s water gush with spray. */
export function hydrant(v, o) {
  const I = 0.6 + 0.4 * o.intensity;
  const R = o.rate * rand(0.94, 1.06);
  v.tone({ f: 120 * R, f2: 52 * R, glide: 0.12, d: 0.25, peak: 0.5 * I });
  v.noiseHit({ d: 0.05, peak: 0.35 * I, type: 'highpass', f: 1400 });
  v.partials({ f0: rand(200, 250) * R, ratios: [1, 1.5, 2.76, 5.4], amps: [1, 0.45, 0.55, 0.3], decays: [0.7, 0.55, 0.45, 0.3], peak: 0.16 * I, rev: 0.2 });
  // water gush
  const t = v.t + 0.04;
  const dur = 1.45;
  const src = v.noise('white', t, dur + 0.05);
  const lp = v.lp(900, 0.6);
  lp.frequency.setValueAtTime(900, t);
  lp.frequency.exponentialRampToValueAtTime(5200, t + 0.12);
  lp.frequency.exponentialRampToValueAtTime(2600, t + 0.9);
  lp.frequency.exponentialRampToValueAtTime(1100, t + dur);
  const body = v.peak(1600, 0.8, 4);
  const am = v.gain(0.75);
  const flutter = v.noise('wobble', t, dur + 0.05, 3);
  const fd = v.gain(0.3);
  flutter.connect(fd);
  fd.connect(am.gain);
  const env = v.gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.42 * I, t + 0.06);
  env.gain.linearRampToValueAtTime(0.32 * I, t + 0.8);
  env.gain.exponentialRampToValueAtTime(0.002, t + dur);
  env.gain.linearRampToValueAtTime(0, t + dur + 0.02);
  v.chain(src, lp, body, am, env, v.out);
  v.send(env, 0.3);
  // spray hiss + pressure whoomp
  v.sweepNoise({ at: 0.06, dur: 1.3, type: 'highpass', q: 0.5, freqs: [[0, 4200], [1.3, 6000]], gains: [[0, 0], [0.1, 0.1 * I], [0.9, 0.06 * I], [1.3, 0]] });
  v.noiseHit({ kind: 'brown', at: 0.03, a: 0.02, d: 0.5, peak: 0.8 * I, type: 'lowpass', f: 300 });
}

/** Landing after a jump: suspension thud + tire chirp (+ rattle when heavy). */
export function land(v, o) {
  const I = 0.25 + 0.75 * o.intensity;
  const R = o.rate * rand(0.95, 1.05);
  v.tone({ f: 85 * R, f2: 38 * R, glide: 0.15, a: 0.002, d: 0.2 + 0.25 * I, peak: 0.45 * I });
  v.noiseHit({ kind: 'brown', d: 0.18 + 0.15 * I, peak: 0.55 * I, type: 'lowpass', f: 300 + 300 * I });
  v.noiseHit({ at: 0.008, d: 0.05, peak: 0.16 * I, f: 750, q: 2 });
  if (I > 0.35) {
    const d = 0.05 + 0.09 * I;
    const bp = v.bp(1700, 3);
    bp.connect(v.out);
    v.tone({ type: 'sawtooth', f: 1500 * R * rand(0.95, 1.05), f2: 1150 * R, glide: d, at: 0.01, a: 0.004, d, peak: 0.12 * I, to: bp });
    v.noiseHit({ at: 0.01, a: 0.004, d, peak: 0.12 * I, f: 1900, q: 6 });
  }
  if (I > 0.6) v.ticks({ times: scatter(5, 0.03, 0.3, 1.4), peak: 0.06 * I, d: 0.02, f: 3800, q: 4 });
}

/** Car leaves the ground: rising air whoosh + tiny free-spin rev. */
export function jump(v, o) {
  const R = o.rate;
  v.sweepNoise({ kind: 'pink', dur: 0.45, type: 'bandpass', q: 1.4, freqs: [[0, 350 * R], [0.3, 1800 * R], [0.45, 1100 * R]], gains: [[0, 0], [0.13, 0.9], [0.45, 0]] });
  v.tone({ type: 'triangle', f: 520 * R, f2: 960 * R, glide: 0.3, a: 0.06, d: 0.28, peak: 0.04 });
}

/** Car falls into the Bay: impact, water body, spray, bubbles and drips. */
export function splash(v, o) {
  const I = 0.6 + 0.4 * o.intensity;
  const R = o.rate * rand(0.92, 1.06);
  v.tone({ f: 75 * R, f2: 34 * R, glide: 0.3, d: 0.5, peak: 0.45 * I });
  v.noiseHit({ kind: 'brown', d: 0.55, peak: 0.65 * I, type: 'lowpass', f: 550 });
  v.sweepNoise({ dur: 2.2, type: 'lowpass', q: 0.8, freqs: [[0, 7000], [0.15, 3800], [1.0, 1300], [2.2, 380]], gains: [[0, 0], [0.025, 0.4 * I], [0.4, 0.26 * I], [1.2, 0.1 * I], [2.2, 0]], rev: 0.35 });
  v.sweepNoise({ at: 0.02, dur: 1.2, type: 'highpass', q: 0.6, freqs: [[0, 3000], [1.2, 5500]], gains: [[0, 0], [0.05, 0.14 * I], [1.2, 0]], rev: 0.3 });
  const nb = 18;
  const freqs = [];
  for (let i = 0; i < nb; i++) freqs.push(rand(320, 1300) * R);
  v.pings({ times: scatter(nb, 0.18, 2.0, 1.2), freqs, peaks: [1, 0.6, 0.8, 0.4], peak: 0.08 * I, d: [0.04, 0.06, 0.05], glide: 1.7, poly: 3, rev: 0.25 });
  v.ticks({ times: scatter(10, 0.8, 2.4, 1.0), peak: 0.05 * I, d: 0.02, f: 2500, q: 2, rev: 0.4 });
}
