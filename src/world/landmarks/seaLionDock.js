// Pier 39 sea lion dock — floating wooden platform (12 x 5 m, deck at y = 0.3)
// with lounging sea lions. Bodies and heads are InstancedMeshes so the whole
// dock is 4 draw calls; animateSeaLions(group, time) bobs the float and makes
// the sea lions breathe and lift their heads (cheap: 2 matrices per animal).

import { LandmarkBuilder, std, boxMM, rboxMM, cylY, latheGeo, M, noise3, makeRng, GeoBatch } from './common.js';
import * as THREE from 'three';

export const SEA_LION_DOCK = Object.freeze({ width: 12, depth: 5, deckY: 0.3 });

const DECK_Y = 0.3;

function lumpify(g, amp, freq, seed) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + amp * (noise3(x * freq + seed, y * freq, z * freq - seed) - 0.5);
    p.setXYZ(i, x * k, y * k, z);
  }
  g.computeVertexNormals();
  // lathe poles only touch degenerate triangles -> give them an axial normal
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) {
    if (Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) < 0.5) n.setXYZ(i, 0, 0, Math.sign(p.getZ(i)) || 1);
  }
  return g;
}

function bodyGeometry() {
  const batch = new GeoBatch(true);
  const skin = (x, y, z, nx, ny, nz, out) => {
    // darker back, lighter belly, mottled
    out.set(0x6e4c33);
    const k = 0.75 + 0.35 * (1 - (ny * 0.5 + 0.5)) + 0.15 * noise3(x * 6, y * 6, z * 6);
    out.multiplyScalar(ny > 0.2 ? 0.85 + 0.15 * noise3(x * 5, z * 5, 1) : k);
  };
  // torso: lathe along Y then laid along +Z (tail at z=0 .. chest at z=1.75)
  const torso = latheGeo([[0, 0], [0.12, 0.06], [0.24, 0.25], [0.36, 0.6], [0.43, 1.0], [0.41, 1.35], [0.3, 1.62], [0.2, 1.78], [0, 1.82]], 16, 50);
  torso.rotateX(Math.PI / 2);
  torso.scale(1, 0.72, 1);
  lumpify(torso, 0.18, 2.2, 3.1);
  batch.add(torso, [0, 0, -0.9], skin);
  // fore flippers
  for (const s of [-1, 1]) {
    const f = new THREE.SphereGeometry(1, 10, 6);
    batch.add(f, M(s * 0.42, -0.18, 0.45, 0, s * 0.5, s * 0.35, 0.34, 0.06, 0.16), 0x4a3222);
  }
  // hind flippers splayed behind
  for (const s of [-1, 1]) {
    const f = new THREE.SphereGeometry(1, 10, 6);
    batch.add(f, M(s * 0.16, -0.12, -1.0, 0, s * 0.45, 0, 0.13, 0.05, 0.3), 0x4a3222);
  }
  return batch.build();
}

function headGeometry() {
  // origin = neck pivot; head looks along +Z
  const batch = new GeoBatch(true);
  const skin = (x, y, z, nx, ny, nz, out) => {
    out.set(0x6e4c33);
    out.multiplyScalar(0.85 + 0.25 * noise3(x * 7, y * 7, z * 7));
  };
  const neck = latheGeo([[0.21, 0], [0.19, 0.18], [0.16, 0.32]], 12, 50);
  neck.rotateX(Math.PI / 3);
  batch.add(neck, null, skin);
  batch.add(new THREE.SphereGeometry(0.17, 12, 8), M(0, 0.25, 0.22, 0, 0, 0, 1, 0.92, 1.1), skin);
  batch.add(new THREE.SphereGeometry(0.1, 10, 6), M(0, 0.21, 0.4, 0, 0, 0, 0.85, 0.7, 1.2), 0x7a573d);
  batch.add(new THREE.SphereGeometry(0.035, 6, 4), [0, 0.24, 0.52], 0x1a1310);
  for (const s of [-1, 1]) {
    batch.add(new THREE.SphereGeometry(0.028, 6, 4), [s * 0.085, 0.31, 0.34], 0x0c0a09);
    batch.add(new THREE.SphereGeometry(0.02, 4, 3), [s * 0.12, 0.33, 0.24], 0x4a3222); // ear
  }
  return batch.build();
}

