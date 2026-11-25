/**
 * Tolkar en bild av en planritning (skannad, fotograferad rakt ovanifrån eller en skärmbild)
 * och gör om den till väggar, dörrar, fönster och rum.
 *
 * Fungerar bäst på ritningar med fyllda, mörka väggar som går rakt (vågrätt/lodrätt).
 * Allt körs i webbläsaren – inget skickas någonstans.
 */
import type { Plan, Vec, Wall, Opening, Room } from './types';
import { uid } from './geometry';

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, 4 byte per pixel */
  data: Uint8ClampedArray | Uint8Array;
}

export interface DetectOptions {
  /** Pixlar mörkare än detta (0–255) räknas som ritade linjer. */
  darkness?: number;
  /** Minsta väggtjocklek i pixlar. Utelämnad = gissas från bilden. */
  minThickness?: number;
}

/** Ett vägg-stycke i bildens pixlar: vågrätt (h) eller lodrätt (v). */
export interface Segment {
  dir: 'h' | 'v';
  /** Mittlinjens läge: y för vågräta, x för lodräta */
  pos: number;
  from: number;
  to: number;
  thickness: number;
}

export interface Detection {
  width: number;
  height: number;
  segments: Segment[];
  /** Typisk väggtjocklek i pixlar */
  wallThickness: number;
  minThickness: number;
  /** Ytterkantens gränser (px) */
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /** Ljushet per pixel (för att känna igen fönster i öppningar) */
  lum: Uint8Array;
}

// ---------------------------------------------------------------------------
// 1. Hitta väggar i pixlarna

export function luminance(px: Pixels): Uint8Array {
  const n = px.width * px.height;
  const out = new Uint8Array(n);
  const d = px.data;
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3] / 255;
    // Genomskinligt räknas som vitt
    const l = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    out[i] = Math.round(l * a + 255 * (1 - a));
  }
  return out;
}

/** För varje mörk pixel: kortaste av vågräta och lodräta sammanhängande längden. 0 för ljusa. */
export function strokeWidth(mask: Uint8Array, w: number, h: number): Uint16Array {
  const hr = new Uint16Array(w * h);
  const out = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!mask[y * w + x]) {
        x++;
        continue;
      }
      let e = x;
      while (e < w && mask[y * w + e]) e++;
      const len = Math.min(e - x, 65535);
      for (let i = x; i < e; i++) hr[y * w + i] = len;
      x = e;
    }
  }
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!mask[y * w + x]) {
        y++;
        continue;
      }
      let e = y;
      while (e < h && mask[e * w + x]) e++;
      const len = Math.min(e - y, 65535);
      for (let i = y; i < e; i++) out[i * w + x] = Math.min(len, hr[i * w + x]);
      y = e;
    }
  }
  return out;
}

/** Gissar väggtjockleken: den tjocklek som flest mörka pixlar har (bortsett från tunna streck och text). */
export function typicalThickness(sw: Uint16Array, maxDim: number): number {
  const lo = Math.max(3, Math.round(maxDim / 400));
  const hist = new Float64Array(200);
  for (let i = 0; i < sw.length; i++) {
    const t = sw[i];
    if (t >= lo && t < 200) hist[t] += 1;
  }
  // Jämna ut lite så att kantutjämning inte ger två toppar
  let best = 0;
  let bestV = 0;
  for (let t = lo; t < 199; t++) {
    const v = hist[t - 1] * 0.5 + hist[t] + hist[t + 1] * 0.5;
    if (v > bestV) {
      bestV = v;
      best = t;
    }
  }
  return best || lo;
}

interface Rect {
  x0: number;
  x1: number; // inklusive
  y0: number;
  y1: number; // inklusive
}

/** Vågräta rektanglar av sammanhängande, lika långa rader. */
function rowRects(mask: Uint8Array, w: number, h: number, minLen: number, tol: number): Rect[] {
  const done: Rect[] = [];
  let active: Rect[] = [];
  for (let y = 0; y < h; y++) {
    const next: Rect[] = [];
    let x = 0;
    while (x < w) {
      if (!mask[y * w + x]) {
        x++;
        continue;
      }
      let e = x;
      while (e < w && mask[y * w + e]) e++;
      if (e - x >= minLen) {
        const x0 = x;
        const x1 = e - 1;
        const i = active.findIndex((r) => Math.abs(r.x0 - x0) <= tol && Math.abs(r.x1 - x1) <= tol);
        if (i >= 0) {
          const r = active[i];
          active.splice(i, 1);
          r.y1 = y;
          // Behåll den vanligaste (inre) utbredningen – kantutjämning ger ofta lite kortare rader
          r.x0 = Math.min(r.x0, x0);
          r.x1 = Math.max(r.x1, x1);
          next.push(r);
        } else next.push({ x0, x1, y0: y, y1: y });
      }
      x = e;
    }
    done.push(...active);
    active = next;
  }
  done.push(...active);
  return done;
}

