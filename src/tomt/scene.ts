/** Bygger 3D-modellen (three.js) av en tomt. Mått i tomten är mm, i 3D-scenen meter. */
import * as THREE from 'three';
import type { Plan, Item } from '../types';
import type { Area, Building, Line, Plant, Site, Vec } from './types';
import { OVERHANG, PLINTH, roofInfo, wallHeight } from './calc';
import { autoOpenings, outerThickness, type Side } from './toplan';

export const M = 1 / 1000;
export const v3 = (p: Vec, y = 0) => new THREE.Vector3(p.x * M, y, p.y * M);

export interface SceneOptions {
  roofs: boolean;
  /** Visa möbler från planritningen */
  furniture: boolean;
}

// ---------- Material och texturer ----------

const matCache = new Map<string, THREE.Material>();
function mat(color: string, opts: { rough?: number; side?: THREE.Side; transparent?: number; map?: string } = {}) {
  const key = `${color}|${opts.rough ?? 0.9}|${opts.side ?? 0}|${opts.transparent ?? ''}|${opts.map ?? ''}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.9,
      metalness: 0,
      side: opts.side ?? THREE.FrontSide,
      transparent: opts.transparent !== undefined,
      opacity: opts.transparent ?? 1,
      map: opts.map ? texture(opts.map) : null,
      alphaTest: opts.map === 'pickets' ? 0.5 : 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    matCache.set(key, m);
  }
  return m;
}

const texCache = new Map<string, THREE.Texture>();
/** Enkla mönster ritade i kod: trall, plattor, grus, vatten, staketspjälor, takpannor, panel. Ritas i vitt/grått och färgas av materialet. */
function texture(kind: string): THREE.Texture {
  let t = texCache.get(kind);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  const rnd = mulberry(kind.length * 99);
  if (kind === 'planks' || kind === 'panel') {
    const n = kind === 'planks' ? 8 : 6;
    for (let i = 0; i < n; i++) {
      g.fillStyle = `rgb(${225 + rnd() * 30},${225 + rnd() * 30},${225 + rnd() * 30})`;
      g.fillRect(0, (i * 128) / n, 128, 128 / n);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, ((i + 1) * 128) / n - 2, 128, 2);
    }
  } else if (kind === 'pavers') {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i <= 4; i++) {
      g.fillRect(0, i * 32 - 1, 128, 2);
      g.fillRect(i * 32 - 1, 0, 2, 128);
    }
  } else if (kind === 'gravel' || kind === 'soil' || kind === 'grass') {
    for (let i = 0; i < 1600; i++) {
      const v = kind === 'grass' ? 200 + rnd() * 55 : 150 + rnd() * 105;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(rnd() * 128, rnd() * 128, 2, 2);
    }
  } else if (kind === 'water') {
    g.strokeStyle = 'rgba(255,255,255,0.0)';
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(255,255,255,${0.2 + rnd() * 0.3})`;
      g.fillRect(rnd() * 128, rnd() * 128, 10 + rnd() * 20, 2);
    }
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = '#dfeff5';
    g.fillRect(0, 0, 128, 128);
  } else if (kind === 'pickets') {
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 4; i++) g.fillRect(i * 32 + 4, 8, 20, 120);
    g.fillRect(0, 30, 128, 10);
    g.fillRect(0, 96, 128, 10);
  } else if (kind === 'tiles') {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fillRect(0, i * 16 + 13, 128, 3);
      for (let j = 0; j < 6; j++) g.fillRect(j * 22 + (i % 2) * 11, i * 16, 2, 16);
    }
  }
  t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(kind, t);
  return t;
}

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sätter UV så att mönstret får verklig skala (size = meter per mönsterruta). */
function worldUV(geo: THREE.BufferGeometry, size: number, axes: 'xz' | 'xy' | 'zy' = 'xz') {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const [u, v] = axes === 'xz' ? [x, z] : axes === 'xy' ? [x, y] : [z, y];
    uv[i * 2] = u / size;
    uv[i * 2 + 1] = v / size;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Box-UV som följer boxens storlek (för panel och trall). */
function boxUV(geo: THREE.BoxGeometry, w: number, h: number, d: number, size: number) {
  const uv = geo.attributes.uv;
  // BoxGeometry-ordning: +x, -x, +y, -y, +z, -z (4 hörn var)
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * dims[f][0]) / size, (uv.getY(k) * dims[f][1]) / size);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

