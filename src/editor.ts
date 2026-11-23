import type { Plan, Vec, Selection, Wall, Item, OpeningKind, Room } from './types';
import type { Store } from './store';
import {
  dist,
  snapValue,
  projectOnSegment,
  pointInPolygon,
  pointInRotatedRect,
  rotatePoint,
  lockAngle,
  uid,
  formatLength,
  formatArea,
  polygonArea,
  clamp,
} from './geometry';
import { renderPlan, renderOpening, renderDimension, openingFrame, planBounds, wallAngle, type RenderOptions } from './render';
import { furnitureDef } from './furniture';

export type Tool =
  | 'select'
  | 'pan'
  | 'wall'
  | 'room'
  | 'polyroom'
  | 'door'
  | 'double'
  | 'sliding'
  | 'window'
  | 'opening'
  | 'furniture'
  | 'label'
  | 'dim';

export const OPENING_TOOLS: Record<string, { kind: OpeningKind; width: number }> = {
  door: { kind: 'door', width: 900 },
  double: { kind: 'double', width: 1400 },
  sliding: { kind: 'sliding', width: 1600 },
  window: { kind: 'window', width: 1200 },
  opening: { kind: 'opening', width: 1000 },
};

export const ROOM_COLORS = ['#f6efe3', '#e8eef7', '#e3f0f2', '#eef3e6', '#f7e9ec', '#efeeea', '#f3ecf7', '#fdf3d8'];

export const TOOL_HINTS: Record<Tool, string> = {
  select: 'Klicka för att markera, dra för att flytta. Dra i tom yta för att panorera. Delete tar bort.',
  pan: 'Dra för att flytta vyn. Scrolla för att zooma.',
  wall: 'Klicka för att börja, klicka för varje hörn. Dubbelklicka, Enter eller Esc avslutar. Shift låser vinkeln.',
  room: 'Dra upp en rektangel för ett rum. Väggar skapas automatiskt om valet är på.',
  polyroom: 'Klicka ut hörnen i rummet. Klicka på första punkten, dubbelklicka eller tryck Enter för att stänga.',
  door: 'Klicka på en vägg för att placera en dörr.',
  double: 'Klicka på en vägg för att placera en pardörr.',
  sliding: 'Klicka på en vägg för att placera en skjutdörr.',
  window: 'Klicka på en vägg för att placera ett fönster.',
  opening: 'Klicka på en vägg för att göra en öppning (utan dörr).',
  furniture: 'Klicka i ritningen för att placera möbeln. Q/E roterar.',
  label: 'Klicka för att placera en text.',
  dim: 'Klicka i startpunkt och slutpunkt för en måttlinje. Shift låser vinkeln.',
};

export interface EditorSettings extends RenderOptions {
  snap: boolean;
  gridStep: number;
  wallThickness: number;
  createWalls: boolean;
}

