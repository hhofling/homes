/** Panelerna runt 3D-vyn: verktyg, egenskaper för det som är markerat och sammanställning. */
import type { Editor, Tool } from './editor';
import type { Building, Sel } from './types';
import { BUILDING_KINDS, AREA_KINDS, LINE_KINDS, PLANT_KINDS, ROOF_TYPES, FOUNDATIONS } from './catalog';
import { buildingNotes, footprint, roofInfo, totalHeight, areaM2, siteSummary, polylineLength, dec } from './calc';
import { dist } from '../geometry';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const parse = (v: string) => {
  const n = parseFloat(v.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

interface ToolDef {
  tool: Tool;
  label: string;
  icon: string;
  key?: string;
}

const ICON = {
  select: '<path d="M6 3l12 9-5 1 3 6-2 1-3-6-4 3z"/>',
  plot: '<path d="M3 6l7-3 11 4-2 13-15-2z" fill="none" stroke-dasharray="3 2"/>',
  house: '<path d="M3 11l9-7 9 7M5 10v10h14V10" fill="none"/><path d="M10 20v-5h4v5" fill="none"/>',
  garage: '<path d="M3 10l9-6 9 6v10H3z" fill="none"/><path d="M7 20v-7h10v7M7 15h10M7 17h10" fill="none"/>',
  small: '<path d="M5 12l7-6 7 6v8H5z" fill="none"/><path d="M10 20v-4h4v4" fill="none"/>',
  carport: '<path d="M3 8h18M5 8v12M19 8v12" fill="none"/>',
  deck: '<path d="M3 9h18v4H3zM3 13l1 6M21 13l-1 6M3 11h18" fill="none"/>',
  patio: '<path d="M3 5h18v14H3zM9 5v14M15 5v14M3 12h18" fill="none"/>',
  pool: '<rect x="3" y="6" width="18" height="12" rx="2" fill="none"/><path d="M6 12c2-1.5 3 1.5 5 0s3 1.5 5 0 2 1 2 1" fill="none"/>',
  drive: '<path d="M8 3l-3 18M16 3l3 18M12 5v3M12 11v3M12 17v3" fill="none"/>',
  bed: '<path d="M3 14h18v5H3z" fill="none"/><circle cx="7" cy="11" r="2"/><circle cx="12" cy="10" r="2"/><circle cx="17" cy="11" r="2"/>',
  lawn: '<path d="M4 20l2-7 1 7 2-9 2 9 1-6 2 6 2-8 1 8 2-5 1 5" fill="none"/>',
  fence: '<path d="M5 20V6l1.5-2L8 6v14M11 20V6l1.5-2L14 6v14M17 20V6l1.5-2L20 6v14M3 9h19M3 16h19" fill="none"/>',
  hedge: '<path d="M3 18c0-4 2-6 4-6 0-3 3-5 5-3 2-2 5 0 5 3 2 0 4 2 4 6z" fill="none"/><path d="M3 20h18" fill="none"/>',
  path: '<path d="M4 21c4-3 2-8 7-10s6-5 9-8" fill="none" stroke-width="3"/>',
  wall: '<path d="M3 9h18v10H3zM3 14h18M9 9v5M15 9v5M6 14v5M12 14v5M18 14v5" fill="none"/>',
  tree: '<circle cx="12" cy="9" r="6" fill="none"/><path d="M12 15v6" fill="none"/>',
  fruit: '<circle cx="12" cy="9" r="6" fill="none"/><path d="M12 15v6" fill="none"/><circle cx="10" cy="8" r="1"/><circle cx="14" cy="11" r="1"/>',
  pine: '<path d="M12 2l6 9h-3l4 6H5l4-6H6zM12 17v4" fill="none"/>',
  bush: '<path d="M4 18c-1-4 2-7 5-6 1-3 6-3 7 0 3-1 5 2 4 6z" fill="none"/>',
};
const svg = (path: string) => `<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" fill="currentColor" aria-hidden="true">${path}</svg>`;

export const TOOL_GROUPS: { title: string; tools: ToolDef[] }[] = [
  {
    title: 'Tomt',
    tools: [
      { tool: 'select', label: 'Markera', icon: ICON.select, key: 'v' },
      { tool: 'plot', label: 'Tomtgräns', icon: ICON.plot, key: 't' },
    ],
  },
  {
    title: 'Byggnader',
    tools: [
      { tool: 'b:house', label: 'Bostadshus', icon: ICON.house, key: 'h' },
      { tool: 'b:garage', label: 'Garage', icon: ICON.garage, key: 'g' },
      { tool: 'b:carport', label: 'Carport', icon: ICON.carport },
      { tool: 'b:attefall', label: 'Attefallshus', icon: ICON.small },
      { tool: 'b:friggebod', label: 'Friggebod', icon: ICON.small },
      { tool: 'b:shed', label: 'Förråd', icon: ICON.small },
    ],
  },
  {
    title: 'Mark och uteplatser',
    tools: [
      { tool: 'a:deck', label: 'Altan', icon: ICON.deck, key: 'a' },
      { tool: 'a:patio', label: 'Uteplats', icon: ICON.patio },
      { tool: 'a:pool', label: 'Pool', icon: ICON.pool },
      { tool: 'a:driveway', label: 'Uppfart', icon: ICON.drive },
      { tool: 'a:bed', label: 'Rabatt', icon: ICON.bed },
      { tool: 'a:lawn', label: 'Gräsmatta', icon: ICON.lawn },
      { tool: 'l:path', label: 'Gång', icon: ICON.path },
      { tool: 'l:fence', label: 'Staket', icon: ICON.fence, key: 's' },
      { tool: 'l:hedge', label: 'Häck', icon: ICON.hedge },
      { tool: 'l:wall', label: 'Mur', icon: ICON.wall },
    ],
  },
  {
    title: 'Växter',
    tools: [
      { tool: 'p:tree', label: 'Lövträd', icon: ICON.tree },
      { tool: 'p:fruit', label: 'Fruktträd', icon: ICON.fruit },
      { tool: 'p:pine', label: 'Barrträd', icon: ICON.pine },
      { tool: 'p:bush', label: 'Buske', icon: ICON.bush },
    ],
  },
];

export const TOOL_KEYS = new Map(TOOL_GROUPS.flatMap((g) => g.tools.filter((t) => t.key).map((t) => [t.key!, t.tool] as const)));

const WALL_COLORS = ['#e9e2d0', '#f4f2ec', '#b5432f', '#8fa89b', '#d9c27a', '#5f6b75', '#3f3f3f', '#c7d3dc'];
const ROOF_COLORS = ['#3b3f45', '#7a2f24', '#5d636b', '#2f4a3a', '#8a8f94'];

export interface UIActions {
  makePlan: (b: Building) => void;
  openPlan: (b: Building) => void;
  importPlanFile: (b: Building) => void;
  unlinkPlan: (b: Building) => void;
  makeProject: () => void;
  sheet: () => void;
}

export function setupUI(ed: Editor, actions: UIActions) {
  const store = ed.store;
  const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;

  // ---- Verktyg ----
  const toolsEl = $('#tools');
  toolsEl.innerHTML = TOOL_GROUPS.map(
    (g) =>
      `<h3>${g.title}</h3><div class="tools">${g.tools
        .map((t) => `<button class="tool" data-tool="${t.tool}" title="${t.label}${t.key ? ` (${t.key.toUpperCase()})` : ''}">${svg(t.icon)}<span>${t.label}</span></button>`)
        .join('')}</div>`,
  ).join('');
  toolsEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tool]');
    if (b) ed.setTool(b.dataset.tool as Tool);
  });
  ed.onTool = (t) => toolsEl.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.tool === t));
  ed.onTool(ed.tool);

  // ---- Inställningar ----
  const bindCheck = (id: string, key: 'snap' | 'showGrid' | 'roofs' | 'labels' | 'furniture', rebuild = true) => {
    const el = $<HTMLInputElement>(id);
    el.checked = ed.settings[key];
    el.addEventListener('change', () => {
      ed.settings[key] = el.checked;
      if (rebuild) ed.rebuild();
    });
  };
  bindCheck('#opt-snap', 'snap', false);
  bindCheck('#opt-grid-show', 'showGrid');
  bindCheck('#opt-roofs', 'roofs');
  bindCheck('#opt-labels', 'labels');
  bindCheck('#opt-furniture', 'furniture');
  const grid = $<HTMLSelectElement>('#opt-grid');
  grid.value = String(ed.settings.grid);
  grid.addEventListener('change', () => (ed.settings.grid = +grid.value));
  const hour = $<HTMLInputElement>('#opt-hour');
  const season = $<HTMLSelectElement>('#opt-season');
  const sunText = $('#sun-text');
  const updateSun = () => {
    ed.settings.hour = +hour.value;
    ed.settings.season = +season.value;
    const s = ed.updateSun();
    const hh = Math.floor(ed.settings.hour);
    const mm = Math.round((ed.settings.hour - hh) * 60);
    sunText.textContent = `kl ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}${s.up ? '' : ' – solen har gått ner'}`;
  };
  hour.value = String(ed.settings.hour);
  season.value = String(ed.settings.season);
  hour.addEventListener('input', updateSun);
  season.addEventListener('change', updateSun);
  updateSun();

  // ---- Egenskaper ----
  const propsEl = $('#props');
  const field = (label: string, html: string) => `<label class="field"><span>${label}</span>${html}</label>`;
  const meters = (key: string, mm: number, _step = 0.1, min = 0.1) =>
    `<span class="unit-input"><input type="text" inputmode="decimal" data-key="${key}" data-unit="m" data-min="${min}" value="${dec(mm / 1000, 2)}" /> m</span>`;
  const number = (key: string, v: number, unit: string, min = 0, max = 9999) =>
    `<span class="unit-input"><input type="number" data-key="${key}" min="${min}" max="${max}" step="1" value="${Math.round(v)}" /> ${unit}</span>`;
  const select = (key: string, opts: Record<string, string>, cur: string) =>
    `<select data-key="${key}">${Object.entries(opts)
      .map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(v)}</option>`)
      .join('')}</select>`;
  const colors = (key: string, list: string[], cur: string) =>
    `<div class="swatches">${list.map((c) => `<button type="button" class="swatch-btn${c === cur ? ' on' : ''}" data-color-key="${key}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}<input type="color" data-key="${key}" value="${cur}" /></div>`;
  const text = (key: string, v: string) => `<input type="text" data-key="${key}" value="${esc(v)}" />`;
  const actionsRow = (extra = '') =>
    `<div class="btn-row">${extra}<button data-act="duplicate" title="Ctrl+D">Duplicera</button><button data-act="delete" class="danger" title="Delete">Ta bort</button></div>`;

  function renderProps() {
    const sel = ed.selection;
    const obj = sel && ed.find(sel);
    const site = store.site;
    if (!sel || !obj) {
      propsEl.innerHTML = `<p class="muted small">Klicka på något i 3D-vyn för att ändra det, eller välj ett verktyg till vänster och rita på tomten.</p>
        <div class="shortcuts small muted">
          <div><kbd>Vänsterklick + dra</kbd> vrida vyn</div>
          <div><kbd>Högerklick + dra</kbd> flytta vyn</div>
          <div><kbd>Scroll</kbd> zooma</div>
          <div><kbd>Q</kbd>/<kbd>E</kbd> vrida markerad byggnad</div>
          <div><kbd>Delete</kbd> ta bort · <kbd>Esc</kbd> avbryt</div>
        </div>`;
      return;
    }
    let html = '';
    if (sel.kind === 'plot') {
      const per = site.plot.reduce((s, p, i) => s + dist(p, site.plot[(i + 1) % site.plot.length]), 0);
      html =
        `<h3>Tomt</h3>` +
        `<div class="stat"><b>${dec(areaM2(site.plot), 0)} m²</b> <span class="muted">· omkrets ${dec(per / 1000)} m · ${site.plot.length} hörn</span></div>` +
        `<p class="muted small">Dra i de vita punkterna för att flytta hörnen, eller rita om med verktyget Tomtgräns. Snabbast: skriv in måtten för en rektangulär tomt.</p>` +
        `<div class="rect-plot">${meters('plotW', bboxW(site.plot))}<span>×</span>${meters('plotD', bboxD(site.plot))}<button data-act="rect-plot">Gör rektangulär</button></div>` +
        `<div class="btn-row"><button data-act="delete" class="danger">Ta bort tomtgränsen</button></div>`;
    } else if (sel.kind === 'building') {
      const b = obj as Building;
      const r = roofInfo(b);
      const plan = b.planId ? ed.plans.get(b.planId) : null;
      const notes = buildingNotes(b, site);
      html =
        `<h3>${esc(BUILDING_KINDS[b.kind].label)}</h3>` +
        field('Namn', text('name', b.name)) +
        field('Typ', select('kind', Object.fromEntries(Object.entries(BUILDING_KINDS).map(([k, v]) => [k, v.label])), b.kind)) +
        field('Bredd', meters('w', b.w)) +
        field('Djup', meters('d', b.d)) +
        field('Vridning', number('rotation', b.rotation, '°', -360, 360)) +
        (b.kind === 'carport' ? '' : field('Våningar', number('floors', b.floors, 'st', 1, 4))) +
        field(b.kind === 'carport' ? 'Fri höjd' : 'Våningshöjd', meters('floorHeight', b.floorHeight)) +
        field('Tak', select('roof', ROOF_TYPES, b.roof)) +
        (b.roof === 'flat' ? '' : field('Taklutning', number('pitch', b.pitch, '°', 0, 60))) +
        (b.roof === 'gable' || b.roof === 'shed' ? field('Nock', select('ridge', { long: 'Längs långsidan', short: 'Längs kortsidan' }, b.ridge)) : '') +
        (b.kind === 'carport' ? '' : field('Grund', select('foundation', FOUNDATIONS, b.foundation))) +
        field('Vägg', colors('wallColor', WALL_COLORS, b.wallColor)) +
        field('Tak', colors('roofColor', ROOF_COLORS, b.roofColor)) +
        `<div class="facts small">
          <div><span>Byggnadsarea</span><b>${dec(footprint(b))} m²</b></div>
          ${b.kind === 'carport' ? '' : `<div><span>Boarea ca</span><b>${dec(((b.w - 700) * (b.d - 700) * b.floors) / 1e6, 0)} m²</b></div>`}
          <div><span>Nockhöjd</span><b>${dec(totalHeight(b) / 1000)} m</b></div>
          <div><span>Takyta</span><b>${dec(r.area, 0)} m²</b></div>
        </div>` +
        `<ul class="notes">${notes.map((n) => `<li class="${n.level}">${esc(n.text)}</li>`).join('')}</ul>` +
        (b.kind === 'carport'
          ? ''
          : `<div class="linkbox">
          <b>Planritning</b>
          ${
            plan
              ? `<p class="small muted">Kopplad till <b>${esc(plan.name)}</b>. Väggar, fönster, dörrar och möbler därifrån visas i 3D.</p>
                 <div class="btn-row"><button data-act="open-plan" class="primary">Öppna i Planritaren</button><button data-act="import-plan">Läs in ny version från fil…</button><button data-act="unlink-plan">Koppla loss</button></div>`
              : b.planId
                ? `<p class="small muted">Planritningen finns inte i den här webbläsaren. Spara den som fil i Planritaren och läs in den här.</p>
                 <div class="btn-row"><button data-act="import-plan">Läs in planfil…</button><button data-act="make-plan">Skapa ny</button><button data-act="unlink-plan">Koppla loss</button></div>`
                : `<p class="small muted">Gör en 2D-ritning av huset med ytterväggar, fönster och dörrar. Rita in rummen i Planritaren – de syns sedan här i 3D.</p>
                 <div class="btn-row"><button data-act="make-plan" class="primary">Skapa planritning</button><button data-act="import-plan">Koppla planfil…</button></div>`
          }
        </div>`) +
        actionsRow();
    } else if (sel.kind === 'area') {
      const a = obj;
      const def = AREA_KINDS[a.kind as keyof typeof AREA_KINDS];
      html =
        `<h3>${esc(def.label)}</h3>` +
        field('Namn', text('name', a.name)) +
        field('Typ', select('kind', Object.fromEntries(Object.entries(AREA_KINDS).map(([k, v]) => [k, v.label])), a.kind)) +
        field('Bredd', meters('w', a.w)) +
        field('Djup', meters('d', a.d)) +
        field('Vridning', number('rotation', a.rotation, '°', -360, 360)) +
        (a.kind === 'deck' ? field('Höjd', meters('height', a.height, 0.05, 0)) : '') +
        (a.kind === 'pool' ? field('Djup (vatten)', meters('height', a.height, 0.1, 0)) : '') +
        field('Färg', `<input type="color" data-key="color" value="${a.color}" />`) +
        `<div class="stat"><b>${dec((a.w * a.d) / 1e6)} m²</b></div>` +
        actionsRow();
    } else if (sel.kind === 'line') {
      const l = obj;
      html =
        `<h3>${esc(LINE_KINDS[l.kind as keyof typeof LINE_KINDS].label)}</h3>` +
        field('Namn', text('name', l.name)) +
        field('Typ', select('kind', Object.fromEntries(Object.entries(LINE_KINDS).map(([k, v]) => [k, v.label])), l.kind)) +
        (l.kind === 'path' ? '' : field('Höjd', meters('height', l.height, 0.1, 0.1))) +
        (l.kind === 'fence' ? '' : field('Bredd', meters('width', l.width))) +
        field('Färg', `<input type="color" data-key="color" value="${l.color}" />`) +
        `<div class="stat"><b>${dec(polylineLength(l.points) / 1000)} m</b> <span class="muted">· ${l.points.length} punkter</span></div>` +
        `<p class="muted small">Dra i punkterna för att ändra sträckan.</p>` +
        actionsRow();
    } else if (sel.kind === 'plant') {
      const p = obj;
      html =
        `<h3>${esc(PLANT_KINDS[p.kind as keyof typeof PLANT_KINDS].label)}</h3>` +
        field('Typ', select('kind', Object.fromEntries(Object.entries(PLANT_KINDS).map(([k, v]) => [k, v.label])), p.kind)) +
        field('Krona', meters('size', p.size)) +
        field('Höjd', meters('height', p.height)) +
        actionsRow();
    }
    propsEl.innerHTML = html;
  }

  const bboxW = (pts: { x: number }[]) => (pts.length ? Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)) : 20000);
  const bboxD = (pts: { y: number }[]) => (pts.length ? Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)) : 30000);

  const apply = (el: HTMLInputElement | HTMLSelectElement, final: boolean) => {
    const sel = ed.selection;
    const key = el.dataset.key;
    if (!sel || !key || key.startsWith('plot')) return;
    const obj = ed.find(sel);
    if (!obj) return;
    let value: any = el.value;
    if (el.dataset.unit === 'm') {
      const n = parse(el.value);
      if (!Number.isFinite(n)) return;
      value = Math.round(Math.max(+(el.dataset.min ?? 0), n) * 1000);
    } else if (el.type === 'number') {
      value = parseFloat(el.value);
      if (!Number.isFinite(value)) return;
      if (key === 'floors') value = Math.max(1, Math.min(4, Math.round(value)));
    }
    if (obj[key] === value) return;
    store.checkpoint();
    obj[key] = value;
    // byt standardvärden när typen ändras
    if (key === 'kind' && sel.kind === 'building') {
      const d = BUILDING_KINDS[value as Building['kind']].defaults;
      Object.assign(obj, { floorHeight: d.floorHeight, roof: d.roof, pitch: d.pitch, foundation: d.foundation, wallColor: d.wallColor });
      if (obj.name in nameSet) obj.name = BUILDING_KINDS[value as Building['kind']].label;
    }
    if (key === 'kind' && sel.kind === 'area') {
      const d = AREA_KINDS[value as keyof typeof AREA_KINDS];
      Object.assign(obj, { color: d.color, height: d.height });
      if (obj.name in areaNames) obj.name = d.label;
    }
    if (key === 'kind' && sel.kind === 'line') {
      const d = LINE_KINDS[value as keyof typeof LINE_KINDS];
      Object.assign(obj, { color: d.color, height: d.height, width: d.width });
      if (obj.name in lineNames) obj.name = d.label;
    }
    if (key === 'kind' && sel.kind === 'plant') {
      const d = PLANT_KINDS[value as keyof typeof PLANT_KINDS];
      Object.assign(obj, { size: d.size, height: d.height });
    }
    store.changed();
    if (final) renderProps();
  };
  const nameSet = Object.fromEntries(Object.values(BUILDING_KINDS).map((v) => [v.label, 1]));
  const areaNames = Object.fromEntries(Object.values(AREA_KINDS).map((v) => [v.label, 1]));
  const lineNames = Object.fromEntries(Object.values(LINE_KINDS).map((v) => [v.label, 1]));

  propsEl.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.key) apply(el, true);
  });
  propsEl.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.type === 'color' || el.dataset.key === 'name') apply(el, false);
  });
  propsEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') (e.target as HTMLElement).blur?.();
  });
  propsEl.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const sw = t.closest<HTMLElement>('[data-color-key]');
    if (sw) {
      const sel = ed.selection;
      const obj = sel && ed.find(sel);
      if (obj) {
        store.checkpoint();
        obj[sw.dataset.colorKey!] = sw.dataset.color;
        store.changed();
        renderProps();
      }
      return;
    }
    const btn = t.closest<HTMLButtonElement>('[data-act]');
    if (!btn) return;
    const sel = ed.selection;
    const obj = sel && ed.find(sel);
    switch (btn.dataset.act) {
      case 'delete':
        ed.deleteSelected();
        break;
      case 'duplicate':
        ed.duplicateSelected();
        break;
      case 'rect-plot': {
        const w = parse(propsEl.querySelector<HTMLInputElement>('[data-key="plotW"]')!.value) * 1000;
        const d = parse(propsEl.querySelector<HTMLInputElement>('[data-key="plotD"]')!.value) * 1000;
        if (!(w > 1000 && d > 1000)) return;
        const pts = store.site.plot;
        const x0 = pts.length ? Math.min(...pts.map((p) => p.x)) : 0;
        const y0 = pts.length ? Math.min(...pts.map((p) => p.y)) : 0;
        store.checkpoint();
        store.site.plot = [
          { x: x0, y: y0 },
          { x: x0 + w, y: y0 },
          { x: x0 + w, y: y0 + d },
          { x: x0, y: y0 + d },
        ];
        store.changed();
        renderProps();
        break;
      }
      case 'make-plan':
        if (sel?.kind === 'building') actions.makePlan(obj);
        break;
      case 'open-plan':
        if (sel?.kind === 'building') actions.openPlan(obj);
        break;
      case 'import-plan':
        if (sel?.kind === 'building') actions.importPlanFile(obj);
        break;
      case 'unlink-plan':
        if (sel?.kind === 'building') actions.unlinkPlan(obj);
        break;
    }
  });
  // Rita inte om panelen medan någon skriver i den
  const refresh = () => {
    if (!propsEl.contains(document.activeElement) || (document.activeElement as HTMLElement)?.tagName === 'BUTTON') renderProps();
  };

  // ---- Sammanställning ----
  const summaryEl = $('#summary');
  function renderSummary() {
    const s = store.site;
    const sum = siteSummary(s);
    const rows = (
      [
        ['Tomtarea', `${dec(sum.plotArea, 0)} m²`],
        ['Byggnadsarea', `${dec(sum.built)} m²`],
        ['Andel bebyggd', `${dec(sum.pct)} %`],
      ] as [string, string][]
    )
      .map(([a, b]) => `<tr><td>${a}</td><td class="num">${b}</td></tr>`)
      .join('');
    const items = [
      ...s.buildings.map((b) => ({ sel: { kind: 'building', id: b.id } as Sel, name: b.name, val: `${dec(footprint(b))} m²` })),
      ...s.areas.map((a) => ({ sel: { kind: 'area', id: a.id } as Sel, name: a.name, val: `${dec((a.w * a.d) / 1e6)} m²` })),
      ...s.lines.map((l) => ({ sel: { kind: 'line', id: l.id } as Sel, name: l.name, val: `${dec(polylineLength(l.points) / 1000)} m` })),
    ];
    const plants = s.plants.length ? `<li class="muted small">${s.plants.length} träd och buskar</li>` : '';
    summaryEl.innerHTML = `<table><tbody>${rows}</tbody></table>
      <ul class="objlist">${items
        .map((i) => `<li><button data-pick="${i.sel.kind}:${i.sel.id}" class="${ed.selection?.id === i.sel.id ? 'on' : ''}"><span>${esc(i.name)}</span><span class="num muted">${i.val}</span></button></li>`)
        .join('')}${plants}</ul>`;
  }
  summaryEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]');
    if (!b) return;
    const [kind, id] = b.dataset.pick!.split(':');
    ed.select({ kind: kind as Sel['kind'], id });
  });

  ed.onSelect = () => {
    refresh();
    renderSummary();
  };
  store.subscribe(() => {
    refresh();
    renderSummary();
  });
  $('#btn-make-project').addEventListener('click', () => actions.makeProject());
  $('#btn-sheet-side').addEventListener('click', () => actions.sheet());
  renderProps();
  renderSummary();
  return { renderProps, renderSummary };
}