function box(w: number, h: number, d: number, material: THREE.Material, uvSize = 0) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (uvSize) boxUV(geo, w, h, d, uvSize);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Placerar en grupp på en rektangels mittpunkt med rätt rotation. */
function placeRect(g: THREE.Object3D, r: { x: number; y: number; rotation: number }, y = 0) {
  g.position.set(r.x * M, y, r.y * M);
  g.rotation.y = (-r.rotation * Math.PI) / 180;
}

function tag(o: THREE.Object3D, kind: string, id: string) {
  o.userData.sel = { kind, id };
  return o;
}

// ---------- Tomt och mark ----------

export function shapeFrom(pts: Vec[]) {
  const s = new THREE.Shape();
  pts.forEach((p, i) => (i ? s.lineTo(p.x * M, -p.y * M) : s.moveTo(p.x * M, -p.y * M)));
  s.closePath();
  return s;
}

function flatPolygon(pts: Vec[], y: number, material: THREE.Material, uvSize = 0) {
  const geo = new THREE.ShapeGeometry(shapeFrom(pts));
  geo.rotateX(-Math.PI / 2);
  if (uvSize) worldUV(geo, uvSize);
  const m = new THREE.Mesh(geo, material);
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

function buildPlot(site: Site, g: THREE.Group) {
  if (site.plot.length < 3) return;
  const plot = flatPolygon(site.plot, 0.002, mat('#9ccc78', { map: 'grass' }), 3);
  tag(plot, 'plot', 'plot');
  g.add(plot);
  const pts = [...site.plot, site.plot[0]].map((p) => v3(p, 0.03));
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.8, gapSize: 0.4 }));
  line.computeLineDistances();
  g.add(line);
  // Gränsstenar i hörnen
  for (const p of site.plot) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.25, 10), mat('#e8e4da'));
    s.position.copy(v3(p, 0.1));
    g.add(s);
  }
}

// ---------- Byggnader ----------

interface Hole {
  /** Position längs väggen från start (m) */
  from: number;
  to: number;
  bottom: number;
  top: number;
  kind: 'window' | 'door' | 'garage' | 'open';
}

/** En vägg från a till b (lokala meter i xz) med hål för fönster och dörrar. */
function wallWithHoles(a: Vec, b: Vec, thick: number, height: number, holes: Hole[], wallMat: THREE.Material, outer: boolean): THREE.Group {
  const g = new THREE.Group();
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 0.01) return g;
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  g.position.set(a.x, 0, a.y);
  g.rotation.y = -ang;
  const piece = (x0: number, x1: number, y0: number, y1: number) => {
    if (x1 - x0 < 0.005 || y1 - y0 < 0.005) return;
    const m = box(x1 - x0, y1 - y0, thick, wallMat, outer ? 1.2 : 0);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
    g.add(m);
  };
  const sorted = holes
    .map((h) => ({ ...h, from: Math.max(0, h.from), to: Math.min(len, h.to) }))
    .filter((h) => h.to > h.from)
    .sort((p, q) => p.from - q.from);
  let x = 0;
  for (const h of sorted) {
    if (h.from > x) piece(x, h.from, 0, height);
    const from = Math.max(h.from, x);
    piece(from, h.to, 0, h.bottom);
    piece(from, h.to, Math.min(h.top, height), height);
    if (outer || h.kind === 'window') {
      const w = h.to - from;
      const hh = Math.min(h.top, height) - h.bottom;
      if (h.kind === 'window') {
        const glass = box(w, hh, 0.03, mat('#8fb3c9', { rough: 0.15, transparent: 0.55 }));
        glass.castShadow = false;
        glass.position.set(from + w / 2, h.bottom + hh / 2, 0);
        g.add(glass);
        // karm
        const frameMat = mat('#f4f4f0');
        for (const [fw, fh, fx, fy] of [
          [w, 0.06, from + w / 2, h.bottom + 0.03],
          [w, 0.06, from + w / 2, h.bottom + hh - 0.03],
          [0.06, hh, from + 0.03, h.bottom + hh / 2],
          [0.06, hh, from + w - 0.03, h.bottom + hh / 2],
          [0.05, hh, from + w / 2, h.bottom + hh / 2],
        ]) {
          const f = box(fw, fh, thick * 0.5, frameMat);
          f.position.set(fx, fy, 0);
          g.add(f);
        }
      } else if (h.kind !== 'open') {
        const panel = box(w, hh, 0.05, h.kind === 'garage' ? mat('#e9e9e4', { map: 'panel' }) : mat('#5a3e2b'), h.kind === 'garage' ? 0.6 : 0);
        panel.position.set(from + w / 2, hh / 2, 0);
        g.add(panel);
      }
    }
    x = Math.max(x, h.to);
  }
  if (x < len) piece(x, len, 0, height);
  return g;
}

