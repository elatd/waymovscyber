/**
 * sfx/game.js - gameplay feedback stingers and menu UI blips.
 */
import { clamp, mtof, rand, semis } from '../dsp.js';
import { envADSR } from '../voice.js';
import { chime, brass, scatter } from './util.js';

/** Passenger hops in: door thunk + latch, then a happy two-note chime. */
export function pickup(v, o) {
  const R = o.rate;
  v.tone({ f: 125 * R, f2: 72 * R, glide: 0.07, a: 0.002, d: 0.13, peak: 0.45 });
  v.noiseHit({ kind: 'brown', d: 0.1, peak: 0.6, type: 'lowpass', f: 800 });
  v.noiseHit({ at: 0.003, d: 0.022, peak: 0.12, f: 2700, q: 3 });
  chime(v, 0.15, 1319 * R, 0.16); // E6
  chime(v, 0.26, 1661 * R, 0.18); // G#6
}

/** Successful drop-off: brassy D-major arpeggio into a held chord with sparkles. */
export function deliver(v, o) {
  const k = o.rate;
  [74, 78, 81, 86].forEach((m, i) => brass(v, i * 0.065, m, 0.1, 0.13, k));
  const at = 0.29;
  [62, 69, 74, 78, 81, 86].forEach((m) => brass(v, at, m, 0.85, 0.06, k, 0.35));
  v.pings({
    times: [0.3, 0.38, 0.46, 0.55, 0.66, 0.8, 0.95],
    freqs: [2349, 2960, 3520, 4699, 2960, 3520, 2349].map((f) => f * k),
    peak: 0.05,
    d: [0.18, 0.12, 0.2],
    poly: 3,
    rev: 0.4,
  });
  v.noiseHit({ at, a: 0.01, d: 1.0, peak: 0.07, type: 'highpass', f: 6500, rev: 0.3 });
  v.tone({ f: 110 * k, f2: 55 * k, glide: 0.2, at, d: 0.35, peak: 0.3 });
}

/** Cash register "cha-ching": drawer clatter, then a bright bell + coins. */
export function cash(v, o) {
  const R = o.rate;
  v.noiseHit({ d: 0.05, peak: 0.5, f: 1800, q: 1.2 });
  v.ticks({ times: [0, 0.018, 0.035], peaks: [1, 0.6, 0.8], peak: 0.35, d: 0.02, f: 3200, q: 2 });
  v.tone({ f: 180 * R, f2: 110 * R, glide: 0.05, d: 0.08, peak: 0.3 });
  v.partials({ at: 0.075, f0: 2093 * R, ratios: [1, 1.5, 2.0, 2.68, 3.3], amps: [1, 0.4, 0.6, 0.3, 0.2], decays: [0.9, 0.6, 0.5, 0.35, 0.25], peak: 0.2, rev: 0.3 });
  v.pings({ times: scatter(5, 0.09, 0.35, 1.2), freqs: [3200, 4100, 4700, 5200, 3600].map((f) => f * R * rand(0.95, 1.05)), peak: 0.05, d: 0.08, poly: 3 });
}

/** Coin "bling"; intensity (combo level) raises the pitch up to an octave. */
export function tip(v, o) {
  const k = semis(Math.round(clamp(o.intensity) * 12)) * o.rate;
  const t = v.t;
  const osc = v.osc('square', 988 * k, t, 0.42);
  osc.frequency.setValueAtTime(1319 * k, t + 0.06);
  const g = v.gain(0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.14, t + 0.003);
  g.gain.setValueAtTime(0.14, t + 0.06);
  g.gain.exponentialRampToValueAtTime(0.0014, t + 0.4);
  g.gain.linearRampToValueAtTime(0, t + 0.41);
  v.chain(osc, v.lp(5000, 0.7), g, v.out);
  v.send(g, 0.15);
  v.tone({ f: 2637 * k, at: 0.06, d: 0.3, peak: 0.06 });
}

/** Rising arcade stinger; intensity = combo level (higher start, more notes). */
export function combo(v, o) {
  const L = clamp(o.intensity);
  const k = o.rate;
  const n = 4 + Math.round(L * 3);
  const base = 72 + Math.round(L * 7);
  const arp = [0, 4, 7, 12, 16, 19, 24];
  const step = 0.048;
  const bus = v.gain(1);
  v.chain(bus, v.lp(6000, 0.7), v.out);
  v.send(bus, 0.25);
  for (let i = 0; i < n; i++) {
    const t = v.t + i * step;
    const f = mtof(base + arp[i]) * k;
    const last = i === n - 1;
    const dur = last ? 0.32 : 0.06;
    const g = v.gain(0);
    envADSR(g.gain, t, dur, last ? 0.12 : 0.1, 0.003, 0.08, 0.6, last ? 0.12 : 0.03);
    const a = v.osc('square', f, t, dur + 0.15);
    const b = v.osc('sawtooth', f * 2, t, dur + 0.15, 5);
    const bg = v.gain(0.35);
    b.connect(bg);
    bg.connect(g);
    a.connect(g);
    if (last) {
      const lfo = v.osc('sine', 7, t, dur + 0.15);
      const depth = v.gain(0);
      depth.gain.setValueAtTime(0, t + 0.05);
      depth.gain.linearRampToValueAtTime(25, t + 0.2);
      lfo.connect(depth);
      depth.connect(a.detune);
      depth.connect(b.detune);
    }
    g.connect(bus);
  }
  const span = n * step;
  v.sweepNoise({ dur: span + 0.15, type: 'bandpass', q: 2, freqs: [[0, 900], [span, 6500]], gains: [[0, 0], [span * 0.85, 0.05], [span + 0.15, 0]] });
}

