import type { Plan, Vec, Wall, Room, Item, Opening, Label } from './types';
import { uid } from './geometry';
import { furnitureDef } from './furniture';

const STORAGE_KEY = 'planritaren.plans.v1';
const CURRENT_KEY = 'planritaren.current.v1';

export function emptyPlan(name = 'Ny plan'): Plan {
  return { id: uid('plan'), name, walls: [], openings: [], rooms: [], items: [], labels: [], dims: [], updatedAt: Date.now() };
}

/** Säkerställer att en inläst plan har alla fält (för äldre/ofullständiga filer). */
export function normalizePlan(raw: any): Plan {
  if (!raw || typeof raw !== 'object') throw new Error('Ogiltig planfil');
  const p = emptyPlan(typeof raw.name === 'string' ? raw.name : 'Importerad plan');
  if (typeof raw.id === 'string') p.id = raw.id;
  for (const key of ['walls', 'openings', 'rooms', 'items', 'labels', 'dims'] as const) {
    if (Array.isArray(raw[key])) (p as any)[key] = raw[key];
  }
  const bg = raw.background;
  if (bg && typeof bg.src === 'string' && [bg.x, bg.y, bg.w, bg.h].every((v) => typeof v === 'number' && isFinite(v))) {
    p.background = {
      src: bg.src,
      x: bg.x,
      y: bg.y,
      w: bg.w,
      h: bg.h,
      opacity: typeof bg.opacity === 'number' ? Math.min(1, Math.max(0, bg.opacity)) : 0.5,
      visible: bg.visible !== false,
    };
  }
  p.updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now();
  return p;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// Bakgrundsbilder är stora. I ångra-historiken sparas de bara en gång och refereras med en kort nyckel.
const imageRefs = new Map<string, string>();
const refFor = (src: string) => {
  const key = `img:${src.length}:${src.slice(-24)}`;
  imageRefs.set(key, src);
  return key;
};
/** Planen som text, med bakgrundsbilden ersatt av en referens (för ångra och drag). */
export const snapshotPlan = (p: Plan) =>
  JSON.stringify(p, (k, v) => (k === 'src' && typeof v === 'string' && v.startsWith('data:') ? refFor(v) : v));
export const restorePlan = (s: string): Plan =>
  JSON.parse(s, (k, v) => (k === 'src' && typeof v === 'string' && v.startsWith('img:') ? (imageRefs.get(v) ?? '') : v));

type Listener = () => void;

export class Store {
  plans: Plan[] = [];
  plan: Plan;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners = new Set<Listener>();
  private saveTimer: number | undefined;

  constructor() {
    this.plans = this.load();
    if (!this.plans.length) this.plans = [samplePlan()];
    const currentId = safeGet(CURRENT_KEY);
    this.plan = this.plans.find((p) => p.id === currentId) ?? this.plans[0];
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Meddela lyssnare och spara (debounce). */
  changed() {
    this.plan.updatedAt = Date.now();
    this.listeners.forEach((l) => l());
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 300);
  }

  /** Spara nuvarande läge i ångra-historiken. Anropas innan en ändring. */
  checkpoint() {
    this.undoStack.push(snapshotPlan(this.plan));
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Som checkpoint, men med ett redan sparat läge (t.ex. före ett drag). */
  undoBase(snapshot: string) {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(snapshotPlan(this.plan));
    this.replaceCurrent(restorePlan(prev));
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(snapshotPlan(this.plan));
    this.replaceCurrent(restorePlan(next));
  }

  private replaceCurrent(p: Plan) {
    const idx = this.plans.findIndex((x) => x.id === this.plan.id);
    this.plan = p;
    if (idx >= 0) this.plans[idx] = p;
    this.changed();
  }

  // ----- Planer / designlösningar -----

  switchTo(id: string) {
    const p = this.plans.find((x) => x.id === id);
    if (!p || p === this.plan) return;
    this.plan = p;
    this.undoStack = [];
    this.redoStack = [];
    safeSet(CURRENT_KEY, p.id);
    this.changed();
  }

  addPlan(p: Plan) {
    this.plans.push(p);
    this.switchTo(p.id);
  }

  newPlan() {
    this.addPlan(emptyPlan(`Plan ${this.plans.length + 1}`));
  }

  /** Skapa en variant (kopia) av nuvarande plan för att prova en annan lösning. */
  duplicatePlan() {
    const copy = clone(this.plan);
    copy.id = uid('plan');
    copy.name = nextVariantName(this.plan.name, this.plans.map((p) => p.name));
    this.addPlan(copy);
  }

  deletePlan(id: string) {
    this.plans = this.plans.filter((p) => p.id !== id);
    if (!this.plans.length) this.plans.push(emptyPlan());
    if (this.plan.id === id) {
      this.plan = this.plans[0];
      this.undoStack = [];
      this.redoStack = [];
    }
    this.changed();
  }

  importPlan(raw: unknown) {
    const p = normalizePlan(raw);
    if (this.plans.some((x) => x.id === p.id)) p.id = uid('plan');
    this.addPlan(p);
  }

  private load(): Plan[] {
    try {
      const raw = safeGet(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.map(normalizePlan) : [];
    } catch {
      return [];
    }
  }

  save() {
    // Om bakgrundsbilderna inte får plats sparas planerna utan dem (ritningen är viktigast)
    if (!safeSet(STORAGE_KEY, JSON.stringify(this.plans))) {
      safeSet(STORAGE_KEY, JSON.stringify(this.plans.map((p) => ({ ...p, background: undefined }))));
    }
    safeSet(CURRENT_KEY, this.plan.id);
  }
}

export function nextVariantName(name: string, existing: string[]): string {
  const baseName = name.replace(/ – variant \d+$/, '');
  let n = 2;
  while (existing.includes(`${baseName} – variant ${n}`)) n++;
  return `${baseName} – variant ${n}`;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    /* lagring otillgänglig eller full – fortsätt utan */
    return false;
  }
}

// ----- Exempelplan: en tvåa på ca 58 m² -----

function samplePlan(): Plan {
  const p = emptyPlan('Exempel: tvåa 58 m²');
  const T = 150;
  const t = 100;
  const wall = (a: Vec, b: Vec, thickness = T): Wall => {
    const w = { id: uid('w'), a, b, thickness };
    p.walls.push(w);
    return w;
  };
  const room = (name: string, color: string, pts: [number, number][]): Room => {
    const r = { id: uid('r'), name, color, points: pts.map(([x, y]) => ({ x, y })) };
    p.rooms.push(r);
    return r;
  };
  const open = (w: Wall, kind: Opening['kind'], tt: number, width: number, flip = false, side = false) =>
    p.openings.push({ id: uid('o'), wallId: w.id, kind, t: tt, width, flip, side });
  const item = (type: string, x: number, y: number, rotation = 0, extra: Partial<Item> = {}) => {
    const def = furnitureDef(type);
    p.items.push({ id: uid('i'), type, x, y, w: def.w, d: def.d, rotation, color: def.color, ...extra });
  };
  const label = (text: string, x: number, y: number, size = 220): Label => {
    const l = { id: uid('l'), text, x, y, size };
    p.labels.push(l);
    return l;
  };

  // Ytterväggar 9 x 6,5 m
  const top = wall({ x: 0, y: 0 }, { x: 9000, y: 0 });
  const right = wall({ x: 9000, y: 0 }, { x: 9000, y: 6500 });
  const bottom = wall({ x: 9000, y: 6500 }, { x: 0, y: 6500 });
  const left = wall({ x: 0, y: 6500 }, { x: 0, y: 0 });
  // Innerväggar
  wall({ x: 5200, y: 0 }, { x: 5200, y: 3800 }, t);
  const hallWall = wall({ x: 5200, y: 3800 }, { x: 9000, y: 3800 }, t);
  const bathWall = wall({ x: 7000, y: 3800 }, { x: 7000, y: 6500 }, t);

  room('Vardagsrum & kök', '#f6efe3', [[0, 0], [5200, 0], [5200, 6500], [0, 6500]]);
  room('Sovrum', '#e8eef7', [[5200, 0], [9000, 0], [9000, 3800], [5200, 3800]]);
  room('Hall', '#efeeea', [[5200, 3800], [7000, 3800], [7000, 6500], [5200, 6500]]);
  room('Badrum', '#e3f0f2', [[7000, 3800], [9000, 3800], [9000, 6500], [7000, 6500]]);

  const hallOpen = wall({ x: 5200, y: 3800 }, { x: 5200, y: 6500 }, t);
  open(bottom, 'door', 1 - 6100 / 9000, 1000);
  open(hallWall, 'door', 700 / 3800, 900, false, true);
  open(bathWall, 'door', 0.25, 800, false, true);
  open(hallOpen, 'opening', 0.5, 1200);
  open(top, 'window', 1500 / 9000, 1400);
  open(top, 'window', 3800 / 9000, 1400);
  open(top, 'window', 7100 / 9000, 1200);
  open(left, 'window', 1 - 4300 / 6500, 1200);
  open(right, 'window', 1900 / 6500, 1000);

  // Kök längs vänster nedre del
  for (let i = 0; i < 5; i++) {
    const types = ['fridge', 'counter', 'kitchen-sink', 'dishwasher', 'stove'];
    const type = types[i];
    const def = furnitureDef(type);
    const y = 6500 - T / 2 - def.d / 2;
    const x = T / 2 + 300 + i * 680 + def.w / 2;
    item(type, x, y, 180);
  }
  item('dining-table', 2000, 4300, 0, { w: 1400, d: 800 });
  item('chair', 1600, 3700, 0);
  item('chair', 2400, 3700, 0);
  item('chair', 1600, 4900, 180);
  item('chair', 2400, 4900, 180);

  item('sofa-3', 2400, 525, 0);
  item('coffee-table', 2400, 1650);
  item('rug', 2400, 1500, 90, { w: 1700, d: 2400 });
  item('tv-bench', 2400, 2800, 180);
  item('armchair', 600, 1700, 270);
  item('plant', 4700, 500);

  item('bed-double', 7100, 1075);
  item('nightstand', 6000, 275);
  item('nightstand', 8200, 275);
  item('wardrobe', 8625, 2900, 90, { w: 1200 });
  item('desk', 5550, 2300, 270, { w: 1200, d: 600 });

  item('toilet', 8600, 5100, 90);
  item('basin', 8700, 4300, 90);
  item('shower', 7500, 5975, 0);
  item('washer', 8500, 6125, 180);

  // Mattor ska ligga under övriga möbler
  p.items.sort((a, b) => (a.type === 'rug' ? -1 : b.type === 'rug' ? 1 : 0));
  label('Exempelplan – ändra fritt!', 4500, -700, 260);
  p.dims.push({ id: uid('d'), a: { x: -75, y: 7300 }, b: { x: 9075, y: 7300 } });
  return p;
}
