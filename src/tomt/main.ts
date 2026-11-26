import '../style.css';
import './style.css';
import { SiteStore, normalizeSite } from './store';
import { Editor } from './editor';
import { setupUI, TOOL_KEYS } from './ui';
import { drawingSheet, viewImage } from './sheet';
import { planFromBuilding } from './toplan';
import { pickables, siteToProject } from './quantities';
import { normalizePlan } from '../store';
import { ARTIFACT_LINKS, download, imageLibraryNotice, inArtifact, linkTool, receiveHandoff, safeFilename, sendHandoff, sendToImageLibrary, takeParam } from '../common';
import type { Building } from './types';
import { EXAMPLE_ID, exampleSite } from '../exempel/hogbovagen333';

const store = new SiteStore();
const ed = new Editor(document.querySelector<HTMLElement>('#view')!, store);
const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;

// ---- Meddelanden ----
const toastEl = $('#toast');
let toastTimer: number | undefined;
function notify(msg: string, ms = 4500) {
  toastEl.innerHTML = msg;
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), ms);
}
const run = (p: Promise<void>, what: string) => p.catch((err) => notify(`${what} misslyckades: ${err.message}`));

// ---- Statusrad ----
const hintEl = $('#status-hint');
const measureEl = $('#status-measure');
const cursorEl = $('#status-cursor');
ed.onStatus = (s) => {
  if (s.hint !== undefined) hintEl.textContent = s.hint;
  if (s.measure !== undefined) measureEl.textContent = s.measure;
  if (s.cursor !== undefined) cursorEl.textContent = s.cursor;
};
ed.setTool('select');

// ---- Öppna andra verktyg ----
function openTool(tool: 'planritaren' | 'byggplaneraren') {
  const url = tool === 'planritaren' ? './index.html' : './byggprojekt.html';
  window.open(url, tool);
}

const planInput = $<HTMLInputElement>('#plan-file-input');
let planTarget: Building | null = null;

const ui = setupUI(ed, {
  makePlan(b) {
    const plan = planFromBuilding(b, store.site.name);
    store.checkpoint();
    b.planId = plan.id;
    store.site.plans = [...(store.site.plans ?? []).filter((p) => p.id !== plan.id), plan];
    ed.plans.set(plan.id, plan);
    store.changed();
    if (inArtifact()) {
      void run(download(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }), `${safeFilename(plan.name, 'plan')}.json`), 'Nedladdningen');
      notify(
        `Planritningen är sparad som fil. Öppna <a href="${ARTIFACT_LINKS.planritaren}" target="_blank" rel="noopener">Planritaren</a> och välj <b>Öppna fil…</b>. När du ritat klart: spara där och välj <b>Läs in ny version från fil…</b> här.`,
        12000,
      );
      return;
    }
    sendHandoff('planritaren', plan);
    openTool('planritaren');
    notify('Planritningen öppnas i Planritaren. Rita in rum, möbler, fönster och dörrar där – det syns här i 3D när du kommer tillbaka.', 8000);
  },
  openPlan(b) {
    const plan = b.planId && ed.plans.get(b.planId);
    if (!plan) return;
    if (inArtifact()) {
      void run(download(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }), `${safeFilename(plan.name, 'plan')}.json`), 'Nedladdningen');
      notify(`Planfilen är sparad. Öppna den i <a href="${ARTIFACT_LINKS.planritaren}" target="_blank" rel="noopener">Planritaren</a> med <b>Öppna fil…</b>.`, 10000);
      return;
    }
    sendHandoff('planritaren', plan);
    openTool('planritaren');
  },
  importPlanFile(b) {
    planTarget = b;
    planInput.click();
  },
  unlinkPlan(b) {
    store.checkpoint();
    delete b.planId;
    store.changed();
  },
  makeProject: () => openProjectDialog(),
  sheet: () => makeSheet(),
});

planInput.addEventListener('change', async () => {
  const file = planInput.files?.[0];
  planInput.value = '';
  const b = planTarget;
  if (!file || !b) return;
  try {
    const raw = JSON.parse(await file.text());
    if (!Array.isArray(raw?.walls)) throw new Error('Filen är inte en planritning från Planritaren');
    const plan = normalizePlan(raw);
    store.checkpoint();
    b.planId = plan.id;
    store.site.plans = [...(store.site.plans ?? []).filter((p) => p.id !== plan.id), plan];
    ed.plans.set(plan.id, plan);
    store.changed();
    notify(`Läste in "${plan.name}".`);
  } catch (err) {
    notify(`Kunde inte läsa planen: ${(err as Error).message}`);
  }
});

// När man kommer tillbaka från Planritaren: läs in ändrade planritningar
const reloadPlans = () => {
  ed.loadPlans();
  ed.rebuild();
  ui.renderProps();
};
window.addEventListener('storage', (e) => {
  if (e.key === 'planritaren.plans.v1') reloadPlans();
});
window.addEventListener('focus', reloadPlans);

