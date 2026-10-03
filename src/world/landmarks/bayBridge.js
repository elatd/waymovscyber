// San Francisco–Oakland Bay Bridge, western span: two back-to-back suspension
// bridges sharing a central concrete anchorage. Deck along local Z (-850..850),
// water at y = 0, upper road deck at y = 55 (double-deck truss).

import {
  LandmarkBuilder, std, glow, tint, boxMM, rboxMM, beam, rod, tubeGeo, prismGeo, cylY, planeGeo, V, M,
  noise3, smoothstep, clamp01, warrenTruss, scaleUV, canvasTexture, boxGeo,
} from './common.js';
import * as THREE from 'three';

export const BAY_BRIDGE = Object.freeze({
  deckY: 55,
  lowerDeckY: 46.7,
  halfWidth: 12.4,
  roadHalfWidth: 10.2,
  towersZ: [-636, -212, 212, 636],
  endZ: 850,
  cableX: 12.8,
});

const DECK = BAY_BRIDGE.deckY;
const CX = BAY_BRIDGE.cableX;
const T1 = 212, T2 = 636;
const ANCH_C = 15; // cable entry into the centre anchorage
const ANCH_E = 826; // cable entry into the end anchorages
const SADDLE = 148;

/** Main-cable centre height at |z|. */
export function bayBridgeCableY(z) {
  const a = Math.abs(z);
  if (a <= T1) {
    const t = clamp01((a - ANCH_C) / (T1 - ANCH_C));
    return 76 + (SADDLE - 76) * t - 6 * 4 * t * (1 - t);
  }
  if (a <= T2) {
    const m = (T1 + T2) / 2, h = (T2 - T1) / 2;
    return 61 + (SADDLE - 61) * ((a - m) / h) ** 2;
  }
  const t = clamp01((a - T2) / (ANCH_E - T2));
  return SADDLE + (60 - SADDLE) * t - 6 * 4 * t * (1 - t);
}

// leg geometry as a function of height (inclined, tapering)
const legCX = (y) => 15.6 + (13.6 - 15.6) * (y / 150);
const legHX = (y) => 2.8 + (1.85 - 2.8) * (y / 150);
const legHZ = (y) => 4.0 + (2.8 - 4.0) * (y / 150);

function legPoly(sx, zc, y) {
  const cx = sx * legCX(y), hx = legHX(y), hz = legHZ(y), n = 0.45;
  return [
    [hx, -hz + n], [hx, hz - n], [hx - n, hz - n], [hx - n, hz], [-hx + n, hz], [-hx + n, hz - n],
    [-hx, hz - n], [-hx, -hz + n], [-hx + n, -hz + n], [-hx + n, -hz], [hx - n, -hz], [hx - n, -hz + n],
  ].map(([x, z]) => [cx + x, zc + z]);
}

