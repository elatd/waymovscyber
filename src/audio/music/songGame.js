/**
 * music/songGame.js - the "game" track: 172 BPM punk / skate rock in E major.
 *
 * Form: intro riff -> verse -> pre-chorus -> chorus -> riff -> verse 2 ->
 * pre -> chorus -> half-time bridge -> big chorus -> riff, then loops from
 * verse 1 (every other loop is lifted a whole step for variety).
 * Intensity (0..1) opens the tone filter, adds open hats / crashes, a 16th
 * arpeggio layer, and pushes the chorus cymbals.
 */
import { Track, Phrase } from './track.js';
import { Bass, Guitar, Lead, Pluck } from './instruments.js';

/** Power-chord root (low string MIDI) and a close triad for lines/arps. */
const CH = {
  E: { g: 40, tri: [64, 68, 71] },
  B: { g: 47, tri: [63, 66, 71] },
  Cs: { g: 49, tri: [64, 68, 73] },
  A: { g: 45, tri: [64, 69, 73] },
  C: { g: 48, tri: [64, 67, 72] },
  D: { g: 50, tri: [66, 69, 74] },
  G: { g: 43, tri: [62, 67, 71] },
};

const S = {
  intro: { name: 'intro', bars: 4, chords: ['E', 'E', 'E', 'E'] },
  verse: { name: 'verse', bars: 8, chords: ['E', 'E', 'Cs', 'Cs', 'A', 'A', 'B', 'B'] },
  pre: { name: 'pre', bars: 4, chords: ['C', 'D', 'C', 'D'] }, // bVI - bVII build
  chorus: { name: 'chorus', bars: 8, chords: ['E', 'B', 'Cs', 'A', 'E', 'B', 'Cs', 'A'] },
  riff: { name: 'riff', bars: 2, chords: ['E', 'E'] },
  bridge: { name: 'bridge', bars: 8, chords: ['Cs', 'A', 'E', 'B', 'Cs', 'A', 'C', 'D'] },
};

const FORM = [
  S.intro,
  { ...S.verse, v: 0 },
  S.pre,
  { ...S.chorus, v: 0 },
  S.riff,
  { ...S.verse, v: 1 },
  S.pre,
  { ...S.chorus, v: 0 },
  S.bridge,
  { ...S.chorus, v: 1 },
  S.riff,
];

/** Main riff, 2 bars: [step, chord, duration (16ths), palm-muted]. */
const RIFF = [
  [[0, 'E', 1.6, 1], [2, 'E', 1.6, 1], [4, 'E', 1.6, 1], [6, 'G', 2, 0], [8, 'A', 3, 0], [11, 'G', 1, 0], [12, 'E', 1.6, 1], [14, 'E', 1.6, 1]],
  [[0, 'E', 1.6, 1], [2, 'E', 1.6, 1], [4, 'E', 1.6, 1], [6, 'G', 2, 0], [8, 'A', 2, 0], [10, 'C', 2, 0], [12, 'B', 4, 0]],
];
const RIFF_AT = RIFF.map((bar) => new Map(bar.map((h) => [h[0], h])));

/** Chorus hook (8 bars over E B C#m A x2). */
const HOOK = new Phrase(`
  G#4:3 G#4:3 A4:2 B4:6 G#4:2 | F#4:4 E4:2 F#4:2 D#4:8 |
  E4:3 E4:3 F#4:2 G#4:6 E4:2 | C#5:4 B4:4 A4:2 G#4:2 F#4:4 |
  G#4:3 G#4:3 A4:2 B4:6 E5:2 | D#5:4 C#5:2 B4:2 F#4:8 |
  E5:4 D#5:2 C#5:2 B4:4 G#4:4 | A4:2 B4:2 C#5:4 B4:8`);

/** Soaring bridge melody (long notes). */
const BRIDGE_MEL = new Phrase(`
  G#4:16 | A4:8 B4:8 | G#4:12 E4:4 | F#4:16 |
  G#4:8 B4:8 | C#5:8 E5:8 | E5:8 D5:4 C5:4 | D5:8 F#5:8`);

