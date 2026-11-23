import { uid } from '../geometry';
import { PHASES, wallArea } from './calc';
import type { Checklist, Material, ProjectRoom, Task, Who } from './types';

/** Mått som en mall räknar med. */
export interface Dimensions {
  area: number;
  perimeter: number;
  height: number;
}

type TaskSpec = Partial<Task> & { name: string; phase: string; trade: string; who: Who; hours: number };
type MatSpec = Partial<Material> & { name: string; qty: number; unit: string; price: number; category: string };

export interface Template {
  id: string;
  name: string;
  description: string;
  build: (d: Dimensions) => { task: TaskSpec; materials: MatSpec[] }[];
}

const r1 = (n: number) => Math.max(0, Math.round(n * 10) / 10);
const up = (n: number) => Math.max(1, Math.ceil(n));

// Priserna är ungefärliga riktpriser och ska justeras efter butik och val.
export const TEMPLATES: Template[] = [
  {
    id: 'paint',
    name: 'Måla om ett rum',
    description: 'Spackla, slipa och måla väggar och tak (två strykningar).',
    build: (d) => {
      const wa = wallArea(d);
      return [
        {
          task: { name: 'Flytta möbler, skydda golv och tejpa', phase: 'Planering & tillstånd', trade: 'Målare', who: 'self', hours: r1(1 + d.area * 0.1) },
          materials: [
            { name: 'Täckpapp', qty: r1(d.area), unit: 'm²', price: 15, waste: 10, category: 'Verktyg & förbrukning' },
            { name: 'Målartejp', qty: up(d.perimeter / 20), unit: 'rulle', price: 60, category: 'Verktyg & förbrukning' },
          ],
        },
        {
          task: { name: 'Spackla och slipa väggar', phase: 'Ytskikt', trade: 'Målare', who: 'self', hours: r1(1 + wa * 0.08) },
          materials: [
            { name: 'Lättspackel', qty: up(wa / 30), unit: 'burk', price: 150, category: 'Färg & spackel' },
            { name: 'Slippapper/slipsvamp', qty: 1, unit: 'förp', price: 80, category: 'Verktyg & förbrukning' },
          ],
        },
        {
          task: { name: 'Måla tak', phase: 'Ytskikt', trade: 'Målare', who: 'self', hours: r1(1 + d.area * 0.15) },
          materials: [{ name: 'Takfärg', qty: r1((d.area * 2) / 8), unit: 'l', price: 90, waste: 10, category: 'Färg & spackel' }],
        },
        {
          task: { name: 'Måla väggar (2 strykningar)', phase: 'Ytskikt', trade: 'Målare', who: 'self', hours: r1(2 + wa * 0.12) },
          materials: [
            { name: 'Väggfärg', qty: r1((wa * 2) / 8), unit: 'l', price: 120, waste: 10, category: 'Färg & spackel' },
            { name: 'Roller, penslar och tråg', qty: 1, unit: 'förp', price: 250, category: 'Verktyg & förbrukning' },
          ],
        },
      ];
    },
  },
  {
    id: 'floor',
    name: 'Lägga nytt golv',
    description: 'Riva gammalt golv och lister, lägga underlag, nytt golv och nya golvlister.',
    build: (d) => [
      {
        task: { name: 'Riva gamla golvlister och golv', phase: 'Rivning', trade: 'Golvläggare', who: 'self', hours: r1(2 + d.area * 0.2) },
        materials: [{ name: 'Sopsäckar för byggavfall', qty: up(d.area / 5), unit: 'st', price: 25, category: 'Verktyg & förbrukning' }],
      },
      {
        task: {
          name: 'Lägga nytt golv',
          phase: 'Ytskikt',
          trade: 'Golvläggare',
          who: 'contractor',
          hours: r1(2 + d.area * 0.5),
          laborCost: Math.round(d.area * 350),
          description: 'Flytande golv (laminat/parkett) på underlagsmatta.',
        },
        materials: [
          { name: 'Golv (laminat/parkett)', qty: r1(d.area), unit: 'm²', price: 350, waste: 10, category: 'Golv', buyer: 'self' },
          { name: 'Underlagsmatta', qty: r1(d.area), unit: 'm²', price: 40, waste: 5, category: 'Golv', buyer: 'contractor' },
        ],
      },
      {
        task: { name: 'Montera golvlister', phase: 'Snickerier & montering', trade: 'Snickare', who: 'self', hours: r1(1 + d.perimeter * 0.15) },
        materials: [
          { name: 'Golvlist', qty: r1(d.perimeter), unit: 'm', price: 45, waste: 10, category: 'Trä & skivor' },
          { name: 'Dyckert/listlim', qty: 1, unit: 'förp', price: 90, category: 'Infästning & lim' },
        ],
      },
    ],
  },
  {
    id: 'bath',
    name: 'Renovera badrum',
    description: 'Rivning, rör, el, tätskikt, kakel och klinker samt montering av porslin.',
    build: (d) => {
      const wa = wallArea(d);
      return [
        {
          task: {
            name: 'Riva befintligt badrum',
            phase: 'Rivning',
            trade: 'Plattsättare',
            who: 'contractor',
            hours: 16,
            laborCost: 12000,
            description: 'Riva kakel, klinker, porslin och inredning. Bortforsling av byggavfall.',
          },
          materials: [],
        },
        {
          task: {
            name: 'Byta rör och golvbrunn',
            phase: 'VVS',
            trade: 'Rörmokare',
            who: 'contractor',
            hours: 16,
            laborCost: 18000,
            description: 'Ny golvbrunn, nya vatten- och avloppsrör fram till blandare och porslin.',
          },
          materials: [{ name: 'Golvbrunn med klämring', qty: 1, unit: 'st', price: 1500, category: 'VVS & porslin', buyer: 'contractor' }],
        },
        {
          task: {
            name: 'El: belysning, uttag och golvvärme',
            phase: 'El',
            trade: 'Elektriker',
            who: 'contractor',
            hours: 10,
            laborCost: 9000,
            description: 'Taklampa, spegelbelysning, jordat uttag och elektrisk golvvärme med termostat.',
          },
          materials: [{ name: 'Golvvärmematta med termostat', qty: r1(d.area * 0.8), unit: 'm²', price: 500, category: 'El', buyer: 'contractor' }],
        },
        {
          task: {
            name: 'Tätskikt på golv och väggar',
            phase: 'Tätskikt & våtrum',
            trade: 'Plattsättare',
            who: 'contractor',
            hours: 12,
            laborCost: Math.round((d.area + wa) * 250),
            description: 'Godkänt tätskiktssystem enligt branschregler. Våtrumsintyg ska lämnas.',
          },
          materials: [{ name: 'Tätskiktssystem (primer, membran, manschetter)', qty: r1(d.area + wa), unit: 'm²', price: 180, category: 'Tätskikt', buyer: 'contractor' }],
        },
        {
          task: {
            name: 'Sätta kakel och klinker',
            phase: 'Ytskikt',
            trade: 'Plattsättare',
            who: 'contractor',
            hours: r1(8 + (d.area + wa) * 1.2),
            laborCost: Math.round((d.area + wa) * 900),
            description: 'Kakel på väggar och klinker på golv med fall mot brunn.',
          },
          materials: [
            { name: 'Kakel vägg', qty: r1(wa), unit: 'm²', price: 400, waste: 10, category: 'Kakel & klinker', buyer: 'self' },
            { name: 'Klinker golv', qty: r1(d.area), unit: 'm²', price: 450, waste: 10, category: 'Kakel & klinker', buyer: 'self' },
            { name: 'Fix och fog', qty: up((d.area + wa) / 5), unit: 'säck', price: 300, category: 'Kakel & klinker', buyer: 'contractor' },
          ],
        },
        {
          task: {
            name: 'Montera toalett, handfat och dusch',
            phase: 'Snickerier & montering',
            trade: 'Rörmokare',
            who: 'contractor',
            hours: 8,
            laborCost: 7000,
          },
          materials: [
            { name: 'Toalettstol', qty: 1, unit: 'st', price: 3500, category: 'VVS & porslin', buyer: 'self' },
            { name: 'Kommod med handfat', qty: 1, unit: 'st', price: 5000, category: 'VVS & porslin', buyer: 'self' },
            { name: 'Duschset med blandare', qty: 1, unit: 'st', price: 3500, category: 'VVS & porslin', buyer: 'self' },
            { name: 'Duschvägg', qty: 1, unit: 'st', price: 4000, category: 'VVS & porslin', buyer: 'self' },
          ],
        },
        {
          task: { name: 'Montera spegel, krokar och tillbehör', phase: 'Snickerier & montering', trade: 'Övrigt', who: 'self', hours: 3 },
          materials: [{ name: 'Spegel och badrumstillbehör', qty: 1, unit: 'förp', price: 1500, category: 'Övrigt' }],
        },
      ];
    },
  },
  {
    id: 'kitchen',
    name: 'Byta kök',
    description: 'Riva gammalt kök, el och VVS, montera nytt kök, bänkskiva och vitvaror.',
    build: () => [
      {
        task: { name: 'Riva gamla köksskåp och bänkskiva', phase: 'Rivning', trade: 'Rivning & bortforsling', who: 'self', hours: 8, people: 2 },
        materials: [{ name: 'Släp/bortforsling till återvinning', qty: 1, unit: 'st', price: 500, category: 'Övrigt' }],
      },
      {
        task: {
          name: 'Dra om el för nytt kök',
          phase: 'El',
          trade: 'Elektriker',
          who: 'contractor',
          hours: 8,
          laborCost: 8000,
          description: 'Uttag för vitvaror och bänk, spis-/hällanslutning, belysning under överskåp.',
        },
        materials: [],
      },
      {
        task: {
          name: 'Ansluta vatten och avlopp',
          phase: 'VVS',
          trade: 'Rörmokare',
          who: 'contractor',
          hours: 5,
          laborCost: 5000,
          description: 'Diskho, blandare och diskmaskin. Avstängningsventiler och läckageskydd.',
        },
        materials: [{ name: 'Läckageskydd under diskbänk', qty: 1, unit: 'st', price: 300, category: 'VVS & porslin', buyer: 'contractor' }],
      },
      {
        task: { name: 'Montera köksskåp och luckor', phase: 'Snickerier & montering', trade: 'Köksmontör', who: 'self', hours: 16, people: 2 },
        materials: [
          { name: 'Bänkskåp (stomme)', qty: 6, unit: 'st', price: 900, category: 'Kök & vitvaror' },
          { name: 'Överskåp (stomme)', qty: 5, unit: 'st', price: 700, category: 'Kök & vitvaror' },
          { name: 'Luckor och lådfronter', qty: 14, unit: 'st', price: 450, category: 'Kök & vitvaror' },
          { name: 'Handtag', qty: 14, unit: 'st', price: 60, category: 'Kök & vitvaror' },
        ],
      },
      {
        task: { name: 'Montera bänkskiva och diskho', phase: 'Snickerier & montering', trade: 'Köksmontör', who: 'self', hours: 6, people: 2 },
        materials: [
          { name: 'Bänkskiva', qty: 3.6, unit: 'm', price: 1500, category: 'Kök & vitvaror' },
          { name: 'Diskho', qty: 1, unit: 'st', price: 2000, category: 'Kök & vitvaror' },
          { name: 'Köksblandare', qty: 1, unit: 'st', price: 1500, category: 'VVS & porslin' },
        ],
      },
      {
        task: { name: 'Installera vitvaror', phase: 'Snickerier & montering', trade: 'Köksmontör', who: 'self', hours: 4 },
        materials: [
          { name: 'Spis/häll och ugn', qty: 1, unit: 'st', price: 12000, category: 'Kök & vitvaror' },
          { name: 'Kyl och frys', qty: 1, unit: 'st', price: 10000, category: 'Kök & vitvaror' },
          { name: 'Diskmaskin', qty: 1, unit: 'st', price: 6000, category: 'Kök & vitvaror' },
          { name: 'Fläkt', qty: 1, unit: 'st', price: 3000, category: 'Kök & vitvaror' },
        ],
      },
      {
        task: { name: 'Sätta stänkskydd (kakel)', phase: 'Ytskikt', trade: 'Plattsättare', who: 'self', hours: 6 },
        materials: [
          { name: 'Kakel stänkskydd', qty: 2, unit: 'm²', price: 400, waste: 10, category: 'Kakel & klinker' },
          { name: 'Fix och fog', qty: 1, unit: 'säck', price: 300, category: 'Kakel & klinker' },
        ],
      },
    ],
  },
  {
    id: 'wall',
    name: 'Bygga en innervägg',
    description: 'Regelvägg med gips på båda sidor, isolering och spackling. Väggens längd anges som "omkrets".',
    build: (d) => {
      const len = d.perimeter;
      const face = r1(len * d.height);
      return [
        {
          task: { name: 'Resa regelstomme', phase: 'Stomme & bygg', trade: 'Snickare', who: 'self', hours: r1(2 + len * 1.2) },
          materials: [
            { name: 'Stålregel/träregel 45×70', qty: r1(len * (d.height / 0.6 + 2)), unit: 'm', price: 25, waste: 10, category: 'Trä & skivor' },
            { name: 'Skruv och infästning', qty: 1, unit: 'förp', price: 200, category: 'Infästning & lim' },
          ],
        },
        {
          task: { name: 'Isolera och gipsa båda sidor', phase: 'Stomme & bygg', trade: 'Snickare', who: 'self', hours: r1(2 + face * 0.4) },
          materials: [
            { name: 'Gipsskiva 900×2400', qty: up((face * 2) / 2.16), unit: 'st', price: 110, waste: 10, category: 'Trä & skivor' },
            { name: 'Ljudisolering 70 mm', qty: r1(face), unit: 'm²', price: 60, waste: 5, category: 'Trä & skivor' },
            { name: 'Gipsskruv', qty: 1, unit: 'förp', price: 150, category: 'Infästning & lim' },
          ],
        },
        {
          task: { name: 'Spackla skarvar och måla', phase: 'Ytskikt', trade: 'Målare', who: 'self', hours: r1(3 + face * 0.3) },
          materials: [
            { name: 'Skarvremsa och spackel', qty: 1, unit: 'förp', price: 300, category: 'Färg & spackel' },
            { name: 'Väggfärg', qty: r1((face * 2 * 2) / 8), unit: 'l', price: 120, waste: 10, category: 'Färg & spackel' },
          ],
        },
      ];
    },
  },
];

