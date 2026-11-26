import { uid } from '../geometry';
import { ARTIFACT_LINKS, download, inArtifact, safeFilename, sendHandoff, TOOL_PAGES } from '../common';
import { ACTION_LABELS, floorArea, generateSteps, KINDS, kindOf, nextStep, PHASES, progress, roughEstimate, STATUS_LABELS } from './kinds';
import { emptyHomeProject, HomeStore, planProject } from './store';
import { copyPlan, estimateTotal, KEYS, projectBuild, projectSite, readLibrary, roomPlan, type Library } from './tools';
import { askAdvice, getSample, suggestSteps } from './ai';
import { dateSv, daysLeft, dec, esc, kr, num, shrinkImage } from './format';
import { totals } from '../projekt/calc';
import type { HomeProject, StepAction, WhoDoes } from './types';
import type { Plan } from '../types';
import type { Site } from '../tomt/types';
import type { Project } from '../projekt/types';

type Tab = 'overview' | 'steps' | 'ideas' | 'budget' | 'links';
const TABS: [Tab, string][] = [
  ['overview', 'Översikt'],
  ['steps', 'Steg för steg'],
  ['ideas', 'Idéer och önskemål'],
  ['budget', 'Budget'],
  ['links', 'Ritningar och kalkyler'],
];

type ToolId = 'planritaren' | 'tomtplaneraren' | 'byggplaneraren';

export class HemUI {
  tab: Tab = 'overview';
  /** Guiden för nytt projekt: null = stängd, '' = välj typ, annars vald typ */
  wizardKind: string | null = null;
  lib: Library = readLibrary();
  aiAvailable = false;
  private aiAbort: AbortController | null = null;
  private aiText = '';
  private aiBusy = false;
  /** Bilder i Bildbiblioteket per album (laddas när de behövs) */
  private album = new Map<string, { id: string; name: string; url: string }[] | 'loading'>();

  constructor(
    private store: HomeStore,
    private root: HTMLElement,
    private notify: (html: string, ms?: number) => void,
  ) {
    store.subscribe(() => this.render());
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('change', (e) => this.onChange(e));
    root.addEventListener('paste', (e) => this.onPaste(e as ClipboardEvent));
    root.addEventListener('dragover', (e) => {
      if ((e.target as HTMLElement).closest('.dropzone')) e.preventDefault();
    });
    root.addEventListener('drop', (e) => this.onDrop(e));
    void getSample().then((s) => {
      this.aiAvailable = !!s;
      if (s) this.render();
    });
  }

  /** Läs om det som finns i de andra verktygen (t.ex. när man kommer tillbaka till fliken). */
  refresh() {
    this.lib = readLibrary();
    this.clearAlbums();
    this.render();
  }

  get p() {
    return this.store.current;
  }

  private clearAlbums() {
    for (const v of this.album.values()) if (v !== 'loading') v.forEach((b) => URL.revokeObjectURL(b.url));
    this.album.clear();
  }

  /** Bilderna i projektets album i Bildbiblioteket (samma webbläsare). Laddas i bakgrunden. */
  private albumImages(name: string) {
    const cached = this.album.get(name);
    if (cached) return cached === 'loading' ? null : cached;
    this.album.set(name, 'loading');
    import('../bilder/db')
      .then((db) => db.allImages())
      .then((all) => {
        const list = all
          .filter((b) => b.album === name)
          .sort((a, b) => b.created - a.created)
          .map((b) => ({ id: b.id, name: b.name, url: URL.createObjectURL(b.thumb || b.blob) }));
        this.album.set(name, list);
        this.render();
      })
      .catch(() => this.album.set(name, []));
    return null;
  }

  private albumHTML(p: HomeProject, full: boolean) {
    const art = inArtifact();
    const list = art ? [] : this.albumImages(p.name);
    const withImages = p.ideas.filter((i) => i.image).length;
    let h = `<section class="box">
      <h2>Bildbiblioteket – albumet "${esc(p.name)}"</h2>
      <p class="small muted">I Bildbiblioteket kan du skissa på en bild (t.ex. ett foto av rummet eller en bild från 3D-vyn), kombinera bilder och be AI visa hur det kan bli.</p>`;
    if (art) h += `<p class="small muted">Här inne i Claude har Bildbiblioteket sin egen lagring. Öppna det och lägg bilderna i ett album som heter "${esc(p.name)}".</p>`;
    else if (list === null) h += `<p class="small muted">Hämtar bilder …</p>`;
    else if (list.length)
      h += `<div class="thumbs">${list
        .slice(0, full ? 60 : 8)
        .map((b) => `<button class="thumb" data-act="open-image" data-id="${esc(b.id)}" title="${esc(b.name)}"><img src="${esc(b.url)}" alt="${esc(b.name)}" /></button>`)
        .join('')}</div>${list.length > (full ? 60 : 8) ? `<p class="small muted">… och ${list.length - (full ? 60 : 8)} till</p>` : ''}`;
    else h += `<p class="small muted">Inga bilder i albumet ännu.</p>`;
    h += `<div class="toolbar"><button class="primary" data-act="action" data-action="bilder">Öppna albumet</button>${!art && withImages ? `<button data-act="send-images">Skicka idébilderna dit (${withImages})</button>` : ''}</div>
    </section>`;
    return h;
  }

