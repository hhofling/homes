/** "Visa i 3D" i Planritaren: planritningen med väggar, dörrar, fönster, golv och möbler i 3D. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Plan } from './types';
import { buildPlanModel, disposeGroup } from './tomt/scene';
import { download, safeFilename } from './common';

let open: { close: () => void } | null = null;

export function show3D(plan: Plan, notify: (msg: string) => void) {
  open?.close();
  const wrap = document.createElement('div');
  wrap.className = 'view3d-modal';
  wrap.innerHTML = `
    <div class="view3d-bar">
      <strong>${plan.name.replace(/</g, '&lt;')} i 3D</strong>
      <span class="muted small">Dra för att snurra · högerklicka och dra för att flytta · scrolla för att zooma</span>
      <span class="spacer"></span>
      <label class="row"><input type="checkbox" data-opt="furniture" checked /> Möbler</label>
      <label class="row">Takhöjd
        <select data-opt="height">
          <option value="2400">2,4 m</option>
          <option value="2500" selected>2,5 m</option>
          <option value="2700">2,7 m</option>
          <option value="3000">3,0 m</option>
        </select>
      </label>
      <button data-act="top">Ovanifrån</button>
      <button data-act="angle">Snett ovanifrån</button>
      <button data-act="png">Spara bild</button>
      <button data-act="close" class="primary">Stäng</button>
    </div>
    <div class="view3d-canvas"></div>`;
  document.body.appendChild(wrap);
  const host = wrap.querySelector<HTMLDivElement>('.view3d-canvas')!;

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dfe8f1');
  scene.add(new THREE.HemisphereLight('#f6f9ff', '#b5ab98', 1.6));
  const sun = new THREE.DirectionalLight('#fff7ea', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const groundGeo = new THREE.PlaneGeometry(400, 400);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ color: '#e9ecef', roughness: 1 }));
  ground.receiveShadow = true;
  ground.position.y = -0.005;
  scene.add(ground);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  controls.screenSpacePanning = true;

  let model: THREE.Group | null = null;
  let size = 10;
  const opts = { furniture: true, height: 2500 };
  const build = () => {
    if (model) {
      scene.remove(model);
      disposeGroup(model);
    }
    model = buildPlanModel(plan, opts);
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    scene.add(model);
    const box = new THREE.Box3().setFromObject(model);
    const s = box.getSize(new THREE.Vector3());
    size = Math.max(4, s.x, s.z);
    const cam = sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = cam.bottom = -size;
    cam.right = cam.top = size;
    cam.near = 0.5;
    cam.far = size * 6;
    cam.updateProjectionMatrix();
    sun.position.set(size * 0.8, size * 1.6, size * 1.1);
  };
  const view = (kind: 'top' | 'angle') => {
    controls.target.set(0, 0, 0);
    if (kind === 'top') camera.position.set(0, size * 1.9, 0.001);
    else camera.position.set(size * 0.55, size * 1.05, size * 1.05);
    controls.update();
  };
  build();
  if (!plan.walls.length && !plan.rooms.length) notify('Planen har inga väggar eller rum ännu – rita något först, så syns det i 3D.');

  const resize = () => {
    const r = host.getBoundingClientRect();
    renderer.setSize(Math.max(1, r.width), Math.max(1, r.height));
    camera.aspect = Math.max(1, r.width) / Math.max(1, r.height);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();
  view('angle');

  let alive = true;
  const loop = () => {
    if (!alive) return;
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  };
  loop();

  const close = () => {
    alive = false;
    ro.disconnect();
    controls.dispose();
    if (model) disposeGroup(model);
    renderer.dispose();
    wrap.remove();
    window.removeEventListener('keydown', onKey, true);
    open = null;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
    // Låt inte ritprogrammets kortkommandon reagera medan 3D-vyn är öppen
    else if (!(e.target as HTMLElement)?.closest?.('.view3d-modal select, .view3d-modal input')) e.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);

  wrap.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'close') close();
    else if (act === 'top' || act === 'angle') view(act);
    else if (act === 'png') {
      renderer.render(scene, camera);
      renderer.domElement.toBlob((blob) => {
        if (blob) download(blob, `${safeFilename(plan.name)}-3d.png`).catch((err) => notify(`Kunde inte spara bilden: ${err.message}`));
      }, 'image/png');
    }
  });
  wrap.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (el.dataset.opt === 'furniture') opts.furniture = (el as HTMLInputElement).checked;
    if (el.dataset.opt === 'height') opts.height = Number(el.value);
    build();
  });
  open = { close };
}
