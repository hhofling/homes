/**
 * Exempel: Högbovägen 333, Lillsjön, Högbo (Sandvikens kommun).
 *
 * Fritidshus från tidigt 1900-tal, ca 75 m² på två plan, med uterum mot sjön, strandtomt 1 830 m².
 * Planerna är ritade efter mäklarens egenritade planritningar i försäljningsannonsen (2023), som
 * saknar mått. Måtten är därför uppskattade utifrån proportionerna i ritningen (yttermått ca 6,35 × 8,4 m
 * plus uterum ca 3 m djupt). Tomtens form och byggnadernas placering är grova uppskattningar.
 */
import type { Item, Opening, Plan, Vec, Wall } from '../types';
import { emptyPlan } from '../store';
import { furnitureDef } from '../furniture';
import type { Site } from '../tomt/types';
import { emptySite } from '../tomt/store';
import { newArea, newBuilding, newLine, newPlant } from '../tomt/catalog';

export const EXAMPLE_ID = 'hogbovagen333';
export const EXAMPLE_NAME = 'Högbovägen 333, Sandviken';

/** Yttermått för huvudbyggnaden (utan uterum) */
export const HOUSE_W = 6350;
export const HOUSE_D = 8400;
/** Uterummets djup (yttermått) */
export const UTERUM_D = 3050;

const OUT = 200; // yttervägg
const IN = 100; // innervägg
const L = OUT / 2; // väggens mittlinje: vänster/överkant
const R = HOUSE_W - OUT / 2; // höger
const B = HOUSE_D - OUT / 2; // nederkant

/** Litet ritverktyg som gör det lätt att beskriva en plan med fasta id:n. */
function builder(p: Plan, prefix: string) {
  let n = 0;
  const id = (k: string) => `${prefix}-${k}${++n}`;
  const wall = (ax: number, ay: number, bx: number, by: number, thickness = IN): Wall => {
    const w = { id: id('w'), a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness };
    p.walls.push(w);
    return w;
  };
  /** Öppning centrerad vid en koordinat längs väggen (x för vågräta, y för lodräta väggar). */
  const open = (w: Wall, kind: Opening['kind'], at: number, width: number, flip = false, side = false) => {
    const horiz = Math.abs(w.b.x - w.a.x) > Math.abs(w.b.y - w.a.y);
    const [a, b] = horiz ? [w.a.x, w.b.x] : [w.a.y, w.b.y];
    p.openings.push({ id: id('o'), wallId: w.id, kind, t: (at - a) / (b - a), width, flip, side });
  };
  const room = (name: string, color: string, pts: [number, number][]) =>
    p.rooms.push({ id: id('r'), name, color, points: pts.map(([x, y]): Vec => ({ x, y })) });
  const item = (type: string, x: number, y: number, rotation = 0, extra: Partial<Item> = {}) => {
    const def = furnitureDef(type);
    p.items.push({ id: id('i'), type, x, y, w: def.w, d: def.d, rotation, color: def.color, ...extra });
  };
  const label = (text: string, x: number, y: number, size = 220) => p.labels.push({ id: id('l'), text, x, y, size });
  const dim = (ax: number, ay: number, bx: number, by: number) => p.dims.push({ id: id('d'), a: { x: ax, y: ay }, b: { x: bx, y: by } });
  return { wall, open, room, item, label, dim };
}

/**
 * Bottenvåningen. Med uterum: så som den ser ut i annonsen. Utan uterum: bara huvudbyggnaden,
 * som används för huset i Tomtplaneraren (där uterummet är en egen, lägre byggnad).
 */
