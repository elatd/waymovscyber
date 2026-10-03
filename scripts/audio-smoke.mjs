#!/usr/bin/env node
/**
 * scripts/audio-smoke.mjs - Node smoke test for src/audio/ using a strict
 * mock of the Web Audio API (no real sound). It exercises every public
 * method, every SFX, the car loops and all music tracks over several
 * simulated minutes, and reports invalid Web Audio usage (NaN params,
 * exponential ramps to 0, bad timeConstants, double start, cross-context
 * connections, ...), runtime exceptions and node leaks.
 *
 *   node scripts/audio-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const issues = [];
const notes = new Set();
const warnings = [];
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
function issue(msg) {
  if (issues.length < 300) issues.push(msg + '\n      at ' + (new Error().stack.split('\n').slice(3, 5).join(' | ').trim()));
}

// ---------------------------------------------------------------------------
// Mock Web Audio
// ---------------------------------------------------------------------------
let NOW = 0;
const contexts = [];
const stats = { nodes: 0, byKind: {}, disconnects: 0, paramEvents: 0 };
const allSources = [];

class MockAudioParam {
  constructor(node, name, value, lo = -3.4e38, hi = 3.4e38) {
    this.node = node;
    this.name = name;
    this._value = value;
    this.last = value;
    this.lo = lo;
    this.hi = hi;
    this.events = 0;
    this.lastT = 0;
    this.defaultValue = value;
    this.minValue = lo;
    this.maxValue = hi;
  }
  get id() { return `${this.node.kind}.${this.name}`; }
  get value() { return this._value; }
  set value(v) {
    if (!fin(v)) issue(`${this.id}.value = ${v}`);
    else if (v < this.lo || v > this.hi) issue(`${this.id}.value = ${v} outside [${this.lo}, ${this.hi}]`);
    this._value = v;
    this.last = v;
  }
  _ev(fn, v, t) {
    this.events++;
    stats.paramEvents++;
    if (!fin(v)) issue(`${this.id}.${fn}: bad value ${v}`);
    if (!fin(t) || t < 0) issue(`${this.id}.${fn}: bad time ${t}`);
    // events inserted before an already scheduled later event make ramps go wrong
    if (fin(t) && t < this.lastT - 1e-9) issue(`${this.id}.${fn}: non-monotonic automation (t=${t.toFixed(4)} < ${this.lastT.toFixed(4)})`);
    if (fin(t)) this.lastT = Math.max(this.lastT, t);
    if (fin(v) && (v < this.lo - 1e-6 || v > this.hi + 1e-6)) notes.add(`${this.id}.${fn}: value ${v.toFixed(1)} outside nominal range (clamped by browsers)`);
  }
  setValueAtTime(v, t) { this._ev('setValueAtTime', v, t); this.last = v; return this; }
  linearRampToValueAtTime(v, t) { this._ev('linearRamp', v, t); this.last = v; return this; }
  exponentialRampToValueAtTime(v, t) {
    this._ev('expRamp', v, t);
    if (v === 0) issue(`${this.id}.expRamp: target 0 (RangeError in browsers)`);
    if (this.last === 0) notes.add(`${this.id}.expRamp starting from 0 (would hold at 0)`);
    else if (this.last * v < 0) issue(`${this.id}.expRamp: sign change ${this.last} -> ${v}`);
    this.last = v;
    return this;
  }
  setTargetAtTime(v, t, tc) {
    this._ev('setTarget', v, t);
    if (!fin(tc) || tc <= 0) issue(`${this.id}.setTargetAtTime: bad timeConstant ${tc}`);
    this.last = v;
    return this;
  }
  setValueCurveAtTime(c, t) { this._ev('curve', 0, t); return this; }
  cancelScheduledValues(t) {
    if (!fin(t) || t < 0) issue(`${this.id}.cancel: bad time ${t}`);
    else this.lastT = Math.min(this.lastT, t);
    return this;
  }
  cancelAndHoldAtTime(t) { return this.cancelScheduledValues(t); }
}

class MockAudioNode {
  constructor(ctx, kind, inputs = 1, outputs = 1) {
    this.context = ctx;
    this.kind = kind;
    this.numberOfInputs = inputs;
    this.numberOfOutputs = outputs;
    this.channelCount = 2;
    this._out = [];
    this._disconnected = false;
    stats.nodes++;
    stats.byKind[kind] = (stats.byKind[kind] || 0) + 1;
  }
  connect(dest) {
    const isNode = dest instanceof MockAudioNode;
    const isParam = dest instanceof MockAudioParam;
    if (!isNode && !isParam) {
      issue(`${this.kind}.connect(): invalid destination ${dest}`);
      return dest;
    }
    const dctx = isNode ? dest.context : dest.node.context;
    if (dctx !== this.context) issue(`${this.kind}.connect(): destination belongs to another context`);
    if (this.numberOfOutputs < 1) issue(`${this.kind}.connect(): node has no outputs`);
    if (isNode && dest.numberOfInputs < 1) issue(`${this.kind}.connect(): ${dest.kind} has no inputs`);
    this._out.push(dest);
    this._disconnected = false;
    return dest;
  }
  disconnect() {
    this._out.length = 0;
    this._disconnected = true;
    stats.disconnects++;
  }
}

class MockScheduled extends MockAudioNode {
  constructor(ctx, kind) {
    super(ctx, kind, 0, 1);
    this._started = false;
    this._start = null;
    this._stop = null;
    this._ended = false;
    this.onended = null;
    ctx._sources.add(this);
    if (ctx instanceof MockAudioContext) allSources.push(this);
  }
  start(when = 0, offset) {
    if (this._started) issue(`${this.kind}.start() called twice`);
    if (!fin(when) || when < 0) issue(`${this.kind}.start(): bad time ${when}`);
    if (offset !== undefined && (!fin(offset) || offset < 0)) issue(`${this.kind}.start(): bad offset ${offset}`);
    this._started = true;
    this._start = when;
  }
  stop(when = 0) {
    if (!this._started) issue(`${this.kind}.stop() before start()`);
    if (!fin(when) || when < 0) issue(`${this.kind}.stop(): bad time ${when}`);
    this._stop = when;
  }
}

const OSC_TYPES = ['sine', 'square', 'sawtooth', 'triangle'];
class MockOscillator extends MockScheduled {
  constructor(ctx) {
    super(ctx, 'Oscillator');
    this.frequency = new MockAudioParam(this, 'frequency', 440, -ctx.sampleRate / 2, ctx.sampleRate / 2);
    this.detune = new MockAudioParam(this, 'detune', 0);
    this._type = 'sine';
  }
  get type() { return this._type; }
  set type(t) {
    if (!OSC_TYPES.includes(t)) issue(`Oscillator.type = ${t}`);
    this._type = t;
  }
  setPeriodicWave(w) {
    if (!(w instanceof MockPeriodicWave)) issue('setPeriodicWave(): not a PeriodicWave');
    if (w && w.context !== this.context) issue('setPeriodicWave(): wave from another context');
    this._type = 'custom';
  }
}

class MockBufferSource extends MockScheduled {
  constructor(ctx) {
    super(ctx, 'BufferSource');
    this.playbackRate = new MockAudioParam(this, 'playbackRate', 1);
    this.detune = new MockAudioParam(this, 'detune', 0);
    this.buffer = null;
    this.loop = false;
    this.loopStart = 0;
    this.loopEnd = 0;
  }
  start(when = 0, offset, duration) {
    if (!this.buffer) issue('BufferSource.start() without a buffer');
    else if (offset !== undefined && offset > this.buffer.duration) issue(`BufferSource.start(): offset ${offset} > duration ${this.buffer.duration}`);
    super.start(when, offset, duration);
  }
}

class MockConstantSource extends MockScheduled {
  constructor(ctx) {
    super(ctx, 'ConstantSource');
    this.offset = new MockAudioParam(this, 'offset', 1);
  }
}

class MockAudioBuffer {
  constructor(ch, len, sr) {
    if (!(ch >= 1 && ch <= 32) || !(len >= 1) || !(sr >= 3000 && sr <= 768000)) issue(`createBuffer(${ch}, ${len}, ${sr}) invalid`);
    this.numberOfChannels = ch;
    this.length = Math.floor(len);
    this.sampleRate = sr;
    this.duration = this.length / sr;
    this._data = Array.from({ length: ch }, () => new Float32Array(this.length));
  }
  getChannelData(c) {
    if (c >= this.numberOfChannels) issue('getChannelData(): channel out of range');
    return this._data[c];
  }
  copyToChannel(src, c, start = 0) {
    if (src.length + start > this.length) issue('copyToChannel(): source longer than buffer');
    this._data[c].set(src.subarray(0, this.length - start), start);
  }
  copyFromChannel(dst, c, start = 0) {
    dst.set(this._data[c].subarray(start, start + dst.length));
  }
}

class MockPeriodicWave {
  constructor(ctx, real, imag) {
    this.context = ctx;
    if (!real || !imag || real.length !== imag.length || real.length < 2) issue('createPeriodicWave(): bad arrays');
  }
}

const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass'];

class MockBaseContext {
  constructor(sr) {
    this.sampleRate = sr;
    this._sources = new Set();
    this.destination = new MockAudioNode(this, 'Destination', 1, 0);
    this.state = 'suspended';
    this.listener = {};
  }
  get currentTime() { return NOW; }
  createGain() {
    const n = new MockAudioNode(this, 'Gain');
    n.gain = new MockAudioParam(n, 'gain', 1);
    return n;
  }
  createOscillator() { return new MockOscillator(this); }
  createBufferSource() { return new MockBufferSource(this); }
  createConstantSource() { return new MockConstantSource(this); }
  createBiquadFilter() {
    const n = new MockAudioNode(this, 'Biquad');
    let type = 'lowpass';
    Object.defineProperty(n, 'type', {
      get: () => type,
      set: (t) => {
        if (!FILTER_TYPES.includes(t)) issue(`Biquad.type = ${t}`);
        type = t;
      },
    });
    n.frequency = new MockAudioParam(n, 'frequency', 350, 0, this.sampleRate / 2);
    n.Q = new MockAudioParam(n, 'Q', 1);
    n.gain = new MockAudioParam(n, 'gain', 0);
    n.detune = new MockAudioParam(n, 'detune', 0);
    return n;
  }
  createWaveShaper() {
    const n = new MockAudioNode(this, 'WaveShaper');
    let curve = null;
    let os = 'none';
    Object.defineProperty(n, 'curve', {
      get: () => curve,
      set: (c) => {
        if (!(c instanceof Float32Array) || c.length < 2) issue('WaveShaper.curve must be a Float32Array (len >= 2)');
        else for (let i = 0; i < c.length; i += 97) if (!fin(c[i])) { issue('WaveShaper.curve has non-finite values'); break; }
        curve = c;
      },
    });
    Object.defineProperty(n, 'oversample', {
      get: () => os,
      set: (v) => {
        if (!['none', '2x', '4x'].includes(v)) issue(`WaveShaper.oversample = ${v}`);
        os = v;
      },
    });
    return n;
  }
  createStereoPanner() {
    const n = new MockAudioNode(this, 'StereoPanner');
    n.pan = new MockAudioParam(n, 'pan', 0, -1, 1);
    return n;
  }
  createDelay(max = 1) {
    if (!(max > 0 && max < 180)) issue(`createDelay(${max})`);
    const n = new MockAudioNode(this, 'Delay');
    n.delayTime = new MockAudioParam(n, 'delayTime', 0, 0, max);
    return n;
  }
  createConvolver() {
    const n = new MockAudioNode(this, 'Convolver');
    let buf = null;
    n.normalize = true;
    Object.defineProperty(n, 'buffer', {
      get: () => buf,
      set: (b) => {
        if (!(b instanceof MockAudioBuffer)) issue('Convolver.buffer: not an AudioBuffer');
        else {
          if (![1, 2, 4].includes(b.numberOfChannels)) issue('Convolver.buffer: channel count must be 1, 2 or 4');
          if (b.sampleRate !== this.sampleRate) issue('Convolver.buffer: sample rate must match the context');
        }
        buf = b;
      },
    });
    return n;
  }
  createDynamicsCompressor() {
    const n = new MockAudioNode(this, 'Compressor');
    n.threshold = new MockAudioParam(n, 'threshold', -24, -100, 0);
    n.knee = new MockAudioParam(n, 'knee', 30, 0, 40);
    n.ratio = new MockAudioParam(n, 'ratio', 12, 1, 20);
    n.attack = new MockAudioParam(n, 'attack', 0.003, 0, 1);
    n.release = new MockAudioParam(n, 'release', 0.25, 0, 1);
    n.reduction = 0;
    return n;
  }
  createBuffer(ch, len, sr) { return new MockAudioBuffer(ch, len, sr); }
  createPeriodicWave(real, imag) { return new MockPeriodicWave(this, real, imag); }
}

class MockAudioContext extends MockBaseContext {
  constructor() {
    super(48000);
    contexts.push(this);
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

class MockOfflineAudioContext extends MockBaseContext {
  constructor(ch, len, sr) {
    super(sr);
    if (!(len >= 1)) issue(`OfflineAudioContext length ${len}`);
    this.numberOfChannels = ch;
    this.length = len;
    this.oncomplete = null;
  }
  get currentTime() { return 0; }
  startRendering() {
    const buf = new MockAudioBuffer(this.numberOfChannels, this.length, this.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(buf);
        if (typeof this.oncomplete === 'function') this.oncomplete({ renderedBuffer: buf });
      }, 2);
    });
  }
}

/** Advance the mock audio clock and fire onended for finished sources. */
function advance(dt) {
  NOW += dt;
  for (const ctx of contexts) {
    for (const s of ctx._sources) {
      if (s._stop !== null && s._stop <= NOW && !s._ended) {
        s._ended = true;
        ctx._sources.delete(s);
        if (typeof s.onended === 'function') s.onended({ target: s });
      }
    }
  }
}

