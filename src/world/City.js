// City orchestrator: builds roads, blocks (buildings / parks / landmark plazas), waterfront,
// piers, outer decorative ring and boundary walls; collects prop spots + collision.
import * as THREE from 'three';
import * as L from './CityLayout.js';
import { buildRoads, NET } from './Roads.js';
import { buildBlock, C } from './Buildings.js';
import { FacadeBuilder } from './FacadeBuilder.js';
import { FACADE } from './BuildingMaterial.js';
import { MeshBuilder } from './MeshBuilder.js';
import { StaticWorld } from './Collision.js';
import { getMaterials } from './Materials.js';
import { mulberry32, range, pick } from '../core/math.js';

const CHUNK = 2; // blocks per chunk side
const LOD_DIST = 360;

export class City {
  constructor(renderer) {
    this.group = new THREE.Group();
    this.group.name = 'city';
    this.mats = getMaterials(renderer);
    this.collision = new StaticWorld();
    this.spots = {
      lights: [], trees: [], palms: [], hydrants: [], meters: [], trash: [], news: [], mailboxes: [],
      benches: [], signals: [], cones: [], barriers: [], parkTrees: [], hedges: [], flowers: [], lanterns: [],
      pilings: [], bollards: [],
    };
    this.landmarkSlots = [];
    this.chunks = [];
    this.rng = mulberry32(2024);
  }

  build() {
    for (const m of buildRoads(this.mats)) this.group.add(m);
    this.buildBlocks();
    this.buildOuterRing();
    this.buildWaterfront();
    this.buildBoundary();
    this.buildStreetSpots();
    this.buildLombard();
    this.buildChinatown();
    return this;
  }

  // ------------------------------------------------------------------ blocks
  buildBlocks() {
    const nC = Math.ceil(L.N / CHUNK);
    for (let ci = 0; ci < nC; ci++)
      for (let cj = 0; cj < nC; cj++) {
        const fb = new FacadeBuilder();
        const lb = new FacadeBuilder();
        for (let i = ci * CHUNK; i < Math.min(L.N, (ci + 1) * CHUNK); i++)
          for (let j = cj * CHUNK; j < Math.min(L.N, (cj + 1) * CHUNK); j++) {
            const b = L.BLOCKS[i][j];
            this.buildOneBlock(b, fb, lb);
          }
        const cx = L.lineX(ci * CHUNK) + (CHUNK * L.S) / 2, cz = L.lineZ(cj * CHUNK) + (CHUNK * L.S) / 2;
        const gd = fb.build(), gl = lb.build();
        const chunk = { cx, cz, detail: null, lod: null };
        if (gd) {
          chunk.detail = new THREE.Mesh(gd, this.mats.facade);
          chunk.detail.castShadow = chunk.detail.receiveShadow = true;
          this.group.add(chunk.detail);
        }
        if (gl) {
          chunk.lod = new THREE.Mesh(gl, this.mats.facade);
          chunk.lod.castShadow = true;
          chunk.lod.receiveShadow = true;
          chunk.lod.visible = false;
          this.group.add(chunk.lod);
        }
        this.chunks.push(chunk);
      }
  }

