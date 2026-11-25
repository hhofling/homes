/** Ritytan i Bildbiblioteket: bilder att kombinera och penna, pilar, former, text och "Ändra här"-markering. */
import { bbox, hit, moveItem, resizeBox, simplify, topHit, type Box, type Item, type Sketch } from './model';
import { newId } from './db';

export type Tool = 'select' | 'pen' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'mark' | 'erase';
type Corner = 'nw' | 'ne' | 'sw' | 'se';

export const MARK_COLOR = 'rgba(236, 64, 160, 0.42)';
const MARK_SOLID = '#ec40a0';

export const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: 'select', label: '↖ Flytta', key: 'v', hint: 'Klicka på något för att markera det. Dra för att flytta, dra i hörnen för att ändra storlek. Delete tar bort.' },
  { id: 'mark', label: '▒ Ändra här', key: 'm', hint: 'Måla över det område som AI ska ändra (rosa). Allt utanför försöker AI låta vara.' },
  { id: 'pen', label: '✎ Penna', key: 'p', hint: 'Skissa fritt – t.ex. konturen av en veranda, ett nytt fönster eller en altan.' },
  { id: 'arrow', label: '↗ Pil', key: 'a', hint: 'Dra en pil för att peka på något.' },
  { id: 'rect', label: '▭ Ruta', key: 'r', hint: 'Dra för att rita en rektangel.' },
  { id: 'ellipse', label: '◯ Ring', key: 'o', hint: 'Dra för att ringa in något.' },
  { id: 'text', label: 'T Text', key: 't', hint: 'Klicka där texten ska stå och skriv, t.ex. "veranda här" eller "svart plåttak".' },
  { id: 'erase', label: '⌫ Sudda', key: 'e', hint: 'Dra över streck, pilar, text eller bilder för att ta bort dem.' },
];

export interface EditorStatus {
  hint?: string;
  zoom?: string;
}

export class SketchEditor {
  sketch: Sketch = { width: 1600, height: 1000, background: '#ffffff', items: [] };
  images = new Map<string, HTMLImageElement>();
  tool: Tool = 'pen';
  color = '#e53935';
  /** Linjebredd: 1 = smal, 2 = mellan, 3 = tjock. */
  weight = 2;
  selectedId: string | null = null;

  onChange: () => void = () => {};
  onSelect: () => void = () => {};
  onStatus: (s: EditorStatus) => void = () => {};

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private fitMode = true;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private drag:
    | { type: 'draw'; item: Item }
    | { type: 'move'; id: string; sx: number; sy: number; orig: Item; moved: boolean }
    | { type: 'resize'; id: string; corner: Corner; sx: number; sy: number; orig: Item; box: Box }
    | { type: 'pan'; sx: number; sy: number; ox: number; oy: number }
    | { type: 'erase'; removed: boolean }
    | null = null;
  private space = false;
  private raf = 0;
  private textBox: HTMLTextAreaElement | null = null;

