// Low-level geometry emitter for buildings that writes the facade attributes used by
// BuildingMaterial. Geometry is authored in a local frame (house front at z=0 facing +Z)
// and transformed into world space on emit.
//
// Wall convention: wall(ax, az, bx, bz) has outward normal (-dz, 0, dx); u runs A→B
// (left→right seen from outside). Polygons for prisms are ordered so every edge's
// outward normal follows that rule (counter-clockwise on a north-up map).

import * as THREE from 'three';
import { FACADE } from './BuildingMaterial.js';

export class FacadeBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.fuv = [];
    this.col = [];
    this.trim = [];
    this.par = [];
    this.idx = [];
    this.count = 0;
    this.attrs = { wall: [1, 1, 1], trim: [1, 1, 1], style: 0, spacing: 3, floorH: 3.4, seed: 0 };
    this.vOrigin = 0;
    // transform
    this.ox = 0; this.oy = 0; this.oz = 0;
    this.cos = 1; this.sin = 0;
  }

  setTransform(ox, oz, rotY = 0, oy = 0) {
    this.ox = ox; this.oz = oz; this.oy = oy;
    this.cos = Math.cos(rotY); this.sin = Math.sin(rotY);
  }

  set(attrs) {
    Object.assign(this.attrs, attrs);
    return this;
  }

  // local → world
  _tx(x, z) {
    return [this.ox + x * this.cos + z * this.sin, this.oz - x * this.sin + z * this.cos];
  }

  _vert(x, y, z, nx, ny, nz, u, v, spacingOverride) {
    const [wx, wz] = this._tx(x, z);
    const nwx = nx * this.cos + nz * this.sin, nwz = -nx * this.sin + nz * this.cos;
    this.pos.push(wx, y + this.oy, wz);
    this.nrm.push(nwx, ny, nwz);
    const a = this.attrs;
    if (a.style === FACADE.ROOF) this.fuv.push(wx, wz);
    else this.fuv.push(u, v);
    this.col.push(a.wall[0], a.wall[1], a.wall[2]);
    this.trim.push(a.trim[0], a.trim[1], a.trim[2]);
    this.par.push(a.style, spacingOverride ?? a.spacing, a.floorH, a.seed);
    return this.count++;
  }

  // Generic quad (CCW from outside). p = [x,y,z] x4, uv = [u,v] x4
  quad(p0, p1, p2, p3, uv0 = [0, 0], uv1 = [0, 0], uv2 = [0, 0], uv3 = [0, 0], spacing) {
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p3[0] - p0[0], by = p3[1] - p0[1], bz = p3[2] - p0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const a = this._vert(p0[0], p0[1], p0[2], nx, ny, nz, uv0[0], uv0[1], spacing);
    const b = this._vert(p1[0], p1[1], p1[2], nx, ny, nz, uv1[0], uv1[1], spacing);
    const c = this._vert(p2[0], p2[1], p2[2], nx, ny, nz, uv2[0], uv2[1], spacing);
    const d = this._vert(p3[0], p3[1], p3[2], nx, ny, nz, uv3[0], uv3[1], spacing);
    this.idx.push(a, b, c, a, c, d);
  }

  tri(p0, p1, p2, uv0 = [0, 0], uv1 = [0, 0], uv2 = [0, 0]) {
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const a = this._vert(p0[0], p0[1], p0[2], nx, ny, nz, uv0[0], uv0[1]);
    const b = this._vert(p1[0], p1[1], p1[2], nx, ny, nz, uv1[0], uv1[1]);
    const c = this._vert(p2[0], p2[1], p2[2], nx, ny, nz, uv2[0], uv2[1]);
    this.idx.push(a, b, c);
  }

  // Vertical wall A→B from y0 to y1. Window spacing is fitted to the wall width.
  wall(ax, az, bx, bz, y0, y1, u0 = 0, fitSpacing = true) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-4 || y1 - y0 < 1e-4) return;
    let sp = this.attrs.spacing;
    if (fitSpacing) {
      const n = Math.max(1, Math.round(len / sp));
      sp = len / n;
    }
    const v0 = y0 - this.vOrigin, v1 = y1 - this.vOrigin;
    this.quad(
      [ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az],
      [u0, v0], [u0 + len, v0], [u0 + len, v1], [u0, v1],
      sp
    );
  }

  // Horizontal cap (convex polygon), facing up (+1) or down (-1).
  cap(points, y, up = 1) {
    if (up > 0) {
      for (let k = 1; k < points.length - 1; k++) {
        this.tri([points[0][0], y, points[0][1]], [points[k][0], y, points[k][1]], [points[k + 1][0], y, points[k + 1][1]]);
      }
    } else {
      for (let k = 1; k < points.length - 1; k++) {
        this.tri([points[0][0], y, points[0][1]], [points[k + 1][0], y, points[k + 1][1]], [points[k][0], y, points[k][1]]);
      }
    }
  }

  // Extruded polygon (walls + optional roof). opts.roof = attrs for the roof cap.
  prism(points, y0, y1, { roof = null, bottom = false, skipEdges = null, wallAttrs = null } = {}) {
    let u = 0;
    const n = points.length;
    if (wallAttrs) this.set(wallAttrs);
    for (let k = 0; k < n; k++) {
      const a = points[k], b = points[(k + 1) % n];
      if (!skipEdges || !skipEdges.includes(k)) this.wall(a[0], a[1], b[0], b[1], y0, y1, 0);
      u += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    if (roof) {
      const keep = { ...this.attrs };
      this.set(roof);
      this.cap(points, y1, 1);
      this.set(keep);
    }
    if (bottom) this.cap(points, y0, -1);
  }

  // Axis-aligned box in local coords. faces: object to disable faces {top,bottom,n,s,e,w}
  box(x0, y0, z0, x1, y1, z1, { roof = null, faces = null } = {}) {
    const f = faces || {};
    // west (x0), south (z1), east (x1), north (z0)
    if (f.w !== false) this.wall(x0, z0, x0, z1, y0, y1);
    if (f.s !== false) this.wall(x0, z1, x1, z1, y0, y1);
    if (f.e !== false) this.wall(x1, z1, x1, z0, y0, y1);
    if (f.n !== false) this.wall(x1, z0, x0, z0, y0, y1);
    if (f.top !== false) {
      const keep = roof ? { ...this.attrs } : null;
      if (roof) this.set(roof);
      this.cap([[x0, z0], [x0, z1], [x1, z1], [x1, z0]], y1, 1);
      if (keep) this.set(keep);
    }
    if (f.bottom) this.cap([[x0, z0], [x0, z1], [x1, z1], [x1, z0]], y0, -1);
  }

  // Rectangle footprint → polygon (CCW on north-up map)
  static rect(x0, z0, x1, z1) {
    return [[x0, z0], [x0, z1], [x1, z1], [x1, z0]];
  }

  // Chamfered rectangle (octagon-ish) footprint
  static chamfer(x0, z0, x1, z1, c) {
    return [
      [x0, z0 + c], [x0, z1 - c], [x0 + c, z1], [x1 - c, z1],
      [x1, z1 - c], [x1, z0 + c], [x1 - c, z0], [x0 + c, z0],
    ];
  }

  static circle(cx, cz, r, seg = 16) {
    const pts = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      // south → east → north → west (counter-clockwise on a north-up map)
      pts.push([cx + Math.sin(a) * r, cz + Math.cos(a) * r]);
    }
    return pts;
  }

  // Triangular gable on top of a box. Ridge along local Z, facing ±Z.
  // x0..x1 width, z0..z1 depth, base y, apex height h.
  gableZ(x0, z0, x1, z1, y, h, roofAttrs, gableAttrs, overhang = 0.35) {
    const xm = (x0 + x1) / 2;
    const keep = { ...this.attrs };
    // gable triangles (front z1, back z0)
    this.set(gableAttrs);
    this.tri([x0, y, z1], [x1, y, z1], [xm, y + h, z1], [0, y - this.vOrigin], [x1 - x0, y - this.vOrigin], [(x1 - x0) / 2, y + h - this.vOrigin]);
    this.tri([x1, y, z0], [x0, y, z0], [xm, y + h, z0]);
    // roof slopes
    this.set(roofAttrs);
    const ox = overhang;
    this.quad([x0 - ox, y - ox * (h / ((x1 - x0) / 2)), z1 + ox], [xm, y + h, z1 + ox], [xm, y + h, z0 - ox], [x0 - ox, y - ox * (h / ((x1 - x0) / 2)), z0 - ox]);
    this.quad([xm, y + h, z1 + ox], [x1 + ox, y - ox * (h / ((x1 - x0) / 2)), z1 + ox], [x1 + ox, y - ox * (h / ((x1 - x0) / 2)), z0 - ox], [xm, y + h, z0 - ox]);
    this.set(keep);
  }

  // Hip roof over a rectangle (ridge along the longer axis)
  hipRoof(x0, z0, x1, z1, y, h, attrs, overhang = 0.4) {
    const keep = { ...this.attrs };
    this.set(attrs);
    x0 -= overhang; z0 -= overhang; x1 += overhang; z1 += overhang;
    const w = x1 - x0, d = z1 - z0;
    if (w >= d) {
      const r = d / 2;
      const zm = (z0 + z1) / 2;
      const a = [x0 + r, y + h, zm], b = [x1 - r, y + h, zm];
      this.quad([x0, y, z1], [x1, y, z1], b, a); // south slope
      this.quad([x1, y, z0], [x0, y, z0], a, b); // north slope
      this.tri([x0, y, z0], [x0, y, z1], a); // west
      this.tri([x1, y, z1], [x1, y, z0], b); // east
    } else {
      const r = w / 2;
      const xm = (x0 + x1) / 2;
      const a = [xm, y + h, z0 + r], b = [xm, y + h, z1 - r];
      this.quad([x0, y, z0], [x0, y, z1], b, a); // west
      this.quad([x1, y, z1], [x1, y, z0], a, b); // east
      this.tri([x0, y, z1], [x1, y, z1], b); // south
      this.tri([x1, y, z0], [x0, y, z0], a); // north
    }
    this.set(keep);
  }

  // Cone (turret roofs) — ring at y, apex at y+h
  cone(cx, cz, r, y, h, seg, attrs) {
    const keep = { ...this.attrs };
    this.set(attrs);
    const pts = FacadeBuilder.circle(cx, cz, r, seg);
    for (let k = 0; k < seg; k++) {
      const a = pts[k], b = pts[(k + 1) % seg];
      this.tri([a[0], y, a[1]], [b[0], y, b[1]], [cx, y + h, cz]);
    }
    this.set(keep);
  }

  // Sloped awning (wedge) attached to a wall at local z = zWall facing +Z
  awning(x0, x1, zWall, depth, yTop, drop, attrs) {
    const keep = { ...this.attrs };
    this.set(attrs);
    const z1 = zWall + depth, yb = yTop - drop;
    const span = x1 - x0;
    this.quad([x0, yb, z1], [x1, yb, z1], [x1, yTop, zWall], [x0, yTop, zWall], [0, 0], [span, 0], [span, 1], [0, 1]);
    this.quad([x0, yb - 0.35, z1], [x1, yb - 0.35, z1], [x1, yb, z1], [x0, yb, z1], [0, 0], [span, 0], [span, 1], [0, 1]);
    this.tri([x0, yTop, zWall], [x0, yb - 0.35, z1], [x0, yb, z1]);
    this.tri([x1, yb, z1], [x1, yb - 0.35, z1], [x1, yTop, zWall]);
    this.set(keep);
  }

  get vertexCount() { return this.count; }

  build() {
    if (!this.count) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aFUV', new THREE.Float32BufferAttribute(this.fuv, 2));
    const toU8 = (arr) => {
      const out = new Uint8Array(arr.length);
      for (let k = 0; k < arr.length; k++) out[k] = Math.max(0, Math.min(255, Math.round(arr[k] * 255)));
      return out;
    };
    g.setAttribute('color', new THREE.BufferAttribute(toU8(this.col), 3, true));
    g.setAttribute('aTrim', new THREE.BufferAttribute(toU8(this.trim), 3, true));
    g.setAttribute('aParams', new THREE.Float32BufferAttribute(this.par, 4));
    const IndexArray = this.count > 65535 ? Uint32Array : Uint16Array;
    g.setIndex(new THREE.BufferAttribute(new IndexArray(this.idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
