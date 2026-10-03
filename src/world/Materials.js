// Shared materials for the world.
import * as THREE from 'three';
import {
  makeRoadTextures, makeIntersectionTexture, makeConcreteTexture, makeGrassTexture,
  makePaverTexture, makeBrickRoadTexture, setMaxAnisotropy, makeBlobTexture,
} from './Textures.js';
import { createFacadeMaterial } from './BuildingMaterial.js';

let cache = null;

export function getMaterials(renderer) {
  if (cache) return cache;
  setMaxAnisotropy(Math.min(16, renderer.capabilities.getMaxAnisotropy()));
  const road = makeRoadTextures();
  const concrete = makeConcreteTexture();
  const inter = makeIntersectionTexture();
  const grass = makeGrassTexture();
  const pavers = makePaverTexture([186, 168, 150], 71);
  const promenade = makePaverTexture([170, 160, 150], 73);
  const brick = makeBrickRoadTexture();
  const wood = makeWoodTexture();
  road.normalMap.repeat.set(4, 4);
  concrete.normalMap.repeat.set(2, 2);

  const m = {};
  m.road = new THREE.MeshStandardMaterial({ map: road.map, normalMap: road.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.88, metalness: 0.0 });
  m.intersection = new THREE.MeshStandardMaterial({ map: inter, normalMap: road.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.88 });
  m.brickRoad = new THREE.MeshStandardMaterial({ map: brick, roughness: 0.82 });
  m.sidewalk = new THREE.MeshStandardMaterial({ map: concrete.map, normalMap: concrete.normalMap, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.9 });
  m.curb = new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.8 });
  m.rail = new THREE.MeshStandardMaterial({ color: 0x8b8f94, roughness: 0.3, metalness: 0.9 });
  m.grass = new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95, color: 0xffffff });
  m.grass.map.repeat.set(1, 1);
  m.pavers = new THREE.MeshStandardMaterial({ map: pavers, roughness: 0.85 });
  m.promenade = new THREE.MeshStandardMaterial({ map: promenade, roughness: 0.85 });
  m.wood = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.85 });
  m.seawall = new THREE.MeshStandardMaterial({ color: 0x9c968c, roughness: 0.9 });
  m.dirt = new THREE.MeshStandardMaterial({ color: 0x6f6650, roughness: 1 });
  m.facade = createFacadeMaterial();
  m.terrain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  m.hedge = new THREE.MeshStandardMaterial({ color: 0x3f8f3a, roughness: 0.9 });
  m.blob = new THREE.MeshBasicMaterial({ map: makeBlobTexture(0), transparent: true, depthWrite: false, opacity: 0.55, color: 0x000000, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
  m.textures = { road, concrete, inter, grass, pavers, brick, wood };
  cache = m;
  return m;
}

function makeWoodTexture() {
  const w = 512;
  const c = document.createElement('canvas');
  c.width = c.height = w;
  const ctx = c.getContext('2d');
  const plank = w / 8;
  for (let k = 0; k < 8; k++) {
    const v = 0.75 + Math.random() * 0.3;
    ctx.fillStyle = `rgb(${132 * v},${100 * v},${72 * v})`;
    ctx.fillRect(0, k * plank, w, plank - 3);
    ctx.fillStyle = 'rgba(40,28,18,0.8)';
    ctx.fillRect(0, k * plank + plank - 3, w, 3);
    // grain
    for (let g = 0; g < 40; g++) {
      ctx.strokeStyle = `rgba(60,40,25,${0.1 + Math.random() * 0.2})`;
      ctx.beginPath();
      const y = k * plank + Math.random() * plank;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(w * 0.3, y + (Math.random() - 0.5) * 6, w * 0.6, y + (Math.random() - 0.5) * 6, w, y);
      ctx.stroke();
    }
    // butt joints
    const jx = Math.random() * w;
    ctx.fillStyle = 'rgba(40,28,18,0.8)';
    ctx.fillRect(jx, k * plank, 3, plank);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
