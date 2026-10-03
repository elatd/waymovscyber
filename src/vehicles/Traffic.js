// AI traffic: lane following on the street grid, traffic lights, car-following, turns,
// and knock-back physics when the player (or rival) plows into them. Rendered with
// instancing (one draw call per vehicle type & part).
import * as THREE from 'three';
import * as L from '../world/CityLayout.js';
import { buildTrafficGeometry, trafficWheelGeometry, TRAFFIC_TYPES, TRAFFIC_COLORS } from './CarModels.js';
import { StaticWorld } from '../world/Collision.js';
import { clamp, wrapAngle, mulberry32 } from '../core/math.js';

const DIRV = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // +x, +z, -x, -z
const rightOf = (d) => { const [dx, dz] = DIRV[d]; return [-dz, dx]; }; // right-hand side (car space: right = -left)
// Car facing (dx,dz): yaw = atan2(dx,dz). Left = (cos yaw, -sin yaw) = (dz, -dx). Right = (-dz, dx).

const CYCLE = 25;
export function signalPhase(time, i, j, axis) {
  const off = ((i * 7 + j * 13) % CYCLE) * 1.0;
  let t = (time + off) % CYCLE;
  if (axis === 'EW') t = (t + CYCLE - 12.5) % CYCLE;
  if (t < 9) return 0;
  if (t < 11.5) return 1;
  return 2;
}

const _m = new THREE.Matrix4();
const _w = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _res = { nx: 0, nz: 0, depth: 0 };

export class Traffic {
  constructor(scene) {
    this.scene = scene;
    this.cars = [];
    this.time = 0;
    this.rng = mulberry32(4242);
    this.types = {};
    this.group = new THREE.Group();
    this.group.name = 'traffic';
    scene.add(this.group);
    this.events = [];
    this.special = []; // cable cars etc. (externally rendered)
  }

