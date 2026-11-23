import { uid, polygonArea, dist } from '../geometry';
import { num, PHASES } from './calc';
import { applyTemplate, CHECKLIST_TEMPLATES, newChecklist, newMaterial, newTask, TEMPLATES } from './templates';
import type { Checklist, Material, Project, ProjectRoom, Task } from './types';

const STORAGE_KEY = 'byggplaneraren.projects.v1';
const CURRENT_KEY = 'byggplaneraren.current.v1';
/** Planritarens lagring – läses för att kunna hämta rum därifrån. */
const PLANRITAREN_KEY = 'planritaren.plans.v1';

export function emptyProject(name = 'Nytt projekt'): Project {
  return {
    id: uid('proj'),
    name,
    address: '',
    startDate: '',
    contact: { name: '', phone: '', email: '' },
    notes: '',
    rotPct: 30,
    hoursPerDay: 8,
    rooms: [],
    tasks: [],
    materials: [],
    checklists: [],
    updatedAt: Date.now(),
  };
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** Säkerställer att ett inläst projekt har alla fält (för äldre/ofullständiga filer). */
export function normalizeProject(raw: any): Project {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tasks)) throw new Error('Filen är inte ett byggprojekt');
  const p = emptyProject(str(raw.name, 'Importerat projekt'));
  if (typeof raw.id === 'string') p.id = raw.id;
  p.address = str(raw.address);
  p.startDate = str(raw.startDate);
  p.notes = str(raw.notes);
  p.contact = { name: str(raw.contact?.name), phone: str(raw.contact?.phone), email: str(raw.contact?.email) };
  p.rotPct = num(raw.rotPct, 30);
  p.hoursPerDay = num(raw.hoursPerDay, 8) || 8;
  p.rooms = arr(raw.rooms).map(
    (r): ProjectRoom => ({ id: str(r?.id) || uid('room'), name: str(r?.name, 'Rum'), area: num(r?.area), perimeter: num(r?.perimeter), height: num(r?.height, 2.4) }),
  );
  p.tasks = arr(raw.tasks).map((t): Task => {
    const base = newTask();
    return {
      ...base,
      id: str(t?.id) || base.id,
      name: str(t?.name, base.name),
      phase: str(t?.phase, base.phase),
      trade: str(t?.trade, base.trade),
      who: t?.who === 'contractor' ? 'contractor' : 'self',
      hours: num(t?.hours),
      people: num(t?.people, 1) || 1,
      laborCost: num(t?.laborCost),
      status: t?.status === 'done' || t?.status === 'doing' ? t.status : 'todo',
      description: str(t?.description),
      roomIds: arr(t?.roomIds).filter((x) => typeof x === 'string'),
    };
  });
  p.materials = arr(raw.materials).map((m): Material => {
    const base = newMaterial();
    return {
      ...base,
      id: str(m?.id) || base.id,
      taskId: typeof m?.taskId === 'string' ? m.taskId : null,
      name: str(m?.name, base.name),
      qty: num(m?.qty),
      unit: str(m?.unit, 'st'),
      price: num(m?.price),
      waste: num(m?.waste),
      category: str(m?.category, 'Övrigt'),
      store: str(m?.store),
      buyer: m?.buyer === 'contractor' ? 'contractor' : 'self',
      bought: !!m?.bought,
      note: str(m?.note),
    };
  });
  p.checklists = arr(raw.checklists).map(
    (c): Checklist => ({
      id: str(c?.id) || uid('c'),
      title: str(c?.title, 'Checklista'),
      items: arr(c?.items).map((i) => ({ id: str(i?.id) || uid('ci'), text: str(i?.text), done: !!i?.done })),
    }),
  );
  p.updatedAt = num(raw.updatedAt, Date.now());
  return p;
}

type Listener = () => void;

export class ProjectStore {
  projects: Project[];
  project: Project;
  private listeners = new Set<Listener>();
  private saveTimer: number | undefined;

  constructor() {
    this.projects = this.load();
    if (!this.projects.length) this.projects = [sampleProject()];
    const currentId = safeGet(CURRENT_KEY);
    this.project = this.projects.find((p) => p.id === currentId) ?? this.projects[0];
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
  }

