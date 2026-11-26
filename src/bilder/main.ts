import '../style.css';
import './style.css';
import { ARTIFACT_LINKS, download, inArtifact, receiveHandoff, safeFilename, takeParam } from '../common';
import { addImage, allImages, canvasToBlob, deleteImage, getMeta, loadBitmap, putImage, setMeta, type Bild } from './db';
import { SketchEditor, TOOLS, type Tool } from './editor';
import { collageLayout, placeInside, type Item, type Sketch } from './model';
import { AiError, PROVIDERS, buildPrompt, editImage, hasKey, listModels, loadSettings, saveSettings, type Provider } from './ai';
import { newId } from './db';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ---------- Meddelanden ----------
const toastEl = $('#toast');
let toastTimer: number | undefined;
function notify(msg: string, ms = 5000) {
  toastEl.innerHTML = msg;
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), ms);
}
const fail = (what: string) => (err: unknown) => notify(`${what}: ${esc((err as Error)?.message ?? String(err))}`, 8000);

// ---------- Bilderna ----------
let images: Bild[] = [];
const urls = new Map<string, string>();
const thumbUrl = (b: Bild) => {
  const k = `t:${b.id}`;
  if (!urls.has(k)) urls.set(k, URL.createObjectURL(b.thumb));
  return urls.get(k)!;
};
const fullUrl = (b: Bild) => {
  const k = `f:${b.id}`;
  if (!urls.has(k)) urls.set(k, URL.createObjectURL(b.blob));
  return urls.get(k)!;
};
const byId = (id?: string) => (id ? images.find((b) => b.id === id) : undefined);

const DEFAULT_ALBUMS = ['Huset', 'Tomten', 'Inspiration'];
let albums: string[] = [];
const ALL = '\u0000alla';
const NONE = '';
let currentAlbum = ALL;
let selected = new Set<string>();
let lastClicked: string | null = null;

async function reload() {
  images = await allImages();
  const stored = await getMeta<string[]>('album');
  albums = stored ?? DEFAULT_ALBUMS;
  if (!stored) await setMeta('album', albums);
  for (const b of images) if (b.album && !albums.includes(b.album)) albums.push(b.album);
  for (const id of [...selected]) if (!byId(id)) selected.delete(id);
  renderLibrary();
}

const sourceLabel: Record<Bild['source'], string> = {
  uppladdad: 'Uppladdad',
  ai: 'AI-förslag',
  skiss: 'Skiss',
  planritaren: 'Från Planritaren',
  tomtplaneraren: 'Från Tomtplaneraren',
};

function visibleImages() {
  const q = $<HTMLInputElement>('#search').value.trim().toLowerCase();
  const sort = $<HTMLSelectElement>('#sort').value;
  let list = images.filter((b) => currentAlbum === ALL || b.album === currentAlbum);
  if (q) list = list.filter((b) => `${b.name} ${b.prompt ?? ''} ${b.album}`.toLowerCase().includes(q));
  list.sort((a, b) => (sort === 'old' ? a.created - b.created : sort === 'name' ? a.name.localeCompare(b.name, 'sv') : b.created - a.created));
  return list;
}

function renderLibrary() {
  // Album
  const counts = new Map<string, number>();
  for (const b of images) counts.set(b.album, (counts.get(b.album) ?? 0) + 1);
  const rows: [string, string, number][] = [[ALL, 'Alla bilder', images.length], ...albums.map((a) => [a, a, counts.get(a) ?? 0] as [string, string, number])];
  if (counts.get(NONE)) rows.push([NONE, 'Utan album', counts.get(NONE)!]);
  $('#albums').innerHTML = rows
    .map(
      ([key, label, n]) =>
        `<li><button class="album-btn${key === currentAlbum ? ' on' : ''}" data-album="${esc(key)}"><span>${esc(label)}</span><span class="muted">${n}</span></button></li>`,
    )
    .join('');
  $('#album-title').textContent = currentAlbum === ALL ? 'Alla bilder' : currentAlbum === NONE ? 'Utan album' : currentAlbum;

  const list = visibleImages();
  $('#album-count').textContent = `${list.length} ${list.length === 1 ? 'bild' : 'bilder'}`;
  $('#empty').hidden = list.length > 0;
  $('#grid').innerHTML = list
    .map(
      (b) => `<figure class="photo${selected.has(b.id) ? ' sel' : ''}" data-id="${b.id}" tabindex="0" title="Dubbelklicka för att skissa och be AI ändra">
        <div class="photo-img"><img src="${thumbUrl(b)}" alt="" loading="lazy" draggable="false" />
          ${b.source === 'ai' ? '<span class="badge ai">AI</span>' : b.source === 'skiss' ? '<span class="badge">Skiss</span>' : ''}
          <span class="check" data-check="1" title="Markera flera">${selected.has(b.id) ? '✓' : ''}</span>
        </div>
        <figcaption>${esc(b.name)}</figcaption>
      </figure>`,
    )
    .join('');
  renderDetails();
}

function albumOptions(current: string) {
  return [`<option value=""${current === '' ? ' selected' : ''}>Utan album</option>`, ...albums.map((a) => `<option${a === current ? ' selected' : ''}>${esc(a)}</option>`)].join('');
}

