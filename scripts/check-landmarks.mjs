#!/usr/bin/env node
// Headless validation for the procedural landmark models.
//
//   node scripts/check-landmarks.mjs            # plain Node (no DOM): textures skipped
//   node scripts/check-landmarks.mjs --mock-dom # fake <canvas> so texture code paths run too
//
// For every factory exported by src/world/landmarks/index.js it reports draw calls,
// triangles, bounding box and collider count, and asserts: no NaN/Infinity in
// vertex data, unit normals, (almost) no inverted faces, night-material contract,
// sane colliders, and the per-landmark draw-call / triangle budgets.

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const landmarkDir = path.resolve(here, '../src/world/landmarks');
const useMockDom = process.argv.includes('--mock-dom');

// ---------------------------------------------------------------- syntax check
let failures = 0;
for (const f of readdirSync(landmarkDir).filter((f) => f.endsWith('.js'))) {
  const r = spawnSync(process.execPath, ['--check', path.join(landmarkDir, f)], { encoding: 'utf8' });
  if (r.status !== 0) {
    failures++;
    console.error(`node --check failed for ${f}\n${r.stderr}`);
  }
}

// ---------------------------------------------------------------- optional DOM mock
if (useMockDom) {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  globalThis.document = {
    createElement(tag) {
      const canvas = {
        width: 300,
        height: 150,
        style: {},
        getContext() {
          const state = {
            canvas,
            measureText: (t) => ({ width: String(t).length * (parseFloat(/(\d+)px/.exec(state.font || '10px')?.[1]) || 10) * 0.6 }),
            createLinearGradient: () => gradient,
            createRadialGradient: () => gradient,
            createPattern: () => ({}),
            getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
            createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
          };
          return new Proxy(state, {
            get: (t, p) => (p in t ? t[p] : noop),
            set: (t, p, v) => ((t[p] = v), true),
          });
        },
      };
      return tag === 'canvas' ? canvas : { style: {} };
    },
  };
}

const THREE = await import('three');
const L = await import('../src/world/landmarks/index.js');

const BUDGET = {
  createGoldenGateBridge: { draws: 14, tris: 160000 },
  createBayBridge: { draws: 14, tris: 100000 },
};
const DEFAULT_BUDGET = { draws: 10, tris: 40000 };

const factories = Object.keys(L).filter((k) => k.startsWith('create') && typeof L[k] === 'function');
if (!L.LANDMARK_INFO) {
  failures++;
  console.error('LANDMARK_INFO export missing');
}

const fmt = (n) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1));
const rows = [];