/** Verse-2 counter line: 3+3+2 arpeggio over the chord triad (8th notes). */
const COUNTER = [2, 0, 1, 2, 0, 1, 2, 1];

/** Drum fills: [step, drum, velocity]. */
const FILLS = [
  [[12, 'snare', 0.7], [13, 'snare', 0.8], [14, 'snare', 0.9], [15, 'snare', 1]],
  [[8, 'tomHi', 0.9], [9, 'tomHi', 0.7], [10, 'tomMid', 0.9], [11, 'tomMid', 0.7], [12, 'tomLo', 1], [13, 'tomLo', 0.8], [14, 'snare', 1], [15, 'snare', 1]],
  [[8, 'snare', 0.6], [10, 'snare', 0.7], [12, 'snare', 0.8], [13, 'snare', 0.85], [14, 'snare', 0.9], [15, 'snare', 1]],
  [[12, 'tomHi', 1], [13, 'tomMid', 1], [14, 'tomLo', 1], [15, 'tomLo', 0.9]],
].map((f) => ({ from: f[0][0], at: new Map(f.map((x) => [x[0], x])) }));

const ARP_IDX = [0, 1, 2, 1];

function chordOf(info) {
  if (!info) return 'E';
  const n = info.sec.name;
  return n === 'intro' || n === 'riff' ? 'E' : info.sec.chords[info.barIn];
}

export class GameSong extends Track {
  constructor(lib, dest) {
    super(lib, dest, { bpm: 172, swing: 0, level: 0.55, seed: 7 });
    this.kit = lib.kits.rock;
    const wet = this.wet;
    const sd = this.stepDur;
    this.ch = {
      kick: this.channel(0.6),
      snare: this.channel(0.62, 0, 0.22),
      hat: this.channel(0.34, 0.25),
      hatOpen: this.channel(0.28, 0.25, 0.05),
      ride: this.channel(0.3, -0.3, 0.05),
      crash: this.channel(0.42, -0.2, 0.1),
      tomHi: this.channel(0.45, 0.3, 0.15),
      tomMid: this.channel(0.45, 0, 0.15),
      tomLo: this.channel(0.5, -0.3, 0.15),
    };
    this.gtr = this.add(new Guitar(lib, this.bus, { level: 0.5, reverb: wet, rev: 0.08 }));
    this.bass = this.add(new Bass(lib, this.bus, { level: 0.36, drive: 2.5, tone: 2800, sub: 0.2 }));
    this.lead = this.add(new Lead(lib, this.bus, { level: 0.26, cutoff: 4200, echoTime: sd * 3, reverb: wet, rev: 0.22, pan: 0.1 }));
    this.counter = this.add(new Pluck(lib, this.bus, { level: 1.6, wave: 'sawtooth', cutoff: 1400, env: 3000, delay: sd * 6, fb: 0.2, wet: 0.2, reverb: wet, rev: 0.12 }));
    this.arp = this.add(new Pluck(lib, this.bus, { level: 1.0, wave: 'square', cutoff: 1800, env: 4000, delay: sd * 3, fb: 0.25, wet: 0.25, reverb: wet, rev: 0.1 }));
    this.fill = null;
    this.setForm(FORM, 1);
  }

  onIntensity(x, now) {
    this.tone.frequency.setTargetAtTime(9000 + 11000 * x, now, 0.4);
    this.lift.gain.setTargetAtTime(0.92 + 0.14 * x, now, 0.4);
  }

  onStep(st, bar, t) {
    const { sec, barIn, cycle } = this.cur;
    const I = this.intensity;
    const tr = cycle % 2 ? 2 : 0; // whole-step lift on alternate loops
    const key = chordOf(this.cur);
    if (st === 0) this.fill = this._pickFill(sec, barIn);
    this._drums(sec, barIn, st, t, I);
    this._guitar(sec, barIn, st, t, CH[key], tr);
    this._bass(sec, barIn, st, t, key, tr);
    this._lead(sec, barIn, st, t, CH[key], tr, I);
  }

