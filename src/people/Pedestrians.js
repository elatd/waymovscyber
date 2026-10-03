// Pedestrians: walk around block sidewalks, dive out of the way of speeding robotaxis
// (Crazy Taxi style), wait / wave as passengers, board and exit taxis. Bodies come from
// HumanBody.js (rigged, animated in the vertex shader) — each person gets a sex, height,
// build, skin tone, hairstyle, outfit and accessories; drawn in near / far detail groups.
import * as THREE from 'three';
import * as L from '../world/CityLayout.js';
import { mulberry32, clamp, wrapAngle } from '../core/math.js';
import { buildHumanGeometry, humanMaterials, OPT, LOOK } from './HumanBody.js';

// realistic, mostly muted palettes (weights favour everyday colours)
const SKIN = ['#f7dcc8', '#efcfb4', '#e7c09f', '#dcae86', '#c8956b', '#b07b52', '#946042', '#7a4a30', '#5e3722', '#45281a'];
const HAIR = [['#16110d', 4], ['#2a1d15', 4], ['#3f2b1d', 3], ['#5b3e28', 2], ['#7b5636', 1.4], ['#a37a4c', 1], ['#c9a66d', 1], ['#7d3a1d', 0.8], ['#8f8f8f', 0.8], ['#d4d2cc', 0.5], ['#6e3fa0', 0.12], ['#c2185b', 0.12]];
const TOPS = [['#ecebe7', 3], ['#1d1d1f', 3], ['#8b8e93', 2.5], ['#1f2a44', 2.5], ['#3d5a80', 1.5], ['#556b2f', 1.2], ['#6d1f2a', 1], ['#c9b79c', 1.2], ['#b5885a', 1], ['#2f4f3a', 1], ['#90b3d8', 1], ['#c99a2e', 0.7], ['#d9735c', 0.7], ['#a8232c', 0.8], ['#e6a7b8', 0.6], ['#2a7f7a', 0.6], ['#5a3b24', 0.8], ['#38393d', 1.5], ['#f2efe3', 1], ['#4b5d73', 1], ['#a3b18a', 0.6]];
const COATS = [['#1d1d1f', 3], ['#38393d', 2], ['#5a3b24', 1.5], ['#b5885a', 2], ['#1f2a44', 2], ['#6b6f47', 1], ['#8b8e93', 1], ['#6d1f2a', 0.6]];
const BOTTOMS = [['#2f4b6e', 3], ['#3e5f8a', 2], ['#1f2f45', 2], ['#1b1b1d', 3], ['#b89f74', 1.5], ['#5f6368', 1.5], ['#23304a', 1.2], ['#4d5534', 0.8], ['#cbb99a', 1], ['#2a2a2c', 1], ['#6b4a35', 0.6]];
const SKIRTS = [['#1b1b1d', 3], ['#23304a', 1.5], ['#6d1f2a', 1], ['#cbb99a', 1], ['#5f6368', 1], ['#2f4b6e', 1], ['#b5885a', 0.8], ['#556b2f', 0.6], ['#e6a7b8', 0.4]];
const SHOES = [['#ebebeb', 3], ['#1a1a1a', 3], ['#4a2f1d', 1.5], ['#7a7d80', 1], ['#9a7b55', 1], ['#2b2b2b', 1], ['#b8322c', 0.4], ['#2e5aa8', 0.4]];
const ACCENTS = [['#1b1b1d', 3], ['#23304a', 1.5], ['#556b2f', 1], ['#9a7b55', 1.2], ['#a8232c', 0.8], ['#5f6368', 1], ['#c9a66d', 0.8], ['#2a7f7a', 0.6]];
const WALKING = new Set(['walk', 'walkTo', 'returnSpot', 'board']);
const NEAR = 30; // metres: full-detail bodies (faces, fingers, straps) inside this radius

function weighted(r, list) {
  let total = 0;
  for (const [, w] of list) total += w;
  let x = r() * total;
  for (const [v, w] of list) { x -= w; if (x <= 0) return v; }
  return list[list.length - 1][0];
}

