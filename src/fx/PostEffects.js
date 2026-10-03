// Custom post effects: radial speed blur (boost / Ludicrous) and the Waymo lidar scan pulse.
import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';

const radialFrag = /* glsl */ `
uniform float strength;
uniform vec2 center;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 dir = uv - center;
  float d = length(dir);
  float k = strength * smoothstep(0.08, 0.7, d);
  vec4 acc = inputColor;
  float wsum = 1.0;
  for (int i = 1; i <= 10; i++) {
    float t = float(i) / 10.0;
    float w = 1.0 - t * 0.6;
    acc += texture2D(inputBuffer, uv - dir * k * t * 0.18) * w;
    wsum += w;
  }
  outputColor = acc / wsum;
}
`;

export class RadialBlurEffect extends Effect {
  constructor() {
    super('RadialBlurEffect', radialFrag, {
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['strength', new THREE.Uniform(0)],
        ['center', new THREE.Uniform(new THREE.Vector2(0.5, 0.52))],
      ]),
    });
  }
  get strength() { return this.uniforms.get('strength').value; }
  set strength(v) { this.uniforms.get('strength').value = v; }
}

const scanFrag = /* glsl */ `
uniform mat4 invProj;
uniform mat4 camWorld;
uniform vec3 origin;
uniform float radius;
uniform float intensity;
uniform vec3 scanColor;
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  outputColor = inputColor;
  if (intensity <= 0.001 || depth >= 0.99999) return;
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 vp = invProj * ndc;
  vp /= vp.w;
  vec3 wp = (camWorld * vec4(vp.xyz, 1.0)).xyz;
  float d = length(wp.xz - origin.xz);
  float band = exp(-pow((d - radius) / 2.2, 2.0));
  float trail = smoothstep(radius, radius - 40.0, d) * step(d, radius);
  vec2 g = abs(fract(wp.xz / 3.0 + 0.5) - 0.5) / fwidth(wp.xz / 3.0);
  float grid = 1.0 - min(min(g.x, g.y), 1.0);
  float hgrid = 1.0 - min(abs(fract(wp.y / 2.0 + 0.5) - 0.5) / fwidth(wp.y / 2.0), 1.0);
  vec3 add = scanColor * (band * 3.5 + trail * (grid * 0.9 + hgrid * 0.6) * 0.55) * intensity;
  outputColor = vec4(inputColor.rgb + add, inputColor.a);
}
`;

export class ScanPulseEffect extends Effect {
  constructor(camera) {
    super('ScanPulseEffect', scanFrag, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['invProj', new THREE.Uniform(new THREE.Matrix4())],
        ['camWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['origin', new THREE.Uniform(new THREE.Vector3())],
        ['radius', new THREE.Uniform(0)],
        ['intensity', new THREE.Uniform(0)],
        ['scanColor', new THREE.Uniform(new THREE.Color(0.2, 0.9, 1.0))],
      ]),
    });
    this.cam = camera;
  }
  update() {
    this.uniforms.get('invProj').value.copy(this.cam.projectionMatrixInverse);
    this.uniforms.get('camWorld').value.copy(this.cam.matrixWorld);
  }
  set(origin, radius, intensity, color) {
    this.uniforms.get('origin').value.copy(origin);
    this.uniforms.get('radius').value = radius;
    this.uniforms.get('intensity').value = intensity;
    if (color) this.uniforms.get('scanColor').value.copy(color);
  }
}
