import './style.css';
import { Store } from './store';
import { Editor } from './editor';
import { setupUI } from './ui';
import { downloadJSON, downloadPNG, downloadSVG, planToSVG, inArtifact } from './export';
import { ARTIFACT_LINKS, receiveHandoff } from './common';
import { normalizePlan } from './store';

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

// Länk till Tomtplaneraren (3D)
const tomtLink = document.querySelector<HTMLAnchorElement>('#link-tomt')!;
if (inArtifact()) {
  if (ARTIFACT_LINKS.tomtplaneraren) {
    tomtLink.href = ARTIFACT_LINKS.tomtplaneraren;
    tomtLink.target = '_blank';
    tomtLink.rel = 'noopener';
  } else tomtLink.hidden = true;
} else tomtLink.target = 'tomtplaneraren';

// Planritning som skickats hit från Tomtplaneraren
receiveHandoff('planritaren', (raw) => {
  const plan = normalizePlan(raw);
  const existing = store.plans.find((p) => p.id === plan.id);
  if (existing) store.switchTo(existing.id);
  else store.addPlan(plan);
  editor.select(null);
  requestAnimationFrame(() => editor.fitView());
  notify(`Öppnade "${store.plan.name}" från Tomtplaneraren. Ändringar här syns i 3D-vyn.`);
});

// Spara innan sidan stängs
window.addEventListener('beforeunload', () => store.save());
