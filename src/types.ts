/** Alla mått lagras i millimeter. Y-axeln pekar nedåt (som i SVG). */
export interface Vec {
  x: number;
  y: number;
}

export interface Wall {
  id: string;
  a: Vec;
  b: Vec;
  thickness: number;
}

export type OpeningKind = 'door' | 'double' | 'sliding' | 'window' | 'opening';

export interface Opening {
  id: string;
  wallId: string;
  kind: OpeningKind;
  /** Mittpunktens position längs väggen, 0..1 */
  t: number;
  width: number;
  /** Gångjärn på andra sidan */
  flip: boolean;
  /** Öppnar åt andra hållet */
  side: boolean;
}

export interface Room {
  id: string;
  name: string;
  points: Vec[];
  color: string;
}

export interface Item {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  d: number;
  rotation: number;
  color: string;
  label?: string;
}

export interface Label {
  id: string;
  x: number;
  y: number;
  text: string;
  size: number;
}

export interface Dimension {
  id: string;
  a: Vec;
  b: Vec;
}

/** En bild (t.ex. en inskannad planritning) som ligger under ritningen att rita efter. */
export interface Background {
  /** Bilden som data-URL */
  src: string;
  /** Bildens övre vänstra hörn och storlek i mm */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0–1 */
  opacity: number;
  visible: boolean;
}

export interface Plan {
  id: string;
  name: string;
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  items: Item[];
  labels: Label[];
  dims: Dimension[];
  background?: Background;
  updatedAt: number;
}

export type EntityKind = 'wall' | 'opening' | 'room' | 'item' | 'label' | 'dim';

export interface Selection {
  kind: EntityKind;
  id: string;
}
