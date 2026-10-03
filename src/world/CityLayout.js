// City layout: the stylized San Francisco street grid, its hills, waterfront and
// named places. Everything else (meshes, physics, AI, missions) is derived from here.
//
// Coordinate system: meters, +Y up, north = -Z, east = +X.
// Grid lines x_i (N-S streets) and z_j (E-W streets) are 80 m apart.
// Intersections are flat (classic SF), streets ramp between them, which makes the
// famous launch-off-the-crest jumps.

import { clamp, lerp, smoothstep, mulberry32 } from '../core/math.js';

export const N = 12; // blocks per side
export const S = 80; // grid spacing
export const ORIGIN = -480; // coordinate of grid line 0
export const ROAD_HALF = 7.5; // carriageway half width (2 lanes each way)
export const SIDEWALK = 4.5;
export const STRIP = ROAD_HALF + SIDEWALK; // 12: half width of a road strip incl. sidewalks
export const CURB = 0.15;
export const RAMP = S - 2 * STRIP; // 56: ramp length between intersections
const EASE_A = 4.5 / RAMP;
export const LANES = [1.85, 5.35]; // lane centers from the road center line (right-hand traffic)
export const CITY_MIN = ORIGIN - STRIP; // -492
export const CITY_MAX = ORIGIN + N * S + STRIP; // 492
export const SEAWALL = 506; // waterfront promenade outer edge (north: z=-506, east: x=506)
export const WATERFRONT_H = 3;
export const SEABED = -7;
export const PIER_H = WATERFRONT_H + CURB;

export const lineX = (i) => ORIGIN + i * S;
export const lineZ = (j) => ORIGIN + j * S;

export const X_NAMES = [
  'Divisadero St', 'Steiner St', 'Gough St', 'Van Ness Ave', 'Polk St', 'Hyde St', 'Leavenworth St',
  'Jones St', 'Powell St', 'Stockton St', 'Grant Ave', 'Montgomery St', 'The Embarcadero',
];
export const Z_NAMES = [
  'Jefferson St', 'Bay St', 'Chestnut St', 'Lombard St', 'Union St', 'Broadway', 'Jackson St',
  'California St', 'Bush St', 'Geary St', 'Eddy St', 'Hayes St', 'Market St',
];

// ---------------------------------------------------------------------------
// Hills
// ---------------------------------------------------------------------------
const gauss = (x, z, cx, cz, s) => {
  const dx = x - cx, dz = z - cz;
  return Math.exp(-(dx * dx + dz * dz) / (2 * s * s));
};

export const HILLS = [
  { name: 'Russian Hill', x: -105, z: -235, a: 46, s: 88 },
  { name: 'Nob Hill', x: 120, z: 50, a: 54, s: 125 },
  { name: 'Telegraph Hill', x: 360, z: -270, a: 36, s: 75 },
  { name: 'Pacific Heights', x: -430, z: -40, a: 34, s: 160 },
  { name: 'Alamo Square', x: -440, z: 360, a: 26, s: 110 },
  { name: 'Lower Haight', x: 60, z: 420, a: 8, s: 200 },
];

export function hillField(x, z) {
  let h = 0;
  for (const hl of HILLS) h += hl.a * gauss(x, z, hl.x, hl.z, hl.s);
  const dn = z - ORIGIN, de = ORIGIN + N * S - x;
  const w = clamp(Math.min(dn, de) / 230, 0, 1);
  const ww = w * w * (3 - 2 * w) * 0.6 + w * 0.4;
  return WATERFRONT_H + h * ww;
}

