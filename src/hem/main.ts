import './style.css';
import { download, linkTool } from '../common';
import { HomeStore, normalizeHomeProject } from './store';
import { HemUI } from './ui';
import { KEYS, readLibrary, storeItems } from './tools';
import { normalizePlan } from '../store';
import { normalizeSite } from '../tomt/store';
import { normalizeProject } from '../projekt/store';

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const store = new HomeStore();
const toastEl = $('#toast');
let toastTimer: number | undefined;
function notify(html: string, ms = 4500) {
  toastEl.innerHTML = html;
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), ms);
}
toastEl.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('a')) toastEl.classList.remove('show');
});

const ui = new HemUI(store, $('#main'), notify);
ui.render();

$('#btn-new').addEventListener('click', () => {
  ui.wizardKind = '';
  store.open(null);
});
$('#brand').addEventListener('click', () => {
  ui.wizardKind = null;
  store.open(null);
});

// ---- Spara och öppna fil (alla hemprojekt + kopplade ritningar, tomter och kalkyler) ----
$('#btn-save').addEventListener('click', () => {
  const lib = readLibrary();
  const ids = (k: 'plans' | 'sites' | 'builds') => new Set(store.projects.flatMap((p) => p.links[k]));
  const plans = [...ids('plans')].map((id) => lib.plans.get(id)).filter(Boolean);
  const sites = [...ids('sites')].map((id) => lib.sites.get(id)).filter(Boolean);
  const builds = [...ids('builds')].map((id) => lib.builds.get(id)).filter(Boolean);
  const data = { format: 'hemprojekt', version: 1, savedAt: new Date().toISOString(), projects: store.projects, plans, sites, builds };
  const name = store.current ? store.current.name : 'Hemprojekt';
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${name.replace(/[^\p{L}\p{N}\- ]+/gu, '').trim().replace(/\s+/g, '-') || 'Hemprojekt'}-${data.savedAt.slice(0, 10)}.hem.json`)
    .then(() => notify('Sparat! Filen innehåller alla hemprojekt med bilder, ritningar, tomter och kalkyler.'))
    .catch((err) => notify(`Det gick inte att spara: ${err.message}`));
});

const fileInput = $<HTMLInputElement>('#file-input');
$('#btn-open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data?.format !== 'hemprojekt' || !Array.isArray(data.projects)) throw new Error('Filen är inte en Hemprojekt-fil (.hem.json)');
    const safe = <T>(list: unknown, fn: (x: any) => T) =>
      (Array.isArray(list) ? list : []).flatMap((x) => {
        try {
          return [fn(x)];
        } catch {
          return [];
        }
      });
    const projects = safe(data.projects, normalizeHomeProject);
    for (const p of projects) {
      const i = store.projects.findIndex((x) => x.id === p.id);
      if (i >= 0) store.projects[i] = p;
      else store.projects.push(p);
    }
    const added =
      storeItems(KEYS.plans, safe(data.plans, normalizePlan)) + storeItems(KEYS.sites, safe(data.sites, normalizeSite)) + storeItems(KEYS.builds, safe(data.builds, normalizeProject));
    store.open(projects.length === 1 ? projects[0].id : null);
    ui.refresh();
    notify(`Öppnade ${projects.length} hemprojekt${added ? ` och lade in ${added} ritningar, tomter och kalkyler i verktygen` : ''}.`);
  } catch (err: any) {
    notify(`Det gick inte att öppna filen: ${err.message}`);
  }
});

// ---- Länkar till verktygen ----
linkTool($<HTMLAnchorElement>('#link-planritaren'), 'planritaren');
linkTool($<HTMLAnchorElement>('#link-tomt'), 'tomtplaneraren');
linkTool($<HTMLAnchorElement>('#link-bygg'), 'byggplaneraren');

// ---- Håll siffrorna aktuella när något ändras i de andra verktygen ----
const watched = new Set<string>([...Object.values(KEYS)]);
let refreshTimer: number | undefined;
const refreshSoon = () => {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    // Rita inte om medan man skriver i ett fält
    const a = document.activeElement as HTMLElement | null;
    if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
    ui.refresh();
  }, 400);
};
window.addEventListener('storage', (e) => {
  if (e.key && watched.has(e.key)) refreshSoon();
  if (e.key === 'hemprojekt.projects.v1') {
    store.projects = store.load();
    refreshSoon();
  }
});
window.addEventListener('focus', refreshSoon);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshSoon();
});
window.addEventListener('beforeunload', () => store.save());
