// Per-district building generators. Each block is filled with lots along its perimeter;
// every lot becomes a building authored in a local frame (front at z=0 facing the street).
import * as THREE from 'three';
import { FacadeBuilder } from './FacadeBuilder.js';
import { FACADE } from './BuildingMaterial.js';
import { blockHeight, RAMP, STRIP, lineX, lineZ } from './CityLayout.js';
import { mulberry32, pick, range } from '../core/math.js';

const C = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

// Painted-lady palettes: [body, trim, accent]
const VICTORIAN = [
  ['#9fd8cf', '#fffaf0', '#2f5d62'], ['#f6c6d0', '#fff6ee', '#7a2e4a'], ['#ffe08a', '#ffffff', '#3d6b8c'],
  ['#b9d3f0', '#fffdf6', '#28466e'], ['#c9b6e4', '#fffbf2', '#4a2f6e'], ['#ffc49b', '#fff4e6', '#7a3b22'],
  ['#bfe3a5', '#ffffff', '#3b5f2b'], ['#f7a8a8', '#fff2ea', '#5b2333'], ['#9ad1f5', '#ffffff', '#c0392b'],
  ['#ffd3a5', '#fffaf2', '#2c7a7b'], ['#e8e3c9', '#ffffff', '#8c3b3b'], ['#a8e6e2', '#fffef6', '#d35400'],
  ['#f4e1ff', '#ffffff', '#6c3483'], ['#fdeab0', '#fffdf5', '#1f618d'], ['#d5f5e3', '#ffffff', '#117a65'],
];
const STUCCO = ['#f3e5c8', '#fbe3d0', '#e8f0e0', '#f6efe2', '#ffe9c2', '#e9dcd0', '#f8d9c4', '#dfe9f2'];
const STONE = ['#e7dcc6', '#d8cfbf', '#efe6d4', '#cfc7b8', '#e2d6c2', '#f1ebe0'];
const BRICKS = ['#a4523a', '#8f4a36', '#b5653f', '#9a5b45', '#7f3e2c', '#b87653'];
const OFFICE_WALL = ['#d9d4cc', '#bfc4c9', '#e6e1d8', '#a9b2ba', '#c8bfb2', '#dcd8d0'];
const GLASS_TINT = ['#5d9bc4', '#4f8a9e', '#7aa6c2', '#6f8fa8', '#8fb3c9', '#5f7f99', '#c9a86a', '#7fa38f'];
const CHINA = [['#c0392b', '#f4d03f'], ['#1e8449', '#f7dc6f'], ['#f5b7b1', '#922b21'], ['#fdebd0', '#c0392b'], ['#d4e6f1', '#1a5276'], ['#f9e79f', '#943126']];
const AWNINGS = [['#c0392b', '#ffffff'], ['#1e8449', '#ffffff'], ['#1f3a93', '#ffffff'], ['#7d3c98', '#f5f5f5'], ['#d35400', '#fdebd0'], ['#117864', '#f7f7f7'], ['#2c3e50', '#e74c3c']];
const SIGN_COLORS = ['#ff3b5c', '#ffd23f', '#3be8ff', '#7cff6b', '#ff8a3b', '#c77dff', '#ffffff'];
const ROOF = C('#6b6a68');
const ROOF_LIGHT = C('#8a8986');
const ROOFS = ['#5c5b59', '#6b6a68', '#4a4b4f', '#7d7a74', '#3f4145', '#8a847a', '#55504a', '#6f7468'].map(C);
const TILE = C('#b5523b');

// Split [a,b] into lots of random width in [minW,maxW]
function splitSpan(a, b, rng, minW, maxW) {
  const out = [];
  let x = a;
  while (b - x > minW * 1.6) {
    const w = Math.min(range(rng, minW, maxW), b - x - minW);
    out.push([x, x + w]);
    x += w;
  }
  out.push([x, b]);
  return out;
}