// Intersection heights, with slopes clamped to ~33% so streets stay drivable.
export const H = [];
(function buildHeights() {
  for (let i = 0; i <= N; i++) {
    H[i] = [];
    for (let j = 0; j <= N; j++) H[i][j] = hillField(lineX(i), lineZ(j));
  }
  const MAXD = 17;
  for (let it = 0; it < 300; it++) {
    let changed = false;
    for (let i = 0; i <= N; i++)
      for (let j = 0; j <= N; j++) {
        for (const [a, b] of [[i + 1, j], [i, j + 1]]) {
          if (a > N || b > N) continue;
          const d = H[a][b] - H[i][j];
          if (Math.abs(d) > MAXD) {
            const ex = Math.abs(d) - MAXD;
            if (d > 0) H[a][b] -= ex; else H[i][j] -= ex;
            changed = true;
          }
        }
      }
    if (!changed) break;
  }
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) H[i][j] = Math.round(Math.max(WATERFRONT_H, H[i][j]) * 20) / 20;
})();

// Intersection height for any (possibly out-of-range) grid index. Outside the playable
// grid we continue the hill field smoothly so the outer (decorative) city lines up.
export function heightIJ(i, j) {
  if (i >= 0 && i <= N && j >= 0 && j <= N) return H[i][j];
  const ci = clamp(i, 0, N), cj = clamp(j, 0, N);
  const base = H[ci][cj];
  const dh = hillField(lineX(i), lineZ(j)) - hillField(lineX(ci), lineZ(cj));
  // gently rolling outer city, with Twin Peaks rising to the south-west
  const tw = 70 * gauss(lineX(i), lineZ(j), -900, 1100, 380);
  return Math.max(WATERFRONT_H, base + dh * 0.8 + tw);
}

// C1-continuous "linear with rounded ends" ramp profile.
export function ease(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const a = EASE_A, k = 1 / (2 * a * (1 - a));
  if (t < a) return t * t * k;
  if (t > 1 - a) return 1 - (1 - t) * (1 - t) * k;
  return (t - a * 0.5) / (1 - a);
}

// Sample points (0..1) along a ramp that capture the curvature at both ends.
export const RAMP_T = (() => {
  const a = EASE_A;
  return [0, a / 3, (2 * a) / 3, a, 0.25, 0.5, 0.75, 1 - a, 1 - (2 * a) / 3, 1 - a / 3, 1];
})();

// ---------------------------------------------------------------------------
// Waterfront: promenades and piers
// ---------------------------------------------------------------------------
export const PIERS = [
  { name: 'Pier 39', x0: 268, x1: 332, z0: -650, z1: -SEAWALL },
  { name: 'Pier 45', x0: 22, x1: 58, z0: -600, z1: -SEAWALL },
  { name: 'Hyde St Pier', x0: -101, x1: -77, z0: -665, z1: -SEAWALL },
  { name: 'Pier 7', x0: SEAWALL, x1: 700, z0: -132, z1: -118 },
  { name: 'Pier 3', x0: SEAWALL, x1: 640, z0: -310, z1: -250 },
  { name: 'Pier 1', x0: SEAWALL, x1: 610, z0: 150, z1: 210 },
  { name: 'Ferry Plaza', x0: SEAWALL, x1: 566, z0: 352, z1: CITY_MAX + 30 },
];

export function pierAt(x, z) {
  for (const p of PIERS) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return p;
  return null;
}

// ---------------------------------------------------------------------------
// Ground height (used by physics, props, buildings — includes curbs)
// ---------------------------------------------------------------------------
export function inPlayableGrid(x, z) {
  return x >= CITY_MIN && x <= CITY_MAX && z >= CITY_MIN && z <= CITY_MAX;
}

export function isWaterfrontZone(x, z) {
  // north strip / east strip beyond the outer sidewalks
  if (z < CITY_MIN && x >= CITY_MIN - 2) return true;
  if (x > CITY_MAX && z <= CITY_MAX + 40) return true;
  return false;
}

