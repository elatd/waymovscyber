// San Francisco City Hall (beaux-arts), scaled to a 54 x 54 m footprint.
// Main block 54 x 40 x 24 m, colonnades + pedimented porticos on the front (+Z)
// and back (-Z), central drum + dome with gold trim, lantern to ~78 m.

import {
  LandmarkBuilder, std, glow, boxMM, rboxMM, latheGeo, extrudeGeo, archShape, cylY, V, M,
  noise3, smoothstep,
} from './common.js';
import * as THREE from 'three';

export const CITY_HALL = Object.freeze({ footprint: 54, blockHeight: 24, height: 78 });

function columnProfile(h, r) {
  return [
    [r * 1.32, 0], [r * 1.32, 0.35], [r * 1.12, 0.5], [r * 1.05, 0.62], [r, 0.8],
    [r * 0.88, h - 1.1], [r * 0.95, h - 0.85], [r * 1.25, h - 0.5], [r * 1.38, h - 0.45], [r * 1.38, h], [0, h],
  ];
}

export function createCityHall() {
  const B = new LandmarkBuilder('CityHall');

  const stoneMat = glow({ name: 'ch-granite', color: 0xffffff, vertexColors: true, roughness: 0.78, emissive: 0xfff1dc }, 0.1);
  const domeMat = glow({ name: 'ch-dome', color: 0xffffff, vertexColors: true, roughness: 0.62, metalness: 0.08, emissive: 0xe8eeff }, 0.32);
  const goldMat = std({ name: 'ch-gold', color: 0xe0ad45, roughness: 0.26, metalness: 1.0 });
  const winMat = glow({ name: 'ch-windows', color: 0x252b33, emissive: 0xffcf8f, roughness: 0.18, metalness: 0.55 }, 1.0);

  const stone = B.part('granite', stoneMat);
  const dome = B.part('dome', domeMat);
  const gold = B.part('gold', goldMat);
  const wins = B.part('windows', winMat, { castShadow: false });

  const granite = (hex = 0xd9d8d2) => (x, y, z, nx, ny, nz, out) => {
    out.set(hex);
    out.multiplyScalar((0.9 + 0.12 * noise3(x * 0.25, y * 0.25, z * 0.25)) * (0.93 + 0.07 * smoothstep(0, 8, y)));
  };
  const G = granite(), Gbase = granite(0xc9c7bf), Gtrim = granite(0xe6e5df), Groof = granite(0x6c6e72);

  const HX = 27, HZ = 20;
  // ---------------------------------------------------------------- base + main block
  stone.add(rboxMM(-HX, 0, -HZ, HX, 7, HZ, 0.15), null, Gbase);
  for (const y of [2.2, 4.4]) stone.add(boxMM(-HX - 0.08, y, -HZ - 0.08, HX + 0.08, y + 0.18, HZ + 0.08), null, granite(0xb9b7af));
  stone.add(boxMM(-HX - 0.3, 6.6, -HZ - 0.3, HX + 0.3, 7.3, HZ + 0.3), null, Gtrim);
  stone.add(rboxMM(-HX + 0.4, 7.3, -HZ + 0.4, HX - 0.4, 21, HZ - 0.4, 0.15), null, G);
  // entablature + attic
  stone.add(boxMM(-HX - 0.4, 21, -HZ - 1.6, HX + 0.4, 23, HZ + 1.6), null, Gtrim);
  stone.add(boxMM(-HX + 0.2, 23, -HZ - 1.0, HX - 0.2, 24.4, HZ + 1.0), null, G);
  stone.add(boxMM(-HX + 0.6, 24.4, -HZ + 0.6, HX - 0.6, 24.6, HZ - 0.6), null, Groof);
  // corner pavilions
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x0 = sx * HX, x1 = sx * (HX - 8), z0 = sz * (HZ + 0.3), z1 = sz * (HZ - 9);
      stone.add(rboxMM(Math.min(x0, x1), 7.3, Math.min(z0, z1), Math.max(x0, x1), 25.5, Math.max(z0, z1), 0.15), null, G);
      stone.add(boxMM(Math.min(x0, x1) - 0.3, 25.5, Math.min(z0, z1) - 0.3, Math.max(x0, x1) + 0.3, 26.4, Math.max(z0, z1) + 0.3), null, Gtrim);
    }
  }

  // ---------------------------------------------------------------- windows
  for (const s of [-1, 1]) {
    const zf = s * HZ, zw = s * (HZ - 0.4);
    // ground floor arched windows
    for (let x = -24; x <= 24.01; x += 4) {
      if (Math.abs(x) < 9) continue;
      wins.add(extrudeGeo(archShape(1.6, 2.4, 0, 0, 8), 0.1), M(x, 2.6, zf + s * 0.04, 0, s > 0 ? 0 : Math.PI, 0));
    }
    // upper floors behind the colonnade
    for (let x = -20.4; x <= 20.41; x += 3.4) {
      if (Math.abs(x) < 11) continue;
      for (const [y0, y1] of [[9, 12.4], [14.4, 18.4]]) {
        wins.add(boxMM(x - 0.8, y0, Math.min(zw, zw + s * 0.06), x + 0.8, y1, Math.max(zw, zw + s * 0.06)));
      }
    }
    // side elevations
    for (let z = -15; z <= 15.01; z += 3.75) {
      for (const [y0, y1] of [[2.6, 5.2], [9, 12.4], [14.4, 18.4]]) {
        wins.add(boxMM(s * (HX - 0.4) - 0.04, y0, z - 0.75, s * (HX - 0.4) + 0.04, y1, z + 0.75));
      }
    }
  }

  // ---------------------------------------------------------------- colonnades + porticos
  const colGeo = (h, r, seg = 12) => latheGeo(columnProfile(h, r), seg, 35);
  for (const s of [-1, 1]) {
    const zc = s * (HZ + 0.6);
    for (let x = -22.1; x <= 22.11; x += 3.4) {
      if (Math.abs(x) < 11) continue;
      stone.add(colGeo(13.7, 0.62), [x - 0.85, 7.3, zc], G);
      stone.add(colGeo(13.7, 0.62), [x + 0.85, 7.3, zc], G);
    }
    // central portico
    const zp = s * (HZ + 4.2);
    stone.add(rboxMM(-11.5, 0, Math.min(s * HZ, zp + s * 1.4), 11.5, 7.3, Math.max(s * HZ, zp + s * 1.4), 0.15), null, Gbase);
    for (let i = 0; i < 6; i++) {
      const x = -8.75 + i * 3.5;
      stone.add(colGeo(14.2, 0.85), [x, 7.3, zp], G);
    }
    stone.add(boxMM(-11.5, 21.5, Math.min(s * HZ, zp + s * 1.5), 11.5, 23.5, Math.max(s * HZ, zp + s * 1.5)), null, Gtrim);
    // pediment
    const ped = new THREE.Shape();
    ped.moveTo(-12, 0);
    ped.lineTo(12, 0);
    ped.lineTo(0, 5.4);
    ped.closePath();
    const pg = extrudeGeo(ped, 5.6, { bevel: 0.15 });
    stone.add(pg, M(0, 23.5, s * (HZ + 2.85), 0, s > 0 ? 0 : Math.PI, 0), Gtrim);
    // entrance doors (three arches)
    for (const dx of [-3.5, 0, 3.5]) {
      wins.add(extrudeGeo(archShape(2.0, 3.0, 0, 0, 8), 0.1), M(dx, 7.3, s * (HZ - 0.36), 0, s > 0 ? 0 : Math.PI, 0));
    }
    // steps
    for (let k = 0; k < 6; k++) {
      const zz0 = s * (HZ + 5.6 + k * 0.25), zz1 = s * (HZ + 7.0);
      stone.add(boxMM(-12.5 + k * 0.1, 0, Math.min(zz0, zz1), 12.5 - k * 0.1, 1.2 - k * 0.2, Math.max(zz0, zz1)), null, Gbase);
    }
  }

  // ---------------------------------------------------------------- dome assembly
  stone.add(rboxMM(-14.5, 24.4, -14.5, 14.5, 30.5, 14.5, 0.3), null, G);
  stone.add(boxMM(-15, 30, -15, 15, 30.9, 15), null, Gtrim);
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2;
    for (const u of [-9, -4.5, 0, 4.5, 9]) {
      wins.add(boxMM(u - 0.9, 25.8, 14.5, u + 0.9, 29, 14.57), M(0, 0, 0, 0, a, 0));
    }
  }
  // drum
  dome.add(cylY(10.4, 10.4, 30.9, 43.5, 40, true), null, granite(0xe2e1db));
  dome.add(latheGeo([[12.6, 30.9], [12.6, 31.6], [10.3, 31.6]], 40, 35), null, Gtrim);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    dome.add(colGeo(10.0, 0.5, 10), [11.6 * Math.sin(a), 31.6, 11.6 * Math.cos(a)], G);
    const aw = a + Math.PI / 24;
    wins.add(boxMM(-0.75, 33.5, -0.04, 0.75, 39.5, 0.04), M(10.42 * Math.sin(aw), 0, 10.42 * Math.cos(aw), 0, aw, 0));
  }
  dome.add(latheGeo([[10.3, 41.6], [12.5, 41.6], [12.5, 43.6], [12.2, 43.9], [10.3, 43.9]], 40, 35), null, Gtrim);
  // attic + gold band
  dome.add(latheGeo([[11.2, 43.9], [11.2, 46.4], [10.7, 46.6]], 40, 35), null, G);
  gold.add(latheGeo([[11.35, 46.2], [11.35, 46.9], [10.8, 47.1]], 40, 35));
  // dome shell
  {
    const prof = [];
    const N = 14, a = 10.7, b = 17.4, y0 = 47.0;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * (Math.PI / 2);
      prof.push([a * Math.cos(t) + (i === N ? 0 : 0), y0 + b * Math.sin(t)]);
    }
    prof[N][0] = 0;
    dome.add(latheGeo(prof, 40, 50), null, granite(0xdedfdc));
    // ribs
    for (let k = 0; k < 16; k++) {
      const phi = (k / 16) * Math.PI * 2;
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const t = (i / 12) * (Math.PI / 2) * 0.86;
        pts.push(V((a + 0.12) * Math.cos(t) * Math.sin(phi), y0 + (b + 0.12) * Math.sin(t), (a + 0.12) * Math.cos(t) * Math.cos(phi)));
      }
      dome.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.28, 5, false), null, Gtrim);
    }
    // gold ring at the dome top + lantern
    const yt = y0 + b * Math.sin((Math.PI / 2) * 0.86);
    gold.add(latheGeo([[3.6, yt - 0.3], [3.9, yt], [3.9, yt + 0.5], [3.2, yt + 0.7]], 24, 35));
    const yl = yt + 0.6;
    dome.add(cylY(2.7, 2.7, yl, yl + 6, 16, true), null, G);
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      dome.add(colGeo(5.6, 0.22, 8), [3.1 * Math.sin(ang), yl, 3.1 * Math.cos(ang)], Gtrim);
      const aw = ang + Math.PI / 8;
      wins.add(boxMM(-0.5, yl + 1.2, -0.04, 0.5, yl + 4.6, 0.04), M(2.72 * Math.sin(aw), 0, 2.72 * Math.cos(aw), 0, aw, 0));
    }
    gold.add(latheGeo([[3.6, yl + 5.6], [3.6, yl + 6.3], [2.5, yl + 6.4], [2.2, yl + 7.3], [1.4, yl + 8.6], [0.5, yl + 9.2], [0.35, yl + 9.2], [0.35, yl + 10.0], [0.55, yl + 10.4], [0.35, yl + 10.9], [0.12, yl + 13.0], [0, yl + 13.4]], 16, 35));
  }

  B.collider(0, 0, HX, HZ, 26.4);
  B.collider(0, 0, 12.5, HZ + 7, 8);
  B.collider(0, 0, 15, 15, 78);
  return B.finish();
}
