// Procedural crowd humans. Anatomically proportioned lofted bodies (male / female) with
// sculpted heads (eyes, brows, nose, ears, lips), hands and shoes; hair styles, clothing and
// accessories as optional parts; and a rig animated in the vertex shader (gait with knee
// bend, hip sway and counter-swinging arms, idle breathing, hailing a taxi, looking at a
// phone, celebrating, diving out of the way). One draw call per body type and detail level.
//
// Body space: +Y up, +Z forward (the way the person faces), +X to their left, feet at y = 0.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// optional parts (a vertex shows if any of its option bits is set for the instance)
export const OPT = { hairShort: 1, hairLong: 2, hairBun: 4, cap: 8, backpack: 16, bag: 32, skirt: 64, coat: 128, phone: 256, glasses: 512 };
// look switches that recolour zones instead of adding geometry
export const LOOK = { longSleeves: 1024, bareShins: 2048, bareThighs: 4096, beard: 8192 };
// colour regions (resolved per instance in the shader)
const R = { skin: 0, top: 1, bottom: 2, shoes: 3, hair: 4, accent: 5, dark: 6, lip: 7, sole: 8, forearm: 9, shin: 10, beard: 11, phone: 12, thighLow: 13, white: 14 };
// bones: 0 pelvis 1 spine 2 chest 3 neck 4 head | 5-7 shoulder/elbow/wrist L | 8-10 R | 11-13 hip/knee/ankle L | 14-16 R
const HAIR_ALL = OPT.hairShort | OPT.hairLong | OPT.hairBun;

const BODY = {
  m: {
    J: {
      pelvis: [0, 0.97, 0], spine: [0, 1.06, -0.01], chest: [0, 1.2, -0.015], neck: [0, 1.47, -0.02], head: [0, 1.585, -0.005],
      shoulder: [0.18, 1.435, -0.025], elbow: [0.205, 1.155, -0.04], wrist: [0.21, 0.915, -0.01],
      hip: [0.095, 0.925, 0], knee: [0.098, 0.505, 0.015], ankle: [0.1, 0.085, -0.02],
    },
    // y, half-width, half-depth, centre z (crotch → neck base)
    torso: [
      [0.86, 0.135, 0.095, 0], [0.9, 0.165, 0.11, 0], [0.95, 0.172, 0.115, 0], [1.0, 0.165, 0.11, 0], [1.06, 0.152, 0.102, 0],
      [1.12, 0.155, 0.106, 0.004], [1.2, 0.165, 0.113, 0.008], [1.28, 0.175, 0.118, 0.01], [1.35, 0.182, 0.115, 0.006],
      [1.41, 0.178, 0.104, 0], [1.44, 0.16, 0.092, -0.004], [1.462, 0.122, 0.082, -0.009], [1.48, 0.082, 0.07, -0.013], [1.495, 0.062, 0.06, -0.015],
    ],
    cut: [1.02, 1.17, 1.47], waist: 1.02, neckline: 1.452, coatBottom: 0.62,
    head: { c: [0, 1.657, 0.012], r: [0.082, 0.117, 0.1] },
    neckR: [0.06, 0.063],
    up: [[0, 0.05, 0.055], [0.12, 0.06, 0.058], [0.35, 0.053, 0.055], [0.65, 0.047, 0.049], [0.9, 0.042, 0.044], [1, 0.04, 0.042]],
    fore: [[0, 0.041, 0.043], [0.25, 0.044, 0.043], [0.6, 0.036, 0.033], [1, 0.03, 0.023]],
    thigh: [[0, 0.088, 0.092], [0.15, 0.09, 0.094], [0.5, 0.075, 0.08], [0.85, 0.057, 0.06], [1, 0.051, 0.053]],
    shin: [[0, 0.051, 0.053, 0], [0.18, 0.054, 0.06, -0.012], [0.42, 0.047, 0.052, -0.008], [0.75, 0.036, 0.038, 0], [1, 0.032, 0.034, 0]],
    hand: 1, foot: 1,
  },
  f: {
    J: {
      pelvis: [0, 0.92, 0], spine: [0, 1.0, -0.01], chest: [0, 1.13, -0.015], neck: [0, 1.38, -0.02], head: [0, 1.488, -0.005],
      shoulder: [0.163, 1.348, -0.025], elbow: [0.185, 1.085, -0.035], wrist: [0.19, 0.86, -0.005],
      hip: [0.1, 0.875, 0], knee: [0.098, 0.475, 0.015], ankle: [0.098, 0.08, -0.02],
    },
    torso: [
      [0.81, 0.135, 0.095, 0], [0.85, 0.172, 0.115, -0.005], [0.9, 0.18, 0.12, -0.008], [0.95, 0.165, 0.11, -0.004],
      [1.0, 0.135, 0.092, 0], [1.05, 0.132, 0.092, 0.003], [1.11, 0.142, 0.1, 0.008], [1.17, 0.152, 0.118, 0.018],
      [1.22, 0.155, 0.122, 0.022], [1.27, 0.155, 0.108, 0.012], [1.32, 0.158, 0.098, 0.004], [1.352, 0.142, 0.088, -0.003],
      [1.372, 0.108, 0.078, -0.008], [1.39, 0.072, 0.064, -0.012], [1.405, 0.056, 0.054, -0.015],
    ],
    cut: [0.97, 1.1, 1.38], waist: 0.98, neckline: 1.365, coatBottom: 0.58,
    head: { c: [0, 1.556, 0.012], r: [0.077, 0.11, 0.094] },
    neckR: [0.052, 0.055],
    up: [[0, 0.044, 0.048], [0.12, 0.05, 0.05], [0.35, 0.045, 0.047], [0.65, 0.041, 0.043], [0.9, 0.037, 0.039], [1, 0.035, 0.037]],
    fore: [[0, 0.036, 0.038], [0.25, 0.038, 0.037], [0.6, 0.031, 0.029], [1, 0.026, 0.02]],
    thigh: [[0, 0.09, 0.094], [0.15, 0.091, 0.095], [0.5, 0.074, 0.079], [0.85, 0.054, 0.057], [1, 0.047, 0.05]],
    shin: [[0, 0.047, 0.05, 0], [0.18, 0.05, 0.056, -0.012], [0.42, 0.043, 0.048, -0.008], [0.75, 0.032, 0.034, 0], [1, 0.028, 0.03, 0]],
    hand: 0.9, foot: 0.9,
  },
};

