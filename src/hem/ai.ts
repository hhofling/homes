/**
 * Fråga Claude – fungerar bara när sidan körs som Claude-artefakt (där finns plattformens "sample").
 * På den vanliga webbplatsen döljs knapparna.
 */
import { uid } from '../geometry';
import { inArtifact } from '../common';
import { ACTION_LABELS, kindOf, PHASES } from './kinds';
import type { HomeProject, Step, StepAction } from './types';

type Sample = ((input: string, opts?: any) => Promise<{ text: string }>) & { json?: (input: string, opts?: any) => Promise<any> };

let samplePromise: Promise<Sample | null> | null = null;
export function getSample(): Promise<Sample | null> {
  if (!inArtifact()) return Promise.resolve(null);
  samplePromise ??= (window as any).claude.use('sample').catch(() => null);
  return samplePromise!;
}

function describe(p: HomeProject): string {
  const k = kindOf(p.kind);
  const lines = [
    `Projekt: ${p.name} (typ: ${k.label})`,
    p.place && `Var: ${p.place}`,
    p.goal && `Mål: ${p.goal}`,
    p.size.length && p.size.width ? `Mått: ${p.size.length} × ${p.size.width} m${p.size.height ? `, takhöjd ${p.size.height} m` : ''}` : '',
    `Vem gör jobbet: ${p.who === 'self' ? 'jag själv' : p.who === 'contractor' ? 'hantverkare' : 'delvis själv, delvis hantverkare'}`,
    p.budget ? `Budget: ${p.budget} kr` : 'Ingen budget satt',
    p.deadline && `Klart till: ${p.deadline}`,
    p.wishes.length ? `Önskemål:\n${p.wishes.map((w) => `- ${w.text}${w.must ? ' (måste)' : ' (vore bra)'}`).join('\n')}` : '',
    p.ideas.filter((i) => i.text).length ? `Idéer:\n${p.ideas.filter((i) => i.text).map((i) => `- ${i.text}`).join('\n')}` : '',
    p.notes && `Anteckningar: ${p.notes}`,
    p.steps.length ? `Nuvarande steg:\n${p.steps.map((s) => `- [${s.done ? 'x' : ' '}] ${s.phase}: ${s.title}`).join('\n')}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

/** Ber Claude om råd: vad man ska tänka på, risker och förslag. Svaret skrivs ut medan det kommer. */
export async function askAdvice(p: HomeProject, question: string, onText: (t: string) => void, signal?: AbortSignal): Promise<string> {
  const sample = await getSample();
  if (!sample) throw new Error('Claude är inte tillgängligt här');
  const prompt = `Du hjälper en privatperson i Sverige att planera ett hemprojekt. Personen är inte byggkunnig – svara på enkel svenska utan facktermer, kort och konkret, med punktlistor där det passar. Nämn svenska regler (bygglov, anmälan, ROT, behörigheter) när de är relevanta, men säg att kommunen har sista ordet.

${describe(p)}

Fråga: ${question || 'Titta på projektet och ge de viktigaste råden: vad ska jag tänka på, vad glömmer man lätt, och är budgeten rimlig?'}`;
  const res = await sample(prompt, { onText: ({ text }: { text: string }) => onText(text), signal, cache: false });
  return res.text;
}

const ACTIONS = Object.keys(ACTION_LABELS) as StepAction[];

/** Ber Claude föreslå en plan steg för steg. */
export async function suggestSteps(p: HomeProject): Promise<Step[]> {
  const sample = await getSample();
  if (!sample?.json) throw new Error('Claude är inte tillgängligt här');
  const prompt = `Du hjälper en privatperson i Sverige att planera ett hemprojekt. Gör en tydlig plan steg för steg på enkel svenska (inga facktermer), anpassad efter mål, önskemål, budget och vem som gör jobbet.

${describe(p)}

Varje steg hör till en av faserna: ${PHASES.join(', ')}.
Ett steg kan ha en "action" som öppnar rätt verktyg: ${ACTIONS.map((a) => `"${a}" (${ACTION_LABELS[a]})`).join(', ')}. Använd plan-now/plan-new/plan-3d för ritningar av rum, tomt för tomten, bygg för kalkyl/material, bygg-quotes för offerter, bygg-schedule för tidsplan, bygg-shopping för inköp. Utelämna action om inget verktyg passar.

Svara ENBART med JSON: {"steps":[{"phase":"…","title":"kort rubrik","detail":"en till två meningar","action":"…"}]} med 8–16 steg i rätt ordning.`;
  const res = await sample.json(prompt, { cache: false });
  const list: any[] = Array.isArray(res?.steps) ? res.steps : [];
  return list
    .filter((s) => s && typeof s.title === 'string')
    .slice(0, 30)
    .map((s) => ({
      id: uid('st'),
      title: String(s.title).slice(0, 200),
      detail: typeof s.detail === 'string' ? s.detail.slice(0, 1000) : '',
      phase: PHASES.includes(s.phase) ? s.phase : PHASES[5],
      action: ACTIONS.includes(s.action) ? s.action : undefined,
      done: false,
      note: '',
    }));
}
