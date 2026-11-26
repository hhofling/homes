/**
 * Kopplingen mot de andra verktygen: läser vad som finns sparat i dem (samma webbläsare),
 * skapar nya planer/tomter/byggprojekt åt ett hemprojekt och öppnar rätt verktyg med rätt innehåll.
 */
import { uid } from '../geometry';
import { emptyPlan, normalizePlan } from '../store';
import type { Plan } from '../types';
import { emptyProject, normalizeProject } from '../projekt/store';
import { applyTemplate, TEMPLATES } from '../projekt/templates';
import { totals } from '../projekt/calc';
import type { Project } from '../projekt/types';
import { emptySite, normalizeSite } from '../tomt/store';
import { newArea, newBuilding } from '../tomt/catalog';
import { siteToProject } from '../tomt/quantities';
import type { Site } from '../tomt/types';
import { kindOf, floorArea } from './kinds';
import type { HomeProject } from './types';

export const KEYS = {
  plans: 'planritaren.plans.v1',
  sites: 'tomtplaneraren.sites.v1',
  builds: 'byggplaneraren.projects.v1',
} as const;

function readList<T>(key: string, normalize: (x: any) => T): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.flatMap((x) => {
      try {
        return [normalize(x)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export const readPlans = () => readList<Plan>(KEYS.plans, normalizePlan);
export const readSites = () => readList<Site>(KEYS.sites, normalizeSite);
export const readBuilds = () => readList<Project>(KEYS.builds, normalizeProject);

/** Allt som finns sparat i verktygen i den här webbläsaren. */
export interface Library {
  plans: Map<string, Plan>;
  sites: Map<string, Site>;
  builds: Map<string, Project>;
}
export function readLibrary(): Library {
  const byId = <T extends { id: string }>(l: T[]) => new Map(l.map((x) => [x.id, x]));
  return { plans: byId(readPlans()), sites: byId(readSites()), builds: byId(readBuilds()) };
}

/** Summan av kalkylerna i de kopplade byggprojekten. */
export function linkedCalc(p: HomeProject, lib: Library) {
  let total = 0;
  let materials = 0;
  let labor = 0;
  let rot = 0;
  let tasks = 0;
  let tasksDone = 0;
  let found = 0;
  for (const id of p.links.builds) {
    const b = lib.builds.get(id);
    if (!b) continue;
    found++;
    const t = totals(b);
    total += t.total;
    materials += t.materials;
    labor += t.labor;
    rot += t.rot;
    tasks += t.tasks;
    tasksDone += t.tasksDone;
  }
  return { total, materials, labor, rot, tasks, tasksDone, found };
}

/** Uppskattad totalkostnad: kalkylerna plus egna poster (den grova uppskattningen bara om ingen kalkyl finns). */
export function estimateTotal(p: HomeProject, lib: Library) {
  const calc = linkedCalc(p, lib);
  const own = p.costs.filter((c) => !(c.rough && calc.found)).reduce((s, c) => s + c.estimate, 0);
  return { total: calc.total + own, calc, own };
}

// ---------- Skapa nytt innehåll åt ett hemprojekt ----------

const m = (meters: number, fallback: number) => Math.round((meters > 0 ? meters : fallback) * 1000);

/** En enkel ritning av ett rektangulärt rum: väggar, en dörr, ett fönster och måttlinjer. */
export function roomPlan(p: HomeProject, suffix = 'i dag'): Plan {
  const L = m(p.size.length, 4);
  const W = m(p.size.width, 3);
  const t = 150;
  const roomName = p.place.trim() || kindOf(p.kind).label;
  const plan = emptyPlan(`${p.name} – ${suffix}`);
  const x0 = -t / 2;
  const y0 = -t / 2;
  const x1 = L + t / 2;
  const y1 = W + t / 2;
  const wall = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ id: uid('w'), a, b, thickness: t });
  const top = wall({ x: x0, y: y0 }, { x: x1, y: y0 });
  const right = wall({ x: x1, y: y0 }, { x: x1, y: y1 });
  const bottom = wall({ x: x1, y: y1 }, { x: x0, y: y1 });
  const left = wall({ x: x0, y: y1 }, { x: x0, y: y0 });
  plan.walls.push(top, right, bottom, left);
  plan.openings.push({ id: uid('o'), wallId: bottom.id, kind: 'door', t: 0.8, width: 900, flip: false, side: false });
  plan.openings.push({ id: uid('o'), wallId: top.id, kind: 'window', t: 0.5, width: Math.min(1200, L * 0.4), flip: false, side: false });
  plan.rooms.push({
    id: uid('r'),
    name: roomName,
    color: '#f6efe3',
    points: [
      { x: 0, y: 0 },
      { x: L, y: 0 },
      { x: L, y: W },
      { x: 0, y: W },
    ],
  });
  plan.dims.push({ id: uid('d'), a: { x: 0, y: W + 700 }, b: { x: L, y: W + 700 } });
  plan.dims.push({ id: uid('d'), a: { x: -700, y: 0 }, b: { x: -700, y: W } });
  plan.labels.push({ id: uid('l'), x: L / 2, y: -700, text: 'Mät och justera väggar, dörrar och fönster så att de stämmer', size: 160 });
  return plan;
}

/** Kopia av en plan, t.ex. för att rita förslaget utan att ändra hur det ser ut i dag. */
export function copyPlan(src: Plan, name: string): Plan {
  const c = normalizePlan(JSON.parse(JSON.stringify(src)));
  c.id = uid('plan');
  c.name = name;
  c.updatedAt = Date.now();
  return c;
}

/** En tomt med det som projektet gäller (altan, attefallshus, tillbyggnad …) utlagt. */
export function projectSite(p: HomeProject): Site {
  const s = emptySite(p.name);
  const k = kindOf(p.kind);
  const house = newBuilding('house', 12500, 15000, 11000, 8000);
  house.name = 'Huset';
  s.buildings.push(house);
  if (k.plotItem?.type === 'area') {
    const a = newArea(k.plotItem.kind as any, 12500, 8500, m(p.size.length, 6), m(p.size.width, 4));
    a.name = p.name;
    s.areas.push(a);
  } else if (k.plotItem?.type === 'building') {
    const isExt = k.id === 'extension';
    const area = floorArea(p);
    const kind = isExt ? 'house' : area && area <= 15 ? 'friggebod' : 'attefall';
    const b = isExt
      ? newBuilding('house', 12500 + 5500 + m(p.size.length, 5) / 2, 15000, m(p.size.length, 5), m(p.size.width, 4))
      : newBuilding(kind, 8000, 27000, m(p.size.length, 6), m(p.size.width, 5));
    b.name = isExt ? 'Tillbyggnad' : p.name;
    if (isExt) b.floors = 1;
    s.buildings.push(b);
  }
  return s;
}

/** Ett byggprojekt (kalkyl, moment och material) utifrån hemprojektet. */
export function projectBuild(p: HomeProject, lib: Library): Project {
  // Finns en kopplad tomt räknas allt på tomten fram därifrån
  const site = p.links.sites.map((id) => lib.sites.get(id)).find(Boolean);
  if (site) {
    const plans = new Map(lib.plans);
    for (const pl of site.plans ?? []) if (!plans.has(pl.id)) plans.set(pl.id, pl);
    const b = siteToProject(site, plans);
    b.name = `${p.name} – kalkyl`;
    fillBuild(b, p);
    return b;
  }
  const b = emptyProject(`${p.name} – kalkyl`);
  const k = kindOf(p.kind);
  const L = p.size.length > 0 ? p.size.length : k.size.length || 4;
  const W = p.size.width > 0 ? p.size.width : k.size.width || 3;
  const H = p.size.height > 0 ? p.size.height : 2.4;
  const room = { id: uid('room'), name: p.place.trim() || k.label, area: Math.round(L * W * 10) / 10, perimeter: Math.round(2 * (L + W) * 10) / 10, height: H };
  b.rooms.push(room);
  const tpl = TEMPLATES.find((t) => t.id === k.byggTemplate);
  if (tpl) {
    const { tasks, materials } = applyTemplate(tpl, { area: room.area, perimeter: room.perimeter, height: room.height }, room);
    for (const t of tasks) if (p.who === 'contractor') t.who = 'contractor';
    b.tasks.push(...tasks);
    b.materials.push(...materials);
  }
  fillBuild(b, p);
  return b;
}

function fillBuild(b: Project, p: HomeProject) {
  const lines = [`Skapat från Hemprojekt "${p.name}".`];
  if (p.goal.trim()) lines.push(`Mål: ${p.goal.trim()}`);
  const must = p.wishes.filter((w) => w.must && w.text.trim()).map((w) => `• ${w.text.trim()}`);
  const nice = p.wishes.filter((w) => !w.must && w.text.trim()).map((w) => `• ${w.text.trim()}`);
  if (must.length) lines.push('', 'Måste finnas:', ...must);
  if (nice.length) lines.push('', 'Vore bra:', ...nice);
  b.notes = [lines.join('\n'), b.notes].filter(Boolean).join('\n\n');
  if (p.deadline && !b.startDate) {
    // Starta en månad före "klart till" som ett första förslag
    const d = new Date(p.deadline);
    if (!isNaN(d.getTime())) {
      d.setMonth(d.getMonth() - 1);
      const today = new Date();
      b.startDate = (d < today ? today : d).toISOString().slice(0, 10);
    }
  }
  b.id = uid('proj');
}

/** Lägger in planer/tomter/byggprojekt direkt i verktygens lagring (används när en projektfil öppnas). */
export function storeItems(key: (typeof KEYS)[keyof typeof KEYS], items: { id: string }[]): number {
  if (!items.length) return 0;
  try {
    const raw = localStorage.getItem(key);
    const list: { id: string }[] = raw ? JSON.parse(raw) : [];
    let added = 0;
    for (const it of items) {
      if (list.some((x) => x?.id === it.id)) continue;
      list.push(it);
      added++;
    }
    if (added) localStorage.setItem(key, JSON.stringify(list));
    return added;
  } catch {
    return 0;
  }
}
