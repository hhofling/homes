/**
 * AI-redigering av bilder. Bilderna skickas direkt från webbläsaren till den AI-tjänst man valt
 * (Google Gemini eller OpenAI) med ens egen nyckel. Nyckeln sparas bara i den här webbläsaren.
 */

export type Provider = 'gemini' | 'openai';

export interface AiSettings {
  provider: Provider;
  keys: Partial<Record<Provider, string>>;
  /** Tom sträng = välj den senaste modellen automatiskt. */
  models: Partial<Record<Provider, string>>;
}

export const PROVIDERS: Record<Provider, { name: string; keyUrl: string; keyHelp: string; fallbackModel: string }> = {
  gemini: {
    name: 'Google Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHelp: 'Logga in med ett Google-konto på Google AI Studio och välj "Create API key". Bildredigering kostar ungefär 0,4–1,5 kr per bild.',
    fallbackModel: 'gemini-2.5-flash-image',
  },
  openai: {
    name: 'OpenAI (samma som ChatGPT)',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHelp: 'Logga in på OpenAI-plattformen, lägg in betalkort under Billing och skapa en nyckel under "API keys". Ungefär 0,5–2 kr per bild.',
    fallbackModel: 'gpt-image-1',
  },
};

const SETTINGS_KEY = 'bildbiblioteket.ai.v1';

export function loadSettings(): AiSettings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (s && (s.provider === 'gemini' || s.provider === 'openai')) return { provider: s.provider, keys: s.keys ?? {}, models: s.models ?? {} };
  } catch {
    /* ignorera */
  }
  return { provider: 'gemini', keys: {}, models: {} };
}

export function saveSettings(s: AiSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignorera */
  }
}

export const hasKey = (s: AiSettings) => !!s.keys[s.provider]?.trim();

// ---------- Välja modell ----------