export class Pedestrians {
  constructor(scene, count = 140) {
    this.scene = scene;
    this.count = count;
    this.rng = mulberry32(31337);
    this.peds = [];
    this.time = 0;
    this.capacity = count;
    // one instanced draw per body type (m / f) and detail level (near / far)
    this.groups = {};
    this.uniforms = [];
    for (const sex of ['m', 'f']) {
      const { mat, depth, uniforms } = humanMaterials(sex);
      this.uniforms.push(uniforms);
      for (const lod of [0, 1]) {
        const base = buildHumanGeometry(sex, lod);
        const g = new THREE.InstancedBufferGeometry();
        g.index = base.index;
        for (const k of ['position', 'normal', 'aRig']) g.setAttribute(k, base.attributes[k]);
        const attrs = {};
        for (const [name, size] of [['iPH', 4], ['iBody', 4], ['iAnim', 4], ['iPose', 4], ['iSkin', 3], ['iTop', 3], ['iBottom', 3], ['iHair', 3], ['iAccent', 3], ['iShoes', 3]]) {
          const a = new THREE.InstancedBufferAttribute(new Float32Array(count * size), size);
          a.setUsage(THREE.DynamicDrawUsage);
          g.setAttribute(name, a);
          attrs[name] = a;
        }
        g.instanceCount = 0;
        const mesh = new THREE.Mesh(g, mat);
        mesh.customDepthMaterial = depth;
        mesh.frustumCulled = false;
        mesh.castShadow = lod === 0;
        mesh.receiveShadow = true;
        mesh.name = `crowd-${sex}${lod}`;
        scene.add(mesh);
        this.groups[sex + lod] = { mesh, g, attrs, n: 0 };
      }
    }
    for (let k = 0; k < count; k++) this.peds.push(this.make(k));
  }

  make(id) {
    const r = this.rng;
    const col = (list) => new THREE.Color(weighted(r, list));
    const female = r() < 0.5;
    const heightM = female ? 1.55 + r() * 0.18 : 1.66 + r() * 0.21;
    let flags = 0;
    const hr = r();
    if (female) flags |= hr < 0.5 ? OPT.hairLong : hr < 0.75 ? OPT.hairBun : hr < 0.93 ? OPT.hairShort : OPT.hairShort | OPT.cap;
    else flags |= hr < 0.66 ? OPT.hairShort : hr < 0.79 ? 0 : hr < 0.93 ? OPT.hairShort | OPT.cap : OPT.hairLong;
    if (!female && r() < 0.3) flags |= LOOK.beard;
    const coat = r() < 0.18;
    const skirt = female && !coat && r() < 0.32;
    const shorts = !skirt && !coat && r() < 0.13;
    if (coat) flags |= OPT.coat | LOOK.longSleeves;
    else if (r() < 0.45) flags |= LOOK.longSleeves;
    if (skirt) flags |= OPT.skirt | LOOK.bareShins;
    if (shorts) flags |= LOOK.bareShins | LOOK.bareThighs;
    if (r() < 0.2) flags |= OPT.backpack;
    else if (r() < (female ? 0.42 : 0.1)) flags |= OPT.bag;
    if (r() < 0.12) flags |= OPT.glasses;
    const phone = r() < 0.22;
    if (phone) flags |= OPT.phone;
    const grey = r() < 0.12; // older folks
    return {
      id, active: false,
      pos: new THREE.Vector3(), heading: 0, speed: 1.15 + r() * 0.5,
      sex: female ? 'f' : 'm',
      hs: heightM / (female ? 1.65 : 1.76), ws: 0.9 + r() * 0.2 + (r() < 0.12 ? 0.16 : 0),
      flags, phone,
      skin: new THREE.Color(SKIN[Math.floor(r() * SKIN.length)]),
      top: col(coat ? COATS : TOPS), bottom: col(skirt ? SKIRTS : BOTTOMS), shoes: col(SHOES), accent: col(ACCENTS),
      hair: grey ? new THREE.Color(r() < 0.5 ? '#9a9a96' : '#d4d2cc') : col(HAIR),
      seed: r(),
      phase: r() * 10,
      walkW: 0,
      state: 'walk', t: 0,
      loop: null, seg: 0, segU: 0, cw: r() < 0.5,
      diveDir: [0, 0], diveH: 0, diveVy: 0,
      wave: 0, passenger: null,
      targetX: 0, targetZ: 0,
      lean: 0, leanSide: 0,
    };
  }

