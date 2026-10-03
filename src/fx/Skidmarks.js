// Tire skid marks: ring buffer of ground-hugging quads behind each rear wheel.
import * as THREE from 'three';
import { groundHeight } from '../world/CityLayout.js';

const MAX = 1600; // quads

export class Skidmarks {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 4 * 3);
    this.alpha = new Float32Array(MAX * 4);
    const idx = new Uint32Array(MAX * 6);
    for (let k = 0; k < MAX; k++) {
      const b = k * 4;
      idx.set([b, b + 1, b + 2, b, b + 2, b + 3], k * 6);
    }
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aAlpha', this.aAlpha);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: `attribute float aAlpha; varying float vA;
        #include <fog_pars_vertex>
        void main(){ vA = aAlpha; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `varying float vA;
        #include <fog_pars_fragment>
        void main(){ gl_FragColor = vec4(0.02,0.02,0.025, vA * 0.55);
        #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.cursor = 0;
    this.trails = new Map(); // key → last {l:[x,y,z], r:[x,y,z]}
  }

  // Add a mark segment for a wheel (key unique per wheel). w = mark half width.
  mark(key, x, z, dirX, dirZ, strength = 1, w = 0.13) {
    const y = groundHeight(x, z) + 0.02;
    const lx = -dirZ * w, lz = dirX * w;
    const L = [x + lx, y, z + lz], R = [x - lx, y, z - lz];
    const prev = this.trails.get(key);
    if (prev && Math.hypot(prev.x - x, prev.z - z) < 0.35) return;
    if (prev && Math.hypot(prev.x - x, prev.z - z) < 3) {
      const b = this.cursor * 4;
      const P = this.pos;
      P.set(prev.L, b * 3);
      P.set(prev.R, (b + 1) * 3);
      P.set(R, (b + 2) * 3);
      P.set(L, (b + 3) * 3);
      const a0 = prev.a, a1 = Math.min(1, strength);
      this.alpha[b] = a0; this.alpha[b + 1] = a0; this.alpha[b + 2] = a1; this.alpha[b + 3] = a1;
      this.cursor = (this.cursor + 1) % MAX;
      this.aPos.needsUpdate = true;
      this.aAlpha.needsUpdate = true;
    }
    this.trails.set(key, { x, z, L, R, a: Math.min(1, strength) });
  }

  lift(key) {
    this.trails.delete(key);
  }
}
