// Shared helpers for the procedural San Francisco landmark models.
//
// Every landmark is assembled with a LandmarkBuilder: geometry is pushed into
// per-material GeoBatches (transform baked in, attributes normalised) and merged
// with BufferGeometryUtils.mergeGeometries, so each material becomes exactly one
// draw call.  Optional vertex colours give per-part tint / weathering without
// extra materials.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export { THREE };

export const HAS_DOM =
  typeof document !== 'undefined' && typeof document.createElement === 'function';

// ---------------------------------------------------------------------------
// Deterministic randomness & noise
// ---------------------------------------------------------------------------

/** mulberry32 PRNG -> function returning floats in [0, 1). */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer lattice hash -> [0, 1). */
export function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

/** Smooth value noise in [0, 1]. */
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  const c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
  return lerp(
    lerp(lerp(c000, c100, u), lerp(c010, c110, u), v),
    lerp(lerp(c001, c101, u), lerp(c011, c111, u), v),
    w,
  );
}

/** Fractal noise in ~[0, 1]. */
export function fbm3(x, y, z, octaves = 4, lacunarity = 2.03, gain = 0.5) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x * f, y * f, z * f);
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export { lerp };

// ---------------------------------------------------------------------------
// Colour helpers (all values end up in linear working space)
// ---------------------------------------------------------------------------

/** Vertex-colour function: base colour modulated by low-frequency noise. */
export function tint(hex, amp = 0.08, freq = 0.12, seed = 0) {
  const base = new THREE.Color(hex);
  return (x, y, z, nx, ny, nz, out) => {
    const n = noise3(x * freq + seed * 17.3, y * freq + seed * 3.1, z * freq - seed * 7.7) * 2 - 1;
    const k = 1 + amp * n;
    out.setRGB(base.r * k, base.g * k, base.b * k);
  };
}

/** Vertex-colour function: vertical gradient between two colours (plus noise). */
export function gradientY(hexBottom, hexTop, y0, y1, amp = 0.05, freq = 0.1) {
  const a = new THREE.Color(hexBottom), b = new THREE.Color(hexTop);
  return (x, y, z, nx, ny, nz, out) => {
    const t = clamp01((y - y0) / (y1 - y0));
    const k = 1 + amp * (noise3(x * freq, y * freq, z * freq) * 2 - 1);
    out.setRGB(lerp(a.r, b.r, t) * k, lerp(a.g, b.g, t) * k, lerp(a.b, b.b, t) * k);
  };
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();

/** Matrix from translation, Euler rotation (radians, order XYZ) and scale. */
export function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx, order = 'XYZ') {
  _euler.set(rx, ry, rz, order);
  _quat.setFromEuler(_euler);
  _pos.set(x, y, z);
  _scl.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_pos, _quat, _scl);
}

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// Geometry batching / merging
// ---------------------------------------------------------------------------

export const KEEP_COLORS = Symbol('keepColors');
const _c = new THREE.Color();

function flipWinding(g) {
  if (g.index) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    g.index.needsUpdate = true;
  } else {
    for (const name of Object.keys(g.attributes)) {
      const attr = g.attributes[name];
      const s = attr.itemSize, arr = attr.array;
      for (let i = 0; i < attr.count; i += 3) {
        for (let k = 0; k < s; k++) {
          const t = arr[(i + 1) * s + k];
          arr[(i + 1) * s + k] = arr[(i + 2) * s + k];
          arr[(i + 2) * s + k] = t;
        }
      }
      attr.needsUpdate = true;
    }
  }
}

