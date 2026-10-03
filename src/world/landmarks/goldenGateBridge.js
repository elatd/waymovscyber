// Golden Gate Bridge — deck along local Z, water surface at y = 0.
// -Z end = San Francisco (south), +Z end = Marin (north).

import {
  LandmarkBuilder, std, glow, tint, boxMM, rboxMM, beam, rod, tubeGeo, prismGeo, cylY, sphereGeo,
  planeGeo, V, M, noise3, smoothstep, clamp01,
} from './common.js';
import * as THREE from 'three';

export const GOLDEN_GATE = Object.freeze({
  deckY: 42, // top of road surface
  halfWidth: 13.5, // deck edge
  roadHalfWidth: 9.6, // curb line (6 lanes between)
  towerZ: 320,
  anchorageZ: 490,
  endZ: 560,
  towerTopY: 145,
  cableX: 13.6,
});

const ORANGE = 0xc8352b;
const DECK = GOLDEN_GATE.deckY;
const CX = GOLDEN_GATE.cableX;
const TZ = GOLDEN_GATE.towerZ;
const LEG_X = 14;

/** Main-cable centre height for |z| <= 482 (parabolic main span, sagging side spans). */
export function goldenGateCableY(z) {
  const a = Math.abs(z);
  if (a <= TZ) return 46.5 + 96.5 * (a / TZ) ** 2;
  const t = clamp01((a - TZ) / 162);
  return 143 + (46.2 - 143) * t - 6 * 4 * t * (1 - t);
}

/** Fluted leg cross-section: stepped corners plus a recessed groove on every face. */
function legOutline(hx, hz, extraGrooves = true) {
  const s = Math.min(0.55, hx * 0.14);
  const g = hz * 0.16;
  const g2 = hx * 0.18;
  const d = 0.5;
  const q1 = [[hx - d, g], [hx, g]];
  if (extraGrooves) {
    const zc = hz * 0.52, g3 = hz * 0.07;
    q1.push([hx, zc - g3], [hx - d * 0.7, zc - g3], [hx - d * 0.7, zc + g3], [hx, zc + g3]);
  }
  q1.push(
    [hx, hz - 2 * s], [hx - s, hz - 2 * s], [hx - s, hz - s],
    [hx - 2 * s, hz - s], [hx - 2 * s, hz], [g2, hz], [g2, hz - d],
  );
  const q2 = q1.slice().reverse().map(([x, z]) => [-x, z]);
  const q3 = q1.map(([x, z]) => [-x, -z]);
  const q4 = q1.slice().reverse().map(([x, z]) => [x, -z]);
  return [...q1, ...q2, ...q3, ...q4];
}

// leg tiers: [y0, y1, hx, hz] — setbacks at every portal strut
const TIERS = [
  [8, 42, 3.6, 5.2],
  [42, 74, 3.35, 4.9],
  [74, 101, 3.1, 4.6],
  [101, 124, 2.85, 4.3],
  [124, 141, 2.6, 4.0],
  [141, 144, 2.3, 3.6],
];
// portal struts above the deck: [yBottom, yTop]
const STRUTS = [
  [67, 74],
  [95, 101],
  [118, 124],
  [134.5, 141],
];

function tierAt(y) {
  for (const t of TIERS) if (y >= t[0] && y <= t[1]) return t;
  return TIERS[TIERS.length - 1];
}

