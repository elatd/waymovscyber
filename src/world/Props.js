// Instanced street furniture: lights, trees, palms, signals, breakables (hydrants, meters,
// trash cans, newspaper boxes, mailboxes, benches, cones), barriers, pier pilings,
// Chinatown lanterns and Lombard's hedges. Breakables fly when hit; poles and trees topple
// over on the first solid hit (and stop blocking); everything respawns out of sight.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundHeight, PIER_H, SEABED } from './CityLayout.js';
import { mulberry32 } from '../core/math.js';
import { makeBlobTexture } from './Textures.js';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpE = new THREE.Euler();
const tmpA = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpQ2 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

// ---- geometry helpers (all non-indexed, position+normal+color) ----
function col(g, hex, mul = 1) {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) { a[k * 3] = c.r * mul; a[k * 3 + 1] = c.g * mul; a[k * 3 + 2] = c.b * mul; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function prep(g) {
  let ng = g.index ? g.toNonIndexed() : g;
  if (ng.attributes.uv) ng.deleteAttribute('uv');
  if (ng.attributes.uv1) ng.deleteAttribute('uv1');
  if (!ng.attributes.normal) ng.computeVertexNormals();
  return ng;
}
const P = (g, hex, mul) => col(prep(g), hex, mul);
const cyl = (rt, rb, h, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const merge = (arr) => mergeGeometries(arr);

function streetlightGeo() {
  const pole = P(cyl(0.08, 0.12, 8.6, 8).translate(0, 4.3, 0), '#4d5a57');
  const base = P(cyl(0.2, 0.24, 0.5, 8).translate(0, 0.25, 0), '#3e4846');
  // arm reaching over the road (+z local = toward road)
  const arm = P(cyl(0.05, 0.05, 2.3, 6).rotateX(Math.PI / 2).translate(0, 8.45, 1.1), '#4d5a57');
  const head = P(box(0.34, 0.16, 0.75).translate(0, 8.42, 2.35), '#5c6764');
  return merge([pole, base, arm, head]);
}
function streetlightLensGeo() {
  return P(box(0.26, 0.04, 0.6).translate(0, 8.33, 2.35), '#ffffff');
}
function treeGeo(seed = 1, palette = ['#3f8f3a', '#4fa34a', '#2f7a33']) {
  const rng = mulberry32(seed);
  const parts = [P(cyl(0.12, 0.2, 2.8, 7).translate(0, 1.4, 0), '#6b4a32')];
  const n = 4;
  for (let k = 0; k < n; k++) {
    const r = 1.1 + rng() * 0.7;
    const g = new THREE.IcosahedronGeometry(r, 1);
    const pos = g.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const s = 1 + (rng() - 0.5) * 0.25;
      pos.setXYZ(v, pos.getX(v) * s, pos.getY(v) * s * 0.85, pos.getZ(v) * s);
    }
    g.computeVertexNormals();
    const a = (k / n) * Math.PI * 2;
    g.translate(Math.cos(a) * 0.8 * (k ? 1 : 0), 3.6 + rng() * 1.1 + (k ? 0 : 0.9), Math.sin(a) * 0.8 * (k ? 1 : 0));
    parts.push(P(g, palette[k % palette.length], 0.9 + rng() * 0.2));
  }
  return merge(parts);
}
function cypressGeo() {
  const trunk = P(cyl(0.18, 0.28, 3, 7).translate(0, 1.5, 0), '#5d4330');
  const c1 = P(new THREE.ConeGeometry(2.2, 6.5, 9).translate(0, 5.6, 0), '#2e6b35');
  const c2 = P(new THREE.ConeGeometry(1.7, 4.5, 9).translate(0.3, 8.2, 0.2), '#357a3c');
  return merge([trunk, c1, c2]);
}
function palmGeo() {
  const parts = [];
  // curved trunk from stacked segments
  let x = 0, y = 0;
  const segs = 9, h = 9.5;
  for (let k = 0; k < segs; k++) {
    const r0 = 0.24 - k * 0.012, r1 = 0.24 - (k + 1) * 0.012;
    const g = cyl(r1, r0, h / segs + 0.05, 7);
    const lean = Math.pow(k / segs, 2) * 0.9;
    g.translate(x + lean, y + h / segs / 2, 0);
    parts.push(P(g, k % 2 ? '#8a6e4e' : '#7a5f42'));
    y += h / segs;
  }
  const topX = 0.9;
  // fronds
  const nF = 9;
  for (let k = 0; k < nF; k++) {
    const a = (k / nF) * Math.PI * 2;
    const leaf = new THREE.BufferGeometry();
    const L = 3.6, W = 0.55;
    const verts = [];
    const steps = 6;
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps, t1 = (s + 1) / steps;
      const y0 = Math.sin(t0 * 1.8) * 0.9 - t0 * t0 * 2.2, y1 = Math.sin(t1 * 1.8) * 0.9 - t1 * t1 * 2.2;
      const w0 = W * Math.sin(Math.PI * Math.min(1, t0 + 0.08)), w1 = W * Math.sin(Math.PI * Math.min(1, t1 + 0.08));
      const x0 = t0 * L, x1 = t1 * L;
      verts.push(x0, y0, -w0, x1, y1, -w1, x1, y1 + 0.05, 0, x0, y0, -w0, x1, y1 + 0.05, 0, x0, y0 + 0.05, 0);
      verts.push(x0, y0 + 0.05, 0, x1, y1 + 0.05, 0, x1, y1, w1, x0, y0 + 0.05, 0, x1, y1, w1, x0, y0, w0);
    }
    leaf.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    leaf.computeVertexNormals();
    leaf.rotateY(a);
    leaf.translate(topX, h, 0);
    parts.push(col(leaf, k % 2 ? '#3d8b3a' : '#4c9e3f'));
    // backside
    const back = leaf.clone();
    const idx = back.attributes.position;
    const arr = idx.array;
    for (let t = 0; t < arr.length; t += 9) {
      for (let c = 0; c < 3; c++) { const tmp = arr[t + 3 + c]; arr[t + 3 + c] = arr[t + 6 + c]; arr[t + 6 + c] = tmp; }
    }
    back.computeVertexNormals();
    parts.push(col(back, '#36803a'));
  }
  parts.push(P(new THREE.SphereGeometry(0.42, 8, 6).translate(topX, h - 0.1, 0), '#6d5a3a'));
  return merge(parts);
}
function hydrantGeo() {
  return merge([
    P(cyl(0.16, 0.18, 0.62, 10).translate(0, 0.31, 0), '#f2f2ee'),
    P(cyl(0.2, 0.2, 0.06, 10).translate(0, 0.05, 0), '#f2f2ee'),
    P(new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.62, 0), '#2b6cd6'),
    P(cyl(0.07, 0.07, 0.5, 8).rotateZ(Math.PI / 2).translate(0, 0.45, 0), '#f2f2ee'),
    P(cyl(0.08, 0.08, 0.14, 8).rotateX(Math.PI / 2).translate(0, 0.45, 0.14), '#2b6cd6'),
  ]);
}
function meterGeo() {
  return merge([
    P(cyl(0.035, 0.04, 1.15, 6).translate(0, 0.57, 0), '#5d6166'),
    P(box(0.2, 0.3, 0.16).translate(0, 1.27, 0), '#3f4448'),
    P(box(0.14, 0.12, 0.02).translate(0, 1.32, 0.085), '#c9d6df'),
  ]);
}
function trashGeo() {
  return merge([
    P(cyl(0.34, 0.3, 0.95, 12).translate(0, 0.48, 0), '#2e6b3f'),
    P(new THREE.SphereGeometry(0.35, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1).translate(0, 0.95, 0), '#2a5f39'),
    P(box(0.25, 0.08, 0.05).translate(0, 0.95, 0.31), '#1c2b22'),
  ]);
}
function newsGeo() {
  const c = ['#d63031', '#0984e3', '#fdcb6e', '#00b894'];
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const x = (k - 1) * 0.55;
    parts.push(P(box(0.48, 0.9, 0.45).translate(x, 0.65, 0), c[k]));
    parts.push(P(cyl(0.03, 0.03, 0.2, 5).translate(x, 0.1, 0), '#333'));
    parts.push(P(box(0.36, 0.3, 0.02).translate(x, 0.82, 0.23), '#dfe6e9'));
  }
  return merge(parts);
}
function mailboxGeo() {
  return merge([
    P(box(0.5, 0.9, 0.55).translate(0, 0.65, 0), '#1f4fa8'),
    P(cyl(0.25, 0.25, 0.55, 10, 1).rotateX(Math.PI / 2).scale(1, 0.6, 1).translate(0, 1.1, 0), '#1f4fa8'),
    P(box(0.1, 0.25, 0.5).translate(-0.2, 0.1, 0), '#1b3f86'),
    P(box(0.1, 0.25, 0.5).translate(0.2, 0.1, 0), '#1b3f86'),
  ]);
}
function benchGeo() {
  const parts = [];
  for (let k = 0; k < 3; k++) parts.push(P(box(1.8, 0.05, 0.13).translate(0, 0.46, -0.18 + k * 0.17), '#8a5a35'));
  for (let k = 0; k < 2; k++) parts.push(P(box(1.8, 0.12, 0.05).translate(0, 0.62 + k * 0.17, -0.3), '#8a5a35'));
  for (const x of [-0.75, 0.75]) {
    parts.push(P(box(0.06, 0.46, 0.5).translate(x, 0.23, 0), '#2d3436'));
    parts.push(P(box(0.06, 0.5, 0.06).translate(x, 0.65, -0.3), '#2d3436'));
  }
  return merge(parts);
}
function coneGeo() {
  return merge([
    P(new THREE.ConeGeometry(0.2, 0.7, 10).translate(0, 0.37, 0), '#ff6b1a'),
    P(cyl(0.125, 0.15, 0.12, 10).translate(0, 0.4, 0), '#ffffff'),
    P(box(0.42, 0.04, 0.42).translate(0, 0.02, 0), '#ff6b1a'),
  ]);
}
function barrierGeo() {
  // jersey barrier with an orange/white stripe board
  const shape = new THREE.Shape([new THREE.Vector2(-0.3, 0), new THREE.Vector2(0.3, 0), new THREE.Vector2(0.12, 0.3), new THREE.Vector2(0.09, 0.82), new THREE.Vector2(-0.09, 0.82), new THREE.Vector2(-0.12, 0.3)]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 3.0, bevelEnabled: false }).translate(0, 0, -1.5);
  const parts = [P(g, '#cfcac0')];
  for (let k = 0; k < 4; k++) parts.push(P(box(0.04, 0.22, 0.7).translate(0.1, 0.65, -1.2 + k * 0.8), k % 2 ? '#ffffff' : '#ff6b1a'));
  parts.push(P(box(0.04, 0.22, 0.7).translate(0.1, 0.65, 1.3), '#ffffff'));
  return merge(parts);
}
function signalGeo() {
  // pole at origin; mast arm reaches toward -x local (over the road); head faces +z local
  return merge([
    P(cyl(0.12, 0.15, 6.4, 8).translate(0, 3.2, 0), '#3b3f43'),
    P(cyl(0.06, 0.08, 4.4, 6).rotateZ(Math.PI / 2).translate(-2.2, 6.1, 0), '#3b3f43'),
    P(box(0.42, 1.25, 0.32).translate(-3.9, 5.45, 0), '#2a2d30'),
    P(box(0.6, 1.45, 0.04).translate(-3.9, 5.45, -0.17), '#1c1e20'),
    // street name sign
    P(box(1.6, 0.32, 0.03).translate(-1.4, 6.55, 0), '#1e7d4a'),
    P(box(1.5, 0.08, 0.035).translate(-1.4, 6.55, 0.002), '#f2f2f2', 0.9),
  ]);
}
function lampGeo() {
  return P(new THREE.CircleGeometry(0.13, 12), '#ffffff');
}
function pilingGeo() {
  return P(cyl(0.28, 0.32, PIER_H - SEABED + 0.4, 7).translate(0, (PIER_H + SEABED) / 2, 0), '#4a3a2c');
}
function bollardGeo() {
  return merge([P(cyl(0.18, 0.22, 0.55, 8).translate(0, 0.27, 0), '#22262a'), P(new THREE.SphereGeometry(0.2, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.55, 0), '#22262a')]);
}
function lanternGeo() {
  return merge([
    P(new THREE.SphereGeometry(0.42, 10, 8).scale(1, 1.15, 1), '#e8231c'),
    P(cyl(0.2, 0.2, 0.12, 8).translate(0, 0.5, 0), '#f4c430'),
    P(cyl(0.2, 0.2, 0.12, 8).translate(0, -0.5, 0), '#f4c430'),
    P(cyl(0.03, 0.03, 0.5, 4).translate(0, -0.8, 0), '#f4c430'),
  ]);
}
function flowerGeo() {
  return P(new THREE.IcosahedronGeometry(0.32, 0), '#ffffff');
}

