// Arcade vehicle dynamics tuned for Crazy Taxi style driving on SF hills:
// grip-limited cornering, handbrake power-slides, real crest jumps, curb bumps,
// static collisions (buildings, walls), knock-over poles / trees, breakables and soft hedges.
import * as THREE from 'three';
import { groundHeight, surfaceAt, SEABED } from '../world/CityLayout.js';
import { StaticWorld } from '../world/Collision.js';
import { clamp, wrapAngle, damp } from '../core/math.js';

const GRAVITY = 21;
const STEP = 1 / 120;
const _res = { nx: 0, nz: 0, depth: 0 };

export const SPECS = {
  waymo: {
    name: 'Waymo', maxSpeed: 43, accel: 14.5, brake: 34, reverseMax: 10, reverseAccel: 11,
    gripLat: 27, driftLat: 9.5, slideLat: 15, steerCap: 2.05, yawResp: 11, driftYaw: 1.45,
    boostAccel: 16, boostMax: 58, mass: 2200, scrub: 0.5, slopeK: 0.42, airControl: 1.1,
  },
  cybercab: {
    name: 'Cybercab', maxSpeed: 47, accel: 16.5, brake: 32, reverseMax: 10, reverseAccel: 11,
    gripLat: 24, driftLat: 8.0, slideLat: 13, steerCap: 1.95, yawResp: 10, driftYaw: 1.55,
    boostAccel: 18, boostMax: 62, mass: 1900, scrub: 0.45, slopeK: 0.42, airControl: 1.2,
  },
};

export class Vehicle {
  constructor(model, spec) {
    this.model = model;
    this.spec = { ...spec };
    this.dims = model.dims;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.yawRate = 0;
    this.slopePitch = 0;
    this.slopeRoll = 0;
    this.airPitch = 0;
    this.pitchVel = 0;
    this.dynPitch = 0;
    this.dynRoll = 0;
    this.susp = 0;
    this.suspVel = 0;
    this.grounded = true;
    this.airTime = 0;
    this.lastAir = 0;
    this.maxAirHeight = 0;
    this.steer = 0;
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
    this.handbraking = false;
    this.drifting = false;
    this.slipAngle = 0;
    this.speed = 0;
    this.forwardSpeed = 0;
    this.boosting = false;
    this.extraTop = 0; // special abilities (Ludicrous)
    this.extraAccel = 0;
    this.wheelSpin = 0;
    this.events = [];
    this.surface = 'road';
    this.inWater = false;
    this.mass = spec.mass;
    this.lastLong = 0;
    this.lastLat = 0;
    this.acc = 0;
    this.radius = this.dims.width * 0.5;
    this.circleOffsets = [this.dims.length * 0.32, 0, -this.dims.length * 0.32];
    this.softDrag = 0;
    this.frozen = false;
    this._fwd = new THREE.Vector3();
    this._left = new THREE.Vector3();
    this._n = new THREE.Vector3();
  }