export function applyTemplate(tpl: Template, dims: Dimensions, room: ProjectRoom | null): { tasks: Task[]; materials: Material[] } {
  const tasks: Task[] = [];
  const materials: Material[] = [];
  for (const { task, materials: mats } of tpl.build(dims)) {
    const t = newTask({ ...task, roomIds: room ? [room.id] : [] });
    if (room && !t.name.includes(room.name)) t.name = `${t.name} – ${room.name}`;
    tasks.push(t);
    for (const m of mats) materials.push(newMaterial({ ...m, taskId: t.id }));
  }
  return { tasks, materials };
}

export function newTask(p: Partial<Task> = {}): Task {
  return {
    id: uid('t'),
    name: 'Nytt moment',
    phase: PHASES[2],
    trade: 'Övrigt',
    who: 'self',
    hours: 0,
    people: 1,
    laborCost: 0,
    status: 'todo',
    description: '',
    roomIds: [],
    ...p,
  };
}

export function newMaterial(p: Partial<Material> = {}): Material {
  return {
    id: uid('m'),
    taskId: null,
    name: 'Nytt material',
    qty: 1,
    unit: 'st',
    price: 0,
    waste: 0,
    category: 'Övrigt',
    store: '',
    buyer: 'self',
    bought: false,
    note: '',
    ...p,
  };
}