// Enumerate perimeter lots for a block (with local frames).
function perimeterLots(block, rng, minW, maxW, dMin, dMax, sides = ['N', 'S', 'W', 'E']) {
  const { x0, x1, z0, z1 } = block;
  const lots = [];
  const dN = range(rng, dMin, dMax), dS = range(rng, dMin, dMax);
  const dW = Math.min(range(rng, dMin, dMax), (x1 - x0) / 2 - 0.5);
  const dE = Math.min(range(rng, dMin, dMax), (x1 - x0) / 2 - 0.5);
  if (sides.includes('S'))
    for (const [a, b] of splitSpan(x0, x1, rng, minW, maxW))
      lots.push({ side: 'S', ox: (a + b) / 2, oz: z1, rot: 0, w: b - a, d: dS });
  if (sides.includes('N'))
    for (const [a, b] of splitSpan(x0, x1, rng, minW, maxW))
      lots.push({ side: 'N', ox: (a + b) / 2, oz: z0, rot: Math.PI, w: b - a, d: dN });
  const za = z0 + (sides.includes('N') ? dN : 0), zb = z1 - (sides.includes('S') ? dS : 0);
  if (zb - za > minW) {
    if (sides.includes('W'))
      for (const [a, b] of splitSpan(za, zb, rng, minW, maxW))
        lots.push({ side: 'W', ox: x0, oz: (a + b) / 2, rot: -Math.PI / 2, w: b - a, d: dW });
    if (sides.includes('E'))
      for (const [a, b] of splitSpan(za, zb, rng, minW, maxW))
        lots.push({ side: 'E', ox: x1, oz: (a + b) / 2, rot: Math.PI / 2, w: b - a, d: dE });
  }
  return lots;
}