/** Väggar från autoutlagda fönster/dörrar (när byggnaden saknar planritning). */
function autoWalls(b: Building, H: number, wallMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const w = b.w * M;
  const d = b.d * M;
  const t = outerThickness(b) * M;
  const corners: Record<Side, [Vec, Vec]> = {
    top: [{ x: -w / 2, y: -d / 2 + t / 2 }, { x: w / 2, y: -d / 2 + t / 2 }],
    right: [{ x: w / 2 - t / 2, y: -d / 2 + t }, { x: w / 2 - t / 2, y: d / 2 - t }],
    bottom: [{ x: w / 2, y: d / 2 - t / 2 }, { x: -w / 2, y: d / 2 - t / 2 }],
    left: [{ x: -w / 2 + t / 2, y: d / 2 - t }, { x: -w / 2 + t / 2, y: -d / 2 + t }],
  };
  const ops = autoOpenings(b);
  const floorH = b.floorHeight * M;
  for (const side of ['top', 'right', 'bottom', 'left'] as Side[]) {
    const [a, c] = corners[side];
    const len = Math.hypot(c.x - a.x, c.y - a.y);
    const full = side === 'top' || side === 'bottom' ? w : d;
    const off = (full - len) / 2;
    const holes: Hole[] = [];
    for (const o of ops.filter((o) => o.side === side)) {
      const mid = o.t * full - off;
      const half = (o.width * M) / 2;
      for (let f = 0; f < Math.max(1, b.floors); f++) {
        if (o.kind !== 'window' && f > 0) {
          // Fönster ovanför dörren på övre våningar
          holes.push({ from: mid - 0.6, to: mid + 0.6, bottom: f * floorH + 0.9, top: f * floorH + 2.1, kind: 'window' });
          continue;
        }
        const top = o.kind === 'garage' ? Math.min(2.2, floorH - 0.15) : Math.min(2.1, floorH - 0.15);
        holes.push({ from: mid - half, to: mid + half, bottom: o.kind === 'window' ? f * floorH + 0.9 : 0, top: f * floorH + top, kind: o.kind });
      }
    }
    g.add(wallWithHoles(a, c, t, H, holes, wallMat, true));
  }
  // golv
  const floor = box(w - 2 * t, 0.02, d - 2 * t, mat('#d9cdb8'));
  floor.position.y = 0.01;
  g.add(floor);
  return g;
}

