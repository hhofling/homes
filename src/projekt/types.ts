/** Datamodell för Byggplaneraren. Pengar i kronor, ytor i m², längder i meter. */

export type Who = 'self' | 'contractor';
export type Status = 'todo' | 'doing' | 'done';

export interface Task {
  id: string;
  name: string;
  phase: string;
  trade: string;
  /** Gör jag själv eller anlitar hantverkare */
  who: Who;
  /** Uppskattad arbetstid i timmar (totalt) */
  hours: number;
  /** Antal personer som jobbar samtidigt */
  people: number;
  /** Uppskattad/offererad arbetskostnad i kr (bara för hantverkare) */
  laborCost: number;
  status: Status;
  description: string;
  roomIds: string[];
}

export interface Material {
  id: string;
  taskId: string | null;
  name: string;
  qty: number;
  unit: string;
  /** Pris per enhet i kr */
  price: number;
  /** Spill i procent */
  waste: number;
  category: string;
  store: string;
  /** Vem köper: jag själv eller hantverkaren */
  buyer: Who;
  bought: boolean;
  note: string;
}

export interface ProjectRoom {
  id: string;
  name: string;
  /** Golvarea m² */
  area: number;
  /** Omkrets m */
  perimeter: number;
  /** Takhöjd m */
  height: number;
}

export interface CheckItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Checklist {
  id: string;
  title: string;
  items: CheckItem[];
}

export interface Contact {
  name: string;
  phone: string;
  email: string;
}

export interface Project {
  id: string;
  name: string;
  address: string;
  /** ÅÅÅÅ-MM-DD */
  startDate: string;
  contact: Contact;
  notes: string;
  /** ROT-avdrag i procent av arbetskostnaden */
  rotPct: number;
  /** Arbetstimmar per dag */
  hoursPerDay: number;
  rooms: ProjectRoom[];
  tasks: Task[];
  materials: Material[];
  checklists: Checklist[];
  updatedAt: number;
}