function gridHeight(x, z) {
  const gx = (x - ORIGIN) / S, gz = (z - ORIGIN) / S;
  const ni = Math.round(gx), nj = Math.round(gz);
  const dx = x - lineX(ni), dz = z - lineZ(nj);
  const adx = Math.abs(dx), adz = Math.abs(dz);
  const onX = adx <= STRIP, onZ = adz <= STRIP;
  if (onX && onZ) {
    const curb = adx > ROAD_HALF && adz > ROAD_HALF ? CURB : 0;
    return heightIJ(ni, nj) + curb;
  }
  if (onX) {
    const j0 = Math.floor(gz);
    const t = (z - lineZ(j0) - STRIP) / RAMP;
    const h = lerp(heightIJ(ni, j0), heightIJ(ni, j0 + 1), ease(t));
    return h + (adx > ROAD_HALF ? CURB : 0);
  }
  if (onZ) {
    const i0 = Math.floor(gx);
    const t = (x - lineX(i0) - STRIP) / RAMP;
    const h = lerp(heightIJ(i0, nj), heightIJ(i0 + 1, nj), ease(t));
    return h + (adz > ROAD_HALF ? CURB : 0);
  }
  const i0 = Math.floor(gx), j0 = Math.floor(gz);
  return blockHeight(i0, j0, (x - lineX(i0) - STRIP) / RAMP, (z - lineZ(j0) - STRIP) / RAMP);
}

// Eased-bilinear block ground (sidewalk level). u,v in 0..1 across the block interior.
export function blockHeight(i, j, u, v) {
  const eu = ease(u), ev = ease(v);
  const a = lerp(heightIJ(i, j), heightIJ(i + 1, j), eu);
  const b = lerp(heightIJ(i, j + 1), heightIJ(i + 1, j + 1), eu);
  return lerp(a, b, ev) + CURB;
}

export function groundHeight(x, z) {
  if (isWaterfrontZone(x, z)) {
    if (z < CITY_MIN) {
      if (z >= -SEAWALL && x <= SEAWALL) return PIER_H;
    } else if (x > CITY_MAX) {
      if (x <= SEAWALL) return PIER_H;
    }
    if (pierAt(x, z)) return PIER_H;
    return SEABED;
  }
  return gridHeight(x, z);
}

// Road surface height ignoring curbs (for lanes / traffic).
export function roadHeight(x, z) {
  const h = groundHeight(x, z);
  return h;
}

export function groundNormal(x, z, out, eps = 0.6) {
  const hx = groundHeight(x + eps, z) - groundHeight(x - eps, z);
  const hz = groundHeight(x, z + eps) - groundHeight(x, z - eps);
  out.set(-hx, 2 * eps, -hz).normalize();
  return out;
}

// Surface classification for audio/particles/AI.
export function surfaceAt(x, z) {
  if (isWaterfrontZone(x, z)) {
    if (groundHeight(x, z) < 0) return 'water';
    return 'pier';
  }
  if (!inPlayableGrid(x, z)) return 'outer';
  const ni = Math.round((x - ORIGIN) / S), nj = Math.round((z - ORIGIN) / S);
  const adx = Math.abs(x - lineX(ni)), adz = Math.abs(z - lineZ(nj));
  if (adx <= STRIP || adz <= STRIP) {
    if (adx <= ROAD_HALF || adz <= ROAD_HALF) return 'road';
    return 'sidewalk';
  }
  const bi = Math.floor((x - ORIGIN) / S), bj = Math.floor((z - ORIGIN) / S);
  const b = getBlock(bi, bj);
  if (b && b.park) return 'grass';
  return 'block';
}

// ---------------------------------------------------------------------------
// Districts & special blocks
// ---------------------------------------------------------------------------
function districtFor(i, j) {
  if (j === 0 && i <= 2) return 'marina';
  if (j === 0) return 'wharf';
  if (i >= 10 && j >= 5 && j <= 10) return 'fidi';
  if (i === 11 && j === 4) return 'fidi';
  if ((i === 9 || i === 10) && (j === 5 || j === 6)) return 'chinatown';
  if (i >= 7 && i <= 9 && j >= 7 && j <= 9) return 'unionsq';
  if (i >= 6 && i <= 8 && j >= 5 && j <= 6) return 'nobhill';
  if (i >= 7 && i <= 10 && j >= 1 && j <= 4) return 'northbeach';
  if (j === 11 && i >= 5) return 'soma';
  if (i >= 2 && i <= 4 && j >= 9) return 'civic';
  if (j <= 2 && i <= 3) return 'marina';
  return 'residential';
}