  place(x, z, yaw) {
    this.pos.set(x, groundHeight(x, z), z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.yawRate = 0;
    this.grounded = true;
    this.airTime = 0;
    this.slopePitch = this.slopeRoll = this.airPitch = 0;
    this.susp = this.suspVel = 0;
    this.drifting = false;
    this.inWater = false;
    this.syncVisual(0);
  }

  get forward() {
    return this._fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  setInput(inp) {
    Object.assign(this.input, inp);
  }

  update(dt, world) {
    this.events.length = 0;
    if (this.frozen) { this.syncVisual(dt); return; }
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n < 8) {
      this.step(STEP, world);
      this.acc -= STEP;
      n++;
    }
    if (n === 8) this.acc = 0;
    this.syncVisual(dt);
  }

  step(dt, world) {
    const S = this.spec;
    const inp = this.input;
    const fwdX = Math.sin(this.yaw), fwdZ = Math.cos(this.yaw);
    const vx = this.vel.x, vz = this.vel.z;
    const vf = vx * fwdX + vz * fwdZ;
    const speed = Math.hypot(vx, vz);
    this.forwardSpeed = vf;
    this.speed = speed;

    // smoothed steering (faster return to center)
    const sIn = clamp(inp.steer, -1, 1);
    const sr = Math.abs(sIn) < Math.abs(this.steer) ? 9 : 5.5;
    this.steer += (sIn - this.steer) * Math.min(1, dt * sr);

    let longAcc = 0;
    if (this.grounded) {
      // --- longitudinal
      const top = (this.boosting ? S.boostMax : S.maxSpeed) + this.extraTop;
      const thr = clamp(inp.throttle, 0, 1);
      const brk = clamp(inp.brake, 0, 1);
      if (thr > 0) {
        if (vf < -0.5) longAcc += S.brake * thr;
        else {
          const ratio = clamp(vf / top, 0, 1.2);
          longAcc += thr * (S.accel + this.extraAccel) * Math.max(0, 1 - ratio * ratio * ratio);
        }
      }
      if (this.boosting) longAcc += (S.boostAccel + this.extraAccel * 0.5) * Math.max(0, 1 - Math.max(0, vf) / top);
      if (brk > 0) {
        if (vf > 0.6) longAcc -= S.brake * brk;
        else if (vf > -S.reverseMax) longAcc -= S.reverseAccel * brk;
      }
      // rolling resistance / drag / coasting
      const drag = 0.03 * vf + 0.00055 * vf * Math.abs(vf);
      longAcc -= drag;
      if (thr === 0 && brk === 0) longAcc -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, 1.6);
      // surface
      const surf = this.surface;
      if (surf === 'grass') longAcc -= vf * 0.35;
      // slope gravity
      const ex = 0.8;
      const hF = groundHeight(this.pos.x + fwdX * ex, this.pos.z + fwdZ * ex);
      const hB = groundHeight(this.pos.x - fwdX * ex, this.pos.z - fwdZ * ex);
      const grad = (hF - hB) / (2 * ex);
      longAcc -= GRAVITY * S.slopeK * clamp(grad, -0.6, 0.6);
      // handbrake
      this.handbraking = !!inp.handbrake && speed > 4;
      if (this.handbraking) longAcc -= Math.sign(vf) * 3.5;
      if (this.softDrag > 0) longAcc -= vf * this.softDrag;
      this.vel.x += fwdX * longAcc * dt;
      this.vel.z += fwdZ * longAcc * dt;

      // --- yaw
      const absVf = Math.abs(vf);
      const dir = vf >= -0.3 ? 1 : -1;
      let cap = S.steerCap - 0.011 * absVf;
      const gripYaw = (S.gripLat / Math.max(absVf, 3)) * 1.2;
      if (!this.handbraking && !this.drifting) cap = Math.min(cap, gripYaw);
      if (this.handbraking || this.drifting) cap *= S.driftYaw;
      let yawTarget = this.steer * Math.min(absVf / 4.2, cap) * dir;
      // counter-steer stabilizes drifts
      this.yawRate += (yawTarget - this.yawRate) * Math.min(1, dt * (this.drifting ? 5.5 : S.yawResp));
    } else {
      // airborne: keep spin, slight air control
      this.yawRate *= Math.exp(-0.8 * dt);
      this.yawRate += this.steer * S.airControl * dt;
      this.handbraking = false;
    }
    this.lastLong = longAcc;
    this.yaw += this.yawRate * dt;

    // --- velocity follows heading, limited by lateral grip
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.05) {
      const nfX = Math.sin(this.yaw), nfZ = Math.cos(this.yaw);
      const vfNow = this.vel.x * nfX + this.vel.z * nfZ;
      const heading = vfNow >= 0 ? this.yaw : this.yaw + Math.PI;
      const vAng = Math.atan2(this.vel.x, this.vel.z);
      const beta = wrapAngle(heading - vAng);
      this.slipAngle = vfNow >= 0 ? beta : 0;
      if (this.grounded) {
        let lat = S.gripLat;
        if (this.handbraking) lat = S.driftLat;
        else if (this.drifting) lat = S.slideLat;
        if (this.surface === 'grass') lat *= 0.7;
        const maxTurn = (lat / Math.max(sp, 3)) * dt;
        const turn = clamp(beta, -maxTurn, maxTurn);
        const c = Math.cos(turn), s = Math.sin(turn);
        const nx = this.vel.x * c + this.vel.z * s;
        const nz = -this.vel.x * s + this.vel.z * c;
        this.vel.x = nx;
        this.vel.z = nz;
        this.lastLat = (turn / dt) * sp;
        // scrub speed while sliding
        const rest = Math.abs(Math.sin(beta - turn));
        const k = 1 - S.scrub * rest * dt * (this.handbraking ? 0.6 : 1);
        this.vel.x *= k;
        this.vel.z *= k;
        // drift state for scoring / fx
        const absB = Math.abs(beta);
        if (!this.drifting && sp > 11 && absB > 0.28 && (this.handbraking || absB > 0.42)) this.drifting = true;
        if (this.drifting && (sp < 7 || (absB < 0.12 && !this.handbraking))) this.drifting = false;
      }
    }

