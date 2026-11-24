/**
 * Datamodell för Tomtplaneraren (3D). Alla mått i millimeter, samma koordinatsystem som
 * Planritaren: x åt höger (öster), y nedåt på skärmen (söder). I 3D blir x → X och y → Z, höjd = Y.
 */
import type { Vec, Plan } from '../types';
export type { Vec };

export type BuildingKind = 'house' | 'garage' | 'shed' | 'friggebod' | 'attefall' | 'carport';
export type RoofType = 'gable' | 'hip' | 'shed' | 'flat';
export type Foundation = 'slab' | 'crawl' | 'plinth';
/** Nockens riktning: längs husets långsida (vanligast), eller tvärs. */
export type RidgeDir = 'long' | 'short';

export interface Building {
  id: string;
  kind: BuildingKind;
  name: string;
  /** Mittpunkt */
  x: number;
  y: number;
  /** Yttermått */
  w: number;
  d: number;
  /** Grader, medurs som i Planritaren */
  rotation: number;
  floors: number;
  /** Våningshöjd (golv till golv) */
  floorHeight: number;
  roof: RoofType;
  /** Taklutning i grader */
  pitch: number;
  ridge: RidgeDir;
  wallColor: string;
  roofColor: string;
  foundation: Foundation;
  /** Kopplad planritning i Planritaren */
  planId?: string;
}

export type AreaKind = 'deck' | 'patio' | 'pool' | 'driveway' | 'bed' | 'lawn';

/** Rektangulära ytor på marken: altan, plattor, pool … */
export interface Area {
  id: string;
  kind: AreaKind;
  name: string;
  x: number;
  y: number;
  w: number;
  d: number;
  rotation: number;
  /** Höjd över mark (altan) eller djup (pool) i mm */
  height: number;
  color: string;
}

export type LineKind = 'fence' | 'hedge' | 'path' | 'wall';

/** Saker som följer en linje: staket, häck, gång, mur. */
export interface Line {
  id: string;
  kind: LineKind;
  name: string;
  points: Vec[];
  height: number;
  width: number;
  color: string;
}

export type PlantKind = 'tree' | 'fruit' | 'pine' | 'bush';

export interface Plant {
  id: string;
  kind: PlantKind;
  x: number;
  y: number;
  /** Kronans diameter */
  size: number;
  height: number;
}

export interface Site {
  id: string;
  name: string;
  /** Tomtgränsen (hörn i ordning) */
  plot: Vec[];
  buildings: Building[];
  areas: Area[];
  lines: Line[];
  plants: Plant[];
  /** Kopior av kopplade planritningar, så att de följer med i tomtfilen */
  plans?: Plan[];
  updatedAt: number;
}

export type SelKind = 'plot' | 'building' | 'area' | 'line' | 'plant';
export interface Sel {
  kind: SelKind;
  id: string;
}