/** Passenger bails out: sad "wah-wah-wah-waaah" trombone. */
export function fail(v, o) {
  const k = o.rate;
  const notes = [55, 54, 53, 52]; // G3 F#3 F3 E3
  const times = [0, 0.27, 0.54, 0.81];
  for (let i = 0; i < 4; i++) {
    const last = i === 3;
    const t = v.t + times[i];
    const dur = last ? 0.75 : 0.22;
    const f = mtof(notes[i]) * k;
    const lp = v.lp(350, 4);
    lp.frequency.setValueAtTime(350, t);
    lp.frequency.exponentialRampToValueAtTime(1700, t + 0.07);
    lp.frequency.exponentialRampToValueAtTime(last ? 500 : 650, t + dur);
    const g = v.gain(0);
    envADSR(g.gain, t, dur, 0.22, 0.02, 0.2, 0.8, last ? 0.18 : 0.04);
    const a = v.osc('sawtooth', f, t, dur + 0.25, -6);
    const b = v.osc('sawtooth', f, t, dur + 0.25, 6);
    if (last) {
      // growing vibrato and a little droop at the end
      const lfo = v.osc('sine', 5, t, dur + 0.25);
      const depth = v.gain(0);
      depth.gain.setValueAtTime(0, t + 0.1);
      depth.gain.linearRampToValueAtTime(35, t + dur);
      lfo.connect(depth);
      depth.connect(a.detune);
      depth.connect(b.detune);
      a.frequency.setValueAtTime(f, t + 0.35);
      a.frequency.linearRampToValueAtTime(f * 0.97, t + dur + 0.15);
      b.frequency.setValueAtTime(f, t + 0.35);
      b.frequency.linearRampToValueAtTime(f * 0.97, t + dur + 0.15);
    }
    a.connect(lp);
    b.connect(lp);
    v.chain(lp, g, v.out);
  }
}

/** Rival stole the fare: low impact + dissonant "dun... duuun" bending down. */
export function rival_steal(v, o) {
  const k = o.rate;
  v.tone({ f: 70 * k, f2: 38 * k, glide: 0.5, d: 0.75, peak: 0.5 });
  v.noiseHit({ kind: 'brown', d: 0.3, peak: 0.55, type: 'lowpass', f: 420 });
  const bus = v.gain(1);
  const out = v.gain(0.16);
  v.chain(bus, v.shaper(3.5, 0.1), v.lp(2200, 0.9), out, v.out);
  v.send(out, 0.3);
  const hit = (at, root, dur, bend) => {
    const t = v.t + at;
    const g = v.gain(0);
    envADSR(g.gain, t, dur, 0.5, 0.004, 0.25, 0.5, 0.2);
    const lp = v.lp(2400, 1.2);
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + dur + 0.2);
    for (const m of [root, root + 1, root + 6]) {
      const osc = v.osc('sawtooth', mtof(m) * k, t, dur + 0.25);
      osc.detune.setValueAtTime(rand(-6, 6), t);
      if (bend) osc.detune.linearRampToValueAtTime(-180, t + dur + 0.2);
      osc.connect(lp);
    }
    v.chain(lp, g, bus);
  };
  hit(0, 48, 0.14, false);
  hit(0.22, 47, 0.55, true);
}

/** 3-2-1 beep. */
export function countdown(v, o) {
  const f = 880 * o.rate;
  const t = v.t;
  const g = v.gain(0);
  envADSR(g.gain, t, 0.15, 0.14, 0.003, 0.1, 0.85, 0.05);
  const sq = v.osc('square', f, t, 0.25);
  const si = v.osc('sine', f, t, 0.25);
  const sg = v.gain(1.3);
  si.connect(sg);
  sg.connect(g);
  v.chain(sq, v.lp(3500, 0.7), g, v.out);
  v.send(g, 0.12);
}

