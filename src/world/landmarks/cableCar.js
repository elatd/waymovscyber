// San Francisco cable car — 8.4 m long along Z (front = +Z, grip end), 2.5 m
// wide, ~3.3 m tall. Wheel bottoms at y = 0. Open end sections with outward
// benches and brass grab poles, enclosed centre cabin, clerestory roof.
// Geometry and materials are built once and shared by every instance.

import {
  LandmarkBuilder, std, phys, glow, boxMM, rboxMM, cylY, rod, latheGeo, V, M, noise3, canvasTexture, fitText,
} from './common.js';
import * as THREE from 'three';

export const CABLE_CAR = Object.freeze({ length: 8.4, width: 2.5, height: 3.32, trackGauge: 1.067 });

function uvRegion(geo, u0, v0, u1, v1) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return geo;
}

function drawSigns(ctx, w, h) {
  ctx.fillStyle = '#f3efe2';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // A: end board
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, w, 6);
  ctx.fillRect(0, 122, w, 6);
  fitText(ctx, 'POWELL & MARKET', w / 2, 66, w - 60, 92, 'bold', '"Arial Black", Arial, Helvetica, sans-serif');
  // B: side board
  ctx.fillStyle = '#7a1e22';
  ctx.fillRect(0, 128, w, 128);
  ctx.fillStyle = '#f3e3b0';
  fitText(ctx, 'POWELL & MASON STS', w / 2, 194, w - 60, 84, 'bold', 'Georgia, "Times New Roman", serif');
  // C: car number
  ctx.fillStyle = '#efe3c4';
  ctx.fillRect(0, 256, 256, 256);
  ctx.fillStyle = '#d4a03c';
  ctx.font = 'bold 190px Georgia, "Times New Roman", serif';
  ctx.fillText('12', 128, 392);
  ctx.strokeStyle = '#7a1e22';
  ctx.lineWidth = 6;
  ctx.strokeText('12', 128, 392);
  // D: "MUNICIPAL RAILWAY" letterboard
  ctx.fillStyle = '#efe3c4';
  ctx.fillRect(256, 256, 768, 128);
  ctx.fillStyle = '#7a1e22';
  fitText(ctx, 'MUNICIPAL RAILWAY', 640, 322, 700, 72, 'bold', 'Georgia, "Times New Roman", serif');
}

let PROTO = null;