function transpose(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[x * h + y] = mask[y * w + x];
  return out;
}

export function detectWalls(px: Pixels, opts: DetectOptions = {}): Detection {
  const { width: w, height: h } = px;
  const lum = luminance(px);
  const darkness = opts.darkness ?? 110;
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < lum.length; i++) dark[i] = lum[i] < darkness ? 1 : 0;
  const sw = strokeWidth(dark, w, h);
  const typical = typicalThickness(sw, Math.max(w, h));
  const minT = opts.minThickness ?? Math.max(3, Math.round(typical * 0.35));
  const maxT = Math.max(typical * 3, minT * 4);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < sw.length; i++) mask[i] = sw[i] >= minT ? 1 : 0;

  const minLen = Math.max(minT * 2.5, 6);
  const tol = Math.max(2, Math.round(minT / 2));
  const segments: Segment[] = [];
  const keep = (len: number, thick: number) => thick >= minT * 0.8 && thick <= maxT && len >= Math.max(thick * 1.6, minLen);
  for (const r of rowRects(mask, w, h, minLen, tol)) {
    const thick = r.y1 - r.y0 + 1;
    const len = r.x1 - r.x0 + 1;
    if (keep(len, thick)) segments.push({ dir: 'h', pos: (r.y0 + r.y1 + 1) / 2, from: r.x0, to: r.x1 + 1, thickness: thick });
  }
  const tm = transpose(mask, w, h);
  for (const r of rowRects(tm, h, w, minLen, tol)) {
    // i den transponerade bilden är "x" bildens y
    const thick = r.y1 - r.y0 + 1;
    const len = r.x1 - r.x0 + 1;
    if (keep(len, thick)) segments.push({ dir: 'v', pos: (r.y0 + r.y1 + 1) / 2, from: r.x0, to: r.x1 + 1, thickness: thick });
  }

  const merged = dropLoose(mergeSegments(segments, typical, 0), minT);
  let bounds: Detection['bounds'] = null;
  for (const s of merged) {
    const half = s.thickness / 2;
    const [x0, x1, y0, y1] = s.dir === 'h' ? [s.from, s.to, s.pos - half, s.pos + half] : [s.pos - half, s.pos + half, s.from, s.to];
    bounds = bounds
      ? { minX: Math.min(bounds.minX, x0), minY: Math.min(bounds.minY, y0), maxX: Math.max(bounds.maxX, x1), maxY: Math.max(bounds.maxY, y1) }
      : { minX: x0, minY: y0, maxX: x1, maxY: y1 };
  }
  return { width: w, height: h, segments: merged, wallThickness: typical, minThickness: minT, bounds, lum };
}

/**
 * Korta stycken som inte sitter ihop med någon längre vägg är oftast text, symboler eller möbler.
 */
function dropLoose(segs: Segment[], minT: number): Segment[] {
  const long = (s: Segment) => s.to - s.from >= s.thickness * 5;
  const reach = minT + 2;
  const touches = (s: Segment, o: Segment) => {
    if (o.dir === s.dir) {
      // på samma linje, med högst ett dörr- eller fönsterglapp emellan
      const gap = Math.max(reach, Math.max(o.thickness, s.thickness) * 10);
      return Math.abs(o.pos - s.pos) <= Math.max(o.thickness, s.thickness) / 2 && o.from <= s.to + gap && s.from <= o.to + gap;
    }
    // tvärgående: s:s ände ligger i o, eller o:s ände ligger i s
    const endIn = (a: Segment, b: Segment) =>
      a.pos >= b.from - reach && a.pos <= b.to + reach && (Math.abs(a.from - b.pos) <= b.thickness / 2 + reach || Math.abs(a.to - b.pos) <= b.thickness / 2 + reach);
    return endIn(s, o) || endIn(o, s);
  };
  return segs.filter((s) => long(s) || segs.some((o) => o !== s && long(o) && touches(s, o)));
}