function applyColor(g, color) {
  const pos = g.attributes.position, nor = g.attributes.normal;
  const n = pos.count;
  const arr = new Float32Array(n * 3);
  if (typeof color === 'function') {
    for (let i = 0; i < n; i++) {
      _c.setRGB(1, 1, 1);
      color(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i), _c);
      arr[i * 3] = _c.r;
      arr[i * 3 + 1] = _c.g;
      arr[i * 3 + 2] = _c.b;
    }
  } else {
    const c = color && color.isColor ? color : _c.set(color);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

/**
 * Normalise a geometry so that everything in one batch can be merged:
 * transform baked in, only position/normal/uv(/color) kept, always indexed.
 */
function prepareGeometry(geo, xf, color, wantColors) {
  const g = geo;
  if (xf) {
    const m = xf.isMatrix4 ? xf : M(...xf);
    g.applyMatrix4(m);
    if (m.determinant() < 0) flipWinding(g);
  }
  const keep = wantColors && color === KEEP_COLORS && g.attributes.color;
  for (const name of Object.keys(g.attributes)) {
    if (name === 'position' || name === 'normal' || name === 'uv') continue;
    if (name === 'color' && keep) continue;
    g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (wantColors && !keep) applyColor(g, color === KEEP_COLORS || color == null ? 0xffffff : color);
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const a = g.attributes[name];
    if (a && !(a.array instanceof Float32Array)) {
      g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(a.array), a.itemSize));
    }
  }
  if (!g.index) {
    const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  g.morphAttributes = {};
  g.morphTargetsRelative = false;
  g.clearGroups();
  return g;
}

export class GeoBatch {
  constructor(vertexColors = false) {
    this.vertexColors = vertexColors;
    this.geos = [];
  }

  /**
   * @param geo   BufferGeometry (consumed: it is transformed in place)
   * @param xf    Matrix4 | [x,y,z,rx,ry,rz,sx,sy,sz] | null
   * @param color hex | Color | (x,y,z,nx,ny,nz,out)=>void | KEEP_COLORS
   */
  add(geo, xf = null, color = null) {
    this.geos.push(prepareGeometry(geo, xf, color, this.vertexColors));
    return this;
  }

  get empty() {
    return this.geos.length === 0;
  }

  build() {
    if (!this.geos.length) return null;
    const merged = this.geos.length === 1 ? this.geos[0] : mergeGeometries(this.geos, false);
    if (!merged) throw new Error('mergeGeometries failed');
    if (merged !== this.geos[0]) for (const g of this.geos) g.dispose();
    this.geos = [];
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }
}

/** Collects material parts, colliders and night materials for one landmark. */
export class LandmarkBuilder {
  constructor(name) {
    this.name = name;
    this.group = new THREE.Group();
    this.group.name = name;
    this.parts = new Map();
    this.objects = [];
    this.colliders = [];
    this.nightMaterials = [];
  }

  /** Returns the GeoBatch for a material (created on first use). */
  part(key, material, opts = {}) {
    let p = this.parts.get(key);
    if (!p) {
      p = { material, batch: new GeoBatch(!!material.vertexColors), opts };
      this.parts.set(key, p);
      this.registerNight(material);
    }
    return p.batch;
  }

  registerNight(material) {
    if (material && material.userData && material.userData.nightIntensity !== undefined) {
      if (!this.nightMaterials.includes(material)) this.nightMaterials.push(material);
    }
    return material;
  }

  /** Add an already-built Object3D (e.g. an InstancedMesh). */
  addObject(obj) {
    this.objects.push(obj);
    obj.traverse((o) => {
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => this.registerNight(m));
    });
    return obj;
  }

  collider(x, z, hx, hz, h, extra) {
    const c = { x: +x.toFixed(3), z: +z.toFixed(3), hx: +hx.toFixed(3), hz: +hz.toFixed(3), h: +h.toFixed(3) };
    if (extra) Object.assign(c, extra);
    this.colliders.push(c);
    return c;
  }

  finish(userData = {}) {
    for (const [key, p] of this.parts) {
      const geo = p.batch.build();
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, p.material);
      mesh.name = `${this.name}.${key}`;
      mesh.castShadow = p.opts.castShadow ?? true;
      mesh.receiveShadow = p.opts.receiveShadow ?? true;
      if (p.opts.renderOrder !== undefined) mesh.renderOrder = p.opts.renderOrder;
      if (p.opts.frustumCulled === false) mesh.frustumCulled = false;
      p.mesh = mesh;
      this.group.add(mesh);
    }
    for (const o of this.objects) this.group.add(o);
    Object.assign(this.group.userData, {
      landmark: this.name,
      colliders: this.colliders,
      nightMaterials: this.nightMaterials,
    }, userData);
    return this.group;
  }

  meshOf(key) {
    const p = this.parts.get(key);
    return p ? p.mesh : null;
  }
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export function std(params) {
  return new THREE.MeshStandardMaterial(params);
}

