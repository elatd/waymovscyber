/**
 * music/songMenu.js - the "menu" track: 122 BPM synthwave / electro-funk in A minor.
 *
 * Form: A (filter-sweep intro) -> A' (+ ping-pong arp) -> B (four-on-the-floor,
 * pad + lead melody) -> A'' (arp + lead hook), looping from A'.
 */
import { Track, Phrase } from './track.js';
import { Bass, Lead, Pluck, Poly } from './instruments.js';

/** Chord voicings (MIDI) and bass roots. */
const CH = {
  Am9: { v: [57, 60, 64, 67, 71], b: 33 },
  Fmaj7: { v: [53, 57, 60, 64, 67], b: 29 },
  C: { v: [55, 60, 64, 67, 72], b: 36 },
  G6: { v: [55, 59, 62, 64, 67], b: 31 },
  Dm9: { v: [53, 57, 60, 64, 69], b: 38 },
  Am7: { v: [55, 60, 64, 69, 72], b: 33 },
  E7: { v: [52, 56, 59, 62, 68], b: 40 },
  G: { v: [55, 59, 62, 67, 71], b: 31 },
};

const S = {
  A: { name: 'A', bars: 8, chords: ['Am9', 'Fmaj7', 'C', 'G6', 'Am9', 'Fmaj7', 'C', 'G6'] },
  B: { name: 'B', bars: 8, chords: ['Dm9', 'Am7', 'Fmaj7', 'E7', 'Dm9', 'Am7', 'Fmaj7', 'G'] },
};
const FORM = [{ ...S.A, v: 0 }, { ...S.A, v: 1 }, { ...S.B, v: 0 }, { ...S.A, v: 2 }];

const MEL_B = new Phrase(`
  A4:3 C5:3 D5:2 E5:6 D5:2 | C5:4 A4:4 G4:2 A4:6 | A4:3 C5:3 F5:2 E5:4 C5:4 | B4:4 A4:2 G#4:10 |
  A4:3 C5:3 D5:2 E5:6 G5:2 | E5:4 D5:2 C5:2 A4:8 | C5:3 D5:3 E5:2 F5:4 E5:4 | D5:4 B4:4 G4:8`);

const MEL_A = new Phrase(`
  E5:2 r:1 E5:1 D5:2 C5:2 B4:2 C5:6 | A4:4 G4:2 A4:2 C5:8 | G4:2 r:1 G4:1 A4:2 C5:2 E5:4 D5:4 | D5:6 B4:2 G4:8 |
  E5:2 r:1 E5:1 D5:2 C5:2 B4:2 C5:6 | A4:4 G4:2 A4:2 C5:8 | G4:2 r:1 G4:1 A4:2 C5:2 E5:4 D5:4 | D5:4 E5:4 G5:8`);

/** Funky octave bass: [step, semitone offset, duration (16ths), velocity]. */
const BASS_AT = new Map(
  [[0, 0, 2, 1], [3, 12, 1, 0.7], [4, 0, 1, 0.6], [6, 0, 1, 0.8], [7, 12, 1, 0.6], [8, 0, 2, 0.9], [10, 12, 1, 0.7], [11, 0, 1, 0.6], [14, 7, 1, 0.7], [15, 12, 1, 0.6]].map((x) => [x[0], x]),
);
/** Syncopated chord stabs: [step, duration (16ths), velocity]. */
const STABS_AT = new Map([[0, 3, 0.9], [6, 1.5, 0.7], [10, 1.5, 0.75], [13, 2, 0.6]].map((x) => [x[0], x]));
const HAT_VEL = [0.7, 0.25, 0.45, 0.25];
const ARP_IDX = [0, 1, 2, 3, 4, 3, 2, 1];

export class MenuSong extends Track {
  constructor(lib, dest) {
    super(lib, dest, { bpm: 122, swing: 0.12, level: 0.55, seed: 3 });
    this.kit = lib.kits.electro;
    const wet = this.wet;
    const sd = this.stepDur;
    this.ch = {
      kick808: this.channel(0.5),
      clap: this.channel(0.45, 0, 0.3),
      snareGated: this.channel(0.3, 0, 0.25),
      hat: this.channel(0.3, 0.3),
      hatOpen: this.channel(0.2, 0.3, 0.05),
      shaker: this.channel(0.12, -0.35),
      crash: this.channel(0.22, -0.2, 0.1),
    };
    this.bass = this.add(new Bass(lib, this.bus, { level: 0.3, drive: 1.6, tone: 3000, sub: 0.45, pluck: 1.3 }));
    this.stabs = this.add(new Poly(lib, this.bus, { level: 1.0, reverb: wet, rev: 0.3 }));
    this.pad = this.add(new Poly(lib, this.bus, { level: 0.6, reverb: wet, rev: 0.45, width: 0.8 }));
    this.arp = this.add(new Pluck(lib, this.bus, { level: 1.1, wave: 'square', cutoff: 1500, env: 2500, delay: sd * 3, fb: 0.38, wet: 0.35, reverb: wet, rev: 0.2 }));
    this.lead = this.add(new Lead(lib, this.bus, { level: 0.42, wave: 'sawtooth', wave2: 'square', cutoff: 3200, echoTime: sd * 3, echo: 0.32, fb: 0.32, reverb: wet, rev: 0.35, pan: -0.1 }));
    this.setForm(FORM, 1);
  }

