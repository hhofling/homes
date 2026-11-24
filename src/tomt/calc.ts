/** Beräkningar för tomten: mått, takytor, avstånd till tomtgräns och regler för små byggnader. */
import type { Building, Site, Vec } from './types';
import { polygonArea, rotatePoint, dist, projectOnSegment } from '../geometry';

/** Takfotens utstick (mm) */
export const OVERHANG = 400;
/** Sockelhöjd över mark (mm) */
export const PLINTH: Record<Building['foundation'], number> = { slab: 200, crawl: 600, plinth: 400 };

/** Hörnen på en roterad rektangel (medurs från övre vänstra). */
export function rectCorners(r: { x: number; y: number; w: number; d: number; rotation: number }): Vec[] {
  const c = { x: r.x, y: r.y };
  return [
    { x: r.x - r.w / 2, y: r.y - r.d / 2 },
    { x: r.x + r.w / 2, y: r.y - r.d / 2 },
    { x: r.x + r.w / 2, y: r.y + r.d / 2 },
    { x: r.x - r.w / 2, y: r.y + r.d / 2 },
  ].map((p) => rotatePoint(p, r.rotation, c));
}

/** Längs vilken lokal axel nocken går ('x' = längs bredden w). */
export function ridgeAxis(b: Pick<Building, 'w' | 'd' | 'ridge'>): 'x' | 'z' {
  const longIsX = b.w >= b.d;
  return b.ridge === 'long' ? (longIsX ? 'x' : 'z') : longIsX ? 'z' : 'x';
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Takets mått (mm). Spännvidd = mått tvärs nocken, längd = längs nocken. */
export function roofInfo(b: Building) {
  const axis = ridgeAxis(b);
  const length = axis === 'x' ? b.w : b.d;
  const span = axis === 'x' ? b.d : b.w;
  const pitch = b.roof === 'flat' ? 0 : Math.max(0, Math.min(60, b.pitch));
  const t = Math.tan(rad(pitch));
  const rise = b.roof === 'shed' ? span * t : b.roof === 'flat' ? 0 : (span / 2) * t;
  const L = length + 2 * OVERHANG;
  const S = span + 2 * OVERHANG;
  /** Takyta i m² (alla takfall har samma lutning, så ytan = projicerad yta / cos(lutning)). */
  const area = (L * S) / Math.cos(rad(pitch)) / 1e6;
  let gutter = 0;
  if (b.roof === 'gable') gutter = 2 * L;
  else if (b.roof === 'hip') gutter = 2 * (L + S);
  else if (b.roof === 'shed') gutter = L;
  else gutter = 2 * (L + S);
  const ridgeLen = b.roof === 'gable' ? L : b.roof === 'hip' ? Math.max(0, L - S) : 0;
  return { axis, length, span, pitch, rise, L, S, area, gutter: gutter / 1000, ridgeLen: ridgeLen / 1000 };
}

/** Väggarnas höjd (sockel ej inräknad) */
export const wallHeight = (b: Building) => Math.max(1, b.floors) * b.floorHeight;

/** Total höjd från mark till nock (mm) */
export const totalHeight = (b: Building) => PLINTH[b.foundation] + wallHeight(b) + roofInfo(b).rise;

/** Byggnadsarea i m² (yttermått) */
export const footprint = (r: { w: number; d: number }) => (r.w * r.d) / 1e6;

/** Area i m² för en polygon (mm) */
export const areaM2 = (pts: Vec[]) => (pts.length >= 3 ? polygonArea(pts) / 1e6 : 0);

/** Närmaste punkterna mellan en byggnad och tomtgränsen. */
export function nearestBoundary(b: { x: number; y: number; w: number; d: number; rotation: number }, plot: Vec[]) {
  let best = { d: Infinity, from: { x: 0, y: 0 }, to: { x: 0, y: 0 } };
  if (plot.length < 2) return best;
  const corners = rectCorners(b);
  const test = (p: Vec, a: Vec, c: Vec, fromBuilding: boolean) => {
    const q = projectOnSegment(p, a, c).point;
    const d = dist(p, q);
    if (d < best.d) best = fromBuilding ? { d, from: p, to: q } : { d, from: q, to: p };
  };
  for (let i = 0; i < plot.length; i++) for (const p of corners) test(p, plot[i], plot[(i + 1) % plot.length], true);
  for (const p of plot) for (let i = 0; i < 4; i++) test(p, corners[i], corners[(i + 1) % 4], false);
  return best;
}

/** Kortaste avståndet (mm) mellan en byggnad och tomtgränsen. */
export const distanceToBoundary = (b: { x: number; y: number; w: number; d: number; rotation: number }, plot: Vec[]) => nearestBoundary(b, plot).d;

export function insidePolygon(p: Vec, pts: Vec[]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export interface Note {
  level: 'ok' | 'info' | 'warn';
  text: string;
}

const m = (mm: number, digits = 1) => (mm / 1000).toLocaleString('sv-SE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * Enkla kontroller mot de vanligaste reglerna för en- och tvåbostadshus.
 * Detaljplanen kan säga annat – därför är det bara vägledning.
 */
export function buildingNotes(b: Building, site: Site): Note[] {
  const notes: Note[] = [];
  const area = footprint(b);
  const h = totalHeight(b);
  const d = distanceToBoundary(b, site.plot);
  const inside = site.plot.length >= 3 && rectCorners(b).every((p) => insidePolygon(p, site.plot));
  if (site.plot.length >= 3 && !inside) notes.push({ level: 'warn', text: 'Byggnaden ligger utanför tomtgränsen.' });
  else if (Number.isFinite(d)) {
    notes.push(
      d < 4500
        ? { level: 'warn', text: `${m(d)} m till tomtgränsen. Närmare än 4,5 m kräver oftast grannens skriftliga medgivande.` }
        : { level: 'ok', text: `${m(d)} m till tomtgränsen.` },
    );
  }
  const height = `nockhöjd ${m(h)} m`;
  if (b.kind === 'friggebod') {
    notes.push(
      area <= 15 && h <= 3000
        ? { level: 'ok', text: `Friggebod: ${dec(area)} m² och ${height} – ryms inom reglerna (högst 15 m² och 3,0 m). Inget bygglov.` }
        : { level: 'warn', text: `Friggebod får vara högst 15 m² och 3,0 m hög. Nu: ${dec(area)} m², ${height}.` },
    );
  } else if (b.kind === 'attefall') {
    notes.push(
      area <= 30 && h <= 4000
        ? { level: 'ok', text: `Attefallshus: ${dec(area)} m² och ${height} – inom gränsen (30 m², 4,0 m). Kräver anmälan och startbesked.` }
        : { level: 'warn', text: `Attefallshus får vara högst 30 m² och 4,0 m högt. Nu: ${dec(area)} m², ${height}.` },
    );
  } else if (b.kind === 'house') {
    notes.push({ level: 'info', text: `Nytt bostadshus kräver bygglov. Byggnadsarea ${dec(area)} m², ${height}.` });
  } else {
    notes.push({ level: 'info', text: `${dec(area)} m², ${height}. Större än en friggebod/attefallsbyggnad kräver bygglov.` });
  }
  return notes;
}

export const dec = (n: number, digits = 1) => n.toLocaleString('sv-SE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function siteSummary(site: Site) {
  const plotArea = areaM2(site.plot);
  const built = site.buildings.filter((b) => b.kind !== 'carport').reduce((s, b) => s + footprint(b), 0);
  return { plotArea, built, pct: plotArea > 0 ? (built / plotArea) * 100 : 0 };
}

/** Längd (mm) av en polyline */
export const polylineLength = (pts: Vec[]) => pts.slice(1).reduce((s, p, i) => s + dist(pts[i], p), 0);