// document mock for visibilitychange
const docListeners = {};
globalThis.document = {
  hidden: false,
  addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
  removeEventListener(type, fn) { docListeners[type] = (docListeners[type] || []).filter((f) => f !== fn); },
};
const dispatchDoc = (type) => (docListeners[type] || []).forEach((fn) => fn({ type }));

const origWarn = console.warn;
console.warn = (...args) => warnings.push(args.map(String).join(' '));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
const tick = () => new Promise((r) => setTimeout(r, 0));
const SFX_NAMES = [
  'crash', 'bump', 'scrape', 'break_plastic', 'break_metal', 'break_wood', 'glass', 'hydrant', 'land', 'jump', 'splash',
  'horn', 'horn_player', 'boost_start', 'pickup', 'deliver', 'cash', 'tip', 'combo', 'near_miss', 'fail', 'rival_steal',
  'countdown', 'go', 'tick', 'time_bonus', 'game_over', 'ui_move', 'ui_select', 'ui_back', 'lidar_pulse', 'ludicrous',
  'cable_bell', 'seagull', 'whoosh',
];
function check(cond, msg) {
  if (!cond) issue('ASSERT: ' + msg);
}

const { AudioManager } = await import(path.join(ROOT, 'src/audio/AudioManager.js'));
const { SFX } = await import(path.join(ROOT, 'src/audio/sfx/index.js'));
const { Phrase } = await import(path.join(ROOT, 'src/audio/music/track.js'));