const SPECIAL = {
  '0,0': { landmark: 'palace', park: 'lagoon', name: 'Palace of Fine Arts' },
  '3,0': { landmark: 'ghirardelli', name: 'Ghirardelli Square' },
  '10,2': { landmark: 'coit', park: 'hill', name: 'Pioneer Park' },
  '9,3': { park: 'square', name: 'Washington Square' },
  '9,2': { landmark: 'church', name: 'Saints Peter & Paul' },
  '6,6': { park: 'square', name: 'Huntington Park', fountain: true },
  '8,8': { park: 'plaza', name: 'Union Square', monument: true },
  '11,5': { landmark: 'transamerica', name: 'Transamerica Pyramid' },
  '11,10': { landmark: 'salesforce', name: 'Salesforce Tower' },
  '2,10': { landmark: 'cityhall', name: 'City Hall' },
  '2,11': { park: 'plaza', name: 'Civic Center Plaza' },
  '0,10': { park: 'hill', name: 'Alamo Square' },
  '1,10': { district: 'painted', name: 'Painted Ladies' },
};

export const BLOCKS = [];
for (let i = 0; i < N; i++) {
  BLOCKS[i] = [];
  for (let j = 0; j < N; j++) {
    const sp = SPECIAL[`${i},${j}`] || {};
    BLOCKS[i][j] = {
      i, j,
      district: sp.district || districtFor(i, j),
      park: sp.park || null,
      landmark: sp.landmark || null,
      name: sp.name || null,
      fountain: !!sp.fountain,
      monument: !!sp.monument,
      x0: lineX(i) + STRIP, x1: lineX(i + 1) - STRIP,
      z0: lineZ(j) + STRIP, z1: lineZ(j + 1) - STRIP,
    };
  }
}
export function getBlock(i, j) {
  if (i < 0 || j < 0 || i >= N || j >= N) return null;
  return BLOCKS[i][j];
}

// Lombard St's crooked block: E-W street j=3 between Hyde (i=5) and Leavenworth (i=6)
export const LOMBARD = { j: 3, i0: 5, i1: 6 };
// Powell St cable car line (N-S street i=8), Grant Ave Chinatown lanterns (i=10, j 5..7)
export const CABLE_CAR_LINE = 8;
export const CHINATOWN_GRANT = { i: 10, j0: 5, j1: 7 };
export const DRAGON_GATE = { x: lineX(10), z: lineZ(8) - STRIP - 8 };

// ---------------------------------------------------------------------------
// Street helpers
// ---------------------------------------------------------------------------
export function streetNameAt(x, z) {
  if (z < CITY_MIN - 1) {
    const p = pierAt(x, z);
    return p ? p.name : 'Fisherman\'s Wharf';
  }
  if (x > CITY_MAX + 1) {
    const p = pierAt(x, z);
    return p ? p.name : 'The Embarcadero';
  }
  const ni = clamp(Math.round((x - ORIGIN) / S), 0, N);
  const nj = clamp(Math.round((z - ORIGIN) / S), 0, N);
  const adx = Math.abs(x - lineX(ni)), adz = Math.abs(z - lineZ(nj));
  if (adx <= STRIP && adz <= STRIP) return `${X_NAMES[ni].replace(/ (St|Ave)$/, '')} & ${Z_NAMES[nj].replace(/ (St|Ave)$/, '')}`;
  if (adx < adz) return X_NAMES[ni];
  const b = getBlock(Math.floor((x - ORIGIN) / S), Math.floor((z - ORIGIN) / S));
  if (adz > STRIP && adx > STRIP && b && b.name) return b.name;
  return Z_NAMES[nj];
}

