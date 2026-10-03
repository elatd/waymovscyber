/**
 * sfx/util.js - small building blocks shared by several SFX recipes.
 */
import { mtof } from '../dsp.js';
import { envADSR } from '../voice.js';

/** n random times in [t0, t1]; pow > 1 clusters them toward t0 (debris-style). */
export function scatter(n, t0, t1, pow = 1) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = t0 + Math.pow(Math.random(), pow) * (t1 - t0);
  return out;
}

/** Soft bell / chime note (slightly inharmonic sine partials). */
export function chime(v, at, f, peak, rev = 0.25) {
  v.partials({
    at,
    f0: f,
    ratios: [1, 2.0, 3.01, 4.17],
    amps: [1, 0.32, 0.16, 0.07],
    decays: [0.75, 0.42, 0.26, 0.16],
    peak,
    rev,
  });
}

/** Brassy synth note: two detuned saws through a lowpass with a "blat" filter envelope. */
export function brass(v, at, midi, dur, peak, k = 1, rev = 0.2) {
  const t = v.t + at;
  const f = mtof(midi) * k;
  const lp = v.lp(700, 1.4);
  lp.frequency.setValueAtTime(700, t);
  lp.frequency.exponentialRampToValueAtTime(Math.min(9000, f * 6), t + 0.04);
  lp.frequency.exponentialRampToValueAtTime(Math.min(6000, f * 3), t + 0.3);
  const g = v.gain(0);
  envADSR(g.gain, t, dur, peak, 0.012, 0.18, 0.7, 0.12);
  v.osc('sawtooth', f, t, dur + 0.2, -7).connect(lp);
  v.osc('sawtooth', f, t, dur + 0.2, 7).connect(lp);
  v.chain(lp, g, v.out);
  if (rev) v.send(g, rev);
  return g;
}
