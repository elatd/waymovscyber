// Salesforce Tower — rounded-square plan (50 m, big corner radius), slight taper,
// reflective glass with vertical white fins; the top 30 m is an open white
// lattice crown around an LED core (glows at night). Front (lobby canopy) +Z.

import {
  LandmarkBuilder, std, phys, glow, boxMM, rboxMM, beam, loftGeo, roundedRectPts, V,
  noise3, canvasTexture, makeRng, HAS_DOM, cylY,
} from './common.js';
import * as THREE from 'three';

export const SALESFORCE = Object.freeze({ footprint: 52, height: 230, crownBase: 200 });

const HALF = 25, RAD = 11, CORNER_SEGS = 7;
const GLASS_TOP = 200, TOP = 230;

/** Plan scale factor at height y (gentle taper, rounding in at the crown). */
function scaleAt(y) {
  if (y <= GLASS_TOP) return 1 - 0.085 * Math.pow(Math.max(0, y) / GLASS_TOP, 1.4);
  const t = (y - GLASS_TOP) / (TOP - GLASS_TOP);
  return 0.915 - 0.1 * Math.pow(t, 1.8);
}

const BASE_RING = roundedRectPts(HALF, HALF, RAD, CORNER_SEGS);

function ringAt(y, inset = 0) {
  const s = scaleAt(y);
  return BASE_RING.map(([x, z]) => {
    const l = Math.hypot(x, z) || 1;
    return V(x * s - (x / l) * inset, y, z * s - (z / l) * inset);
  });
}

