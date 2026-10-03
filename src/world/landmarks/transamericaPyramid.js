// Transamerica Pyramid — square base 44 m, apex at 200 m (spire from 140 m).
// Elevator/stair "wings" protrude on the east (+X) and west (-X) faces. Front +Z.

import {
  LandmarkBuilder, std, glow, boxMM, rboxMM, beam, prismGeo, frustumFaces, facadeTextures, V,
  noise3, smoothstep, sphereGeo,
} from './common.js';
import * as THREE from 'three';

export const TRANSAMERICA = Object.freeze({ base: 44, height: 200, spireBase: 140 });

const H = 200;
const HW0 = 22;
const hw = (y) => HW0 * (1 - y / H);

export function createTransamericaPyramid() {
  const B = new LandmarkBuilder('TransamericaPyramid');

  const MOD_W = 1.6, FLOOR = 3.6, COLS = 16, ROWS = 8;
  const tex = facadeTextures('transamerica', {
    cols: COLS, rows: ROWS, px: 32, py: 64,
    wall: '#efebe2', wallShade: 'rgba(120,110,95,0.18)',
    glass: '#2f3946', glassTop: '#4f5b6a',
    win: [0.2, 0.2, 0.8, 0.82], lit: 0.62, seed: 1972,
    glassRough: 0.08, wallRough: 0.8, glassMetal: 0.7,
  });
  const uS = COLS * MOD_W, vS = ROWS * FLOOR;

  const facadeMat = glow({
    name: 'tam-facade', color: tex.map ? 0xffffff : 0xe9e5dc, map: tex.map, emissive: 0xffe0b0,
    emissiveMap: tex.emissiveMap, roughness: 1, metalness: tex.ormMap ? 1 : 0.05,
    roughnessMap: tex.ormMap, metalnessMap: tex.ormMap,
  }, 1.1);
  if (!tex.ormMap) facadeMat.roughness = 0.75;
  const spireMat = std({ name: 'tam-spire', color: 0xe7e5df, roughness: 0.32, metalness: 0.55 });
  const concreteMat = std({ name: 'tam-concrete', color: 0xffffff, vertexColors: true, roughness: 0.8 });
  const lobbyMat = glow({ name: 'tam-lobby', color: 0x1e252d, emissive: 0xffd9a8, roughness: 0.12, metalness: 0.7 }, 0.9);
  const beaconMat = glow({ name: 'tam-beacon', color: 0x6a0c08, emissive: 0xff2414, roughness: 0.3 }, 8);
  const crownMat = glow({ name: 'tam-crown', color: 0xc9d2d8, emissive: 0xfff6e8, roughness: 0.2, metalness: 0.3 }, 3);

  const facade = B.part('facade', facadeMat);
  const spire = B.part('spire', spireMat);
  const concrete = B.part('concrete', concreteMat);
  const lobby = B.part('lobby', lobbyMat, { castShadow: false });
  const beacon = B.part('beacon', beaconMat, { castShadow: false, receiveShadow: false });
  const crown = B.part('crown', crownMat, { castShadow: false });

  const white = (x, y, z, nx, ny, nz, out) => {
    out.set(0xeeeae1);
    out.multiplyScalar(0.9 + 0.12 * noise3(x * 0.3, y * 0.3, z * 0.3) - 0.12 * (1 - smoothstep(0, 4, y)));
  };

  // ---------------------------------------------------------------- body + spire
  const YB = 10, YT = 140;
  facade.add(frustumFaces(YB, YT, hw(YB), hw(YT), uS, vS));
  // trim band where the occupied floors end
  concrete.add(frustumFaces(YT - 0.6, YT + 0.9, hw(YT - 0.6) + 0.25, hw(YT + 0.9) + 0.25), null, white);
  spire.add(frustumFaces(YT, 186, hw(YT), hw(186)));
  crown.add(frustumFaces(186, 193, hw(186) + 0.03, hw(193) + 0.03));
  spire.add(frustumFaces(193, H, hw(193), 0));
  beacon.add(sphereGeo(0.45, 10, 6), [0, H + 0.2, 0]);

  // ---------------------------------------------------------------- wings (east / west)
  const WY0 = 70, WY1 = 152;
  const wingOut = hw(WY0 + 2);
  for (const sx of [-1, 1]) {
    const x0 = sx * 3, x1 = sx * wingOut;
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    const poly = [[hi, -5.6], [hi, 5.6], [lo, 5.6], [lo, -5.6]];
    facade.add(prismGeo(poly, poly, WY0, WY1, { capBottom: false, capTop: false, uScale: uS, vScale: vS }));
    // sloped cap: highest at the spire side
    const capPoly = [[hi + sx * 0.25, -5.85], [hi + sx * 0.25, 5.85], [lo, 5.85], [lo, -5.85]];
    concrete.add(prismGeo(capPoly, capPoly, WY1, WY1 + 1.4), null, white);
    concrete.add(beam(V(sx * (wingOut - 0.2), WY1 + 1.4, 0), V(sx * 3.5, WY1 + 6.5, 0), 1.2, 11.2, V(0, 0, 1)), null, white);
  }

  // ---------------------------------------------------------------- base: sloped legs, struts, lobby
  const hb = hw(YB);
  // body underside
  concrete.add(boxMM(-hb, YB - 0.8, -hb, hb, YB + 0.3, hb), null, white);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      // chevron-shaped corner leg continuing the pyramid edges down to the ground
      const pts0 = [[22, 22], [13.8, 22], [15.6, 15.6], [22, 13.8]];
      const pts1 = [[hb, hb], [hb - 7.2, hb], [hb - 5.0, hb - 5.0], [hb, hb - 7.2]];
      const flip = (p) => p.map(([x, z]) => [sx * x, sz * z]);
      let b0 = flip(pts0), b1 = flip(pts1);
      if (sx * sz < 0) {
        b0 = b0.reverse();
        b1 = b1.reverse();
      }
      concrete.add(prismGeo(b0, b1, 0, YB - 0.5, { capTop: false }), null, white);
    }
  }
  // inclined struts on every face (W pattern) forming triangular arches
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2;
    const c = Math.cos(a), s = Math.sin(a);
    const P = (x, y, z) => V(x * c + z * s, y, -x * s + z * c);
    const ground = [-8.5, 0, 8.5];
    const top = [-12.75, -4.25, 4.25, 12.75];
    ground.forEach((gx, i) => {
      for (const tx of [top[i], top[i + 1]]) {
        concrete.add(beam(P(gx, 0, 21.4), P(tx, YB - 0.5, hb - 0.3), 1.1, 1.1, P(0, 0, 1)), null, white);
      }
    });
    // lobby glass wall, recessed
    lobby.add(boxMM(-15, 0, 14.9, 15, YB - 0.8, 15.05), [0, 0, 0, 0, a, 0]);
  }
  concrete.add(boxMM(-15, YB - 0.9, -15, 15, YB - 0.7, 15), null, white);
  // plaza plinth
  concrete.add(rboxMM(-23.5, -0.4, -23.5, 23.5, 0.25, 23.5, 0.15), null, (x, y, z, nx, ny, nz, out) => {
    out.set(0xb9b4aa);
    out.multiplyScalar(0.92 + 0.1 * noise3(x * 0.5, 0, z * 0.5));
  });

  B.collider(0, 0, 24, 24, H);

  return B.finish();
}
