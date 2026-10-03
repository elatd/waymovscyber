// San Francisco Bay: animated normal-mapped water that reflects the procedural sky,
// with sun glints, fresnel and distance-based color. Very cheap (no extra render passes).
import * as THREE from 'three';
import { SKY_GLSL } from './Sky.js';
import { makeWaterNormal } from './Textures.js';

export function createWater(sky) {
  const normalMap = makeWaterNormal();
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uNormal: { value: normalMap },
      uDeep: { value: new THREE.Color('#0b4f73') },
      uShallow: { value: new THREE.Color('#1d8fa3') },
      uNightGlow: { value: 0 },
    },
  ]);
  // share sky uniforms by reference
  for (const k of Object.keys(sky.uniforms)) uniforms[k] = sky.uniforms[k];
  uniforms.uNormal.value = normalMap;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      uniform sampler2D uNormal;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform float uNightGlow;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      vec3 sampleN(vec2 uv) { return texture2D(uNormal, uv).xyz * 2.0 - 1.0; }
      void main() {
        float t = uTime;
        vec2 p = vWorld.xz;
        vec3 n1 = sampleN(p * 0.012 + vec2(t * 0.010, t * 0.006));
        vec3 n2 = sampleN(p * 0.031 - vec2(t * 0.016, -t * 0.011));
        vec3 n3 = sampleN(p * 0.0045 + vec2(-t * 0.003, t * 0.004));
        vec3 n = normalize(vec3(n1.xy * 0.55 + n2.xy * 0.35 + n3.xy * 0.6, 1.0));
        vec3 N = normalize(vec3(n.x, n.z * 2.4, n.y));
        vec3 V = normalize(cameraPosition - vWorld);
        float dist = length(cameraPosition - vWorld);
        // flatten normals with distance to avoid sparkly aliasing
        N = normalize(mix(N, vec3(0.0, 1.0, 0.0), smoothstep(400.0, 2500.0, dist) * 0.7));
        vec3 R = reflect(-V, N);
        R.y = abs(R.y);
        vec3 refl = skyColor(R, false);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 0.9, 1.0 - V.y));
        body *= 0.55 + 0.45 * max(uSunDir.y, 0.0);
        vec3 col = mix(body, refl, clamp(fres * 1.15, 0.0, 1.0));
        // sun glints
        float spec = pow(max(dot(R, uSunDir), 0.0), 380.0) * 14.0 + pow(max(dot(R, uSunDir), 0.0), 40.0) * 0.35;
        col += uSunColor * spec * smoothstep(-0.05, 0.1, uSunDir.y);
        col += vec3(1.0, 0.7, 0.4) * uNightGlow * 0.02;
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const geo = new THREE.PlaneGeometry(16000, 16000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 0, 0);
  mesh.name = 'bay';
  mesh.receiveShadow = false;
  mesh.renderOrder = -1;
  return mesh;
}

// Animated foam band where the bay meets seawalls and piers.
export function createShoreFoam(segments) {
  // segments: [{x0,z0,x1,z1,nx,nz}] lines along the wall with outward normal (n points to water)
  const pos = [], uv = [], idx = [];
  let n = 0;
  const W = 3.2;
  for (const s of segments) {
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
    const steps = Math.max(1, Math.ceil(len / 6));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const x = s.x0 + (s.x1 - s.x0) * t, z = s.z0 + (s.z1 - s.z0) * t;
      pos.push(x, 0.06, z, x + s.nx * W, 0.06, z + s.nz * W);
      uv.push(t * len, 0, t * len, 1);
    }
    for (let k = 0; k < steps; k++) {
      const a = n + k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    n += (steps + 1) * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() { vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      #include <fog_pars_fragment>
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
      void main() {
        float d = vUv.y;
        float wave = 0.5 + 0.5 * sin(vUv.x * 0.35 - uTime * 1.6 + n2(vec2(vUv.x * 0.1, uTime * 0.2)) * 4.0);
        float edge = smoothstep(0.15 + wave * 0.55, 0.0, d);
        float speck = n2(vec2(vUv.x * 1.3, d * 6.0 - uTime * 0.6)) * n2(vec2(vUv.x * 0.37 + uTime * 0.2, d * 3.0));
        float a = clamp(edge * (0.55 + speck * 0.9), 0.0, 1.0) * smoothstep(1.0, 0.6, d);
        gl_FragColor = vec4(vec3(0.95, 0.98, 1.0), a * 0.75);
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 1;
  mesh.name = 'shore-foam';
  return mesh;
}
