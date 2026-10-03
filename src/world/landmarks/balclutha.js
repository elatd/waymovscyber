// Balclutha — three-masted square-rigged ship (Hyde Street Pier). Hull ~70 m
// along Z (bow +Z), waterline at y = 0 (hull continues below to the keel).
// Black hull with a white stripe, buff lower masts, black yards with furled
// cream sails, bowsprit/jib-boom, spanker gaff, shrouds/stays/ratlines.

import {
  LandmarkBuilder, std, glow, boxMM, rboxMM, beam, rod, cylY, V, M, noise3, smoothstep, clamp01, canvasTexture, fitText,
} from './common.js';
import * as THREE from 'three';

export const BALCLUTHA = Object.freeze({ hullLength: 71, beam: 12.4, mastHeight: 46, length: 84 });

const Z_STERN = -33, Z_BOW = 33;

function Bmax(t) {
  if (t < 0.3) return 2.3 + 3.9 * Math.pow(Math.max(0, 1 - Math.pow((0.3 - t) / 0.3, 2.0)), 0.55);
  if (t > 0.6) return 6.2 * Math.pow(Math.max(0, 1 - Math.pow((t - 0.6) / 0.4, 1.8)), 0.75);
  return 6.2;
}
const keelY = (t) => -6.2 + 2.0 * smoothstep(0.8, 1.0, t) + 1.5 * smoothstep(0.12, 0.0, t);
const sheerY = (t) => 4.4 + 7.0 * (t - 0.45) * (t - 0.45);
const zAt = (t, u) => Z_STERN + (Z_BOW - Z_STERN) * t + 3.0 * smoothstep(0.85, 1, t) * u - 2.6 * smoothstep(0.14, 0, t) * u;

/** Half-breadth at station t and normalised height u (0 keel .. 1 sheer). */
function halfBreadth(t, u) {
  const k = 1.3 + 2.0 * Math.pow(Math.sin(Math.PI * t), 1.5);
  const g = Math.pow(Math.max(0, 1 - Math.pow(1 - clamp01(u), k)), 1 / k);
  return Bmax(t) * g * (1 - 0.05 * Math.pow(clamp01(u), 4));
}

/** Point on the starboard (+X) hull at station t, absolute height y. */
function hullPoint(t, y, side = 1) {
  const yk = keelY(t), ys = sheerY(t) + 1.0; // +1 m bulwark
  const u = (y - yk) / (ys - yk);
  return V(side * halfBreadth(t, u), y, zAt(t, u));
}