/** Point + outward normal on the plan perimeter at fraction f (arc-length). */
function perimeterSampler() {
  const pts = BASE_RING;
  const n = pts.length;
  const cum = [0];
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    cum.push(cum[i] + Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  const total = cum[n];
  return {
    total,
    at(f) {
      const d = (((f % 1) + 1) % 1) * total;
      let i = 0;
      while (i < n - 1 && cum[i + 1] < d) i++;
      const p = pts[i], q = pts[(i + 1) % n];
      const t = (d - cum[i]) / (cum[i + 1] - cum[i] || 1);
      const x = p[0] + (q[0] - p[0]) * t, z = p[1] + (q[1] - p[1]) * t;
      const tx = q[0] - p[0], tz = q[1] - p[1];
      const tl = Math.hypot(tx, tz) || 1;
      return { x, z, nx: tz / tl, nz: -tx / tl };
    },
  };
}

export function createSalesforceTower() {
  const B = new LandmarkBuilder('SalesforceTower');
  const FLOOR = 4.2;

  // glass: floor spandrel bands + subtle vertical variation; night: lit offices
  const glassTex = canvasTexture('salesforce-glass', 256, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#b4c6d6');
    g.addColorStop(0.5, '#c9d6e2');
    g.addColorStop(1, '#adc0d1');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let r = 0; r < 4; r++) {
      ctx.fillStyle = '#e8edf1';
      ctx.fillRect(0, r * 64, w, 9);
      ctx.fillStyle = 'rgba(40,60,80,0.18)';
      ctx.fillRect(0, r * 64 + 9, w, 3);
    }
  }, { repeat: true });
  const glassNight = canvasTexture('salesforce-glass-night', 256, 256, (ctx, w, h) => {
    const rnd = makeRng(2018);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 16; c++) {
        if (rnd() > 0.58) continue;
        ctx.fillStyle = rnd() < 0.3 ? '#cfe0ff' : '#ffe2b8';
        ctx.globalAlpha = 0.45 + rnd() * 0.55;
        ctx.fillRect(c * 16, r * 64 + 14, 16, 46);
      }
    }
    ctx.globalAlpha = 1;
  }, { repeat: true });
  const ledTex = canvasTexture('salesforce-led', 256, 64, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#9fd8ff');
    g.addColorStop(0.3, '#ffffff');
    g.addColorStop(0.55, '#ffd9f2');
    g.addColorStop(0.8, '#c8f0ff');
    g.addColorStop(1, '#9fd8ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = 0; x < w; x += 4) ctx.fillRect(x, 0, 1, h);
  }, { repeat: true });

  const glassMat = glow({
    name: 'sf-glass', color: glassTex ? 0xffffff : 0xb3c4d3, map: glassTex, emissive: 0xffffff, emissiveMap: glassNight,
    roughness: 0.07, metalness: 0.72, envMapIntensity: 1.25, clearcoat: 0.4, clearcoatRoughness: 0.08,
  }, 0.95, true);
  const finMat = std({ name: 'sf-fins', color: 0xf3f3ef, roughness: 0.32, metalness: 0.35 });
  const ledMat = glow({ name: 'sf-led-crown', color: 0x3a3f46, emissive: 0xffffff, emissiveMap: ledTex, roughness: 0.5, metalness: 0.2 }, 1.8);
  const stoneMat = std({ name: 'sf-stone', color: 0xffffff, vertexColors: true, roughness: 0.75 });
  const glass = B.part('glass', glassMat);
  const fins = B.part('fins', finMat);
  const led = B.part('ledCrown', ledMat, { castShadow: false });
  const stone = B.part('stone', stoneMat);

  // ---------------------------------------------------------------- glass body
  const rings = [];
  for (const y of [0, 25, 50, 75, 100, 125, 150, 175, GLASS_TOP]) rings.push(ringAt(y, 0.35));
  const per = perimeterSampler();
  glass.add(loftGeo(rings, { uRepeat: 4, vScale: FLOOR * 4 }));

  // ---------------------------------------------------------------- vertical fins
  const NF = 104;
  const finYs = [0, 40, 80, 120, 160, GLASS_TOP, 210, 220, TOP];
  for (let i = 0; i < NF; i++) {
    const p = per.at(i / NF);
    for (let k = 0; k < finYs.length - 1; k++) {
      const y0 = finYs[k], y1 = finYs[k + 1];
      const s0 = scaleAt(y0), s1 = scaleAt(y1);
      const out = 0.2;
      const a = V(p.x * s0 + p.nx * out, y0, p.z * s0 + p.nz * out);
      const b = V(p.x * s1 + p.nx * out, y1, p.z * s1 + p.nz * out);
      fins.add(beam(a, b, 0.2, 0.36, V(p.nx, 0, p.nz)));
    }
  }

  // ---------------------------------------------------------------- crown lattice (open screen)
  const bandYs = [];
  for (let y = GLASS_TOP; y <= TOP + 0.01; y += 3.75) bandYs.push(y);
  for (const y of bandYs) {
    const ring = ringAt(y, -0.2);
    const thick = y === TOP || y === GLASS_TOP ? 1.1 : 0.42;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dir = b.clone().sub(a).normalize().multiplyScalar(0.12);
      fins.add(beam(a.clone().sub(dir), b.clone().add(dir), 0.7, thick, V(0, 1, 0)));
    }
  }
  // top rim (inner face so the open crown reads from above)
  {
    const outer = ringAt(TOP, -0.6), inner = ringAt(TOP, 1.6);
    const n = outer.length;
    const pos = [], idx = [];
    for (let i = 0; i < n; i++) {
      pos.push(outer[i].x, TOP + 0.56, outer[i].z, inner[i].x, TOP + 0.56, inner[i].z);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const o0 = i * 2, i0 = i * 2 + 1, o1 = j * 2, i1 = j * 2 + 1;
      idx.push(o0, o1, i0, i0, o1, i1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // make sure it faces up
    if (g.attributes.normal.getY(0) < 0) {
      const ia = g.index.array;
      for (let k = 0; k < ia.length; k += 3) [ia[k + 1], ia[k + 2]] = [ia[k + 2], ia[k + 1]];
      g.computeVertexNormals();
    }
    fins.add(g);
  }

  // LED core inside the crown + mechanical roof
  const coreRings = [];
  for (const y of [GLASS_TOP, 212, 224]) coreRings.push(ringAt(y, 4.2));
  led.add(loftGeo(coreRings, { capEnd: true, uRepeat: 6, vScale: 24 }));
  stone.add(loftGeo([ringAt(GLASS_TOP - 0.2, 0.2), ringAt(GLASS_TOP + 0.6, 0.2)], { capEnd: true }), null, 0x8d939a);
  stone.add(rboxMM(-8, 224, -8, 8, 226.5, 8, 0.3), null, 0x6e737a);
  stone.add(cylY(0.25, 0.25, 226.5, 234, 6, false, 3, -2), null, 0x9aa0a6);

  // ---------------------------------------------------------------- base: plinth + entrance canopy
  stone.add(loftGeo([ringAt(-0.5, -0.9), ringAt(1.2, -0.9)], { capEnd: true }), null, (x, y, z, nx, ny, nz, o) => {
    o.set(0xb7b1a6);
    o.multiplyScalar(0.92 + 0.1 * noise3(x * 0.4, y, z * 0.4));
  });
  stone.add(boxMM(-12, 7.5, HALF - 1, 12, 8.1, HALF + 0.95), null, 0xe9e7e2);

  B.collider(0, 0, 26, 26, TOP);
  return B.finish();
}