function renderDetails() {
  const el = $('#details');
  const sel = [...selected].map(byId).filter(Boolean) as Bild[];
  if (!sel.length) {
    el.innerHTML = `<h2>Bild</h2><p class="muted small">Klicka på en bild för att se den här. Håll in Ctrl (eller tryck på bockrutan) för att markera flera.</p>
      <p class="muted small">Har du en bild från Planritaren eller Tomtplaneraren? Där finns knappen <b>Till bildbiblioteket</b> i 3D-vyn.</p>`;
    return;
  }
  if (sel.length > 1) {
    el.innerHTML = `<h2>${sel.length} bilder markerade</h2>
      <div class="multi-thumbs">${sel
        .slice(0, 12)
        .map((b) => `<img src="${thumbUrl(b)}" alt="" />`)
        .join('')}</div>
      <button class="primary wide" data-act="combine">Kombinera i en skiss</button>
      <p class="muted small">Bilderna läggs bredvid varandra. Flytta dem, skissa och be AI göra en bild av det, t.ex. ”huset med verandan från bild 2”.</p>
      <label class="field"><span>Flytta till</span><select data-act="move-album"><option value="">Välj album…</option>${albums.map((a) => `<option>${esc(a)}</option>`).join('')}</select></label>
      <div class="btn-row">
        <button data-act="download-all">Ladda ner</button>
        <button data-act="delete" class="danger">Ta bort ${sel.length} bilder</button>
        <button data-act="unselect">Avmarkera</button>
      </div>`;
    return;
  }
  const b = sel[0];
  const parent = byId(b.parentId);
  const children = images.filter((x) => x.parentId === b.id).sort((x, y) => y.created - x.created);
  el.innerHTML = `
    <div class="detail-img"><img src="${fullUrl(b)}" alt="" data-act="open" title="Dubbelklicka för att skissa" /></div>
    <label class="field"><span>Namn</span><input type="text" data-act="rename" value="${esc(b.name)}" /></label>
    <label class="field"><span>Album</span><select data-act="album">${albumOptions(b.album)}</select></label>
    <p class="muted small">${sourceLabel[b.source]} · ${new Date(b.created).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' })} · ${b.width} × ${b.height} px</p>
    ${b.prompt ? `<p class="prompt-quote">”${esc(b.prompt)}”</p>` : ''}
    <button class="primary wide" data-act="edit">✏️ Skissa och be AI ändra</button>
    ${b.sketch ? `<button class="wide" data-act="edit-sketch">Fortsätt på skissen (med lagren)</button>` : ''}
    ${parent ? `<button class="wide" data-act="compare">Jämför med originalet</button>` : ''}
    <div class="btn-row">
      <button data-act="download">Ladda ner</button>
      <button data-act="delete" class="danger">Ta bort</button>
    </div>
    ${parent ? `<h3>Gjord från</h3><div class="mini-row"><img src="${thumbUrl(parent)}" data-goto="${parent.id}" alt="" title="${esc(parent.name)}" /></div>` : ''}
    ${children.length ? `<h3>Förslag och skisser från den här (${children.length})</h3><div class="mini-row">${children.map((c) => `<img src="${thumbUrl(c)}" data-goto="${c.id}" alt="" title="${esc(c.name)}" />`).join('')}</div>` : ''}`;
}

// ---------- Händelser i biblioteket ----------
$('#albums').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-album]');
  if (!btn) return;
  currentAlbum = btn.dataset.album!;
  renderLibrary();
});
$('#btn-new-album').addEventListener('click', () => {
  const li = document.createElement('li');
  li.innerHTML = `<input type="text" class="album-input" placeholder="Albumets namn" />`;
  $('#albums').appendChild(li);
  const input = li.querySelector('input')!;
  input.focus();
  const done = async (save: boolean) => {
    const name = input.value.trim();
    input.onblur = null;
    if (save && name && !albums.includes(name)) {
      albums.push(name);
      await setMeta('album', albums);
      currentAlbum = name;
    }
    renderLibrary();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') void done(true);
    if (e.key === 'Escape') void done(false);
  };
  input.onblur = () => void done(true);
});
$('#search').addEventListener('input', renderLibrary);
$('#sort').addEventListener('change', renderLibrary);

$('#grid').addEventListener('click', (e) => {
  const fig = (e.target as HTMLElement).closest<HTMLElement>('.photo');
  if (!fig) return;
  const id = fig.dataset.id!;
  const toggle = e.ctrlKey || e.metaKey || !!(e.target as HTMLElement).closest('[data-check]');
  if (e.shiftKey && lastClicked) {
    const ids = visibleImages().map((b) => b.id);
    const [a, z] = [ids.indexOf(lastClicked), ids.indexOf(id)].sort((x, y) => x - y);
    if (a >= 0) ids.slice(a, z + 1).forEach((x) => selected.add(x));
  } else if (toggle) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
  } else selected = new Set([id]);
  lastClicked = id;
  // Uppdatera bara markeringen (att rita om rutnätet skulle störa dubbelklick)
  document.querySelectorAll<HTMLElement>('#grid .photo').forEach((f) => {
    const on = selected.has(f.dataset.id!);
    f.classList.toggle('sel', on);
    f.querySelector('.check')!.textContent = on ? '✓' : '';
  });
  renderDetails();
});
$('#grid').addEventListener('dblclick', (e) => {
  const fig = (e.target as HTMLElement).closest<HTMLElement>('.photo');
  if (fig) void openImageInEditor(fig.dataset.id!).catch(fail('Kunde inte öppna bilden'));
});
$('#grid').addEventListener('keydown', (e) => {
  const fig = (e.target as HTMLElement).closest<HTMLElement>('.photo');
  if (fig && e.key === 'Enter') void openImageInEditor(fig.dataset.id!).catch(fail('Kunde inte öppna bilden'));
});

