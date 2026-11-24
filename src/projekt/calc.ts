import type { Material, Project, ProjectRoom, Task } from './types';

export const PHASES = [
  'Planering & tillstånd',
  'Rivning',
  'Stomme & bygg',
  'El',
  'VVS',
  'Tätskikt & våtrum',
  'Ytskikt',
  'Snickerier & montering',
  'Städning & besiktning',
];

export const TRADES = [
  'Snickare',
  'Elektriker',
  'Rörmokare',
  'Plattsättare',
  'Målare',
  'Golvläggare',
  'Murare',
  'Takläggare',
  'Köksmontör',
  'Rivning & bortforsling',
  'Övrigt',
];

export const CATEGORIES = [
  'Trä & skivor',
  'Färg & spackel',
  'Golv',
  'Kakel & klinker',
  'Tätskikt',
  'El',
  'VVS & porslin',
  'Kök & vitvaror',
  'Infästning & lim',
  'Verktyg & förbrukning',
  'Övrigt',
];

export const UNITS = ['st', 'm²', 'm', 'm³', 'l', 'kg', 'ton', 'förp', 'rulle', 'säck', 'burk', 'pall', 'tim'];

/** Enheter som köps i hela antal. */
const WHOLE_UNITS = new Set(['st', 'förp', 'rulle', 'säck', 'burk', 'pall']);

export const num = (v: unknown, fallback = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
};

/** Mängd att köpa inklusive spill, avrundad på ett rimligt sätt. */
export function buyQty(m: Material): number {
  const q = Math.max(0, num(m.qty)) * (1 + Math.max(0, num(m.waste)) / 100);
  if (WHOLE_UNITS.has(m.unit)) return Math.ceil(q - 1e-9);
  return Math.ceil(q * 10 - 1e-9) / 10;
}

export const materialCost = (m: Material) => buyQty(m) * Math.max(0, num(m.price));

/** Väggyta i m² (omkrets × takhöjd, minus ca 10 % för dörrar och fönster). */
export const wallArea = (r: Pick<ProjectRoom, 'perimeter' | 'height'>) => Math.round(r.perimeter * r.height * 0.9 * 10) / 10;

export interface Totals {
  materialsSelf: number;
  materialsContractor: number;
  materials: number;
  labor: number;
  rot: number;
  total: number;
  hoursSelf: number;
  hoursContractor: number;
  hours: number;
  tasksDone: number;
  tasks: number;
}

export function totals(p: Project): Totals {
  let materialsSelf = 0;
  let materialsContractor = 0;
  for (const m of p.materials) {
    const c = materialCost(m);
    if (m.buyer === 'self') materialsSelf += c;
    else materialsContractor += c;
  }
  let labor = 0;
  let hoursSelf = 0;
  let hoursContractor = 0;
  for (const t of p.tasks) {
    if (t.who === 'contractor') {
      labor += Math.max(0, num(t.laborCost));
      hoursContractor += Math.max(0, num(t.hours));
    } else hoursSelf += Math.max(0, num(t.hours));
  }
  const rot = Math.round((labor * Math.max(0, Math.min(100, num(p.rotPct)))) / 100);
  const materials = materialsSelf + materialsContractor;
  return {
    materialsSelf,
    materialsContractor,
    materials,
    labor,
    rot,
    total: materials + labor - rot,
    hoursSelf,
    hoursContractor,
    hours: hoursSelf + hoursContractor,
    tasksDone: p.tasks.filter((t) => t.status === 'done').length,
    tasks: p.tasks.length,
  };
}

/** Moment sorterade efter fas, och inom fasen i den ordning de lades in. */
export function orderedTasks(tasks: Task[]): Task[] {
  const idx = (ph: string) => {
    const i = PHASES.indexOf(ph);
    return i < 0 ? PHASES.length : i;
  };
  return tasks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => idx(a.t.phase) - idx(b.t.phase) || a.i - b.i)
    .map((x) => x.t);
}

export const taskDays = (t: Task, hoursPerDay: number) => {
  const h = Math.max(0, num(t.hours));
  if (h <= 0) return 0;
  return Math.max(1, Math.ceil(h / (Math.max(1, num(t.people, 1)) * Math.max(1, num(hoursPerDay, 8))) - 1e-9));
};

// ----- Datum (vardagar) -----

export function parseDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}
export const fmtISO = (d: Date) => d.toISOString().slice(0, 10);
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

