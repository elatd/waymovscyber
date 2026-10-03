// Crazy Taxi style chase camera: low, punchy, follows the direction of travel, widens FOV
// with speed, shakes on impacts and pulls in to avoid buildings.
import * as THREE from 'three';
import { groundHeight } from '../world/CityLayout.js';
import { clamp, damp, dampAngle } from '../core/math.js';

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.heading = 0;
    this.dist = 6.9;
    this.height = 2.55;
    this.fov = 62;
    this.shake = 0;
    this.shakeT = 0;
    this.pull = 1;
    this.mode = 0; // 0 normal, 1 far, 2 hood
    this.lookBack = false;
    this._tmp = new THREE.Vector3();
    this.initialized = false;
    this.reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  addShake(a) {
    if (this.reducedMotion) return;
    this.shake = Math.min(1.2, this.shake + a);
  }

  snap(v) {
    this.initialized = false;
    this.update(0.016, v, 0);
  }

  update(dt, v, boostFx = 0, collision = null) {
    const cam = this.camera;
    const speed = Math.hypot(v.vel.x, v.vel.z);
    // heading: blend car yaw with velocity direction when moving fast (shows drifts)
    let target = v.yaw;
    if (speed > 6 && v.forwardSpeed > 0) {
      const va = Math.atan2(v.vel.x, v.vel.z);
      const d = Math.atan2(Math.sin(va - v.yaw), Math.cos(va - v.yaw));
      target = v.yaw + d * 0.55;
    }
    if (v.forwardSpeed < -2) target = v.yaw; // reversing: keep looking forward
    if (this.lookBack) target += Math.PI;
    if (!this.initialized) this.heading = target;
    this.heading = dampAngle(this.heading, target, v.grounded ? 4.2 : 2.0, dt);
    const far = this.mode === 1;
    const hood = this.mode === 2;
    const dist = (far ? 11.5 : this.dist) + clamp(speed * 0.045, 0, 2.2) + boostFx * 1.4;
    const height = (far ? 4.3 : this.height) + clamp(speed * 0.012, 0, 0.6);
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    let tx = v.pos.x - fx * dist, tz = v.pos.z - fz * dist;
    let ty = v.pos.y + height;
    if (hood) {
      tx = v.pos.x + fx * 0.4; tz = v.pos.z + fz * 0.4; ty = v.pos.y + 1.55;
    }
    // building occlusion → pull in
    if (collision && !hood) {
      const f = collision.raycast2D(v.pos.x, v.pos.z, tx, tz, v.pos.y + 1.5);
      this.pull = damp(this.pull, Math.max(0.3, f), f < this.pull ? 14 : 2.5, dt);
      tx = v.pos.x + (tx - v.pos.x) * this.pull;
      tz = v.pos.z + (tz - v.pos.z) * this.pull;
    }
    const gh = groundHeight(tx, tz);
    ty = Math.max(ty, gh + 1.2);
    if (!this.initialized) {
      this.pos.set(tx, ty, tz);
      this.initialized = true;
    }
    const k = hood ? 40 : 13;
    this.pos.x = damp(this.pos.x, tx, k, dt);
    this.pos.z = damp(this.pos.z, tz, k, dt);
    this.pos.y = damp(this.pos.y, ty, v.grounded ? 7 : 3.5, dt);
    // look target ahead of the car
    const ahead = hood ? 20 : 4 + clamp(speed * 0.08, 0, 4);
    this.look.set(v.pos.x + fx * ahead, v.pos.y + (hood ? 1.3 : 1.25), v.pos.z + fz * ahead);
    cam.position.copy(this.pos);
    // shake
    this.shakeT += dt * 40;
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.35;
      cam.position.x += (Math.sin(this.shakeT * 1.3) + Math.sin(this.shakeT * 2.9) * 0.5) * s;
      cam.position.y += Math.sin(this.shakeT * 1.7 + 1) * s;
      cam.position.z += Math.cos(this.shakeT * 1.1) * s;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
    cam.lookAt(this.look);
    // subtle banking into corners / drifts
    const rollT = hood || this.reducedMotion ? 0 : clamp(v.yawRate * Math.min(speed, 40) * 0.0017, -0.065, 0.065) * (v.grounded ? 1 : 0.4);
    this.roll = damp(this.roll || 0, rollT, 5, dt);
    cam.rotateZ(this.roll);
    const fovT = (hood ? 72 : this.fov) + clamp((speed - 12) * 0.26, 0, 10) + boostFx * 9;
    cam.fov = damp(cam.fov, fovT, 4, dt);
    cam.updateProjectionMatrix();
  }
}
