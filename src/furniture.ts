/**
 * Möbelbibliotek. Varje symbol ritas centrerad kring origo i en ruta w × d (mm),
 * där -d/2 är "baksidan" (mot väggen) och +d/2 är framsidan.
 */
export interface FurnitureDef {
  type: string;
  name: string;
  category: string;
  w: number;
  d: number;
  color: string;
  /** rot = möbelns rotation, så att text kan hållas rättvänd */
  draw: (w: number, d: number, color: string, rot?: number) => string;
}

const LINE = '#3b4652';
const sw = 'stroke-width="1.2" vector-effect="non-scaling-stroke"';
const st = `stroke="${LINE}" ${sw}`;
const thin = `stroke="${LINE}" stroke-width="0.8" vector-effect="non-scaling-stroke"`;

const rect = (x: number, y: number, w: number, h: number, fill: string, r = 0, extra = st) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" ${extra}/>`;
const line = (x1: number, y1: number, x2: number, y2: number, extra = thin) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${extra}/>`;
const circle = (cx: number, cy: number, r: number, fill: string, extra = st) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${extra}/>`;
const ellipse = (cx: number, cy: number, rx: number, ry: number, fill: string, extra = st) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" ${extra}/>`;
const base = (w: number, d: number, c: string, r = 0) => rect(-w / 2, -d / 2, w, d, c, r);
const txt = (s: string, size: number, rot = 0) =>
  `<text x="0" y="0" transform="rotate(${-rot})" font-size="${size}" text-anchor="middle" dominant-baseline="central" fill="${LINE}" font-family="system-ui, sans-serif">${s}</text>`;

const bed = (w: number, d: number, c: string) => {
  const pillows = w >= 1200 ? 2 : 1;
  const pw = (w - 120) / pillows - 40 * (pillows - 1);
  let s = base(w, d, c, 30);
  for (let i = 0; i < pillows; i++) {
    s += rect(-w / 2 + 60 + i * (pw + 80), -d / 2 + 60, pw, Math.min(380, d * 0.2), '#ffffff', 40, thin);
  }
  s += rect(-w / 2, -d / 2 + d * 0.32, w, d * 0.68, 'rgba(255,255,255,0.35)', 30, thin);
  s += line(-w / 2, -d / 2 + d * 0.42, w / 2, -d / 2 + d * 0.42);
  return s;
};

const sofa = (w: number, d: number, c: string) => {
  const back = d * 0.25;
  const arm = Math.min(220, w * 0.12);
  let s = base(w, d, c, 60);
  s += rect(-w / 2, -d / 2, w, back, 'rgba(0,0,0,0.08)', 50, thin);
  s += rect(-w / 2, -d / 2, arm, d, 'rgba(0,0,0,0.08)', 50, thin);
  s += rect(w / 2 - arm, -d / 2, arm, d, 'rgba(0,0,0,0.08)', 50, thin);
  const seats = Math.max(1, Math.round((w - 2 * arm) / 650));
  const cw = (w - 2 * arm) / seats;
  for (let i = 1; i < seats; i++) s += line(-w / 2 + arm + i * cw, -d / 2 + back, -w / 2 + arm + i * cw, d / 2 - 30);
  return s;
};

const chair = (w: number, d: number, c: string) =>
  base(w, d, c, 60) + rect(-w / 2 + 20, -d / 2, w - 40, d * 0.18, 'rgba(0,0,0,0.12)', 30, thin);

const cabinet = (w: number, d: number, c: string) =>
  base(w, d, c, 6) + line(-w / 2, d / 2 - 40, w / 2, d / 2 - 40);

const wardrobe = (w: number, d: number, c: string) => {
  let s = base(w, d, c, 6);
  const doors = Math.max(1, Math.round(w / 500));
  for (let i = 1; i < doors; i++) s += line(-w / 2 + (i * w) / doors, -d / 2, -w / 2 + (i * w) / doors, d / 2);
  s += line(-w / 2 + 40, 0, w / 2 - 40, 0, `stroke="${LINE}" stroke-width="0.8" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"`);
  return s;
};

const shelf = (w: number, d: number, c: string) => {
  let s = base(w, d, c, 4);
  const n = Math.max(1, Math.round(w / 400));
  for (let i = 1; i < n; i++) s += line(-w / 2 + (i * w) / n, -d / 2, -w / 2 + (i * w) / n, d / 2);
  return s;
};

const stove = (w: number, d: number, c: string) => {
  const r = Math.min(w, d) * 0.15;
  let s = base(w, d, c, 6);
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) s += circle((x * w) / 4.5, (y * d) / 4.5, r, 'none', thin);
  return s;
};