  buildOneBlock(b, fb, lb) {
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const cy = L.blockHeight(b.i, b.j, 0.5, 0.5);
    if (b.park) {
      this.buildPark(b);
      if (b.landmark) this.addLandmark(b.landmark, cx, cz, landmarkRot(b.landmark), b);
      return;
    }
    if (b.landmark) {
      switch (b.landmark) {
        case 'ghirardelli': {
          const res = buildBlock({ ...b, district: 'wharf' }, { fb, lb });
          b.maxH = res.maxH + 8;
          this.collision.addBox(b.x0, b.z0, b.x1, b.z1, -50, 400, 'building');
          this.addLandmark('ghirardelli', cx, b.z0 + 8, Math.PI, b, { y: res.maxH });
          return;
        }
        case 'church': {
          const lots = [
            { side: 'W', ox: b.x0, oz: cz, rot: -Math.PI / 2, w: b.z1 - b.z0, d: 11 },
            { side: 'E', ox: b.x1, oz: cz, rot: Math.PI / 2, w: b.z1 - b.z0, d: 11 },
          ];
          buildBlock({ ...b, district: 'northbeach' }, { fb, lb, lots });
          this.collision.addBox(b.x0, b.z0, b.x0 + 11, b.z1, -50, 400, 'building');
          this.collision.addBox(b.x1 - 11, b.z0, b.x1, b.z1, -50, 400, 'building');
          this.plaza(b, this.mats.pavers);
          this.addLandmark('church', cx, b.z1 - 26, 0, b);
          return;
        }
        default:
          this.plaza(b, this.mats.pavers);
          this.addLandmark(b.landmark, cx, cz, landmarkRot(b.landmark), b);
          // plaza trees around the landmark
          for (const [u, v] of [[0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92], [0.5, 0.06], [0.5, 0.94], [0.06, 0.5], [0.94, 0.5]]) {
            const x = b.x0 + u * (b.x1 - b.x0), z = b.z0 + v * (b.z1 - b.z0);
            this.spots.parkTrees.push({ x, z, y: L.groundHeight(x, z), s: 0.8 + this.rng() * 0.3, kind: 'round' });
          }
          return;
      }
    }
    const res = buildBlock(b, { fb, lb });
    b.maxH = res.maxH;
    this.collision.addBox(b.x0, b.z0, b.x1, b.z1, -50, 400, 'building');
    void cy;
  }

  addLandmark(key, x, z, rot, block, extra = {}) {
    const y = extra.y ?? L.groundHeight(x, z);
    const heights = { transamerica: 205, salesforce: 236, coit: 70, church: 62, cityhall: 80, palace: 38 };
    if (block && heights[key]) block.maxH = Math.max(block.maxH || 0, y + heights[key]);
    this.landmarkSlots.push({ key, x, y, z, rot, block });
  }

  plaza(b, mat) {
    const mb = new MeshBuilder();
    const n = 8;
    mb.grid(n + 1, n + 1, (r, c) => {
      const u = c / n, v = r / n;
      const x = b.x0 + u * (b.x1 - b.x0), z = b.z0 + v * (b.z1 - b.z0);
      return [x, L.blockHeight(b.i, b.j, u, v), z, x / 6, z / 6];
    });
    const m = new THREE.Mesh(mb.build(), mat);
    m.receiveShadow = true;
    this.group.add(m);
  }

