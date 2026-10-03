// Procedural vehicle models. The two playable robotaxis are lofted bodies in HeroCars.js;
// this module re-exports them and builds the parametric traffic vehicles: extruded side
// profiles with bevels, deformed (plan-view taper + tumblehome) into recognizable shapes.
//
// Car space: +Z forward, +X left, +Y up, origin on the ground between the axles.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ---------------------------------------------------------------------------
// Profile helpers
// ---------------------------------------------------------------------------
// Build a side profile: smooth upper outline + explicit bottom with wheel arches.
function profileWithArches(upper, { rearX, frontX, bottomY, wheelR, wheelX }) {
  const pts = [];
  // upper: list from front-bottom corner going over the top to rear-bottom corner
  const sm = catmullOpen(upper, 110);
  for (const p of sm) pts.push(p);
  const r = wheelR;
  const cy = wheelX.cy;
  const addArch = (cx) => {
    const seg = 16;
    // start at (cx - r, bottomY) go up and over to (cx + r, bottomY)
    const a0 = Math.PI - Math.asin(Math.min(1, Math.max(-1, (bottomY - cy) / r)));
    const a1 = Math.asin(Math.min(1, Math.max(-1, (bottomY - cy) / r)));
    for (let k = 0; k <= seg; k++) {
      const a = a0 + (a1 - a0) * (k / seg);
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
  };
  pts.push(new THREE.Vector2(rearX + 0.05, bottomY));
  addArch(wheelX.rear);
  addArch(wheelX.front);
  pts.push(new THREE.Vector2(frontX - 0.05, bottomY));
  return pts;
}

function catmullOpen(points, samples) {
  const pts3 = points.map(([x, y]) => new THREE.Vector3(x, y, 0));
  const curve = new THREE.CatmullRomCurve3(pts3, false, 'centripetal', 0.5);
  return curve.getSpacedPoints(samples).map((p) => new THREE.Vector2(p.x, p.y));
}

// Extrude a profile (x forward, y up) across width W, centered on X=0 in car space.
function extrudeProfile(pts2, width, { bevel = 0.06, bevelSeg = 3 } = {}) {
  const shape = new THREE.Shape(pts2);
  const depth = Math.max(0.01, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.7, bevelSegments: bevelSeg, curveSegments: 4, steps: 1,
  });
  // shape (sx, sy, sz in [−bevel, depth+bevel]) → car (x = center − sz, y = sy, z = sx)
  const pos = g.attributes.position;
  for (let k = 0; k < pos.count; k++) {
    const sx = pos.getX(k), sy = pos.getY(k), sz = pos.getZ(k);
    pos.setXYZ(k, depth / 2 - sz, sy, sx);
  }
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  return g;
}

// Plan taper + tumblehome deformation
function deform(g, { length, taperF = 0.12, taperR = 0.06, belt = 1.0, roof = 1.5, tumble = 0.14, startF = 0.5, startR = 0.6 }) {
  const pos = g.attributes.position;
  const half = length / 2;
  for (let k = 0; k < pos.count; k++) {
    let x = pos.getX(k);
    const y = pos.getY(k), z = pos.getZ(k);
    const t = z / half;
    let f = 1;
    if (t > startF) { const q = (t - startF) / (1 - startF); f *= 1 - taperF * q * q; }
    if (t < -startR) { const q = (-t - startR) / (1 - startR); f *= 1 - taperR * q * q; }
    const ty = Math.min(1, Math.max(0, (y - belt) / Math.max(0.01, roof - belt)));
    f *= 1 - tumble * ty * ty * (3 - 2 * ty);
    x *= f;
    pos.setX(k, x);
  }
  const merged = mergeVertices(g, 1e-4);
  merged.computeVertexNormals();
  return merged;
}

// ---------------------------------------------------------------------------
// Traffic tires
// ---------------------------------------------------------------------------
function tireGeometry(r, w) {
  // lathe cross-section around the axle (Y) then rotate to X axle
  const pts = [];
  const side = r * 0.62;
  pts.push(new THREE.Vector2(side * 0.9, -w / 2));
  pts.push(new THREE.Vector2(r * 0.93, -w / 2));
  pts.push(new THREE.Vector2(r * 0.99, -w * 0.38));
  pts.push(new THREE.Vector2(r, -w * 0.2));
  pts.push(new THREE.Vector2(r, w * 0.2));
  pts.push(new THREE.Vector2(r * 0.99, w * 0.38));
  pts.push(new THREE.Vector2(r * 0.93, w / 2));
  pts.push(new THREE.Vector2(side * 0.9, w / 2));
  const g = new THREE.LatheGeometry(pts, 28);
  g.rotateZ(Math.PI / 2);
  return g;
}

