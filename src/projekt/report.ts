import { buyQty, dateSv, dec, kr, materialCost, orderedTasks, schedule, shoppingGroups, totals, wallArea, type GroupBy } from './calc';
import type { Project } from './types';
import type { View } from './ui';
import { esc } from './ui';

const CSS = `
body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1f2933;margin:24px;font-size:12pt;background:#fff}
h1{font-size:20pt;margin:0 0 4px}h2{font-size:14pt;margin:22px 0 8px;border-bottom:2px solid #b4561d;padding-bottom:3px}
.meta{color:#66727f;margin-bottom:14px}table{border-collapse:collapse;width:100%;margin-bottom:8px}
th,td{text-align:left;padding:5px 6px;border-bottom:1px solid #dde2e8;vertical-align:top}th{font-size:10pt;color:#66727f}
.num{text-align:right;white-space:nowrap}tfoot td{font-weight:700;border-top:2px solid #1f2933}
.box{display:inline-block;width:12px;height:12px;border:1.5px solid #1f2933;border-radius:2px;margin-right:6px;vertical-align:-1px}
.done{color:#66727f;text-decoration:line-through}pre{white-space:pre-wrap;font:inherit;line-height:1.45}
.cards{display:flex;gap:10px;flex-wrap:wrap}.cards div{border:1px solid #dde2e8;border-radius:6px;padding:8px 12px}
.cards b{display:block;font-size:14pt}@page{margin:15mm}`;

export function reportHTML(p: Project, view: View, opts: { shopBy: GroupBy; shopRemaining: boolean; quote?: string; quoteTrade?: string }): { title: string; html: string } {
  const head = (title: string) => `<h1>${esc(title)}</h1><div class="meta">${esc(p.name)}${p.address ? ` · ${esc(p.address)}` : ''} · utskrivet ${new Date().toLocaleDateString('sv-SE')}</div>`;
  let title: string;
  let body: string;
  if (view === 'shopping') {
    title = 'Inköpslista';
    body = head(title) + shoppingSection(p, opts.shopBy, opts.shopRemaining);
  } else if (view === 'quotes' && opts.quote) {
    title = `Offertförfrågan – ${opts.quoteTrade ?? ''}`;
    body = `<pre>${esc(opts.quote)}</pre>`;
  } else if (view === 'checklists') {
    title = 'Checklistor';
    body = head(title) + checklistSection(p);
  } else if (view === 'schedule') {
    title = 'Tidsplan';
    body = head(title) + scheduleSection(p);
  } else {
    title = 'Projektplan';
    body = head(p.name) + summarySection(p) + roomsSection(p) + tasksSection(p) + scheduleSection(p, true) + materialsSection(p) + (p.checklists.length ? `<h2>Checklistor</h2>${checklistSection(p)}` : '');
  }
  const html = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} – ${esc(p.name)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
  return { title, html };
}

function summarySection(p: Project) {
  const t = totals(p);
  const s = schedule(p);
  return `<div class="cards">
    <div>Total kostnad<b>${kr(t.total)}</b></div><div>Material<b>${kr(t.materials)}</b></div>
    <div>Arbete hantverkare<b>${kr(t.labor)}</b></div><div>ROT-avdrag<b>−${kr(t.rot)}</b></div>
    <div>Arbetstid<b>${dec(t.hours)} h</b></div><div>Klart ungefär<b>${s.end ? dateSv(s.end) : `${s.workdays} arbetsdagar`}</b></div>
  </div>${p.notes ? `<p>${esc(p.notes).replace(/\n/g, '<br>')}</p>` : ''}`;
}

