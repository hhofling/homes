/** Projekttyper och hur en plan (steg för steg) tas fram utifrån det man svarat. */
import { uid } from '../geometry';
import type { HomeProject, Step, StepAction } from './types';

export interface Kind {
  id: string;
  label: string;
  icon: string;
  description: string;
  /** Handlar det om ett rum inomhus (Planritaren) eller om tomten (Tomtplaneraren)? */
  where: 'room' | 'plot' | 'any';
  /** Mall i Byggplaneraren som ger moment och material */
  byggTemplate?: string;
  /** Byggnad eller yta som läggs ut på tomten */
  plotItem?: { type: 'building' | 'area'; kind: string };
  /** Typiska mått (m) som förslag i guiden */
  size: { length: number; width: number; height: number };
  /** Frågor som hjälper till att formulera önskemål */
  prompts: string[];
  /** Råd om lov och anmälan (vägledning) */
  permit?: string;
  /** Saker som är viktiga för just den här typen */
  tips: string[];
  /** Grovt riktpris i kr per m² (för en första budget) */
  pricePerM2?: number;
}

export const KINDS: Kind[] = [
  {
    id: 'bath',
    label: 'Renovera badrum',
    icon: '🛁',
    description: 'Nytt tätskikt, kakel, klinker, dusch, toalett och kommod.',
    where: 'room',
    byggTemplate: 'bath',
    size: { length: 2.5, width: 2, height: 2.4 },
    prompts: ['Dusch eller badkar?', 'Golvvärme?', 'Tvättmaskin i badrummet?', 'Vilken stil – ljus, mörk, trä, sten?', 'Förvaring – kommod, skåp, nischer?'],
    tips: [
      'Tätskiktet ska göras av en firma med behörighet (t.ex. BKR eller GVK) – annars kan försäkringen sluta gälla vid en vattenskada.',
      'Be om intyg för tätskikt och för el och VVS när jobbet är klart, och spara dem.',
      'Räkna med att badrummet inte går att använda på 3–6 veckor.',
    ],
    pricePerM2: 35000,
  },
  {
    id: 'kitchen',
    label: 'Nytt kök',
    icon: '🍳',
    description: 'Byta luckor eller hela köket, bänkskivor, vitvaror, el och VVS.',
    where: 'room',
    byggTemplate: 'kitchen',
    size: { length: 4, width: 3, height: 2.4 },
    prompts: ['Hela köket eller bara luckor och bänkskiva?', 'Köksö eller halvö?', 'Vilka vitvaror ska bytas?', 'Hur många ska kunna äta i köket?', 'Mer förvaring eller mer bänkyta?'],
    tips: [
      'Rita köket i skala innan du beställer – mät var vatten, avlopp, el och ventilation sitter.',
      'Nya elinstallationer ska göras av en behörig elektriker.',
      'Leveranstiden för kök kan vara flera veckor – beställ i god tid.',
    ],
    pricePerM2: 15000,
  },
  {
    id: 'paint',
    label: 'Måla om eller tapetsera',
    icon: '🎨',
    description: 'Spackla, slipa och måla väggar och tak eller sätta ny tapet.',
    where: 'room',
    byggTemplate: 'paint',
    size: { length: 4, width: 3.5, height: 2.4 },
    prompts: ['Vilka färger eller tapeter?', 'Även tak, lister och dörrar?', 'Ska möblerna stå kvar i rummet?'],
    tips: ['Prova färgen på en bit vägg och titta på den både i dagsljus och kvällsljus.', 'Två tunna strykningar blir bättre än en tjock.'],
    pricePerM2: 400,
  },
  {
    id: 'floor',
    label: 'Nytt golv',
    icon: '🪵',
    description: 'Riva gammalt golv och lägga nytt parkett, laminat, klinker eller vinyl.',
    where: 'room',
    byggTemplate: 'floor',
    size: { length: 5, width: 4, height: 2.4 },
    prompts: ['Vilket golv – parkett, laminat, klinker, vinyl?', 'Golvvärme?', 'Nya golvlister och trösklar?'],
    tips: ['Låt golvet ligga i rummet ett par dygn innan det läggs så att det vänjer sig vid temperaturen.', 'Köp 5–10 % extra för spill.'],
    pricePerM2: 900,
  },
  {
    id: 'layout',
    label: 'Ändra planlösning',
    icon: '🧱',
    description: 'Riva eller bygga en vägg, slå ihop eller dela rum.',
    where: 'room',
    byggTemplate: 'wall',
    size: { length: 6, width: 4, height: 2.4 },
    prompts: ['Vilka rum ska slås ihop eller delas?', 'Vet du om väggen är bärande?', 'Behövs en ny dörr?', 'Hur ska rummen användas efteråt?'],
    permit: 'Att ta bort eller ändra en bärande vägg kräver anmälan till kommunen och en konstruktör. En vanlig mellanvägg som inte bär kan du oftast ändra fritt.',
    tips: ['Ta reda på om väggen är bärande innan du river något – titta på gamla ritningar eller fråga en konstruktör.', 'Prova flera varianter i Planritaren och se dem i 3D innan du bestämmer dig.'],
    pricePerM2: 3000,
  },
  {
    id: 'furnish',
    label: 'Inreda ett rum',
    icon: '🛋️',
    description: 'Möblera, välja färger, belysning och textilier.',
    where: 'room',
    size: { length: 4.5, width: 3.5, height: 2.4 },
    prompts: ['Vad ska rummet användas till?', 'Vilka möbler finns redan och ska vara kvar?', 'Vilken känsla vill du ha?', 'Belysning – tak, golv, spotlights?'],
    tips: ['Rita in möblerna i skala – då ser du direkt vad som får plats och hur man kan gå.', 'Lämna minst 80–90 cm fritt där man ska gå.'],
    pricePerM2: 2500,
  },
  {
    id: 'deck',
    label: 'Altan eller uteplats',
    icon: '☀️',
    description: 'Trall, plattor, räcke och trappa.',
    where: 'plot',
    plotItem: { type: 'area', kind: 'deck' },
    size: { length: 6, width: 4, height: 0 },
    prompts: ['Var får du sol när du vill sitta ute?', 'Trä, komposit eller plattor?', 'Räcke, tak eller vindskydd?', 'Plats för grill, soffa och matbord?'],
    permit: 'En altan nära marken behöver oftast inget bygglov. Är den högre än ca 1,8 m eller nära tomtgränsen, eller får den tak, kan det krävas lov – fråga kommunen.',
    tips: ['Kolla sol och skugga för olika tider på dagen i Tomtplaneraren.', 'Tryckimpregnerat virke ska vara klass NTR/AB i marknära konstruktion.'],
    pricePerM2: 2500,
  },
  {
    id: 'attefall',
    label: 'Attefallshus eller friggebod',
    icon: '🏡',
    description: 'Gästhus, förråd, ateljé eller kontor på tomten.',
    where: 'plot',
    plotItem: { type: 'building', kind: 'attefall' },
    size: { length: 6, width: 5, height: 0 },
    prompts: ['Vad ska huset användas till – gäster, kontor, förråd, uthyrning?', 'Behövs el, vatten och avlopp?', 'Ska det vara isolerat för vinterbruk?', 'Vilken stil – samma som huset?'],
    permit: 'Attefallshus (högst 30 m²) kräver anmälan och startbesked från kommunen innan du börjar. Friggebod (högst 15 m²) behöver oftast ingen anmälan. Båda ska stå minst 4,5 m från tomtgränsen om grannen inte godkänner kortare avstånd.',
    tips: ['Kontrollera detaljplanen – den kan säga annat än de allmänna reglerna.', 'Tomtplaneraren visar avståndet till tomtgränsen och varnar om något ser fel ut.'],
    pricePerM2: 25000,
  },
  {
    id: 'extension',
    label: 'Tillbyggnad',
    icon: '📐',
    description: 'Bygga till huset – nytt rum, uterum eller större kök.',
    where: 'any',
    plotItem: { type: 'building', kind: 'house' },
    size: { length: 5, width: 4, height: 2.4 },
    prompts: ['Vad ska den nya ytan användas till?', 'Var på huset passar den bäst?', 'Samma takform och fasad som huset?', 'Hur ska man komma in i den?'],
    permit: 'En tillbyggnad kräver nästan alltid bygglov (eller attefallsanmälan för högst 15 m²). Räkna med att handläggningen tar 4–10 veckor.',
    tips: ['Rita både hur huset ser ut i dag och förslaget – det behövs till bygglovet.', 'Ta in minst tre offerter.'],
    pricePerM2: 30000,
  },
  {
    id: 'garden',
    label: 'Trädgård och tomt',
    icon: '🌳',
    description: 'Gräsmatta, rabatter, gångar, staket, häck och träd.',
    where: 'plot',
    size: { length: 0, width: 0, height: 0 },
    prompts: ['Vad vill du göra i trädgården – odla, leka, sitta, vila?', 'Mer avskildhet (häck, staket)?', 'Hur mycket skötsel orkar du med?'],
    tips: ['Planera i Tomtplaneraren och kolla var solen är under dagen.', 'Plantera träd och buskar på hösten eller våren.'],
    pricePerM2: 300,
  },
  {
    id: 'other',
    label: 'Eget projekt',
    icon: '✏️',
    description: 'Något annat – beskriv själv och bygg upp stegen.',
    where: 'any',
    size: { length: 0, width: 0, height: 0 },
    prompts: ['Vad vill du uppnå?', 'Vad är viktigast?', 'Vad får det kosta?'],
    tips: [],
  },
];