// Point in the curb-side lane next to a block side ('N','S','W','E').
export function curbPoint(i, j, side, along = 0.5) {
  const b = BLOCKS[i][j];
  switch (side) {
    case 'N': return { x: lerp(b.x0, b.x1, along), z: lineZ(j) + LANES[1] };
    case 'S': return { x: lerp(b.x0, b.x1, along), z: lineZ(j + 1) - LANES[1] };
    case 'W': return { x: lineX(i) + LANES[1], z: lerp(b.z0, b.z1, along) };
    default: return { x: lineX(i + 1) - LANES[1], z: lerp(b.z0, b.z1, along) };
  }
}

// Sidewalk point next to a block side (where pedestrians / passengers stand).
export function sidewalkPoint(i, j, side, along = 0.5, inset = 2.0) {
  const b = BLOCKS[i][j];
  const off = ROAD_HALF + inset;
  switch (side) {
    case 'N': return { x: lerp(b.x0, b.x1, along), z: lineZ(j) + off, facing: Math.PI };
    case 'S': return { x: lerp(b.x0, b.x1, along), z: lineZ(j + 1) - off, facing: 0 };
    case 'W': return { x: lineX(i) + off, z: lerp(b.z0, b.z1, along), facing: -Math.PI / 2 };
    default: return { x: lineX(i + 1) - off, z: lerp(b.z0, b.z1, along), facing: Math.PI / 2 };
  }
}

// ---------------------------------------------------------------------------
// Destinations (Crazy Taxi style drop-off points)
// ---------------------------------------------------------------------------
const LANDMARK_DESTS = [
  { name: 'Coit Tower', ...curbPoint(10, 2, 'S'), icon: '🗼' },
  { name: 'Lombard Street', x: lineX(5) + 2, z: lineZ(3), icon: '🌺' },
  { name: 'Painted Ladies', ...curbPoint(1, 10, 'W'), icon: '🏠' },
  { name: 'Pier 39', x: 300, z: -522, icon: '🦭' },
  { name: "Fisherman's Wharf", x: 40, z: -499, icon: '🦀' },
  { name: 'Ghirardelli Square', ...curbPoint(3, 0, 'N'), icon: '🍫' },
  { name: 'Ferry Building', x: 500, z: 432, icon: '⛴️' },
  { name: 'Transamerica Pyramid', ...curbPoint(11, 5, 'W'), icon: '🔺' },
  { name: 'Union Square', ...curbPoint(8, 8, 'S'), icon: '🛍️' },
  { name: 'Chinatown Gate', x: DRAGON_GATE.x - 2, z: DRAGON_GATE.z - 18, icon: '🏮' },
  { name: 'Washington Square', ...curbPoint(9, 3, 'N'), icon: '⛪' },
  { name: 'Palace of Fine Arts', ...curbPoint(0, 0, 'E'), icon: '🏛️' },
  { name: 'City Hall', ...curbPoint(2, 10, 'S'), icon: '🏛️' },
  { name: 'Salesforce Tower', ...curbPoint(11, 10, 'W'), icon: '🏙️' },
  { name: 'Cable Car Turnaround', x: lineX(8), z: lineZ(12) - 6, icon: '🚋' },
  { name: 'Fairmont Hotel', ...curbPoint(7, 6, 'S'), icon: '🏨' },
  { name: 'Hyde St Pier', x: -89, z: -522, icon: '⛵' },
  { name: 'Marina Green', ...curbPoint(1, 0, 'N'), icon: '🪁' },
  { name: 'Embarcadero Center', ...curbPoint(11, 7, 'E'), icon: '🏢' },
  { name: 'Huntington Park', ...curbPoint(6, 6, 'N'), icon: '⛲' },
  { name: 'Alamo Square', ...curbPoint(0, 10, 'N'), icon: '🌳' },
];