// Ground info under a lot (in world space) from the block's eased bilinear ground.
function lotGround(block, lot) {
  const cs = Math.cos(lot.rot), sn = Math.sin(lot.rot);
  const toW = (x, z) => [lot.ox + x * cs + z * sn, lot.oz - x * sn + z * cs];
  const hAt = (wx, wz) => blockHeight(block.i, block.j, (wx - lineX(block.i) - STRIP) / RAMP, (wz - lineZ(block.j) - STRIP) / RAMP);
  const [fx, fz] = toW(0, 0);
  const front = hAt(fx, fz);
  let lo = front, hi = front;
  for (const [x, z] of [[-lot.w / 2, 0], [lot.w / 2, 0], [-lot.w / 2, -lot.d], [lot.w / 2, -lot.d]]) {
    const [wx, wz] = toW(x, z);
    const h = hAt(wx, wz);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  return { front, lo, hi };
}

// ---------------------------------------------------------------------------
// Building types (local frame). fb = detail builder, lb = LOD builder.
// ---------------------------------------------------------------------------
function victorian(fb, lb, lot, g, rng, opts = {}) {
  const pal = opts.palette || pick(rng, VICTORIAN);
  const body = C(pal[0]), trim = C(pal[1]), accent = C(pal[2]);
  const floors = opts.floors || (rng() < 0.55 ? 3 : 2);
  const fl = 3.5;
  const w = lot.w, d = lot.d;
  const y0 = g.front, yb = g.lo - 1.5;
  const ytop = y0 + floors * fl + 0.7;
  const seed = rng();
  for (const b of [fb, lb]) {
    b.setTransform(lot.ox, lot.oz, lot.rot);
    b.vOrigin = y0;
  }
  const wallA = { wall: body, trim, style: FACADE.RESIDENTIAL, spacing: Math.max(1.8, w / 3), floorH: fl, seed };
  const roofA = { wall: pick(rng, ROOFS), trim: ROOF, style: FACADE.ROOF, spacing: 4, floorH: 4, seed };
  // LOD: simple body
  lb.set(wallA);
  lb.box(-w / 2, yb, -d, w / 2, ytop, 0, { roof: roofA });
  // main body
  fb.set(wallA);
  fb.box(-w / 2, yb, -d, w / 2, ytop, 0, { roof: roofA });
  // bay window(s)
  const p = 0.85;
  const doubleBay = w > 8.6 && rng() < 0.4;
  const bays = doubleBay ? [-w / 4, w / 4] : [rng() < 0.5 ? -w * 0.2 : w * 0.2];
  const bw = doubleBay ? w * 0.4 : Math.min(w * 0.5, 4.4);
  const squareBay = rng() < 0.3;
  for (const bx of bays) {
    const ya = y0 + fl, yz = y0 + floors * fl;
    const l = bx - bw / 2, r = bx + bw / 2;
    const sl = squareBay ? 0 : p;
    const pts = [[l, 0], [l + sl, p], [r - sl, p], [r, 0]];
    fb.set({ ...wallA, spacing: 1.6 });
    for (let k = 0; k < 3; k++) {
      const a = pts[k], c = pts[k + 1];
      const segLen = Math.hypot(c[0] - a[0], c[1] - a[1]);
      fb.set({ spacing: segLen });
      fb.wall(a[0], a[1], c[0], c[1], ya, yz);
    }
    fb.set({ wall: trim, trim, style: FACADE.PLAIN });
    // bay roof cap & soffit
    fb.cap(pts, yz, 1);
    fb.cap(pts, ya, -1);
    // trim band under the bay
    fb.box(l - 0.05, ya - 0.3, 0, r + 0.05, ya, p + 0.08, {});
  }
  // floor trim bands
  fb.set({ wall: trim, trim, style: FACADE.PLAIN });
  for (let f = 1; f < floors; f++) {
    const y = y0 + f * fl;
    fb.box(-w / 2, y - 0.12, 0, w / 2, y + 0.06, 0.1, { faces: { n: false } });
  }
  // cornice + frieze
  fb.set({ wall: accent, trim, style: FACADE.PLAIN });
  fb.box(-w / 2, ytop - 1.25, 0, w / 2, ytop - 0.65, 0.18, { faces: { n: false } });
  fb.set({ wall: trim, trim, style: FACADE.PLAIN });
  fb.box(-w / 2 - 0.12, ytop - 0.65, -0.3, w / 2 + 0.12, ytop + 0.05, p + 0.45, {});
  // gable (Queen Anne) on some houses
  if (opts.gable || rng() < 0.38) {
    const gh = 2.2 + rng() * 1.2;
    fb.gableZ(-w / 2 + 0.2, -3.2, w / 2 - 0.2, p + 0.2, ytop + 0.05, gh,
      { wall: C('#4a4f57'), trim, style: FACADE.PLAIN },
      { wall: accent, trim, style: FACADE.PLAIN }, 0.3);
  }
  // garage / door at street level
  const gx = bays[0] > 0 ? -w / 2 + 0.6 : w / 2 - 3.4;
  if (rng() < 0.75 && w > 6.5) {
    fb.set({ wall: rng() < 0.5 ? trim : C('#3b3b3b'), trim, style: FACADE.PLAIN });
    fb.box(gx, y0, 0, gx + 2.8, y0 + 2.5, 0.07, { faces: { n: false } });
  }
  const dx = bays[0] > 0 ? w / 2 - 1.7 : -w / 2 + 0.6;
  fb.set({ wall: accent, trim, style: FACADE.PLAIN });
  fb.box(dx, y0, 0, dx + 1.1, y0 + 2.4, 0.06, { faces: { n: false } });
  fb.set({ wall: trim, trim, style: FACADE.PLAIN });
  fb.box(dx - 0.15, y0 + 2.4, 0, dx + 1.25, y0 + 2.75, 0.25, { faces: { n: false } });
  // chimney / roof bits
  if (rng() < 0.4) {
    fb.set({ wall: C('#8d4b3a'), trim, style: FACADE.PLAIN });
    const cx = range(rng, -w / 2 + 1, w / 2 - 1.6);
    fb.box(cx, ytop, -d * 0.6, cx + 0.7, ytop + 1.6, -d * 0.6 + 0.7, {});
  }
  rooftop(fb, rng, w, d, ytop, trim);
  // corner turret for corner lots
  if (opts.turret) {
    const r = 1.7, cx = opts.turret * (w / 2 - r + 0.3), cz = -r + 0.9;
    const pts = FacadeBuilder.circle(cx, cz, r, 12);
    fb.set({ ...wallA, spacing: 1.4 });
    fb.prism(pts, y0 + fl, ytop + 1.6, {});
    fb.cone(cx, cz, r + 0.25, ytop + 1.6, 3.6, 12, { wall: C('#3f4650'), trim, style: FACADE.PLAIN });
  }
  return ytop;
}

function marinaHouse(fb, lb, lot, g, rng) {
  const body = C(pick(rng, STUCCO)), trim = C('#fbfaf6');
  const floors = rng() < 0.5 ? 2 : 3, fl = 3.4;
  const w = lot.w, d = lot.d;
  const y0 = g.front, yb = g.lo - 1.5, ytop = y0 + floors * fl + 0.4;
  const seed = rng();
  for (const b of [fb, lb]) { b.setTransform(lot.ox, lot.oz, lot.rot); b.vOrigin = y0; }
  const wallA = { wall: body, trim, style: FACADE.STUCCO, spacing: 2.6, floorH: fl, seed };
  const tile = { wall: TILE, trim: TILE, style: FACADE.ROOF, spacing: 3, floorH: 3, seed };
  lb.set(wallA);
  lb.box(-w / 2, yb, -d, w / 2, ytop, 0, { roof: tile });
  fb.set(wallA);
  fb.box(-w / 2, yb, -d, w / 2, ytop, 0, { roof: tile });
  if (rng() < 0.7) fb.hipRoof(-w / 2, -d, w / 2, 0, ytop, 2.0 + rng(), tile, 0.45);
  // garage + arched entry
  fb.set({ wall: C('#f5f2ea'), trim, style: FACADE.PLAIN });
  fb.box(-w / 2 + 0.7, y0, 0, -w / 2 + 3.6, y0 + 2.5, 0.06, { faces: { n: false } });
  fb.set({ wall: C(pick(rng, ['#2e4a62', '#6b3a2a', '#2f5f4f'])), trim, style: FACADE.PLAIN });
  fb.box(w / 2 - 1.9, y0, 0, w / 2 - 0.8, y0 + 2.3, 0.06, { faces: { n: false } });
  // balcony rail on the upper floor
  if (floors > 2 && rng() < 0.5) {
    fb.set({ wall: C('#2b2b2b'), trim, style: FACADE.PLAIN });
    fb.box(-w / 2 + 1, y0 + 2 * fl, 0, w / 2 - 1, y0 + 2 * fl + 1.0, 0.9, { faces: { n: false } });
  }
  return ytop;
}

// Rooftop clutter: skylights, solar panels, decks with railings, vents
function rooftop(fb, rng, w, d, y, trim) {
  const r = rng();
  if (r < 0.22) {
    // solar panels
    fb.set({ wall: C('#1b2a4a'), trim: C('#9aa4ad'), style: FACADE.PLAIN });
    const n = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const x0 = -w / 2 + 0.8 + k * ((w - 1.6) / n);
      fb.box(x0, y + 0.15, -d * 0.75, x0 + (w - 1.6) / n - 0.3, y + 0.35, -d * 0.35, {});
    }
  } else if (r < 0.38) {
    // roof deck with railing
    fb.set({ wall: C('#9a7350'), trim, style: FACADE.PLAIN });
    fb.box(-w / 2 + 0.6, y, -d * 0.55, w / 2 - 0.6, y + 0.18, -1.2, {});
    fb.set({ wall: trim, trim, style: FACADE.PLAIN });
    fb.box(-w / 2 + 0.6, y + 0.18, -1.3, w / 2 - 0.6, y + 1.1, -1.2, { faces: { top: true } });
  } else if (r < 0.58) {
    // skylight
    fb.set({ wall: C('#7f97a8'), trim: C('#cfd6dc'), style: FACADE.PLAIN });
    const sx = range(rng, -w / 2 + 1.2, w / 2 - 2.6);
    fb.box(sx, y, -d * 0.5, sx + 1.4, y + 0.55, -d * 0.5 + 1.6, {});
  }
  if (rng() < 0.5) {
    fb.set({ wall: C('#9ea3a7'), trim, style: FACADE.PLAIN });
    const vx = range(rng, -w / 2 + 0.6, w / 2 - 0.8);
    fb.box(vx, y, -d * 0.3, vx + 0.3, y + 0.9, -d * 0.3 + 0.3, {});
  }
}

