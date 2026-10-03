// Sutro Tower — three-legged red/white lattice TV tower, ~298 m. Legs stand
// ~60 m apart at the base, converge to a waist, then rise as antenna masts.
// Horizontal crossbars (triangular trusses) at 3 levels, red aviation beacons.
// Origin at the base centre; leg 0 points to +Z.

import { LandmarkBuilder, std, glow, boxMM, rboxMM, beam, cylY, V, noise3 } from './common.js';
import * as THREE from 'three';

export const SUTRO_TOWER = Object.freeze({ height: 298, legSpacing: 60, footprint: 64 });

const R0 = 60 / Math.sqrt(3);
// leg centre-line profile: [y, radius, cross-section side]
const PROFILE = [
  [0, R0, 5.2],
  [165, 9.0, 2.8],
  [235, 11.2, 2.4],
  [262, 11.0, 1.7],
  [298, 10.6, 0.7],
];
const CROSSBARS = [80, 165, 235];

function profileAt(y) {
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const [y0, r0, s0] = PROFILE[i], [y1, r1, s1] = PROFILE[i + 1];
    if (y <= y1) {
      const t = (y - y0) / (y1 - y0);
      return [r0 + (r1 - r0) * t, s0 + (s1 - s0) * t];
    }
  }
  const last = PROFILE[PROFILE.length - 1];
  return [last[1], last[2]];
}

export function createSutroTower() {
  const B = new LandmarkBuilder('SutroTower');
  const steelMat = std({ name: 'sutro-steel', color: 0xffffff, vertexColors: true, roughness: 0.55, metalness: 0.3 });
  const concreteMat = std({ name: 'sutro-concrete', color: 0xffffff, vertexColors: true, roughness: 0.9 });
  const beaconMat = glow({ name: 'sutro-beacons', color: 0x5a0a06, emissive: 0xff1c0c, roughness: 0.35 }, 8);
  const steel = B.part('steel', steelMat);
  const concrete = B.part('concrete', concreteMat);
  const beacons = B.part('beacons', beaconMat, { castShadow: false, receiveShadow: false });

  const RED = new THREE.Color(0xd0372a), WHITE = new THREE.Color(0xf1efe9);
  const bandColor = (y) => {
    const band = Math.floor(y / 21.3);
    const c = (band % 2 === 0 ? RED : WHITE).clone();
    return c.multiplyScalar(0.92 + 0.12 * noise3(y * 0.2, 0.5, band));
  };
  const member = (a, b, w) => steel.add(beam(a, b, w, w), null, bandColor((a.y + b.y) / 2));

  const legAngles = [0, 1, 2].map((i) => Math.PI / 2 + (i * Math.PI * 2) / 3);
  const legCenter = (i, y) => {
    const [r] = profileAt(y);
    return V(r * Math.cos(legAngles[i]), y, r * Math.sin(legAngles[i]));
  };

  // ---------------------------------------------------------------- legs (triangular lattice trusses)
  const DY = 5.2;
  const ys = [];
  for (let y = 0; y < 298 - 0.01; y += DY) ys.push(y);
  ys.push(298);
  for (let i = 0; i < 3; i++) {
    const th = legAngles[i];
    const chordPt = (k, y) => {
      const c = legCenter(i, y);
      const [, s] = profileAt(y);
      const rho = s / Math.sqrt(3);
      const ph = th + (k * Math.PI * 2) / 3;
      return V(c.x + rho * Math.cos(ph), y, c.z + rho * Math.sin(ph));
    };
    for (let j = 0; j < ys.length - 1; j++) {
      const y0 = ys[j], y1 = ys[j + 1];
      const [, s0] = profileAt(y0);
      const cw = Math.max(0.22, s0 * 0.13);
      for (let k = 0; k < 3; k++) {
        member(chordPt(k, y0), chordPt(k, y1), cw);
        const k2 = (k + 1) % 3;
        const up = j % 2 === 0;
        member(up ? chordPt(k, y0) : chordPt(k2, y0), up ? chordPt(k2, y1) : chordPt(k, y1), cw * 0.55);
        if (j % 2 === 0) member(chordPt(k, y0), chordPt(k2, y0), cw * 0.5);
      }
    }
    // mast-top beacon + mid-leg beacon
    beacons.add(new THREE.SphereGeometry(0.9, 10, 6), [legCenter(i, 298).x, 299, legCenter(i, 298).z]);
    const mid = legCenter(i, 120);
    beacons.add(new THREE.SphereGeometry(0.7, 8, 6), [mid.x + 1.6 * Math.cos(th), 120, mid.z + 1.6 * Math.sin(th)]);
    // antenna arms near the top
    const top = legCenter(i, 270);
    const out = V(Math.cos(th), 0, Math.sin(th));
    for (const y of [268, 282]) {
      const a = legCenter(i, y);
      member(a, a.clone().addScaledVector(out, 6.5), 0.45);
      member(a.clone().addScaledVector(out, 6.5), a.clone().addScaledVector(out, 6.5).add(V(0, -4, 0)), 0.3);
    }
    steel.add(cylY(0.35, 0.5, 298, 304, 6, false, top.x, top.z), null, WHITE);
  }

  // ---------------------------------------------------------------- crossbars (triangular trusses between legs)
  for (const yc of CROSSBARS) {
    const H = yc === 235 ? 4.5 : 3.2;
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const a0 = legCenter(i, yc), b0 = legCenter(j, yc);
      const a1 = legCenter(i, yc + H), b1 = legCenter(j, yc + H);
      const w = yc === 80 ? 0.55 : 0.45;
      member(a0, b0, w);
      member(a1, b1, w);
      const n = Math.max(3, Math.round(a0.distanceTo(b0) / 4.5));
      for (let k = 0; k <= n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const p0 = a0.clone().lerp(b0, t0), q0 = a1.clone().lerp(b1, t0);
        member(p0, q0, w * 0.6);
        if (k < n) member(k % 2 ? p0 : q0, k % 2 ? a1.clone().lerp(b1, t1) : a0.clone().lerp(b0, t1), w * 0.5);
      }
    }
    // beacons on the upper deck corners
    if (yc === 235) {
      for (let i = 0; i < 3; i++) {
        const c = legCenter(i, yc + H);
        const th = legAngles[i];
        beacons.add(new THREE.SphereGeometry(0.7, 8, 6), [c.x + 2.2 * Math.cos(th), yc + H + 0.8, c.z + 2.2 * Math.sin(th)]);
      }
    }
  }

  // ---------------------------------------------------------------- footings + base building
  const conc = (x, y, z, nx, ny, nz, out) => {
    out.set(0xb3aea4);
    out.multiplyScalar(0.88 + 0.18 * noise3(x * 0.3, y * 0.3, z * 0.3));
  };
  for (let i = 0; i < 3; i++) {
    const c = legCenter(i, 0);
    concrete.add(rboxMM(c.x - 4.5, -0.5, c.z - 4.5, c.x + 4.5, 2.2, c.z + 4.5, 0.3), null, conc);
    B.collider(c.x, c.z, 4.5, 4.5, 30);
  }
  concrete.add(rboxMM(-9, -0.3, -6, 9, 7.5, 6, 0.3), null, conc);
  concrete.add(boxMM(-9.3, 7.5, -6.3, 9.3, 8.1, 6.3), null, 0x8c8a86);
  B.collider(0, 0, 9.3, 6.3, 8.1);

  return B.finish();
}
