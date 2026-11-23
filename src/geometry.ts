import type { Vec } from './types';

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const snapValue = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v);
export const snapVec = (p: Vec, step: number): Vec => ({ x: snapValue(p.x, step), y: snapValue(p.y, step) });

export function projectOnSegment(p: Vec, a: Vec, b: Vec) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { t, point, dist: dist(p, point) };
}

export function polygonArea(pts: Vec[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

export function polygonCentroid(pts: Vec[]): Vec {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = pts.length || 1;
    return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function pointInPolygon(p: Vec, pts: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function rotatePoint(p: Vec, deg: number, origin: Vec = { x: 0, y: 0 }): Vec {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return { x: origin.x + dx * c - dy * s, y: origin.y + dx * s + dy * c };
}

/** Är p inom en rektangel med centrum (cx,cy), bredd w, djup d och rotation (grader)? */
export function pointInRotatedRect(p: Vec, cx: number, cy: number, w: number, d: number, rotation: number, pad = 0) {
  const local = rotatePoint(p, -rotation, { x: cx, y: cy });
  return Math.abs(local.x - cx) <= w / 2 + pad && Math.abs(local.y - cy) <= d / 2 + pad;
}

/** Lås vinkeln från `from` till `to` till multiplar av stepDeg. */
export function lockAngle(from: Vec, to: Vec, stepDeg = 45): Vec {
  const len = dist(from, to);
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const step = (stepDeg * Math.PI) / 180;
  const a = Math.round(ang / step) * step;
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
}

export function boundsOf(points: Vec[]) {
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

const nf2 = new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf1 = new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** 3450 -> "3,45 m" */
export function formatLength(mm: number): string {
  return `${nf2.format(mm / 1000)} m`;
}

/** Area i mm² -> "12,3 m²" */
export function formatArea(mm2: number): string {
  return `${nf1.format(mm2 / 1e6)} m²`;
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
}
