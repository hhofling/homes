import { describe, expect, it } from 'vitest';
import { generateSteps, KINDS, kindOf, roughEstimate, progress } from '../src/hem/kinds';
import { emptyHomeProject, normalizeHomeProject, planProject } from '../src/hem/store';
import { copyPlan, linkedCalc, projectBuild, projectSite, roomPlan } from '../src/hem/tools';
import { normalizePlan } from '../src/store';
import { normalizeSite } from '../src/tomt/store';
import { normalizeProject } from '../src/projekt/store';

const lib = () => ({ plans: new Map(), sites: new Map(), builds: new Map() }) as any;

describe('Hemprojekt', () => {
  it('ger en plan för alla projekttyper', () => {
    for (const k of KINDS) {
      const steps = generateSteps({ kind: k.id, who: 'mix', budget: 0, deadline: '', place: '' });
      expect(steps.length).toBeGreaterThan(5);
      expect(steps.some((s) => s.title.includes('budget'))).toBe(true);
    }
  });

  it('anpassar stegen efter svaren', () => {
    const self = generateSteps({ kind: 'bath', who: 'self', budget: 100000, deadline: '', place: 'Badrum' });
    const hired = generateSteps({ kind: 'bath', who: 'contractor', budget: 100000, deadline: '', place: 'Badrum' });
    expect(self.some((s) => s.action === 'bygg-quotes')).toBe(false);
    expect(hired.some((s) => s.action === 'bygg-quotes')).toBe(true);
    expect(self.some((s) => s.title === 'Bestäm en budget')).toBe(false);
    const deck = generateSteps({ kind: 'deck', who: 'self', budget: 0, deadline: '', place: '' });
    expect(deck.some((s) => s.action === 'tomt')).toBe(true);
    expect(deck.some((s) => s.action === 'plan-now')).toBe(false);
  });

  it('räknar en grov uppskattning', () => {
    const p = { kind: 'bath', size: { length: 2, width: 2, height: 2.4 }, who: 'contractor' as const };
    expect(roughEstimate(p)).toBe(140000);
    expect(roughEstimate({ ...p, kind: 'other' })).toBe(0);
  });

  it('skapar ett projekt från guiden och läser tillbaka det', () => {
    const p = planProject({ kind: 'kitchen', name: 'Köket', budget: 200000 });
    expect(p.status).toBe('planning');
    expect(p.steps.length).toBeGreaterThan(5);
    const back = normalizeHomeProject(JSON.parse(JSON.stringify(p)));
    expect(back).toEqual(p);
    expect(progress(back)).toBe(0);
    expect(() => normalizeHomeProject({})).toThrow();
  });

  it('ritar rummet i Planritarens format', () => {
    const p = emptyHomeProject('bath');
    p.size = { length: 3, width: 2, height: 2.4 };
    const plan = normalizePlan(JSON.parse(JSON.stringify(roomPlan(p))));
    expect(plan.walls).toHaveLength(4);
    expect(plan.rooms).toHaveLength(1);
    expect(plan.openings.map((o) => o.kind).sort()).toEqual(['door', 'window']);
    const copy = copyPlan(plan, 'Förslag');
    expect(copy.id).not.toBe(plan.id);
    expect(copy.walls).toHaveLength(4);
  });

  it('gör kalkyl i Byggplanerarens format från rummets mått', () => {
    const p = emptyHomeProject('bath');
    p.who = 'contractor';
    p.size = { length: 2.5, width: 2, height: 2.4 };
    const b = normalizeProject(JSON.parse(JSON.stringify(projectBuild(p, lib()))));
    expect(b.tasks.length).toBeGreaterThan(3);
    expect(b.materials.length).toBeGreaterThan(3);
    expect(b.rooms[0].area).toBe(5);
    expect(b.tasks.every((t) => t.who === 'contractor')).toBe(true);
    const l = lib();
    l.builds.set(b.id, b);
    p.links.builds.push(b.id);
    expect(linkedCalc(p, l).total).toBeGreaterThan(0);
  });

  it('ritar tomten och räknar kalkyl därifrån', () => {
    const p = emptyHomeProject('attefall');
    p.size = { length: 6, width: 5, height: 0 };
    const site = normalizeSite(JSON.parse(JSON.stringify(projectSite(p))));
    expect(site.buildings.map((b) => b.kind)).toEqual(['house', 'attefall']);
    const l = lib();
    l.sites.set(site.id, site);
    p.links.sites.push(site.id);
    const b = projectBuild(p, l);
    expect(b.tasks.length).toBeGreaterThan(3);
    const deck = projectSite({ ...emptyHomeProject('deck'), size: { length: 6, width: 4, height: 0 } });
    expect(deck.areas[0].kind).toBe('deck');
    expect(kindOf('finns-inte').id).toBe('other');
  });
});
