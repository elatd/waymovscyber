// Fisherman's Wharf sign — ship's-wheel ring (~7 m) with "FISHERMAN'S WHARF ·
// SAN FRANCISCO" lettering around it and a red-orange crab in the middle, on a
// single post. Double-sided (front +Z, back -Z). Total height ~9 m.

import {
  LandmarkBuilder, std, glow, boxMM, cylY, rod, latheGeo, V, M, noise3, canvasTexture,
} from './common.js';
import * as THREE from 'three';

export const WHARF_SIGN = Object.freeze({ footprint: 2, height: 9.1, ringDiameter: 7 });

const CY = 5.25; // wheel centre height
const R_IN = 2.2, R_OUT = 3.3, R_RIM = 3.42;

function arcText(ctx, text, cx, cy, r, top, spacing = 0) {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0);
  let a = -total / r / 2;
  chars.forEach((c, i) => {
    const mid = a + widths[i] / 2 / r;
    ctx.save();
    if (top) {
      ctx.translate(cx + r * Math.sin(mid), cy - r * Math.cos(mid));
      ctx.rotate(mid);
    } else {
      ctx.translate(cx + r * Math.sin(mid), cy + r * Math.cos(mid));
      ctx.rotate(-mid);
    }
    ctx.fillText(c, 0, 0);
    ctx.restore();
    a += widths[i] / r;
  });
}

