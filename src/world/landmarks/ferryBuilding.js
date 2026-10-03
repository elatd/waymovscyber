// Ferry Building — long axis along X (130 m), front (Embarcadero) facade +Z,
// central clock tower (~75 m to the dome, flag on top), four glowing clock faces.

import {
  LandmarkBuilder, std, glow, boxMM, rboxMM, prismGeo, latheGeo, extrudeGeo, archShape, rectShape,
  cylY, planeGeo, V, M, noise3, smoothstep, canvasTexture,
} from './common.js';
import * as THREE from 'three';

export const FERRY_BUILDING = Object.freeze({ width: 130, depth: 32, height: 15, towerHeight: 75 });

const HX = 65, HZ = 16, TOWER_Z = 5;

function drawClock(ctx, w, h) {
  const cx = w / 2, cy = h / 2, r = w / 2;
  ctx.fillStyle = '#1e1f22';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f6f2e6';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.97, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1e1f22';
  ctx.lineWidth = r * 0.025;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#1e1f22';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const big = i % 5 === 0;
    const r0 = r * (big ? 0.8 : 0.85), r1 = r * 0.89;
    ctx.save();
    ctx.translate(cx + Math.sin(a) * (r0 + r1) / 2, cy - Math.cos(a) * (r0 + r1) / 2);
    ctx.rotate(a);
    ctx.fillRect(-(big ? 4 : 1.5), -(r1 - r0) / 2, big ? 8 : 3, r1 - r0);
    ctx.restore();
  }
  const numerals = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(r * 0.15)}px Georgia, "Times New Roman", serif`;
  numerals.forEach((t, i) => {
    const a = (i / 12) * Math.PI * 2;
    ctx.save();
    ctx.translate(cx + Math.sin(a) * r * 0.66, cy - Math.cos(a) * r * 0.66);
    ctx.rotate(a);
    ctx.fillText(t, 0, 0);
    ctx.restore();
  });
}

function drawFlag(ctx, w, h) {
  for (let i = 0; i < 13; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#b22234' : '#ffffff';
    ctx.fillRect(0, (i * h) / 13, w, h / 13 + 1);
  }
  ctx.fillStyle = '#3c3b6e';
  ctx.fillRect(0, 0, w * 0.4, (h * 7) / 13);
  ctx.fillStyle = '#ffffff';
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < (r % 2 ? 5 : 6); c++) {
      const x = (w * 0.4 * (c + (r % 2 ? 1 : 0.5))) / 6, y = ((h * 7) / 13) * ((r + 0.5) / 9);
      ctx.beginPath();
      ctx.arc(x, y, h * 0.018, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function createFerryBuilding() {
  const B = new LandmarkBuilder('FerryBuilding');

  const clockTex = canvasTexture('ferry-clock', 512, 512, drawClock);
  const flagTex = canvasTexture('us-flag', 256, 136, drawFlag);

  const stoneMat = glow({ name: 'ferry-stone', color: 0xffffff, vertexColors: true, roughness: 0.82, emissive: 0xfff0d6 }, 0.16);
  const roofMat = std({ name: 'ferry-roof', color: 0xffffff, vertexColors: true, roughness: 0.65, metalness: 0.25 });
  const winMat = glow({ name: 'ferry-windows', color: 0x2a3036, emissive: 0xffcf8f, roughness: 0.2, metalness: 0.5 }, 1.2);
  const clockMat = glow({ name: 'ferry-clock', color: clockTex ? 0xffffff : 0xf4f1e6, map: clockTex, emissive: 0xfff5dc, emissiveMap: clockTex, roughness: 0.35 }, 1.8);
  const metalMat = std({ name: 'ferry-metal', color: 0x2a2724, roughness: 0.45, metalness: 0.7 });
  const flagMat = std({ name: 'ferry-flag', color: flagTex ? 0xffffff : 0xc23a3a, map: flagTex, roughness: 0.8, side: THREE.DoubleSide });

  const stone = B.part('stone', stoneMat);
  const roof = B.part('roof', roofMat);
  const wins = B.part('windows', winMat, { castShadow: false });
  const clock = B.part('clockFaces', clockMat, { castShadow: false });
  const metal = B.part('metal', metalMat);
  const flag = B.part('flag', flagMat, { castShadow: false });

  const cream = (hex = 0xe9dcc0) => (x, y, z, nx, ny, nz, out) => {
    out.set(hex);
    out.multiplyScalar((0.9 + 0.12 * noise3(x * 0.2, y * 0.2, z * 0.2)) * (0.9 + 0.1 * smoothstep(0, 4, y)));
  };
  const C = cream(), Cdark = cream(0xd9c9a6), Ctrim = cream(0xf2e9d6);

  // ---------------------------------------------------------------- main block
  stone.add(rboxMM(-HX - 0.4, 0, -HZ - 0.4, HX + 0.4, 1.3, HZ + 0.4, 0.1), null, Cdark); // base course
  stone.add(rboxMM(-HX, 1.3, -HZ, HX, 13, HZ, 0.25), null, C);
  stone.add(boxMM(-HX - 0.7, 12.2, -HZ - 0.7, HX + 0.7, 13.0, HZ + 0.7), null, Ctrim); // cornice
  stone.add(boxMM(-HX - 0.2, 6.9, -HZ - 0.25, HX + 0.2, 7.5, HZ + 0.25), null, Ctrim); // string course
  // parapet
  for (const s of [-1, 1]) {
    stone.add(boxMM(-HX - 0.3, 13, s * (HZ + 0.1) - 0.3, HX + 0.3, 14.1, s * (HZ + 0.1) + 0.3), null, Ctrim);
    stone.add(boxMM(s * (HX + 0.1) - 0.3, 13, -HZ - 0.3, s * (HX + 0.1) + 0.3, 14.1, HZ + 0.3), null, Ctrim);
  }
  // end pavilions
  for (const s of [-1, 1]) {
    const x0 = s * (HX - 9), x1 = s * (HX + 0.6);
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    stone.add(rboxMM(lo, 1.3, -HZ - 0.6, hi, 15.2, HZ + 0.6, 0.25), null, C);
    stone.add(boxMM(lo - 0.4, 14.6, -HZ - 1.0, hi + 0.4, 15.4, HZ + 1.0), null, Ctrim);
    const b = [[hi + 0.2, -HZ - 0.8], [hi + 0.2, HZ + 0.8], [lo - 0.2, HZ + 0.8], [lo - 0.2, -HZ - 0.8]];
    const t = [[hi - 3.5, -HZ + 6], [hi - 3.5, HZ - 6], [lo + 3.5, HZ - 6], [lo + 3.5, -HZ + 6]];
    roof.add(prismGeo(b, t, 15.4, 19.0, { capBottom: false }), null, 0x6f8577);
  }

  // ---------------------------------------------------------------- hipped roof + skylight
  {
    const b = [[HX - 9, -HZ - 0.6], [HX - 9, HZ + 0.6], [-HX + 9, HZ + 0.6], [-HX + 9, -HZ - 0.6]];
    const t = [[HX - 13, -3.2], [HX - 13, 3.2], [-HX + 13, 3.2], [-HX + 13, -3.2]];
    roof.add(prismGeo(b, t, 14.0, 17.6, { capBottom: false }), null, (x, y, z, nx, ny, nz, o) => {
      o.set(0x748c7c);
      o.multiplyScalar(0.9 + 0.15 * noise3(x * 0.1, y, z * 0.3));
    });
    wins.add(boxMM(-HX + 14, 17.5, -2.6, HX - 14, 18.5, 2.6));
    for (let x = -HX + 15; x <= HX - 15; x += 4) metal.add(boxMM(x - 0.08, 17.5, -2.75, x + 0.08, 18.65, 2.75));
  }

  // ---------------------------------------------------------------- facade: arcades + windows
  const bays = [];
  for (let x = -HX + 11.5; x <= HX - 11.5 + 0.01; x += 5.0) if (Math.abs(x) > 10) bays.push(x);
  for (const s of [-1, 1]) {
    const zf = s * HZ;
    const rot = s > 0 ? 0 : Math.PI;
    for (const x of bays) {
      // ground-floor arch (deep, dark) and arch surround
      wins.add(extrudeGeo(archShape(3.3, 2.9, 0, 0, 10), 0.1), M(x, 1.3, zf + s * 0.04, 0, rot, 0));
      const sur = rectShape(4.4, 5.3, 0, 2.65);
      sur.holes.push(archShape(3.3, 2.9, 0, 0, 10));
      stone.add(extrudeGeo(sur, 0.3, { curveSegments: 10 }), M(x, 1.3, zf + s * 0.15, 0, rot, 0), Ctrim);
      // pilasters
      stone.add(boxMM(x + 2.3, 1.3, Math.min(zf, zf + s * 0.45), x + 2.7, 12.2, Math.max(zf, zf + s * 0.45)), null, Ctrim);
      // upper-floor paired windows
      for (const dx of [-0.85, 0.85]) {
        wins.add(boxMM(x + dx - 0.6, 8.3, Math.min(zf, zf + s * 0.06), x + dx + 0.6, 11.3, Math.max(zf, zf + s * 0.06)));
      }
    }
    // end-pavilion windows
    for (const ex of [-HX + 4.4, HX - 4.4]) {
      for (const dx of [-2, 0, 2]) {
        wins.add(extrudeGeo(archShape(1.2, 2.2, 0, 0, 8), 0.1), M(ex + dx, 2.5, s * (HZ + 0.62), 0, rot, 0));
        wins.add(boxMM(ex + dx - 0.55, 8.3, Math.min(s * (HZ + 0.6), s * (HZ + 0.68)), ex + dx + 0.55, 12, Math.max(s * (HZ + 0.6), s * (HZ + 0.68))));
      }
    }
  }
  // gable-end windows
  for (const s of [-1, 1]) {
    for (const dz of [-8, -3, 3, 8]) {
      wins.add(boxMM(s * (HX + 0.6) - 0.04, 3, dz - 0.9, s * (HX + 0.6) + 0.04, 6, dz + 0.9));
      wins.add(boxMM(s * (HX + 0.6) - 0.04, 8.5, dz - 0.9, s * (HX + 0.6) + 0.04, 12, dz + 0.9));
    }
  }

  // ---------------------------------------------------------------- central pavilion (front)
  stone.add(rboxMM(-10, 1.3, HZ - 2, 10, 16.5, HZ + 1.6, 0.25), null, C);
  stone.add(boxMM(-10.5, 15.6, HZ - 2.4, 10.5, 16.6, HZ + 2.0), null, Ctrim);
  wins.add(extrudeGeo(archShape(6.4, 5.2, 0, 0, 14), 0.1), [0, 1.3, HZ + 1.65]);
  {
    const sur = rectShape(8.8, 10.0, 0, 5.0);
    sur.holes.push(archShape(6.4, 5.2, 0, 0, 14));
    stone.add(extrudeGeo(sur, 0.4, { curveSegments: 14 }), [0, 1.3, HZ + 1.8], Ctrim);
  }
  for (const dx of [-6.5, 6.5]) wins.add(boxMM(dx - 0.9, 9, HZ + 1.6, dx + 0.9, 13.5, HZ + 1.66));

  // ---------------------------------------------------------------- clock tower
  const TZ = TOWER_Z;
  const sq = (h, y0, y1, color = C, r = 0.2) => stone.add(rboxMM(-h, y0, TZ - h, h, y1, TZ + h, r), null, color);
  sq(5.6, 12, 50.5);
  // corner pilasters + string courses
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      stone.add(boxMM(sx * 5.6 - 0.75, 16, TZ + sz * 5.6 - 0.75, sx * 5.6 + 0.75, 50, TZ + sz * 5.6 + 0.75), null, Ctrim);
    }
  }
  for (const y of [24, 37]) sq(5.9, y, y + 0.7, Ctrim, 0.1);
  // tall window slots on every face
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2;
    for (const u of [-1.6, 1.6]) {
      for (const [y0, y1] of [[17, 23], [26, 35.5], [39, 48]]) {
        const g = boxMM(u - 0.55, y0, 5.6, u + 0.55, y1, 5.66);
        wins.add(g, M(0, 0, TZ, 0, a, 0));
      }
    }
  }
  // clock stage
  sq(6.3, 50.5, 59.5, C, 0.3);
  sq(6.8, 59.3, 60.2, Ctrim, 0.15);
  sq(6.6, 50.2, 51.0, Ctrim, 0.15);
  const CLOCK_Y = 55, CLOCK_R = 3.05;
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2;
    const face = new THREE.CircleGeometry(CLOCK_R, 40);
    clock.add(face, M(6.3 * Math.sin(a), CLOCK_Y, TZ + 6.3 * Math.cos(a), 0, a, 0).multiply(M(0, 0, 0.06)));
    // rim
    const rim = latheGeo([[CLOCK_R - 0.05, -0.05], [CLOCK_R + 0.35, -0.05], [CLOCK_R + 0.35, 0.22], [CLOCK_R - 0.05, 0.22]], 40, 35);
    metal.add(rim, M(6.3 * Math.sin(a), CLOCK_Y, TZ + 6.3 * Math.cos(a), 0, a, 0).multiply(M(0, 0, 0, Math.PI / 2, 0, 0)));
    // hands at 10:10
    const base = M(6.3 * Math.sin(a), CLOCK_Y, TZ + 6.3 * Math.cos(a), 0, a, 0);
    const hand = (angle, len, wdt, dz) => {
      const g = new THREE.BoxGeometry(wdt, len, 0.06);
      g.translate(0, len / 2 - 0.35, 0);
      metal.add(g, base.clone().multiply(M(0, 0, dz, 0, 0, -angle)));
    };
    hand((10 / 12) * Math.PI * 2 + (10 / 60) * (Math.PI / 6), 1.75, 0.26, 0.14);
    hand((10 / 60) * Math.PI * 2, 2.55, 0.17, 0.2);
    metal.add(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 12), base.clone().multiply(M(0, 0, 0.24, Math.PI / 2, 0, 0)));
  }
  // open belfry arcade
  {
    const y0 = 60.2, y1 = 66.5, h = 5.2;
    wins.add(boxMM(-h + 0.9, y0, TZ - h + 0.9, h - 0.9, y1, TZ + h - 0.9));
    for (let f = 0; f < 4; f++) {
      const a = (f * Math.PI) / 2;
      const sh = rectShape(2 * h, y1 - y0, 0, (y1 - y0) / 2);
      for (const u of [-3.1, 0, 3.1]) sh.holes.push(archShape(2.1, 2.6, u, 0.6, 8));
      stone.add(extrudeGeo(sh, 0.8, { curveSegments: 8 }), M(h * Math.sin(a), y0, TZ + h * Math.cos(a), 0, a, 0).multiply(M(0, 0, -0.4)), C);
    }
    sq(5.8, y1, y1 + 0.8, Ctrim, 0.15);
  }
  // upper stage + dome + lantern
  sq(3.9, 67.3, 70.6, C, 0.2);
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2;
    wins.add(extrudeGeo(archShape(1.2, 1.4, 0, 0, 8), 0.1), M(3.92 * Math.sin(a), 68.0, TZ + 3.92 * Math.cos(a), 0, a, 0));
  }
  sq(4.3, 70.4, 71.0, Ctrim, 0.1);
  stone.add(latheGeo([[3.6, 71.0], [3.6, 71.4], [3.3, 72.4], [2.6, 73.4], [1.6, 74.1], [0.6, 74.4], [0.45, 74.4], [0.45, 75.2], [0, 75.4]], 24, 30), [0, 0, TZ], Ctrim);
  metal.add(cylY(0.09, 0.07, 75.2, 81, 6, false, 0, TZ));
  metal.add(new THREE.SphereGeometry(0.16, 8, 6), [0, 81.05, TZ]);
  {
    const g = new THREE.PlaneGeometry(3.4, 1.8, 10, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = (p.getX(i) + 1.7) / 3.4;
      p.setZ(i, Math.sin(u * 5.5) * 0.18 * u);
    }
    g.computeVertexNormals();
    g.translate(1.75, 0, 0);
    flag.add(g, [0.08, 80.0, TZ]);
  }

  B.collider(0, 0, HX + 0.7, HZ + 0.7, 15.5);
  B.collider(0, HZ + 0.8, 10.5, 1.2, 16.6);
  return B.finish();
}
