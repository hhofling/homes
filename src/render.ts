import type { Plan, Opening, Wall, Dimension, Vec } from './types';
import { dist, formatArea, formatLength, polygonArea, polygonCentroid } from './geometry';
import { furnitureDef } from './furniture';

export const WALL_COLOR = '#2b3440';
export const PAPER = '#ffffff';
const DIM_COLOR = '#5b6b7c';

export interface RenderOptions {
  showWallLengths: boolean;
  showAreas: boolean;
  showFurniture: boolean;
}

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const r = (n: number) => Math.round(n * 10) / 10;

export function wallAngle(w: Wall) {
  return (Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI;
}

export function openingFrame(plan: Plan, o: Opening) {
  const wall = plan.walls.find((w) => w.id === o.wallId);
  if (!wall) return null;
  const c = { x: wall.a.x + (wall.b.x - wall.a.x) * o.t, y: wall.a.y + (wall.b.y - wall.a.y) * o.t };
  return { wall, c, angle: wallAngle(wall) };
}

/** Text som alltid är läsbar (aldrig upp och ned). */
function readableAngle(deg: number) {
  let a = ((deg % 360) + 360) % 360;
  if (a > 90 && a <= 270) a -= 180;
  return a;
}

export function renderOpening(o: Opening, thickness: number): string {
  const w = o.width;
  const t = thickness;
  const S = `stroke="${WALL_COLOR}" stroke-width="1.2" vector-effect="non-scaling-stroke"`;
  const thin = `stroke="${WALL_COLOR}" stroke-width="0.8" vector-effect="non-scaling-stroke"`;
  let s = `<rect x="${-w / 2}" y="${-t / 2 - 2}" width="${w}" height="${t + 4}" fill="${PAPER}"/>`;
  const s1 = o.side ? -1 : 1;
  const y0 = (s1 * t) / 2;
  const leaf = (hx: number, dir: number, len: number) => {
    const sweep = dir * s1 > 0 ? 1 : 0;
    return (
      `<line x1="${hx}" y1="${y0}" x2="${hx}" y2="${y0 + s1 * len}" ${S}/>` +
      `<path d="M ${hx + dir * len} ${y0} A ${len} ${len} 0 0 ${sweep} ${hx} ${y0 + s1 * len}" fill="none" ${thin} stroke-dasharray="5 4"/>`
    );
  };
  // Karm (tunna linjer på väggens ändar)
  const jambs = `<line x1="${-w / 2}" y1="${-t / 2}" x2="${-w / 2}" y2="${t / 2}" ${S}/><line x1="${w / 2}" y1="${-t / 2}" x2="${w / 2}" y2="${t / 2}" ${S}/>`;
  switch (o.kind) {
    case 'door': {
      const hx = o.flip ? w / 2 : -w / 2;
      const dir = o.flip ? -1 : 1;
      s += jambs + leaf(hx, dir, w);
      break;
    }
    case 'double':
      s += jambs + leaf(-w / 2, 1, w / 2) + leaf(w / 2, -1, w / 2);
      break;
    case 'sliding': {
      const pw = w / 2 + 40;
      s += jambs;
      s += `<rect x="${-w / 2}" y="${-t / 4 - 15}" width="${pw}" height="30" fill="${PAPER}" ${S}/>`;
      s += `<rect x="${w / 2 - pw}" y="${t / 4 - 15}" width="${pw}" height="30" fill="${PAPER}" ${S}/>`;
      break;
    }
    case 'window':
      s += `<rect x="${-w / 2}" y="${-t / 2}" width="${w}" height="${t}" fill="#eaf4fb" ${S}/>`;
      s += `<line x1="${-w / 2}" y1="0" x2="${w / 2}" y2="0" ${thin}/>`;
      s += `<line x1="${-w / 2}" y1="${-t / 6}" x2="${w / 2}" y2="${-t / 6}" ${thin}/>`;
      break;
    case 'opening':
      s += `<line x1="${-w / 2}" y1="${-t / 2}" x2="${w / 2}" y2="${-t / 2}" ${thin} stroke-dasharray="6 5"/>`;
      s += `<line x1="${-w / 2}" y1="${t / 2}" x2="${w / 2}" y2="${t / 2}" ${thin} stroke-dasharray="6 5"/>`;
      break;
  }
  return s;
}

export function renderDimension(d: Dimension | { a: Vec; b: Vec }, color = DIM_COLOR, offsetText = 140): string {
  const len = dist(d.a, d.b);
  if (len < 1) return '';
  const ang = Math.atan2(d.b.y - d.a.y, d.b.x - d.a.x);
  const deg = (ang * 180) / Math.PI;
  const nx = -Math.sin(ang);
  const ny = Math.cos(ang);
  const tick = 90;
  const S = `stroke="${color}" stroke-width="1" vector-effect="non-scaling-stroke"`;
  const tickAt = (p: Vec) =>
    `<line x1="${r(p.x - Math.cos(ang + Math.PI / 4) * tick)}" y1="${r(p.y - Math.sin(ang + Math.PI / 4) * tick)}" x2="${r(p.x + Math.cos(ang + Math.PI / 4) * tick)}" y2="${r(p.y + Math.sin(ang + Math.PI / 4) * tick)}" ${S}/>` +
    `<line x1="${r(p.x - nx * tick * 1.3)}" y1="${r(p.y - ny * tick * 1.3)}" x2="${r(p.x + nx * tick * 1.3)}" y2="${r(p.y + ny * tick * 1.3)}" ${S}/>`;
  const mid = { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 };
  const ta = readableAngle(deg);
  const tp = { x: mid.x - nx * offsetText, y: mid.y - ny * offsetText };
  return (
    `<line x1="${r(d.a.x)}" y1="${r(d.a.y)}" x2="${r(d.b.x)}" y2="${r(d.b.y)}" ${S}/>` +
    tickAt(d.a) +
    tickAt(d.b) +
    `<text x="${r(tp.x)}" y="${r(tp.y)}" font-size="170" fill="${color}" text-anchor="middle" dominant-baseline="central" font-family="system-ui, sans-serif" transform="rotate(${r(ta)} ${r(tp.x)} ${r(tp.y)})" paint-order="stroke" stroke="${PAPER}" stroke-width="40">${formatLength(len)}</text>`
  );
}

export function renderPlan(plan: Plan, opts: RenderOptions): string {
  const out: string[] = [];

  // Rum (golv)
  out.push('<g class="rooms">');
  for (const room of plan.rooms) {
    if (room.points.length < 3) continue;
    const pts = room.points.map((p) => `${r(p.x)},${r(p.y)}`).join(' ');
    out.push(`<polygon data-id="${room.id}" points="${pts}" fill="${esc(room.color)}" stroke="none"/>`);
  }
  out.push('</g>');

  // Möbler
  if (opts.showFurniture) {
    out.push('<g class="items">');
    for (const it of plan.items) {
      const def = furnitureDef(it.type);
      out.push(
        `<g data-id="${it.id}" transform="translate(${r(it.x)} ${r(it.y)}) rotate(${r(it.rotation)})">${def.draw(it.w, it.d, it.color, it.rotation)}</g>`,
      );
      if (it.label) {
        out.push(
          `<text x="${r(it.x)}" y="${r(it.y)}" font-size="${Math.max(90, Math.min(it.w, it.d) * 0.18)}" text-anchor="middle" dominant-baseline="central" fill="#1f2933" font-family="system-ui, sans-serif" paint-order="stroke" stroke="#ffffff" stroke-width="30">${esc(it.label)}</text>`,
        );
      }
    }
    out.push('</g>');
  }

  // Väggar
  out.push('<g class="walls">');
  for (const w of plan.walls) {
    out.push(
      `<line data-id="${w.id}" x1="${r(w.a.x)}" y1="${r(w.a.y)}" x2="${r(w.b.x)}" y2="${r(w.b.y)}" stroke="${WALL_COLOR}" stroke-width="${w.thickness}" stroke-linecap="square"/>`,
    );
  }
  out.push('</g>');

  // Dörrar och fönster
  out.push('<g class="openings">');
  for (const o of plan.openings) {
    const f = openingFrame(plan, o);
    if (!f) continue;
    out.push(`<g data-id="${o.id}" transform="translate(${r(f.c.x)} ${r(f.c.y)}) rotate(${r(f.angle)})">${renderOpening(o, f.wall.thickness)}</g>`);
  }
  out.push('</g>');

  // Rumsnamn + area
  out.push('<g class="room-labels">');
  for (const room of plan.rooms) {
    if (room.points.length < 3) continue;
    const c = polygonCentroid(room.points);
    const area = opts.showAreas ? formatArea(polygonArea(room.points)) : '';
    out.push(
      `<text x="${r(c.x)}" y="${r(c.y)}" text-anchor="middle" font-family="system-ui, sans-serif" fill="#1f2933" paint-order="stroke" stroke="${PAPER}" stroke-width="36" stroke-linejoin="round">` +
        `<tspan x="${r(c.x)}" dy="0" font-size="230" font-weight="600">${esc(room.name)}</tspan>` +
        (area ? `<tspan x="${r(c.x)}" dy="280" font-size="180">${area}</tspan>` : '') +
        `</text>`,
    );
  }
  out.push('</g>');

  // Väggmått
  if (opts.showWallLengths) {
    out.push('<g class="wall-dims">');
    for (const w of plan.walls) {
      const len = dist(w.a, w.b);
      if (len < 300) continue;
      const ang = Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x);
      const off = w.thickness / 2 + 130;
      const mid = { x: (w.a.x + w.b.x) / 2 - Math.sin(ang) * off, y: (w.a.y + w.b.y) / 2 + Math.cos(ang) * off };
      const ta = readableAngle((ang * 180) / Math.PI);
      out.push(
        `<text x="${r(mid.x)}" y="${r(mid.y)}" font-size="150" fill="${DIM_COLOR}" text-anchor="middle" dominant-baseline="central" font-family="system-ui, sans-serif" transform="rotate(${r(ta)} ${r(mid.x)} ${r(mid.y)})" paint-order="stroke" stroke="${PAPER}" stroke-width="30">${formatLength(len)}</text>`,
      );
    }
    out.push('</g>');
  }

  // Måttlinjer
  out.push('<g class="dims">');
  for (const d of plan.dims) out.push(`<g data-id="${d.id}">${renderDimension(d)}</g>`);
  out.push('</g>');

  // Texter
  out.push('<g class="labels">');
  for (const l of plan.labels) {
    out.push(
      `<text data-id="${l.id}" x="${r(l.x)}" y="${r(l.y)}" font-size="${l.size}" text-anchor="middle" dominant-baseline="central" fill="#1f2933" font-family="system-ui, sans-serif">${esc(l.text)}</text>`,
    );
  }
  out.push('</g>');

  return out.join('');
}

/** Ungefärliga gränser för allt i planen (mm). */
export function planBounds(plan: Plan) {
  const pts: Vec[] = [];
  for (const w of plan.walls) {
    pts.push(w.a, w.b);
  }
  for (const room of plan.rooms) pts.push(...room.points);
  for (const it of plan.items) {
    const rad = Math.hypot(it.w, it.d) / 2;
    pts.push({ x: it.x - rad, y: it.y - rad }, { x: it.x + rad, y: it.y + rad });
  }
  for (const l of plan.labels) {
    const half = (l.text.length * l.size) / 3.2;
    pts.push({ x: l.x - half, y: l.y - l.size }, { x: l.x + half, y: l.y + l.size });
  }
  for (const d of plan.dims) pts.push(d.a, d.b);
  if (!pts.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}