// Hero cars (lofted, modelled after the real vehicles) live in HeroCars.js
export { createWaymo, createCybercab } from './HeroCars.js';

// ---------------------------------------------------------------------------
// Traffic vehicles (merged into instancing-friendly parts)
// ---------------------------------------------------------------------------
export const TRAFFIC_TYPES = {
  sedan: { L: 4.7, W: 1.84, WB: 2.8, R: 0.33, hood: 0.92, belt: 0.95, roof: 1.45, nose: 0.68, tail: 0.98, cabin: [0.8, -1.35], weight: 5 },
  hatch: { L: 4.1, W: 1.78, WB: 2.6, R: 0.31, hood: 0.92, belt: 0.95, roof: 1.5, nose: 0.68, tail: 1.05, cabin: [0.6, -1.85], hatch: true, weight: 4 },
  suv: { L: 4.85, W: 1.95, WB: 2.9, R: 0.37, hood: 1.05, belt: 1.12, roof: 1.78, nose: 0.85, tail: 1.15, cabin: [0.75, -2.15], hatch: true, weight: 4 },
  pickup: { L: 5.6, W: 2.0, WB: 3.5, R: 0.39, hood: 1.15, belt: 1.18, roof: 1.88, nose: 0.95, tail: 1.1, cabin: [0.95, -0.6], bed: true, weight: 2 },
  van: { L: 5.4, W: 2.0, WB: 3.3, R: 0.36, hood: 1.05, belt: 1.2, roof: 2.45, nose: 0.85, tail: 1.2, cabin: [1.55, -2.6], box: true, weight: 2 },
  taxi: { L: 4.9, W: 1.86, WB: 2.85, R: 0.33, hood: 0.92, belt: 0.95, roof: 1.47, nose: 0.68, tail: 0.98, cabin: [0.8, -1.4], weight: 2, taxi: true },
  bus: { L: 12.2, W: 2.6, WB: 7.0, R: 0.5, hood: 1.0, belt: 1.25, roof: 3.15, nose: 1.0, tail: 1.0, cabin: [5.9, -5.95], bus: true, weight: 1 },
};

export const TRAFFIC_COLORS = ['#c0392b', '#1f3a93', '#f5f6fa', '#2d3436', '#7f8c8d', '#0a3d62', '#e1b12c', '#16a085', '#8e44ad', '#d35400', '#dfe6e9', '#1e272e', '#b33771', '#3B3B98', '#58B19F', '#f8efba', '#2C3A47'];