$('#details').addEventListener('click', async (e) => {
  const t = e.target as HTMLElement;
  const goto = t.closest<HTMLElement>('[data-goto]')?.dataset.goto;
  if (goto) {
    selected = new Set([goto]);
    const g = byId(goto);
    if (g && currentAlbum !== ALL && g.album !== currentAlbum) currentAlbum = ALL;
    renderLibrary();
    return;
  }
  const btn = t.closest<HTMLElement>('button[data-act]');
  const act = btn?.dataset.act;
  if (!act) return;
  const sel = [...selected].map(byId).filter(Boolean) as Bild[];
  try {
    if (act === 'edit') await openImageInEditor(sel[0].id);
    else if (act === 'edit-sketch') await openSketch(structuredClone(sel[0].sketch!), sel[0].name, sel[0].sketch?.baseId);
    else if (act === 'compare') openCompare(byId(sel[0].parentId)!, sel[0]);
    else if (act === 'download') await download(sel[0].blob, `${safeFilename(sel[0].name, 'bild')}.${ext(sel[0].blob)}`);
    else if (act === 'download-all') for (const b of sel) await download(b.blob, `${safeFilename(b.name, 'bild')}.${ext(b.blob)}`);
    else if (act === 'combine') await combine(sel);
    else if (act === 'unselect') {
      selected.clear();
      renderLibrary();
    } else if (act === 'delete') {
      if (btn!.dataset.confirm !== '1') {
        btn!.dataset.confirm = '1';
        btn!.textContent = 'Säker? Klicka igen';
        btn!.classList.add('confirm');
        setTimeout(() => {
          if (btn!.isConnected) renderDetails();
        }, 4000);
        return;
      }
      for (const b of sel) {
        await deleteImage(b.id);
        // Förslag som gjorts från bilden blir kvar, men utan koppling
        for (const c of images.filter((x) => x.parentId === b.id)) await putImage({ ...c, parentId: undefined });
      }
      notify(sel.length === 1 ? 'Bilden är borttagen.' : `${sel.length} bilder är borttagna.`);
      selected.clear();
      await reload();
    }
  } catch (err) {
    fail('Det gick inte')(err);
  }
});
$('#details').addEventListener('dblclick', (e) => {
  if ((e.target as HTMLElement).closest('[data-act="open"]')) {
    const id = [...selected][0];
    if (id) void openImageInEditor(id).catch(fail('Kunde inte öppna bilden'));
  }
});
$('#details').addEventListener('change', async (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  const sel = [...selected].map(byId).filter(Boolean) as Bild[];
  if (el.dataset.act === 'rename' && sel[0]) await putImage({ ...sel[0], name: el.value.trim() || sel[0].name });
  else if (el.dataset.act === 'album' && sel[0]) await putImage({ ...sel[0], album: el.value });
  else if (el.dataset.act === 'move-album' && el.value) {
    for (const b of sel) await putImage({ ...b, album: el.value });
    notify(`Flyttade ${sel.length} bilder till ${esc(el.value)}.`);
  } else return;
  await reload();
});

const ext = (b: Blob) => (b.type === 'image/png' ? 'png' : b.type === 'image/webp' ? 'webp' : 'jpg');

// ---------- Lägga till bilder ----------
async function addFiles(files: File[] | FileList, album = currentAlbum === ALL ? '' : currentAlbum) {
  const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic)$/i.test(f.name));
  if (!list.length) return notify('Det var ingen bild. Välj en bildfil (t.ex. JPG eller PNG).');
  const added: Bild[] = [];
  for (const f of list) {
    try {
      added.push(await addImage(f, { name: f.name.replace(/\.[^.]+$/, '') || 'Bild', album, source: 'uppladdad' }));
    } catch (err) {
      notify(`${esc(f.name)} kunde inte läsas in: ${esc((err as Error).message)}${/heic/i.test(f.name) ? ' (HEIC-bilder från iPhone fungerar inte i alla webbläsare – spara som JPG först.)' : ''}`, 9000);
    }
  }
  if (added.length) {
    notify(added.length === 1 ? 'Bilden är tillagd.' : `${added.length} bilder är tillagda.`);
    selected = new Set(added.map((b) => b.id));
    await reload();
  }
  return added;
}

const fileInput = $<HTMLInputElement>('#file-input');
for (const id of ['#btn-upload', '#btn-upload-2']) $(id).addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) void addFiles(fileInput.files);
  fileInput.value = '';
});

const drop = $('#drop-zone');
let dragDepth = 0;
drop.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  drop.classList.add('dragging');
});
drop.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    drop.classList.remove('dragging');
  }
});
drop.addEventListener('dragover', (e) => e.preventDefault());
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  drop.classList.remove('dragging');
  if (e.dataTransfer?.files.length) void addFiles(e.dataTransfer.files);
});
document.addEventListener('paste', (e) => {
  if ((e.target as HTMLElement)?.closest?.('input, textarea')) return;
  const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  if (!$('#editor-screen').hidden) void addImageToSketch(files[0]);
  else void addFiles(files);
});

// ================== Skissa ==================
const ed = new SketchEditor($('#ed-canvas'));
let sketchName = 'Skiss';
let draftTimer: number | undefined;
let refs: string[] = [];

function showScreen(which: 'library' | 'editor') {
  $('#library-screen').hidden = which !== 'library';
  $('#editor-screen').hidden = which !== 'editor';
  if (which === 'editor') requestAnimationFrame(() => ed.fit());
}

async function ensureLoaded(ids: string[]) {
  for (const id of ids) {
    if (ed.images.has(id)) continue;
    const b = byId(id);
    if (b) ed.images.set(id, await loadBitmap(b.blob));
  }
}

async function openSketch(sketch: Sketch, name: string, baseId?: string, keepRefs: string[] = []) {
  sketch.baseId = baseId;
  await ensureLoaded(sketch.items.filter((i) => i.kind === 'image').map((i) => (i as any).src));
  sketchName = name;
  refs = keepRefs.filter((id) => byId(id));
  $<HTMLInputElement>('#ed-name').value = name;
  ed.load(sketch);
  ed.setTool(ed.base ? 'mark' : 'pen');
  setStatus('');
  showScreen('editor');
  renderEditorPanels();
  saveDraft();
}

async function openImageInEditor(id: string) {
  const b = byId(id);
  if (!b) return;
  const sketch: Sketch = {
    width: b.width,
    height: b.height,
    background: '#ffffff',
    items: [{ kind: 'image', id: newId(), src: b.id, x: 0, y: 0, w: b.width, h: b.height, opacity: 1, locked: true }],
  };
  $<HTMLTextAreaElement>('#ai-wish').value = '';
  await openSketch(sketch, b.name, b.id);
}

async function combine(list: Bild[]) {
  const lay = collageLayout(
    list.map((b) => ({ w: b.width, h: b.height })),
    2400,
  );
  const items: Item[] = list.map((b, i) => ({ kind: 'image', id: newId(), src: b.id, ...lay.boxes[i], opacity: 1 }));
  // Numrera bilderna så att man kan skriva "bild 1", "bild 2" i beskrivningen
  list.forEach((_, i) => {
    const bx = lay.boxes[i];
    items.push({ kind: 'text', id: newId(), x: bx.x + 16, y: bx.y + 12, text: `Bild ${i + 1}`, color: '#ffffff', size: 56 });
  });
  $<HTMLTextAreaElement>('#ai-wish').value = '';
  await openSketch({ width: lay.width, height: lay.height, background: '#ffffff', items }, `Kombination – ${list.map((b) => b.name).join(', ')}`.slice(0, 80));
  notify('Bilderna ligger bredvid varandra. Flytta och ändra storlek med <b>Flytta</b>, skissa, och beskriv vad AI ska göra av dem.', 9000);
}

