/**
 * AudioManager.js - the game's single audio entry point (100% synthesized,
 * Web Audio API only, no asset files).
 *
 *   const audio = new AudioManager();   // no AudioContext yet (autoplay policy)
 *   await audio.unlock();               // on the first user gesture
 *   audio.playMusic('menu'); audio.play('crash', { intensity: 0.8 }); ...
 *
 * Graph:
 *   SFX voices / car loops -> sfxIn -> sfxVol ------------------------\
 *   music tracks -> musicIn -> compressor -> musicVol -> duck -> LP ---+-> master -> limiter -> out
 *   reverb sends (sfx, music) -> send volumes -> convolver -> return --/
 *
 * Every public method is a safe no-op before unlock() succeeds or when Web
 * Audio is unavailable; nothing here throws to the caller.
 *
 * "My music": setPlaylist(files) + setMusicSource('mine') swaps the synthesized
 * score for the player's own local audio files (shuffled, through the music bus
 * so the volume slider and pause muffle still apply).
 */
import { clamp, num, makeNoiseBank, makeImpulseResponse } from './dsp.js';
import { Voice } from './voice.js';
import { SFX, LIMITS, DEFAULT_LIMIT, TRIM } from './sfx/index.js';
import { CarSound } from './engine.js';
import { MusicPlayer } from './music/player.js';
import { DrumKit } from './music/drums.js';

/**
 * Mix trims (tweak here). Volume sliders map to gain = value^2 x trim.
 * Calibrated with offline renders: at the default volumes, music and the car
 * loops sit around -22 dBFS RMS and big impacts peak near -3 dBFS (limiter).
 */
export const MIX = {
  master: 1.8,
  sfx: 1.0,
  music: 0.85,
  reverbReturn: 0.75,
  pauseDuck: 0.3,
  pauseLowpass: 1100,
};

const MAX_VOICES = 24;
const MUSIC_NAMES = ['menu', 'game', 'results'];

function getAudioContextClass() {
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  const w = g.window || g;
  return w.AudioContext || w.webkitAudioContext || null;
}

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const id = setTimeout(resolve, ms);
    Promise.resolve(promise).then(
      () => {
        clearTimeout(id);
        resolve();
      },
      () => {
        clearTimeout(id);
        resolve();
      },
    );
  });
}