/** Första vardagen från och med d. */
function nextWorkday(d: Date) {
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}
/** Lägger till n arbetsdagar (n ≥ 1) – returnerar sista arbetsdagen. */
function endAfter(start: Date, n: number) {
  let d = start;
  for (let i = 1; i < n; i++) d = nextWorkday(addDays(d, 1));
  return d;
}

export interface ScheduleRow {
  task: Task;
  days: number;
  start: Date | null;
  end: Date | null;
  /** Arbetsdag nummer (0-baserat) där momentet börjar */
  offset: number;
}

/** Enkel tidsplan: momenten görs efter varandra i fasordning, bara vardagar. */
export function schedule(p: Project): { rows: ScheduleRow[]; workdays: number; end: Date | null } {
  let day = 0;
  let cursor = p.startDate ? parseDate(p.startDate) : null;
  if (cursor) cursor = nextWorkday(cursor);
  let end: Date | null = null;
  const rows: ScheduleRow[] = [];
  for (const task of orderedTasks(p.tasks)) {
    const days = taskDays(task, p.hoursPerDay);
    let start: Date | null = null;
    let stop: Date | null = null;
    if (cursor && days > 0) {
      start = cursor;
      stop = endAfter(cursor, days);
      cursor = nextWorkday(addDays(stop, 1));
      end = stop;
    }
    rows.push({ task, days, start, end: stop, offset: day });
    day += days;
  }
  return { rows, workdays: day, end };
}

// ----- Formatering -----

export const kr = (n: number) => `${Math.round(n).toLocaleString('sv-SE')} kr`;
export const dec = (n: number, digits = 1) =>
  (Math.round(n * 10 ** digits) / 10 ** digits).toLocaleString('sv-SE', { maximumFractionDigits: digits });
export const dateSv = (d: Date | null) =>
  d ? d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '–';

// ----- Inköpslista -----

export type GroupBy = 'store' | 'category' | 'task';

export function shoppingGroups(p: Project, by: GroupBy, includeContractor = false): { name: string; items: Material[] }[] {
  const groups = new Map<string, Material[]>();
  const taskName = new Map(p.tasks.map((t) => [t.id, t.name]));
  for (const m of p.materials) {
    if (!includeContractor && m.buyer !== 'self') continue;
    const key =
      by === 'store'
        ? m.store.trim() || 'Ingen butik vald'
        : by === 'category'
          ? m.category || 'Övrigt'
          : (m.taskId && taskName.get(m.taskId)) || 'Inget moment';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const last = (s: string) => /^(Ingen|Inget|Övrigt)/.test(s);
      return Number(last(a)) - Number(last(b)) || a.localeCompare(b, 'sv');
    })
    .map(([name, items]) => ({ name, items }));
}

export function shoppingText(p: Project, by: GroupBy, onlyRemaining: boolean): string {
  const lines = [`Inköpslista – ${p.name}`, ''];
  let sum = 0;
  for (const g of shoppingGroups(p, by)) {
    const items = g.items.filter((m) => !onlyRemaining || !m.bought);
    if (!items.length) continue;
    lines.push(g.name.toUpperCase());
    for (const m of items) {
      const cost = materialCost(m);
      sum += cost;
      lines.push(`[${m.bought ? 'x' : ' '}] ${dec(buyQty(m))} ${m.unit} ${m.name}${m.price ? ` (ca ${kr(cost)})` : ''}${m.note ? ` – ${m.note}` : ''}`);
    }
    lines.push('');
  }
  lines.push(`Summa ca ${kr(sum)}`);
  return lines.join('\n');
}