const FURN_H: Record<string, number> = {
  'bed-double': 0.5, 'bed-single': 0.5, nightstand: 0.55, wardrobe: 2.0, dresser: 0.85, 'sofa-3': 0.8, 'sofa-2': 0.8, armchair: 0.8,
  'coffee-table': 0.45, 'tv-bench': 0.5, bookshelf: 1.9, rug: 0.012, 'dining-table': 0.74, 'round-table': 0.74, chair: 0.85, counter: 0.9,
  stove: 0.9, 'kitchen-sink': 0.9, fridge: 1.85, dishwasher: 0.85, toilet: 0.75, basin: 0.85, bathtub: 0.55, shower: 2.0, washer: 0.85,
  desk: 0.74, 'office-chair': 1.0, plant: 1.1, stairs: 2.5, box: 0.8,
};

/** Väggar, golv och möbler från en planritning i Planritaren. */
function planWalls(b: Building, plan: Plan, H: number, wallMat: THREE.Material, opts: SceneOptions): THREE.Group {
  const g = new THREE.Group();
  const ox = -b.w / 2;
  const oy = -b.d / 2;
  const loc = (p: Vec): Vec => ({ x: (p.x + ox) * M, y: (p.y + oy) * M });
  // ytterväggar = de som ligger längs planens kant
  const xs = plan.walls.flatMap((w) => [w.a.x, w.b.x]);
  const ys = plan.walls.flatMap((w) => [w.a.y, w.b.y]);
  const bx = [Math.min(...xs), Math.max(...xs)];
  const by = [Math.min(...ys), Math.max(...ys)];
  const near = (v: number, arr: number[]) => arr.some((a) => Math.abs(v - a) < 300);
  const floorH = b.floorHeight * M;
  for (const wall of plan.walls) {
    const outer = (near(wall.a.x, bx) && near(wall.b.x, bx) && Math.abs(wall.a.x - wall.b.x) < 300) || (near(wall.a.y, by) && near(wall.b.y, by) && Math.abs(wall.a.y - wall.b.y) < 300);
    const len = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y) * M;
    const holes: Hole[] = [];
    for (const o of plan.openings.filter((o) => o.wallId === wall.id)) {
      const mid = o.t * len;
      const half = (o.width * M) / 2;
      const kind: Hole['kind'] = o.kind === 'window' ? 'window' : o.kind === 'opening' ? (outer && o.width >= 2000 ? 'garage' : 'open') : 'door';
      const top = Math.min(kind === 'garage' ? 2.2 : 2.1, floorH - 0.15);
      holes.push({ from: mid - half, to: mid + half, bottom: kind === 'window' ? 0.9 : 0, top, kind });
    }
    // Väggarna i planen gäller bottenvåningen; övre våningar blir hela ytterväggar
    const wallH = outer ? (opts.roofs ? H : floorH) : Math.min(floorH, H);
    if (outer && opts.roofs && b.floors > 1) {
      for (let f = 1; f < b.floors; f++) for (const h of holes) if (h.kind === 'window') holes.push({ ...h, bottom: h.bottom + f * floorH, top: h.top + f * floorH });
    }
    // Innerväggar lite lägre när taket är dolt, så att det syns att de är innerväggar
    g.add(wallWithHoles(loc(wall.a), loc(wall.b), wall.thickness * M, outer ? wallH : Math.min(wallH, opts.roofs ? floorH : floorH - 0.2), holes, outer ? wallMat : mat('#f3f1ec'), outer));
  }
  for (const r of plan.rooms) {
    if (r.points.length < 3) continue;
    const f = flatPolygon(r.points.map(loc).map((p) => ({ x: p.x / M, y: p.y / M })), 0.015, mat(r.color));
    // flatPolygon räknar i mm → konvertera
    g.add(f);
  }
  if (opts.furniture) {
    for (const it of plan.items) g.add(furniture(it, loc));
  }
  return g;
}

function furniture(it: Item, loc: (p: Vec) => Vec) {
  const h = FURN_H[it.type] ?? 0.7;
  const p = loc({ x: it.x, y: it.y });
  const m = box(it.w * M, h, it.d * M, mat(it.color || '#cfc6b8'));
  m.position.set(p.x, h / 2 + 0.02, p.y);
  m.rotation.y = (-it.rotation * Math.PI) / 180;
  return m;
}

