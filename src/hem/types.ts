/** Datamodell för Hemprojekt – navet som håller ihop mål, idéer, budget och steg mot de andra verktygen. */

export type HomeStatus = 'idea' | 'planning' | 'doing' | 'done' | 'paused';
export type WhoDoes = 'self' | 'contractor' | 'mix';

/** Vad ett steg gör när man trycker på dess knapp. */
export type StepAction =
  | 'ideas' // samla idéer, bilder och önskemål (här i Hemprojekt)
  | 'budget' // sätt budget (här)
  | 'plan-now' // rita hur det ser ut i dag (Planritaren)
  | 'plan-new' // rita förslaget (Planritaren, kopia av nuläget)
  | 'plan-3d' // se förslaget i 3D (Planritaren)
  | 'tomt' // rita tomten och det som ska byggas (Tomtplaneraren)
  | 'bygg' // kalkyl, moment och material (Byggplaneraren)
  | 'bygg-quotes' // offertförfrågningar (Byggplaneraren)
  | 'bygg-schedule' // tidsplan (Byggplaneraren)
  | 'bygg-shopping' // inköpslistor (Byggplaneraren)
  | 'bygg-checklists' // checklistor (Byggplaneraren)
  | 'bilder'; // bildbiblioteket (kommer)

export interface Step {
  id: string;
  title: string;
  detail: string;
  phase: string;
  action?: StepAction;
  done: boolean;
  /** Egen anteckning */
  note: string;
}

export interface Wish {
  id: string;
  text: string;
  /** Måste finnas (annars "vore bra") */
  must: boolean;
}

export interface Idea {
  id: string;
  text: string;
  /** Bild som data-URL (förminskad) */
  image?: string;
  /** Länk till t.ex. en produkt eller inspirationsbild på nätet */
  url?: string;
  createdAt: number;
}

export interface Cost {
  id: string;
  name: string;
  /** Uppskattat, kr */
  estimate: number;
  /** Faktiskt betalt, kr */
  actual: number;
  /** Grov uppskattning från guiden – räknas inte med när en kalkyl finns */
  rough?: boolean;
}

/** Mått på rummet/byggnaden i meter (0 = okänt). */
export interface Size {
  length: number;
  width: number;
  height: number;
}

export interface Links {
  /** Planer i Planritaren */
  plans: string[];
  /** Tomter i Tomtplaneraren */
  sites: string[];
  /** Projekt i Byggplaneraren */
  builds: string[];
  /** Bilder i bildbiblioteket */
  images: string[];
}

export interface HomeProject {
  id: string;
  name: string;
  /** Projekttyp, se KINDS */
  kind: string;
  status: HomeStatus;
  /** Vad vill jag uppnå? */
  goal: string;
  /** Vilket rum eller vilken del av huset/tomten */
  place: string;
  size: Size;
  who: WhoDoes;
  /** Budget i kr (0 = ingen satt) */
  budget: number;
  /** Klart till, ÅÅÅÅ-MM-DD */
  deadline: string;
  /** 1 = viktigast */
  priority: 1 | 2 | 3;
  wishes: Wish[];
  ideas: Idea[];
  steps: Step[];
  costs: Cost[];
  links: Links;
  notes: string;
  createdAt: number;
  updatedAt: number;
}
