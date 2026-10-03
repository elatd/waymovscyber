// The two playable robotaxis, modelled as lofted bodies after the real cars.
//
// WAYMO — Jaguar I-PACE (4.68 × 1.90 × 1.57 m, 2.99 m wheelbase) with the 5th-gen Waymo
// Driver: the "top hat" roof module (tapered base with camera windows + lidar tower),
// perimeter lidar pods on the front fenders and rear corners, side sensor pods, bumper
// lidar. Cab-forward profile, very raked windshield, black glass roof and pillars with the
// white C-pillar, big hex grille, hood air vent, slim J-blade lights, Kamm tail + spoiler.
//
// TESLA CYBERCAB — two-seat fastback (≈4.36 × 1.96 × 1.40 m, 2.8 m wheelbase, big 0.74 m
// wheels): blunt nose with a DRL line and slim wrap lamps, wraparound windshield, body-colour
// roof, long door glass plus a teardrop rear quarter glass, crisp haunch crease, no mirrors,
// no rear window, red bar under the tail lip, chunky black rear bumper and sills, flat
// champagne aero covers, satin champagne-gold paint.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { curve, buildLoftBody, sidePatch, sideX, greenhouseMaterial, sanitize } from './LoftBody.js';


// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
function heroMaterials({ paint, metallic = false }) {
  const m = {};
  m.paint = new THREE.MeshPhysicalMaterial({
    color: paint, metalness: metallic ? 0.78 : 0.0, roughness: metallic ? 0.26 : 0.16,
    clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 1.3,
    sheen: metallic ? 0 : 0.35, sheenColor: new THREE.Color('#e4ecff'), sheenRoughness: 0.4,
  });
  m.glass = new THREE.MeshPhysicalMaterial({ color: '#080b10', metalness: 0.15, roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0.01, envMapIntensity: 1.9 });
  m.gloss = new THREE.MeshPhysicalMaterial({ color: '#0b0c0f', metalness: 0.25, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.2 });
  m.plastic = new THREE.MeshStandardMaterial({ color: '#16171a', roughness: 0.72, metalness: 0.05 });
  m.chrome = new THREE.MeshStandardMaterial({ color: '#eef2f6', metalness: 1, roughness: 0.07 });
  m.lens = new THREE.MeshPhysicalMaterial({ color: '#0e1116', metalness: 0.4, roughness: 0.04, clearcoat: 1, envMapIntensity: 1.8 });
  m.head = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#f2f7ff', emissiveIntensity: 2.6, roughness: 0.25 });
  m.tail = new THREE.MeshStandardMaterial({ color: '#4a0000', emissive: '#ff1a1a', emissiveIntensity: 1.4, roughness: 0.3 });
  m.tire = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.92 });
  m.rim = new THREE.MeshStandardMaterial({ color: '#4f545b', metalness: 0.88, roughness: 0.3, envMapIntensity: 1.2 });
  m.brake = new THREE.MeshStandardMaterial({ color: '#80858c', metalness: 0.8, roughness: 0.42 });
  m.caliper = new THREE.MeshStandardMaterial({ color: '#3a3e44', metalness: 0.5, roughness: 0.45 });
  m.liner = new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.95, side: THREE.DoubleSide });
  return m;
}

// ---------------------------------------------------------------------------
// Wheels
// ---------------------------------------------------------------------------
function tireGeometry(r, w) {
  // squarer sidewall with a slight bulge, rounded shoulders
  const side = r * 0.66;
  const pts = [
    [side * 0.95, -w / 2], [r * 0.8, -w * 0.53], [r * 0.93, -w * 0.5], [r * 0.985, -w * 0.42],
    [r, -w * 0.3], [r, w * 0.3], [r * 0.985, w * 0.42], [r * 0.93, w * 0.5], [r * 0.8, w * 0.53], [side * 0.95, w / 2],
  ].map(([a, b]) => new THREE.Vector2(a, b));
  const g = new THREE.LatheGeometry(pts, 40);
  g.rotateZ(Math.PI / 2);
  return g;
}

function ni(g) {
  const n = g.index ? g.toNonIndexed() : g;
  if (n.attributes.uv) n.deleteAttribute('uv');
  if (!n.attributes.normal) n.computeVertexNormals();
  return n;
}

// Waymo I-PACE style 5 split-spoke 20" wheel
function splitSpokeRim(r, w) {
  const rr = r * 0.69;
  const parts = [];
  const barrel = new THREE.CylinderGeometry(rr, rr, w * 0.82, 32, 1, true);
  barrel.rotateZ(Math.PI / 2);
  parts.push(ni(barrel));
  const lip = new THREE.TorusGeometry(rr * 0.985, 0.022, 8, 48);
  lip.rotateY(Math.PI / 2);
  lip.translate(w * 0.4, 0, 0);
  parts.push(ni(lip));
  const hub = new THREE.CylinderGeometry(rr * 0.24, rr * 0.28, 0.07, 24);
  hub.rotateZ(Math.PI / 2);
  hub.translate(w * 0.34, 0, 0);
  parts.push(ni(hub));
  for (let k = 0; k < 5; k++) {
    for (const s of [-1, 1]) {
      // tapered spoke from hub to rim, dished inward toward the hub
      const spoke = new THREE.BufferGeometry();
      const len = rr * 0.74, w0 = 0.055, w1 = 0.032, th = 0.045;
      const v = [];
      const quad = (a, b, c, d) => v.push(...a, ...b, ...c, ...a, ...c, ...d);
      const P = (x, y, z) => [x, y, z];
      const r0 = rr * 0.24, r1 = r0 + len;
      const dish = -0.05;
      const A = P(0, r0, -w0), B = P(0, r0, w0), C = P(dish, r1, w1), D = P(dish, r1, -w1);
      const A2 = P(-th, r0, -w0), B2 = P(-th, r0, w0), C2 = P(dish - th, r1, w1), D2 = P(dish - th, r1, -w1);
      quad(A, B, C, D);
      quad(A2, D2, C2, B2);
      quad(A, D, D2, A2);
      quad(B, B2, C2, C);
      spoke.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      spoke.computeVertexNormals();
      spoke.rotateX(((k / 5) * Math.PI * 2) + s * 0.13);
      spoke.translate(w * 0.37, 0, 0);
      parts.push(spoke);
    }
  }
  return mergeGeometries(parts);
}

// Cybercab flush aero cover: flat centre disc, conical outer ring over the sidewall, small domed hub
function aeroRim(r, w) {
  const parts = [];
  const rr = r * 0.69;
  const barrel = new THREE.CylinderGeometry(rr, rr, w * 0.8, 32, 1, true);
  barrel.rotateZ(Math.PI / 2);
  parts.push(ni(barrel));
  const f = w * 0.5 - 0.004;
  const prof = [
    [0, f + 0.017], [0.018, f + 0.015], [0.032, f + 0.009], [0.04, f + 0.002], [0.048, f],
    [r * 0.69, f], [r * 0.7, f - 0.007], [r * 0.715, f - 0.007], [r * 0.72, f + 0.004], [r * 0.74, f + 0.004],
    [r * 0.82, f - 0.01], [r * 0.88, f - 0.026], [r * 0.9, f - 0.045],
  ].map(([a, b]) => new THREE.Vector2(a, b));
  const disc = new THREE.LatheGeometry(prof, 64);
  disc.rotateZ(-Math.PI / 2);
  parts.push(ni(disc));
  return mergeGeometries(parts);
}

