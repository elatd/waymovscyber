/**
 * music/player.js - owns the music tracks, the lookahead timer and crossfades.
 */
import { GameSong } from './songGame.js';
import { MenuSong } from './songMenu.js';
import { ResultsSong } from './songResults.js';

const SONGS = { game: GameSong, menu: MenuSong, results: ResultsSong };
const LOOKAHEAD = 0.12; // seconds scheduled ahead of the audio clock
const TICK_MS = 25;
const XFADE = 1.0;

export class MusicPlayer {
  constructor(lib, dest) {
    this.lib = lib;
    this.ctx = lib.ctx;
    this.dest = dest;
    this.tracks = [];
    this.current = null;
    this.currentName = null;
    this.intensity = 0;
    this.timer = null;
  }

  static has(name) {
    return Object.prototype.hasOwnProperty.call(SONGS, name);
  }

  play(name) {
    if (!MusicPlayer.has(name)) return;
    if (this.current && this.currentName === name && this.current.state === 'playing') return;
    const now = this.ctx.currentTime;
    const prev = this.current;
    if (prev) prev.fadeOut(now, XFADE);
    const T = new SONGS[name](this.lib, this.dest);
    T.setIntensity(this.intensity, now);
    T.start(now + 0.06, prev ? XFADE : 0.3);
    this.tracks.push(T);
    this.current = T;
    this.currentName = name;
    if (!this.timer) this.timer = setInterval(() => this._tick(), TICK_MS);
    this._tick();
  }

  stop(fade = 0.8) {
    if (!this.current) return;
    this.current.fadeOut(this.ctx.currentTime, fade);
    this.current = null;
    this.currentName = null;
  }

  setIntensity(x) {
    // callers may send this every frame: ignore repeats and tiny steps (but always land on 0 / 1)
    if (x === this.intensity || (Math.abs(x - this.intensity) < 0.005 && x !== 0 && x !== 1)) return;
    this.intensity = x;
    if (this.current) this.current.setIntensity(x, this.ctx.currentTime);
  }

  _tick() {
    const now = this.ctx.currentTime;
    const until = now + LOOKAHEAD;
    for (let i = this.tracks.length - 1; i >= 0; i--) {
      const T = this.tracks[i];
      if (T.state === 'stopping') {
        if (now > T.stopAt + 0.5) {
          T.dispose();
          this.tracks.splice(i, 1);
          continue;
        }
        if (T.nextTime > T.stopAt) continue; // nothing audible left to schedule
      }
      T.schedule(until, now);
    }
    if (!this.tracks.length && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const T of this.tracks) T.dispose();
    this.tracks.length = 0;
    this.current = null;
    this.currentName = null;
  }
}