/** Taket i lokala koordinater med nocken längs x. */
function roofMesh(b: Building, H: number, wallMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const info = roofInfo(b);
  const len = info.length * M;
  const span = info.span * M;
  const o = OVERHANG * M;
  const L = len + 2 * o;
  const S = span + 2 * o;
  const t = Math.tan((info.pitch * Math.PI) / 180);
  const roofMat = mat(b.roofColor, { side: THREE.DoubleSide, map: info.pitch >= 14 && b.roof !== 'flat' ? 'tiles' : 'panel' });
  const tri: number[] = [];
  const fill: number[] = [];
  const V = (x: number, y: number, z: number) => [x, y, z];
  const quad = (arr: number[], a: number[], b2: number[], c: number[], d: number[]) => arr.push(...a, ...b2, ...c, ...a, ...c, ...d);
  const triangle = (arr: number[], a: number[], b2: number[], c: number[]) => arr.push(...a, ...b2, ...c);
  const ye = H - o * t;
  if (b.roof === 'flat') {
    const slab = box(len + 0.3, 0.3, span + 0.3, mat(b.roofColor));
    slab.position.y = H + 0.15;
    g.add(slab);
    // takkant
    return g;
  }
  if (b.roof === 'gable') {
    const yr = H + (span / 2) * t;
    quad(tri, V(-L / 2, ye, S / 2), V(L / 2, ye, S / 2), V(L / 2, yr, 0), V(-L / 2, yr, 0));
    quad(tri, V(L / 2, ye, -S / 2), V(-L / 2, ye, -S / 2), V(-L / 2, yr, 0), V(L / 2, yr, 0));
    for (const sx of [-1, 1]) triangle(fill, V((sx * len) / 2, H, span / 2), V((sx * len) / 2, H, -span / 2), V((sx * len) / 2, yr, 0));
  } else if (b.roof === 'hip') {
    // Valmat tak: nocken längs den längsta sidan
    let LL = L;
    let SS = S;
    let swap = false;
    if (L < S) {
      LL = S;
      SS = L;
      swap = true;
    }
    const r = (LL - SS) / 2;
    const yt = ye + (SS / 2) * t;
    const pts: number[] = [];
    quad(pts, V(-LL / 2, ye, SS / 2), V(LL / 2, ye, SS / 2), V(r, yt, 0), V(-r, yt, 0));
    quad(pts, V(LL / 2, ye, -SS / 2), V(-LL / 2, ye, -SS / 2), V(-r, yt, 0), V(r, yt, 0));
    triangle(pts, V(LL / 2, ye, SS / 2), V(LL / 2, ye, -SS / 2), V(r, yt, 0));
    triangle(pts, V(-LL / 2, ye, -SS / 2), V(-LL / 2, ye, SS / 2), V(-r, yt, 0));
    if (swap) for (let i = 0; i < pts.length; i += 3) [pts[i], pts[i + 2]] = [pts[i + 2], pts[i]];
    tri.push(...pts);
  } else if (b.roof === 'shed') {
    const yLow = ye;
    const yHigh = H + (span + o) * t;
    quad(tri, V(-L / 2, yLow, S / 2), V(L / 2, yLow, S / 2), V(L / 2, yHigh, -S / 2), V(-L / 2, yHigh, -S / 2));
    for (const sx of [-1, 1]) triangle(fill, V((sx * len) / 2, H, span / 2), V((sx * len) / 2, H, -span / 2), V((sx * len) / 2, H + span * t, -span / 2));
    quad(fill, V(-len / 2, H, -span / 2), V(len / 2, H, -span / 2), V(len / 2, H + span * t, -span / 2), V(-len / 2, H + span * t, -span / 2));
  }
  const mk = (arr: number[], material: THREE.Material, uv: number) => {
    if (!arr.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    geo.computeVertexNormals();
    if (uv) {
      // projicera mönstret längs takfallen
      const pos = geo.attributes.position;
      const uvs = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        uvs[i * 2] = pos.getX(i) / uv;
        uvs[i * 2 + 1] = (Math.abs(pos.getZ(i)) / Math.cos(Math.atan(t)) + pos.getY(i) * 0) / uv;
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    }
    const m = new THREE.Mesh(geo, material);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  mk(tri, roofMat, 1.2);
  mk(fill, wallMat === undefined ? mat(b.wallColor) : mat((wallMat as THREE.MeshStandardMaterial).color.getStyle(), { side: THREE.DoubleSide, map: 'panel' }), 0);
  return g;
}

function buildBuilding(b: Building, plan: Plan | undefined, opts: SceneOptions): THREE.Group {
  const g = new THREE.Group();
  placeRect(g, b);
  tag(g, 'building', b.id);
  const ph = PLINTH[b.foundation] * M;
  const H = wallHeight(b) * M;
  const w = b.w * M;
  const d = b.d * M;
  const wallMat = mat(b.wallColor, { map: 'panel' });
  // sockel / grund
  if (b.kind !== 'carport') {
    if (b.foundation === 'plinth') {
      const nx = Math.max(2, Math.ceil(w / 1.8) + 1);
      const nz = Math.max(2, Math.ceil(d / 1.8) + 1);
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < nz; j++) {
          const p = box(0.25, ph, 0.25, mat('#a7a49c'));
          p.position.set(-w / 2 + 0.2 + ((w - 0.4) * i) / (nx - 1), ph / 2, -d / 2 + 0.2 + ((d - 0.4) * j) / (nz - 1));
          g.add(p);
        }
      const floor = box(w, 0.2, d, mat('#8a6f55'));
      floor.position.y = ph - 0.1;
      g.add(floor);
    } else {
      const s = box(w + 0.04, ph, d + 0.04, mat('#9c9a94'));
      s.position.y = ph / 2;
      g.add(s);
    }
  }
  const body = new THREE.Group();
  body.position.y = ph;
  g.add(body);
  if (b.kind === 'carport') {
    const nx = w > 4 ? 3 : 2;
    const nz = Math.max(2, Math.ceil(d / 3) + 1);
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        if (i > 0 && i < nx - 1 && j > 0 && j < nz - 1) continue;
        const p = box(0.12, H, 0.12, mat(b.wallColor));
        p.position.set(-w / 2 + 0.1 + ((w - 0.2) * i) / (nx - 1), H / 2 - ph, -d / 2 + 0.1 + ((d - 0.2) * j) / (nz - 1));
        body.add(p);
      }
    const beam = box(w, 0.3, 0.12, mat(b.wallColor));
    for (const z of [-d / 2 + 0.1, d / 2 - 0.1]) {
      const bm = beam.clone();
      bm.position.set(0, H - ph - 0.15, z);
      body.add(bm);
    }
  } else if (plan && plan.walls.length) {
    body.add(planWalls(b, plan, H, wallMat, opts));
  } else {
    body.add(autoWalls(b, opts.roofs ? H : b.floorHeight * M, wallMat));
  }
  if (opts.roofs) {
    const roof = roofMesh(b, b.kind === 'carport' ? H - ph : H, wallMat);
    if (roofInfo(b).axis === 'z') roof.rotation.y = Math.PI / 2;
    body.add(roof);
  }
  return g;
}

