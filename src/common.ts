/** Hjälpfunktioner som delas av Planritaren och Byggplaneraren. */

/** Körs sidan inuti en Claude-artefakt? Där sparas filer via plattformens nedladdningsfunktion. */
export const inArtifact = () => typeof (window as any).claude?.use === 'function';

export async function download(blob: Blob, filename: string) {
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

export function safeFilename(name: string, fallback = 'plan') {
  return (name.trim() || fallback).replace(/[^\p{L}\p{N}\- _]+/gu, '').replace(/\s+/g, '-').slice(0, 60) || fallback;
}

/** Adresser till verktygen när de körs som Claude-artefakter (där vanliga länkar mellan sidorna inte fungerar). */
export const ARTIFACT_LINKS = {
  planritaren: 'https://claude.ai/artifact/T9Rqjaa8q4FGmbQMprwqtP',
  byggplaneraren: 'https://claude.ai/artifact/AEJ4xDWqUNu9A38hpPRKA7',
  tomtplaneraren: 'https://claude.ai/artifact/MbcjYyQs1HRKN22enBCZuv',
  hemprojekt: 'https://claude.ai/artifact/ESoS57WZfTar5Vx9mUiCWJ',
};

/** Sidan för varje verktyg på webbplatsen. */
export const TOOL_PAGES = {
  planritaren: './index.html',
  byggplaneraren: './byggprojekt.html',
  tomtplaneraren: './tomt.html',
  hemprojekt: './hem.html',
} as const;

/** Namn som visas när något skickas mellan verktygen. */
export const TOOL_NAMES: Record<string, string> = {
  planritaren: 'Planritaren',
  byggplaneraren: 'Byggplaneraren',
  tomtplaneraren: 'Tomtplaneraren',
  hemprojekt: 'Hemprojekt',
};

// ----- Skicka data mellan verktygen (samma webbläsare) -----

type Tool = 'planritaren' | 'byggplaneraren' | 'tomtplaneraren';
const handoffKey = (tool: Tool) => `${tool}.handoff.v1`;

/** Lämna över en plan/ett projekt till ett annat verktyg. Returnerar false om lagringen inte går att använda. */
export function sendHandoff(tool: Tool, payload: unknown, from = 'tomtplaneraren'): boolean {
  try {
    localStorage.setItem(handoffKey(tool), JSON.stringify({ ts: Date.now(), payload, from }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Tar emot något som ett annat verktyg lämnat över, både när sidan laddas och om den redan är öppen
 * i en annan flik. Varje överlämning tas emot en gång per flik och bara om den är färsk.
 */
export function receiveHandoff(tool: Tool, fn: (payload: any, from: string) => void) {
  const key = handoffKey(tool);
  const check = () => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const { ts, payload, from } = JSON.parse(raw);
      if (typeof ts !== 'number' || Date.now() - ts > 5 * 60 * 1000) return;
      const seen = `${key}.seen`;
      if (sessionStorage.getItem(seen) === String(ts)) return;
      sessionStorage.setItem(seen, String(ts));
      fn(payload, TOOL_NAMES[from] ?? 'Tomtplaneraren');
    } catch {
      /* ignorera */
    }
  };
  check();
  window.addEventListener('storage', (e) => {
    if (e.key === key) check();
  });
}

/** Läser ett värde ur adressraden (t.ex. ?plan=…) och tar bort det så att det inte används igen vid omladdning. */
export function takeParam(name: string): string | null {
  const url = new URL(location.href);
  const v = url.searchParams.get(name);
  if (v === null) return null;
  url.searchParams.delete(name);
  try {
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch {
    /* ignorera */
  }
  return v;
}

/** Adress till ett verktyg: relativ länk på webbplatsen, artefaktadress inuti en artefakt. */
export function toolUrl(tool: keyof typeof ARTIFACT_LINKS, page: string) {
  return inArtifact() ? ARTIFACT_LINKS[tool] : page;
}

/** Gör en länk i verktygsraden rätt: artefaktadress inuti en artefakt (eller dold om den saknas), annars en egen flik per verktyg. */
export function linkTool(a: HTMLAnchorElement | null, tool: keyof typeof ARTIFACT_LINKS) {
  if (!a) return;
  if (inArtifact()) {
    if (ARTIFACT_LINKS[tool]) {
      a.href = ARTIFACT_LINKS[tool];
      a.target = '_blank';
      a.rel = 'noopener';
    } else a.hidden = true;
  } else a.target = tool;
}