  constructor(private wrap: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sketch-canvas';
    wrap.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(wrap);
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', (e) => this.up(e));
    this.canvas.addEventListener('dblclick', (e) => this.dbl(e));
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = this.canvas.getBoundingClientRect();
        this.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false },
    );
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !isTyping(e)) this.space = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.space = false;
    });
  }

  // ---------- Läsa in / byta skiss ----------

  load(sketch: Sketch) {
    this.closeText(true);
    this.sketch = structuredClone(sketch);
    this.undoStack = [];
    this.redoStack = [];
    this.selectedId = null;
    this.fitMode = true;
    this.resize();
    this.onSelect();
  }

  /** Har skissen någon bakgrundsbild (ett foto som ska ändras)? */
  get base(): Extract<Item, { kind: 'image' }> | undefined {
    const first = this.sketch.items[0];
    return first?.kind === 'image' && first.locked ? first : undefined;
  }

  get hasDrawings() {
    return this.sketch.items.some((it) => it.kind !== 'image');
  }
  get hasMarks() {
    return this.sketch.items.some((it) => it.kind === 'mark');
  }

  get selected(): Item | undefined {
    return this.sketch.items.find((it) => it.id === this.selectedId);
  }

  // ---------- Ändringar ----------

  private snapshot() {
    return JSON.stringify(this.sketch.items);
  }
  checkpoint() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }
  private changed() {
    this.draw();
    this.onChange();
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  undo() {
    const s = this.undoStack.pop();
    if (s === undefined) return;
    this.redoStack.push(this.snapshot());
    this.sketch.items = JSON.parse(s);
    if (!this.selected) this.select(null);
    this.changed();
  }
  redo() {
    const s = this.redoStack.pop();
    if (s === undefined) return;
    this.undoStack.push(this.snapshot());
    this.sketch.items = JSON.parse(s);
    if (!this.selected) this.select(null);
    this.changed();
  }

  addItem(it: Item, select = true) {
    this.checkpoint();
    this.sketch.items.push(it);
    if (select) this.select(it.id);
    this.changed();
  }

  updateSelected(patch: Partial<Item>) {
    const i = this.sketch.items.findIndex((it) => it.id === this.selectedId);
    if (i < 0) return;
    this.checkpoint();
    this.sketch.items[i] = { ...this.sketch.items[i], ...patch } as Item;
    this.changed();
  }

  deleteSelected() {
    const it = this.selected;
    if (!it || (it.kind === 'image' && it.locked)) return;
    this.checkpoint();
    this.sketch.items = this.sketch.items.filter((x) => x.id !== it.id);
    this.select(null);
    this.changed();
  }

  /** Flytta markerat föremål framåt (+1) eller bakåt (−1). Bakgrundsbilden ligger alltid underst. */
  reorder(dir: 1 | -1) {
    const items = this.sketch.items;
    const i = items.findIndex((it) => it.id === this.selectedId);
    const j = i + dir;
    const min = this.base ? 1 : 0;
    if (i < 0 || j < min || j >= items.length) return;
    this.checkpoint();
    [items[i], items[j]] = [items[j], items[i]];
    this.changed();
  }

  clearDrawings(onlyMarks = false) {
    const keep = this.sketch.items.filter((it) => (onlyMarks ? it.kind !== 'mark' : it.kind === 'image'));
    if (keep.length === this.sketch.items.length) return;
    this.checkpoint();
    this.sketch.items = keep;
    if (!this.selected) this.select(null);
    this.changed();
  }

  select(id: string | null) {
    this.selectedId = id;
    this.draw();
    this.onSelect();
  }

  setTool(t: Tool) {
    this.closeText(true);
    this.tool = t;
    if (t !== 'select') this.select(null);
    this.canvas.dataset.tool = t;
    this.onStatus({ hint: TOOLS.find((x) => x.id === t)?.hint });
  }

  /** Linjebredd i bildpixlar för vald tjocklek. */
  lineWidth(kind: 'pen' | 'mark' = 'pen') {
    const long = Math.max(this.sketch.width, this.sketch.height);
    const f = kind === 'mark' ? [0, 0.025, 0.045, 0.08][this.weight] : [0, 0.0035, 0.007, 0.014][this.weight];
    return Math.max(2, Math.round(long * f));
  }
  textSize() {
    const long = Math.max(this.sketch.width, this.sketch.height);
    return Math.round(long * [0, 0.022, 0.034, 0.05][this.weight]);
  }

  // ---------- Vy ----------

  private resize() {
    const r = this.wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    if (this.fitMode) this.fit();
    else this.draw();
  }

  fit() {
    const r = this.wrap.getBoundingClientRect();
    const pad = 24;
    this.scale = Math.min((r.width - 2 * pad) / this.sketch.width, (r.height - 2 * pad) / this.sketch.height);
    if (!(this.scale > 0)) this.scale = 0.1;
    this.ox = (r.width - this.sketch.width * this.scale) / 2;
    this.oy = (r.height - this.sketch.height * this.scale) / 2;
    this.fitMode = true;
    this.draw();
  }

  zoomAt(f: number, sx?: number, sy?: number) {
    const r = this.wrap.getBoundingClientRect();
    sx ??= r.width / 2;
    sy ??= r.height / 2;
    const ns = Math.min(20, Math.max(0.02, this.scale * f));
    this.ox = sx - ((sx - this.ox) * ns) / this.scale;
    this.oy = sy - ((sy - this.oy) * ns) / this.scale;
    this.scale = ns;
    this.fitMode = false;
    this.draw();
  }

  private toWorld(e: { clientX: number; clientY: number }) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - this.ox) / this.scale, y: (e.clientY - r.top - this.oy) / this.scale };
  }

  // ---------- Mus / finger ----------

  private handleAt(x: number, y: number): Corner | null {
    const it = this.selected;
    if (!it || !['image', 'rect', 'ellipse', 'text'].includes(it.kind) || (it.kind === 'image' && it.locked)) return null;
    const b = bbox(it);
    const tol = 9 / this.scale;
    const corners: [Corner, number, number][] = [
      ['nw', b.x, b.y],
      ['ne', b.x + b.w, b.y],
      ['sw', b.x, b.y + b.h],
      ['se', b.x + b.w, b.y + b.h],
    ];
    for (const [c, cx, cy] of corners) if (Math.abs(x - cx) <= tol && Math.abs(y - cy) <= tol) return c;
    return null;
  }

  private down(e: PointerEvent) {
    if (this.textBox) {
      this.closeText(true);
      if (this.tool === 'text') return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || this.space) {
      this.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: this.ox, oy: this.oy };
      return;
    }
    const p = this.toWorld(e);
    const tol = 8 / this.scale;
    switch (this.tool) {
      case 'select': {
        const corner = this.handleAt(p.x, p.y);
        if (corner) {
          const it = this.selected!;
          this.checkpoint();
          this.drag = { type: 'resize', id: it.id, corner, sx: p.x, sy: p.y, orig: structuredClone(it), box: bbox(it) };
          return;
        }
        const it = topHit(this.sketch.items, p.x, p.y, tol);
        this.select(it?.id ?? null);
        if (it) {
          this.checkpoint();
          this.drag = { type: 'move', id: it.id, sx: p.x, sy: p.y, orig: structuredClone(it), moved: false };
        } else this.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: this.ox, oy: this.oy };
        return;
      }
      case 'erase':
        this.checkpoint();
        this.drag = { type: 'erase', removed: false };
        this.eraseAt(p.x, p.y);
        return;
      case 'text':
        this.openText(p.x, p.y);
        return;
      case 'pen':
        this.drag = { type: 'draw', item: { kind: 'pen', id: newId(), points: [p.x, p.y], color: this.color, width: this.lineWidth() } };
        break;
      case 'mark':
        this.drag = { type: 'draw', item: { kind: 'mark', id: newId(), points: [p.x, p.y], width: this.lineWidth('mark') } };
        break;
      case 'arrow':
        this.drag = { type: 'draw', item: { kind: 'arrow', id: newId(), x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: this.color, width: this.lineWidth() } };
        break;
      case 'rect':
      case 'ellipse':
        this.drag = { type: 'draw', item: { kind: this.tool, id: newId(), x: p.x, y: p.y, w: 0, h: 0, color: this.color, width: this.lineWidth() } };
        break;
    }
    this.draw();
  }

  private move(e: PointerEvent) {
    const d = this.drag;
    const p = this.toWorld(e);
    if (!d) {
      if (this.tool === 'select') {
        const c = this.handleAt(p.x, p.y);
        this.canvas.style.cursor = c ? (c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize') : topHit(this.sketch.items, p.x, p.y, 8 / this.scale) ? 'move' : 'default';
      } else this.canvas.style.cursor = '';
      return;
    }
    if (d.type === 'pan') {
      this.ox = d.ox + e.clientX - d.sx;
      this.oy = d.oy + e.clientY - d.sy;
      this.fitMode = false;
      this.draw();
      return;
    }
    if (d.type === 'erase') {
      this.eraseAt(p.x, p.y);
      return;
    }
    if (d.type === 'move') {
      const i = this.sketch.items.findIndex((it) => it.id === d.id);
      if (i >= 0) {
        this.sketch.items[i] = moveItem(d.orig, p.x - d.sx, p.y - d.sy);
        d.moved = true;
        this.draw();
      }
      return;
    }
    if (d.type === 'resize') {
      const i = this.sketch.items.findIndex((it) => it.id === d.id);
      if (i < 0) return;
      const o = d.orig;
      const nb = resizeBox(d.box, d.corner, p.x - d.sx, p.y - d.sy, o.kind === 'image' || o.kind === 'text');
      if (o.kind === 'text') this.sketch.items[i] = { ...o, x: nb.x, y: nb.y, size: Math.max(6, (o.size * nb.h) / d.box.h) };
      else this.sketch.items[i] = { ...o, ...nb } as Item;
      this.draw();
      return;
    }
    const it = d.item;
    if (it.kind === 'pen' || it.kind === 'mark') {
      const events = (e as any).getCoalescedEvents?.() ?? [e];
      for (const ev of events) {
        const q = this.toWorld(ev);
        it.points.push(q.x, q.y);
      }
    } else if (it.kind === 'arrow') {
      it.x2 = p.x;
      it.y2 = p.y;
    } else if (it.kind === 'rect' || it.kind === 'ellipse') {
      it.w = p.x - it.x;
      it.h = p.y - it.y;
      if (e.shiftKey) {
        const s = Math.max(Math.abs(it.w), Math.abs(it.h));
        it.w = Math.sign(it.w || 1) * s;
        it.h = Math.sign(it.h || 1) * s;
      }
    }
    this.scheduleDraw();
  }

  private up(e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.type === 'move') {
      if (!d.moved) this.undoStack.pop();
      else this.onChange();
      return;
    }
    if (d.type === 'resize') {
      this.onChange();
      return;
    }
    if (d.type === 'erase') {
      if (!d.removed) this.undoStack.pop();
      return;
    }
    if (d.type !== 'draw') return;
    let it = d.item;
    if (it.kind === 'pen' || it.kind === 'mark') it = { ...it, points: simplify(it.points, 1.5 / this.scale) };
    if ((it.kind === 'rect' || it.kind === 'ellipse') && (Math.abs(it.w) < 3 || Math.abs(it.h) < 3)) return this.draw();
    if (it.kind === 'arrow' && Math.hypot(it.x2 - it.x1, it.y2 - it.y1) < 4) return this.draw();
    if (it.kind === 'rect' || it.kind === 'ellipse') it = { ...it, ...bbox(it) };
    this.addItem(it, false);
  }

  private dbl(e: MouseEvent) {
    const p = this.toWorld(e);
    const it = topHit(this.sketch.items, p.x, p.y, 8 / this.scale);
    if (it?.kind === 'text') {
      this.select(it.id);
      this.openText(it.x, it.y, it);
    }
  }

  private eraseAt(x: number, y: number) {
    const tol = Math.max(8 / this.scale, this.lineWidth() / 2);
    const before = this.sketch.items.length;
    this.sketch.items = this.sketch.items.filter((it) => (it.kind === 'image' && it.locked) || !hit(it, x, y, tol));
    if (this.sketch.items.length !== before && this.drag?.type === 'erase') {
      this.drag.removed = true;
      if (!this.selected) this.selectedId = null;
      this.changed();
    }
  }

  // ---------- Text ----------

  private openText(x: number, y: number, existing?: Extract<Item, { kind: 'text' }>) {
    this.closeText(true);
    const ta = document.createElement('textarea');
    ta.className = 'sketch-text';
    ta.value = existing?.text ?? '';
    ta.placeholder = 'Skriv här…';
    const size = existing?.size ?? this.textSize();
    const color = existing?.color ?? this.color;
    ta.style.left = `${x * this.scale + this.ox}px`;
    ta.style.top = `${y * this.scale + this.oy}px`;
    ta.style.fontSize = `${Math.max(12, size * this.scale)}px`;
    ta.style.color = color;
    ta.rows = Math.max(1, ta.value.split('\n').length);
    this.wrap.appendChild(ta);
    ta.dataset.x = String(x);
    ta.dataset.y = String(y);
    if (existing) ta.dataset.id = existing.id;
    ta.dataset.size = String(size);
    ta.dataset.color = color;
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.closeText(false);
      else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.closeText(true);
      }
    });
    ta.addEventListener('input', () => (ta.rows = Math.max(1, ta.value.split('\n').length)));
    this.textBox = ta;
    setTimeout(() => ta.focus(), 0);
  }

  private closeText(save: boolean) {
    const ta = this.textBox;
    if (!ta) return;
    this.textBox = null;
    ta.remove();
    const text = ta.value.trim();
    const id = ta.dataset.id;
    if (!save) return;
    if (id) {
      const i = this.sketch.items.findIndex((it) => it.id === id);
      if (i < 0) return;
      this.checkpoint();
      if (!text) this.sketch.items.splice(i, 1);
      else this.sketch.items[i] = { ...(this.sketch.items[i] as any), text };
      this.changed();
    } else if (text) {
      this.addItem({ kind: 'text', id: newId(), x: Number(ta.dataset.x), y: Number(ta.dataset.y), text, color: ta.dataset.color!, size: Number(ta.dataset.size) }, false);
    }
  }

  // ---------- Rita ----------

  private scheduleDraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  draw() {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, dpr * this.ox, dpr * this.oy);
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = this.sketch.background;
    ctx.fillRect(0, 0, this.sketch.width, this.sketch.height);
    ctx.shadowColor = 'transparent';
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.sketch.width, this.sketch.height);
    ctx.clip();
    const items = this.drag?.type === 'draw' ? [...this.sketch.items, this.drag.item] : this.sketch.items;
    paintItems(ctx, items, this.images, 'all', this.sketch.width, this.sketch.height);
    ctx.restore();
    // Markering
    const sel = this.selected;
    if (sel) {
      const b = bbox(sel);
      const lw = 1.5 / this.scale;
      ctx.lineWidth = lw;
      ctx.setLineDash([6 / this.scale, 4 / this.scale]);
      ctx.strokeStyle = '#1d6fd8';
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.setLineDash([]);
      if (['image', 'rect', 'ellipse', 'text'].includes(sel.kind) && !(sel.kind === 'image' && sel.locked)) {
        const s = 7 / this.scale;
        ctx.fillStyle = '#ffffff';
        for (const [cx, cy] of [
          [b.x, b.y],
          [b.x + b.w, b.y],
          [b.x, b.y + b.h],
          [b.x + b.w, b.y + b.h],
        ]) {
          ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
          ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
        }
      }
    }
    this.onStatus({ zoom: `${Math.round(this.scale * 100)} %` });
  }

  /**
   * Gör en bild av skissen. `clean` = bara bilderna (utan streck), `all` = allt,
   * `mask` = mask för AI (genomskinlig där man markerat "Ändra här").
   */
  render(mode: 'clean' | 'all' | 'mask', maxSide = 1536): HTMLCanvasElement {
    const { width, height } = this.sketch;
    const s = Math.min(1, maxSide / Math.max(width, height));
    const c = document.createElement('canvas');
    c.width = Math.round(width * s);
    c.height = Math.round(height * s);
    const ctx = c.getContext('2d')!;
    ctx.scale(s, s);
    if (mode === 'mask') {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'destination-out';
      for (const it of this.sketch.items) if (it.kind === 'mark') strokePoints(ctx, it.points, it.width, '#000');
      return c;
    }
    ctx.fillStyle = this.sketch.background;
    ctx.fillRect(0, 0, width, height);
    paintItems(ctx, this.sketch.items, this.images, mode, width, height);
    return c;
  }
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return !!t?.closest?.('input, textarea, select, [contenteditable]');
}

