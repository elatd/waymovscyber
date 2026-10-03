// World: scene graph root for everything static + environment.
import * as THREE from 'three';
import { SkySystem } from './Sky.js';
import { createWater, createShoreFoam } from './Water.js';
import { PIERS, SEAWALL, CITY_MAX } from './CityLayout.js';
import { City } from './City.js';
import { buildFarTerrain, buildSprawl } from './Terrain.js';
import { facadeUniforms } from './BuildingMaterial.js';
import { FogBank } from './FogBank.js';

export class World {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.name = 'world';
    this.time = 0;
    this.nightFactor = 0;
    this.nightMaterials = [];
  }

  build(onProgress = () => {}) {
    const scene = this.scene;
    this.sky = new SkySystem(this.renderer, scene);
    onProgress(0.1, 'Painting the sky');
    this.water = createWater(this.sky);
    scene.add(this.water);
    onProgress(0.2, 'Raising the hills');
    this.terrain = buildFarTerrain();
    scene.add(this.terrain);
    onProgress(0.3, 'Laying out the streets');
    this.city = new City(this.renderer).build();
    scene.add(this.city.group);
    onProgress(0.6, 'Building the skyline');
    this.sprawl = buildSprawl();
    this.sprawl.material = this.city.mats.facade;
    scene.add(this.sprawl);
    this.fogBank = new FogBank(scene);
    // shoreline foam along the seawalls and around the piers (normals point into the water)
    const segs = [
      { x0: -700, z0: -SEAWALL, x1: SEAWALL, z1: -SEAWALL, nx: 0, nz: -1 },
      { x0: SEAWALL, z0: -SEAWALL, x1: SEAWALL, z1: CITY_MAX + 30, nx: 1, nz: 0 },
    ];
    for (const p of PIERS) {
      if (p.z1 === -SEAWALL) {
        segs.push({ x0: p.x0, z0: p.z1, x1: p.x0, z1: p.z0, nx: -1, nz: 0 });
        segs.push({ x0: p.x0, z0: p.z0, x1: p.x1, z1: p.z0, nx: 0, nz: -1 });
        segs.push({ x0: p.x1, z0: p.z0, x1: p.x1, z1: p.z1, nx: 1, nz: 0 });
      } else {
        segs.push({ x0: p.x0, z0: p.z0, x1: p.x1, z1: p.z0, nx: 0, nz: -1 });
        segs.push({ x0: p.x1, z0: p.z0, x1: p.x1, z1: p.z1, nx: 1, nz: 0 });
        segs.push({ x0: p.x1, z0: p.z1, x1: p.x0, z1: p.z1, nx: 0, nz: 1 });
      }
    }
    this.foam = createShoreFoam(segs);
    scene.add(this.foam);
    return this;
  }

  setTimeOfDay(name) {
    this.sky.apply(name);
    this.nightFactor = this.sky.preset.night;
    facadeUniforms.uNight.value = this.nightFactor;
    for (const m of this.nightMaterials) {
      const target = m.userData.nightIntensity ?? 1;
      m.emissiveIntensity = target * this.nightFactor;
    }
    this.water.material.uniforms.uNightGlow.value = this.nightFactor;
    if (this.fogBank) this.fogBank.setTimeOfDay(name);
  }

  registerNightMaterials(list) {
    for (const m of list) {
      if (!this.nightMaterials.includes(m)) this.nightMaterials.push(m);
      const target = m.userData.nightIntensity ?? 1;
      m.emissiveIntensity = target * this.nightFactor;
    }
  }

  update(dt, camera, focus, renderer = null) {
    this.time += dt;
    if (renderer) {
      const strength = this.sky.presetName === 'sunset' ? 1.0 : this.sky.presetName === 'night' ? 0.15 : 0.55;
      this._sunCol = this._sunCol || new THREE.Color();
      this._sunCol.copy(this.sky.sun.color).multiplyScalar(this.sky.presetName === 'night' ? 0.4 : 1);
      renderer.updateSun(this.sky.sunDir, this._sunCol, strength);
    }
    facadeUniforms.uTime.value = this.time;
    this.sky.dome.position.copy(camera.position);
    this.sky.update(dt, focus);
    this.city.update(camera.position);
    if (this.fogBank) this.fogBank.update(dt);
    if (this.foam) this.foam.material.uniforms.uTime.value = this.time;
  }
}
