import type { Plan } from './types';
import { renderPlan, planBounds, esc, PAPER, type RenderOptions } from './render';

const MARGIN = 800;

export function planToSVG(plan: Plan, opts: RenderOptions): { svg: string; width: number; height: number } {
  const b = planBounds(plan) ?? { minX: 0, minY: 0, maxX: 5000, maxY: 4000 };
  const x = b.minX - MARGIN;
  const y = b.minY - MARGIN;
  const width = b.maxX - b.minX + 2 * MARGIN;
  const height = b.maxY - b.minY + 2 * MARGIN + 500;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${Math.round(width / 10) / 10}mm" height="${Math.round(height / 10) / 10}mm">` +
    `<title>${esc(plan.name)}</title>` +
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${PAPER}"/>` +
    renderPlan(plan, opts) +
    `<text x="${x + 300}" y="${y + height - 300}" font-size="200" fill="#5b6b7c" font-family="system-ui, sans-serif">${esc(plan.name)} · ${new Date().toLocaleDateString('sv-SE')}</text>` +
    `</svg>`;
  return { svg, width, height };
}

/** Körs sidan inuti en Claude-artefakt? Där sparas filer via plattformens nedladdningsfunktion. */
export const inArtifact = () => typeof (window as any).claude?.use === 'function';

async function download(blob: Blob, filename: string) {
  if (inArtifact()) {
    const downloads = await (window as any).claude.use('downloads');
    if (!downloads) throw new Error('Nedladdning är inte tillgänglig här');
    try {
      await downloads.save({ filename, data: blob });
    } catch (err: any) {
      if (err?.code === 'declined') return;
      throw new Error(err?.message || 'Nedladdningen misslyckades');
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFilename(name: string) {
  return (name.trim() || 'plan').replace(/[^\p{L}\p{N}\- _]+/gu, '').replace(/\s+/g, '-').slice(0, 60) || 'plan';
}

export async function downloadSVG(plan: Plan, opts: RenderOptions) {
  const { svg } = planToSVG(plan, opts);
  await download(new Blob([svg], { type: 'image/svg+xml' }), `${safeFilename(plan.name)}.svg`);
}

export async function downloadJSON(plan: Plan) {
  await download(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }), `${safeFilename(plan.name)}.plan.json`);
}

export async function downloadPNG(plan: Plan, opts: RenderOptions) {
  const { svg, width, height } = planToSVG(plan, opts);
  const scale = Math.min(4000 / width, 4000 / height, 0.4);
  const pw = Math.round(width * scale);
  const ph = Math.round(height * scale);
  const sized = svg.replace(/width="[^"]*mm" height="[^"]*mm"/, `width="${pw}" height="${ph}"`);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Kunde inte rendera bilden'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, pw, ph);
  ctx.drawImage(img, 0, 0, pw, ph);
  URL.revokeObjectURL(url);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (blob) await download(blob, `${safeFilename(plan.name)}.png`);
}