export function groundFloor(withUterum = true): Plan {
  const p = emptyPlan(withUterum ? 'Högbovägen 333 – bottenvåning' : 'Högbovägen 333 – bottenvåning (huset)');
  p.id = withUterum ? 'plan-hogbo333-bv' : 'plan-hogbo333-bv-hus';
  const { wall, open, room, item, label, dim } = builder(p, withUterum ? 'hb' : 'hh');

  // Ytterväggar. Entrén ligger indragen i sydvästra hörnet.
  const north = wall(L, L, R, L, OUT);
  const east = wall(R, L, R, B, OUT);
  const south = wall(R, B, 1420, B, OUT);
  const entry = wall(1420, B, 1420, 7050, OUT);
  wall(1420, 7050, L, 7050, OUT);
  const west = wall(L, 7050, L, L, OUT);

  // Innerväggar
  wall(L, 3600, 1750, 3600); // trappa / vardagsrum
  wall(3000, 3600, R, 3600); // vardagsrum / kök
  const hallKok = wall(3250, 3600, 3250, B); // hall / kök
  wall(1420, 4530, 1420, 5250); // vid trappan
  wall(L, 5250, 1420, 5250); // trappa / wc
  const wcWall = wall(1420, 5250, 1420, 7050); // wc / hall

  // Dörrar, öppningar och fönster
  open(entry, 'door', 7650, 900, false, true);
  open(wcWall, 'door', 6450, 700, true, true);
  open(hallKok, 'opening', 6700, 800);
  open(west, 'window', 1650, 950);
  open(east, 'window', 1750, 1000);
  open(east, 'window', 5850, 1100);
  open(south, 'window', 4880, 750);
  open(south, 'window', 2360, 550);

  room('Vardagsrum', '#f6efe3', [[L, L], [R, L], [R, 3600], [L, 3600]]);
  room('Kök', '#fbf3dc', [[3250, 3600], [R, 3600], [R, B], [3250, B]]);
  room('Hall', '#efeeea', [[L, 3600], [3250, 3600], [3250, B], [1420, B], [1420, 5250], [L, 5250]]);
  room('WC', '#e3f0f2', [[L, 5250], [1420, 5250], [1420, 7050], [L, 7050]]);

  // Inredning efter ritningen
  item('box', 3755, 3830, 0, { w: 1060, d: 560, color: '#3f4650', label: 'Murstock' });
  item('box', 3750, 3220, 0, { w: 1000, d: 650, color: '#d9d2c5', label: 'Öppen spis' });
  item('stove', 4860, 3950, 0, { w: 550 });
  item('fridge', 5400, 3970, 0, { w: 500, label: 'Kyl' });
  item('fridge', 5935, 3970, 0, { w: 530, label: 'Frys' });
  item('counter', 3550, 5150, 270, { w: 2100, d: 500 });
  item('kitchen-sink', 3550, 5520, 270, { w: 600, d: 500 });
  item('box', 4000, 7650, 0, { w: 1300, d: 600, color: '#e6e8eb', label: 'Bänk' });
  item('round-table', 5200, 6300);
  item('chair', 5200, 5650, 0);
  item('chair', 5200, 6950, 180);
  item('stairs', 760, 4420, 180, { w: 1200, d: 1600 });
  item('toilet', 760, 5650, 0);
  item('basin', 400, 6400, 270);
  item('sofa-3', 1700, 650, 0);
  item('coffee-table', 1700, 1700);
  item('armchair', 4800, 1500, 90);
  item('armchair', 4800, 2500, 90);

  if (withUterum) {
    const UT = 120;
    const top = -UTERUM_D + UT / 2;
    const ut = wall(L, top, R, top, UT);
    const utE = wall(R, top, R, L, UT);
    const utW = wall(L, L, L, top, UT);
    open(north, 'double', 3110, 1300, false, true);
    for (const x of [900, 2200, 3900, 5400]) open(ut, 'window', x, 1200);
    open(utW, 'window', -2200, 1300);
    open(utE, 'window', -720, 1350);
    room('Uterum', '#eef3e6', [[L, top], [R, top], [R, L], [L, L]]);
    item('dining-table', 3100, -1500, 0, { w: 2200, d: 900 });
    for (const x of [2400, 3100, 3800]) {
      item('chair', x, -2200, 0);
      item('chair', x, -800, 180);
    }
    label('Högbovägen 333 – bottenvåning', HOUSE_W / 2, -UTERUM_D - 900, 260);
    dim(0, -UTERUM_D - 400, HOUSE_W, -UTERUM_D - 400);
    dim(HOUSE_W + 600, -UTERUM_D, HOUSE_W + 600, HOUSE_D);
    label('Mått uppskattade från mäklarens planritning', HOUSE_W / 2, HOUSE_D + 1500, 160);
  } else {
    open(north, 'double', 3110, 1300, false, true);
    dim(0, HOUSE_D + 800, HOUSE_W, HOUSE_D + 800);
    dim(-800, 0, -800, HOUSE_D);
  }
  p.items.sort((a, b) => (a.type === 'rug' ? -1 : b.type === 'rug' ? 1 : 0));
  return p;
}

