/**
 * dsp.js - small math helpers and procedural buffer generators shared by the
 * audio modules (noise banks, reverb impulse response, distortion curves,
 * periodic waves). Pure functions, plus a few per-context caches.
 */

export const clamp = (x, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const semis = (n) => Math.pow(2, n / 12);
export const rand = (lo = 0, hi = 1) => lo + Math.random() * (hi - lo);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
/** Finite number or fallback. */
export const num = (x, fallback) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);

/** Seeded PRNG (mulberry32) so procedural music humanizes deterministically. */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'C4' -> 60, 'F#3' -> 54, 'Bb2' -> 46. Returns NaN for bad input. */
export function noteToMidi(name) {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name);
  if (!m) return NaN;
  let n = NOTE_INDEX[m[1].toUpperCase()];
  if (m[2] === '#') n++;
  else if (m[2] === 'b') n--;
  return n + (parseInt(m[3], 10) + 1) * 12;
}

/**
 * Gain compensation for band-passed white noise so that a burst's "peak"
 * parameter means roughly the same loudness regardless of filter width.
 */
export function bpComp(f, q) {
  return clamp(Math.sqrt(4500 / Math.max(20, f / Math.max(0.1, q))), 1, 8);
}

// ---------------------------------------------------------------------------
// Noise bank
// ---------------------------------------------------------------------------

function rms(d) {
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i] * d[i];
  return Math.sqrt(s / d.length) || 1;
}

function scaleTo(d, targetRms) {
  const k = targetRms / rms(d);
  for (let i = 0; i < d.length; i++) d[i] *= k;
}

function scalePeak(d, target) {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  const k = m > 0 ? target / m : 1;
  for (let i = 0; i < d.length; i++) d[i] *= k;
}

/** Equal-power crossfade of the tail into the head so the buffer loops seamlessly. */
function loopable(src, len, fade) {
  const out = new Float32Array(len);
  out.set(src.subarray(0, len));
  for (let i = 0; i < fade; i++) {
    const x = (i / fade) * Math.PI * 0.5;
    out[i] = src[i] * Math.sin(x) + src[len + i] * Math.cos(x);
  }
  return out;
}

function genWhite(n) {
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return d;
}

function genPink(n) {
  // Paul Kellet's refined pink filter.
  const d = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return d;
}

function genBrown(n) {
  const d = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last;
  }
  // remove DC drift
  let mean = 0;
  for (let i = 0; i < n; i++) mean += d[i];
  mean /= n;
  for (let i = 0; i < n; i++) d[i] -= mean;
  return d;
}

/** Sparse clicks (gravel, electrical crackle). */
function genCrackle(n, sr, perSecond) {
  const d = new Float32Array(n);
  const p = perSecond / sr;
  for (let i = 0; i < n - 64; i++) {
    if (Math.random() < p) {
      const amp = (0.3 + Math.random() * 0.7) * (Math.random() < 0.5 ? -1 : 1);
      const len = 8 + ((Math.random() * 40) | 0);
      for (let k = 0; k < len; k++) d[i + k] += amp * Math.exp(-k / (len * 0.3)) * (Math.random() * 2 - 1);
    }
  }
  return d;
}

/** Smooth random control signal in [-1, 1] (smoothstep-interpolated, loops cleanly). */
function genSmoothRandom(n, sr, rateHz) {
  const d = new Float32Array(n);
  const per = sr / rateHz;
  const count = Math.max(2, Math.round(n / per));
  const pts = new Float32Array(count + 1);
  for (let i = 0; i < count; i++) pts[i] = Math.random() * 2 - 1;
  pts[count] = pts[0];
  const span = n / count;
  for (let i = 0; i < n; i++) {
    const pos = i / span;
    const k = Math.min(count - 1, Math.floor(pos));
    const x = pos - k;
    const f = x * x * (3 - 2 * x); // smoothstep (cheaper than cosine, same feel)
    d[i] = pts[k] + (pts[k + 1] - pts[k]) * f;
  }
  return d;
}

function toBuffer(ctx, data) {
  const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
  if (buf.copyToChannel) buf.copyToChannel(data, 0);
  else buf.getChannelData(0).set(data);
  return buf;
}

