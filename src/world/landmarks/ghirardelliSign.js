// Ghirardelli rooftop sign — individual red block letters "GHIRARDELLI"
// (5 m tall, ~46 m wide along X) on a galvanised steel lattice frame.
// Origin at the bottom centre of the frame (put it on a roof). Letters face +Z
// and glow red at night.

import { LandmarkBuilder, std, glow, boxMM, beam, extrudeGeo, V } from './common.js';
import * as THREE from 'three';

export const GHIRARDELLI_SIGN = Object.freeze({ width: 48.4, height: 7.9, letterHeight: 5, depth: 2.2 });

const HL = 5; // letter height
const T = 0.95; // stroke width

function quad(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}
const rect = (x0, y0, x1, y1) => quad([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);

/** Bowl (D-shaped, open to the left) between y0..y1, from xs to the right edge xe. */
function bowl(xs, xe, y0, y1, t) {
  const r = (y1 - y0) / 2, cy = (y0 + y1) / 2, xc = xe - r;
  const s = new THREE.Shape();
  s.moveTo(xs, y0);
  s.lineTo(xc, y0);
  s.absarc(xc, cy, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(xs, y1);
  s.closePath();
  const h = new THREE.Path();
  h.moveTo(xs + t * 0.01, y0 + t);
  h.lineTo(xc, y0 + t);
  h.absarc(xc, cy, r - t, -Math.PI / 2, Math.PI / 2, false);
  h.lineTo(xs + t * 0.01, y1 - t);
  h.closePath();
  s.holes.push(h);
  return s;
}

/** Shapes for one glyph, in a [0, w] x [0, HL] box. */
function glyph(ch, w) {
  const t = T;
  switch (ch) {
    case 'I':
      return [rect(0, 0, w, HL)];
    case 'H':
      return [rect(0, 0, t, HL), rect(w - t, 0, w, HL), rect(0, HL / 2 - t / 2, w, HL / 2 + t / 2)];
    case 'E':
      return [rect(0, 0, t, HL), rect(0, HL - t, w, HL), rect(0, HL / 2 - t / 2, w * 0.86, HL / 2 + t / 2), rect(0, 0, w, t)];
    case 'L':
      return [rect(0, 0, t, HL), rect(0, 0, w, t)];
    case 'D':
      return [rect(0, 0, t, HL), bowl(t * 0.5, w, 0, HL, t)];
    case 'R': {
      const yb = HL * 0.44;
      return [
        rect(0, 0, t, HL),
        bowl(t * 0.5, w * 0.97, yb, HL, t),
        quad([[w - t * 1.2, 0], [w, 0], [w * 0.42 + t * 1.15, yb + t * 0.6], [w * 0.42, yb + t * 0.6]]),
      ];
    }
    case 'A':
      return [
        quad([[0, 0], [t * 1.15, 0], [w / 2 + t * 0.55, HL], [w / 2 - t * 0.55, HL]]),
        quad([[w - t * 1.15, 0], [w, 0], [w / 2 + t * 0.55, HL], [w / 2 - t * 0.55, HL]]),
        rect(w * 0.24, HL * 0.27, w * 0.76, HL * 0.27 + t * 0.85),
      ];
    case 'G': {
      const rx = w / 2, ry = HL / 2, cx = w / 2, cy = HL / 2;
      const a0 = (38 * Math.PI) / 180, a1 = (322 * Math.PI) / 180;
      const s = new THREE.Shape();
      const N = 28;
      for (let i = 0; i <= N; i++) {
        const a = a0 + ((a1 - a0) * i) / N;
        const x = cx + rx * Math.cos(a), y = cy + ry * Math.sin(a);
        if (i === 0) s.moveTo(x, y);
        else s.lineTo(x, y);
      }
      for (let i = N; i >= 0; i--) {
        const a = a0 + ((a1 - a0) * i) / N;
        s.lineTo(cx + (rx - t) * Math.cos(a), cy + (ry - t) * Math.sin(a));
      }
      s.closePath();
      return [s, rect(w * 0.52, HL * 0.36, w, HL * 0.36 + t * 0.85), rect(w - t, HL * 0.1, w, HL * 0.36 + t * 0.85)];
    }
    default:
      return [rect(0, 0, w, HL)];
  }
}

const WIDTHS = { G: 4.4, H: 4.2, I: 1.15, R: 4.2, A: 4.7, D: 4.2, E: 3.5, L: 3.4 };

export function createGhirardelliSign() {
  const B = new LandmarkBuilder('GhirardelliSign');
  const letterMat = glow({ name: 'gh-letters', color: 0xc8161d, emissive: 0xff2a14, roughness: 0.42, metalness: 0.1 }, 2.6);
  const edgeMat = std({ name: 'gh-letter-sides', color: 0x8e1015, roughness: 0.5, metalness: 0.2 });
  const steelMat = std({ name: 'gh-steel', color: 0x8b9096, roughness: 0.5, metalness: 0.75 });
  const letters = B.part('letters', letterMat);
  const steel = B.part('steel', steelMat);
  const sides = B.part('letterSides', edgeMat);

  const word = 'GHIRARDELLI';
  const GAP = 0.8;
  const total = [...word].reduce((s, c) => s + WIDTHS[c], 0) + GAP * (word.length - 1);
  const Y0 = 1.6, DEPTH = 0.55;
  let x = -total / 2;
  const letterSpans = [];
  for (const ch of word) {
    const w = WIDTHS[ch];
    for (const shape of glyph(ch, w)) {
      // front face (glowing) as a thin cap, extruded body as darker sides
      const g = extrudeGeo(shape, DEPTH, { curveSegments: 12 });
      sides.add(g, [x, Y0, 0]);
      const face = new THREE.ShapeGeometry(shape, 12);
      letters.add(face, [x, Y0, DEPTH / 2 + 0.025]);
    }
    letterSpans.push([x, x + w]);
    x += w + GAP;
  }

  // ---------------------------------------------------------------- lattice frame
  const FZ = -0.85, HALF = total / 2 + 1.0;
  const yB = 0.9, yT = Y0 + HL + 0.8;
  steel.add(boxMM(-HALF, yB - 0.12, FZ - 0.1, HALF, yB + 0.12, FZ + 0.1));
  steel.add(boxMM(-HALF, yT - 0.12, FZ - 0.1, HALF, yT + 0.12, FZ + 0.1));
  steel.add(boxMM(-HALF, (yB + yT) / 2 - 0.08, FZ - 0.08, HALF, (yB + yT) / 2 + 0.08, FZ + 0.08));
  const nBays = 12;
  const bay = (2 * HALF) / nBays;
  for (let i = 0; i <= nBays; i++) {
    const px = -HALF + i * bay;
    steel.add(boxMM(px - 0.11, 0, FZ - 0.11, px + 0.11, yT + 0.12, FZ + 0.11));
    // rear raking strut + footing
    steel.add(beam(V(px, 0, FZ - 1.3), V(px, yT * 0.72, FZ), 0.12, 0.12));
    steel.add(boxMM(px - 0.3, 0, FZ - 1.55, px + 0.3, 0.12, FZ + 0.3));
    if (i < nBays) {
      steel.add(beam(V(px, yB, FZ), V(px + bay, yT, FZ), 0.08, 0.08, V(0, 0, 1)));
      steel.add(beam(V(px + bay, yB, FZ), V(px, yT, FZ), 0.08, 0.08, V(0, 0, 1)));
    }
  }
  // stand-off brackets from frame to each letter
  for (const [a, b] of letterSpans) {
    for (const bx of [a + 0.35, b - 0.35]) {
      for (const by of [Y0 + 0.5, Y0 + HL - 0.5]) {
        steel.add(boxMM(bx - 0.05, by - 0.05, FZ, bx + 0.05, by + 0.05, -DEPTH / 2 + 0.02));
      }
    }
  }

  B.collider(0, FZ - 0.6, HALF, 1.0, yT);
  return B.finish();
}
