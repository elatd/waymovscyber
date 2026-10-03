/**
 * music/track.js - base class for a procedural song plus a tiny melody
 * notation parser.
 *
 * Scheduling follows "A Tale of Two Clocks": the MusicPlayer's setInterval
 * calls schedule(until) and the track emits every 16th-note step whose time
 * falls before `until`, on the AudioContext clock.
 */
import { makeRng, noteToMidi } from '../dsp.js';

/**
 * Melody phrase from text: 'G#4:3 G#4:3 A4:2 | B4:8 r:8'. Durations are in
 * 16th-note steps, 'r' is a rest, '|' is ignored (bar marker for readability).
 */
export class Phrase {
  constructor(text) {
    this.at = new Map();
    let step = 0;
    for (const tok of text.trim().split(/\s+/)) {
      if (!tok || tok === '|') continue;
      const [name, d] = tok.split(':');
      const dur = parseFloat(d || '1');
      if (name !== 'r') {
        const midi = noteToMidi(name);
        if (!Number.isNaN(midi)) {
          if (!this.at.has(step)) this.at.set(step, []);
          this.at.get(step).push({ midi, dur });
        }
      }
      step += dur;
    }
    this.length = step;
  }
  /** Notes starting at `step` (16ths from the phrase start) or undefined. */
  get(step) {
    return this.at.get(step);
  }
}

export class Track {
  /**
   * @param {object} lib  shared audio library ({ ctx, musicReverb, kits, ... })
   * @param {AudioNode} dest  music bus input
   * @param {object} o  { bpm, swing (0..0.3 of a 16th), level, seed }
   */
  constructor(lib, dest, { bpm = 120, swing = 0, level = 0.5, seed = 1 } = {}) {
    this.lib = lib;
    this.ctx = lib.ctx;
    this.bpm = bpm;
    this.stepDur = 60 / bpm / 4;
    this.swing = swing;
    this.level = level;
    this.rng = makeRng(seed);
    this.nodes = [];
    this.insts = [];
    this.intensity = 0;
    this.step = 0;
    this.nextTime = 0;
    this.state = 'idle';
    this.stopAt = Infinity;
    this.cur = null;
    this.nxt = null;
    this._warned = false;

    // track fader -> tone filter -> intensity lift -> music bus
    this.bus = this.g(0);
    this.tone = this.ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 18000;
    this.tone.Q.value = 0.5;
    this.nodes.push(this.tone);
    this.lift = this.g(1);
    this.bus.connect(this.tone);
    this.tone.connect(this.lift);
    this.lift.connect(dest);
    // reverb sends of this track's instruments fade together with the track
    this.wet = this.g(0);
    if (lib.musicReverb) this.wet.connect(lib.musicReverb);
  }

  g(v = 1) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    this.nodes.push(g);
    return g;
  }

  add(inst) {
    this.insts.push(inst);
    return inst;
  }

  /** Mixer channel: gain -> pan -> bus (+ optional reverb send). Used for drums. */
  channel(level, pan = 0, rev = 0) {
    const g = this.g(level);
    let tail = g;
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      this.nodes.push(p);
      g.connect(p);
      tail = p;
    }
    tail.connect(this.bus);
    if (rev > 0) {
      const s = this.g(rev);
      tail.connect(s);
      s.connect(this.wet);
    }
    return g;
  }

  /** Song form: array of sections { name, bars, ... }; loops back to section index `loopFrom`. */
  setForm(form, loopFrom = 0) {
    this.bars = [];
    this.loopStartBar = 0;
    form.forEach((sec, si) => {
      if (si === loopFrom) this.loopStartBar = this.bars.length;
      for (let b = 0; b < sec.bars; b++) this.bars.push({ sec, barIn: b, cycle: 0 });
    });
  }

  /** Absolute bar index -> { sec, barIn, cycle } (cycle counts loop repeats). */
  barInfo(b) {
    const n = this.bars.length;
    if (b < n) return this.bars[b];
    const loopLen = n - this.loopStartBar;
    const k = b - n;
    const base = this.bars[this.loopStartBar + (k % loopLen)];
    return { sec: base.sec, barIn: base.barIn, cycle: 1 + Math.floor(k / loopLen) };
  }

  start(t, fade) {
    this.nextTime = t;
    this.state = 'playing';
    const now = this.ctx.currentTime;
    for (const [p, v] of [[this.bus.gain, this.level], [this.wet.gain, 1]]) {
      p.cancelScheduledValues(now);
      p.setValueAtTime(0, now);
      p.setValueAtTime(0, t);
      p.linearRampToValueAtTime(v, t + Math.max(0.02, fade));
    }
  }

  fadeOut(t, fade) {
    if (this.state === 'stopping') return;
    this.state = 'stopping';
    this.stopAt = t + fade;
    for (const p of [this.bus.gain, this.wet.gain]) {
      if (typeof p.cancelAndHoldAtTime === 'function') {
        p.cancelAndHoldAtTime(t);
      } else {
        const v = p.value;
        p.cancelScheduledValues(t);
        p.setValueAtTime(v, t);
      }
      p.linearRampToValueAtTime(0, t + fade);
    }
  }

  /** Emit every step whose time is before `until`. */
  schedule(until, now) {
    if (this.state === 'idle') return;
    if (this.nextTime < now - 0.2) {
      // the timer stalled (background tab): skip ahead instead of bursting notes
      const skip = Math.ceil((now - this.nextTime) / this.stepDur);
      this.step += skip;
      this.nextTime += skip * this.stepDur;
    }
    while (this.nextTime < until) {
      const s = this.step;
      const t = this.nextTime + (s & 1 ? this.swing * this.stepDur : 0);
      const bar = Math.floor(s / 16);
      if (s % 16 === 0 || !this.cur) {
        this.cur = this.barInfo(bar);
        this.nxt = this.barInfo(bar + 1);
      }
      try {
        this.onStep(s % 16, bar, t);
      } catch (e) {
        if (!this._warned) console.warn('[audio] music step error', e);
        this._warned = true;
      }
      this.step++;
      this.nextTime += this.stepDur;
    }
  }

  setIntensity(x, now) {
    this.intensity = x;
    this.onIntensity(x, now);
  }

  /** Small timing jitter (seconds) for humanization. */
  hum(amount = 0.006) {
    return (this.rng() - 0.5) * amount;
  }

  /** Velocity jitter around v. */
  vel(v, amount = 0.12) {
    return v * (1 - amount / 2 + this.rng() * amount);
  }

  // ---- overridables ---------------------------------------------------
  onStep(/* st, bar, t */) {}
  onIntensity(/* x, now */) {}

  dispose() {
    this.state = 'idle';
    for (const i of this.insts) i.dispose();
    for (const nd of this.nodes) {
      try { nd.disconnect(); } catch (e) { /* ignore */ }
    }
    this.insts.length = 0;
    this.nodes.length = 0;
  }
}
