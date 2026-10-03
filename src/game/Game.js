// WAYMO vs CYBERTAXI — main game controller.
import * as THREE from 'three';
import { Renderer, QUALITY } from '../core/Renderer.js';
import { Input } from '../core/Input.js';
import { World } from '../world/World.js';
import { Props } from '../world/Props.js';
import { placeLandmarks } from '../world/LandmarkPlacer.js';
import * as L from '../world/CityLayout.js';
import { ChaseCamera } from '../camera/ChaseCamera.js';
import { createWaymo, createCybercab } from '../vehicles/CarModels.js';
import { Vehicle, SPECS } from '../vehicles/Vehicle.js';
import { Traffic, signalPhase } from '../vehicles/Traffic.js';
import { Pedestrians } from '../people/Pedestrians.js';
import { Particles } from '../fx/Particles.js';
import { Skidmarks } from '../fx/Skidmarks.js';
import { Missions } from './Missions.js';
import { RivalAI } from './Rival.js';
import { HUD } from '../ui/HUD.js';
import { Menus, CAR_INFO, TOD_LIST, QUALITY_LIST } from '../ui/Menus.js';
import { clamp, damp, wrapAngle, smoothstep } from '../core/math.js';
import { makeBlobTexture } from '../world/Textures.js';
import { saveTracks, loadTracks, clearTracks } from '../audio/MusicStore.js';
import { YouTubePiP } from '../ui/YouTubePiP.js';

const AUDIO_STUB = {
  unlock: async () => {}, setVolumes() {}, playMusic() {}, stopMusic() {}, setMusicIntensity() {},
  updateCar() {}, stopCar() {}, play() {}, setPaused() {},
  setPlaylist: () => 0, setMusicSource() {}, nextTrack() {}, trackCount: 0, trackName: '', musicSource: 'game',
};

// Yield to the browser so loading progress can paint (with a timer fallback so boot
// keeps going while the tab is in the background).
const nextFrame = () => new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 50); });
const T0 = performance.now();
const DEBUG = new URLSearchParams(location.search).has('debug');
const mark = (label) => { if (DEBUG) console.log(`[boot] ${label} @ ${Math.round(performance.now() - T0)}ms`); };

export class Game {
  constructor() {
    this.container = document.getElementById('app');
    this.ui = document.getElementById('ui');
    this.settings = this.loadSettings();
    this.R = new Renderer(this.container);
    this.R.quality = this.settings.quality;
    this.input = new Input();
    this.audio = AUDIO_STUB;
    this.state = 'loading';
    this.mode = 'arcade';
    this.selectedCar = this.settings.car || 'waymo';
    this.time = 0;
    this.fps = { acc: 0, frames: 0, slow: 0, fast: 0 };
    this._v3 = new THREE.Vector3();
  }

  loadSettings() {
    const def = { quality: 'high', tod: 'day', music: 0.6, sfx: 0.9, camera: 0, car: 'waymo', musicSource: 'mine' };
    try {
      const s = JSON.parse(localStorage.getItem('wvc-settings') || '{}');
      return { ...def, ...s };
    } catch { return def; }
  }