// Waymo I-PACE gloss-black 15-spoke turbine wheel
function turbineRim(r, w) {
  const rr = r * 0.69;
  const parts = [];
  const barrel = new THREE.CylinderGeometry(rr, rr, w * 0.82, 32, 1, true);
  barrel.rotateZ(Math.PI / 2);
  parts.push(ni(barrel));
  const lip = new THREE.TorusGeometry(rr * 0.985, 0.016, 8, 48);
  lip.rotateY(Math.PI / 2);
  lip.translate(w * 0.4, 0, 0);
  parts.push(ni(lip));
  const hub = new THREE.CylinderGeometry(rr * 0.2, rr * 0.24, 0.06, 24);
  hub.rotateZ(Math.PI / 2);
  hub.translate(w * 0.35, 0, 0);
  parts.push(ni(hub));
  const n = 15;
  for (let k = 0; k < n; k++) {
    // thin swept spoke from hub to rim
    const g = new THREE.BufferGeometry();
    const v = [];
    const quad = (a, b, c, d) => v.push(...a, ...b, ...c, ...a, ...c, ...d);
    const r0 = rr * 0.2, r1 = rr * 0.97, th = 0.03, sweep = 0.22;
    const A = [0, r0, -0.018], B = [0, r0, 0.018];
    const C = [-0.04, r1 * Math.cos(sweep), r1 * Math.sin(sweep) + 0.012], D = [-0.04, r1 * Math.cos(sweep), r1 * Math.sin(sweep) - 0.012];
    const A2 = [-th, ...A.slice(1)], B2 = [-th, ...B.slice(1)], C2 = [-0.04 - th, ...C.slice(1)], D2 = [-0.04 - th, ...D.slice(1)];
    quad(A, B, C, D);
    quad(A2, D2, C2, B2);
    quad(A, D, D2, A2);
    quad(B, B2, C2, C);
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    g.rotateX((k / n) * Math.PI * 2);
    g.translate(w * 0.36, 0, 0);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

function buildWheels(root, mats, { R, W, wb, track, style }) {
  const wheels = [];
  const tireG = tireGeometry(R, W);
  const rimG = style === 'aero' ? aeroRim(R, W) : style === 'turbine' ? turbineRim(R, W) : splitSpokeRim(R, W);
  const capG = mats.centreCap ? new THREE.CylinderGeometry(R * 0.075, R * 0.08, 0.02, 20).rotateZ(Math.PI / 2).translate(W * 0.38, 0, 0) : null;
  for (const [z, s, front] of [[wb / 2, 1, true], [wb / 2, -1, true], [-wb / 2, 1, false], [-wb / 2, -1, false]]) {
    const pivot = new THREE.Group();
    const spin = new THREE.Group();
    pivot.add(spin);
    const tire = new THREE.Mesh(tireG, mats.tire);
    tire.castShadow = true;
    const rim = new THREE.Mesh(rimG, mats.rim);
    if (s < 0) rim.scale.x = -1;
    spin.add(tire, rim);
    if (capG) {
      const cap = new THREE.Mesh(capG, mats.centreCap);
      if (s < 0) cap.scale.x = -1;
      spin.add(cap);
    }
    if (style !== 'aero') {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.55, R * 0.55, 0.03, 28).rotateZ(Math.PI / 2), mats.brake);
      disc.position.x = s * W * 0.08;
      pivot.add(disc);
      const cal = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.16, 0.12, 2, 0.022), mats.caliper);
      cal.position.set(s * W * 0.02, R * 0.3, -R * 0.24);
      cal.rotation.x = 0.6;
      pivot.add(cal);
    }
    pivot.position.set(s * track / 2, R, z);
    root.add(pivot);
    wheels.push({ pivot, spin, radius: R, front, side: s });
  }
  return wheels;
}

// Black wheel-well liners so you never see through the arches
function archLiners(group, mats, { R, wb, innerX, outerX }) {
  for (const z of [wb / 2, -wb / 2]) {
    const g = new THREE.CylinderGeometry(R + 0.06, R + 0.06, outerX - innerX + 0.02, 24, 1, true, 0, Math.PI); // top half after rotation
    g.rotateZ(Math.PI / 2);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(g, mats.liner);
      m.position.set(s * (innerX + outerX) / 2, R, z);
      group.add(m);
    }
  }
}

// ---------------------------------------------------------------------------
// Canvas decals
// ---------------------------------------------------------------------------
// fonts: web fonts the drawing uses; the canvas is redrawn once they finish loading
function canvasTex(w, h, draw, fonts = []) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (fonts.length && document.fonts) {
    const redraw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      draw(ctx, w, h);
      t.needsUpdate = true;
    };
    Promise.all(fonts.map((f) => document.fonts.load(f).catch(() => null))).then(redraw);
    document.fonts.addEventListener('loadingdone', redraw);
  }
  return t;
}

function decalMat(tex, opts = {}) {
  return new THREE.MeshPhysicalMaterial({
    map: tex, transparent: true, depthWrite: false, roughness: opts.roughness ?? 0.2, metalness: 0,
    clearcoat: opts.clearcoat ?? 1, clearcoatRoughness: 0.04, specularIntensity: opts.specular ?? 1,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: opts.side ?? THREE.FrontSide,
  });
}

// Decal conformed to a body's end face (dir +1 nose, -1 tail) by ray probing; it reads
// left-to-right for someone looking at that end of the car.
function faceDecal(mesh, tex, { dir, x0, x1, y0, y1, nx = 18, ny = 4, off = 0.0035, matte = false }) {
  mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= ny; j++) {
    const y = y0 + ((y1 - y0) * j) / ny;
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx;
      ray.set(new THREE.Vector3(x, y, dir * 8), new THREE.Vector3(0, 0, -dir));
      const h = ray.intersectObject(mesh, false)[0];
      const p = h ? h.point.add(h.face.normal.multiplyScalar(off)) : new THREE.Vector3(x, y, 0);
      pos.push(p.x, p.y, p.z);
      uv.push(dir < 0 ? 1 - i / nx : i / nx, j / ny);
    }
  }
  const row = nx + 1;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * row + i, b = a + 1, c = a + row + 1, d = a + row;
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // matte = satin vinyl that does not mirror the sky over its colour
  const mat = decalMat(tex, matte ? { roughness: 0.6, clearcoat: 0, specular: 0.35, side: THREE.DoubleSide } : { roughness: 0.3, side: THREE.DoubleSide });
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 2;
  return m;
}

// Angular monoline capitals in the style of Tesla's Cyber wordmarks: chamfered corners,
// stencil gaps on K and R, wide tracking. Glyphs live on a unit cap height (y up).
const CYBER_GLYPHS = (() => {
  const W = 0.74, k = 0.2;
  return {
    A: { w: W, p: [[[0, 0], [0, 1 - k], [k, 1], [W - k, 1], [W, 1 - k], [W, 0]], [[0, 0.44], [W, 0.44]]] },
    C: { w: W, p: [[[W, 1], [k, 1], [0, 1 - k], [0, k], [k, 0], [W, 0]]] },
    D: { w: W, closed: true, p: [[[0, 0], [0, 1], [W - k, 1], [W, 1 - k], [W, k], [W - k, 0], [0, 0]]] },
    F: { w: W * 0.9, p: [[[0, 0], [0, 1 - k], [k, 1], [W * 0.9, 1]], [[0, 0.5], [W * 0.72, 0.5]]] },
    I: { w: 0, p: [[[0, 0], [0, 1]]] },
    K: { w: W, p: [[[0, 0], [0, 1]], [[W, 1], [0.24, 0.5], [W, 0]]] },
    L: { w: W * 0.86, p: [[[0, 1], [0, k], [k, 0], [W * 0.86, 0]]] },
    R: { w: W, p: [[[0, 0], [0, 1], [W - k, 1], [W, 1 - k], [W, 0.62], [W - k, 0.44], [0, 0.44]], [[W * 0.46, 0.3], [W, 0]]] },
    U: { w: W, p: [[[0, 1], [0, k], [k, 0], [W - k, 0], [W, k], [W, 1]]] },
    ' ': { w: 0.34, p: [] },
  };
})();
function drawCyberText(ctx, text, cx, baseline, capH, maxW, color) {
  const t = 0.13, gap = 0.36;
  const glyphs = [...text.toUpperCase()].map((ch) => CYBER_GLYPHS[ch] || CYBER_GLYPHS[' ']);
  let total = t;
  glyphs.forEach((g, i) => { total += g.w + (i < glyphs.length - 1 ? gap : 0); });
  const s = Math.min(capH, maxW / total);
  let x = cx - (total * s) / 2 + (t * s) / 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = t * s;
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 2.2;
  ctx.lineCap = 'butt';
  for (const g of glyphs) {
    for (const path of g.p) {
      ctx.beginPath();
      path.forEach(([gx, gy], i) => (i ? ctx.lineTo(x + gx * s, baseline - gy * s) : ctx.moveTo(x + gx * s, baseline - gy * s)));
      if (g.closed) ctx.closePath();
      ctx.stroke();
    }
    x += (g.w + gap) * s;
  }
  ctx.restore();
}