export function createGoldenGateBridge() {
  const B = new LandmarkBuilder('GoldenGateBridge');

  // ---------------------------------------------------------------- materials
  const towerMat = glow({ name: 'ggb-tower', color: 0xffffff, vertexColors: true, roughness: 0.48, metalness: 0.3, emissive: ORANGE }, 0.22);
  const steelMat = std({ name: 'ggb-steel', color: 0xffffff, vertexColors: true, roughness: 0.52, metalness: 0.3 });
  const concreteMat = std({ name: 'ggb-concrete', color: 0xffffff, vertexColors: true, roughness: 0.92, metalness: 0 });
  const asphaltMat = std({ name: 'ggb-asphalt', color: 0x2a2c30, roughness: 0.9, metalness: 0 });
  const paintMat = std({ name: 'ggb-markings', color: 0xffffff, vertexColors: true, roughness: 0.65 });
  const beaconMat = glow({ name: 'ggb-beacon', color: 0x5a0a06, emissive: 0xff2010, roughness: 0.35 }, 7);
  const lampMat = glow({ name: 'ggb-lamps', color: 0xe8e2d0, emissive: 0xffc27a, roughness: 0.3 }, 5);

  const tower = B.part('tower', towerMat);
  const steel = B.part('steel', steelMat);
  const concrete = B.part('concrete', concreteMat);
  const asphalt = B.part('asphalt', asphaltMat, { castShadow: false });
  const paint = B.part('markings', paintMat, { castShadow: false });
  const beacons = B.part('beacons', beaconMat, { castShadow: false, receiveShadow: false });
  const lamps = B.part('lamps', lampMat, { castShadow: false, receiveShadow: false });

  // ---------------------------------------------------------------- colours
  const base = new THREE.Color(ORANGE);
  const orangeTower = (x, y, z, nx, ny, nz, out) => {
    const n = noise3(x * 0.07, y * 0.035, z * 0.07);
    const grime = 0.86 + 0.14 * smoothstep(6, 70, y);
    const k = grime * (0.93 + 0.12 * n) * (ny > 0.5 ? 1.06 : 1);
    out.setRGB(base.r * k, base.g * k, base.b * k);
  };
  const orangeSteel = (x, y, z, nx, ny, nz, out) => {
    const n = noise3(x * 0.2, y * 0.2, z * 0.02);
    const under = y < DECK - 0.5 ? 0.84 : 1; // fake occlusion under the deck
    const k = under * (0.92 + 0.12 * n);
    out.setRGB(base.r * k, base.g * k * 0.98, base.b * k);
  };
  const concreteC = (x, y, z, nx, ny, nz, out) => {
    const n = noise3(x * 0.15, y * 0.15, z * 0.15);
    const wet = 1 - 0.38 * (1 - smoothstep(-1, 2.5, y));
    const k = (0.9 + 0.16 * n) * wet;
    out.setRGB(0.5 * k, 0.48 * k, 0.44 * k);
  };
  const deckConcrete = tint(0x9a968e, 0.05, 0.05);
  const curbC = tint(0xb4b0a6, 0.04, 0.1);

  // ---------------------------------------------------------------- towers
  for (const zc of [-TZ, TZ]) {
    for (const sx of [-1, 1]) {
      const cx = sx * LEG_X;
      TIERS.forEach(([y0, y1, hx, hz], i) => {
        const pts = legOutline(hx, hz).map(([x, z]) => [cx + x, zc + z]);
        tower.add(prismGeo(pts, pts, y0, y1, { capBottom: i === 0 }), null, orangeTower);
      });
      // cable saddle housing
      tower.add(rboxMM(cx - 1.7, 143.2, zc - 3.3, cx + 1.7, 145, zc + 3.3, 0.7, 2), null, orangeTower);
      // pedestal
      concrete.add(rboxMM(cx - 4.5, 6.5, zc - 6.2, cx + 4.5, 9.5, zc + 6.2, 0.4), null, concreteC);
      // aircraft warning beacon
      beacons.add(sphereGeo(0.75, 10, 6), [cx, 145.7, zc]);
      B.collider(cx, zc, 3.7, 5.3, GOLDEN_GATE.towerTopY);
    }

    // portal struts above the deck, with art-deco ribs and stepped opening corners
    for (const [ya, yb] of STRUTS) {
      const [, , hx] = tierAt((ya + yb) / 2);
      const xi = LEG_X - hx; // inner face of the legs
      tower.add(boxMM(-xi - 0.3, ya + 0.7, zc - 2.4, xi + 0.3, yb - 0.7, zc + 2.4), null, orangeTower);
      tower.add(boxMM(-xi - 0.3, yb - 0.7, zc - 3.0, xi + 0.3, yb, zc + 3.0), null, orangeTower);
      tower.add(boxMM(-xi - 0.3, ya, zc - 3.0, xi + 0.3, ya + 0.7, zc + 3.0), null, orangeTower);
      const nR = 6;
      for (let r = 0; r < nR; r++) {
        const xr = -xi + ((r + 0.5) / nR) * 2 * xi;
        for (const fz of [-1, 1]) {
          const z0 = zc + fz * 2.35, z1 = zc + fz * 2.85;
          tower.add(boxMM(xr - 0.45, ya + 0.7, Math.min(z0, z1), xr + 0.45, yb - 0.7, Math.max(z0, z1)), null, orangeTower);
        }
      }
      // stepped corbels at the top corners of the opening below the strut
      for (const s of [-1, 1]) {
        const xin = s * xi;
        tower.add(boxMM(Math.min(xin, xin - s * 1.8), ya - 0.9, zc - 2.2, Math.max(xin, xin - s * 1.8), ya, zc + 2.2), null, orangeTower);
        tower.add(boxMM(Math.min(xin, xin - s * 0.9), ya - 1.8, zc - 2.0, Math.max(xin, xin - s * 0.9), ya - 0.9, zc + 2.0), null, orangeTower);
      }
    }

    // below-deck strut and X-bracing
    const xi1 = LEG_X - TIERS[0][2];
    tower.add(boxMM(-xi1 - 0.3, 28.5, zc - 2.6, xi1 + 0.3, 33.6, zc + 2.6), null, orangeTower);
    tower.add(beam(V(-xi1, 10.5, zc), V(xi1, 28.6, zc), 1.6, 2.6, V(0, 0, 1)), null, orangeTower);
    tower.add(beam(V(xi1, 10.5, zc), V(-xi1, 28.6, zc), 1.6, 2.6, V(0, 0, 1)), null, orangeTower);

    // pier
    concrete.add(rboxMM(-21, -4, zc - 12, 21, 8, zc + 12, 1.6, 2), null, concreteC);
    B.collider(0, zc, 21, 12, 8);
  }

  // south tower fender ring (stadium shape)
  {
    const zc = -TZ;
    const pts = [];
    const R = 15.5, L = 8.5;
    for (let i = 0; i <= 12; i++) {
      const a = -Math.PI / 2 + (i / 12) * Math.PI;
      pts.push([L + R * Math.cos(a), R * Math.sin(a)]);
    }
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI / 2 + (i / 12) * Math.PI;
      pts.push([-L + R * Math.cos(a), R * Math.sin(a)]);
    }
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const a = V(p[0], 1.5, zc + p[1]), b = V(q[0], 1.5, zc + q[1]);
      const dir = b.clone().sub(a).normalize().multiplyScalar(0.6);
      concrete.add(beam(a.clone().sub(dir), b.clone().add(dir), 2.6, 7.5, V(0, 1, 0)), null, concreteC);
    }
    B.collider(0, zc - R, L + 2, 1.5, 5.25);
    B.collider(0, zc + R, L + 2, 1.5, 5.25);
    B.collider(-(L + R) + 3, zc, 4, R - 1, 5.25);
    B.collider(L + R - 3, zc, 4, R - 1, 5.25);
  }

  // ---------------------------------------------------------------- deck
  const legHz = TIERS[0][3] + 0.1;
  const legInner = LEG_X - TIERS[0][2] - 0.1;
  const AZ0 = 476, AZ1 = 532, ABUT = 552, END = GOLDEN_GATE.endZ;

  // structural slab (full width, narrowed between the tower legs)
  for (const s of [-1, 1]) {
    const segs = [
      [0, TZ - legHz, 13.5],
      [TZ - legHz, TZ + legHz, legInner],
      [TZ + legHz, END, 13.5],
    ];
    for (const [z0, z1, hw] of segs) {
      const a = s * z0, b = s * z1;
      concrete.add(boxMM(-hw, DECK - 0.8, Math.min(a, b), hw, DECK - 0.05, Math.max(a, b)), null, deckConcrete);
    }
  }
  // asphalt
  asphalt.add(boxMM(-9.6, DECK - 0.1, -END, 9.6, DECK, END));

  // sidewalks, outer railings and inner barriers (broken by tower legs & cable housings)
  const walkRanges = [];
  {
    const breaks = [[-532, -476], [-TZ - legHz, -TZ + legHz], [TZ - legHz, TZ + legHz], [476, 532]];
    let z = -END;
    for (const [b0, b1] of breaks) {
      walkRanges.push([z, b0]);
      z = b1;
    }
    walkRanges.push([z, END]);
  }
  const railBreaks = [[-TZ - legHz, -TZ + legHz], [TZ - legHz, TZ + legHz], [-500.5, -477.5], [477.5, 500.5]];
  const railRanges = [];
  {
    let z = -END;
    for (const [b0, b1] of railBreaks.sort((p, q) => p[0] - q[0])) {
      railRanges.push([z, b0]);
      z = b1;
    }
    railRanges.push([z, END]);
  }
  for (const sx of [-1, 1]) {
    for (const [z0, z1] of walkRanges) {
      concrete.add(boxMM(sx > 0 ? 9.6 : -13.4, DECK - 0.1, z0, sx > 0 ? 13.4 : -9.6, DECK + 0.22, z1), null, curbC);
    }
    for (const [z0, z1] of railRanges) {
      if (z1 - z0 < 1) continue;
      // outer pedestrian railing
      const xr = sx * 13.25;
      steel.add(boxMM(xr - 0.09, DECK + 1.28, z0, xr + 0.09, DECK + 1.42, z1), null, orangeSteel);
      steel.add(boxMM(xr - 0.06, DECK + 0.42, z0, xr + 0.06, DECK + 0.52, z1), null, orangeSteel);
      const nPost = Math.max(1, Math.round((z1 - z0) / 1.5));
      for (let i = 0; i <= nPost; i++) {
        const z = z0 + ((z1 - z0) * i) / nPost;
        steel.add(boxMM(xr - 0.06, DECK + 0.22, z - 0.05, xr + 0.06, DECK + 1.3, z + 0.05), null, orangeSteel);
      }
    }
    // inner (road-side) barrier along the curb
    for (const [z0, z1] of walkRanges) {
      const xb = sx * 9.78;
      steel.add(boxMM(xb - 0.14, DECK + 0.5, z0, xb + 0.14, DECK + 0.75, z1), null, orangeSteel);
      steel.add(boxMM(xb - 0.12, DECK + 0.95, z0, xb + 0.12, DECK + 1.12, z1), null, orangeSteel);
      const nPost = Math.max(1, Math.round((z1 - z0) / 4));
      for (let i = 0; i <= nPost; i++) {
        const z = z0 + ((z1 - z0) * i) / nPost;
        steel.add(boxMM(xb - 0.1, DECK + 0.22, z - 0.1, xb + 0.1, DECK + 1.12, z + 0.1), null, orangeSteel);
      }
    }
  }
  // median barrier
  concrete.add(boxMM(-0.3, DECK - 0.05, -END, 0.3, DECK + 0.8, END), null, tint(0xc9c4b8, 0.04, 0.2));

  // pedestrian walkway wrapping around the outside of each tower leg
  for (const zc of [-TZ, TZ]) {
    for (const sx of [-1, 1]) {
      const xo0 = sx * (LEG_X + TIERS[0][2] + 0.05), xo1 = sx * (LEG_X + TIERS[0][2] + 2.3);
      const zA = zc - legHz - 1.6, zB = zc + legHz + 1.6;
      const lo = Math.min(xo0, xo1), hi = Math.max(xo0, xo1);
      concrete.add(boxMM(lo, DECK - 0.1, zA, hi, DECK + 0.22, zB), null, curbC);
      for (const [z0, z1] of [[zA, zc - legHz], [zc + legHz, zB]]) {
        concrete.add(boxMM(Math.min(sx * 13.4, xo0), DECK - 0.1, z0, Math.max(sx * 13.4, xo0), DECK + 0.22, z1), null, curbC);
      }
      const xr = sx * (LEG_X + TIERS[0][2] + 2.2);
      steel.add(boxMM(xr - 0.08, DECK + 1.28, zA, xr + 0.08, DECK + 1.42, zB), null, orangeSteel);
      for (let z = zA; z <= zB + 0.01; z += 1.5) steel.add(boxMM(xr - 0.06, DECK + 0.22, z - 0.05, xr + 0.06, DECK + 1.3, z + 0.05), null, orangeSteel);
      for (const zz of [zA, zB]) {
        const a = Math.min(sx * 13.25, xr), b = Math.max(sx * 13.25, xr);
        steel.add(boxMM(a, DECK + 1.28, zz - 0.08, b, DECK + 1.42, zz + 0.08), null, orangeSteel);
      }
      // brackets under the walkway
      for (const z of [zA + 0.6, zc, zB - 0.6]) {
        steel.add(beam(V(xo0, DECK - 3.5, z), V((xo0 + xo1) / 2 + sx * 0.8, DECK - 0.15, z), 0.35, 0.35, V(0, 0, 1)), null, orangeSteel);
      }
    }
  }

  // lane markings
  const white = new THREE.Color(0xf4f4ee), yellow = new THREE.Color(0xf2c21a);
  for (const sx of [-1, 1]) {
    // edge lines + yellow median lines (solid)
    paint.add(planeGeo(0.18, 2 * END), M(sx * 9.25, DECK + 0.025, 0, -Math.PI / 2), white);
    paint.add(planeGeo(0.14, 2 * END), M(sx * 0.6, DECK + 0.025, 0, -Math.PI / 2), yellow);
    for (const lx of [3.2, 6.4]) {
      for (let z = -END + 4; z < END - 4; z += 12) {
        paint.add(planeGeo(0.15, 3), M(sx * lx, DECK + 0.025, z + 1.5, -Math.PI / 2), white);
      }
    }
  }

  // ---------------------------------------------------------------- stiffening truss
  const TOP_C0 = DECK - 1.35, TOP_C1 = DECK - 0.25; // top chord
  const BOT_C0 = DECK - 7.8, BOT_C1 = DECK - 6.8; // bottom chord
  const trussSpans = [
    [-TZ + legHz, TZ - legHz],
    [TZ + legHz, AZ0],
    [-AZ0, -TZ - legHz],
    [AZ1, ABUT],
    [-ABUT, -AZ1],
  ];
  for (const [z0, z1] of trussSpans) {
    const n = Math.max(2, Math.round((z1 - z0) / 7.6));
    const L = (z1 - z0) / n;
    for (const sx of [-1, 1]) {
      const x = sx * CX;
      steel.add(boxMM(x - 0.45, TOP_C0, z0, x + 0.45, TOP_C1, z1), null, orangeSteel);
      steel.add(boxMM(x - 0.45, BOT_C0, z0, x + 0.45, BOT_C1, z1), null, orangeSteel);
      for (let k = 0; k <= n; k++) {
        const z = z0 + k * L;
        steel.add(boxMM(x - 0.32, BOT_C1, z - 0.3, x + 0.32, TOP_C0, z + 0.3), null, orangeSteel);
        if (k < n) {
          const up = k % 2 === 0;
          const a = V(x, up ? BOT_C1 : TOP_C0, z);
          const b = V(x, up ? TOP_C0 : BOT_C1, z + L);
          steel.add(beam(a, b, 0.5, 0.55, V(1, 0, 0)), null, orangeSteel);
        }
      }
    }
    // floor beams, bottom lateral bracing and sway frames
    for (let k = 0; k <= n; k++) {
      const z = z0 + k * L;
      steel.add(boxMM(-CX, DECK - 1.5, z - 0.35, CX, DECK - 0.8, z + 0.35), null, orangeSteel);
      if (k < n) {
        const yb = (BOT_C0 + BOT_C1) / 2;
        steel.add(beam(V(-CX, yb, z), V(CX, yb, z + L), 0.35, 0.35), null, orangeSteel);
        steel.add(beam(V(CX, yb, z), V(-CX, yb, z + L), 0.35, 0.35), null, orangeSteel);
      }
      if (k % 2 === 0) {
        steel.add(beam(V(-CX, BOT_C1, z), V(0, DECK - 1.5, z), 0.35, 0.35, V(0, 0, 1)), null, orangeSteel);
        steel.add(beam(V(CX, BOT_C1, z), V(0, DECK - 1.5, z), 0.35, 0.35, V(0, 0, 1)), null, orangeSteel);
      }
    }
  }

  // ---------------------------------------------------------------- main cables & suspenders
  const cableR = 0.8;
  for (const sx of [-1, 1]) {
    const x = sx * CX;
    steel.add(tubeGeo((t, v) => {
      const z = -TZ + 2 * TZ * t;
      return v.set(x, goldenGateCableY(z), z);
    }, 110, cableR, 10), null, orangeSteel);
    for (const s of [-1, 1]) {
      steel.add(tubeGeo((t, v) => {
        const z = s * (TZ + 168 * t);
        return v.set(x, goldenGateCableY(Math.min(Math.abs(z), 482)) - (Math.abs(z) > 482 ? (Math.abs(z) - 482) * 0.5 : 0), z);
      }, 36, cableR, 10), null, orangeSteel);
    }
  }
  const hangerZ = [];
  for (let k = 1; k <= 42; k++) hangerZ.push(-TZ + 15 * k);
  for (let k = 1; k <= 10; k++) hangerZ.push(TZ + 15 * k, -TZ - 15 * k);
  for (const z of hangerZ) {
    const yc = goldenGateCableY(z);
    const slope = (goldenGateCableY(z + 0.5) - goldenGateCableY(z - 0.5)) / 1;
    const tan = V(0, slope, 1).normalize().multiplyScalar(0.75);
    for (const sx of [-1, 1]) {
      const x = sx * CX;
      // cable band
      steel.add(rod(V(x, yc, z).sub(tan), V(x, yc, z).add(tan), cableR + 0.22, 10, false), null, orangeSteel);
      // pair of suspender ropes
      for (const dz of [-0.32, 0.32]) {
        steel.add(rod(V(x, yc - cableR * 0.6, z + dz), V(x, TOP_C1, z + dz), 0.175, 6, true), null, orangeSteel);
      }
    }
  }

  // ---------------------------------------------------------------- anchorages, pylons, approach
  for (const s of [-1, 1]) {
    const za = s * AZ0, zb = s * AZ1;
    concrete.add(rboxMM(-25, -3, Math.min(za, zb), 25, DECK - 0.8, Math.max(za, zb), 1.2, 1), null, concreteC);
    // stepped base so it reads as a massive block from the water
    concrete.add(rboxMM(-26.5, -3, Math.min(za, zb) - 2, 26.5, 6, Math.max(za, zb) + 2, 0.8, 1), null, concreteC);
    // art-deco pilasters and cornice
    const zlo = Math.min(za, zb), zhi = Math.max(za, zb);
    for (let i = 0; i <= 8; i++) {
      const z = zlo + 3 + ((zhi - zlo - 6) * i) / 8;
      for (const sx of [-1, 1]) {
        concrete.add(boxMM(sx > 0 ? 24.6 : -25.6, 6, z - 1.1, sx > 0 ? 25.6 : -24.6, DECK - 4.2, z + 1.1), null, concreteC);
      }
    }
    for (let i = 0; i <= 8; i++) {
      const x = -21 + (42 * i) / 8;
      for (const zf of [zlo, zhi]) {
        const z0 = zf === zlo ? zlo - 1 : zhi - 0.1, z1 = zf === zlo ? zlo + 0.1 : zhi + 1;
        concrete.add(boxMM(x - 1.1, 6, z0, x + 1.1, DECK - 4.2, z1), null, concreteC);
      }
    }
    concrete.add(boxMM(-26.2, DECK - 4.2, zlo - 1.3, 26.2, DECK - 2.6, zhi + 1.3), null, concreteC);
    B.collider(0, s * 504, 26.5, 30, 49);
    for (const sx of [-1, 1]) {
      // cable housing on the deck edge, the cable dives into its front face
      const z0 = s * 477.5, z1 = s * 500.5;
      concrete.add(rboxMM(sx * CX - 2.7, DECK - 0.8, Math.min(z0, z1), sx * CX + 2.7, DECK + 7.2, Math.max(z0, z1), 0.6, 1), null, concreteC);
      concrete.add(rboxMM(sx * CX - 2.2, DECK + 7.0, Math.min(z0, z1) + 1.5, sx * CX + 2.2, DECK + 8.4, Math.max(z0, z1) - 1.5, 0.4, 1), null, concreteC);
      // art-deco pylon
      const px = sx * 20.5, pz = s * 479;
      const pylonTiers = [[-3, 30, 2.8, 2.8], [30, 52, 2.5, 2.5], [52, 62, 2.15, 2.15], [62, 66, 1.7, 1.7]];
      pylonTiers.forEach(([y0, y1, hx, hz], i) => {
        const pts = legOutline(hx, hz, false).map(([x, z]) => [px + x, pz + z]);
        concrete.add(prismGeo(pts, pts, y0, y1, { capBottom: i === 0 }), null, concreteC);
      });
      B.collider(px, pz, 2.9, 2.9, 66);
      // approach pier columns
      const apz = s * 542;
      concrete.add(rboxMM(sx * 8 - 1.6, -2, apz - 1.6, sx * 8 + 1.6, BOT_C0, apz + 1.6, 0.3), null, concreteC);
      B.collider(sx * 8, apz, 1.6, 1.6, BOT_C0);
    }
    const apz = s * 542;
    concrete.add(rboxMM(-14.6, BOT_C0 - 1.8, apz - 1.8, 14.6, BOT_C0, apz + 1.8, 0.3), null, concreteC);
    // abutment at the very end
    const e0 = s * ABUT, e1 = s * END;
    concrete.add(rboxMM(-15.5, -3, Math.min(e0, e1), 15.5, DECK - 0.8, Math.max(e0, e1), 0.6), null, concreteC);
    B.collider(0, s * (ABUT + END) / 2, 15.5, (END - ABUT) / 2, DECK);
  }

  // ---------------------------------------------------------------- street lights
  for (let z = -540; z <= 540; z += 45) {
    if (Math.abs(Math.abs(z) - TZ) < 9 || (Math.abs(z) > 474 && Math.abs(z) < 503)) continue;
    for (const sx of [-1, 1]) {
      const x = sx * 9.85;
      const zz = z + sx * 7; // stagger the two sides
      steel.add(cylY(0.13, 0.09, DECK + 0.2, DECK + 9.6, 6, true, x, zz), null, orangeSteel);
      steel.add(beam(V(x, DECK + 9.4, zz), V(x - sx * 1.9, DECK + 9.75, zz), 0.14, 0.14), null, orangeSteel);
      lamps.add(boxMM(x - sx * 1.75 - 0.5, DECK + 9.45, zz - 0.25, x - sx * 1.75 + 0.5, DECK + 9.68, zz + 0.25));
    }
  }

  const deckColliders = [
    { x: -9.78, z: 0, hx: 0.2, hz: END, h: 1.15, y: DECK },
    { x: 9.78, z: 0, hx: 0.2, hz: END, h: 1.15, y: DECK },
    { x: 0, z: 0, hx: 0.3, hz: END, h: 0.85, y: DECK },
  ];

  return B.finish({
    deck: { y: DECK, zMin: -END, zMax: END, roadHalfWidth: 9.6, halfWidth: 13.5 },
    deckColliders,
  });
}