/** Start sound: higher, longer beep with an octave-down body and a whoosh. */
export function go(v, o) {
  const f = 1760 * o.rate;
  const t = v.t;
  const dur = 0.55;
  const g = v.gain(0);
  envADSR(g.gain, t, dur, 0.13, 0.004, 0.25, 0.7, 0.22);
  const lp = v.lp(5000, 0.7);
  v.osc('square', f, t, dur + 0.3).connect(lp);
  const lo = v.osc('square', f / 2, t, dur + 0.3);
  const lg = v.gain(0.6);
  lo.connect(lg);
  lg.connect(lp);
  const si = v.osc('sine', f, t, dur + 0.3);
  const sg = v.gain(1.2);
  si.connect(sg);
  sg.connect(g);
  v.chain(lp, g, v.out);
  v.send(g, 0.2);
  v.sweepNoise({ dur: 0.5, type: 'bandpass', q: 1.2, freqs: [[0, 800], [0.35, 5000]], gains: [[0, 0], [0.2, 0.06], [0.5, 0]] });
}

let tickFlip = false;
/** Woodblock-ish clock tick for the last seconds (alternates tick / tock). */
export function tick(v, o) {
  tickFlip = !tickFlip;
  const f = (tickFlip ? 1250 : 980) * o.rate;
  v.tone({ f, a: 0.001, d: 0.05, peak: 0.28 });
  v.tone({ type: 'triangle', f: f * 2.71, a: 0.001, d: 0.018, peak: 0.08 });
  v.noiseHit({ d: 0.012, peak: 0.1, f: 4000, q: 2 });
}

/** Bright "+time" sparkle: quick ascending pentatonic run + chime + shimmer. */
export function time_bonus(v, o) {
  const k = o.rate;
  const notes = [88, 90, 92, 95, 97, 100]; // E6 F#6 G#6 B6 C#7 E7
  v.pings({ type: 'triangle', times: notes.map((_, i) => i * 0.035), freqs: notes.map((m) => mtof(m) * k), peak: 0.1, d: 0.22, poly: 6, rev: 0.35 });
  chime(v, 0.21, mtof(100) * k, 0.1);
  v.sweepNoise({ dur: 0.5, type: 'highpass', q: 0.7, freqs: [[0, 6000], [0.5, 9000]], gains: [[0, 0], [0.15, 0.05], [0.5, 0]] });
}

/** End of game: rock ending C5 - D5 - E5 (bVI-bVII-I) power-chord hits with drums. */
export function game_over(v, o) {
  const k = o.rate;
  const bus = v.gain(1);
  const out = v.gain(0.16);
  v.chain(bus, v.shaper(9, 0.05), v.hp(90), v.peak(1800, 1, 3), v.lp(4800, 0.7), v.lp(6000, 0.5), out, v.out);
  v.send(out, 0.3);
  const hits = [[0, 48, 0.16], [0.21, 50, 0.16], [0.42, 52, 1.5]];
  for (const [at, root, dur] of hits) {
    const t = v.t + at;
    const g = v.gain(0);
    envADSR(g.gain, t, dur, 0.5, 0.003, 0.4, 0.6, dur > 1 ? 0.5 : 0.05);
    for (const [m, dt] of [[root, -8], [root + 7, 6], [root + 12, 3], [root, 9]]) {
      v.osc('sawtooth', mtof(m) * k, t, dur + 0.6, dt).connect(g);
    }
    g.connect(bus);
    v.tone({ at, f: 160, f2: 48, glide: 0.06, d: 0.3, peak: 0.42 });
    v.noiseHit({ at, d: 0.16, peak: 0.25, type: 'highpass', f: 1500, rev: 0.2 });
  }
  v.noiseHit({ at: 0.42, a: 0.003, d: 1.8, peak: 0.12, type: 'highpass', f: 5000, rev: 0.3 });
  v.tone({ at: 0.42, f: 82 * k, d: 1.4, peak: 0.2 });
}

/** Menu cursor move: crisp short blip. */
export function ui_move(v, o) {
  const k = o.rate;
  v.tone({ type: 'triangle', f: 1400 * k, f2: 1700 * k, glide: 0.03, a: 0.002, d: 0.05, peak: 0.13 });
  v.tone({ f: 2800 * k, a: 0.001, d: 0.02, peak: 0.035 });
}

/** Menu confirm: two-tone up. */
export function ui_select(v, o) {
  const k = o.rate;
  const bus = v.gain(1);
  v.chain(bus, v.lp(5000), v.out);
  v.send(bus, 0.12);
  v.tone({ type: 'square', f: 988 * k, a: 0.002, d: 0.07, peak: 0.07, to: bus });
  v.tone({ type: 'square', f: 1480 * k, at: 0.055, a: 0.002, d: 0.16, peak: 0.07, to: bus });
  v.tone({ f: 1480 * k, at: 0.055, d: 0.22, peak: 0.08, to: bus });
}

/** Menu back: two-tone down, softer. */
export function ui_back(v, o) {
  const k = o.rate;
  v.tone({ type: 'triangle', f: 1175 * k, a: 0.002, d: 0.06, peak: 0.12 });
  v.tone({ type: 'triangle', f: 784 * k, at: 0.06, a: 0.002, d: 0.12, peak: 0.12 });
  v.tone({ f: 392 * k, at: 0.06, a: 0.002, d: 0.1, peak: 0.04 });
}
