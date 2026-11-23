import './style.css';
import { Store } from './store';
import { Editor } from './editor';
import { setupUI } from './ui';
import { downloadJSON, downloadPNG, downloadSVG, planToSVG } from './export';

const store = new Store();
const svg = document.querySelector<SVGSVGElement>('#canvas')!;
const editor = new Editor(svg, store);
setupUI(editor, store);

requestAnimationFrame(() => editor.fitView());

document.querySelector('#zoom-in')!.addEventListener('click', () => editor.zoomAt(1.25));
document.querySelector('#zoom-out')!.addEventListener('click', () => editor.zoomAt(0.8));
document.querySelector('#zoom-fit')!.addEventListener('click', () => editor.fitView());

document.querySelector('#btn-png')!.addEventListener('click', () => {
  downloadPNG(store.plan, editor.settings).catch((err) => alert(`Exporten misslyckades: ${err.message}`));
});
document.querySelector('#btn-svg')!.addEventListener('click', () => downloadSVG(store.plan, editor.settings));
document.querySelector('#btn-save')!.addEventListener('click', () => downloadJSON(store.plan));

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
    alert(`Kunde inte öppna filen: ${(err as Error).message}`);
  }
});

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

// Spara innan sidan stängs
window.addEventListener('beforeunload', () => store.save());
