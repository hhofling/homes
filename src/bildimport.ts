/** Dialogen "Ritning från bild": ladda upp en bild på en planritning och gör om den till en ritning. */
import type { Plan } from './types';
import { detectWalls, detectionToPlan, guessMmPerPx, type Detection, type Pixels } from './bildtolkning';
import { emptyPlan } from './store';
import { formatLength } from './geometry';

/** Bildens längsta sida vid tolkningen (pixlar). Större ger noggrannare men långsammare. */
const WORK_SIZE = 1400;
/** Bakgrundsbilden sparas lite mindre för att få plats i webbläsarens lagring. */
const BG_SIZE = 1600;

interface State {
  name: string;
  img: HTMLCanvasElement | null;
  px: Pixels | null;
  det: Detection | null;
  darkness: number;
  minThickness: number | null;
  mmPerPx: number;
  scaleSource: 'guess' | 'width' | 'measure';
  measure: { a: { x: number; y: number } | null; b: { x: number; y: number } | null; active: boolean };
}

export interface ImportCallbacks {
  /** Den nya planen ska läggas till och visas. show3d = öppna 3D-vyn direkt. */
  onCreate: (plan: Plan, show3d: boolean) => void;
  notify: (msg: string) => void;
}

export function setupImageImport(cb: ImportCallbacks) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog import-dialog';
  dlg.innerHTML = `
    <div class="import-head">
      <h2>Ritning från bild</h2>
      <button type="button" class="icon-btn" data-act="cancel" aria-label="Stäng">✕</button>
    </div>
    <div class="import-body">
      <div class="import-view">
        <div class="import-drop" data-drop>
          <p><strong>Välj en bild på en planritning</strong></p>
          <p class="muted small">Till exempel mäklarens planritning, en skärmbild eller en inskannad ritning (JPG eller PNG). Du kan också dra in bilden hit eller klistra in den med Ctrl+V.</p>
          <button type="button" class="primary" data-act="pick">Välj bild…</button>
        </div>
        <canvas class="import-canvas" hidden></canvas>
        <div class="import-measure-hint" hidden>Klicka på två punkter på bilden med ett känt avstånd, t.ex. en vägg där måttet står utskrivet.</div>
      </div>
      <div class="import-side" hidden>
        <section>
          <h3>1. Vad ska bilden bli?</h3>
          <label class="row"><input type="radio" name="imp-mode" value="auto" checked /> En ritning – väggar, dörrar, fönster och rum letas fram automatiskt</label>
          <label class="row"><input type="radio" name="imp-mode" value="trace" /> Bara en bakgrund att rita av för hand</label>
        </section>
        <section>
          <h3>2. Hur stort är huset?</h3>
          <label class="row">Husets bredd (vänster till höger)
            <span class="unit-input"><input type="number" data-in="width" min="1" max="200" step="0.01" /> m</span>
          </label>
          <button type="button" data-act="measure">Mät en sträcka på bilden…</button>
          <div class="measure-row" hidden>
            <label class="row">Sträckan är
              <span class="unit-input"><input type="number" data-in="measure" min="0.1" max="200" step="0.01" /> m</span>
            </label>
          </div>
          <p class="muted small" data-out="size"></p>
        </section>
        <section data-auto>
          <h3>3. Finjustera</h3>
          <p class="muted small">Blå linjer på bilden är väggarna som hittats. Saknas väggar eller blir det för många? Prova reglagen.</p>
          <label class="row col">Hur mörka väggarna är
            <input type="range" data-in="darkness" min="40" max="220" step="5" value="110" />
          </label>
          <label class="row col">Hur tjocka väggarna minst är
            <input type="range" data-in="thick" min="2" max="40" step="1" value="6" />
          </label>
          <label class="row"><input type="checkbox" data-in="openings" checked /> Dörrar och fönster</label>
          <label class="row"><input type="checkbox" data-in="rooms" checked /> Rum</label>
          <label class="row"><input type="checkbox" data-in="keepbg" checked /> Behåll bilden under ritningen</label>
          <p class="small" data-out="found"></p>
        </section>
        <div class="btn-row end">
          <button type="button" data-act="other">Annan bild</button>
          <button type="button" data-act="create3d">Skapa och visa i 3D</button>
          <button type="button" class="primary" data-act="create">Skapa ritning</button>
        </div>
      </div>
    </div>
    <input type="file" accept="image/*" hidden data-file />`;
  document.body.appendChild(dlg);

  const q = <T extends HTMLElement = HTMLElement>(sel: string) => dlg.querySelector(sel) as T;
  const canvas = q<HTMLCanvasElement>('.import-canvas');
  const ctx = canvas.getContext('2d')!;
  const side = q('.import-side');
  const drop = q('[data-drop]');
  const fileIn = q<HTMLInputElement>('[data-file]');
  const widthIn = q<HTMLInputElement>('[data-in="width"]');
  const measureIn = q<HTMLInputElement>('[data-in="measure"]');
  const darkIn = q<HTMLInputElement>('[data-in="darkness"]');
  const thickIn = q<HTMLInputElement>('[data-in="thick"]');
  const measureHint = q('.import-measure-hint');

  const st: State = {
    name: '',
    img: null,
    px: null,
    det: null,
    darkness: 110,
    minThickness: null,
    mmPerPx: 10,
    scaleSource: 'guess',
    measure: { a: null, b: null, active: false },
  };
  const mode = () => (dlg.querySelector<HTMLInputElement>('input[name="imp-mode"]:checked')?.value ?? 'auto') as 'auto' | 'trace';
  const checked = (k: string) => q<HTMLInputElement>(`[data-in="${k}"]`).checked;

  const reset = () => {
    st.img = st.px = st.det = null;
    st.minThickness = null;
    st.scaleSource = 'guess';
    st.measure = { a: null, b: null, active: false };
    canvas.hidden = true;
    side.hidden = true;
    drop.hidden = false;
    measureHint.hidden = true;
    q('.measure-row').hidden = true;
    measureIn.value = '';
  };

  // ----- Läs in bilden -----
  async function load(file: Blob, name: string) {
    if (!file.type.startsWith('image/')) {
      cb.notify('Det där var ingen bild. Välj en JPG- eller PNG-bild (en PDF kan du först spara som bild eller ta en skärmbild av).');
      return;
    }
    let bmp: ImageBitmap | HTMLImageElement;
    try {
      bmp = await loadImage(file);
    } catch {
      cb.notify('Kunde inte läsa bilden.');
      return;
    }
    const iw = bmp.width;
    const ih = bmp.height;
    const f = Math.min(1, WORK_SIZE / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * f));
    const h = Math.max(1, Math.round(ih * f));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, w, h);
    st.img = c;
    st.px = g.getImageData(0, 0, w, h);
    st.name = name.replace(/\.[a-z0-9]+$/i, '') || 'Plan från bild';
    st.minThickness = null;
    st.darkness = Number(darkIn.value);
    drop.hidden = true;
    canvas.hidden = false;
    side.hidden = false;
    runDetect(true);
  }

  function runDetect(first = false) {
    if (!st.px) return;
    st.det = detectWalls(st.px, { darkness: st.darkness, minThickness: st.minThickness ?? undefined });
    if (first) {
      thickIn.value = String(st.det.minThickness);
      if (st.scaleSource === 'guess') st.mmPerPx = guessMmPerPx(st.det);
    }
    updateScaleText();
    draw();
  }

  /** Husets bredd i pixlar (eller hela bildens om inga väggar hittats) */
  const housePx = () => {
    const b = st.det?.bounds;
    return b ? { w: b.maxX - b.minX, h: b.maxY - b.minY } : { w: st.px?.width ?? 1, h: st.px?.height ?? 1 };
  };

  function updateScaleText() {
    const hp = housePx();
    const wm = (hp.w * st.mmPerPx) / 1000;
    if (document.activeElement !== widthIn) widthIn.value = String(Math.round(wm * 100) / 100);
    const sizeOut = q('[data-out="size"]');
    sizeOut.textContent =
      `Huset blir ca ${formatLength(hp.w * st.mmPerPx)} × ${formatLength(hp.h * st.mmPerPx)}.` +
      (st.scaleSource === 'guess' ? ' Det är en gissning – skriv in ett riktigt mått om du vet något.' : '');
    const found = q('[data-out="found"]');
    if (mode() === 'auto' && st.det) {
      const r = detectionToPlan(st.det, { mmPerPx: st.mmPerPx, openings: checked('openings'), rooms: checked('rooms') }).plan;
      const n = (k: string) => r.openings.filter((o) => (k === 'window' ? o.kind === 'window' : o.kind !== 'window')).length;
      found.textContent = r.walls.length
        ? `Hittade ${r.walls.length} väggar, ${n('door')} dörrar/öppningar, ${n('window')} fönster och ${r.rooms.length} rum.`
        : 'Hittade inga väggar. Prova reglagen, eller välj "Bara en bakgrund" och rita av för hand.';
    } else found.textContent = '';
  }

  // ----- Förhandsvisning -----
  let viewScale = 1;
  function draw() {
    if (!st.img) return;
    const box = q('.import-view').getBoundingClientRect();
    const maxW = Math.max(200, box.width - 4);
    const maxH = Math.max(200, box.height - 4);
    viewScale = Math.min(maxW / st.img.width, maxH / st.img.height, 2);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(st.img.width * viewScale * dpr);
    canvas.height = Math.round(st.img.height * viewScale * dpr);
    canvas.style.width = `${Math.round(st.img.width * viewScale)}px`;
    canvas.style.height = `${Math.round(st.img.height * viewScale)}px`;
    const s = viewScale * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(st.img, 0, 0, canvas.width, canvas.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    if (mode() === 'auto' && st.det) {
      // Visa resultatet så som det blir: väggar, öppningar och rum
      const k = st.mmPerPx;
      const { plan, origin } = detectionToPlan(st.det, { mmPerPx: k, openings: checked('openings'), rooms: checked('rooms') });
      const toPx = (p: { x: number; y: number }) => ({ x: (p.x - origin.x) / k, y: (p.y - origin.y) / k });
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(0, 0, st.img.width, st.img.height);
      for (const r of plan.rooms) {
        ctx.beginPath();
        r.points.forEach((p, i) => {
          const v = toPx(p);
          if (i) ctx.lineTo(v.x, v.y);
          else ctx.moveTo(v.x, v.y);
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 196, 61, 0.25)';
        ctx.fill();
      }
      ctx.lineCap = 'square';
      for (const w of plan.walls) {
        const a = toPx(w.a);
        const b = toPx(w.b);
        ctx.strokeStyle = 'rgba(29, 111, 216, 0.85)';
        ctx.lineWidth = w.thickness / k;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (const o of plan.openings) {
        const w = plan.walls.find((x) => x.id === o.wallId)!;
        const a = toPx(w.a);
        const b = toPx(w.b);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const ux = (b.x - a.x) / len;
        const uy = (b.y - a.y) / len;
        const c = { x: a.x + (b.x - a.x) * o.t, y: a.y + (b.y - a.y) * o.t };
        const half = o.width / k / 2;
        ctx.strokeStyle = o.kind === 'window' ? '#22a6c9' : '#e8590c';
        ctx.lineWidth = (w.thickness / k) * 1.3;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.moveTo(c.x - ux * half, c.y - uy * half);
        ctx.lineTo(c.x + ux * half, c.y + uy * half);
        ctx.stroke();
        ctx.lineCap = 'square';
      }
    }
    // Mätlinje
    const m = st.measure;
    if (m.a) {
      ctx.strokeStyle = '#d6336c';
      ctx.fillStyle = '#d6336c';
      ctx.lineWidth = 2 / viewScale;
      for (const p of [m.a, m.b].filter(Boolean) as { x: number; y: number }[]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4 / viewScale, 0, Math.PI * 2);
        ctx.fill();
      }
      if (m.b) {
        ctx.beginPath();
        ctx.moveTo(m.a.x, m.a.y);
        ctx.lineTo(m.b.x, m.b.y);
        ctx.stroke();
      }
    }
  }

  // ----- Mät en sträcka -----
  canvas.addEventListener('click', (e) => {
    const m = st.measure;
    if (!m.active) return;
    const r = canvas.getBoundingClientRect();
    const p = { x: (e.clientX - r.left) / viewScale, y: (e.clientY - r.top) / viewScale };
    if (!m.a || m.b) {
      m.a = p;
      m.b = null;
    } else {
      m.b = p;
      m.active = false;
      canvas.classList.remove('measuring');
      measureHint.hidden = true;
      q('.measure-row').hidden = false;
      measureIn.focus();
    }
    draw();
  });
  const applyMeasure = () => {
    const m = st.measure;
    const v = Number(measureIn.value.replace(',', '.'));
    if (!m.a || !m.b || !(v > 0)) return;
    const d = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y);
    if (d < 3) return;
    st.mmPerPx = (v * 1000) / d;
    st.scaleSource = 'measure';
    updateScaleText();
    draw();
  };
  measureIn.addEventListener('input', applyMeasure);
  widthIn.addEventListener('input', () => {
    const v = Number(widthIn.value.replace(',', '.'));
    if (!(v > 0)) return;
    st.mmPerPx = (v * 1000) / housePx().w;
    st.scaleSource = 'width';
    updateScaleText();
    draw();
  });

  // ----- Reglage -----
  let timer = 0;
  const later = (fn: () => void) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(fn, 60);
  };
  darkIn.addEventListener('input', () => {
    st.darkness = Number(darkIn.value);
    later(() => runDetect());
  });
  thickIn.addEventListener('input', () => {
    st.minThickness = Number(thickIn.value);
    later(() => runDetect());
  });
  dlg.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'imp-mode') q('[data-auto]').hidden = mode() !== 'auto';
    if (t.name === 'imp-mode' || t.dataset.in === 'openings' || t.dataset.in === 'rooms') {
      updateScaleText();
      draw();
    }
  });

  // ----- Knappar -----
  dlg.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'cancel') dlg.close();
    else if (act === 'pick' || act === 'other') fileIn.click();
    else if (act === 'measure') {
      st.measure = { a: null, b: null, active: true };
      canvas.classList.add('measuring');
      measureHint.hidden = false;
      draw();
    } else if (act === 'create' || act === 'create3d') {
      const plan = create();
      if (!plan) return;
      dlg.close();
      cb.onCreate(plan, act === 'create3d');
    }
  });
  fileIn.addEventListener('change', () => {
    const f = fileIn.files?.[0];
    fileIn.value = '';
    if (f) void load(f, f.name);
  });
  // Dra och släpp, klistra in
  dlg.addEventListener('dragover', (e) => {
    e.preventDefault();
    dlg.classList.add('dragging');
  });
  dlg.addEventListener('dragleave', () => dlg.classList.remove('dragging'));
  dlg.addEventListener('drop', (e) => {
    e.preventDefault();
    dlg.classList.remove('dragging');
    const f = e.dataTransfer?.files?.[0];
    if (f) void load(f, f.name);
  });
  window.addEventListener('paste', (e) => {
    if (!dlg.open) return;
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    const f = item?.getAsFile();
    if (f) {
      e.preventDefault();
      void load(f, 'Inklistrad bild');
    }
  });
  window.addEventListener('resize', () => dlg.open && draw());

  function create(): Plan | null {
    if (!st.img || !st.det) return null;
    const k = st.mmPerPx;
    let plan: Plan;
    let origin = { x: 0, y: 0 };
    if (mode() === 'auto') {
      const r = detectionToPlan(st.det, { mmPerPx: k, name: st.name, openings: checked('openings'), rooms: checked('rooms') });
      plan = r.plan;
      origin = r.origin;
    } else {
      plan = emptyPlan(st.name);
    }
    if (mode() === 'trace' || checked('keepbg')) {
      plan.background = {
        src: toDataURL(st.img),
        x: Math.round(origin.x),
        y: Math.round(origin.y),
        w: Math.round(st.img.width * k),
        h: Math.round(st.img.height * k),
        opacity: mode() === 'trace' ? 0.6 : 0.35,
        visible: true,
      };
    }
    return plan;
  }

  return {
    open() {
      reset();
      q('[data-auto]').hidden = false;
      (dlg.querySelector('input[name="imp-mode"][value="auto"]') as HTMLInputElement).checked = true;
      dlg.showModal();
    },
  };
}

function loadImage(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = reject;
    img.src = url;
  });
}

/** Bakgrundsbilden som JPEG (litet nog för webbläsarens lagring). */
function toDataURL(src: HTMLCanvasElement): string {
  const f = Math.min(1, BG_SIZE / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * f);
  c.height = Math.round(src.height * f);
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}