  onStep(st, bar, t) {
    const { sec, barIn } = this.cur;
    const c = CH[sec.chords[barIn]];
    const sd = this.stepDur;
    const intro = sec.v === 0 && sec.name === 'A' && barIn < 2;
    if (bar === 0 && st === 0) {
      // filter-sweep intro
      this.tone.frequency.cancelScheduledValues(t);
      this.tone.frequency.setValueAtTime(900, t);
      this.tone.frequency.exponentialRampToValueAtTime(16000, t + 32 * sd);
    }
    this._drums(sec, barIn, st, t, intro);

    // bass
    if (!intro) {
      const b = BASS_AT.get(st);
      if (b) this.bass.note(t, c.b + b[1], b[2] * sd * 0.9, this.vel(b[3], 0.1), { cutoff: 1300, q: 3 });
    } else if (st === 0) {
      this.bass.note(t, c.b, 15 * sd, 0.8, { cutoff: 900 });
    }

    // chords
    if (sec.name === 'A') {
      const s = STABS_AT.get(st);
      if (s) this.stabs.chord(t, c.v, s[1] * sd, this.vel(s[2], 0.1), { cutoff: 900, envAmt: 3200, dTau: 0.08, sus: 0.35, rel: 0.08 });
    } else {
      if (st === 0) this.pad.chord(t, c.v, 15.5 * sd, 0.9, { a: 0.35, dTau: 0.6, sus: 0.8, rel: 0.5, cutoff: 1300, envAmt: 500, fTau: 0.5, voices: 3, detune: 12 });
      if (st === 6 || st === 10) this.stabs.chord(t, c.v, 1.5 * sd, 0.55, { cutoff: 1000, envAmt: 2500, dTau: 0.08, sus: 0.3, rel: 0.08 });
    }

    // arpeggio (A' and A'')
    if (sec.name === 'A' && sec.v >= 1) {
      const n = c.v[ARP_IDX[st % 8]] + 12;
      this.arp.note(t, n, sd * 0.8, st % 4 === 0 ? 0.8 : 0.55);
    }

    // lead melodies
    const mel = sec.name === 'B' ? MEL_B : sec.v === 2 ? MEL_A : null;
    if (mel) {
      const ns = mel.get(barIn * 16 + st);
      if (ns) for (const x of ns) this.lead.note(t, x.midi, x.dur * sd * 0.9, 0.8, { vib: 1.2, scoop: -25 });
    }
  }

  _drums(sec, barIn, st, t, intro) {
    const k = this.kit;
    const ch = this.ch;
    const hit = (name, v) => k.play(name, t + this.hum(0.004), this.vel(v), ch[name]);
    if (st === 0 && barIn === 0 && !(sec.v === 0 && sec.name === 'A')) hit('crash', 0.7);
    if (st === 0 && intro === false && sec.v === 0 && sec.name === 'A' && barIn === 2) hit('crash', 0.6);
    const fill = barIn === sec.bars - 1 && st >= 12;
    // hats (swung 16ths)
    if (!fill || st < 14) hit('hat', HAT_VEL[st % 4] * (intro ? 0.7 : 1));
    if (intro) {
      if (st === 0 || st === 8) hit('kick808', 0.8);
      return;
    }
    if (sec.name === 'B') {
      if (st % 4 === 0) hit('kick808', st === 0 ? 1 : 0.85);
      if (st % 2 === 1) hit('shaker', 0.4);
      if (st === 6 || st === 14) hit('hatOpen', 0.5);
    } else {
      if (st === 0) hit('kick808', 1);
      if (st === 10) hit('kick808', 0.9);
      if (st === 7 && sec.v >= 1) hit('kick808', 0.45);
      if (st === 14 && sec.v >= 1) hit('hatOpen', 0.45);
    }
    if (fill) {
      if (st === 12) hit('clap', 0.6);
      if (st === 13) hit('clap', 0.7);
      if (st === 14) hit('snareGated', 0.8);
      if (st === 15) hit('snareGated', 1);
      if (st === 12) {
        hit('snareGated', 0.6);
      }
      return;
    }
    if (st === 4 || st === 12) {
      hit('clap', 1);
      hit('snareGated', 0.7);
    }
  }
}
