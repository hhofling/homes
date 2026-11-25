import { describe, expect, it } from 'vitest';
import { bbox, collageLayout, hit, moveItem, placeInside, resizeBox, simplify, topHit, type Item } from '../src/bilder/model';
import { buildPrompt, modelVersion, rankImageModels } from '../src/bilder/ai';

describe('skissens föremål', () => {
  const pen: Item = { kind: 'pen', id: 'p', points: [0, 0, 100, 0], color: '#f00', width: 10 };
  const img: Item = { kind: 'image', id: 'i', src: 'x', x: 10, y: 10, w: 200, h: 100, opacity: 1 };
  const base: Item = { kind: 'image', id: 'b', src: 'y', x: 0, y: 0, w: 1000, h: 800, opacity: 1, locked: true };

  it('träffar penndrag nära linjen men inte långt bort', () => {
    expect(hit(pen, 50, 6, 4)).toBe(true);
    expect(hit(pen, 50, 30, 4)).toBe(false);
  });

  it('hoppar över låst bakgrundsbild och tar översta föremålet', () => {
    expect(topHit([base, img, pen], 50, 2, 4)?.id).toBe('p');
    expect(topHit([base, img], 500, 500, 4)).toBeUndefined();
    expect(topHit([base, img], 50, 50, 4)?.id).toBe('i');
  });

  it('flyttar penndrag och bilder', () => {
    expect((moveItem(pen, 5, 7) as any).points).toEqual([5, 7, 105, 7]);
    expect(bbox(moveItem(img, -10, 0))).toEqual({ x: 0, y: 10, w: 200, h: 100 });
  });

  it('ändrar storlek med bibehållna proportioner för bilder', () => {
    const b = resizeBox({ x: 0, y: 0, w: 200, h: 100 }, 'se', 200, 0, true);
    expect(b).toEqual({ x: 0, y: 0, w: 400, h: 200 });
    const nw = resizeBox({ x: 100, y: 100, w: 200, h: 100 }, 'nw', 100, 0, false);
    expect(nw).toEqual({ x: 200, y: 100, w: 100, h: 100 });
  });

  it('förenklar penndrag', () => {
    const pts = [0, 0, 0.5, 0, 1, 0, 1.5, 0, 10, 0];
    expect(simplify(pts, 2)).toEqual([0, 0, 10, 0]);
  });

  it('lägger bilder i ett kollage utan överlapp', () => {
    const lay = collageLayout([
      { w: 400, h: 300 },
      { w: 300, h: 300 },
      { w: 800, h: 400 },
    ]);
    expect(lay.boxes).toHaveLength(3);
    // två i första raden, med samma höjd
    expect(lay.boxes[0].h).toBe(lay.boxes[1].h);
    expect(lay.boxes[0].x + lay.boxes[0].w).toBeLessThan(lay.boxes[1].x);
    expect(lay.boxes[2].y).toBeGreaterThan(lay.boxes[0].y + lay.boxes[0].h);
    for (const b of lay.boxes) expect(b.x + b.w).toBeLessThanOrEqual(lay.width);
    expect(lay.height).toBeGreaterThan(lay.boxes[2].y + lay.boxes[2].h);
  });

  it('placerar en ny bild centrerat i skissen', () => {
    expect(placeInside({ width: 1000, height: 1000 }, { w: 400, h: 200 }, 0.5)).toEqual({ x: 250, y: 375, w: 500, h: 250 });
  });
});

describe('AI', () => {
  it('väljer den senaste bildmodellen', () => {
    expect(modelVersion('gemini-2.5-flash-image')).toBe(2.5);
    expect(modelVersion('gpt-image-1.5')).toBe(1.5);
    expect(
      rankImageModels('gemini', ['models/gemini-2.5-flash', 'models/gemini-2.5-flash-image', 'models/gemini-3-pro-image-preview', 'models/imagen-4.0-generate-001', 'models/gemini-3-pro-image'])[0],
    ).toBe('gemini-3-pro-image');
    expect(rankImageModels('openai', ['gpt-4o', 'gpt-image-1', 'gpt-image-2', 'gpt-image-2-2026-04-21', 'gpt-image-1-mini', 'dall-e-3'])).toEqual(['gpt-image-2', 'gpt-image-1']);
  });

  it('beskriver bilderna i rätt ordning för AI', () => {
    const p = buildPrompt({ wish: 'Bygg en veranda', hasSketch: true, refCount: 2, marked: true });
    expect(p).toContain('Image 1 is the picture to edit');
    expect(p).toContain('Image 2 is the same picture');
    expect(p).toContain('pink');
    expect(p).toContain('Images 3–4 are reference pictures');
    expect(p).toContain('Bygg en veranda');
    const q = buildPrompt({ wish: 'Gör ett hus', hasSketch: false, refCount: 1, fromScratch: true });
    expect(q).toContain('rough sketch or collage');
    expect(q).toContain('Image 2 is a reference picture');
    expect(q).not.toContain('Keep everything');
  });
});