$('#btn-new-sketch').addEventListener('click', () => {
  $<HTMLTextAreaElement>('#ai-wish').value = '';
  void openSketch({ width: 1600, height: 1000, background: '#ffffff', items: [] }, 'Ny skiss');
});

// Utkast: skissen sparas medan man ritar så att inget försvinner
function saveDraft() {
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => {
    void setMeta('utkast', { sketch: ed.sketch, name: sketchName, wish: $<HTMLTextAreaElement>('#ai-wish').value, refs, ts: Date.now() }).catch(() => {});
  }, 400);
}
async function restoreDraft() {
  const d = await getMeta<{ sketch: Sketch; name: string; wish: string; refs: string[] }>('utkast');
  if (!d?.sketch) return;
  $<HTMLTextAreaElement>('#ai-wish').value = d.wish ?? '';
  await openSketch(d.sketch, d.name, d.sketch.baseId, d.refs ?? []);
}
$('#btn-draft').addEventListener('click', () => void restoreDraft().catch(fail('Kunde inte öppna skissen')));

$('#ed-back').addEventListener('click', async () => {
  saveDraft();
  showScreen('library');
  $('#btn-draft').hidden = false;
  await reload();
});
$<HTMLInputElement>('#ed-name').addEventListener('input', (e) => {
  sketchName = (e.target as HTMLInputElement).value;
  saveDraft();
});
$('#ai-wish').addEventListener('input', saveDraft);