export function createSeaLionDock() {
  const B = new LandmarkBuilder('SeaLionDock');
  const rand = makeRng(39);

  const woodMat = std({ name: 'sld-wood', color: 0xffffff, vertexColors: true, roughness: 0.92 });
  const floatMat = std({ name: 'sld-floats', color: 0xffffff, vertexColors: true, roughness: 0.6, metalness: 0.2 });
  const wood = B.part('wood', woodMat);
  const floats = B.part('floats', floatMat);

  // ---------------------------------------------------------------- dock
  const HX = 6, HZ = 2.5;
  const nPl = 20;
  for (let i = 0; i < nPl; i++) {
    const z0 = -HZ + (i * 2 * HZ) / nPl + 0.012, z1 = -HZ + ((i + 1) * 2 * HZ) / nPl - 0.012;
    const tone = 0.75 + 0.35 * rand();
    wood.add(boxMM(-HX, DECK_Y - 0.08, z0, HX, DECK_Y, z1), null, (x, y, z, nx, ny, nz, out) => {
      out.set(0x8c7259);
      out.multiplyScalar(tone * (0.85 + 0.25 * noise3(x * 1.5, i, z * 4)));
    });
  }
  for (const z of [-HZ + 0.15, 0, HZ - 0.15]) wood.add(boxMM(-HX + 0.1, DECK_Y - 0.28, z - 0.12, HX - 0.1, DECK_Y - 0.08, z + 0.12), null, 0x4d3b2b);
  for (const s of [-1, 1]) {
    wood.add(boxMM(-HX - 0.08, DECK_Y - 0.3, s * HZ - 0.08, HX + 0.08, DECK_Y + 0.06, s * HZ + 0.08), null, 0x5a4532);
    wood.add(boxMM(s * HX - 0.08, DECK_Y - 0.3, -HZ - 0.08, s * HX + 0.08, DECK_Y + 0.06, HZ + 0.08), null, 0x5a4532);
  }
  // black float drums (mostly below the waterline)
  for (const x of [-4.5, -1.5, 1.5, 4.5]) {
    for (const z of [-1.4, 1.4]) {
      floats.add(rboxMM(x - 1.2, -0.55, z - 0.85, x + 1.2, DECK_Y - 0.28, z + 0.85, 0.25, 2), null, (px, py, pz, nx, ny, nz, out) => {
        out.set(0x1d1f22);
        if (py > -0.05 && py < 0.08) out.set(0x3b4a3a); // algae line
      });
    }
  }
  // cleats + a few weathered bumpers
  for (const x of [-5.4, 0, 5.4]) {
    for (const s of [-1, 1]) {
      floats.add(boxMM(x - 0.2, DECK_Y, s * (HZ - 0.12) - 0.05, x + 0.2, DECK_Y + 0.08, s * (HZ - 0.12) + 0.05), null, 0x8d9295);
    }
  }
  for (const x of [-4.4, -1.5, 1.5, 4.4]) {
    for (const s of [-1, 1]) floats.add(cylY(0.13, 0.13, -0.1, DECK_Y + 0.02, 10, false, x, s * (HZ + 0.22)), null, 0x2a2a2a);
  }
  B.collider(0, 0, HX + 0.2, HZ + 0.25, 1.4);

  // ---------------------------------------------------------------- sea lions (instanced)
  const lionMat = std({ name: 'sld-sealions', color: 0xffffff, vertexColors: true, roughness: 0.38, metalness: 0.05 });
  const COUNT = 7;
  const bodies = new THREE.InstancedMesh(bodyGeometry(), lionMat, COUNT);
  const heads = new THREE.InstancedMesh(headGeometry(), lionMat, COUNT);
  bodies.name = 'SeaLionDock.bodies';
  heads.name = 'SeaLionDock.heads';
  for (const m of [bodies, heads]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  const spots = [
    // x, z, yaw, scale, pitch0, roll (lying on side)
    [-4.4, -0.9, 0.4, 1.1, -0.35, 0.0],
    [-2.6, 1.0, 2.6, 0.95, 0.55, 0.0],
    [-0.6, -1.1, -0.2, 1.15, -0.2, 0.35],
    [1.2, 0.9, 3.5, 0.9, 0.9, 0.0],
    [2.9, -0.7, 1.2, 1.05, 0.1, -0.25],
    [4.6, 1.0, -2.4, 0.62, 0.4, 0.0], // pup
    [4.4, -1.3, 2.0, 1.0, -0.45, 0.0],
  ];
  const tint = new THREE.Color();
  const data = spots.map(([x, z, yaw, scale, pitch0, roll], i) => {
    tint.setRGB(0.8 + 0.4 * rand(), 0.8 + 0.35 * rand(), 0.8 + 0.3 * rand());
    if (i === 3) tint.setRGB(1.25, 1.15, 1.0); // a sun-dried blond one
    bodies.setColorAt(i, tint);
    heads.setColorAt(i, tint);
    return { x, z, yaw, scale, pitch0, roll, phase: rand() * Math.PI * 2, speed: 0.35 + rand() * 0.4 };
  });
  const flt = new THREE.Group();
  flt.name = 'SeaLionDock.float';
  flt.add(bodies, heads);
  B.addObject(flt);
  const group = B.finish({ seaLions: { bodies, heads, data, float: flt } });
  // move the dock meshes under the float group so they bob together
  for (const child of group.children.slice()) {
    if (child !== flt) flt.add(child);
  }
  animateSeaLions(group, 0);
  bodies.computeBoundingSphere();
  heads.computeBoundingSphere();
  if (bodies.boundingSphere) bodies.boundingSphere.radius += 1;
  if (heads.boundingSphere) heads.boundingSphere.radius += 1;
  return group;
}

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

/** Cheap idle animation: dock bob, breathing, occasional head raises. */
export function animateSeaLions(group, time) {
  const sl = group && group.userData && group.userData.seaLions;
  if (!sl) return;
  const t = time || 0;
  sl.float.position.y = 0.035 * Math.sin(t * 1.1);
  sl.float.rotation.z = 0.012 * Math.sin(t * 0.83);
  sl.float.rotation.x = 0.008 * Math.sin(t * 0.61 + 1);
  sl.data.forEach((d, i) => {
    const breathe = 1 + 0.035 * Math.sin(t * 1.7 + d.phase);
    const s = d.scale;
    const bodyH = 0.3 * 0.72 * s; // half height of the flattened torso
    // body
    _e.set(0, d.yaw, d.roll, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(d.x, DECK_Y + bodyH * 0.92, d.z);
    _s.set(s, s * breathe, s);
    _m.compose(_p, _q, _s);
    sl.bodies.setMatrixAt(i, _m);
    // head: pivot at the neck (local z = +0.85 on the body), pitch up/down
    const lift = Math.pow(Math.max(0, Math.sin(t * d.speed + d.phase)), 3);
    const pitch = -(d.pitch0 + 0.55 * lift) + 0.06 * Math.sin(t * 2.3 + d.phase);
    const yawWobble = 0.25 * Math.sin(t * 0.7 * d.speed + d.phase * 2) * lift;
    _p.set(0, 0.04, 0.82).applyMatrix4(_m);
    _e.set(pitch, d.yaw + yawWobble, d.roll * 0.5, 'YXZ');
    _q.setFromEuler(_e);
    _s.set(s, s, s);
    _m2.compose(_p, _q, _s);
    sl.heads.setMatrixAt(i, _m2);
  });
  sl.bodies.instanceMatrix.needsUpdate = true;
  sl.heads.instanceMatrix.needsUpdate = true;
}
