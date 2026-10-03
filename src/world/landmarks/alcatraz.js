// Alcatraz Island — origin at island centre, water level y = 0.
// Long axis along X (-X = north-west end with the water tower / power house,
// +X = south-east end with the lighthouse, parade ground and dock).
// The dock + Building 64 face +Z.

import {
  LandmarkBuilder, std, glow, boxMM, rboxMM, beam, cylY, latheGeo, planeGeo, V, M,
  noise3, fbm3, smoothstep, clamp01, lerp, canvasTexture, fitText, makeRng,
} from './common.js';
import * as THREE from 'three';

export const ALCATRAZ = Object.freeze({ width: 330, depth: 135, plateauY: 36 });

const PADS = [
  // [x0, x1, z0, z1, y, blend]
  [-52, 62, -20, 20, 36, 10], // cellhouse + admin + lighthouse terrace
  [-88, -50, -18, 18, 35, 8], // recreation yard
  [-112, -88, -6, 26, 31, 8], // water tower
  [-150, -122, -16, 6, 9, 10], // power house
  [72, 112, -38, -6, 22, 12], // parade ground
  [88, 146, 22, 48, 3, 9], // dock shelf / Building 64
];

function islandHeight(x, z) {
  const nx = x / 160, nz = z / 64;
  const ang = Math.atan2(nz, nx);
  const wob = fbm3(Math.cos(ang) * 1.7 + 4.1, Math.sin(ang) * 1.7 - 2.3, 0.5, 3) - 0.5;
  const d = Math.pow(Math.pow(Math.abs(nx), 2.4) + Math.pow(Math.abs(nz), 2.4), 1 / 2.4) / (1 + 0.2 * wob);
  const top = 36 - 13 * smoothstep(55, 150, Math.abs(x)) + 3 * (fbm3(x * 0.015, z * 0.015, 3.3, 3) - 0.5);
  let p;
  if (d < 0.74) p = 1;
  else if (d < 0.92) p = 1 - 0.14 * smoothstep(0.74, 0.92, d);
  else if (d < 1.0) p = 0.86 - 0.8 * smoothstep(0.92, 1.0, d);
  else p = 0.06 - 0.62 * smoothstep(1.0, 1.32, d);
  let h = p > 0 ? top * p : p * 25;
  // rugged rock, strongest on the cliffs (ridged noise gives ledges and gullies)
  const cliff = smoothstep(0.84, 0.96, d) * (1 - smoothstep(1.03, 1.12, d));
  const r = 1 - Math.abs(2 * fbm3(x * 0.06, z * 0.06, 1.7, 4) - 1);
  h += (fbm3(x * 0.09, z * 0.09, 5.1, 3) - 0.5) * 2.2 + cliff * (r - 0.45) * 10;
  for (const [x0, x1, z0, z1, y, blend] of PADS) {
    const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
    const w = 1 - smoothstep(0, blend, Math.hypot(dx, dz));
    if (w > 0) h = lerp(h, y, w);
  }
  return h;
}