const FUN_NAMES = [
  ['Startup HQ', '🚀'], ['Sourdough Bakery', '🥖'], ['Boba Tea Shop', '🧋'], ['Mission Burrito Co.', '🌯'],
  ['Crypto Bro Loft', '🪙'], ['Hot Yoga Studio', '🧘'], ['Vinyl Record Store', '💿'], ['Dim Sum Palace', '🥟'],
  ['Third Wave Coffee', '☕'], ['Tech Shuttle Stop', '🚌'], ['Artisanal Barber', '💈'], ['Kombucha Bar', '🫖'],
  ['Bouldering Gym', '🧗'], ['VC Office', '💼'], ['Dog Spa', '🐶'], ['Ramen House', '🍜'], ['Taqueria', '🌮'],
  ['Comedy Club', '🎤'], ['Retro Arcade', '🕹️'], ['Rooftop Bar', '🍸'], ['Vegan Donuts', '🍩'],
  ['Farmers Market', '🥕'], ['Art Gallery', '🖼️'], ['Hackathon', '💻'], ['Clam Chowder Stand', '🥣'],
  ['Pizza Slice Joint', '🍕'], ['Jazz Club', '🎷'], ['Bike Shop', '🚲'], ['Bookstore', '📚'], ['AI Lab', '🤖'],
];

export const DESTINATIONS = (() => {
  const rng = mulberry32(1337);
  const used = new Set(Object.keys(SPECIAL));
  const out = LANDMARK_DESTS.map((d) => ({ ...d, landmark: true }));
  const sides = ['N', 'S', 'W', 'E'];
  for (const [name, icon] of FUN_NAMES) {
    for (let tries = 0; tries < 60; tries++) {
      const i = Math.floor(rng() * N), j = Math.floor(rng() * N);
      const key = `${i},${j}`;
      if (used.has(key)) continue;
      used.add(key);
      const side = sides[Math.floor(rng() * 4)];
      const p = curbPoint(i, j, side, 0.3 + rng() * 0.4);
      out.push({ name, icon, x: p.x, z: p.z, block: [i, j, side], landmark: false });
      break;
    }
  }
  for (const d of out) d.y = groundHeight(d.x, d.z);
  return out;
})();

// ---------------------------------------------------------------------------
// Road graph (intersections) + routing with a turn penalty
// ---------------------------------------------------------------------------
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // +x, +z, -x, -z

export function nodePos(i, j) {
  return { x: lineX(i), z: lineZ(j) };
}

// Candidate graph nodes for a world position (nodes of the segment / nearest corners).
function anchorNodes(x, z) {
  const gx = clamp((x - ORIGIN) / S, 0, N), gz = clamp((z - ORIGIN) / S, 0, N);
  const ni = Math.round(gx), nj = Math.round(gz);
  const i0 = Math.floor(gx), j0 = Math.floor(gz);
  const set = new Map();
  const add = (i, j) => {
    i = clamp(i, 0, N); j = clamp(j, 0, N);
    set.set(i * 100 + j, [i, j]);
  };
  const adx = Math.abs(x - lineX(ni)), adz = Math.abs(z - lineZ(nj));
  if (adx <= STRIP && adz <= STRIP) add(ni, nj);
  else if (adx <= STRIP) { add(ni, j0); add(ni, j0 + 1); }
  else if (adz <= STRIP) { add(i0, nj); add(i0 + 1, nj); }
  else { add(i0, j0); add(i0 + 1, j0); add(i0, j0 + 1); add(i0 + 1, j0 + 1); }
  return [...set.values()];
}

