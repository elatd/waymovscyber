/**
 * voice.js - envelope helpers and the Voice class.
 *
 * A Voice is one short-lived sound event (an SFX one-shot or a music note).
 * It creates Web Audio nodes through helper methods, remembers them, and
 * disconnects everything once its last source has ended (`onended`), so
 * callers never leak nodes. It also offers a few composite "recipes"
 * (tone, noiseHit, ticks, pings, partials, sweepNoise) that keep the SFX
 * definitions short.
 */
import { clamp, driveCurve, bpComp } from './dsp.js';

/** Attack -> exponential decay that lands exactly on 0. Returns end time. */
export function envPerc(param, t, peak, attack, decay) {
  param.setValueAtTime(0, t);
  if (!(peak > 0)) return t + attack + decay;
  const a = Math.max(0.0005, attack);
  const d = Math.max(0.005, decay);
  param.linearRampToValueAtTime(peak, t + a);
  param.exponentialRampToValueAtTime(peak * 0.001, t + a + d);
  param.linearRampToValueAtTime(0, t + a + d + 0.004);
  return t + a + d + 0.004;
}

/**
 * ADSR: linear attack, exponential approach to `sus * peak` (time constant
 * dTau), and an exact linear release starting at t + dur. Returns end time.
 */
export function envADSR(param, t, dur, peak, attack, dTau, sus, release) {
  param.setValueAtTime(0, t);
  const a = Math.max(0.0005, Math.min(attack, Math.max(dur, 0.001)));
  const r = Math.max(0.004, release);
  if (!(peak > 0)) return t + Math.max(dur, a) + r;
  param.linearRampToValueAtTime(peak, t + a);
  let relT = t + a;
  if (dur > a + 0.001) {
    const tau = Math.max(0.002, dTau);
    const s = peak * sus;
    param.setTargetAtTime(s, t + a, tau);
    const vRel = s + (peak - s) * Math.exp(-(dur - a) / tau);
    relT = t + dur;
    param.setValueAtTime(vRel, relT);
  }
  param.linearRampToValueAtTime(0, relT + r);
  return relT + r;
}

/**
 * Several percussive envelopes on ONE param (used to retrigger a single
 * source many times). Events: sorted array of { t, peak, a, d }. Each decay
 * is truncated so it reaches 0 before the next event starts (no clicks).
 */
export function envSeq(param, events) {
  param.setValueAtTime(0, events.length ? events[0].t : 0);
  let end = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const next = i + 1 < events.length ? events[i + 1].t : Infinity;
    const a = Math.max(0.0005, e.a);
    if (e.t < end || e.t + a + 0.003 > next || !(e.peak > 0)) continue;
    const stop = Math.min(e.t + a + e.d, next - 0.0015);
    param.setValueAtTime(0, e.t);
    param.linearRampToValueAtTime(e.peak, e.t + a);
    if (stop - 0.001 > e.t + a) param.exponentialRampToValueAtTime(e.peak * 0.01, stop - 0.001);
    param.linearRampToValueAtTime(0, stop);
    end = stop;
  }
  return end;
}

export class Voice {
  /**
   * @param {object} lib   shared audio library: { ctx, noise, sfxReverb? }
   * @param {AudioNode} dest  where the voice output connects
   * @param {number} t     start time (context seconds)
   * @param {object} [o]   { gain = 1, pan = 0, reverb: AudioNode for sends }
   */
  constructor(lib, dest, t, o) {
    this.lib = lib;
    this.ctx = lib.ctx;
    this.t = t;
    this.end = t;
    this.nodes = [];
    this.srcs = [];
    this.stops = [];
    this.ended = false;
    this.onEnd = null;
    this.revDest = (o && o.reverb) || null;
    this.level = o && typeof o.gain === 'number' ? o.gain : 1;
    this._rev = null;
    this.out = this.gain(this.level);
    const pan = o && o.pan ? clamp(o.pan, -1, 1) : 0;
    if (pan !== 0 && this.ctx.createStereoPanner) {
      const p = this.track(this.ctx.createStereoPanner());
      p.pan.value = pan;
      this.out.connect(p);
      p.connect(dest);
    } else {
      this.out.connect(dest);
    }
  }

