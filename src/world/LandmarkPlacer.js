// Places the procedural SF landmark models into the world: city slots reserved by the
// City builder plus the backdrop (Golden Gate, Bay Bridge, Alcatraz, Sutro Tower).
import * as THREE from 'three';
import { farHeight } from './Terrain.js';
import { groundHeight } from './CityLayout.js';

const SLOT_FACTORIES = {
  palace: 'createPalaceOfFineArts',
  ghirardelli: 'createGhirardelliSign',
  coit: 'createCoitTower',
  church: 'createSaintsPeterPaulChurch',
  transamerica: 'createTransamericaPyramid',
  salesforce: 'createSalesforceTower',
  cityhall: 'createCityHall',
  ferry: 'createFerryBuilding',
  pier39: 'createPier39',
  wharfsign: 'createWharfSign',
  balclutha: 'createBalclutha',
  sealions: 'createSeaLionDock',
  dragongate: 'createChinatownGate',
};

export async function placeLandmarks(world, collision) {
  let lib = null;
  try {
    const loader = import.meta.glob('./landmarks/index.js')['./landmarks/index.js'];
    if (loader) lib = await loader();
  } catch (e) {
    console.warn('Landmarks unavailable:', e);
  }
  const placed = [];
  const nightMats = [];
  const animated = [];
  const add = (key, obj, x, y, z, rot, withColliders = true) => {
    obj.position.set(x, y, z);
    obj.rotation.y = rot;
    obj.updateMatrixWorld(true);
    world.scene.add(obj);
    if (obj.userData.nightMaterials) nightMats.push(...obj.userData.nightMaterials);
    if (withColliders && collision && obj.userData.colliders) {
      const c = Math.cos(rot), s = Math.sin(rot);
      for (const col of obj.userData.colliders) {
        // rotate the local AABB (rotation multiples of 90° keep it axis-aligned)
        const cx = x + col.x * c + col.z * s, cz = z - col.x * s + col.z * c;
        const swap = Math.abs(s) > 0.7;
        const hx = swap ? col.hz : col.hx, hz = swap ? col.hx : col.hz;
        collision.addBox(cx - hx, cz - hz, cx + hx, cz + hz, y - 5, y + (col.h ?? 50), 'building');
      }
    }
    placed.push({ key, obj });
    return obj;
  };
  const make = (name, ...args) => {
    if (!lib || typeof lib[name] !== 'function') return null;
    try {
      return lib[name](...args);
    } catch (e) {
      console.warn('Landmark failed', name, e);
      return null;
    }
  };

  for (const slot of world.city.landmarkSlots) {
    if (slot.key === 'monument') { add('monument', makeMonument(), slot.x, slot.y, slot.z, 0, false); continue; }
    if (slot.key === 'fountain') { add('fountain', makeFountain(), slot.x, slot.y, slot.z, 0, false); continue; }
    const fn = SLOT_FACTORIES[slot.key];
    if (!fn) continue;
    const obj = make(fn);
    if (!obj) continue;
    if (slot.key === 'ghirardelli') slot.y = roofHeightAt(world, slot.x, slot.z, 18) ?? slot.y;
    // Landmark blocks reserve their own collision through the model's colliders. The
    // Ghirardelli sign sits on a roof and the Ferry building already has a block collider.
    const withCol = !['ghirardelli', 'ferry', 'sealions', 'balclutha', 'wharfsign'].includes(slot.key);
    add(slot.key, obj, slot.x, slot.y, slot.z, slot.rot, withCol);
    if (slot.key === 'sealions' && typeof lib.animateSeaLions === 'function') animated.push((t) => lib.animateSeaLions(obj, t));
  }

  // Backdrop
  const gg = make('createGoldenGateBridge');
  // the model's -Z end is the SF (south) end; in our world south is +Z
  if (gg) add('goldengate', gg, -1900, 0, -1180, Math.PI, false);
  const bb = make('createBayBridge');
  if (bb) add('baybridge', bb, 1600, 0, 720, Math.PI / 2, false);
  const al = make('createAlcatraz');
  if (al) {
    add('alcatraz', al, 380, 0, -1460, 0.25, false);
    if (typeof lib.animateAlcatraz === 'function') animated.push((t) => lib.animateAlcatraz(al, t));
  }
  const st = make('createSutroTower');
  if (st) {
    const y = farHeight(-1100, 1500);
    add('sutro', st, -1100, Math.max(0, y) - 4, 1500, 0, false);
  }
  // cable cars (returned for the controller to animate)
  const cableCars = [];
  for (let k = 0; k < 2; k++) {
    const cc = make('createCableCar');
    if (cc) {
      cc.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      world.scene.add(cc);
      if (cc.userData.nightMaterials) nightMats.push(...cc.userData.nightMaterials);
      cableCars.push(cc);
    }
  }
  world.registerNightMaterials(nightMats);
  return { placed, cableCars, animated };
}

// Highest roof under a horizontal span (used to perch rooftop signs)
function roofHeightAt(world, x, z, halfSpan) {
  const rc = new THREE.Raycaster();
  rc.far = 400;
  const meshes = [];
  world.city.group.traverse((o) => { if (o.isMesh && o.visible && o.geometry && o.geometry.attributes.aFUV) meshes.push(o); });
  let best = null;
  for (let k = -2; k <= 2; k++) {
    rc.set(new THREE.Vector3(x + (k / 2) * halfSpan, 300, z), new THREE.Vector3(0, -1, 0));
    const hit = rc.intersectObjects(meshes, false)[0];
    if (hit && (best === null || hit.point.y > best)) best = hit.point.y;
  }
  return best;
}

// Dewey Monument (Union Square): granite column with the Victory statue
function makeMonument() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: '#d9d2c4', roughness: 0.7 });
  const bronze = new THREE.MeshStandardMaterial({ color: '#c9a35b', metalness: 0.85, roughness: 0.3 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 2.2, 8), stone);
  base.position.y = 1.1;
  const ped = new THREE.Mesh(new THREE.BoxGeometry(3.2, 4, 3.2), stone);
  ped.position.y = 4.2;
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.05, 24, 20), stone);
  col.position.y = 18;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 2.4), stone);
  cap.position.y = 30.4;
  const statue = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.6, 4, 8), bronze);
  body.position.y = 1.3;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.2, 6), bronze);
  arm.position.set(0.5, 2.6, 0);
  arm.rotation.z = -0.6;
  const trident = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 5), bronze);
  trident.position.set(-0.6, 2.2, 0);
  const wreath = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.07, 6, 12), bronze);
  wreath.position.set(1.4, 3.5, 0);
  statue.add(body, arm, trident, wreath);
  statue.position.y = 30.8;
  g.add(base, ped, col, cap, statue);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function makeFountain() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: '#c8c1b3', roughness: 0.75 });
  const water = new THREE.MeshPhysicalMaterial({ color: '#4fb4d8', roughness: 0.05, metalness: 0.1, transmission: 0, clearcoat: 1, envMapIntensity: 1.6 });
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.4, 0.7, 32, 1, true), stone);
  basin.position.y = 0.35;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.2, 8, 40), stone);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.7;
  const pool = new THREE.Mesh(new THREE.CircleGeometry(4.1, 32), water);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.55;
  const tier = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 0.5, 0.5, 20), stone);
  tier.position.y = 2.2;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 2.2, 12), stone);
  stem.position.y = 1.1;
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), stone);
  top.position.y = 2.8;
  g.add(basin, rim, pool, tier, stem, top);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.isFountain = true;
  return g;
}

export { groundHeight };