export const kindOf = (id: string) => KINDS.find((k) => k.id === id) ?? KINDS[KINDS.length - 1];

export const PHASES = ['Idé och mål', 'Mät och rita', 'Kalkyl och budget', 'Lov och offerter', 'Inköp', 'Genomförande', 'Klart'];

export const STATUS_LABELS = {
  idea: 'Idé',
  planning: 'Planeras',
  doing: 'Pågår',
  done: 'Klart',
  paused: 'Vilande',
} as const;

/** Vilket verktyg ett steg öppnar (för knappens text). */
export const ACTION_LABELS: Record<StepAction, string> = {
  ideas: 'Lägg till idéer',
  budget: 'Gå till budget',
  'plan-now': 'Öppna i Planritaren',
  'plan-new': 'Rita förslaget',
  'plan-3d': 'Visa i 3D',
  tomt: 'Öppna Tomtplaneraren',
  bygg: 'Öppna Byggplaneraren',
  'bygg-quotes': 'Offertförfrågningar',
  'bygg-schedule': 'Tidsplan',
  'bygg-shopping': 'Inköpslistor',
  'bygg-checklists': 'Checklistor',
  bilder: 'Öppna Bildbiblioteket',
};

const step = (phase: string, title: string, detail: string, action?: StepAction): Step => ({ id: uid('st'), phase, title, detail, action, done: false, note: '' });

