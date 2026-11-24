/**
 * Gör om tomten till ett byggprojekt i Byggplaneraren: moment och material med mängder
 * som räknas fram ur byggnadernas och ytornas mått. Priserna är grova riktpriser.
 */
import type { Plan } from '../types';
import type { Material, Project, ProjectRoom, Task, Who } from '../projekt/types';
import { emptyProject } from '../projekt/store';
import { newChecklist, newMaterial, newTask, CHECKLIST_TEMPLATES } from '../projekt/templates';
import { polygonArea, dist, uid } from '../geometry';
import type { Area, Building, Line, Plant, Site } from './types';
import { BUILDING_KINDS, AREA_KINDS, LINE_KINDS, PLANT_KINDS, FOUNDATIONS } from './catalog';
import { roofInfo, wallHeight, polylineLength } from './calc';

type TaskSpec = Partial<Task> & { name: string; phase: string; trade: string; who: Who; hours: number };
type MatSpec = Partial<Material> & { name: string; qty: number; unit: string; price: number; category: string };
interface Step {
  task: TaskSpec;
  materials: MatSpec[];
}

const r1 = (n: number) => Math.max(0, Math.round(n * 10) / 10);
const up = (n: number) => Math.max(1, Math.ceil(n - 1e-9));
const P = {
  plan: 'Planering & tillstånd',
  riv: 'Rivning',
  stomme: 'Stomme & bygg',
  el: 'El',
  vvs: 'VVS',
  yt: 'Ytskikt',
  snick: 'Snickerier & montering',
  stad: 'Städning & besiktning',
};

/** Antal fönster och dörrar – från kopplad planritning om den finns, annars en uppskattning. */
export function openingCounts(b: Building, plan?: Plan | null) {
  if (plan && plan.openings.length) {
    let windows = 0;
    let doors = 0;
    let innerDoors = 0;
    const outer = outerWallIds(plan);
    for (const o of plan.openings) {
      if (o.kind === 'window') windows++;
      else if (o.kind === 'door' || o.kind === 'double' || o.kind === 'sliding') {
        if (outer.has(o.wallId)) doors++;
        else innerDoors++;
      }
    }
    return { windows, doors: Math.max(doors, 1), innerDoors, fromPlan: true };
  }
  const A = (b.w * b.d) / 1e6;
  const n = Math.max(1, b.floors);
  switch (b.kind) {
    case 'house':
      return { windows: up((A * n) / 9), doors: 2, innerDoors: up((A * n) / 15), fromPlan: false };
    case 'attefall':
      return { windows: up(A / 6), doors: 1, innerDoors: A > 20 ? 1 : 0, fromPlan: false };
    case 'garage':
      return { windows: 2, doors: 1, innerDoors: 0, fromPlan: false };
    case 'carport':
      return { windows: 0, doors: 0, innerDoors: 0, fromPlan: false };
    default:
      return { windows: 1, doors: 1, innerDoors: 0, fromPlan: false };
  }
}