// ---- Inköpsplan ----
const dialog = $<HTMLDialogElement>('#project-dialog');
const pickList = $('#pick-list');
function openProjectDialog() {
  const picks = pickables(store.site);
  if (!picks.length) {
    notify('Rita först något på tomten – till exempel ett hus, en altan eller ett staket.');
    return;
  }
  pickList.innerHTML = picks
    .map((p) => `<label class="row"><input type="checkbox" value="${p.id}" checked /> ${p.label.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</label>`)
    .join('');
  dialog.showModal();
}
dialog.addEventListener('close', () => {
  if (dialog.returnValue !== 'ok') return;
  const include = new Set([...pickList.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value));
  if (!include.size) return;
  ed.loadPlans();
  const project = siteToProject(store.site, ed.plans, include);
  if (inArtifact()) {
    void run(download(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `${safeFilename(project.name, 'projekt')}.bygg.json`), 'Nedladdningen');
    notify(`Inköpsplanen är sparad som fil. Öppna <a href="${ARTIFACT_LINKS.byggplaneraren}" target="_blank" rel="noopener">Byggplaneraren</a> och välj <b>Öppna fil…</b>.`, 12000);
    return;
  }
  sendHandoff('byggplaneraren', project);
  openTool('byggplaneraren');
  notify(`Inköpsplanen "${project.name}" öppnas i Byggplaneraren: ${project.tasks.length} moment och ${project.materials.length} material.`, 7000);
});

// ---- Bilder ----
function makeSheet() {
  notify('Ritar ritningsbladet…', 2000);
  setTimeout(() => {
    try {
      const c = drawingSheet(ed);
      c.toBlob((blob) => {
        if (blob) void run(download(blob, `Ritningsblad-${safeFilename(store.site.name, 'tomt')}.png`), 'Exporten');
      }, 'image/png');
    } catch (err) {
      notify(`Ritningsbladet misslyckades: ${(err as Error).message}`);
    }
  }, 30);
}
$('#btn-sheet').addEventListener('click', makeSheet);
$('#btn-image').addEventListener('click', () => {
  const c = viewImage(ed);
  c.toBlob((blob) => {
    if (blob) void run(download(blob, `3D-${safeFilename(store.site.name, 'tomt')}.png`), 'Exporten');
  }, 'image/png');
});

const toLibBtn = $<HTMLButtonElement>('#btn-to-library');
toLibBtn.hidden = inArtifact();
toLibBtn.addEventListener('click', () => {
  viewImage(ed).toBlob((blob) => {
    if (!blob) return;
    sendToImageLibrary(blob, `${store.site.name || 'Tomten'} i 3D`, 'Tomten', 'tomtplaneraren')
      .then(() => notify(imageLibraryNotice(), 9000))
      .catch((err) => notify(`Kunde inte spara bilden: ${err.message}`));
  }, 'image/png');
});

