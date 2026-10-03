// GPU-billboarded particle pools (instanced quads): sparks, smoke, dust, debris,
// water, leaves, cash sparkles, confetti and boost trails.
import * as THREE from 'three';

const vert = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec2 iSizeRot;
varying vec4 vColor;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vColor = iColor;
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float c = cos(iSizeRot.y), s = sin(iSizeRot.y);
  vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iSizeRot.x;
  vec3 wp = iPos + camRight * p.x + camUp * p.y;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const frag = /* glsl */ `
uniform sampler2D uTex;
uniform float uUseTex;
varying vec4 vColor;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float r = dot(q, q);
  float a = uUseTex > 0.5 ? texture2D(uTex, vUv).a : smoothstep(1.0, 0.0, r) * (0.6 + 0.4 * smoothstep(0.35, 0.0, r));
  vec4 col = vec4(vColor.rgb, vColor.a * a);
  if (col.a < 0.003) discard;
  gl_FragColor = col;
  #include <fog_fragment>
}
`;

class Pool {
  constructor(scene, max, { additive = false, texture = null } = {}) {
    this.max = max;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.sr = new Float32Array(max * 2);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSR = new THREE.InstancedBufferAttribute(this.sr, 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iColor', this.aCol);
    g.setAttribute('iSizeRot', this.aSR);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTex: { value: texture }, uUseTex: { value: texture ? 1 : 0 } }]),
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    mat.uniforms.uTex.value = texture;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 5 : 4;
    scene.add(this.mesh);
    this.geo = g;
    this.p = [];
    for (let k = 0; k < max; k++) this.p.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 1, s1: 1, r: 0, vr: 0, g: 0, drag: 0, c: [1, 1, 1, 1], ground: true, fade: 1 });
    this.cursor = 0;
  }

  emit(o) {
    const p = this.p[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    p.alive = true;
    p.x = o.x; p.y = o.y; p.z = o.z;
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.life = 0; p.max = o.life || 1;
    p.s0 = o.s0 ?? 0.3; p.s1 = o.s1 ?? p.s0;
    p.r = o.r ?? Math.random() * 6.28; p.vr = o.vr ?? 0;
    p.g = o.g ?? 0; p.drag = o.drag ?? 0;
    p.c = o.c || [1, 1, 1, 1];
    p.groundY = o.groundY ?? -1e9;
    p.fadeIn = o.fadeIn ?? 0.05;
    return p;
  }

  update(dt) {
    let n = 0;
    const P = this.pos, C = this.col, SR = this.sr;
    for (let k = 0; k < this.max; k++) {
      const p = this.p[k];
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.max) { p.alive = false; continue; }
      const dk = Math.exp(-p.drag * dt);
      p.vx *= dk; p.vy *= dk; p.vz *= dk;
      p.vy -= p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < p.groundY) { p.y = p.groundY; p.vy = -p.vy * 0.3; p.vx *= 0.7; p.vz *= 0.7; }
      p.r += p.vr * dt;
      const t = p.life / p.max;
      const fade = Math.min(1, p.life / p.fadeIn) * (1 - t * t);
      P[n * 3] = p.x; P[n * 3 + 1] = p.y; P[n * 3 + 2] = p.z;
      C[n * 4] = p.c[0]; C[n * 4 + 1] = p.c[1]; C[n * 4 + 2] = p.c[2]; C[n * 4 + 3] = p.c[3] * fade;
      SR[n * 2] = p.s0 + (p.s1 - p.s0) * t;
      SR[n * 2 + 1] = p.r;
      n++;
    }
    this.geo.instanceCount = n;
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSR.needsUpdate = true;
    this.aPos.updateRanges && (this.aPos.clearUpdateRanges?.(), this.aPos.addUpdateRange?.(0, n * 3));
    this.aCol.updateRanges && (this.aCol.clearUpdateRanges?.(), this.aCol.addUpdateRange?.(0, n * 4));
    this.aSR.updateRanges && (this.aSR.clearUpdateRanges?.(), this.aSR.addUpdateRange?.(0, n * 2));
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);

export class Particles {
  constructor(scene) {
    this.add = new Pool(scene, 1400, { additive: true });
    this.norm = new Pool(scene, 1800, { additive: false });
  }

  update(dt) {
    this.add.update(dt);
    this.norm.update(dt);
  }

  sparks(x, y, z, nx = 0, nz = 0, count = 20, power = 1) {
    for (let k = 0; k < count; k++) {
      const sp = rnd(4, 14) * power;
      this.add.emit({
        x, y, z,
        vx: nx * sp + rnd(-5, 5), vy: rnd(1, 7) * power, vz: nz * sp + rnd(-5, 5),
        life: rnd(0.25, 0.7), s0: rnd(0.06, 0.16), s1: 0.02, g: 18, drag: 1.5,
        c: [4.5, rnd(1.6, 2.6), 0.5, 1], groundY: y - 0.6,
      });
    }
  }

