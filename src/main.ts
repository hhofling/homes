import './style.css';
import { Store } from './store';
import { Editor } from './editor';
import { setupUI } from './ui';
import { downloadJSON, downloadPNG, downloadSVG, planToSVG, inArtifact } from './export';
import { ARTIFACT_LINKS } from './common';

const store = new Store();
const svg = document.querySelector<SVGSVGElement>('#canvas')!;
const editor = new Editor(svg, store);
setupUI(editor, store);

requestAnimationFrame(() => editor.fitView());

document.querySelector('#zoom-in')!.addEventListener('click', () => editor.zoomAt(1.25));
document.querySelector('#zoom-out')!.addEventListener('click', () => editor.zoomAt(0.8));
document.querySelector('#zoom-fit')!.addEventListener('click', () => editor.fitView());

const notify = (msg: string) => editor.onStatus({ hint: msg });
const run = (p: Promise<void>, what: string) => p.catch((err) => notify(`${what} misslyckades: ${err.message}`));
document.querySelector('#btn-png')!.addEventListener('click', () => run(downloadPNG(store.plan, editor.settings), 'Exporten'));
document.querySelector('#btn-svg')!.addEventListener('click', () => run(downloadSVG(store.plan, editor.settings), 'Exporten'));
document.querySelector('#btn-save')!.addEventListener('click', () => run(downloadJSON(store.plan), 'Sparandet'));

const fileInput = document.querySelector<HTMLInputElement>('#file-input')!;
document.querySelector('#btn-open')!.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  try {
    store.importPlan(JSON.parse(await file.text()));
    editor.select(null);
    editor.fitView();
  } catch (err) {
    notify(`Kunde inte öppna filen: ${(err as Error).message}`);
  }
});

// Utskrift fungerar inte inuti en artefakt
if (inArtifact()) (document.querySelector('#btn-print') as HTMLElement).hidden = true;
document.querySelector('#btn-print')!.addEventListener('click', () => {
  let area = document.querySelector<HTMLDivElement>('#print-area');
  if (!area) {
    area = document.createElement('div');
    area.id = 'print-area';
    document.body.appendChild(area);
  }
  area.innerHTML = planToSVG(store.plan, editor.settings).svg;
  window.print();
});

// Länk till Byggplaneraren (som artefakt öppnas den i en ny flik)
const byggLink = document.querySelector<HTMLAnchorElement>('#link-bygg')!;
if (inArtifact()) {
  if (ARTIFACT_LINKS.byggplaneraren) {
    byggLink.href = ARTIFACT_LINKS.byggplaneraren;
    byggLink.target = '_blank';
    byggLink.rel = 'noopener';
  } else byggLink.hidden = true;
}

// Spara innan sidan stängs
window.addEventListener('beforeunload', () => store.save());