// Returns { paint, glass, dark, light } geometries + dims; wheels are separate (shared geometry).
export function buildTrafficGeometry(type) {
  const t = TRAFFIC_TYPES[type];
  const L = t.L, W = t.W, R = t.R;
  const fx = L / 2, rx = -L / 2;
  const wheelX = { front: t.WB / 2, rear: -t.WB / 2, cy: R };
  let upper;
  if (t.bus) {
    upper = [[fx - 0.1, 0.35], [fx, 0.6], [fx, 2.9], [fx - 0.2, 3.15], [rx + 0.2, 3.15], [rx, 2.9], [rx, 0.6], [rx + 0.1, 0.35]];
  } else if (t.box) {
    upper = [[fx - 0.1, 0.32], [fx, 0.48], [fx - 0.02, t.nose], [fx - 0.45, t.hood], [fx - 1.0, t.belt + 0.1], [fx - 1.5, t.roof - 0.1], [fx - 1.8, t.roof], [rx + 0.1, t.roof], [rx, t.roof - 0.1], [rx, 0.5], [rx + 0.1, 0.32]];
  } else {
    const cab0 = t.cabin[0], cab1 = t.cabin[1];
    upper = [[fx - 0.12, 0.3], [fx, 0.45], [fx - 0.02, t.nose], [fx - 0.25, t.nose + 0.12], [cab0 + 0.4, t.hood], [cab0, t.belt]];
    if (t.bed) upper.push([cab1, t.belt + 0.05], [rx + 0.1, t.belt + 0.02], [rx, t.belt - 0.05]);
    else if (t.hatch) upper.push([cab1, t.belt + 0.05], [rx + 0.05, t.tail]);
    else upper.push([cab1 + 0.1, t.belt + 0.02], [rx + 0.35, t.tail], [rx + 0.05, t.tail - 0.06]);
    upper.push([rx - 0.02, 0.7], [rx, 0.45], [rx + 0.12, 0.3]);
  }
  const lowerPts = profileWithArches(upper, { rearX: rx + 0.12, frontX: fx - 0.12, bottomY: 0.3, wheelR: R + 0.08, wheelX });
  let paint = deform(extrudeProfile(lowerPts, W, { bevel: t.bus ? 0.12 : 0.055, bevelSeg: 2 }), { length: L, taperF: t.bus ? 0.02 : 0.09, taperR: 0.05, belt: t.belt - 0.2, roof: t.belt + 0.1, tumble: 0.04 });
  const glassParts = [];
  const darkParts = [];
  const lightParts = [];
  if (!t.bus && !t.box) {
    const c0 = t.cabin[0], c1 = t.cabin[1];
    const cabinTopF = c0 - (t.roof - t.belt) * 0.95;
    const cabinTopR = c1 + (t.hatch || t.bed ? 0.12 : (t.roof - t.belt) * 1.05);
    const cabin = roundedPoly([[c0 + 0.05, t.belt - 0.03], [cabinTopF, t.roof], [cabinTopR, t.roof], [c1 - 0.02, t.belt - 0.03]], 0.12, 4);
    const tumble = 0.2;
    const g = deform(extrudeProfile(cabin, W * 0.88, { bevel: 0.05, bevelSeg: 2 }), { length: L, taperF: 0.03, taperR: 0.03, belt: t.belt, roof: t.roof, tumble, startF: 0.3 });
    glassParts.push(g);
    // painted roof + pillars give a real car silhouette
    const xb = W * 0.44, xr = W * 0.44 * (1 - tumble) + 0.02;
    const parts = [toNI(paint)];
    const rp = new RoundedBoxGeometry(xr * 2 + 0.06, 0.07, Math.max(0.4, cabinTopF - cabinTopR + 0.04), 2, 0.025);
    rp.translate(0, t.roof + 0.025, (cabinTopF + cabinTopR) / 2);
    parts.push(toNI(rp));
    const mid = (c0 + c1) / 2 + 0.1;
    for (const sx of [-1, 1]) {
      parts.push(beam([sx * xb, t.belt, c0], [sx * xr, t.roof, cabinTopF], 0.08));
      parts.push(beam([sx * xb, t.belt, mid], [sx * xr, t.roof, mid - 0.05], 0.11));
      parts.push(beam([sx * xb, t.belt, c1 + 0.05], [sx * xr, t.roof, cabinTopR], t.hatch ? 0.14 : 0.2));
    }
    paint = mergeGeometries(parts);
    // mirrors
    for (const sx of [-1, 1]) {
      const m = new RoundedBoxGeometry(0.18, 0.12, 0.1, 1, 0.03);
      m.translate(sx * (W / 2 + 0.06), t.belt + 0.06, c0 - 0.18);
      darkParts.push(m);
    }
  } else {
    // windows as dark glass bands on the box body
    const wh = t.bus ? 1.1 : 0.7;
    const y = t.bus ? 2.05 : t.belt + 0.5;
    const len = t.bus ? L - 1.2 : 1.1;
    const z = t.bus ? 0 : fx - 1.2;
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.04, wh, len);
      g.translate(s * (W / 2 + 0.01), y, z);
      glassParts.push(g);
    }
    const ws = new THREE.BoxGeometry(W * 0.86, t.bus ? 1.3 : 0.75, 0.05);
    ws.translate(0, t.bus ? 2.0 : t.belt + 0.5, fx - (t.bus ? 0.02 : 0.62));
    if (!t.bus) ws.rotateX(0);
    glassParts.push(ws);
  }
  // bumpers + grille (dark)
  const fb = new RoundedBoxGeometry(W * 0.92, 0.18, 0.18, 2, 0.05);
  fb.translate(0, 0.38, fx - 0.06);
  const rb = new RoundedBoxGeometry(W * 0.92, 0.18, 0.18, 2, 0.05);
  rb.translate(0, 0.4, rx + 0.06);
  darkParts.push(fb, rb);
  const grille = new THREE.BoxGeometry(W * 0.5, 0.18, 0.05);
  grille.translate(0, t.bus ? 0.8 : 0.55, fx - 0.0);
  darkParts.push(grille);
  if (t.taxi) {
    const sign = new RoundedBoxGeometry(0.8, 0.22, 0.32, 2, 0.05);
    sign.translate(0, t.roof + 0.13, -0.3);
    lightParts.push({ g: sign, c: [1.6, 1.4, 0.6] });
  }
  if (t.bed) {
    // pickup bed walls
    const tail = new THREE.BoxGeometry(W * 0.9, 0.35, 0.06);
    tail.translate(0, t.belt - 0.1, rx + 0.08);
    darkParts.push(tail);
  }
  // lights: headlights (white), taillights (red) — stored with HDR vertex colors
  for (const s of [-1, 1]) {
    const hl = new THREE.BoxGeometry(0.34, t.bus ? 0.2 : 0.12, 0.06);
    hl.translate(s * W * 0.33, t.bus ? 0.7 : t.nose - 0.06, fx - 0.03);
    lightParts.push({ g: hl, c: [2.2, 2.2, 2.0] });
    const tl = new THREE.BoxGeometry(0.3, t.bus ? 0.4 : 0.12, 0.05);
    tl.translate(s * W * 0.36, t.bus ? 0.9 : t.tail - 0.12, rx + 0.02);
    lightParts.push({ g: tl, c: [1.4, 0.05, 0.04] });
  }
  const light = mergeGeometries(lightParts.map(({ g, c }) => {
    const ng = toNI(g);
    const cols = new Float32Array(ng.attributes.position.count * 3);
    for (let k = 0; k < cols.length; k += 3) { cols[k] = c[0]; cols[k + 1] = c[1]; cols[k + 2] = c[2]; }
    ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    if (ng.attributes.uv) ng.deleteAttribute('uv');
    if (ng.attributes.normal) ng.deleteAttribute('normal');
    return ng;
  }));
  const strip = (g) => {
    const ng = toNI(g);
    if (ng.attributes.uv) ng.deleteAttribute('uv');
    if (!ng.attributes.normal) ng.computeVertexNormals();
    return ng;
  };
  return {
    paint: strip(paint),
    glass: mergeGeometries(glassParts.map(strip)),
    dark: mergeGeometries(darkParts.map(strip)),
    light,
    dims: { length: L, width: W, wheelbase: t.WB, wheelRadius: R, track: W - 0.25, height: t.roof },
    wheels: [[W / 2 - 0.12, t.WB / 2], [-(W / 2 - 0.12), t.WB / 2], [W / 2 - 0.12, -t.WB / 2], [-(W / 2 - 0.12), -t.WB / 2]],
  };
}

