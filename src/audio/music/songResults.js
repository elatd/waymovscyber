/**
 * music/songResults.js - the "results" track: a triumphant 8-bar anthem in
 * D major (112 BPM). The first pass is the full fanfare; afterwards it keeps
 * looping softly (no lead, light drums, glockenspiel arpeggio, lower level).
 */
import { Track, Phrase } from './track.js';
import { Bass, Lead, Pluck, Poly } from './instruments.js';

const CH = {
  D: { v: [62, 66, 69, 74], b: 38 },
  G: { v: [62, 67, 71, 74], b: 31 },
  A: { v: [61, 64, 69, 73], b: 33 },
  Bm: { v: [62, 66, 71, 74], b: 35 },
};
const FORM = [{ name: 'main', bars: 8, chords: ['D', 'G', 'A', 'D', 'Bm', 'G', 'A', 'D'] }];

const FANFARE = new Phrase(`
  A4:2 D5:2 F#5:2 A5:10 | G5:4 F#5:2 E5:2 D5:4 B4:4 | C#5:4 E5:4 A5:6 G5:2 | F#5:16 |
  F#5:4 D5:2 B4:2 D5:4 F#5:4 | G5:4 B5:4 A5:4 G5:4 | A5:4 G5:2 F#5:2 E5:4 C#5:4 | D5:16`);

/** Brass rhythm "taa - ta-taaa": [step, duration (16ths), velocity]. */
const BRASS_AT = new Map([[0, 6, 1], [6, 2, 0.8], [8, 8, 0.95]].map((x) => [x[0], x]));
const GLOCK_IDX = [0, 1, 2, 3, 2, 1, 2, 3];
const TOM_FILL = new Map([[8, 'tomHi'], [10, 'tomHi'], [11, 'tomMid'], [12, 'tomMid'], [13, 'tomLo'], [14, 'tomLo'], [15, 'snare']]);

export class ResultsSong extends Track {
  constructor(lib, dest) {
    super(lib, dest, { bpm: 112, swing: 0, level: 0.55, seed: 11 });
    this.kit = lib.kits.rock;
    const wet = this.wet;
    const sd = this.stepDur;
    this.ch = {
      kick: this.channel(0.55),
      snare: this.channel(0.55, 0, 0.35),
      hat: this.channel(0.16, 0.25),
      ride: this.channel(0.18, -0.3, 0.1),
      crash: this.channel(0.28, -0.2, 0.2),
      tomHi: this.channel(0.45, 0.3, 0.25),
      tomMid: this.channel(0.45, 0, 0.25),
      tomLo: this.channel(0.5, -0.3, 0.25),
    };
    this.brass = this.add(new Poly(lib, this.bus, { level: 0.9, reverb: wet, rev: 0.35 }));
    this.bass = this.add(new Bass(lib, this.bus, { level: 0.3, drive: 1.8, tone: 2000, sub: 0.35 }));
    this.lead = this.add(new Lead(lib, this.bus, { level: 0.45, wave: 'sawtooth', wave2: 'square', cutoff: 4200, echoTime: sd * 3, echo: 0.25, reverb: wet, rev: 0.35 }));
    this.glock = this.add(new Pluck(lib, this.bus, { level: 1.0, wave: 'triangle', cutoff: 3000, env: 3000, delay: sd * 3, fb: 0.3, wet: 0.3, reverb: wet, rev: 0.4 }));
    this.soft = false;
    this.setForm(FORM, 0);
  }

  onStep(st, bar, t) {
    const { sec, barIn, cycle } = this.cur;
    const c = CH[sec.chords[barIn]];
    const sd = this.stepDur;
    if (cycle > 0 && !this.soft) {
      this.soft = true;
      this.lift.gain.setTargetAtTime(0.8, t, 0.8);
      this.tone.frequency.setTargetAtTime(5000, t, 0.8);
    }
    const soft = this.soft;
    const hit = (name, v) => this.kit.play(name, t + this.hum(0.005), this.vel(v), this.ch[name]);

    // drums
    if (!soft) {
      if (st === 0 && (barIn === 0 || barIn === 4)) hit('crash', 0.85);
      const fill = barIn === 7 && st >= 8;
      if (fill) {
        const d = TOM_FILL.get(st);
        if (d) hit(d, 0.75 + 0.25 * ((st - 8) / 7));
      } else {
        if (st === 0 || st === 8 || (st === 10 && barIn % 2 === 1)) hit('kick', 1);
        if (st === 4 || st === 12) hit('snare', 1);
        if (st % 2 === 0) hit('hat', st % 4 === 0 ? 0.8 : 0.5);
      }
    } else {
      if (st === 0) hit('kick', 0.45);
      if (st % 2 === 0) hit('ride', st % 4 === 0 ? 0.45 : 0.3);
    }

    // brass chords / soft pad
    if (!soft) {
      const b = BRASS_AT.get(st);
      if (b) this.brass.chord(t, c.v, b[1] * sd * 0.92, b[2], { a: 0.025, dTau: 0.3, sus: 0.7, rel: 0.18, cutoff: 700, envAmt: 3200, fTau: 0.18, q: 1.5 });
    } else if (st === 0) {
      this.brass.chord(t, c.v, 15.5 * sd, 0.6, { a: 0.3, dTau: 0.6, sus: 0.8, rel: 0.5, cutoff: 900, envAmt: 300, fTau: 0.5, voices: 2 });
    }

    // bass on the beat
    if (st % 4 === 0) this.bass.note(t, c.b, (soft ? 3.6 : 3.4) * sd, soft ? 0.7 : 0.95, { cutoff: soft ? 700 : 1200 });

    // fanfare melody (first pass) / glockenspiel arpeggio (soft loops)
    if (!soft) {
      const ns = FANFARE.get(barIn * 16 + st);
      if (ns) for (const x of ns) this.lead.note(t, x.midi, x.dur * sd * 0.93, 0.85, { vib: 1.2 });
    } else if (st % 2 === 0) {
      this.glock.note(t, c.v[GLOCK_IDX[(st >> 1) % 8]] + 12, sd * 2, st % 4 === 0 ? 0.6 : 0.42);
    }
  }
}
