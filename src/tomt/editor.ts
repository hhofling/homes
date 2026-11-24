/** 3D-vyn: kamera, ljus, ritverktyg, markering och flytt. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Plan } from '../types';
import type { AreaKind, BuildingKind, LineKind, PlantKind, Sel, Vec } from './types';
import type { SiteStore } from './store';
import { buildSite, disposeGroup, M, v3 } from './scene';
import { newArea, newBuilding, newLine, newPlant, BUILDING_KINDS, AREA_KINDS, LINE_KINDS, PLANT_KINDS } from './catalog';
import { rectCorners, roofInfo, totalHeight, PLINTH, wallHeight, distanceToBoundary, polylineLength, dec } from './calc';
import { dist, rotatePoint, snapValue, uid } from '../geometry';

export type Tool =
  | 'select'
  | 'plot'
  | `b:${BuildingKind}`
  | `a:${AreaKind}`
  | `l:${LineKind}`
  | `p:${PlantKind}`;

export interface Settings {
  snap: boolean;
  grid: number;
  showGrid: boolean;
  roofs: boolean;
  labels: boolean;
  furniture: boolean;
  /** Klockslag 5–22 */
  hour: number;
  /** Solens deklination: 23 (midsommar), 0 (vår/höst), -23 (vinter) */
  season: number;
}

export interface Status {
  hint?: string;
  measure?: string;
  cursor?: string;
}

type Drag =
  | { type: 'move'; sel: Sel; start: Vec; snapshot: string; orig: any }
  | { type: 'vertex'; sel: Sel; index: number; snapshot: string }
  | { type: 'corner'; sel: Sel; corner: number; snapshot: string }
  | { type: 'rect'; start: Vec; current: Vec; moved: boolean }
  | null;

const HINTS: Record<string, string> = {
  select: 'Klicka på något för att markera och dra för att flytta. Dra i de vita punkterna för att ändra storlek. Dra i tom yta för att vrida vyn, högerklicka och dra för att flytta vyn, scrolla för att zooma.',
  plot: 'Klicka ut tomtens hörn ett i taget. Klicka på första hörnet (eller dubbelklicka / Enter) för att stänga tomtgränsen.',
  rect: 'Klicka för att placera, eller klicka och dra från hörn till hörn för att bestämma storleken.',
  line: 'Klicka ut punkter längs sträckan. Dubbelklicka eller tryck Enter för att avsluta, Esc för att avbryta.',
  plant: 'Klicka där du vill plantera. Klicka flera gånger för fler.',
};

export class Editor {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  persp: THREE.PerspectiveCamera;
  ortho: THREE.OrthographicCamera;
  camera: THREE.Camera;
  controls!: OrbitControls;
  view: '3d' | 'top' = '3d';
  sun: THREE.DirectionalLight;
  siteGroup: THREE.Group | null = null;
  handles = new THREE.Group();
  preview = new THREE.Group();
  selOutline = new THREE.Group();
  ground: THREE.Mesh;
  grid: THREE.GridHelper | null = null;

  tool: Tool = 'select';
  selection: Sel | null = null;
  draft: Vec[] = [];
  drag: Drag = null;
  hover: Vec | null = null;
  plans = new Map<string, Plan>();
  settings: Settings = { snap: true, grid: 100, showGrid: true, roofs: true, labels: true, furniture: true, hour: 15, season: 10 };

  onSelect: (sel: Sel | null) => void = () => {};
  onStatus: (s: Status) => void = () => {};
  onTool: (t: Tool) => void = () => {};