const perceptual = (x) => x * x;

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.failed = false;
    this.disposed = false;
    this.paused = false;
    this.volumes = { master: 0.8, music: 0.6, sfx: 0.9 };
    this._musicWanted = null;
    this._intensity = 0;
    this._voices = [];
    this._lastPlay = Object.create(null);
    this._warned = new Set();
    this._unlocking = null;
    this._hiddenSuspended = false;
    this._onVisibility = null;
    this.musicSource = 'game';
    this.onTrack = null; // (name) when one of the player's songs starts
    this._tracks = [];
    this._order = [];
    this._ti = -1;
    this._cur = null;
    this._el = null;
    this._errors = 0;
  }

  /** True if this browser has Web Audio at all. */
  get supported() {
    return !!getAudioContextClass();
  }

  /**
   * Create (first call) and resume the AudioContext. Call from a user
   * gesture; safe to call any number of times. Resolves true when running.
   */
  async unlock() {
    if (this.disposed || this.failed) return false;
    try {
      if (!this.ctx && !this._create()) return false;
      const ctx = this.ctx;
      this._primeIOS();
      if (ctx.state === 'running') return true;
      if (!this._unlocking) {
        this._unlocking = withTimeout(ctx.resume(), 1500).then(() => {
          this._unlocking = null;
          return this.ctx ? this.ctx.state === 'running' : false;
        });
      }
      return await this._unlocking;
    } catch (e) {
      this._err('unlock', e);
      return false;
    }
  }

  /** Any subset of { master, music, sfx }, each 0..1. */
  setVolumes(v) {
    try {
      if (!v || typeof v !== 'object') return;
      for (const k of ['master', 'music', 'sfx']) {
        if (typeof v[k] === 'number' && Number.isFinite(v[k])) this.volumes[k] = clamp(v[k]);
      }
      if (this.ready) this._applyVolumes();
    } catch (e) {
      this._err('setVolumes', e);
    }
  }

  /** Crossfade (~1 s) to 'menu' | 'game' | 'results'. Same track = no-op. */
  playMusic(name) {
    try {
      if (!MUSIC_NAMES.includes(name)) {
        this._warnOnce('music:' + name, `[audio] unknown music track "${name}"`);
        return;
      }
      this._musicWanted = name; // remembered so it starts on unlock if requested earlier
      if (!this.ready) return;
      if (this.musicSource === 'external') {
        this.music.stop(0.8);
        return;
      }
      if (this._mineActive()) {
        this.music.stop(0.8);
        this._resumeMine();
      } else this.music.play(name);
    } catch (e) {
      this._err('playMusic', e);
    }
  }

  stopMusic() {
    try {
      this._musicWanted = null;
      if (this.ready) this.music.stop(0.8);
      this._pauseMine();
    } catch (e) {
      this._err('stopMusic', e);
    }
  }

  /** 0..1: raises the game track's energy (open hats, crashes, arp layer, brighter). */
  setMusicIntensity(x) {
    try {
      this._intensity = clamp(num(x, 0));
      if (this.ready) this.music.setIntensity(this._intensity);
    } catch (e) {
      this._err('setMusicIntensity', e);
    }
  }

  /**
   * Per-frame car state: { speed, maxSpeed, throttle, brake, drift, grounded,
   * boost, ludicrous, carType: 'waymo'|'cybercab', surface: 'road'|'grass'|'dirt' }.
   * After stopCar(), loops stay silent until there is real driving input
   * (throttle, speed, drift or boost), so calling this with speed 0 in menus is fine.
   */
  updateCar(state) {
    if (!this.ready || !state) return;
    try {
      this.car.update(state);
    } catch (e) {
      this._err('updateCar', e);
    }
  }

  /** Fade out all engine / tire loops (menus, game over). */
  stopCar() {
    if (!this.ready) return;
    try {
      this.car.stop();
    } catch (e) {
      this._err('stopCar', e);
    }
  }

  /**
   * One-shot SFX. opts = { volume = 1, pan = 0 (-1..1), rate = 1, intensity = 1 (0..1) }.
   */
  play(name, opts) {
    if (!this.ready) return;
    const fn = SFX[name];
    if (typeof fn !== 'function') {
      this._warnOnce('sfx:' + name, `[audio] unknown sound "${name}"`);
      return;
    }
    try {
      const now = this.ctx.currentTime;
      const rule = LIMITS[name] || DEFAULT_LIMIT;
      const last = this._lastPlay[name];
      if (last !== undefined && now - last < rule.gap && now >= last) return; // debounce
      const o = {
        volume: clamp(num(opts && opts.volume, 1), 0, 2),
        pan: clamp(num(opts && opts.pan, 0), -1, 1),
        rate: clamp(num(opts && opts.rate, 1), 0.25, 4),
        intensity: clamp(num(opts && opts.intensity, 1)),
      };
      if (o.volume < 0.001) return;
      this._makeRoom(name, rule, now);
      const v = new Voice(this.lib, this.sfxIn, now + 0.008, { gain: o.volume * (TRIM[name] || 1), pan: o.pan, reverb: this.sfxRevIn });
      v.name = name;
      try {
        fn(v, o);
      } catch (e) {
        v.kill(now);
        v.done();
        throw e;
      }
      v.done((vv) => {
        const i = this._voices.indexOf(vv);
        if (i >= 0) this._voices.splice(i, 1);
      });
      this._voices.push(v);
      this._lastPlay[name] = now;
    } catch (e) {
      this._err('play:' + name, e);
    }
  }

  /** Pause: duck + muffle music to ~30 % and silence car loops. */
  setPaused(p) {
    try {
      this.paused = !!p;
      if (!this.ready) return;
      const now = this.ctx.currentTime;
      this.musicDuck.gain.setTargetAtTime(this.paused ? MIX.pauseDuck : 1, now, 0.12);
      this.musicLP.frequency.setTargetAtTime(this.paused ? MIX.pauseLowpass : 20000, now, 0.12);
      this._applyVolumes();
      this.car.setPaused(this.paused);
    } catch (e) {
      this._err('setPaused', e);
    }
  }

  /** Stop everything and close the AudioContext. The instance is unusable afterwards. */
  // ---------------------------------------------------------------------------
  // "My music"
  // ---------------------------------------------------------------------------

  /** Queue the player's own audio files (File / Blob list). Returns how many were accepted. */
  setPlaylist(files) {
    try {
      for (const t of this._tracks) URL.revokeObjectURL(t.url);
      this._tracks = [];
      const audioName = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm|weba)$/i;
      for (const f of files || []) {
        if (!f || !((f.type || '').startsWith('audio/') || audioName.test(f.name || ''))) continue;
        this._tracks.push({ name: (f.name || 'Track').replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) });
      }
      this._shuffle();
      this._cur = null;
      this._errors = 0;
      if (!this._tracks.length) this.setMusicSource('game');
      else if (this._mineActive() && this.ready && this._musicWanted) this._playNext();
      return this._tracks.length;
    } catch (e) {
      this._err('setPlaylist', e);
      return 0;
    }
  }

  get trackCount() {
    return this._tracks.length;
  }

  get trackName() {
    return this._cur ? this._cur.name : '';
  }

  /**
   * 'game' = synthesized soundtrack, 'mine' = the queued files (falls back to 'game' when
   * empty), 'external' = silent here because something else plays music (YouTube player).
   */
  setMusicSource(src) {
    try {
      this.musicSource = src === 'external' ? 'external' : src === 'mine' && this._tracks.length ? 'mine' : 'game';
      if (!this.ready) return;
      if (this.musicSource === 'external') {
        this.music.stop(0.8);
        this._pauseMine();
      } else if (this.musicSource === 'mine') {
        this.music.stop(0.8);
        if (this._musicWanted) this._resumeMine();
      } else {
        this._pauseMine();
        if (this._musicWanted) this.music.play(this._musicWanted);
      }
    } catch (e) {
      this._err('setMusicSource', e);
    }
  }

  /** Skip to the next of the player's songs. */
  nextTrack() {
    if (this._mineActive() && this.ready) this._playNext();
  }

  _mineActive() {
    return this.musicSource === 'mine' && this._tracks.length > 0;
  }

  _shuffle() {
    const o = this._tracks.map((_, i) => i);
    for (let i = o.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [o[i], o[j]] = [o[j], o[i]];
    }
    this._order = o;
    this._ti = -1;
  }

  _ensureEl() {
    if (this._el || !this.ctx) return this._el;
    const el = new Audio();
    el.preload = 'auto';
    el.addEventListener('ended', () => this._playNext());
    el.addEventListener('playing', () => { this._errors = 0; });
    el.addEventListener('error', () => {
      // unreadable file: skip it, but give up after a full lap of failures
      if (++this._errors < this._tracks.length) setTimeout(() => this._playNext(), 150);
    });
    this._elSrc = this.ctx.createMediaElementSource(el);
    this._elGain = this.ctx.createGain();
    this._elGain.gain.value = 0;
    this._elSrc.connect(this._elGain);
    this._elGain.connect(this.musicVol); // mastered songs are loud: trimmed in _resumeMine
    this._el = el;
    return el;
  }

  _playNext() {
    const el = this._ensureEl();
    if (!el || !this._tracks.length) return;
    if (++this._ti >= this._order.length) {
      const last = this._order[this._order.length - 1];
      this._shuffle();
      this._ti = 0;
      if (this._order.length > 1 && this._order[0] === last) [this._order[0], this._order[1]] = [this._order[1], this._order[0]];
    }
    this._cur = this._tracks[this._order[this._ti]];
    el.src = this._cur.url;
    this._resumeMine(true);
    if (this.onTrack) {
      try { this.onTrack(this._cur.name); } catch (e) { /* ignore */ }
    }
  }

  _resumeMine(fresh = false) {
    const el = this._ensureEl();
    if (!el) return;
    if (!this._cur) {
      this._playNext();
      return;
    }
    clearTimeout(this._pauseT);
    const now = this.ctx.currentTime;
    this._elGain.gain.cancelScheduledValues(now);
    this._elGain.gain.setTargetAtTime(0.42, now, fresh ? 0.01 : 0.25);
    const p = el.play();
    if (p && p.catch) p.catch(() => {});
  }

  _pauseMine() {
    if (!this._el || !this.ctx) return;
    const now = this.ctx.currentTime;
    this._elGain.gain.cancelScheduledValues(now);
    this._elGain.gain.setTargetAtTime(0, now, 0.2);
    clearTimeout(this._pauseT);
    this._pauseT = setTimeout(() => { if (this._el && !this._wantMine()) this._el.pause(); }, 900);
  }

  _wantMine() {
    return this._mineActive() && !!this._musicWanted;
  }

  dispose() {
    this.disposed = true;
    try {
      if (this._el) this._el.pause();
      for (const t of this._tracks) URL.revokeObjectURL(t.url);
      if (this._onVisibility && typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._onVisibility);
      if (this.music) this.music.dispose();
      if (this.car) this.car.dispose();
      if (this.ctx) {
        const now = this.ctx.currentTime;
        for (const v of this._voices) v.kill(now);
        if (this.ctx.state !== 'closed' && typeof this.ctx.close === 'function') {
          Promise.resolve(this.ctx.close()).catch(() => {});
        }
      }
    } catch (e) {
      /* ignore */
    }
    this._voices.length = 0;
    this.ready = false;
    this.ctx = null;
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  _create() {
    const AC = getAudioContextClass();
    if (!AC) {
      this.failed = true;
      return false;
    }
    let ctx = null;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      try {
        ctx = new AC();
      } catch (e2) {
        this.failed = true;
        this._err('AudioContext', e2);
        return false;
      }
    }
    this.ctx = ctx;
    try {
      this._build();
      this.ready = true;
    } catch (e) {
      this._err('build', e);
      this.failed = true;
      this.ready = false;
      try { ctx.close(); } catch (e2) { /* ignore */ }
      this.ctx = null;
      return false;
    }
    if (this._musicWanted) {
      this.music.setIntensity(this._intensity);
      if (this._mineActive()) this._resumeMine();
      else if (this.musicSource !== 'external') this.music.play(this._musicWanted);
    }
    if (this.paused) this.setPaused(true);
    return true;
  }

  _build() {
    const ctx = this.ctx;
    const gain = (v = 1) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };

    // master + limiter
    this.master = gain(1);
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 2;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    // shared reverb
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulseResponse(ctx, 1.6);
    this.revReturn = gain(MIX.reverbReturn);
    this.reverb.connect(this.revReturn);
    this.revReturn.connect(this.master);

    // sfx bus (+ its reverb send, scaled with the sfx volume)
    this.sfxIn = gain(1);
    this.sfxVol = gain(1);
    this.sfxIn.connect(this.sfxVol);
    this.sfxVol.connect(this.master);
    this.sfxRevIn = gain(1);
    this.sfxRevVol = gain(1);
    this.sfxRevIn.connect(this.sfxRevVol);
    this.sfxRevVol.connect(this.reverb);

    // music bus: gentle glue compressor, volume, pause duck and muffle
    this.musicIn = gain(1);
    this.musicComp = ctx.createDynamicsCompressor();
    this.musicComp.threshold.value = -14;
    this.musicComp.knee.value = 10;
    this.musicComp.ratio.value = 2.5;
    this.musicComp.attack.value = 0.01;
    this.musicComp.release.value = 0.22;
    this.musicVol = gain(1);
    this.musicDuck = gain(1);
    this.musicLP = ctx.createBiquadFilter();
    this.musicLP.type = 'lowpass';
    this.musicLP.frequency.value = 20000;
    this.musicLP.Q.value = 0.6;
    this.musicIn.connect(this.musicComp);
    this.musicComp.connect(this.musicVol);
    this.musicVol.connect(this.musicDuck);
    this.musicDuck.connect(this.musicLP);
    this.musicLP.connect(this.master);
    this.musicRevIn = gain(1);
    this.musicRevVol = gain(1);
    this.musicRevIn.connect(this.musicRevVol);
    this.musicRevVol.connect(this.reverb);

    this.lib = {
      ctx,
      noise: makeNoiseBank(ctx),
      sfxReverb: this.sfxRevIn,
      musicReverb: this.musicRevIn,
      kits: {},
    };
    this.lib.kits.rock = new DrumKit(this.lib, 'rock');
    this.lib.kits.electro = new DrumKit(this.lib, 'electro');
    this.car = new CarSound(this.lib, this.sfxIn);
    this.music = new MusicPlayer(this.lib, this.musicIn);
    this._applyVolumes(true);

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this._onVisibility = () => this._handleVisibility();
      document.addEventListener('visibilitychange', this._onVisibility);
    }
  }

  _applyVolumes(immediate = false) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const m = perceptual(this.volumes.master) * MIX.master;
    const mu = perceptual(this.volumes.music) * MIX.music;
    const s = perceptual(this.volumes.sfx) * MIX.sfx;
    const duck = this.paused ? MIX.pauseDuck : 1;
    const set = (param, v) => {
      if (immediate) param.value = v;
      else param.setTargetAtTime(v, now, 0.03);
    };
    set(this.master.gain, m);
    set(this.musicVol.gain, mu);
    set(this.musicRevVol.gain, mu * duck);
    set(this.sfxVol.gain, s);
    set(this.sfxRevVol.gain, s);
  }

  /** Steal voices so the new one fits the per-name and global caps. */
  _makeRoom(name, rule, now) {
    const vs = this._voices;
    for (let i = vs.length - 1; i >= 0; i--) {
      if (vs[i].ended || vs[i].end < now - 0.05) vs.splice(i, 1);
    }
    let same = 0;
    let oldest = -1;
    for (let i = 0; i < vs.length; i++) {
      if (vs[i].name === name) {
        same++;
        if (oldest < 0) oldest = i;
      }
    }
    if (same >= rule.max && oldest >= 0) {
      vs[oldest].kill(now);
      vs.splice(oldest, 1);
    }
    while (vs.length >= MAX_VOICES) {
      vs[0].kill(now);
      vs.shift();
    }
  }

  /** Older iOS needs a sound started inside the gesture to fully unlock. */
  _primeIOS() {
    try {
      const ctx = this.ctx;
      if (ctx.state === 'running') return;
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.onended = () => s.disconnect();
      s.start(0);
    } catch (e) {
      /* ignore */
    }
  }

  _handleVisibility() {
    if (!this.ctx || this.disposed) return;
    try {
      if (document.hidden) {
        if (this.ctx.state === 'running') {
          this._hiddenSuspended = true;
          Promise.resolve(this.ctx.suspend()).catch(() => {});
        }
        if (this._el && !this._el.paused) { this._elHidden = true; this._el.pause(); }
      } else if (this._hiddenSuspended) {
        this._hiddenSuspended = false;
        Promise.resolve(this.ctx.resume()).catch(() => {});
        if (this._elHidden && this._wantMine()) this._el.play().catch(() => {});
        this._elHidden = false;
      }
    } catch (e) {
      /* ignore */
    }
  }

  _warnOnce(key, msg) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    console.warn(msg);
  }

  _err(where, e) {
    this._warnOnce('err:' + where, `[audio] ${where} failed: ${e && e.message ? e.message : e}`);
  }
}

export default AudioManager;
