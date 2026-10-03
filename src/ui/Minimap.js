// Rotating circular minimap with a pre-rendered city map.
import * as L from '../world/CityLayout.js';

const X0 = -620, Z0 = -760, SIZE = 1400; // map covers [X0, X0+SIZE] x [Z0, Z0+SIZE] at 1px/m

const DISTRICT_COLORS = {
  residential: '#3a3f58', painted: '#4a3f63', marina: '#3f4a5e', northbeach: '#4a4458', chinatown: '#5a3a46',
  nobhill: '#46465c', unionsq: '#4b4664', fidi: '#3a4a66', soma: '#4a3e3e', wharf: '#3e4c58', civic: '#454a5a',
};

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = document.createElement('canvas');
    this.map.width = this.map.height = SIZE;
    this.render();
    this.zoom = 0.62;
  }

  render() {
    const c = this.map.getContext('2d');
    const tx = (x) => x - X0, tz = (z) => z - Z0;
    c.fillStyle = '#123a5c';
    c.fillRect(0, 0, SIZE, SIZE);
    // land (outer)
    c.fillStyle = '#2a2e3d';
    c.fillRect(0, tz(-492), tx(492) + 14, SIZE);
    c.fillRect(0, tz(-506), tx(506), 14);
    // promenades & piers
    c.fillStyle = '#6e6458';
    c.fillRect(tx(-700), tz(-506), 1206, 14);
    c.fillRect(tx(492), tz(-506), 14, 1028);
    c.fillStyle = '#8a6d4c';
    for (const p of L.PIERS) c.fillRect(tx(p.x0), tz(p.z0), p.x1 - p.x0, p.z1 - p.z0);
    // blocks
    for (let i = 0; i < L.N; i++)
      for (let j = 0; j < L.N; j++) {
        const b = L.BLOCKS[i][j];
        c.fillStyle = b.park ? (b.park === 'plaza' ? '#6a6150' : '#2f7d4a') : DISTRICT_COLORS[b.district] || '#3a3f58';
        c.fillRect(tx(b.x0), tz(b.z0), b.x1 - b.x0, b.z1 - b.z0);
        if (b.landmark) {
          c.fillStyle = '#c9a26b';
          c.beginPath();
          c.arc(tx((b.x0 + b.x1) / 2), tz((b.z0 + b.z1) / 2), 7, 0, Math.PI * 2);
          c.fill();
        }
      }
    // roads
    c.fillStyle = '#8f96a8';
    for (let i = 0; i <= L.N; i++) c.fillRect(tx(L.lineX(i) - L.ROAD_HALF), tz(L.CITY_MIN), L.ROAD_HALF * 2, L.CITY_MAX - L.CITY_MIN);
    for (let j = 0; j <= L.N; j++) c.fillRect(tx(L.CITY_MIN), tz(L.lineZ(j) - L.ROAD_HALF), L.CITY_MAX - L.CITY_MIN, L.ROAD_HALF * 2);
    c.fillStyle = '#b8bfcf';
    for (let i = 0; i <= L.N; i++) c.fillRect(tx(L.lineX(i) - 0.6), tz(L.CITY_MIN), 1.2, L.CITY_MAX - L.CITY_MIN);
    for (let j = 0; j <= L.N; j++) c.fillRect(tx(L.CITY_MIN), tz(L.lineZ(j) - 0.6), L.CITY_MAX - L.CITY_MIN, 1.2);
    // Lombard
    c.fillStyle = '#c0574a';
    c.fillRect(tx(L.lineX(5) + L.STRIP), tz(L.lineZ(3) - L.ROAD_HALF), L.RAMP, L.ROAD_HALF * 2);
  }

  draw(player, opts) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const R = W / 2;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 4, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#0d2236';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(R, R + R * 0.25);
    const rot = player.yaw - Math.PI;
    ctx.rotate(rot);
    const z = this.zoom * (W / 240);
    ctx.scale(z, z);
    ctx.translate(-(player.pos.x - X0), -(player.pos.z - Z0));
    ctx.drawImage(this.map, 0, 0);
    const P = (x, zz) => [x - X0, zz - Z0];
    // route line
    if (opts.route && opts.route.length) {
      ctx.strokeStyle = 'rgba(57,255,136,0.95)';
      ctx.lineWidth = 7 / z;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const [sx, sz] = P(player.pos.x, player.pos.z);
      ctx.moveTo(sx, sz);
      for (const p of opts.route) { const [a, b] = P(p.x, p.z); ctx.lineTo(a, b); }
      ctx.stroke();
    }
    // passengers
    for (const w of opts.waiting || []) {
      const [a, b] = P(w.x, w.z);
      ctx.fillStyle = w.tier.css;
      ctx.beginPath();
      ctx.arc(a, b, 8 / z, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2 / z;
      ctx.stroke();
    }
    // destination
    if (opts.dest) {
      const [a, b] = P(opts.dest.x, opts.dest.z);
      ctx.fillStyle = '#39ff88';
      star(ctx, a, b, 15 / z, 7 / z);
      ctx.strokeStyle = '#003b1c';
      ctx.lineWidth = 2.5 / z;
      ctx.stroke();
    }
    // rival
    if (opts.rival) {
      const [a, b] = P(opts.rival.pos.x, opts.rival.pos.z);
      ctx.save();
      ctx.translate(a, b);
      ctx.rotate(-opts.rival.yaw + Math.PI);
      ctx.fillStyle = opts.rivalColor || '#ff5a36';
      ctx.beginPath();
      ctx.moveTo(0, -12 / z); ctx.lineTo(8 / z, 9 / z); ctx.lineTo(-8 / z, 9 / z); ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 / z;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    // player arrow (fixed)
    ctx.save();
    ctx.translate(R, R + R * 0.25);
    ctx.fillStyle = opts.playerColor || '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -13); ctx.lineTo(9, 10); ctx.lineTo(0, 5); ctx.lineTo(-9, 10); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    // ring
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(R, R, R - 3, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function star(ctx, x, y, r1, r2) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? r2 : r1;
    const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}
