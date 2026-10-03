// Stylized physically-inspired sky dome with sun, glow and procedural clouds,
// plus time-of-day presets that drive the sun light, hemisphere fill, fog and env map.
import * as THREE from 'three';

export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uCloudColor;
uniform vec3 uCloudShade;
uniform float uCloudCover;
uniform float uTime;
uniform float uSunSize;
uniform float uStars;

float sh12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float snoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sh12(i), sh12(i + vec2(1, 0)), u.x), mix(sh12(i + vec2(0, 1)), sh12(i + vec2(1, 1)), u.x), u.y);
}
float sfbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int k = 0; k < 5; k++) { s += a * snoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}
vec3 skyColor(vec3 dir, bool withSun) {
  float y = dir.y;
  float up = clamp(y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
  // horizon haze band
  col = mix(col, uHorizon * 1.08, exp(-abs(y) * 14.0) * 0.6);
  if (y < 0.0) col = mix(uHorizon, uGround, clamp(-y * 3.0, 0.0, 1.0));
  float sd = max(dot(dir, uSunDir), 0.0);
  // mie-ish glow around the sun
  col += uSunColor * (pow(sd, 6.0) * 0.28 + pow(sd, 48.0) * 0.6) * (0.4 + 0.6 * smoothstep(-0.1, 0.25, uSunDir.y + 0.15));
  if (withSun) {
    float disc = smoothstep(uSunSize, uSunSize + 0.0009, sd);
    col += uSunColor * disc * 22.0;
  }
  // clouds on a virtual plane
  if (y > 0.0) {
    vec2 cuv = dir.xz / (y + 0.08) * 0.65 + vec2(uTime * 0.004, uTime * 0.0013);
    float n = sfbm(cuv * 1.6);
    float cov = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.32, n);
    float detail = sfbm(cuv * 5.0 + 3.1);
    cov *= smoothstep(0.0, 0.12, y);
    float lightSide = pow(max(dot(dir, uSunDir), 0.0), 3.0);
    vec3 cc = mix(uCloudShade, uCloudColor, clamp(0.45 + detail * 0.6 + lightSide * 0.5, 0.0, 1.3));
    cc += uSunColor * pow(sd, 12.0) * 0.6 * (1.0 - cov); // silver lining
    col = mix(col, cc, cov * 0.92);
  }
  // stars at night
  if (uStars > 0.0 && y > 0.0) {
    vec2 sp = dir.xz / (y + 0.3) * 160.0;
    float st = step(0.9965, sh12(floor(sp))) * smoothstep(0.0, 0.3, y);
    col += vec3(st) * uStars * 1.4;
  }
  return col;
}
`;

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // at far plane
}
`;

const frag = /* glsl */ `
${SKY_GLSL}
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  gl_FragColor = vec4(skyColor(d, true), 1.0);
  #include <colorspace_fragment>
}
`;

export const PRESETS = {
  day: {
    label: 'Sunny Afternoon',
    sunElev: 38, sunAz: 205,
    zenith: '#1557c9', horizon: '#9dd0f7', ground: '#7b8a93',
    sun: '#fff0d2', sunIntensity: 4.3,
    hemiSky: '#c4defc', hemiGround: '#8b7a62', hemiIntensity: 0.55,
    fog: '#a9cdea', fogDensity: 0.00023,
    cloudColor: '#ffffff', cloudShade: '#9fb2c9', cloudCover: 0.4,
    exposure: 1.0, envIntensity: 0.9, night: 0, stars: 0,
  },
  sunset: {
    label: 'Golden Hour',
    sunElev: 7, sunAz: 290,
    zenith: '#1d3f96', horizon: '#ffa766', ground: '#5d4a52',
    sun: '#ffb877', sunIntensity: 4.1,
    hemiSky: '#a9b8e8', hemiGround: '#5a4a52', hemiIntensity: 0.62,
    fog: '#d7a392', fogDensity: 0.00024,
    cloudColor: '#ffc690', cloudShade: '#94557a', cloudCover: 0.5,
    exposure: 1.05, envIntensity: 0.85, night: 0.25, stars: 0,
  },
  night: {
    label: 'Neon Night',
    sunElev: 34, sunAz: 140, // moon
    zenith: '#050a1c', horizon: '#26305a', ground: '#0c0e16',
    sun: '#9fb6ff', sunIntensity: 0.45,
    hemiSky: '#4a5fa8', hemiGround: '#2a2030', hemiIntensity: 0.8,
    fog: '#1b2244', fogDensity: 0.00042,
    cloudColor: '#4a5580', cloudShade: '#141a33', cloudCover: 0.35,
    exposure: 1.1, envIntensity: 0.6, night: 1, stars: 1,
  },
};