  private dirty = true;
  private rebuildQueued = false;
  private downAt: { x: number; y: number } | null = null;
  private labelsEl: HTMLDivElement;
  private labelEls = new Map<string, HTMLDivElement>();
  private labels: { key: string; pos: THREE.Vector3; text: string; cls: string }[] = [];
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(
    private wrap: HTMLElement,
    public store: SiteStore,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    const canvas = this.renderer.domElement;
    canvas.className = 'view3d';
    wrap.prepend(canvas);
    this.labelsEl = document.createElement('div');
    this.labelsEl.className = 'labels';
    wrap.appendChild(this.labelsEl);

    this.scene.background = new THREE.Color('#cfe2f0');
    this.scene.fog = new THREE.Fog('#cfe2f0', 160, 420);
    this.scene.add(new THREE.HemisphereLight('#f4f8ff', '#7d8c66', 1.4));
    this.sun = new THREE.DirectionalLight('#fff6e6', 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    const groundGeo = new THREE.PlaneGeometry(1200, 1200);
    groundGeo.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ color: '#8fae72', roughness: 1 }));
    this.ground.receiveShadow = true;
    this.ground.position.y = -0.01;
    this.scene.add(this.ground, this.handles, this.preview, this.selOutline);

    this.persp = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    this.ortho = new THREE.OrthographicCamera(-50, 50, 50, -50, -500, 1000);
    this.ortho.up.set(0, 0, -1);
    this.camera = this.persp;

    // Våra egna lyssnare måste registreras före kamerakontrollens, så att vi kan stänga av den när något dras.
    canvas.addEventListener('pointerdown', (e) => this.pointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.pointerMove(e));
    window.addEventListener('pointerup', (e) => this.pointerUp(e));
    canvas.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.finishDraft();
    });
    canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.updatePreview();
    });
    this.makeControls();

    new ResizeObserver(() => this.resize()).observe(wrap);
    this.store.subscribe(() => this.queueRebuild());
    this.loadPlans();
    this.updateSun();
    this.rebuild();
    this.resize();
    this.fit(false);
    this.setTool('select');
    const loop = () => {
      requestAnimationFrame(loop);
      this.controls.update();
      if (this.dirty) this.render();
    };
    loop();
  }

  // ---------- Kamera ----------

  private makeControls() {
    const old = this.controls;
    const target = old ? old.target.clone() : new THREE.Vector3();
    old?.dispose();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 400;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => (this.dirty = true));
    this.applyMouseButtons();
  }

  private applyMouseButtons() {
    const drawing = this.tool !== 'select';
    const NONE = -1 as unknown as THREE.MOUSE;
    this.controls.enableRotate = this.view === '3d';
    this.controls.mouseButtons = {
      LEFT: drawing ? NONE : this.view === 'top' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.touches = {
      ONE: drawing ? (-1 as unknown as THREE.TOUCH) : this.view === 'top' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
  }

  setView(view: '3d' | 'top') {
    this.view = view;
    this.camera = view === 'top' ? this.ortho : this.persp;
    this.makeControls();
    this.resize();
    this.fit(false);
  }

  /** Visa hela tomten. */
  fit(keepAngle = true) {
    const b = this.bounds();
    const c = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3());
    const r = Math.max(10, Math.max(size.x, size.z) * 0.62);
    this.controls.target.copy(c);
    if (this.view === 'top') {
      this.ortho.position.set(c.x, 200, c.z);
      this.ortho.lookAt(c);
      const aspect = this.aspect();
      const half = Math.max(size.z / 2, size.x / 2 / aspect) * 1.12 + 2;
      this.ortho.zoom = 50 / half;
      this.ortho.updateProjectionMatrix();
    } else {
      let dir = new THREE.Vector3(0.55, 0.62, 1).normalize();
      if (keepAngle) dir = this.persp.position.clone().sub(this.controls.target).normalize();
      if (dir.y < 0.2) dir = new THREE.Vector3(0.55, 0.62, 1).normalize();
      this.persp.position.copy(c.clone().add(dir.multiplyScalar(r / Math.tan((this.persp.fov * Math.PI) / 360) * 0.9)));
      this.persp.lookAt(c);
    }
    this.controls.update();
    this.dirty = true;
  }

  zoom(f: number) {
    if (this.view === 'top') {
      this.ortho.zoom *= f;
      this.ortho.updateProjectionMatrix();
    } else {
      const t = this.controls.target;
      this.persp.position.sub(t).multiplyScalar(1 / f).add(t);
    }
    this.controls.update();
    this.dirty = true;
  }

  private aspect() {
    const r = this.wrap.getBoundingClientRect();
    return Math.max(0.1, r.width / Math.max(1, r.height));
  }

  bounds() {
    const s = this.store.site;
    const pts: Vec[] = [...s.plot];
    for (const b of s.buildings) pts.push(...rectCorners(b));
    for (const a of s.areas) pts.push(...rectCorners(a));
    for (const l of s.lines) pts.push(...l.points);
    for (const p of s.plants) pts.push(p);
    if (!pts.length) pts.push({ x: -10000, y: -10000 }, { x: 10000, y: 10000 });
    const box = new THREE.Box3();
    for (const p of pts) box.expandByPoint(v3(p));
    return box;
  }

  resize() {
    const r = this.wrap.getBoundingClientRect();
    const w = Math.max(50, r.width);
    const h = Math.max(50, r.height);
    this.renderer.setSize(w, h, false);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    const a = w / h;
    this.ortho.left = -50 * a;
    this.ortho.right = 50 * a;
    this.ortho.top = 50;
    this.ortho.bottom = -50;
    this.ortho.updateProjectionMatrix();
    this.dirty = true;
  }

  // ---------- Sol ----------

  updateSun() {
    const lat = (59 * Math.PI) / 180;
    const dec = (this.settings.season * Math.PI) / 180;
    const H = ((this.settings.hour - 12.5) * 15 * Math.PI) / 180;
    const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
    let el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
    // Azimut räknat från söder, positivt mot väster
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat));
    const up = el > 0.03;
    el = Math.max(el, 0.03);
    const dir = new THREE.Vector3(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const b = this.bounds();
    const c = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3());
    const r = Math.max(20, size.length() * 0.6);
    this.sun.position.copy(c.clone().add(dir.multiplyScalar(r * 2)));
    this.sun.target.position.copy(c);
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.5;
    cam.far = r * 5;
    cam.updateProjectionMatrix();
    this.sun.intensity = up ? 0.6 + 2.2 * Math.min(1, Math.sin(el) * 2) : 0.25;
    this.sun.color.set(el < 0.2 ? '#ffd9a8' : '#fff6e6');
    this.dirty = true;
    return { up, elevation: (el * 180) / Math.PI };
  }

  // ---------- Bygga scenen ----------

  /** Läser in planritningar från Planritaren (samma webbläsare) och från tomtens egna kopior. */
  loadPlans() {
    this.plans.clear();
    const site = this.store.site;
    for (const p of site.plans ?? []) this.plans.set(p.id, p);
    try {
      const raw = localStorage.getItem('planritaren.plans.v1');
      const list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) for (const p of list) if (p && typeof p.id === 'string' && Array.isArray(p.walls)) this.plans.set(p.id, p);
    } catch {
      /* ingen åtkomst */
    }
    // Spara en kopia av kopplade planer i tomten, så att de följer med i tomtfilen
    const linked = site.buildings.map((b) => b.planId && this.plans.get(b.planId)).filter(Boolean) as Plan[];
    const before = JSON.stringify(site.plans ?? []);
    const after = JSON.stringify(linked);
    if (before !== after) {
      site.plans = linked;
      this.store.save();
    }
  }

  queueRebuild() {
    if (this.rebuildQueued) return;
    this.rebuildQueued = true;
    requestAnimationFrame(() => {
      this.rebuildQueued = false;
      this.rebuild();
    });
  }

  rebuild() {
    if (this.siteGroup) {
      this.scene.remove(this.siteGroup);
      disposeGroup(this.siteGroup);
    }
    if (this.selection && !this.find(this.selection)) this.selection = null;
    this.siteGroup = buildSite(this.store.site, this.plans, { roofs: this.settings.roofs, furniture: this.settings.furniture });
    this.scene.add(this.siteGroup);
    this.updateGrid();
    this.updateHandles();
    this.updateLabels();
    this.dirty = true;
  }

  private updateGrid() {
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid = null;
    }
    if (!this.settings.showGrid) return;
    const b = this.bounds();
    const c = b.getCenter(new THREE.Vector3());
    const size = Math.ceil(Math.max(b.getSize(new THREE.Vector3()).x, b.getSize(new THREE.Vector3()).z) + 30);
    const n = Math.ceil(size / 2) * 2;
    this.grid = new THREE.GridHelper(n, n, '#ffffff', '#ffffff');
    const m = this.grid.material as THREE.Material;
    m.transparent = true;
    m.opacity = 0.22;
    m.depthWrite = false;
    this.grid.position.set(Math.round(c.x), 0.02, Math.round(c.z));
    this.scene.add(this.grid);
  }

  render() {
    this.dirty = false;
    // Handtagen har samma storlek på skärmen oavsett zoom
    const s = this.pixelSize() * 9;
    this.handles.children.forEach((h) => h.scale.setScalar(s));
    this.renderer.render(this.scene, this.camera);
    this.positionLabels();
  }

  /** Ungefär hur många meter en skärmpixel motsvarar vid kamerans mål. */
  private pixelSize() {
    const h = this.renderer.domElement.clientHeight || 600;
    if (this.view === 'top') return (100 / this.ortho.zoom) / h;
    const d = this.persp.position.distanceTo(this.controls.target);
    return (2 * d * Math.tan((this.persp.fov * Math.PI) / 360)) / h;
  }

  // ---------- Etiketter ----------

  updateLabels() {
    const out: typeof this.labels = [];
    const s = this.store.site;
    if (this.settings.labels) {
      for (const b of s.buildings) {
        const h = (totalHeight(b) + 600) * M;
        out.push({ key: `b${b.id}`, pos: v3(b, h), text: `${b.name}<br><small>${dec(b.w / 1000)} × ${dec(b.d / 1000)} m</small>`, cls: 'lbl-building' });
      }
      if (s.plot.length >= 3) {
        for (let i = 0; i < s.plot.length; i++) {
          const a = s.plot[i];
          const b = s.plot[(i + 1) % s.plot.length];
          out.push({ key: `p${i}`, pos: v3({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 0.1), text: `${dec(dist(a, b) / 1000)} m`, cls: 'lbl-plot' });
        }
      }
    }
    // Avstånd till tomtgränsen för markerad byggnad
    const sel = this.selection;
    if (sel?.kind === 'building') {
      const b = s.buildings.find((x) => x.id === sel.id);
      if (b && s.plot.length >= 3) {
        const d = distanceToBoundary(b, s.plot);
        out.push({ key: 'dist', pos: v3(b, 0.3), text: `${dec(d / 1000)} m till gränsen`, cls: d < 4500 ? 'lbl-warn' : 'lbl-ok' });
      }
    }
    // Längder medan man ritar
    if (this.draft.length && this.hover) {
      const last = this.draft[this.draft.length - 1];
      out.push({ key: 'draft', pos: v3({ x: (last.x + this.hover.x) / 2, y: (last.y + this.hover.y) / 2 }, 0.2), text: `${dec(dist(last, this.hover) / 1000)} m`, cls: 'lbl-draft' });
    }
    if (this.drag?.type === 'rect') {
      const { start, current } = this.drag;
      out.push({ key: 'draft', pos: v3({ x: (start.x + current.x) / 2, y: (start.y + current.y) / 2 }, 0.2), text: `${dec(Math.abs(current.x - start.x) / 1000)} × ${dec(Math.abs(current.y - start.y) / 1000)} m`, cls: 'lbl-draft' });
    }
    this.labels = out;
    this.dirty = true;
  }

  private positionLabels() {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const seen = new Set<string>();
    for (const l of this.labels) {
      const p = l.pos.clone().project(this.camera);
      let el = this.labelEls.get(l.key);
      if (!el) {
        el = document.createElement('div');
        this.labelsEl.appendChild(el);
        this.labelEls.set(l.key, el);
      }
      seen.add(l.key);
      if (p.z > 1 || p.x < -1.1 || p.x > 1.1 || p.y < -1.1 || p.y > 1.1) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      el.className = `lbl ${l.cls}`;
      if (el.dataset.text !== l.text) {
        el.innerHTML = l.text;
        el.dataset.text = l.text;
      }
      el.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -50%)`;
    }
    for (const [k, el] of this.labelEls) {
      if (!seen.has(k)) {
        el.remove();
        this.labelEls.delete(k);
      }
    }
  }

  // ---------- Markering ----------

  find(sel: Sel): any {
    const s = this.store.site;
    switch (sel.kind) {
      case 'plot':
        return s.plot.length ? s : null;
      case 'building':
        return s.buildings.find((x) => x.id === sel.id);
      case 'area':
        return s.areas.find((x) => x.id === sel.id);
      case 'line':
        return s.lines.find((x) => x.id === sel.id);
      case 'plant':
        return s.plants.find((x) => x.id === sel.id);
    }
  }

  select(sel: Sel | null) {
    this.selection = sel;
    this.updateHandles();
    this.updateLabels();
    this.onSelect(sel);
  }

  private updateHandles() {
    for (const g of [this.handles, this.selOutline]) {
      g.children.forEach((c) => disposeGroup(c));
      g.clear();
    }
    const sel = this.selection;
    if (!sel) return;
    const obj = this.find(sel);
    if (!obj) return;
    let pts: Vec[] = [];
    let closed = true;
    let kind: 'vertex' | 'corner' = 'corner';
    if (sel.kind === 'plot') {
      pts = this.store.site.plot;
      kind = 'vertex';
    } else if (sel.kind === 'line') {
      pts = obj.points;
      closed = false;
      kind = 'vertex';
    } else if (sel.kind === 'building' || sel.kind === 'area') {
      pts = rectCorners(obj);
    } else if (sel.kind === 'plant') {
      const r = obj.size / 2;
      pts = Array.from({ length: 24 }, (_, i) => ({ x: obj.x + Math.cos((i / 24) * Math.PI * 2) * r, y: obj.y + Math.sin((i / 24) * Math.PI * 2) * r }));
    }
    if (pts.length >= 2) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints((closed ? [...pts, pts[0]] : pts).map((p) => v3(p, 0.06))),
        new THREE.LineBasicMaterial({ color: '#1d6fd8', depthTest: false, transparent: true }),
      );
      line.renderOrder = 10;
      this.selOutline.add(line);
    }
    if (sel.kind === 'plant') return;
    const hm = new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false });
    const rim = new THREE.MeshBasicMaterial({ color: '#1d6fd8', depthTest: false });
    pts.forEach((p, i) => {
      const g = new THREE.Group();
      const outer = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.1, 20), rim);
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.12, 20), hm);
      outer.renderOrder = inner.renderOrder = 11;
      g.add(outer, inner);
      g.position.copy(v3(p, 0.08));
      g.userData.handle = { kind, index: i };
      g.traverse((c) => (c.userData.handle = g.userData.handle));
      if (this.view === 'top') g.rotation.x = 0;
      this.handles.add(g);
    });
    this.dirty = true;
  }

  // ---------- Verktyg ----------

  setTool(t: Tool) {
    this.tool = t;
    this.draft = [];
    this.drag = null;
    this.applyMouseButtons();
    this.renderer.domElement.dataset.tool = t === 'select' ? 'select' : 'draw';
    this.updatePreview();
    this.onTool(t);
    const kind = t === 'select' ? 'select' : t === 'plot' ? 'plot' : t.startsWith('l:') ? 'line' : t.startsWith('p:') ? 'plant' : 'rect';
    this.onStatus({ hint: HINTS[kind] });
  }

  private ndc(e: PointerEvent | MouseEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  /** Punkt på marken under muspekaren (mm), med fäst mot rutnät. */
  private groundAt(e: PointerEvent | MouseEvent, snap = true): Vec | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    const p = { x: hit.x / M, y: hit.z / M };
    return snap ? this.snap(p) : p;
  }

  snap(p: Vec): Vec {
    if (!this.settings.snap) return { x: Math.round(p.x), y: Math.round(p.y) };
    return { x: snapValue(p.x, this.settings.grid), y: snapValue(p.y, this.settings.grid) };
  }

  private pick(e: PointerEvent | MouseEvent): { sel?: Sel; handle?: { kind: 'vertex' | 'corner'; index: number } } {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const h = this.raycaster.intersectObjects(this.handles.children, true)[0];
    if (h) return { handle: h.object.userData.handle };
    if (!this.siteGroup) return {};
    const hits = this.raycaster.intersectObjects(this.siteGroup.children, true);
    let plotHit: Sel | undefined;
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData.sel) o = o.parent;
      if (!o) continue;
      const sel = o.userData.sel as Sel;
      if (sel.kind === 'plot') {
        plotHit ??= sel;
        continue;
      }
      return { sel };
    }
    return plotHit && this.selection?.kind === 'plot' ? { sel: plotHit } : {};
  }

  private pointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    this.downAt = { x: e.clientX, y: e.clientY };
    const p = this.groundAt(e);
    if (!p) return;
    if (this.tool === 'select') {
      const hit = this.pick(e);
      if (hit.handle && this.selection) {
        this.controls.enabled = false;
        const snapshot = JSON.stringify(this.store.site);
        this.drag = hit.handle.kind === 'vertex' ? { type: 'vertex', sel: this.selection, index: hit.handle.index, snapshot } : { type: 'corner', sel: this.selection, corner: hit.handle.index, snapshot };
        return;
      }
      if (hit.sel) {
        this.controls.enabled = false;
        if (!this.selection || this.selection.kind !== hit.sel.kind || this.selection.id !== hit.sel.id) this.select(hit.sel);
        const obj = this.find(hit.sel);
        this.drag = { type: 'move', sel: hit.sel, start: p, snapshot: JSON.stringify(this.store.site), orig: JSON.parse(JSON.stringify(hit.sel.kind === 'plot' ? this.store.site.plot : obj)) };
      }
      return;
    }
    if (this.tool === 'plot' || this.tool.startsWith('l:')) {
      if (this.tool === 'plot' && this.draft.length >= 3 && this.closeToFirst(e)) {
        this.finishDraft();
        return;
      }
      const last = this.draft[this.draft.length - 1];
      if (!last || dist(last, p) > 1) this.draft.push(p);
      this.updatePreview();
      return;
    }
    if (this.tool.startsWith('p:')) {
      this.store.checkpoint();
      const plant = newPlant(this.tool.slice(2) as PlantKind, p.x, p.y);
      this.store.site.plants.push(plant);
      this.store.changed();
      return;
    }
    // rektangelverktyg
    this.drag = { type: 'rect', start: p, current: p, moved: false };
    this.updatePreview();
  }

  private closeToFirst(e: PointerEvent) {
    const first = this.draft[0];
    const p = this.groundAt(e, false);
    if (!p) return false;
    return dist(first, p) < Math.max(400, this.pixelSize() * 14 / M);
  }

  private pointerMove(e: PointerEvent) {
    const p = this.groundAt(e);
    if (p) {
      this.onStatus({ cursor: `x ${dec(p.x / 1000)} m  y ${dec(p.y / 1000)} m` });
    }
    const d = this.drag;
    if (!d) {
      if (this.tool !== 'select') {
        this.hover = p;
        this.updatePreview();
        if (this.draft.length && p) this.updateLabels();
      } else {
        const hit = this.pick(e);
        this.renderer.domElement.style.cursor = hit.handle ? 'grab' : hit.sel ? 'move' : '';
      }
      return;
    }
    if (!p) return;
    const site = this.store.site;
    if (d.type === 'rect') {
      d.current = p;
      if (dist(d.start, p) > 300) d.moved = true;
      this.updatePreview();
      this.updateLabels();
      return;
    }
    if (d.type === 'move') {
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      if (!dx && !dy) return;
      const o = d.orig;
      if (d.sel.kind === 'plot') site.plot = (o as Vec[]).map((q) => ({ x: q.x + dx, y: q.y + dy }));
      else {
        const obj = this.find(d.sel);
        if (d.sel.kind === 'line') obj.points = o.points.map((q: Vec) => ({ x: q.x + dx, y: q.y + dy }));
        else {
          obj.x = o.x + dx;
          obj.y = o.y + dy;
        }
      }
      this.dragChanged();
      return;
    }
    if (d.type === 'vertex') {
      const pts: Vec[] = d.sel.kind === 'plot' ? site.plot : this.find(d.sel)?.points;
      if (!pts || !pts[d.index]) return;
      pts[d.index] = p;
      this.dragChanged();
      return;
    }
    if (d.type === 'corner') {
      const obj = this.find(d.sel);
      if (!obj) return;
      const corners = rectCorners(obj);
      const fixed = corners[(d.corner + 2) % 4];
      // lokala mått relativt det fasta hörnet
      const local = rotatePoint({ x: p.x - fixed.x, y: p.y - fixed.y }, -obj.rotation);
      const w = Math.max(500, Math.abs(local.x));
      const h = Math.max(500, Math.abs(local.y));
      const sx = Math.sign(local.x) || 1;
      const sy = Math.sign(local.y) || 1;
      const c = rotatePoint({ x: (sx * w) / 2, y: (sy * h) / 2 }, obj.rotation);
      obj.w = snapValue(w, this.settings.snap ? this.settings.grid : 1);
      obj.d = snapValue(h, this.settings.snap ? this.settings.grid : 1);
      obj.x = fixed.x + c.x;
      obj.y = fixed.y + c.y;
      this.dragChanged();
    }
  }

  private dragChanged() {
    this.store.site.updatedAt = Date.now();
    this.rebuild();
    this.onSelect(this.selection);
    const sel = this.selection;
    const obj = sel && this.find(sel);
    if (obj && (sel!.kind === 'building' || sel!.kind === 'area')) this.onStatus({ measure: `${dec(obj.w / 1000)} × ${dec(obj.d / 1000)} m` });
  }

  private pointerUp(e: PointerEvent) {
    const d = this.drag;
    const wasClick = this.downAt && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < 5;
    this.downAt = null;
    this.controls.enabled = true;
    if (!d) {
      if (wasClick && this.tool === 'select' && e.button === 0 && e.target === this.renderer.domElement) {
        const hit = this.pick(e);
        if (!hit.sel && !hit.handle) this.select(null);
      }
      return;
    }
    this.drag = null;
    if (d.type === 'rect') {
      this.createRect(d.start, d.current, d.moved);
      this.updatePreview();
      this.updateLabels();
      return;
    }
    if (d.type === 'move' || d.type === 'vertex' || d.type === 'corner') {
      if (JSON.stringify(this.store.site) !== d.snapshot) {
        this.store.undoBase(d.snapshot);
        this.store.changed();
      }
      this.onStatus({ measure: '' });
    }
  }

  private createRect(a: Vec, b: Vec, moved: boolean) {
    const t = this.tool;
    let x: number, y: number, w: number | undefined, d: number | undefined;
    if (moved) {
      x = (a.x + b.x) / 2;
      y = (a.y + b.y) / 2;
      w = Math.max(500, Math.abs(b.x - a.x));
      d = Math.max(500, Math.abs(b.y - a.y));
    } else {
      x = a.x;
      y = a.y;
    }
    this.store.checkpoint();
    const site = this.store.site;
    let sel: Sel;
    if (t.startsWith('b:')) {
      const kind = t.slice(2) as BuildingKind;
      const bld = newBuilding(kind, x, y, w, d);
      const same = site.buildings.filter((q) => q.kind === kind).length;
      if (same) bld.name = `${BUILDING_KINDS[kind].label} ${same + 1}`;
      site.buildings.push(bld);
      sel = { kind: 'building', id: bld.id };
    } else {
      const kind = t.slice(2) as AreaKind;
      const area = newArea(kind, x, y, w, d);
      site.areas.push(area);
      sel = { kind: 'area', id: area.id };
    }
    this.store.changed();
    this.setTool('select');
    this.select(sel);
  }

  finishDraft() {
    const pts = this.draft;
    if (this.tool === 'plot') {
      if (pts.length >= 3) {
        this.store.checkpoint();
        this.store.site.plot = pts.slice();
        this.draft = [];
        this.store.changed();
        this.setTool('select');
        this.select({ kind: 'plot', id: 'plot' });
      }
      return;
    }
    if (this.tool.startsWith('l:')) {
      if (pts.length >= 2) {
        this.store.checkpoint();
        const line = newLine(this.tool.slice(2) as LineKind, pts.slice());
        this.store.site.lines.push(line);
        this.draft = [];
        this.store.changed();
        this.setTool('select');
        this.select({ kind: 'line', id: line.id });
      }
    }
  }

  cancel() {
    if (this.draft.length || this.drag) {
      this.draft = [];
      this.drag = null;
      this.updatePreview();
      this.updateLabels();
      return;
    }
    if (this.tool !== 'select') this.setTool('select');
    else this.select(null);
  }

  private updatePreview() {
    this.preview.children.forEach((c) => disposeGroup(c));
    this.preview.clear();
    const lineMat = new THREE.LineBasicMaterial({ color: '#1d6fd8', depthTest: false });
    const d = this.drag;
    if (d?.type === 'rect') {
      const t = this.tool;
      const [w, dd, h] = d.moved
        ? [Math.abs(d.current.x - d.start.x), Math.abs(d.current.y - d.start.y), 0]
        : t.startsWith('b:')
          ? [BUILDING_KINDS[t.slice(2) as BuildingKind].defaults.w!, BUILDING_KINDS[t.slice(2) as BuildingKind].defaults.d!, 0]
          : [AREA_KINDS[t.slice(2) as AreaKind].w, AREA_KINDS[t.slice(2) as AreaKind].d, 0];
      void h;
      const c = d.moved ? { x: (d.start.x + d.current.x) / 2, y: (d.start.y + d.current.y) / 2 } : d.start;
      const height = t.startsWith('b:') ? 2.5 : 0.1;
      const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.1, w * M), height, Math.max(0.1, dd * M)), new THREE.MeshBasicMaterial({ color: '#1d6fd8', transparent: true, opacity: 0.25, depthWrite: false }));
      m.position.copy(v3(c, height / 2));
      this.preview.add(m);
    } else if (this.draft.length || (this.hover && this.tool !== 'select')) {
      const pts = [...this.draft];
      if (this.hover) pts.push(this.hover);
      if (pts.length >= 2) {
        const all = this.tool === 'plot' && pts.length >= 3 ? [...pts, pts[0]] : pts;
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(all.map((p) => v3(p, 0.08))), lineMat);
        l.renderOrder = 12;
        this.preview.add(l);
      }
      for (const p of pts) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(this.pixelSize() * 5, 10, 8), new THREE.MeshBasicMaterial({ color: '#1d6fd8', depthTest: false }));
        dot.position.copy(v3(p, 0.08));
        dot.renderOrder = 12;
        this.preview.add(dot);
      }
    }
    this.dirty = true;
  }

  // ---------- Ändringar på markerat ----------

  deleteSelected() {
    const sel = this.selection;
    if (!sel) return;
    const s = this.store.site;
    this.store.checkpoint();
    if (sel.kind === 'plot') s.plot = [];
    else if (sel.kind === 'building') s.buildings = s.buildings.filter((x) => x.id !== sel.id);
    else if (sel.kind === 'area') s.areas = s.areas.filter((x) => x.id !== sel.id);
    else if (sel.kind === 'line') s.lines = s.lines.filter((x) => x.id !== sel.id);
    else if (sel.kind === 'plant') s.plants = s.plants.filter((x) => x.id !== sel.id);
    this.select(null);
    this.store.changed();
  }

  duplicateSelected() {
    const sel = this.selection;
    if (!sel || sel.kind === 'plot') return;
    const obj = this.find(sel);
    if (!obj) return;
    this.store.checkpoint();
    const copy = JSON.parse(JSON.stringify(obj));
    copy.id = uid(sel.kind[0]);
    delete copy.planId;
    const off = 2000;
    if (sel.kind === 'line') copy.points = copy.points.map((p: Vec) => ({ x: p.x + off, y: p.y + off }));
    else {
      copy.x += off;
      copy.y += off;
    }
    const s = this.store.site;
    const list = { building: s.buildings, area: s.areas, line: s.lines, plant: s.plants }[sel.kind] as any[];
    list.push(copy);
    this.store.changed();
    this.select({ kind: sel.kind, id: copy.id });
  }

  rotateSelected(deg: number) {
    const sel = this.selection;
    if (!sel || (sel.kind !== 'building' && sel.kind !== 'area')) return;
    const obj = this.find(sel);
    this.store.checkpoint();
    obj.rotation = (((obj.rotation + deg) % 360) + 360) % 360;
    this.store.changed();
    this.onSelect(sel);
  }

  nudge(dx: number, dy: number) {
    const sel = this.selection;
    if (!sel) return;
    const obj = this.find(sel);
    this.store.checkpoint();
    const move = (p: Vec) => ({ x: p.x + dx, y: p.y + dy });
    if (sel.kind === 'plot') this.store.site.plot = this.store.site.plot.map(move);
    else if (sel.kind === 'line') obj.points = obj.points.map(move);
    else {
      obj.x += dx;
      obj.y += dy;
    }
    this.store.changed();
  }

  /** Bilder i vald storlek (för ritningsbladet). Kör render med en tillfällig kamera. */
  renderWith(camera: THREE.Camera, width: number, height: number, hide: (o: THREE.Object3D) => boolean = () => false): HTMLCanvasElement {
    const canvas = this.renderer.domElement;
    const oldW = canvas.width;
    const oldH = canvas.height;
    const ratio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    const hidden: THREE.Object3D[] = [];
    this.siteGroup?.traverse((o) => {
      if (o.visible && hide(o)) {
        hidden.push(o);
        o.visible = false;
      }
    });
    const helpers = [this.handles, this.preview, this.selOutline, this.grid].filter(Boolean) as THREE.Object3D[];
    const helperVis = helpers.map((h) => h.visible);
    helpers.forEach((h) => (h.visible = false));
    this.renderer.render(this.scene, camera);
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    out.getContext('2d')!.drawImage(canvas, 0, 0);
    hidden.forEach((o) => (o.visible = true));
    helpers.forEach((h, i) => (h.visible = helperVis[i]));
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(oldW / ratio, oldH / ratio, false);
    this.resize();
    this.dirty = true;
    return out;
  }

  /** Höjd och övrigt för statusraden */
  describe(sel: Sel): string {
    const o = this.find(sel);
    if (!o) return '';
    if (sel.kind === 'building') return `${BUILDING_KINDS[o.kind as BuildingKind].label}: nock ${dec(totalHeight(o) / 1000)} m, väggar ${dec((wallHeight(o) + PLINTH[o.kind === 'carport' ? 'plinth' : o.foundation as 'slab']) / 1000)} m, tak ${dec(roofInfo(o).area, 0)} m²`;
    if (sel.kind === 'line') return `${LINE_KINDS[o.kind as LineKind].label}: ${dec(polylineLength(o.points) / 1000)} m`;
    if (sel.kind === 'plant') return PLANT_KINDS[o.kind as PlantKind].label;
    return '';
  }
}