export function phys(params) {
  return new THREE.MeshPhysicalMaterial(params);
}

/**
 * Material whose emissive is driven by the day/night cycle.
 * emissiveIntensity starts at 0; userData.nightIntensity holds the night value.
 */
export function glow(params, nightIntensity = 2, physical = false) {
  const m = physical ? new THREE.MeshPhysicalMaterial(params) : new THREE.MeshStandardMaterial(params);
  m.emissiveIntensity = 0;
  m.userData.nightIntensity = nightIntensity;
  return m;
}

// ---------------------------------------------------------------------------
// Canvas textures (browser only; null under Node)
// ---------------------------------------------------------------------------

const _texCache = new Map();

/**
 * Lazily build (and cache) a CanvasTexture. Returns null when no DOM exists.
 * opts: { repeat: bool, srgb: bool (default true), mipmaps: bool }
 */
export function canvasTexture(key, width, height, draw, opts = {}) {
  if (!HAS_DOM) return null;
  if (_texCache.has(key)) return _texCache.get(key);
  let tex = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    draw(ctx, width, height);
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    if (opts.repeat) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
    }
    tex.needsUpdate = true;
  } catch (err) {
    tex = null;
  }
  _texCache.set(key, tex);
  return tex;
}

/** Draw text centred at (x, y), shrinking the font until it fits maxWidth. */
export function fitText(ctx, text, x, y, maxWidth, fontPx, font = 'bold', family = 'Arial, Helvetica, sans-serif') {
  let size = fontPx;
  ctx.font = `${font} ${size}px ${family}`;
  while (size > 6 && ctx.measureText(text).width > maxWidth) {
    size -= 2;
    ctx.font = `${font} ${size}px ${family}`;
  }
  ctx.fillText(text, x, y);
  return size;
}

// ---------------------------------------------------------------------------
// Primitive geometry helpers
// ---------------------------------------------------------------------------

export const boxGeo = (w, h, d) => new THREE.BoxGeometry(w, h, d);

/** Axis-aligned box from min/max corners. */
export function boxMM(x0, y0, z0, x1, y1, z1) {
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/** Rounded (bevelled) box. seg=1 gives a chamfer, 2+ a rounded edge. */
export const rboxGeo = (w, h, d, r = 0.2, seg = 1) => new RoundedBoxGeometry(w, h, d, seg, r);

export function rboxMM(x0, y0, z0, x1, y1, z1, r = 0.2, seg = 1) {
  const g = new RoundedBoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), seg, r);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

export const cylGeo = (rTop, rBot, h, seg = 12, open = false) =>
  new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);

/** Cylinder standing on y0 (base) up to y1. */
export function cylY(r0, r1, y0, y1, seg = 12, open = false, x = 0, z = 0) {
  const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, seg, 1, open);
  g.translate(x, (y0 + y1) / 2, z);
  return g;
}

export const sphereGeo = (r, w = 12, h = 8) => new THREE.SphereGeometry(r, w, h);

const _Y = new THREE.Vector3(0, 1, 0);
const _tA = new THREE.Vector3(), _tB = new THREE.Vector3(), _tC = new THREE.Vector3();

function basisAlong(a, b, hint) {
  const dir = _tA.subVectors(b, a);
  const len = dir.length();
  dir.divideScalar(len || 1);
  const zAxis = _tB;
  if (hint) zAxis.copy(hint);
  else if (Math.abs(dir.y) < 0.95) zAxis.set(0, 1, 0);
  else zAxis.set(1, 0, 0);
  zAxis.addScaledVector(dir, -zAxis.dot(dir));
  if (zAxis.lengthSq() < 1e-8) zAxis.set(dir.y, -dir.x, 0);
  zAxis.normalize();
  const xAxis = _tC.crossVectors(dir, zAxis).normalize();
  const m = new THREE.Matrix4().makeBasis(xAxis, dir, zAxis);
  m.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return { m, len };
}

