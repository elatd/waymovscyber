// "Karl the Fog": billowing fog banks rolling over the Golden Gate, Marin and Twin Peaks.
import * as THREE from 'three';
import { makePuffTexture } from './Textures.js';
import { mulberry32 } from '../core/math.js';

export class FogBank {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'karl-the-fog';
    scene.add(this.group);
    const rng = mulberry32(808);
    const textures = [makePuffTexture(3), makePuffTexture(11), makePuffTexture(23)];
    this.puffs = [];
    const add = (x, y, z, s, a) => {
      const mat = new THREE.SpriteMaterial({ map: textures[Math.floor(rng() * 3)], color: 0xffffff, transparent: true, opacity: a, depthWrite: false, fog: true });
      const sp = new THREE.Sprite(mat);
      sp.position.set(x, y, z);
      sp.scale.set(s, s * 0.45, 1);
      sp.material.rotation = rng() * Math.PI * 2;
      sp.renderOrder = -2;
      this.group.add(sp);
      this.puffs.push({ sp, x, y, z, base: a, phase: rng() * 10, drift: 4 + rng() * 6 });
    };
    // over the Golden Gate strait and Marin headlands
    for (let k = 0; k < 34; k++) {
      const t = rng();
      const x = -3200 + rng() * 1900;
      const z = -1950 + t * 1500;
      add(x, 70 + rng() * 120, z, 380 + rng() * 420, 0.42 + rng() * 0.25);
    }
    // low tongue spilling through the gate under the bridge deck
    for (let k = 0; k < 10; k++) add(-2300 + k * 90, 26 + rng() * 14, -1180 + (rng() - 0.5) * 300, 260 + rng() * 140, 0.35);
    // Twin Peaks / Sutro
    for (let k = 0; k < 12; k++) add(-1500 + rng() * 900, 180 + rng() * 140, 1200 + rng() * 700, 420 + rng() * 300, 0.3 + rng() * 0.2);
    this.tint = new THREE.Color(1, 1, 1);
    this.time = 0;
  }

  setTimeOfDay(name) {
    const c = name === 'sunset' ? new THREE.Color('#ffd0b8') : name === 'night' ? new THREE.Color('#2a3358') : new THREE.Color('#ffffff');
    const k = name === 'night' ? 0.55 : 1;
    for (const p of this.puffs) {
      p.sp.material.color.copy(c);
      p.sp.material.opacity = p.base * k;
    }
  }

  update(dt) {
    this.time += dt;
    for (const p of this.puffs) {
      p.sp.position.x = p.x + Math.sin(this.time * 0.012 + p.phase) * 25 * p.drift;
      p.sp.position.y = p.y + Math.sin(this.time * 0.05 + p.phase * 2) * 6;
      p.sp.material.rotation += dt * 0.003;
    }
  }
}