  build(max = 40) {
    this.max = max;
    const paintMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.45, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.1, envMapIntensity: 1.1 });
    const glassMat = new THREE.MeshPhysicalMaterial({ color: '#0a0e13', metalness: 0.3, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.6 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.6 });
    this.lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.2 });
    const weights = Object.entries(TRAFFIC_TYPES).map(([k, t]) => [k, t.weight]);
    const total = weights.reduce((a, b) => a + b[1], 0);
    const counts = {};
    for (const [k, w] of weights) counts[k] = Math.max(1, Math.round((w / total) * max));
    for (const [type, n] of Object.entries(counts)) {
      const g = buildTrafficGeometry(type);
      const mk = (geo, mat, cnt, shadow = true) => {
        const m = new THREE.InstancedMesh(geo, mat, cnt);
        m.castShadow = shadow;
        m.receiveShadow = true;
        m.frustumCulled = false;
        m.count = 0;
        this.group.add(m);
        return m;
      };
      this.types[type] = {
        spec: TRAFFIC_TYPES[type],
        dims: g.dims,
        wheelOffsets: g.wheels,
        paint: mk(g.paint, paintMat, n),
        glass: mk(g.glass, glassMat, n),
        dark: mk(g.dark, darkMat, n),
        light: mk(g.light, this.lightMat, n, false),
        cap: n,
      };
      for (let k = 0; k < n; k++) this.cars.push(this.makeCar(type));
    }
    this.wheelMesh = new THREE.InstancedMesh(trafficWheelGeometry(), wheelMat, this.cars.length * 4);
    this.wheelMesh.castShadow = true;
    this.wheelMesh.frustumCulled = false;
    this.group.add(this.wheelMesh);
    return this;
  }

  makeCar(type) {
    const t = this.types[type];
    const isTaxi = type === 'taxi';
    const isBus = type === 'bus';
    const color = new THREE.Color(isTaxi ? '#ffc61a' : isBus ? '#d9dde0' : TRAFFIC_COLORS[Math.floor(this.rng() * TRAFFIC_COLORS.length)]);
    return {
      type, t, color,
      mass: isBus ? 11000 : type === 'van' || type === 'pickup' ? 2600 : 1500,
      len: t.dims.length, wid: t.dims.width,
      mode: 'drive', active: false,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, yawRate: 0, pitch: 0, roll: 0,
      speed: 0, cruise: isBus ? 9 : 10 + this.rng() * 5, spin: 0,
      man: null, // current maneuver
      dir: 0, node: [0, 0], lane: 1,
      knockT: 0, honkT: 0, blockedT: 0, airY: 0, vy: 0,
      nearT: 0, near: false,
      id: this.cars.length,
    };
  }

  // ---------------------------------------------------------------- spawning
  spawnNear(car, px, pz, minD = 120, maxD = 280) {
    for (let tries = 0; tries < 30; tries++) {
      const vertical = this.rng() < 0.5;
      const line = Math.floor(this.rng() * (L.N + 1));
      const seg = Math.floor(this.rng() * L.N);
      let d, i, j;
      if (vertical) { d = this.rng() < 0.5 ? 1 : 3; i = line; j = d === 1 ? seg : seg + 1; }
      else { d = this.rng() < 0.5 ? 0 : 2; j = line; i = d === 0 ? seg : seg + 1; }
      const lane = car.type === 'bus' ? 1 : this.rng() < 0.5 ? 0 : 1;
      const man = this.laneManeuver(i, j, d, lane);
      if (!man) continue;
      const u = this.rng() * man.len * 0.8;
      const p = this.evalMan(man, u);
      const dd = Math.hypot(p.x - px, p.z - pz);
      if (dd < minD || dd > maxD) continue;
      let clash = false;
      for (const o of this.cars) if (o.active && o !== car && Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < 12) { clash = true; break; }
      if (clash) continue;
      car.man = man;
      car.u = u;
      car.dir = d;
      car.lane = lane;
      car.node = [i, j];
      car.mode = 'drive';
      car.active = true;
      car.speed = car.cruise * 0.8;
      car.pos.set(p.x, L.groundHeight(p.x, p.z), p.z);
      car.yaw = Math.atan2(DIRV[d][0], DIRV[d][1]);
      car.vy = 0;
      car.airY = 0;
      return true;
    }
    return false;
  }

  // lane segment from node (i,j) heading d (to the next node)
  laneManeuver(i, j, d, lane) {
    const [dx, dz] = DIRV[d];
    const ni = i + dx, nj = j + dz;
    if (ni < 0 || nj < 0 || ni > L.N || nj > L.N) return null;
    const off = L.LANES[lane];
    const [rx, rz] = rightOf(d);
    const ax = L.lineX(i) + dx * L.STRIP + rx * off, az = L.lineZ(j) + dz * L.STRIP + rz * off;
    const bx = L.lineX(ni) - dx * L.STRIP + rx * off, bz = L.lineZ(nj) - dz * L.STRIP + rz * off;
    return { kind: 'lane', ax, az, bx, bz, len: Math.hypot(bx - ax, bz - az), d, to: [ni, nj], lane };
  }

  turnManeuver(node, d, nd, lane, nlane) {
    const [i, j] = node;
    const cx = L.lineX(i), cz = L.lineZ(j);
    const [dx, dz] = DIRV[d], [ex, ez] = DIRV[nd];
    const [rx, rz] = rightOf(d), [qx, qz] = rightOf(nd);
    const off = L.LANES[lane], noff = L.LANES[nlane];
    const sx = cx - dx * L.STRIP + rx * off, sz = cz - dz * L.STRIP + rz * off;
    const tx = cx + ex * L.STRIP + qx * noff, tz = cz + ez * L.STRIP + qz * noff;
    if (nd === d) return { kind: 'lane', ax: sx, az: sz, bx: tx, bz: tz, len: Math.hypot(tx - sx, tz - sz), d: nd, to: null, lane: nlane, through: true };
    // control point: projection of the exit onto the entry line
    const k = (tx - sx) * dx + (tz - sz) * dz;
    const c1x = sx + dx * k, c1z = sz + dz * k;
    const man = { kind: 'bez', ax: sx, az: sz, cx: c1x, cz: c1z, bx: tx, bz: tz, d: nd, lane: nlane, through: true };
    // approximate length
    let len = 0, px = sx, pz = sz;
    for (let s = 1; s <= 8; s++) {
      const p = this.evalMan(man, null, s / 8);
      len += Math.hypot(p.x - px, p.z - pz);
      px = p.x; pz = p.z;
    }
    man.len = len;
    return man;
  }

  evalMan(man, u, tt = null) {
    const t = tt !== null ? tt : clamp(u / man.len, 0, 1);
    if (man.kind === 'lane') {
      return { x: man.ax + (man.bx - man.ax) * t, z: man.az + (man.bz - man.az) * t, tx: man.bx - man.ax, tz: man.bz - man.az };
    }
    const it = 1 - t;
    const x = it * it * man.ax + 2 * it * t * man.cx + t * t * man.bx;
    const z = it * it * man.az + 2 * it * t * man.cz + t * t * man.bz;
    const tx = 2 * it * (man.cx - man.ax) + 2 * t * (man.bx - man.cx);
    const tz = 2 * it * (man.cz - man.az) + 2 * t * (man.bz - man.cz);
    return { x, z, tx, tz };
  }

  nextManeuver(car) {
    const man = car.man;
    if (man.kind === 'lane' && !man.through) {
      // arrived at the intersection entry: choose a direction
      const node = man.to;
      const d = man.d;
      const opts = [];
      for (let nd = 0; nd < 4; nd++) {
        if (nd === (d + 2) % 4) continue;
        const [dx, dz] = DIRV[nd];
        const ni = node[0] + dx, nj = node[1] + dz;
        if (ni < 0 || nj < 0 || ni > L.N || nj > L.N) continue;
        // buses go straight more often
        const w = nd === d ? (car.type === 'bus' ? 5 : 2.4) : 1;
        opts.push([nd, w]);
      }
      if (!opts.length) opts.push([(d + 2) % 4, 1]);
      let r = this.rng() * opts.reduce((a, b) => a + b[1], 0);
      let nd = opts[0][0];
      for (const [o, w] of opts) { if ((r -= w) <= 0) { nd = o; break; } }
      // right turns use the outer lane, left turns the inner lane
      const turn = (nd - d + 4) % 4; // 1 = right, 3 = left
      let nlane = car.lane;
      if (turn === 1) nlane = 1;
      if (turn === 3) nlane = 0;
      if (car.type === 'bus') nlane = 1;
      car.man = this.turnManeuver(node, d, nd, car.lane, nlane);
      car.man.node = node;
      car.lane = nlane;
      car.node = node;
      car.dir = nd;
    } else {
      // leaving an intersection: next lane segment
      const node = car.node;
      const m = this.laneManeuver(node[0], node[1], car.dir, car.lane);
      if (!m) { car.active = false; return; }
      car.man = m;
    }
    car.u = 0;
  }

  // ---------------------------------------------------------------- update
  update(dt, ctx) {
    this.time += dt;
    this.events.length = 0;
    const player = ctx.player;
    const px = player ? player.pos.x : 0, pz = player ? player.pos.z : 0;
    const others = ctx.vehicles || [];
    // spawn / recycle
    let activeCount = 0;
    for (const car of this.cars) {
      if (car.active) {
        const d = Math.hypot(car.pos.x - px, car.pos.z - pz);
        if (d > 340 && car.mode === 'drive') car.active = false;
      }
      if (!car.active && activeCount < this.max) {
        if (this.spawnNear(car, px, pz, this._initialized ? 150 : 25, 300)) activeCount++;
      } else if (car.active) activeCount++;
    }
    this._initialized = true;
    for (const car of this.cars) {
      if (!car.active) continue;
      if (car.mode === 'drive') this.drive(car, dt, others);
      else this.knocked(car, dt, ctx.collision);
    }
    this.render();
  }

  drive(car, dt, others) {
    const man = car.man;
    let target = man.kind === 'bez' ? Math.min(car.cruise, 6.5) : car.cruise;
    // traffic light at the end of a lane maneuver
    if (man.kind === 'lane' && !man.through && man.to) {
      const rem = man.len - car.u;
      const axis = man.d % 2 === 0 ? 'EW' : 'NS';
      const ph = signalPhase(this.time, man.to[0], man.to[1], axis);
      if (ph !== 0 && rem < 38 && !(ph === 1 && rem < car.speed * 0.9)) {
        const stopAt = Math.max(0, rem - 1.5);
        target = Math.min(target, Math.sqrt(2 * 5 * stopAt));
        if (stopAt < 0.6) target = 0;
      }
    }
    // car following (traffic + player + rival)
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    let blockedByPlayer = false;
    const check = (ox, oz, olen, isPlayer) => {
      const rx = ox - car.pos.x, rz = oz - car.pos.z;
      const a = rx * fx + rz * fz;
      if (a <= 0 || a > 30) return;
      const l = Math.abs(rx * fz - rz * fx);
      if (l > 2.0) return;
      const gap = a - (car.len + olen) * 0.5;
      const lim = Math.max(0, (gap - 2.5) * 0.9);
      if (lim < target) {
        target = lim;
        if (isPlayer && gap < 6) blockedByPlayer = true;
      }
    };
    const lightTarget = target;
    if (car.ghostT > 0) car.ghostT -= dt;
    else {
      for (const o of this.cars) if (o !== car && o.active) check(o.pos.x, o.pos.z, o.len, false);
    }
    for (const v of others) check(v.pos.x, v.pos.z, v.dims.length, true);
    // deadlock breaker: blocked by other traffic (not a light) for too long → ghost through
    if (target < 0.3 && lightTarget > 1 && !blockedByPlayer) {
      car.stuckT = (car.stuckT || 0) + dt;
      if (car.stuckT > 5) { car.ghostT = 2.5; car.stuckT = 0; }
    } else car.stuckT = 0;
    // honk at the player if blocked
    if (blockedByPlayer) {
      car.blockedT += dt;
      car.honkT -= dt;
      if (car.blockedT > 1.2 && car.honkT <= 0) {
        car.honkT = 2.5 + this.rng() * 3;
        this.events.push({ type: 'honk', x: car.pos.x, y: car.pos.y, z: car.pos.z });
      }
    } else car.blockedT = 0;
    // speed control
    const acc = target > car.speed ? 3.8 : 9;
    car.speed += clamp(target - car.speed, -acc * dt, acc * dt);
    car.speed = Math.max(0, car.speed);
    car.u += car.speed * dt;
    let guard = 0;
    while (car.active && car.u >= car.man.len && guard++ < 4) {
      const over = car.u - car.man.len;
      this.nextManeuver(car);
      if (!car.active) return;
      car.u = over;
    }
    const p = this.evalMan(car.man, car.u);
    const yaw = Math.atan2(p.tx, p.tz);
    car.yawRate = wrapAngle(yaw - car.yaw) / Math.max(dt, 1e-3);
    car.yaw = yaw;
    car.pos.x = p.x;
    car.pos.z = p.z;
    car.pos.y = L.groundHeight(p.x, p.z);
    car.vel.set(Math.sin(yaw) * car.speed, 0, Math.cos(yaw) * car.speed);
    const wb = car.t.dims.wheelbase / 2;
    const hF = L.groundHeight(p.x + Math.sin(yaw) * wb, p.z + Math.cos(yaw) * wb);
    const hR = L.groundHeight(p.x - Math.sin(yaw) * wb, p.z - Math.cos(yaw) * wb);
    car.pitch = Math.atan2(hF - hR, wb * 2);
    car.roll *= 0.9;
    car.spin += (car.speed * dt) / car.t.dims.wheelRadius;
  }

  knocked(car, dt, collision) {
    car.knockT += dt;
    const sp = Math.hypot(car.vel.x, car.vel.z);
    const fr = 7.5 * dt;
    if (sp > fr) { car.vel.x -= (car.vel.x / sp) * fr; car.vel.z -= (car.vel.z / sp) * fr; }
    else { car.vel.x = 0; car.vel.z = 0; }
    car.yawRate *= Math.exp(-2.2 * dt);
    car.yaw += car.yawRate * dt;
    car.pos.x += car.vel.x * dt;
    car.pos.z += car.vel.z * dt;
    // vertical hop
    car.vy -= 21 * dt;
    car.airY = Math.max(0, car.airY + car.vy * dt);
    if (car.airY === 0) car.vy = Math.max(0, -car.vy * 0.3);
    const g = L.groundHeight(car.pos.x, car.pos.z);
    car.pos.y = g + car.airY;
    car.roll *= Math.exp(-3 * dt);
    car.pitch *= Math.exp(-3 * dt);
    car.spin += (sp * dt) / car.t.dims.wheelRadius;
    if (g < -1) { car.active = false; return; } // fell in the bay
    // static collisions
    if (collision) {
      const items = collision.query(car.pos.x, car.pos.z, car.len * 0.6);
      for (const it of items) {
        if (it.kind === 'soft' || (it.data && it.data.breakable)) continue;
        if (car.pos.y + 1.5 < it.y0 || car.pos.y > it.y1) continue;
        const r = StaticWorld.resolveCircle(it, car.pos.x, car.pos.z, car.wid * 0.6, _res);
        if (!r) continue;
        car.pos.x += r.nx * r.depth;
        car.pos.z += r.nz * r.depth;
        const vn = car.vel.x * r.nx + car.vel.z * r.nz;
        if (vn < 0) { car.vel.x -= r.nx * vn * 1.3; car.vel.z -= r.nz * vn * 1.3; }
      }
    }
    if (sp < 0.6 && car.knockT > 2.2) this.recover(car);
  }

  recover(car) {
    // snap back onto the nearest lane in the closest-matching direction
    const gx = (car.pos.x - L.ORIGIN) / L.S, gz = (car.pos.z - L.ORIGIN) / L.S;
    const ni = clamp(Math.round(gx), 0, L.N), nj = clamp(Math.round(gz), 0, L.N);
    const dxl = Math.abs(car.pos.x - L.lineX(ni)), dzl = Math.abs(car.pos.z - L.lineZ(nj));
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    let d, i, j;
    if (dxl < dzl) {
      d = fz >= 0 ? 1 : 3;
      i = ni;
      j = clamp(d === 1 ? Math.floor(gz) : Math.ceil(gz), 0, L.N);
    } else {
      d = fx >= 0 ? 0 : 2;
      j = nj;
      i = clamp(d === 0 ? Math.floor(gx) : Math.ceil(gx), 0, L.N);
    }
    const man = this.laneManeuver(i, j, d, car.lane);
    if (!man || Math.min(dxl, dzl) > 9) { car.active = false; return; }
    // project position on the lane
    const vx = man.bx - man.ax, vz = man.bz - man.az;
    const u = clamp(((car.pos.x - man.ax) * vx + (car.pos.z - man.az) * vz) / (man.len * man.len), 0, 0.95) * man.len;
    car.man = man;
    car.u = u;
    car.dir = d;
    car.node = [i, j];
    car.mode = 'drive';
    car.speed = 0;
    car.knockT = 0;
  }

  // Apply a knock from a collision impulse
  knock(car, ivx, ivz, spin, pop = 0) {
    if (car.mode === 'drive') {
      car.vel.set(Math.sin(car.yaw) * car.speed, 0, Math.cos(car.yaw) * car.speed);
    }
    car.mode = 'knocked';
    car.knockT = 0;
    car.vel.x += ivx;
    car.vel.z += ivz;
    car.yawRate += spin;
    car.vy = Math.max(car.vy, pop);
  }

  // ---------------------------------------------------------------- render
  render() {
    const counts = {};
    for (const k of Object.keys(this.types)) counts[k] = 0;
    let wi = 0;
    for (const car of this.cars) {
      if (!car.active) continue;
      const T = this.types[car.type];
      const k = counts[car.type]++;
      _e.set(-car.pitch, car.yaw, car.roll, 'YXZ');
      _q.setFromEuler(_e);
      _p.copy(car.pos);
      _m.compose(_p, _q, _s.set(1, 1, 1));
      T.paint.setMatrixAt(k, _m);
      T.paint.setColorAt(k, car.color);
      T.glass.setMatrixAt(k, _m);
      T.dark.setMatrixAt(k, _m);
      T.light.setMatrixAt(k, _m);
      const R = car.t.dims.wheelRadius;
      for (const [ox, oz] of T.wheelOffsets) {
        _w.makeRotationX(car.spin);
        _w.scale(_s.set(R, R, R));
        _w.setPosition(ox, R, oz);
        _w.premultiply(_m);
        this.wheelMesh.setMatrixAt(wi++, _w);
      }
    }
    for (const [type, T] of Object.entries(this.types)) {
      const n = counts[type];
      for (const m of [T.paint, T.glass, T.dark, T.light]) {
        m.count = n;
        m.instanceMatrix.needsUpdate = true;
      }
      if (T.paint.instanceColor) T.paint.instanceColor.needsUpdate = true;
    }
    this.wheelMesh.count = wi;
    this.wheelMesh.instanceMatrix.needsUpdate = true;
  }

  setNight(f) {
    // brighten head/tail lights at night
    this.lightMat.color.setScalar(1 + f * 2.5);
  }
}