/** Övervåningen med tre sovrum. */
export function upperFloor(): Plan {
  const p = emptyPlan('Högbovägen 333 – övervåning');
  p.id = 'plan-hogbo333-ov';
  const { wall, open, room, item, label, dim } = builder(p, 'ho');

  const north = wall(L, L, R, L, OUT);
  wall(R, L, R, B, OUT);
  const south = wall(R, B, L, B, OUT);
  wall(L, B, L, L, OUT);

  const mid = wall(3110, L, 3110, B);
  const nw = wall(L, 3250, 3110, 3250);
  const forrad = wall(1930, 3250, 1930, 4700);
  wall(L, 4700, 1930, 4700);
  wall(3110, 4200, R, 4200);
  const g = wall(5420, 4200, 5420, 5100);
  wall(5420, 5100, R, 5100);

  open(mid, 'door', 3640, 700, false, true);
  open(mid, 'door', 6420, 700, true, true);
  open(nw, 'door', 2500, 750, false, false);
  open(forrad, 'door', 4000, 600, false, false);
  open(g, 'door', 4650, 600, false, true);
  open(north, 'window', 1480, 750);
  open(north, 'window', 4670, 750);
  open(south, 'window', 2360, 700);
  open(south, 'window', 4700, 750);

  room('Sovrum', '#e8eef7', [[L, L], [3110, L], [3110, 3250], [L, 3250]]);
  room('Sovrum', '#e8eef7', [[3110, L], [R, L], [R, 4200], [3110, 4200]]);
  room('Förråd', '#eceae4', [[L, 3250], [1930, 3250], [1930, 4700], [L, 4700]]);
  room('Hall', '#efeeea', [[1930, 3250], [3110, 3250], [3110, B], [L, B], [L, 4700], [1930, 4700]]);
  room('Sovrum', '#e8eef7', [[3110, 4200], [5420, 4200], [5420, 5100], [R, 5100], [R, B], [3110, B]]);
  room('G', '#eceae4', [[5420, 4200], [R, 4200], [R, 5100], [5420, 5100]]);

  item('stairs', 880, 5470, 180, { w: 1450, d: 1450 });
  item('box', 3450, 4530, 0, { w: 560, d: 560, color: '#f4f1ea', label: 'Kakelugn' });
  item('basin', 3400, 5400, 270);
  item('bed-double', 1600, 1250, 0);
  item('bed-single', 3750, 1300, 0);
  item('bed-single', 5600, 1300, 0);
  item('bed-double', 4700, 7200, 180);

  label('Högbovägen 333 – övervåning', HOUSE_W / 2, -900, 260);
  dim(0, -400, HOUSE_W, -400);
  dim(HOUSE_W + 600, 0, HOUSE_W + 600, HOUSE_D);
  label('Mått uppskattade från mäklarens planritning', HOUSE_W / 2, HOUSE_D + 900, 160);
  return p;
}

/** Planerna som läggs till i Planritaren. */
export const examplePlans = (): Plan[] => [groundFloor(true), upperFloor()];

/**
 * Tomten: strandtomt ca 1 830 m² med sjön (Lillsjön) i väster.
 * Huvudbyggnaden ligger med uterummet mot sjön. Placeringen av gäststugor, bod och brygga är uppskattad.
 */