  /** Spara (med fördröjning). `notify` ritar om vyn. */
  changed(notify = true) {
    this.project.updatedAt = Date.now();
    if (notify) this.listeners.forEach((l) => l());
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 300);
  }

  switchTo(id: string) {
    const p = this.projects.find((x) => x.id === id);
    if (!p) return;
    this.project = p;
    safeSet(CURRENT_KEY, p.id);
    this.changed();
  }

  add(p: Project) {
    if (this.projects.some((x) => x.id === p.id)) p.id = uid('proj');
    this.projects.push(p);
    this.switchTo(p.id);
  }

  newProject() {
    this.add(emptyProject(`Projekt ${this.projects.length + 1}`));
  }

  deleteCurrent() {
    this.projects = this.projects.filter((p) => p !== this.project);
    if (!this.projects.length) this.projects.push(emptyProject());
    this.switchTo(this.projects[0].id);
  }

  importProject(raw: unknown) {
    this.add(normalizeProject(raw));
  }

  private load(): Project[] {
    try {
      const raw = safeGet(STORAGE_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list.map(normalizeProject) : [];
    } catch {
      return [];
    }
  }

  save() {
    safeSet(STORAGE_KEY, JSON.stringify(this.projects));
    safeSet(CURRENT_KEY, this.project.id);
  }
}

// ----- Rum från Planritaren -----

export interface PlanRooms {
  planName: string;
  rooms: { name: string; area: number; perimeter: number }[];
}

/** Räknar ut rummens area och omkrets från en planfil från Planritaren (mått i mm). */
export function roomsFromPlan(raw: any): PlanRooms {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.rooms)) throw new Error('Filen är inte en plan från Planritaren');
  const rooms = raw.rooms
    .filter((r: any) => Array.isArray(r?.points) && r.points.length >= 3)
    .map((r: any) => {
      const pts = r.points.map((p: any) => ({ x: num(p?.x), y: num(p?.y) }));
      let per = 0;
      for (let i = 0; i < pts.length; i++) per += dist(pts[i], pts[(i + 1) % pts.length]);
      return {
        name: str(r.name, 'Rum') || 'Rum',
        area: Math.round((polygonArea(pts) / 1e6) * 10) / 10,
        perimeter: Math.round((per / 1000) * 10) / 10,
      };
    });
  return { planName: str(raw.name, 'Plan'), rooms };
}

/** Planer som sparats i Planritaren i samma webbläsare (fungerar när båda sidorna ligger på samma webbplats). */
export function planritarenPlans(): PlanRooms[] {
  try {
    const raw = safeGet(PLANRITAREN_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    const out: PlanRooms[] = [];
    for (const p of list) {
      try {
        const pr = roomsFromPlan(p);
        if (pr.rooms.length) out.push(pr);
      } catch {
        /* hoppa över trasiga planer */
      }
    }
    return out;
  } catch {
    return [];
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
    /* lagring otillgänglig – fortsätt utan */
  }
}

// ----- Exempelprojekt -----

export function sampleProject(): Project {
  const p = emptyProject('Exempel: nytt badrum och målning');
  const d = new Date();
  d.setDate(d.getDate() + 30);
  p.startDate = d.toISOString().slice(0, 10);
  p.notes = 'Det här är ett exempel. Ändra fritt, eller skapa ett nytt projekt uppe till vänster.';
  const bath: ProjectRoom = { id: uid('room'), name: 'Badrum', area: 5.4, perimeter: 9.4, height: 2.4 };
  const bed: ProjectRoom = { id: uid('room'), name: 'Sovrum', area: 14.4, perimeter: 15.2, height: 2.5 };
  p.rooms.push(bath, bed);
  for (const [tplId, room] of [
    ['bath', bath],
    ['paint', bed],
  ] as const) {
    const tpl = TEMPLATES.find((t) => t.id === tplId)!;
    const { tasks, materials } = applyTemplate(tpl, room, room);
    p.tasks.push(...tasks);
    p.materials.push(...materials);
  }
  p.tasks.unshift(
    newTask({ name: 'Begära offerter och välja hantverkare', phase: PHASES[0], trade: 'Övrigt', who: 'self', hours: 6 }),
  );
  p.tasks.push(newTask({ name: 'Slutstädning och besiktning', phase: PHASES[8], trade: 'Övrigt', who: 'self', hours: 4 }));
  p.checklists = CHECKLIST_TEMPLATES.slice(0, 2).map((c) => newChecklist(c.title, c.items));
  return p;
}
