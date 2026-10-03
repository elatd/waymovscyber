// WebGL renderer + post-processing stack (SSAO, bloom, tone mapping, grading, SMAA, speed FX)
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset, ToneMappingEffect,
  ToneMappingMode, VignetteEffect, HueSaturationEffect, BrightnessContrastEffect, ChromaticAberrationEffect,
  BlendFunction, GodRaysEffect, KernelSize,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { RadialBlurEffect, ScanPulseEffect } from '../fx/PostEffects.js';

export const QUALITY = {
  low: { pixelRatio: 0.85, shadow: 1024, shadowExtent: 90, ao: false, bloom: true, smaa: false, godrays: false, maxTraffic: 24, peds: 60 },
  medium: { pixelRatio: 1.0, shadow: 2048, shadowExtent: 110, ao: true, aoHalf: true, bloom: true, smaa: true, godrays: false, maxTraffic: 36, peds: 110 },
  high: { pixelRatio: 1.35, shadow: 4096, shadowExtent: 130, ao: true, aoHalf: true, bloom: true, smaa: true, godrays: true, maxTraffic: 46, peds: 160 },
  ultra: { pixelRatio: 2.0, shadow: 4096, shadowExtent: 150, ao: true, aoHalf: false, bloom: true, smaa: true, godrays: true, maxTraffic: 56, peds: 220 },
};

export class Renderer {
  constructor(container) {
    this.container = container;
    const r = (this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
    }));
    r.setPixelRatio(1);
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.info.autoReset = false;
    container.appendChild(r.domElement);
    r.domElement.id = 'game-canvas';
    this.scene = null;
    this.camera = null;
    this.quality = 'high';
    this.scale = 1; // dynamic resolution scale
    this.exposure = 1;
  }

  init(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.buildComposer();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  buildComposer() {
    const q = QUALITY[this.quality];
    if (this.composer) this.composer.dispose();
    const composer = (this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 }));
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.aoPass = null;
    if (q.ao) {
      const ao = new N8AOPostPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
      ao.configuration.aoRadius = 3.2;
      ao.configuration.distanceFalloff = 1.2;
      ao.configuration.intensity = 2.6;
      ao.configuration.halfRes = !!q.aoHalf;
      ao.configuration.depthAwareUpsampling = true;
      ao.configuration.gammaCorrection = false;
      ao.configuration.aoSamples = q.aoHalf ? 12 : 16;
      ao.configuration.denoiseSamples = 6;
      ao.configuration.denoiseRadius = 10;
      ao.setQualityMode?.('Medium');
      composer.addPass(ao);
      this.aoPass = ao;
    }
    this.scan = new ScanPulseEffect(this.camera);
    // sun shafts: a bright sphere far along the sun direction, occluded by the city
    if (!this.sunMesh) {
      this.sunMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10), new THREE.MeshBasicMaterial({ color: 0xffe2b8, transparent: true, fog: false, depthWrite: false, toneMapped: false }));
      this.sunMesh.frustumCulled = false;
    }
    this.godrays = q.godrays
      ? new GodRaysEffect(this.camera, this.sunMesh, { density: 0.94, decay: 0.925, weight: 0.36, exposure: 0.62, samples: 48, clampMax: 0.9, resolutionScale: 0.5, kernelSize: KernelSize.SMALL, blur: true })
      : null;
    // threshold above sunlit white paint so lights/glints bloom but car lettering stays crisp
    this.bloom = new BloomEffect({
      intensity: 1.15,
      luminanceThreshold: 1.3,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
      radius: 0.72,
    });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.hue = new HueSaturationEffect({ saturation: 0.16, hue: 0 });
    this.bc = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.08 });
    this.vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
    const main = [this.scan];
    if (this.godrays) main.push(this.godrays);
    main.push(this.bloom, this.tone, this.hue, this.bc, this.vignette);
    composer.addPass(new EffectPass(this.camera, ...main));
    this.radial = new RadialBlurEffect();
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: true, modulationOffset: 0.25 });
    this.speedPass = new EffectPass(this.camera, this.radial);
    this.speedPass.enabled = false;
    composer.addPass(this.speedPass);
    this.chromaPass = new EffectPass(this.camera, this.chroma);
    this.chromaPass.enabled = false;
    composer.addPass(this.chromaPass);
    if (q.smaa) composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    this.resize();
  }

  setQuality(name) {
    this.quality = name;
    this.buildComposer();
  }

  setExposure(e) {
    this.exposure = e;
    this.renderer.toneMappingExposure = e;
  }

  resize() {
    const q = QUALITY[this.quality];
    const pr = Math.min(window.devicePixelRatio || 1, q.pixelRatio) * this.scale;
    this.renderer.setPixelRatio(pr);
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    if (this.composer) this.composer.setSize(w, h);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  setSpeedFx(strength, chroma) {
    this.radial.strength = strength;
    this.speedPass.enabled = strength > 0.005;
    this.chroma.offset.set(chroma * 0.004, chroma * 0.0025);
    this.chromaPass.enabled = chroma > 0.01;
  }

  // Position the god-ray source and fade it by how directly we look at the sun.
  updateSun(sunDir, color, strength) {
    if (!this.godrays) return;
    const cam = this.camera;
    this.sunMesh.position.copy(cam.position).addScaledVector(sunDir, 4000);
    this.sunMesh.scale.setScalar(170);
    this.sunMesh.material.color.copy(color);
    const fwd = this._fwd || (this._fwd = new THREE.Vector3());
    cam.getWorldDirection(fwd);
    const facing = Math.max(0, Math.min(1, (fwd.dot(sunDir) - 0.05) / 0.5));
    this.godrays.blendMode.opacity.value = strength * facing * facing;
  }

  render(dt) {
    this.renderer.info.reset();
    this.composer.render(dt);
  }
}
