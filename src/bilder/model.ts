/** Skissens innehåll: bilder, penndrag, pilar, former, text och AI-markeringar. Rena funktioner (testbara). */

export type Item =
  | { kind: 'image'; id: string; src: string; x: number; y: number; w: number; h: number; opacity: number; locked?: boolean }
  | { kind: 'pen'; id: string; points: number[]; color: string; width: number }
  | { kind: 'mark'; id: string; points: number[]; width: number }
  | { kind: 'arrow'; id: string; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { kind: 'rect' | 'ellipse'; id: string; x: number; y: number; w: number; h: number; color: string; width: number }
  | { kind: 'text'; id: string; x: number; y: number; text: string; color: string; size: number };

export interface Sketch {
  width: number;
  height: number;
  background: string;
  items: Item[];
  /** Bilden i biblioteket som skissen utgår från. */
  baseId?: string;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Är det här något man ritat (inte en bild)? */
export const isDrawing = (it: Item) => it.kind !== 'image';

export function bbox(it: Item): Box {
  switch (it.kind) {
    case 'image':
    case 'rect':
    case 'ellipse':
      return norm({ x: it.x, y: it.y, w: it.w, h: it.h });
    case 'arrow': {
      const pad = it.width * 3;
      return { x: Math.min(it.x1, it.x2) - pad, y: Math.min(it.y1, it.y2) - pad, w: Math.abs(it.x2 - it.x1) + 2 * pad, h: Math.abs(it.y2 - it.y1) + 2 * pad };
    }
    case 'text': {
      const lines = it.text.split('\n');
      const w = Math.max(...lines.map((l) => l.length)) * it.size * 0.56;
      return { x: it.x, y: it.y, w: Math.max(w, it.size), h: lines.length * it.size * 1.2 };
    }
    case 'pen':
    case 'mark': {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (let i = 0; i < it.points.length; i += 2) {
        minX = Math.min(minX, it.points[i]);
        maxX = Math.max(maxX, it.points[i]);
        minY = Math.min(minY, it.points[i + 1]);
        maxY = Math.max(maxY, it.points[i + 1]);
      }
      const p = it.width / 2;
      return { x: minX - p, y: minY - p, w: maxX - minX + 2 * p, h: maxY - minY + 2 * p };
    }
  }
}

export function norm(b: Box): Box {
  return { x: b.w < 0 ? b.x + b.w : b.x, y: b.h < 0 ? b.y + b.h : b.y, w: Math.abs(b.w), h: Math.abs(b.h) };
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax,
    dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const inBox = (x: number, y: number, b: Box, pad = 0) => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;

/** Träffar punkten (x, y) föremålet? `tol` är hur nära man behöver klicka (i bildpixlar). */
export function hit(it: Item, x: number, y: number, tol: number): boolean {
  switch (it.kind) {
    case 'image':
    case 'text':
      return inBox(x, y, bbox(it), tol / 2);
    case 'rect': {
      const b = bbox(it);
      if (!inBox(x, y, b, tol)) return false;
      return Math.min(Math.abs(x - b.x), Math.abs(x - b.x - b.w), Math.abs(y - b.y), Math.abs(y - b.y - b.h)) <= tol + it.width / 2;
    }
    case 'ellipse': {
      const b = bbox(it);
      const rx = b.w / 2,
        ry = b.h / 2;
      if (rx < 1 || ry < 1) return inBox(x, y, b, tol);
      const d = Math.hypot((x - b.x - rx) / rx, (y - b.y - ry) / ry);
      return Math.abs(d - 1) * Math.min(rx, ry) <= tol + it.width / 2;
    }
    case 'arrow':
      return segDist(x, y, it.x1, it.y1, it.x2, it.y2) <= tol + it.width / 2;
    case 'pen':
    case 'mark': {
      const p = it.points;
      if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) <= tol + it.width / 2;
      for (let i = 0; i + 3 < p.length; i += 2) if (segDist(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= tol + it.width / 2) return true;
      return false;
    }
  }
}

/** Översta föremålet under punkten (låsta bakgrundsbilder hoppas över). */
export function topHit(items: Item[], x: number, y: number, tol: number): Item | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'image' && it.locked) continue;
    if (hit(it, x, y, tol)) return it;
  }
  return undefined;
}