// Flat strip of height h centred on a path (lamp lenses, light bars, trim lines)
function ribbon(path, h) {
  const pos = [], idx = [];
  path.forEach((p) => { pos.push(p.x, p.y - h / 2, p.z, p.x, p.y + h / 2, p.z); });
  for (let k = 0; k < path.length - 1; k++) {
    const a = k * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Path across an end face (cap with bulge) then wrapping round the corner onto the side
function wrapPath(profile, { zEnd, dir, bulge, capHalf, y, x0, x1, sideZs, off = 0.004 }) {
  const pts = [];
  for (let k = 0; k <= 12; k++) {
    const x = x0 + ((x1 - x0) * k) / 12;
    const t = Math.min(1, x / capHalf);
    pts.push(new THREE.Vector3(x, y, zEnd + dir * (bulge * (1 - t * t) + off)));
  }
  for (const z of sideZs) {
    const sx = sideX(profile, z, y);
    if (sx !== null) pts.push(new THREE.Vector3(sx + off, y, z));
  }
  return pts;
}
const mirrorX = (pts) => pts.map((p) => new THREE.Vector3(-p.x, p.y, p.z));

// ---------------------------------------------------------------------------
// WAYMO (Jaguar I-PACE)
// ---------------------------------------------------------------------------
export function createWaymo() {
  const R = 0.38, WB = 2.99, TRACK = 1.64, TW = 0.255;
  const zMax = 2.34, zMin = -2.34;
  const mats = heroMaterials({ paint: '#f5f7f9' });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const top = curve([
    [-2.34, 1.0], [-2.3, 1.08], [-2.22, 1.13], [-2.08, 1.175], [-1.98, 1.215], [-1.6, 1.375], [-1.32, 1.462], [-0.9, 1.532],
    [-0.4, 1.562], [0.0, 1.538], [0.25, 1.47], [0.7, 1.225], [1.18, 0.965], [1.5, 0.928], [1.9, 0.868], [2.15, 0.822],
    [2.26, 0.795], [2.31, 0.77], [2.34, 0.74],
  ]);
  const bottom = curve([[-2.34, 0.36], [-2.29, 0.29], [-2.15, 0.225], [-1.9, 0.2], [0, 0.185], [1.9, 0.2], [2.15, 0.225], [2.29, 0.27], [2.34, 0.3]]);
  const belt = curve([
    [-2.34, 0.93], [-2.25, 0.99], [-2.0, 1.035], [-1.6, 1.04], [-1.0, 1.005], [0.0, 0.978], [0.9, 0.958], [1.18, 0.94],
    [1.5, 0.89], [1.9, 0.83], [2.2, 0.765], [2.34, 0.7],
  ]);
  const halfW = curve([
    [-2.34, 0.7], [-2.3, 0.8], [-2.2, 0.885], [-2.0, 0.928], [-1.6, 0.947], [-1.2, 0.94], [-0.5, 0.926], [0.5, 0.926],
    [1.2, 0.937], [1.6, 0.946], [2.0, 0.926], [2.2, 0.88], [2.3, 0.8], [2.34, 0.7],
  ]);
  const topW = curve([
    [-2.34, 0.56], [-2.2, 0.62], [-2.0, 0.64], [-1.6, 0.6], [-1.0, 0.585], [0, 0.585], [0.6, 0.605], [1.18, 0.7],
    [1.6, 0.725], [2.0, 0.7], [2.25, 0.63], [2.34, 0.56],
  ]);
  const arches = [WB / 2, -WB / 2];
  const ra = R + 0.05;
  const innerX = 0.58;
  const archY = (z) => {
    let y = -1;
    for (const zc of arches) {
      const dz = z - zc;
      if (Math.abs(dz) < ra) y = Math.max(y, R + Math.sqrt(ra * ra - dz * dz));
    }
    return y;
  };
  const inGH = (z) => z > -1.99 && z < 1.19;
  const profile = (z) => {
    const yb = bottom(z);
    const yt = top(z);
    const yBelt = Math.min(belt(z), yt - 0.035);
    const w = halfW(z);
    const gh = inGH(z);
    return sanitize({
      yb, ywell: Math.max(yb, archY(z)), innerX, wb: w - 0.035, w, yBelt, yt, wt: Math.min(topW(z), w - 0.02),
      rB: 0.05, rT: gh ? 0.09 : 0.06, crown: gh ? 0.03 : 0.018, bulge: 0.018, upperBulge: gh ? 0.012 : 0.004, tumbleExp: 1.15,
    });
  };
  const PAINT = 0, GLASS = 1, GLOSS = 2, PLASTIC = 3, LENS = 4, TAIL = 5, GH = 6;
  const classify = ({ y, z, ax, tag, cap }) => {
    if (tag === 'cap') {
      if (cap > 0) return y < 0.31 ? PLASTIC : PAINT; // lower splitter
      return y < 0.37 ? PLASTIC : PAINT; // rear diffuser
    }
    if (tag === 'under' || tag === 'well') return PLASTIC;
    const yb = bottom(z);
    if ((tag === 'bottom' || tag === 'lower') && y < yb + 0.12) return PLASTIC; // black sills
    if (!inGH(z)) {
      if (tag === 'top' && z > 2.04 && z < 2.16 && ax < 0.32) return GLOSS; // hood air vent (I-PACE scoop exit)
      return PAINT;
    }
    if (tag === 'edge') return GLOSS; // black roof rails / window frame tops
    if (tag === 'upper') return GH; // side glass, pillars and C-pillar resolved per pixel
    if (tag === 'top') {
      if (z < -1.32 || z > 0.22) return GLASS; // rear window / windshield
      return GLASS; // black panoramic glass roof
    }
    return PAINT;
  };
  // A-pillar follows the windshield edge, B-pillar is gloss black, C-pillar is body colour
  const ghMat = greenhouseMaterial('waymo', mats.paint, mats.glass, mats.gloss, `
    float aY = mix(0.95, 1.47, clamp((1.18 - zz) / 0.93, 0.0, 1.0));
    float cZ = mix(-1.8, -1.3, clamp((yy - 1.04) / 0.41, 0.0, 1.0));
    float win = smoothstep(-aa, aa, yy - (vBelt + 0.022)) * smoothstep(-aa, aa, zz - cZ);
    float aP = zz > 0.2 ? smoothstep(-aa, aa, yy - (aY - 0.045)) : 0.0;
    float bP = smoothstep(aa, -aa, abs(zz + 0.05) - 0.045);
    float pil = max(aP, bP);
    bm = win * pil;
    gm = win * (1.0 - pil);`);
  const materials = [mats.paint, mats.glass, mats.gloss, mats.plastic, mats.lens, mats.tail, ghMat];
  const extra = [];
  for (const zc of arches) for (let k = -10; k <= 10; k++) extra.push(zc + (k / 10) * ra);
  extra.push(1.19, 1.18, -1.99, -1.98, 0.22, -1.32, -0.005, -0.095, 0.0);
  const { mesh } = buildLoftBody({ zMin, zMax, step: 0.04, endRound: 0.22, extraStations: extra, profile, classify, materials, capBulge: 0.045 });
  body.add(mesh);
  archLiners(body, mats, { R, wb: WB, innerX, outerX: 0.93 });

  // --- front: hex grille with honeycomb mesh, chrome surround, bumper lidar
  const grilleTex = canvasTex(512, 160, (ctx, w, h) => {
    ctx.fillStyle = '#060708';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2c3036';
    ctx.lineWidth = 3;
    const s = 15;
    for (let y = 0; y < h + s; y += s * 0.86) {
      for (let x = 0; x < w + s; x += s * 1.5) {
        const ox = (Math.round(y / (s * 0.86)) % 2) * s * 0.75;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          ctx.lineTo(x + ox + Math.cos(a) * s * 0.5, y + Math.sin(a) * s * 0.5);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
  });
  const gShape = new THREE.Shape();
  const gw = 0.5, gy0 = 0.355, gy1 = 0.65;
  gShape.moveTo(-gw + 0.12, gy0);
  gShape.lineTo(gw - 0.12, gy0);
  gShape.lineTo(gw, gy0 + 0.1);
  gShape.lineTo(gw - 0.04, gy1);
  gShape.lineTo(-gw + 0.04, gy1);
  gShape.lineTo(-gw, gy0 + 0.1);
  gShape.closePath();
  const gGeo = new THREE.ShapeGeometry(gShape);
  // map uv over the grille bounds
  {
    const p = gGeo.attributes.position, uv = gGeo.attributes.uv;
    for (let k = 0; k < p.count; k++) uv.setXY(k, (p.getX(k) + gw) / (2 * gw), (p.getY(k) - gy0) / (gy1 - gy0));
  }
  const grille = new THREE.Mesh(gGeo, new THREE.MeshStandardMaterial({ map: grilleTex, roughness: 0.5, metalness: 0.3 }));
  grille.position.z = zMax + 0.047;
  body.add(grille);
  const surround = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(gShape.getPoints(6).map((v) => new THREE.Vector3(v.x, v.y, 0)), true, 'catmullrom', 0.05), 80, 0.011, 6, true), mats.chrome);
  surround.position.z = zMax + 0.05;
  body.add(surround);
  // J-blade DRLs (emissive strips) inside the lenses
  for (const s of [-1, 1]) {
    const pts = [[0.47, 0.725], [0.47, 0.675], [0.5, 0.664], [0.74, 0.664], [0.79, 0.672]].map(([x, y]) => {
      const zz = zMax + 0.045 * Math.max(0, 1 - (x / 0.7) ** 2) + 0.01;
      return new THREE.Vector3(s * x, y, zz);
    });
    pts.push(new THREE.Vector3(s * ((sideX(profile, 2.22, 0.69) ?? 0.86) + 0.009), 0.69, 2.22));
    const drl = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.0065, 6, false), mats.head);
    body.add(drl);
  }
  // front lidar in the lower bumper + lower intakes
  const flid = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.08, 0.06, 2, 0.02), mats.lens);
  flid.position.set(0, 0.29, zMax + 0.02);
  body.add(flid);
  for (const s of [-1, 1]) {
    const intake = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.1, 0.04, 2, 0.02), mats.plastic);
    intake.position.set(s * 0.6, 0.39, zMax + 0.012);
    intake.rotation.y = s * 0.25;
    body.add(intake);
  }
  // --- slim wrap-around headlight lenses and tail lights
  mats.lens.side = THREE.DoubleSide;
  mats.tail.side = THREE.DoubleSide;
  const capHalf = 0.7;
  for (const flip of [false, true]) {
    const hp = wrapPath(profile, { zEnd: zMax, dir: 1, bulge: 0.045, capHalf, y: 0.703, x0: 0.43, x1: 0.69, sideZs: [2.315, 2.29, 2.26, 2.23, 2.2, 2.17] });
    const lens = new THREE.Mesh(ribbon(flip ? mirrorX(hp) : hp, 0.072), mats.lens);
    body.add(lens);
    const tp = wrapPath(profile, { zEnd: zMin, dir: -1, bulge: 0.045, capHalf, y: 0.952, x0: 0.2, x1: 0.69, sideZs: [-2.315, -2.29, -2.26, -2.22, -2.17, -2.12] });
    const tl = new THREE.Mesh(ribbon(flip ? mirrorX(tp) : tp, 0.042), mats.tail);
    body.add(tl);
  }
  const linkPts = wrapPath(profile, { zEnd: zMin, dir: -1, bulge: 0.045, capHalf, y: 0.952, x0: -0.2, x1: 0.2, sideZs: [] });
  body.add(new THREE.Mesh(ribbon(linkPts, 0.03), mats.gloss));

  // --- rear: spoiler wing, plate recess
  const spoiler = new THREE.Mesh(new RoundedBoxGeometry(1.18, 0.024, 0.2, 3, 0.011), mats.paint);
  spoiler.position.set(0, 1.208, -2.06);
  spoiler.rotation.x = -0.16;
  body.add(spoiler);
  const plateTex = canvasTex(320, 160, (ctx, w, h) => {
    ctx.fillStyle = '#f4f4f0';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#1b2a6b';
    ctx.lineWidth = 6;
    ctx.strokeRect(5, 5, w - 10, h - 10);
    ctx.fillStyle = '#c0262d';
    ctx.font = 'italic 700 34px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('California', w / 2, 44);
    ctx.fillStyle = '#1b2a6b';
    ctx.font = '700 66px "Russo One", Arial';
    ctx.fillText('9WVC042', w / 2, 120);
  });
  const plate = new THREE.Group();
  plate.add(new THREE.Mesh(new RoundedBoxGeometry(0.53, 0.135, 0.02, 2, 0.008), mats.plastic));
  const plateFace = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.115), new THREE.MeshStandardMaterial({ map: plateTex, color: plateTex ? '#ffffff' : '#f2f2ee', roughness: 0.45 }));
  plateFace.position.z = 0.0115;
  plate.add(plateFace);
  plate.rotation.y = Math.PI;
  plate.position.set(0, 0.55, zMin - 0.04);
  body.add(plate);
  // tailgate decal in Waymo-style rounded lettering, sea green
  const seeMe = canvasTex(1536, 256, (ctx, w, h) => {
    const text = "You can't see me";
    let size = 160;
    const font = (px) => `800 ${px}px Nunito, Inter, Arial`;
    ctx.font = font(size);
    const tw = ctx.measureText(text).width;
    if (tw > w * 0.94) { size *= (w * 0.94) / tw; ctx.font = font(size); }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const g = ctx.createLinearGradient(w * 0.08, 0, w * 0.92, 0);
    g.addColorStop(0, '#068062');
    g.addColorStop(1, '#10a683');
    ctx.fillStyle = g;
    ctx.fillText(text, w / 2, h / 2 + size * 0.05);
  }, ['800 64px Nunito']);
  if (seeMe) body.add(faceDecal(mesh, seeMe, { dir: -1, x0: -0.62, x1: 0.62, y0: 0.655, y1: 0.865, matte: true }));

  // --- door mirrors: body-colour caps on black bases
  for (const s of [-1, 1]) {
    const x = sideX(profile, 1.0, 1.0) ?? 0.93;
    const cap = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.125, 0.11, 3, 0.045), mats.paint);
    cap.position.set(s * (x + 0.12), 1.04, 0.99);
    cap.rotation.y = s * 0.15;
    body.add(cap);
    const base = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.034, 0.1, 2, 0.014), mats.gloss);
    base.position.set(s * (x + 0.12), 0.98, 0.995);
    base.rotation.y = s * 0.15;
    body.add(base);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.05), mats.gloss);
    arm.position.set(s * (x + 0.03), 0.99, 1.02);
    body.add(arm);
  }

  // --- side details: door cut lines, flush handles, waymo wordmark (conformal decals)
  const z0 = -2.05, z1 = 1.3, y0 = 0.3, y1 = 1.0;
  const panelTex = canvasTex(2048, 440, (ctx, w, h) => {
    const Z = (z) => ((z - z0) / (z1 - z0)) * w;
    const Y = (y) => h - ((y - y0) / (y1 - y0)) * h;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(20,24,30,0.6)';
    ctx.lineWidth = 3;
    const line = (pts) => { ctx.beginPath(); pts.forEach(([z, y], k) => (k ? ctx.lineTo(Z(z), Y(y)) : ctx.moveTo(Z(z), Y(y)))); ctx.stroke(); };
    line([[1.06, 0.98], [1.03, 0.6], [0.98, 0.42], [0.95, 0.31]]); // front door front edge
    line([[-0.05, 0.99], [-0.05, 0.31]]); // B-pillar shut line
    line([[-1.06, 0.99], [-1.1, 0.8], [-1.05, 0.62], [-0.98, 0.5]]); // rear door rear edge (around the arch)
    line([[0.95, 0.33], [-0.98, 0.33]]); // door bottoms
    // flush handles
    ctx.fillStyle = 'rgba(25,28,34,0.85)';
    for (const zc of [0.22, -0.92]) {
      ctx.beginPath();
      ctx.roundRect(Z(zc) - 60, Y(0.88) - 7, 120, 14, 7);
      ctx.fill();
    }
    // black lower door blade, rising toward the rear
    ctx.fillStyle = 'rgba(14,15,18,0.96)';
    ctx.beginPath();
    ctx.moveTo(Z(0.92), Y(0.39)); ctx.lineTo(Z(0.0), Y(0.41)); ctx.lineTo(Z(-0.9), Y(0.455));
    ctx.quadraticCurveTo(Z(-0.97), Y(0.48), Z(-0.9), Y(0.505)); ctx.lineTo(Z(0.0), Y(0.47)); ctx.lineTo(Z(0.9), Y(0.445));
    ctx.closePath();
    ctx.fill();
    // grey WAYMO wordmark on the rear door
    ctx.fillStyle = 'rgba(92,97,106,0.95)';
    ctx.font = '600 56px Inter, "Helvetica Neue", Arial';
    ctx.letterSpacing = '9px';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('WAYMO', Z(-0.62), Y(0.6));
  }, ['600 56px Inter']);
  if (panelTex) {
    const dm = decalMat(panelTex);
    for (const s of [-1, 1]) {
      const patch = new THREE.Mesh(sidePatch(profile, z0, z1, y0, y1, s, 0.0035, 64, 14), dm);
      patch.renderOrder = 2;
      body.add(patch);
    }
  }

  // --- WAYMO DRIVER (5th gen) sensor suite
  const sensorWhite = new THREE.MeshPhysicalMaterial({ color: '#f3f5f7', roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.1 });
  const roofY = top(-0.45) + 0.012;
  // roof rails / feet
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.05, 1.1, 2, 0.02), mats.gloss);
    rail.position.set(s * 0.5, roofY + 0.02, -0.5);
    body.add(rail);
  }
  // tapered base (rounded rectangle frustum)
  const baseH = 0.17;
  const baseShape = (hw, hd, r) => {
    const sh = new THREE.Shape();
    sh.moveTo(-hw + r, -hd);
    sh.lineTo(hw - r, -hd); sh.quadraticCurveTo(hw, -hd, hw, -hd + r);
    sh.lineTo(hw, hd - r); sh.quadraticCurveTo(hw, hd, hw - r, hd);
    sh.lineTo(-hw + r, hd); sh.quadraticCurveTo(-hw, hd, -hw, hd - r);
    sh.lineTo(-hw, -hd + r); sh.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
    return sh;
  };
  const baseGeo = new THREE.ExtrudeGeometry(baseShape(0.5, 0.56, 0.18), { depth: baseH, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 4, curveSegments: 10 });
  baseGeo.rotateX(-Math.PI / 2);
  {
    // taper toward the top
    const p = baseGeo.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const t = Math.min(1, Math.max(0, p.getY(k) / (baseH + 0.03)));
      const f = 1 - 0.22 * t;
      p.setX(k, p.getX(k) * f);
      p.setZ(k, p.getZ(k) * f);
    }
    baseGeo.computeVertexNormals();
  }
  // 5th-gen roof unit: black camera housing with white trim and side arms, white ring, blue
  // accent stripe, wide black camera puck, narrow black lidar drum with a white lid
  const sensorBlack = new THREE.MeshPhysicalMaterial({ color: '#0c0e11', roughness: 0.24, metalness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.1 });
  const base = new THREE.Mesh(baseGeo, sensorBlack);
  base.position.set(0, roofY + 0.045, -0.5);
  body.add(base);
  const plateGeo = new THREE.ExtrudeGeometry(baseShape(0.39, 0.44, 0.15), { depth: 0.022, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 10 });
  plateGeo.rotateX(-Math.PI / 2);
  const topPlate = new THREE.Mesh(plateGeo, sensorWhite);
  topPlate.position.set(0, roofY + 0.045 + baseH + 0.03, -0.5);
  body.add(topPlate);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(s * 0.4, roofY + 0.2, -0.05), new THREE.Vector3(s * 0.47, roofY + 0.16, -0.45),
      new THREE.Vector3(s * 0.5, roofY + 0.08, -0.85), new THREE.Vector3(s * 0.5, roofY + 0.02, -1.05),
    ]), 24, 0.026, 8, false), sensorWhite);
    body.add(arm);
  }
  // camera windows around the base
  const camWin = (x, z, ry, w = 0.16, h = 0.07) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.02, 2, 0.012), mats.lens);
    m.position.set(x, roofY + 0.12, z);
    m.rotation.set(-0.25, ry, 0);
    body.add(m);
  };
  camWin(0.3, -0.5 + 0.55, 0.12, 0.12);
  camWin(0.1, -0.5 + 0.57, 0.03, 0.13);
  camWin(-0.1, -0.5 + 0.57, -0.03, 0.13);
  camWin(-0.3, -0.5 + 0.55, -0.12, 0.12);
  camWin(0.49, -0.5 + 0.28, Math.PI / 2 - 0.4, 0.12);
  camWin(-0.49, -0.5 + 0.28, -Math.PI / 2 + 0.4, 0.12);
  camWin(0.49, -0.5 - 0.3, Math.PI / 2 + 0.4, 0.12);
  camWin(-0.49, -0.5 - 0.3, -Math.PI / 2 - 0.4, 0.12);
  camWin(0, -0.5 - 0.56, Math.PI, 0.22);
  const towerY = roofY + 0.045 + baseH + 0.06;
  const zT = -0.46;
  const stack = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.set(0, towerY + y, zT); body.add(m); return m; };
  stack(new THREE.CylinderGeometry(0.3, 0.31, 0.03, 48), sensorWhite, 0.015);
  stack(new THREE.CylinderGeometry(0.297, 0.3, 0.016, 48), new THREE.MeshStandardMaterial({ color: '#1e5bff', emissive: '#2f6bff', emissiveIntensity: 0.55, roughness: 0.35 }), 0.038);
  stack(new THREE.CylinderGeometry(0.27, 0.29, 0.11, 48), sensorBlack, 0.101);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const cw = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.05, 0.02, 2, 0.01), mats.lens);
    cw.position.set(Math.sin(a) * 0.278, towerY + 0.1, zT + Math.cos(a) * 0.278);
    cw.rotation.set(0.1, a, 0);
    body.add(cw);
  }
  stack(new THREE.CylinderGeometry(0.125, 0.14, 0.15, 40), sensorBlack, 0.231);
  stack(new THREE.CylinderGeometry(0.131, 0.128, 0.018, 40), sensorWhite, 0.315);
  stack(new THREE.CylinderGeometry(0.112, 0.128, 0.012, 40), sensorBlack, 0.33);
  const lidarSpin = new THREE.Group();
  lidarSpin.position.set(0, towerY + 0.231, zT);
  const glint = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.008), new THREE.MeshStandardMaterial({ color: '#3fe0ff', emissive: '#3fe0ff', emissiveIntensity: 1.4 }));
  glint.position.z = 0.135;
  lidarSpin.add(glint);
  body.add(lidarSpin);
  // rider LED display on the front of the camera housing (shows the rider's initials in real life)
  const ledTex = canvasTex(128, 48, (ctx, w, h) => {
    ctx.fillStyle = '#05080c';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#4fe3ff';
    ctx.font = '700 32px Inter, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('WVC', w / 2, h / 2 + 2);
  });
  if (ledTex) {
    const led = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.05), new THREE.MeshStandardMaterial({ map: ledTex, emissive: '#ffffff', emissiveMap: ledTex, emissiveIntensity: 1.2 }));
    led.position.set(0, roofY + 0.19, -0.5 + 0.465);
    led.rotation.x = -0.3;
    body.add(led);
  }
  // perimeter sensor pods: white housings with big black lidar/camera faces on the front
  // corners of the hood and low on the rear bumper corners
  const pod = (x, y, z, ry, s, scale = 1) => {
    const g = new THREE.Group();
    const housing = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.15, 0.26, 3, 0.05), sensorWhite);
    housing.position.y = 0.075;
    const face = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.115, 0.024, 2, 0.022), mats.lens);
    face.position.set(0, 0.075, 0.128);
    g.add(housing, face);
    if (scale === 1) {
      const topBox = new THREE.Mesh(new RoundedBoxGeometry(0.085, 0.06, 0.11, 2, 0.022), sensorWhite);
      topBox.position.set(s * 0.025, 0.17, -0.045);
      const topEye = new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.036, 0.065, 1, 0.005), mats.lens);
      topEye.position.set(s * 0.069, 0.17, -0.045);
      g.add(topBox, topEye);
    }
    g.scale.setScalar(scale);
    g.position.set(x, y, z);
    g.rotation.y = ry;
    body.add(g);
  };
  for (const s of [-1, 1]) {
    pod(s * 0.76, top(1.86) - 0.02, 1.84, s * 0.5, s);
    pod(s * ((sideX(profile, -2.16, 0.62) ?? 0.86) - 0.02), 0.56, -2.16, Math.PI - s * 0.75, s, 0.8);
    // side sensor pod on the front fender ahead of the door
    const sp = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.13, 0.2, 2, 0.025), sensorWhite);
    const xs = sideX(profile, 1.3, 0.78) ?? 0.93;
    sp.position.set(s * (xs + 0.025), 0.78, 1.3);
    body.add(sp);
    const se = new THREE.Mesh(new RoundedBoxGeometry(0.015, 0.06, 0.1, 1, 0.006), mats.lens);
    se.position.set(s * (xs + 0.058), 0.79, 1.3);
    body.add(se);
  }
  // camera / radar module in the centre of the grille
  const gm = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.11, 0.05, 2, 0.02), sensorBlack);
  gm.position.set(0, 0.53, zMax + 0.06);
  body.add(gm);
  const gEye = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 20).rotateX(Math.PI / 2), mats.lens);
  gEye.position.set(0, 0.555, zMax + 0.087);
  body.add(gEye);

  mats.rim = new THREE.MeshPhysicalMaterial({ color: '#101113', metalness: 0.55, roughness: 0.22, clearcoat: 0.9, clearcoatRoughness: 0.08 });
  mats.centreCap = new THREE.MeshStandardMaterial({ color: '#b3121b', metalness: 0.3, roughness: 0.35 });
  const wheels = buildWheels(root, mats, { R, W: TW, wb: WB, track: TRACK, style: 'turbine' });
  body.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return {
    root, body, wheels, mats, lidarSpin,
    dims: { length: 4.68, width: 1.9, height: towerY + 0.34, wheelbase: WB, track: TRACK, wheelRadius: R },
    lights: { head: mats.head, tail: mats.tail },
    accent: new THREE.Color('#3ad6c5'),
  };
}