    // --- vertical / ground
    const hPrev = groundHeight(this.pos.x, this.pos.z);
    this.vel.y -= GRAVITY * dt;
    const mx = this.vel.x * dt, mz = this.vel.z * dt;
    this.pos.x += mx;
    this.pos.z += mz;
    this.pos.y += this.vel.y * dt;
    const h = groundHeight(this.pos.x, this.pos.z);
    this.surface = surfaceAt(this.pos.x, this.pos.z);
    // vertical ground velocity from smooth ramps only (curbs / ledges are steps, not launchers)
    const dh = h - hPrev;
    const smoothLimit = Math.hypot(mx, mz) * 0.5 + 0.004;
    const groundVy = Math.abs(dh) > smoothLimit ? 0 : dh / dt;
    if (this.pos.y <= h + 0.002) {
      if (!this.grounded) {
        const impact = Math.max(0, groundVy - this.vel.y);
        this.lastAir = this.airTime;
        this.events.push({ type: 'land', impact, air: this.airTime, height: this.maxAirHeight });
        this.suspVel -= Math.min(impact, 22) * 0.12;
        this.airTime = 0;
      }
      this.pos.y = h;
      this.vel.y = Math.max(this.vel.y, Math.min(groundVy, 30));
      if (this.vel.y > groundVy + 0.01) this.vel.y = groundVy;
      this.grounded = true;
      this.maxAirHeight = 0;
    } else if (this.pos.y > h + 0.18) {
      if (this.grounded) {
        this.grounded = false;
        this.airTime = 0;
        this.maxAirHeight = 0;
        if (this.vel.y > 2 || this.speed > 18) this.events.push({ type: 'takeoff', vy: this.vel.y });
      }
      this.airTime += dt;
      this.maxAirHeight = Math.max(this.maxAirHeight, this.pos.y - h);
    } else if (!this.grounded) {
      // descending through the last few centimeters before touchdown
      this.airTime += dt;
    }
    if (h < -1 && this.pos.y < 0.4 && !this.inWater) {
      this.inWater = true;
      this.events.push({ type: 'water' });
    }

