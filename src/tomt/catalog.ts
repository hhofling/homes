/** Standardvärden och svenska namn för allt som kan placeras på tomten. */
import type { Area, AreaKind, Building, BuildingKind, Line, LineKind, Plant, PlantKind, RoofType, Foundation } from './types';
import { uid } from '../geometry';

export const BUILDING_KINDS: Record<BuildingKind, { label: string; defaults: Partial<Building> }> = {
  house: {
    label: 'Bostadshus',
    defaults: { w: 12000, d: 8000, floors: 1, floorHeight: 2700, roof: 'gable', pitch: 27, wallColor: '#e9e2d0', roofColor: '#3b3f45', foundation: 'slab' },
  },
  garage: {
    label: 'Garage',
    defaults: { w: 6000, d: 7000, floors: 1, floorHeight: 2600, roof: 'gable', pitch: 22, wallColor: '#b5432f', roofColor: '#3b3f45', foundation: 'slab' },
  },
  carport: {
    label: 'Carport',
    defaults: { w: 3500, d: 6000, floors: 1, floorHeight: 2400, roof: 'shed', pitch: 6, wallColor: '#d8d2c4', roofColor: '#5d636b', foundation: 'plinth' },
  },
  attefall: {
    label: 'Attefallshus',
    defaults: { w: 6000, d: 5000, floors: 1, floorHeight: 2600, roof: 'gable', pitch: 25, wallColor: '#8fa89b', roofColor: '#3b3f45', foundation: 'plinth' },
  },
  friggebod: {
    label: 'Friggebod',
    defaults: { w: 5000, d: 3000, floors: 1, floorHeight: 2200, roof: 'gable', pitch: 14, wallColor: '#b5432f', roofColor: '#3b3f45', foundation: 'plinth' },
  },
  shed: {
    label: 'Förråd',
    defaults: { w: 3000, d: 2400, floors: 1, floorHeight: 2100, roof: 'shed', pitch: 8, wallColor: '#6f7a63', roofColor: '#3b3f45', foundation: 'plinth' },
  },
};

export const ROOF_TYPES: Record<RoofType, string> = {
  gable: 'Sadeltak',
  hip: 'Valmat tak',
  shed: 'Pulpettak',
  flat: 'Platt tak',
};

export const FOUNDATIONS: Record<Foundation, string> = {
  slab: 'Platta på mark',
  crawl: 'Krypgrund',
  plinth: 'Plintar',
};

export const AREA_KINDS: Record<AreaKind, { label: string; w: number; d: number; height: number; color: string }> = {
  deck: { label: 'Altan / trädäck', w: 6000, d: 3500, height: 400, color: '#a7784f' },
  patio: { label: 'Uteplats (plattor)', w: 4000, d: 3000, height: 0, color: '#b9b4aa' },
  driveway: { label: 'Uppfart', w: 3500, d: 8000, height: 0, color: '#a59f94' },
  pool: { label: 'Pool', w: 8000, d: 4000, height: 1400, color: '#4fb3d9' },
  bed: { label: 'Rabatt / odling', w: 3000, d: 1200, height: 150, color: '#6b4f36' },
  lawn: { label: 'Gräsmatta', w: 8000, d: 6000, height: 0, color: '#7fb85e' },
};

export const LINE_KINDS: Record<LineKind, { label: string; height: number; width: number; color: string }> = {
  fence: { label: 'Staket', height: 1100, width: 60, color: '#f2f0ea' },
  hedge: { label: 'Häck', height: 1400, width: 700, color: '#3f7a3a' },
  path: { label: 'Gång', height: 0, width: 1000, color: '#c9c2b4' },
  wall: { label: 'Mur', height: 800, width: 250, color: '#9b958b' },
};

export const PLANT_KINDS: Record<PlantKind, { label: string; size: number; height: number }> = {
  tree: { label: 'Lövträd', size: 5000, height: 8000 },
  fruit: { label: 'Fruktträd', size: 3500, height: 4000 },
  pine: { label: 'Barrträd', size: 3500, height: 9000 },
  bush: { label: 'Buske', size: 1400, height: 1200 },
};

export function newBuilding(kind: BuildingKind, x: number, y: number, w?: number, d?: number, rotation = 0): Building {
  const def = BUILDING_KINDS[kind].defaults;
  return {
    id: uid('b'),
    kind,
    name: BUILDING_KINDS[kind].label,
    x,
    y,
    rotation,
    w: w ?? def.w!,
    d: d ?? def.d!,
    floors: def.floors!,
    floorHeight: def.floorHeight!,
    roof: def.roof!,
    pitch: def.pitch!,
    ridge: 'long',
    wallColor: def.wallColor!,
    roofColor: def.roofColor!,
    foundation: def.foundation!,
  };
}

export function newArea(kind: AreaKind, x: number, y: number, w?: number, d?: number, rotation = 0): Area {
  const def = AREA_KINDS[kind];
  return { id: uid('a'), kind, name: def.label, x, y, w: w ?? def.w, d: d ?? def.d, rotation, height: def.height, color: def.color };
}

export function newLine(kind: LineKind, points: { x: number; y: number }[]): Line {
  const def = LINE_KINDS[kind];
  return { id: uid('l'), kind, name: def.label, points, height: def.height, width: def.width, color: def.color };
}

export function newPlant(kind: PlantKind, x: number, y: number): Plant {
  const def = PLANT_KINDS[kind];
  return { id: uid('p'), kind, x, y, size: def.size, height: def.height };
}