export function createBayBridge() {
  const B = new LandmarkBuilder('BayBridge');

  const ledTex = canvasTexture('baybridge-led-dots', 16, 64, (ctx, w, h) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 7);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#cfd8ff');
    g.addColorStop(1, '#000000');
    ctx.fillStyle = g;
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.translate(0, i * 16);
      ctx.beginPath();
      ctx.arc(8, 8, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }, { repeat: true });

  const steelMat = std({ name: 'bay-steel', color: 0xffffff, vertexColors: true, roughness: 0.42, metalness: 0.55 });
  const concreteMat = std({ name: 'bay-concrete', color: 0xffffff, vertexColors: true, roughness: 0.92 });
  const asphaltMat = std({ name: 'bay-asphalt', color: 0x2b2d31, roughness: 0.9 });
  const paintMat = std({ name: 'bay-markings', color: 0xf2f2ec, roughness: 0.65 });
  const ledMat = glow({ name: 'bay-lights', color: 0x5d6168, emissive: 0xf2f6ff, roughness: 0.4, metalness: 0.3, emissiveMap: ledTex }, 3.5);
  const necklaceMat = glow({ name: 'bay-necklace', color: 0xdedede, emissive: 0xfff3dc, roughness: 0.3 }, 4);
  const beaconMat = glow({ name: 'bay-beacon', color: 0x5a0a06, emissive: 0xff2010, roughness: 0.35 }, 7);
  const lampMat = glow({ name: 'bay-lamps', color: 0xe0dccd, emissive: 0xffc27a, roughness: 0.3 }, 5);

  const steel = B.part('steel', steelMat);
  const concrete = B.part('concrete', concreteMat);
  const asphalt = B.part('asphalt', asphaltMat, { castShadow: false });
  const paint = B.part('markings', paintMat, { castShadow: false });
  const leds = B.part('bayLights', ledMat, { castShadow: false, receiveShadow: false });
  const necklace = B.part('necklace', necklaceMat, { castShadow: false, receiveShadow: false });
  const beacons = B.part('beacons', beaconMat, { castShadow: false, receiveShadow: false });
  const lamps = B.part('lamps', lampMat, { castShadow: false, receiveShadow: false });

  const silver = new THREE.Color(0xaeb6bf);
  const steelC = (x, y, z, nx, ny, nz, out) => {
    const n = noise3(x * 0.1, y * 0.06, z * 0.03);
    const k = (0.9 + 0.14 * n) * (y < DECK - 1 && y > 40 ? 0.86 : 1);
    out.setRGB(silver.r * k, silver.g * k, silver.b * k);
  };
  const concreteC = (x, y, z, nx, ny, nz, out) => {
    const n = noise3(x * 0.12, y * 0.12, z * 0.12);
    const wet = 1 - 0.35 * (1 - smoothstep(-1, 2.5, y));
    const k = (0.9 + 0.15 * n) * wet;
    out.setRGB(0.47 * k, 0.455 * k, 0.42 * k);
  };

  const TOPC = DECK + 0.2, BOTC = 44.6;
  const legHzDeck = legHZ(50) + 0.15;

  // ---------------------------------------------------------------- towers
  for (const zc of BAY_BRIDGE.towersZ) {
    for (const sx of [-1, 1]) {
      const y0 = 6, y1 = 146;
      steel.add(prismGeo(legPoly(sx, zc, y0), legPoly(sx, zc, y1), y0, y1), null, steelC);
      // saddle cap
      const cx = sx * legCX(146);
      steel.add(rboxMM(cx - 2.1, 145.5, zc - 3.2, cx + 2.1, 150.5, zc + 3.2, 0.8, 2), null, steelC);
      beacons.add(new THREE.SphereGeometry(0.7, 10, 6), [cx, 151.1, zc]);
      B.collider(sx * legCX(0), zc, legHX(0) + 0.1, legHZ(0) + 0.1, 150);
    }
    // X-braced tiers + horizontal struts
    const tiers = [[8, 26], [26, BOTC - 0.5], [DECK + 3, 80], [80, 103], [103, 125], [125, 145.5]];
    const xi = (y) => legCX(y) - legHX(y) + 0.2;
    for (const [ya, yb] of tiers) {
      steel.add(beam(V(-xi(ya), ya, zc), V(xi(yb), yb, zc), 1.1, 1.6, V(0, 0, 1)), null, steelC);
      steel.add(beam(V(xi(ya), ya, zc), V(-xi(yb), yb, zc), 1.1, 1.6, V(0, 0, 1)), null, steelC);
      for (const y of [ya, yb]) {
        steel.add(boxMM(-xi(y), y - 0.9, zc - 1.6, xi(y), y + 0.9, zc + 1.6), null, steelC);
      }
    }
    // portal strut directly under the lower deck
    steel.add(boxMM(-xi(42), 41, zc - 2.2, xi(42), BOTC, zc + 2.2), null, steelC);
    concrete.add(rboxMM(-22, -4, zc - 8.5, 22, 6, zc + 8.5, 1.4, 2), null, concreteC);
    B.collider(0, zc, 22, 8.5, 6);
  }

  // ---------------------------------------------------------------- deck structure
  const spans = [];
  for (const s of [-1, 1]) {
    const segs = [[32, T1 - legHzDeck], [T1 + legHzDeck, T2 - legHzDeck], [T2 + legHzDeck, 821]];
    for (const [a, b] of segs) spans.push(s > 0 ? [a, b] : [-b, -a]);
  }
  for (const [z0, z1] of spans) {
    for (const sx of [-1, 1]) {
      warrenTruss(steel, { x: sx * CX, z0, z1, yBot: BOTC, yTop: TOPC, panel: 10, chordW: 0.9, chordH: 1.1, webW: 0.55, color: steelC });
    }
    const n = Math.max(2, Math.round((z1 - z0) / 10));
    const L = (z1 - z0) / n;
    for (let k = 0; k <= n; k++) {
      const z = z0 + k * L;
      steel.add(boxMM(-CX, DECK - 1.6, z - 0.3, CX, DECK - 0.75, z + 0.3), null, steelC);
      steel.add(boxMM(-CX, 45.2, z - 0.3, CX, 46.0, z + 0.3), null, steelC);
      if (k < n) {
        steel.add(beam(V(-CX, BOTC + 0.4, z), V(CX, BOTC + 0.4, z + L), 0.3, 0.3), null, steelC);
        steel.add(beam(V(CX, BOTC + 0.4, z), V(-CX, BOTC + 0.4, z + L), 0.3, 0.3), null, steelC);
      }
    }
  }

  // decks (upper + lower), continuous through the towers and anchorages
  const END = BAY_BRIDGE.endZ;
  const deckGray = tint(0x8f8b84, 0.05, 0.05);
  concrete.add(boxMM(-12.35, DECK - 0.75, -END, 12.35, DECK - 0.08, END), null, deckGray);
  concrete.add(boxMM(-12.35, 46.0, -821, 12.35, 46.6, 821), null, deckGray);
  asphalt.add(boxMM(-10.2, DECK - 0.1, -END, 10.2, DECK, END));
  asphalt.add(boxMM(-10.2, 46.55, -821, 10.2, 46.7, 821));
  // jersey barriers on the upper deck
  for (const sx of [-1, 1]) {
    concrete.add(boxMM(sx > 0 ? 10.2 : -10.85, DECK - 0.1, -END, sx > 0 ? 10.85 : -10.2, DECK + 1.0, END), null, tint(0xb8b3a8, 0.05, 0.1));
    paint.add(planeGeo(0.18, 2 * END), M(sx * 9.95, DECK + 0.025, 0, -Math.PI / 2));
    for (const lx of [1.95, 5.85]) {
      for (let z = -END + 3; z < END - 3; z += 12) paint.add(planeGeo(0.15, 3), M(sx * lx, DECK + 0.025, z + 1.5, -Math.PI / 2));
    }
  }

  // ---------------------------------------------------------------- anchorages
  // centre anchorage
  concrete.add(rboxMM(-24, -4, -32, 24, 46.0, 32, 1.5, 2), null, concreteC);
  concrete.add(rboxMM(-26.5, -4, -35, 26.5, 7, 35, 1.0, 1), null, concreteC);
  for (const sx of [-1, 1]) {
    const x0 = sx * 10.9, x1 = sx * 16.6;
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    concrete.add(rboxMM(lo, 46, -31, hi, 72, 31, 0.8, 1), null, concreteC);
    concrete.add(rboxMM(lo + 0.6, 72, -24, hi - 0.6, 79.5, 24, 0.6, 1), null, concreteC);
    concrete.add(rboxMM(lo + 1.4, 79.5, -12, hi - 1.4, 84, 12, 0.5, 1), null, concreteC);
    for (let i = -3; i <= 3; i++) {
      const xf = sx > 0 ? hi : lo;
      concrete.add(boxMM(xf - 0.5, 48, i * 8 - 1, xf + 0.5, 70, i * 8 + 1), null, concreteC);
    }
  }
  B.collider(0, 0, 26.5, 35, 84);
  // end anchorages
  for (const s of [-1, 1]) {
    const za = s * 821, zb = s * END;
    const lo = Math.min(za, zb), hi = Math.max(za, zb);
    concrete.add(rboxMM(-21, -4, lo, 21, DECK - 0.75, hi, 1.2, 1), null, concreteC);
    for (const sx of [-1, 1]) {
      const x0 = sx * 10.9, x1 = sx * 16.6;
      concrete.add(rboxMM(Math.min(x0, x1), DECK - 0.75, s > 0 ? 819.5 : -842, Math.max(x0, x1), 64.5, s > 0 ? 842 : -819.5, 0.6, 1), null, concreteC);
    }
    B.collider(0, s * (821 + END) / 2, 21, (END - 821) / 2, 64.5);
  }

  // ---------------------------------------------------------------- cables, suspenders, lights
  const cableR = 0.75;
  const spanDefs = [[ANCH_C - 6, T1], [T1, T2], [T2, ANCH_E + 6]];
  for (const s of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const x = sx * CX;
      for (const [a, b] of spanDefs) {
        const segs = Math.max(16, Math.round((b - a) / 8));
        steel.add(tubeGeo((t, v) => {
          const z = a + (b - a) * t;
          return v.set(x, bayBridgeCableY(z), s * z);
        }, segs, cableR, 8), null, steelC);
        // necklace lights riding on the cable
        const nb = Math.round((b - a) / 9);
        for (let i = 1; i < nb; i++) {
          const z = a + ((b - a) * i) / nb;
          necklace.add(new THREE.OctahedronGeometry(0.42, 0), [x, bayBridgeCableY(z) + cableR + 0.25, s * z]);
        }
      }
    }
  }
  const hangers = [];
  for (let z = T1 + 15; z < T2 - 5; z += 15) hangers.push(z);
  for (let z = T1 - 15; z > 40; z -= 15) hangers.push(z);
  for (let z = T2 + 15; z < 815; z += 15) hangers.push(z);
  for (const s of [-1, 1]) {
    for (const za of hangers) {
      const z = s * za;
      const yc = bayBridgeCableY(za);
      for (const sx of [-1, 1]) {
        const x = sx * CX;
        steel.add(rod(V(x, yc - cableR * 0.5, z), V(x, TOPC, z), 0.18, 6, true), null, steelC);
        steel.add(rod(V(x, yc - 0.6, z), V(x, yc + 0.6, z), cableR + 0.2, 8, false), null, steelC);
        // "The Bay Lights" LED strand on the outside of each suspender
        const len = yc - cableR - TOPC - 0.4;
        if (len > 1) {
          const g = scaleUV(boxGeo(0.16, len, 0.16), 1, len / 1.6);
          leds.add(g, [x + sx * 0.32, TOPC + 0.2 + len / 2, z]);
        }
      }
    }
  }

  // street lights on the upper deck
  for (let z = -800; z <= 800; z += 50) {
    for (const sx of [-1, 1]) {
      const x = sx * 10.55, zz = z + sx * 12;
      steel.add(cylY(0.13, 0.09, DECK + 1, DECK + 10, 6, true, x, zz), null, steelC);
      steel.add(beam(V(x, DECK + 9.8, zz), V(x - sx * 2.0, DECK + 10.1, zz), 0.14, 0.14), null, steelC);
      lamps.add(boxMM(x - sx * 1.9 - 0.5, DECK + 9.85, zz - 0.25, x - sx * 1.9 + 0.5, DECK + 10.05, zz + 0.25));
    }
  }

  return B.finish({
    deck: { y: DECK, lowerY: BAY_BRIDGE.lowerDeckY, zMin: -END, zMax: END, roadHalfWidth: 10.2, halfWidth: 12.4 },
    deckColliders: [
      { x: -10.5, z: 0, hx: 0.35, hz: END, h: 1.1, y: DECK },
      { x: 10.5, z: 0, hx: 0.35, hz: END, h: 1.1, y: DECK },
    ],
  });
}
