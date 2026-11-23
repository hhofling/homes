import './style.css';
import { ProjectStore } from './store';
import { ProjectUI } from './ui';
import { reportHTML } from './report';
import { materialsCSV } from './calc';
import { ARTIFACT_LINKS, download, inArtifact, safeFilename } from '../common';

const store = new ProjectStore();
const main = document.querySelector<HTMLElement>('#main')!;
const nav = document.querySelector<HTMLElement>('#nav')!;
const toastEl = document.querySelector<HTMLElement>('#toast')!;

let toastTimer: number | undefined;
function notify(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 3500);
}
const run = (p: Promise<void>, what: string) => p.catch((err) => notify(`${what} misslyckades: ${err.message}`));

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify('Kopierat! Klistra in där du vill (Ctrl+V / Cmd+V).');
    return;
  } catch {
    /* faller tillbaka nedan */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  notify(ok ? 'Kopierat! Klistra in där du vill (Ctrl+V / Cmd+V).' : 'Kunde inte kopiera automatiskt – markera texten och kopiera den själv.');
}

const ui = new ProjectUI(store, main, nav, notify, {
  copy: (text) => void copy(text),
  downloadText: (text, name) => void run(download(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${safeFilename(name, 'text')}.txt`), 'Nedladdningen'),
  downloadCSV: () =>
    void run(download(new Blob([materialsCSV(store.project)], { type: 'text/csv;charset=utf-8' }), `Material-${safeFilename(store.project.name, 'projekt')}.csv`), 'Nedladdningen'),
  openPlanFile: () => planInput.click(),
});

// ----- Projektväljare -----
const select = document.querySelector<HTMLSelectElement>('#project-select')!;
function renderProjects() {
  select.innerHTML = store.projects
    .map((p) => `<option value="${p.id}"${p === store.project ? ' selected' : ''}>${p.name.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</option>`)
    .join('');
  document.title = `${store.project.name} – Byggplaneraren`;
}
store.subscribe(renderProjects);
document.addEventListener('project-renamed', renderProjects);
select.addEventListener('change', () => store.switchTo(select.value));
document.querySelector('#btn-new')!.addEventListener('click', () => {
  store.newProject();
  ui.go('overview');
  main.querySelector<HTMLInputElement>('[data-bind="project::name"]')?.select();
});

// ----- Filer -----
document.querySelector('#btn-save')!.addEventListener('click', () =>
  run(
    download(new Blob([JSON.stringify(store.project, null, 2)], { type: 'application/json' }), `${safeFilename(store.project.name, 'projekt')}.bygg.json`),
    'Sparandet',
  ),
);
const fileInput = document.querySelector<HTMLInputElement>('#file-input')!;
document.querySelector('#btn-open')!.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    if (raw && Array.isArray(raw.walls) && !Array.isArray(raw.tasks)) {
      // En plan från Planritaren: hämta rummen till nuvarande projekt
      ui.importPlanFile(raw);
      return;
    }
    store.importProject(raw);
    notify(`Öppnade "${store.project.name}".`);
  } catch (err) {
    notify(`Kunde inte öppna filen: ${(err as Error).message}`);
  }
});
const planInput = document.querySelector<HTMLInputElement>('#plan-file-input')!;
planInput.addEventListener('change', async () => {
  const file = planInput.files?.[0];
  planInput.value = '';
  if (!file) return;
  try {
    ui.importPlanFile(JSON.parse(await file.text()));
  } catch (err) {
    notify(`Kunde inte läsa planen: ${(err as Error).message}`);
  }
});

// ----- Utskrift -----
const printBtn = document.querySelector<HTMLButtonElement>('#btn-print')!;
function currentReport() {
  const quote = main.querySelector<HTMLTextAreaElement>('#quote-text')?.value;
  return reportHTML(store.project, ui.state.view, { shopBy: ui.state.shopBy, shopRemaining: ui.state.shopRemaining, quote, quoteTrade: ui.state.quoteTrade });
}
if (inArtifact()) {
  // Utskrift fungerar inte inuti en artefakt – ladda ner ett dokument som kan skrivas ut i stället.
  printBtn.textContent = 'Ladda ner för utskrift';
  printBtn.title = 'Ladda ner det du ser som ett dokument som du kan öppna och skriva ut';
}
printBtn.addEventListener('click', () => {
  const { title, html } = currentReport();
  if (inArtifact()) {
    void run(download(new Blob([html], { type: 'text/html;charset=utf-8' }), `${safeFilename(`${title} ${store.project.name}`, 'utskrift')}.html`), 'Nedladdningen');
    return;
  }
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 1000);
  }, 100);
});

// ----- Länk till Planritaren -----
const link = document.querySelector<HTMLAnchorElement>('#link-planritaren')!;
if (inArtifact()) {
  if (ARTIFACT_LINKS.planritaren) {
    link.href = ARTIFACT_LINKS.planritaren;
    link.target = '_blank';
    link.rel = 'noopener';
  } else link.hidden = true;
}

renderProjects();
ui.render();
window.addEventListener('beforeunload', () => store.save());
