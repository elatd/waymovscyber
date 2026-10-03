// Lofted car body generator.
//
// A body is swept from cross-sections taken along the car (z = length axis). Each section
// is built from smooth profile curves: top line (hood/roof/deck), bottom line, beltline
// (shoulder), shoulder half-width, bottom half-width and top half-width, so the sides are
// curved, the greenhouse leans in (tumblehome) and wheel wells are carved as real
// openings. Every quad is classified into a material group (paint, glass, black trim…)
// by its position, which lets window shapes, pillars and claddings follow the real car.
//
// Car space: +Z forward, +X left, +Y up, origin on the ground between the axles.
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Monotone cubic interpolation (Fritsch–Carlson) over a [[x, y], ...] table
// ---------------------------------------------------------------------------
export function curve(table) {
  const xs = table.map((p) => p[0]);
  const ys = table.map((p) => p[1]);
  const n = xs.length;
  const d = new Array(n - 1);
  const m = new Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

const smooth = (t) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------------------
// Section evaluation
// ---------------------------------------------------------------------------
// One side of a cross-section, from the bottom centre to the top centre. Fixed point
// count so every station has the same topology. Each point carries a region tag.
export function sectionSide(p) {
  const pts = [];
  const push = (x, y, tag) => pts.push({ x, y, tag });
  // underbody flat (centre → wheel-well inner wall)
  push(0, p.yb, 'under');
  push(p.innerX * 0.5, p.yb, 'under');
  push(p.innerX, p.yb, 'under');
  // wheel-well inner wall (degenerate outside the arches)
  push(p.innerX, p.ywell, 'well');
  // well ceiling / sill bottom out to the lower corner
  const rb = Math.min(p.rB, Math.max(0.005, (p.yBelt - p.ywell) * 0.3));
  push(lerp(p.innerX, p.wb - rb, 0.5), p.ywell, 'well');
  push(p.wb - rb, p.ywell, 'bottom');
  for (let k = 1; k <= 3; k++) {
    const a = (k / 3) * Math.PI * 0.5;
    push(p.wb - rb + Math.sin(a) * rb, p.ywell + rb - Math.cos(a) * rb, 'bottom');
  }
  // lower side: bottom corner → shoulder (slightly convex)
  const y0 = p.ywell + rb;
  for (let k = 1; k <= 7; k++) {
    const t = k / 7;
    const x = lerp(p.wb, p.w, smooth(t)) + p.bulge * Math.sin(Math.PI * t) * (1 - t * 0.3);
    push(x, lerp(y0, p.yBelt, t), 'lower');
  }
  // upper side: shoulder → top edge (tumblehome)
  const yTe = p.yt - p.rT;
  for (let k = 1; k <= 7; k++) {
    const t = k / 7;
    const x = lerp(p.w, p.wt, Math.pow(t, p.tumbleExp)) + p.upperBulge * Math.sin(Math.PI * t);
    push(x, lerp(p.yBelt, yTe, t), 'upper');
  }
  // rounded top edge
  for (let k = 1; k <= 4; k++) {
    const a = (k / 4) * Math.PI * 0.5;
    push(p.wt - p.rT + Math.cos(a) * p.rT, yTe + Math.sin(a) * p.rT, 'edge');
  }
  // top surface with crown
  const xs = p.wt - p.rT;
  for (let k = 1; k <= 4; k++) {
    const t = k / 4;
    push(xs * (1 - t), p.yt + p.crown * (1 - (1 - t) * (1 - t)), 'top');
  }
  return pts;
}

const lerp = (a, b, t) => a + (b - a) * t;

// Shoulder section (Cybercab style): side wall up to a crease, a shoulder band in to the
// window sill, then the glasshouse / deck side as a cubic that leaves the sill at gAng and
// arrives tangent to the crowned top. Extra params: wS, yS (sill point), xs (top edge
// half-width), gAng (rad), k0, k1 (handle lengths), sharp (0 = soft shoulder, 1 = crease).
export function sectionShoulder(p) {
  const pts = [];
  const push = (x, y, tag) => pts.push({ x, y, tag });
  push(0, p.yb, 'under');
  push(p.innerX * 0.5, p.yb, 'under');
  push(p.innerX, p.yb, 'under');
  push(p.innerX, p.ywell, 'well');
  const rb = Math.min(p.rB, Math.max(0.005, (p.yBelt - p.ywell) * 0.3));
  push(lerp(p.innerX, p.wb - rb, 0.5), p.ywell, 'well');
  push(p.wb - rb, p.ywell, 'bottom');
  for (let k = 1; k <= 3; k++) {
    const a = (k / 3) * Math.PI * 0.5;
    push(p.wb - rb + Math.sin(a) * rb, p.ywell + rb - Math.cos(a) * rb, 'bottom');
  }
  const y0 = p.ywell + rb;
  for (let k = 1; k <= 8; k++) {
    const t = k / 8;
    const x = lerp(p.wb, p.w, smooth(t)) + p.bulge * Math.sin(Math.PI * t) * (1 - t * 0.3);
    push(x, lerp(y0, p.yBelt, t), 'lower');
  }
  const cx = lerp(p.w, (p.w + p.wS) / 2, p.sharp);
  const cy = lerp(lerp(p.yBelt, p.yS, 0.65), (p.yBelt + p.yS) / 2, p.sharp);
  for (let k = 1; k <= 3; k++) {
    const t = k / 3, u = 1 - t;
    push(u * u * p.w + 2 * u * t * cx + t * t * p.wS, u * u * p.yBelt + 2 * u * t * cy + t * t * p.yS, 'shoulder');
  }
  const L = Math.hypot(p.wS - p.xs, p.yt - p.yS);
  const g = Math.max(p.gAng, Math.atan2(p.yt - p.yS, p.wS - p.xs) + 0.05);
  const sTop = (2 * p.crown) / Math.max(0.05, p.xs);
  const n3 = Math.hypot(1, sTop);
  const P1x = p.wS - Math.cos(g) * L * p.k0, P1y = p.yS + Math.sin(g) * L * p.k0;
  const P2x = p.xs + (L * p.k1) / n3, P2y = p.yt - (sTop * L * p.k1) / n3;
  for (let k = 1; k <= 9; k++) {
    const t = k / 9, u = 1 - t;
    push(
      u * u * u * p.wS + 3 * u * u * t * P1x + 3 * u * t * t * P2x + t * t * t * p.xs,
      u * u * u * p.yS + 3 * u * u * t * P1y + 3 * u * t * t * P2y + t * t * t * p.yt,
      'upper');
  }
  for (let k = 1; k <= 6; k++) {
    const t = k / 6;
    push(p.xs * (1 - t), p.yt + p.crown * (1 - (1 - t) * (1 - t)), 'top');
  }
  return pts;
}

const section = (p) => (p.mode === 'shoulder' ? sectionShoulder(p) : sectionSide(p));

// ---------------------------------------------------------------------------
// Body builder
// ---------------------------------------------------------------------------
// spec: {
//   zMin, zMax, step, extraStations: [], profile(z) -> section params,
//   classify(info) -> material index, materials: [...], capBulge
// }
// Keep sections valid: shoulder above the wheel-well opening, top above the shoulder.
export function sanitize(p) {
  p.yBelt = Math.max(p.yBelt, p.ywell + p.rB + 0.04);
  p.yt = Math.max(p.yt, p.yBelt + p.rT * 0.5 + 0.02);
  return p;
}

export function buildLoftBody(spec) {
  const zs = new Set();
  for (let z = spec.zMin; z <= spec.zMax + 1e-6; z += spec.step) zs.add(+z.toFixed(4));
  // denser near the rounded ends
  for (let k = 0; k <= 10; k++) {
    const t = k / 10;
    zs.add(+(spec.zMax - spec.endRound * t * t).toFixed(4));
    zs.add(+(spec.zMin + spec.endRound * t * t).toFixed(4));
  }
  for (const z of spec.extraStations || []) zs.add(+z.toFixed(4));
  const stations = [...zs].filter((z) => z >= spec.zMin - 1e-6 && z <= spec.zMax + 1e-6).sort((a, b) => a - b);

  const sides = stations.map((z) => section(spec.profile(z)));
  const n = sides[0].length;
  const M = 2 * n - 2;
  const S = stations.length;
  const pos = [];
  const tags = [];
  const beltAttr = [];
  // optional per-station vec4 (e.g. window line heights) for greenhouse masks
  const stAttr = spec.stationData ? [] : null;
  for (let i = 0; i < S; i++) {
    const z = stations[i];
    const side = sides[i];
    const yB = spec.profile(z).yBelt;
    const sd = stAttr ? spec.stationData(z) : null;
    for (let j = 0; j < n; j++) { pos.push(side[j].x, side[j].y, z); tags.push(side[j].tag); beltAttr.push(yB); if (sd) stAttr.push(...sd); }
    for (let j = n - 2; j >= 1; j--) { pos.push(-side[j].x, side[j].y, z); tags.push(side[j].tag); beltAttr.push(yB); if (sd) stAttr.push(...sd); }
  }
  const nMat = spec.materials.length;
  const groups = Array.from({ length: nMat }, () => []);
  const vid = (i, j) => i * M + (j % M);
  for (let i = 0; i < S - 1; i++) {
    for (let j = 0; j < M; j++) {
      const a = vid(i, j), b = vid(i, j + 1), c = vid(i + 1, j + 1), d = vid(i + 1, j);
      const cx = (pos[a * 3] + pos[b * 3] + pos[c * 3] + pos[d * 3]) / 4;
      const cy = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1] + pos[d * 3 + 1]) / 4;
      const cz = (pos[a * 3 + 2] + pos[c * 3 + 2]) / 2;
      const tag = tags[a];
      const tagB = tags[b];
      const mat = spec.classify({ x: cx, y: cy, z: cz, ax: Math.abs(cx), tag, tagB, i, j });
      groups[mat].push(a, b, c, a, c, d);
    }
  }
  // end caps with rings so the faces shade nicely and can be classified
  const capRings = 6;
  const addCap = (i, dir) => {
    const z = stations[i];
    const base = i * M;
    let cx = 0, cy = 0;
    for (let j = 0; j < M; j++) { cy += pos[(base + j) * 3 + 1]; }
    cy /= M;
    const ringStart = pos.length / 3;
    for (let r = capRings - 1; r >= 1; r--) {
      const t = r / capRings;
      for (let j = 0; j < M; j++) {
        const px = pos[(base + j) * 3], py = pos[(base + j) * 3 + 1];
        pos.push(cx + (px - cx) * t, cy + (py - cy) * t, z + dir * spec.capBulge * (1 - t * t));
        tags.push('cap');
        beltAttr.push(beltAttr[base]);
        if (stAttr) stAttr.push(...stAttr.slice(base * 4, base * 4 + 4));
      }
    }
    const centre = pos.length / 3;
    pos.push(cx, cy, z + dir * spec.capBulge);
    tags.push('cap');
    beltAttr.push(beltAttr[base]);
    if (stAttr) stAttr.push(...stAttr.slice(base * 4, base * 4 + 4));
    // ring index helper: ring 0 = the station loop itself, ring k = k-th inner ring
    const ringV = (k, j) => (k === 0 ? base + (j % M) : ringStart + (k - 1) * M + (j % M));
    for (let k = 0; k < capRings - 1; k++) {
      for (let j = 0; j < M; j++) {
        const a = ringV(k, j), b = ringV(k, j + 1), c = ringV(k + 1, j + 1), d = ringV(k + 1, j);
        const qx = (pos[a * 3] + pos[c * 3]) / 2, qy = (pos[a * 3 + 1] + pos[c * 3 + 1]) / 2;
        const mat = spec.classify({ x: qx, y: qy, z, ax: Math.abs(qx), tag: 'cap', cap: dir, i, j });
        if (dir > 0) groups[mat].push(a, b, c, a, c, d);
        else groups[mat].push(a, c, b, a, d, c);
      }
    }
    for (let j = 0; j < M; j++) {
      const a = ringV(capRings - 1, j), b = ringV(capRings - 1, j + 1);
      const qx = (pos[a * 3] + pos[b * 3]) / 2, qy = (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2;
      const mat = spec.classify({ x: qx, y: qy, z, ax: Math.abs(qx), tag: 'cap', cap: dir, i, j });
      if (dir > 0) groups[mat].push(centre, a, b);
      else groups[mat].push(centre, b, a);
    }
  };
  addCap(S - 1, 1);
  addCap(0, -1);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBelt', new THREE.Float32BufferAttribute(beltAttr, 1));
  if (stAttr) g.setAttribute('aSt', new THREE.Float32BufferAttribute(stAttr, 4));
  const index = [];
  for (let m = 0; m < nMat; m++) {
    const start = index.length;
    index.push(...groups[m]);
    if (groups[m].length) g.addGroup(start, groups[m].length, m);
  }
  g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, spec.materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, stations, profile: spec.profile };
}