// ---------------------------------------------------------------------------
export class Props {
  constructor(city, scene, collision) {
    this.city = city;
    this.scene = scene;
    this.collision = collision;
    this.group = new THREE.Group();
    this.group.name = 'props';
    scene.add(this.group);
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 });
    this.foliage = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true });
    this.lensMat = new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: '#ffe2a8', emissiveIntensity: 0.2, roughness: 0.3 });
    this.lensMat.userData.nightIntensity = 3.2;
    this.lanternMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: '#ff3a1a', emissiveIntensity: 0.15 });
    this.lanternMat.userData.nightIntensity = 1.8;
    this.nightMaterials = [this.lensMat, this.lanternMat];
    this.breakables = [];
    this.flying = [];
    this.knockables = [];
    this.toppling = [];
    this.onTopple = null; // (rec) when a toppled pole / tree hits the ground
    this.meshes = {};
    this.signalLamps = null;
    this.time = 0;
  }

  build() {
    const S = this.city.spots;
    const rng = mulberry32(77);
    const add = (name, geo, list, mat, opts = {}) => {
      if (!list.length) return null;
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      m.name = name;
      m.castShadow = opts.shadow !== false;
      m.receiveShadow = true;
      for (let k = 0; k < list.length; k++) {
        const p = list[k];
        const s = p.s || 1;
        tmpE.set(0, p.rot ?? 0, 0);
        tmpQ.setFromEuler(tmpE);
        tmpS.set(s, s, s);
        tmpP.set(p.x, p.y ?? groundHeight(p.x, p.z), p.z);
        tmpM.compose(tmpP, tmpQ, tmpS);
        m.setMatrixAt(k, tmpM);
        if (opts.colors) m.setColorAt(k, opts.colors(k, p));
      }
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
      this.group.add(m);
      this.meshes[name] = m;
      return m;
    };
    // streetlights (pole facing the road: local +z points to road)
    add('lights', streetlightGeo(), S.lights, this.mat);
    add('lightLens', streetlightLensGeo(), S.lights, this.lensMat, { shadow: false });
    // warm pools of light on the ground under each lamp (night only)
    {
      const pg = new THREE.PlaneGeometry(1, 1);
      pg.rotateX(-Math.PI / 2);
      this.poolMat = new THREE.MeshBasicMaterial({ map: makeBlobTexture(0.0, '255,214,150'), color: new THREE.Color(1.6, 1.15, 0.7), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 });
      const pm = new THREE.InstancedMesh(pg, this.poolMat, S.lights.length);
      pm.renderOrder = 3;
      S.lights.forEach((p, k) => {
        const sx = Math.sin(p.rot) * 2.3, sz = Math.cos(p.rot) * 2.3;
        const x = p.x + sx, z = p.z + sz;
        tmpP.set(x, groundHeight(x, z) + 0.06, z);
        tmpQ.identity();
        tmpS.set(15, 1, 15);
        tmpM.compose(tmpP, tmpQ, tmpS);
        pm.setMatrixAt(k, tmpM);
      });
      pm.instanceMatrix.needsUpdate = true;
      pm.computeBoundingSphere();
      pm.visible = false;
      this.group.add(pm);
      this.pools = pm;
    }
    // trees
    const greens = [new THREE.Color('#ffffff'), new THREE.Color('#e8ffd8'), new THREE.Color('#d0f0c0'), new THREE.Color('#f4ffe0')];
    add('trees', treeGeo(3), S.trees, this.foliage, { colors: () => greens[Math.floor(rng() * greens.length)] });
    const round = S.parkTrees.filter((t) => t.kind !== 'cypress').map((t) => ({ ...t, s: (t.s || 1) * 1.45 }));
    const cyp = S.parkTrees.filter((t) => t.kind === 'cypress');
    add('parkTrees', treeGeo(9, ['#3b8a3e', '#57a845', '#2c7034']), round, this.foliage, { colors: () => greens[Math.floor(rng() * greens.length)] });
    add('cypress', cypressGeo(), cyp, this.foliage);
    const palms = S.palms.map((p) => ({ ...p, rot: rng() * Math.PI * 2 }));
    add('palms', palmGeo(), palms, this.foliage);
    // signals: pole on the corner, arm over the approach lanes
    const sig = S.signals.map((p) => {
      // NE(+x,-z) & SW(-x,+z) serve N-S traffic; SE(+x,+z) & NW(-x,-z) serve E-W traffic
      let rot;
      if (p.sx > 0 && p.sz < 0) rot = 0; // head faces +z (south), arm toward -x
      else if (p.sx < 0 && p.sz > 0) rot = Math.PI; // faces -z, arm toward +x
      else if (p.sx > 0 && p.sz > 0) rot = -Math.PI / 2; // faces -x, arm toward -z
      else rot = Math.PI / 2; // faces +x, arm toward +z
      return { ...p, rot, axis: (p.sx > 0) === (p.sz < 0) ? 'NS' : 'EW' };
    });
    this.signals = sig;
    add('signals', signalGeo(), sig, this.mat);
    this.buildSignalLamps(sig);
    // poles and trees: solid until the first real hit, then they topple and let the car through
    const M = this.meshes;
    this.addKnockables([M.lights, M.lightLens], S.lights, 0.22, 9, 'pole', (p, k) => ({ pool: k }));
    this.addKnockables([M.signals], sig, 0.25, 7, 'pole', (p, k) => ({ sig: k }));
    this.addKnockables([M.trees], S.trees, 0.3, 8, 'tree');
    this.addKnockables([M.parkTrees], round, 0.45, 10, 'tree');
    this.addKnockables([M.cypress], cyp, 0.45, 10, 'tree');
    this.addKnockables([M.palms], palms, 0.3, 10, 'tree');
    // breakables
    const brk = [
      ['hydrants', hydrantGeo(), S.hydrants, 0.3, 'metal'],
      ['meters', meterGeo(), S.meters, 0.15, 'metal'],
      ['trash', trashGeo(), S.trash, 0.38, 'plastic'],
      ['news', newsGeo(), S.news, 0.75, 'metal'],
      ['mailboxes', mailboxGeo(), S.mailboxes, 0.4, 'metal'],
      ['benches', benchGeo(), S.benches, 0.9, 'wood'],
      ['cones', coneGeo(), S.cones, 0.25, 'plastic'],
    ];
    for (const [name, geo, list, r, material] of brk) {
      const m = add(name, geo, list, this.mat);
      if (!m) continue;
      list.forEach((p, k) => {
        const rec = { mesh: m, index: k, name, x: p.x, y: p.y ?? groundHeight(p.x, p.z), z: p.z, rot: p.rot ?? 0, s: p.s || 1, material, state: 'idle', t: 0 };
        rec.collider = this.collision.addCircle(p.x, p.z, r, rec.y - 1, rec.y + 1.6, 'prop', { breakable: true, rec });
        this.breakables.push(rec);
      });
    }
    // barriers (solid)
    add('barriers', barrierGeo(), S.barriers, this.mat);
    // pier pilings & bollards (visual)
    add('pilings', pilingGeo(), S.pilings.map((p) => ({ ...p, y: 0 })), this.mat, { shadow: false });
    add('bollards', bollardGeo(), S.bollards, this.mat);
    // Chinatown lanterns on strings across Grant Ave
    const lanterns = [];
    const strings = [];
    for (const s of S.lanterns) {
      const n = 6;
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const x = s.x0 + (s.x1 - s.x0) * t;
        const sag = Math.sin(t * Math.PI) * 1.2;
        lanterns.push({ x, y: s.y - sag - 0.9, z: s.z, s: 0.8 + rng() * 0.25 });
      }
      strings.push(s);
    }
    add('lanterns', lanternGeo(), lanterns, this.lanternMat, { shadow: false });
    if (strings.length) {
      const segs = [];
      for (const s of strings) {
        for (let k = 0; k < 12; k++) {
          const t0 = k / 12, t1 = (k + 1) / 12;
          const x0 = s.x0 + (s.x1 - s.x0) * t0, x1 = s.x0 + (s.x1 - s.x0) * t1;
          const y0 = s.y - Math.sin(t0 * Math.PI) * 1.2, y1 = s.y - Math.sin(t1 * Math.PI) * 1.2;
          const len = Math.hypot(x1 - x0, y1 - y0);
          const g = new THREE.CylinderGeometry(0.02, 0.02, len, 3);
          g.rotateZ(Math.PI / 2 + Math.atan2(y1 - y0, x1 - x0));
          g.translate((x0 + x1) / 2, (y0 + y1) / 2, s.z);
          segs.push(P(g, '#222'));
        }
      }
      const sm = new THREE.Mesh(merge(segs), this.mat);
      this.group.add(sm);
    }
    // Lombard hedges + flowers
    if (S.hedges.length) {
      const hedges = [];
      for (const h of S.hedges) {
        const cx = (h.x0 + h.x1) / 2, cz = (h.z0 + h.z1) / 2;
        const y = groundHeight(cx, cz);
        const g = new THREE.BoxGeometry(h.x1 - h.x0, 1.0, h.z1 - h.z0, 2, 1, 4);
        g.translate(cx, y + 0.5, cz);
        hedges.push(P(g, '#2f7d32'));
      }
      const hm = new THREE.Mesh(merge(hedges), this.foliage);
      hm.castShadow = hm.receiveShadow = true;
      this.group.add(hm);
      const fcols = [new THREE.Color('#ff4f8b'), new THREE.Color('#ff2e4d'), new THREE.Color('#c86bff'), new THREE.Color('#ffd34f'), new THREE.Color('#ff7ab8')];
      add('flowers', flowerGeo(), S.flowers.map((f) => ({ ...f, y: f.y + 1.0, s: 0.7 + rng() * 0.6 })), this.foliage, { colors: () => fcols[Math.floor(rng() * fcols.length)], shadow: false });
    }
  }

  buildSignalLamps(sig) {
    // three lamps per head: red (top), yellow, green (bottom); colors updated each phase change
    const geo = lampGeo();
    const n = sig.length * 3;
    const m = new THREE.InstancedMesh(geo, this.glowMat, n);
    m.name = 'signalLamps';
    for (let k = 0; k < sig.length; k++) {
      const p = sig[k];
      const cs = Math.cos(p.rot), sn = Math.sin(p.rot);
      // head center in local (-3.9, 5.45, 0.17) → world
      const lx = -3.9, lz = 0.17;
      const wx = p.x + lx * cs + lz * sn, wz = p.z - lx * sn + lz * cs;
      tmpE.set(0, p.rot, 0);
      tmpQ.setFromEuler(tmpE);
      for (let L = 0; L < 3; L++) {
        tmpP.set(wx, p.y + 5.45 + 0.38 - L * 0.38, wz);
        tmpM.compose(tmpP, tmpQ, tmpS.set(1, 1, 1));
        m.setMatrixAt(k * 3 + L, tmpM);
        m.setColorAt(k * 3 + L, new THREE.Color(0.05, 0.05, 0.05));
      }
    }
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    this.group.add(m);
    this.signalLamps = m;
    this._lampOn = [new THREE.Color(6, 0.25, 0.15), new THREE.Color(6, 3.6, 0.2), new THREE.Color(0.25, 6, 1.8)];
    this._lampOff = [new THREE.Color(0.12, 0.02, 0.02), new THREE.Color(0.12, 0.09, 0.02), new THREE.Color(0.02, 0.1, 0.05)];
  }

  // phaseFn(i, j, axis) -> 0 green, 1 yellow, 2 red
  updateSignals(phaseFn) {
    const m = this.signalLamps;
    if (!m) return;
    const c = m.instanceColor;
    let dirty = false;
    for (let k = 0; k < this.signals.length; k++) {
      const p = this.signals[k];
      const ph = phaseFn(p.i, p.j, p.axis);
      if (p._ph === ph) continue;
      p._ph = ph;
      dirty = true;
      // lamp order: 0 red top, 1 yellow, 2 green
      const lit = ph === 2 ? 0 : ph === 1 ? 1 : 2;
      for (let L = 0; L < 3; L++) {
        const cc = L === lit ? this._lampOn[L] : this._lampOff[L];
        c.setXYZ(k * 3 + L, cc.r, cc.g, cc.b);
      }
    }
    if (dirty) c.needsUpdate = true;
  }

  addKnockables(meshes, list, r, h, kind, extra) {
    meshes = meshes.filter(Boolean);
    if (!meshes.length) return;
    list.forEach((p, k) => {
      const rec = {
        meshes, index: k, kind, h, x: p.x, y: p.y ?? groundHeight(p.x, p.z), z: p.z, rot: p.rot ?? 0, s: p.s || 1,
        state: 'idle', t: 0, ang: 0, angV: 0, fx: 0, fz: 1, sink: 0, ...(extra ? extra(p, k) : {}),
      };
      rec.collider = this.collision.addCircle(p.x, p.z, r, rec.y - 1, rec.y + h, kind, { knock: true, rec });
      this.knockables.push(rec);
    });
  }

  // Called from the game when a vehicle knocks a pole or tree: it tips over away from the car,
  // pivoting on its base, and no longer blocks anything.
  knock(rec, vx, vz, speed) {
    if (rec.state !== 'idle') return;
    const l = Math.hypot(vx, vz);
    let fx = l > 0.1 ? vx / l : Math.sin(rec.rot), fz = l > 0.1 ? vz / l : Math.cos(rec.rot);
    const j = (Math.random() - 0.5) * 0.6, c = Math.cos(j), sn = Math.sin(j);
    [fx, fz] = [fx * c - fz * sn, fx * sn + fz * c];
    rec.fx = fx; rec.fz = fz;
    rec.state = 'falling';
    rec.t = 0;
    rec.ang = 0.05;
    rec.angV = Math.min(1.7, Math.max(0.45, speed * 0.055)) * (rec.kind === 'tree' ? 0.75 : 1);
    rec.landed = false;
    rec.collider.alive = false;
    if (rec.pool !== undefined && this.pools) { this.pools.setMatrixAt(rec.pool, tmpM.makeScale(0, 0, 0)); this.pools.instanceMatrix.needsUpdate = true; }
    this.toppling.push(rec);
  }

  // instance transform of a (possibly toppled / sunk) pole or tree, incl. attached parts
  placeKnock(r, hidden = false) {
    tmpA.set(r.fz, 0, -r.fx); // horizontal axis: tilts the top toward (fx, fz)
    tmpQ2.setFromAxisAngle(tmpA, r.ang);
    tmpE.set(0, r.rot, 0);
    tmpQ.setFromEuler(tmpE).premultiply(tmpQ2);
    const s = hidden ? 0.0001 : r.s;
    const y = r.y - r.sink * 1.6;
    tmpM.compose(tmpP.set(r.x, y, r.z), tmpQ, tmpS.set(s, s, s));
    for (const m of r.meshes) {
      m.setMatrixAt(r.index, tmpM);
      m.instanceMatrix.needsUpdate = true;
    }
    if (r.sig !== undefined && this.signalLamps) {
      const m = this.signalLamps;
      for (let L = 0; L < 3; L++) {
        tmpV.set(-3.9, 5.45 + 0.38 - L * 0.38, 0.17).applyQuaternion(tmpQ);
        tmpM.compose(tmpP.set(r.x + tmpV.x, y + tmpV.y, r.z + tmpV.z), tmpQ, tmpS.set(s, s, s));
        m.setMatrixAt(r.sig * 3 + L, tmpM);
      }
      m.instanceMatrix.needsUpdate = true;
    }
  }

  updateToppling(dt, playerPos) {
    for (let k = this.toppling.length - 1; k >= 0; k--) {
      const r = this.toppling[k];
      r.t += dt;
      if (r.state === 'falling') {
        // a rod pivoting on its base: gravity speeds it up as it leans over
        const len = Math.max(2, r.h * r.s * 0.7);
        r.angV += ((1.5 * 9.8) / len) * Math.sin(Math.max(0.05, r.ang)) * dt;
        r.ang += r.angV * dt;
        const rest = r.kind === 'tree' ? 1.4 : 1.52; // crowns and lamp heads prop them up a little
        if (r.ang >= rest) {
          r.ang = rest;
          if (!r.landed) { r.landed = true; if (this.onTopple) this.onTopple(r); }
          if (r.angV > 0.7) r.angV = -r.angV * 0.2;
          else { r.angV = 0; r.state = 'down'; r.t = 0; }
        }
        this.placeKnock(r);
      } else if (r.state === 'down') {
        if (r.t > 14) {
          r.sink = Math.min(1, (r.t - 14) / 1.5);
          this.placeKnock(r, r.sink >= 1);
          if (r.sink >= 1) { r.state = 'gone'; r.t = 0; }
        }
      } else if (r.state === 'gone' && r.t > 25 && (!playerPos || Math.hypot(playerPos.x - r.x, playerPos.z - r.z) > 120)) {
        r.state = 'idle';
        r.ang = r.angV = r.sink = 0;
        r.collider.alive = true;
        this.placeKnock(r);
        if (r.pool !== undefined && this.pools) {
          const lx = r.x + Math.sin(r.rot) * 2.3, lz = r.z + Math.cos(r.rot) * 2.3;
          tmpM.compose(tmpP.set(lx, groundHeight(lx, lz) + 0.06, lz), tmpQ.identity(), tmpS.set(15, 1, 15));
          this.pools.setMatrixAt(r.pool, tmpM);
          this.pools.instanceMatrix.needsUpdate = true;
        }
        this.toppling.splice(k, 1);
      }
    }
  }

  // Called from the game when a vehicle breaks a prop
  hit(rec, vx, vz, speed) {
    if (rec.state !== 'idle') return;
    rec.state = 'flying';
    rec.t = 0;
    const sp = Math.max(6, speed * 0.85);
    const l = Math.hypot(vx, vz) || 1;
    rec.vx = (vx / l) * sp + (Math.random() - 0.5) * 4;
    rec.vz = (vz / l) * sp + (Math.random() - 0.5) * 4;
    rec.vy = 4 + Math.random() * 5 + speed * 0.12;
    rec.ax = (Math.random() - 0.5) * 14;
    rec.az = (Math.random() - 0.5) * 14;
    rec.px = rec.x; rec.py = rec.y; rec.pz = rec.z;
    rec.rx = 0; rec.rz = 0;
    rec.ry = rec.rot;
    this.flying.push(rec);
  }

  setNight(f) {
    if (!this.pools) return;
    this.pools.visible = f > 0.2;
    this.poolMat.opacity = Math.min(1, f) * 1.0;
  }

  update(dt, playerPos) {
    this.time += dt;
    if (this.toppling.length) this.updateToppling(dt, playerPos);
    for (let k = this.flying.length - 1; k >= 0; k--) {
      const r = this.flying[k];
      r.t += dt;
      if (r.state === 'flying') {
        r.vy -= 22 * dt;
        r.px += r.vx * dt; r.py += r.vy * dt; r.pz += r.vz * dt;
        r.rx += r.ax * dt; r.rz += r.az * dt;
        const g = groundHeight(r.px, r.pz);
        if (r.py < g) {
          r.py = g;
          r.vy = -r.vy * 0.35;
          r.vx *= 0.6; r.vz *= 0.6;
          r.ax *= 0.6; r.az *= 0.6;
          if (Math.abs(r.vy) < 1 && Math.hypot(r.vx, r.vz) < 1) { r.state = 'down'; r.t = 0; }
        }
        let s = r.s;
        if (r.t > 5) { r.state = 'down'; r.t = 0; }
        this.setInst(r, r.px, r.py, r.pz, r.rx, r.ry, r.rz, s);
      } else if (r.state === 'down') {
        // lie on the ground, shrink away after a while
        const s = r.t > 6 ? Math.max(0, r.s * (1 - (r.t - 6) * 1.5)) : r.s;
        this.setInst(r, r.px, r.py, r.pz, Math.PI / 2 * Math.sign(r.rx || 1), r.ry, 0, s);
        if (r.t > 7) { r.state = 'gone'; r.t = 0; this.setInst(r, r.x, r.y - 50, r.z, 0, 0, 0, 0.001); }
      } else if (r.state === 'gone') {
        // respawn when far from the player
        if (r.t > 20 && (!playerPos || Math.hypot(playerPos.x - r.x, playerPos.z - r.z) > 120)) {
          r.state = 'idle';
          r.collider.alive = true;
          this.setInst(r, r.x, r.y, r.z, 0, r.rot, 0, r.s);
          this.flying.splice(k, 1);
        }
      }
    }
  }

  setInst(r, x, y, z, rx, ry, rz, s) {
    tmpE.set(rx, ry, rz);
    tmpQ.setFromEuler(tmpE);
    tmpP.set(x, y, z);
    tmpS.set(s, s, s);
    tmpM.compose(tmpP, tmpQ, tmpS);
    r.mesh.setMatrixAt(r.index, tmpM);
    r.mesh.instanceMatrix.needsUpdate = true;
  }
}

export { UP };