export function exampleSite(): Site {
  const s = emptySite(`${EXAMPLE_NAME} (uppskattad)`);
  s.id = 'site-hogbo333';
  // Ca 38,5 × 47,5 m ≈ 1 830 m². Sjön i väster (vänster), Högbovägen i öster.
  s.plot = [
    { x: 0, y: 0 },
    { x: 47000, y: 0 },
    { x: 50000, y: 38500 },
    { x: 2000, y: 38500 },
  ];
  const hx = 15000;
  const hy = 18000;
  const house = newBuilding('house', hx, hy, HOUSE_W, HOUSE_D, 270);
  Object.assign(house, {
    id: 'b-hogbo333-hus',
    name: 'Huvudbyggnad',
    floors: 2,
    floorHeight: 2450,
    pitch: 38,
    roof: 'gable',
    ridge: 'long',
    wallColor: '#9b2f27',
    roofColor: '#3a3d42',
    foundation: 'crawl',
    planId: 'plan-hogbo333-bv-hus',
  });
  // Uterummet ligger mot sjön (väster om huset när huset är vridet 270°)
  const uterum = newBuilding('attefall', hx - HOUSE_D / 2 - UTERUM_D / 2, hy, HOUSE_W, UTERUM_D, 270);
  Object.assign(uterum, { id: 'b-hogbo333-uterum', name: 'Uterum', floorHeight: 2400, roof: 'shed', pitch: 10, wallColor: '#f2efe8', roofColor: '#3a3d42', foundation: 'plinth' });
  const stuga = newBuilding('attefall', 28000, 8000, 6000, 5000, 0);
  Object.assign(stuga, { id: 'b-hogbo333-stuga', name: 'Gäststuga ca 30 m² (vinterisolerad)', wallColor: '#9b2f27', roofColor: '#3a3d42', pitch: 27 });
  const gast1 = newBuilding('friggebod', 9000, 31500, 4500, 3200, 0);
  Object.assign(gast1, { id: 'b-hogbo333-gast1', name: 'Gästhus 1', wallColor: '#9b2f27' });
  const gast2 = newBuilding('friggebod', 17000, 32000, 4000, 3000, 0);
  Object.assign(gast2, { id: 'b-hogbo333-gast2', name: 'Gästhus 2', wallColor: '#9b2f27' });
  const garage = newBuilding('garage', 40000, 28000, 4000, 5500, 0);
  Object.assign(garage, { id: 'b-hogbo333-garage', name: 'Garage/bod', wallColor: '#9b2f27', pitch: 20 });
  s.buildings.push(house, uterum, stuga, gast1, gast2, garage);

  const brygga = newArea('deck', 1500, 16000, 9000, 1800);
  Object.assign(brygga, { id: 'a-hogbo333-brygga', name: 'Brygga (ut i sjön)', height: 300 });
  const uteplats = newArea('deck', 27000, 16500, 6000, 4000);
  Object.assign(uteplats, { id: 'a-hogbo333-uteplats', name: 'Uteplats med pergola', height: 200 });
  const stugUteplats = newArea('patio', 28000, 12300, 4000, 2500);
  Object.assign(stugUteplats, { id: 'a-hogbo333-stuguteplats', name: 'Gäststugans uteplats' });
  const infart = newArea('driveway', 42000, 20000, 6000, 10000);
  Object.assign(infart, { id: 'a-hogbo333-infart', name: 'Infart från Högbovägen', color: '#b8ad98' });
  s.areas.push(brygga, uteplats, stugUteplats, infart);

  s.lines.push(
    Object.assign(newLine('path', [{ x: 42000, y: 20000 }, { x: 31000, y: 19000 }, { x: 19800, y: 18000 }]), { id: 'l-hogbo333-gang' }),
    Object.assign(newLine('path', [{ x: 10200, y: 21500 }, { x: 6000, y: 17000 }]), { id: 'l-hogbo333-strand', name: 'Gång till bryggan' }),
  );
  const trees: [Parameters<typeof newPlant>[0], number, number][] = [
    ['pine', 3000, 4000], ['pine', 6000, 9000], ['tree', 4000, 26000], ['pine', 12000, 4000], ['tree', 20000, 6500],
    ['pine', 24000, 27000], ['pine', 33000, 32000], ['tree', 36000, 6000], ['pine', 44000, 4000], ['pine', 46000, 34000],
    ['tree', 3500, 34000], ['bush', 21000, 23500], ['bush', 9000, 13500], ['pine', 30000, 24500],
  ];
  trees.forEach(([kind, x, y], i) => s.plants.push({ ...newPlant(kind, x, y), id: `p-hogbo333-${i}` }));
  s.plans = [groundFloor(false)];
  return s;
}
