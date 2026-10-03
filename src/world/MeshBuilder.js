// Simple indexed geometry accumulator (position/uv/optional color), normals computed at the end.
import * as THREE from 'three';

export class MeshBuilder {
  constructor({ colors = false } = {}) {
    this.pos = [];
    this.uv = [];
    this.col = colors ? [] : null;
    this.idx = [];
    this.n = 0;
    this.color = [1, 1, 1];
  }

  v(x, y, z, u = 0, w = 0) {
    this.pos.push(x, y, z);
    this.uv.push(u, w);
    if (this.col) this.col.push(this.color[0], this.color[1], this.color[2]);
    return this.n++;
  }

  // Quad from four existing vertex indices (CCW from the visible side)
  q(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }

  t(a, b, c) {
    this.idx.push(a, b, c);
  }

  // Regular grid of rows×cols vertices given a sampler(r, c) -> [x,y,z,u,v]; CCW from +Y.
  grid(rows, cols, sampler, flip = false) {
    const base = this.n;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const s = sampler(r, c);
        this.v(s[0], s[1], s[2], s[3], s[4]);
      }
    for (let r = 0; r < rows - 1; r++)
      for (let c = 0; c < cols - 1; c++) {
        const a = base + r * cols + c, b = a + 1, d = a + cols, e = d + 1;
        if (!flip) this.idx.push(a, d, b, b, d, e);
        else this.idx.push(a, b, d, b, e, d);
      }
  }

  build({ computeNormals = true } = {}) {
    if (!this.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    if (computeNormals) g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}