  // ---- node factories -----------------------------------------------------
  track(n) {
    this.nodes.push(n);
    return n;
  }
  gain(v = 1) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return this.track(g);
  }
  filter(type, f, q = 0.707, g = 0) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    if (g) b.gain.value = g;
    return this.track(b);
  }
  lp(f, q = 0.707) { return this.filter('lowpass', f, q); }
  hp(f, q = 0.707) { return this.filter('highpass', f, q); }
  bp(f, q = 1) { return this.filter('bandpass', f, q); }
  peak(f, q, g) { return this.filter('peaking', f, q, g); }
  shaper(drive = 3, asym = 0) {
    const s = this.ctx.createWaveShaper();
    s.curve = driveCurve(drive, asym);
    s.oversample = '2x';
    return this.track(s);
  }
  panner(p = 0) {
    if (!this.ctx.createStereoPanner) return this.gain(1);
    const n = this.track(this.ctx.createStereoPanner());
    n.pan.value = clamp(p, -1, 1);
    return n;
  }
  delay(time, max = 1) {
    const d = this.track(this.ctx.createDelay(max));
    d.delayTime.value = time;
    return d;
  }
  /** Connect nodes in series; returns the last one. */
  chain(...nodes) {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1];
  }

  // ---- sources ------------------------------------------------------------
  _src(node, t, stop, offset) {
    if (offset !== undefined) node.start(t, offset);
    else node.start(t);
    node.stop(stop);
    this.srcs.push(node);
    this.stops.push(stop);
    this.track(node);
    if (stop > this.end) this.end = stop;
    return node;
  }
  /** Oscillator started at t for dur seconds. `type` may be a PeriodicWave. */
  osc(type, f, t = this.t, dur = 1, detune = 0) {
    const o = this.ctx.createOscillator();
    if (typeof type === 'string') o.type = type;
    else o.setPeriodicWave(type);
    o.frequency.setValueAtTime(f, t);
    if (detune) o.detune.setValueAtTime(detune, t);
    return this._src(o, t, t + Math.max(0.01, dur));
  }
  /** Looping noise from the shared bank, random start offset. */
  noise(kind = 'white', t = this.t, dur = 1, rate = 1) {
    const buf = this.lib.noise[kind] || this.lib.noise.white;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    return this._src(s, t, t + Math.max(0.01, dur), Math.random() * buf.duration * 0.9);
  }
  /** Play an AudioBuffer once. */
  buffer(buf, t = this.t, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    return this._src(s, t, t + buf.duration / Math.max(0.05, rate) + 0.01);
  }
  /** Send `node` to the reverb (post voice level, pre pan). */
  send(node, amount) {
    if (!this.revDest || !(amount > 0)) return;
    if (!this._rev) {
      this._rev = this.gain(this.level);
      this._rev.connect(this.revDest);
    }
    const g = this.gain(amount);
    node.connect(g);
    g.connect(this._rev);
  }

  // ---- composite recipes --------------------------------------------------
  /** Single oscillator with optional glide and a percussive envelope. */
  tone({ type = 'sine', f = 440, f2 = 0, glide = 0, at = 0, a = 0.004, d = 0.3, peak = 0.5, detune = 0, to = this.out, rev = 0 }) {
    const t = this.t + at;
    const o = this.osc(type, f, t, a + d + 0.02, detune);
    if (f2 > 0 && glide > 0) o.frequency.exponentialRampToValueAtTime(f2, t + glide);
    const g = this.gain(0);
    envPerc(g.gain, t, peak, a, d);
    o.connect(g);
    g.connect(to);
    if (rev) this.send(g, rev);
    return o;
  }

  /** Filtered noise burst. type: lowpass|highpass|bandpass (bandpass is level-compensated). */
  noiseHit({ kind = 'white', at = 0, a = 0.001, d = 0.1, peak = 0.5, type = 'bandpass', f = 1000, f2 = 0, glide = 0, q = 1, rate = 1, to = this.out, rev = 0 }) {
    const t = this.t + at;
    const s = this.noise(kind, t, a + d + 0.02, rate);
    const filt = this.filter(type, f, q);
    if (f2 > 0 && glide > 0) {
      filt.frequency.setValueAtTime(f, t);
      filt.frequency.exponentialRampToValueAtTime(f2, t + glide);
    }
    const g = this.gain(0);
    const comp = type === 'bandpass' && kind === 'white' ? bpComp(f, q) : 1;
    envPerc(g.gain, t, peak * comp, a, d);
    this.chain(s, filt, g, to);
    if (rev) this.send(g, rev);
    return g;
  }

  /** Many short noise ticks through one source/filter (debris, rattles, crackle). */
  ticks({ kind = 'white', times, peaks, peak = 0.3, a = 0.001, d = 0.03, type = 'bandpass', f = 3000, q = 3, to = this.out, rev = 0 }) {
    if (!times || !times.length) return null;
    const ev = times.map((tt, i) => ({ t: this.t + tt, peak: peak * (peaks ? peaks[i % peaks.length] : 1), a, d })).sort((x, y) => x.t - y.t);
    const last = ev[ev.length - 1].t + a + d + 0.02;
    const s = this.noise(kind, ev[0].t, last - ev[0].t);
    const filt = this.filter(type, f, q);
    const comp = type === 'bandpass' && kind === 'white' ? bpComp(f, q) : 1;
    for (const e of ev) e.peak *= comp;
    const g = this.gain(0);
    envSeq(g.gain, ev);
    this.chain(s, filt, g, to);
    if (rev) this.send(g, rev);
    return g;
  }

  /**
   * Many pitched pings (glass shards, bubbles, sparkles) using `poly`
   * round-robin oscillators. `glide` = frequency ratio reached at the end of each ping.
   */
  pings({ type = 'sine', times, freqs, peaks, peak = 0.1, a = 0.001, d = 0.08, glide = 0, poly = 3, to = this.out, rev = 0 }) {
    if (!times || !times.length) return null;
    const ev = times.map((tt, i) => ({ t: this.t + tt, f: freqs[i % freqs.length], peak: peak * (peaks ? peaks[i % peaks.length] : 1), a, d: Array.isArray(d) ? d[i % d.length] : d }));
    ev.sort((x, y) => x.t - y.t);
    const bus = this.gain(1);
    bus.connect(to);
    if (rev) this.send(bus, rev);
    const n = Math.min(poly, ev.length);
    for (let k = 0; k < n; k++) {
      const mine = ev.filter((_, i) => i % n === k);
      const t0 = mine[0].t;
      const tEnd = mine[mine.length - 1].t + a + mine[mine.length - 1].d + 0.02;
      const o = this.osc(type, mine[0].f, t0, tEnd - t0);
      for (let j = 0; j < mine.length; j++) {
        const e = mine[j];
        o.frequency.setValueAtTime(e.f, e.t);
        if (glide > 0) {
          // keep the timeline monotonic: the glide ends before this oscillator's next ping
          const next = j + 1 < mine.length ? mine[j + 1].t - 0.002 : Infinity;
          const end = Math.min(e.t + e.a + e.d, next);
          if (end > e.t + 0.001) o.frequency.exponentialRampToValueAtTime(e.f * glide, end);
        }
      }
      const g = this.gain(0);
      envSeq(g.gain, mine);
      o.connect(g);
      g.connect(bus);
    }
    return bus;
  }

  /** Bank of decaying sine partials (metal clangs, bells, chimes). */
  partials({ f0, ratios, amps, decays, at = 0, a = 0.001, peak = 0.2, type = 'sine', to = this.out, rev = 0 }) {
    const t = this.t + at;
    const bus = this.gain(peak);
    bus.connect(to);
    if (rev) this.send(bus, rev);
    for (let i = 0; i < ratios.length; i++) {
      const f = f0 * ratios[i];
      if (f > this.ctx.sampleRate * 0.45) continue;
      const d = decays[i % decays.length];
      const o = this.osc(type, f, t, a + d + 0.02, (Math.random() - 0.5) * 6);
      const g = this.gain(0);
      envPerc(g.gain, t, amps[i % amps.length], a, d);
      o.connect(g);
      g.connect(bus);
    }
    return bus;
  }

  /**
   * Noise through a filter whose frequency follows `freqs` ([[time, Hz], ...],
   * exponential) and whose level follows `gains` ([[time, gain], ...], linear).
   * Times are relative to the voice start + at.
   */
  sweepNoise({ kind = 'white', at = 0, dur = 0.5, type = 'bandpass', q = 1, freqs, gains, rate = 1, to = this.out, rev = 0 }) {
    const t = this.t + at;
    const s = this.noise(kind, t, dur + 0.02, rate);
    const filt = this.filter(type, freqs[0][1], q);
    filt.frequency.setValueAtTime(freqs[0][1], t + freqs[0][0]);
    for (let i = 1; i < freqs.length; i++) filt.frequency.exponentialRampToValueAtTime(Math.max(20, freqs[i][1]), t + freqs[i][0]);
    let fMax = 20;
    for (let i = 0; i < freqs.length; i++) fMax = Math.max(fMax, freqs[i][1]);
    const comp = type === 'bandpass' && kind === 'white' ? bpComp(fMax, q) : 1;
    const g = this.gain(0);
    g.gain.setValueAtTime(gains[0][1] * comp, t + gains[0][0]);
    for (let i = 1; i < gains.length; i++) g.gain.linearRampToValueAtTime(gains[i][1] * comp, t + gains[i][0]);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.01);
    this.chain(s, filt, g, to);
    if (rev) this.send(g, rev);
    return g;
  }

  // ---- lifecycle ----------------------------------------------------------
  /** Call after building: cleans everything up when the last source ends. */
  done(cb) {
    this.onEnd = cb || null;
    if (!this.srcs.length) {
      this._cleanup();
      return this;
    }
    let li = 0;
    for (let i = 1; i < this.stops.length; i++) if (this.stops[i] > this.stops[li]) li = i;
    this.srcs[li].onended = () => this._cleanup();
    return this;
  }

  /** Quickly fade out and stop (voice stealing). */
  kill(t, fade = 0.03) {
    if (this.ended) return;
    const g = this.out.gain;
    try {
      g.cancelScheduledValues(t);
      g.setValueAtTime(this.level, t);
      g.linearRampToValueAtTime(0, t + fade);
    } catch (e) { /* ignore */ }
    const stopAt = t + fade + 0.01;
    for (let i = 0; i < this.srcs.length; i++) {
      if (this.stops[i] > stopAt) {
        try {
          this.srcs[i].stop(stopAt);
          this.stops[i] = stopAt;
        } catch (e) { /* already stopped */ }
      }
    }
    this.end = Math.min(this.end, stopAt);
  }

  _cleanup() {
    if (this.ended) return;
    this.ended = true;
    for (let i = 0; i < this.nodes.length; i++) {
      try { this.nodes[i].disconnect(); } catch (e) { /* ignore */ }
    }
    for (let i = 0; i < this.srcs.length; i++) this.srcs[i].onended = null;
    this.nodes.length = 0;
    this.srcs.length = 0;
    this.stops.length = 0;
    const cb = this.onEnd;
    this.onEnd = null;
    if (cb) cb(this);
  }
}

