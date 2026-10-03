// Chinatown Dragon Gate (Grant Ave). Straddles a street running along ±Z:
// road x ∈ [-7.5, 7.5] is completely clear up to 7.6 m; pillars + lions stand on
// the sidewalks (|x| ∈ [7.8, 12]). Front faces +Z.

import {
  LandmarkBuilder, std, glow, boxMM, rboxMM, cylY, sphereGeo, rod, V, M, noise3, canvasTexture, fitText,
} from './common.js';
import * as THREE from 'three';

export const CHINATOWN_GATE = Object.freeze({
  width: 24, depth: 4.6, height: 13.2,
  roadHalfWidth: 7.5, clearHeight: 7.6, sidewalk: [7.5, 12],
});

/** Concave pagoda roof with upturned corners. Eave line at y = 0, ridge at y = h. */
function pagodaRoof(w, d, h, up, thick = 0.28, nx = 28, nz = 12) {
  const hw = w / 2, hd = d / 2;
  const topY = (x, z) => {
    const u = Math.min(1, Math.abs(x) / hw), v = Math.min(1, Math.abs(z) / hd);
    let y = h * Math.pow(1 - v, 1.55);
    y *= 1 - 0.3 * Math.pow(u, 5);
    y += up * Math.pow(u, 4) * Math.pow(v, 1.2) + up * 0.22 * Math.pow(v, 3);
    return y;
  };
  const parts = [];
  const top = new THREE.PlaneGeometry(w, d, nx, nz);
  top.rotateX(-Math.PI / 2);
  const bot = new THREE.PlaneGeometry(w, d, nx, nz);
  bot.rotateX(Math.PI / 2);
  for (const [g, off] of [[top, 0], [bot, -thick]]) {
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, topY(x, z) + off);
      uv.setXY(i, x * 1.1, z * 1.4);
    }
    g.computeVertexNormals();
    parts.push(g);
  }
  // edge strips (CCW loop in x,z)
  const loop = [];
  for (let i = 0; i <= nz; i++) loop.push([hw, -hd + (d * i) / nz]);
  for (let i = 1; i <= nx; i++) loop.push([hw - (w * i) / nx, hd]);
  for (let i = 1; i <= nz; i++) loop.push([-hw, hd - (d * i) / nz]);
  for (let i = 1; i < nx; i++) loop.push([-hw + (w * i) / nx, -hd]);
  const pos = [];
  for (let i = 0; i < loop.length; i++) {
    const [px, pz] = loop[i], [qx, qz] = loop[(i + 1) % loop.length];
    const pt = topY(px, pz), qt = topY(qx, qz);
    const b0 = [px, pt - thick, pz], b1 = [qx, qt - thick, qz], t1 = [qx, qt, qz], t0 = [px, pt, pz];
    pos.push(...b0, ...t0, ...t1, ...b0, ...t1, ...b1);
  }
  const edge = new THREE.BufferGeometry();
  edge.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  edge.computeVertexNormals();
  parts.push(edge);
  return { parts, topY };
}

