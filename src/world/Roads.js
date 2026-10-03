// Road network meshes: carriageways (ramped between flat intersections), sidewalks with
// curbs, intersections with crosswalks, Lombard's brick block, cable-car rails.
import * as THREE from 'three';
import { MeshBuilder } from './MeshBuilder.js';
import {
  N, S, STRIP, ROAD_HALF, CURB, RAMP, RAMP_T, LOMBARD, CABLE_CAR_LINE,
  lineX, lineZ, heightIJ, ease,
} from './CityLayout.js';

// Extents of the (decorative + playable) network
export const NET = { iMin: -2, iMax: N, jMin: 0, jMax: N + 2 };

function isLombard(i, j, dir) {
  return dir === 'EW' && j === LOMBARD.j && i === LOMBARD.i0;
}

export function buildRoads(mats) {
  const road = new MeshBuilder();
  const brick = new MeshBuilder();
  const inter = new MeshBuilder();
  const walk = new MeshBuilder();
  const curb = new MeshBuilder();
  const rails = new MeshBuilder();

  const T = RAMP_T;

  // --- N-S segments (along Z) on line i, between j and j+1
  for (let i = NET.iMin; i <= NET.iMax; i++) {
    for (let j = NET.jMin; j < NET.jMax; j++) {
      const x = lineX(i);
      const za = lineZ(j) + STRIP, zb = lineZ(j + 1) - STRIP;
      const ha = heightIJ(i, j), hb = heightIJ(i, j + 1);
      const hAt = (t) => ha + (hb - ha) * ease(t);
      // carriageway
      road.grid(T.length, 2, (r, c) => {
        const z = za + T[r] * RAMP;
        const xx = x - ROAD_HALF + c * 2 * ROAD_HALF;
        return [xx, hAt(T[r]), z, c, z / 15];
      });
      // sidewalks: west (x-12..x-7.5) and east (x+7.5..x+12)
      for (const s of [-1, 1]) {
        const xin = x + s * ROAD_HALF, xout = x + s * STRIP;
        walk.grid(T.length, 2, (r, c) => {
          const z = za + T[r] * RAMP;
          const xx = s < 0 ? (c === 0 ? xout : xin) : (c === 0 ? xin : xout);
          return [xx, hAt(T[r]) + CURB, z, (Math.abs(xx - x) - ROAD_HALF) / 4.5, z / 4.5];
        });
        // curb face facing the road (normal -s*x)
        curb.grid(T.length, 2, (r, c) => {
          const z = za + T[r] * RAMP;
          const y = hAt(T[r]) + (c === 0 ? 0 : CURB);
          return [xin, y, z, c * 0.1, z / 4];
        }, s < 0);
      }
      if (i === CABLE_CAR_LINE && j < N) addRails(rails, 'NS', x, za, zb, hAt);
    }
  }

  // --- E-W segments (along X) on line j, between i and i+1
  for (let j = NET.jMin; j <= NET.jMax; j++) {
    for (let i = NET.iMin; i < NET.iMax; i++) {
      const z = lineZ(j);
      const xa = lineX(i) + STRIP;
      const ha = heightIJ(i, j), hb = heightIJ(i + 1, j);
      const hAt = (t) => ha + (hb - ha) * ease(t);
      const target = isLombard(i, j, 'EW') ? brick : road;
      target.grid(T.length, 2, (r, c) => {
        const x = xa + T[r] * RAMP;
        const zz = z - ROAD_HALF + c * 2 * ROAD_HALF;
        return target === brick ? [x, hAt(T[r]), zz, zz / 6, x / 6] : [x, hAt(T[r]), zz, c, x / 15];
      }, true);
      for (const s of [-1, 1]) {
        const zin = z + s * ROAD_HALF, zout = z + s * STRIP;
        walk.grid(T.length, 2, (r, c) => {
          const x = xa + T[r] * RAMP;
          const zz = s < 0 ? (c === 0 ? zout : zin) : (c === 0 ? zin : zout);
          return [x, hAt(T[r]) + CURB, zz, (Math.abs(zz - z) - ROAD_HALF) / 4.5, x / 4.5];
        }, true);
        curb.grid(T.length, 2, (r, c) => {
          const x = xa + T[r] * RAMP;
          const y = hAt(T[r]) + (c === 0 ? 0 : CURB);
          return [x, y, zin, c * 0.1, x / 4];
        }, s > 0);
      }
    }
  }

  // --- Intersections
  for (let i = NET.iMin; i <= NET.iMax; i++) {
    for (let j = NET.jMin; j <= NET.jMax; j++) {
      const x = lineX(i), z = lineZ(j), h = heightIJ(i, j);
      const uvI = (px, pz) => [(px - x + STRIP) / (2 * STRIP), (pz - z + STRIP) / (2 * STRIP)];
      const quad = (mb, x0, z0, x1, z1, y, uvf) => {
        const p = [[x0, z0], [x0, z1], [x1, z1], [x1, z0]];
        const ids = p.map(([px, pz]) => {
          const [u, v] = uvf(px, pz);
          return mb.v(px, y, pz, u, v);
        });
        // (x0,z0),(x0,z1),(x1,z1),(x1,z0) is CCW from +Y
        mb.q(ids[0], ids[1], ids[2], ids[3]);
      };
      const R = ROAD_HALF;
      // cross shape: center + 4 arms
      quad(inter, x - R, z - R, x + R, z + R, h, uvI);
      quad(inter, x - R, z - STRIP, x + R, z - R, h, uvI);
      quad(inter, x - R, z + R, x + R, z + STRIP, h, uvI);
      quad(inter, x - STRIP, z - R, x - R, z + R, h, uvI);
      quad(inter, x + R, z - R, x + STRIP, z + R, h, uvI);
      // raised corners
      const uvW = (px, pz) => [px / 4.5, pz / 4.5];
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const ax = x + sx * R, bx = x + sx * STRIP;
          const az = z + sz * R, bz = z + sz * STRIP;
          quad(walk, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), h + CURB, uvW);
          // curb faces: facing the N-S arm (x = ax, normal toward -sx) and facing the E-W arm (z = az)
          vertQuad(curb, ax, Math.min(az, bz), ax, Math.max(az, bz), h, h + CURB, -sx, 'x');
          vertQuad(curb, Math.min(ax, bx), az, Math.max(ax, bx), az, h, h + CURB, -sz, 'z');
        }
      if (i === CABLE_CAR_LINE && j <= N) addRails(rails, 'NS', x, z - STRIP, z + STRIP, () => h);
    }
  }

  const meshes = [];
  const add = (mb, mat, name, shadow = true) => {
    const g = mb.build();
    if (!g) return;
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.receiveShadow = shadow;
    m.castShadow = false;
    meshes.push(m);
  };
  add(road, mats.road, 'roads');
  add(brick, mats.brickRoad, 'lombard');
  add(inter, mats.intersection, 'intersections');
  add(walk, mats.sidewalk, 'sidewalks');
  add(curb, mats.curb, 'curbs');
  add(rails, mats.rail, 'rails');
  return meshes;
}

