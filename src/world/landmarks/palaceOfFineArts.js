// Palace of Fine Arts — open octagonal rotunda (domed, ~35 m) on 8 column
// clusters, plus a curved double colonnade behind it (-Z) with planter boxes.
// The rotunda interior is open (you can drive in through the arches).
// Front (lagoon side) faces +Z.

import {
  LandmarkBuilder, glow, std, boxMM, latheGeo, archRingGeo, prismGeo, ngon, V, M, noise3, fbm3, smoothstep, makeRng,
} from './common.js';
import * as THREE from 'three';

export const PALACE_OF_FINE_ARTS = Object.freeze({ footprint: 54, height: 35, rotundaDiameter: 30 });

function corinthian(h, r) {
  return [
    [r * 1.45, 0], [r * 1.45, 0.4], [r * 1.2, 0.55], [r * 1.1, 0.7], [r, 0.9],
    [r * 0.86, h - 1.6], [r * 0.95, h - 1.45], [r * 1.05, h - 1.1], [r * 1.35, h - 0.55], [r * 1.55, h - 0.45], [r * 1.55, h], [0, h],
  ];
}

export function createPalaceOfFineArts() {
  const B = new LandmarkBuilder('PalaceOfFineArts');
  const rand = makeRng(1915);

  const stoneMat = glow({ name: 'pfa-stone', color: 0xffffff, vertexColors: true, roughness: 0.88, emissive: 0xffd9b0 }, 0.22);
  const domeMat = glow({ name: 'pfa-dome', color: 0xffffff, vertexColors: true, roughness: 0.75, emissive: 0xffd2a0 }, 0.28);
  const leafMat = std({ name: 'pfa-foliage', color: 0xffffff, vertexColors: true, roughness: 0.95 });
  const stone = B.part('stone', stoneMat);
  const dome = B.part('dome', domeMat);
  const leaves = B.part('foliage', leafMat);

  const ochre = (hex = 0xcaa07e, amp = 0.16) => (x, y, z, nx, ny, nz, out) => {
    out.set(hex);
    const streak = fbm3(x * 0.35, y * 0.06, z * 0.35, 3);
    const k = (0.88 + amp * (noise3(x * 0.2, y * 0.2, z * 0.2) - 0.5)) * (1 - 0.16 * smoothstep(0.45, 0.8, streak)) * (0.88 + 0.12 * smoothstep(0, 6, y));
    out.multiplyScalar(k * (ny > 0.6 ? 1.06 : 1));
  };
  const S = ochre(), Slight = ochre(0xd8b592, 0.12), Sdark = ochre(0xb88f6c, 0.12);

  // ---------------------------------------------------------------- rotunda
  const RC = 13.6; // radius of the 8 pier clusters
  const oct = ngon(8, 16.4, 0, 0, 0);
  stone.add(prismGeo(oct, oct, -0.4, 0.3), null, Sdark);
  const oct2 = ngon(8, 17.4, 0, 0, 0);
  stone.add(prismGeo(oct2, oct2, -0.4, 0.12), null, Sdark);
  const SPRING = 12.5, CROWN = 17.6;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const cx = RC * Math.sin(a), cz = RC * Math.cos(a);
    const rot = M(cx, 0, cz, 0, a, 0);
    // pier (core) + plinth
    stone.add(boxMM(-1.7, 0.3, -1.7, 1.7, SPRING + 0.6, 1.7), rot, S);
    stone.add(boxMM(-2.0, 0.3, -2.0, 2.0, 1.4, 2.0), rot.clone(), Sdark);
    // capital block
    stone.add(boxMM(-2.1, SPRING, -2.1, 2.1, SPRING + 1.2, 2.1), rot.clone(), Slight);
    // paired columns on the outer face + one on each side
    for (const [lx, lz] of [[-1.25, 2.15], [1.25, 2.15], [-2.15, 0], [2.15, 0]]) {
      stone.add(latheGeo(corinthian(SPRING - 0.3, 0.42), 12, 35), M(cx, 0.3, cz, 0, a, 0).multiply(M(lx, 0, lz)), S);
    }
    B.collider(cx, cz, 2.9, 2.9, CROWN);
  }
  // 8 arches between the clusters
  const side = 2 * RC * Math.sin(Math.PI / 8);
  const apo = RC * Math.cos(Math.PI / 8);
  const span = side - 4.2;
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    const r = span / 2;
    const xf = M(apo * Math.sin(a), SPRING + 1.2, apo * Math.cos(a), 0, a, 0);
    stone.add(archRingGeo(r, r + 1.1, 3.0, 0, Math.PI, 12), xf, Slight);
    // spandrel fill above the arch up to the entablature
    const sh = new THREE.Shape();
    const top = CROWN + 1.6 - (SPRING + 1.2);
    sh.moveTo(-side / 2 - 0.5, 0);
    sh.lineTo(-r - 1.1, 0);
    for (let k = 0; k <= 12; k++) {
      const t = Math.PI - (k / 12) * Math.PI;
      sh.lineTo((r + 1.1) * Math.cos(t), (r + 1.1) * Math.sin(t));
    }
    sh.lineTo(side / 2 + 0.5, 0);
    sh.lineTo(side / 2 + 0.5, top);
    sh.lineTo(-side / 2 - 0.5, top);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 2.6, bevelEnabled: false, curveSegments: 12 });
    g.translate(0, 0, -1.3);
    stone.add(g, xf.clone(), S);
  }
  // entablature / frieze ring and drum
  const ent = ngon(8, RC + 2.6, 0, 0, 0);
  const entIn = ngon(8, RC - 2.6, 0, 0, 0);
  const ring = (outer, inner, y0, y1, color) => {
    // octagonal ring as 8 prisms (outer/inner faces + caps)
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      const poly = [outer[i], outer[j], inner[j], inner[i]];
      stone.add(prismGeo(poly, poly, y0, y1), null, color);
    }
  };
  ring(ent, entIn, CROWN + 1.6, CROWN + 3.2, Slight);
  const ent2 = ngon(8, RC + 3.1, 0, 0, 0);
  ring(ent2, entIn, CROWN + 3.2, CROWN + 3.9, Slight);
  const drumO = ngon(8, RC + 0.9, 0, 0, 0);
  const drumI = ngon(8, RC - 1.4, 0, 0, 0);
  ring(drumO, drumI, CROWN + 3.9, CROWN + 7.6, S);
  // frieze panels on the drum
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    const rr = (RC + 0.9) * Math.cos(Math.PI / 8) + 0.1;
    stone.add(boxMM(-3.6, CROWN + 4.6, -0.12, 3.6, CROWN + 6.9, 0.12), M(rr * Math.sin(a), 0, rr * Math.cos(a), 0, a, 0), Sdark);
  }
  // dome (outer shell + inner shell visible from inside the rotunda)
  const DY = CROWN + 7.9, DR = 13.4, DH = 9.4;
  const prof = [];
  for (let k = 0; k <= 12; k++) {
    const t = (k / 12) * (Math.PI / 2);
    prof.push([DR * Math.cos(t), DY + DH * Math.sin(t)]);
  }
  prof[12][0] = 0;
  dome.add(latheGeo([[DR + 0.6, DY - 0.5], [DR + 0.6, DY], ...prof], 40, 40), null, (x, y, z, nx, ny, nz, out) => {
    out.set(0xc79a74);
    const rib = Math.abs(Math.sin(Math.atan2(x, z) * 8)) < 0.12 ? 0.85 : 1;
    out.multiplyScalar(rib * (0.88 + 0.16 * noise3(x * 0.15, y * 0.15, z * 0.15)));
  });
  // inner shell: reversed profile -> faces the rotunda interior
  const inner = prof.map(([r, y]) => [Math.max(0, r - 0.8), y - 0.8]).reverse();
  dome.add(latheGeo(inner, 32, 40), null, 0xa77f60);
  dome.add(latheGeo([[2.4, DY + DH - 0.25], [2.4, DY + DH + 0.5], [1.6, DY + DH + 1.0], [0.4, DY + DH + 1.2], [0, DY + DH + 1.25]], 20, 35), null, Slight);

  // ---------------------------------------------------------------- curved colonnade behind (-Z)
  const R_IN = 21.2, R_OUT = 24.4, A0 = Math.PI - 1.12, A1 = Math.PI + 1.12;
  const NCOL = 13;
  const COL_H = 11;
  for (let i = 0; i < NCOL; i++) {
    const a = A0 + ((A1 - A0) * i) / (NCOL - 1);
    for (const r of [R_IN, R_OUT]) {
      const x = r * Math.sin(a), z = r * Math.cos(a);
      stone.add(latheGeo(corinthian(COL_H, 0.48), 12, 35), [x, 0, z], S);
      B.collider(x, z, 0.75, 0.75, COL_H + 2);
    }
  }
  const arcLen = A1 - A0 + 0.06;
  // stylobate, architrave and cornice as lathe sectors (rectangular sections)
  const sector = (rIn, rOut, y0, y1, color) => {
    const g = latheGeo([[rIn, y0], [rOut, y0], [rOut, y1], [rIn, y1], [rIn, y0 + 0.0001]], 36, 30, A0 - 0.03, arcLen);
    stone.add(g, null, color);
    for (const ae of [A0 - 0.03, A0 - 0.03 + arcLen]) {
      const ca = (rIn + rOut) / 2;
      stone.add(boxMM(-(rOut - rIn) / 2, y0, -0.15, (rOut - rIn) / 2, y1, 0.15), M(ca * Math.sin(ae), 0, ca * Math.cos(ae), 0, ae + Math.PI / 2, 0), color);
    }
  };
  sector(R_IN - 1.2, R_OUT + 1.2, -0.3, 0.35, Sdark);
  sector(R_IN - 0.8, R_OUT + 0.8, COL_H, COL_H + 1.3, Slight);
  sector(R_IN - 1.1, R_OUT + 1.1, COL_H + 1.3, COL_H + 1.9, Slight);
  sector(R_IN - 0.6, R_OUT + 0.6, COL_H + 1.9, COL_H + 2.6, S);
  // planter boxes ("weeping women") + shrubs
  for (let i = 0; i < 6; i++) {
    const a = A0 + 0.12 + ((A1 - A0 - 0.24) * i) / 5;
    const rc = (R_IN + R_OUT) / 2;
    const x = rc * Math.sin(a), z = rc * Math.cos(a);
    stone.add(boxMM(-1.9, COL_H + 2.6, -1.4, 1.9, COL_H + 5.4, 1.4), M(x, 0, z, 0, a, 0), Slight);
    stone.add(boxMM(-2.1, COL_H + 5.4, -1.6, 2.1, COL_H + 5.8, 1.6), M(x, 0, z, 0, a, 0), S);
    for (let k = 0; k < 3; k++) {
      const g = new THREE.IcosahedronGeometry(0.9 + rand() * 0.4, 0);
      leaves.add(g, M(x + (rand() - 0.5) * 2, COL_H + 6.2, z + (rand() - 0.5) * 1.6, rand(), rand(), rand(), 1.2, 0.8, 1.2), new THREE.Color(rand() < 0.5 ? 0x4e6b2f : 0x5d7a36));
    }
  }

  return B.finish();
}