  buildPark(b) {
    const rng = mulberry32(b.i * 31 + b.j * 977);
    const paved = b.park === 'plaza';
    this.plaza(b, paved ? this.mats.pavers : this.mats.grass);
    const W = b.x1 - b.x0, D = b.z1 - b.z0;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    // footpaths (diagonals + cross) for grass parks
    if (!paved) {
      const mb = new MeshBuilder();
      const path = (x0, z0, x1, z1, w) => {
        const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
        const nx = -dz / len * w / 2, nz = dx / len * w / 2;
        const steps = Math.ceil(len / 4);
        const base = mb.n;
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const px = x0 + dx * t, pz = z0 + dz * t;
          for (const sgn of [-1, 1]) {
            const qx = px + nx * sgn, qz = pz + nz * sgn;
            mb.v(qx, L.groundHeight(qx, qz) + 0.04, qz, qx / 6, qz / 6);
          }
        }
        for (let s = 0; s < steps; s++) {
          const p = base + s * 2;
          // orientation chosen so normal points up for either direction
          const ax = mb.pos[p * 3], az = mb.pos[p * 3 + 2];
          const bx = mb.pos[(p + 1) * 3], bz = mb.pos[(p + 1) * 3 + 2];
          const cx2 = mb.pos[(p + 2) * 3], cz2 = mb.pos[(p + 2) * 3 + 2];
          const cross = (bx - ax) * (cz2 - az) - (bz - az) * (cx2 - ax);
          if (cross < 0) mb.q(p, p + 1, p + 3, p + 2); else mb.q(p, p + 2, p + 3, p + 1);
        }
      };
      path(b.x0 + 1, b.z0 + 1, b.x1 - 1, b.z1 - 1, 2.6);
      path(b.x1 - 1, b.z0 + 1, b.x0 + 1, b.z1 - 1, 2.6);
      path(cx, b.z0, cx, b.z1, 2.2);
      const m = new THREE.Mesh(mb.build(), this.mats.pavers);
      m.receiveShadow = true;
      this.group.add(m);
    }
    // trees
    const nT = paved ? 10 : b.park === 'lagoon' ? 8 : 22;
    for (let k = 0; k < nT; k++) {
      let x, z, ok = false;
      for (let tr = 0; tr < 20 && !ok; tr++) {
        if (paved) {
          const a = (k / nT) * Math.PI * 2;
          x = cx + Math.cos(a) * W * 0.4; z = cz + Math.sin(a) * D * 0.4;
          ok = true;
        } else {
          x = range(rng, b.x0 + 3, b.x1 - 3); z = range(rng, b.z0 + 3, b.z1 - 3);
          // keep paths and the center clear
          const dDiag1 = Math.abs((x - b.x0) / W - (z - b.z0) / D) * W;
          const dDiag2 = Math.abs((x - b.x0) / W - (1 - (z - b.z0) / D)) * W;
          const dCenter = Math.hypot(x - cx, z - cz);
          ok = dDiag1 > 4 && dDiag2 > 4 && Math.abs(x - cx) > 3.5 && dCenter > (b.landmark ? 20 : 8);
        }
      }
      if (!ok) continue;
      const palm = paved && b.name === 'Union Square';
      const s = 0.85 + rng() * 0.5;
      const spot = { x, z, y: L.groundHeight(x, z), s, kind: palm ? 'palm' : rng() < 0.3 ? 'cypress' : 'round' };
      (palm ? this.spots.palms : this.spots.parkTrees).push(spot);
    }
    // benches along paths
    for (let k = 0; k < 6; k++) {
      const x = range(rng, b.x0 + 6, b.x1 - 6), z = range(rng, b.z0 + 6, b.z1 - 6);
      this.spots.benches.push({ x, z, y: L.groundHeight(x, z), rot: rng() * Math.PI * 2 });
    }
    if (b.monument) {
      // Dewey Monument: tall column with Victory statue
      this.landmarkSlots.push({ key: 'monument', x: cx, y: L.groundHeight(cx, cz), z: cz, rot: 0, block: b });
      this.collision.addCircle(cx, cz, 2.6, -10, 60, 'building');
    }
    if (b.fountain) {
      this.landmarkSlots.push({ key: 'fountain', x: cx, y: L.groundHeight(cx, cz), z: cz, rot: 0, block: b });
      this.collision.addCircle(cx, cz, 4.2, -10, 3, 'building');
    }
    if (b.park === 'lagoon') {
      // lagoon on the north half; the palace sits mid-block
      this.landmarkSlots.push({ key: 'lagoon', x: cx - 10, y: L.groundHeight(cx - 10, cz + 12) - 0.1, z: cz + 14, rot: 0, block: b });
    }
  }

  // ------------------------------------------------------------- outer ring
  buildOuterRing() {
    const fb = new FacadeBuilder();
    const lb = new FacadeBuilder(); // unused detail for ring; we use only LOD-level boxes
    const blocks = [];
    for (let j = 0; j <= L.N + 1; j++) for (const i of [-2, -1]) blocks.push([i, j]);
    for (let i = 0; i < L.N; i++) for (const j of [L.N, L.N + 1]) blocks.push([i, j]);
    for (const [i, j] of blocks) {
      const b = {
        i, j,
        district: j >= L.N && i >= 6 ? 'soma' : j >= L.N && i >= 3 ? 'civic' : 'residential',
        x0: L.lineX(i) + L.STRIP, x1: L.lineX(i + 1) - L.STRIP,
        z0: L.lineZ(j) + L.STRIP, z1: L.lineZ(j + 1) - L.STRIP,
      };
      // use the generator but only keep the low-detail builder output
      buildBlock(b, { fb: lb, lb: fb });
    }
    const g = fb.build();
    if (g) {
      const m = new THREE.Mesh(g, this.mats.facade);
      m.castShadow = true;
      m.receiveShadow = true;
      m.name = 'outer-ring';
      this.group.add(m);
    }
  }

  // ------------------------------------------------------------- waterfront
  buildWaterfront() {
    const M = this.mats;
    const top = L.PIER_H;
    // promenades (north + east)
    const prom = new MeshBuilder();
    const rect = (mb, x0, z0, x1, z1, y, s = 6) => {
      const a = mb.v(x0, y, z0, x0 / s, z0 / s), b = mb.v(x0, y, z1, x0 / s, z1 / s);
      const c = mb.v(x1, y, z1, x1 / s, z1 / s), d = mb.v(x1, y, z0, x1 / s, z0 / s);
      mb.q(a, b, c, d);
    };
    rect(prom, -700, -L.SEAWALL, L.SEAWALL, L.CITY_MIN, top);
    rect(prom, L.CITY_MAX, L.CITY_MIN, L.SEAWALL, L.CITY_MAX + 30, top);
    const pm = new THREE.Mesh(prom.build(), M.promenade);
    pm.receiveShadow = true;
    this.group.add(pm);

    // seawall faces
    const wall = new MeshBuilder();
    const vwall = (x0, z0, x1, z1) => {
      // outward normal (-dz, dx)
      const a = wall.v(x0, L.SEABED, z0, 0, 0), b = wall.v(x1, L.SEABED, z1, 1, 0);
      const c = wall.v(x1, top, z1, 1, 1), d = wall.v(x0, top, z0, 0, 1);
      wall.q(a, b, c, d);
    };
    vwall(L.SEAWALL, -L.SEAWALL, -700, -L.SEAWALL); // north face (normal -z): A→B going -x
    vwall(L.SEAWALL, L.CITY_MAX + 30, L.SEAWALL, -L.SEAWALL); // east face (normal +x): going -z
    // piers
    const deck = new MeshBuilder();
    for (const p of L.PIERS) {
      rect(deck, p.x0, p.z0, p.x1, p.z1, top + 0.01, 8);
      const th = 1.2;
      // side skirts
      const sk = (x0, z0, x1, z1) => {
        const a = wall.v(x0, top - th, z0, 0, 0), b = wall.v(x1, top - th, z1, 1, 0);
        const c = wall.v(x1, top, z1, 1, 1), d = wall.v(x0, top, z0, 0, 1);
        wall.q(a, b, c, d);
      };
      sk(p.x0, p.z0, p.x0, p.z1); // west face: A→B +z → normal -x
      sk(p.x0, p.z1, p.x1, p.z1); // south
      sk(p.x1, p.z1, p.x1, p.z0); // east
      sk(p.x1, p.z0, p.x0, p.z0); // north
      // pilings
      for (let x = p.x0 + 2; x <= p.x1 - 2; x += 8)
        for (let z = p.z0 + 2; z <= p.z1 - 2; z += 8) this.spots.pilings.push({ x, z });
      // bollards along pier edges
      const edgeStep = 9;
      if (p.z1 === -L.SEAWALL) {
        for (let z = p.z0 + 3; z < p.z1 - 4; z += edgeStep) {
          this.spots.bollards.push({ x: p.x0 + 0.6, z, y: top }, { x: p.x1 - 0.6, z, y: top });
        }
      }
    }
    const dm = new THREE.Mesh(deck.build(), M.wood);
    dm.receiveShadow = true;
    this.group.add(dm);
    const wm = new THREE.Mesh(wall.build(), M.seawall);
    wm.receiveShadow = true;
    this.group.add(wm);

    // waterfront sheds on piers
    const fb = new FacadeBuilder();
    const shed = (x0, z0, x1, z1, h, wallHex, trimHex, style = FACADE.STONE) => {
      fb.setTransform(0, 0, 0);
      fb.vOrigin = top;
      fb.set({ wall: C(wallHex), trim: C(trimHex), style, spacing: 4.5, floorH: 5.5, seed: Math.random() });
      fb.box(x0, top - 1, z0, x1, top + h, z1, { roof: { wall: C('#5f6b72'), style: FACADE.ROOF } });
      this.collision.addBox(x0, z0, x1, z1, top - 2, top + h, 'building');
    };
    // Pier 3 & Pier 1 sheds (leave a drive lane along the north edge)
    shed(530, -300, 636, -268, 12, '#e3d8c3', '#4f6a5a');
    shed(530, 160, 606, 196, 11, '#e7dcc8', '#5b4a3a');
    // Pier 39 shops (two rows with a central drive lane)
    const shopColors = ['#c89f73', '#a5794f', '#b88a5e', '#d1ab80', '#9fb7c4', '#d8c39a'];
    const awnCols = [['#c0392b', '#ffffff'], ['#1f3a93', '#ffffff'], ['#117864', '#f7f7f7'], ['#d35400', '#fdebd0']];
    const pierShop = (x0, z0, x1, z1, facing) => {
      shed(x0, z0, x1, z1, 7.5, pick(this.rng, shopColors), '#f3efe6', FACADE.STONE);
      // striped awning toward the boardwalk
      const aw = pick(this.rng, awnCols);
      const cx = facing > 0 ? x1 : x0;
      fb.setTransform(cx, (z0 + z1) / 2, facing > 0 ? Math.PI / 2 : -Math.PI / 2);
      fb.vOrigin = top;
      fb.awning(-(z1 - z0) / 2 + 0.6, (z1 - z0) / 2 - 0.6, 0, 1.8, top + 3.6, 1.0, { wall: C(aw[0]), trim: C(aw[1]), style: FACADE.STRIPES, spacing: 0.9, floorH: 1, seed: 0.3 });
      fb.setTransform(0, 0, 0);
    };
    for (let z = -640; z < -540; z += 16) {
      pierShop(269, z, 284, z + 13, 1);
      if (z + 13 < -566) pierShop(316, z, 331, z + 13, -1);
    }
    // Pier 45 fish warehouses
    shed(24, -598, 38, -560, 8, '#d9d2c3', '#2e5a74', FACADE.BRICK);
    const g = fb.build();
    if (g) {
      const sm = new THREE.Mesh(g, M.facade);
      sm.castShadow = sm.receiveShadow = true;
      this.group.add(sm);
    }
    // landmark slots on the waterfront
    this.landmarkSlots.push({ key: 'ferry', x: 527, y: top, z: 432, rot: -Math.PI / 2 });
    this.collision.addBox(511, 367, 543, 497, -10, 100, 'building');
    // Pier 39 entrance building on the east side, facing the central drive lane
    this.landmarkSlots.push({ key: 'pier39', x: 322, y: top, z: -541, rot: -Math.PI / 2 });
    this.landmarkSlots.push({ key: 'wharfsign', x: 40, y: top, z: -503, rot: 0 });
    this.collision.addCircle(40, -503, 1.2, -10, 20, 'building');
    this.landmarkSlots.push({ key: 'balclutha', x: -116, y: 0, z: -610, rot: 0 });
    this.landmarkSlots.push({ key: 'sealions', x: 250, y: 0, z: -585, rot: 0 });
    this.landmarkSlots.push({ key: 'sealions', x: 245, y: 0, z: -615, rot: 0.4 });
    // promenade palms and lamps
    for (let x = -480; x <= 470; x += 24) {
      this.spots.palms.push({ x, z: -501, y: top, s: 0.9 + this.rng() * 0.3 });
    }
    for (let z = -470; z <= 480; z += 24) {
      if (z > 360 && z < 500) continue;
      this.spots.palms.push({ x: 501, z, y: top, s: 0.9 + this.rng() * 0.3 });
    }
  }

  // ------------------------------------------------------------- boundary
  buildBoundary() {
    const cw = this.collision;
    cw.addBox(-496, -520, L.CITY_MIN, L.CITY_MAX + 2, -50, 400, 'wall');
    cw.addBox(-496, L.CITY_MAX, L.CITY_MAX, L.CITY_MAX + 4, -50, 400, 'wall');
    cw.addBox(L.CITY_MAX, L.CITY_MAX + 30, 570, L.CITY_MAX + 34, -50, 400, 'wall');
    // barricades where streets leave the playable area
    for (let j = 0; j <= L.N; j++) {
      const z = L.lineZ(j);
      for (let k = -2; k <= 2; k++) this.spots.barriers.push({ x: L.CITY_MIN - 1.2, z: z + k * 3.2, y: L.groundHeight(L.CITY_MIN + 1, z), rot: Math.PI / 2 });
      for (let k = 0; k < 4; k++) this.spots.cones.push({ x: L.CITY_MIN + 1.5 + this.rng() * 2, z: z + (this.rng() - 0.5) * 12, y: L.groundHeight(L.CITY_MIN + 2, z) });
    }
    for (let i = 0; i <= L.N; i++) {
      const x = L.lineX(i);
      for (let k = -2; k <= 2; k++) this.spots.barriers.push({ x: x + k * 3.2, z: L.CITY_MAX + 1.2, y: L.groundHeight(x, L.CITY_MAX - 1), rot: 0 });
      for (let k = 0; k < 4; k++) this.spots.cones.push({ x: x + (this.rng() - 0.5) * 12, z: L.CITY_MAX - 1.5 - this.rng() * 2, y: L.groundHeight(x, L.CITY_MAX - 2) });
    }
  }

  // ------------------------------------------------------------- street furniture
  buildStreetSpots() {
    const rng = this.rng;
    const S = this.spots;
    const H = L.ROAD_HALF;
    const districtAt = (x, z) => {
      const b = L.getBlock(Math.floor((x - L.ORIGIN) / L.S), Math.floor((z - L.ORIGIN) / L.S));
      return b ? b.district : 'residential';
    };
    const commercial = (d) => d === 'northbeach' || d === 'chinatown' || d === 'unionsq' || d === 'fidi' || d === 'soma' || d === 'wharf' || d === 'civic' || d === 'nobhill';
    const palmStreet = (dir, line) => (dir === 'NS' && line === L.N) || (dir === 'EW' && (line === L.N || line === 0));
    // N-S segments
    const segs = [];
    for (let i = 0; i <= L.N; i++) for (let j = 0; j < L.N; j++) segs.push({ dir: 'NS', line: i, seg: j });
    for (let j = 0; j <= L.N; j++) for (let i = 0; i < L.N; i++) segs.push({ dir: 'EW', line: j, seg: i });
    for (const sg of segs) {
      const isLombard = sg.dir === 'EW' && sg.line === L.LOMBARD.j && sg.seg === L.LOMBARD.i0;
      for (const side of [-1, 1]) {
        // skip the water side of waterfront roads and outer sides of boundary roads
        if (sg.dir === 'EW' && sg.line === 0 && side < 0) continue;
        if (sg.dir === 'NS' && sg.line === L.N && side > 0) continue;
        if (sg.dir === 'NS' && sg.line === 0 && side < 0) continue;
        if (sg.dir === 'EW' && sg.line === L.N && side > 0) continue;
        const at = (t, off) => {
          const along = (sg.dir === 'NS' ? L.lineZ(sg.seg) : L.lineX(sg.seg)) + L.STRIP + t * L.RAMP;
          const c = sg.dir === 'NS' ? L.lineX(sg.line) : L.lineZ(sg.line);
          const x = sg.dir === 'NS' ? c + side * off : along;
          const z = sg.dir === 'NS' ? along : c + side * off;
          // facing toward the road
          const rot = sg.dir === 'NS' ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : (side > 0 ? Math.PI : 0);
          return { x, z, y: L.groundHeight(x, z), rot };
        };
        const midX = sg.dir === 'NS' ? L.lineX(sg.line) + side * 10 : L.lineX(sg.seg) + L.S / 2;
        const midZ = sg.dir === 'NS' ? L.lineZ(sg.seg) + L.S / 2 : L.lineZ(sg.line) + side * 10;
        const dist = districtAt(midX, midZ);
        const com = commercial(dist);
        // street lights (staggered)
        for (const t of side > 0 ? [0.1, 0.62] : [0.36, 0.9]) S.lights.push(at(t, H + 0.55));
        if (isLombard) continue;
        // trees / palms
        if (palmStreet(sg.dir, sg.line)) {
          for (const t of [0.22, 0.5, 0.78]) S.palms.push({ ...at(t, H + 1.4), s: 0.9 + rng() * 0.25 });
        } else if (!com && dist !== 'marina' ? rng() < 0.65 : rng() < 0.25) {
          for (let t = 0.12 + rng() * 0.08; t < 0.92; t += 0.17 + rng() * 0.1) {
            if (Math.abs(t - 0.36) < 0.05 || Math.abs(t - 0.62) < 0.05) continue;
            S.trees.push({ ...at(t, H + 1.3), s: 0.75 + rng() * 0.45 });
          }
        }
        // parking meters in commercial districts
        if (com && rng() < 0.6) for (let t = 0.2; t < 0.85; t += 0.11) S.meters.push(at(t, H + 0.45));
        // corner furniture
        if (rng() < 0.5) S.hydrants.push(at(0.04 + rng() * 0.05, H + 0.6));
        if (rng() < 0.45) S.trash.push(at(0.94 + rng() * 0.03, H + 1.0));
        if (com && rng() < 0.55) {
          const p = at(0.9, H + 2.6);
          S.news.push(p);
        }
        if (rng() < 0.12) S.mailboxes.push(at(0.08 + rng() * 0.1, H + 1.4));
        if (rng() < 0.14) S.benches.push({ ...at(0.5, H + 2.9), rot: at(0.5, 0).rot + Math.PI });
      }
    }
    // traffic signals at all playable intersections (4 corners)
    for (let i = 0; i <= L.N; i++)
      for (let j = 0; j <= L.N; j++) {
        const x = L.lineX(i), z = L.lineZ(j), y = L.H[i][j] + L.CURB;
        for (const [sx, sz] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          // skip corners over the water / outside
          if (j === 0 && sz < 0) continue;
          if (i === L.N && sx > 0) continue;
          const px = x + sx * (H + 0.8), pz = z + sz * (H + 0.8);
          // each pole holds a head for traffic arriving on the road its arm reaches over
          S.signals.push({ x: px, z: pz, y, i, j, sx, sz });
        }
      }
  }

  // ------------------------------------------------------------- Lombard St
  buildLombard() {
    const j = L.LOMBARD.j;
    const z = L.lineZ(j);
    const xa = L.lineX(L.LOMBARD.i0) + L.STRIP, xb = L.lineX(L.LOMBARD.i1) - L.STRIP;
    const n = 7;
    const step = (xb - xa) / (n + 1);
    for (let k = 1; k <= n; k++) {
      const x = xa + k * step;
      const fromNorth = k % 2 === 0;
      const z0 = fromNorth ? z - L.ROAD_HALF : z - L.ROAD_HALF + 5.5;
      const z1 = fromNorth ? z + L.ROAD_HALF - 5.5 : z + L.ROAD_HALF;
      this.spots.hedges.push({ x0: x - 0.9, x1: x + 0.9, z0, z1 });
      this.collision.addBox(x - 0.9, z0, x + 0.9, z1, -50, 400, 'soft');
      // flowers along the hedge
      for (let f = z0 + 0.5; f < z1; f += 0.9) {
        for (const off of [-1.4, 1.4]) this.spots.flowers.push({ x: x + off * 0.7, z: f, y: L.groundHeight(x + off * 0.7, f) });
      }
    }
  }

  // ------------------------------------------------------------- Chinatown
  buildChinatown() {
    const { i, j0, j1 } = L.CHINATOWN_GRANT;
    const x = L.lineX(i);
    for (let j = j0; j < j1; j++) {
      const za = L.lineZ(j) + L.STRIP + 4, zb = L.lineZ(j + 1) - L.STRIP - 4;
      for (let z = za; z <= zb; z += 9) {
        const y = L.groundHeight(x, z);
        this.spots.lanterns.push({ x0: x - L.STRIP + 0.5, x1: x + L.STRIP - 0.5, z, y: y + 8.5 });
      }
    }
    this.landmarkSlots.push({ key: 'dragongate', x: L.DRAGON_GATE.x, y: L.groundHeight(L.DRAGON_GATE.x, L.DRAGON_GATE.z), z: L.DRAGON_GATE.z, rot: 0 });
  }

  // Tallest structure on the block under (x,z) — keeps cinematic cameras out of buildings
  skylineAt(x, z) {
    const b = L.getBlock(Math.floor((x - L.ORIGIN) / L.S), Math.floor((z - L.ORIGIN) / L.S));
    return b && b.maxH ? b.maxH : L.groundHeight(x, z);
  }

  // ------------------------------------------------------------- per-frame
  update(camPos) {
    for (const c of this.chunks) {
      const d = Math.hypot(camPos.x - c.cx, camPos.z - c.cz);
      const near = d < LOD_DIST;
      if (c.detail) c.detail.visible = near;
      if (c.lod) c.lod.visible = !near;
    }
  }
}

function landmarkRot(key) {
  switch (key) {
    case 'cityhall': return 0; // faces south toward the plaza
    case 'palace': return Math.PI; // faces north to the lagoon
    default: return 0;
  }
}

export { NET };
