/** Ritningsblad: situationsplan ovanifrån och fasader från fyra håll, som en bild (PNG). */
import * as THREE from 'three';
import type { Editor } from './editor';
import { M, v3 } from './scene';
import { nearestBoundary, rectCorners, totalHeight, dec, areaM2, siteSummary } from './calc';
import { dist } from '../geometry';
import type { Vec } from './types';

const W = 3508; // A3 liggande, 300 dpi
const H = 2480;

export function drawingSheet(ed: Editor): HTMLCanvasElement {
  const site = ed.store.site;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const g = out.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);

  const scene = ed.scene;
  const oldBg = scene.background;
  const oldFog = scene.fog;
  const oldSun = ed.sun.position.clone();
  const oldInt = ed.sun.intensity;
  scene.background = new THREE.Color('#ffffff');
  scene.fog = null;
  ed.ground.visible = false;

  // ---- Situationsplan ----
  const pad = 90;
  const planBox = { x: pad, y: pad + 60, w: 1900, h: H - 2 * pad - 260 };
  const bounds = ed.bounds();
  const c = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const half = Math.max(size.z / 2, size.x / 2 / (planBox.w / planBox.h)) * 1.15 + 2;
  const top = new THREE.OrthographicCamera((-half * planBox.w) / planBox.h, (half * planBox.w) / planBox.h, half, -half, -500, 1000);
  top.up.set(0, 0, -1);
  top.position.set(c.x, 200, c.z);
  top.lookAt(c);
  top.updateProjectionMatrix();
  ed.sun.position.set(c.x - 20, 120, c.z + 40);
  ed.sun.intensity = 1.6;
  ed.sun.target.position.copy(c);
  const planImg = ed.renderWith(top, planBox.w, planBox.h);
  g.drawImage(planImg, planBox.x, planBox.y);
  const toPx = (p: Vec) => {
    const n = v3(p, 0).project(top);
    return { x: planBox.x + ((n.x + 1) / 2) * planBox.w, y: planBox.y + ((1 - n.y) / 2) * planBox.h };
  };
  const pxPerM = planBox.h / (2 * half);

  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const label = (text: string, x: number, y: number, size = 34, color = '#1f2933', bg = 'rgba(255,255,255,0.85)') => {
    g.font = `600 ${size}px system-ui, sans-serif`;
    const w = g.measureText(text).width + 16;
    g.fillStyle = bg;
    g.fillRect(x - w / 2, y - size * 0.7, w, size * 1.4);
    g.fillStyle = color;
    g.fillText(text, x, y);
  };
  // tomtgräns och mått
  if (site.plot.length >= 3) {
    g.strokeStyle = '#1f2933';
    g.lineWidth = 5;
    g.setLineDash([30, 14]);
    g.beginPath();
    site.plot.forEach((p, i) => {
      const q = toPx(p);
      i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y);
    });
    g.closePath();
    g.stroke();
    g.setLineDash([]);
    for (let i = 0; i < site.plot.length; i++) {
      const a = site.plot[i];
      const b = site.plot[(i + 1) % site.plot.length];
      const q = toPx({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      label(`${dec(dist(a, b) / 1000)} m`, q.x, q.y, 34, '#1f2933');
    }
  }
  // byggnader: namn och avstånd till gräns
  for (const b of site.buildings) {
    const q = toPx(b);
    label(`${b.name}  ${dec(b.w / 1000)} × ${dec(b.d / 1000)} m`, q.x, q.y, 36, '#1f2933');
    if (site.plot.length >= 3) {
      const nb = nearestBoundary(b, site.plot);
      const p1 = toPx(nb.from);
      const p2 = toPx(nb.to);
      g.strokeStyle = nb.d < 4500 ? '#b42318' : '#1d4f91';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(p1.x, p1.y);
      g.lineTo(p2.x, p2.y);
      g.stroke();
      for (const p of [p1, p2]) {
        g.beginPath();
        g.arc(p.x, p.y, 7, 0, Math.PI * 2);
        g.fillStyle = g.strokeStyle;
        g.fill();
      }
      label(`${dec(nb.d / 1000)} m`, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2 - 30, 30, nb.d < 4500 ? '#b42318' : '#1d4f91');
    }
    void rectCorners;
  }
  // norrpil
  const nx = planBox.x + planBox.w - 110;
  const ny = planBox.y + 130;
  g.fillStyle = '#1f2933';
  g.beginPath();
  g.moveTo(nx, ny - 70);
  g.lineTo(nx + 32, ny + 40);
  g.lineTo(nx, ny + 18);
  g.lineTo(nx - 32, ny + 40);
  g.closePath();
  g.fill();
  g.font = '700 44px system-ui, sans-serif';
  g.fillText('N', nx, ny - 105);
  // skalstock
  const step = [1, 2, 5, 10, 20, 50].find((s) => s * pxPerM > 160) ?? 50;
  const sx = planBox.x + 40;
  const sy = planBox.y + planBox.h - 60;
  g.fillStyle = '#ffffff';
  g.fillRect(sx - 20, sy - 60, step * pxPerM * 2 + 80, 100);
  for (let i = 0; i < 2; i++) {
    g.fillStyle = i % 2 ? '#ffffff' : '#1f2933';
    g.fillRect(sx + i * step * pxPerM, sy, step * pxPerM, 14);
  }
  g.strokeStyle = '#1f2933';
  g.lineWidth = 2;
  g.strokeRect(sx, sy, step * pxPerM * 2, 14);
  g.fillStyle = '#1f2933';
  g.font = '500 28px system-ui, sans-serif';
  [0, step, step * 2].forEach((v, i) => g.fillText(`${v} m`, sx + i * step * pxPerM, sy - 26));
  g.strokeStyle = '#d0d5db';
  g.lineWidth = 3;
  g.strokeRect(planBox.x, planBox.y, planBox.w, planBox.h);
  g.textAlign = 'left';
  g.font = '700 46px system-ui, sans-serif';
  g.fillStyle = '#1f2933';
  g.fillText('Situationsplan', planBox.x, planBox.y - 40);

  // ---- Fasader ----
  const fx = planBox.x + planBox.w + 70;
  const fw = W - fx - pad;
  const fh = (planBox.h - 3 * 110) / 4;
  const views: { name: string; dir: THREE.Vector3 }[] = [
    { name: 'Fasad mot söder', dir: new THREE.Vector3(0, 0, 1) },
    { name: 'Fasad mot norr', dir: new THREE.Vector3(0, 0, -1) },
    { name: 'Fasad mot öster', dir: new THREE.Vector3(1, 0, 0) },
    { name: 'Fasad mot väster', dir: new THREE.Vector3(-1, 0, 0) },
  ];
  // Fasaderna visar bara byggnaderna (och altaner)
  const bb = new THREE.Box3();
  let maxH = 3;
  for (const b of site.buildings) {
    for (const p of rectCorners({ ...b, w: b.w + 800, d: b.d + 800 })) bb.expandByPoint(v3(p));
    maxH = Math.max(maxH, totalHeight(b) * M);
  }
  if (bb.isEmpty()) bb.copy(bounds);
  const bc = bb.getCenter(new THREE.Vector3());
  const bs = bb.getSize(new THREE.Vector3());
  const hide = (o: THREE.Object3D) => o.name === 'plants' || o.name === 'lines' || o.userData.sel?.kind === 'plot' || o.type === 'Line';
  views.forEach((v, i) => {
    const bx = fx;
    const by = planBox.y + i * (fh + 110);
    const horiz = Math.abs(v.dir.z) > 0 ? bs.x : bs.z;
    const halfH = Math.max(maxH * 0.62, (horiz / 2 / (fw / fh)) * 1.08) + 0.3;
    const cam = new THREE.OrthographicCamera((-halfH * fw) / fh, (halfH * fw) / fh, halfH, -halfH, 0.1, 1000);
    const target = new THREE.Vector3(bc.x, halfH * 0.82 - 0.4, bc.z);
    cam.position.copy(target.clone().add(v.dir.clone().multiplyScalar(200)));
    cam.lookAt(target);
    cam.updateProjectionMatrix();
    ed.sun.position.copy(target.clone().add(v.dir.clone().multiplyScalar(60)).add(new THREE.Vector3(v.dir.z * 25, 50, -v.dir.x * 25)));
    ed.sun.target.position.copy(target);
    ed.sun.intensity = 1.5;
    const img = ed.renderWith(cam, Math.round(fw), Math.round(fh), hide);
    g.drawImage(img, bx, by);
    // marklinje
    const groundY = by + ((1 - new THREE.Vector3(bc.x, 0, bc.z).project(cam).y) / 2) * fh;
    g.strokeStyle = '#1f2933';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(bx + 10, groundY);
    g.lineTo(bx + fw - 10, groundY);
    g.stroke();
    // nockhöjder
    for (const b of site.buildings) {
      const hTop = totalHeight(b) * M;
      const p = new THREE.Vector3(b.x * M, hTop, b.y * M).project(cam);
      const px = bx + ((p.x + 1) / 2) * fw;
      const py = by + ((1 - p.y) / 2) * fh;
      g.textAlign = 'center';
      label(`+${dec(hTop)} m`, px, py - 34, 28, '#1d4f91');
    }
    g.strokeStyle = '#d0d5db';
    g.lineWidth = 3;
    g.strokeRect(bx, by, fw, fh);
    g.textAlign = 'left';
    g.font = '700 38px system-ui, sans-serif';
    g.fillStyle = '#1f2933';
    g.fillText(v.name, bx, by - 30);
  });

  // ---- Namnruta ----
  const sum = siteSummary(site);
  const ty = H - pad - 150;
  g.strokeStyle = '#1f2933';
  g.lineWidth = 3;
  g.strokeRect(pad, ty, W - 2 * pad, 150);
  g.textAlign = 'left';
  g.fillStyle = '#1f2933';
  g.font = '700 52px system-ui, sans-serif';
  g.fillText(site.name, pad + 30, ty + 52);
  g.font = '400 32px system-ui, sans-serif';
  g.fillText(
    `Tomtarea ${dec(areaM2(site.plot), 0)} m²  ·  Byggnadsarea ${dec(sum.built)} m² (${dec(sum.pct)} % av tomten)  ·  ${site.buildings.map((b) => `${b.name} ${dec((b.w * b.d) / 1e6)} m²`).join(', ')}`,
    pad + 30,
    ty + 108,
  );
  g.textAlign = 'right';
  g.font = '400 30px system-ui, sans-serif';
  g.fillStyle = '#66727f';
  g.fillText(`Ritad i Tomtplaneraren ${new Date().toLocaleDateString('sv-SE')}`, W - pad - 30, ty + 52);
  g.fillText('Skiss – kontrollera mått och regler med kommunen innan bygglovsansökan', W - pad - 30, ty + 108);

  scene.background = oldBg;
  scene.fog = oldFog;
  ed.ground.visible = true;
  ed.sun.position.copy(oldSun);
  ed.sun.intensity = oldInt;
  ed.updateSun();
  return out;
}

/** Bild av den aktuella 3D-vyn i hög upplösning. */
export function viewImage(ed: Editor): HTMLCanvasElement {
  const r = ed.renderer.domElement.getBoundingClientRect();
  const scale = Math.min(3, 2400 / Math.max(1, r.width));
  return ed.renderWith(ed.camera, Math.round(r.width * scale), Math.round(r.height * scale));
}
