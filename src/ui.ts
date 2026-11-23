import type { Editor, Tool } from './editor';
import type { Store } from './store';
import type { Wall, Opening, Room, Item, Label, Dimension, OpeningKind } from './types';
import { FURNITURE, furnitureDef } from './furniture';
import { dist, formatArea, formatLength, polygonArea } from './geometry';
import { ROOM_COLORS } from './editor';
import { esc } from './render';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const ICONS: Record<string, string> = {
  select: '<path d="M6 3l12 9-5.5 1 3 6-2.5 1.2-3-6L6 18z" fill="currentColor"/>',
  pan: '<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  wall: '<path d="M3 20V5h7v8h11v7z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="miter"/>',
  room: '<rect x="3.5" y="5" width="17" height="14" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="2"/>',
  polyroom: '<path d="M4 18L6 5l9 2 5 7-6 6z" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  door: '<path d="M4 20h16M6 20V7M6 7a13 13 0 0 1 13 13" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 7a13 13 0 0 1 13 13" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2"/>',
  double: '<path d="M2 20h20M3 20v-8M21 20v-8M3 12a8 8 0 0 1 8 8M21 12a8 8 0 0 0-8 8" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  sliding: '<path d="M2 12h20" stroke="currentColor" stroke-width="1.2"/><rect x="3" y="8" width="10" height="3" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="11" y="13" width="10" height="3" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  window: '<rect x="3" y="9" width="18" height="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18" stroke="currentColor" stroke-width="1.2"/>',
  opening: '<path d="M2 12h6M16 12h6" stroke="currentColor" stroke-width="4"/><path d="M8 9.5h8M8 14.5h8" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2"/>',
  label: '<path d="M5 5h14M12 5v15M9 20h6" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  dim: '<path d="M3 12h18M3 8v8M21 8v8M5 10l-2 2 2 2M19 10l2 2-2 2" fill="none" stroke="currentColor" stroke-width="1.8"/>',
};

const TOOLS: { tool: Tool; name: string; key: string }[] = [
  { tool: 'select', name: 'Markera', key: 'V' },
  { tool: 'pan', name: 'Panorera', key: 'H' },
  { tool: 'wall', name: 'Vägg', key: 'W' },
  { tool: 'room', name: 'Rum', key: 'R' },
  { tool: 'polyroom', name: 'Fritt rum', key: 'P' },
  { tool: 'door', name: 'Dörr', key: 'D' },
  { tool: 'double', name: 'Pardörr', key: '' },
  { tool: 'sliding', name: 'Skjutdörr', key: '' },
  { tool: 'window', name: 'Fönster', key: 'F' },
  { tool: 'opening', name: 'Öppning', key: '' },
  { tool: 'dim', name: 'Måttlinje', key: 'M' },
  { tool: 'label', name: 'Text', key: 'T' },
];

const OPENING_NAMES: Record<OpeningKind, string> = {
  door: 'Dörr',
  double: 'Pardörr',
  sliding: 'Skjutdörr',
  window: 'Fönster',
  opening: 'Öppning',
};