type Drag =
  | { mode: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { mode: 'move'; start: Vec; orig: string; moved: boolean }
  | { mode: 'wall-end'; wallId: string; end: 'a' | 'b'; orig: Vec; moved: boolean }
  | { mode: 'room-vertex'; roomId: string; index: number; moved: boolean }
  | { mode: 'dim-end'; dimId: string; end: 'a' | 'b'; moved: boolean }
  | { mode: 'resize'; itemId: string; moved: boolean }
  | { mode: 'rotate'; itemId: string; moved: boolean }
  | { mode: 'room-rect'; start: Vec };

const SVGNS = 'http://www.w3.org/2000/svg';
const EPS = 1;
const same = (a: Vec, b: Vec) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;

export class Editor {
  tool: Tool = 'select';
  furnitureType = 'sofa-3';
  selection: Selection | null = null;
  settings: EditorSettings = {
    snap: true,
    gridStep: 100,
    wallThickness: 150,
    createWalls: true,
    showWallLengths: true,
    showAreas: true,
    showFurniture: true,
  };
  /** px per mm */
  scale = 0.08;
  tx = 0;
  ty = 0;

  onSelectionChange: () => void = () => {};
  onToolChange: () => void = () => {};
  onStatus: (s: { cursor?: Vec; zoom?: number; hint?: string; measure?: string }) => void = () => {};

  private gridG: SVGGElement;
  private worldG: SVGGElement;
  private sceneG: SVGGElement;
  private overlayG: SVGGElement;
  private chain: Vec[] = [];
  private cursor: Vec = { x: 0, y: 0 };
  private rawCursor: Vec = { x: 0, y: 0 };
  private snapHit: Vec | null = null;
  private drag: Drag | null = null;
  private shift = false;
  private spaceDown = false;
  private lastClick = 0;

  constructor(private svg: SVGSVGElement, private store: Store) {
    this.gridG = this.el('g', { class: 'grid' });
    this.worldG = this.el('g', { class: 'world' });
    this.sceneG = this.el('g', { class: 'scene' });
    this.overlayG = this.el('g', { class: 'overlay' });
    this.worldG.append(this.sceneG, this.overlayG);
    svg.append(this.gridG, this.worldG);

    svg.addEventListener('pointerdown', (e) => this.pointerDown(e));
    svg.addEventListener('pointermove', (e) => this.pointerMove(e));
    svg.addEventListener('pointerup', (e) => this.pointerUp(e));
    svg.addEventListener('pointerleave', () => {
      this.snapHit = null;
      this.renderOverlay();
    });
    svg.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    svg.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.finishChain();
    });
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this.shift = false;
      if (e.code === 'Space') {
        this.spaceDown = false;
        this.svg.classList.remove('panning');
      }
    });
    new ResizeObserver(() => this.renderAll()).observe(svg);
    store.subscribe(() => {
      if (this.selection && !this.findEntity(this.selection)) this.select(null);
      this.renderAll();
    });
  }

  get plan(): Plan {
    return this.store.plan;
  }

  // ---------- Vy ----------

  toWorld(sx: number, sy: number): Vec {
    return { x: (sx - this.tx) / this.scale, y: (sy - this.ty) / this.scale };
  }

  private screenPoint(e: PointerEvent | WheelEvent | MouseEvent) {
    const r = this.svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  zoomAt(factor: number, sx?: number, sy?: number) {
    const r = this.svg.getBoundingClientRect();
    const cx = sx ?? r.width / 2;
    const cy = sy ?? r.height / 2;
    const w = this.toWorld(cx, cy);
    this.scale = clamp(this.scale * factor, 0.005, 3);
    this.tx = cx - w.x * this.scale;
    this.ty = cy - w.y * this.scale;
    this.renderAll();
  }

  fitView() {
    const r = this.svg.getBoundingClientRect();
    const b = planBounds(this.plan) ?? { minX: 0, minY: 0, maxX: 8000, maxY: 6000 };
    const pad = 900;
    const w = b.maxX - b.minX + pad * 2;
    const h = b.maxY - b.minY + pad * 2;
    if (r.width < 10 || r.height < 10) return;
    this.scale = clamp(Math.min(r.width / w, r.height / h), 0.005, 3);
    this.tx = r.width / 2 - ((b.minX + b.maxX) / 2) * this.scale;
    this.ty = r.height / 2 - ((b.minY + b.maxY) / 2) * this.scale;
    this.renderAll();
  }

  // ---------- Verktyg & markering ----------

  setTool(tool: Tool, furnitureType?: string) {
    this.chain = [];
    this.drag = null;
    this.tool = tool;
    if (furnitureType) this.furnitureType = furnitureType;
    this.svg.dataset.tool = tool;
    this.onToolChange();
    this.onStatus({ hint: TOOL_HINTS[tool] });
    this.renderOverlay();
  }

  select(sel: Selection | null) {
    this.selection = sel;
    this.onSelectionChange();
    this.renderOverlay();
  }

  findEntity(sel: Selection): any {
    const p = this.plan;
    const list: Record<Selection['kind'], { id: string }[]> = {
      wall: p.walls,
      opening: p.openings,
      room: p.rooms,
      item: p.items,
      label: p.labels,
      dim: p.dims,
    };
    return list[sel.kind].find((x) => x.id === sel.id) ?? null;
  }

  deleteSelection() {
    const sel = this.selection;
    if (!sel) return;
    this.store.checkpoint();
    const p = this.plan;
    switch (sel.kind) {
      case 'wall':
        p.walls = p.walls.filter((w) => w.id !== sel.id);
        p.openings = p.openings.filter((o) => o.wallId !== sel.id);
        break;
      case 'opening':
        p.openings = p.openings.filter((o) => o.id !== sel.id);
        break;
      case 'room':
        p.rooms = p.rooms.filter((r) => r.id !== sel.id);
        break;
      case 'item':
        p.items = p.items.filter((i) => i.id !== sel.id);
        break;
      case 'label':
        p.labels = p.labels.filter((l) => l.id !== sel.id);
        break;
      case 'dim':
        p.dims = p.dims.filter((d) => d.id !== sel.id);
        break;
    }
    this.selection = null;
    this.onSelectionChange();
    this.store.changed();
  }

  duplicateSelection() {
    const sel = this.selection;
    if (!sel) return;
    const ent = this.findEntity(sel);
    if (!ent) return;
    const off = 300;
    const copy = JSON.parse(JSON.stringify(ent));
    copy.id = uid(sel.kind[0]);
    this.store.checkpoint();
    const p = this.plan;
    switch (sel.kind) {
      case 'item':
        copy.x += off;
        copy.y += off;
        p.items.push(copy);
        break;
      case 'label':
        copy.y += copy.size * 1.5;
        p.labels.push(copy);
        break;
      case 'room':
        copy.points = copy.points.map((q: Vec) => ({ x: q.x + off, y: q.y + off }));
        copy.name += ' (kopia)';
        p.rooms.push(copy);
        break;
      case 'wall':
        copy.a.x += off;
        copy.a.y += off;
        copy.b.x += off;
        copy.b.y += off;
        p.walls.push(copy);
        break;
      case 'dim':
        copy.a.y += off;
        copy.b.y += off;
        p.dims.push(copy);
        break;
      case 'opening': {
        const wall = p.walls.find((w) => w.id === copy.wallId)!;
        const len = dist(wall.a, wall.b);
        copy.t = clamp(copy.t + (copy.width + 200) / len, 0, 1);
        p.openings.push(copy);
        break;
      }
    }
    this.store.changed();
    this.select({ kind: sel.kind, id: copy.id });
  }

  rotateSelection(deg: number) {
    const sel = this.selection;
    if (sel?.kind !== 'item') return;
    const it = this.findEntity(sel) as Item;
    this.store.checkpoint();
    it.rotation = (((it.rotation + deg) % 360) + 360) % 360;
    this.store.changed();
  }

  // ---------- Snäppning ----------

  private tol(px = 10) {
    return px / this.scale;
  }

  private snapPoint(p: Vec, exclude?: Vec): Vec {
    this.snapHit = null;
    let best: Vec | null = null;
    let bestD = this.tol(12);
    const consider = (q: Vec) => {
      if (exclude && same(q, exclude)) return;
      const d = dist(p, q);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    };
    for (const w of this.plan.walls) {
      consider(w.a);
      consider(w.b);
    }
    for (const r of this.plan.rooms) r.points.forEach(consider);
    if (this.chain.length > 0) consider(this.chain[0]);
    if (best) {
      this.snapHit = best;
      return { ...(best as Vec) };
    }
    return this.gridSnap(p);
  }

  private gridSnap(p: Vec): Vec {
    if (!this.settings.snap) return { x: Math.round(p.x), y: Math.round(p.y) };
    const s = this.settings.gridStep;
    return { x: snapValue(p.x, s), y: snapValue(p.y, s) };
  }

  private snapDelta(v: number) {
    return this.settings.snap ? snapValue(v, this.settings.gridStep) : Math.round(v);
  }

  // ---------- Träfftest ----------

  private hitTest(p: Vec): Selection | null {
    const plan = this.plan;
    const tol = this.tol(5);
    for (const o of [...plan.openings].reverse()) {
      const f = openingFrame(plan, o);
      if (f && pointInRotatedRect(p, f.c.x, f.c.y, o.width, f.wall.thickness, f.angle, tol)) return { kind: 'opening', id: o.id };
    }
    for (const l of [...plan.labels].reverse()) {
      const half = (l.text.length * l.size) / 3.6;
      if (Math.abs(p.x - l.x) <= half + tol && Math.abs(p.y - l.y) <= l.size * 0.6 + tol) return { kind: 'label', id: l.id };
    }
    for (const d of [...plan.dims].reverse()) {
      if (projectOnSegment(p, d.a, d.b).dist <= tol + 40) return { kind: 'dim', id: d.id };
    }
    for (const w of [...plan.walls].reverse()) {
      if (projectOnSegment(p, w.a, w.b).dist <= w.thickness / 2 + tol) return { kind: 'wall', id: w.id };
    }
    if (this.settings.showFurniture) {
      for (const it of [...plan.items].reverse()) {
        if (pointInRotatedRect(p, it.x, it.y, it.w, it.d, it.rotation, tol)) return { kind: 'item', id: it.id };
      }
    }
    for (const r of [...plan.rooms].reverse()) {
      if (pointInPolygon(p, r.points)) return { kind: 'room', id: r.id };
    }
    return null;
  }

  private nearestWall(p: Vec): { wall: Wall; t: number; point: Vec } | null {
    let best: { wall: Wall; t: number; point: Vec } | null = null;
    let bestD = Infinity;
    for (const w of this.plan.walls) {
      const pr = projectOnSegment(p, w.a, w.b);
      if (pr.dist <= w.thickness / 2 + this.tol(14) && pr.dist < bestD) {
        bestD = pr.dist;
        best = { wall: w, t: pr.t, point: pr.point };
      }
    }
    return best;
  }

  private itemHandles(it: Item) {
    const resize = rotatePoint({ x: it.x + it.w / 2, y: it.y + it.d / 2 }, it.rotation, it);
    const rotate = rotatePoint({ x: it.x, y: it.y - it.d / 2 - this.tol(28) }, it.rotation, it);
    return { resize, rotate };
  }

  private hitHandle(p: Vec): Drag | null {
    const sel = this.selection;
    if (!sel) return null;
    const ent = this.findEntity(sel);
    if (!ent) return null;
    const r = this.tol(8);
    if (sel.kind === 'wall') {
      const w = ent as Wall;
      if (dist(p, w.a) <= r) return { mode: 'wall-end', wallId: w.id, end: 'a', orig: { ...w.a }, moved: false };
      if (dist(p, w.b) <= r) return { mode: 'wall-end', wallId: w.id, end: 'b', orig: { ...w.b }, moved: false };
    }
    if (sel.kind === 'item') {
      const h = this.itemHandles(ent);
      if (dist(p, h.resize) <= r) return { mode: 'resize', itemId: ent.id, moved: false };
      if (dist(p, h.rotate) <= r) return { mode: 'rotate', itemId: ent.id, moved: false };
    }
    if (sel.kind === 'room') {
      const idx = (ent as Room).points.findIndex((q) => dist(p, q) <= r);
      if (idx >= 0) return { mode: 'room-vertex', roomId: ent.id, index: idx, moved: false };
    }
    if (sel.kind === 'dim') {
      if (dist(p, ent.a) <= r) return { mode: 'dim-end', dimId: ent.id, end: 'a', moved: false };
      if (dist(p, ent.b) <= r) return { mode: 'dim-end', dimId: ent.id, end: 'b', moved: false };
    }
    return null;
  }

  // ---------- Händelser ----------

  private pointerDown(e: PointerEvent) {
    if (e.button === 2) return;
    this.svg.setPointerCapture(e.pointerId);
    const sp = this.screenPoint(e);
    const p = this.toWorld(sp.x, sp.y);
    this.shift = e.shiftKey;

    if (e.button === 1 || this.tool === 'pan' || this.spaceDown) {
      this.drag = { mode: 'pan', sx: sp.x, sy: sp.y, vx: this.tx, vy: this.ty };
      this.svg.classList.add('panning');
      return;
    }

    const now = performance.now();
    const dbl = now - this.lastClick < 320;
    this.lastClick = now;

    switch (this.tool) {
      case 'select': {
        const h = this.hitHandle(p);
        if (h) {
          this.drag = h;
          return;
        }
        const hit = this.hitTest(p);
        if (hit) {
          if (!this.selection || this.selection.id !== hit.id) this.select(hit);
          this.drag = { mode: 'move', start: p, orig: JSON.stringify(this.plan), moved: false };
        } else {
          this.select(null);
          this.drag = { mode: 'pan', sx: sp.x, sy: sp.y, vx: this.tx, vy: this.ty };
          this.svg.classList.add('panning');
        }
        return;
      }
      case 'wall': {
        if (dbl && this.chain.length) {
          this.finishChain();
          return;
        }
        let q = this.snapPoint(p);
        if (this.chain.length) {
          const last = this.chain[this.chain.length - 1];
          if (this.shift && !this.snapHit) q = this.gridSnapLen(last, lockAngle(last, q, 45));
          if (dist(last, q) < 20) return;
          this.store.checkpoint();
          this.plan.walls.push({ id: uid('w'), a: { ...last }, b: { ...q }, thickness: this.settings.wallThickness });
          this.store.changed();
          if (same(q, this.chain[0])) {
            this.chain = [];
            this.renderOverlay();
            return;
          }
        }
        this.chain.push(q);
        this.renderOverlay();
        return;
      }
      case 'polyroom': {
        const q = this.snapPoint(p);
        if (this.chain.length >= 3 && (dbl || same(q, this.chain[0]))) {
          this.finishChain();
          return;
        }
        if (this.chain.length && same(q, this.chain[this.chain.length - 1])) return;
        this.chain.push(q);
        this.renderOverlay();
        return;
      }
      case 'room':
        this.drag = { mode: 'room-rect', start: this.snapPoint(p) };
        return;
      case 'dim': {
        let q = this.snapPoint(p);
        if (this.chain.length === 0) {
          this.chain = [q];
        } else {
          const a = this.chain[0];
          if (this.shift && !this.snapHit) q = lockAngle(a, q, 45);
          if (dist(a, q) > 20) {
            this.store.checkpoint();
            const d = { id: uid('d'), a, b: q };
            this.plan.dims.push(d);
            this.chain = [];
            this.store.changed();
            this.select({ kind: 'dim', id: d.id });
          }
        }
        this.renderOverlay();
        return;
      }
      case 'label': {
        const q = this.gridSnap(p);
        this.store.checkpoint();
        const l = { id: uid('l'), x: q.x, y: q.y, text: 'Text', size: 220 };
        this.plan.labels.push(l);
        this.store.changed();
        this.setTool('select');
        this.select({ kind: 'label', id: l.id });
        return;
      }
      case 'furniture': {
        const q = this.gridSnap(p);
        const def = furnitureDef(this.furnitureType);
        this.store.checkpoint();
        const it: Item = { id: uid('i'), type: def.type, x: q.x, y: q.y, w: def.w, d: def.d, rotation: 0, color: def.color };
        if (def.type === 'rug') this.plan.items.unshift(it);
        else this.plan.items.push(it);
        this.store.changed();
        this.setTool('select');
        this.select({ kind: 'item', id: it.id });
        return;
      }
      default: {
        const spec = OPENING_TOOLS[this.tool];
        if (!spec) return;
        const nw = this.nearestWall(p);
        if (!nw) {
          this.onStatus({ hint: 'Klicka på en vägg – dörrar och fönster placeras i väggar.' });
          return;
        }
        const len = dist(nw.wall.a, nw.wall.b);
        const width = Math.min(spec.width, Math.max(300, len - 100));
        const t = this.openingT(nw.wall, nw.point, width);
        this.store.checkpoint();
        const o = { id: uid('o'), wallId: nw.wall.id, kind: spec.kind, t, width, flip: false, side: false };
        this.plan.openings.push(o);
        this.store.changed();
        this.select({ kind: 'opening', id: o.id });
      }
    }
  }

  /** t för en öppning så att den ligger helt inom väggen, med mittpunkt snäppt till rutnätet. */
  private openingT(wall: Wall, point: Vec, width: number) {
    const len = dist(wall.a, wall.b);
    let along = dist(wall.a, point);
    if (this.settings.snap) along = snapValue(along, Math.min(this.settings.gridStep, 50));
    along = clamp(along, width / 2, len - width / 2);
    return len ? along / len : 0.5;
  }

  private gridSnapLen(from: Vec, to: Vec): Vec {
    if (!this.settings.snap) return to;
    const len = dist(from, to);
    const sl = snapValue(len, this.settings.gridStep);
    if (len < 1) return to;
    return { x: from.x + ((to.x - from.x) / len) * sl, y: from.y + ((to.y - from.y) / len) * sl };
  }

  private pointerMove(e: PointerEvent) {
    const sp = this.screenPoint(e);
    const p = this.toWorld(sp.x, sp.y);
    this.shift = e.shiftKey;
    this.rawCursor = p;
    const d = this.drag;

    if (d?.mode === 'pan') {
      this.tx = d.vx + (sp.x - d.sx);
      this.ty = d.vy + (sp.y - d.sy);
      this.renderAll();
      return;
    }

    if (d && d.mode !== 'room-rect') {
      this.dragTo(d, p);
      return;
    }

    // Förhandsvisning av verktyg
    this.snapHit = null;
    if (['wall', 'polyroom', 'dim', 'room'].includes(this.tool)) {
      let q = this.snapPoint(p);
      const last = this.chain[this.chain.length - 1];
      if (last && this.shift && !this.snapHit) q = this.tool === 'wall' ? this.gridSnapLen(last, lockAngle(last, q, 45)) : lockAngle(last, q, 45);
      this.cursor = q;
    } else {
      this.cursor = this.gridSnap(p);
    }
    this.onStatus({ cursor: this.cursor });
    this.renderOverlay();
  }

  private dragTo(d: Exclude<Drag, { mode: 'pan' } | { mode: 'room-rect' }>, p: Vec) {
    const plan = this.plan;
    const begin = () => {
      if (!d.moved) {
        if (d.mode === 'move') this.store.undoBase(d.orig);
        else this.store.checkpoint();
        d.moved = true;
      }
    };
    switch (d.mode) {
      case 'move': {
        const sel = this.selection;
        if (!sel) return;
        const dx = this.snapDelta(p.x - d.start.x);
        const dy = this.snapDelta(p.y - d.start.y);
        if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < this.tol(3)) return;
        begin();
        const orig: Plan = JSON.parse(d.orig);
        this.applyMove(orig, sel, dx, dy, p);
        break;
      }
      case 'wall-end': {
        const w = plan.walls.find((x) => x.id === d.wallId);
        if (!w) return;
        begin();
        const other = d.end === 'a' ? w.b : w.a;
        let q = this.snapPoint(p, d.orig);
        if (this.shift && !this.snapHit) q = this.gridSnapLen(other, lockAngle(other, q, 45));
        const cur = { ...w[d.end] };
        this.moveVertexEverywhere(cur, q);
        w[d.end] = q;
        this.onStatus({ measure: formatLength(dist(w.a, w.b)) });
        break;
      }
      case 'room-vertex': {
        const r = plan.rooms.find((x) => x.id === d.roomId);
        if (!r) return;
        begin();
        r.points[d.index] = this.snapPoint(p, r.points[d.index]);
        this.onStatus({ measure: formatArea(polygonArea(r.points)) });
        break;
      }
      case 'dim-end': {
        const dm = plan.dims.find((x) => x.id === d.dimId);
        if (!dm) return;
        begin();
        dm[d.end] = this.snapPoint(p, dm[d.end]);
        break;
      }
      case 'resize': {
        const it = plan.items.find((x) => x.id === d.itemId);
        if (!it) return;
        begin();
        const local = rotatePoint(p, -it.rotation, it);
        const step = this.settings.snap ? 50 : 1;
        it.w = Math.max(100, snapValue(Math.abs(local.x - it.x) * 2, step));
        it.d = Math.max(100, snapValue(Math.abs(local.y - it.y) * 2, step));
        this.onStatus({ measure: `${formatLength(it.w)} × ${formatLength(it.d)}` });
        break;
      }
      case 'rotate': {
        const it = plan.items.find((x) => x.id === d.itemId);
        if (!it) return;
        begin();
        let deg = (Math.atan2(p.y - it.y, p.x - it.x) * 180) / Math.PI + 90;
        deg = this.shift ? Math.round(deg) : Math.round(deg / 15) * 15;
        it.rotation = ((deg % 360) + 360) % 360;
        this.onStatus({ measure: `${it.rotation}°` });
        break;
      }
    }
    this.store.changed();
  }

  /** Flytta alla väggändar och rumshörn som ligger i `from` till `to` (håller ihop väggar). */
  private moveVertexEverywhere(from: Vec, to: Vec, plan: Plan = this.plan, exceptWall?: string) {
    for (const w of plan.walls) {
      if (w.id === exceptWall) continue;
      if (same(w.a, from)) w.a = { ...to };
      if (same(w.b, from)) w.b = { ...to };
    }
    for (const r of plan.rooms) r.points = r.points.map((q) => (same(q, from) ? { ...to } : q));
  }

  private applyMove(orig: Plan, sel: Selection, dx: number, dy: number, p: Vec) {
    const plan = this.plan;
    switch (sel.kind) {
      case 'item': {
        const o = orig.items.find((x) => x.id === sel.id);
        const it = plan.items.find((x) => x.id === sel.id);
        if (o && it) {
          it.x = o.x + dx;
          it.y = o.y + dy;
        }
        break;
      }
      case 'label': {
        const o = orig.labels.find((x) => x.id === sel.id);
        const l = plan.labels.find((x) => x.id === sel.id);
        if (o && l) {
          l.x = o.x + dx;
          l.y = o.y + dy;
        }
        break;
      }
      case 'dim': {
        const o = orig.dims.find((x) => x.id === sel.id);
        const dm = plan.dims.find((x) => x.id === sel.id);
        if (o && dm) {
          dm.a = { x: o.a.x + dx, y: o.a.y + dy };
          dm.b = { x: o.b.x + dx, y: o.b.y + dy };
        }
        break;
      }
      case 'room': {
        const o = orig.rooms.find((x) => x.id === sel.id);
        const r = plan.rooms.find((x) => x.id === sel.id);
        if (o && r) r.points = o.points.map((q) => ({ x: q.x + dx, y: q.y + dy }));
        break;
      }
      case 'wall': {
        // Återställ från originalet och flytta väggen + anslutna ändpunkter
        const o = orig.walls.find((x) => x.id === sel.id);
        if (!o) return;
        plan.walls = JSON.parse(JSON.stringify(orig.walls));
        plan.rooms = JSON.parse(JSON.stringify(orig.rooms));
        const w = plan.walls.find((x) => x.id === sel.id)!;
        const na = { x: o.a.x + dx, y: o.a.y + dy };
        const nb = { x: o.b.x + dx, y: o.b.y + dy };
        this.moveVertexEverywhere(o.a, na, plan, w.id);
        this.moveVertexEverywhere(o.b, nb, plan, w.id);
        w.a = na;
        w.b = nb;
        break;
      }
      case 'opening': {
        const op = plan.openings.find((x) => x.id === sel.id);
        const w = op && plan.walls.find((x) => x.id === op.wallId);
        if (!op || !w) return;
        const nw = this.nearestWall(p);
        if (nw && nw.wall.id !== w.id) {
          op.wallId = nw.wall.id;
          op.t = this.openingT(nw.wall, nw.point, op.width);
        } else {
          op.t = this.openingT(w, projectOnSegment(p, w.a, w.b).point, op.width);
        }
        break;
      }
    }
  }

  private pointerUp(e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    this.svg.classList.remove('panning');
    try {
      this.svg.releasePointerCapture(e.pointerId);
    } catch {
      /* ignorera */
    }
    if (d?.mode === 'room-rect') {
      const sp = this.screenPoint(e);
      const b = this.snapPoint(this.toWorld(sp.x, sp.y));
      const a = d.start;
      if (Math.abs(b.x - a.x) >= 300 && Math.abs(b.y - a.y) >= 300) {
        const x1 = Math.min(a.x, b.x);
        const x2 = Math.max(a.x, b.x);
        const y1 = Math.min(a.y, b.y);
        const y2 = Math.max(a.y, b.y);
        this.createRoom([
          { x: x1, y: y1 },
          { x: x2, y: y1 },
          { x: x2, y: y2 },
          { x: x1, y: y2 },
        ]);
      }
      this.renderOverlay();
    }
    if (d && 'moved' in d && d.moved) this.onSelectionChange();
    this.onStatus({ measure: '' });
  }

  private createRoom(points: Vec[]) {
    this.store.checkpoint();
    const n = this.plan.rooms.length;
    const room: Room = { id: uid('r'), name: `Rum ${n + 1}`, color: ROOM_COLORS[n % ROOM_COLORS.length], points };
    this.plan.rooms.push(room);
    if (this.settings.createWalls) {
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const exists = this.plan.walls.some((w) => (same(w.a, a) && same(w.b, b)) || (same(w.a, b) && same(w.b, a)));
        if (!exists) this.plan.walls.push({ id: uid('w'), a: { ...a }, b: { ...b }, thickness: this.settings.wallThickness });
      }
    }
    this.store.changed();
    this.setTool('select');
    this.select({ kind: 'room', id: room.id });
  }

  finishChain() {
    if (this.tool === 'polyroom' && this.chain.length >= 3) {
      const pts = this.chain;
      this.chain = [];
      this.createRoom(pts);
      return;
    }
    this.chain = [];
    this.renderOverlay();
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    const sp = this.screenPoint(e);
    if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
      const factor = Math.pow(1.0015, -e.deltaY * (e.deltaMode === 1 ? 30 : 1));
      this.zoomAt(factor, sp.x, sp.y);
    } else {
      this.tx -= e.deltaX;
      this.renderAll();
    }
  }

  private keyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    if (e.key === 'Shift') this.shift = true;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.store.redo();
      else this.store.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.store.redo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      this.duplicateSelection();
      return;
    }
    if (mod) return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.spaceDown = true;
      this.svg.classList.add('panning');
      return;
    }
    switch (e.key) {
      case 'Escape':
        if (this.chain.length) this.finishChain();
        else if (this.tool !== 'select') this.setTool('select');
        else this.select(null);
        return;
      case 'Enter':
        this.finishChain();
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        this.deleteSelection();
        return;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        if (this.selection) {
          e.preventDefault();
          this.nudge(e.key, e.shiftKey ? 100 : 10);
        }
        return;
    }
    const keyTools: Record<string, Tool> = { v: 'select', h: 'pan', w: 'wall', r: 'room', p: 'polyroom', d: 'door', f: 'window', t: 'label', m: 'dim' };
    const k = e.key.toLowerCase();
    if (k === 'q' || k === 'e') {
      const step = e.shiftKey ? 90 : 15;
      if (this.tool === 'furniture') return;
      this.rotateSelection(k === 'q' ? -step : step);
      return;
    }
    if (keyTools[k]) this.setTool(keyTools[k]);
  }

  private nudge(key: string, step: number) {
    const sel = this.selection!;
    const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
    const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
    if (sel.kind === 'opening') {
      const op = this.findEntity(sel);
      const w = this.plan.walls.find((x) => x.id === op.wallId);
      if (!w) return;
      const len = dist(w.a, w.b);
      this.store.checkpoint();
      const dir = dx + dy;
      op.t = clamp(op.t + dir / len, op.width / 2 / len, 1 - op.width / 2 / len);
      this.store.changed();
      return;
    }
    this.store.checkpoint();
    const orig: Plan = JSON.parse(JSON.stringify(this.plan));
    this.applyMove(orig, sel, dx, dy, this.rawCursor);
    this.store.changed();
  }

  // ---------- Rendering ----------

  renderAll() {
    this.worldG.setAttribute('transform', `matrix(${this.scale} 0 0 ${this.scale} ${this.tx} ${this.ty})`);
    this.renderGrid();
    this.sceneG.innerHTML = renderPlan(this.plan, this.settings);
    this.renderOverlay();
    this.onStatus({ zoom: this.scale });
  }

  private renderGrid() {
    const r = this.svg.getBoundingClientRect();
    const tl = this.toWorld(0, 0);
    const br = this.toWorld(r.width, r.height);
    let minor = 100;
    while (minor * this.scale < 8) minor *= minor === 100 ? 5 : 2;
    const major = minor === 100 ? 1000 : minor * 5;
    const lines: string[] = [];
    const add = (step: number, cls: string) => {
      const x0 = Math.floor(tl.x / step) * step;
      const y0 = Math.floor(tl.y / step) * step;
      let path = '';
      for (let x = x0; x <= br.x; x += step) {
        const sx = Math.round(x * this.scale + this.tx) + 0.5;
        path += `M${sx} 0V${r.height}`;
      }
      for (let y = y0; y <= br.y; y += step) {
        const sy = Math.round(y * this.scale + this.ty) + 0.5;
        path += `M0 ${sy}H${r.width}`;
      }
      lines.push(`<path class="${cls}" d="${path}"/>`);
    };
    add(minor, 'grid-minor');
    add(major, 'grid-major');
    // Origo
    const ox = Math.round(this.tx) + 0.5;
    const oy = Math.round(this.ty) + 0.5;
    lines.push(`<path class="grid-origin" d="M${ox - 8} ${oy}H${ox + 8}M${ox} ${oy - 8}V${oy + 8}"/>`);
    this.gridG.innerHTML = lines.join('');
  }

  renderOverlay() {
    const out: string[] = [];
    const s = this.scale;
    const px = (n: number) => n / s;
    const HS = 'class="sel-stroke"';
    const handle = (p: Vec, cls = 'handle') => `<circle class="${cls}" cx="${p.x}" cy="${p.y}" r="${px(5)}"/>`;
    const plan = this.plan;

    // Markering
    const sel = this.selection;
    const ent = sel && this.findEntity(sel);
    if (sel && ent) {
      switch (sel.kind) {
        case 'wall': {
          const w = ent as Wall;
          out.push(`<line ${HS} x1="${w.a.x}" y1="${w.a.y}" x2="${w.b.x}" y2="${w.b.y}" stroke-width="${w.thickness + px(6)}" stroke-linecap="square" class="sel-wall"/>`);
          out.push(handle(w.a), handle(w.b));
          break;
        }
        case 'opening': {
          const f = openingFrame(plan, ent);
          if (f) {
            out.push(
              `<rect ${HS} x="${-ent.width / 2}" y="${-f.wall.thickness / 2 - px(4)}" width="${ent.width}" height="${f.wall.thickness + px(8)}" transform="translate(${f.c.x} ${f.c.y}) rotate(${f.angle})"/>`,
            );
          }
          break;
        }
        case 'room': {
          const r = ent as Room;
          out.push(`<polygon ${HS} points="${r.points.map((q) => `${q.x},${q.y}`).join(' ')}"/>`);
          r.points.forEach((q) => out.push(handle(q, 'handle handle-sq')));
          break;
        }
        case 'item': {
          const it = ent as Item;
          const h = this.itemHandles(it);
          const top = rotatePoint({ x: it.x, y: it.y - it.d / 2 }, it.rotation, it);
          out.push(`<rect ${HS} x="${-it.w / 2}" y="${-it.d / 2}" width="${it.w}" height="${it.d}" transform="translate(${it.x} ${it.y}) rotate(${it.rotation})"/>`);
          out.push(`<line ${HS} x1="${top.x}" y1="${top.y}" x2="${h.rotate.x}" y2="${h.rotate.y}"/>`);
          out.push(handle(h.resize, 'handle handle-sq'), handle(h.rotate, 'handle handle-rot'));
          break;
        }
        case 'label': {
          const half = (ent.text.length * ent.size) / 3.6;
          out.push(`<rect ${HS} x="${ent.x - half}" y="${ent.y - ent.size * 0.6}" width="${half * 2}" height="${ent.size * 1.2}"/>`);
          break;
        }
        case 'dim':
          out.push(`<line ${HS} x1="${ent.a.x}" y1="${ent.a.y}" x2="${ent.b.x}" y2="${ent.b.y}"/>`, handle(ent.a), handle(ent.b));
          break;
      }
    }

    // Verktygsförhandsvisning
    const c = this.cursor;
    const showCursor = this.tool !== 'select' && this.tool !== 'pan';
    if (this.tool === 'wall' && this.chain.length) {
      const pts = [...this.chain, c];
      out.push(`<polyline class="preview-wall" points="${pts.map((q) => `${q.x},${q.y}`).join(' ')}" stroke-width="${this.settings.wallThickness}"/>`);
      const last = this.chain[this.chain.length - 1];
      out.push(renderDimension({ a: last, b: c }, '#1d6fd8', this.settings.wallThickness / 2 + px(18)));
      this.onStatus({ measure: formatLength(dist(last, c)) });
    }
    if (this.tool === 'polyroom' && this.chain.length) {
      const pts = [...this.chain, c];
      out.push(`<polygon class="preview-room" points="${pts.map((q) => `${q.x},${q.y}`).join(' ')}"/>`);
      if (pts.length >= 3) this.onStatus({ measure: formatArea(polygonArea(pts)) });
      this.chain.forEach((q) => out.push(handle(q, 'handle handle-sq')));
    }
    if (this.tool === 'room' && this.drag?.mode === 'room-rect') {
      const a = this.drag.start;
      const x = Math.min(a.x, c.x);
      const y = Math.min(a.y, c.y);
      const w = Math.abs(c.x - a.x);
      const h = Math.abs(c.y - a.y);
      out.push(`<rect class="preview-room" x="${x}" y="${y}" width="${w}" height="${h}"/>`);
      out.push(renderDimension({ a: { x, y }, b: { x: x + w, y } }, '#1d6fd8', px(18)));
      out.push(renderDimension({ a: { x, y: y + h }, b: { x, y } }, '#1d6fd8', px(18)));
      this.onStatus({ measure: `${formatLength(w)} × ${formatLength(h)} = ${formatArea(w * h)}` });
    }
    if (this.tool === 'dim' && this.chain.length) {
      out.push(renderDimension({ a: this.chain[0], b: c }, '#1d6fd8'));
    }
    const spec = OPENING_TOOLS[this.tool];
    if (spec) {
      const nw = this.nearestWall(this.rawCursor);
      if (nw) {
        const len = dist(nw.wall.a, nw.wall.b);
        const width = Math.min(spec.width, Math.max(300, len - 100));
        const t = this.openingT(nw.wall, nw.point, width);
        const cpos = { x: nw.wall.a.x + (nw.wall.b.x - nw.wall.a.x) * t, y: nw.wall.a.y + (nw.wall.b.y - nw.wall.a.y) * t };
        out.push(
          `<g class="ghost" transform="translate(${cpos.x} ${cpos.y}) rotate(${wallAngle(nw.wall)})">${renderOpening({ id: '', wallId: nw.wall.id, kind: spec.kind, t, width, flip: false, side: false }, nw.wall.thickness)}</g>`,
        );
      }
    }
    if (this.tool === 'furniture') {
      const def = furnitureDef(this.furnitureType);
      out.push(`<g class="ghost" transform="translate(${c.x} ${c.y})">${def.draw(def.w, def.d, def.color)}</g>`);
    }
    if (showCursor && this.tool !== 'furniture' && !spec) {
      out.push(`<circle class="${this.snapHit ? 'snap-hit' : 'snap-cursor'}" cx="${c.x}" cy="${c.y}" r="${px(this.snapHit ? 7 : 4)}"/>`);
    }
    this.overlayG.innerHTML = out.join('');
  }

  private el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>) {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }
}