  _pickFill(sec, barIn) {
    const n = sec.name;
    if (n === 'intro') return barIn === 3 ? FILLS[2] : null;
    if (n === 'pre' || (n === 'bridge' && barIn >= 6)) return null; // these build on their own
    if (barIn === sec.bars - 1) return FILLS[1 + Math.floor(this.rng() * 3)];
    if (barIn % 4 === 3) return FILLS[0];
    return null;
  }

  _drums(sec, barIn, st, t, I) {
    const k = this.kit;
    const ch = this.ch;
    const hit = (name, v) => k.play(name, t + this.hum(0.005), this.vel(v), ch[name]);
    const n = sec.name;
    let crashed = false;
    if (st === 0) {
      const crash =
        (n === 'intro' && barIn === 2) ||
        (n !== 'intro' && (barIn === 0 || (n === 'chorus' && barIn === 4) || (I > 0.75 && n !== 'bridge' && n !== 'pre')));
      if (crash) {
        hit('crash', 0.9);
        crashed = true;
      }
    }
    const fill = this.fill;
    if (fill && st >= fill.from) {
      const f = fill.at.get(st);
      if (f) hit(f[1], f[2]);
      if (st === fill.from && n !== 'intro') hit('kick', 0.9);
      return;
    }
    switch (n) {
      case 'intro':
        if (barIn < 2) {
          if (st % 4 === 0) hit('hat', st === 0 ? 0.7 : 0.5); // count-in hats under the solo riff
        } else {
          this._rock(st, hit, I);
        }
        return;
      case 'verse':
      case 'riff':
        this._rock(st, hit, I);
        return;
      case 'pre':
        if (st % 4 === 0) hit('kick', 0.95);
        if (barIn === 3) {
          hit('snare', 0.35 + 0.65 * (st / 15)); // 16th-note roll crescendo into the chorus
          return;
        }
        if (st === 4 || st === 12) hit('snare', 1);
        if (st % 2 === 0) hit('tomLo', st % 4 === 0 ? 0.7 : 0.5);
        return;
      case 'chorus':
        // skate beat: kick on every beat, snare on every off-beat 8th, driving 8th ride
        if (st % 4 === 0) hit('kick', 1);
        if (st % 2 === 0 && !crashed) {
          if (I > 0.85 && st % 4 === 0) hit('crash', 0.4);
          else hit('ride', st % 4 === 0 ? 0.8 : 0.5);
        }
        if (st % 4 === 2) hit('snare', st === 6 || st === 14 ? 1 : 0.85);
        if (I > 0.5 && st % 2 === 1) hit('hat', 0.3);
        return;
      case 'bridge':
        if (barIn < 6) {
          // half-time feel
          if (st === 0 || st === 10) hit('kick', 1);
          if (st === 8) hit('snare', 1);
          if (st % 2 === 0) hit('ride', st % 4 === 0 ? 0.8 : 0.55);
          if (st === 14 && barIn % 2 === 1) hit('snare', 0.4);
          return;
        }
        if (st % 4 === 0) hit('kick', 1);
        if (barIn === 6) {
          if (st % 2 === 0) hit('snare', 0.5 + 0.3 * (st / 14));
        } else {
          hit('snare', 0.45 + 0.55 * (st / 15));
        }
        return;
      default:
    }
  }

  _rock(st, hit, I) {
    if (st === 0 || st === 8 || st === 10) hit('kick', st === 10 ? 0.8 : 1);
    if (st === 4 || st === 12) hit('snare', 1);
    if (st === 15 && this.rng() < 0.3) hit('snare', 0.25); // ghost note
    if (st % 2 === 0) {
      const open = I > 0.5 && (st === 6 || st === 14);
      hit(open ? 'hatOpen' : 'hat', st % 4 === 0 ? 0.9 : 0.6);
    } else if (I > 0.75) {
      hit('hat', 0.3);
    }
  }

