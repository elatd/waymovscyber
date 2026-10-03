// Passengers, destinations, fares and timers (Crazy Taxi rules) — shared by the player
// and the rival robotaxi.
import * as THREE from 'three';
import * as L from '../world/CityLayout.js';
import { mulberry32 } from '../core/math.js';

export const TIERS = [
  { name: 'short', color: '#ff3b5c', css: '#ff3b5c', min: 150, max: 340, weight: 0.22 },
  { name: 'medium', color: '#ff9f1c', css: '#ff9f1c', min: 340, max: 560, weight: 0.3 },
  { name: 'long', color: '#ffe11f', css: '#ffe11f', min: 560, max: 820, weight: 0.28 },
  { name: 'epic', color: '#39ff88', css: '#39ff88', min: 820, max: 1500, weight: 0.2 },
];

const beamVert = /* glsl */ `
varying vec2 vUv;
varying float vH;
void main() { vUv = uv; vH = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const beamFrag = /* glsl */ `
uniform vec3 uColor; uniform float uTime; uniform float uAlpha; uniform float uHeight;
varying vec2 vUv; varying float vH;
void main() {
  float h = clamp(vH / uHeight, 0.0, 1.0);
  float a = pow(1.0 - h, 1.6) * (0.55 + 0.45 * sin(vUv.x * 40.0 + uTime * 3.0) * 0.2 + 0.2);
  float bands = 0.75 + 0.25 * sin(vH * 0.8 - uTime * 6.0);
  gl_FragColor = vec4(uColor * 2.2 * bands, a * uAlpha);
}
`;

function makeBeam(color, radius, height) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uAlpha: { value: 0.7 }, uHeight: { value: height } },
    vertexShader: beamVert, fragmentShader: beamFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const g = new THREE.CylinderGeometry(radius, radius * 1.04, height, 40, 1, true);
  g.translate(0, height / 2, 0);
  const beam = new THREE.Mesh(g, mat);
  beam.renderOrder = 6;
  beam.frustumCulled = false;
  return beam;
}

const iconCache = new Map();
function iconTexture(color) {
  if (iconCache.has(color)) return iconCache.get(color);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 62);
  g.addColorStop(0, color);
  g.addColorStop(0.62, color);
  g.addColorStop(0.64, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.72, 'rgba(0,0,0,0.0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(64, 64, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = '900 64px Bungee, Impact, Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#111';
  ctx.strokeText('$', 64, 68);
  ctx.fillStyle = '#fff';
  ctx.fillText('$', 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  iconCache.set(color, t);
  return t;
}

function makeIcon(color) {
  const m = new THREE.SpriteMaterial({ map: iconTexture(color), transparent: true, depthWrite: false, depthTest: true, fog: false });
  const sp = new THREE.Sprite(m);
  sp.scale.set(2.2, 2.2, 1);
  sp.renderOrder = 8;
  return sp;
}

function makeRing(color, r) {
  const g = new THREE.RingGeometry(r * 0.82, r, 48);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
  const ring = new THREE.Mesh(g, m);
  ring.renderOrder = 6;
  return ring;
}

const PICKUP_LINES = [
  'Take me to {d} — and step on it!',
  '{d}, please! Wait… is anyone driving this thing?!',
  'I\'m late for my demo day at {d}!',
  'Hey robo-cab! {d}, as fast as you legally can. Or not.',
  '{d}! My Uber surge was 4x, you\'re my hero.',
  'Quick! {d}! My boba is getting warm!',
  'To {d}! Pretend it\'s the Bullitt chase!',
  '{d}, and take the hills like you mean it!',
  'I need to get to {d} before the fog rolls in!',
  'Is this the self-driving one? Cool. {d}!',
];
const CRASH_LINES = ['WATCH IT!', 'My latte!!', 'Is that a feature or a bug?!', 'One star. ONE STAR!', 'Was that the safety update?!', 'AAAAH!', 'My phone!', 'Recalculating… my life choices!'];
const JUMP_LINES = ['WHEEEEE!', 'We\'re FLYING!', 'This was NOT in the brochure!', 'Do that again!', 'My stomach!!', 'SAN FRAN-SKY-SCO!'];
const DRIFT_LINES = ['Sideways! Yesss!', 'Tokyo drift vibes!', 'Smooth!', 'Is the AI showing off?'];
const DELIVER_LINES = ['That was CRAZY! Keep the change!', 'Five stars! Maybe six!', 'Never again… but thanks!', 'Best ride ever!', 'I\'m telling all my friends!', 'Legendary driving, robot.'];
const FAIL_LINES = ['Forget it, I\'ll take the cable car!', 'I\'m walking!', 'Unbelievable. Cancelled.', 'Too slow, bot!'];

export class Missions {
  constructor(game) {
    this.game = game;
    this.scene = game.world.scene;
    this.rng = mulberry32(Date.now() & 0xffff);
    this.waiting = [];
    this.fares = new Map(); // driver -> fare
    this.maxWaiting = 11;
    this.time = 0;
    this.destBeam = makeBeam('#39ff88', 11, 140);
    this.destRing = makeRing('#39ff88', 11);
    this.destBeam.visible = this.destRing.visible = false;
    this.scene.add(this.destBeam, this.destRing);
    this.rivalBeam = makeBeam('#ff5a36', 7, 60);
    this.rivalBeam.material.uniforms.uAlpha.value = 0.35;
    this.rivalBeam.visible = false;
    this.scene.add(this.rivalBeam);
    this.lines = { PICKUP_LINES, CRASH_LINES, JUMP_LINES, DRIFT_LINES, DELIVER_LINES, FAIL_LINES };
    this.spawnCooldown = 0;
  }

  line(list, d = '') {
    const s = list[Math.floor(this.rng() * list.length)];
    return s.replace('{d}', d);
  }

  reset() {
    for (const w of this.waiting) this.removeWaiting(w);
    this.waiting.length = 0;
    this.fares.clear();
    this.destBeam.visible = this.destRing.visible = false;
    this.rivalBeam.visible = false;
  }

  pickTier() {
    let r = this.rng();
    for (const t of TIERS) { if ((r -= t.weight) <= 0) return t; }
    return TIERS[0];
  }

  pickDestination(x, z, tier) {
    const cands = L.DESTINATIONS.filter((d) => {
      const dist = Math.hypot(d.x - x, d.z - z);
      return dist >= tier.min && dist <= tier.max;
    });
    if (!cands.length) {
      // closest tier match fallback
      let best = null, bd = Infinity;
      for (const d of L.DESTINATIONS) {
        const dist = Math.hypot(d.x - x, d.z - z);
        const err = dist < tier.min ? tier.min - dist : dist > tier.max ? dist - tier.max : 0;
        if (err < bd && dist > 120) { bd = err; best = d; }
      }
      return best;
    }
    // landmarks are a bit more likely
    const weighted = cands.flatMap((d) => (d.landmark ? [d, d] : [d]));
    return weighted[Math.floor(this.rng() * weighted.length)];
  }

  spawnPassenger(px, pz) {
    const spot = L.randomSidewalkSpot(this.rng, px, pz, 420);
    if (!spot) return null;
    const dp = Math.hypot(spot.x - px, spot.z - pz);
    if (dp < 45) return null;
    for (const w of this.waiting) if (Math.hypot(w.x - spot.x, w.z - spot.z) < 40) return null;
    const tier = this.pickTier();
    const dest = this.pickDestination(spot.x, spot.z, tier);
    if (!dest) return null;
    const ped = this.game.peds.claim(spot.x, spot.z, spot.facing);
    if (!ped) return null;
    const ring = makeRing(tier.color, 6.6);
    const beam = makeBeam(tier.color, 1.3, 34);
    beam.material.uniforms.uAlpha.value = 0.6;
    const icon = makeIcon(tier.css);
    const y = L.groundHeight(spot.x, spot.z);
    // stand the marker just off the curb on the road side
    ring.position.set(spot.x, y + 0.06, spot.z);
    beam.position.set(spot.x, y, spot.z);
    icon.position.set(spot.x, y + 4.2, spot.z);
    this.scene.add(ring, beam, icon);
    const w = { id: Math.floor(this.rng() * 1e9), ped, x: spot.x, z: spot.z, y, tier, dest, ring, beam, icon, spot, claimedBy: null, age: 0 };
    ped.passenger = w;
    this.waiting.push(w);
    return w;
  }

  removeWaiting(w) {
    this.scene.remove(w.ring, w.beam, w.icon);
    w.icon.material.dispose();
    w.ring.geometry.dispose(); w.ring.material.dispose();
    w.beam.geometry.dispose(); w.beam.material.dispose();
    const i = this.waiting.indexOf(w);
    if (i >= 0) this.waiting.splice(i, 1);
  }

  // Begin a fare for `driver` (player or rival)
  board(driver, veh, w) {
    const route = L.findRoute(w.x, w.z, w.dest.x, w.dest.z);
    const dist = L.routeLength(w.x, w.z, route);
    const timeMax = Math.round(dist / 15.5 + 9);
    const base = 4 + dist * 0.034;
    const fare = { driver, passenger: w, dest: w.dest, tier: w.tier, dist, timeMax, timeLeft: timeMax, base, tips: 0, ped: w.ped, startedAt: this.time };
    this.fares.set(driver, fare);
    w.ped.state = 'board';
    w.ped.t = 0;
    w.ped.targetX = veh.pos.x;
    w.ped.targetZ = veh.pos.z;
    this.removeWaiting(w);
    return fare;
  }

  // Called each frame
  update(dt, ctx) {
    this.time += dt;
    const { player, rival, playerDriver, rivalDriver } = ctx;
    const px = player.pos.x, pz = player.pos.z;
    // spawn passengers around the player
    this.spawnCooldown -= dt;
    if (this.waiting.length < this.maxWaiting && this.spawnCooldown <= 0) {
      this.spawnPassenger(px, pz);
      this.spawnCooldown = this.waiting.length < 5 ? 0.05 : 0.6;
    }
    // despawn far passengers
    for (let k = this.waiting.length - 1; k >= 0; k--) {
      const w = this.waiting[k];
      w.age += dt;
      const d = Math.hypot(w.x - px, w.z - pz);
      if (d > 560) {
        w.ped.passenger = null;
        w.ped.state = 'walk';
        this.game.peds.release(w.ped);
        this.removeWaiting(w);
        continue;
      }
      // wave when the player is near
      const near = Math.max(0, 1 - d / 60);
      w.ped.wave += (near - w.ped.wave) * Math.min(1, dt * 3);
      // animate markers
      const s = 1 + Math.sin(this.time * 4 + w.id) * 0.06;
      w.ring.scale.setScalar(s);
      w.beam.material.uniforms.uTime.value = this.time;
      w.ring.material.opacity = 0.65 + Math.sin(this.time * 5 + w.id) * 0.25;
      w.icon.position.y = w.y + 4.2 + Math.sin(this.time * 3 + w.id) * 0.35;
      const isc = 2.0 + Math.min(2.2, d / 90);
      w.icon.scale.set(isc, isc, 1);
      // keep marker on the waiting ped (they may have dodged)
    }
    this.destBeam.material.uniforms.uTime.value = this.time;
    this.rivalBeam.material.uniforms.uTime.value = this.time;
    const out = [];
    // pickups
    for (const [drv, veh] of [[playerDriver, player], [rivalDriver, rival]]) {
      if (!drv || !veh) continue;
      const fare = this.fares.get(drv);
      if (!fare) {
        for (const w of this.waiting) {
          const d = Math.hypot(w.x - veh.pos.x, w.z - veh.pos.z);
          if (d < 7.2 && veh.speed < (drv.isPlayer ? 3.2 : 3.6) && veh.grounded) {
            const f = this.board(drv, veh, w);
            out.push({ type: 'pickup', driver: drv, fare: f });
            break;
          }
        }
      } else {
        fare.timeLeft -= dt;
        const d = Math.hypot(fare.dest.x - veh.pos.x, fare.dest.z - veh.pos.z);
        fare.distLeft = d;
        if (d < 12.5 && veh.speed < (drv.isPlayer ? 4 : 4.5) && veh.grounded) {
          out.push({ type: 'deliver', driver: drv, fare, ...this.payout(fare) });
          this.fares.delete(drv);
          // passenger hops out and celebrates
          const ped = fare.ped;
          ped.passenger = null;
          ped.active = true;
          ped.pos.set(veh.pos.x + Math.cos(veh.yaw) * 2.2, L.groundHeight(veh.pos.x, veh.pos.z), veh.pos.z - Math.sin(veh.yaw) * 2.2);
          ped.state = 'celebrate';
          ped.t = 0;
        } else if (fare.timeLeft <= 0) {
          out.push({ type: 'fail', driver: drv, fare });
          this.fares.delete(drv);
          const ped = fare.ped;
          ped.passenger = null;
          ped.active = true;
          ped.pos.set(veh.pos.x + Math.cos(veh.yaw) * 2.2, L.groundHeight(veh.pos.x, veh.pos.z), veh.pos.z - Math.sin(veh.yaw) * 2.2);
          this.game.peds.release(ped);
        }
      }
    }
    // destination markers
    const pf = this.fares.get(playerDriver);
    if (pf) {
      this.destBeam.visible = this.destRing.visible = true;
      const y = L.groundHeight(pf.dest.x, pf.dest.z);
      this.destBeam.position.set(pf.dest.x, y, pf.dest.z);
      this.destRing.position.set(pf.dest.x, y + 0.08, pf.dest.z);
      this.destRing.scale.setScalar(1 + Math.sin(this.time * 5) * 0.05);
    } else this.destBeam.visible = this.destRing.visible = false;
    const rf = rivalDriver && this.fares.get(rivalDriver);
    if (rf) {
      this.rivalBeam.visible = true;
      this.rivalBeam.position.set(rf.dest.x, L.groundHeight(rf.dest.x, rf.dest.z), rf.dest.z);
    } else this.rivalBeam.visible = false;
    return out;
  }

  payout(fare) {
    const frac = Math.max(0, fare.timeLeft) / fare.timeMax;
    let rating, mult, timeBonus;
    if (frac >= 0.42) { rating = 'SPEEDY!'; mult = 1.5; timeBonus = 10; }
    else if (frac >= 0.15) { rating = 'NORMAL'; mult = 1.0; timeBonus = 5; }
    else { rating = 'SLOW…'; mult = 0.8; timeBonus = 2; }
    const amount = Math.round((fare.base * mult + fare.tips) * 100) / 100;
    return { rating, amount, timeBonus };
  }

  fareOf(driver) {
    return this.fares.get(driver) || null;
  }
}