    // --- static collisions
    if (world && world.collision) this.collideStatic(world.collision, dt);
  }

  collideStatic(cw, dt) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const r = this.radius;
    this.softDrag = 0;
    for (const off of this.circleOffsets) {
      const cx = this.pos.x + fx * off, cz = this.pos.z + fz * off;
      const items = cw.query(cx, cz, r + 0.5);
      for (let k = 0; k < items.length; k++) {
        const it = items[k];
        if (this.pos.y + 1.4 < it.y0 || this.pos.y > it.y1) continue;
        const res = StaticWorld.resolveCircle(it, cx, cz, r, _res);
        if (!res) continue;
        if (it.kind === 'soft') {
          this.softDrag = Math.max(this.softDrag, 1.6);
          if (this.speed > 3 && Math.random() < 0.3) this.events.push({ type: 'soft', x: cx, z: cz, speed: this.speed });
          continue;
        }
        const vn = this.vel.x * res.nx + this.vel.z * res.nz;
        if (it.data && it.data.breakable && this.speed > 4) {
          it.alive = false;
          this.events.push({ type: 'break', item: it, vx: this.vel.x, vz: this.vel.z, speed: this.speed });
          this.vel.x *= 0.96;
          this.vel.z *= 0.96;
          continue;
        }
        if (it.data && it.data.knock) {
          // poles and trees: a real hit knocks them over for a bit of speed; a slow push that
          // keeps going does too, so the car never ends up banging into one over and over
          const rec = it.data.rec;
          const now = performance.now();
          if (now - (rec.cLast || 0) > 250) rec.cT = 0;
          rec.cLast = now;
          rec.cT = (rec.cT || 0) + dt;
          if (-vn > 2.5 || (rec.cT > 0.3 && this.input.throttle > 0.2)) {
            it.alive = false;
            const keep = rec.kind === 'tree' ? 0.72 : 0.8;
            this.vel.x *= keep;
            this.vel.z *= keep;
            this.events.push({ type: 'knock', item: it, vx: this.vel.x, vz: this.vel.z, speed: this.speed, impulse: -vn, x: cx - res.nx * r, z: cz - res.nz * r, y: this.pos.y + 0.8, nx: res.nx, nz: res.nz });
            continue;
          }
        }
        // push out
        this.pos.x += res.nx * res.depth;
        this.pos.z += res.nz * res.depth;
        if (vn < 0) {
          const e = it.kind === 'building' || it.kind === 'wall' ? 0.25 : 0.15;
          this.vel.x -= res.nx * vn * (1 + e);
          this.vel.z -= res.nz * vn * (1 + e);
          // friction along the wall
          const tx = -res.nz, tz = res.nx;
          const vt = this.vel.x * tx + this.vel.z * tz;
          const fr = Math.min(1, Math.abs(vn) * 0.04);
          this.vel.x -= tx * vt * fr;
          this.vel.z -= tz * vt * fr;
          // spin from off-center impacts
          const lever = off;
          const cross = fx * res.nz - fz * res.nx;
          this.yawRate += clamp(-vn * lever * cross * 0.06, -2.5, 2.5);
          if (-vn > 1.5) this.events.push({ type: 'crash', impulse: -vn, x: cx - res.nx * r, z: cz - res.nz * r, y: this.pos.y + 0.6, kind: it.kind, nx: res.nx, nz: res.nz });
        }
      }
    }
  }

  // Sync model transform from physics state (with smoothing for visuals)
  syncVisual(dt) {
    const m = this.model;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const lx = Math.cos(this.yaw), lz = -Math.sin(this.yaw);
    const wb = this.dims.wheelbase * 0.5, tr = this.dims.track * 0.5;
    if (this.grounded) {
      const hF = groundHeight(this.pos.x + fx * wb, this.pos.z + fz * wb);
      const hR = groundHeight(this.pos.x - fx * wb, this.pos.z - fz * wb);
      const hL = groundHeight(this.pos.x + lx * tr, this.pos.z + lz * tr);
      const hRt = groundHeight(this.pos.x - lx * tr, this.pos.z - lz * tr);
      const tp = Math.atan2(hF - hR, wb * 2);
      const trl = Math.atan2(hL - hRt, tr * 2);
      this.slopePitch = damp(this.slopePitch, tp, 18, dt);
      this.slopeRoll = damp(this.slopeRoll, trl, 18, dt);
      this.airPitch = damp(this.airPitch, 0, 10, dt);
    } else {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      const target = Math.atan2(this.vel.y, Math.max(hs, 1)) * 0.65;
      this.airPitch = damp(this.airPitch, target - this.slopePitch, 2.2, dt);
      this.slopeRoll = damp(this.slopeRoll, 0, 1.5, dt);
    }
    // suspension spring
    const k = 120, c = 13;
    this.suspVel += (-k * this.susp - c * this.suspVel) * dt;
    this.susp += this.suspVel * dt;
    this.susp = clamp(this.susp, -0.25, 0.2);
    // dynamic lean
    const tDive = clamp(-this.lastLong * 0.0042, -0.07, 0.07);
    const tRoll = clamp(this.lastLat * 0.0035 * (this.grounded ? 1 : 0), -0.09, 0.09);
    this.dynPitch = damp(this.dynPitch, tDive, 8, dt);
    this.dynRoll = damp(this.dynRoll, tRoll, 7, dt);

    const root = m.root;
    root.position.copy(this.pos);
    root.rotation.order = 'YXZ';
    root.rotation.set(-(this.slopePitch + this.airPitch), this.yaw, this.slopeRoll);
    m.body.position.y = this.susp;
    m.body.rotation.set(this.dynPitch, 0, this.dynRoll);
    // wheels
    this.wheelSpin += (this.forwardSpeed * dt) / this.dims.wheelRadius;
    const steerAngle = this.steer * 0.55 * (1 / (1 + Math.abs(this.forwardSpeed) * 0.02));
    for (const w of m.wheels) {
      w.spin.rotation.x = this.wheelSpin;
      if (w.front) w.pivot.rotation.y = steerAngle;
      // airborne: wheels droop
      const droop = this.grounded ? 0 : -0.12;
      w.pivot.position.y = this.dims.wheelRadius + droop * 0.5 + Math.min(0, this.susp) * 0.3;
    }
    if (m.lidarSpin) m.lidarSpin.rotation.y += dt * 12;
  }
}

export { GRAVITY, SEABED };
