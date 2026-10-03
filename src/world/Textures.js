// Procedurally painted textures (canvas 2D). No image assets needed.
import * as THREE from 'three';
import { mulberry32, valueNoise2, fbm2 } from '../core/math.js';

let maxAniso = 8;
export function setMaxAnisotropy(a) { maxAniso = a; }

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function finish(c, { srgb = true, repeat = true, aniso = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso ? maxAniso : 1;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// Fill a canvas with tileable noise variation around a base color. The fbm is evaluated
// at quarter resolution and upscaled (fast), then per-pixel grain is added.
function noiseFill(ctx, w, h, base, amount, scale, seed, octaves = 4) {
  const lw = Math.max(32, w >> 2), lh = Math.max(32, h >> 2);
  const lc = canvas(lw, lh);
  const lctx = lc.getContext('2d');
  const low = lctx.createImageData(lw, lh);
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      const n = tileFbm(x / lw, y / lh, scale, seed, octaves);
      const v = (n - 0.5) * 2 * amount;
      const i = (y * lw + x) * 4;
      low.data[i] = clamp255(base[0] * (1 + v));
      low.data[i + 1] = clamp255(base[1] * (1 + v));
      low.data[i + 2] = clamp255(base[2] * (1 + v));
      low.data[i + 3] = 255;
    }
  }
  lctx.putImageData(low, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(lc, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const rng = mulberry32(seed + 7);
  const g = amount * 0.6;
  for (let i = 0; i < d.length; i += 4) {
    const f = 1 + (rng() - 0.5) * g;
    d[i] = clamp255(d[i] * f);
    d[i + 1] = clamp255(d[i + 1] * f);
    d[i + 2] = clamp255(d[i + 2] * f);
  }
  ctx.putImageData(img, 0, 0);
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// Tileable fbm: blend 4 offset samples (cheap periodic trick)
function tileFbm(u, v, scale, seed, octaves) {
  const a = fbm2(u * scale, v * scale, octaves, seed);
  const b = fbm2((u - 1) * scale, v * scale, octaves, seed);
  const c = fbm2(u * scale, (v - 1) * scale, octaves, seed);
  const d = fbm2((u - 1) * scale, (v - 1) * scale, octaves, seed);
  const ab = a * (1 - u) + b * u;
  const cd = c * (1 - u) + d * u;
  return ab * (1 - v) + cd * v;
}

function speckles(ctx, w, h, count, colors, rmin, rmax, seed, alpha = 0.6) {
  const rng = mulberry32(seed);
  for (let k = 0; k < count; k++) {
    ctx.globalAlpha = alpha * (0.4 + rng() * 0.6);
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    const r = rmin + rng() * (rmax - rmin);
    const x = rng() * w, y = rng() * h;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function cracks(ctx, w, h, count, seed, color = 'rgba(10,10,12,0.55)') {
  const rng = mulberry32(seed);
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let k = 0; k < count; k++) {
    let x = rng() * w, y = rng() * h;
    let a = rng() * Math.PI * 2;
    ctx.lineWidth = 0.8 + rng() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 6 + Math.floor(rng() * 16);
    for (let s = 0; s < steps; s++) {
      a += (rng() - 0.5) * 1.2;
      x += Math.cos(a) * (4 + rng() * 10);
      y += Math.sin(a) * (4 + rng() * 10);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// Worn paint: draw a rect, then knock holes into it with noise.
function paint(ctx, x, y, w, h, color, wear = 0.25, seed = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  if (wear <= 0) return;
  const rng = mulberry32(seed);
  const n = Math.floor((w * h) / 60 * wear);
  // scuff by overdrawing asphalt-ish speckles
  ctx.fillStyle = 'rgba(40,42,46,0.55)';
  for (let k = 0; k < n; k++) {
    const r = 0.6 + rng() * 2.2;
    ctx.beginPath();
    ctx.arc(x + rng() * w, y + rng() * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Height-map → normal map
function heightToNormal(hctx, w, h, strength) {
  const src = hctx.getImageData(0, 0, w, h).data;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const out = ctx.createImageData(w, h);
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

function grainHeight(w, seed, scale = 24, contrast = 1, grain = 0.5) {
  const c = canvas(w);
  const ctx = c.getContext('2d');
  const lw = Math.max(32, w >> 2);
  const lc = canvas(lw);
  const lctx = lc.getContext('2d');
  const low = lctx.createImageData(lw, lw);
  for (let y = 0; y < lw; y++)
    for (let x = 0; x < lw; x++) {
      const n = tileFbm(x / lw, y / lw, scale / 4 + 1, seed, 3);
      const v = clamp255((0.5 + (n - 0.5) * 0.8 * contrast) * 255);
      const i = (y * lw + x) * 4;
      low.data[i] = low.data[i + 1] = low.data[i + 2] = v;
      low.data[i + 3] = 255;
    }
  lctx.putImageData(low, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(lc, 0, 0, w, w);
  if (grain > 0) {
    const img = ctx.getImageData(0, 0, w, w);
    const rng = mulberry32(seed + 3);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = clamp255(img.data[i] + (rng() - 0.5) * 255 * grain * contrast);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
  }
  return c;
}

// ---------------------------------------------------------------------------
const PX_ROAD = 1024; // road tile covers 15m x 15m

export function makeRoadTextures() {
  const w = PX_ROAD;
  const ppm = w / 15;
  const c = canvas(w);
  const ctx = c.getContext('2d');
  noiseFill(ctx, w, w, [62, 64, 70], 0.16, 6, 11);
  // patches & repairs
  const rng = mulberry32(5);
  for (let k = 0; k < 7; k++) {
    ctx.fillStyle = rng() < 0.5 ? 'rgba(30,32,36,0.35)' : 'rgba(95,95,98,0.18)';
    const pw = 40 + rng() * 220, ph = 40 + rng() * 260;
    ctx.fillRect(rng() * w, rng() * w, pw, ph);
  }
  speckles(ctx, w, w, 5000, ['#8a8c90', '#2a2b2e', '#a5a6a8'], 0.5, 1.6, 12, 0.5);
  cracks(ctx, w, w, 26, 13);
  // tire wear paths (darker, smoother)
  const lanes = [-5.35, -1.85, 1.85, 5.35];
  for (const lc of lanes) {
    for (const off of [-0.8, 0.8]) {
      const x = w / 2 + (lc + off) * ppm;
      const g = ctx.createLinearGradient(x - 0.35 * ppm, 0, x + 0.35 * ppm, 0);
      g.addColorStop(0, 'rgba(20,20,22,0)');
      g.addColorStop(0.5, 'rgba(20,20,22,0.22)');
      g.addColorStop(1, 'rgba(20,20,22,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 0.35 * ppm, 0, 0.7 * ppm, w);
    }
  }
  // gutters
  ctx.fillStyle = 'rgba(150,148,140,0.85)';
  ctx.fillRect(0, 0, 0.45 * ppm, w);
  ctx.fillRect(w - 0.45 * ppm, 0, 0.45 * ppm, w);
  // edge lines
  const lw = 0.13 * ppm;
  paint(ctx, w / 2 - 6.9 * ppm - lw / 2, 0, lw, w, '#e9e7df', 0.2, 21);
  paint(ctx, w / 2 + 6.9 * ppm - lw / 2, 0, lw, w, '#e9e7df', 0.2, 22);
  // double yellow
  paint(ctx, w / 2 - 0.2 * ppm, 0, lw, w, '#f2bf1d', 0.2, 23);
  paint(ctx, w / 2 + 0.2 * ppm - lw, 0, lw, w, '#f2bf1d', 0.2, 24);
  // lane dashes (3m dash / 4.5m gap)
  for (const s of [-1, 1]) {
    const x = w / 2 + s * 3.6 * ppm - lw / 2;
    for (let y0 = 0; y0 < w; y0 += 7.5 * ppm) paint(ctx, x, y0, lw, 3 * ppm, '#eeece6', 0.25, 30 + y0);
  }
  const map = finish(c);
  const nrm = finish(heightToNormal(grainHeight(512, 77, 40, 1.2).getContext('2d'), 512, 512, 2.2), { srgb: false });
  return { map, normalMap: nrm };
}

// 24m x 24m intersection square: asphalt + continental crosswalks + stop bars.
export function makeIntersectionTexture() {
  const w = 1024, ppm = w / 24;
  const c = canvas(w);
  const ctx = c.getContext('2d');
  noiseFill(ctx, w, w, [60, 62, 68], 0.15, 6, 41);
  speckles(ctx, w, w, 4200, ['#8a8c90', '#2a2b2e', '#a5a6a8'], 0.5, 1.5, 42, 0.45);
  cracks(ctx, w, w, 18, 43);
  // manhole cover
  ctx.fillStyle = '#3a3a3c';
  ctx.beginPath();
  ctx.arc(w * 0.42, w * 0.56, 0.42 * ppm, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2a2a2b';
  ctx.lineWidth = 3;
  ctx.stroke();
  const mid = w / 2;
  const bar = 0.55 * ppm, gap = 0.6 * ppm;
  const zebra = (horizontal) => {
    // crosswalk arms on both sides
    for (const s of [-1, 1]) {
      const a0 = mid + s * 8.0 * ppm, a1 = mid + s * 11.0 * ppm;
      const lo = Math.min(a0, a1), len = Math.abs(a1 - a0);
      for (let t = mid - 7.0 * ppm; t < mid + 7.0 * ppm - bar; t += bar + gap) {
        if (horizontal) paint(ctx, t, lo, bar, len, '#f1efe8', 0.18, t * 3 + s);
        else paint(ctx, lo, t, len, bar, '#f1efe8', 0.18, t * 5 + s);
      }
      // stop bar over the inbound half (right-hand traffic)
      const sb = 0.4 * ppm;
      const edge = mid + s * 11.6 * ppm - sb / 2;
      if (horizontal) {
        // N-S road: traffic heading +z (south) enters from north (s=-1) on the -x half
        const x0 = s < 0 ? mid - 7.2 * ppm : mid + 0.3 * ppm;
        paint(ctx, x0, edge, 6.9 * ppm, sb, '#f1efe8', 0.2, 90 + s);
      } else {
        const z0 = s < 0 ? mid + 0.3 * ppm : mid - 7.2 * ppm;
        paint(ctx, edge, z0, sb, 6.9 * ppm, '#f1efe8', 0.2, 95 + s);
      }
    }
  };
  zebra(true);
  zebra(false);
  return finish(c);
}

export function makeConcreteTexture() {
  const w = 512, ppm = w / 4.5;
  const c = canvas(w);
  const ctx = c.getContext('2d');
  noiseFill(ctx, w, w, [196, 192, 184], 0.07, 5, 51);
  speckles(ctx, w, w, 900, ['#9c9890', '#d8d4cc', '#8f8a82'], 0.4, 1.4, 52, 0.4);
  // gum spots & stains
  speckles(ctx, w, w, 60, ['#55524d', '#6b665f'], 1.5, 3.5, 53, 0.5);
  speckles(ctx, w, w, 6, ['rgba(80,70,60,0.25)'], 18, 45, 54, 0.25);
  // slab joints every 1.5m
  ctx.strokeStyle = 'rgba(95,90,82,0.75)';
  ctx.lineWidth = 2.2;
  for (let k = 0; k <= 3; k++) {
    const p = Math.round(k * 1.5 * ppm);
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, w); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(w, p); ctx.stroke();
  }
  cracks(ctx, w, w, 5, 55, 'rgba(70,66,60,0.5)');
  const map = finish(c);
  const nrm = finish(heightToNormal(grainHeight(256, 88, 30, 0.8).getContext('2d'), 256, 256, 1.5), { srgb: false });
  return { map, normalMap: nrm };
}

export function makeGrassTexture() {
  const w = 512;
  const c = canvas(w);
  const ctx = c.getContext('2d');
  noiseFill(ctx, w, w, [88, 150, 58], 0.22, 4, 61);
  const rng = mulberry32(62);
  // blades
  for (let k = 0; k < 9000; k++) {
    const x = rng() * w, y = rng() * w;
    const l = 2 + rng() * 5;
    const g = 100 + rng() * 90;
    ctx.strokeStyle = `rgba(${40 + rng() * 60},${g},${30 + rng() * 30},0.55)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 2, y - l);
    ctx.stroke();
  }
  // tiny flowers / clover
  speckles(ctx, w, w, 140, ['#f4f0d0', '#f7e65a', '#ffffff'], 0.8, 1.6, 63, 0.7);
  return finish(c);
}

export function makePaverTexture(tint = [176, 150, 128], seed = 71) {
  const w = 512, ppm = w / 6;
  const c = canvas(w);
  const ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${tint[0] * 0.7},${tint[1] * 0.7},${tint[2] * 0.7})`;
  ctx.fillRect(0, 0, w, w);
  const rng = mulberry32(seed);
  const bw = 0.4 * ppm, bh = 0.2 * ppm;
  // herringbone-ish running bond
  for (let row = 0; row * bh < w; row++) {
    const off = (row % 2) * bw * 0.5;
    for (let x = -bw; x < w + bw; x += bw) {
      const v = 0.82 + rng() * 0.3;
      ctx.fillStyle = `rgb(${clamp255(tint[0] * v)},${clamp255(tint[1] * v)},${clamp255(tint[2] * v)})`;
      ctx.fillRect(x + off + 1, row * bh + 1, bw - 2, bh - 2);
    }
  }
  speckles(ctx, w, w, 600, ['rgba(60,50,40,0.4)', 'rgba(255,255,255,0.15)'], 0.5, 1.5, seed + 1, 0.4);
  const map = finish(c);
  return map;
}

export function makeBrickRoadTexture() {
  return makePaverTexture([168, 72, 58], 81);
}

export function makeWaterNormal() {
  const w = 512;
  const c = grainHeight(w, 91, 36, 1.4, 0.0);
  return finish(heightToNormal(c.getContext('2d'), w, w, 5), { srgb: false });
}

// Soft round blob (for fake shadows, light pools, particles)
export function makeBlobTexture(inner = 0.0, color = '0,0,0') {
  const w = 128;
  const c = canvas(w);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(w / 2, w / 2, w * 0.5 * inner, w / 2, w / 2, w / 2);
  g.addColorStop(0, `rgba(${color},1)`);
  g.addColorStop(0.6, `rgba(${color},0.45)`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, w);
  return finish(c, { repeat: false, srgb: true });
}

// Soft cloud puff for fog banks and smoke
export function makePuffTexture(seed = 3) {
  const w = 256;
  const c = canvas(w);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, w);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const dx = x / w - 0.5, dy = y / w - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const n = fbm2(x / 40, y / 40, 4, seed);
      const a = Math.max(0, 1 - r) ** 1.6 * (0.55 + n * 0.9);
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = clamp255(a * 255);
    }
  ctx.putImageData(img, 0, 0);
  return finish(c, { repeat: false });
}

// Text texture helper (signs, labels)
export function makeTextTexture(text, { w = 512, h = 128, bg = null, fg = '#fff', font = 'bold 72px Arial', stroke = null, align = 'center' } = {}) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (stroke) { ctx.lineWidth = 8; ctx.strokeStyle = stroke; ctx.strokeText(text, w / 2, h / 2); }
  ctx.fillStyle = fg;
  ctx.fillText(text, align === 'center' ? w / 2 : 10, h / 2);
  return finish(c, { repeat: false });
}

export { valueNoise2 };