  // Sidewalk walking loop for block (i,j): 4 corners (walkway 2m from the curb)
  loopFor(i, j) {
    const off = L.ROAD_HALF + 2.2;
    const x0 = L.lineX(i) + off, x1 = L.lineX(i + 1) - off;
    const z0 = L.lineZ(j) + off, z1 = L.lineZ(j + 1) - off;
    return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  }

  spawn(p, px, pz, minD, maxD) {
    for (let tries = 0; tries < 20; tries++) {
      const i = Math.floor(this.rng() * L.N), j = Math.floor(this.rng() * L.N);
      const loop = this.loopFor(i, j);
      const seg = Math.floor(this.rng() * 4);
      const u = this.rng();
      const a = loop[seg], b = loop[(seg + 1) % 4];
      const x = a[0] + (b[0] - a[0]) * u, z = a[1] + (b[1] - a[1]) * u;
      const d = Math.hypot(x - px, z - pz);
      if (d < minD || d > maxD) continue;
      p.loop = loop; p.seg = seg; p.segU = u;
      p.pos.set(x, L.groundHeight(x, z), z);
      p.state = 'walk';
      p.active = true;
      p.t = 0;
      p.diveH = 0;
      p.lean = 0;
      return true;
    }
    return false;
  }

  // Take a pedestrian and turn it into a waiting passenger at (x,z)
  claim(x, z, facing) {
    let best = null;
    for (const p of this.peds) if (!p.active) { best = p; break; }
    if (!best) {
      // steal the farthest walker
      let bd = -1;
      for (const p of this.peds) {
        if (p.passenger) continue;
        const d = Math.hypot(p.pos.x - x, p.pos.z - z);
        if (d > bd) { bd = d; best = p; }
      }
    }
    if (!best) return null;
    best.active = true;
    best.state = 'wait';
    best.pos.set(x, L.groundHeight(x, z), z);
    best.heading = facing;
    best.t = 0;
    best.diveH = 0;
    best.lean = 0;
    return best;
  }

  release(p, x, z) {
    p.passenger = null;
    if (x !== undefined) p.pos.set(x, L.groundHeight(x, z), z);
    // walk away on the nearest block loop
    const i = clamp(Math.floor((p.pos.x - L.ORIGIN) / L.S), 0, L.N - 1);
    const j = clamp(Math.floor((p.pos.z - L.ORIGIN) / L.S), 0, L.N - 1);
    p.loop = this.loopFor(i, j);
    p.seg = Math.floor(this.rng() * 4);
    p.segU = 0.5;
    p.state = 'walkTo';
    const a = p.loop[p.seg], b = p.loop[(p.seg + 1) % 4];
    p.targetX = (a[0] + b[0]) / 2;
    p.targetZ = (a[1] + b[1]) / 2;
  }

  update(dt, ctx) {
    this.time += dt;
    const cam = ctx.camera.position;
    const cars = ctx.cars; // [{pos, vel, speed}]
    const px = ctx.focus.x, pz = ctx.focus.z;
    let active = 0;
    for (const p of this.peds) {
      if (p.active && !p.passenger && p.state !== 'hidden') {
        const d = Math.hypot(p.pos.x - px, p.pos.z - pz);
        if (d > 230) p.active = false;
      }
      if (!p.active && active < this.count) {
        if (this.spawn(p, px, pz, this._init ? 110 : 10, 200)) active++;
      } else if (p.active) active++;
    }
    this._init = true;
    for (const p of this.peds) {
      if (!p.active) continue;
      this.think(p, dt, cars);
    }
    this.render(cam);
  }