// ---------- Ytor, linjer och växter ----------

function buildArea(a: Area): THREE.Group {
  const g = new THREE.Group();
  placeRect(g, a);
  tag(g, 'area', a.id);
  const w = a.w * M;
  const d = a.d * M;
  const h = a.height * M;
  switch (a.kind) {
    case 'deck': {
      const top = Math.max(0.06, h);
      for (const [px, pz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        const p = box(0.2, top, 0.2, mat('#8d8a82'));
        p.position.set((px * (w - 0.3)) / 2, top / 2, (pz * (d - 0.3)) / 2);
        g.add(p);
      }
      const deck = box(w, 0.05, d, mat(a.color, { map: 'planks' }), 1);
      deck.rotation.y = 0;
      deck.position.y = top - 0.025;
      g.add(deck);
      if (h > 0.5) {
        // räcke på tre sidor
        const rail = mat('#f0eee8');
        for (const [rw, rd, rx, rz] of [
          [w, 0.05, 0, -d / 2],
          [0.05, d, -w / 2, 0],
          [0.05, d, w / 2, 0],
        ]) {
          const r = box(rw, 0.9, rd, mat('#f0eee8', { map: 'pickets' }), 0);
          r.position.set(rx, top + 0.45, rz);
          g.add(r);
          void rail;
        }
      }
      break;
    }
    case 'pool': {
      const water = box(w, 0.04, d, mat(a.color, { rough: 0.1, map: 'water' }), 2);
      water.position.y = 0.02;
      g.add(water);
      const c = mat('#ecebe6');
      for (const [cw, cd, cx, cz] of [
        [w + 0.6, 0.3, 0, -d / 2 - 0.15],
        [w + 0.6, 0.3, 0, d / 2 + 0.15],
        [0.3, d, -w / 2 - 0.15, 0],
        [0.3, d, w / 2 + 0.15, 0],
      ]) {
        const k = box(cw, 0.08, cd, c);
        k.position.set(cx, 0.04, cz);
        g.add(k);
      }
      break;
    }
    case 'bed': {
      const s = box(w, Math.max(0.05, h), d, mat(a.color, { map: 'soil' }), 1);
      s.position.y = Math.max(0.05, h) / 2;
      g.add(s);
      const n = Math.max(1, Math.floor((w * d) / 0.8));
      const rnd = mulberry(a.id.length * 13 + Math.round(w * 10));
      for (let i = 0; i < n; i++) {
        const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18 + rnd() * 0.12, 0), mat(['#5d8f3d', '#7aa64d', '#c0567a', '#e3b440'][i % 4], { rough: 1 }));
        p.position.set((rnd() - 0.5) * (w - 0.4), h + 0.15, (rnd() - 0.5) * (d - 0.4));
        p.castShadow = true;
        g.add(p);
      }
      break;
    }
    default: {
      const map = a.kind === 'patio' ? 'pavers' : a.kind === 'lawn' ? 'grass' : 'gravel';
      const y = a.kind === 'lawn' ? 0.006 : a.kind === 'driveway' ? 0.01 : 0.014;
      const geo = new THREE.PlaneGeometry(w, d);
      geo.rotateX(-Math.PI / 2);
      worldUV(geo, a.kind === 'patio' ? 1.6 : 3);
      const m = new THREE.Mesh(geo, mat(a.color, { map }));
      m.position.y = y;
      m.receiveShadow = true;
      g.add(m);
    }
  }
  return g;
}

