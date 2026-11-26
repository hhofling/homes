import './style.css';
import { Store } from './store';
import { Editor } from './editor';
import { setupUI } from './ui';
import { downloadJSON, downloadPNG, downloadSVG, planToSVG, inArtifact } from './export';
import { ARTIFACT_LINKS, linkTool, receiveHandoff, takeParam } from './common';
import { normalizePlan } from './store';
import { EXAMPLE_ID, examplePlans } from './exempel/hogbovagen333';
import { setupImageImport } from './bildimport';

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

linkTool(document.querySelector<HTMLAnchorElement>('#link-bilder'), 'bildbiblioteket');

// Planritning som skickats hit från Tomtplaneraren
receiveHandoff('planritaren', (raw, from) => {
  const plan = normalizePlan(raw);
  const existing = store.plans.find((p) => p.id === plan.id);
  if (existing) store.switchTo(existing.id);
  else store.addPlan(plan);
  editor.select(null);
  requestAnimationFrame(() => editor.fitView());
  notify(
    from === 'Tomtplaneraren'
      ? `Öppnade "${store.plan.name}" från Tomtplaneraren. Ändringar här syns i 3D-vyn.`
      : `Öppnade "${store.plan.name}" från ${from}.`,
  );
});

// Exempel: lägg till (eller visa) färdigritade planer
function openExample(id: string) {
  if (id !== EXAMPLE_ID) return;
  const plans = examplePlans();
  for (const p of plans) if (!store.plans.some((x) => x.id === p.id)) store.plans.push(p);
  store.switchTo(plans[0].id);
  editor.select(null);
  requestAnimationFrame(() => editor.fitView());
  notify('Öppnade Högbovägen 333 (bottenvåning och övervåning finns i listan till höger). Måtten är uppskattade från mäklarens planritning.');
}
const exampleSelect = document.querySelector<HTMLSelectElement>('#example-select')!;
exampleSelect.addEventListener('change', () => {
  openExample(exampleSelect.value);
  exampleSelect.value = '';
});
const exampleParam = new URLSearchParams(location.search).get('exempel');
if (exampleParam) openExample(exampleParam);

// ----- 3D-vy (laddas först när den behövs) -----
const open3D = () =>
  import('./plan3d')
    .then((m) => m.show3D(store.plan, notify))
    .catch((err) => notify(`Kunde inte visa 3D: ${err.message}`));
document.querySelector('#btn-3d')!.addEventListener('click', open3D);

// ----- Ritning från bild -----
const imageImport = setupImageImport({
  notify,
  onCreate: (plan, show3d) => {
    store.addPlan(plan);
    editor.select(null);
    requestAnimationFrame(() => editor.fitView());
    notify(
      plan.walls.length
        ? `Skapade "${plan.name}" från bilden. Kontrollera väggarna mot bilden under och rätta det som blev fel – rummen heter "Rum 1", "Rum 2" … och kan döpas om.`
        : `Bilden ligger nu som bakgrund. Rita väggar och rum ovanpå den (verktyget Vägg eller Rum).`,
    );
    if (show3d) void open3D();
  },
});
document.querySelector('#btn-image')!.addEventListener('click', () => imageImport.open());

// ----- Bakgrundsbild -----
const bgPanel = document.querySelector<HTMLElement>('#bg-panel')!;
const bgVisible = document.querySelector<HTMLInputElement>('#bg-visible')!;
const bgOpacity = document.querySelector<HTMLInputElement>('#bg-opacity')!;
const syncBg = () => {
  const bg = store.plan.background;
  bgPanel.hidden = !bg;
  if (!bg) return;
  bgVisible.checked = bg.visible;
  if (document.activeElement !== bgOpacity) bgOpacity.value = String(bg.opacity);
};
store.subscribe(syncBg);
syncBg();
bgVisible.addEventListener('change', () => {
  if (!store.plan.background) return;
  store.plan.background.visible = bgVisible.checked;
  store.changed();
});
bgOpacity.addEventListener('input', () => {
  if (!store.plan.background) return;
  store.plan.background.opacity = Number(bgOpacity.value);
  store.changed();
});
document.querySelector('#bg-remove')!.addEventListener('click', () => {
  if (!store.plan.background) return;
  store.checkpoint();
  delete store.plan.background;
  store.changed();
});

// ----- Öppna en viss plan via adressen (?plan=…&visa=3d), t.ex. från Hemprojekt -----
const planParam = takeParam('plan');
const showParam = takeParam('visa');
if (planParam && store.plans.some((p) => p.id === planParam)) {
  store.switchTo(planParam);
  editor.select(null);
  requestAnimationFrame(() => editor.fitView());
}
if (showParam === '3d') void open3D();

// Spara innan sidan stängs
linkTool(document.querySelector<HTMLAnchorElement>('#link-hem'), 'hemprojekt');
window.addEventListener('beforeunload', () => store.save());
