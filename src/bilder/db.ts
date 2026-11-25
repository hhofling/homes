/**
 * Bildbibliotekets lagring: bilderna sparas i webbläsarens IndexedDB (de är för stora för localStorage).
 * Samma databas används av Planritaren och Tomtplaneraren när de skickar bilder hit.
 */
import type { Sketch } from './model';

export type BildKalla = 'uppladdad' | 'ai' | 'skiss' | 'planritaren' | 'tomtplaneraren';

export interface Bild {
  id: string;
  name: string;
  album: string;
  created: number;
  width: number;
  height: number;
  blob: Blob;
  thumb: Blob;
  source: BildKalla;
  /** Bilden som den här gjordes från (t.ex. originalet till ett AI-förslag). */
  parentId?: string;
  /** Vad man bad AI om. */
  prompt?: string;
  /** Skissens lager, så att en sparad skiss kan öppnas och ändras igen. */
  sketch?: Sketch;
}

const DB_NAME = 'bildbiblioteket';
const VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('Webbläsaren kan inte spara bilder'));
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('bilder')) db.createObjectStore('bilder', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Kunde inte öppna bildlagringen'));
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const req = fn(s);
        let result: T;
        if (req) req.onsuccess = () => (result = req.result);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error ?? new Error('Lagringen misslyckades'));
        t.onabort = () => reject(t.error ?? new Error('Lagringen avbröts (kanske är lagringsutrymmet fullt)'));
      }),
  );
}

export const allImages = () => tx<Bild[]>('bilder', 'readonly', (s) => s.getAll());
export const getImage = (id: string) => tx<Bild | undefined>('bilder', 'readonly', (s) => s.get(id));
export const putImage = (b: Bild) => tx<IDBValidKey>('bilder', 'readwrite', (s) => s.put(b)).then(() => b);
export const deleteImage = (id: string) => tx<undefined>('bilder', 'readwrite', (s) => s.delete(id));
export const getMeta = <T>(key: string) => tx<T | undefined>('meta', 'readonly', (s) => s.get(key));
export const setMeta = (key: string, value: unknown) => tx<IDBValidKey>('meta', 'readwrite', (s) => s.put(value, key));

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Läser in en bildfil och returnerar en bild (ritbar), bredd och höjd. */
export async function loadBitmap(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('Filen gick inte att läsa som bild'));
      img.src = url;
    });
    await img.decode().catch(() => {});
    return img;
  } finally {
    // Bilden är avkodad – adressen behövs inte längre
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/jpeg', quality = 0.9): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Kunde inte skapa bilden'))), type, quality));
}

/** Skalar ner en bild så att längsta sidan blir högst `max` pixlar. */
export function scaled(img: CanvasImageSource & { width: number; height: number }, max: number, bg?: string) {
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * s));
  c.height = Math.max(1, Math.round(img.height * s));
  const ctx = c.getContext('2d')!;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** Största bild som sparas – större foton skalas ner så att biblioteket inte blir för tungt. */
export const MAX_SIDE = 3000;

/** Lägger till en bild (från fil, AI eller ett annat verktyg) i biblioteket. */
export async function addImage(
  blob: Blob,
  opts: { name: string; album?: string; source: BildKalla; parentId?: string; prompt?: string; sketch?: Sketch },
): Promise<Bild> {
  const img = await loadBitmap(blob);
  let data = blob;
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  const tooBig = Math.max(w, h) > MAX_SIDE;
  const oddType = !/^image\/(png|jpeg|webp)$/.test(blob.type);
  if (tooBig || oddType) {
    const c = scaled(img, MAX_SIDE);
    data = await canvasToBlob(c, blob.type === 'image/png' && !tooBig ? 'image/png' : 'image/jpeg', 0.9);
    w = c.width;
    h = c.height;
  }
  const thumb = await canvasToBlob(scaled(img, 360, '#ffffff'), 'image/jpeg', 0.82);
  const bild: Bild = {
    id: newId(),
    name: opts.name || 'Bild',
    album: opts.album ?? '',
    created: Date.now(),
    width: w,
    height: h,
    blob: data,
    thumb,
    source: opts.source,
    parentId: opts.parentId,
    prompt: opts.prompt,
    sketch: opts.sketch,
  };
  await putImage(bild);
  try {
    localStorage.setItem('bildbiblioteket.changed', String(Date.now()));
  } catch {
    /* ignorera */
  }
  return bild;
}