  _guitar(sec, barIn, st, t, c, tr) {
    const G = this.gtr;
    const sd = this.stepDur;
    const n = sec.name;
    if (n === 'intro' || n === 'riff') {
      const h = RIFF_AT[barIn % 2].get(st);
      if (h) G.chord(t, CH[h[1]].g + tr, h[2] * sd, h[3] ? 0.9 : 1, { mute: !!h[3] });
      return;
    }
    if (st % 2 !== 0) return;
    const accent = st % 4 === 0 ? 1 : 0.85;
    switch (n) {
      case 'verse': {
        // palm-muted 8th chugs, with open pushes closing each 2-bar chord
        const push = barIn % 2 === 1 && st >= 12;
        G.chord(t, c.g + tr, (push ? 2 : 1.6) * sd, push ? 1 : accent * 0.95, { mute: !push });
        return;
      }
      case 'pre':
        if (barIn === 3) G.chord(t, c.g + tr, 2 * sd, accent);
        else if (st === 0) G.chord(t, c.g + tr, 6 * sd, 1);
        else if (st >= 8) G.chord(t, c.g + tr, 1.6 * sd, accent * 0.9, { mute: true });
        return;
      case 'chorus':
        G.chord(t, c.g + tr, 2 * sd, accent); // open 8th-note wall
        return;
      case 'bridge':
        if (barIn < 6) {
          if (st === 0) G.chord(t, c.g + tr, 15.5 * sd, 1); // let ring
        } else {
          G.chord(t, c.g + tr, 2 * sd, accent);
        }
        return;
      default:
    }
  }

  _bass(sec, barIn, st, t, key, tr) {
    const B = this.bass;
    const sd = this.stepDur;
    const n = sec.name;
    const root = CH[key].g - 12;
    if (n === 'intro' || n === 'riff') {
      if (n === 'intro' && barIn < 2) return;
      const h = RIFF_AT[barIn % 2].get(st);
      if (h) B.note(t, CH[h[1]].g - 12 + tr, Math.min(h[2], 2) * sd * 0.95, 1);
      return;
    }
    if (n === 'bridge' && barIn < 6) {
      if (st === 0) B.note(t, root + tr, 7.5 * sd, 1);
      else if (st === 8) B.note(t, root + 7 + tr, 7.5 * sd, 0.9);
      return;
    }
    if (st % 2 !== 0) return;
    let note = root;
    // chromatic approach into the next chord
    if (st === 14 && (barIn % 2 === 1 || n !== 'verse')) {
      const nk = chordOf(this.nxt);
      if (nk !== key) note = CH[nk].g - 12 - 1;
    }
    B.note(t, note + tr, 1.7 * sd, st % 4 === 0 ? 1 : 0.85);
  }

  _lead(sec, barIn, st, t, c, tr, I) {
    const sd = this.stepDur;
    const n = sec.name;
    if (n === 'chorus') {
      const ns = HOOK.get(barIn * 16 + st);
      if (ns) {
        for (const x of ns) {
          this.lead.note(t, x.midi + 12 + tr, x.dur * sd * 0.92, 0.9);
          // big last chorus: doubled an octave below for weight
          if (sec.v === 1) this.lead.note(t + 0.003, x.midi + tr, x.dur * sd * 0.92, 0.55, { vib: 0.7 });
        }
      }
    } else if (n === 'bridge') {
      const ns = BRIDGE_MEL.get(barIn * 16 + st);
      if (ns) for (const x of ns) this.lead.note(t, x.midi + 12 + tr, x.dur * sd * 0.96, 0.75, { vib: 1.5 });
    } else if (n === 'verse' && sec.v === 1 && st % 2 === 0) {
      this.counter.note(t, c.tri[COUNTER[st >> 1]] + tr, sd * 1.5, st % 4 === 0 ? 0.8 : 0.6);
    }
    // intensity layer: 16th arpeggio an octave up
    if (I > 0.35 && n !== 'intro' && n !== 'riff') {
      const v = ((I - 0.35) / 0.65) * (st % 4 === 0 ? 0.9 : 0.6);
      this.arp.note(t, c.tri[ARP_IDX[st % 4]] + 12 + tr, sd * 0.9, v);
    }
  }
}
