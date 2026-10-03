// Far terrain around the bay: SF peninsula beyond the playable grid, the Presidio, Marin
// Headlands, Angel Island, Yerba Buena/Treasure Island and the East Bay hills.
import * as THREE from 'three';
import { fbm2, smoothstep, clamp, mulberry32 } from '../core/math.js';
import { FacadeBuilder } from './FacadeBuilder.js';
import { FACADE } from './BuildingMaterial.js';

const gauss = (x, z, cx, cz, s) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * s * s));

// Signed "land-ness" and height. Returns height in meters (negative = under water).
export function farHeight(x, z) {
  // carve out the detailed city (+ outer ring) so it never pokes through
  if (x > -660 && x < 520 && z > -520 && z < 660) return -25;
  const n = fbm2(x * 0.0012, z * 0.0012, 4, 5);
  const n2 = fbm2(x * 0.004, z * 0.004, 3, 9);
  let h = -12;
  // --- SF peninsula: south & west of the city
  const shoreN = -560 - 90 * Math.sin(x * 0.0021) - 60 * n + (x < -1500 && x > -2400 ? -90 : 0);
  // next to the playable city the shoreline is the seawall itself (north and east)
  const nearCityN = x > -720 && x < 560 && z < -500;
  const nearCityE = x > 500 && z < 580;
  const sfLand = !nearCityN && !nearCityE && (x < 900 || z > 1200) && z > shoreN && x > -3600;
  if (sfLand) {
    let e = smoothstep(shoreN, shoreN + 140, z) * smoothstep(-3600, -3400, x);
    if (x > 520) e *= smoothstep(1500, 520, x - (z - 600) * 0.2) ;
    h = 3 + e * (8 + n * 30);
    h += 260 * gauss(x, z, -1100, 1500, 420); // Twin Peaks
    h += 90 * gauss(x, z, -1700, -250, 380); // Presidio
    h += 110 * gauss(x, z, -400, 1500, 380); // Bernal / Potrero rise
    h += 60 * gauss(x, z, 400, 1250, 260);
    h = h * e + (1 - e) * -4;
  }
  // --- Marin Headlands (north across the Golden Gate)
  const marinShore = -1760 + 120 * Math.sin(x * 0.0019) + 80 * n;
  if (z < marinShore && x < 1600 && x > -5200) {
    const e = smoothstep(marinShore, marinShore - 220, z) * smoothstep(1600, 1000, x);
    const m = 40 + 300 * n + 180 * n2 * n + 260 * gauss(x, z, -2600, -2600, 900);
    h = Math.max(h, -6 + e * m);
  }
  // --- Angel Island
  h = Math.max(h, -20 + 260 * gauss(x, z, -150, -2750, 330) * (0.8 + 0.3 * n2));
  // --- Yerba Buena + Treasure Island
  h = Math.max(h, -20 + 130 * gauss(x, z, 2500, 760, 190));
  if (x > 2250 && x < 2950 && z > -380 && z < 380) h = Math.max(h, 4);
  // --- East Bay (Oakland / Berkeley hills)
  if (x > 4300) {
    const e = smoothstep(4300, 4700, x + 200 * n);
    h = Math.max(h, -8 + e * (6 + smoothstep(5600, 7500, x) * (320 + 160 * n)));
  }
  return h;
}