/**
 * Pre-generates all noise / modulation buffers once.
 * white: uniform [-1,1]; pink/brown: RMS 0.3; crackle: sparse clicks (peak 0.9);
 * wobble: slow smooth random (~6 Hz); chatter: fast smooth random (~40 Hz).
 */
export function makeNoiseBank(ctx, seconds = 3) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const fade = Math.floor(sr * 0.05);
  const white = loopable(genWhite(n + fade), n, fade);
  const pink = loopable(genPink(n + fade), n, fade);
  scaleTo(pink, 0.3);
  const brown = loopable(genBrown(n + fade), n, fade);
  scaleTo(brown, 0.3);
  const crackle = genCrackle(n, sr, 140);
  scalePeak(crackle, 0.9);
  const wobble = genSmoothRandom(Math.floor(sr * 4), sr, 6);
  const chatter = genSmoothRandom(Math.floor(sr * 2), sr, 40);
  return {
    white: toBuffer(ctx, white),
    pink: toBuffer(ctx, pink),
    brown: toBuffer(ctx, brown),
    crackle: toBuffer(ctx, crackle),
    wobble: toBuffer(ctx, wobble),
    chatter: toBuffer(ctx, chatter),
  };
}

/** Minimal bank (white noise only) for offline pre-rendering. */
export function makeWhiteBank(ctx, seconds = 1.5) {
  return { white: toBuffer(ctx, genWhite(Math.floor(ctx.sampleRate * seconds))) };
}

/**
 * Stereo room impulse response: a few early reflections followed by an
 * exponentially decaying noise tail that darkens over time.
 */
export function makeImpulseResponse(ctx, seconds = 1.5, decayDb = 60, preDelay = 0.012) {
  const sr = ctx.sampleRate;
  const len = Math.max(64, Math.floor(sr * seconds));
  const ir = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(preDelay * sr);
  const n = len - pre;
  const step = Math.pow(10, -decayDb / 20 / n); // per-sample exponential decay
  const fadeFrom = Math.floor(n * 0.95);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    let env = 1;
    for (let j = 0; j < n; j++) {
      const t = j / n;
      const k = 0.12 + 0.8 * (1 - t) * (1 - t); // brightness closes over the tail
      lp += k * ((Math.random() * 2 - 1) - lp);
      const fade = j > fadeFrom ? (n - j) / (n - fadeFrom) : 1;
      d[pre + j] = lp * env * fade;
      env *= step;
    }
    // early reflections
    for (let r = 0; r < 7; r++) {
      const at = pre + Math.floor(sr * (0.004 + Math.random() * 0.06));
      if (at < len) d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.45) * (1 - r / 9);
    }
  }
  return ir;
}

// ---------------------------------------------------------------------------
// Shaper curves and periodic waves (cached)
// ---------------------------------------------------------------------------

const curveCache = new Map();
/**
 * tanh saturation curve, normalized to +-1. `asym` biases the curve to add
 * even harmonics (the bias is subtracted so silence stays silent).
 */
export function driveCurve(drive = 3, asym = 0) {
  const key = drive.toFixed(2) + ':' + asym.toFixed(3);
  let c = curveCache.get(key);
  if (c) return c;
  const n = 2048;
  c = new Float32Array(n);
  const off = Math.tanh(drive * asym);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const y = Math.tanh(drive * (x + asym)) - off;
    c[i] = y;
    if (Math.abs(y) > max) max = Math.abs(y);
  }
  for (let i = 0; i < n; i++) c[i] /= max || 1;
  curveCache.set(key, c);
  return c;
}

const waveCache = new WeakMap();
/** PeriodicWave from sine-harmonic amplitudes, e.g. [1, 0.5, 0.33]. */
export function makeWave(ctx, harmonics) {
  let m = waveCache.get(ctx);
  if (!m) {
    m = new Map();
    waveCache.set(ctx, m);
  }
  const key = harmonics.join(',');
  let w = m.get(key);
  if (w) return w;
  const real = new Float32Array(harmonics.length + 1);
  const imag = new Float32Array(harmonics.length + 1);
  for (let i = 0; i < harmonics.length; i++) imag[i + 1] = harmonics[i];
  w = ctx.createPeriodicWave(real, imag);
  m.set(key, w);
  return w;
}