function buildLine(l: Line): THREE.Group {
  const g = new THREE.Group();
  tag(g, 'line', l.id);
  const h = l.height * M;
  const wd = Math.max(0.03, l.width * M);
  for (let i = 0; i < l.points.length - 1; i++) {
    const a = v3(l.points[i]);
    const b = v3(l.points[i + 1]);
    const len = a.distanceTo(b);
    if (len < 0.01) continue;
    const seg = new THREE.Group();
    seg.position.copy(a.clone().add(b).multiplyScalar(0.5));
    seg.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    g.add(seg);
    if (l.kind === 'path') {
      const geo = new THREE.PlaneGeometry(len + wd, wd);
      geo.rotateX(-Math.PI / 2);
      worldUV(geo, 1.6);
      const m = new THREE.Mesh(geo, mat(l.color, { map: 'pavers' }));
      m.position.y = 0.012 + i * 0.0005;
      m.receiveShadow = true;
      seg.add(m);
    } else if (l.kind === 'hedge') {
      const m = box(len, h, wd, mat(l.color, { rough: 1, map: 'grass' }), 0.5);
      m.position.y = h / 2;
      seg.add(m);
    } else if (l.kind === 'wall') {
      const m = box(len + wd, h, wd, mat(l.color), 0);
      m.position.y = h / 2;
      seg.add(m);
    } else {
      // staket: spjälor + stolpar
      const geo = new THREE.PlaneGeometry(len, h);
      const uv = geo.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, (uv.getX(k) * len) / 0.48);
      const m = new THREE.Mesh(geo, mat(l.color, { map: 'pickets', side: THREE.DoubleSide }));
      m.position.y = h / 2;
      m.castShadow = true;
      seg.add(m);
      const posts = Math.max(1, Math.round(len / 1.8));
      for (let k = 0; k <= posts; k++) {
        const p = box(0.07, h + 0.05, 0.07, mat(l.color));
        p.position.set(-len / 2 + (len * k) / posts, (h + 0.05) / 2, 0.04);
        seg.add(p);
      }
    }
  }
  return g;
}