export function moveItem(it: Item, dx: number, dy: number): Item {
  switch (it.kind) {
    case 'arrow':
      return { ...it, x1: it.x1 + dx, y1: it.y1 + dy, x2: it.x2 + dx, y2: it.y2 + dy };
    case 'pen':
    case 'mark':
      return { ...it, points: it.points.map((v, i) => v + (i % 2 ? dy : dx)) };
    default:
      return { ...it, x: it.x + dx, y: it.y + dy } as Item;
  }
}

/** Förenklar ett penndrag: punkter närmare än `min` pixlar slås ihop. */
export function simplify(points: number[], min: number): number[] {
  if (points.length <= 4) return points.slice();
  const out = [points[0], points[1]];
  for (let i = 2; i < points.length - 2; i += 2) {
    if (Math.hypot(points[i] - out[out.length - 2], points[i + 1] - out[out.length - 1]) >= min) out.push(points[i], points[i + 1]);
  }
  out.push(points[points.length - 2], points[points.length - 1]);
  return out;
}

/**
 * Lägger flera bilder bredvid varandra i ett rutnät (för "Kombinera bilder").
 * Varje bild får samma höjd i sin rad. Returnerar rutornas plats och den totala storleken.
 */
export function collageLayout(sizes: { w: number; h: number }[], targetWidth = 2400, gap = 24): { boxes: Box[]; width: number; height: number } {
  if (!sizes.length) return { boxes: [], width: targetWidth, height: Math.round(targetWidth * 0.625) };
  const cols = sizes.length <= 2 ? sizes.length : sizes.length <= 4 ? 2 : 3;
  const boxes: Box[] = [];
  let y = gap;
  for (let r = 0; r * cols < sizes.length; r++) {
    const row = sizes.slice(r * cols, r * cols + cols);
    const ratios = row.map((s) => s.w / Math.max(1, s.h));
    const avail = targetWidth - gap * (row.length + 1);
    const h = avail / ratios.reduce((a, b) => a + b, 0);
    let x = gap;
    for (const ratio of ratios) {
      const w = ratio * h;
      boxes.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
      x += w + gap;
    }
    y += h + gap;
  }
  return { boxes, width: targetWidth, height: Math.round(y) };
}

/** Plats för en ny bild som läggs in i en skiss: centrerad, högst hälften så stor som skissen. */
export function placeInside(canvas: { width: number; height: number }, img: { w: number; h: number }, frac = 0.5): Box {
  const s = Math.min((canvas.width * frac) / img.w, (canvas.height * frac) / img.h);
  const w = Math.round(img.w * s),
    h = Math.round(img.h * s);
  return { x: Math.round((canvas.width - w) / 2), y: Math.round((canvas.height - h) / 2), w, h };
}

/** Ny storlek när man drar i ett hörn. Bilder behåller sina proportioner. */
export function resizeBox(start: Box, corner: 'nw' | 'ne' | 'sw' | 'se', dx: number, dy: number, keepRatio: boolean, minSize = 8): Box {
  let { x, y, w, h } = start;
  const left = corner === 'nw' || corner === 'sw';
  const top = corner === 'nw' || corner === 'ne';
  let nw = left ? w - dx : w + dx;
  let nh = top ? h - dy : h + dy;
  if (keepRatio) {
    const s = Math.max(nw / w, nh / h);
    nw = w * s;
    nh = h * s;
  }
  nw = Math.max(minSize, nw);
  nh = Math.max(minSize, nh);
  if (left) x = x + w - nw;
  if (top) y = y + h - nh;
  return { x, y, w: nw, h: nh };
}