  saveSettings() {
    try { localStorage.setItem('wvc-settings', JSON.stringify(this.settings)); } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------- boot
  async boot() {
    this.menus = new Menus(this);
    this.menus.show('loading');
    this.menus.setLoading(0.02, 'Booting robotaxi brains…');
    await nextFrame();
    // audio (optional module)
    try {
      const loader = import.meta.glob('../audio/AudioManager.js')['../audio/AudioManager.js'];
      if (loader) {
        const mod = await loader();
        this.audio = new mod.AudioManager();
      }
    } catch (e) {
      console.warn('Audio module unavailable, running silent.', e);
    }
    this.audio.onTrack = (name) => this.musicToast(name);
    this.setupMusicDrop();
    // YouTube picture-in-picture player: replaces the soundtrack (sound effects keep playing);
    // the soundtrack comes back when the player is closed or its video can't play
    this.yt = new YouTubePiP(this.ui, {
      onStart: () => {
        if (this.audio.musicSource !== 'external') this.musicBeforeYT = this.audio.musicSource;
        this.audio.setMusicSource('external');
        this.yt.setVolume(this.settings.music, this.state === 'paused' ? 0.35 : 1);
      },
      onStop: () => this.audio.setMusicSource(this.musicBeforeYT || this.settings.musicSource),
      onTitle: (title) => this.musicToast(title),
    });
    // songs the player added on an earlier visit
    loadTracks().then((files) => {
      if (files.length && this.audio.setPlaylist(files)) this.audio.setMusicSource(this.settings.musicSource);
    });
    const unlock = () => {
      this.audio.unlock().then(() => {
        this.audio.setVolumes({ master: 0.9, music: this.settings.music, sfx: this.settings.sfx });
        if (this.state === 'title' || this.state === 'select') this.audio.playMusic('menu');
      }).catch(() => {});
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('gamepadconnected', unlock);

    this.world = new World(this.R.renderer);
    const steps = [
      [0.08, 'Painting the sky over the Bay'],
      [0.2, 'Raising Nob Hill and Russian Hill'],
      [0.35, 'Laying 2,000 tons of asphalt'],
      [0.5, 'Painting the Painted Ladies'],
    ];
    this.menus.setLoading(steps[0][0], steps[0][1]);
    await nextFrame();
    this.world.build((p, msg) => this.menus.setLoading(p * 0.6, msg));
    mark('world');
    this.menus.setLoading(0.62, 'Planting palm trees on the Embarcadero');
    await nextFrame();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 9000);
    this.R.init(this.world.scene, this.camera);
    this.applyQualityExtras();
    const scene = this.world.scene;
    this.collision = this.world.city.collision;
    this.props = new Props(this.world.city, scene, this.collision);
    this.props.build();
    this.props.onTopple = (r) => {
      const tx = r.x + r.fx * r.h * r.s * 0.6, tz = r.z + r.fz * r.h * r.s * 0.6;
      this.particles.dust(tx, r.y, tz, 10, r.kind === 'tree' ? [0.45, 0.5, 0.35] : [0.6, 0.6, 0.62]);
      if (r.kind === 'tree') this.particles.leaves(tx, r.y + 0.5, tz, 16);
      this.spatial('land', { x: tx, z: tz }, 0.8);
    };
    this.world.registerNightMaterials(this.props.nightMaterials);
    mark('props');
    this.menus.setLoading(0.7, 'Hailing the traffic');
    await nextFrame();
    const q = QUALITY[this.settings.quality];
    this.traffic = new Traffic(scene).build(q.maxTraffic);
    this.peds = new Pedestrians(scene, q.peds);
    this.peds.onDive = (p, car) => { if (car === this.player && Math.random() < 0.5) this.audio.play('whoosh', { volume: 0.3 }); };
    this.particles = new Particles(scene);
    this.skids = new Skidmarks(scene);
    mark('traffic+peds');
    this.menus.setLoading(0.78, 'Building the Golden Gate (in orange, obviously)');
    await nextFrame();
    const lm = await placeLandmarks(this.world, this.collision);
    this.cableCars = lm.cableCars.map((m, k) => ({ model: m, dir: k ? 1 : -1, z: k ? L.lineZ(2) : L.lineZ(9), speed: 4.5, ringT: 3 + k * 4 }));
    this.animated = lm.animated;
    mark('landmarks');
    this.menus.setLoading(0.88, 'Calibrating lidar and charging batteries');
    await nextFrame();
    // vehicles
    this.models = { waymo: createWaymo(), cybercab: createCybercab() };
    this.vehicles = {
      waymo: new Vehicle(this.models.waymo, SPECS.waymo),
      cybercab: new Vehicle(this.models.cybercab, SPECS.cybercab),
    };
    const blobTex = makeBlobTexture(0);
    for (const k of Object.keys(this.models)) {
      const m = this.models[k];
      scene.add(m.root);
      // soft contact shadow
      const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTex, color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 }));
      blob.rotation.x = -Math.PI / 2;
      blob.scale.set(m.dims.width * 1.5, m.dims.length * 1.18, 1);
      blob.renderOrder = 1;
      scene.add(blob);
      m.blob = blob;
      // headlight pool (fake projected light) + beams for night
      const hp = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTex, color: new THREE.Color(1.3, 1.25, 1.1), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -5 }));
      hp.rotation.x = -Math.PI / 2;
      hp.scale.set(5.5, 11, 1);
      hp.renderOrder = 3;
      scene.add(hp);
      m.headPool = hp;
      m.headlights = [];
      for (const s of [-1, 1]) {
        const spot = new THREE.SpotLight(0xfff2dd, 0, 60, 0.5, 0.6, 1.2);
        spot.position.set(s * 0.6, 0.75, m.dims.length * 0.45);
        spot.target.position.set(s * 0.6, 0, m.dims.length * 0.45 + 12);
        m.root.add(spot, spot.target);
        m.headlights.push(spot);
      }
    }
    this.showLight = new THREE.SpotLight(0xfff1e0, 0, 40, 0.5, 0.6, 1.1);
    scene.add(this.showLight, this.showLight.target);
    this.chase = new ChaseCamera(this.camera);
    this.chase.mode = this.settings.camera;
    this.missions = new Missions(this);
    this.hud = new HUD(this.ui);
    this.buildArrow();
    this.buildTouch();
    this.world.setTimeOfDay(this.settings.tod);
    this.applyNight();
    mark('vehicles+hud');
    this.menus.setLoading(1, 'Ready. Is anyone driving this thing?');
    await nextFrame();
    // warm up shaders
    this.R.renderer.compile(this.world.scene, this.camera);
    mark('compiled');
    this.toTitle();
    // ?quick=waymo|cybercab skips the menus (handy for testing), ?mode=free for free ride
    const qs = new URLSearchParams(location.search);
    if (qs.get('quick')) {
      this.selectedCar = qs.get('quick') === 'cybercab' ? 'cybercab' : 'waymo';
      this.mode = qs.get('mode') === 'free' ? 'free' : 'arcade';
      if (qs.get('tod')) { this.settings.tod = qs.get('tod'); this.world.setTimeOfDay(this.settings.tod); this.applyNight(); }
      this.startRace();
    }
    this.last = performance.now();
    this.R.renderer.setAnimationLoop(() => this.frame());
    window.__game = this;
    window.__THREE = THREE;
  }

  applyQualityExtras() {
    const q = QUALITY[this.settings.quality];
    this.world.sky.setShadowQuality(q.shadow, q.shadowExtent);
  }

  applyNight() {
    const n = this.world.nightFactor;
    this.traffic.setNight(n);
    this.props.setNight(n);
    for (const m of Object.values(this.models)) {
      m.lights.head.emissiveIntensity = 2.2 + n * 3;
      for (const s of m.headlights) { s.intensity = n > 0.5 ? 40 : 0; s.visible = n > 0.5; }
    }
  }

  // ---------------------------------------------------------------- arrow
  // Guidance arrow floating ahead of the car. Its stem always points up the screen and it
  // bends, progressively as a corner approaches, into the direction of the next turn on
  // the planned route — a GPS-style preview instead of snapping to the next waypoint.
  buildArrow() {
    this.arrowMat = new THREE.MeshStandardMaterial({ color: '#39ff88', emissive: '#22ff77', emissiveIntensity: 1.4, roughness: 0.25, metalness: 0.1 });
    this.arrowOutlineMat = new THREE.MeshBasicMaterial({ color: '#05140b', side: THREE.BackSide });
    this.arrowGeos = new Map(); // bend key → [body, outline] (small LRU)
    this.arrowBend = 0;
    this.arrowKey = null;
    const [g, go] = this.arrowGeometry(0);
    this.arrowMesh = new THREE.Mesh(g, this.arrowMat);
    this.arrowOutline = new THREE.Mesh(go, this.arrowOutlineMat);
    this.arrowMesh.add(this.arrowOutline);
    this.arrowMesh.rotation.x = -0.62; // tilt the far end up so the face reads from the chase camera
    this.arrow = new THREE.Group();
    this.arrow.add(this.arrowMesh);
    this.arrow.renderOrder = 7;
    this.arrow.visible = false;
    this.world.scene.add(this.arrow);
  }

  // Flat beveled arrow whose shaft bends by `bend` radians (+ = toward local +x) into the
  // head; returns [body, outline] geometries centred on the shape, cached per 3°.
  arrowGeometry(bend) {
    const STEP = Math.PI / 60;
    const key = Math.round(bend / STEP);
    const hitGeo = this.arrowGeos.get(key);
    if (hitGeo) { this.arrowGeos.delete(key); this.arrowGeos.set(key, hitGeo); return hitGeo; }
    const b = key * STEP, a = Math.abs(b), sgn = b < 0 ? -1 : 1;
    const stem = 0.7, arcLen = 1.5, n = 26;
    const r = a > 1e-3 ? Math.max(arcLen / a, 1.0) : Infinity;
    const len = stem + (a > 1e-3 ? r * a : arcLen);
    const C = [], T = [];
    for (let k = 0; k <= n; k++) {
      const s = (k / n) * len;
      if (s <= stem || a <= 1e-3) { C.push([0, s]); T.push([0, 1]); continue; }
      const phi = (s - stem) / r;
      C.push([sgn * r * (1 - Math.cos(phi)), stem + r * Math.sin(phi)]);
      T.push([sgn * Math.sin(phi), Math.cos(phi)]);
    }
    const outline = (grow) => {
      const w = 0.5 + grow, hw = 1.35 + grow * 1.4, hl = 1.45 + grow * 1.6;
      const P = [], M = [];
      C.forEach(([x, y], k) => {
        const [tx, ty] = T[k];
        const back = k === 0 ? grow : 0;
        P.push([x + ty * w - tx * back, y - tx * w - ty * back]);
        M.push([x - ty * w - tx * back, y + tx * w - ty * back]);
      });
      const [ex, ey] = C[n], [tx, ty] = T[n];
      return [...P, [ex + ty * hw, ey - tx * hw], [ex + tx * hl, ey + ty * hl], [ex - ty * hw, ey + tx * hw], ...M.reverse()];
    };
    const body = outline(0);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of body) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const make = (pts, depth, bevel) => {
      const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x - cx, y - cy)));
      const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 2 });
      g.translate(0, 0, -depth / 2);
      g.rotateX(Math.PI / 2); // shape +y → forward (+z), extrusion → thickness
      g.computeVertexNormals();
      return g;
    };
    const geo = [make(body, 0.38, 0.1), make(outline(0.1), 0.5, 0.12)];
    this.arrowGeos.set(key, geo);
    if (this.arrowGeos.size > 48) {
      const [oldKey, old] = this.arrowGeos.entries().next().value;
      this.arrowGeos.delete(oldKey);
      if (old !== this.arrowMesh?.geometry && old[0] !== this.arrowMesh?.geometry) { old[0].dispose(); old[1].dispose(); }
    }
    return geo;
  }

  updateArrow(dt) {
    const fare = this.playerFare();
    const v = this.player;
    let dest = null, color = null;
    if (fare) {
      dest = fare.dest;
      color = '#39ff88';
    } else if (this.missions.waiting.length) {
      let best = null, bd = Infinity;
      for (const w of this.missions.waiting) {
        const d = Math.hypot(w.x - v.pos.x, w.z - v.pos.z);
        if (d < bd) { bd = d; best = w; }
      }
      if (best && bd > 12) { dest = best; color = best.tier.color; }
      this.seekTarget = best;
    }
    if (!dest || this.state !== 'play') { this.arrow.visible = false; return; }
    this.arrow.visible = true;
    const guide = this.routeGuide(dest);
    // head direction eases from "follow this road" to "the next turn" over the last ~75 m
    const w = smoothstep(75, 16, guide.turnDist);
    const headYaw = guide.roadYaw + wrapAngle(guide.turnYaw - guide.roadYaw) * w;
    const camF = this.chase.heading;
    let target = wrapAngle(headYaw - camF);
    // turn-arounds keep bending to the side they started on instead of flipping
    if (Math.abs(target) > 2.5 && Math.abs(this.arrowBend) > 1.6 && Math.sign(target) !== Math.sign(this.arrowBend)) target = -target;
    target = clamp(target, -2.9, 2.9);
    this.arrowBend += (target - this.arrowBend) * Math.min(1, dt * 6);
    const key = Math.round(this.arrowBend / (Math.PI / 60));
    if (key !== this.arrowKey) {
      const [g, go] = this.arrowGeometry(this.arrowBend);
      this.arrowMesh.geometry = g;
      this.arrowOutline.geometry = go;
      this.arrowKey = key;
    }
    const fwdX = Math.sin(camF), fwdZ = Math.cos(camF);
    const roof = v.dims.height;
    this.arrow.position.set(v.pos.x + fwdX * 3.2, v.pos.y + roof + 1.15 + Math.sin(this.time * 4) * 0.1, v.pos.z + fwdZ * 3.2);
    this.arrow.rotation.set(0, camF, 0);
    this.arrow.scale.setScalar(fare ? 1.0 : 0.62);
    this.arrowMat.color.set(color);
    this.arrowMat.emissive.set(color);
  }

  // Read the planned route from the car's point of view: which way the road ahead runs
  // (snapped to the street grid) and where the first real turn is (distance + exit yaw).
  routeGuide(dest) {
    const v = this.player;
    this.routeT = (this.routeT || 0) - 1;
    if (!this.route || this.routeDest !== dest || this.routeT <= 0) {
      const hx = Math.sin(v.yaw), hz = Math.cos(v.yaw);
      const fresh = L.findRoute(v.pos.x, v.pos.z, dest.x, dest.z, { x: hx, z: hz });
      // keep the current plan unless the new one is clearly better: the grid is full of
      // equal-length alternatives that would otherwise flip the advice back and forth
      const cost = (r) => L.routeLength(v.pos.x, v.pos.z, r) + ((r[0].x - v.pos.x) * hx + (r[0].z - v.pos.z) * hz < -8 ? 60 : 0);
      let keep = false;
      if (this.route && this.routeDest === dest) {
        const old = this.trimRoute(this.route, v.pos.x, v.pos.z);
        keep = old.length > 0 && cost(old) <= cost(fresh) + 12;
      }
      if (!keep) this.route = fresh;
      this.routeDest = dest;
      this.routeT = 20;
    }
    const yawTo = (x, z) => Math.atan2(x - v.pos.x, z - v.pos.z);
    const route = this.trimRoute(this.route, v.pos.x, v.pos.z);
    const dd = Math.hypot(dest.x - v.pos.x, dest.z - v.pos.z);
    if (dd < 40 || route.length < 2) {
      const y = yawTo(dest.x, dest.z);
      return { roadYaw: y, turnYaw: y, turnDist: Infinity };
    }
    const gridYaw = (dx, dz) => (Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? Math.PI / 2 : -Math.PI / 2) : (dz > 0 ? 0 : Math.PI));
    const A = route[0];
    const da = Math.hypot(A.x - v.pos.x, A.z - v.pos.z);
    const ahead = (A.x - v.pos.x) * Math.sin(v.yaw) + (A.z - v.pos.z) * Math.cos(v.yaw);
    const nodeKey = A.i + ',' + A.j;
    // the approach direction is held while crossing the node (lane offsets make the
    // car→node vector meaningless up close, and a node just passed lies behind the car)
    if (this.guideNode !== nodeKey || this.guideRoadYaw === undefined || (da > 12 && ahead > 0)) {
      if (da > 3 || this.guideRoadYaw === undefined) this.guideRoadYaw = gridYaw(A.x - v.pos.x, A.z - v.pos.z);
      this.guideNode = nodeKey;
    }
    // distance measured along the road, so a node just driven through counts as negative
    let prevYaw = this.guideRoadYaw;
    let dist = (A.x - v.pos.x) * Math.sin(prevYaw) + (A.z - v.pos.z) * Math.cos(prevYaw);
    for (let k = 0; k < route.length - 1 && dist < 140; k++) {
      const P = route[k], Q = route[k + 1];
      const dx = Q.x - P.x, dz = Q.z - P.z;
      const len = Math.hypot(dx, dz);
      if (len < 1) continue;
      const segYaw = Q.i >= 0 ? gridYaw(dx, dz) : Math.atan2(dx, dz);
      if (Math.abs(wrapAngle(segYaw - prevYaw)) > 0.35) return { roadYaw: this.guideRoadYaw, turnYaw: segYaw, turnDist: dist };
      prevYaw = segYaw;
      dist += len;
    }
    return { roadYaw: this.guideRoadYaw, turnYaw: this.guideRoadYaw, turnDist: Infinity };
  }

  // Drop route points the car has already driven past (it is well onto the next leg).
  trimRoute(route, x, z) {
    while (route.length >= 2) {
      const a = route[0], b = route[1];
      const sx = b.x - a.x, sz = b.z - a.z, l2 = sx * sx + sz * sz || 1;
      const t = ((x - a.x) * sx + (z - a.z) * sz) / l2;
      const lat = Math.abs((x - a.x) * sz - (z - a.z) * sx) / Math.sqrt(l2);
      if (t > 0.12 && lat < 14) route.shift();
      else break;
    }
    return route;
  }

  // Floating name tag over the rival so it's easy to spot in traffic
  makeTag(text, color) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.font = '400 64px Bungee, Impact, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, 256, 60);
    ctx.fillStyle = color;
    ctx.fillText(text, 256, 60);
    ctx.beginPath();
    ctx.moveTo(236, 100); ctx.lineTo(276, 100); ctx.lineTo(256, 124); ctx.closePath();
    ctx.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false, fog: false }));
    sp.scale.set(4.2, 1.05, 1);
    sp.renderOrder = 9;
    sp.visible = false;
    this.world.scene.add(sp);
    return sp;
  }

  updateRivalTag() {
    if (!this.rivalTag) return;
    const show = this.rival && (this.state === 'play' || this.state === 'countdown');
    this.rivalTag.visible = !!show;
    if (!show) return;
    const r = this.rival;
    const d = this.camera.position.distanceTo(r.pos);
    this.rivalTag.position.set(r.pos.x, r.pos.y + r.dims.height + 1.4 + Math.min(4, d * 0.02), r.pos.z);
    const s = Math.max(1, Math.min(6, d * 0.045));
    this.rivalTag.scale.set(4.2 * s * 0.5, 1.05 * s * 0.5, 1);
    this.rivalTag.material.opacity = d < 12 ? Math.max(0, (d - 6) / 6) : 1;
  }

  // ---------------------------------------------------------------- touch
  buildTouch() {
    if (!('ontouchstart' in window) && !navigator.maxTouchPoints) return;
    const t = document.createElement('div');
    t.id = 'touch';
    t.className = 'hidden';
    const btn = (label, style, on, off) => {
      const b = document.createElement('div');
      b.className = 'tbtn';
      b.textContent = label;
      Object.assign(b.style, style);
      b.addEventListener('touchstart', (e) => { e.preventDefault(); b.classList.add('on'); on(); }, { passive: false });
      const end = (e) => { e.preventDefault(); b.classList.remove('on'); off(); };
      b.addEventListener('touchend', end, { passive: false });
      b.addEventListener('touchcancel', end, { passive: false });
      t.appendChild(b);
    };
    const T = this.input.touch;
    btn('◀', { left: '16px', bottom: '260px', width: '78px', height: '78px' }, () => (T.steer = 1), () => (T.steer = 0));
    btn('▶', { left: '104px', bottom: '260px', width: '78px', height: '78px' }, () => (T.steer = -1), () => (T.steer = 0));
    btn('GAS', { right: '16px', bottom: '250px', width: '86px', height: '86px' }, () => (T.throttle = 1), () => (T.throttle = 0));
    btn('BRAKE', { right: '112px', bottom: '230px', width: '70px', height: '70px' }, () => (T.brake = 1), () => (T.brake = 0));
    btn('DRIFT', { right: '112px', bottom: '310px', width: '62px', height: '62px' }, () => (T.handbrake = true), () => (T.handbrake = false));
    btn('BOOST', { right: '26px', bottom: '346px', width: '62px', height: '62px' }, () => (T.boost = true), () => (T.boost = false));
    btn('★', { right: '190px', bottom: '270px', width: '56px', height: '56px' }, () => (T.special = true), () => {});
    btn('II', { right: '16px', top: '120px', width: '46px', height: '46px' }, () => this.input.pressed.add('Escape'), () => {});
    this.ui.appendChild(t);
    this.touchEl = t;
    // tap anywhere to advance menus
    window.addEventListener('touchstart', () => { if (this.state === 'title' && this.menus.current === 'title') { /* menu handles clicks */ } });
  }

  // ---------------------------------------------------------------- flow
  toTitle() {
    this.state = 'title';
    if (this.showLight) this.showLight.intensity = 0;
    this.hud.show(false);
    if (this.touchEl) this.touchEl.classList.add('hidden');
    this.missions.reset();
    this.startAttract();
    this.menus.show('title');
    this.audio.stopCar();
    this.audio.playMusic('menu');
    this.titleT = 0;
    this.arrow.visible = false;
  }

  toSelect(mode) {
    this.stopAttract();
    this.mode = mode;
    this.state = 'select';
    // also reachable from pause / results: drop the race in progress
    this.missions.reset();
    this.arrow.visible = false;
    if (this.rivalTag) this.rivalTag.visible = false;
    if (this.touchEl) this.touchEl.classList.add('hidden');
    this.audio.stopCar();
    this.audio.setPaused(false);
    this.menus.show('select');
    this.hud.show(false);
    this.setupShowroom();
    this.audio.playMusic('menu');
  }

  setupShowroom() {
    // Steiner St in front of the Painted Ladies, Alamo Square behind the camera
    const x = L.lineX(1) + 2.4;
    const za = L.lineZ(10) + 30, zb = za - 10.5; // the rival waits just up the street
    const sel = this.selectedCar, other = sel === 'waymo' ? 'cybercab' : 'waymo';
    this.vehicles[sel].place(x, za, Math.PI * 0.75);
    this.vehicles[other].place(x - 0.6, zb, Math.PI * 0.92);
    for (const v of Object.values(this.vehicles)) { v.model.root.visible = true; v.model.blob.visible = true; v.frozen = true; v.setInput({ throttle: 0, brake: 0, steer: 0, handbrake: false }); }
    this.showroom = { x, z: za, yaw: Math.PI * 0.75 };
    this.camLook = new THREE.Vector3(x, L.groundHeight(x, za) + 0.8, za);
  }

  cycleCar() {
    this.selectCar(this.selectedCar === 'waymo' ? 'cybercab' : 'waymo');
  }

  selectCar(key) {
    this.selectedCar = key;
    this.settings.car = key;
    this.saveSettings();
    this.setupShowroom();
    this.menus.renderSelect();
  }

  cycleTod(d) {
    const i = TOD_LIST.findIndex((t) => t[0] === this.settings.tod);
    this.settings.tod = TOD_LIST[(i + d + TOD_LIST.length) % TOD_LIST.length][0];
    this.saveSettings();
    this.world.setTimeOfDay(this.settings.tod);
    this.applyNight();
    this.menus.renderSelect();
  }

  setQuality(qn) {
    this.settings.quality = qn;
    this.saveSettings();
    this.R.setQuality(qn);
    this.applyQualityExtras();
    const q = QUALITY[qn];
    this.traffic.max = Math.min(q.maxTraffic, this.traffic.cars.length);
    this.peds.count = Math.min(q.peds, this.peds.peds.length);
  }

  setVolume(k, v) {
    this.settings[k] = clamp(Math.round(v * 10) / 10, 0, 1);
    this.saveSettings();
    this.audio.setVolumes({ music: this.settings.music, sfx: this.settings.sfx });
    if (this.yt) this.yt.setVolume(this.settings.music);
  }

  // ---------------------------------------------------------------- my music
  // The player's own songs (local files, never uploaded) replace the soundtrack.
  pickMusic() {
    if (!this.musicInput) {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac';
      inp.multiple = true;
      inp.style.display = 'none';
      inp.addEventListener('change', () => { this.loadMusic([...inp.files]); inp.value = ''; });
      document.body.appendChild(inp);
      this.musicInput = inp;
    }
    this.musicInput.click();
  }

  loadMusic(files) {
    if (this.yt) this.yt.stop();
    const n = this.audio.setPlaylist(files);
    if (!n) { this.musicToast('No playable audio in those files', true); return; }
    this.settings.musicSource = 'mine';
    this.saveSettings();
    this.audio.unlock().then(() => this.audio.setMusicSource('mine'));
    this.musicToast(`${n} song${n > 1 ? 's' : ''} loaded · N skips`, true);
    saveTracks(files.filter((f) => (f.type || '').startsWith('audio/') || /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm|weba)$/i.test(f.name || '')));
    if (this.menus.current === 'settings') this.menus.show('settings');
  }

  openYouTube() {
    this.yt.openDialog(() => { if (this.menus.current === 'settings') this.menus.show('settings'); });
  }

  forgetMusic() {
    this.audio.setPlaylist([]);
    this.audio.setMusicSource('game');
    clearTracks();
    this.musicToast('Back to the game soundtrack', true);
  }

  toggleMusicSource() {
    if (this.yt) this.yt.stop();
    if (!this.audio.trackCount) { this.pickMusic(); return; }
    this.settings.musicSource = this.audio.musicSource === 'mine' ? 'game' : 'mine';
    this.saveSettings();
    this.audio.setMusicSource(this.settings.musicSource);
    if (this.settings.musicSource === 'mine' && this.audio.trackName) this.musicToast(this.audio.trackName);
  }

  setupMusicDrop() {
    const isFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    window.addEventListener('dragover', (e) => { if (isFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    window.addEventListener('drop', (e) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      this.loadMusic([...e.dataTransfer.files]);
    });
  }

  musicToast(text, info = false) {
    let el = this.toastEl;
    if (!el) {
      el = this.toastEl = document.createElement('div');
      el.className = 'music-toast';
      this.ui.appendChild(el);
    }
    el.textContent = info ? text : '♪ ' + text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => el.classList.remove('show'), 3800);
  }

  setCamera(m) {
    this.settings.camera = m;
    this.chase.mode = m;
    this.saveSettings();
  }

  startRace() {
    this.stopAttract();
    this.showLight.intensity = 0;
    const pk = this.selectedCar, rk = pk === 'waymo' ? 'cybercab' : 'waymo';
    this.pKey = pk;
    this.rKey = this.mode === 'arcade' ? rk : null;
    this.player = this.vehicles[pk];
    this.rival = this.rKey ? this.vehicles[this.rKey] : null;
    this.pInfo = CAR_INFO[pk];
    this.rInfo = this.rKey ? CAR_INFO[this.rKey] : null;
    this.playerDriver = { isPlayer: true, name: this.pInfo.name, money: 0, deliveries: 0 };
    this.rivalDriver = this.rival ? { isPlayer: false, name: this.rInfo.name, money: 0, deliveries: 0 } : null;
    this.missions.reset();
    this.rivalAI = this.rival ? new RivalAI(this.rival, this.rivalDriver, this.missions) : null;
    // start positions (Powell St at Union Square, heading north)
    const x = L.lineX(8), z = L.lineZ(9) + 30;
    this.player.place(x + L.LANES[1], z, Math.PI);
    if (this.rival) this.rival.place(x + L.LANES[0], z + 9, Math.PI);
    for (const v of Object.values(this.vehicles)) {
      const used = v === this.player || v === this.rival;
      v.model.root.visible = used;
      v.model.blob.visible = used;
      v.frozen = true;
      v.boosting = false;
      v.extraTop = v.extraAccel = 0;
    }
    this.stats = { stunts: 0, bestCombo: 0, bestAir: 0, smashed: 0, fails: 0, stolen: 0, rivalDeliveries: 0 };
    this.timer = this.mode === 'arcade' ? 90 : null;
    this.boost = 0.6;
    this.special = 0.35;
    this.specialT = 0;
    this.combo = 0;
    this.comboT = 0;
    this.driftT = 0;
    this.crashCool = 0;
    this.lineCool = 0;
    this.tickLast = 99;
    this.waterT = 0;
    this.route = null;
    this.menus.hideAll();
    if (this.rivalTag) { this.world.scene.remove(this.rivalTag); this.rivalTag.material.map.dispose(); this.rivalTag.material.dispose(); this.rivalTag = null; }
    if (this.rInfo) this.rivalTag = this.makeTag(this.rInfo.name, this.rInfo.color);
    this.hud.setPlayers(this.pInfo.name, this.rInfo ? this.rInfo.name : null, this.pInfo.color, this.rInfo ? this.rInfo.color : '#888', this.pInfo.special);
    this.hud.show(true);
    if (this.touchEl) this.touchEl.classList.remove('hidden');
    this.chase.snap(this.player);
    this.state = 'countdown';
    this.countT = 0;
    this.countN = 4;
    this.audio.playMusic('game');
    this.audio.setMusicIntensity(0.3);
    this.hud.hint('Pick up a passenger — stop inside the glowing ring!');
  }

  restart() {
    this.menus.hideAll();
    this.startRace();
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    this.menus.show('pause');
    this.audio.setPaused(true);
    if (this.yt) this.yt.setVolume(this.settings.music, 0.35);
  }

  resume() {
    this.menus.hideAll();
    this.state = 'play';
    this.audio.setPaused(false);
    if (this.yt) this.yt.setVolume(this.settings.music, 1);
    this.last = performance.now();
  }

  endGame() {
    this.state = 'over';
    this.overT = 0;
    this.hud.center('TIME UP!', 2.6, 'red');
    this.audio.play('game_over');
    this.audio.setMusicIntensity(0);
    this.player.setInput({ throttle: 0, brake: 0.6, steer: 0, handbrake: false });
  }

  showResults() {
    this.state = 'results';
    this.hud.show(false);
    if (this.touchEl) this.touchEl.classList.add('hidden');
    this.audio.stopCar();
    this.audio.playMusic('results');
    const m = this.playerDriver.money;
    const rank = m >= 1200 ? 'S' : m >= 800 ? 'A' : m >= 500 ? 'B' : m >= 300 ? 'C' : m >= 150 ? 'D' : 'E';
    this.settings.best = this.settings.best || {};
    const prevBest = this.settings.best[this.pKey] || 0;
    const record = m > prevBest && m > 0;
    if (record) { this.settings.best[this.pKey] = m; this.saveSettings(); }
    this.menus.showResults({
      playerName: this.pInfo.name, playerColor: this.pInfo.color, money: m,
      deliveries: this.playerDriver.deliveries, fails: this.stats.fails, stunts: this.stats.stunts,
      bestCombo: this.stats.bestCombo, bestAir: this.stats.bestAir, smashed: this.stats.smashed,
      rival: !!this.rival, rivalName: this.rInfo?.name, rivalColor: this.rInfo?.color,
      rivalMoney: this.rivalDriver?.money || 0, rivalDeliveries: this.rivalDriver?.deliveries || 0, stolen: this.stats.stolen, rank,
      best: Math.max(prevBest, m), record,
    });
  }

  playerFare() {
    return this.playerDriver ? this.missions.fareOf(this.playerDriver) : null;
  }

  // ---------------------------------------------------------------- loop
  frame() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.time += dt;
    this.input.update();
    this.dynamicResolution(dt);
    switch (this.state) {
      case 'title': this.updateTitle(dt); break;
      case 'select': this.updateSelect(dt); break;
      case 'countdown': this.updateCountdown(dt); break;
      case 'play': this.updatePlay(dt); break;
      case 'paused': this.menus.handle(this.input); break;
      case 'over': this.updateOver(dt); break;
      case 'freecam': this.updateAmbient(dt, this.camera.position); break; // debug / photo mode
      case 'results': this.updateAmbient(dt, this.player ? this.player.pos : this.camera.position); this.menus.handle(this.input); break;
      default: break;
    }
    this.R.render(dt);
    this.input.endFrame();
  }

  dynamicResolution(dt) {
    const f = this.fps;
    f.acc += dt; f.frames++;
    if (f.acc >= 1.5) {
      const avg = f.acc / f.frames;
      if (avg > 1 / 42 && this.R.scale > 0.6) { f.slow++; f.fast = 0; } else if (avg < 1 / 58 && this.R.scale < 1) { f.fast++; f.slow = 0; } else { f.slow = 0; f.fast = 0; }
      if (f.slow >= 2) { this.R.scale = Math.max(0.6, this.R.scale - 0.1); this.R.resize(); f.slow = 0; }
      if (f.fast >= 4) { this.R.scale = Math.min(1, this.R.scale + 0.1); this.R.resize(); f.fast = 0; }
      f.acc = 0; f.frames = 0;
    }
  }

  // shared ambient simulation (traffic, peds, props, fx, world)
  updateAmbient(dt, focus) {
    const vehicles = [];
    if (this.attract) for (const a of this.attract) vehicles.push(a.v);
    else {
      if (this.player && this.player.model.root.visible) vehicles.push(this.player);
      if (this.rival && this.rival.model.root.visible) vehicles.push(this.rival);
    }
    const focusObj = { pos: focus };
    this.traffic.update(dt, { player: focusObj, vehicles, collision: this.collision });
    for (const e of this.traffic.events) if (e.type === 'honk') this.spatial('horn', e, 0.6);
    this.peds.update(dt, { camera: this.camera, cars: vehicles, focus });
    this.props.updateSignals((i, j, axis) => signalPhase(this.traffic.time, i, j, axis));
    this.props.update(dt, focus);
    this.particles.update(dt);
    this.updateCableCars(dt);
    this.updateAmbientAudio(dt, focus);
    this.updateRivalTag();
    for (const fn of this.animated) fn(this.time);
    for (const m of Object.values(this.models)) {
      if (!m.root.visible) continue;
      const v = this.vehicles[m === this.models.waymo ? 'waymo' : 'cybercab'];
      m.blob.position.set(v.pos.x, L.groundHeight(v.pos.x, v.pos.z) + 0.04, v.pos.z);
      m.blob.rotation.z = v.yaw;
      m.blob.material.opacity = v.grounded ? 0.62 : Math.max(0.1, 0.62 - (v.pos.y - L.groundHeight(v.pos.x, v.pos.z)) * 0.08);
      const nf = this.world.nightFactor;
      m.headPool.visible = nf > 0.2;
      if (nf > 0.2) {
        const hx = v.pos.x + Math.sin(v.yaw) * 7.5, hz = v.pos.z + Math.cos(v.yaw) * 7.5;
        m.headPool.position.set(hx, L.groundHeight(hx, hz) + 0.07, hz);
        m.headPool.rotation.z = v.yaw;
        m.headPool.material.opacity = nf * (v.grounded ? 0.75 : 0.25);
      }
    }
    this.world.update(dt, this.camera, focus, this.R);
  }

  updateAmbientAudio(dt, focus) {
    this.gullT = (this.gullT ?? 6) - dt;
    if (this.gullT > 0) return;
    this.gullT = 7 + Math.random() * 9;
    const nearWater = focus.z < L.CITY_MIN + 90 || focus.x > L.CITY_MAX - 90;
    if (nearWater) this.audio.play('seagull', { volume: 0.35 + Math.random() * 0.25, pan: Math.random() * 1.6 - 0.8 });
  }

  updateCableCars(dt) {
    const x0 = L.lineX(L.CABLE_CAR_LINE);
    for (const c of this.cableCars) {
      // simple shuttle along Powell between Bay St and Market St
      const lane = c.dir > 0 ? -L.LANES[0] : L.LANES[0];
      let speed = c.speed;
      // stop for the player in front
      if (this.player && this.player.model.root.visible) {
        const dz = (this.player.pos.z - c.z) * c.dir;
        if (dz > 0 && dz < 14 && Math.abs(this.player.pos.x - (x0 + lane)) < 2.4) speed = 0;
      }
      c.z += c.dir * speed * dt;
      if (c.z > L.lineZ(12) - 14) c.dir = -1;
      if (c.z < L.lineZ(1) + 14) c.dir = 1;
      const x = x0 + lane;
      const y = L.groundHeight(x, c.z);
      const hF = L.groundHeight(x, c.z + c.dir * 3), hB = L.groundHeight(x, c.z - c.dir * 3);
      c.model.position.set(x, y, c.z);
      c.model.rotation.set(0, c.dir > 0 ? 0 : Math.PI, 0);
      c.model.rotateX(-Math.atan2(hF - hB, 6));
      c.ringT -= dt;
      if (c.ringT < 0) {
        c.ringT = 6 + Math.random() * 6;
        this.spatial('cable_bell', { x, y, z: c.z }, 0.7);
      }
      // collision with the player
      if (this.player && this.player.model.root.visible) {
        const p = this.player;
        const dx = p.pos.x - x, dz = p.pos.z - c.z;
        if (Math.abs(dx) < 2.3 && Math.abs(dz) < 5.6) {
          const nx = Math.abs(dx) / 2.3 > Math.abs(dz) / 5.6 ? Math.sign(dx) : 0;
          const nz = nx ? 0 : Math.sign(dz);
          const vn = p.vel.x * nx + p.vel.z * nz;
          if (nx) p.pos.x = x + nx * 2.31; else p.pos.z = c.z + nz * 5.61;
          if (vn < 0) {
            p.vel.x -= nx * vn * 1.3; p.vel.z -= nz * vn * 1.3;
            this.onCrash(-vn, p.pos.x - nx, p.pos.y + 1, p.pos.z - nz, nx, nz, 'cable');
          }
        }
      }
    }
  }

  spatial(name, at, vol = 1) {
    const cam = this.camera.position;
    const dx = at.x - cam.x, dz = at.z - cam.z;
    const d = Math.hypot(dx, dz);
    if (d > 160) return;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const pan = clamp((dx * right.x + dz * right.z) / Math.max(d, 1), -1, 1);
    this.audio.play(name, { volume: vol * Math.max(0, 1 - d / 160) ** 1.5, pan });
  }

  // ---------------------------------------------------------------- attract mode (title)
  startAttract() {
    const dests = L.DESTINATIONS;
    this.attract = [];
    const starts = [[L.lineX(8) + L.LANES[1], L.lineZ(9) + 30, Math.PI], [L.lineX(8) + L.LANES[0], L.lineZ(9) + 42, Math.PI]];
    ['waymo', 'cybercab'].forEach((k, n) => {
      const v = this.vehicles[k];
      v.place(starts[n][0], starts[n][1], starts[n][2]);
      v.frozen = false;
      v.boosting = false;
      v.extraTop = v.extraAccel = 0;
      v.model.root.visible = true;
      v.model.blob.visible = true;
      const fake = { dest: dests[Math.floor(Math.random() * dests.length)] };
      const stub = { waiting: [], fareOf: () => fake };
      const ai = new RivalAI(v, { isPlayer: false }, stub);
      this.attract.push({ v, ai, fake, key: k });
    });
    this.titleShot = 0;
    this.titleShotT = 0;
  }

  updateAttract(dt) {
    if (!this.attract) return;
    for (const a of this.attract) {
      const d = Math.hypot(a.fake.dest.x - a.v.pos.x, a.fake.dest.z - a.v.pos.z);
      if (d < 22 || a.v.inWater) {
        if (a.v.inWater) this.respawn(a.v, true);
        let nd;
        do { nd = L.DESTINATIONS[Math.floor(Math.random() * L.DESTINATIONS.length)]; } while (Math.hypot(nd.x - a.v.pos.x, nd.z - a.v.pos.z) < 300);
        a.fake.dest = nd;
        a.ai.path = [];
      }
      a.ai.update(dt, { player: this.attract[0].v, traffic: this.traffic.cars, playerMoney: 0, rivalMoney: 0, difficulty: 1.5, allowBoost: true });
      a.v.update(dt, { collision: this.collision });
      for (const car of this.traffic.cars) if (car.active) this.collideTraffic(a.v, car, false);
      this.vehicleFx(a.v, dt, false);
    }
    this.collideVehicles(this.attract[0].v, this.attract[1].v);
  }

  stopAttract() {
    this.attract = null;
  }

  // ---------------------------------------------------------------- title
  updateTitle(dt) {
    this.titleT += dt;
    if (!this.titlePath) {
      const P = (x, y, z) => new THREE.Vector3(x, y, z);
      this.titlePath = new THREE.CatmullRomCurve3([
        P(330, 34, -640), P(120, 70, -560), P(-60, 72, -330), P(-120, 64, -210), P(40, 90, -40), P(240, 120, 120),
        P(560, 70, 160), P(620, 40, 400), P(420, 60, 560), P(160, 90, 420), P(-200, 80, 330), P(-460, 60, 260),
        P(-560, 70, -200), P(-300, 60, -560),
      ], true, 'centripetal');
      this.titleLook = new THREE.CatmullRomCurve3([
        P(250, 20, -380), P(-40, 40, -240), P(-80, 30, -240), P(80, 40, 40), P(380, 60, -40), P(420, 70, 40),
        P(500, 20, 360), P(500, 30, 430), P(200, 20, 300), P(-100, 30, 200), P(-400, 30, 370), P(-560, 300, -1100),
        P(-1900, 80, -1180), P(80, 20, -480),
      ], true, 'centripetal');
    }
    this.updateAttract(dt);
    this.titleShotT += dt;
    const shotLen = this.titleShot === 0 ? 12 : 7;
    if (this.titleShotT > shotLen) { this.titleShotT = 0; this.titleShot = (this.titleShot + 1) % 3; this.titleCut = true; }
    if (this.titleShot === 0 || !this.attract) {
      const t = (this.titleT / 150) % 1;
      const p = this.titlePath.getPointAt(t), l = this.titleLook.getPointAt((t + 0.004) % 1);
      let sky = 0;
      for (const [ox, oz] of [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30]]) sky = Math.max(sky, this.world.city.skylineAt(p.x + ox, p.z + oz));
      p.y = Math.max(p.y, L.groundHeight(p.x, p.z) + 12, sky + 14);
      this.camera.position.lerp(p, this.titleCut || this.titleT < 0.1 ? 1 : Math.min(1, dt * 2));
      if (!this.titleLookSm || this.titleCut) this.titleLookSm = l.clone();
      this.titleLookSm.lerp(l, Math.min(1, dt * 1.5));
      this.camera.lookAt(this.titleLookSm);
      this.camera.fov = damp(this.camera.fov, 55, 2, dt);
    } else {
      // cinematic tracking shot alongside one of the robotaxis
      const v = this.attract[this.titleShot - 1].v;
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), lx = Math.cos(v.yaw), lz = -Math.sin(v.yaw);
      const side = this.titleShot === 1 ? 1 : -1;
      const swing = Math.sin(this.titleShotT * 0.35) * 2.5;
      const target = new THREE.Vector3(v.pos.x + lx * 5.2 * side + fx * (3 + swing), v.pos.y + 1.3, v.pos.z + lz * 5.2 * side + fz * (3 + swing));
      target.y = Math.max(target.y, L.groundHeight(target.x, target.z) + 0.8);
      if (this.titleCut) this.camera.position.copy(target);
      this.camera.position.lerp(target, Math.min(1, dt * 6));
      this.camera.lookAt(v.pos.x + fx * 1.5, v.pos.y + 0.9, v.pos.z + fz * 1.5);
      this.camera.fov = damp(this.camera.fov, 40, 4, dt);
    }
    this.titleCut = false;
    this.camera.updateProjectionMatrix();
    this.updateAmbient(dt, this.camera.position);
    if (this.menus.current === 'title') this.menus.handle(this.input);
    else if (this.menus.current === 'settings') this.menus.handle(this.input);
  }

  updateSelect(dt) {
    const sel = this.vehicles[this.selectedCar];
    this.showroom.yaw += dt * 0.45;
    sel.yaw = this.showroom.yaw;
    sel.syncVisual(dt);
    const other = this.vehicles[this.selectedCar === 'waymo' ? 'cybercab' : 'waymo'];
    other.syncVisual(dt);
    const cx = this.showroom.x, cz = this.showroom.z;
    const gy = L.groundHeight(cx, cz);
    const sway = Math.sin(this.time * 0.25) * 0.8;
    const portrait = this.camera.aspect < 1;
    // landscape: car framed right of the info card; portrait: car centered above the card
    const camT = portrait
      ? new THREE.Vector3(cx - 8.4, gy + 2.6 + sway * 0.1, cz + 2.2 + sway)
      : new THREE.Vector3(cx - 8.6, gy + 2.1 + sway * 0.1, cz + 3.4 + sway);
    this.camera.position.lerp(camT, Math.min(1, dt * 3));
    const look = portrait ? new THREE.Vector3(cx, gy - 1.6, cz - 0.6) : new THREE.Vector3(cx + 0.4, gy + 1.0, cz - 2.6);
    this.camLook.lerp(look, Math.min(1, dt * 4));
    this.camera.lookAt(this.camLook);
    this.camera.fov = damp(this.camera.fov, portrait ? 66 : 42, 3, dt);
    this.camera.updateProjectionMatrix();
    // key light on the showroom car so it reads at night too
    this.showLight.position.set(cx - 6, gy + 7.5, cz + 5);
    this.showLight.target.position.set(cx, gy + 0.6, cz);
    this.showLight.intensity = 20 + 100 * this.world.nightFactor;
    this.updateAmbient(dt, new THREE.Vector3(cx, gy, cz));
    this.menus.handle(this.input);
  }

  updateCountdown(dt) {
    this.countT -= dt;
    if (this.countT <= 0) {
      this.countN--;
      if (this.countN > 0) {
        this.menus.countdown(String(this.countN));
        this.audio.play('countdown');
        this.countT = 0.85;
      } else {
        this.menus.countdown('GO!');
        this.audio.play('go');
        this.state = 'play';
        this.player.frozen = false;
        if (this.rival) this.rival.frozen = false;
        setTimeout(() => { if (this.state !== 'countdown') this.menus.hideCountdown(); }, 800);
      }
    }
    this.player.syncVisual(dt);
    if (this.rival) this.rival.syncVisual(dt);
    this.chase.update(dt, this.player, 0, this.collision);
    this.updateAmbient(dt, this.player.pos);
    this.hud.update(dt, this.hudData());
    this.audio.updateCar({ speed: 0, maxSpeed: 45, throttle: this.input.state.throttle, brake: 0, drift: 0, grounded: true, boost: false, ludicrous: false, carType: this.pKey, surface: 'road' });
  }

  updateOver(dt) {
    this.overT += dt;
    this.player.setInput({ throttle: 0, brake: 0.6, steer: 0, handbrake: false });
    this.player.update(dt, { collision: this.collision });
    if (this.rival) { this.rival.setInput({ throttle: 0, brake: 1, steer: 0 }); this.rival.update(dt, { collision: this.collision }); }
    this.chase.update(dt, this.player, 0, this.collision);
    this.updateAmbient(dt, this.player.pos);
    this.audio.updateCar({ speed: this.player.speed, maxSpeed: 45, throttle: 0, brake: 0.6, drift: 0, grounded: true, boost: false, ludicrous: false, carType: this.pKey, surface: 'road' });
    if (this.overT > 2.8) this.showResults();
  }

  // ---------------------------------------------------------------- play
  updatePlay(dt) {
    const inp = this.input.state;
    const P = this.player;
    if (this.input.hit('Escape', 'KeyP')) { this.pause(); return; }
    if (this.input.hit('KeyC')) this.setCamera((this.settings.camera + 1) % 3);
    if (this.input.hit('KeyN')) {
      if (this.yt && this.yt.active) this.yt.next();
      else this.audio.nextTrack();
    }
    this.chase.lookBack = this.input.down('KeyB');
    if (inp.horn) this.audio.play('horn_player');
    // timer
    if (this.timer !== null) {
      this.timer -= dt;
      const sec = Math.ceil(this.timer);
      if (this.timer <= 10 && sec !== this.tickLast && sec >= 0) { this.tickLast = sec; this.audio.play('tick'); }
      this.audio.setMusicIntensity(this.timer < 10 ? 1 : 0.55 + (P.boosting ? 0.3 : 0));
      if (this.timer <= 0) { this.timer = 0; this.endGame(); return; }
    }
    // boost meter
    const wantBoost = inp.boost && this.boost > 0.04 && inp.throttle > 0;
    if (wantBoost && !P.boosting) this.audio.play('boost_start');
    P.boosting = wantBoost;
    this.boost = clamp(this.boost + (P.boosting ? -0.3 : 0.045) * dt, 0, 1);
    // special
    this.special = clamp(this.special + dt * 0.012, 0, 1);
    if (inp.special && this.special >= 1 && this.specialT <= 0) this.activateSpecial();
    this.updateSpecial(dt);
    // drive
    P.setInput(inp);
    P.update(dt, { collision: this.collision });
    if (this.rival) {
      this.rivalAI.update(dt, { player: P, traffic: this.traffic.cars, playerMoney: this.playerDriver.money, rivalMoney: this.rivalDriver.money, difficulty: 1, allowBoost: true });
      this.rival.update(dt, { collision: this.collision });
    }
    // vehicle collisions
    for (const car of this.traffic.cars) {
      if (!car.active) continue;
      this.collideTraffic(P, car, true);
      if (this.rival) this.collideTraffic(this.rival, car, false);
    }
    if (this.rival) this.collideVehicles(P, this.rival);
    this.nearMisses(P, dt);
    // events
    this.handleEvents(P, true);
    if (this.rival) this.handleEvents(this.rival, false);
    // stunts
    this.trackStunts(dt);
    // missions
    const evts = this.missions.update(dt, { player: P, rival: this.rival, playerDriver: this.playerDriver, rivalDriver: this.rivalDriver });
    for (const e of evts) this.onMission(e);
    // reset if stuck / fallen
    if (this.input.hit('KeyR')) this.respawn(P);
    if (P.inWater) {
      this.waterT += dt;
      if (this.waterT > 1.4) { this.respawn(P); this.waterT = 0; }
    }
    if (this.rival && this.rival.inWater) this.respawn(this.rival, true);
    // fx
    this.vehicleFx(P, dt, true);
    if (this.rival) this.vehicleFx(this.rival, dt, false);
    // camera & world
    const boostFx = P.boosting ? 1 : 0;
    const lud = this.specialT > 0 && this.pKey === 'cybercab' ? 1 : 0;
    this.chase.update(dt, P, Math.max(boostFx, lud), this.collision);
    this.R.setSpeedFx(clamp((P.speed - 34) / 30, 0, 0.5) * 0.45 + boostFx * 0.22 + lud * 0.32, lud * 0.55 + boostFx * 0.18);
    this.updateArrow(dt);
    this.updateAmbient(dt, P.pos);
    // audio
    this.audio.updateCar({
      speed: P.speed, maxSpeed: P.spec.maxSpeed, throttle: inp.throttle, brake: inp.brake,
      drift: P.grounded ? clamp((Math.abs(P.slipAngle) - 0.12) * 2.2, 0, 1) * clamp(P.speed / 12, 0, 1) : 0,
      grounded: P.grounded, boost: P.boosting, ludicrous: lud > 0, carType: this.pKey, surface: P.surface === 'grass' ? 'grass' : 'road',
    });
    // hud
    this.hud.update(dt, this.hudData());
    this.crashCool -= dt;
    this.lineCool -= dt;
  }

  hudData() {
    const P = this.player;
    const fare = this.playerFare();
    const lud = this.specialT > 0 && this.pKey === 'cybercab';
    return {
      money: this.playerDriver.money, rivalMoney: this.rivalDriver ? this.rivalDriver.money : 0,
      timer: this.timer, fare, speed: P.speed, boost: this.boost, special: this.special, specialActive: this.specialT > 0,
      boosting: P.boosting || lud, street: L.streetNameAt(P.pos.x, P.pos.z), player: P, rival: this.rival,
      waiting: this.missions.waiting, route: fare ? this.route : null,
      rivalColor: this.rInfo ? this.rInfo.color : null, playerColor: this.pInfo.color,
    };
  }

  respawn(v, quiet = false) {
    // nearest street point
    const gx = clamp((v.pos.x - L.ORIGIN) / L.S, 0, L.N), gz = clamp((v.pos.z - L.ORIGIN) / L.S, 0, L.N);
    const ni = Math.round(gx), nj = Math.round(gz);
    const dx = Math.abs(v.pos.x - L.lineX(ni)), dz = Math.abs(v.pos.z - L.lineZ(nj));
    let x, z, yaw;
    if (dx < dz) { x = L.lineX(ni) + L.LANES[1]; z = clamp(v.pos.z, L.lineZ(0) + 20, L.lineZ(L.N) - 20); yaw = Math.PI; }
    else { z = L.lineZ(nj) - L.LANES[1]; x = clamp(v.pos.x, L.lineX(0) + 20, L.lineX(L.N) - 20); yaw = Math.PI / 2; }
    if (nj === 0 && dx >= dz) z = L.lineZ(0) - L.LANES[1];
    v.place(x, z, yaw);
    if (v === this.player) { this.chase.snap(v); if (!quiet) this.hud.center('RESET', 0.9); }
  }

  // ---------------------------------------------------------------- collisions
  collideVehicles(a, b) {
    const ra = a.radius, rb = b.radius;
    const fa = [Math.sin(a.yaw), Math.cos(a.yaw)], fb = [Math.sin(b.yaw), Math.cos(b.yaw)];
    let best = null;
    for (const oa of a.circleOffsets) for (const ob of b.circleOffsets) {
      const ax = a.pos.x + fa[0] * oa, az = a.pos.z + fa[1] * oa;
      const bx = b.pos.x + fb[0] * ob, bz = b.pos.z + fb[1] * ob;
      const dx = ax - bx, dz = az - bz;
      const d = Math.hypot(dx, dz);
      const pen = ra + rb - d;
      if (pen > 0 && (!best || pen > best.pen)) best = { pen, nx: dx / (d || 1), nz: dz / (d || 1), x: (ax + bx) / 2, z: (az + bz) / 2 };
    }
    if (!best || Math.abs(a.pos.y - b.pos.y) > 1.6) return;
    const ma = a.mass, mb = b.mass;
    const ia = 1 / ma, ib = 1 / mb;
    a.pos.x += best.nx * best.pen * (ia / (ia + ib));
    a.pos.z += best.nz * best.pen * (ia / (ia + ib));
    b.pos.x -= best.nx * best.pen * (ib / (ia + ib));
    b.pos.z -= best.nz * best.pen * (ib / (ia + ib));
    const vn = (a.vel.x - b.vel.x) * best.nx + (a.vel.z - b.vel.z) * best.nz;
    if (vn < 0) {
      const j = (-(1.3) * vn) / (ia + ib);
      a.vel.x += best.nx * j * ia; a.vel.z += best.nz * j * ia;
      b.vel.x -= best.nx * j * ib; b.vel.z -= best.nz * j * ib;
      a.yawRate += (Math.random() - 0.5) * -vn * 0.1;
      b.yawRate += (Math.random() - 0.5) * -vn * 0.1;
      this.onCrash(-vn, best.x, a.pos.y + 0.7, best.z, best.nx, best.nz, 'car', a === this.player || b === this.player);
    }
  }

  collideTraffic(v, car, isPlayer) {
    const dx0 = v.pos.x - car.pos.x, dz0 = v.pos.z - car.pos.z;
    if (dx0 * dx0 + dz0 * dz0 > 100) return;
    if (Math.abs(v.pos.y - car.pos.y) > 1.8) return;
    const rc = car.wid * 0.5;
    const offs = [car.len * 0.3, 0, -car.len * 0.3];
    if (car.type === 'bus') offs.push(car.len * 0.15, -car.len * 0.15);
    const fc = [Math.sin(car.yaw), Math.cos(car.yaw)];
    const fv = [Math.sin(v.yaw), Math.cos(v.yaw)];
    let best = null;
    for (const ov of v.circleOffsets) for (const oc of offs) {
      const ax = v.pos.x + fv[0] * ov, az = v.pos.z + fv[1] * ov;
      const bx = car.pos.x + fc[0] * oc, bz = car.pos.z + fc[1] * oc;
      const dx = ax - bx, dz = az - bz;
      const d = Math.hypot(dx, dz);
      const pen = v.radius + rc - d;
      if (pen > 0 && (!best || pen > best.pen)) best = { pen, nx: dx / (d || 1), nz: dz / (d || 1), x: (ax + bx) / 2, z: (az + bz) / 2 };
    }
    if (!best) return;
    car.nmHit = true;
    const ram = isPlayer && this.specialT > 0 && this.pKey === 'cybercab';
    const mv = v.mass * (ram ? 8 : 1.6), mc = car.mass;
    const iv = 1 / mv, ic = 1 / mc;
    v.pos.x += best.nx * best.pen * (iv / (iv + ic));
    v.pos.z += best.nz * best.pen * (iv / (iv + ic));
    car.pos.x -= best.nx * best.pen * (ic / (iv + ic));
    car.pos.z -= best.nz * best.pen * (ic / (iv + ic));
    const cvx = car.mode === 'drive' ? Math.sin(car.yaw) * car.speed : car.vel.x;
    const cvz = car.mode === 'drive' ? Math.cos(car.yaw) * car.speed : car.vel.z;
    const vn = (v.vel.x - cvx) * best.nx + (v.vel.z - cvz) * best.nz;
    if (vn < 0) {
      const j = (-1.35 * vn) / (iv + ic);
      v.vel.x += best.nx * j * iv; v.vel.z += best.nz * j * iv;
      const spin = (Math.random() - 0.5) * Math.min(6, -vn * 0.35);
      this.traffic.knock(car, -best.nx * j * ic, -best.nz * j * ic, spin, Math.min(6, -vn * 0.25) * (ram ? 1.8 : 1));
      v.yawRate += (Math.random() - 0.5) * Math.min(1.5, -vn * 0.05);
      this.onCrash(-vn, best.x, v.pos.y + 0.8, best.z, best.nx, best.nz, 'car', isPlayer);
    } else if (car.mode === 'drive' && best.pen > 0.4) {
      this.traffic.knock(car, -best.nx * 2, -best.nz * 2, 0, 0);
    }
  }

  nearMisses(P, dt) {
    if (P.speed < 14) return;
    const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
    for (const car of this.traffic.cars) {
      if (!car.active) continue;
      const rx = car.pos.x - P.pos.x, rz = car.pos.z - P.pos.z;
      const along = rx * fx + rz * fz;
      const lat = Math.abs(rx * fz - rz * fx);
      const half = (P.dims.length + car.len) * 0.5;
      const close = Math.abs(along) < half && lat < (P.dims.width + car.wid) * 0.5 + 1.4;
      if (close && !car.nm) { car.nm = true; car.nmHit = false; car.nmT = 0; }
      if (car.nm) {
        car.nmT += dt;
        if (!close || car.nmT > 2) {
          const passed = along < -half * 0.5;
          if (passed && !car.nmHit && car.nmT < 2) this.stunt('through');
          car.nm = false;
        }
      }
    }
  }

  onCrash(impulse, x, y, z, nx, nz, kind, isPlayer = true) {
    if (impulse > 2.5) this.particles.sparks(x, y, z, nx, nz, Math.min(40, Math.round(impulse * 2)), Math.min(1.6, impulse / 10));
    if (impulse > 9) this.particles.smoke(x, y, z, 0, 0, 1.2);
    if (isPlayer) {
      this.chase.addShake(Math.min(1, impulse / 18));
      if (impulse > 6) this.audio.play('crash', { intensity: clamp(impulse / 25, 0.2, 1) });
      else if (impulse > 2) this.audio.play(kind === 'car' ? 'bump' : 'scrape', { volume: clamp(impulse / 6, 0.3, 1) });
      if (impulse > 7.5 && this.state === 'play') {
        if (this.combo > 1) this.hud.popup('COMBO BROKEN', '', '#ff3b5c');
        this.combo = 0;
        const fare = this.playerFare();
        if (fare && this.lineCool <= 0) {
          this.hud.dialog('PASSENGER:', this.missions.line(this.missions.lines.CRASH_LINES), '#ff3b5c', 2.2);
          this.lineCool = 4;
        }
      }
    } else if (impulse > 6) this.spatial('crash', { x, z }, clamp(impulse / 25, 0.2, 0.8));
  }

  handleEvents(v, isPlayer) {
    for (const e of v.events) {
      switch (e.type) {
        case 'land':
          if (isPlayer) {
            if (e.impact > 4) this.chase.addShake(Math.min(0.8, e.impact / 25));
            if (e.impact > 3) this.audio.play('land', { intensity: clamp(e.impact / 20, 0.2, 1) });
            if (e.impact > 13) {
              this.particles.sparks(v.pos.x, v.pos.y + 0.2, v.pos.z, 0, 0, 24, 0.8);
              this.particles.dust(v.pos.x, v.pos.y, v.pos.z, 8, [0.6, 0.6, 0.62]);
            }
            if (e.air > 0.55) this.stunt('jump', e.air);
          }
          break;
        case 'takeoff':
          if (isPlayer && v.speed > 16) this.audio.play('jump', { volume: 0.7 });
          break;
        case 'crash':
          this.onCrash(e.impulse, e.x, e.y, e.z, e.nx, e.nz, e.kind, isPlayer);
          break;
        case 'break': {
          const rec = e.item.data.rec;
          this.props.hit(rec, e.vx, e.vz, e.speed);
          const col = rec.name === 'trash' ? [0.2, 0.45, 0.25] : rec.name === 'news' ? [0.8, 0.3, 0.3] : rec.name === 'cones' ? [1, 0.45, 0.1] : rec.name === 'mailboxes' ? [0.15, 0.3, 0.7] : [0.7, 0.7, 0.7];
          this.particles.debris(rec.x, rec.y, rec.z, e.vx, e.vz, 14, col);
          if (isPlayer) {
            this.audio.play(rec.material === 'wood' ? 'break_wood' : rec.material === 'plastic' ? 'break_plastic' : 'break_metal', { volume: 0.9 });
            this.stats.smashed++;
            this.chase.addShake(0.12);
          } else this.spatial('break_metal', rec, 0.5);
          if (rec.name === 'hydrant') {
            this.geysers = this.geysers || [];
            this.geysers.push({ x: rec.x, y: rec.y, z: rec.z, t: 6 });
            if (isPlayer) this.audio.play('hydrant');
          }
          break;
        }
        case 'knock': {
          // pole / tree: one solid knock, then it topples out of the way
          const rec = e.item.data.rec;
          this.props.knock(rec, e.vx, e.vz, e.speed);
          const tree = rec.kind === 'tree';
          if (tree) this.particles.leaves(rec.x, rec.y + 2.5, rec.z, 22);
          else this.particles.sparks(e.x, e.y, e.z, e.nx, e.nz, 22, 1.0);
          if (isPlayer) {
            this.audio.play(tree ? 'break_wood' : 'crash', { volume: 1, intensity: clamp(e.impulse / 25, 0.25, 0.7) });
            this.chase.addShake(clamp(e.impulse / 30, 0.15, 0.45));
            this.stats.smashed++;
          } else this.spatial(tree ? 'break_wood' : 'crash', rec, 0.5);
          break;
        }
        case 'soft':
          this.particles.leaves(e.x, v.pos.y, e.z, 6);
          break;
        case 'water':
          this.particles.splash(v.pos.x, 0.2, v.pos.z);
          if (isPlayer) {
            this.audio.play('splash');
            this.hud.center('SPLASH!<small>The Bay is not a road</small>', 1.4, '');
            this.chase.addShake(0.5);
          } else this.spatial('splash', v.pos, 0.6);
          break;
        default: break;
      }
    }
  }

  // ---------------------------------------------------------------- stunts
  trackStunts(dt) {
    const P = this.player;
    if (P.drifting && P.grounded && P.speed > 11) this.driftT += dt;
    else {
      if (this.driftT > 0.75) this.stunt('drift', this.driftT);
      this.driftT = 0;
    }
    if (!P.grounded) this.stats.bestAir = Math.max(this.stats.bestAir, P.airTime);
    this.comboT -= dt;
    if (this.comboT <= 0) this.combo = 0;
    // hydrant geysers
    if (this.geysers) {
      for (let k = this.geysers.length - 1; k >= 0; k--) {
        const g = this.geysers[k];
        g.t -= dt;
        this.particles.water(g.x, g.y + 0.6, g.z, 3, 11, 0.9);
        if (g.t <= 0) this.geysers.splice(k, 1);
      }
    }
  }

  stunt(kind, amount = 0) {
    if (this.state !== 'play') return;
    this.combo = this.comboT > 0 ? this.combo + 1 : 1;
    this.comboT = 3.2;
    this.stats.stunts++;
    this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
    let title, base;
    if (kind === 'drift') { title = 'CRAZY DRIFT!'; base = 1 + (amount - 0.75) * 2.2; }
    else if (kind === 'jump') { title = amount > 1.4 ? 'CRAZY MEGA JUMP!' : 'CRAZY JUMP!'; base = 1.5 + amount * 3.5; }
    else { title = 'CRAZY THROUGH!'; base = 1.5; this.audio.play('near_miss'); }
    const fare = this.playerFare();
    const tip = Math.round(base * this.combo * 2) / 2;
    let sub = this.combo > 1 ? `COMBO x${this.combo}` : '';
    if (fare) {
      fare.tips += tip;
      sub = `TIP +$${tip.toFixed(2)}` + (this.combo > 1 ? ` · x${this.combo}` : '');
      this.audio.play('tip', { intensity: clamp(this.combo / 6, 0, 1) });
      if (this.lineCool <= 0 && Math.random() < 0.5) {
        const lines = kind === 'jump' ? this.missions.lines.JUMP_LINES : this.missions.lines.DRIFT_LINES;
        this.hud.dialog('PASSENGER:', this.missions.line(lines), '#39ff88', 2);
        this.lineCool = 3;
      }
    }
    this.audio.play('combo', { intensity: clamp(this.combo / 6, 0, 1) });
    this.hud.popup(title, sub, kind === 'drift' ? '#2de2ff' : kind === 'jump' ? '#ffd60a' : '#ff3bd4', this.combo >= 3);
    this.boost = clamp(this.boost + 0.12 + amount * 0.04, 0, 1);
    this.special = clamp(this.special + 0.06, 0, 1);
  }

  // ---------------------------------------------------------------- special abilities
  activateSpecial() {
    this.special = 0;
    const P = this.player;
    if (this.pKey === 'waymo') {
      this.specialT = 2.0;
      this.pulse = { t: 0, x: P.pos.x, y: P.pos.y, z: P.pos.z, done: new Set() };
      this.audio.play('lidar_pulse');
      this.hud.center('LIDAR PULSE!', 1.2, 'green');
      this.hud.flash('rgba(45,226,255,0.35)');
      this.boost = 1;
    } else {
      this.specialT = 4.5;
      P.extraAccel = 32;
      P.extraTop = 24;
      this.audio.play('ludicrous');
      this.hud.center('LUDICROUS MODE!', 1.2, 'red');
      this.hud.flash('rgba(255,90,54,0.4)');
    }
  }

  updateSpecial(dt) {
    if (this.specialT <= 0) { this.R.scan.set(this._v3.set(0, 0, 0), 0, 0); return; }
    this.specialT -= dt;
    const P = this.player;
    if (this.pKey === 'waymo' && this.pulse) {
      const pu = this.pulse;
      pu.t += dt;
      const radius = pu.t * 120;
      this.R.scan.set(this._v3.set(pu.x, pu.y, pu.z), radius, Math.max(0, 1 - pu.t / 2));
      for (const car of this.traffic.cars) {
        if (!car.active || pu.done.has(car)) continue;
        const dx = car.pos.x - pu.x, dz = car.pos.z - pu.z;
        const d = Math.hypot(dx, dz);
        if (d < radius && d < 75) {
          pu.done.add(car);
          const k = (1 - d / 80) * 16 + 4;
          this.traffic.knock(car, (dx / (d || 1)) * k, (dz / (d || 1)) * k, (Math.random() - 0.5) * 5, 5 + (1 - d / 80) * 4);
        }
      }
      if (this.specialT <= 0) { this.pulse = null; this.R.scan.set(this._v3.set(0, 0, 0), 0, 0); }
    } else if (this.pKey === 'cybercab') {
      if (this.specialT <= 0) { P.extraAccel = 0; P.extraTop = 0; }
    }
  }

  // ---------------------------------------------------------------- missions
  onMission(e) {
    const isP = e.driver === this.playerDriver;
    if (e.type === 'pickup') {
      if (isP) {
        this.audio.play('pickup');
        this.hud.hint(this.playerDriver.deliveries === 0 ? 'Follow the big arrow — stop inside the GREEN beam to drop off!' : '');
        if (this.hintT === undefined) this.hintT = 0;
        this.hud.dialog('PASSENGER:', this.missions.line(this.missions.lines.PICKUP_LINES, e.fare.dest.name), e.fare.tier.css, 3.4);
        this.hud.popup(`${e.fare.dest.icon || ''} ${e.fare.dest.name.toUpperCase()}`, `${Math.round(e.fare.dist)} m · ${e.fare.timeMax}s`, e.fare.tier.css);
        this.route = null;
      } else {
        // did the rival steal the fare the player was going for (the one the arrow pointed at)?
        const w = e.fare.passenger;
        const d = Math.hypot(w.x - this.player.pos.x, w.z - this.player.pos.z);
        const wasTarget = this.seekTarget === w;
        if (d < 90 && wasTarget && !this.playerFare()) {
          this.stats.stolen++;
          this.audio.play('rival_steal');
          this.hud.popup(`${this.rInfo.name} STOLE YOUR FARE!`, '', this.rInfo.color, true);
        }
      }
    } else if (e.type === 'deliver') {
      e.driver.money += e.amount;
      e.driver.deliveries++;
      if (isP) {
        this.audio.play('deliver');
        if (e.driver.deliveries === 1) {
          this.hud.hint('Jump the hills, drift (SPACE) and near-miss traffic with a passenger for TIPS!');
          setTimeout(() => { if (this.state === 'play') this.hud.hint(''); }, 7000);
        } else this.hud.hint('');
        setTimeout(() => this.audio.play('cash'), 250);
        if (this.timer !== null) { this.timer += e.timeBonus; this.audio.play('time_bonus'); }
        this.hud.center(`${e.rating}<small>+$${e.amount.toFixed(2)}${this.timer !== null ? ` · +${e.timeBonus}s` : ''}</small>`, 2.0, e.rating === 'SPEEDY!' ? 'green' : '');
        this.hud.dialog('PASSENGER:', this.missions.line(this.missions.lines.DELIVER_LINES), '#39ff88', 2.6);
        this.particles.cash(this.player.pos.x, this.player.pos.y, this.player.pos.z);
        this.particles.confetti(this.player.pos.x, this.player.pos.y, this.player.pos.z);
        this.special = clamp(this.special + 0.28, 0, 1);
        this.boost = clamp(this.boost + 0.3, 0, 1);
        this.route = null;
      } else {
        this.stats.rivalDeliveries++;
        this.spatial('cash', this.rival.pos, 0.6);
      }
    } else if (e.type === 'fail') {
      if (isP) {
        this.stats.fails++;
        this.audio.play('fail');
        this.hud.center('FARE LOST', 1.6, 'red');
        this.hud.dialog('PASSENGER:', this.missions.line(this.missions.lines.FAIL_LINES), '#ff3b5c', 2.6);
        this.route = null;
      }
    }
  }

  // ---------------------------------------------------------------- fx
  vehicleFx(v, dt, isPlayer) {
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    const lx = Math.cos(v.yaw), lz = -Math.sin(v.yaw);
    const wb = v.dims.wheelbase / 2, tr = v.dims.track / 2;
    const slip = Math.abs(v.slipAngle);
    const hardBrake = v.input.brake > 0.5 && v.forwardSpeed > 16;
    const skid = v.grounded && v.speed > 7 && (slip > 0.22 || hardBrake || v.handbraking);
    const id = isPlayer ? 'p' : 'r';
    for (const s of [-1, 1]) {
      const x = v.pos.x - fx * wb + lx * tr * s, z = v.pos.z - fz * wb + lz * tr * s;
      const key = id + s;
      if (skid) {
        this.skids.mark(key, x, z, fx, fz, clamp(slip * 2 + 0.3, 0.3, 1));
        const amt = clamp(0.45 + slip * 0.8, 0.45, 1);
        if (Math.random() < (hardBrake ? 0.35 : 0.25 + slip * 0.8)) this.particles.smoke(x, v.pos.y + 0.15, z, v.vel.x, v.vel.z, amt);
      } else this.skids.lift(key);
    }
    // boost / ludicrous trails
    const lud = isPlayer && this.specialT > 0 && this.pKey === 'cybercab';
    if (v.boosting || lud) {
      const col = (isPlayer ? this.pKey : this.rKey) === 'waymo' ? [0.4, 3.0, 3.6, 1] : [3.8, 1.2, 0.5, 1];
      for (const s of [-0.55, 0.55]) {
        const x = v.pos.x - fx * (v.dims.length * 0.5 + 0.1) + lx * s, z = v.pos.z - fz * (v.dims.length * 0.5 + 0.1) + lz * s;
        this.particles.trail(x, v.pos.y + 0.55, z, col, lud ? 0.34 : 0.24);
        this.particles.trail(x - v.vel.x * dt * 0.5, v.pos.y + 0.55, z - v.vel.z * dt * 0.5, col, lud ? 0.28 : 0.2);
      }
    }
    // grass / dirt dust
    if (v.surface === 'grass' && v.speed > 8 && Math.random() < 0.5) this.particles.dust(v.pos.x - fx * 2, v.pos.y, v.pos.z - fz * 2, 1, [0.45, 0.5, 0.3]);
    // brake lights
    const tail = v.model.lights.tail;
    tail.emissiveIntensity = (v.input.brake > 0.1 && v.forwardSpeed > 0.5 ? 5 : 1.4) + this.world.nightFactor * 1.5;
  }
}