  go(tab: Tab) {
    this.tab = tab;
    this.render();
    this.root.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  // ================= Rendering =================

  render() {
    const p = this.p;
    let html = '';
    if (this.store.saveError) html += `<div class="banner warn">${esc(this.store.saveError)}</div>`;
    if (this.wizardKind !== null) html += this.wizardHTML();
    else if (!p) html += this.homeHTML();
    else html += this.projectHTML(p);
    this.root.innerHTML = html;
    const ai = this.root.querySelector<HTMLElement>('#ai-answer');
    if (ai) ai.textContent = this.aiText;
  }

  // ---------- Startsidan ----------

  private homeHTML() {
    const list = [...this.store.projects].sort((a, b) => order(a) - order(b) || a.priority - b.priority || b.updatedAt - a.updatedAt);
    const active = list.filter((p) => p.status !== 'done');
    const budget = active.reduce((s, p) => s + p.budget, 0);
    const lib = this.lib;
    let h = `<section class="hero">
      <div>
        <h1>Mina hemprojekt</h1>
        <p>Samla mål, idéer, bilder och budget på ett ställe och få en plan steg för steg. Varje steg öppnar rätt verktyg – Planritaren, Tomtplaneraren, Byggplaneraren eller Bildbiblioteket – med rätt ritning, kalkyl eller bild.</p>
      </div>
      <button class="primary big" data-act="new">+ Nytt hemprojekt</button>
    </section>`;
    if (list.length) {
      h += `<div class="stats">
        <div><b>${active.length}</b><span>pågående och planerade</span></div>
        <div><b>${list.filter((p) => p.status === 'done').length}</b><span>klara</span></div>
        <div><b>${budget ? kr(budget) : '–'}</b><span>budget för pågående</span></div>
      </div>
      <div class="cards">${list.map((p) => this.cardHTML(p)).join('')}</div>`;
    } else {
      h += `<h2 class="section-title">Vad vill du göra?</h2>
      <div class="kinds">${KINDS.map((k) => kindCard(k)).join('')}</div>`;
    }
    h += `<h2 class="section-title">I dina verktyg</h2>
    <div class="tools">
      ${toolBox('planritaren', 'Planritaren', 'Planritningar, inredning och 3D', `${lib.plans.size} ritningar`)}
      ${toolBox('tomtplaneraren', 'Tomtplaneraren', 'Tomt, hus och trädgård i 3D', `${lib.sites.size} tomter`)}
      ${toolBox('byggplaneraren', 'Byggplaneraren', 'Moment, material, tid och kostnad', `${lib.builds.size} kalkyler`)}
      ${toolBox('bildbiblioteket', 'Bildbiblioteket', 'Bilder, skisser och AI-redigering', 'Ett album per projekt')}
    </div>
    ${inArtifact() ? `<p class="hint">Här inne i Claude har varje verktyg sin egen lagring. Det som ska till ett annat verktyg sparas som fil som du öppnar där. På webbsidan (hhofling.github.io/homes) hänger allt ihop automatiskt.</p>` : ''}`;
    return h;
  }

  private cardHTML(p: HomeProject) {
    const k = kindOf(p.kind);
    const next = nextStep(p);
    const pr = Math.round(progress(p) * 100);
    const { total: est, calc } = estimateTotal(p, this.lib);
    const over = p.budget && est > p.budget;
    const dl = p.deadline ? daysLeft(p.deadline) : null;
    return `<button class="card" data-act="open" data-id="${p.id}">
      <div class="card-top"><span class="icon">${k.icon}</span><span class="pill s-${p.status}">${STATUS_LABELS[p.status]}</span>${p.priority === 1 ? '<span class="pill prio">Viktigast</span>' : ''}</div>
      <h3>${esc(p.name)}</h3>
      <p class="muted">${esc(p.place || k.label)}${dl !== null && p.status !== 'done' ? ` · ${dl >= 0 ? `${dl} dagar kvar` : `${-dl} dagar sen`}` : ''}</p>
      <div class="bar"><span style="width:${pr}%"></span></div>
      <p class="small">${pr} % klart${next ? ` · Nästa: ${esc(next.title)}` : ''}</p>
      <p class="small ${over ? 'danger' : ''}">${p.budget ? `Budget ${kr(p.budget)}` : 'Ingen budget'}${est ? ` · ${calc.found ? 'Kalkyl' : 'Uppskattat'} ${kr(est)}` : ''}</p>
    </button>`;
  }

  // ---------- Guiden för nytt projekt ----------

  private wizardHTML() {
    if (!this.wizardKind) {
      return `<div class="wizard">
        <button class="link back" data-act="wiz-cancel">← Tillbaka</button>
        <h1>Nytt hemprojekt</h1>
        <p class="muted">Vad vill du göra? Välj det som passar bäst – allt går att ändra sen.</p>
        <div class="kinds">${KINDS.map((k) => kindCard(k)).join('')}</div>
      </div>`;
    }
    const k = kindOf(this.wizardKind);
    const showSize = k.id !== 'garden' && k.id !== 'other';
    const isPlot = k.where === 'plot';
    return `<form class="wizard" id="wizard" onsubmit="return false">
      <button type="button" class="link back" data-act="wiz-back">← Välj en annan typ</button>
      <h1>${k.icon} ${esc(k.label)}</h1>
      <p class="muted">${esc(k.description)} Svara på det du vet – resten kan du fylla i senare.</p>
      <div class="grid2">
        <label>Vad ska projektet heta?<input name="name" value="${esc(k.id === 'other' ? '' : k.label)}" placeholder="T.ex. Nytt badrum på övervåningen" /></label>
        <label>${isPlot ? 'Var på tomten?' : 'Vilket rum eller vilken del av huset?'}<input name="place" placeholder="${isPlot ? 'T.ex. söder om huset' : 'T.ex. badrummet på övervåningen'}" /></label>
      </div>
      <label>Vad vill du uppnå?<textarea name="goal" rows="2" placeholder="T.ex. Ett ljusare och mer lättstädat badrum med plats för tvättmaskin"></textarea></label>
      ${
        showSize
          ? `<fieldset><legend>Ungefärliga mått${isPlot ? '' : ' på rummet'} (meter)</legend>
        <div class="dims">
          <label>Längd<input name="length" inputmode="decimal" value="${dec(k.size.length)}" /></label>
          <span>×</span>
          <label>Bredd<input name="width" inputmode="decimal" value="${dec(k.size.width)}" /></label>
          ${isPlot ? '' : `<label>Takhöjd<input name="height" inputmode="decimal" value="${dec(k.size.height || 2.4)}" /></label>`}
        </div></fieldset>`
          : ''
      }
      <fieldset><legend>Vem gör jobbet?</legend>
        <div class="radios">
          <label><input type="radio" name="who" value="self" /> Jag själv</label>
          <label><input type="radio" name="who" value="mix" checked /> Delvis själv, delvis hantverkare</label>
          <label><input type="radio" name="who" value="contractor" /> Hantverkare</label>
        </div>
      </fieldset>
      <div class="grid2">
        <label>Budget (kr)<input name="budget" inputmode="numeric" placeholder="T.ex. 150 000" /></label>
        <label>Klart till<input name="deadline" type="date" /></label>
      </div>
      <label>Önskemål – ett per rad. Börja raden med ! för sådant som måste finnas.
        <textarea name="wishes" rows="4" placeholder="${esc(k.prompts.slice(0, 3).map((q) => q).join('\n'))}"></textarea>
      </label>
      <p class="muted small">Frågor att fundera på: ${k.prompts.map(esc).join(' · ')}</p>
      ${k.permit ? `<div class="note"><b>Lov och anmälan:</b> ${esc(k.permit)}</div>` : ''}
      <div class="actions"><button type="button" class="primary big" data-act="wiz-create">Planera projektet</button></div>
    </form>`;
  }

  // ---------- Ett projekt ----------

  private projectHTML(p: HomeProject) {
    const k = kindOf(p.kind);
    const pr = Math.round(progress(p) * 100);
    const next = nextStep(p);
    let h = `<div class="proj-head">
      <button class="link back" data-act="home">← Alla projekt</button>
      <div class="title-row">
        <span class="icon big">${k.icon}</span>
        <input class="title" data-f="name" value="${esc(p.name)}" aria-label="Projektets namn" />
        <select data-f="status" aria-label="Status">${(Object.keys(STATUS_LABELS) as (keyof typeof STATUS_LABELS)[]).map((s) => `<option value="${s}"${s === p.status ? ' selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}</select>
        <select data-f="priority" aria-label="Prioritet">${[1, 2, 3].map((n) => `<option value="${n}"${n === p.priority ? ' selected' : ''}>${['', 'Viktigast', 'Normal', 'Kan vänta'][n]}</option>`).join('')}</select>
      </div>
      <div class="progress-row">
        <div class="bar"><span style="width:${pr}%"></span></div><span class="small">${pr} % klart</span>
      </div>
      ${
        next
          ? `<div class="next"><span class="muted small">Nästa steg</span><b>${esc(next.title)}</b>${next.action ? `<button class="primary" data-act="action" data-action="${next.action}">${esc(ACTION_LABELS[next.action])}</button>` : ''}<button data-act="step-done" data-id="${next.id}">Klart ✓</button></div>`
          : p.steps.length
            ? `<div class="next done">Alla steg är klara 🎉</div>`
            : ''
      }
    </div>
    <nav class="tabs">${TABS.map(([id, label]) => `<button data-act="tab" data-tab="${id}" class="${this.tab === id ? 'on' : ''}">${label}${badge(p, id)}</button>`).join('')}</nav>
    <div class="tab-body">`;
    if (this.tab === 'overview') h += this.overviewHTML(p);
    else if (this.tab === 'steps') h += this.stepsHTML(p);
    else if (this.tab === 'ideas') h += this.ideasHTML(p);
    else if (this.tab === 'budget') h += this.budgetHTML(p);
    else h += this.linksHTML(p);
    return h + '</div>';
  }

  private overviewHTML(p: HomeProject) {
    const k = kindOf(p.kind);
    const showSize = k.id !== 'garden';
    const area = floorArea(p);
    let h = `<div class="cols"><div class="col">
      <section class="box">
        <h2>Mål och fakta</h2>
        <label>Vad vill du uppnå?<textarea data-f="goal" rows="3">${esc(p.goal)}</textarea></label>
        <div class="grid2">
          <label>Var<input data-f="place" value="${esc(p.place)}" /></label>
          <label>Typ av projekt<select data-f="kind">${KINDS.map((x) => `<option value="${x.id}"${x.id === p.kind ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
        </div>
        ${
          showSize
            ? `<div class="dims">
          <label>Längd (m)<input data-f="size.length" inputmode="decimal" value="${dec(p.size.length)}" /></label>
          <span>×</span>
          <label>Bredd (m)<input data-f="size.width" inputmode="decimal" value="${dec(p.size.width)}" /></label>
          <label>Takhöjd (m)<input data-f="size.height" inputmode="decimal" value="${dec(p.size.height)}" /></label>
          ${area ? `<span class="muted">= ${dec(area)} m²</span>` : ''}
        </div>`
            : ''
        }
        <div class="grid2">
          <label>Vem gör jobbet?<select data-f="who">${(
            [
              ['self', 'Jag själv'],
              ['mix', 'Delvis själv, delvis hantverkare'],
              ['contractor', 'Hantverkare'],
            ] as [WhoDoes, string][]
          )
            .map(([v, l]) => `<option value="${v}"${v === p.who ? ' selected' : ''}>${l}</option>`)
            .join('')}</select></label>
          <label>Klart till<input type="date" data-f="deadline" value="${esc(p.deadline)}" /></label>
        </div>
        ${p.deadline ? `<p class="small muted">${dateSv(p.deadline)}${(() => {
          const d = daysLeft(p.deadline);
          return d === null ? '' : d >= 0 ? ` – ${d} dagar kvar` : ` – ${-d} dagar sedan`;
        })()}</p>` : ''}
        <label>Anteckningar<textarea data-f="notes" rows="4" placeholder="Kontakter, mått, beslut, sådant du inte vill glömma …">${esc(p.notes)}</textarea></label>
      </section>
    </div><div class="col">`;
    h += this.summaryBox(p);
    if (k.permit || k.tips.length) {
      h += `<section class="box">
        <h2>Bra att veta</h2>
        ${k.permit ? `<div class="note"><b>Lov och anmälan:</b> ${esc(k.permit)}</div>` : ''}
        <ul>${k.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        <p class="small muted">Vägledning – kommunen och detaljplanen har sista ordet.</p>
      </section>`;
    }
    if (this.aiAvailable) {
      h += `<section class="box ai">
        <h2>Fråga Claude</h2>
        <p class="small muted">Claude ser projektets mål, mått, önskemål, budget och steg.</p>
        <div class="ai-row"><input id="ai-q" placeholder="T.ex. Räcker budgeten? Vad glömmer man lätt?" /><button class="primary" data-act="ai-ask" ${this.aiBusy ? 'disabled' : ''}>${this.aiBusy ? 'Tänker …' : 'Fråga'}</button></div>
        <div id="ai-answer" class="ai-answer"></div>
      </section>`;
    }
    h += `<section class="box danger-zone"><button class="danger" data-act="delete">Ta bort projektet</button></section>`;
    return h + '</div></div>';
  }

  private summaryBox(p: HomeProject) {
    const { total: est, calc } = estimateTotal(p, this.lib);
    const paid = p.costs.reduce((s, c) => s + c.actual, 0);
    const counts = [
      [p.links.plans.length, 'ritning', 'ritningar'],
      [p.links.sites.length, 'tomt', 'tomter'],
      [p.links.builds.length, 'kalkyl', 'kalkyler'],
      [p.ideas.length, 'idé', 'idéer'],
      [p.wishes.length, 'önskemål', 'önskemål'],
    ] as const;
    return `<section class="box">
      <h2>Läget</h2>
      <dl class="kv">
        <dt>Budget</dt><dd>${p.budget ? kr(p.budget) : '<button class="link" data-act="tab" data-tab="budget">Sätt en budget</button>'}</dd>
        <dt>${calc.found ? 'Kalkyl' : 'Uppskattat'}</dt><dd class="${p.budget && est > p.budget ? 'danger' : ''}">${est ? kr(est) : '–'}</dd>
        <dt>Betalt hittills</dt><dd>${paid ? kr(paid) : '–'}</dd>
        <dt>Steg klara</dt><dd>${p.steps.filter((s) => s.done).length} av ${p.steps.length}</dd>
      </dl>
      <p class="small muted">${counts
        .filter(([n]) => n)
        .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
        .join(' · ') || 'Inga ritningar, kalkyler eller idéer ännu.'}</p>
    </section>`;
  }

  private stepsHTML(p: HomeProject) {
    const phases = [...PHASES, ...new Set(p.steps.map((s) => s.phase).filter((ph) => !PHASES.includes(ph)))];
    let h = `<div class="toolbar">
      <button data-act="step-add">+ Lägg till steg</button>
      <button data-act="steps-regen" title="Ta fram stegen igen utifrån typ, svar och budget. Steg du redan bockat av behålls.">Gör om planen</button>
      ${this.aiAvailable ? `<button class="accent" data-act="ai-steps" ${this.aiBusy ? 'disabled' : ''}>${this.aiBusy ? 'Claude tänker …' : 'Låt Claude föreslå steg'}</button>` : ''}
    </div>`;
    if (!p.steps.length) h += `<p class="empty">Inga steg ännu. Tryck på <b>Gör om planen</b> för att få en plan, eller lägg till egna steg.</p>`;
    for (const ph of phases) {
      const steps = p.steps.filter((s) => s.phase === ph);
      if (!steps.length) continue;
      h += `<section class="phase"><h3>${esc(ph)} <span class="muted small">${steps.filter((s) => s.done).length}/${steps.length}</span></h3>`;
      for (const s of steps) {
        h += `<div class="step ${s.done ? 'is-done' : ''}">
          <input type="checkbox" data-act="step-toggle" data-id="${s.id}" ${s.done ? 'checked' : ''} aria-label="Klart" />
          <div class="step-body">
            <input class="step-title" data-sf="title" data-id="${s.id}" value="${esc(s.title)}" />
            <textarea class="step-detail" data-sf="detail" data-id="${s.id}" rows="${Math.max(1, Math.ceil(s.detail.length / 90))}">${esc(s.detail)}</textarea>
            <div class="step-tools">
              ${s.action ? `<button class="primary small" data-act="action" data-action="${s.action}">${esc(ACTION_LABELS[s.action])}</button>` : ''}
              <select data-sf="phase" data-id="${s.id}" aria-label="Fas">${phases.map((x) => `<option${x === s.phase ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>
              <select data-sf="action" data-id="${s.id}" aria-label="Verktyg">
                <option value="">Inget verktyg</option>
                ${(Object.keys(ACTION_LABELS) as StepAction[]).map((a) => `<option value="${a}"${a === s.action ? ' selected' : ''}>${esc(ACTION_LABELS[a])}</option>`).join('')}
              </select>
              <button class="icon-btn" data-act="step-up" data-id="${s.id}" title="Flytta upp">↑</button>
              <button class="icon-btn" data-act="step-down" data-id="${s.id}" title="Flytta ner">↓</button>
              <button class="icon-btn" data-act="step-del" data-id="${s.id}" title="Ta bort">✕</button>
            </div>
          </div>
        </div>`;
      }
      h += '</section>';
    }
    return h;
  }

  private ideasHTML(p: HomeProject) {
    const k = kindOf(p.kind);
    let h = `<section class="box">
      <h2>Önskemål</h2>
      <p class="small muted">Bocka i <b>Måste</b> för det som inte går att vara utan. Det andra är "vore bra".</p>
      <div class="wishes">${p.wishes
        .map(
          (w) => `<div class="wish">
        <label class="must"><input type="checkbox" data-wf="must" data-id="${w.id}" ${w.must ? 'checked' : ''} /> Måste</label>
        <input data-wf="text" data-id="${w.id}" value="${esc(w.text)}" />
        <button class="icon-btn" data-act="wish-del" data-id="${w.id}" title="Ta bort">✕</button>
      </div>`,
        )
        .join('')}</div>
      <div class="ai-row"><input id="wish-new" placeholder="Skriv ett önskemål och tryck Lägg till" /><button data-act="wish-add">Lägg till</button></div>
      <p class="small muted">Frågor att fundera på: ${k.prompts.map((q) => `<button class="chip" data-act="wish-prompt" data-text="${esc(q)}">${esc(q)}</button>`).join(' ')}</p>
    </section>
    <section class="box">
      <h2>Idéer, bilder och inspiration</h2>
      <div class="dropzone" tabindex="0">
        <p>Dra hit bilder, klistra in (Ctrl+V) eller</p>
        <div class="toolbar">
          <button class="primary" data-act="idea-image">Lägg till bilder…</button>
          <button data-act="idea-note">+ Anteckning eller länk</button>
        </div>
        <p class="small muted">Skärmbilder från Hemnet, Pinterest, butiker – eller ett foto på en skiss. Bilderna förminskas och sparas i webbläsaren.</p>
      </div>
      <div class="ideas">${p.ideas
        .slice()
        .reverse()
        .map(
          (i) => `<figure class="idea">
        ${i.image ? `<img src="${esc(i.image)}" alt="" />` : ''}
        <figcaption>
          <textarea data-if="text" data-id="${i.id}" rows="2" placeholder="Vad gillar du med den här?">${esc(i.text)}</textarea>
          <input data-if="url" data-id="${i.id}" value="${esc(i.url ?? '')}" placeholder="Länk (https://…)" />
          <div class="idea-tools">${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">Öppna länken ↗</a>` : '<span></span>'}<button class="icon-btn" data-act="idea-del" data-id="${i.id}" title="Ta bort">✕</button></div>
        </figcaption>
      </figure>`,
        )
        .join('')}</div>
    </section>
    ${this.albumHTML(p, true)}`;
    return h;
  }

  private budgetHTML(p: HomeProject) {
    const { total: est, calc } = estimateTotal(p, this.lib);
    const builds = p.links.builds.map((id) => this.lib.builds.get(id)).filter(Boolean) as Project[];
    const paid = p.costs.reduce((s, c) => s + c.actual, 0);
    const left = p.budget - est;
    const k = kindOf(p.kind);
    const rough = roughEstimate(p);
    let h = `<div class="cols"><div class="col">
      <section class="box">
        <h2>Budget</h2>
        <label>Hur mycket får projektet kosta? (kr)<input data-f="budget" inputmode="numeric" value="${p.budget ? Math.round(p.budget).toLocaleString('sv-SE') : ''}" placeholder="T.ex. 150 000" /></label>
        ${rough ? `<p class="small muted">Grovt riktpris för ${esc(k.label.toLowerCase())} på ${dec(floorArea(p))} m² ${p.who === 'self' ? 'om du gör det mesta själv' : p.who === 'mix' ? 'om du gör en del själv' : 'med hantverkare'}: ca ${kr(rough)}. Väldigt ungefärligt – kalkylen och offerterna ger bättre siffror.</p>` : ''}
        <dl class="kv big">
          <dt>Uppskattat totalt</dt><dd>${kr(est)}</dd>
          <dt>Betalt hittills</dt><dd>${kr(paid)}</dd>
          ${p.budget ? `<dt>${left >= 0 ? 'Kvar av budgeten' : 'Över budget'}</dt><dd class="${left < 0 ? 'danger' : 'ok'}">${kr(Math.abs(left))}</dd>` : ''}
        </dl>
        ${p.budget ? `<div class="bar budget"><span style="width:${Math.min(100, (est / p.budget) * 100)}%" class="${left < 0 ? 'over' : ''}"></span></div><p class="small muted">${Math.round((est / p.budget) * 100)} % av budgeten är uppskattad</p>` : ''}
      </section>
    </div><div class="col">
      <section class="box">
        <h2>Kalkyler från Byggplaneraren</h2>
        ${
          builds.length
            ? `<table class="tbl"><thead><tr><th>Kalkyl</th><th>Material</th><th>Arbete</th><th>ROT</th><th>Summa</th></tr></thead><tbody>${builds
                .map((b) => {
                  const t = totals(b);
                  return `<tr><td><button class="link" data-act="open-tool" data-tool="byggplaneraren" data-id="${b.id}">${esc(b.name)}</button></td><td>${kr(t.materials)}</td><td>${kr(t.labor)}</td><td>−${kr(t.rot)}</td><td><b>${kr(t.total)}</b></td></tr>`;
                })
                .join('')}</tbody></table>`
            : `<p class="muted">Ingen kalkyl kopplad ännu. ${k.byggTemplate || k.where !== 'room' ? 'En kalkyl räknar fram moment, material och mängder.' : ''}</p><button data-act="action" data-action="bygg">Skapa kalkyl i Byggplaneraren</button>`
        }
      </section>
      <section class="box">
        <h2>Egna poster</h2>
        <p class="small muted">Sådant som inte finns i kalkylen – offerter, möbler, bygglovsavgift, container, oförutsett …</p>
        <table class="tbl edit"><thead><tr><th>Vad</th><th>Uppskattat</th><th>Betalt</th><th></th></tr></thead><tbody>
        ${p.costs
          .map(
            (c) => `<tr class="${c.rough && calc.found ? 'struck' : ''}" title="${c.rough && calc.found ? 'Räknas inte med – kalkylen ersätter den grova uppskattningen' : ''}">
          <td><input data-cf="name" data-id="${c.id}" value="${esc(c.name)}" /></td>
          <td><input data-cf="estimate" data-id="${c.id}" inputmode="numeric" value="${c.estimate ? Math.round(c.estimate).toLocaleString('sv-SE') : ''}" /></td>
          <td><input data-cf="actual" data-id="${c.id}" inputmode="numeric" value="${c.actual ? Math.round(c.actual).toLocaleString('sv-SE') : ''}" /></td>
          <td><button class="icon-btn" data-act="cost-del" data-id="${c.id}" title="Ta bort">✕</button></td>
        </tr>`,
          )
          .join('')}
        </tbody></table>
        <div class="toolbar"><button data-act="cost-add">+ Lägg till post</button>${p.budget ? '<button data-act="cost-buffer">+ Oförutsett 10 %</button>' : ''}</div>
      </section>
    </div></div>`;
    return h;
  }

  private linksHTML(p: HomeProject) {
    const lib = this.lib;
    const k = kindOf(p.kind);
    const section = <T extends { id: string; name: string }>(
      title: string,
      tool: ToolId,
      ids: string[],
      map: Map<string, T>,
      summary: (x: T) => string,
      createLabel: string,
      createAction: StepAction,
      extra?: (x: T) => string,
    ) => {
      const unlinked = [...map.values()].filter((x) => !ids.includes(x.id));
      return `<section class="box">
        <h2>${title}</h2>
        ${
          ids.length
            ? `<ul class="linked">${ids
                .map((id) => {
                  const x = map.get(id);
                  if (!x) return `<li class="missing"><span>Finns inte i den här webbläsaren (borttagen eller sparad någon annanstans)</span><button class="icon-btn" data-act="unlink" data-tool="${tool}" data-id="${id}" title="Ta bort kopplingen">✕</button></li>`;
                  return `<li><div><b>${esc(x.name)}</b><span class="small muted">${summary(x)}</span></div>
                  <div class="row-tools"><button class="primary small" data-act="open-tool" data-tool="${tool}" data-id="${id}">Öppna</button>${extra ? extra(x) : ''}<button class="icon-btn" data-act="unlink" data-tool="${tool}" data-id="${id}" title="Ta bort kopplingen (inget raderas)">✕</button></div></li>`;
                })
                .join('')}</ul>`
            : '<p class="muted">Inget kopplat ännu.</p>'
        }
        <div class="toolbar">
          <button data-act="action" data-action="${createAction}" data-force="1">${createLabel}</button>
          ${unlinked.length ? `<select data-act-change="link" data-tool="${tool}"><option value="">Koppla en befintlig …</option>${unlinked.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>` : ''}
        </div>
      </section>`;
    };
    const planSummary = (pl: Plan) => {
      const area = pl.rooms.reduce((s, r) => s + polyArea(r.points), 0) / 1e6;
      return `${pl.rooms.length} rum${area ? `, ${dec(Math.round(area * 10) / 10)} m²` : ''} · ${pl.items.length} möbler · ändrad ${new Date(pl.updatedAt).toLocaleDateString('sv-SE')}`;
    };
    const siteSummary = (s: Site) => `${s.buildings.length} byggnader · ${s.areas.length} ytor · ändrad ${new Date(s.updatedAt).toLocaleDateString('sv-SE')}`;
    const buildSummary = (b: Project) => {
      const t = totals(b);
      return `${t.tasks} moment (${t.tasksDone} klara) · ${b.materials.length} material · ${kr(t.total)}`;
    };
    let h = `<p class="muted">Här samlas ritningar, tomter och kalkyler som hör till projektet. <b>Öppna</b> tar dig till rätt verktyg med rätt innehåll. ${inArtifact() ? 'Här inne i Claude sparas det som en fil som du öppnar i verktyget.' : ''}</p>
    <div class="cols"><div class="col">`;
    h += section('Ritningar (Planritaren)', 'planritaren', p.links.plans, lib.plans, planSummary, p.links.plans.length ? '+ Rita ett nytt förslag' : '+ Rita rummet', p.links.plans.length ? 'plan-new' : 'plan-now', (pl) => `<button class="small" data-act="open-tool" data-tool="planritaren" data-id="${pl.id}" data-show="3d">3D</button>`);
    if (k.where !== 'room' || p.links.sites.length) h += section('Tomt (Tomtplaneraren)', 'tomtplaneraren', p.links.sites, lib.sites, siteSummary, '+ Rita tomten', 'tomt');
    h += `</div><div class="col">`;
    h += section('Kalkyler (Byggplaneraren)', 'byggplaneraren', p.links.builds, lib.builds, buildSummary, '+ Skapa kalkyl', 'bygg');
    if (k.where === 'room' && !p.links.sites.length)
      h += `<section class="box"><h2>Tomt (Tomtplaneraren)</h2><p class="muted">Behövs oftast inte för ett projekt inomhus.</p><div class="toolbar"><button data-act="action" data-action="tomt" data-force="1">+ Rita tomten ändå</button></div></section>`;
    h += this.albumHTML(p, false);
    return h + '</div></div>';
  }

  // ================= Händelser =================

  private onClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || el.tagName === 'SELECT') return;
    if (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox') return;
    const act = el.dataset.act!;
    const id = el.dataset.id ?? '';
    const p = this.p;
    switch (act) {
      case 'new':
        this.wizardKind = '';
        return this.render();
      case 'kind':
        this.wizardKind = el.dataset.kind!;
        this.render();
        this.root.querySelector<HTMLInputElement>('#wizard input[name=name]')?.focus();
        return;
      case 'wiz-back':
        this.wizardKind = '';
        return this.render();
      case 'wiz-cancel':
        this.wizardKind = null;
        return this.render();
      case 'wiz-create':
        return this.createFromWizard();
      case 'open':
        this.tab = 'overview';
        this.aiText = '';
        return this.store.open(id);
      case 'home':
        this.aiText = '';
        return this.store.open(null);
      case 'tab':
        return this.go(el.dataset.tab as Tab);
    }
    if (!p) return;
    const step = p.steps.find((s) => s.id === id);
    switch (act) {
      case 'action':
        return void this.runAction(p, el.dataset.action as StepAction, !!el.dataset.force);
      case 'step-done':
      case 'step-toggle':
        if (step) {
          step.done = act === 'step-done' ? true : !step.done;
          if (step.done && p.status === 'planning' && PHASES.indexOf(step.phase) >= 5) p.status = 'doing';
          if (p.steps.every((s) => s.done) && p.steps.length) p.status = 'done';
          this.store.changed(p);
        }
        return;
      case 'step-add':
        p.steps.push({ id: uid('st'), title: 'Nytt steg', detail: '', phase: PHASES[5], done: false, note: '' });
        return this.store.changed(p);
      case 'step-del':
        p.steps = p.steps.filter((s) => s.id !== id);
        return this.store.changed(p);
      case 'step-up':
      case 'step-down': {
        const i = p.steps.findIndex((s) => s.id === id);
        const phase = p.steps[i]?.phase;
        const dir = act === 'step-up' ? -1 : 1;
        let j = i + dir;
        while (j >= 0 && j < p.steps.length && p.steps[j].phase !== phase) j += dir;
        if (i < 0 || j < 0 || j >= p.steps.length) return;
        [p.steps[i], p.steps[j]] = [p.steps[j], p.steps[i]];
        return this.store.changed(p);
      }
      case 'steps-regen': {
        const done = new Set(p.steps.filter((s) => s.done).map((s) => s.title));
        const custom = p.steps.filter((s) => s.done);
        const fresh = generateSteps(p).filter((s) => !done.has(s.title));
        p.steps = [...custom, ...fresh].sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase));
        this.notify('Planen är framtagen på nytt. Steg som redan var klara finns kvar.');
        return this.store.changed(p);
      }
      case 'ai-steps':
        return void this.aiSteps(p);
      case 'ai-ask':
        return void this.aiAsk(p);
      case 'wish-add':
      case 'wish-prompt': {
        const input = this.root.querySelector<HTMLInputElement>('#wish-new');
        const text = act === 'wish-prompt' ? el.dataset.text! : (input?.value ?? '').trim();
        if (!text) return input?.focus();
        p.wishes.push({ id: uid('w'), text, must: false });
        this.store.changed(p);
        if (act === 'wish-prompt') {
          const inputs = this.root.querySelectorAll<HTMLInputElement>('[data-wf=text]');
          const last = inputs[inputs.length - 1];
          last?.focus();
          last?.select();
        } else this.root.querySelector<HTMLInputElement>('#wish-new')?.focus();
        return;
      }
      case 'wish-del':
        p.wishes = p.wishes.filter((w) => w.id !== id);
        return this.store.changed(p);
      case 'idea-image':
        return this.pickImages();
      case 'idea-note':
        p.ideas.push({ id: uid('i'), text: '', createdAt: Date.now() });
        this.store.changed(p);
        this.root.querySelector<HTMLTextAreaElement>('[data-if=text]')?.focus();
        return;
      case 'idea-del':
        if (!this.armed(el, `idea-${id}`)) return;
        p.ideas = p.ideas.filter((i) => i.id !== id);
        return this.store.changed(p);
      case 'cost-add':
        p.costs.push({ id: uid('c'), name: 'Ny post', estimate: 0, actual: 0 });
        return this.store.changed(p);
      case 'cost-buffer':
        p.costs.push({ id: uid('c'), name: 'Oförutsett (10 % av budgeten)', estimate: Math.round(p.budget * 0.1), actual: 0 });
        return this.store.changed(p);
      case 'cost-del':
        p.costs = p.costs.filter((c) => c.id !== id);
        return this.store.changed(p);
      case 'open-image':
        return this.openPage('bildbiblioteket', { album: p.name, bild: id });
      case 'send-images': {
        const images = p.ideas.filter((i) => i.image).map((i, n) => ({ name: (i.text.trim() || `Idé ${n + 1}`).slice(0, 60), src: i.image! }));
        if (!images.length) return;
        if (!sendHandoff('bildbiblioteket', { album: p.name, images }, 'hemprojekt')) {
          this.notify('Bilderna fick inte plats att skickas på en gång. Spara dem och ladda upp dem i Bildbiblioteket.');
          return;
        }
        this.album.delete(p.name);
        this.openPage('bildbiblioteket', { album: p.name });
        this.notify(`${images.length} bilder skickas till albumet "${esc(p.name)}" i Bildbiblioteket.`);
        return;
      }
      case 'open-tool':
        return this.openExisting(el.dataset.tool as ToolId, id, el.dataset.show);
      case 'unlink': {
        const key = linkKey(el.dataset.tool as ToolId);
        p.links[key] = p.links[key].filter((x) => x !== id);
        return this.store.changed(p);
      }
      case 'delete':
        if (!this.armed(el, `del-${p.id}`, 'Tryck igen för att ta bort (ritningar och kalkyler finns kvar i verktygen)')) return;
        return this.store.remove(p.id);
    }
  }

  private onChange(e: Event) {
    const el = e.target as HTMLInputElement;
    const p = this.p;
    if (!p) return;
    const ds = el.dataset;
    const val = el.type === 'checkbox' ? el.checked : el.value;
    if (ds.f) {
      const f = ds.f;
      if (f === 'name') p.name = el.value.trim() || kindOf(p.kind).label;
      else if (f === 'budget') p.budget = Math.max(0, num(el.value));
      else if (f === 'priority') p.priority = Number(el.value) as 1 | 2 | 3;
      else if (f.startsWith('size.')) (p.size as any)[f.slice(5)] = Math.max(0, num(el.value));
      else (p as any)[f] = val;
      return this.store.changed(p);
    }
    if (ds.sf) {
      const s = p.steps.find((x) => x.id === ds.id);
      if (!s) return;
      if (ds.sf === 'action') s.action = (el.value || undefined) as StepAction | undefined;
      else (s as any)[ds.sf] = el.value;
      return this.store.changed(p, ds.sf === 'action' || ds.sf === 'phase');
    }
    if (ds.wf) {
      const w = p.wishes.find((x) => x.id === ds.id);
      if (!w) return;
      if (ds.wf === 'must') w.must = el.checked;
      else w.text = el.value;
      return this.store.changed(p, false);
    }
    if (ds.if) {
      const i = p.ideas.find((x) => x.id === ds.id);
      if (!i) return;
      if (ds.if === 'url') {
        const v = el.value.trim();
        i.url = /^https?:\/\//.test(v) ? v : v ? `https://${v}` : undefined;
        return this.store.changed(p);
      }
      i.text = el.value;
      return this.store.changed(p, false);
    }
    if (ds.cf) {
      const c = p.costs.find((x) => x.id === ds.id);
      if (!c) return;
      if (ds.cf === 'name') c.name = el.value;
      else c[ds.cf as 'estimate' | 'actual'] = Math.max(0, num(el.value));
      return this.store.changed(p);
    }
    if (ds.actChange === 'link' && el.value) {
      const key = linkKey(ds.tool as ToolId);
      if (!p.links[key].includes(el.value)) p.links[key].push(el.value);
      return this.store.changed(p);
    }
  }

  /** Bekräftelse i sidan: första trycket frågar, andra trycket (inom 4 s) gör det. */
  private armedKey = '';
  private armedTimer: number | undefined;
  private armed(el: HTMLElement, key: string, text = 'Säker? Tryck igen') {
    if (this.armedKey === key) {
      this.armedKey = '';
      return true;
    }
    this.armedKey = key;
    el.classList.add('confirm');
    el.textContent = text;
    window.clearTimeout(this.armedTimer);
    this.armedTimer = window.setTimeout(() => {
      this.armedKey = '';
      this.render();
    }, 4000);
    return false;
  }

  // ---------- Guiden ----------

  private createFromWizard() {
    const form = this.root.querySelector<HTMLFormElement>('#wizard');
    if (!form || !this.wizardKind) return;
    const fd = new FormData(form);
    const get = (k: string) => String(fd.get(k) ?? '').trim();
    const k = kindOf(this.wizardKind);
    const wishes = get('wishes')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => ({ id: uid('w'), must: l.startsWith('!'), text: l.replace(/^!\s*/, '') }));
    const p = planProject({
      kind: k.id,
      name: get('name') || k.label,
      place: get('place'),
      goal: get('goal'),
      size: { length: num(get('length')), width: num(get('width')), height: num(get('height')) || (k.where === 'plot' ? 0 : 2.4) },
      who: (get('who') || 'mix') as WhoDoes,
      budget: Math.max(0, num(get('budget'))),
      deadline: get('deadline'),
      wishes,
    });
    this.wizardKind = null;
    this.tab = 'steps';
    this.store.add(p);
    this.notify(`Klart! "${esc(p.name)}" har fått ${p.steps.length} steg. Börja uppifrån – knapparna öppnar rätt verktyg.`, 6000);
  }

  // ---------- Bilder ----------

  private pickImages() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => void this.addImages([...(input.files ?? [])]);
    input.click();
  }

  private async addImages(files: Blob[]) {
    const p = this.p;
    if (!p || !files.length) return;
    let added = 0;
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      try {
        const image = await shrinkImage(f);
        p.ideas.push({ id: uid('i'), text: '', image, createdAt: Date.now() });
        added++;
      } catch (err: any) {
        this.notify(esc(err.message));
      }
    }
    if (added) {
      this.store.changed(p);
      this.notify(`${added === 1 ? 'Bilden är tillagd' : `${added} bilder är tillagda`}. Skriv gärna vad du gillar med ${added === 1 ? 'den' : 'dem'}.`);
    }
  }

  private onPaste(e: ClipboardEvent) {
    if (this.tab !== 'ideas' || !this.p) return;
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    void this.addImages(files);
  }

  private onDrop(e: DragEvent) {
    if (!(e.target as HTMLElement).closest('.dropzone')) return;
    e.preventDefault();
    void this.addImages([...(e.dataTransfer?.files ?? [])]);
  }

  // ---------- Claude ----------

  private async aiAsk(p: HomeProject) {
    const q = this.root.querySelector<HTMLInputElement>('#ai-q')?.value.trim() ?? '';
    this.aiAbort?.abort();
    this.aiAbort = new AbortController();
    this.aiBusy = true;
    this.aiText = '';
    this.render();
    try {
      this.aiText = await askAdvice(
        p,
        q,
        (t) => {
          this.aiText = t;
          const box = this.root.querySelector<HTMLElement>('#ai-answer');
          if (box) box.textContent = t;
        },
        this.aiAbort.signal,
      );
    } catch (err: any) {
      if (err?.code !== 'aborted') this.aiText = err?.code === 'not_granted' ? 'Claude fick inte användas här.' : `Det gick inte att fråga Claude: ${err?.message ?? err}`;
    }
    this.aiBusy = false;
    this.render();
  }

  private async aiSteps(p: HomeProject) {
    this.aiBusy = true;
    this.render();
    try {
      const steps = await suggestSteps(p);
      if (!steps.length) throw new Error('Inga steg kom tillbaka');
      const done = p.steps.filter((s) => s.done);
      p.steps = [...done, ...steps].sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase));
      this.notify(`Claude föreslog ${steps.length} steg. Klara steg finns kvar. Ändra fritt.`);
    } catch (err: any) {
      this.notify(`Det gick inte att få förslag från Claude: ${esc(err?.message ?? err)}`);
    }
    this.aiBusy = false;
    this.store.changed(p);
  }

  // ================= Verktygen =================

  /** Det ett steg ska göra. `force` = skapa nytt även om något redan är kopplat. */
  runAction(p: HomeProject, action: StepAction, force = false) {
    const lib = (this.lib = readLibrary());
    const plans = p.links.plans.filter((id) => lib.plans.has(id));
    const sites = p.links.sites.filter((id) => lib.sites.has(id));
    const builds = p.links.builds.filter((id) => lib.builds.has(id));
    switch (action) {
      case 'ideas':
        return this.go('ideas');
      case 'bilder':
        if (inArtifact()) {
          window.open(ARTIFACT_LINKS.bildbiblioteket, '_blank', 'noopener');
          this.notify(`Öppna <a href="${ARTIFACT_LINKS.bildbiblioteket}" target="_blank" rel="noopener">Bildbiblioteket</a> och lägg bilderna i albumet "${esc(p.name)}".`, 10000);
          return;
        }
        this.album.delete(p.name);
        return this.openPage('bildbiblioteket', { album: p.name });
      case 'budget':
        return this.go('budget');
      case 'plan-now':
        if (plans.length && !force) return this.openExisting('planritaren', plans[0]);
        return this.createIn(p, 'planritaren', roomPlan(p, 'i dag'), 'Ritningen');
      case 'plan-new': {
        if (plans.length >= 2 && !force) return this.openExisting('planritaren', plans[plans.length - 1]);
        const src = plans.length ? lib.plans.get(plans[0])! : null;
        const n = p.links.plans.length;
        const plan = src ? copyPlan(src, `${p.name} – förslag${n > 1 ? ` ${n}` : ''}`) : roomPlan(p, 'förslag');
        return this.createIn(p, 'planritaren', plan, 'Förslaget');
      }
      case 'plan-3d':
        if (!plans.length) {
          this.notify('Rita först en ritning – tryck på <b>Rita förslaget</b> eller <b>Öppna i Planritaren</b>.');
          return;
        }
        return this.openExisting('planritaren', plans[plans.length - 1], '3d');
      case 'tomt':
        if (sites.length && !force) return this.openExisting('tomtplaneraren', sites[0]);
        return this.createIn(p, 'tomtplaneraren', projectSite(p), 'Tomten');
      default: {
        // Byggplaneraren: kalkyl, offerter, tidsplan, inköp, checklistor
        const view = { bygg: 'overview', 'bygg-quotes': 'quotes', 'bygg-schedule': 'schedule', 'bygg-shopping': 'shopping', 'bygg-checklists': 'checklists' }[action as string] ?? 'overview';
        if (builds.length && !force) return this.openExisting('byggplaneraren', builds[builds.length - 1], undefined, view);
        if (kindOf(p.kind).where === 'plot' && !sites.length) {
          // Tomtprojekt: rita tomten först så att kalkylen kan räknas fram därifrån
          const site = projectSite(p);
          this.link(p, 'tomtplaneraren', site.id, site);
          lib.sites.set(site.id, site);
        }
        const b = projectBuild(p, lib);
        return this.createIn(p, 'byggplaneraren', b, 'Kalkylen', view);
      }
    }
  }

  private link(p: HomeProject, tool: ToolId, id: string, item: { id: string }) {
    const key = linkKey(tool);
    if (!p.links[key].includes(id)) p.links[key].push(id);
    if (!inArtifact()) storeItemsFor(tool, item);
    this.store.changed(p, false);
  }

  /** Skapar något nytt i ett verktyg, kopplar det till projektet och öppnar verktyget. */
  private createIn(p: HomeProject, tool: ToolId, item: { id: string; name: string }, what: string, view?: string) {
    this.link(p, tool, item.id, item);
    if (p.status === 'idea') p.status = 'planning';
    this.store.changed(p);
    if (inArtifact()) return this.saveForArtifact(tool, item);
    sendHandoff(tool, item, 'hemprojekt');
    this.openTool(tool, view ? { projekt: item.id, vy: view } : {});
    this.notify(`${what} "${esc(item.name)}" öppnas i ${toolName(tool)} och är kopplad till projektet. Kom tillbaka hit när du är klar.`, 7000);
    this.lib = readLibrary();
  }

  /** Öppnar något som redan finns i ett verktyg. */
  openExisting(tool: ToolId, id: string, show?: string, view?: string) {
    const lib = readLibrary();
    const item = tool === 'planritaren' ? lib.plans.get(id) : tool === 'tomtplaneraren' ? lib.sites.get(id) : lib.builds.get(id);
    if (!item) {
      this.notify('Den finns inte längre i verktyget – den kan ha tagits bort.');
      return;
    }
    if (inArtifact()) return this.saveForArtifact(tool, item);
    const params: Record<string, string> =
      tool === 'planritaren' ? { plan: id, ...(show ? { visa: show } : {}) } : tool === 'tomtplaneraren' ? { tomt: id } : { projekt: id, ...(view ? { vy: view } : {}) };
    this.openTool(tool, params);
  }

  private openPage(tool: 'bildbiblioteket', params: Record<string, string>) {
    if (inArtifact()) {
      window.open(ARTIFACT_LINKS[tool], '_blank', 'noopener');
      return;
    }
    const url = `${TOOL_PAGES[tool]}?${new URLSearchParams(params)}`;
    if (!window.open(url, tool)) this.notify(`Webbläsaren stoppade fönstret. <a href="${url}" target="${tool}">Öppna Bildbiblioteket här</a>.`, 10000);
  }

  private openTool(tool: ToolId, params: Record<string, string>) {
    const q = new URLSearchParams(params).toString();
    const w = window.open(`${TOOL_PAGES[tool]}${q ? `?${q}` : ''}`, tool);
    if (!w) this.notify(`Webbläsaren stoppade fönstret. <a href="${TOOL_PAGES[tool]}${q ? `?${q}` : ''}" target="${tool}">Öppna ${toolName(tool)} här</a>.`, 10000);
  }

  /** Inuti en Claude-artefakt: spara som fil som öppnas i verktyget. */
  private saveForArtifact(tool: ToolId, item: { id: string; name: string }) {
    const ext = tool === 'planritaren' ? 'json' : tool === 'tomtplaneraren' ? 'tomt.json' : 'bygg.json';
    void download(new Blob([JSON.stringify(item, null, 2)], { type: 'application/json' }), `${safeFilename(item.name, 'fil')}.${ext}`).catch((err) => this.notify(`Nedladdningen misslyckades: ${esc(err.message)}`));
    const link = ARTIFACT_LINKS[tool];
    this.notify(`"${esc(item.name)}" är sparad som fil. Öppna <a href="${link}" target="_blank" rel="noopener">${toolName(tool)}</a> och välj <b>Öppna fil…</b>.`, 12000);
  }
}

// ---------- Hjälp ----------

const order = (p: HomeProject) => ({ doing: 0, planning: 1, idea: 2, paused: 3, done: 4 })[p.status];

const linkKey = (tool: ToolId) => (tool === 'planritaren' ? 'plans' : tool === 'tomtplaneraren' ? 'sites' : 'builds');

const toolName = (tool: ToolId) => ({ planritaren: 'Planritaren', tomtplaneraren: 'Tomtplaneraren', byggplaneraren: 'Byggplaneraren' })[tool];

function storeItemsFor(tool: ToolId, item: { id: string }) {
  const key = tool === 'planritaren' ? KEYS.plans : tool === 'tomtplaneraren' ? KEYS.sites : KEYS.builds;
  try {
    const raw = localStorage.getItem(key);
    const list: { id: string }[] = raw ? JSON.parse(raw) : [];
    if (!list.some((x) => x?.id === item.id)) {
      list.push(item);
      localStorage.setItem(key, JSON.stringify(list));
    }
  } catch {
    /* lagringen full – överlämningen nedan tar ändå med den */
  }
}

function kindCard(k: (typeof KINDS)[number]) {
  return `<button class="kind" data-act="kind" data-kind="${k.id}"><span class="icon">${k.icon}</span><b>${esc(k.label)}</b><span class="small muted">${esc(k.description)}</span></button>`;
}

function toolBox(tool: ToolId | 'bildbiblioteket', name: string, text: string, count: string) {
  const href = inArtifact() ? ARTIFACT_LINKS[tool] : TOOL_PAGES[tool];
  return `<a class="toolbox" href="${href}" target="${inArtifact() ? '_blank' : tool}" rel="noopener"><b>${name} ↗</b><span>${text}</span><em>${count}</em></a>`;
}

function badge(p: HomeProject, tab: Tab) {
  const n = tab === 'steps' ? p.steps.filter((s) => !s.done).length : tab === 'ideas' ? p.ideas.length + p.wishes.length : tab === 'links' ? p.links.plans.length + p.links.sites.length + p.links.builds.length : 0;
  return n ? ` <span class="count">${n}</span>` : '';
}

function polyArea(pts: { x: number; y: number }[]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}


export { emptyHomeProject };
