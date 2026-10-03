/**
 * sfx/specials.js - robotaxi-specific sounds: boost, the Waymo lidar pulse,
 * the Cybercab ludicrous surge and the polite electronic horn.
 */
import { envPerc } from '../voice.js';
import { scatter } from './util.js';

/** Electric surge whoosh when boost begins. */
export function boost_start(v, o) {
  const k = o.rate;
  const t = v.t;
  const dur = 0.85;
  v.tone({ f: 95 * k, f2: 45 * k, glide: 0.2, d: 0.35, peak: 0.5 });
  const bp = v.bp(400, 5);
  bp.frequency.setValueAtTime(400, t);
  bp.frequency.exponentialRampToValueAtTime(4200, t + dur);
  const g = v.gain(0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.5, t + 0.05);
  g.gain.linearRampToValueAtTime(0.38, t + 0.55);
  g.gain.linearRampToValueAtTime(0, t + dur);
  for (const dt of [-12, 12]) {
    const s = v.osc('sawtooth', 180 * k, t, dur + 0.05, dt);
    s.frequency.exponentialRampToValueAtTime(1700 * k, t + dur);
    s.connect(bp);
  }
  v.chain(bp, g, v.out);
  v.send(g, 0.25);
  v.sweepNoise({ dur: 0.8, type: 'bandpass', q: 1.2, freqs: [[0, 600], [0.6, 5000], [0.8, 3200]], gains: [[0, 0], [0.1, 0.12], [0.8, 0]] });
  v.tone({ type: 'square', f: 2400 * k, f2: 300 * k, glide: 0.08, a: 0.001, d: 0.09, peak: 0.06 });
  v.ticks({ times: scatter(10, 0, 0.5, 1.3), peak: 0.08, d: 0.01, f: 5000, q: 2 });
}

/** Waymo special: deep pulse, sonar ping with echoes, rising scanning shimmer. */
export function lidar_pulse(v, o) {
  const k = o.rate;
  const t = v.t;
  // deep pulse
  v.tone({ f: 58 * k, f2: 44 * k, glide: 0.9, a: 0.012, d: 1.2, peak: 0.45 });
  v.tone({ f: 116 * k, f2: 88 * k, glide: 0.9, a: 0.012, d: 0.8, peak: 0.12 });
  // sonar ping through a feedback echo
  const echo = v.gain(1);
  const dl = v.delay(0.19, 1);
  const fb = v.gain(0.42);
  const wet = v.gain(0.7);
  v.chain(echo, dl, fb, dl);
  dl.connect(wet);
  wet.connect(v.out);
  echo.connect(v.out);
  v.send(wet, 0.4);
  v.send(echo, 0.3);
  v.tone({ f: 1320 * k, f2: 1250 * k, glide: 0.3, a: 0.004, d: 0.35, peak: 0.14, to: echo });
  v.tone({ f: 2640 * k, a: 0.002, d: 0.12, peak: 0.04, to: echo });
  // rising shimmer: parallel sine "chord" sweeping up, tremolo-scanned
  const sh = v.gain(0);
  sh.gain.setValueAtTime(0, t);
  sh.gain.linearRampToValueAtTime(0.06, t + 0.35);
  sh.gain.linearRampToValueAtTime(0.045, t + 1.1);
  sh.gain.linearRampToValueAtTime(0, t + 1.6);
  const trem = v.gain(0.55);
  const lfo = v.osc('sine', 15, t, 1.65);
  const ld = v.gain(0.45);
  lfo.connect(ld);
  ld.connect(trem.gain);
  v.chain(sh, trem, v.out);
  v.send(trem, 0.35);
  const nyq = v.ctx.sampleRate * 0.45;
  [300, 450, 620, 800, 1050, 1300].forEach((f, i) => {
    const s = v.osc('sine', f * k, t + i * 0.02, 1.6);
    s.frequency.exponentialRampToValueAtTime(Math.min(nyq, f * k * 10), t + 1.5);
    s.connect(sh);
  });
  v.sweepNoise({ at: 0.05, dur: 1.45, type: 'bandpass', q: 8, freqs: [[0, 800], [1.3, 9000]], gains: [[0, 0], [0.3, 0.05], [1.45, 0]], rev: 0.3 });
}

/** Cybercab special: boom, distorted bass drop, rising twin-saw whine, crackle. */
export function ludicrous(v, o) {
  const k = o.rate;
  const t = v.t;
  v.noiseHit({ kind: 'brown', d: 0.5, peak: 0.35, type: 'lowpass', f: 650 });
  v.noiseHit({ d: 0.12, peak: 0.15, type: 'highpass', f: 2000 });
  // bass drop
  const bg = v.gain(0);
  bg.gain.setValueAtTime(0, t);
  bg.gain.linearRampToValueAtTime(0.28, t + 0.006);
  bg.gain.setValueAtTime(0.28, t + 0.5);
  bg.gain.linearRampToValueAtTime(0, t + 1.5);
  const sub = v.osc('sine', 150 * k, t, 1.55);
  sub.frequency.exponentialRampToValueAtTime(32 * k, t + 0.9);
  v.chain(sub, v.shaper(2.5), v.lp(500, 0.7), bg, v.out);
  // rising whine
  const bp = v.bp(500, 4);
  bp.frequency.setValueAtTime(500, t);
  bp.frequency.exponentialRampToValueAtTime(5000, t + 1.4);
  const wg = v.gain(0);
  wg.gain.setValueAtTime(0, t);
  wg.gain.linearRampToValueAtTime(0.22, t + 0.25);
  wg.gain.linearRampToValueAtTime(0.18, t + 1.2);
  wg.gain.linearRampToValueAtTime(0, t + 1.55);
  for (const dt of [-15, 15]) {
    const s = v.osc('sawtooth', 320 * k, t, 1.6, dt);
    s.frequency.exponentialRampToValueAtTime(4000 * k, t + 1.4);
    s.connect(bp);
  }
  v.chain(bp, wg, v.out);
  v.send(wg, 0.3);
  // electrical crackle
  const cr = v.noise('crackle', t, 1.4, 1.3);
  const cg = v.gain(0);
  cg.gain.setValueAtTime(0, t);
  cg.gain.linearRampToValueAtTime(0.4, t + 0.1);
  cg.gain.linearRampToValueAtTime(0.28, t + 1.0);
  cg.gain.linearRampToValueAtTime(0, t + 1.4);
  v.chain(cr, v.hp(2500), cg, v.out);
  v.sweepNoise({ at: 0.1, dur: 1.3, type: 'bandpass', q: 3, freqs: [[0, 1500], [1.2, 9000]], gains: [[0, 0], [0.4, 0.05], [1.3, 0]], rev: 0.3 });
}

/** The robotaxi's polite electronic chime-horn (two soft FM bell notes). */
export function horn_player(v, o) {
  const k = o.rate;
  for (const [at, f0] of [[0, 784], [0.13, 1047]]) {
    const t = v.t + at;
    const f = f0 * k;
    const car = v.osc('sine', f, t, 0.6);
    const mod = v.osc('sine', f * 2, t, 0.6);
    const idx = v.gain(0);
    idx.gain.setValueAtTime(f * 1.4, t);
    idx.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.35);
    mod.connect(idx);
    idx.connect(car.frequency);
    const g = v.gain(0);
    envPerc(g.gain, t, 0.22, 0.006, 0.5);
    car.connect(g);
    g.connect(v.out);
    v.send(g, 0.25);
    v.tone({ type: 'triangle', f: f / 2, at, a: 0.02, d: 0.35, peak: 0.08 });
  }
}
