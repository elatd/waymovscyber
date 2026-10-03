// Coit Tower — fluted concrete column on a two-storey base, arched observation
// level and crenellated crown. Entrance faces +Z.

import {
  LandmarkBuilder, glow, boxMM, rboxMM, latheGeo, loftGeo, extrudeGeo, archShape, rectShape, cylY, V, M,
  noise3, smoothstep,
} from './common.js';
import * as THREE from 'three';

export const COIT_TOWER = Object.freeze({ footprint: 26, height: 64, shaftDiameter: 12 });

const SHAFT_Y0 = 7, SHAFT_Y1 = 55;
const R0 = 6.0, R1 = 5.7;
const FLUTES = 20;

function flutedRing(y, R) {
  const pts = [];
  const per = 6;
  const N = FLUTES * per;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const frac = (i % per) / per;
    const r = R - 0.32 * Math.sin(Math.PI * frac);
    pts.push(V(r * Math.cos(a), y, r * Math.sin(a)));
  }
  return pts;
}

export function createCoitTower() {
  const B = new LandmarkBuilder('CoitTower');

  const stoneMat = glow({ name: 'coit-concrete', color: 0xffffff, vertexColors: true, roughness: 0.86, emissive: 0xfff0dc }, 0.2);
  const darkMat = glow({ name: 'coit-openings', color: 0x23262b, emissive: 0xffcf8a, roughness: 0.4, metalness: 0.3 }, 1.4);
  const stone = B.part('concrete', stoneMat);
  const dark = B.part('openings', darkMat, { castShadow: false });

  const beige = (x, y, z, nx, ny, nz, out) => {
    out.set(0xe6dbc3);
    const streak = noise3(x * 0.6, y * 0.04, z * 0.6);
    out.multiplyScalar((0.9 + 0.12 * noise3(x * 0.25, y * 0.25, z * 0.25)) * (1 - 0.08 * streak) * (0.92 + 0.08 * smoothstep(0, 20, y)));
  };

  // ---------------------------------------------------------------- base building
  stone.add(rboxMM(-13, 0, -13, 13, 0.6, 13, 0.1), null, beige); // plinth / terrace
  stone.add(rboxMM(-11.5, 0.6, -11.5, 11.5, 6.4, 11.5, 0.25), null, beige);
  stone.add(boxMM(-11.9, 6.0, -11.9, 11.9, 6.7, 11.9), null, beige); // cornice
  // parapet with merlons
  for (const s of [-1, 1]) {
    stone.add(boxMM(-11.9, 6.7, s * 11.9 - 0.35, 11.9, 7.3, s * 11.9 + 0.35), null, beige);
    stone.add(boxMM(s * 11.9 - 0.35, 6.7, -11.9, s * 11.9 + 0.35, 7.3, 11.9), null, beige);
    for (let i = -5; i <= 5; i++) {
      stone.add(boxMM(i * 2.1 - 0.45, 7.3, s * 11.9 - 0.35, i * 2.1 + 0.45, 7.9, s * 11.9 + 0.35), null, beige);
      stone.add(boxMM(s * 11.9 - 0.35, 7.3, i * 2.1 - 0.45, s * 11.9 + 0.35, 7.9, i * 2.1 + 0.45), null, beige);
    }
  }
  // arched windows on the base faces + entrance portal on +Z
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2;
    for (const u of [-7, 0, 7]) {
      if (f === 0 && u === 0) continue;
      const g = extrudeGeo(archShape(1.6, 2.2, 0, 0, 8), 0.1);
      dark.add(g, M(u * Math.cos(a) + 11.52 * Math.sin(a), 2.0, -u * Math.sin(a) + 11.52 * Math.cos(a), 0, a, 0));
    }
  }
  // entrance: projecting portal with a big arch + steps
  stone.add(rboxMM(-4.2, 0.6, 11.0, 4.2, 6.9, 12.4, 0.15), null, beige);
  dark.add(extrudeGeo(archShape(3.2, 2.8, 0, 0, 10), 0.1), [0, 0.6, 12.42]);
  for (let k = 0; k < 2; k++) {
    stone.add(boxMM(-3.6 + k * 0.4, 0.3 + k * 0.15, 12.4, 3.6 - k * 0.4, 0.45 + k * 0.15, 13.0 - k * 0.3), null, beige);
  }

  // ---------------------------------------------------------------- fluted shaft
  stone.add(latheGeo([[R0 + 0.9, 6.9], [R0 + 0.9, 7.6], [R0 + 0.45, 8.0], [R0 + 0.45, 8.6], [R0 - 0.2, 8.8]], 40, 35), null, beige);
  const rings = [];
  for (const y of [SHAFT_Y0 + 1.5, 20, 32, 44, SHAFT_Y1]) {
    const t = (y - SHAFT_Y0) / (SHAFT_Y1 - SHAFT_Y0);
    rings.push(flutedRing(y, R0 + (R1 - R0) * t));
  }
  stone.add(loftGeo(rings), null, beige);

  // ---------------------------------------------------------------- observation level (12 arched bays)
  const OY0 = SHAFT_Y1, OY1 = 61;
  stone.add(latheGeo([[R1 + 0.15, OY0 - 0.6], [R1 + 0.5, OY0 - 0.2], [R1 + 0.5, OY0 + 0.25], [R1 - 0.3, OY0 + 0.3]], 36, 35), null, beige);
  dark.add(cylY(5.25, 5.25, OY0, OY1, 24, true));
  const BAYS = 12;
  const rOut = 6.05, depth = 0.7;
  const width = 2 * rOut * Math.tan(Math.PI / BAYS) + 0.02;
  for (let i = 0; i < BAYS; i++) {
    const a = ((i + 0.5) / BAYS) * Math.PI * 2;
    const shape = rectShape(width, OY1 - OY0, 0, (OY1 - OY0) / 2);
    shape.holes.push(archShape(1.75, 2.9, 0, 0.75, 10));
    const g = extrudeGeo(shape, depth, { curveSegments: 10 });
    const rc = rOut - depth / 2;
    stone.add(g, M(rc * Math.sin(a), OY0, rc * Math.cos(a), 0, a, 0), beige);
  }

  // ---------------------------------------------------------------- crown
  stone.add(latheGeo([[5.2, OY1 - 0.1], [6.35, OY1], [6.55, OY1 + 0.5], [6.55, OY1 + 1.0], [6.2, OY1 + 1.2], [5.0, OY1 + 1.2]], 36, 35), null, beige);
  const MER = 20;
  for (let i = 0; i < MER; i++) {
    const a = (i / MER) * Math.PI * 2;
    stone.add(boxMM(-0.55, OY1 + 1.2, -0.3, 0.55, OY1 + 2.4, 0.3), M(6.15 * Math.sin(a), 0, 6.15 * Math.cos(a), 0, a, 0), beige);
  }
  stone.add(latheGeo([[6.0, OY1 + 1.2], [6.0, OY1 + 1.7], [5.5, OY1 + 1.9], [3.0, OY1 + 2.3], [2.6, OY1 + 2.3], [2.6, 63.6], [2.2, 64.0], [0, 64.0]], 36, 35), null, beige);

  B.collider(0, 0, 13, 13, 64);
  return B.finish();
}