/** Versionsnummer i ett modellnamn, t.ex. "gemini-3-pro-image" → 3, "gpt-image-1.5" → 1.5. */
export function modelVersion(name: string): number {
  const m = name.match(/(?:gemini|image)-(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

/** Bildmodeller i listan från tjänsten, bäst först (högst version, färdiga före förhandsversioner). */
export function rankImageModels(provider: Provider, names: string[]): string[] {
  const ids = names.map((n) => n.replace(/^models\//, ''));
  const keep =
    provider === 'gemini'
      ? ids.filter((n) => /^gemini-.*image/.test(n) && !/imagen|tts|embedding|live|audio/.test(n))
      : ids.filter((n) => /^(gpt|chatgpt)-image/.test(n) && !/\d{4}-\d{2}-\d{2}/.test(n) && !/mini/.test(n));
  const score = (n: string) => modelVersion(n) * 10 - (/preview|exp|beta/.test(n) ? 1 : 0) + (/latest/.test(n) ? 0.5 : 0);
  return [...new Set(keep)].sort((a, b) => score(b) - score(a) || a.localeCompare(b));
}

export async function listModels(provider: Provider, key: string): Promise<string[]> {
  if (provider === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(key)}`);
    if (!r.ok) throw await apiError(provider, r);
    const j = await r.json();
    const names = (j.models ?? []).filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent')).map((m: any) => m.name);
    return rankImageModels(provider, names);
  }
  const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) throw await apiError(provider, r);
  const j = await r.json();
  return rankImageModels(provider, (j.data ?? []).map((m: any) => m.id));
}

const modelCache: Partial<Record<Provider, string>> = {};

async function chooseModel(s: AiSettings): Promise<string> {
  const chosen = s.models[s.provider]?.trim();
  if (chosen) return chosen;
  if (modelCache[s.provider]) return modelCache[s.provider]!;
  try {
    const list = await listModels(s.provider, s.keys[s.provider]!.trim());
    if (list[0]) return (modelCache[s.provider] = list[0]);
  } catch (err) {
    if ((err as AiError).kind === 'key') throw err;
  }
  return PROVIDERS[s.provider].fallbackModel;
}

// ---------- Instruktionen till AI ----------

export interface EditRequest {
  /** Vad användaren vill (på svenska). */
  wish: string;
  /** Bilden som ska ändras, utan streck. */
  image: Blob;
  /** Samma bild med skissen och markeringarna ovanpå – utelämnas om inget är ritat. */
  sketch?: Blob;
  /** Har användaren markerat ett område med "Ändra här"? */
  marked?: boolean;
  /** Mask för OpenAI: genomskinlig där bilden får ändras. */
  mask?: Blob;
  /** Bilder som visar stil, material eller saker att använda. */
  references: Blob[];
  /** Ny bild från en skiss (inget foto) – då ska resultatet vara en ny bild, inte en ändrad. */
  fromScratch?: boolean;
}

export function buildPrompt(req: Pick<EditRequest, 'wish' | 'marked' | 'fromScratch'> & { hasSketch: boolean; refCount: number }): string {
  const lines: string[] = [];
  let n = 1;
  if (req.fromScratch) {
    lines.push(
      `You are helping a homeowner visualise a home or garden design idea. Image ${n} is a rough sketch or collage they made.`,
      'Turn it into a realistic, high-quality image that follows the sketch: keep its layout, proportions, placement and the things it shows.',
    );
  } else {
    lines.push(
      `You are editing a photo for a homeowner who is planning changes to their house, rooms or garden. Image ${n} is the picture to edit.`,
    );
  }
  if (req.hasSketch) {
    n++;
    lines.push(
      `Image ${n} is the same picture with the homeowner's rough hand-drawn sketch, arrows and notes on top, showing what they want and where.` +
        (req.marked ? ' The semi-transparent pink/magenta painted area marks exactly where the change should happen.' : '') +
        ' Use the sketch only as a guide for placement, size and shape. Do NOT draw the sketch lines, arrows, pink marks or note text in the result.',
    );
  }
  if (req.refCount > 0) {
    const first = n + 1;
    const last = n + req.refCount;
    lines.push(
      `${req.refCount === 1 ? `Image ${first} is a reference picture` : `Images ${first}–${last} are reference pictures`} showing the style, materials or objects the homeowner wants to use.`,
    );
  }
  if (!req.fromScratch) {
    lines.push(
      'Keep everything that is not part of the requested change exactly as it is: same camera angle, framing, perspective, lighting, season and surroundings. The result should look like a real photo of the same place after the change, built in a realistic and buildable way.',
    );
  }
  lines.push(`The homeowner's request (in Swedish): """${req.wish.trim()}"""`, 'Return only the finished image.');
  return lines.join('\n\n');
}

// ---------- Anrop ----------

export class AiError extends Error {
  constructor(
    message: string,
    public kind: 'key' | 'quota' | 'blocked' | 'network' | 'other' = 'other',
  ) {
    super(message);
  }
}

async function apiError(provider: Provider, r: Response): Promise<AiError> {
  let detail = '';
  try {
    const j = await r.json();
    detail = j?.error?.message ?? '';
  } catch {
    /* ignorera */
  }
  const name = PROVIDERS[provider].name;
  if (r.status === 401 || r.status === 403 || /api key not valid|incorrect api key|invalid api key|permission/i.test(detail))
    return new AiError(`${name} godtog inte nyckeln. Kontrollera att den är rätt inklistrad under AI-inställningar.`, 'key');
  if (r.status === 429 || /quota|billing|insufficient|credit/i.test(detail))
    return new AiError(`${name} säger att gränsen är nådd eller att det saknas betalning/krediter på kontot. ${detail ? `(${detail})` : ''}`, 'quota');
  if (/safety|policy|moderation|blocked/i.test(detail))
    return new AiError('AI-tjänsten ville inte göra den här bilden (den stoppas t.ex. om det finns personer eller något känsligt i bilden). Prova att formulera om dig.', 'blocked');
  if (r.status === 404 && /model/i.test(detail))
    return new AiError(`Modellen finns inte hos ${name}. Välj "Automatiskt" som modell under AI-inställningar. (${detail})`, 'other');
  return new AiError(`${name} svarade med fel ${r.status}${detail ? `: ${detail}` : ''}`);
}

async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new AiError(
      'Kunde inte nå AI-tjänsten. Kontrollera internetanslutningen. (I Claude-versionen av Bildbiblioteket går det inte att skicka bilder vidare – använd webbsidan eller knappen "Gör det själv i ChatGPT/Gemini".)',
      'network',
    );
  }
}

const toBase64 = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(new Error('Kunde inte läsa bilden'));
    r.readAsDataURL(b);
  });