// ---- Tomter ----
const siteSelect = $<HTMLSelectElement>('#site-select');
const nameInput = $<HTMLInputElement>('#site-name');
const undoBtn = $<HTMLButtonElement>('#btn-undo');
const redoBtn = $<HTMLButtonElement>('#btn-redo');
let lastSiteId = store.site.id;
function renderTop() {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  siteSelect.innerHTML = store.sites.map((s) => `<option value="${s.id}"${s === store.site ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  if (document.activeElement !== nameInput) nameInput.value = store.site.name;
  undoBtn.disabled = !store.canUndo();
  redoBtn.disabled = !store.canRedo();
  document.title = `${store.site.name} – Tomtplaneraren`;
  if (store.site.id !== lastSiteId) {
    lastSiteId = store.site.id;
    ed.select(null);
    ed.loadPlans();
    ed.rebuild();
    ed.fit(false);
    ed.updateSun();
  }
}
store.subscribe(renderTop);
siteSelect.addEventListener('change', () => store.switchTo(siteSelect.value));
nameInput.addEventListener('change', () => {
  store.checkpoint();
  store.site.name = nameInput.value.trim() || 'Tomt';
  store.changed();
});
$('#btn-new').addEventListener('click', () => {
  store.newSite();
  ed.setTool('plot');
  notify('Ny tomt. Rita tomtgränsen genom att klicka ut hörnen – eller markera tomten och skriv in måtten.', 7000);
});
$('#btn-variant').addEventListener('click', () => {
  store.duplicate();
  notify(`Skapade "${store.site.name}". Ändra fritt – originalet finns kvar i listan.`);
});
const delBtn = $<HTMLButtonElement>('#btn-delete');
let delTimer: number | undefined;
delBtn.addEventListener('click', () => {
  if (delBtn.dataset.confirm) {
    window.clearTimeout(delTimer);
    delete delBtn.dataset.confirm;
    delBtn.textContent = 'Ta bort';
    store.deleteCurrent();
    return;
  }
  delBtn.dataset.confirm = '1';
  delBtn.textContent = 'Klicka igen för att ta bort';
  delTimer = window.setTimeout(() => {
    delete delBtn.dataset.confirm;
    delBtn.textContent = 'Ta bort';
  }, 3000);
});
undoBtn.addEventListener('click', () => store.undo());
redoBtn.addEventListener('click', () => store.redo());

// ---- Filer ----
$('#btn-save').addEventListener('click', () => {
  ed.loadPlans();
  void run(download(new Blob([JSON.stringify(store.site, null, 2)], { type: 'application/json' }), `${safeFilename(store.site.name, 'tomt')}.tomt.json`), 'Sparandet');
});
const fileInput = $<HTMLInputElement>('#file-input');
$('#btn-open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  try {
    store.importSite(JSON.parse(await file.text()));
    notify(`Öppnade "${store.site.name}".`);
  } catch (err) {
    notify(`Kunde inte öppna filen: ${(err as Error).message}`);
  }
});

// ---- Vy ----
const v3d = $('#view-3d');
const vTop = $('#view-top');
const setView = (v: '3d' | 'top') => {
  ed.setView(v);
  v3d.classList.toggle('on', v === '3d');
  vTop.classList.toggle('on', v === 'top');
};
v3d.addEventListener('click', () => setView('3d'));
vTop.addEventListener('click', () => setView('top'));
$('#zoom-in').addEventListener('click', () => ed.zoom(1.25));
$('#zoom-out').addEventListener('click', () => ed.zoom(0.8));
$('#zoom-fit').addEventListener('click', () => ed.fit());

// ---- Tangentbord ----
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('input, select, textarea, dialog')) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') {
    e.preventDefault();
    e.shiftKey ? store.redo() : store.undo();
    return;
  }
  if (mod && k === 'y') {
    e.preventDefault();
    store.redo();
    return;
  }
  if (mod && k === 'd') {
    e.preventDefault();
    ed.duplicateSelected();
    return;
  }
  if (mod) return;
  if (e.key === 'Escape') ed.cancel();
  else if (e.key === 'Enter') ed.finishDraft();
  else if (e.key === 'Delete' || e.key === 'Backspace') ed.deleteSelected();
  else if (k === 'q') ed.rotateSelected(e.shiftKey ? -90 : -15);
  else if (k === 'e') ed.rotateSelected(e.shiftKey ? 90 : 15);
  else if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    const s = e.shiftKey ? 1000 : 100;
    ed.nudge(e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0);
  } else if (TOOL_KEYS.has(k)) ed.setTool(TOOL_KEYS.get(k)!);
});

// ---- Länkar till de andra verktygen ----
for (const [id, tool] of [
  ['#link-planritaren', 'planritaren'],
  ['#link-bygg', 'byggplaneraren'],
] as const) {
  const a = $<HTMLAnchorElement>(id);
  if (inArtifact()) {
    a.href = ARTIFACT_LINKS[tool];
    a.target = '_blank';
    a.rel = 'noopener';
  } else a.target = tool;
}

linkTool($<HTMLAnchorElement>('#link-bilder'), 'bildbiblioteket');

linkTool($<HTMLAnchorElement>('#link-hem'), 'hemprojekt');
renderTop();
window.addEventListener('beforeunload', () => store.save());

// ---- Exempel ----
function openExample(id: string) {
  if (id !== EXAMPLE_ID) return;
  const site = exampleSite();
  const existing = store.sites.find((s) => s.id === site.id);
  if (existing) store.switchTo(existing.id);
  else store.add(site);
  notify('Öppnade Högbovägen 333: huvudbyggnad med uterum, gäststuga, två gästhus, garage/bod och brygga. Huset har planritningen inlagd. Tomtens form och placeringen av byggnaderna är uppskattade.', 10000);
}
const exampleSelect = $<HTMLSelectElement>('#example-select');
exampleSelect.addEventListener('change', () => {
  openExample(exampleSelect.value);
  exampleSelect.value = '';
});
const exampleParam = new URLSearchParams(location.search).get('exempel');
if (exampleParam) openExample(exampleParam);

// ---- Tomt som skickats hit (t.ex. från Hemprojekt) och ?tomt=… i adressen ----
receiveHandoff('tomtplaneraren', (raw, from) => {
  const s = normalizeSite(raw);
  const existing = store.sites.find((x) => x.id === s.id);
  if (existing) store.switchTo(existing.id);
  else store.add(s);
  notify(`Öppnade "${store.site.name}" från ${from}.`);
});
const siteParam = takeParam('tomt');
if (siteParam && store.sites.some((s) => s.id === siteParam)) store.switchTo(siteParam);
