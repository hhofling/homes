import { describe, expect, it } from 'vitest';
import { buyQty, materialCost, totals, schedule, quoteText, quoteTrades, shoppingGroups, materialsCSV, wallArea, taskDays } from '../src/projekt/calc';
import { emptyProject, normalizeProject, roomsFromPlan } from '../src/projekt/store';
import { applyTemplate, newMaterial, newTask, TEMPLATES } from '../src/projekt/templates';

describe('mängder och kostnader', () => {
  it('räknar in spill och avrundar hela enheter uppåt', () => {
    expect(buyQty(newMaterial({ qty: 10, unit: 'm²', waste: 10 }))).toBe(11);
    expect(buyQty(newMaterial({ qty: 4.2, unit: 'st', waste: 0 }))).toBe(5);
    expect(buyQty(newMaterial({ qty: 3, unit: 'l', waste: 5 }))).toBe(3.2);
    expect(materialCost(newMaterial({ qty: 2, unit: 'st', price: 100 }))).toBe(200);
  });

  it('räknar totalsumma med ROT på arbetskostnaden', () => {
    const p = emptyProject();
    const t = newTask({ who: 'contractor', laborCost: 10000, hours: 10 });
    p.tasks.push(t, newTask({ who: 'self', hours: 5 }));
    p.materials.push(newMaterial({ qty: 1, price: 2000, buyer: 'contractor', taskId: t.id }), newMaterial({ qty: 2, price: 500 }));
    const tot = totals(p);
    expect(tot.labor).toBe(10000);
    expect(tot.rot).toBe(3000);
    expect(tot.materials).toBe(3000);
    expect(tot.total).toBe(10000);
    expect(tot.hours).toBe(15);
  });

  it('väggyta drar av 10 % för öppningar', () => {
    expect(wallArea({ perimeter: 10, height: 2.5 })).toBe(22.5);
  });
});

describe('tidsplan', () => {
  it('räknar dagar från timmar och personer', () => {
    expect(taskDays(newTask({ hours: 16, people: 1 }), 8)).toBe(2);
    expect(taskDays(newTask({ hours: 16, people: 2 }), 8)).toBe(1);
    expect(taskDays(newTask({ hours: 3 }), 8)).toBe(1);
    expect(taskDays(newTask({ hours: 0 }), 8)).toBe(0);
  });

  it('hoppar över helger och följer fasordning', () => {
    const p = emptyProject();
    p.startDate = '2026-11-27'; // fredag
    p.tasks.push(newTask({ name: 'Måla', phase: 'Ytskikt', hours: 16 }), newTask({ name: 'Riva', phase: 'Rivning', hours: 8 }));
    const s = schedule(p);
    expect(s.rows.map((r) => r.task.name)).toEqual(['Riva', 'Måla']);
    expect(s.rows[0].start?.toISOString().slice(0, 10)).toBe('2026-11-27');
    expect(s.rows[1].start?.toISOString().slice(0, 10)).toBe('2026-11-30'); // måndag
    expect(s.end?.toISOString().slice(0, 10)).toBe('2026-12-01');
    expect(s.workdays).toBe(3);
  });
});

describe('mallar, offerter och inköpslistor', () => {
  const room = { id: 'r1', name: 'Badrum', area: 5, perimeter: 9, height: 2.4 };

  it('alla mallar ger moment med material', () => {
    for (const tpl of TEMPLATES) {
      const { tasks, materials } = applyTemplate(tpl, room, room);
      expect(tasks.length).toBeGreaterThan(0);
      expect(materials.every((m) => tasks.some((t) => t.id === m.taskId))).toBe(true);
      expect(materials.every((m) => Number.isFinite(m.qty) && m.qty >= 0)).toBe(true);
    }
  });

  it('skapar offertförfrågan per yrke', () => {
    const p = emptyProject('Badrum');
    p.rooms.push(room);
    const r = applyTemplate(TEMPLATES.find((t) => t.id === 'bath')!, room, room);
    p.tasks.push(...r.tasks);
    p.materials.push(...r.materials);
    p.contact.name = 'Testa Testsson';
    expect(quoteTrades(p)).toEqual(['Elektriker', 'Rörmokare', 'Plattsättare']);
    const text = quoteText(p, 'Plattsättare');
    expect(text).toContain('Tätskikt på golv och väggar');
    expect(text).toContain('Badrum (golv 5 m²');
    expect(text).toContain('Kakel vägg');
    expect(text).toContain('våtrum');
    expect(text).toContain('Testa Testsson');
    expect(text).not.toContain('Byta rör');
  });

  it('grupperar inköpslistan och utesluter hantverkarens material', () => {
    const p = emptyProject();
    p.materials.push(newMaterial({ name: 'A', store: 'Bauhaus' }), newMaterial({ name: 'B' }), newMaterial({ name: 'C', buyer: 'contractor' }));
    const g = shoppingGroups(p, 'store');
    expect(g.map((x) => x.name)).toEqual(['Bauhaus', 'Ingen butik vald']);
    expect(g.flatMap((x) => x.items).map((m) => m.name)).toEqual(['A', 'B']);
    expect(materialsCSV(p).split('\r\n')).toHaveLength(4);
  });
});

describe('filer', () => {
  it('läser in projekt och fyller i saknade fält', () => {
    const p = normalizeProject({ name: 'X', tasks: [{ name: 'T', hours: '3,5' }], materials: [{ name: 'M' }] });
    expect(p.tasks[0].hours).toBe(3.5);
    expect(p.tasks[0].who).toBe('self');
    expect(p.materials[0].unit).toBe('st');
    expect(() => normalizeProject({ walls: [] })).toThrow();
  });

  it('räknar ut rum från en planfil från Planritaren', () => {
    const r = roomsFromPlan({ name: 'P', rooms: [{ name: 'Kök', points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 4000 }, { x: 0, y: 4000 }] }] });
    expect(r.rooms[0]).toEqual({ name: 'Kök', area: 12, perimeter: 14 });
  });
});