const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mirror = (p, side) => [p[0] * side, p[1], p[2]];

// flip any triangle whose normal faces away from ref(triangle) so everything faces outward
function orient(pos, idx, ref) {
  const v = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  for (let t = 0; t < idx.length; t += 3) {
    const a = v(idx[t]), b = v(idx[t + 1]), c = v(idx[t + 2]);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const r = ref(t / 3, [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]);
    if (n[0] * r[0] + n[1] * r[1] + n[2] * r[2] < 0) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
  }
}

function geo(pos, rig, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRig', new THREE.Float32BufferAttribute(rig, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Lofted tube through elliptical rings. ring: { c, a, b, ra, rb, bone, w, reg (number or fn(angle)), opt, cap }
// caps: [start, end] closes the ends with a slightly domed fan.
function tube(rings, seg, caps = [false, false]) {
  const pos = [], rig = [], idx = [];
  for (const r of rings) {
    for (let k = 0; k < seg; k++) {
      const t = (k / seg) * Math.PI * 2;
      const ca = Math.cos(t) * r.ra, sb = Math.sin(t) * r.rb;
      pos.push(r.c[0] + r.a[0] * ca + r.b[0] * sb, r.c[1] + r.a[1] * ca + r.b[1] * sb, r.c[2] + r.a[2] * ca + r.b[2] * sb);
      rig.push(r.bone, r.w ?? 1, typeof r.reg === 'function' ? r.reg(t) : r.reg, r.opt || 0);
    }
  }
  const n = rings.length;
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = i * seg + k, b = i * seg + ((k + 1) % seg);
      idx.push(a, a + seg, b, b, a + seg, b + seg);
    }
  }
  const sideTris = idx.length / 3;
  const capInfo = [];
  const addCap = (ri, other) => {
    const r = rings[ri], o = rings[other];
    const d = [r.c[0] - o.c[0], r.c[1] - o.c[1], r.c[2] - o.c[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    const out = [d[0] / l, d[1] / l, d[2] / l];
    const ci = pos.length / 3;
    const bulge = r.cap ?? Math.min(r.ra, r.rb) * 0.5;
    pos.push(r.c[0] + out[0] * bulge, r.c[1] + out[1] * bulge, r.c[2] + out[2] * bulge);
    rig.push(r.bone, r.w ?? 1, typeof r.reg === 'function' ? r.reg(Math.PI / 2) : r.reg, r.opt || 0);
    const start = idx.length / 3;
    for (let k = 0; k < seg; k++) idx.push(ri * seg + k, ri * seg + ((k + 1) % seg), ci);
    capInfo.push([start, idx.length / 3, out]);
  };
  if (caps[0]) addCap(0, 1);
  if (caps[1]) addCap(n - 1, n - 2);
  orient(pos, idx, (t, cen) => {
    if (t < sideTris) {
      const ring = Math.floor(idx[t * 3] / seg), c = rings[Math.min(n - 1, ring)].c;
      return [cen[0] - c[0], cen[1] - c[1], cen[2] - c[2]];
    }
    for (const [s, e, out] of capInfo) if (t >= s && t < e) return out;
    return [0, 1, 0];
  });
  return geo(pos, rig, idx);
}

// three.js primitive → our attribute layout (position, normal, aRig)
function prim(g, bone, reg, opt = 0, w = 1) {
  g = g.index ? g : mergeGeometries([g]); // keep indexed
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const n = g.attributes.position.count;
  const rig = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { rig[i * 4] = bone; rig[i * 4 + 1] = w; rig[i * 4 + 2] = reg; rig[i * 4 + 3] = opt; }
  g.setAttribute('aRig', new THREE.BufferAttribute(rig, 4));
  if (!g.index) g.setIndex([...Array(n).keys()]);
  return g;
}

// flat strap through points, w wide, facing away from `axis` (a point on the body's centre line)
function ribbon(pts, w, bone, reg, opt, axis) {
  const pos = [], rig = [], idx = [];
  pts.forEach((p, i) => {
    const q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
    const d = [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
    const out = [p[0] - axis[0], 0, p[2] - axis[2]];
    // side = d × out (lies across the strap, along the body surface)
    let sx = d[1] * out[2] - d[2] * out[1], sy = d[2] * out[0] - d[0] * out[2], sz = d[0] * out[1] - d[1] * out[0];
    const l = Math.hypot(sx, sy, sz) || 1;
    sx *= w / 2 / l; sy *= w / 2 / l; sz *= w / 2 / l;
    pos.push(p[0] - sx, p[1] - sy, p[2] - sz, p[0] + sx, p[1] + sy, p[2] + sz);
    rig.push(bone, 1, reg, opt, bone, 1, reg, opt);
  });
  for (let i = 0; i < pts.length - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  orient(pos, idx, (t, cen) => [cen[0] - axis[0], 0, cen[2] - axis[2]]);
  return geo(pos, rig, idx);
}

// skull shape: jaw tapers and the chin comes forward below the equator, fuller occiput above
function skull(H, y0) {
  let sx = 1, sz = 1, cz = 0;
  if (y0 < 0) { const t = -y0; sx = 1 - 0.3 * t * t; sz = 1 - 0.16 * t * t; cz = 0.012 * t; }
  else { sz = 1 + 0.035 * y0; cz = -0.007 * y0; }
  return { sx, sz, cz };
}

// hair / cap shell: a wavy-rimmed cap over the skull; long = how far it falls below the equator
function shell(H, seg, rows, rimFn, scale, longFn, opt, reg, bone = 4) {
  const pos = [], rig = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j < seg; j++) {
      const phi = (j / seg) * Math.PI * 2; // 0 = front
      const rim = rimFn(phi);
      const len = longFn ? longFn(phi) : 0;
      const u = i / rows;
      let x, y, z;
      // follow the skull down to the rim; long hair stops following it at the equator and
      // hangs straight down from there instead of tucking in under the jaw
      const arcEnd = len > 0 ? Math.min(rim, Math.PI / 2) : rim;
      const total = arcEnd + (len > 0 ? len / H.r[1] : 0);
      const s = Math.min(u * total, arcEnd);
      const y0 = Math.cos(s), k = skull(H, y0);
      x = Math.sin(s) * Math.sin(phi) * H.r[0] * k.sx * scale;
      z = Math.sin(s) * Math.cos(phi) * H.r[2] * k.sz * scale + k.cz;
      y = y0 * H.r[1] * scale;
      if (u * total > arcEnd) {
        const drop = (u * total - arcEnd) * H.r[1];
        const flare = 1 + drop * 0.35;
        x *= flare;
        z = (z - k.cz) * flare + k.cz;
        y -= drop;
      }
      pos.push(H.c[0] + x, H.c[1] + y, H.c[2] + z);
      rig.push(bone, 1, reg, opt);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + ((j + 1) % seg);
      idx.push(a, a + seg, b, b, a + seg, b + seg);
    }
  }
  orient(pos, idx, (t, cen) => [cen[0] - H.c[0], (cen[1] - H.c[1]) * 0.3, cen[2] - H.c[2]]);
  return geo(pos, rig, idx);
}

export function buildHumanGeometry(sex, lod = 0) {
  const D = BODY[sex];
  const J = D.J;
  const near = lod === 0;
  const S = near
    ? { torso: 20, limb: 12, hand: 8, shoe: 10, head: 22, headRows: 16, hair: 22, hairRows: 9 }
    : { torso: 10, limb: 6, hand: 5, shoe: 6, head: 10, headRows: 7, hair: 10, hairRows: 4 };
  const parts = [];

  // ---- torso (pelvis → spine → chest → neck base), trousers below the waistband
  const [c0, c1, c2] = D.cut;
  const torsoRig = (y) => {
    if (y < c0 - 0.04) return [0, 1];
    if (y < c1 - 0.04) return [1, ss(c0 - 0.04, c0 + 0.04, y)];
    if (y < c2 - 0.015) return [2, ss(c1 - 0.04, c1 + 0.04, y)];
    return [3, ss(c2 - 0.015, c2 + 0.03, y)];
  };
  const torsoReg = (y) => (y < D.waist ? R.bottom : y > D.neckline ? R.skin : R.top);
  const stations = near ? D.torso : D.torso.filter((_, i) => i % 2 === 0 || i === D.torso.length - 1);
  parts.push(tube(stations.map(([y, rx, rz, cz]) => {
    const [bone, w] = torsoRig(y);
    return { c: [0, y, cz], a: X, b: Z, ra: rx, rb: rz, bone, w, reg: torsoReg(y), cap: 0.015 };
  }), S.torso, [true, true]));

  // ---- neck
  const H = D.head;
  const nb = J.neck, hp = J.head;
  parts.push(tube([0, 0.35, 0.7, 1].map((t) => {
    const y = lerp(nb[1] - 0.03, hp[1] + 0.05, t);
    return { c: [0, y, lerp(nb[2], hp[2] + 0.004, t)], a: X, b: Z, ra: lerp(D.neckR[0] * 1.08, D.neckR[0], t), rb: lerp(D.neckR[1] * 1.08, D.neckR[1], t), bone: t < 0.9 ? 3 : 4, w: t < 0.9 ? ss(0, 0.45, t) : 0.6, reg: R.skin };
  }), Math.max(8, S.limb)));

  // ---- head: lat-long rings sculpted into a skull with jaw and chin; beard zone on the lower face
  const rows = [];
  for (let i = 1; i < S.headRows; i++) {
    const th = (i / S.headRows) * Math.PI, y0 = Math.cos(th), k = skull(H, y0);
    rows.push({
      c: [H.c[0], H.c[1] + y0 * H.r[1], H.c[2] + k.cz], a: X, b: Z, ra: Math.sin(th) * H.r[0] * k.sx, rb: Math.sin(th) * H.r[2] * k.sz, bone: 4, w: 1,
      reg: (a) => (y0 < -0.12 && y0 > -0.93 && Math.sin(a) > (y0 < -0.6 ? -0.3 : 0.15) ? R.beard : R.skin),
      cap: 0.004,
    });
  }
  rows[0].cap = H.r[1] * (1 - Math.cos(Math.PI / S.headRows)) * 0.9;
  rows[rows.length - 1].cap = H.r[1] * (1 - Math.cos(Math.PI / S.headRows)) * 0.6;
  parts.push(tube(rows, S.head, [true, true]));
  const faceZ = (y) => { const y0 = (y - H.c[1]) / H.r[1]; const k = skull(H, y0); return H.c[2] + k.cz + Math.sqrt(Math.max(0, 1 - y0 * y0)) * H.r[2] * k.sz; };
  if (near) {
    const ey = H.c[1] + H.r[1] * 0.2;
    for (const s of [1, -1]) {
      // eye whites, irises, brows, ears
      const ez = faceZ(ey) - 0.012;
      parts.push(prim(new THREE.SphereGeometry(1, 10, 8).scale(0.0135, 0.0078, 0.008).translate(s * 0.031, ey, ez), 4, R.white));
      parts.push(prim(new THREE.SphereGeometry(1, 8, 6).scale(0.0078, 0.0076, 0.0055).translate(s * 0.031, ey, ez + 0.0055), 4, R.dark));
      parts.push(prim(new THREE.SphereGeometry(1, 8, 4).scale(0.021, 0.0045, 0.006).rotateZ(-s * 0.12).translate(s * 0.032, ey + 0.022, faceZ(ey + 0.022) - 0.002), 4, R.hair));
      parts.push(prim(new THREE.SphereGeometry(1, 8, 6).scale(0.011, 0.028, 0.019).translate(s * H.r[0] * 0.97, H.c[1] + 0.004, H.c[2] - 0.004), 4, R.skin));
    }
    // nose (bridge to tip) and lips
    const nyTop = ey - 0.004, nyTip = H.c[1] - H.r[1] * 0.12;
    parts.push(tube([0, 0.6, 1].map((t) => {
      const y = lerp(nyTop, nyTip, t);
      return { c: [0, y, faceZ(y) - 0.004 + 0.022 * t], a: X, b: Z, ra: lerp(0.006, 0.013, t), rb: lerp(0.008, 0.011, t), bone: 4, w: 1, reg: R.skin, cap: 0.006 };
    }), 7, [false, true]));
    const ly = H.c[1] - H.r[1] * 0.42;
    parts.push(prim(new THREE.SphereGeometry(1, 10, 6).scale(0.02, 0.0068, 0.0085).translate(0, ly, faceZ(ly) - 0.004), 4, R.lip));
    // sunglasses
    parts.push(prim(new RoundedBoxGeometry(0.128, 0.026, 0.01, 2, 0.004).translate(0, ey + 0.002, faceZ(ey) + 0.004), 4, R.dark, OPT.glasses));
  }

  // ---- hair styles and cap
  const front = (phi) => (1 - Math.cos(phi)) / 2; // 0 front .. 1 back
  parts.push(shell(H, S.hair, S.hairRows, (phi) => 1.1 + 0.95 * Math.pow(front(phi), 0.8), 1.07, null, HAIR_ALL, R.hair));
  parts.push(shell(H, S.hair, S.hairRows + 4, (phi) => 1.12 + 1.0 * Math.pow(front(phi), 0.65), 1.075, (phi) => { const f = front(phi); return f < 0.22 ? 0 : 0.06 + 0.24 * Math.pow((f - 0.22) / 0.78, 0.8); }, OPT.hairLong, R.hair));
  parts.push(prim(new THREE.SphereGeometry(near ? 0.047 : 0.045, near ? 12 : 6, near ? 8 : 4).translate(0, H.c[1] + H.r[1] * 0.56, H.c[2] - H.r[2] * 0.95), 4, R.hair, OPT.hairBun));
  parts.push(shell(H, S.hair, S.hairRows, () => 1.28, 1.11, null, OPT.cap, R.accent));
  {
    const by = H.c[1] + H.r[1] * Math.cos(1.28) * 1.11, bz = H.c[2] + H.r[2] * 0.95;
    parts.push(prim(new THREE.CylinderGeometry(0.085, 0.085, 0.008, near ? 16 : 8, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 0.85).rotateX(0.12).translate(0, by - 0.004, bz), 4, R.accent, OPT.cap));
  }

  // ---- arms
  for (const side of [1, -1]) {
    const sh = mirror(J.shoulder, side), el = mirror(J.elbow, side), wr = mirror(J.wrist, side);
    const bU = side > 0 ? 5 : 8;
    const top = [sh[0] - 0.02 * side, sh[1] + 0.012, sh[2]];
    parts.push(tube(D.up.map(([t, ra, rb]) => ({ c: lerp3(top, el, t), a: X, b: Z, ra: ra * (t < 0.2 ? 0.92 : 1), rb, bone: bU, w: ss(0, 0.4, t), reg: t < 0.55 ? R.top : R.forearm, cap: 0.018 })), S.limb, [true, false]));
    parts.push(tube(D.fore.map(([t, ra, rb]) => ({ c: lerp3(el, wr, t), a: X, b: Z, ra, rb, bone: bU + 1, w: ss(0, 0.22, t), reg: R.forearm })), S.limb, [false, false]));
    // hand: thin across x, wide along z, fingers slightly curled forward
    const hs = D.hand;
    parts.push(tube([[0, 0.018, 0.029], [0.25, 0.021, 0.041], [0.55, 0.019, 0.043], [0.8, 0.016, 0.037], [1, 0.011, 0.022]].map(([t, ra, rb]) => ({
      c: [wr[0] + 0.003 * side, wr[1] - 0.17 * hs * t, wr[2] + 0.014 * t * t], a: X, b: Z, ra: ra * hs, rb: rb * hs, bone: bU + 2, w: ss(0, 0.35, t), reg: R.skin, cap: 0.008,
    })), S.hand, [false, true]));
    if (near) {
      parts.push(prim(new THREE.CapsuleGeometry(0.0105 * hs, 0.034 * hs, 3, 6).rotateX(0.5).translate(wr[0] - 0.004 * side, wr[1] - 0.055 * hs, wr[2] + 0.036 * hs), bU + 2, R.skin));
    }
  }

  // ---- legs and shoes
  for (const side of [1, -1]) {
    const hp2 = mirror(J.hip, side), kn = mirror(J.knee, side), an = mirror(J.ankle, side);
    const bT = side > 0 ? 11 : 14;
    const top = [hp2[0] + 0.004 * side, hp2[1] + 0.035, hp2[2]];
    parts.push(tube(D.thigh.map(([t, ra, rb]) => ({ c: lerp3(top, kn, t), a: X, b: Z, ra, rb, bone: bT, w: ss(0, 0.28, t), reg: t < 0.5 ? R.bottom : R.thighLow })), S.limb, [false, false]));
    parts.push(tube(D.shin.map(([t, ra, rb, cz]) => { const c = lerp3(kn, an, t); c[2] += cz; return { c, a: X, b: Z, ra, rb, bone: bT + 1, w: ss(0, 0.2, t), reg: R.shin, cap: 0.01 }; }), S.limb, [false, true]));
    const fs = D.foot;
    parts.push(tube([[-0.07, 0.036, 0.038, 0.006], [-0.035, 0.044, 0.05, 0.004], [0.02, 0.049, 0.045, 0.004], [0.08, 0.05, 0.034, 0.005], [0.13, 0.046, 0.026, 0.007], [0.165, 0.032, 0.019, 0.01]].map(([z, ra, rb, bot]) => ({
      c: [an[0], bot + rb * fs, an[2] + z * fs], a: X, b: Y, ra: ra * fs, rb: rb * fs, bone: bT + 2, w: 1, reg: (a) => (Math.sin(a) < -0.72 ? R.sole : R.shoes), cap: 0.012,
    })), S.shoe, [true, true]));
  }

  // ---- clothing options
  const ring = (y) => { // interpolate the torso outline at height y
    const T = D.torso;
    for (let i = 0; i < T.length - 1; i++) if (y >= T[i][0] && y <= T[i + 1][0]) { const t = (y - T[i][0]) / (T[i + 1][0] - T[i][0]); return [lerp(T[i][1], T[i + 1][1], t), lerp(T[i][2], T[i + 1][2], t), lerp(T[i][3], T[i + 1][3], t)]; }
    return y < T[0][0] ? [T[0][1], T[0][2], T[0][3]] : [T[T.length - 1][1], T[T.length - 1][2], T[T.length - 1][3]];
  };
  {
    // long coat: torso shell that flares over the thighs (pelvis-bound below the waist)
    const ys = [D.neckline + 0.005, D.cut[2] - 0.05, (D.cut[1] + D.cut[2]) / 2, D.cut[1], D.waist + 0.04, D.waist - 0.04, D.waist - 0.12, (D.waist - 0.12 + D.coatBottom) / 2, D.coatBottom];
    parts.push(tube(ys.map((y, i) => {
      const [rx, rz, cz] = ring(Math.max(y, D.torso[1][0]));
      const below = Math.max(0, D.waist - 0.04 - y);
      const [bone, w] = torsoRig(y);
      return { c: [0, y, cz - 0.004], a: X, b: Z, ra: (rx + 0.016 + below * 0.22) * (i === 0 ? 0.92 : 1), rb: rz + 0.02 + below * 0.14, bone: y < c0 - 0.04 ? 0 : bone, w: y < c0 - 0.04 ? 1 : w, reg: R.top, opt: OPT.coat };
    }), S.torso, [false, false]));
    // A-line skirt to the knee
    const kneeY = J.knee[1] + 0.05;
    parts.push(tube([[D.waist + 0.01, 0.006, 0.006], [D.torso[2][0], 0.014, 0.016], [lerp(D.torso[1][0], kneeY, 0.45), 0.045, 0.05], [kneeY, 0.08, 0.075]].map(([y, ex, ez]) => {
      const [rx, rz, cz] = ring(Math.max(y, D.torso[2][0]));
      return { c: [0, y, cz], a: X, b: Z, ra: rx + ex, rb: rz + ez, bone: 0, w: 1, reg: R.bottom, opt: OPT.skirt };
    }), S.torso, [false, false]));
  }
  {
    // backpack with shoulder straps
    const ch = J.chest;
    const [rx, rz, cz] = ring(ch[1] + 0.08);
    parts.push(prim(new RoundedBoxGeometry(0.27, 0.36, 0.13, near ? 2 : 1, 0.04).translate(0, ch[1] + 0.07, cz - rz - 0.06), 2, R.accent, OPT.backpack));
    const fz = (y, add = 0.006) => { const [, rzz, czz] = ring(y); return czz + rzz + add; };
    const bz = (y, add = 0.006) => { const [, rzz, czz] = ring(y); return czz - rzz - add; };
    if (near) {
      // straps: from the top of the pack, over the shoulder, down the chest
      const sy = J.shoulder[1];
      for (const s of [1, -1]) {
        parts.push(ribbon([
          [s * 0.085, ch[1] + 0.22, bz(ch[1] + 0.22, 0.03)], [s * 0.09, sy + 0.02, -0.05], [s * 0.095, sy + 0.035, 0.0],
          [s * 0.098, sy - 0.02, fz(sy - 0.02)], [s * 0.1, ch[1] + 0.12, fz(ch[1] + 0.12)], [s * 0.115, ch[1] - 0.02, fz(ch[1] - 0.02)],
        ], 0.036, 2, R.accent, OPT.backpack, [0, 0, cz]));
      }
    }
    // shoulder bag at the right hip, strap across the chest from the left shoulder
    const [hx] = ring(D.waist - 0.06);
    parts.push(prim(new RoundedBoxGeometry(0.075, 0.19, 0.24, near ? 2 : 1, 0.025).translate(-(hx + 0.045), D.waist - 0.08, 0.02), 0, R.accent, OPT.bag));
    if (near) {
      // cross-body strap: left shoulder → across the chest → right hip
      const sy = J.shoulder[1], steps = 6, pts = [[0.11, sy + 0.03, -0.03], [0.1, sy + 0.035, 0.01]];
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, y = lerp(sy - 0.01, D.waist + 0.02, t), x = lerp(0.09, -(hx + 0.01), t);
        const [rx2, rz2, cz2] = ring(y);
        const edge = Math.abs(x) / (rx2 + 0.01);
        pts.push([x, y, cz2 + rz2 * Math.sqrt(Math.max(0.05, 1 - edge * edge)) + 0.007]);
      }
      parts.push(ribbon(pts, 0.026, 2, R.accent, OPT.bag, [0, 0, 0]));
    }
    // phone in the right hand (dark slab with a lit screen facing the palm side)
    const wr = mirror(J.wrist, -1);
    parts.push(prim(new RoundedBoxGeometry(0.012, 0.14, 0.072, 1, 0.004).translate(wr[0] + 0.024, wr[1] - 0.09, wr[2] + 0.02), 10, R.phone, OPT.phone));
    if (near) parts.push(prim(new THREE.BoxGeometry(0.002, 0.12, 0.06).translate(wr[0] + 0.0315, wr[1] - 0.09, wr[2] + 0.02), 10, R.white, OPT.phone));
  }

  const g = mergeGeometries(parts);
  g.computeBoundingSphere();
  return g;
}