// Verktyg
$('#ed-tools').innerHTML = TOOLS.map(
  (t) => `<button class="tool${t.id === 'mark' ? ' mark-tool' : ''}" data-tool="${t.id}" title="${esc(t.hint)} (${t.key.toUpperCase()})">${t.label}</button>`,
).join('');
$('#ed-tools').addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tool]')?.dataset.tool as Tool | undefined;
  if (t) {
    ed.setTool(t);
    renderEditorPanels();
  }
});
const COLORS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#ffffff', '#212121'];
$('#ed-colors').innerHTML =
  COLORS.map((c) => `<button class="color-btn" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('') +
  `<label class="color-btn custom" title="Egen färg"><input type="color" id="ed-color-custom" value="#e53935" /></label>`;
$('#ed-colors').addEventListener('click', (e) => {
  const c = (e.target as HTMLElement).closest<HTMLElement>('[data-color]')?.dataset.color;
  if (c) setColor(c);
});
$('#ed-color-custom').addEventListener('input', (e) => setColor((e.target as HTMLInputElement).value));
function setColor(c: string) {
  ed.color = c;
  const s = ed.selected;
  if (s && 'color' in s) ed.updateSelected({ color: c } as Partial<Item>);
  renderEditorPanels();
}
$('#ed-weights').innerHTML = ['Smal', 'Mellan', 'Tjock'].map((l, i) => `<button data-w="${i + 1}">${l}</button>`).join('');
$('#ed-weights').addEventListener('click', (e) => {
  const w = Number((e.target as HTMLElement).closest<HTMLElement>('[data-w]')?.dataset.w);
  if (w) {
    ed.weight = w;
    renderEditorPanels();
  }
});

ed.onStatus = (s) => {
  if (s.hint !== undefined) $('#ed-hint').textContent = s.hint;
  if (s.zoom !== undefined) $('#ed-zoom').textContent = s.zoom;
};
ed.onChange = () => {
  renderEditorPanels();
  saveDraft();
};
ed.onSelect = () => renderEditorPanels();

function renderEditorPanels() {
  document.querySelectorAll<HTMLElement>('#ed-tools [data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === ed.tool));
  document.querySelectorAll<HTMLElement>('#ed-colors [data-color]').forEach((b) => b.classList.toggle('on', b.dataset.color === ed.color));
  document.querySelectorAll<HTMLElement>('#ed-weights [data-w]').forEach((b) => b.classList.toggle('on', Number(b.dataset.w) === ed.weight));
  $<HTMLButtonElement>('#ed-undo').disabled = !ed.canUndo;
  $<HTMLButtonElement>('#ed-redo').disabled = !ed.canRedo;
  $<HTMLButtonElement>('#ed-clear').disabled = !ed.hasDrawings;
  // Markerat föremål
  const s = ed.selected;
  const box = $('#ed-selected');
  box.hidden = !s;
  if (s) {
    const name = { image: 'Bild', pen: 'Penndrag', mark: 'Ändra här-område', arrow: 'Pil', rect: 'Ruta', ellipse: 'Ring', text: 'Text' }[s.kind];
    const locked = s.kind === 'image' && s.locked;
    $('#ed-sel-body').innerHTML = `<p class="small"><b>${name}</b>${locked ? ' (bakgrund – ligger fast)' : ''}</p>
      ${s.kind === 'image' && !locked ? `<label class="row">Genomskinlighet <input type="range" min="0.2" max="1" step="0.05" value="${s.opacity}" data-sel="opacity" /></label>` : ''}
      ${!locked ? `<div class="btn-row"><button data-sel="up" title="Lägg framför">Framåt</button><button data-sel="down" title="Lägg bakom">Bakåt</button><button data-sel="delete" class="danger">Ta bort</button></div>` : ''}`;
  }
  // AI-panelen
  const isEdit = !!ed.base;
  $('#ai-sketch-row').hidden = !isEdit || !ed.hasDrawings;
  $('#ai-go').textContent = isEdit ? '✨ Be AI ändra bilden' : '✨ Be AI göra en bild av skissen';
  const st = loadSettings();
  $('#ai-provider').innerHTML = hasKey(st)
    ? `Använder ${esc(PROVIDERS[st.provider].name)} · <button class="link-btn" data-open-settings>Ändra</button>`
    : `Ingen AI-nyckel ännu · <button class="link-btn" data-open-settings>Lägg in nyckel</button>`;
  $('#ai-refs').innerHTML = refs.length
    ? refs
        .map((id) => byId(id))
        .filter(Boolean)
        .map((b) => `<span class="ref"><img src="${thumbUrl(b!)}" alt="" title="${esc(b!.name)}" /><button data-unref="${b!.id}" title="Ta bort">×</button></span>`)
        .join('')
    : '<span class="muted small">Valfritt: bilder som visar stil, material eller något du vill ha med.</span>';
  renderResults();
}

$('#ed-sel-body').addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest<HTMLElement>('[data-sel]')?.dataset.sel;
  if (a === 'delete') ed.deleteSelected();
  else if (a === 'up') ed.reorder(1);
  else if (a === 'down') ed.reorder(-1);
});
$('#ed-sel-body').addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.sel === 'opacity') ed.updateSelected({ opacity: Number(el.value) } as Partial<Item>);
});
$('#ed-undo').addEventListener('click', () => ed.undo());
$('#ed-redo').addEventListener('click', () => ed.redo());
$('#ed-clear').addEventListener('click', () => ed.clearDrawings());
$('#ed-zoom-in').addEventListener('click', () => ed.zoomAt(1.25));
$('#ed-zoom-out').addEventListener('click', () => ed.zoomAt(0.8));
$('#ed-zoom-fit').addEventListener('click', () => ed.fit());

window.addEventListener('keydown', (e) => {
  if ($('#editor-screen').hidden || document.querySelector('dialog[open]')) return;
  if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') {
    e.preventDefault();
    if (e.shiftKey) ed.redo();
    else ed.undo();
  } else if ((e.ctrlKey || e.metaKey) && k === 'y') {
    e.preventDefault();
    ed.redo();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    ed.deleteSelected();
  } else if (e.key === 'Escape') ed.select(null);
  else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    const t = TOOLS.find((x) => x.key === k);
    if (t) {
      ed.setTool(t.id);
      renderEditorPanels();
    }
  }
});

// Lägga in bilder i skissen
async function addImageToSketch(src: Bild | File) {
  let b: Bild | undefined = src instanceof File ? undefined : src;
  if (src instanceof File) {
    b = (await addFiles([src], ''))?.[0];
    if (!b) return;
  }
  await ensureLoaded([b!.id]);
  const box = placeInside(ed.sketch, { w: b!.width, h: b!.height }, 0.45);
  ed.addItem({ kind: 'image', id: newId(), src: b!.id, ...box, opacity: 1 });
  ed.setTool('select');
  renderEditorPanels();
}

// ---------- Välj bild ur biblioteket ----------
const picker = $<HTMLDialogElement>('#picker-dialog');
let pickCb: ((b: Bild | File) => void) | null = null;
function pickImage(title: string, cb: (b: Bild | File) => void) {
  pickCb = cb;
  $('#picker-title').textContent = title;
  const list = [...images].sort((a, b) => b.created - a.created);
  $('#picker-grid').innerHTML = list.length
    ? list.map((b) => `<figure class="photo" data-id="${b.id}"><div class="photo-img"><img src="${thumbUrl(b)}" alt="" loading="lazy" /></div><figcaption>${esc(b.name)}</figcaption></figure>`).join('')
    : '<p class="muted">Biblioteket är tomt – välj en bild från datorn.</p>';
  picker.showModal();
}
$('#picker-grid').addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>('.photo')?.dataset.id;
  const b = byId(id);
  if (!b) return;
  picker.close();
  pickCb?.(b);
});
const oneFile = $<HTMLInputElement>('#one-file-input');
$('#picker-file').addEventListener('click', () => oneFile.click());
oneFile.addEventListener('change', () => {
  const f = oneFile.files?.[0];
  oneFile.value = '';
  if (!f) return;
  picker.close();
  pickCb?.(f);
});

$('#ed-add-image').addEventListener('click', () => pickImage('Lägg in en bild i skissen', (b) => void addImageToSketch(b).catch(fail('Kunde inte lägga in bilden'))));
$('#ai-add-ref').addEventListener('click', () =>
  pickImage('Välj referensbild', async (src) => {
    const b = src instanceof File ? (await addFiles([src], 'Inspiration'))?.[0] : src;
    if (b && !refs.includes(b.id)) refs.push(b.id);
    renderEditorPanels();
    saveDraft();
  }),
);
$('#ai-refs').addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>('[data-unref]')?.dataset.unref;
  if (!id) return;
  refs = refs.filter((r) => r !== id);
  renderEditorPanels();
  saveDraft();
});

// Spara / ladda ner skissen
$('#ed-save').addEventListener('click', async () => {
  try {
    const blob = await canvasToBlob(ed.render('all', 3000), 'image/jpeg', 0.9);
    const base = byId(ed.sketch.baseId);
    const b = await addImage(blob, {
      name: `${sketchName || 'Skiss'} (skiss)`,
      album: base?.album ?? (currentAlbum === ALL ? '' : currentAlbum),
      source: 'skiss',
      parentId: base?.id,
      sketch: structuredClone(ed.sketch),
    });
    images.push(b);
    notify('Skissen är sparad i biblioteket. Du kan öppna den igen och fortsätta rita.');
  } catch (err) {
    fail('Kunde inte spara')(err);
  }
});
$('#ed-download').addEventListener('click', async () => {
  try {
    await download(await canvasToBlob(ed.render('all', 4000), 'image/png'), `${safeFilename(sketchName, 'skiss')}.png`);
  } catch (err) {
    fail('Kunde inte ladda ner')(err);
  }
});

// ================== AI ==================
const EXAMPLES = [
  'Bygg en inglasad veranda där jag har ritat',
  'Lägg till en altan i trä med räcke',
  'Måla huset faluröd med vita knutar',
  'Byt taket till svart plåttak',
  'Gör om trädgården med gräsmatta, rabatter och en grusgång',
  'Visa hur det blir med större fönster här',
];
$('#ai-examples').innerHTML = EXAMPLES.map((x) => `<button class="chip" type="button">${esc(x)}</button>`).join('');
$('#ai-examples').addEventListener('click', (e) => {
  const chip = (e.target as HTMLElement).closest<HTMLElement>('.chip');
  if (!chip) return;
  const ta = $<HTMLTextAreaElement>('#ai-wish');
  ta.value = ta.value.trim() ? `${ta.value.trim()}. ${chip.textContent}` : chip.textContent!;
  ta.focus();
  saveDraft();
});
document.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-open-settings]')) openSettings();
});

/** Bilderna som skickas till AI. */
async function aiInputs() {
  const isEdit = !!ed.base;
  const sendSketch = isEdit && ed.hasDrawings && $<HTMLInputElement>('#ai-send-sketch').checked;
  const image = await canvasToBlob(ed.render(isEdit ? 'clean' : 'all'), 'image/jpeg', 0.92);
  const sketch = sendSketch ? await canvasToBlob(ed.render('all'), 'image/jpeg', 0.92) : undefined;
  const mask = sendSketch && ed.hasMarks ? await canvasToBlob(ed.render('mask'), 'image/png') : undefined;
  const references: Blob[] = [];
  for (const id of refs) {
    const b = byId(id);
    if (b) references.push(await canvasToBlob(await scaledCanvas(b.blob, 1024), 'image/jpeg', 0.9));
  }
  return { image, sketch, mask, references, marked: sendSketch && ed.hasMarks, fromScratch: !isEdit };
}
async function scaledCanvas(blob: Blob, max: number) {
  const img = await loadBitmap(blob);
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

let running: AbortController | null = null;
const statusEl = $('#ai-status');
function setStatus(html: string, kind: '' | 'busy' | 'error' | 'ok' = '') {
  statusEl.innerHTML = html;
  statusEl.className = `ai-status ${kind}`;
}

/** Bilden som AI-förslagen hör till (originalet, eller en sparad version av skissen). */
async function baseForResults(): Promise<Bild | undefined> {
  const base = byId(ed.sketch.baseId);
  if (base) return base;
  // Ny skiss eller kombination: spara skissen så att förslagen har något att jämföras med
  const blob = await canvasToBlob(ed.render('all', 3000), 'image/jpeg', 0.9);
  const b = await addImage(blob, { name: sketchName || 'Skiss', album: currentAlbum === ALL ? '' : currentAlbum, source: 'skiss', sketch: structuredClone(ed.sketch) });
  images.push(b);
  ed.sketch.baseId = b.id;
  saveDraft();
  return b;
}

$('#ai-go').addEventListener('click', async () => {
  if (running) {
    running.abort();
    return;
  }
  const wish = $<HTMLTextAreaElement>('#ai-wish').value.trim();
  if (!wish) {
    setStatus('Skriv först vad du vill att AI ska göra.', 'error');
    $<HTMLTextAreaElement>('#ai-wish').focus();
    return;
  }
  const st = loadSettings();
  if (!hasKey(st)) {
    setStatus('Lägg först in en AI-nyckel – eller använd <b>Gör det själv i ChatGPT eller Gemini</b> nedan.', 'error');
    openSettings();
    return;
  }
  const count = Number($<HTMLSelectElement>('#ai-count').value) || 1;
  const goBtn = $<HTMLButtonElement>('#ai-go');
  running = new AbortController();
  const signal = running.signal;
  goBtn.textContent = 'Avbryt';
  const started = Date.now();
  const tick = window.setInterval(() => {
    const s = Math.round((Date.now() - started) / 1000);
    setStatus(`<span class="spinner"></span> AI arbetar med ${count === 1 ? 'bilden' : `${count} förslag`}… ${s} s <span class="muted">(tar oftast 15–60 sekunder)</span>`, 'busy');
  }, 500);
  try {
    const input = await aiInputs();
    const base = await baseForResults();
    const results = await Promise.allSettled(Array.from({ length: count }, () => editImage(st, { wish, ...input }, signal)));
    const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof editImage>>> => r.status === 'fulfilled');
    let n = 0;
    for (const r of ok) {
      n++;
      const b = await addImage(r.value.image, {
        name: `${base?.name ?? sketchName} – AI ${new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}${ok.length > 1 ? ` (${n})` : ''}`,
        album: base?.album ?? '',
        source: 'ai',
        parentId: base?.id,
        prompt: wish,
      });
      images.push(b);
    }
    const firstErr = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')?.reason as AiError | undefined;
    if (ok.length) {
      setStatus(`Klart! ${ok.length === 1 ? 'Förslaget' : `${ok.length} förslag`} finns nedan och är sparade i biblioteket.${firstErr ? ` (${results.length - ok.length} misslyckades.)` : ''}`, 'ok');
    } else if (firstErr) throw firstErr;
    renderEditorPanels();
  } catch (err) {
    if (signal.aborted) setStatus('Avbrutet.', '');
    else {
      const e = err as AiError;
      setStatus(esc(e.message || String(e)) + (e.kind === 'key' ? ' <button class="link-btn" data-open-settings>Öppna AI-inställningar</button>' : ''), 'error');
    }
  } finally {
    window.clearInterval(tick);
    running = null;
    goBtn.disabled = false;
    renderEditorPanels();
  }
});

function renderResults() {
  const baseId = ed.sketch.baseId;
  const list = baseId ? images.filter((b) => b.parentId === baseId && b.source === 'ai').sort((a, b) => b.created - a.created) : [];
  $('#ai-results').innerHTML = list.length
    ? list
        .map(
          (b) => `<div class="result" data-id="${b.id}">
        <img src="${thumbUrl(b)}" alt="" data-r="compare" title="Klicka för att jämföra före och efter" />
        ${b.prompt ? `<div class="small result-prompt">”${esc(b.prompt)}”</div>` : ''}
        <div class="btn-row">
          <button data-r="compare">Jämför</button>
          <button data-r="continue" title="Skissa vidare på det här förslaget">Fortsätt på denna</button>
          <button data-r="download" title="Ladda ner">⤓</button>
        </div>
      </div>`,
        )
        .join('')
    : `<p class="muted small">Här hamnar AI:s förslag. De sparas också i biblioteket, i samma album som bilden.</p>`;
}
$('#ai-results').addEventListener('click', async (e) => {
  const t = e.target as HTMLElement;
  const r = t.closest<HTMLElement>('[data-r]')?.dataset.r;
  const b = byId(t.closest<HTMLElement>('.result')?.dataset.id);
  if (!r || !b) return;
  if (r === 'compare') openCompare(byId(b.parentId)!, b);
  else if (r === 'continue') {
    $<HTMLTextAreaElement>('#ai-wish').value = '';
    await openImageInEditor(b.id);
    notify('Nu skissar du på förslaget. Beskriv vad som ska ändras mer.');
  } else if (r === 'download') await download(b.blob, `${safeFilename(b.name, 'bild')}.${ext(b.blob)}`).catch(fail('Kunde inte ladda ner'));
});

// ---------- Jämför före / efter ----------
const cmp = $<HTMLDialogElement>('#compare-dialog');
function openCompare(before: Bild | undefined, after: Bild) {
  if (!before) return notify('Originalbilden finns inte kvar.');
  $<HTMLImageElement>('#cmp-before').src = fullUrl(before);
  $<HTMLImageElement>('#cmp-after').src = fullUrl(after);
  $('#cmp-view').style.aspectRatio = `${after.width} / ${after.height}`;
  $<HTMLInputElement>('#cmp-range').value = '50';
  setCmp(50);
  cmp.showModal();
}
function setCmp(v: number) {
  $('#cmp-before-wrap').style.clipPath = `inset(0 ${100 - v}% 0 0)`;
  $('#cmp-line').style.left = `${v}%`;
}
$('#cmp-range').addEventListener('input', (e) => setCmp(Number((e.target as HTMLInputElement).value)));
$('#cmp-close').addEventListener('click', () => cmp.close());
const cmpView = $('#cmp-view');
const cmpPointer = (e: PointerEvent) => {
  const r = cmpView.getBoundingClientRect();
  const v = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
  $<HTMLInputElement>('#cmp-range').value = String(v);
  setCmp(v);
};
cmpView.addEventListener('pointerdown', (e) => {
  cmpView.setPointerCapture(e.pointerId);
  cmpPointer(e);
});
cmpView.addEventListener('pointermove', (e) => {
  if (cmpView.hasPointerCapture(e.pointerId)) cmpPointer(e);
});

// ---------- Inställningar ----------
const setDlg = $<HTMLDialogElement>('#settings-dialog');
let draftSettings = loadSettings();
function openSettings() {
  draftSettings = loadSettings();
  renderSettings();
  $('#set-status').textContent = '';
  setDlg.showModal();
}
function renderSettings() {
  const p = draftSettings.provider;
  $('#provider-pick').innerHTML = (Object.keys(PROVIDERS) as Provider[])
    .map((k) => `<button type="button" data-provider="${k}" class="${k === p ? 'on' : ''}">${esc(PROVIDERS[k].name)}${k === 'gemini' ? ' <span class="muted small">(rekommenderas)</span>' : ''}</button>`)
    .join('');
  $('#provider-help').innerHTML = `${esc(PROVIDERS[p].keyHelp)} <a href="${PROVIDERS[p].keyUrl}" target="_blank" rel="noopener">Skaffa nyckel hos ${esc(PROVIDERS[p].name)} ↗</a>`;
  $<HTMLInputElement>('#set-key').value = draftSettings.keys[p] ?? '';
  const sel = $<HTMLSelectElement>('#set-model');
  const m = draftSettings.models[p] ?? '';
  if (m && ![...sel.options].some((o) => o.value === m)) sel.insertAdjacentHTML('beforeend', `<option>${esc(m)}</option>`);
  sel.value = m;
}
$('#btn-settings').addEventListener('click', openSettings);
$('#provider-pick').addEventListener('click', (e) => {
  const k = (e.target as HTMLElement).closest<HTMLElement>('[data-provider]')?.dataset.provider as Provider | undefined;
  if (!k) return;
  draftSettings.keys[draftSettings.provider] = $<HTMLInputElement>('#set-key').value.trim();
  draftSettings.provider = k;
  $<HTMLSelectElement>('#set-model').innerHTML = '<option value="">Automatiskt (den senaste)</option>';
  $('#set-status').textContent = '';
  renderSettings();
});
$('#set-test').addEventListener('click', async () => {
  const key = $<HTMLInputElement>('#set-key').value.trim();
  const st = $('#set-status');
  if (!key) return void (st.textContent = 'Klistra in nyckeln först.');
  st.textContent = 'Testar…';
  try {
    const models = await listModels(draftSettings.provider, key);
    const sel = $<HTMLSelectElement>('#set-model');
    const cur = sel.value;
    sel.innerHTML = `<option value="">Automatiskt (${esc(models[0] ?? PROVIDERS[draftSettings.provider].fallbackModel)})</option>` + models.map((m) => `<option>${esc(m)}</option>`).join('');
    sel.value = cur;
    st.textContent = models.length ? `✓ Nyckeln fungerar. ${models.length} bildmodeller hittades.` : '✓ Nyckeln fungerar, men inga bildmodeller hittades i listan – standardmodellen används.';
  } catch (err) {
    st.textContent = `✗ ${(err as Error).message}`;
  }
});
$('#set-clear').addEventListener('click', () => {
  $<HTMLInputElement>('#set-key').value = '';
  $('#set-status').textContent = 'Nyckeln tas bort när du trycker Spara.';
});
setDlg.addEventListener('close', () => {
  if (setDlg.returnValue !== 'ok') return;
  const p = draftSettings.provider;
  draftSettings.keys[p] = $<HTMLInputElement>('#set-key').value.trim();
  draftSettings.models[p] = $<HTMLSelectElement>('#set-model').value;
  saveSettings(draftSettings);
  renderEditorPanels();
  notify(hasKey(draftSettings) ? `Sparat. AI-bilder görs med ${esc(PROVIDERS[p].name)}.` : 'Sparat.');
});

// ---------- Gör det själv i ChatGPT / Gemini ----------
const manDlg = $<HTMLDialogElement>('#manual-dialog');
let manualFiles: { blob: Blob; name: string }[] = [];
let manualText = '';
$('#ai-manual').addEventListener('click', async () => {
  const wish = $<HTMLTextAreaElement>('#ai-wish').value.trim() || '(skriv här vad du vill ha)';
  try {
    const input = await aiInputs();
    manualFiles = [
      { blob: input.image, name: `1-${input.fromScratch ? 'skiss' : 'bild'}.jpg` },
      ...(input.sketch ? [{ blob: input.sketch, name: '2-skiss.jpg' }] : []),
      ...input.references.map((r, i) => ({ blob: r, name: `${(input.sketch ? 3 : 2) + i}-referens.jpg` })),
    ];
    manualText = buildPrompt({ wish, marked: input.marked, fromScratch: input.fromScratch, hasSketch: !!input.sketch, refCount: input.references.length });
    $('#man-files').textContent = `${manualFiles.length} ${manualFiles.length === 1 ? 'bild' : 'bilder'}: ${manualFiles.map((f) => f.name).join(', ')}`;
    $('#man-prompt').textContent = manualText;
    $('#man-copied').textContent = '';
    manDlg.showModal();
  } catch (err) {
    fail('Det gick inte')(err);
  }
});
$('#man-download').addEventListener('click', async () => {
  try {
    for (const f of manualFiles) await download(f.blob, f.name);
  } catch (err) {
    fail('Kunde inte spara')(err);
  }
});
$('#man-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(manualText);
    $('#man-copied').textContent = '✓ Kopierad – klistra in med Ctrl+V.';
  } catch {
    $('#man-copied').textContent = 'Kunde inte kopiera automatiskt – öppna "Visa texten" och kopiera den.';
    (manDlg.querySelector('details') as HTMLDetailsElement).open = true;
  }
});
$('#man-result').addEventListener('click', () => {
  oneFile.onchange = null;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const base = await baseForResults();
      const b = await addImage(f, { name: `${base?.name ?? sketchName} – AI`, album: base?.album ?? '', source: 'ai', parentId: base?.id, prompt: $<HTMLTextAreaElement>('#ai-wish').value.trim() || undefined });
      images.push(b);
      manDlg.close();
      renderEditorPanels();
      notify('Bilden är sparad som förslag i biblioteket.');
    } catch (err) {
      fail('Kunde inte lägga in bilden')(err);
    }
  };
  input.click();
});

// ---------- Claude hjälper till att formulera (bara i Claude-versionen) ----------
async function setupClaude() {
  if (!inArtifact()) return;
  const sample = await (window as any).claude.use('sample').catch(() => null);
  if (!sample) return;
  const btn = $<HTMLButtonElement>('#ai-claude');
  btn.hidden = false;
  btn.addEventListener('click', async () => {
    const ta = $<HTMLTextAreaElement>('#ai-wish');
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = 'Claude tänker…';
    try {
      let imgs: Blob[] = [];
      try {
        const lim = await sample.limits?.();
        if (lim?.images) imgs = [await canvasToBlob(ed.render('all', 1024), 'image/jpeg', 0.85)];
      } catch {
        /* utan bild */
      }
      const res = await sample(
        `Du hjälper en husägare att beskriva en ändring av en bild på sitt hus, sina rum eller sin trädgård, så att en bild-AI förstår exakt vad som ska göras.` +
          (imgs.length ? ' Bilden visar fotot med husägarens skiss ovanpå (rosa område = där ändringen ska ske).' : '') +
          `\n\nHusägarens önskan: """${ta.value.trim() || '(inget skrivet ännu – föreslå något rimligt utifrån skissen)'}"""\n\n` +
          'Skriv om önskan till en tydlig instruktion på svenska, 2–4 meningar: vad som ska läggas till eller ändras, var i bilden, material, färger, ungefärlig storlek och stil som passar huset. Svara bara med instruktionen, utan rubrik eller citattecken.',
        { images: imgs.length ? imgs : undefined, modelTier: 'quick', cache: false },
      );
      if (res?.text) {
        ta.value = res.text.trim();
        saveDraft();
      }
    } catch (err) {
      if ((err as any)?.code !== 'not_granted') notify(`Claude kunde inte svara: ${esc((err as Error).message ?? '')}`);
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  });
}

// ---------- Länkar till de andra verktygen ----------
for (const [id, tool] of [
  ['#link-planritaren', 'planritaren'],
  ['#link-tomt', 'tomtplaneraren'],
  ['#link-bygg', 'byggplaneraren'],
  ['#link-hem', 'hemprojekt'],
] as const) {
  const a = $<HTMLAnchorElement>(id);
  if (inArtifact()) {
    a.href = ARTIFACT_LINKS[tool];
    a.target = '_blank';
    a.rel = 'noopener';
  } else a.target = tool;
}

/**
 * Bilder som ett annat verktyg skickar hit: { album?: string, images: [{ name, src }] },
 * där src är en data-URL eller en adress som går att hämta.
 */
async function receiveImages(payload: any, fromName: string) {
  const list: { name?: string; src?: string }[] = Array.isArray(payload?.images) ? payload.images : [];
  const album = typeof payload?.album === 'string' ? payload.album.trim() : '';
  if (album && !albums.includes(album)) {
    albums.push(album);
    await setMeta('album', albums);
  }
  const added: Bild[] = [];
  for (const it of list) {
    if (typeof it?.src !== 'string') continue;
    if (!/^(data:image\/|https:\/\/|\.\/|blob:)/.test(it.src)) continue;
    try {
      const blob = await (await fetch(it.src)).blob();
      added.push(await addImage(blob, { name: String(it.name || 'Bild').slice(0, 120), album, source: 'uppladdad' }));
    } catch {
      /* hoppa över bilder som inte går att läsa */
    }
  }
  if (!added.length) return;
  currentAlbum = album || ALL;
  selected = new Set(added.map((b) => b.id));
  await reload();
  notify(`${added.length === 1 ? 'En bild' : `${added.length} bilder`} kom från ${esc(fromName)}${album ? ` till albumet ${esc(album)}` : ''}.`);
}

// ---------- Start ----------
window.addEventListener('storage', (e) => {
  if (e.key === 'bildbiblioteket.changed' && !$('#library-screen').hidden) void reload();
});
window.addEventListener('focus', () => {
  if (!$('#library-screen').hidden) void reload();
});

(async () => {
  try {
    await reload();
    const d = await getMeta('utkast');
    $('#btn-draft').hidden = !d;
    // ?album=<namn> öppnar ett album, ?bild=<id> markerar en bild (används av Hemprojekt)
    const album = takeParam('album');
    if (album !== null) {
      if (album && !albums.includes(album)) {
        albums.push(album);
        await setMeta('album', albums);
      }
      currentAlbum = album;
    }
    const open = takeParam('bild');
    if (open && byId(open)) {
      selected = new Set([open]);
      if (currentAlbum !== ALL && byId(open)!.album !== currentAlbum) currentAlbum = ALL;
    }
    renderLibrary();
    receiveHandoff('bildbiblioteket', (payload, fromName) => void receiveImages(payload, fromName));
  } catch (err) {
    fail('Bildbiblioteket kunde inte starta')(err);
  }
  void setupClaude();
})();