// 0) every required name exists, no extras missing
for (const n of SFX_NAMES) check(typeof SFX[n] === 'function', `SFX "${n}" missing`);
for (const n of Object.keys(SFX)) check(SFX_NAMES.includes(n), `unexpected export "${n}" in SFX registry`);

// 0b) melody phrases: every bar must add up to 16 sixteenths
for (const f of ['songGame.js', 'songMenu.js', 'songResults.js']) {
  const src = readFileSync(path.join(ROOT, 'src/audio/music', f), 'utf8');
  for (const m of src.matchAll(/new Phrase\(`([^`]*)`\)/g)) {
    m[1].split('|').forEach((bar, i) => {
      const p = new Phrase(bar);
      if (p.length !== 16) issue(`${f}: phrase bar ${i + 1} has ${p.length} steps: "${bar.trim()}"`);
    });
  }
}

// 1) no Web Audio at all
{
  const a = new AudioManager();
  check(a.supported === false, 'supported should be false without Web Audio');
  a.setVolumes({ master: 0.5 });
  a.playMusic('menu');
  a.setMusicIntensity(0.5);
  a.updateCar({ speed: 10 });
  a.stopCar();
  a.play('crash');
  a.setPaused(true);
  a.stopMusic();
  const ok = await a.unlock();
  check(ok === false, 'unlock() should resolve false without Web Audio');
  a.play('crash');
  a.dispose();
}

// 2) with the mock
globalThis.AudioContext = MockAudioContext;
globalThis.OfflineAudioContext = MockOfflineAudioContext;
const a = new AudioManager();
check(contexts.length === 0, 'constructor must not create an AudioContext');
a.setVolumes({ master: 0.8, music: 0.6, sfx: 0.9 });
a.setVolumes({ music: NaN, sfx: 7 });
a.playMusic('menu');
a.play('crash');
a.updateCar({ speed: 0 });
a.setMusicIntensity(0.2);
check(contexts.length === 0, 'calls before unlock must not create an AudioContext');
const ok1 = await a.unlock();
const [ok2, ok3] = await Promise.all([a.unlock(), a.unlock()]);
check(ok1 && ok2 && ok3, 'unlock() should resolve true');
check(contexts.length === 1, 'exactly one AudioContext');
await a.lib.kits.rock.promise;
await a.lib.kits.electro.promise;
check(a.lib.kits.rock.ready && a.lib.kits.electro.ready, 'drum kits pre-rendered');
check(a.music.currentName === 'menu', 'menu requested before unlock should be playing');

const fps = 60;
let carT = 0;
function carState(t, type) {
  const phase = Math.floor(t / 6) % 6;
  const speed = Math.max(0, 25 + 22 * Math.sin(t * 0.4) + (phase === 4 ? 20 : 0));
  return {
    speed,
    maxSpeed: 45,
    throttle: (Math.sin(t * 1.3) + 1) / 2,
    brake: phase === 2 ? (Math.sin(t * 3) + 1) / 2 : 0,
    drift: phase === 1 ? (Math.sin(t * 2) + 1) / 2 : 0.05,
    grounded: !(phase === 3 && t % 6 < 1.5),
    boost: phase === 4,
    ludicrous: phase === 5 && type === 'cybercab',
    carType: type,
    surface: ['road', 'road', 'grass', 'dirt'][Math.floor(t / 4) % 4],
  };
}

let updates = 0;
let carOnlyEvents = 0;
let updateMs = 0;
async function simulate(seconds, { car = false, type = 'waymo', sfxRate = 0 } = {}) {
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) {
    advance(1 / fps);
    if (car) {
      const s = carState(carT, type);
      const t0 = performance.now();
      a.updateCar(s);
      updateMs += performance.now() - t0;
      updates++;
      carT += 1 / fps;
    }
    if (a.music) a.music._tick();
    if (sfxRate && Math.random() < sfxRate) {
      const n = SFX_NAMES[(Math.random() * SFX_NAMES.length) | 0];
      a.play(n, { volume: Math.random(), pan: Math.random() * 2 - 1, rate: 0.8 + Math.random() * 0.4, intensity: Math.random() });
    }
    if (i % 30 === 0) await tick();
  }
}

await simulate(20);

// every sound, default and with options
for (const n of SFX_NAMES) {
  a.play(n);
  advance(0.3);
  a.play(n, { volume: 0.5, pan: -0.7, rate: 1.3, intensity: 0.2 });
  advance(0.3);
  a.play(n, { volume: 1.5, pan: 1, rate: 0.6, intensity: 1 });
  advance(0.5);
}
a.play('does_not_exist');
a.play('does_not_exist');
a.play('crash', { volume: 'loud', pan: null, rate: -5, intensity: 9 });
check(warnings.filter((w) => w.includes('does_not_exist')).length === 1, 'unknown sound should warn exactly once');

// voice caps
for (let i = 0; i < 100; i++) {
  a.play(SFX_NAMES[i % SFX_NAMES.length]);
  advance(0.001);
}
check(a._voices.length <= 24, `global voice cap exceeded: ${a._voices.length}`);
for (let i = 0; i < 12; i++) {
  a.play('horn');
  advance(0.12);
}
check(a._voices.filter((v) => v.name === 'horn' && !v.ended).length <= 3, 'horn cap (3) exceeded');
const tipsBefore = a._voices.filter((v) => v.name === 'tip').length;
a.play('tip');
a.play('tip');
a.play('tip');
check(a._voices.filter((v) => v.name === 'tip').length - tipsBefore <= 1, 'tip should be debounced');
await simulate(5);

// game music + car
a.playMusic('game');
const gameTrack = a.music.current;
a.playMusic('game');
check(a.music.current === gameTrack, 'playMusic(same) must be a no-op');
const evBefore = stats.paramEvents;
const upBefore = updates;
await simulate(120, { car: true, type: 'waymo', sfxRate: 0.03 });
a.setMusicIntensity(1);
a.setPaused(true);
await simulate(2, { car: true, type: 'waymo' });
a.setPaused(false);
await simulate(60, { car: true, type: 'cybercab', sfxRate: 0.03 });
const carEventsPerFrame = (stats.paramEvents - evBefore) / (updates - upBefore);
{
  // automation events issued by the car graph alone
  let carEv = 0;
  const seen = new Set();
  const walk = (obj) => {
    for (const v of Object.values(obj)) {
      if (v instanceof MockAudioNode && !seen.has(v)) {
        seen.add(v);
        for (const p of Object.values(v)) if (p instanceof MockAudioParam) carEv += p.events;
      }
    }
  };
  for (const nd of a.car.nodes) walk({ nd });
  carOnlyEvents = carEv / Math.max(1, updates);
}
a.setMusicIntensity(0);
await simulate(130, { car: true, type: 'cybercab' }); // long enough to loop the song (key lift)

// stopCar then menu-style updates with speed 0 must stay silent
a.stopCar();
await simulate(2);
a.updateCar({ speed: 0, throttle: 0 });
check(a.car.active === false, 'car loops should stay stopped after stopCar() with idle state');
a.updateCar({ speed: 5, throttle: 0.5 });
check(a.car.active === true, 'driving input should re-activate the car loops');
a.stopCar();

// results
a.playMusic('results');
await simulate(45);
check(a.music.tracks.length === 1, `old tracks should be disposed after the crossfade (have ${a.music.tracks.length})`);

// visibility
document.hidden = true;
dispatchDoc('visibilitychange');
await tick();
check(a.ctx.state === 'suspended', 'context should suspend when hidden');
document.hidden = false;
dispatchDoc('visibilitychange');
await tick();
check(a.ctx.state === 'running', 'context should resume when visible');

a.stopMusic();
a.playMusic('nope');
await simulate(3);
check(a.music.tracks.length === 0, 'stopMusic should dispose the track after the fade');
check(a.music.timer === null, 'scheduler timer should stop when no track plays');

// let every voice finish, then look for leaks: every source that has ended
// must have been disconnected by its voice / drum-hit cleanup
await simulate(5);
let ended = 0;
let leaked = 0;
for (const s of allSources) {
  if (!s._ended) continue;
  ended++;
  if (!s._disconnected) leaked++;
}
check(leaked === 0, `${leaked} ended sources were never disconnected`);
check(a._voices.length === 0, `voices should be released after they end (have ${a._voices.length})`);

a.dispose();
a.play('crash');
a.updateCar({ speed: 20 });
a.playMusic('game');
a.setPaused(true);
a.setVolumes({ master: 1 });
await a.unlock();

// ---------------------------------------------------------------------------
console.warn = origWarn;
const kinds = Object.entries(stats.byKind).map(([k, v]) => `${k}:${v}`).join(' ');
console.log(`nodes created: ${stats.nodes} (${kinds})`);
console.log(`disconnect() calls: ${stats.disconnects}, param automation events: ${stats.paramEvents}`);
console.log(`car: ${updates} updateCar() calls, ${(updateMs / Math.max(1, updates) * 1000).toFixed(1)} us/call (mock), ~${carEventsPerFrame.toFixed(2)} automation events/frame (car + music + sfx), car graph alone ~${carOnlyEvents.toFixed(2)}/frame`);
console.log(`ended=${ended} leaked=${leaked}`);
if (warnings.length) console.log('console.warn:\n  ' + [...new Set(warnings)].join('\n  '));
if (notes.size) console.log('notes:\n  ' + [...notes].slice(0, 20).join('\n  '));
if (issues.length) {
  console.log(`\n${issues.length} ISSUE(S):\n  ` + issues.slice(0, 60).join('\n  '));
  process.exit(1);
}
console.log('\naudio smoke test: OK');
process.exit(0);
