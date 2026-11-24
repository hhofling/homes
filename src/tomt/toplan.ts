/** Kopplingen mellan en byggnad på tomten och en planritning i Planritaren. */
import type { Plan, Vec, Opening, Wall } from '../types';
import { emptyPlan } from '../store';
import { uid } from '../geometry';
import type { Building } from './types';

export type Side = 'top' | 'right' | 'bottom' | 'left';
export interface AutoOpening {
  side: Side;
  /** 0..1 längs sidan (i Planritarens riktning) */
  t: number;
  kind: 'window' | 'door' | 'garage';
  width: number;
}

/** Ytterväggens tjocklek i planritningen */
export const outerThickness = (b: Building) => (b.kind === 'house' || b.kind === 'attefall' ? 300 : 150);

/** Fönster och dörrar som läggs ut automatiskt tills byggnaden har en egen planritning. */
export function autoOpenings(b: Building): AutoOpening[] {
  const out: AutoOpening[] = [];
  if (b.kind === 'carport') return out;
  const sideLen: Record<Side, number> = { top: b.w, bottom: b.w, left: b.d, right: b.d };
  const windows = (side: Side, spacing: number, avoid: number[] = []) => {
    const len = sideLen[side];
    const n = Math.floor(len / spacing);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      if (avoid.some((a) => Math.abs(a - t) * len < 1300)) continue;
      out.push({ side, t, kind: 'window', width: 1200 });
    }
  };
  if (b.kind === 'garage') {
    out.push({ side: 'bottom', t: 0.5, kind: 'garage', width: Math.min(b.w - 1000, b.w > 5500 ? 3000 : 2500) });
    out.push({ side: 'right', t: 0.7, kind: 'door', width: 900 });
    out.push({ side: 'left', t: 0.5, kind: 'window', width: 1000 });
    return out;
  }
  if (b.kind === 'house') {
    out.push({ side: 'bottom', t: 0.5, kind: 'door', width: 1000 });
    windows('bottom', 3200, [0.5]);
    windows('top', 3200);
    windows('left', 3600);
    windows('right', 3600);
    return out;
  }
  out.push({ side: 'bottom', t: b.kind === 'shed' ? 0.5 : 0.3, kind: 'door', width: 900 });
  if (b.kind !== 'shed') {
    if (b.w > 3000) out.push({ side: 'bottom', t: 0.72, kind: 'window', width: 1000 });
    out.push({ side: 'left', t: 0.5, kind: 'window', width: 900 });
    if (b.kind === 'attefall') windows('top', 3000);
  }
  return out;
}

/** Gör en planritning (Planritaren) av byggnadens ytterväggar, med fönster och dörrar. */
export function planFromBuilding(b: Building, siteName: string): Plan {
  const p = emptyPlan(`${siteName} – ${b.name}`);
  const t = outerThickness(b);
  const x0 = t / 2;
  const y0 = t / 2;
  const x1 = b.w - t / 2;
  const y1 = b.d - t / 2;
  const wall = (a: Vec, c: Vec): Wall => ({ id: uid('w'), a, b: c, thickness: t });
  const walls: Record<Side, Wall> = {
    top: wall({ x: x0, y: y0 }, { x: x1, y: y0 }),
    right: wall({ x: x1, y: y0 }, { x: x1, y: y1 }),
    bottom: wall({ x: x1, y: y1 }, { x: x0, y: y1 }),
    left: wall({ x: x0, y: y1 }, { x: x0, y: y0 }),
  };
  p.walls.push(walls.top, walls.right, walls.bottom, walls.left);
  for (const o of autoOpenings(b)) {
    const op: Opening = {
      id: uid('o'),
      wallId: walls[o.side].id,
      kind: o.kind === 'garage' ? 'opening' : o.kind,
      t: o.t,
      width: o.width,
      flip: false,
      side: false,
    };
    p.openings.push(op);
  }
  p.rooms.push({
    id: uid('r'),
    name: b.kind === 'house' ? 'Bostad – rita in rummen' : b.name,
    color: '#f6efe3',
    points: [
      { x: t, y: t },
      { x: b.w - t, y: t },
      { x: b.w - t, y: b.d - t },
      { x: t, y: b.d - t },
    ],
  });
  p.dims.push({ id: uid('d'), a: { x: 0, y: b.d + 800 }, b: { x: b.w, y: b.d + 800 } });
  p.dims.push({ id: uid('d'), a: { x: -800, y: 0 }, b: { x: -800, y: b.d } });
  p.labels.push({ id: uid('l'), x: b.w / 2, y: -900, text: `${b.name} – yttermått ${(b.w / 1000).toLocaleString('sv-SE')} × ${(b.d / 1000).toLocaleString('sv-SE')} m`, size: 260 });
  return p;
}
