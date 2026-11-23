import {
  buyQty,
  CATEGORIES,
  dateSv,
  dec,
  kr,
  materialCost,
  num,
  orderedTasks,
  PHASES,
  quoteText,
  quoteTrades,
  schedule,
  shoppingGroups,
  shoppingText,
  taskDays,
  totals,
  TRADES,
  UNITS,
  wallArea,
  type GroupBy,
} from './calc';
import { roomsFromPlan, planritarenPlans, type PlanRooms, type ProjectStore } from './store';
import { applyTemplate, CHECKLIST_TEMPLATES, newChecklist, newMaterial, newTask, TEMPLATES } from './templates';
import type { Material, Project, Task } from './types';
import { uid } from '../geometry';

export type View = 'overview' | 'rooms' | 'tasks' | 'materials' | 'schedule' | 'quotes' | 'shopping' | 'checklists';

export const VIEWS: { id: View; label: string; icon: string }[] = [
  { id: 'overview', label: 'Översikt', icon: '◎' },
  { id: 'tasks', label: 'Moment', icon: '☰' },
  { id: 'materials', label: 'Material', icon: '▤' },
  { id: 'rooms', label: 'Rum & ytor', icon: '▢' },
  { id: 'schedule', label: 'Tidsplan', icon: '▬' },
  { id: 'quotes', label: 'Offertförfrågningar', icon: '✉' },
  { id: 'shopping', label: 'Inköpslistor', icon: '🛒' },
  { id: 'checklists', label: 'Checklistor', icon: '☑' },
];

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const opts = (list: string[], sel: string) =>
  (list.includes(sel) || !sel ? list : [sel, ...list]).map((v) => `<option${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');

/** Gränssnittets tillstånd som inte sparas i projektet. */
export interface UIState {
  view: View;
  quoteTrade: string;
  shopBy: GroupBy;
  shopRemaining: boolean;
  matFilter: string;
  openTasks: Set<string>;
  tplId: string;
  tplRoom: string;
  importPlans: PlanRooms[] | null;
}

export class ProjectUI {
  state: UIState = {
    view: 'overview',
    quoteTrade: '',
    shopBy: 'store',
    shopRemaining: false,
    matFilter: '',
    openTasks: new Set(),
    tplId: TEMPLATES[0].id,
    tplRoom: '',
    importPlans: null,
  };

  constructor(
    private store: ProjectStore,
    private main: HTMLElement,
    private nav: HTMLElement,
    private onNotify: (msg: string) => void,
    private actions: { copy: (text: string) => void; downloadText: (text: string, filename: string) => void; downloadCSV: () => void; openPlanFile: () => void },
  ) {
    try {
      const v = sessionStorage.getItem('byggplaneraren.view') as View | null;
      if (v && VIEWS.some((x) => x.id === v)) this.state.view = v;
    } catch {
      /* ignorera */
    }
    store.subscribe(() => this.render());
    main.addEventListener('input', (e) => this.onInput(e, false));
    main.addEventListener('change', (e) => this.onInput(e, true));
    main.addEventListener('click', (e) => this.onClick(e));
    nav.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-view]');
      if (b) this.go(b.dataset.view as View);
    });
  }

  get p(): Project {
    return this.store.project;
  }

  go(view: View) {
    this.state.view = view;
    try {
      sessionStorage.setItem('byggplaneraren.view', view);
    } catch {
      /* ignorera */
    }
    this.render();
    this.main.scrollTop = 0;
  }

  // ---------- Rendering ----------

  render() {
    const p = this.p;
    const t = totals(p);
    const counts: Partial<Record<View, string>> = {
      tasks: String(p.tasks.length),
      materials: String(p.materials.length),
      rooms: String(p.rooms.length),
      quotes: String(quoteTrades(p).length),
      shopping: String(p.materials.filter((m) => m.buyer === 'self' && !m.bought).length),
      checklists: String(p.checklists.length),
    };
    this.nav.innerHTML = VIEWS.map(
      (v) =>
        `<button class="nav-btn${v.id === this.state.view ? ' active' : ''}" data-view="${v.id}"><span class="nav-icon" aria-hidden="true">${v.icon}</span><span class="nav-label">${v.label}</span>${counts[v.id] ? `<span class="badge">${counts[v.id]}</span>` : ''}</button>`,
    ).join('');
    const scroll = this.main.scrollTop;
    const html = {
      overview: () => this.overview(t),
      rooms: () => this.rooms(),
      tasks: () => this.tasks(),
      materials: () => this.materials(),
      schedule: () => this.schedule(),
      quotes: () => this.quotes(),
      shopping: () => this.shopping(),
      checklists: () => this.checklists(),
    }[this.state.view]();
    this.main.innerHTML = html;
    this.refreshCalcs();
    this.main.scrollTop = scroll;
  }

  /** Uppdaterar uträknade värden utan att rita om (så att fokus i fälten behålls). */
  refreshCalcs() {
    const p = this.p;
    const t = totals(p);
    const mats = new Map(p.materials.map((m) => [m.id, m]));
    const sched = schedule(p);
    this.main.querySelectorAll<HTMLElement>('[data-calc]').forEach((el) => {
      const [kind, id] = el.dataset.calc!.split(':');
      let v = '';
      if (kind === 'buy') {
        const m = mats.get(id);
        v = m ? `${dec(buyQty(m))} ${m.unit}` : '';
      } else if (kind === 'sum') {
        const m = mats.get(id);
        v = m ? kr(materialCost(m)) : '';
      } else if (kind === 'taskmat') {
        v = kr(p.materials.filter((m) => m.taskId === id).reduce((s, m) => s + materialCost(m), 0));
      } else if (kind === 'taskdays') {
        const task = p.tasks.find((x) => x.id === id);
        v = task ? daysLabel(taskDays(task, p.hoursPerDay)) : '';
      } else if (kind === 'taskhours') {
        const task = p.tasks.find((x) => x.id === id);
        v = task ? `${dec(num(task.hours))} h` : '';
      } else if (kind === 'wall') {
        const r = p.rooms.find((x) => x.id === id);
        v = r ? `${dec(wallArea(r))} m²` : '';
      } else if (kind === 'tot') {
        v = totalLabel(id, t, sched.end, sched.workdays);
      } else if (kind === 'matsum') {
        v = kr(this.filteredMaterials().reduce((s, m) => s + materialCost(m), 0));
      }
      el.textContent = v;
    });
  }

  private card(label: string, calc: string, sub = '') {
    return `<div class="card stat-card"><div class="muted small">${label}</div><div class="big" data-calc="tot:${calc}"></div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>`;
  }

  overview(t: ReturnType<typeof totals>) {
    const p = this.p;
    const pct = t.tasks ? Math.round((t.tasksDone / t.tasks) * 100) : 0;
    const byPhase = PHASES.map((ph) => {
      const ts = p.tasks.filter((x) => x.phase === ph);
      const ids = new Set(ts.map((x) => x.id));
      return {
        ph,
        n: ts.length,
        hours: ts.reduce((s, x) => s + num(x.hours), 0),
        labor: ts.reduce((s, x) => s + (x.who === 'contractor' ? num(x.laborCost) : 0), 0),
        mat: p.materials.filter((m) => m.taskId && ids.has(m.taskId)).reduce((s, m) => s + materialCost(m), 0),
      };
    }).filter((x) => x.n);
    const loose = p.materials.filter((m) => !m.taskId || !p.tasks.some((x) => x.id === m.taskId));
    const html = `
      <h1>Översikt</h1>
      <div class="cards">
        ${this.card('Total kostnad (efter ROT)', 'total', 'material + arbete − ROT')}
        ${this.card('Material', 'materials')}
        ${this.card('Arbete hantverkare', 'labor')}
        ${this.card('ROT-avdrag', 'rot', `${dec(num(p.rotPct), 0)} % av arbetskostnaden`)}
        ${this.card('Arbetstid', 'hours')}
        ${this.card('Klart ungefär', 'end')}
      </div>
      <div class="progress-row">
        <div class="progress"><div style="width:${pct}%"></div></div>
        <span class="muted small">${t.tasksDone} av ${t.tasks} moment klara</span>
      </div>

      <div class="grid2">
        <section class="card">
          <h2>Projektet</h2>
          ${field('Namn', `<input type="text" data-bind="project::name" value="${esc(p.name)}" />`)}
          ${field('Adress', `<input type="text" data-bind="project::address" value="${esc(p.address)}" placeholder="Gata, ort" />`)}
          ${field('Startdatum', `<input type="date" data-bind="project::startDate" value="${esc(p.startDate)}" />`)}
          ${field('Arbetstimmar per dag', `<input type="number" min="1" max="24" step="0.5" data-bind="project::hoursPerDay" value="${p.hoursPerDay}" />`)}
          ${field('ROT-avdrag %', `<input type="number" min="0" max="100" step="1" data-bind="project::rotPct" value="${p.rotPct}" />`, 'ROT är normalt 30 % av arbetskostnaden, högst 50 000 kr per person och år. Sätt 0 om det inte gäller.')}
          ${field('Anteckningar', `<textarea rows="4" data-bind="project::notes">${esc(p.notes)}</textarea>`)}
        </section>
        <section class="card">
          <h2>Kontaktuppgifter</h2>
          <p class="muted small">Används som avsändare i offertförfrågningarna.</p>
          ${field('Namn', `<input type="text" data-bind="contact::name" value="${esc(p.contact.name)}" />`)}
          ${field('Telefon', `<input type="tel" data-bind="contact::phone" value="${esc(p.contact.phone)}" />`)}
          ${field('E-post', `<input type="email" data-bind="contact::email" value="${esc(p.contact.email)}" />`)}
          <h2 class="mt">Kostnad per fas</h2>
          ${
            byPhase.length
              ? `<table class="tbl compact"><thead><tr><th>Fas</th><th class="num">Timmar</th><th class="num">Arbete</th><th class="num">Material</th></tr></thead><tbody>
              ${byPhase.map((x) => `<tr><td>${esc(x.ph)}</td><td class="num">${dec(x.hours)}</td><td class="num">${kr(x.labor)}</td><td class="num">${kr(x.mat)}</td></tr>`).join('')}
              ${loose.length ? `<tr><td class="muted">Material utan moment</td><td></td><td></td><td class="num">${kr(loose.reduce((s, m) => s + materialCost(m), 0))}</td></tr>` : ''}
              </tbody></table>`
              : `<p class="muted">Inga moment ännu. Gå till <button class="linkish" data-go="tasks">Moment</button> och lägg till ett från en mall.</p>`
          }
        </section>
      </div>

      <section class="card">
        <h2>Så använder du Byggplaneraren</h2>
        <ol class="howto">
          <li><b>Rum &amp; ytor</b> – lägg in rummen (eller hämta dem från en plan i Planritaren) så kan mängder räknas ut automatiskt.</li>
          <li><b>Moment</b> – lägg till arbeten, gärna från en mall (badrum, golv, målning, kök …). Ange om du gör det själv eller anlitar hantverkare.</li>
          <li><b>Material</b> – justera mängder och priser. Spill räknas in i det du behöver köpa.</li>
          <li><b>Offertförfrågningar</b> – färdiga texter per hantverkare som du kan kopiera och skicka.</li>
          <li><b>Inköpslistor</b> och <b>Checklistor</b> – bocka av medan du jobbar.</li>
        </ol>
        <p class="muted small">Allt sparas automatiskt i den här webbläsaren. Använd "Spara fil" för att ha en säkerhetskopia eller flytta projektet till en annan dator.</p>
      </section>

      <section class="card danger-zone">
        <h2>Ta bort projektet</h2>
        <p class="muted small">Tar bort "${esc(p.name)}" från den här webbläsaren. Spara en fil först om du vill kunna öppna det igen.</p>
        <button class="danger" data-del="project:${p.id}">Ta bort projektet</button>
      </section>`;
    return html;
  }

  rooms() {
    const p = this.p;
    const plans = this.state.importPlans;
    return `
      <h1>Rum &amp; ytor</h1>
      <p class="muted">Rummens mått används när du lägger till moment från en mall, och skrivs med i offertförfrågningarna. Väggytan räknas som omkrets × takhöjd minus ca 10 % för dörrar och fönster.</p>
      <div class="table-wrap card flush">
        <table class="tbl">
          <thead><tr><th>Rum</th><th class="num">Golvyta m²</th><th class="num">Omkrets m</th><th class="num">Takhöjd m</th><th class="num">Väggyta</th><th></th></tr></thead>
          <tbody>
            ${p.rooms
              .map(
                (r) => `<tr>
              <td><input type="text" data-bind="room:${r.id}:name" value="${esc(r.name)}" aria-label="Rummets namn" /></td>
              <td class="num"><input class="n" type="number" min="0" step="0.1" data-bind="room:${r.id}:area" value="${r.area}" aria-label="Golvyta" /></td>
              <td class="num"><input class="n" type="number" min="0" step="0.1" data-bind="room:${r.id}:perimeter" value="${r.perimeter}" aria-label="Omkrets" /></td>
              <td class="num"><input class="n" type="number" min="0" step="0.05" data-bind="room:${r.id}:height" value="${r.height}" aria-label="Takhöjd" /></td>
              <td class="num" data-calc="wall:${r.id}"></td>
              <td><button class="icon-btn" data-del="room:${r.id}" title="Ta bort rummet">✕</button></td>
            </tr>`,
              )
              .join('')}
            ${p.rooms.length ? '' : '<tr><td colspan="6" class="muted">Inga rum ännu.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="btn-row">
        <button class="primary" data-act="add-room">+ Lägg till rum</button>
        <button data-act="import-plans">Hämta rum från Planritaren</button>
        <button data-act="open-plan-file">Öppna planfil från Planritaren…</button>
      </div>
      ${
        plans
          ? `<section class="card">
          <h2>Planer i Planritaren</h2>
          ${
            plans.length
              ? plans
                  .map(
                    (pl, i) => `<div class="import-plan">
                <div><b>${esc(pl.planName)}</b><div class="muted small">${pl.rooms.map((r) => `${esc(r.name)} ${dec(r.area)} m²`).join(' · ')}</div></div>
                <button data-act="import-plan" data-index="${i}">Hämta ${pl.rooms.length} rum</button>
              </div>`,
                  )
                  .join('')
              : `<p class="muted">Hittade inga planer med rum i den här webbläsaren. Om Planritaren är öppen någon annanstans: välj <b>Spara fil</b> där och sedan <b>Öppna planfil från Planritaren…</b> här.</p>`
          }
        </section>`
          : ''
      }`;
  }

  tasks() {
    const p = this.p;
    const tpl = TEMPLATES.find((t) => t.id === this.state.tplId) ?? TEMPLATES[0];
    const roomSel = this.state.tplRoom;
    const groups = PHASES.map((ph) => ({ ph, ts: p.tasks.filter((t) => t.phase === ph) }));
    const other = p.tasks.filter((t) => !PHASES.includes(t.phase));
    if (other.length) groups.push({ ph: 'Övrigt', ts: other });
    return `
      <h1>Moment</h1>
      <section class="card template-box">
        <h2>Lägg till från mall</h2>
        <div class="tpl-row">
          <label class="field inline"><span>Mall</span><select data-ui="tplId">${TEMPLATES.map((t) => `<option value="${t.id}"${t.id === tpl.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
          <label class="field inline"><span>Rum</span><select data-ui="tplRoom">
            <option value="">Ange mått själv</option>
            ${p.rooms.map((r) => `<option value="${r.id}"${r.id === roomSel ? ' selected' : ''}>${esc(r.name)} (${dec(r.area)} m²)</option>`).join('')}
          </select></label>
          ${
            roomSel && p.rooms.some((r) => r.id === roomSel)
              ? ''
              : `<label class="field inline"><span>Golvyta m²</span><input class="n" type="number" min="0" step="0.1" id="tpl-area" value="10" /></label>
                 <label class="field inline"><span>${tpl.id === 'wall' ? 'Väggens längd m' : 'Omkrets m'}</span><input class="n" type="number" min="0" step="0.1" id="tpl-per" value="${tpl.id === 'wall' ? 3 : 13}" /></label>
                 <label class="field inline"><span>Takhöjd m</span><input class="n" type="number" min="0" step="0.05" id="tpl-h" value="2.4" /></label>`
          }
          <button class="primary" data-act="apply-template">Lägg till</button>
        </div>
        <p class="muted small">${esc(tpl.description)} Mängder räknas ut från måtten och priserna är ungefärliga – justera dem efter dina val.</p>
      </section>
      <div class="btn-row"><button data-act="add-task">+ Nytt tomt moment</button>
        <button data-act="toggle-all">${this.state.openTasks.size ? 'Fäll ihop alla' : 'Visa detaljer för alla'}</button></div>
      ${groups
        .filter((g) => g.ts.length)
        .map((g) => `<h2 class="phase-h">${esc(g.ph)}</h2>${g.ts.map((t) => this.taskCard(t)).join('')}`)
        .join('')}
      ${p.tasks.length ? '' : '<p class="muted">Inga moment ännu. Börja med en mall ovan eller lägg till ett tomt moment.</p>'}`;
  }

  taskCard(t: Task) {
    const p = this.p;
    const open = this.state.openTasks.has(t.id);
    const mats = p.materials.filter((m) => m.taskId === t.id);
    return `<article class="task card ${t.status}${open ? ' open' : ''}">
      <div class="task-head">
        <select class="status-sel" data-bind="task:${t.id}:status" aria-label="Status" title="Status">
          <option value="todo"${t.status === 'todo' ? ' selected' : ''}>Att göra</option>
          <option value="doing"${t.status === 'doing' ? ' selected' : ''}>Pågår</option>
          <option value="done"${t.status === 'done' ? ' selected' : ''}>Klart</option>
        </select>
        <input class="task-name" type="text" data-bind="task:${t.id}:name" value="${esc(t.name)}" aria-label="Momentets namn" />
        <span class="pill ${t.who}">${t.who === 'self' ? 'Själv' : esc(t.trade)}</span>
        <span class="muted small nowrap"><span data-calc="taskhours:${t.id}"></span> · <span data-calc="taskdays:${t.id}"></span> · <span data-calc="taskmat:${t.id}"></span></span>
        <button class="icon-btn" data-act="toggle-task" data-id="${t.id}" aria-expanded="${open}" title="${open ? 'Dölj detaljer' : 'Visa detaljer'}">${open ? '▴' : '▾'}</button>
      </div>
      ${
        open
          ? `<div class="task-body">
        <div class="task-fields">
          ${field('Fas', `<select data-bind="task:${t.id}:phase">${opts(PHASES, t.phase)}</select>`)}
          ${field('Vem gör det', `<select data-bind="task:${t.id}:who"><option value="self"${t.who === 'self' ? ' selected' : ''}>Jag själv</option><option value="contractor"${t.who === 'contractor' ? ' selected' : ''}>Hantverkare</option></select>`)}
          ${field('Yrke', `<select data-bind="task:${t.id}:trade">${opts(TRADES, t.trade)}</select>`)}
          ${field('Timmar totalt', `<input class="n" type="number" min="0" step="0.5" data-bind="task:${t.id}:hours" value="${t.hours}" />`)}
          ${field('Antal personer', `<input class="n" type="number" min="1" step="1" data-bind="task:${t.id}:people" value="${t.people}" />`)}
          ${t.who === 'contractor' ? field('Arbetskostnad kr', `<input class="n" type="number" min="0" step="100" data-bind="task:${t.id}:laborCost" value="${t.laborCost}" />`) : ''}
        </div>
        ${field('Beskrivning', `<textarea rows="2" data-bind="task:${t.id}:description" placeholder="Vad ska göras? Skrivs med i offertförfrågan.">${esc(t.description)}</textarea>`)}
        ${
          p.rooms.length
            ? `<div class="field"><span>Rum</span><div class="chips">${p.rooms
                .map((r) => `<label class="chip"><input type="checkbox" data-bind="taskroom:${t.id}:${r.id}"${t.roomIds.includes(r.id) ? ' checked' : ''} /> ${esc(r.name)}</label>`)
                .join('')}</div></div>`
            : ''
        }
        <h3>Material för momentet</h3>
        ${mats.length ? this.materialTable(mats, false) : '<p class="muted small">Inget material ännu.</p>'}
        <div class="btn-row">
          <button data-act="add-mat" data-task="${t.id}">+ Material</button>
          <span class="spacer"></span>
          <button data-act="dup-task" data-id="${t.id}">Duplicera</button>
          <button class="danger" data-del="task:${t.id}">Ta bort moment</button>
        </div>
      </div>`
          : ''
      }
    </article>`;
  }

  materialTable(mats: Material[], showTask: boolean) {
    const p = this.p;
    const stores = [...new Set(p.materials.map((m) => m.store.trim()).filter(Boolean))];
    return `<div class="table-wrap"><table class="tbl mat">
      <thead><tr>
        <th>Material</th>${showTask ? '<th>Moment</th>' : ''}<th class="num">Mängd</th><th>Enhet</th><th class="num">Spill %</th><th class="num">Att köpa</th><th class="num">Pris/enhet</th><th class="num">Summa</th><th>Kategori</th><th>Butik</th><th>Köps av</th><th title="Köpt">Köpt</th><th></th>
      </tr></thead>
      <tbody>${mats
        .map(
          (m) => `<tr class="${m.bought ? 'bought' : ''}">
        <td><input type="text" class="wide" data-bind="mat:${m.id}:name" value="${esc(m.name)}" aria-label="Material" /></td>
        ${showTask ? `<td><select data-bind="mat:${m.id}:taskId"><option value="">–</option>${orderedTasks(p.tasks).map((t) => `<option value="${t.id}"${t.id === m.taskId ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></td>` : ''}
        <td class="num"><input class="n" type="number" min="0" step="any" data-bind="mat:${m.id}:qty" value="${m.qty}" aria-label="Mängd" /></td>
        <td><select data-bind="mat:${m.id}:unit" aria-label="Enhet">${opts(UNITS, m.unit)}</select></td>
        <td class="num"><input class="n s" type="number" min="0" step="1" data-bind="mat:${m.id}:waste" value="${m.waste}" aria-label="Spill i procent" /></td>
        <td class="num nowrap" data-calc="buy:${m.id}"></td>
        <td class="num"><input class="n" type="number" min="0" step="any" data-bind="mat:${m.id}:price" value="${m.price}" aria-label="Pris per enhet" /></td>
        <td class="num nowrap" data-calc="sum:${m.id}"></td>
        <td><select data-bind="mat:${m.id}:category" aria-label="Kategori">${opts(CATEGORIES, m.category)}</select></td>
        <td><input type="text" list="stores" data-bind="mat:${m.id}:store" value="${esc(m.store)}" placeholder="t.ex. Bauhaus" aria-label="Butik" /></td>
        <td><select data-bind="mat:${m.id}:buyer" aria-label="Köps av"><option value="self"${m.buyer === 'self' ? ' selected' : ''}>Jag</option><option value="contractor"${m.buyer === 'contractor' ? ' selected' : ''}>Hantverkaren</option></select></td>
        <td class="center"><input type="checkbox" data-bind="mat:${m.id}:bought"${m.bought ? ' checked' : ''} aria-label="Köpt" /></td>
        <td><button class="icon-btn" data-del="mat:${m.id}" title="Ta bort">✕</button></td>
      </tr>`,
        )
        .join('')}</tbody>
    </table></div>
    <datalist id="stores">${[...new Set([...stores, 'Bauhaus', 'Byggmax', 'Hornbach', 'Beijer', 'K-Rauta', 'Jula', 'Clas Ohlson', 'IKEA', 'Elgiganten', 'Bygghemma', 'Kakelspecialisten'])].map((s) => `<option value="${esc(s)}">`).join('')}</datalist>`;
  }

  filteredMaterials() {
    const f = this.state.matFilter.trim().toLowerCase();
    return this.p.materials.filter((m) => !f || `${m.name} ${m.category} ${m.store} ${m.note}`.toLowerCase().includes(f));
  }

  materials() {
    const p = this.p;
    const list = this.filteredMaterials();
    const t = totals(p);
    return `
      <h1>Material</h1>
      <div class="toolbar">
        <input type="search" data-ui="matFilter" value="${esc(this.state.matFilter)}" placeholder="Sök material, kategori eller butik…" aria-label="Sök material" />
        <button class="primary" data-act="add-mat">+ Material</button>
        <button data-act="csv">Ladda ner för Excel</button>
      </div>
      <p class="muted small">"Att köpa" är mängden plus spill, avrundat uppåt. Ändra "Köps av" till Hantverkaren för material som ska ingå i deras offert.</p>
      ${list.length ? `<div class="card flush">${this.materialTable(list, true)}</div>` : '<p class="muted">Inget material ännu.</p>'}
      <div class="sum-row">
        <span>Visat: <b data-calc="matsum:"></b></span>
        <span>Jag köper: <b>${kr(t.materialsSelf)}</b></span>
        <span>Hantverkare köper: <b>${kr(t.materialsContractor)}</b></span>
        <span>Totalt: <b data-calc="tot:materials"></b></span>
      </div>`;
  }

  schedule() {
    const p = this.p;
    const s = schedule(p);
    const total = Math.max(1, s.workdays);
    return `
      <h1>Tidsplan</h1>
      <p class="muted">En enkel plan där momenten görs efter varandra i fasordning, måndag–fredag, ${dec(num(p.hoursPerDay))} timmar per dag. Antal dagar = timmar ÷ (personer × timmar per dag). ${p.startDate ? '' : '<b>Ange ett startdatum under Översikt</b> för att få datum.'}</p>
      ${
        s.rows.length
          ? `<div class="card flush table-wrap"><table class="tbl gantt">
        <thead><tr><th>Moment</th><th>Vem</th><th class="num">Dagar</th><th>Start</th><th>Klart</th><th class="bar-col">Tid</th></tr></thead>
        <tbody>${s.rows
          .map(
            (r) => `<tr class="${r.task.status}">
          <td>${esc(r.task.name)}<div class="muted small">${esc(r.task.phase)}</div></td>
          <td><span class="pill ${r.task.who}">${r.task.who === 'self' ? 'Själv' : esc(r.task.trade)}</span></td>
          <td class="num">${r.days}</td>
          <td class="nowrap">${dateSv(r.start)}</td>
          <td class="nowrap">${dateSv(r.end)}</td>
          <td class="bar-col"><div class="bar-track"><div class="bar ${r.task.who}" style="left:${(r.offset / total) * 100}%;width:${Math.max(0.8, (r.days / total) * 100)}%"></div></div></td>
        </tr>`,
          )
          .join('')}</tbody>
        <tfoot><tr><td colspan="2">Totalt</td><td class="num">${s.workdays}</td><td>${dateSv(s.rows.find((r) => r.start)?.start ?? null)}</td><td>${dateSv(s.end)}</td><td></td></tr></tfoot>
      </table></div>
      <p class="muted small">Tips: om flera hantverkare kan jobba samtidigt blir det i verkligheten ofta kortare. Lägg också in väntetider, t.ex. torktid för tätskikt, som egna moment.</p>`
          : '<p class="muted">Inga moment ännu.</p>'
      }`;
  }

  quotes() {
    const p = this.p;
    const trades = quoteTrades(p);
    if (!trades.length)
      return `<h1>Offertförfrågningar</h1><p class="muted">Inga moment är markerade för hantverkare ännu. Öppna ett moment under <button class="linkish" data-go="tasks">Moment</button> och välj "Vem gör det: Hantverkare" – då skapas en offertförfrågan per yrke här.</p>`;
    if (!trades.includes(this.state.quoteTrade)) this.state.quoteTrade = trades[0];
    const trade = this.state.quoteTrade;
    const n = p.tasks.filter((t) => t.who === 'contractor' && t.trade === trade).length;
    const missing = !p.contact.name && !p.contact.phone && !p.contact.email;
    return `
      <h1>Offertförfrågningar</h1>
      <p class="muted">En färdig text per yrke, byggd från dina moment, rum och material. Du kan ändra i texten innan du kopierar den. Skicka gärna till minst tre företag.</p>
      <div class="tabs">${trades.map((tr) => `<button class="tab${tr === trade ? ' active' : ''}" data-act="quote-trade" data-trade="${esc(tr)}">${esc(tr)}</button>`).join('')}</div>
      ${missing ? `<p class="notice">Fyll i dina kontaktuppgifter under <button class="linkish" data-go="overview">Översikt</button> så kommer de med i texten.</p>` : ''}
      <section class="card">
        <div class="muted small">${n} moment för ${esc(trade.toLowerCase())}</div>
        <textarea id="quote-text" class="quote" rows="24" spellcheck="true">${esc(quoteText(p, trade))}</textarea>
        <div class="btn-row">
          <button class="primary" data-act="copy-quote">Kopiera text</button>
          <button data-act="mail-quote">Öppna i e-post</button>
          <button data-act="dl-quote">Ladda ner som textfil</button>
          <button data-act="reset-quote">Återställ texten</button>
        </div>
      </section>`;
  }

  shopping() {
    const p = this.p;
    const groups = shoppingGroups(p, this.state.shopBy);
    let total = 0;
    let left = 0;
    const body = groups
      .map((g) => {
        const items = g.items.filter((m) => !this.state.shopRemaining || !m.bought);
        if (!items.length) return '';
        const sum = items.reduce((s, m) => s + materialCost(m), 0);
        return `<section class="card shop-group"><h2>${esc(g.name)} <span class="muted small">${kr(sum)}</span></h2>
          <ul class="shop">${items
            .map((m) => {
              const c = materialCost(m);
              total += c;
              if (!m.bought) left += c;
              return `<li class="${m.bought ? 'bought' : ''}"><label><input type="checkbox" data-bind="mat:${m.id}:bought"${m.bought ? ' checked' : ''} />
              <span class="qty">${dec(buyQty(m))} ${esc(m.unit)}</span><span class="name">${esc(m.name)}${m.note ? ` <span class="muted small">– ${esc(m.note)}</span>` : ''}</span></label>
              <span class="num muted">${m.price ? kr(c) : ''}</span></li>`;
            })
            .join('')}</ul></section>`;
      })
      .join('');
    return `
      <h1>Inköpslistor</h1>
      <p class="muted">Det material du köper själv, inklusive spill. Bocka av när du har handlat. Ange butik under <button class="linkish" data-go="materials">Material</button> för att dela upp listan per butik.</p>
      <div class="toolbar">
        <label class="field inline"><span>Gruppera efter</span><select data-ui="shopBy">
          <option value="store"${this.state.shopBy === 'store' ? ' selected' : ''}>Butik</option>
          <option value="category"${this.state.shopBy === 'category' ? ' selected' : ''}>Kategori</option>
          <option value="task"${this.state.shopBy === 'task' ? ' selected' : ''}>Moment</option>
        </select></label>
        <label class="row-check"><input type="checkbox" data-ui="shopRemaining"${this.state.shopRemaining ? ' checked' : ''} /> Visa bara det som inte är köpt</label>
        <span class="spacer"></span>
        <button class="primary" data-act="copy-shop">Kopiera som text</button>
        <button data-act="dl-shop">Ladda ner som textfil</button>
      </div>
      ${body || '<p class="muted">Inget att köpa här.</p>'}
      ${body ? `<div class="sum-row"><span>Kvar att köpa: <b>${kr(left)}</b></span><span>Totalt i listan: <b>${kr(total)}</b></span></div>` : ''}`;
  }

  checklists() {
    const p = this.p;
    return `
      <h1>Checklistor</h1>
      <div class="toolbar">
        <label class="field inline"><span>Lägg till</span><select id="cl-template">
          ${CHECKLIST_TEMPLATES.map((c, i) => `<option value="${i}">${esc(c.title)}</option>`).join('')}
          <option value="tasks">Alla moment i ordning</option>
          <option value="empty">Tom checklista</option>
        </select></label>
        <button class="primary" data-act="add-checklist">Lägg till</button>
      </div>
      ${p.checklists
        .map((c) => {
          const done = c.items.filter((i) => i.done).length;
          return `<section class="card checklist">
          <div class="cl-head">
            <input class="cl-title" type="text" data-bind="checklist:${c.id}:title" value="${esc(c.title)}" aria-label="Checklistans namn" />
            <span class="muted small nowrap">${done} av ${c.items.length}</span>
            <button data-act="copy-checklist" data-id="${c.id}">Kopiera</button>
            <button class="icon-btn" data-del="checklist:${c.id}" title="Ta bort checklistan">✕</button>
          </div>
          <ul class="checks">${c.items
            .map(
              (i) => `<li class="${i.done ? 'done' : ''}"><input type="checkbox" data-bind="checkitem:${c.id}/${i.id}:done"${i.done ? ' checked' : ''} aria-label="Klar" />
            <input type="text" data-bind="checkitem:${c.id}/${i.id}:text" value="${esc(i.text)}" aria-label="Punkt" />
            <button class="icon-btn" data-del="checkitem:${c.id}/${i.id}" title="Ta bort punkten">✕</button></li>`,
            )
            .join('')}</ul>
          <button class="small-btn" data-act="add-checkitem" data-id="${c.id}">+ Punkt</button>
        </section>`;
        })
        .join('')}
      ${p.checklists.length ? '' : '<p class="muted">Inga checklistor ännu. Välj en färdig lista ovan.</p>'}`;
  }

  // ---------- Händelser ----------

  private onInput(e: Event, committed: boolean) {
    const el = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const ui = el.dataset.ui;
    if (ui) {
      if (ui === 'matFilter') {
        if (committed) return;
        this.state.matFilter = el.value;
        this.render();
        const input = this.main.querySelector<HTMLInputElement>('[data-ui="matFilter"]');
        input?.focus();
        input?.setSelectionRange(el.value.length, el.value.length);
        return;
      }
      if (!committed) return;
      if (ui === 'shopRemaining') this.state.shopRemaining = (el as HTMLInputElement).checked;
      else (this.state as any)[ui] = el.value;
      this.render();
      return;
    }
    const bind = el.dataset.bind;
    if (!bind) return;
    const isCheck = el instanceof HTMLInputElement && el.type === 'checkbox';
    const isText = !isCheck && !(el instanceof HTMLSelectElement);
    // Textfält uppdateras medan man skriver; val och kryssrutor när de ändras.
    if (isText && committed) {
      this.store.changed(false);
      this.refreshCalcs();
      return;
    }
    if (!isText && !committed) return;
    const [kind, id, key] = bind.split(':');
    const p = this.p;
    const value: any = isCheck ? (el as HTMLInputElement).checked : el instanceof HTMLInputElement && el.type === 'number' ? num(el.value) : el.value;
    let structural = !isText;
    if (kind === 'project') {
      (p as any)[key] = value;
      if (key === 'name') document.dispatchEvent(new CustomEvent('project-renamed'));
    } else if (kind === 'contact') (p.contact as any)[key] = value;
    else if (kind === 'room') {
      const r = p.rooms.find((x) => x.id === id);
      if (r) (r as any)[key] = value;
    } else if (kind === 'task') {
      const t = p.tasks.find((x) => x.id === id);
      if (t) (t as any)[key] = value;
      if (key === 'who' && t && value === 'contractor' && t.trade === 'Övrigt') t.trade = 'Snickare';
    } else if (kind === 'taskroom') {
      const t = p.tasks.find((x) => x.id === id);
      if (t) t.roomIds = value ? [...new Set([...t.roomIds, key])] : t.roomIds.filter((r) => r !== key);
      structural = false;
    } else if (kind === 'mat') {
      const m = p.materials.find((x) => x.id === id);
      if (m) (m as any)[key] = key === 'taskId' ? value || null : value;
      if (key === 'bought') {
        el.closest('tr, li')?.classList.toggle('bought', !!value);
        structural = this.state.view === 'shopping' || this.state.view === 'overview';
      }
    } else if (kind === 'checklist') {
      const c = p.checklists.find((x) => x.id === id);
      if (c) (c as any)[key] = value;
    } else if (kind === 'checkitem') {
      const [cid, iid] = id.split('/');
      const item = p.checklists.find((x) => x.id === cid)?.items.find((x) => x.id === iid);
      if (item) (item as any)[key] = value;
    }
    if (structural) this.store.changed();
    else {
      this.store.changed(false);
      this.refreshCalcs();
    }
  }

  private onClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const go = target.closest<HTMLElement>('[data-go]');
    if (go) return this.go(go.dataset.go as View);

    const del = target.closest<HTMLElement>('[data-del]');
    if (del) {
      if (!del.classList.contains('confirm')) {
        del.classList.add('confirm');
        del.dataset.label = del.textContent ?? '';
        del.textContent = del.classList.contains('icon-btn') ? 'Säker?' : 'Klicka igen för att ta bort';
        setTimeout(() => {
          if (del.isConnected) {
            del.classList.remove('confirm');
            del.textContent = del.dataset.label ?? '✕';
          }
        }, 3000);
        return;
      }
      this.remove(del.dataset.del!);
      return;
    }

    const btn = target.closest<HTMLElement>('[data-act]');
    if (!btn) return;
    const p = this.p;
    switch (btn.dataset.act) {
      case 'add-room':
        p.rooms.push({ id: uid('room'), name: `Rum ${p.rooms.length + 1}`, area: 10, perimeter: 13, height: 2.4 });
        this.store.changed();
        break;
      case 'import-plans':
        this.state.importPlans = planritarenPlans();
        this.render();
        break;
      case 'import-plan': {
        const pl = this.state.importPlans?.[num(btn.dataset.index)];
        if (pl) this.addPlanRooms(pl);
        break;
      }
      case 'open-plan-file':
        this.actions.openPlanFile();
        break;
      case 'apply-template': {
        const tpl = TEMPLATES.find((t) => t.id === this.state.tplId) ?? TEMPLATES[0];
        const room = p.rooms.find((r) => r.id === this.state.tplRoom) ?? null;
        const val = (id: string, fb: number) => num(this.main.querySelector<HTMLInputElement>(`#${id}`)?.value, fb);
        const dims = room ?? { area: val('tpl-area', 10), perimeter: val('tpl-per', 13), height: val('tpl-h', 2.4) };
        const { tasks, materials } = applyTemplate(tpl, dims, room);
        p.tasks.push(...tasks);
        p.materials.push(...materials);
        this.onNotify(`La till ${tasks.length} moment och ${materials.length} material från "${tpl.name}".`);
        this.store.changed();
        break;
      }
      case 'add-task': {
        const t = newTask();
        p.tasks.push(t);
        this.state.openTasks.add(t.id);
        this.store.changed();
        this.main.querySelector<HTMLInputElement>(`[data-bind="task:${t.id}:name"]`)?.select();
        break;
      }
      case 'dup-task': {
        const src = p.tasks.find((t) => t.id === btn.dataset.id);
        if (!src) break;
        const copy = { ...structuredClone(src), id: uid('t'), name: `${src.name} (kopia)`, status: 'todo' as const };
        p.tasks.splice(p.tasks.indexOf(src) + 1, 0, copy);
        for (const m of p.materials.filter((m) => m.taskId === src.id)) p.materials.push({ ...m, id: uid('m'), taskId: copy.id, bought: false });
        this.state.openTasks.add(copy.id);
        this.store.changed();
        break;
      }
      case 'toggle-task': {
        const id = btn.dataset.id!;
        if (this.state.openTasks.has(id)) this.state.openTasks.delete(id);
        else this.state.openTasks.add(id);
        this.render();
        break;
      }
      case 'toggle-all':
        this.state.openTasks = this.state.openTasks.size ? new Set() : new Set(p.tasks.map((t) => t.id));
        this.render();
        break;
      case 'add-mat': {
        const task = p.tasks.find((t) => t.id === btn.dataset.task);
        const m = newMaterial({ taskId: task?.id ?? null, buyer: task?.who === 'contractor' ? 'contractor' : 'self' });
        p.materials.push(m);
        this.state.matFilter = '';
        this.store.changed();
        this.main.querySelector<HTMLInputElement>(`[data-bind="mat:${m.id}:name"]`)?.select();
        break;
      }
      case 'csv':
        this.actions.downloadCSV();
        break;
      case 'quote-trade':
        this.state.quoteTrade = btn.dataset.trade!;
        this.render();
        break;
      case 'copy-quote':
        this.actions.copy(this.quoteArea());
        break;
      case 'dl-quote':
        this.actions.downloadText(this.quoteArea(), `Offertforfragan-${this.state.quoteTrade}`);
        break;
      case 'reset-quote':
        this.render();
        break;
      case 'mail-quote': {
        const text = this.quoteArea();
        const subject = `Offertförfrågan: ${p.name}`;
        const a = document.createElement('a');
        a.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
        a.target = '_blank';
        a.rel = 'noopener';
        a.click();
        break;
      }
      case 'copy-shop':
        this.actions.copy(shoppingText(p, this.state.shopBy, this.state.shopRemaining));
        break;
      case 'dl-shop':
        this.actions.downloadText(shoppingText(p, this.state.shopBy, this.state.shopRemaining), `Inkopslista-${p.name}`);
        break;
      case 'add-checklist': {
        const v = this.main.querySelector<HTMLSelectElement>('#cl-template')!.value;
        if (v === 'tasks') p.checklists.push(newChecklist(`Moment – ${p.name}`, orderedTasks(p.tasks).map((t) => t.name)));
        else if (v === 'empty') p.checklists.push(newChecklist('Ny checklista', ['']));
        else {
          const tpl = CHECKLIST_TEMPLATES[num(v)];
          p.checklists.push(newChecklist(tpl.title, tpl.items));
        }
        this.store.changed();
        break;
      }
      case 'add-checkitem': {
        const c = p.checklists.find((x) => x.id === btn.dataset.id);
        if (!c) break;
        const item = { id: uid('ci'), text: '', done: false };
        c.items.push(item);
        this.store.changed();
        this.main.querySelector<HTMLInputElement>(`[data-bind="checkitem:${c.id}/${item.id}:text"]`)?.focus();
        break;
      }
      case 'copy-checklist': {
        const c = p.checklists.find((x) => x.id === btn.dataset.id);
        if (c) this.actions.copy([c.title, '', ...c.items.map((i) => `[${i.done ? 'x' : ' '}] ${i.text}`)].join('\n'));
        break;
      }
    }
  }

  private quoteArea() {
    return this.main.querySelector<HTMLTextAreaElement>('#quote-text')?.value ?? '';
  }

  addPlanRooms(pl: PlanRooms) {
    const p = this.p;
    let added = 0;
    let updated = 0;
    for (const r of pl.rooms) {
      const existing = p.rooms.find((x) => x.name.toLowerCase() === r.name.toLowerCase());
      if (existing) {
        existing.area = r.area;
        existing.perimeter = r.perimeter;
        updated++;
      } else {
        p.rooms.push({ id: uid('room'), name: r.name, area: r.area, perimeter: r.perimeter, height: 2.4 });
        added++;
      }
    }
    this.state.importPlans = null;
    this.onNotify(`Hämtade rum från "${pl.planName}": ${added} nya${updated ? `, ${updated} uppdaterade` : ''}.`);
    this.store.changed();
  }

  importPlanFile(raw: unknown) {
    this.addPlanRooms(roomsFromPlan(raw));
    this.go('rooms');
  }

  private remove(ref: string) {
    const [kind, id] = ref.split(':');
    const p = this.p;
    if (kind === 'project') {
      this.store.deleteCurrent();
      return;
    }
    if (kind === 'room') {
      p.rooms = p.rooms.filter((r) => r.id !== id);
      p.tasks.forEach((t) => (t.roomIds = t.roomIds.filter((r) => r !== id)));
      if (this.state.tplRoom === id) this.state.tplRoom = '';
    } else if (kind === 'task') {
      p.tasks = p.tasks.filter((t) => t.id !== id);
      p.materials = p.materials.filter((m) => m.taskId !== id);
    } else if (kind === 'mat') p.materials = p.materials.filter((m) => m.id !== id);
    else if (kind === 'checklist') p.checklists = p.checklists.filter((c) => c.id !== id);
    else if (kind === 'checkitem') {
      const [cid, iid] = id.split('/');
      const c = p.checklists.find((x) => x.id === cid);
      if (c) c.items = c.items.filter((i) => i.id !== iid);
    }
    this.store.changed();
  }
}

function field(label: string, control: string, help = '') {
  return `<label class="field"><span>${label}</span>${control}${help ? `<small class="muted">${help}</small>` : ''}</label>`;
}

const daysLabel = (d: number) => (d === 1 ? '1 dag' : `${d} dagar`);

function totalLabel(key: string, t: ReturnType<typeof totals>, end: Date | null, workdays: number) {
  switch (key) {
    case 'total':
      return kr(t.total);
    case 'materials':
      return kr(t.materials);
    case 'labor':
      return kr(t.labor);
    case 'rot':
      return `−${kr(t.rot)}`;
    case 'hours':
      return `${dec(t.hours)} h`;
    case 'end':
      return end ? dateSv(end) : `${workdays} arbetsdagar`;
  }
  return '';
}