function buildPrototype() {
  const B = new LandmarkBuilder('CableCar');
  const signTex = canvasTexture('cablecar-signs', 1024, 512, drawSigns);

  const paintMat = phys({ name: 'cc-paint', color: 0xffffff, vertexColors: true, roughness: 0.32, metalness: 0.05, clearcoat: 0.7, clearcoatRoughness: 0.15 });
  const woodMat = std({ name: 'cc-wood', color: 0xffffff, vertexColors: true, roughness: 0.45 });
  const brassMat = std({ name: 'cc-brass', color: 0xd6a54a, roughness: 0.25, metalness: 1.0 });
  const ironMat = std({ name: 'cc-iron', color: 0x2b2a29, roughness: 0.55, metalness: 0.65 });
  const glassMat = phys({ name: 'cc-glass', color: 0x1d2a33, roughness: 0.05, metalness: 0.2, clearcoat: 1.0, envMapIntensity: 1.4 });
  const signMat = std({ name: 'cc-signs', color: signTex ? 0xffffff : 0xf0ead8, map: signTex, roughness: 0.6 });
  const lightMat = glow({ name: 'cc-lights', color: 0xfff4d6, emissive: 0xfff0c8, roughness: 0.2 }, 3.5);

  const paint = B.part('paint', paintMat);
  const wood = B.part('wood', woodMat);
  const brass = B.part('brass', brassMat);
  const iron = B.part('iron', ironMat);
  const glass = B.part('glass', glassMat, { castShadow: false });
  const signs = B.part('signs', signMat, { castShadow: false });
  const lights = B.part('lights', lightMat, { castShadow: false, receiveShadow: false });

  const MAROON = 0x7a1e22, CREAM = 0xefe3c4, GOLD = 0xd4a03c, ROOF = 0xc9c4ba, DARK = 0x2a2624, BLUE = 0x24406e;
  const varnish = (x, y, z, nx, ny, nz, out) => {
    out.set(0x9a6237);
    out.multiplyScalar(0.85 + 0.25 * noise3(x * 6, y * 2, z * 0.8));
  };

  const L = 4.2, W = 1.25, FLOOR = 1.0, ROOFY = 2.78, CAB = 1.95;
  // ---------------------------------------------------------------- running gear
  for (const tz of [-2.6, 2.6]) {
    iron.add(boxMM(-0.78, 0.28, tz - 0.85, 0.78, 0.6, tz + 0.85));
    for (const wz of [tz - 0.5, tz + 0.5]) {
      for (const wx of [-0.53, 0.53]) {
        const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.1, 18);
        wheel.rotateZ(Math.PI / 2);
        iron.add(wheel, [wx, 0.33, wz]);
        const hub = new THREE.CylinderGeometry(0.12, 0.12, 0.16, 10);
        hub.rotateZ(Math.PI / 2);
        brass.add(hub, [wx, 0.33, wz]);
      }
      iron.add(rod(V(-0.62, 0.33, wz), V(0.62, 0.33, wz), 0.05, 6, false));
    }
  }
  iron.add(boxMM(-1.15, 0.6, -L + 0.2, 1.15, 0.82, L - 0.2));
  // floor + running boards
  wood.add(boxMM(-W + 0.03, 0.82, -L + 0.05, W - 0.03, FLOOR, L - 0.05), null, varnish);
  for (const s of [-1, 1]) {
    for (const zs of [-1, 1]) {
      const z0 = zs * (CAB + 0.05), z1 = zs * (L - 0.15);
      wood.add(boxMM(s > 0 ? W - 0.05 : -W - 0.3, 0.62, Math.min(z0, z1), s > 0 ? W + 0.3 : -W + 0.05, 0.72, Math.max(z0, z1)), null, varnish);
      iron.add(boxMM(s * (W + 0.12) - 0.04, 0.4, Math.min(z0, z1) + 0.2, s * (W + 0.12) + 0.04, 0.64, Math.max(z0, z1) - 0.2));
    }
  }

  // ---------------------------------------------------------------- enclosed centre cabin
  for (const s of [-1, 1]) {
    const xo = s * W, xi = s * (W - 0.08);
    const lo = Math.min(xo, xi), hi = Math.max(xo, xi);
    paint.add(boxMM(lo, FLOOR, -CAB, hi, 1.75, CAB), null, MAROON);
    // gold pinstripe frame on the lower panel
    const xs0 = s > 0 ? hi : lo - 0.02, xs1 = s > 0 ? hi + 0.02 : lo;
    for (const y of [1.12, 1.62]) paint.add(boxMM(xs0, y, -CAB + 0.12, xs1, y + 0.03, CAB - 0.12), null, GOLD);
    for (const z of [-CAB + 0.12, -0.02, CAB - 0.15]) paint.add(boxMM(xs0, 1.12, z, xs1, 1.65, z + 0.03), null, GOLD);
    // window band
    paint.add(boxMM(lo, 1.75, -CAB, hi, 1.82, CAB), null, CREAM);
    paint.add(boxMM(lo, 2.5, -CAB, hi, 2.56, CAB), null, CREAM);
    const posts = [-CAB, -0.975, 0, 0.975, CAB];
    posts.forEach((zp) => paint.add(boxMM(lo, 1.82, zp - 0.07, hi, 2.5, zp + 0.07), null, CREAM));
    for (let k = 0; k < 4; k++) {
      const z0 = posts[k] + 0.07, z1 = posts[k + 1] - 0.07;
      glass.add(boxMM(s * (W - 0.06) - 0.012, 1.82, z0, s * (W - 0.06) + 0.012, 2.5, z1));
    }
    // letterboard
    paint.add(boxMM(lo - (s < 0 ? 0.01 : 0), 2.56, -CAB, hi + (s > 0 ? 0.01 : 0), ROOFY, CAB), null, CREAM);
    paint.add(boxMM(xs0, 2.58, -CAB + 0.05, xs1, 2.6, CAB - 0.05), null, GOLD);
    paint.add(boxMM(xs0, 2.74, -CAB + 0.05, xs1, 2.76, CAB - 0.05), null, GOLD);
    const lb = uvRegion(new THREE.PlaneGeometry(2.7, 0.12), 0.25, 0.25, 1.0, 0.5);
    signs.add(lb, M(s * (W + 0.035), 2.632, 0, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0));
  }
  // cabin bulkheads with door windows
  for (const zs of [-1, 1]) {
    const zo = zs * CAB, zi = zs * (CAB - 0.08);
    const lo = Math.min(zo, zi), hi = Math.max(zo, zi);
    paint.add(boxMM(-W, FLOOR, lo, -0.45, ROOFY, hi), null, CREAM);
    paint.add(boxMM(0.45, FLOOR, lo, W, ROOFY, hi), null, CREAM);
    paint.add(boxMM(-0.45, 2.45, lo, 0.45, ROOFY, hi), null, CREAM);
    paint.add(boxMM(-W, FLOOR, lo - 0.005, -0.45, 1.75, hi + 0.005), null, MAROON);
    paint.add(boxMM(0.45, FLOOR, lo - 0.005, W, 1.75, hi + 0.005), null, MAROON);
    glass.add(boxMM(-0.45, 1.1, zs * (CAB - 0.04) - 0.012, 0.45, 2.45, zs * (CAB - 0.04) + 0.012));
    for (const wx of [-0.85, 0.85]) glass.add(boxMM(wx - 0.3, 1.85, zo + zs * 0.012 - 0.012, wx + 0.3, 2.4, zo + zs * 0.012 + 0.012));
  }

  // ---------------------------------------------------------------- open end sections
  for (const zs of [-1, 1]) {
    const z0 = zs * (CAB + 0.05), z1 = zs * (L - 0.32);
    const zl = Math.min(z0, z1), zh = Math.max(z0, z1);
    // central bench back + outward-facing seats
    wood.add(boxMM(-0.07, FLOOR, zl, 0.07, 2.02, zh), null, varnish);
    wood.add(boxMM(-0.1, 1.98, zl, 0.1, 2.06, zh), null, varnish);
    for (const s of [-1, 1]) {
      wood.add(boxMM(s > 0 ? 0.07 : -0.62, 1.42, zl + 0.05, s > 0 ? 0.62 : -0.07, 1.5, zh - 0.05), null, varnish);
      for (let k = 0; k < 4; k++) {
        const zz = zl + 0.2 + ((zh - zl - 0.4) * k) / 3;
        iron.add(boxMM(s * 0.4 - 0.03, FLOOR, zz - 0.03, s * 0.4 + 0.03, 1.42, zz + 0.03));
      }
      // low skirt under the seats
      paint.add(boxMM(s > 0 ? W - 0.06 : -W - 0.015, FLOOR - 0.15, zl, s > 0 ? W + 0.015 : -W + 0.06, 1.38, zh), null, MAROON);
      paint.add(boxMM(s > 0 ? W + 0.015 : -W - 0.035, 1.3, zl + 0.05, s > 0 ? W + 0.035 : -W - 0.015, 1.33, zh - 0.05), null, GOLD);
      // brass grab poles
      for (const zp of [0.25, 0.95, 1.65]) {
        const z = zs * (CAB + zp + 0.05);
        brass.add(cylY(0.028, 0.028, 1.38, ROOFY, 8, true, s * (W - 0.04), z));
      }
      brass.add(cylY(0.03, 0.03, 1.85, ROOFY, 8, true, s * (W - 0.06), zs * (L - 0.2)));
    }
    // dash (end panel) with number
    const d0 = zs * (L - 0.32), d1 = zs * L;
    paint.add(rboxMM(-W, FLOOR - 0.1, Math.min(d0, d1), W, 1.9, Math.max(d0, d1), 0.08), null, MAROON);
    paint.add(boxMM(-W - 0.01, 1.84, Math.min(d0, d1) - 0.01, W + 0.01, 1.92, Math.max(d0, d1) + 0.01), null, GOLD);
    paint.add(boxMM(-W + 0.1, 1.2, zs * L - 0.012, W - 0.1, 1.23, zs * L + 0.012), null, GOLD);
    const num = uvRegion(new THREE.PlaneGeometry(0.42, 0.42), 0, 0, 0.25, 0.5);
    signs.add(num, M(0, 1.5, zs * (L + 0.03), 0, zs > 0 ? 0 : Math.PI, 0));
    // corner posts
    for (const s of [-1, 1]) paint.add(boxMM(s * W - 0.06, 1.9, zs * (L - 0.1) - 0.06, s * W + 0.06, ROOFY, zs * (L - 0.1) + 0.06), null, CREAM);
    // headlight
    const hz = zs * (L + 0.02);
    brass.add(new THREE.CylinderGeometry(0.15, 0.17, 0.18, 14).rotateX(Math.PI / 2), [0, 2.5, hz]);
    lights.add(new THREE.CircleGeometry(0.125, 16), M(0, 2.5, zs * (L + 0.135), 0, zs > 0 ? 0 : Math.PI, 0));
  }
  // grip + brake levers (front section)
  iron.add(rod(V(0.25, FLOOR, 2.7), V(0.3, 2.15, 2.95), 0.035, 6, false));
  iron.add(rod(V(-0.25, FLOOR, 3.2), V(-0.3, 1.95, 3.35), 0.035, 6, false));
  brass.add(new THREE.SphereGeometry(0.06, 8, 6), [0.3, 2.17, 2.96]);
  brass.add(new THREE.SphereGeometry(0.06, 8, 6), [-0.3, 1.97, 3.36]);
  // bell under the front roof
  brass.add(latheGeo([[0.15, 2.36], [0.13, 2.38], [0.09, 2.5], [0.05, 2.62], [0, 2.62]], 14, 40), [0, 0, 3.6]);

  // ---------------------------------------------------------------- roof + clerestory
  paint.add(boxMM(-W - 0.08, 2.72, -L - 0.08, W + 0.08, 2.82, L + 0.08), null, CREAM); // fascia
  paint.add(rboxMM(-W - 0.06, 2.8, -L - 0.06, W + 0.06, 2.96, L + 0.06, 0.06), null, ROOF);
  paint.add(rboxMM(-0.72, 2.94, -3.55, 0.72, 3.24, 3.55, 0.04), null, CREAM);
  paint.add(rboxMM(-0.82, 3.22, -3.65, 0.82, 3.32, 3.65, 0.04), null, ROOF);
  for (const s of [-1, 1]) {
    for (let z = -3.2; z <= 3.21; z += 0.55) {
      if (Math.abs(z) < 1.4) continue;
      glass.add(boxMM(s * 0.725 - 0.01, 3.0, z - 0.2, s * 0.725 + 0.01, 3.18, z + 0.2));
    }
    // route board on the clerestory side
    const sb = uvRegion(new THREE.PlaneGeometry(2.6, 0.26), 0, 0.5, 1, 0.75);
    signs.add(sb, M(s * 0.745, 3.09, 0, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0));
    // running lights along the roof edge
    for (const z of [-3.9, -1.3, 1.3, 3.9]) lights.add(boxMM(s * (W + 0.09) - 0.035, 2.74, z - 0.07, s * (W + 0.09) + 0.035, 2.8, z + 0.07));
  }
  // destination boards on both ends
  for (const zs of [-1, 1]) {
    paint.add(boxMM(-0.78, 2.96, zs * 3.56 - 0.03, 0.78, 3.3, zs * 3.56 + 0.03), null, DARK);
    const eb = uvRegion(new THREE.PlaneGeometry(1.5, 0.3), 0, 0.75, 1, 1);
    signs.add(eb, M(0, 3.13, zs * 3.615, 0, zs > 0 ? 0 : Math.PI, 0));
  }
  // blue accent line under the fascia (Muni livery detail)
  paint.add(boxMM(-W - 0.085, 2.7, -L - 0.085, W + 0.085, 2.725, L + 0.085), null, BLUE);

  B.collider(0, 0, 1.4, 4.35, CABLE_CAR.height);
  const group = B.finish({ lights: [lightMat] });
  return group;
}

/** Returns a new cable car instance (shares geometry/materials with all others). */
export function createCableCar() {
  if (!PROTO) PROTO = buildPrototype();
  const g = new THREE.Group();
  g.name = 'CableCar';
  for (const child of PROTO.children) g.add(child.clone());
  g.userData = {
    landmark: 'CableCar',
    colliders: PROTO.userData.colliders.map((c) => ({ ...c })),
    nightMaterials: PROTO.userData.nightMaterials.slice(),
    lights: PROTO.userData.lights.slice(),
  };
  return g;
}