/** Väggar som ligger på planens yttre kant räknas som ytterväggar. */
function outerWallIds(plan: Plan) {
  const xs = plan.walls.flatMap((w) => [w.a.x, w.b.x]);
  const ys = plan.walls.flatMap((w) => [w.a.y, w.b.y]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const tol = 300;
  const on = (v: number, a: number) => Math.abs(v - a) < tol;
  const ids = new Set<string>();
  for (const w of plan.walls) {
    if ((on(w.a.x, x0) && on(w.b.x, x0)) || (on(w.a.x, x1) && on(w.b.x, x1)) || (on(w.a.y, y0) && on(w.b.y, y0)) || (on(w.a.y, y1) && on(w.b.y, y1))) ids.add(w.id);
  }
  return ids;
}

/** Moment och material för en byggnad. */
export function buildingSteps(b: Building, plan?: Plan | null): Step[] {
  const w = b.w / 1000;
  const d = b.d / 1000;
  const A = w * d;
  const per = 2 * (w + d);
  const n = Math.max(1, b.floors);
  const Hw = wallHeight(b) / 1000;
  const roof = roofInfo(b);
  const rise = roof.rise / 1000;
  const span = roof.span / 1000;
  const len = roof.length / 1000;
  const heated = b.kind === 'house' || b.kind === 'attefall';
  const open = openingCounts(b, plan);
  const name = b.name || BUILDING_KINDS[b.kind].label;
  const steps: Step[] = [];

  // --- Lov och utsättning ---
  if (b.kind === 'house') {
    steps.push({
      task: { name: `Bygglov, nybyggnadskarta och utsättning – ${name}`, phase: P.plan, trade: 'Övrigt', who: 'self', hours: 16, description: 'Ansök om bygglov hos kommunen. Nybyggnadskarta och utsättning beställs oftast av kommunen.' },
      materials: [
        { name: 'Bygglovsavgift (uppskattning – se kommunens taxa)', qty: 1, unit: 'st', price: 30000, category: 'Övrigt' },
        { name: 'Nybyggnadskarta och utsättning', qty: 1, unit: 'st', price: 15000, category: 'Övrigt' },
        { name: 'Kontrollansvarig (KA)', qty: 1, unit: 'st', price: 25000, category: 'Övrigt' },
        { name: 'Anslutningsavgift vatten och avlopp (kolla kommunens taxa)', qty: 1, unit: 'st', price: 180000, category: 'Övrigt' },
      ],
    });
  } else if (b.kind === 'attefall') {
    steps.push({
      task: { name: `Anmälan om attefallshus – ${name}`, phase: P.plan, trade: 'Övrigt', who: 'self', hours: 6, description: 'Gör en anmälan till kommunen och vänta på startbesked innan du börjar bygga.' },
      materials: [{ name: 'Avgift för anmälan (uppskattning)', qty: 1, unit: 'st', price: 8000, category: 'Övrigt' }],
    });
  } else if (b.kind === 'garage' || b.kind === 'carport') {
    steps.push({
      task: { name: `Bygglov – ${name}`, phase: P.plan, trade: 'Övrigt', who: 'self', hours: 4, description: 'Kontrollera med kommunen om det räcker med attefallsanmälan eller om bygglov behövs.' },
      materials: [{ name: 'Bygglovsavgift (uppskattning)', qty: 1, unit: 'st', price: 10000, category: 'Övrigt' }],
    });
  }

  // --- Grund ---
  if (b.foundation === 'slab') {
    steps.push({
      task: { name: `Markarbete och platta på mark – ${name}`, phase: P.stomme, trade: 'Murare', who: 'contractor', hours: r1(16 + A * 0.6), laborCost: Math.round(A * 900), description: `${FOUNDATIONS.slab}, ca ${r1(A)} m².` },
      materials: [
        { name: 'Makadam/dränerande grus', qty: r1(A * 0.3 * 1.8), unit: 'ton', price: 350, waste: 10, category: 'Övrigt' },
        { name: 'Cellplast (EPS) 300 mm under platta', qty: r1(A), unit: 'm²', price: heated ? 420 : 140, waste: 5, category: 'Trä & skivor' },
        { name: 'Kantelement (L-element)', qty: r1(per), unit: 'm', price: 320, waste: 5, category: 'Trä & skivor' },
        { name: 'Armeringsnät 2,2 × 5 m', qty: up((A / 11) * 1.15), unit: 'st', price: 260, category: 'Infästning & lim' },
        { name: 'Betong C25/30', qty: r1(A * 0.1 + per * 0.06), unit: 'm³', price: 1700, waste: 5, category: 'Övrigt' },
        ...(heated ? [{ name: 'Golvvärmeslang och fördelare', qty: r1(A), unit: 'm²', price: 180, category: 'VVS & porslin' } as MatSpec] : []),
      ],
    });
  } else if (b.foundation === 'crawl') {
    steps.push({
      task: { name: `Krypgrund – ${name}`, phase: P.stomme, trade: 'Murare', who: 'contractor', hours: r1(24 + A * 0.8), laborCost: Math.round(A * 1100) },
      materials: [
        { name: 'Betong för grundsula', qty: r1(per * 0.4 * 0.2), unit: 'm³', price: 1700, waste: 10, category: 'Övrigt' },
        { name: 'Lättklinkerblock till grundmur', qty: up((per * 0.6) / 0.12), unit: 'st', price: 65, waste: 5, category: 'Övrigt' },
        { name: 'Golvbjälkar 45×220', qty: r1((w / 0.6 + 1) * d), unit: 'm', price: 55, waste: 10, category: 'Trä & skivor' },
        { name: 'Isolering i bjälklag 220 mm', qty: r1(A), unit: 'm²', price: 95, waste: 5, category: 'Trä & skivor' },
        { name: 'Avfuktare för krypgrund', qty: 1, unit: 'st', price: 9000, category: 'Övrigt' },
      ],
    });
  } else {
    const posts = up((w / 1.8 + 1) * (d / 1.8 + 1));
    steps.push({
      task: { name: `Gjuta/sätta plintar och bärlinor – ${name}`, phase: P.stomme, trade: 'Snickare', who: 'self', hours: r1(4 + posts * 0.8) },
      materials: [
        { name: 'Betongplintar med justerbart stolpfäste', qty: posts, unit: 'st', price: 260, category: 'Övrigt' },
        { name: 'Bärlinor tryckimpregnerat 45×170', qty: r1(2 * w * (d / 1.8 + 1) * 0.5), unit: 'm', price: 45, waste: 10, category: 'Trä & skivor' },
        ...(b.kind !== 'carport'
          ? [
              { name: 'Golvbjälkar 45×145', qty: r1((w / 0.6 + 1) * d), unit: 'm', price: 32, waste: 10, category: 'Trä & skivor' } as MatSpec,
              { name: 'Golvspånskiva/golvbrädor', qty: r1(A), unit: 'm²', price: 160, waste: 10, category: 'Golv' } as MatSpec,
            ]
          : []),
      ],
    });
  }

  // --- Stomme och fasad ---
  let gable = 0;
  if (b.roof === 'gable') gable = span * rise; // två trianglar
  else if (b.roof === 'shed') gable = span * rise + len * rise;
  const gross = per * Hw + gable;
  const openingArea = open.windows * 1.4 + open.doors * 2.1 + (b.kind === 'garage' ? 6 : 0);
  const net = Math.max(0, gross - openingArea);
  if (b.kind === 'carport') {
    steps.push({
      task: { name: `Resa stolpar och takbalkar – ${name}`, phase: P.stomme, trade: 'Snickare', who: 'self', hours: r1(8 + A * 0.4) },
      materials: [
        { name: 'Limträstolpar 115×115', qty: up((w > 4 ? 3 : 2) * (d / 3 + 1)), unit: 'st', price: 950, category: 'Trä & skivor' },
        { name: 'Limträbalkar 90×315', qty: r1(2 * d), unit: 'm', price: 420, waste: 5, category: 'Trä & skivor' },
        { name: 'Vinkeljärn, bult och beslag', qty: 1, unit: 'förp', price: 1200, category: 'Infästning & lim' },
      ],
    });
  } else {
    const studs = heated ? 'Reglar 45×170' : 'Reglar 45×95';
    steps.push({
      task: { name: `Resa väggstomme – ${name}`, phase: P.stomme, trade: 'Snickare', who: b.kind === 'house' ? 'contractor' : 'self', hours: r1(8 + gross * 0.35), laborCost: b.kind === 'house' ? Math.round(gross * 450) : 0 },
      materials: [
        { name: studs, qty: r1(per * (Hw * 2.3 + 3)), unit: 'm', price: heated ? 42 : 24, waste: 10, category: 'Trä & skivor' },
        { name: 'Vindskyddsskiva/vindduk', qty: r1(net), unit: 'm²', price: 75, waste: 10, category: 'Trä & skivor' },
        { name: 'Spik, skruv och vinkelbeslag', qty: up(gross / 40), unit: 'förp', price: 450, category: 'Infästning & lim' },
        ...(heated
          ? [
              { name: 'Mineralull 170 mm (väggar)', qty: r1(net), unit: 'm²', price: 75, waste: 5, category: 'Trä & skivor' } as MatSpec,
              { name: 'Ångspärr (plastfolie) och tejp', qty: r1(net + A), unit: 'm²', price: 14, waste: 15, category: 'Trä & skivor' } as MatSpec,
            ]
          : []),
      ],
    });
    steps.push({
      task: { name: `Fasad: läkt, panel och målning – ${name}`, phase: P.yt, trade: 'Snickare', who: 'self', hours: r1(6 + net * 0.5) },
      materials: [
        { name: 'Spikläkt 28×70 (luftspalt)', qty: r1(net * 1.8), unit: 'm', price: 9, waste: 10, category: 'Trä & skivor' },
        { name: 'Ytterpanel (lockpanel/stående)', qty: r1(net), unit: 'm²', price: 170, waste: 15, category: 'Trä & skivor' },
        { name: 'Fasadfärg (2 strykningar)', qty: r1((net * 2) / 6), unit: 'l', price: 190, waste: 10, category: 'Färg & spackel' },
        { name: 'Grundolja/grundfärg', qty: r1(net / 8), unit: 'l', price: 140, category: 'Färg & spackel' },
      ],
    });
  }

  // --- Bjälklag mellan våningar ---
  if (n > 1 && b.kind !== 'carport') {
    steps.push({
      task: { name: `Bjälklag mellan våningarna – ${name}`, phase: P.stomme, trade: 'Snickare', who: 'contractor', hours: r1(A * (n - 1) * 0.5), laborCost: Math.round(A * (n - 1) * 350) },
      materials: [
        { name: 'Golvbjälkar 45×220 / lättbalk', qty: r1((w / 0.6 + 1) * d * (n - 1)), unit: 'm', price: 60, waste: 10, category: 'Trä & skivor' },
        { name: 'Golvspånskiva 22 mm', qty: r1(A * (n - 1)), unit: 'm²', price: 130, waste: 10, category: 'Golv' },
        { name: 'Trappa', qty: n - 1, unit: 'st', price: 25000, category: 'Övrigt' },
      ],
    });
  }

  // --- Tak ---
  const area = roof.area;
  const steep = b.roof !== 'flat' && roof.pitch >= 14;
  const roofMats: MatSpec[] = [];
  if (b.roof === 'flat') {
    roofMats.push({ name: 'Takbalkar 45×220', qty: r1((roof.L / 1000 / 0.6 + 1) * (roof.S / 1000)), unit: 'm', price: 60, waste: 10, category: 'Trä & skivor' });
  } else {
    roofMats.push({ name: `Takstolar (spännvidd ca ${r1(span)} m)`, qty: up(roof.L / 1000 / 1.2) + 1, unit: 'st', price: Math.round(900 + span * 160), category: 'Trä & skivor' });
  }
  roofMats.push(
    { name: 'Råspont 23 mm', qty: r1(area), unit: 'm²', price: 125, waste: 10, category: 'Trä & skivor' },
    { name: 'Underlagspapp/underlagsduk', qty: r1(area), unit: 'm²', price: 45, waste: 15, category: 'Tätskikt' },
  );
  if (b.roof === 'flat' || roof.pitch < 6) roofMats.push({ name: 'Ytpapp (svetsbar)', qty: r1(area), unit: 'm²', price: 140, waste: 15, category: 'Tätskikt' });
  else if (steep) {
    roofMats.push(
      { name: 'Takpannor (betong)', qty: r1(area), unit: 'm²', price: 160, waste: 5, category: 'Övrigt' },
      { name: 'Strö- och bärläkt', qty: r1(area * 3.8), unit: 'm', price: 9, waste: 10, category: 'Trä & skivor' },
      { name: 'Nockpannor', qty: up(roof.ridgeLen * 3) , unit: 'st', price: 70, category: 'Övrigt' },
    );
  } else roofMats.push({ name: 'Takplåt (profilerad)', qty: r1(area), unit: 'm²', price: 190, waste: 5, category: 'Övrigt' });
  roofMats.push(
    { name: 'Vindskivor och takfotsbrädor', qty: r1((2 * (roof.L + roof.S)) / 1000), unit: 'm', price: 28, waste: 10, category: 'Trä & skivor' },
    { name: 'Hängrännor med krokar', qty: r1(roof.gutter), unit: 'm', price: 160, waste: 5, category: 'Övrigt' },
    { name: 'Stuprör med böjar', qty: Math.max(2, up(roof.gutter / 10)), unit: 'st', price: 650, category: 'Övrigt' },
  );
  if (heated) roofMats.push({ name: 'Isolering vind (lösull/skivor 400 mm)', qty: r1(A), unit: 'm²', price: 110, waste: 5, category: 'Trä & skivor' });
  steps.push({
    task: {
      name: `Takstolar, råspont och taktäckning – ${name}`,
      phase: P.stomme,
      trade: 'Takläggare',
      who: b.kind === 'house' ? 'contractor' : 'self',
      hours: r1(8 + area * 0.6),
      laborCost: b.kind === 'house' ? Math.round(area * 400) : 0,
      description: `Takyta ca ${r1(area)} m², lutning ${roof.pitch}°.`,
    },
    materials: roofMats,
  });

  // --- Fönster och dörrar ---
  if (open.windows || open.doors || b.kind === 'garage') {
    const mats: MatSpec[] = [];
    if (open.windows) mats.push({ name: 'Fönster (ca 1,2 × 1,2 m)', qty: open.windows, unit: 'st', price: heated ? 6500 : 2500, category: 'Övrigt' });
    if (open.doors) mats.push({ name: heated ? 'Ytterdörr' : 'Dörr (förråd/sidodörr)', qty: open.doors, unit: 'st', price: heated ? 14000 : 4500, category: 'Övrigt' });
    if (b.kind === 'garage') mats.push({ name: 'Garageport (takskjutport)', qty: 1, unit: 'st', price: 19000, category: 'Övrigt' });
    mats.push(
      { name: 'Fönsterbleck och foder', qty: open.windows + open.doors, unit: 'st', price: 450, category: 'Trä & skivor' },
      { name: 'Drevning/fogskum och fönsterband', qty: up((open.windows + open.doors) / 6), unit: 'förp', price: 300, category: 'Infästning & lim' },
    );
    steps.push({
      task: {
        name: `Montera fönster och dörrar – ${name}`,
        phase: P.snick,
        trade: 'Snickare',
        who: 'self',
        hours: r1(open.windows * 2.5 + open.doors * 3 + (b.kind === 'garage' ? 8 : 0)),
        description: open.fromPlan ? 'Antal från planritningen.' : 'Antal uppskattat – rita in fönster och dörrar i Planritaren för exakta antal.',
      },
      materials: mats,
    });
  }

  // --- Invändigt för bostäder ---
  if (heated) {
    const innerWallLen = A * n * 0.3;
    steps.push({
      task: { name: `Innerväggar och gips – ${name}`, phase: P.stomme, trade: 'Snickare', who: 'self', hours: r1(A * n * 0.8) },
      materials: [
        { name: 'Reglar 45×70 (innerväggar)', qty: r1(innerWallLen * (b.floorHeight / 1000) * 2.5), unit: 'm', price: 18, waste: 10, category: 'Trä & skivor' },
        { name: 'Gipsskivor 13 mm', qty: r1(net + innerWallLen * (b.floorHeight / 1000) * 2 + A * n), unit: 'm²', price: 55, waste: 10, category: 'Trä & skivor' },
        { name: 'Ljudisolering innerväggar 70 mm', qty: r1(innerWallLen * (b.floorHeight / 1000)), unit: 'm²', price: 45, waste: 5, category: 'Trä & skivor' },
        { name: 'Gipsskruv', qty: up((A * n) / 40), unit: 'förp', price: 220, category: 'Infästning & lim' },
        ...(open.innerDoors ? [{ name: 'Innerdörrar med karm', qty: open.innerDoors, unit: 'st', price: 2800, category: 'Övrigt' } as MatSpec] : []),
      ],
    });
    steps.push({
      task: { name: `El-installation – ${name}`, phase: P.el, trade: 'Elektriker', who: 'contractor', hours: r1(A * n * 0.6), laborCost: Math.round(A * n * 450) },
      materials: [{ name: 'Elmaterial (centralcentral, kabel, dosor, uttag)', qty: 1, unit: 'st', price: Math.round(A * n * 250), buyer: 'contractor', category: 'El' }],
    });
    if (b.kind === 'house' || A > 20) {
      steps.push({
        task: { name: `VVS: vatten, avlopp och värme – ${name}`, phase: P.vvs, trade: 'Rörmokare', who: 'contractor', hours: r1(A * n * 0.5), laborCost: Math.round(A * n * (b.kind === 'house' ? 650 : 400)) },
        materials: [
          { name: 'Rör, kopplingar och golvbrunnar', qty: 1, unit: 'st', price: Math.round(A * n * 220), buyer: 'contractor', category: 'VVS & porslin' },
          ...(b.kind === 'house'
            ? [
                { name: 'Värmepump (frånluft/luft-vatten)', qty: 1, unit: 'st', price: 95000, buyer: 'contractor', category: 'VVS & porslin' } as MatSpec,
                { name: 'Ventilationsaggregat och kanaler', qty: 1, unit: 'st', price: 45000, buyer: 'contractor', category: 'VVS & porslin' } as MatSpec,
              ]
            : []),
        ],
      });
    }
  }
  return steps;
}

export function areaSteps(a: Area): Step[] {
  const w = a.w / 1000;
  const d = a.d / 1000;
  const A = w * d;
  const per = 2 * (w + d);
  const name = a.name || AREA_KINDS[a.kind].label;
  switch (a.kind) {
    case 'deck':
      return [
        {
          task: { name: `Bygga ${name.toLowerCase()} (${r1(A)} m²)`, phase: P.snick, trade: 'Snickare', who: 'self', hours: r1(4 + A * 1.8) },
          materials: [
            { name: 'Betongplintar', qty: up(A / 2.2) + 2, unit: 'st', price: 240, category: 'Övrigt' },
            { name: 'Bärlinor och reglar tryckimp. 45×145', qty: r1(A * 2.3), unit: 'm', price: 36, waste: 10, category: 'Trä & skivor' },
            { name: 'Trall tryckimp. 28×120', qty: r1(A), unit: 'm²', price: 230, waste: 10, category: 'Trä & skivor' },
            { name: 'Trallskruv rostfri', qty: up(A / 8), unit: 'förp', price: 380, category: 'Infästning & lim' },
            { name: 'Bjälkskor och vinkelbeslag', qty: up(A / 10), unit: 'förp', price: 350, category: 'Infästning & lim' },
            ...(a.height > 500 ? [{ name: 'Räcke', qty: r1(per * 0.6), unit: 'm', price: 650, category: 'Trä & skivor' } as MatSpec] : []),
            { name: 'Träskyddsolja', qty: r1(A / 8), unit: 'l', price: 150, category: 'Färg & spackel' },
          ],
        },
      ];
    case 'patio':
      return [
        {
          task: { name: `Anlägga ${name.toLowerCase()} (${r1(A)} m²)`, phase: P.yt, trade: 'Övrigt', who: 'self', hours: r1(6 + A * 1.5), description: 'Schakta ca 30 cm, markduk, bärlager som packas, sättsand och plattor.' },
          materials: groundMats(A, per, 'Marksten/betongplattor', 260),
        },
      ];
    case 'driveway':
      return [
        {
          task: { name: `Anlägga ${name.toLowerCase()} (${r1(A)} m²)`, phase: P.yt, trade: 'Övrigt', who: 'contractor', hours: r1(8 + A * 0.5), laborCost: Math.round(A * 350) },
          materials: [
            { name: 'Markduk', qty: r1(A), unit: 'm²', price: 12, waste: 10, category: 'Övrigt' },
            { name: 'Bärlager krossgrus 0–32', qty: r1(A * 0.3 * 2), unit: 'ton', price: 320, waste: 5, category: 'Övrigt' },
            { name: 'Slitlager grus 0–16', qty: r1(A * 0.05 * 1.8), unit: 'ton', price: 360, waste: 5, category: 'Övrigt' },
          ],
        },
      ];
    case 'pool':
      return [
        {
          task: { name: `Pool (${r1(w)} × ${r1(d)} m)`, phase: P.stomme, trade: 'Övrigt', who: 'contractor', hours: 60, laborCost: Math.round(40000 + A * 2500), description: 'Schaktning, poolstomme, liner, rening och el. Kontrollera med kommunen om bygglov behövs.' },
          materials: [
            { name: 'Poolsats (stomme, liner, pump och filter)', qty: 1, unit: 'st', price: Math.round(40000 + A * 2000), category: 'Övrigt' },
            { name: 'Kantsten runt poolen', qty: r1(per), unit: 'm', price: 450, waste: 5, category: 'Övrigt' },
          ],
        },
      ];
    case 'bed':
      return [
        {
          task: { name: `Anlägga ${name.toLowerCase()} (${r1(A)} m²)`, phase: P.yt, trade: 'Övrigt', who: 'self', hours: r1(2 + A * 0.6) },
          materials: [
            { name: 'Planteringsjord', qty: r1(A * 0.3), unit: 'm³', price: 900, waste: 5, category: 'Övrigt' },
            { name: 'Kantstål/kantband', qty: r1(per), unit: 'm', price: 120, waste: 5, category: 'Övrigt' },
            { name: 'Plantor', qty: up(A * 4), unit: 'st', price: 70, category: 'Övrigt' },
          ],
        },
      ];
    case 'lawn':
      return [
        {
          task: { name: `Gräsmatta (${r1(A)} m²)`, phase: P.yt, trade: 'Övrigt', who: 'self', hours: r1(2 + A * 0.15) },
          materials: [
            { name: 'Matjord/gräsmattejord', qty: r1(A * 0.1), unit: 'm³', price: 700, waste: 5, category: 'Övrigt' },
            { name: 'Färdig gräsmatta (rullgräs)', qty: r1(A), unit: 'm²', price: 65, waste: 5, category: 'Övrigt' },
          ],
        },
      ];
  }
}

function groundMats(A: number, per: number, top: string, price: number): MatSpec[] {
  return [
    { name: 'Markduk', qty: r1(A), unit: 'm²', price: 12, waste: 10, category: 'Övrigt' },
    { name: 'Bärlager krossgrus 0–32', qty: r1(A * 0.25 * 2), unit: 'ton', price: 320, waste: 5, category: 'Övrigt' },
    { name: 'Sättsand 0–8', qty: r1(A * 0.04 * 1.7), unit: 'ton', price: 420, waste: 5, category: 'Övrigt' },
    { name: top, qty: r1(A), unit: 'm²', price, waste: 5, category: 'Övrigt' },
    { name: 'Kantsten', qty: r1(per), unit: 'm', price: 110, waste: 5, category: 'Övrigt' },
    { name: 'Hyra markvibrator (1 dag)', qty: 1, unit: 'st', price: 650, category: 'Verktyg & förbrukning' },
  ];
}

export function lineSteps(l: Line): Step[] {
  const L = polylineLength(l.points) / 1000;
  const h = l.height / 1000;
  const name = l.name || LINE_KINDS[l.kind].label;
  switch (l.kind) {
    case 'fence':
      return [
        {
          task: { name: `Bygga ${name.toLowerCase()} (${r1(L)} m)`, phase: P.snick, trade: 'Snickare', who: 'self', hours: r1(2 + L * 1.2) },
          materials: [
            { name: 'Stolpar tryckimp. 70×70', qty: up(L / 1.8) + 1, unit: 'st', price: 130, category: 'Trä & skivor' },
            { name: 'Markstolpskor/plintar', qty: up(L / 1.8) + 1, unit: 'st', price: 190, category: 'Infästning & lim' },
            { name: 'Reglar 45×70 tryckimp.', qty: r1(L * 2), unit: 'm', price: 18, waste: 10, category: 'Trä & skivor' },
            { name: 'Staketspjälor', qty: up(L / 0.12), unit: 'st', price: 22, waste: 5, category: 'Trä & skivor' },
            { name: 'Skruv utomhus', qty: up(L / 15), unit: 'förp', price: 260, category: 'Infästning & lim' },
            { name: 'Färg/lasyr för staket', qty: r1((L * h * 2 * 2) / 8), unit: 'l', price: 150, category: 'Färg & spackel' },
          ],
        },
      ];
    case 'hedge':
      return [
        {
          task: { name: `Plantera ${name.toLowerCase()} (${r1(L)} m)`, phase: P.yt, trade: 'Övrigt', who: 'self', hours: r1(1 + L * 0.5) },
          materials: [
            { name: 'Häckplantor', qty: up(L * 3), unit: 'st', price: 65, category: 'Övrigt' },
            { name: 'Planteringsjord', qty: r1(L * 0.15), unit: 'm³', price: 900, category: 'Övrigt' },
          ],
        },
      ];
    case 'path': {
      const A = L * (l.width / 1000);
      return [
        {
          task: { name: `Anlägga ${name.toLowerCase()} (${r1(L)} m)`, phase: P.yt, trade: 'Övrigt', who: 'self', hours: r1(2 + A * 1.5) },
          materials: groundMats(A, 2 * L, 'Gångplattor/marksten', 240),
        },
      ];
    }
    case 'wall':
      return [
        {
          task: { name: `Mura ${name.toLowerCase()} (${r1(L)} m)`, phase: P.yt, trade: 'Murare', who: 'self', hours: r1(2 + L * h * 2) },
          materials: [
            { name: 'Betong för grundsula', qty: r1(L * 0.4 * 0.3), unit: 'm³', price: 1700, waste: 10, category: 'Övrigt' },
            { name: 'Murblock/marksten för mur', qty: r1(L * h), unit: 'm²', price: 650, waste: 5, category: 'Övrigt' },
          ],
        },
      ];
  }
}

export function plantSteps(plants: Plant[]): Step[] {
  if (!plants.length) return [];
  const count = new Map<string, number>();
  for (const p of plants) count.set(p.kind, (count.get(p.kind) ?? 0) + 1);
  const price: Record<string, number> = { tree: 1500, fruit: 900, pine: 1200, bush: 250 };
  return [
    {
      task: { name: `Plantera träd och buskar (${plants.length} st)`, phase: P.yt, trade: 'Övrigt', who: 'self', hours: r1(plants.length * 1) },
      materials: [
        ...[...count].map(([kind, qty]) => ({ name: PLANT_KINDS[kind as Plant['kind']].label, qty, unit: 'st', price: price[kind], category: 'Övrigt' })),
        { name: 'Planteringsjord', qty: r1(plants.length * 0.1), unit: 'm³', price: 900, category: 'Övrigt' },
      ],
    },
  ];
}

/** Rum till Byggplaneraren: rummen i planritningen om den finns, annars en yta per våning. */
export function buildingRooms(b: Building, plan?: Plan | null): ProjectRoom[] {
  if (b.kind === 'carport') return [];
  const h = Math.round((b.floorHeight - 300) / 100) / 10;
  if (plan && plan.rooms.length) {
    return plan.rooms
      .filter((r) => r.points.length >= 3)
      .map((r) => {
        let per = 0;
        for (let i = 0; i < r.points.length; i++) per += dist(r.points[i], r.points[(i + 1) % r.points.length]);
        return { id: uid('room'), name: `${r.name}${b.kind === 'house' ? '' : ` (${b.name})`}`, area: r1(polygonArea(r.points) / 1e6), perimeter: r1(per / 1000), height: h };
      });
  }
  const t = 0.35;
  const w = b.w / 1000 - 2 * t;
  const d = b.d / 1000 - 2 * t;
  return Array.from({ length: Math.max(1, b.floors) }, (_, i) => ({
    id: uid('room'),
    name: b.floors > 1 ? `${b.name} – våning ${i + 1}` : b.name,
    area: r1(w * d),
    perimeter: r1(2 * (w + d)),
    height: h,
  }));
}

/** Vad som kan tas med i inköpsplanen. */
export interface Pick {
  id: string;
  label: string;
}
export function pickables(site: Site): Pick[] {
  const out: Pick[] = [];
  for (const b of site.buildings) out.push({ id: b.id, label: `${b.name} (${r1((b.w * b.d) / 1e6)} m²)` });
  for (const a of site.areas) out.push({ id: a.id, label: `${a.name} (${r1((a.w * a.d) / 1e6)} m²)` });
  for (const l of site.lines) out.push({ id: l.id, label: `${l.name} (${r1(polylineLength(l.points) / 1000)} m)` });
  if (site.plants.length) out.push({ id: 'plants', label: `Träd och buskar (${site.plants.length} st)` });
  return out;
}

export function siteToProject(site: Site, plans: Map<string, Plan>, include?: Set<string>): Project {
  const p = emptyProject(`${site.name} – bygge`);
  p.notes =
    'Skapat från Tomtplaneraren. Mängder och priser är grova uppskattningar räknade från måtten på tomten – justera efter dina val, butikens priser och offerter.';
  const want = (id: string) => !include || include.has(id);
  const add = (steps: Step[], roomIds: string[] = []) => {
    for (const s of steps) {
      const t = newTask({ ...s.task, roomIds });
      p.tasks.push(t);
      for (const m of s.materials) p.materials.push(newMaterial({ ...m, taskId: t.id }));
    }
  };
  for (const b of site.buildings) {
    if (!want(b.id)) continue;
    const plan = b.planId ? plans.get(b.planId) : null;
    const rooms = buildingRooms(b, plan);
    p.rooms.push(...rooms);
    add(buildingSteps(b, plan), rooms.map((r) => r.id));
  }
  for (const a of site.areas) if (want(a.id)) add(areaSteps(a));
  for (const l of site.lines) if (want(l.id)) add(lineSteps(l));
  if (want('plants')) add(plantSteps(site.plants));
  if (p.tasks.length) {
    p.tasks.push(newTask({ name: 'Slutbesiktning och slutbesked', phase: P.stad, trade: 'Övrigt', who: 'self', hours: 4 }));
  }
  p.checklists = [
    newChecklist('Bygglov och anmälan', [
      'Läs detaljplanen för tomten (byggrätt, högsta höjd, avstånd till gräns, prickmark)',
      'Kontakta kommunens bygglovsavdelning och fråga vad som gäller för just ditt bygge',
      'Beställ nybyggnadskarta om kommunen kräver det',
      'Fråga grannarna och få skriftligt medgivande om du bygger närmare än 4,5 m från tomtgränsen',
      'Skicka in ansökan/anmälan med situationsplan, fasadritningar och planritningar',
      'Utse kontrollansvarig (KA) om bygget kräver det',
      'Vänta på startbesked innan du börjar bygga',
      'Ta foton under bygget och spara dokument till slutsamrådet',
      'Få slutbesked innan byggnaden tas i bruk',
    ]),
    ...CHECKLIST_TEMPLATES.filter((c) => c.title === 'Anlita hantverkare' || c.title === 'Slutbesiktning').map((c) => newChecklist(c.title, c.items)),
  ];
  return p;
}
