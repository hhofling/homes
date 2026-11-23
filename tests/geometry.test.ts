import { describe, expect, it } from 'vitest';
import {
  formatArea,
  formatLength,
  lockAngle,
  pointInPolygon,
  pointInRotatedRect,
  polygonArea,
  polygonCentroid,
  projectOnSegment,
  snapVec,
} from '../src/geometry';
import { nextVariantName, normalizePlan } from '../src/store';
import { renderOpening } from '../src/render';

const square = [
  { x: 0, y: 0 },
  { x: 4000, y: 0 },
  { x: 4000, y: 3000 },
  { x: 0, y: 3000 },
];

describe('geometri', () => {
  it('räknar area och tyngdpunkt för ett rum', () => {
    expect(polygonArea(square)).toBe(12_000_000);
    expect(formatArea(polygonArea(square))).toBe('12,0 m²');
    expect(polygonCentroid(square)).toEqual({ x: 2000, y: 1500 });
  });

  it('formaterar längder i meter med decimalkomma', () => {
    expect(formatLength(3450)).toBe('3,45 m');
    expect(formatLength(900)).toBe('0,90 m');
  });

  it('avgör om en punkt ligger i ett rum', () => {
    expect(pointInPolygon({ x: 100, y: 100 }, square)).toBe(true);
    expect(pointInPolygon({ x: 4100, y: 100 }, square)).toBe(false);
  });

  it('projicerar på en vägg och klämmer till ändarna', () => {
    const pr = projectOnSegment({ x: 1000, y: 500 }, { x: 0, y: 0 }, { x: 4000, y: 0 });
    expect(pr.t).toBeCloseTo(0.25);
    expect(pr.dist).toBeCloseTo(500);
    expect(projectOnSegment({ x: -500, y: 0 }, { x: 0, y: 0 }, { x: 4000, y: 0 }).t).toBe(0);
  });

  it('hanterar roterade möbler', () => {
    // 2000 x 500, roterad 90° => upptar 500 x 2000
    expect(pointInRotatedRect({ x: 0, y: 900 }, 0, 0, 2000, 500, 90)).toBe(true);
    expect(pointInRotatedRect({ x: 900, y: 0 }, 0, 0, 2000, 500, 90)).toBe(false);
  });

  it('snäpper till rutnät och låser vinklar', () => {
    expect(snapVec({ x: 149, y: 51 }, 100)).toEqual({ x: 100, y: 100 });
    const p = lockAngle({ x: 0, y: 0 }, { x: 1000, y: 80 }, 45);
    expect(p.y).toBeCloseTo(0);
    expect(p.x).toBeCloseTo(Math.hypot(1000, 80));
  });
});

describe('planer', () => {
  it('namnger varianter i följd', () => {
    expect(nextVariantName('Lägenhet', ['Lägenhet'])).toBe('Lägenhet – variant 2');
    expect(nextVariantName('Lägenhet – variant 2', ['Lägenhet', 'Lägenhet – variant 2'])).toBe('Lägenhet – variant 3');
  });

  it('fyller i saknade fält vid import', () => {
    const p = normalizePlan({ name: 'Test', walls: [{ id: 'w', a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, thickness: 100 }] });
    expect(p.walls).toHaveLength(1);
    expect(p.rooms).toEqual([]);
    expect(p.items).toEqual([]);
    expect(() => normalizePlan(null)).toThrow();
  });

  it('ritar dörrar och fönster', () => {
    const base = { id: 'o', wallId: 'w', t: 0.5, width: 900, flip: false, side: false };
    expect(renderOpening({ ...base, kind: 'door' }, 150)).toContain('<path');
    expect(renderOpening({ ...base, kind: 'window' }, 150)).toContain('#eaf4fb');
  });
});