function roomsSection(p: Project) {
  if (!p.rooms.length) return '';
  return `<h2>Rum</h2><table><thead><tr><th>Rum</th><th class="num">Golvyta</th><th class="num">Omkrets</th><th class="num">Takhöjd</th><th class="num">Väggyta</th></tr></thead><tbody>
  ${p.rooms.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${dec(r.area)} m²</td><td class="num">${dec(r.perimeter)} m</td><td class="num">${dec(r.height, 2)} m</td><td class="num">${dec(wallArea(r))} m²</td></tr>`).join('')}
  </tbody></table>`;
}

function tasksSection(p: Project) {
  if (!p.tasks.length) return '';
  return `<h2>Moment</h2><table><thead><tr><th></th><th>Moment</th><th>Fas</th><th>Vem</th><th class="num">Timmar</th><th class="num">Arbete</th><th class="num">Material</th></tr></thead><tbody>
  ${orderedTasks(p.tasks)
    .map((t) => {
      const mat = p.materials.filter((m) => m.taskId === t.id).reduce((s, m) => s + materialCost(m), 0);
      return `<tr class="${t.status === 'done' ? 'done' : ''}"><td><span class="box"></span></td><td>${esc(t.name)}${t.description ? `<br><small>${esc(t.description)}</small>` : ''}</td><td>${esc(t.phase)}</td><td>${t.who === 'self' ? 'Själv' : esc(t.trade)}</td><td class="num">${dec(t.hours)}</td><td class="num">${t.who === 'contractor' ? kr(t.laborCost) : ''}</td><td class="num">${kr(mat)}</td></tr>`;
    })
    .join('')}</tbody></table>`;
}

function scheduleSection(p: Project, withHeading = false) {
  const s = schedule(p);
  if (!s.rows.length) return '';
  return `${withHeading ? '<h2>Tidsplan</h2>' : ''}<table><thead><tr><th>Moment</th><th>Vem</th><th class="num">Dagar</th><th>Start</th><th>Klart</th></tr></thead><tbody>
  ${s.rows.map((r) => `<tr><td>${esc(r.task.name)}</td><td>${r.task.who === 'self' ? 'Själv' : esc(r.task.trade)}</td><td class="num">${r.days}</td><td>${dateSv(r.start)}</td><td>${dateSv(r.end)}</td></tr>`).join('')}
  </tbody><tfoot><tr><td colspan="2">Totalt</td><td class="num">${s.workdays}</td><td></td><td>${dateSv(s.end)}</td></tr></tfoot></table>`;
}

function materialsSection(p: Project) {
  if (!p.materials.length) return '';
  const t = totals(p);
  return `<h2>Material</h2><table><thead><tr><th>Material</th><th class="num">Att köpa</th><th class="num">Pris/enhet</th><th class="num">Summa</th><th>Köps av</th></tr></thead><tbody>
  ${p.materials.map((m) => `<tr><td>${esc(m.name)}</td><td class="num">${dec(buyQty(m))} ${esc(m.unit)}</td><td class="num">${kr(m.price)}</td><td class="num">${kr(materialCost(m))}</td><td>${m.buyer === 'self' ? 'Jag' : 'Hantverkaren'}</td></tr>`).join('')}
  </tbody><tfoot><tr><td colspan="3">Totalt</td><td class="num">${kr(t.materials)}</td><td></td></tr></tfoot></table>`;
}

function shoppingSection(p: Project, by: GroupBy, onlyRemaining: boolean) {
  let total = 0;
  const out = shoppingGroups(p, by)
    .map((g) => {
      const items = g.items.filter((m) => !onlyRemaining || !m.bought);
      if (!items.length) return '';
      return `<h2>${esc(g.name)}</h2><table><tbody>${items
        .map((m) => {
          total += materialCost(m);
          return `<tr class="${m.bought ? 'done' : ''}"><td style="width:20px"><span class="box"></span></td><td class="num" style="width:90px">${dec(buyQty(m))} ${esc(m.unit)}</td><td>${esc(m.name)}${m.note ? ` – <small>${esc(m.note)}</small>` : ''}</td><td class="num">${m.price ? kr(materialCost(m)) : ''}</td></tr>`;
        })
        .join('')}</tbody></table>`;
    })
    .join('');
  return out ? `${out}<p><b>Summa ca ${kr(total)}</b></p>` : '<p>Inget att köpa.</p>';
}

function checklistSection(p: Project) {
  return p.checklists
    .map(
      (c) =>
        `<h2>${esc(c.title)}</h2><table><tbody>${c.items
          .filter((i) => i.text.trim())
          .map((i) => `<tr class="${i.done ? 'done' : ''}"><td style="width:20px"><span class="box"></span></td><td>${esc(i.text)}</td></tr>`)
          .join('')}</tbody></table>`,
    )
    .join('');
}
