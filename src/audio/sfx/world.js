/**
 * sfx/world.js - city ambience: traffic horns, cable car bell, seagulls,
 * passing whooshes.
 */
import { rand, pick } from '../dsp.js';
import { envADSR } from '../voice.js';

/** Random traffic horn: sedan honk, compact "meep", double honk or truck air horn. */
export function horn(v, o) {
  const R = o.rate * rand(0.94, 1.06);
  const kind = pick(['sedan', 'sedan', 'double', 'truck', 'compact']);
  const truck = kind === 'truck';
  const bus = v.gain(1);
  const out = v.gain(truck ? 0.3 : 0.24);
  // diaphragm-horn buzz: mild saturation + a strong resonance
  v.chain(bus, v.shaper(2.2), v.hp(220), v.peak(truck ? 900 : 2100, 1.2, 5), v.lp(truck ? 2400 : 3600, 0.8), out, v.out);
  v.send(out, 0.12);
  const honk = (at, dur, freqs, type) => {
    const t = v.t + at;
    const g = v.gain(0);
    envADSR(g.gain, t, dur, 0.45, 0.012, 0.08, 0.85, 0.05);
    g.connect(bus);
    for (const f of freqs) {
      const osc = v.osc(type, f * R, t, dur + 0.08);
      if (truck) {
        osc.detune.setValueAtTime(-60, t); // air horns bend up into pitch
        osc.detune.linearRampToValueAtTime(rand(-6, 6), t + 0.09);
      } else {
        osc.detune.setValueAtTime(rand(-8, 8), t);
      }
      osc.connect(g);
    }
  };
  switch (kind) {
    case 'sedan':
      honk(0, rand(0.28, 0.55), [415, 523], 'square');
      break;
    case 'compact':
      honk(0, rand(0.18, 0.32), [523, 659], 'square');
      break;
    case 'double': {
      const d = rand(0.09, 0.13);
      honk(0, d, [440, 554], 'square');
      honk(d + rand(0.06, 0.09), d * 1.2, [440, 554], 'square');
      break;
    }
    default:
      honk(0, rand(0.7, 1.1), [185, 233, 277], 'sawtooth');
  }
}

/** San Francisco cable car bell: "ding-ding" (sometimes "ding-ding ding-ding"). */
export function cable_bell(v, o) {
  const R = o.rate * rand(0.97, 1.03);
  const f0 = rand(1050, 1150) * R;
  const pattern = Math.random() < 0.35 ? [0, 0.15, 0.4, 0.55] : [0, 0.16];
  for (let i = 0; i < pattern.length; i++) {
    const at = pattern[i] + rand(0, 0.012);
    const pk = (i % 2 ? 0.75 : 1) * 0.12;
    // church-bell style partials: hum, prime, minor third, fifth, nominal...
    v.partials({
      at,
      f0,
      ratios: [0.5, 1, 1.19, 1.56, 2.0, 2.51, 2.66, 3.01],
      amps: [0.35, 1, 0.55, 0.4, 0.45, 0.28, 0.22, 0.18],
      decays: [1.8, 1.3, 1.0, 0.85, 0.7, 0.5, 0.42, 0.35],
      peak: pk,
      rev: 0.3,
    });
    v.noiseHit({ at, d: 0.012, peak: pk * 1.2, type: 'highpass', f: 3500 });
  }
}

/** Seagull: 2-4 "kyow" calls with a rise-fall pitch contour and a fluttery AM. */
export function seagull(v, o) {
  const R = o.rate * rand(0.9, 1.1);
  const calls = 2 + ((Math.random() * 3) | 0);
  const base = rand(1500, 1900) * R;
  const bus = v.gain(1);
  const f1 = v.bp(2300, 4);
  const f2 = v.bp(3500, 5);
  const mix = v.gain(1);
  const out = v.gain(0.22);
  bus.connect(f1);
  bus.connect(f2);
  f1.connect(mix);
  f2.connect(mix);
  v.chain(mix, v.hp(900), out, v.out);
  v.send(out, 0.35);
  let at = 0;
  for (let c = 0; c < calls; c++) {
    const dur = rand(0.16, 0.28) * (c === calls - 1 ? 1.5 : 1);
    const f = base * (1 - c * 0.04) * rand(0.97, 1.03);
    const t = v.t + at;
    // quick rise, long fall ("kyow")
    const osc = v.osc('sawtooth', f * 0.75, t, dur + 0.05);
    osc.frequency.exponentialRampToValueAtTime(f * 1.25, t + dur * 0.18);
    osc.frequency.exponentialRampToValueAtTime(f * 0.95, t + dur * 0.55);
    osc.frequency.exponentialRampToValueAtTime(f * 0.68, t + dur);
    // raspy throat: low-rate FM adds rough sidebands
    const fm = v.osc('sine', rand(85, 130), t, dur + 0.05);
    const fmd = v.gain(f * 0.06);
    fm.connect(fmd);
    fmd.connect(osc.frequency);
    const am = v.gain(0.6);
    const trem = v.osc('sine', rand(24, 34), t, dur + 0.05);
    const td = v.gain(0.4);
    trem.connect(td);
    td.connect(am.gain);
    const env = v.gain(0);
    envADSR(env.gain, t, dur, 1, 0.025, 0.1, 0.7, 0.05);
    v.chain(osc, am, env, bus);
    v.noiseHit({ at, a: 0.02, d: dur, peak: 0.05, f: 2600, q: 3, to: bus });
    at += dur + rand(0.06, 0.14);
  }
}

/** Generic camera / UI whoosh. */
export function whoosh(v, o) {
  const R = o.rate;
  const d = 0.5 / Math.sqrt(R);
  v.sweepNoise({ kind: 'pink', dur: d, type: 'bandpass', q: 1.1, freqs: [[0, 300 * R], [d * 0.45, 2600 * R], [d, 700 * R]], gains: [[0, 0], [d * 0.45, 0.7], [d, 0]] });
  v.sweepNoise({ kind: 'white', dur: d, type: 'highpass', q: 0.7, freqs: [[0, 3000]], gains: [[0, 0], [d * 0.5, 0.05], [d, 0]] });
}

/** Passing very close to traffic: stereo doppler whoosh + a passing motor tone. */
export function near_miss(v, o) {
  const R = o.rate * rand(0.94, 1.06);
  const dir = o.pan ? Math.sign(o.pan) : Math.random() < 0.5 ? -1 : 1;
  const t = v.t;
  const dur = 0.6;
  const p = v.panner(dir * 0.7);
  if (p.pan) {
    p.pan.setValueAtTime(dir * 0.7, t);
    p.pan.linearRampToValueAtTime(-dir * 0.6, t + dur);
  }
  p.connect(v.out);
  v.sweepNoise({ kind: 'pink', dur, type: 'bandpass', q: 1.5, freqs: [[0, 500 * R], [0.24, 2400 * R], [dur, 600 * R]], gains: [[0, 0], [0.22, 1.0], [dur, 0]], to: p });
  const f = rand(260, 340) * R;
  const osc = v.osc('sawtooth', f * 1.12, t, dur + 0.05);
  osc.frequency.setValueAtTime(f * 1.12, t + 0.16);
  osc.frequency.linearRampToValueAtTime(f * 0.86, t + 0.32);
  const g = v.gain(0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.06, t + 0.22);
  g.gain.linearRampToValueAtTime(0, t + dur);
  v.chain(osc, v.lp(1500, 0.7), g, p);
}
