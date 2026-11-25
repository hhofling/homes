import { describe, it, expect } from 'vitest';
import { detectWalls, detectionToPlan } from '../src/bildtolkning';
import { polygonArea } from '../src/geometry';

/** Ritar en enkel planritning i pixlar: 100 px per meter, svarta fyllda väggar. */
function drawPlan() {
  const W = 1000;
  const H = 800;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const rect = (x0: number, y0: number, x1: number, y1: number, v = 0) => {
    for (let y = Math.round(y0); y < Math.round(y1); y++)
      for (let x = Math.round(x0); x < Math.round(x1); x++) {
        const i = (y * W + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
      }
  };
  const ox = 100;
  const oy = 100;
  const T = 25; // ytterväggar 25 cm
  const t = 12; // innerväggar 12 cm
  // Ytterväggar 8 x 6 m
  rect(ox - T / 2, oy - T / 2, ox + 800 + T / 2, oy + T / 2);
  rect(ox - T / 2, oy + 600 - T / 2, ox + 800 + T / 2, oy + 600 + T / 2);
  rect(ox - T / 2, oy - T / 2, ox + T / 2, oy + 600 + T / 2);
  rect(ox + 800 - T / 2, oy - T / 2, ox + 800 + T / 2, oy + 600 + T / 2);
  // Innervägg vid x = 5 m med en dörr (0,9 m) mellan 2 och 2,9 m
  rect(ox + 500 - t / 2, oy, ox + 500 + t / 2, oy + 200);
  rect(ox + 500 - t / 2, oy + 290, ox + 500 + t / 2, oy + 600);
  // Fönster i övre väggen 1–2,5 m: glapp med tunna linjer
  rect(ox + 100, oy - T / 2, ox + 250, oy + T / 2, 255);
  rect(ox + 100, oy - 6, ox + 250, oy - 4);
  rect(ox + 100, oy + 4, ox + 250, oy + 6);
  // Ytterdörr i nedre väggen 6–7 m (tomt glapp)
  rect(ox + 600, oy + 600 - T / 2, ox + 700, oy + 600 + T / 2, 255);
  // Lite text (tunna streck) som inte ska bli väggar
  for (let i = 0; i < 6; i++) rect(ox + 150 + i * 14, oy + 300, ox + 153 + i * 14, oy + 320);
  return { width: W, height: H, data };
}

describe('Ritning från bild', () => {
  const det = detectWalls(drawPlan());
  const { plan } = detectionToPlan(det, { mmPerPx: 10 });

  it('hittar väggarnas tjocklek', () => {
    expect(det.wallThickness).toBeGreaterThanOrEqual(23);
    expect(det.wallThickness).toBeLessThanOrEqual(26);
  });

  it('gör ytterväggar och en innervägg i rätt mått', () => {
    const outer = plan.walls.filter((w) => w.thickness >= 200);
    const inner = plan.walls.filter((w) => w.thickness < 200);
    expect(outer).toHaveLength(4);
    expect(inner).toHaveLength(1);
    const xs = outer.flatMap((w) => [w.a.x, w.b.x]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(8000, -2);
    expect(inner[0].thickness).toBeCloseTo(120, -1);
  });

  it('känner igen fönster och dörrar', () => {
    const windows = plan.openings.filter((o) => o.kind === 'window');
    const doors = plan.openings.filter((o) => o.kind === 'door');
    expect(windows).toHaveLength(1);
    expect(windows[0].width).toBeCloseTo(1500, -2);
    expect(doors).toHaveLength(2);
  });

  it('hittar två rum med rimliga ytor', () => {
    expect(plan.rooms).toHaveLength(2);
    const areas = plan.rooms.map((r) => polygonArea(r.points) / 1e6).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(18, 0); // 3 x 6 m
    expect(areas[1]).toBeCloseTo(30, 0); // 5 x 6 m
  });
});