/**
 * Slår ihop stycken som ligger på samma linje och överlappar eller nästan möts (glapp ≤ maxGap),
 * och lägger dem på en gemensam mittlinje.
 */
export function mergeSegments(segs: Segment[], typical: number, maxGap: number): Segment[] {
  const out: Segment[] = [];
  for (const dir of ['h', 'v'] as const) {
    const list = segs.filter((s) => s.dir === dir).sort((a, b) => a.pos - b.pos);
    // Gruppera efter läge (mittlinje)
    const groups: Segment[][] = [];
    for (const s of list) {
      const g = groups.find((g) => {
        const gp = weightedPos(g);
        const gt = Math.max(...g.map((x) => x.thickness));
        return Math.abs(gp - s.pos) <= Math.max(gt, s.thickness, typical) * 0.6;
      });
      if (g) g.push(s);
      else groups.push([s]);
    }
    for (const g of groups) {
      // Inom gruppen: stycken som inte överlappar på längden men ligger på samma linje
      g.sort((a, b) => a.from - b.from);
      let cur: Segment[] = [];
      let end = -Infinity;
      const flush = () => {
        if (!cur.length) return;
        const len = (s: Segment) => s.to - s.from;
        const total = cur.reduce((a, s) => a + len(s), 0);
        out.push({
          dir,
          pos: weightedPos(cur),
          from: Math.min(...cur.map((s) => s.from)),
          to: Math.max(...cur.map((s) => s.to)),
          thickness: cur.reduce((a, s) => a + s.thickness * len(s), 0) / total,
        });
        cur = [];
      };
      for (const s of g) {
        if (cur.length && s.from - end > maxGap) flush();
        cur.push(s);
        end = Math.max(end, s.to);
      }
      flush();
    }
  }
  return out;
}

function weightedPos(g: Segment[]) {
  let a = 0;
  let wsum = 0;
  for (const s of g) {
    const l = s.to - s.from;
    a += s.pos * l;
    wsum += l;
  }
  return a / (wsum || 1);
}

/**
 * Låter väggändar mötas: en ände som ligger i (eller nära) en tvärgående vägg flyttas till dess mittlinje.
 */
