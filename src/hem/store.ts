import { uid } from '../geometry';
import { generateSteps, kindOf, roughEstimate } from './kinds';
import type { HomeProject, HomeStatus, Idea, Links, Step, Wish, Cost } from './types';

const STORAGE_KEY = 'hemprojekt.projects.v1';
const CURRENT_KEY = 'hemprojekt.current.v1';

export function emptyHomeProject(kind = 'other', name = ''): HomeProject {
  const k = kindOf(kind);
  const now = Date.now();
  return {
    id: uid('hem'),
    name: name || k.label,
    kind: k.id,
    status: 'idea',
    goal: '',
    place: '',
    size: { ...k.size },
    who: 'mix',
    budget: 0,
    deadline: '',
    priority: 2,
    wishes: [],
    ideas: [],
    steps: [],
    costs: [],
    links: { plans: [], sites: [], builds: [], images: [] },
    notes: '',
    createdAt: now,
    updatedAt: now,
  };
}

/** Ett nytt projekt med en färdig plan utifrån svaren i guiden. */
export function planProject(input: Partial<HomeProject> & { kind: string }): HomeProject {
  const p = { ...emptyHomeProject(input.kind, input.name), ...input } as HomeProject;
  p.id = uid('hem');
  p.status = 'planning';
  p.steps = generateSteps(p);
  // Det man redan svarat i guiden räknas som gjort
  const first = p.steps.find((s) => s.action === 'ideas');
  if (first && p.goal.trim() && p.wishes.length) first.done = true;
  const est = roughEstimate(p);
  if (est) p.costs = [{ id: uid('c'), name: `Grov uppskattning för ${kindOf(p.kind).label.toLowerCase()} (ersätts av kalkylen)`, estimate: est, actual: 0, rough: true }];
  return p;
}

const str = (v: unknown, f = '') => (typeof v === 'string' ? v : f);
const n = (v: unknown, f = 0) => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(x) ? x : f;
};
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const ids = (v: unknown) => arr(v).filter((x) => typeof x === 'string');
const STATUSES: HomeStatus[] = ['idea', 'planning', 'doing', 'done', 'paused'];

/** Säkerställer att ett inläst projekt har alla fält. */
export function normalizeHomeProject(raw: any): HomeProject {
  if (!raw || typeof raw !== 'object' || typeof raw.kind !== 'string') throw new Error('Det här är inte ett hemprojekt');
  const p = emptyHomeProject(raw.kind, str(raw.name));
  if (typeof raw.id === 'string') p.id = raw.id;
  p.status = STATUSES.includes(raw.status) ? raw.status : 'idea';
  p.goal = str(raw.goal);
  p.place = str(raw.place);
  p.size = { length: n(raw.size?.length), width: n(raw.size?.width), height: n(raw.size?.height, 2.4) };
  p.who = raw.who === 'self' || raw.who === 'contractor' ? raw.who : 'mix';
  p.budget = Math.max(0, n(raw.budget));
  p.deadline = str(raw.deadline);
  p.priority = raw.priority === 1 || raw.priority === 3 ? raw.priority : 2;
  p.wishes = arr(raw.wishes).map((w): Wish => ({ id: str(w?.id) || uid('w'), text: str(w?.text), must: !!w?.must }));
  p.ideas = arr(raw.ideas).map(
    (i): Idea => ({
      id: str(i?.id) || uid('i'),
      text: str(i?.text),
      image: typeof i?.image === 'string' && i.image.startsWith('data:image/') ? i.image : undefined,
      url: typeof i?.url === 'string' && /^https?:\/\//.test(i.url) ? i.url : undefined,
      createdAt: n(i?.createdAt, Date.now()),
    }),
  );
  p.steps = arr(raw.steps).map(
    (s): Step => ({
      id: str(s?.id) || uid('st'),
      title: str(s?.title, 'Steg'),
      detail: str(s?.detail),
      phase: str(s?.phase, 'Genomförande'),
      action: typeof s?.action === 'string' ? s.action : undefined,
      done: !!s?.done,
      note: str(s?.note),
    }),
  );
  p.costs = arr(raw.costs).map((c): Cost => ({ id: str(c?.id) || uid('c'), name: str(c?.name, 'Kostnad'), estimate: Math.max(0, n(c?.estimate)), actual: Math.max(0, n(c?.actual)), ...(c?.rough ? { rough: true } : {}) }));
  const l = raw.links ?? {};
  p.links = { plans: ids(l.plans), sites: ids(l.sites), builds: ids(l.builds), images: ids(l.images) } satisfies Links;
  p.notes = str(raw.notes);
  p.createdAt = n(raw.createdAt, Date.now());
  p.updatedAt = n(raw.updatedAt, Date.now());
  return p;
}

export class HomeStore {
  projects: HomeProject[];
  currentId: string | null;
  private listeners = new Set<() => void>();
  private saveTimer: number | undefined;
  /** Sätts om webbläsarens lagring är full */
  saveError = '';

  constructor() {
    this.projects = this.load();
    const cur = safeGet(CURRENT_KEY);
    this.currentId = this.projects.some((p) => p.id === cur) ? cur : null;
  }

  get current() {
    return this.projects.find((p) => p.id === this.currentId) ?? null;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
  }

  changed(p?: HomeProject | null, render = true) {
    if (p) p.updatedAt = Date.now();
    if (render) this.listeners.forEach((l) => l());
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 300);
  }

  open(id: string | null) {
    this.currentId = id;
    safeSet(CURRENT_KEY, id ?? '');
    this.changed();
  }

  add(p: HomeProject) {
    if (this.projects.some((x) => x.id === p.id)) p.id = uid('hem');
    this.projects.push(p);
    this.open(p.id);
  }

  remove(id: string) {
    this.projects = this.projects.filter((p) => p.id !== id);
    if (this.currentId === id) this.currentId = null;
    this.changed();
  }

  load(): HomeProject[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return arr(JSON.parse(raw)).flatMap((x) => {
        try {
          return [normalizeHomeProject(x)];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  }

  save() {
    window.clearTimeout(this.saveTimer);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.projects));
      this.saveError = '';
    } catch {
      this.saveError = 'Webbläsarens lagring är full – ta bort några bilder eller spara projektet som fil.';
      this.listeners.forEach((l) => l());
    }
  }
}

function safeGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignorera */
  }
}
