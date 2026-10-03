// Pier 39 entrance — two-storey weathered-wood building (40 m along X), a tall
// gabled gateway with the big blue/white "PIER 39" sign, flags on poles and a
// colourful two-tier carousel out front. Front faces +Z. Footprint 40 x 20.

import {
  LandmarkBuilder, std, glow, boxMM, rboxMM, prismGeo, latheGeo, extrudeGeo, archShape, cylY, V, M,
  noise3, canvasTexture, fitText, makeRng,
} from './common.js';
import * as THREE from 'three';

export const PIER_39 = Object.freeze({ width: 40, depth: 20, height: 12, gatewayHeight: 16.5 });

function drawSign(ctx, w, h) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#0d4f9e';
  ctx.fillRect(10, 10, w - 20, h - 20);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 8;
  ctx.strokeRect(26, 26, w - 52, h - 52);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, 'PIER 39', w / 2, h * 0.47, w - 110, Math.round(h * 0.62), 'bold', '"Arial Black", "Helvetica Neue", Arial, sans-serif');
  ctx.fillStyle = '#ffd34d';
  fitText(ctx, 'SAN FRANCISCO', w / 2, h * 0.84, w * 0.5, Math.round(h * 0.11), 'bold', 'Arial, Helvetica, sans-serif');
}

