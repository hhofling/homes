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
};
