// Procedural facade material: windows, curtain walls, brick, storefronts, roofs — all
// evaluated per-pixel from facade-space UVs (meters), so every building in the city can
// share ONE material and be merged into a handful of draw calls.
//
// Per-vertex attributes:
//   color   (vec3, normalized u8)  wall color
//   aTrim   (vec3, normalized u8)  trim / frame / mullion color
//   aFUV    (vec2)                 facade coords in meters (u along wall, v up from street level)
//   aParams (vec4)                 x=style, y=window spacing (m), z=floor height (m), w=seed 0..1
//
// Styles:
export const FACADE = {
  PLAIN: 0,
  RESIDENTIAL: 1,
  OFFICE: 2,
  CURTAIN: 3,
  BRICK: 4,
  ROOF: 5,
  CHINATOWN: 6,
  STONE: 7,
  SIDING: 8, // victorian clapboard without windows (bays sides etc.)
  STUCCO: 9, // marina stucco + windows
  STRIPES: 10, // awning stripes (wall/trim alternating along u)
  SIGN: 11, // glowing sign panel (emissive at night)
};

import * as THREE from 'three';

const shared = { uNight: { value: 0 }, uTime: { value: 0 } };
export const facadeUniforms = shared;

export function createFacadeMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.0,
    envMapIntensity: 1.0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = shared.uNight;
    shader.uniforms.uTime = shared.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aTrim;
        attribute vec4 aParams;
        attribute vec2 aFUV;
        varying vec3 vTrim;
        varying vec4 vParams;
        varying vec2 vFUV;
        varying vec3 vFNormal;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vTrim = aTrim;
        vParams = aParams;
        vFUV = aFUV;
        vFNormal = normal;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uNight;
        uniform float uTime;
        varying vec3 vTrim;
        varying vec4 vParams;
        varying vec2 vFUV;
        varying vec3 vFNormal;
        float fh12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * .1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        float fnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(fh12(i), fh12(i + vec2(1, 0)), u.x), mix(fh12(i + vec2(0, 1)), fh12(i + vec2(1, 1)), u.x), u.y);
        }
        // anti-aliased box mask in cell space
        float boxMask(vec2 f, vec2 lo, vec2 hi, vec2 aa) {
          vec2 m = smoothstep(lo - aa, lo + aa, f) * (1.0 - smoothstep(hi - aa, hi + aa, f));
          return m.x * m.y;
        }
        `
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 fAlbedo = diffuseColor.rgb;
        float fRough = 0.86;
        float fMetal = 0.0;
        vec3 fEmis = vec3(0.0);
        {
          int st = int(vParams.x + 0.5);
          float sx = max(vParams.y, 0.5);
          float fl = max(vParams.z, 0.5);
          float seed = vParams.w;
          vec2 uv = vFUV;
          vec3 wall = diffuseColor.rgb;
          vec3 trim = vTrim;
          // large-scale weathering
          float grime = fnoise(uv * vec2(0.35, 0.18) + seed * 37.0);
          float vgrad = smoothstep(-0.5, 3.0, uv.y);
          if (st == 5) {
            // roof: gravel / membrane
            float n = fnoise(uv * 2.5 + seed * 11.0) * 0.6 + fh12(floor(uv * 9.0)) * 0.4;
            fAlbedo = wall * (0.78 + 0.32 * n);
            fRough = 0.95;
          } else if (uv.y < -0.02 && st != 0) {
            // foundation below street level
            fAlbedo = wall * 0.5 * (0.85 + 0.2 * grime);
            fRough = 0.95;
          } else if (st == 0) {
            fAlbedo = wall * (0.92 + 0.12 * grime) * mix(0.72, 1.0, vgrad);
            fRough = 0.8;
          } else if (st == 10) {
            float s = fract(uv.x / sx);
            float aaS = fwidth(uv.x / sx) * 1.2;
            float m = smoothstep(0.5 - aaS, 0.5 + aaS, s);
            fAlbedo = mix(wall, trim, m) * (0.9 + 0.1 * grime);
            fRough = 0.7;
          } else if (st == 11) {
            fAlbedo = wall;
            fRough = 0.35;
            fEmis = wall * uNight * 2.2 + wall * 0.08;
          } else {
            vec2 cell = vec2(uv.x / sx, uv.y / fl);
            vec2 id = floor(cell);
            vec2 f = fract(cell);
            vec2 fw = fwidth(cell);
            float far = smoothstep(0.18, 0.55, max(fw.x, fw.y));
            vec2 aa = fw * 0.9 + 1e-4;
            float rnd = fh12(id + seed * 113.0);
            float rnd2 = fh12(id.yx * 1.7 + seed * 57.0);
            vec2 wlo = vec2(0.26, 0.22), whi = vec2(0.74, 0.84);
            bool store = false;
            bool noWin = false;
            float glassF0 = 0.18;
            if (st == 1) { wlo = vec2(0.24, 0.2); whi = vec2(0.76, 0.86); if (id.y < 0.5) noWin = true; }
            else if (st == 8) { noWin = true; }
            else if (st == 2) { wlo = vec2(0.12, 0.26); whi = vec2(0.88, 0.84); glassF0 = 0.3; }
            else if (st == 3) { wlo = vec2(0.035, 0.12); whi = vec2(0.965, 0.985); glassF0 = 0.6; }
            else if (st == 4) { wlo = vec2(0.18, 0.18); whi = vec2(0.82, 0.86); }
            else if (st == 6) { wlo = vec2(0.2, 0.24); whi = vec2(0.8, 0.8); }
            else if (st == 9) { wlo = vec2(0.22, 0.24); whi = vec2(0.78, 0.82); if (id.y < 0.5) noWin = true; }
            else { wlo = vec2(0.3, 0.22); whi = vec2(0.7, 0.82); }
            if (id.y < 0.5 && (st == 2 || st == 4 || st == 6 || st == 7)) {
              store = true;
              wlo = vec2(0.05, 0.04); whi = vec2(0.95, 0.8);
            }
            // wall surface detail
            vec3 w = wall;
            if (st == 1 || st == 8) {
              // clapboard siding
              float cl = fract(uv.y / 0.2);
              float sid = smoothstep(0.0, 0.12, cl) * 0.1;
              w *= mix(0.92 + sid, 0.97, far);
            } else if (st == 4) {
              // brick courses
              vec2 b = vec2(uv.x / 0.23 + floor(uv.y / 0.075) * 0.5, uv.y / 0.075);
              vec2 bf = fract(b);
              float mortar = 1.0 - boxMask(bf, vec2(0.06, 0.12), vec2(0.94, 0.88), fwidth(b));
              float bv = fh12(floor(b) + seed);
              vec3 brick = w * (0.82 + 0.3 * bv);
              w = mix(mix(brick, vec3(0.62, 0.6, 0.56), mortar * 0.8), w, far);
            } else if (st == 7 || st == 9) {
              w *= 0.95 + 0.08 * fnoise(uv * 1.3 + seed * 9.0);
            }
            w *= (0.9 + 0.14 * grime) * mix(0.75, 1.0, vgrad);
            // floor slab bands for offices
            if (st == 2 || st == 7) {
              float band = 1.0 - smoothstep(0.0, 0.06 + fw.y, f.y);
              w = mix(w, trim * 0.9, band * 0.6 * (1.0 - far));
            }
            if (noWin) {
              fAlbedo = w;
            } else {
              float win = boxMask(f, wlo, whi, aa);
              float frm = boxMask(f, wlo - vec2(0.045, 0.04), whi + vec2(0.045, 0.05), aa) - win;
              // sill under the window
              float sill = boxMask(f, vec2(wlo.x - 0.07, wlo.y - 0.07), vec2(whi.x + 0.07, wlo.y - 0.03), aa);
              // glass look: dark tinted panes, a few with curtains / half-drawn blinds
              vec3 gcol = mix(vec3(0.035, 0.05, 0.075), vec3(0.09, 0.12, 0.16), rnd);
              if (st == 3) gcol = mix(wall * 0.42, wall * 0.78, rnd * 0.6);
              float blinds = step(0.9, rnd2) * (st == 3 ? 0.0 : 1.0);
              float blindTop = mix(0.45, 0.9, fract(rnd * 7.3));
              float wy = (f.y - wlo.y) / max(whi.y - wlo.y, 0.01);
              float blindLine = blinds * step(blindTop, wy) * (0.7 + 0.3 * smoothstep(0.3, 0.5, fract(f.y * 16.0)));
              vec3 curtainCol = mix(vec3(0.82, 0.78, 0.68), vec3(0.72, 0.42, 0.36), fract(rnd * 3.7));
              float curtain = step(0.72, rnd2) * step(rnd2, 0.86) * (st == 3 ? 0.0 : 1.0);
              float wx = (f.x - wlo.x) / max(whi.x - wlo.x, 0.01);
              float curtainMask = curtain * (smoothstep(0.34, 0.3, wx) + smoothstep(0.66, 0.7, wx));
              vec3 glass = gcol;
              glass = mix(glass, curtainCol * 0.55, curtainMask * 0.85);
              glass = mix(glass, vec3(0.78, 0.76, 0.7) * 0.7, blindLine);
              // mullions dividing storefront glass into panes
              if (store) {
                float px = (f.x - wlo.x) / (whi.x - wlo.x) * 3.0;
                float d0 = min(fract(px), 1.0 - fract(px));
                float mul = 1.0 - smoothstep(0.035, 0.035 + fwidth(px) * 1.5, d0);
                glass = mix(glass, trim * 0.5, mul * win);
              }
              vec3 frameCol = trim;
              vec3 alb = mix(w, frameCol, clamp(frm, 0.0, 1.0));
              alb = mix(alb, trim * 0.85, sill * (st == 3 ? 0.0 : 1.0));
              alb = mix(alb, glass, win);
              // distance fade: average window coverage
              float cov = (whi.x - wlo.x) * (whi.y - wlo.y);
              vec3 avg = mix(w, glass, cov * 0.9);
              fAlbedo = mix(alb, avg, far);
              float gRough = 0.04 + rnd * 0.06 + (curtainMask + blindLine) * 0.6;
              float winF = mix(win, cov, far);
              fRough = mix(0.86, gRough, winF);
              fMetal = mix(0.0, mix(glassF0, 0.0, max(curtainMask, blindLine)), winF);
              // interior light at night (and a few during the day)
              float lit = step(rnd2 * 0.92 + rnd * 0.08, store ? 0.62 : (st == 3 ? 0.34 : 0.27));
              float hue = fract(rnd * 13.7 + rnd2 * 3.1);
              vec3 warm = hue < 0.55 ? vec3(1.0, 0.68, 0.36) : hue < 0.8 ? vec3(1.0, 0.85, 0.62) : hue < 0.93 ? vec3(0.7, 0.82, 1.0) : vec3(0.5, 0.6, 1.0);
              float bright = 0.55 + fract(rnd * 7.1) * 0.75;
              float flick = (0.88 + 0.12 * sin(uTime * 0.5 + rnd * 40.0)) * bright;
              fEmis = warm * lit * winF * uNight * (store ? 2.6 : 1.6) * flick;
            }
          }
        }
        diffuseColor.rgb = fAlbedo;
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = fRough;`
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = fMetal;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += fEmis;`
      );
  };
  mat.customProgramCacheKey = () => 'facade-v1';
  return mat;
}
