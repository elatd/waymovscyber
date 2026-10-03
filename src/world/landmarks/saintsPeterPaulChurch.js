// Saints Peter and Paul Church (North Beach) — white Romanesque-revival facade,
// twin ornate spires (~58 m + crosses), rose window, three portals and steps.
// Footprint 30 (X) x 50 (Z), facade/front faces +Z.

import {
  LandmarkBuilder, std, glow, boxMM, rboxMM, prismGeo, latheGeo, extrudeGeo, archShape, archRingGeo,
  ngon, cylY, V, M, noise3, smoothstep, canvasTexture, fitText,
} from './common.js';
import * as THREE from 'three';

export const SAINTS_PETER_PAUL = Object.freeze({ width: 30, depth: 50, height: 59.6, spireTop: 58 });

const FZ = 21.5; // facade plane

function drawGlass(ctx, w, h) {
  // left half: rose window, right half: lancet pattern
  const R = h / 2;
  ctx.fillStyle = '#10204a';
  ctx.fillRect(0, 0, w, h);
  const cols = ['#1d4fb8', '#c8202b', '#f2b630', '#1f8a5a', '#7a2fa0', '#2a78d6'];
  for (let ring = 0; ring < 4; ring++) {
    const r0 = R * (0.12 + ring * 0.22), r1 = R * (0.12 + (ring + 1) * 0.22);
    const n = 6 + ring * 6;
    for (let k = 0; k < n; k++) {
      ctx.fillStyle = cols[(k + ring * 2) % cols.length];
      ctx.beginPath();
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      ctx.arc(R, R, Math.min(r1, R * 0.98), a0, a1);
      ctx.arc(R, R, r0, a1, a0, true);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.fillStyle = '#f2d36b';
  ctx.beginPath();
  ctx.arc(R, R, R * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 4;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(R + Math.cos(a) * R * 0.12, R + Math.sin(a) * R * 0.12);
    ctx.lineTo(R + Math.cos(a) * R, R + Math.sin(a) * R);
    ctx.stroke();
  }
  // lancets
  const x0 = w / 2;
  for (let y = 0; y < h; y += 16) {
    for (let x = 0; x < w / 2; x += 16) {
      ctx.fillStyle = cols[((x + y) / 16 + (y / 16) * 3) % cols.length];
      ctx.fillRect(x0 + x + 1, y + 1, 14, 14);
    }
  }
  ctx.fillStyle = '#f2d36b';
  ctx.fillRect(x0 + w / 4 - 10, h * 0.3, 20, h * 0.4);
}

function drawFrieze(ctx, w, h) {
  ctx.fillStyle = '#ece6d8';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#5a4f3f';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, "LA GLORIA DI COLUI CHE TUTTO MOVE PER L'UNIVERSO PENETRA E RISPLENDE", w / 2, h / 2, w - 30, h * 0.62, 'bold', 'Georgia, "Times New Roman", serif');
}

/** Remap a flat shape geometry's UVs to an atlas rectangle using its local bounds. */
function remapUV(geo, u0, v0, u1, v1) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox, p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const u = (p.getX(i) - bb.min.x) / (bb.max.x - bb.min.x || 1);
    const v = (p.getY(i) - bb.min.y) / (bb.max.y - bb.min.y || 1);
    uv.setXY(i, u0 + u * (u1 - u0), v0 + v * (v1 - v0));
  }
  return geo;
}