export class SkySystem {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uCloudColor: { value: new THREE.Color() },
      uCloudShade: { value: new THREE.Color() },
      uCloudCover: { value: 0.4 },
      uTime: { value: 0 },
      uSunSize: { value: 0.99975 },
      uStars: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    this.dome.scale.setScalar(6000);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 900;
    this.setShadowQuality(4096, 130);
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xffffff, 0.0003);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    const envDome = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `${SKY_GLSL}\n varying vec3 vDir; void main(){ gl_FragColor = vec4(skyColor(normalize(vDir), false) , 1.0); }`,
      side: THREE.BackSide,
      depthWrite: false,
    }));
    this.envScene.add(envDome);
    this.envTarget = null;
    this.preset = null;
    this.sunDir = new THREE.Vector3();
    this.shadowFocus = new THREE.Vector3();
  }

  setShadowQuality(mapSize, extent) {
    this.sun.shadow.mapSize.set(mapSize, mapSize);
    const cam = this.sun.shadow.camera;
    cam.left = -extent; cam.right = extent; cam.top = extent; cam.bottom = -extent;
    cam.updateProjectionMatrix();
    this.shadowExtent = extent;
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
  }

  apply(name) {
    const p = PRESETS[name] || PRESETS.day;
    this.preset = p;
    this.presetName = name;
    const el = THREE.MathUtils.degToRad(p.sunElev), az = THREE.MathUtils.degToRad(p.sunAz);
    // azimuth: 0 = north(-z), 90 = east(+x)
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    const u = this.uniforms;
    u.uSunDir.value.copy(this.sunDir);
    u.uZenith.value.set(p.zenith);
    u.uHorizon.value.set(p.horizon);
    u.uGround.value.set(p.ground);
    u.uSunColor.value.set(p.sun).multiplyScalar(name === 'night' ? 0.35 : 1);
    u.uCloudColor.value.set(p.cloudColor);
    u.uCloudShade.value.set(p.cloudShade);
    u.uCloudCover.value = p.cloudCover;
    u.uStars.value = p.stars;
    u.uSunSize.value = name === 'night' ? 0.99985 : 0.99972;
    this.sun.color.set(p.sun);
    this.sun.intensity = p.sunIntensity;
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.scene.fog.color.set(p.fog);
    this.scene.fog.density = p.fogDensity;
    this.scene.environmentIntensity = p.envIntensity;
    this.bakeEnv();
  }

  bakeEnv() {
    if (this.envTarget) this.envTarget.dispose();
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000);
    this.scene.environment = this.envTarget.texture;
  }

  // Keep the shadow frustum centered on the focus point, snapped to texels to avoid shimmer.
  update(dt, focus) {
    this.uniforms.uTime.value += dt;
    const ext = this.shadowExtent;
    const texel = (ext * 2) / this.sun.shadow.mapSize.x;
    // move in light space
    const lightPos = this.shadowFocus.copy(focus);
    const d = this.sunDir;
    // basis for snapping
    const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
    if (right.lengthSq() < 0.01) right.set(1, 0, 0);
    const up = new THREE.Vector3().crossVectors(right, d).normalize();
    const r = Math.round(lightPos.dot(right) / texel) * texel;
    const uu = Math.round(lightPos.dot(up) / texel) * texel;
    const f = lightPos.dot(d);
    lightPos.copy(right).multiplyScalar(r).addScaledVector(up, uu).addScaledVector(d, f);
    this.sun.target.position.copy(lightPos);
    this.sun.position.copy(lightPos).addScaledVector(d, 450);
    this.sun.target.updateMatrixWorld();
  }
}