// Mixed-use block building (North Beach, Union Sq, Wharf, Nob Hill, Civic, SoMa, Chinatown)
function commercial(fb, lb, lot, g, rng, kind) {
  const w = lot.w, d = lot.d;
  let floors, fl, style, wall, trim;
  switch (kind) {
    case 'chinatown': {
      const cp = pick(rng, CHINA);
      floors = 3 + Math.floor(rng() * 3); fl = 3.4; style = FACADE.CHINATOWN;
      wall = C(cp[0]); trim = C(cp[1]);
      break;
    }
    case 'northbeach':
      floors = 3 + Math.floor(rng() * 2); fl = 3.6;
      style = rng() < 0.45 ? FACADE.STONE : rng() < 0.5 ? FACADE.BRICK : FACADE.STUCCO;
      wall = style === FACADE.BRICK ? C(pick(rng, BRICKS)) : C(pick(rng, [...STUCCO, ...STONE, '#f7d9a8', '#e8c4a0', '#cfe3d4']));
      trim = C(pick(rng, ['#f7f3ea', '#3b3b3b', '#2e5e4e', '#7a2e2e']));
      break;
    case 'nobhill':
      floors = 7 + Math.floor(rng() * 10); fl = 3.5; style = FACADE.STONE;
      wall = C(pick(rng, STONE)); trim = C('#f8f4ea');
      break;
    case 'civic':
      floors = 4 + Math.floor(rng() * 4); fl = 4.2; style = FACADE.STONE;
      wall = C(pick(rng, ['#dcdad4', '#e6e2d8', '#cfcac0'])); trim = C('#f6f3ec');
      break;
    case 'unionsq':
      floors = 5 + Math.floor(rng() * 8); fl = 4.0; style = rng() < 0.5 ? FACADE.STONE : FACADE.OFFICE;
      wall = C(pick(rng, [...STONE, ...OFFICE_WALL])); trim = C(pick(rng, ['#f2efe8', '#3d3d3d', '#5b6770']));
      break;
    case 'soma':
      floors = 3 + Math.floor(rng() * 4); fl = 4.4; style = FACADE.BRICK;
      wall = C(pick(rng, BRICKS)); trim = C(pick(rng, ['#2f3b34', '#e9e4da', '#3a3a3a']));
      break;
    case 'wharf':
    default:
      floors = 1 + Math.floor(rng() * 3); fl = 4.2;
      style = rng() < 0.5 ? FACADE.BRICK : FACADE.STUCCO;
      wall = style === FACADE.BRICK ? C(pick(rng, BRICKS)) : C(pick(rng, ['#f2e1c4', '#e0ecf2', '#f6d7c3', '#d8ead5', '#fff1c9']));
      trim = C(pick(rng, ['#ffffff', '#24435c', '#7a2e2e']));
      break;
  }
  const y0 = g.front, yb = g.lo - 1.5, ytop = y0 + floors * fl + 0.8;
  const seed = rng();
  for (const b of [fb, lb]) { b.setTransform(lot.ox, lot.oz, lot.rot); b.vOrigin = y0; }
  const spacing = style === FACADE.STONE ? 2.6 : style === FACADE.CHINATOWN ? 2.8 : 3.0;
  const wallA = { wall, trim, style, spacing, floorH: fl, seed };
  const roofA = { wall: pick(rng, ROOFS), trim: ROOF, style: FACADE.ROOF, spacing: 4, floorH: 4, seed };
  lb.set(wallA);
  lb.box(-w / 2, yb, -d, w / 2, ytop, 0, { roof: roofA });
  fb.set(wallA);
  fb.box(-w / 2, yb, -d, w / 2, ytop, 0, { roof: roofA });
  // cornice
  fb.set({ wall: trim, trim, style: FACADE.PLAIN });
  fb.box(-w / 2 - 0.1, ytop - 0.7, -0.25, w / 2 + 0.1, ytop + 0.1, 0.55, {});
  // storefront awnings
  if (kind !== 'nobhill' && kind !== 'civic' && rng() < 0.85) {
    const aw = pick(rng, AWNINGS);
    const nA = Math.max(1, Math.round(w / 7));
    const span = w / nA;
    for (let k = 0; k < nA; k++) {
      if (rng() < 0.25) continue;
      const a = -w / 2 + k * span + 0.4, b = a + span - 0.8;
      fb.awning(a, b, 0, 1.6, y0 + 3.4, 0.9, { wall: C(aw[0]), trim: C(aw[1]), style: FACADE.STRIPES, spacing: 0.9, floorH: 1, seed });
    }
  }
  // signs
  if ((kind === 'chinatown' || kind === 'northbeach' || kind === 'unionsq' || kind === 'wharf') && rng() < 0.7) {
    const sc = C(pick(rng, SIGN_COLORS));
    fb.set({ wall: sc, trim: sc, style: FACADE.SIGN });
    if (kind === 'chinatown' || rng() < 0.4) {
      // vertical blade sign
      const sx = rng() < 0.5 ? -w / 2 + 1.2 : w / 2 - 1.2;
      const sy = y0 + 4.2;
      fb.box(sx - 0.12, sy, 0.3, sx + 0.12, sy + Math.min(floors * fl - 4.5, 6 + rng() * 5), 1.6, {});
    } else {
      const sy = y0 + 3.6;
      fb.box(-w * 0.35, sy, 0, w * 0.35, sy + 1.0, 0.2, { faces: { n: false } });
    }
  }
  // chinatown balconies
  if (kind === 'chinatown') {
    fb.set({ wall: trim, trim: wall, style: FACADE.PLAIN });
    for (let f = 1; f < floors; f++) {
      if (rng() < 0.4) continue;
      const y = y0 + f * fl;
      fb.box(-w / 2 + 0.8, y, 0, w / 2 - 0.8, y + 0.15, 1.1, {});
      fb.box(-w / 2 + 0.8, y + 0.15, 1.0, w / 2 - 0.8, y + 1.0, 1.1, { faces: { n: false } });
    }
    if (rng() < 0.35) {
      // pagoda roof cap
      fb.set({ wall: C('#1e8449'), trim: C('#f4d03f'), style: FACADE.PLAIN });
      fb.hipRoof(-w / 2 + 0.5, -d + 1, w / 2 - 0.5, -1, ytop + 0.1, 2.2, { wall: C('#1e8449'), trim: C('#f4d03f'), style: FACADE.PLAIN }, 0.9);
    }
  }
  // fire escapes (North Beach / SoMa)
  if ((kind === 'northbeach' || kind === 'soma') && floors >= 3 && rng() < 0.5) {
    fb.set({ wall: C('#222426'), trim: C('#222426'), style: FACADE.PLAIN });
    const ex = range(rng, -w / 2 + 1.5, w / 2 - 4);
    for (let f = 1; f < floors; f++) {
      const y = y0 + f * fl + 0.05;
      fb.box(ex, y, 0, ex + 3, y + 0.08, 1.0, {});
      fb.box(ex, y + 0.08, 0.95, ex + 3, y + 1.0, 1.0, { faces: { n: false } });
    }
  }
  // rooftop: water tank / AC units
  if (rng() < (kind === 'soma' || kind === 'northbeach' ? 0.45 : 0.25)) {
    const tx = range(rng, -w / 2 + 2, w / 2 - 2), tz = -d * range(rng, 0.3, 0.7);
    fb.set({ wall: C('#6e5a44'), trim: C('#3a2f24'), style: FACADE.PLAIN });
    fb.prism(FacadeBuilder.circle(tx, tz, 1.4, 10), ytop + 2.2, ytop + 5.0, { roof: { wall: C('#4d4036'), style: FACADE.PLAIN } });
    fb.cone(tx, tz, 1.55, ytop + 5.0, 1.0, 10, { wall: C('#4d4036'), style: FACADE.PLAIN });
    fb.set({ wall: C('#2f2f2f'), style: FACADE.PLAIN });
    for (const [ax, az] of [[-0.9, -0.9], [0.9, -0.9], [0.9, 0.9], [-0.9, 0.9]]) fb.box(tx + ax - 0.1, ytop, tz + az - 0.1, tx + ax + 0.1, ytop + 2.2, tz + az + 0.1, {});
  } else if (rng() < 0.6) {
    fb.set({ wall: C('#b8bcbf'), trim: C('#8a8f93'), style: FACADE.PLAIN });
    const n = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const tx = range(rng, -w / 2 + 1.5, w / 2 - 3), tz = -d * range(rng, 0.2, 0.8);
      fb.box(tx, ytop, tz, tx + 1.6 + rng(), ytop + 1.2, tz + 1.4, {});
    }
  }
  return ytop;
}

