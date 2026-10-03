// Static collision world: axis-aligned boxes and circles in a uniform spatial hash.
// Also hosts "soft" zones (hedges, flower beds) the car can plow through.

const CELL = 16;

export class StaticWorld {
  constructor() {
    this.cells = new Map();
    this.items = [];
    this._stamp = 0;
    this._out = [];
  }

  _key(cx, cz) {
    return (cx + 1000) * 4096 + (cz + 1000);
  }

  _insert(item, x0, z0, x1, z1) {
    const c0 = Math.floor(x0 / CELL), c1 = Math.floor(x1 / CELL);
    const r0 = Math.floor(z0 / CELL), r1 = Math.floor(z1 / CELL);
    for (let cx = c0; cx <= c1; cx++)
      for (let cz = r0; cz <= r1; cz++) {
        const k = this._key(cx, cz);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(item);
      }
  }

  // kind: 'building' | 'prop' | 'wall' | 'tree' | 'soft' ... ; data: anything (breakable ref)
  addBox(x0, z0, x1, z1, y0 = -100, y1 = 400, kind = 'building', data = null) {
    const item = { type: 0, x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), y0, y1, kind, data, stamp: 0, alive: true };
    this.items.push(item);
    this._insert(item, item.x0, item.z0, item.x1, item.z1);
    return item;
  }

  addCircle(x, z, r, y0 = -100, y1 = 400, kind = 'prop', data = null) {
    const item = { type: 1, x, z, r, y0, y1, kind, data, stamp: 0, alive: true };
    this.items.push(item);
    this._insert(item, x - r, z - r, x + r, z + r);
    return item;
  }

  // Candidates overlapping the circle (x,z,r). Returned array is reused — copy if needed.
  query(x, z, r) {
    const out = this._out;
    out.length = 0;
    const stamp = ++this._stamp;
    const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL);
    const r0 = Math.floor((z - r) / CELL), r1 = Math.floor((z + r) / CELL);
    for (let cx = c0; cx <= c1; cx++)
      for (let cz = r0; cz <= r1; cz++) {
        const arr = this.cells.get(this._key(cx, cz));
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const it = arr[k];
          if (it.stamp === stamp || !it.alive) continue;
          it.stamp = stamp;
          out.push(it);
        }
      }
    return out;
  }

  // Circle vs item penetration. Returns null or {nx, nz, depth}
  static resolveCircle(it, x, z, r, res) {
    if (it.type === 0) {
      const cx = x < it.x0 ? it.x0 : x > it.x1 ? it.x1 : x;
      const cz = z < it.z0 ? it.z0 : z > it.z1 ? it.z1 : z;
      let dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > r * r) return null;
      if (d2 < 1e-8) {
        // center inside box: push out along the smallest axis
        const l = x - it.x0, rr = it.x1 - x, t = z - it.z0, b = it.z1 - z;
        const m = Math.min(l, rr, t, b);
        if (m === l) { res.nx = -1; res.nz = 0; res.depth = l + r; }
        else if (m === rr) { res.nx = 1; res.nz = 0; res.depth = rr + r; }
        else if (m === t) { res.nx = 0; res.nz = -1; res.depth = t + r; }
        else { res.nx = 0; res.nz = 1; res.depth = b + r; }
        return res;
      }
      const d = Math.sqrt(d2);
      res.nx = dx / d; res.nz = dz / d; res.depth = r - d;
      return res;
    }
    const dx = x - it.x, dz = z - it.z;
    const rr = r + it.r;
    const d2 = dx * dx + dz * dz;
    if (d2 > rr * rr) return null;
    const d = Math.sqrt(d2) || 1e-4;
    res.nx = dx / d; res.nz = dz / d; res.depth = rr - d;
    return res;
  }

  // Ray march (2D) for camera occlusion: returns fraction [0..1] of the first building hit.
  raycast2D(x0, z0, x1, z1, y, kinds = ['building', 'wall']) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return 1;
    const steps = Math.ceil(len / 1.0);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const px = x0 + dx * t, pz = z0 + dz * t;
      const cands = this.query(px, pz, 0.2);
      for (const it of cands) {
        if (!kinds.includes(it.kind)) continue;
        if (y < it.y0 || y > it.y1) continue;
        if (it.type === 0 && px >= it.x0 && px <= it.x1 && pz >= it.z0 && pz <= it.z1) return Math.max(0, (s - 1) / steps);
      }
    }
    return 1;
  }
}