const sink = (w: number, d: number, c: string) =>
  base(w, d, c, 6) + rect(-w / 2 + 60, -d / 2 + 70, w - 120, d - 140, '#ffffff', 60, thin) + circle(0, -d / 2 + 110, 18, LINE, thin);

const basin = (w: number, d: number, c: string) =>
  base(w, d, c, 40) + ellipse(0, d * 0.05, w * 0.36, d * 0.32, '#ffffff', thin) + circle(0, -d / 2 + 70, 16, LINE, thin);

const toilet = (w: number, d: number, c: string) =>
  rect(-w / 2, -d / 2, w, d * 0.28, c, 20) + ellipse(0, d * 0.12, w * 0.45, d * 0.36, c);

const bathtub = (w: number, d: number, c: string) =>
  base(w, d, c, 40) + rect(-w / 2 + 70, -d / 2 + 70, w - 140, d - 140, '#ffffff', Math.min(w, d) * 0.3, thin) + circle(-w / 2 + 170, 0, 22, 'none', thin);

const shower = (w: number, d: number, c: string) =>
  base(w, d, c, 6) + line(-w / 2, -d / 2, w / 2, d / 2) + line(w / 2, -d / 2, -w / 2, d / 2) + circle(0, 0, 40, '#ffffff', thin);

const washer = (w: number, d: number, c: string) =>
  base(w, d, c, 20) + circle(0, d * 0.05, Math.min(w, d) * 0.32, '#ffffff', thin) + line(-w / 2, -d / 2 + 90, w / 2, -d / 2 + 90);

const labelled = (label: string) => (w: number, d: number, c: string, rot = 0) =>
  base(w, d, c, 6) + txt(label, Math.min(w, d) * 0.28, rot);

const table = (w: number, d: number, c: string) => base(w, d, c, 20);
const roundTable = (w: number, d: number, c: string) => ellipse(0, 0, w / 2, d / 2, c);

const rug = (w: number, d: number, c: string) =>
  base(w, d, c, 20) + rect(-w / 2 + 80, -d / 2 + 80, w - 160, d - 160, 'none', 10, `stroke="${LINE}" stroke-width="0.8" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"`);

const plant = (w: number, d: number, c: string) => {
  const r = Math.min(w, d) / 2;
  let s = circle(0, 0, r, c);
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    s += ellipse(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, r * 0.38, r * 0.2, 'rgba(255,255,255,0.25)', thin).replace(
      '/>',
      ` transform="rotate(${(a * 180) / Math.PI} ${Math.cos(a) * r * 0.45} ${Math.sin(a) * r * 0.45})"/>`,
    );
  }
  return s;
};

const officeChair = (w: number, d: number, c: string) =>
  circle(0, d * 0.05, Math.min(w, d) * 0.4, c) + rect(-w * 0.35, -d / 2, w * 0.7, d * 0.18, c, 30);

const stairs = (w: number, d: number, c: string) => {
  let s = base(w, d, c, 0);
  const steps = Math.max(2, Math.round(d / 250));
  for (let i = 1; i < steps; i++) s += line(-w / 2, -d / 2 + (i * d) / steps, w / 2, -d / 2 + (i * d) / steps);
  s += line(0, d / 2 - 60, 0, -d / 2 + 80, `stroke="${LINE}" ${sw}`);
  s += `<path d="M ${-60} ${-d / 2 + 180} L 0 ${-d / 2 + 80} L 60 ${-d / 2 + 180}" fill="none" stroke="${LINE}" ${sw}/>`;
  return s;
};

const tvBench = (w: number, d: number, c: string) =>
  base(w, d, c, 6) + rect(-w * 0.4, -d / 2 - 10, w * 0.8, 40, '#2b3440', 4, thin);

const desk = (w: number, d: number, c: string) => base(w, d, c, 8) + line(-w / 2 + 40, -d / 2 + 40, w / 2 - 40, -d / 2 + 40);