export function setupUI(editor: Editor, store: Store) {
  // ----- Verktyg -----
  const toolsEl = $('#tools');
  toolsEl.innerHTML = TOOLS.map(
    (t) =>
      `<button class="tool" data-tool="${t.tool}" title="${t.name}${t.key ? ` (${t.key})` : ''}"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${ICONS[t.tool]}</svg><span>${t.name}</span></button>`,
  ).join('');
  toolsEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-tool]') as HTMLButtonElement | null;
    if (b) editor.setTool(b.dataset.tool as Tool);
  });

  // ----- Möbelbibliotek -----
  const lib = $('#library');
  const renderLibrary = (q = '') => {
    const ql = q.trim().toLowerCase();
    const cats = new Map<string, typeof FURNITURE>();
    for (const f of FURNITURE) {
      if (ql && !f.name.toLowerCase().includes(ql) && !f.category.toLowerCase().includes(ql)) continue;
      if (!cats.has(f.category)) cats.set(f.category, []);
      cats.get(f.category)!.push(f);
    }
    lib.innerHTML =
      [...cats]
        .map(
          ([cat, items]) =>
            `<h3>${esc(cat)}</h3><div class="lib-grid">${items
              .map((f) => {
                const m = Math.max(f.w, f.d) * 0.6;
                return `<button class="lib-item" data-type="${f.type}" title="${esc(f.name)} – ${f.w / 10}×${f.d / 10} cm"><svg viewBox="${-m} ${-m} ${2 * m} ${2 * m}" width="44" height="44">${f.draw(f.w, f.d, f.color)}</svg><span>${esc(f.name)}</span></button>`;
              })
              .join('')}</div>`,
        )
        .join('') || '<p class="muted small">Inga träffar.</p>';
  };
  renderLibrary();
  $('#furniture-search').addEventListener('input', (e) => renderLibrary((e.target as HTMLInputElement).value));
  lib.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-type]') as HTMLButtonElement | null;
    if (b) editor.setTool('furniture', b.dataset.type);
  });

  const syncTools = () => {
    toolsEl.querySelectorAll<HTMLButtonElement>('button[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === editor.tool));
    lib.querySelectorAll<HTMLButtonElement>('button[data-type]').forEach((b) =>
      b.classList.toggle('active', editor.tool === 'furniture' && b.dataset.type === editor.furnitureType),
    );
  };
  editor.onToolChange = syncTools;

  // ----- Inställningar -----
  const bindCheck = (id: string, key: 'snap' | 'createWalls' | 'showWallLengths' | 'showAreas' | 'showFurniture') => {
    const el = $<HTMLInputElement>(id);
    el.checked = editor.settings[key];
    el.addEventListener('change', () => {
      editor.settings[key] = el.checked;
      editor.renderAll();
    });
  };
  bindCheck('#opt-snap', 'snap');
  bindCheck('#opt-walls', 'createWalls');
  bindCheck('#opt-lengths', 'showWallLengths');
  bindCheck('#opt-areas', 'showAreas');
  bindCheck('#opt-furniture', 'showFurniture');
  $<HTMLSelectElement>('#opt-grid').addEventListener('change', (e) => {
    editor.settings.gridStep = Number((e.target as HTMLSelectElement).value);
  });
  $<HTMLInputElement>('#opt-thickness').addEventListener('change', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    if (v > 0) editor.settings.wallThickness = v;
  });

  // ----- Status -----
  const hintEl = $('#status-hint');
  const cursorEl = $('#status-cursor');
  const zoomEl = $('#status-zoom');
  const measureEl = $('#status-measure');
  editor.onStatus = (s) => {
    if (s.hint !== undefined) hintEl.textContent = s.hint;
    if (s.cursor) cursorEl.textContent = `x ${formatLength(s.cursor.x)}  y ${formatLength(s.cursor.y)}`;
    if (s.zoom !== undefined) zoomEl.textContent = `1 m = ${Math.round(s.zoom * 1000)} px`;
    if (s.measure !== undefined) measureEl.textContent = s.measure;
  };

  // ----- Planer -----
  const plansEl = $('#plans');
  const nameEl = $<HTMLInputElement>('#plan-name');
  const renderPlans = () => {
    plansEl.innerHTML = store.plans
      .map((p) => {
        const area = p.rooms.reduce((s, r) => s + polygonArea(r.points), 0);
        return `<li class="${p.id === store.plan.id ? 'active' : ''}" data-id="${p.id}">
          <button class="plan-open" data-id="${p.id}"><strong>${esc(p.name)}</strong><span class="muted small">${p.rooms.length} rum · ${formatArea(area)}</span></button>
          <button class="icon-btn plan-del" data-del="${p.id}" title="Ta bort plan" aria-label="Ta bort ${esc(p.name)}">✕</button>
        </li>`;
      })
      .join('');
    if (document.activeElement !== nameEl) nameEl.value = store.plan.name;
  };
  plansEl.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const del = t.closest('[data-del]') as HTMLElement | null;
    if (del) {
      // Två klick krävs: första klicket ber om bekräftelse
      const p = store.plans.find((x) => x.id === del.dataset.del);
      if (!p) return;
      if (del.classList.contains('confirm')) store.deletePlan(p.id);
      else {
        del.classList.add('confirm');
        del.textContent = 'Ta bort?';
        del.title = 'Klicka igen för att ta bort planen. Det går inte att ångra.';
        setTimeout(() => renderPlans(), 3000);
      }
      return;
    }
    const open = t.closest('.plan-open') as HTMLElement | null;
    if (open) {
      store.switchTo(open.dataset.id!);
      editor.select(null);
      editor.fitView();
    }
  });
  nameEl.addEventListener('input', () => {
    store.plan.name = nameEl.value;
    store.changed();
  });
  $('#btn-new').addEventListener('click', () => {
    store.newPlan();
    editor.select(null);
    editor.fitView();
  });
  $('#btn-variant').addEventListener('click', () => {
    store.duplicatePlan();
    editor.select(null);
  });

  // ----- Ångra / gör om -----
  const undoBtn = $<HTMLButtonElement>('#btn-undo');
  const redoBtn = $<HTMLButtonElement>('#btn-redo');
  undoBtn.addEventListener('click', () => store.undo());
  redoBtn.addEventListener('click', () => store.redo());

  // ----- Sammanställning -----
  const summaryEl = $('#summary');
  const renderSummary = () => {
    const p = store.plan;
    const rooms = p.rooms.map((r) => ({ name: r.name, area: polygonArea(r.points), color: r.color }));
    const total = rooms.reduce((s, r) => s + r.area, 0);
    const wallLen = p.walls.reduce((s, w) => s + dist(w.a, w.b), 0);
    summaryEl.innerHTML =
      (rooms.length
        ? `<table><tbody>${rooms
            .map((r) => `<tr><td><span class="swatch" style="background:${esc(r.color)}"></span>${esc(r.name)}</td><td class="num">${formatArea(r.area)}</td></tr>`)
            .join('')}</tbody><tfoot><tr><td>Totalt</td><td class="num">${formatArea(total)}</td></tr></tfoot></table>`
        : '<p class="muted small">Inga rum ännu. Använd verktyget Rum för att rita.</p>') +
      `<p class="muted small">${p.walls.length} väggar (${formatLength(wallLen)}) · ${p.openings.filter((o) => o.kind !== 'window').length} dörrar/öppningar · ${p.openings.filter((o) => o.kind === 'window').length} fönster · ${p.items.length} möbler</p>`;
  };

  // ----- Egenskaper -----
  const propsEl = $('#props');
  const field = (label: string, html: string) => `<label class="field"><span>${label}</span>${html}</label>`;
  const num = (key: string, value: number, unit = 'mm', step = 10, min = 0) =>
    `<span class="unit-input"><input type="number" data-key="${key}" value="${Math.round(value * 10) / 10}" step="${step}" min="${min}"/> ${unit}</span>`;
  const text = (key: string, value: string) => `<input type="text" data-key="${key}" value="${esc(value)}"/>`;
  const color = (key: string, value: string) => `<input type="color" data-key="${key}" value="${esc(value)}"/>`;
  const check = (key: string, value: boolean, label: string) =>
    `<label class="row"><input type="checkbox" data-key="${key}" ${value ? 'checked' : ''}/> ${label}</label>`;
  const actions = (extra = '') =>
    `<div class="btn-row">${extra}<button data-action="duplicate" title="Ctrl+D">Duplicera</button><button data-action="delete" class="danger" title="Delete">Ta bort</button></div>`;

  const renderProps = () => {
    const sel = editor.selection;
    const ent = sel && editor.findEntity(sel);
    if (!sel || !ent) {
      propsEl.innerHTML = `<p class="muted small">Markera något i ritningen för att ändra det.</p>
        <div class="shortcuts small muted">
          <div><kbd>W</kbd> vägg · <kbd>R</kbd> rum · <kbd>D</kbd> dörr · <kbd>F</kbd> fönster</div>
          <div><kbd>Q</kbd>/<kbd>E</kbd> rotera · <kbd>Ctrl+D</kbd> duplicera · <kbd>Del</kbd> ta bort</div>
          <div><kbd>Mellanslag</kbd>+dra panorerar · scrolla zoomar</div>
        </div>`;
      return;
    }
    let html = '';
    switch (sel.kind) {
      case 'wall': {
        const w = ent as Wall;
        html = `<h3>Vägg</h3>` + field('Längd', num('length', dist(w.a, w.b), 'mm', 10, 10)) + field('Tjocklek', num('thickness', w.thickness, 'mm', 10, 20)) + actions();
        break;
      }
      case 'opening': {
        const o = ent as Opening;
        const kinds = (Object.keys(OPENING_NAMES) as OpeningKind[])
          .map((k) => `<option value="${k}" ${k === o.kind ? 'selected' : ''}>${OPENING_NAMES[k]}</option>`)
          .join('');
        const isDoor = o.kind === 'door' || o.kind === 'double';
        html =
          `<h3>${OPENING_NAMES[o.kind]}</h3>` +
          field('Typ', `<select data-key="kind">${kinds}</select>`) +
          field('Bredd', num('width', o.width, 'mm', 10, 100)) +
          (isDoor ? check('flip', o.flip, 'Gångjärn på andra sidan') + check('side', o.side, 'Öppnar åt andra hållet') : '') +
          actions();
        break;
      }
      case 'room': {
        const r = ent as Room;
        const swatches = ROOM_COLORS.map((c) => `<button class="swatch-btn" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('');
        html =
          `<h3>Rum</h3>` +
          field('Namn', text('name', r.name)) +
          field('Golvfärg', `<div class="swatches">${swatches}${color('color', r.color)}</div>`) +
          `<p class="stat">Area <strong>${formatArea(polygonArea(r.points))}</strong></p>` +
          actions();
        break;
      }
      case 'item': {
        const it = ent as Item;
        const def = furnitureDef(it.type);
        html =
          `<h3>${esc(def.name)}</h3>` +
          field('Etikett', text('label', it.label ?? '')) +
          field('Bredd', num('w', it.w, 'mm', 10, 50)) +
          field('Djup', num('d', it.d, 'mm', 10, 50)) +
          field('Rotation', num('rotation', it.rotation, '°', 15, -360)) +
          field('Färg', color('color', it.color)) +
          actions(`<button data-action="rotate" title="E">Vrid 90°</button>`);
        break;
      }
      case 'label': {
        const l = ent as Label;
        html = `<h3>Text</h3>` + field('Text', text('text', l.text)) + field('Storlek', num('size', l.size, 'mm', 10, 50)) + actions();
        break;
      }
      case 'dim': {
        const d = ent as Dimension;
        html = `<h3>Måttlinje</h3><p class="stat">Längd <strong>${formatLength(dist(d.a, d.b))}</strong></p>` + actions();
        break;
      }
    }
    propsEl.innerHTML = html;
  };

  propsEl.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement | HTMLSelectElement;
    const key = input.dataset.key;
    const sel = editor.selection;
    if (!key || !sel) return;
    const ent = editor.findEntity(sel);
    if (!ent) return;
    store.checkpoint();
    const value: any = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input instanceof HTMLInputElement && input.type === 'number' ? Number(input.value) : input.value;
    if (sel.kind === 'wall' && key === 'length') {
      const w = ent as Wall;
      const len = dist(w.a, w.b);
      if (value > 0 && len > 0) {
        const oldB = { ...w.b };
        const nb = { x: w.a.x + ((w.b.x - w.a.x) / len) * value, y: w.a.y + ((w.b.y - w.a.y) / len) * value };
        // Flytta anslutna väggar/rum med
        for (const o of store.plan.walls) {
          if (o.id === w.id) continue;
          if (Math.abs(o.a.x - oldB.x) < 1 && Math.abs(o.a.y - oldB.y) < 1) o.a = { ...nb };
          if (Math.abs(o.b.x - oldB.x) < 1 && Math.abs(o.b.y - oldB.y) < 1) o.b = { ...nb };
        }
        for (const r of store.plan.rooms) r.points = r.points.map((q) => (Math.abs(q.x - oldB.x) < 1 && Math.abs(q.y - oldB.y) < 1 ? { ...nb } : q));
        w.b = nb;
      }
    } else if (key === 'rotation') {
      ent.rotation = ((value % 360) + 360) % 360;
    } else if (typeof value === 'number' && (Number.isNaN(value) || (value <= 0 && key !== 'rotation'))) {
      // ignorera ogiltiga värden
    } else {
      ent[key] = value;
    }
    store.changed();
  });
  // Live-uppdatering för textfält
  propsEl.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.type !== 'text') return;
    const sel = editor.selection;
    const ent = sel && editor.findEntity(sel);
    if (!ent || !input.dataset.key) return;
    ent[input.dataset.key] = input.value;
    editor.renderAll();
    renderSummary();
  });
  propsEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b) return;
    if (b.dataset.action === 'delete') editor.deleteSelection();
    else if (b.dataset.action === 'duplicate') editor.duplicateSelection();
    else if (b.dataset.action === 'rotate') editor.rotateSelection(90);
    else if (b.dataset.color && editor.selection?.kind === 'room') {
      const r = editor.findEntity(editor.selection);
      store.checkpoint();
      r.color = b.dataset.color;
      store.changed();
    }
  });
  // Spara textändringar i historiken när fältet får fokus
  propsEl.addEventListener('focusin', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.type === 'text') store.checkpoint();
  });

  editor.onSelectionChange = () => {
    if (!propsEl.contains(document.activeElement)) renderProps();
    else if (editor.selection === null) renderProps();
  };

  const refresh = () => {
    renderPlans();
    renderSummary();
    undoBtn.disabled = !store.canUndo();
    redoBtn.disabled = !store.canRedo();
    // Uppdatera egenskapspanelen om användaren inte skriver i den just nu
    if (!propsEl.contains(document.activeElement)) renderProps();
  };
  store.subscribe(refresh);
  refresh();
  renderProps();
  syncTools();
  editor.setTool('select');
}