export function joinEnds(segs: Segment[], reach: number): Segment[] {
  const res = segs.map((s) => ({ ...s }));
  const hs = res.filter((s) => s.dir === 'h');
  const vs = res.filter((s) => s.dir === 'v');
  const fix = (s: Segment, others: Segment[]) => {
    for (const end of ['from', 'to'] as const) {
      const v = s[end];
      let best: Segment | null = null;
      let bestD = Infinity;
      for (const o of others) {
        // o ligger tvärs: o.pos är koordinat längs s; s.pos måste ligga inom o:s utbredning
        if (s.pos < o.from - reach || s.pos > o.to + reach) continue;
        const d = Math.abs(o.pos - v);
        const lim = o.thickness / 2 + reach;
        if (d <= lim && d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (best) s[end] = best.pos;
    }
  };
  for (const s of hs) fix(s, vs);
  for (const s of vs) fix(s, hs);
  // Tvärgående väggar ska också nå fram till s (t.ex. T-korsningar där ena väggen slutar mitt i den andra)
  return res.filter((s) => s.to - s.from > s.thickness * 0.8);
}

// ---------------------------------------------------------------------------
// 2. Gör om till en plan i millimeter

export interface ToPlanOptions {
  /** Millimeter per pixel */
  mmPerPx: number;
  name?: string;
  rooms?: boolean;
  openings?: boolean;
}

export interface ImportResult {
  plan: Plan;
  /** Var bildens övre vänstra hörn hamnar i planen (mm) */
  origin: Vec;
}

const ROOM_COLORS = ['#f6efe3', '#e8eef7', '#e3f0f2', '#eef3e6', '#f7e9ec', '#efeeea', '#f3ecf7', '#fdf3d8'];

export function detectionToPlan(det: Detection, opts: ToPlanOptions): ImportResult {
  const k = opts.mmPerPx;
  const snap = (v: number) => Math.round(v / 10) * 10;
  const plan: Plan = { id: uid('plan'), name: opts.name ?? 'Plan från bild', walls: [], openings: [], rooms: [], items: [], labels: [], dims: [], updatedAt: Date.now() };
  const b = det.bounds ?? { minX: 0, minY: 0, maxX: det.width, maxY: det.height };
  // Planens nollpunkt i husets övre vänstra hörn
  const origin = { x: -snap(b.minX * k), y: -snap(b.minY * k) };
  const P = (x: number, y: number): Vec => ({ x: snap(x * k) + origin.x, y: snap(y * k) + origin.y });

  // Slå ihop stycken över glapp upp till 3 m (dörrar/fönster), men minns glappen
  const maxGapPx = 3000 / k;
  const minOpenPx = 450 / k;
  const reach = Math.max(det.minThickness, 2);
  const joined = joinEnds(det.segments, reach);
  const lines = extendFreeEnds(mergeWithGaps(joined, det.wallThickness, maxGapPx), maxGapPx, reach);

  for (const ln of lines) {
    const t = Math.min(500, Math.max(50, snap(ln.thickness * k)));
    const a = ln.dir === 'h' ? P(ln.from, ln.pos) : P(ln.pos, ln.from);
    const bb = ln.dir === 'h' ? P(ln.to, ln.pos) : P(ln.pos, ln.to);
    if (Math.hypot(bb.x - a.x, bb.y - a.y) < 200) continue;
    const wall: Wall = { id: uid('w'), a, b: bb, thickness: t };
    plan.walls.push(wall);
    if (opts.openings === false) continue;
    const len = ln.to - ln.from;
    for (const g of ln.gaps) {
      const gw = g.to - g.from;
      if (gw < minOpenPx) continue;
      const widthMm = snap(gw * k);
      const isWindow = gapLooksLikeWindow(det, ln, g);
      const kind: Opening['kind'] = isWindow ? 'window' : widthMm <= 1300 ? 'door' : widthMm <= 2000 ? 'double' : 'opening';
      plan.openings.push({ id: uid('o'), wallId: wall.id, kind, t: ((g.from + g.to) / 2 - ln.from) / len, width: widthMm, flip: false, side: false });
    }
  }

  if (opts.rooms !== false && plan.walls.length) {
    plan.rooms = findRooms(plan);
  }
  return { plan, origin };
}

interface Line extends Segment {
  gaps: { from: number; to: number }[];
}

/** Som mergeSegments, men sparar glappen så att de kan bli öppningar. */
function mergeWithGaps(segs: Segment[], typical: number, maxGap: number): Line[] {
  const merged = mergeSegments(segs, typical, maxGap);
  return merged.map((m) => {
    const parts = segs
      .filter((s) => s.dir === m.dir && Math.abs(s.pos - m.pos) <= Math.max(m.thickness, typical) * 0.6 && s.to > m.from - 1 && s.from < m.to + 1)
      .sort((a, b) => a.from - b.from);
    const gaps: { from: number; to: number }[] = [];
    let end = m.from;
    for (const p of parts) {
      if (p.from > end + 1) gaps.push({ from: end, to: p.from });
      end = Math.max(end, p.to);
    }
    return { ...m, gaps };
  });
}

/**
 * En vägg som slutar en bit från en tvärgående vägg (t.ex. vid en dörr som sitter i hörnet)
 * förlängs fram till den, och glappet blir en öppning.
 */
function extendFreeEnds(lines: Line[], maxGap: number, reach: number): Line[] {
  for (const ln of lines) {
    const others = lines.filter((o) => o.dir !== ln.dir && ln.pos >= o.from - reach && ln.pos <= o.to + reach);
    const joined = (v: number) => others.some((o) => Math.abs(o.pos - v) <= o.thickness / 2 + reach);
    if (!joined(ln.from)) {
      const cand = others.filter((o) => o.pos < ln.from && ln.from - o.pos <= maxGap).sort((a, b) => b.pos - a.pos)[0];
      if (cand) {
        const edge = cand.pos + cand.thickness / 2;
        if (ln.from - edge > 1) ln.gaps.unshift({ from: edge, to: ln.from });
        ln.from = cand.pos;
      }
    }
    if (!joined(ln.to)) {
      const cand = others.filter((o) => o.pos > ln.to && o.pos - ln.to <= maxGap).sort((a, b) => a.pos - b.pos)[0];
      if (cand) {
        const edge = cand.pos - cand.thickness / 2;
        if (edge - ln.to > 1) ln.gaps.push({ from: ln.to, to: edge });
        ln.to = cand.pos;
      }
    }
  }
  return lines;
}

/** Fönster ritas oftast som tunna linjer tvärs över glappet; dörrar lämnar glappet tomt. */
function gapLooksLikeWindow(det: Detection, ln: Segment, g: { from: number; to: number }): boolean {
  const { width: w, lum } = det;
  const half = Math.max(1, Math.floor(ln.thickness / 2));
  const from = Math.ceil(g.from + 1);
  const to = Math.floor(g.to - 1);
  if (to <= from) return false;
  let hits = 0;
  let n = 0;
  for (let u = from; u <= to; u++) {
    let any = false;
    for (let o = -half; o <= half && !any; o++) {
      const x = Math.round(ln.dir === 'h' ? u : ln.pos + o);
      const y = Math.round(ln.dir === 'h' ? ln.pos + o : u);
      if (x < 0 || y < 0 || x >= w || y >= det.height) continue;
      if (lum[y * w + x] < 215) any = true;
    }
    n++;
    if (any) hits++;
  }
  return n > 0 && hits / n > 0.75;
}

// ---------------------------------------------------------------------------
// 3. Rum: slutna ytor mellan väggarna

function findRooms(plan: Plan): Room[] {
  // Rasterisera väggarna (hela, även över dörrar) i ett rutnät om ca 5 cm
  const cell = 50;
  const xs = plan.walls.flatMap((w) => [w.a.x, w.b.x]);
  const ys = plan.walls.flatMap((w) => [w.a.y, w.b.y]);
  const pad = 400;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const W = Math.ceil((Math.max(...xs) + pad - minX) / cell);
  const H = Math.ceil((Math.max(...ys) + pad - minY) / cell);
  if (W * H > 4_000_000) return [];
  const solid = new Uint8Array(W * H);
  for (const wall of plan.walls) {
    const half = wall.thickness / 2;
    const x0 = Math.floor((Math.min(wall.a.x, wall.b.x) - half - minX) / cell);
    const x1 = Math.ceil((Math.max(wall.a.x, wall.b.x) + half - minX) / cell);
    const y0 = Math.floor((Math.min(wall.a.y, wall.b.y) - half - minY) / cell);
    const y1 = Math.ceil((Math.max(wall.a.y, wall.b.y) + half - minY) / cell);
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) solid[y * W + x] = 1;
  }
  const label = new Int32Array(W * H);
  const stack: number[] = [];
  const fill = (start: number, id: number) => {
    let count = 0;
    let touchesEdge = false;
    stack.push(start);
    label[start] = id;
    while (stack.length) {
      const i = stack.pop()!;
      count++;
      const x = i % W;
      const y = (i - x) / W;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touchesEdge = true;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const j of nb) {
        if (j >= 0 && !solid[j] && !label[j]) {
          label[j] = id;
          stack.push(j);
        }
      }
    }
    return { count, touchesEdge };
  };
  const rooms: Room[] = [];
  let id = 0;
  const minCells = 1_000_000 / (cell * cell); // 1 m²
  const coordsX = [...new Set(plan.walls.flatMap((w) => (w.a.x === w.b.x ? [w.a.x] : [])))];
  const coordsY = [...new Set(plan.walls.flatMap((w) => (w.a.y === w.b.y ? [w.a.y] : [])))];
  const lim = Math.max(...plan.walls.map((w) => w.thickness)) / 2 + cell * 2;
  for (let i = 0; i < W * H; i++) {
    if (solid[i] || label[i]) continue;
    id++;
    const { count, touchesEdge } = fill(i, id);
    if (touchesEdge || count < minCells) continue;
    const outline = traceOutline(label, W, H, id);
    if (outline.length < 3) continue;
    // Till mm, och lägg hörnen på väggarnas mittlinjer
    const pts = simplify(
      outline.map((p) => ({ x: snapTo(p.x * cell + minX, coordsX, lim), y: snapTo(p.y * cell + minY, coordsY, lim) })),
    );
    if (pts.length < 3) continue;
    rooms.push({ id: uid('r'), name: `Rum ${rooms.length + 1}`, points: pts, color: ROOM_COLORS[rooms.length % ROOM_COLORS.length] });
  }
  return rooms;
}