function drawRing(ctx, w, h) {
  const cx = w / 2, cy = h / 2, R = w / 2;
  ctx.fillStyle = '#0f2f5c';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fbf7ec';
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.985, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#0f2f5c';
  ctx.lineWidth = R * 0.02;
  for (const rr of [0.95, (R_IN / R_OUT) * 1.04]) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  const rText = R * ((R_IN / R_OUT + 0.95) / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#0f2f5c';
  ctx.font = `bold ${Math.round(R * 0.17)}px "Arial Black", Arial, Helvetica, sans-serif`;
  arcText(ctx, "FISHERMAN'S WHARF", cx, cy, rText, true, R * 0.012);
  ctx.fillStyle = '#c8321f';
  ctx.font = `bold ${Math.round(R * 0.15)}px "Arial Black", Arial, Helvetica, sans-serif`;
  arcText(ctx, 'SAN FRANCISCO', cx, cy, rText, false, R * 0.02);
  ctx.fillStyle = '#c8321f';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + s * rText, cy, R * 0.035, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function createWharfSign() {
  const B = new LandmarkBuilder('WharfSign');
  const ringTex = canvasTexture('wharf-ring', 1024, 1024, drawRing);

  const woodMat = std({ name: 'ws-wood', color: 0xffffff, vertexColors: true, roughness: 0.42, metalness: 0.05 });
  const paintMat = std({ name: 'ws-paint', color: 0xffffff, vertexColors: true, roughness: 0.45 });
  const textMat = glow({ name: 'ws-text', color: ringTex ? 0xffffff : 0xf6f1e4, map: ringTex, emissive: 0xffffff, emissiveMap: ringTex, roughness: 0.5 }, 0.9);
  const crabMat = std({ name: 'ws-crab', color: 0xffffff, vertexColors: true, roughness: 0.3, metalness: 0.05 });
  const metalMat = std({ name: 'ws-metal', color: 0x1f3a33, roughness: 0.45, metalness: 0.6 });
  const wood = B.part('wood', woodMat);
  const paint = B.part('paint', paintMat);
  const text = B.part('text', textMat, { castShadow: false });
  const crab = B.part('crab', crabMat);
  const metal = B.part('metal', metalMat);

  const varnish = (x, y, z, nx, ny, nz, out) => {
    out.set(0x8a5a2e);
    out.multiplyScalar(0.85 + 0.3 * noise3(x * 3, y * 3, z * 3));
  };

  // ---------------------------------------------------------------- post
  metal.add(boxMM(-0.55, 0, -0.55, 0.55, 0.12, 0.55));
  metal.add(cylY(0.2, 0.23, 0.12, CY - R_RIM + 0.05, 12, false, 0, 0));
  metal.add(new THREE.SphereGeometry(0.26, 12, 8), [0, CY - R_RIM, 0]);
  for (const s of [-1, 1]) {
    const a = (40 * Math.PI) / 180;
    metal.add(rod(V(0, 1.15, 0), V(s * R_RIM * Math.sin(a), CY - R_RIM * Math.cos(a), 0), 0.09, 8, false));
  }
  B.collider(0, 0, 0.55, 0.55, 9.1);

  // ---------------------------------------------------------------- ring body + rim + spokes/handles
  {
    // ring body (annulus with depth): lathe around Z
    const body = latheGeo([[R_IN - 0.02, -0.16], [R_OUT + 0.02, -0.16], [R_OUT + 0.02, 0.16], [R_IN - 0.02, 0.16], [R_IN - 0.02, -0.1599]], 64, 30);
    paint.add(body, M(0, CY, 0, Math.PI / 2, 0, 0), 0x0f2f5c);
    // wooden rim (torus) + handles like a ship's wheel
    wood.add(new THREE.TorusGeometry(R_RIM, 0.14, 8, 64), [0, CY, 0], varnish);
    wood.add(new THREE.TorusGeometry(R_IN - 0.06, 0.09, 6, 48), [0, CY, 0], varnish);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const dx = Math.cos(a), dy = Math.sin(a);
      wood.add(latheGeo([[0.11, 0], [0.13, 0.25], [0.09, 0.42], [0.13, 0.58], [0.06, 0.66], [0, 0.68]], 10, 40),
        M(dx * (R_RIM + 0.08), CY + dy * (R_RIM + 0.08), 0, 0, 0, a - Math.PI / 2), varnish);
    }
    // gold-ish bolts on the rim
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      for (const sz of [-1, 1]) metal.add(new THREE.SphereGeometry(0.05, 6, 4), [Math.cos(a) * (R_OUT - 0.06), CY + Math.sin(a) * (R_OUT - 0.06), sz * 0.17]);
    }
  }
  // lettering faces (front and back)
  for (const sz of [-1, 1]) {
    const g = new THREE.RingGeometry(R_IN, R_OUT, 64, 1);
    text.add(g, M(0, CY, sz * 0.185, 0, sz > 0 ? 0 : Math.PI, 0));
  }
  // centre disc
  paint.add(new THREE.CylinderGeometry(R_IN, R_IN, 0.24, 48).rotateX(Math.PI / 2), [0, CY, 0], (x, y, z, nx, ny, nz, out) => {
    out.set(0x6fb8e6);
    const r = Math.hypot(x, y - CY) / R_IN;
    out.multiplyScalar(1.08 - 0.25 * r * r);
  });

  // ---------------------------------------------------------------- crab (one on each face)
  const ORANGE = 0xe8502a, DEEP = 0xc5381b, WHITE = 0xffffff, BLACK = 0x111111;
  for (const sz of [-1, 1]) {
    const base = M(0, CY - 0.1, sz * 0.12, 0, sz > 0 ? 0 : Math.PI, 0);
    const C = (geo, local, col) => crab.add(geo, base.clone().multiply(local), col);
    const shell = (x, y, z, nx, ny, nz, out) => {
      out.set(ORANGE);
      out.multiplyScalar(0.92 + 0.18 * noise3(x * 4, y * 4, z * 4));
    };
    // carapace
    C(new THREE.SphereGeometry(1, 20, 12), M(0, 0, 0.18, 0, 0, 0, 1.05, 0.72, 0.36), shell);
    C(new THREE.SphereGeometry(1, 12, 8), M(0, -0.12, 0.42, 0, 0, 0, 0.62, 0.4, 0.14), DEEP);
    // legs: 4 per side, two segments each
    for (const s of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const a = -0.55 + k * 0.32;
        const p0 = V(s * 0.85 * Math.cos(a), 0.62 * Math.sin(a) - 0.05, 0.18);
        const p1 = V(s * (1.45 + 0.1 * k) * Math.cos(a - 0.25), 0.95 * Math.sin(a) + 0.18, 0.2);
        const p2 = V(s * (1.65 + 0.08 * k) * Math.cos(a - 0.85), 0.95 * Math.sin(a) - 0.42, 0.18);
        C(rodGeo(p0, p1, 0.085), new THREE.Matrix4(), ORANGE);
        C(rodGeo(p1, p2, 0.065, 0.03), new THREE.Matrix4(), ORANGE);
        C(new THREE.SphereGeometry(0.09, 6, 4), M(p1.x, p1.y, p1.z), DEEP);
      }
      // claw arm + pincer
      const q0 = V(s * 0.75, 0.42, 0.22), q1 = V(s * 1.15, 1.0, 0.24), q2 = V(s * 0.85, 1.45, 0.26);
      C(rodGeo(q0, q1, 0.12), new THREE.Matrix4(), ORANGE);
      C(rodGeo(q1, q2, 0.12), new THREE.Matrix4(), ORANGE);
      C(new THREE.SphereGeometry(1, 12, 8), M(q2.x + s * 0.02, q2.y + 0.22, 0.26, 0, 0, s * 0.5, 0.3, 0.42, 0.2), ORANGE);
      C(new THREE.SphereGeometry(1, 10, 6), M(q2.x - s * 0.18, q2.y + 0.52, 0.26, 0, 0, s * 0.9, 0.09, 0.26, 0.1), DEEP);
      C(new THREE.SphereGeometry(1, 10, 6), M(q2.x + s * 0.1, q2.y + 0.58, 0.26, 0, 0, s * 0.2, 0.08, 0.22, 0.09), DEEP);
      // eye stalks
      const e0 = V(s * 0.2, 0.55, 0.3), e1 = V(s * 0.26, 0.85, 0.34);
      C(rodGeo(e0, e1, 0.045), new THREE.Matrix4(), ORANGE);
      C(new THREE.SphereGeometry(0.11, 10, 8), M(e1.x, e1.y + 0.05, e1.z), WHITE);
      C(new THREE.SphereGeometry(0.055, 8, 6), M(e1.x, e1.y + 0.08, e1.z + 0.08), BLACK);
    }
    // smile
    C(new THREE.TorusGeometry(0.22, 0.03, 4, 12, Math.PI), M(0, 0.05, 0.53, 0, 0, Math.PI), DEEP);
  }

  return B.finish();
}

function rodGeo(a, b, r0, r1 = r0) {
  return rod(a, b, r0, 8, false, r1);
}