// x on the body side at height y for station z (left side, x > 0), or null.
export function sideX(profile, z, y) {
  const side = section(profile(z));
  for (let k = 0; k < side.length - 1; k++) {
    const a = side[k], b = side[k + 1];
    if (a.tag === 'under' || a.tag === 'well' || a.tag === 'top') continue;
    if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) {
      const t = (y - a.y) / (b.y - a.y);
      return a.x + (b.x - a.x) * t;
    }
  }
  return null;
}

// A patch that hugs the body side over a (z, y) rectangle, offset outward.
// side = +1 (left) or -1 (right). UVs read left-to-right when seen from that side.
export function sidePatch(profile, z0, z1, y0, y1, side, offset = 0.004, nz = 24, ny = 8) {
  const pos = [], uv = [], idx = [];
  for (let iy = 0; iy <= ny; iy++) {
    const v = iy / ny;
    const y = y0 + (y1 - y0) * v;
    for (let iz = 0; iz <= nz; iz++) {
      const u = iz / nz;
      const z = z0 + (z1 - z0) * u;
      const x = (sideX(profile, z, y) ?? 0) + offset;
      pos.push(x * side, y, z);
      uv.push(side > 0 ? 1 - u : u, v);
    }
  }
  const row = nz + 1;
  for (let iy = 0; iy < ny; iy++)
    for (let iz = 0; iz < nz; iz++) {
      const a = iy * row + iz, b = a + 1, c = a + row + 1, d = a + row;
      if (side > 0) idx.push(a, d, c, a, c, b);
      else idx.push(a, b, c, a, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Greenhouse material: one physically based material that decides paint / glass / gloss
// black per pixel from car-space position, so window and pillar outlines are crisp no
// matter how coarse the mesh is. maskGLSL must set floats gm (glass) and bm (black).
// With opts.station the loft's per-station vec4 (aSt) is available to the mask as vSt.
export function greenhouseMaterial(key, paint, glass, gloss, maskGLSL, opts = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
    envMapIntensity: Math.max(paint.envMapIntensity, glass.envMapIntensity),
  });
  const st = !!opts.station;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPaint = { value: paint.color };
    shader.uniforms.uGlass = { value: glass.color };
    shader.uniforms.uGloss = { value: gloss.color };
    shader.uniforms.uRM = { value: new THREE.Vector3(paint.roughness, glass.roughness, gloss.roughness) };
    shader.uniforms.uMM = { value: new THREE.Vector3(paint.metalness, glass.metalness, gloss.metalness) };
    shader.uniforms.uCC = { value: new THREE.Vector2(paint.clearcoat ?? 1, paint.clearcoatRoughness ?? 0.03) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aBelt;
        varying vec3 vLocal;
        varying float vBelt;
        ${st ? 'attribute vec4 aSt; varying vec4 vSt;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLocal = position;
        vBelt = aBelt;
        ${st ? 'vSt = aSt;' : ''}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uPaint;
        uniform vec3 uGlass;
        uniform vec3 uGloss;
        uniform vec3 uRM;
        uniform vec3 uMM;
        uniform vec2 uCC;
        varying vec3 vLocal;
        varying float vBelt;
        ${st ? 'varying vec4 vSt;' : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float gm = 0.0, bm = 0.0;
        {
          float zz = vLocal.z, yy = vLocal.y, xx = abs(vLocal.x);
          float aa = (fwidth(zz) + fwidth(yy)) * 0.75 + 1e-4;
          ${maskGLSL}
        }
        float pm = clamp(1.0 - gm - bm, 0.0, 1.0);
        diffuseColor.rgb = uPaint * pm + uGloss * bm + uGlass * gm;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = uRM.x * pm + uRM.z * bm + uRM.y * gm;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = uMM.x * pm + uMM.z * bm + uMM.y * gm;`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat = mix(uCC.x, 1.0, 1.0 - pm);
          material.clearcoatRoughness = clamp(mix(uCC.y, 0.06, 1.0 - pm), 0.0525, 1.0);
        #endif`);
  };
  m.customProgramCacheKey = () => 'greenhouse-' + key;
  return m;
}
