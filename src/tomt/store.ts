import type { Site } from './types';
import { uid } from '../geometry';
import { newArea, newBuilding, newLine, newPlant } from './catalog';

const STORAGE_KEY = 'tomtplaneraren.sites.v1';
const CURRENT_KEY = 'tomtplaneraren.current.v1';

export function emptySite(name = 'Ny tomt'): Site {
  return {
    id: uid('site'),
    name,
    plot: [
      { x: 0, y: 0 },
      { x: 25000, y: 0 },
      { x: 25000, y: 35000 },
      { x: 0, y: 35000 },
    ],
    buildings: [],
    areas: [],
    lines: [],
    plants: [],
    updatedAt: Date.now(),
  };
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const isPt = (p: any) => p && Number.isFinite(p.x) && Number.isFinite(p.y);

export function normalizeSite(raw: any): Site {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.buildings)) throw new Error('Filen är inte en tomt från Tomtplaneraren');
  const s = emptySite(typeof raw.name === 'string' ? raw.name : 'Importerad tomt');
  if (typeof raw.id === 'string') s.id = raw.id;
  s.plot = arr(raw.plot).filter(isPt).map((p) => ({ x: +p.x, y: +p.y }));
  s.buildings = arr(raw.buildings).map((b) => ({ ...newBuilding(BK.has(b?.kind) ? b.kind : 'house', 0, 0), ...b }));
  s.areas = arr(raw.areas).map((a) => ({ ...newArea(AK.has(a?.kind) ? a.kind : 'patio', 0, 0), ...a }));
  s.lines = arr(raw.lines)
    .map((l) => ({ ...newLine(LK.has(l?.kind) ? l.kind : 'fence', []), ...l, points: arr(l?.points).filter(isPt) }))
    .filter((l) => l.points.length >= 2);
  s.plants = arr(raw.plants).map((p) => ({ ...newPlant(PK.has(p?.kind) ? p.kind : 'tree', 0, 0), ...p }));
  s.plans = arr(raw.plans).filter((p) => p && typeof p.id === 'string' && Array.isArray(p.walls));
  s.updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now();
  return s;
}
const BK = new Set(['house', 'garage', 'shed', 'friggebod', 'attefall', 'carport']);
const AK = new Set(['deck', 'patio', 'pool', 'driveway', 'bed', 'lawn']);
const LK = new Set(['fence', 'hedge', 'path', 'wall']);
const PK = new Set(['tree', 'fruit', 'pine', 'bush']);

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export class SiteStore {
  sites: Site[];
  site: Site;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners = new Set<() => void>();
  private saveTimer: number | undefined;

  constructor() {
    this.sites = this.load();
    if (!this.sites.length) this.sites = [sampleSite()];
    const cur = safeGet(CURRENT_KEY);
    this.site = this.sites.find((s) => s.id === cur) ?? this.sites[0];
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
  }

  changed() {
    this.site.updatedAt = Date.now();
    this.listeners.forEach((l) => l());
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 300);
  }

  checkpoint() {
    this.undoBase(JSON.stringify(this.site));
  }
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
    this.redoStack.push(JSON.stringify(this.site));
    this.replace(JSON.parse(prev));
  }
  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(this.site));
    this.replace(JSON.parse(next));
  }
  private replace(s: Site) {
    const i = this.sites.findIndex((x) => x.id === this.site.id);
    this.site = s;
    if (i >= 0) this.sites[i] = s;
    this.changed();
  }

  switchTo(id: string) {
    const s = this.sites.find((x) => x.id === id);
    if (!s) return;
    this.site = s;
    this.undoStack = [];
    this.redoStack = [];
    safeSet(CURRENT_KEY, s.id);
    this.changed();
  }
  add(s: Site) {
    if (this.sites.some((x) => x.id === s.id)) s.id = uid('site');
    this.sites.push(s);
    this.switchTo(s.id);
  }
  newSite() {
    this.add(emptySite(`Tomt ${this.sites.length + 1}`));
  }
  duplicate() {
    const c = clone(this.site);
    c.id = uid('site');
    const base = c.name.replace(/ – variant \d+$/, '');
    let n = 2;
    while (this.sites.some((s) => s.name === `${base} – variant ${n}`)) n++;
    c.name = `${base} – variant ${n}`;
    // Varianten ska inte dela planritningar med originalet
    c.buildings.forEach((b) => delete b.planId);
    this.add(c);
  }
  deleteCurrent() {
    this.sites = this.sites.filter((s) => s !== this.site);
    if (!this.sites.length) this.sites.push(emptySite());
    this.switchTo(this.sites[0].id);
  }
  importSite(raw: unknown) {
    this.add(normalizeSite(raw));
  }

  private load(): Site[] {
    try {
      const raw = safeGet(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.map(normalizeSite) : [];
    } catch {
      return [];
    }
  }
  save() {
    safeSet(STORAGE_KEY, JSON.stringify(this.sites));
    safeSet(CURRENT_KEY, this.site.id);
  }
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* lagring otillgänglig */
  }
}

/** Exempeltomt på ca 900 m² med villa, garage, altan och trädgård. */
export function sampleSite(): Site {
  const s = emptySite('Exempel: villatomt 900 m²');
  s.plot = [
    { x: 0, y: 0 },
    { x: 26000, y: 0 },
    { x: 27000, y: 34000 },
    { x: 0, y: 34000 },
  ];
  const house = newBuilding('house', 11000, 14000, 13000, 8500);
  house.name = 'Villa';
  const garage = newBuilding('garage', 21000, 26500, 6000, 7000);
  const fb = newBuilding('friggebod', 4500, 4200, 4500, 3000);
  fb.name = 'Förråd/friggebod';
  s.buildings.push(house, garage, fb);
  const deck = newArea('deck', 11000, 9500, 9000, 3500);
  const drive = newArea('driveway', 21000, 31500, 4000, 3000);
  const patio = newArea('patio', 4500, 9000, 4000, 3500);
  const pool = newArea('pool', 19500, 8000, 7000, 3500);
  const bed = newArea('bed', 12000, 2400, 6000, 1200);
  s.areas.push(deck, drive, patio, pool, bed);
  s.lines.push(
    newLine('hedge', [
      { x: 400, y: 33600 },
      { x: 400, y: 400 },
      { x: 25600, y: 400 },
    ]),
    newLine('fence', [
      { x: 25600, y: 400 },
      { x: 26550, y: 33600 },
    ]),
    newLine('path', [
      { x: 11000, y: 18250 },
      { x: 11000, y: 24000 },
      { x: 19000, y: 30500 },
    ]),
  );
  s.plants.push(newPlant('tree', 3500, 26000), newPlant('fruit', 7500, 29500), newPlant('pine', 24000, 15000), newPlant('bush', 3000, 15000), newPlant('bush', 3000, 17000), newPlant('fruit', 14000, 30000));
  return s;
}