export function materialsCSV(p: Project): string {
  const taskName = new Map(p.tasks.map((t) => [t.id, t.name]));
  const cell = (v: string | number) => {
    const s = typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : v;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [['Material', 'Moment', 'Kategori', 'Butik', 'Mängd', 'Spill %', 'Att köpa', 'Enhet', 'Pris/enhet', 'Summa', 'Köps av', 'Köpt', 'Anteckning']];
  for (const m of p.materials) {
    rows.push([
      m.name,
      (m.taskId && taskName.get(m.taskId)) || '',
      m.category,
      m.store,
      cell(num(m.qty)),
      cell(num(m.waste)),
      cell(buyQty(m)),
      m.unit,
      cell(num(m.price)),
      cell(materialCost(m)),
      m.buyer === 'self' ? 'Jag' : 'Hantverkaren',
      m.bought ? 'Ja' : 'Nej',
      m.note,
    ].map((v) => cell(v as string)));
  }
  return '﻿' + rows.map((r) => r.join(';')).join('\r\n');
}

// ----- Offertförfrågan -----

const TRADE_REQUIREMENTS: Record<string, string> = {
  Elektriker: 'Att ni är registrerade hos Elsäkerhetsverket (behörig elinstallatör)',
  Rörmokare: 'Att ni följer Säker Vatten och har behörighet för arbetet',
  Plattsättare: 'Att ni är behöriga för våtrum (t.ex. GVK, BKR eller motsvarande) och lämnar våtrumsintyg',
};

/** Hantverkare som har minst ett moment där hantverkare ska anlitas. */
export function quoteTrades(p: Project): string[] {
  const set = new Set(p.tasks.filter((t) => t.who === 'contractor').map((t) => t.trade || 'Övrigt'));
  return TRADES.filter((t) => set.has(t)).concat([...set].filter((t) => !TRADES.includes(t)));
}

export function quoteText(p: Project, trade: string): string {
  const tasks = orderedTasks(p.tasks).filter((t) => t.who === 'contractor' && (t.trade || 'Övrigt') === trade);
  const ids = new Set(tasks.map((t) => t.id));
  const rooms = new Map(p.rooms.map((r) => [r.id, r]));
  const sch = schedule(p).rows.filter((r) => ids.has(r.task.id) && r.start);
  const L: string[] = [];
  L.push(`Offertförfrågan – ${trade.toLowerCase()}`);
  L.push('');
  L.push('Hej!');
  L.push('');
  L.push(`Jag planerar projektet "${p.name}"${p.address ? ` på ${p.address}` : ''} och vill gärna få en offert på arbetena nedan.`);
  if (sch.length) {
    L.push(`Önskad tidsperiod: ungefär ${dateSv(sch[0].start)} – ${dateSv(sch[sch.length - 1].end)} (kan diskuteras).`);
  }
  L.push('');
  L.push('ARBETEN');
  tasks.forEach((t, i) => {
    L.push(`${i + 1}. ${t.name}`);
    if (t.description.trim()) L.push(...t.description.trim().split('\n').map((s) => `   ${s}`));
    const rs = t.roomIds.map((id) => rooms.get(id)).filter(Boolean) as ProjectRoom[];
    if (rs.length) L.push(`   Rum: ${rs.map((r) => `${r.name} (golv ${dec(r.area)} m², väggar ca ${dec(wallArea(r))} m²)`).join(', ')}`);
  });
  const mats = p.materials.filter((m) => m.taskId && ids.has(m.taskId));
  const theirs = mats.filter((m) => m.buyer === 'contractor');
  const mine = mats.filter((m) => m.buyer === 'self');
  if (theirs.length) {
    L.push('');
    L.push('MATERIAL SOM SKA INGÅ I OFFERTEN');
    for (const m of theirs) L.push(`- ${m.name}: ca ${dec(buyQty(m))} ${m.unit}${m.note ? ` (${m.note})` : ''}`);
  }
  if (mine.length) {
    L.push('');
    L.push('MATERIAL SOM JAG KÖPER SJÄLV');
    for (const m of mine) L.push(`- ${m.name}: ca ${dec(buyQty(m))} ${m.unit}${m.note ? ` (${m.note})` : ''}`);
  }
  L.push('');
  L.push('JAG VILL GÄRNA ATT OFFERTEN ANGER');
  L.push('- Fast pris eller takpris, uppdelat på arbete och material');
  L.push('- Arbetskostnaden separat, så att ROT-avdraget kan räknas ut');
  L.push('- När ni kan börja och hur lång tid arbetet tar');
  L.push('- Att ni har F-skatt och ansvarsförsäkring');
  if (TRADE_REQUIREMENTS[trade]) L.push(`- ${TRADE_REQUIREMENTS[trade]}`);
  L.push('- Hur garanti och eventuella tilläggsarbeten hanteras');
  L.push('');
  L.push('Hör gärna av er om ni vill komma och titta på plats innan ni lämnar offert.');
  L.push('');
  L.push('Med vänliga hälsningar');
  const c = p.contact;
  if (c.name) L.push(c.name);
  if (c.phone) L.push(`Telefon: ${c.phone}`);
  if (c.email) L.push(`E-post: ${c.email}`);
  return L.join('\n');
}