function strokePoints(ctx: CanvasRenderingContext2D, p: number[], width: number, color: string) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (p.length === 2) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i + 3 < p.length; i += 2) {
    const mx = (p[i] + p[i + 2]) / 2;
    const my = (p[i + 1] + p[i + 3]) / 2;
    ctx.quadraticCurveTo(p[i], p[i + 1], mx, my);
  }
  ctx.lineTo(p[p.length - 2], p[p.length - 1]);
  ctx.stroke();
}

export function paintItems(
  ctx: CanvasRenderingContext2D,
  items: Item[],
  images: Map<string, HTMLImageElement>,
  mode: 'clean' | 'all',
  width: number,
  height: number,
) {
  // Markeringarna ritas först på en egen yta och läggs sedan på genomskinligt, så att överlapp blir jämnt
  let marks: HTMLCanvasElement | null = null;
  const flushMarks = () => {
    if (!marks) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.42;
    ctx.drawImage(marks, 0, 0);
    ctx.restore();
    marks = null;
  };
  const t = ctx.getTransform();
  for (const it of items) {
    if (mode === 'clean' && it.kind !== 'image') continue;
    if (it.kind !== 'mark') flushMarks();
    switch (it.kind) {
      case 'image': {
        const img = images.get(it.src);
        ctx.globalAlpha = it.opacity ?? 1;
        if (img) ctx.drawImage(img, it.x, it.y, it.w, it.h);
        else {
          ctx.fillStyle = '#d8dde4';
          ctx.fillRect(it.x, it.y, it.w, it.h);
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'mark': {
        if (!marks) {
          marks = document.createElement('canvas');
          marks.width = ctx.canvas.width;
          marks.height = ctx.canvas.height;
        }
        const m = marks.getContext('2d')!;
        m.setTransform(t);
        strokePoints(m, it.points, it.width, MARK_SOLID);
        break;
      }
      case 'pen':
        strokePoints(ctx, it.points, it.width, it.color);
        break;
      case 'arrow': {
        const ang = Math.atan2(it.y2 - it.y1, it.x2 - it.x1);
        const head = Math.max(it.width * 4, 12);
        ctx.strokeStyle = it.color;
        ctx.fillStyle = it.color;
        ctx.lineWidth = it.width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(it.x1, it.y1);
        ctx.lineTo(it.x2 - Math.cos(ang) * head * 0.6, it.y2 - Math.sin(ang) * head * 0.6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(it.x2, it.y2);
        ctx.lineTo(it.x2 - head * Math.cos(ang - 0.45), it.y2 - head * Math.sin(ang - 0.45));
        ctx.lineTo(it.x2 - head * Math.cos(ang + 0.45), it.y2 - head * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'rect':
      case 'ellipse': {
        const b = bbox(it);
        ctx.strokeStyle = it.color;
        ctx.lineWidth = it.width;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        if (it.kind === 'rect') ctx.rect(b.x, b.y, b.w, b.h);
        else ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'text': {
        ctx.font = `600 ${it.size}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
        ctx.textBaseline = 'top';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(2, it.size * 0.18);
        ctx.strokeStyle = isLight(it.color) ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.9)';
        ctx.fillStyle = it.color;
        it.text.split('\n').forEach((line, i) => {
          ctx.strokeText(line, it.x, it.y + i * it.size * 1.2);
          ctx.fillText(line, it.x, it.y + i * it.size * 1.2);
        });
        break;
      }
    }
  }
  flushMarks();
  void width;
  void height;
}

function isLight(hex: string) {
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 160;
}