// joint pivots (rest pose) in shader bone order
export function jointArray(sex) {
  const J = BODY[sex].J;
  const V = (p, s = 1) => new THREE.Vector3(p[0] * s, p[1], p[2]);
  return [V(J.pelvis), V(J.spine), V(J.chest), V(J.neck), V(J.head), V(J.shoulder), V(J.elbow), V(J.wrist), V(J.shoulder, -1), V(J.elbow, -1), V(J.wrist, -1), V(J.hip), V(J.knee), V(J.ankle), V(J.hip, -1), V(J.knee, -1), V(J.ankle, -1)];
}

// ---------------------------------------------------------------------------------------
// Vertex-shader rig. Per-instance attributes:
//   iPH   x, y, z, heading          iBody height scale, width scale, flags, lean (forward tilt)
//   iAnim gait phase, walk 0..1, run 0..1, seed   iPose wave, celebrate, phone, dive
//   iSkin / iTop / iBottom / iHair / iAccent / iShoes (linear RGB)
// ---------------------------------------------------------------------------------------
const VERT = /* glsl */ `
attribute vec4 aRig;
attribute vec4 iPH;
attribute vec4 iBody;
attribute vec4 iAnim;
attribute vec4 iPose;
attribute vec3 iSkin;
attribute vec3 iTop;
attribute vec3 iBottom;
attribute vec3 iHair;
attribute vec3 iAccent;
attribute vec3 iShoes;
uniform float uTime;
uniform vec3 uJ[17];
varying vec3 vHumanCol;
varying float vHumanRough;
// per-vertex copies of the instance's pose parameters (cheap scalars; rotations are built
// only for the joints on this vertex's own chain)
float hS, hC, hWalk, hRun, hPh, hT, hWave, hCele, hPhone, hDive, hShift, hBreathe;
vec3 hPelvisOff;

mat3 hRX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 hRY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 hRZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

int hParent(int b) {
  if (b <= 0) return -1;
  if (b <= 4) return b - 1;
  if (b == 5 || b == 8) return 2;
  if (b <= 10) return b - 1;
  if (b == 11 || b == 14) return 0;
  return b - 1;
}

void humanParams() {
  hPh = iAnim.x; hWalk = iAnim.y; hRun = iAnim.z;
  hWave = iPose.x; hCele = iPose.y; hPhone = iPose.z; hDive = iPose.w;
  hS = sin(hPh); hC = cos(hPh);
  hT = uTime + iAnim.w * 37.0;
  hShift = (1.0 - hWalk) * 0.035 * sin(hT * 0.45);   // idle weight shift
  hBreathe = 0.014 * sin(hT * 1.6);
  hPelvisOff = vec3(hShift * 0.6, hWalk * (0.018 + 0.028 * hRun) * (0.5 + 0.5 * cos(2.0 * hPh)) - 0.012 * hRun - 0.008 * hWalk, 0.0);
}

// arm: x = forward swing, y = elbow bend, z = raise sideways (wave / celebrate / dive / phone)
vec3 hArm(bool left) {
  float am = (0.36 + 0.32 * hRun) * hWalk;
  float a = left ? -am * hS : am * hS;
  float e = 0.16 + 0.4 * max(0.0, a) + 1.0 * hRun;
  float ab = 0.07 + 0.03 * hBreathe;
  if (!left) {
    a = mix(a, 0.42, hPhone); e = mix(e, 1.8, hPhone); ab = mix(ab, 0.14, hPhone);
    float wv = sin(hT * 9.0);
    a = mix(a, 0.3, hWave); ab = mix(ab, 2.45, hWave); e = mix(e, 0.5 + 0.45 * wv * hWave, hWave);
  }
  float shk = 0.22 * sin(hT * 13.0) * (left ? 1.0 : -1.0);
  a = mix(a, 0.2, hCele); ab = mix(ab, 2.7 + shk, hCele); e = mix(e, 0.3, hCele);
  a = mix(a, 2.85, hDive); e = mix(e, 0.12, hDive);
  return vec3(a, e, ab);
}

// leg: x = hip swing, y = knee bend, z = ankle roll
vec3 hLeg(bool left) {
  float ph = left ? hPh : hPh + 3.14159265;
  float sw = sin(ph);
  float th = (0.4 + 0.22 * hRun) * hWalk * sw;
  float kn = 0.04 + (0.95 + 0.55 * hRun) * hWalk * pow(max(0.0, sin(ph + 1.25)), 1.6) + 0.1 * hWalk * max(0.0, -sin(ph - 0.4));
  float an = hWalk * 0.3 * sin(ph - 0.7);
  th = mix(th, left ? -0.25 : -0.12, hDive);
  kn = mix(kn, left ? 0.3 : 0.15, hDive);
  return vec3(th, kn, an);
}

mat3 boneRot(int b) {
  if (b == 0) return hRY(-0.11 * hS * hWalk) * hRZ(0.045 * hC * hWalk + hShift);
  if (b == 1) return hRX(0.03 * hWalk + 0.12 * hRun) * hRZ(-0.025 * hC * hWalk - hShift * 0.7);
  if (b == 2) return hRY(0.24 * hS * hWalk) * hRX(hBreathe + 0.03 * hRun);
  if (b == 3) return hRX(-0.02 * hWalk + hPhone * 0.22);
  if (b == 4) {
    float look = (1.0 - hWalk) * (1.0 - hPhone) * 0.35 * sin(hT * 0.23);
    return hRY(-0.12 * hS * hWalk + look) * hRX(hPhone * 0.32 - 0.04 * hWalk);
  }
  if (b == 5) { vec3 a = hArm(true); return hRZ(a.z) * hRX(-a.x); }
  if (b == 6) return hRX(-hArm(true).y);
  if (b == 7) return hRX(-0.08 * hWalk) * hRZ(0.05);
  if (b == 8) { vec3 a = hArm(false); return hRZ(-a.z) * hRX(-a.x); }
  if (b == 9) return hRX(-hArm(false).y);
  if (b == 10) return hRY(-hPhone * 0.9) * hRX(-0.08 * hWalk) * hRZ(-0.05);
  if (b == 11) return hRX(-hLeg(true).x) * hRZ(0.02);
  if (b == 12) return hRX(hLeg(true).y);
  if (b == 13) return hRX(-hLeg(true).z);
  if (b == 14) return hRX(-hLeg(false).x) * hRZ(-0.02);
  if (b == 15) return hRX(hLeg(false).y);
  return hRX(-hLeg(false).z);
}

void hChain(int b, inout vec3 p, inout vec3 n) {
  for (int i = 0; i < 7; i++) {
    if (b < 0) break;
    vec3 jp = uJ[b];
    mat3 rb = boneRot(b);
    p = rb * (p - jp) + jp;
    n = rb * n;
    if (b == 0) p += hPelvisOff;
    b = hParent(b);
  }
}

void humanSkin(out vec3 pos, out vec3 nrm) {
  humanParams();
  int b = int(aRig.x + 0.5);
  float w = aRig.y;
  vec3 p = position, n = normal;
  hChain(b, p, n);
  if (w < 0.999) {
    vec3 p2 = position, n2 = normal;
    hChain(hParent(b), p2, n2);
    p = mix(p2, p, w);
    n = normalize(mix(n2, n, w));
  }
  int opt = int(aRig.w + 0.5);
  int flags = int(iBody.z + 0.5);
  if (opt != 0 && (opt & flags) == 0) p = vec3(0.0, -80.0, 0.0);
  p *= vec3(iBody.y, 1.0, iBody.y) * iBody.x;
  mat3 m = hRY(iPH.w) * hRX(iBody.w);
  pos = m * p + iPH.xyz;
  nrm = m * n;
}

void humanColor() {
  int reg = int(aRig.z + 0.5);
  int flags = int(iBody.z + 0.5);
  vec3 col = iSkin;
  float rough = 0.55;
  if (reg == 1) { col = iTop; rough = 0.85; }
  else if (reg == 2) { col = iBottom; rough = 0.88; }
  else if (reg == 3) { col = iShoes; rough = 0.5; }
  else if (reg == 4) { col = iHair; rough = 0.62; }
  else if (reg == 5) { col = iAccent; rough = 0.72; }
  else if (reg == 6) { col = vec3(0.018, 0.016, 0.015); rough = 0.18; }
  else if (reg == 7) { col = iSkin * vec3(0.8, 0.56, 0.55); rough = 0.4; }
  else if (reg == 8) { col = mix(iShoes, vec3(0.86), 0.7); rough = 0.85; }
  else if (reg == 9) { if ((flags & 1024) != 0) { col = iTop; rough = 0.85; } }
  else if (reg == 10) { if ((flags & 2048) == 0) { col = iBottom; rough = 0.88; } }
  else if (reg == 11) { if ((flags & 8192) != 0) { col = iHair * 0.9; rough = 0.75; } }
  else if (reg == 12) { col = vec3(0.03, 0.033, 0.038); rough = 0.25; }
  else if (reg == 13) { if ((flags & 4096) == 0) { col = iBottom; rough = 0.88; } }
  else if (reg == 14) { col = vec3(0.62, 0.6, 0.57); rough = 0.3; }
  vHumanCol = col;
  vHumanRough = rough;
}
`;

// Materials for one body type: the lit crowd material and its shadow-depth twin.
export function humanMaterials(sex) {
  const uniforms = { uTime: { value: 0 }, uJ: { value: jointArray(sex) } };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT}`)
      .replace('#include <beginnormal_vertex>', 'vec3 hPos; vec3 objectNormal; humanSkin(hPos, objectNormal); humanColor();')
      .replace('#include <begin_vertex>', 'vec3 transformed = hPos;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHumanCol;\nvarying float vHumanRough;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vHumanCol;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vHumanRough;');
  };
  mat.customProgramCacheKey = () => 'human-crowd-v1';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT}`)
      .replace('#include <begin_vertex>', 'vec3 hPos; vec3 hN; humanSkin(hPos, hN); vec3 transformed = hPos;');
  };
  depth.customProgramCacheKey = () => 'human-crowd-depth-v1';
  return { mat, depth, uniforms };
}