for (const name of factories) {
  const errors = [];
  const warnings = [];
  let group;
  const t0 = performance.now();
  try {
    group = L[name]();
  } catch (err) {
    failures++;
    console.error(`${name}: threw ${err.stack}`);
    continue;
  }
  const ms = performance.now() - t0;
  if (!group || !group.isObject3D) {
    failures++;
    console.error(`${name}: did not return an Object3D`);
    continue;
  }
  group.updateMatrixWorld(true);

  let draws = 0, tris = 0, inverted = 0, checkedTris = 0;
  const usedMaterials = new Set();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const na = new THREE.Vector3(), nb = new THREE.Vector3(), nc = new THREE.Vector3();
  const fnorm = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();

  group.traverse((o) => {
    if (!(o.isMesh || o.isLine || o.isPoints)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => usedMaterials.add(m));
    draws += Array.isArray(o.material) ? Math.max(1, o.geometry.groups.length) : 1;
    const g = o.geometry;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    if (!pos) {
      errors.push(`${o.name}: no position attribute`);
      return;
    }
    const t = (g.index ? g.index.count : pos.count) / 3;
    tris += t * (o.isInstancedMesh ? o.count : 1);
    for (const attrName of Object.keys(g.attributes)) {
      const arr = g.attributes[attrName].array;
      for (let i = 0; i < arr.length; i++) {
        if (!Number.isFinite(arr[i])) {
          errors.push(`${o.name}: non-finite value in ${attrName}`);
          break;
        }
      }
    }
    if (g.index) {
      const ia = g.index.array;
      for (let i = 0; i < ia.length; i++) {
        if (ia[i] >= pos.count) {
          errors.push(`${o.name}: index out of range`);
          break;
        }
      }
    }
    if (o.isInstancedMesh) {
      const arr = o.instanceMatrix.array;
      for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) {
        errors.push(`${o.name}: non-finite instance matrix`);
        break;
      }
    }
    if (!nor) {
      errors.push(`${o.name}: no normals`);
      return;
    }
    let badLen = 0;
    for (let i = 0; i < nor.count; i++) {
      const l = Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i));
      if (Math.abs(l - 1) > 0.02) badLen++;
    }
    if (badLen) errors.push(`${o.name}: ${badLen} non-unit normals`);
    // inverted faces: geometric normal vs. interpolated vertex normal
    const mat = mats[0];
    if (mat.side === THREE.DoubleSide) return;
    const idx = g.index ? g.index.array : null;
    for (let f = 0; f < t; f++) {
      const i0 = idx ? idx[f * 3] : f * 3, i1 = idx ? idx[f * 3 + 1] : f * 3 + 1, i2 = idx ? idx[f * 3 + 2] : f * 3 + 2;
      a.fromBufferAttribute(pos, i0);
      b.fromBufferAttribute(pos, i1);
      c.fromBufferAttribute(pos, i2);
      e1.subVectors(b, a);
      e2.subVectors(c, a);
      fnorm.crossVectors(e1, e2);
      const area2 = fnorm.length();
      if (area2 < 1e-7) continue;
      fnorm.divideScalar(area2);
      na.fromBufferAttribute(nor, i0);
      nb.fromBufferAttribute(nor, i1);
      nc.fromBufferAttribute(nor, i2);
      na.add(nb).add(nc);
      checkedTris++;
      if (na.lengthSq() > 1e-6 && fnorm.dot(na.normalize()) < -0.2) inverted++;
    }
  });

  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  for (const v of [box.min, box.max]) {
    if (![v.x, v.y, v.z].every(Number.isFinite)) errors.push('bounding box not finite');
  }

  const budget = BUDGET[name] || DEFAULT_BUDGET;
  if (draws > budget.draws) errors.push(`draw calls ${draws} > budget ${budget.draws}`);
  if (tris > budget.tris) errors.push(`triangles ${tris} > budget ${budget.tris}`);
  const invPct = checkedTris ? (100 * inverted) / checkedTris : 0;
  if (invPct > 0.5) errors.push(`${inverted} inverted triangles (${invPct.toFixed(2)}%)`);
  else if (inverted > 0) warnings.push(`${inverted} triangles with normals opposing winding (${invPct.toFixed(3)}%)`);

  const colliders = group.userData.colliders;
  if (!Array.isArray(colliders)) errors.push('userData.colliders missing');
  else {
    for (const col of colliders) {
      const ok = ['x', 'z', 'hx', 'hz', 'h'].every((k) => Number.isFinite(col[k])) && col.hx > 0 && col.hz > 0 && col.h > 0;
      if (!ok) errors.push(`bad collider ${JSON.stringify(col)}`);
      else if (col.x - col.hx < box.min.x - 2 || col.x + col.hx > box.max.x + 2 || col.z - col.hz < box.min.z - 2 || col.z + col.hz > box.max.z + 2) {
        warnings.push(`collider outside bbox ${JSON.stringify(col)}`);
      }
    }
  }

  const night = group.userData.nightMaterials;
  if (!Array.isArray(night)) errors.push('userData.nightMaterials missing');
  else {
    for (const m of night) {
      if (!m || !m.isMaterial) errors.push('nightMaterials contains a non-material');
      else {
        if (m.emissiveIntensity !== 0) errors.push(`${m.type} night material emissiveIntensity=${m.emissiveIntensity} (expected 0)`);
        if (!(m.userData.nightIntensity > 0)) errors.push('night material without userData.nightIntensity');
        if (!m.emissive || (m.emissive.r === 0 && m.emissive.g === 0 && m.emissive.b === 0)) errors.push('night material with black emissive');
        if (!usedMaterials.has(m)) errors.push('night material not used by any mesh');
      }
    }
  }
  for (const m of usedMaterials) {
    if (m.emissiveIntensity > 0 && m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0) {
      warnings.push(`material "${m.name || m.type}" emits during the day (emissiveIntensity ${m.emissiveIntensity})`);
    }
  }

  if (errors.length) failures++;
  rows.push({
    name,
    draws,
    tris,
    box,
    size,
    colliders: Array.isArray(colliders) ? colliders.length : 0,
    night: Array.isArray(night) ? night.length : 0,
    ms,
    errors,
    warnings,
  });
}

// ---------------------------------------------------------------- report
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
console.log(`\nLandmark check (${useMockDom ? 'mock DOM: canvas textures exercised' : 'no DOM: textures skipped'})\n`);
console.log(
  pad('factory', 30) + lpad('draws', 6) + lpad('tris', 9) + lpad('colliders', 10) + lpad('night', 6) + lpad('ms', 7) + '   bbox min -> max (size)',
);
for (const r of rows) {
  const bb = `[${fmt(r.box.min.x)}, ${fmt(r.box.min.y)}, ${fmt(r.box.min.z)}] -> [${fmt(r.box.max.x)}, ${fmt(r.box.max.y)}, ${fmt(r.box.max.z)}]  (${fmt(r.size.x)} x ${fmt(r.size.y)} x ${fmt(r.size.z)})`;
  console.log(
    pad(r.name, 30) + lpad(r.draws, 6) + lpad(r.tris, 9) + lpad(r.colliders, 10) + lpad(r.night, 6) + lpad(r.ms.toFixed(0), 7) + '   ' + bb,
  );
  for (const e of r.errors) console.log(`    ERROR: ${e}`);
  for (const w of r.warnings) console.log(`    warn:  ${w}`);
}

// animate hook smoke test
if (typeof L.animateSeaLions === 'function' && typeof L.createSeaLionDock === 'function') {
  try {
    const dock = L.createSeaLionDock();
    for (let t = 0; t < 5; t += 0.37) L.animateSeaLions(dock, t);
    console.log('\nanimateSeaLions(): ok');
  } catch (err) {
    failures++;
    console.error(`animateSeaLions threw: ${err.stack}`);
  }
}

const total = rows.reduce((s, r) => s + r.tris, 0);
console.log(`\n${rows.length} factories, ${total} triangles total, ${failures} failing\n`);
process.exit(failures ? 1 : 0);