// Financial District tower with setbacks
function tower(fb, lb, lot, g, rng, opts = {}) {
  const w = lot.w, d = lot.d;
  const y0 = g.front, yb = g.lo - 2;
  const seed = rng();
  for (const b of [fb, lb]) { b.setTransform(lot.ox, lot.oz, lot.rot); b.vOrigin = y0; }
  const glass = rng() < 0.6;
  const fl = 3.8;
  const tint = C(pick(rng, GLASS_TINT));
  const wall = glass ? C(pick(rng, ['#c9d3dc', '#d7dde2', '#aab5bf', '#e0e4e8'])) : C(pick(rng, OFFICE_WALL));
  const style = glass ? FACADE.CURTAIN : rng() < 0.6 ? FACADE.OFFICE : FACADE.STONE;
  const floors = opts.floors || Math.floor(range(rng, 12, 42));
  const H = floors * fl;
  const roofA = { wall: ROOF_LIGHT, trim: ROOF, style: FACADE.ROOF, spacing: 4, floorH: 4, seed };
  // podium
  const podH = fl * (2 + Math.floor(rng() * 3));
  const podA = { wall: C(pick(rng, STONE)), trim: C('#2d3238'), style: FACADE.OFFICE, spacing: 3.2, floorH: fl, seed };
  fb.set(podA);
  fb.box(-w / 2, yb, -d, w / 2, y0 + podH, 0, { roof: roofA });
  lb.set(podA);
  lb.box(-w / 2, yb, -d, w / 2, y0 + podH, 0, { roof: roofA });
  // shaft (with optional chamfer) and setbacks
  let inset = 2.5 + rng() * 2;
  let yA = y0 + podH;
  const tiers = rng() < 0.5 ? 2 : 3;
  const tierH = (H - podH) / tiers;
  const chamf = rng() < 0.35;
  for (let t = 0; t < tiers; t++) {
    const x0 = -w / 2 + inset, x1 = w / 2 - inset, z0 = -d + inset, z1 = -inset;
    if (x1 - x0 < 6 || z1 - z0 < 6) break;
    const yB = yA + tierH * (t === 0 ? 1.15 : 0.95);
    const sA = { wall: glass ? tint : wall, trim: glass ? wall : C('#3a4048'), style, spacing: glass ? 1.6 : 2.4, floorH: fl, seed };
    const pts = chamf ? FacadeBuilder.chamfer(x0, z0, x1, z1, Math.min(4, (x1 - x0) * 0.15)) : FacadeBuilder.rect(x0, z0, x1, z1);
    fb.set(sA);
    fb.prism(pts, yA, yB, { roof: roofA });
    lb.set(sA);
    lb.prism(pts, yA, yB, { roof: roofA });
    // crown band
    fb.set({ wall: glass ? wall : C('#e8e4dc'), trim: wall, style: FACADE.PLAIN });
    fb.prism(pts, yB - 0.2, yB + 1.0, {});
    yA = yB;
    inset += 2 + rng() * 3;
  }
  // mechanical penthouse + antenna
  fb.set({ wall: C('#9aa1a8'), trim: C('#6c737a'), style: FACADE.PLAIN });
  fb.box(-4, yA, -d / 2 - 4, 4, yA + 4, -d / 2 + 4, {});
  if (rng() < 0.5) {
    fb.set({ wall: C('#d0d0d0'), style: FACADE.PLAIN });
    fb.box(-0.3, yA + 4, -d / 2 - 0.3, 0.3, yA + 4 + range(rng, 10, 26), -d / 2 + 0.3, {});
    fb.set({ wall: C('#ff2a2a'), trim: C('#ff2a2a'), style: FACADE.SIGN });
    fb.box(-0.4, yA + 4 + 26, -d / 2 - 0.4, 0.4, yA + 4 + 26.6, -d / 2 + 0.4, {});
  }
  return yA;
}

