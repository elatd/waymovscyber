// The rival robotaxi: an AI driver competing for the same passengers. It plans routes on
// the street grid, follows them with pure pursuit, brakes for corners, overtakes traffic,
// gets itself unstuck, and uses gentle rubber-banding to keep the race close.
import * as L from '../world/CityLayout.js';
import { clamp, wrapAngle } from '../core/math.js';

export class RivalAI {
  constructor(vehicle, driver, missions) {
    this.v = vehicle;
    this.driver = driver;
    this.missions = missions;
    this.path = [];
    this.target = null;
    this.replanT = 0;
    this.stuckT = 0;
    this.reverseT = 0;
    this.state = 'seek';
    this.speedFactor = 0.9;
    this.lookPt = { x: 0, z: 0 };
    this.waitT = 0;
  }

  reset() {
    this.path = [];
    this.target = null;
    this.replanT = 0;
    this.stuckT = 0;
    this.reverseT = 0;
  }

  // Build a lane-offset polyline (right-hand side) from the route nodes.
  plan(tx, tz) {
    const v = this.v;
    const fwd = { x: Math.sin(v.yaw), z: Math.cos(v.yaw) };
    const nodes = L.findRoute(v.pos.x, v.pos.z, tx, tz, fwd);
    const axis = (dx, dz) => {
      if (Math.abs(dx) < 0.5 && Math.abs(dz) < 0.5) return null;
      return Math.abs(dx) > Math.abs(dz) ? { x: Math.sign(dx), z: 0 } : { x: 0, z: Math.sign(dz) };
    };
    const pts = [];
    const off = 3.6;
    let prev = { x: v.pos.x, z: v.pos.z };
    for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k];
      if (k === nodes.length - 1) { pts.push({ x: n.x, z: n.z, final: true }); break; }
      const next = nodes[k + 1];
      const din = axis(n.x - prev.x, n.z - prev.z);
      const dout = axis(next.x - n.x, next.z - n.z);
      if (din && dout && (din.x !== dout.x || din.z !== dout.z)) {
        pts.push({ x: n.x - din.z * off - din.x * 9, z: n.z + din.x * off - din.z * 9, corner: true });
        pts.push({ x: n.x - dout.z * off + dout.x * 9, z: n.z + dout.x * off + dout.z * 9 });
      } else {
        const d = dout || din;
        if (d) pts.push({ x: n.x - d.z * off, z: n.z + d.x * off });
      }
      prev = n;
    }
    if (!pts.length) pts.push({ x: tx, z: tz, final: true });
    // drop leading points that are behind us (avoid U-turns after a replan)
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    while (pts.length > 1) {
      const p = pts[0];
      const dx = p.x - v.pos.x, dz = p.z - v.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 60 && (dx * fx + dz * fz) / (d || 1) < -0.2 && v.speed > 4) pts.shift();
      else break;
    }
    this.path = pts;
    this.pathIdx = 0;
  }

  offPath() {
    const v = this.v;
    const a = this.path[Math.max(0, this.pathIdx - 1)] || this.path[0];
    const b = this.path[this.pathIdx] || a;
    const abx = b.x - a.x, abz = b.z - a.z;
    const l2 = abx * abx + abz * abz || 1;
    const t = Math.max(0, Math.min(1, ((v.pos.x - a.x) * abx + (v.pos.z - a.z) * abz) / l2));
    const px = a.x + abx * t, pz = a.z + abz * t;
    return Math.hypot(v.pos.x - px, v.pos.z - pz);
  }

  update(dt, ctx) {
    const v = this.v;
    const M = this.missions;
    const fare = M.fareOf(this.driver);
    // rubber band against the player's earnings
    const diff = ctx.playerMoney - ctx.rivalMoney;
    const rb = clamp(diff / 120, -0.12, 0.1);
    this.speedFactor = clamp(0.9 + rb + ctx.difficulty * 0.04, 0.74, 1.04);
    v.extraTop = (this.speedFactor - 1) * v.spec.maxSpeed;
    // choose a target
    this.replanT -= dt;
    let tx, tz, mode;
    if (fare) {
      mode = 'carry';
      tx = fare.dest.x; tz = fare.dest.z;
    } else {
      mode = 'seek';
      this.pickT = (this.pickT || 0) - dt;
      if (!this.target || !M.waiting.includes(this.target) || this.pickT <= 0) {
        this.pickT = 3;
        let best = null, bs = Infinity;
        for (const w of M.waiting) {
          const d = Math.hypot(w.x - v.pos.x, w.z - v.pos.z);
          // prefer long fares a bit; avoid ones the player is sitting on
          const pd = Math.hypot(w.x - ctx.player.pos.x, w.z - ctx.player.pos.z);
          const score = d - (w.tier.name === 'epic' ? 90 : w.tier.name === 'long' ? 50 : 0) + (pd < 25 ? 200 : 0);
          if (score < bs) { bs = score; best = w; }
        }
        if (best !== this.target) this.target = best;
      }
      if (this.target) { tx = this.target.x; tz = this.target.z; }
    }
    if (tx === undefined) {
      v.setInput({ throttle: 0, brake: 1, steer: 0, handbrake: false });
      return;
    }
    const moved = this.path.length && this.planTarget && Math.hypot(this.planTarget.x - tx, this.planTarget.z - tz) > 3;
    if (mode !== this.state || moved || !this.path.length || (this.replanT <= 0 && this.offPath() > 26)) {
      this.state = mode;
      this.plan(tx, tz);
      this.planTarget = { x: tx, z: tz };
      this.replanT = 1.5;
    }
    // advance along path
    while (this.pathIdx < this.path.length - 1) {
      const p = this.path[this.pathIdx];
      const d = Math.hypot(p.x - v.pos.x, p.z - v.pos.z);
      if (d < 7 + v.speed * 0.15) this.pathIdx++;
      else break;
    }
    // lookahead point
    const look = clamp(6 + v.speed * 0.45, 7, 22);
    let lx = this.path[this.pathIdx].x, lz = this.path[this.pathIdx].z;
    {
      let acc = Math.hypot(lx - v.pos.x, lz - v.pos.z);
      let k = this.pathIdx;
      while (acc < look && k < this.path.length - 1) {
        const a = this.path[k], b = this.path[k + 1];
        const seg = Math.hypot(b.x - a.x, b.z - a.z);
        if (acc + seg >= look) {
          const t = (look - acc) / seg;
          lx = a.x + (b.x - a.x) * t; lz = a.z + (b.z - a.z) * t;
          acc = look;
          break;
        }
        acc += seg; lx = b.x; lz = b.z; k++;
      }
    }
    // obstacle avoidance: nudge laterally around traffic ahead
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    let nudge = 0;
    for (const c of ctx.traffic) {
      if (!c.active) continue;
      const rx = c.pos.x - v.pos.x, rz = c.pos.z - v.pos.z;
      const a = rx * fx + rz * fz;
      if (a < 2 || a > 24) continue;
      const lat = rx * fz - rz * fx; // > 0: obstacle on our left (left = (fz, -fx))
      if (Math.abs(lat) < 2.6) nudge += (lat >= 0 ? 1 : -1) * (1 - a / 24) * 3.2;
    }
    // steer the aim point to the side away from the obstacle (right = (-fz, fx))
    lx += -fz * nudge; lz += fx * nudge;
    this.lookPt.x = lx; this.lookPt.z = lz;
    const desired = Math.atan2(lx - v.pos.x, lz - v.pos.z);
    const err = wrapAngle(desired - v.yaw);
    let steer = clamp(err * 2.4, -1, 1);
    // speed planning: next corner
    let cornerDist = Infinity, sharp = 0;
    {
      let acc = Math.hypot(this.path[this.pathIdx].x - v.pos.x, this.path[this.pathIdx].z - v.pos.z);
      for (let k = this.pathIdx; k < Math.min(this.path.length - 1, this.pathIdx + 5); k++) {
        const p = this.path[k];
        if (p.corner) { cornerDist = acc; sharp = 1; break; }
        const n = this.path[k + 1];
        acc += Math.hypot(n.x - p.x, n.z - p.z);
      }
      const last = this.path[this.path.length - 1];
      const dEnd = Math.hypot(last.x - v.pos.x, last.z - v.pos.z);
      if (this.pathIdx >= this.path.length - 2 && dEnd < cornerDist) { cornerDist = dEnd; sharp = 2; }
    }
    const top = v.spec.maxSpeed * this.speedFactor;
    const cornerV = sharp === 2 ? 0.5 : 12.5;
    let targetV = Math.min(top, Math.sqrt(cornerV * cornerV + 2 * 13 * Math.max(0, cornerDist - 4)));
    if (Math.abs(err) > 0.9) targetV = Math.min(targetV, 9);
    let throttle = 0, brake = 0;
    if (v.speed < targetV - 0.5) throttle = 1;
    else if (v.speed > targetV + 1.5) brake = clamp((v.speed - targetV) / 6, 0.3, 1);
    // stop precisely at pickup / drop-off
    if (sharp === 2 && cornerDist < 9) { throttle = 0; brake = v.speed > 1.5 ? 1 : 0.6; }
    // unstick
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      throttle = 0; brake = 1; steer = -steer;
    } else if (throttle > 0 && v.speed < 1.2) {
      this.stuckT += dt;
      if (this.stuckT > 1.8) { this.reverseT = 1.3; this.stuckT = 0; this.replanT = 0; }
    } else this.stuckT = Math.max(0, this.stuckT - dt);
    const handbrake = sharp === 1 && cornerDist < 22 && v.speed > 22 && Math.abs(err) > 0.35;
    v.setInput({ throttle, brake, steer, handbrake });
    v.boosting = throttle > 0 && v.speed > 15 && Math.abs(err) < 0.12 && cornerDist > 80 && ctx.allowBoost;
  }
}
