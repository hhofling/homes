import { describe, it, expect } from 'vitest';
import { examplePlans, exampleSite, groundFloor } from '../src/exempel/hogbovagen333';
import { normalizePlan } from '../src/store';
import { normalizeSite } from '../src/tomt/store';
import { polygonArea } from '../src/geometry';

describe('Exempel: Högbovägen 333', () => {
  it('ger två våningsplan med giltiga öppningar', () => {
    const plans = examplePlans();
    expect(plans.map((p) => p.name)).toEqual(['Högbovägen 333 – bottenvåning', 'Högbovägen 333 – övervåning']);
    for (const p of plans) {
      const n = normalizePlan(JSON.parse(JSON.stringify(p)));
      expect(n.walls.length).toBeGreaterThan(5);
      for (const o of n.openings) {
        expect(n.walls.some((w) => w.id === o.wallId)).toBe(true);
        expect(o.t).toBeGreaterThan(0);
        expect(o.t).toBeLessThan(1);
      }
      const ids = [...n.walls, ...n.openings, ...n.rooms, ...n.items].map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
  it('har rimlig boyta (ca 75–100 m² utan uterum)', () => {
    const area = examplePlans()
      .flatMap((p) => p.rooms.filter((r) => r.name !== 'Uterum'))
      .reduce((s, r) => s + polygonArea(r.points), 0) / 1e6;
    expect(area).toBeGreaterThan(70);
    expect(area).toBeLessThan(105);
  });
  it('ger en tomt på ca 1 830 m² med huset kopplat till planen', () => {
    const s = normalizeSite(JSON.parse(JSON.stringify(exampleSite())));
    expect(polygonArea(s.plot) / 1e6).toBeCloseTo(1829, -1);
    const house = s.buildings.find((b) => b.name === 'Huvudbyggnad')!;
    expect(s.plans?.some((p) => p.id === house.planId)).toBe(true);
    expect(groundFloor(false).rooms.some((r) => r.name === 'Uterum')).toBe(false);
  });
});
