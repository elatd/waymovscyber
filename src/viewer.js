// Dev-only viewer for headless screenshots: a turntable for the hero car models, or with
// ?people=walk|pose a lineup of crowd pedestrians (?pick=… chooses which ones, ?t= time).
import * as THREE from 'three';
import { Renderer } from './core/Renderer.js';
import { SkySystem } from './world/Sky.js';
import { getMaterials } from './world/Materials.js';
import { createWaymo, createCybercab } from './vehicles/CarModels.js';
import { Pedestrians } from './people/Pedestrians.js';

const qs = new URLSearchParams(location.search);
const R = new Renderer(document.getElementById('app'));
R.quality = qs.get('q') || 'high';
const scene = new THREE.Scene();
const sky = new SkySystem(R.renderer, scene);
sky.apply(qs.get('tod') || 'day');
sky.sun.shadow.camera.left = sky.sun.shadow.camera.bottom = -8;
sky.sun.shadow.camera.right = sky.sun.shadow.camera.top = 8;
sky.sun.shadow.camera.updateProjectionMatrix();
const mats = getMaterials(R.renderer);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), mats.road);
ground.receiveShadow = true;
scene.add(ground);
const peopleMode = qs.get('people');
let car = null, peds = null;
if (!peopleMode) {
  car = (qs.get('car') || 'waymo') === 'cybercab' ? createCybercab() : createWaymo();
  scene.add(car.root);
  car.root.rotation.y = THREE.MathUtils.degToRad(+(qs.get('yaw') || 35));
} else {
  // lineup facing the camera; alternating states show the walk cycle and the poses
  peds = new Pedestrians(scene, 40);
  const pick = (qs.get('pick') || '0,1,2,3,4,5,6,7').split(',').map(Number);
  const gap = +(qs.get('gap') || 0.95);
  pick.forEach((id, k) => {
    const p = peds.peds[id];
    p.active = true;
    p.pos.set((k - (pick.length - 1) / 2) * gap, 0, 0);
    p.heading = THREE.MathUtils.degToRad(+(qs.get('face') || 0));
    const mode = peopleMode === 'pose' ? ['wait', 'walk', 'idle', 'celebrate', 'dive', 'wait'][k % 6] : k % 4 === 3 ? 'idle' : 'walk';
    p.state = mode === 'walk' ? 'walk' : mode;
    p.walkW = mode === 'walk' ? 1 : 0;
    p.wave = 1;
    p.lean = mode === 'dive' ? 0.9 : 0;
    p.phase = 1.3 * k + +(qs.get('t') || 0) * 6;
  });
}
const camera = new THREE.PerspectiveCamera(+(qs.get('fov') || 32), innerWidth / innerHeight, 0.1, 9000);
const dist = +(qs.get('dist') || 9.5), elev = THREE.MathUtils.degToRad(+(qs.get('elev') || 12));
camera.position.set(+(qs.get('cx') || 0), Math.sin(elev) * dist + 0.8, Math.cos(elev) * dist);
camera.lookAt(+(qs.get('cx') || 0), +(qs.get('ly') || 0.75), 0);
R.init(scene, camera);
scene.fog.density = 0.00012;
// keep drawing until web fonts used by canvas decals have loaded (they redraw themselves)
let n = 0, fontsReady = false;
(document.fonts?.ready ?? Promise.resolve()).then(() => setTimeout(() => { fontsReady = true; }, 400));
function frame() {
  sky.update(0.016, new THREE.Vector3());
  sky.dome.position.copy(camera.position);
  R.updateSun(sky.sunDir, sky.sun.color, 0.5);
  if (peds) {
    peds.time = +(qs.get('t') || 0) + n * 0.016;
    peds.render(camera.position);
  }
  R.render(0.016);
  if (++n < 6 || !fontsReady || n < 12) requestAnimationFrame(frame);
  else document.title = 'READY';
}
frame();
window.__car = car;
window.__peds = peds;