function snapTo(v: number, list: number[], lim: number) {
  let best = Math.round(v / 10) * 10;
  let bd = lim;
  for (const c of list) {
    const d = Math.abs(c - v);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/** Ytterkonturen av ett område i rutnätet, längs cellernas kanter (hörn i cellkoordinater). */
export function traceOutline(label: Int32Array, W: number, H: number, id: number): Vec[] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && label[y * W + x] === id;
  // Startcell: översta vänstra
  let sx = -1;
  let sy = -1;
  for (let i = 0; i < W * H; i++) {
    if (label[i] === id) {
      sx = i % W;
      sy = (i - sx) / W;
      break;
    }
  }
  if (sx < 0) return [];
  // Gå längs kanterna med området på höger sida. Riktningar: 0=höger,1=ned,2=vänster,3=upp
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  let x = sx;
  let y = sy; // hörnpunkt (övre vänstra hörnet av startcellen)
  let dir = 0;
  const pts: Vec[] = [{ x, y }];
  const start = { x, y };
  for (let guard = 0; guard < 4 * (W + H) * 50; guard++) {
    // Celler till höger fram (R) och vänster fram (L) relativt rörelsen
    const cellAt = (d: number, side: 'L' | 'R') => {
      // För hörnpunkt (x,y) och riktning d: cellen framåt-höger resp. framåt-vänster
      switch (d) {
        case 0:
          return side === 'R' ? inside(x, y) : inside(x, y - 1);
        case 1:
          return side === 'R' ? inside(x - 1, y) : inside(x, y);
        case 2:
          return side === 'R' ? inside(x - 1, y - 1) : inside(x - 1, y);
        default:
          return side === 'R' ? inside(x, y - 1) : inside(x - 1, y - 1);
      }
    };
    const R = cellAt(dir, 'R');
    const L = cellAt(dir, 'L');
    let nd: number;
    if (L) nd = (dir + 3) % 4; // sväng vänster
    else if (R) nd = dir; // rakt fram
    else nd = (dir + 1) % 4; // sväng höger
    if (nd !== dir) {
      pts.push({ x, y });
      dir = nd;
      if (x === start.x && y === start.y && dir === 0) break;
      continue;
    }
    x += DX[dir];
    y += DY[dir];
    if (x === start.x && y === start.y && dir === 0) break;
  }
  return pts;
}

/** Tar bort dubbletter och punkter som ligger på en rak linje. */
function simplify(pts: Vec[]): Vec[] {
  let out = pts.filter((p, i) => {
    const q = pts[(i + pts.length - 1) % pts.length];
    return Math.abs(p.x - q.x) > 0.5 || Math.abs(p.y - q.y) > 0.5;
  });
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const same = Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
      if (same || Math.abs(cross) < 1) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  // Små hack (under 15 cm) i konturen rätas ut
  out = straighten(out, 150);
  return out;
}

function straighten(pts: Vec[], lim: number): Vec[] {
  let out = pts.slice();
  for (let pass = 0; pass < 4 && out.length > 4; pass++) {
    let changed = false;
    for (let i = 0; i < out.length && out.length > 4; i++) {
      const a = out[i];
      const b = out[(i + 1) % out.length];
      if (Math.hypot(b.x - a.x, b.y - a.y) < lim) {
        // Ta bort det korta stycket genom att flytta grannarna till samma linje
        const prev = out[(i + out.length - 1) % out.length];
        const next = out[(i + 2) % out.length];
        if (Math.abs(prev.y - a.y) < 0.5 && Math.abs(b.y - next.y) < 0.5) {
          // vågräta grannar → lägg b:s linje på a:s
          next.y = a.y;
        } else if (Math.abs(prev.x - a.x) < 0.5 && Math.abs(b.x - next.x) < 0.5) {
          next.x = a.x;
        } else continue;
        out.splice((i + 1) % out.length, 1);
        changed = true;
        break;
      }
    }
    if (!changed) break;
    out = simplifyCollinear(out);
  }
  return out;
}

function simplifyCollinear(pts: Vec[]): Vec[] {
  const out = pts.slice();
  for (let i = 0; i < out.length && out.length > 3; ) {
    const a = out[(i + out.length - 1) % out.length];
    const b = out[i];
    const c = out[(i + 1) % out.length];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) < 1 || (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5)) out.splice(i, 1);
    else i++;
  }
  return out;
}

// ---------------------------------------------------------------------------

/** Mått per pixel uppskattat från ytterväggarnas tjocklek (om användaren inte anger något mått). */
export function guessMmPerPx(det: Detection): number {
  const outer = Math.max(det.wallThickness, ...det.segments.map((s) => s.thickness));
  return 250 / Math.max(1, outer);
}