export function createAlcatraz() {
  const B = new LandmarkBuilder('Alcatraz');
  const rand = makeRng(1934);

  // ---------------------------------------------------------------- textures
  const signTex = canvasTexture('alcatraz-sign', 1024, 256, (ctx, w, h) => {
    ctx.fillStyle = '#efeadf';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1d1d1d';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'UNITED STATES PENITENTIARY', w / 2, h * 0.3, w * 0.92, 92, 'bold', 'Georgia, serif');
    ctx.fillStyle = '#b3241c';
    ctx.save();
    ctx.translate(w / 2, h * 0.72);
    ctx.rotate(-0.03);
    fitText(ctx, 'INDIANS WELCOME', 0, 0, w * 0.7, 96, 'bold', 'Impact, Arial Black, sans-serif');
    ctx.restore();
  });
  const tankTex = canvasTexture('alcatraz-tank', 1024, 256, (ctx, w, h) => {
    ctx.fillStyle = '#d9d4c8';
    ctx.fillRect(0, 0, w, h);
    const r = makeRng(77);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(120,70,40,${0.05 + r() * 0.12})`;
      const x = r() * w;
      ctx.fillRect(x, 0, 2 + r() * 6, h * (0.3 + r() * 0.7));
    }
    ctx.fillStyle = '#b8261d';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'PEACE AND FREEDOM', w * 0.25, h * 0.36, w * 0.45, 60, 'bold', 'Impact, Arial Black, sans-serif');
    fitText(ctx, 'WELCOME', w * 0.25, h * 0.66, w * 0.45, 64, 'bold', 'Impact, Arial Black, sans-serif');
    fitText(ctx, 'HOME OF THE FREE', w * 0.75, h * 0.36, w * 0.45, 60, 'bold', 'Impact, Arial Black, sans-serif');
    fitText(ctx, 'INDIAN LAND', w * 0.75, h * 0.66, w * 0.45, 64, 'bold', 'Impact, Arial Black, sans-serif');
  });
  const beamTex = canvasTexture('alcatraz-beam', 8, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, '#9a9077');
    g.addColorStop(1, '#000000');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });

  // ---------------------------------------------------------------- materials
  const terrainMat = std({ name: 'alc-terrain', color: 0xffffff, vertexColors: true, roughness: 0.95, flatShading: false });
  const bldgMat = std({ name: 'alc-buildings', color: 0xffffff, vertexColors: true, roughness: 0.88 });
  const darkMat = std({ name: 'alc-dark', color: 0xffffff, vertexColors: true, roughness: 0.75, metalness: 0.2 });
  const winMat = glow({ name: 'alc-windows', color: 0x2a3038, emissive: 0xffc982, roughness: 0.3, metalness: 0.4 }, 0.9);
  const lanternMat = glow({ name: 'alc-lantern', color: 0xbfc8c8, emissive: 0xfff1c8, roughness: 0.15, metalness: 0.2 }, 5);
  const signMat = std({ name: 'alc-sign', color: signTex ? 0xffffff : 0xe6e0d2, map: signTex, roughness: 0.8 });
  const tankMat = std({ name: 'alc-tank', color: tankTex ? 0xffffff : 0xd6d0c2, map: tankTex, roughness: 0.7, metalness: 0.2 });
  const beamMat = glow({
    name: 'alc-beam', color: 0x000000, emissive: 0xfff0c0, emissiveMap: beamTex, roughness: 1, metalness: 0,
    transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    fog: false, specularIntensity: 0, envMapIntensity: 0,
  }, 1.4, true);

  const terrain = B.part('terrain', terrainMat);
  const bldg = B.part('buildings', bldgMat);
  const dark = B.part('dark', darkMat);
  const wins = B.part('windows', winMat, { castShadow: false });
  const lantern = B.part('lantern', lanternMat, { castShadow: false });
  const sign = B.part('sign', signMat, { castShadow: false });
  const tank = B.part('tank', tankMat);

  // ---------------------------------------------------------------- terrain
  {
    const X0 = -184, X1 = 184, Z0 = -90, Z1 = 90, NX = 140, NZ = 68;
    const g = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, NX, NZ);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, islandHeight(pos.getX(i), pos.getZ(i)));
    g.computeVertexNormals();
    const cWet = new THREE.Color(0x3d3a35), cRock = new THREE.Color(0x8d806c), cRock2 = new THREE.Color(0x6f6658);
    const cGreen = new THREE.Color(0x56702f), cDry = new THREE.Color(0x9b8c56), cPave = new THREE.Color(0xa29c90);
    const cSea = new THREE.Color(0x2b3a34);
    const tmp = new THREE.Color();
    terrain.add(g, null, (x, y, z, nx, ny, nz, out) => {
      const slope = 1 - ny;
      const n = fbm3(x * 0.05, y * 0.05, z * 0.05, 3);
      if (y < -0.8) out.copy(cSea);
      else if (y < 1.6) out.copy(cWet).lerp(cRock2, clamp01((y + 0.8) / 2.4));
      else if (slope > 0.32) out.copy(cRock).lerp(cRock2, n);
      else {
        out.copy(cGreen).lerp(cDry, smoothstep(0.35, 0.7, n));
        tmp.copy(cRock).lerp(cRock2, n);
        out.lerp(tmp, smoothstep(0.18, 0.32, slope));
      }
      // paved terraces around the buildings
      let paved = 0;
      for (const [x0, x1, z0, z1, py] of PADS) {
        if (x > x0 - 1 && x < x1 + 1 && z > z0 - 1 && z < z1 + 1 && Math.abs(y - py) < 1.2) paved = 1;
      }
      if (paved) out.lerp(cPave, 0.8);
      out.multiplyScalar(0.92 + 0.16 * noise3(x * 0.3, y * 0.3, z * 0.3));
    });
    // scrub bushes
    for (let i = 0; i < 70; i++) {
      const x = -150 + rand() * 300, z = -60 + rand() * 120;
      const y = islandHeight(x, z);
      if (y < 4) continue;
      let onPad = false;
      for (const [x0, x1, z0, z1] of PADS) if (x > x0 - 3 && x < x1 + 3 && z > z0 - 3 && z < z1 + 3) onPad = true;
      if (onPad) continue;
      const r = 1.5 + rand() * 2.5;
      const bush = new THREE.IcosahedronGeometry(r, 0);
      terrain.add(bush, M(x, y + r * 0.25, z, rand(), rand(), rand(), 1.3, 0.6, 1.1), new THREE.Color(rand() < 0.5 ? 0x4c6a2c : 0x627a35));
    }
  }

  // ---------------------------------------------------------------- cellhouse
  const Y0 = 36;
  const white = (hex) => (x, y, z, nx, ny, nz, out) => {
    out.set(hex);
    const streak = noise3(x * 0.8, y * 0.05, z * 0.8);
    const dirt = 1 - 0.18 * (1 - smoothstep(Y0, Y0 + 5, y)) - 0.1 * streak;
    out.multiplyScalar(dirt);
  };
  bldg.add(rboxMM(-45, Y0 - 1.5, -14, 45, Y0 + 14, 14, 0.3, 1), null, white(0xe6e2d6));
  bldg.add(boxMM(-45.4, Y0 + 13.2, -14.4, 45.4, Y0 + 14.4, 14.4), null, white(0xd8d3c6)); // parapet band
  dark.add(boxMM(-44.6, Y0 + 14.0, -13.6, 44.6, Y0 + 14.3, 13.6), null, 0x4a4844); // tar roof
  bldg.add(boxMM(-40, Y0 + 14.3, -5, 40, Y0 + 16.2, 5), null, white(0xdcd7ca)); // monitor roof
  dark.add(boxMM(-40.3, Y0 + 16.2, -5.3, 40.3, Y0 + 16.5, 5.3), null, 0x55524c);
  // admin wing at the south-east end
  bldg.add(rboxMM(45, Y0 - 1.5, -12, 58, Y0 + 11, 12, 0.3, 1), null, white(0xe2ddcf));
  dark.add(boxMM(45.2, Y0 + 11, -11.8, 57.8, Y0 + 11.3, 11.8), null, 0x4a4844);
  // windows: tall barred windows along both long faces + ends
  for (let i = 0; i < 18; i++) {
    const x = -40 + i * (80 / 17);
    for (const s of [-1, 1]) {
      const z0 = s * 14, z1 = s * 14.08;
      wins.add(boxMM(x - 1.1, Y0 + 3.5, Math.min(z0, z1), x + 1.1, Y0 + 11.5, Math.max(z0, z1)));
    }
  }
  for (let i = 0; i < 8; i++) {
    const x = -38 + i * (76 / 7);
    for (const s of [-1, 1]) {
      const z0 = s * 5, z1 = s * 5.06;
      wins.add(boxMM(x - 3.5, Y0 + 14.7, Math.min(z0, z1), x + 3.5, Y0 + 15.8, Math.max(z0, z1)));
    }
  }
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const z = -8 + k * 8;
      const xf = s > 0 ? 58 : -45;
      wins.add(boxMM(xf - 0.04, Y0 + 3, z - 1.2, xf + 0.04, Y0 + 9, z + 1.2));
    }
    for (let k = 0; k < 4; k++) {
      const x = 47.5 + k * 2.9;
      const z0 = s * 12, z1 = s * 12.07;
      wins.add(boxMM(x - 0.8, Y0 + 2, Math.min(z0, z1), x + 0.8, Y0 + 4.2, Math.max(z0, z1)));
      wins.add(boxMM(x - 0.8, Y0 + 6, Math.min(z0, z1), x + 0.8, Y0 + 8.2, Math.max(z0, z1)));
    }
  }
  // recreation yard walls
  {
    const [x0, x1, z0, z1] = [-84, -45, -15, 15];
    const wc = white(0xcfc9bb);
    bldg.add(boxMM(x0, Y0 - 2, z0, x1, Y0 + 6, z0 + 1), null, wc);
    bldg.add(boxMM(x0, Y0 - 2, z1 - 1, x1, Y0 + 6, z1), null, wc);
    bldg.add(boxMM(x0, Y0 - 2, z0, x0 + 1, Y0 + 6, z1), null, wc);
    // guard tower on the yard wall
    bldg.add(boxMM(x0 - 1, Y0 - 2, z1 - 3, x0 + 3, Y0 + 9, z1 + 1), null, wc);
    wins.add(boxMM(x0 - 1.1, Y0 + 7, z1 - 2.6, x0 + 3.1, Y0 + 8.4, z1 + 1.1));
    dark.add(boxMM(x0 - 1.6, Y0 + 9, z1 - 3.6, x0 + 3.6, Y0 + 9.5, z1 + 1.6), null, 0x3e3c39);
  }
  B.collider(6.5, 0, 52, 15, 52);

  // ---------------------------------------------------------------- lighthouse
  const LX = 62, LZ = -16, LY = Y0;
  {
    bldg.add(latheGeo([[3.0, LY - 1.5], [3.0, LY + 1.2], [2.55, LY + 1.6], [1.95, LY + 22], [2.9, LY + 22.2], [2.9, LY + 23]], 8, 30), [LX, 0, LZ, 0, Math.PI / 8, 0], white(0xf2efe6));
    dark.add(cylY(2.95, 2.95, LY + 23, LY + 23.35, 16, false, LX, LZ), null, 0x2b2b2b);
    // gallery railing
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      dark.add(cylY(0.05, 0.05, LY + 23.3, LY + 24.4, 4, true, LX + 2.8 * Math.cos(a), LZ + 2.8 * Math.sin(a)), null, 0x222222);
    }
    dark.add(latheGeo([[2.85, LY + 24.3], [2.85, LY + 24.45], [2.75, LY + 24.45], [2.75, LY + 24.3]], 16, 30), [LX, 0, LZ], 0x222222);
    lantern.add(cylY(1.55, 1.55, LY + 23.35, LY + 26.6, 10, true, LX, LZ));
    dark.add(cylY(1.7, 1.7, LY + 23.3, LY + 23.8, 10, false, LX, LZ), null, 0x262626);
    dark.add(latheGeo([[1.75, LY + 26.55], [1.75, LY + 26.8], [0.5, LY + 27.9], [0.18, LY + 28.6], [0, LY + 28.8]], 12, 35), [LX, 0, LZ], 0x1f1f1f);
    B.collider(LX, LZ, 3, 3, 28.8);
    // warden's house ruins next to it
    const ruin = white(0xbdb4a2);
    bldg.add(boxMM(LX - 22, LY - 1, LZ - 5, LX - 6, LY + 7, LZ - 4.2), null, ruin);
    bldg.add(boxMM(LX - 22, LY - 1, LZ + 3.2, LX - 6, LY + 6, LZ + 4), null, ruin);
    bldg.add(boxMM(LX - 22, LY - 1, LZ - 5, LX - 21.2, LY + 7.5, LZ + 4), null, ruin);
    bldg.add(boxMM(LX - 6.8, LY - 1, LZ - 5, LX - 6, LY + 5.5, LZ + 4), null, ruin);
    for (let k = 0; k < 4; k++) {
      const x = LX - 19.5 + k * 3.6;
      dark.add(boxMM(x - 0.7, LY + 2.5, LZ - 5.06, x + 0.7, LY + 5, LZ - 4.98), null, 0x1c1b1a);
    }
  }

  // ---------------------------------------------------------------- water tower
  {
    const TX = -100, TZ = 10, TY = 31;
    const legR = 4.2, H = 19;
    const rust = 0x7b5a45;
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const ax = TX + legR * 1.25 * Math.cos(a), az = TZ + legR * 1.25 * Math.sin(a);
      const bx = TX + legR * 0.8 * Math.cos(a), bz = TZ + legR * 0.8 * Math.sin(a);
      dark.add(beam(V(ax, TY, az), V(bx, TY + H, bz), 0.45, 0.45), null, rust);
      const a2 = a + Math.PI / 2;
      const cx = TX + legR * 1.25 * Math.cos(a2), cz = TZ + legR * 1.25 * Math.sin(a2);
      const dx = TX + legR * 0.8 * Math.cos(a2), dz = TZ + legR * 0.8 * Math.sin(a2);
      for (const f of [0.25, 0.62]) {
        const p = V(lerp(ax, bx, f), TY + H * f, lerp(az, bz, f));
        const q = V(lerp(cx, dx, f), TY + H * f, lerp(cz, dz, f));
        dark.add(beam(p, q, 0.2, 0.2), null, rust);
        const p2 = V(lerp(ax, bx, f + 0.3), TY + H * (f + 0.3), lerp(az, bz, f + 0.3));
        dark.add(beam(p, V(lerp(cx, dx, f + 0.3), TY + H * (f + 0.3), lerp(cz, dz, f + 0.3)), 0.12, 0.12), null, rust);
        dark.add(beam(q, p2, 0.12, 0.12), null, rust);
      }
    }
    dark.add(cylY(4.9, 4.9, TY + H - 0.5, TY + H, 16, false, TX, TZ), null, 0x5a4b40);
    tank.add(cylY(4.6, 4.6, TY + H, TY + H + 8, 24, true, TX, TZ));
    dark.add(latheGeo([[4.75, TY + H + 7.9], [4.75, TY + H + 8.2], [0.4, TY + H + 10.6], [0, TY + H + 10.8]], 24, 30), [TX, 0, TZ], 0x8a8278);
    B.collider(TX, TZ, 5.5, 5.5, TY + H + 11);
  }

  // ---------------------------------------------------------------- power house + smokestack
  {
    const PX = -136, PZ = -5, PY = 9;
    bldg.add(rboxMM(PX - 10, PY - 2, PZ - 6, PX + 8, PY + 10, PZ + 6, 0.3), null, white(0xcbbfa8));
    dark.add(boxMM(PX - 10.2, PY + 10, PZ - 6.2, PX + 8.2, PY + 10.4, PZ + 6.2), null, 0x45423d);
    for (let k = 0; k < 4; k++) wins.add(boxMM(PX - 8 + k * 4, PY + 3, PZ + 6, PX - 6 + k * 4, PY + 7.5, PZ + 6.07));
    bldg.add(latheGeo([[2.4, PY - 1], [2.4, PY + 2], [1.9, PY + 3], [1.5, PY + 30], [1.75, PY + 30.3], [1.75, PY + 31], [1.2, PY + 31]], 14, 30), [PX + 4, 0, PZ + 2], white(0xb9ab94));
    B.collider(PX - 1, PZ, 9.5, 6.5, 41);
  }

  // ---------------------------------------------------------------- Building 64 + dock
  {
    const y0 = 3;
    const ochre = (x, y, z, nx, ny, nz, out) => {
      out.set(0xcdb68a);
      out.multiplyScalar(0.86 + 0.18 * noise3(x * 0.2, y * 0.3, z * 0.2) - 0.12 * (1 - smoothstep(y0, y0 + 3, y)));
    };
    bldg.add(rboxMM(92, y0 - 1, 25, 140, y0 + 14, 39, 0.3), null, ochre);
    bldg.add(boxMM(91.6, y0 + 13.4, 24.6, 140.4, y0 + 14.6, 39.4), null, white(0xbfae88));
    dark.add(boxMM(92.2, y0 + 14.4, 25.2, 139.8, y0 + 14.7, 38.8), null, 0x4a4641);
    for (let f = 0; f < 4; f++) {
      for (let i = 0; i < 14; i++) {
        const x = 95 + i * 3.25;
        if (f === 0 && i >= 5 && i <= 8) continue; // sign goes here
        wins.add(boxMM(x - 0.7, y0 + 1 + f * 3.3, 39, x + 0.7, y0 + 3.2 + f * 3.3, 39.07));
      }
    }
    sign.add(planeGeo(16, 4), [116, y0 + 2.2, 39.08]);
    // dock pier
    bldg.add(boxMM(98, 1.2, 39, 136, 2.6, 60), null, (x, y, z, nx, ny, nz, out) => {
      out.set(0x8c7a62);
      out.multiplyScalar(0.85 + 0.25 * noise3(x * 0.5, y, z * 2));
    });
    for (let x = 100; x <= 134; x += 4) {
      for (const z of [45, 52, 59]) dark.add(cylY(0.35, 0.35, -3, 1.3, 6, true, x, z), null, 0x3b3128);
    }
    // small dock house
    bldg.add(rboxMM(124, 2.6, 46, 133, 6.6, 54, 0.2), null, white(0xe0dbce));
    dark.add(boxMM(123.6, 6.6, 45.6, 133.4, 7.0, 54.4), null, 0x5b2c22);
    B.collider(116, 32, 24, 7, 18);
    B.collider(117, 49.5, 19, 10.5, 2.6);
  }

  // ---------------------------------------------------------------- island colliders
  B.collider(0, 0, 150, 46, 40);
  B.collider(0, 0, 110, 60, 40);

  // ---------------------------------------------------------------- lighthouse beam (optional, night only)
  const beamPivot = new THREE.Group();
  beamPivot.name = 'Alcatraz.beamPivot';
  beamPivot.position.set(LX, LY + 25, LZ);
  {
    const cone = new THREE.CylinderGeometry(0.5, 7, 110, 16, 1, true);
    cone.translate(0, -55, 0); // narrow end at origin, wide end at -Y
    const g = cone.clone();
    g.rotateZ(Math.PI / 2); // points +X
    const g2 = cone.clone();
    g2.rotateZ(-Math.PI / 2); // points -X
    const merged = new THREE.BufferGeometry();
    const parts = [g, g2].map((p) => p.toNonIndexed());
    const n0 = parts[0].attributes.position.count, n1 = parts[1].attributes.position.count;
    for (const name of ['position', 'normal', 'uv']) {
      const size = parts[0].attributes[name].itemSize;
      const arr = new Float32Array((n0 + n1) * size);
      arr.set(parts[0].attributes[name].array, 0);
      arr.set(parts[1].attributes[name].array, n0 * size);
      merged.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    merged.computeBoundingSphere();
    const beamMesh = new THREE.Mesh(merged, beamMat);
    beamMesh.name = 'Alcatraz.beam';
    beamMesh.castShadow = false;
    beamMesh.receiveShadow = false;
    beamMesh.renderOrder = 10;
    beamPivot.add(beamMesh);
  }
  B.addObject(beamPivot);

  return B.finish({ beam: beamPivot });
}

/** Optional: sweep the lighthouse beam. Call per frame with seconds. */
export function animateAlcatraz(group, time) {
  const pivot = group.userData.beam;
  if (pivot) pivot.rotation.y = time * 0.55;
}