function buildPlant(p: Plant): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(v3(p));
  tag(g, 'plant', p.id);
  const r = (p.size * M) / 2;
  const h = p.height * M;
  const trunkMat = mat('#6b4c35');
  if (p.kind === 'bush') {
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), mat('#4f8a3c', { rough: 1 }));
    s.scale.set(r, h / 2, r);
    s.position.y = h / 2;
    s.castShadow = true;
    g.add(s);
    return g;
  }
  if (p.kind === 'pine') {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, h * 0.3, 8), trunkMat);
    trunk.position.y = h * 0.15;
    g.add(trunk);
    for (let i = 0; i < 3; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r * (1 - i * 0.25), h * 0.42, 9), mat('#2f5d3a', { rough: 1 }));
      cone.position.y = h * (0.35 + i * 0.22);
      cone.castShadow = true;
      g.add(cone);
    }
    return g;
  }
  const trunkH = h * (p.kind === 'fruit' ? 0.4 : 0.45);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, trunkH + r * 0.5, 8), trunkMat);
  trunk.position.y = (trunkH + r * 0.5) / 2;
  trunk.castShadow = true;
  g.add(trunk);
  const crownH = Math.max(0.5, h - trunkH);
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), mat(p.kind === 'fruit' ? '#6c9a3e' : '#4e8a3a', { rough: 1 }));
  crown.scale.set(r, crownH / 2, r);
  crown.position.y = trunkH + crownH / 2;
  crown.castShadow = true;
  g.add(crown);
  if (p.kind === 'fruit') {
    const rnd = mulberry(p.id.length * 7 + Math.round(p.x));
    for (let i = 0; i < 10; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), mat('#c8382c', { rough: 0.6 }));
      const a = rnd() * Math.PI * 2;
      const e = (rnd() - 0.3) * 1.2;
      f.position.set(Math.cos(a) * r * Math.cos(e), trunkH + crownH / 2 + (Math.sin(e) * crownH) / 2, Math.sin(a) * r * Math.cos(e));
      g.add(f);
    }
  }
  return g;
}

/** Hela tomten som en three.js-grupp. */
export function buildSite(site: Site, plans: Map<string, Plan>, opts: SceneOptions): THREE.Group {
  const g = new THREE.Group();
  buildPlot(site, g);
  const groups = {
    buildings: new THREE.Group(),
    areas: new THREE.Group(),
    lines: new THREE.Group(),
    plants: new THREE.Group(),
  };
  for (const [k, v] of Object.entries(groups)) {
    v.name = k;
    g.add(v);
  }
  for (const a of site.areas) groups.areas.add(buildArea(a));
  for (const b of site.buildings) groups.buildings.add(buildBuilding(b, b.planId ? plans.get(b.planId) : undefined, opts));
  for (const l of site.lines) groups.lines.add(buildLine(l));
  for (const p of site.plants) groups.plants.add(buildPlant(p));
  return g;
}

/** Frigör geometrier (material och texturer återanvänds). */
export function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
  });
}