function b64ToBlob(b64: string, type = 'image/png') {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export interface EditResult {
  image: Blob;
  model: string;
  /** Text som AI skickade med (t.ex. en förklaring). */
  text?: string;
}

export async function editImage(s: AiSettings, req: EditRequest, signal?: AbortSignal): Promise<EditResult> {
  const key = s.keys[s.provider]?.trim();
  if (!key) throw new AiError('Ingen AI-nyckel är inlagd ännu.', 'key');
  const model = await chooseModel(s);
  const prompt = buildPrompt({ wish: req.wish, marked: req.marked, fromScratch: req.fromScratch, hasSketch: !!req.sketch, refCount: req.references.length });
  const images = [req.image, ...(req.sketch ? [req.sketch] : []), ...req.references];

  if (s.provider === 'gemini') {
    const parts: any[] = [];
    for (const img of images) parts.push({ inline_data: { mime_type: img.type || 'image/jpeg', data: await toBase64(img) } });
    parts.push({ text: prompt });
    const r = await safeFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
      signal,
    });
    if (!r.ok) throw await apiError('gemini', r);
    const j = await r.json();
    const cand = j.candidates?.[0];
    const outParts: any[] = cand?.content?.parts ?? [];
    const imgPart = outParts.find((p) => p.inlineData?.data || p.inline_data?.data);
    const text = outParts
      .filter((p) => typeof p.text === 'string' && !p.thought)
      .map((p) => p.text)
      .join('\n')
      .trim();
    if (!imgPart) {
      const reason = cand?.finishReason || j.promptFeedback?.blockReason;
      if (reason && /SAFETY|BLOCK|PROHIBITED|IMAGE_OTHER|RECITATION/i.test(reason))
        throw new AiError('AI-tjänsten ville inte göra den här bilden (den stoppas t.ex. om det finns personer eller något känsligt i bilden). Prova att formulera om dig.', 'blocked');
      throw new AiError(text ? `AI svarade utan bild: ”${text.slice(0, 400)}”` : 'AI svarade utan någon bild. Försök igen eller formulera om dig.');
    }
    const d = imgPart.inlineData ?? imgPart.inline_data;
    return { image: b64ToBlob(d.data, d.mimeType ?? d.mime_type ?? 'image/png'), model, text: text || undefined };
  }

  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  images.forEach((img, i) => form.append('image[]', img, `bild${i + 1}.${img.type === 'image/png' ? 'png' : 'jpg'}`));
  if (req.mask) form.append('mask', req.mask, 'mask.png');
  form.append('n', '1');
  const r = await safeFetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal });
  if (!r.ok) throw await apiError('openai', r);
  const j = await r.json();
  const b64 = j.data?.[0]?.b64_json;
  if (b64) return { image: b64ToBlob(b64, j.output_format ? `image/${j.output_format}` : 'image/png'), model, text: j.data?.[0]?.revised_prompt };
  const url = j.data?.[0]?.url;
  if (url) return { image: await (await safeFetch(url, {})).blob(), model };
  throw new AiError('AI svarade utan någon bild. Försök igen.');
}