export function createPier39() {
  const B = new LandmarkBuilder('Pier39');
  const rand = makeRng(39);
  const signTex = canvasTexture('pier39-sign', 1024, 320, drawSign);

  const woodMat = std({ name: 'p39-wood', color: 0xffffff, vertexColors: true, roughness: 0.9 });
  const roofMat = std({ name: 'p39-roof', color: 0xffffff, vertexColors: true, roughness: 0.85 });
  const winMat = glow({ name: 'p39-windows', color: 0x263038, emissive: 0xffcf8a, roughness: 0.2, metalness: 0.4 }, 1.3);
  const signMat = glow({ name: 'p39-sign', color: signTex ? 0xffffff : 0x1a5aa8, map: signTex, emissive: 0xffffff, emissiveMap: signTex, roughness: 0.5 }, 1.4);
  const paintMat = std({ name: 'p39-carousel', color: 0xffffff, vertexColors: true, roughness: 0.4, metalness: 0.1 });
  const metalMat = std({ name: 'p39-metal', color: 0xd9d4c8, roughness: 0.3, metalness: 0.9 });
  const flagMat = std({ name: 'p39-flags', color: 0xffffff, vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
  const bulbMat = glow({ name: 'p39-bulbs', color: 0xfff2d0, emissive: 0xffe2a0, roughness: 0.3 }, 3);

  const wood = B.part('wood', woodMat);
  const roof = B.part('roof', roofMat);
  const wins = B.part('windows', winMat, { castShadow: false });
  const sign = B.part('sign', signMat, { castShadow: false });
  const paint = B.part('carousel', paintMat);
  const metal = B.part('metal', metalMat);
  const flags = B.part('flags', flagMat, { castShadow: false });
  const bulbs = B.part('bulbs', bulbMat, { castShadow: false, receiveShadow: false });

  const boards = (hex) => (x, y, z, nx, ny, nz, out) => {
    out.set(hex);
    const plank = Math.abs(nx) > 0.5 ? z : x;
    const n = noise3(Math.floor(plank * 3.3) * 1.7, y * 0.15, 0.5);
    out.multiplyScalar(0.8 + 0.3 * n);
  };
  const W1 = boards(0x8f7c66), W2 = boards(0x7a6a58), TRIM = 0xe9e4d8;
  const shingles = (x, y, z, nx, ny, nz, out) => {
    out.set(0x4b4744);
    out.multiplyScalar(0.8 + 0.35 * noise3(x * 0.8, y * 3, z * 0.8));
  };

  // ---------------------------------------------------------------- main building
  const Z0 = -10, Z1 = -0.5, H1 = 8.4;
  wood.add(boxMM(-20, 0, Z0, 20, H1, Z1), null, W1);
  wood.add(boxMM(-20.2, 4.0, Z1 - 0.1, 20.2, 4.35, Z1 + 1.6), null, W2); // balcony deck
  for (let x = -19.6; x <= 19.61; x += 1.2) {
    if (Math.abs(x) < 6) continue;
    wood.add(boxMM(x - 0.05, 4.35, Z1 + 1.45, x + 0.05, 5.3, Z1 + 1.55), null, TRIM);
  }
  for (const [a, b] of [[-20.2, -6], [6, 20.2]]) {
    wood.add(boxMM(a, 5.25, Z1 + 1.42, b, 5.4, Z1 + 1.6), null, TRIM);
    for (let x = a + 0.4; x < b; x += 3.2) wood.add(boxMM(x - 0.12, 0, Z1 + 1.35, x + 0.12, 4.0, Z1 + 1.6), null, W2);
  }
  // gable roof (ridge along X)
  {
    const b = [[20.0, Z0 - 0.7], [20.0, Z1 + 0.7], [-20.0, Z1 + 0.7], [-20.0, Z0 - 0.7]];
    const zc = (Z0 + Z1) / 2;
    const t = [[20.0, zc - 0.05], [20.0, zc + 0.05], [-20.0, zc + 0.05], [-20.0, zc - 0.05]];
    roof.add(prismGeo(b, t, H1 - 0.2, 12, { capBottom: true }), null, shingles);
    // wooden gable ends (cover the roof end faces)
    for (const s of [-1, 1]) {
      const sg = s > 0 ? -1 : 1; // local x -> world z mapping for the +/-90 deg rotation
      const sh = new THREE.Shape();
      sh.moveTo(sg * (Z0 - 0.6), -0.15);
      sh.lineTo(sg * (Z1 + 0.6), -0.15);
      sh.lineTo(sg * zc, 12 - H1 + 0.1);
      sh.closePath();
      wood.add(new THREE.ShapeGeometry(sh), M(s * 20.03, H1, 0, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0), W2);
    }
    // dormers on the front slope
    for (const dx of [-14, -9.5, 9.5, 14]) {
      const zf = Z1 - 0.5;
      wood.add(boxMM(dx - 1.3, H1, zf - 2.6, dx + 1.3, 10.7, zf), null, W1);
      wins.add(boxMM(dx - 0.7, 9.0, zf, dx + 0.7, 10.3, zf + 0.05));
      const rb = [[dx + 1.55, zf - 2.7], [dx + 1.55, zf + 0.35], [dx - 1.55, zf + 0.35], [dx - 1.55, zf - 2.7]];
      const rt = [[dx + 0.05, zf - 2.7], [dx + 0.05, zf + 0.35], [dx - 0.05, zf + 0.35], [dx - 0.05, zf - 2.7]];
      roof.add(prismGeo(rb, rt, 10.6, 11.7), null, shingles);
    }
  }
  // storefronts + upper windows (front), windows on the back and ends
  for (let x = -18; x <= 18.01; x += 3.2) {
    if (Math.abs(x) < 6.5) continue;
    wins.add(boxMM(x - 1.2, 0.5, Z1, x + 1.2, 3.1, Z1 + 0.05));
    wood.add(boxMM(x - 1.35, 3.1, Z1, x + 1.35, 3.35, Z1 + 0.12), null, TRIM);
    wins.add(boxMM(x - 0.65, 5.3, Z1, x + 0.65, 7.3, Z1 + 0.05));
    wood.add(boxMM(x - 0.8, 7.3, Z1, x + 0.8, 7.5, Z1 + 0.12), null, TRIM);
    wins.add(boxMM(x - 0.65, 5.0, Z0 - 0.05, x + 0.65, 7.0, Z0));
    wins.add(boxMM(x - 0.9, 1.0, Z0 - 0.05, x + 0.9, 3.0, Z0));
  }
  for (const s of [-1, 1]) {
    for (const z of [-7.5, -3.5]) {
      wins.add(boxMM(s * 20 - 0.03, 1.2, z - 0.8, s * 20 + 0.03, 3.0, z + 0.8));
      wins.add(boxMM(s * 20 - 0.03, 5.2, z - 0.7, s * 20 + 0.03, 7.0, z + 0.7));
    }
  }
  B.collider(0, (Z0 + Z1 + 1.6) / 2, 20.2, (Z1 + 1.6 - Z0) / 2, 12);

  // ---------------------------------------------------------------- gateway with the big sign
  {
    const gz0 = -3, gz1 = 1.6, gx = 5.6, GH = 13;
    wood.add(boxMM(-gx, 0, gz0, gx, GH, gz1), null, W2);
    wood.add(boxMM(-gx - 0.25, GH - 0.3, gz0 - 0.25, gx + 0.25, GH, gz1 + 0.25), null, TRIM);
    const b = [[gx + 0.6, gz0 - 0.5], [gx + 0.6, gz1 + 0.7], [-gx - 0.6, gz1 + 0.7], [-gx - 0.6, gz0 - 0.5]];
    const t = [[0.05, gz0 - 0.5], [0.05, gz1 + 0.7], [-0.05, gz1 + 0.7], [-0.05, gz0 - 0.5]];
    roof.add(prismGeo(b, t, GH, GH + 3.5), null, shingles);
    // gable front fill
    const sh = new THREE.Shape();
    sh.moveTo(-gx, 0);
    sh.lineTo(gx, 0);
    sh.lineTo(0, 3.4);
    sh.closePath();
    wood.add(new THREE.ShapeGeometry(sh), [0, GH, gz1 + 0.02], W1);
    // entrance arch
    wins.add(extrudeGeo(archShape(5.2, 3.6, 0, 0, 12), 0.1), [0, 0, gz1 + 0.04]);
    const sur = new THREE.Shape();
    sur.moveTo(-3.3, 0);
    sur.lineTo(3.3, 0);
    sur.lineTo(3.3, 6.9);
    sur.lineTo(-3.3, 6.9);
    sur.closePath();
    sur.holes.push(archShape(5.2, 3.6, 0, 0, 12));
    wood.add(extrudeGeo(sur, 0.25, { curveSegments: 12 }), [0, 0, gz1 + 0.12], TRIM);
    // sign board (front and back)
    wood.add(rboxMM(-5.3, 7.4, gz1, 5.3, 11.4, gz1 + 0.35, 0.08), null, TRIM);
    sign.add(new THREE.PlaneGeometry(10.2, 3.2), [0, 9.4, gz1 + 0.38]);
    // ridge flags on the gateway
    for (const x of [-gx - 0.3, 0, gx + 0.3]) {
      const y0 = x === 0 ? GH + 3.5 : GH;
      metal.add(cylY(0.06, 0.05, y0, y0 + 3.2, 6, false, x, (gz0 + gz1) / 2));
    }
    B.collider(0, (gz0 + gz1 + 0.7) / 2, gx + 0.6, (gz1 + 0.7 - gz0) / 2, GH + 3.5);
  }

  // ---------------------------------------------------------------- flags on poles (left front)
  const flagColors = [
    [0xb22234, 0xffffff], [0x0d4f9e, 0xffffff], [0xffc425, 0xc8102e], [0x1f8a4c, 0xffffff],
    [0xe2582b, 0x0d4f9e], [0x6a2c91, 0xffd34d], [0xffffff, 0x0d4f9e], [0xc8102e, 0xffc425],
  ];
  const flagAt = (x, y, z, k, w = 2.2, h = 1.3) => {
    const g = new THREE.PlaneGeometry(w, h, 8, 2);
    const p = g.attributes.position;
    const colors = [];
    const [ca, cb] = flagColors[k % flagColors.length];
    const A = new THREE.Color(ca), Bc = new THREE.Color(cb);
    for (let i = 0; i < p.count; i++) {
      const u = (p.getX(i) + w / 2) / w;
      p.setZ(i, Math.sin(u * 5 + k) * 0.16 * u);
      const c = p.getY(i) > -h * 0.05 && p.getY(i) < h * 0.2 ? Bc : A;
      colors.push(c);
    }
    g.computeVertexNormals();
    g.translate(w / 2 + 0.05, 0, 0);
    let i = 0;
    flags.add(g, [x, y, z], (px, py, pz, nx, ny, nz, out) => out.copy(colors[i++]));
  };
  for (let k = 0; k < 6; k++) {
    const x = -18.5 + k * 2.4, z = 9.2;
    metal.add(cylY(0.07, 0.06, 0, 9, 6, false, x, z));
    metal.add(new THREE.SphereGeometry(0.12, 8, 6), [x, 9.05, z]);
    flagAt(x, 8.2, z, k);
    B.collider(x, z, 0.15, 0.15, 9);
  }
  for (const [x, k] of [[-5.9, 6], [0, 7], [5.9, 2]]) {
    const y = x === 0 ? 16.5 + 3.2 : 13 + 3.2;
    flagAt(x, y - 0.75, -0.7, k, 1.6, 0.95);
  }

  // ---------------------------------------------------------------- carousel
  {
    const CXc = 12.4, CZc = 5.4, R = 4.2;
    const C = (geo, xf, col) => paint.add(geo, xf, col);
    C(latheGeo([[R + 0.3, 0], [R + 0.3, 0.45], [0, 0.45]], 32, 35), [CXc, 0, CZc], 0x6b3d2a);
    C(latheGeo([[R + 0.35, 0.05], [R + 0.35, 0.2], [R + 0.3, 0.2]], 32, 35), [CXc, 0, CZc], 0xffc425);
    C(cylY(0.75, 0.75, 0.45, 7.2, 16, false, CXc, CZc), null, 0xc8102e);
    const stripes = 16;
    const prof1 = [[R + 0.35, 5.4], [R + 0.35, 6.0], [R * 0.75, 6.8], [R * 0.3, 7.45], [0, 7.6]];
    const prof2 = [[2.0, 7.4], [2.0, 7.85], [1.4, 8.6], [0.4, 9.15], [0, 9.2]];
    for (let i = 0; i < stripes; i++) {
      const phi0 = (i / stripes) * Math.PI * 2, dphi = (Math.PI * 2) / stripes;
      const col = i % 2 ? 0xffffff : 0xd8262e;
      C(latheGeo(prof1, 3, 35, phi0, dphi), [CXc, 0, CZc], col);
      C(latheGeo(prof2, 2, 35, phi0, dphi), [CXc, 0, CZc], i % 2 ? 0xffd34d : 0x1f62b8);
      // scalloped valance
      const a = phi0 + dphi / 2;
      C(latheGeo([[R + 0.4, 5.0], [R + 0.4, 5.45]], 2, 35, phi0, dphi), [CXc, 0, CZc], i % 2 ? 0xffc425 : 0x1f62b8);
      // light bulbs on the rim
      bulbs.add(new THREE.SphereGeometry(0.1, 6, 4), [CXc + (R + 0.45) * Math.sin(a), 5.6, CZc + (R + 0.45) * Math.cos(a)]);
      bulbs.add(new THREE.SphereGeometry(0.09, 6, 4), [CXc + 2.05 * Math.sin(a), 7.5, CZc + 2.05 * Math.cos(a)]);
    }
    C(latheGeo([[0.25, 9.15], [0.25, 9.6], [0.45, 9.9], [0, 10.4]], 10, 35), [CXc, 0, CZc], 0xffc425);
    C(latheGeo([[0, 5.38], [R + 0.35, 5.38]], 24, 35), [CXc, 0, CZc], 0xf3e6c8);
    C(latheGeo([[0, 7.38], [2.0, 7.38]], 16, 35), [CXc, 0, CZc], 0xf3e6c8);
    // poles + horses
    const horseCols = [0xffffff, 0x2a2a2a, 0xc98b4b, 0xf2d2a2, 0x9e9e9e, 0x6b3d2a];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      for (const [r, dy] of [[R - 0.6, 0], [R - 1.9, 0.5]]) {
        const x = CXc + r * Math.sin(a + dy), z = CZc + r * Math.cos(a + dy);
        metal.add(cylY(0.035, 0.035, 0.45, 5.4, 6, true, x, z));
        const hy = 1.3 + ((i + (dy ? 1 : 0)) % 3) * 0.35;
        const col = horseCols[(i + (dy ? 3 : 0)) % horseCols.length];
        const yaw = a + dy + Math.PI / 2;
        C(rboxMM(-0.18, -0.25, -0.6, 0.18, 0.25, 0.6, 0.12), M(x, hy, z, 0, yaw, 0), col);
        C(rboxMM(-0.12, -0.12, -0.25, 0.12, 0.42, 0.05, 0.08), M(x, hy, z, 0, yaw, 0).multiply(M(0, 0.25, 0.55, -0.5, 0, 0)), col);
        C(boxMM(-0.2, 0.22, -0.25, 0.2, 0.3, 0.25), M(x, hy, z, 0, yaw, 0), 0xc8102e);
        for (const [lx, lz] of [[-0.12, -0.45], [0.12, -0.45], [-0.12, 0.45], [0.12, 0.45]]) {
          C(boxMM(lx - 0.04, -0.6, lz - 0.04, lx + 0.04, -0.2, lz + 0.04), M(x, hy, z, 0, yaw, lz > 0 ? -0.4 : 0.4), col);
        }
      }
    }
    // mirrored centre column panels
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      metal.add(boxMM(-0.25, 1.2, -0.03, 0.25, 4.6, 0.03), M(CXc + 0.78 * Math.sin(a), 0, CZc + 0.78 * Math.cos(a), 0, a, 0));
    }
    B.collider(CXc, CZc, R + 0.4, R + 0.4, 10.4);
  }

  return B.finish();
}