export function createChinatownGate() {
  const B = new LandmarkBuilder('ChinatownGate');

  const tileTex = canvasTexture('chinatown-tiles', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#1f6b3a';
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      const g = ctx.createLinearGradient(x, 0, x + 16, 0);
      g.addColorStop(0, '#174f2b');
      g.addColorStop(0.45, '#3f9a58');
      g.addColorStop(0.6, '#5fbf74');
      g.addColorStop(1, '#174f2b');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 16, h);
    }
    ctx.fillStyle = 'rgba(10,40,20,0.55)';
    for (let y = 0; y < h; y += 32) ctx.fillRect(0, y, w, 3);
  }, { repeat: true });
  const plaqueTex = canvasTexture('chinatown-plaque', 512, 200, (ctx, w, h) => {
    ctx.fillStyle = '#c9a23a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#123a6b';
    ctx.fillRect(14, 14, w - 28, h - 28);
    ctx.strokeStyle = '#e8c45a';
    ctx.lineWidth = 5;
    ctx.strokeRect(26, 26, w - 52, h - 52);
    ctx.fillStyle = '#f2cf5c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, '天下為公', w / 2, h / 2 + 4, w - 90, 120, 'bold',
      '"PingFang TC","Hiragino Sans CNS","Microsoft JhengHei","Noto Serif CJK TC","Noto Sans CJK TC","SimSun",serif');
  });

  const lacquerMat = std({ name: 'cg-lacquer', color: 0xffffff, vertexColors: true, roughness: 0.38, metalness: 0.05 });
  const goldMat = std({ name: 'cg-gold', color: 0xe3b04a, roughness: 0.3, metalness: 1.0 });
  const tileMat = std({ name: 'cg-tiles', color: tileTex ? 0xffffff : 0x2f8a4a, map: tileTex, roughness: 0.32, metalness: 0.1 });
  const stoneMat = std({ name: 'cg-stone', color: 0xffffff, vertexColors: true, roughness: 0.85 });
  const plaqueMat = std({ name: 'cg-plaque', color: plaqueTex ? 0xffffff : 0x1b3f73, map: plaqueTex, roughness: 0.45, metalness: 0.2 });
  const lanternMat = glow({ name: 'cg-lanterns', color: 0xc8231c, emissive: 0xff3a1a, roughness: 0.5 }, 2.2);

  const lacq = B.part('lacquer', lacquerMat);
  const gold = B.part('gold', goldMat);
  const tiles = B.part('tiles', tileMat);
  const stone = B.part('stone', stoneMat);
  const plaque = B.part('plaque', plaqueMat, { castShadow: false });
  const lantern = B.part('lanterns', lanternMat, { castShadow: false });

  const RED = 0xc4261c, TEAL = 0x1d6a68, BLUE = 0x1f4f8a, DARKRED = 0x8e1a14;
  const granite = (x, y, z, nx, ny, nz, out) => {
    out.set(0xa9a59c);
    out.multiplyScalar(0.88 + 0.2 * noise3(x * 1.5, y * 1.5, z * 1.5));
  };

  // ---------------------------------------------------------------- pillars (sidewalks only)
  const PI_X = 8.35, PO_X = 11.45, PH = 0.42, PZ = 0.55;
  for (const s of [-1, 1]) {
    for (const [px, top] of [[PI_X, 10.1], [PO_X, 7.2]]) {
      const x = s * px;
      stone.add(rboxMM(x - 0.6, 0, -0.85, x + 0.6, 0.75, 0.85, 0.08), null, granite);
      stone.add(boxMM(x - 0.5, 0.75, -0.72, x + 0.5, 1.05, 0.72), null, granite);
      lacq.add(boxMM(x - PH, 1.05, -PZ, x + PH, top, PZ), null, RED);
      gold.add(boxMM(x - PH - 0.03, 1.05, -PZ - 0.03, x + PH + 0.03, 1.25, PZ + 0.03));
      B.collider(x, 0, 0.6, 0.85, top);
    }
  }
  // ---------------------------------------------------------------- central section (over the road, >= 7.6 m)
  const CY = 7.6;
  lacq.add(boxMM(-8.9, CY, -0.5, 8.9, CY + 0.75, 0.5), null, RED); // main lintel
  gold.add(boxMM(-8.9, CY - 0.04, -0.53, 8.9, CY + 0.06, 0.53));
  gold.add(boxMM(-8.9, CY + 0.7, -0.53, 8.9, CY + 0.8, 0.53));
  lacq.add(boxMM(-8.75, CY + 0.8, -0.38, 8.75, CY + 2.3, 0.38), null, TEAL); // frieze
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const x = s * (3.1 + k * 1.35);
      lacq.add(boxMM(x - 0.5, CY + 1.05, -0.42, x + 0.5, CY + 2.05, 0.42), null, k % 2 ? BLUE : DARKRED);
      gold.add(boxMM(x - 0.56, CY + 1.0, -0.4, x + 0.56, CY + 2.1, 0.4));
    }
  }
  plaque.add(new THREE.PlaneGeometry(4.2, 1.6), [0, CY + 1.55, 0.455]);
  plaque.add(new THREE.PlaneGeometry(4.2, 1.6), [0, CY + 1.55, -0.455, 0, Math.PI, 0]);
  gold.add(boxMM(-2.25, CY + 0.7, -0.43, 2.25, CY + 2.4, 0.43));
  lacq.add(boxMM(-9.3, CY + 2.3, -0.62, 9.3, CY + 2.75, 0.62), null, RED); // upper beam
  gold.add(boxMM(-9.3, CY + 2.72, -0.64, 9.3, CY + 2.8, 0.64));
  // bracket layer (dougong)
  for (let x = -8.6; x <= 8.61; x += 0.86) {
    lacq.add(boxMM(x - 0.22, CY + 2.8, -0.85, x + 0.22, CY + 3.25, 0.85), null, TEAL);
  }
  lacq.add(boxMM(-9.6, CY + 3.2, -1.05, 9.6, CY + 3.45, 1.05), null, RED);
  {
    const { parts, topY } = pagodaRoof(21.5, 5.0, 1.6, 0.85);
    const y0 = CY + 3.45;
    for (const g of parts) tiles.add(g, [0, y0, 0]);
    // ridge + ridge ends
    lacq.add(boxMM(-8.9, y0 + topY(0, 0) - 0.15, -0.22, 8.9, y0 + topY(0, 0) + 0.38, 0.22), null, 0x2f8a4a);
    gold.add(boxMM(-8.9, y0 + topY(0, 0) + 0.38, -0.12, 8.9, y0 + topY(0, 0) + 0.46, 0.12));
    for (const s of [-1, 1]) {
      const g = new THREE.TorusGeometry(0.42, 0.13, 6, 10, Math.PI * 1.25);
      gold.add(g, M(s * 9.05, y0 + topY(0, 0) + 0.55, 0, 0, s > 0 ? 0 : Math.PI, Math.PI * 0.35));
    }
    gold.add(sphereGeo(0.32, 10, 8), [0, y0 + topY(0, 0) + 0.75, 0]);
    // gable fill under the roof ends
    for (const s of [-1, 1]) {
      const sh = new THREE.Shape();
      const xg = 8.7;
      sh.moveTo(-2.1, 0);
      for (let k = 0; k <= 10; k++) {
        const z = -2.1 + (4.2 * k) / 10;
        sh.lineTo(z, Math.max(0, topY(xg, z) - 0.3));
      }
      sh.lineTo(2.1, 0);
      sh.closePath();
      const g = new THREE.ShapeGeometry(sh);
      lacq.add(g, M(s * xg, y0, 0, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0), RED);
    }
  }
  // ---------------------------------------------------------------- side sections (over sidewalks)
  for (const s of [-1, 1]) {
    const xc = s * ((PI_X + PO_X) / 2), half = (PO_X - PI_X) / 2 + 0.6;
    const SY = 6.1;
    lacq.add(boxMM(xc - half, SY, -0.42, xc + half, SY + 0.55, 0.42), null, RED);
    gold.add(boxMM(xc - half, SY + 0.52, -0.45, xc + half, SY + 0.6, 0.45));
    lacq.add(boxMM(xc - half + 0.2, SY + 0.6, -0.3, xc + half - 0.2, SY + 1.3, 0.3), null, TEAL);
    lacq.add(boxMM(xc - half - 0.15, SY + 1.3, -0.5, xc + half + 0.15, SY + 1.6, 0.5), null, RED);
    for (let k = -2; k <= 2; k++) lacq.add(boxMM(xc + k * 0.8 - 0.18, SY + 1.6, -0.7, xc + k * 0.8 + 0.18, SY + 1.9, 0.7), null, TEAL);
    const { parts, topY } = pagodaRoof(2 * half + 1.6, 3.6, 1.2, 0.6, 0.24, 14, 10);
    for (const g of parts) tiles.add(g, [xc + s * 0.25, SY + 1.9, 0]);
    lacq.add(boxMM(xc - half + 0.4, SY + 1.9 + topY(0, 0) - 0.12, -0.16, xc + half + 0.6, SY + 1.9 + topY(0, 0) + 0.26, 0.16), null, 0x2f8a4a);
    // hanging lantern over the sidewalk
    lantern.add(sphereGeo(0.42, 12, 8), M(xc, SY - 0.95, 0, 0, 0, 0, 1, 1.2, 1));
    gold.add(cylY(0.03, 0.03, SY - 0.45, SY, 4, true, xc, 0));
    gold.add(cylY(0.2, 0.2, SY - 1.5, SY - 1.38, 10, false, xc, 0));
    gold.add(cylY(0.2, 0.2, SY - 0.5, SY - 0.42, 10, false, xc, 0));
  }

  // ---------------------------------------------------------------- guardian lions (on the sidewalks, in front)
  const LZ = 2.4;
  for (const s of [-1, 1]) {
    const lx = s * 9.9;
    stone.add(rboxMM(lx - 0.7, 0, LZ - 0.7, lx + 0.7, 1.15, LZ + 0.7, 0.08), null, granite);
    const L = (geo, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0) => stone.add(geo, M(lx + x, y, LZ + z, rx, 0, 0, sx, sy, sz), granite);
    L(sphereGeo(1, 12, 8), 0, 1.6, -0.2, 0.5, 0.42, 0.55); // haunches
    L(sphereGeo(1, 12, 8), 0, 2.0, 0.1, 0.42, 0.62, 0.38, -0.25); // chest
    for (const fx of [-0.22, 0.22]) stone.add(rod(V(lx + fx, 1.2, LZ + 0.42), V(lx + fx, 1.95, LZ + 0.32), 0.12, 8, false), null, granite);
    L(new THREE.IcosahedronGeometry(0.55, 1), 0, 2.62, 0.18, 1.05, 1.0, 0.9); // mane
    L(sphereGeo(0.4, 12, 8), 0, 2.62, 0.42); // head
    L(sphereGeo(0.2, 10, 6), 0, 2.5, 0.78, 1.2, 0.8, 1); // snout
    L(sphereGeo(0.24, 10, 8), s * 0.32, 1.38, 0.62); // ball / cub
    L(sphereGeo(0.2, 8, 6), 0, 1.75, -0.72, 1, 1.4, 1); // tail curl
    B.collider(lx, LZ, 0.75, 0.75, 3.2);
  }

  return B.finish({ roadClear: { xMin: -7.5, xMax: 7.5, height: CY } });
}
