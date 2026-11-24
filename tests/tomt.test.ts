import { describe, expect, it } from 'vitest';
import { roofInfo, distanceToBoundary, totalHeight, buildingNotes } from '../src/tomt/calc';
import { newBuilding, newArea, newLine } from '../src/tomt/catalog';
import { planFromBuilding, autoOpenings } from '../src/tomt/toplan';
import { buildingSteps, siteToProject, openingCounts } from '../src/tomt/quantities';
import { emptySite, normalizeSite } from '../src/tomt/store';

describe('Tomtplaneraren', () => {
  it('räknar takyta och nockhöjd för sadeltak', () => {
    const b = newBuilding('house', 0, 0, 12000, 8000);
    b.pitch = 0;
    b.roof = 'flat';
    expect(roofInfo(b).area).toBeCloseTo(12.8 * 8.8, 1);
    b.roof = 'gable';
    b.pitch = 45;
    const r = roofInfo(b);
    expect(r.axis).toBe('x');
    expect(r.rise).toBeCloseTo(4000, 0);
    expect(totalHeight(b)).toBeCloseTo(200 + 2700 + 4000, 0);
  });

  it('mäter avstånd till tomtgränsen', () => {
    const plot = [{ x: 0, y: 0 }, { x: 20000, y: 0 }, { x: 20000, y: 20000 }, { x: 0, y: 20000 }];
    const b = newBuilding('friggebod', 4000, 10000, 4000, 3000);
    expect(distanceToBoundary(b, plot)).toBeCloseTo(2000, 0);
    const s = emptySite();
    s.plot = plot;
    const notes = buildingNotes(b, s);
    expect(notes.some((n) => n.level === 'warn' && n.text.includes('4,5 m'))).toBe(true);
  });

  it('gör en planritning med ytterväggar, fönster och dörr', () => {
    const b = newBuilding('house', 0, 0, 12000, 8000);
    const plan = planFromBuilding(b, 'Test');
    expect(plan.walls).toHaveLength(4);
    expect(plan.openings.filter((o) => o.kind === 'door')).toHaveLength(1);
    expect(plan.openings.length).toBe(autoOpenings(b).length);
    expect(openingCounts(b, plan).fromPlan).toBe(true);
  });

  it('räknar fram moment och material', () => {
    const b = newBuilding('house', 0, 0, 12000, 8000);
    const steps = buildingSteps(b);
    const mats = steps.flatMap((s) => s.materials);
    expect(mats.find((m) => m.name.startsWith('Råspont'))!.qty).toBeCloseTo(roofInfo(b).area, 0);
    const s = emptySite();
    s.buildings.push(b);
    s.areas.push(newArea('deck', 0, 6000));
    s.lines.push(newLine('fence', [{ x: 0, y: 0 }, { x: 10000, y: 0 }]));
    const p = siteToProject(s, new Map());
    expect(p.rooms.length).toBe(1);
    expect(p.tasks.length).toBeGreaterThan(8);
    expect(p.materials.every((m) => m.qty >= 0 && Number.isFinite(m.price))).toBe(true);
  });

  it('läser in en sparad tomt', () => {
    const s = emptySite('X');
    s.buildings.push(newBuilding('garage', 1000, 1000));
    const back = normalizeSite(JSON.parse(JSON.stringify(s)));
    expect(back.buildings[0].kind).toBe('garage');
    expect(() => normalizeSite({})).toThrow();
  });
});