/** Box beam from point a to point b (w along local X, d along local Z ~ hint). */
export function beam(a, b, w, d = w, hint = null) {
  const { m, len } = basisAlong(a, b, hint);
  const g = new THREE.BoxGeometry(w, len, d);
  g.applyMatrix4(m);
  return g;
}

/** Cylinder rod from a to b. */
export function rod(a, b, r, seg = 6, open = true, r2 = r) {
  const { m, len } = basisAlong(a, b, null);
  const g = new THREE.CylinderGeometry(r2, r, len, seg, 1, open);
  g.applyMatrix4(m);
  return g;
}

/** Curve defined by a function fn(t, target). */
export class FnCurve extends THREE.Curve {
  constructor(fn) {
    super();
    this.fn = fn;
  }
  getPoint(t, target = new THREE.Vector3()) {
    this.fn(t, target);
    return target;
  }
}

export function tubeGeo(fn, tubularSegments, radius, radialSegments = 8, closed = false) {
  return new THREE.TubeGeometry(new FnCurve(fn), tubularSegments, radius, radialSegments, closed);
}

/** Tube through a list of points (centripetal Catmull-Rom). */
export function tubePts(points, tubularSegments, radius, radialSegments = 6, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  return new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, closed);
}

/**
 * Lathe around Y with crease handling: profile [[r, y], ...] from bottom to top.
 * Corners sharper than creaseDeg get split normals (crisp mouldings), smooth otherwise.
 */