export const FURNITURE: FurnitureDef[] = [
  // Sovrum
  { type: 'bed-double', name: 'Dubbelsäng', category: 'Sovrum', w: 1600, d: 2000, color: '#dfe7f2', draw: bed },
  { type: 'bed-single', name: 'Enkelsäng', category: 'Sovrum', w: 900, d: 2000, color: '#dfe7f2', draw: bed },
  { type: 'nightstand', name: 'Nattduksbord', category: 'Sovrum', w: 450, d: 400, color: '#e9dcc9', draw: cabinet },
  { type: 'wardrobe', name: 'Garderob', category: 'Sovrum', w: 1000, d: 600, color: '#efe6d8', draw: wardrobe },
  { type: 'dresser', name: 'Byrå', category: 'Sovrum', w: 800, d: 450, color: '#e9dcc9', draw: cabinet },
  // Vardagsrum
  { type: 'sofa-3', name: 'Soffa 3-sits', category: 'Vardagsrum', w: 2100, d: 900, color: '#c9d6c4', draw: sofa },
  { type: 'sofa-2', name: 'Soffa 2-sits', category: 'Vardagsrum', w: 1600, d: 900, color: '#c9d6c4', draw: sofa },
  { type: 'armchair', name: 'Fåtölj', category: 'Vardagsrum', w: 800, d: 800, color: '#c9d6c4', draw: sofa },
  { type: 'coffee-table', name: 'Soffbord', category: 'Vardagsrum', w: 1200, d: 600, color: '#e9dcc9', draw: table },
  { type: 'tv-bench', name: 'TV-bänk', category: 'Vardagsrum', w: 1800, d: 400, color: '#e9dcc9', draw: tvBench },
  { type: 'bookshelf', name: 'Bokhylla', category: 'Vardagsrum', w: 800, d: 300, color: '#e9dcc9', draw: shelf },
  { type: 'rug', name: 'Matta', category: 'Vardagsrum', w: 2000, d: 3000, color: '#f3ead7', draw: rug },
  // Kök & matplats
  { type: 'dining-table', name: 'Matbord', category: 'Kök & matplats', w: 1800, d: 900, color: '#e9dcc9', draw: table },
  { type: 'round-table', name: 'Runt bord', category: 'Kök & matplats', w: 1100, d: 1100, color: '#e9dcc9', draw: roundTable },
  { type: 'chair', name: 'Stol', category: 'Kök & matplats', w: 450, d: 500, color: '#efe6d8', draw: chair },
  { type: 'counter', name: 'Bänkskåp', category: 'Kök & matplats', w: 600, d: 600, color: '#f1f3f5', draw: cabinet },
  { type: 'stove', name: 'Spis', category: 'Kök & matplats', w: 600, d: 600, color: '#f1f3f5', draw: stove },
  { type: 'kitchen-sink', name: 'Diskbänk', category: 'Kök & matplats', w: 800, d: 600, color: '#f1f3f5', draw: sink },
  { type: 'fridge', name: 'Kyl/frys', category: 'Kök & matplats', w: 600, d: 650, color: '#f1f3f5', draw: labelled('KF') },
  { type: 'dishwasher', name: 'Diskmaskin', category: 'Kök & matplats', w: 600, d: 600, color: '#f1f3f5', draw: labelled('DM') },
  // Badrum
  { type: 'toilet', name: 'Toalett', category: 'Badrum', w: 400, d: 650, color: '#ffffff', draw: toilet },
  { type: 'basin', name: 'Handfat', category: 'Badrum', w: 600, d: 450, color: '#ffffff', draw: basin },
  { type: 'bathtub', name: 'Badkar', category: 'Badrum', w: 1700, d: 750, color: '#ffffff', draw: bathtub },
  { type: 'shower', name: 'Dusch', category: 'Badrum', w: 900, d: 900, color: '#eef4f8', draw: shower },
  { type: 'washer', name: 'Tvättmaskin', category: 'Badrum', w: 600, d: 600, color: '#ffffff', draw: washer },
  // Övrigt
  { type: 'desk', name: 'Skrivbord', category: 'Övrigt', w: 1400, d: 700, color: '#e9dcc9', draw: desk },
  { type: 'office-chair', name: 'Kontorsstol', category: 'Övrigt', w: 600, d: 600, color: '#d5d9de', draw: officeChair },
  { type: 'plant', name: 'Växt', category: 'Övrigt', w: 500, d: 500, color: '#a9c9a0', draw: plant },
  { type: 'stairs', name: 'Trappa', category: 'Övrigt', w: 1000, d: 3000, color: '#f1f3f5', draw: stairs },
  { type: 'box', name: 'Fri form (låda)', category: 'Övrigt', w: 1000, d: 1000, color: '#e6e8eb', draw: table },
];

export const FURNITURE_BY_TYPE = new Map(FURNITURE.map((f) => [f.type, f]));

export function furnitureDef(type: string): FurnitureDef {
  return FURNITURE_BY_TYPE.get(type) ?? FURNITURE[FURNITURE.length - 1];
}