export function createBalclutha() {
  const B = new LandmarkBuilder('Balclutha');

  const nameTex = canvasTexture('balclutha-name', 1024, 192, (ctx, w, h) => {
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e2b04a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'BALCLUTHA', w / 2, h * 0.38, w * 0.9, 100, 'bold', 'Georgia, "Times New Roman", serif');
    fitText(ctx, 'SAN FRANCISCO', w / 2, h * 0.78, w * 0.6, 46, 'bold', 'Georgia, "Times New Roman", serif');
  });

  const hullMat = std({ name: 'bal-hull', color: 0xffffff, vertexColors: true, roughness: 0.45, metalness: 0.05 });
  const woodMat = std({ name: 'bal-wood', color: 0xffffff, vertexColors: true, roughness: 0.6 });
  const sailMat = std({ name: 'bal-sails', color: 0xffffff, vertexColors: true, roughness: 0.95 });
  const ropeMat = std({ name: 'bal-rigging', color: 0x2a241e, roughness: 0.9 });
  const lampMat = glow({ name: 'bal-lamps', color: 0xe8dcc0, emissive: 0xffd08a, roughness: 0.3 }, 2.5);
  const nameMat = std({ name: 'bal-name', color: nameTex ? 0xffffff : 0x161616, map: nameTex, roughness: 0.5 });

  const hull = B.part('hull', hullMat);
  const wood = B.part('wood', woodMat);
  const sails = B.part('sails', sailMat);
  const rope = B.part('rigging', ropeMat, { castShadow: false });
  const lamps = B.part('lamps', lampMat, { castShadow: false, receiveShadow: false });
  const name = B.part('name', nameMat, { castShadow: false });

  // ---------------------------------------------------------------- hull (banded lofts)
  const NS = 44;
  const ts = [];
  for (let i = 0; i <= NS; i++) ts.push(i / NS);
  const bands = [
    [(t) => keelY(t), () => -0.05, 0x7b2a20, 5],
    [() => -0.05, (t) => sheerY(t) - 1.55, 0x121314, 4],
    [(t) => sheerY(t) - 1.55, (t) => sheerY(t) - 1.0, 0xebe6da, 1],
    [(t) => sheerY(t) - 1.0, (t) => sheerY(t) + 1.0, 0x121314, 2],
  ];
  for (const side of [1, -1]) {
    for (const [yA, yB, color, steps] of bands) {
      const rings = [];
      for (let s = 0; s <= steps; s++) {
        const row = [];
        for (const t of ts) {
          const ya = yA(t), yb = Math.max(yA(t) + 0.001, yB(t));
          row.push(hullPoint(t, ya + ((yb - ya) * s) / steps, side));
        }
        rings.push(row);
      }
      // build quads between rows (row index = height, column = station)
      const pos = [], idx = [];
      const W = ts.length;
      for (const row of rings) for (const p of row) pos.push(p.x, p.y, p.z);
      for (let r = 0; r < rings.length - 1; r++) {
        for (let c = 0; c < W - 1; c++) {
          const a = r * W + c, b = r * W + c + 1, d = (r + 1) * W + c, e = (r + 1) * W + c + 1;
          // starboard: outward normal +X  -> (a, b, e), (a, e, d); port mirrored
          if (side > 0) idx.push(a, e, b, a, d, e);
          else idx.push(a, b, e, a, e, d);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      hull.add(g, null, (x, y, z, nx, ny, nz, out) => {
        out.set(color);
        out.multiplyScalar(0.9 + 0.12 * noise3(x * 0.3, y * 0.6, z * 0.3));
      });
    }
  }
  // keel strip (closes the bottom seam)
  {
    const pts = ts.map((t) => V(0, keelY(t), zAt(t, 0)));
    for (let i = 0; i < pts.length - 1; i++) hull.add(beam(pts[i], pts[i + 1], 0.35, 0.35), null, 0x5e2119);
  }

  // ---------------------------------------------------------------- deck, bulwark inner faces, rail
  const deckY = (t) => sheerY(t) - 0.05;
  {
    const dts = ts.slice(0, -1); // stop one station short of the stem (avoids sliver triangles)
    const pos = [], idx = [], W = dts.length;
    const NX = 10;
    for (let j = 0; j <= NX; j++) {
      for (const t of dts) {
        const y = deckY(t);
        const yk = keelY(t), ys = sheerY(t) + 1.0;
        const hb = halfBreadth(t, (y - yk) / (ys - yk)) - 0.04;
        const x = -hb + (2 * hb * j) / NX;
        pos.push(x, y, zAt(t, (y - yk) / (ys - yk)));
      }
    }
    for (let j = 0; j < NX; j++) {
      for (let c = 0; c < W - 1; c++) {
        const a = j * W + c, b = j * W + c + 1, d = (j + 1) * W + c, e = (j + 1) * W + c + 1;
        idx.push(a, b, e, a, e, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    if (g.attributes.normal.getY(Math.floor(pos.length / 6)) < 0) {
      const ia = g.index.array;
      for (let k = 0; k < ia.length; k += 3) [ia[k + 1], ia[k + 2]] = [ia[k + 2], ia[k + 1]];
      g.computeVertexNormals();
    }
    wood.add(g, null, (x, y, z, nx, ny, nz, out) => {
      out.set(0xb08a5a);
      out.multiplyScalar(0.85 + 0.25 * noise3(x * 2.2, 0, z * 0.08));
    });
  }
  for (const side of [1, -1]) {
    // inner bulwark (white) + cap rail
    const pos = [], idx = [], W = ts.length;
    for (const yOff of [-0.05, 1.0]) {
      for (const t of ts) {
        const p = hullPoint(t, sheerY(t) + yOff, side);
        pos.push(p.x - side * 0.22, p.y, p.z);
      }
    }
    for (let c = 0; c < W - 1; c++) {
      const a = c, b = c + 1, d = W + c, e = W + c + 1;
      if (side > 0) idx.push(a, b, e, a, e, d);
      else idx.push(a, e, b, a, d, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    hull.add(g, null, 0xe6e1d4);
    for (let i = 0; i < ts.length - 1; i++) {
      const p = hullPoint(ts[i], sheerY(ts[i]) + 1.0, side), q = hullPoint(ts[i + 1], sheerY(ts[i + 1]) + 1.0, side);
      p.x -= side * 0.11;
      q.x -= side * 0.11;
      if (p.distanceTo(q) > 0.01) wood.add(beam(p, q, 0.36, 0.14, V(0, 1, 0)), null, 0x6b4a2c);
    }
  }
  // transom (closes the stern) + name board + portholes
  {
    const N = 10, pos = [], idx = [];
    const yk = keelY(0) + 0.06, yt = sheerY(0) + 1.0;
    for (let k = 0; k <= N; k++) {
      const y = yk + ((yt - yk) * k) / N;
      const a = hullPoint(0, y, -1), b = hullPoint(0, y, 1);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    for (let k = 0; k < N; k++) {
      const a = k * 2, b = k * 2 + 1, c = (k + 1) * 2, d = (k + 1) * 2 + 1;
      idx.push(a, c, d, a, d, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    if (g.attributes.normal.getZ(N) > 0) {
      const ia = g.index.array;
      for (let k = 0; k < ia.length; k += 3) [ia[k + 1], ia[k + 2]] = [ia[k + 2], ia[k + 1]];
      g.computeVertexNormals();
    }
    hull.add(g, null, (x, y, z, nx, ny, nz, out) => out.set(y < -0.05 ? 0x7b2a20 : 0x121314));
    const yA = sheerY(0) - 1.0, yB = sheerY(0) + 0.2;
    const P1 = hullPoint(0, yA, 1), P2 = hullPoint(0, yB, 1);
    P1.x = 0;
    P2.x = 0;
    const up = P2.clone().sub(P1).normalize();
    const X = V(-1, 0, 0), Z = new THREE.Vector3().crossVectors(X, up);
    const m = new THREE.Matrix4().makeBasis(X, up, Z);
    m.setPosition(P1.clone().lerp(P2, 0.5).addScaledVector(Z, 0.04));
    name.add(new THREE.PlaneGeometry(3.8, 0.8), m);
    for (const side of [1, -1]) {
      for (let k = 0; k < 9; k++) {
        const tt = 0.12 + k * 0.085;
        const q = hullPoint(tt, sheerY(tt) - 2.2, side);
        lamps.add(new THREE.CircleGeometry(0.22, 10), M(q.x + side * 0.04, q.y, q.z, 0, side * Math.PI / 2, 0));
      }
    }
  }

  // ---------------------------------------------------------------- deckhouses, hatches, wheel
  const tz = (z) => (z - Z_STERN) / (Z_BOW - Z_STERN);
  const dy = (z) => deckY(tz(z));
  wood.add(rboxMM(-3.2, dy(-24) - 0.1, -27, 3.2, dy(-24) + 2.3, -20, 0.15), null, 0xf0ebdf); // aft house
  wood.add(boxMM(-3.4, dy(-24) + 2.3, -27.2, 3.4, dy(-24) + 2.5, -19.8), null, 0x8a6a45);
  wood.add(rboxMM(-2.4, dy(10) - 0.1, 7, 2.4, dy(10) + 2.2, 13, 0.15), null, 0xf0ebdf); // galley house
  wood.add(boxMM(-2.6, dy(10) + 2.2, 6.8, 2.6, dy(10) + 2.4, 13.2), null, 0x8a6a45);
  for (const z of [-8, 24]) wood.add(boxMM(-1.6, dy(z) - 0.1, z - 1.6, 1.6, dy(z) + 0.6, z + 1.6), null, 0x7a5a38);
  for (const side of [-1, 1]) {
    for (const z of [-24, 10]) {
      for (const dz of [-1.5, 0, 1.5]) lamps.add(boxMM(side * 3.22 - 0.02, dy(z) + 1.0, z + dz - 0.35, side * 3.22 + 0.02, dy(z) + 1.6, z + dz + 0.35).translate(z === 10 ? -side * 0.8 : 0, 0, 0));
    }
  }
  wood.add(new THREE.TorusGeometry(0.75, 0.06, 6, 16), [0, dy(-29) + 1.5, -29.3], 0x6b4a2c);
  wood.add(cylY(0.12, 0.12, dy(-29), dy(-29) + 1.5, 6, false, 0, -29.6), null, 0x6b4a2c);

  // ---------------------------------------------------------------- masts, yards, furled sails
  const MASTS = [
    { z: 18, top: 44, scale: 1.0 },
    { z: 2, top: 46.5, scale: 1.05 },
    { z: -15, top: 38, scale: 0.82 },
  ];
  const BUFF = 0xcfae78, VARN = 0x9a6a3c, BLACK = 0x1c1c1c, CREAM = 0xeee3c8;
  const lumpy = (len, r, seed) => {
    const g = new THREE.CylinderGeometry(r, r, len, 8, 8, false);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + 0.35 * (noise3(x * 2 + seed, y * 0.9, z * 2) - 0.5) - 0.25 * Math.pow(Math.abs(y) / (len / 2), 6);
      p.setXYZ(i, x * k, y, z * k * 0.8);
    }
    g.computeVertexNormals();
    g.rotateZ(Math.PI / 2);
    return g;
  };
  const yardsOf = [];
  MASTS.forEach((m, mi) => {
    const s = m.scale;
    const y0 = dy(m.z) - 0.2;
    const lowTop = y0 + 14.5 * s, topTop = lowTop + 12.5 * s;
    wood.add(cylY(0.5 * s, 0.42 * s, y0, lowTop, 12, false, 0, m.z), null, BUFF);
    wood.add(cylY(0.33 * s, 0.25 * s, lowTop - 1.6, topTop, 10, false, 0, m.z - 0.5), null, VARN);
    wood.add(cylY(0.2 * s, 0.07, topTop - 1.2, m.top, 8, false, 0, m.z - 0.75), null, VARN);
    wood.add(boxMM(-1.9 * s, lowTop - 0.35, m.z - 1.3, 1.9 * s, lowTop - 0.15, m.z + 1.0), null, BLACK); // top
    wood.add(boxMM(-1.3 * s, topTop - 0.3, m.z - 0.9, 1.3 * s, topTop - 0.12, m.z - 0.5), null, BLACK); // crosstrees
    wood.add(new THREE.SphereGeometry(0.16, 8, 6), [0, m.top + 0.1, m.z - 0.75], 0xe2c26a);
    // yards: course, lower/upper topsail, topgallant, royal
    const yards = [
      [y0 + 12.3 * s, 24 * s, m.z + 0.45],
      [lowTop + 1.4 * s, 21 * s, m.z + 0.0],
      [lowTop + 6.4 * s, 18 * s, m.z - 0.1],
      [topTop + 1.8 * s, 14 * s, m.z - 0.45],
      [topTop + 7.3 * s, 10.5 * s, m.z - 0.6],
    ];
    yardsOf.push(yards);
    for (const [yy, len, zz] of yards) {
      for (const sx of [-1, 1]) wood.add(rod(V(0, yy, zz), V(sx * len / 2, yy, zz), 0.3 * s, 8, false, 0.12), null, BLACK);
      sails.add(lumpy(len * 0.86, 0.42 * s, mi * 10 + yy), [0, yy + 0.42 * s, zz + 0.2], (x, y, z, nx, ny, nz, out) => {
        out.set(CREAM);
        out.multiplyScalar(0.85 + 0.2 * noise3(x * 1.3, y * 2, z * 2));
      });
      // lifts / footropes
      for (const sx of [-1, 1]) rope.add(rod(V(sx * len * 0.47, yy - 0.05, zz), V(sx * len * 0.1, yy - 0.9, zz), 0.03, 3, true));
    }
    // shrouds + ratlines to the hull sides
    const mt = tz(m.z);
    for (const side of [-1, 1]) {
      const chain = [];
      for (let k = 0; k < 4; k++) {
        const zc = m.z - 2.6 + k * 1.0;
        const p = hullPoint(tz(zc), sheerY(tz(zc)) + 0.95, side);
        chain.push(p);
        rope.add(rod(V(side * 0.4 * s, lowTop - 0.5, m.z - 0.2), p, 0.05, 4, true));
      }
      for (let r = 1; r < 16; r++) {
        const f = r / 16;
        const a = chain[0].clone().lerp(V(side * 0.4 * s, lowTop - 0.5, m.z - 0.2), f);
        const b = chain[3].clone().lerp(V(side * 0.4 * s, lowTop - 0.5, m.z - 0.2), f);
        rope.add(rod(a, b, 0.025, 3, true));
      }
      // topmast shrouds to the top's edge, backstays to the hull
      for (let k = 0; k < 3; k++) {
        rope.add(rod(V(side * 0.25 * s, topTop - 0.4, m.z - 0.5), V(side * 1.8 * s, lowTop - 0.25, m.z - 1.1 + k * 0.9), 0.04, 3, true));
      }
      const bz = m.z - 6.5;
      rope.add(rod(V(side * 0.2, topTop - 0.2, m.z - 0.5), hullPoint(tz(bz), sheerY(tz(bz)) + 0.95, side), 0.045, 4, true));
      rope.add(rod(V(side * 0.12, m.top - 1.5, m.z - 0.75), hullPoint(tz(bz - 1.2), sheerY(tz(bz - 1.2)) + 0.95, side), 0.04, 4, true));
    }
    void mt;
  });

  // ---------------------------------------------------------------- bowsprit, jib-boom, stays
  const bowT = 1.0;
  const bowTip = V(0, sheerY(bowT) + 0.4, zAt(bowT, 1));
  const spritEnd = V(0, bowTip.y + 3.2, bowTip.z + 11);
  const jibEnd = V(0, spritEnd.y + 1.6, spritEnd.z + 6.5);
  wood.add(rod(bowTip.clone().add(V(0, -0.6, -3)), spritEnd, 0.48, 10, false, 0.32), null, BUFF);
  wood.add(rod(spritEnd.clone().add(V(0, -0.4, -1.5)), jibEnd, 0.24, 8, false, 0.12), null, VARN);
  rope.add(rod(spritEnd, V(0, 0.4, bowTip.z - 2.6), 0.06, 4, true)); // bobstay
  rope.add(rod(jibEnd, V(0, 1.2, bowTip.z - 3.2), 0.05, 4, true)); // martingale-ish
  const fore = MASTS[0], main = MASTS[1], miz = MASTS[2];
  const head = (m, f) => V(0, dy(m.z) + (m.top - dy(m.z)) * f, m.z - 0.5);
  rope.add(rod(head(fore, 0.36), spritEnd, 0.06, 4, true));
  rope.add(rod(head(fore, 0.62), jibEnd, 0.05, 4, true));
  rope.add(rod(head(fore, 0.95), jibEnd, 0.04, 4, true));
  rope.add(rod(head(main, 0.36), V(0, dy(fore.z) + 1.2, fore.z), 0.06, 4, true));
  rope.add(rod(head(main, 0.62), head(fore, 0.36), 0.05, 4, true));
  rope.add(rod(head(main, 0.95), head(fore, 0.62), 0.04, 4, true));
  rope.add(rod(head(miz, 0.36), V(0, dy(main.z) + 1.2, main.z), 0.05, 4, true));
  rope.add(rod(head(miz, 0.62), head(main, 0.36), 0.04, 4, true));
  rope.add(rod(head(miz, 0.95), head(main, 0.62), 0.04, 4, true));
  // furled headsails along the stays
  for (const [a, b] of [[head(fore, 0.36), spritEnd], [head(fore, 0.62), jibEnd]]) {
    const dir = b.clone().sub(a);
    const len = dir.length() * 0.42;
    const mid = b.clone().addScaledVector(dir.normalize(), -len * 0.6);
    const g = lumpy(len, 0.28, a.y);
    g.rotateZ(-Math.PI / 2);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir);
    sails.add(g, new THREE.Matrix4().compose(mid, q, V(1, 1, 1)), CREAM);
  }

  // ---------------------------------------------------------------- spanker gaff + boom
  {
    const zb = miz.z;
    const boomA = V(0, dy(zb) + 2.4, zb - 0.6), boomB = V(0, dy(-31) + 2.9, -31.5);
    const gaffA = V(0, dy(zb) + 13.5, zb - 0.6), gaffB = V(0, dy(zb) + 17.5, zb - 12.5);
    wood.add(rod(boomA, boomB, 0.24, 8, false, 0.16), null, VARN);
    wood.add(rod(gaffA, gaffB, 0.2, 8, false, 0.12), null, VARN);
    const g = lumpy(boomA.distanceTo(boomB) * 0.85, 0.35, 3);
    g.rotateZ(-Math.PI / 2);
    const dir = boomB.clone().sub(boomA).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir);
    sails.add(g, new THREE.Matrix4().compose(boomA.clone().lerp(boomB, 0.5).add(V(0, 0.42, 0)), q, V(1, 1, 1)), CREAM);
    rope.add(rod(gaffB, boomB, 0.04, 3, true));
    rope.add(rod(head(miz, 0.95), gaffB, 0.04, 3, true));
  }

  // anchor light at the forestay + stern lantern
  lamps.add(new THREE.SphereGeometry(0.22, 10, 8), [0, dy(fore.z) + 9, fore.z + 1.2]);
  lamps.add(new THREE.SphereGeometry(0.26, 10, 8), [0, sheerY(0) + 2.1, zAt(0, 1) + 0.5]);
  wood.add(cylY(0.05, 0.05, sheerY(0) + 1.0, sheerY(0) + 1.9, 4, true, 0, zAt(0, 1) + 0.5), null, BLACK);

  B.collider(0, 0.5, 6.4, 35.8, 8);
  return B.finish();
}