// Polygon with rounded corners (for crisp-but-soft cabin profiles)
function roundedPoly(pts, r, seg = 3) {
  const out = [];
  const n = pts.length;
  for (let k = 0; k < n; k++) {
    const p = pts[k], a = pts[(k + n - 1) % n], b = pts[(k + 1) % n];
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]), db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ra = Math.min(r, da * 0.45), rb = Math.min(r, db * 0.45);
    const p0 = [p[0] + (a[0] - p[0]) / da * ra, p[1] + (a[1] - p[1]) / da * ra];
    const p2 = [p[0] + (b[0] - p[0]) / db * rb, p[1] + (b[1] - p[1]) / db * rb];
    for (let s2 = 0; s2 <= seg; s2++) {
      const t = s2 / seg, it = 1 - t;
      out.push(new THREE.Vector2(it * it * p0[0] + 2 * it * t * p[0] + t * t * p2[0], it * it * p0[1] + 2 * it * t * p[1] + t * t * p2[1]));
    }
  }
  return out;
}

// Square beam between two points (pillars etc.), non-indexed position+normal
function beam(a, b, th) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const dir = B.clone().sub(A);
  const len = dir.length();
  const g = new THREE.BoxGeometry(th, th, len);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
  g.applyQuaternion(q);
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return toNI(g);
}

function toNI(g) {
  const ng = g.index ? g.toNonIndexed() : g;
  // ensure consistent attribute sets (position + normal)
  if (ng.attributes.uv) ng.deleteAttribute('uv');
  if (ng.attributes.uv1) ng.deleteAttribute('uv1');
  if (!ng.attributes.normal) ng.computeVertexNormals();
  return ng;
}

export function trafficWheelGeometry() {
  const tire = tireGeometry(1, 0.62);
  const hub = new THREE.CylinderGeometry(0.62, 0.62, 0.64, 16);
  hub.rotateZ(Math.PI / 2);
  const t1 = toNI(tire), h1 = toNI(hub);
  for (const g of [t1, h1]) if (g.attributes.uv) g.deleteAttribute('uv');
  // vertex colors: tire black, hub gray
  const paintCol = (g, c) => {
    const cols = new Float32Array(g.attributes.position.count * 3);
    for (let k = 0; k < cols.length; k += 3) { cols[k] = c; cols[k + 1] = c; cols[k + 2] = c * 1.02; }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  };
  paintCol(t1, 0.02);
  paintCol(h1, 0.35);
  return mergeGeometries([t1, h1]);
}