function landColor(h, x, z, slope, out) {
  const n = fbm2(x * 0.01, z * 0.01, 2, 3);
  const n2 = fbm2(x * 0.003 + 7, z * 0.003, 3, 8);
  const urbanSF = x < 900 && z > -700 && x > -3400 && h < 140;
  const urbanEB = x > 4500 && h < 70;
  if (h < 2.5) out.setRGB(0.78, 0.72, 0.6, THREE.SRGBColorSpace); // beach
  else if (urbanSF || urbanEB) {
    const v = 0.42 + n * 0.22;
    out.setRGB(v * 0.95 + 0.15, v * 0.9 + 0.15, v * 0.86 + 0.15, THREE.SRGBColorSpace);
  } else if (x > -2300 && x < -1300 && z > -760 && z < 300) {
    out.setRGB(0.2 + n * 0.08, 0.38 + n * 0.12, 0.2, THREE.SRGBColorSpace); // Presidio forest
  } else {
    // golden California hills, chaparral green in the folds
    const patch = fbm2(x * 0.018 + 3, z * 0.018 - 5, 3, 21);
    const g = Math.min(1, Math.max(0, slope * 2.4 + (n2 - 0.45) * 1.4 + (patch - 0.5) * 1.6));
    const gold = [0.8 + n * 0.08, 0.64 + n * 0.08, 0.36];
    const green = [0.36, 0.5 + n * 0.1, 0.26];
    out.setRGB(gold[0] + (green[0] - gold[0]) * g, gold[1] + (green[1] - gold[1]) * g, gold[2] + (green[2] - gold[2]) * g, THREE.SRGBColorSpace);
  }
  return out;
}

export function buildFarTerrain() {
  const size = 14000, seg = 360;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  geo.translate(800, 0, 0);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), z = pos.getZ(k);
    const h = farHeight(x, z);
    pos.setY(k, h);
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), z = pos.getZ(k), h = pos.getY(k);
    const slope = 1 - nrm.getY(k);
    landColor(h, x, z, slope, c);
    colors[k * 3] = c.r; colors[k * 3 + 1] = c.g; colors[k * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  mesh.name = 'far-terrain';
  return mesh;
}

// Sprawl of low-detail buildings to suggest the rest of SF and Oakland.
export function buildSprawl() {
  const fb = new FacadeBuilder();
  const rng = mulberry32(99);
  const cols = ['#d8cbb6', '#c9bba6', '#e0d0bd', '#bfb7aa', '#d3c4c9', '#c4cfd6', '#e2c9b4', '#b8b0a2', '#cfc1a2', '#a9b4a6', '#d6b8a8'];
  const toC = (hex) => { const cc = new THREE.Color(hex); return [cc.r, cc.g, cc.b]; };
  const roof = toC('#5d5b58');
  const place = (x0, x1, z0, z1, step, hMin, hMax, density, style) => {
    for (let x = x0; x < x1; x += step)
      for (let z = z0; z < z1; z += step) {
        if (rng() > density) continue;
        const px = x + (rng() - 0.5) * step * 0.4, pz = z + (rng() - 0.5) * step * 0.4;
        const g = farHeight(px, pz);
        if (g < 3) continue;
        const w = step * (0.45 + rng() * 0.35), d = step * (0.45 + rng() * 0.35);
        const h = hMin + (hMax - hMin) * Math.pow(rng(), 2.2);
        fb.setTransform(px, pz, 0);
        fb.vOrigin = g;
        fb.set({ wall: toC(cols[Math.floor(rng() * cols.length)]), trim: toC('#ffffff'), style, spacing: 3, floorH: 3.4, seed: rng() });
        fb.box(-w / 2, g - 4, -d / 2, w / 2, g + h, d / 2, { roof: { wall: roof, style: FACADE.ROOF } });
      }
  };
  // SF west & south of the outer ring
  place(-1700, -660, -560, 1400, 34, 6, 18, 0.75, FACADE.STUCCO);
  place(-660, 900, 660, 1700, 34, 6, 24, 0.75, FACADE.STUCCO);
  // SoMa / Mission Bay a bit taller
  place(520, 900, 560, 1100, 40, 12, 60, 0.6, FACADE.OFFICE);
  // Oakland
  place(4500, 6200, -1600, 1600, 70, 8, 30, 0.45, FACADE.OFFICE);
  place(4700, 5200, -200, 400, 60, 30, 120, 0.6, FACADE.CURTAIN);
  const g = fb.build();
  const mesh = new THREE.Mesh(g, null);
  mesh.name = 'sprawl';
  return mesh;
}