// ---------------------------------------------------------------------------
// TESLA CYBERCAB (production car, measured off side-on photos)
// ---------------------------------------------------------------------------
export function createCybercab() {
  const R = 0.37, WB = 2.8, TRACK = 1.7, TW = 0.235;
  const zMax = 2.17, zMin = -2.19;
  const mats = heroMaterials({ paint: '#c29d5e', metallic: true });
  // satin champagne-gold paint, wheel covers in the same colour
  Object.assign(mats.paint, { metalness: 0.58, roughness: 0.33, clearcoat: 0.35, clearcoatRoughness: 0.25, envMapIntensity: 1.2 });
  mats.rim = new THREE.MeshPhysicalMaterial({ color: '#b99a5f', metalness: 0.5, roughness: 0.42, clearcoat: 0.2, clearcoatRoughness: 0.4, side: THREE.DoubleSide });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // centreline: tail lip, fastback deck, roof, wraparound windshield, hood, nose
  const top = curve([
    [-2.19, 0.845], [-2.16, 0.858], [-2.1, 0.878], [-2.0, 0.915], [-1.9, 0.95], [-1.8, 0.983], [-1.7, 1.013],
    [-1.6, 1.046], [-1.5, 1.08], [-1.4, 1.11], [-1.3, 1.146], [-1.2, 1.186], [-1.1, 1.222], [-1.0, 1.25],
    [-0.9, 1.276], [-0.8, 1.3], [-0.7, 1.324], [-0.6, 1.345], [-0.5, 1.362], [-0.4, 1.377], [-0.3, 1.389],
    [-0.2, 1.397], [-0.1, 1.4], [0.0, 1.4], [0.1, 1.392], [0.2, 1.375], [0.3, 1.35], [0.4, 1.318], [0.5, 1.28],
    [0.6, 1.236], [0.7, 1.186], [0.8, 1.13], [0.9, 1.07], [1.0, 1.012], [1.06, 0.98], [1.15, 0.97], [1.3, 0.963],
    [1.45, 0.952], [1.6, 0.93], [1.71, 0.9], [1.8, 0.862], [1.89, 0.816], [1.97, 0.772], [2.05, 0.733],
    [2.11, 0.703], [2.15, 0.676], [2.17, 0.655],
  ]);
  // shoulder crease: haunch line at the back, fading over the doors, fender/hood edge at the front
  const belt = curve([
    [-2.19, 0.828], [-2.12, 0.846], [-2.0, 0.866], [-1.85, 0.885], [-1.65, 0.901], [-1.45, 0.913], [-1.15, 0.921],
    [-0.85, 0.917], [-0.55, 0.905], [-0.25, 0.889], [0.05, 0.876], [0.3, 0.876], [0.55, 0.893], [0.75, 0.918],
    [0.9, 0.93], [1.04, 0.931], [1.26, 0.917], [1.49, 0.888], [1.72, 0.852], [1.85, 0.8], [1.97, 0.745],
    [2.07, 0.7], [2.13, 0.672], [2.17, 0.645],
  ]);
  const halfW = curve([
    [-2.19, 0.86], [-2.17, 0.915], [-2.12, 0.945], [-2.0, 0.965], [-1.7, 0.976], [-1.4, 0.978], [-1.0, 0.97],
    [-0.5, 0.96], [0.0, 0.955], [0.5, 0.955], [0.9, 0.96], [1.4, 0.968], [1.7, 0.955], [1.85, 0.93], [1.97, 0.885],
    [2.07, 0.82], [2.13, 0.75], [2.17, 0.66],
  ]);
  const bottom = curve([[-2.19, 0.27], [-2.12, 0.22], [-2.0, 0.19], [-1.7, 0.165], [1.7, 0.16], [1.95, 0.18], [2.08, 0.2], [2.14, 0.22], [2.17, 0.25]]);
  // window sill line (shoulder → glass kink) and how far the glasshouse steps in from the crease
  const sillY = curve([
    [-2.19, 0.835], [-2.0, 0.888], [-1.8, 0.94], [-1.6, 0.99], [-1.4, 1.025], [-1.2, 1.036], [-1.0, 1.04], [-0.8, 1.04],
    [-0.6, 1.034], [-0.4, 1.025], [-0.2, 1.016], [0.0, 1.007], [0.2, 0.995], [0.4, 0.986], [0.6, 0.978], [0.75, 0.968],
  ]);
  const inset = curve([
    [-2.19, 0.1], [-2.05, 0.16], [-1.8, 0.2], [-1.5, 0.2], [-1.2, 0.17], [-0.9, 0.135], [-0.6, 0.11], [0.0, 0.1],
    [0.4, 0.09], [0.6, 0.075], [0.75, 0.05], [0.85, 0.02], [0.95, 0.008], [2.17, 0.006],
  ]);
  // half-width where the crowned top (deck / roof / windshield / hood) starts
  const edgeX = curve([
    [-2.19, 0.6], [-2.0, 0.55], [-1.7, 0.52], [-1.4, 0.53], [-1.1, 0.55], [-0.6, 0.565], [0.0, 0.565], [0.3, 0.57],
    [0.4, 0.59], [0.5, 0.62], [0.6, 0.66], [0.7, 0.715], [0.8, 0.79], [0.9, 0.82], [1.06, 0.85], [1.4, 0.89],
    [1.7, 0.88], [1.85, 0.86], [1.97, 0.82], [2.07, 0.76], [2.13, 0.69], [2.17, 0.6],
  ]);
  const crownT = curve([[-2.19, 0.006], [-2.0, 0.014], [-1.7, 0.018], [-1.3, 0.016], [-1.0, 0.018], [-0.6, 0.02], [-0.2, 0.026], [0.3, 0.028]]);
  // A-pillar line: top edge of the side glass along the windshield
  const aPillar = curve([[0.3, 1.322], [0.4, 1.292], [0.5, 1.25], [0.6, 1.193], [0.65, 1.158], [0.7, 1.11], [0.75, 1.045], [0.8, 0.968], [0.9, 0.957], [1.06, 0.956]]);
  const gAngT = curve([[-2.19, 6], [-1.9, 10], [-1.6, 20], [-1.35, 34], [-1.1, 52], [-0.8, 62], [0.0, 64], [0.5, 62], [0.75, 60], [0.9, 70], [2.17, 72]]);
  const sharpT = curve([[-2.19, 1], [-1.0, 1], [-0.5, 0.85], [-0.1, 0.45], [0.3, 0.3], [0.6, 0.4], [0.85, 0.7], [2.17, 0.8]]);
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;

  const arches = [WB / 2, -WB / 2];
  const ra = 0.44;
  const innerX = 0.62;
  const archY = (z) => {
    let y = -1;
    for (const zc of arches) {
      const dz = z - zc;
      if (Math.abs(dz) < ra) y = Math.max(y, R + Math.sqrt(ra * ra - dz * dz));
    }
    return y;
  };
  const profile = (z) => {
    const yb = bottom(z), Yc = top(z), w = halfW(z);
    const ywell = Math.max(yb, archY(z));
    const yBelt = Math.max(belt(z), ywell + 0.07);
    let yt = Yc - crownT(z);
    if (z > 0.25) yt = lerp(yt, aPillar(z), sstep(0.25, 0.35, z));
    const hoodYt = yBelt + Math.min(0.028, Math.max(0.004, (Yc - yBelt) * 0.55));
    if (z > 1.0) yt = lerp(yt, hoodYt, sstep(1.0, 1.1, z));
    const yS = Math.max(yBelt + 0.002, lerp(sillY(z), yBelt + 0.006, sstep(0.72, 0.9, z)));
    yt = Math.max(Math.min(yt, Yc - 0.002), yS + 0.004);
    const wS = w - inset(z);
    return {
      mode: 'shoulder', yb, ywell, innerX, wb: w - 0.035, w, yBelt, yS, wS, xs: Math.min(edgeX(z), wS - 0.02), yt,
      crown: Math.max(0.002, Yc - yt), gAng: (gAngT(z) * Math.PI) / 180, sharp: sharpT(z), k0: 0.36, k1: 0.36,
      rB: 0.04, bulge: 0.012,
    };
  };
  // per-station window lines for the greenhouse mask: [sill line, glass top, top edge y, top edge x]
  const dloB = curve([[-1.27, 1.2], [-1.2, 1.142], [-1.15, 1.106], [-1.1, 1.091], [-1.0, 1.073], [-0.9, 1.058], [-0.8, 1.046], [-0.7, 1.04], [-0.62, 1.036]]);
  const stationData = (z) => {
    const p = profile(z);
    const sill = z < -0.62 ? Math.max(dloB(z), p.yS + 0.003) : p.yS + 0.003;
    return [sill, p.yt - lerp(0.018, 0.045, sstep(0.25, 0.35, z)), p.yt, p.xs];
  };
  const PAINT = 0, GLASS = 1, GLOSS = 2, PLASTIC = 3, LENS = 4, TAIL = 5, GH = 6;
  const GH0 = -1.32, GH1 = 1.1;
  const classify = ({ y, z, tag, cap }) => {
    if (tag === 'cap') {
      // stepped quad edges stay hidden behind the valance ribbon / rear bumper
      if (cap > 0) return y < 0.27 ? PLASTIC : PAINT;
      return y < 0.43 ? PLASTIC : PAINT;
    }
    if (tag === 'under' || tag === 'well') return PLASTIC;
    if (tag === 'bottom' || tag === 'lower') {
      if (z < -1.84 && y < 0.43) return PLASTIC;
      if (z > 1.84 && y < 0.27) return PLASTIC;
      if (y < bottom(z) + 0.05) return PLASTIC;
    }
    if ((tag === 'upper' || tag === 'top') && z > GH0 && z < GH1) return GH;
    return PAINT;
  };
  // body-colour roof; long door glass + teardrop rear quarter glass split by a slim black B-pillar;
  // wraparound windshield with black frit; everything framed in thin black seals
  const ghMat = greenhouseMaterial('cybercab', mats.paint, mats.glass, mats.gloss, `
    float dB = vSt.x, dT = vSt.y, yte = vSt.z, xse = vSt.w;
    float onTop = smoothstep(yte - 0.003, yte + 0.001, yy);
    float sideW = (1.0 - onTop) * smoothstep(-aa, aa, yy - dB) * smoothstep(-aa, aa, dT - yy);
    float fr = 0.01;
    float sideG = (1.0 - onTop) * smoothstep(-aa, aa, yy - dB - fr) * smoothstep(-aa, aa, dT - fr - yy);
    float zB = -0.555 - 0.44 * (yy - 1.04);
    float bp = smoothstep(aa, -aa, abs(zz - zB) - 0.012);
    float zH = 0.3 - 0.1 * pow(min(xx / 0.57, 1.3), 2.0);
    float zC = 1.06 - 0.27 * pow(min(xx / 0.79, 1.3), 2.2);
    float ws = onTop * smoothstep(-aa, aa, zz - zH) * smoothstep(-aa, aa, zC - zz);
    float wsG = onTop * smoothstep(-aa, aa, zz - zH - 0.04) * smoothstep(-aa, aa, zC - zz - 0.03) * smoothstep(-aa, aa, xse - 0.07 - xx);
    gm = max(sideG * (1.0 - bp), wsG);
    bm = clamp(max(sideW - sideG, ws - wsG) + sideG * bp, 0.0, 1.0 - gm);`, { station: true });
  const materials = [mats.paint, mats.glass, mats.gloss, mats.plastic, mats.lens, mats.tail, ghMat];
  const extra = [];
  for (const zc of arches) for (let k = -10; k <= 10; k++) extra.push(zc + (k / 10) * ra);
  for (let z = -1.3; z <= -1.1; z += 0.02) extra.push(z); // rear quarter glass tip
  for (let z = 0.7; z <= 1.1; z += 0.02) extra.push(z); // A-pillar base / cowl
  for (let z = 1.9; z <= 2.17; z += 0.02) extra.push(z); // nose
  extra.push(GH0, GH1);
  const { mesh } = buildLoftBody({ zMin, zMax, step: 0.035, endRound: 0.12, extraStations: extra, profile, classify, materials, capBulge: 0.03, stationData });
  // flatter rear face than nose
  {
    const p = mesh.geometry.attributes.position;
    for (let k = 0; k < p.count; k++) if (p.getZ(k) < zMin - 1e-4) p.setZ(k, zMin - (zMin - p.getZ(k)) * 0.35);
    p.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }
  body.add(mesh);
  mesh.updateMatrixWorld(true);
  archLiners(body, mats, { R: ra - 0.075, wb: WB, innerX, outerX: 0.95 });

  // surface probe for placing trim exactly on the body
  const ray = new THREE.Raycaster();
  const hit = (o, d) => {
    ray.set(o, d.clone().normalize());
    const h = ray.intersectObject(mesh, false)[0];
    return h ? { p: h.point, n: h.face.normal.clone() } : null;
  };
  const onFace = (x, y, dir, off = 0.004) => { // dir +1 nose, -1 tail
    const h = hit(new THREE.Vector3(x, y, dir * 4), new THREE.Vector3(0, 0, -dir));
    return h ? h.p.add(h.n.multiplyScalar(off)) : new THREE.Vector3(x, y, dir > 0 ? zMax : zMin);
  };
  const onSide = (z, y, s, off = 0.004) => {
    const h = hit(new THREE.Vector3(s * 3, y, z), new THREE.Vector3(-s, 0, 0));
    return h ? h.p.add(h.n.multiplyScalar(off)) : new THREE.Vector3(s * halfW(z), y, z);
  };
  // grid strip through probe columns (each probe maps a height to a point on the body)
  const hugBand = (probes, ys) => {
    const pos = [], idx = [];
    probes.forEach((f) => ys.forEach((y) => { const p = f(y); pos.push(p.x, p.y, p.z); }));
    const n = ys.length;
    for (let i = 0; i < probes.length - 1; i++) {
      for (let j = 0; j < n - 1; j++) {
        const a = i * n + j, b = a + 1, c = a + n + 1, d = a + n;
        idx.push(a, d, b, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };

  // black sills between the wheels
  for (const s of [-1, 1]) body.add(new THREE.Mesh(sidePatch(profile, -0.97, 0.97, 0.17, 0.345, s, 0.006, 40, 4), mats.plastic));

  // chunky black rear bumper that wraps the corners to the wheel arches (protrudes a little)
  {
    const yRef = 0.36, zFrom = -1.86, out = 0.035, inn = 0.08;
    const zs = [];
    for (let k = 0; k <= 16; k++) zs.push(zFrom + (zMin - zFrom) * (k / 16));
    const sx = zs.map((z) => sideX(profile, z, yRef) ?? halfW(z));
    const sh = new THREE.Shape();
    zs.forEach((z, k) => (k ? sh.lineTo(sx[k] + out, -z) : sh.moveTo(sx[k] + out, -z)));
    sh.lineTo(sx[16] + out * 0.4, -(zMin - out));
    sh.lineTo(-(sx[16] + out * 0.4), -(zMin - out));
    for (let k = 16; k >= 0; k--) sh.lineTo(-(sx[k] + out), -zs[k]);
    for (let k = 0; k <= 16; k++) sh.lineTo(-(sx[k] - inn), -zs[k] + (k === 16 ? -inn : 0));
    for (let k = 16; k >= 0; k--) sh.lineTo(sx[k] - inn, -zs[k] + (k === 16 ? -inn : 0));
    const y0 = 0.215, y1 = 0.48;
    const g = new THREE.ExtrudeGeometry(sh, { depth: y1 - y0, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 4 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y0, 0);
    const bumper = new THREE.Mesh(g, mats.plastic);
    body.add(bumper);
    // red reflectors on the bumper corners
    const refl = new THREE.MeshStandardMaterial({ color: '#5a0505', emissive: '#c01010', emissiveIntensity: 0.6, roughness: 0.3, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const pts = [];
      for (let k = 0; k <= 6; k++) {
        const z = -1.97 - 0.17 * (k / 6);
        const x = (sideX(profile, z, yRef) ?? halfW(z)) + out + 0.014;
        pts.push(new THREE.Vector3(s * x, 0.455, z));
      }
      body.add(new THREE.Mesh(ribbon(pts, 0.022), refl));
    }
  }

  // nose: black grille band with mesh, lower lip, offset plate panel
  const meshTex = canvasTex(512, 64, (ctx, w, h) => {
    ctx.fillStyle = '#07080a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#24272c';
    ctx.lineWidth = 2;
    for (let x = -h; x < w + h; x += 9) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + h, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + h, 0); ctx.lineTo(x, h); ctx.stroke();
    }
  });
  {
    // black valance wrapping the nose back to the wheel arches, hugging the bulged nose
    const probes = [];
    for (let k = 8; k >= 0; k--) probes.push((y) => onSide(1.86 + 0.29 * (k / 8), y, -1, 0.004));
    for (let k = 0; k <= 24; k++) probes.push((y) => onFace(-0.62 + 1.24 * (k / 24), y, 1, 0.004));
    for (let k = 0; k <= 8; k++) probes.push((y) => onSide(2.15 - 0.29 * (k / 8), y, 1, 0.004));
    body.add(new THREE.Mesh(hugBand(probes, [0.235, 0.27, 0.305, 0.34]), new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.7, metalness: 0.05, side: THREE.DoubleSide })));
    const pts = [];
    for (let k = 0; k <= 20; k++) pts.push(onFace(-0.56 + 1.12 * (k / 20), 0.287, 1, 0.007));
    const g = ribbon(pts, 0.062);
    const uv = [];
    pts.forEach((_, k) => uv.push(k / 20, 0, k / 20, 1));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    body.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: meshTex, color: meshTex ? '#ffffff' : '#08090b', roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide })));
  }
  const lip = new THREE.Mesh(new RoundedBoxGeometry(1.56, 0.035, 0.14, 2, 0.015), mats.plastic);
  lip.position.set(0, 0.205, zMax - 0.06);
  body.add(lip);
  const platePos = onFace(-0.42, 0.47, 1, 0.012);
  const platePanel = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.14, 0.02, 2, 0.008), mats.gloss);
  platePanel.position.copy(platePos);
  body.add(platePanel);

  // light bars: thin DRL line across the nose under the hood edge, widening into slim lamps that wrap
  // back along the fenders; full-width red bar under the tail lip in a black housing
  mats.lens.side = THREE.DoubleSide;
  mats.tail.side = THREE.DoubleSide;
  {
    const across = [];
    for (let k = 0; k <= 24; k++) {
      const x = -0.6 + 1.2 * (k / 24);
      across.push(onFace(x, 0.632 + 0.012 * (x / 0.6) ** 2, 1, 0.006));
    }
    const wrap = (s) => {
      const pts = [];
      for (let k = 0; k <= 10; k++) {
        const z = 2.12 - 0.29 * (k / 10);
        pts.push(onSide(z, lerp(0.652, 0.705, k / 10), s, 0.006));
      }
      return pts;
    };
    const L = wrap(1), Rr = wrap(-1);
    const bar = [...Rr.slice().reverse(), ...across, ...L];
    body.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bar), 220, 0.0055, 6, false), mats.head));
    for (const s of [-1, 1]) {
      const lamp = [];
      for (let k = 0; k <= 8; k++) { const x = s * (0.36 + 0.24 * (k / 8)); lamp.push(onFace(x, 0.632 + 0.012 * (x / 0.6) ** 2 - 0.017, 1, 0.004)); }
      const side = s > 0 ? L : Rr;
      side.forEach((p) => lamp.push(new THREE.Vector3(p.x - s * 0.002, p.y - 0.017, p.z)));
      if (s < 0) lamp.reverse();
      body.add(new THREE.Mesh(ribbon(lamp, 0.03), mats.lens));
    }
  }
  {
    // path runs left → right as seen from behind so the strips face backwards
    const y = 0.8;
    const pts = [];
    const cornerZ = [-2.13, -2.15, -2.17];
    for (const z of cornerZ) pts.push(onSide(z, y, 1, 0.004));
    for (let k = 0; k <= 24; k++) pts.push(onFace(0.82 - 1.64 * (k / 24), y, -1, 0.004));
    for (const z of cornerZ.slice().reverse()) pts.push(onSide(z, y, -1, 0.004));
    const housing = pts.map((p) => p.clone());
    body.add(new THREE.Mesh(ribbon(housing, 0.064), mats.gloss));
    const glow = pts.map((p) => new THREE.Vector3(p.x * 1.0, p.y, p.z + (p.z < zMin + 0.01 ? -0.003 : 0)));
    body.add(new THREE.Mesh(ribbon(glow, 0.03), mats.tail));
    const lineMat = new THREE.MeshStandardMaterial({ color: '#ff6a5a', emissive: '#ff3b2e', emissiveIntensity: 2.4, side: THREE.DoubleSide });
    body.add(new THREE.Mesh(ribbon(glow.map((p) => new THREE.Vector3(p.x, p.y + 0.017, p.z - (p.z < zMin + 0.01 ? 0.001 : 0))), 0.005), lineMat));
  }

  // rear panel badge in Tesla Cyber-style lettering
  const luck = canvasTex(1840, 256, (ctx, w, h) => drawCyberText(ctx, 'Luck Fidar', w / 2, h * 0.8, h * 0.6, w * 0.92, '#121212'));
  if (luck) body.add(faceDecal(mesh, luck, { dir: -1, x0: -0.72, x1: 0.72, y0: 0.54, y1: 0.74 }));

  // side details: door shut lines, fender camera; amber side markers ahead of the front wheels
  const z0 = -1.0, z1 = 1.25, y0 = 0.34, y1 = 1.0;
  const panelTex = canvasTex(2048, 600, (ctx, w, h) => {
    const Z = (z) => ((z - z0) / (z1 - z0)) * w;
    const Y = (y) => h - ((y - y0) / (y1 - y0)) * h;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(38,30,16,0.6)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    const line = (pts) => { ctx.beginPath(); pts.forEach(([z, y], k) => (k ? ctx.lineTo(Z(z), Y(y)) : ctx.moveTo(Z(z), Y(y)))); ctx.stroke(); };
    line([[-0.64, 1.035], [-0.585, 0.85], [-0.52, 0.62], [-0.455, 0.4], [-0.44, 0.35]]); // door rear edge
    line([[0.77, 0.968], [0.86, 0.86], [0.96, 0.74], [0.97, 0.66], [0.935, 0.5], [0.915, 0.35]]); // door front edge
    // triangular side-repeater camera on the front fender
    ctx.fillStyle = 'rgba(10,11,13,0.95)';
    ctx.beginPath();
    ctx.moveTo(Z(1.02), Y(0.79)); ctx.lineTo(Z(1.1), Y(0.785)); ctx.lineTo(Z(1.035), Y(0.758)); ctx.closePath();
    ctx.fill();
  });
  if (panelTex) {
    const dm = decalMat(panelTex, { roughness: 0.35 });
    for (const s of [-1, 1]) {
      const patch = new THREE.Mesh(sidePatch(profile, z0, z1, y0, y1, s, 0.0035, 72, 18), dm);
      patch.renderOrder = 2;
      body.add(patch);
    }
  }
  const amber = new THREE.MeshStandardMaterial({ color: '#7a3b00', emissive: '#ff8c1a', emissiveIntensity: 0.9, roughness: 0.3 });
  for (const s of [-1, 1]) {
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const a = -0.08 + 0.44 * (k / 8);
      pts.push(onSide(WB / 2 + 0.475 * Math.cos(a), R + 0.475 * Math.sin(a), s, 0.004));
    }
    body.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.007, 6, false), amber));
  }

  // stylised CYBERCAB script on the left of the deck
  const letters = canvasTex(512, 96, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(40,36,30,0.85)';
    ctx.font = 'italic 800 58px "Russo One", Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '4px';
    ctx.setTransform(1, 0, -0.25, 1, 12, 0);
    ctx.fillText('CYBERCAB', w / 2, h / 2 + 3);
  }, ['58px "Russo One"']);
  if (letters) {
    const h = hit(new THREE.Vector3(0.42, 3, -1.98), new THREE.Vector3(0, -1, 0));
    if (h) {
      const n = h.n.normalize();
      const xAxis = new THREE.Vector3(-1, 0, 0);
      const yAxis = new THREE.Vector3().crossVectors(n, xAxis).normalize();
      const lp = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.064), decalMat(letters, { roughness: 0.4 }));
      lp.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, n));
      lp.position.copy(h.p).add(n.clone().multiplyScalar(0.003));
      lp.renderOrder = 2;
      body.add(lp);
    }
  }

  const wheels = buildWheels(root, mats, { R, W: TW, wb: WB, track: TRACK, style: 'aero' });
  body.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return {
    root, body, wheels, mats, lidarSpin: null,
    dims: { length: 4.36, width: 1.96, height: 1.4, wheelbase: WB, track: TRACK, wheelRadius: R },
    lights: { head: mats.head, tail: mats.tail },
    accent: new THREE.Color('#ff5a36'),
  };
}