/** Golvyta i m² utifrån måtten (0 om okänt). */
export const floorArea = (p: Pick<HomeProject, 'size'>) => Math.round(Math.max(0, p.size.length) * Math.max(0, p.size.width) * 10) / 10;

/** En första grov kostnad utifrån typ och yta – bara för att ha något att jämföra budgeten mot. */
export function roughEstimate(p: Pick<HomeProject, 'kind' | 'size' | 'who'>): number {
  const k = kindOf(p.kind);
  const area = floorArea(p);
  if (!k.pricePerM2 || !area) return 0;
  const factor = p.who === 'self' ? 0.55 : p.who === 'mix' ? 0.8 : 1;
  return Math.round((k.pricePerM2 * area * factor) / 1000) * 1000;
}

/**
 * Tar fram en plan steg för steg utifrån projekttyp och svar.
 * Stegen pekar på det verktyg som passar (Planritaren, Tomtplaneraren, Byggplaneraren).
 */
export function generateSteps(p: Pick<HomeProject, 'kind' | 'who' | 'budget' | 'deadline' | 'place'>): Step[] {
  const k = kindOf(p.kind);
  const [IDEA, DRAW, CALC, PERMIT, BUY, DO, DONE] = PHASES;
  const place = p.place.trim();
  const inRoom = place ? ` (${place})` : '';
  const s: Step[] = [];
  const hires = p.who !== 'self';
  const plot = k.where === 'plot';

  // Idé och mål
  s.push(step(IDEA, 'Skriv ner målet och dina önskemål', 'Vad vill du uppnå, och vad måste finnas? Skilj på "måste" och "vore bra" – det gör det lättare att prioritera när pengarna eller tiden inte räcker.', 'ideas'));
  s.push(step(IDEA, 'Samla inspiration', 'Spara bilder, länkar och skisser på det du gillar. Skriv en rad om vad du gillar med varje bild.', 'ideas'));
  if (!p.budget) s.push(step(IDEA, 'Bestäm en budget', 'Sätt en övre gräns för vad projektet får kosta. Lägg gärna till 10–15 % för oförutsett.', 'budget'));

  // Mät och rita
  if (plot || k.id === 'extension') {
    s.push(step(DRAW, 'Rita tomten och det som finns i dag', 'Lägg in tomtgränsen, huset och det som redan finns på tomten.', 'tomt'));
    if (k.id === 'garden') s.push(step(DRAW, 'Rita det nya i trädgården', 'Lägg till gräsmatta, rabatter, gångar, häck, staket och träd. Kolla sol och skugga.', 'tomt'));
    else s.push(step(DRAW, `Placera ${k.id === 'deck' ? 'altanen' : k.id === 'attefall' ? 'huset' : 'tillbyggnaden'} på tomten`, 'Prova olika lägen. Kolla avståndet till tomtgränsen och hur solen står under dagen.', 'tomt'));
  }
  if (k.where === 'room' || k.id === 'extension') {
    s.push(step(DRAW, `Mät och rita hur det ser ut i dag${inRoom}`, 'Mät väggar, dörrar och fönster och rita in dem. Har du en gammal ritning kan du använda "Från bild…" i Planritaren.', 'plan-now'));
    s.push(step(DRAW, 'Rita förslaget', k.id === 'furnish' ? 'Möblera i skala och prova olika placeringar. Gör gärna flera varianter.' : 'Gör en kopia av ritningen och rita in det nya. Prova gärna flera varianter.', 'plan-new'));
    s.push(step(DRAW, 'Titta på förslaget i 3D', 'Se hur det känns i rummet innan du bestämmer dig.', 'plan-3d'));
  }
  if (k.id !== 'other') s.push(step(DRAW, 'Skissa och låt AI visa hur det kan bli', 'Ta ett foto av rummet eller en bild från 3D-vyn, rita på den vad du vill ändra och be AI göra en verklighetstrogen bild. Kombinera gärna med inspirationsbilder.', 'bilder'));

  // Kalkyl
  if (k.byggTemplate || plot || k.id === 'extension') {
    s.push(step(CALC, 'Gör kalkyl och materiallista', plot ? 'Skapa en inköpsplan från det du ritat på tomten – moment, material, mängder och riktpriser.' : 'Skapa ett projekt i Byggplaneraren med moment, material och mängder utifrån rummets mått.', 'bygg'));
  } else if (k.id === 'furnish') {
    s.push(step(CALC, 'Gör en inköpslista', 'Skriv upp möbler, färg, belysning och textilier med pris och butik.', 'bygg'));
  }
  s.push(step(CALC, 'Jämför kalkylen med budgeten', 'Räcker pengarna? Annars – stryk sådant som "vore bra", gör mer själv eller dela upp projektet.', 'budget'));

  // Lov och offerter
  if (k.permit) s.push(step(PERMIT, 'Ta reda på om det behövs bygglov eller anmälan', k.permit));
  if (hires) {
    s.push(step(PERMIT, 'Begär offerter', 'Skicka samma underlag till minst tre firmor så att offerterna går att jämföra. Fråga efter ROT-avdrag och referenser.', 'bygg-quotes'));
    s.push(step(PERMIT, 'Välj firma och skriv avtal', 'Kontrollera F-skatt och försäkring. Använd gärna standardavtal (t.ex. Hantverkarformuläret 17).'));
  }

  // Inköp
  if (k.byggTemplate || plot || k.id === 'furnish' || k.id === 'extension') s.push(step(BUY, 'Beställ och köp material', 'Använd inköpslistan per butik. Kolla leveranstider för det som måste beställas.', 'bygg-shopping'));

  // Genomförande
  s.push(step(DO, 'Gör en tidsplan', p.deadline ? `Räkna baklänges från ${p.deadline} och se när varje del måste vara klar.` : 'Se hur lång tid varje del tar och i vilken ordning de ska göras.', 'bygg-schedule'));
  s.push(step(DO, 'Förbered', 'Töm rummet eller ytan, skydda golv och möbler, ordna med avfall och container om det behövs.', 'bygg-checklists'));
  s.push(step(DO, 'Genomför arbetet', hires ? 'Stäm av med hantverkarna regelbundet och fota under arbetet – särskilt sådant som byggs in.' : 'Ta en del i taget och fota under arbetet – särskilt sådant som byggs in.', hires || k.byggTemplate ? 'bygg' : undefined));

  // Klart
  s.push(step(DONE, 'Besiktiga och gå igenom', hires ? 'Gå igenom jobbet med firman innan du betalar sista fakturan. Skriv ner det som ska åtgärdas.' : 'Gå igenom resultatet och gör en lista på det som ska fixas.', 'bygg-checklists'));
  s.push(step(DONE, 'Spara kvitton, intyg och ritningar', 'Kvitton, garantier, intyg (tätskikt, el, VVS) och slutliga ritningar – bra att ha om något händer och när huset ska säljas.'));
  return s;
}

/** Nästa steg som inte är gjort. */
export const nextStep = (p: HomeProject) => p.steps.find((s) => !s.done) ?? null;

export const progress = (p: HomeProject) => (p.steps.length ? p.steps.filter((s) => s.done).length / p.steps.length : 0);