// Vertical quad helper with a chosen facing sign along an axis.
function vertQuad(mb, x0, z0, x1, z1, y0, y1, facing, axis) {
  // vertices bottom a, bottom b, top b, top a
  let a0, b0;
  if (axis === 'x') {
    // wall at constant x, spanning z; facing ±x
    a0 = facing > 0 ? [x0, z1] : [x0, z0];
    b0 = facing > 0 ? [x0, z0] : [x0, z1];
  } else {
    a0 = facing > 0 ? [x0, z0] : [x1, z0];
    b0 = facing > 0 ? [x1, z0] : [x0, z0];
  }
  const ia = mb.v(a0[0], y0, a0[1], 0, 0);
  const ib = mb.v(b0[0], y0, b0[1], 1, 0);
  const ic = mb.v(b0[0], y1, b0[1], 1, 0.1);
  const id = mb.v(a0[0], y1, a0[1], 0, 0.1);
  mb.q(ia, ib, ic, id);
}

// Cable car rails: two tracks (one per direction) in the inner lanes.
function addRails(mb, dir, c, a, b, hAt) {
  const tracks = [-1.85, 1.85];
  const gauge = 0.535; // cable car wheels sit at ±0.53 m (3 ft 6 in gauge)
  const w = 0.09, lift = 0.025;
  const steps = 10;
  for (const tc of tracks) {
    for (const off of [-gauge, 0, gauge]) {
      const isSlot = off === 0;
      const ww = isSlot ? 0.05 : w;
      const base = mb.n;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const along = a + (b - a) * t;
        const y = hAt(t) + (isSlot ? 0.008 : lift);
        if (dir === 'NS') {
          mb.v(c + tc + off - ww, y, along, 0, 0);
          mb.v(c + tc + off + ww, y, along, 1, 0);
        } else {
          mb.v(along, y, c + tc + off - ww, 0, 0);
          mb.v(along, y, c + tc + off + ww, 1, 0);
        }
      }
      for (let k = 0; k < steps; k++) {
        const p = base + k * 2;
        // CCW from above for NS: (x-,z0),(x-,z1),(x+,z1),(x+,z0)
        mb.q(p, p + 2, p + 3, p + 1);
      }
    }
  }
}
