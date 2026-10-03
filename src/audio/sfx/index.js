/**
 * sfx/index.js - registry of one-shot SFX recipes and their voice limits.
 */
import * as impacts from './impacts.js';
import * as world from './world.js';
import * as game from './game.js';
import * as specials from './specials.js';

/** name -> recipe(v: Voice, o: { volume, pan, rate, intensity }) */
export const SFX = Object.freeze({ ...impacts, ...world, ...game, ...specials });

/**
 * Per-name limits.
 *   max: concurrent voices of that name (the oldest is stolen when exceeded)
 *   gap: minimum seconds between triggers (extra triggers are dropped = debounce)
 */
export const LIMITS = {
  crash: { max: 3, gap: 0.08 },
  bump: { max: 3, gap: 0.06 },
  scrape: { max: 2, gap: 0.12 },
  break_plastic: { max: 4, gap: 0.03 },
  break_metal: { max: 4, gap: 0.03 },
  break_wood: { max: 3, gap: 0.03 },
  glass: { max: 3, gap: 0.04 },
  hydrant: { max: 2, gap: 0.1 },
  land: { max: 2, gap: 0.12 },
  jump: { max: 1, gap: 0.2 },
  splash: { max: 1, gap: 0.5 },
  horn: { max: 3, gap: 0.1 },
  horn_player: { max: 1, gap: 0.25 },
  boost_start: { max: 1, gap: 0.2 },
  pickup: { max: 2, gap: 0.1 },
  deliver: { max: 1, gap: 0.3 },
  cash: { max: 2, gap: 0.1 },
  tip: { max: 4, gap: 0.05 },
  combo: { max: 2, gap: 0.08 },
  near_miss: { max: 2, gap: 0.2 },
  fail: { max: 1, gap: 0.3 },
  rival_steal: { max: 1, gap: 0.3 },
  countdown: { max: 2, gap: 0.1 },
  go: { max: 1, gap: 0.2 },
  tick: { max: 2, gap: 0.15 },
  time_bonus: { max: 2, gap: 0.08 },
  game_over: { max: 1, gap: 1.0 },
  ui_move: { max: 3, gap: 0.025 },
  ui_select: { max: 2, gap: 0.05 },
  ui_back: { max: 2, gap: 0.05 },
  lidar_pulse: { max: 1, gap: 0.3 },
  ludicrous: { max: 1, gap: 0.3 },
  cable_bell: { max: 2, gap: 0.5 },
  seagull: { max: 2, gap: 0.6 },
  whoosh: { max: 3, gap: 0.05 },
};

export const DEFAULT_LIMIT = { max: 4, gap: 0.02 };

/**
 * Per-sound output trims (linear gain), measured with offline renders so the
 * one-shots sit at consistent loudness: impacts ~ -11..-15 dB (50 ms RMS at
 * volume 1), feedback stingers ~ -14..-18 dB, UI blips ~ -22 dB.
 */
export const TRIM = {
  crash: 0.85,
  rival_steal: 0.85,
  countdown: 0.8,
  go: 0.85,
  boost_start: 0.85,
  hydrant: 0.9,
  bump: 1.3,
  break_plastic: 1.6,
  break_wood: 2.0,
  glass: 1.45,
  scrape: 1.2,
  cash: 1.25,
  tip: 1.15,
  combo: 1.3,
  time_bonus: 1.6,
  near_miss: 1.9,
  jump: 1.4,
  whoosh: 1.4,
  cable_bell: 1.5,
  seagull: 1.6,
  horn_player: 1.4,
  ui_move: 2.6,
  ui_back: 2.2,
  ui_select: 1.3,
  tick: 1.9,
};