// ----- Checklistor -----

export const CHECKLIST_TEMPLATES: { title: string; items: string[] }[] = [
  {
    title: 'Innan du börjar',
    items: [
      'Kolla med kommunen om bygglov eller anmälan behövs (t.ex. vid ändring av bärande väggar, ventilation eller vatten/avlopp)',
      'Bostadsrätt: få styrelsens godkännande för ändringar',
      'Kontrollera att det inte finns asbest i material som ska rivas (vanligt i hus byggda före 1982)',
      'Ta reda på var vatten, el och stammar går innan du river',
      'Kontakta hemförsäkringen om vad som gäller under renoveringen',
      'Bestäm budget med ca 10–15 % marginal för överraskningar',
      'Boka container eller släp för byggavfall (tillstånd behövs om den ställs på gatan)',
      'Meddela grannarna om störande arbeten',
    ],
  },
  {
    title: 'Anlita hantverkare',
    items: [
      'Begär offert från minst tre företag',
      'Kontrollera F-skatt och att företaget är registrerat (t.ex. på verksamt.se eller hos Skatteverket)',
      'Fråga efter referenser och titta på tidigare jobb',
      'Kontrollera behörighet: elinstallatör (Elsäkerhetsverket), våtrum (GVK/BKR/Säker Vatten)',
      'Skriv avtal (t.ex. Hantverkarformuläret 17) med pris, tider och betalningsplan',
      'Kom överens om hur tilläggsarbeten ska godkännas och prissättas',
      'Se till att arbetskostnaden står separat på fakturan för ROT-avdrag',
      'Betala inte stora belopp i förskott',
    ],
  },
  {
    title: 'Badrum och våtrum',
    items: [
      'Tätskikt utförs av behörig plattsättare enligt branschregler',
      'Fall mot golvbrunn kontrolleras innan klinker läggs',
      'Ta foton på tätskikt, rör och el innan väggarna stängs',
      'Få våtrumsintyg/kvalitetsdokument från plattsättaren',
      'Ventilation (frånluft) fungerar och är tillräcklig',
      'Spara produktblad och garantier för tätskikt och porslin',
    ],
  },
  {
    title: 'Slutbesiktning',
    items: [
      'Gå igenom alla moment tillsammans med hantverkaren',
      'Skriv ner och fotografera fel och brister',
      'Bestäm datum när bristerna ska vara åtgärdade',
      'Få intyg (el, våtrum) och bruksanvisningar',
      'Kontrollera fakturor mot offert och avtalade tillägg',
      'Spara alla kvitton – de behövs för ROT och vid försäljning',
      'Städning och bortforsling av allt byggavfall är klar',
    ],
  },
];

export function newChecklist(title: string, items: string[]): Checklist {
  return { id: uid('c'), title, items: items.map((text) => ({ id: uid('ci'), text, done: false })) };
}