// Dijkstra over (node, heading) states so routes prefer fewer turns.
export function findRoute(fx, fz, tx, tz, heading = null) {
  const starts = anchorNodes(fx, fz);
  const ends = anchorNodes(tx, tz);
  const SZ = (N + 1) * (N + 1) * 4;
  const dist = new Float32Array(SZ).fill(Infinity);
  const prev = new Int32Array(SZ).fill(-1);
  const open = [];
  const idx = (i, j, d) => ((i * (N + 1) + j) << 2) | d;
  for (const [i, j] of starts) {
    const p = nodePos(i, j);
    const d0 = Math.hypot(p.x - fx, p.z - fz);
    // penalize starting nodes behind us
    let pen = 0;
    if (heading) {
      const vx = p.x - fx, vz = p.z - fz;
      const l = Math.hypot(vx, vz) || 1;
      const dot = (vx * heading.x + vz * heading.z) / l;
      if (dot < -0.2 && l > STRIP) pen = 60;
    }
    for (let d = 0; d < 4; d++) {
      const k = idx(i, j, d);
      if (d0 + pen < dist[k]) { dist[k] = d0 + pen; open.push(k); }
    }
  }
  const endSet = new Map();
  for (const [i, j] of ends) {
    const p = nodePos(i, j);
    endSet.set(i * (N + 1) + j, Math.hypot(p.x - tx, p.z - tz));
  }
  let best = Infinity, bestK = -1;
  while (open.length) {
    // tiny graph: linear extraction is fine
    let mi = 0;
    for (let q = 1; q < open.length; q++) if (dist[open[q]] < dist[open[mi]]) mi = q;
    const k = open[mi];
    open[mi] = open[open.length - 1];
    open.pop();
    const cd = dist[k];
    if (cd >= best) continue;
    const node = k >> 2, d = k & 3;
    const i = Math.floor(node / (N + 1)), j = node % (N + 1);
    if (endSet.has(node)) {
      const total = cd + endSet.get(node);
      if (total < best) { best = total; bestK = k; }
    }
    for (let nd = 0; nd < 4; nd++) {
      const ni = i + DIRS[nd][0], nj = j + DIRS[nd][1];
      if (ni < 0 || nj < 0 || ni > N || nj > N) continue;
      const turn = nd === d ? 0 : (nd + 2) % 4 === d ? 40 : 18;
      const nk = idx(ni, nj, nd);
      const ndist = cd + S + turn;
      if (ndist < dist[nk]) { dist[nk] = ndist; prev[nk] = k; open.push(nk); }
    }
  }
  const pts = [];
  let k = bestK;
  while (k >= 0) {
    const node = k >> 2;
    const i = Math.floor(node / (N + 1)), j = node % (N + 1);
    if (!pts.length || pts[pts.length - 1].i !== i || pts[pts.length - 1].j !== j) pts.push({ i, j, ...nodePos(i, j) });
    k = prev[k];
  }
  pts.reverse();
  pts.push({ i: -1, j: -1, x: tx, z: tz });
  return pts;
}

export function routeLength(fx, fz, route) {
  let len = 0, px = fx, pz = fz;
  for (const p of route) { len += Math.hypot(p.x - px, p.z - pz); px = p.x; pz = p.z; }
  return len;
}

// Random point on a sidewalk (for pedestrians and passengers).
export function randomSidewalkSpot(rng, nearX = null, nearZ = null, radius = 400) {
  for (let tries = 0; tries < 50; tries++) {
    const i = Math.floor(rng() * N), j = Math.floor(rng() * N);
    const b = BLOCKS[i][j];
    if (b.landmark === 'palace') continue;
    const side = ['N', 'S', 'W', 'E'][Math.floor(rng() * 4)];
    const p = sidewalkPoint(i, j, side, 0.15 + rng() * 0.7, 1.4);
    if (nearX !== null && Math.hypot(p.x - nearX, p.z - nearZ) > radius) continue;
    p.y = groundHeight(p.x, p.z);
    p.block = b;
    p.side = side;
    return p;
  }
  return null;
}

export { smoothstep };