  think(p, dt, cars) {
    p.t += dt;
    // dodge speeding cars (unless already boarding / hidden)
    if (p.state === 'walk' || p.state === 'wait' || p.state === 'walkTo' || p.state === 'idle') {
      for (const c of cars) {
        const sp = Math.hypot(c.vel.x, c.vel.z);
        if (sp < 5) continue;
        const rx = p.pos.x - c.pos.x, rz = p.pos.z - c.pos.z;
        const dist = Math.hypot(rx, rz);
        if (dist > 16) continue;
        const vx = c.vel.x / sp, vz = c.vel.z / sp;
        const ahead = rx * vx + rz * vz;
        const lat = rx * vz - rz * vx;
        if (ahead > -1 && ahead < 4 + sp * 0.45 && Math.abs(lat) < 2.6) {
          const side = lat >= 0 ? 1 : -1;
          p.prevState = p.state === 'wait' ? 'wait' : 'walk';
          p.state = 'dive';
          p.t = 0;
          p.diveDir = [vz * side, -vx * side];
          p.diveVy = 4.2;
          p.diveH = 0;
          p.heading = Math.atan2(p.diveDir[0], p.diveDir[1]);
          p.leanSide = side;
          if (this.onDive) this.onDive(p, c);
          break;
        }
      }
    }
    switch (p.state) {
      case 'walk': {
        const a = p.loop[p.seg], b = p.loop[(p.seg + 1) % 4];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const dir = p.cw ? 1 : -1;
        p.segU += (dir * p.speed * dt) / len;
        if (p.segU > 1) { p.seg = (p.seg + 1) % 4; p.segU -= 1; }
        if (p.segU < 0) { p.seg = (p.seg + 3) % 4; p.segU += 1; }
        const a2 = p.loop[p.seg], b2 = p.loop[(p.seg + 1) % 4];
        const x = a2[0] + (b2[0] - a2[0]) * p.segU, z = a2[1] + (b2[1] - a2[1]) * p.segU;
        const hx = (b2[0] - a2[0]) * dir, hz = (b2[1] - a2[1]) * dir;
        p.heading += wrapAngle(Math.atan2(hx, hz) - p.heading) * Math.min(1, dt * 6);
        p.pos.set(x, L.groundHeight(x, z), z);
        p.phase += dt * p.speed * 4.6;
        if (Math.random() < dt * 0.02) { p.state = 'idle'; p.t = 0; }
        break;
      }
      case 'idle':
        if (p.t > 3) { p.state = 'walk'; p.t = 0; }
        break;
      case 'walkTo': {
        const dx = p.targetX - p.pos.x, dz = p.targetZ - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.5) { p.state = 'walk'; break; }
        p.heading += wrapAngle(Math.atan2(dx, dz) - p.heading) * Math.min(1, dt * 6);
        const s = Math.min(d, p.speed * 1.4 * dt);
        p.pos.x += (dx / d) * s; p.pos.z += (dz / d) * s;
        p.pos.y = L.groundHeight(p.pos.x, p.pos.z);
        p.phase += dt * p.speed * 5.6;
        break;
      }
      case 'dive': {
        const s = p.t < 0.55 ? 7.5 : 0;
        p.pos.x += p.diveDir[0] * s * dt;
        p.pos.z += p.diveDir[1] * s * dt;
        p.diveVy -= 18 * dt;
        p.diveH = Math.max(0, p.diveH + p.diveVy * dt);
        p.pos.y = L.groundHeight(p.pos.x, p.pos.z) + p.diveH;
        p.lean = Math.min(1.35, p.lean + dt * 5);
        if (p.t > 1.6) {
          p.state = 'getup';
          p.t = 0;
        }
        break;
      }
      case 'getup':
        p.lean = Math.max(0, p.lean - dt * 2.5);
        p.pos.y = L.groundHeight(p.pos.x, p.pos.z);
        if (p.lean <= 0) {
          if (p.prevState === 'wait' && p.passenger) {
            p.state = 'wait';
            if (p.passenger.spot) { p.targetX = p.passenger.spot.x; p.targetZ = p.passenger.spot.z; p.state = 'returnSpot'; }
          } else {
            // rejoin the nearest loop point
            p.state = 'walkTo';
            const a = p.loop[p.seg], b = p.loop[(p.seg + 1) % 4];
            p.targetX = a[0] + (b[0] - a[0]) * p.segU;
            p.targetZ = a[1] + (b[1] - a[1]) * p.segU;
          }
          p.t = 0;
        }
        break;
      case 'returnSpot': {
        const dx = p.targetX - p.pos.x, dz = p.targetZ - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.4) { p.state = 'wait'; p.t = 0; break; }
        p.heading = Math.atan2(dx, dz);
        const s = Math.min(d, 2.2 * dt);
        p.pos.x += (dx / d) * s; p.pos.z += (dz / d) * s;
        p.pos.y = L.groundHeight(p.pos.x, p.pos.z);
        p.phase += dt * 9;
        break;
      }
      case 'wait':
        p.pos.y = L.groundHeight(p.pos.x, p.pos.z);
        break;
      case 'board': {
        // run to the car door then vanish
        const dx = p.targetX - p.pos.x, dz = p.targetZ - p.pos.z;
        const d = Math.hypot(dx, dz);
        p.heading = Math.atan2(dx, dz);
        const s = Math.min(d, 6 * dt);
        if (d > 0.01) { p.pos.x += (dx / d) * s; p.pos.z += (dz / d) * s; }
        p.diveH = Math.sin(Math.min(1, p.t / 0.5) * Math.PI) * 0.6;
        p.pos.y = L.groundHeight(p.pos.x, p.pos.z) + p.diveH;
        p.phase += dt * 14;
        if (d < 0.6 || p.t > 1.2) { p.state = 'hidden'; p.t = 0; }
        break;
      }
      case 'celebrate':
        p.pos.y = L.groundHeight(p.pos.x, p.pos.z) + Math.max(0, Math.sin(p.t * 9)) * 0.35;
        if (p.t > 2.2) this.release(p);
        break;
      case 'hidden':
      default:
        break;
    }
    p.walkW += ((WALKING.has(p.state) ? 1 : 0) - p.walkW) * Math.min(1, dt * 6);
  }

  render(cam) {
    const G = this.groups;
    for (const k in G) G[k].n = 0;
    const T = this.time;
    for (const u of this.uniforms) u.uTime.value = T;
    for (const p of this.peds) {
      if (!p.active || p.state === 'hidden') continue;
      const dx = p.pos.x - cam.x, dz = p.pos.z - cam.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 170 * 170) continue;
      const grp = G[p.sex + (d2 < NEAR * NEAR ? 0 : 1)];
      if (grp.n >= this.capacity) continue;
      const i = grp.n++;
      const A = grp.attrs;
      const diving = p.state === 'dive' || p.state === 'getup';
      const waiting = p.state === 'wait';
      const usingPhone = p.phone && !waiting && !diving && p.state !== 'celebrate' && p.state !== 'board' ? 1 : 0;
      A.iPH.setXYZW(i, p.pos.x, p.pos.y, p.pos.z, p.heading);
      A.iBody.setXYZW(i, p.hs, p.ws, usingPhone ? p.flags : p.flags & ~OPT.phone, diving ? p.lean : 0);
      A.iAnim.setXYZW(i, p.phase, p.walkW, p.state === 'board' ? 1 : p.state === 'returnSpot' ? 0.5 : 0, p.seed);
      A.iPose.setXYZW(i, waiting ? 0.3 + 0.7 * p.wave : 0, p.state === 'celebrate' ? 1 : 0, usingPhone, diving ? Math.min(1, p.lean) : 0);
      A.iSkin.setXYZ(i, p.skin.r, p.skin.g, p.skin.b);
      A.iTop.setXYZ(i, p.top.r, p.top.g, p.top.b);
      A.iBottom.setXYZ(i, p.bottom.r, p.bottom.g, p.bottom.b);
      A.iHair.setXYZ(i, p.hair.r, p.hair.g, p.hair.b);
      A.iAccent.setXYZ(i, p.accent.r, p.accent.g, p.accent.b);
      A.iShoes.setXYZ(i, p.shoes.r, p.shoes.g, p.shoes.b);
    }
    for (const k in G) {
      const grp = G[k];
      grp.g.instanceCount = grp.n;
      if (!grp.n) continue;
      for (const a of Object.values(grp.attrs)) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, grp.n * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }
}