export function latheGeo(profile, segments = 24, creaseDeg = 40, phiStart = 0, phiLength = Math.PI * 2) {
  const P = [];
  for (const [r, y] of profile) {
    const last = P[P.length - 1];
    if (last && Math.abs(last.r - r) < 1e-6 && Math.abs(last.y - y) < 1e-6) continue;
    P.push({ r: Math.max(0, r), y });
  }
  const nSeg = P.length - 1;
  const segN = [];
  let total = 0;
  for (let k = 0; k < nSeg; k++) {
    const dr = P[k + 1].r - P[k].r, dy = P[k + 1].y - P[k].y;
    const len = Math.hypot(dr, dy) || 1e-6;
    segN.push({ r: dy / len, y: -dr / len, len });
    total += len;
  }
  const cosCrease = Math.cos((creaseDeg * Math.PI) / 180);
  const rows = [];
  const segStart = new Array(nSeg), segEnd = new Array(nSeg);
  let acc = 0;
  for (let j = 0; j <= nSeg; j++) {
    const prev = j > 0 ? segN[j - 1] : null;
    const next = j < nSeg ? segN[j] : null;
    const v = acc / total;
    const p = P[j];
    if (prev && next) {
      const dot = prev.r * next.r + prev.y * next.y;
      if (dot > cosCrease) {
        let nr = prev.r + next.r, ny = prev.y + next.y;
        const l = Math.hypot(nr, ny) || 1;
        rows.push({ r: p.r, y: p.y, nr: nr / l, ny: ny / l, v });
        segEnd[j - 1] = rows.length - 1;
        segStart[j] = rows.length - 1;
      } else {
        rows.push({ r: p.r, y: p.y, nr: prev.r, ny: prev.y, v });
        segEnd[j - 1] = rows.length - 1;
        rows.push({ r: p.r, y: p.y, nr: next.r, ny: next.y, v });
        segStart[j] = rows.length - 1;
      }
    } else if (prev) {
      rows.push({ r: p.r, y: p.y, nr: prev.r, ny: prev.y, v });
      segEnd[j - 1] = rows.length - 1;
    } else {
      rows.push({ r: p.r, y: p.y, nr: next.r, ny: next.y, v });
      segStart[j] = rows.length - 1;
    }
    if (j < nSeg) acc += segN[j].len;
  }
  const R = rows.length;
  const pos = new Float32Array((segments + 1) * R * 3);
  const nor = new Float32Array((segments + 1) * R * 3);
  const uv = new Float32Array((segments + 1) * R * 2);
  for (let i = 0; i <= segments; i++) {
    const phi = phiStart + (i / segments) * phiLength;
    const s = Math.sin(phi), c = Math.cos(phi);
    for (let k = 0; k < R; k++) {
      const row = rows[k];
      const o = (i * R + k) * 3;
      pos[o] = row.r * s;
      pos[o + 1] = row.y;
      pos[o + 2] = row.r * c;
      nor[o] = row.nr * s;
      nor[o + 1] = row.ny;
      nor[o + 2] = row.nr * c;
      const u = (i * R + k) * 2;
      uv[u] = i / segments;
      uv[u + 1] = row.v;
    }
  }
  const index = [];
  for (let i = 0; i < segments; i++) {
    for (let k = 0; k < nSeg; k++) {
      const a0 = segStart[k], b0 = segEnd[k];
      const v00 = i * R + a0, v10 = (i + 1) * R + a0, v11 = (i + 1) * R + b0, v01 = i * R + b0;
      index.push(v00, v10, v01, v11, v01, v10);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

/**
 * Vertical prism between a bottom polygon (at y0) and a top polygon (at y1).
 * Polygons: arrays of [x, z], counter-clockwise in (x, z) (i.e. x right, z up).
 * Side faces are flat shaded. UV: u = perimeter metres / uScale, v = y / vScale.
 */
export function prismGeo(bottom, top, y0, y1, opts = {}) {
  const { capTop = true, capBottom = true, uScale = 1, vScale = 1 } = opts;
  const n = bottom.length;
  const pos = [], nor = [], uv = [], idx = [];
  let per = 0;
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const b0 = bottom[i], b1 = bottom[j], t0 = top[i], t1 = top[j];
    const base = pos.length / 3;
    pos.push(b0[0], y0, b0[1], b1[0], y0, b1[1], t1[0], y1, t1[1], t0[0], y1, t0[1]);
    // normal from (b0, t0, t1)
    e1.set(t0[0] - b0[0], y1 - y0, t0[1] - b0[1]);
    e2.set(t1[0] - b0[0], y1 - y0, t1[1] - b0[1]);
    fn.crossVectors(e1, e2);
    if (fn.lengthSq() < 1e-12) {
      e1.set(b1[0] - b0[0], 0, b1[1] - b0[1]);
      fn.set(e1.z, 0, -e1.x);
    }
    fn.normalize();
    for (let k = 0; k < 4; k++) nor.push(fn.x, fn.y, fn.z);
    const len = Math.hypot(b1[0] - b0[0], b1[1] - b0[1]);
    uv.push(per / uScale, y0 / vScale, (per + len) / uScale, y0 / vScale, (per + len) / uScale, y1 / vScale, per / uScale, y1 / vScale);
    per += len;
    // (b0, t0, t1) and (b0, t1, b1)
    idx.push(base, base + 3, base + 2, base, base + 2, base + 1);
  }
  const addCap = (poly, y, up) => {
    const contour = poly.map((p) => new THREE.Vector2(p[0], p[1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const base = pos.length / 3;
    for (const p of poly) {
      pos.push(p[0], y, p[1]);
      nor.push(0, up ? 1 : -1, 0);
      uv.push(p[0] / uScale, p[1] / uScale);
    }
    for (const t of tris) {
      // earcut output is always CCW in (x, z) -> its normal points -Y
      const [a, b, c] = t;
      if (up) idx.push(base + a, base + c, base + b);
      else idx.push(base + a, base + b, base + c);
    }
  };
  if (capTop) addCap(top, y1, true);
  if (capBottom) addCap(bottom, y0, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Ensure a polygon [[x,z],...] is CCW in (x, z). */
export function ccwPoly(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a < 0 ? poly.slice().reverse() : poly;
}

/**
 * Smooth loft through rings of Vector3 (each ring CCW in x,z when seen as a
 * vertical tower; rings ordered bottom -> top). Optional fan caps.
 * UV: u = ring parameter * uRepeat, v = y / vScale.
 */
export function loftGeo(rings, opts = {}) {
  const { capStart = false, capEnd = false, uRepeat = 1, vScale = 1, smooth = true } = opts;
  const n = rings[0].length;
  const pos = [], uv = [], idx = [];
  const ringLen = rings.map((ring) => {
    let L = 0;
    for (let i = 0; i < n; i++) L += ring[i].distanceTo(ring[(i + 1) % n]);
    return L;
  });
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    let acc = 0;
    for (let i = 0; i <= n; i++) {
      const p = ring[i % n];
      pos.push(p.x, p.y, p.z);
      uv.push((acc / ringLen[r]) * uRepeat, p.y / vScale);
      if (i < n) acc += p.distanceTo(ring[(i + 1) % n]);
    }
  }
  const W = n + 1;
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < n; i++) {
      const b0 = r * W + i, b1 = r * W + i + 1, t0 = (r + 1) * W + i, t1 = (r + 1) * W + i + 1;
      idx.push(b0, t0, t1, b0, t1, b1);
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  if (smooth) {
    g.computeVertexNormals();
    const nor = g.attributes.normal;
    for (let r = 0; r < rings.length; r++) {
      const a = r * W, b = r * W + n;
      const x = nor.getX(a) + nor.getX(b), y = nor.getY(a) + nor.getY(b), z = nor.getZ(a) + nor.getZ(b);
      const l = Math.hypot(x, y, z) || 1;
      nor.setXYZ(a, x / l, y / l, z / l);
      nor.setXYZ(b, x / l, y / l, z / l);
    }
  } else {
    g = g.toNonIndexed();
    g.computeVertexNormals();
  }
  const parts = [g];
  const fanCap = (ring, up) => {
    const c = new THREE.Vector3();
    ring.forEach((p) => c.add(p));
    c.divideScalar(ring.length);
    const cp = [c.x, c.y, c.z];
    const p2 = [], n2 = [], u2 = [], i2 = [];
    p2.push(...cp);
    for (const p of ring) p2.push(p.x, p.y, p.z);
    const ny = up ? 1 : -1;
    for (let i = 0; i <= ring.length; i++) n2.push(0, ny, 0), u2.push(0, 0);
    for (let i = 0; i < ring.length; i++) {
      const a = 1 + i, b = 1 + ((i + 1) % ring.length);
      if (up) i2.push(0, b, a);
      else i2.push(0, a, b);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(p2, 3));
    cg.setAttribute('normal', new THREE.Float32BufferAttribute(n2, 3));
    cg.setAttribute('uv', new THREE.Float32BufferAttribute(u2, 2));
    cg.setIndex(i2);
    return cg;
  };
  if (capStart) parts.push(fanCap(rings[0], false));
  if (capEnd) parts.push(fanCap(rings[rings.length - 1], true));
  if (parts.length === 1) return g;
  const prepared = parts.map((p) => prepareGeometry(p, null, null, false));
  return mergeGeometries(prepared, false);
}

/** Extrude a 2D shape (XY plane) along Z, centred on z = 0. Front face +Z. */
export function extrudeGeo(shape, depth, opts = {}) {
  const { bevel = 0, bevelSegments = 1, curveSegments = 8 } = opts;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    curveSegments,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Rectangle with a semicircular top. Bottom centre at (cx, y0). */
export function archShape(w, hRect, cx = 0, y0 = 0, segs = 10) {
  const s = new THREE.Shape();
  const r = w / 2;
  s.moveTo(cx - r, y0);
  s.lineTo(cx + r, y0);
  s.lineTo(cx + r, y0 + hRect);
  for (let i = 1; i <= segs; i++) {
    const a = (i / segs) * Math.PI;
    s.lineTo(cx + r * Math.cos(a), y0 + hRect + r * Math.sin(a));
  }
  s.closePath();
  return s;
}

export function rectShape(w, h, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  s.moveTo(cx - w / 2, cy - h / 2);
  s.lineTo(cx + w / 2, cy - h / 2);
  s.lineTo(cx + w / 2, cy + h / 2);
  s.lineTo(cx - w / 2, cy + h / 2);
  s.closePath();
  return s;
}

/** Flat shape geometry (faces +Z). */
export const shapeGeo = (shape, curveSegments = 8) => new THREE.ShapeGeometry(shape, curveSegments);

/** Arch ring (voussoirs) between radii rIn/rOut, angles a0..a1, extruded depth along Z. */
export function archRingGeo(rIn, rOut, depth, a0 = 0, a1 = Math.PI, segs = 12) {
  const s = new THREE.Shape();
  s.moveTo(rOut * Math.cos(a0), rOut * Math.sin(a0));
  for (let i = 1; i <= segs; i++) {
    const a = a0 + ((a1 - a0) * i) / segs;
    s.lineTo(rOut * Math.cos(a), rOut * Math.sin(a));
  }
  for (let i = segs; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / segs;
    s.lineTo(rIn * Math.cos(a), rIn * Math.sin(a));
  }
  s.closePath();
  return extrudeGeo(s, depth);
}

/** Simple quad facing +Z (PlaneGeometry). */
export const planeGeo = (w, h, sx = 1, sy = 1) => new THREE.PlaneGeometry(w, h, sx, sy);

/** Regular-polygon [x,z] list (CCW). */
export function ngon(n, r, cx = 0, cz = 0, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
  }
  return pts;
}

/** Rounded-rectangle [x,z] list (CCW). */
export function roundedRectPts(hx, hz, r, segs = 6, cx = 0, cz = 0) {
  const pts = [];
  const corners = [
    [hx - r, hz - r, 0],
    [-hx + r, hz - r, Math.PI / 2],
    [-hx + r, -hz + r, Math.PI],
    [hx - r, -hz + r, (3 * Math.PI) / 2],
  ];
  for (const [x, z, a0] of corners) {
    for (let i = 0; i <= segs; i++) {
      const a = a0 + (i / segs) * (Math.PI / 2);
      pts.push([cx + x + r * Math.cos(a), cz + z + r * Math.sin(a)]);
    }
  }
  return pts;
}

/** Count triangles of an Object3D tree (instances included). */
export function countTriangles(obj) {
  let tris = 0;
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const t = (g.index ? g.index.count : g.attributes.position.count) / 3;
    tris += t * (o.isInstancedMesh ? o.count : 1);
  });
  return tris;
}

/**
 * Planar Warren truss (with verticals) in the plane x = const, running z0 -> z1.
 * Adds chords, verticals and alternating diagonals to `batch`. Returns panel z list.
 */
export function warrenTruss(batch, { x, z0, z1, yBot, yTop, panel = 8, chordW = 0.9, chordH = 1.0, webW = 0.5, color = null, verticals = true }) {
  const n = Math.max(2, Math.round((z1 - z0) / panel));
  const L = (z1 - z0) / n;
  const yb1 = yBot + chordH, yt0 = yTop - chordH;
  batch.add(boxMM(x - chordW / 2, yt0, z0, x + chordW / 2, yTop, z1), null, color);
  batch.add(boxMM(x - chordW / 2, yBot, z0, x + chordW / 2, yb1, z1), null, color);
  const zs = [];
  for (let k = 0; k <= n; k++) {
    const z = z0 + k * L;
    zs.push(z);
    if (verticals) batch.add(boxMM(x - webW * 0.6, yb1, z - webW * 0.6, x + webW * 0.6, yt0, z + webW * 0.6), null, color);
    if (k < n) {
      const up = k % 2 === 0;
      const a = new THREE.Vector3(x, up ? yb1 : yt0, z);
      const b = new THREE.Vector3(x, up ? yt0 : yb1, z + L);
      batch.add(beam(a, b, webW, webW * 1.1, new THREE.Vector3(1, 0, 0)), null, color);
    }
  }
  return zs;
}

/** Multiply a geometry's UVs (e.g. to repeat a dotted emissive texture along a strip). */
export function scaleUV(geo, su = 1, sv = 1) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return geo;
}

/**
 * Window-grid facade textures (browser only). Returns { map, emissiveMap, ormMap }
 * (all null under Node). One tile = cols x rows window modules; map it with
 * u = metres / (cols * moduleWidth), v = metres / (rows * floorHeight).
 * ormMap: G = roughness, B = metalness (use as roughnessMap + metalnessMap).
 */
export function facadeTextures(key, opts = {}) {
  const {
    cols = 8, rows = 4, px = 32, py = 64,
    wall = '#ece8df', wallShade = null, glass = '#3a4352', glassTop = '#5a6474',
    win = [0.18, 0.22, 0.82, 0.86], // x0, y0, x1, y1 inside a module (y measured from the top)
    lit = 0.55, litColors = ['#ffd49a', '#ffe6bd', '#fff2d8', '#d8e6ff'],
    mullion = null, mullionEvery = 0,
    band = null, bandH = 0,
    seed = 7, glassRough = 0.1, wallRough = 0.85, glassMetal = 0.6, wallMetal = 0.0,
  } = opts;
  if (!HAS_DOM) return { map: null, emissiveMap: null, ormMap: null };
  const W = cols * px, H = rows * py;
  const rects = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      rects.push([c * px + win[0] * px, r * py + win[1] * py, (win[2] - win[0]) * px, (win[3] - win[1]) * py]);
    }
  }
  const map = canvasTexture(`${key}:map`, W, H, (ctx) => {
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, H);
    if (wallShade) {
      for (let r = 0; r < rows; r++) {
        const g = ctx.createLinearGradient(0, r * py, 0, (r + 1) * py);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, wallShade);
        ctx.fillStyle = g;
        ctx.fillRect(0, r * py, W, py);
      }
    }
    if (band) {
      ctx.fillStyle = band;
      for (let r = 0; r < rows; r++) ctx.fillRect(0, r * py, W, bandH * py);
    }
    for (const [x, y, w, h] of rects) {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, glassTop);
      g.addColorStop(1, glass);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      if (mullion) {
        ctx.fillStyle = mullion;
        ctx.fillRect(x + w / 2 - 1, y, 2, h);
      }
    }
    if (mullion && mullionEvery) {
      ctx.fillStyle = mullion;
      for (let c = 0; c <= cols; c += mullionEvery) ctx.fillRect(c * px - 1, 0, 2, H);
    }
  }, { repeat: true });
  const emissiveMap = canvasTexture(`${key}:emi`, W, H, (ctx) => {
    const rnd = makeRng(seed);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    for (const [x, y, w, h] of rects) {
      if (rnd() > lit) continue;
      ctx.fillStyle = litColors[Math.floor(rnd() * litColors.length)];
      ctx.globalAlpha = 0.55 + rnd() * 0.45;
      ctx.fillRect(x, y, w, h);
    }
    ctx.globalAlpha = 1;
  }, { repeat: true });
  const ormMap = canvasTexture(`${key}:orm`, W, H, (ctx) => {
    const c = (rough, metal) => `rgb(255,${Math.round(rough * 255)},${Math.round(metal * 255)})`;
    ctx.fillStyle = c(wallRough, wallMetal);
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = c(glassRough, glassMetal);
    for (const [x, y, w, h] of rects) ctx.fillRect(x, y, w, h);
  }, { repeat: true, srgb: false });
  return { map, emissiveMap, ormMap };
}

/** Four sloped trapezoid faces of a square frustum (|x|,|z| <= hw), y0 -> y1. */
export function frustumFaces(y0, y1, hw0, hw1, uScale = 1, vScale = 1, cx = 0, cz = 0) {
  const pos = [], uv = [], idx = [];
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2;
    const c = Math.cos(a), s = Math.sin(a);
    // +Z face in local frame, rotated about Y by a
    const pts = [[-hw0, y0, hw0], [hw0, y0, hw0], [hw1, y1, hw1], [-hw1, y1, hw1]];
    const base = pos.length / 3;
    for (const [x, y, z] of pts) {
      pos.push(cx + x * c + z * s, y, cz - x * s + z * c);
      uv.push(x / uScale, y / vScale);
    }
    if (hw1 > 1e-6) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else idx.push(base, base + 1, base + 2);
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g = g.toNonIndexed();
  g.computeVertexNormals();
  return g;
}