// ---------------------------------------------------------------------------
export function buildBlock(block, opts = {}) {
  const fb = opts.fb || new FacadeBuilder();
  const lb = opts.lb || new FacadeBuilder();
  const rng = mulberry32(block.i * 7919 + block.j * 104729 + 17);
  let maxH = 0;
  const dist = block.district;
  const lotsFor = () => {
    switch (dist) {
      case 'fidi': return perimeterLots(block, rng, 24, 34, 24, 27);
      case 'nobhill': case 'civic': return perimeterLots(block, rng, 18, 30, 18, 24);
      case 'unionsq': return perimeterLots(block, rng, 14, 24, 16, 24);
      case 'soma': return perimeterLots(block, rng, 12, 22, 16, 24);
      case 'wharf': return perimeterLots(block, rng, 9, 16, 12, 20);
      case 'northbeach': case 'chinatown': return perimeterLots(block, rng, 7, 12, 14, 20);
      case 'marina': return perimeterLots(block, rng, 8, 11.5, 15, 19);
      default: return perimeterLots(block, rng, 6.8, 9.2, 17, 21);
    }
  };
  const lots = opts.lots || lotsFor();
  const nLots = lots.length;
  lots.forEach((lot, k) => {
    const g = lotGround(block, lot);
    let h = 0;
    const corner = k === 0 || k === nLots - 1;
    switch (dist) {
      case 'fidi':
        h = tower(fb, lb, lot, g, rng, {});
        break;
      case 'nobhill': case 'civic': case 'unionsq': case 'soma': case 'wharf': case 'northbeach': case 'chinatown':
        h = commercial(fb, lb, lot, g, rng, dist);
        break;
      case 'marina':
        h = marinaHouse(fb, lb, lot, g, rng);
        break;
      case 'painted':
        h = victorian(fb, lb, lot, g, rng, { floors: 3, gable: lot.side === 'W', palette: lot.side === 'W' ? VICTORIAN[k % VICTORIAN.length] : null });
        break;
      default:
        h = victorian(fb, lb, lot, g, rng, { turret: corner && rng() < 0.6 ? (rng() < 0.5 ? -1 : 1) : 0 });
    }
    maxH = Math.max(maxH, h);
  });
  // interior courtyard fill (low roofs so the block never looks hollow from above)
  if (!opts.lots) {
    const inset = dist === 'fidi' ? 20 : 15;
    const x0 = block.x0 + inset, x1 = block.x1 - inset, z0 = block.z0 + inset, z1 = block.z1 - inset;
    if (x1 > x0 && z1 > z0) {
      const cy = blockHeight(block.i, block.j, 0.5, 0.5);
      fb.setTransform(0, 0, 0);
      fb.vOrigin = cy;
      fb.set({ wall: C('#7b7a74'), trim: ROOF, style: FACADE.PLAIN });
      fb.box(x0, cy - 6, z0, x1, cy + 4.5, z1, { roof: { wall: C('#5d7a46'), style: FACADE.ROOF, seed: 0.5 } });
    }
  }
  return { fb, lb, maxH };
}

export { perimeterLots, lotGround, victorian, commercial, tower, VICTORIAN, C };