export function createSaintsPeterPaulChurch() {
  const B = new LandmarkBuilder('SaintsPeterPaulChurch');
  const glassTex = canvasTexture('sspp-glass', 512, 256, drawGlass);
  const friezeTex = canvasTexture('sspp-frieze', 2048, 64, drawFrieze);

  const stoneMat = glow({ name: 'sspp-stone', color: 0xffffff, vertexColors: true, roughness: 0.8, emissive: 0xfff4e4 }, 0.16);
  const darkMat = std({ name: 'sspp-roof-doors', color: 0xffffff, vertexColors: true, roughness: 0.7, metalness: 0.15 });
  const glassMat = glow({ name: 'sspp-stained-glass', color: glassTex ? 0xffffff : 0x22407a, map: glassTex, emissive: 0xffffff, emissiveMap: glassTex, roughness: 0.25, metalness: 0.3 }, 1.6);
  const goldMat = std({ name: 'sspp-gold', color: 0xe2b04a, roughness: 0.25, metalness: 1 });
  const friezeMat = std({ name: 'sspp-frieze', color: friezeTex ? 0xffffff : 0xe6dfcf, map: friezeTex, roughness: 0.8 });
  const louverMat = glow({ name: 'sspp-belfry', color: 0x1f2226, emissive: 0xffd9a0, roughness: 0.6 }, 0.6);

  const stone = B.part('stone', stoneMat);
  const dark = B.part('roofDoors', darkMat);
  const glass = B.part('stainedGlass', glassMat, { castShadow: false });
  const gold = B.part('gold', goldMat);
  const frieze = B.part('frieze', friezeMat, { castShadow: false });
  const louver = B.part('belfry', louverMat, { castShadow: false });

  const white = (hex = 0xf1ece0) => (x, y, z, nx, ny, nz, out) => {
    out.set(hex);
    out.multiplyScalar((0.9 + 0.1 * noise3(x * 0.3, y * 0.3, z * 0.3)) * (0.9 + 0.1 * smoothstep(0, 6, y)));
  };
  const S = white(), Strim = white(0xf8f4ea), Sshade = white(0xe2dccd);
  const ROOF = 0x6f7276, WOOD = 0x4a2c1d;

  const lancet = (w, hRect, x, y, z, rotY = 0, inset = 0.03) => {
    const g = remapUV(new THREE.ShapeGeometry(archShape(w, hRect, 0, 0, 10)), 0.5, 0, 1, 1);
    glass.add(g, M(x, y, z, 0, rotY, 0).multiply(M(0, 0, inset)));
    stone.add(archRingGeo(w / 2, w / 2 + 0.28, 0.3, 0, Math.PI, 10), M(x, y + hRect, z, 0, rotY, 0), Strim);
  };

  // ---------------------------------------------------------------- nave + apse
  const NX = 12, NZ0 = -18.5, NZ1 = 15.5, WALL = 18;
  stone.add(boxMM(-NX, 0, NZ0, NX, WALL, NZ1), null, S);
  stone.add(boxMM(-NX - 0.25, WALL - 0.6, NZ0 - 0.25, NX + 0.25, WALL, NZ1), null, Strim);
  {
    const b = [[NX + 0.6, NZ0 - 0.4], [NX + 0.6, NZ1], [-NX - 0.6, NZ1], [-NX - 0.6, NZ0 - 0.4]];
    const t = [[0.05, NZ0 - 0.4], [0.05, NZ1], [-0.05, NZ1], [-0.05, NZ0 - 0.4]];
    dark.add(prismGeo(b, t, WALL, WALL + 8.5), null, ROOF);
  }
  // apse (half cylinder + half dome) at the back
  stone.add(latheGeo([[6.5, 0], [6.5, WALL - 3]], 16, 30, Math.PI / 2, Math.PI), [0, 0, NZ0], S);
  dark.add(latheGeo([[6.9, WALL - 3], [6.4, WALL - 1], [5.2, WALL + 1.2], [3.2, WALL + 2.8], [0, WALL + 3.4]], 16, 30, Math.PI / 2, Math.PI), [0, 0, NZ0], ROOF);
  for (let k = 0; k < 5; k++) {
    const a = Math.PI / 2 + ((k + 0.5) / 5) * Math.PI;
    const g = remapUV(new THREE.ShapeGeometry(archShape(1.3, 3.2, 0, 0, 8)), 0.5, 0, 1, 1);
    glass.add(g, M(6.54 * Math.sin(a), 6, NZ0 + 6.54 * Math.cos(a), 0, a, 0));
  }
  // side windows + buttresses
  for (const s of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      const z = NZ0 + 3 + k * 5.4;
      lancet(1.8, 5.2, s * (NX + 0.02), 6.5, z, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0.01);
      if (k < 5) stone.add(boxMM(s > 0 ? NX : -NX - 0.8, 0, z + 2.3, s > 0 ? NX + 0.8 : -NX, WALL - 1.2, z + 3.1), null, Sshade);
    }
  }

  // ---------------------------------------------------------------- narthex + central facade
  stone.add(boxMM(-8.5, 0, NZ1, 8.5, 21, FZ - 0.9), null, S);
  {
    const sh = new THREE.Shape();
    sh.moveTo(-8.5, 0);
    sh.lineTo(8.5, 0);
    sh.lineTo(8.5, 21);
    sh.lineTo(0, 28.2);
    sh.lineTo(-8.5, 21);
    sh.closePath();
    stone.add(extrudeGeo(sh, 1.0), [0, 0, FZ], S);
    // gable coping
    for (const s of [-1, 1]) {
      const a = V(s * 8.7, 20.9, FZ), b = V(0, 28.5, FZ);
      const g = new THREE.BoxGeometry(Math.hypot(8.7, 7.6) + 0.6, 0.55, 1.5);
      const ang = Math.atan2(7.6, -s * 8.7);
      stone.add(g, M((a.x + b.x) / 2, (a.y + b.y) / 2, a.z, 0, 0, ang), Strim);
    }
    gold.add(boxMM(-0.09, 28.6, FZ - 0.09, 0.09, 30.6, FZ + 0.09));
    gold.add(boxMM(-0.6, 29.75, FZ - 0.09, 0.6, 29.93, FZ + 0.09));
  }
  // portals
  for (const [x, w, hr] of [[0, 3.4, 4.2], [-5.2, 2.2, 3.2], [5.2, 2.2, 3.2]]) {
    dark.add(new THREE.ShapeGeometry(archShape(w, hr, 0, 0, 12)), [x, 1.2, FZ + 0.53], WOOD);
    stone.add(archRingGeo(w / 2, w / 2 + 0.45, 0.5, 0, Math.PI, 12), [x, 1.2 + hr, FZ + 0.6], Strim);
    for (const s of [-1, 1]) stone.add(boxMM(x + s * (w / 2 + 0.22) - 0.22, 1.2, FZ + 0.35, x + s * (w / 2 + 0.22) + 0.22, 1.2 + hr, FZ + 0.85), null, Strim);
  }
  // frieze with Dante's inscription
  stone.add(boxMM(-8.5, 7.9, FZ + 0.5, 8.5, 8.9, FZ + 0.75), null, Strim);
  frieze.add(new THREE.PlaneGeometry(16.6, 0.62), [0, 8.4, FZ + 0.78]);
  // arcade of small windows
  for (let k = -3; k <= 3; k++) {
    const g = remapUV(new THREE.ShapeGeometry(archShape(1.0, 1.6, 0, 0, 8)), 0.5, 0, 1, 1);
    glass.add(g, [k * 2.1, 10.2, FZ + 0.53]);
    stone.add(cylY(0.16, 0.16, 10.2, 12.0, 8, false, k * 2.1 + 1.05, FZ + 0.62), null, Strim);
  }
  stone.add(boxMM(-8.5, 12.2, FZ + 0.5, 8.5, 12.6, FZ + 0.8), null, Strim);
  // rose window
  {
    const RY = 16.8, RR = 2.9;
    const g = remapUV(new THREE.CircleGeometry(RR, 40), 0, 0, 0.5, 1);
    glass.add(g, [0, RY, FZ + 0.53]);
    stone.add(new THREE.TorusGeometry(RR + 0.15, 0.32, 8, 40), [0, RY, FZ + 0.6], Strim);
    stone.add(new THREE.TorusGeometry(0.45, 0.12, 6, 16), [0, RY, FZ + 0.62], Strim);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      stone.add(boxMM(-0.07, 0.45, -0.07, 0.07, RR, 0.07), M(0, RY, FZ + 0.62, 0, 0, a), Strim);
    }
  }

  // ---------------------------------------------------------------- twin towers + spires
  for (const s of [-1, 1]) {
    const cx = s * 11.5, cz = FZ - 3;
    const h1 = 3.0, h2 = 2.6;
    stone.add(boxMM(cx - h1, 0, cz - h1, cx + h1, 21, cz + h1), null, S);
    for (const [ex, ez] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      stone.add(boxMM(cx + ex * h1 - 0.45, 0, cz + ez * h1 - 0.45, cx + ex * h1 + 0.45, 21.4, cz + ez * h1 + 0.45), null, Strim);
    }
    for (const y of [8, 14.6]) stone.add(boxMM(cx - h1 - 0.2, y, cz - h1 - 0.2, cx + h1 + 0.2, y + 0.45, cz + h1 + 0.2), null, Strim);
    stone.add(boxMM(cx - h1 - 0.5, 21, cz - h1 - 0.5, cx + h1 + 0.5, 21.8, cz + h1 + 0.5), null, Strim);
    // windows on the tower front + outer side
    lancet(1.5, 3.4, cx, 9.4, cz + h1 + 0.01, 0, 0.02);
    lancet(1.5, 3.4, cx + s * (h1 + 0.01), 9.4, cz, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0.02);
    glass.add(remapUV(new THREE.CircleGeometry(0.75, 20), 0, 0, 0.5, 1), [cx, 17.6, cz + h1 + 0.03]);
    stone.add(new THREE.TorusGeometry(0.85, 0.14, 6, 20), [cx, 17.6, cz + h1 + 0.05], Strim);
    // belfry stage
    stone.add(boxMM(cx - h2, 21.8, cz - h2, cx + h2, 31, cz + h2), null, S);
    for (let f = 0; f < 4; f++) {
      const a = (f * Math.PI) / 2;
      for (const u of [-1.05, 1.05]) {
        louver.add(new THREE.ShapeGeometry(archShape(1.3, 4.4, 0, 0, 8)), M(cx, 23.2, cz, 0, a, 0).multiply(M(u, 0, h2 + 0.03)));
        stone.add(archRingGeo(0.65, 0.9, 0.25, 0, Math.PI, 8), M(cx, 27.6, cz, 0, a, 0).multiply(M(u, 0, h2 + 0.12)), Strim);
      }
    }
    stone.add(boxMM(cx - h2 - 0.5, 31, cz - h2 - 0.5, cx + h2 + 0.5, 31.8, cz + h2 + 0.5), null, Strim);
    // octagonal lantern + corner pinnacles
    const oct = ngon(8, 2.25, cx, cz, Math.PI / 8);
    stone.add(prismGeo(oct, oct, 31.8, 37.4), null, S);
    for (let f = 0; f < 8; f += 2) {
      const a = (f / 8) * Math.PI * 2 + Math.PI / 2;
      louver.add(new THREE.ShapeGeometry(archShape(0.8, 2.0, 0, 0, 8)), M(cx + 2.1 * Math.sin(a), 33.0, cz + 2.1 * Math.cos(a), 0, a, 0));
    }
    const oct2 = ngon(8, 2.55, cx, cz, Math.PI / 8);
    stone.add(prismGeo(oct2, oct2, 37.4, 38.0), null, Strim);
    for (const [ex, ez] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const px = cx + ex * (h2 - 0.15), pz = cz + ez * (h2 - 0.15);
      stone.add(boxMM(px - 0.4, 31.8, pz - 0.4, px + 0.4, 35.0, pz + 0.4), null, Strim);
      stone.add(new THREE.ConeGeometry(0.55, 3.4, 4).rotateY(Math.PI / 4), [px, 36.7, pz], Strim);
      gold.add(new THREE.SphereGeometry(0.14, 8, 6), [px, 38.5, pz]);
    }
    // spire with edge ribs
    const SP0 = 38.0, SP1 = 58.0;
    stone.add(new THREE.ConeGeometry(2.4, SP1 - SP0, 8, 1, true).rotateY(Math.PI / 8), [cx, (SP0 + SP1) / 2, cz], (x, y, z, nx, ny, nz, out) => {
      out.set(0xf3efe5);
      out.multiplyScalar(0.92 + 0.08 * noise3(x, y * 0.3, z));
    });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const p0 = V(cx + 2.42 * Math.sin(a), SP0, cz + 2.42 * Math.cos(a));
      const p1 = V(cx, SP1 - 0.3, cz);
      const g = new THREE.BoxGeometry(0.22, p0.distanceTo(p1), 0.22);
      const dir = p1.clone().sub(p0).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir);
      const m = new THREE.Matrix4().compose(p0.clone().add(p1).multiplyScalar(0.5), q, V(1, 1, 1));
      stone.add(g, m, Strim);
    }
    gold.add(new THREE.SphereGeometry(0.28, 10, 8), [cx, SP1 + 0.1, cz]);
    gold.add(boxMM(cx - 0.08, SP1 + 0.2, cz - 0.08, cx + 0.08, SP1 + 1.6, cz + 0.08));
    gold.add(boxMM(cx - 0.5, SP1 + 1.0, cz - 0.08, cx + 0.5, SP1 + 1.16, cz + 0.08));
    B.collider(cx, cz, h1 + 0.5, h1 + 0.5, SP1 + 1.6);
  }

  // ---------------------------------------------------------------- steps
  for (let k = 0; k < 5; k++) {
    stone.add(boxMM(-9.5 + k * 0.15, 0, FZ + 0.5, 9.5 - k * 0.15, 1.2 - k * 0.24, FZ + 3.4 - k * 0.55), null, Sshade);
  }

  B.collider(0, (NZ0 - 6.5 + FZ) / 2, NX + 0.8, (FZ - (NZ0 - 6.5)) / 2, 28.2);
  B.collider(0, FZ + 1.95, 9.5, 1.45, 1.2);
  return B.finish();
}