  smoke(x, y, z, vx = 0, vz = 0, amount = 1, tint = [0.86, 0.86, 0.88]) {
    this.norm.emit({
      x: x + rnd(-0.15, 0.15), y: y + rnd(0, 0.15), z: z + rnd(-0.15, 0.15),
      vx: vx * 0.18 + rnd(-0.5, 0.5), vy: rnd(0.3, 1.1), vz: vz * 0.18 + rnd(-0.5, 0.5),
      life: rnd(0.9, 1.7), s0: rnd(0.3, 0.55) * amount, s1: rnd(1.3, 2.3) * amount, drag: 1.6, vr: rnd(-1, 1),
      c: [tint[0], tint[1], tint[2], 0.2 * Math.min(1, amount)], fadeIn: 0.12,
    });
  }

  dust(x, y, z, count = 6, tint = [0.72, 0.64, 0.5]) {
    for (let k = 0; k < count; k++)
      this.norm.emit({
        x, y, z, vx: rnd(-3, 3), vy: rnd(0.5, 2.5), vz: rnd(-3, 3), life: rnd(0.8, 1.6), s0: 0.6, s1: 2.6, drag: 2, vr: rnd(-1, 1),
        c: [tint[0], tint[1], tint[2], 0.35],
      });
  }

  debris(x, y, z, vx, vz, count = 12, color = [0.6, 0.6, 0.6]) {
    for (let k = 0; k < count; k++)
      this.norm.emit({
        x, y: y + 0.4, z, vx: vx * 0.4 + rnd(-4, 4), vy: rnd(2, 8), vz: vz * 0.4 + rnd(-4, 4),
        life: rnd(0.8, 1.6), s0: rnd(0.08, 0.2), s1: rnd(0.06, 0.15), g: 20, drag: 0.5, vr: rnd(-12, 12),
        c: [color[0] * rnd(0.8, 1.1), color[1] * rnd(0.8, 1.1), color[2] * rnd(0.8, 1.1), 1], groundY: y, fadeIn: 0.01,
      });
  }

  water(x, y, z, count = 10, up = 9, spread = 1.4) {
    for (let k = 0; k < count; k++)
      this.norm.emit({
        x: x + rnd(-0.1, 0.1), y, z: z + rnd(-0.1, 0.1),
        vx: rnd(-spread, spread), vy: rnd(up * 0.7, up * 1.2), vz: rnd(-spread, spread),
        life: rnd(0.9, 1.5), s0: rnd(0.12, 0.25), s1: rnd(0.4, 0.8), g: 12, drag: 0.4,
        c: [0.78, 0.9, 1.0, 0.7], groundY: y - 0.2,
      });
  }

  splash(x, y, z) {
    for (let k = 0; k < 90; k++) {
      const a = Math.random() * Math.PI * 2, s = rnd(2, 9);
      this.norm.emit({ x, y, z, vx: Math.cos(a) * s, vy: rnd(5, 15), vz: Math.sin(a) * s, life: rnd(0.8, 1.8), s0: rnd(0.25, 0.5), s1: rnd(0.8, 1.6), g: 16, drag: 0.6, c: [0.85, 0.93, 1, 0.75] });
    }
  }

  leaves(x, y, z, count = 8) {
    for (let k = 0; k < count; k++) {
      const pink = Math.random() < 0.35;
      this.norm.emit({
        x, y: y + 0.8, z, vx: rnd(-3, 3), vy: rnd(1.5, 5), vz: rnd(-3, 3), life: rnd(1, 2), s0: 0.14, s1: 0.12, g: 6, drag: 1.5, vr: rnd(-8, 8),
        c: pink ? [1, 0.35, 0.6, 1] : [0.25, rnd(0.5, 0.7), 0.2, 1], groundY: y, fadeIn: 0.01,
      });
    }
  }

  cash(x, y, z, count = 26) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2, s = rnd(1.5, 5);
      this.add.emit({ x, y: y + 1.5, z, vx: Math.cos(a) * s, vy: rnd(3, 9), vz: Math.sin(a) * s, life: rnd(0.8, 1.6), s0: rnd(0.12, 0.25), s1: 0.05, g: 8, drag: 0.8, c: Math.random() < 0.5 ? [0.5, 3.5, 1.2, 1] : [3.6, 2.8, 0.6, 1] });
    }
  }

  confetti(x, y, z, count = 60) {
    const cols = [[1, 0.2, 0.3], [0.2, 0.8, 1], [1, 0.85, 0.1], [0.4, 1, 0.4], [0.9, 0.3, 1]];
    for (let k = 0; k < count; k++) {
      const c = cols[Math.floor(Math.random() * cols.length)];
      const a = Math.random() * Math.PI * 2, s = rnd(1, 4);
      this.norm.emit({ x, y: y + 2.5, z, vx: Math.cos(a) * s, vy: rnd(4, 9), vz: Math.sin(a) * s, life: rnd(1.5, 2.8), s0: 0.12, s1: 0.1, g: 5, drag: 1.4, vr: rnd(-10, 10), c: [c[0], c[1], c[2], 1], fadeIn: 0.01 });
    }
  }

  trail(x, y, z, color, size = 0.45) {
    this.add.emit({ x: x + rnd(-0.04, 0.04), y: y + rnd(-0.04, 0.04), z: z + rnd(-0.04, 0.04), life: 0.28, s0: size, s1: 0.02, c: [color[0] * 0.7, color[1] * 0.7, color[2] * 0.7, color[3]] });
  }

  glow(x, y, z, color, size = 2, life = 0.3) {
    this.add.emit({ x, y, z, life, s0: size, s1: size * 1.6, c: color });
  }
}
